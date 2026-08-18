/** Tests the paste importer: rules text off a page into extension blocks,
 *  plus the leftovers the review stage offers for tagging. Needs no fixtures.
 *  Run: node tests/paste-import.test.mjs */
import {
  parsePaste, findSegments, readClassTable, readFeatureProse, featureKey, raceName, singular, splitChunk,
} from '../app/js/paste-import.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`); } };

/* Compact samples in the shapes the sites copy as. Structure is what matters,
 * so the rules text is abbreviated. */
const BARBARIAN = `Barbarian
Source PRPG Core Rulebook pg. 31
For some, there is only rage. In the ways of their people, in the fury of their passion, in the howl of battle, conflict is all these brutal souls know.

Role: Barbarians excel in combat, possessing the martial prowess and fortitude to take on foes.

Alignment: Any nonlawful.
Hit Die: d12.
Starting Wealth: 3d6 x 10 gp (average 105 gp).
Class Skills
The Barbarian's class skills are Acrobatics (Dex), Climb (Str), Craft (Int), Knowledge (nature) (Int), and Swim (Str).

Skill Points at each Level: 4 + Int modifier.
Class Features
Level\tBase Attack Bonus\tFort Save\tRef Save\tWill Save\tSpecial
1st\t+1\t+2\t+0\t+0\tFast movement, rage
2nd\t+2\t+3\t+0\t+0\tRage power, uncanny dodge
3rd\t+3\t+3\t+1\t+1\tTrap sense +1
7th\t+7/+2\t+5\t+2\t+2\tDamage reduction 1/-
20th\t+20/+15/+10/+5\t+12\t+6\t+6\tMighty rage, Rage power

Weapon and Armor Proficiency: A barbarian is proficient with all simple and martial weapons, light armor, medium armor, and shields (except tower shields).

Rage (Ex): A barbarian can call upon inner reserves of strength and ferocity, granting her additional combat prowess.

Trap Sense (Ex): At 3rd level, a barbarian gains a +1 bonus on Reflex saves made to avoid traps.

Damage Reduction (Ex): At 7th level, a barbarian gains damage reduction, which rises by 1 every three levels after.
Ex-Barbarians
A barbarian who becomes lawful loses the ability to rage and cannot gain more levels as a barbarian.
Alternate Capstones
Source Chronicle of Legends pg. 28
When a character reaches the 20th level of a class, she gains a powerful class feature or ability, sometimes referred to as a capstone.
Unstoppable (Ex)
Source Chronicle of Legends pg. 28
At 20th level, nothing can kill the barbarian, though not for lack of trying. The barbarian gains DR 3/— or increases the value of any existing damage reduction by 3.
Favored Class Options
Boggard (Monster Codex pg. 8): Add 1 on the barbarian's Acrobatics checks to jump.
PFS Legal Dwarf (Advanced Race Guide pg. 13, Advanced Player's Guide pg. 11): Add +1 to the barbarian's total number of rage rounds per day.
`;

const DWARF = `Relations: Dwarves and orcs have long dwelt in proximity to one another, and share a history of violence as old as both races.

Male Names: Dolgrin, Grunyar, Harsk.

Table: Random Starting Ages
Adulthood\tIntuitive1\tSelf-Taught2\tTrained3
40 years\t+3d6 years
Standard Racial Traits
Ability Score Modifiers: Dwarves are both tough and wise, but also a bit gruff. They gain +2 Constitution, +2 Wisdom, and –2 Charisma.
Size: Dwarves are Medium creatures and thus receive no bonuses or penalties due to their size.
Type: Dwarves are humanoids with the dwarf subtype.
Base Speed: (Slow and Steady) Dwarves have a base speed of 20 feet, but their speed is never modified by armor or encumbrance.
Languages: Dwarves begin play speaking Common and Dwarven. Dwarves with high Intelligence scores can choose from the following: Giant, Gnome, Goblin.
Defense Racial Traits

Hardy: Dwarves gain a +2 racial bonus on saving throws against poison, spells, and spell-like abilities.
Senses Racial Traits

Darkvision: Dwarves can see perfectly in the dark up to 60 feet.
Alternate Racial Traits
The following alternate racial traits may be selected in place of one or more of the standard racial traits above. Consult your GM before selecting any of these new options.

Ancient Enmity: Dwarves have long been in conflict with elves. Dwarves with this racial trait receive a +1 racial bonus on attack rolls against elves. This racial trait replaces hatred.
Barrow Scholar: Dwarves with this racial trait gain a +2 racial bonus on Knowledge (religion) checks to identify undead. This racial trait replaces stonecunning. Source PZO1135
Racial Subtypes
You can combine various alternate racial traits above to create subraces or variant races, such as the following:

Deep Delver: Dwarves living far below the earth have the minesight and deep warrior racial traits.
Favored Class Options
The following favored class options are available to all characters of this race who have the listed favored class, and unless otherwise stated, the bonus applies each time you select the favored class reward.

Barbarian: Add +1 to the barbarian's total number of rage rounds per day.
`;

