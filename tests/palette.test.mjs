/** Tests the search palette's two halves: the index it builds from a
 *  character, and the scoring that answers a query out of it.
 *
 *  Both are plain data -- `app/js/ui/palette.js` takes a model and returns
 *  rows, and takes rows and returns rows -- so unlike the rest of `app/js/ui/`
 *  it runs in Node with no DOM at all. What is *not* covered here is the
 *  element's half: opening the dialog, arrowing the list, and landing the jump
 *  live in sheet-element.js and still have to be looked at in a browser.
 *
 *  Runs in full without the private fixtures: the character it asks most of
 *  its questions of is built from `blankDocument` and filled in here, so the
 *  expected answers are in this file rather than in a workbook. The roster,
 *  when there is one, is then swept for rows that come out malformed.
 *
 *  Run: node tests/palette.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { buildIndex, searchIndex, kindLabel } from '../app/js/ui/palette.js';
import { hasFixtures, fixtureIds, loadCharacter } from './fixtures.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, actual) => check(label, !!actual, true);

/** The tab list the element passes in, as far as these tests care. */
const TABS = [
  ['overview', 'Overview'], ['stats', 'Stats'], ['skills', 'Skills'],
  ['combat', 'Spheres & Magic'], ['features', 'Feats & Mythic'], ['gear', 'Equipment'],
  ['akashic', 'Akashic'], ['maneuvers', 'Maneuvers'], ['vancian', 'Vancian'],
  ['psionics', 'Psionics'], ['trackers', 'Trackers'], ['progression', 'Progression'],
  ['lore', 'Lore'], ['extras', 'Extras & Notes'],
].map(([id, label]) => ({ key: id, id, label, kind: 'core', inUse: true }));

const index = (model) => buildIndex(model, { tabs: TABS });
const titles = (rows) => rows.map((r) => r.title);
const first = (rows) => rows[0] || null;
const find = (rows, title) => rows.find((r) => r.title === title) || null;

/** A character with something on most of the tabs the palette reads. */
function sampleCharacter() {
  const doc = blankDocument('palette-test');
  const model = new Character(doc);
  const d = model.data;
  d.identity.name = 'Vela Thorn';
  d.identity.level = 8;
  d.identity.race = 'Half-Elf';
  d.classes[0] = {
    ...d.classes[0], name: 'Incanter', hd: 8, archetypes: 'Veilweaver', gestaltLevels: 8,
  };
  const disguise = d.skills.find((s) => s.name === 'Disguise');
  disguise.rankSources.bought = 5;
  disguise.classSkill = true;
  d.equipment.weapons[0] = {
    ...d.equipment.weapons[0], name: 'Moonlit Glaive', dice: '1d10', attackType: 'Melee',
    damageAbility: 'Str', critRange: 20, critMult: 'x3',
  };
  d.featGroups = [{ name: 'Level Up', entries: [{ name: 'Blind-Fight', detail: 3 }] }];
  d.akashic.slots = [{ slot: 'Head', bound: false, twinveil: false, veils: [{ name: 'Iron Crown', desc: 'Authority', essence: 2, dc: 19 }] }];
  d.customTrackers = [{
    id: 't1', name: 'Bardic Performance', max: 14, min: 0, current: 3, refresh: 'Daily',
    note: '', style: null, maxFormula: '14', minFormula: null,
  }];
  d.notes = [{ title: 'Debts', body: 'Owes the harbourmaster forty gold.' }];
  model.recompute();
  return model;
}

const model = sampleCharacter();
const rows = index(model);

console.log('the index holds what is on the character');
ok('it is not empty', rows.length > 20);
ok('the skill is there', find(rows, 'Disguise'));
ok('the weapon is there', find(rows, 'Moonlit Glaive'));
ok('the feat is there', find(rows, 'Blind-Fight'));
ok('the veil is there', find(rows, 'Iron Crown'));
ok('the tracker is there', find(rows, 'Bardic Performance'));
ok('the note is there', find(rows, 'Debts'));
ok('the class is there', find(rows, 'Incanter'));
ok('the archetype is a row of its own', find(rows, 'Veilweaver'));
check('every row has a title', rows.filter((r) => !r.title.trim()).length, 0);
check('every row has a kind with a label', rows.filter((r) => !kindLabel(r.kind)).length, 0);
check('no row shows a stringified object',
  rows.filter((r) => `${r.title} ${r.sub} ${r.value}`.includes('[object')), []);
check('ids are unique enough to remember a pick by',
  rows.length - new Set(rows.map((r) => r.id)).size < rows.length * 0.05, true);

console.log('a row knows where it lives and what it is worth');
check('the skill names its tab', find(rows, 'Disguise').where, 'Skills');
// 5 ranks bought, +3 for the class skill, and a Charisma of 10 on a blank
// sheet: the palette shows what the Skills tab shows.
check('the skill carries its total', find(rows, 'Disguise').value, '+8');
check('the skill can be rolled', find(rows, 'Disguise').roll.kind, 'skill');
check('the weapon can be rolled', find(rows, 'Moonlit Glaive').roll.kind, 'weapon');
check('the tracker shows current over max', find(rows, 'Bardic Performance').value, '3/14');
check('the feat says which group it is in', find(rows, 'Blind-Fight').sub, 'Level Up · level 3');
// The DC is the veilweaver's base plus the essence invested, recomputed --
// so it is 2 here rather than the 19 the row was written with, and the point
// of the check is that the row says chakra, DC and description in that order.
check('the veil says which chakra', find(rows, 'Iron Crown').sub, 'Head veil · DC 2 · Authority');
check('a feat is not rollable', find(rows, 'Blind-Fight').roll, null);
check('the skill points at its own row',
  find(rows, 'Disguise').sel[0].startsWith('[data-item^="skills|'), true);

