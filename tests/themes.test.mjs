/** The page themes: the palettes in app/css/sheet.css, the names in
 *  app/js/themes.js, and the preference that ties them to a browser.
 *
 *  Three things are held together here. Every palette themes.js names has a
 *  `:host([theme="…"])` block in the stylesheet that redefines the whole set
 *  the light theme does -- a palette that forgot `--cs-bad` would show the
 *  dark theme's pastel on its own pale panel, and nothing else would notice.
 *  Every text-on-surface pairing in each block clears 4.5:1, measured with the
 *  same contrastRatio the sheet uses to correct a character's colour. And the
 *  swatch the picker draws for a palette is the palette's own ground, panel,
 *  accent and text, not a memory of them.
 *
 *  The stylesheet is read as text and the blocks parsed with a regular
 *  expression: there is no CSS engine in Node, and a palette block is flat
 *  enough -- one property per line -- that one is not needed.
 *
 *  Run: node tests/themes.test.mjs */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PALETTES, LAYOUTS, WIDTHS, AUTO, THEME_KEY, paletteOf, isPalette, isLayout, isWidth, resolvePalette,
  schemeOf, flipped, normalizePrefs, readThemePrefs, writeThemePrefs,
} from '../app/js/themes.js';
import { contrastRatio, normalizeHex } from '../app/js/tracker-style.js';
import { paletteRules } from '../app/js/theme-css.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, actual) => check(label, !!actual, true);

const css = fs.readFileSync(fileURLToPath(new URL('../app/css/sheet.css', import.meta.url)), 'utf8');

/** The declarations of one `:host([theme="id"])` block, as a name → value map. */
function paletteBlock(id) {
  const m = css.match(new RegExp(`:host\\(\\[theme="${id}"\\]\\)\\s*\\{([^}]*)\\}`));
  if (!m) return null;
  const out = {};
  for (const line of m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const [k, ...rest] = line.split(':');
    if (k && rest.length) out[k.trim()] = rest.join(':').trim();
  }
  return out;
}

/* ----- every palette is declared, in full ----- */
const REQUIRED = [
  'color-scheme', '--cs-bg', '--cs-panel', '--cs-panel-2', '--cs-line', '--cs-text', '--cs-muted',
  '--cs-accent', '--cs-accent-soft', '--cs-formula', '--cs-formula-strong', '--cs-edit',
  '--cs-good', '--cs-bad', '--fx-number', '--fx-string', '--fx-nest-0', '--fx-nest-1',
  '--fx-match', '--fx-match-bad', '--ab-wash', '--ab-edge', '--ab-ink',
];
const blocks = {};
for (const p of PALETTES) {
  const block = p.id === 'dark' ? null : paletteBlock(p.id);
  if (p.id === 'dark') {
    // The default palette is the :host block itself, which declares far more;
    // it is the baseline the others are measured against below.
    const m = css.match(/:host \{([\s\S]*?)\n\}/);
    const out = {};
    for (const line of m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
      const [k, ...rest] = line.split(':');
      if (k && rest.length) out[k.trim()] = rest.join(':').trim();
    }
    blocks[p.id] = out;
    continue;
  }
  ok(`${p.id}: has a :host([theme]) block`, block);
  if (!block) continue;
  blocks[p.id] = block;
  const missing = REQUIRED.filter((k) => !(k in block));
  check(`${p.id}: declares the full set`, missing, []);
  check(`${p.id}: color-scheme matches its scheme`, block['color-scheme'], p.scheme);
}

/* ----- every pairing that is read as text clears 4.5:1 ----- */
const PAIRS = [
  ['--cs-text', '--cs-bg'], ['--cs-text', '--cs-panel'], ['--cs-text', '--cs-panel-2'],
  ['--cs-muted', '--cs-panel'], ['--cs-muted', '--cs-panel-2'],
  ['--cs-accent', '--cs-panel'], ['--cs-accent', '--cs-panel-2'],
  ['--cs-edit', '--cs-panel-2'],
  ['--cs-good', '--cs-panel'], ['--cs-bad', '--cs-panel'],
];
for (const p of PALETTES) {
  const b = blocks[p.id];
  if (!b) continue;
  for (const [fg, bg] of PAIRS) {
    const a = normalizeHex(b[fg]);
    const c = normalizeHex(b[bg]);
    ok(`${p.id}: ${fg} and ${bg} are plain hex`, a && c);
    if (!a || !c) continue;
    const ratio = contrastRatio(a, c);
    ok(`${p.id}: ${fg} on ${bg} clears 4.5:1 (${ratio.toFixed(2)})`, ratio >= 4.5);
  }
}

/* ----- the picker's swatch is the palette, not a memory of it ----- */
for (const p of PALETTES) {
  const b = blocks[p.id];
  if (!b) continue;
  check(`${p.id}: swatch is ground, panel, accent, text`,
    p.swatch.map((c) => normalizeHex(c)),
    ['--cs-bg', '--cs-panel', '--cs-accent', '--cs-text'].map((k) => normalizeHex(b[k])));
}

/* ----- nothing still keys on theme="light" for lightness ----- */
check('lightness rules key on scheme, not on the light palette',
  (css.match(/:host\(\[theme="light"\]\) \./g) || []).length, 0);
