/** Pools a class grants that the sheet works out from the class itself:
 *  a veilweaving class's essence, read off its pack's class table, and the
 *  power points of a psionic class run at a level other than its manifester
 *  level (a simple class template: points at half Hit Dice, manifesting at
 *  its Hit Dice).
 *
 *  Run: node tests/class-pools.test.mjs */
import { readFileSync } from 'node:fs';
import {
  Character, setClassEssenceTables, classEssenceTable, essenceAtLevel, setPsionicTables, psionicPoints,
} from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';
import {
  EXTENSION_FORMAT, essenceTableFromText, essenceTablesFromTables, normalizeExtension,
} from '../app/js/extensions.js';
import { publishDocument } from '../app/js/publish.js';
import { formulaPlace, selectorAttribute } from '../app/js/ui/formula-places.js';
import * as subsystems from '../app/js/ui/panels/subsystems.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const htmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Does the tab a Formulas row goes to draw the field it names? */
const placeDrawn = (model, place, draw) => {
  const entry = formulaPlace(model, place);
  if (!entry) return false;
  const html = draw(model);
  return (entry.sel || []).some((sel) => (selectorAttribute(sel) || [])
    .every(({ name, value }) => html.includes(`${name}="${htmlEscape(value)}"`)));
};
const reopen = (c) => new Character(JSON.parse(JSON.stringify(c.toJSON())));

// An invented veilweaving class and its table, both shapes a page writes.
const PIPE_PAGE = [
  'Shardweavers bind light into glass.',
  '',
  '| Level | Base Attack Bonus | Special | Veils | Essence Capacity | Essence |',
  '| 1st | +0 | Shard sight | 1 | 1 | 1 |',
  '| 2nd | +1 | — | 1 | 1 | 2 |',
  '| 3rd | +2 | Glass bind | 2 | 1 | 4* |',
  '| 4th | +3 | — | 2 | 2 | +5 |',
].join('\n');
const TAB_PAGE = [
  'Class Features',
  'Level\tBase Attack Bonus\tFort Save\tSpecial\tVeils\tEssence',
  '1st\t+0\t+2\tShard sight\t1\t—',
  '2nd\t+1\t+3\tGlass bind\t2\t2',
  '3rd\t+2\t+3\t—\t2\t3',
].join('\n');

console.log('a class table\'s Essence column is read, pipe or tab separated');
{
  const pipe = essenceTableFromText('Shardweaver', PIPE_PAGE);
  check('the Essence column, not Essence Capacity, by class level', pipe.essence.slice(0, 5), [1, 2, 4, 5, null]);
  check('twenty levels, named', [pipe.name, pipe.essence.length], ['Shardweaver', 20]);
  const tab = essenceTableFromText('Glasswright', TAB_PAGE);
  check('a tab-separated table reads the same, a dash is no entry', tab.essence.slice(0, 4), [null, 2, 3, null]);
  check('a page with no Essence column has none',
    essenceTableFromText('Plain', '| Level | Special | Essence Capacity |\n| 1st | Shard sight | 1 |'), null);
  check('a level with no row takes the row before it, and below the first is 0',
    [essenceAtLevel(tab.essence, 1), essenceAtLevel(tab.essence, 3), essenceAtLevel(tab.essence, 9), essenceAtLevel(pipe.essence, 0)],
    [0, 3, 3, 0]);
  const pack = (id, page) => normalizeExtension({ format: EXTENSION_FORMAT, formatVersion: 1, id, name: id,
    provides: { catalogues: { catalogues: [{ kind: 'class', entries: [{ name: 'Shardweaver', fields: [], text: page }] }] } } });
  const read = essenceTablesFromTables({ catalogues: pack('a', PIPE_PAGE).provides.catalogues });
  check('a catalogue pack\'s class pages give one table per class', read.map((t) => [t.name, t.essence[2]]), [['Shardweaver', 4]]);
}

