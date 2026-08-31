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

/**
 * Only the last column is a fresh choice each time.
 *
 * The array is four columns, and three of them are one decision made at 8th
 * and raised again later: the first column is raised at 12 and again at 16,
 * the second at 12, the third at 16. The fourth is chosen anew all three
 * times. Every later gain is still its own +2 -- it just cannot be pointed at
 * a different ability than the one that column started on.
 *
 * The same shape as `ABP_LINKED_LEVELS` and read the same way: keyed by the
 * column, then by the follower level, valued by the level it copies. All five
 * source sheets store exactly this -- the same ability repeated down a column
 * -- so this is the rule the data was already following, written down.
 */
export const ARRAY_LINKED_LEVELS = {
  0: { 12: 8, 16: 8 },
  1: { 12: 8 },
  2: { 16: 8 },
};

/** The level an array column is actually chosen at. */
export function arraySourceLevel(slot, level) {
  return ARRAY_LINKED_LEVELS[slot]?.[level] ?? level;
}

/** Levels that copy `level`'s choice in this column. */
export function arrayFollowers(slot, level) {
  return Object.entries(ARRAY_LINKED_LEVELS[slot] || {})
    .filter(([, src]) => src === level)
    .map(([follower]) => Number(follower));
}

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

/**
 * The sub-systems a class can be marked with on the Classes table, and the
 * tabs each one lights up. Marking a class says "this character plays with
 * that machinery" before any of its data is typed in: the ⚙ manager badges
 * the tabs and the session view puts them on its bar.
 */
export const GAME_SYSTEMS = [
  { id: 'spheres-of-power', label: 'Spheres of Power', tabs: ['magic'] },
  { id: 'spheres-of-might', label: 'Spheres of Might', tabs: ['martial'] },
  { id: 'champion-of-the-spheres', label: 'Champion of the Spheres', tabs: ['martial', 'magic'] },
  { id: 'spheres-of-guile', label: 'Spheres of Guile', tabs: ['guile'] },
  { id: 'vancian', label: 'Vancian magic', tabs: ['vancian'] },
  { id: 'path-of-war', label: 'Path of War', tabs: ['maneuvers'] },
  { id: 'psionics', label: 'Psionics', tabs: ['psionics'] },
  { id: 'akashic', label: 'Akashic', tabs: ['akashic'] },
  { id: 'cardcasting', label: 'Cardcasting', tabs: ['cardcasting'] },
  { id: 'animal-companion', label: 'Animal companion', tabs: ['animalCompanion'] },
  { id: 'familiar', label: 'Familiar', tabs: ['familiar'] },
  { id: 'eidolon', label: 'Eidolon', tabs: ['eidolon'] },
  { id: 'conjured-companion', label: 'Conjured companion', tabs: ['conjured'] },
  { id: 'techniques', label: 'Techniques', tabs: ['techniques', 'autoTechnique'] },
  { id: 'cooking', label: 'Cooking', tabs: ['cooking'] },
  { id: 'crafting', label: 'Item crafting', tabs: ['crafting'] },
];

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

/* ------------------------------------------------------------------ *
 * Spheres of Guile -- the third side.
 *
 * The skill spheres read like the other two from a distance and are built
 * differently underneath. There is no practitioner level and no caster
 * level: every number a guile sphere produces -- its save DC, its ranges,
 * how far its talents scale -- is read off the operative's *ranks in that
 * sphere's associated skill*. So the sphere table on the guile tab is not a
 * second copy of Sphere CL / DC; it is the skill-rank block and the DC block
 * fused, because in this system they are the same fact seen twice.
 * ------------------------------------------------------------------ */

export const GUILE_SPHERES = ['Artifice', 'Bluster', 'Body Control', 'Communication',
  'Faction', 'Herbalism', 'Infiltration', 'Investigation', 'Navigation', 'Performance',
  'Spellhacking', 'Study', 'Subterfuge', 'Survivalism', 'Vocation', 'Occultism'];

const GUILE_SPHERE_SET = new Set(GUILE_SPHERES);

/** Whether a name is one of the skill spheres, however it was capitalised. */
export function isGuileSphere(sphere) {
  return GUILE_SPHERE_SET.has(String(sphere || '').trim());
}

/**
 * What each sphere associates itself with, in the rulebook's own words.
 *
 * Deliberately prose and not a list of skill rows. A sphere names a *family*
 * -- "Craft (baskets, blacksmithing, carpentry, …)", "a single Knowledge or
 * Lore skill" -- and which member of it a character took is a choice they
 * make once and write down. The sheet already keeps every skill the
 * character has, variants and all, so the pick is made from that list and
 * this string is what the row says it has to satisfy.
 *
 * A sphere divided into packages lists them: gaining the sphere grants one
 * package, and the package is what carries the associated skill. Vocation is
 * the odd one out and says so -- it has no base ability, no associated skill
 * and unlocks no leverage; its talents borrow whichever skill they name.
 */
export const GUILE_SPHERE_SKILLS = {
  Artifice: { packages: [
    ['Artwork', 'Artistry (choreography, literature, musical composition, or playwriting) '
      + 'or Craft (books, calligraphy, carpentry, cloth, clothing, glass, jewelry, musical '
      + 'instruments, paintings, pottery, sculptures, stonemasonry, tattoos, or taxidermy)'],
    ['Fabrication', 'Craft (baskets, blacksmithing, carpentry, clockwork, cloth, clothing, '
      + 'glass, leather, locks, mechanical, shoes, or stonemasonry)'],
    ['Gear', 'Craft (alchemy, armor, blacksmithing, bows, clothing, firearms, leather, '
      + 'shoes, traps, or weapons)'],
  ] },
  Bluster: { skill: 'Bluff or Intimidate' },
  'Body Control': { skill: 'Escape Artist' },
  Communication: { skill: 'Diplomacy or Linguistics' },
  Faction: { packages: [
    ['Retainer', 'Knowledge (local), or one other Knowledge or Profession skill that could '
      + 'recall knowledge about members of your faction'],
    ['Supply', 'Appraise'],
  ] },
  Herbalism: { packages: [
    ['Herbal', 'Profession (herbalist)'],
    ['Remedy', 'Heal'],
  ] },
  // Disable Device by default; Skilled Sneak adds Stealth, and the sphere's
  // alternate-start drawback swaps the two round. Both are talents the player
  // writes down, so the pick below is the last word either way.
  Infiltration: { skill: 'Disable Device (Stealth, with Skilled Sneak or an alternate start)' },
  Investigation: { skill: 'Sense Motive' },
  Navigation: { packages: [
    ['Aerial', 'Fly or Profession (pilot)'],
    ['Nautical', 'Profession (sailor) or Swim'],
    ['Urban', 'Acrobatics or Climb'],
    ['Wilderness', 'Climb, Profession (guide), Profession (driver), or Survival'],
  ] },
  Performance: { packages: [
    ['Act', 'Perform (act or comedy)'],
    ['Dance', 'Perform (dance)'],
    ['Instrumental', 'Perform (keyboard, percussion, string, or wind)'],
    ['Lyric', 'Perform (comedy, oratory, or sing)'],
  ] },
  Spellhacking: { skill: 'Use Magic Device' },
  Study: { skill: 'A single Knowledge or Lore skill' },
  Subterfuge: { skill: 'Disguise' },
  // Two packages, one skill between them: Dredge and Harvest both work off
  // Survival, so the package is a choice about what the sphere *does* rather
  // than about where its ranks land.
  Survivalism: { skill: 'Survival', packages: [['Dredge', 'Survival'], ['Harvest', 'Survival']] },
  Vocation: { skill: null },
  Occultism: { skill: 'Knowledge (arcana, nature, religion, or planes)' },
};

