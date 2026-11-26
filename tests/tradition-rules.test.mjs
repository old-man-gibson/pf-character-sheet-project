/** Tests for the casting tradition's spell points and essence: the tradition
 *  table, levels in casting classes (gestalt and Advanced Magic Training),
 *  Expanded Essence Pool, the Veilweaving sphere's Essence Conversion cap,
 *  a veilweaver's base essence capacity, and the Casting numbers bonus boxes.
 *  Every character is built here.
 *  Run: node tests/tradition-rules.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import {
  baseEssenceCapacity, maxEssenceConversion, traditionBonus, traditionLevels, traditionSpend,
} from '../app/js/rules.js';
import * as combat from '../app/js/ui/panels/combat.js';
import * as subsystems from '../app/js/ui/panels/subsystems.js';
import { formulaPlace } from '../app/js/ui/formula-places.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const tableClass = (name) => ({
  name, hd: 8, bab: 0.75, babOverride: null, goodFort: false, goodRef: false, goodWill: true, skillRanks: 2,
  archetypes: '', levelsOverride: null, systems: [],
});
const castingClass = (name, { type = 'High', veilweaving = false } = {}) => ({
  name, type, talentsPerLevel: null, mod1: 'Int', mod2: null, classLevelsOverride: null,
  levels: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    talent: veilweaving && i === 0 ? 'Veilweaving Sphere' : null,
    sphere: veilweaving && i === 0 ? 'Veilweaving' : null,
    notes: null,
  })),
});

/**
 * A character from Planner rows (one array of class names per level, a name
 * per gestalt track), the classes among them that cast, and its tradition.
 */
function build({ rows, casters = [], amt = false, drawbacks = [], boons = [], weaver = '', veilweaving = false }) {
  const c = new Character(blankDocument({ name: 'Tradition check', level: 1 }));
  c.data.classes = [...new Set(rows.flat())].map(tableClass);
  c.data.progression.tracks = Math.max(...rows.map((r) => r.length));
  rows.forEach((r, i) => { c.data.progression.levels[i].classes = [...r]; });
  if (weaver) c.data.akashic.classes = [{ name: weaver, mod: 'Con', essenceCap: 0, bonusCap: 0 }];
  c.set('identity.level', rows.length);
  for (const name of casters) c.listAdd('training.magic.classes', castingClass(name, { veilweaving }));
  if (amt) c.set('training.magic.amt', true);
  for (const d of drawbacks) c.listAdd('training.magic.tradition.drawbacks', d);
  for (const b of boons) c.listAdd('training.magic.tradition.boughtOff', b);
  return c;
}
const rowsOf = (n, at) => Array.from({ length: n }, (_, i) => at(i + 1));
const NINE = ['Focus Casting', 'Magical Signs', 'Skilled Casting', 'Somatic Casting x2', 'Verbal Casting',
  'Anemic', 'Draining Casting', 'Material Casting'];

console.log('the tradition table');
{
  const at = (row) => [0, 1, 2, 3, 4, 5, 6, 9, 10, 20].map((L) => traditionBonus(row, L));
  check('row 1: +1, +1 per 6 levels', at(1), [1, 1, 1, 1, 1, 1, 2, 2, 2, 4]);
  check('row 2: +1, +1 per 3 levels', at(2), [1, 1, 1, 2, 2, 2, 3, 4, 4, 7]);
  check('row 3: +1 per odd level', at(3), [0, 1, 1, 2, 2, 3, 3, 5, 5, 10]);
  check('row 4: +1, +1 at 2, 3, 5, 6 ...', at(4), [1, 1, 2, 3, 3, 4, 5, 7, 7, 14]);
  check('row 5: +1 per level', at(5), [0, 1, 2, 3, 4, 5, 6, 9, 10, 20]);
  check('no drawbacks give nothing', traditionBonus(0, 20), 0);
  check('more than five read the fifth row', [traditionBonus(6, 10), traditionBonus(12, 10)], [10, 10]);
}

