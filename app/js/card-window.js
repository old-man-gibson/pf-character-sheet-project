/**
 * card-window.js -- the card table, or the hand, in a window of its own; or
 * a squad member handed to the GM.
 *
 * The sheet that opened this window owns the character. On every render of
 * its own it posts the markup for one view -- the table, which a shared
 * screen may show, or the hand, which it may not -- over a BroadcastChannel
 * named for the character (`?ch=`), and this page puts the markup into a
 * shadow root wearing the sheet's own stylesheet, so the zones here are the
 * zones there. A button pressed here goes back the same way as
 * `{ type: 'cards:action', action, id, arg }` and runs on the sheet, which
 * then renders and posts again. Nothing is kept here and nothing is decided
 * here.
 *
 * A channel rather than the opener: a browser that turns pop-ups into tabs,
 * or a player who drags the window out to a second screen, or who opens the
 * same address in a tab of their own, all still reach the sheet, as long as
 * it is open on this origin.
 *
 * The control view is the same page for a GM who is not on this origin at
 * all: a squad member the player handed over. The sheet and this page meet
 * at the relay (functions/api/c/relay.js) over a WebSocket, with the same
 * messages: the sheet sends renders, the page sends presses, and the sheet
 * decides. The page also gets a Features pane -- the companion's own tab,
 * read-only -- in the same render.
 *
 * The one thing done locally is the clipboard: a d20 copies the Roll20 text
 * the button carries, and so does a Cast when the sheet has "Copy for Roll20
 * on cast" switched on. A clipboard write wants a user's gesture in the
 * document doing the writing, and the sheet's document does not have this
 * click -- so the text travels on the button and is copied where it was
 * pressed.
 */
import { SHEET_LINK, adoptSheetStyles } from './styles.js';
import { castPickArg, castPickCopy, followCastPick } from './ui/cast-pick.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') === 'hand' ? 'hand' : params.get('view') === 'control' ? 'control' : 'table';
const channelName = params.get('ch') || '';
// The control view's address: the published id, the member, the grant.
const control = view === 'control' ? { id: params.get('s') || '', member: params.get('m') || '', grant: params.get('t') || '' } : null;

const host = document.getElementById('cards');
const root = host.attachShadow({ mode: 'open' });
adoptSheetStyles(root);
host.setAttribute('scheme', 'dark');
const featHost = document.getElementById('features');
const featRoot = featHost.attachShadow({ mode: 'open' });
adoptSheetStyles(featRoot);
featHost.setAttribute('scheme', 'dark');

const title = document.getElementById('title');
const what = document.getElementById('what');
const empty = document.getElementById('empty');
const copied = document.getElementById('copied');
const plain = document.getElementById('plain');
const showFeatures = document.getElementById('showfeatures');

/** This window's name on the channel, so the sheet can count its viewers. */
const me = `${view}-${Math.random().toString(36).slice(2, 10)}`;
const channel = !control && channelName && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;

/* The relay, for the control view: a socket to the character's relay, reopened when it drops. */
let socket = null;
let socketTries = 0;
let revoked = false;

function relayUrl() {
  const url = new URL(`../api/c/${control.id}/relay`, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('grant', control.grant);
  url.searchParams.set('member', control.member);
  return url.href;
}

function openSocket() {
  if (!control || revoked) return;
  let ws;
  try { ws = new WebSocket(relayUrl()); } catch { status('The relay could not be reached.', true); return; }
  socket = ws;
  ws.addEventListener('open', () => {
    socketTries = 0;
    status('connected — waiting for the player’s sheet…');
    ws.send(JSON.stringify({ type: 'hello' }));
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'render') draw(msg);
    else if (msg.type === 'owner') status(msg.online ? (root.innerHTML ? '' : 'the player’s sheet is open — waiting for a render…') : 'the player’s sheet is closed: nothing pressed here will run until it is back', !msg.online);
    else if (msg.type === 'waiting') status('waiting for the player’s sheet to draw this…');
    else if (msg.type === 'revoked') { revoked = true; sheetGone('The player took this companion back.'); }
  });
  ws.addEventListener('close', (e) => {
    socket = null;
    if (revoked) return;
    if (e.code === 4001) { revoked = true; sheetGone('This control link was replaced by a newer one.'); return; }
    if (e.code === 1008 || e.code === 4003) { revoked = true; sheetGone('This control link does not open the character.'); return; }
    status('the relay dropped — reconnecting…', true);
    const wait = Math.min(30000, 1000 * 2 ** Math.min(socketTries++, 5));
    setTimeout(openSocket, wait);
  });
}