/** The packages a sphere is divided into, or [] for one that is not. */
export function guilePackages(sphere) {
  return (GUILE_SPHERE_SKILLS[String(sphere || '').trim()]?.packages || []).map(([name]) => name);
}

/**
 * What a sphere (or one of its packages) asks its associated skill to be.
 * The package's own words where it has them, the sphere's otherwise.
 */
export function guileSkillHint(sphere, pkg = '') {
  const def = GUILE_SPHERE_SKILLS[String(sphere || '').trim()];
  if (!def) return '';
  const named = (def.packages || []).find(([name]) => name === String(pkg || '').trim());
  return named ? named[1] : (def.skill || '');
}

/** Int, Wis or Cha: the one score an operative's talent DCs are read off. */
export const OPERATIVE_ABILITIES = ['Int', 'Wis', 'Cha'];

/**
 * Skill expertise: how fast an operative gains talents, by tier.
 *
 * Two columns rather than one, which is the shape that makes guile guile. A
 * tier grants unrestricted talents ("Any") *and* [utility] talents on a
 * second, faster ladder, and the two are gained in addition to each other --
 * a 1st-level Trained operative has no free pick at all and one utility
 * talent. The three rates already sit in TALENT_RATES because the Any column
 * is exactly 3/4, 1/2 and 1/4 of a talent per level; the utility ladders do
 * not fit that table, so both columns are stated here as the book prints
 * them.
 */
export const EXPERTISE_TIERS = ['Virtuoso', 'Journeyman', 'Trained'];

const EXPERTISE_LADDERS = {
  Virtuoso: { any: (l) => Math.ceil(l * 3 / 4), utility: (l) => Math.floor(l / 2) },
  Journeyman: { any: (l) => Math.floor(l / 2), utility: (l) => Math.ceil(l / 2) },
  Trained: { any: (l) => Math.floor(l / 4), utility: (l) => Math.ceil(l / 2) },
};

/** Talents an expertise tier has granted by `level`, as {any, utility}. */
export function expertiseTalents(tier, level) {
  const ladder = EXPERTISE_LADDERS[String(tier || '').trim()];
  const l = Math.max(0, Math.floor(Number(level) || 0));
  if (!ladder || !l) return { any: 0, utility: 0 };
  return { any: ladder.any(l), utility: ladder.utility(l) };
}

/**
 * The two trade ranks, and what each gets from a trade tradition. A
 * competent operative takes the automatic talents and the tradition's skill
 * sphere; an adroit one also takes the bonus talents listed for it.
 */
export const TRADE_RANKS = ['Competent', 'Adroit'];

/** Every trade tradition grants these outright, whichever one was chosen. */
export const TRADE_CLASS_SKILLS = ['Craft', 'Perception', 'Perform', 'Profession'];
/** And these two more, in a game playing with the background-skills variant. */
export const TRADE_BACKGROUND_SKILLS = ['Artistry', 'Lore'];

/** Uses of skill leverage: one, and another per three Hit Dice. */
export function leveragePool(hitDice) {
  return 1 + Math.floor(Math.max(0, Number(hitDice) || 0) / 3);
}

/**
 * Close, medium and long for a sphere ability, off ranks in the associated
 * skill rather than off a caster level -- 25 ft. + 5 ft. per 2 ranks,
 * 100 ft. + 10 ft. per rank, 400 ft. + 40 ft. per rank.
 */
export function guileRanges(ranks) {
  const r = Math.max(0, Math.floor(Number(ranks) || 0));
  return { close: 25 + 5 * Math.floor(r / 2), medium: 100 + 10 * r, long: 400 + 40 * r };
}

/**
 * Bonus skill ranks per sphere talent (the sheet's "Bonus Ranks (automatic)"
 * block): 5 ranks per talent in the associated sphere, capped at level.
 * `fullLevelRanks: true` rows are set to full level when the character's
 * Alternate Training technique says so (`fullLevelRanks` on the technique's
 * own pack entry -- Light Body's special case, matching the sheet's).
 *
 * Each row names what has to be on the character for it to pay out. A source
 * with no `talent` is the sphere itself -- "Fencing (Base)", satisfied by
 * having the sphere at all -- and one with a `talent` is a package or a named
 * talent inside that sphere, which has to be there by name. Two sources are an
 * either/or: Diplomacy comes from Leadership or from Warleader, Acrobatics from
 * the Leap package or the Run one.
 *
 * The check is three-valued, because a talent this sheet cannot see is not the
 * same as one the character does not have -- the Alternate Training techniques grant
 * sphere talents by the handful without ever naming which -- so a sphere whose
 * talents are all unnamed leaves the row to the player's own switch. See
 * `sphereSkillRequirement`.
 */
