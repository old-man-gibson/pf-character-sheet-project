/**
 * An IndexedDB in memory, with what the app's modules ask of one: open with
 * an upgrade, object stores with a key path and indexes, and transactions of
 * get, getAll, getAllKeys, put and delete, on a store or an index.
 *
 * A transaction commits once its requests stop arriving, as the real one
 * does, so code that awaits a read and then writes in the same transaction
 * (history.js, the planner's browser store) runs here as it does in a
 * browser. Writes are staged and kept only on commit, which is a property
 * the suites test rather than a nicety: a transaction that aborts must leave
 * every store as it found it, and a fake that wrote through would pass a
 * test the real thing fails.
 *
 *   fakeIndexedDb({ refuse, limit })
 *     refuse          every open fails, as in a private window that blocks
 *                     the database
 *     limit           characters of JSON the databases may hold; a commit
 *                     past it aborts as a full browser's does
 *   .failNext(n)      the next n commits abort the same way
 *   .rows(db, store)  what a store holds, as a Map of key to record
 */

const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
// Each request settles in a task of its own, after the promise reactions of
// the one before -- the order a browser keeps.
const later = (fn) => setImmediate(fn);

export function fakeIndexedDb({ refuse = false, limit = Infinity } = {}) {
  const databases = new Map();   // name -> { version, stores: Map(name -> { keyPath, indexes, rows }) }
  let failing = 0;

  // What every database would hold with `staged` (one transaction's stores)
  // in place of what they hold now.
  const weight = (data, staged) => {
    let n = 0;
    for (const db of databases.values()) {
      for (const [name, meta] of db.stores) {
        const rows = (db === data && staged.get(name)) || meta.rows;
        for (const record of rows.values()) n += JSON.stringify(record).length;
      }
    }
    return n;
  };

  function connection(data) {
    const db = {
      onversionchange: null,
      get version() { return data.version; },
      objectStoreNames: { contains: (name) => data.stores.has(name) },
      createObjectStore(name, { keyPath = null } = {}) {
        const meta = { keyPath, indexes: new Map(), rows: new Map() };
        data.stores.set(name, meta);
        return { createIndex: (index, path) => { meta.indexes.set(index, path); } };
      },
      close() {},
      transaction(names, mode = 'readonly') {
        const scope = [names].flat();
        for (const name of scope) {
          if (!data.stores.has(name)) throw new DOMException(`No objectStore named ${name}.`, 'NotFoundError');
        }
        const staged = new Map(scope.map((name) => [name, new Map(data.stores.get(name).rows)]));
        const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null };
        let pending = 0;
        let done = false;

        const settle = () => later(() => {
          if (done || pending) return;
          done = true;
          if (mode === 'readwrite') {
            if (failing > 0 || weight(data, staged) > limit) {
              if (failing > 0) failing -= 1;
              tx.error = quotaError();
              tx.onabort?.();
              return;
            }
            for (const [name, rows] of staged) data.stores.get(name).rows = rows;
          }
          tx.oncomplete?.();
        });
        const request = (run) => {
          if (done) throw new DOMException('The transaction has finished.', 'TransactionInactiveError');
          const req = { result: undefined, error: null, onsuccess: null, onerror: null };
          pending += 1;
          later(() => {
            pending -= 1;
            try {
              req.result = run();
            } catch (err) {
              req.error = err;
              req.onerror?.();
              done = true;
              tx.error = err;
              tx.onabort?.();
              return;
            }
            req.onsuccess?.();
            settle();
          });
          return req;
        };
        const writable = () => {
          if (mode !== 'readwrite') throw new DOMException('The transaction is read-only.', 'ReadOnlyError');
        };

        tx.objectStore = (name) => {
          const meta = data.stores.get(name);
          const rows = staged.get(name);
          if (!meta || !rows) throw new DOMException(`No objectStore named ${name}.`, 'NotFoundError');
          const keyOf = (record) => (meta.keyPath ? record[meta.keyPath] : undefined);
          const sorted = () => [...rows.keys()].sort().map((key) => [key, rows.get(key)]);
          return {
            get: (key) => request(() => structuredClone(rows.get(key))),
            getAll: () => request(() => sorted().map(([, record]) => structuredClone(record))),
            getAllKeys: () => request(() => sorted().map(([key]) => key)),
            put(record) {
              writable();
              const copy = structuredClone(record);
              return request(() => { rows.set(keyOf(copy), copy); return keyOf(copy); });
            },
            delete(key) {
              writable();
              return request(() => { rows.delete(key); });
            },
            index(index) {
              const path = meta.indexes.get(index);
              const matching = (key) => sorted().filter(([, record]) => record[path] === key);
              return {
                getAll: (key) => request(() => matching(key).map(([, record]) => structuredClone(record))),
                getAllKeys: (key) => request(() => matching(key).map(([k]) => k)),
              };
            },
          };
        };
        settle();
        return tx;
      },
    };
    return db;
  }

  return {
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        if (refuse) {
          req.error = new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError');
          req.onerror?.();
          return;
        }
        let data = databases.get(name);
        if (!data) { data = { version: 0, stores: new Map() }; databases.set(name, data); }
        const want = version ?? Math.max(1, data.version);
        if (want < data.version) {
          req.error = new DOMException('The requested version is less than the existing version.', 'VersionError');
          req.onerror?.();
          return;
        }
        req.result = connection(data);
        if (want > data.version) {
          const oldVersion = data.version;
          data.version = want;
          req.onupgradeneeded?.({ oldVersion, newVersion: want });
        }
        req.onsuccess?.();
      });
      return req;
    },
    failNext(n = 1) { failing += n; },
    rows: (name, store) => new Map(databases.get(name)?.stores.get(store)?.rows ?? []),
  };
}