console.log('the packs register their essence tables, and a later pack wins');
{
  const { registerPacks } = await import('../app/js/extension-runtime.js');
  const pack = (id, page) => normalizeExtension({ format: EXTENSION_FORMAT, formatVersion: 1, id, name: id,
    provides: { catalogues: { catalogues: [{ kind: 'class', entries: [{ name: 'Shardweaver', fields: [], text: page }] }] } } });
  registerPacks([pack('a', PIPE_PAGE)]);
  check('registered by class name, case aside', classEssenceTable('shardweaver')?.essence.slice(0, 2), [1, 2]);
  registerPacks([pack('a', PIPE_PAGE), pack('b', PIPE_PAGE.replace('| 1st | +0 | Shard sight | 1 | 1 | 1 |', '| 1st | +0 | Shard sight | 1 | 1 | 7 |'))]);
  check('the later pack\'s table stands', classEssenceTable('Shardweaver').essence[0], 7);
  registerPacks([]);
  check('and none with no packs', classEssenceTable('Shardweaver'), null);
}

/** A level-10 character with these classes on its Classes table, by levels. */
function weaver(levels, level = 10) {
  const c = new Character(blankDocument({ name: 'Weaver', level }));
  c.data.classes = Object.entries(levels).map(([name, n]) => ({
    name, hd: 8, bab: 0.75, goodFort: false, goodRef: false, goodWill: true, skillRanks: 4, levelsOverride: n,
  }));
  c.recompute();
  return c;
}

const ESSENCE = [
  { name: 'Shardweaver', essence: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30] },
  { name: 'Glasswright', essence: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10] },
];

console.log('a veilweaving class row adds its essence to the pool');
{
  setClassEssenceTables(ESSENCE);
  const c = weaver({ Shardweaver: 6 });
  c.listAdd('akashic.classes', { name: 'Shardweaver', mod: 'Int', levelOverride: null, essenceCap: 2, bonusCap: 0, added: true });
  const a = () => c.data.akashic;
  const row = () => a().classes[0];
  check('blank takes the table at the class level', [row().essenceAuto, row().essenceNum, row().essence ?? null], [6, 6, null]);
  check('the sources and a blank pool include it', [a().calc.classEssence, a().calc.sources, a().calc.pool], [6, 6, 6]);
  c.set('akashic.essence.featTraits', 2);
  check('beside the other sources', [a().calc.sources, a().calc.pool], [8, 8]);
  check('the formula name class.<name>.essence reads it', c.scope().class.shardweaver.essence, 6);

  c.setItem('akashic.classes', 0, 'essence', 'level + 1');
  check('a formula typed in the cell stands', [row().essenceNum, row().essenceError, a().calc.pool], [11, null, 13]);
  c.setItem('akashic.classes', 0, 'essence', 0);
  check('a typed 0 is 0, not blank', [row().essenceNum, a().calc.pool], [0, 2]);
  c.setItem('akashic.classes', 0, 'essence', 'class.shardweaver.essence + 1');
  check('in the cell a class\'s essence reads 0, so it does not climb', [row().essenceNum, reopen(c).data.akashic.classes[0].essenceNum], [1, 1]);
  c.setItem('akashic.classes', 0, 'essence', 'nope +');
  check('a formula that fails is 0 and says why', [row().essenceNum, !!row().essenceError], [0, true]);
  c.setItem('akashic.classes', 0, 'essence', null);

  c.set('akashic.essence.pool', 'class.shardweaver.essence * 2');
  check('a pool formula reads this pass\'s class essence', a().calc.pool, 12);
  c.set('akashic.essence.pool', 20);
  check('a typed pool stands and is checked against the sources', [a().calc.pool, a().calc.sources, a().calc.sourcesShort], [20, 8, -12]);
  c.set('akashic.essence.pool', null);

  c.setItem('akashic.classes', 0, 'levelOverride', 9);
  check('a pinned level reads the table there', row().essenceNum, 9);
  c.setItem('akashic.classes', 0, 'levelOverride', null);

  const saved = JSON.parse(JSON.stringify(c.toJSON()));
  check('the worked-out figures are not saved',
    ['essenceAuto', 'essenceNum', 'essenceError', 'essenceLevel'].filter((k) => k in saved.akashic.classes[0]), []);
  const back = new Character(saved);
  check('and reopening gives the same pool', back.data.akashic.calc.pool, a().calc.pool);
}

