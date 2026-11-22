/**
 * Server saves: a signed-in account's characters and their checkpoints, kept
 * so any of its devices can open them.
 *
 *   GET    /api/saves        -> { saves: [{ id, rev, saved, size, cps, summary }], used, limits }
 *   GET    /api/saves/<id>   -> { id, rev, saved, summary, gz }
 *   PUT    /api/saves/<id>   { base, summary, gz, force? } -> { id, rev, saved, created? }
 *                            409 { id, rev, saved, summary } when the server's
 *                            copy is not the one `base` names
 *   DELETE /api/saves/<id>   -> { id }   the character and its checkpoints
 *
 *   GET    /api/saves/<id>/checkpoints         -> { cps, checkpoints: [{ uid, label, savedAt, changes, schema, size }] }
 *   GET    /api/saves/<id>/checkpoints/<uid>   -> { uid, label, savedAt, changes, schema, gz }
 *   PUT    /api/saves/<id>/checkpoints/<uid>   { label, savedAt, changes, schema, gz } -> { uid, cps }
 *                                              { label } alone renames one already stored
 *   DELETE /api/saves/<id>/checkpoints/<uid>   -> { uid, cps }
 *
 * `gz` is a character document, gzipped and base64-encoded by the browser
 * (history.js `pack`). The server stores the bytes and never reads the
 * document, so a save costs it no parsing. `summary` is what the picker shows
 * of a character that is not in this browser: its name, level and classes.
 *
 * Each save has a revision number. A browser sends the revision it last saw
 * as `base`; if another device has saved since, the write is refused with 409
 * and the browser asks which copy to keep (`force` writes over the server's).
 * A deleted character's number is remembered, so a character saved again
 * under the same id never repeats a revision another device has seen.
 *
 * A checkpoint is a named earlier state of a character, under an id the
 * browser that made it chose (`uid`). `cps` on a save counts every change to
 * its checkpoints, so a browser that saw the same number last time has
 * nothing to ask about.
 *
 * Any Discord account may save unless the deployment names a server
 * (auth.js), so what one account can store is bounded: a document is at most
 * 1 MB compressed, and an account holds at most 200 characters, 100
 * checkpoints of each, and 25 MB in all. A typical character is about 20 KB,
 * and so is each of its checkpoints.
 *
 * One Durable Object per account holds it all: `meta:<id>` (revision, time,
 * summary), `doc:<id>` (the bytes), `gone:<id>` (the last revision of a
 * deleted one), `cpm:<id>/<uid>` and `cpd:<id>/<uid>` (a checkpoint and its
 * bytes), and `used` (the bytes held in all). `SavesCore` is the behaviour,
 * written against a storage with get/put/delete/list so
 * tests/account-api.test.mjs runs it in Node; `Account` is the Durable Object
 * around it, and `savesRequest` is what the Worker calls once it knows who is
 * signed in.
 */

import { fromBase64, toBase64 } from '../../app/js/base64.js';

const MAX_GZ = 1024 * 1024;
const MAX_BODY = 1536 * 1024;
/** What one account may keep: how many characters, how many checkpoints of each, and how many compressed bytes in all. */
export const LIMITS = { saves: 200, checkpoints: 100, total: 25 * 1024 * 1024 };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** A character id as a save is keyed: one line, no path separators. */
export const validSaveId = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 120 && !/[\x00-\x1f\x7f/\\]/.test(id);

/** A checkpoint's id, as the browser that made it chose it. */
export const validCheckpointId = (uid) => typeof uid === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(uid);

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const number = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The summary as stored: the known fields, each bounded. */
export function cleanSummary(s) {
  const src = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  return {
    name: text(src.name, 120),
    level: number(src.level),
    classes: Array.isArray(src.classes) ? src.classes.slice(0, 12).map((c) => text(c, 60)).filter(Boolean) : [],
    race: text(src.race, 60),
    color: text(src.color, 20),
    origin: text(src.origin, 20),
    schema: number(src.schema),
    published: text(src.published, 20),
  };
}

const NO_CHARACTER = { error: 'No such character on the server.', status: 404 };
const NO_CHECKPOINT = { error: 'No such checkpoint on the server.', status: 404 };

/**
 * One account's saves, apart from the platform. `storage` has async
 * `get(key)`, `put(entries)`, `delete(keys)` and `list(prefix)` (a Map).
 */
export class SavesCore {
  constructor(storage, now = () => Date.now(), limits = LIMITS) {
    this.storage = storage;
    this.now = now;
    this.limits = limits;
  }

  /** The compressed bytes the account holds: the kept count, or a count of everything where none was kept yet. */
  async used() {
    const kept = await this.storage.get('used');
    if (typeof kept === 'number') return kept;
    let bytes = 0;
    for (const prefix of ['meta:', 'cpm:']) {
      for (const row of (await this.storage.list(prefix)).values()) bytes += row.size || 0;
    }
    return bytes;
  }

