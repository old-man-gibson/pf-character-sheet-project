/**
 * theme-css.js -- the sheet's palettes, lifted out of its stylesheet for a
 * page that is not the sheet.
 *
 * The palettes are written once, in app/css/sheet.css, as `:host` blocks the
 * `<character-sheet>` element reads. The Homebrew Workbench wants the same
 * seven looks without being a character sheet, and the honest way to give it
 * them is to read them from where they are rather than keep a second copy that
 * drifts. So this fetches the stylesheet, keeps the custom-property lines of
 * each palette block, and rewrites the selectors for a page that stamps
 * `data-theme` on its root -- `:host([theme="slate"])` becomes
 * `:root[data-theme="slate"]`, and the bare `:host` block, which is the dark
 * palette and the defaults, becomes `:root[data-theme="dark"]`.
 *
 * A page then maps its own properties onto the sheet's: `--bg: var(--cs-bg)`
 * and so on, with a fallback for the moment before the fetch lands. See
 * forge/forge.css for that mapping.
 *
 * Only declarations of custom properties and `color-scheme` are kept. The
 * `:host` block also says how the element displays and lays out, and none of
 * that is a palette.
 */

/** The declarations of a block, kept to the ones that are a palette. */
function paletteDeclarations(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((line) => line.trim())
    .filter((line) => /^(--[\w-]+|color-scheme)\s*:/.test(line))
    .map((line) => `  ${line};`)
    .join('\n');
}

/**
 * The palette blocks of a sheet stylesheet, as `:root[data-theme="…"]` rules.
 * Pure: takes the stylesheet's text, returns CSS text. Empty when the text
 * holds no `:host` block at all, which is what a failed fetch comes to.
 */
export function paletteRules(cssText) {
  const out = [];
  const base = cssText.match(/:host \{([\s\S]*?)\n\}/);
  if (base) out.push(`:root[data-theme="dark"] {\n${paletteDeclarations(base[1])}\n}`);
  const each = /:host\(\[theme="([\w-]+)"\]\)\s*\{([^}]*)\}/g;
  for (let m = each.exec(cssText); m; m = each.exec(cssText)) {
    out.push(`:root[data-theme="${m[1]}"] {\n${paletteDeclarations(m[2])}\n}`);
  }
  return out.join('\n\n');
}

/**
 * Fetch a sheet stylesheet and return its palettes as rules for a page. An
 * unreachable stylesheet comes back as an empty string, and the page keeps
 * whatever fallbacks its own stylesheet carries: a wrong colour is not worth
 * a page that does not open.
 */
export async function loadPaletteRules(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    return paletteRules(await res.text());
  } catch {
    return '';
  }
}
