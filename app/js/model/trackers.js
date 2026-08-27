/**
 * Trackers and buffs: the counters on the sheet, and the temporary
 * modifiers that read them.
 *
 * A tracker's maximum is a formula in the same sandbox everything else uses,
 * so it follows the character. Trackers seeded from the workbook keep the
 * sheet's own name and note; the mythic power tracker is created and kept in
 * step with the tier.
 */

import { BUFF_MOD_KEYS, tierAtLevel } from '../rules.js';
import { evaluateFormula } from '../formula.js';
import { isDefaultStyle, normalizeStyle, resolveZones } from '../tracker-style.js';
import { forwarded } from './scope.js';
import { markUndo, rowLabel } from './undo.js';
import { slug } from './util.js';

/**
 * Mythic Power is the one tracker every character carries -- granted at tier 1
 * (level 8) and worth 3 + 2 per tier, which is exactly what all five source
 * sheets record. It is created when missing and refuses to be deleted; every
 * other tracker, sheet-seeded or not, is the player's to rename, retype or
 * remove.
 */
export const MYTHIC_POWER_ID = 'mythic_power';

export const MYTHIC_POWER_FORMULA = 'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)';

const mythicPowerAt = (tier) => (tier > 0 ? 3 + tier * 2 : 0);

// It reads as a pool you draw down over an adventuring day, so it starts full
// and drains. Fresh objects per call: styles are mutated in place by the editor.
const mythicPowerStyle = () => normalizeStyle({ fill: 'remaining' });

/**
 * The numbers a tracker knows about itself.
 *
 * These are exactly what `tracker.<id>.*` publishes character-wide and what
 * `self.*` publishes inside that tracker's own note and zone bounds -- one
 * definition, so the two can never drift apart.
 *
 * `pct` is the position on the track, so a plain 0..max pool reads as "how
 * full" and a two-sided meter reads as "where on the swing". `spent` counts up
 * from the floor, which for the usual min of 0 is just `current`.
 */
export function trackerFacts(t) {
  const current = Number(t?.current) || 0;
  const max = Number(t?.max) || 0;
  const min = Number(t?.min) || 0;
  const span = max - min;
  return {
    current,
    max,
    min,
    remaining: max - current,
    spent: current - min,
    pct: span > 0 ? ((current - min) / span) * 100 : 0,
  };
}

/** Fields of a sheet-seeded tracker a player may change; saved when they differ. */
export const SHEET_TRACKER_OVERRIDES = ['name', 'maxFormula', 'minFormula', 'refresh', 'note'];

/**
 * The sheet's own Resource Tracker block, as trackers -- the pristine seed,
 * before any player edits. A pure function of `data.resources`, so the same
 * list can be diffed against at save time.
 */
export function seedTrackers(model) {
  return (model.data.resources || []).map((r, i) => {
    const id = slug(r.name) || `resource_${i}`;
    const total = Number(r.total) || 0;
    // Mythic Power is the one pool every character has: it is 3 + 2 per tier
    // by the campaign's rules, and all five sheets agree, so it follows the
    // tier instead of freezing the imported number. A sheet that disagrees
    // keeps its own value rather than being "corrected".
    const tierDriven = id === MYTHIC_POWER_ID && total === mythicPowerAt(tierNow(model));
    return {
      id,
      name: r.name,
      current: Number(r.uses) || 0,
      maxFormula: tierDriven ? MYTHIC_POWER_FORMULA
        : typeof r.total === 'number' ? String(r.total) : null,
      max: total,
      minFormula: null,
      min: 0,
      refresh: r.refresh || '',
      source: 'sheet',
      note: typeof r.total === 'string' ? String(r.total) : '',
      style: id === MYTHIC_POWER_ID ? mythicPowerStyle() : null,
    };
  });
}

/** Mythic tier as it stands (override wins), without needing a recompute first. */
export function tierNow(model) {
  const m = model.data.mythic || {};
  return Number(m.tierOverride ?? tierAtLevel(model.data.identity?.level)) || 0;
}

