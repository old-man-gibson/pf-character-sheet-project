/** Tests the relay that hands a squad member to the GM, in Node.
 *
 *  RelayCore is the Durable Object's behaviour apart from the platform: it
 *  takes a storage with get/put/delete and sockets with send/close and an
 *  attachment, so fakes stand in for both. The Worker's routing of
 *  /api/c/<id>/grant, /ticket and /relay is run through worker.js with a
 *  fake store and a fake Durable Object binding.
 *
 *  Run: node tests/relay.test.mjs */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { RelayCore, relayRequest, validMember } = await import(pathToFileURL(resolve('functions/api/c/relay.js')).href);

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
};

function fakeStorage() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : undefined; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
class FakeWs {
  constructor(name) { this.name = name; this.sent = []; this.closed = null; this.att = null; }
  send(text) { if (this.closed) throw new Error('closed'); this.sent.push(JSON.parse(text)); }
  close(code, reason) { this.closed = { code, reason }; }
  serializeAttachment(o) { this.att = o; }
  deserializeAttachment() { return this.att; }
  last() { return this.sent[this.sent.length - 1]; }
  types() { return this.sent.map((s) => s.type); }
}
function fakeSockets() {
  const list = [];
  return {
    list,
    accept(ws, tags) { list.push({ ws, tags }); },
    all(tag) { return list.filter((x) => x.tags.includes(tag) && !x.ws.closed).map((x) => x.ws); },
  };
}

console.log('the relay: grants, tickets, sockets and messages');
{
  let now = 1_000_000;
  const storage = fakeStorage();
  const sockets = fakeSockets();
  const relay = new RelayCore(storage, sockets, () => now);

  check('a member id is short and plain', [validMember('conjured2'), validMember('a b'), validMember(''), validMember('x'.repeat(65))], [true, false, false, false]);
  check('a grant wants a member id', (await relay.grant('', 'Lira')).error, 'That is not a member id.');
  const made = await relay.grant('conjured2', 'Lira');
  check('a grant hands back a token', typeof made.token === 'string' && made.token.length > 20, true);
  check('the token is kept as a hash', JSON.stringify([...storage.m.values()]).includes(made.token), false);
  check('the grant is listed with no one watching', await relay.list(), [{ member: 'conjured2', name: 'Lira', since: new Date(now).toISOString(), viewers: 0 }]);

  // The GM's page: the wrong link is refused, the right one accepted.
  const gm = new FakeWs('gm');
  check('a wrong grant is refused', (await relay.connect(gm, { grant: 'nope', member: 'conjured2' })).error, 'That control link does not open this character.');
  check('a grant for another member is refused', (await relay.connect(gm, { grant: made.token, member: 'conjured9' })).error, 'That control link does not open this character.');
  check('a socket with nothing is refused', (await relay.connect(gm, {})).error, 'A socket needs a ticket or a control link.');
  check('the right grant is accepted as control', await relay.connect(gm, { grant: made.token, member: 'conjured2' }), { role: 'control', member: 'conjured2' });
  await relay.message(gm, JSON.stringify({ type: 'hello' }));
  check('hello with no sheet open: the page is told, and waits', gm.sent, [{ type: 'owner', online: false }, { type: 'waiting' }]);

  // The player's sheet: a ticket, spent on use.
  const sheet = new FakeWs('sheet');
  check('a bad ticket is refused', (await relay.connect(sheet, { owner: 'nope' })).error, 'That ticket has expired.');
  const { ticket } = await relay.ticket();
  now += 61_000;
  check('an old ticket is refused', (await relay.connect(sheet, { owner: ticket })).error, 'That ticket has expired.');
  const fresh = (await relay.ticket()).ticket;
  check('a fresh ticket opens the owner socket', await relay.connect(sheet, { owner: fresh }), { role: 'owner' });
  check('and is spent', (await relay.connect(new FakeWs('again'), { owner: fresh })).error, 'That ticket has expired.');
  check('the sheet is told who is handed over and who watches', sheet.last(), { type: 'grants', members: [{ member: 'conjured2', name: 'Lira', since: new Date(1_000_000).toISOString(), viewers: 1 }] });
  check('and the GM\'s page is told the sheet is here', gm.last(), { type: 'owner', online: true });

  // A render from the sheet reaches the page, and a late page gets the last one.
  await relay.message(sheet, JSON.stringify({ type: 'render', member: 'conjured2', html: '<p>hand</p>', features: '<p>face</p>' }));
  check('a render reaches the GM\'s page', gm.last(), { type: 'render', member: 'conjured2', html: '<p>hand</p>', features: '<p>face</p>' });
  await relay.message(sheet, JSON.stringify({ type: 'render', member: 'other', html: 'x' }));
  check('a render for another member does not', gm.last().member, 'conjured2');
  const late = new FakeWs('late');
  await relay.connect(late, { grant: made.token, member: 'conjured2' });
  await relay.message(late, JSON.stringify({ type: 'hello' }));
  check('a page that arrives late is drawn at once', late.types(), ['owner', 'render']);
  check('and the sheet sees two watching', sheet.last().members[0].viewers, 2);

  // A press from the GM reaches the sheet, named for the member.
  await relay.message(gm, JSON.stringify({ type: 'action', action: 'play', id: '1#0', arg: 'cast?mode=big' }));
  check('a press reaches the sheet with the member on it', sheet.last(), { type: 'action', member: 'conjured2', action: 'play', id: '1#0', arg: 'cast?mode=big' });
  await relay.message(gm, 'not json');
  await relay.message(gm, JSON.stringify({ type: 'render', member: 'conjured2', html: 'forged' }));
  check('a page cannot render, and junk is ignored', [sheet.last().type, late.last().type], ['action', 'render']);
  check('and a forged render did not land in the store', storage.m.get('last:conjured2').includes('forged'), false);

  // A second grant replaces the first and cuts off whoever held it.
  const again = await relay.grant('conjured2', 'Lira');
  check('a new grant cuts the old pages off', [gm.closed?.code, late.closed?.code], [4001, 4001]);
  const gm2 = new FakeWs('gm2');
  check('the old token no longer opens', (await relay.connect(gm2, { grant: made.token, member: 'conjured2' })).error !== undefined, true);
  check('the new one does', (await relay.connect(gm2, { grant: again.token, member: 'conjured2' })).role, 'control');

  // The sheet going and coming back.
  await relay.close(sheet);
  check('the sheet closing is told to the page', gm2.last(), { type: 'owner', online: false });

  // Taking the member back.
  check('revoking an unknown member says so', (await relay.revoke('nobody')).error, 'No such grant.');
  await relay.revoke('conjured2');
  check('the page is told and closed', [gm2.sent.some((s) => s.type === 'revoked'), gm2.closed?.code], [true, 4000]);
  check('the grant and the last render are gone', [await relay.list(), storage.m.has('last:conjured2')], [[], false]);
}

