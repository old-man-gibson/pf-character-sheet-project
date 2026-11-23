/**
 * Coinage: the ledger, the session rewards, and what the character may spend.
 *
 * Wealth is a list of dated entries rather than a running total, so a session
 * that is corrected later still adds up, and the sheet can answer "how much
 * has this character been given this month" without keeping a second number
 * in step with the first.
 */

import { currencyName } from '../campaign.js';
import { emit } from '../events.js';
import { numOrNull } from '../util.js';
import { COIN_KINDS, coinValue } from '../../rules.js';
import { markUndo, rowLabel } from '../undo.js';

export const WEALTH_KINDS = ['session', 'reward', 'spend', 'offering', 'adjust'];

/**
 * Material casting costs this much per caster level, every whole month: the
 * drawback's own shorthand, "10 gp per caster level per month on components"
 * in place of tracking every component. The caster level is the Spheres one,
 * since the drawback is a casting tradition's.
 */
export const MATERIAL_CASTING_PER_LEVEL = 10;

/**
 * "2026-08-02T00:00:00" or a Date → "2026-08-02"; anything unreadable → ''.
 *
 * Four-digit years only. A date box lets its year run to six digits, and
 * "275760-05-05" went through the loose parser, was kept as it was typed,
 * and every count read "2757" as its year and came out NaN.
 */