console.log('levels each half of the tradition reads');
{
  check('without Advanced Magic Training both read the casting levels',
    traditionLevels({ level: 10, castingLevels: 4, amt: false }), { sp: 4, essence: 4 });
  check('with it, every level for spell points and half the others for essence',
    traditionLevels({ level: 10, castingLevels: 1, amt: true }), { sp: 10, essence: 5 });
  check('half rounds down', traditionLevels({ level: 10, castingLevels: 3, amt: true }).essence, 3 + 3);
  check('minimum 1 when there is a non-casting level',
    traditionLevels({ level: 2, castingLevels: 1, amt: true }), { sp: 2, essence: 2 });
  check('nothing added when every level casts',
    traditionLevels({ level: 6, castingLevels: 6, amt: true }), { sp: 6, essence: 6 });
}

console.log('how the drawbacks are spent');
{
  check('nine drawbacks, one boon, five on Expanded Essence Pool',
    traditionSpend({ drawbacks: 9, boons: 1, essenceDrawbacks: 5, spLevels: 10, essenceLevels: 5 }),
    { left: 7, essenceDrawbacks: 5, spDrawbacks: 2, unused: 0, sp: 4, essence: 5 });
  check('Expanded Essence Pool takes at most five',
    traditionSpend({ drawbacks: 8, essenceDrawbacks: 7, spLevels: 10, essenceLevels: 10 }).essenceDrawbacks, 5);
  check('and no more than are left',
    traditionSpend({ drawbacks: 3, boons: 1, essenceDrawbacks: 5 }).essenceDrawbacks, 1);
  check('drawbacks past the fifth row give nothing',
    traditionSpend({ drawbacks: 8, spLevels: 10 }), { left: 8, essenceDrawbacks: 0, spDrawbacks: 8, unused: 3, sp: 10, essence: 0 });
  check('boons cannot take more than there are',
    traditionSpend({ drawbacks: 3, boons: 2, spLevels: 10 }).left, 0);
}

console.log('a gestalt with one casting level and Advanced Magic Training');
{
  // Samurai on one side; Kheshig on the other except a Wizard level at 2nd.
  // Nine drawbacks ("x2" counts two), one boon, five on Expanded Essence Pool.
  const c = build({
    rows: rowsOf(10, (l) => ['Samurai', l === 2 ? 'Wizard' : 'Kheshig']),
    casters: ['Wizard'], amt: true, drawbacks: NINE, boons: ['Deathful Magic'], weaver: 'Kheshig',
  });
  const m = () => c.data.training.magic;
  check('one level in a casting class', m().castingLevels, 1);
  check('spell points read every level, essence the Wizard level and half of nine', m().traditionLevels, { sp: 10, essence: 5 });
  check('seven left: five on Expanded Essence Pool by default for a veilweaver, two as spell points',
    [m().effectiveDrawbacks, m().essenceDrawbacks, m().spDrawbacks], [7, 5, 2]);
  check('row 2 at 10 levels is 4 spell points, row 5 at 5 levels is 5 essence',
    [m().traditionSP, m().traditionEssence], [4, 5]);
  check('the spell points are in the total', m().totalSP, m().classSP[0].sp + 4);
  check('the essence is the Essence Boon on the Akashic tab', c.data.akashic.calc.traditionBoon, 5);
  c.set('training.magic.amt', false);
  check('without Advanced Magic Training both read the one Wizard level',
    [m().traditionLevels, m().traditionSP, m().traditionEssence], [{ sp: 1, essence: 1 }, 1, 1]);
}

console.log('casting levels are counted per character level, and nothing is multiplied');
{
  const c = build({
    rows: rowsOf(10, () => ['Wizard', 'Incanter']), casters: ['Wizard', 'Incanter'],
    drawbacks: ['Verbal Casting', 'Somatic Casting', 'Focus Casting'],
  });
  const m = () => c.data.training.magic;
  check('two casting classes on two sides, ten levels', m().castingLevels, 10);
  check('no veils: nothing goes to essence by default', [m().essenceDrawbacks, m().spDrawbacks], [0, 3]);
  check('row 3 at 10 levels, once', [m().traditionSP, m().traditionEssence], [5, 0]);
  c.data.progression.levels.forEach((r, i) => { if (i >= 4) r.classes = ['Fighter', 'Incanter']; });
  c.data.classes.push(tableClass('Fighter'));
  c.recompute();
  check('the levels where either side casts', m().castingLevels, 10);
  c.data.progression.levels.forEach((r, i) => { if (i >= 4) r.classes = ['Fighter', 'Rogue']; });
  c.data.classes.push(tableClass('Rogue'));
  c.recompute();
  check('four once neither side casts past 4th', [m().castingLevels, m().traditionSP], [4, 2]);
}

