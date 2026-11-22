/**
 * Sign-in with Discord, and the session cookie it leaves.
 *
 *   GET  /api/auth/discord            -> Discord's sign-in page
 *   GET  /api/auth/discord/callback   -> sets the session cookie, back to the app
 *   GET  /api/auth/me                 -> { available, signedIn, id, name, member, saves }
 *   POST /api/auth/signout            -> clears the cookie
 *
 * The session is a signed cookie, not a stored record: `{ id, name, member,
 * exp }` and an HMAC-SHA256 over it under SESSION_SECRET. Reading it costs no
 * storage call and signing out is clearing it. The Discord access token is
 * used once, for the account's id, name and server membership, and is not
 * kept.
 *
 * A deployment turns this on with four secrets (Settings > Variables and
 * Secrets, or `wrangler secret put`):
 *
 *   DISCORD_CLIENT_ID      the Discord application's id
 *   DISCORD_CLIENT_SECRET  its secret
 *   SESSION_SECRET         any long random text; changing it signs everyone out
 *   DISCORD_GUILD_ID       optional: the server whose members may save to the
 *                          server. Without it any Discord account may.
 *
 * The application's redirect address is `<site>/api/auth/discord/callback`.
 * Without the first three, /api/auth/me answers `{ available: false }` and
 * the app shows no sign-in.
 *
 * Every handler takes its `fetcher` and clock as arguments, so
 * tests/account-api.test.mjs runs the whole sign-in against a stand-in for
 * Discord.
 */

