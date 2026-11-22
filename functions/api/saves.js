/**
 * Server saves: a signed-in account's characters, kept so any of its devices
 * can open them.
 *
 *   GET    /api/saves        -> { saves: [{ id, rev, saved, size, summary }] }
 *   GET    /api/saves/<id>   -> { id, rev, saved, summary, gz }
 *   PUT    /api/saves/<id>   { base, summary, gz, force? } -> { id, rev, saved }
 *                            409 { id, rev, saved, summary } when the server's
 *                            copy is not the one `base` names
 *   DELETE /api/saves/<id>   -> { id }
 *
 * `gz` is the character document, gzipped and base64-encoded by the browser
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
 * One Durable Object per account holds its saves: `meta:<id>` (revision,
 * time, summary), `doc:<id>` (the bytes) and `gone:<id>` (the last revision
 * of a deleted one). `SavesCore` is the behaviour, written against a storage
 * with get/put/delete/list so tests/account-api.test.mjs runs it in Node;
 * `Account` is the Durable Object around it, and `savesRequest` is what the
 * Worker calls once it knows who is signed in.
 */

import { fromBase64, toBase64 } from '../../app/js/base64.js';

const MAX_GZ = 1024 * 1024;
const MAX_BODY = 1536 * 1024;
const MAX_SAVES = 200;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** A character id as a save is keyed: one line, no path separators. */
export const validSaveId = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 120 && !/[\x00-\x1f\x7f/\\]/.test(id);

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The summary as stored: the known fields, each bounded. */
export function cleanSummary(s) {
  const src = s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  return {
    name: text(src.name, 120),
    level: Number.isFinite(Number(src.level)) ? Number(src.level) : 0,
    classes: Array.isArray(src.classes) ? src.classes.slice(0, 12).map((c) => text(c, 60)).filter(Boolean) : [],
    race: text(src.race, 60),
    color: text(src.color, 20),
    origin: text(src.origin, 20),
    schema: Number.isFinite(Number(src.schema)) ? Number(src.schema) : 0,
    published: text(src.published, 20),
  };
}

/**
 * One account's saves, apart from the platform. `storage` has async
 * `get(key)`, `put(entries)`, `delete(keys)` and `list(prefix)` (a Map).
 */
export class SavesCore {
  constructor(storage, now = () => Date.now()) {
    this.storage = storage;
    this.now = now;
  }

  /** Every save without its document, newest first. */
  async list() {
    const rows = await this.storage.list('meta:');
    return [...rows].map(([key, meta]) => ({ id: key.slice(5), ...meta }))
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
    let last = meta?.rev || 0;
    if (!meta) {
      if ((await this.storage.list('meta:')).size >= MAX_SAVES) return { error: `An account keeps at most ${MAX_SAVES} characters on the server.`, status: 413 };
      last = (await this.storage.get(`gone:${id}`)) || 0;
    }
    const next = { rev: last + 1, saved: new Date(this.now()).toISOString(), size: gz.length, summary: cleanSummary(summary) };
    await this.storage.put({ [`meta:${id}`]: next, [`doc:${id}`]: gz });
    return { id, rev: next.rev, saved: next.saved };
  }

  async remove(id) {
    const meta = await this.storage.get(`meta:${id}`);
    if (!meta) return null;
    await this.storage.put({ [`gone:${id}`]: meta.rev });
    await this.storage.delete([`meta:${id}`, `doc:${id}`]);
    return { id };
  }
}

/** `/saves` and `/saves/<id>` against one account's core. */
export async function accountFetch(core, request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts[0] !== 'saves' || parts.length > 2) return json({ error: 'No such account call.' }, 404);
  if (parts.length === 1) {
    return request.method === 'GET' ? json({ saves: await core.list() }) : json({ error: 'Name a character.' }, 405);
  }
  let id = '';
  try { id = decodeURIComponent(parts[1]); } catch { /* not an id */ }
  if (!validSaveId(id)) return json({ error: 'No such character on the server.' }, 404);

  if (request.method === 'GET') {
    const row = await core.read(id);
    if (!row) return json({ error: 'No such character on the server.' }, 404);
    return json({ id, rev: row.rev, saved: row.saved, summary: row.summary, gz: toBase64(row.gz) });
  }
  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.gz !== 'string') return json({ error: 'The body needs "gz", the gzipped document in base64.' }, 400);
    let gz;
    try { gz = fromBase64(body.gz); } catch { return json({ error: '"gz" is not base64.' }, 400); }
    // The two bytes every gzip stream starts with.
    if (gz.length < 18 || gz[0] !== 0x1f || gz[1] !== 0x8b) return json({ error: '"gz" is not a gzipped document.' }, 400);
    if (gz.length > MAX_GZ) return json({ error: `A character on the server is at most ${MAX_GZ / 1024 / 1024} MB compressed.` }, 413);
    const out = await core.write(id, { base: body.base, summary: body.summary, gz, force: body.force === true });
    if (out.conflict) return json(out.conflict, 409);
    if (out.error) return json({ error: out.error }, out.status || 400);
    return json(out);
  }
  if (request.method === 'DELETE') {
    const gone = await core.remove(id);
    return gone ? json(gone) : json({ error: 'No such character on the server.' }, 404);
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
