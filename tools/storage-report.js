/**
 * storage-report.js -- what this browser is holding, and what it will hold.
 *
 * Paste it into the console on the sheet's page. There is no number to design
 * against here: "5 MB per origin" is long dead, this app's Chromium filled to
 * 49.8 MB before it threw, and Brave refused a 4.2 MB pack with a small one
 * after it. The budget moves with the engine and with free disk, so the only
 * honest answer is to measure the browser in hand.
 *
 * It reports three things:
 *
 *   in use / headroom / ceiling   what is stored now, and what more will fit.
 *                                 Headroom is measured by filling the origin
 *                                 with 256 KB chunks until it throws and then
 *                                 removing every one of them, so it is a real
 *                                 answer rather than a quoted one.
 *
 *   a row per pack                which packs are costing what. A pack the
 *                                 deployment carries in `data/extensions/` or
 *                                 `private/extensions/` is fetched, not
 *                                 stored, and will not appear here at all --
 *                                 which is the point of putting it there.
 *
 *   orphans                       a pack document nothing points at. The index
 *                                 and the document are two writes, and until
 *                                 the 2026-08-22 fix a browser filling up
 *                                 between them left a document `list()` could
 *                                 not see: invisible to the dialog, unremovable
 *                                 through it, and holding exactly the space the
 *                                 "out of space" message was asking to be
 *                                 freed. Saving is all-or-nothing now, but a
 *                                 profile that hit the old bug still holds
 *                                 whatever it left. This finds it and prints
 *                                 the one line that clears it.
 *
 * Nothing here writes anything that is not removed again before it returns.
 */
(() => {
  const INDEX = 'character-sheet:extensions';
  const BODY = 'character-sheet:ext:';
  const PROBE = '__storage-report-probe:';
  const CHUNK = 262144;

  const size = (k) => (localStorage.getItem(k) || '').length;
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

  let index;
  try { index = JSON.parse(localStorage.getItem(INDEX) || '{}'); } catch { index = {}; }
  const listed = new Set((index.extensions || []).map((e) => BODY + e.id));
  const bodies = Object.keys(localStorage).filter((k) => k.startsWith(BODY));
  const orphans = bodies.filter((k) => !listed.has(k));
  const used = Object.keys(localStorage).reduce((n, k) => n + k.length + size(k), 0);

  // Fill until it refuses, then put it all back. The removal cannot itself
  // fail: every key it takes out was written by the loop above it.
  let n = 0;
  try { for (; ; n++) localStorage.setItem(PROBE + n, 'x'.repeat(CHUNK)); } catch { /* full */ }
  for (let i = 0; i < n; i++) localStorage.removeItem(PROBE + i);

  console.log('in use now :', mb(used));
  console.log('headroom   :', mb(n * CHUNK));
  console.log('ceiling    :', mb(used + n * CHUNK), '(roughly -- it moves with free disk)');
  console.table(bodies.map((k) => ({
    pack: k.slice(BODY.length),
    size: mb(size(k)),
    orphan: !listed.has(k) || undefined,
  })));

  if (!orphans.length) return console.log('No orphaned pack documents.');
  console.warn(`${orphans.length} orphaned pack document holding ${mb(orphans.reduce((s, k) => s + size(k), 0))}.`);
  console.warn('The Extensions dialog cannot see these. To reclaim the space, run:');
  console.warn(`  ${JSON.stringify(orphans)}.forEach((k) => localStorage.removeItem(k))`);
})();
