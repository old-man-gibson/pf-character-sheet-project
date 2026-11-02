// The script of app/published.html, kept out of the page so the page can
// forbid inline scripts (its Content-Security-Policy). Paths in fetch() still
// resolve against the page, app/.
import './sheet-element.js';

const params = new URLSearchParams(location.search);

/** Say what went wrong where the sheet would have been. */
function fail(message) {
  const empty = document.getElementById('empty');
  if (empty) empty.textContent = message;
}

/** The keys #previewPublished in sheet-element.js writes. No other key is read or removed. */
const PREVIEW_PREFIX = 'published-preview:';

/**
 * The handover from the Preview published button in another tab.
 *
 * A preview is a one-shot: the tab that opened this owns the character, and a
 * copy left behind in storage would outlive the look at it.
 */
function fromStorage(key) {
  if (!key.startsWith(PREVIEW_PREFIX)) return null;
  let payload = null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) payload = JSON.parse(raw);
  } catch { payload = null; }
  try { localStorage.removeItem(key); } catch { /* nothing to clean up */ }
  return payload;
}

/**
 * A published document from wherever it is hosted.
 *
 * Relative links resolve against this page, which is what makes a file sitting
 * beside the app in a Pages deploy the simplest thing that works. Only http and
 * https are fetched, and without credentials: this URL arrived in a query
 * string, so it is a stranger's, and a stranger's URL should not be handed the
 * reader's cookies.
 */
async function fromUrl(raw) {
  const url = new URL(raw, location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${url.protocol} links are not fetched — only http and https.`);
  }
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`${url.href} answered ${res.status} ${res.statusText}.`);
  return { doc: await res.json(), summary: '' };
}

/**
 * A character in this site's own store.
 *
 * The store answers with the document, when it was published and which
 * revision this is; the summary line says so, because a reader deciding
 * whether a sheet is current needs the date more than the carried-entry count.
 */
async function fromStore(id, rev) {
  const path = `../api/c/${encodeURIComponent(id)}${rev ? `/${encodeURIComponent(rev)}` : ''}`;
  const res = await fetch(new URL(path, location.href), { credentials: 'omit' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `the store answered ${res.status} ${res.statusText}.`);
  const when = data.published ? new Date(data.published).toLocaleString() : '';
  const summary = [
    data.rev ? `revision ${data.rev}` : '', when ? `published ${when}` : '', data.summary || '',
  ].filter(Boolean).join(' · ');
  return { doc: data.doc, summary };
}

let payload = null;
const key = params.get('k');
const src = params.get('src');
const stored = params.get('s');

if (key) payload = fromStorage(key);
else if (stored || src) {
  try {
    payload = stored ? await fromStore(stored, params.get('r')) : await fromUrl(src);
  } catch (err) {
    fail(`Could not open that published character — ${err.message}`);
  }
}

if (payload?.doc) {
  document.getElementById('empty')?.remove();
  document.getElementById('who').textContent = payload.doc.identity?.name || 'a character';
  document.getElementById('what').textContent = payload.summary || '';
  const sheet = document.createElement('character-sheet');
  sheet.setAttribute('packs', 'none');   // the whole point: no packs but the document's own
  sheet.setAttribute('published', '');   // no Save, History, Import or Reset; Export JSON stays
  sheet.setAttribute('role', 'player');
  sheet.setAttribute('hotkeys', 'off');
  document.getElementById('wrap').append(sheet);
  sheet.character = payload.doc;
} else if (key) {
  fail(key.startsWith(PREVIEW_PREFIX)
    ? 'That preview has already been opened. Press “Preview published” again to make a new one.'
    : 'This link does not open a preview.');
}
