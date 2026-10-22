/**
 * model/campaign.js -- the rules a character is played under.
 *
 * The sheet was built for one table, and that table's rules are built into
 * its arithmetic: a 30-point buy, hero points, mythic tiers that come with
 * level, Automatic Bonus Progression, a level typed in by hand. A `campaign`
 * block on the document lets a character be played under other rules, one
 * switch at a time.
 *
 * The block is sparse. A switch nobody has touched is not written, and reads
 * as the table's rule -- so every document saved before this existed, and
 * every new one, opens under the table's rules with every number where it
 * was. That matters more than tidiness: totals are re-measured on load as the
 * saved figure less what the sheet works out (reconcile.js), so a default
 * that differed from what the sheet used to do would be folded silently into
 * the hidden adjustments on the first load, and turning the rule back on
 * later would count it twice. Flipping a switch while playing is fine: the
 * figure saved after it already agrees with it.
 *
 * Progress is the character's, not the campaign's: the XP and milestones
 * earned (`identity.xp`, `identity.milestones`), the mythic trials completed
 * (`mythic.trials`) and the tier they have been taken to (`mythic.trialTier`)
 * live with the rest of the character. The rules say what they are measured
 * against.
 */
import {
  CORE_PROWESS_LEVELS, MAX_LEVEL, MYTHIC_TIER_LEVEL, attunedBonuses, mythicTierGrant, tierAtLevel,
} from '../rules.js';

/** The table's rules: what a switch reads as until a player sets it. */
export const CAMPAIGN_DEFAULTS = Object.freeze({
  /** Points to spend on ability scores. */
  pointBuy: 30,
  /** Hero points are tracked: the Details panel's counter, and a pool on Trackers. */
  heroPoints: true,
  /**
   * A character may choose to be an antihero: no hero points, and a bonus
   * feat in their place. The choice is the character's (`identity.antihero`);
   * this says whether the campaign offers it.
   */
  antiheroes: false,
  /** Mythic is in play: tiers, mythic hit points, the mythic panels. */
  mythic: true,
  /**
   * Where the mythic tier comes from: `level`, a ladder of the level each
   * tier is reached at (the table's unless `mythicLevels` says otherwise);
   * `trials`, a count of trials completed against so many a tier; or
   * `awarded`, a tier the GM hands out, typed on Feats & Mythic.
   */
  mythicTier: 'level',
  /** Trials a tier takes, unless `mythicTrialSteps` names one tier's own. */
  mythicTrialRate: 1,
  /**
   * Gestalt: each level takes the best of the classes present on it, on two
   * or more Planner tracks. Off, one class a level -- the Planner's first
   * track -- and each class its own saves and base attack bonus.
   */
  gestalt: true,
  /**
   * Hit points after 1st level: the whole die (`max`), its average rounded up
   * (`average`), or the roll kept for each level (`rolled`, in `hp.rolls`).
   */
  hitPoints: 'max',
  /** Automatic Bonus Progression replaces the big six magic items. */
  abp: true,
  /**
   * Which ABP: `table` (the defences and prowess to 20th) or `core`
   * (Pathfinder Unchained: prowess to 18th, armour and weapon attunement,
   * legendary gifts at 19th and 20th).
   */
  abpLadder: 'table',
  /**
   * What a mythic tier hands over besides its path ability: `table` (a
   * mythic feat on odd tiers, a path power and +2 to an ability on even
   * ones) or `core` (the feat on odd tiers, the +2 alone on even ones).
   */
  mythicLadder: 'table',
  /** Alternate Training techniques are offered: their tab, and what they grant. */
  altTraining: true,
  /**
   * Size may grow past Colossal: the steps beyond are counted rather than
   * lost. Colossal's modifiers are the last the rules give, so they hold;
   * each step past adds 1d6 to a weapon's damage.
   */
  pastColossal: false,
  /**
   * How a character gains levels: `typed` (the level is typed in, as it
   * always was), `xp` (experience points against a table), or `milestones`
   * (a count of milestones against so many a level).
   */
  advancement: 'typed',
  /** The XP table: `slow`, `medium` or `fast`, unless `xpSteps` names a level's own. */
  xpTrack: 'medium',
  /** Milestones a level takes, unless `milestoneSteps` names one level's own. */
  milestoneRate: 1,
  /**
   * The highest level a character reaches: Level up stops there, and the
   * ladders end there. Past 20th the Planner grows rows and class
   * progressions carry on; tables that stop at 20th hold their last row.
   */
  maxLevel: MAX_LEVEL,
  /** The highest mythic tier: the ladders, trials and Tier up stop there. */
  maxTier: 10,
  /**
   * What the campaign's money is called: the Wealth wallet and crafting's
   * unit. The coin purse keeps its platinum, gold, silver and copper.
   */
  currency: 'Mana',
});

