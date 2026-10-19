/**
 * sw.js -- the sheet, offline.
 *
 * At the table the connection is the one thing nobody controls, and a sheet
 * that will not open without it is a sheet nobody can use. This keeps a copy
 * of every file the app has loaded and answers from it when the network does
 * not.
 *
 * Network first, always: online, every request goes to the server and the
 * copy is refreshed from the answer, so an update is never hidden behind a
 * stale cache. Only a request that fails -- or a page that takes too long to
 * come -- is answered from the copy. And a page that had to be opened from
 * the copy takes everything else from it too, so its modules are all of one
 * version rather than half from the server and half from last week.
 *
 * What is kept is what was used: the page tells this worker which files it
 * loaded (see the registration in index.html), so there is no list here to
 * fall out of step with the app. The publishing store (/api/) is never kept.
 * Characters and the player's own packs live in the browser's own storage
 * and need nothing from here.
 *
 * It sits at the root of the site, not in app/, so that its scope is the
 * whole site: the address people bookmark is the root, which only redirects
 * to the app, and a worker scoped to app/ never sees that page.
 */

const CACHE = 'cs-app-v1';
/** How long a page may take before the kept copy is shown instead. */
const PAGE_WAIT_MS = 6000;
/** Pages opened from the copy, whose files come from it too. */
const offline = new Set();

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('cs-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/** Whether a request is one to keep and answer: this site's own files, read. */
function keepable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return true;
}

/** The kept copy, ignoring the query (`?v=`, `?s=`) a page or a module was asked for with. */
async function kept(request) {
  const cache = await caches.open(CACHE);
  return (await cache.match(request)) || cache.match(request, { ignoreSearch: true });
}

async function fromNetwork(request) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => { /* full: the page still works online */ });
  }
  return response;
}

async function page(event) {
  const network = fromNetwork(event.request);
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_WAIT_MS, null));
  try {
    const answer = await Promise.race([network, timeout]);
    if (answer) return answer;
  } catch { /* offline: the copy below */ }
  const copy = await kept(event.request);
  if (copy) {
    if (event.resultingClientId) offline.add(event.resultingClientId);
    // A page kept from a fetch that followed a redirect (/app/index.html to
    // /app/) cannot answer a navigation as it is; its body and headers can.
    return copy.redirected ? new Response(copy.body, { status: copy.status, headers: copy.headers }) : copy;
  }
  return network;
}

async function file(event) {
  if (offline.has(event.clientId)) {
    const copy = await kept(event.request);
    if (copy) return copy;
  }
  try {
    return await fromNetwork(event.request);
  } catch (err) {
    const copy = await kept(event.request);
    if (copy) return copy;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  if (!keepable(event.request)) return;
  event.respondWith(event.request.mode === 'navigate' ? page(event) : file(event));
});

/*
 * The page's list of what it loaded: kept now, so the first visit after an
 * update already leaves a working copy -- the files it fetched before this
 * worker took over never passed through the handler above.
 */
self.addEventListener('message', (event) => {
  const urls = Array.isArray(event.data?.keep) ? event.data.keep : [];
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const href of urls) {
      try {
        const url = new URL(href, self.location.href);
        const request = new Request(url.href);
        if (!keepable(request) || await cache.match(request)) continue;
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') await cache.put(request, response);
      } catch { /* one file that will not come is not worth the rest */ }
    }
  })());
});
