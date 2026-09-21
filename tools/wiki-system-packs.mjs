/**
 * The folders `wiki-docs.mjs --by system` (or `--by book`) wrote, as one pack
 * per system or per book.
 *
 *   node tools/wiki-system-packs.mjs <folders-dir> --out <dir> [options]
 *
 *     --out <dir>     where the packs are written (required)
 *     --split <mb>    a folder whose documents pass this (default 10) leaves
 *                     as several packs rather than one
 *     --author <s>    stamped on each pack; otherwise the folder's `_author`
 *                     (a book's publisher), or nothing
 *
 * It reads nothing itself. Every pack is a `scrape-pack.mjs --one` run over a
 * folder, or over some of a folder's files, so the reader in
 * `paste-import.js` stays the only one and this is only the loop somebody
 * would otherwise type. The runs pass `--structured`, because these documents
 * are known to be the scraper's: a book that adds a single talent to a sphere
 * is a document of two field lines, and the paste panel's guess wants three.
 *
 * The one decision it makes is for a folder too big to be one pack -- which
 * in practice is the general group that belongs to no system.
 * A kind with a megabyte of its own (feats, spells, archetypes…) becomes
 * `<System> — Feats`, and the long tail of small kinds shares
 * `<System> — Reference`, so the split is seven packs and not thirty.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(out|split|author)$/.test(argv[i - 1])));
const out = opt('out');
const split = (Number(opt('split', 10)) || 10) * 1024 * 1024;
const authorOpt = opt('author');

if (inputs.length !== 1 || !out) {
  console.error('usage: node tools/wiki-system-packs.mjs <folders-dir> --out <dir> [--split 10] [--author X]');
  process.exit(2);
}

const scrapePack = join(dirname(fileURLToPath(import.meta.url)), 'scrape-pack.mjs');
const OWN_PACK = 1024 * 1024;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/*
 * Builds are queued and run a few at a time. A dozen folders do not need it;
 * several hundred, each a fresh node that loads the reader, are slow one
 * after another.
 */
const jobs = [];
const build = (name, id, author, files) => jobs.push({ name, id, author, files });

/** One `scrape-pack --one` run; its report is kept to the lines worth reading. */
const run = ({ name, id, author, files }) => new Promise((resolve) => {
  const child = spawn(process.execPath, [scrapePack, ...files, '--out', out, '--one', name, '--id', id, '--author', author, '--structured']);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (status) => {
    if (status !== 0) { console.error(`${name}\n${stderr || stdout}`); process.exit(status ?? 1); }
    const lines = stdout.split('\n');
    const size = (lines.find((l) => /\.json\s*$/.test(l)) || '').trim();
    const notes = lines.filter((l) => /unplaced|\bnothing\b/.test(l)).map((l) => `      ${l.trim()}`);
    console.log([name, `  ${size}`, ...notes].join('\n'));
    resolve();
  });
});

/** "Feats (2 of 3)" and "Feats (1 of 3)" are one kind. */
const kindOf = (file) => readFileSync(file, 'utf8').split('\n', 1)[0].replace(/^#\s*/, '').replace(/\s*\(\d+ of \d+\)\s*$/, '').trim();

for (const d of readdirSync(inputs[0]).sort()) {
  const folder = join(inputs[0], d);
  if (!statSync(folder).isDirectory() || !existsSync(join(folder, '_name'))) continue;
  const system = readFileSync(join(folder, '_name'), 'utf8').trim();
  const author = String(authorOpt ?? (existsSync(join(folder, '_author')) ? readFileSync(join(folder, '_author'), 'utf8').trim() : ''));
  const files = readdirSync(folder).filter((f) => f.endsWith('.md')).sort().map((f) => join(folder, f));
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  // The folder's name is the pack's id: `wiki-docs` already made it unique,
  // which a slug of the book's title cut at sixty characters is not.
  if (bytes <= split) { build(system, d, author, files); continue; }

  const kinds = new Map();
  for (const f of files) {
    const k = kindOf(f);
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k).push(f);
  }
  const rest = [];
  for (const [kind, group] of kinds) {
    if (group.reduce((n, f) => n + statSync(f).size, 0) >= OWN_PACK) build(`${system} — ${kind}`, `${d}-${slug(kind)}`, author, group);
    else rest.push(...group);
  }
  if (rest.length) build(`${system} — Reference`, `${d}-reference`, author, rest);
}

let next = 0;
const worker = async () => { while (next < jobs.length) await run(jobs[next++]); };
await Promise.all(Array.from({ length: Math.max(2, Math.min(8, availableParallelism() - 1)) }, worker));
console.log(`\n${jobs.length} pack(s) written to ${out}`);
