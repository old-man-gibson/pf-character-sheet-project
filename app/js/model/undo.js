/**
 * undo.js -- taking back the last structural change.
 *
 * The sheet is full of small `×` buttons. Thirty of them go through
 * `listRemove`, and every one used to delete a row on the first click with
 * nothing to press afterwards: two places armed themselves and asked twice,
 * and the comments beside both said the same thing -- "there is no undo but
 * History". History is a snapshot every twenty changes, which is the wrong
 * shape of net for a mis-click. It can put back a weapon you deleted; it
 * cannot do it without also putting back the twelve edits you made after it.
 *
 * So: one stack, and a whole document on each entry.
 *
 * Whole-document rather than a patch per operation, which sounds extravagant
 * and is the cheaper thing to be right about. A remove is never *just* a
 * splice: recompute rewrites derived values all over the document, a talent
 * that was granting ranks stops, a tracker's maximum moves. Reversing that by
 * hand means knowing, per operation, everything it could reach -- and being
 * wrong there is a bug that quietly restores the row and none of its
 * consequences. A clone has no such list to get wrong. At the scale that
 * matters (a level-20 gestalt, the largest character this was built against)
 * that is 231 KB and 3.3 ms per entry, paid on a button press rather than a
 * keystroke.
 *
 * `DEPTH` entries deep, oldest dropped. Nothing here writes to storage: an
 * undo is an edit like any other and rides out on the same `recompute` and
 * emit, so the working copy is written by whoever was already listening.
 *
 * What this deliberately does *not* cover is typing. A text field's own
 * Ctrl+Z is better at that than anything here would be -- it works per
 * character rather than per commit -- so the element only takes the key when
 * the caret is not in a field. See `#onDocumentKey` in sheet-element.js.
 *
 * Play is the other half, further down: damage, a spent pip, a card drawn, a
 * rest. A whole document is the wrong thing to put back for those, because
 * the table does not stop while you notice a mistake -- undoing a spend by
 * snapshot also undid the damage taken after it. So a play action keeps what
 * it changed rather than what the sheet was, and taking it back touches that
 * and nothing else. See `playAction`.
 */

import { emit } from './events.js';

/** How many steps back the stack holds. */
export const UNDO_DEPTH = 20;

/** How many play actions are kept to be taken back. */
export const PLAY_DEPTH = 30;

/*
 * One count for both stacks, so that "the last thing that happened" can be
 * found across them: Ctrl+Z takes back whichever is newer.
 */
let counter = 0;

/** A copy that shares nothing with the original, JSON-shaped or not. */
function clone(data) {
  try {
    return structuredClone(data);
  } catch {
    // A document is JSON all the way down, so this is only ever reached if
    // something un-cloneable has been parked on the model by mistake.
    return JSON.parse(JSON.stringify(data));
  }
}

/*
 * What "the document" means here.
 *
 * `model.data` is most of it and would be all of it if the model kept nothing
 * else, but two things live beside it and both can move under an edit:
 *
 *   trackers   built from `resources`, `sheetTrackerState` and the player's
 *              own, then mutated in place -- `removeTracker` splices this
 *              array, and a snapshot of `data` alone puts the row back in the
 *              document and not on the screen.
 *   offsets    what the source workbook added that this sheet cannot see.
 *              Reconciliation writes them, and a restore that left them behind
 *              would move totals the undo was supposed to leave alone.
 *
 * `listeners` is deliberately not here: who is watching is not part of what
 * the character is. Neither is `contributions`, which `recompute` clears and
 * rebuilds on the way out of every restore.
 */
function capture(model) {
  return {
    data: clone(model.data),
    trackers: clone(model.trackers ?? []),
    offsets: clone(model.offsets ?? {}),
  };
}