/** The values a select offers for `mythicTier`. */
export const MYTHIC_TIER_SOURCES = Object.freeze(['level', 'trials', 'awarded']);
export const ADVANCEMENT_MODES = Object.freeze(['typed', 'xp', 'milestones']);
export const HIT_POINT_MODES = Object.freeze(['max', 'average', 'rolled']);
/** The two ladders ABP and the mythic tiers may follow. */
export const LADDERS = Object.freeze(['table', 'core']);

/**
 * The experience a level takes in all, from the core rules' three tables:
 * `XP_TRACKS.medium[9]` is the XP a character has on reaching 9th level.
 */
export const XP_TRACKS = Object.freeze({
  slow: Object.freeze([0, 0, 3000, 7500, 14000, 23000, 35000, 53000, 77000, 115000, 160000,
    235000, 330000, 475000, 665000, 955000, 1350000, 1900000, 2700000, 3850000, 5350000]),
  medium: Object.freeze([0, 0, 2000, 5000, 9000, 15000, 23000, 35000, 51000, 75000, 105000,
    155000, 220000, 315000, 445000, 635000, 890000, 1300000, 1800000, 2550000, 3600000]),
  fast: Object.freeze([0, 0, 1300, 3300, 6000, 10000, 15000, 23000, 34000, 50000, 71000,
    105000, 145000, 210000, 295000, 425000, 600000, 850000, 1200000, 1700000, 2400000]),
});

/** The table's highest mythic tier, and the core rules'. */
export const MAX_TIER = CAMPAIGN_DEFAULTS.maxTier;

/** How high a campaign may set the highest level and tier. */
export const LEVEL_CEILING = 40;
export const TIER_CEILING = 20;

/** A count read from a field: a whole number 0 or more, or `fallback`. */
const count = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** A sparse per-step map (`{ 9: 51000 }`) as numbers, wrong kinds dropped. */
const steps = (map) => {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const [k, v] of Object.entries(map)) {
    const n = count(v, null);
    if (n !== null && Number.isInteger(Number(k))) out[Number(k)] = n;
  }
  return out;
};

/**
 * The rules this document is played under: its own choices over the table's.
 * A value of the wrong kind reads as the default rather than as whatever it
 * happens to coerce to.
 */
