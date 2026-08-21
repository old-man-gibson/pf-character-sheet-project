/**
 * ui/roll.js -- the d20 that sits beside a row.
 *
 * One click puts that row's roll on the clipboard in Roll20's syntax. The
 * button only needs the model to work out what the roll *is*; everything after
 * the click -- the copy, the toast that shows what was copied, the switch
 * between the two Roll20 shapes -- is the element's, and stays there.
 */
import { esc } from './html.js';
import { rollSpec } from '../roll20.js';

const D20_ICON = '<svg class="d20icon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
  + '<path d="M50 4 93 28v44L50 96 7 72V28z"/>'
  + '<path d="M50 30 74 70H26z"/>'
  + '<path d="M50 30V4M74 70l19 2M26 70 7 72"/>'
  + '</svg>';

/**
 * The d20 beside a row.
 *
 * `cs` is the condition state the roll is read under; passed in where the
 * caller has already worked it out for a whole table, since asking the model
 * once per row is the expensive way to get the same answer.
 */
export function rollButton(model, kind, ref, what, cs = null) {
  const spec = rollSpec(model.data, kind, ref, cs ?? model.conditionState);
  if (!spec) return '';
  const shown = spec.rolls.slice(0, 3).map((r) => r.formula).join(' · ')
    + (spec.rolls.length > 3 ? ' …' : '');
  return `<button class="d20" data-roll="${esc(kind)}|${esc(String(ref))}" data-rollwhat="${esc(what)}"
      title="${esc(`Copy for Roll20 — ${shown}`)}"
      aria-label="${esc(`Copy a Roll20 roll for ${what}`)}">${D20_ICON}</button>`;
}

export { D20_ICON };
