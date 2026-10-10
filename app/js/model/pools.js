/**
 * The pools spent at the table, read one way.
 *
 * A tracker, a spell level's slots, a prepared spell's uses and the
 * power-point pool are each a count against a range, spent with the same
 * four controls: − and +, a number typed in, a pip, and a click along a bar.
 * `poolAt` reads any of them by the reference those controls carry:
 *
 *   tracker:<id>         a tracker
 *   slots:<list>|<index> a row that spends `used` against what vancian.js
 *                        left it: a spell level's slots or a prepared spell
 *   pp                   the power-point pool on Psionics
 *
 * and the four functions after it turn a control into the value it asks for,
 * so "the nth pip leaves n" and "+ on a draining pool gives one back" are
 * written once for all of them.
 */
import { castingNoun } from '../rules.js';
import { barClickValue, normalizeStyle, pipClickValue } from '../tracker-style.js';
import { clampTracker, trackerDrains } from './trackers.js';
import { getPath } from './util.js';

/** How a row of slots is drawn: its pips are what is left. */
const SLOT_STYLE = { fill: 'remaining' };

/**
 * The pool `ref` names, or null when there is none.
 *
 * `current` is what a tracker would store: the position, or for a pool
 * counted down, what has been spent. `left` says the number box shows what
 * is left rather than `current`. `style` is how the meter is drawn, which
 * decides what its pips and its bar stand for. `set` stores a new `current`,
 * held to the range, as one step on the Undo button.
 */
export function poolAt(model, ref) {
  const text = String(ref ?? '');
  if (text === 'pp') return powerPoints(model);
  const at = text.indexOf(':');
  const kind = at < 0 ? '' : text.slice(0, at);
  const rest = text.slice(at + 1);
  if (kind === 'tracker') return tracker(model, rest);
  if (kind === 'slots') return slots(model, rest);
  return null;
}

function tracker(model, id) {
  const t = (model.trackers || []).find((x) => x.id === id);
  if (!t) return null;
  return {
    name: t.name,
    min: Number(t.min) || 0,
    max: Number(t.max) || 0,
    current: Number(t.current) || 0,
    left: trackerDrains(t),
    style: t.style,
    // updateTracker names the step ("Ki 5 → 4") and holds a typed value to
    // the range once the range is worked out again.
    set: (current) => model.updateTracker(t.id, { current: clampTracker(t, current) }),
  };
}

/*
 * One pool for the character, kept as points spent on the Psionics tab
 * rather than as a tracker's own count. Its number box always shows what is
 * left; the meter beside it may be restyled to fill instead.
 */
function powerPoints(model) {
  const p = model.data.psionics || {};
  const max = Number(p.pool) || 0;
  const left = Math.max(0, Math.min(max, Number(p.left) || 0));
  return {
    name: 'power points',
    min: 0,
    max,
    current: max - left,
    left: true,
    style: model.meterStyle('pp'),
    set: (current) => {
      const keep = Math.max(0, Math.min(max, Math.round(max - current)));
      const was = Math.max(0, max - (Number(p.spent) || 0));
      model.play(`power points ${was} → ${keep}`, () => model.set('psionics.spent', max - keep));
    },
  };
}

/*
 * A row spending `used` against a size vancian.js works out: a spell level
 * (`slots`) or a prepared spell (`uses`). Either way it leaves `left` and
 * `usedNow` beside it, which together are the size as it stands.
 */
function slots(model, rest) {
  const bar = rest.lastIndexOf('|');
  const list = rest.slice(0, bar);
  const index = Number(rest.slice(bar + 1));
  const row = bar < 0 ? null : model.list(list)?.[index];
  if (!row || typeof row !== 'object' || row.atWill) return null;
  const left = Math.max(0, Number(row.left) || 0);
  const spent = Math.max(0, Number(row.usedNow) || 0);
  const max = left + spent;
  const name = slotsName(model, list, row);
  return {
    name,
    min: 0,
    max,
    current: spent,
    left: true,
    style: SLOT_STYLE,
    set: (current) => {
      const keep = Math.max(0, Math.min(max, max - current));
      model.play(`${name} ${left} → ${keep}`, () => model.setItem(list, index, 'used', max - keep));
    },
  };
}

/** What the Undo button calls a row of slots: the spell, or "Spell level 3". */
function slotsName(model, list, row) {
  if (String(row.name ?? '').trim()) return String(row.name);
  const owner = /^(.*)\.spells$/.exec(list);
  const c = owner ? getPath(model.data, owner[1]) : null;
  const noun = c?.noun || castingNoun(c?.source);
  return row.level === undefined ? 'slots' : `${noun.one} level ${row.level}`;
}

/** Whether the pool's pips and bar show what is left (see barClickValue). */
const drains = (pool) => pool.min >= 0 && normalizeStyle(pool.style).fill === 'remaining';

/** The number the pool's box shows. */
export const poolShown = (pool) => (pool.left ? pool.max - pool.current : pool.current);

/** What a number typed into the box asks to store. */
export const poolTyped = (pool, typed) => (pool.left ? pool.max - typed : typed);

/** What − or + asks to store: `delta` moves the number the box shows. */
export const poolStep = (pool, delta) => clampTracker(pool, pool.current + (pool.left ? -delta : delta));

/**
 * What a click on pip `n` asks to store. A pip carries the value it stands
 * for; on a draining meter its pips are what is left above the floor, so its
 * place is n - min. The click is pipClickValue's rule either way.
 */
export const poolPip = (pool, n) => (drains(pool)
  ? pool.max - pipClickValue(pool.max - pool.current, n - pool.min)
  : pipClickValue(pool.current, n));

/** What a click `fraction` of the way along the pool's bar asks to store. */
export const poolBar = (pool, fraction) => barClickValue(fraction, pool).current;