function restore(model, state) {
  // Into the same object rather than over it: `model.data` is held in a good
  // many places across a render, and swapping it would leave every one of them
  // pointing at the version that was just undone.
  for (const key of Object.keys(model.data)) delete model.data[key];
  Object.assign(model.data, state.data);
  if (Array.isArray(model.trackers)) model.trackers.splice(0, model.trackers.length, ...state.trackers);
  else model.trackers = state.trackers;
  model.offsets = state.offsets;
}

/**
 * Remember the document as it stands, under a name a person would recognise.
 *
 * Call it *before* the change, as the first line of whatever is about to
 * happen. `label` is shown back on the toast -- "Removed Cloak of Resistance"
 * -- so it should say what is being taken away, not which function is running.
 */
export function markUndo(model, label) {
  // Inside a play action the action's own entry already covers this, and a
  // snapshot as well would put the whole document back behind its back.
  if (model.playing) return model;
  if (!model.undoStack) model.undoStack = [];
  // The same defaults a play action reads first (see there), so that play
  // written into this snapshot later lands on a figure and not on nothing.
  readDefaults(model);
  const named = String(label || 'change');
  model.undoStack.push({ label: named, state: capture(model), seq: ++counter });
  if (model.undoStack.length > UNDO_DEPTH) model.undoStack.shift();
  // Announced rather than returned, so that every destructive operation offers
  // itself back without each of its thirty call sites having to remember to.
  emit(model, { type: 'undo-mark', label: named });
  return model;
}

const top = (list) => list?.[list.length - 1] ?? null;

/* Hit points fill in their defaults when read; a sheet with none has none to fill. */
function readDefaults(model) {
  try { void model.hpState; } catch { /* no hit points on this document */ }
}

/** Whichever of the two stacks holds the newer entry, or null when both are empty. */
function latest(model) {
  const snap = top(model.undoStack);
  const play = top(model.playStack);
  if (!snap && !play) return null;
  return (play?.seq ?? -1) > (snap?.seq ?? -1) ? { kind: 'play', entry: play } : { kind: 'snapshot', entry: snap };
}

/** What the next `undo()` would take back, or null when there is nothing. */
export function undoLabel(model) {
  return latest(model)?.entry.label ?? null;
}

/**
 * Take back the last thing that happened, whichever stack it is on.
 *
 * Returns `{ kind, label, ok, reason }`, or null when there is nothing to
 * take back. `ok` is false only for a play action the sheet has since moved
 * too far from (see `undoPlay`); a snapshot always goes back.
 */
export function undoLast(model) {
  const last = latest(model);
  if (!last) return null;
  if (last.kind === 'play') return { kind: 'play', ...undoPlay(model, last.entry.seq) };
  model.undoStack.pop();
  restore(model, last.entry.state);
  model.recompute();
  emit(model, { type: 'undo', label: last.entry.label });
  return { kind: 'snapshot', label: last.entry.label, ok: true, reason: '' };
}

/** `undoLast`, answering with the label of what came back, or null. */
export function undo(model) {
  const r = undoLast(model);
  return r?.ok ? r.label : null;
}

/** Forget everything. For a document being replaced rather than edited. */
export function clearUndo(model) {
  model.undoStack = [];
  model.playStack = [];
  return model;
}

/* ------------------------------------------------------------------ *
 * Play actions.
 *
 * The entry is a list of changes -- a path, what was there, what the action
 * left -- worked out by comparing the saved document before and after the
 * action, so no action has to say what it touches and none can forget
 * something.
 *
 * Any one can be taken back, not only the newest, as long as nothing kept
 * here since has touched what it touched: a spend and the damage after it
 * are two different things, and the spend goes back alone. Damage and a heal
 * after it are the same thing -- hit points -- and the heal is named as the
 * one to take back first (see `undoPlay`).
 *
 * What was changed since by something that is not kept here -- a figure
 * typed into a box, a list edited by hand -- is met this way:
 *
 *   a number      moves back by what the action moved it, and a count never
 *                 goes below none.
 *   a list        of plain values (card piles, readied maneuvers): the items
 *                 the action put in come out, the ones it took out go back --
 *                 refused if they are no longer where it left them.
 *   a row         kept by `id` goes back by id, so a list reordered or cut
 *                 since still finds it. A row without one is found by its
 *                 position, checked against its name.
 *   anything else a switch, a word: put back if it still reads as the action
 *                 left it, and left alone if something since changed it,
 *                 because the later change is the one the player meant.
 *
 * Trackers are keyed by id and only their `current` is read: nothing else on
 * a tracker moves in play.
 * ------------------------------------------------------------------ */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPrim = (v) => v === null || (typeof v !== 'object' && typeof v !== 'function');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Deep equality for JSON-shaped values; a key holding undefined is no key. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

