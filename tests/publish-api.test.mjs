/** Tests the publishing store's handlers against a Map standing in for KV.
 *
 *  The Pages Function takes nothing from the platform but `env.SHEETS`, so the
 *  whole publish-share-reopen round trip runs here in Node: publish, read it
 *  back, publish again to the same link, read a fixed revision, and every way
 *  a stranger or a bad body is turned away.
 *
 *  Run: node tests/publish-api.test.mjs */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const api = await import(pathToFileURL(resolve('functions/api/c/[[path]].js')).href);

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
};

/** The two KV calls the handlers make. */
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

const doc = { id: 'vesna', identity: { name: 'Vesna' }, abilities: { str: { score: 14 } } };

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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
