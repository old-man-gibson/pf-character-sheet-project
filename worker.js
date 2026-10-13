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
import { hash, onRequestGet, onRequestOptions, onRequestPost, onRequestPut, validId } from './functions/api/c/[[path]].js';
import { RELAY_ROUTES, relayOptions, relayRequest } from './functions/api/c/relay.js';

// The relay's Durable Object, one per published character (wrangler.jsonc binds it as RELAY).
export { Relay } from './functions/api/c/relay.js';

const HANDLERS = { GET: onRequestGet, POST: onRequestPost, PUT: onRequestPut, OPTIONS: onRequestOptions };

export default {
  async fetch(request, env) {
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    // /api/c/<id>/grant|grants|ticket|relay: control of a squad member handed
    // to the GM, carried by the character's Durable Object. The publish token
    // is checked against the store here; the GM's socket carries its own grant.
    if (parts[0] === 'api' && parts[1] === 'c' && parts.length >= 4 && RELAY_ROUTES.includes(parts[3])) {
      if (request.method === 'OPTIONS') return relayOptions();
      const id = parts[2];
      if (!validId(id)) return new Response(JSON.stringify({ error: 'No such published character.' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
      const verify = async (token) => {
        const meta = await env.SHEETS?.get(`c:${id}`, { type: 'json' });
        if (!meta) return null;
        return (await hash(token)) === meta.tokenHash;
      };
      return relayRequest({ request, env, id, parts: parts.slice(3), verify });
    }
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