/** The document a play action is compared on: saved fields only, trackers by id. */
function playState(model) {
  const { customTrackers, sheetTrackerState, ...data } = model.toJSON();
  const trackers = {};
  for (const t of model.trackers || []) {
    if (t && t.id !== undefined && t.id !== null) trackers[t.id] = { current: t.current };
  }
  return { data, trackers };
}

/** Rows keyed by a plain, unique `id`, or null when the list is not like that. */
function byId(list) {
  const map = new Map();
  for (const [index, item] of list.entries()) {
    const id = isObj(item) ? item.id : undefined;
    if (id === undefined || id === null || typeof id === 'object' || map.has(id)) return null;
    map.set(id, { item, index });
  }
  return map;
}

/** What a row without an id is recognised by, so a list cut since does not misplace it. */
const HINT_FIELDS = ['name', 'title', 'label', 'level'];
function hintOf(item) {
  if (!isObj(item)) return null;
  for (const field of HINT_FIELDS) {
    const value = item[field];
    if (value !== undefined && value !== null && value !== '' && isPrim(value)) return { field, value };
  }
  return null;
}

function diffInto(out, path, a, b) {
  if (a === b) return;
  if (isObj(a) && isObj(b)) return diffObject(out, path, a, b);
  // A block or list the action created is compared with an empty one, so
  // that taking it back leaves it empty rather than refusing because
  // something was written into it since.
  if (a === undefined && isObj(b)) return diffObject(out, path, {}, b);
  if (a === undefined && Array.isArray(b)) a = [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.every(isPrim) && b.every(isPrim)) {
      if (!same(a, b)) out.push({ path, kind: 'list', before: [...a], after: [...b] });
      return;
    }
    const ka = byId(a);
    const kb = ka && byId(b);
    if (ka && kb) {
      for (const [id, { item, index }] of ka) {
        if (!kb.has(id)) out.push({ path, kind: 'removed', id, index, item: clone(item) });
      }
      for (const [id, { item, index }] of kb) {
        if (!ka.has(id)) out.push({ path, kind: 'added', id, index, item: clone(item) });
      }
      for (const [id, { item }] of ka) if (kb.has(id)) diffInto(out, [...path, { id }], item, kb.get(id).item);
      return;
    }
    if (a.length === b.length) {
      a.forEach((item, i) => diffInto(out, [...path, { i, hint: hintOf(item) }], item, b[i]));
      return;
    }
  }
  if (!same(a, b)) out.push({ path, kind: 'value', before: clone(a), after: clone(b) });
}

function diffObject(out, path, a, b) {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diffInto(out, [...path, key], a[key], b[key]);
}

/** The index a path step names in `list`, or null when that row is not there any more. */
function indexIn(list, step) {
  if (!Array.isArray(list)) return null;
  if ('id' in step) {
    const i = list.findIndex((x) => isObj(x) && x.id === step.id);
    return i < 0 ? null : i;
  }
  const { i, hint } = step;
  if (!hint) return i < list.length ? i : null;
  const matches = (x) => isObj(x) && x[hint.field] === hint.value;
  if (matches(list[i])) return i;
  const found = list.flatMap((x, n) => (matches(x) ? [n] : []));
  return found.length === 1 ? found[0] : null;
}

