/**
 * Ability scores: point buy, level-up and mythic picks, racial and temporary
 * adjustments.
 *
 * Everything downstream reads ability modifiers, so this pass runs first and
 * reads nothing but the build itself.
 */

import {
  ABILITIES, ATTUNEMENT_BONUS, ATTUNEMENT_MIN_LEVEL, BUILD_DERIVED_KEYS, MYTHIC_STAT_BONUS,
  POINT_BUY_COST, abilityMod, abpFollowers, foldPicks, pointBuyCost, resolveAbility,
  tierAtLevel,
} from '../rules.js';
import { forwardedSplit } from './scope.js';

/**
 * Recompute ability scores from the Stats-tab build, when one is present.
 *
 * The ABP, array and Level/4 columns are not stored as free numbers: they are
 * folded from the Planner picks, counting only choices at or below the
 * character's current level (the Planner is a full 20-level plan, so a level
 * 15 character has picks recorded for levels they have not reached).
 */
/** Mythic tier derives from level (with a manual override). */
export function applyMythic(model) {
  const m = model.data.mythic || (model.data.mythic = {});
  m.computedTier = tierAtLevel(model.data.identity?.level);
  model.data.identity.mythicTier = m.tierOverride ?? m.computedTier;
}

export function refreshAbilities(model) {
  const build = model.data.statsBuild;
  const applied = new Set();
  if (build) {
    const level = Number(model.data.identity.level) || 0;
    const folded = foldPicks(model.data.progressionPicks, level);

    // Mythic ability picks: +2 at each even tier reached.
    const tier = Number(model.data.identity.mythicTier) || 0;
    folded.mythic = Object.fromEntries(ABILITIES.map((k) => [k, 0]));
    for (const p of model.data.mythicStatPicks || []) {
      if (Number(p.tier) > tier) continue;
      const k = String(p.ability || '').trim().toLowerCase().slice(0, 3);
      if (k in folded.mythic) folded.mythic[k] += MYTHIC_STAT_BONUS;
    }
    for (const key of ABILITIES) {
      const entry = build[key];
      if (!entry) continue;
      for (const k of BUILD_DERIVED_KEYS) entry[k] = folded[k][key];
      const r = resolveAbility(entry);
      entry.resolved = r;
      const a = model.data.abilities[key];
      if (a) {
        // A bonus forwarded here goes on top of what the build resolves to,
        // never into it: the columns on the Stats tab have to go on adding
        // up to the number they add up to, so the forwarded part is a column
        // of its own beside them. Added rather than remembered, so the second
        // recompute pass lands on the same answer as the first -- `r` is
        // worked out afresh from the entry every time.
        //
        // Permanent and temporary part ways here, exactly as the build's own
        // two tables do: a permanent bonus moves the score, a temporary one
        // moves only the working score.
        a.forwarded = forwardedSplit(model, `${key}.score`);
        a.score = r.total + a.forwarded.permanent;
        a.tempScore = r.tempTotal + a.forwarded.total;
        applied.add(key);
      }
    }
  }

  for (const key of ABILITIES) {
    const a = model.data.abilities[key];
    if (!a) continue;
    // Without a build entry the score is a plain typed number, so a
    // forwarded bonus rides the working score instead of being written into
    // it -- adding it to a stored number twice is exactly the drift the
    // two-pass recompute exists to avoid.
    if (!applied.has(key)) a.forwarded = forwardedSplit(model, `${key}.score`);
    const loose = applied.has(key) ? 0 : a.forwarded.total;
    a.mod = abilityMod(a.score);
    // A blank temp score means "same as base".
    if (!a.tempScore) a.tempScore = a.score;
    a.totalMod = abilityMod(a.tempScore + loose);
    a.checkMod = a.totalMod;
  }
}

export function pointBuyTable(model) {
  const t = model.data.pointBuyTable;
  if (!t) return POINT_BUY_COST;
  // JSON object keys are strings; normalise back to numbers.
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [Number(k), Number(v)]));
}

/** Point-buy cost of one ability, and the total spend across all six. */
export function pointBuySummary(model) {
  const table = model.pointBuyTable;
  const build = model.data.statsBuild;
  const per = {};
  let total = 0;
  for (const key of ABILITIES) {
    const score = build?.[key]?.pointBuy ?? 10;
    const cost = pointBuyCost(score, table);
    per[key] = cost;
    total += cost;
  }
  return { per, total, budget: model.data.pointBuyBudget ?? 30 };
}

/** Attunement can only be purchased at level 20 and above. */
export function attunementUnlocked(model) {
  return (Number(model.data.identity.level) || 0) >= ATTUNEMENT_MIN_LEVEL;
}

/** Edit one cell of the ability build. Derived columns are read-only. */
export function setBuild(model, ability, key, value) {
  const entry = model.data.statsBuild?.[ability];
  if (!entry || BUILD_DERIVED_KEYS.includes(key)) return model;
  let v = Number(value) || 0;
  if (key === 'attunement') {
    // Attunement is on or off, worth +2, and only at level 20. Anything
    // truthy buys it, so a checkbox and an imported number both land right.
    v = model.attunementUnlocked && (value === true || v > 0) ? ATTUNEMENT_BONUS : 0;
  }
  entry[key] = v;
  model.recompute();
  return model;
}

/**
 * Assign a progression pick.
 * @param kind  'abp' | 'array' | 'level4'
 * @param level the level the choice is made at
 * @param slot  'mental'|'physical' for abp, 0-3 for array, ignored for level4
 */
export function setPick(model, kind, level, slot, ability) {
  const picks = model.data.progressionPicks
    || (model.data.progressionPicks = { abp: [], array: [], level4: [] });
  const list = picks[kind] || (picks[kind] = []);
  let row = list.find((r) => r.level === level);
  const value = ability || null;

  if (kind === 'abp') {
    if (!row) { row = { level, mental: null, physical: null }; list.push(row); }
    row[slot] = value;
    // Levels 11 (mental) and 12 (physical) raise the ability chosen at 6 / 7
    // rather than offering a new choice, so they follow the source pick.
    for (const follower of abpFollowers(slot, level)) {
      let f = list.find((r) => r.level === follower);
      if (!f) { f = { level: follower, mental: null, physical: null }; list.push(f); }
      f[slot] = value;
    }
  } else if (kind === 'array') {
    if (!row) { row = { level, slots: [null, null, null, null] }; list.push(row); }
    row.slots[slot] = value;
  } else {
    if (!row) { row = { level, ability: null }; list.push(row); }
    row.ability = value;
  }

  list.sort((a, b) => a.level - b.level);
  model.recompute();
  return model;
}

/** Assign the mythic +2 for an even tier. */
export function setMythicPick(model, tier, ability) {
  const list = model.data.mythicStatPicks || (model.data.mythicStatPicks = []);
  let row = list.find((r) => Number(r.tier) === Number(tier));
  if (!row) { row = { tier: Number(tier), ability: null }; list.push(row); }
  row.ability = ability || null;
  list.sort((a, b) => a.tier - b.tier);
  model.recompute();
  return model;
}