console.log('past five, and before the character casts');
{
  const c = build({
    rows: rowsOf(6, () => ['Wizard']), casters: ['Wizard'],
    drawbacks: ['A', 'B', 'C', 'D', 'E', 'F x2'],
  });
  const m = () => c.data.training.magic;
  check('seven as spell points read row 5, two give nothing',
    [m().spDrawbacks, m().unusedDrawbacks, m().traditionSP], [7, 2, 6]);
  check('the panel says so', combat.renderMagicPanel(c).includes('2 drawbacks past the fifth give nothing.'), true);
  const later = build({
    rows: rowsOf(4, (l) => [l < 4 ? 'Fighter' : 'Wizard']), casters: ['Wizard'], drawbacks: ['A', 'B'],
  });
  later.set('identity.level', 3);
  check('no casting class level yet: no tradition', [later.data.training.magic.castingUnlocked,
    later.data.training.magic.traditionSP, later.data.training.magic.traditionEssence], [false, 0, 0]);
  later.set('identity.level', 4);
  check('the first Wizard level brings it: row 2 at one level', later.data.training.magic.traditionSP, 1);
}

console.log('the drawbacks on Expanded Essence Pool: blank, a number, a formula');
{
  const c = build({
    rows: rowsOf(10, () => ['Wizard']), casters: ['Wizard'], weaver: 'Wizard',
    drawbacks: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  });
  const m = () => c.data.training.magic;
  check('blank: five for a veilweaver', [m().essenceDrawbacksAuto, m().essenceDrawbacks, m().traditionEssence, m().traditionSP],
    [5, 5, 10, 4]);
  c.set('training.magic.tradition.essenceDrawbacks', 0);
  check('0: not taken, all seven as spell points', [m().traditionEssence, m().traditionSP, m().unusedDrawbacks], [0, 10, 2]);
  c.set('training.magic.tradition.essenceDrawbacks', 3);
  check('3: row 3 essence, row 4 spell points', [m().traditionEssence, m().traditionSP], [5, 7]);
  c.set('training.magic.tradition.essenceDrawbacks', 'floor(level / 4)');
  check('a formula', [m().essenceDrawbacksNum, m().essenceDrawbacks, m().traditionEssence], [2, 2, 4]);
  const row = c.audit().find((r) => r.id === 'tradition-essence-drawbacks');
  check('audited, with a place to go to', [row?.status, row?.value, row?.place, formulaPlace(c, row?.place)?.tab],
    ['ok', 2, 'essenceDrawbacks', 'magic']);
  check('the place is drawn on the tab',
    combat.renderMagicPanel(c).includes('data-set="training.magic.tradition.essenceDrawbacks"'), true);
  c.set('training.magic.tradition.essenceDrawbacks', 'no.such.name +');
  check('a broken formula is flagged and counts 0', [typeof m().essenceDrawbacksError, m().essenceDrawbacks], ['string', 0]);
  c.set('training.magic.tradition.essenceDrawbacks', 9);
  check('a number is clamped on the way in and kept as typed',
    [m().essenceDrawbacks, c.data.training.magic.tradition.essenceDrawbacks], [5, 9]);
  c.set('training.magic.tradition.essenceDrawbacks', null);
  c.data.akashic.classes = [];
  c.recompute();
  check('blank with no veils: none', [m().essenceDrawbacksAuto, m().traditionEssence], [0, 0]);
}

