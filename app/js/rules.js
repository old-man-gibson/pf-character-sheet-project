/**
 * rules.js -- Pathfinder rules tables and the derived-stat definitions.
 *
 * Everything here is data or pure functions, so it is trivially inspectable.
 */

import { analyse, evaluateFormula } from './formula.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_LABELS = {
  str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha',
};

/** Ability score -> modifier. The single most-used rule in the system. */
export const abilityMod = (score) => Math.floor((Number(score || 0) - 10) / 2);

/* ------------------------------------------------------------------ *
 * Ability score construction (the Stats tab)
 * ------------------------------------------------------------------ */

/** Point-buy cost per score, from dataSheet!K21:L33. */
export const POINT_BUY_COST = {
  7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2,
  13: 3, 14: 5, 15: 7, 16: 10, 17: 13, 18: 17,
};

/** The planner's span: the top character level anything here counts up to. */
export const MAX_LEVEL = 20;

/** Enhancement bonuses from ABP and gear stack, but only up to this total. */
export const ENHANCEMENT_CAP = 6;

export const ABP_PER_PICK = 2;        // Mental / Physical Prowess
export const ARRAY_PER_PICK = 2;      // optional array slot
export const LEVEL4_PER_PICK = 1;     // the every-fourth-level increase
export const ATTUNEMENT_BONUS = 2;    // attunement is on or off, and worth +2
export const ATTUNEMENT_MIN_LEVEL = 20;

/** Which abilities each ABP prowess track may be assigned to. */
export const PROWESS_TRACKS = {
  mental: ['Int', 'Wis', 'Cha'],
  physical: ['Str', 'Dex', 'Con'],
};

/**
 * Levels at which each kind of choice is made.
 *
 * The two prowess tracks advance on their own schedules, so most rows offer a
 * choice on one side only; there is no slot at all on the other. Likewise the
 * array grants four picks at 8 and three at 12 and 16. Both shapes are
 * identical across all five source sheets.
 */
export const MENTAL_PROWESS_LEVELS = [6, 11, 13, 15, 17, 18, 19, 20];
export const PHYSICAL_PROWESS_LEVELS = [7, 12, 13, 16, 17, 18, 19, 20];
export const ABP_LEVELS = [...new Set([...MENTAL_PROWESS_LEVELS, ...PHYSICAL_PROWESS_LEVELS])]
  .sort((a, b) => a - b);

/**
 * Some prowess gains are not a fresh choice: the level 11 mental increase
 * raises whatever was chosen at 6, and the level 12 physical increase raises
 * the level 7 pick. The later level still grants its own +2 -- it just cannot
 * be pointed at a different ability.
 *
 * Keyed by the follower level, valued by the level it copies.
 */
export const ABP_LINKED_LEVELS = {
  mental: { 11: 6 },
  physical: { 12: 7 },
};

/** The level a pick is actually chosen at (itself, unless it is a follower). */
export function abpSourceLevel(track, level) {
  return ABP_LINKED_LEVELS[track]?.[level] ?? level;
}

/** Levels that copy from `level` on this track. */
export function abpFollowers(track, level) {
  return Object.entries(ABP_LINKED_LEVELS[track] || {})
    .filter(([, src]) => src === level)
    .map(([follower]) => Number(follower));
}

/**
 * Array picks, as the storage slot indices used at each level. The template
 * leaves specific positions empty at 12 and 16, so the indices are preserved
 * rather than compacted -- that keeps the data round-tripping with the sheet.
 */
export const ARRAY_SLOTS = { 8: [0, 1, 2, 3], 12: [0, 1, 3], 16: [0, 2, 3] };
export const ARRAY_LEVELS = Object.keys(ARRAY_SLOTS).map(Number).sort((a, b) => a - b);
export const ARRAY_MAX_SLOTS = Math.max(...Object.values(ARRAY_SLOTS).map((s) => s.length));

export const LEVEL4_LEVELS = [4, 8, 12, 16, 20];

/**
 * The permanent parts of a build, in the order the sheet lists them, banded by
 * bonus type.
 *
 * ABP and gear are not two separate bonuses: they are both *enhancement*, which
 * is why they stack with each other and then stop at one shared +6. Presenting
 * them as one banded group with the used total beside them says that on the
 * table rather than only in the note underneath.
 *
 * `sum` names the field of `resolveAbility()` that the group's own total column
 * reads.
 */
export const BUILD_PERMANENT_GROUPS = [
  { cols: [['pointBuy', 'Point buy'], ['race', 'Race']] },
  {
    label: 'Enhancement',
    hint: `ABP and gear are the same kind of bonus: they stack with each other, then stop at +${ENHANCEMENT_CAP}`,
    cols: [['abp', 'ABP'], ['gear', 'Gear']],
    sum: 'enhancement',
    cap: ENHANCEMENT_CAP,
  },
  {
    cols: [['attunement', 'Attuned'], ['inherent', 'Inherent'], ['array', 'Array'],
      ['level4', 'Level/4'], ['mythic', 'Mythic'], ['size', 'Size'], ['untyped', 'Untyped']],
  },
];

/**
 * Columns the sheet no longer feeds. They stay editable -- a character imported
 * with a value in one must not lose it -- but the table hides an all-zero
 * column until asked, rather than spending width on a dead control.
 */
export const BUILD_OPTIONAL_KEYS = ['inherent'];

/** The temporary parts, which produce the Temp Score. */
export const BUILD_TEMPORARY = [
  ['alchemical', 'Alchemical'],
  ['circumstance', 'Circumstance'],
  ['morale', 'Morale'],
  ['tempEnhancement', 'Enhancement'],
  ['tempSize', 'Size'],
];

/** Keys the player edits directly; these columns come from pick selectors. */
export const BUILD_DERIVED_KEYS = ['abp', 'array', 'level4', 'mythic'];

const n = (v) => Number(v) || 0;

/** Point-buy cost of one score. Scores outside the table extrapolate. */
export function pointBuyCost(score, table = POINT_BUY_COST) {
  const s = Math.round(Number(score));
  if (table[s] !== undefined) return table[s];
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (!keys.length) return 0;
  const lo = keys[0];
  const hi = keys[keys.length - 1];
  if (s < lo) return table[lo] - (lo - s);
  // Above the table each further point costs the same as the last step did.
  const step = table[hi] - table[hi - 1];
  return table[hi] + (s - hi) * step;
}

/** Total point-buy spend across all six abilities. */
export function pointBuyTotal(build, table = POINT_BUY_COST) {
  return ABILITIES.reduce((t, k) => t + pointBuyCost(build?.[k]?.pointBuy ?? 10, table), 0);
}

/**
 * Fold the Planner picks into per-ability bonuses.
 * Picks above `level` are plans for the future and do not count yet.
 */
export function foldPicks(picks, level) {
  const zero = () => Object.fromEntries(ABILITIES.map((k) => [k, 0]));
  const out = { abp: zero(), array: zero(), level4: zero() };
  if (!picks) return out;
  const key = (name) => String(name || '').trim().toLowerCase().slice(0, 3);
  const bump = (bucket, name, amount) => {
    const k = key(name);
    if (k in bucket) bucket[k] += amount;
  };

  for (const row of picks.abp || []) {
    if (row.level > level) continue;
    bump(out.abp, row.mental, ABP_PER_PICK);
    bump(out.abp, row.physical, ABP_PER_PICK);
  }
  for (const row of picks.array || []) {
    if (row.level > level) continue;
    for (const slot of row.slots || []) bump(out.array, slot, ARRAY_PER_PICK);
  }
  for (const row of picks.level4 || []) {
    if (row.level > level) continue;
    bump(out.level4, row.ability, LEVEL4_PER_PICK);
  }
  return out;
}

/**
 * Resolve one ability's build into its scores.
 *
 * ABP and gear are both enhancement bonuses: they stack with each other but
 * the combined total is capped at +6. Everything else simply adds.
 */
export function resolveAbility(entry = {}) {
  const abp = n(entry.abp);
  const gear = n(entry.gear);
  const rawEnhancement = abp + gear;
  const enhancement = Math.min(ENHANCEMENT_CAP, rawEnhancement);

  const total = n(entry.pointBuy) + n(entry.race) + enhancement + n(entry.attunement)
    + n(entry.inherent) + n(entry.array) + n(entry.level4) + n(entry.mythic)
    + n(entry.size) + n(entry.untyped);

  const temporary = n(entry.alchemical) + n(entry.circumstance) + n(entry.morale)
    + n(entry.tempEnhancement) + n(entry.tempSize);

  return {
    enhancement,
    rawEnhancement,
    enhancementWasted: Math.max(0, rawEnhancement - enhancement),
    total,
    temporary,
    tempTotal: total + temporary,
  };
}

/* ------------------------------------------------------------------ *
 * Spheres of Power / Might training
 *
 * Everything here reproduces the source workbook's own tables and formulas
 * (dataSheet lookups, Combat/Magic Training columns), verified against the
 * cached values in all five exports.
 * ------------------------------------------------------------------ */

export const CASTING_TYPES = ['Low', 'Mid', 'High'];
export const PRACTITIONER_TYPES = ['Proficient', 'Adept', 'Expert'];

/** Talents gained per class level, by the Talents/Level selector (SpheresLookup). */
export const TALENT_RATES = {
  'High Caster': 1, 'Mid-Caster': 0.75, 'Low Caster': 0.5,
  Expert: 1, Adept: 0.75, Proficient: 0.5,
  Virtuoso: 0.75, Journeyman: 0.5, Trained: 0.25,
};

/** Progression (caster level / practitioner level) per class level, by type. */
export const TYPE_RATES = {
  High: 1, Mid: 0.75, Low: 0.5,
  Expert: 1, Adept: 0.75, Proficient: 0.5,
};

/** Talents/Level selection implied by a type, and the reverse — several of
 *  the source sheets fill in only one of the two. */
export const TYPE_TO_TALENTS = {
  High: 'High Caster', Mid: 'Mid-Caster', Low: 'Low Caster',
  Expert: 'Expert', Adept: 'Adept', Proficient: 'Proficient',
};
export const TALENTS_TO_TYPE = {
  'High Caster': 'High', 'Mid-Caster': 'Mid', 'Low Caster': 'Low',
  Expert: 'Expert', Adept: 'Adept', Proficient: 'Proficient',
};

export const MAGIC_SPHERES = ['Alteration', 'Blood', 'Conjuration', 'Creation', 'Dark',
  'Death', 'Destruction', 'Divination', 'Enhancement', 'Fallen Fey', 'Fate', 'Illusion',
  'Life', 'Light', 'Mana', 'Mind', 'Nature', 'Protection', 'Telekinesis', 'Time', 'War',
  'Warp', 'Weather', 'Bear', 'Technomancy', 'Veilweaving'];

export const COMBAT_SPHERES = ['Alchemy', 'Athletics', 'Barrage', 'Barroom', 'Beastmastery',
  'Berserker', 'Boxing', 'Brute', 'Dual Wielding', 'Duelist', 'Equipment', 'Fencing',
  'Gladiator', 'Guardian', 'Lancer', 'Open Hand', 'Scoundrel', 'Scout', 'Shield', 'Sniper',
  'Trap', 'Warleader', 'Wrestling', 'Leadership', 'Pilot', 'Tech'];

/** Every sphere either side knows, for the classes that learn from both. */
export const BLENDED_SPHERES = [...COMBAT_SPHERES, ...MAGIC_SPHERES].sort();

const SPHERE_SIDES = new Map([
  ...MAGIC_SPHERES.map((s) => [s, 'magic']),
  ...COMBAT_SPHERES.map((s) => [s, 'combat']),
]);

/**
 * Which side a talent counts for, by its sphere.
 *
 * A blended class spends one pool of talents on either kind, so the sphere is
 * the only thing that says whether a talent is martial or magical. A name
 * neither list knows (homebrew, or a typo) falls back to the side the class
 * itself sits on rather than being dropped.
 */
export function sphereSide(sphere, fallback = null) {
  return SPHERE_SIDES.get(String(sphere || '').trim()) ?? fallback;
}

