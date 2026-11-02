/**
 * roster.js -- the list of characters this browser keeps, and its trash.
 *
 * Bundled characters are files under data/characters/; imported ones exist
 * only in this browser. An imported character's document sits under
 * `docKey(id)`, its working edits under `editsKey(id)` (history.js), and the
 * list below is what makes it show in the picker after a reload. Removed
 * characters move from the list to the trash and keep everything else, so
 * Undo is moving the entry back.
 *
 * Every function takes the storage to use (localStorage on the page, a fake
 * in tests). A storage that is null or throws on access reads as empty and
 * refuses writes.
 */

export const LIBRARY_KEY = 'character-sheet:library';
export const LAST_KEY = 'character-sheet:last';
export const TRASH_KEY = 'character-sheet:trash';
/** Where an unreadable list is kept when it is rebuilt. */
export const LIBRARY_BACKUP_KEY = 'character-sheet:library-unreadable';
export const docKey = (id) => `character-sheet:doc:${id}`;
export const editsKey = (id) => `character-sheet:${id}`;

/**
 * The list, each entry marked `local`. `rebuilt` is true when the stored list
 * could not be read and was rebuilt from the documents (see rebuildLibrary);
 * the caller writes it back and says so.
 */
export function readLibrary(storage, inspect) {
  let text = null;
  try {
    text = storage.getItem(LIBRARY_KEY);
    const raw = JSON.parse(text || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)
      && (raw.characters === undefined || Array.isArray(raw.characters))) {
      return { list: (raw.characters || []).map((c) => ({ ...c, local: true })), rebuilt: false };
    }
  } catch { /* unreadable: rebuilt below */ }
  if (text === null) return { list: [], rebuilt: false };
  return { list: rebuildLibrary(storage, text, inspect), rebuilt: true };
}

/**
 * A list that cannot be read, rebuilt from the documents stored here.
 *
 * Reading it as empty made the next write drop every character from the
 * picker while their documents stayed in storage. The unreadable text is
 * kept under LIBRARY_BACKUP_KEY. `inspect` is model.js inspectDocument.
 */
export function rebuildLibrary(storage, text, inspect) {
  try { storage.setItem(LIBRARY_BACKUP_KEY, text); } catch { /* the rebuild still lists every document */ }
  const prefix = docKey('');
  const trashed = new Set(readTrash(storage).map((c) => c.id));
  const list = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const id = key?.startsWith(prefix) ? key.slice(prefix.length) : '';
    if (!id || trashed.has(id)) continue;
    try {
      const doc = JSON.parse(storage.getItem(key));
      const verdict = inspect(doc);
      if (verdict.ok) list.push({ ...verdict.summary, color: doc.identity?.color || null, id, origin: 'import', local: true });
    } catch { /* a document that cannot be read stays where it is, unlisted */ }
  }
  return list;
}

/** Save the list. Throws what the storage throws (a full browser, mostly). */
export function writeLibrary(storage, list) {
  storage.setItem(LIBRARY_KEY, JSON.stringify({ characters: list.map(({ local, ...c }) => c) }));
}

export function readTrash(storage) {
  try {
    const raw = JSON.parse(storage.getItem(TRASH_KEY) || '{}');
    return Array.isArray(raw.characters) ? raw.characters : [];
  } catch { return []; }
}

/** Save the trash; an empty one is removed. True when it was saved. */
export function writeTrash(storage, list) {
  try {
    if (list.length) storage.setItem(TRASH_KEY, JSON.stringify({ characters: list }));
    else storage.removeItem(TRASH_KEY);
    return true;
  } catch { return false; }
}