const WARLORD = `Dynamos on the field of combat, warlords walk the line of victory and ruin through their determination to achieve glory.

Role: Striker. As a very aggressive class, the warlord seeks to bring martial power to the field.

Hit Die: d10

Starting Wealth: 5d6 x 10 gp (average 175 gp).

Class Skills: The warlord's class skills (and the key ability for each skill) are: Acrobatics (Dex), Climb (Str), Diplomacy (Cha), Knowledge (martial) (Int), Sense Motive (Wis).

Skill Ranks per Level: 4 + Int modifier

Class Features
Maneuvers
Table: Warlord
Level\tBase Attack Bonus\tFort Save\tRef Save\tWill Save\tSpecial\tKnown\tReadied\tStances
1st\t+1\t+2\t+0\t+0\tWarlord's gambit, gambit (2), bonus feat\t6\t4\t1
2nd\t+2\t+3\t+0\t+0\tTactical presence (indomitable)\t7\t5\t2
20th\t+20/+15/+10/+5\t+12\t+6\t+6\tDual stance, gambit\t18\t11\t7
All of the following are class features of the warlord.

Warlord's Gambit (Ex): At his core, the warlord is a warrior who relies on both skill and daring. At 1st level, a warlord selects two gambits.

Bonus Feat: At 1st level and at 6th level, and then every four levels after, the warlord gains a bonus combat feat or teamwork feat of his choosing.

Tactical Presence (Ex): At 2nd level, the warlord's innate charisma allows his very presence to aid and assist not only himself but his allies as well.

Editor's Note: Discipline Exchanges
Fool's Errand, Mangled Gear: Any character of any class can access any of these disciplines by trading one of their available disciplines.

Favored Class Options
Any goblinoid race: Gain a +1/4 circumstance bonus on all d20 rolls made during a warlord's gambit.
Race\tOption\tSource
Aasimar
Add +2-1/2 feet to the range of the warlord's tactical presence.
Dwarves: Add +1/5 to the bonus on saving throws granted by the warlord's tactical presence.
`;

const VEIL = `Bloodburst Blade
NamespacesPageDiscussionPage actionsReadView sourceHistoryPurge

Retold
The version of this content updated for the Akasha Retold series can be found at Bloodburst Blade (Retold).
Veils
Bloodburst Blade
Information
Descriptor
Enhanced (katana)
Classes Available
Daevic (Veil List)
Chakra Slots
Hands
Saving Throw
None
Sources
The Tome of Veils, pgs. 4–5
The chipped and serrated edge of this katana draws the blood from your foes in explosive bursts, coating the battlefield in crimson gore.

Shaping this veil allows you to conjure a katana with a blade soaked in blood that causes the blood within a foe it strikes to build up before exploding.

Essence: Investing essence in this veil causes an explosion of blood to deal additional damage equal to twice the essence invested.

Chakra Bind (Hands):[Bind Level 1] Binding this veil to your Hands chakra allows you to further build up blood points within your foes.
`;

console.log('helpers');
check('featureKey strips levels, types and counts', [featureKey('Trap Sense +1'), featureKey('trap sense (Ex)'), featureKey('gambit (2)'), featureKey('Damage reduction 1/-'), featureKey('Tactical presence (rallying)')],
  ['trap sense', 'trap sense', 'gambit', 'damage reduction', 'tactical presence']);
check('singular', ['Dwarves', 'Elves', 'Halflings', 'Gnomes', 'Kitsune'].map(singular), ['Dwarf', 'Elf', 'Halfling', 'Gnome', 'Kitsune']);
check('race name from the traits', raceName(DWARF), 'Dwarf');
check('race name from nothing', raceName('The sky is blue.'), '');

