/** Saving, snapshots, checkpoints, restore, reset, the undo kept for a reload
 *  and the same character in two windows (app/js/sheet/persistence.js), over a
 *  fake history store, storage and model. No fixtures, no DOM.
 *  Run: node tests/persistence.test.mjs */
import { SheetStore } from '../app/js/sheet/persistence.js';
import { SCHEMA_VERSION } from '../app/js/schema.js';
import { workingKey } from '../app/js/history.js';
import { check, finish } from './check.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeStorage() {
  const m = new Map();
  return {
    writes: [],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { this.writes.push(k); m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
globalThis.localStorage = fakeStorage();
globalThis.sessionStorage = fakeStorage();

const doc = (name, extra = {}) => ({ id: 'zz-store', schemaVersion: SCHEMA_VERSION, identity: { name }, ...extra });

/** A history store in memory: what historyFor(id) hands the sheet. */
function fakeHistory({ working = null, saved = null, failSave = false, failWorking = false } = {}) {
  const records = [];
  let n = 0;
  const h = {
    calls: [],
    working,
    saved,
    readWorking: () => { h.calls.push('readWorking'); return h.working; },
    readRecoveries: () => [],
    writeWorking: (d, by) => {
      h.calls.push('writeWorking');
      if (failWorking) return false;
      h.working = { data: structuredClone(d), by, savedAt: 'now' };
      return true;
    },
    readSaved: async () => (h.saved ? { data: h.saved } : null),
    save: async (d) => { if (failSave) throw new Error('the database is full'); h.saved = structuredClone(d); },
    snapshot: async (d, changes) => { const key = `auto-${++n}`; records.push({ key, kind: 'auto', changes, doc: structuredClone(d) }); return { key }; },
    checkpoint: async (d, label) => { records.push({ key: `cp-${++n}`, kind: 'checkpoint', label, doc: structuredClone(d) }); },
    list: async () => records.map(({ doc: _, ...r }) => r),
    load: async (key) => structuredClone(records.find((r) => r.key === key).doc),
    remove: async (key) => { records.splice(records.findIndex((r) => r.key === key), 1); },
    resetKeepingCheckpoints: async () => {
      h.calls.push('reset');
      h.working = null; h.saved = null;
      for (let i = records.length - 1; i >= 0; i--) if (records[i].kind !== 'checkpoint') records.splice(i, 1);
    },
    records,
  };
  return h;
}

/** A model that is its data, with undo stacks. */
const fakeModel = (data) => ({
  data: structuredClone(data),
  toJSON() { return structuredClone(this.data); },
  stacks: { undo: [], play: [], redo: [] },
  undoState() { return this.stacks; },
});

/** A host that records what the store asks of the sheet. */
function fakeHost(attrs = {}) {
  const h = {
    current: null, notes: [], renders: 0, headers: 0, failed: [], synced: [], typing: null, published: false,
    model: () => h.current,
    adoptDocument: (d) => { h.current = fakeModel(d); h.store.settle(h.current.toJSON()); },
    adoptSynced: (d, changes) => { h.synced.push(changes); h.adoptDocument(d); },
    render: () => { h.renders++; },
    renderHeader: () => { h.headers++; },
    note: (text) => { h.notes.push(text); },
    isPublished: () => h.published,
    attr: (name) => attrs[name] ?? null,
    typingIn: () => h.typing,
    saveFailed: (failed) => { h.failed.push(failed); },
  };
  return h;
}
const storeOver = (history, attrs) => {
  const host = fakeHost(attrs);
  const store = new SheetStore(host, { historyFor: () => history });
  host.store = store;
  return { host, store };
};

{
  // A character opened for the first time counts from itself.
  const history = fakeHistory();
  const { host, store } = storeOver(history);
  const opened = await store.open(doc('Vesna'));
  check('a first open shows the document given', opened.open.identity.name, 'Vesna');
  check('with nothing to resume', [opened.drifted, store.resume], [false, null]);
  host.adoptDocument(opened.open);
  check('and no changes', store.changes, 0);
  host.current.data.identity.name = 'Vesna Ashgrove';
  await store.considerSnapshot();
  check('an edit counts against the opened copy', store.changes, 1);
  check('and redraws the header', host.headers, 1);
}

{
  // The saved version opens, and unsaved work is filed and offered back.
  const history = fakeHistory({ saved: doc('Saved'), working: { data: doc('Working', { notes: 'x' }), by: 'another tab', savedAt: 'then' } });
  const { store } = storeOver(history);
  const opened = await store.open(doc('Source'));
  check('the saved version opens', opened.open.identity.name, 'Saved');
  check('the drift is offered', [opened.drifted, store.resume.changes], [true, 2]);
  check('and filed as a snapshot first', [store.resume.key, history.records.length], ['auto-1', 1]);
  check('undo kept by another tab is not taken', opened.keptUndo, null);
}

{
  // A published sheet reads nothing this browser holds under its id.
  const history = fakeHistory({ saved: doc('Mine'), working: { data: doc('Mine too'), by: 'x' } });
  const { host, store } = storeOver(history);
  host.published = true;
  const opened = await store.open(doc('Sent'));
  check('a published sheet opens what it was sent', opened.open.identity.name, 'Sent');
  check('without reading the working copy', history.calls.includes('readWorking'), false);
}

{
  // Snapshots land every `snapshot-every` changes, measured from the last one.
  const history = fakeHistory();
  const { host, store } = storeOver(history, { 'snapshot-every': '3' });
  host.adoptDocument((await store.open(doc('A'))).open);
  check('snapshot-every is read from the attribute', store.snapshotEvery, 3);
  Object.assign(host.current.data, { a: 1, b: 2 });
  await store.considerSnapshot();
  check('two changes take no snapshot', history.records.length, 0);
  host.current.data.c = 3;
  await store.considerSnapshot();
  check('the third takes one', [history.records.length, store.snapshotAt], [1, 3]);
  delete host.current.data.c; delete host.current.data.b;
  await store.considerSnapshot();
  check('drifting back moves the trigger back', store.snapshotAt, 1);
  Object.assign(host.current.data, { b: 2, c: 3 });
  await store.considerSnapshot();
  check('so the next lands three changes on', [store.changes, history.records.length], [3, 1]);
  host.current.data.d = 4;
  await store.considerSnapshot();
  check('and not before', history.records.length, 2);
}

{
  // Save, a failed save, and the marker the other windows watch.
  const history = fakeHistory();
  const { host, store } = storeOver(history);
  host.adoptDocument((await store.open(doc('A'))).open);
  host.current.data.identity.name = 'B';
  await store.considerSnapshot();
  await store.save();
  check('Save stores what is on screen', history.saved.identity.name, 'B');
  check('the count goes back to zero', [store.changes, store.snapshotAt], [0, 0]);
  check('and says so', host.notes.at(-1), 'Saved. This is the version the sheet will open on.');
  check('the other windows are told', localStorage.getItem(`${workingKey('zz-store')}:history`) !== null, true);
  host.current.data.identity.name = 'C';
  const before = history.saved;
  const broken = storeOver(fakeHistory({ failSave: true }));
  broken.host.adoptDocument((await broken.store.open(doc('A'))).open);
  await broken.store.save();
  check('a failed save says the edits are still here', broken.host.notes.at(-1),
    'Could not save — the database is full. Your edits are still here and still restored on reload.');
  check('and stores nothing', before, history.saved);
}

{
  // The working copy: written on every edit, and a write that stops landing is shown once.
  const history = fakeHistory({ failWorking: true });
  const { host, store } = storeOver(history);
  host.adoptDocument((await store.open(doc('A'))).open);
  store.persist();
  store.persist();
  check('every edit writes the working copy', history.calls.filter((c) => c === 'writeWorking').length, 2);
  check('the banner is shown once', host.failed, [true]);
  check('and the store says so', store.storageFailed, true);
}

{
  // Checkpoints, restore and reset.
  const history = fakeHistory();
  const { host, store } = storeOver(history);
  host.adoptDocument((await store.open(doc('A'))).open);
  check('a blank label keeps nothing', await store.checkpoint(''), false);
  check('a named checkpoint is kept', await store.checkpoint('Before the duel'), true);
  check('and listed', store.snapshots.map((s) => s.label), ['Before the duel']);
  host.current.data.identity.name = 'After the duel';
  await store.considerSnapshot();
  await store.restore('cp-1');
  check('restore opens the checkpoint', host.current.data.identity.name, 'A');
  check('after filing what was on screen', history.records.map((r) => r.kind), ['checkpoint', 'auto']);
  check('and says what it opened', host.notes.at(-1), 'Restored “Before the duel”. Press Save to make it the version this sheet opens on.');
  await store.reset();
  check('reset keeps the checkpoints only', history.records.map((r) => r.kind), ['checkpoint']);
  check('and forgets the saved version', [store.savedDoc, store.changes, store.snapshotAt], [null, 0, 0]);
  await store.forget('cp-1');
  check('forget removes a record and rereads the list', store.snapshots, []);
}

{
  // The undo stacks are written only when they move.
  const { host, store } = storeOver(fakeHistory());
  host.adoptDocument((await store.open(doc('A'))).open);
  const writes = () => sessionStorage.writes.filter((k) => k.endsWith(':undo')).length;
  const start = writes();
  host.current.stacks.undo.push({ label: 'edit', seq: 1, state: { data: {} } });
  store.keepUndoSoon();
  store.keepUndoNow();
  check('moved stacks are written', writes() - start, 1);
  store.keepUndoSoon();
  store.keepUndoNow();
  check('unmoved stacks are not written again', writes() - start, 1);
  host.published = true;
  host.current.stacks.undo.push({ label: 'edit', seq: 2, state: { data: {} } });
  store.keepUndoSoon();
  store.keepUndoNow();
  check('a published sheet keeps no undo', writes() - start, 1);
}

{
  // Another window's working copy is adopted once the field being typed in is left.
  const { host, store } = storeOver(fakeHistory());
  host.adoptDocument((await store.open(doc('A'))).open);
  const key = workingKey('zz-store');
  store.onStorage({ key, newValue: JSON.stringify({ data: doc('From the other window') }) });
  await wait(300);
  check('the copy is adopted with its change count', [host.synced, host.current.data.identity.name], [[1], 'From the other window']);
  store.onStorage({ key, newValue: JSON.stringify({ data: { ...doc('Old build'), schemaVersion: SCHEMA_VERSION + 1 } }) });
  await wait(300);
  check('a copy from another version is left alone', host.synced.length, 1);
  const listeners = [];
  host.typing = { addEventListener: (type, fn) => listeners.push([type, fn]) };
  store.onStorage({ key, newValue: JSON.stringify({ data: doc('While typing') }) });
  await wait(300);
  check('nothing is adopted while a field is typed in', [host.synced.length, listeners.map(([t]) => t)], [1, ['blur']]);
  host.typing = null;
  listeners[0][1]();
  check('it is adopted when the field is left', host.current.data.identity.name, 'While typing');
  store.onStorage({ key: 'something-else', newValue: '{}' });
  store.close();
  check('other keys are ignored', host.synced.length, 2);
}

{
  // Another window saved: the saved version is read again and the count follows.
  const history = fakeHistory();
  const { host, store } = storeOver(history);
  host.adoptDocument((await store.open(doc('A'))).open);
  host.current.data.identity.name = 'B';
  await store.considerSnapshot();
  history.saved = doc('B');
  store.onStorage({ key: `${workingKey('zz-store')}:history`, newValue: 'now' });
  await wait(20);
  check('a save elsewhere is picked up', [store.savedDoc?.identity.name, store.changes], ['B', 0]);
}

finish();