/**
 * Bonus skill ranks per sphere talent (the sheet's "Bonus Ranks (automatic)"
 * block): 5 ranks per talent in the associated sphere, capped at level.
 * `lightBody: true` rows are set to full level when the character's Primordia
 * Technique is Light Body, matching the sheet's special case.
 */
export const RANKS_PER_TALENT = 5;
export const SPHERE_SKILL_RANKS = [
  { key: 'Acrobatics', spheres: ['Athletics'], lightBody: true, match: { name: 'Acrobatics' } },
  { key: 'Climb', spheres: ['Athletics'], lightBody: true, match: { name: 'Climb' } },
  { key: 'Fly', spheres: ['Athletics'], lightBody: true, match: { name: 'Fly' } },
  { key: 'Swim', spheres: ['Athletics'], lightBody: true, match: { name: 'Swim' } },
  { key: 'Bluff', spheres: ['Fencing'], match: { name: 'Bluff' } },
  { key: 'Craft (any)', manual: true, match: { name: 'Craft', spec: null } },
  { key: 'Craft (alchemy)', spheres: ['Alchemy'], match: { name: 'Craft', spec: /alchem/i } },
  { key: 'Craft (mechanical)', spheres: ['Tech'], match: { name: 'Craft', spec: /mechan/i } },
  { key: 'Craft (traps)', spheres: ['Trap'], match: { name: 'Craft', spec: /trap/i } },
  { key: 'Diplomacy', spheres: ['Leadership', 'Warleader'], match: { name: 'Diplomacy' } },
  { key: 'Handle Animal', spheres: ['Beastmastery'], match: { name: 'Handle Animal' } },
  { key: 'Intimidate', spheres: ['Gladiator'], match: { name: 'Intimidate' } },
  { key: 'Perception', spheres: ['Scout'], match: { name: 'Perception' } },
  { key: 'Ride', spheres: ['Beastmastery'], match: { name: 'Ride' } },
  { key: 'Sense Motive', spheres: ['Fencing'], match: { name: 'Sense Motive' } },
  { key: 'Sleight of Hand', spheres: ['Scoundrel'], match: { name: 'Sleight of Hand' } },
  { key: 'Stealth', spheres: ['Scout'], match: { name: 'Stealth' } },
];

/** Background skills (Pathfinder Unchained), for the specialty picker. */
export const BACKGROUND_SKILLS = ['Appraise', 'Artistry', 'Craft', 'Handle Animal',
  'Kn. (engineering)', 'Kn. (geography)', 'Kn. (history)', 'Kn. (nobility)',
  'Linguistics', 'Lore', 'Perform', 'Profession', 'Sleight of Hand'];

/* ------------------------------------------------------------------ *
 * Primordia Techniques
 *
 * One choice, made at 1st level (or the moment its prerequisite is finally
 * met, if none was taken before), that then advances on its own ladder for
 * the rest of the character's career.
 *
 * The workbook scattered this across four tabs and modelled none of it: the
 * choice itself is a dropdown on Character Info, the ladder of levels is
 * printed on the Planner, on Vancian Magic and on Psionics -- three copies of
 * the same ten rows, all of them empty on every sheet but Bryva's, and none of
 * them next to the choice they belong to.
 * ------------------------------------------------------------------ */

/** Elephant in the Room, the campaign's feat-tax rules. Two techniques cite it. */
export const EITR_URL = 'https://drive.google.com/file/d/1IoDVH7JEZczhNniN3lcen1qknTv1hZha/view';

/**
 * The levels a technique grants at: 1st, 3rd, 5th, then 7th and every two
 * levels after. Every technique shares the ladder; only what lands on it
 * differs, which is why the levels are a constant and not part of the table.
 */
export const PRIMORDIA_LEVELS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Where the fixed grants stop and the repeating one takes over. */
export const PRIMORDIA_REPEAT_FROM = 7;

/**
 * The five techniques, each as its prerequisite, what it hands over at 1st,
 * 3rd and 5th, and the one grant it repeats from 7th on.
 *
 * A grant is one thing gained. `pick` marks the ones the player chooses --
 * every level has at most one across all five techniques, which is what lets
 * a choice be stored against its level alone. `talent`/`feat`/`spell`/`power`
 * say what kind of thing it is, so the ladder can total them; `alt` is the
 * "if you already have it" branch a couple of the Vancian grants carry.
 *
 * The repeating grant also carries a `short`, because it lands on seven rows
 * and Armored Discipline's is a paragraph: the ladder prints the short form on
 * each row and the whole thing once underneath.
 *
 * `talents` names the sphere a technique's talents belong to, so they can be
 * counted into the training tally the same way a bonus talent is.
 */
export const PRIMORDIA_TECHNIQUES = [
  {
    name: 'Light Body',
    prereq: { key: 'bab', text: 'At least 3/4 BAB progression' },
    talents: { side: 'combat', sphere: 'Athletics' },
    grants: {
      1: [
        {
          text: 'Athletics sphere as a bonus talent, taking the (leap) or (run) package',
          talent: true,
          pick: { label: 'Package', placeholder: '(leap) or (run)', options: ['(leap)', '(run)'] },
        },
        { text: 'Unarmed Combatant as a bonus feat', feat: true, cite: 'EitR' },
      ],
      3: [{ text: 'Wall Stunt as a bonus talent', talent: true }],
      5: [{ text: 'Air Stunt (legendary) as a bonus talent', talent: true }],
    },
    repeat: {
      text: 'A bonus talent from the Athletics sphere',
      short: 'An Athletics talent',
      talent: true,
      pick: { label: 'Talent', placeholder: 'Which Athletics talent?' },
    },
  },
  {
    name: 'Piercing Eye',
    prereq: { key: 'psionics', text: 'Psionic manifesting' },
    note: 'Powers gained this way may not be of a higher level than you can manifest '
      + 'normally, but can otherwise come from any power list. Choosing from the Psion '
      + 'Discipline list needs the matching class feature.',
    grants: {
      1: [
        {
          text: 'Psionic Talent as a bonus feat — its power points may only be spent on '
            + 'Clairsentience powers',
          feat: true,
        },
        {
          text: 'One Clairsentience power added to your powers known',
          power: true,
          pick: { label: 'Power', placeholder: 'Which Clairsentience power?' },
        },
      ],
      3: [
        {
          text: 'Psionic Talent as a bonus feat again — again restricted to Clairsentience',
          feat: true,
        },
        {
          text: 'One Clairsentience power added to your powers known',
          power: true,
          pick: { label: 'Power', placeholder: 'Which Clairsentience power?' },
        },
      ],
      5: [{
        text: 'One Clairsentience power added to your powers known',
        power: true,
        pick: { label: 'Power', placeholder: 'Which Clairsentience power?' },
      }],
    },
    repeat: {
      text: 'An additional Clairsentience power',
      short: 'A Clairsentience power',
      power: true,
      pick: { label: 'Power', placeholder: 'Which Clairsentience power?' },
    },
  },
  {
    name: 'Keen Mind (Spheres)',
    prereq: { key: 'spherecasting', text: 'Mid or high spherecasting' },
    talents: { side: 'magic', sphere: 'Divination' },
    grants: {
      1: [
        { text: 'Divination sphere as a bonus talent', talent: true },
        { text: 'Practiced Seer as a bonus feat', feat: true },
      ],
      3: [{ text: 'Detect Spellcaster as a bonus talent', talent: true }],
      5: [{ text: 'Fast Divinations as a bonus talent', talent: true }],
    },
    repeat: {
      text: 'A bonus talent from the Divination sphere',
      short: 'A Divination talent',
      talent: true,
      pick: { label: 'Talent', placeholder: 'Which Divination talent?' },
    },
  },
  {
    name: 'Keen Mind (Vancian)',
    prereq: { key: 'vancian', text: 'Vancian casting' },
    note: 'Spells gained this way must be from your own spell list, and may not be of a '
      + 'higher level than you can normally cast.',
    grants: {
      1: [{
        text: 'Spell Focus (Divination) as a bonus feat',
        feat: true,
        alt: { text: 'One Divination spell added to your spells known', spell: true },
        pick: { label: 'Taken', placeholder: 'Spell Focus (Divination), or the spell' },
      }],
      3: [{
        text: "Diviner's Delving as a bonus feat",
        feat: true,
        alt: { text: 'One Divination spell added to your spells known', spell: true },
        pick: { label: 'Taken', placeholder: "Diviner's Delving, or the spell" },
      }],
      5: [{
        text: 'One Divination spell added to your spells known',
        spell: true,
        pick: { label: 'Spell', placeholder: 'Which Divination spell?' },
      }],
    },
    repeat: {
      text: 'An additional Divination spell',
      short: 'A Divination spell',
      spell: true,
      pick: { label: 'Spell', placeholder: 'Which Divination spell?' },
    },
  },
  {
    name: 'Armored Discipline',
    prereq: { key: 'armor', text: 'Medium or Heavy Armor Proficiency' },
    grants: {
      1: [{ text: 'Endurance and Armor Adept as bonus feats', feat: 2 }],
      3: [{
        text: 'Armor Trick as a bonus feat. Armor crafted for you to wear can also be '
          + 'upgraded with two different armor modifications.',
        feat: true,
      }],
      5: [{
        text: 'Armor Focus (Medium) or Armor Focus (Heavy) as a bonus feat',
        feat: true,
        pick: {
          label: 'Focus',
          placeholder: 'Medium or Heavy',
          options: ['Armor Focus (Medium)', 'Armor Focus (Heavy)'],
        },
      }],
    },
    repeat: {
      text: 'One of: Armor Adept; Dodge (which grants Mobility with it, per the EitR '
        + 'optional rules); any feat that is a prerequisite for a Medium or Heavy Armor '
        + 'trick; or any feat with Medium Armor Proficiency, Heavy Armor Proficiency, '
        + "Armor Focus or Dodge as a prerequisite. You must meet the feat's own "
        + 'prerequisites.',
      short: 'An armor-track feat',
      feat: true,
      cite: 'EitR',
      pick: { label: 'Feat', placeholder: 'Which feat?' },
    },
  },
];

export const PRIMORDIA_NAMES = PRIMORDIA_TECHNIQUES.map((t) => t.name);

/** The technique a stored name refers to, matched loosely, or null. */
export function primordiaTechnique(name) {
  const want = String(name ?? '').trim().toLowerCase();
  if (!want) return null;
  return PRIMORDIA_TECHNIQUES.find((t) => t.name.toLowerCase() === want) || null;
}

/**
 * What a technique grants at a level: the fixed list for 1st/3rd/5th, the
 * repeating grant from 7th on, and nothing at the levels in between.
 */
export function primordiaGrantsAt(technique, level) {
  const t = typeof technique === 'string' ? primordiaTechnique(technique) : technique;
  if (!t || !PRIMORDIA_LEVELS.includes(level)) return [];
  if (level >= PRIMORDIA_REPEAT_FROM) return t.repeat ? [t.repeat] : [];
  return t.grants?.[level] || [];
}

/**
 * How many of one kind of thing a grant hands over. `feat: 2` is Armored
 * Discipline's first level, which is two feats in one sentence.
 */
export const grantCount = (grant, kind) => {
  const v = grant?.[kind];
  return v === true ? 1 : Number(v) || 0;
};

/* ------------------------------------------------------------------ *
 * Skill variants
 *
 * Most skills are one fixed thing. Artistry, Craft, Lore and Profession are
 * open: the character names each one they have, and the skill reads "Craft
 * (Weapons and Armor)". Perform is open too, but not free -- it is these nine
 * categories and no others.
 * ------------------------------------------------------------------ */

/** Skills whose variant the player writes themselves. */
export const VARIANT_SKILLS = ['Artistry', 'Craft', 'Lore', 'Profession'];

/**
 * The skill list a blank character starts with: the template's rows, with each
 * skill's key ability, whether it is trained-only and whether armour check
 * penalties apply. The open-slot skills (Artistry, Craft, Lore, Perform,
 * Profession) get a couple of rows each; more can be added on the tab.
 *
 * `[name, ability, trained, acp, copies]`
 */
