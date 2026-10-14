/**
 * The relay: control of a squad member handed to the GM.
 *
 * A published character's owner may hand one squad member -- a conjured
 * companion that made its save and is no longer theirs to run -- to the GM.
 * The player's open sheet stays the one copy of the character and keeps
 * running the table; this relay only carries messages between it and the
 * GM's page, the way the pop-out card windows talk to the sheet over a
 * BroadcastChannel. The sheet sends what the GM's page should show, the page
 * sends back what the GM pressed, and the sheet decides what happens.
 *
 * One Durable Object per published character holds the sockets:
 *
 *   owner            the player's sheet, proven by a ticket the publish token
 *                    bought a moment before (a token in a socket URL would be
 *                    logged; a ticket is spent on use)
 *   control:<member> the GM's page for one member, proven by that member's
 *                    grant token -- the control link itself
 *
 * and in its storage the grants (`grants`: member -> { hash, name, since }),
 * the tickets (`ticket:<t>`, short-lived), and the last render per member
 * (`last:<member>`) so a page that connects late is drawn at once. No
 * document state lives here.
 *
 * Messages, as JSON text:
 *
 *   control -> owner   { type: 'action', member, action, id, arg }   a press
 *   control            { type: 'hello' }                  on connect; the owner
 *                                                         is told the viewer count
 *   owner -> control   { type: 'render', member, ... }    the page's markup
 *   relay -> owner     { type: 'grants', members }        who is handed over,
 *                                                         with viewer counts
 *   relay -> control   { type: 'owner', online }          the sheet came or went
 *                      { type: 'waiting' }                nothing drawn yet
 *                      { type: 'revoked' }                the grant was taken back
 *
 * `RelayCore` is the whole of the behaviour, written against two small
 * interfaces -- a storage with get/put/delete and sockets with send/close
 * and an attachment -- so tests/relay.test.mjs runs it in Node. `Relay` is
 * the Durable Object around it, and `relayRequest` is what the Worker calls
 * for /api/c/<id>/grant, /grants, /ticket and /relay.
 */

const TICKET_TTL_MS = 60 * 1000;
const MAX_MESSAGE = 1024 * 1024;
const MAX_LAST = 512 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

function randomText(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A member id as a grant names it: short, one line, no control characters. */
export const validMember = (m) => typeof m === 'string' && /^[\w.:-]{1,64}$/.test(m);

/**
 * The relay's behaviour, apart from the platform. `storage` has async
 * get/put/delete; `sockets.accept(ws, tags)` registers a socket under tags
 * and `sockets.all(tag)` lists the open ones. A socket has `send(text)`,
 * `close(code, reason)`, `serializeAttachment(obj)` and
 * `deserializeAttachment()`.
 */
export class RelayCore {
  constructor(storage, sockets, now = () => Date.now()) {
    this.storage = storage;
    this.sockets = sockets;
    this.now = now;
  }

  async grants() {
    return (await this.storage.get('grants')) || {};
  }

  /** Hand a member over: a new token, replacing any earlier one for the member. */
  async grant(member, name) {
    if (!validMember(member)) return { error: 'That is not a member id.' };
    const grants = await this.grants();
    const token = randomText(24);
    grants[member] = { hash: await hashText(token), name: String(name || '').slice(0, 80), since: new Date(this.now()).toISOString() };
    await this.storage.put('grants', grants);
    // Whoever was holding the old link is cut off: the token has changed.
    this.#closeAll(`control:${member}`, 4001, 'The control link was replaced.');
    await this.#tellOwner();
    return { member, name: grants[member].name, token };
  }

  /** Take a member back: the pages holding its link are told and closed. */
  async revoke(member) {
    const grants = await this.grants();
    if (!grants[member]) return { error: 'No such grant.' };
    delete grants[member];
    await this.storage.put('grants', grants);
    await this.storage.delete(`last:${member}`);
    for (const ws of this.sockets.all(`control:${member}`)) this.#send(ws, { type: 'revoked' });
    this.#closeAll(`control:${member}`, 4000, 'The grant was taken back.');
    await this.#tellOwner();
    return { member };
  }

  /** What is handed over, for the owner: each member with its viewer count. */
  async list() {
    const grants = await this.grants();
    return Object.entries(grants).map(([member, g]) => ({
      member, name: g.name, since: g.since, viewers: this.sockets.all(`control:${member}`).length,
    }));
  }

  /** A one-use ticket the owner's sheet opens its socket with. */
  async ticket() {
    const t = randomText(18);
    await this.storage.put(`ticket:${t}`, { until: this.now() + TICKET_TTL_MS });
    return { ticket: t, ttl: TICKET_TTL_MS / 1000 };
  }

  /**
   * A socket arriving: the owner with a ticket, or a GM with a grant token
   * for one member. Returns the role it was accepted as, or an error.
   */
  async connect(ws, { owner = '', grant = '', member = '' } = {}) {
    if (owner) {
      const key = `ticket:${owner}`;
      const t = await this.storage.get(key);
      await this.storage.delete(key);
      if (!t || t.until < this.now()) return { error: 'That ticket has expired.' };
      ws.serializeAttachment({ role: 'owner' });
      this.sockets.accept(ws, ['owner']);
      this.#send(ws, { type: 'grants', members: await this.list() });
      for (const m of Object.keys(await this.grants())) this.#each(`control:${m}`, { type: 'owner', online: true });
      return { role: 'owner' };
    }
    if (grant && validMember(member)) {
      const grants = await this.grants();
      const g = grants[member];
      if (!g || g.hash !== await hashText(grant)) return { error: 'That control link does not open this character.' };
      ws.serializeAttachment({ role: 'control', member });
      this.sockets.accept(ws, [`control:${member}`]);
      return { role: 'control', member };
    }
    return { error: 'A socket needs a ticket or a control link.' };
  }

  /** A message on an accepted socket. */
  async message(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const who = ws.deserializeAttachment() || {};
    if (who.role === 'owner') await this.#fromOwner(msg);
    else if (who.role === 'control') await this.#fromControl(ws, who.member, msg);
  }

  /** A socket closing: controls lose a viewer, the owner tells its controls. */
  async close(ws) {
    const who = ws.deserializeAttachment() || {};
    if (who.role === 'owner') {
      if (!this.sockets.all('owner').some((other) => other !== ws)) {
        for (const m of Object.keys(await this.grants())) this.#each(`control:${m}`, { type: 'owner', online: false });
      }
    } else if (who.role === 'control') {
      await this.#tellOwner();
    }
  }

  async #fromOwner(msg) {
    if (msg.type === 'render' && validMember(msg.member)) {
      const text = JSON.stringify(msg);
      if (text.length <= MAX_LAST) await this.storage.put(`last:${msg.member}`, text);
      for (const ws of this.sockets.all(`control:${msg.member}`)) this.#sendText(ws, text);
    }
  }

  async #fromControl(ws, member, msg) {
    if (msg.type === 'hello') {
      const last = await this.storage.get(`last:${member}`);
      const ownerOnline = this.sockets.all('owner').length > 0;
      this.#send(ws, { type: 'owner', online: ownerOnline });
      if (last) this.#sendText(ws, last); else this.#send(ws, { type: 'waiting' });
      await this.#tellOwner();
    } else if (msg.type === 'action') {
      const out = {
        type: 'action', member, action: String(msg.action ?? '').slice(0, 40), id: String(msg.id ?? '').slice(0, 80), arg: String(msg.arg ?? '').slice(0, 400),
      };
      this.#each('owner', out);
    }
  }

  async #tellOwner() {
    const members = await this.list();
    this.#each('owner', { type: 'grants', members });
  }

  #each(tag, msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.sockets.all(tag)) this.#sendText(ws, text);
  }

  #send(ws, msg) { this.#sendText(ws, JSON.stringify(msg)); }

  #sendText(ws, text) {
    try { ws.send(text); } catch { /* a socket on its way out */ }
  }

  #closeAll(tag, code, reason) {
    for (const ws of this.sockets.all(tag)) {
      try { ws.close(code, reason); } catch { /* already closed */ }
    }
  }
}

