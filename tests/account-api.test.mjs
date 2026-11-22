/** Tests sign-in with Discord, the session cookie, server saves and their checkpoints, in Node.
 *
 *  The sign-in handlers take their `fetcher` and clock as arguments, so a
 *  stand-in answers for Discord. SavesCore is the account Durable Object's
 *  behaviour apart from the platform: it takes a storage with
 *  get/put/delete/list, so a Map stands in. The tail runs the routes through
 *  worker.js with a fake store and a fake Durable Object binding, including a
 *  published link that follows its author's account.
 *
 *  Run: node tests/account-api.test.mjs */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const load = (file) => import(pathToFileURL(resolve(file)).href);
const auth = await load('functions/api/auth.js');
const saves = await load('functions/api/saves.js');
const worker = (await load('worker.js')).default;
const { fromBase64, toBase64 } = await load('app/js/base64.js');

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
};

const SITE = 'https://sheets.example';
const env = { DISCORD_CLIENT_ID: 'app-1', DISCORD_CLIENT_SECRET: 'shh', SESSION_SECRET: 'a long random text', DISCORD_GUILD_ID: '900' };
const NOW = Date.UTC(2026, 10, 21);

/** Discord, as far as the sign-in asks it: one account, in the server or not. */
function fakeDiscord({ member = true, nick = 'Vesna', memberStatus = 404 } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(init.body);
      if (form.get('code') !== 'good-code' || form.get('client_secret') !== 'shh') return new Response('{}', { status: 400 });
      return Response.json({ access_token: 'tok', token_type: 'Bearer' });
    }
    if (init.headers?.authorization !== 'Bearer tok') return new Response('{}', { status: 401 });
    if (url.endsWith('/users/@me')) return Response.json({ id: '123456789', username: 'vesna_p', global_name: 'Vesna P' });
    if (url.endsWith('/users/@me/guilds/900/member')) return member ? Response.json({ nick, roles: [] }) : new Response('{}', { status: memberStatus });
    return new Response('{}', { status: 404 });
  };
  return { calls, fetcher };
}

