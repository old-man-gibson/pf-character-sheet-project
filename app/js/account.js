/*
 * account.js -- the signed-in account, and the server's copy of each of its
 * characters.
 *
 * The calls here go to the site's own Worker (functions/api/auth.js and
 * saves.js). A copy of the app with no Worker behind it -- a static host, the
 * local file server -- answers none of them, and `whoAmI` then reports
 * `{ available: false }`, which is what keeps the sign-in button off the page.
 *
 * What a browser knows about a character's server copy is one small record
 * per character in localStorage:
 *
 *   character-sheet:server:<id>   { owner, rev, savedAt }
 *
 * `rev` is the server revision this browser last sent or loaded, and
 * `savedAt` is the time on this browser's saved version when it did. A saved
 * version with another time has not been sent yet. `syncPlan` reads the two
 * against the server's revision and says what to do.
 */

import { pack, unpack } from './history.js';
import { fromBase64, toBase64 } from './base64.js';

/** The Worker's address for one call (this file is app/js/; the API is /api). */
const api = (path) => new URL(`../../api/${path}`, import.meta.url);
const call = (path, init = {}) => fetch(api(path), { credentials: 'same-origin', cache: 'no-store', ...init });

/** The answer's body, or an error carrying the server's message and status. A 409 is an answer. */
async function answer(res) {
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 409) {
    const err = new Error(body?.error || `the server answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

let asked = null;

/**
 * Who is signed in: `{ available, signedIn, id, name, member, saves }`.
 * Asked once per page load unless `again`. Never throws.
 */
export function whoAmI({ again = false } = {}) {
  if (asked && !again) return asked;
  asked = (async () => {
    try {
      const res = await call('auth/me');
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return { available: false };
      const me = await res.json();
      return me?.available ? me : { available: false };
    } catch {
      return { available: false };
    }
  })();
  return asked;
}

/** The address that starts a sign-in and comes back to `returnTo`. */
export function signInUrl(returnTo = location.pathname) {
  const url = api('auth/discord');
  url.searchParams.set('return', returnTo);
  return url.href;
}

export async function signOut() {
  await answer(await call('auth/signout', { method: 'POST' }));
}

/** Every character the account has on the server, without the documents: `[{ id, rev, saved, summary }]`. */
export async function listSaves() {
  return (await answer(await call('saves')))?.saves || [];
}

/** One character from the server: `{ id, rev, saved, summary, doc }`. */
export async function readSave(id) {
  const row = await answer(await call(`saves/${encodeURIComponent(id)}`));
  return { id: row.id, rev: row.rev, saved: row.saved, summary: row.summary, doc: await unpack(fromBase64(row.gz)) };
}

/**
 * Send a document as the character's next revision. Answers `{ rev, saved }`,
 * or `{ conflict: { rev, saved, summary } }` when the server's copy is not
 * the revision `base` names and `force` is not set.
 */
export async function writeSave(id, doc, { base = 0, summary = {}, force = false } = {}) {
  const gz = toBase64(await pack(doc));
  const res = await call(`saves/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base, summary, gz, ...(force ? { force: true } : {}) }),
  });
  const body = await answer(res);
  return res.status === 409 ? { conflict: body } : body;
}

export async function deleteSave(id) {
  await answer(await call(`saves/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

const syncKey = (id) => `character-sheet:server:${id}`;

/** What this browser last matched on the server for a character, if `owner` is the account that did. */
export function readSync(id, owner) {
  try {
    const record = JSON.parse(localStorage.getItem(syncKey(id)) || 'null');
    return record && record.owner === owner ? record : null;
  } catch {
    return null;
  }
}

export function writeSync(id, record) {
  try { localStorage.setItem(syncKey(id), JSON.stringify(record)); } catch { /* the next check asks which copy to keep */ }
}

export function clearSync(id) {
  try { localStorage.removeItem(syncKey(id)); } catch { /* nothing kept */ }
}

/**
 * What to do about a character that is in this browser.
 *
 *   server    the server's copy, `{ rev }`, or null when it has none
 *   sync      what this browser last matched, `{ rev, savedAt }`, or null
 *   savedAt   the time on this browser's saved version, or null if never saved
 *
 *   'push'  send this browser's copy
 *   'pull'  load the server's copy: it moved on and nothing here is unsent
 *   'ask'   both changed, or the two copies were never matched: the player picks
 *   'none'  the two are the same
 */
export function syncPlan({ server, sync, savedAt }) {
  if (!server) return 'push';
  if (!sync) return 'ask';
  const unsent = (savedAt || null) !== (sync.savedAt || null);
  if (sync.rev === server.rev) return unsent ? 'push' : 'none';
  return unsent ? 'ask' : 'pull';
}
