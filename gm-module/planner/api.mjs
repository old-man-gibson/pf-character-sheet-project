// The planner's API as one request handler. Two servers answer it: the
// planner's own (server.mjs, under /api/) and the sheet app's local server,
// through the GM tools mount (gm-module/lib/gm-tools.mjs, under
// /gm-module/planner/api/). The pages ask for it by a relative address, so
// they work under either. Whoever mounts it has already checked that the
// request comes from this machine and that a write is JSON.
//
// Routes (after api/):
//   GET  players?name=&since=     { name, v, view } (see playerView in plan.js), or
//                                 { name, v, same: true } when the view is unchanged
//   GET  plans                    { dir, plans: [{ name, title, players, activities }] }
//   POST plans  { name, plan }    a new plan file -> { name, v, plan } (409 if the name is taken)
//   GET  plan?name=&since=        { name, v, plan }, or { name, v, same: true } when the
//                                 file is still at version `since`
//   PUT  plan?name=  { base, plan }
//                                 -> { name, v }, or 409 { name, v, plan } with the file's
//                                    current copy when it is no longer at version `base`
//   DELETE plan?name=             deletes the plan file -> { name, deleted }
//   GET  library                  { v, library } (v null before anything is saved)
//   PUT  library  { base, library }
//                                 -> { v }, or 409 { v, library } with the current copy

import { json, readJson } from '../lib/http.mjs';
import {
  createPlan, currentVersion, listPlans, readLibrary, readPlan, readPlayerView, removePlan, validName, writeLibrary, writePlan,
} from './store.mjs';

const BODY_LIMIT = 4 * 1024 * 1024;

// A handler for plan files in `dir`: (req, res, route, url), where `route` is
// the path after api/ and `url` the parsed request address.
export default function plannerApi({ dir }) {
  return async function planner(req, res, route, url) {
    const name = url.searchParams.get('name');
    if (route === 'plans') {
      if (req.method === 'GET') return json(res, 200, { dir, plans: listPlans(dir) });
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
      const { name: wanted, plan } = await readJson(req, BODY_LIMIT);
      if (!validName(wanted)) return json(res, 400, { error: 'Plan names use letters, digits, spaces, - and _.' });
      const out = createPlan(dir, wanted, plan);
      return out.ok ? json(res, 201, { name: wanted, v: out.v, plan: out.plan }) : json(res, 409, { error: 'A plan with that name exists.' });
    }
    if (route === 'plan') {
      if (!validName(name)) return json(res, 400, { error: 'bad plan name' });
      if (req.method === 'GET') {
        const v = currentVersion(dir, name);
        if (v === null) return json(res, 404, { error: 'no such plan' });
        if (url.searchParams.get('since') === v) return json(res, 200, { name, v, same: true });
        return json(res, 200, { name, ...readPlan(dir, name) });
      }
      if (req.method === 'DELETE') return json(res, 200, { name, deleted: removePlan(dir, name) });
      if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' });
      const { base, plan } = await readJson(req, BODY_LIMIT);
      const out = writePlan(dir, name, plan, base ?? null);
      return out.ok ? json(res, 200, { name, v: out.v }) : json(res, 409, { name, v: out.v, plan: out.plan });
    }
    if (route === 'library') {
      if (req.method === 'GET') return json(res, 200, readLibrary(dir));
      if (req.method !== 'PUT') return json(res, 405, { error: 'method not allowed' });
      const { base, library } = await readJson(req, BODY_LIMIT);
      const out = writeLibrary(dir, library, base ?? null);
      return out.ok ? json(res, 200, { v: out.v }) : json(res, 409, { v: out.v, library: out.library });
    }
    if (route === 'players') {
      if (!validName(name)) return json(res, 400, { error: 'bad plan name' });
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
      const out = readPlayerView(dir, name);
      if (!out) return json(res, 404, { error: 'no such plan' });
      if (url.searchParams.get('since') === out.v) return json(res, 200, { name, v: out.v, same: true });
      return json(res, 200, { name, ...out });
    }
    return json(res, 404, { error: 'not found' });
  };
}
