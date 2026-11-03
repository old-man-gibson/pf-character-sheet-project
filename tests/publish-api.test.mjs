/** Tests the publishing store's handlers against a Map standing in for KV.
 *
 *  The Pages Function takes nothing from the platform but `env.SHEETS`, so the
 *  whole publish-share-reopen round trip runs here in Node: publish, read it
 *  back, publish again to the same link, read a fixed revision, and every way
 *  a stranger or a bad body is turned away.
 *
 *  The Worker in worker.js fronts the same handlers on a Workers deployment,
 *  so the tail of the suite runs the round trip through it as well.
 *
 *  Run: node tests/publish-api.test.mjs */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkWith, finish, summary } from './check.mjs';

const api = await import(pathToFileURL(resolve('functions/api/c/[[path]].js')).href);

const check = checkWith((label, actual, expected) =>
  `FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);

/** The three KV calls the handlers make. */
function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

const env = { SHEETS: fakeKv() };
const call = (method, path, { body, token } = {}) => {
  const parts = path.split('/').filter(Boolean);
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request(`https://sheets.example/api/c/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const handler = api[`onRequest${method[0]}${method.slice(1).toLowerCase()}`];
  return handler({ request, env, params: { path: parts } });
};

const doc = { id: 'vesna', schemaVersion: 9, identity: { name: 'Vesna' }, abilities: { str: { score: 14 } } };

// Publish.
let res = await call('POST', '', { body: { doc, summary: '3 entries carried' } });
check('publish answers 201', res.status, 201);
const made = await res.json();
check('publish gives an id of the expected shape', /^[a-z2-9]{10}$/.test(made.id), true);
check('publish gives a first revision', made.rev, 1);
check('publish hands back a token', typeof made.token === 'string' && made.token.length > 30, true);
check('the token is not stored in the clear', env.SHEETS.store.get(`c:${made.id}`).includes(made.token), false);

// Read it back.
res = await call('GET', made.id);
check('latest answers 200', res.status, 200);
let got = await res.json();
check('latest carries the document', got.doc, doc);
check('latest carries the summary', got.summary, '3 entries carried');
check('latest lists its history', got.history.map((h) => h.rev), [1]);
check('latest is not cached for long', res.headers.get('cache-control'), 'no-cache');
check('latest allows any origin', res.headers.get('access-control-allow-origin'), '*');

// Publish again to the same link.
const doc2 = { ...doc, abilities: { str: { score: 16 } } };
res = await call('PUT', made.id, { body: { doc: doc2, summary: 'again' }, token: made.token });
check('republish answers 200', res.status, 200);
check('republish is revision 2', (await res.json()).rev, 2);
got = await (await call('GET', made.id)).json();
check('latest now shows the new document', got.doc.abilities.str.score, 16);
check('history has both revisions', got.history.map((h) => h.rev), [1, 2]);

// A fixed revision stays what it was.
res = await call('GET', `${made.id}/1`);
check('revision 1 answers 200', res.status, 200);
check('revision 1 is unchanged', (await res.json()).doc.abilities.str.score, 14);
check('a revision is immutable to caches', res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
check('revision 3 does not exist', (await call('GET', `${made.id}/3`)).status, 404);
check('revision 0 does not exist', (await call('GET', `${made.id}/0`)).status, 404);

// Turned away.
check('no token is refused', (await call('PUT', made.id, { body: { doc } })).status, 403);
check('a wrong token is refused', (await call('PUT', made.id, { body: { doc }, token: 'nope' })).status, 403);
check('an unknown id is 404', (await call('GET', 'zzzzzzzzzz')).status, 404);
check('a malformed id is 404', (await call('GET', 'not-an-id')).status, 404);
check('an unknown id cannot be republished', (await call('PUT', 'zzzzzzzzzz', { body: { doc }, token: 'x' })).status, 404);
check('a body without a doc is 400', (await call('POST', '', { body: { nope: 1 } })).status, 400);
check('a non-JSON body is 400', (await api.onRequestPost({
  request: new Request('https://sheets.example/api/c', { method: 'POST', body: 'not json' }), env, params: {},
})).status, 400);
check('POST to an id is 405', (await call('POST', made.id, { body: { doc } })).status, 405);
check('no store is 503', (await api.onRequestGet({ env: {}, params: { path: [made.id] } })).status, 503);
check('preflight is 204', (await api.onRequestOptions()).status, 204);
check('a wrong token left the store alone', got.rev, 2);
check('a doc that is not a character is 400', (await call('POST', '', { body: { doc: { anything: 'at all' } } })).status, 400);
check('nor one without a name', (await call('POST', '', { body: { doc: { schemaVersion: 9, identity: {} } } })).status, 400);

// Unpublish.
check('a delete without the token is refused', (await call('DELETE', made.id)).status, 403);
check('a delete with a wrong token is refused', (await call('DELETE', made.id, { token: 'nope' })).status, 403);
res = await call('DELETE', made.id, { token: made.token });
check('a delete with the token answers 200', [res.status, (await res.json()).deleted], [200, true]);
check('the link is gone', (await call('GET', made.id)).status, 404);
check('and so is every revision', [...env.SHEETS.store.keys()].filter((k) => k.startsWith(`c:${made.id}`)), []);
check('a second delete is 404', (await call('DELETE', made.id, { token: made.token })).status, 404);

// Writes are limited per address where the deployment binds a limiter.
{
  let calls = 0;
  const limit = { async limit({ key }) { calls++; return { success: calls <= 2 && key === 'publish:203.0.113.9' }; } };
  const lenv = { SHEETS: fakeKv(), PUBLISH_LIMIT: limit };
  const post = () => api.onRequestPost({
    request: new Request('https://sheets.example/api/c', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ doc }),
    }),
    env: lenv, params: {},
  });
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await post()).status);
  check('the third write in the window is 429', statuses, [201, 201, 429]);
  check('and nothing was stored for it', lenv.SHEETS.store.size, 4);
}

// The Worker that fronts the same handlers on a Workers deployment.
const worker = (await import(pathToFileURL(resolve('worker.js')).href)).default;
const wenv = { SHEETS: fakeKv(), ASSETS: { fetch: (req) => new Response(`asset ${new URL(req.url).pathname}`) } };
const wfetch = (method, path, body, headers = {}) => worker.fetch(new Request(`https://sheets.example${path}`, {
  method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
}), wenv);
res = await wfetch('POST', '/api/c', { doc, summary: 'via worker' });
check('worker: publish answers 201', res.status, 201);
const viaWorker = await res.json();
res = await wfetch('GET', `/api/c/${viaWorker.id}`);
check('worker: latest comes back', (await res.json()).summary, 'via worker');
res = await wfetch('PUT', `/api/c/${viaWorker.id}`, { doc: doc2 }, { authorization: `Bearer ${viaWorker.token}` });
check('worker: republish is revision 2', (await res.json()).rev, 2);
check('worker: revision 1 is served', (await wfetch('GET', `/api/c/${viaWorker.id}/1`)).status, 200);
check('worker: a verb the store lacks is 405', (await wfetch('PATCH', `/api/c/${viaWorker.id}`)).status, 405);
check('worker: unpublish goes through', (await wfetch('DELETE', `/api/c/${viaWorker.id}`, undefined, { authorization: `Bearer ${viaWorker.token}` })).status, 200);
check('worker: everything else is an asset', await (await wfetch('GET', '/app/published.html')).text(), 'asset /app/published.html');
check('worker: /api alone is an asset miss', await (await wfetch('GET', '/api')).text(), 'asset /api');

finish(summary());