console.log('\nthe Worker routes the relay calls');
{
  const api = await import(pathToFileURL(resolve('functions/api/c/[[path]].js')).href);
  const worker = (await import(pathToFileURL(resolve('worker.js')).href)).default;
  const store = new Map();
  const SHEETS = {
    async get(key, opts) { const v = store.get(key); if (v === undefined) return null; return opts?.type === 'json' ? JSON.parse(v) : v; },
    async put(key, value) { store.set(key, value); },
  };
  // The Durable Object binding: one stub per id, answering with what it was asked.
  const calls = [];
  const RELAY = {
    idFromName: (name) => `id:${name}`,
    get: (id) => ({ fetch: async (req) => { calls.push({ id, method: req.method, path: new URL(req.url).pathname, auth: req.headers.get('authorization') }); return new Response(JSON.stringify({ ok: true }), { status: 201 }); } }),
  };
  const env = { SHEETS, RELAY, ASSETS: { fetch: () => new Response('asset') } };
  const call = (method, path, headers = {}, body) => worker.fetch(new Request(`https://sheets.example${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

  const made = await (await call('POST', '/api/c', {}, { doc: { id: 'nico' } })).json();
  check('a relay call without a token is refused', (await call('POST', `/api/c/${made.id}/ticket`)).status, 403);
  check('a wrong token is refused', (await call('POST', `/api/c/${made.id}/ticket`, { authorization: 'Bearer nope' })).status, 403);
  check('an unknown character is 404', (await call('POST', '/api/c/zzzzzzzzzz/ticket', { authorization: 'Bearer x' })).status, 404);
  check('a malformed id is 404', (await call('POST', '/api/c/not-an-id/ticket', { authorization: 'Bearer x' })).status, 404);
  const res = await call('POST', `/api/c/${made.id}/grant`, { authorization: `Bearer ${made.token}` }, { member: 'conjured2', name: 'Lira' });
  check('the publish token opens the relay, and the call reaches the character\'s object', [res.status, calls.at(-1)?.id, calls.at(-1)?.path], [201, `id:${made.id}`, '/grant']);
  await call('DELETE', `/api/c/${made.id}/grant/conjured2`, { authorization: `Bearer ${made.token}` });
  check('so does a revoke', [calls.at(-1)?.method, calls.at(-1)?.path], ['DELETE', '/grant/conjured2']);
  await call('GET', `/api/c/${made.id}/relay?grant=abc&member=conjured2`);
  check('the GM\'s socket carries its own grant and needs no token', calls.at(-1)?.path, '/relay');
  await call('GET', `/api/c/${made.id}/relay?owner=t`);
  check('the owner\'s socket proves itself with its ticket at the object, not a header', calls.at(-1)?.path, '/relay');
  check('but a grant or a ticket is still wanted for the other calls', (await call('GET', `/api/c/${made.id}/grants`)).status, 403);
  check('a call the relay does not know is 404', (await call('GET', `/api/c/${made.id}/other`)).status, 404);
  check('preflight is 204', (await call('OPTIONS', `/api/c/${made.id}/grant`)).status, 204);
  check('without the binding the relay says so', (await relayRequest({ request: new Request('https://x/api/c/a/ticket', { method: 'POST' }), env: {}, id: 'a', parts: ['ticket'], verify: async () => true })).status, 503);
  check('the store\'s own routes still answer', (await call('GET', `/api/c/${made.id}`)).status, 200);
  check('a revision path is not a relay call', (await call('GET', `/api/c/${made.id}/1`)).status, 200);
  void api;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
