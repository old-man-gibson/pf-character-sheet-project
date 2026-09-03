/**
 * Wikitext, far enough to be read by something that expects prose.
 *
 * Shared by `wiki-dump.mjs`, which splits an export into records, and
 * `wiki-docs.mjs`, which writes those records out as documents. One
 * implementation rather than two, for the same reason `scrape-pack.mjs`
 * borrows the panel's reader instead of growing its own: the moment there are
 * two, a page reads differently depending on which tool touched it.
 *
 * Deliberately partial. `[[Target|label]]` is left exactly as it stands,
 * because `paste-import.js` already knows that form and this has no business
 * competing with it. What is handled here is the layer the reader has never
 * had to see: templates, which the scraper always expanded before writing a
 * document, and MediaWiki's list markers, which it never defused.
 */

/**
 * The entities an XML export escapes. `&amp;` goes last, so that a page that
 * genuinely wrote `&amp;lt;` keeps its `&lt;` rather than becoming a `<`.
 */
export const unxml = (s) => String(s)
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

/**
 * Where the `{{…}}` opening at `i` closes, counting nesting -- an infobox
 * value is routinely `{{Citation needed}}`, and a naive search for `}}`
 * would end the template on that instead of on its own brace.
 */
export function templateEnd(text, i) {
  let depth = 0;
  for (let j = i; j < text.length - 1; j++) {
    if (text.startsWith('{{', j)) { depth++; j++; continue; }
    if (text.startsWith('}}', j)) { depth--; j++; if (!depth) return j + 1; }
  }
  return -1;
}

/**
 * A template's arguments, split on the pipes that belong to it. The pipes
 * inside `[[Link|label]]`, a nested template or a `{| … |}` table are the
 * inner thing's, so they are counted past rather than split on.
 */
export function splitArgs(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < inner.length; j++) {
    if (inner.startsWith('{{', j) || inner.startsWith('[[', j) || inner.startsWith('{|', j)) { depth++; j++; continue; }
    if (inner.startsWith('}}', j) || inner.startsWith(']]', j) || inner.startsWith('|}', j)) { depth--; j++; continue; }
    if (inner[j] === '|' && depth <= 0) { parts.push(inner.slice(start, j)); start = j + 1; }
  }
  parts.push(inner.slice(start));
  return parts;
}

/* ---------------- templates ---------------- */

/**
 * Furniture: a navigation box, a licence, or a list the wiki *generates* from
 * its own categories. The generated ones are the honest losses here -- an
 * `{{Archetype List}}` is a query, and a dump holds the query rather than its
 * answer, so there is nothing to unwrap. They go rather than being left as
 * braces in the middle of a rule.
 */
const FURNITURE = new Set([
  'related', 'ogl', 'pub content', 'header aon', 'archetype list',
  'citation needed', 'bonus spells', 'toc', 'clear', 'reflist', 'references',
  'stub', 'expand', 'disambig', 'navbox', 'sourcebox',
]);

/** Prose wrappers: the argument *is* the text, and the box around it is looks. */
const PROSE = new Set(['flavor', 'flavour', 'quotation', 'quote', 'blockquote']);

/**
 * A label written in a way the rest of the toolchain already reads.
 *
 * `{{Chakra Bind|Belt}}` becomes the inline form eighteen veils write by
 * hand and `scrape-pack.mjs` sorts on, so a bind survives the trip whichever
 * way the page happened to state it. `{{Prerequisite|…}}` becomes a labelled
 * line, which is the shape the feature reader keys on.
 */
const NAMED = {
  'chakra bind': (a) => `Chakra Bind (${a[0] || ''}):`,
  prerequisite: (a) => `Prerequisite: ${a[a.length - 1] || ''}`,
  prerequisites: (a) => `Prerequisites: ${a[a.length - 1] || ''}`,
  /*
   * A *list* template, where the default rule is exactly wrong: every
   * argument is an item, so taking the last one would turn a deity's four
   * domains into "Scalykind". `{{AONList|x=Domain|Chaos|Death|Destruction|
   * Scalykind}}` -- the named argument says which index to link into and is
   * already filtered out before this is called, leaving the items.
   */
  aonlist: (a) => a.join(', '),
  aalist: (a) => a.join(', '),
};

