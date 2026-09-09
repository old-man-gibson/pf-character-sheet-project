/** Tests the monster importer: a stat block off a page into a document the
 *  model runs, with the block's own numbers reproduced and the reload stable.
 *  Needs no fixtures.
 *  Run: node tests/monster-import.test.mjs */
import {
  parseStatBlock, monsterDocument, parseAttacks, readDamage, readSkills, readFeats, readSpeeds,
  describeBlock, MONSTER_TAB_ORDER,
} from '../app/js/monster-import.js';
import { Character, inspectDocument, emptyMonster, normalizeMonster } from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';
import { renderStatBlockPanel } from '../app/js/ui/panels/statblock.js';

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

/*
 * An archdevil's numbers, with the prose cut to a sentence apiece: what is
 * being tested is that every figure a Bestiary prints comes out of the sheet
 * again, and the figures are what make this block hard -- 35 hit dice, a
 * Large size, an AC built of five columns, a sword with four iteratives and a
 * rider beside a pair of natural attacks, Knowledge fanned across six
 * specialities, a telepathy note after the languages.
 */
const BAALZEBUL = `Baalzebul CR 30
Source Bestiary 6 pg. 16
XP 9,830,400
LE Large outsider (devil, evil, extraplanar, lawful)
Init +14; Senses blindsight 120 ft., darkvision 60 ft., true seeing; Perception +49
Aura frightful presence (120 ft., DC 39), shield of law (DC 30)
Defense
AC 48, touch 40, flat-footed 37 (+4 deflection, +10 Dex, +1 dodge, +8 natural, +16 profane, –1 size)
hp 717 (35d10+525); regeneration 30 (deific or mythic)
Fort +30, Ref +30, Will +36; +8 vs. mind-affecting effects
Defensive Abilities infernal resurrection, swarm body; DR 20/epic, good, and silver; Immune cold, fire, poison; Resist acid 30; SR 41
Offense
Speed fly 120 ft. (perfect)
Melee +5 adamantine unholy longsword +53/+48/+43/+38 (2d6+24/17–20 plus 1d6 cold) or 2 slams +47 (8d6+13)
Space 10 ft., Reach 10 ft.
Special Attacks biting blackflies, hellfrost, suffocating swarm
Spell-Like Abilities (CL 30th; concentration +42)
Constant—detect chaos, detect good, mind blank, true seeing
At will—greater dispel magic, greater teleport, icy prison (DC 27)
1/day—mass suffocation (DC 31), time stopM, wishM
M Baalzebul can use this ability’s mythic version in his infernal realm.
Statistics
Str 36, Dex 30, Con 41, Int 35, Wis 32, Cha 35
Base Atk +35; CMB +49; CMD 90 (can’t be tripped)
Feats Critical Focus, Dodge, Empower Spell- Like Ability (cone of cold), Improved Critical (longsword), Improved Initiative, Skill Focus (Bluff)
Skills Acrobatics +48, Bluff +56, Fly +54, Knowledge (arcana, history, local, nobility, religion) +47, Knowledge (planes) +50, Perception +49, Stealth +44
Languages all (language mastery); telepathy 300 ft.
SQ lord of the flies, swarm master
Ecology
Environment any (Hell)
Organization solitary (unique)
Treasure triple (+5 adamantine unholy longsword, other treasure)
Special Abilities
Biting Blackflies (Ex) The first time in a round a creature strikes him in melee it takes 7d6 points of damage and must succeed at a DC 42 Fortitude save or be nauseated. The save DC is Constitution-based.

Hellfrost (Su) Half of any cold damage dealt by Baalzebul is unholy damage.

Swarm Body (Ex) Baalzebul’s body is composed of millions of tiny flies.
Description
Baalzebul was once the chief lieutenant of the Prince of Darkness.

Baalzebul resembles a 15-foot-tall armored angel and has a body composed of flies.
`;