export function campaignRules(d) {
  const c = d?.campaign && typeof d.campaign === 'object' ? d.campaign : {};
  const bool = (k) => (typeof c[k] === 'boolean' ? c[k] : CAMPAIGN_DEFAULTS[k]);
  const words = (v) => (typeof v === 'string' ? v.trim() : '');
  // A highest level or tier: at least 1, at most the ceiling.
  const most = (k, ceiling) => {
    const n = count(c[k], null);
    return n === null || n < 1 ? CAMPAIGN_DEFAULTS[k] : Math.min(ceiling, n);
  };
  const buy = Number(c.pointBuy);
  return {
    pointBuy: c.pointBuy !== undefined && c.pointBuy !== null && c.pointBuy !== '' && Number.isFinite(buy) && buy >= 0
      ? buy : (Number.isFinite(Number(d?.pointBuyBudget)) ? Number(d.pointBuyBudget) : CAMPAIGN_DEFAULTS.pointBuy),
    heroPoints: bool('heroPoints'),
    antiheroes: bool('antiheroes'),
    mythic: bool('mythic'),
    mythicTier: MYTHIC_TIER_SOURCES.includes(c.mythicTier) ? c.mythicTier : CAMPAIGN_DEFAULTS.mythicTier,
    mythicTrialRate: count(c.mythicTrialRate, CAMPAIGN_DEFAULTS.mythicTrialRate),
    gestalt: bool('gestalt'),
    hitPoints: HIT_POINT_MODES.includes(c.hitPoints) ? c.hitPoints : CAMPAIGN_DEFAULTS.hitPoints,
    abp: bool('abp'),
    abpLadder: LADDERS.includes(c.abpLadder) ? c.abpLadder : CAMPAIGN_DEFAULTS.abpLadder,
    mythicLadder: LADDERS.includes(c.mythicLadder) ? c.mythicLadder : CAMPAIGN_DEFAULTS.mythicLadder,
    altTraining: bool('altTraining'),
    pastColossal: bool('pastColossal'),
    advancement: ADVANCEMENT_MODES.includes(c.advancement) ? c.advancement : CAMPAIGN_DEFAULTS.advancement,
    xpTrack: Object.hasOwn(XP_TRACKS, c.xpTrack) ? c.xpTrack : CAMPAIGN_DEFAULTS.xpTrack,
    milestoneRate: count(c.milestoneRate, CAMPAIGN_DEFAULTS.milestoneRate),
    maxLevel: most('maxLevel', LEVEL_CEILING),
    maxTier: most('maxTier', TIER_CEILING),
    // The wallet's own name, which no control ever set, still counts under a
    // blank: a sheet that came in calling it something else keeps that.
    currency: words(c.currency) || words(d?.wealth?.currency) || CAMPAIGN_DEFAULTS.currency,
  };
}

/**
 * Whether this character took the antihero's bargain: hero points given up
 * for a bonus feat. Only where the campaign tracks hero points and offers the
 * bargain -- with either off, the choice is kept and means nothing.
 */
export function isAntihero(d) {
  const rules = campaignRules(d);
  return rules.heroPoints && rules.antiheroes && d?.identity?.antihero === true;
}

/** Whether this character has hero points to spend. */
export function heroPointsInPlay(d) {
  return campaignRules(d).heroPoints && !isAntihero(d);
}

/** What the money is called, as a heading says it ("Mana", "Gold"). */
export function currencyName(d) {
  return campaignRules(d).currency;
}

/* ---------------- one set of rules for the party ---------------- */

/** The per-step maps a rule may carry, kept with the switches in a rules file. */
const STEP_MAPS = ['mythicLevels', 'mythicTrialSteps', 'xpSteps', 'milestoneSteps'];

/**
 * The campaign rules as a file a GM can hand round, to be loaded into each
 * character of the party. Each character keeps its own copy (a published
 * sheet opens without anything else to read them from).
 */
export function campaignPreset(d) {
  const own = d?.campaign && typeof d.campaign === 'object' ? d.campaign : {};
  const keys = [...Object.keys(CAMPAIGN_DEFAULTS), ...STEP_MAPS];
  return {
    kind: 'campaign-rules',
    campaign: JSON.parse(JSON.stringify(Object.fromEntries(keys.filter((k) => own[k] !== undefined).map((k) => [k, own[k]])))),
  };
}

/**
 * The campaign rules a file holds, or null: a rules file's, or a whole
 * character's -- the rules that character is played under, the table's where
 * it has none. Only the rules are taken; anything else in the file is not.
 */
export function presetCampaign(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.kind === 'campaign-rules') return campaignPreset({ campaign: doc.campaign }).campaign;
  if (doc.identity && typeof doc.identity === 'object') return campaignPreset(doc).campaign;
  return null;
}

/** Two campaign blocks the same rules: the switches and ladders, in any key order. */
export function sameCampaign(a, b) {
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
  return canon(campaignPreset({ campaign: a }).campaign) === canon(campaignPreset({ campaign: b }).campaign);
}