function status(text, off = false) {
  what.textContent = text;
  what.classList.toggle('off', off);
}

function send(msg) {
  if (control) {
    if (!socket || socket.readyState !== WebSocket.OPEN) { status('not connected — the press was not sent', true); return; }
    const { type, ...rest } = msg;
    try { socket.send(JSON.stringify({ type: type === 'cards:action' ? 'action' : type.replace(/^cards:/, ''), ...rest })); } catch { /* closing */ }
    return;
  }
  if (!channel) return;
  try { channel.postMessage({ ...msg, view, from: me }); } catch { /* the channel is closed */ }
}

/**
 * The page's own bar follows the sheet's palette the way index.html does:
 * the shadow host wears the theme, the computed colours are copied onto the
 * document root, and chrome.css reads them from there.
 */
const CHROME_VARS = [
  '--cs-bg', '--cs-panel', '--cs-panel-2', '--cs-line', '--cs-text', '--cs-muted',
  '--cs-accent', '--cs-accent-soft', '--cs-edit', '--cs-good', '--cs-bad',
  '--cs-font', '--cs-mono', '--cs-display',
];
function followHost() {
  const cs = getComputedStyle(host);
  for (const name of CHROME_VARS) {
    const v = cs.getPropertyValue(name).trim();
    if (v) document.documentElement.style.setProperty(name, v);
  }
  const scheme = host.getAttribute('scheme') === 'light' ? 'light' : 'dark';
  document.documentElement.style.colorScheme = scheme;
  document.documentElement.dataset.scheme = scheme;
}

/** One render from the sheet. */
function draw(msg) {
  for (const h of [host, featHost]) {
    if (msg.theme) h.setAttribute('theme', msg.theme);
    h.setAttribute('scheme', msg.scheme === 'light' ? 'light' : 'dark');
  }
  const heading = String(msg.title || 'Card table');
  document.title = heading;
  title.textContent = heading;
  status(view === 'table' ? 'the table — what everyone may see' : view === 'hand' ? 'your hand — keep this one off the stream' : 'the GM’s hand — presses run on the player’s sheet');
  empty.hidden = true;
  const html = `${SHEET_LINK}<div class="cardwin ${view}">${msg.html || ''}</div>`;
  const features = control ? `${SHEET_LINK}<div class="cardwin features">${msg.features || '<p class="empty">No features to show.</p>'}</div>` : null;
  // The sheet posts a render on every change of its own, most of them to
  // things this window does not show. Markup that has not changed is left
  // standing: a redraw reset the scroll and dropped the focus, so every
  // edit on the sheet made this window jump to its top.
  if (html !== drawn.html || features !== drawn.features) {
    const scroller = document.scrollingElement || document.documentElement;
    const top = scroller.scrollTop;
    const boxes = [...root.querySelectorAll('.zone, .text, .log, .tablewrap')].map((el) => el.scrollTop);
    const active = root.activeElement;
    const typingAttr = active?.dataset?.tableTargets ? 'data-table-targets' : active?.dataset?.tableSprings ? 'data-table-springs' : null;
    const typing = typingAttr ? { attr: typingAttr, key: active.getAttribute(typingAttr), caret: active.selectionStart } : null;
    root.innerHTML = html;
    if (features !== null) featRoot.innerHTML = features;
    drawn = { html, features };
    scroller.scrollTop = top;
    const again = [...root.querySelectorAll('.zone, .text, .log, .tablewrap')];
    if (again.length === boxes.length) again.forEach((el, i) => { if (boxes[i]) el.scrollTop = boxes[i]; });
    if (typing) {
      const field = root.querySelector(`[${typing.attr}="${CSS.escape(typing.key)}"]`);
      if (field) {
        field.focus({ preventScroll: true });
        try { field.setSelectionRange(typing.caret, typing.caret); } catch { /* not a text control */ }
      }
    }
  }
  if (control) showFeatures.hidden = false;
  followHost();
}
/** What the window last drew, so an identical render is not drawn again. */
let drawn = { html: null, features: null };

