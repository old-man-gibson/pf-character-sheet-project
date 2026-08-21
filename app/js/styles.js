/**
 * styles.js -- loads the component's stylesheet.
 *
 * The CSS itself is app/css/sheet.css. It used to be a template literal in this
 * file, which made every character in 2,500 lines of CSS something the
 * JavaScript parser also had an opinion about: a stray backtick in a comment
 * took the whole component out in the browser while `node --check` stayed
 * perfectly happy. A .css file cannot do that, and editors syntax-check and
 * fold it properly.
 *
 * It is fetched once, at module load, and handed to the element as a single
 * constructed stylesheet that every `<character-sheet>` on the page adopts. So
 * the CSS is parsed once per page rather than re-parsed on every render, which
 * is what injecting a <style> tag into each shadow root was doing.
 *
 * The fetch is awaited at the top level, so anything importing this module --
 * sheet-element.js included -- waits for the CSS before it defines the element.
 * That costs one round trip on first load and buys the absence of a flash of
 * unstyled sheet; the file is cached from then on. The app already fetches its
 * extension packs the same way, so this adds no requirement it did not have.
 */

/** Where the stylesheet lives, resolved against this module rather than the page. */
export const SHEET_CSS_URL = new URL('../css/sheet.css', import.meta.url).href;

/**
 * The stylesheet text, or null if it could not be read.
 *
 * Null is not fatal: it makes `SHEET_LINK` below into a real <link> tag, and
 * the browser fetches the same file by the route that does not need CORS. A
 * thrown error here would take the element's whole module graph down with it
 * and leave the host page with no sheet at all rather than an unstyled one, so
 * this reports and carries on.
 */
export const SHEET_CSS = await (async () => {
  try {
    const res = await fetch(SHEET_CSS_URL);
    if (res.ok) return await res.text();
    console.error(`character-sheet: ${SHEET_CSS_URL} answered ${res.status} ${res.statusText}; falling back to a <link>.`);
  } catch (err) {
    console.error(`character-sheet: could not fetch ${SHEET_CSS_URL} (${err?.message ?? err}); falling back to a <link>.`);
  }
  return null;
})();

/**
 * One constructed stylesheet, shared by every sheet on the page.
 *
 * Constructable stylesheets are assumed rather than feature-detected: the CSS
 * uses `color-mix()`, which no browser shipped before this, so anything that
 * can render the sheet correctly can also adopt it. Null when the CSS did not
 * load, or when there is no DOM at all (a module loaded under Node).
 */
export const SHEET_STYLE_SHEET = (() => {
  if (SHEET_CSS === null || typeof CSSStyleSheet === 'undefined') return null;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHEET_CSS);
  return sheet;
})();

/**
 * What a shadow root needs in its markup, which is normally nothing.
 *
 * A render replaces the root's innerHTML wholesale, so the fallback <link> has
 * to be part of what is written each time; `adoptedStyleSheets` survives on its
 * own and needs no help. Empty string in the ordinary case.
 */
export const SHEET_LINK = SHEET_STYLE_SHEET
  ? ''
  : `<link rel="stylesheet" href="${SHEET_CSS_URL}">`;

/** Adopt the shared stylesheet into a shadow root. Called once per element. */
export function adoptSheetStyles(root) {
  if (SHEET_STYLE_SHEET) root.adoptedStyleSheets = [...root.adoptedStyleSheets, SHEET_STYLE_SHEET];
  return root;
}
