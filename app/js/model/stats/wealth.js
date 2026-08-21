/**
 * Coinage: the ledger, the session rewards, and what the character may spend.
 *
 * Wealth is a list of dated entries rather than a running total, so a session
 * that is corrected later still adds up, and the sheet can answer "how much
 * has this character been given this month" without keeping a second number
 * in step with the first.
 */

import { emit } from '../events.js';
import { numOrNull } from '../util.js';

export const WEALTH_KINDS = ['session', 'reward', 'spend', 'offering', 'adjust'];

/** Material casting costs this much per caster level, every whole month. */
export const MATERIAL_CASTING_PER_LEVEL = 10;

/** "2026-08-02T00:00:00" or a Date → "2026-08-02"; anything unreadable → ''. */
export function isoDay(v) {
  if (v === null || v === undefined || v === '') return '';
  // Local calendar day, not UTC: an offering made at eleven at night is made
  // that day, and the day count reads the same clock.
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : local(v);
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : local(d);
}

export function emptyWealth() {
  return {
    currency: 'Mana', baseline: null, current: 0,
    oathOfOfferings: false, materialCasting: false,
    lastOffering: '', manaPerDay: 0, sessionMana: 0, ledger: [],
  };
}

export function normalizeWealth(w) {
  const src = w && typeof w === 'object' ? w : {};
  const e = emptyWealth();
  const ledger = (Array.isArray(src.ledger) ? src.ledger : []).map((l) => ({
    date: isoDay(l?.date), label: String(l?.label ?? '').trim(),
    amount: Number(l?.amount) || 0,
    kind: WEALTH_KINDS.includes(l?.kind) ? l.kind : 'adjust',
  }));
  return {
    ...e,
    currency: String(src.currency || 'Mana'),
    baseline: numOrNull(src.baseline),
    // A workbook with a wallet label and no figure (Angou's) has a wallet at 0.
    current: numOrNull(src.current) ?? 0,
    oathOfOfferings: !!src.oathOfOfferings,
    materialCasting: !!src.materialCasting,
    lastOffering: isoDay(src.lastOffering),
    manaPerDay: numOrNull(src.manaPerDay) ?? 0,
    // Read as `sessions` off the sheet and in documents saved before the rename.
    sessionMana: Math.max(0, numOrNull(src.sessionMana) ?? numOrNull(src.sessions) ?? 0),
    ledger,
  };
}