export function isoDay(v) {
  if (v === null || v === undefined || v === '') return '';
  // Local calendar day, not UTC: an offering made at eleven at night is made
  // that day, and the day count reads the same clock.
  const local = (d) => {
    const y = d.getFullYear();
    if (y < 1000 || y > 9999) return '';
    return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : local(v);
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(s);
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

/** The coin a currency's name means ("Gold", "gp", "Silver pieces"), or null for money that is no coin. */
export function coinOf(currency) {
  const name = String(currency || '').trim().toLowerCase().replace(/\s+(pieces?|coins?)$/, '');
  return COIN_KINDS.find(([k, label]) => name === k || name === label.toLowerCase()) || null;
}

/** The purse in whole copper. */
const copperIn = (coins) => Math.round(coinValue(coins) * 100);

/**
 * When the campaign's money is a coin, the coin purse on Equipment is the one
 * place it is kept. Whatever `wealth.current` holds is moved into the purse
 * and left at 0: an amount typed there before the two were one, a ledger line,
 * an offering paid. A spend the purse cannot cover empties it, and the rest
 * stays in `wealth.current` as a debt the next coins pay off.
 *
 * Coins of the campaign's own kind move first and smaller ones take the
 * change. Paying out of larger coins counts the purse again from the
 * campaign's coin down.
 */
export function foldWalletIntoPurse(data) {
  const kind = coinOf(currencyName(data));
  const w = data?.wealth;
  if (!kind || !w || !data.equipment) return false;
  const unit = Math.round(kind[2] * 100);
  const move = Math.round((Number(w.current) || 0) * unit);
  if (!move) return false;
  const coins = data.equipment.coins = { ...(data.equipment.coins || {}) };
  const have = copperIn(coins);
  if (move < 0 && !have) return false;
  const moved = Math.max(move, -have);
  const from = COIN_KINDS.indexOf(kind);
  const spread = (copper, into) => {
    let rest = copper;
    for (const [k, , gp] of COIN_KINDS.slice(from)) {
      const each = Math.round(gp * 100);
      const n = Math.trunc(rest / each);
      into[k] = (Number(into[k]) || 0) + n;
      rest -= n * each;
    }
  };
  const next = { ...coins };
  spread(moved, next);
  if (COIN_KINDS.some(([k]) => (Number(next[k]) || 0) < 0)) {
    for (const [k] of COIN_KINDS) next[k] = 0;
    spread(have + moved, next);
  }
  Object.assign(coins, next);
  w.current = (move - moved) / unit;
  return true;
}

/**
 * What typing a figure in the Wealth panel's own box stores. With a coin for
 * money the box shows the purse, so the figure typed is what the purse should
 * come to, and the difference is what moves.
 */
export function walletEntry(data, value) {
  const currency = currencyName(data);
  if (!coinOf(currency)) return value;
  return (Number(value) || 0) - purseIn(currency, data.equipment?.coins);
}

/**
 * The coin purse in the campaign's money, when that money is a coin: a
 * currency named "Gold" or "gp" is the purse's own gold, so the wallet counts
 * it, with the other coins at their worth. Any other currency (mana) is not
 * coin, and the purse is no part of it.
 */
export function purseIn(currency, coins) {
  const kind = coinOf(currency);
  if (!kind) return 0;
  // Whole copper first: 0.1 + 0.07 is not 0.17 in floating point.
  return Math.round(coinValue(coins) * 100) / (kind[2] * 100);
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

/** The first day after `today` on which one more whole month since `from` is counted; '' with no date. */
function nextMonthDay(from, today) {
  if (!from) return '';
  const now = monthsBetween(from, today);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 0; i < 32; i++) {
    d.setDate(d.getDate() + 1);
    if (monthsBetween(from, d) > now) return isoDay(d);
  }
  return '';
}

/**
 * The wallet as it stands today: what the next offering will cost, part by
 * part, and what is left after it. `today` is injectable so a test does not
 * move with the calendar, and so is `casterLevel`, which the material-casting
 * upkeep is charged against: it is 10 a level every whole month, so the same
 * month costs a 4th-level caster 40 and a 15th-level one 150. `purse` is the
 * coin purse in the same money (see purseIn): `current` stays the wallet's
 * own figure, the one the field edits, and `onHand` is the two together.
 */
export function wealthView(w, today = new Date(), casterLevel = 0, purse = 0) {
  const v = normalizeWealth(w);
  const cl = Math.max(0, Number(casterLevel) || 0);
  const offeringPerDay = v.manaPerDay / 2;
  const castingPerMonth = MATERIAL_CASTING_PER_LEVEL * cl;
  const days = daysBetween(v.lastOffering, today);
  const months = monthsBetween(v.lastOffering, today);
  const oath = v.oathOfOfferings ? days * offeringPerDay + Math.floor(v.sessionMana / 2) : 0;
  const casting = v.materialCasting ? months * castingPerMonth : 0;
  const expected = oath + casting;
  const day = isoDay(today);
  const onHand = v.current + (Number(purse) || 0);
  return {
    ...v,
    purse: Number(purse) || 0, onHand,
    // The wallet's own figure is on hand less the purse: nothing with a coin
    // for money, unless a spend ran past the purse.
    short: Math.max(0, -v.current),
    offeringPerDay, days, months, casterLevel: cl, castingPerMonth,
    // The date box's ceiling, and a last offering past it -- typed, not
    // picked -- which counts no days and no months rather than going negative.
    today: day,
    future: !!v.lastOffering && v.lastOffering > day,
    // When the material-casting upkeep next grows by a month.
    nextMonth: v.materialCasting ? nextMonthDay(v.lastOffering, today) : '',
    expected: { oath, casting, total: expected },
    after: onHand - expected,
    gains: v.baseline === null ? null : onHand - v.baseline,
    due: v.oathOfOfferings || v.materialCasting,
  };
}

/**
 * The wallet today: current mana, the offering owed part by part, and what is
 * left after it -- in the money the campaign's rules name.
 */
export function wealthViewOf(model, today = new Date()) {
  const currency = currencyName(model.data);
  const purse = purseIn(currency, model.data.equipment?.coins);
  return { ...wealthView(model.data.wealth, today, model.casterLevel, purse), currency, coin: !!coinOf(currency) };
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
  if (!w.ledger[index]) return model;
  markUndo(model, `Removed ${rowLabel(w.ledger[index], 'ledger line')}`);
  const [gone] = w.ledger.splice(index, 1);
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
  markUndo(model, 'Made an offering');
  const w = model.data.wealth;
  const entry = { date: isoDay(today), label: 'Oath of Offerings' + (view.expected.casting ? ' & material casting' : ''), amount: -view.expected.total, kind: 'offering' };
  w.ledger.push(entry);
  // The offering comes out of the wallet, or out of the purse when the money is coin.
  w.current = view.current - view.expected.total;
  w.baseline = view.after;
  w.lastOffering = isoDay(today);
  w.sessionMana = 0;
  model.recompute();
  emit(model, { type: 'wealth', entry, current: w.current });
  return entry;
}
