/** The reader's version moves with what it reads.
 *
 *  A pack carries the blocks the reader made of its pages, stamped with the
 *  READER_VERSION that made them, and a pack stamped with an older one has its
 *  pages read again. So a change to what the reader makes of a page has to
 *  raise the version, or packs keep the old reading. This reads the pages in
 *  tests/reader/class-pages.mjs and compares the blocks with the copy saved in
 *  tests/reader/class-pages.read.json, which names the version it was made at.
 *
 *  When the reading changes on purpose, raise READER_VERSION in
 *  app/js/extensions.js, then save a new copy:
 *    node tests/reader-version.test.mjs --update
 *
 *  Run: node tests/reader-version.test.mjs */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classBlockFromEntry, READER_VERSION } from '../app/js/extensions.js';
import { pages } from './reader/class-pages.mjs';

const SAVED = fileURLToPath(new URL('./reader/class-pages.read.json', import.meta.url));
const blocks = pages.map((page) => classBlockFromEntry(page));
const saved = existsSync(SAVED) ? JSON.parse(readFileSync(SAVED, 'utf8')) : null;
const changed = blocks.map((b, i) => (JSON.stringify(b) === JSON.stringify(saved?.blocks?.[i]) ? null : pages[i].name)).filter(Boolean);

if (process.argv.includes('--update')) {
  if (saved && changed.length && saved.version === READER_VERSION) {
    console.log(`The reader reads ${changed.join(', ')} differently, and READER_VERSION is still ${READER_VERSION}.`);
    console.log('Raise READER_VERSION in app/js/extensions.js first, so packs read by this version are read again.');
    process.exit(1);
  }
  writeFileSync(SAVED, `${JSON.stringify({ version: READER_VERSION, blocks }, null, 1)}\n`);
  console.log(`Saved the reading of ${blocks.length} pages at version ${READER_VERSION}.`);
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (label, cond, hint = '') => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${label}${hint ? `\n       ${hint}` : ''}`); }
};

console.log('the reader reads the test pages as the saved copy says');
ok('there is a saved copy', !!saved, 'Run: node tests/reader-version.test.mjs --update');
ok('each page reads as the saved copy says', !changed.length,
  saved?.version === READER_VERSION
    ? `${changed.join(', ')} read differently. Raise READER_VERSION in app/js/extensions.js, then run: node tests/reader-version.test.mjs --update`
    : `${changed.join(', ')} read differently. Run: node tests/reader-version.test.mjs --update`);
ok('the saved copy was made at this READER_VERSION', saved?.version === READER_VERSION,
  `The copy was made at version ${saved?.version} and READER_VERSION is ${READER_VERSION}. Run: node tests/reader-version.test.mjs --update`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
