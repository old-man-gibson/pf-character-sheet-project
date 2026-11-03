/**
 * sheet/theme.js -- the sheet's look: the palette, the tab rail, the width and
 * the session cards' marks, as this browser remembers them and as the element
 * wears them in its attributes; and the Theme & layout picker.
 *
 * What a palette is lives in themes.js. This is the part that puts one on an
 * element: it reads and writes the element's attributes, keeps the custom
 * palette's stylesheet, follows the system's light/dark setting on `auto`,
 * and tells the host page with a `theme-change` event. It lived in
 * sheet-element.js; tests/sheet-theme.test.mjs drives it with a stand-in element.
 *
 * The host is:
 *   el               the element: its attributes, its shadow root, its events
 *   hasModel()       whether a character is open (a redraw needs one)
 *   render()         redraw the sheet
 *   fitRail()        measure the rail again after the width changed
 *   surfacesMoved()  the custom palette's colours changed under the player colours
 */

import {
  PALETTES, LAYOUTS, WIDTHS, DEFAULT_WIDTH, AUTO, isPalette, isLayout, isWidth, resolvePalette, schemeOf,
  readThemePrefs, writeThemePrefs, CUSTOM, CUSTOM_COLORS, customPalette, customPaletteCss, customFromPalette,
  normalizeCustom, ACTION_MARKS, ACTION_TINTS, DEFAULT_ACTION_MARKS, DEFAULT_ACTION_TINT, isActionMarks, isActionTint,
} from '../themes.js';
import { esc } from '../ui/html.js';

export class SheetTheme {
  constructor(host) { this.host = host; }

  /**
   * What this browser asked for: `{ palette, layout }`, either half optional,
   * or null when it never chose and the attributes are the host's. Kept apart
   * from the attributes because `auto` is a preference and never an attribute:
   * the element resolves it to a palette and writes that.
   */
  pref = null;
  /** The custom palette's rule, adopted after the shared stylesheet; null until a custom palette is first put on. */
  #customSheet = null;
  /** The system's light/dark setting, watched while the preference is `auto`. */
  #schemeQuery = null;

  #attr(name) { return this.host.el.getAttribute(name); }
  #set(name, value) { this.host.el.setAttribute(name, value); }

  /**
   * Put the browser's remembered look on, or leave the host's attributes as
   * they are when nothing was remembered. Runs once, on connect.
   *
   * The preference beats the attribute on purpose: the attribute is what the
   * page's author chose for everyone, the preference is what this person
   * chose for themselves, and the second is the later and more specific word.
   * An embed that must look one way can leave the picker out of reach --
   * the roll format works the same way.
   */
  apply() {
    const el = this.host.el;
    this.pref = readThemePrefs();
    this.#putCustomPalette(this.pref?.custom);
    if (!el.hasAttribute('theme')) this.#set('theme', 'dark');
    if (!el.hasAttribute('layout')) this.#set('layout', 'top');
    if (this.pref?.palette) this.#set('theme', this.resolved());
    if (this.pref?.layout) this.#set('layout', this.pref.layout);
    if (this.pref?.width) this.#set('width', this.pref.width);
    this.#set('action-marks', this.pref?.actionMarks || DEFAULT_ACTION_MARKS);
    this.#set('action-tint', this.pref?.actionTint || DEFAULT_ACTION_TINT);
    // Whatever the theme came from, the scheme has to match it.
    this.#set('scheme', this.schemeOf(this.#attr('theme')));
    if (typeof matchMedia === 'function' && !this.#schemeQuery) {
      this.#schemeQuery = matchMedia('(prefers-color-scheme: dark)');
      this.#schemeQuery.addEventListener('change', this.#onSchemeChange);
    }
  }

  /** The element left the page: stop watching the system's setting. */
  disconnect() {
    this.#schemeQuery?.removeEventListener('change', this.#onSchemeChange);
    this.#schemeQuery = null;
  }

