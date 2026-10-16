// Where the planner keeps plans. Two stores with the same methods, so the
// pages never care which they have:
//
//   files    the plan files in gm-module/plans/ (or --gm-data), through the
//            planner API, when the page is served by tools/serve.mjs on this
//            computer;
//   browser  this browser's own IndexedDB database, "gm-planner", apart from
//            the sheet's characters and packs, everywhere else (the public
//            site, any plain static server).
//
// openStore() asks for the API and falls back to the browser. Both hold the
// same plan JSON, so a plan exported from one imports into the other.
//
// Methods, all async:
//   list()                    [{ name, title, players, activities }]
//   create(name, plan)        { ok: true, v, plan } | { ok: false, error }
//   read(name, since)         null | { v, same: true } | { v, plan }
//   write(name, plan, base)   { ok: true, v } | { ok: false, v, plan } (v and plan
//                             null when the plan is gone); refused unless the
//                             stored plan is still at version `base`
//   remove(name)              deletes the plan
//   playerView(name, since)   null | { v, same: true } | { v, view }
//   readLibrary()             { v, library } (the activity library; v null when empty)
//   writeLibrary(library, base)   { ok: true, v } | { ok: false, v, library }
//   writeOnExit(name, plan, base)   a write that may outlive the page
// and `kind` ('files' | 'browser') and `where` (said on the page).
//
// A version is opaque to the pages: a hash of the file for files, a revision
// count for the browser. A player view's version is a hash of the view, so a
// change only the GM sees (a DC, a reward) does not redraw it.

import { databaseOpener, finished, result } from '../../app/js/idb.js';
import { isLocalHost } from '../../app/js/gm-tools.js';
import { normalizeLibrary, normalizePlan, planSummary, playerView, textHash, validName } from './plan.js';

const viewVersion = view => textHash(JSON.stringify(view));
const byName = (x, y) => x.name.localeCompare(y.name, undefined, { numeric: true });

// ---- Files, through the planner API -------------------------------------------