const cookiesOf = (res) => Object.fromEntries(res.headers.getSetCookie().map((c) => {
  const [pair] = c.split(';');
  const at = pair.indexOf('=');
  return [pair.slice(0, at), pair.slice(at + 1)];
}));
const authCall = (path, { method = 'GET', cookie = '', origin = '', fetcher, now = NOW, withEnv = env } = {}) => auth.authRequest({
  request: new Request(`${SITE}/api/auth/${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } }),
  env: withEnv, parts: path.split('?')[0].split('/'), fetcher, now,
});

/** The whole sign-in: start, come back from Discord, and the cookie it left. */
async function signIn(discord, { code = 'good-code', returnTo = '/app/', withEnv = env } = {}) {
  const started = await authCall(`discord?return=${encodeURIComponent(returnTo)}`, { withEnv });
  const to = new URL(started.headers.get('location'));
  const state = cookiesOf(started).cs_oauth;
  const done = await authCall(`discord/callback?code=${code}&state=${to.searchParams.get('state')}`, {
    cookie: `cs_oauth=${state}`, fetcher: discord.fetcher, withEnv,
  });
  return { started, to, done, session: cookiesOf(done).cs_session || '' };
}

// Not configured.
let res = await authCall('me', { withEnv: {} });
check('without secrets, sign-in is not available', await res.json(), { available: false });
check('without secrets, the sign-in page is 503', (await authCall('discord', { withEnv: {} })).status, 503);

// Start.
let discord = fakeDiscord();
let flow = await signIn(discord, { returnTo: '/app/index.html' });
check('start redirects to Discord', [flow.started.status, flow.to.origin + flow.to.pathname], [302, 'https://discord.com/oauth2/authorize']);
check('start asks for the account and its membership', flow.to.searchParams.get('scope'), 'identify guilds.members.read');
check('start names this site as the way back', flow.to.searchParams.get('redirect_uri'), `${SITE}/api/auth/discord/callback`);
check('the state cookie is kept from scripts', /HttpOnly; SameSite=Lax/.test(flow.started.headers.getSetCookie()[0]), true);

// Callback, for a member.
check('callback goes back to the page it came from', flow.done.headers.get('location'), `${SITE}/app/index.html?signin=ok`);
check('callback sets a session', flow.session.length > 40, true);
check('the session cookie is kept from scripts and is for https', /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/.test(flow.done.headers.getSetCookie().find((c) => c.startsWith('cs_session='))), true);
check('the access token is not in the cookie', flow.session.includes('tok'), false);
res = await authCall('me', { cookie: `cs_session=${flow.session}` });
check('me names the account, by its name in the server', await res.json(), { available: true, signedIn: true, id: 'discord:123456789', name: 'Vesna', member: true, saves: false });
check('me without a cookie is signed out', await (await authCall('me')).json(), { available: true, signedIn: false, saves: false });

// Not a member, no server set, and the ways it fails.
flow = await signIn(fakeDiscord({ member: false }));
check('an account outside the server signs in as not a member', flow.done.headers.get('location'), `${SITE}/app/?signin=not-member`);
check('…and me says so', (await (await authCall('me', { cookie: `cs_session=${flow.session}` })).json()).member, false);
flow = await signIn(fakeDiscord({ member: false, memberStatus: 500 }));
check('Discord failing the membership check fails the sign-in', [flow.done.headers.get('location'), flow.session], [`${SITE}/app/?signin=failed`, '']);
discord = fakeDiscord();
flow = await signIn(discord, { withEnv: { ...env, DISCORD_GUILD_ID: '' } });
check('with no server set, only the account is asked for', flow.to.searchParams.get('scope'), 'identify');
check('…and anyone is a member, named by their Discord name', await (await authCall('me', { cookie: `cs_session=${flow.session}` })).json(),
  { available: true, signedIn: true, id: 'discord:123456789', name: 'Vesna P', member: true, saves: false });
check('…and membership is not asked', discord.calls.some((c) => c.url.includes('/guilds/')), false);
flow = await signIn(fakeDiscord(), { code: 'bad-code' });
check('a refused code fails', flow.done.headers.get('location'), `${SITE}/app/?signin=failed`);
res = await authCall('discord/callback?code=good-code&state=other', { cookie: `cs_oauth=${cookiesOf((await authCall('discord')))['cs_oauth']}`, fetcher: fakeDiscord().fetcher });
check('a state that is not this browser\'s fails', res.headers.get('location'), `${SITE}/app/?signin=failed`);
res = await authCall('discord/callback?error=access_denied&state=x', { fetcher: fakeDiscord().fetcher });
check('a refusal at Discord is reported as canceled', res.headers.get('location'), `${SITE}/app/?signin=canceled`);
check('a return to another site is ignored', auth.safeReturn('//evil.example/'), '/app/');
check('a return with a scheme is ignored', auth.safeReturn('https://evil.example/'), '/app/');
check('a return on this site is kept', auth.safeReturn('/app/index.html'), '/app/index.html');

// The session itself.
flow = await signIn(fakeDiscord());
const cookie = `cs_session=${flow.session}`;
const [payload, sig] = flow.session.split('.');
const forged = Buffer.from(JSON.stringify({ id: 'discord:1', name: 'x', member: true, exp: NOW * 2 })).toString('base64url');
check('an altered session is refused', await auth.openSession(env, `${forged}.${sig}`, NOW), null);
check('a session under another secret is refused', await auth.openSession({ ...env, SESSION_SECRET: 'other' }, flow.session, NOW), null);
check('a session ends after 30 days', await auth.openSession(env, flow.session, NOW + 31 * 24 * 3600 * 1000), null);
check('a session is good for 29 days', (await auth.openSession(env, `${payload}.${sig}`, NOW + 29 * 24 * 3600 * 1000))?.id, 'discord:123456789');
const from = (method, origin) => auth.sessionFrom(new Request(`${SITE}/api/saves/x`, { method, headers: { cookie, ...(origin ? { origin } : {}) } }), env, { write: method !== 'GET', now: NOW });
check('a read needs no origin', (await from('GET'))?.id, 'discord:123456789');
check('a write from this site counts', (await from('PUT', SITE))?.id, 'discord:123456789');
check('a write from another site does not', await from('PUT', 'https://evil.example'), null);
check('a write with no origin does not', await from('PUT'), null);
res = await authCall('signout', { method: 'POST', cookie, origin: SITE });
check('sign out clears the cookie', /^cs_session=; .*Max-Age=0/.test(res.headers.getSetCookie()[0]), true);
check('sign out from another site is refused', (await authCall('signout', { method: 'POST', cookie, origin: 'https://evil.example' })).status, 403);

// SavesCore.
function fakeStorage() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.get(k); },
    async put(entries) { for (const [k, v] of Object.entries(entries)) m.set(k, v); },
    async delete(keys) { for (const k of keys) m.delete(k); },
    async list(prefix) { return new Map([...m].filter(([k]) => k.startsWith(prefix))); },
  };
}
let clock = NOW;
const core = new saves.SavesCore(fakeStorage(), () => clock);
const gz = (doc) => new Uint8Array(gzipSync(JSON.stringify(doc)));
const vesna = { id: 'vesna', identity: { name: 'Vesna', level: 5 } };
let out = await core.write('vesna', { base: 0, summary: { name: 'Vesna', level: 5, classes: ['Mageknight'], extra: 'dropped' }, gz: gz(vesna) });
check('a first save is revision 1', [out.id, out.rev], ['vesna', 1]);
check('the summary keeps the known fields only', (await core.list())[0].summary, { name: 'Vesna', level: 5, classes: ['Mageknight'], race: '', color: '', origin: '', schema: 0, published: '' });
clock += 1000;
out = await core.write('vesna', { base: 1, summary: { name: 'Vesna', level: 6 }, gz: gz({ ...vesna, identity: { name: 'Vesna', level: 6 } }) });
check('a save from the same revision is the next one', out.rev, 2);
out = await core.write('vesna', { base: 1, summary: { name: 'Vesna', level: 7 }, gz: gz(vesna) });
check('a save from an older revision is a conflict', [out.conflict?.rev, out.conflict?.summary.level], [2, 6]);
check('…and changed nothing', (await core.read('vesna')).rev, 2);
out = await core.write('vesna', { base: 1, force: true, summary: { name: 'Vesna', level: 7 }, gz: gz(vesna) });
check('force writes over the server copy', out.rev, 3);
clock += 1000;
await core.write('omnia', { base: 0, summary: { name: 'Omnia' }, gz: gz({ id: 'omnia' }) });
check('the list is newest first', (await core.list()).map((s) => s.id), ['omnia', 'vesna']);
check('the list leaves the documents out', Object.keys((await core.list())[0]).sort(), ['cps', 'id', 'rev', 'saved', 'size', 'summary']);
check('remove answers with the id', await core.remove('vesna'), { id: 'vesna' });
check('a removed save is gone', [await core.read('vesna'), (await core.list()).map((s) => s.id)], [null, ['omnia']]);
check('removing it twice is null', await core.remove('vesna'), null);
out = await core.write('vesna', { base: 3, summary: { name: 'Vesna' }, gz: gz(vesna) });
check('saved again, it does not repeat a revision', out.rev, 4);
// What one account may keep.
const small = new saves.SavesCore(fakeStorage(), () => NOW, { saves: 3, checkpoints: 2, total: 1000 });
const bytes = (n) => { const b = new Uint8Array(n); b[0] = 0x1f; b[1] = 0x8b; return b; };
check('a save within the limits is stored', (await small.write('a', { gz: bytes(400) })).rev, 1);
check('a second one within the total is stored', (await small.write('b', { gz: bytes(400) })).rev, 1);
out = await small.write('c', { gz: bytes(400) });
check('a save that takes the account past its total is refused', [out.status, out.error], [413, 'An account keeps at most 0 MB on the server.']);
check('…and is not stored', await small.read('c'), null);
check('a character may grow into the room the others leave', (await small.write('a', { base: 1, gz: bytes(600) })).rev, 2);
out = await small.write('a', { base: 2, gz: bytes(601) });
check('…and no further', [out.status, (await small.read('a')).rev], [413, 2]);
check('a small third character fits', (await small.write('c', { gz: bytes(0) })).rev, 1);
out = await small.write('d', { gz: bytes(0) });
check('a fourth character is past the count', [out.status, out.error], [413, 'An account keeps at most 3 characters on the server.']);
await small.remove('b');
check('removing one makes room for another', (await small.write('d', { gz: bytes(300) })).rev, 1);
check('the limits a deployment runs with', saves.LIMITS, { saves: 200, checkpoints: 100, total: 25 * 1024 * 1024 });

// Checkpoints of a character.
const cpStore = fakeStorage();
const cp = new saves.SavesCore(cpStore, () => NOW, { saves: 3, checkpoints: 2, total: 1000 });
check('a first save says the server had no copy', (await cp.write('a', { gz: bytes(100) })).created, true);
check('a later save does not', 'created' in (await cp.write('a', { base: 1, gz: bytes(100) })), false);
check('a character starts with no checkpoints', await cp.checkpoints('a'), { cps: 0, checkpoints: [] });
out = await cp.writeCheckpoint('a', 'uid-level-2', { label: 'level 2', savedAt: '2026-11-02T10:00:00.000Z', changes: 4, schema: 9, gz: bytes(200) });
check('a checkpoint is stored and counted as a change', out, { uid: 'uid-level-2', cps: 1 });
await cp.writeCheckpoint('a', 'uid-level-1', { label: 'level 1', savedAt: '2026-11-01T10:00:00.000Z', gz: bytes(150) });
check('checkpoints are listed oldest first, without their documents', await cp.checkpoints('a'), {
  cps: 2,
  checkpoints: [
    { uid: 'uid-level-1', label: 'level 1', savedAt: '2026-11-01T10:00:00.000Z', changes: 0, schema: 0, size: 150 },
    { uid: 'uid-level-2', label: 'level 2', savedAt: '2026-11-02T10:00:00.000Z', changes: 4, schema: 9, size: 200 },
  ],
});
check('the character\'s row carries the count', (await cp.list())[0].cps, 2);
check('a save keeps the count', [(await cp.write('a', { base: 2, gz: bytes(100) })).rev, (await cp.list())[0].cps], [3, 2]);
check('a checkpoint is read back with its bytes', (await cp.readCheckpoint('a', 'uid-level-2')).gz.length, 200);
check('checkpoints count toward the account\'s total', await cp.used(), 450);
out = await cp.writeCheckpoint('a', 'uid-level-3', { label: 'level 3', gz: bytes(100) });
check('a third checkpoint is past the count', [out.status, out.error], [413, 'A character keeps at most 2 checkpoints on the server.']);
check('a checkpoint already stored can be sent again', (await cp.writeCheckpoint('a', 'uid-level-2', { label: 'level 2', gz: bytes(300) })).cps, 3);
out = await cp.writeCheckpoint('a', 'uid-level-2', { label: 'level 2', gz: bytes(800) });
check('a checkpoint that takes the account past its total is refused', [out.status, (await cp.readCheckpoint('a', 'uid-level-2')).gz.length], [413, 300]);
check('a name alone renames one', [await cp.writeCheckpoint('a', 'uid-level-1', { label: 'first level' }), (await cp.checkpoints('a')).checkpoints[0].label, await cp.used()],
  [{ uid: 'uid-level-1', cps: 4 }, 'first level', 550]);
check('a name alone for one not stored is 404', (await cp.writeCheckpoint('a', 'uid-nothing', { label: 'x' })).status, 404);
check('a checkpoint of a character not on the server is 404', (await cp.writeCheckpoint('zz', 'uid-level-1', { gz: bytes(10) })).status, 404);
check('a time that is not one becomes now', (await (async () => { await cp.removeCheckpoint('a', 'uid-level-1'); await cp.writeCheckpoint('a', 'uid-bad-time', { savedAt: 'yesterday', gz: bytes(20) }); return cp.readCheckpoint('a', 'uid-bad-time'); })()).savedAt, new Date(NOW).toISOString());
check('removing a checkpoint frees its room', [await cp.removeCheckpoint('a', 'uid-bad-time'), await cp.used()], [{ uid: 'uid-bad-time', cps: 7 }, 400]);
check('removing it twice is 404', (await cp.removeCheckpoint('a', 'uid-bad-time')).status, 404);
cpStore.m.delete('used');
check('with no kept count, the total is counted from what is stored', await cp.used(), 400);
check('removing the character removes its checkpoints', [await cp.remove('a'), [...cpStore.m.keys()].sort(), await cp.used()], [{ id: 'a' }, ['gone:a', 'used'], 0]);
check('saved again, it has no checkpoints and says it is new', [(await cp.write('a', { base: 3, gz: bytes(50) })).created, await cp.checkpoints('a')], [true, { cps: 0, checkpoints: [] }]);
check('checkpoint ids are short and plain', ['uid-level-1', 'AbC_123-xyz0', 'short', 'has/slash1', 'has space1', 'x'.repeat(41)].map(saves.validCheckpointId), [true, true, false, false, false, false]);

check('ids are one line with no path separators', ['vesna', 'órla-2', 'a/b', 'a\\b', '', 'x\ny'].map(saves.validSaveId), [true, true, false, false, false, false]);
const big = new Uint8Array(300000).map((_, i) => i % 251);
check('base64 round-trips bytes past the argument limit', Buffer.from(fromBase64(toBase64(big))).equals(Buffer.from(big)), true);

// The routes, through the Worker.
const accounts = new Map();
const kv = new Map();
const wenv = {
  ...env,
  SHEETS: { async get(k, o) { const v = kv.get(k); return v === undefined ? null : (o?.type === 'json' ? JSON.parse(v) : v); }, async put(k, v) { kv.set(k, v); } },
  ACCOUNTS: {
    idFromName: (name) => name,
    get: (name) => {
      if (!accounts.has(name)) accounts.set(name, new saves.SavesCore(fakeStorage()));
      return { fetch: (request) => saves.accountFetch(accounts.get(name), request) };
    },
  },
  ASSETS: { fetch: (req) => new Response(`asset ${new URL(req.url).pathname}`) },
};
const wfetch = (method, path, { body, session = '', origin = SITE, token = '', withEnv = wenv } = {}) => worker.fetch(new Request(`${SITE}${path}`, {
  method,
  headers: {
    'content-type': 'application/json',
    ...(session ? { cookie: `cs_session=${session}` } : {}),
    ...(origin && method !== 'GET' ? { origin } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
}), withEnv);
const seal = (id, member = true) => auth.sealSession(env, { id, name: id, member, exp: Date.now() + 3600 * 1000 });
const alice = await seal('discord:111');
const bob = await seal('discord:222');
const outsider = await seal('discord:333', false);
const b64 = (doc) => toBase64(gz(doc));

check('worker: me reports server saves', (await (await wfetch('GET', '/api/auth/me', { session: alice })).json()).saves, true);
check('worker: saves need a sign-in', (await wfetch('GET', '/api/saves')).status, 401);
check('worker: saves need server membership', (await wfetch('GET', '/api/saves', { session: outsider })).status, 403);
check('worker: no binding is 503', (await wfetch('GET', '/api/saves', { session: alice, withEnv: { ...wenv, ACCOUNTS: undefined } })).status, 503);
check('worker: an empty account lists nothing, with what it may hold', await (await wfetch('GET', '/api/saves', { session: alice })).json(), { saves: [], used: 0, limits: { saves: 200, checkpoints: 100, total: 25 * 1024 * 1024 } });
res = await wfetch('PUT', '/api/saves/vesna', { session: alice, body: { base: 0, summary: { name: 'Vesna', level: 5 }, gz: b64(vesna) } });
check('worker: a save is stored', [res.status, (await res.json()).rev], [200, 1]);
res = await wfetch('GET', '/api/saves/vesna', { session: alice });
const got = await res.json();
check('worker: the document comes back byte for byte', [got.rev, got.gz], [1, b64(vesna)]);
check('worker: the list shows it', (await (await wfetch('GET', '/api/saves', { session: alice })).json()).saves.map((s) => [s.id, s.rev, s.summary.name]), [['vesna', 1, 'Vesna']]);
check('worker: another account does not see it', (await (await wfetch('GET', '/api/saves', { session: bob })).json()).saves, []);

// A character's checkpoints, through the Worker.
const cpPath = '/api/saves/vesna/checkpoints';
res = await wfetch('PUT', `${cpPath}/uid-before-respec`, { session: alice, body: { label: 'before respec', savedAt: '2026-11-03T09:00:00.000Z', changes: 2, schema: 9, gz: b64({ ...vesna, note: 'earlier' }) } });
check('worker: a checkpoint is stored', [res.status, await res.json()], [200, { uid: 'uid-before-respec', cps: 1 }]);
res = await wfetch('GET', cpPath, { session: alice });
check('worker: it is listed', (await res.json()).checkpoints.map((c) => [c.uid, c.label, c.changes]), [['uid-before-respec', 'before respec', 2]]);
res = await wfetch('GET', `${cpPath}/uid-before-respec`, { session: alice });
check('worker: it comes back byte for byte', (await res.json()).gz, b64({ ...vesna, note: 'earlier' }));
check('worker: another account cannot read it', (await wfetch('GET', `${cpPath}/uid-before-respec`, { session: bob })).status, 404);
check('worker: another account cannot list them', (await wfetch('GET', cpPath, { session: bob })).status, 404);
check('worker: a checkpoint needs a sign-in', (await wfetch('GET', cpPath)).status, 401);
check('worker: a checkpoint write from another site is refused', (await wfetch('PUT', `${cpPath}/uid-from-elsewhere`, { session: alice, origin: 'https://evil.example', body: { gz: b64(vesna) } })).status, 401);
check('worker: a checkpoint that is not gzip is 400', (await wfetch('PUT', `${cpPath}/uid-not-gzip-1`, { session: alice, body: { gz: Buffer.from('plain text, not a document').toString('base64') } })).status, 400);
check('worker: an id that is not one is 404', (await wfetch('GET', `${cpPath}/no`, { session: alice })).status, 404);
check('worker: a name alone renames it', await (await wfetch('PUT', `${cpPath}/uid-before-respec`, { session: alice, body: { label: 'before the respec' } })).json(), { uid: 'uid-before-respec', cps: 2 });
check('worker: the save row carries the count', (await (await wfetch('GET', '/api/saves', { session: alice })).json()).saves[0].cps, 2);
check('worker: delete removes it', await (await wfetch('DELETE', `${cpPath}/uid-before-respec`, { session: alice })).json(), { uid: 'uid-before-respec', cps: 3 });
check('worker: a path under a checkpoint is 404', (await wfetch('GET', `${cpPath}/uid-before-respec/more`, { session: alice })).status, 404);
check('worker: a path that is not checkpoints is 404', (await wfetch('GET', '/api/saves/vesna/other', { session: alice })).status, 404);
check('worker: another account cannot read it', (await wfetch('GET', '/api/saves/vesna', { session: bob })).status, 404);
res = await wfetch('PUT', '/api/saves/vesna', { session: alice, body: { base: 0, summary: { name: 'Vesna' }, gz: b64(vesna) } });
check('worker: a stale save is 409 with the server\'s revision', [res.status, (await res.json()).rev], [409, 1]);
check('worker: a write from another site is refused', (await wfetch('PUT', '/api/saves/vesna', { session: alice, origin: 'https://evil.example', body: { base: 1, gz: b64(vesna) } })).status, 401);
check('worker: a body that is not gzip is 400', (await wfetch('PUT', '/api/saves/vesna', { session: alice, body: { base: 1, gz: Buffer.from('{"plain":"json document"}').toString('base64') } })).status, 400);
check('worker: a body without gz is 400', (await wfetch('PUT', '/api/saves/vesna', { session: alice, body: { base: 1 } })).status, 400);
res = await wfetch('PUT', `/api/saves/${encodeURIComponent('órla venn')}`, { session: alice, body: { base: 0, summary: { name: 'Órla Venn' }, gz: b64({ id: 'x' }) } });
check('worker: an id with spaces and accents is kept as typed', (await res.json()).id, 'órla venn');
check('worker: a path under an id is 404', (await wfetch('GET', '/api/saves/vesna/extra', { session: alice })).status, 404);
check('worker: delete removes it', await (await wfetch('DELETE', '/api/saves/vesna', { session: alice })).json(), { id: 'vesna' });
check('worker: a deleted save is 404', (await wfetch('GET', '/api/saves/vesna', { session: alice })).status, 404);

// A published link follows its author's account.
const doc = { id: 'vesna', identity: { name: 'Vesna' } };
res = await wfetch('POST', '/api/c', { session: alice, body: { doc } });
const link = await res.json();
check('worker: publishing signed in records the owner', JSON.parse(kv.get(`c:${link.id}`)).owner, 'discord:111');
check('worker: the owner publishes again without the token', [(res = await wfetch('PUT', `/api/c/${link.id}`, { session: alice, body: { doc } })).status, (await res.json()).rev], [200, 2]);
check('worker: another account cannot', (await wfetch('PUT', `/api/c/${link.id}`, { session: bob, body: { doc } })).status, 403);
check('worker: the owner from another site cannot', (await wfetch('PUT', `/api/c/${link.id}`, { session: alice, origin: 'https://evil.example', body: { doc } })).status, 403);
check('worker: the token still works signed out', (await wfetch('PUT', `/api/c/${link.id}`, { token: link.token, body: { doc } })).status, 200);
res = await wfetch('POST', '/api/c', { body: { doc } });
const anon = await res.json();
check('worker: publishing signed out records no owner', 'owner' in JSON.parse(kv.get(`c:${anon.id}`)), false);
check('worker: an account cannot take a link without its token', (await wfetch('PUT', `/api/c/${anon.id}`, { session: bob, body: { doc } })).status, 403);
await wfetch('PUT', `/api/c/${anon.id}`, { session: bob, token: anon.token, body: { doc } });
check('worker: publishing with the token while signed in joins the link to the account', JSON.parse(kv.get(`c:${anon.id}`)).owner, 'discord:222');
check('worker: …which then needs no token', (await wfetch('PUT', `/api/c/${anon.id}`, { session: bob, body: { doc } })).status, 200);
check('worker: reading a link sends no owner', 'owner' in (await (await wfetch('GET', `/api/c/${link.id}`)).json()), false);

// The app's own calls (app/js/account.js), through the Worker: what a browser
// sends is what another browser gets back.
const account = await load('app/js/account.js');
let asWho = alice;
globalThis.fetch = (url, init = {}) => {
  const path = String(url).slice(String(url).indexOf('/api/'));
  return worker.fetch(new Request(`${SITE}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), cookie: `cs_session=${asWho}`, ...(init.method && init.method !== 'GET' ? { origin: SITE } : {}) },
  }), wenv);
};
const kept = new Map();
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };

