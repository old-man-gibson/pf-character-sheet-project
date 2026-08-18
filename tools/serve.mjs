// Dependency-free static file server — the Node equivalent of `python -m http.server`.
//
//   node tools/serve.mjs [port]        (default 8777)
//
// Serves the repository root, so http://localhost:8777/app/index.html is the app
// and any /data/characters/*.json a deployment bundles load the way the sheet expects.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8777);

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
  console.log(`  http://localhost:${port}/app/index.html`);
  console.log('Press Ctrl+C to stop.');
});
