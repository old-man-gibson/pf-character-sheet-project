/** The look put on a sheet element and its Theme & layout picker
 *  (app/js/sheet/theme.js), over a stand-in element and storage. No DOM.
 *  Run: node tests/sheet-theme.test.mjs */
import { SheetTheme } from '../app/js/sheet/theme.js';
import { THEME_KEY } from '../app/js/themes.js';
import { check, finish } from './check.mjs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

/** An element as far as the theme touches one: attributes, a shadow root, events. */
function fakeElement(attrs = {}) {
  const a = new Map(Object.entries(attrs));
  return {
    events: [],
    shadowRoot: { adoptedStyleSheets: [] },
    hasAttribute: (n) => a.has(n),
    getAttribute: (n) => (a.has(n) ? a.get(n) : null),
    setAttribute: (n, v) => { a.set(n, String(v)); },
    dispatchEvent(e) { this.events.push(e); return true; },
  };
}
function themeOn(el) {
  const host = { el, renders: 0, fits: 0, hasModel: () => true, render: () => { host.renders++; }, fitRail: () => { host.fits++; }, surfacesMoved: () => {} };
  return { host, theme: new SheetTheme(host) };
}
const attrs = (el, ...names) => names.map((n) => el.getAttribute(n));

{
  // Nothing remembered: the host's attributes, or the defaults.
  store.clear();
  const el = fakeElement();
  const { theme } = themeOn(el);
  theme.apply();
  check('a bare element gets the dark theme across the top', attrs(el, 'theme', 'scheme', 'layout'), ['dark', 'dark', 'top']);
  check('and the default card marks', attrs(el, 'action-marks', 'action-tint').every(Boolean), true);
  const host = fakeElement({ theme: 'parchment', layout: 'side' });
  themeOn(host).theme.apply();
  check('a host page\'s own theme stays when nothing is remembered', attrs(host, 'theme', 'scheme', 'layout'), ['parchment', 'light', 'side']);
}

{
  // A choice is remembered, put on, and announced.
  store.clear();
  const el = fakeElement();
  const { host, theme } = themeOn(el);
  theme.apply();
  theme.set({ palette: 'parchment' });
  check('a palette is put on with its scheme', attrs(el, 'theme', 'scheme'), ['parchment', 'light']);
  check('and remembered', JSON.parse(store.get(THEME_KEY)).palette, 'parchment');
  const told = el.events.at(-1);
  check('the host page is told', [told.type, told.detail.theme, told.detail.scheme, told.bubbles, told.composed],
    ['theme-change', 'parchment', 'light', true, true]);
  theme.set({ layout: 'side', width: '80' });
  check('the layout and width change alone', attrs(el, 'theme', 'layout', 'width'), ['parchment', 'side', '80']);
  check('and the rail is measured again', host.fits, 2);
  theme.set({ palette: 'no-such-palette' });
  check('an unknown palette is ignored', el.getAttribute('theme'), 'parchment');

  const later = fakeElement({ theme: 'dark' });
  themeOn(later).theme.apply();
  check('a remembered choice beats the host\'s attribute', attrs(later, 'theme', 'layout', 'width'), ['parchment', 'side', '80']);
}

{
  // The first custom palette starts from the palette on screen.
  store.clear();
  const el = fakeElement();
  const { theme } = themeOn(el);
  theme.apply();
  theme.set({ palette: 'custom' });
  check('custom is put on', el.getAttribute('theme'), 'custom');
  check('with colours taken from the palette before it', Object.keys(theme.pref.custom).sort(), ['accent', 'bg', 'panel', 'text']);
  check('and a scheme that matches them', el.getAttribute('scheme'), 'dark');
  const html = theme.menuHtml();
  check('the picker shows the four colour boxes', (html.match(/data-customcolor=/g) || []).length, 4);
  check('and marks Custom as chosen', /data-palette="custom"\s+aria-pressed="true"/.test(html), true);
}

{
  // The picker marks what is on, and only that.
  store.clear();
  const el = fakeElement();
  const { theme } = themeOn(el);
  theme.apply();
  theme.set({ palette: 'slate', layout: 'side' });
  const html = theme.menuHtml();
  check('one palette card is pressed', (html.match(/aria-pressed="true"/g) || []).length, 1);
  check('the one chosen', /data-palette="slate" data-layout="side"\s+aria-pressed="true"/.test(html), true);
  check('no colour boxes off custom', html.includes('data-customcolor'), false);
  check('the selects show the choice', [/<option value="slate" selected>/.test(html), /<option value="side" selected>/.test(html)], [true, true]);
}

finish();
