/** Tests the GM module's session planner: the plan model (one activity per
 *  player at a time, success tiers, NPCs), what the player view is allowed to see,
 *  the timeline markup both pages draw, the plan files on disk (versioned
 *  writes that never overwrite a change made elsewhere), the planner API
 *  through tools/serve.mjs on a spare port against a temporary folder, and the
 *  two plan stores the pages use (files and this browser's IndexedDB) held to
 *  one contract, so a plan behaves the same in either.
 *
 *  Run: node tests/gm-planner.test.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  addActivity, addNpc, addPlayer, allClashes, blankPlan, clashText, clashes, clock, duplicateActivity,
  firstFree, freeName, ladder, minutesText, nameFrom, newPlan, normalizePlan, npcActivities, npcClashes,
  npcName, outcome, playerLoad, playerView, removeNpc, removePlayer, span, updateActivity,
} from '../gm-module/planner/plan.js';
import { browserStore, fileStore } from '../gm-module/planner/stores.js';
import { blockHtml, layout } from '../gm-module/planner/timeline.js';
import { createPlan, currentVersion, listPlans, readPlan, readPlayerView, removePlan, validName, writePlan } from '../gm-module/planner/store.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
};

// A stand-in for IndexedDB with what browserStore uses: one store keyed by
// `name`, get/getAll/put/delete requests, and readwrite transactions that
// commit when their last request has settled (so a put issued after a get's
// result still lands, as in a browser) and are lost if anything throws.
function fakeIndexedDb() {
  const rows = new Map();
  let made = false;
  const db = {
    objectStoreNames: { contains: () => made },
    createObjectStore: () => { made = true; return {}; },
    close() {},
    transaction(_name, mode) {
      const staged = new Map(rows);
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      let pending = 0;
      let done = false;
      const settle = () => setTimeout(() => {
        if (done || pending) return;
        done = true;
        if (mode === 'readwrite') { rows.clear(); for (const [k, v] of staged) rows.set(k, v); }
        tx.oncomplete?.();
      }, 0);
      const request = fn => {
        if (done) throw new Error('TransactionInactiveError');
        pending++;
        const req = { result: undefined, onsuccess: null, onerror: null };
        queueMicrotask(() => { req.result = fn(); pending--; req.onsuccess?.(); settle(); });
        return req;
      };
      const writable = () => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); };
      tx.objectStore = () => ({
        get: key => request(() => structuredClone(staged.get(key))),
        getAll: () => request(() => [...staged.values()].map(v => structuredClone(v))),
        put: rec => { writable(); return request(() => { staged.set(rec.name, structuredClone(rec)); return rec.name; }); },
        delete: key => { writable(); return request(() => { staged.delete(key); }); },
      });
      settle();
      return tx;
    },
  };
  return {
    rows,
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      queueMicrotask(() => { req.result = db; req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
}

// Four players and the three activities of the planning example: a 5-minute,
// a 15-minute and a shared 10-minute activity, all starting together.
function table() {
  const plan = blankPlan('Test session');
  for (const name of ['Ana', 'Ben', 'Cai', 'Dee']) addPlayer(plan, name);
  addActivity(plan, { title: 'A', start: 0, duration: 5, players: ['p1'] });
  addActivity(plan, { title: 'B', start: 0, duration: 15, players: ['p2'] });
  addActivity(plan, { title: 'D', start: 0, duration: 10, players: ['p3', 'p4'] });
  return plan;
}

// ---- Normalising -------------------------------------------------------------

{
  const plan = normalizePlan(null);
  check('nothing becomes a blank plan', [plan.title, plan.length, plan.snap, plan.players, plan.activities],
    ['Untitled session', 240, 5, [], []]);
  check('an unknown snap step falls back', normalizePlan({ snap: 7 }).snap, 5);
  check('a bad start time is dropped', normalizePlan({ startsAt: '25:00' }).startsAt, '');
}

{
  const plan = normalizePlan({
    title: 'Hand edited',
    players: [{ id: 'p1', name: 'Ana' }, { id: 'p1', name: 'Twin' }, 'junk'],
    activities: [
      { id: 'x', title: 'Kept', start: '15', duration: '20.4', players: ['p1', 'p1', 'ghost'], dc: '18', gmNote: 'extra', tiers: [{ label: 'Great', dc: 23 }, { id: 't1', dc: '' }] },
      { id: 'x', title: 'Same id', start: 30, players: ['ghost'] },
    ],
  });
  check('a repeated player id is given a fresh one', plan.players.map(p => p.id), ['p1', 'p2']);
  check('players get colours', plan.players.every(p => /^#[0-9a-f]{6}$/i.test(p.color)), true);
  const [kept, other] = plan.activities;
  check('numbers are read from strings and rounded', [kept.start, kept.duration, kept.dc], [15, 20, 18]);
  check('unknown and repeated players are dropped', kept.players, ['p1']);
  check('fields the model does not know are kept', kept.gmNote, 'extra');
  check('tiers get ids and a blank DC is null', kept.tiers.map(t => [t.id, t.dc]), [['t1', 23], ['t2', null]]);
  check('a repeated activity id is given a fresh one', other.id, 'a1');
  check('an activity left with nobody is unscheduled', [other.players, other.start], [[], null]);
}

// ---- One activity per player at a time --------------------------------------

{
  const plan = table();
  check('the example has no clashes: different players run in parallel', allClashes(plan), []);
  check('the timeline reaches the session length', span(plan), 240);

  const late = addActivity(plan, { title: 'E', start: 5, duration: 10, players: ['p3'] });
  check('a player busy then cannot start a second activity', late.ok, false);
  check('the refusal names the activity in the way', clashText(plan, late.clashes), 'Cai is already in “D” (0:00–0:10).');
  check('and the refused activity is not added', plan.activities.length, 3);

  const after = addActivity(plan, { title: 'E', start: 10, duration: 10, players: ['p3'] });
  check('back to back is fine: one ends as the next begins', after.ok, true);
  check('a player may do several activities across the session', playerLoad(plan, 'p3'), 20);

  const id = after.activity.id;
  const intoB = updateActivity(plan, id, { start: 5, players: ['p2'] });
  check('moving into a busy slot of another player is refused', [intoB.ok, intoB.clashes.map(c => c.activity.title)], [false, ['B']]);
  check('and leaves the activity where it was', plan.activities.find(a => a.id === id).start, 10);

  const toBen = updateActivity(plan, id, { start: 15, players: ['p2'] });
  check('handing it to a player who is free then works', [toBen.ok, toBen.activity.players], [true, ['p2']]);

  const nobody = updateActivity(plan, id, { players: [] });
  check('taking everyone out moves it to the tray', [nobody.ok, nobody.activity.start], [true, null]);
  check('an unscheduled activity clashes with nothing', clashes(plan, { ...nobody.activity, players: ['p2'] }), []);

  const longer = updateActivity(plan, plan.activities[0].id, { duration: 30 });
  check('growing an activity over nothing is fine', longer.ok, true);
}

{
  const plan = table();
  const shared = plan.activities[2];
  check('the first free start for a shared activity waits for both players',
    firstFree(plan, { ...shared, id: 'new', players: ['p2', 'p3'] }, 0), 15);
  check('a free player can start straight away', firstFree(plan, { id: 'new', duration: 5, players: ['p1'] }, 5), 5);

  const copy = duplicateActivity(plan, shared.id);
  check('a duplicate starts when its players are next free', [copy.activity.start, copy.activity.players], [10, ['p3', 'p4']]);
  check('a duplicate gets its own id', copy.activity.id !== shared.id, true);

  const emptied = removePlayer(plan, 'p1');
  check('removing a player returns what was left with nobody', emptied.map(a => a.title), ['A']);
  check('and takes them out of shared activities without unscheduling them', plan.activities.filter(a => a.start != null).length, 3);
}

{
  const plan = normalizePlan({
    players: [{ id: 'p1', name: '' }],
    activities: [
      { id: 'a1', title: 'One', start: 0, duration: 20, players: ['p1'] },
      { id: 'a2', title: 'Two', start: 10, duration: 20, players: ['p1'] },
    ],
  });
  check('a hand-edited clash is found', allClashes(plan).map(c => [c.player, c.a.id, c.b.id]), [['p1', 'a1', 'a2']]);
  check('a player with no name is called by their place', clashText(plan, clashes(plan, plan.activities[0])),
    'Player 1 is already in “Two” (0:10–0:30).');
  check('an edit that keeps the clash is refused', updateActivity(plan, 'a2', { duration: 25 }).ok, false);
  check('an edit that clears it is allowed', updateActivity(plan, 'a2', { start: 20 }).ok, true);
  check('and the timeline grows to the last end', span({ ...plan, length: 30 }), 40);
}

// ---- NPCs ------------------------------------------------------------------

{
  const plan = normalizePlan({
    players: [{ id: 'p1', name: 'Ana' }],
    npcs: [{ id: 'n1', name: 'Vey', role: 'Fence', extra: 'kept' }, { id: 'n1', name: 'Twin' }, { name: '' }],
    activities: [{ id: 'a1', title: 'Haggle', start: 0, duration: 10, players: ['p1'], npcs: ['n1', 'n1', 'ghost', 'n2'] }],
  });
  check('NPCs get ids, repeated ones a fresh one', plan.npcs.map(n => n.id), ['n1', 'n2', 'n3']);
  check('NPC fields are filled in and extra ones kept', [plan.npcs[0].description, plan.npcs[0].notes, plan.npcs[0].extra], ['', '', 'kept']);
  check('an activity links only NPCs the plan has, once each', plan.activities[0].npcs, ['n1', 'n2']);
  check('an NPC with no name is called so', npcName(plan, 'n3'), 'Unnamed NPC');
  check('a plan without NPCs gets an empty list', normalizePlan({}).npcs, []);
}

{
  const plan = table();
  const vey = addNpc(plan, { name: 'Vey', role: 'Fence' });
  const mara = addNpc(plan, { name: 'Mara' });
  check('new NPCs get the next free id', [vey.id, mara.id], ['n1', 'n2']);
  const [a, b, d] = plan.activities;
  check('linking an NPC to an activity', updateActivity(plan, d.id, { npcs: [vey.id] }).activity.npcs, ['n1']);
  check('a link to an NPC the plan lacks is dropped', updateActivity(plan, a.id, { npcs: ['nobody', mara.id] }).activity.npcs, ['n2']);
  check('linking NPCs never counts as a player clash', updateActivity(plan, b.id, { npcs: [vey.id] }).ok, true);
  check('one NPC in two activities at once is reported', npcClashes(plan, plan.activities[2]).map(c => [c.npc, c.activity.title]), [['n1', 'B']]);
  check('both ways', npcClashes(plan, plan.activities[1]).map(c => c.activity.title), ['D']);
  updateActivity(plan, b.id, { start: 30 });
  check('but not once they no longer overlap', npcClashes(plan, plan.activities[2]), []);
  updateActivity(plan, a.id, { start: null, players: [] });
  check("an NPC's activities run in time order, unscheduled last", [npcActivities(plan, vey.id), npcActivities(plan, mara.id)].map(l => l.map(x => x.title)),
    [['D', 'B'], ['A']]);
  const copy = duplicateActivity(plan, d.id);
  check('a duplicate keeps its NPC links', copy.activity.npcs, ['n1']);
  const linked = removeNpc(plan, vey.id);
  check('removing an NPC returns what linked them', linked.map(x => x.title), ['B', 'D', 'D']);
  check('and unlinks them everywhere', plan.activities.some(x => x.npcs.includes(vey.id)), false);
  check('the other NPCs stay', plan.npcs.map(n => n.name), ['Mara']);
}

// ---- Checks and tiers --------------------------------------------------------

{
  const act = {
    dc: 15, success: 'The door opens.', failure: 'The alarm sounds.',
    tiers: [
      { id: 't1', label: 'Critical', dc: 25, reward: 'And the vault.' },
      { id: 't2', label: '', dc: 20, reward: 'Quietly.' },
      { id: 't3', label: 'No DC yet', dc: null, reward: '' },
    ],
  };
  check('the ladder runs lowest DC first and skips tiers without one', ladder(act).map(t => [t.label, t.dc]),
    [['Success', 15], ['Unnamed tier', 20], ['Critical', 25]]);
  const low = outcome(act, 14);
  check('below every DC is a failure, with the DC it needed', [low.failure, low.reward, low.next.dc], [true, 'The alarm sounds.', 15]);
  const ok = outcome(act, 15);
  check('meeting the DC succeeds', [ok.tier.label, ok.reward, ok.next.label], ['Success', 'The door opens.', 'Unnamed tier']);
  const mid = outcome(act, 22);
  check('a result earns the highest tier it reaches', [mid.tier.dc, mid.reward, mid.next.dc], [20, 'Quietly.', 25]);
  const top = outcome(act, 40);
  check('the top tier has nothing above it', [top.tier.label, top.next], ['Critical', null]);
  check('no DC, no outcome', outcome({ dc: null, tiers: [] }, 30), null);
  check('a tier may sit below the DC to succeed (a partial success)',
    outcome({ dc: 15, success: '', failure: '', tiers: [{ id: 't1', label: 'Partial', dc: 10, reward: 'Half' }] }, 12).tier.label, 'Partial');
}

// ---- Player view ------------------------------------------------------------

// A plan with every kind of GM-only content in it, each marked SECRET.
function secretPlan() {
  return normalizePlan({
    title: 'Open night',
    gmNotes: 'SECRET plan note',
    players: [{ id: 'p1', name: 'Ana', secretFlag: 'SECRET player note' }, { id: 'p2', name: '' }],
    npcs: [{ id: 'n1', name: 'SECRET npc', role: 'SECRET role', description: 'SECRET looks', notes: 'SECRET motive' }],
    activities: [
      {
        id: 'a1', title: 'Pick the lock', start: 0, duration: 5, players: ['p1', 'p2'], npcs: ['n1'], check: 'Disable Device',
        dc: 1777, premise: 'SECRET premise', success: 'SECRET success', failure: 'SECRET failure',
        tiers: [{ id: 't1', label: 'SECRET tier', dc: 1888, reward: 'SECRET tier reward' }], gmNote: 'SECRET field',
      },
      { id: 'a2', title: 'SECRET unscheduled', start: null, duration: 10, players: ['p1'] },
    ],
  });
}

{
  const view = playerView(secretPlan());
  const text = JSON.stringify(view);
  check('the player view leaves out every GM field', [text.includes('SECRET'), text.includes('1777'), text.includes('1888')], [false, false, false]);
  check('and keeps the timeline', view.activities.map(a => [a.title, a.start, a.duration, a.players, a.check]),
    [['Pick the lock', 0, 5, ['p1', 'p2'], 'Disable Device']]);
  check('players keep their colours and get a name when they have none', view.players.map(p => [p.name, !!p.color]),
    [['Ana', true], ['Player 2', true]]);
  check('the session times come through', [view.title, view.length, view.startsAt], ['Open night', 240, '']);
}

{
  const view = playerView(secretPlan());
  const L = layout(view, 8);
  const [act] = view.activities;
  const withCheck = blockHtml(view, act, 'p1', L, { showCheck: true });
  const without = blockHtml(view, act, 'p1', L, { showCheck: false });
  check('a player block can show the check', withCheck.includes('Disable Device'), true);
  check('a player block names no NPC', withCheck.includes('NPC'), false);
  check('or leave it out, tooltip included', without.includes('Disable Device'), false);
  check('a player block cannot be dragged or resized', [without.includes('data-grip'), without.includes('tabindex'), without.includes('static')], [false, false, true]);
  check('and names the others in it', without.includes('with Player 2'), true);
  const gm = blockHtml(secretPlan(), secretPlan().activities[0], 'p1', L, { editable: true });
  check('the GM block shows the DC and can be dragged', [gm.includes('Disable Device DC 1777'), gm.includes('data-grip'), gm.includes('tabindex="0"')], [true, true, true]);
  check('and names its NPCs in the tooltip', gm.includes('NPCs: SECRET npc'), true);
  check('a block linked to the open NPC is marked', blockHtml(secretPlan(), secretPlan().activities[0], 'p1', L, { marked: true }).includes('marked'), true);
  const odd = blockHtml(view, { ...act, title: '<b>"x"</b>' }, 'p1', L);
  check('titles are escaped', odd.includes('&lt;b&gt;&quot;x&quot;&lt;/b&gt;') && !odd.includes('<b>'), true);
}

// ---- Times -----------------------------------------------------------------

check('times count from the start of the session', clock(75), '1:15');
check('or read as the clock when the plan has a start time', clock(75, '19:00'), '20:15');
check('and wrap past midnight', clock(90, '23:30'), '01:00');
check('durations read as minutes', minutesText(45), '45 min');
check('or hours and minutes', [minutesText(60), minutesText(95)], ['1 h', '1 h 35 min']);

// ---- Plan files --------------------------------------------------------------

check('plain names are allowed', ['session-1', 'Session 2', 'arc_3'].map(validName), [true, true, true]);
check('an imported file name becomes a plan name', ['Heist night #2.json', 'arc_3.JSON', '  spaced  .json'].map(n => nameFrom(n)),
  ['Heist night -2', 'arc_3', 'spaced']);
check('or a fallback when nothing is left of it', [nameFrom('...json'), nameFrom('CON.json'), nameFrom('###')], ['imported', 'imported', 'imported']);
check('a taken name gets a number', [freeName(['a'], 'b'), freeName(['a', 'A-2'], 'a')], ['b', 'a-3']);
check('a new plan starts with the players and NPCs it is given',
  [newPlan('Next', { players: [{ id: 'p1', name: 'Ana' }], npcs: [{ id: 'n1', name: 'Vey' }] })].map(p => [p.title, p.players[0].name, p.npcs[0].name, p.activities]),
  [['Next', 'Ana', 'Vey', []]]);
check('names that could leave the folder or trip Windows are not',
  ['../x', 'a/b', 'a.b', ' lead', 'trail ', 'CON', 'lpt1', '', 'x'.repeat(65), null].map(validName),
  [false, false, false, false, false, false, false, false, false, false]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-planner-'));
try {
  const dir = path.join(tmp, 'plans');
  check('a missing folder lists no plans', listPlans(dir), []);
  const made = createPlan(dir, 'session-2', newPlan('Second'));
  check('a new plan is written', [made.ok, made.plan.title, currentVersion(dir, 'session-2') === made.v], [true, 'Second', true]);
  check('a name that is taken is refused', createPlan(dir, 'session-2', newPlan('Again')).ok, false);
  createPlan(dir, 'session-10', newPlan('session-10'));
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
  fs.writeFileSync(path.join(dir, 'not a plan.txt'), '');
  check('plans list in number order, a broken file flagged', listPlans(dir).map(p => [p.name, !!p.error]),
    [['broken', true], ['session-2', false], ['session-10', false]]);

  const plan = table();
  const first = writePlan(dir, 'session-2', plan, made.v);
  check('a write at the current version goes through', [first.ok, readPlan(dir, 'session-2').plan.activities.length], [true, 3]);
  check('a write from a stale version is refused', writePlan(dir, 'session-2', blankPlan(), made.v).ok, false);

  // Someone edits the file by hand while the page is open.
  const file = path.join(dir, 'session-2.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  onDisk.title = 'Edited by hand';
  fs.writeFileSync(file, JSON.stringify(onDisk));
  const stale = writePlan(dir, 'session-2', plan, first.v);
  check('the page is handed the edited copy instead of writing over it', [stale.ok, stale.plan.title], [false, 'Edited by hand']);
  check('and the hand edit is still on disk', readPlan(dir, 'session-2').plan.title, 'Edited by hand');
  check('a plan written from scratch must not exist yet', writePlan(dir, 'session-2', plan, null).ok, false);
  check('no temporary files are left behind', fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);

  writePlan(dir, 'secrets', secretPlan(), null);
  const shown = readPlayerView(dir, 'secrets');
  const dcOnly = readPlan(dir, 'secrets');
  dcOnly.plan.activities[0].dc = 1999;
  dcOnly.plan.activities[0].success = 'SECRET changed';
  writePlan(dir, 'secrets', dcOnly.plan, dcOnly.v);
  check('a change only the GM sees leaves the player view version alone', readPlayerView(dir, 'secrets').v, shown.v);
  const retitled = readPlan(dir, 'secrets');
  retitled.plan.activities[0].title = 'Pick the other lock';
  writePlan(dir, 'secrets', retitled.plan, retitled.v);
  check('a change the players see gives it a new version', readPlayerView(dir, 'secrets').v !== shown.v, true);
  check('a missing plan has no player view', readPlayerView(dir, 'nope'), null);

  createPlan(dir, 'to-delete', newPlan('Gone soon'));
  check('a plan file can be deleted', [removePlan(dir, 'to-delete'), fs.existsSync(path.join(dir, 'to-delete.json'))], [true, false]);
  check('deleting it again finds nothing', removePlan(dir, 'to-delete'), false);

  // ---- The planner API, through the sheet app's server ----------------------

  const server = spawn(process.execPath, [path.resolve('tools/serve.mjs'), '0', '--gm-data', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      server.stdout.on('data', c => {
        out += c;
        const m = out.match(/localhost:(\d+)\/app/);
        if (m) resolve(Number(m[1]));
      });
      server.on('exit', code => reject(new Error(`server exited (${code})`)));
      setTimeout(() => reject(new Error('server did not start')), 5000);
    });
    const request = (method, url, { body, host = `localhost:${port}`, type = 'application/json' } = {}) =>
      new Promise((resolve, reject) => {
        const data = body === undefined ? null : JSON.stringify(body);
        const headers = { host, ...(data ? { 'content-type': type, 'content-length': Buffer.byteLength(data) } : {}) };
        const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', c => { text += c; });
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(text); } catch { /* a page, not JSON */ }
            resolve({ status: res.statusCode, type: res.headers['content-type'], text, json });
          });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
      });
    const API = '/gm-module/planner/api/';

    const list = await request('GET', `${API}plans`);
    check('the server lists the folder', [list.status, list.json.plans.map(p => p.name)], [200, ['broken', 'secrets', 'session-2', 'session-10']]);
    check('a request under another host name is refused', (await request('GET', `${API}plans`, { host: 'evil.example:80' })).status, 403);
    check('a write that is not JSON is refused', (await request('POST', `${API}plans`, { body: { name: 'x' }, type: 'text/plain' })).status, 415);
    check('a bad plan name is refused', (await request('POST', `${API}plans`, { body: { name: '../up', plan: blankPlan() } })).status, 400);

    const created = await request('POST', `${API}plans`, {
      body: { name: 'session-3', plan: newPlan('Third', { players: table().players, npcs: [{ id: 'n1', name: 'Vey', notes: 'Owes Ana' }] }) },
    });
    check('a plan is created as it is sent',
      [created.status, created.json.plan.title, created.json.plan.players.map(p => p.name), created.json.plan.npcs.map(n => [n.name, n.notes])],
      [201, 'Third', ['Ana', 'Ben', 'Cai', 'Dee'], [['Vey', 'Owes Ana']]]);
    check('a taken name is refused', (await request('POST', `${API}plans`, { body: { name: 'session-3', plan: blankPlan() } })).status, 409);

    const v = created.json.v;
    const same = await request('GET', `${API}plan?name=session-3&since=${v}`);
    check('polling an unchanged plan returns no copy', [same.json.same, same.json.plan], [true, undefined]);
    const put = await request('PUT', `${API}plan?name=session-3`, { body: { base: v, plan: table() } });
    check('a save at the current version is accepted', [put.status, put.json.v !== v], [200, true]);
    const conflict = await request('PUT', `${API}plan?name=session-3`, { body: { base: v, plan: blankPlan() } });
    check('a save from a stale version gets the current copy back', [conflict.status, conflict.json.plan.activities.length], [409, 3]);
    const got = await request('GET', `${API}plan?name=session-3&since=${v}`);
    check('polling a changed plan returns it', [got.status, got.json.v, got.json.plan.activities.length], [200, put.json.v, 3]);
    check('a missing plan is a 404', (await request('GET', `${API}plan?name=nope`)).status, 404);
    check('a delete has to say it is JSON too', (await request('DELETE', `${API}plan?name=session-3`)).status, 415);

    const players = await request('GET', `${API}players?name=secrets`);
    check('the player feed carries the timeline', [players.status, players.json.view.activities[0].title], [200, 'Pick the other lock']);
    check('and nothing the GM keeps back', /SECRET|1777|1888|1999/.test(players.text), false);
    const still = await request('GET', `${API}players?name=secrets&since=${players.json.v}`);
    check('polling an unchanged player view returns no copy', [still.json.same, still.json.view], [true, undefined]);
    check('the player feed is read-only', (await request('PUT', `${API}players?name=secrets`, { body: {} })).status, 405);
    check('a missing plan has no player feed', (await request('GET', `${API}players?name=nope`)).status, 404);

    const page = await request('GET', '/gm-module/planner/');
    check('the planner page is served', [page.status, page.type.startsWith('text/html'), page.text.includes('planner.js')], [200, true, true]);
    const pv = await request('GET', '/gm-module/planner/players.html');
    check('and the player view', [pv.status, pv.text.includes('players.js')], [200, true]);

    // ---- Both stores, one contract ------------------------------------------

    const stores = [
      ['files', fileStore(`http://localhost:${port}/gm-module/planner/api/`), path.join(tmp, 'plans')],
      ['browser', browserStore({ factory: fakeIndexedDb() }), null],
    ];
    for (const [kind, store] of stores) {
      const k = `${kind} store`;
      check(`${k}: says which it is`, store.kind, kind);
      const before = (await store.list()).map(p => p.name);
      const first = await store.create('contract', newPlan('Contract', { players: [{ id: 'p1', name: 'Ana' }] }));
      check(`${k}: creates a plan`, [first.ok, first.plan.title, first.plan.players[0].name], [true, 'Contract', 'Ana']);
      check(`${k}: refuses a taken name`, (await store.create('contract', blankPlan())).ok, false);
      check(`${k}: refuses a bad name`, (await store.create('../up', blankPlan())).ok, false);
      check(`${k}: lists it`, (await store.list()).map(p => p.name).filter(n => !before.includes(n)), ['contract']);
      const read = await store.read('contract');
      check(`${k}: reads it back`, [read.v, read.plan.title], [first.v, 'Contract']);
      check(`${k}: says when nothing changed`, await store.read('contract', first.v), { v: first.v, same: true });
      const plan = { ...read.plan, activities: [{ id: 'a1', title: 'Pick the lock', start: 0, duration: 5, players: ['p1'], dc: 1777, success: 'SECRET' }] };
      const saved = await store.write('contract', plan, first.v);
      check(`${k}: saves at the current version`, [saved.ok, saved.v !== first.v], [true, true]);
      const stale = await store.write('contract', blankPlan(), first.v);
      check(`${k}: refuses a stale version and hands back the current copy`, [stale.ok, stale.v, stale.plan.activities.length], [false, saved.v, 1]);
      const view = await store.playerView('contract');
      check(`${k}: the player view has the timeline and no DC or reward`,
        [view.view.activities[0].title, /1777|SECRET/.test(JSON.stringify(view))], ['Pick the lock', false]);
      const dcOnly = { ...plan, activities: [{ ...plan.activities[0], dc: 1999 }] };
      await store.write('contract', dcOnly, saved.v);
      check(`${k}: a DC change does not change the player view`, await store.playerView('contract', view.v), { v: view.v, same: true });
      check(`${k}: an unknown plan has none`, [await store.read('nope'), await store.playerView('nope')], [null, null]);
      await store.create('contract-10', blankPlan());
      await store.create('contract-2', blankPlan());
      check(`${k}: lists in number order`, (await store.list()).map(p => p.name).filter(n => n.startsWith('contract')),
        ['contract', 'contract-2', 'contract-10']);
      await store.remove('contract-2');
      check(`${k}: deletes a plan`, [await store.read('contract-2'), (await store.list()).some(p => p.name === 'contract-2')], [null, false]);
      const gone = await store.write('contract-2', blankPlan(), '1');
      check(`${k}: a save to a deleted plan says it is gone`, [gone.ok, gone.v, gone.plan], [false, null, null]);
      check(`${k}: and can write it again from nothing`, (await store.write('contract-2', blankPlan(), null)).ok, true);
    }
    const exported = JSON.parse(fs.readFileSync(path.join(tmp, 'plans', 'contract.json'), 'utf8'));
    const into = browserStore({ factory: fakeIndexedDb() });
    check('a plan file imports into the browser store as it is',
      [(await into.create('from-file', exported)).ok, (await into.read('from-file')).plan.activities[0].dc], [true, 1999]);
  } finally {
    server.kill();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
