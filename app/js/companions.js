/**
 * Companions: the familiar, the animal companion and the eidolon.
 *
 * The workbook kept one worksheet for each, every number on it a formula
 * against a lookup block on `dataSheet` -- the familiar's Intelligence and
 * natural-armour ladder, the animal companion's and eidolon's HD / BAB / save
 * / skill / feat progressions by class level, the natural-attack catalogue and
 * the body-type item slots. Those tables live here, together with the sums
 * the sheet did on them, so the three tabs read the way the rest of the app
 * does: what the player typed is stored, and everything else is worked out.
 *
 * Every function here is pure. `computeCompanion(kind, block, master)` takes
 * the stored block and a small snapshot of the master (level, BAB, hit points,
 * base saves, skill ranks, class levels) and returns the derived numbers; the
 * model writes them onto the block and strips them again on save.
 *
 * Where the sheet's own formulas contradicted the tables they read (indexing
 * the level-keyed progression by HD, adding natural armour into touch AC), the
 * sums here follow the table and the rulebook -- see the notes on each.
 */

import { ABILITIES, ABILITY_LABELS, SIZE_MODIFIERS, abilityMod, skillTotal } from './rules.js';
import { slug } from './model/util.js';

export const COMPANION_KINDS = ['familiar', 'animalCompanion', 'eidolon'];

export const COMPANION_LABELS = {
  familiar: 'Familiar',
  animalCompanion: 'Animal Companion',
  eidolon: 'Eidolon',
};

/** The worksheet each kind was imported from. */
export const COMPANION_TABS = {
  familiar: 'Familiar',
  animalCompanion: 'Animal Companion',
  eidolon: 'Eidolon',
};

/* ------------------------------------------------------------------ *
 * Progressions, one row per master level (index 0 = level 1).
 * ------------------------------------------------------------------ */

/**
 * Familiar, from `dataSheet!G104:J123`: the natural-armour adjustment and
 * Intelligence a familiar has at its master's level, and what it gains there.
 * A familiar's HD, BAB and base saves are its master's, so the table carries
 * nothing else.
 */
export const FAMILIAR_TABLE = [
  [1, 6, 'Alertness, improved evasion, share spells, empathic link'],
  [1, 6, ''],
  [2, 7, 'Deliver touch spells'],
  [2, 7, ''],
  [3, 8, 'Speak with master'],
  [3, 8, ''],
  [4, 9, 'Speak with animals of its kind'],
  [4, 9, ''],
  [5, 10, ''],
  [5, 10, ''],
  [6, 11, 'Spell resistance'],
  [6, 11, ''],
  [7, 12, 'Scry on familiar'],
  [7, 12, ''],
  [8, 13, ''],
  [8, 13, ''],
  [9, 14, ''],
  [9, 14, ''],
  [10, 15, ''],
  [10, 15, ''],
].map(([naturalArmor, int, special]) => ({ naturalArmor, int, special }));

/**
 * Animal companion, from `dataSheet!A125:L144`: HD, BAB, good and poor base
 * saves, skill ranks, feats, natural armour, the Str/Dex bonus, bonus tricks
 * and the special ability gained, by the master's effective druid level.
 */
export const ANIMAL_COMPANION_TABLE = [
  [2, 1, 3, 0, 2, 1, 0, 0, 1, 'Link, share spells'],
  [3, 2, 3, 1, 3, 2, 0, 0, 1, ''],
  [3, 2, 3, 1, 3, 2, 2, 1, 2, 'Evasion'],
  [4, 3, 4, 1, 4, 2, 2, 1, 2, 'Ability score increase'],
  [5, 3, 4, 1, 5, 3, 2, 1, 2, ''],
  [6, 4, 5, 2, 6, 3, 4, 2, 3, 'Devotion'],
  [6, 4, 5, 2, 6, 3, 4, 2, 3, ''],
  [7, 5, 5, 2, 7, 4, 4, 2, 3, ''],
  [8, 6, 6, 2, 8, 4, 6, 3, 4, 'Ability score increase, Multiattack'],
  [9, 6, 6, 3, 9, 5, 6, 3, 4, ''],
  [9, 6, 6, 3, 9, 5, 6, 3, 4, ''],
  [10, 7, 7, 3, 10, 5, 8, 4, 5, ''],
  [11, 8, 7, 3, 11, 6, 8, 4, 5, ''],
  [12, 9, 8, 4, 12, 6, 8, 4, 5, 'Ability score increase'],
  [12, 9, 8, 4, 12, 6, 10, 5, 6, 'Improved evasion'],
  [13, 9, 8, 4, 13, 7, 10, 5, 6, ''],
  [14, 10, 9, 4, 14, 7, 10, 5, 6, ''],
  [15, 11, 9, 5, 15, 8, 12, 6, 7, ''],
  [15, 11, 9, 5, 15, 8, 12, 6, 7, ''],
  [16, 12, 10, 5, 16, 8, 12, 6, 7, 'Ability score increase'],
].map(([hd, bab, goodSave, poorSave, skills, feats, naturalArmor, strDex, tricks, special]) => ({
  hd, bab, goodSave, poorSave, skills, feats, naturalArmor, strDex, tricks, special,
}));