/**
 * Where a path lands in a document: the object or list that holds the last
 * step, and the key into it. `doc` is `{ data, trackers }`, trackers being the
 * model's list (or a snapshot's), found by id. `create` fills in a missing
 * block on the way, for a change that made one -- never a missing row.
 */
function locate(doc, path, { create = false } = {}) {
  let node;
  let rest;
  if (path[0] === 'data') {
    node = doc.data;
    rest = path.slice(1);
  } else if (path[0] === 'trackers') {
    node = (doc.trackers || []).find((t) => t?.id === path[1]);
    rest = path.slice(2);
  } else return null;
  if (!rest.length || !node) return null;
  for (const step of rest.slice(0, -1)) {
    const key = typeof step === 'string' ? (isObj(node) ? step : null) : indexIn(node, step);
    if (key === null) return null;
    if (node[key] === undefined && create && typeof step === 'string') node[key] = {};
    node = node[key];
    if (node === null || typeof node !== 'object') return null;
  }
  const last = rest[rest.length - 1];
  const key = typeof last === 'string' ? (isObj(node) ? last : null) : indexIn(node, last);
  return key === null ? null : { holder: node, key };
}

function write(at, value) {
  if (value === undefined && isObj(at.holder)) delete at.holder[at.key];
  else at.holder[at.key] = clone(value);
}

/* Multiset arithmetic for lists of plain values. */
function counts(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return m;
}
function minus(a, b) {
  const left = counts(b);
  const out = [];
  for (const x of a) {
    const n = left.get(x) || 0;
    if (n) left.set(x, n - 1);
    else out.push(x);
  }
  return out;
}

/**
 * Move `cur` the way a list went from `from` to `to`: out with what left it,
 * in with what arrived, each arrival where it stood in `to`. Null when `cur`
 * no longer holds what is to leave, or -- for a list of distinct values, like
 * a card pile -- already holds what is to arrive.
 */
function shiftList(cur, from, to) {
  if (!Array.isArray(cur)) return null;
  const out = [...cur];
  for (const x of minus(from, to)) {
    const i = out.lastIndexOf(x);
    if (i < 0) return null;
    out.splice(i, 1);
  }
  const arriving = minus(to, from);
  const distinct = new Set(from).size === from.length && new Set(to).size === to.length;
  if (distinct && arriving.some((x) => out.includes(x))) return null;
  for (const x of arriving) out.splice(Math.min(Math.max(0, to.indexOf(x)), out.length), 0, x);
  return out;
}

/* Taking a change back is making the opposite change. */
function reversed(change) {
  if (change.kind === 'added') return { ...change, kind: 'removed' };
  if (change.kind === 'removed') return { ...change, kind: 'added' };
  return { ...change, before: change.after, after: change.before };
}

/**
 * Make one change in a document. Answers 'done', 'skip' (something since
 * made it moot or put something else there, and the later thing stands) or
 * 'conflict' (it cannot be made without breaking what happened since).
 * `dry` asks without writing.
 */
function applyChange(doc, change, { dry = false } = {}) {
  const creates = !dry && change.kind === 'value' && change.before === undefined;
  const at = locate(doc, change.path, { create: creates });
  if (change.kind === 'added' || change.kind === 'removed') {
    const list = at ? at.holder[at.key] : undefined;
    if (!Array.isArray(list)) return 'skip';
    const i = list.findIndex((x) => isObj(x) && x.id === change.id);
    if (change.kind === 'added' && i < 0 && !dry) list.splice(Math.min(change.index, list.length), 0, clone(change.item));
    if (change.kind === 'removed' && i >= 0 && !dry) list.splice(i, 1);
    return 'done';
  }
  if (!at) return change.kind === 'list' ? 'conflict' : 'skip';
  const cur = at.holder[at.key];
  if (same(cur, change.before)) {
    if (!dry) write(at, change.after);
    return 'done';
  }
  if (same(cur, change.after)) return 'done';
  if (change.kind === 'list') {
    // A log only ever grows at the end and drops its oldest line, so what an
    // action wrote may have scrolled away: take out what is still there.
    if (change.path[change.path.length - 1] === 'log' && Array.isArray(cur)) {
      if (!dry) write(at, minus(cur, minus(change.before, change.after)));
      return 'done';
    }
    const moved = shiftList(cur, change.before, change.after);
    if (!moved) return 'conflict';
    if (!dry) write(at, moved);
    return 'done';
  }
  if (isNum(cur) && isNum(change.before) && isNum(change.after)) {
    let next = cur + change.after - change.before;
    // A count that never went below nothing does not start now: damage taken
    // and healed since, a pool refilled by a rest since.
    if (change.before >= 0 && change.after >= 0) next = Math.max(0, next);
    if (!dry) write(at, next);
    return 'done';
  }
  return Array.isArray(change.before) || Array.isArray(change.after) ? 'conflict' : 'skip';
}