export const RANKS_PER_TALENT = 5;
export const SPHERE_SKILL_RANKS = [
  { key: 'Acrobatics', fullLevelRanks: true, match: { name: 'Acrobatics' },
    from: [{ sphere: 'Athletics', talent: 'Leap', kind: 'package' },
      { sphere: 'Athletics', talent: 'Run', kind: 'package' }] },
  { key: 'Climb', fullLevelRanks: true, match: { name: 'Climb' },
    from: [{ sphere: 'Athletics', talent: 'Climb', kind: 'package' }] },
  { key: 'Fly', fullLevelRanks: true, match: { name: 'Fly' },
    from: [{ sphere: 'Athletics', talent: 'Fly', kind: 'package' }] },
  { key: 'Swim', fullLevelRanks: true, match: { name: 'Swim' },
    from: [{ sphere: 'Athletics', talent: 'Swim', kind: 'package' }] },
  { key: 'Bluff', match: { name: 'Bluff' }, from: [{ sphere: 'Fencing' }] },
  { key: 'Craft (any)', match: { name: 'Craft', spec: null },
    from: [{ sphere: 'Equipment', talent: 'Craftsman', kind: 'talent' }] },
  { key: 'Craft (alchemy)', match: { name: 'Craft', spec: /alchem/i }, from: [{ sphere: 'Alchemy' }] },
  { key: 'Craft (mechanical)', match: { name: 'Craft', spec: /mechan/i }, from: [{ sphere: 'Tech' }] },
  { key: 'Craft (traps)', match: { name: 'Craft', spec: /trap/i }, from: [{ sphere: 'Trap' }] },
  { key: 'Diplomacy', match: { name: 'Diplomacy' },
    from: [{ sphere: 'Leadership' }, { sphere: 'Warleader' }] },
  { key: 'Handle Animal', match: { name: 'Handle Animal' },
    from: [{ sphere: 'Beastmastery', talent: 'Handle Animal', kind: 'package' }] },
  { key: 'Intimidate', match: { name: 'Intimidate' }, from: [{ sphere: 'Gladiator' }] },
  { key: 'Perception', match: { name: 'Perception' },
    from: [{ sphere: 'Scout', talent: 'Great Senses', kind: 'talent' }] },
  { key: 'Ride', match: { name: 'Ride' },
    from: [{ sphere: 'Beastmastery', talent: 'Ride', kind: 'package' }] },
  { key: 'Sense Motive', match: { name: 'Sense Motive' },
    from: [{ sphere: 'Fencing', talent: 'Read Foe', kind: 'talent' }] },
  { key: 'Sleight of Hand', match: { name: 'Sleight of Hand' }, from: [{ sphere: 'Scoundrel' }] },
  { key: 'Stealth', match: { name: 'Stealth' }, from: [{ sphere: 'Scout' }] },
];

/** One source, worded as the table words it: "Athletics (Leap package)". */
export function sphereSourceLabel({ sphere, talent, kind = 'talent' }) {
  return talent ? `${sphere} (${talent} ${kind})` : `${sphere} (Base)`;
}

/**
 * Every source of a row, as one phrase: "Leadership (Base) or Warleader
 * (Base)", and "Athletics (Leap or Run package)" where two of them are the
 * same sphere -- naming the sphere twice reads as two spheres.
 */
export function sphereSkillLabel(def) {
  const bySphere = new Map();
  for (const s of def.from || []) {
    if (!bySphere.has(s.sphere)) bySphere.set(s.sphere, []);
    bySphere.get(s.sphere).push(s);
  }
  return [...bySphere].map(([sphere, list]) => {
    if (list.some((s) => !s.talent)) return `${sphere} (Base)`;
    const kinds = new Set(list.map((s) => s.kind || 'talent'));
    if (kinds.size > 1) return list.map(sphereSourceLabel).join(' or ');
    return `${sphere} (${list.map((s) => s.talent).join(' or ')} ${[...kinds][0]})`;
  }).join(' or ');
}

/**
 * Is this talent the sphere itself rather than something inside it?
 *
 * Sheets write a base sphere as the sphere's own name and the word: "Brute
 * Sphere", "Guardian Sphere (Patrol)", and now and then a bare "(Base)" in the
 * style of the skill-rank table. No talent within a sphere is named that way,
 * which is what makes the reading safe.
 */
export function isBasePick(text) {
  const raw = String(text ?? '').trim();
  const named = raw.replace(/\([^)]*\)/g, ' ').trim();
  return /\bspheres?\b/i.test(named) || /^\(?base\)?$/i.test(raw);
}

/**
 * Does one talent name answer to another? Loosely, because names are typed by
 * hand and come with their choices attached: "Guardian Sphere (Challenge
 * package -4/+2)" carries "Challenge" the same as a bare "Challenge" does, and
 * so does the "(leap)" a technique offers.
 */
export function talentNamed(text, talent) {
  const escaped = String(talent).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(String(text ?? ''));
}

/**
 * Is a row's requirement met, and how surely?
 *
 * The character's side of it comes in four parts, per sphere:
 *
 *   has(s)      does the character have any talent in the sphere at all
 *   named(s)    the talents in it that are written down by name
 *   choices(s)  sets of names, one of each set certainly taken -- a choice the
 *               rules offer and the player has not written down yet is still a
 *               talent they have, and still one of those options
 *   unnamed(s)  how many talents in the sphere are none of the above
 *
 * and the answer is:
 *
 *   met      the sphere is there and so is the talent, either by name or
 *            because every option of an unmade choice is one this row takes
 *   unknown  the sphere is there and has talents this sheet cannot name, so it
 *            cannot say either way -- the player's switch decides
 *   unmet    the sphere is not there, or every talent in it is accounted for
 *            and the one asked for is not among them
 */
export function sphereSkillRequirement(def, {
  has, named, choices = () => [], unnamed = () => 0,
}) {
  const sources = (def.from || []).filter((s) => has(s.sphere));
  if (!sources.length) return 'unmet';
  // A "(Base)" row wants the sphere and nothing else.
  if (sources.some((s) => !s.talent)) return 'met';
  if (sources.some((s) => (named(s.sphere) || []).some((n) => talentNamed(n, s.talent)))) return 'met';

  // Light Body's first level is "the Athletics sphere, taking (leap) or (run)":
  // whichever the player took, a row that accepts both has it.
  for (const sphere of new Set(sources.map((s) => s.sphere))) {
    const wanted = sources.filter((s) => s.sphere === sphere).map((s) => s.talent);
    for (const options of choices(sphere) || []) {
      if (options.length && options.every((o) => wanted.some((t) => talentNamed(o, t)))) return 'met';
    }
  }

  return sources.some((s) => unnamed(s.sphere) > 0) ? 'unknown' : 'unmet';
}

/** The spheres a row draws its talent count from, however many sources name them. */
export function sphereSkillSpheres(def) {
  return [...new Set((def.from || []).map((s) => s.sphere))];
}

/** Background skills (Pathfinder Unchained), for the specialty picker. */
export const BACKGROUND_SKILLS = ['Appraise', 'Artistry', 'Craft', 'Handle Animal',
  'Kn. (engineering)', 'Kn. (geography)', 'Kn. (history)', 'Kn. (nobility)',
  'Linguistics', 'Lore', 'Perform', 'Profession', 'Sleight of Hand'];

/* ------------------------------------------------------------------ *
 * Alternate Training Techniques
 *
 * One choice, made at 1st level (or the moment its prerequisite is finally
 * met, if none was taken before), that then advances on its own ladder for
 * the rest of the character's career.
 *
 * The techniques themselves are a server's content, not the engine's: the
 * catalogue, the ladder shape and the cite links live in an extension pack
 * (provides.altTraining) and are registered through setAltTrainingTables in
 * model/subsystems/alt-training.js, where everything that reads them now
 * lives. This section was the five Primordia techniques, hard-coded; see the
 * alt-training-techniques pack for them.
 * ------------------------------------------------------------------ */

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

/**
 * Bonus hit points per tier by path.
 *
 * The first six are Mythic Adventures'; the rest are the campaign's own, read
 * off the workbook's `MythicPathLookup` table the same way `tierAtLevel` was
 * read off its Mythic tab. A path this table has no row for contributes
 * nothing until the player types a number into Bonus HP / tier.
 */
