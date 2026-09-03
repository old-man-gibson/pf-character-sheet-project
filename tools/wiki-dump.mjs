/**
 * A MediaWiki XML export, split into one record per page.
 *
 * `Special:Export` hands over the whole wiki as a single file: every page,
 * and every revision of every page, in one 687 MB document. Nothing in this
 * repo can read that -- `parsePaste` takes a string, and the string it wants
 * is one page, either as a browser copied it or as the scraper wrote it out.
 *
 * So this is the step before the reader, not a second reader. It streams the
 * dump, keeps each page's *current* revision and throws the history away,
 * and writes one JSON object per line. What comes out is small enough to
 * work with (85 MB against 687) and, more to the point, random-access: every
 * later question -- which kinds, which source book, how to bundle them into
 * packs -- is a pass over the JSONL rather than another hour of XML.
 *
 *   node tools/wiki-dump.mjs <dump.xml> --out <file.jsonl> [options]
 *
 *     --out <file>    where the records are written (required)
 *     --ns <list>     namespaces to keep, comma-separated (default '0')
 *     --kind <list>   only these infobox kinds, e.g. 'veil,feat'
 *     --redirects     keep redirect pages, which are dropped by default
 *     --limit <n>     stop after n records, for a trial run
 *     --dry           report what it would write, write nothing
 *
 * The infobox is the reason this is worth doing rather than scraping the
 * rendered site again. `{{Infobox veil|descriptor1=Shatter|class1=Nexus}}`
 * is the entry already typed and named -- the same fields the structured
 * reader looks for, but stated by the page instead of inferred from how it
 * happened to copy. Those become `fields`; what is left is `body`.
 *
 * Records are content, and content is a publisher's: write them somewhere
 * git-ignored (`private/`) rather than into `data/`, which ships.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { unxml, templateEnd, splitArgs } from './wikitext.mjs';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const flag = (name) => argv.includes(`--${name}`);
const VALUED = /^--(out|ns|kind|limit)$/;
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.test(argv[i - 1])));

const out = opt('out');
const keepNs = new Set(String(opt('ns', '0')).split(',').map((s) => s.trim()));
const onlyKinds = opt('kind') ? new Set(String(opt('kind')).split(',').map((s) => s.trim().toLowerCase())) : null;
const limit = Number(opt('limit', 0)) || Infinity;
const redirects = flag('redirects');
const dry = flag('dry');

if (inputs.length !== 1 || (!out && !dry)) {
  console.error('usage: node tools/wiki-dump.mjs <dump.xml> --out <file.jsonl> [--ns 0] [--kind veil,feat] [--redirects] [--limit N] [--dry]');
  process.exit(2);
}

/* ---------------- the page ---------------- */

/**
 * The page's infobox, if it opens one: its kind, its fields, and the text
 * with the template lifted out. A page without one still comes through --
 * a licence page or a publisher's index is not an entry, but knowing it is
 * there is how you tell that from something the split lost.
 */
