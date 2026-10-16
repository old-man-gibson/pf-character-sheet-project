// Session planner page. Draws the plan as one lane per player along a time
// ruler, the unscheduled activities in a tray below, and a side panel with
// the selected activity's editor or the plan's NPCs. Every change goes
// through plan.js (which refuses to put a player in two activities at once),
// is kept for undo, and is saved to the plan store (stores.js): the plan
// files when the page is served by tools/serve.mjs on this computer, this
// browser's own storage anywhere else. The page re-reads the plan when it
// changes elsewhere (the file by hand, or another tab), and never writes over
// a change it has not seen.
//
// Rendering is a wholesale rebuild of each part (same as the session screen),
// with the focused control put back afterwards; a drag draws only its preview.

import {
  LINK_KINDS, SNAPS, activityState, addActivity, addCheck, addLink, addNote, addNpc, addPlayer, allClashes,
  checkNames, clashText, clashes, clock, noteTitle, outcomeChoices, pruneRefs, recap, recapMarkdown, refHappened, refKey, refText,
  removeLink, removeNote, resultText,
  deleteActivity, duplicateActivity, end, firstFree, freeName, ladder, limitText, minutesText, nameFrom,
  newId, newPlan, normalizePlan, npcActivities, npcClashes, npcName, outcome, overLimit, overfills,
  placesText, playerLoad, playerName, removeCheck, removeNpc, removePlayer, snapTo, span, updateActivity, whole,
} from './plan.js';
import { openStore } from './stores.js';
import { downloadFile } from '../../app/js/download.js';
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
  notice: $('#notice'), offline: $('#offline'), offlineText: $('#offline-text'), main: $('#main'),
  playerLink: $('#player-link'), npcs: $('#npcs'), notes: $('#notes'), recap: $('#recap'), where: $('#where'),
  exportPlan: $('#export-plan'), importPlan: $('#import-plan'), importFile: $('#import-file'),
  deletePlan: $('#delete-plan'),
};

let store = null; // where plans are kept: see stores.js

const S = {
  name: null,          // plan file name
  v: null,             // version of the file this page last read or wrote
  plan: null,
  plans: [],           // [{ name, title }] in the folder
  selected: null,      // id of the activity open in the editor
  side: null,          // with no activity open, the side panel's other view:
                       // { kind: 'npcs' | 'notes' } or { kind: 'npc' | 'note', id }
  editingPlayer: null, // id of the player whose name cell is a form
  testRoll: '',        // the editor's "test a result" box
  testCheck: null,     // which of the activity's checks it tests (null: the first)
  recapNotes: readPref('gm-planner:recap-notes', true) !== false, // the recap includes the notes
  zoom: zoomPref('gm-planner:zoom'),
  undo: [],
};

const ppm = () => ZOOMS[S.zoom];
const find = id => S.plan?.activities.find(a => a.id === id) ?? null;
const selectedActivity = () => find(S.selected);
const findNpc = id => S.plan?.npcs.find(n => n.id === id) ?? null;
const findNote = id => S.plan?.notes.find(n => n.id === id) ?? null;
const sideIs = (...kinds) => !S.selected && kinds.includes(S.side?.kind);
const openNpc = () => (sideIs('npc') ? findNpc(S.side.id) : null);
const openNote = () => (sideIs('note') ? findNote(S.side.id) : null);

