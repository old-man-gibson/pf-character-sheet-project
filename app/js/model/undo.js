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
 */

import { emit } from './events.js';

/** How many steps back the stack holds. */
export const UNDO_DEPTH = 20;

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
  if (!model.undoStack) model.undoStack = [];
  const named = String(label || 'change');
  model.undoStack.push({ label: named, state: capture(model) });
  if (model.undoStack.length > UNDO_DEPTH) model.undoStack.shift();
  // Announced rather than returned, so that every destructive operation offers
  // itself back without each of its thirty call sites having to remember to.
  emit(model, { type: 'undo-mark', label: named });
  return model;
}

/** What the next `undo()` would take back, or null when there is nothing. */
export function undoLabel(model) {
  const top = model.undoStack?.[model.undoStack.length - 1];
  return top ? top.label : null;
}

/** Put the character back the way the last `markUndo` found it. */
export function undo(model) {
  const entry = model.undoStack?.pop();
  if (!entry) return null;
  restore(model, entry.state);
  model.recompute();
  emit(model, { type: 'undo', label: entry.label });
  return entry.label;
}

/** Forget everything. For a document being replaced rather than edited. */
export function clearUndo(model) {
  model.undoStack = [];
  return model;
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
