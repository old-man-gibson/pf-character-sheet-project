/**
 * The publishing store: a Cloudflare Pages Function over one KV namespace.
 *
 * A player presses Publish, the sheet sends the document here, and gets back a
 * link anyone can open. That is the whole service, and it is deliberately a
 * key-value read: no accounts, no sessions, no write path for readers. The
 * only secret is the publish token the author is handed once, which lets them
 * publish again to the same link; everything else is public to whoever has
 * the id, and the id is the only thing a share link carries.
 *
 *   POST /api/c              { doc, summary }      -> { id, rev, token, published }
 *   PUT  /api/c/<id>         same body, header Authorization: Bearer <token>
 *                                                   -> { id, rev, published }
 *   GET  /api/c/<id>         the latest revision   -> { id, rev, published, summary, history, doc }
 *   GET  /api/c/<id>/<rev>   that revision, immutable, cached for a year
 *   DELETE /api/c/<id>       header Authorization: Bearer <token>; removes every revision
 *                                                   -> { id, deleted: true }
 *
 * Writes (POST, PUT, DELETE) are limited per client address where the
 * deployment binds PUBLISH_LIMIT (wrangler.jsonc): KV's free plan allows 1,000
 * writes a day for the whole site, and a publish is two.
 *
 * Every revision stays addressable, so the list in `history` is the published
 * history and the latest view is a pointer that moves. Layout in KV:
 *
 *   c:<id>        { rev, published, tokenHash, history: [{ rev, published, summary }] }
 *   c:<id>:<rev>  { id, rev, published, summary, doc }
 *
 * Bind the namespace to the Pages project as SHEETS (Settings > Bindings > KV
 * namespace); locally, `wrangler pages dev . --kv SHEETS` fakes one. The
 * handlers take `context.env.SHEETS` and nothing else from the platform, so
 * tests/publish-api.test.mjs runs them against a Map.
 */

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i: links get read aloud
const ID_LENGTH = 10;
const MAX_BODY = 4 * 1024 * 1024;
const MAX_HISTORY = 50;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers },
});
const fail = (status, error) => json({ error }, status, { 'cache-control': 'no-store' });

/** The id from the path: `/api/c/<id>` or `/api/c/<id>/<rev>`. */
function route(params) {
  const path = params?.path;
  const parts = Array.isArray(path) ? path : path ? [path] : [];
  return { id: parts[0] || '', rev: parts[1] || '', extra: parts.length > 2 };
}

export const validId = (id) => id.length === ID_LENGTH && [...id].every((ch) => ID_ALPHABET.includes(ch));

function newId() {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The body of a publish, checked just enough to be stored. */
async function readPublish(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) return { error: fail(413, `A published character is at most ${MAX_BODY / 1024 / 1024} MB.`) };
  let body;
  try {
    body = await request.json();
  } catch {
    return { error: fail(400, 'The body must be JSON.') };
  }
  const doc = body?.doc;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: fail(400, 'The body needs a "doc" object.') };
  if (typeof doc.schemaVersion !== 'number' || typeof doc.identity?.name !== 'string') {
    return { error: fail(400, 'The "doc" is not a character document.') };
  }
  const text = JSON.stringify(doc);
  if (text.length > MAX_BODY) return { error: fail(413, `A published character is at most ${MAX_BODY / 1024 / 1024} MB.`) };
  const summary = typeof body.summary === 'string' ? body.summary.slice(0, 500) : '';
  return { doc, summary };
}

/** Store one revision and move the pointer. */
async function storeRevision(env, id, meta, doc, summary) {
  const rev = (meta.rev || 0) + 1;
  const published = new Date().toISOString();
  const history = [...(meta.history || []), { rev, published, summary }].slice(-MAX_HISTORY);
  await env.SHEETS.put(`c:${id}:${rev}`, JSON.stringify({ id, rev, published, summary, doc }));
  await env.SHEETS.put(`c:${id}`, JSON.stringify({ ...meta, rev, published, history }));
  return { rev, published };
}