check('app: who is signed in', await account.whoAmI(), { available: true, signedIn: true, id: 'discord:111', name: 'discord:111', member: true, saves: true });
const sheet = { id: 'tamsin', schemaVersion: 9, identity: { name: 'Tamsín', level: 4 }, notes: 'x'.repeat(5000) };
let sent = await account.writeSave('tamsin', sheet, { base: 0, summary: { name: 'Tamsín', level: 4 } });
check('app: a first send is revision 1', sent.rev, 1);
let back = await account.readSave('tamsin');
check('app: the document read back is the one sent', [back.rev, back.doc], [1, sheet]);
check('app: the list names it', (await account.listSaves()).filter((s) => s.id === 'tamsin').map((s) => [s.rev, s.summary.name, s.summary.level]), [[1, 'Tamsín', 4]]);
sent = await account.writeSave('tamsin', { ...sheet, notes: 'second device' }, { base: 1 });
check('app: a send from the same revision is the next', sent.rev, 2);
sent = await account.writeSave('tamsin', sheet, { base: 1 });
check('app: a send from an older revision answers the conflict', [sent.conflict?.rev, sent.rev], [2, undefined]);
check('app: …and the server kept the newer copy', (await account.readSave('tamsin')).doc.notes, 'second device');
sent = await account.writeSave('tamsin', sheet, { base: 1, force: true });
check('app: force sends over it', sent.rev, 3);
asWho = bob;
let refused = null;
try { await account.readSave('tamsin'); } catch (err) { refused = [err.status, err.message]; }
check('app: another account gets the server\'s refusal', refused, [404, 'No such character on the server.']);
asWho = alice;

