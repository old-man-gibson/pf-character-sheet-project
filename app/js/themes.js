/**
 * themes.js -- the page themes: what the sheet can look like, and how a
 * browser remembers which look it chose.
 *
 * A theme is two things chosen together. The *palette* is a set of colours and
 * faces, declared in app/css/sheet.css as one `:host([theme="…"])` block per
 * entry below -- the stylesheet is the only place a colour is written down, and
 * this file only knows the palettes' names and which of them are light. The
 * *layout* is where the tab rail goes: across the top of the sheet, or down
 * its left side the way the Workbench keeps its entries.
 *
 * The two are separate attributes on the element (`theme` and `layout`) so an
 * embedding host can set either without the other, and separate choices in
 * the picker for the same reason. A third, `width`, is how much of its
 * container the sheet takes -- all of it, or a step less -- for a wide screen
 * where a sheet edge to edge is a long way for the eye to travel. The presets are the pairings that were
 * designed together; picking one sets both.
 *
 * The choice is a browser preference, like the roll format: it is not part of
 * any character, and it is remembered in localStorage under one key. The
 * element applies it when it connects and tells the host page in a
 * `theme-change` event, so the page's own chrome -- the picker, the banners --
 * can follow. See docs/embedding.md.
 */

/** Where the choice is kept. One key, one small JSON object. */
export const THEME_KEY = 'character-sheet:theme';

/** The palette that follows the operating system's light/dark setting. */
export const AUTO = 'auto';

/**
 * The palettes, in the order the picker shows them. `scheme` is what the
 * element stamps on itself as the `scheme` attribute, which is what the few
 * rules that care about lightness rather than hue -- a scroll shadow, a
 * hatched meter -- key on. `pair` is the same look on the other scheme, for
 * the one-press switch. `fonts` marks the palettes that read best in the web
 * faces the Workbench loads; without them they fall back to Georgia and the
 * system face, and still work. `swatch` is the strip the picker draws for a
 * palette before it is pressed -- ground, panel, accent, text -- and is the one
 * place outside the stylesheet a colour is repeated; tests/themes.test.mjs
 * holds the two together.
 */
export const PALETTES = [
  {
    id: 'dark', name: 'Midnight', scheme: 'dark', pair: 'light', layout: 'top',
    swatch: ['#14161c', '#1c1f27', '#d4a24a', '#e6e8ef'],
    blurb: 'The sheet as it has always been: gold on slate.',
  },
  {
    id: 'light', name: 'Daylight', scheme: 'light', pair: 'dark', layout: 'top',
    swatch: ['#f4f5f8', '#ffffff', '#8a5f0d', '#1a1d26'],
    blurb: 'The same sheet on white, for a bright room or a projector.',
  },
  {
    id: 'workbench', name: 'Workbench', scheme: 'light', pair: 'workbench-dark', layout: 'side', fonts: true,
    swatch: ['#eef0ec', '#fafaf7', '#8b2b2e', '#1b1f24'],
    blurb: 'The Homebrew Workbench’s look: ivory paper, oxblood headings, a serif for the names.',
  },
  {
    id: 'workbench-dark', name: 'Workbench, dark', scheme: 'dark', pair: 'workbench', layout: 'side', fonts: true,
    swatch: ['#15171b', '#1e2127', '#e27578', '#e4e1da'],
    blurb: 'The Workbench after hours: the same faces on charcoal.',
  },
  {
    id: 'parchment', name: 'Parchment', scheme: 'light', pair: 'dark', layout: 'top', fonts: true,
    swatch: ['#e6dcc3', '#f5ecd9', '#7a3e12', '#2c2416'],
    blurb: 'Sepia and umber, set in a book face, like the rulebook it came out of.',
  },
  {
    id: 'slate', name: 'Slate', scheme: 'dark', pair: 'ink', layout: 'side',
    swatch: ['#0f141a', '#161d25', '#4fc3c9', '#d7e0e8'],
    blurb: 'Cool grey-blue with a teal edge, quiet enough for a long session.',
  },
  {
    id: 'ink', name: 'Ink', scheme: 'light', pair: 'slate', layout: 'top',
    swatch: ['#ffffff', '#ffffff', '#1f3d7a', '#111111'],
    blurb: 'Black on white, hard lines, no washes: the sheet as a printed form.',
  },
];

/** The two places the tab rail can be. */
export const LAYOUTS = [
  { id: 'top', name: 'Tabs across the top', blurb: 'The bar pins under the header as you scroll.' },
  { id: 'side', name: 'Tabs down the side', blurb: 'A rail on the left, like the Workbench. Wide screens only; narrow ones fall back to the bar.' },
];

/**
 * How wide the sheet is, as a share of what it is given: everything, or one
 * of three steps down. The steps are the `width` attribute's values, and the
 * stylesheet has a rule per step.
 */
export const WIDTHS = [
  { id: '100', name: 'Full width' },
  { id: '90', name: '90%' },
  { id: '80', name: '80%' },
  { id: '70', name: '70%' },
];

/** The palettes by id. */
const BY_ID = new Map(PALETTES.map((p) => [p.id, p]));

export function paletteOf(id) { return BY_ID.get(id) ?? null; }

export function isPalette(id) { return id === AUTO || BY_ID.has(id); }

export function isLayout(id) { return LAYOUTS.some((l) => l.id === id); }

export function isWidth(id) { return WIDTHS.some((w) => w.id === String(id)); }

/**
 * The palette `auto` stands for right now. `prefersDark` is the media query's
 * answer; the caller reads it, because this module runs where there is no
 * window to ask.
 */
export function resolvePalette(id, prefersDark = false) {
  if (id === AUTO) return prefersDark ? 'dark' : 'light';
  return BY_ID.has(id) ? id : 'dark';
}

/** `light` or `dark`, for any palette id -- an unknown one counts as dark. */
export function schemeOf(id) { return BY_ID.get(id)?.scheme ?? 'dark'; }

/**
 * The same look on the other scheme, for a single press: Midnight to Daylight,
 * Workbench to Workbench dark, and back. A palette with no partner drawn for
 * it goes to the plain palette of the other scheme.
 */
export function flipped(id) {
  const p = BY_ID.get(id);
  if (p?.pair && BY_ID.has(p.pair)) return p.pair;
  return schemeOf(id) === 'dark' ? 'light' : 'dark';
}

/**
 * A preference object with only known values in it, or null when nothing in
 * `raw` was usable. Any one of the three alone is fine.
 */
export function normalizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (isPalette(raw.palette)) out.palette = raw.palette;
  if (isLayout(raw.layout)) out.layout = raw.layout;
  if (isWidth(raw.width)) out.width = String(raw.width);
  return Object.keys(out).length ? out : null;
}

/** What this browser chose, or null when it never chose. */
export function readThemePrefs(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(THEME_KEY);
    return raw ? normalizePrefs(JSON.parse(raw)) : null;
  } catch { return null; }
}

/** Remember a choice. Nothing usable in it clears the memory instead. */
export function writeThemePrefs(prefs, storage = globalThis.localStorage) {
  const clean = normalizePrefs(prefs);
  try {
    if (clean) storage?.setItem(THEME_KEY, JSON.stringify(clean));
    else storage?.removeItem(THEME_KEY);
  } catch { /* an embed with storage blocked keeps the look for this visit only */ }
  return clean;
}
