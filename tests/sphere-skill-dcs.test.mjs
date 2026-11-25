/** Alchemy and Beastmastery have the same BAB and DC as every other combat
 *  sphere. Only some of their talents put skill ranks in place of BAB for a
 *  DC: Alchemy's formulae and poison use Craft (alchemy) ranks, Beastmastery's
 *  (handle animal) and (ride) talents use those ranks. Those DCs are listed
 *  beside the row, never in place of it.
 *
 *  Run: node tests/sphere-skill-dcs.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { renderMartialPanel } from '../app/js/ui/panels/combat.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const reopen = (m) => new Character(JSON.parse(JSON.stringify(m.toJSON())));

/** A 12th-level martial character with one combat class and talents written in by name. */
function practitioner(talents) {
  const c = new Character(blankDocument({ name: 'Handler', level: 12 }));
  c.set('attack.babOverride', 12);
  c.listAdd('training.combat.classes', {
    name: 'Sentinel', type: 'Expert', talentsPerLevel: 'Expert', mod1: 'Wis', mod2: null, classLevelsOverride: 12,
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, talent: null, sphere: null, notes: null })),
  });
  talents.forEach(([sphere, talent], i) => {
    c.setItem('training.combat.classes.0.levels', i, 'sphere', sphere);
    c.setItem('training.combat.classes.0.levels', i, 'talent', talent);
  });
  return c;
}
const rowOf = (c, name) => c.data.training.combat.sphereRows.find((r) => r.sphere === name);
const skillAt = (c, name, spec) => c.data.skills.findIndex((s) => s.name === name
  && (spec === undefined || String(s.spec || '') === spec));
const modOf = (c) => c.data.training.combat.practitionerDC - 10 - Math.floor(c.data.attack.bab / 2);

console.log('Alchemy and Beastmastery follow BAB like every other combat sphere');
{
  const c = practitioner([['Alchemy', 'Alchemy sphere (formulae)'], ['Beastmastery', 'Beastmastery sphere (Handle Animal)'],
    ['Athletics', 'Athletics sphere (Run)']]);
  const dc = c.data.training.combat.practitionerDC;
  check('the practitioner DC is 10 + half BAB + the modifier', dc, 10 + 6 + modOf(c));
  for (const name of ['Alchemy', 'Beastmastery', 'Athletics']) {
    check(`${name} BAB / DC with no skill ranks`, [rowOf(c, name).attack, rowOf(c, name).dc], [12, dc]);
  }
  check('formulas read the same figures',
    [c.scope().sphere.alchemy.bab, c.scope().sphere.alchemy.dc, c.scope().sphere.beastmastery.dc], [12, dc, dc]);
  check('a sphere with no skill DCs lists none', rowOf(c, 'Athletics').skillDCs, undefined);
}

console.log('\nthe skill-rank DCs sit beside the row');
{
  const c = practitioner([['Alchemy', 'Alchemy sphere (formulae)'], ['Beastmastery', 'Beastmastery sphere (Handle Animal)']]);
  const mod = modOf(c);
  check('Alchemy formulae and poison with no Craft (alchemy) ranks',
    rowOf(c, 'Alchemy').skillDCs, [{ label: 'Formulae and poison', skill: 'Craft (alchemy)', ranks: 0, dc: 10 + mod }]);
  // Naming a Craft row alchemy lets the sphere pay it 5 ranks; 2 bought make 7.
  const craft = skillAt(c, 'Craft');
  c.setItem('skills', craft, 'spec', 'alchemy');
  c.setItem('skills', craft, 'rankSources.bought', 2);
  const alchemy = rowOf(c, 'Alchemy');
  check('Craft (alchemy) ranks set that DC and nothing else',
    [alchemy.attack, alchemy.dc, alchemy.skillDCs[0].ranks, alchemy.skillDCs[0].dc],
    [12, c.data.training.combat.practitionerDC, 7, 10 + 3 + mod]);
  // Two Beastmastery talents pay Handle Animal 10 ranks through the package.
  const beast = rowOf(c, 'Beastmastery');
  check('the Handle Animal package shows its DC only',
    beast.skillDCs.map((d) => [d.label, d.ranks, d.dc]), [['(handle animal) talents', 5, 10 + 2 + mod]]);
}

console.log('\nBeastmastery shows both package DCs when the sheet cannot tell which was taken');
{
  const c = practitioner([['Beastmastery', 'Beastmastery sphere'], ['Beastmastery', 'Pet']]);
  check('two lines, one per package',
    rowOf(c, 'Beastmastery').skillDCs.map((d) => d.label), ['(handle animal) talents', '(ride) talents']);
  const ride = practitioner([['Beastmastery', 'Beastmastery sphere (Ride)']]);
  check('the Ride package shows its own',
    rowOf(ride, 'Beastmastery').skillDCs.map((d) => [d.label, d.ranks]), [['(ride) talents', 5]]);
}

console.log('\nDC+ and a forwarded DC raise every DC the sphere has');
{
  const c = practitioner([['Alchemy', 'Alchemy sphere (poison)']]);
  const mod = modOf(c);
  c.listAdd('training.combat.sphereBonuses', { sphere: 'Alchemy', rankBonus: 0, dcBonus: 2 });
  c.listAdd('notes', { title: 'Focus', body: 'Focus {sphere.alchemy.dc += 1}' });
  const row = rowOf(c, 'Alchemy');
  check('the sphere DC and the formulae DC both move by 3',
    [row.dc, row.skillDCs[0].dc], [c.data.training.combat.practitionerDC + 3, 10 + mod + 3]);
  const again = reopen(c);
  check('reopened, nothing moves', [rowOf(again, 'Alchemy').dc, rowOf(again, 'Alchemy').skillDCs[0].dc,
    again.diffFromSource()], [row.dc, row.skillDCs[0].dc, []]);
  check('the skill DCs are worked out, not saved',
    JSON.stringify(c.toJSON()).includes('skillDCs'), false);
}

console.log('\nthe table lists the skill DCs under the sphere');
{
  const c = practitioner([['Alchemy', 'Alchemy sphere (formulae)']]);
  const html = renderMartialPanel(c);
  check('the line is there', html.includes('Formulae and poison: DC '), true);
  check('it says which ranks it uses', html.includes('This DC uses ranks in Craft (alchemy) in place of BAB.'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
