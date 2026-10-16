/**
 * The GM tools button's list: which tools in gm-module/ the sheet offers.
 *
 * Tools are registered in gm-module/tools.json ({ "folders": [...] }) and each
 * describes itself in <folder>/gm-tool.json (format in
 * gm-module/lib/gm-tools.mjs). On this computer, tools/serve.mjs answers
 * gm-module/tools with every tool it loaded, server parts and all. Anywhere
 * else -- the public site, a plain static server -- the list is read from
 * those static files, keeping only tools marked "site": the ones that work
 * without a server of their own (the planner keeps its plans in the browser
 * there).
 *
 * menuEntries() is the one reading of a manifest's entries, shared with the
 * server side.
 */

const SAFE_FOLDER = /^[A-Za-z0-9_-]+$/;
const line = (v) => (typeof v === 'string' ? v.trim() : '');

/** A path inside a tool's folder: no leading slash, no "..", no scheme. */
export const insideFolder = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\\')
  && !p.split('/').includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(p);

/** The menu entries a manifest gives: { id, name, description, href }, href relative to gm-module/. */
export function menuEntries(folder, manifest) {
  if (!SAFE_FOLDER.test(folder)) return [];
  const tools = Array.isArray(manifest?.tools) ? manifest.tools : [];
  return tools
    .filter((t) => t && line(t.name) && insideFolder(t.page))
    .map((t) => ({ id: line(t.id) || `${folder}/${t.page}`, name: line(t.name), description: line(t.description), href: `${folder}/${t.page}` }));
}

export const isLocalHost = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The tools to list. `base` is gm-module/'s address from the page; `local`
 * says whether a local tools/serve.mjs may be answering.
 */
export async function gmToolsList({ base = '../gm-module/', local = isLocalHost(location.hostname), get = fetchJson } = {}) {
  if (local) {
    const served = await get(`${base}tools`);
    if (Array.isArray(served?.tools)) return served.tools;
  }
  const registry = await get(`${base}tools.json`);
  const folders = (Array.isArray(registry?.folders) ? registry.folders : []).filter((f) => SAFE_FOLDER.test(f));
  const lists = await Promise.all(folders.map(async (folder) => {
    const manifest = await get(`${base}${folder}/gm-tool.json`);
    return manifest?.site === true ? menuEntries(folder, manifest) : [];
  }));
  return lists.flat();
}
