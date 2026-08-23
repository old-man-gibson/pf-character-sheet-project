/**
 * Turn a pack's veil *blocks* into a veil *table*.
 *
 * Veils used to arrive as blocks, and a block is copied into the character
 * when it is applied. For a veil that was the wrong shape twice over: a
 * shaped veil banked two and a half kilobytes of somebody else's rules text
 * on the sheet, so a corrected pack could not reach a character already
 * playing one, and an exported character stopped being content-free. A table
 * is read where it stands, and the sheet keeps the name and the essence.
 *
 * This rewrites a pack that was scraped before that change. It is lossless in
 * the direction that matters -- name, chakra slots, descriptors, source and
 * the whole of the rules text all move across -- and it recovers one thing
 * the block shape had buried:
 *
 *   **the class list**. `structuredVeil` had nowhere to put "Classes
 *   Available" on a block, so it appended it to the foot of the text as a
 *   `Class access:` line rather than dropping it. A table has a field for it,
 *   so the line is lifted out of the prose and into `classes`, where the
 *   Akashic tab can narrow a slot's picker to the veils this character's
 *   veilweaving classes can actually shape.
 *
 * Usage: node tools/veils-to-table.mjs <pack.json>…      (rewrites in place)
 *        node tools/veils-to-table.mjs <pack.json> --out <file>
 *        node tools/veils-to-table.mjs <dir>              (every .json under it)
 *        node tools/veils-to-table.mjs … --dry            (report, write nothing)
 *
 * A pack with no veil blocks is left alone and said so. Blocks of other kinds
 * stay exactly where they are: a pack may carry a class and its veils both.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeExtension, inspectExtension } from '../app/js/extensions.js';

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

/**
 * Lift `Class access: Daevic, Eclipse` off the foot of a veil's text.
 *
 * It is written as its own paragraph by the reader that put it there, so it
 * comes out cleanly and what is left is the rules text as the page had it.
 * A veil whose page never listed one keeps an empty class list, which the
 * sheet reads as "on every list" rather than "on none" -- a catalogue that
 * only half knows who may shape what must not hide the half it cannot vouch
 * for.
 */
export function liftClassAccess(text) {
  const lines = String(text ?? '').split('\n');
  const classes = [];
  const kept = [];
  for (const line of lines) {
    const m = line.match(/^\s*Class access:\s*(.+?)\s*$/i);
    if (m) {
      for (const c of m[1].split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)) {
        if (!classes.some((x) => x.toLowerCase() === c.toLowerCase())) classes.push(c);
      }
      continue;
    }
    kept.push(line);
  }
  // The line sat in a paragraph of its own, so taking it out leaves the blank
  // line above it against the blank line below. Close that one gap and trim
  // the tail -- and collapse nothing else, because the text's own paragraphs
  // are load-bearing and a converter that reflows them buries its real change.
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const body = kept.join('\n');
  return { text: classes.length ? body.replace(/\n{3,}/g, '\n\n') : body, classes };
}

/** One veil block as a table entry. */
export function veilEntryFromBlock(block) {
  const { text, classes } = liftClassAccess(block.text);
  return {
    name: String(block.name || '').trim(),
    slot: String(block.slot || '').trim(),
    descriptor: String(block.descriptor || '').trim(),
    classes,
    text,
    source: String(block.source || '').trim(),
  };
}

/**
 * A pack, converted. Veils of the same name collapse into one -- a veil
 * shapeable in five chakras is on five of the wiki's slot pages with the same
 * text each time -- and their class lists join, which is how a pack built one
 * page at a time ends up knowing every class that can shape a veil.
 */
export function convertPack(doc) {
  const ext = normalizeExtension(doc);
  const veilBlocks = ext.blocks.filter((b) => b.kind === 'veil');
  if (!veilBlocks.length) return { ext, moved: 0, entries: 0, classed: 0 };

  const byName = new Map();
  for (const block of veilBlocks) {
    const entry = veilEntryFromBlock(block);
    if (!entry.name) continue;
    const key = entry.name.toLowerCase();
    const had = byName.get(key);
    if (!had) { byName.set(key, entry); continue; }
    for (const c of entry.classes) {
      if (!had.classes.some((x) => x.toLowerCase() === c.toLowerCase())) had.classes.push(c);
    }
    // The longer text is the fuller page; the shorter is usually a stub the
    // other slot page carried.
    if (entry.text.length > had.text.length) had.text = entry.text;
    if (!had.descriptor) had.descriptor = entry.descriptor;
    if (!had.source) had.source = entry.source;
  }

  const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  ext.blocks = ext.blocks.filter((b) => b.kind !== 'veil');
  ext.provides = { ...ext.provides, veils: { veils: entries } };
  ext.revision = Math.max(1, Number(ext.revision) || 1) + 1;
  return {
    ext,
    moved: veilBlocks.length,
    entries: entries.length,
    classed: entries.filter((e) => e.classes.length).length,
  };
}

/* ---------------- the command ---------------- */

function main(argv) {
  const args = argv.slice(2);
  const dry = args.includes('--dry');
  const outAt = args.indexOf('--out');
  const outFile = outAt === -1 ? null : args[outAt + 1];
  const targets = args.filter((a, i) => !a.startsWith('--') && !(outAt !== -1 && i === outAt + 1));

  if (!targets.length) {
    console.error('usage: node tools/veils-to-table.mjs <pack.json|dir>… [--out <file>] [--dry]');
    process.exit(1);
  }

  let touched = 0;
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

      const { ext, moved, entries, classed } = convertPack(doc);
      if (!moved) { console.log(`  ${shown}: no veil blocks, left alone`); continue; }

      const classes = new Set(ext.provides.veils.veils.flatMap((v) => v.classes));
      console.log(`  ${shown}: ${moved} block${moved === 1 ? '' : 's'} → ${entries} veil${entries === 1 ? '' : 's'}`
        + `, ${classed} with a class list (${classes.size} classes)${moved === entries ? '' : `, ${moved - entries} duplicate${moved - entries === 1 ? '' : 's'} collapsed`}`);
      if (dry) continue;
      writeFileSync(outFile || file, `${JSON.stringify(ext, null, 1)}\n`);
      touched++;
    }
  }

  console.log(dry ? '\nNothing written (--dry).' : `\n${touched} pack${touched === 1 ? '' : 's'} rewritten.`);

}

// Importable: the tests drive `convertPack` and `liftClassAccess` directly,
// and a module that ran its own command line on import would take the suite
// down with its usage message.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv);