/*
 * What the card table says about the last thing that happened: its log, the
 * last roll, the last trigger. They never decide anything, so two actions
 * that both wrote one have not touched the same thing.
 */
const NOTE_KEYS = new Set(['log', 'lastRoll', 'lastTrigger']);
const isNote = (path) => path.some((step) => typeof step === 'string' && NOTE_KEYS.has(step));

/* A path as a string, and whether one path holds the other. */
const pathKey = (path) => path.map((s) => (typeof s === 'string' ? s : 'id' in s ? `#${s.id}` : `@${s.i}`)).join('\u0001');
const overlaps = (a, b) => a === b || a.startsWith(`${b}\u0001`) || b.startsWith(`${a}\u0001`);

/** The live model as a document `applyChange` can write into. */
const liveDoc = (model) => ({ data: model.data, trackers: model.trackers });

/**
 * Keep every snapshot on the other stack in step with play.
 *
 * A removal's snapshot is the whole document as it stood, damage and pips
 * included. Taking the removal back must not also take back the damage done
 * since -- or bring back damage already undone -- so each play action and
 * each undo of one is written into the snapshots too. Leniently: a snapshot
 * that cannot take a change keeps what it had.
 */
function patchSnapshots(model, changes) {
  for (const entry of model.undoStack || []) {
    const doc = { data: entry.state.data, trackers: entry.state.trackers };
    for (const change of changes) applyChange(doc, change);
  }
}

/**
 * Run `fn` as one play action named `label`, and keep what it changed.
 *
 * `label` names the action the way the button will offer it back -- "Undo
 * 5 damage", "Undo New day" -- and may be a function of what `fn` returned,
 * for an action that only knows what it did once it has done it. A label that
 * comes out empty, or an action that changed nothing, keeps nothing. An
 * action run inside another is part of the outer one.
 */
export function playAction(model, label, fn) {
  if (model.playing) return fn();
  // Reading hit points writes the defaults a fresh sheet lacks -- current is
  // the maximum -- so it is read first. Otherwise the first damage records
  // "no figure → 543", and there is no number to move back by.
  readDefaults(model);
  const before = clone(playState(model));
  model.playing = true;
  let result;
  try {
    result = fn();
  } finally {
    model.playing = false;
  }
  const after = playState(model);
  const changes = [];
  diffInto(changes, ['data'], before.data, after.data);
  // Only trackers there both times: one the action brought into being (Mythic
  // Power at a new tier) is not something it spent.
  for (const [id, t] of Object.entries(before.trackers)) {
    if (after.trackers[id]) diffInto(changes, ['trackers', id, 'current'], t.current, after.trackers[id].current);
  }
  const named = typeof label === 'function' ? label(result) : label;
  if (!changes.length || !named) return result;
  if (!model.playStack) model.playStack = [];
  const entry = { label: String(named), changes, seq: ++counter };
  model.playStack.push(entry);
  if (model.playStack.length > PLAY_DEPTH) model.playStack.shift();
  patchSnapshots(model, changes);
  emit(model, { type: 'play-mark', label: entry.label, seq: entry.seq });
  return result;
}

