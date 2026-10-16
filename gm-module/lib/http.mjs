// HTTP helpers shared by the GM module's servers (the session screen, the
// session planner, and the GM tools mount in the sheet app's server): JSON
// replies, a size-capped JSON body reader, static files served from one
// folder and nothing outside it, and the checks that keep GM data local.

import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// A request from this machine, addressed to it by a local name. A page on
// another site that reached the port under a name of its own (DNS
// rebinding) is not one, and neither is anything from the network.
export function isLocalRequest(req) {
  const port = req.socket.localPort;
  return LOOPBACK.has(req.socket.remoteAddress) &&
    [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(req.headers.host);
}

// A write must say it is JSON: a page on another site cannot send that here
// without a preflight these servers never answer.
export const sendsJson = req => String(req.headers['content-type']).startsWith('application/json');

export function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// The request body parsed as JSON ({} when empty). Rejects a body over `limit`
// bytes instead of reading it all.
export function readJson(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', c => {
      data += c;
      if (data.length > limit) { reject(new Error('request body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Sends the file a URL path names inside `folder`, or a 404. Inside the folder,
// not merely starting with its name: "screen-old" begins the same way as
// "screen" and is not ours to serve.
export function serveFile(res, folder, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  const file = path.join(folder, path.normalize(rel));
  if (!file.startsWith(folder + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(fs.readFileSync(file));
}
