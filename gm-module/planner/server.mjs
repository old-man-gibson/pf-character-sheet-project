// Session planner server. Serves the planner page, the player view
// (players.html) and the plan files in one folder (default gm-module/plans/,
// which git ignores). Plans hold DCs and rewards, so the server listens on
// this machine only and refuses a request addressed to any other host name.
// The player view is meant for a second screen or a screen share; it gets its
// data from /api/players, which leaves the GM's fields out.
//
// Usage: node server.mjs [port] [--dir <folder of plan files>]
//
//   GET  /api/players?name=&since=
//                                 { name, v, view } (see playerView in plan.js), or
//                                 { name, v, same: true } when the view is unchanged
//   GET  /api/plans               { dir, plans: [{ name, title, players, activities }] }
//   POST /api/plans  { name, title?, players?, npcs? }
//                                 creates a plan with no activities -> { name, v, plan }
//                                 (409 if the name is taken)
//   GET  /api/plan?name=&since=   { name, v, plan }, or { name, v, same: true } when the
//                                 file is still at version `since`
//   PUT  /api/plan?name=  { base, plan }
//                                 -> { name, v }, or 409 { name, v, plan } with the file's
//                                    current copy when it is no longer at version `base`

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, readJson, serveFile } from '../lib/http.mjs';
import { createPlan, currentVersion, listPlans, readPlan, readPlayerView, validName, writePlan } from './store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let port = 8766;
let dir = path.join(here, '..', 'plans');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') dir = path.resolve(args[++i]);
  else if (/^\d+$/.test(args[i])) port = Number(args[i]);
}

const BODY_LIMIT = 4 * 1024 * 1024;

// The host names a page on this machine uses. A page on some other site that
// reached the port through a name of its own (DNS rebinding) is refused.
const isLocal = host => {
  const p = server.address()?.port;
  return [`localhost:${p}`, `127.0.0.1:${p}`, `[::1]:${p}`].includes(host);
};

const server = http.createServer(async (req, res) => {
  if (!isLocal(req.headers.host)) return json(res, 403, { error: 'local requests only' });
  const url = new URL(req.url, 'http://localhost');
  // A write must say it is JSON, which a page on another site cannot send
  // here without a preflight this server never answers.
  if (req.method !== 'GET' && !String(req.headers['content-type']).startsWith('application/json')) {
    return json(res, 415, { error: 'send JSON' });
  }
  try {
    if (url.pathname === '/api/plans') {
      if (req.method === 'GET') return json(res, 200, { dir, plans: listPlans(dir) });
      if (req.method === 'POST') {
        const { name, title, players, npcs } = await readJson(req);
        if (!validName(name)) return json(res, 400, { error: 'Plan names use letters, digits, spaces, - and _.' });
        const out = createPlan(dir, name, typeof title === 'string' ? title : '', {
          players: Array.isArray(players) ? players : [],
          npcs: Array.isArray(npcs) ? npcs : [],
        });
        return out.ok ? json(res, 201, { name, v: out.v, plan: out.plan }) : json(res, 409, { error: 'A plan with that name exists.' });
      }
      return json(res, 405, { error: 'method not allowed' });
    }
    if (url.pathname === '/api/plan') {
      const name = url.searchParams.get('name');
      if (!validName(name)) return json(res, 400, { error: 'bad plan name' });
      if (req.method === 'GET') {
        const v = currentVersion(dir, name);
        if (v === null) return json(res, 404, { error: 'no such plan' });
        if (url.searchParams.get('since') === v) return json(res, 200, { name, v, same: true });
        return json(res, 200, { name, ...readPlan(dir, name) });
      }
      if (req.method === 'PUT') {
        const { base, plan } = await readJson(req, BODY_LIMIT);
        const out = writePlan(dir, name, plan, base ?? null);
        return out.ok ? json(res, 200, { name, v: out.v }) : json(res, 409, { name, v: out.v, plan: out.plan });
      }
      return json(res, 405, { error: 'method not allowed' });
    }
    if (url.pathname === '/api/players') {
      const name = url.searchParams.get('name');
      if (!validName(name)) return json(res, 400, { error: 'bad plan name' });
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      const out = readPlayerView(dir, name);
      if (!out) return json(res, 404, { error: 'no such plan' });
      if (url.searchParams.get('since') === out.v) return json(res, 200, { name, v: out.v, same: true });
      return json(res, 200, { name, ...out });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.method === 'GET') return serveFile(res, here, url.pathname);
    res.writeHead(405);
    res.end();
  } catch (err) {
    json(res, 500, { error: String(err.message ?? err) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`session planner on http://localhost:${server.address().port}`);
  console.log(`plan files: ${dir}`);
});
