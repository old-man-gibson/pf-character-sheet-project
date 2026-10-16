// Dependency-free static file server — the Node equivalent of `python -m http.server`.
//
//   node tools/serve.mjs [port] [--gm-data <folder>]       (default 8777)
//
// Serves the repository root, so http://localhost:8777/app/index.html is the app
// and any /data/characters/*.json a deployment bundles load the way the sheet expects.
//
// It also mounts the GM tools in gm-module/ (see gm-module/lib/gm-tools.mjs): the
// list behind the sheet's GM tools button, and each tool's server part. Everything
// under gm-module/ answers this machine only. The tools keep their saved files in
// folders of their own under --gm-data (default gm-module/), apart from the
// characters, which stay in the browser.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { stat, readdir, realpath } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
let port = Number(process.env.PORT ?? 8777);
let gmData = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--gm-data') gmData = resolve(args[++i]);
  else if (/^\d+$/.test(args[i])) port = Number(args[i]);
}

// GM tools, when the checkout has them. The sheet works the same without.
const gmRoot = join(root, 'gm-module');
const gm = existsSync(gmRoot)
  ? await import('../gm-module/lib/gm-tools.mjs')
    .then(m => m.mountGmTools({ root: gmRoot, data: gmData ?? gmRoot }))
    .catch(err => { console.warn(`GM tools not loaded: ${err.message}`); return null; })
  : null;
// The folders only this machine may read: gm-module/ and, when it is somewhere
// else in the repository, the GM data folder.
if (gm && gmData) mkdirSync(gmData, { recursive: true });
const gmFolders = gm ? [...new Set([gmRoot, gmData].filter(Boolean).map(d => realpathSync.native(d)))] : [];
const inside = (path, dir) => path === dir || path.startsWith(dir + sep);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
};

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, '400 Bad Request');
  }

  // Resolve inside the root and refuse anything that escapes it.
  const target = resolve(join(root, pathname));
  if (target !== root && !target.startsWith(root + sep)) return send(res, 403, '403 Forbidden');

  // Anything that lands in a GM folder goes past the GM tools first: they answer
  // their own requests and refuse any that are not from this machine. Judged by
  // where the path really leads, since Windows also opens "GM-MODULE" or
  // "GM-MOD~1" as gm-module.
  if (gm) {
    const real = await realpath(target).catch(() => target);
    const gmPath = pathname === '/gm-module' || pathname.startsWith('/gm-module/') || gmFolders.some(d => inside(real, d));
    if (gmPath && await gm(req, res, pathname, new URL(req.url, 'http://localhost'))) return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    return send(res, 404, `404 Not Found: ${pathname}`);
  }

  if (info.isDirectory()) {
    // Serve index.html if present, otherwise a plain listing like http.server does.
    const index = join(target, 'index.html');
    try {
      await stat(index);
      if (!pathname.endsWith('/')) return send(res, 301, '', { location: pathname + '/' });
      return stream(res, index, (await stat(index)).size);
    } catch { /* no index — fall through to the listing */ }

    const base = pathname.endsWith('/') ? pathname : pathname + '/';
    const entries = await readdir(target, { withFileTypes: true });
    const links = entries
      .map(e => `<li><a href="${encodeURI(base + e.name)}${e.isDirectory() ? '/' : ''}">${e.name}${e.isDirectory() ? '/' : ''}</a></li>`)
      .join('\n');
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>${pathname}</title><h1>${pathname}</h1><ul>${links}</ul>`,
      { 'content-type': 'text/html; charset=utf-8' });
  }

  stream(res, target, info.size);
});

function stream(res, file, size) {
  res.writeHead(200, {
    'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res).on('error', () => res.destroy());
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Try: node tools/serve.mjs ${port + 1}`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  console.log(`Serving ${root}`);
  console.log(`  http://localhost:${server.address().port}/app/index.html`);
  if (gm) {
    console.log(`  GM tools: ${gm.tools.map(t => t.name).join(', ') || 'none'} (this machine only)`);
    for (const problem of gm.problems) console.warn(`  GM tool not loaded: ${problem}`);
  }
  console.log('Press Ctrl+C to stop.');
});
