// Session planner page. Draws the plan as one lane per player along a time
// ruler, the unscheduled activities in a tray below, and a side panel with
// the selected activity's editor or the plan's NPCs. Every change goes through plan.js (which refuses to put
// a player in two activities at once), is kept for undo, and is saved to the
// plan file through the planner server. The page re-reads the file when it
// changes on disk, so the file can also be edited by hand while it is open.
//
// Rendering is a wholesale rebuild of each part (same as the session screen),
// with the focused control put back afterwards; a drag draws only its preview.

import {
  SNAPS, addActivity, addNpc, addPlayer, allClashes, checkNames, clashText, clashes, clock,
  deleteActivity, duplicateActivity, end, firstFree, ladder, minutesText, newId, npcActivities,
  npcClashes, npcName, outcome, playerLoad, playerName, removeNpc, removePlayer, snapTo, span,
  updateActivity, whole,
} from './plan.js';
import {
  ROOM, ZOOMS, blockHtml, esc, layout, readPref, rescale, rulerHtml, trackHtml, writePref, zoomPref,
} from './timeline.js';

const $ = sel => document.querySelector(sel);
const attrSel = (name, value) => `[${name}="${CSS.escape(value)}"]`;

const UNDO_LIMIT = 100;
const SAVE_DELAY = 400;
const POLL_EVERY = 2000;

const el = {
  planSelect: $('#plan-select'), newPlan: $('#new-plan'), newPlanForm: $('#new-plan-form'),
  title: $('#title'), startsAt: $('#starts-at'), length: $('#length'), snap: $('#snap'),
  zoomOut: $('#zoom-out'), zoomIn: $('#zoom-in'), undo: $('#undo'), saveState: $('#save-state'),
  clashNote: $('#clash-note'), wrap: $('#timeline-wrap'), timeline: $('#timeline'),
  tray: $('#tray'), editor: $('#editor'), checks: $('#checks'), tip: $('#drag-tip'),
  notice: $('#notice'), offline: $('#offline'), main: $('#main'), playerLink: $('#player-link'),
  npcs: $('#npcs'),
};

const S = {
  name: null,          // plan file name
  v: null,             // version of the file this page last read or wrote
  plan: null,
  plans: [],           // [{ name, title }] in the folder
  selected: null,      // id of the activity open in the editor
  npcPanel: null,      // with no activity open: 'list' for the NPC list, or an NPC's id
  editingPlayer: null, // id of the player whose name cell is a form
  testRoll: '',        // the editor's "test a result" box
  zoom: zoomPref('planner-zoom'),
  undo: [],
};

const ppm = () => ZOOMS[S.zoom];
const find = id => S.plan?.activities.find(a => a.id === id) ?? null;
const selectedActivity = () => find(S.selected);
const findNpc = id => S.plan?.npcs.find(n => n.id === id) ?? null;
const openNpc = () => findNpc(S.npcPanel);

// After an undo or a reload, an open NPC that is gone falls back to the list.
function settlePanels() {
  if (!find(S.selected)) S.selected = null;
  if (S.npcPanel && S.npcPanel !== 'list' && !openNpc()) S.npcPanel = 'list';
  if (!S.plan.players.some(p => p.id === S.editingPlayer)) S.editingPlayer = null;
}

// ---- Messages --------------------------------------------------------------

let noticeTimer = 0;
function notice(message, kind = '') {
  el.notice.textContent = message;
  el.notice.className = `notice ${kind}`;
  el.notice.hidden = !message;
  clearTimeout(noticeTimer);
  if (message) noticeTimer = setTimeout(() => { el.notice.hidden = true; }, kind === 'warn' ? 7000 : 4000);
}

function setSaveState(text, bad = false) {
  el.saveState.textContent = text;
  el.saveState.classList.toggle('bad', bad);
}

// ---- Undo ------------------------------------------------------------------

function keepUndo(snapshot) {
  S.undo.push(snapshot);
  if (S.undo.length > UNDO_LIMIT) S.undo.shift();
  el.undo.disabled = false;
}

// Typing keeps one undo step per visit to a field, not one per key: the plan
// as it was when the field took focus is kept on the first change.
let typingBefore = null;
document.addEventListener('focusin', e => {
  typingBefore = S.plan && e.target.matches('input, textarea') ? JSON.stringify(S.plan) : null;
});
const rebaseTyping = () => { if (typingBefore !== null) typingBefore = JSON.stringify(S.plan); };

function typed(fn) {
  fn(S.plan);
  if (typingBefore !== null) { keepUndo(typingBefore); typingBefore = null; }
  changed();
}

// Runs `fn` on the plan and keeps the plan as it was for undo when anything
// changed. `fn` may return an updateActivity result: a refused change is
// reported and changes nothing.
function edit(fn) {
  const before = JSON.stringify(S.plan);
  const out = fn(S.plan);
  if (out && out.ok === false) {
    if (out.clashes?.length) notice(clashText(S.plan, out.clashes), 'warn');
    return out;
  }
  if (JSON.stringify(S.plan) !== before) {
    keepUndo(before);
    rebaseTyping();
    changed();
  }
  return out ?? { ok: true };
}

function undo() {
  const prev = S.undo.pop();
  el.undo.disabled = !S.undo.length;
  if (!prev) return;
  S.plan = JSON.parse(prev);
  settlePanels();
  rebaseTyping();
  changed();
  renderAll();
  notice('Undone.');
}

// ---- Saving and loading ----------------------------------------------------

let saveTimer = 0;
let saving = false;
let dirty = false;

function changed() {
  dirty = true;
  setSaveState('Unsaved');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY);
}

const planUrl = (name, extra = '') => `/api/plan?name=${encodeURIComponent(name)}${extra}`;

