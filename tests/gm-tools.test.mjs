/** Tests the GM tools hook: how a folder in gm-module/ joins the sheet's GM
 *  tools menu (gm-tool.json), what the mount refuses, and the sheet app's local
 *  server (tools/serve.mjs) with the tools mounted, run on a spare port with
 *  the GM data in a temporary folder.
 *
 *  Run: node tests/gm-tools.test.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isLocalRequest } from '../gm-module/lib/http.mjs';
import { loadGmTools, mountGmTools } from '../gm-module/lib/gm-tools.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-tools-'));
const write = (rel, text) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
};

// A request as the mount sees it, and a reply that remembers what was sent.
const fakeReq = ({ from = '127.0.0.1', host = 'localhost:9000', method = 'GET', type } = {}) =>
  ({ method, socket: { remoteAddress: from, localPort: 9000 }, headers: { host, ...(type ? { 'content-type': type } : {}) } });
const fakeRes = () => {
  const res = { status: null, body: '', headersSent: false };
  res.writeHead = (code) => { res.status = code; res.headersSent = true; };
  res.end = (body = '') => { res.body = String(body); };
  return res;
};

try {
  // ---- Who counts as local ------------------------------------------------

  check('a page on this machine is local', isLocalRequest(fakeReq()), true);
  check('by any of its local names', ['127.0.0.1:9000', '[::1]:9000'].map(host => isLocalRequest(fakeReq({ host }))), [true, true]);
  check('IPv4 over IPv6 loopback is local', isLocalRequest(fakeReq({ from: '::ffff:127.0.0.1' })), true);
  check('a request from the network is not', isLocalRequest(fakeReq({ from: '192.168.1.20' })), false);
  check('nor one addressed to another name (DNS rebinding)', isLocalRequest(fakeReq({ host: 'evil.example:9000' })), false);
  check('nor one for another port', isLocalRequest(fakeReq({ host: 'localhost:9001' })), false);

  // ---- Reading gm-tool.json ------------------------------------------------

  const real = await loadGmTools(path.resolve('gm-module'), tmp);
  check('the planner joins the menu with its two pages', real.tools.map(t => [t.name, t.href]),
    [['Session planner', 'planner/index.html'], ['Player view', 'planner/players.html']]);
  check('and its server part is loaded', [...real.apis.keys()], ['planner']);
  check('with nothing wrong in the module', real.problems, []);

  write('tools/plain/gm-tool.json', { tools: [{ id: 'notes', name: 'Notes', description: 'A page and nothing else', page: 'index.html' }] });
  write('tools/second/gm-tool.json', { tools: [{ name: 'Dice tray', page: 'dice.html' }, { name: 'No page' }, { page: 'nameless.html' }] });
  write('tools/broken/gm-tool.json', '{ not json');
  write('tools/escapes/gm-tool.json', { tools: [{ name: 'Up and out', page: '../../secrets.html' }] });
  write('tools/far-api/gm-tool.json', { tools: [{ name: 'Far', page: 'index.html' }], api: '../../elsewhere.mjs' });
  write('tools/bad-data/gm-tool.json', { tools: [{ name: 'Bad data', page: 'index.html' }], api: 'api.mjs', data: '../out' });
  write('tools/bad-data/api.mjs', 'export default () => () => {};');
  write('tools/throws/gm-tool.json', { tools: [{ name: 'Throws', page: 'index.html' }], api: 'api.mjs' });
  write('tools/throws/api.mjs', 'throw new Error("cannot start");');
  write('tools/with-api/gm-tool.json', { tools: [{ name: 'Counter', page: 'index.html' }], api: 'api.mjs', data: 'counts' });
  write('tools/with-api/api.mjs',
    'export default ({ dir }) => async (req, res, route) => { res.writeHead(200); res.end(JSON.stringify({ dir, route })); };');
  write('tools/no-manifest/index.html', '<p>not a tool</p>');

  const loaded = await loadGmTools(path.join(tmp, 'tools'), path.join(tmp, 'data'));
  check('tools come in folder order, each entry with a name and a page', loaded.tools.map(t => [t.name, t.href]),
    [['Notes', 'plain/index.html'], ['Dice tray', 'second/dice.html'], ['Counter', 'with-api/index.html']]);
  check('an entry without an id is given one', loaded.tools[1].id, 'second/dice.html');
  check('a description is optional', loaded.tools[1].description, '');
  check('every broken tool is named, and left out', loaded.problems.map(p => p.split(':')[0]).sort(),
    ['bad-data', 'broken', 'escapes', 'far-api', 'throws']);
  check('only working server parts are kept', [...loaded.apis.keys()], ['with-api']);

  // ---- The mount ------------------------------------------------------------

  const gm = await mountGmTools({ root: path.join(tmp, 'tools'), data: path.join(tmp, 'data') });
  const ask = async (pathname, opts = {}) => {
    const res = fakeRes();
    const handled = await gm(fakeReq(opts), res, pathname, new URL(`http://localhost${pathname}`));
    return { handled, status: res.status, body: res.body };
  };
  const menu = await ask('/gm-module/tools');
  check('the menu lists the tools', [menu.status, JSON.parse(menu.body).tools.length], [200, 3]);
  check('the network gets nothing, not even a page', [await ask('/gm-module/plain/index.html', { from: '10.0.0.7' })].map(r => [r.handled, r.status]), [[true, 403]]);
  check('a page is left to the server to send', (await ask('/gm-module/plain/index.html')).handled, false);
  const api = await ask('/gm-module/with-api/api/count/up');
  check("a tool's API gets its route and its own data folder", JSON.parse(api.body), { dir: path.join(tmp, 'data', 'counts'), route: 'count/up' });
  check('a folder without a server part has no API', (await ask('/gm-module/plain/api/x')).status, 404);
  check('a write that is not JSON is refused', (await ask('/gm-module/with-api/api/x', { method: 'POST', type: 'text/plain' })).status, 415);

  // ---- The sheet app's server ------------------------------------------------

  const gmData = path.join(tmp, 'gm-data');
  const server = spawn(process.execPath, [path.resolve('tools/serve.mjs'), '0', '--gm-data', gmData], { stdio: ['ignore', 'pipe', 'pipe'] });
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
            try { json = JSON.parse(text); } catch { /* a page */ }
            resolve({ status: res.statusCode, text, json, location: res.headers.location });
          });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
      });

    const tools = await request('GET', '/gm-module/tools');
    check('the sheet server lists the GM tools', [tools.status, tools.json.tools.map(t => t.id)], [200, ['planner', 'player-view']]);
    check('the sheet itself is served as before', (await request('GET', '/app/index.html')).status, 200);
    check('even to a page under another name, as before', (await request('GET', '/app/index.html', { host: 'evil.example' })).status, 200);
    check('but nothing in gm-module/ is', (await request('GET', '/gm-module/planner/plan.js', { host: 'evil.example' })).status, 403);
    const upper = await request('GET', '/GM-MODULE/planner/plan.js', { host: 'evil.example' });
    check('however the path is spelt', upper.status === 403 || upper.status === 404, true);

    const page = await request('GET', '/gm-module/planner/');
    check('the planner page is served by the sheet server', [page.status, page.text.includes('planner.js')], [200, true]);
    check('its folder address leads to it', (await request('GET', '/gm-module/planner')).location, '/gm-module/planner/');

    const made = await request('POST', '/gm-module/planner/api/plans', { body: { name: 'from-sheet', title: 'From the sheet' } });
    check('the planner API answers through the sheet server', [made.status, made.json.plan.title], [201, 'From the sheet']);
    check('and keeps its plan in its own folder under the GM data folder',
      fs.existsSync(path.join(gmData, 'plans', 'from-sheet.json')), true);
    const listed = await request('GET', '/gm-module/planner/api/plans');
    check('which is the folder it reports', [listed.json.dir, listed.json.plans.map(p => p.name)], [path.join(gmData, 'plans'), ['from-sheet']]);
    check('the player view feed answers there too', (await request('GET', '/gm-module/planner/api/players?name=from-sheet')).status, 200);
    check('a write that is not JSON is refused', (await request('POST', '/gm-module/planner/api/plans', { body: { name: 'x' }, type: 'text/plain' })).status, 415);
    check('a tool that is not there has no API', (await request('GET', '/gm-module/nothing/api/x')).status, 404);
  } finally {
    server.kill();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