/**
 * Whether this character follows the rules every character shares (see
 * shared-rules.js): they are on, and it is not set to its own. `shared` is
 * what the browser holds, `{ on, rules }`, or null.
 */
export function followsShared(d, shared) {
  return !!shared?.on && d?.campaignOwn !== true;
}

/** What each switch is called, for a list of the rules that differ from the table's. */
export const RULE_TITLES = Object.freeze({
  pointBuy: 'Point buy',
  advancement: 'Levels',
  xpTrack: 'XP table',
  milestoneRate: 'Milestones a level',
  maxLevel: 'Highest level',
  gestalt: 'Gestalt',
  hitPoints: 'Hit points',
  heroPoints: 'Hero points',
  antiheroes: 'Antiheroes',
  mythic: 'Mythic',
  mythicTier: 'Mythic tier',
  mythicTrialRate: 'Trials a tier',
  maxTier: 'Highest mythic tier',
  mythicLadder: 'What a tier grants',
  abp: 'Automatic Bonus Progression',
  abpLadder: 'Which ABP',
  altTraining: 'Alternate Training',
  pastColossal: 'Past Colossal',
  currency: 'Currency',
});

/** The rules a campaign block changes from the table's, by name. */
export function changedRuleTitles(rules) {
  return campaignChanges({ campaign: rules }).map((k) => RULE_TITLES[k] || k);
}

/* ---------------- core ABP and the core mythic ladder ---------------- */

/** Whether ABP is in play under the core ladder. */
export function coreAbp(d) {
  const rules = campaignRules(d);
  return rules.abp && rules.abpLadder === 'core';
}

/**
 * Core ABP's armour and weapon attunement, as each item's enhancement bonus,
 * or null under any other rule. Armour: the worn armour and the shields in
 * use that are ticked as attuned, in that order -- none ticked, the worn
 * armour, or the clothes where there is none (clothing counts as armour with
 * a +0 bonus). Weapons: those ticked, in row order. Two ticked split the
 * bonus once the level allows; a third gets nothing.
 */
export function abpAttuneOf(d) {
  if (!coreAbp(d)) return null;
  const level = Number(d?.identity?.level) || 0;
  const e = d?.equipment || {};
  const armor = e.armor?.active ? e.armor : null;
  const shields = Array.isArray(e.shields) ? e.shields : [];
  const weapons = Array.isArray(e.weapons) ? e.weapons : [];
  const out = { armor: 0, clothing: 0, shields: shields.map(() => 0), weapons: weapons.map(() => 0) };

  const ticked = [...(armor?.attuned ? ['armor'] : []),
    ...shields.flatMap((s, i) => (s?.active && s.attuned ? [i] : []))];
  const pieces = ticked.length ? ticked : ['armor'];
  attunedBonuses(level, pieces.length).forEach((bonus, k) => {
    if (pieces[k] !== 'armor') out.shields[pieces[k]] = bonus;
    else if (armor) out.armor = bonus;
    else out.clothing = bonus;
  });
  const arms = weapons.flatMap((w, i) => (w?.attuned ? [i] : []));
  attunedBonuses(level, arms.length).forEach((bonus, k) => { out.weapons[arms[k]] = bonus; });
  return out;
}

/** The prowess picks that count: all of them, or under core ABP those of its levels alone. */
export function prowessPicks(d) {
  const picks = d?.progressionPicks;
  if (!picks || !coreAbp(d)) return picks;
  return {
    ...picks,
    abp: (picks.abp || []).map((row) => ({
      ...row,
      mental: CORE_PROWESS_LEVELS.mental.includes(row.level) ? row.mental : null,
      physical: CORE_PROWESS_LEVELS.physical.includes(row.level) ? row.physical : null,
    })),
  };
}

/**
 * What a mythic tier hands over beside its path ability, as the Mythic Feats
 * table labels it: the sheet's own label where it kept one, else the
 * ladder's. Null where the core ladder gives nothing (an even tier).
 */