/**
 * Eidolon, from `dataSheet!A147:L166`: HD, BAB, saves, skill ranks, feats,
 * armour bonus, the Str/Dex bonus, the evolution pool and the attack cap, by
 * summoner level.
 */
export const EIDOLON_TABLE = [
  [1, 1, 2, 0, 4, 1, 0, 0, 1, 3, 'Darkvision, link, share spells'],
  [2, 2, 3, 0, 8, 1, 2, 1, 2, 3, 'Evasion'],
  [3, 3, 3, 1, 12, 2, 2, 1, 3, 3, ''],
  [3, 3, 3, 1, 12, 2, 2, 1, 3, 4, ''],
  [4, 4, 4, 1, 16, 2, 4, 2, 4, 4, 'Ability score increase'],
  [5, 5, 4, 1, 20, 3, 4, 2, 5, 4, 'Devotion'],
  [6, 6, 5, 2, 24, 3, 6, 3, 6, 4, ''],
  [6, 6, 5, 2, 24, 3, 6, 3, 6, 4, ''],
  [7, 7, 5, 2, 28, 4, 6, 3, 7, 5, 'Multiattack'],
  [8, 8, 6, 2, 32, 4, 8, 4, 8, 5, 'Ability score increase'],
  [9, 9, 6, 3, 36, 5, 8, 4, 9, 5, ''],
  [9, 9, 6, 3, 36, 5, 10, 5, 9, 5, ''],
  [10, 10, 7, 3, 40, 5, 10, 5, 10, 5, ''],
  [11, 11, 7, 3, 44, 6, 10, 5, 11, 6, 'Improved evasion'],
  [12, 12, 8, 4, 48, 6, 12, 6, 12, 6, 'Ability score increase'],
  [12, 12, 8, 4, 48, 6, 12, 6, 12, 6, ''],
  [13, 13, 8, 4, 52, 7, 14, 7, 13, 6, ''],
  [14, 14, 9, 4, 56, 7, 14, 7, 14, 6, ''],
  [15, 15, 9, 5, 60, 8, 14, 7, 15, 7, ''],
  [15, 15, 9, 5, 60, 8, 16, 8, 15, 7, ''],
].map(([hd, bab, goodSave, poorSave, skills, feats, naturalArmor, strDex, evoPool, maxAttacks, special]) => ({
  hd, bab, goodSave, poorSave, skills, feats, naturalArmor, strDex, evoPool, maxAttacks, special,
}));

/** The levels at which each kind gets a +1 to one ability score of its choice. */
export const ABILITY_INCREASE_LEVELS = {
  familiar: [],
  animalCompanion: [4, 9, 14, 20],
  eidolon: [5, 10, 15],
};

/**
 * Natural attacks, from `dataSheet!A112:C123`: the damage type each deals and
 * whether it is primary (full attack bonus) or secondary (-5, or -2 with
 * Multiattack).
 */
export const NATURAL_ATTACKS = [
  ['Bite', 'B, P, and S', true],
  ['Claw', 'B and S', true],
  ['Gore', 'P', true],
  ['Hoof', 'B', false],
  ['Tentacle', 'B', false],
  ['Wing', 'B', false],
  ['Pincers', 'B', false],
  ['Slam', 'B', false],
  ['Sting', 'B', true],
  ['Talons', 'P', true],
  ['Tail Slap', 'S', true],
  ['Other', 'B, P, or S', false],
].map(([name, damageType, primary]) => ({ name, damageType, primary }));

