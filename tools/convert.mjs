/*
 * Convert Pathfinder character workbooks into the app's JSON schema — the same
 * job as `tools/convert.py`, from Node instead of Python.
 *
 * Both exist because both are sometimes the only one available. The Python
 * converter is the original; this one shares its extraction logic with the
 * in-browser converter
 * (app/js/convert.js), needs nothing installed, and works on a machine where
 * `python` is the Microsoft Store stub rather than an interpreter.
 *
 * `tests/convert.test.mjs` proves the two produce identical documents.
 *
 *   node tools/convert.mjs path/to/kaito.xlsx --id kaito       add one character
 *   node tools/convert.mjs --out private/characters --raw private/raw
 *                                                             rebuild a whole roster
 *
 * The published app bundles no characters -- each visitor adds their own, kept
 * in their browser -- so there is no roster in this file. A roster is whatever
 * a deployment lists in <out>/index.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { EOL } from 'node:os';
import { convertWorkbook, indexEntry, warningsFor, slug } from '../app/js/convert.js';

const RAW_DIR = 'data/raw';
const OUT_DIR = 'data/characters';

const USAGE = `Convert Pathfinder character workbooks into the app's JSON.

  node tools/convert.mjs [workbook] [options]

With no workbook, rebuilds every character listed in <out>/index.json from
<raw>/<id>.xlsx and rewrites the index.

  --id <id>        character id and filename stem (default: the workbook's filename)
  --name <title>   source sheet title recorded in the document
  --file-id <id>   Google Sheets file id, to record a link back to the source
  --out <dir>      output directory (default: ${OUT_DIR})
  --raw <dir>      where a roster rebuild finds <id>.xlsx (default: ${RAW_DIR})
  --dry-run        report what would be written without writing it
  -h, --help       show this message`;

function parseArgs(argv) {
  const opts = { out: OUT_DIR, raw: RAW_DIR, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (name) => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${name} needs a value`);
      return v;
    };
    if (a === '--id') opts.id = need('--id');
    else if (a === '--name') opts.name = need('--name');
    else if (a === '--file-id') opts.fileId = need('--file-id');
    else if (a === '--out') opts.out = need('--out');
    else if (a === '--raw') opts.raw = need('--raw');
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option: ${a}`);
    else rest.push(a);
  }
  if (rest.length > 1) throw new Error('only one workbook at a time');
  opts.workbook = rest[0];
  return opts;
}

/** `datetime.now().isoformat(timespec="seconds")`, in local time as Python's is. */
function localNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Match `json.dump(..., indent=1, ensure_ascii=False)` written to a text-mode
 * file, so converting with Node and converting with Python produce the same
 * bytes on the same machine — down to the line ending Python translates to, and
 * the trailing newline it does not write. Only structural newlines are
 * rewritten; one inside a string is already escaped as a literal `\n`.
 */
const dump = (value) => JSON.stringify(value, null, 1).replace(/\n/g, EOL);