  /** The palette the preference stands for right now (`auto` asks the system). */
  resolved() {
    return resolvePalette(this.pref?.palette, !!this.#schemeQuery?.matches);
  }

  /** `light` or `dark` for a theme; the custom one's comes from its colours. */
  schemeOf(theme) {
    return schemeOf(theme, this.pref?.custom);
  }

  /**
   * Put the custom palette's rule in the element's own stylesheet, adopted
   * after the shared one so it is there for `theme="custom"`. Replaced whole on
   * each change. The surface player colours are measured against is read again.
   */
  #putCustomPalette(colors) {
    const css = customPaletteCss(colors);
    if (!this.#customSheet) {
      if (!css || typeof CSSStyleSheet === 'undefined') return;
      const root = this.host.el.shadowRoot;
      this.#customSheet = new CSSStyleSheet();
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.#customSheet];
    }
    this.#customSheet.replaceSync(css);
    this.host.surfacesMoved();
  }

  /** The custom colours as the picker holds them, for a preview while one is dragged. */
  previewCustom(colors) {
    if (!customPalette(colors)) return;
    this.#putCustomPalette(colors);
    this.#set('scheme', schemeOf(CUSTOM, colors));
  }

  /** The system flipped its setting; only a sheet on `auto` follows it. */
  #onSchemeChange = () => {
    if (this.pref?.palette !== AUTO) return;
    this.#set('theme', this.resolved());
    this.announce();
  };

  /**
   * Choose a look. Either half may be left out to keep what is there; the
   * choice is remembered for this browser, put on the element, and told to
   * the host page as a `theme-change` event so the page's own chrome can
   * follow the sheet.
   */
  set({ palette, layout, width, actionMarks, actionTint, custom } = {}) {
    const next = { ...(this.pref || {}) };
    const before = this.#attr('theme');
    if (isPalette(palette)) next.palette = palette;
    if (isLayout(layout)) next.layout = layout;
    if (isWidth(width)) next.width = String(width);
    if (isActionMarks(actionMarks)) next.actionMarks = actionMarks;
    if (isActionTint(actionTint)) next.actionTint = actionTint;
    if (normalizeCustom(custom)) next.custom = normalizeCustom(custom);
    // The first custom palette starts from the palette on screen.
    if (next.palette === CUSTOM && !next.custom) next.custom = customFromPalette(before) || customFromPalette('dark');
    this.pref = writeThemePrefs(next) || next;
    this.#putCustomPalette(this.pref.custom);
    if (next.palette) this.#set('theme', this.resolved());
    // New custom colours can change the scheme without changing the theme.
    this.#set('scheme', this.schemeOf(this.#attr('theme')));
    // A theme change re-renders; new custom colours on the same theme have to
    // ask, so player colours are measured against the new surfaces.
    if (custom && before === CUSTOM && this.#attr('theme') === CUSTOM && this.host.hasModel()) this.host.render();
    if (next.layout) this.#set('layout', next.layout);
    if (next.width) this.#set('width', next.width);
    if (next.actionMarks) this.#set('action-marks', next.actionMarks);
    if (next.actionTint) this.#set('action-tint', next.actionTint);
    // The rail's height follows the sheet's edges; a narrower sheet is not a
    // re-render, so it is measured here.
    this.host.fitRail();
    this.announce();
  }

  announce() {
    this.host.el.dispatchEvent(new CustomEvent('theme-change', {
      bubbles: true,
      composed: true,
      detail: {
        palette: this.pref?.palette ?? this.#attr('theme'),
        theme: this.#attr('theme'),
        scheme: this.#attr('scheme'),
        layout: this.#attr('layout'),
        width: this.#attr('width') || DEFAULT_WIDTH,
      },
    }));
  }

  /**
   * The picker. A card per palette -- its four colours as a strip, its name,
   * a line on what it is for -- and under them the two halves separately, for
   * putting one palette with the other rail. Pressing a card sets both halves
   * to what that palette was designed with; the selects change one.
   */
  menuHtml() {
    const theme = this.#attr('theme');
    const pref = this.pref?.palette ?? theme;
    const layout = this.#attr('layout') || 'top';
    const width = this.#attr('width') || DEFAULT_WIDTH;
    const marks = this.#attr('action-marks') || DEFAULT_ACTION_MARKS;
    const tint = this.#attr('action-tint') || DEFAULT_ACTION_TINT;
    const card = (p) => `
        <button type="button" class="preset" data-action="set-theme"
          data-palette="${p.id}" data-layout="${p.layout}"
          aria-pressed="${pref === p.id && layout === p.layout}"
          title="${esc(p.name)}: ${p.layout === 'side' ? 'tabs down the side' : 'tabs across the top'}">
          <span class="swatches" aria-hidden="true">${p.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="pname">${esc(p.name)}<small>${p.layout === 'side' ? 'side rail' : 'top bar'}</small></span>
          <span class="pblurb">${esc(p.blurb)}</span>
        </button>`;
    const opt = (id, name, on) => `<option value="${id}"${on ? ' selected' : ''}>${esc(name)}</option>`;
    // The custom card shows the saved custom colours, or the palette on
    // screen when there are none yet, since that is where a first one starts.
    const custom = this.pref?.custom || customFromPalette(theme) || customFromPalette('dark');
    const customCard = `
        <button type="button" class="preset" data-action="set-theme" data-palette="${CUSTOM}"
          aria-pressed="${pref === CUSTOM}" title="Custom: your own colours">
          <span class="swatches" aria-hidden="true">${customPalette(custom).swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="pname">Custom</span>
          <span class="pblurb">Pick your own background, panel, text and accent colours.</span>
        </button>`;
    const picks = pref !== CUSTOM ? '' : `
        <div class="mix custompicks" role="group" aria-label="Custom colours">
          ${CUSTOM_COLORS.map((c) => `<label>${esc(c.name)}
            <input type="color" data-customcolor="${c.id}" value="${custom[c.id]}"></label>`).join('')}
          <p class="hint">Colours are made lighter or darker where needed so text stays readable.</p>
        </div>`;
    return `<section class="panel thememenu" aria-label="Theme and layout">
        <h3>Theme &amp; layout</h3>
        <div class="presets">${PALETTES.map(card).join('')}${customCard}</div>
        ${picks}
        <div class="mix">
          <label>Palette
            <select data-themepick="palette" aria-label="Palette">
              ${opt(AUTO, 'Follow the system (light / dark)', pref === AUTO)}
              ${PALETTES.map((p) => opt(p.id, p.name, pref === p.id)).join('')}
              ${opt(CUSTOM, 'Custom', pref === CUSTOM)}
            </select>
          </label>
          <label>Tabs
            <select data-themepick="layout" aria-label="Where the tabs go">
              ${LAYOUTS.map((l) => opt(l.id, l.name, layout === l.id)).join('')}
            </select>
          </label>
          <label>Width
            <select data-themepick="width" aria-label="How wide the sheet is">
              ${WIDTHS.map((w) => opt(w.id, w.name, width === w.id)).join('')}
            </select>
          </label>
          <label>Action cards
            <select data-themepick="actionMarks" aria-label="How a session card shows its action type">
              ${ACTION_MARKS.map((m) => opt(m.id, m.name, marks === m.id)).join('')}
            </select>
          </label>
          <label>Card colour
            <select data-themepick="actionTint" aria-label="How much of a session card takes its action's colour">
              ${ACTION_TINTS.map((t) => opt(t.id, t.name, tint === t.id)).join('')}
            </select>
          </label>
          <button type="button" class="close" data-action="theme-close">Done</button>
        </div>
        <p class="hint">Remembered in this browser, for every character. The side rail needs a wide window
          and falls back to the bar on a narrow one. Action cards can show their type as a tag, as colour,
          both or neither. The colour can be a left edge or a wash across the card.</p>
      </section>`;
  }
}
