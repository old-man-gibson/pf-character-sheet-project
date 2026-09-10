/**
 * theme.js -- the Workbench wears the sheet's palettes.
 *
 * The seven looks the character sheet offers are the Workbench's too, and so
 * is the choice: both read the one browser preference (see app/js/themes.js),
 * so a palette picked on either page is what the other opens in. The palette
 * blocks themselves are read out of app/css/sheet.css at load (see
 * app/js/theme-css.js) and forge.css maps its own properties onto them, which
 * is how the two pages can agree on a colour without either keeping a copy.
 *
 * Left alone, the Workbench is the Workbench: its own ivory-and-oxblood look,
 * dark after the system's setting. A choice made anywhere replaces that, and
 * "Follow the system" is the sheet's plain dark and light, as it is there.
 */
import {
  PALETTES, AUTO, THEME_KEY, readThemePrefs, writeThemePrefs, resolvePalette, schemeOf,
} from '../../app/js/themes.js';
import { loadPaletteRules } from '../../app/js/theme-css.js';

const SHEET_CSS = new URL('../../app/css/sheet.css', import.meta.url);

export function mountThemes(select) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const root = document.documentElement;

  /** The palette the page shows right now: the choice, or the Workbench's own. */
  const current = () => {
    const pref = readThemePrefs()?.palette;
    if (pref) return resolvePalette(pref, dark.matches);
    return dark.matches ? 'workbench-dark' : 'workbench';
  };

  const apply = () => {
    const palette = current();
    root.dataset.theme = palette;
    root.dataset.scheme = schemeOf(palette);
    if (select) select.value = readThemePrefs()?.palette || '';
  };

  if (select) {
    const opt = (value, label) => `<option value="${value}">${label}</option>`;
    select.innerHTML = [
      opt('', 'Workbench (default)'),
      opt(AUTO, 'Follow the system'),
      ...PALETTES.map((p) => opt(p.id, p.name)),
    ].join('');
    select.addEventListener('change', () => {
      // Back to the default clears the memory for the sheet too: "no choice"
      // is a state both pages understand, and each has its own reading of it.
      const prefs = readThemePrefs() || {};
      if (select.value) prefs.palette = select.value; else delete prefs.palette;
      writeThemePrefs(prefs);
      apply();
    });
  }

  dark.addEventListener('change', apply);
  // A choice made on the sheet in another tab lands here as it is made.
  window.addEventListener('storage', (e) => { if (e.key === THEME_KEY) apply(); });

  apply();
  loadPaletteRules(SHEET_CSS).then((rules) => {
    if (!rules) return;
    const style = document.createElement('style');
    style.id = 'palettes';
    style.textContent = rules;
    document.head.prepend(style);
  });
}