function writeCharacter(key, doc, outDir) {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${key}.json`);
  writeFileSync(path, dump(doc), 'utf8');
  return [path, statSync(path).size];
}

/** Add or replace one row in index.json, keeping the existing order. */
function upsertIndex(entry, outDir) {
  const path = join(outDir, 'index.json');
  let rows = [];
  if (existsSync(path)) {
    try {
      rows = JSON.parse(readFileSync(path, 'utf8')).characters ?? [];
    } catch { /* a damaged index is rebuilt rather than inherited */ }
  }
  const at = rows.findIndex((r) => r.id === entry.id);
  if (at >= 0) rows[at] = entry;
  else rows.push(entry);
  writeFileSync(path, dump({ characters: rows }), 'utf8');
  return rows.length;
}

const pad = (s, n) => String(s).padEnd(n);

function summaryLine(key, doc, size) {
  const ident = doc.identity;
  return `${pad(key, 10)} ${pad(String(ident.name).slice(0, 28), 30)} `
    + `L${pad(ident.level, 3)} skills=${String(doc.skills.length).padStart(3)} `
    + `named=${String(Object.keys(doc.named).length).padStart(3)} `
    + `extra=${Object.keys(doc.extraTabs).length} `
    + `${size.toLocaleString('en-US').padStart(8)}b`;
}

/**
 * Rebuild every bundled character.
 *
 * The roster comes from the existing index, and each character's title and
 * Sheets link from the document already on disk, so nothing about who the
 * characters are lives in this script.
 */
async function convertAll(outDir, rawDir) {
  const indexPath = join(outDir, 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`error: no ${indexPath} to rebuild from — convert a workbook by name first`);
    return 1;
  }
  const roster = JSON.parse(readFileSync(indexPath, 'utf8')).characters ?? [];
  const index = [];
  for (const row of roster) {
    const raw = join(rawDir, `${row.id}.xlsx`);
    if (!existsSync(raw)) {
      console.log(`skipped  ${row.id}: no ${raw}`);
      continue;
    }
    let prior = {};
    try {
      prior = JSON.parse(readFileSync(join(outDir, `${row.id}.json`), 'utf8')).source ?? {};
    } catch { /* no prior document: fall back to the defaults below */ }
    // The sheet title and Google file id live only in the converted document,
    // not in the index, so rebuilding without one loses the link back to
    // Drive. It is recoverable with --file-id, but only if you are told.
    if (!prior.fileId) {
      console.log(`note     ${row.id}: no recorded Sheets link — `
        + `re-run with --file-id to restore it`);
    }
    const doc = await convertWorkbook(readFileSync(raw), {
      id: row.id,
      title: prior.title ?? row.name ?? row.id,
      fileId: prior.fileId ?? '',
      convertedAt: localNow(),
    });
    const [, size] = writeCharacter(row.id, doc, outDir);
    index.push(indexEntry(row.id, doc));
    console.log(summaryLine(row.id, doc, size));
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.json'), dump({ characters: index }), 'utf8');
  console.log(`\nWrote ${index.length} characters + index to ${outDir}/`);
  return 0;
}

/** Convert a single workbook and slot it into index.json. */
async function convertOne(opts) {
  const path = opts.workbook;
  if (!existsSync(path)) {
    console.error(`error: no such file: ${path}`);
    return 1;
  }
  if (!/\.xls[xm]$/i.test(path)) {
    console.error(`error: expected an .xlsx workbook, got ${basename(path)}`);
    return 1;
  }

  const stem = basename(path).replace(/\.[^.]*$/, '');
  const key = opts.id || slug(stem);
  const outDir = opts.out;

  // Re-converting an updated workbook keeps the title and Sheets link already
  // recorded, so a plain re-run does not quietly downgrade them to defaults.
  let prior = {};
  const existing = join(outDir, `${key}.json`);
  if (existsSync(existing)) {
    try {
      prior = JSON.parse(readFileSync(existing, 'utf8')).source ?? {};
    } catch { /* unreadable prior document: fall back to the defaults below */ }
  }

  console.log(`reading  ${path}`);
  const doc = await convertWorkbook(readFileSync(path), {
    id: key,
    title: opts.name ?? prior.title ?? stem,
    fileId: opts.fileId ?? prior.fileId ?? '',
    convertedAt: localNow(),
  });

  const structured = doc.tabs.filter((t) => [
    'Character Info', 'Stats', 'Planner', 'Feats', 'Mythic', 'Equipment',
    'Background & Lore', 'Combat Training', 'Magic Training',
  ].includes(t.name)).length;
  console.log(`tabs     ${doc.tabs.length} (${structured} structured, `
    + `${Object.keys(doc.extraTabs).length} captured verbatim)`);

  for (const w of warningsFor(doc)) console.log(`warning  ${w}`);

  if (opts.dryRun) {
    console.log(`dry run  would write ${join(outDir, `${key}.json`)} and index it as "${key}"`);
    return 0;
  }

  const verb = existsSync(existing) ? 'replaced' : 'wrote';
  const [written, size] = writeCharacter(key, doc, outDir);
  const count = upsertIndex(indexEntry(key, doc), outDir);
  console.log(`${pad(verb, 8)} ${written}  (${size.toLocaleString('en-US')}b)`);
  console.log(`updated  ${join(outDir, 'index.json')}  (${count} characters)`);
  return 0;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  if (!opts.workbook) {
    for (const [flag, name] of [['id', '--id'], ['name', '--name'], ['fileId', '--file-id']]) {
      if (opts[flag] !== undefined) {
        console.error(`error: ${name} only applies to a single workbook`);
        return 2;
      }
    }
    if (opts.dryRun) {
      console.error('error: --dry-run only applies to a single workbook');
      return 2;
    }
    return convertAll(opts.out, opts.raw);
  }
  return convertOne(opts);
}

try {
  process.exit(await main());
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