/** The sheet has gone: say so, and close if this window was opened by it. */
function sheetGone(why = 'The sheet that was drawing this window has closed. Open it again from the Cardcasting tab.') {
  root.innerHTML = '';
  featRoot.innerHTML = '';
  drawn = { html: null, features: null };
  featHost.hidden = true;
  showFeatures.hidden = true;
  empty.hidden = false;
  empty.textContent = why;
  status('');
  if (!control && window.opener) window.close();
}

/* The sheet's side of the conversation. */
channel?.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'cards:render' && msg.view === view) draw(msg);
  else if (msg.type === 'cards:close') sheetGone();
});

/* Presses go back to the sheet; the clipboard is handled here. */
root.addEventListener('click', (e) => {
  const copy = e.target.closest?.('[data-copytext]');
  const name = (el) => el.dataset.rollwhat || el.closest('[data-card]')?.querySelector('.name')?.textContent || 'card';
  if (copy && !copy.disabled) copyText(copy.dataset.copytext, name(copy));
  if (e.target.closest?.('[data-roll]')) return;   // a d20 copies and does nothing else
  const b = e.target.closest?.('[data-table]');
  if (!b || b.disabled) return;
  // A Cast from the mode chooser copies the mode picked, which its option carries.
  const picked = castPickCopy(b);
  if (picked && /^play\|/.test(b.dataset.table)) copyText(picked, name(b));
  const [action, id, arg] = b.dataset.table.split('|');
  send({ type: 'cards:action', action, id, arg: castPickArg(b, arg) });
});
root.addEventListener('change', (e) => {
  const sel = e.target;
  if (sel?.matches?.('.castpick select[name="mode"]')) { followCastPick(sel); return; }
  // Who an ongoing card is affecting: typed in the hand window, kept on the sheet; blank clears it.
  if (sel?.dataset?.tableTargets) { send({ type: 'cards:action', action: 'targets', id: sel.dataset.tableTargets, arg: sel.value }); return; }
  if (sel?.dataset?.tableSprings) { send({ type: 'cards:action', action: 'springs', id: sel.dataset.tableSprings, arg: sel.value }); return; }
  if (!sel?.value) return;
  if (sel.dataset.tableMove) send({ type: 'cards:action', action: 'move', id: sel.dataset.tableMove, arg: sel.value });
  else if (sel.dataset.tableRoll) send({ type: 'cards:action', action: 'boost', id: sel.dataset.tableRoll, arg: sel.value });
  else return;
  sel.value = '';
});

/** Copy, or show the text selected when the clipboard refuses. */
let copiedTimer = null;
async function copyText(text, name) {
  let failed = false;
  try { await navigator.clipboard.writeText(text); } catch { failed = true; }
  clearTimeout(copiedTimer);
  copied.innerHTML = '';
  const line = document.createElement('div');
  line.append(failed ? 'The clipboard is not available here — select and copy: ' : 'Copied for Roll20: ');
  const b = document.createElement('b');
  b.textContent = name;
  line.append(b);
  copied.append(line);
  if (failed) {
    const box = document.createElement('textarea');
    box.readOnly = true;
    box.value = text;
    copied.append(box);
    box.focus();
    box.select();
  }
  copied.classList.add('on');
  copiedTimer = setTimeout(() => copied.classList.remove('on'), failed ? 20000 : 5000);
}

/* Plain: the cards alone, for a screen that is being shared. */
plain.addEventListener('click', () => {
  const on = !host.hasAttribute('plain');
  host.toggleAttribute('plain', on);
  plain.setAttribute('aria-pressed', String(on));
});

/* Features: the companion's own sheet, under the cards, for the GM. */
showFeatures.addEventListener('click', () => {
  const on = featHost.hidden;
  featHost.hidden = !on;
  showFeatures.setAttribute('aria-pressed', String(on));
});

if (control) {
  if (!control.id || !control.member || !control.grant) {
    empty.textContent = 'This control link is incomplete. Ask the player for a fresh one from the Squad panel.';
  } else {
    status('connecting to the relay…');
    openSocket();
  }
} else if (channel) {
  what.textContent = 'waiting for the sheet…';
  send({ type: 'cards:hello' });
  window.addEventListener('pagehide', () => { send({ type: 'cards:bye' }); channel.close(); });
} else {
  what.textContent = '';
}