console.log('a saved split becomes the drawbacks on Expanded Essence Pool');
{
  const c = build({
    rows: rowsOf(10, () => ['Wizard']), casters: ['Wizard'], weaver: 'Wizard',
    drawbacks: NINE, boons: ['Deathful Magic'],
  });
  const doc = JSON.parse(JSON.stringify(c.toJSON()));
  doc.training.magic.tradition.boonSP = 2;
  doc.training.magic.traditionPools = [{ key: 'boons', steps: 7 }];
  doc.training.magic.castingClassCount = 1;
  const back = new Character(doc);
  const tr = back.data.training.magic.tradition;
  check('two as spell points of seven left: five on Expanded Essence Pool',
    [tr.essenceDrawbacks, 'boonSP' in tr, back.data.training.magic.essenceDrawbacks], [5, false, 5]);
  check('the old figures are dropped',
    ['traditionPools', 'castingClassCount', 'boonPoints', 'spTier', 'boons'].filter((k) => k in back.data.training.magic), []);
  const again = new Character(JSON.parse(JSON.stringify(back.toJSON())));
  check('and stay put on reopen', [again.data.training.magic.tradition.essenceDrawbacks,
    again.data.training.magic.traditionEssence], [5, back.data.training.magic.traditionEssence]);
  doc.training.magic.tradition.boonSP = 7;
  check('all seven as spell points: none on Expanded Essence Pool',
    new Character(doc).data.training.magic.tradition.essenceDrawbacks, 0);
}

console.log('Essence Conversion: the Veilweaving sphere only, up to its maximum');
{
  check('the maximum by caster level',
    [0, 1, 2, 3, 4, 10, 17, 19, 20, 21, 23].map(maxEssenceConversion), [0, 1, 3, 4, 6, 15, 25, 28, 30, 32, 36]);
  const c = build({ rows: rowsOf(4, () => ['Wizard']), casters: ['Wizard'], drawbacks: ['A', 'B'] });
  const k = () => c.data.akashic.calc;
  c.set('akashic.essence.spTemp', 2);
  check('without the sphere it is flagged, and the number kept',
    [k().tempWithoutSphere, k().temp, k().conversionMax], [true, 2, 0]);
  check('the panel says so', subsystems.akashicPanel(c, {}).includes('no Veilweaving sphere'), true);

  const v = build({
    rows: rowsOf(4, () => ['Wizard']), casters: ['Wizard'], veilweaving: true, drawbacks: ['A', 'B'],
    weaver: 'Wizard',
  });
  const vk = () => v.data.akashic.calc;
  const essence = v.data.training.magic.traditionEssence;
  check('with it, the maximum at caster level 4 less the Essence Boon',
    [vk().veilweavingCL, vk().conversionMax], [4, Math.max(0, 6 - essence)]);
  v.set('akashic.essence.spTemp', vk().conversionMax);
  check('up to the maximum is fine', [vk().tempWithoutSphere, vk().tempOver], [false, 0]);
  v.set('akashic.essence.spTemp', vk().conversionMax + 2);
  check('past it is flagged, and the number kept', [vk().tempOver, vk().temp], [2, vk().conversionMax + 2]);
  check('the panel says so', subsystems.akashicPanel(v, {}).includes('2 over the maximum'), true);
  v.set('akashic.essence.boon', 9);
  check('a typed Essence Boon past the maximum leaves nothing to convert', vk().conversionMax, 0);
}

