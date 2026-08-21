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

import {
  setManeuverCatalogue, setSphereCatalogue, setVancianTables, setPsionicTables,
  setCardcastingTables, setCookingTables, setOptionCatalogues,
} from './model.js';
import {
  extensionStore, loadBundledExtensions, activeExtensions, activeBlocks, mergeTables, registerTables,
  optionCataloguesFrom,
} from './extensions.js';

const REGISTRARS = {
  setManeuverCatalogue, setSphereCatalogue, setVancianTables, setPsionicTables,
  setCardcastingTables, setCookingTables,
};

class ExtensionRuntime extends EventTarget {
  bundled = [];
  #loading = null;
  #store = null;

  /** The local store, or null where there is no localStorage (a Node import). */
  get store() {
    if (this.#store === null) {
      try { this.#store = globalThis.localStorage ? extensionStore(globalThis.localStorage) : false; } catch { this.#store = false; }
    }
    return this.#store || null;
  }

  /**
   * Fetch the bundled packs and register the merged tables. Idempotent: the
   * first caller's promise is kept, so the sheet and the manager can both ask
   * and the files are read once. `base` is where `data/` is resolved from.
   */
  load(base) {
    if (!this.#loading) {
      this.#loading = loadBundledExtensions(base)
        .catch(() => [])
        .then((docs) => { this.bundled = docs; this.refresh({ silent: true }); return this.active(); });
    }
    return this.#loading;
  }

  active() { return activeExtensions(this.bundled, this.store); }
  blocks() { return activeBlocks(this.active()); }

  /** Re-merge and re-register; fires `change` unless told to be quiet. */
  refresh({ silent = false } = {}) {
    const active = this.active();
    registerTables(mergeTables(active), REGISTRARS);
    // The option menus a pack carries as blocks, so a feature column pointing
    // at one by name finds it as soon as its pack is switched on.
    setOptionCatalogues(optionCataloguesFrom(activeBlocks(active)));
    if (!silent) this.dispatchEvent(new CustomEvent('change', { detail: { active: this.active() } }));
  }
}

export const runtime = new ExtensionRuntime();