/**
 * What a template leaves behind.
 *
 * The default is its last argument, which is what the wiki's link templates
 * all agree on -- `{{AON|Spell|Magic Missile|magic missiles}}`, `{{hl|Veilweaving
 * sphere|Essence-Bound Veils}}`, `{{lcl|Akashic Spirit}}` -- and a fair guess
 * at an unknown one. `unknown` collects the names it had to guess at, so a
 * run can report what it did not recognise rather than deciding in silence.
 */
function render(inner, title, unknown) {
  const args = splitArgs(inner).map((a) => a.trim());
  const name = args[0].replace(/\s+/g, ' ').trim().toLowerCase();
  const rest = args.slice(1).filter((a) => !/^[a-z0-9_ -]{1,20}=/i.test(a));

  if (name === 'pagename' || name === 'subst:pagename') return title;
  // A template written about here wins over every general rule below, so that
  // a name appearing in two lists cannot go silently missing -- which is what
  // `aonlist` did while it sat in FURNITURE: a deity lost all four domains.
  if (NAMED[name]) return NAMED[name](rest);
  if (PROSE.has(name)) return rest[rest.length - 1] ?? '';
  // `Header AON`, `Header Retold`, `Header Errata`, `Header Update`: the
  // banner strip above an article, one per thing the editors wanted to say
  // about the page rather than about the rule.
  if (FURNITURE.has(name) || name.startsWith('header ')) return '';
  if (!rest.length) { unknown?.set(name, (unknown?.get(name) ?? 0) + 1); return ''; }
  unknown?.set(name, (unknown?.get(name) ?? 0) + 1);
  return rest[rest.length - 1] ?? '';
}

/**
 * Every template in a stretch of wikitext, resolved innermost first.
 *
 * Innermost first is what makes a nested call come out right: the label
 * inside `{{hl|Sphere|{{lcl|Mind}}}}` has to become text before the call
 * around it can pick it as its last argument. Finding the last `{{` before
 * the first `}}` is exactly that, without a recursive walk.
 */
export function unwrapTemplates(text, title = '', unknown = null) {
  let out = String(text ?? '');
  // Braces do go unclosed on a wiki, and a scan that cannot make progress
  // must stop rather than spin: every pass either resolves one call or ends.
  for (let guard = 0; guard < 20000; guard++) {
    const close = out.indexOf('}}');
    if (close === -1) break;
    const open = out.lastIndexOf('{{', close);
    if (open === -1) break;
    out = out.slice(0, open) + render(out.slice(open + 2, close), title, unknown) + out.slice(close + 2);
  }
  return out;
}

/* ---------------- markers ---------------- */

/**
 * Machinery that never had a reader.
 *
 * `<section begin="dpl" />` is labelled-section transclusion: it marks the
 * stretch of a page that some *other* page pulls in, and it is on 3,381 of
 * these. `paste-import.js` strips the tags a page used for looks, one by one
 * and deliberately, so that a rule reading `AC <10` survives -- these are not
 * in that list because the scraper never emitted them, and they belong here
 * for the same reason the list markers do. HTML comments go with them:
 * an editor's note to another editor is not rules text.
 */