/** A 429 when this address has written too often in the last minute, else null. */
async function limited(request, env) {
  if (!env?.PUBLISH_LIMIT) return null;
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await env.PUBLISH_LIMIT.limit({ key: `publish:${address}` });
  return success ? null : fail(429, 'Too many publishes from this address. Wait a minute and try again.');
}

/** Whether the request's bearer token is the one this character was published with. */
async function opens(request, meta) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return !!token && (await hash(token)) === meta.tokenHash;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env, params }) {
  const { id: given } = route(params);
  if (given) return fail(405, 'Publish a new character with POST /api/c; publish again with PUT /api/c/<id>.');
  if (!env?.SHEETS) return fail(503, 'This copy of the app has no publishing store.');
  const slow = await limited(request, env);
  if (slow) return slow;
  const read = await readPublish(request);
  if (read.error) return read.error;

  const token = newToken();
  const tokenHash = await hash(token);
  let id = newId();
  // A collision is a one in ten-quadrillion event; one retry is courtesy.
  if (await env.SHEETS.get(`c:${id}`)) id = newId();
  const { rev, published } = await storeRevision(env, id, { tokenHash, history: [] }, read.doc, read.summary);
  return json({ id, rev, published, token }, 201, { 'cache-control': 'no-store' });
}

export async function onRequestPut({ request, env, params }) {
  const { id, rev: extra } = route(params);
  if (!validId(id) || extra) return fail(404, 'No such published character.');
  if (!env?.SHEETS) return fail(503, 'This copy of the app has no publishing store.');
  const slow = await limited(request, env);
  if (slow) return slow;
  const meta = await env.SHEETS.get(`c:${id}`, { type: 'json' });
  if (!meta) return fail(404, 'No such published character.');
  if (!(await opens(request, meta))) return fail(403, 'That publish token does not open this link.');

  const read = await readPublish(request);
  if (read.error) return read.error;
  const { rev, published } = await storeRevision(env, id, meta, read.doc, read.summary);
  return json({ id, rev, published }, 200, { 'cache-control': 'no-store' });
}

/**
 * Unpublish: every revision, then the pointer, so a delete that stops
 * partway can be sent again with the same token. A copy a browser cached
 * (a revision is served as immutable) is out of reach.
 */
export async function onRequestDelete({ request, env, params }) {
  const { id, rev: extra } = route(params);
  if (!validId(id) || extra) return fail(404, 'No such published character.');
  if (!env?.SHEETS) return fail(503, 'This copy of the app has no publishing store.');
  const slow = await limited(request, env);
  if (slow) return slow;
  const meta = await env.SHEETS.get(`c:${id}`, { type: 'json' });
  if (!meta) return fail(404, 'No such published character.');
  if (!(await opens(request, meta))) return fail(403, 'That publish token does not open this link.');
  for (let rev = 1; rev <= (meta.rev || 0); rev++) await env.SHEETS.delete(`c:${id}:${rev}`);
  await env.SHEETS.delete(`c:${id}`);
  return json({ id, deleted: true }, 200, { 'cache-control': 'no-store' });
}

export async function onRequestGet({ env, params }) {
  const { id, rev, extra } = route(params);
  if (!validId(id) || extra) return fail(404, 'No such published character.');
  if (!env?.SHEETS) return fail(503, 'This copy of the app has no publishing store.');
  const meta = await env.SHEETS.get(`c:${id}`, { type: 'json' });
  if (!meta) return fail(404, 'No such published character.');

  if (rev) {
    if (!/^[1-9]\d*$/.test(rev) || Number(rev) > meta.rev) return fail(404, 'No such revision.');
    const snapshot = await env.SHEETS.get(`c:${id}:${rev}`);
    if (!snapshot) return fail(404, 'No such revision.');
    return new Response(snapshot, {
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }
  const latest = await env.SHEETS.get(`c:${id}:${meta.rev}`, { type: 'json' });
  if (!latest) return fail(404, 'No such published character.');
  return json({ ...latest, history: meta.history || [] }, 200, { 'cache-control': 'no-cache' });
}
