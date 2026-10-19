/**
 * play-log.js -- what happened at the table, kept with the character.
 *
 * The undo list already names every play action -- "6 damage", "New day",
 * "Ki 5 → 4" -- but it lives in memory, holds thirty, and forgets an action
 * once it is taken back. The log is the record: each action as it happens,
 * each undo and redo of one, and notes the player adds ("Session 12: the
 * hydra"), dated, saved on the document (`log`), newest last, the oldest
 * dropped past LOG_MAX.
 *
 * It is written beside the play machinery rather than through it. An entry
 * lands after an action's changes are measured, so it is never one of them:
 * taking an action back leaves its line standing and adds "Undid …", the way
 * a ledger corrects itself. And a snapshot undo keeps the log as it is now
 * (see `restore` in undo.js), since the document it puts back is older than
 * the record of what has happened since.
 */

/** How many entries are kept. */
export const LOG_MAX = 200;

/** Add one line. `kind` is 'play' for the machinery's own lines, 'note' for the player's. */
export function logPlay(model, text, kind = 'play') {
  const line = String(text ?? '').trim();
  if (!line) return null;
  const d = model.data;
  if (!Array.isArray(d.log)) d.log = [];
  const entry = { at: new Date().toISOString(), text: line.slice(0, 300), ...(kind === 'note' ? { kind } : {}) };
  d.log.push(entry);
  if (d.log.length > LOG_MAX) d.log.splice(0, d.log.length - LOG_MAX);
  return entry;
}

/** The entries, newest first. */
export function playLog(model) {
  return [...(Array.isArray(model.data.log) ? model.data.log : [])].reverse();
}
