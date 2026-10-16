// GM tools: how a tool in gm-module/ joins the sheet app's GM tools menu.
//
// A tool is a folder in gm-module/, named in gm-module/tools.json
// ({ "folders": [...] }), with a gm-tool.json in it:
//
//   {
//     "tools": [{ "id": "planner", "name": "Session planner",
//                 "description": "One line for the menu", "page": "index.html" }],
//     "api":  "api.mjs",   (optional) the tool's server part
//     "data": "plans",     (optional) the folder its saved files go in
//     "site": true         (optional) it also works on a static site, without its api
//   }
//
// Each entry in `tools` is a line in the menu, opening `page` (a path inside
// the folder). A folder may list several pages. `api` is a module whose
// default export takes { dir } (the `data` folder under the GM data folder,
// or null) and returns a handler (req, res, route, url) for requests to
// /gm-module/<folder>/api/<route>. Only tools marked `site` are offered on the
// public site, where there is no server part. The planner (gm-module/planner/)
// is the worked example. The registry is one list both the server and the
// public site read; the tests check it names every folder with a manifest.
//
// mountGmTools gives the sheet app's local server (tools/serve.mjs) one
// handler for everything under /gm-module/. GM tools hold what the players
// must not see (DCs, rewards, campaign notes), so every request there has to
// come from this machine. The handler answers /gm-module/tools (the menu)
// and the tools' APIs itself, and leaves the rest (the pages) to the server.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isLocalRequest, json, sendsJson } from './http.mjs';
import { insideFolder, menuEntries } from '../../app/js/gm-tools.js';

const FOLDER = /^[A-Za-z0-9_-]+$/;

// The folders gm-module/tools.json registers (an empty list without one).
export function registeredFolders(root) {
  const file = path.join(root, 'tools.json');
  if (!fs.existsSync(file)) return [];
  const folders = JSON.parse(fs.readFileSync(file, 'utf8')).folders;
  return Array.isArray(folders) ? folders.filter(f => typeof f === 'string') : [];
}

// Reads each registered folder's gm-tool.json and loads its server part.
// Returns { tools, apis, problems }: the menu entries ({ id, name,
// description, href } with href relative to gm-module/), the API handler per
// folder, and what could not be loaded. A tool whose manifest or server part
// fails is left out of the menu, so the menu never offers a page that cannot
// work.
export async function loadGmTools(root, data = root) {
  const tools = [];
  const apis = new Map();
  const problems = [];
  let folders = [];
  try {
    folders = registeredFolders(root);
  } catch (err) {
    problems.push(`tools.json: ${err.message ?? err}`);
  }
  for (const folder of folders) {
    try {
      if (!FOLDER.test(folder)) throw new Error('not a plain folder name');
      const file = path.join(root, folder, 'gm-tool.json');
      if (!fs.existsSync(file)) throw new Error('no gm-tool.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = menuEntries(folder, manifest);
      if (!entries.length) throw new Error('no tools with a name and a page');
      if (manifest.api !== undefined) {
        if (!insideFolder(manifest.api)) throw new Error('api must be a module inside the folder');
        if (manifest.data !== undefined && !(typeof manifest.data === 'string' && FOLDER.test(manifest.data))) {
          throw new Error('data must be a plain folder name');
        }
        const mod = await import(pathToFileURL(path.join(root, folder, manifest.api)).href);
        apis.set(folder, mod.default({ dir: manifest.data ? path.join(data, manifest.data) : null }));
      }
      tools.push(...entries);
    } catch (err) {
      problems.push(`${folder}: ${err.message ?? err}`);
    }
  }
  return { tools, apis, problems };
}

// One handler for /gm-module/... on a server that serves the repository:
// (req, res, pathname, url) -> true when it answered, false to let the server
// serve the file. The handler also carries the loaded `tools` and `problems`.
export async function mountGmTools({ root, data = root }) {
  const { tools, apis, problems } = await loadGmTools(root, data);
  async function gmTools(req, res, pathname, url) {
    if (!isLocalRequest(req)) {
      json(res, 403, { error: 'GM tools answer this machine only' });
      return true;
    }
    if (pathname === '/gm-module/tools') {
      json(res, 200, { tools });
      return true;
    }
    const m = /^\/gm-module\/([^/]+)\/api\/(.+)$/.exec(pathname);
    if (!m) return false;
    const api = apis.get(m[1]);
    if (!api) json(res, 404, { error: 'no such GM tool' });
    else if (req.method !== 'GET' && !sendsJson(req)) json(res, 415, { error: 'send JSON' });
    else {
      try {
        await api(req, res, m[2], url);
      } catch (err) {
        if (!res.headersSent) json(res, 500, { error: String(err.message ?? err) });
      }
    }
    return true;
  }
  return Object.assign(gmTools, { tools, problems });
}
