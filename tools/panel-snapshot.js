/**
 * panel-snapshot.js -- prove a refactor of the sheet changed no markup.
 *
 * `app/js/sheet-element.js` has no unit tests: nothing under tests/ imports it,
 * because it needs a DOM and the suites are plain Node. That is fine until the
 * file is being taken apart, at which point "the tests pass" says nothing about
 * whether the sheet still renders the same HTML.
 *
 * So this renders it and remembers. It walks every character in the picker,
 * both view modes, and every tab in each, and records the shadow root's HTML
 * for all of them in IndexedDB. Run it once before a refactor and once after,
 * and `compare()` tells you -- per character, per view, per tab -- whether a
 * single byte moved, and shows you where if it did.
 *
 * From the app page's console:
 *
 *   const s = await import('/tools/panel-snapshot.js');
 *   await s.loadFixtures();          // put the private characters in the picker
 *   await s.capture('before');       // ... refactor ...
 *   await s.capture('after');
 *   console.log(await s.compare('before', 'after'));
 *
 * `loadFixtures` needs `private/` to be present and served; without it the
 * public fixture alone is still captured, which is thinner but not nothing.
 */

const DB = 'panel-refactor-baseline';
const STORE = 'snap';
const LIBRARY_KEY = 'character-sheet:library';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- storage ---------------- */

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

const put = async (key, val) => {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
};

const get = async (key) => {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const q = tx.objectStore(STORE).get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
};

/** djb2 -- short, stable, and enough to notice one character moving. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/* ---------------- the roster to walk ---------------- */

const IDS = ['angou', 'bryva', 'narockro', 'nico', 'saburo'];

/**
 * Put the private characters, the public fixture and one "kitchen sink" into
 * the picker.
 *
 * The kitchen sink is the point: no real character uses cooking, crafting,
 * companions or maneuvers, so those panels would go unrendered and a refactor
 * could break them silently. Tagging one class with every system in
 * GAME_SYSTEMS lights their tabs with no data behind them, which is exactly
 * the empty-state markup worth pinning down.
 */
export async function loadFixtures() {
  const characters = [];
  for (const id of IDS) {
    try {
      const r = await fetch(`/private/characters/${id}.json`);
      if (!r.ok) continue;
      const doc = await r.json();
      localStorage.setItem(`character-sheet:doc:${id}`, JSON.stringify(doc));
      characters.push({ id, name: doc.identity.name });
    } catch { /* not served: skip it */ }
  }
  try {
    const r = await fetch('/tests/fixtures/public/characters/vesna.json');
    if (r.ok) {
      const doc = await r.json();
      localStorage.setItem('character-sheet:doc:vesna', JSON.stringify(doc));
      characters.push({ id: 'vesna', name: doc.identity.name });
    }
  } catch { /* nothing to do */ }
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ characters }));
  return { characters: characters.map((c) => c.id), note: 'reload, then call addKitchenSink()' };
}

const SYSTEMS = [
  'spheres-of-power', 'spheres-of-might', 'champion-of-the-spheres', 'vancian',
  'path-of-war', 'psionics', 'akashic', 'cardcasting', 'animal-companion',
  'familiar', 'eidolon', 'techniques', 'cooking', 'crafting',
];

/**
 * Tag one character's first class with every sub-system, and save it as its
 * own row.
 *
 * Tagging alone is not enough. The session tab bar is seeded once, the first
 * time that view is opened, and it does not re-seed when the tags change -- so
 * a character built from another character's saved document inherits *that*
 * one's bar and shows none of the new tabs. Pressing the manager's Reset while
 * the session view is open rebuilds the bar from what is now tagged, which is
 * what turns 12 tabs into 23.
 */
export async function addKitchenSink(from = 'vesna') {
  const host = document.querySelector('character-sheet');
  await select(from);
  const model = host.model;
  for (const s of SYSTEMS) model.toggleClassSystem(0, s);
  const doc = model.toJSON();
  doc.id = 'kitchen';
  doc.identity = { ...doc.identity, name: 'Kitchen Sink' };
  localStorage.setItem('character-sheet:doc:kitchen', JSON.stringify(doc));
  const lib = JSON.parse(localStorage.getItem(LIBRARY_KEY));
  if (!lib.characters.some((c) => c.id === 'kitchen')) {
    lib.characters.push({ id: 'kitchen', name: 'Kitchen Sink' });
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
  }
  return { taggedTabs: [...model.taggedSystemTabs()].sort(), note: 'reload, then call seedKitchenTabs()' };
}