export const MYTHIC_PATH_HP = {
  Champion: 5, Guardian: 5, Marshal: 4, Trickster: 4, Archmage: 3, Hierophant: 3,
  Bound: 3, Genius: 3, Gifted: 4, 'Living Saint': 4, Mystic: 3, Overmind: 3,
  'Reluctant Hero': 4, Spheremaster: 4, Stranger: 4,
};

/**
 * The maximum hit points the class table comes to.
 *
 * The workbook worked this out on Character Info and the sheet only kept the
 * answer, which is why hit points were the one number on the page that never
 * moved when the classes under them did. The parts, in the workbook's own
 * order:
 *
 *   - `perLevel`: the hit die rolled at each character level. Gestalt takes
 *     the best among the classes present, which is what the Planner's
 *     "HP/ Level" column held, and this campaign takes it at maximum.
 *   - the favoured-class points, whole, not per level.
 *   - the hit-point ability's modifier at every level -- twice over on a
 *     sheet that names a second one.
 *   - Toughness, and any miscellany, per level and flat respectively.
 *   - the mythic path's bonus for each tier reached.
 *
 * Negative levels are deliberately not here: the Energy Drain condition
 * already takes five hit points off the maximum for each one, and a number
 * subtracted in both places is subtracted twice.
 */
export function hitPointBase({
  perLevel = [], level = 0, abilityMod = 0, fcb = 0, toughness = 0, misc = 0,
  mythicTier = 0, mythicHpPerTier = 0,
} = {}) {
  const levels = Math.max(0, Math.floor(Number(level) || 0));
  const dice = perLevel.slice(0, levels).reduce((n, hd) => n + (Number(hd) || 0), 0);
  return dice
    + (Number(fcb) || 0)
    + (Number(abilityMod) || 0) * levels
    + (Number(toughness) || 0) * levels
    + (Number(misc) || 0)
    + (Number(mythicTier) || 0) * (Number(mythicHpPerTier) || 0);
}

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
/*
 * `cmd: false` marks a column whose *bonus* does not reach Combat Maneuver
 * Defence. The rule names the ones that do, and it is a closed list:
 * "A creature can also add any circumstance, deflection, dodge, insight, luck,
 * morale, profane, and sacred bonuses to AC to its CMD." Armour, shields,
 * natural armour and enhancement are not on it, and neither is an untyped
 * bonus -- which is why the flag is on those columns rather than a filter
 * written out somewhere else.
 *
 * A *penalty* is a different sentence and reaches CMD whatever column it is
 * in: "Any penalties to a creature's AC also apply to its CMD." So the flag
 * only ever turns off the positive half; see cmdBonusTotal.
 */
