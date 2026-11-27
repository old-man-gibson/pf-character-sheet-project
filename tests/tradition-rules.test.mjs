/** Tests for the casting tradition's spell points and essence: the tradition
 *  table, levels in casting classes (gestalt and Advanced Magic Training),
 *  Expanded Essence Pool, the Veilweaving sphere's Essence Conversion cap,
 *  a veilweaver's base essence capacity, and the Casting numbers bonus boxes.
 *  Every character is built here.
 *  Run: node tests/tradition-rules.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import {
  baseEssenceCapacity, casterLevelTotal, castingPools, maxEssenceConversion, traditionBonus, traditionLevels, traditionSpend,
} from '../app/js/rules.js';
import * as combat from '../app/js/ui/panels/combat.js';
import * as subsystems from '../app/js/ui/panels/subsystems.js';
import { formulaPlace } from '../app/js/ui/formula-places.js';
import { blankTradition, idleTraditions } from '../app/js/model/traditions.js';
import { deckFeatNames } from '../app/js/model/subsystems/cardcasting.js';

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
    traditionLevels({ castingLevels: 4 }), { sp: 4, essence: 4 });
  check('with it, every level for spell points and half the others for essence',
    traditionLevels({ castingLevels: 1, otherLevels: 9 }), { sp: 10, essence: 5 });
  check('half rounds down', traditionLevels({ castingLevels: 3, otherLevels: 7 }).essence, 3 + 3);
  check('minimum 1 when there is a non-casting level',
    traditionLevels({ castingLevels: 1, otherLevels: 1 }), { sp: 2, essence: 2 });
  check('nothing added when every level casts', traditionLevels({ castingLevels: 6, otherLevels: 0 }), { sp: 6, essence: 6 });
  check('the mythic feat counts every other level for essence too',
    traditionLevels({ castingLevels: 1, otherLevels: 9, mythic: true }), { sp: 10, essence: 10 });
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
  check('spell points take up to five, and the rest stay uninvested',
    traditionSpend({ drawbacks: 8, spLevels: 10 }), { left: 8, essenceDrawbacks: 0, spDrawbacks: 5, unused: 3, sp: 10, essence: 0 });
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
  check('two pools: spell points read every level, essence the Wizard level and half of nine, then half of ten',
    m().traditionLevels, { sp: [10, 10], essence: [5, 5] });
  check('seven left, blank: five as spell points, two uninvested, none as essence',
    [m().effectiveDrawbacks, m().spDrawbacks, m().unusedDrawbacks, m().essenceDrawbacks, m().traditionSP, m().traditionEssence],
    [7, 5, 2, 0, 20, 0]);
  c.set('training.magic.tradition.essenceDrawbacks', 5);
  check('five typed on Expanded Essence Pool leave two as spell points', [m().essenceDrawbacks, m().spDrawbacks, m().unusedDrawbacks],
    [5, 2, 0]);
  check('row 2 at 10 levels is 4 spell points, row 5 at 5 levels is 5 essence, for each pool',
    [m().traditionSP, m().traditionEssence], [4 + 4, 5 + 5]);
  check('the spell points are in the total', m().totalSP, m().classSP[0].sp + 8);
  check('the essence is the Essence Boon on the Akashic tab', c.data.akashic.calc.traditionBoon, 10);
  c.set('training.magic.mythicAmt', true);
  check('Mythic AMT counts every level for essence', [m().traditionLevels.essence, m().traditionEssence], [[10, 10], 20]);
  check('and the panel says so', /Mythic AMT counts every level in other classes/.test(combat.renderMagicPanel(c)), true);
  c.set('training.magic.mythicAmt', false);
  c.set('campaign.gestalt', false);
  check('gestalt off: one pool', [m().traditionLevels, m().traditionSP, m().traditionEssence], [{ sp: [10], essence: [5] }, 4, 5]);
  c.set('campaign.gestalt', true);
  c.set('training.magic.amt', false);
  check('without Advanced Magic Training both read the one Wizard level',
    [m().traditionLevels, m().traditionSP, m().traditionEssence], [{ sp: [1], essence: [1] }, 1, 1]);
}

console.log('Advanced Magic Training with no casting class');
{
  // A gestalt Fighter // Barbarian: each side is a spell pool for the
  // tradition, with nothing else in it.
  // A third track still reads a workbook's "Class 3", which is no class:
  // the converter leaves it off the Classes table.
  const c = build({
    rows: rowsOf(20, () => ['Fighter', 'Barbarian', 'Class 3']), amt: true,
    drawbacks: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  });
  c.data.classes = c.data.classes.filter((x) => x.name !== 'Class 3');
  c.recompute();
  const m = () => c.data.training.magic;
  c.set('training.magic.tradition.essenceDrawbacks', 5);
  check('two pools of twenty levels: row 5 is 20 spell points each', [m().traditionLevels.sp, m().traditionSP], [[20, 20], 40]);
  check('essence reads half: row 5 at 10, each', [m().traditionLevels.essence, m().traditionEssence], [[10, 10], 20]);
  check('Low-Caster levels: caster level 10; every level counts for MSB',
    [m().castingUnlocked, m().globalCL, m().msb, m().msd], [true, 10, 20, 31]);
  check('the pool is the casting modifier, at least 1, with no casting class',
    m().classSP, [{ name: 'Advanced Magic Training', sp: 1 }]);
  c.set('training.magic.mythicAmt', true);
  check('with Mythic AMT, 40 spell points and 40 essence', [m().traditionSP, m().traditionEssence], [40, 40]);
  check('and Mid-Caster levels for caster level only', [m().globalCL, m().msb], [15, 20]);
  c.set('training.magic.amt', false);
  c.set('training.magic.mythicAmt', false);
  check('without it, nothing', [m().traditionSP, m().traditionEssence, m().castingUnlocked, m().globalCL, m().msb, m().classSP],
    [0, 0, false, 0, 0, []]);
}

console.log('caster level and MSB add up across classes');
{
  check('without gestalt, each class rounds down on its own, then they add',
    casterLevelTotal([...rowsOf(5, () => [{ key: 'f', rate: 0.5 }]), ...rowsOf(5, () => [{ key: 'r', rate: 0.5 }]),
      ...rowsOf(10, () => [{ key: 'w', rate: 1 }])]), 2 + 2 + 10);
  check('with gestalt, the better class at each level, rounded down once',
    casterLevelTotal(rowsOf(10, (l) => [{ key: 'f', rate: 0.5 }, { key: 'w', rate: l === 2 ? 1 : 0.75 }]), { gestalt: true }),
    Math.floor(1 + 9 * 0.75));
  check('a class counting as levels higher adds them at its rate',
    casterLevelTotal(rowsOf(5, () => [{ key: 'm', rate: 0.75 }]), { extra: [{ key: 'm', rate: 0.75, levels: 2 }] }), 5);

  // Gestalt off: Wizard 1-10, Fighter 11-20.
  const c = build({
    rows: rowsOf(20, (l) => [l <= 10 ? 'Wizard' : 'Fighter']), casters: ['Wizard'],
  });
  c.set('campaign.gestalt', false);
  const m = () => c.data.training.magic;
  check('Wizard 10 / Fighter 10: caster level and MSB are the Wizard levels', [m().globalCL, m().msb, m().msd], [10, 10, 21]);
  c.set('training.magic.amt', true);
  check('Advanced Magic Training adds the Fighter levels as a Low-Caster, and all of them to MSB', [m().globalCL, m().msb], [10 + 5, 20]);
  // The DC is 10 + half the caster level + the casting modifier.
  const castingMod = m().globalDC - 10 - Math.floor(m().globalCL / 2);
  check('concentration is MSB plus the casting modifier, not caster level', m().concentration, 20 + castingMod);
  c.set('training.magic.mythicAmt', true);
  check('Mythic AMT, as a Mid-Caster', [m().globalCL, m().msb], [10 + 7, 20]);
  check('a casting class level: no AMT spell pool line', m().classSP.map((x) => x.name), ['Wizard']);

  // Gestalt: Warlord with one Incanter level at 2nd // Kineticist.
  const g = build({
    rows: rowsOf(11, (l) => [l === 2 ? 'Incanter' : 'Warlord', 'Kineticist']), casters: ['Incanter'], amt: true,
  });
  const n = () => g.data.training.magic;
  check('gestalt: the Incanter level, then the better Low-Caster side at each other level', [n().globalCL, n().msb], [1 + 5, 11]);
  g.set('training.magic.amt', false);
  check('without it, the one Incanter level', [n().globalCL, n().msb], [1, 1]);
}

console.log('spell pools: each gestalt side that casts gets the spell points');
{
  const casting = (...n) => n.map((x) => ({ casting: x, other: 0 }));
  check('one pool per casting class present, by level', castingPools([2, 2, 2, 1, 1, 0], true), casting(5, 3));
  check('without gestalt, one pool', castingPools([2, 2, 2, 1, 1, 0], false), casting(5));
  check('no casting class level, no pool', [castingPools([0, 0], true), castingPools([], false)], [[], []]);
  check('other classes fill a pool where casting classes do not',
    castingPools([{ casting: 1, other: 1 }, { casting: 2, other: 0 }, { casting: 0, other: 2 }], true),
    [{ casting: 2, other: 1 }, { casting: 1, other: 2 }]);
  check('spell points and essence for each pool, at its own levels',
    traditionSpend({ drawbacks: 4, essenceDrawbacks: 1, spLevels: [10, 4], essenceLevels: [10, 4] }), {
      left: 4, essenceDrawbacks: 1, spDrawbacks: 3, unused: 0, sp: 5 + 2, essence: 2 + 1,
    });

  const c = build({
    rows: rowsOf(10, () => ['Wizard', 'Incanter']), casters: ['Wizard', 'Incanter'],
    drawbacks: ['Verbal Casting', 'Somatic Casting', 'Focus Casting'], weaver: 'Wizard',
  });
  const m = () => c.data.training.magic;
  check('two casting classes on two sides, ten levels', m().castingLevels, 10);
  check('two spell pools of ten levels', m().traditionLevels, { sp: [10, 10], essence: [10, 10] });
  check('nothing goes to essence by default', [m().essenceDrawbacks, m().spDrawbacks], [0, 3]);
  check('row 3 at 10 levels, for each pool', [m().traditionSP, m().traditionEssence], [10, 0]);
  check('the panel shows both pools on both sides',
    /Levels counted<\/th>\s*<td class="num">10 \+ 10<\/td><td class="num">10 \+ 10</.test(combat.renderMagicPanel(c)), true);
  c.set('training.magic.tradition.essenceDrawbacks', 1);
  check('essence is counted for each pool too', [m().traditionSP, m().traditionEssence], [2 * 4, 2 * 2]);
  c.set('training.magic.tradition.essenceDrawbacks', '');
  c.data.progression.levels.forEach((r, i) => { if (i >= 4) r.classes = ['Fighter', 'Incanter']; });
  c.data.classes.push(tableClass('Fighter'));
  c.recompute();
  check('the levels where either side casts', m().castingLevels, 10);
  check('the second pool has the four levels both sides cast', [m().traditionLevels.sp, m().traditionSP], [[10, 4], 5 + 2]);
  c.data.progression.levels.forEach((r, i) => { if (i >= 4) r.classes = ['Fighter', 'Rogue']; });
  c.data.classes.push(tableClass('Rogue'));
  c.recompute();
  check('four once neither side casts past 4th', [m().castingLevels, m().traditionSP], [4, 2 + 2]);
  c.set('campaign.gestalt', false);
  check('gestalt off: one pool', [m().traditionLevels.sp, m().traditionSP], [[4], 2]);
}

console.log('a tradition per casting class (campaign rule)');
{
  const c = build({
    rows: rowsOf(10, () => ['Wizard', 'Incanter']), casters: ['Wizard', 'Incanter'], drawbacks: ['A', 'B', 'C'], weaver: 'Wizard',
  });
  const m = () => c.data.training.magic;
  const sp = () => m().traditionResults.map((r) => r.traditionSP);
  check('one tradition, two pools: row 3 at 10 levels, twice', m().traditionSP, 10);
  c.listAdd('training.magic.extraTraditions', { ...blankTradition(), className: 'Incanter', drawbacks: ['D', 'E'] });
  check('rule off: the extra is kept but not counted', [m().traditionResults.length, m().traditionSP, idleTraditions(c.data)], [1, 10, 1]);
  check('and the panel says so', /1 more tradition is saved but not counted/.test(combat.renderMagicPanel(c)), true);
  check('the campaign rule starts off', c.data.campaign?.traditionPerClass ?? false, false);

  c.set('campaign.traditionPerClass', true);
  check('rule on: each tradition reads its own class', m().traditionResults.map((r) => r.covers), [['Wizard'], ['Incanter']]);
  check('each gives its own class spell points: row 3 at 10, row 2 at 10', sp(), [5, 4]);
  check('the total adds them', [m().traditionSP, m().totalSP], [9, m().classSP.reduce((n, x) => n + x.sp, 0) + 9]);
  check('the first tradition\'s figures stay on the side', [m().spDrawbacks, m().traditionLevels.sp], [3, [10]]);
  const html = combat.renderMagicPanel(c);
  check('a panel for the extra, with its class picker and its own essence box',
    ['Casting tradition 2', 'data-set="training.magic.extraTraditions.0.className"',
      'data-set="training.magic.extraTraditions.0.essenceDrawbacks"', 'Classes'].map((x) => html.includes(x)), [true, true, true, true]);
  check('the Casting numbers list each tradition\'s spell points', /Tradition 1 SP[\s\S]*Tradition 2 SP/.test(html), true);

  c.set('training.magic.extraTraditions.0.essenceDrawbacks', 1);
  c.set('training.magic.tradition.essenceDrawbacks', 2);
  check('essence from every tradition goes into the one pool: row 2 and row 1 at 10',
    [m().traditionEssence, c.data.akashic.calc.traditionBoon], [4 + 2, 4 + 2]);
  c.set('training.magic.extraTraditions.0.essenceDrawbacks', 'floor(level / 10)');
  const row = c.audit().find((r) => r.id === 'tradition-essence-drawbacks-2');
  check('an extra\'s essence formula is audited, with a place to go to',
    [row?.status, row?.value, formulaPlace(c, row?.place)?.tab], ['ok', 1, 'magic']);

  c.listAdd('training.magic.extraTraditions', { ...blankTradition(), className: 'Incanter', drawbacks: ['F'] });
  c.listAdd('training.magic.extraTraditions', blankTradition());
  check('a second for the same class, and one with no class, give nothing and say why',
    [sp().slice(2), m().traditionResults.slice(2).map((r) => r.waiting)], [[0, 0], ['taken', 'pick']]);
  c.listRemove('training.magic.extraTraditions', 2);
  c.listRemove('training.magic.extraTraditions', 1);

  c.listAdd('training.magic.extraTraditions.0.drawbacks', 'Terrain Casting');
  check('a drawback on an extra tradition is in force', c.terrainCasting(), true);
  c.listAdd('training.magic.extraTraditions.0.boughtOff', 'Card Shark [Deck]');
  check('and its boons count as feats', deckFeatNames(c.data), ['Card Shark [Deck]']);

  c.set('training.magic.amt', true);
  check('Advanced Magic Training is read by the first tradition only, and adds no level another tradition has',
    m().traditionResults.map((r) => r.traditionLevels.sp), [[10], [10]]);
  c.set('training.magic.amt', false);

  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('a reload gives the same', [back.data.training.magic.traditionSP, back.data.training.magic.traditionEssence],
    [m().traditionSP, m().traditionEssence]);

  c.set('campaign.traditionPerClass', false);
  check('rule off again: the first tradition covers both pools', [m().traditionResults.length, m().traditionSP], [1, 2 * traditionBonus(1, 10)]);
}

console.log('two blocks for one class count it once');
{
  // A workbook's level 21-40 page names a class again: an extended block
  // with no rows of its own, beside the class's own block.
  const c = build({
    rows: rowsOf(20, () => ['Monk', 'Kineticist', 'Wizard']), casters: ['Monk', 'Wizard'], drawbacks: ['A', 'B', 'C', 'D', 'E'],
  });
  c.listAdd('training.magic.classes', { ...castingClass('Wizard'), mod1: null, levels: [], extended: true });
  const m = () => c.data.training.magic;
  check('one spell point line per class', m().classSP.map((x) => x.name), ['Monk', 'Wizard']);
  check('two spell pools, not three', [m().traditionLevels.sp, m().traditionSP], [[20, 20], 40]);
  check('the tradition covers each class once', m().traditionResults[0].covers, ['Monk', 'Wizard']);
  c.set('training.magic.amt', true);
  check('Advanced Magic Training makes the Kineticist side a third pool', [m().traditionLevels.sp, m().traditionSP], [[20, 20, 20], 60]);
  c.set('training.magic.amt', false);
  c.set('campaign.traditionPerClass', true);
  c.listAdd('training.magic.extraTraditions', { ...blankTradition(), className: 'Wizard', drawbacks: ['F', 'G'] });
  check('a tradition for that class takes both blocks: row 5 and row 2 at 20',
    [m().traditionResults.map((r) => r.covers), m().traditionResults.map((r) => r.traditionSP)], [[['Monk'], ['Wizard']], [20, 7]]);
}

console.log('one casting class on each of two sides, in turn');
{
  // Wizard on one side for 5 levels, then Incanter on the other: one class
  // casts at each level, so there is one pool of ten.
  const c = build({
    rows: rowsOf(10, (l) => (l <= 5 ? ['Wizard', 'Fighter'] : ['Rogue', 'Incanter'])),
    casters: ['Wizard', 'Incanter'], drawbacks: ['A', 'B', 'C'],
  });
  const m = () => c.data.training.magic;
  check('one pool', [m().traditionLevels.sp, m().traditionSP], [[10], 5]);
}

console.log('past five, and before the character casts');
{
  const c = build({
    rows: rowsOf(6, () => ['Wizard']), casters: ['Wizard'],
    drawbacks: ['A', 'B', 'C', 'D', 'E', 'F x2'],
  });
  const m = () => c.data.training.magic;
  check('five of seven as spell points read row 5, two stay uninvested',
    [m().spDrawbacks, m().unusedDrawbacks, m().traditionSP], [5, 2, 6]);
  check('the panel says so', /Uninvested boons<\/span>\s*<span class="value ?">2</.test(combat.renderMagicPanel(c)), true);
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
  check('blank is 0, even for a veilweaver: five as spell points, two uninvested',
    [m().essenceDrawbacks, m().traditionEssence, m().traditionSP, m().unusedDrawbacks], [0, 0, 10, 2]);
  c.set('training.magic.tradition.essenceDrawbacks', 0);
  check('0 is the same', [m().traditionEssence, m().traditionSP, m().unusedDrawbacks], [0, 10, 2]);
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
  c.set('training.magic.tradition.essenceDrawbacks', 5);
  const html = combat.renderMagicPanel(c);
  const split = /<table class="build compact boonsplit">[\s\S]*?<\/table>/.exec(html)?.[0] || '';
  const cells = (label) => [...(new RegExp(`${label}</th>([\\s\\S]*?)</tr>`).exec(split)?.[1] || '')
    .matchAll(/<td[^>]*>([^<]*)</g)].map((x) => x[1].trim());
  check('the panel shows spell points and essence side by side',
    [cells('Drawbacks')[0], cells('Levels counted'), cells('Gives')], ['2', ['10', '10'], ['4', '10']]);
  check('with the essence box in the essence column',
    /As essence[\s\S]*data-set="training\.magic\.tradition\.essenceDrawbacks"/.test(split), true);
}

console.log('a saved split becomes the drawbacks on Expanded Essence Pool');
{
  const c = build({
    rows: rowsOf(10, () => ['Wizard']), casters: ['Wizard'], weaver: 'Wizard',
    drawbacks: NINE, boons: ['Deathful Magic'],
  });
  const doc = JSON.parse(JSON.stringify(c.toJSON()));
  doc.corrections = doc.corrections.filter((x) => x !== 'tradition-essence-split');
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

console.log('a sheet saved before a blank box meant 0 keeps the split it showed');
{
  const old = (opts) => {
    const doc = JSON.parse(JSON.stringify(build(opts).toJSON()));
    doc.corrections = doc.corrections.filter((x) => x !== 'tradition-essence-split');
    return doc;
  };
  const weaver = new Character(old({
    rows: rowsOf(10, () => ['Wizard']), casters: ['Wizard'], weaver: 'Wizard', drawbacks: NINE, boons: ['Deathful Magic'],
  }));
  const wm = weaver.data.training.magic;
  check('a veilweaver gets up to five written into the box',
    [wm.tradition.essenceDrawbacks, wm.essenceDrawbacks, wm.spDrawbacks], [5, 5, 2]);
  check('the sheet is marked, so it happens once', weaver.data.corrections.includes('tradition-essence-split'), true);
  weaver.set('training.magic.tradition.essenceDrawbacks', null);
  const reopened = new Character(JSON.parse(JSON.stringify(weaver.toJSON())));
  check('a box cleared after that stays 0 on reopen',
    [reopened.data.training.magic.tradition.essenceDrawbacks ?? null, reopened.data.training.magic.essenceDrawbacks], [null, 0]);
  const other = new Character(old({
    rows: rowsOf(10, () => ['Wizard']), casters: ['Wizard'], drawbacks: NINE,
  }));
  check('a character who weaves no veils keeps a blank box',
    [other.data.training.magic.tradition.essenceDrawbacks ?? null, other.data.training.magic.essenceDrawbacks], [null, 0]);
  const fresh = build({
    rows: rowsOf(10, () => ['Wizard']), casters: ['Wizard'], weaver: 'Wizard', drawbacks: NINE,
  });
  check('a new sheet starts at 0, veilweaver or not',
    [fresh.data.training.magic.tradition.essenceDrawbacks ?? null, fresh.data.training.magic.essenceDrawbacks], [null, 0]);
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
