/**
 * themes.js -- the page themes: what the sheet can look like, and how a
 * browser remembers which look it chose.
 *
 * A theme is two things chosen together. The *palette* is a set of colours and
 * faces, declared in app/css/sheet.css as one `:host([theme="…"])` block per
 * entry below -- the stylesheet is the only place a colour is written down, and
 * this file only knows the palettes' names and which of them are light. The
 * exception is the custom palette at the foot of the file, which is worked out
 * from four colours the player picks and starts from Midnight's and Daylight's. The
 * *layout* is where the tab rail goes: across the top of the sheet, or down
 * its left side the way the Workbench keeps its entries.
 *
 * The two are separate attributes on the element (`theme` and `layout`) so an
 * embedding host can set either without the other, and separate choices in
 * the picker for the same reason. A third, `width`, is how much of its
 * container the sheet takes -- a column on a large monitor, all of it, or a
 * step less -- for a wide screen where a sheet edge to edge is a long way for
 * the eye to travel. The presets are the pairings that were
 * designed together; picking one sets both.
 *
 * The choice is a browser preference, like the roll format: it is not part of
 * any character, and it is remembered in localStorage under one key. The
 * element applies it when it connects and tells the host page in a
 * `theme-change` event, so the page's own chrome -- the picker, the banners --
 * can follow. See docs/embedding.md.
 */

import { normalizeHex, hexToRgb, mixHex, rgba, luminance, readableOn } from './tracker-style.js';

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
 * How wide the sheet is. Standard, the default, keeps its contents to a
 * 90rem (1440px) column on a large monitor and uses the whole of a smaller
 * screen. The others are a share of what the sheet is given, on any screen:
 * all of it, edge to edge, or one of three steps down. The ids are the
 * `width` attribute's values (no attribute is Standard), and the stylesheet
 * has a rule per share.
 */
export const DEFAULT_WIDTH = 'standard';
export const WIDTHS = [
  { id: DEFAULT_WIDTH, name: 'Standard (at most 1440px)' },
  { id: '100', name: 'Full width' },
  { id: '90', name: '90%' },
  { id: '80', name: '80%' },
  { id: '70', name: '70%' },
];

/**
 * How a session card shows its action type: the tag beside its drag handle,
 * the colour on the card, both, or neither -- and, when the card is coloured,
 * how much of it: a left edge, a gentle wash, or a strong one.
 */
export const ACTION_MARKS = [
  { id: 'both', name: 'Tag and colour' },
  { id: 'tag', name: 'Tag only' },
  { id: 'colour', name: 'Colour only' },
  { id: 'none', name: 'Neither' },
];
export const ACTION_TINTS = [
  { id: 'edge', name: 'Left edge' },
  { id: 'gentle', name: 'Gentle wash' },
  { id: 'intense', name: 'Strong wash' },
];
export const DEFAULT_ACTION_MARKS = 'both';
export const DEFAULT_ACTION_TINT = 'edge';

/** The palettes by id. */
const BY_ID = new Map(PALETTES.map((p) => [p.id, p]));

export function paletteOf(id) { return BY_ID.get(id) ?? null; }

export function isPalette(id) { return id === AUTO || id === CUSTOM || BY_ID.has(id); }

export function isLayout(id) { return LAYOUTS.some((l) => l.id === id); }

export function isWidth(id) { return WIDTHS.some((w) => w.id === String(id)); }

export function isActionMarks(id) { return ACTION_MARKS.some((m) => m.id === id); }

export function isActionTint(id) { return ACTION_TINTS.some((t) => t.id === id); }

/**
 * The palette `auto` stands for right now. `prefersDark` is the media query's
 * answer; the caller reads it, because this module runs where there is no
 * window to ask.
 */
export function resolvePalette(id, prefersDark = false) {
  if (id === AUTO) return prefersDark ? 'dark' : 'light';
  if (id === CUSTOM) return CUSTOM;
  return BY_ID.has(id) ? id : 'dark';
}

/**
 * `light` or `dark`, for any palette id -- an unknown one counts as dark. The
 * custom palette's scheme comes from its colours, passed as `custom`.
 */
export function schemeOf(id, custom = null) {
  if (id === CUSTOM) return customPalette(custom)?.scheme ?? 'dark';
  return BY_ID.get(id)?.scheme ?? 'dark';
}

/**
 * The same look on the other scheme, for a single press: Midnight to Daylight,
 * Workbench to Workbench dark, and back. A palette with no partner drawn for
 * it, the custom one included, goes to the plain palette of the other scheme.
 */
export function flipped(id, custom = null) {
  const p = BY_ID.get(id);
  if (p?.pair && BY_ID.has(p.pair)) return p.pair;
  return schemeOf(id, custom) === 'dark' ? 'light' : 'dark';
}

/* ---------------- the custom palette ---------------- */

/**
 * A palette the player makes from four colours. The rest of the set the
 * built-in blocks declare is worked out from them: the second panel shade and
 * the lines from the panel, muted text from the text, the washes from the
 * accent, and the state and formula inks from Midnight's or Daylight's,
 * whichever scheme the background falls on.
 *
 * Every colour that is read as text is moved with `readableOn` until it clears
 * 4.5:1 on all three surfaces, the bar the built-in palettes are held to. For
 * that to be possible the surfaces are kept to the dark or pale end of their
 * scheme: a mid-grey ground has no text colour that reads well on it.
 *
 * The picks are kept as they were chosen; this runs each time the palette is
 * put on, so a better derivation later changes no saved preference.
 */
export const CUSTOM = 'custom';

/** The four picks, in the order the picker shows them. */
export const CUSTOM_COLORS = [
  { id: 'bg', name: 'Background' },
  { id: 'panel', name: 'Panels' },
  { id: 'text', name: 'Text' },
  { id: 'accent', name: 'Accent' },
];