async function save() {
  clearTimeout(saveTimer);
  if (!dirty || !S.name) return;
  if (saving) { saveTimer = setTimeout(save, 150); return; }
  saving = true;
  dirty = false;
  setSaveState('Saving…');
  const name = S.name;
  try {
    const res = await fetch(planUrl(name), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base: S.v, plan: S.plan }),
    });
    const out = await res.json();
    if (name !== S.name) return;
    if (res.ok) {
      S.v = out.v;
      setSaveState(dirty ? 'Unsaved' : 'Saved');
    } else if (res.status === 409 && out.plan) {
      // The file changed on disk since this page read it. Take that copy and
      // keep this page's for undo.
      keepUndo(JSON.stringify(S.plan));
      takePlan(out.plan, out.v);
      dirty = false;
      setSaveState('Saved');
      notice('The plan file was changed outside this page, so it was loaded again. Undo puts back the version from this page.', 'warn');
    } else if (res.status === 409) {
      S.v = null; // the file is gone: write it again
      dirty = true;
      saveTimer = setTimeout(save, 0);
    } else {
      throw new Error(out.error || res.statusText);
    }
  } catch (err) {
    dirty = true;
    setSaveState(`Not saved: ${err.message}. Retrying.`, true);
    saveTimer = setTimeout(save, 3000);
  } finally {
    saving = false;
  }
}

async function flush() {
  clearTimeout(saveTimer);
  while (saving) await new Promise(r => setTimeout(r, 50));
  if (dirty) await save();
}

function takePlan(plan, v) {
  S.plan = plan;
  S.v = v;
  settlePanels();
  rebaseTyping();
  renderAll();
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || res.statusText), { status: res.status });
  return out;
}

async function refreshPlanList() {
  const out = await api('/api/plans');
  S.plans = out.plans;
  renderPlanSelect();
  return out.plans;
}

async function openPlan(name, loaded = null) {
  await flush();
  const out = loaded ?? await api(planUrl(name));
  S.name = name;
  S.v = out.v;
  S.plan = out.plan;
  S.selected = null;
  S.npcPanel = null;
  S.editingPlayer = null;
  S.undo = [];
  el.undo.disabled = true;
  dirty = false;
  setSaveState('Saved');
  writePref('planner-last', name);
  history.replaceState(null, '', `#${encodeURIComponent(name)}`);
  renderAll();
}

// A new plan starts with the open plan's players and NPCs: most sessions have
// the same table and many of the same people.
async function createPlan(name, title) {
  const out = await api('/api/plans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, title, players: S.plan?.players ?? [], npcs: S.plan?.npcs ?? [] }),
  });
  await refreshPlanList();
  await openPlan(name, out);
}

// Picks up changes made to the file outside this page, unless this page has
// changes of its own waiting or the GM is in the middle of something.
async function poll() {
  if (!S.name || saving || dirty || drag || document.activeElement?.matches('input, textarea')) return;
  try {
    const res = await fetch(planUrl(S.name, `&since=${encodeURIComponent(S.v ?? '')}`));
    if (!res.ok) return;
    const out = await res.json();
    if (out.same || out.name !== S.name || saving || dirty || drag) return;
    keepUndo(JSON.stringify(S.plan));
    takePlan(out.plan, out.v);
    notice('Loaded a change made to the plan file.');
  } catch { /* server restarting: try again next time */ }
}

// ---- Rendering ---------------------------------------------------------------

// Rebuilds `container` with `render` and puts focus (and the caret) back on
// the control with the same data-key.
function keepFocus(container, render) {
  const active = document.activeElement;
  const key = container.contains(active) ? active.dataset.key : null;
  let range = null;
  try { range = key && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null; } catch { /* number inputs have no caret */ }
  render();
  if (!key) return;
  const again = container.querySelector(attrSel('data-key', key));
  if (!again) return;
  again.focus({ preventScroll: true });
  try { if (range) again.setSelectionRange(...range); } catch { /* not a text field */ }
}

function renderAll() {
  renderBar();
  renderTimeline();
  renderTray();
  renderEditor();
}

function renderPlanSelect() {
  const names = S.plans.map(p => p.name);
  if (S.name && !names.includes(S.name)) names.push(S.name);
  el.planSelect.innerHTML = names.map(n => `<option value="${esc(n)}"${n === S.name ? ' selected' : ''}>${esc(n)}</option>`).join('');
}

function renderBar() {
  const plan = S.plan;
  renderPlanSelect();
  const set = (input, value) => { if (document.activeElement !== input) input.value = value; };
  set(el.title, plan.title);
  set(el.startsAt, plan.startsAt);
  set(el.length, plan.length);
  el.snap.innerHTML = SNAPS.map(s => `<option value="${s}"${s === plan.snap ? ' selected' : ''}>${s}</option>`).join('');
  el.zoomOut.disabled = S.zoom === 0;
  el.zoomIn.disabled = S.zoom === ZOOMS.length - 1;
  el.undo.disabled = !S.undo.length;
  el.playerLink.href = `players.html#${encodeURIComponent(S.name)}`;
  el.npcs.textContent = plan.npcs.length ? `NPCs (${plan.npcs.length})` : 'NPCs';
  el.npcs.setAttribute('aria-pressed', String(!S.selected && !!S.npcPanel));
  document.title = `${plan.title.trim() || S.name} · Session Planner`;
}

function whoHtml(p, i) {
  const plan = S.plan;
  if (p.id === S.editingPlayer) {
    return `<div class="who editing">
      <input class="p-name" data-pf="name" data-player="${esc(p.id)}" data-key="pf:name:${esc(p.id)}" value="${esc(p.name)}"
             placeholder="Player ${i + 1}" aria-label="Player name">
      <input type="color" data-pf="color" data-player="${esc(p.id)}" data-key="pf:color:${esc(p.id)}" value="${esc(p.color)}" aria-label="Colour">
      <button type="button" data-act="player-done" data-key="pf:done:${esc(p.id)}">Done</button>
      <button type="button" class="danger" data-act="remove-player" data-player="${esc(p.id)}">Remove</button>
    </div>`;
  }
  const load = playerLoad(plan, p.id);
  return `<div class="who">
    <button type="button" class="pname" data-act="edit-player" data-player="${esc(p.id)}" data-key="pn:${esc(p.id)}"
            aria-label="${esc(playerName(plan, p.id))}: rename, recolour or remove" title="Rename, recolour or remove"><i class="dot"></i><span>${esc(playerName(plan, p.id))}</span></button>
    <span class="load" title="Time in scheduled activities">${load ? esc(minutesText(load)) : ''}</span>
  </div>`;
}

