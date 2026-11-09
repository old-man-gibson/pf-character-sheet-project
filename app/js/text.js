/**
 * app/js/text.js -- what a pasted page is cleaned of before it is read.
 *
 * A page copied out of a browser carries characters the readers do not key
 * on. The paste importer and the monster importer each kept these steps, and
 * the copies drifted: one no-break-space rule held an ordinary space, so it
 * did nothing, and a race page lost its traits. The steps both use live here,
 * written as escapes so that no editor can turn one into the character it
 * replaces; each importer lists the steps it takes, in its own order, beside
 * its own.
 */

export const TEXT_STEPS = {
  /** No-break spaces off a web page. */
  nbsp: [/ /g, ' '],
  /** The minus sign, as a hyphen. */
  minus: [/−/g, '-'],
  /** **bold** from a markdown copy. */
  bold: [/\*\*([^*\n]+)\*\*/g, '$1'],
  /** Blanks at the end of a line. */
  trailing: [/[ \t]+$/gm, ''],
};

/** `text` with each [pattern, replacement] step applied in turn. */
export const cleanText = (text, steps) => steps
  .reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), String(text ?? ''));

/**
 * The classes and levels a spell or power lists: "sorcerer 3, wizard 3" as
 * [{name, level}]. A comma inside brackets does not split, so "warlock
 * (revised) 4" is one class. A bracket after the level limits who gets the
 * spell at that level ("wizard 2 (followers of Ilvara)") and is kept as
 * `only`. Used by the paste reader and the spell catalogue.
 */
export function classLevels(raw) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of String(raw ?? '')) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ',' && !depth) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)\s+(\d+)(?:\s*\(([^()]*)\))?$/);
    if (!m) return { name: p, level: null };
    const only = m[3] ? m[3].replace(/\s+/g, ' ').trim() : '';
    return { name: m[1].trim(), level: Number(m[2]), ...(only ? { only } : {}) };
  });
}
