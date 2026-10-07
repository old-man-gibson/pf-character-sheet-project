/**
 * ui/folds.js -- folding a block down to its heading, and opening it again.
 *
 * Every fold the character keeps is stored the same way, in
 * `uiPrefs.collapsed` under a key the panel chooses, and drawn by the one
 * button below. The element's click handler stores `data-collapse-to` as it
 * stands; the button works that value out, from what is on screen and from
 * which way its key reads, so the handler never has to know either.
 *
 * Which way a key reads: `true` means folded -- except under three families
 * the sheet has saved the other way round since they were added, where `true`
 * means open or shown: the dashboard cards' Expand (`dash:*`), the veil
 * slots' Show empty (`veil:showEmpty`) and Vancian's second casting statistic
 * (`vstat2:*`). Turning them over would flip every one already saved, so they
 * are declared here instead, once, and anything that reads or writes a fold
 * goes through `isOpen` and `foldValue` rather than taking `true` for folded.
 *
 * Every fold button carries `data-view`: it changes how the sheet is looked
 * at and nothing in the character, which is what a published sheet keeps
 * working (READERS_KEEP in sheet-element.js).
 */
import { esc } from '../html-escape.js';

const OPEN_KEYS = /^(?:dash:|veil:showEmpty$|vstat2:)/;

/** Whether `key` stores open (`true` = open) rather than folded (`true` = folded). */
export const storesOpen = (key) => OPEN_KEYS.test(String(key));

/** What to store under `key` for it to read as `open`. */
export const foldValue = (key, open) => (storesOpen(key) ? !!open : !open);

/**
 * Whether `key` is open now: what was stored, or `openByDefault` while nothing
 * has been. A block may want to start folded in one situation and open in
 * another -- the practitioner table is controls while it is what the
 * character uses and reference once a class progression takes over -- so the
 * default decides only until the first click, whose choice is stored and
 * outranks it from then on.
 */
export function isOpen(model, key, openByDefault = true) {
  const stored = model?.data?.uiPrefs?.collapsed?.[key];
  if (stored === undefined) return !!openByDefault;
  return storesOpen(key) ? !!stored : !stored;
}

/** The same question the other way up, for the callers that ask it so. */
export const isCollapsed = (model, key, fallback = false) => !isOpen(model, key, !fallback);

/**
 * The button that folds whatever `key` names.
 *
 * Pass `open` whenever the caller draws a default of its own, so that the
 * first click on a block folded by default opens it, rather than storing the
 * fold it is already showing. Escaped here, key and hover both, because a
 * fold key is not always ours: `progfeat-${name}` builds one out of a feature
 * group's name, which is workbook text, and `dataset.collapse` hands the click
 * handler back the exact key that went in.
 *
 * @param model         the character (only read when `open` is not given)
 * @param key           the fold's key in `uiPrefs.collapsed`
 * @param opts.open     whether it is open as drawn
 * @param opts.cls      the button's class ('disclose' for a caret beside a label)
 * @param opts.title    the hover; '' for none (default: Expand / Minimize)
 * @param opts.text     markup in place of the ▸/▾, escaped by the caller
 * @param opts.pressed  a toggle that shows something (aria-pressed), not a
 *                      disclosure (aria-expanded)
 * @param opts.attrs    any other attributes, as given
 */
export function foldButton(model, key, {
  open = null, cls = '', title = null, text = null, pressed = false, attrs = '',
} = {}) {
  const now = open === null ? isOpen(model, key) : !!open;
  const hover = title ?? (now ? 'Minimize' : 'Expand');
  return `<button${cls ? ` class="${cls}"` : ''} data-view data-collapse="${esc(key)}" data-collapse-to="${
    foldValue(key, !now)}"${attrs ? ` ${attrs}` : ''}${hover ? `
    title="${esc(hover)}"` : ''}
    ${pressed ? 'aria-pressed' : 'aria-expanded'}="${now}">${text ?? (now ? '▾' : '▸')}</button>`;
}
