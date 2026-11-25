/**
 * Path of War: initiator level, initiation modifier and maneuver save DCs.
 * Run: node tests/initiator.test.mjs
 */
import { blankDocument } from '../app/js/convert.js';
import {
  Character, initiatorClasses, isInitiatorClass, maneuverDc, maneuverDcText, setInitiatorClasses,
} from '../app/js/model.js';
import { initiatorClassesFromTables, maneuverTableFromText } from '../app/js/extensions.js';
import { FORMULA_FIELDS } from '../app/js/model/reconcile.js';
import { formulaPlace } from '../app/js/ui/formula-places.js';
import { targetGroups } from '../app/js/formula-guide.js';
import { maneuversPanel } from '../app/js/ui/panels/subsystems.js';
import { sessionShortcuts } from '../app/js/model/session.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else {
    fail++;
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n            got ${JSON.stringify(actual)}`);
  }
}

/** A blank character at `level` with these class rows, each pinned to its levels. */
function character(level, classes = []) {
  const c = new Character(blankDocument({ name: 'Initiator', level, maxLevel: Math.max(20, level) }));
  for (const [name, levels, extra] of classes) c.listAdd('classes', { name, levelsOverride: levels, ...extra });
  return c;
}
const init = (c) => c.data.maneuvers.calc.initiator;

console.log('which classes are initiator classes');
{
  check('marked with the Path of War system', isInitiatorClass({ name: 'Kineticist', systems: ['path-of-war'] }), true);
  check('named as a Path of War class, with or without an archetype',
    ['Warlord', 'warder', 'Stalker (Hunter)', 'Mystic', 'Harbinger', 'Zealot'].map((name) => isInitiatorClass({ name })), [true, true, true, true, true, true]);
  check('a name that only starts the same is not one', isInitiatorClass({ name: 'Mystic Theurge' }), false);
  check('nor is any other class', isInitiatorClass({ name: 'Wizard', systems: ['vancian'] }), false);
  check('in table order', initiatorClasses([{ name: 'Wizard' }, { name: 'Warder' }, { name: 'Brawler', systems: ['path-of-war'] }]).map((x) => x.name),
    ['Warder', 'Brawler']);
}

console.log('a pack marks a class as an initiator and names its modifier');
{
  const tables = {
    catalogues: {
      catalogues: [
        {
          kind: 'class',
          entries: [
            { name: 'Bladesong Adept', fields: [['Hit Die', 'd8'], ['System', 'Maneuver']], text: 'A bladesong adept\'s initiation modifier is Intelligence.' },
            { name: 'Grove Keeper', fields: [['System', 'Maneuver, Psionic']], text: 'Wisdom is the primary initiating attribute for grove keepers.' },
            { name: 'Plain Fighter', fields: [['System', 'Spell']], text: 'A plain fighter\'s initiation modifier is Charisma.' },
          ],
        },
        { kind: 'prestige class', entries: [{ name: 'Edge Walker', fields: [['System', 'Maneuver']], text: 'Uses his highest initiation modifier.' }] },
        { kind: 'feat', entries: [{ name: 'Not A Class', fields: [['System', 'Maneuver']], text: '' }] },
      ],
    },
  };
  const read = initiatorClassesFromTables(tables);
  check('classes and prestige classes whose System names Maneuver, with the stated ability',
    read, [{ name: 'Bladesong Adept', stat: 'Intelligence', table: null }, { name: 'Grove Keeper', stat: 'Wisdom', table: null }, { name: 'Edge Walker', stat: '', table: null }]);
  setInitiatorClasses(read);
  check('a class row of that name is an initiator class', [isInitiatorClass({ name: 'Bladesong Adept' }), isInitiatorClass({ name: 'Plain Fighter' })], [true, false]);

  const c = character(10, [['Bladesong Adept', 10]]);
  c.set('statsBuild.int.pointBuy', 18);
  c.set('statsBuild.cha.pointBuy', 14);
  const intMod = c.data.abilities.int.totalMod;
  const chaMod = c.data.abilities.cha.totalMod;
  check('blank modifier: the pack\'s ability for the class', [init(c).stat, init(c).statFrom, init(c).mod], ['Int', 'Bladesong Adept', intMod]);
  c.set('maneuvers.initiationStat', 'Cha');
  check('a picked ability stands instead', [init(c).stat, init(c).statFrom, init(c).mod], ['Cha', 'picked', chaMod]);
  c.set('maneuvers.initiationStat', '');
  check('blanked again, the pack\'s', init(c).stat, 'Int');
  setInitiatorClasses([]);
  check('with no pack, no modifier', [init(c.recompute()).stat, init(c).mod], ['', 0]);
}

console.log('initiator level: initiator class levels plus half the rest');
{
  check('no initiator class: half the character level', init(character(11)).level, 5);
  check('Warder 20 is initiator 20', init(character(20, [['Warder', 20]])).level, 20);
  // The FAQ's example, one class after the other.
  const c = character(20, [['Harbinger', 10], ['Wizard', 20]]);
  check('Harbinger 10 with ten other levels is initiator 15', [init(c).level, init(c).from], [15, 'Harbinger']);
  const two = character(20, [['Warlord', 12], ['Warder', 8]]);
  check('two initiator classes: each its own, the highest counts', [init(two).classes.map((x) => x.level), init(two).level, init(two).from], [[16, 14], 16, 'Warlord']);
  const tagged = character(24, [['Vizier', 20], ['Legendary Kineticist', 18, { systems: ['path-of-war'] }]]);
  check('a class marked Path of War counts, past 20th too', init(tagged).level, 21);
}

console.log('the level box, a number or a formula');
{
  const c = character(20, [['Harbinger', 10]]);
  c.set('maneuvers.initiatorLevelOverride', 7);
  check('a number stands instead', [init(c).base, init(c).level, init(c).counted], [7, 7, 15]);
  c.set('maneuvers.initiatorLevelOverride', 'initiator.level + 2');
  c.recompute(); c.recompute();
  check('a formula reads the worked-out level, and does not climb', [init(c).base, init(c).level, init(c).levelError], [17, 17, null]);
  c.set('maneuvers.initiatorLevelOverride', 'no.such.name +');
  check('one that does not work out follows the classes and says so', [init(c).level, typeof init(c).levelError], [15, 'string']);
  c.set('maneuvers.initiatorLevelOverride', null);
  check('blank follows the classes', [init(c).base, init(c).levelError], [15, null]);
}

console.log('bonuses sent to initiator.level and initiator.dc');
{
  const c = character(20, [['Harbinger', 10]]);
  c.set('formulaNotes', 'Feat {initiator.level += 2}');
  check('a bonus raises the level', [init(c).base, init(c).levelForwarded, init(c).level], [15, 2, 17]);
  c.set('formulaNotes', 'Feat {initiator.level += floor(target / 5)}');
  c.recompute(); c.recompute();
  check('target is the level before bonuses, and it holds still', init(c).level, 18);
  c.set('formulaNotes', 'Feat {initiator.level += 2} {reach = initiator.level * 5}');
  check('a name reading the level sees it raised', c.scope().reach, 85);
  c.set('formulaNotes', 'Mythic {initiator.dc += 2}');
  check('a bonus to every DC', [init(c).dcForwarded, init(c).dc], [2, init(c).dcBase + 2]);
  const names = c.forwardTargets().list.map((t) => t.name);
  check('both are places to send a bonus', ['initiator.level', 'initiator.dc'].every((n) => names.includes(n)), true);
  check('not listed for a character that does not use Path of War',
    targetGroups(c.forwardTargets().list).some((g) => g.key === 'maneuvers'), false);
  c.setItem('classes', 0, 'systems', ['path-of-war']);
  const groups = targetGroups(c.forwardTargets().list);
  check('listed under Path of War once a class is marked with it', groups.find((g) => g.key === 'maneuvers')?.items.map((x) => x.name), ['initiator.level', 'initiator.dc']);
  c.set('formulaNotes', '');
}

console.log('maneuver save DCs: 10 + level + initiation modifier + DC bonuses');
{
  const c = character(10, [['Warlord', 10]]);
  c.set('statsBuild.cha.pointBuy', 16);
  c.set('maneuvers.initiationStat', 'Cha');
  const mod = c.data.abilities.cha.totalMod;
  c.set('maneuvers.disciplines', [{
    name: 'Homebrew Way', known: ['Strike One', 'Strike Three'], readied: ['Strike One', 'Strike Three'],
    custom: [
      { level: 1, kind: 'maneuver', name: 'Strike One', type: 'Strike' },
      { level: 3, kind: 'maneuver', name: 'Strike Three', type: 'Strike' },
    ],
    notes: {},
  }]);
  const m = c.data.maneuvers;
  check('the DC a level adds to', init(c).dc, 10 + mod);
  check('each maneuver\'s DC', [maneuverDc(m, 1), maneuverDc(m, 3), maneuverDc(m, 0)], [11 + mod, 13 + mod, null]);
  check('the scope reads them', c.scope().initiator, { level: 10, mod, dc: 10 + mod });
  c.set('maneuvers.dcBonus', 'floor(level / 5)');
  check('the DC bonus box adds to every DC', [init(c).dcBonus, maneuverDc(m, 3)], [{ value: 2, error: null }, 15 + mod]);
  c.set('maneuvers.dcBonus', 'no.such.name +');
  check('one that does not work out adds nothing and says so', [maneuverDc(m, 3), typeof init(c).dcBonus.error], [13 + mod, 'string']);
  c.set('maneuvers.dcBonus', 1);
  check('a typed DC cell stands instead', [maneuverDcText(m, { dc: '19' }, 3), maneuverDcText(m, { dc: '' }, 3)], ['19', String(14 + mod)]);

  const html = maneuversPanel(c, {});
  check('the tab shows the three boxes', ['maneuvers.initiatorLevelOverride', 'maneuvers.initiationStat', 'maneuvers.dcBonus'].every((p) => html.includes(`data-set="${p}"`)), true);
  check('and each maneuver\'s DC', [html.includes(`DC ${12 + mod}`), html.includes(`DC ${14 + mod}`)], [true, true]);
  const cards = sessionShortcuts(c).filter((x) => x.kind === 'maneuver');
  check('a session card says the DC', cards.map((x) => x.save), [`DC ${12 + mod}`, `DC ${14 + mod}`]);

  const saved = JSON.parse(JSON.stringify(c.toJSON()));
  check('saved: the three boxes, none of the working',
    [saved.maneuvers.initiationStat, saved.maneuvers.dcBonus, 'initiator' in (saved.maneuvers.calc || {})], ['Cha', 1, false]);
  const again = new Character(saved);
  check('and reopened the same', again.data.maneuvers.calc.initiator.dc, init(c).dc);
}

console.log('a sheet that never touched the boxes saves what it did');
{
  const c = character(6);
  const before = Object.keys(JSON.parse(JSON.stringify(c.toJSON())).maneuvers).sort();
  c.recompute();
  check('no new saved fields', Object.keys(JSON.parse(JSON.stringify(c.toJSON())).maneuvers).sort(), before);
}

console.log('the Formulas tab lists the two boxes');
{
  const c = character(20, [['Harbinger', 10]]);
  const collect = FORMULA_FIELDS.find((f) => f.key === 'initiator').collect;
  check('nothing when they hold numbers', (c.set('maneuvers.initiatorLevelOverride', 12), collect(c)), []);
  c.set('maneuvers.initiatorLevelOverride', 'initiator.level + 1');
  c.set('maneuvers.dcBonus', 'mythic.tier');
  const rows = collect(c);
  check('each formula with what it came to', rows.map((r) => [r.name, r.place, r.value, r.error]),
    [['Initiator level', 'initiator:initiatorLevelOverride', 16, null], ['Maneuver DC bonus', 'initiator:dcBonus', 0, null]]);
  check('and goes to the box on the Maneuvers tab', formulaPlace(c, rows[0].place)?.tab, 'maneuvers');
}

console.log('a class table gives maneuvers known, readied and stances');
{
  const row = (lvl, k, r, st) => `| ${lvl} | +1 | +2 | +0 | +0 | Something | ${k} | ${r} | ${st} |`;
  const head = '| Level | Base Attack Bonus | Fort Save | Ref Save | Will Save | Special | Known | Readied | Stances |';
  const totals = [head, row('1st', 6, 4, 1), row('2nd', 7, 5, 2), row('3rd', 8, '5 (2)', 2)].join('\n');
  check('a base class writes totals; "5 (2)" is 5', maneuverTableFromText(`Intro.\n\n${totals}\n\nMore.`),
    { known: [6, 7, 8], readied: [4, 5, 5], stances: [1, 2, 2] });
  const gains = [head, row('1st', 0, 0, 0), row('2nd', 1, 0, 0), row('3rd', 0, 1, 0), row('4th', 1, 0, 1)].join('\n');
  check('a prestige class writes gains, added up here', maneuverTableFromText(gains),
    { known: [0, 1, 1, 2], readied: [0, 0, 1, 1], stances: [0, 0, 0, 1] });
  const rising = [head, row('1st', '—', '—', '—'), row('2nd', 1, '—', '—'), row('3rd', 1, 1, '—'), row('4th', 2, 1, 1)].join('\n');
  check('a prestige class that writes totals stays totals; a dash is 0', maneuverTableFromText(rising),
    { known: [0, 1, 1, 2], readied: [0, 0, 1, 1], stances: [0, 0, 0, 1] });
  const readiedOnly = ['| Level | Base Attack Bonus | Special | Readied |', '| 1st | +0 | A | 3 |', '| 2nd | +1 | B | 3 |'].join('\n');
  check('a column the table lacks is null', maneuverTableFromText(readiedOnly), { known: null, readied: [3, 3], stances: null });
  check('no such table: null', maneuverTableFromText('| Level | Special |\n| 1st | A |'), null);

  const tables = { catalogues: { catalogues: [{ kind: 'class', entries: [{ name: 'Edge Walker', fields: [['System', 'Maneuver']], text: totals }] }] } };
  check('the pack reading carries the table', initiatorClassesFromTables(tables)[0].table, { known: [6, 7, 8], readied: [4, 5, 5], stances: [1, 2, 2] });
}

console.log('a source row names a class and fills its counts from the class table');
{
  const table = { known: [6, 7, 8, 8, 9], readied: [4, 5, 5, 5, 6], stances: [1, 2, 2, 2, 3] };
  setInitiatorClasses([{ name: 'Warlord', stat: 'Charisma', table }, { name: 'Battle Templar', stat: '', table: { known: [0, 1], readied: null, stances: [0, 0] } }]);
  const c = character(7, [['Warlord', 3], ['Fighter', 4]]);
  const k = () => c.data.maneuvers.calc;
  const src = (i) => c.data.maneuvers.sources[i];
  c.listAdd('maneuvers.sources', { name: 'Warlord', known: '', readied: '', stances: '' });
  check('blank counts: the table at the class level', [k().possibleManeuvers, k().possibleReadied, k().possibleStances], [8, 5, 2]);
  check('the row says where they came from', src(0).tableCounts, { level: 3, known: 8, readied: 5, stances: 2 });
  c.setItem('maneuvers.sources', 0, 'known', 0);
  check('a 0 reads as blank', k().possibleManeuvers, 8);
  c.setItem('maneuvers.sources', 0, 'known', 10);
  c.setItem('maneuvers.sources', 0, 'readied', 'level - 1');
  check('a number or a formula stands instead', [k().possibleManeuvers, k().possibleReadied], [10, 6]);
  c.listAdd('maneuvers.sources', { name: 'Martial Training', known: 1, readied: '', stances: 0 });
  check('a row with no table is what it says', [k().possibleManeuvers, k().possibleReadied, k().possibleStances, 'tableCounts' in src(1)], [11, 6, 2, false]);
  c.setItem('classes', 0, 'levelsOverride', 7);
  c.setItem('maneuvers.sources', 0, 'known', '');
  check('past the table, its last row holds', src(0).tableCounts, { level: 7, known: 9, readied: 6, stances: 3 });
  c.listAdd('maneuvers.sources', { name: 'Battle Templar', known: '', readied: '', stances: '' });
  check('a class the character does not have gives 0', src(2).tableCounts, { level: 0, known: 0, readied: 0, stances: 0 });
  const saved = JSON.parse(JSON.stringify(c.toJSON()));
  check('saved: the typed counts, never the table\'s', saved.maneuvers.sources.map((x) => Object.keys(x).sort().join()),
    ['known,name,readied,stances', 'known,name,readied,stances', 'known,name,readied,stances']);

  const html = maneuversPanel(c, {});
  const cell = html.match(/<select data-item="maneuvers\.sources\|0\|name"[^>]*>[\s\S]*?<\/select>/)?.[0] || '';
  check('the source cell is the class picker',
    [cell.includes('aria-label="Allowed from"'), /<option value="Warlord"[^>]* selected>Warlord<\/option>/.test(cell), cell.includes('>Fighter<')], [true, true, true]);
  const box = html.match(/data-item="maneuvers\.sources\|0\|known"[^>]*>/)?.[0] || '';
  check('a blank count shows the table figure as its placeholder', /placeholder="9"/.test(box), true);
  check('a typed count shows what it is', /value="level - 1"[^>]*data-item="maneuvers\.sources\|0\|readied"|data-item="maneuvers\.sources\|0\|readied"[^>]*value="level - 1"/.test(html), true);
  setInitiatorClasses([]);
}

console.log('a new source row starts on the next class with a table');
{
  setInitiatorClasses([{ name: 'Warlord', stat: '', table: { known: [6], readied: [4], stances: [1] } }]);
  const c = character(1, [['Warlord', 1]]);
  const add = () => maneuversPanel(c, {}).match(/<button[^>]*data-add="maneuvers\.sources"[^>]*>/)?.[0] || '';
  check('the first row is that class', add().includes('Warlord'), true);
  c.listAdd('maneuvers.sources', { name: 'Warlord', known: '', readied: '', stances: '' });
  check('once it has a row, a new row is blank', add().includes('Warlord'), false);
  setInitiatorClasses([]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