export const STANDARD_SKILLS = [
  ['Acrobatics', 'Dex', false, true],
  ['Appraise', 'Int', false, false],
  ['Artistry', 'Int', false, false, 2],
  ['Autohypnosis', 'Wis', true, false],
  ['Bluff', 'Cha', false, false],
  ['Climb', 'Str', false, true],
  ['Craft', 'Int', false, false, 3],
  ['Diplomacy', 'Cha', false, false],
  ['Disable Device', 'Dex', true, true],
  ['Disguise', 'Cha', false, false],
  ['Escape Artist', 'Dex', false, true],
  ['Fly', 'Dex', false, true],
  ['Handle Animal', 'Cha', true, false],
  ['Heal', 'Wis', false, false],
  ['Intimidate', 'Cha', false, false],
  ['Kn. (arcana)', 'Int', true, false],
  ['Kn. (dungeoneering)', 'Int', true, false],
  ['Kn. (engineering)', 'Int', true, false],
  ['Kn. (geography)', 'Int', true, false],
  ['Kn. (history)', 'Int', true, false],
  ['Kn. (local)', 'Int', true, false],
  ['Kn. (martial)', 'Int', true, false],
  ['Kn. (nature)', 'Int', true, false],
  ['Kn. (nobility)', 'Int', true, false],
  ['Kn. (planes)', 'Int', true, false],
  ['Kn. (psionics)', 'Int', true, false],
  ['Kn. (religion)', 'Int', true, false],
  ['Linguistics', 'Int', true, false],
  ['Lore', 'Int', true, false, 2],
  ['Perception', 'Wis', false, false],
  ['Perform', 'Cha', false, false, 2],
  ['Profession', 'Wis', true, false, 2],
  ['Ride', 'Dex', false, true],
  ['Sense Motive', 'Wis', false, false],
  ['Sleight of Hand', 'Dex', true, true],
  ['Spellcraft', 'Int', true, false],
  ['Stealth', 'Dex', false, true],
  ['Survival', 'Wis', false, false],
  ['Swim', 'Str', false, true],
  ['Use Magic Device', 'Cha', true, false],
].flatMap(([name, ability, trained, acp, copies = 1]) => Array.from({ length: copies }, () => ({
  name, ability, trained, acp,
})));

/** Perform's nine categories, each with the examples it covers. */
export const PERFORM_CATEGORIES = [
  ['Act', 'comedy, drama, pantomime'],
  ['Comedy', 'buffoonery, limericks, joke-telling'],
  ['Dance', 'ballet, waltz, jig'],
  ['Keyboard instruments', 'harpsichord, piano, pipe organ'],
  ['Oratory', 'epic, ode, storytelling'],
  ['Percussion instruments', 'bells, chimes, drums, gong'],
  ['String instruments', 'fiddle, harp, lute, mandolin'],
  ['Wind instruments', 'flute, pan pipes, recorder, trumpet'],
  ['Sing', 'ballad, chant, melody'],
];

const VARIANT_ROOTS = [...VARIANT_SKILLS, 'Perform'];

/**
 * The open-slot skill a name belongs to, if any. Matched on a word boundary,
 * so "Craft (Craftsman)" is a Craft but "Craftsmanship" is its own skill.
 */
export function skillVariantRoot(name) {
  const s = String(name ?? '').trim();
  return VARIANT_ROOTS.find((r) => new RegExp(`^${r}\\b`, 'i').test(s)) ?? null;
}

/** What kind of slot that is: 'text', 'perform', or null for no slot at all. */
export function skillVariantKind(name) {
  const root = skillVariantRoot(name);
  if (!root) return null;
  return root === 'Perform' ? 'perform' : 'text';
}

/** Strip one fully-wrapping pair of parentheses: "(Weapons)" -> "Weapons". */
function unwrapParens(text) {
  if (!text.startsWith('(') || !text.endsWith(')')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      // A pair that closes early wraps only part of the text, not all of it.
      if (depth === 0 && i < text.length - 1) return text;
    }
  }
  return depth === 0 ? text.slice(1, -1).trim() : text;
}

function stripPrefix(text, prefix) {
  const p = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The lookahead keeps "Craftsmanship" whole: a prefix only counts when the
  // word it names actually ends there.
  return text.replace(new RegExp(`^${p}(?![A-Za-z0-9])\\s*[:\\u2013\\u2014-]?\\s*`, 'i'), '').trim();
}

/**
 * Clean a variant a player typed.
 *
 * They write the whole skill as often as they write only the variant --
 * "Craft (Weapons and Armor)", "Craft: Weapons and Armor", "(Weapons and
 * Armor)" -- so the skill's own name and any wrapping parentheses come off and
 * only "Weapons and Armor" is stored. The display puts the rest back.
 */
export function cleanSkillVariant(name, spec) {
  let s = String(spec ?? '').trim();
  const prefixes = [String(name ?? '').trim(), skillVariantRoot(name)].filter(Boolean);
  // A couple of passes, because "(Craft (Weapons))" needs both steps twice.
  for (let pass = 0; pass < 3; pass += 1) {
    const before = s;
    s = unwrapParens(s);
    for (const p of prefixes) s = stripPrefix(s, p);
    if (s === before) break;
  }
  return s;
}

/**
 * The Perform category a stored value names, or null if it names none.
 *
 * The source sheets abbreviate a couple of them -- "String" for "String
 * instruments" -- so a value that unambiguously begins exactly one category
 * resolves to it. Anything vaguer is left as written rather than guessed at.
 */
export function performCategory(spec) {
  const s = String(spec ?? '').trim().toLowerCase();
  if (!s) return null;
  const exact = PERFORM_CATEGORIES.find(([c]) => c.toLowerCase() === s);
  if (exact) return exact[0];
  const begins = PERFORM_CATEGORIES.filter(([c]) => c.toLowerCase().startsWith(`${s} `));
  return begins.length === 1 ? begins[0][0] : null;
}

/** How a skill reads with its variant: "Craft (Weapons and Armor)". */
export function skillLabel(name, spec) {
  const base = String(name ?? '').trim();
  const variant = String(spec ?? '').trim();
  return variant ? `${base} (${variant})` : base;
}

/**
 * Bonus spell points from tradition drawbacks (the sheet's V44 progression),
 * multiplied by the number of distinct casting classes.
 */
export function spBoonPoints(tier, level) {
  const t = Math.min(5, Math.max(0, Math.floor(tier)));
  const L = Math.max(0, Number(level) || 0);
  switch (t) {
    case 5: return L;
    case 4: return 1 + Math.floor(L / 1.5);
    case 3: return Math.ceil(L / 2);
    case 2: return 1 + Math.floor(L / 3);
    case 1: return 1 + Math.floor(L / 6);
    default: return 0;
  }
}

/**
 * What the `n`th boon adds on its own.
 *
 * The ladder is quoted for a whole number of boons, so one boon's worth is the
 * step it adds to the one below it -- which keeps the steps summing back to the
 * ladder exactly, however they are split between spell points and essence.
 */
export function boonStep(n, level) {
  return spBoonPoints(n, level) - spBoonPoints(n - 1, level);
}

/** "Somatic Casting x2" (or "Somatic Casting 2") counts as two drawbacks. */
export function drawbackWeight(text) {
  const m = String(text || '').trim().match(/(?:[x×]\s*|\s)(\d+)$/i);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

/** Standard trait categories; characters may add their own on top. */
export const TRAIT_CATEGORIES = ['Campaign', 'Combat', 'Cosmic', 'Equipment', 'Faith',
  'Family', 'Magic', 'Mount', 'Race', 'Regional', 'Religion', 'Social'];

/** The structured trait/drawback slots and how the sheet labels them. */
export const TRAIT_SLOTS = [
  { key: 'trait1', label: 'Trait 1', kind: 'trait', sheet: 'Trait 1' },
  { key: 'trait2', label: 'Trait 2', kind: 'trait', sheet: 'Trait 2' },
  { key: 'trait3', label: 'Trait 3', kind: 'trait', sheet: 'Trait 3' },
  { key: 'drawback1', label: 'Drawback 1', kind: 'drawback', sheet: 'Drawback 1', unlocks: 'trait4' },
  { key: 'trait4', label: 'Trait 4', kind: 'trait', sheet: 'Trait 4', requires: 'drawback1' },
  { key: 'drawback2', label: 'Drawback 2', kind: 'drawback', sheet: 'Drawback 2', unlocks: 'trait5' },
  { key: 'trait5', label: 'Trait 5', kind: 'trait', sheet: 'Trait 5', requires: 'drawback2' },
  { key: 'majorDrawback', label: 'Major Drawback', kind: 'drawback', sheet: 'Maj. DB', unlocks: 'drawbackFeat' },
  { key: 'drawbackFeat', label: 'Drawback Feat', kind: 'feat', sheet: 'DB Feat', requires: 'majorDrawback' },
];

/* ----- mythic ----- */

/** Character level -> mythic tier, from the campaign's Mythic tab table. */
export function tierAtLevel(level) {
  const L = Number(level) || 0;
  if (L >= 15) return Math.min(10, L - 10);   // 15→5 … 20→10
  if (L >= 14) return 4;
  if (L >= 12) return 3;
  if (L >= 10) return 2;
  if (L >= 8) return 1;
  return 0;
}

/** Bonus hit points per tier by path (Mythic Adventures). */
export const MYTHIC_PATH_HP = {
  Champion: 5, Guardian: 5, Marshal: 4, Trickster: 4, Archmage: 3, Hierophant: 3,
};

/** Mythic ability-score picks: +2 at every even tier, assignable like ABP. */
export const MYTHIC_STAT_TIERS = [2, 4, 6, 8, 10];
export const MYTHIC_STAT_BONUS = 2;

/**
 * The mythic ladder: ten tiers, each granting one thing. Odd tiers grant a
 * mythic feat, even tiers a path power and the +2 ability increase -- which is
 * why the sheet's column reads Feat 1, RP Power 1, Feat 2, RP Power 2 and so
 * on, one row per tier in order.
 */
export const MYTHIC_TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** What a tier hands over, as the sheet labels it. */
export function mythicTierGrant(tier) {
  const n = Math.ceil(tier / 2);
  return tier % 2 ? `Feat ${n}` : `RP Power ${n}`;
}

/** The character level a tier is reached at -- the inverse of tierAtLevel. */
export const MYTHIC_TIER_LEVEL = (() => {
  const out = {};
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const t = tierAtLevel(level);
    if (t && out[t] === undefined) out[t] = level;
  }
  return out;
})();

export const MYTHIC_TRADITION_SLOTS = [
  { key: 'drawback1', label: 'Drawback 1', kind: 'drawback', mandatory: true, unlocks: 'boon1' },
  { key: 'drawback2', label: 'Drawback 2', kind: 'drawback', unlocks: 'boon2' },
  { key: 'drawback3', label: 'Drawback 3', kind: 'drawback', unlocks: 'boon3' },
  { key: 'quality', label: 'Quality', kind: 'quality' },
  { key: 'boon1', label: 'Boon 1', kind: 'boon', requires: 'drawback1' },
  { key: 'boon2', label: 'Boon 2', kind: 'boon', requires: 'drawback2' },
  { key: 'boon3', label: 'Boon 3', kind: 'boon', requires: 'drawback3' },
];

/* ------------------------------------------------------------------ *
 * Typed save and AC bonuses
 *
 * The sheet's Stats tab breaks both down by bonus type -- one column per type,
 * a Total beside them -- and that breakdown is the only place a flat save or AC
 * bonus is written. The columns below are those columns, in the sheet's order.
 *
 * `sheet` closes each row: whatever the source total held beyond the parts the
 * export could show. It is an ordinary editable field like the rest, and on a
 * character built here it simply stays 0.
 * ------------------------------------------------------------------ */