export function mythicTierGrantOf(d, tier, label = '') {
  if (campaignRules(d).mythicLadder === 'core') return tier % 2 ? `Mythic feat ${Math.ceil(tier / 2)}` : null;
  return label || mythicTierGrant(tier);
}

/* ---------------- room for every level and tier ---------------- */

/*
 * The Planner has a row per level and the mythic ladder one per tier: twenty
 * and ten, the table's. Where the campaign goes higher they grow to its
 * highest, so a level past 20th has a row to name its class on; lowered
 * again, the extra rows go only while nothing is written in them. Rows the
 * table always had are never taken away -- a campaign that stops at 6th
 * keeps the rest of its plan.
 */

/** Give the Planner a row for every level up to the campaign's highest. */
export function fitPlannerRows(d) {
  const rows = d?.progression?.levels;
  if (!Array.isArray(rows)) return;
  const want = Math.max(MAX_LEVEL, campaignRules(d).maxLevel);
  while (rows.length < want) rows.push({ level: rows.length + 1, classes: [] });
  const blank = (r) => !(r?.classes || []).some((n) => String(n ?? '').trim());
  while (rows.length > want && blank(rows[rows.length - 1])) rows.pop();
}

const MYTHIC_ROW_KEYS = ['name', 'path', 'featChoice', 'effect', 'featEffect'];

/** Give the mythic ladder a row for every tier up to the campaign's highest. */
export function fitMythicRows(d) {
  const rows = d?.mythic?.abilities;
  if (!Array.isArray(rows)) return;
  const want = Math.max(MAX_TIER, campaignRules(d).maxTier);
  while (rows.length < want) rows.push(Object.fromEntries(MYTHIC_ROW_KEYS.map((k) => [k, ''])));
  const blank = (a) => !MYTHIC_ROW_KEYS.some((k) => String(a?.[k] ?? '').trim());
  while (rows.length > want && blank(rows[rows.length - 1])) rows.pop();
}

/** The tiers that raise an ability score: every even one, to the campaign's highest. */
export function mythicStatTiers(d) {
  const top = campaignRules(d).maxTier;
  return Array.from({ length: Math.floor(top / 2) }, (_, i) => (i + 1) * 2);
}

/* ---------------- the ladders ---------------- */

/*
 * Each ladder runs to the campaign's highest level or tier. Past the table's
 * own end (20th level, 10th tier) a step has no figure of the table's -- an
 * XP total or a tier's level is the campaign's to give -- while a rate
 * carries on as it is.
 */

/** The level each tier is reached at, `[, t1, t2, …]`: the table's, with the campaign's own. */
export function mythicLevels(d) {
  const own = steps(d?.campaign?.mythicLevels);
  return Array.from({ length: campaignRules(d).maxTier + 1 }, (_, t) => (t ? own[t] ?? MYTHIC_TIER_LEVEL[t] ?? null : null));
}

/** The trials each tier takes from the one before, `[, t1, …]`. */
export function mythicTrialSteps(d) {
  const { mythicTrialRate: rate, maxTier } = campaignRules(d);
  const own = steps(d?.campaign?.mythicTrialSteps);
  return Array.from({ length: maxTier + 1 }, (_, t) => (t ? own[t] ?? rate : null));
}

/** The XP each level takes in all, `[, l1, …]`: the chosen table, with the campaign's own. */
export function xpThresholds(d) {
  const { xpTrack, maxLevel } = campaignRules(d);
  const table = XP_TRACKS[xpTrack];
  const own = steps(d?.campaign?.xpSteps);
  return Array.from({ length: maxLevel + 1 }, (_, l) => (l ? own[l] ?? table[l] ?? null : null));
}

/** The milestones each level takes from the one before, `[, , l2, …]`. */
export function milestoneSteps(d) {
  const { milestoneRate: rate, maxLevel } = campaignRules(d);
  const own = steps(d?.campaign?.milestoneSteps);
  return Array.from({ length: maxLevel + 1 }, (_, l) => (l >= 2 ? own[l] ?? rate : null));
}

