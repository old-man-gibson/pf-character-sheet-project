/**
 * Print the audit diff between two character documents.
 *
 * The GM's question is "is this legitimate", not "what is different", so the
 * changes come back sorted by what a reader has to do about each one: totals
 * nothing accounts for first, then what the player wrote, then what arrived or
 * left, and last the arithmetic that followed -- which is folded to a count
 * unless you ask for it. See app/js/model/diff.js for what decides which.
 *
 * Both documents are read through `Character` before they are compared. A
 * stored revision and a converted workbook do not agree about which keys they
 * carry, and comparing one against the other unnormalized reports the
 * conversion as though a player had done it.
 *
 * The bundled packs are registered first, exactly as the app does on load, so
 * the numbers here are the numbers the sheet shows. Without them a character
 * still opens -- its disciplines simply have no maneuvers to offer -- and the
 * comparison would still be sound, since both sides are read the same way.
 *
 * Usage: node tools/audit-diff.mjs <before.json> <after.json>
 *        node tools/audit-diff.mjs <before.json> <after.json> --all
 *        node tools/audit-diff.mjs <before.json> <after.json> --json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Character, changesByGroup, compareRevisions,
  setManeuverCatalogue, setVancianTables, setPsionicTables,
  setCardcastingTables, setCookingTables,
} from '../app/js/model.js';
import { mergeTables, registerTables } from '../app/js/extensions.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [beforePath, afterPath] = args.filter((a) => !a.startsWith('--'));

if (!beforePath || !afterPath) {
  console.error('usage: node tools/audit-diff.mjs <before.json> <after.json> [--all] [--json]');
  process.exit(2);
}

/** Every pack a deployment carries, from either folder the app reads. */
function bundledPacks() {
  const packs = [];
  for (const dir of [join('data', 'extensions'), join('private', 'extensions')]) {
    const indexPath = join(dir, 'index.json');
    if (!existsSync(indexPath)) continue;
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    for (const e of index.extensions || []) {
      const file = join(dir, e.file);
      if (existsSync(file)) packs.push(JSON.parse(readFileSync(file, 'utf8')));
    }
  }
  return packs;
}

registerTables(mergeTables(bundledPacks()), {
  setManeuverCatalogue, setVancianTables, setPsionicTables, setCardcastingTables, setCookingTables,
});

const read = (path) => new Character(JSON.parse(readFileSync(path, 'utf8'))).toJSON();
const { changes, counts } = compareRevisions(read(beforePath), read(afterPath));

if (flags.has('--json')) {
  console.log(JSON.stringify({ counts, changes }, null, 1));
  process.exit(0);
}

/** How a value reads in a column: a missing one should not print as "null". */
const show = (v) => (v === null || v === undefined ? '--' : String(v));

const movement = (c) => (c.kind === 'changed'
  ? `${show(c.was)} -> ${show(c.now)}`
  : `${c.kind} ${show(c.kind === 'removed' ? c.was : c.now)}`);

if (!counts.total) {
  console.log(`${beforePath} and ${afterPath} are the same character, to the audit.`);
  process.exit(0);
}

const headline = ['unexplained', 'authored', 'structural']
  .map((v) => `${counts[v]} ${v}`).join(', ');
console.log(`${counts.total} changes: ${headline}, ${counts.consequence} consequence`);
if (!flags.has('--all') && counts.consequence) {
  console.log('(consequences folded away -- pass --all to see them)\n');
} else {
  console.log('');
}

const shown = flags.has('--all') ? changes : changes.filter((c) => c.verdict !== 'consequence');
const width = Math.min(34, Math.max(...shown.map((c) => String(c.label).length), 0));

for (const [group, rows] of changesByGroup(shown)) {
  console.log(group);
  for (const row of rows) {
    console.log(`  ${row.verdict.padEnd(12)} ${String(row.label).padEnd(width)}  ${movement(row)}`);
  }
  console.log('');
}
