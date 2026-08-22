/**
 * Scraper documents into extension packs.
 *
 * The paste panel in the extension manager reads one document at a time,
 * which is the right shape when a player has copied a page. A scraper that
 * has just walked a whole wiki hands over a directory, and pasting sixteen
 * files of up to a megabyte each -- and ticking two thousand checkboxes --
 * is not that. This runs the same reader over a directory and writes the
 * packs, so what arrives in the browser is one **Import a pack…** each.
 *
 * It is the *same* reader: `parsePaste` from `app/js/paste-import.js`, no
 * second implementation to drift from the one the panel uses. Whatever the
 * panel would have made of a document is what lands here.
 *
 *   node tools/scrape-pack.mjs <dir-or-file>… --out <dir> [options]
 *
 *     --out <dir>     where the packs are written (required)
 *     --match <glob>  only files whose name matches, e.g. '*_veils.md'
 *     --one <name>    one pack of everything, under this name, deduplicated
 *     --sort <how>    'name' (default) or 'bind': by the chakra a veil binds
 *                     to first, then by name
 *     --bind-order <list>  the chakra sequence `--sort bind` uses, e.g.
 *                     'Hands,Feet,Head,…'; alphabetical when not given
 *     --author <s>    stamped on each pack
 *     --dry           report what it would write, write nothing
 *
 * Packs are content, and content is a publisher's: write them somewhere
 * git-ignored (`private/`) rather than into `data/extensions/`, which ships.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { parsePaste } from '../app/js/paste-import.js';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const flag = (name) => argv.includes(`--${name}`);
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(out|match|one|author|sort|bind-order)$/.test(argv[i - 1])));

const out = opt('out');
const match = opt('match');
const one = opt('one');
const author = opt('author', 'Scraped');
const sort = String(opt('sort', 'name'));
const bindOrder = opt('bind-order');
const dry = flag('dry');

if (!inputs.length || !out) {
  console.error('usage: node tools/scrape-pack.mjs <dir-or-file>… --out <dir> [--match "*_veils.md"] [--one "Name"] [--sort name|bind] [--bind-order "Hands,Feet,…"] [--author X] [--dry]');
  process.exit(2);
}
if (!['name', 'bind'].includes(sort)) { console.error(`--sort takes 'name' or 'bind', not ${sort}`); process.exit(2); }

/** A shell glob, as far as a filename needs one. */
const globRe = (g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const wanted = match ? globRe(match) : /\.(md|markdown|txt)$/i;

/** Every file named, and every matching file inside every directory named. */
const files = [];
for (const input of inputs) {
  if (statSync(input).isDirectory()) {
    for (const f of readdirSync(input).sort()) if (wanted.test(f)) files.push(join(input, f));
  } else files.push(input);
}
if (!files.length) { console.error(`Nothing matched ${match || 'a markdown file'} in ${inputs.join(', ')}.`); process.exit(1); }

/* ---------------- reading ---------------- */

const slugId = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const titleOf = (file) => basename(file, extname(file)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());
// `new Date()` rather than a fixed stamp: a pack records when it was built,
// and these are written by hand rather than by a test that must repeat.
const now = new Date().toISOString().slice(0, 19);

const read = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const r = parsePaste(text);
  read.push({ file, name: titleOf(file), result: r });
  const kinds = new Map();
  for (const b of r.blocks) kinds.set(b.kind, (kinds.get(b.kind) || 0) + 1);
  const what = [...kinds].map(([k, n]) => `${n} ${k}`).join(', ')
    || (r.spheres.length ? `${r.spheres.length} sphere(s)` : '')
    || (r.maneuvers.length ? `${r.maneuvers.length} maneuver(s)` : '')
    || 'nothing';
  console.log(`${basename(file).padEnd(24)} ${what}${r.leftovers.length ? `; ${r.leftovers.length} unplaced` : ''}`);
}

/* ---------------- ordering ---------------- */

/**
 * The chakra a veil binds to first.
 *
 * Two forms, both the page's own: nearly every veil heads each bind
 * `##### Chakra Bind: [Belt]`, which arrives here as a line of its own, while
 * eighteen of them write it inline as `**Chakra Bind (Belt):** …`.
 *
 * There is no bind *level* to be had. On the wiki a bind is the template call
 * `{{Chakra Bind|Belt}}`, whose only argument is the slot -- checked across
 * all 2,149 -- and the level is what the template works out from the veil's
 * class list and prints as a footnote. The scrape captured the call, not its
 * expansion, so `==Bind Level==` arrives standing over an empty
 * `<references group="Bind Level"/>`. It was never in the source to lose. A
 * level would have to come from the (class, slot) table instead.
 */
const BIND = /Chakra Bind\s*(?::\s*\[([^\]\n]+)\]|\(([^)\n]+)\))/;
const firstBind = (b) => ((String(b.text ?? '').match(BIND) || [])[1] || (String(b.text ?? '').match(BIND) || [])[2] || '').trim();

