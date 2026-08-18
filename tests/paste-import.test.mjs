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
  const p = readFeatureProse(BARBARIAN.split('\n'), { skipLabels: new Set(['role', 'alignment', 'source', 'starting wealth', 'skill points at each level', 'hit die']) });
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
  ok('the capstone intro is a section\'s own words, consumed', !left.some(([, , t]) => t.startsWith('Alternate Capstones')));
  ok('the editor\'s note is folded into Maneuvers, not left over', !left.some(([, , t]) => t.startsWith("Editor's Note")) && war.features.some((x) => /Editor's Note: Discipline Exchanges/.test(x.text)));
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

console.log('veils -- a whole-page copy: chrome above the title, info box to fields, notes and navigation dropped');
{
  const page = `Anonymous
Library of Metzofitz
Search
Angelic Wings
Namespaces
PageDiscussion
Veils
Angelic Wings
Information
Descriptors
Good
Classes Available
Daevic (Veil List)
Chakra Slots
Shoulders
Saving Throw
Fortitude; see text
Veil Sets
Angelic Armaments
Variants
Death God's Wings
Sources
City of Seven Seraphs: Akashic Trinity, pg. 20

Brilliant white wings of gleaming energy sprout from your shoulders and settle around you like a fine cloak.

Essence: When you have a least 1 point of essence invested in this veil you gain a fly speed of 10 ft. with clumsy maneuverability.

Chakra Bind (Shoulders):[Bind Level 1] Binding this veil to your Shoulders chakra fills your wings with potent protective capabilities.

Bind Level
↑ Bind Level: Daevic 10, Eclipse 15, Helmsman 11
Notes
This veil was added to the Helmsman Veil List in Arcforge: Technology Expanded on pgs. 42-44.
Related
Archetypes
Classes
Class Options
Protection Dominion
Add comment
Categories: Good veilsAngelic Armaments set veils
This page was last edited on 13 August 2026, at 01:13.
`;
  const r = parsePaste(`${page}\n\n${page.replace(/Angelic Wings/g, 'Second Veil')}`);
  check('two whole pages, two veils, nothing left over', [r.blocks.map((b) => [b.kind, b.name]), r.leftovers.length], [[['veil', 'Angelic Wings'], ['veil', 'Second Veil']], 0]);
  const v = r.blocks[0];
  check('info box to fields', [v.slot, v.descriptor, v.source], ['Shoulders', 'Good', 'City of Seven Seraphs: Akashic Trinity, pg. 20']);
  ok('text: shaping, essence, bind, saving throw, bind level -- no notes, no navigation, no info box',
    /^Brilliant white wings/.test(v.text) && /\nEssence: When/.test(v.text) && /Chakra Bind \(Shoulders\) — bind level 1: Binding/.test(v.text)
    && /Saving throw: Fortitude; see text/.test(v.text) && /Bind Level: Daevic 10/.test(v.text)
    && !/was added to/.test(v.text) && !/Library of Metzofitz|Anonymous|Veil List|Categories|Protection Dominion|Death God/.test(v.text));
}

console.log('races -- an alternate trait whose page dropped the colon');
{
  const r = parsePaste('Standard Racial Traits\nAbility Score Modifiers: Dwarves gain +2 Constitution.\nHardy: Dwarves gain a +2 racial bonus on saving throws against poison.\nAlternate Racial Traits\nAncient Enmity: Dwarves have long been in conflict with elves. This racial trait replaces hatred.\nWanderer You gain Endurance as a bonus feat, and Climb and Swim are class skills for them. This racial trait replaces hardy. Source PZO9480\nWyrmscourged: Dwarves with this racial trait gain a +1 bonus on attack rolls. This racial trait replaces defensive training.\n');
  check('Wanderer read as its own alternate trait', r.blocks.map((b) => [b.kind, b.name]), [['race', 'Dwarf'], ['trait', 'Ancient Enmity'], ['trait', 'Wanderer'], ['trait', 'Wyrmscourged']]);
  check('its text starts at the sentence, source tagged', [r.blocks[2].text.startsWith('You gain Endurance'), r.blocks[2].source], [true, 'PZO9480']);
  check('nothing left over', r.leftovers.length, 0);
}

console.log('markdown paste with a FAQ interlude -- links and bullets stripped, the list carries on');
{
  const md = `Standard Racial Traits
Ability Score Modifiers: Dwarves are both tough and wise. They gain +2 [Constitution](https://www.d20pfsrd.com/x), +2 Wisdom, and –2 Charisma.
Hardy: Dwarves gain a +2 racial bonus on saving throws against [poison](https://x).
Favored Class Options
The following favored class options are available to all characters of this race who have the listed favored class, and unless otherwise stated, the bonus applies each time you select the favored class reward.

* Alchemist: Add +1/4 to the [alchemist’s](https://www.d20pfsrd.com/classes/base-classes/alchemist) [natural armor bonus](https://x) when using his mutagen.
* Investigator: Gain a +1/4 bonus on [Perception](https://x) checks when underground. Source [PZO1129](http://x)

FAQ
Q: The elf favored class bonus for kineticists mentions it applies when elemental overflow applies. Should they also apply only when elemental overflow applies?
A: Yes, they should both apply only when elemental overflow applies, like the [elf](https://x) favored class bonus. [[Source](http://paizo.com/x)]

* Kineticist: [see errata at right] Add 1/3 point of damage to earth element blasts that deal damage. Source [PZO1132](http://x)
* Wizard: Add 1/3 to the effective [caster level](https://x) of wizard spells. Source [PZO1135](http://amzn.to/2chJpnf)
`;
  const r = parsePaste(md);
  check('modifiers read through the links', r.blocks[0].abilityMods, { con: 2, wis: 2, cha: -2 });
  check('trait text has no link markup', r.blocks[0].traits[0].text, 'Dwarves gain a +2 racial bonus on saving throws against poison.');
  const fcb = r.blocks.find((b) => /Favored/.test(b.name));
  check('all four options, past the FAQ, bullets and links gone', fcb.text.split('\n').map((l) => l.split(':')[0]), ['Alchemist', 'Investigator', 'Kineticist', 'Wizard']);
  ok('a source stays as its tag', /Source PZO1132$/m.test(fcb.text));
  check('the FAQ itself is consumed, not left over', r.leftovers.length, 0);
  // and the same interlude inside a class's list
  const cls = parsePaste('Hit Die: d10\nThe warlord\'s class skills are Climb (Str).\nFavored Class Options\nHuman: Gain 1/6 of a new combat feat.\nFAQ\nQ: Does it stack?\nA: No.\nElf: Gain 1/5 of a new combat feat.\n');
  check('class list carries on past a FAQ', cls.blocks.find((b) => /Favored/.test(b.name)).text.split('\n').length, 2);
}

console.log('a wiki class page, whole-page copy -- chrome, info box, sub-entries, sidebars, name drift, archetypes');
{
  const page = `Anonymous
Library of Metzofitz
Search
Search Library of Metzofitz
Legendary Samurai (class)
NamespacesPageDiscussionPage actionsReadView sourceHistoryPurge

Notice
The following content has been errata'd by its original author(s) and may not match the original sourcetext. For the errata log, see Here.
Classes
Legendary Samurai (class)
Information
Alignment
Any
Hit Die
d10
Skill Points each Level
4 + Int modifier
BAB\tFort
Save\tRef
Save\tWill
Save
1\tGood\tPoor\tGood
Sources
Legendary Samurai, pgs. 2–10
Few warriors are more dedicated to honor and the code of the warrior than the samurai, trained from an early age in the art of war and sworn to the service of a lord.

Role: Masters of the blade, legendary samurai specialize in the art of swordsmanship and draw upon internal energies to enhance themselves.

Legendary Class: Unlike other legendary classes, the legendary samurai marks a large departure from the base class in order to create a class that is more in keeping with the fantasy of samurai.

JAPANESE CLASSES AND WESTERN FANTASY
One of the things that many players will hear upon asking to play a legendary samurai is that this is a western game and samurai do not exist, which is a disheartening statement and it is not necessary.

Alignment: Any

Hit Die: d10

Class Skills: The legendary samurai's class skills are Bluff (Cha), Climb (Str), Knowledge (local) (Int) Knowledge (nobility) (Int), Perception (Wis), and Swim (Str).

Skill Ranks Per Level: 4 + Int modifier

Class Features
Table: Legendary Samurai
Level\tBase Attack Bonus\tFort Save\tRef Save\tWill Save\tSpecial
1st\t+1\t+2\t+0\t+2\tChallenge, iaijutsu technique, spirit
2nd\t+2\t+3\t+0\t+3\tResolve
3rd\t+3\t+3\t+1\t+3\tKiai art
8th\t+8/+3\t+6\t+2\t+6\tOpportune strike
20th\t+20/+15/+10/+5\t+12\t+6\t+12\tLast stand
The following are the class features of the legendary samurai.

Weapon and Armor Proficiencies: Samurai are proficient with all simple and martial weapons, plus the tetsubo and all one-handed slashing weapons.

Spirit (Su): At 1st level, a legendary samurai gains access to spirit, using it to focus their attacks, and can gain spirit in the following ways:

Spirited Initiative: Whenever the legendary samurai rolls initiative, they gain 1 spirit.
Samurai Strike: Whenever the legendary samurai successfully damages a creature with an iaijutsu strike, they gain 1 spirit.
Their spirit goes up or down throughout the day, but usually cannot go higher than their Charisma modifier (minimum 1), though some feats and magic items may affect this maximum.

Grit, Panache, and Spirit
Grit, panache, and spirit represent three different means by which heroes can gain access to the same heroic pool, using it to accomplish fantastic feats and pooling the three resources together.
Challenge (Ex): As a swift action, the legendary samurai can spend 1 spirit to choose one target within their sight to challenge; the samurai can only have a single creature challenged at a time.

Challenging a foe requires much of the legendary samurai's concentration. The legendary samurai takes a –2 penalty to his Armor Class, except against attacks made by the target of his challenge.

Iaijutsu Techniques (Ex or Su): At 1st level and every four levels afterwards, a legendary samurai gains the ability to alter their iaijutsu strike, gaining an iaijutsu technique of their choice.

See: Legendary Samurai Iaijutsu Technique
Resolve (Ex): Starting at 2nd level, a legendary samurai gains resolve that they can call upon to endure even the most devastating wounds and afflictions.

Determined: As a standard action, the legendary samurai can remove the fatigued, shaken, or sickened condition, or at 8th level the exhausted, frightened, nauseated, or staggered condition.
Kiai Arts (Su): At 3rd level and every four levels after, a legendary samurai gains new ways to channel their fighting spirit into shouts called kiai arts, and at each listed level gains all listed kiai arts for that level.

Opportune Slash (Ex): At 8th level, once per round, a legendary samurai can treat an attack of opportunity as an iaijutsu strike, drawing and sheathing the weapon as part of the attack.

Last Stand (Su): At 20th level, a legendary samurai can spend 1 spirit as a move action to declare a last stand, taking minimum damage from all sources for one round and becoming immune to death effects.

Once the last stand ends, the legendary gains 1 negative level. The negative level cannot be removed by normal means but heals when the legendary samurai completes an 8-hour rest.

Favored Class Bonuses
The following favored class bonuses are open to all characters, regardless of race or ancestry:

Any: Add +1/3 on critical hit confirmation rolls made with iaijutsu strikes (maximum bonus of +5). This bonus does not stack with Critical Focus.
Any: Gain 1/6 of a new iaijutsu technique.
Archetypes
Name\tArchetype of\tSystem\tFlavor\tSource
Publication\tPublisher
Ancestral Inheritor
Legendary Samurai (class)
Blessed by the spirits of their heritage, some legendary samurai share an incredible bond to their history, forming a powerful spiritual guardian which fights alongside them.
Legendary Samurai
Legendary Games
Legendary Samurai Alternate Class Features
Legendary Samurai (class)
Spheres of Might
Legendary Samurai
Legendary Games
Ronin
Legendary Samurai (class)
The path of honor is common for legendary samurai, and yet others care to tread different ground, lacking a master or a path in life and wandering in search of meaning.
Legendary Samurai
Legendary Games

Navigation
Main page
Recent changes
Random page
Special pages
Categories
Legendary Samurai classes
Legendary Games classes
Legendary Samurai (class)
Hosted by MirahezeCreative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)Powered by MediaWiki
This page was last edited on 23 February 2026, at 23:24.
Content is available under Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) unless otherwise noted.
Privacy policyAbout Library of MetzofitzDisclaimersTerms of UseDonate to MirahezeMobile view
`;
  const r = parsePaste(page);
  check('one class, an fcb note, an archetype note; nothing left over', [r.blocks.map((b) => `${b.kind}:${b.name}`), r.leftovers.length],
    [['class:Legendary Samurai', 'note:Favored class options — Legendary Samurai', 'note:Legendary Samurai — archetypes'], 0]);
  const c = r.blocks[0];
  check('numbers, with the source from the info box', [c.hd, c.bab, c.goodFort, c.goodRef, c.goodWill, c.skillRanks, c.source], [10, 1, true, false, true, 4, 'Legendary Samurai, pgs. 2–10']);
  check('the missing comma between two Knowledge skills is healed', c.classSkills, ['Bluff', 'Climb', 'Knowledge (local)', 'Knowledge (nobility)', 'Perception', 'Swim']);
  ok('description carries the flavour, Role, Legendary Class and the sidebar', /^Role: Masters/.test(c.text) && /Few warriors/.test(c.text) && /Legendary Class: Unlike/.test(c.text) && /JAPANESE CLASSES AND WESTERN FANTASY\n\nOne of the things/.test(c.text));
  const f = (n) => c.features.find((x) => x.name.toLowerCase() === n);
  ok('sub-entries and the continuation paragraph belong to Spirit', /Spirited Initiative: Whenever/.test(f('spirit').text) && /Samurai Strike:/.test(f('spirit').text) && /Their spirit goes up/.test(f('spirit').text));
  ok('a sidebar is folded in under its heading', /\n\nGrit, Panache, and Spirit\n\nGrit, panache, and spirit represent/.test(f('spirit').text));
  ok('a continuation paragraph belongs to Challenge', /Challenging a foe requires/.test(f('challenge').text));
  ok('table singular matches prose plural, "(Ex or Su)" read, "See:" pointer kept', /every four levels/.test(f('iaijutsu technique').text) && /See: Legendary Samurai Iaijutsu Technique/.test(f('iaijutsu technique').text));
  ok('Determined is a sub-entry of Resolve, not a feature', /Determined: As a standard action/.test(f('resolve').text) && !c.features.some((x) => x.name === 'Determined'));
  ok('kiai art / Kiai Arts paired', /shouts called kiai arts/.test(f('kiai art').text));
  ok('opportune strike takes Opportune Slash by level and first word', /attack of opportunity as an iaijutsu strike/.test(f('opportune strike').text));
  ok('last stand keeps its second paragraph', /Once the last stand ends/.test(f('last stand').text));
  check('no sub-entry or sidebar became a feature; proficiencies did', c.features.filter((x) => !new Set(['challenge', 'iaijutsu technique', 'spirit', 'resolve', 'kiai art', 'opportune strike', 'last stand']).has(x.name.toLowerCase())).map((x) => x.name), ['Weapon and Armor Proficiencies']);
  check('favored class bonuses (not options) read', r.blocks[1].text.split('\n').length, 2);
  check('archetypes: names with flavour, none for the one without, publisher lines skipped', r.blocks[2].text.split('\n').map((l) => l.split(':')[0]), ['Ancestral Inheritor', 'Legendary Samurai Alternate Class Features', 'Ronin']);
}

console.log('splitChunk -- a leftover as name and text for tagging');
check('label line', splitChunk("Editor's Note: Discipline Exchanges\nMore text here."), { name: "Editor's Note", type: null, text: 'Discipline Exchanges\nMore text here.' });
check('typed label', splitChunk('Rage (Ex): A barbarian can rage.'), { name: 'Rage', type: 'Ex', text: 'A barbarian can rage.' });
check('title over a paragraph', splitChunk('Alternate Capstones\nWhen a character reaches 20th level she gains a capstone.'), { name: 'Alternate Capstones', type: null, text: 'When a character reaches 20th level she gains a capstone.' });
check('plain paragraph gets a stub title', splitChunk('All of the following are class features of the warlord.').name, 'All of the following are class…');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
