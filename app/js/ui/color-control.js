/**
 * ui/color-control.js -- choosing a colour: a row of swatches, a hex box and
 * the native picker.
 *
 * The character's colour, a tab's colour and each colour in a tracker's style
 * are all chosen with these same three controls, drawn here and kept in step
 * by one binder in the element (`#bindColors`): whichever of the three is
 * used moves the other two, and the element's `#colorSetter(key)` says where
 * the colour goes. `key` is what ties them together -- 'character', 'tab', or
 * 'tstyle:<field>' -- so two controls for the same thing follow each other as
 * well: the Details panel's character colour and the roster's colour panel
 * are both 'character'.
 */
import { esc } from '../html-escape.js';
import { THEME_ACCENT, TRACKER_PALETTE, normalizeHex } from '../tracker-style.js';

/**
 * @param key            what the colour is for: 'character', 'tab', 'tstyle:fill'…
 * @param value          the colour now, or blank for none
 * @param opts.label     what the control is called, for a screen reader
 * @param opts.none      what the swatch for no colour is called
 * @param opts.noneCss   what that swatch shows, when it shows something
 * @param opts.fallback  what the native picker holds while there is no colour
 * @param opts.pair      put the hex box and the picker on a line of their own
 */
export function colorControl(key, value, {
  label = 'Colour', none = 'Theme default', noneCss = '', fallback = THEME_ACCENT.hex, pair = false,
} = {}) {
  const hex = normalizeHex(value);
  const k = esc(key);
  const swatch = (h, name) => `<button class="swatch${h ? '' : ' none'}" data-colorswatch="${k}" data-hex="${h}"${
    h ? ` style="background:${h}"` : noneCss ? ` style="background:${noneCss}"` : ''}
          title="${esc(h ? `${name} ${h}` : none)}" aria-label="${esc(h ? name : none)}" aria-pressed="${(hex || '') === h}"></button>`;
  const inputs = `<input class="mono hexin" data-colorhex="${k}" value="${esc(hex || '')}" placeholder="#rrggbb"
        maxlength="7" aria-label="${esc(label)} hex">
      <input type="color" data-colorpick="${k}" data-fallback="${esc(fallback)}" value="${esc(hex || fallback)}"
        aria-label="${esc(label)} picker">`;
  return `<div class="swatches" role="group" aria-label="${esc(label)}">
        ${swatch('', '')}
        ${TRACKER_PALETTE.map(([h, name]) => swatch(h, name)).join('')}
      </div>
      ${pair ? `<div class="pair">${inputs}</div>` : inputs}`;
}
