// Session planner on a server of its own: the planner page, the player view
// (players.html) and the planner's API (api.mjs, under /api/), for the plan
// files in one folder (default gm-module/plans/, which git ignores). The
// sheet app's local server (tools/serve.mjs) answers the same pages and API
// through the GM tools menu, so this one is only needed without it.
//
// Plans hold DCs and rewards, so the server listens on this machine only and
// refuses a request addressed to any other host name. The player view is for
// a second screen or a screen share; its data leaves the GM's fields out.
//
// Usage: node server.mjs [port] [--dir <folder of plan files>]

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalRequest, json, sendsJson, serveFile } from '../lib/http.mjs';
import plannerApi from './api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let port = 8766;
let dir = path.join(here, '..', 'plans');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir') dir = path.resolve(args[++i]);
  else if (/^\d+$/.test(args[i])) port = Number(args[i]);
}

const api = plannerApi({ dir });

const server = http.createServer(async (req, res) => {
  if (!isLocalRequest(req)) return json(res, 403, { error: 'local requests only' });
  if (req.method !== 'GET' && !sendsJson(req)) return json(res, 415, { error: 'send JSON' });
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname.slice('/api/'.length), url);
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
