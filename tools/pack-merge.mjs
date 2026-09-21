/**
 * One pack's tables, joined into another's.
 *
 *   node tools/pack-merge.mjs <target.json> <source.json>… [--dry]
 *
 * For a pack that was built in two sittings, or from two kinds of source: a
 * table's worth of talents read from one set of documents and a few whole
 * spheres written up separately. It is still one book to the people at the
 * table, and they want one thing to import.
 *
 * It joins by `mergeTables` -- the app's own rule for what happens when two
 * packs name the same thing -- one table at a time, so a sphere gains the
 * talents and base abilities it lacked and keeps the ones it had, a feat of
 * the same name is the source's, and a table the source does not carry is not
 * touched. Blocks are joined by name the same way. Nothing here decides
 * anything the app would not decide on loading both packs; it only does it
 * once, on disk.
 *
 * The target is rewritten in place, with its revision bumped and the source
 * named in its `source` line. A target that is *rebuilt* (the wiki pipeline
 * writes its packs from scratch) loses what was merged into it, so keep the
 * source pack and run this again after a rebuild.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { mergeTables } from '../app/js/extensions.js';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const files = argv.filter((a) => !a.startsWith('--'));
if (files.length < 2) {
  console.error('usage: node tools/pack-merge.mjs <target.json> <source.json>… [--dry]');
  process.exit(2);
}

const [targetPath, ...sourcePaths] = files;
const target = JSON.parse(readFileSync(targetPath, 'utf8'));
target.provides = target.provides && typeof target.provides === 'object' ? target.provides : {};

/** How many entries a table holds, whatever its shape, for the report. */
const size = (table) => {
  const lists = Object.values(table ?? {}).filter(Array.isArray);
  return lists.reduce((n, list) => n + list.reduce((k, e) => k
    + (Array.isArray(e?.talents) ? e.talents.length : Array.isArray(e?.entries) ? e.entries.length : 1), 0), 0);
};

for (const sourcePath of sourcePaths) {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  console.log(`${basename(sourcePath)} → ${basename(targetPath)}`);
  for (const key of Object.keys(source.provides ?? {})) {
    const before = size(target.provides[key]);
    // One table at a time, so that a table the source does not carry is left
    // exactly as it was rather than round-tripped through the merge.
    const joined = mergeTables([{ provides: { [key]: target.provides[key] ?? {} } }, { provides: { [key]: source.provides[key] } }])[key];
    target.provides[key] = joined;
    console.log(`  ${key.padEnd(12)} ${String(before).padStart(6)} → ${String(size(joined)).padStart(6)} entries`);
  }
  if ((source.blocks ?? []).length) {
    const at = new Map((target.blocks ?? []).map((b, i) => [String(b?.name).toLowerCase(), i]));
    target.blocks = [...(target.blocks ?? [])];
    for (const b of source.blocks) {
      const i = at.get(String(b?.name).toLowerCase());
      if (i === undefined) target.blocks.push(b); else target.blocks[i] = b;
    }
    console.log(`  blocks       ${String(at.size).padStart(6)} → ${String(target.blocks.length).padStart(6)}`);
  }
  const said = String(target.source ?? '');
  const name = source.name || basename(sourcePath);
  if (!said.includes(name)) target.source = [said, `merged: ${name}`].filter(Boolean).join('; ');
}

target.revision = (Number(target.revision) || 1) + 1;
target.updatedAt = new Date().toISOString().slice(0, 19);
if (dry) console.log('(dry run, nothing written)');
else {
  writeFileSync(targetPath, JSON.stringify(target, null, 1), 'utf8');
  console.log(`wrote ${targetPath} (revision ${target.revision})`);
}
