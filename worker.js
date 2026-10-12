/**
 * The site as one Cloudflare Worker: static files, plus the publishing store.
 *
 * Every request for a file the repository has is answered by the assets
 * binding before this runs. What reaches here is `/api/c/...`, which goes to
 * the store's handlers (the same ones a Pages deployment would mount from
 * `functions/`), and anything else, which the assets binding turns into the
 * 404 page. The handlers are written against the Pages Functions calling
 * convention -- `{ request, env, params }` -- so this only has to build that.
 */
import { onRequestGet, onRequestOptions, onRequestPost, onRequestPut } from './functions/api/c/[[path]].js';

const HANDLERS = { GET: onRequestGet, POST: onRequestPost, PUT: onRequestPut, OPTIONS: onRequestOptions };

export default {
  async fetch(request, env) {
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts[0] === 'api' && parts[1] === 'c') {
      const handler = HANDLERS[request.method];
      if (!handler) return new Response(JSON.stringify({ error: `${request.method} is not something the store does.` }), {
        status: 405, headers: { 'content-type': 'application/json; charset=utf-8', allow: Object.keys(HANDLERS).join(', ') },
      });
      return handler({ request, env, params: { path: parts.slice(2) } });
    }
    return env.ASSETS.fetch(request);
  },
};