function renderTimeline() {
  const plan = S.plan;
  const L = layout(plan, ppm());
  const clashing = new Set(allClashes(plan).flatMap(c => [c.a.id, c.b.id]));
  // With an NPC open, the activities it is linked to stand out.
  const npc = !S.selected && openNpc();
  const marked = new Set(npc ? npcActivities(plan, npc.id).map(a => a.id) : []);

  const lanes = plan.players.map((p, i) => {
    const blocks = plan.activities
      .filter(a => a.start != null && a.players.includes(p.id))
      .map(a => blockHtml(plan, a, p.id, L, {
        selected: a.id === S.selected, clash: clashing.has(a.id), marked: marked.has(a.id), editable: true,
      }))
      .join('');
    return `<div class="row lane" data-player="${esc(p.id)}" style="--pc:${esc(p.color)}">
      ${whoHtml(p, i)}
      ${trackHtml(plan, L, blocks)}
    </div>`;
  }).join('');

  keepFocus(el.timeline, () => {
    el.timeline.innerHTML = `
      ${rulerHtml(plan, L, plan.players.length ? 'Players' : '')}
      ${lanes || '<p class="empty-lanes">Add a player to get a lane on the timeline.</p>'}
      <div class="row add-row"><div class="who"><button type="button" data-act="add-player" data-key="add-player">Add player</button></div></div>`;
  });

  const found = allClashes(plan);
  el.clashNote.hidden = !found.length;
  el.clashNote.textContent = found.length
    ? 'Booked twice: ' + found.slice(0, 3).map(c => `${playerName(plan, c.player)} in “${c.a.title || 'Untitled'}” and “${c.b.title || 'Untitled'}”`).join('; ') +
      (found.length > 3 ? ` and ${found.length - 3} more` : '') + '. Move one of each pair.'
    : '';
}

function renderTray() {
  const waiting = S.plan.activities.filter(a => a.start == null);
  keepFocus(el.tray, () => {
    el.tray.innerHTML = `
      <header class="tray-head">
        <h2>Unscheduled <span class="count">${waiting.length || ''}</span></h2>
        <button type="button" data-act="new-activity" data-key="new-activity">New activity</button>
      </header>
      <div class="tray-items">
        ${waiting.map(a => blockHtml(S.plan, a, null, layout(S.plan, ppm()), { selected: a.id === S.selected, editable: true })).join('') || '<p class="empty">Drop a block here to take it off the timeline.</p>'}
      </div>
      <p class="hint">Drag a block to move it, or onto another player's lane to hand it to them. Drag its right edge to change how long it takes. Double-click a lane to add an activity there. Click a block to edit it.</p>`;
  });
  el.checks.innerHTML = checkNames(S.plan).map(c => `<option value="${esc(c)}"></option>`).join('');
}

function tierHtml(t) {
  const k = esc(t.id);
  return `<div class="tier" data-tier="${k}">
    <input data-tf="label" data-key="tier:${k}:label" value="${esc(t.label)}" placeholder="Tier name" aria-label="Tier name">
    <input type="number" data-tf="dc" data-key="tier:${k}:dc" value="${t.dc ?? ''}" placeholder="DC" aria-label="Tier DC">
    <button type="button" class="icon" data-act="remove-tier" aria-label="Remove tier">×</button>
    <textarea data-tf="reward" data-key="tier:${k}:reward" rows="2" placeholder="Reward" aria-label="Tier reward">${esc(t.reward)}</textarea>
  </div>`;
}

// The side panel: the open activity's editor, or else the NPC list or an NPC.
function renderEditor() {
  const a = selectedActivity();
  const npcs = !a && (S.npcPanel === 'list' || !!openNpc());
  el.editor.hidden = !a && !npcs;
  el.editor.setAttribute('aria-label', a ? 'Activity' : 'NPCs');
  if (a) renderActivityEditor(a);
  else if (npcs) keepFocus(el.editor, () => { el.editor.innerHTML = openNpc() ? npcEditorHtml(openNpc()) : npcListHtml(); });
  else el.editor.innerHTML = '';
}

const whenText = a => `${clock(a.start, S.plan.startsAt)}–${clock(end(a), S.plan.startsAt)}`;
const titleOf = a => a.title.trim() || 'Untitled';

// NPCs by name, the unnamed last.
const sortedNpcs = plan => [...plan.npcs].sort((x, y) =>
  (!x.name.trim() - !y.name.trim()) || x.name.localeCompare(y.name));

// Activities scheduled first, in time order, then the unscheduled ones.
const byTime = list => [...list].sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity));

// The activity editor's NPC links: a chip per NPC (its name opens it), a note
// when one of them is linked to another activity at the same time, and a list
// to link another or a new one.
function activityNpcsHtml(a) {
  const plan = S.plan;
  const found = npcClashes(plan, a);
  const chips = a.npcs.map(id => {
    const role = findNpc(id)?.role.trim();
    return `<span class="nchip${found.some(c => c.npc === id) ? ' warn' : ''}">
      <button type="button" data-act="open-npc" data-npc="${esc(id)}" data-key="en:${esc(id)}"
              title="${esc(role || 'Open this NPC')}">${esc(npcName(plan, id))}</button>
      <button type="button" class="icon" data-act="unlink-npc" data-npc="${esc(id)}" aria-label="Unlink ${esc(npcName(plan, id))}">×</button>
    </span>`;
  }).join('');
  const warn = found.map(c => `${npcName(plan, c.npc)} is also in “${titleOf(c.activity)}” (${whenText(c.activity)}).`).join(' ');
  const others = sortedNpcs(plan).filter(n => !a.npcs.includes(n.id));
  return `<section class="ed-npcs">
    <h3>NPCs</h3>
    ${chips ? `<div class="nchips">${chips}</div>` : ''}
    ${warn ? `<p class="warn-line small">${esc(warn)}</p>` : ''}
    <select id="link-npc" data-key="link-npc" aria-label="Link an NPC">
      <option value="">Link an NPC…</option>
      ${others.map(n => `<option value="${esc(n.id)}">${esc(npcName(plan, n.id))}${n.role.trim() ? ` · ${esc(n.role.trim())}` : ''}</option>`).join('')}
      <option value="" data-new="1">New NPC…</option>
    </select>
  </section>`;
}