console.log('class table -- three shapes');
{
  const tabbed = readClassTable(BARBARIAN.split('\n'));
  check('tabbed rows', tabbed.rows.map((r) => r.level), [1, 2, 3, 7, 20]);
  check('specials split, parentheses kept', tabbed.rows[0].special, ['Fast movement', 'rage']);
  check('bab and saves off the 20th row', [tabbed.bab, tabbed.saves], [1, { fort: true, ref: false, will: false }]);
  const spaced = readClassTable(['Level Base Attack Bonus Fort Save Ref Save Will Save Special', '1st +0 +0 +2 +2 Cantrips, arcane bond', '20th +10/+5 +6 +12 +12 Capstone'].map((s) => s));
  check('space-separated rows', spaced.rows.map((r) => [r.level, r.special]), [[1, ['Cantrips', 'arcane bond']], [20, ['Capstone']]]);
  check('half BAB, good Ref and Will', [spaced.bab, spaced.saves], [0.5, { fort: false, ref: true, will: true }]);
  const perLine = readClassTable(['Level', 'Base Attack Bonus', 'Fort Save', 'Ref Save', 'Will Save', 'Special', '1st', '+0', '+2', '+2', '+0', 'Sneak attack +1d6', '2nd', '+1', '+3', '+3', '+0', 'Evasion', '20th', '+15/+10/+5', '+12', '+12', '+6', 'Master strike']);
  check('one cell per line', perLine.rows.map((r) => [r.level, r.special[0]]), [[1, 'Sneak attack +1d6'], [2, 'Evasion'], [20, 'Master strike']]);
  check('three-quarter BAB', perLine.bab, 0.75);
  const extra = readClassTable(WARLORD.split('\n'));
  check('extra columns by header', extra.rows[0].extra, [['Known', '6'], ['Readied', '4'], ['Stances', '1']]);
  check('no table at all', readClassTable(['just prose']).rows, []);
}

console.log('feature prose -- inline and title shapes');
{
  const p = readFeatureProse(BARBARIAN.split('\n'), { skipLabels: new Set(['role', 'alignment', 'source', 'starting wealth']) });
  check('names in order', p.map((x) => x.name), ['Weapon and Armor Proficiency', 'Rage', 'Trap Sense', 'Damage Reduction', 'Unstoppable']);
  check('types', p.map((x) => x.type), [null, 'Ex', 'Ex', 'Ex', 'Ex']);
  check('level read off the text', p.map((x) => x.level), [null, null, 3, 7, 20]);
  check('title feature keeps its source and body', [p[4].title, p[4].source, /nothing can kill/.test(p[4].text)], [true, 'Chronicle of Legends pg. 28', true]);
}

console.log('segments -- anchors, reach and the double-blank boundary');
{
  const all = `${BARBARIAN}\n\n${DWARF}\n\n${WARLORD}\n\n${VEIL}`;
  const lines = all.split('\n');
  const segs = findSegments(lines);
  check('four things found in order', segs.map((s) => s.kind), ['class', 'race', 'class', 'veil']);
  check('the class reaches back to its title', lines[segs[0].start], 'Barbarian');
  check('the race takes its preamble', lines[segs[1].start].startsWith('Relations:'), true);
  check('the second class starts at its flavour, not the race tail', lines[segs[2].start].startsWith('Dynamos'), true);
  check('segments tile the text', segs.map((s) => s.end).slice(0, -1), segs.map((s) => s.start).slice(1));
}

