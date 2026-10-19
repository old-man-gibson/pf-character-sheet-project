/**
 * undo-store.js -- the undo and redo stacks kept across a reload.
 *
 * The stacks live on the model, so a reload used to start them empty: a
 * slip of the finger on F5, or a phone dropping a background tab, and "Undo
 * 5 damage" was gone. They are kept in sessionStorage, which belongs to the
 * one browser tab and survives its reloads, beside a name for that tab.
 *
 * They only come back for the document they were taken from. The working
 * copy in localStorage records which tab wrote it (`by`); a reload that
 * finds another tab's name there -- the character was edited in a second
 * window since -- starts with empty stacks, because a snapshot taken here
 * would otherwise put that window's work back to what this one last saw.
 *
 * Snapshots are whole documents, and sessionStorage has a few megabytes. A
 * write that does not fit drops the oldest snapshots until it does, then the
 * oldest redo entries; play actions are small and are kept to the last.
 */

const TAB_KEY = 'cs-tab-id';

/** This tab's name, made on first use and kept for its reloads. Null without storage. */
export function tabId() {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** The key the stacks for one working copy are kept under. */
export const undoKey = (workingKey) => `${workingKey}:undo`;

/** The stacks kept for `key`, or null. */
export function readUndo(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Keep `state` ({ undo, play, redo }) under `key`, trimming to fit. Answers whether anything was kept. */
export function writeUndo(key, state) {
  const undo = [...(state?.undo ?? [])];
  const play = [...(state?.play ?? [])];
  const redo = [...(state?.redo ?? [])];
  try {
    if (!undo.length && !play.length && !redo.length) {
      sessionStorage.removeItem(key);
      return true;
    }
  } catch {
    return false;
  }
  for (;;) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ undo, play, redo }));
      return true;
    } catch {
      if (undo.length) undo.shift();
      else if (redo.length) redo.shift();
      else if (play.length) play.shift();
      else break;
    }
  }
  try { sessionStorage.removeItem(key); } catch { /* nothing kept either way */ }
  return false;
}