console.log('the reader takes a Bestiary block apart');
{
  const b = parseStatBlock(BAALZEBUL);
  check('name and CR', [b.name, b.cr, b.xp], ['Baalzebul', '30', 9830400]);
  check('the alignment line', [b.alignment, b.size, b.type, b.subtypes], ['Lawful Evil', 'Large', 'outsider', ['devil', 'evil', 'extraplanar', 'lawful']]);
  check('init, perception, senses', [b.init, b.perception, b.senses.startsWith('blindsight')], [14, 49, true]);
  check('the AC line and its parts', [b.ac, b.touch, b.flatFooted, b.acParts.map((p) => `${p.amount} ${p.type}`)],
    [48, 40, 37, ['4 deflection', '10 Dex', '1 dodge', '8 natural', '16 profane', '-1 size']]);
  check('hit points and hit dice', [b.hp, b.hd, b.hitDie, b.hpBonus, b.healing], [717, 35, 10, 525, 'regeneration 30 (deific or mythic)']);
  check('saves and the note after them', [b.fort, b.ref, b.will, b.saveNote], [30, 30, 36, '+8 vs. mind-affecting effects']);
  check('the defence lists', [b.dr, b.immune, b.resist, b.sr], ['20/epic, good, and silver', 'cold, fire, poison', 'acid 30', '41']);
  check('a fly speed keeps its manoeuvrability', b.speeds, [{ type: 'Fly (perfect)', base: 120, note: '' }]);
  check('two attack groups', b.melee.map((a) => [a.name, a.count, a.group, a.attack, a.enhancement]),
    [['adamantine unholy longsword', 1, 0, 53, 5], ['slam', 2, 1, 47, 0]]);
  check('the sword\'s damage, crit and rider', [b.melee[0].dice, b.melee[0].flat, b.melee[0].critRange, b.melee[0].riders],
    ['2d6', 24, 4, [{ dice: '1d6', kind: 'cold' }]]);
  check('space and reach', [b.space, b.reach], ['10 ft.', '10 ft.']);
  check('the spell-like block keeps its lines and footnote', [b.magic.length, b.magic[0].lines.length, b.magic[0].lines[3].startsWith('M ')], [1, 4, true]);
  check('scores', b.abilities, { str: 36, dex: 30, con: 41, int: 35, wis: 32, cha: 35 });
  check('BAB, CMB, CMD and its note', [b.bab, b.cmb, b.cmd, b.cmdNote], [35, 49, 90, 'can’t be tripped']);
  check('feats, a hyphenation artefact mended', b.feats.map((f) => f.name),
    ['Critical Focus', 'Dodge', 'Empower Spell-Like Ability', 'Improved Critical', 'Improved Initiative', 'Skill Focus']);
  check('a feat keeps its parenthetical apart', b.feats[2].detail, 'cone of cold');
  check('knowledge fans out', b.skills.filter((s) => s.name === 'Knowledge').map((s) => s.spec), ['arcana', 'history', 'local', 'nobility', 'religion', 'planes']);
  check('languages keep the telepathy behind the semicolon', b.languages, 'all (language mastery); telepathy 300 ft.');
  check('ecology', [b.environment, b.organization, b.treasure.startsWith('triple')], ['any (Hell)', 'solitary (unique)', true]);
  check('special abilities as paragraphs', b.specialAbilities.map((a) => [a.name, a.type]),
    [['Biting Blackflies', 'Ex'], ['Hellfrost', 'Su'], ['Swarm Body', 'Ex']]);
  ok('a two-line description keeps its break', /flies\.$/.test(b.description) && b.description.includes('\n'));
  check('nothing left unread, nothing to warn of', [b.unread, b.warnings], [[], []]);
  ok('the one-line summary', describeBlock(b).startsWith('CR 30 · 35 HD · AC 48 · 717 hp'));
}