/** The Durable Object: the platform's sockets and storage around RelayCore. */
export class Relay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.core = new RelayCore(
      { get: (k) => ctx.storage.get(k), put: (k, v) => ctx.storage.put(k, v), delete: (k) => ctx.storage.delete(k) },
      { accept: (ws, tags) => ctx.acceptWebSocket(ws, tags), all: (tag) => ctx.getWebSockets(tag) },
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const what = parts[0] || '';
    if (what === 'relay') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'The relay takes a WebSocket.' }, 426);
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      const result = await this.core.connect(server, {
        owner: url.searchParams.get('owner') || '', grant: url.searchParams.get('grant') || '', member: url.searchParams.get('member') || '',
      });
      if (result.error) return json({ error: result.error }, 403);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (what === 'grant' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const made = await this.core.grant(String(body?.member ?? ''), String(body?.name ?? ''));
      return made.error ? json(made, 400) : json(made, 201);
    }
    if (what === 'grant' && request.method === 'DELETE') {
      const gone = await this.core.revoke(parts[1] || '');
      return gone.error ? json(gone, 404) : json(gone);
    }
    if (what === 'grants') return json({ members: await this.core.list() });
    if (what === 'ticket' && request.method === 'POST') return json(await this.core.ticket(), 201);
    return json({ error: 'No such relay call.' }, 404);
  }

  async webSocketMessage(ws, message) { await this.core.message(ws, message); }

  async webSocketClose(ws) { await this.core.close(ws); }

  async webSocketError(ws) { await this.core.close(ws); }
}

export const RELAY_ROUTES = ['grant', 'grants', 'ticket', 'relay'];

/**
 * The Worker's side: `/api/c/<id>/<grant|grants|ticket|relay>`. Everything
 * but the GM's socket wants the publish token, checked here against the
 * store, and is then handed to the character's Durable Object. `verify`
 * answers whether a bearer token opens the character, so the handler takes
 * nothing else from the store.
 */
export async function relayRequest({ request, env, id, parts, verify }) {
  if (!env?.RELAY) return json({ error: 'This copy of the app has no relay.' }, 503);
  const what = parts[0];
  if (!RELAY_ROUTES.includes(what)) return json({ error: 'No such relay call.' }, 404);
  // A browser's WebSocket carries no Authorization header, so a socket proves
  // itself to the object instead: the GM's with its grant, the sheet's with
  // the ticket the publish token bought a moment before.
  if (what !== 'relay') {
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    // `verify` answers null for a character the store does not have, false for a wrong token.
    const opens = token ? await verify(token) : false;
    if (opens === null) return json({ error: 'No such published character.' }, 404);
    if (!opens) return json({ error: 'That publish token does not open this link.' }, 403);
  }
  const stub = env.RELAY.get(env.RELAY.idFromName(id));
  const inner = new URL(request.url);
  inner.pathname = `/${parts.join('/')}`;
  return stub.fetch(new Request(inner.href, request));
}

export async function relayOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