// Checkpoints, as the app sends and reads them.
const packed = gz({ ...sheet, notes: 'at level 3' });
check('app: a checkpoint is sent', await account.writeCheckpoint('tamsin', 'uid-app-level-3', { label: 'level 3', savedAt: '2026-11-05T12:00:00.000Z', changes: 1, schema: 9, bytes: packed }), { uid: 'uid-app-level-3', cps: 1 });
check('app: it is listed', (await account.listCheckpoints('tamsin')).checkpoints.map((c) => [c.uid, c.label, c.size]), [['uid-app-level-3', 'level 3', packed.length]]);
check('app: its bytes come back as sent', Buffer.from(await account.readCheckpointBytes('tamsin', 'uid-app-level-3')).equals(Buffer.from(packed)), true);
check('app: a name alone renames it', (await account.writeCheckpoint('tamsin', 'uid-app-level-3', { label: 'third level' })).cps, 2);
const whole = await account.readAccount();
check('app: the account says what it holds and may hold', [whole.saves.some((s) => s.id === 'tamsin' && s.cps === 2), whole.used > packed.length, whole.limits.total], [true, true, 25 * 1024 * 1024]);
check('app: a checkpoint is deleted', (await account.deleteCheckpoint('tamsin', 'uid-app-level-3')).cps, 3);
let gone = null;
try { await account.readCheckpointBytes('tamsin', 'uid-app-level-3'); } catch (err) { gone = [err.status, err.message]; }
check('app: reading a deleted one gets the server\'s refusal', gone, [404, 'No such checkpoint on the server.']);
await account.deleteSave('tamsin');
check('app: delete takes it off the list', (await account.listSaves()).some((s) => s.id === 'tamsin'), false);

