/**
 * card-window.js -- the card table, or the hand, in a window of its own.
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
 * The one thing done locally is the clipboard: a d20 copies the Roll20 text
 * the button carries, and so does a Cast when the sheet has "Copy for Roll20
 * on cast" switched on. A clipboard write wants a user's gesture in the
 * document doing the writing, and the sheet's document does not have this
 * click -- so the text travels on the button and is copied where it was
 * pressed.
 */
import { SHEET_LINK, adoptSheetStyles } from './styles.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') === 'hand' ? 'hand' : 'table';
const channelName = params.get('ch') || '';

const host = document.getElementById('cards');
const root = host.attachShadow({ mode: 'open' });
adoptSheetStyles(root);
host.setAttribute('scheme', 'dark');

const title = document.getElementById('title');
const what = document.getElementById('what');
const empty = document.getElementById('empty');
const copied = document.getElementById('copied');
const plain = document.getElementById('plain');

/** This window's name on the channel, so the sheet can count its viewers. */
const me = `${view}-${Math.random().toString(36).slice(2, 10)}`;
const channel = channelName && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;

function send(msg) {
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
  if (msg.theme) host.setAttribute('theme', msg.theme);
  host.setAttribute('scheme', msg.scheme === 'light' ? 'light' : 'dark');
  const heading = String(msg.title || 'Card table');
  document.title = heading;
  title.textContent = heading;
  what.textContent = view === 'table' ? 'the table — what everyone may see' : 'your hand — keep this one off the stream';
  empty.hidden = true;
  root.innerHTML = `${SHEET_LINK}<div class="cardwin ${view}">${msg.html || ''}</div>`;
  followHost();
}

/** The sheet has gone: say so, and close if this window was opened by it. */
function sheetGone() {
  root.innerHTML = '';
  empty.hidden = false;
  empty.textContent = 'The sheet that was drawing this window has closed. Open it again from the Cardcasting tab.';
  what.textContent = '';
  if (window.opener) window.close();
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
  if (copy && !copy.disabled) copyText(copy.dataset.copytext, copy.dataset.rollwhat || copy.closest('[data-card]')?.querySelector('.name')?.textContent || 'card');
  if (e.target.closest?.('[data-roll]')) return;   // a d20 copies and does nothing else
  const b = e.target.closest?.('[data-table]');
  if (!b || b.disabled) return;
  const [action, id, arg] = b.dataset.table.split('|');
  send({ type: 'cards:action', action, id, arg });
});
root.addEventListener('change', (e) => {
  const sel = e.target;
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

if (channel) {
  what.textContent = 'waiting for the sheet…';
  send({ type: 'cards:hello' });
  window.addEventListener('pagehide', () => { send({ type: 'cards:bye' }); channel.close(); });
} else {
  what.textContent = '';
}
