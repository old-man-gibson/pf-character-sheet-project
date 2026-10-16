/** Tests the GM module's session planner: the plan model (one activity per
 *  player at a time, success tiers), what the player view is allowed to see,
 *  the timeline markup both pages draw, the plan files on disk (versioned
 *  writes that never overwrite a change made elsewhere), and the server in
 *  front of them, run on a spare port against a temporary folder.
 *
 *  Run: node tests/gm-planner.test.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  addActivity, addPlayer, allClashes, blankPlan, clashText, clashes, clock, duplicateActivity,
  firstFree, ladder, minutesText, normalizePlan, outcome, playerLoad, playerView, removePlayer, span, updateActivity,
} from '../gm-module/planner/plan.js';
import { blockHtml, layout } from '../gm-module/planner/timeline.js';
import { createPlan, currentVersion, listPlans, readPlan, readPlayerView, validName, writePlan } from '../gm-module/planner/store.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
};

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
    activities: [
      {
        id: 'a1', title: 'Pick the lock', start: 0, duration: 5, players: ['p1', 'p2'], check: 'Disable Device',
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
  check('or leave it out, tooltip included', without.includes('Disable Device'), false);
  check('a player block cannot be dragged or resized', [without.includes('data-grip'), without.includes('tabindex'), without.includes('static')], [false, false, true]);
  check('and names the others in it', without.includes('with Player 2'), true);
  const gm = blockHtml(secretPlan(), secretPlan().activities[0], 'p1', L, { editable: true });
  check('the GM block shows the DC and can be dragged', [gm.includes('Disable Device DC 1777'), gm.includes('data-grip'), gm.includes('tabindex="0"')], [true, true, true]);
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
check('names that could leave the folder or trip Windows are not',
  ['../x', 'a/b', 'a.b', ' lead', 'trail ', 'CON', 'lpt1', '', 'x'.repeat(65), null].map(validName),
  [false, false, false, false, false, false, false, false, false, false]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-planner-'));
try {
  const dir = path.join(tmp, 'plans');
  check('a missing folder lists no plans', listPlans(dir), []);
  const made = createPlan(dir, 'session-2', 'Second');
  check('a new plan is written', [made.ok, made.plan.title, currentVersion(dir, 'session-2') === made.v], [true, 'Second', true]);
  check('a name that is taken is refused', createPlan(dir, 'session-2', 'Again').ok, false);
  createPlan(dir, 'session-10', '');
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

  // ---- The server ----------------------------------------------------------

  const server = spawn(process.execPath, [path.resolve('gm-module/planner/server.mjs'), '0', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      server.stdout.on('data', c => {
        out += c;
        const m = out.match(/localhost:(\d+)/);
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

    const list = await request('GET', '/api/plans');
    check('the server lists the folder', [list.status, list.json.plans.map(p => p.name)], [200, ['broken', 'secrets', 'session-2', 'session-10']]);
    check('a request under another host name is refused', (await request('GET', '/api/plans', { host: 'evil.example:80' })).status, 403);
    check('a write that is not JSON is refused', (await request('POST', '/api/plans', { body: { name: 'x' }, type: 'text/plain' })).status, 415);
    check('a bad plan name is refused', (await request('POST', '/api/plans', { body: { name: '../up' } })).status, 400);

    const created = await request('POST', '/api/plans', { body: { name: 'session-3', title: 'Third', players: table().players } });
    check('a plan is created with the players it is given', [created.status, created.json.plan.title, created.json.plan.players.map(p => p.name)],
      [201, 'Third', ['Ana', 'Ben', 'Cai', 'Dee']]);
    check('a taken name is refused', (await request('POST', '/api/plans', { body: { name: 'session-3' } })).status, 409);

    const v = created.json.v;
    const same = await request('GET', `/api/plan?name=session-3&since=${v}`);
    check('polling an unchanged plan returns no copy', [same.json.same, same.json.plan], [true, undefined]);
    const put = await request('PUT', '/api/plan?name=session-3', { body: { base: v, plan: table() } });
    check('a save at the current version is accepted', [put.status, put.json.v !== v], [200, true]);
    const conflict = await request('PUT', '/api/plan?name=session-3', { body: { base: v, plan: blankPlan() } });
    check('a save from a stale version gets the current copy back', [conflict.status, conflict.json.plan.activities.length], [409, 3]);
    const got = await request('GET', `/api/plan?name=session-3&since=${v}`);
    check('polling a changed plan returns it', [got.status, got.json.v, got.json.plan.activities.length], [200, put.json.v, 3]);
    check('a missing plan is a 404', (await request('GET', '/api/plan?name=nope')).status, 404);

    const players = await request('GET', '/api/players?name=secrets');
    check('the player feed carries the timeline', [players.status, players.json.view.activities[0].title], [200, 'Pick the other lock']);
    check('and nothing the GM keeps back', /SECRET|1777|1888|1999/.test(players.text), false);
    const still = await request('GET', `/api/players?name=secrets&since=${players.json.v}`);
    check('polling an unchanged player view returns no copy', [still.json.same, still.json.view], [true, undefined]);
    check('the player feed is read-only', (await request('PUT', '/api/players?name=secrets', { body: {} })).status, 405);
    check('a missing plan has no player feed', (await request('GET', '/api/players?name=nope')).status, 404);
    const pv = await request('GET', '/players.html');
    check('the player view page is served', [pv.status, pv.text.includes('players.js')], [200, true]);

    const page = await request('GET', '/');
    check('the page is served', [page.status, page.type.startsWith('text/html'), page.text.includes('planner.js')], [200, true, true]);
    check('the model is served to the page', (await request('GET', '/plan.js')).status, 200);
    check('nothing outside the planner folder is served', (await request('GET', '/%2e%2e/lib/http.mjs')).status, 404);
  } finally {
    server.kill();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
