/** Tests the paste importer: rules text off a page into extension blocks,
 *  plus the leftovers the review stage offers for tagging. Needs no fixtures.
 *  Run: node tests/paste-import.test.mjs */
import {
  parsePaste, findSegments, readClassTable, readFeatureProse, featureKey, raceName, singular, splitChunk,
  splitTalentName, looksStructured, parseStructured,
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

console.log('a wikidot paste of two class pages -- side menu, contents, bare-number table, untyped feature headings');
{
  // The Spheres of Power wiki copies with the site banner and the whole side
  // menu above the breadcrumb, the contents under it, and the site's links and
  // small print below; its tables number the levels plainly and one page in
  // three heads its features without "(Ex)".
  const pages = `Wikidot.com

.wikidot.com

Share on

Explore »

Spheres of Power Wiki

A Quick Reference Site

Home
Admin
Help

Create account or Sign in

Special Release

Spheres of Might 5E

$19.99

Combat Spheres

Alchemy
Athletics
Barrage

Page tags

home
Blacksmith
Spheres of Power Wiki Home Page » Spheres Of Might » Blacksmith

Fold
Table of Contents
Class Abilities
Combat Training
Maintenance (Ex)
Polish
Archetypes
-Barista [Apoc]

“The only joy greater than winning a prize with your own two hands is forging it.”

Blacksmiths are craftsmen who forge the tools they need by hand, and are masters of equipment both on the battlefield and off it.

Starting Wealth: 4d6 x 10 gp (average 140 gp).

Role: Blacksmiths support their party by crafting and maintaining potent weapons and armor.

Alignment: Any.

Hit Die: d10

Class Skills: The blacksmith's class skills are Appraise (Int), Climb (Str), Craft (Int), Perception (Wis), and Swim (Str).

Skill Ranks Per Level: 4 + Int modifier.

Class Abilities

Table: Blacksmith

Class Level\tBase Attack Bonus\tFort Save\tReflex Save\tWill Save\tSpecial\tCombat Talents
1\t+1\t+2\t+0\t+2\tCombat training, maintenance, thunderous blows +1d6\t1
2\t+2\t+3\t+0\t+3\tSkilled craftsman\t2
20\t+20/+15/+10/+5\t+12\t+6\t+12\tSmith's masterpiece\t20

Combat Training

A blacksmith may combine combat spheres and talents to create powerful martial techniques. Blacksmiths are considered Expert combatants.

Maintenance (Ex)

Starting at 1st level, the blacksmith learns how to maintain and optimize his equipment and that of his party members.

Polish

The blacksmith polishes a suit of armor to a mirror sheen, granting it a bonus against gaze attacks.

Smith's Masterpiece

At 20th level, the blacksmith may create a single masterpiece, an item of unrivalled quality.

Archetypes

The following are archetypes that blacksmiths can choose.

-Barista [Apoc]

Baristas specialize in brewing drinks for their allies.

-Iron Chef

Iron chefs are experts at creating food for their allies.

Favored Class Bonuses

Dwarf: Add +1/4 to the blacksmith's thunderous blows damage.

Human: Gain +1/6 of a combat talent.

Class Equipment

Forging Hammer [TS:WAT]

Aura faint Creation; CL 5th

Slot none; Price 15,000 gp; Weight 15 lbs.

Spheres of Might by Drop Dead Studios
Classes
Armiger\tBlacksmith\tCommander\tConscript
Rules
Martial Traditions\tMartial Packages

Help
|
Terms of Service
Powered by Wikidot.com
This website uses cookies. See the Legal & OGL page for important information.

Wikidot.com

.wikidot.com

Spheres of Power Wiki

Home
Admin

Page tags

home
Striker
Spheres of Power Wiki Home Page » Spheres Of Might » Striker

Fold
Table of Contents
Class Abilities
Weapon and Armor Proficiency

“Who needs a weapon when I am one?”

Strikers fight with their bare hands, building tension with every blow they land and every blow they take.

Hit Die: d10

Class Skills: The striker's class skills are Acrobatics (Dex), Climb (Str), and Escape Artist (Dex).

Skill Ranks Per Level: 4 + Int modifier.

Class Abilities

Table: Striker

Level\tBase Attack Bonus\tFort Save\tReflex Save\tWill Save\tSpecial\tCombat Talents
1st\t+1\t+2\t+2\t+0\tBare knuckles, tension\t1
20th\t+20/+15/+10/+5\t+12\t+12\t+6\tUltimate tension\t20

Weapon and Armor Proficiency

A striker is proficient with simple weapons and light armor.

Bare Knuckles

A striker's unarmed strikes deal damage as if she were a monk of her striker level.

Tension

A striker builds tension as she fights, spending it on the striker arts she knows.

Powered by Wikidot.com
`;
  const r = parsePaste(pages);
  check('both pages read, each with its favored-class and archetype notes',
    r.blocks.map((b) => `${b.kind}:${b.name}`),
    ['class:Blacksmith', 'note:Favored class options — Blacksmith', 'note:Blacksmith — archetypes', 'class:Striker']);
  const [bs, , arch, st] = r.blocks;
  check('a "Class Level" header and plainly numbered rows give BAB and saves',
    [bs.hd, bs.bab, bs.goodFort, bs.goodRef, bs.goodWill, bs.skillRanks], [10, 1, true, false, true, 4]);
  check('class skills read', bs.classSkills, ['Appraise', 'Climb', 'Craft', 'Perception', 'Swim']);
  check('the table\'s features, level by level', bs.features.map((f) => `${f.level} ${f.name}`),
    ['1 Combat training', '1 maintenance', '1 thunderous blows +1d6', '1 Combat Talents 1', '2 Skilled craftsman',
      '2 Combat Talents 2', '20 Smith\'s masterpiece', '20 Combat Talents 20']);
  const f = (n) => bs.features.find((x) => x.name.toLowerCase() === n);
  ok('an untyped heading over its paragraph is the feature the table names', /Expert combatants/.test(f('combat training').text));
  ok('a typed heading still is', /maintain and optimize/.test(f('maintenance').text));
  ok('an untyped heading the table does not name stays a sidebar inside the feature above',
    /\n\nPolish\n\nThe blacksmith polishes/.test(f('maintenance').text) && !bs.features.some((x) => x.name === 'Polish'));
  ok('the epigraph and flavour are the description', /“The only joy/.test(bs.text) && /Blacksmiths are craftsmen/.test(bs.text));
  check('archetypes, their dashes off', arch.text.split('\n').map((l) => l.split(':')[0]), ['Barista [Apoc]', 'Iron Chef']);
  check('the favored-class list stops where the next section starts', r.blocks[1].text.split('\n').map((l) => l.split(':')[0]), ['Dwarf', 'Human']);
  check('the second page is its own class', [st.name, st.hd, st.bab, st.goodFort, st.goodRef, st.goodWill], ['Striker', 10, 1, true, true, false]);
  ok('"Weapon and Armor Proficiency" over a paragraph is a feature, not a heading',
    /proficient with simple weapons/.test(st.features.find((x) => /^Weapon and Armor/i.test(x.name))?.text || ''));
  ok('nothing of the first page is on the second', !/blacksmith/i.test(JSON.stringify(st)));
  const left = r.leftovers.map((l) => l.text);
  ok('the side menu, contents, breadcrumb and footer are not left over',
    !left.some((t) => /Athletics|Table of Contents|Home Page »|Powered by Wikidot|Drop Dead Studios|Terms of Service/.test(t)));
  ok('nor are they anywhere in a block', !/Athletics|Powered by Wikidot|Drop Dead Studios/.test(JSON.stringify(r.blocks)));
  check('nothing worth tagging is left over', r.leftovers.filter((l) => l.suggest !== 'skip').length, 0);
}

console.log('archetype pages -- a whole archetype, and the alternate-class-features page split into options');
{
  const pages = `Anonymous
Library of Metzofitz
Search
Search Library of Metzofitz
Oni Warrior
NamespacesPageDiscussionPage actionsReadView sourceHistoryPurge
Legendary Samurai archetypes
Oni Warrior
Information
Classes Available
Legendary Samurai (class)
Sources
Legendary Samurai, pg. 18
The path of the legendary samurai often draws those with less civilized tactics. Oni warriors are those who feed on the thrill of combat, embracing the battlefield with an unbound vigor.

Weapon Proficiencies: An oni warrior is proficient simple and martial weapons as well as all two-handed melee bludgeoning weapons.

This ability alters the legendary samurai's weapon proficiencies.

Rage (Ex): At 1st level, an oni warrior gains the rage class feature as though they were a barbarian of their class level, and a rage power of their choice.

This ability replaces challenge and sheathe control.

Spirit Weapon (Su): At 1st level, the oni receives a weapon of their choice, which houses the soul of their ancestors. A spirit weapon is an intelligent weapon and has the following traits:

Intelligence: This is the intelligence score of the spirit weapon. It starts at 9 and increases by 1 for every two levels of the legendary samurai.
Ego: A spirit weapon starts with an ego of 3, and that ego increases as the spiritual weapon becomes more powerful.
This ability replaces advanced blade.

Greater Rage (Ex): At 10th level, an oni warrior gains the greater rage class feature.

This ability replaces iaijutsu master.

Related
Archetypes
Ronin
Classes
Barbarian


Legendary Samurai (class)
Class Options
Barbarian Rage Power

Navigation
Main page
Recent changes
Categories
Legendary Samurai (class) archetypes
This page was last edited on 18 August 2026, at 02:11.


Anonymous
Library of Metzofitz
Search
Search Library of Metzofitz
Legendary Samurai Alternate Class Features
NamespacesPageDiscussionPage actionsReadView sourceHistoryPurge

Notice
The following content has been errata'd by its original author(s) and may not match the original sourcetext. For the errata log, see Here.
Legendary Samurai archetypes
Legendary Samurai Alternate Class Features
Information
Classes Available
Legendary Samurai (class)
Systems
Spheres of Might
Sources
Legendary Samurai, pgs. 11–13
Alternate class features are small, modular archetypes. They swap out a single class feature (or a few related class features) for new abilities, and a player is able to build the legendary samurai that best fits their ideas.


Contents
1\tLegendary Samurai
1.1\tChallenge
1.2\tIaijutsu Strike
2\tRelated
Legendary Samurai
Challenge
The following options alter or replace the legendary samurai's challenge. If the legendary samurai gains ranks in another class with these abilities, those class levels stack for the purpose of advancing those abilities.

Favored Enemy (Ex): At 1st level, a legendary selects a creature type from the ranger favored enemies table, gaining a +2 bonus on Bluff, Knowledge, Perception, Sense Motive, and Survival checks against creatures of their selected type.

This ability replaces challenge.

Weapon Training (Ex): At 1st level, a legendary samurai chooses a one-handed slashing weapon, receiving Weapon Focus as a bonus feat for their chosen weapon.

This ability replaces challenge.

Iaijutsu Strike
The following options alter or replace the legendary samurai's iaijutsu strike or iaijutsu techniques.

Samurai's Finesse (Ex): At 1st level, a legendary samurai gains Weapon Finesse as a bonus feat and can use it with all one-handed slashing and piercing weapons with which they are proficient.

This ability alters iaijutsu strike. This alternative class feature can be combined with either the Yumi Sniper archetype or the Skirmisher's Strike alternative class feature (but not both), in which case both alterations to iaijutsu strike apply.

Related
Archetypes
Classes
Bard

Navigation
Main page
Recent changes
This page was last edited on 24 February 2026, at 00:04.
`;
  const r = parsePaste(pages);
  check('one archetype block, then one block per alternate class feature', r.blocks.map((b) => `${b.kind}:${b.name}${b.single ? '*' : ''}`),
    ['archetype:Oni Warrior', 'archetype:Favored Enemy*', 'archetype:Weapon Training*', "archetype:Samurai's Finesse*"]);
  check('nothing left over -- chrome, notice, contents, section headings and intros all consumed', r.leftovers.length, 0);
  const oni = r.blocks[0];
  check('class and source from the info box', [oni.class, oni.source], ['Legendary Samurai', 'Legendary Samurai, pg. 18']);
  ok('flavour is the description', /less civilized tactics/.test(oni.text));
  check('features with what each does, sub-entries folded into Spirit Weapon', oni.features.map((f) => [f.name, f.level, f.replaces, f.alters]), [
    ['Weapon Proficiencies', 1, [], ['weapon and armor proficiency']],
    ['Rage', 1, ['challenge', 'sheath control'], []],
    ['Spirit Weapon', 1, ['advanced blade'], []],
    ['Greater Rage', 10, ['iaijutsu master'], []],
  ]);
  ok('the sub-entries and the "replaces" sentence are inside Spirit Weapon', /Intelligence: This is the intelligence/.test(oni.features[2].text) && /Ego: A spirit weapon/.test(oni.features[2].text) && /This ability replaces advanced blade\./.test(oni.features[2].text));
  const acf = r.blocks.slice(1);
  check('each option is a single-feature archetype for the class, sectioned', acf.map((b) => [b.class, b.features.length, b.text]),
    [['Legendary Samurai', 1, 'Alternate class feature (Challenge) for the Legendary Samurai.'], ['Legendary Samurai', 1, 'Alternate class feature (Challenge) for the Legendary Samurai.'], ['Legendary Samurai', 1, 'Alternate class feature (Iaijutsu Strike) for the Legendary Samurai.']]);
  check('their swaps', acf.map((b) => [b.features[0].replaces, b.features[0].alters]), [[['challenge'], []], [['challenge'], []], [[], ['iaijutsu strike']]]);
  check('the combination note is read', acf[2].stacksWith, ['Yumi Sniper', "Skirmisher's Strike"]);
  ok('the report says so', /Archetype Oni Warrior for Legendary Samurai: 4 feature\(s\); replaces challenge, sheath control, advanced blade, iaijutsu master; alters weapon and armor proficiency\./.test(r.report[0]) && /3 alternate class feature\(s\)/.test(r.report[1]));
}

console.log('an option page -- the menu a class feature picks from, on a page of its own');
{
  // The info box says which class and which option, which is what tells this
  // page from an archetype's; the contents list says which of its headings
  // sit inside which.
  const page = `Anonymous
Library of Metzofitz

Legendary Samurai Iaijutsu Technique

From Library of Metzofitz

Namespaces

Page
Discussion

Page actions

Read
View source
History

Legendary Samurai Iaijutsu Technique

Information

Classes Available

Legendary Samurai (class)

Option

Legendary Samurai Iaijutsu Technique

Legendary Samurai, pgs. 4–7

Contents

1 Legendary Samurai

1.1 Slashes
1.2 Cuts

2 Related

Legendary Samurai

Slashes

Armor-Rending Slash (Ex): Whenever the legendary samurai makes a successful iaijutsu strike, that creature takes a -2 to their armor class for a number of rounds equal to their Charisma modifier.

Bloody Slash (Ex): The target takes bleed damage equal to half the legendary samurai's class level. A legendary samurai must be 5th level or higher to select this iaijutsu technique.

Cuts

Ranged Cut (Ex): The legendary samurai can make an iaijutsu strike at a range of 30 feet.

Tornado Cut (Su): The legendary samurai targets every space adjacent to them. A legendary samurai must be 10th level or higher to select this iaijutsu technique.

Related

Archetypes

Classes

Legendary Samurai (class)

Retrieved from "https://metzo.miraheze.org/wiki/Legendary_Samurai_Iaijutsu_Technique"

Navigation

Main page
Recent changes
Random page
`;
  const r = parsePaste(page);
  check('one option menu, nothing else', r.blocks.map((b) => `${b.kind}:${b.name}`), ['options:Legendary Samurai Iaijutsu Technique']);
  const m = r.blocks[0];
  check('the class it is for, and the feature that picks from it', [m.class, m.feature], ['Legendary Samurai', 'Iaijutsu Technique']);
  check('its entries, under the headings the contents list called inner ones',
    m.options.map((o) => [o.name, o.type, o.category, o.minLevel]),
    [['Armor-Rending Slash', 'Ex', 'Slashes', null], ['Bloody Slash', 'Ex', 'Slashes', 5],
      ['Ranged Cut', 'Ex', 'Cuts', null], ['Tornado Cut', 'Su', 'Cuts', 10]]);
  ok('the level a technique asks for, not a level it scales at',
    /bleed damage/.test(m.options[1].text) && !m.options[0].minLevel);
  ok('the outer heading only repeated the class, so it says nothing about where it is from',
    m.options.every((o) => !o.source));
  ok('the page citation is the menu\'s source, not one of its entries', /pgs\. 4–7/.test(m.source));
  check('the chrome, the contents and the page\'s own tail are not left over', r.leftovers.filter((l) => l.suggest !== 'skip').length, 0);
  ok('the report says what it read', /21|4 option\(s\)/.test(r.report[0]) && /Slashes, Cuts/.test(r.report[0]));
}

console.log('a plain homebrew archetype document -- no info box, title features with colons, free-form swap sentences');
{
  const doc = "Isougiri\nDescription\nThe Isougiri swung his sword, sheathed it, and drew it again, thousands of times every day. Sweat built up on his brow, his arms and legs burning from the exertion of perfecting the same motion.\nThe tree before him fell. \nThe boulder behind it slid apart. \nBy understanding this motion, he began to learn how to cleave all of space… and, soon after, refute the Gods themselves.\nClass Features\nScholar’s Education\nThis archetype is only available to Isougiri with the Scholarly Samurai feat. If they retrain or permanently lose the feat, they also lose access to this archetype.\nTopological Theory (Ex)\nAt 1st level, An Isougiri gains access to Theory, using it to focus his attacks. An Isougiri begins the day with no Theory, but can gain Theory in the following ways (An Isougiri cannot gain Theory from each of these more than once per round and must be in combat to gain Theory):\nOpening Theorem: Whenever the Isougiri rolls initiative, he gains 1 Theory.\nProven Lemma: Whenever the Isougiri successfully damages a creature using Topological Draw, he gains 1 Theory.\nHis Theory goes up or down throughout the day, but usually cannot go higher than his Intelligence modifier (minimum 1), though some feats, abilities, and magic items may affect this maximum.\nThis feature alters Spirit and counts as such for items, class features, and feats. Opening Theorem, Proven Lemma, and Observed Contradiction count as Spirited Initiative, Samurai Strike, and Warrior's Guard respectively.\nBounded Domain (Ex)\nBounded Domain defines the range of the Isougiri's Topological Draw and Topological Iaijutsu Techniques and is centered on the Isougiri himself at all times. Other attacks are not subject to Bounded Domain or affected by it.\nThe domain has a range of 20 feet at level 1 and increases by 5 feet at level 4 and every three levels thereafter, to a maximum of 50 feet at level 19.\nTopological Draw (Ex)\nAt 1st level, An Isougiri can strike in the blink of an eye, cutting down foes with his unique talents. \nThe Isougiri can make an attack action with a non-thrown melee weapon the Isougiri is proficient with, as long as it is sheathed before the attack.\nThis alters Iaijutsu Strike\nTopological Iaijutsu Techniques\nAt 1st level and every four levels afterwards, An Isougiri gains the ability to alter their iaijutsu strike, gaining a topological iaijutsu technique of their choice (See end of document).\nTopological Draw alters Iaijutsu Techniques. Topological Draw counts as Iaijutsu Techniques for items, feats, and class features.\nTopological Precision (Ex)\nAt 7th level, the save DC of all Topological Iaijutsu Techniques used against a target increases by ½ the target’s Mapped counters, rounded up.\nThis replaces Sheathe Block.\nTopological Step: Projection (Ex)\nAt 8th level, the Isougiri can spend 1 Theory as a swift action to project himself partially into the complex plane.\nLevel 12: The Isougiri gains a +2 bonus to his Reflex saves for the duration of Topological Step: Projection. This bonus increases by 1 at levels 16 and 20.\nTopological Step: Projection replaces Dragon Defense.\nSpatial Discontinuity (Su)\nAt 11th level, the Isougiri can spend 1 Theory to select one or more edges between two squares within his Bounded Domain as boundaries.\nThis replaces the 10th and 14th level Warrior’s grace.\n\nAxiomatic Corollary: Empty Set ∅ (Su)\nAt level 20, the Isougiri proves the ultimate corollary: by severing his own topological form, he becomes the primitive empty set ∅ that is part of every set.\n\nTopological Iaijutsu Techniques\n\nCuts\nMapped: A creature gains Mapped 1 for a number of rounds equal to the Isougiri’s intelligence modifier. Additional applications increase its counter by 1.\n\nZero-Point Thrust (Ex)\nThe Isougiri makes a melee attack against a target or space within his Bounded Domain. If the target is flanked, flat-footed, or otherwise loses its Dexterity bonus to AC, it gains Mapped before the attack resolves.\nLevel 6: On a failed Fortitude save, the target also loses natural armor bonuses to AC equal to its Mapped counter for the duration.\nThis replaces the Ranged Cut and Armor Rending Slash Iaijutsu Techniques.\n\nSlashes\n\nVolumetric Slash (Ex)\nThe Isougiri makes a melee attack against a Mapped creature within his Bounded Domain. Large or larger creatures take additional damage equal to 2d6 per 3 class levels.\nAn Isougiri must be at least 5th level to select this technique.\n";
  const r = parsePaste(doc);
  check('one archetype, nothing left over', [r.blocks.map((b) => `${b.kind}:${b.name}`), r.leftovers.length], [['archetype:Isougiri'], 0]);
  const a = r.blocks[0];
  check('class not named, description is the flavour', [a.class, /swung his sword/.test(a.text), /The tree before him fell/.test(a.text)], ['', true, true]);
  check('features, with colons in titles and untyped title features kept; the technique menu is not features', a.features.map((f) => f.name), ['Scholar’s Education', 'Topological Theory', 'Bounded Domain', 'Topological Draw', 'Topological Iaijutsu Techniques', 'Topological Precision', 'Topological Step: Projection', 'Spatial Discontinuity', 'Axiomatic Corollary: Empty Set ∅']);
  const menu = a.features.find((x) => x.name === 'Topological Iaijutsu Techniques');
  check('the menu is the feature\x27s options, by category, with a minimum level where the text says so', menu.options.map((o) => [o.category, o.name, o.type, o.minLevel]), [['Cuts', 'Zero-Point Thrust', 'Ex', null], ['Slashes', 'Volumetric Slash', 'Ex', 5]]);
  ok('"Mapped:" is the menu\x27s information, not an option', /^Mapped: A creature gains Mapped 1/.test(menu.optionsInfo) && !menu.options.some((o) => o.name === 'Mapped'));
  ok('an option carries its own replaces sentence as its text; the feature\x27s alters is read off it', /replaces the Ranged Cut/.test(menu.options[0].text));
  const f = (n) => a.features.find((x) => x.name.startsWith(n));
  check('"This feature alters Spirit and counts as such…" -> alters spirit only', [f('Topological Theory').replaces, f('Topological Theory').alters], [[], ['spirit']]);
  check('"This alters Iaijutsu Strike" with no full stop', f('Topological Draw').alters, ['iaijutsu strike']);
  check('"Topological Draw alters Iaijutsu Techniques." -- a named subject', f('Topological Iaijutsu').alters, ['iaijutsu technique']);
  check('"This replaces Sheathe Block." at 7th', [f('Topological Precision').level, f('Topological Precision').replaces], [7, ['sheath block']]);
  check('"Topological Step: Projection replaces Dragon Defense." -- subject with a colon', [f('Topological Step').level, f('Topological Step').replaces], [8, ['dragon defense']]);
  check('"replaces the 10th and 14th level Warrior’s grace" -> those two grants, not the feature',
    [f('Spatial').replaces, f('Spatial').alters], [['warriors grace@10', 'warriors grace@14'], []]);
  check('"At level 20"', f('Axiomatic').level, 20);
  ok('sub-entries under Topological Theory', /Opening Theorem: Whenever/.test(f('Topological Theory').text) && /Proven Lemma:/.test(f('Topological Theory').text));
  ok('the report says the class is not named, and counts the menu', /Archetype Isougiri for a class the text does not name/.test(r.report[0]) && /Topological Iaijutsu Techniques: 2 options/.test(r.report[0]));
}

console.log('a scraper document -- structured markdown, read before anything is cleaned');
{
  /*
   * What a scraper writes, rather than what a browser copies. The shape is
   * meant to hold for whatever it learns to fetch next, so this checks the
   * frame as much as the maneuvers: an H1 subject, a blockquote description,
   * sections and groups by heading depth, and entries whose *fields* say what
   * they are.
   */
  const DOC = `# Iron Tortoise

> The discipline known as Iron Tortoise rose up from the need to protect one's self and allies.
> Maneuvers from Iron Tortoise require use of a shield in one hand.

---

## Maneuvers & Stances (34 Abilities)

### Level 1 Maneuvers

#### Angering Smash

* **Discipline:** Iron Tortoise
* **Level:** 1 (Maneuver [Strike])
* **Initiation Action:** 1 standard action
* **Range:** Melee attack
* **Target / Area:** One creature
* **Duration:** One round
* **Source:** Path of War p. 69

**Summary:** *Melee attack that causes -4 to hit any target but you.*

By making a quick shield bash, the disciple taunts his foes into striking at him solely.

---

#### Snapping Turtle Stance

* **Discipline:** Iron Tortoise
* **Level:** 1 (Stance)
* **Initiation Action:** 1 swift action
* **Range:** Personal
* **Target / Area:** You
* **Duration:** Stance
* **Source:** Path of War p. 70

**Summary:** *Shield bashes inflict an additional 1d6 points of damage.*

The disciple holds his shield to deliver punishing shield bashes.

This bonus damage increases by +1d6 every 8 initiator levels beyond 1st.

---

### Level 3 Maneuvers

#### Burnished Shell

* **Discipline:** Iron Tortoise
* **Level:** 3 (Maneuver [Counter])
* **Initiation Action:** 1 immediate action
* **Range:** Personal
* **Target / Area:** You
* **Prerequisite:** 1 Iron Tortoise Maneuver
* **Source:** Path of War p. 71-72

**Summary:** *Deny the effects of a spell targeted on you.*

By angling one's shield correctly he may deflect the power of the spell.

---`;

  ok('it is recognised as a scraper document', looksStructured(DOC));
  const doc = parseStructured(DOC);
  check('the H1 is the subject', doc.title, 'Iron Tortoise');
  check('the blockquote is its description', doc.intro.length, 2);
  check('nothing is stray', doc.strays, []);
  check('entries come off the deepest headings',
    doc.entries.map((e) => e.name), ['Angering Smash', 'Snapping Turtle Stance', 'Burnished Shell']);
  check('and each knows the trail above it',
    doc.entries[2].section, ['Maneuvers & Stances (34 Abilities)', 'Level 3 Maneuvers']);
  check('fields are keyed by their label, lowercased',
    [...doc.entries[0].fields.keys()],
    ['discipline', 'level', 'initiation action', 'range', 'target / area', 'duration', 'source']);
  check('a summary is kept apart from the prose',
    doc.entries[0].summary, 'Melee attack that causes -4 to hit any target but you.');
  ok('and the prose is the rest', /^By making a quick shield bash/.test(doc.entries[0].text));
  ok('a body keeps its paragraphs', /\n\n/.test(doc.entries[1].text));

  const r = parsePaste(DOC);
  check('no blocks -- these are catalogue entries', r.blocks.length, 0);
  check('every entry filed under its discipline',
    [...new Set(r.maneuvers.map((m) => m.discipline))], ['Iron Tortoise']);
  // "1 (Maneuver [Strike])" carries three things at once, the way a
  // discipline's own table prints it.
  check('level, kind and type off the one line',
    r.maneuvers.map((m) => [m.entry.level, m.entry.kind, m.entry.type]),
    [[1, 'maneuver', 'Strike'], [1, 'stance', 'Stance'], [3, 'maneuver', 'Counter']]);
  check('the action normalised', r.maneuvers.map((m) => m.entry.action),
    ['Standard', 'Swift', 'Immediate']);
  check('target read from "Target / Area"', r.maneuvers[0].entry.target, 'One creature');
  check('a duration nobody wrote stays empty', r.maneuvers[2].entry.duration, '');
  // Both halves are worth keeping and there is one cell, so they stack.
  ok('the summary sits over the prose',
    r.maneuvers[0].entry.text.startsWith('Melee attack that causes -4 to hit any target but you.\n\nBy making'));
  // Source and Prerequisite have no cell on a card; saying so beats losing them.
  ok('the report says what was dropped',
    /source and prerequisite lines have no cell/.test(r.report[0]));
  ok('and what was read', /Iron Tortoise: 3 maneuvers/.test(r.report[0]));
  // The document's own description has nowhere to go, so it comes back to be
  // tagged rather than being thrown away.
  check('the description is offered as a note',
    r.leftovers.map((l) => l.suggest), ['note']);
  ok('under its subject', /^Iron Tortoise\nThe discipline known/.test(r.leftovers[0].text));

  // An entry whose fields match no kind is a leftover, not a silent loss --
  // which is what keeps the scraper free to grow ahead of this reader.
  const FUTURE = `# Dwarf

## Traits

#### Darkvision

* **Type:** Racial
* **Range:** 60 ft.
* **Source:** Core p. 21

Dwarves can see in the dark up to 60 feet.

---`;
  const f = parsePaste(FUTURE);
  check('an unknown kind reaches the review instead of vanishing', f.maneuvers.length, 0);
  ok('with its fields intact to read', /Type: Racial/.test(f.leftovers.map((l) => l.text).join('\n')));
  ok('and the report says so', /nothing here matched a kind this reader knows/.test(f.report[0]));
}

console.log('a markdown copy of a page is not a scraper document');
{
  // A "copy as markdown" browser extension produces headings and bold too;
  // those pages still go to the readers that know their shape.
  ok('headings and bold alone are not enough', !looksStructured(`## Barbarian

**Hit Die:** d12.

Some flavour text about rage.`));
  ok('but a field list is', looksStructured(`# Thing

* **One:** a
* **Two:** b
* **Three:** c`));
}

console.log('a sphere page -- the table of contents is the parse');
{
  /*
   * A Spheres of Might page, cut down but keeping every shape that matters:
   * the side menu (which lists other spheres, and must not be mistaken for
   * content), the breadcrumb that says which wiki this is, the table of
   * contents that names every heading, a base ability, a table, and talents
   * across three groups carrying both kinds of tag.
   *
   * The page runs its contents straight into the article with no blank line
   * between, which used to cost the sphere's own description.
   */
  const BOXING = `site-name
.wikidot.com
Share on twitter Facebook Delicious Digg Reddit RedditExplore »

Spheres of Power Wiki
A Quick Reference Site
Home
Combat Spheres

Boxing
Brute
Wrestling

Page tags

home
Boxing
Spheres of Power Wiki Home Page » Spheres Of Might » Boxing
Fold
Table of Contents
Counter Punch
Table: Practitioner Unarmed Damage
Boxing Talents
Corkscrew Set Up
Elongated Step (stance) [3PP]
Read the Rhythm [utility]
Counter Talents
Clinch (counter)
Disarming Jab (counter) [Apoc]
Legendary Talents
Chasing Assault
Wiggling Kitten, Lunging Lion (stance) [Catgirl HB]
Boxers specialize in fighting with their fists, using their punches and upper bodies to batter their way across the battlefield.
All practitioners of the Boxing sphere gain the following ability:

Counter Punch
You may ready an action to make an attack with a light melee weapon.

You can apply a single talent with the (counter) tag to a counter punch.

Table: Practitioner Unarmed Damage
Level\tDamage (Medium Practitioner)
1-3 talents\t1d4
4-7 talents\t1d6
Boxing Talents
Corkscrew Set Up
As a part of readying an action to perform a counter punch, you can make an attack roll.

Elongated Step (stance) [3PP]
At the start of your turn, you can spend a swift action to use this talent.

Read the Rhythm [utility]
As a move action, you can select one creature within 40 ft. of yourself.

Counter Talents
Clinch (counter)
Whenever you successfully attack with your counter punch, you may attempt to grapple.

Disarming Jab (counter) [Apoc]
Source: Spheres Apocrypha: Pugilists

Whenever you successfully attack with your counter punch, you can make a disarm attempt.

Legendary Talents
Chasing Assault
Prerequisites: Boxing sphere, counter punch ability, Launching Uppercut.

Whenever you launch a hostile creature into the air, you may make an Acrobatics check.

Wiggling Kitten, Lunging Lion (stance) [Catgirl HB]
Prerequisites: Acrobatics 3 ranks, Athletics sphere ((leap) package), Boxing sphere (Gazelle Punch).

While in this stance, you may attempt an Acrobatics check to jump.

Spheres of Might by Drop Dead Studios
Classes
Armiger\tBlacksmith\tCommander
Help  | Terms of Service  | Privacy Powered by Wikidot.com
This website uses cookies. See the Legal & OGL page for important information.`;

  const r = parsePaste(BOXING);
  check('no blocks -- a sphere is a shared table', r.blocks.length, 0);
  const s = r.spheres[0];
  check('the sphere, and which side of the line it is on', [s.name, s.kind], ['Boxing', 'combat']);
  // The description used to be eaten by the contents, which ran to the next
  // blank line and there is not one.
  ok('its own description survives the contents above it', /^Boxers specialize/.test(s.description));
  ok('and the line under it', /gain the following ability:$/.test(s.description));
  check('base abilities, tables among them',
    s.abilities.map((a) => a.name), ['Counter Punch', 'Table: Practitioner Unarmed Damage']);
  ok('a base ability keeps its paragraphs', /\n\n/.test(s.abilities[0].text));
  ok('a table keeps its rows', /1-3 talents\t1d4/.test(s.abilities[1].text));

  check('every talent, in page order, by group',
    s.talents.map((t) => `${t.group}: ${t.name}`), [
      'Boxing Talents: Corkscrew Set Up',
      'Boxing Talents: Elongated Step',
      'Boxing Talents: Read the Rhythm',
      'Counter Talents: Clinch',
      'Counter Talents: Disarming Jab',
      'Legendary Talents: Chasing Assault',
      'Legendary Talents: Wiggling Kitten, Lunging Lion',
    ]);

  /*
   * The tags, which are the point of reading a sphere at all. A (…) tag is a
   * rule the talent carries; a […] tag is nearly always which book it came
   * from -- but [utility] is a rule written in brackets, so the few of those
   * are named rather than guessed at.
   */
  const t = (n) => s.talents.find((x) => x.name === n);
  check('a parenthesised tag is a rule', [t('Clinch').tags, t('Clinch').sources], [['counter'], []]);
  check('a bracketed one is a source', [t('Elongated Step').tags, t('Elongated Step').sources], [['stance'], ['3PP']]);
  check('unless it is one of the rules written that way',
    [t('Read the Rhythm').tags, t('Read the Rhythm').sources], [['utility'], []]);
  check('both kinds at once, and the name left clean',
    [t('Wiggling Kitten, Lunging Lion').tags, t('Wiggling Kitten, Lunging Lion').sources],
    [['stance'], ['Catgirl HB']]);
  // A Source: line says the same as an [Apoc] tag but says which book, so it
  // joins rather than replaces.
  check('a Source line joins the sources', t('Disarming Jab').sources, ['Apoc', 'Spheres Apocrypha: Pugilists']);
  ok('and leaves the text', /^Whenever you successfully/.test(t('Disarming Jab').text));

  check('prerequisites come off the top of the text',
    t('Chasing Assault').prerequisites, 'Boxing sphere, counter punch ability, Launching Uppercut.');
  ok('and the text starts after them', /^Whenever you launch/.test(t('Chasing Assault').text));
  // The nested parens inside a prerequisite are not a tag: only a name's
  // trailing ones are read that way.
  ok('a prerequisite keeps its own brackets',
    /Athletics sphere \(\(leap\) package\)/.test(t('Wiggling Kitten, Lunging Lion').prerequisites));

  ok('the report counts what was read', /Sphere Boxing \(combat\): 2 base abilities, 7 talents in 3 group/.test(r.report[0]));
  // The side menu lists two dozen other spheres; none of them is content.
  check('nothing but the wikidot banner is left over',
    r.leftovers.map((l) => l.text), ['site-name']);
}

console.log('splitTalentName -- tags off a name, both kinds');
check('rules tag', splitTalentName('Clinch (counter)'), { name: 'Clinch', tags: ['counter'], sources: [] });
check('source tag', splitTalentName('Hair Trigger [Apoc]'), { name: 'Hair Trigger', tags: [], sources: ['Apoc'] });
check('both, in page order', splitTalentName('Floating Butterfly (stance) [Youxia HB]'), { name: 'Floating Butterfly', tags: ['stance'], sources: ['Youxia HB'] });
check('no tags at all', splitTalentName('Gazelle Punch'), { name: 'Gazelle Punch', tags: [], sources: [] });
check('a comma in the name is not a tag', splitTalentName('Wiggling Kitten, Lunging Lion'), { name: 'Wiggling Kitten, Lunging Lion', tags: [], sources: [] });

console.log('a class page is not a sphere page -- the heading shape overlaps');
{
  // "…\tSpecial\tCombat Talents" is a class table's header row, not a group
  // heading, and a class page has no Spheres breadcrumb to vouch for one.
  const r = parsePaste(`Blacksmith
Spheres of Power Wiki Home Page » Classes » Blacksmith
Hit Die: d10.
Class Level\tBase Attack Bonus\tFort Save\tSpecial\tCombat Talents
1st\t+1\t+2\tCombat training\t1`);
  check('no sphere read off a class page', r.spheres.length, 0);
  check('the class still is', r.blocks.map((b) => `${b.kind}:${b.name}`), ['class:Blacksmith']);
}

console.log('a martial ability page -- the wiki box into a catalogue entry, not a block');
{
  /*
   * A whole-page copy off the Metzofitz wiki. The information box copies as a
   * label on one line and its value on the next, except Range / Target /
   * Duration, which copy as a small tab-separated table. A maneuver is the one
   * thing the reader does not turn into a block: a discipline is a shared
   * table, so it comes back as the entry and the discipline it belongs under.
   */
  const ROAR = `Anonymous
Library of Metzofitz
Search
Search Library of Metzofitz
Encouraging Roar
NamespacesPageDiscussionPage actionsReadView sourceHistoryPurge
Martial Ability
Encouraging Roar
Information
Discipline
Golden Lion
Category
Maneuver (Boost)
Descriptors
None
Level
1
Prerequisites
None
Initiation Action
1 swift action
Range\tTarget\tDuration
30-ft.\tAllies\tOne round
Sources
Path of War, pg. 63
The disciple lets out shouts of encouragement to bolster his allies in battle.


Navigation
Main page
Recent changes`;

  const r = parsePaste(ROAR);
  check('no blocks -- a maneuver is not one', r.blocks.length, 0);
  check('one maneuver, filed under its discipline',
    r.maneuvers.map((m) => m.discipline), ['Golden Lion']);
  check('every cell the box named', r.maneuvers[0].entry, {
    level: 1, kind: 'maneuver', name: 'Encouraging Roar', type: 'Boost',
    action: 'Swift', range: '30-ft.', target: 'Allies', duration: 'One round',
    save: '', dc: '',
    text: 'The disciple lets out shouts of encouragement to bolster his allies in battle.',
  });
  check('nothing left over', r.leftovers.length, 0);
  // The three box lines a card has nowhere to put are said to be left out
  // rather than wedged into the description.
  ok('the report says what was dropped', /Sources line has no cell/.test(r.report[0]));
  ok('and what was read', /Maneuver Encouraging Roar \(Golden Lion, level 1\)/.test(r.report[0]));

  // A stance, with a saving throw, and the abbreviations the wiki uses.
  const STANCE = `Martial Ability
Iron Shell
Information
Discipline
Iron Tortoise
Category
Stance
Level
3
Initiation Action
1 swift action
Range\tTarget\tDuration
Personal\tYou\tStance
Saving Throw
Fort
You raise your shield.`;
  const s = parsePaste(STANCE).maneuvers[0];
  check('a stance is read as one', [s.entry.kind, s.entry.type, s.entry.level], ['stance', 'Stance', 3]);
  check('and its save is spelt out', s.entry.save, 'Fortitude');
  check('personal range and target', [s.entry.range, s.entry.target], ['Personal', 'You']);

  // A save the list has never heard of is kept as written rather than guessed
  // at -- "Will negates" is not "Will", and the qualifier is the useful half.
  const QUALIFIED = `Martial Ability
Crushing Blow
Information
Discipline
Primal Fury
Category
Maneuver (Strike)
Level
2
Initiation Action
1 standard action
Saving Throw
Will negates
You strike hard.`;
  const q = parsePaste(QUALIFIED).maneuvers[0];
  check('a qualified save is kept whole', q.entry.save, 'Will negates');
  check('and the action normalised', q.entry.action, 'Standard');
}

console.log('splitChunk -- a leftover as name and text for tagging');
check('label line', splitChunk("Editor's Note: Discipline Exchanges\nMore text here."), { name: "Editor's Note", type: null, text: 'Discipline Exchanges\nMore text here.' });
check('typed label', splitChunk('Rage (Ex): A barbarian can rage.'), { name: 'Rage', type: 'Ex', text: 'A barbarian can rage.' });
check('title over a paragraph', splitChunk('Alternate Capstones\nWhen a character reaches 20th level she gains a capstone.'), { name: 'Alternate Capstones', type: null, text: 'When a character reaches 20th level she gains a capstone.' });
check('plain paragraph gets a stub title', splitChunk('All of the following are class features of the warlord.').name, 'All of the following are class…');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