export const naturalAttack = (name) => NATURAL_ATTACKS
  .find((a) => a.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

/**
 * Body types and the item slots each can use, from `dataSheet!A168:R177`, and
 * whether the shape can grasp (hold a wand, open a door).
 */
export const BODY_TYPES = [
  ['Avian', ['Armor', 'Belt', 'Chest (saddle)', 'Eyes', 'Head', 'Headband', 'Neck', 'Ring 1', 'Ring 2', 'Wrist'], true],
  ['Biped (claws/paws)', ['Armor', 'Belt', 'Chest', 'Eyes', 'Head', 'Headband', 'Neck', 'Ring 1', 'Ring 2', 'Shoulders', 'Wrist'], true],
  ['Biped (hands)', ['Armor', 'Belt', 'Body', 'Chest', 'Eyes', 'Feet', 'Hands', 'Head', 'Headband', 'Neck', 'Ring 1', 'Ring 2', 'Shield', 'Shoulders', 'Wrists'], true],
  ['Piscine', ['Belt', 'Chest (saddle)', 'Eyes'], false],
  ['Quadruped (claws)', ['Armor', 'Belt (saddle)', 'Chest', 'Eyes', 'Head', 'Headband', 'Neck', 'Shoulders', 'Wrist'], false],
  ['Quadruped (hooves)', ['Armor', 'Belt (saddle)', 'Chest', 'Eyes', 'Feet (horseshoes)', 'Head', 'Headband', 'Neck', 'Shoulders'], false],
  ['Quadruped (other)', ['Armor', 'Belt (saddle)', 'Chest', 'Eyes', 'Head', 'Headband', 'Neck', 'Shoulders', 'Wrist'], false],
  ['Quadruped (short legs)', ['Armor', 'Eyes', 'Head', 'Headband', 'Neck', 'Shoulders'], false],
  ['Serpentine', ['Belt', 'Eyes', 'Headband'], false],
  ['Unusual (plant and vermin)', ['Belt', 'Eyes'], false],
].map(([name, slots, canGrasp]) => ({ name, slots, canGrasp }));

export const bodyType = (name) => BODY_TYPES.find((b) => b.name === name) || null;

/** How the animal companion's level is found: a class, or a skill's ranks. */
export const COMPANION_LEVEL_SOURCES = [
  ['class', 'Levels in a class'],
  ['handleAnimal', 'Handle Animal ranks'],
  ['ride', 'Ride ranks'],
];

/* ------------------------------------------------------------------ *
 * Skill lists -- the rows each worksheet came with.
 * ------------------------------------------------------------------ */

const S = (name, ability, trained = false, classSkill = false, spec = '') => ({
  name, spec, ability, trained, classSkill, ranks: 0, misc: 0,
});

/** The familiar's and eidolon's full list (the worksheet's, less the blank repeats). */
const FULL_SKILLS = (cls) => [
  S('Acrobatics', 'Dex', false, cls.has('Acrobatics')),
  S('Appraise', 'Int'),
  S('Autohypnosis', 'Wis', true),
  S('Bluff', 'Cha', false, cls.has('Bluff')),
  S('Climb', 'Str', false, cls.has('Climb')),
  S('Craft', 'Int', false, cls.has('Craft')),
  S('Diplomacy', 'Cha'),
  S('Disable Device', 'Dex', true),
  S('Disguise', 'Cha'),
  S('Escape Artist', 'Dex'),
  S('Fly', 'Dex'),
  S('Handle Animal', 'Cha', true),
  S('Heal', 'Wis'),
  S('Intimidate', 'Cha'),
  ...['arcana', 'dungeoneering', 'engineering', 'geography', 'history', 'local', 'martial',
    'nature', 'nobility', 'planes', 'psionics', 'religion']
    .map((k) => S(`Kn. (${k})`, 'Int', true, cls.has(`Kn. (${k})`))),
  S('Linguistics', 'Int', true),
  S('Perception', 'Wis', false, cls.has('Perception')),
  S('Perform', 'Cha'),
  S('Profession', 'Wis', true),
  S('Ride', 'Dex'),
  S('Sense Motive', 'Wis', false, cls.has('Sense Motive')),
  S('Sleight of Hand', 'Dex', true),
  S('Spellcraft', 'Int', true),
  S('Stealth', 'Dex', false, cls.has('Stealth')),
  S('Survival', 'Wis'),
  S('Swim', 'Str', false, cls.has('Swim')),
  S('Use Magic Device', 'Cha', true),
];

/** The rows each worksheet seeds, with the class skills it ticked. */
export function seedSkills(kind) {
  if (kind === 'animalCompanion') {
    // The worksheet's shorter, animal-shaped list.
    return [
      S('Acrobatics', 'Dex', false, true), S('Climb', 'Str', false, true), S('Escape Artist', 'Dex'),
      S('Fly', 'Dex', false, true), S('Intimidate', 'Cha'), S('Perception', 'Wis', false, true),
      S('Stealth', 'Dex', false, true), S('Survival', 'Wis'), S('Swim', 'Str', false, true),
    ];
  }
  if (kind === 'eidolon') {
    return FULL_SKILLS(new Set(['Bluff', 'Craft', 'Kn. (planes)', 'Perception', 'Sense Motive', 'Stealth']));
  }
  return FULL_SKILLS(new Set(['Acrobatics', 'Climb']));
}

/* ------------------------------------------------------------------ *
 * Empty blocks -- what a character carries before anything is typed.
 * ------------------------------------------------------------------ */

const scores = (base = 10) => Object.fromEntries(ABILITIES.map((k) => [k, { base, evo: 0, misc: 0 }]));

const common = (kind) => ({
  name: '',
  size: kind === 'familiar' ? 'Tiny' : 'Medium',
  masterLevelPenalty: 0,
  attackAbility: kind === 'familiar' ? '' : 'Str',
  attackBonus: 0,
  hp: { damage: 0, temp: 0, bonus: 0 },
  ac: { all: 0, touch: 0, ff: 0 },
  cmdOther: 0,
  cmbOther: 0,
  initBonus: 0,
  saves: { fort: { misc: 0 }, ref: { misc: 0 }, will: { misc: 0 } },
  speed: { base: '', fly: '', burrow: '', swim: '', climb: '' },
  skills: seedSkills(kind),
  attacks: [],
  feats: [],
  // Equipment. Every kind carries both, because every kind can be given
  // something: the animal companion's body type says which slots it has (the
  // map), and anything with no slot -- a familiar's ioun stone, a bag tied to
  // a saddle -- goes in the list. Each row is a name, a price, whether it is
  // being worn, and what it does, which is prose and so may forward a bonus
  // at any of the companion's own numbers. See COMPANION_TARGETS.
  items: {},
  slotless: [],
  specialQualities: '',
  notes: '',
});

/** An equipment row as it starts: worn, doing nothing, costing nothing. */
export const emptyCompanionItem = () => ({ name: '', cost: 0, worn: true, effect: '' });

export function defaultFamiliar() {
  return {
    ...common('familiar'),
    creature: '',
    archetypes: '',
    specialAbility: '',
    abilities: '',
    protector: false,
    scores: { ...scores(10), int: { base: null, evo: 0, misc: 0 } },
  };
}

export function defaultAnimalCompanion() {
  return {
    ...common('animalCompanion'),
    levelSource: 'class',
    masterClass: '',
    levelOverride: null,
    creature: '',
    archetype: '',
    bodyType: '',
    hpAbility: 'Con',
    goodSaves: { fort: true, ref: true, will: false },
    scores: scores(10),
    abilityIncreases: ABILITY_INCREASE_LEVELS.animalCompanion.map((level) => ({ level, ability: '' })),
    tricks: [],
  };
}

export function defaultEidolon() {
  return {
    ...common('eidolon'),
    masterClass: '',
    levelOverride: null,
    alignment: '',
    baseForm: '',
    subtype: '',
    hpAbility: 'Con',
    goodSaves: { fort: true, ref: true, will: false },
    scores: scores(10),
    abilityIncreases: ABILITY_INCREASE_LEVELS.eidolon.map((level) => ({ level, ability: '' })),
    bonusEvoPoints: 0,
    evolutions: [],
    baseEvolutions: '',
    dr: '',
    resistances: '',
    immunities: '',
  };
}

export const defaultCompanion = (kind) => ({
  familiar: defaultFamiliar,
  animalCompanion: defaultAnimalCompanion,
  eidolon: defaultEidolon,
}[kind]());

/**
 * A stored block brought up to the current shape: a document saved before a
 * field existed gets the default for it, and lists are always lists.
 */
export function normalizeCompanion(kind, block) {
  const base = defaultCompanion(kind);
  const b = block && typeof block === 'object' ? block : {};
  const out = { ...base, ...b };
  for (const key of ['hp', 'ac', 'saves', 'speed', 'goodSaves']) {
    if (base[key]) out[key] = { ...base[key], ...(b[key] && typeof b[key] === 'object' ? b[key] : {}) };
  }
  for (const k of ['fort', 'ref', 'will']) out.saves[k] = { misc: 0, ...(out.saves[k] || {}) };
  out.scores = Object.fromEntries(ABILITIES.map((k) => [
    k, { ...base.scores[k], ...(b.scores?.[k] && typeof b.scores[k] === 'object' ? b.scores[k] : {}) },
  ]));
  for (const key of ['skills', 'attacks', 'feats', 'tricks', 'evolutions', 'slotless', 'abilityIncreases']) {
    if (Array.isArray(base[key]) && !Array.isArray(out[key])) out[key] = base[key];
  }
  if (!out.items || typeof out.items !== 'object') out.items = {};
  // A document saved before equipment could do anything holds a name and a
  // cost; the two new fields default the way a player would expect -- a thing
  // written down is a thing being worn, and it does nothing until it is told
  // to. The slot map is keyed by slot name and is not a list, so both shapes
  // are filled in the same way.
  const item = (it) => ({ ...emptyCompanionItem(), ...(it && typeof it === 'object' ? it : {}) });
  out.items = Object.fromEntries(Object.entries(out.items).map(([slot, it]) => [slot, item(it)]));
  out.slotless = out.slotless.map(item);
  return out;
}

/* ------------------------------------------------------------------ *
 * Whether a block holds anything the player put there.
 * ------------------------------------------------------------------ */

export function companionInUse(kind, block) {
  if (!block) return false;
  if (String(block.name || '').trim()) return true;
  if ((block.attacks || []).length || (block.feats || []).length) return true;
  if ((block.evolutions || []).length || (block.tricks || []).length) return true;
  // Something it has been given counts too: a companion nobody has named yet
  // but has already been handed a saddle is a companion, and its stats have
  // to be aimable at or the saddle has nowhere to send its bonus.
  if ((block.slotless || []).some((it) => String(it?.name || '').trim() || String(it?.effect || '').trim())) return true;
  if (Object.values(block.items || {}).some((it) => String(it?.name || '').trim() || String(it?.effect || '').trim())) return true;
  if (kind === 'animalCompanion' && (block.masterClass || block.levelOverride !== null)) return true;
  if (kind === 'eidolon' && (block.masterClass || block.levelOverride !== null)) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * The sums.
 * ------------------------------------------------------------------ */

const clampLevel = (n) => Math.max(0, Math.min(20, Math.floor(Number(n) || 0)));
const abilityKey = (label) => {
  const s = String(label || '').trim().toLowerCase().slice(0, 3);
  return ABILITIES.includes(s) ? s : null;
};

/**
 * The companion's level before the master-level penalty.
 *
 * `master.classLevelCount(name)` counts a class's levels off the Planner;
 * `master.skillRanks(name)` is the master's ranks in a skill (the Spheres
 * beastmastery companion advances by Handle Animal or Ride ranks instead of a
 * class). A pinned `levelOverride` wins over both.
 */
function rawLevel(kind, b, master) {
  if (kind === 'familiar') return Math.min(20, master.level);
  if (b.levelOverride !== null && b.levelOverride !== undefined && b.levelOverride !== '') {
    return clampLevel(b.levelOverride);
  }
  if (kind === 'animalCompanion' && b.levelSource === 'handleAnimal') return clampLevel(master.skillRanks('Handle Animal'));
  if (kind === 'animalCompanion' && b.levelSource === 'ride') return clampLevel(master.skillRanks('Ride'));
  return b.masterClass ? clampLevel(master.classLevelCount(b.masterClass)) : 0;
}

/**
 * The name a companion's skill row answers to, so `{= eidolon.skill.stealth}`
 * and `{eidolon.skill.stealth += 2}` can never mean two different rows --
 * the same rule the character's own skills follow, one level down.
 */
export const companionSkillKey = (s) => slug(s?.spec ? `${s.name} ${s.spec}` : s?.name);

/** The name a natural attack answers to: `eidolon.attack.bite`. */
export const companionAttackKey = (a) => slug(a?.type);

/**
 * A bonus block filled out, whatever was handed in.
 *
 * `computeCompanion` is pure and is called with three arguments as often as
 * four, so the fourth has to survive being absent, half present, or holding a
 * string where a number was meant.
 */
function bonusesFor(x) {
  const n = (v) => Math.trunc(Number(v) || 0);
  const map = (v) => (v && typeof v === 'object' ? v : {});
  const b = map(x);
  return {
    hp: n(b.hp),
    attack: n(b.attack),
    damage: n(b.damage),
    init: n(b.init),
    cmd: n(b.cmd),
    cmb: n(b.cmb),
    ac: n(b.ac),
    touch: n(b.touch),
    ff: n(b.ff),
    saves: map(b.saves),
    scores: map(b.scores),
    skill: map(b.skill),
    attackBy: map(b.attackBy),
    damageBy: map(b.damageBy),
  };
}

/**
 * Everything the sheet worked out for one companion.
 *
 * `master` is `{ level, bab, hp, baseSaves: {fort, ref, will}, skillRanks(name, spec),
 * classLevelCount(name) }`. Returns `{ calc, skills, attacks }`: the block-level
 * numbers (ability totals included, under `calc.scores`) and the two row lists
 * with each row's derived fields added, ready to be written back.
 *
 * `bonuses` is what has been forwarded at this companion from elsewhere on
 * the character -- something it is wearing, a feature of its master's, a buff
 * -- under the same names the scope publishes each stat by. Each one is kept
 * *beside* what was typed rather than folded into it, for the reason the
 * character's own skills keep theirs beside Misc: the column has to go on
 * saying what was written in it, and the row has to go on adding up.
 */
export function computeCompanion(kind, block, master, bonuses = null) {
  const b = block;
  const fwd = bonusesFor(bonuses);
  const penalty = Math.abs(Math.floor(Number(b.masterLevelPenalty) || 0));
  const raw = rawLevel(kind, b, master);
  const level = clampLevel(raw - penalty);
  const table = kind === 'familiar' ? FAMILIAR_TABLE
    : kind === 'animalCompanion' ? ANIMAL_COMPANION_TABLE : EIDOLON_TABLE;
  const row = table[Math.max(1, level) - 1] || table[0];
  const hd = kind === 'familiar' ? level : (level >= 1 ? row.hd : 0);
  const sizeAC = SIZE_MODIFIERS[b.size] ?? 0;

  // Ability scores. Str and Dex carry the table's bonus; the chosen abilities
  // carry the +1s at the increase levels; the eidolon's evolutions add on top.
  const strDex = kind === 'familiar' || level < 1 ? 0 : row.strDex;
  const increases = {};
  for (const inc of b.abilityIncreases || []) {
    const k = abilityKey(inc.ability);
    if (k && level >= (Number(inc.level) || 99)) increases[k] = (increases[k] || 0) + 1;
  }
  const scores = {};
  for (const k of ABILITIES) {
    const s = b.scores?.[k] || {};
    let base = Number(s.base);
    if (kind === 'familiar' && k === 'int' && (s.base === null || s.base === undefined || s.base === '')) {
      base = row.int;
    }
    if (!Number.isFinite(base)) base = 10;
    const lvlUp = (k === 'str' || k === 'dex' ? strDex : 0) + (increases[k] || 0);
    const evo = kind === 'eidolon' ? (Number(s.evo) || 0) : 0;
    // The score itself, so everything built on it moves with it: a belt of
    // giant strength reaches the attack, the damage, the CMB, Climb and Swim
    // without any of them having to be named.
    const gear = Math.trunc(Number(fwd.scores[k]) || 0);
    const total = base + evo + lvlUp + (Number(s.misc) || 0) + gear;
    scores[k] = { base, evo, lvlUp, gear, total, mod: abilityMod(total) };
  }
  const mod = (k) => scores[k]?.mod || 0;

  // Hit points: half the master's for a familiar (doubled for a Protector at
  // 11th), 8 a die plus Con for the others -- the sheet's own numbers.
  const conKey = abilityKey(b.hpAbility) || 'con';
  const hpMax = (kind === 'familiar'
    ? Math.floor(master.hp / 2) * (b.protector && master.level >= 11 ? 2 : 1) + (Number(b.hp?.bonus) || 0)
    : hd * 8 + mod(conKey) * hd + (Number(b.hp?.bonus) || 0)) + fwd.hp;
  const damage = Math.max(0, Number(b.hp?.damage) || 0);
  const temp = Math.max(0, Number(b.hp?.temp) || 0);

  // Attack: the master's BAB for a familiar, the table's for the others; the
  // ability is Str, or the better of Str and Dex for a familiar left on auto.
  const bab = kind === 'familiar' ? master.bab : (level >= 1 ? row.bab : 0);
  const atkKey = abilityKey(b.attackAbility)
    || (kind === 'familiar' ? (scores.str.total >= scores.dex.total ? 'str' : 'dex') : 'str');
  const attackMod = mod(atkKey) + sizeAC;
  const totalAttack = bab + attackMod + (Number(b.attackBonus) || 0) + fwd.attack;
  const multiattack = (b.feats || []).some((f) => /multiattack/i.test(String(f?.name || f || '')));

  // Saves: a familiar uses its master's base saves (never below +2 on this
  // template); the others read good or poor off the table.
  const saves = {};
  for (const [k, ab] of [['fort', 'con'], ['ref', 'dex'], ['will', 'wis']]) {
    const base = kind === 'familiar'
      ? Math.max(2, Number(master.baseSaves?.[k]) || 0)
      : (level >= 1 ? (b.goodSaves?.[k] ? row.goodSave : row.poorSave) : 0);
    const misc = Number(b.saves?.[k]?.misc) || 0;
    const gear = Math.trunc(Number(fwd.saves[k]) || 0);
    saves[k] = { base, mod: mod(ab), misc, gear, total: base + mod(ab) + misc + gear };
  }

  // Armour class. The table's natural armour counts (the sheet left it to be
  // typed); the three typed bonuses split the way the sheet's did -- to
  // everything, to touch only (dodge, deflection), to flat-footed only
  // (natural, armour). Touch does not carry natural armour, whatever the
  // Animal Companion tab's formula said.
  const tableNatural = level >= 1 ? row.naturalArmor : 0;
  const all = Number(b.ac?.all) || 0;
  const touchOnly = Number(b.ac?.touch) || 0;
  const ffOnly = Number(b.ac?.ff) || 0;
  const ac = 10 + mod('dex') + sizeAC + all + touchOnly + ffOnly + tableNatural + fwd.ac;
  const touch = 10 + mod('dex') + sizeAC + all + touchOnly + fwd.touch;
  const flatFooted = 10 + sizeAC + all + ffOnly + tableNatural + fwd.ff;
  const cmdOther = Number(b.cmdOther) || 0;
  const cmd = 10 + bab + mod('str') + mod('dex') - sizeAC + cmdOther + fwd.cmd;
  const ffCmd = 10 + bab + mod('str') - sizeAC + cmdOther + fwd.cmd;
  // Combat maneuvers, which the worksheet never worked out at all: BAB plus
  // Strength plus the *special* size modifier, which is the size modifier to
  // AC and attack the other way round -- exactly as CMD above already has it.
  // A companion that trips, grapples or bull rushes had nowhere to read this
  // and no way to be given a bonus to it.
  const cmbOther = Number(b.cmbOther) || 0;
  const cmb = bab + mod('str') - sizeAC + cmbOther + fwd.cmb;
  const initiative = mod('dex') + (Number(b.initBonus) || 0) + fwd.init;

  // Skills. A familiar's ranks are its own or its master's, whichever is
  // higher; the class-skill +3 applies once there is a rank to apply it to.
  const skills = (b.skills || []).map((s) => {
    const own = Math.max(0, Number(s.ranks) || 0);
    const masterRanks = kind === 'familiar' ? Math.max(0, Number(master.skillRanks(s.name, s.spec)) || 0) : 0;
    const ranks = Math.max(own, masterRanks);
    const am = mod(abilityKey(s.ability) || 'int');
    const forwarded = Math.trunc(Number(fwd.skill[companionSkillKey(s)]) || 0);
    const total = forwarded
      + skillTotal({ ranks, classSkill: !!s.classSkill, abilityMod: am, misc: Number(s.misc) || 0 });
    return { ...s, masterRanks, effectiveRanks: ranks, abilityMod: am, forwarded, total };
  });
  const ranksSpent = skills.reduce((n, s) => n + Math.max(0, Number(s.ranks) || 0), 0);
  // The eidolon's budget is the sheet's cell (HD × (6 + Int)); the animal
  // companion's is the table's column; a familiar has none of its own.
  const ranksAllowed = kind === 'familiar' ? null
    : kind === 'eidolon' ? Math.max(0, hd * (6 + mod('int')))
      : (level >= 1 ? row.skills : 0);

  // Natural attacks: primary at full bonus, secondary at -5 (-2 with
  // Multiattack), plus whatever the row adds.
  const attacks = (b.attacks || []).map((a) => {
    const known = naturalAttack(a.type);
    // `primary` is 'primary' / 'secondary' as chosen, or blank for the table's say.
    const chosen = a.primary === true ? 'primary' : a.primary === false ? 'secondary' : String(a.primary || '');
    const primary = chosen === 'primary' ? true : chosen === 'secondary' ? false : (known ? known.primary : true);
    const secondaryPenalty = primary ? 0 : (multiattack ? -2 : -5);
    const key = companionAttackKey(a);
    const toHit = totalAttack + secondaryPenalty + (Number(a.bonus) || 0)
      + Math.trunc(Number(fwd.attackBy[key]) || 0);
    // Damage stays the free text it has always been -- "1d6 plus grab" is as
    // common on these rows as "1d6+7" -- so what a rule adds to it is a
    // number kept beside it rather than written into it. The roll adds it to
    // the flat part; the panel shows it next to the column.
    const damageBonus = (Number(a.dmgBonus) || 0) + fwd.damage
      + Math.trunc(Number(fwd.damageBy[key]) || 0);
    return {
      ...a, damageType: known?.damageType || '', primaryResolved: primary, toHit, damageBonus,
    };
  });

  // What the table grants along the way, up to this level.
  const gains = [];
  for (let i = 0; i < Math.min(level, table.length); i++) {
    if (table[i].special) gains.push({ level: i + 1, text: table[i].special });
  }

  const calc = {
    scores,
    rawLevel: raw,
    penalty,
    level,
    hd,
    bab,
    attackAbility: ABILITY_LABELS[atkKey],
    attackMod,
    totalAttack,
    damageBonus: fwd.damage,
    multiattack,
    hpMax,
    hpCurrent: hpMax - damage,
    hpTemp: temp,
    sizeAC,
    tableNatural,
    ac,
    touch,
    flatFooted,
    cmd,
    ffCmd,
    cmb,
    initiative,
    ranksSpent,
    ranksAllowed,
    featsAllowed: kind === 'familiar' ? null : (level >= 1 ? row.feats : 0),
    featsTaken: (b.feats || []).filter((f) => String(f?.name || '').trim()).length,
    gains,
    saves,
  };
  if (kind === 'familiar') {
    calc.tableInt = row.int;
    calc.protectorDoubles = !!b.protector && master.level >= 11;
  }
  if (kind === 'animalCompanion') {
    calc.bonusTricks = level >= 1 ? row.tricks : 0;
    calc.tricksTaken = (b.tricks || []).filter((t) => String(t?.name || '').trim()).length;
    const shape = bodyType(b.bodyType);
    calc.slots = shape ? shape.slots : [];
    calc.canGrasp = shape ? shape.canGrasp : null;
  }
  if (kind === 'eidolon') {
    const pool = (level >= 1 ? row.evoPool : 0) - penalty + (Number(b.bonusEvoPoints) || 0);
    const spent = (b.evolutions || []).reduce((n, e) => n + (Number(e.cost) || 0), 0);
    calc.evoPool = Math.max(0, pool);
    calc.evoSpent = spent;
    calc.evoLeft = calc.evoPool - spent;
    calc.maxAttacks = level >= 1 ? row.maxAttacks : 0;
    calc.maxBonusPerStat = 2 + Math.floor(level / 6) * 2;
    calc.evoBonusOver = ABILITIES.filter((k) => scores[k].evo > calc.maxBonusPerStat).map((k) => ABILITY_LABELS[k]);
  }
  return { calc, skills, attacks };
}

/**
 * The names a formula can read: `familiar.hp`, `eidolon.str.mod`, ...
 *
 * Every number a companion rolls or is asked for in a fight is here, and
 * every one of them is spelled the way it is forwarded to -- see
 * COMPANION_TARGETS, which is generated from the same shape.
 *
 * `ac` and `attack` are a number *and* a branch: `{= eidolon.ac}` is the
 * armour class it always was, while `eidolon.ac.touch` and
 * `eidolon.attack.bite` reach the parts underneath (the `total` trick the
 * saves use -- see carriesTotal in formula.js). The older flat spellings
 * `touch`, `ff`, `cmd` stay exactly where they were: nothing written before
 * this had to change.
 */
export function companionScope(block) {
  const k = block?.calc;
  if (!k) return null;
  const s = {
    level: k.level, hd: k.hd, bab: k.bab,
    hp: k.hpMax, hpCurrent: k.hpCurrent,
    touch: k.touch, ff: k.flatFooted, cmd: k.cmd, ffCmd: k.ffCmd, cmb: k.cmb ?? 0,
    init: k.initiative,
    fort: k.saves.fort.total, ref: k.saves.ref.total, will: k.saves.will.total,
    ac: {
      touch: k.touch, flatFooted: k.flatFooted, cmd: k.cmd, total: k.ac,
    },
    // One entry per natural attack, under the attack's own name, so a rule
    // about the bite can say so. `total` is the to-hit every attack shares
    // before its primary/secondary penalty.
    attack: { ...Object.fromEntries((block.attacks || [])
      .map((a) => [companionAttackKey(a), Number(a.toHit) || 0])
      .filter(([key]) => key && key !== 'x')), total: k.totalAttack },
    damage: { ...Object.fromEntries((block.attacks || [])
      .map((a) => [companionAttackKey(a), Number(a.damageBonus) || 0])
      .filter(([key]) => key && key !== 'x')), total: k.damageBonus ?? 0 },
    saves: {
      fortitude: k.saves.fort.total,
      reflex: k.saves.ref.total,
      will: k.saves.will.total,
    },
    // Each skill by its slugged name, the way the character's own are:
    // `animalCompanion.skill.perception`.
    skill: Object.fromEntries((block.skills || [])
      .map((sk) => [companionSkillKey(sk), Number(sk.total) || 0])
      .filter(([key]) => key && key !== 'x')),
  };
  for (const a of ABILITIES) {
    const sc = k.scores?.[a];
    s[a] = { score: sc?.total ?? 10, mod: sc?.mod ?? 0 };
  }
  if (k.evoPool !== undefined) { s.evoPool = k.evoPool; s.evoLeft = k.evoLeft; }
  return s;
}

/**
 * Every stat of a companion's a bonus may be forwarded to, under the name it
 * is read by, and what to call it.
 *
 * The list is here rather than in the scope's forwarding half because it is
 * the *same* list the scope above publishes -- one shape, so a name can never
 * be readable and unaimable, or the other way round. The skills and the
 * natural attacks are per companion and are added by the caller from the
 * block's own rows.
 *
 * [name, label, where it lands in the bonus block]
 */
export const COMPANION_TARGETS = [
  ['hp', 'Hit points', 'hp'],
  ['ac.total', 'Armour class', 'ac'],
  ['ac.touch', 'Touch AC', 'touch'],
  ['ac.flatFooted', 'Flat-footed AC', 'ff'],
  ['cmd', 'CMD', 'cmd'],
  ['cmb', 'CMB', 'cmb'],
  ['attack', 'Attack, every natural attack', 'attack'],
  ['damage', 'Damage, every natural attack', 'damage'],
  ['init', 'Initiative', 'init'],
  ['fort', 'Fortitude', 'saves.fort'],
  ['ref', 'Reflex', 'saves.ref'],
  ['will', 'Will', 'saves.will'],
  ...ABILITIES.map((a) => [`${a}.score`, ABILITY_LABELS[a], `scores.${a}`]),
];

/** Destinations that stand for several of a companion's at once. */
export const COMPANION_FAMILIES = {
  ac: ['ac.total', 'ac.touch', 'ac.flatFooted'],
  saves: ['fort', 'ref', 'will'],
};
