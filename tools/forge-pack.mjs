/**
 * Turn a Homebrew Workbench project into an extension pack, and shelve it.
 *
 * Homebrew Workbench is the homebrew workbench (forge/ in this repository) where the
 * campaign's own disciplines, feats, classes and lore are written. It exports
 * one JSON of everything it holds -- `format: "homebrew-workbench"` (older exports say `primordia-forge`) -- and this
 * tool reads that export into the one shape the sheet loads: a pack.
 *
 *   node tools/forge-pack.mjs <forge-export.json>
 *   node tools/forge-pack.mjs <forge-export.json> --out private/extensions/homebrew-workbench.json
 *   node tools/forge-pack.mjs <pack.json>                  (already a pack: shelved as it is)
 *
 * The pack lands in `private/extensions/` by default (git-ignored, loaded)
 * and the folder's index is rewritten, so the sheet offers it on the next
 * load. A pack already at the output path hands its revision up by one.
 *
 * What goes where -- the mapping lives in `app/js/forge-pack.js`, which the
 * Forge page (`forge/`) imports too, so a file from either route is the same
 * file:
 *
 *   discipline + maneuvers  -> provides.maneuvers.disciplines   (the shared table)
 *   feat                    -> provides.feats.feats
 *   spell                   -> provides.spells.spells
 *   class (+ its features)  -> a `class` block
 *   archetype (+ features)  -> an `archetype` block
 *   race                    -> a `race` block
 *   trait (category Race)   -> a `trait` block
 *   loose class feature     -> a `feature` block
 *   everything else         -> provides.catalogues, grouped by kind
 *                              (trait, item, creature, npc, location,
 *                              campaign, session, article, discipline)
 *
 * Forge prose carries `[[wiki links]]` and light markdown; the sheet's cells
 * are plain prose, so links become their label and emphasis marks come off.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { forgeToPack } from '../app/js/forge-pack.js';
export { forgeToPack, plainText } from '../app/js/forge-pack.js';

/* ---------------- the command ---------------- */

const here = dirname(fileURLToPath(import.meta.url));
const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const input = args.find((a) => !a.startsWith('--') && a !== opt('--out') && a !== opt('--id') && a !== opt('--name'));
  if (!input) {
    console.error('Usage: node tools/forge-pack.mjs <forge-export.json | pack.json> [--out private/extensions/homebrew-workbench.json] [--id id] [--name name]');
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(input, 'utf8'));
  const out = opt('--out') || join(here, '..', 'private', 'extensions', `${opt('--id') || 'homebrew-workbench'}.json`);
  const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  let pack;
  if (doc.format === 'character-sheet-extension') {
    pack = doc;
    if (previous && Number(previous.revision) >= Number(pack.revision || 1)) pack.revision = Number(previous.revision) + 1;
  } else if ((doc.format === 'homebrew-workbench' || doc.format === 'primordia-forge') && Array.isArray(doc.entries)) {
    pack = forgeToPack(doc.entries, {
      customTypes: doc.customTypes,
      id: opt('--id') || previous?.id, name: opt('--name') || previous?.name, author: previous?.author,
      source: previous?.source, license: previous?.license, createdAt: previous?.createdAt,
      revision: previous ? Number(previous.revision) + 1 : 1,
    });
  } else {
    console.error(`Not a Forge export or a pack (format is ${JSON.stringify(doc.format ?? null)}).`);
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(pack, null, 1)}\n`);
  const tables = Object.entries(pack.provides || {}).map(([k, t]) => `${k}: ${Object.values(t)[0]?.length ?? 0}`).join(', ');
  console.log(`Wrote ${out} (rev ${pack.revision}; ${tables || 'no tables'}; ${(pack.blocks || []).length} blocks)`);
  const folder = dirname(out);
  const r = spawnSync(process.execPath, [join(here, 'pack-index.mjs'), folder], { stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}