console.log('parsePaste -- the whole thing');
{
  const r = parsePaste(`${BARBARIAN}\n\n${DWARF}\n\n${WARLORD}\n\n${VEIL}`);
  const kinds = r.blocks.map((b) => `${b.kind}:${b.name}`);
  check('blocks', kinds, [
    'class:Barbarian', 'feature:Unstoppable', 'note:Favored class options — Barbarian',
    'race:Dwarf', 'trait:Ancient Enmity', 'trait:Barrow Scholar', 'note:Dwarf — racial subtypes', 'note:Favored class options — Dwarf',
    'class:Warlord', 'note:Favored class options — Warlord',
    'veil:Bloodburst Blade',
  ]);
  const barb = r.blocks[0];
  check('barbarian numbers', [barb.hd, barb.bab, barb.goodFort, barb.goodRef, barb.skillRanks], [12, 1, true, false, 4]);
  check('barbarian class skills, ability tags off, Knowledge kept', barb.classSkills, ['Acrobatics', 'Climb', 'Craft', 'Knowledge (nature)', 'Swim']);
  check('barbarian source', barb.source, 'PRPG Core Rulebook pg. 31');
  ok('barbarian description carries role and flavour', /Role: Barbarians/.test(barb.text) && /only rage/.test(barb.text));
  const f = (name) => barb.features.find((x) => x.name === name);
  check('table features by level', barb.features.filter((x) => x.level === 1).map((x) => x.name), ['Fast movement', 'rage', 'Weapon and Armor Proficiency', 'Ex-Barbarians']);
  ok('rage carries its prose', /inner reserves/.test(f('rage').text));
  ok('trap sense +1 matched to Trap Sense (Ex)', /Reflex saves/.test(f('Trap sense +1').text));
  ok('damage reduction 1/- matched', /rises by 1/.test(f('Damage reduction 1/-').text));
  ok('proficiency line kept as a level-1 feature', /tower shields/.test(f('Weapon and Armor Proficiency').text));
  ok('ex-class paragraph kept', /becomes lawful/.test(f('Ex-Barbarians').text));
  const cap = r.blocks[1];
  check('capstone as a feature in its own group', [cap.type, cap.group, cap.source], ['Ex', 'Barbarian — alternate capstones', 'Chronicle of Legends pg. 28']);
  check('favored class note, PFS tag dropped', r.blocks[2].text.split('\n').map((l) => l.split(' (')[0]), ['Boggard', 'Dwarf']);

  const dwarf = r.blocks[3];
  check('dwarf numbers', [dwarf.size, dwarf.speed, dwarf.abilityMods, dwarf.languages], ['Medium', 20, { con: 2, wis: 2, cha: -2 }, ['Common', 'Dwarven']]);
  check('dwarf standard traits', dwarf.traits.map((t) => t.name), ['Hardy', 'Darkvision']);
  ok('dwarf description keeps type, languages and relations', /Type: Dwarves/.test(dwarf.text) && /Relations:/.test(dwarf.text));
  check('alternate traits with source tag', [r.blocks[5].name, r.blocks[5].source], ['Barrow Scholar', 'PZO1135']);
  ok('subtypes and fcb as notes', /Deep Delver/.test(r.blocks[6].text) && /Barbarian: Add/.test(r.blocks[7].text));

  const war = r.blocks[8];
  check('warlord numbers', [war.hd, war.bab, war.goodFort, war.skillRanks], [10, 1, true, 4]);
  check('warlord class skills through the "(and the key ability…) are:" phrasing', war.classSkills, ['Acrobatics', 'Climb', 'Diplomacy', 'Knowledge (martial)', 'Sense Motive']);
  check('extra columns fold into one entry per level', war.features.filter((x) => /Known/.test(x.name)).map((x) => `${x.level}:${x.name}`), ['1:Known 6 / Readied 4 / Stances 1', '2:Known 7 / Readied 5 / Stances 2', '20:Known 18 / Readied 11 / Stances 7']);
  ok('gambit (2) matched to Warlord\'s Gambit? no — different key; the gambit prose lands on "Warlord\'s gambit"', /two gambits/.test(war.features.find((x) => x.name === "Warlord's gambit").text));
  ok('bonus feat prose without a type still lands', /teamwork feat/.test(war.features.find((x) => x.name === 'bonus feat').text));
  check('wiki favored class list read, table header skipped', r.blocks[9].text.split('\n').length, 3);

  const veil = r.blocks[10];
  check('veil block: slot and descriptor', [veil.kind, veil.slot, veil.descriptor], ['veil', 'Hands', 'Enhanced (katana)']);
  ok('veil text has the shaping text, then Essence and Chakra Bind under headings, not the chrome',
    /serrated edge/.test(veil.text) && /\nEssence: Investing/.test(veil.text) && /Chakra Bind \(Hands\) — bind level 1: Binding/.test(veil.text) && !/Namespaces/.test(veil.text));

  // leftovers: what the review stage offers
  const left = r.leftovers.map((l) => [l.suggest, l.near?.name, l.text.split('\n')[0].slice(0, 30)]);
  ok('the capstone intro is left over near the barbarian', left.some(([s, n, t]) => n === 'Barbarian' && t.startsWith('Alternate Capstones')));
  ok('the editor\'s note is left over near the warlord as a feature candidate', left.some(([s, n, t]) => n === 'Warlord' && s === 'feature' && t.startsWith("Editor's Note")));
  ok('the wiki chrome is the veil\x27s, not left over', !left.some(([, , t]) => /Namespaces/.test(t)));
  ok('nothing used twice: no leftover repeats a trait or table row', !left.some(([, , t]) => /^Hardy:|^1st\t/.test(t)));
  ok('the report reads', r.report.length >= 8 && /Class Barbarian: d12, full BAB/.test(r.report[0]));
}

console.log('parsePaste -- nothing recognisable');
{
  const r = parsePaste('Some Title\nJust a paragraph of text that is not a class, race or veil at all, and goes on a bit.');
  check('no blocks, one leftover, a note suggested', [r.blocks.length, r.leftovers.length, r.leftovers[0].suggest], [0, 1, 'note']);
  ok('report says so', /Nothing here looked like/.test(r.report[0]));
  check('empty text', parsePaste('').blocks, []);
}

console.log('splitChunk -- a leftover as name and text for tagging');
check('label line', splitChunk("Editor's Note: Discipline Exchanges\nMore text here."), { name: "Editor's Note", type: null, text: 'Discipline Exchanges\nMore text here.' });
check('typed label', splitChunk('Rage (Ex): A barbarian can rage.'), { name: 'Rage', type: 'Ex', text: 'A barbarian can rage.' });
check('title over a paragraph', splitChunk('Alternate Capstones\nWhen a character reaches 20th level she gains a capstone.'), { name: 'Alternate Capstones', type: null, text: 'When a character reaches 20th level she gains a capstone.' });
check('plain paragraph gets a stub title', splitChunk('All of the following are class features of the warlord.').name, 'All of the following are class…');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
