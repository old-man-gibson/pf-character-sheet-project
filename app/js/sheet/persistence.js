/**
 * sheet/persistence.js -- where a sheet's edits are written down, and how it
 * goes back: the working copy, the saved version, snapshots and checkpoints,
 * the undo stacks kept for a reload, and the same character in two windows.
 *
 * This lived in sheet-element.js, which no Node suite can load. The history
 * store comes from `historyFor` (history.js), which a test replaces with a
 * fake, so tests/persistence.test.mjs runs all of it without a browser.
 * Rendering stays the sheet's: it reads what it draws off the fields below,
 * and everything else goes through the `host`:
 *
 *   model()              the character open now, or null
 *   adoptDocument(doc)   build the model from a document (it then calls `settle`)
 *   adoptSynced(doc, n)  take another window's copy, n changes away, and redraw
 *   render(), renderHeader(opts)
 *   note(text)           the notice under the rail; null clears it
 *   isPublished()        a published sheet writes nothing down
 *   attr(name)           the element's `storage-key` and `snapshot-every`
 *   typingIn()           the field being typed in, if one is
 *   saveFailed(failed)   show or hide the "not being saved" banner in place
 */

import {
  historyFor, countChanges, requestPersistence, workingKey, SNAPSHOT_EVERY,
} from '../history.js';
import { migrateDocument, readableSchema } from '../model/migrations.js';
import { tabId, undoKey, readUndo, writeUndo } from '../undo-store.js';

export class SheetStore {
  /** @param opts.historyFor  the store for a character id; history.js's, or a test's */
  constructor(host, { historyFor: storeFor = historyFor } = {}) {
    this.host = host;
    this.storeFor = storeFor;
  }

  /*
   * `history` is this character's store. `savedDoc` is the canonical version
   * it opened on, kept in memory because every change count is measured against
   * it. `changes` is that count; `snapshotAt` is what it stood at when the
   * last automatic snapshot was taken, so snapshots land every
   * `SNAPSHOT_EVERY` changes rather than on every edit once the threshold is
   * passed. `resume` is an offer to pick up unsaved work found on load.
   */
  history = null;
  savedDoc = null;
  openedDoc = null;        // stands in for a saved version until there is one
  changes = 0;
  snapshotAt = 0;
  resume = null;
  recoveries = [];
  staleSaved = false;
  snapshots = [];
  storageFailed = false;   // the working state is not being written -- see writeWorking
  undoKept = null;         // undo stacks kept beside unsaved work, waiting for a resume
  #snapshotTimer = null;
  #undoSaveTimer = null;
  /** The key and each stack's length and end entries when the stacks were last written. */
  #undoWritten = null;