export const AC_BONUS_TYPES = [
  ['abpDeflection', 'ABP Deflect'],
  ['deflection', 'Deflect.'],
  ['abpNatural', 'ABP Nat', { touch: false, cmd: false }],
  ['enhancedNatural', 'E. Nat', { touch: false, cmd: false }],
  ['natural', 'Natural', { touch: false, cmd: false }],
  ['enhancement', 'Enhan.', { touch: false, cmd: false }],
  ['dodge', 'Dodge', { flatFooted: false }],
  ['circumstance', 'Circ.'],
  ['insight', 'Insight'],
  ['luck', 'Luck'],
  ['morale', 'Morale'],
  ['sacred', 'Sacred'],
  ['profane', 'Profane'],
  ['untyped', 'Untyped', { cmd: false }],
  // Not the modifier for being Large -- that is already in the formula, the
  // other way round, as the special size modifier. This column is a
  // size-typed bonus, and no such type is on the list above.
  ['size', 'Size', { cmd: false }],
  ['template', 'Template', { cmd: false }],
  ['sheet', 'Sheet', { cmd: false }],
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

/**
 * What the AC bonus block contributes to Combat Maneuver Defence.
 *
 * Two rules, and the sheet was following neither: CMD takes the eight listed
 * bonus types (deflection, dodge, circumstance, insight, luck, morale, sacred,
 * profane -- and ABP's deflection, which is one of them), and it takes *every*
 * penalty, whatever column it was typed in, because "any penalties to a
 * creature's AC also apply to its CMD".
 *
 * So a column marked `cmd: false` still hands over its negative half. That is
 * the half that matters most in play: a −4 the sheet showed on AC and quietly
 * left off CMD is a maneuver that lands or does not.
 *
 * `miscAC` is added by the caller on the same terms -- it is armour-side, so
 * only a penalty in it carries -- because it is a field of its own rather
 * than a column of this block.
 */
export function cmdBonusTotal(resolved, types = AC_BONUS_TYPES) {
  let total = bonusTotal(resolved, types, 'cmd');
  for (const [key, , flags] of types) {
    if (flags?.cmd !== false) continue;
    total += Math.min(0, Number(resolved?.[key]) || 0);
  }
  return total;
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

/* ----- parallel talent tracks (the armiger's customized weapons) ----- */

/**
 * A class whose talents arrive on several tracks at once, with one of them
 * live: the armiger's customized weapons.
 *
 * Every other talent source on the sheet is a list that grows -- a ladder, a
 * tradition, the bonus talents -- and they add up. This does not. An armiger
 * customizes three weapons, each of which learns its own talents, and she
 * "may only benefit from the talents granted by one customized weapon at a
 * time". So it is `sets` lists that each grow, and a switch saying which one
 * is being read.
 *
 * Two counting rules describe it, which is how the class table says it in
 * prose and so how a pack writes it:
 *
 *   sets     how many tracks there are          3, another at 11th and 19th
 *   talents  how many talents each one holds    1, another at 3rd and every 4th
 *
 * Each is a starting count plus a level rule naming where the count goes up,
 * so the whole armiger reads `{ sets: {start: 3, gainsAt: '11, 19'},
 * talents: {start: 1, gainsAt: '3, +4'} }` and nothing about weapons is
 * written into the engine.
 */
export function normalizeTalentTracks(spec) {
  if (!spec || typeof spec !== 'object') return null;
  // A rule written as a bare string is its gainsAt; the start comes from the
  // shape being described, since a track nobody counts still has its first.
  const rule = (v, fallback) => {
    const src = typeof v === 'object' && v !== null ? v : { gainsAt: v };
    const start = Math.floor(Number(src.start));
    return {
      start: Number.isFinite(start) ? Math.max(0, start) : fallback,
      gainsAt: String(src.gainsAt ?? '').trim(),
    };
  };
  return {
    name: String(spec.name || '').trim() || 'Customized weapon',
    // What one track *is*, so the panel can call its rows something: a weapon,
    // a companion, a stance.
    unit: String(spec.unit || '').trim() || 'weapon',
    sets: rule(spec.sets, 1),
    talents: rule(spec.talents, 1),
    // Which sphere lists the track may learn from. Martial by default: a
    // customized weapon teaches its wielder to fight with it, and a class
    // whose weapons teach magic says so -- the armiger's does only with the
    // archetype that grants it, which is a fact about that archetype and so
    // lives in its pack rather than in here.
    spheres: TRACK_SPHERE_SIDES.includes(spec.spheres) ? spec.spheres : 'combat',
    text: String(spec.text || ''),
  };
}

/** The sphere lists a track may draw on, and what each is called. */
export const TRACK_SPHERE_SIDES = ['combat', 'magic', 'both'];
export const TRACK_SPHERE_LABELS = {
  combat: 'Martial only', magic: 'Magical only', both: 'Martial and magical',
};
/** The same three in a sentence, where "Martial only spheres" does not read. */
export const TRACK_SPHERE_NOUNS = {
  combat: 'martial', magic: 'magical', both: 'martial and magical',
};

/** The spheres a track may pick from. */
export function trackSpheres(spec) {
  if (spec?.spheres === 'both') return BLENDED_SPHERES;
  if (spec?.spheres === 'magic') return MAGIC_SPHERES;
  return COMBAT_SPHERES;
}

/**
 * What a counting rule has reached by `classLevel`: its start, plus every
 * level named by `gainsAt` at or below it.
 *
 * Zero class levels is zero of everything -- a character who has not taken the
 * class yet has no tracks, not the starting count of them.
 */
export function trackCount(rule, classLevel) {
  const level = Math.max(0, Math.floor(Number(classLevel) || 0));
  if (!level) return 0;
  const start = Math.max(0, Math.floor(Number(rule?.start) || 0));
  const at = String(rule?.gainsAt ?? '').trim();
  if (!at) return start;
  return start + levelRuleLevels(parseLevelRule(at)).filter((l) => l <= level).length;
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
 * One die value moved along that chain, clamped to its ends. A size increase
 * is two steps and a plain step increase one, which is the sheet's own rule
 * and the only arithmetic either progression does to a base die.
 *
 * Returns null for a die the chain does not list, so a caller can say so
 * rather than silently substituting something else.
 */
export function stepDice(die, steps = 0) {
  const at = DIE_STEP[String(die ?? '').trim().toLowerCase()];
  if (at === undefined) return null;
  return STEP_DIE[Math.max(2, Math.min(20, at + (Number(steps) || 0)))];
}

/**
 * Unarmed damage dice, exactly as the sheet computes them: effective talents
 * pick the Medium-column base die, then each size increase is worth two die
 * steps and each step increase one, capped at the top of the chain.
 */
export function unarmedDice(talents, { stepIncreases = 0, sizeIncreases = 0 } = {}) {
  const row = UNARMED_TABLE[Math.max(0, Math.min(20, Math.floor(Number(talents) || 0)))];
  const base = row[1]; // Medium
  return stepDice(base, 2 * (Number(sizeIncreases) || 0) + (Number(stepIncreases) || 0))
    ?? STEP_DIE[4];
}

/* ----- a class's own unarmed progression ----- */

/**
 * How many unarmed-associated talents earn the extra size increase a class
 * progression grants on top of its table. Three, as the classes that carry
 * such a table state it -- and editable per character, because the number is
 * the class's to name and not every class names the same one.
 */
export const UNARMED_NATIVE_THRESHOLD = 3;

/**
 * The monk's ladder, as the seed a new progression starts from.
 *
 * It is here as a worked example rather than as a rule: a class progression
 * is a table the class prints, so the sheet cannot derive one, and starting
 * from six rungs that are already right beats starting from an empty grid.
 * Note that it is not walkable by DIE_STEP -- 2d8 to 2d10 skips 3d6 -- which
 * is exactly why a progression is rungs and not a count of steps.
 */
export const MONK_UNARMED_LADDER = [
  { from: 1, dice: '1d6' }, { from: 4, dice: '1d8' }, { from: 8, dice: '1d10' },
  { from: 12, dice: '2d6' }, { from: 16, dice: '2d8' }, { from: 20, dice: '2d10' },
];

/**
 * The dice a ladder reads at a class level: the highest rung at or below it.
 *
 * Rungs are not required to be in order -- they are typed by hand, and a
 * rung added late belongs where its level puts it, not where it was written.
 * A tie goes to the later rung, so correcting one by typing another under it
 * works the way it looks like it should. Below the lowest rung there is no
 * progression yet, which is a null rather than a guess.
 */
export function ladderRung(ladder, level) {
  const at = Math.floor(Number(level) || 0);
  let best = null;
  for (const rung of ladder || []) {
    const from = Math.floor(Number(rung?.from) || 0);
    const dice = String(rung?.dice ?? '').trim();
    if (!dice || from > at) continue;
    if (!best || from >= best.from) best = { from, dice };
  }
  return best;
}

/** Just the dice of that rung, which is what the progression is after. */
export function ladderDice(ladder, level) {
  return ladderRung(ladder, level)?.dice ?? null;
}

/** Size -> AC/attack modifier and its opposite for CMB/CMD. */
export const SIZE_MODIFIERS = {
  Fine: 8, Diminutive: 4, Tiny: 2, Small: 1, Medium: 0,
  Large: -1, Huge: -2, Gargantuan: -4, Colossal: -8,
};

/* ------------------------------------------------------------------ *
 * Weapon damage dice under a size change: the official progression
 * chart and its walking rules (the Paizo FAQ), applied one size step
 * at a time so multi-step changes read each step's own size and dice.
 * ------------------------------------------------------------------ */

export const DAMAGE_DICE_CHART = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [1, 10],
  [2, 6], [2, 8], [3, 6], [3, 8], [4, 6], [4, 8],
  [6, 6], [6, 8], [8, 6], [8, 8], [12, 6], [12, 8], [16, 6],
];
const SIZE_LADDER = ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];
const CHART_1D6 = 4;   // "1d6 or less" -- one step up instead of two
const CHART_1D8 = 5;   // "1d8 or less" -- one step down instead of two
const chartIdx = (n, d) => DAMAGE_DICE_CHART.findIndex(([cn, cd]) => cn === n && cd === d);

/**
 * A dice value's place on the chart, remapping what the chart does not list:
 * Nd4 counts as (N/2)d8 even and ((N+1)/2)d6 odd; Nd12 as 2Nd6; a d6 count
 * not listed falls to the next lowest listed count as d8s (10d6 -> 8d8); a d8
 * count not listed rises to the next highest listed count as d6s (5d8 -> 6d6).
 * Off the chart's ends it clamps; a die the rules never mention returns null
 * and the value is left as written.
 */
function toChart(n, d) {
  const direct = chartIdx(n, d);
  if (direct >= 0) return direct;
  if (d === 4 && n > 1) return n % 2 === 0 ? toChart(n / 2, 8) : toChart((n + 1) / 2, 6);
  if (d === 12) return toChart(2 * n, 6);
  if (d === 6) {
    const counts = DAMAGE_DICE_CHART.filter(([, cd]) => cd === 6).map(([cn]) => cn);
    const lower = [...counts].reverse().find((c) => c <= n);
    return lower === undefined ? null : toChart(lower, 8);
  }
  if (d === 8) {
    const counts = DAMAGE_DICE_CHART.filter(([, cd]) => cd === 8).map(([cn]) => cn);
    const higher = counts.find((c) => c >= n);
    return higher === undefined ? DAMAGE_DICE_CHART.length - 1 : toChart(higher, 6);
  }
  return null;
}

/**
 * One dice value ([count, die]) through `steps` size steps (positive =
 * larger). Each step: up is two chart steps, or one from Small or below or
 * from 1d6 or less; down is two, or one from Medium or below or from 1d8 or
 * less; Nd10 (N >= 2) goes to 2Nd8 up and Nd8 down regardless of size.
 * Returns the new [count, die] ([n, 1] is a flat n), or null when the value
 * is not one the chart can walk (left as written).
 */
export function stepDamageDice(n, d, steps, initialSize = 'Medium') {
  let count = Math.trunc(Number(n) || 0);
  let die = Math.trunc(Number(d) || 0);
  const move = Math.trunc(Number(steps) || 0);
  if (!move || count <= 0) return null;
  let size = SIZE_LADDER.indexOf(initialSize);
  if (size < 0) size = SIZE_LADDER.indexOf('Medium');
  const dir = move > 0 ? 1 : -1;
  for (let k = Math.abs(move); k > 0; k--) {
    if (die === 10 && count >= 2) {
      count = dir > 0 ? 2 * count : count;
      die = 8;
      size += dir;
      continue;
    }
    let idx = toChart(count, die);
    if (idx === null || idx < 0) return null;
    if (dir > 0) idx = Math.min(DAMAGE_DICE_CHART.length - 1, idx + (size <= 3 || idx <= CHART_1D6 ? 1 : 2));
    else idx = Math.max(0, idx - (size <= 4 || idx <= CHART_1D8 ? 1 : 2));
    [count, die] = DAMAGE_DICE_CHART[idx];
    size += dir;
  }
  return [count, die];
}

/**
 * A whole dice map ({die: count}) through a size change. Each component walks
 * the chart on its own (a mixed "1d8+1d6" steps both); one that steps to the
 * chart's flat 1 lands in `flat`; one the chart cannot walk stays as written.
 */
export function stepDiceMap(map, steps, initialSize = 'Medium') {
  const dice = {};
  let flat = 0;
  for (const [dieKey, count] of Object.entries(map || {})) {
    const stepped = stepDamageDice(Number(count), Number(dieKey), steps, initialSize);
    if (!stepped) {
      if (Number(count)) dice[dieKey] = (dice[dieKey] || 0) + Number(count);
      continue;
    }
    const [n2, d2] = stepped;
    if (d2 <= 1) flat += n2;
    else dice[d2] = (dice[d2] || 0) + n2;
  }
  return { dice, flat };
}

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

/** How a maneuver is initiated. */
export const MANEUVER_ACTIONS = ['Full-round', 'Standard', 'Move', 'Swift', 'Immediate', 'Free'];

/** Which save a maneuver calls for, if any. */
export const MANEUVER_SAVES = ['None', 'Fortitude', 'Reflex', 'Will'];

/**
 * The cells a maneuver's own entry is made of.
 *
 * The catalogue ships names only -- the rules text is somebody's copyright,
 * so the pack carries what a maneuver is *called* and nothing about what it
 * does. Which leaves the player to write the parts they actually need at the
 * table, and this is the shape they write them in: the header block off a
 * stat entry, in the order a rulebook prints it.
 *
 * A cell with `options` is picked from a list; the rest are prose, so
 * `Close ({= 25 + 5 * floor(level / 2)} ft.)` keeps up with the level the way
 * every other formula on the sheet does. `text` is the description and is
 * last, because it is the only one that needs the room.
 *
 * `line` groups them the way a stat entry prints: what it is, where it
 * reaches, what it is saved against, and then what it does. Each line still
 * folds to fewer columns in a narrow discipline, so this is the order they
 * fold in rather than a fixed grid.
 */
export const MANEUVER_FIELDS = [
  { key: 'type', label: 'Type', options: MANEUVER_TYPES, line: 1 },
  { key: 'action', label: 'Action', options: MANEUVER_ACTIONS, line: 1 },
  { key: 'range', label: 'Range', hint: 'Personal, Melee attack, 30 ft.', line: 2 },
  { key: 'target', label: 'Target', hint: 'One creature', line: 2 },
  { key: 'duration', label: 'Duration', hint: 'Instantaneous', line: 2 },
  { key: 'save', label: 'Saving throw', options: MANEUVER_SAVES, line: 3 },
  { key: 'dc', label: 'DC', hint: '{= 10 + 1 + wis.mod}', line: 3 },
  { key: 'text', label: 'Description', lines: 4, line: 4 },
];

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

/**
 * Active armor + shields, reduced to the numbers the sheet needs.
 *
 * `ac` is the two together, which is all the AC formulas ever wanted. They are
 * also kept apart, because half the rules written about them are about one and
 * not the other -- "your shield bonus to AC", "while wearing no armour" -- and
 * a formula that can only read the sum has to be told the split by hand.
 *
 * `shields` is one number per shield *row*, in the order the rows are kept:
 * what that row is worth while it is being held, and nothing while it is not.
 * So the rows always add up to `shield`, and a row nobody has raised reads
 * zero rather than a bonus the character is not getting.
 */
export function armorParts(c) {
  const armor = c.equipment?.armor?.active ? c.equipment.armor : null;
  const rows = c.equipment?.shields || [];
  const shieldAcs = rows.map((s) => (s?.active ? (Number(s.acBonus) || 0) : 0));
  const shields = rows.filter((s) => s?.active);
  const pieces = armor ? [armor, ...shields] : shields;
  const maxDexes = pieces.map((p) => p.maxDex).filter((v) => v !== null && v !== undefined && v !== '');
  const armorAc = Number(armor?.acBonus) || 0;
  const shieldAc = shieldAcs.reduce((t, n) => t + n, 0);
  return {
    ac: armorAc + shieldAc,
    armor: armorAc,
    shield: shieldAc,
    shields: shieldAcs,
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
    rule: 'Each negative level is a cumulative −1 on ability checks, attack rolls, combat maneuver checks, CMD, saving throws and skill checks, and −5 current and total hit points.',
    mods: {
      attack: -1, saves: -1, skills: -1, abilityChecks: -1, cmd: -1, hp: -5,
    },
    notes: ['−1 effective level for every level-dependent variable, spellcasting included',
      'no prepared spells or slots are lost',
      'dies when negative levels equal or exceed total Hit Dice'],
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

/**
 * How a condition picker shelves the catalogue: one shelf per kind of trouble,
 * so twenty-odd conditions read as six short columns rather than one long list.
 * (`group` above is the supersession ladder, a different thing.)
 */
export const CONDITION_CATS = ['Fear', 'Worn down', 'Held', 'Addled', 'Senses', 'Footing'];
const CONDITION_CAT_KEYS = {
  Fear: ['shaken', 'frightened', 'panicked', 'cowering'],
  'Worn down': ['fatigued', 'exhausted', 'sickened', 'nauseated', 'energyDrain'],
  Held: ['grappled', 'pinned', 'entangled', 'helpless', 'paralyzed'],
  Addled: ['dazed', 'staggered', 'stunned', 'confused', 'unconscious'],
  Senses: ['blinded', 'dazzled', 'deafened'],
  Footing: ['prone', 'flatFooted'],
};
for (const [cat, keys] of Object.entries(CONDITION_CAT_KEYS)) {
  for (const key of keys) {
    const cond = CONDITIONS.find((x) => x.key === key);
    if (cond) cond.cat = cat;
  }
}

/**
 * The numeric dials a buff can turn, in the order a buff editor shows them.
 * Each key is one the condition totals already sum, so a ticked buff rides the
 * same machinery as a ticked condition -- every "now" number moves with it.
 */
export const BUFF_MOD_KEYS = [
  ['attack', 'Attack'], ['damage', 'Damage'], ['ac', 'AC'],
  ['saves', 'Saves'], ['skills', 'Skills'], ['initiative', 'Init'],
];

/**
 * Everything else a buff can point an extra bonus at, beyond the six standing
 * dials. Most are further channels through the condition totals; the special
 * ones are documented where they are applied:
 *  - an ability score rides the totals' ability block, so the raised score
 *    cascades into everything built on its modifier;
 *  - `size` is steps larger (+1 = one size up) and unpacks into the four
 *    numbers a step moves -- attack and AC by the size modifier, CMB and CMD
 *    by the special size modifier -- linear per step, which is exact within
 *    a step of Medium and an approximation past Huge. Reach and damage dice
 *    are the player's to move (the Damage dial, a weapon's dice).
 *  - `dc` and `essence` are shown where DCs and the essence pool are read
 *    (the strip's cards); they do not re-run investment or slot math.
 */
export const BUFF_TARGETS = [
  ['melee', 'Melee attacks'],
  ['ranged', 'Ranged attacks'],
  ['cmb', 'CMB'],
  ['cmd', 'CMD'],
  ['fortitude', 'Fortitude'],
  ['reflex', 'Reflex'],
  ['will', 'Will'],
  ['dc', 'Save DCs'],
  ['abilityChecks', 'Ability checks'],
  ['hp', 'Max hit points'],
  ['speed', 'Speed (ft)'],
  ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'],
  ['essence', 'Essence pool'],
  // Size bonus types, per the rules: within a type only the largest increase
  // counts, but the types stack with each other. True changes the size
  // (attack, AC, CMB, CMD and the damage dice); effective is "treated as
  // larger", which reaches the damage dice alone. The stacking kind is for
  // the odd item that makes size effects stack outright -- wraps of
  // suppressed size -- it sums with everything and carries the full true
  // bundle. The result caps at Colossal whatever the mix. TODO: a campaign
  // setting for tables that allow colossal+ sizes.
  ['size', 'True size (+1 = one larger)'],
  ['sizeEffective', 'Effective size (dice only)'],
  ['sizeStacking', 'Size — stacking (wraps & such)'],
];

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
    attack: 0, melee: 0, ranged: 0, damage: 0, ac: 0, cmb: 0, cmd: 0,
    saves: 0, fortitude: 0, reflex: 0, will: 0, dc: 0,
    skills: 0, abilityChecks: 0, initiative: 0, hp: 0, essence: 0, speedFt: 0,
  };
  const ability = {};
  const abilitySet = {};
  let losesDex = false;
  let speed = 1;
  let acVsMelee = 0;
  let acVsRanged = 0;
  // What the AC penalties among these come to, kept apart from the net `ac`.
  // "Any penalties to a creature's AC also apply to its CMD" -- so blinded's
  // −2 is −2 CMD as well, and a buff that happens to be raising AC at the
  // same time must not cancel it out. Only entries that say nothing about
  // CMD themselves: one that does has already said what it does, and adding
  // its AC penalty on top would be counting the same rule twice (the size
  // rows are the case that matters, where the AC change *is* the size
  // modifier and CMD carries it the other way round).
  let acPenalty = 0;

  for (const { info, count } of counted) {
    const n = Math.max(1, count);
    const statesCmd = info.mods?.cmd !== undefined;
    for (const [key, value] of Object.entries(info.mods || {})) {
      mods[key] = (mods[key] || 0) + value * n;
      if (key === 'ac' && value < 0 && !statesCmd) acPenalty += value * n;
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
    mods, ability, abilitySet, losesDex, speed, acVsMelee, acVsRanged, acPenalty,
    counted, superseded,
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
    // 10 + BAB + Str + Dex + the special size modifier (the AC one, the other
    // way round), plus the AC bonuses CMD is allowed and every AC penalty
    // there is -- see cmdBonusTotal. Misc AC is armour-side, so only a
    // penalty typed there carries over.
    compute: (c) => 10 + c.attack.bab + c.abilities.str.totalMod + c.abilities.dex.totalMod
      - sizeMod(c) + c.defenses.miscCMD
      + cmdBonusTotal(c.defenses.acBonusesResolved)
      + Math.min(0, Number(c.defenses.miscAC) || 0),
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
 * An ability score is here too, and is the one that pays for itself twice: it
 * is not a total but the thing a dozen totals are built from, so `str.score`
 * cascades through the modifier into attacks, damage, skills, saves, CMD and
 * carrying capacity without any of them being named. It lands beside the
 * Stats tab build rather than in it -- the build columns go on adding up to
 * the number they add up to.
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
  ['str.score', 'Strength', null],
  ['dex.score', 'Dexterity', null],
  ['con.score', 'Constitution', null],
  ['int.score', 'Intelligence', null],
  ['wis.score', 'Wisdom', null],
  ['cha.score', 'Charisma', null],
  // The working score, which is what a bonus that lasts a fight moves: the
  // Stats tab keeps a column for each, and everything derived is built from
  // the temporary one. `{str.score += 2 as temp.size}` has always said this,
  // and still does; `{str.temp += 2 as size}` is the same thing said the way
  // the value is named -- which is the way anyone reading `str.temp` off the
  // sheet would go looking to write it.
  ['str.temp', 'Strength (working score)', null],
  ['dex.temp', 'Dexterity (working score)', null],
  ['con.temp', 'Constitution (working score)', null],
  ['int.temp', 'Intelligence (working score)', null],
  ['wis.temp', 'Wisdom (working score)', null],
  ['cha.temp', 'Charisma (working score)', null],
];

/**
 * Destinations that settle *after* the prose has been read, and so are not a
 * reason to recompute twice.
 *
 * Everything in FORWARD_STATS above is totalled before any prose is looked
 * at, which is why a bonus landing on one costs a second pass. These land on
 * boxes the sheet resolves once the bonuses are already in hand -- the
 * defence lists, the death threshold, the temporary hit points -- so a
 * character whose only forwarded bonus is `{dr.magic += 2}` computes exactly
 * once, as it always did.
 *
 * The five defence boxes are the parts they are written in as well: `dr`,
 * `resistance`, `weakness` and `immune` each take a name after the dot
 * (`{resistance.fire += 5}`), matched rather than listed, because the list is
 * whatever the campaign's energies and material weaknesses turn out to be.
 * See `forwardTargets` for the matching.
 */
export const FORWARD_LATE = [
  ['defenses.sr', 'Spell resistance'],
  ['defenses.dr', 'Damage reduction, every kind'],
  ['defenses.resistance', 'Energy resistance, every kind'],
  ['defenses.weakness', 'Vulnerability, every kind'],
  ['hp.temp', 'Temporary hit points'],
  ['hp.deathBonus', 'Death threshold'],
  /*
   * A skill point per level, which is what a favoured-class bonus, a human's
   * extra point or a trait grants -- and until now the only way to record one
   * was to type it into the box and let it go stale.
   *
   * Late rather than early: `applyBudget` runs long after the prose has been
   * read, so a bonus landing here is in hand on the same pass and costs no
   * second one.
   *
   * camelCase on purpose. A skill's own destination is `skill.` plus `slug()`,
   * which lowercases everything it touches, so a capital letter is a thing no
   * skill name can ever produce -- and this cannot be shadowed by a homebrew
   * skill somebody calls "Points Per Level".
   */
  ['skill.pointsPerLevel', 'Skill points per level'],
];

/** The defence lists whose parts take a name after the dot. */
export const DEFENCE_PART_FAMILIES = [
  ['dr', 'Damage reduction'],
  ['resistance', 'Energy resistance'],
  ['weakness', 'Vulnerability'],
  ['immune', 'Immunity'],
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

/* -------------------------------------------------------------- *
 * The workbook's own vocabulary
 *
 * The template declares some 470 defined names -- StrMod, Fort, MythicTier --
 * and every formula anyone has ever written in one of these characters is
 * written in them. A player porting a rule they already had working should be
 * able to paste it in, so the names they typed for years go on meaning what
 * they meant, and each one is published beside this sheet's own name for the
 * same number.
 *
 * Most of the 470 name a configuration cell (which stat a save uses, which
 * class sits in slot 3) and have no equivalent here; those are deliberately
 * absent rather than guessed at. What is below was checked against the five
 * source workbooks -- each alias holds the same number as the path it points
 * at, in every one of them, ACBonusShield excepted and for a reason set out
 * where it stands -- because an alias that is subtly the wrong number is
 * worse than no alias at all: it works, and it lies.
 *
 * Check the same way before adding one. Guessing gets it wrong more often
 * than not: ACStatsTotal is the subtotal of the AC bonus columns and not the
 * AC, MeleeBonus is the misc attack bonus and not the attack, and a named
 * range can be displaced by a row inserted above it.
 *
 * That check is also why `StrMod` is `str.tempMod` and not `str.mod`. The
 * workbook's modifier is the working one, buffs and damage included, which is
 * the number the rest of its sheet is built from; `str.mod` here is the score
 * before any of that. The obvious mapping is the wrong one.
 *
 * Every alias is PascalCase and has no dot in it, which is what tells one
 * apart from a name of this sheet's own -- see `isSheetAlias`.
 */

/** Aliases every character has, whatever is on it. */
export const SHEET_ALIASES = {
  // Abilities. The workbook only ever declared StrScore, but a player typing
  // DexScore by analogy has guessed the convention right and should be met.
  ...Object.fromEntries(ABILITIES.flatMap((a) => {
    const Ab = a[0].toUpperCase() + a.slice(1);
    return [[`${Ab}Mod`, `${a}.tempMod`], [`${Ab}Score`, `${a}.score`]];
  })),
  TempStrength: 'str.temp',

  CharacterHP: 'hp.total',
  MythicTier: 'mythic.tier',

  Fort: 'saves.fortitude',
  Ref: 'saves.reflex',
  Will: 'saves.will',
  ABPFort: 'saves.fortitude.abpResistance',
  ABPRef: 'saves.reflex.abpResistance',
  ABPWill: 'saves.will.abpResistance',

  ABPDef: 'ac.abpDeflection',
  ABPNat: 'ac.abpNatural',
  ACBonusArmor: 'ac.armor',
  // The template's one shield row. A sheet carrying more than one numbers
  // them -- ACBonusShield1, ACBonusShield2, aliased per character beside the
  // veil slots -- and the inserted rows push the unnumbered name down onto
  // the blank one at the bottom, where it reads 0 however many shields are
  // strapped on. So this is the one alias that means what the name says
  // rather than what the cell holds: on the four workbooks with a single
  // shield row the two are the same number, and on the fifth the cell is an
  // artefact of row insertion that no formula would be written against.
  ACBonusShield: 'ac.shield',

  MSBTotal: 'caster.msb',
  MSDTotal: 'caster.msd',
  EssenceCapTotal1: 'essence.cap',
};

/**
 * `Level` and `BAB` are not here, and neither is any other name that differs
 * from this sheet's only by its capitals: reading is case-insensitive, so
 * `Level` already finds `level` and an entry for it would say nothing.
 */
export const isSheetAlias = (name) => /^[A-Z][A-Za-z0-9]*$/.test(String(name));

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
 * The DERIVED key each real attack mode's total is stored under -- which is
 * also the key its reconciliation offset is filed against, so a screen that
 * wants to show that offset can find it from the mode alone. Alternates are
 * absent on purpose: an alternate has no offset of its own, it carries the
 * one belonging to the attack it is an alternate of.
 */
export const ATTACK_MODE_KEY = Object.fromEntries(
  Object.entries(MODE_TOTAL_KEYS).map(([mode, key]) => [mode, `attack.${key}`]));

/**
 * The one ability an attack mode is read as running on.
 *
 * A mode may name two, and they add together -- but two colours is no colour
 * at all, so anything that has to pick one takes the first that is set: the
 * primary where both are, and whichever is there where only one is, because a
 * mode filled in the second slot alone still runs on exactly that ability.
 * Empty for a mode that names none, and for one that is not a mode.
 */
export function attackModeAbility(c, mode) {
  const slot = c?.attack?.modes?.[mode];
  if (!slot) return '';
  const key = (name) => {
    const k = String(name ?? '').trim().toLowerCase();
    return ABILITIES.includes(k) ? k : '';
  };
  return key(slot.stat1) || key(slot.stat2);
}

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