console.log('a veilweaver has the base essence capacity');
{
  check('1, and 1 more at 6th, 12th and 18th', [1, 5, 6, 12, 18, 20, 25].map(baseEssenceCapacity), [1, 1, 2, 3, 4, 4, 4]);
  const c = build({ rows: rowsOf(12, () => ['Kheshig']), weaver: 'Kheshig' });
  const k = () => c.data.akashic.calc;
  check('a class with no Ess. of its own, no sphere', [k().baseCap, c.data.akashic.classes[0].totalCap, k().totalCap], [3, 3, 3]);
  c.setItem('akashic.classes', 0, 'essenceCap', 5);
  check('a class with a higher one keeps it', k().totalCap, 5);

  c.setItem('akashic.classes', 0, 'essenceCap', null);
  const html = subsystems.akashicPanel(c, {});
  const box = /<input[^>]*data-item="akashic\.classes\|0\|essenceCap"[^>]*>/.exec(html)?.[0] || '';
  check('the Ess. box shows the base capacity until a number is typed',
    [/placeholder="3"/.test(box), /value=""/.test(box), box.includes('plus 1 per 6 character levels')], [true, true, true]);
  check('a cleared Ess. box is the base capacity again', k().totalCap, 3);
  const pick = /<select data-item="akashic\.classes\|0\|name"[^>]*>[\s\S]*?<\/select>/.exec(html)?.[0] || '';
  check('the class is picked from the classes on the sheet', pick.includes('<option value="Kheshig" selected'), true);
  c.setItem('akashic.classes', 0, 'name', 'Old Name');
  check('a name not on the sheet is kept and marked',
    subsystems.akashicPanel(c, {}).includes('<option value="Old Name" selected>Old Name *</option>'), true);
}

console.log('the Casting numbers bonuses take a number or a formula');
{
  const c = build({ rows: rowsOf(8, () => ['Wizard']), casters: ['Wizard'] });
  const m = () => c.data.training.magic;
  const saved = () => Object.keys(JSON.parse(JSON.stringify(c.toJSON())).training.magic).sort();
  const keys = saved();
  const [cl, dc, msb, totalSP] = [m().globalCL, m().globalDC, m().msb, m().totalSP];
  c.set('training.magic.clBonus', 1);
  check('a number adds as before', m().globalCL, cl + 1);
  check('and saves nothing beside it', saved(), keys);
  c.set('training.magic.clBonus', 'floor(level / 4)');
  c.set('training.magic.dcBonus', '1 + 1');
  c.set('training.magic.msbBonus', 'floor(level / 8)');
  c.set('training.magic.msdBonus', '3');
  c.set('training.magic.bonusSP', 'level');
  check('each formula is worked out', ['clBonus', 'dcBonus', 'msbBonus', 'msdBonus', 'bonusSP'].map((k) => m()[`${k}Num`]),
    [2, 2, 1, 3, 8]);
  check('and added where its number would be', [m().globalCL, m().globalDC, m().msb, m().msd, m().totalSP],
    [cl + 2, dc - Math.floor(cl / 2) + Math.floor((cl + 2) / 2) + 2, msb + 1, msb + 1 + 11 + 3, totalSP + 8]);
  const rows = c.audit().filter((r) => r.id.startsWith('magic-'));
  check('each is audited, with a place on the Magic Spheres tab',
    rows.map((r) => [r.name, r.status, r.value, formulaPlace(c, r.place)?.tab]),
    [['CL bonus', 'ok', 2, 'magic'], ['DC bonus', 'ok', 2, 'magic'], ['MSB bonus', 'ok', 1, 'magic'],
      ['MSD bonus', 'ok', 3, 'magic'], ['Bonus SP', 'ok', 8, 'magic']]);
  const html = combat.renderMagicPanel(c);
  const box = (k) => {
    const at = html.indexOf(`data-set="training.magic.${k}"`);
    return at < 0 ? '' : html.slice(html.lastIndexOf('<span class="xf', at), html.indexOf('</span>', at) + 7);
  };
  check('the boxes are formula boxes showing what they come to',
    ['clBonus', 'bonusSP'].map((k) => [/data-kind="expr"/.test(box(k)), /class="xf-view"[^>]*>(\d+)</.exec(box(k))?.[1]]),
    [[true, '2'], [true, '8']]);
  check('no number spinners left on the panel', /type="number"[^>]*data-set="training\.magic\./.test(html), false);
  c.set('training.magic.msdBonus', 'no.such.name +');
  check('a broken formula is flagged and counts 0', [typeof m().msdBonusError, m().msd], ['string', m().msb + 11]);
  c.set('training.magic.bonusSP', 2);
  check('a number again leaves nothing beside it', ['bonusSPNum' in m(), m().totalSP], [false, totalSP + 2]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