/** Re-seed the kitchen sink's session bar from its tags. Run after a reload. */
export async function seedKitchenTabs() {
  const host = await select('kitchen');
  const sr = host.shadowRoot;
  if (!await setView(host, 'session')) return 'could not reach the session view';
  sr.querySelector('nav.tabs button[data-tab="systabs"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  await wait(120);
  const reset = sr.querySelector('[data-action="tab-reset"]');
  if (!reset) return 'no tab-reset control in the manager';
  reset.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  await wait(250);
  return { tabs: host.model.tabOrder() };
}

/* ---------------- driving the sheet ---------------- */

const library = () => JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{"characters":[]}').characters;

const pickerButton = (id) => {
  const row = library().find((c) => c.id === id);
  if (!row) return null;
  return [...document.querySelectorAll('header.app .picker button')]
    .find((b) => b.textContent.trim().startsWith(row.name));
};

async function select(id) {
  const host = document.querySelector('character-sheet');
  const btn = pickerButton(id);
  if (!btn) throw new Error(`no picker button for ${id}`);
  btn.click();
  await wait(200);
  if (host.whenReady) await host.whenReady();
  await wait(120);
  return host;
}

/** The view toggle is a button, not a setter, so press it until it lands. */
async function setView(host, want) {
  for (let i = 0; i < 3; i++) {
    if (host.model.viewMode() === want) return true;
    const btn = host.shadowRoot.querySelector('[data-action="view-mode"]');
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await wait(120);
  }
  return host.model.viewMode() === want;
}

/* ---------------- capture and compare ---------------- */

/**
 * Walk everything and store it under `run`.
 *
 * Reports progress on `globalThis.__snapshotStatus` because a full pass takes
 * longer than a console call cares to wait for.
 */
export async function capture(run) {
  const status = { state: 'running', run, done: [] };
  globalThis.__snapshotStatus = status;
  const host = document.querySelector('character-sheet');
  host.setAttribute('role', 'admin');            // the Formula Audit tab is admin-only
  const summary = {};
  for (const c of library()) {
    await select(c.id);
    summary[c.id] = {};
    for (const view of ['build', 'session']) {
      if (!await setView(host, view)) { summary[c.id][view] = 'VIEW SWITCH FAILED'; continue; }
      await wait(100);
      const sr = host.shadowRoot;
      const per = {};
      for (const tab of [...sr.querySelectorAll('nav.tabs button')].map((b) => b.dataset.tab)) {
        const b = sr.querySelector(`nav.tabs button[data-tab="${tab}"]`);
        if (!b) continue;
        b.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        await wait(35);
        const html = sr.innerHTML;
        per[tab] = { hash: hash(html), len: html.length };
        await put(`${run}|${c.id}|${view}|${tab}`, html);
      }
      summary[c.id][view] = per;
      status.done.push(`${c.id}/${view}:${Object.keys(per).length}`);
    }
  }
  await put(`${run}|SUMMARY`, summary);
  status.state = 'done';
  status.summary = summary;
  return summary;
}

/** Where two strings first differ, with enough either side to recognise it. */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return { at: i, before: a.slice(Math.max(0, i - 90), i + 90), after: b.slice(Math.max(0, i - 90), i + 90) };
}

/** Compare two runs tab by tab. An empty `changed` is the result worth having. */
export async function compare(runA = 'before', runB = 'after', { details = 3 } = {}) {
  const a = await get(`${runA}|SUMMARY`);
  const b = await get(`${runB}|SUMMARY`);
  if (!a) throw new Error(`no snapshot called "${runA}"`);
  if (!b) throw new Error(`no snapshot called "${runB}"`);
  const changed = [];
  const missing = [];
  let same = 0;
  for (const [id, views] of Object.entries(a)) {
    for (const [view, per] of Object.entries(views)) {
      if (typeof per === 'string') continue;
      for (const [tab, rec] of Object.entries(per)) {
        const other = b[id]?.[view]?.[tab];
        if (!other) { missing.push(`${id}/${view}/${tab}`); continue; }
        if (other.hash === rec.hash) { same++; continue; }
        changed.push({ where: `${id}/${view}/${tab}`, lenBefore: rec.len, lenAfter: other.len });
      }
    }
  }
  const diffs = [];
  for (const c of changed.slice(0, details)) {
    const [id, view, tab] = c.where.split('/');
    const x = await get(`${runA}|${id}|${view}|${tab}`);
    const y = await get(`${runB}|${id}|${view}|${tab}`);
    if (x && y) diffs.push({ where: c.where, ...firstDiff(x, y) });
  }
  return { identical: same, changed, missing, diffs };
}

/** Throw away a run's snapshots (IndexedDB keeps them across reloads otherwise). */
export async function clear(run) {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const q = store.getAllKeys();
    q.onsuccess = () => { for (const k of q.result) if (String(k).startsWith(`${run}|`)) store.delete(k); };
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export const status = () => globalThis.__snapshotStatus ?? { state: 'idle' };
