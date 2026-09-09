/**
 * What the <character-sheet> element needs from the monster tool, in one
 * import.
 *
 * The element keeps its hooks to single lines -- a tab entry, a panel case,
 * a menu button, an action, a header -- and everything they do lives here,
 * so that the main sheet can change around this feature without the two
 * meeting in a merge. See docs/monsters.md for the feature itself.
 */
import { esc, val } from '../ui/html.js';
import { emptyMonster } from './block.js';

export { renderStatBlockPanel } from './panel.js';

/** The tab, as the element's TABS list writes one. */
export const MONSTER_TAB = ['statblock', 'Stat Block'];

/** The ⋯ menu's entry: for a GM on any sheet, and for anyone on a monster. */
export function menuButton(model, isAdmin) {
  if (!isAdmin && !model?.data?.monster) return '';
  return `<button data-action="statblock" title="This sheet as a Bestiary prints one: every number worked out now">Stat block</button>`;
}

/**
 * The header's second line for a monster -- CR, XP, hit dice, type -- or an
 * empty string for a character, which keeps its own.
 */
export function headerSubtitle(model) {
  const c = model?.data;
  const m = c?.monster;
  if (!m) return '';
  const i = c.identity;
  const xp = m.xp != null ? ` &middot; XP ${esc(String(m.xp).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}` : '';
  return `<div class="subtitle">
            CR ${val(m.cr)}${xp}
            &middot; ${val(i.level)} HD ${esc(i.size || '')} ${val(i.race)}
            ${i.alignment ? ` &middot; ${esc(i.alignment)}` : ''}
          </div>`;
}

/**
 * The actions the Stat Block tab raises that touch the document. `true`
 * when one was handled, so the element knows to redraw; the tab-opening
 * action stays with the element, because only it can move a tab.
 *
 * A block put on a character keeps the Automatic Bonus Progression on,
 * because the character had it; taking the block off deletes the key rather
 * than nulling it, since its absence is what says "character".
 */
export function handleAction(model, name) {
  if (name === 'monster-block') {
    model.set('monster', { ...emptyMonster(), abp: true });
    return true;
  }
  if (name === 'monster-unblock') {
    delete model.data.monster;
    model.recompute();
    return true;
  }
  return false;
}
