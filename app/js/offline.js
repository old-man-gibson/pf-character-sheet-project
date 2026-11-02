// The service worker registration for app/index.html, kept out of the page so
// the page can forbid inline scripts (its Content-Security-Policy).
  /*
   * Offline: the deployed site keeps a copy of itself (/sw.js) and opens from
   * it when the network does not answer. Not on a local server, where the
   * files are on the same machine anyway and a worker would only stand
   * between a developer and their edits -- unless `cs-offline` is set to
   * "on" in localStorage, for trying it there.
   */
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let forced = false;
  try { forced = localStorage.getItem('cs-offline') === 'on'; } catch { /* no storage: not forced */ }
  if ('serviceWorker' in navigator && (!local || forced)) {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).then(async () => {
      const ready = await navigator.serviceWorker.ready;
      // Once the sheet has loaded what it needs, the worker is told what that
      // was, so the copy is complete from this visit on.
      await customElements.whenDefined('character-sheet');
      const sheet = document.querySelector('character-sheet');
      await Promise.race([sheet?.whenReady?.(), new Promise((r) => setTimeout(r, 8000))]);
      // The site's root and the app's folder too: the addresses a bookmark holds.
      const keep = [location.href, new URL('./', location.href).href, new URL('../', location.href).href,
        ...performance.getEntriesByType('resource').map((e) => e.name)];
      ready.active?.postMessage({ keep });
    }).catch(() => { /* not offered: the app works online as before */ });
  }