ok('the light scheme has rules of its own', /:host\(\[scheme="light"\]\) \./.test(css));

/* ----- the side layout is there, behind the width it needs ----- */
ok('the side layout is declared', /:host\(\[layout="side"\]\) \.wrap \{/.test(css));
ok('the side layout waits for 780px of sheet',
  /@container \(min-width: 780px\) \{\s*:host\(\[layout="side"\]\) \.wrap/.test(css));

/* ----- the palettes travel to a page that is not the sheet ----- */
const rules = paletteRules(css);
for (const p of PALETTES) {
  const m = rules.match(new RegExp(`:root\\[data-theme="${p.id}"\\] \\{([^}]*)\\}`));
  ok(`${p.id}: has a :root[data-theme] rule for other pages`, m);
  if (!m) continue;
  const missing = REQUIRED.filter((k) => !m[1].includes(`${k}:`));
  check(`${p.id}: the rule carries the full set`, missing, []);
  ok(`${p.id}: the rule carries no layout`, !/(^|\n)\s*(display|font-family|padding|container-type|overflow-anchor)\s*:/.test(m[1]));
}
check('nothing in from no stylesheet', paletteRules(''), '');
const forgeCss = fs.readFileSync(fileURLToPath(new URL('../forge/forge.css', import.meta.url)), 'utf8');
ok('the workbench maps its colours onto the sheet\'s', /--bg:var\(--cs-bg,/.test(forgeCss));
ok('the workbench keeps no palette of its own', !/:root\[data-theme="(dark|light)"\]/.test(forgeCss));

/* ----- the names ----- */
check('every palette has a distinct id', new Set(PALETTES.map((p) => p.id)).size, PALETTES.length);
ok('dark and light are still the first two', PALETTES[0].id === 'dark' && PALETTES[1].id === 'light');
for (const p of PALETTES) {
  ok(`${p.id}: pair is a palette`, isPalette(p.pair) && p.pair !== p.id);
  ok(`${p.id}: pair is on the other scheme`, schemeOf(p.pair) !== p.scheme);
  ok(`${p.id}: designed layout is a layout`, isLayout(p.layout));
  ok(`${p.id}: has a name and a blurb`, p.name && p.blurb);
}
check('two layouts', LAYOUTS.map((l) => l.id), ['top', 'side']);
check('four widths, full first', WIDTHS.map((w) => w.id), ['100', '90', '80', '70']);
ok('a width is known as a number too', isWidth(80) && !isWidth('75'));
for (const w of WIDTHS.slice(1)) {
  ok(`width ${w.id} has a host rule`, css.includes(`:host([width="${w.id}"]) { width: ${w.id}%;`));
}
ok('full width has no rule to undo', !css.includes(':host([width="100"])'));
check('paletteOf finds one', paletteOf('slate')?.name, 'Slate');
check('paletteOf misses gracefully', paletteOf('sepia'), null);
ok('auto is a palette for the picker', isPalette(AUTO));
check('auto resolves by the system', [resolvePalette(AUTO, true), resolvePalette(AUTO, false)], ['dark', 'light']);
check('an unknown theme resolves to dark', resolvePalette('sepia'), 'dark');
check('an unknown theme is a dark scheme', schemeOf('sepia'), 'dark');
check('flipped follows the pair', [flipped('dark'), flipped('light'), flipped('workbench'), flipped('workbench-dark')],
  ['light', 'dark', 'workbench-dark', 'workbench']);
check('flipped falls back by scheme', flipped('sepia'), 'light');

/* ----- the preference ----- */
check('normalizePrefs keeps only known values',
  normalizePrefs({ palette: 'slate', layout: 'sideways', extra: 1 }), { palette: 'slate' });
check('normalizePrefs keeps auto', normalizePrefs({ palette: AUTO }), { palette: AUTO });
check('normalizePrefs keeps a width, as a string', normalizePrefs({ width: 80 }), { width: '80' });
check('normalizePrefs drops an odd width', normalizePrefs({ width: '75' }), null);
check('normalizePrefs on nothing usable', normalizePrefs({ palette: 'sepia' }), null);
check('normalizePrefs on garbage', normalizePrefs('slate'), null);

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
check('nothing remembered yet', readThemePrefs(storage), null);
check('a choice is written clean', writeThemePrefs({ palette: 'parchment', layout: 'side', junk: true }, storage),
  { palette: 'parchment', layout: 'side' });
check('and read back', readThemePrefs(storage), { palette: 'parchment', layout: 'side' });
check('under the one key', [...store.keys()], [THEME_KEY]);
check('nothing usable clears it', writeThemePrefs({ palette: 'sepia' }, storage), null);
check('cleared', readThemePrefs(storage), null);
store.set(THEME_KEY, '{not json');
check('a corrupt value reads as nothing', readThemePrefs(storage), null);
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
check('blocked storage reads as nothing', readThemePrefs(broken), null);
check('blocked storage still returns the clean choice', writeThemePrefs({ layout: 'side' }, broken), { layout: 'side' });
check('no storage at all', readThemePrefs(undefined), null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
