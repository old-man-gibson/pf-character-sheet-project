/**
 * sheet/sharing.js -- what a sheet hands to someone else: its published
 * link, the card table's pop-out windows, and squad members given to the GM.
 *
 * These lived in sheet-element.js, which no Node suite can load. Here they
 * keep their own state and reach the sheet only through the `host` they are
 * given, so tests/sharing.test.mjs drives them with a stand-in model,
 * storage, fetch, socket and channel. The host is:
 *
 *   model()        the character open now, or null
 *   ctx()          the panel context, for drawing the card table
 *   render()       redraw the sheet; renderHeader() redraws the rail and notices
 *   note(text)     the notice under the rail; null clears it
 *   tableAction(action, id, arg, { fromWindow })
 *                  a press on the card table, wherever it was made; returns
 *                  whether to redraw
 *   look()         { theme, scheme } for a window to draw in
 *   isPublished()  whether this is a sheet someone was sent, which shares nothing
 *   root()         the sheet's shadow root
 *
 * Rendering stays the sheet's: the notice and the menu items are markup
 * strings the sheet puts where it always has.
 */

import { describePublish, publishDocument } from '../publish.js';
import { esc } from '../ui/html.js';
import { remoteAllowed, remotePlayArg } from '../model/subsystems/cardcasting.js';
import { cardTableView } from '../ui/panels/cardcasting.js';
import { companionFace } from '../ui/panels/companions.js';

/** The app folder: published.html, cards.html, and /api beside it. */
const APP = new URL('../../', import.meta.url);

/** The key Unpublish is armed under beside the share link (the view's `armedRemove`). */
export const UNPUBLISH_ARM = 'unpublish';

export class Sharing {
  /**
   * @param host   see the top of this file
   * @param opts   `storage`, `fetch` and `app` (the app folder's URL) for a
   *               test; the page's own are used otherwise, looked up at each
   *               call so a stub put in later is still reached
   */
  constructor(host, { storage = null, fetch = null, app = APP } = {}) {
    this.host = host;
    this.app = new URL(app);
    this.storage = storage;
    this.fetch = fetch;
  }

  /* ------------------------------------------------------------------ *
   * The published link.
   * ------------------------------------------------------------------ */

  /** `{ url, rev, summary, copied }` after Publish, until dismissed. */
  link = null;

