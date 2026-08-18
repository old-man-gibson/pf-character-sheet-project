/*
 * history.js -- where a character's state lives, and every earlier state a
 * player can go back to.
 *
 * Three things are kept, in the store that suits each:
 *
 *   working    the live sheet, rewritten as it is edited. localStorage, under
 *              the key the app has always used, so edits made before this file
 *              existed simply carry on being the working state.
 *   saved      the canonical version -- what `Save` writes and what the sheet
 *              opens on. IndexedDB.
 *   snapshots  automatic ones, taken every `SNAPSHOT_EVERY` changes away from
 *              the saved version and kept `AUTO_KEEP` deep, plus checkpoints
 *              the player names, which are never evicted. IndexedDB, gzipped.
 *
 * Why the split, when one store would be tidier: the working state's whole job
 * is to still be there after a browser crash or a closed tab, and only
 * localStorage can be written synchronously as the edit happens. An IndexedDB
 * write is a promise, and a promise started as the tab goes away is a promise
 * that may never settle. The canonical version and the history have the
 * opposite shape -- written on a button press or once every twenty edits, but
 * many documents deep -- and there localStorage's ~5 MB is the wrong budget
 * and IndexedDB's disk-fraction quota is the right one.
 *
 * A document is ~250 KB of JSON and ~20 KB gzipped, so snapshots are
 * compressed. They go in as bytes, not base64: IndexedDB stores a Uint8Array
 * directly, and skipping base64 skips the third it would add.
 *
 * Everything here degrades rather than throws. If IndexedDB is unavailable --
 * private browsing, a blocked third-party frame, a browser that has decided the
 * quota is zero -- there is no canonical version and no history, and the sheet
 * falls back to exactly what it did before: a working state that is saved
 * continuously and reloads where the player left off.
 */

import { SCHEMA_VERSION } from './model.js';

/** How many automatic snapshots survive per character; the oldest goes first. */
export const AUTO_KEEP = 5;

/** How far the sheet may drift from the saved version before one is taken. */
export const SNAPSHOT_EVERY = 20;

const DB_NAME = 'character-sheets';
const DB_VERSION = 1;
const STORE = 'snapshots';
const BY_CHARACTER = 'by-character';

/** The key the app has used for edits since before any of this existed. */
export const workingKey = (id) => `character-sheet:${id}`;

/* ---------------------------------------------------------------------- *
 * counting changes
 * ---------------------------------------------------------------------- */