// What this browser remembers of a server copy, and what to do about one.
account.writeSync('tamsin', { owner: 'discord:111', rev: 3, savedAt: 't1' });
check('sync record: read back by its owner', account.readSync('tamsin', 'discord:111'), { owner: 'discord:111', rev: 3, savedAt: 't1' });
check('sync record: another account reads none', account.readSync('tamsin', 'discord:222'), null);
account.clearSync('tamsin');
check('sync record: cleared', account.readSync('tamsin', 'discord:111'), null);
const plan = (server, sync, savedAt) => account.syncPlan({ server, sync, savedAt });
check('plan: not on the server is sent', plan(null, null, 't1'), 'push');
check('plan: not on the server and never saved here is sent', plan(null, null, null), 'push');
check('plan: deleted from the server is sent again', plan(null, { rev: 3, savedAt: 't1' }, 't1'), 'push');
check('plan: on the server and never matched here asks', plan({ rev: 2 }, null, 't1'), 'ask');
check('plan: same revision, nothing saved since, is left', plan({ rev: 3 }, { rev: 3, savedAt: 't1' }, 't1'), 'none');
check('plan: same revision, saved here since, is sent', plan({ rev: 3 }, { rev: 3, savedAt: 't1' }, 't2'), 'push');
check('plan: sent before any Save and saved since, is sent', plan({ rev: 1 }, { rev: 1, savedAt: null }, 't1'), 'push');
check('plan: sent before any Save and still none, is left', plan({ rev: 1 }, { rev: 1, savedAt: null }, null), 'none');
check('plan: the server moved on, nothing saved here since, is loaded', plan({ rev: 4 }, { rev: 3, savedAt: 't1' }, 't1'), 'pull');
check('plan: the server moved on and so did this browser, asks', plan({ rev: 4 }, { rev: 3, savedAt: 't1' }, 't2'), 'ask');


