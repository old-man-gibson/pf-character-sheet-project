/*
 * pack-storage.js -- where an imported extension pack's bytes are kept.
 *
 * A pack the deployment carries is fetched into memory and never written
 * down, so its size is nobody's problem. A pack you *import* is written down,
 * and that is the one that has to fit somewhere -- and how much room an
 * origin gets is not something anyone can promise. "5 MB per origin" is long
 * dead; this app's Chromium filled to 49.8 MB before it threw, and Brave
 * refused 4.2 MB of akashic veils with a small pack after them. The budget
 * moves with the engine and with free disk.
 *
 * IndexedDB is measured against a fraction of free disk instead, which for a
 * catalogue of any size is the difference between fitting and not. So packs
 * go there, and this is the part that knows how. `history.js` already keeps
 * saved characters and their snapshots in a database of its own; this is the
 * same shape of thing beside it rather than a new idea.
 *
 * Both mediums answer the same two questions and nothing else:
 *
 *   all()            everything held, as a Map of key to JSON string. It is
 *                    read once at startup and kept in memory after that,
 *                    because the sheet asks what is switched on for every
 *                    render and a render cannot wait for a database.
 *   commit(writes)   apply `[key, value]` pairs -- a null value deletes --
 *                    all of them or none of them.
 *
 * `commit` being all-or-nothing is not a nicety. Storing a pack is two
 * writes, the document and the index row that finds it, and a browser that
 * fills up between them leaves a document nothing points at: invisible to
 * `list()`, so the dialog cannot offer to remove it, holding exactly the
 * space the "out of space" message is asking to be freed. IndexedDB gives
 * that for free -- one transaction, and a failure aborts the lot.
 * localStorage cannot, so there it is bought by putting the previous values
 * back before the error is rethrown, which cannot itself run out of room:
 * every value it writes was in that key a moment ago, and the larger one
 * that displaced it has just been taken out again.
 *
 * Nothing here throws on a browser with no database. It degrades to
 * localStorage, which is what every version before this one ran on.
 */

export const PACK_DB = 'character-sheet-extensions';
export const PACK_DB_VERSION = 1;
export const PACK_STORE = 'packs';

/* ---------------- localStorage, or anything shaped like it ---------------- */

/** The keys a Storage holds, however it prefers to be asked. */
const storageKeys = (storage) => (typeof storage.keys === 'function'
  ? [...storage.keys()]
  : Array.from({ length: storage.length }, (_, i) => storage.key(i)));

/**
 * A medium over `localStorage` -- or over the Map-shaped fake the tests use.
 * `holds` says which of the origin's keys are packs, since the origin is
 * shared with characters and whatever else the page keeps there.
 */
export function storageMedium(storage, { holds = () => true } = {}) {
  if (!storage) throw new Error('storageMedium needs a Storage-like object');
  return {
    name: 'localStorage',
    async all() {
      const out = new Map();
      for (const key of storageKeys(storage)) {
        if (!holds(key)) continue;
        const value = storage.getItem(key);
        if (typeof value === 'string') out.set(key, value);
      }
      return out;
    },
    async commit(writes) {
      const undo = [];
      try {
        for (const [key, value] of writes) {
          // Recorded *after* the write, not before: a key the browser refused
          // was never changed, and putting a value back into it would be a
          // second write to the key that has just proved it has no room.
          const before = storage.getItem(key);
          if (value === null) storage.removeItem(key);
          else storage.setItem(key, value);
          undo.push([key, before]);
        }
      } catch (err) {
        for (const [key, value] of undo.reverse()) {
          if (value === null || value === undefined) storage.removeItem(key);
          else storage.setItem(key, value);
        }
        throw err;
      }
    },
  };
}

/* ---------------- IndexedDB ---------------- */

const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

/**
 * A medium over IndexedDB: one object store of `{key, value}` records, keyed
 * exactly the way localStorage was, so what moves across is the same pair of
 * strings and nothing has to be reshaped on the way.
 *
 * A database of its own rather than a table inside the one `history.js`
 * opens, because two modules opening one database at two versions is a
 * coordination problem with nothing to buy: the quota is per origin either
 * way.
 */
export function indexedDbMedium({ factory = globalThis.indexedDB, name = PACK_DB, store = PACK_STORE } = {}) {
  let dbPromise = null;

  const openDb = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('IndexedDB is not available here')); return; }
      const req = factory.open(name, PACK_DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store, { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let go when another tab needs to upgrade or delete the database: a
        // held-open connection blocks that indefinitely, and this one has no
        // reason to close on its own. The same bargain history.js makes.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('another tab is holding the database open'));
    });
    // A failure must not be remembered forever; a later attempt may succeed.
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  };

  return {
    name: 'IndexedDB',
    async all() {
      const db = await openDb();
      const tx = db.transaction(store, 'readonly');
      const rows = await result(tx.objectStore(store).getAll());
      return new Map(rows.map((r) => [r.key, r.value]));
    },
    async commit(writes) {
      const db = await openDb();
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const [key, value] of writes) {
        if (value === null) os.delete(key);
        else os.put({ key, value });
      }
      await finished(tx);
    },
  };
}

/* ---------------- choosing one, and moving into it ---------------- */

/**
 * The medium this browser gets, and the one-time move into it.
 *
 * IndexedDB where there is one, localStorage where there is not -- private
 * browsing with the database blocked, mostly, which is the arrangement every
 * version before this one ran on anyway.
 *
 * On the first load where the database works and localStorage still holds
 * packs, they move across: written to the database first, and only taken out
 * of localStorage once that has gone through. An interrupted migration
 * therefore repeats rather than loses, and the space the packs were holding
 * comes back the moment it finishes -- which for a player who had filled the
 * origin is the point of the whole exercise.
 *
 * `keep` decides what is worth moving, and anything it leaves out stays
 * exactly where it is. A pack document the index does not list is the
 * fingerprint of the bug fixed in 758f36c: unreachable through the dialog,
 * and carrying it forward would only move the problem into a bigger room.
 * `tools/storage-report.js` finds those and prints the line that clears them.
 *
 * Returns `{medium, moved}`, `moved` being the keys that changed homes.
 */
export async function packMedium({
  storage = globalThis.localStorage,
  factory = globalThis.indexedDB,
  holds = () => true,
  keep = (found) => found,
} = {}) {
  const fallback = () => (storage ? storageMedium(storage, { holds }) : null);
  if (!factory) return { medium: fallback(), moved: [] };

  const db = indexedDbMedium({ factory });
  try {
    await db.all();
  } catch {
    // No database to be had. Carry on where the packs already are.
    return { medium: fallback(), moved: [] };
  }
  if (!storage) return { medium: db, moved: [] };

  let found;
  try { found = await storageMedium(storage, { holds }).all(); } catch { found = new Map(); }
  const moving = [...keep(found)];
  if (!moving.length) return { medium: db, moved: [] };

  await db.commit(moving);
  for (const [key] of moving) {
    try { storage.removeItem(key); } catch { /* nothing to be done about it */ }
  }
  return { medium: db, moved: moving.map(([key]) => key) };
}
