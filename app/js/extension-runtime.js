/**
 * The page's one view of its extensions.
 *
 * `extensions.js` is the pure part: formats, the store, merging, attaching.
 * This is the stateful part a page has exactly one of: the bundled packs it
 * fetched, the local store, and the act of registering the merged tables with
 * the model. The sheet element and a host page's manager both import this, so
 * a pack switched on in the manager is what the sheet reads on its next render
 * -- there is no second copy to fall out of step.
 *
 *   runtime.load(base)     fetch the bundled packs once, register everything
 *   runtime.refresh()      re-merge after the store changed, and say so
 *   runtime.active()       the enabled packs, bundled first
 *   runtime.blocks()       every block across them, tagged with its pack
 *   runtime.addEventListener('change', …)   the sheet re-renders on this
 */

import * as model from './model.js';
import { setOptionCatalogues } from './model.js';
import {
  TABLES, extensionStore, loadBundledExtensions, activeExtensions, activeBlocks, mergeTables, registerTables,
  optionCataloguesFrom, optionCataloguesFromTables, classFeatureTextFromTables, namedTextFrom, isPackKey, packsWorthMoving,
} from './extensions.js';
// Straight from the module rather than through model.js, which does not
// re-export this one -- companions.js is beside the model, not inside it.
import { setCompanionAbilityText } from './companions.js';
import { packMedium } from './pack-storage.js';

// The model's setter for every table kind, by the name TABLES gives it.
const REGISTRARS = Object.fromEntries(TABLES.map((t) => [t.setter, model[t.setter]]));

/**
 * Merge these packs and register everything the sheet reads from them: the
 * tables, the option menus their blocks and catalogues carry, and companion
 * ability text. What the page does on every refresh, and what a tool or test
 * in Node calls to see the packs exactly as the app does. Returns the tables
 * that could not be read, each left empty.
 */
export function registerPacks(packs) {
  const tables = mergeTables(packs);
  const failed = registerTables(tables, REGISTRARS);
  // The option menus a pack carries as blocks, so a feature column pointing
  // at one by name finds it as soon as its pack is switched on.
  const blocks = activeBlocks(packs);
  // A catalogue pack's class options and wild talents are menus too, though
  // nothing in it says so. A block of the same name is the one meant. Both of
  // these read every block, so they are held to the same terms as the
  // tables: one that cannot be read is left empty rather than stopping here.
  try {
    setOptionCatalogues([...classFeatureTextFromTables(tables), ...optionCataloguesFromTables(tables), ...optionCataloguesFrom(blocks)]);
  } catch (err) {
    failed.push({ name: 'setOptionCatalogues', error: err?.message || String(err) });
    setOptionCatalogues([]);
  }
  // And the rules text behind a companion ability the table grants by name.
  try {
    setCompanionAbilityText(namedTextFrom(blocks));
  } catch (err) {
    failed.push({ name: 'setCompanionAbilityText', error: err?.message || String(err) });
    setCompanionAbilityText([]);
  }
  return failed;
}

class ExtensionRuntime extends EventTarget {
  bundled = [];
  #loading = null;
  #store = null;

  /**
   * The local store. It exists from the first ask, but it is empty until
   * `load()` has opened it -- choosing where packs live means opening a
   * database, and that is a promise. Empty reads the same as no packs, which
   * is exactly what the bundled ones do while they are still being fetched.
   */
  get store() {
    if (this.#store === null) {
      try {
        this.#store = (globalThis.localStorage || globalThis.indexedDB)
          ? extensionStore(() => packMedium({ holds: isPackKey, keep: packsWorthMoving }))
          : false;
      } catch { this.#store = false; }
    }
    return this.#store || null;
  }

  /**
   * Fetch the bundled packs, open the local store, and register the merged
   * tables. Idempotent: the first caller's promise is kept, so the sheet and
   * the manager can both ask and the files are read once. `base` is where
   * `data/` is resolved from.
   */
  load(base) {
    if (!this.#loading) {
      this.#loading = Promise.all([
        loadBundledExtensions(base).catch(() => []),
        this.store ? this.store.open().catch(() => false) : Promise.resolve(false),
      ]).then(([docs]) => {
        this.bundled = docs;
        // Kept whatever happens: this promise is cached, and every character
        // the page opens waits on it. A load that failed here would stay failed.
        try { this.refresh({ silent: true }); } catch (err) { console.error('Could not register the packs', err); }
        return this.active();
      });
    }
    return this.#loading;
  }

  active() { return activeExtensions(this.bundled, this.store); }
  blocks() { return activeBlocks(this.active()); }

  /** Re-merge and re-register; fires `change` unless told to be quiet. */
  refresh({ silent = false } = {}) {
    const failed = registerPacks(this.active());
    for (const f of failed) console.warn(`A switched-on pack could not be read (${f.name}): ${f.error}`);
    if (!silent) this.dispatchEvent(new CustomEvent('change', { detail: { active: this.active() } }));
  }
}

export const runtime = new ExtensionRuntime();
