// Session screen server. Serves the board page and a *player view* of the
// board state: hidden tokens, GM notes, and gm fields never leave this
// process. The GM (Claude) edits the board JSON file directly on disk; the
// page polls /state and re-renders.
//
// Usage: node server.mjs [port] [--board <path-to-board.json>]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let port = 8765;
let boardPath = path.join(here, '..', 'campaigns', 'sandbox', 'state', 'board.json');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--board') boardPath = path.resolve(args[++i]);
  else if (/^\d+$/.test(args[i])) port = Number(args[i]);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const readBoard = () => JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const writeBoard = b => fs.writeFileSync(boardPath, JSON.stringify(b, null, 2) + '\n');

function playerView(board) {
  const tokens = board.tokens ?? [];
  const hidden = new Set(tokens.filter(t => t.hidden).map(t => t.id));
  let initiative = null;
  if (board.initiative) {
    const order = board.initiative.order ?? [];
    initiative = {
      round: board.initiative.round ?? 1,
      order: order.filter(id => !hidden.has(id)),
      activeId: hidden.has(order[board.initiative.active]) ? null : order[board.initiative.active] ?? null,
    };
  }
  return {
    v: fs.statSync(boardPath).mtimeMs,
    map: board.map,
    terrain: board.terrain ?? [],
    fog: board.fog ?? { enabled: false, revealed: [] },
    initiative,
    tokens: tokens.filter(t => !t.hidden).map(({ hidden: _h, gmNote: _g, ...t }) => t),
  };
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (req.method === 'GET' && url.pathname === '/state') {
      return json(res, 200, playerView(readBoard()));
    }
    if (req.method === 'POST' && url.pathname === '/move') {
      const { id, x, y } = await collectBody(req);
      const board = readBoard();
      const tok = (board.tokens ?? []).find(t => t.id === id);
      if (!tok || tok.hidden) return json(res, 404, { error: 'no such token' });
      const size = tok.size ?? 1;
      tok.x = Math.max(0, Math.min(board.map.w - size, Math.round(Number(x) || 0)));
      tok.y = Math.max(0, Math.min(board.map.h - size, Math.round(Number(y) || 0)));
      writeBoard(board);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/initiative/next') {
      const board = readBoard();
      const init = board.initiative;
      if (init && (init.order ?? []).length) {
        init.active = ((init.active ?? 0) + 1) % init.order.length;
        if (init.active === 0) init.round = (init.round ?? 1) + 1;
        writeBoard(board);
      }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(here, path.normalize(rel));
      if (!file.startsWith(here) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(405); res.end();
  } catch (err) {
    json(res, 500, { error: String(err.message ?? err) });
  }
});

server.listen(port, () => {
  console.log(`session screen on http://localhost:${port}`);
  console.log(`board file: ${boardPath}`);
});
