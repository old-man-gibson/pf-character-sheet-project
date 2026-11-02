/** The character list and trash a browser keeps (app/js/roster.js), over a
 *  fake Storage. Needs no fixtures beyond the public one, and no DOM.
 *  Run: node tests/roster.test.mjs */
import { readFileSync } from 'node:fs';
import { inspectDocument } from '../app/js/model.js';
import {
  LIBRARY_BACKUP_KEY, LIBRARY_KEY, TRASH_KEY, docKey, readLibrary, readTrash, writeLibrary, writeTrash,
} from '../app/js/roster.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/** A Storage over a Map; `full` names keys whose writes throw as a full browser does. */
function fakeStorage(full = new Set()) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (full.has(k)) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const vesna = JSON.parse(readFileSync('tests/fixtures/public/characters/vesna.json', 'utf8'));

console.log('the list reads back what was written');
{
  const s = fakeStorage();
  check('nothing stored reads as an empty list', readLibrary(s, inspectDocument), { list: [], rebuilt: false });
  writeLibrary(s, [{ id: 'a', name: 'A', local: true }]);
  check('local is not stored', JSON.parse(s.getItem(LIBRARY_KEY)), { characters: [{ id: 'a', name: 'A' }] });
  check('and is put back on read', readLibrary(s, inspectDocument), { list: [{ id: 'a', name: 'A', local: true }], rebuilt: false });
  check('a null storage reads as empty', readLibrary(null, inspectDocument), { list: [], rebuilt: false });
  let threw = false;
  try { writeLibrary(fakeStorage(new Set([LIBRARY_KEY])), []); } catch (err) { threw = err.name === 'QuotaExceededError'; }
  check('a full browser throws on write, for the page to report', threw, true);
}

console.log('a list that cannot be read is rebuilt from the documents');
{
  for (const bad of ['{not json', '[]', '{"characters": 5}']) {
    const s = fakeStorage();
    s.setItem(docKey('kept'), JSON.stringify({ ...vesna, id: 'kept' }));
    s.setItem(docKey('binned'), JSON.stringify({ ...vesna, id: 'binned' }));
    s.setItem(docKey('broken'), '{');
    s.setItem('character-sheet:kept', '{}');   // working edits: not a document key
    writeTrash(s, [{ id: 'binned', name: 'Binned', removedAt: 1 }]);
    s.setItem(LIBRARY_KEY, bad);
    const { list, rebuilt } = readLibrary(s, inspectDocument);
    check(`${bad}: rebuilt`, rebuilt, true);
    check(`${bad}: from the documents not in the trash`, list.map((c) => [c.id, c.name, c.local]), [['kept', vesna.identity.name, true]]);
    check(`${bad}: the unreadable text is kept`, s.getItem(LIBRARY_BACKUP_KEY), bad);
  }
}

console.log('the trash');
{
  const s = fakeStorage();
  check('empty to start', readTrash(s), []);
  check('a write is saved', writeTrash(s, [{ id: 'x', removedAt: 5 }]), true);
  check('and reads back', readTrash(s), [{ id: 'x', removedAt: 5 }]);
  check('an empty trash removes the key', [writeTrash(s, []), s.getItem(TRASH_KEY)], [true, null]);
  check('a full browser answers false', writeTrash(fakeStorage(new Set([TRASH_KEY])), [{ id: 'x' }]), false);
  check('so does a null storage', writeTrash(null, [{ id: 'x' }]), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