/** Whole days from `from` (YYYY-MM-DD) to `to`, as TODAY() - date counts them; 0 if unknown or in the future. */
function daysBetween(from, to) {
  if (!from) return 0;
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Complete months from `from` to `to`, as DATEDIF(..., "M") counts them. */
function monthsBetween(from, to) {
  if (!from) return 0;
  const y = +from.slice(0, 4);
  const m = +from.slice(5, 7) - 1;
  const d = +from.slice(8, 10);
  let months = (to.getFullYear() - y) * 12 + (to.getMonth() - m);
  if (to.getDate() < d) months -= 1;
  return Math.max(0, months);
}

/**
 * The wallet as it stands today: what the next offering will cost, part by
 * part, and what is left after it. `today` is injectable so a test does not
 * move with the calendar, and so is `casterLevel`, which the material-casting
 * upkeep is charged against: it is 10 a level every whole month, so the same
 * month costs a 4th-level caster 40 and a 15th-level one 150.
 */
export function wealthView(w, today = new Date(), casterLevel = 0) {
  const v = normalizeWealth(w);
  const cl = Math.max(0, Number(casterLevel) || 0);
  const offeringPerDay = v.manaPerDay / 2;
  const castingPerMonth = MATERIAL_CASTING_PER_LEVEL * cl;
  const days = daysBetween(v.lastOffering, today);
  const months = monthsBetween(v.lastOffering, today);
  const oath = v.oathOfOfferings ? days * offeringPerDay + Math.floor(v.sessionMana / 2) : 0;
  const casting = v.materialCasting ? months * castingPerMonth : 0;
  const expected = oath + casting;
  return {
    ...v,
    offeringPerDay, days, months, casterLevel: cl, castingPerMonth,
    expected: { oath, casting, total: expected },
    after: v.current - expected,
    gains: v.baseline === null ? null : v.current - v.baseline,
    due: v.oathOfOfferings || v.materialCasting,
  };
}

/* ------------------------------------------------------------------ *
 * Primordia techniques: the Technique List and AutoTechnique tabs.
 *
 * A technique is a recipe of spheres, talents and "other" features; its
 * complexity, DCs and SP cost fall out of how many of each it uses. The
 * workbook keeps every technique the character knows or is designing in one
 * column each of `techRef`, with the Technique List tab reading one of them by
 * name (HLOOKUP row by row) and the AutoTechnique tab being the same layout
 * typed by hand for a new one, with a Discord application built underneath.
 *
 * All three grids are read once, here, into `techniques`: the catalogue, the
 * name the list is open on, and the AutoTechnique draft. The grids are then
 * retired, so the block and the copy it came from cannot drift apart.
 *
 * The maths below is each tab's own. They agree on complexity, talents and the
 * DCs; they differ on effective complexity (Technique List applies the
 * Technique Prowess discount, AutoTechnique applies its Instant / Versatile /
 * Signature adjustments) and each is reproduced as written -- see
 * `techniqueStats`.
 * ------------------------------------------------------------------ */

/**
 * The caster level the sheet charges upkeep against: the global caster level
 * the magic training works out, and the character's own level for someone
 * who casts without a sphere block behind it.
 */
export function casterLevel(model) {
  return Number(model.data.training?.magic?.globalCL ?? model.data.identity?.level) || 0;
}

/** The wallet today: current mana, the offering owed part by part, and what is left after it. */
export function wealthViewOf(model, today = new Date()) {
  return wealthView(model.data.wealth, today, model.casterLevel);
}

/**
 * A line in the ledger, and the wallet moves with it. `kind` is one of
 * WEALTH_KINDS; a "session" line also adds to the session mana the next
 * offering takes half of. This is the hook a session-reward automation calls.
 */
export function addWealthEntry(model, { amount, label = '', kind = 'reward', date = null } = {}) {
  const w = model.data.wealth = normalizeWealth(model.data.wealth);
  const n = Number(amount) || 0;
  const entry = {
    date: isoDay(date) || isoDay(new Date()),
    label: String(label || '').trim() || (kind === 'session' ? 'Session reward' : kind === 'spend' ? 'Spent' : 'Adjustment'),
    amount: kind === 'spend' && n > 0 ? -n : n,
    kind: WEALTH_KINDS.includes(kind) ? kind : 'adjust',
  };
  w.ledger.push(entry);
  w.current += entry.amount;
  if (entry.kind === 'session') w.sessionMana = Math.max(0, w.sessionMana + entry.amount);
  model.recompute();
  emit(model, { type: 'wealth', entry, current: w.current });
  return entry;
}

export function removeWealthEntry(model, index) {
  const w = model.data.wealth = normalizeWealth(model.data.wealth);
  const [gone] = w.ledger.splice(index, 1);
  if (!gone) return model;
  // Undoing the line undoes what it did to the wallet.
  w.current -= gone.amount;
  if (gone.kind === 'session') w.sessionMana = Math.max(0, w.sessionMana - gone.amount);
  model.recompute();
  emit(model, { type: 'wealth', removed: gone, current: w.current });
  return model;
}

/**
 * Pay the offering: what the sheet's "Mana After" shows becomes the balance,
 * that balance is the new baseline, today is the last offering, and the
 * session mana starts over -- with the payment written to the ledger.
 */
export function makeOffering(model, today = new Date()) {
  const view = model.wealthView(today);
  if (!view.due) return null;
  const w = model.data.wealth;
  const entry = { date: isoDay(today), label: 'Oath of Offerings' + (view.expected.casting ? ' & material casting' : ''), amount: -view.expected.total, kind: 'offering' };
  w.ledger.push(entry);
  w.current = view.after;
  w.baseline = view.after;
  w.lastOffering = isoDay(today);
  w.sessionMana = 0;
  model.recompute();
  emit(model, { type: 'wealth', entry, current: w.current });
  return entry;
}
