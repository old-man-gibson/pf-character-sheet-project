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
  /*
   * `{{pl|Alteration|sphere}}` links the page "Alteration sphere" and shows
   * "Alteration": the second argument is the page title's disambiguator, not
   * a label. The default rule showed it, so a talent read
   * "possesses the (subtype)" where the page says "possesses the elf".
   */
  pl: (a) => a[0] ?? '',
  /*
   * `{{pll|Autumn|Blast}}` is `pl` with the second word shown as well: it
   * links "Autumn Blast" and says "Autumn Blast". By the default rule a list
   * of twenty-seven of them read "Blast, Blast, Blast, …".
   */
  pll: (a) => a.join(' '),
  // The box over an infusion naming the blasts it goes with: a labelled line.
  'associated blast': (a) => `Associated Blasts: ${a.join(', ')}`,
};

/**
 * Templates expanded from their own source rather than guessed at, by
 * lower-cased name (`useTemplateSources`). A class page's `{{Class Table}}` is
 * the one that needs it: every argument is named (`sp1=`, `xa=`), so the
 * default rule leaves nothing, and the table is what says which labelled
 * paragraphs are the class's features.
 */
const SOURCES = new Map();

/** Expand these templates from their wikitext source: `[[name, source], …]`. */
export function useTemplateSources(entries) {
  SOURCES.clear();
  for (const [name, source] of entries) SOURCES.set(String(name).replace(/\s+/g, ' ').trim().toLowerCase(), String(source));
}

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

  if (SOURCES.has(name)) {
    const given = {};
    let n = 0;
    for (const a of args.slice(1)) {
      const eq = a.indexOf('=');
      if (eq > 0 && /^[\w -]+$/.test(a.slice(0, eq).trim())) given[a.slice(0, eq).trim()] = a.slice(eq + 1).trim();
      else given[String(++n)] = a;
    }
    // Rows on lines of their own, apart from the prose around them.
    return `\n\n${tablesAsPipes(expandTemplate(SOURCES.get(name), given, title))}\n\n`;
  }
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

/* ---------------- a template from its source ---------------- */

/**
 * Wikitext as a tree of text, `{{…}}` calls and `{{{…}}}` parameters, each
 * call's or parameter's arguments split on its own pipes. A run of braces is
 * matched the way MediaWiki matches it: three closing braces end a parameter
 * and two end a call, so `{{#if:{{{a|}}}}}` closes both. The pipes inside a
 * `[[link|label]]` are the link's.
 */
function parseBraces(text) {
  const root = { parts: [[]] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const put = (x) => top().parts[top().parts.length - 1].push(x);
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      let n = 0;
      while (text[i + n] === '{') n++;
      stack.push({ open: n, parts: [[]] });
      i += n;
      continue;
    }
    if (text.startsWith('}}', i) && stack.length > 1) {
      let m = 0;
      while (text[i + m] === '}') m++;
      i += m;
      while (m >= 2 && stack.length > 1) {
        const el = top();
        const take = el.open >= 3 && m >= 3 ? 3 : 2;
        const node = { kind: take === 3 ? 'param' : 'call', parts: el.parts };
        el.open -= take;
        m -= take;
        if (el.open >= 2) el.parts = [[node]];
        else {
          stack.pop();
          if (el.open === 1) put('{');
          put(node);
        }
      }
      if (m) put('}'.repeat(m));
      continue;
    }
    if (stack.length > 1 && text.startsWith('[[', i)) {
      const end = text.indexOf(']]', i);
      if (end !== -1) { put(text.slice(i, end + 2)); i = end + 2; continue; }
    }
    if (text[i] === '|' && stack.length > 1) { top().parts.push([]); i++; continue; }
    let j = i + 1;
    while (j < text.length && !'{}|['.includes(text[j])) j++;
    put(text.slice(i, j));
    i = j;
  }
  // Braces that never close are text.
  while (stack.length > 1) {
    const el = stack.pop();
    put('{'.repeat(el.open));
    el.parts.forEach((p, k) => { if (k) put('|'); p.forEach(put); });
  }
  return root.parts[0];
}

/**
 * A `#expr` / `#ifexpr` expression's value: numbers, `+ - * /`, `mod`,
 * comparisons, `and`, `or`, `not` and brackets, in MediaWiki's order of
 * precedence. NaN for anything else.
 */
export function wikiExpr(src) {
  const tokens = String(src).toLowerCase().match(/\d+(?:\.\d+)?|\.\d+|<=|>=|<>|!=|mod\b|and\b|or\b|not\b|[-+*/()<>=]|\S/g) || [];
  let k = 0;
  const peek = () => tokens[k];
  const unary = () => {
    const t = tokens[k++];
    if (t === '-') return -unary();
    if (t === '+') return unary();
    if (t === 'not') return unary() ? 0 : 1;
    if (t === '(') { const v = or(); if (tokens[k] === ')') k++; return v; }
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };
  const times = () => {
    let v = unary();
    while (['*', '/', 'mod'].includes(peek())) {
      const op = tokens[k++];
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : Math.trunc(v) % Math.trunc(r);
    }
    return v;
  };
  const plus = () => {
    let v = times();
    while (peek() === '+' || peek() === '-') v = tokens[k++] === '+' ? v + times() : v - times();
    return v;
  };
  const compare = () => {
    let v = plus();
    while (['=', '<', '>', '<=', '>=', '!=', '<>'].includes(peek())) {
      const op = tokens[k++];
      const r = plus();
      v = Number({ '=': v === r, '<': v < r, '>': v > r, '<=': v <= r, '>=': v >= r, '!=': v !== r, '<>': v !== r }[op]);
    }
    return v;
  };
  const and = () => { let v = compare(); while (peek() === 'and') { k++; const r = compare(); v = Number(!!v && !!r); } return v; };
  const or = () => { let v = and(); while (peek() === 'or') { k++; const r = and(); v = Number(!!v || !!r); } return v; };
  if (!tokens.length) return NaN;
  const v = or();
  return k === tokens.length && Number.isFinite(v) ? v : NaN;
}