  /** The refusal for a write that would take the account past its total, or null. */
  #past(total) {
    return total > this.limits.total
      ? { error: `An account keeps at most ${Math.round(this.limits.total / 1024 / 1024)} MB on the server.`, status: 413 }
      : null;
  }

  /** Every save without its document, newest first. */
  async list() {
    const rows = await this.storage.list('meta:');
    return [...rows].map(([key, meta]) => ({ id: key.slice(5), cps: 0, ...meta }))
      .sort((a, b) => (a.saved < b.saved ? 1 : a.saved > b.saved ? -1 : 0));
  }

  async read(id) {
    const meta = await this.storage.get(`meta:${id}`);
    const gz = meta ? await this.storage.get(`doc:${id}`) : null;
    return gz ? { id, ...meta, gz } : null;
  }

  /** Store a document as the next revision, unless the server's copy has moved on from `base`. */
  async write(id, { base = 0, summary = {}, gz, force = false }) {
    const meta = await this.storage.get(`meta:${id}`);
    if (meta && !force && Number(base) !== meta.rev) {
      return { conflict: { id, rev: meta.rev, saved: meta.saved, summary: meta.summary } };
    }
    if (!meta && (await this.storage.list('meta:')).size >= this.limits.saves) {
      return { error: `An account keeps at most ${this.limits.saves} characters on the server.`, status: 413 };
    }
    const total = (await this.used()) - (meta?.size || 0) + gz.length;
    const past = this.#past(total);
    if (past) return past;
    const last = meta ? meta.rev : (await this.storage.get(`gone:${id}`)) || 0;
    const next = { rev: last + 1, saved: new Date(this.now()).toISOString(), size: gz.length, cps: meta?.cps || 0, summary: cleanSummary(summary) };
    await this.storage.put({ [`meta:${id}`]: next, [`doc:${id}`]: gz, used: total });
    // `created` tells the browser there was no copy here: what it remembered of this character's checkpoints no longer holds.
    return { id, rev: next.rev, saved: next.saved, ...(meta ? {} : { created: true }) };
  }

  /** Delete a character and its checkpoints. */
  async remove(id) {
    const meta = await this.storage.get(`meta:${id}`);
    if (!meta) return null;
    let freed = meta.size || 0;
    const keys = [`meta:${id}`, `doc:${id}`];
    for (const [key, row] of await this.storage.list(`cpm:${id}/`)) {
      freed += row.size || 0;
      keys.push(key, `cpd:${key.slice(4)}`);
    }
    await this.storage.put({ [`gone:${id}`]: meta.rev, used: Math.max(0, (await this.used()) - freed) });
    // A delete takes at most 128 keys at a time.
    for (let i = 0; i < keys.length; i += 100) await this.storage.delete(keys.slice(i, i + 100));
    return { id };
  }

  /** A character's checkpoints without their documents, oldest first, and the count of changes to them. */
  async checkpoints(id) {
    const meta = await this.storage.get(`meta:${id}`);
    if (!meta) return NO_CHARACTER;
    const prefix = `cpm:${id}/`;
    const rows = [...await this.storage.list(prefix)].map(([key, row]) => ({ uid: key.slice(prefix.length), ...row }))
      .sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0));
    return { cps: meta.cps || 0, checkpoints: rows };
  }

  async readCheckpoint(id, uid) {
    const row = await this.storage.get(`cpm:${id}/${uid}`);
    const gz = row ? await this.storage.get(`cpd:${id}/${uid}`) : null;
    return gz ? { uid, ...row, gz } : null;
  }

  /** Store a checkpoint of a character that is on the server. Without `gz`, rename one already stored. */
  async writeCheckpoint(id, uid, { label = '', savedAt = '', changes = 0, schema = 0, gz = null }) {
    const meta = await this.storage.get(`meta:${id}`);
    if (!meta) return NO_CHARACTER;
    const key = `cpm:${id}/${uid}`;
    const old = await this.storage.get(key);
    const cps = (meta.cps || 0) + 1;
    if (!gz) {
      if (!old) return NO_CHECKPOINT;
      await this.storage.put({ [key]: { ...old, label: text(label, 120) }, [`meta:${id}`]: { ...meta, cps } });
      return { uid, cps };
    }
    if (!old && (await this.storage.list(`cpm:${id}/`)).size >= this.limits.checkpoints) {
      return { error: `A character keeps at most ${this.limits.checkpoints} checkpoints on the server.`, status: 413 };
    }
    const total = (await this.used()) - (old?.size || 0) + gz.length;
    const past = this.#past(total);
    if (past) return past;
    const when = new Date(savedAt);
    const row = {
      label: text(label, 120),
      savedAt: (Number.isNaN(when.getTime()) ? new Date(this.now()) : when).toISOString(),
      changes: number(changes),
      schema: number(schema),
      size: gz.length,
    };
    await this.storage.put({ [key]: row, [`cpd:${id}/${uid}`]: gz, [`meta:${id}`]: { ...meta, cps }, used: total });
    return { uid, cps };
  }

  async removeCheckpoint(id, uid) {
    const meta = await this.storage.get(`meta:${id}`);
    if (!meta) return NO_CHARACTER;
    const key = `cpm:${id}/${uid}`;
    const old = await this.storage.get(key);
    if (!old) return NO_CHECKPOINT;
    const cps = (meta.cps || 0) + 1;
    await this.storage.put({ [`meta:${id}`]: { ...meta, cps }, used: Math.max(0, (await this.used()) - (old.size || 0)) });
    await this.storage.delete([key, `cpd:${id}/${uid}`]);
    return { uid, cps };
  }
}