/**
 * `--bind-order` when it was given, alphabetical otherwise.
 *
 * No order is assumed: the veils' own `Shapeable Slot(s)` lists were tried as
 * a source for one and contradict each other freely -- Shoulders precedes
 * Body 34 times and follows it 13 -- so they are a set, not a sequence, and
 * the chakra ladder is a rules table this tool has no business inventing.
 */
const order = bindOrder ? String(bindOrder).split(/\s*,\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
const bindRank = (b) => {
  const slot = firstBind(b);
  if (!slot) return [2, 0, ''];                       // binds nowhere: last
  const l = slot.toLowerCase();
  return order ? [1, order.indexOf(l) === -1 ? order.length : order.indexOf(l), l] : [1, 0, l];
};
const byBind = (a, b) => {
  const [x, y] = [bindRank(a), bindRank(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return a.name.localeCompare(b.name);
};
const ordered = (blocks) => [...blocks].sort(sort === 'bind' ? byBind : (a, b) => a.name.localeCompare(b.name));

/* ---------------- writing ---------------- */

const pack = (id, name, blocks, provides, sources) => ({
  format: 'character-sheet-extension',
  formatVersion: 1,
  id,
  name,
  author,
  description: `${blocks.length} entr${blocks.length === 1 ? 'y' : 'ies'} read from a scraper document.`,
  source: sources.slice(0, 3).join('; '),
  license: '',
  revision: 1,
  createdAt: now,
  updatedAt: now,
  provides,
  blocks,
});

mkdirSync(out, { recursive: true });
const wrote = [];
const write = (doc) => {
  const path = join(out, `${doc.id}.json`);
  const json = JSON.stringify(doc, null, 1);
  if (!dry) writeFileSync(path, json, 'utf8');
  wrote.push({ path, blocks: doc.blocks.length, bytes: json.length });
};

const provisions = (results) => {
  const provides = {};
  const spheres = results.flatMap((r) => r.spheres);
  const maneuvers = results.flatMap((r) => r.maneuvers).filter((m) => m.discipline);
  if (spheres.length) provides.spheres = { spheres };
  if (maneuvers.length) {
    const by = new Map();
    for (const m of maneuvers) {
      if (!by.has(m.discipline)) by.set(m.discipline, { name: m.discipline, entries: [] });
      by.get(m.discipline).entries.push(m.entry);
    }
    provides.maneuvers = { disciplines: [...by.values()] };
  }
  return provides;
};

if (one) {
  /*
   * One pack of the lot. A veil shapeable in five chakras is on five of the
   * slot pages with the same text each time, so the same name twice is one
   * veil rather than two: 2,149 entries are 1,496 veils. The first wins --
   * they are copies, not versions.
   */
  const seen = new Map();
  for (const { result } of read) for (const b of result.blocks) if (!seen.has(b.name.toLowerCase())) seen.set(b.name.toLowerCase(), b);
  const blocks = ordered([...seen.values()]);
  const dupes = read.reduce((n, r) => n + r.result.blocks.length, 0) - blocks.length;
  if (dupes) console.log(`\n${dupes} entr${dupes === 1 ? 'y was a duplicate' : 'ies were duplicates'} of another file's, and were dropped.`);
  // Each kept copy carries the whole `Shapeable Slot(s)` list, so dropping the
  // others loses no slot -- checked: every duplicate is identical, and every
  // veil's own list already names every page it appeared on.
  if (sort === 'bind') {
    const groups = new Map();
    for (const b of blocks) {
      const k = firstBind(b) || '(binds nowhere)';
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    console.log(`\nSorted by first chakra bind${order ? '' : ', alphabetically'}:`);
    for (const [k, n] of groups) console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  write(pack(slugId(one), one, blocks, provisions(read.map((r) => r.result)), read.map((r) => basename(r.file))));
} else {
  for (const { file, name, result } of read) {
    write(pack(slugId(name), name, ordered(result.blocks), provisions([result]), [basename(file)]));
  }
}

/* ---------------- what it did ---------------- */

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`\n${dry ? 'Would write' : 'Wrote'} ${wrote.length} pack(s) to ${out}:`);
for (const w of wrote.sort((a, b) => b.bytes - a.bytes)) console.log(`  ${kb(w.bytes).padStart(8)}  ${String(w.blocks).padStart(5)} blocks  ${basename(w.path)}`);
const total = wrote.reduce((n, w) => n + w.bytes, 0);
console.log(`  ${kb(total).padStart(8)}  total`);
/*
 * A pack lives in localStorage beside the characters, so the total is worth
 * saying out loud -- but not with a number attached. The old "5 MB" rule of
 * thumb is long dead: measured in this app's Chromium the origin took 49.8 MB
 * before it threw, and 1,496 veils in one 4.2 MB pack imported in a few
 * seconds and opened for editing in 298 ms. Other engines are stingier, and
 * the budget moves with free disk, so the honest thing is the size and a
 * pointer at what to do if it ever does throw.
 */
if (total > 8 * 1024 * 1024) {
  console.log(`\n${kb(total)} in one browser origin, shared with the characters. If a`);
  console.log('save ever throws, import the packs you want rather than all of them;');
  console.log('each is independent.');
}