console.log('the vitals lead, and are what an empty box opens on');
const opening = searchIndex(rows, '');
check('hit points first', first(opening.rows).title, 'Hit points');
ok('armour class is there too', find(opening.rows, 'Armor Class'));
ok('the tabs are offered', find(opening.rows, 'Equipment'));
ok('the commands are offered', find(opening.rows, 'Export JSON'));
ok('a skill is not', !find(opening.rows, 'Disguise'));
check('every opening row is one', opening.rows.every((r) => r.start), true);

console.log('what was picked last comes back to the top');
const withRecent = searchIndex(rows, '', { recent: [find(rows, 'Equipment').id] });
check('the recent pick leads', first(withRecent.rows).title, 'Equipment');
check('and is not repeated below', withRecent.rows.filter((r) => r.title === 'Equipment').length, 1);

console.log('searching: the obvious answer is the first one');
check('a whole word', first(searchIndex(rows, 'disguise').rows).title, 'Disguise');
check('a prefix', first(searchIndex(rows, 'disg').rows).title, 'Disguise');
check('the case does not matter', first(searchIndex(rows, 'DISGUISE').rows).title, 'Disguise');
check('a word inside the title', first(searchIndex(rows, 'crown').rows).title, 'Iron Crown');
check('two words, both of which must match', titles(searchIndex(rows, 'iron crown').rows), ['Iron Crown']);
check('an abbreviation', first(searchIndex(rows, 'blndf').rows).title, 'Blind-Fight');
check('a word from the subtitle finds it too',
  !!find(searchIndex(rows, 'harbourmaster').rows, 'Debts'), true);
check('nothing matches nothing', searchIndex(rows, 'zzzzqqq').total, 0);
check('a kind is searchable by name',
  searchIndex(rows, 'veil').rows.some((r) => r.kind === 'veil'), true);

console.log('and the answers that are only technically answers stay out');
const two = searchIndex(rows, 'ac');
ok('two letters do not fuzzy-match the whole sheet', two.total < rows.length * 0.4);
check('a two-letter query still finds the word itself',
  two.rows.some((r) => r.title.toLowerCase().includes('ac')), true);
const scattered = searchIndex(rows, 'ironc');
check('letters spread over half a title are not a match',
  scattered.rows.every((r) => /iron/i.test(r.title) || /iron/i.test(r.sub)), true);

console.log('the leader characters narrow it');
const commands = searchIndex(rows, '>');
check('> is commands only', commands.rows.every((r) => r.kind === 'command'), true);
ok('and there are some', commands.rows.length > 5);
check('> with a word narrows further',
  first(searchIndex(rows, '>export').rows).action, 'export');
const tabs = searchIndex(rows, '#');
check('# is tabs only', tabs.rows.every((r) => r.kind === 'tab'), true);
check('a tab is findable by its id as well as its name',
  first(searchIndex(rows, '#gear').rows).title, 'Equipment');

console.log('a command row runs rather than jumps');
const save = find(rows, 'Save this version');
check('it names an action', save.action, 'save');
check('it has nothing to find on a panel', save.find, null);
check('and no tab of its own to name', save.where, '');

console.log('the marks the list highlights with');
const marked = searchIndex(rows, 'crown');
check('the terms come back for the renderer', marked.terms, ['crown']);
check('and the query itself', marked.query, 'crown');

console.log('a jump knows how to get there');
const veil = find(rows, 'Iron Crown');
check('it names a tab', veil.tab, 'akashic');
check('and what to look for on it', veil.find, 'Iron Crown');
const progression = rows.filter((r) => r.kind === 'progression');
check('a progression cell brings its collapsed group with it',
  progression.every((r) => !!r.expand), true);

if (hasFixtures()) {
  console.log('\nthe roster, swept for rows that would not draw');
  for (const id of fixtureIds()) {
    const c = new Character(loadCharacter(id));
    const built = index(c);
    ok(`${id} has an index`, built.length > 40);
    check(`${id} every row has a title`, built.filter((r) => !r.title.trim()).length, 0);
    check(`${id} nothing stringified an object`,
      built.filter((r) => `${r.title} ${r.sub} ${r.value}`.includes('[object')).length, 0);
    check(`${id} every row names a tab that exists`,
      built.filter((r) => r.kind !== 'command' && !r.tab).length, 0);
    check(`${id} every roll names a kind roll20.js knows`,
      built.filter((r) => r.roll && !r.roll.kind).length, 0);
    // The palette is opened mid-sentence at a table: what it costs to build is
    // as much a feature as what it finds.
    const started = process.hrtime.bigint();
    index(c);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    ok(`${id} builds in under 50ms (${ms.toFixed(1)})`, ms < 50);
    // Every character answers the questions a table actually asks.
    for (const q of ['hp', 'init', 'perception', 'save']) {
      ok(`${id} finds something for "${q}"`, searchIndex(built, q).total > 0);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
