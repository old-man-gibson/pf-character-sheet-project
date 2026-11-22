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
 *   character-sheet:server:<id>   { owner, rev, savedAt, cps, cpsRev }
 *
 * `rev` is the server revision this browser last sent or loaded, and
 * `savedAt` is the time on this browser's saved version when it did. A saved
 * version with another time has not been sent yet. `syncPlan` reads the two
 * against the server's revision and says what to do.
 *
 * `cps` is the character's checkpoints as this browser last saw them on the
 * server (their ids and names), and `cpsRev` the server's count of changes to
 * them at that time. `checkpointPlan` reads `cps` against the checkpoints
 * here and there and says what to send, list, rename and delete.
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

/**
 * What the account has on the server, without the documents:
 * `{ saves: [{ id, rev, saved, size, cps, summary }], used, limits }`.
 * `used` and `limits.total` are compressed bytes.
 */
export async function readAccount() {
  const body = await answer(await call('saves'));
  return { saves: body?.saves || [], used: body?.used || 0, limits: body?.limits || {} };
}

/** Every character the account has on the server: `[{ id, rev, saved, size, cps, summary }]`. */
export async function listSaves() {
  return (await readAccount()).saves;
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

const checkpointPath = (id, uid = '') => `saves/${encodeURIComponent(id)}/checkpoints${uid ? `/${encodeURIComponent(uid)}` : ''}`;

/** A character's checkpoints on the server: `{ cps, checkpoints: [{ uid, label, savedAt, changes, schema, size }] }`. */
export async function listCheckpoints(id) {
  const body = await answer(await call(checkpointPath(id)));
  return { cps: body?.cps || 0, checkpoints: body?.checkpoints || [] };
}

/** One checkpoint's document from the server, as the gzipped bytes history.js keeps. */
export async function readCheckpointBytes(id, uid) {
  return fromBase64((await answer(await call(checkpointPath(id, uid)))).gz);
}

/**
 * Send a checkpoint: its name, when it was saved, and its gzipped `bytes`.
 * Without `bytes`, the name alone, for one the server already has. Answers `{ uid, cps }`.
 */
export async function writeCheckpoint(id, uid, { label = '', savedAt = '', changes = 0, schema = 0, bytes = null } = {}) {
  return answer(await call(checkpointPath(id, uid), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label, savedAt, changes, schema, ...(bytes ? { gz: toBase64(bytes) } : {}) }),
  }));
}

/** Delete a checkpoint from the server. Answers `{ uid, cps }`. */
export async function deleteCheckpoint(id, uid) {
  return answer(await call(checkpointPath(id, uid), { method: 'DELETE' }));
}

/**
 * What to do about a character's checkpoints, given the ones here, the ones
 * on the server, and the names this browser last saw there (`known`: uid to
 * label).
 *
 *   local    `[{ key, uid, label, onServer }]`   onServer: listed here without its document
 *   server   `[{ uid, label, ... }]`
 *
 * Answers the steps, and `known` as it will be once they are done:
 *
 *   send      here and new: upload it
 *   rename    its name changed here: send the name
 *   take      its name changed there: use that name here
 *   adopt     there and new: list it here, without its document
 *   drop      deleted on another device: delete it here
 *   delete    deleted here: delete it there
 */
export function checkpointPlan({ local = [], server = [], known = {} } = {}) {
  const there = new Map(server.map((cp) => [cp.uid, cp]));
  const steps = { send: [], rename: [], take: [], adopt: [], drop: [], delete: [] };
  const next = {};
  for (const cp of local) {
    const other = there.get(cp.uid);
    there.delete(cp.uid);
    if (!other) {
      // Seen on the server before and gone now, or never held here at all: another device deleted it.
      if (cp.uid in known || cp.onServer) steps.drop.push(cp);
      else { steps.send.push(cp); next[cp.uid] = cp.label; }
      continue;
    }
    if (cp.label === other.label) next[cp.uid] = cp.label;
    else if (cp.uid in known && cp.label !== known[cp.uid]) { steps.rename.push(cp); next[cp.uid] = cp.label; }
    else { steps.take.push({ ...cp, label: other.label }); next[cp.uid] = other.label; }
  }
  for (const other of there.values()) {
    if (other.uid in known) steps.delete.push(other);
    else { steps.adopt.push(other); next[other.uid] = other.label; }
  }
  return { steps, known: next };
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