/** Saves, from `Stats!C11:Q11`. */
export const SAVE_BONUS_TYPES = [
  ['abpResistance', 'ABP (Resist)'],
  ['resistance', 'Resist.'],
  ['template', 'Template'],
  ['alchemical', 'Alch.'],
  ['circumstance', 'Circum.'],
  ['competence', 'Compet.'],
  ['enhancement', 'Enhan.'],
  ['insight', 'Insight'],
  ['luck', 'Luck'],
  ['trait', 'Trait'],
  ['morale', 'Morale'],
  ['profane', 'Profane'],
  ['racial', 'Racial'],
  ['sacred', 'Sacred'],
  ['untyped', 'Untyped'],
  ['sheet', 'Sheet'],
];

/**
 * AC, from `Stats!C16:R16`.
 *
 * `touch: false` marks the armour-side types a touch attack ignores -- which is
 * what the sheet's own "AC No Nat" row leaves out -- and `flatFooted: false`
 * marks dodge, which you lose when caught unaware.
 */
export const AC_BONUS_TYPES = [
  ['abpDeflection', 'ABP Deflect'],
  ['deflection', 'Deflect.'],
  ['abpNatural', 'ABP Nat', { touch: false }],
  ['enhancedNatural', 'E. Nat', { touch: false }],
  ['natural', 'Natural', { touch: false }],
  ['enhancement', 'Enhan.', { touch: false }],
  ['dodge', 'Dodge', { flatFooted: false }],
  ['circumstance', 'Circ.'],
  ['insight', 'Insight'],
  ['luck', 'Luck'],
  ['morale', 'Morale'],
  ['sacred', 'Sacred'],
  ['profane', 'Profane'],
  ['untyped', 'Untyped'],
  ['size', 'Size'],
  ['template', 'Template'],
  ['sheet', 'Sheet'],
];

/**
 * Automatic Bonus Progression's defence ladder, from the workbook's `dataSheet`
 * ABP column: the resistance, deflection and toughening (natural armour)
 * bonuses a character has at a level. `[level, resistance, deflection, natural]`
 * where each row is the level a step is gained; the value holds until the next.
 */
export const ABP_DEFENCE_LADDER = [
  [3, 1, 0, 0],
  [5, 1, 1, 0],
  [8, 2, 1, 1],
  [10, 3, 2, 1],
  [13, 4, 2, 2],
  [14, 5, 2, 2],
  [16, 5, 3, 3],
  [17, 5, 4, 4],
  [18, 5, 5, 5],
];

/** The three ABP defence bonuses at a level. */
export function abpDefence(level) {
  const l = Number(level) || 0;
  let row = [0, 0, 0, 0];
  for (const step of ABP_DEFENCE_LADDER) {
    if (step[0] <= l) row = step;
  }
  return { abpResistance: row[1], abpDeflection: row[2], abpNatural: row[3] };
}

/**
 * ABP and its typed counterpart are one bonus, not two: resistance from the
 * progression and a cloak of resistance are both *resistance*, deflection and
 * a ring of protection both *deflection*, toughening and an amulet of natural
 * armour both *enhancement to natural armour*. Each pair sums to at most the
 * cap -- unless the typed side is past the cap on its own, in which case it
 * simply stands, the way a +6 item would.
 */
export const ABP_DEFENCE_CAP = 5;
export const ABP_DEFENCE_GROUPS = [
  ['abpResistance', 'resistance'],
  ['abpDeflection', 'deflection'],
  ['abpNatural', 'enhancedNatural'],
];

/** One ABP-plus-typed pair, capped as above. */
export function abpGroupTotal(abp, typed) {
  const a = Number(abp) || 0;
  const t = Number(typed) || 0;
  return t > ABP_DEFENCE_CAP ? t : Math.min(ABP_DEFENCE_CAP, a + t);
}

/**
 * Sum a resolved bonus block, optionally only the types a defence keeps. The
 * ABP pairs are summed as pairs, so a typed resistance bonus on top of the
 * progression's stops at the cap rather than stacking past it.
 */
export function bonusTotal(resolved, types, filter = null) {
  const keys = new Set(types.map(([key]) => key));
  const paired = new Map();
  for (const [abp, typed] of ABP_DEFENCE_GROUPS) {
    if (keys.has(abp) && keys.has(typed)) paired.set(typed, abp);
  }
  return types.reduce((t, [key, , flags]) => {
    if (filter && flags && flags[filter] === false) return t;
    if (paired.has(key)) return t;   // counted with its ABP partner below
    const typed = [...paired].find(([, abp]) => abp === key)?.[0];
    if (typed) return t + abpGroupTotal(resolved?.[key], resolved?.[typed]);
    return t + (Number(resolved?.[key]) || 0);
  }, 0);
}

/* ----- gestalt class progressions ----- */

/**
 * Base save progression: good saves give +2 at the class's first level and
 * +1/2 per level; poor saves +1/3 per level. Gestalt characters take the best
 * progression among the classes present at each level.
 */
export function gestaltSaveBase(perLevelGood, anyGood) {
  const inc = perLevelGood.reduce((t, good) => t + (good == null ? 0 : (good ? 0.5 : 1 / 3)), 0);
  return (anyGood ? 2 : 0) + Math.floor(inc);
}

/* ----- feature-column level rules ----- */

/**
 * A progression feature column may carry a rule saying which levels it grants
 * on, so a Kheshig's veil column lights up at class levels 2/6/10/14/18 and
 * the rows between stay locked, rather than every column offering a slot at
 * every level.
 *
 * A rule is a comma-separated list of terms unioned left to right, which is
 * what lets a generated pattern be extended afterwards -- "2, +4, 3" is the
 * Kheshig schedule plus a one-off veil at 3:
 *
 *   all              every level -- also what no rule at all means
 *   odd | even       odd or even levels
 *   N                that level
 *   A-B              an inclusive range
 *   +N               every Nth level onwards, starting from the term before it
 *   -TERM            subtract a term rather than adding it ("odd, -13")
 *
 * Terms count the CLASS's own levels, because "every 4 levels thereafter" is
 * a statement about the class and not about the character carrying it; the
 * two differ the moment a gestalt track has a gap. A leading "char:" switches
 * the whole rule to character levels.
 *
 * Anything that is not a list of terms goes to the formula evaluator with
 * classLevel / charLevel / level in scope, so the shapes this syntax does not
 * cover stay sayable: "classLevel % 3 == 1".
 */
const BASIS_PREFIX = /^(char|character|class)\s*:\s*/i;
const RANGE_TERM = /^(\d+)\s*(?:to|\.\.|[-–—])\s*(\d+)$/;

function parseRuleTerm(text) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t === 'all' || t === 'every' || t === '*') return { kind: 'all' };
  if (t === 'odd') return { kind: 'parity', remainder: 1 };
  if (t === 'even') return { kind: 'parity', remainder: 0 };
  if (/^\+\d+$/.test(t)) {
    const step = Number(t.slice(1));
    return step > 0 ? { kind: 'step', step } : null;
  }
  const range = RANGE_TERM.exec(t);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    return { kind: 'range', from: Math.min(a, b), to: Math.max(a, b) };
  }
  if (/^\d+$/.test(t)) return { kind: 'level', level: Number(t) };
  return null;
}

/**
 * Parse rule text into {kind, basis, terms|expr, error}. Never throws: a rule
 * that parses as neither a pattern nor a formula comes back as kind 'error'
 * and grants every level, so a typo locks nothing away.
 */
export function parseLevelRule(source) {
  const raw = String(source ?? '').trim();
  const prefix = BASIS_PREFIX.exec(raw);
  const basis = prefix && /^char/i.test(prefix[1]) ? 'char' : 'class';
  const body = prefix ? raw.slice(prefix[0].length).trim() : raw;
  const base = { source: raw, basis, terms: [], expr: null, error: null };
  if (!body) return { ...base, kind: 'all' };

  const terms = [];
  for (const part of body.split(',').map((s) => s.trim()).filter(Boolean)) {
    const subtract = part.startsWith('-') || part.startsWith('!');
    const term = parseRuleTerm(subtract ? part.slice(1) : part);
    if (!term) { terms.length = 0; break; }
    terms.push({ ...term, subtract });
  }
  if (terms.length) return { ...base, kind: 'pattern', terms };

  const info = analyse(body);
  return info.ok
    ? { ...base, kind: 'formula', expr: body }
    : { ...base, kind: 'error', error: info.error };
}

const asRule = (rule) => (typeof rule === 'string' || rule == null ? parseLevelRule(rule) : rule);

/**
 * Does a rule grant at this row? `classLevel` counts the class's own levels,
 * `charLevel` is the character level the row sits at.
 */
export function levelRuleGrants(rule, classLevel, charLevel) {
  const parsed = asRule(rule);
  if (parsed.kind === 'all' || parsed.kind === 'error') return true;
  const cls = Number(classLevel) || 0;
  const chr = Number(charLevel) || 0;
  const level = parsed.basis === 'char' ? chr : cls;

  if (parsed.kind === 'formula') {
    try {
      const v = evaluateFormula(parsed.expr, { level, classLevel: cls, charLevel: chr });
      return typeof v === 'number' ? v !== 0 : Boolean(v);
    } catch {
      return false;
    }
  }
  return levelRuleLevels(parsed).includes(level);
}