/**
 * What each scheme starts the derived colours from: Midnight's and Daylight's
 * values in app/css/sheet.css (tests/themes.test.mjs holds them together), and
 * the alphas those blocks use for the accent washes and the bracket match.
 */
export const SCHEME_BASE = {
  dark: {
    edit: '#6ea8fe', good: '#6bbf7b', bad: '#e0635f', even: '#7fb3f5',
    number: '#8fcf9d', string: '#c9a3e0', nest0: '#7fb7c9', nest1: '#d99ac0',
    soft: 0.14, formula: 0.40, strong: 0.85, match: 0.34, matchBad: 0.30,
    wash: '15%', edge: '55%', ink: '30%',
  },
  light: {
    edit: '#2563c9', good: '#1a6b2c', bad: '#a32320', even: '#1d5db8',
    number: '#1f7a43', string: '#6b3fa0', nest0: '#226b82', nest1: '#99306f',
    soft: 0.12, formula: 0.38, strong: 0.80, match: 0.24, matchBad: 0.22,
    wash: '38%', edge: '72%', ink: '66%',
  },
};

/** Luminance limits for a surface: at most this on a dark scheme, at least this on a light one. */
const DARK_SURFACE_MAX = 0.06;
const LIGHT_SURFACE_MIN = 0.45;

/** A surface moved towards black or white, in 4% steps, until it is inside its scheme's limit. */
function surfaceFor(hex, scheme) {
  const fits = (h) => {
    const l = luminance(hexToRgb(h));
    return scheme === 'dark' ? l <= DARK_SURFACE_MAX : l >= LIGHT_SURFACE_MIN;
  };
  const towards = scheme === 'dark' ? '#000000' : '#ffffff';
  for (let t = 0; t < 1; t += 0.04) {
    const step = mixHex(hex, towards, t);
    if (fits(step)) return step;
  }
  return towards;
}

/**
 * A text colour that clears 4.5:1 on every surface. The surfaces are all on
 * one side of the scheme, so each `readableOn` moves the colour the same way
 * and a few passes settle it.
 */
function readableOnAll(hex, surfaces) {
  let out = hex;
  for (let pass = 0; pass < 3; pass++) for (const s of surfaces) out = readableOn(out, s);
  return out;
}

/** The four picks as lower-case `#rrggbb`, or null when any is missing or not a colour. */
export function normalizeCustom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const { id } of CUSTOM_COLORS) {
    const hex = normalizeHex(raw[id]);
    if (!hex) return null;
    out[id] = hex;
  }
  return out;
}

/** A built-in palette's four colours as custom picks, to start a custom palette from. */
export function customFromPalette(id) {
  const s = BY_ID.get(id)?.swatch;
  return s ? normalizeCustom({ bg: s[0], panel: s[1], accent: s[2], text: s[3] }) : null;
}

/**
 * The whole palette for four picks: `scheme`, the picker's `swatch` (ground,
 * panel, accent, text, as shown), and `vars`, the declarations. Null when the
 * picks are not four colours.
 */
export function customPalette(colors) {
  const c = normalizeCustom(colors);
  if (!c) return null;
  const scheme = luminance(hexToRgb(c.bg)) > 0.179 ? 'light' : 'dark';
  const base = SCHEME_BASE[scheme];
  const bg = surfaceFor(c.bg, scheme);
  const panel = surfaceFor(c.panel, scheme);
  const panel2 = surfaceFor(mixHex(panel, scheme === 'dark' ? '#ffffff' : '#000000', 0.05), scheme);
  const ink = (hex) => readableOnAll(hex, [bg, panel, panel2]);
  const text = ink(c.text);
  const accent = ink(c.accent);
  const edit = ink(base.edit);
  const bad = ink(base.bad);
  return {
    scheme,
    swatch: [bg, panel, accent, text],
    vars: {
      'color-scheme': scheme,
      '--cs-bg': bg,
      '--cs-panel': panel,
      '--cs-panel-2': panel2,
      '--cs-line': mixHex(panel, text, 0.15),
      '--cs-text': text,
      '--cs-muted': ink(mixHex(text, panel, 0.35)),
      '--cs-accent': accent,
      '--cs-accent-soft': rgba(c.accent, base.soft),
      '--cs-formula': rgba(c.accent, base.formula),
      '--cs-formula-strong': rgba(c.accent, base.strong),
      '--cs-edit': edit,
      '--cs-good': ink(base.good),
      '--cs-bad': bad,
      '--cs-even': ink(base.even),
      '--fx-number': ink(base.number),
      '--fx-string': ink(base.string),
      '--fx-nest-0': ink(base.nest0),
      '--fx-nest-1': ink(base.nest1),
      '--fx-nest-2': 'var(--cs-text)',
      '--fx-match': rgba(edit, base.match),
      '--fx-match-bad': rgba(bad, base.matchBad),
      '--ab-wash': base.wash,
      '--ab-edge': base.edge,
      '--ab-ink': base.ink,
    },
  };
}

/** The custom palette as a `:host([theme="custom"])` rule, or '' for picks that are not four colours. */
export function customPaletteCss(colors) {
  const p = customPalette(colors);
  if (!p) return '';
  const lines = Object.entries(p.vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:host([theme="${CUSTOM}"]) {\n${lines}\n}`;
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
  if (isActionMarks(raw.actionMarks)) out.actionMarks = raw.actionMarks;
  if (isActionTint(raw.actionTint)) out.actionTint = raw.actionTint;
  const custom = normalizeCustom(raw.custom);
  if (custom) out.custom = custom;
  // The custom palette with no colours to make it from is not a choice.
  if (out.palette === CUSTOM && !custom) delete out.palette;
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
