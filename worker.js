/**
 * The site as one Cloudflare Worker: static files, plus the publishing store.
 *
 * Every request for a file the repository has is answered by the assets
 * binding before this runs. What reaches here is `/api/c/...`, which goes to
 * the store's handlers (the same ones a Pages deployment would mount from
 * `functions/`), `/api/auth/...` (sign-in with Discord) and `/api/saves...`
 * (a signed-in account's characters), and anything else, which the assets
 * binding turns into the 404 page. The store's handlers are written against
 * the Pages Functions calling convention -- `{ request, env, params }` -- so
 * this only has to build that.
 */
import { onRequestGet, onRequestOptions, onRequestPost, onRequestPut, opensLink, validId } from './functions/api/c/[[path]].js';
import { RELAY_ROUTES, relayOptions, relayRequest } from './functions/api/c/relay.js';
import { authRequest, sessionFrom } from './functions/api/auth.js';
import { savesRequest } from './functions/api/saves.js';

// The relay's Durable Object, one per published character (wrangler.jsonc binds it as RELAY).
export { Relay } from './functions/api/c/relay.js';
// A signed-in account's server saves, one Durable Object per account (bound as ACCOUNTS).
export { Account } from './functions/api/saves.js';

const HANDLERS = { GET: onRequestGet, POST: onRequestPost, PUT: onRequestPut, OPTIONS: onRequestOptions };

export default {
  async fetch(request, env) {
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    // The signed-in account, for a request that changes something: counted
    // only when the request comes from a page of this site (auth.js).
    const account = () => sessionFrom(request, env, { write: request.method !== 'GET' });
    // /api/auth/...: sign-in with Discord and the session cookie.
    if (parts[0] === 'api' && parts[1] === 'auth') return authRequest({ request, env, parts: parts.slice(2) });
    // /api/saves...: the signed-in account's characters on the server.
    if (parts[0] === 'api' && parts[1] === 'saves') return savesRequest({ request, env, parts: parts.slice(1), session: await account() });
    // /api/c/<id>/grant|grants|ticket|relay: control of a squad member handed
    // to the GM, carried by the character's Durable Object. The publish token
    // or the owning account is checked against the store here; the GM's socket
    // carries its own grant.
    if (parts[0] === 'api' && parts[1] === 'c' && parts.length >= 4 && RELAY_ROUTES.includes(parts[3])) {
      if (request.method === 'OPTIONS') return relayOptions();
      const id = parts[2];
      if (!validId(id)) return new Response(JSON.stringify({ error: 'No such published character.' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
      const verify = async (token) => {
        const meta = await env.SHEETS?.get(`c:${id}`, { type: 'json' });
        if (!meta) return null;
        return Boolean(await opensLink(meta, token, token ? null : await account()));
      };
      return relayRequest({ request, env, id, parts: parts.slice(3), verify });
    }
    if (parts[0] === 'api' && parts[1] === 'c') {
      const handler = HANDLERS[request.method];
      if (!handler) return new Response(JSON.stringify({ error: `${request.method} is not something the store does.` }), {
        status: 405, headers: { 'content-type': 'application/json; charset=utf-8', allow: Object.keys(HANDLERS).join(', ') },
      });
      const session = request.method === 'POST' || request.method === 'PUT' ? await account() : null;
      return handler({ request, env, params: { path: parts.slice(2) }, session });
    }
    return env.ASSETS.fetch(request);
  },
};