console.log('two gestalt veilweaving classes add their essence');
{
  setClassEssenceTables(ESSENCE);
  const c = weaver({ Shardweaver: 10, Glasswright: 10 });
  c.listAdd('akashic.classes', { name: 'Shardweaver', mod: 'Int', levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
  c.listAdd('akashic.classes', { name: 'Glasswright', mod: 'Wis', levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
  const a = c.data.akashic;
  check('each row at its own level, both in the pool', [a.classes[0].essenceNum, a.classes[1].essenceNum, a.calc.pool], [10, 5, 15]);
  c.listAdd('akashic.classes', { name: 'Fighter', mod: null, levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
  check('a class with no Essence column adds 0', [c.data.akashic.classes[2].essenceNum, c.data.akashic.calc.pool], [0, 15]);
}

console.log('with the Veilweaving sphere, a class\'s essence still reads its own levels');
{
  setClassEssenceTables(ESSENCE);
  const c = weaver({ Shardweaver: 4, Incanter: 10 });
  c.listAdd('akashic.classes', { name: 'Shardweaver', mod: 'Int', levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
  c.listAdd('training.magic.classes', {
    name: 'Incanter', type: 'High', talentsPerLevel: null, mod1: 'Int', mod2: null, classLevelsOverride: 10,
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, talent: i === 0 ? 'Veilweaving Sphere' : null, sphere: i === 0 ? 'Veilweaving' : null, notes: null })),
  });
  const row = c.data.akashic.classes[0];
  check('veilweaving level 10, essence at class level 4', [row.level, row.essenceNum], [10, 4]);
}

console.log('the class essence cell is on the Formulas tab and goes back to its row');
{
  setClassEssenceTables(ESSENCE);
  const c = weaver({ Shardweaver: 6 });
  c.listAdd('akashic.classes', { name: 'Shardweaver', mod: 'Int', levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
  c.setItem('akashic.classes', 0, 'essence', 'floor(level / 2)');
  const row = c.audit().find((r) => r.id === 'essence-class-0');
  check('listed, worked out', [row?.name, row?.value, row?.status, row?.place], ['Shardweaver essence', 5, 'ok', 'essenceClass:0']);
  check('its place is drawn on the Akashic tab', placeDrawn(c, 'essenceClass:0', (m) => subsystems.akashicPanel(m, {})), true);
  const html = subsystems.akashicPanel(c, {});
  check('the panel has the Essence cell and the class total',
    [html.includes('data-item="akashic.classes|0|essence"'), html.includes('Class essence')], [true, true]);
}

console.log('a published sheet cites the essence table for a reader with no pack');
{
  setClassEssenceTables(ESSENCE);
  const c = weaver({ Shardweaver: 6 });
  c.listAdd('akashic.classes', { name: 'Shardweaver', mod: 'Int', levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
  const { doc } = publishDocument(c.toJSON());
  check('the row carries the table', doc.akashic.classes[0].cited?.essence?.slice(0, 3), [1, 2, 3]);
  setClassEssenceTables([]);
  const reader = new Character(doc);
  check('and the reader without the pack gets the same pool', [reader.data.akashic.classes[0].essenceNum, reader.data.akashic.calc.pool], [6, 6]);
  check('the player\'s own sheet without the pack has 0', c.recompute().data.akashic.calc.pool, 0);
}
setClassEssenceTables([]);

// ---------------------------------------------------------------- psionics
setPsionicTables(JSON.parse(readFileSync('data/extensions/psionic-manifesting-tables.json', 'utf8')).provides.psionics);

/** A level-14 character with Int 18 and no Planner levels of any manifesting class. */
function template() {
  const c = new Character(blankDocument({ name: 'Templated', level: 14 }));
  c.set('statsBuild.int.untyped', (Number(c.data.statsBuild.int.untyped) || 0) + (18 - c.data.abilities.int.tempScore));
  return c;
}

console.log('power points can run at a level other than the manifester level');
{
  const c = template();
  c.listAdd('psionics.classes', {
    name: 'Psion', stat: 'Int', stat2: '', curveTotal: 343, manifesterLevelOverride: null, pointsLevelOverride: null, powers: [],
  });
  const p = () => c.data.psionics.classes[0];
  check('no levels and nothing typed: no points', [p().manifesterLevel, p().pointsLevel, p().points], [0, 0, 0]);

  c.set('psionics.classes.0.manifesterLevelOverride', 'level');
  c.set('psionics.classes.0.pointsLevelOverride', 'floor(level / 2)');
  check('a template: manifester level from Hit Dice, points as a psion of half',
    [p().manifesterLevel, p().pointsLevel, p().basePoints, p().abilityPoints, p().points],
    [14, 7, psionicPoints(343, 7), 14, psionicPoints(343, 7) + 14]);
  check('the pool is those points', c.data.psionics.pool, psionicPoints(343, 7) + 14);

  c.set('psionics.classes.0.pointsLevelOverride', 3);
  check('a typed number is the level', [p().pointsLevel, p().basePoints, p().abilityPoints], [3, psionicPoints(343, 3), 6]);
  c.set('psionics.classes.0.pointsLevelOverride', null);
  check('blank follows the manifester level, as before', [p().pointsLevel, p().basePoints], [14, psionicPoints(343, 14)]);
  c.set('psionics.classes.0.pointsLevelOverride', 'nope +');
  check('a formula that fails follows the manifester level and says why', [p().pointsLevel, !!p().pointsLevelError], [14, true]);
  c.set('psionics.classes.0.pointsLevelOverride', 'floor(manifester.psion.level / 2)');
  c.listAdd('notes', { title: 'Item', body: '{manifester.psion.level += 2}' });
  check('a bonus to the manifester level is read by the box, not by blank',
    [p().manifesterLevel, p().pointsLevel], [16, 8]);
  c.set('psionics.classes.0.pointsLevelOverride', null);
  check('blank still reads the level before the bonus', [p().manifesterLevel, p().pointsLevel], [16, 14]);
  c.set('psionics.classes.0.pointsLevelOverride', 'floor(level / 2)');

  const saved = JSON.parse(JSON.stringify(c.toJSON()));
  check('the box is saved, its figure is not',
    [saved.psionics.classes[0].pointsLevelOverride, 'pointsLevel' in saved.psionics.classes[0], 'pointsLevelError' in saved.psionics.classes[0]],
    ['floor(level / 2)', false, false]);
  check('reopening gives the same pool', new Character(saved).data.psionics.pool, c.data.psionics.pool);

  const row = c.audit().find((r) => r.id === 'psionic-0-points-level');
  check('the box is on the Formulas tab', [row?.name, row?.value, row?.status, row?.place],
    ['Psion power points level', 7, 'ok', 'psionicPointsLevel:0']);
  check('and goes back to the box', placeDrawn(c, 'psionicPointsLevel:0', (m) => subsystems.psionicsPanel(m, {})), true);
}

console.log('a class with Planner levels and a blank box does not move');
{
  const c = template();
  c.data.classes = [{ name: 'Psion', hd: 6, bab: 0.5, goodFort: false, goodRef: false, goodWill: true, skillRanks: 2, levelsOverride: 9 }];
  c.listAdd('psionics.classes', { name: 'Psion', stat: 'Int', stat2: '', curveTotal: 343, manifesterLevelOverride: null, powers: [] });
  const p = c.data.psionics.classes[0];
  check('points at the class level', [p.manifesterLevel, p.pointsLevel, p.basePoints, p.abilityPoints], [9, 9, psionicPoints(343, 9), 18]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
