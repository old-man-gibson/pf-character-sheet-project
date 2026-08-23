/**
 * storage-report.js -- what this browser is holding, and what it will hold.
 *
 * Paste it into the console on the sheet's page. There is no number to design
 * against here: "5 MB per origin" is long dead, this app's Chromium filled
 * localStorage to 49.8 MB before it threw, and Brave refused a 4.2 MB pack
 * with a small one after it. The budget moves with the engine and with free
 * disk, so the only honest answer is to measure the browser in hand.
 *
 * The origin keeps things in three places, and this reports all three:
 *
 *   localStorage    every character's working state -- the live sheet,
 *                   rewritten as it is edited, which has to be written
 *                   synchronously and so cannot live anywhere else. Headroom
 *                   is measured rather than quoted: filled with 256 KB chunks
 *                   until it throws, then every one of them removed again.
 *
 *   IndexedDB       saved characters and their snapshots (`character-sheets`)
 *                   and the packs you have imported (`character-sheet-
 *                   extensions`). Measured against a fraction of free disk
 *                   instead, which is the difference between a 4 MB catalogue
 *                   fitting and not, and why the packs moved here.
 *
 *   nowhere         a pack the deployment carries in `data/extensions/` or
 *                   `private/extensions/` is fetched into memory every load
 *                   and never stored at all, so it appears in neither list.
 *                   That is the point of putting one there.
 *
 * It also names two things worth knowing about:
 *
 *   orphans         a pack document nothing points at. Storing a pack was two
 *                   writes, and until the 2026-08-22 fix a browser filling up
 *                   between them left a document `list()` could not see:
 *                   invisible to the dialog, unremovable through it, holding
 *                   exactly the space the "out of space" message was asking
 *                   to be freed. Saving is all-or-nothing now, but a profile
 *                   that hit the old bug still holds whatever it left. This
 *                   finds it and prints the one line that clears it.
 *
 *   not yet moved   packs still in localStorage. They move on the first load
 *                   with a working database; seeing them here means that load
 *                   has not happened, or there is no database to be had.
 *
 * Nothing here writes anything it does not remove again before it returns.
 */
(async () => {
  const INDEX = 'character-sheet:extensions';
  const BODY = 'character-sheet:ext:';
  const PROBE = '__storage-report-probe:';
  const CHUNK = 262144;
  const PACK_DB = 'character-sheet-extensions';
  const PACK_STORE = 'packs';

  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

  /* ---- localStorage ---- */

  const size = (k) => (localStorage.getItem(k) || '').length;
  const used = Object.keys(localStorage).reduce((n, k) => n + k.length + size(k), 0);

  // Fill until it refuses, then put it all back. The removal cannot itself
  // fail: every key it takes out was written by the loop above it.
  let n = 0;
  try { for (; ; n++) localStorage.setItem(PROBE + n, 'x'.repeat(CHUNK)); } catch { /* full */ }
  for (let i = 0; i < n; i++) localStorage.removeItem(PROBE + i);

  console.log('%clocalStorage', 'font-weight:bold');
  console.log('  in use   :', mb(used));
  console.log('  headroom :', mb(n * CHUNK));
  console.log('  ceiling  :', mb(used + n * CHUNK), '(roughly -- it moves with free disk)');

  /* ---- IndexedDB ---- */

  const packs = await new Promise((resolve) => {
    const req = indexedDB.open(PACK_DB);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PACK_STORE)) { db.close(); resolve([]); return; }
      const all = db.transaction(PACK_STORE, 'readonly').objectStore(PACK_STORE).getAll();
      all.onerror = () => { db.close(); resolve(null); };
      all.onsuccess = () => { db.close(); resolve(all.result); };
    };
  });

  console.log('%cIndexedDB', 'font-weight:bold');
  if (navigator.storage?.estimate) {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    console.log('  in use   :', mb(usage), '(everything this origin stores, both places)');
    console.log('  ceiling  :', mb(quota));
  } else {
    console.log('  this browser will not say what it allows');
  }

  if (packs === null) {
    console.log('  no pack database -- packs are still in localStorage below');
  } else {
    const listed = (() => {
      const row = packs.find((r) => r.key === INDEX) || { value: localStorage.getItem(INDEX) };
      try { return new Set((JSON.parse(row.value || '{}').extensions || []).map((e) => BODY + e.id)); } catch { return new Set(); }
    })();
    const bodies = packs.filter((r) => r.key.startsWith(BODY));
    console.table(bodies.map((r) => ({
      pack: r.key.slice(BODY.length),
      size: mb(r.value.length),
      orphan: !listed.has(r.key) || undefined,
    })));
    const stray = bodies.filter((r) => !listed.has(r.key)).map((r) => r.key);
    if (stray.length) {
      console.warn(`${stray.length} pack document in the database that the index does not list.`);
      console.warn(`  Clear with: indexedDB.open('${PACK_DB}').onsuccess = (e) => ${JSON.stringify(stray)}.forEach((k) => e.target.result.transaction('${PACK_STORE}', 'readwrite').objectStore('${PACK_STORE}').delete(k))`);
    }
  }

  /* ---- what is still in localStorage that should not be ---- */

  let leftBehind;
  try { leftBehind = JSON.parse(localStorage.getItem(INDEX) || '{}'); } catch { leftBehind = {}; }
  const listedHere = new Set((leftBehind.extensions || []).map((e) => BODY + e.id));
  const here = Object.keys(localStorage).filter((k) => k.startsWith(BODY));
  if (!here.length) return console.log('No pack documents left in localStorage.');

  const orphans = here.filter((k) => !listedHere.has(k));
  const waiting = here.filter((k) => listedHere.has(k));
  console.log('%cstill in localStorage', 'font-weight:bold');
  console.table(here.map((k) => ({
    pack: k.slice(BODY.length),
    size: mb(size(k)),
    why: listedHere.has(k) ? 'not moved to the database yet' : 'orphan -- nothing points at it',
  })));
  if (waiting.length) console.log(`  ${waiting.length} will move on the next load with a working database.`);
  if (orphans.length) {
    console.warn(`${orphans.length} orphaned pack document holding ${mb(orphans.reduce((s, k) => s + size(k), 0))}.`);
    console.warn('The Extensions dialog cannot see these, and they will not move on their own. To reclaim the space:');
    console.warn(`  ${JSON.stringify(orphans)}.forEach((k) => localStorage.removeItem(k))`);
  }
})();