export function fileStore(api = 'api/', dir = '') {
  async function call(path, options = {}) {
    const res = await fetch(api + path, options);
    const out = await res.json().catch(() => ({}));
    return { res, out };
  }
  const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const q = name => `name=${encodeURIComponent(name)}`;
  const failed = (res, out) => new Error(out.error || `${res.status} ${res.statusText}`);

  return {
    kind: 'files',
    where: dir,
    async list() {
      const { res, out } = await call('plans');
      if (!res.ok) throw failed(res, out);
      return out.plans;
    },
    async create(name, plan) {
      const { res, out } = await call('plans', send('POST', { name, plan }));
      if (res.status === 201) return { ok: true, v: out.v, plan: out.plan };
      if (res.status === 409 || res.status === 400) return { ok: false, error: out.error };
      throw failed(res, out);
    },
    async read(name, since = '') {
      const { res, out } = await call(`plan?${q(name)}&since=${encodeURIComponent(since ?? '')}`);
      if (res.status === 404) return null;
      if (!res.ok) throw failed(res, out);
      return out.same ? { v: out.v, same: true } : { v: out.v, plan: out.plan };
    },
    async write(name, plan, base) {
      const { res, out } = await call(`plan?${q(name)}`, send('PUT', { base, plan }));
      if (res.ok) return { ok: true, v: out.v };
      if (res.status === 409) return { ok: false, v: out.v ?? null, plan: out.plan ?? null };
      throw failed(res, out);
    },
    async remove(name) {
      const { res, out } = await call(`plan?${q(name)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } });
      if (!res.ok) throw failed(res, out);
    },
    async playerView(name, since = '') {
      const { res, out } = await call(`players?${q(name)}&since=${encodeURIComponent(since ?? '')}`);
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw failed(res, out);
      return out.same ? { v: out.v, same: true } : { v: out.v, view: out.view };
    },
    async readLibrary() {
      const { res, out } = await call('library');
      if (!res.ok) throw failed(res, out);
      return { v: out.v, library: normalizeLibrary(out.library) };
    },
    async writeLibrary(library, base) {
      const { res, out } = await call('library', send('PUT', { base, library }));
      if (res.ok) return { ok: true, v: out.v };
      if (res.status === 409) return { ok: false, v: out.v ?? null, library: normalizeLibrary(out.library) };
      throw failed(res, out);
    },
    // keepalive lets the request finish after the page has gone.
    writeOnExit(name, plan, base) {
      fetch(`${api}plan?${q(name)}`, { ...send('PUT', { base, plan }), keepalive: true }).catch(() => {});
    },
  };
}

// ---- This browser, in IndexedDB ------------------------------------------------
//
// One record per plan: { name, rev, plan }. `factory` is the IndexedDB to use
// (a stand-in in the tests).

const STORE = 'plans';
// The activity library's record in the same store: not a valid plan name, so
// list() never shows it.
const LIBRARY = '_library';

export function browserStore({ factory = null } = {}) {
  const openDb = databaseOpener({
    name: 'gm-planner',
    version: 1,
    factory,
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' });
    },
  });

  // Runs `fn(store)` in one transaction; resolves with what fn's promise
  // resolved to, once the transaction has committed.
  async function inTx(mode, fn) {
    const db = await openDb();
    const tx = db.transaction(STORE, mode);
    const done = finished(tx);
    const out = await fn(tx.objectStore(STORE));
    await done;
    return out;
  }
  const get = (store, name) => result(store.get(name));

  return {
    kind: 'browser',
    where: 'this browser',
    async list() {
      const rows = await inTx('readonly', store => result(store.getAll()));
      return rows.filter(r => validName(r.name)).map(r => planSummary(r.name, normalizePlan(r.plan))).sort(byName);
    },
    async create(name, plan) {
      if (!validName(name)) return { ok: false, error: 'Plan names use letters, digits, spaces, - and _.' };
      const clean = normalizePlan(plan);
      return inTx('readwrite', async store => {
        if (await get(store, name)) return { ok: false, error: 'A plan with that name exists.' };
        store.put({ name, rev: 1, plan: clean });
        return { ok: true, v: '1', plan: clean };
      });
    },
    async read(name, since = '') {
      const row = await inTx('readonly', store => get(store, name));
      if (!row) return null;
      const v = String(row.rev);
      return v === since ? { v, same: true } : { v, plan: normalizePlan(row.plan) };
    },
    async write(name, plan, base) {
      const clean = normalizePlan(plan);
      return inTx('readwrite', async store => {
        const row = await get(store, name);
        const now = row ? String(row.rev) : null;
        if (now !== (base ?? null)) return { ok: false, v: now, plan: row ? normalizePlan(row.plan) : null };
        const rev = (row?.rev ?? 0) + 1;
        store.put({ name, rev, plan: clean });
        return { ok: true, v: String(rev) };
      });
    },
    async remove(name) {
      await inTx('readwrite', async store => { store.delete(name); });
    },
    async playerView(name, since = '') {
      const row = await inTx('readonly', store => get(store, name));
      if (!row) return null;
      const view = playerView(normalizePlan(row.plan));
      const v = viewVersion(view);
      return v === since ? { v, same: true } : { v, view };
    },
    async readLibrary() {
      const row = await inTx('readonly', store => get(store, LIBRARY));
      return { v: row ? String(row.rev) : null, library: normalizeLibrary(row?.library) };
    },
    async writeLibrary(library, base) {
      const clean = normalizeLibrary(library);
      return inTx('readwrite', async store => {
        const row = await get(store, LIBRARY);
        const now = row ? String(row.rev) : null;
        if (now !== (base ?? null)) return { ok: false, v: now, library: normalizeLibrary(row?.library) };
        const rev = (row?.rev ?? 0) + 1;
        store.put({ name: LIBRARY, rev, library: clean });
        return { ok: true, v: String(rev) };
      });
    },
    // An IndexedDB write started while the page goes away still commits.
    writeOnExit(name, plan, base) {
      this.write(name, plan, base).catch(() => {});
    },
  };
}

// ---- Choosing one --------------------------------------------------------------

// The file store when the planner API answers here, otherwise this browser's.
// The API only ever runs on this computer, so a page elsewhere (the public
// site) does not ask for it.
export async function openStore({ api = 'api/', factory = null, local = isLocalHost(location.hostname) } = {}) {
  if (!local) return browserStore({ factory });
  try {
    const res = await fetch(`${api}plans`);
    if (res.ok && (res.headers.get('content-type') ?? '').startsWith('application/json')) {
      const out = await res.json();
      if (Array.isArray(out.plans)) return fileStore(api, out.dir ?? '');
    }
  } catch { /* no planner API on this server */ }
  return browserStore({ factory });
}