/** The tier a ladder of levels gives at `level`: every tier in turn whose level is reached. */
function tierOnLadder(ladder, level) {
  let tier = 0;
  while (tier < ladder.length - 1 && ladder[tier + 1] !== null && ladder[tier + 1] <= level) tier += 1;
  return tier;
}

/** The tier `trials` completed buy, with the trials each tier takes. */
function tierFromTrials(perTier, trials) {
  let tier = 0;
  let spent = 0;
  while (tier < perTier.length - 1 && trials >= spent + perTier[tier + 1]) {
    spent += perTier[tier + 1];
    tier += 1;
  }
  return tier;
}

/**
 * The tier the trials have been taken to. Trials only offer a tier, as XP
 * only offers a level: **Tier up** takes it, and that is what is kept. Until
 * the first press is stored, it is what the trials already buy.
 */
function trialTierNow(d) {
  return Math.min(campaignRules(d).maxTier,
    count(d?.mythic?.trialTier, null) ?? tierFromTrials(mythicTrialSteps(d), count(d?.mythic?.trials, 0)));
}

/**
 * Keep the tier the trials have reached while the tier comes from trials,
 * and only then. Written the first time a pass sees trials in force -- a
 * sheet just switched to them, or one saved under them before the tier was
 * kept -- at what the count already buys, so nothing moves; after that only
 * Tier up raises it. Under any other rule it goes, so switching back to
 * trials starts from the count again, and a sheet that never used trials
 * carries nothing.
 */
export function settleTrialTier(d) {
  const m = d.mythic || (d.mythic = {});
  if (campaignRules(d).mythicTier !== 'trials') delete m.trialTier;
  else if (count(m.trialTier, null) === null) m.trialTier = trialTierNow(d);
}

/**
 * The tier these rules give before anyone types one: the ladder's at the
 * character's level, or the one the trials have been taken to when the tier
 * comes from trials; nothing when it is awarded or mythic is off.
 */
export function mythicComputedTier(d) {
  const rules = campaignRules(d);
  if (!rules.mythic) return 0;
  if (rules.mythicTier === 'trials') return trialTierNow(d);
  if (rules.mythicTier !== 'level') return 0;
  // The table's own ladder goes on through the rules' function, so a sheet
  // that has not changed it works out exactly as it always did.
  if (!Object.keys(steps(d?.campaign?.mythicLevels)).length) return Math.min(rules.maxTier, tierAtLevel(d?.identity?.level));
  return tierOnLadder(mythicLevels(d), Number(d?.identity?.level) || 0);
}

/**
 * The mythic tier as it stands: 0 with mythic off; otherwise the tier typed on
 * Feats & Mythic (an override, or the GM's award), or what the rules give.
 * Every reader of the tier goes through this, so the tier the numbers use,
 * the tracker's and the one seeded on load cannot disagree.
 */
export function mythicTierOf(d) {
  if (!campaignRules(d).mythic) return 0;
  return d?.mythic?.tierOverride ?? mythicComputedTier(d);
}

/**
 * What a tier is reached at, for the mythic tables' second column: a level,
 * so many trials in all, or nothing when the GM awards it.
 */
export function mythicTierReached(d, tier) {
  const rules = campaignRules(d);
  if (rules.mythicTier === 'level') {
    const level = mythicLevels(d)[tier];
    return { head: 'Level', value: level ?? '', title: level ? `Tier ${tier} at level ${level}` : '' };
  }
  if (rules.mythicTier === 'trials') {
    const per = mythicTrialSteps(d);
    const total = per.slice(1, tier + 1).reduce((a, b) => a + b, 0);
    return { head: 'Trials', value: total, title: `Tier ${tier} after ${total} trial${total === 1 ? '' : 's'} in all (${per[tier]} for this tier)` };
  }
  return { head: 'Level', value: '', title: 'Awarded by the GM' };
}

/* ---------------- progress ---------------- */

