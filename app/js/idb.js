/**
 * The IndexedDB plumbing the saved characters (history.js) and the imported
 * packs (pack-storage.js) both stand on: opening a database, and two promises
 * over its requests. Each keeps a database of its own; what is shared is how
 * one is opened and let go of.
 */

/**
 * A function that opens one database and keeps the connection.
 *
 * `upgrade(db)` creates the stores when the version moves. `factory` is the
 * IndexedDB to use, looked up when the database is first asked for if none
 * is given, so a page without one fails on use rather than on load.
 *
 * The connection lets go when another tab needs to upgrade or delete the
 * database: a held-open one blocks that indefinitely, and this one has no
 * reason to close on its own, so a player with the sheet open in two tabs
 * could otherwise never take a new version in either. A failed open is not
 * remembered, so a later attempt may succeed once the other tab has gone.
 */
export function databaseOpener({ name, version, upgrade, factory = null }) {
  let dbPromise = null;
  return function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const idb = factory || globalThis.indexedDB;
      if (!idb) { reject(new Error('IndexedDB is not available here')); return; }
      const req = idb.open(name, version);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      // Another tab holding an old version open. Nothing to do but say so.
      req.onblocked = () => reject(new Error('another tab is holding the database open'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  };
}

/** A request's result, as a promise. */
export const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** A transaction's end, as a promise. */
export const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});