export function loadTrackers(model) {
  // Seed from the sheet's own Resource Tracker block so nothing is lost, then
  // lay the player's changes over the top. Sheet-seeded trackers are fully
  // editable, so `sheetTrackerState` carries whatever differs from the seed
  // -- the spent count, any renamed/retyped field, the style, and deletions.
  // `resources` itself stays exactly as imported.
  const savedState = new Map((model.data.sheetTrackerState || []).map((s) => [s.id, s]));
  const seeded = [];
  for (const seed of seedTrackers(model)) {
    const saved = savedState.get(seed.id);
    if (saved?.deleted) continue;          // removed by the player; stays removed
    if (!saved) { seeded.push(seed); continue; }
    const t = { ...seed };
    if (saved.current !== undefined) t.current = Number(saved.current) || 0;
    for (const key of SHEET_TRACKER_OVERRIDES) {
      if (saved[key] !== undefined) t[key] = saved[key];
    }
    // `style` is saved only when it differs from the seed, and an explicit
    // null is meaningful: it is how "I turned Mythic Power's drain off" is
    // recorded, and must not fall back to the seeded default.
    if ('style' in saved) t.style = saved.style ? normalizeStyle(saved.style) : null;
    seeded.push(t);
  }
  const custom = (model.data.customTrackers || []).map((t) => ({
    minFormula: null, min: 0, style: null, ...t,
  }));
  // Ids must stay unique -- they name the tracker in the formula scope.
  const out = [];
  const seen = new Set();
  for (const t of [...seeded, ...custom]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/**
 * Every character has Mythic Power once they are mythic, so it is created if
 * missing and cannot be deleted. Nothing else is privileged: Spell Points,
 * Culinary Stamina and the rest are ordinary editable trackers.
 */
export function ensureMythicPower(model) {
  if (tierNow(model) < 1) return;
  if (model.trackers.some((t) => t.id === MYTHIC_POWER_ID)) return;
  model.trackers.unshift({
    id: MYTHIC_POWER_ID,
    name: 'Mythic Power',
    current: 0,
    maxFormula: MYTHIC_POWER_FORMULA,
    max: 0,
    minFormula: null,
    min: 0,
    refresh: 'Daily',
    note: '',
    style: mythicPowerStyle(),
    source: 'player',
    createdAt: null,
  });
}

/**
 * Every tracker has a range [min, max]. `max` comes from the tracker's
 * formula as before; `min` comes from an optional second formula and is 0
 * when there is none, so an ordinary pool is unchanged. A negative min turns
 * the tracker into a two-sided meter (Angou's Hellfire Qi swings between
 * -floor((burn.max + qi.max) / 4) and +floor(...)); `current` then reads as a
 * signed position rather than a spent count.
 */
export function recomputeTrackers(model) {
  // A character who has just reached level 8 gains Mythic Power here.
  ensureMythicPower(model);
  const scope = model.scope();
  const toInt = (v) => (typeof v === 'number' ? Math.floor(v) : Math.floor(Number(v)) || 0);
  const errors = new Map();
  // Which sheet-seeded trackers the player has since changed -- shown as an
  // "edited" badge, and the reason they are saved as overrides.
  const seeds = new Map(seedTrackers(model).map((s) => [s.id, s]));
  for (const t of model.trackers) {
    const seed = t.source === 'sheet' ? seeds.get(t.id) : null;
    t.edited = !!seed && SHEET_TRACKER_OVERRIDES.some((k) => (t[k] ?? null) !== (seed[k] ?? null));
    const errs = [];
    // Forwarded first, so a bad max formula still leaves the bonus visible
    // rather than taking the whole range down with it.
    t.forwardedMax = forwarded(model, `tracker.${t.id}.max`);
    t.forwardedMin = forwarded(model, `tracker.${t.id}.min`);
    if (t.maxFormula) {
      try { t.max = toInt(evaluateFormula(t.maxFormula, scope)); } catch (err) { errs.push(`max: ${err.message}`); }
    } else {
      t.max = 0;
    }
    t.max += t.forwardedMax;
    if (t.minFormula) {
      // The max is already computed, so a symmetric meter can be written as
      // `-self.max` instead of repeating the whole max formula.
      const withMax = { ...scope, self: { max: t.max, current: Number(t.current) || 0 } };
      try { t.min = toInt(evaluateFormula(t.minFormula, withMax)); } catch (err) { errs.push(`min: ${err.message}`); }
    } else {
      t.min = 0;
    }
    t.min += t.forwardedMin;
    if (!errs.length && (Number(t.min) || 0) > (Number(t.max) || 0)) {
      errs.push(`min (${t.min}) is above max (${t.max})`);
    }
    errors.set(t, errs);
  }

  // Appearance: normalise whatever was saved, drop an all-default style, and
  // resolve zone bounds (they are formulas). Zones commonly refer to their
  // own tracker ("tracker.burn.max - 2"), so they see the ranges computed
  // just above rather than last recompute's.
  const zoneScope = model.scope();
  for (const t of model.trackers) {
    const errs = errors.get(t);
    t.style = t.style && !isDefaultStyle(t.style) ? normalizeStyle(t.style) : null;
    // `self` is the tracker's own row: a zone can be written as
    // `floor(self.max * 0.3)` without naming the tracker, which matters
    // because the id keeps the tracker's original name through a rename.
    const selfScope = { ...zoneScope, self: trackerFacts(t) };
    t.resolvedZones = t.style
      ? resolveZones(t.style.zones, (src) => evaluateFormula(src, selfScope))
      : [];
    t.resolvedZones.forEach((z, i) => { if (z.error) errs.push(`zone ${i + 1}: ${z.error}`); });
    t.error = errs.length ? errs.join('; ') : null;
  }
}

export function addTracker(model, { name, maxFormula, minFormula = null, current = 0, refresh = '', note = '', style = null }) {
  const base = slug(name);
  let id = base;
  let n = 2;
  while (model.trackers.some((t) => t.id === id)) id = `${base}_${n++}`;
  const tracker = {
    id, name, maxFormula: maxFormula || null, max: 0, minFormula: minFormula || null, min: 0, current,
    refresh, note, style, source: 'player', createdAt: new Date().toISOString(),
  };
  model.trackers.push(tracker);
  model.recompute();
  return tracker;
}

/** Move a tracker by `delta`, staying inside its [min, max] range. */
export function stepTracker(model, id, delta) {
  const t = model.trackers.find((x) => x.id === id);
  if (!t) return null;
  const min = Number(t.min) || 0;
  const max = Number(t.max) || 0;
  const next = Math.max(min, Math.min(max, (Number(t.current) || 0) + (Number(delta) || 0)));
  return model.updateTracker(id, { current: next });
}

export function updateTracker(model, id, patch) {
  const t = model.trackers.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  model.recompute();
  return t;
}

/** True when a tracker may not be deleted (Mythic Power, and only that). */
export function isProtectedTracker(model, id) {
  return id === MYTHIC_POWER_ID;
}

/** @returns {boolean} whether the tracker was removed. */
export function removeTracker(model, id) {
  if (model.isProtectedTracker(id)) return false;
  const i = model.trackers.findIndex((t) => t.id === id);
  if (i < 0) return false;
  markUndo(model, `Removed ${rowLabel(model.trackers[i], 'tracker')}`);
  model.trackers.splice(i, 1);
  model.recompute();
  return true;
}

/**
 * Resolve each buff's dials. A dial takes a plain number or a formula in
 * the tracker sandbox -- "1 + essence.shoulder" keeps a Citadel banner's
 * bonus right as essence moves -- and the resolved number lands beside the
 * source (`attackNum`…), exactly as a speed's bonus does. conditionState
 * reads only the resolved side, so a broken formula degrades to 0 with the
 * error on the row rather than taking the sheet down.
 */
export function recomputeBuffs(model) {
  const buffs = model.data.buffs || [];
  if (!buffs.length) return;
  const scope = model.scope();
  for (const b of buffs) {
    if (!b || typeof b !== 'object') continue;
    const errs = [];
    const resolve = (raw, name, setError) => {
      setError(null);
      if (typeof raw === 'string' && raw.trim() !== '') {
        try {
          return Math.floor(Number(evaluateFormula(raw, scope)) || 0);
        } catch (err) {
          setError(err.message);
          errs.push(`${name}: ${err.message}`);
          return 0;
        }
      }
      return Math.floor(Number(raw) || 0);
    };
    for (const [key] of BUFF_MOD_KEYS) {
      b[`${key}Num`] = resolve(b[key], key, (e) => { b[`${key}Error`] = e; });
    }
    // The extra bonuses: [target, value] rows pointed at anything the six
    // dials do not cover. Values take formulas exactly as the dials do.
    if (!Array.isArray(b.bonuses)) b.bonuses = [];
    for (const row of b.bonuses) {
      if (!row || typeof row !== 'object') continue;
      row.valueNum = resolve(row.value, row.target || 'bonus', (e) => { row.valueError = e; });
    }
    b.error = errs.length ? errs.join('; ') : null;
  }
}