console.log('the pieces read on their own');
{
  check('an attack with a touch and a trailing note', parseAttacks('incorporeal touch +12 touch (1d8 plus energy drain), 2 wings +8 (1d6+2)').map((a) => [a.name, a.touch, a.count, a.riders, a.notes]),
    [['incorporeal touch', true, 1, [], 'energy drain'], ['wing', false, 2, [], '']]);
  check('a crit multiplier', readDamage('1d8+4/x3'), { dice: '1d8', flat: 4, critRange: 1, critMult: 3, riders: [], notes: '' });
  check('a range and a rider', readDamage('2d6+7/19-20 plus grab'), { dice: '2d6', flat: 7, critRange: 2, critMult: 2, riders: [], notes: 'grab' });
  check('skills with a note', readSkills('Stealth +12 (+16 in forests), Craft (traps) +9'),
    [{ name: 'Stealth', spec: null, bonus: 12, note: '+16 in forests' }, { name: 'Craft', spec: 'traps', bonus: 9, note: '' }]);
  check('a bonus feat superscript', readFeats('ToughnessB, Weapon Focus (bite)'), [{ name: 'Toughness', detail: '' }, { name: 'Weapon Focus', detail: 'bite' }]);
  check('a land speed and a swim speed', readSpeeds('30 ft., swim 20 ft.'), [{ type: 'Land', base: 30, note: '' }, { type: 'Swim', base: 20, note: '' }]);
  const one = parseStatBlock('Rat CR 1/4\nN Tiny animal\nAC 14, touch 14, flat-footed 12 (+2 Dex, +2 size)\nhp 4 (1d8)\nStr 2, Dex 15, Con 11, Int 2, Wis 13, Cha 2');
  check('a fraction CR and a headless block', [one.cr, one.size, one.hd, one.hpBonus, one.abilities.str], ['1/4', 'Tiny', 1, 0, 2]);
  const none = parseStatBlock('just some words\nand more of them');
  ok('no block at all still names something and warns', none.name === 'just some words' && none.warnings.length >= 2);
}

console.log('the document reproduces the block, and holds on reload');
{
  const doc = monsterDocument(parseStatBlock(BAALZEBUL), { createdAt: '2026-01-01T00:00:00' });
  const verdict = inspectDocument(doc);
  check('it passes the gate the picker applies', [verdict.ok, verdict.summary.cr, verdict.summary.level], [true, '30', 35]);
  check('kind, tab bar', [doc.source.kind, doc.uiPrefs.tabOrder], ['monster', MONSTER_TAB_ORDER]);
  const m = new Character(doc);
  const c = m.data;
  check('identity', [c.identity.level, c.identity.size, c.identity.race, c.identity.alignment],
    [35, 'Large', 'Outsider (devil, evil, extraplanar, lawful)', 'Lawful Evil']);
  check('the hit dice as a class row', [c.classes[0].name, c.classes[0].hd, c.classes[0].bab, c.classes[0].skillRanks], ['Outsider', 10, 1, 6]);
  check('AC, touch, flat-footed, CMD', [c.defenses.ac, c.defenses.touch, c.defenses.flatFooted, c.defenses.cmd], [48, 40, 37, 90]);
  check('the AC is explained by its columns alone', [m.offsets['defenses.ac'], m.offsets['defenses.touch'], m.offsets['defenses.flatFooted'], m.offsets['defenses.cmd']], [0, 0, 0, 0]);
  check('ABP stays out of a monster', [c.defenses.acBonuses.abpDeflection, c.defenses.acBonuses.abpNatural, c.saves.fortitude.bonuses.abpResistance], [0, 0, 0]);
  check('hit points, initiative', [c.hp.total, c.hp.initiative, m.offsets.initiative], [717, 14, 4]);
  check('saves', [c.saves.fortitude.total, c.saves.reflex.total, c.saves.will.total], [30, 30, 36]);
  check('BAB, melee, CMB', [c.attack.bab, c.attack.totalMelee, c.attack.totalCmb, m.offsets['attack.totalCmb']], [35, 49, 49, 0]);
  const [sword, slam] = c.equipment.weapons;
  check('the sword: to hit, damage explained as 1.5 Str + 5, the rider as a token', [sword.attackTotal, sword.damageTotal, sword.abilityMult, sword.miscDamage, sword.special, sword.critRange, sword.count],
    [53, '2d6+24', 1.5, 0, '[[1d6]] cold', 4, 1]);
  check('the slams: two of them, secondary attack in the offset', [slam.attackTotal, slam.damageTotal, slam.count, slam.attackOffset, slam.natural], [47, '8d6+13', 2, -2, true]);
  const skill = (name) => c.skills.find((s) => s.name === name);
  check('a listed skill: ranks that explain it, class skill, the rest in Misc', [skill('Bluff').bonus, skill('Bluff').totalRanks, skill('Bluff').classSkill, skill('Bluff').offset], [56, 35, true, 6]);
  check('a fanned Knowledge lands on its row', [skill('Kn. (planes)').bonus, skill('Kn. (arcana)').bonus, skill('Kn. (nature)').totalRanks], [50, 47, 0]);
  check('an unlisted skill is its ability modifier, and reconciles to nothing', [skill('Diplomacy').bonus, skill('Diplomacy').offset], [12, 0]);
  check('feats as one group', [c.featGroups[0].name, c.featGroups[0].entries.length, c.featGroups[0].entries[2]], ['Feats', 6, { name: 'Empower Spell-Like Ability', detail: 'cone of cold', note: '' }]);
  check('special abilities as race traits', c.raceTraits.map((t) => t.name), ['Biting Blackflies (Ex)', 'Hellfrost (Su)', 'Swarm Body (Ex)']);
  check('the defence boxes parse', [c.defenses.calc.drText, c.defenses.calc.sr.total, c.defenses.calc.resistanceText], ['20/epic, good, and silver', 41, 'acid 30']);
  check('the block\'s own lines', [c.monster.cr, c.monster.xp, c.monster.space, c.monster.languagesNote, c.monster.spellLike.split('\n').length, c.monster.abp],
    ['30', 9830400, '10 ft.', 'telepathy 300 ft.', 5, false]);
  check('languages', c.identity.languages, ['all (language mastery)']);
  check('nothing drifted from the source', m.diffFromSource(), []);

  const again = new Character(m.toJSON());
  check('reload keeps every figure', [again.data.defenses.ac, again.data.defenses.cmd, again.data.saves.fortitude.total, again.data.hp.total, again.data.equipment.weapons.map((w) => w.attackTotal), again.data.skills.find((s) => s.name === 'Bluff').bonus],
    [48, 90, 30, 717, [53, 47], 56]);
  check('and the session bar leads with the block', again.sessionDefaultTabs()[0], 'statblock');

  // A score edited moves the block the way it moves everything else: two
  // points of Strength are a point of modifier, which is +1 to hit and, at
  // one and a half times, +2 damage.
  m.setBuild('str', 'race', 28);
  check('two points of Strength move the sword', [m.data.abilities.str.score, m.data.equipment.weapons[0].attackTotal, m.data.equipment.weapons[0].damageTotal], [38, 54, '2d6+26']);
}