  /** How far the sheet may drift from the saved version before a snapshot. */
  get snapshotEvery() {
    const n = Number(this.host.attr('snapshot-every'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : SNAPSHOT_EVERY;
  }

  /**
   * What the change count is counted from.
   *
   * The saved version once there is one. Until then it is the sheet as this page
   * opened it, because there is no other fixed point: a character that has never
   * been saved has to count from somewhere, or the Save button would sit
   * disabled at zero changes and the first save could never be made.
   *
   * Not the sheet's source document, which is the document as converted or
   * imported. That is the right thing for Reset to restore but the wrong thing
   * to count against -- `toJSON()` normalises a document on the way out, adding
   * tracker state and dropping derived values, so an untouched sheet would open
   * reporting dozens of changes it has not made.
   */
  get baseline() { return this.savedDoc ?? this.openedDoc; }

  /**
   * Read what this browser holds for the character and decide which version
   * opens. Returns `{ open, drifted, keptUndo }`: the sheet adopts `open`, and
   * puts `keptUndo` back at once unless `drifted`, when it waits for a resume.
   *
   * Three documents can be in play. `doc` is the sheet as converted or
   * imported. The *working* state is where the player last left off, written on
   * every edit. The *canonical* version is what they last pressed Save on, and
   * that is what opens -- so Save means something, and so a session of
   * experiments does not silently become the character.
   *
   * Unsaved work is never dropped on the floor for that. When the working state
   * has drifted from the canonical one, it is filed as a snapshot before
   * anything else happens, and the offer to pick it up points at that snapshot.
   * So the recovery survives ignoring the banner, closing the tab, or a crash
   * two minutes later -- it is in the history like any other earlier state.
   */
  async open(doc) {
    const published = this.host.isPublished();
    this.history = this.storeFor(doc?.id ?? 'character', { storageKey: this.host.attr('storage-key') });
    // Ask once that this browser keep what it is about to be given. A published
    // view is exempt: it writes nothing down, so asking a stranger's browser to
    // set aside durable room for a sheet it will not keep is a prompt for
    // nothing. Deliberately not awaited -- the answer changes no code path here.
    if (!published) requestPersistence();
    this.resume = null;
    this.snapshotAt = 0;

    /*
     * A published document is the whole truth and nothing stored here outranks
     * it. What this browser holds under the same id is a different copy of the
     * character -- and on a preview it is the author's own, which would quietly
     * replace the document being previewed with the one it was made from. That
     * is the single thing a preview must never do, and it is not only a preview
     * problem: two people can each be sent a sheet whose id matches one they
     * already have.
     */
    const working = published ? null : this.history.readWorking();
    this.recoveries = published ? [] : this.history.readRecoveries();
    const canonical = published ? null : await this.history.readSaved();
    this.savedDoc = canonical?.data ?? null;
    // The undo stacks this tab kept, if the working copy is still the one it
    // wrote: another window's later write makes them someone else's past.
    const mine = !!working && !!working.by && working.by === tabId();
    const keptUndo = mine ? readUndo(this.undoStoreKey(doc?.id)) : null;
    this.undoKept = null;
    this.staleSaved = !!canonical && !canonical.data;

    const open = published ? doc : (this.savedDoc ?? working?.data ?? doc);
    let drifted = false;
    if (this.savedDoc && working) {
      const drift = countChanges(this.savedDoc, working.data);
      if (drift > 0) {
        drifted = true;
        this.resume = { changes: drift, savedAt: working.savedAt, key: null, doc: working.data };
        // Filed before the working slot is reconciled, so the recovery
        // outlives the banner rather than depending on it.
        try {
          const filed = await this.history.snapshot(working.data, drift);
          this.resume.key = filed.key;
        } catch { /* no room or no database: the offer stands for this session */ }
      }
    }
    return { open, drifted, keptUndo };
  }

  /**
   * A model was just built; `normalized` is its `toJSON()` once its play state
   * has settled. Count it against the baseline.
   */
  settle(normalized) {
    // Cloned, not kept: `toJSON()` spreads `this.data` shallowly, so the object
    // it returns shares every nested branch with the live model. Holding it as
    // the baseline would mean comparing the sheet against itself, and the change
    // count would sit at zero forever.
    if (!this.savedDoc) this.openedDoc = structuredClone(normalized);
    this.changes = this.baseline ? countChanges(this.baseline, normalized) : 0;
  }

  /**
   * Every edit lands here.
   *
   * The working state is written straight away and synchronously, which is the
   * whole reason it lives in localStorage: this is the write that has to have
   * happened if the tab is closed a moment later. Counting changes and taking a
   * snapshot are neither cheap nor urgent, so they wait for the typing to stop.
   */
  persist() {
    if (!this.host.model() || !this.history) return;
    this.writeWorking();
    this.keepUndoSoon();

    clearTimeout(this.#snapshotTimer);
    this.#snapshotTimer = setTimeout(() => this.considerSnapshot(), 800);
  }

  /**
   * Write the working state, and say so when it does not land.
   *
   * `writeWorking` has always returned whether the write happened, and until
   * now every caller threw the answer away -- so a player whose localStorage
   * was full, or who was in a private window that gives none, kept editing a
   * sheet that had quietly stopped being written down and found out when they
   * closed the tab. Silence is the one wrong answer here: the sheet cannot fix
   * it, but it can stop the player from spending an evening on a character
   * that is not going to be there.
   *
   * The banner is toggled in place rather than through a render, because
   * this is called on every edit and a wholesale re-render mid-word takes the
   * caret out of whatever is being typed. It is only touched when the state
   * actually turns over, so the ordinary path costs one boolean compare.
   */
  writeWorking() {
    const ok = this.history.writeWorking(this.host.model().toJSON(), tabId()) !== false;
    if (ok === !this.storageFailed) return ok;   // nothing has changed
    this.storageFailed = !ok;
    this.host.saveFailed(!ok);
    return ok;
  }

  /* ---------------- the undo stacks, for a reload of this tab ---------------- */

  /** Where this character's undo stacks are kept for a reload of this tab. */
  undoStoreKey(id = this.host.model()?.data?.id) {
    return undoKey(this.host.attr('storage-key') || workingKey(id || 'character'));
  }

  /** Keep the undo stacks a moment after the change that moved them. */
  keepUndoSoon() {
    if (this.host.isPublished()) return;
    clearTimeout(this.#undoSaveTimer);
    this.#undoSaveTimer = setTimeout(this.keepUndoNow, 400);
  }

  keepUndoNow = () => {
    if (this.#undoSaveTimer === null) return;
    clearTimeout(this.#undoSaveTimer);
    this.#undoSaveTimer = null;
    const model = this.host.model();
    if (!model || this.host.isPublished()) return;
    // The stacks hold up to twenty whole documents, so they are written only
    // when they moved: any push, pop or trim changes a length or an end entry.
    const key = this.undoStoreKey();
    const state = model.undoState();
    const shape = [key, ...['undo', 'play', 'redo'].flatMap((k) => [state[k].length, state[k][0], state[k].at(-1)])];
    if (this.#undoWritten?.every((v, i) => v === shape[i])) return;
    this.#undoWritten = writeUndo(key, state) ? shape : null;
  };

  /* ------------------------------------------------------------------ *
   * The same character in two windows.
   *
   * Each window keeps its own model and writes the working copy on every
   * change; nothing used to listen, so a deck built in one window and a
   * Save pressed there left the other window on the old state until a
   * reload. Every write to localStorage fires `storage` in the other
   * windows of the origin, so the working copy is the live channel: a
   * window whose copy changed under it adopts the new one. The canonical
   * version and the checkpoints live in IndexedDB, which fires nothing, so
   * a save stamps a marker key as well, and the other windows read their
   * saved version and their list again.
   *
   * A window being typed in waits until the field is left, since adopting
   * is a wholesale render and would take the caret; the latest copy wins
   * then. Two windows edited at once settle on whichever wrote last, which
   * is what one player with two windows means.
   * ------------------------------------------------------------------ */

  /** A copy from another window waiting for the field being typed in to be left. */
  #pendingSync = null;
  #syncTimer = null;

  /** The marker a save or a checkpoint stamps for the other windows. */
  #historyMarkKey() { return `${workingKey(this.host.model()?.data?.id || 'character')}:history`; }

  #markHistory() {
    try { localStorage.setItem(this.#historyMarkKey(), new Date().toISOString()); } catch { /* the other windows will see it on reload */ }
  }

  onStorage = (e) => {
    const model = this.host.model();
    if (!model || this.host.isPublished() || !e.key) return;
    const id = model.data.id;
    if (e.key === workingKey(id)) {
      if (!e.newValue) return;
      let copy;
      try { copy = JSON.parse(e.newValue); } catch { return; }
      if (!copy?.data || !readableSchema(copy.data.schemaVersion)) return;
      try { this.#pendingSync = migrateDocument(copy.data); } catch { return; }
      // Typing in the other window writes on every keystroke; settle first.
      clearTimeout(this.#syncTimer);
      this.#syncTimer = setTimeout(() => this.applySync(), 250);
    } else if (e.key === this.#historyMarkKey()) {
      this.syncHistory();
    }
  };

  /** Adopt the other window's working copy, unless a field here is being typed in. */
  applySync() {
    const data = this.#pendingSync;
    const model = this.host.model();
    if (!data || !model) return;
    const active = this.host.typingIn();
    if (active) {
      active.addEventListener('blur', () => this.applySync(), { once: true });
      return;
    }
    this.#pendingSync = null;
    const mine = model.toJSON();
    if (JSON.stringify(data) === JSON.stringify(mine)) return;
    this.host.adoptSynced(data, countChanges(mine, data, 500));
  }

  /** Another window saved, or kept a checkpoint: the saved version and the list are read again. */
  async syncHistory() {
    const model = this.host.model();
    if (!model || !this.history) return;
    const canonical = await this.history.readSaved();
    if (this.host.model() !== model) return;
    if (canonical?.data) this.savedDoc = canonical.data;
    this.staleSaved = !!canonical && !canonical.data;
    await this.refreshSnapshots();
    if (this.host.model() !== model) return;
    this.changes = this.baseline ? countChanges(this.baseline, model.toJSON()) : 0;
    if (this.changes < this.snapshotAt) this.snapshotAt = this.changes;
    this.host.renderHeader();
  }

  /** The sheet is leaving the page: a copy waiting for a field is dropped. */
  close() {
    clearTimeout(this.#syncTimer);
    this.#pendingSync = null;
  }

  /* ---------------- snapshots, Save, checkpoints, restore, reset ---------------- */

  /**
   * Recount the drift from the saved version, and snapshot if it has gone far
   * enough.
   *
   * The trigger is measured from `snapshotAt` rather than from zero, so
   * snapshots fall every `snapshot-every` changes -- at 20, 40, 60 -- instead of
   * on every edit once the sheet is 20 changes out.
   */
  async considerSnapshot() {
    const model = this.host.model();
    if (!model || !this.history || !this.baseline) return;
    const before = this.changes;
    const live = model.toJSON();
    this.changes = countChanges(this.baseline, live);

    // Drifting back towards the saved version moves the next trigger back with
    // it, or undoing twenty edits would earn a snapshot for standing still.
    if (this.changes < this.snapshotAt) this.snapshotAt = this.changes;

    if (this.changes - this.snapshotAt >= this.snapshotEvery) {
      this.snapshotAt = this.changes;
      try {
        await this.history.snapshot(live, this.changes);
        await this.refreshSnapshots();
      } catch { /* no database or no room: editing carries on regardless */ }
    }
    // The header shows the count, so it only needs redrawing when it moved.
    if (this.changes !== before) this.host.renderHeader({ gentle: true });
  }

  /** Re-read the stored history, for the panel and the button's count. */
  async refreshSnapshots() {
    this.snapshots = this.history ? await this.history.list() : [];
  }

  /**
   * Make what is on screen the canonical version.
   *
   * The change count returns to zero and the snapshot trigger resets with it, so
   * the next twenty edits are measured from here.
   */
  async save() {
    const model = this.host.model();
    const history = this.history;
    if (!model || !history) return;
    // Snapshot before the asynchronous write: later typing must not mutate
    // the baseline of the version that actually reached the database.
    const doc = structuredClone(model.toJSON());
    try {
      await history.save(doc);
      if (this.host.model() !== model) return;
      // Cloned for the same reason as in `settle`: what `toJSON()` returns
      // still points into the live model.
      this.savedDoc = structuredClone(doc);
      this.staleSaved = false;
      await this.refreshSnapshots();
      if (this.host.model() !== model) return;
      this.changes = countChanges(doc, model.toJSON());
      this.snapshotAt = 0;
      this.resume = null;
      this.host.note(this.changes
        ? 'Saved. Newer edits are still unsaved.'
        : 'Saved. This is the version the sheet will open on.');
      this.#markHistory();
    } catch (err) {
      if (this.host.model() !== model) return;
      this.host.note(`Could not save — ${err.message}.`
        + ' Your edits are still here and still restored on reload.');
    }
    // Nothing outside the header depends on the saved version, and the body may
    // be several thousand inputs.
    this.host.renderHeader();
  }

  /**
   * Store the current state under a name, where nothing will evict it.
   * Returns whether it was kept; the sheet then clears its draft and redraws.
   */
  async checkpoint(label) {
    const model = this.host.model();
    if (!label || !model || !this.history) return false;
    try {
      await this.history.checkpoint(model.toJSON(), label, this.changes);
      this.host.note(`Checkpoint “${label}” kept. Automatic snapshots will not evict it.`);
      await this.refreshSnapshots();
      this.#markHistory();
      return true;
    } catch (err) {
      this.host.note(`Could not keep that checkpoint — ${err.message}.`);
      return false;
    }
  }

  /**
   * Open an earlier state.
   *
   * The restored document becomes the working state, not the canonical one --
   * looking at an old state is not the same as declaring it current, and the
   * player still has to press Save to mean that. The state being left behind is
   * filed first, so a restore is itself undoable.
   */
  async restore(key) {
    if (!this.history) return;
    try {
      const doc = await this.history.load(key);
      const current = this.host.model()?.toJSON();
      if (current && this.changes > 0) {
        try { await this.history.snapshot(current, this.changes); } catch { /* best effort */ }
      }
      this.host.adoptDocument(doc);
      this.writeWorking();
      this.snapshotAt = this.changes;
      this.resume = null;
      const when = this.snapshots.find((s) => s.key === key);
      this.host.note(`Restored ${when?.label ? `“${when.label}”` : 'that snapshot'}.`
        + ' Press Save to make it the version this sheet opens on.');
      await this.refreshSnapshots();
    } catch (err) {
      this.host.note(`Could not restore that — ${err.message}.`);
    }
    this.host.render();
  }

  /** Forget a snapshot or checkpoint, then redraw the list. */
  forget(key) {
    return this.history?.remove(key)
      .then(() => this.refreshSnapshots())
      .then(() => this.host.renderHeader())
      .catch(() => { /* already gone */ });
  }

  /**
   * Reset's half: the working state, the canonical version and the automatic
   * snapshots go, and the named checkpoints stay -- a Reset pressed by mistake
   * should not be the one action a player cannot walk back. The sheet then
   * opens its source document again.
   */
  async reset() {
    if (this.history) await this.history.resetKeepingCheckpoints();
    this.savedDoc = null;
    this.changes = 0;
    this.snapshotAt = 0;
    this.resume = null;
  }
}
