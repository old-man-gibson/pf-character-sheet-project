/** The character list and trash a browser keeps (app/js/roster.js), over a
 *  fake Storage and a fake IndexedDB. Needs no fixtures beyond the public
 *  one, and no DOM.
 *  Run: node tests/roster.test.mjs */
import { readFileSync } from 'node:fs';
import { inspectDocument } from '../app/js/model.js';
import {
  LIBRARY_BACKUP_KEY, LIBRARY_KEY, TRASH_KEY, docKey, readLibrary, readTrash, writeLibrary, writeTrash,
} from '../app/js/roster.js';
import { documentStore } from '../app/js/doc-store.js';
import { fakeIndexedDb } from './fake-indexeddb.mjs';
import { check, finish } from './check.mjs';

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
  check('nothing stored reads as an empty list', await readLibrary(s, inspectDocument), { list: [], rebuilt: false });
  writeLibrary(s, [{ id: 'a', name: 'A', local: true }]);
  check('local is not stored', JSON.parse(s.getItem(LIBRARY_KEY)), { characters: [{ id: 'a', name: 'A' }] });
  check('and is put back on read', await readLibrary(s, inspectDocument), { list: [{ id: 'a', name: 'A', local: true }], rebuilt: false });
  check('a null storage reads as empty', await readLibrary(null, inspectDocument), { list: [], rebuilt: false });
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
    const { list, rebuilt } = await readLibrary(s, inspectDocument);
    check(`${bad}: rebuilt`, rebuilt, true);
    check(`${bad}: from the documents not in the trash`, list.map((c) => [c.id, c.name, c.local]), [['kept', vesna.identity.name, true]]);
    check(`${bad}: the unreadable text is kept`, s.getItem(LIBRARY_BACKUP_KEY), bad);
  }

  // The page's documents are in the database, with any an earlier version
  // left in localStorage beside them; the rebuild reads both.
  const s = fakeStorage();
  const factory = fakeIndexedDb();
  const docs = documentStore({ storage: s, factory });
  await docs.write('moved', JSON.stringify({ ...vesna, id: 'moved', identity: { ...vesna.identity, color: '#336699' } }));
  await docs.write('binned', JSON.stringify({ ...vesna, id: 'binned' }));
  s.setItem(docKey('left'), JSON.stringify({ ...vesna, id: 'left' }));
  writeTrash(s, [{ id: 'binned', name: 'Binned', removedAt: 1 }]);
  s.setItem(LIBRARY_KEY, '{not json');
  const { list, rebuilt } = await readLibrary(s, inspectDocument, docs);
  check('database: rebuilt', rebuilt, true);
  check('database: from both stores, not the trash', list.map((c) => [c.id, c.origin, c.local]).sort(),
    [['left', 'import', true], ['moved', 'import', true]]);
  check('database: the color comes along', list.find((c) => c.id === 'moved').color, '#336699');

  // Documents that cannot be listed are not taken for none: the list is not
  // marked rebuilt, so the page does not write an empty one over it.
  const t = fakeStorage();
  t.setItem(LIBRARY_KEY, '{not json');
  const blind = { entries: () => Promise.reject(new Error('the database failed')) };
  check('unlistable: an empty list, not marked rebuilt', await readLibrary(t, inspectDocument, blind), { list: [], rebuilt: false });
  check('unlistable: the unreadable text is backed up', t.getItem(LIBRARY_BACKUP_KEY), '{not json');
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

finish();