/** The gzipped bytes a body carries as base64 in `gz`, or the refusal for a body that has none. */
function readGz(body) {
  if (!body || typeof body.gz !== 'string') return { refuse: json({ error: 'The body needs "gz", the gzipped document in base64.' }, 400) };
  let gz;
  try { gz = fromBase64(body.gz); } catch { return { refuse: json({ error: '"gz" is not base64.' }, 400) }; }
  // The two bytes every gzip stream starts with.
  if (gz.length < 18 || gz[0] !== 0x1f || gz[1] !== 0x8b) return { refuse: json({ error: '"gz" is not a gzipped document.' }, 400) };
  if (gz.length > MAX_GZ) return { refuse: json({ error: `A character on the server is at most ${MAX_GZ / 1024 / 1024} MB compressed.` }, 413) };
  return { gz };
}

/** What a core call came back with, as a response. */
const answer = (out) => (out?.error ? json({ error: out.error }, out.status || 400) : json(out));

/** `/saves/<id>/checkpoints` and `/saves/<id>/checkpoints/<uid>`. */
async function checkpointFetch(core, request, id, uid) {
  if (uid === undefined) {
    return request.method === 'GET' ? answer(await core.checkpoints(id)) : json({ error: 'Name a checkpoint.' }, 405);
  }
  if (!validCheckpointId(uid)) return json({ error: NO_CHECKPOINT.error }, 404);
  if (request.method === 'GET') {
    const row = await core.readCheckpoint(id, uid);
    if (!row) return json({ error: NO_CHECKPOINT.error }, 404);
    const { gz, ...rest } = row;
    return json({ ...rest, gz: toBase64(gz) });
  }
  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'The body must be JSON.' }, 400);
    let gz = null;
    if (body.gz !== undefined) {
      const read = readGz(body);
      if (read.refuse) return read.refuse;
      gz = read.gz;
    }
    return answer(await core.writeCheckpoint(id, uid, { label: body.label, savedAt: body.savedAt, changes: body.changes, schema: body.schema, gz }));
  }
  if (request.method === 'DELETE') return answer(await core.removeCheckpoint(id, uid));
  return json({ error: `${request.method} is not something server saves do.` }, 405);
}

/** `/saves`, `/saves/<id>` and a character's checkpoints, against one account's core. */
export async function accountFetch(core, request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts[0] !== 'saves' || parts.length > 4) return json({ error: 'No such account call.' }, 404);
  if (parts.length === 1) {
    return request.method === 'GET'
      ? json({ saves: await core.list(), used: await core.used(), limits: core.limits })
      : json({ error: 'Name a character.' }, 405);
  }
  let id = '';
  try { id = decodeURIComponent(parts[1]); } catch { /* not an id */ }
  if (!validSaveId(id)) return json({ error: NO_CHARACTER.error }, 404);
  if (parts.length > 2) {
    return parts[2] === 'checkpoints' ? checkpointFetch(core, request, id, parts[3]) : json({ error: 'No such account call.' }, 404);
  }

  if (request.method === 'GET') {
    const row = await core.read(id);
    if (!row) return json({ error: NO_CHARACTER.error }, 404);
    return json({ id, rev: row.rev, saved: row.saved, summary: row.summary, gz: toBase64(row.gz) });
  }
  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    const read = readGz(body);
    if (read.refuse) return read.refuse;
    const out = await core.write(id, { base: body.base, summary: body.summary, gz: read.gz, force: body.force === true });
    return out.conflict ? json(out.conflict, 409) : answer(out);
  }
  if (request.method === 'DELETE') {
    const gone = await core.remove(id);
    return gone ? json(gone) : json({ error: NO_CHARACTER.error }, 404);
  }
  return json({ error: `${request.method} is not something server saves do.` }, 405);
}

/** The Durable Object: one account's storage around SavesCore. */
export class Account {
  constructor(ctx) {
    this.core = new SavesCore({
      get: (key) => ctx.storage.get(key),
      put: (entries) => ctx.storage.put(entries),
      delete: (keys) => ctx.storage.delete(keys),
      list: (prefix) => ctx.storage.list({ prefix }),
    });
  }

  fetch(request) { return accountFetch(this.core, request); }
}

/**
 * The Worker's side: `/api/saves...`, for the account `session` names (see
 * auth.js `sessionFrom`; null when nobody is signed in).
 */
export async function savesRequest({ request, env, parts, session }) {
  if (!env?.ACCOUNTS) return json({ error: 'This copy of the app has no server saves.' }, 503);
  if (!session) return json({ error: 'Sign in to save characters to the server.' }, 401);
  if (!session.member) return json({ error: 'This Discord account is not a member of the server.' }, 403);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'That character is too large for the server.' }, 413);
  const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(session.id));
  const inner = new URL(request.url);
  inner.pathname = `/${parts.join('/')}`;
  return stub.fetch(new Request(inner.href, request));
}