/** Leaves in a value, which is what an added or removed subtree is worth. */
function leaves(value) {
  if (value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) {
    return value.length ? value.reduce((n, v) => n + leaves(v), 0) : 1;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  return keys.length ? keys.reduce((n, k) => n + leaves(value[k]), 0) : 1;
}

/**
 * How many leaf values differ between two documents.
 *
 * This is what "changes since the last save" counts, and counting leaves rather
 * than edits is the point: a player who types a wrong number and types it back
 * has drifted nowhere, and should not be spending a snapshot slot on it. It is
 * also what the header reports, so the number has to mean something a person
 * would recognise.
 *
 * `cap` stops the walk early, because every caller only ever wants to know
 * whether the count has reached a threshold -- there is no reason to finish
 * counting a document that has been rewritten wholesale.
 *
 * A key set to `undefined` counts as absent. A document that has been through
 * `JSON.stringify` has dropped those keys and one read back from IndexedDB has
 * kept them, and the same sheet must not read as changed depending on which
 * store it came from.
 */
export function countChanges(before, after, cap = Infinity) {
  const walk = (a, b) => {
    if (a === b) return 0;

    const aObj = a !== null && typeof a === 'object';
    const bObj = b !== null && typeof b === 'object';
    if (!aObj || !bObj) {
      // One side is a leaf. If the other is not, the whole subtree is new.
      if (aObj || bObj) return Math.max(leaves(a), leaves(b));
      return Object.is(a, b) ? 0 : 1;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return Math.max(leaves(a), leaves(b));

    let n = 0;
    if (Array.isArray(a)) {
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len && n < cap; i++) {
        if (i >= a.length) n += leaves(b[i]);
        else if (i >= b.length) n += leaves(a[i]);
        else n += walk(a[i], b[i]);
      }
      return n;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (n >= cap) break;
      const av = a[k];
      const bv = b[k];
      if (av === undefined && bv === undefined) continue;
      if (av === undefined) n += leaves(bv);
      else if (bv === undefined) n += leaves(av);
      else n += walk(av, bv);
    }
    return n;
  };
  return walk(before, after);
}

/* ---------------------------------------------------------------------- *
 * compression
 * ---------------------------------------------------------------------- */

/** A document as gzipped bytes -- ~20 KB where the JSON is ~250 KB. */
export async function pack(doc) {
  const stream = new Blob([JSON.stringify(doc)]).stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** And back again. */
export async function unpack(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/* ---------------------------------------------------------------------- *
 * eviction
 * ---------------------------------------------------------------------- */

/**
 * Which snapshots to drop, given everything stored for one character.
 *
 * Only automatic ones are ever dropped, newest kept: a checkpoint is the
 * player saying "this state matters", and the whole difference between the two
 * kinds is that saying so makes it permanent. Kept pure and exported so the
 * policy can be tested without a database.
 */
export function evictable(records, keep = AUTO_KEEP) {
  return records
    .filter((r) => r.kind === 'auto')
    .sort((a, b) => b.seq - a.seq)
    .slice(keep)
    .map((r) => r.key);
}

/* ---------------------------------------------------------------------- *
 * IndexedDB
 * ---------------------------------------------------------------------- */

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available here'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex(BY_CHARACTER, 'id');
    };
    req.onsuccess = () => {
      const db = req.result;
      /*
       * Let go when something else needs to.
       *
       * A held-open connection blocks a schema upgrade or a delete from any
       * other tab -- indefinitely, since this one has no reason to close on its
       * own. So the tab that wants to change the database gets to: close, forget
       * the handle, and let the next call open a fresh one. Without this, a
       * player with the sheet open in two tabs would find that a new version of
       * the app could never upgrade the store in either.
       */
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Another tab holding an old version open. Nothing to do but say so; the
    // sheet carries on with its working state.
    req.onblocked = () => reject(new Error('another tab is holding the database open'));
  });
  // A failure must not be remembered forever -- a later attempt may succeed
  // once the other tab has gone.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
});

/* ---------------------------------------------------------------------- *
 * per character
 * ---------------------------------------------------------------------- */

/**
 * Everything one character's state does, as one small object.
 *
 * `id` is the character's id, which is also what its localStorage key and its
 * IndexedDB records are keyed on. `storageKey` overrides the working-state key
 * for a host page that embeds several sheets and wants them kept apart.
 */