export const stripMarkers = (text) => String(text ?? '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<\/?section\b[^>]*>/gi, '');

/**
 * MediaWiki emphasis, written as markdown.
 *
 * `'''Benefit:'''` is on 19,937 of these pages and `tidyProse` in the reader
 * does not know it -- it strips `**bold**`, because the scraper had always
 * converted the quotes before it wrote a document. That conversion is this
 * tool's job now, and doing it here rather than teaching the reader a second
 * dialect keeps the document a scraper document.
 *
 * Bold-italic collapses to bold: the reader drops `**…**` and keeps `*…*`,
 * and a defined term set in both is a term, not an aside.
 */
export const emphasis = (text) => String(text ?? '')
  .replace(/'''''([^\n]+?)'''''/g, '**$1**')
  .replace(/'''([^\n]+?)'''/g, '**$1**')
  .replace(/''([^\n]+?)''/g, '*$1*');

/**
 * A wiki link as its label, for the places prose does not reach.
 *
 * `paste-import.js` already knows `[[Target|label]]` and unpicks it wherever
 * it reads *prose*, which is why the body is left alone here. A **field** is
 * not prose and never passes through that: a feat whose prerequisite reads
 * `two [[Sagitta Stellaris]] maneuvers known` arrives on the sheet with the
 * brackets still on, in a cell three words wide. So the fields are unpicked
 * on the way out, and only the fields.
 */
export const delink = (text) => String(text ?? '')
  .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
  .replace(/\[\[([^\]|]*)\]\]/g, '$1')
  .replace(/\[(?:https?|ftp):\/\/\S+\s+([^\]\n]+)\]/g, '$1');

/* ---------------- lists ---------------- */

/**
 * MediaWiki's list markers, made safe.
 *
 * `# item` is a numbered list on a wiki and a level-one heading in markdown,
 * and a document that says `#` down the side of a spell's effects arrives at
 * the reader as a run of headings that tears the entry apart -- the entry
 * ends at the first one, and everything after it is a nameless fragment with
 * no fields. That is a known break, and this is where it belongs: the tool
 * that writes the document, not the reader that has to make sense of it.
 *
 * Numbering is counted per run so an ordered list stays ordered; `*` becomes
 * a plain bullet, `;` a term and `:` its definition, indented.
 */
export function delist(text) {
  const out = [];
  let n = 0;
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^([*#:;]+)\s*(.*)$/);
    if (!m) { n = 0; out.push(line); continue; }
    const [, marks, rest] = m;
    const depth = marks.length - 1;
    const pad = '  '.repeat(depth);
    const last = marks[marks.length - 1];
    if (last === '#') { n++; out.push(`${pad}${n}. ${rest}`); continue; }
    n = 0;
    if (last === ';') out.push(`${pad}${rest.replace(/\s*:\s*$/, '')}:`);
    else if (last === ':') out.push(`${pad}${rest}`);
    else out.push(`${pad}- ${rest}`);
  }
  return out.join('\n');
}

/* ---------------- infobox fields ---------------- */

/**
 * `slot1, slot2, slot3` read as one `slot` of three values.
 *
 * Every infobox on this wiki numbers its repeats, and the numbers are the
 * template's business rather than the rule's: a veil is shapeable in Belt
 * *and* Wrists, not in a slot1 and a slot2. Empty entries drop, so a page
 * that filled 1 and 3 does not come out with a hole in the middle.
 *
 * A family whose name is another's with `level` on the end is that one's
 * partner -- `class1=Wizard` with `classlevel1=3` -- and they are zipped
 * rather than listed twice.
 */
export function collapseFamilies(fields) {
  const fam = new Map();
  for (const [key, value] of Object.entries(fields)) {
    if (!String(value).trim()) continue;
    const m = key.match(/^(.*?)(\d+)$/);
    const base = m ? m[1] : key;
    const at = m ? Number(m[2]) : 0;
    if (!fam.has(base)) fam.set(base, []);
    fam.get(base).push([at, String(value).trim()]);
  }
  const out = new Map();
  for (const [base, pairs] of fam) {
    out.set(base, pairs.sort((a, b) => a[0] - b[0]).map(([, v]) => v));
  }
  for (const base of [...out.keys()]) {
    const partner = `${base}level`;
    if (!out.has(partner)) continue;
    const names = out.get(base);
    const levels = out.get(partner);
    out.set(base, names.map((v, i) => (levels[i] ? `${v} ${levels[i]}` : v)));
    out.delete(partner);
  }
  return out;
}
