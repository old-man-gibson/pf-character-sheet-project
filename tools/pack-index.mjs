/**
 * Write the `index.json` a folder of extension packs is loaded through.
 *
 * A deployment carries packs in two places: `data/extensions/`, which is the
 * repository's own and ships empty of anybody else's content, and
 * `private/extensions/`, which git ignores -- yours to hold, not the
 * repository's to publish. Either way the sheet *fetches* those packs and
 * keeps them in memory; nothing is written to the browser's storage. That is
 * what makes the folder worth using: a 4 MB catalogue that will not fit in
 * localStorage in every browser loads from here without asking for a byte.
 *
 * The loader reads `index.json` first and then each file it names, so the
 * index is the only thing standing between a pack sitting in the folder and
 * a pack the sheet offers. Rather than hand-write sixteen rows, run this.
 *
 * Usage: node tools/pack-index.mjs [folder]      (default private/extensions)
 *        node tools/pack-index.mjs --check       (fail if the index is stale)
 *
 * Files are found recursively, so `veils/hands-veils.json` is indexed as
 * `veils/hands-veils.json` and stays where it is. Anything that is not an
 * extension pack is named and skipped, not silently dropped.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { inspectExtension, describeSummary } from '../app/js/extensions.js';

const args = process.argv.slice(2);
const check = args.includes('--check');
const folder = args.find((a) => !a.startsWith('--')) || join('private', 'extensions');
const INDEX = join(folder, 'index.json');

if (!existsSync(folder)) {
  console.error(`No such folder: ${folder}`);
  console.error('Nothing to do -- a checkout without one is the ordinary case.');
  process.exit(check ? 0 : 1);
}

/** Every .json under the folder except the index itself and anything `_`. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.json') && full !== INDEX) out.push(full);
  }
  return out;
}

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

const rows = [];
const skipped = [];
let bytes = 0;

for (const file of walk(folder)) {
  const shown = relative(folder, file).split(sep).join('/');
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
    skipped.push([shown, `does not parse -- ${err.message}`]); continue;
  }
  const verdict = inspectExtension(doc);
  if (!verdict.ok) { skipped.push([shown, verdict.error]); continue; }
  const size = statSync(file).size;
  bytes += size;
  rows.push({ row: { id: verdict.summary.id, name: verdict.summary.name, file: shown }, size, summary: verdict.summary });
}

rows.sort((a, b) => a.row.name.localeCompare(b.row.name));
const index = { extensions: rows.map((r) => r.row) };
const json = `${JSON.stringify(index, null, 2)}\n`;

if (check) {
  const current = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';
  if (current === json) { console.log(`${INDEX} is up to date (${rows.length} packs).`); process.exit(0); }
  console.error(`${INDEX} is stale. Run: node tools/pack-index.mjs ${folder}`);
  process.exit(1);
}

writeFileSync(INDEX, json);

for (const r of rows) console.log(`  ${r.row.file.padEnd(34)} ${mb(r.size).padStart(8)}  ${describeSummary(r.summary)}`);
for (const [file, why] of skipped) console.log(`  ${file.padEnd(34)}    skipped  ${why}`);
console.log(`\nWrote ${INDEX}: ${rows.length} pack${rows.length === 1 ? '' : 's'}, ${mb(bytes)} fetched at load and none of it stored.`);