function npcListHtml() {
  const plan = S.plan;
  const rows = sortedNpcs(plan).map(n => {
    const count = npcActivities(plan, n.id).length;
    return `<li><button type="button" class="npc-row" data-act="open-npc" data-npc="${esc(n.id)}" data-key="nl:${esc(n.id)}">
      <span class="npc-name">${esc(npcName(plan, n.id))}</span>
      <span class="npc-count">${count ? `${count} ${count === 1 ? 'activity' : 'activities'}` : 'No activities'}</span>
      ${n.role.trim() ? `<span class="npc-role">${esc(n.role.trim())}</span>` : ''}
    </button></li>`;
  }).join('');
  return `<div class="ed-head">
      <h2 class="ed-heading">NPCs</h2>
      <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
    </div>
    <button type="button" class="align-start" data-act="new-npc" data-key="new-npc">New NPC</button>
    ${rows ? `<ul class="npc-list">${rows}</ul>`
      : '<p class="dim">No NPCs yet. Add the people the players may meet, then link them to activities here or from an activity.</p>'}`;
}

function npcEditorHtml(n) {
  const plan = S.plan;
  const linked = npcActivities(plan, n.id);
  const busy = new Set(linked.filter(a => npcClashes(plan, a).some(c => c.npc === n.id)).map(a => a.id));
  const rows = linked.map(a => `<li class="${busy.has(a.id) ? 'warn' : ''}">
      <button type="button" class="npc-act" data-act="open-activity" data-id="${esc(a.id)}" data-key="na:${esc(a.id)}">${esc(titleOf(a))}</button>
      <span class="dim small">${esc(a.start == null ? 'Unscheduled' : whenText(a))}</span>
      <button type="button" class="icon" data-act="unlink-activity" data-id="${esc(a.id)}" aria-label="Unlink ${esc(titleOf(a))}">×</button>
    </li>`).join('');
  const others = byTime(plan.activities.filter(a => !a.npcs.includes(n.id)));
  return `<div class="ed-head">
      <input class="ed-title" data-nf="name" data-key="nf:name" value="${esc(n.name)}" placeholder="NPC name" aria-label="NPC name">
      <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
    </div>
    <button type="button" class="back" data-act="npc-list" data-key="npc-list">‹ All NPCs</button>
    <label class="field">Role <input data-nf="role" data-key="nf:role" value="${esc(n.role)}" placeholder="Who they are, in a few words"></label>
    <label class="field">Description
      <textarea data-nf="description" data-key="nf:description" rows="3" placeholder="Appearance and manner">${esc(n.description)}</textarea></label>
    <label class="field">Notes
      <textarea data-nf="notes" data-key="nf:notes" rows="5" placeholder="What they want, what they know">${esc(n.notes)}</textarea></label>
    <section class="ed-npc-acts">
      <h3>Activities</h3>
      ${rows ? `<ul class="npc-acts">${rows}</ul>` : '<p class="dim small">Not linked to an activity yet.</p>'}
      ${busy.size ? '<p class="warn-line small">The marked activities overlap: this NPC is linked to both at the same time.</p>' : ''}
      ${others.length ? `<select id="link-activity" data-key="link-activity" aria-label="Link to an activity">
        <option value="">Link to an activity…</option>
        ${others.map(a => `<option value="${esc(a.id)}">${esc(titleOf(a))} · ${esc(a.start == null ? 'unscheduled' : whenText(a))}</option>`).join('')}
      </select>` : ''}
    </section>
    <div class="ed-foot"><span></span><button type="button" class="danger" data-act="delete-npc" data-key="delete-npc">Delete NPC</button></div>`;
}

function renderActivityEditor(a) {
  const plan = S.plan;
  const when = a.start == null
    ? 'Not on the timeline yet.'
    : `${clock(a.start, plan.startsAt)}–${clock(end(a), plan.startsAt)} (${minutesText(a.duration)})`;
  const players = plan.players.map(p => `
    <label class="pchip" style="--pc:${esc(p.color)}">
      <input type="checkbox" data-player="${esc(p.id)}" data-key="ep:${esc(p.id)}" aria-label="${esc(playerName(plan, p.id))}"${a.players.includes(p.id) ? ' checked' : ''}>
      ${esc(playerName(plan, p.id))}
    </label>`).join('');
  keepFocus(el.editor, () => {
    el.editor.innerHTML = `
      <div class="ed-head">
        <input class="ed-title" data-f="title" data-key="f:title" value="${esc(a.title)}" placeholder="Activity name" aria-label="Activity name">
        <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
      </div>
      <fieldset><legend>Players</legend>${players || '<p class="dim">Add players first.</p>'}</fieldset>
      ${activityNpcsHtml(a)}
      <div class="ed-when">
        <label>Start<span class="unit"><input type="number" data-f="start" data-key="f:start" aria-label="Start, minutes from the start of the session" min="0" step="${plan.snap}"
          value="${a.start ?? ''}"${a.start == null ? ' disabled' : ''}> min</span></label>
        <label>Duration<span class="unit"><input type="number" data-f="duration" data-key="f:duration" aria-label="Duration in minutes" min="1" step="${plan.snap}"
          value="${a.duration}"> min</span></label>
        ${a.start == null
          ? '<button type="button" data-act="schedule" data-key="schedule">Put on timeline</button>'
          : '<button type="button" data-act="unschedule" data-key="unschedule">Move to tray</button>'}
        <p class="ed-time">${esc(when)}</p>
      </div>
      <label class="field">Premise
        <textarea data-f="premise" data-key="f:premise" rows="4" placeholder="What the player wants to do, and what stands in the way">${esc(a.premise)}</textarea></label>
      <div class="ed-check">
        <label class="field grow">Required check <input data-f="check" data-key="f:check" aria-label="Required check" list="checks" value="${esc(a.check)}" placeholder="Skill or ability"></label>
        <label class="field dc">DC <input type="number" data-f="dc" data-key="f:dc" aria-label="DC" value="${a.dc ?? ''}"></label>
      </div>
      <label class="field">On success
        <textarea data-f="success" data-key="f:success" rows="2" placeholder="Reward for meeting the DC">${esc(a.success)}</textarea></label>
      <section class="ed-tiers">
        <h3>Further success tiers</h3>
        <p class="dim small">Each tier has its own DC and reward. A result earns the highest tier whose DC it meets.</p>
        ${a.tiers.map(tierHtml).join('')}
        <button type="button" data-act="add-tier" data-key="add-tier">Add tier</button>
      </section>
      <label class="field">On failure
        <textarea data-f="failure" data-key="f:failure" rows="2" placeholder="What happens below every DC">${esc(a.failure)}</textarea></label>
      <section class="ed-test">
        <h3>Outcomes</h3>
        <label class="field">Test a result <input type="number" id="test-roll" data-key="test" value="${esc(S.testRoll)}" placeholder="Check total"></label>
        <div id="test-out"></div>
      </section>
      <div class="ed-foot">
        <button type="button" data-act="duplicate" data-key="duplicate">Duplicate</button>
        <button type="button" class="danger" data-act="delete" data-key="delete">Delete</button>
      </div>`;
  });
  renderOutcomes();
}

