/**
 * A PDF document into a pack, from the command line.
 *
 *   node tools/pdf-pack.mjs <book.pdf> --list
 *   node tools/pdf-pack.mjs <book.pdf> --out <dir> [--name "The Book"] [--author "Publisher"] [--tags tags.json]
 *
 *     --list          print the sections found and what each was guessed to be, and stop
 *     --out <dir>     where the pack is written (git-ignored `private/`, please)
 *     --name <s>      the book's name: the pack's, and the source on every entry
 *     --author <s>    stamped on the pack -- whoever wrote it
 *     --tags <file>   corrections to the guesses, as JSON: { "<section heading>":
 *                     { "kind": "talents", "sphere": "Tech" } , … } with the kinds
 *                     the extension manager offers (skip, talents, sphere, feats,
 *                     text, options, reference), "entryKind" for reference
 *                     entries, and "className" / "feature" for an options menu
 *     --modules <dir> a folder whose node_modules holds `pdfjs-dist`
 *                     (default private/tool-modules; `npm i pdfjs-dist@4` there)
 *
 * This is **Read a PDF…** from the extension manager without the browser: the
 * same `outlineOf`, the same guesses, the same `readSections`, the same reader
 * behind them. The panel asks a person what each section is; here that is
 * `--list`, then a `--tags` file for whatever the guesses got wrong. Nothing
 * about reading a PDF lives in this file -- only the asking, and writing the
 * pack down.
 *
 * pdf.js is looked up beside the checkout rather than beside the tool, like
 * `js-yaml` in `yaml-docs.mjs`: the app vendors the browser build, which
 * wants a DOM, and Node wants the package's `legacy` one.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { outlineOf, guessTags, readSections } from '../app/js/pdf-import.js';
import { parsePaste, readStructured } from '../app/js/paste-import.js';
import { inspectExtension, normalizeBlock, slugId } from '../app/js/extensions.js';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1]; };
const flag = (name) => argv.includes(`--${name}`);
const input = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && /^--(out|name|author|tags|modules)$/.test(argv[i - 1])));
const out = opt('out');
if (!input || (!out && !flag('list'))) {
  console.error('usage: node tools/pdf-pack.mjs <book.pdf> --list | --out <dir> [--name "…"] [--author "…"] [--tags tags.json]');
  process.exit(2);
}

/* ---------------- the PDF ---------------- */

let pdfjs;
try {
  const require = createRequire(join(resolve(String(opt('modules', 'private/tool-modules'))), 'package.json'));
  pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
} catch {
  console.error('pdfjs-dist was not found. Run `npm i pdfjs-dist@4` in private/tool-modules, or point --modules at a folder that has it.');
  process.exit(1);
}

/** The same shape `readPdf` gives the browser: y measured down from the top. */
async function pagesOf(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: view.width,
      height: view.height,
      items: content.items.filter((it) => it.str && it.str.trim()).map((it) => ({
        str: it.str, x: it.transform[4], y: view.height - it.transform[5], w: it.width,
        size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 0, font: it.fontName || '',
      })),
    });
  }
  return pages;
}

const name = String(opt('name') || basename(input).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim());
const outline = outlineOf(await pagesOf(input), { title: name });
const tags = guessTags(outline);

// A person's corrections, by heading. A heading that is there twice takes the
// same answer twice, which is what anyone naming it meant.
const fixes = opt('tags') ? JSON.parse(readFileSync(opt('tags'), 'utf8')) : {};
const unused = new Set(Object.keys(fixes));
outline.sections.forEach((sec, i) => {
  const fix = fixes[sec.heading];
  if (!fix) return;
  unused.delete(sec.heading);
  tags[i] = { ...tags[i], ...fix };
});

if (flag('list')) {
  console.log(`${outline.sections.length} sections in ${name}:\n`);
  outline.sections.forEach((sec, i) => {
    const t = tags[i];
    const size = sec.entries.length ? `${sec.entries.length} entries` : `${(sec.lead.length / 1000).toFixed(1)}k text`;
    console.log(`  p.${String(sec.page).padEnd(4)} ${t.kind.padEnd(10)} ${(t.sphere || t.entryKind || t.className || '').padEnd(12)} ${size.padStart(12)}  ${sec.heading}`);
  });
  process.exit(0);
}
for (const h of unused) console.warn(`--tags names a section that is not in the book: ${h}`);

/* ---------------- the pack ---------------- */

const result = readSections(outline, tags, { book: name, parsePaste, readStructured });
const provides = {};
if (result.spheres.length) provides.spheres = { spheres: result.spheres };
for (const key of ['feats', 'spells', 'powers']) if (result[key].length) provides[key] = { [key]: result[key] };
if (result.maneuvers.length) {
  const by = new Map();
  for (const m of result.maneuvers.filter((x) => x.discipline)) {
    if (!by.has(m.discipline)) by.set(m.discipline, { name: m.discipline, entries: [] });
    by.get(m.discipline).entries.push(m.entry);
  }
  provides.maneuvers = { disciplines: [...by.values()] };
}
if (result.catalogue.length) {
  const by = new Map();
  for (const { kind, ...entry } of result.catalogue) {
    if (!kind) continue;
    if (!by.has(kind)) by.set(kind, []);
    by.get(kind).push(entry);
  }
  provides.catalogues = { catalogues: [...by].map(([kind, entries]) => ({ kind, entries })) };
}
const now = new Date().toISOString().slice(0, 19);
const pack = {
  format: 'character-sheet-extension',
  formatVersion: 1,
  id: slugId(name),
  name,
  author: String(opt('author') || ''),
  description: `${name}, read from its PDF. Tables come through roughly; check entries against the book.`,
  source: name,
  license: '',
  revision: 1,
  createdAt: now,
  updatedAt: now,
  provides,
  blocks: result.blocks.map((b) => normalizeBlock(b)).filter(Boolean),
};

const verdict = inspectExtension(pack);
if (!verdict.ok) { console.error(`The pack did not validate: ${verdict.error}`); process.exit(1); }
mkdirSync(out, { recursive: true });
const file = join(out, `${pack.id}.json`);
writeFileSync(file, JSON.stringify(pack, null, 1), 'utf8');

console.log(`${name} → ${file} (${(JSON.stringify(pack).length / 1024).toFixed(0)} KB)`);
for (const sp of result.spheres) console.log(`  sphere     ${sp.name}: ${sp.abilities.length} base, ${sp.talents.length} talents`);
for (const key of ['feats', 'spells', 'powers']) if (result[key].length) console.log(`  ${key.padEnd(10)} ${result[key].length}`);
if (result.catalogue.length) console.log(`  reference  ${result.catalogue.length} (${[...new Set(result.catalogue.map((e) => e.kind))].join(', ')})`);
for (const b of pack.blocks) console.log(`  ${b.kind.padEnd(10)} ${b.name}${b.features ? ` (${b.features.length} features)` : ''}`);
if (result.leftovers.length) console.log(`  ${result.leftovers.length} stretch(es) of a class, archetype or race page were not placed — the extension manager's review is where those get tagged.`);