console.log('the Stat Block tab prints the block, and prints a character too');
{
  const m = new Character(monsterDocument(parseStatBlock(BAALZEBUL), { createdAt: '2026-01-01T00:00:00' }));
  const html = renderStatBlockPanel(m, {});
  for (const bit of ['CR 30', 'XP</b> 9,830,400', 'LE Large outsider (devil, evil, extraplanar, lawful)', '+53/+48/+43/+38', '2 slams +47 (8d6+13)',
    '(+4 deflection, +10 Dex, +1 dodge, +8 natural, +16 profane, -1 size)', '717 (35d10+525)', 'DR</b> 20/epic, good, and silver',
    'fly 120 ft. (perfect)', 'Biting Blackflies (Ex)', 'Bluff +56', 'telepathy 300 ft.', 'Environment</b> any (Hell)']) {
    ok(`the block prints ${bit}`, html.includes(bit));
  }
  ok('no sub-system cards on a creature with none', !html.includes('From the sub-systems'));
  m.toggleClassSystem(0, 'vancian');
  ok('a system marked on the class row brings its card', renderStatBlockPanel(m, {}).includes('From the sub-systems'));

  const pc = new Character(blankDocument({ name: 'Kaito', level: 5, createdAt: '2026-01-01T00:00:00' }));
  const pcHtml = renderStatBlockPanel(pc, {});
  ok('a character prints as an NPC block with a level for a CR', pcHtml.includes('Level 5') && pcHtml.includes('Give this character a monster block'));
  pc.set('monster', { ...emptyMonster(), abp: true, cr: '4' });
  check('a block given to a character keeps its progression', [pc.data.defenses.acBonuses.abpDeflection, pc.data.monster.cr], [1, '4']);
  check('the block normalises its subtypes from text', normalizeMonster({ subtypes: 'devil, evil' }).subtypes, ['devil', 'evil']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