// The editor's ladder: failure, success and each tier with its reward, the
// tested result's step marked.
function renderOutcomes() {
  const box = $('#test-out');
  const a = selectedActivity();
  if (!box || !a) return;
  const steps = ladder(a);
  if (!steps.length) { box.innerHTML = '<p class="dim small">Set a DC to see the outcomes.</p>'; return; }
  const total = S.testRoll === '' ? NaN : Number(S.testRoll);
  const r = outcome(a, total);
  const row = (cls, dc, name, reward, hit) => `<li class="${cls}${hit ? ' hit' : ''}"><span class="l-dc">${esc(dc)}</span>
    <span class="l-name">${esc(name)}</span>${reward.trim() ? `<span class="l-reward">${esc(reward)}</span>` : ''}</li>`;
  let line = '';
  if (r) {
    line = r.failure
      ? `${total} fails: it needs ${r.next.dc} for ${r.next.label}.`
      : `${total} reaches ${r.tier.label} (DC ${r.tier.dc}).` + (r.next ? ` ${r.next.dc - total} more for ${r.next.label} (DC ${r.next.dc}).` : '');
  }
  box.innerHTML = `<ol class="ladder">
      ${row('fail', `below ${steps[0].dc}`, 'Failure', a.failure, r?.failure)}
      ${steps.map(t => row('', `DC ${t.dc}`, t.label, t.reward, r && !r.failure && r.tier.id === t.id)).join('')}
    </ol>${line ? `<p class="test-line">${esc(line)}</p>` : ''}`;
}

// ---- Selecting and editing ---------------------------------------------------

function select(id) {
  if (S.selected !== id) S.testRoll = '';
  S.selected = id;
  S.npcPanel = null;
  renderBar();
  renderTimeline();
  renderTray();
  renderEditor();
}

// Opens the side panel on the NPC list ('list') or on one NPC (its id).
function showNpcs(panel) {
  S.selected = null;
  S.testRoll = '';
  S.npcPanel = panel;
  renderBar();
  renderTimeline();
  renderTray();
  renderEditor();
}

function closePanel() {
  S.npcPanel = null;
  select(null);
}

function newNpc(link = null) {
  let id = null;
  edit(plan => {
    id = addNpc(plan).id;
    if (link) updateActivity(plan, link.id, { npcs: [...link.npcs, id] });
  });
  showNpcs(id);
  el.editor.querySelector('[data-nf="name"]')?.focus();
}

function setStart(id, start) {
  const out = edit(plan => updateActivity(plan, id, { start }));
  renderAll();
  return out;
}

function schedule(id) {
  const a = find(id);
  if (!a.players.length) { notice('Pick at least one player first.', 'warn'); return; }
  setStart(id, firstFree(S.plan, a, 0));
}

function newActivityAt(player, minutes) {
  const plan = S.plan;
  const out = edit(p => addActivity(p, { start: Math.max(0, minutes), players: [player], duration: Math.max(plan.snap, 10) }));
  if (!out.ok) return;
  select(out.activity.id);
  const title = el.editor.querySelector('[data-f="title"]');
  title?.focus();
  title?.select();
}

function newActivity() {
  const out = edit(p => addActivity(p, {}));
  select(out.activity.id);
  const title = el.editor.querySelector('[data-f="title"]');
  title?.focus();
  title?.select();
}

function removeActivity(id) {
  const a = find(id);
  edit(plan => deleteActivity(plan, id));
  if (S.selected === id) S.selected = null;
  renderAll();
  notice(`Deleted “${a.title.trim() || 'Untitled'}”. Undo brings it back.`);
}

// The lane above or below `player` (dir -1 / +1), or null at either end.
function laneBeside(player, dir) {
  const i = S.plan.players.findIndex(p => p.id === player);
  return S.plan.players[i + dir]?.id ?? null;
}

// Moves the copy of an activity in lane `from` to lane `to`.
function swapPlayers(a, from, to) {
  if (a.players.includes(to)) return null;
  return a.players.map(p => (p === from ? to : p));
}

// ---- Dragging -----------------------------------------------------------------
//
// Pointer events on blocks: a press that moves less than a few pixels is a
// click and opens the editor. A drag shows where the activity would land in
// each of its players' lanes, green when it fits and red when a player is
// busy then; letting go over a red spot puts it back. Dragging a block onto
// another lane hands that copy to the lane's player; onto the tray takes it
// off the timeline. The grip at a block's right edge changes its duration.

let drag = null;

function trackLeft() {
  const track = el.timeline.querySelector('.lane .track') ?? el.timeline.querySelector('.ruler .track');
  return track.getBoundingClientRect().left;
}
const minuteAt = clientX => (clientX - trackLeft()) / ppm();

function startDrag(e) {
  const block = e.target.closest('.block');
  if (!block || e.button !== 0) return;
  const a = find(block.dataset.id);
  if (!a) return;
  e.preventDefault();
  block.focus({ preventScroll: true });
  const mode = e.target.closest('[data-grip]') ? 'resize' : 'move';
  drag = {
    id: a.id, mode, block, pointerId: e.pointerId,
    lane: block.dataset.lane || null,
    x0: e.clientX, y0: e.clientY,
    grab: a.start != null ? minuteAt(e.clientX) - a.start : 0,
    rect: block.getBoundingClientRect(),
    moved: false, cand: null, ok: false, why: '', ghost: null, last: e,
  };
  block.setPointerCapture(e.pointerId);
}

function beginMoving() {
  drag.moved = true;
  document.body.classList.add(drag.mode === 'resize' ? 'resizing' : 'dragging');
  if (drag.mode === 'move') {
    for (const b of document.querySelectorAll(`.block${attrSel('data-id', drag.id)}`)) b.classList.add('src');
    const ghost = drag.block.cloneNode(true);
    ghost.classList.add('ghost');
    ghost.classList.remove('src', 'selected');
    Object.assign(ghost.style, { left: `${drag.rect.left}px`, top: `${drag.rect.top}px`, width: `${drag.rect.width}px`, height: `${drag.rect.height}px` });
    document.body.append(ghost);
    drag.ghost = ghost;
  }
}

