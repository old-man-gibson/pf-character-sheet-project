/** Publish, Unpublish, the card table's windows and the GM relay's messages
 *  (app/js/sheet/sharing.js), over a fake fetch, storage and channel. Uses the
 *  public fixture only.
 *  Run: node tests/sharing.test.mjs */
import { readFileSync } from 'node:fs';
import { Character } from '../app/js/model.js';
import { Sharing, UNPUBLISH_ARM } from '../app/js/sheet/sharing.js';
import { check, finish } from './check.mjs';

const vesna = JSON.parse(readFileSync(new URL('./fixtures/public/characters/vesna.json', import.meta.url), 'utf8'));
const APP = 'https://sheet.example/app/';
const KEY = `published-link:${vesna.id}`;

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    has: (k) => m.has(k),
  };
}

/** A fetch that records each call and answers from `routes`: `'METHOD /path'` to [status, body]. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || 'GET';
    calls.push(`${method} ${path}${init.headers?.authorization ? ` ${init.headers.authorization}` : ''}`);
    const answer = routes[`${method} ${path}`] ?? [404, { error: 'No such published character.' }];
    const [status, body] = typeof answer === 'function' ? answer() : answer;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

/** A host that records what the sharing code asks of the sheet. */
function fakeHost(model, extra = {}) {
  const h = {
    notes: [], renders: 0, headers: 0, actions: [],
    model: () => model,
    ctx: () => ({}),
    render: () => { h.renders++; },
    renderHeader: () => { h.headers++; },
    note: (text) => { h.notes.push(text); },
    tableAction: (...args) => { h.actions.push(args); return true; },
    look: () => ({ theme: 'slate', scheme: 'dark' }),
    isPublished: () => false,
    root: () => null,
    ...extra,
  };
  return h;
}

const model = new Character(structuredClone(vesna));

{
  // Publish, then publish again: one link, moved to a new revision.
  const storage = fakeStorage();
  const fetch = fakeFetch({
    'POST /api/c': [201, { id: 'abcdefghjk', rev: 1, token: 'tok-1' }],
    'PUT /api/c/abcdefghjk': [200, { id: 'abcdefghjk', rev: 2 }],
  });
  const host = fakeHost(model);
  const s = new Sharing(host, { storage, fetch, app: APP });
  check('no Unpublish in the menu before a publish', s.menuHtml().includes('data-action="unpublish"'), false);
  await s.publish();
  check('the first publish posts', fetch.calls, ['POST /api/c']);
  check('and keeps the id, token and revision', JSON.parse(storage.getItem(KEY)), { id: 'abcdefghjk', token: 'tok-1', rev: 1 });
  check('the notice has the share link', s.link.url, 'https://sheet.example/app/published.html?s=abcdefghjk');
  check('the notes say Publishing… then clear', host.notes, ['Publishing…', null]);
  check('the menu now has Unpublish after Publish',
    s.menuHtml().match(/data-action="([\w-]+)"/g), ['data-action="publish"', 'data-action="unpublish"', 'data-action="preview-published"']);

  storage.setItem(KEY, JSON.stringify({ ...JSON.parse(storage.getItem(KEY)), grants: { m1: { name: 'Eidolon' } } }));
  await s.publish();
  check('publishing again puts with the token', fetch.calls.at(-1), 'PUT /api/c/abcdefghjk Bearer tok-1');
  check('the token and the GM grants are kept', JSON.parse(storage.getItem(KEY)),
    { id: 'abcdefghjk', token: 'tok-1', rev: 2, grants: { m1: { name: 'Eidolon' } } });
  check('the notice shows the new revision', s.link.rev, 2);
}

{
  // A link the store no longer has gets a fresh one, without the old grants.
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify({ id: 'oldoldoldo', token: 'tok-old', rev: 4, grants: { m1: { name: 'Eidolon' } } }));
  const fetch = fakeFetch({ 'POST /api/c': [201, { id: 'newnewnewn', rev: 1, token: 'tok-new' }] });
  const s = new Sharing(fakeHost(model), { storage, fetch, app: APP });
  await s.publish();
  check('a 404 on the put falls back to a post', fetch.calls, ['PUT /api/c/oldoldoldo Bearer tok-old', 'POST /api/c']);
  check('the new link has no grants', JSON.parse(storage.getItem(KEY)), { id: 'newnewnewn', token: 'tok-new', rev: 1 });
}

{
  // A static copy of the app has nowhere to publish.
  const fetch = fakeFetch({ 'POST /api/c': [405, {}] });
  const host = fakeHost(model);
  const s = new Sharing(host, { storage: fakeStorage(), fetch, app: APP });
  await s.publish();
  check('a 405 says there is no server', host.notes.at(-1), 'Could not publish — this copy of the app has no publishing server.');
  check('and leaves no link', s.link, null);
}

