/**
 * Run the scrape-residue tidy over a pack that was built before it existed.
 *
 * A scrape that cuts a page mid-construct leaves marks: a `{{…}}` call whose
 * opening line was dropped and whose closing one was kept, a wiki link that
 * never got converted, a non-breaking space where a space was meant. The
 * reader strips those now — but a pack already written carries whatever the
 * reader of the day let through, and the documents it was made from are
 * usually long gone.
 *
 * So this applies the *same function* the reader applies,
 * `tidyScrapeResidue` from `app/js/paste-import.js`, to every stretch of text
 * a pack holds: its veils' text, its blocks' text, its spheres' abilities and
 * talents, its maneuvers' cells. There is deliberately no second
 * implementation to drift from the first — a re-scrape and a tidied-up pack
 * come out agreeing rather than nearly agreeing.
 *
 * Usage: node tools/tidy-pack-text.mjs <pack.json|dir>…   (rewrites in place)
 *        node tools/tidy-pack-text.mjs … --dry            (report, change nothing)
 *
 * The report says how many fields changed and shows the first few, because a
 * text tidy is exactly the kind of pass that should be read before it is
 * trusted. A pack it changes nothing in is left untouched, revision and all.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeExtension, inspectExtension } from '../app/js/extensions.js';
import { tidyScrapeResidue } from '../app/js/paste-import.js';

/** Every text-bearing field in a pack, as get/set pairs over the document. */
function textFields(ext) {
  const out = [];
  const field = (obj, key, where) => {
    if (typeof obj?.[key] === 'string' && obj[key]) {
      out.push({ where, get: () => obj[key], set: (v) => { obj[key] = v; } });
    }
  };

  for (const [i, b] of (ext.blocks || []).entries()) {
    for (const key of ['text', 'optionsInfo']) field(b, key, `block ${i} ${b.name || ''} ${key}`);
    for (const [j, f] of (b.features || []).entries()) field(f, 'text', `block ${i} feature ${j} ${f.name || ''}`);
    for (const [j, o] of (b.options || []).entries()) field(o, 'text', `block ${i} option ${j} ${o.name || ''}`);
    for (const [j, t] of (b.traits || []).entries()) field(t, 'text', `block ${i} trait ${j} ${t.name || ''}`);
  }

  const p = ext.provides || {};
  for (const [i, v] of (p.veils?.veils || []).entries()) {
    for (const key of ['text', 'effect', 'bindEffect']) field(v, key, `veil ${v.name || i} ${key}`);
  }
  for (const [i, s] of (p.spheres?.spheres || []).entries()) {
    field(s, 'description', `sphere ${s.name || i}`);
    for (const [j, a] of (s.abilities || []).entries()) field(a, 'text', `sphere ${s.name || i} ability ${a.name || j}`);
    for (const [j, t] of (s.talents || []).entries()) {
      for (const key of ['text', 'prerequisites']) field(t, key, `sphere ${s.name || i} talent ${t.name || j} ${key}`);
    }
  }
  for (const [i, d] of (p.maneuvers?.disciplines || []).entries()) {
    for (const [j, e] of (d.entries || []).entries()) {
      for (const key of ['text', 'action', 'range', 'target', 'duration', 'save', 'dc']) {
        field(e, key, `discipline ${d.name || i} ${e.name || j} ${key}`);
      }
    }
  }
  return out;
}

/** A pack, tidied. Returns what changed rather than only how much. */
export function tidyPack(doc) {
  const ext = normalizeExtension(doc);
  const changes = [];
  for (const f of textFields(ext)) {
    const before = f.get();
    const after = tidyScrapeResidue(before);
    if (after === before) continue;
    f.set(after);
    changes.push({ where: f.where, before, after });
  }
  if (changes.length) ext.revision = Math.max(1, Number(ext.revision) || 1) + 1;
  return { ext, changes };
}

/* ---------------- the command ---------------- */

/** Every .json under a path, or the path itself when it is one. */
function files(path) {
  if (!statSync(path).isDirectory()) return [path];
  const out = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'index.json') continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else if (entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

/** The change, on one line, with the newlines made visible. */
const show = (s) => {
  const flat = s.replace(/\n/g, '⏎').slice(0, 96);
  return flat.length < s.length ? `${flat}…` : flat;
};

function main(argv) {
  const args = argv.slice(2);
  const dry = args.includes('--dry');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('usage: node tools/tidy-pack-text.mjs <pack.json|dir>… [--dry]');
    process.exit(1);
  }

  let touched = 0;
  let fields = 0;
  for (const target of targets) {
    for (const file of files(target)) {
      const shown = relative(process.cwd(), file).split(sep).join('/');
      let doc;
      try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
        console.log(`  ${shown}: does not parse — ${err.message}`);
        continue;
      }
      const verdict = inspectExtension(doc);
      if (!verdict.ok) { console.log(`  ${shown}: ${verdict.error}`); continue; }

      const { ext, changes } = tidyPack(doc);
      if (!changes.length) { console.log(`  ${shown}: already clean`); continue; }

      console.log(`  ${shown}: ${changes.length} field${changes.length === 1 ? '' : 's'} tidied`);
      for (const c of changes.slice(0, 3)) {
        console.log(`      ${c.where}`);
        console.log(`        was  ${show(c.before)}`);
        console.log(`        now  ${show(c.after)}`);
      }
      if (changes.length > 3) console.log(`      … and ${changes.length - 3} more`);
      fields += changes.length;
      if (dry) continue;
      writeFileSync(file, `${JSON.stringify(ext, null, 1)}\n`);
      touched++;
    }
  }

  console.log(dry
    ? `\n${fields} field(s) would change. Nothing written (--dry).`
    : `\n${fields} field(s) tidied across ${touched} pack(s).`);
}

// Importable: the tests drive `tidyPack` directly, and a module that ran its
// own command line on import would take the suite down with its usage message.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv);
