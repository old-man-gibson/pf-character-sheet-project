/**
 * ui/html.js -- the primitives every piece of rendered markup is built from.
 *
 * Escaping, the em dash a missing value shows as, and the `data-ab` hook that
 * colours anything naming an ability. They live here rather than in
 * sheet-element.js because the panel modules need them too, and a control
 * builder that cannot escape a string is not much of a control builder.
 *
 * Nothing in this file knows about the character or the element: give it a
 * value, it gives you a string.
 */
import { ABILITIES, ABILITY_LABELS } from '../rules.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** A value as a cell shows it: an em dash where there is nothing to show. */
export const val = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));

/** The six abilities as the pick selectors label them. */
export const ABILITY_LABELS_LIST = ABILITIES.map((k) => ABILITY_LABELS[k]);

/** The ability a value names ('Str' -> 'str'), or '' if it names none. */
export const abilityKey = (value) => {
  const k = String(value ?? '').trim().toLowerCase();
  return ABILITIES.includes(k) ? k : '';
};

/**
 * Is this list of choices abilities -- all six, or one track's three?
 *
 * Asked of the options rather than declared at each of the two dozen call
 * sites, because an ability slot goes by a different name at nearly every one
 * (a save's stat, a weapon's damage ability, a card's suit) while the choices
 * are always these. So a slot written tomorrow is coloured the day it lands.
 */
export const picksAbility = (values) => values.length > 1 && values.every((v) => abilityKey(v));

/**
 * The hook a dropdown and its options hang their colour on; see "ability
 * colour coding" in the stylesheet. It stays on a picker with nothing picked,
 * empty, so the change handler has something to find and repaint.
 */
export const abAttr = (on, value) => (on ? ` data-ab="${abilityKey(value)}"` : '');

/**
 * The same hook where the caller knows the ability rather than the value
 * naming it -- an attack mode is called "Alt Melee", and which stat it runs
 * on is a fact about the character rather than about the word.
 */
export const abKeyAttr = (key) => ` data-ab="${abilityKey(key)}"`;

export const EXPR_HINT = 'Formulas work here: write an expression (level * 100, 3 + con.mod) '
  + 'instead of a number.';