// After an undo or a reload, an open NPC or note that is gone falls back to its list.
function settlePanels() {
  if (!find(S.selected)) S.selected = null;
  if (S.side?.kind === 'npc' && !findNpc(S.side.id)) S.side = { kind: 'npcs' };
  if (S.side?.kind === 'note' && !findNote(S.side.id)) S.side = { kind: 'notes' };
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
  // Whatever the change took away (an activity, a check, a tier, a note), the
  // results, notes and links that named it go with it, in the same undo step.
  pruneRefs(S.plan);
  if (out && out.ok === false) {
    if (out.full) notice(limitText(out.activity, out.before), 'warn');
    else if (out.clashes?.length) notice(clashText(S.plan, out.clashes), 'warn');
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

// Where a change made elsewhere came from, for the notices.
const elsewhere = () => (store.kind === 'files' ? 'The plan file was changed outside this page' : 'This plan was changed in another tab');

async function save() {
  clearTimeout(saveTimer);
  if (!dirty || !S.name) return;
  if (saving) { saveTimer = setTimeout(save, 150); return; }
  saving = true;
  dirty = false;
  setSaveState('Saving…');
  const name = S.name;
  try {
    const out = await store.write(name, S.plan, S.v);
    if (name !== S.name) return;
    if (out.ok) {
      S.v = out.v;
      setSaveState(dirty ? 'Unsaved' : 'Saved');
    } else if (out.plan) {
      // The plan changed since this page read it. Take that copy and keep
      // this page's for undo.
      keepUndo(JSON.stringify(S.plan));
      takePlan(out.plan, out.v);
      dirty = false;
      setSaveState('Saved');
      notice(`${elsewhere()}, so it was loaded again. Undo puts back the version from this page.`, 'warn');
    } else {
      S.v = null; // the plan is gone: write it again
      dirty = true;
      saveTimer = setTimeout(save, 0);
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

async function refreshPlanList() {
  S.plans = await store.list();
  renderPlanSelect();
  return S.plans;
}

async function openPlan(name, loaded = null) {
  await flush();
  const out = loaded ?? await store.read(name);
  if (!out) throw new Error(`there is no plan named “${name}”`);
  S.name = name;
  S.v = out.v;
  S.plan = out.plan;
  S.selected = null;
  S.side = null;
  S.editingPlayer = null;
  S.undo = [];
  el.undo.disabled = true;
  dirty = false;
  setSaveState('Saved');
  writePref('gm-planner:last', name);
  history.replaceState(null, '', `#${encodeURIComponent(name)}`);
  renderAll();
}

// The open plan's players and NPCs, for a new plan: most sessions have the
// same table and many of the same people.
const cast = () => ({ players: S.plan?.players ?? [], npcs: S.plan?.npcs ?? [] });

async function createPlan(name, plan) {
  const out = await store.create(name, plan);
  if (!out.ok) throw new Error(out.error);
  await refreshPlanList();
  await openPlan(name, out);
}

// Picks up changes made to the plan elsewhere, unless this page has changes
// of its own waiting or the GM is in the middle of something.
async function poll() {
  if (!S.name || saving || dirty || drag || document.activeElement?.matches('input, textarea')) return;
  const name = S.name;
  try {
    const out = await store.read(name, S.v ?? '');
    if (!out || out.same || name !== S.name || saving || dirty || drag) return;
    keepUndo(JSON.stringify(S.plan));
    takePlan(out.plan, out.v);
    notice(`${elsewhere()}; loaded the change.`);
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
  el.where.textContent = store.kind === 'files' ? 'Plans are files' : 'Plans are kept in this browser';
  el.where.title = store.kind === 'files'
    ? `Saved as .json files in ${store.where}`
    : 'Saved in this browser only, apart from the characters. Export a plan to keep a copy or move it to another computer.';
  el.npcs.textContent = plan.npcs.length ? `NPCs (${plan.npcs.length})` : 'NPCs';
  el.npcs.setAttribute('aria-pressed', String(sideIs('npcs', 'npc')));
  el.notes.textContent = plan.notes.length ? `Notes (${plan.notes.length})` : 'Notes';
  el.notes.setAttribute('aria-pressed', String(sideIs('notes', 'note')));
  el.recap.setAttribute('aria-pressed', String(sideIs('recap')));
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
  // Booked twice, or over its player limit: only a hand-edited file can be.
  const clashing = new Set([...allClashes(plan).flatMap(c => [c.a.id, c.b.id]), ...plan.activities.filter(overLimit).map(a => a.id)]);
  // With an NPC or a note open, the activities it is linked to stand out.
  const npc = openNpc();
  const note = openNote();
  const marked = new Set(npc ? npcActivities(plan, npc.id).map(a => a.id)
    : note ? [note.about?.activity, ...plan.links.filter(l => l.from.note === note.id).map(l => l.to)].filter(Boolean) : []);

  const lanes = plan.players.map((p, i) => {
    const blocks = plan.activities
      .filter(a => a.start != null && a.players.includes(p.id))
      .map(a => blockHtml(plan, a, p.id, L, {
        selected: a.id === S.selected, clash: clashing.has(a.id), marked: marked.has(a.id), editable: true, ...linkState(a),
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
  drawLinks();

  const found = allClashes(plan);
  const over = plan.activities.filter(overLimit);
  el.clashNote.hidden = !found.length && !over.length;
  el.clashNote.textContent = [
    found.length
      ? 'Booked twice: ' + found.slice(0, 3).map(c => `${playerName(plan, c.player)} in “${c.a.title || 'Untitled'}” and “${c.b.title || 'Untitled'}”`).join('; ') +
        (found.length > 3 ? ` and ${found.length - 3} more` : '') + '. Move one of each pair.'
      : '',
    over.length
      ? 'Over the player limit: ' + over.map(a => `“${a.title || 'Untitled'}” (${placesText(a)})`).join('; ') + '. Take a player out or raise the limit.'
      : '',
  ].filter(Boolean).join(' ');
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
        ${waiting.map(a => blockHtml(S.plan, a, null, layout(S.plan, ppm()), { selected: a.id === S.selected, editable: true, ...linkState(a) })).join('') || '<p class="empty">Drop a block here to take it off the timeline.</p>'}
      </div>
      <p class="hint">Drag a block to move it, or onto another player's lane to hand it to them. Drag its right edge to change how long it takes. Double-click a lane to add an activity there. Click a block to edit it.</p>`;
  });
  el.checks.innerHTML = checkNames(S.plan).map(c => `<option value="${esc(c)}"></option>`).join('');
}

function tierHtml(t, checkId) {
  const k = `${esc(checkId)}:${esc(t.id)}`;
  return `<div class="tier" data-tier="${esc(t.id)}">
    <input data-tf="label" data-key="tier:${k}:label" value="${esc(t.label)}" placeholder="Tier name" aria-label="Tier name">
    <input type="number" data-tf="dc" data-key="tier:${k}:dc" value="${t.dc ?? ''}" placeholder="DC" aria-label="Tier DC">
    <button type="button" class="icon" data-act="remove-tier" aria-label="Remove tier">×</button>
    <textarea data-tf="reward" data-key="tier:${k}:reward" rows="2" placeholder="Reward" aria-label="Tier reward">${esc(t.reward)}</textarea>
  </div>`;
}

// One way to try the activity: the check, its DC, its outcomes. With several,
// each is a numbered card and can be removed.
function checkHtml(c, i, many) {
  const k = esc(c.id);
  const n = i + 1;
  return `<div class="check-card${many ? ' boxed' : ''}" data-check="${k}">
    ${many ? `<div class="check-head"><h3>Check ${n}</h3>
      <button type="button" class="icon" data-act="remove-check" aria-label="Remove check ${n}">×</button></div>` : ''}
    <div class="ed-check">
      <label class="field grow">${many ? 'Check' : 'Required check'} <input data-cf="check" data-key="c:${k}:check" list="checks"
        value="${esc(c.check)}" placeholder="Skill or ability" aria-label="${many ? `Check ${n}` : 'Required check'}"></label>
      <label class="field dc">DC <input type="number" data-cf="dc" data-key="c:${k}:dc" value="${c.dc ?? ''}" aria-label="DC${many ? ` for check ${n}` : ''}"></label>
    </div>
    <label class="field">On success
      <textarea data-cf="success" data-key="c:${k}:success" rows="2" placeholder="Reward for meeting the DC">${esc(c.success)}</textarea></label>
    <div class="ed-tiers">
      <h4>Further success tiers</h4>
      ${i === 0 ? '<p class="dim small">Each tier has its own DC and reward. A result earns the highest tier whose DC it meets.</p>' : ''}
      ${c.tiers.map(t => tierHtml(t, c.id)).join('')}
      <button type="button" data-act="add-tier" data-key="c:${k}:add-tier">Add tier</button>
    </div>
    <label class="field">On failure
      <textarea data-cf="failure" data-key="c:${k}:failure" rows="2" placeholder="What happens below every DC">${esc(c.failure)}</textarea></label>
  </div>`;
}

function checksHtml(a) {
  const many = a.checks.length > 1;
  const cards = a.checks.map((c, i) => checkHtml(c, i, many)).join(many ? '<p class="check-or">or</p>' : '');
  return `<section class="ed-checks">
    ${cards || '<p class="dim small">No check: nothing to roll.</p>'}
    <button type="button" data-act="add-check" data-key="add-check"
      title="Another way to try this, with its own DC and outcomes">${a.checks.length ? 'Add another check' : 'Add a check'}</button>
  </section>`;
}

// The check the outcome tester is on.
const testedCheck = a => a.checks.find(c => c.id === S.testCheck) ?? a.checks[0] ?? null;
const checkOf = (a, el) => a.checks.find(c => c.id === el.closest('.check-card')?.dataset.check) ?? null;

// The side panel: the open activity's editor, or else the NPC list, an NPC,
// the notes or a note.
function renderEditor() {
  const a = selectedActivity();
  const kind = a ? 'activity' : S.side?.kind ?? null;
  el.editor.hidden = !kind;
  el.editor.setAttribute('aria-label', { activity: 'Activity', npcs: 'NPCs', npc: 'NPC', notes: 'Notes', note: 'Note', recap: 'Recap' }[kind] ?? '');
  if (a) return renderActivityEditor(a);
  const html = {
    npcs: () => npcListHtml(),
    npc: () => npcEditorHtml(openNpc()),
    notes: () => noteListHtml(),
    note: () => noteEditorHtml(openNote()),
    recap: () => recapHtml(),
  }[kind];
  keepFocus(el.editor, () => { el.editor.innerHTML = html ? html() : ''; });
}

// ---- Notes, links and what happened -------------------------------------------

const refValue = ref => esc(JSON.stringify(ref));
const readRef = value => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const KIND_TEXT = { leads: 'leads to', blocks: 'blocks' };

// What a block says about the links into it, for blockHtml: the state class,
// and the lines its tooltip adds.
function linkState(a) {
  const plan = S.plan;
  const { state, blockedBy, openedBy, leads } = activityState(plan, a.id);
  const lines = [];
  const done = resultText(a);
  if (done) lines.push(`What happened: ${done}`);
  if (state === 'blocked') lines.push(`Blocked by ${blockedBy.map(l => refText(plan, l.from)).join(', ')}`);
  else if (state === 'waiting') lines.push(`Waits for ${leads.map(l => refText(plan, l.from)).join(' or ')}`);
  else if (state === 'open') lines.push(`Opened by ${openedBy.map(l => refText(plan, l.from)).join(', ')}`);
  return { state, done: !!done, because: lines };
}

// The other activities, scheduled first in time order, as <option>s.
function activityOptions(exceptId, chosen = '') {
  return byTime(S.plan.activities.filter(x => x.id !== exceptId)).map(x =>
    `<option value="${esc(x.id)}"${x.id === chosen ? ' selected' : ''}>${esc(titleOf(x))}${x.start == null ? ' · unscheduled' : ` · ${esc(whenText(x))}`}</option>`).join('');
}

// One line of a link list: "Leads to “B”, when “A”: Failure  ×". `side` says
// which end to name: 'to' in the source's list, 'from' in the target's.
function linkRowHtml(link, side) {
  const plan = S.plan;
  const other = side === 'to'
    ? `<button type="button" class="npc-act" data-act="open-activity" data-id="${esc(link.to)}">${esc(refText(plan, { activity: link.to }))}</button>`
    : link.from.note !== undefined
      ? `<button type="button" class="npc-act" data-act="open-note" data-note="${esc(link.from.note)}">${esc(refText(plan, link.from))}</button>`
      : `<button type="button" class="npc-act" data-act="open-activity" data-id="${esc(link.from.activity)}">${esc(refText(plan, link.from))}</button>`;
  const verb = side === 'to' ? { leads: 'Leads to', blocks: 'Blocks' }[link.kind] : { leads: 'Opened by', blocks: 'Blocked by' }[link.kind];
  const when = side === 'to' && link.from.check ? `<span class="dim small">when ${esc(refText(plan, link.from).replace(/^“[^”]*”: /, ''))}</span>` : '';
  const live = refHappened(plan, link.from);
  return `<li class="${link.kind}${live ? ' live' : ''}"><span class="lk">${verb}</span>${other}${when}
    <span class="dim small">${live ? 'in effect' : ''}</span>
    <button type="button" class="icon" data-act="remove-link" data-link="${esc(link.id)}" aria-label="Remove link">×</button></li>`;
}

// The activity editor's "what happened", its links, and the notes about it.
function activityPlayHtml(a) {
  const plan = S.plan;
  const r = a.result;
  const resultValue = !r ? '' : r.outcome === 'done' ? 'done' : JSON.stringify({ check: r.check, outcome: r.outcome });
  const results = [
    `<option value=""${!r ? ' selected' : ''}>Not yet</option>`,
    `<option value="done"${resultValue === 'done' ? ' selected' : ''}>Done</option>`,
    ...outcomeChoices(a).map(o => {
      const v = JSON.stringify({ check: o.check, outcome: o.outcome });
      return `<option value="${esc(v)}"${v === resultValue ? ' selected' : ''}>${esc(o.label)}</option>`;
    }),
  ].join('');
  const { state } = linkState(a);
  const why = linkState(a).because.filter(l => !l.startsWith('What happened'));
  const out = plan.links.filter(l => l.from.activity === a.id);
  const into = plan.links.filter(l => l.to === a.id);
  const notes = plan.notes.filter(n => n.about?.activity === a.id);
  return `<section class="ed-play">
      <h3>What happened</h3>
      <select id="result" data-key="result" aria-label="What happened">${results}</select>
      ${why.length ? `<p class="small state-${state}">${esc(why.join('. '))}.</p>` : ''}
    </section>
    <section class="ed-links">
      <h3>Links</h3>
      ${out.length || into.length ? `<ul class="link-list">${out.map(l => linkRowHtml(l, 'to')).join('')}${into.map(l => linkRowHtml(l, 'from')).join('')}</ul>`
        : '<p class="dim small">Link another activity to this one: it leads to it (green) or blocks it (red) once this happens, or once a chosen outcome does.</p>'}
      <div class="link-add">
        <select id="link-from" data-key="link-from" aria-label="When">
          <option value="">When this happens</option>
          ${outcomeChoices(a).map(o => `<option value="${refValue({ activity: a.id, check: o.check, outcome: o.outcome })}">When ${esc(o.label)}</option>`).join('')}
        </select>
        <select id="link-kind" data-key="link-kind" aria-label="Link kind">${LINK_KINDS.map(k => `<option value="${k}">${KIND_TEXT[k]}</option>`).join('')}</select>
        <select id="link-to" data-key="link-to" aria-label="Activity to link"><option value="">an activity…</option>${activityOptions(a.id)}</select>
        <button type="button" data-act="add-link" data-key="add-link">Add</button>
      </div>
    </section>
    <section class="ed-notes">
      <h3>Notes</h3>
      ${notes.length ? `<ul class="npc-acts">${notes.map(n => `<li><button type="button" class="npc-act" data-act="open-note" data-note="${esc(n.id)}">${esc(noteTitle(n))}</button>
        <span class="dim small">${n.about.check ? esc(refText(plan, n.about).replace(/^“[^”]*”: /, '')) : ''}</span></li>`).join('')}</ul>` : ''}
      <button type="button" class="align-start" data-act="new-note-here" data-key="new-note-here">Add a note</button>
    </section>`;
}

// The recap panel: the same recap the download holds, drawn for reading.
function recapHtml() {
  const r = recap(S.plan);
  const who = list => (list.length ? ` <span class="dim">(${esc(list.join(', '))})</span>` : '');
  const section = (title, items) => (items.length ? `<section class="recap-part"><h3>${title}</h3><ul>${items.join('')}</ul></section>` : '');
  return `<div class="ed-head">
      <h2 class="ed-heading">Recap</h2>
      <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
    </div>
    <p class="dim small">What the session came to, from what happened in each activity. For the campaign log.</p>
    <div class="link-add">
      <button type="button" data-act="recap-download" data-key="recap-download">Download .md</button>
      <button type="button" data-act="recap-copy" data-key="recap-copy">Copy</button>
      <label class="pchip"><input type="checkbox" id="recap-notes" data-key="recap-notes"${S.recapNotes ? ' checked' : ''}> Include notes</label>
    </div>
    ${r.played.length ? '' : '<p class="dim">Nothing recorded yet: set <em>What happened</em> in an activity.</p>'}
    ${section('What happened', r.played.map(e => `<li class="${e.failure ? 'failed' : ''}"><strong>${esc(e.title)}</strong>${who(e.players)}: ${esc(e.result)}.${e.outcome ? `<span class="recap-text">${esc(e.outcome)}</span>` : ''}</li>`))}
    ${section('Rewards', r.rewards.map(w => `<li>${w.players.length ? `<strong>${esc(w.players.join(', '))}</strong>: ` : ''}${esc(w.text)} <span class="dim">(${esc(w.from)})</span></li>`))}
    ${section('Did not happen', [
      ...r.blocked.map(b => `<li><strong>${esc(b.title)}</strong>${who(b.players)}: blocked by ${esc(b.by.join(', '))}.</li>`),
      ...r.notPlayed.map(n => `<li><strong>${esc(n.title)}</strong>${who(n.players)}: not played.</li>`),
    ])}
    ${S.recapNotes ? section('Notes', r.notes.map(n => `<li class="recap-text">${esc(n)}</li>`)) : ''}`;
}

function noteListHtml() {
  const plan = S.plan;
  const rows = plan.notes.map(n => {
    const out = plan.links.filter(l => l.from.note === n.id);
    const bits = [n.about ? `about ${refText(plan, n.about)}` : '', ...LINK_KINDS.map(k => {
      const c = out.filter(l => l.kind === k).length;
      return c ? `${KIND_TEXT[k]} ${c}` : '';
    })].filter(Boolean);
    return `<li><button type="button" class="npc-row" data-act="open-note" data-note="${esc(n.id)}" data-key="ml:${esc(n.id)}">
      <span class="npc-name">${esc(noteTitle(n))}</span>
      <span class="npc-count">${refHappened(plan, { note: n.id }) ? 'Happened' : ''}</span>
      ${bits.length ? `<span class="npc-role">${esc(bits.join(' · '))}</span>` : ''}
    </button></li>`;
  }).join('');
  return `<div class="ed-head">
      <h2 class="ed-heading">Notes</h2>
      <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
    </div>
    <button type="button" class="align-start" data-act="new-note" data-key="new-note">New note</button>
    ${rows ? `<ul class="npc-list">${rows}</ul>`
      : '<p class="dim">No notes yet. A note can be about an activity or one of its outcomes, and can lead to or block activities once it happens.</p>'}`;
}

function noteEditorHtml(n) {
  const plan = S.plan;
  const about = n.about ? JSON.stringify(n.about) : '';
  const opt = (ref, label) => {
    const v = JSON.stringify(ref);
    return `<option value="${esc(v)}"${v === about ? ' selected' : ''}>${esc(label)}</option>`;
  };
  const groups = byTime(plan.activities).map(a => `<optgroup label="${esc(titleOf(a))}">
      ${opt({ activity: a.id }, `${titleOf(a)}, whatever happens`)}
      ${outcomeChoices(a).map(o => opt({ activity: a.id, check: o.check, outcome: o.outcome }, `${titleOf(a)}: ${o.label}`)).join('')}
    </optgroup>`).join('');
  const out = plan.links.filter(l => l.from.note === n.id);
  const happened = refHappened(plan, { note: n.id });
  return `<div class="ed-head">
      <h2 class="ed-heading">Note</h2>
      <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
    </div>
    <button type="button" class="back" data-act="note-list" data-key="note-list">‹ All notes</button>
    <label class="field">Note
      <textarea data-mf="text" data-key="mf:text" rows="5" placeholder="What happened, or what might">${esc(n.text)}</textarea></label>
    <label class="field">About
      <select id="note-about" data-key="note-about"><option value=""${about ? '' : ' selected'}>Nothing in particular</option>${groups}</select></label>
    <label class="pchip happened"><input type="checkbox" id="note-happened" data-key="note-happened"${n.happened ? ' checked' : ''}> It happened</label>
    <p class="dim small">${n.about
      ? `It also counts as happened once ${esc(refText(plan, n.about))} is recorded as what happened.${happened && !n.happened ? ' It has been.' : ''}`
      : 'Tick it when it happens; its links then take effect.'}</p>
    <section class="ed-links">
      <h3>Links</h3>
      ${out.length ? `<ul class="link-list">${out.map(l => linkRowHtml(l, 'to')).join('')}</ul>` : ''}
      <div class="link-add">
        <span class="dim small">Once it happens, it</span>
        <select id="note-link-kind" data-key="note-link-kind" aria-label="Link kind">${LINK_KINDS.map(k => `<option value="${k}">${KIND_TEXT[k]}</option>`).join('')}</select>
        <select id="note-link-to" data-key="note-link-to" aria-label="Activity to link"><option value="">an activity…</option>${activityOptions(null)}</select>
        <button type="button" data-act="add-note-link" data-key="add-note-link">Add</button>
      </div>
    </section>
    <div class="ed-foot"><span></span><button type="button" class="danger" data-act="delete-note" data-key="delete-note">Delete note</button></div>`;
}

// Lines between linked activities on the timeline: from the end of the source
// block to the start of the target, between the copies closest in height.
// Green leads, red blocks; dashed until the link is in effect. Links from
// notes have no line (a note has no place on the timeline); their targets show
// it in their state.
function drawLinks() {
  const plan = S.plan;
  const box = el.timeline.getBoundingClientRect();
  const copies = id => [...el.timeline.querySelectorAll(`.lane .block${attrSel('data-id', id)}`)].map(b => b.getBoundingClientRect());
  const paths = [];
  for (const link of plan.links) {
    if (link.from.activity === undefined) continue;
    const from = copies(link.from.activity);
    const to = copies(link.to);
    let best = null;
    for (const f of from) for (const t of to) {
      const d = Math.abs((f.top + f.bottom) - (t.top + t.bottom));
      if (!best || d < best.d) best = { f, t, d };
    }
    if (!best) continue;
    const x1 = best.f.right - box.left;
    const y1 = (best.f.top + best.f.bottom) / 2 - box.top;
    const x2 = best.t.left - box.left;
    const y2 = (best.t.top + best.t.bottom) / 2 - box.top;
    const bend = Math.max(28, Math.abs(x2 - x1) / 2);
    const live = refHappened(plan, link.from);
    paths.push(`<path class="link ${link.kind}${live ? ' live' : ''}" data-link="${esc(link.id)}"
      d="M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + bend).toFixed(1)},${y1.toFixed(1)} ${(x2 - bend).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"
      marker-end="url(#arrow-${link.kind})"/>`);
  }
  if (!paths.length) return;
  el.timeline.insertAdjacentHTML('beforeend', `<svg class="links" width="${el.timeline.scrollWidth}" height="${el.timeline.scrollHeight}" aria-hidden="true">
    <defs>${LINK_KINDS.map(k => `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="arrow ${k}" d="M0,0 L10,5 L0,10 z"/></marker>`).join('')}</defs>
    ${paths.join('')}
  </svg>`);
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
  // A full activity offers no more places: the other players' boxes are off.
  const full = a.maxPlayers != null && a.players.length >= a.maxPlayers;
  const players = plan.players.map(p => {
    const inIt = a.players.includes(p.id);
    const shut = full && !inIt;
    return `
    <label class="pchip${shut ? ' shut' : ''}" style="--pc:${esc(p.color)}"${shut ? ` title="${esc(limitText(a))}"` : ''}>
      <input type="checkbox" data-player="${esc(p.id)}" data-key="ep:${esc(p.id)}" aria-label="${esc(playerName(plan, p.id))}"${inIt ? ' checked' : ''}${shut ? ' disabled' : ''}>
      ${esc(playerName(plan, p.id))}
    </label>`;
  }).join('');
  keepFocus(el.editor, () => {
    el.editor.innerHTML = `
      <div class="ed-head">
        <input class="ed-title" data-f="title" data-key="f:title" value="${esc(a.title)}" placeholder="Activity name" aria-label="Activity name">
        <button type="button" class="icon" data-act="close-editor" aria-label="Close">×</button>
      </div>
      <fieldset class="ed-players"><legend>Players${a.maxPlayers != null ? ` <span class="count">${a.players.length} of ${a.maxPlayers}</span>` : ''}</legend>
        ${players || '<p class="dim">Add players first.</p>'}
        <label class="ed-max">At most <input type="number" data-f="maxPlayers" data-key="f:maxPlayers" min="1" step="1"
          value="${a.maxPlayers ?? ''}" placeholder="any" aria-label="Most players this activity takes; empty for no limit"> players</label>
      </fieldset>
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
      ${checksHtml(a)}
      <section class="ed-test">
        <h3>Outcomes</h3>
        ${a.checks.length > 1 ? `<label class="field">Check <select id="test-check" data-key="test-check">
          ${a.checks.map((c, i) => `<option value="${esc(c.id)}"${c.id === testedCheck(a)?.id ? ' selected' : ''}>${i + 1}. ${esc(c.check.trim() || 'Unnamed check')}</option>`).join('')}
        </select></label>` : ''}
        <label class="field">Test a result <input type="number" id="test-roll" data-key="test" value="${esc(S.testRoll)}" placeholder="Check total"></label>
        <div id="test-out"></div>
      </section>
      ${activityPlayHtml(a)}
      <div class="ed-foot">
        <button type="button" data-act="duplicate" data-key="duplicate">Duplicate</button>
        <button type="button" class="danger" data-act="delete" data-key="delete">Delete</button>
      </div>`;
  });
  renderOutcomes();
}

// The editor's ladder for the tested check: failure, success and each tier
// with its reward, the tested result's step marked.
function renderOutcomes() {
  const box = $('#test-out');
  const a = selectedActivity();
  if (!box || !a) return;
  const c = testedCheck(a);
  if (!c) { box.innerHTML = '<p class="dim small">Add a check to see its outcomes.</p>'; return; }
  const steps = ladder(c);
  if (!steps.length) { box.innerHTML = '<p class="dim small">Set a DC to see the outcomes.</p>'; return; }
  const total = S.testRoll === '' ? NaN : Number(S.testRoll);
  const r = outcome(c, total);
  const row = (cls, dc, name, reward, hit) => `<li class="${cls}${hit ? ' hit' : ''}"><span class="l-dc">${esc(dc)}</span>
    <span class="l-name">${esc(name)}</span>${reward.trim() ? `<span class="l-reward">${esc(reward)}</span>` : ''}</li>`;
  let line = '';
  if (r) {
    line = r.failure
      ? `${total} fails: it needs ${r.next.dc} for ${r.next.label}.`
      : `${total} reaches ${r.tier.label} (DC ${r.tier.dc}).` + (r.next ? ` ${r.next.dc - total} more for ${r.next.label} (DC ${r.next.dc}).` : '');
  }
  box.innerHTML = `<ol class="ladder">
      ${row('fail', `below ${steps[0].dc}`, 'Failure', c.failure, r?.failure)}
      ${steps.map(t => row('', `DC ${t.dc}`, t.label, t.reward, r && !r.failure && r.tier.id === t.id)).join('')}
    </ol>${line ? `<p class="test-line">${esc(line)}</p>` : ''}`;
}

// ---- Selecting and editing ---------------------------------------------------

function select(id) {
  if (S.selected !== id) { S.testRoll = ''; S.testCheck = null; }
  S.selected = id;
  S.side = null;
  renderBar();
  renderTimeline();
  renderTray();
  renderEditor();
}

// Opens the side panel on a list ({ kind: 'npcs' | 'notes' }) or one NPC or
// note ({ kind: 'npc' | 'note', id }).
function showSide(side) {
  S.selected = null;
  S.testRoll = '';
  S.side = side;
  renderBar();
  renderTimeline();
  renderTray();
  renderEditor();
}

function closePanel() {
  S.side = null;
  select(null);
}

function newNote(about = null) {
  let id = null;
  edit(plan => { id = addNote(plan, { about }).id; });
  showSide({ kind: 'note', id });
  el.editor.querySelector('[data-mf="text"]')?.focus();
}

function newNpc(link = null) {
  let id = null;
  edit(plan => {
    id = addNpc(plan).id;
    if (link) updateActivity(plan, link.id, { npcs: [...link.npcs, id] });
  });
  showSide({ kind: 'npc', id });
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
  const full = !!cand && overfills(find(drag.id), cand);
  drag.cand = cand;
  drag.ok = !!cand && !found.length && !full;
  drag.why = why || (full ? limitText(cand) : found.length ? clashText(plan, found) : '');
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
  } else if (e.key === 'Escape' && (S.selected || S.side) && !inText) {
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
    showSide({ kind: 'npc', id: button.dataset.npc });
  } else if (act === 'npc-list') {
    showSide({ kind: 'npcs' });
  } else if (act === 'recap-download') {
    downloadFile(`${S.name}-recap.md`, recapMarkdown(S.plan, { notes: S.recapNotes }), 'text/markdown');
  } else if (act === 'recap-copy') {
    navigator.clipboard.writeText(recapMarkdown(S.plan, { notes: S.recapNotes }))
      .then(() => notice('Recap copied.'), () => notice('Copying is not allowed here; use Download.', 'warn'));
  } else if (act === 'open-note') {
    showSide({ kind: 'note', id: button.dataset.note });
  } else if (act === 'note-list') {
    showSide({ kind: 'notes' });
  } else if (act === 'new-note') {
    newNote();
  } else if (act === 'remove-link') {
    edit(plan => removeLink(plan, button.dataset.link));
    renderAll();
  } else if (act === 'add-note-link' && openNote()) {
    const note = openNote();
    const to = el.editor.querySelector('#note-link-to').value;
    const kind = el.editor.querySelector('#note-link-kind').value;
    if (!to) { notice('Pick the activity it leads to or blocks.', 'warn'); return; }
    const out = edit(plan => addLink(plan, { note: note.id }, to, kind));
    if (out.ok === false) notice(out.error, 'warn');
    renderAll();
  } else if (act === 'delete-note' && openNote()) {
    const note = openNote();
    edit(plan => removeNote(plan, note.id));
    S.side = { kind: 'notes' };
    renderAll();
    notice(`Deleted the note “${noteTitle(note)}”, and its links. Undo brings them back.`);
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
    S.side = { kind: 'npcs' };
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
  } else if (act === 'new-note-here') {
    newNote({ activity: a.id });
  } else if (act === 'add-link') {
    const from = readRef(el.editor.querySelector('#link-from').value) ?? { activity: a.id };
    const to = el.editor.querySelector('#link-to').value;
    const kind = el.editor.querySelector('#link-kind').value;
    if (!to) { notice('Pick the activity it leads to or blocks.', 'warn'); return; }
    const out = edit(plan => addLink(plan, from, to, kind));
    if (out.ok === false) notice(out.error, 'warn');
    renderAll();
  } else if (act === 'unlink-npc') {
    edit(plan => updateActivity(plan, a.id, { npcs: a.npcs.filter(n => n !== button.dataset.npc) }));
    renderAll();
  } else if (act === 'add-tier') {
    const c = checkOf(a, button);
    const top = Math.max(-Infinity, c.dc ?? -Infinity, ...c.tiers.map(t => t.dc ?? -Infinity));
    const id = newId(c.tiers, 't');
    edit(() => { c.tiers.push({ id, label: '', dc: Number.isFinite(top) ? top + 5 : null, reward: '' }); });
    renderEditor();
    el.editor.querySelector(attrSel('data-key', `tier:${c.id}:${id}:label`))?.focus();
  } else if (act === 'remove-tier') {
    const c = checkOf(a, button);
    const id = button.closest('.tier').dataset.tier;
    edit(() => { c.tiers = c.tiers.filter(t => t.id !== id); });
    renderEditor();
    renderTimeline();
  } else if (act === 'add-check') {
    let added = null;
    edit(() => { added = addCheck(a); });
    S.testCheck = added.id;
    renderEditor();
    renderTimeline();
    renderTray();
    el.editor.querySelector(attrSel('data-key', `c:${added.id}:check`))?.focus();
  } else if (act === 'remove-check') {
    const c = checkOf(a, button);
    edit(() => { removeCheck(a, c.id); });
    renderEditor();
    renderTimeline();
    renderTray();
  }
});

// ---- Fields ------------------------------------------------------------------------

const TEXT_FIELDS = ['title', 'premise'];

el.editor.addEventListener('input', e => {
  const t = e.target;
  const note = openNote();
  if (t.dataset.mf && note) {
    typed(() => { note[t.dataset.mf] = t.value; });
    renderTimeline();
    renderTray();
    return;
  }
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
  const c = checkOf(a, t);
  if (TEXT_FIELDS.includes(f)) typed(() => { a[f] = t.value; });
  else if (c && t.dataset.cf) {
    const cf = t.dataset.cf;
    typed(() => { c[cf] = cf === 'dc' ? whole(t.value, null) : t.value; });
  } else if (c && t.dataset.tf) {
    const tier = c.tiers.find(x => x.id === t.closest('.tier').dataset.tier);
    const tf = t.dataset.tf;
    typed(() => { tier[tf] = tf === 'dc' ? whole(t.value, null) : t.value; });
  } else return;
  renderTimeline();
  renderTray();
  renderOutcomes();
  // The tester's list names the checks.
  if (t.dataset.cf === 'check') {
    const option = el.editor.querySelector(`#test-check option${attrSel('value', c.id)}`);
    if (option) option.textContent = `${a.checks.indexOf(c) + 1}. ${c.check.trim() || 'Unnamed check'}`;
  }
});

el.editor.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'recap-notes') {
    S.recapNotes = t.checked;
    writePref('gm-planner:recap-notes', S.recapNotes);
    renderEditor();
    return;
  }
  const note = openNote();
  if (note && (t.id === 'note-about' || t.id === 'note-happened')) {
    edit(() => {
      if (t.id === 'note-about') note.about = readRef(t.value);
      else note.happened = t.checked;
    });
    renderAll();
    return;
  }
  const npc = openNpc();
  if (t.id === 'link-activity' && npc && t.value) {
    const target = find(t.value);
    edit(plan => updateActivity(plan, target.id, { npcs: [...target.npcs, npc.id] }));
    renderAll();
    return;
  }
  const a = selectedActivity();
  if (!a) return;
  if (t.id === 'test-check') {
    S.testCheck = t.value;
    renderOutcomes();
  } else if (t.id === 'result') {
    const result = t.value === '' ? null : t.value === 'done' ? { check: null, outcome: 'done' } : readRef(t.value);
    edit(plan => updateActivity(plan, a.id, { result }));
    renderAll();
  } else if (t.id === 'link-npc') {
    if (t.selectedOptions[0]?.dataset.new) newNpc(a);
    else if (t.value) {
      edit(plan => updateActivity(plan, a.id, { npcs: [...a.npcs, t.value] }));
      renderAll();
    }
  } else if (t.dataset.f === 'maxPlayers') {
    edit(plan => updateActivity(plan, a.id, { maxPlayers: whole(t.value, null, 1) }));
    renderAll();
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
  writePref('gm-planner:zoom', S.zoom);
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
  if (sideIs('npcs', 'npc')) closePanel();
  else showSide({ kind: 'npcs' });
});
el.notes.addEventListener('click', () => {
  if (sideIs('notes', 'note')) closePanel();
  else showSide({ kind: 'notes' });
});
el.recap.addEventListener('click', () => {
  if (sideIs('recap')) closePanel();
  else showSide({ kind: 'recap' });
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
    await createPlan(name, newPlan(name.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase()), cast()));
    closeNewPlan();
  } catch (err) {
    notice(err.message, 'warn');
  }
});

// Export: the plan as the same .json a plan file is, so it imports into
// either store (or can be dropped into the plans folder as it is).
el.exportPlan.addEventListener('click', async () => {
  await flush();
  downloadFile(`${S.name}.json`, JSON.stringify(S.plan, null, 2) + '\n');
});

el.importPlan.addEventListener('click', () => el.importFile.click());
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files[0];
  el.importFile.value = '';
  if (!file) return;
  try {
    const plan = normalizePlan(JSON.parse(await file.text()));
    const name = freeName(S.plans.map(p => p.name), nameFrom(file.name));
    await createPlan(name, plan);
    notice(`Imported “${file.name}” as ${name}.`);
  } catch (err) {
    notice(`Could not import “${file.name}”: ${err.message}`, 'warn');
  }
});

// Delete asks twice: the first press turns the button into the question.
let deleteArmed = 0;
el.deletePlan.addEventListener('click', async () => {
  if (!deleteArmed) {
    el.deletePlan.textContent = `Delete “${S.name}”?`;
    deleteArmed = setTimeout(() => { deleteArmed = 0; el.deletePlan.textContent = 'Delete plan'; }, 4000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = 0;
  el.deletePlan.textContent = 'Delete plan';
  const gone = S.name;
  const keep = cast();
  try {
    clearTimeout(saveTimer);
    dirty = false;
    await store.remove(gone);
    const plans = await refreshPlanList();
    if (plans.length) await openPlan(plans[0].name);
    else await createPlan('session-1', newPlan('Session 1', keep));
    notice(`Deleted the plan “${gone}”.`);
  } catch (err) {
    notice(`Could not delete “${gone}”: ${err.message}`, 'warn');
  }
});

// Leaving with a change not yet saved: send it on the way out.
addEventListener('pagehide', () => {
  if (dirty && S.name) store.writeOnExit(S.name, S.plan, S.v);
});

// ---- Start ---------------------------------------------------------------------------

async function boot() {
  store = await openStore();
  let plans;
  try {
    plans = await refreshPlanList();
  } catch (err) {
    el.main.hidden = true;
    document.querySelector('.bar').hidden = true;
    el.offline.hidden = false;
    el.offlineText.textContent = store.kind === 'browser'
      ? `This browser will not keep plans (${err.message}). It may be a private window, or site storage may be blocked.`
      : `The plan files could not be read (${err.message}).`;
    return;
  }
  let wanted = readPref('gm-planner:last', '');
  try { wanted = decodeURIComponent(location.hash.slice(1)) || wanted; } catch { /* a mangled address: use the last plan */ }
  const names = plans.map(p => p.name);
  if (names.includes(wanted)) await openPlan(wanted);
  else if (names.length) await openPlan(names[0]);
  else await createPlan('session-1', newPlan('Session 1'));
  setInterval(poll, POLL_EVERY);
}

boot();