// Where the activity would go for the pointer at (x, y): the candidate, why it
// cannot go there (if it cannot), and a note on any change to who is in it.
function candidateAt(x, y) {
  const plan = S.plan;
  const a = find(drag.id);
  const step = plan.snap;
  const limit = span(plan) + ROOM;
  if (drag.mode === 'resize') {
    const duration = Math.max(step, snapTo(minuteAt(x) - a.start, step));
    return { cand: { ...a, duration: Math.min(duration, limit - a.start) } };
  }
  const hit = document.elementFromPoint(x, y);
  if (hit?.closest('#tray')) return { cand: { ...a, start: null } };
  const lane = hit?.closest('.lane')?.dataset.player;
  if (!lane) return { cand: null };
  let players = a.players;
  let note = '';
  if (drag.lane && lane !== drag.lane) {
    players = swapPlayers(a, drag.lane, lane);
    if (!players) return { cand: null, why: `${playerName(plan, lane)} is already in this activity.` };
    note = `${playerName(plan, drag.lane)} → ${playerName(plan, lane)}`;
  } else if (!drag.lane && !players.includes(lane)) {
    players = [...players, lane];
    if (a.players.length) note = `adds ${playerName(plan, lane)}`;
  }
  const start = Math.min(Math.max(0, snapTo(minuteAt(x) - drag.grab, step)), Math.max(0, limit - a.duration));
  return { cand: { ...a, start, players }, note };
}

function drawPreview() {
  for (const p of el.timeline.querySelectorAll('.preview')) p.remove();
  const { cand, ok } = drag;
  el.tray.classList.toggle('drop', !!cand && cand.start == null);
  if (!cand || cand.start == null) return;
  for (const player of cand.players) {
    const track = el.timeline.querySelector(`.lane${attrSel('data-player', player)} .track`);
    if (!track) continue;
    const box = document.createElement('div');
    box.className = `preview${ok ? '' : ' bad'}`;
    box.style.left = `${cand.start * ppm()}px`;
    box.style.width = `${cand.duration * ppm()}px`;
    track.append(box);
  }
}

function showTip(x, y, text, bad) {
  el.tip.hidden = !text;
  el.tip.textContent = text;
  el.tip.classList.toggle('bad', bad);
  el.tip.style.left = `${Math.min(x + 14, innerWidth - 350)}px`;
  el.tip.style.top = `${y + 18}px`;
}

function dragTo(e) {
  drag.last = e;
  if (drag.ghost) {
    drag.ghost.style.transform = `translate(${e.clientX - drag.x0}px, ${e.clientY - drag.y0}px)`;
  }
  const plan = S.plan;
  const { cand, why = '', note = '' } = candidateAt(e.clientX, e.clientY);
  const found = cand && cand.start != null ? clashes(plan, cand) : [];
  drag.cand = cand;
  drag.ok = !!cand && !found.length;
  drag.why = why || (found.length ? clashText(plan, found) : '');
  drawPreview();
  const where = cand
    ? cand.start == null
      ? 'Take off the timeline'
      : [`${clock(cand.start, plan.startsAt)}–${clock(end(cand), plan.startsAt)}`, minutesText(cand.duration), note].filter(Boolean).join(' · ')
    : '';
  showTip(e.clientX, e.clientY, drag.why || where, !!drag.why);
}

// Scrolls the timeline while a drag is held near its left or right edge.
let edgeTimer = 0;
function edgeScroll() {
  clearInterval(edgeTimer);
  if (!drag?.moved) return;
  const r = el.wrap.getBoundingClientRect();
  const x = drag.last.clientX;
  const left = r.left + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--who-w'));
  const speed = x < left + 30 ? -12 : x > r.right - 30 ? 12 : 0;
  if (!speed || drag.last.clientY < r.top || drag.last.clientY > r.bottom) return;
  edgeTimer = setInterval(() => {
    if (!drag) return clearInterval(edgeTimer);
    el.wrap.scrollLeft += speed;
    dragTo(drag.last);
  }, 30);
}

function finishDrag(e, cancelled = false) {
  if (!drag || (e && e.pointerId !== drag.pointerId)) return;
  const d = drag;
  drag = null;
  clearInterval(edgeTimer);
  d.ghost?.remove();
  el.tip.hidden = true;
  el.tray.classList.remove('drop');
  document.body.classList.remove('dragging', 'resizing');
  if (!d.moved) {
    if (!cancelled) select(d.id);
    return;
  }
  const before = find(d.id);
  if (!cancelled && d.cand && d.ok) {
    const { start, players, duration } = d.cand;
    edit(plan => updateActivity(plan, d.id, { start, players, duration }));
    notice(start == null && before.start != null
      ? `“${before.title.trim() || 'Untitled'}” is off the timeline. Drag it back or use Put on timeline.`
      : '');
  } else if (!cancelled && d.why) {
    notice(d.why, 'warn');
  }
  renderAll();
}

el.main.addEventListener('pointerdown', startDrag);
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    beginMoving();
  }
  dragTo(e);
  edgeScroll();
});
document.addEventListener('pointerup', e => finishDrag(e));
document.addEventListener('pointercancel', e => finishDrag(e, true));

// Highlight every copy of a shared activity together.
el.timeline.addEventListener('pointerover', e => {
  const block = e.target.closest('.block');
  for (const b of el.timeline.querySelectorAll('.block.linked')) if (b.dataset.id !== block?.dataset.id) b.classList.remove('linked');
  if (block && !drag) for (const b of el.timeline.querySelectorAll(`.block${attrSel('data-id', block.dataset.id)}`)) b.classList.add('linked');
});
el.timeline.addEventListener('pointerleave', () => {
  for (const b of el.timeline.querySelectorAll('.block.linked')) b.classList.remove('linked');
});

el.timeline.addEventListener('dblclick', e => {
  if (e.target.closest('.block')) return;
  const lane = e.target.closest('.lane .track') && e.target.closest('.lane').dataset.player;
  if (!lane) return;
  const at = Math.floor(minuteAt(e.clientX) / S.plan.snap) * S.plan.snap;
  newActivityAt(lane, at);
});