export function historyFor(id, { storageKey = null } = {}) {
  const wKey = storageKey || workingKey(id);
  const stamp = () => new Date().toISOString();

  /* ---- working state: synchronous, so a closed tab cannot lose it ---- */

  function readWorking() {
    try {
      const raw = localStorage.getItem(wKey);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved?.data) return null;
      // An older schema is missing whatever sections have been added since;
      // loading it would quietly drop them.
      if (saved.data.schemaVersion !== SCHEMA_VERSION) {
        localStorage.removeItem(wKey);
        return null;
      }
      return saved;
    } catch {
      return null;                       // corrupt entry: fall back to source
    }
  }

  function writeWorking(doc) {
    try {
      localStorage.setItem(wKey, JSON.stringify({ savedAt: stamp(), data: doc }));
      return true;
    } catch {
      return false;                      // full or blocked: in-session only
    }
  }

  function clearWorking() {
    try { localStorage.removeItem(wKey); } catch { /* nothing to undo */ }
  }

  /* ---- canonical version and history: IndexedDB ---- */

  const recordKey = (kind, seq) => (kind === 'saved' ? `${id}#saved` : `${id}#${seq}`);

  /** Everything stored for this character, newest first, without the payloads. */
  async function all() {
    const db = await openDb();
    const store = db.transaction(STORE, 'readonly').objectStore(STORE);
    const rows = await result(store.index(BY_CHARACTER).getAll(id));
    return rows.sort((a, b) => (b.seq || 0) - (a.seq || 0));
  }

  const meta = ({ bytes, ...rest }) => ({ ...rest, size: bytes?.length ?? 0, stale: rest.schemaVersion !== SCHEMA_VERSION });

  /**
   * The canonical version, or null.
   *
   * A stale one is reported rather than deleted: the sheet still has to explain
   * why the save it was expecting did not come back, and a player may want to
   * export it before it goes.
   */
  async function readSaved() {
    try {
      const db = await openDb();
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const row = await result(store.get(recordKey('saved')));
      if (!row) return null;
      if (row.schemaVersion !== SCHEMA_VERSION) return { ...meta(row), data: null };
      return { ...meta(row), data: await unpack(row.bytes) };
    } catch {
      return null;
    }
  }

  /**
   * Write a record, evicting spent automatic snapshots in the same transaction.
   *
   * The document is compressed before the transaction opens, not inside it. An
   * IndexedDB transaction commits as soon as its own requests stop arriving, so
   * awaiting anything else -- a compression stream very much included -- while
   * one is open is how a write silently lands nowhere.
   */
  async function put(kind, doc, { label = '', changes = 0 } = {}) {
    const bytes = await pack(doc);

    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const mine = await result(store.index(BY_CHARACTER).getAll(id));

    const seq = kind === 'saved'
      ? 0
      : Math.max(0, ...mine.map((r) => r.seq || 0)) + 1;
    const record = {
      key: recordKey(kind, seq),
      id,
      kind,
      seq,
      label,
      changes,
      savedAt: stamp(),
      schemaVersion: doc?.schemaVersion ?? SCHEMA_VERSION,
      bytes,
    };
    store.put(record);
    if (kind === 'auto') {
      for (const key of evictable([...mine, record])) store.delete(key);
    }
    await finished(tx);
    return meta(record);
  }

  return {
    id,
    readWorking,
    writeWorking,
    clearWorking,
    readSaved,

    /** Make the current document the canonical one. */
    save: (doc) => put('saved', doc),

    /** An automatic snapshot, taken because the sheet has drifted far enough. */
    snapshot: (doc, changes) => put('auto', doc, { changes }),

    /** A checkpoint the player named, which nothing will evict. */
    checkpoint: (doc, label, changes = 0) => put('checkpoint', doc, { label, changes }),

    /** Snapshots and checkpoints, newest first, payloads left in the database. */
    async list() {
      try {
        return (await all()).filter((r) => r.kind !== 'saved').map(meta);
      } catch {
        return [];
      }
    },

    /** One stored document, by record key. */
    async load(key) {
      const db = await openDb();
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const row = await result(store.get(key));
      if (!row) throw new Error('that snapshot is no longer stored');
      if (row.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`that snapshot was written for schema ${row.schemaVersion},`
          + ` and this app reads schema ${SCHEMA_VERSION}`);
      }
      return unpack(row.bytes);
    },

    /** Rename a checkpoint. */
    async rename(key, label) {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const row = await result(store.get(key));
      if (row) store.put({ ...row, label });
      await finished(tx);
    },

    /** Delete one snapshot or checkpoint. */
    async remove(key) {
      const db = await openDb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await finished(tx);
    },

    /**
     * Drop the canonical version and every automatic snapshot, which is what
     * Reset means. Checkpoints stay: a player who named a state said it
     * mattered, and a Reset they did not mean should not be the one thing they
     * cannot undo.
     */
    async resetKeepingCheckpoints() {
      clearWorking();
      try {
        const rows = await all();
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const r of rows) if (r.kind !== 'checkpoint') store.delete(r.key);
        await finished(tx);
      } catch { /* nothing stored, or no database: the working state is gone anyway */ }
    },
  };
}

/**
 * Erase every trace of a character, for the × that removes an imported one.
 *
 * Unlike a Reset this does take the checkpoints: the character itself is going,
 * so there is nothing left for them to be checkpoints of.
 */
export async function forget(id, { storageKey = null } = {}) {
  try { localStorage.removeItem(storageKey || workingKey(id)); } catch { /* ignore */ }
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const key of await result(store.index(BY_CHARACTER).getAllKeys(id))) {
      store.delete(key);
    }
    await finished(tx);
  } catch { /* no database, nothing to erase */ }
}