/** `#switch`: the value of the first case that matches, a case without `=` falling through to the next. */
function switchCase(value, cases, frame) {
  const same = (a, b) => a === b || (a !== '' && b !== '' && !Number.isNaN(Number(a)) && Number(a) === Number(b));
  let found = false;
  let fallback = '';
  for (let k = 0; k < cases.length; k++) {
    const nodes = cases[k];
    const at = nodes.findIndex((n) => typeof n === 'string' && n.includes('='));
    if (at === -1) {
      const key = expandNodes(nodes, frame).trim();
      if (k === cases.length - 1) return found ? '' : key;   // a last case with no `=` is the default
      if (same(key, value)) found = true;
      continue;
    }
    const cut = nodes[at].indexOf('=');
    const key = expandNodes([...nodes.slice(0, at), nodes[at].slice(0, cut)], frame).trim();
    const out = () => expandNodes([nodes[at].slice(cut + 1), ...nodes.slice(at + 1)], frame).trim();
    if (found || same(key, value)) return out();
    if (key === '#default') fallback = out();
  }
  return fallback;
}

function expandNodes(nodes, frame) {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') out += n;
    else if (n.kind === 'param') {
      const name = expandNodes(n.parts[0], frame).trim();
      out += Object.hasOwn(frame.args, name) ? frame.args[name]
        : n.parts.length > 1 ? expandNodes(n.parts[1], frame) : `{{{${name}}}}`;
    } else out += expandCall(n, frame);
  }
  return out;
}

function expandCall(n, frame) {
  const head = expandNodes(n.parts[0], frame);
  const arg = (k) => (n.parts[k] ? expandNodes(n.parts[k], frame).trim() : '');
  const fn = head.match(/^\s*#(\w+)\s*:([\s\S]*)$/);
  if (fn) {
    const first = fn[2].trim();
    switch (fn[1].toLowerCase()) {
      case 'if': return first ? arg(1) : arg(2);
      case 'ifexpr': { const v = wikiExpr(first); return !Number.isNaN(v) && v ? arg(1) : arg(2); }
      case 'expr': { const v = wikiExpr(first); return Number.isNaN(v) ? '' : String(Number(v.toPrecision(12))); }
      case 'len': return String(first.length);
      case 'switch': return switchCase(first, n.parts.slice(1), frame);
      default: return '';
    }
  }
  const name = head.replace(/\s+/g, ' ').trim().toLowerCase();
  if (name === '!') return '|';
  if (name === 'pagename' || name === 'basepagename') return frame.title;
  // The page's name without the bracket that tells two pages of one name apart.
  if (name === 'pagename nd') return arg(1).replace(/\s*\([^()]*\)\s*$/, '');
  return '';
}

/**
 * A template's source expanded with the arguments a page gave it: parameters
 * filled in, and `#if`, `#ifexpr`, `#switch`, `#expr` and `#len` worked out.
 * Enough for a template that computes a table from its arguments; any other
 * template it calls leaves nothing.
 */
export function expandTemplate(source, args = {}, title = '') {
  return expandNodes(parseBraces(String(source ?? '')), { args, title });
}

/**
 * Every `{| … |}` table in a stretch of wikitext as pipe rows, `| a | b |`,
 * the form a class table takes in every other pack. The header kept is the
 * last row of headers before the first row of data (a row of group headings
 * above it goes), the caption goes, and a cell is its text: `attr|` and
 * category links off, links as their labels, line breaks as spaces.
 */
export function tablesAsPipes(text) {
  return String(text ?? '').replace(/\[\[\s*Category\s*:[^\]]*\]\]/gi, '')
    .replace(/^[ \t]*\{\|[^\n]*\n([\s\S]*?)^[ \t]*\|\}[ \t]*$/gm, (_, inner) => {
      const rows = [];
      for (const chunk of inner.split(/^[ \t]*\|-[^\n]*$/m)) {
        const cells = [];
        let header = true;
        for (const line of chunk.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('|+')) continue;
          if (t[0] === '|' || t[0] === '!') {
            if (t[0] === '|') header = false;
            for (const c of t.slice(1).split(t[0] === '!' ? /!!|\|\|/ : /\|\|/)) cells.push(c);
          } else if (cells.length) cells[cells.length - 1] += ` ${t}`;
        }
        const text = cells.map((c) => delink(c.replace(/^\s*[^|[\]{}]*=[^|[\]{}]*\|(?!\|)/, ''))
          .replace(/<br\s*\/?>/gi, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim());
        if (text.length) rows.push({ header, text });
      }
      const first = rows.findIndex((r) => !r.header);
      if (first === -1) return '';
      const head = rows.slice(0, first).filter((r) => r.header).pop();
      return [...(head ? [head] : []), ...rows.slice(first)].map((r) => `| ${r.text.join(' | ')} |`).join('\n');
    });
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