el.timeline.addEventListener('click', e => {
  if (e.target.closest('.lane .track') && !e.target.closest('.block') && S.selected) select(null);
});

// ---- Keyboard ------------------------------------------------------------------

el.main.addEventListener('keydown', e => {
  const block = e.target.closest?.('.block');
  if (!block || e.target !== block) return;
  const a = find(block.dataset.id);
  if (!a) return;
  const lane = block.dataset.lane || null;
  const step = S.plan.snap;
  const focusAfter = (laneId = lane) => {
    const again = el.main.querySelector(`.block${attrSel('data-id', a.id)}${attrSel('data-lane', laneId ?? '')}`);
    again?.focus();
  };
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    select(a.id);
    focusAfter();
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && a.start != null) {
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    const changes = e.shiftKey
      ? { duration: Math.max(step, a.duration + dir * step) }
      : { start: Math.max(0, a.start + dir * step) };
    edit(plan => updateActivity(plan, a.id, changes));
    renderAll();
    focusAfter();
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && lane) {
    e.preventDefault();
    const to = laneBeside(lane, e.key === 'ArrowUp' ? -1 : 1);
    if (!to) return;
    const players = swapPlayers(a, lane, to);
    if (!players) { notice(`${playerName(S.plan, to)} is already in this activity.`, 'warn'); return; }
    const out = edit(plan => updateActivity(plan, a.id, { players }));
    renderAll();
    focusAfter(out.ok ? to : lane);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    removeActivity(a.id);
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && drag) { finishDrag(null, true); renderAll(); return; }
  const inText = e.target.matches?.('input, textarea, select');
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inText) {
    e.preventDefault();
    undo();
  } else if (e.key === 'Escape' && S.editingPlayer) {
    S.editingPlayer = null;
    renderTimeline();
  } else if (e.key === 'Escape' && (S.selected || S.npcPanel) && !inText) {
    closePanel();
  }
});

// ---- Buttons ---------------------------------------------------------------------

document.addEventListener('click', e => {
  const button = e.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  const a = selectedActivity();
  if (act === 'add-player') {
    edit(plan => { S.editingPlayer = addPlayer(plan).id; });
    renderAll();
    el.timeline.querySelector(attrSel('data-key', `pf:name:${S.editingPlayer}`))?.focus();
  } else if (act === 'edit-player') {
    S.editingPlayer = button.dataset.player;
    renderTimeline();
    const input = el.timeline.querySelector(attrSel('data-key', `pf:name:${S.editingPlayer}`));
    input?.focus();
    input?.select();
  } else if (act === 'player-done') {
    S.editingPlayer = null;
    renderTimeline();
  } else if (act === 'remove-player') {
    const id = button.dataset.player;
    const name = playerName(S.plan, id);
    let emptied = [];
    edit(plan => { emptied = removePlayer(plan, id); });
    S.editingPlayer = null;
    renderAll();
    notice(`Removed ${name}.` + (emptied.length ? ` ${emptied.length} ${emptied.length === 1 ? 'activity' : 'activities'} had nobody left and moved to the tray.` : '') + ' Undo brings them back.');
  } else if (act === 'new-activity') {
    newActivity();
  } else if (act === 'close-editor') {
    closePanel();
  } else if (act === 'open-npc') {
    showNpcs(button.dataset.npc);
  } else if (act === 'npc-list') {
    showNpcs('list');
  } else if (act === 'new-npc') {
    newNpc();
  } else if (act === 'open-activity') {
    select(button.dataset.id);
  } else if (act === 'unlink-activity' && openNpc()) {
    const npc = openNpc();
    const target = find(button.dataset.id);
    edit(plan => updateActivity(plan, target.id, { npcs: target.npcs.filter(n => n !== npc.id) }));
    renderAll();
  } else if (act === 'delete-npc' && openNpc()) {
    const npc = openNpc();
    const name = npcName(S.plan, npc.id);
    let linked = [];
    edit(plan => { linked = removeNpc(plan, npc.id); });
    S.npcPanel = 'list';
    renderAll();
    notice(`Deleted ${name}.` + (linked.length ? ` Unlinked from ${linked.length} ${linked.length === 1 ? 'activity' : 'activities'}.` : '') + ' Undo brings them back.');
  } else if (!a) {
    // the rest act on the open activity
  } else if (act === 'schedule') {
    schedule(a.id);
  } else if (act === 'unschedule') {
    setStart(a.id, null);
  } else if (act === 'duplicate') {
    const out = edit(plan => duplicateActivity(plan, a.id));
    select(out.activity.id);
    notice('Duplicated.' + (out.activity.start != null ? ' The copy starts when its players are next free.' : ''));
  } else if (act === 'delete') {
    removeActivity(a.id);
  } else if (act === 'unlink-npc') {
    edit(plan => updateActivity(plan, a.id, { npcs: a.npcs.filter(n => n !== button.dataset.npc) }));
    renderAll();
  } else if (act === 'add-tier') {
    const top = Math.max(-Infinity, a.dc ?? -Infinity, ...a.tiers.map(t => t.dc ?? -Infinity));
    const id = newId(a.tiers, 't');
    edit(() => { a.tiers.push({ id, label: '', dc: Number.isFinite(top) ? top + 5 : null, reward: '' }); });
    renderEditor();
    el.editor.querySelector(attrSel('data-key', `tier:${id}:label`))?.focus();
  } else if (act === 'remove-tier') {
    const id = button.closest('.tier').dataset.tier;
    edit(() => { a.tiers = a.tiers.filter(t => t.id !== id); });
    renderEditor();
    renderTimeline();
  }
});

// ---- Fields ------------------------------------------------------------------------

const TEXT_FIELDS = ['title', 'premise', 'check', 'success', 'failure'];