/** The play actions that can be taken back, newest first: `{ seq, label }`. */
export function playActions(model) {
  return (model.playStack || []).map(({ seq, label }) => ({ seq, label })).reverse();
}

/** A number held inside a range that may have moved since. */
const within = (value, lo, hi) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), value));

/**
 * After a number has moved back, hold it where the rules keep it: a tracker
 * inside its range, hit points no higher than the most there are. Only the
 * paths the undo wrote, and only once the ranges are worked out again.
 */
function settle(model, changes) {
  let moved = false;
  for (const { path } of changes) {
    if (path[0] === 'trackers') {
      const t = model.trackers.find((x) => x?.id === path[1]);
      if (!t) continue;
      const held = within(Number(t.current) || 0, Number(t.min) || 0, Number(t.max) || 0);
      if (held !== t.current) { t.current = held; moved = true; }
    } else if (path[1] === 'hp' && path[2] === 'current' && path.length === 3) {
      const hp = model.data.hp;
      const max = model.hpMax;
      if (hp && Number(hp.current) > max) { hp.current = max; moved = true; }
    }
  }
  if (moved) model.recompute();
}

/**
 * Take back one play action -- the newest, or the one numbered `seq` -- and
 * nothing else.
 *
 * Returns `{ label, ok, reason }`, or null when there is no such action.
 * Refused, with nothing written, when something that happened since cannot
 * survive it: the card drawn has been played, the list has been cut. The
 * reason names the later action to take back first, when there is one.
 */
export function undoPlay(model, seq) {
  const stack = model.playStack || [];
  const at = seq === undefined || seq === null ? stack.length - 1 : stack.findIndex((e) => e.seq === seq);
  const entry = stack[at];
  if (!entry) return null;
  /*
   * Out of turn only past actions that left it alone. Damage and then a heal
   * are two answers to one question -- how many hit points -- and taking the
   * first back while keeping the second has no single right answer (the heal
   * may have been cut at the maximum; a New day set the figure outright). So
   * the later one is named and goes first. A spend and the damage after it
   * touch different things, and that is the case this is for.
   */
  const mine = entry.changes.filter((c) => !isNote(c.path)).map((c) => pathKey(c.path));
  const later = stack.slice(at + 1).reverse().find((e) => e.changes
    .some((c) => !isNote(c.path) && mine.some((k) => overlaps(k, pathKey(c.path)))));
  if (later) return { label: entry.label, ok: false, reason: `${later.label} changed the same thing since. Undo that first.` };
  const back = entry.changes.map(reversed).reverse();
  const doc = liveDoc(model);
  // Something not kept as a play action -- a list edited by hand -- can still
  // stand in the way.
  if (back.some((change) => applyChange(doc, change, { dry: true }) === 'conflict')) {
    return { label: entry.label, ok: false, reason: 'the sheet has changed there since.' };
  }
  for (const change of back) applyChange(doc, change);
  stack.splice(at, 1);
  patchSnapshots(model, back);
  model.recompute();
  settle(model, back);
  emit(model, { type: 'undo', label: entry.label });
  return { label: entry.label, ok: true, reason: '' };
}

/**
 * What to call a row that is being removed.
 *
 * Rows are the shapes the panels happen to build, so this asks the fields a
 * person would have typed a name into, in the order a person would have
 * reached for them, and falls back to the kind of thing it is. Anything long
 * is cut: this ends up in a sentence on a toast, not in a heading.
 */
const NAME_FIELDS = ['name', 'label', 'title', 'feat', 'talent', 'skill', 'spell', 'item', 'text'];

export function rowLabel(item, fallback = 'row') {
  if (typeof item === 'string') return item.trim().slice(0, 40) || fallback;
  if (!item || typeof item !== 'object') return fallback;
  for (const field of NAME_FIELDS) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 40);
  }
  return fallback;
}