  #store() {
    if (this.storage) return this.storage;
    try { return globalThis.localStorage ?? null; } catch { return null; }
  }
  #send(url, init) { return (this.fetch ?? globalThis.fetch)(url, { credentials: 'omit', ...init }); }
  #api(path = '') { return new URL(`../api/c${path}`, this.app); }

  #linkKey() { return `published-link:${this.host.model()?.data?.id || 'character'}`; }
  /** The id, token, revision and grants this browser keeps for the character's link. */
  kept() { try { return JSON.parse(this.#store()?.getItem(this.#linkKey()) || 'null'); } catch { return null; } }
  #keep(link) { try { this.#store()?.setItem(this.#linkKey(), JSON.stringify(link)); } catch { /* private window */ } }
  #forget() { try { this.#store()?.removeItem(this.#linkKey()); } catch { /* private window */ } }

  /** The share link for a published id. */
  shareUrl(id) {
    const url = new URL('published.html', this.app);
    url.searchParams.set('s', id);
    return url.href;
  }

  /**
   * Open this character the way someone you sent it to would receive it.
   *
   * Two things make the preview honest rather than flattering. The document is
   * put through `publishDocument` first, so it carries the pack entries this
   * character actually has and none of the catalogues they came from; and the
   * page it opens in mounts the sheet with `packs="none"`, so the reader's own
   * packs -- which here are the author's own packs -- cannot quietly fill in
   * the gaps a stranger would be left with.
   *
   * The handover goes through localStorage rather than sessionStorage, which
   * is per-tab: a tab opened with `noopener` does not inherit the opener's
   * session, and dropping `noopener` to make it would be a worse trade than
   * one key written and removed on read.
   */
  preview() {
    const { doc, report } = publishDocument(this.host.model().toJSON());
    const key = `published-preview:${doc?.id || 'character'}:${Date.now()}`;
    try {
      this.#store().setItem(key, JSON.stringify({ doc, summary: describePublish(report) }));
    } catch (err) {
      this.host.note(`Could not open the preview — ${err.message}`);
      this.host.render();
      return;
    }
    const url = new URL('published.html', this.app);
    url.searchParams.set('k', key);
    const opened = window.open(url.href, '_blank', 'noopener');
    this.host.note(opened
      ? `Published preview opened — ${describePublish(report)}`
      : 'The preview was blocked by the browser. Allow pop-ups for this page and try again.');
    this.host.render();
  }

  /**
   * Put this character on the site the app is served from, and get a link.
   *
   * What leaves is exactly what the preview shows: the document through
   * `publishDocument`, carrying its own entries and no catalogue. The store
   * (functions/api/c) answers the first publish with an id and a token. The
   * token is kept in this browser under the character's id, so the next
   * publish moves the same link to a new revision instead of minting another
   * -- and a link this browser has lost the token for, or the store no longer
   * has, simply gets a fresh one. The link itself carries nothing but the id.
   */
  async publish() {
    const { doc, report } = publishDocument(this.host.model().toJSON());
    const summary = describePublish(report);
    const body = JSON.stringify({ doc, summary });
    const kept = this.kept();
    const send = (method, url, extra = {}) => this.#send(url, {
      method, body, headers: { 'content-type': 'application/json', ...extra },
    });

    this.host.note('Publishing…');
    this.host.renderHeader();
    try {
      let res = kept?.id && kept?.token
        ? await send('PUT', this.#api(`/${kept.id}`).href, { authorization: `Bearer ${kept.token}` })
        : null;
      // The link is gone, or was made by another browser: start a new one.
      if (res && (res.status === 403 || res.status === 404)) res = null;
      if (!res) res = await send('POST', this.#api().href);
      if (res.status === 404 || res.status === 405) throw new Error('this copy of the app has no publishing server');
      const answer = await res.json().catch(() => null);
      if (!res.ok) throw new Error(answer?.error || `the server answered ${res.status}`);
      // The GM's grants ride on the same key (see the relay below). Publishing
      // again keeps them; a new link starts without, as its relay has none.
      const grants = kept?.id === answer.id ? kept.grants : undefined;
      const link = { id: answer.id, token: answer.token || kept?.token || '', rev: answer.rev, ...(grants ? { grants } : {}) };
      this.#keep(link);
      this.link = { url: this.shareUrl(link.id), rev: answer.rev, summary, copied: null };
      this.host.note(null);
    } catch (err) {
      this.host.note(`Could not publish — ${err.message.replace(/\.$/, '')}.`);
    }
    this.host.renderHeader();
  }

  /**
   * Show the kept link's notice, for Unpublish from the menu. Returns whether
   * there is a link this browser can take down.
   */
  showKept() {
    const kept = this.kept();
    if (!kept?.id || !kept?.token) return false;
    this.link ??= { url: this.shareUrl(kept.id), rev: kept.rev, summary: '', copied: null };
    return true;
  }

  /**
   * Take the link down. The GM's control links go first, because the relay
   * checks them against the publish token and that token stops opening
   * anything once the store forgets the character. Then the published copy
   * and its revisions are deleted. A 404 means the store already has none.
   */
  async unpublish() {
    const kept = this.kept();
    if (!kept?.id || !kept?.token) return;
    const headers = { authorization: `Bearer ${kept.token}` };
    this.host.note('Unpublishing…');
    this.host.renderHeader();
    try {
      for (const member of Object.keys(this.#relay.members)) {
        await this.#send(this.#relayApi(kept.id, `grant/${encodeURIComponent(member)}`).href, { method: 'DELETE', headers })
          .catch(() => null);
      }
      this.#relay.members = {};
      this.closeRelay();
      this.#keep({ ...kept, grants: {} });
      const res = await this.#send(this.#api(`/${kept.id}`).href, { method: 'DELETE', headers });
      if (res.status === 405) throw new Error('this copy of the app has no publishing server');
      if (!res.ok && res.status !== 404) {
        const answer = await res.json().catch(() => null);
        throw new Error(answer?.error || `the server answered ${res.status}`);
      }
      this.#forget();
      this.link = null;
      this.host.note('Unpublished. The link no longer opens this character.');
    } catch (err) {
      this.host.note(`Could not unpublish — ${err.message.replace(/\.$/, '')}.`);
    }
    this.host.render();
  }

  /** The share link to the clipboard, or selected where the clipboard is refused. */
  async copyLink() {
    if (!this.link) return;
    let ok = true;
    try { await navigator.clipboard.writeText(this.link.url); } catch { ok = false; }
    this.link.copied = ok;
    this.host.renderHeader();
    if (!ok) this.host.root()?.querySelector('.pubnote input')?.select();
  }

  /** The menu's Publish, Unpublish and Preview published. Unpublish only where this browser holds the token. */
  menuHtml() {
    return `<button data-action="publish"
          title="Upload this character and get a read-only link. Publishing again updates the same link.">Publish</button>
        ${this.kept()?.token ? `<button data-action="unpublish" class="danger unpublish"
          title="Delete the published copy. The link stops working for everyone who has it.">Unpublish</button>` : ''}
        <button data-action="preview-published"
          title="Open the read-only view a link shows: only the pack entries the character carries, no local packs, nothing saved">Preview published</button>`;
  }

  /** The notice after Publish: the link, Open, Copy, and Unpublish, red, which asks twice. */
  noticeHtml(armed = null) {
    const link = this.link;
    if (!link) return '';
    return `<div class="histnote pubnote" role="status">
          <span><strong>Published</strong> (revision ${link.rev}). ${link.summary ? `${esc(link.summary)} ` : ''}
            Anyone with the link can open it. Publishing again updates the same link.</span>
          <input readonly value="${esc(link.url)}" aria-label="Share link">
          <a href="${esc(link.url)}" target="_blank" rel="noopener">Open</a>
          <button data-view data-action="copy-published-link">${link.copied === true ? 'Copied'
            : link.copied === false ? 'Select it and copy' : 'Copy link'}</button>
          ${this.#unpublishButton(armed === UNPUBLISH_ARM)}
          <button data-view data-action="dismiss-published-link" aria-label="Dismiss">×</button>
        </div>`;
  }

  #unpublishButton(on) {
    if (!this.kept()?.token) return '';
    return `<button class="danger unpublish${on ? ' armed' : ''}" data-action="unpublish-confirm" data-arm="${UNPUBLISH_ARM}"
      title="${on ? 'Press again to delete the published copy' : 'Delete the published copy. The link stops working for everyone who has it.'}">${
      on ? 'Unpublish — sure?' : 'Unpublish'}</button>`;
  }

  /* ------------------------------------------------------------------ *
   * The card table's two windows.
   *
   * A card caster who streams the game wants the table on the shared
   * screen and the hand off it. So the table has two pop-out windows --
   * `cards.html?view=table` and `?view=hand` -- that draw the same zones the
   * tab draws (cardTableView) and own nothing: the sheet renders them on
   * every render of its own and posts the markup over, and a button pressed
   * in one comes back as a message and runs through the host's tableAction
   * exactly as a press on the tab would. One model, three faces.
   *
   * They talk over a BroadcastChannel named for the character rather than
   * through the opener handle, because a browser may turn a pop-up into a
   * tab, and a player may drag the window to another screen or open the
   * address in a tab of their own: every one of those still reaches the
   * sheet. The channel is open whenever a character is, and the markup is
   * posted only while a window has said hello and not yet goodbye.
   * ------------------------------------------------------------------ */

  /** The channel the windows listen on, for the character open now. */
  #channel = null;
  /** The windows that have said hello, by the name each gave itself. */
  viewers = new Set();
  /** The windows this sheet opened, by view, so a second press focuses rather than reopens. */
  #windows = { table: null, hand: null };

  /** The channel's name: this character's, so two sheets open side by side do not cross. */
  channelName() { return `cs-cards:${this.host.model()?.data?.id || 'character'}`; }

  get channelOpen() { return !!this.#channel; }

  /** Open the channel for the character just installed, closing the last one's. */
  openChannel() {
    this.closeChannel();
    if (!this.host.model() || typeof BroadcastChannel === 'undefined') return;
    try {
      this.#channel = new BroadcastChannel(this.channelName());
      this.#channel.addEventListener('message', this.#onWindowMessage);
    } catch { this.#channel = null; }
  }

  closeChannel() {
    if (!this.#channel) return;
    this.#channel.removeEventListener('message', this.#onWindowMessage);
    this.#channel.close();
    this.#channel = null;
    this.viewers.clear();
  }

  /** The address of one of the two windows, on this character's channel. */
  #windowUrl(view) {
    const url = new URL('cards.html', this.app);
    url.searchParams.set('view', view);
    url.searchParams.set('ch', this.channelName());
    return url.href;
  }

  /** Open one of the two windows, or bring it forward if it is open. */
  openWindow(view) {
    if (!(view in this.#windows)) return;
    if (!this.#channel) this.openChannel();
    const open = this.#windows[view];
    if (open && !open.closed) { open.focus(); return; }
    const size = view === 'table' ? 'width=1180,height=820' : 'width=1100,height=600';
    const win = window.open(this.#windowUrl(view), `cs-cards-${view}`, `popup=yes,${size}`);
    if (!win) {
      this.host.note('The window was blocked by the browser. Allow pop-ups for this page and try again.');
      this.host.render();
      return;
    }
    // Drawn when the page says hello (#onWindowMessage), and on every
    // render after that.
    this.#windows[view] = win;
  }

  /** Draw the windows from the character as it is now: one message per view with a viewer. */
  postWindows(only = null) {
    if (!only) this.#postRelay();
    const model = this.host.model();
    if (!model || !this.#channel || !this.viewers.size) return;
    const views = only ? [only] : ['table', 'hand'];
    for (const view of views) {
      if (![...this.viewers].some((name) => name.startsWith(`${view}-`))) continue;
      this.#channel.postMessage({
        type: 'cards:render',
        view,
        title: `${model.data.identity?.name || model.data.name || 'Character'} — ${view === 'table' ? 'the table' : 'your hand'}`,
        html: cardTableView(model, this.host.ctx(), view),
        ...this.host.look(),
      });
    }
  }

  /** A message from a window: hello, goodbye, or a press. */
  #onWindowMessage = (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object' || typeof msg.from !== 'string') return;
    const view = msg.view === 'hand' ? 'hand' : 'table';
    if (msg.type === 'cards:hello') { this.viewers.add(msg.from); this.postWindows(view); }
    else if (msg.type === 'cards:bye') this.viewers.delete(msg.from);
    else if (msg.type === 'cards:action') {
      const done = this.host.tableAction(String(msg.action ?? ''), String(msg.id ?? ''), String(msg.arg ?? ''), { fromWindow: true });
      if (done) this.host.render();
    }
  };

  /** The sheet is going: tell the windows, close the ones this sheet opened, and hang up. */
  closeAll = () => {
    try { this.#channel?.postMessage({ type: 'cards:close' }); } catch { /* already closed */ }
    for (const view of Object.keys(this.#windows)) {
      const win = this.#windows[view];
      this.#windows[view] = null;
      try { if (win && !win.closed) win.close(); } catch { /* already gone */ }
    }
    this.closeChannel();
    this.closeRelay();
  };

  /* ------------------------------------------------------------------ *
   * The relay: a squad member handed to the GM.
   *
   * The GM is not on this origin, so the BroadcastChannel cannot reach
   * them; the relay (functions/api/c/relay.js) carries the same messages
   * over a WebSocket. The sheet stays the one copy of the character: it
   * renders the GM's page for each member handed over, and a press from
   * that page runs there, through the host's tableAction, if the allow-list
   * in the model says the GM may make it on that card. The grants ride with
   * the publish link in localStorage, so a reload picks them up again.
   * ------------------------------------------------------------------ */

  /** The relay's state: the socket, the grants by member id, and who is watching each. */
  #relay = { socket: null, tries: 0, members: {}, viewers: {}, closing: false };

  /** The relay's address for one call: `/api/c/<id>/<what>`. */
  #relayApi(id, what) { return this.#api(`/${id}/${what}`); }

  /** The grants kept with the publish link, loaded when a character is installed; the socket follows. */
  loadGrants() {
    const kept = this.host.isPublished() ? null : this.kept();
    this.#relay.members = kept?.grants && typeof kept.grants === 'object' ? kept.grants : {};
    this.#relay.viewers = {};
    if (Object.keys(this.#relay.members).length) this.#openRelay();
  }

  /** What the panels show of the grants: member id to { url, name, since, viewers }. */
  grantsForCtx() {
    const out = {};
    for (const [member, g] of Object.entries(this.#relay.members)) out[member] = { ...g, viewers: this.#relay.viewers[member] || 0 };
    return out;
  }

  /** The control link for a member's grant: the GM's page on this app, with the published id, the member and the grant. */
  #grantUrl(id, member, token) {
    const url = new URL('cards.html', this.app);
    url.searchParams.set('view', 'control');
    url.searchParams.set('s', id);
    url.searchParams.set('m', member);
    url.hash = new URLSearchParams({ t: token }).toString();   // the fragment never reaches a server
    return url.href;
  }

  /** Hand a member to the GM: publish first if need be, make the grant, open the relay. */
  async handOver(member) {
    const m = (this.host.model()?.data?.cardcasting?.calc?.squad || []).find((x) => x.id === member);
    if (!m) return;
    let kept = this.kept();
    if (!kept?.id || !kept?.token) {
      await this.publish();
      kept = this.kept();
      if (!kept?.id || !kept?.token) return;   // publish said why
    }
    this.host.note(`Handing ${m.name} over…`);
    this.host.renderHeader();
    try {
      const res = await this.#send(this.#relayApi(kept.id, 'grant').href, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${kept.token}` },
        body: JSON.stringify({ member, name: m.name }),
      });
      if (res.status === 404 || res.status === 405) throw new Error('this copy of the app has no relay');
      const answer = await res.json().catch(() => null);
      if (!res.ok) throw new Error(answer?.error || `the server answered ${res.status}`);
      this.#relay.members[member] = { name: m.name, token: answer.token, url: this.#grantUrl(kept.id, member, answer.token), since: new Date().toLocaleString() };
      this.#keep({ ...kept, grants: this.#relay.members });
      this.host.note(`${m.name} is handed to the GM — copy the control link from the Squad panel. Keep this sheet open: the GM's presses run here.`);
      this.#openRelay();
    } catch (err) {
      this.host.note(`Could not hand ${m.name} over — ${err.message.replace(/\.$/, '')}.`);
    }
    this.host.render();
  }

  /** Take a member back: the GM's page is told and closed. */
  async takeBack(member) {
    const kept = this.kept();
    const g = this.#relay.members[member];
    if (!g) return;
    delete this.#relay.members[member];
    delete this.#relay.viewers[member];
    this.#keep({ ...(kept || {}), grants: this.#relay.members });
    if (kept?.id && kept?.token) {
      try {
        await this.#send(this.#relayApi(kept.id, `grant/${encodeURIComponent(member)}`).href, { method: 'DELETE', headers: { authorization: `Bearer ${kept.token}` } });
      } catch { /* the link is gone from this sheet either way */ }
    }
    this.host.note(`${g.name || 'The companion'} is yours again.`);
    if (!Object.keys(this.#relay.members).length) this.closeRelay();
    this.host.render();
  }

  async copyGrantLink(member) {
    const g = this.#relay.members[member];
    if (!g) return;
    let ok = true;
    try { await navigator.clipboard.writeText(g.url); } catch { ok = false; }
    this.host.note(ok ? 'Control link copied — send it to the GM.' : 'The clipboard is not available here: select the link in the Squad panel and copy it.');
    this.host.renderHeader();
  }

  /** Open the socket to the relay: a ticket bought with the publish token, then the socket. */
  async #openRelay() {
    const r = this.#relay;
    if (r.socket || r.closing || typeof WebSocket === 'undefined') return;
    const kept = this.kept();
    if (!kept?.id || !kept?.token || !Object.keys(r.members).length) return;
    let ticket;
    try {
      const res = await this.#send(this.#relayApi(kept.id, 'ticket').href, { method: 'POST', headers: { authorization: `Bearer ${kept.token}` } });
      ticket = (await res.json().catch(() => null))?.ticket;
      if (!res.ok || !ticket) throw new Error('no ticket');
    } catch {
      this.#relayRetry();
      return;
    }
    const url = this.#relayApi(kept.id, 'relay');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('owner', ticket);
    let ws;
    try { ws = new WebSocket(url.href); } catch { this.#relayRetry(); return; }
    r.socket = ws;
    ws.addEventListener('open', () => { r.tries = 0; this.#postRelay(); });
    ws.addEventListener('message', this.#onRelayMessage);
    ws.addEventListener('close', () => {
      if (r.socket === ws) r.socket = null;
      if (!r.closing && Object.keys(r.members).length) this.#relayRetry();
    });
  }

  #relayRetry() {
    const r = this.#relay;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(r.tries++, 5));
    setTimeout(() => { if (!r.closing && !r.socket && Object.keys(r.members).length) this.#openRelay(); }, wait);
  }

  closeRelay() {
    const r = this.#relay;
    r.closing = true;
    const ws = r.socket;
    r.socket = null;
    try { ws?.close(); } catch { /* already closed */ }
    r.viewers = {};
    r.closing = false;
  }

  /** Draw the GM's page for every member handed over that someone is watching. */
  #postRelay() {
    const r = this.#relay;
    const model = this.host.model();
    if (!model || !r.socket || r.socket.readyState !== WebSocket.OPEN) return;
    for (const member of Object.keys(r.members)) {
      if (!r.viewers[member]) continue;
      const m = (model.data.cardcasting?.calc?.squad || []).find((x) => x.id === member);
      const msg = {
        type: 'render',
        member,
        title: `${m?.name || r.members[member].name || 'Companion'} — handed to the GM`,
        html: cardTableView(model, this.host.ctx(), 'control', member),
        features: m ? companionFace(model, m.kind, member) : '',
        ...this.host.look(),
      };
      try { r.socket.send(JSON.stringify(msg)); } catch { /* closing */ }
    }
  }

  /** A message from the relay: who is watching, or a press from the GM. */
  #onRelayMessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const model = this.host.model();
    if (!msg || typeof msg !== 'object' || !model) return;
    const r = this.#relay;
    if (msg.type === 'grants') {
      const before = JSON.stringify([r.viewers, Object.keys(r.members)]);
      r.viewers = Object.fromEntries((msg.members || []).map((g) => [g.member, Number(g.viewers) || 0]));
      // A grant the relay no longer holds -- taken back from another browser -- is dropped here too.
      const known = new Set((msg.members || []).map((g) => g.member));
      for (const member of Object.keys(r.members)) if (!known.has(member)) delete r.members[member];
      if (JSON.stringify([r.viewers, Object.keys(r.members)]) !== before) this.host.render();
    } else if (msg.type === 'action') {
      const member = String(msg.member || '');
      const action = String(msg.action || '');
      const id = String(msg.id || '');
      let arg = String(msg.arg || '');
      if (!r.members[member] || !remoteAllowed(model, member, action, id)) return;
      if (action === 'play') arg = remotePlayArg(arg, member);
      if (this.host.tableAction(action, id, arg, { fromWindow: true })) this.host.render();
    }
  };
}
