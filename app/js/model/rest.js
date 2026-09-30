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

import { COMPANION_KINDS } from '../companions.js';
import { emit } from './events.js';

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
    if (d.hp) {
      d.hp.current = model.hpMax;
      d.hp.temp = 0;
      // The pool a rule grants comes back full too: what was spent of it is
      // play state, and rests with everything else.
      d.hp.tempSpent = 0;
      d.hp.nonlethal = 0;
    }
    for (const c of d.vancian?.classes || []) for (const s of c.spells || []) s.used = 0;
    for (const p of d.vancian?.prepared || []) p.used = 0;
    if (d.psionics) d.psionics.spent = 0;
    if (d.akashic?.essence) d.akashic.essence.spTemp = 0;
    for (const kind of COMPANION_KINDS) {
      for (const b of d[kind] || []) b.hp = { ...(b.hp || {}), damage: 0, temp: 0 };
    }
    // Lifebound Deck: "When you rest to regain spell points, remove all cards
    // from your Stun, Death, and Wounds piles." They are in the deck again at
    // the next shuffle.
    const table = d.cardcasting?.table;
    if (table) for (const pile of ['stun', 'wounds', 'death']) table[pile] = [];
  }

  model.recompute();
  emit(model, { type: 'rest', span, trackers });
  return { span, label, trackers };
}
