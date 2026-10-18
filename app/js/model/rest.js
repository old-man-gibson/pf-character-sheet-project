/**
 * Rests: the end of an encounter, a new day, a new week.
 *
 * There used to be two buttons called Rest and neither was a new day. The
 * hit-point panel's reset every tracker whatever its refresh, weekly ones
 * included; the dashboard's reset only daily trackers, and dropped one whose
 * minimum is 2 to 0. Neither gave back spell slots, power points or the
 * essence condensed from spell points, and neither could be undone.
 *
 * Now there are three, and each takes in the ones shorter than it, because a
 * week that passes is a day that passes, and a day ends every encounter:
 *
 *   encounter  trackers that come back after an encounter
 *   day        all of that, and: hit points to full, temporary and nonlethal
 *              cleared, daily trackers, spell slots and prepared spells,
 *              power points, temporary essence, every companion's hit points,
 *              and the Lifebound Deck's Stun, Wounds and Death piles
 *   week       all of that, and weekly trackers
 *
 * Each is one step of undo, and taking it back takes back the rest alone:
 * the model runs it as a play action (see `playAction` in undo.js).
 */

import { subsystems } from './subsystems/registry.js';
import { poolTracker } from './trackers.js';
import { emit } from './events.js';
import { healAbilityDamage } from './abilities.js';

export const REST_SPANS = ['encounter', 'day', 'week'];

const REST_LABELS = { encounter: 'End encounter', day: 'New day', week: 'New week' };

/**
 * How long a tracker lasts, read off the Refresh cell it was given in
 * words: 'encounter', 'day' or 'week', or null for one only the player moves.
 * Weekly is asked first, since "per week" says nothing about days, and an
 * encounter before a day, since "per combat" does not mean a night's rest.
 *
 * Whole words only: "Until restored" is not a rest, and "once per 7 days" is
 * a week, not a day.
 */
export function refreshKind(text) {
  const t = String(text ?? '').toLowerCase();
  if (/\bweek|\b(7|seven) days\b/.test(t)) return 'week';
  if (/\b(encounter|combat|battle|fight)s?\b/.test(t)) return 'encounter';
  if (/\b(daily|day|rest|dawn|morning|night|nightly)\b/.test(t)) return 'day';
  return null;
}

/** A tracker back at rest: nothing spent, or a two-sided meter at 0, inside its range. */
const restingPoint = (t) => Math.max(Number(t.min) || 0, Math.min(Number(t.max) || 0, 0));

/**
 * A companion as a rest leaves it: its hit points whole and, unless `pool` is
 * false, its own spell points back. A companion's Rest button does both; a
 * new day only the hit points, because the pool's tracker has already come
 * back by its own Refresh, like every other tracker.
 */
export function restCompanion(model, b, { pool = true } = {}) {
  b.hp = { ...(b.hp || {}), damage: 0, temp: 0 };
  const t = pool && b.id ? poolTracker(model, `sp:${b.id}`) : null;
  if (t) t.current = restingPoint(t);
}

/**
 * Take a rest of `span` ('encounter', 'day' or 'week'). Returns what moved --
 * `{ span, label, trackers }`, trackers being how many came back -- for the
 * note that reports it, or null for a span that is not one.
 */
export function rest(model, span) {
  const reach = REST_SPANS.indexOf(span);
  if (reach < 0) return null;
  const label = REST_LABELS[span];

  let trackers = 0;
  for (const t of model.trackers || []) {
    const kind = refreshKind(t.refresh);
    if (!kind || REST_SPANS.indexOf(kind) > reach) continue;
    const at = restingPoint(t);
    if ((Number(t.current) || 0) !== at) { t.current = at; trackers++; }
  }

  if (reach >= REST_SPANS.indexOf('day')) {
    const d = model.data;
    // Flowing Power's strain is the one damage only this heals, and the
    // effect and its free rounds end with the day. Before the maximum is
    // read, since the strain is taken off it.
    if (d.hp) d.hp.strain = 0;
    if (d.mythic?.flowing) { d.mythic.flowing.increase = 0; d.mythic.flowing.freeLeft = 0; }
    if (d.hp) {
      d.hp.current = model.hpMax;
      d.hp.temp = 0;
      // The pool a rule grants comes back full too: what was spent of it is
      // play state, and rests with everything else.
      d.hp.tempSpent = 0;
      d.hp.nonlethal = 0;
    }
    // A point of ability damage heals in each ability; drain does not.
    healAbilityDamage(model);
    // What each sub-system gives back with the day: slots, power points,
    // temporary essence, the companions' hit points, the Lifebound piles.
    for (const s of subsystems()) s.newDay?.(model);
  }

  model.recompute();
  emit(model, { type: 'rest', span, trackers });
  return { span, label, trackers };
}
