/**
 * model/campaign.js -- the rules a character is played under.
 *
 * The sheet was built for one table, and that table's rules are built into
 * its arithmetic: a 30-point buy, hero points, mythic tiers that come with
 * level, Automatic Bonus Progression. A `campaign` block on the document lets
 * a character be played under other rules, one switch at a time.
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
 */
import { tierAtLevel } from '../rules.js';

/** The table's rules: what a switch reads as until a player sets it. */
export const CAMPAIGN_DEFAULTS = Object.freeze({
  /** Points to spend on ability scores. */
  pointBuy: 30,
  /** Hero points are tracked (the Details panel's counter). */
  heroPoints: true,
  /** Mythic is in play: tiers, mythic hit points, the mythic panels. */
  mythic: true,
  /**
   * Where the mythic tier comes from: `level`, the table's ladder (tier 1 at
   * 8th level, a tier every level after to 10 at 20th), or `awarded`, a tier
   * the GM hands out -- for trials completed, say -- typed on Feats & Mythic.
   */
  mythicTier: 'level',
  /** Automatic Bonus Progression replaces the big six magic items. */
  abp: true,
});

/** The values a select offers for `mythicTier`. */
export const MYTHIC_TIER_SOURCES = Object.freeze(['level', 'awarded']);

/**
 * The rules this document is played under: its own choices over the table's.
 * A value of the wrong kind reads as the default rather than as whatever it
 * happens to coerce to.
 */
export function campaignRules(d) {
  const c = d?.campaign && typeof d.campaign === 'object' ? d.campaign : {};
  const bool = (k) => (typeof c[k] === 'boolean' ? c[k] : CAMPAIGN_DEFAULTS[k]);
  const buy = Number(c.pointBuy);
  return {
    pointBuy: c.pointBuy !== undefined && c.pointBuy !== null && c.pointBuy !== '' && Number.isFinite(buy) && buy >= 0
      ? buy : (Number.isFinite(Number(d?.pointBuyBudget)) ? Number(d.pointBuyBudget) : CAMPAIGN_DEFAULTS.pointBuy),
    heroPoints: bool('heroPoints'),
    mythic: bool('mythic'),
    mythicTier: MYTHIC_TIER_SOURCES.includes(c.mythicTier) ? c.mythicTier : CAMPAIGN_DEFAULTS.mythicTier,
    abp: bool('abp'),
  };
}

/**
 * The tier the character's level gives under these rules: the table's ladder
 * when the tier comes from level, nothing when it is awarded or mythic is off.
 */
export function mythicComputedTier(d) {
  const rules = campaignRules(d);
  return rules.mythic && rules.mythicTier === 'level' ? tierAtLevel(d?.identity?.level) : 0;
}

/**
 * The mythic tier as it stands: 0 with mythic off; otherwise the tier typed on
 * Feats & Mythic (an override of the ladder, or the GM's award), or what the
 * level gives. Every reader of the tier goes through this, so the tier the
 * numbers use, the tracker's and the one seeded on load cannot disagree.
 */
export function mythicTierOf(d) {
  if (!campaignRules(d).mythic) return 0;
  return d?.mythic?.tierOverride ?? mythicComputedTier(d);
}

/** The switches that differ from the table's rules, by name. */
export function campaignChanges(d) {
  const now = campaignRules(d);
  return Object.keys(CAMPAIGN_DEFAULTS).filter((k) => now[k] !== CAMPAIGN_DEFAULTS[k]);
}