/**
 * Where the character stands on the way to the next level, or null when the
 * level is typed in. `have` and `need` are measured the way the rules count:
 * XP in all, or milestones since the last level. `ready` is true once the
 * next level is earned -- the sheet offers it, and levelling is a press.
 */
export function levelProgress(d) {
  const rules = campaignRules(d);
  if (rules.advancement === 'typed') return null;
  const level = Number(d?.identity?.level) || 0;
  const next = level < rules.maxLevel ? level + 1 : null;
  if (rules.advancement === 'xp') {
    const table = xpThresholds(d);
    const have = count(d?.identity?.xp, 0);
    const need = next ? table[next] ?? null : null;
    // `unset`: a level past the table's end with no figure of the campaign's.
    return {
      mode: 'xp', level, next, have, need, short: need === null ? 0 : Math.max(0, need - have),
      ready: need !== null && have >= need, from: table[level] ?? 0, unset: next !== null && need === null,
    };
  }
  const per = milestoneSteps(d);
  const have = count(d?.identity?.milestones, 0);
  const need = next ? per[next] : null;
  return { mode: 'milestones', level, next, have, need, short: need === null ? 0 : Math.max(0, need - have), ready: need !== null && have >= need, from: 0 };
}

/**
 * Trials done, and what the next tier takes, when the tier comes from
 * trials; else null. Trials are counted in all and never spent: `toward` is
 * how many count toward the next tier past those the tiers taken so far
 * used. `ready` is true once the next tier is earned -- the sheet offers it,
 * and taking it is a press, as a level is.
 */
export function trialProgress(d) {
  const rules = campaignRules(d);
  if (!rules.mythic || rules.mythicTier !== 'trials') return null;
  const per = mythicTrialSteps(d);
  const have = count(d?.mythic?.trials, 0);
  const tier = trialTierNow(d);
  const spent = per.slice(1, tier + 1).reduce((a, b) => a + b, 0);
  const next = tier < rules.maxTier ? tier + 1 : null;
  const need = next ? per[next] : null;
  return {
    tier, next, have, toward: Math.max(0, have - spent), need,
    short: next ? Math.max(0, spent + need - have) : 0, ready: next !== null && have >= spent + need,
  };
}

/** Take the next mythic tier the trials have earned: a play action, logged and undoable. */
export function tierUp(model) {
  const p = trialProgress(model.data);
  if (!p?.ready) return false;
  model.play(`Reached mythic tier ${p.next}`, () => model.set('mythic.trialTier', p.next));
  return true;
}

/**
 * Take the next level the rules say has been earned: the level goes up one,
 * and milestones spent on it come off the count. A play action, so it is
 * undone like one and goes in the log.
 */
export function levelUp(model) {
  const p = levelProgress(model.data);
  if (!p?.ready) return false;
  model.play(`Levelled up to ${p.next}`, () => {
    if (p.mode === 'milestones') model.data.identity.milestones = p.have - p.need;
    model.set('identity.level', p.next);
  });
  return true;
}

/** Add experience points at the table: a play action, logged and undoable. */
export function awardXp(model, amount) {
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || !n) return false;
  model.play(`${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-US')} XP`, () => {
    model.set('identity.xp', Math.max(0, count(model.data.identity?.xp, 0) + n));
  });
  return true;
}

/* ---------------- what has changed ---------------- */

/** The per-step maps a rule carries, by the rule they belong to. */
const OWN_STEPS = { mythicTier: ['mythicLevels', 'mythicTrialSteps'], advancement: ['xpSteps', 'milestoneSteps'] };

/**
 * The switches that differ from the table's rules, by name. A ladder edited
 * step by step counts as a change to the rule it belongs to.
 */
export function campaignChanges(d) {
  const now = campaignRules(d);
  const changed = new Set(Object.keys(CAMPAIGN_DEFAULTS).filter((k) => now[k] !== CAMPAIGN_DEFAULTS[k]));
  for (const [rule, maps] of Object.entries(OWN_STEPS)) {
    if (maps.some((m) => Object.keys(steps(d?.campaign?.[m])).length)) changed.add(rule);
  }
  return [...changed];
}
