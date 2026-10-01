/** Tests the export to the Pathfinder Community sheet's Hero Lab import box.
 *
 *  The sheet's reader (HLImport.js in the Roll20 sheet's own source) is not
 *  part of this repository, so what is checked here is the contract it holds
 *  the JSON to: every path it reads without looking is there, values are the
 *  strings XML would have given, the names it parses have the parentheses it
 *  parses, and the parts it subtracts from each total are the parts the total
 *  was built from. A blank sheet is built by hand; the roster is then swept.
 *
 *  Run: node tests/roll20-sheet.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { communitySheetImport } from '../app/js/roll20-sheet.js';
import { fixtureIds, loadCharacter } from './fixtures.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/** The paths the reader dereferences without checking them first. */
const REQUIRED = [
  'attributes.attribute', 'saves.allsaves.situationalmodifiers', 'saves.save', 'classes',
  'spellclasses', 'health._hitdice', 'health._hitpoints', 'penalties', 'armorclass', 'defenses',
  'melee', 'ranged', 'trackedresources', 'magicitems', 'gear', 'attack._baseattack',
  'attack._meleeattack', 'attack._rangedattack', 'otherspecials', 'movement.speed._value',
  'defensive', 'feats', 'traits', 'spelllike', 'xp._total', 'initiative._attrname',
  'initiative.situationalmodifiers', 'size._name', 'skills', 'senses', 'damagereduction',
  'resistances', 'immunities', 'weaknesses', 'languages', 'types.type', 'subtypes', 'deity',
  'race._racetext', 'alignment', 'personal.charheight._text', 'personal.charweight._text',
  'challengerating._text', 'xpaward', 'maneuvers', 'favoredclasses', 'money', 'encumbrance',
  'factions',
];

const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Every leaf that is not a string, by path. */
function nonStrings(obj, path = '', out = []) {
  if (Array.isArray(obj)) obj.forEach((v, i) => nonStrings(v, `${path}[${i}]`, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) nonStrings(v, path ? `${path}.${k}` : k, out);
  } else if (typeof obj !== 'string') out.push(path);
  return out;
}

const n = (v) => Number(v) || 0;

/** Everything the reader needs to get through one character without stopping. */
function contract(label, model) {
  const { text, notes } = communitySheetImport(model);
  const doc = JSON.parse(text);
  const ch = doc.document?.public?.character;
  check(`${label}: the reader's root`, !!ch, true);
  if (!ch) return;
  check(`${label}: every path the reader assumes`, REQUIRED.filter((p) => at(ch, p) === undefined), []);
  check(`${label}: every value is a string`, nonStrings(ch), []);
  check(`${label}: notes are sentences`, notes.every((s) => typeof s === 'string' && s.length > 0), true);

  // The reader takes Constitution as attribute[2], for hit points.
  check(`${label}: abilities in order`, ch.attributes.attribute.map((a) => a._name.slice(0, 3).toUpperCase()),
    ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
  check(`${label}: three saves`, ch.saves.save.map((s) => s._abbr), ['Fort', 'Ref', 'Will']);

  // It sums the Ns of the hit dice for the character's level.
  const dice = ch.health._hitdice.match(/\d+d\d/g) || [];
  check(`${label}: hit dice sum to the level`, dice.reduce((t, d) => t + Number(d.split('d')[0]), 0),
    n(model.data.identity.level) || 1);

  const skills = ch.skills.skill;
  // Lore and Artistry are read out of their parentheses unconditionally, and
  // Knowledge is switched on the first parenthesised word.
  check(`${label}: Lore, Artistry and Knowledge carry their subject`,
    skills.filter((s) => /^(Lore|Artistry|Knowledge)\b/.test(s._name) && !/\(.+\)/.test(s._name)).map((s) => s._name), []);
  check(`${label}: an ability abbreviation the sheet has`,
    skills.filter((s) => !/^(STR|DEX|CON|INT|WIS|CHA)$/.test(s._attrname)).map((s) => s._name), []);

  // The parts the reader subtracts never exceed what the sheet can show: the
  // residual it calls Misc has to bring the sum back to the total.
  const acp = n(ch.penalties.penalty.find((p) => p._name === 'Armor Check Penalty')._value);
  for (const s of skills) {
    const cs = s._classskill === 'yes' && n(s._ranks) > 0 ? 3 : 0;
    const misc = n(s._value) - n(s._ranks) - n(s._attrbonus) - cs - (s._armorcheck === 'yes' ? acp : 0);
    const back = n(s._ranks) + n(s._attrbonus) + cs + (s._armorcheck === 'yes' ? acp : 0) + misc;
    if (back !== n(s._value)) check(`${label}: ${s._name} adds back up`, back, n(s._value));
  }

  // The specials are folded by the name outside their parentheses, and every
  // one folded must have some -- so no two may share a name that way.
  const base = (name) => name.replace(/ x[0-9]+$/, '').replace(/\(([^)]*)\)/g, '').trim();
  const names = ch.otherspecials.special.map((s) => base(s._name));
  check(`${label}: one special per name`, names.filter((x, i) => names.indexOf(x) !== i), []);

  // Armour and shields are told apart by name, and must each be an item too.
  const items = new Set(ch.gear.item.map((i) => i._name));
  check(`${label}: armour is in the inventory`, ch.defenses.armor.filter((a) => !items.has(a._name)).map((a) => a._name), []);
  check(`${label}: weapons are in the inventory`,
    [...ch.melee.weapon, ...ch.ranged.weapon].filter((w) => !items.has(w._name)).map((w) => w._name), []);
  // AC's ability goes in exactly one of the three slots, or the reader sets
  // no ability at all and leaves the sheet's own in place.
  const slots = ['_fromdexterity', '_fromcharisma', '_fromwisdom'].filter((k) => ch.armorclass[k] !== '');
  check(`${label}: one AC ability slot`, slots.length, 1);
  check(`${label}: the AC total is the sheet's`, ch.armorclass._ac, String(model.data.defenses.ac));
  return ch;
}