const SESSION_COOKIE = 'cs_session';
const STATE_COOKIE = 'cs_oauth';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STATE_SECONDS = 10 * 60;
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';
const DISCORD_API = 'https://discord.com/api';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const encoder = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function randomText(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** Whether this deployment has a Discord application and a session secret. */
export const configured = (env) => Boolean(env?.DISCORD_CLIENT_ID && env?.DISCORD_CLIENT_SECRET && env?.SESSION_SECRET);

const hmacKey = (secret) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** A session as the cookie's value: the payload and its signature. */
export async function sealSession(env, session) {
  const payload = b64url(encoder.encode(JSON.stringify(session)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), encoder.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** The session a cookie value holds, or null: unsigned, altered, or expired. */
export async function openSession(env, value, now = Date.now()) {
  const [payload, sig, extra] = String(value || '').split('.');
  if (!payload || !sig || extra !== undefined || !env?.SESSION_SECRET) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), fromB64url(sig), encoder.encode(payload));
    if (!ok) return null;
    const session = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!session || typeof session.id !== 'string' || !(session.exp > now)) return null;
    return session;
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

/** A request made by a page of this site. A browser names the page's origin on every POST, PUT and DELETE. */
export const sameOrigin = (request) => request.headers.get('origin') === new URL(request.url).origin;

/**
 * The signed-in account behind a request, or null.
 *
 * `write` is for a request that changes something: the cookie then counts
 * only when the request came from a page of this site, so another site cannot
 * act as the account.
 */
export async function sessionFrom(request, env, { write = false, now = Date.now() } = {}) {
  if (!configured(env)) return null;
  if (write && !sameOrigin(request)) return null;
  return openSession(env, readCookie(request, SESSION_COOKIE), now);
}

function setCookie(headers, request, name, value, maxAge) {
  // A local http server gets the cookie without Secure, or the browser drops it.
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  headers.append('set-cookie', `${name}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

/** A path on this site to go back to after sign-in; anything else is the app. */
export function safeReturn(path) {
  const p = String(path || '');
  return /^\/[\w\-./]*$/.test(p) && !p.startsWith('//') && p.length <= 200 ? p : '/app/';
}

function back(request, path, outcome, headers = new Headers()) {
  const to = new URL(safeReturn(path), request.url);
  to.searchParams.set('signin', outcome);
  headers.set('location', to.href);
  headers.set('cache-control', 'no-store');
  return new Response(null, { status: 302, headers });
}

const redirectUri = (request) => new URL('/api/auth/discord/callback', request.url).href;

/** Send the browser to Discord, remembering the page to come back to. */
function start(request, env) {
  const url = new URL(request.url);
  const state = randomText();
  const returnTo = safeReturn(url.searchParams.get('return'));
  const to = new URL(DISCORD_AUTHORIZE);
  to.searchParams.set('response_type', 'code');
  to.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  to.searchParams.set('scope', env.DISCORD_GUILD_ID ? 'identify guilds.members.read' : 'identify');
  to.searchParams.set('state', state);
  to.searchParams.set('redirect_uri', redirectUri(request));
  to.searchParams.set('prompt', 'none');
  const headers = new Headers({ location: to.href, 'cache-control': 'no-store' });
  setCookie(headers, request, STATE_COOKIE, `${state}.${b64url(encoder.encode(returnTo))}`, STATE_SECONDS);
  return new Response(null, { status: 302, headers });
}

/** Discord sent the browser back: trade the code for the account, set the session. */
async function finish(request, env, fetcher, now) {
  const url = new URL(request.url);
  const [state, returnB64] = readCookie(request, STATE_COOKIE).split('.');
  let returnTo = '/app/';
  try { if (returnB64) returnTo = safeReturn(new TextDecoder().decode(fromB64url(returnB64))); } catch { /* the app, then */ }
  const headers = new Headers();
  setCookie(headers, request, STATE_COOKIE, '', 0);
  if (url.searchParams.get('error')) return back(request, returnTo, 'canceled', headers);
  const code = url.searchParams.get('code') || '';
  if (!state || !code || url.searchParams.get('state') !== state) return back(request, returnTo, 'failed', headers);

  try {
    const traded = await fetcher(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code, redirect_uri: redirectUri(request),
      }).toString(),
    });
    const token = traded.ok ? (await traded.json())?.access_token : '';
    if (!token) return back(request, returnTo, 'failed', headers);
    const auth = { authorization: `Bearer ${token}` };

    const who = await fetcher(`${DISCORD_API}/users/@me`, { headers: auth });
    const user = who.ok ? await who.json() : null;
    if (!/^\d{5,25}$/.test(String(user?.id || ''))) return back(request, returnTo, 'failed', headers);

    let member = true;
    let nick = '';
    if (env.DISCORD_GUILD_ID) {
      const res = await fetcher(`${DISCORD_API}/users/@me/guilds/${encodeURIComponent(env.DISCORD_GUILD_ID)}/member`, { headers: auth });
      // Discord answers 404 for a server the account is not in; anything else that is not a member record is a failure.
      if (res.ok) nick = (await res.json())?.nick || '';
      else if (res.status === 404) member = false;
      else return back(request, returnTo, 'failed', headers);
    }

    const name = String(nick || user.global_name || user.username || 'Discord user').slice(0, 80);
    const session = { id: `discord:${user.id}`, name, member, exp: now + SESSION_MS };
    setCookie(headers, request, SESSION_COOKIE, await sealSession(env, session), Math.floor(SESSION_MS / 1000));
    return back(request, returnTo, member ? 'ok' : 'not-member', headers);
  } catch {
    return back(request, returnTo, 'failed', headers);
  }
}

/** The Worker's side: `/api/auth/<...parts>`. */
export async function authRequest({ request, env, parts, fetcher = fetch, now = Date.now() }) {
  const what = parts.join('/');
  if (what === 'me' && request.method === 'GET') {
    if (!configured(env)) return json({ available: false });
    const session = await sessionFrom(request, env, { now });
    const saves = Boolean(env.ACCOUNTS);
    return json(session
      ? { available: true, signedIn: true, id: session.id, name: session.name, member: Boolean(session.member), saves }
      : { available: true, signedIn: false, saves });
  }
  if (what === 'signout' && request.method === 'POST') {
    if (!sameOrigin(request)) return json({ error: 'Sign out from the app.' }, 403);
    const headers = new Headers();
    setCookie(headers, request, SESSION_COOKIE, '', 0);
    return json({ signedIn: false }, 200, Object.fromEntries(headers));
  }
  if (what === 'discord' || what === 'discord/callback') {
    if (request.method !== 'GET') return json({ error: 'Sign-in is a page, not a call.' }, 405);
    if (!configured(env)) return json({ error: 'This copy of the app has no sign-in.' }, 503);
    return what === 'discord' ? start(request, env) : finish(request, env, fetcher, now);
  }
  return json({ error: 'No such sign-in call.' }, 404);
}
