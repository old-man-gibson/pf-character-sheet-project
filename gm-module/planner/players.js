// Player view of a session plan, for a second screen or a screen share. It
// shows the timeline: each activity's title, time and players, and its
// required check when "Show checks" is ticked. It reads the plan through the
// same store the planner saves to (stores.js), and only ever as playerView()
// (plan.js) makes it: the server sends nothing more in file mode, and in
// browser mode nothing more is drawn. It asks for changes every second, so the
// view follows the GM's edits as soon as the planner saves them. In browser
// mode it must be open in the same browser as the planner (a second window or
// screen share), since that is where the plan is.
//
// The plan is named in the address (players.html#<plan name>), which the
// planner's Player view link fills in. Without one, the page shows the plan
// last opened in the planner in this browser.

import { clock, minutesText } from './plan.js';
import { openStore } from './stores.js';
import {
  ZOOMS, blockHtml, esc, layout, readPref, rescale, rulerHtml, trackHtml, writePref, zoomPref,
} from './timeline.js';

const POLL_EVERY = 1000;

const $ = sel => document.querySelector(sel);
const el = {
  title: $('#pv-title'), when: $('#pv-when'), showChecks: $('#show-checks'),
  zoomOut: $('#zoom-out'), zoomIn: $('#zoom-in'), live: $('#live'),
  main: $('#main'), wrap: $('#timeline-wrap'), timeline: $('#timeline'),
  missing: $('#missing'), missingText: $('#missing-text'),
};

const S = {
  name: null,   // plan shown
  v: null,      // version of the view shown
  view: null,
  zoom: zoomPref('gm-planner:player-view-zoom'),
  showChecks: readPref('gm-planner:show-checks', false) === true,
};

function planName() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
}

function setLive(text, bad = false) {
  el.live.textContent = text;
  el.live.classList.toggle('bad', bad);
}

function showMissing(text) {
  S.name = null;
  S.view = null;
  el.main.hidden = true;
  el.missing.hidden = false;
  el.missingText.textContent = text;
  document.title = 'Player view';
}

function render() {
  const view = S.view;
  if (!view) return;
  el.main.hidden = false;
  el.missing.hidden = true;
  const title = view.title.trim() || 'Session';
  document.title = title;
  el.title.textContent = title;
  el.when.textContent = view.startsAt
    ? `${clock(0, view.startsAt)}–${clock(view.length, view.startsAt)}`
    : minutesText(view.length);
  el.showChecks.checked = S.showChecks;
  el.zoomOut.disabled = S.zoom === 0;
  el.zoomIn.disabled = S.zoom === ZOOMS.length - 1;

  const L = layout(view, ZOOMS[S.zoom]);
  const lanes = view.players.map(p => {
    const blocks = view.activities
      .filter(a => a.players.includes(p.id))
      .map(a => blockHtml(view, a, p.id, L, { showCheck: S.showChecks }))
      .join('');
    return `<div class="row lane" style="--pc:${esc(p.color)}">
      <div class="who"><span class="pname"><i class="dot"></i><span>${esc(p.name)}</span></span></div>
      ${trackHtml(view, L, blocks)}
    </div>`;
  }).join('');
  el.timeline.innerHTML = rulerHtml(view, L, view.players.length ? 'Players' : '') +
    (lanes || '<p class="empty-lanes">No players yet.</p>');
}

let store = null;
let polling = false;
async function poll() {
  if (polling) return;
  const name = planName() || readPref('gm-planner:last', '');
  if (!name) {
    showMissing('Open this page with the Player view link in the planner.');
    return;
  }
  polling = true;
  try {
    store ??= await openStore();
    const since = S.name === name ? S.v ?? '' : '';
    const out = await store.playerView(name, since);
    if (!out) {
      showMissing(store.kind === 'browser'
        ? `There is no plan named “${name}” in this browser. Open the player view from the planner, in the same browser.`
        : `There is no plan named “${name}”.`);
      setLive('');
      return;
    }
    setLive('Live');
    if (out.same && S.name === name) return;
    if (!planName()) history.replaceState(null, '', `#${encodeURIComponent(name)}`);
    S.name = name;
    S.v = out.v;
    S.view = out.view;
    render();
  } catch {
    setLive('Reconnecting…', true);
  } finally {
    polling = false;
  }
}

el.showChecks.addEventListener('change', () => {
  S.showChecks = el.showChecks.checked;
  writePref('gm-planner:show-checks', S.showChecks);
  render();
});

function zoom(dir) {
  const before = ZOOMS[S.zoom];
  S.zoom = Math.min(ZOOMS.length - 1, Math.max(0, S.zoom + dir));
  writePref('gm-planner:player-view-zoom', S.zoom);
  rescale(el.wrap, before, ZOOMS[S.zoom], render);
}
el.zoomOut.addEventListener('click', () => zoom(-1));
el.zoomIn.addEventListener('click', () => zoom(1));

addEventListener('hashchange', poll);
poll();
setInterval(poll, POLL_EVERY);