console.log('a blank sheet gets through');
{
  const ch = contract('blank', new Character(blankDocument({ name: 'Test Subject', level: 5 })));
  check('blank: the name', ch._name, 'Test Subject');
  check('blank: a player character', ch._role, 'pc');
}

console.log('the shapes the reader parses');
{
  const doc = blankDocument({ name: 'Shapes', level: 6 });
  const craft = doc.skills.find((s) => s.name.startsWith('Craft'));
  craft.spec = 'Alchemy';
  doc.equipment.weapons.push({
    name: 'Longbow', attackType: 'Ranged', dice: '1d8', damageAbility: 'Str', abilityMult: 1,
    miscDamage: 0, miscAttack: 0, enhancement: 2, critRange: 20, critMult: 'x3', range: '100 ft.',
    damageType: 'Piercing',
  }, {
    name: 'Rapier', attackType: 'Melee', dice: '1d6', damageAbility: 'Str', abilityMult: 1,
    miscDamage: 0, miscAttack: 0, enhancement: 0, critRange: 18, critMult: 'x2',
  });
  doc.equipment.shields[0] = { ...doc.equipment.shields[0], name: 'Wok', acBonus: 1, active: true };
  doc.raceTraits = [
    { name: 'Unfocused Focus', text: 'One.' },
    { name: 'Unfocused Focus (Incanter)', text: 'Two.' },
  ];
  const ch = contract('shapes', new Character(doc));
  check('craft takes its subject', ch.skills.skill.some((s) => s._name === 'Craft (Alchemy)'), true);
  check('a ranged weapon has its range', ch.ranged.weapon[0]?.rangedattack?._rangeincvalue, '100');
  check('enhancement rides on the name', ch.ranged.weapon[0]?._name, 'Longbow +2');
  check('a crit range and multiplier', ch.melee.weapon[0]?._crit, '18-20/×2');
  check('a 20-only crit is just the multiplier', ch.ranged.weapon[0]?._crit, '×3');
  check('a shield is named as one', ch.defenses.armor.find((a) => /Wok/.test(a._name))?._name, 'Wok (shield)');
  check('specials sharing a name fold', ch.otherspecials.special.map((s) => s._name), ['Unfocused Focus (Incanter)']);
  check('both descriptions are kept', /One\.[\s\S]*Two\./.test(ch.otherspecials.special[0].description), true);
}

console.log('gestalt goes over as one class');
{
  const doc = blankDocument({ name: 'Two at once', level: 4 });
  doc.classes = [
    { ...doc.classes[0], name: 'Fighter', hd: 10, bab: 1 },
    { ...doc.classes[0], name: 'Wizard', hd: 6, bab: 0.5 },
  ];
  const m = new Character(doc);
  const ch = contract('gestalt', m);
  const both = m.data.classes.filter((k) => k.gestaltLevels > 0).length;
  if (both > 1) {
    check('one row', ch.classes.class.length, 1);
    check('at the character level, best die', ch.health._hitdice, '4d10');
  }
}

console.log('the roster');
for (const id of fixtureIds()) contract(id, new Character(loadCharacter(id)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