el.editor.addEventListener('input', e => {
  const t = e.target;
  const npc = openNpc();
  if (t.dataset.nf && npc && !S.selected) {
    typed(() => { npc[t.dataset.nf] = t.value; });
    if (t.dataset.nf === 'name') { renderTimeline(); renderTray(); }
    return;
  }
  const a = selectedActivity();
  if (!a) return;
  if (t.id === 'test-roll') {
    S.testRoll = t.value;
    renderOutcomes();
    return;
  }
  const f = t.dataset.f;
  if (TEXT_FIELDS.includes(f)) typed(() => { a[f] = t.value; });
  else if (f === 'dc') typed(() => { a.dc = whole(t.value, null); });
  else if (t.dataset.tf) {
    const tier = a.tiers.find(x => x.id === t.closest('.tier').dataset.tier);
    const tf = t.dataset.tf;
    typed(() => { tier[tf] = tf === 'dc' ? whole(t.value, null) : t.value; });
  } else return;
  renderTimeline();
  renderTray();
  renderOutcomes();
});

el.editor.addEventListener('change', e => {
  const t = e.target;
  const npc = openNpc();
  if (t.id === 'link-activity' && npc && t.value) {
    const target = find(t.value);
    edit(plan => updateActivity(plan, target.id, { npcs: [...target.npcs, npc.id] }));
    renderAll();
    return;
  }
  const a = selectedActivity();
  if (!a) return;
  if (t.id === 'link-npc') {
    if (t.selectedOptions[0]?.dataset.new) newNpc(a);
    else if (t.value) {
      edit(plan => updateActivity(plan, a.id, { npcs: [...a.npcs, t.value] }));
      renderAll();
    }
  } else if (t.dataset.f === 'start' || t.dataset.f === 'duration') {
    const f = t.dataset.f;
    const value = whole(t.value, a[f], f === 'start' ? 0 : 1);
    edit(plan => updateActivity(plan, a.id, { [f]: value }));
    renderAll();
  } else if (t.type === 'checkbox' && t.dataset.player) {
    const wanted = new Set(a.players);
    if (t.checked) wanted.add(t.dataset.player); else wanted.delete(t.dataset.player);
    const players = S.plan.players.map(p => p.id).filter(id => wanted.has(id));
    const wasOn = a.start != null;
    const out = edit(plan => updateActivity(plan, a.id, { players }));
    renderAll();
    if (out.ok && wasOn && out.activity.start == null) notice('Nobody is left in it, so it moved to the tray.');
  }
});

// A player's name is saved as it is typed. The colour waits for the picker to
// close: redrawing the lane while it is open would take the picker's input away.
el.timeline.addEventListener('input', e => {
  const t = e.target;
  const p = S.plan.players.find(x => x.id === t.dataset.player);
  if (!p || t.dataset.pf !== 'name') return;
  typed(() => { p.name = t.value; });
  renderTimeline();
  renderTray();
  renderEditor();
});
el.timeline.addEventListener('change', e => {
  const t = e.target;
  const p = S.plan.players.find(x => x.id === t.dataset.player);
  if (!p || t.dataset.pf !== 'color') return;
  edit(() => { p.color = t.value; });
  renderAll();
});

el.timeline.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.pf) {
    // Without this the same key press would also click the name button that
    // takes focus next, and open the form again.
    e.preventDefault();
    S.editingPlayer = null;
    renderTimeline();
    el.timeline.querySelector(attrSel('data-key', `pn:${e.target.dataset.player}`))?.focus();
  }
});

el.title.addEventListener('input', () => {
  typed(plan => { plan.title = el.title.value; });
  document.title = `${S.plan.title.trim() || S.name} · Session Planner`;
});
el.startsAt.addEventListener('change', () => {
  edit(plan => { plan.startsAt = el.startsAt.value; });
  renderAll();
});
el.length.addEventListener('change', () => {
  edit(plan => { plan.length = whole(el.length.value, plan.length, 1); });
  renderAll();
});
el.snap.addEventListener('change', () => {
  edit(plan => { plan.snap = Number(el.snap.value); });
  renderAll();
});

function zoom(dir) {
  const before = ppm();
  S.zoom = Math.min(ZOOMS.length - 1, Math.max(0, S.zoom + dir));
  writePref('planner-zoom', S.zoom);
  rescale(el.wrap, before, ppm(), () => {
    renderBar();
    renderTimeline();
    renderTray();
  });
}
el.zoomOut.addEventListener('click', () => zoom(-1));
el.zoomIn.addEventListener('click', () => zoom(1));
el.undo.addEventListener('click', undo);
el.npcs.addEventListener('click', () => {
  if (!S.selected && S.npcPanel) closePanel();
  else showNpcs('list');
});

// ---- Plan files ----------------------------------------------------------------------

el.planSelect.addEventListener('change', () => {
  openPlan(el.planSelect.value).catch(err => notice(`Could not open that plan: ${err.message}`, 'warn'));
});

function suggestName() {
  const taken = new Set(S.plans.map(p => p.name.toLowerCase()));
  let n = S.plans.length + 1;
  while (taken.has(`session-${n}`)) n++;
  return `session-${n}`;
}

el.newPlan.addEventListener('click', () => {
  el.newPlan.hidden = true;
  el.newPlanForm.hidden = false;
  const input = el.newPlanForm.elements.name;
  input.value = suggestName();
  input.focus();
  input.select();
});
const closeNewPlan = () => { el.newPlanForm.hidden = true; el.newPlan.hidden = false; };
el.newPlanForm.addEventListener('click', e => { if (e.target.dataset.act === 'cancel-new-plan') closeNewPlan(); });
el.newPlanForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = el.newPlanForm.elements.name.value.trim();
  try {
    await createPlan(name, name.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase()));
    closeNewPlan();
  } catch (err) {
    notice(err.message, 'warn');
  }
});

// Leaving with a change not yet saved: send it on the way out.
addEventListener('pagehide', () => {
  if (!dirty || !S.name) return;
  fetch(planUrl(S.name), {
    method: 'PUT', keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base: S.v, plan: S.plan }),
  });
});

// ---- Start ---------------------------------------------------------------------------

async function boot() {
  let plans;
  try {
    plans = await refreshPlanList();
  } catch {
    el.main.hidden = true;
    document.querySelector('.bar').hidden = true;
    el.offline.hidden = false;
    return;
  }
  let wanted = readPref('planner-last', '');
  try { wanted = decodeURIComponent(location.hash.slice(1)) || wanted; } catch { /* a mangled address: use the last plan */ }
  const names = plans.map(p => p.name);
  if (names.includes(wanted)) await openPlan(wanted);
  else if (names.length) await openPlan(names[0]);
  else await createPlan('session-1', 'Session 1');
  setInterval(poll, POLL_EVERY);
}

boot();