// What to do about a character's checkpoints here and on the server.
const here = (uid, label, extra = {}) => ({ key: `k-${uid}`, uid, label, onServer: false, ...extra });
const there = (uid, label) => ({ uid, label });
const steps = (local, server, known) => {
  const out = account.checkpointPlan({ local, server, known });
  return { ...Object.fromEntries(Object.entries(out.steps).filter(([, list]) => list.length).map(([name, list]) => [name, list.map((c) => c.uid)])), known: out.known };
};
check('checkpoints: one made here is sent', steps([here('a', 'level 1')], [], {}), { send: ['a'], known: { a: 'level 1' } });
check('checkpoints: one made on another device is listed here', steps([], [there('b', 'level 2')], {}), { adopt: ['b'], known: { b: 'level 2' } });
check('checkpoints: the same on both sides is left', steps([here('a', 'level 1')], [there('a', 'level 1')], { a: 'level 1' }), { known: { a: 'level 1' } });
check('checkpoints: one deleted here is deleted there', steps([], [there('a', 'level 1')], { a: 'level 1' }), { delete: ['a'], known: {} });
check('checkpoints: one deleted there is deleted here', steps([here('a', 'level 1')], [], { a: 'level 1' }), { drop: ['a'], known: {} });
check('checkpoints: one listed here without its document and gone there is dropped', steps([here('a', 'level 1', { onServer: true })], [], {}), { drop: ['a'], known: {} });
check('checkpoints: a name changed here is sent', steps([here('a', 'first level')], [there('a', 'level 1')], { a: 'level 1' }), { rename: ['a'], known: { a: 'first level' } });
check('checkpoints: a name changed there is used here', steps([here('a', 'level 1')], [there('a', 'first level')], { a: 'level 1' }), { take: ['a'], known: { a: 'first level' } });
check('checkpoints: a name changed on both sides keeps this browser\'s', steps([here('a', 'mine')], [there('a', 'theirs')], { a: 'level 1' }), { rename: ['a'], known: { a: 'mine' } });
check('checkpoints: a server copy made anew gets every checkpoint again', steps([here('a', 'level 1'), here('b', 'level 2')], [], {}), { send: ['a', 'b'], known: { a: 'level 1', b: 'level 2' } });
check('checkpoints: a mix is sorted into its steps', steps(
  [here('a', 'level 1'), here('b', 'level 2'), here('c', 'level 3')],
  [there('a', 'level 1'), there('d', 'level 4'), there('e', 'level 5')],
  { a: 'level 1', b: 'level 2', e: 'level 5' },
), { send: ['c'], adopt: ['d'], drop: ['b'], delete: ['e'], known: { a: 'level 1', c: 'level 3', d: 'level 4' } });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
