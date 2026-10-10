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