/** The levels a rule grants, within 1..max. */
export function levelRuleLevels(rule, max = MAX_LEVEL) {
  const parsed = asRule(rule);
  const every = () => Array.from({ length: max }, (_, i) => i + 1);
  if (parsed.kind === 'all' || parsed.kind === 'error') return every();
  if (parsed.kind === 'formula') return every().filter((l) => levelRuleGrants(parsed, l, l));

  const out = new Set();
  let anchor = 1;   // where the next "+N" starts counting
  for (const term of parsed.terms) {
    let hit = [];
    switch (term.kind) {
      case 'all': hit = every(); break;
      case 'parity': hit = every().filter((l) => l % 2 === term.remainder); break;
      case 'level': if (term.level >= 1 && term.level <= max) hit = [term.level]; break;
      case 'range': hit = every().filter((l) => l >= term.from && l <= term.to); break;
      case 'step': for (let l = anchor; l <= max; l += term.step) hit.push(l); break;
      default: break;
    }
    for (const l of hit) { if (term.subtract) out.delete(l); else out.add(l); }
    // "thereafter" counts from the end of the term before it, so "5-10, +3"
    // steps on from 10. Subtractions leave the anchor where it was.
    if (hit.length && !term.subtract) anchor = Math.max(...hit);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Split "{Infusions, odd, -5, -9, -13}" into its name and its rule.
 *
 * A rule group is normally two fields, but written out it reads as one thing,
 * so typing the braced form into either box fills both. The name runs to the
 * first comma; everything after it is the rule.
 */
export function parseGroupText(text) {
  const raw = String(text ?? '').trim();
  const braced = /^\{(.*)\}$/s.exec(raw);
  if (!braced) return null;
  const body = braced[1];
  const comma = body.indexOf(',');
  return comma === -1
    ? { name: body.trim(), rule: '' }
    : { name: body.slice(0, comma).trim(), rule: body.slice(comma + 1).trim() };
}

/** Condense a level list for display: [1,2,3,7,9] -> "1-3, 7, 9". */
export function summariseLevels(levels) {
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  const runs = [];
  for (const l of sorted) {
    const last = runs[runs.length - 1];
    if (last && l === last[1] + 1) last[1] = l;
    else runs.push([l, l]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

/* ----- unarmed practitioner damage (dataSheet!F80:L101) ----- */

export const UNARMED_SIZE_COLUMNS = ['Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];
export const UNARMED_SPHERES = ['Boxing', 'Brute', 'Open Hand', 'Wrestling'];

/**
 * What else counts as unarmed talents, from the sheet's own cells: Talented
 * Knuckle is +2, a Brawler's Vest +4, and the Bands of the Asura veil (a
 * belt) adds Open Hand talents for the essence invested in it. Unorthodox
 * Unarmed Training names two more spheres per time it is taken.
 */
export const TALENTED_KNUCKLE_TALENTS = 2;
export const BRAWLERS_VEST_TALENTS = 4;
export const ASURA_TALENTS_PER_ESSENCE = 4;
export const ASURA_VEIL = /bands? of the asura/i;
export const UNORTHODOX_FEAT = /unorthodox unarmed training/i;
export const UNORTHODOX_SPHERES_PER_FEAT = 2;

/** Rows are talent counts 0-20; columns follow UNARMED_SIZE_COLUMNS. */
export const UNARMED_TABLE = [
  ['1d2', '1d3', '1d4', '1d6', '1d8', '2d6'],   // 0
  ['1d3', '1d4', '1d6', '1d8', '2d6', '3d6'],   // 1
  ['1d3', '1d4', '1d6', '1d8', '2d6', '3d6'],
  ['1d3', '1d4', '1d6', '1d8', '2d6', '3d6'],
  ['1d4', '1d6', '1d8', '2d6', '3d6', '3d8'],   // 4
  ['1d4', '1d6', '1d8', '2d6', '3d6', '3d8'],
  ['1d4', '1d6', '1d8', '2d6', '3d6', '3d8'],
  ['1d4', '1d6', '1d8', '2d6', '3d6', '3d8'],
  ['1d6', '1d8', '2d6', '3d6', '3d8', '4d8'],   // 8
  ['1d6', '1d8', '2d6', '3d6', '3d8', '4d8'],
  ['1d6', '1d8', '2d6', '3d6', '3d8', '4d8'],
  ['1d6', '1d8', '2d6', '3d6', '3d8', '4d8'],
  ['1d8', '2d6', '3d6', '3d8', '4d8', '6d8'],   // 12
  ['1d8', '2d6', '3d6', '3d8', '4d8', '6d8'],
  ['1d8', '2d6', '3d6', '3d8', '4d8', '6d8'],
  ['1d8', '2d6', '3d6', '3d8', '4d8', '6d8'],
  ['2d6', '2d8', '3d8', '4d8', '6d8', '8d8'],   // 16
  ['2d6', '2d8', '3d8', '4d8', '6d8', '8d8'],
  ['2d6', '2d8', '3d8', '4d8', '6d8', '8d8'],
  ['2d6', '2d8', '3d8', '4d8', '6d8', '8d8'],
  ['2d8', '2d10', '4d8', '6d8', '8d8', '12d8'], // 20+
];

/** Die -> step index and back, matching the sheet's M:O chain exactly
 *  (2d10 and 3d8 share step 11; the reverse lookup keeps the first match). */
export const DIE_STEP = {
  '1d2': 2, '1d3': 3, '1d4': 4, '1d6': 5, '1d8': 6, '1d10': 7, '2d6': 8, '2d8': 9,
  '3d6': 10, '2d10': 11, '3d8': 11, '4d6': 12, '4d8': 13, '6d6': 14, '6d8': 15,
  '8d6': 16, '8d8': 17, '12d6': 18, '12d8': 19, '16d6': 20,
};
export const STEP_DIE = {
  2: '1d2', 3: '1d3', 4: '1d4', 5: '1d6', 6: '1d8', 7: '1d10', 8: '2d6', 9: '2d8',
  10: '3d6', 11: '2d10', 12: '4d6', 13: '4d8', 14: '6d6', 15: '6d8', 16: '8d6',
  17: '8d8', 18: '12d6', 19: '12d8', 20: '16d6',
};

/**
 * Unarmed damage dice, exactly as the sheet computes them: effective talents
 * pick the Medium-column base die, then each size increase is worth two die
 * steps and each step increase one, capped at the top of the chain.
 */
export function unarmedDice(talents, { stepIncreases = 0, sizeIncreases = 0 } = {}) {
  const row = UNARMED_TABLE[Math.max(0, Math.min(20, Math.floor(Number(talents) || 0)))];
  const base = row[1]; // Medium
  let step = (DIE_STEP[base] ?? 4)
    + 2 * (Number(sizeIncreases) || 0)
    + (Number(stepIncreases) || 0);
  step = Math.max(2, Math.min(20, step));
  return STEP_DIE[step];
}

/** Size -> AC/attack modifier and its opposite for CMB/CMD. */
export const SIZE_MODIFIERS = {
  Fine: 8, Diminutive: 4, Tiny: 2, Small: 1, Medium: 0,
  Large: -1, Huge: -2, Gargantuan: -4, Colossal: -8,
};

export const SIZE_CARRY_MULTIPLIER = {
  Fine: 0.125, Diminutive: 0.25, Tiny: 0.5, Small: 0.75, Medium: 1,
  Large: 2, Huge: 4, Gargantuan: 8, Colossal: 16,
};

/** Str 1-29 light-load capacity; beyond 29 it quadruples every +10. */
const CARRY_BASE = [
  0, 3, 6, 10, 13, 16, 20, 23, 26, 30, 33, 38, 43, 50, 58, 66,
  76, 86, 100, 116, 133, 153, 173, 200, 233, 266, 306, 346, 400, 466,
];

/** Light-load limit for a Strength score, extended past the printed table. */
export function carryLight(str) {
  const s = Math.max(0, Math.floor(Number(str) || 0));
  if (s < CARRY_BASE.length) return CARRY_BASE[s];
  const doublings = Math.floor((s - 20) / 10);
  return CARRY_BASE[((s - 20) % 10) + 20] * 4 ** doublings;
}

export function carryTiers(str, { multiplier = 1, antHaul = 1, quadruped = false } = {}) {
  const scale = multiplier * (antHaul || 1) * (quadruped ? 1.5 : 1);
  const light = Math.floor(carryLight(str) * scale);
  return {
    light,
    medium: light * 2,
    heavy: light * 3,
    offGround: light * 6,
    pushDrag: light * 15,
  };
}

/** "+20/+15/+10/+5" from a BAB total. */
export function iterativeAttacks(bab, bonus = 0) {
  const b = Math.floor(Number(bab) || 0);
  if (b <= 0) return `${fmt(bonus)}`;
  const out = [];
  for (let at = b; at > 0; at -= 5) out.push(at + Number(bonus || 0));
  return out.map(fmt).join('/');
}

/** Always show an explicit sign -- sheets are read at a glance. */
export function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v >= 0 ? `+${v}` : `${v}`;
}

/**
 * Skill total from its parts.
 * The +3 class-skill bonus applies only once at least one rank is invested.
 */
export function skillTotal({ ranks = 0, classSkill = false, abilityMod: am = 0, misc = 0, acp = 0 }) {
  return ranks + (classSkill && ranks > 0 ? 3 : 0) + am + misc + acp;
}

/* ------------------------------------------------------------------ *
 * Equipment: armor and shields feed AC, max-Dex caps and armor check
 * penalties, exactly as the workbook's named ranges did.
 * ------------------------------------------------------------------ */

export const GEAR_BONUS_TYPES = ['Enhancement', 'Armor', 'Shield', 'Deflection',
  'Natural Armor', 'Dodge', 'Resistance', 'Competence', 'Insight', 'Luck', 'Morale',
  'Sacred', 'Profane', 'Alchemical', 'Circumstance', 'Size', 'Inherent', 'Untyped'];

export const WEAPON_ATTACK_TYPES = ['Melee', 'Alt Melee', 'Ranged', 'Alt Ranged', 'CMB', 'Alt CMB'];

/** Fighter weapon groups (plus the ones these sheets actually use). */
export const WEAPON_GROUPS = ['Axes', 'Bows', 'Close', 'Crossbows', 'Double', 'Firearms',
  'Flails', 'Hammers', 'Heavy Blades', 'Light Blades', 'Monk', 'Natural', 'Polearms',
  'Siege Engines', 'Spears', 'Thrown', 'Tribal',
  // Not a fighter group: the weapon an akashic veil creates, which the sheets
  // file here and which the [Enhanced] rule makes its wielder proficient with.
  'Veil'];
export const WEAPON_HANDEDNESS = ['Light', 'One-Handed', 'Two-Handed'];
export const WEAPON_FAMILIARITY = ['Simple', 'Martial', 'Exotic'];
/** What a class hands out under "Weapon and Armor Proficiency", as the Overview lists it. */
export const ARMOR_PROFICIENCIES = ['Unarmored', 'Light', 'Medium', 'Heavy'];
export const SHIELD_PROFICIENCIES = ['None', 'Buckler', 'Light', 'Heavy', 'Tower'];
export const WEAPON_CRIT_MULTS = ['x2', 'x3', 'x4'];
export const WEAPON_ABILITY_MULTS = ['0.5', '1', '1.5', '2'];

/* ------------------------------------------------------------------ *
 * Akashic veilweaving.
 *
 * The workbook's Akashic tab is a slot board: each veil slot holds one
 * veil, or two when Twinveil is ticked, and every shaped veil takes a
 * share of the day's essence. Essence spent on a veil raises its save DC
 * point for point above the veilweaver's base, which is the only sum the
 * sheet actually computed:
 *
 *   veil DC = base DC + essence invested in that veil
 *
 * The caps come from the class block: essence cap is what one veil can
 * hold, bonus cap is the extra a capacity boost allows, total cap is the
 * two added. The pool itself is the sum of the essence sources.
 * ------------------------------------------------------------------ */

/**
 * Veil slots in the order the workbook lays them out.
 *
 * The sheet writes them as "<slot> Veil" headers down two columns, so the
 * importer matches on this list rather than on cell addresses -- a sheet
 * that reorders or omits slots still reads correctly.
 */
export const VEIL_SLOTS = ['Headband', 'Voice', 'Shoulder', 'Body', 'Hands', 'Ring',
  'Feet', 'Storm', 'Head', 'Interface', 'Neck', 'Chest', 'Wrist', 'Belt', 'Blood', 'Black'];

/** The two Kheshig receptacles, which name a slot instead of occupying one. */
export const KHESHIG_VEILS = ['Weapon Veil (Kheshig)', 'Armor Veil (Kheshig)'];

/** Essence sources the sheet totals into the daily pool. */
export const ESSENCE_SOURCES = [
  ['featTraits', 'Essence Feat/Traits'],
  ['boon', 'Essence Boon'],
  ['radiantDawn', 'Radiant Dawn'],
  ['fcb', 'FCB'],
];

/** How many veilweaving class blocks the template provides. */
export const VEILWEAVING_CLASS_SLOTS = 6;

/**
 * The Veilweaving sphere's exchange rate: two spell points condense into one
 * temporary essence, which lasts the day and is spent from the caster's own
 * pool -- so the points are gone whether or not the essence gets invested.
 */
export const SP_PER_TEMP_ESSENCE = 2;

/** Temporary essence condensed from spell points: whole points, never negative. */
export function tempEssence(akashic) {
  return Math.max(0, Math.trunc(Number(akashic?.essence?.spTemp) || 0));
}

/** The spell points those condensed essence points cost. */
export function tempEssenceCost(akashic) {
  return tempEssence(akashic) * SP_PER_TEMP_ESSENCE;
}

/** A veil's save DC is the veilweaver's base plus the essence invested in it. */
export function veilDC(baseDC, essence) {
  return (Number(baseDC) || 0) + (Number(essence) || 0);
}

/** Essence committed across every shaped veil, including twinned second veils. */
export function essenceInvested(slots = []) {
  return slots.reduce((total, slot) => total
    + (slot.veils || []).reduce((n, v) => n + (Number(v.essence) || 0), 0), 0);
}

/* ------------------------------------------------------------------ *
 * Path of War maneuvers.
 *
 * The Maneuvers tab is a catalogue with tick boxes: each discipline owns
 * a column listing every maneuver and stance it grants, and a 1 beside a
 * row means the character actually knows it. The counts along the top are
 * sums of those ticks, checked against what the class progression allows.
 * ------------------------------------------------------------------ */

/** Maneuver types the sheet's Type column uses. */
export const MANEUVER_TYPES = ['Strike', 'Boost', 'Counter', 'Stance', 'Untyped'];

/** Where the campaign's rules text lives. */
export const WIKI_BASE = 'https://metzo.miraheze.org/wiki/';

/**
 * The wiki page for a named rules element.
 *
 * MediaWiki titles use underscores for spaces. The catalogue was typed in
 * Google Sheets, whose autocorrect turned most apostrophes curly -- 93 of the
 * 1,033 maneuver names carry U+2019 rather than a plain quote -- so they are
 * straightened before encoding, or "Seraph’s Wrath" would ask the wiki for
 * `Seraph%E2%80%99s_Wrath` and get nothing.
 */
export function wikiUrl(name) {
  const title = String(name ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .trim()
    .replace(/\s+/g, '_');
  if (!title) return null;
  // encodeURIComponent leaves the apostrophe alone; the wiki's own links
  // percent-encode it, so match that.
  return WIKI_BASE + encodeURIComponent(title).replace(/'/g, '%27');
}

/** Discipline columns the template provides. */
export const DISCIPLINE_SLOTS = 10;

/** Highest maneuver level the tab lays out. */
export const MANEUVER_MAX_LEVEL = 9;

/* ------------------------------------------------------------------ *
 * Vancian casting.
 *
 * Six casting-class blocks, each a spell level 0-9 table of slots per
 * day, save DC and spells known.
 *
 * A block names its class twice, and the two are not the same thing: the
 * display name is whichever of the character's own classes this is ("Sorcerer
 * (Sage Bloodline)"), while the **slot type** is the row of the shared casting
 * table it draws from ("Sorcerer"). Only the second has to be a name the table
 * knows, which is what lets an archetype keep its own title.
 *
 * Everything numeric below is derived rather than stored. The workbook computed
 * all of it too -- in Google-only formulas that Excel could not represent, so
 * they exported as a frozen cached value and the tab arrived looking like a
 * hand-typed grid. These are those formulas.
 * ------------------------------------------------------------------ */

/** How many casting-class blocks the template provides. */
export const CASTING_CLASS_SLOTS = 6;

/** Spell levels 0-9. */
export const SPELL_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Spell save DC: 10 + spell level + the casting stat's modifier. */
export function spellDC(spellLevel, statMod = 0) {
  return 10 + (Number(spellLevel) || 0) + (Number(statMod) || 0);
}

/**
 * How a class gets its spells into its slots.
 *
 * The three differ in one thing that matters to a sheet: whether a slot carries
 * a spell's name. A prepared caster fills each slot in advance, so the slot
 * *is* the spell; a spontaneous caster has a fixed list and spends anonymous
 * slots from a pool; a hybrid picks a fresh list each day and then spends the
 * pool against it. `known` is the count the shared table supplies, which only
 * means anything where there is a list at all -- a prepared caster's spellbook
 * is not slot-derived, and the workbook's newer revision blanked that column
 * for them.
 */
export const PREP_STYLES = [
  { key: 'prepared', label: 'Prepared', slots: 'named', list: 'none', known: false },
  { key: 'spontaneous', label: 'Spontaneous', slots: 'pool', list: 'fixed', known: true },
  { key: 'hybrid', label: 'Hybrid', slots: 'pool', list: 'daily', known: true },
];

export const PREP_STYLE_KEYS = PREP_STYLES.map((s) => s.key);

/** One preparation style by key, defaulting to prepared. */
export function prepStyle(key) {
  const want = String(key || '').trim().toLowerCase();
  return PREP_STYLES.find((s) => s.key === want) || PREP_STYLES[0];
}

/**
 * Where the magic comes from. Descriptive except for the vocabulary it picks:
 * the workbook renamed its own column headers off this cell, and an alchemist
 * brews extracts rather than casting spells.
 */
export const CASTING_SOURCES = [
  { key: 'arcane', label: 'Arcane', one: 'Spell', many: 'Spells' },
  { key: 'divine', label: 'Divine', one: 'Spell', many: 'Spells' },
  { key: 'occult', label: 'Occult', one: 'Spell', many: 'Spells' },
  { key: 'alchemy', label: 'Alchemy', one: 'Extract', many: 'Extracts' },
];

export const CASTING_SOURCE_KEYS = CASTING_SOURCES.map((s) => s.key);

/** What this source calls the thing it makes, singular and plural. */
export function castingNoun(source) {
  const want = String(source || '').trim().toLowerCase();
  return CASTING_SOURCES.find((s) => s.key === want) || CASTING_SOURCES[0];
}

/**
 * Bonus slots from a high casting stat, per spell level.
 *
 * The sheet's own form, kept as written: one extra at a modifier equal to the
 * spell level, and one more for every four beyond it. Zero at level 0 -- a
 * high stat never grants bonus cantrips.
 */
export function bonusSpellSlots(statMod, spellLevel) {
  const level = Number(spellLevel) || 0;
  if (level === 0) return 0;
  return Math.max(Math.ceil(((Number(statMod) || 0) - level + 1) / 4), 0);
}

/**
 * Whether a stat is high enough to cast at a spell level at all.
 *
 * The score, not the modifier: 10 + the spell level, so an 11 reaches 1st and
 * a 19 reaches 9th. The sheet took the better of the block's two stats.
 */
export function castableAt(score, spellLevel) {
  return (Number(score) || 0) - 10 >= (Number(spellLevel) || 0);
}

/* ------------------------------------------------------------------ *
 * Item crafting.
 *
 * The workbook's Item Crafting tab is a small spreadsheet calculator:
 *
 *   speed/day    = 1000 + the speed increases below it        (C2)
 *   base cost    = 50% / 33% / 25% of market value            (F2 -> G2)
 *   compounding  = PRODUCT(1 - reduction/100)                 (F12)
 *   craft cost   = CEILING(value x base x compounding, 1)     (I4)
 *   final sale   = zero profit ? cost : MAX(value x (1 - discount), cost)
 *   days         = CEILING(value / speed per day, 1)
 *
 * Those rules live here; the model owns the live values and the posts.
 * ------------------------------------------------------------------ */

/** Base-cost presets offered by the sheet's own dropdown. */
export const CRAFT_BASE_COSTS = [
  { label: 'Standard (half market)', percent: 50 },
  { label: 'Third cost', percent: 33 },
  { label: 'Quarter cost', percent: 25 },
];

/** Progress per day before any increases -- the constant in the sheet's C2. */
export const CRAFT_BASE_SPEED = 1000;

/** Each toggled crafting bonus on Bryva's sheet is worth x2 (COUNTIF x 2). */
export const CRAFT_SPEED_MULTIPLIER = 2;

/** A bypassed crafting requirement raises the DC by 5 (the standard rule). */
export const CRAFT_DC_PER_BYPASS = 5;

export const CRAFT_SPEED_KINDS = [['flat', '+ / day'], ['multiplier', 'x speed']];
export const CRAFT_CHECK_MODES = [['take10', 'Take 10'], ['take20', 'Take 20'], ['manual', 'Rolled']];

/**
 * What the daily progress is measured against.
 *
 * Crafting time runs off the item's **base price** -- the sheet divided by
 * ItemValue, and Pathfinder measures progress in gp of the item's price, not
 * of what the crafter paid. The crafting-cost basis is offered for tables that
 * house-rule it the other way.
 */
export const CRAFT_TIME_BASES = [['value', 'Base price'], ['cost', 'Crafting cost']];

/**
 * Base cost as a fraction of market value.
 *
 * The sheet's G2 maps its three dropdown entries to exact fractions -- 33%
 * means a true third, not 0.33 -- so a 200,000 item costs 66,667 and not
 * 66,000. Anything else is taken at face value.
 */
export function craftingFraction(percent) {
  const p = Number(percent) || 0;
  if (p === 50) return 1 / 2;
  if (p === 33) return 1 / 3;
  if (p === 25) return 1 / 4;
  return p / 100;
}

/**
 * Progress per day: flat increases add to the base, multipliers stack
 * additively (the sheet's MAX(1, COUNTIF x 2)), never dropping below x1
 * unless the player deliberately enters a fractional multiplier.
 *
 * Rows carry `valueNum`, the resolved number the model wrote for a field a
 * player may have typed as a formula.
 */
export function craftingSpeed(base, increases = []) {
  const on = increases.filter((s) => s.enabled !== false);
  const amount = (s) => Number(s.valueNum ?? s.value) || 0;
  const flat = on.filter((s) => s.kind !== 'multiplier').reduce((t, s) => t + amount(s), 0);
  const mult = on.filter((s) => s.kind === 'multiplier').reduce((t, s) => t + amount(s), 0);
  return Math.max(0, ((Number(base) || 0) + flat) * (mult > 0 ? mult : 1));
}

/* ----- dice arithmetic for weapon damage tokens ----- */

/* ------------------------------------------------------------------ *
 * Merged cells in a player-written table.
 *
 * A template's tables stay a plain rectangular grid -- one value per cell,
 * nothing about layout stored beside it -- so a merge is written *in* the cell
 * that disappears: `-----` says "I belong to the cell on my left" and `|||||`
 * says "I belong to the cell above me". The spans are worked out from that
 * every time the table is drawn, which means a merge survives adding a row,
 * deleting a column and an export/import without any bookkeeping to go stale.
 *
 * Three or more of the character, so the single "-" the sheets use for "none"
 * (Bryva's spell-school table is full of them) is ordinary content.
 * ------------------------------------------------------------------ */

export const MERGE_LEFT = /^-{3,}$/;
export const MERGE_UP = /^\|{3,}$/;

/**
 * Which cells of a grid are drawn, and how far each one reaches.
 *
 * Returns a same-shaped grid of `{colspan, rowspan}` for the cells that are
 * drawn and `null` for the ones absorbed into a neighbour.
 *
 * A block only grows while it stays rectangular: the row below is taken only
 * if its cell in the block's own column points up and every other cell of it
 * points somewhere inside the block. So an L-shaped run of markers merges as
 * far as it can and leaves the rest showing -- a stray marker renders as the
 * text it is, which is the clearest way to say it did not attach to anything.
 */
export function mergeLayout(grid) {
  const height = grid.length;
  const width = Math.max(0, ...grid.map((r) => r.length));
  const text = (r, c) => {
    const v = grid[r]?.[c];
    return v === null || v === undefined ? '' : String(v).trim();
  };
  // A marker in the first column has nothing to its left, and one in the first
  // row has nothing above: those are cells holding dashes, not merges.
  const left = (r, c) => c > 0 && MERGE_LEFT.test(text(r, c));
  const up = (r, c) => r > 0 && MERGE_UP.test(text(r, c));

  const spans = Array.from({ length: height }, () => new Array(width).fill(null));
  const taken = Array.from({ length: height }, () => new Array(width).fill(false));

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (taken[r][c]) continue;
      let colspan = 1;
      while (c + colspan < width && !taken[r][c + colspan] && left(r, c + colspan)) colspan += 1;

      const absorbs = (rr) => {
        if (!up(rr, c)) return false;
        for (let i = 0; i < colspan; i += 1) {
          if (taken[rr][c + i]) return false;
          if (i > 0 && !up(rr, c + i) && !left(rr, c + i)) return false;
        }
        return true;
      };
      let rowspan = 1;
      while (r + rowspan < height && absorbs(r + rowspan)) rowspan += 1;

      for (let rr = r; rr < r + rowspan; rr += 1) {
        for (let cc = c; cc < c + colspan; cc += 1) taken[rr][cc] = true;
      }
      spans[r][c] = { colspan, rowspan };
    }
  }
  return spans;
}

/**
 * Parse a damage-ish expression into dice terms plus a flat part.
 *
 * "2d6 + con.mod" → dice {6:2}, flat = con.mod evaluated by `evaluate`.
 * Parenthesised fragments are kept aside as notes ("4d6 (8d6)" keeps "(8d6)").
 */
export function parseDiceExpr(text, evaluate) {
  const notes = [];
  let s = String(text ?? '').replace(/\([^)]*\)/g, (m) => { notes.push(m.trim()); return ' '; });
  const dice = {};
  s = s.replace(/([+-]?)\s*(\d+)\s*d\s*(\d+)/gi, (m, sign, n, d) => {
    const k = Number(d);
    dice[k] = (dice[k] || 0) + (sign === '-' ? -1 : 1) * Number(n);
    return ' ';
  });
  // Whatever remains is a plain number or a sandbox formula.
  const rem = s.replace(/\+\s*(?=\+|$)/g, '').replace(/^\s*[+]\s*/, '').trim()
    .replace(/[+\s]+$/, '');
  let flat = 0;
  let error = null;
  if (rem) {
    try {
      flat = Math.floor(Number(evaluate ? evaluate(rem) : Number(rem)) || 0);
    } catch (err) {
      error = err.message;
    }
  }
  return { dice, flat, notes, error };
}

/** Merge dice maps ({dieSize: count}). */
export function addDice(a, b) {
  const out = { ...a };
  for (const [d, n] of Object.entries(b || {})) {
    out[d] = (out[d] || 0) + n;
    if (!out[d]) delete out[d];
  }
  return out;
}

/** "12d8+2d6" from a dice map, largest die first. */
export function diceString(dice, flat = 0) {
  const parts = Object.entries(dice || {})
    .filter(([, n]) => n)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([d, n]) => `${n < 0 ? '-' : ''}${Math.abs(n)}d${d}`);
  let out = parts.join('+').replace(/\+-/g, '-');
  if (flat) out += out ? fmt(flat) : String(flat);
  return out || (flat ? String(flat) : '0');
}

/** Expected value: each XdY averages X × (Y+1)/2. */
export function diceAverage(dice, flat = 0) {
  const avg = Object.entries(dice || {})
    .reduce((t, [d, n]) => t + n * ((Number(d) + 1) / 2), 0) + (Number(flat) || 0);
  return Math.round(avg * 10) / 10;
}

/** Active armor + shields, reduced to the numbers the sheet needs. */
export function armorParts(c) {
  const pieces = [];
  const armor = c.equipment?.armor;
  if (armor?.active) pieces.push(armor);
  for (const s of c.equipment?.shields || []) if (s.active) pieces.push(s);
  const maxDexes = pieces.map((p) => p.maxDex).filter((v) => v !== null && v !== undefined && v !== '');
  return {
    ac: pieces.reduce((t, p) => t + (Number(p.acBonus) || 0), 0),
    maxDex: maxDexes.length ? Math.min(...maxDexes.map(Number)) : Infinity,
    acp: pieces.reduce((t, p) => t + (Number(p.acp) || 0), 0),
  };
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

/**
 * The conditions, with the part of each that is arithmetic.
 *
 * Almost every condition is on or off; only negative levels are counted, so
 * `kind: 'count'` marks the one that is. `mods` are flat penalties to the
 * things the Overview shows, `ability` is a penalty to a score and
 * `abilitySet` a score reduced *to* a value (paralysis takes Dex to 0, which
 * is a −5 modifier and not a −4 penalty). `losesDex` drops the ability bonus
 * to AC and CMD, `speed` multiplies every movement rate, and `notes` carry
 * what no number can say.
 *
 * `group` and `rank` are the two ladders: fear escalates shaken → frightened →
 * panicked and tiredness fatigued → exhausted, and within a ladder the worse
 * condition replaces the lesser rather than stacking with it.
 */
export const CONDITIONS = [
  {
    key: 'blinded',
    label: 'Blinded',
    aliases: ['blind'],
    rule: 'Cannot see: −2 AC, loses its Dexterity bonus to AC, moves at half speed, and takes −4 on Strength- and Dexterity-based skill checks and opposed Perception checks.',
    mods: { ac: -2 },
    losesDex: true,
    speed: 0.5,
    notes: ['50% miss chance against anything it cannot see', 'cannot run or charge'],
  },
  {
    key: 'cowering',
    label: 'Cowering',
    aliases: ['cower'],
    rule: 'Frozen with fear: −2 AC and loses its Dexterity bonus to AC.',
    mods: { ac: -2 },
    losesDex: true,
    notes: ['takes no actions'],
  },
  {
    key: 'dazzled',
    label: 'Dazzled',
    rule: 'Overwhelmed by light: −1 on attack rolls and sight-based Perception checks.',
    mods: { attack: -1 },
  },
  {
    key: 'deafened',
    label: 'Deafened',
    aliases: ['deaf'],
    rule: 'Cannot hear: −4 on initiative, automatic failure on Perception checks based on sound.',
    mods: { initiative: -4 },
    notes: ['20% spell failure on spells with verbal components'],
  },
  {
    key: 'energyDrain',
    label: 'Energy Drain',
    aliases: ['energy drain', 'negative levels'],
    kind: 'count',
    rule: 'Each negative level is −1 on attack rolls, saving throws, skill checks, ability checks and combat maneuver checks, and −5 hit points.',
    mods: {
      attack: -1, saves: -1, skills: -1, abilityChecks: -1, hp: -5,
    },
    notes: ['−1 effective level for every level-dependent effect',
      'a spellcaster loses one spell or slot from their highest available level'],
  },
  {
    key: 'entangled',
    label: 'Entangled',
    rule: 'Ensnared: −2 on attack rolls, −4 Dexterity, and movement at half speed.',
    mods: { attack: -2 },
    ability: { dex: -4 },
    speed: 0.5,
    notes: ['cannot run or charge'],
  },
  {
    key: 'fatigued',
    label: 'Fatigued',
    aliases: ['fatigue'],
    group: 'fatigue',
    rank: 1,
    rule: 'Worn out: −2 Strength and −2 Dexterity, and no running or charging.',
    ability: { str: -2, dex: -2 },
    notes: ['cannot run or charge', 'further fatigue makes it exhausted'],
  },
  {
    key: 'exhausted',
    label: 'Exhausted',
    group: 'fatigue',
    rank: 2,
    rule: 'Spent: −6 Strength, −6 Dexterity, and movement at half speed.',
    ability: { str: -6, dex: -6 },
    speed: 0.5,
    notes: ['cannot run or charge', 'an hour of rest brings it back to fatigued'],
  },
  {
    key: 'shaken',
    label: 'Shaken',
    group: 'fear',
    rank: 1,
    rule: 'Afraid: −2 on attack rolls, saving throws, skill checks and ability checks.',
    mods: {
      attack: -2, saves: -2, skills: -2, abilityChecks: -2,
    },
  },
  {
    key: 'frightened',
    label: 'Frightened',
    group: 'fear',
    rank: 2,
    rule: 'Fleeing: −2 on attack rolls, saving throws, skill checks and ability checks, and it must flee the source.',
    mods: {
      attack: -2, saves: -2, skills: -2, abilityChecks: -2,
    },
    notes: ['must flee from the source of its fear while it can'],
  },
  {
    key: 'panicked',
    label: 'Panicked',
    group: 'fear',
    rank: 3,
    rule: 'Routed: −2 on saving throws, skill checks and ability checks; it drops what it holds and runs.',
    mods: { saves: -2, skills: -2, abilityChecks: -2 },
    notes: ['drops everything held and flees at top speed', 'cowers if it is cornered'],
  },
  {
    key: 'grappled',
    label: 'Grappled',
    aliases: ['grapple'],
    rule: 'Held: −4 Dexterity, −2 on attack rolls and combat maneuvers, and it cannot move.',
    mods: { attack: -2 },
    ability: { dex: -4 },
    speed: 0,
    notes: ['the −2 does not apply to grapple or escape attempts',
      'no actions needing two hands, and casting needs a concentration check'],
  },
  {
    key: 'pinned',
    label: 'Pinned',
    rule: 'Bound tightly: an additional −4 AC, flat-footed, and unable to move.',
    mods: { ac: -4 },
    losesDex: true,
    speed: 0,
    notes: ['only verbal, mental and purely defensive actions'],
  },
  {
    key: 'helpless',
    label: 'Helpless',
    group: 'helpless',
    rank: 1,
    rule: 'Paralysed, bound, sleeping or unconscious: Dexterity counts as 0, and melee attacks against it gain +4.',
    abilitySet: { dex: 0 },
    acVsMelee: -4,
    notes: ['can be coup de graced'],
  },
  {
    key: 'paralyzed',
    label: 'Paralyzed',
    aliases: ['paralysed'],
    group: 'helpless',
    rank: 3,
    rule: 'Frozen in place: Strength and Dexterity count as 0, and it is helpless.',
    abilitySet: { str: 0, dex: 0 },
    acVsMelee: -4,
    speed: 0,
    notes: ['helpless — melee attacks against it gain +4 and it can be coup de graced',
      'purely mental actions only'],
  },
  {
    key: 'prone',
    label: 'Prone',
    rule: 'On the ground: −4 on melee attack rolls, −4 AC against melee and +4 AC against ranged.',
    mods: { melee: -4 },
    acVsMelee: -4,
    acVsRanged: 4,
    notes: ['no ranged weapons but the crossbow', 'standing up provokes'],
  },
  {
    key: 'sickened',
    label: 'Sickened',
    rule: 'Ill: −2 on attack rolls, weapon damage rolls, saving throws, skill checks and ability checks.',
    mods: {
      attack: -2, damage: -2, saves: -2, skills: -2, abilityChecks: -2,
    },
  },
  {
    key: 'stunned',
    label: 'Stunned',
    rule: 'Reeling: −2 AC and it loses its Dexterity bonus to AC.',
    mods: { ac: -2 },
    losesDex: true,
    notes: ['drops everything held and takes no actions'],
  },
  {
    key: 'flatFooted',
    label: 'Flat-footed',
    rule: 'Caught unaware: loses its Dexterity bonus to AC and CMD, and cannot make attacks of opportunity.',
    losesDex: true,
  },
  {
    key: 'staggered',
    label: 'Staggered',
    rule: 'Barely functioning: a single move or standard action each round, not both.',
    notes: ['may still take free, swift and immediate actions'],
  },
  {
    key: 'nauseated',
    label: 'Nauseated',
    rule: 'Retching: a single move action each round and nothing else.',
    notes: ['no attacks, no spells, no concentration'],
  },
  {
    key: 'dazed',
    label: 'Dazed',
    rule: 'Stupefied: takes no actions, but suffers no penalty to AC.',
  },
  {
    key: 'confused',
    label: 'Confused',
    rule: 'Unable to tell friend from foe: acts randomly each round.',
    notes: ['attacks whoever damaged it most recently, whatever the roll says'],
  },
  {
    key: 'unconscious',
    label: 'Unconscious',
    group: 'helpless',
    rank: 2,
    rule: 'Knocked out and helpless: Dexterity counts as 0 and melee attacks against it gain +4.',
    abilitySet: { dex: 0 },
    acVsMelee: -4,
    speed: 0,
    notes: ['helpless — it can be coup de graced'],
  },
];

/** The conditions the sheets themselves carry; the rest are there to be added. */
export const SHEET_CONDITIONS = ['blinded', 'cowering', 'dazzled', 'deafened',
  'energyDrain', 'entangled', 'exhausted', 'fatigued', 'frightened', 'grappled',
  'helpless', 'panicked', 'paralyzed', 'pinned', 'prone', 'shaken', 'sickened',
  'stunned'];

const CONDITION_INDEX = new Map();
for (const cond of CONDITIONS) {
  for (const name of [cond.key, cond.label, ...(cond.aliases || [])]) {
    CONDITION_INDEX.set(String(name).toLowerCase().replace(/[^a-z0-9]/g, ''), cond);
  }
}

/**
 * The catalogue entry for a name the character stores.
 *
 * The workbooks label these themselves ("Fatigue", "Energy Drain", "Grapple"),
 * and those labels are what the export and the sheet's own named ranges use, so
 * the stored key is left alone and matched loosely instead.
 */
export function conditionInfo(name) {
  return CONDITION_INDEX.get(String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')) || null;
}

/** How many of a condition are on: negative levels count, the rest are flags. */
export function conditionCount(info, value) {
  if (info?.kind === 'count') return Math.max(0, Math.round(Number(value) || 0));
  return value === true || Number(value) > 0 ? 1 : 0;
}

/**
 * Everything a set of active conditions does, added up.
 *
 * `active` is `[{ info, count }]`. Penalties from different conditions stack,
 * which is the general rule; the two ladders do not, so only the worst member
 * of each group counts and the others are returned as `superseded` for the UI
 * to grey out. Speed takes the harshest multiplier rather than a product --
 * entangled and exhausted together is half speed, not a quarter.
 */
export function conditionTotals(active) {
  const worst = new Map();
  for (const { info } of active) {
    if (!info?.group) continue;
    const held = worst.get(info.group);
    if (!held || (info.rank || 0) > (held.rank || 0)) worst.set(info.group, info);
  }

  const counted = [];
  const superseded = [];
  for (const entry of active) {
    const beaten = entry.info?.group && worst.get(entry.info.group) !== entry.info;
    (beaten ? superseded : counted).push(entry);
  }

  const mods = {
    attack: 0, melee: 0, ranged: 0, damage: 0, ac: 0, saves: 0,
    skills: 0, abilityChecks: 0, initiative: 0, hp: 0,
  };
  const ability = {};
  const abilitySet = {};
  let losesDex = false;
  let speed = 1;
  let acVsMelee = 0;
  let acVsRanged = 0;

  for (const { info, count } of counted) {
    const n = Math.max(1, count);
    for (const [key, value] of Object.entries(info.mods || {})) {
      mods[key] = (mods[key] || 0) + value * n;
    }
    for (const [key, value] of Object.entries(info.ability || {})) {
      ability[key] = (ability[key] || 0) + value * n;
    }
    for (const [key, value] of Object.entries(info.abilitySet || {})) {
      abilitySet[key] = Math.min(abilitySet[key] ?? Infinity, value);
    }
    if (info.losesDex) losesDex = true;
    if (info.speed !== undefined) speed = Math.min(speed, info.speed);
    acVsMelee += (info.acVsMelee || 0) * n;
    acVsRanged += (info.acVsRanged || 0) * n;
  }

  return {
    mods, ability, abilitySet, losesDex, speed, acVsMelee, acVsRanged, counted, superseded,
  };
}

/**
 * Derived stats, declared as data.
 *
 * Each entry names the inputs it depends on and how to compute it. `reconcile`
 * marks stats whose full derivation lived in Google-only formulas we cannot
 * see: for those the importer stores an `offset` capturing everything the
 * sheet added (gear, ABP, traits), so the imported value matches the source
 * sheet exactly while still responding correctly to edits.
 */
export const DERIVED = [
  {
    key: 'initiative',
    label: 'Initiative',
    deps: ['dex.mod'],
    reconcile: true,
    compute: (c) => c.abilities.dex.totalMod,
  },
  {
    key: 'saves.fortitude.total',
    label: 'Fortitude',
    deps: ['con.mod', 'saves.fortitude.base'],
    reconcile: true,
    compute: (c) => c.saves.fortitude.base + statMod(c, c.saves.fortitude.stat1, c.saves.fortitude.stat2)
      + bonusTotal(c.saves.fortitude.bonusesResolved, SAVE_BONUS_TYPES),
  },
  {
    key: 'saves.reflex.total',
    label: 'Reflex',
    deps: ['dex.mod', 'saves.reflex.base'],
    reconcile: true,
    compute: (c) => c.saves.reflex.base + statMod(c, c.saves.reflex.stat1, c.saves.reflex.stat2)
      + bonusTotal(c.saves.reflex.bonusesResolved, SAVE_BONUS_TYPES),
  },
  {
    key: 'saves.will.total',
    label: 'Will',
    deps: ['wis.mod', 'saves.will.base'],
    reconcile: true,
    compute: (c) => c.saves.will.base + statMod(c, c.saves.will.stat1, c.saves.will.stat2)
      + bonusTotal(c.saves.will.bonusesResolved, SAVE_BONUS_TYPES),
  },
  {
    key: 'defenses.ac',
    label: 'AC',
    deps: ['dex.mod', 'equipment.armor'],
    reconcile: true,
    compute: (c) => {
      const a = armorParts(c);
      return 10 + Math.min(a.maxDex, statMod(c, c.defenses.acStat1, c.defenses.acStat2))
        + sizeMod(c) + c.defenses.miscAC + a.ac
        + bonusTotal(c.defenses.acBonusesResolved, AC_BONUS_TYPES);
    },
  },
  {
    key: 'defenses.touch',
    label: 'Touch AC',
    deps: ['dex.mod'],
    reconcile: true,
    compute: (c) => {
      const a = armorParts(c);
      return 10 + Math.min(a.maxDex, statMod(c, c.defenses.acStat1, c.defenses.acStat2))
        + sizeMod(c)
        + bonusTotal(c.defenses.acBonusesResolved, AC_BONUS_TYPES, 'touch');
    },
  },
  {
    key: 'defenses.flatFooted',
    label: 'Flat-Footed AC',
    deps: ['equipment.armor'],
    reconcile: true,
    compute: (c) => {
      const a = armorParts(c);
      return 10 + sizeMod(c) + c.defenses.miscAC + a.ac
        + bonusTotal(c.defenses.acBonusesResolved, AC_BONUS_TYPES, 'flatFooted')
        + (c.defenses.uncannyDodge
          ? Math.min(a.maxDex, statMod(c, c.defenses.acStat1, c.defenses.acStat2)) : 0);
    },
  },
  {
    key: 'defenses.cmd',
    label: 'CMD',
    deps: ['str.mod', 'dex.mod', 'attack.bab'],
    reconcile: true,
    compute: (c) => 10 + c.attack.bab + c.abilities.str.totalMod + c.abilities.dex.totalMod
      - sizeMod(c) + c.defenses.miscCMD,
  },
  {
    key: 'attack.totalMelee',
    label: 'Melee Attack',
    deps: ['attack.bab', 'str.mod'],
    reconcile: true,
    compute: (c) => c.attack.bab + modeMod(c, 'melee') - sizeMod(c) + c.attack.miscBonus,
  },
  {
    key: 'attack.totalRanged',
    label: 'Ranged Attack',
    deps: ['attack.bab', 'dex.mod'],
    reconcile: true,
    compute: (c) => c.attack.bab + modeMod(c, 'ranged') - sizeMod(c) + c.attack.miscBonus,
  },
  {
    key: 'attack.totalCmb',
    label: 'CMB',
    deps: ['attack.bab', 'str.mod'],
    reconcile: true,
    compute: (c) => c.attack.bab + modeMod(c, 'cmb') - sizeMod(c) + c.attack.miscBonus,
  },
];

/* -------------------------------------------------------------- *
 * Forwarded bonuses
 *
 * A `{saves.will += 2}` written in a class feature has to land somewhere, and
 * "somewhere" is not the same as "any name a formula can read". Reading is
 * free -- every total on the sheet publishes itself -- but writing needs a
 * place to put the number that does not disturb what is already there, and
 * only some totals have one.
 *
 * These do: each is a DERIVED stat, computed from its parts every recompute,
 * so a forwarded amount goes on beside the reconciliation offset and neither
 * one is mistaken for the other. Skills have the same property and are added
 * per character (their names come from the character's own list); max hit
 * points are here too, added the way the mythic bonus is, and carry no
 * derived key because the sheet's HP total is typed rather than computed.
 *
 * Deliberately absent: ability scores. A permanent one is a build number with
 * its own columns on the Stats tab, and a temporary one is a buff -- neither
 * wants a bonus arriving from a sentence somewhere else on the sheet.
 * -------------------------------------------------------------- */

/** [name a formula writes to, what to call it, the DERIVED key it lands on]. */
export const FORWARD_STATS = [
  ['initiative', 'Initiative', 'initiative'],
  ['saves.fortitude', 'Fortitude', 'saves.fortitude.total'],
  ['saves.reflex', 'Reflex', 'saves.reflex.total'],
  ['saves.will', 'Will', 'saves.will.total'],
  ['ac.total', 'AC', 'defenses.ac'],
  ['ac.touch', 'Touch AC', 'defenses.touch'],
  ['ac.flatFooted', 'Flat-footed AC', 'defenses.flatFooted'],
  ['ac.cmd', 'CMD', 'defenses.cmd'],
  ['attack.melee', 'Melee attack', 'attack.totalMelee'],
  ['attack.ranged', 'Ranged attack', 'attack.totalRanged'],
  ['attack.cmb', 'CMB', 'attack.totalCmb'],
  ['hp.total', 'Max hit points', null],
];

/**
 * Destinations that stand for several at once, so "+2 to all saves" is one
 * token rather than three. `ac` is the three armour classes and not CMD --
 * CMD is a defence, but it is not an armour class and does not move with one.
 */
export const FORWARD_FAMILIES = {
  saves: ['saves.fortitude', 'saves.reflex', 'saves.will'],
  ac: ['ac.total', 'ac.touch', 'ac.flatFooted'],
  attack: ['attack.melee', 'attack.ranged', 'attack.cmb'],
};

/** DERIVED key -> the name a formula forwards to, for the recompute loop. */
export const FORWARD_BY_DERIVED = Object.fromEntries(
  FORWARD_STATS.filter(([, , key]) => key).map(([name, , key]) => [key, name]),
);

/* -------------------------------------------------------------- */

function abilityKey(name) {
  return String(name || '').trim().toLowerCase().slice(0, 3);
}

/** Modifier for a stat slot, adding a second stat only when it differs. */
export function statMod(c, stat1, stat2) {
  const one = abilityKey(stat1);
  const two = abilityKey(stat2);
  let total = ABILITIES.includes(one) ? c.abilities[one].totalMod : 0;
  if (two && two !== one && ABILITIES.includes(two)) total += c.abilities[two].totalMod;
  return total;
}

/**
 * The same slot arithmetic as `statMod`, over a map of modifier changes.
 *
 * Conditions move ability modifiers, and what that does to a save or an attack
 * depends on which slots it is keyed to -- so the change has to be summed the
 * way the slot itself is, second stat and all.
 */
export function statModDelta(deltas, stat1, stat2) {
  const one = abilityKey(stat1);
  const two = abilityKey(stat2);
  let total = ABILITIES.includes(one) ? (deltas[one] || 0) : 0;
  if (two && two !== one && ABILITIES.includes(two)) total += deltas[two] || 0;
  return total;
}

/**
 * Score for a stat slot: the better of the two rather than their sum.
 *
 * The modifiers add because two casting stats each grant their own bonus slots,
 * but a threshold like "10 + spell level to cast at all" is a question about
 * one score, so the sheet took the higher. Zero when neither names an ability.
 */
export function statScore(c, stat1, stat2) {
  const scores = [stat1, stat2]
    .map(abilityKey)
    .filter((k) => ABILITIES.includes(k))
    .map((k) => Number(c.abilities[k].tempScore) || 0);
  return scores.length ? Math.max(...scores) : 0;
}

export function sizeMod(c) {
  return SIZE_MODIFIERS[c.identity.size] ?? 0;
}

function modeMod(c, mode) {
  const m = c.attack.modes[mode];
  return m ? statMod(c, m.stat1, m.stat2) : 0;
}

/** The six attack slots the sheet keeps, and what to call each one. */
export const ATTACK_MODES = ['melee', 'altMelee', 'ranged', 'altRanged', 'cmb', 'altCmb'];
export const ATTACK_MODE_LABELS = {
  melee: 'Melee', altMelee: 'Alt melee', ranged: 'Ranged',
  altRanged: 'Alt ranged', cmb: 'CMB', altCmb: 'Alt CMB',
};

const MODE_TOTAL_KEYS = { melee: 'totalMelee', ranged: 'totalRanged', cmb: 'totalCmb' };
/** Which stored total an alternate is the alternate of. */
export const ALT_ATTACK_OF = { altMelee: 'melee', altRanged: 'ranged', altCmb: 'cmb' };

/**
 * The total for any attack mode, alternates included.
 *
 * The three the sheet stores are read straight off it, because those carry the
 * reconciliation offset that makes the imported figure come out right. An
 * alternate is the same attack with a different ability in the slot -- same
 * BAB, same misc, same size, same offset -- so it is that total with one
 * modifier swapped for the other rather than a second sum that could drift
 * from it. Null for anything that is not a mode.
 */
export function attackModeTotal(c, mode) {
  const direct = MODE_TOTAL_KEYS[mode];
  if (direct) return Number(c?.attack?.[direct]) || 0;
  const base = ALT_ATTACK_OF[mode];
  if (!base || !c?.attack) return null;
  const modes = c.attack.modes || {};
  return (Number(c.attack[MODE_TOTAL_KEYS[base]]) || 0)
    - statMod(c, modes[base]?.stat1, modes[base]?.stat2)
    + statMod(c, modes[mode]?.stat1, modes[mode]?.stat2);
}
