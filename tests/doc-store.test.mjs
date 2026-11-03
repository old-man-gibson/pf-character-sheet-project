/** Where an imported character's document is kept (app/js/doc-store.js): the
 *  database, the move out of localStorage, and localStorage where there is no
 *  database. Over a fake Storage and a fake IndexedDB; no DOM.
 *  Run: node tests/doc-store.test.mjs */
import { DOC_DB, DOC_STORE, docKey, documentStore } from '../app/js/doc-store.js';
import { fakeIndexedDb } from './fake-indexeddb.mjs';

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
    keys: () => [...m.keys()],
  };
}

const held = (factory) => [...factory.rows(DOC_DB, DOC_STORE).values()].map((r) => [r.id, r.json]);
const rejection = async (promise) => {
  try { await promise; return null; } catch (err) { return err.name; }
};

console.log('no database: localStorage, as before');
for (const [label, factory] of [['none at all', null], ['one that will not open', fakeIndexedDb({ refuse: true })]]) {
  const storage = fakeStorage();
  const docs = documentStore({ storage, factory });
  check(`${label}: it says so`, await docs.where(), 'localStorage');
  await docs.write('a', '{"id":"a"}');
  check(`${label}: a write lands under the old key`, storage.getItem(docKey('a')), '{"id":"a"}');
  check(`${label}: and reads back`, await docs.read('a'), '{"id":"a"}');
  check(`${label}: a missing one is null`, await docs.read('nobody'), null);
  check(`${label}: entries lists it`, await docs.entries(), [['a', '{"id":"a"}']]);
  check(`${label}: nothing is moved`, await docs.moveIn(), []);
  check(`${label}: so it stays`, storage.getItem(docKey('a')), '{"id":"a"}');
  check(`${label}: remove takes it out`, [await docs.remove('a'), storage.getItem(docKey('a'))], [true, null]);
  const full = documentStore({ storage: fakeStorage(new Set([docKey('b')])), factory });
  check(`${label}: a full browser rejects the write, for the page to report`, await rejection(full.write('b', '{}')), 'QuotaExceededError');
  let said = null;
  try { await documentStore({ storage: null, factory }).write('c', '{}'); } catch (err) { said = err.message; }
  check(`${label}: no storage at all says so`, said, 'this browser is not letting the page store anything');
}

console.log('a database: documents live there');
{
  const storage = fakeStorage();
  const factory = fakeIndexedDb();
  const docs = documentStore({ storage, factory });
  check('it says so', await docs.where(), 'IndexedDB');
  await docs.write('a', '{"id":"a"}');
  check('a write lands in the database', held(factory), [['a', '{"id":"a"}']]);
  check('and not in localStorage', storage.length, 0);
  check('it reads back', await docs.read('a'), '{"id":"a"}');
  check('a missing one is null', await docs.read('nobody'), null);

  // A copy in localStorage is newer than the database's (see doc-store.js),
  // so it is the one read, and a write over it takes it out.
  storage.setItem(docKey('a'), '{"id":"a","newer":true}');
  check('a copy in localStorage is read first', await docs.read('a'), '{"id":"a","newer":true}');
  check('and wins in entries', await docs.entries(), [['a', '{"id":"a","newer":true}']]);
  await docs.write('a', '{"id":"a","v":3}');
  check('a write takes the localStorage copy out', [storage.getItem(docKey('a')), await docs.read('a')], [null, '{"id":"a","v":3}']);

  check('remove takes it out of both', [await docs.remove('a'), held(factory), await docs.read('a')], [true, [], null]);

  factory.failNext();
  check('a full database rejects the write', await rejection(docs.write('b', '{"id":"b"}')), 'QuotaExceededError');
  check('and keeps nothing of it', [held(factory), storage.length], [[], 0]);

  await docs.write('c', '{"id":"c"}');
  factory.failNext();
  check('a delete that fails says so', await docs.remove('c'), false);
  check('and the document is still there', await docs.read('c'), '{"id":"c"}');
}

console.log('moving in: documents an earlier version kept in localStorage');
{
  const storage = fakeStorage();
  storage.setItem(docKey('a'), '{"id":"a"}');
  storage.setItem(docKey('b'), '{"id":"b"}');
  storage.setItem(docKey('broken'), '{');
  storage.setItem('character-sheet:a', '{"data":{}}');           // the working copy stays
  storage.setItem('character-sheet:library', '{"characters":[]}');
  const factory = fakeIndexedDb();
  const docs = documentStore({ storage, factory });
  const before = await docs.entries();

  check('every document moves, a broken one as it is', (await docs.moveIn()).sort(), ['a', 'b', 'broken']);
  check('the database has them, byte for byte', held(factory), before.sort());
  check('localStorage keeps only what is not a document', storage.keys().sort(), ['character-sheet:a', 'character-sheet:library']);
  check('they read back from the database', await docs.read('b'), '{"id":"b"}');
  check('a second load moves nothing', await docs.moveIn(), []);

  // A tab on an older version writes into localStorage; the next load moves
  // that copy over the one already in the database.
  storage.setItem(docKey('a'), '{"id":"a","replaced":true}');
  check('a newer copy moves over the old', [await docs.moveIn(), await docs.read('a'), storage.getItem(docKey('a'))],
    [['a'], '{"id":"a","replaced":true}', null]);
}

console.log('moving in: a move that fails, and one written over while it ran');
{
  const storage = fakeStorage();
  storage.setItem(docKey('a'), '{"id":"a"}');
  const factory = fakeIndexedDb();
  const docs = documentStore({ storage, factory });
  factory.failNext();
  check('a failed move moves nothing', await docs.moveIn(), []);
  check('and loses nothing: still in localStorage', storage.getItem(docKey('a')), '{"id":"a"}');
  check('still read from there', await docs.read('a'), '{"id":"a"}');
  check('and moved on the next load', [await docs.moveIn(), storage.length, await docs.read('a')], [['a'], 0, '{"id":"a"}']);

  storage.setItem(docKey('b'), '{"id":"b"}');
  storage.setItem(docKey('c'), '{"id":"c"}');
  await docs.where();
  const moving = docs.moveIn();
  // One task in, the move has read localStorage and its transaction is open.
  await new Promise(setImmediate);
  storage.setItem(docKey('b'), '{"id":"b","meanwhile":true}');
  await moving;
  check('a document written during the move stays in localStorage', storage.getItem(docKey('b')), '{"id":"b","meanwhile":true}');
  check('and is the one read', await docs.read('b'), '{"id":"b","meanwhile":true}');
  check('the rest moved', storage.getItem(docKey('c')), null);
}

console.log('a database some other script created without the store');
{
  const factory = fakeIndexedDb();
  await new Promise((resolve) => { factory.open(DOC_DB).onsuccess = resolve; });
  const storage = fakeStorage();
  const docs = documentStore({ storage, factory });
  check('counts as no database', await docs.where(), 'localStorage');
  await docs.write('a', '{}');
  check('so localStorage is used', storage.getItem(docKey('a')), '{}');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