function readInfobox(text) {
  const at = text.search(/\{\{\s*Infobox[ _]/i);
  if (at === -1) return { kind: null, tmpl: null, fields: {}, body: text.trim() };
  const end = templateEnd(text, at);
  if (end === -1) return { kind: null, tmpl: null, fields: {}, body: text.trim() };

  const args = splitArgs(text.slice(at + 2, end - 2));
  const tmpl = args[0].trim().replace(/\s+/g, ' ');
  const fields = {};
  for (const arg of args.slice(1)) {
    const eq = arg.indexOf('=');
    if (eq === -1) continue;                       // a positional argument, which an infobox does not use
    const key = arg.slice(0, eq).trim().toLowerCase();
    const value = arg.slice(eq + 1).trim();
    if (key) fields[key] = value;
  }
  return {
    kind: tmpl.replace(/^Infobox[ _]/i, '').trim().toLowerCase() || null,
    tmpl,
    fields,
    body: (text.slice(0, at) + text.slice(end)).trim(),
  };
}

/** `[[Category:Source: Ultimate Psionics|sort key]]` -- the category, not the sort key. */
const categories = (text) => [...new Set(
  [...text.matchAll(/\[\[\s*Category\s*:\s*([^\]\|]+)/gi)].map((m) => m[1].trim()),
)];

/* ---------------- the stream ---------------- */

const sink = dry ? null : createWriteStream(out, { encoding: 'utf8' });
const write = (line) => {
  if (dry) return true;
  return sink.write(line);
};

const rl = createInterface({
  input: createReadStream(inputs[0], { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

/** A page, as it accumulates. Reset at every `<page>`. */
let page = null;
/** The revision being read, and the best one seen so far. */
let rev = null;
let best = null;
/** Set while a `<text>` runs past the end of its line. */
let text = null;

const tally = new Map();
let seen = 0;
let kept = 0;
let noBox = 0;
let done = false;

const bump = (k) => tally.set(k, (tally.get(k) || 0) + 1);

const finish = () => {
  const summary = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  process.stderr.write(`\r${' '.repeat(60)}\r`);
  console.log(`${seen} pages read, ${kept} written${dry ? ' (dry run, nothing written)' : ` to ${out}`}`);
  console.log(`  ${summary.length} infobox kinds, ${noBox} pages without one\n`);
  for (const [k, v] of summary) console.log(`  ${String(v).padStart(6)}  ${k}`);
};

for await (const line of rl) {
  if (done) break;
  const t = line.trim();

  if (t === '<page>') { page = { title: null, ns: null, id: null, redirect: null }; best = null; continue; }
  if (!page) continue;

  if (t === '</page>') {
    seen++;
    if (seen % 2000 === 0) process.stderr.write(`\r  ${seen} pages, ${kept} kept…`);
    const take = keepNs.has(page.ns) && (redirects || !page.redirect);
    if (take && best) {
      const box = readInfobox(best.text);
      if (!box.kind) noBox++;
      if (!onlyKinds || (box.kind && onlyKinds.has(box.kind))) {
        if (box.kind) bump(box.kind);
        write(`${JSON.stringify({
          id: page.id,
          title: page.title,
          ns: Number(page.ns),
          ...(page.redirect ? { redirect: page.redirect } : {}),
          kind: box.kind,
          tmpl: box.tmpl,
          fields: box.fields,
          body: box.body,
          cats: categories(best.text),
          rev: best.id,
          ts: best.ts,
        })}\n`);
        if (++kept >= limit) done = true;
      }
    }
    page = null;
    continue;
  }

  // Page-level fields all precede the first <revision>, which is what keeps
  // a revision's own <id> from being read as the page's.
  if (!rev) {
    if (page.title === null && t.startsWith('<title>')) { page.title = unxml(t.slice(7, -8)); continue; }
    if (page.ns === null && t.startsWith('<ns>')) { page.ns = t.slice(4, -5); continue; }
    if (page.id === null && t.startsWith('<id>')) { page.id = Number(t.slice(4, -5)); continue; }
    if (t.startsWith('<redirect ')) { page.redirect = unxml(t.match(/title="([^"]*)"/)?.[1] ?? ''); continue; }
  }

  if (t === '<revision>') { rev = { id: 0, ts: null, text: '' }; continue; }
  if (t === '</revision>') {
    // Ascending order is the export's convention rather than its promise, so
    // the current revision is the highest id seen, not simply the last.
    if (rev && (!best || rev.id >= best.id)) best = rev;
    rev = null;
    continue;
  }
  if (!rev) continue;

  if (text !== null) {
    const at = line.indexOf('</text>');
    if (at === -1) { text.push(line); continue; }
    text.push(line.slice(0, at));
    rev.text = unxml(text.join('\n'));
    text = null;
    continue;
  }

  if (!rev.id && t.startsWith('<id>')) { rev.id = Number(t.slice(4, -5)); continue; }
  if (!rev.ts && t.startsWith('<timestamp>')) { rev.ts = t.slice(11, -12); continue; }

  const open = line.match(/<text\b[^>]*?(\/)?>/);
  if (open) {
    if (open[1]) { rev.text = ''; continue; }          // <text … /> -- empty, or suppressed
    const rest = line.slice(open.index + open[0].length);
    const at = rest.indexOf('</text>');
    if (at === -1) text = [rest];
    else rev.text = unxml(rest.slice(0, at));
  }
}

if (dry) finish();
else sink.end(finish);
