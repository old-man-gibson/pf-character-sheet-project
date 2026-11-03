/*
 * doc-store.js -- where an imported character's document is kept.
 *
 * A character imported, started here or duplicated has no file under data/:
 * the document it was added as lives in this browser, and the sheet opens on
 * it whenever there is no saved version or working copy to prefer. It used to
 * sit in localStorage beside the working copy, which put two copies of every
 * character in the store with the smallest budget -- about five million
 * characters in most browsers, and a document is 170 to 540 thousand. The
 * working copy has to stay in localStorage (history.js says why); the
 * document does not, so it lives in IndexedDB.
 *
 * A database of its own, beside the ones history.js and pack-storage.js open,
 * for the reason pack-storage.js gives. Adding a store to history.js's
 * database would mean moving its version, and a tab still running the older
 * version holds the database open at the old one: the upgrade waits on that
 * tab, and once it lands the older tab can no longer open the database at
 * all. A database only this module opens, at the version it was created
 * with, has no upgrade for anything to block. The quota is per origin either
 * way.
 *
 * Moving in. A document still in localStorage -- kept there before this
 * module existed, written since by a tab running an older version, or put
 * there by tools/panel-snapshot.js -- is always the newer copy, because
 * nothing here writes one there while the database works. So reads look in
 * localStorage first, and `moveIn()` copies what it finds into the database
 * in one transaction, taking each out of localStorage only once that has
 * completed. An interrupted move repeats on the next load instead of losing
 * anything.
 *
 * Where there is no database -- some private windows, a blocked frame -- the
 * documents stay in localStorage, read and written exactly as before. Which
 * of the two is asked once per page, so one page never writes a character to
 * one store and the next to the other.
 */

import { databaseOpener, finished, result } from './idb.js';

export const DOC_DB = 'character-sheet-documents';
export const DOC_DB_VERSION = 1;
export const DOC_STORE = 'documents';

/** The localStorage key a document was kept under, and is still read from. */
export const docKey = (id) => `character-sheet:doc:${id}`;

/*
 * A document is the only copy of the character it was added as, and moving
 * one in deletes the other copy, so a write is not reported done until it
 * is on disk. Browsers that do not know the option ignore it.
 */
const ON_DISK = { durability: 'strict' };

/** The page's localStorage, or null where touching it throws. */
function pageStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Every document a Storage holds, as [id, text] pairs. */
export function storedDocuments(storage) {
  const prefix = docKey('');
  const found = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix) || key === prefix) continue;
      const text = storage.getItem(key);
      if (typeof text === 'string') found.push([key.slice(prefix.length), text]);
    }
  } catch { /* no storage, or it will not be read: nothing found */ }
  return found;
}

/**
 * The documents of one page. `storage` is localStorage or a fake of it, and
 * may be null; `factory` is the IndexedDB to use, none when null.
 *
 * Every method resolves to text, never a parsed document: what the sheet is
 * handed is exactly what JSON.parse makes of what was stored, as before.
 */
export function documentStore({ storage = pageStorage(), factory = globalThis.indexedDB } = {}) {
  const openDb = databaseOpener({
    factory,
    name: DOC_DB,
    version: DOC_DB_VERSION,
    upgrade: (db) => { if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE, { keyPath: 'id' }); },
  });

  // A database opened without a version by some other script is created
  // empty, and has no store to read; that counts as no database.
  let medium = null;
  const where = () => (medium ??= factory
    ? openDb().then((db) => (db.objectStoreNames.contains(DOC_STORE) ? 'IndexedDB' : 'localStorage'), () => 'localStorage')
    : Promise.resolve('localStorage'));

  const fromStorage = (id) => {
    try { return storage?.getItem(docKey(id)) ?? null; } catch { return null; }
  };

  return {
    /** 'IndexedDB', or 'localStorage' where the database will not open. */
    where,

    /** A character's document as stored, or null. Rejects if the database fails on the read. */
    async read(id) {
      const text = fromStorage(id);
      if (text !== null || await where() !== 'IndexedDB') return text;
      const db = await openDb();
      const row = await result(db.transaction(DOC_STORE, 'readonly').objectStore(DOC_STORE).get(id));
      return typeof row?.json === 'string' ? row.json : null;
    },

    /** Store a document. Rejects with what the browser said, QuotaExceededError when it is full. */
    async write(id, text) {
      if (await where() !== 'IndexedDB') {
        if (!storage) throw new Error('this browser is not letting the page store anything');
        storage.setItem(docKey(id), text);
        return;
      }
      const db = await openDb();
      const tx = db.transaction(DOC_STORE, 'readwrite', ON_DISK);
      tx.objectStore(DOC_STORE).put({ id, json: text });
      await finished(tx);
      // An older copy left in localStorage would be read before this one.
      try { storage?.removeItem(docKey(id)); } catch { /* none to shadow it, then */ }
    },

    /** Erase a document from both stores. False when it could not be. */
    async remove(id) {
      try { storage?.removeItem(docKey(id)); } catch { return false; }
      if (await where() !== 'IndexedDB') return true;
      try {
        const db = await openDb();
        const tx = db.transaction(DOC_STORE, 'readwrite');
        tx.objectStore(DOC_STORE).delete(id);
        await finished(tx);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Every document held, as [id, text] pairs, a copy in localStorage over
     * one in the database. Rejects if the database cannot be read, since a
     * list missing those would be taken for all of them.
     */
    async entries() {
      const found = new Map();
      if (await where() === 'IndexedDB') {
        const db = await openDb();
        const rows = await result(db.transaction(DOC_STORE, 'readonly').objectStore(DOC_STORE).getAll());
        for (const row of rows) if (typeof row?.json === 'string') found.set(row.id, row.json);
      }
      for (const [id, text] of storedDocuments(storage)) found.set(id, text);
      return [...found];
    },

    /**
     * Move every document still in localStorage into the database. Resolves
     * to the ids moved; a move that fails leaves them where they were, to be
     * read from there and moved on a later load.
     */
    async moveIn() {
      if (!storage || await where() !== 'IndexedDB') return [];
      const found = storedDocuments(storage);
      if (!found.length) return [];
      try {
        const db = await openDb();
        const tx = db.transaction(DOC_STORE, 'readwrite', ON_DISK);
        const os = tx.objectStore(DOC_STORE);
        for (const [id, json] of found) os.put({ id, json });
        await finished(tx);
      } catch {
        return [];
      }
      for (const [id, json] of found) {
        // A tab on an older version may have written it again meanwhile;
        // that copy is newer than the one moved, and moves next time.
        try { if (storage.getItem(docKey(id)) === json) storage.removeItem(docKey(id)); } catch { /* moved next time */ }
      }
      return found.map(([id]) => id);
    },
  };
}