{
  // The notice: Unpublish beside the link, red, and asking twice.
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify({ id: 'abcdefghjk', token: 'tok-1', rev: 3 }));
  const s = new Sharing(fakeHost(model), { storage, fetch: fakeFetch({}), app: APP });
  check('no notice before a link is shown', s.noticeHtml(), '');
  check('showKept opens the kept link', s.showKept(), true);
  check('with its revision', s.link.rev, 3);
  const html = s.noticeHtml();
  check('the buttons are Copy, Unpublish and Dismiss',
    html.match(/data-action="([\w-]+)"/g), ['data-action="copy-published-link"', 'data-action="unpublish-confirm"', 'data-action="dismiss-published-link"']);
  check('Unpublish is red and arms under its key', /class="danger unpublish" data-action="unpublish-confirm" data-arm="unpublish"/.test(html), true);
  check('armed, it asks', s.noticeHtml(UNPUBLISH_ARM).includes('>Unpublish — sure?</button>'), true);
  check('armed, it is marked', s.noticeHtml(UNPUBLISH_ARM).includes('class="danger unpublish armed"'), true);
  s.link.summary = '<b>bold</b>';
  check('the summary is escaped', s.noticeHtml().includes('&lt;b&gt;bold&lt;/b&gt;'), true);
  check('no Unpublish without a token',
    new Sharing(fakeHost(model), { storage: fakeStorage(), fetch: fakeFetch({}), app: APP }).showKept(), false);
}

{
  // Unpublish: the GM's grants go first, then the link.
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify({ id: 'abcdefghjk', token: 'tok-1', rev: 3, grants: { m1: { name: 'Eidolon' } } }));
  const fetch = fakeFetch({
    'DELETE /api/c/abcdefghjk/grant/m1': [200, { member: 'm1' }],
    'DELETE /api/c/abcdefghjk': [200, { deleted: true }],
  });
  const host = fakeHost(model);
  const s = new Sharing(host, { storage, fetch, app: APP });
  s.loadGrants();
  check('the kept grant is loaded', Object.keys(s.grantsForCtx()), ['m1']);
  s.showKept();
  await s.unpublish();
  // Node 22 and later have a WebSocket, so loading the grants also asked for a relay ticket.
  check('the grant is revoked, then the link deleted', fetch.calls.filter((c) => c.startsWith('DELETE')),
    ['DELETE /api/c/abcdefghjk/grant/m1 Bearer tok-1', 'DELETE /api/c/abcdefghjk Bearer tok-1']);
  check('the link is forgotten', storage.has(KEY), false);
  check('the notice goes', s.link, null);
  check('the grants go', s.grantsForCtx(), {});
  check('the note says so', host.notes.at(-1), 'Unpublished. The link no longer opens this character.');
}

{
  // A refused delete keeps the token, so it can be tried again.
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify({ id: 'abcdefghjk', token: 'tok-1', rev: 3 }));
  const fetch = fakeFetch({ 'DELETE /api/c/abcdefghjk': [429, { error: 'Too many publishes from this address. Wait a minute and try again.' }] });
  const host = fakeHost(model);
  const s = new Sharing(host, { storage, fetch, app: APP });
  s.showKept();
  await s.unpublish();
  check('a 429 keeps the token', JSON.parse(storage.getItem(KEY)).token, 'tok-1');
  check('and the notice', !!s.link, true);
  check('and says why', host.notes.at(-1), 'Could not unpublish — Too many publishes from this address. Wait a minute and try again.');

  const gone = fakeStorage();
  gone.setItem(KEY, JSON.stringify({ id: 'abcdefghjk', token: 'tok-1', rev: 3 }));
  const t = new Sharing(fakeHost(model), { storage: gone, fetch: fakeFetch({}), app: APP });
  await t.unpublish();
  check('a 404 counts as already gone', gone.has(KEY), false);
}

{
  // The card windows: hello, a press, goodbye, and the sheet going.
  const posted = [];
  let closed = false;
  let listener = null;
  globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; }
    addEventListener(type, fn) { listener = fn; }
    removeEventListener() { listener = null; }
    postMessage(msg) { posted.push(msg); }
    close() { closed = true; }
  };
  const host = fakeHost(model);
  const s = new Sharing(host, { storage: fakeStorage(), fetch: fakeFetch({}), app: APP });
  s.openChannel();
  check('the channel is named for the character', s.channelName(), `cs-cards:${vesna.id}`);
  s.postWindows();
  check('nothing is posted before a window says hello', posted.length, 0);
  listener({ data: { type: 'cards:hello', from: 'hand-1', view: 'hand' } });
  check('a hello is answered with that view', posted.map((m) => [m.type, m.view, m.scheme]), [['cards:render', 'hand', 'dark']]);
  check('titled for the character', posted[0].title, `${vesna.identity.name} — your hand`);
  posted.length = 0;
  s.postWindows();
  check('a render posts only the views with a viewer', posted.map((m) => m.view), ['hand']);
  listener({ data: { type: 'cards:action', from: 'hand-1', action: 'tap', id: 'c1', arg: '' } });
  check('a press runs as a table action from a window', host.actions, [['tap', 'c1', '', { fromWindow: true }]]);
  check('and redraws', host.renders, 1);
  listener({ data: { type: 'cards:bye', from: 'hand-1' } });
  check('goodbye forgets the viewer', s.viewers.size, 0);
  listener({ data: 'not an object' });
  check('a stray message is ignored', host.actions.length, 1);
  s.closeAll();
  check('the sheet going tells the windows', posted.at(-1), { type: 'cards:close' });
  check('and hangs up', [closed, s.channelOpen], [true, false]);
  delete globalThis.BroadcastChannel;
}

{
  // A published sheet shares nothing, even with grants kept for its id.
  const storage = fakeStorage();
  storage.setItem(KEY, JSON.stringify({ id: 'abcdefghjk', token: 'tok-1', grants: { m1: { name: 'Eidolon' } } }));
  const s = new Sharing(fakeHost(model, { isPublished: () => true }), { storage, fetch: fakeFetch({}), app: APP });
  s.loadGrants();
  check('a published sheet loads no grants', s.grantsForCtx(), {});
}

finish();
