/**
 * Where the Forge keeps its entries: this browser, in IndexedDB, one record
 * per entry -- the same medium the sheet keeps imported packs in, opened as a
 * database of its own (`homebrew-workbench`) so the two never share a version.
 * A browser with no database falls back to localStorage under the same keys.
 *
 * Nothing leaves the browser: the Import / Export menu is how work travels,
 * and "Publish to this sheet" is how it reaches the sheet next door.
 */
import { indexedDbMedium, storageMedium } from '../../app/js/pack-storage.js';

export const FORGE_DB = 'homebrew-workbench';
export const FORGE_STORE = 'entries';
const KEY = 'homebrew-workbench:entry:';
const META = 'homebrew-workbench:meta';

export function forgeStore({ factory = globalThis.indexedDB, storage = globalThis.localStorage } = {}) {
  const cache = new Map();
  let medium = null;
  let meta = {};

  const load = (found) => {
    cache.clear(); meta = {};
    for (const [key, value] of found) {
      try {
        if (key === META) { meta = JSON.parse(value) || {}; continue; }
        const e = JSON.parse(value);
        if (e && e.id) cache.set(e.id, e);
      } catch { /* a record that does not parse is left where it is */ }
    }
  };

  return {
    /** Open the medium and read everything in. Resolves the medium's name. */
    async open() {
      if (factory) {
        try {
          const db = indexedDbMedium({ factory, name: FORGE_DB, store: FORGE_STORE });
          load(await db.all()); medium = db; return medium.name;
        } catch { /* no database: fall through */ }
      }
      if (!storage) throw new Error('There is nowhere to keep entries in this browser.');
      medium = storageMedium(storage, { holds: (k) => k.startsWith(KEY) || k === META });
      load(await medium.all());
      return medium.name;
    },
    get medium() { return medium?.name || null; },
    entries() { return cache; },
    async save(entry) { await medium.commit([[KEY + entry.id, JSON.stringify(entry)]]); cache.set(entry.id, entry); },
    async saveMany(list) { await medium.commit(list.map((e) => [KEY + e.id, JSON.stringify(e)])); for (const e of list) cache.set(e.id, e); },
    async remove(id) { await medium.commit([[KEY + id, null]]); cache.delete(id); },
    /** Small facts beside the entries: the pack revision counter, mostly. */
    getMeta(key) { return meta[key]; },
    async setMeta(key, value) { meta = { ...meta, [key]: value }; await medium.commit([[META, JSON.stringify(meta)]]); },
  };
}
