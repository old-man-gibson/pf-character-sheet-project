/** The undo and redo stacks kept across a reload (app/js/undo-store.js), over a
 *  fake sessionStorage with a size limit. No fixtures, no DOM.
 *  Run: node tests/undo-store.test.mjs */
import { readUndo, writeUndo } from '../app/js/undo-store.js';
import { check, finish } from './check.mjs';

/** A sessionStorage that holds at most `limit` characters, and counts its writes. */
function fakeSession(limit = Infinity) {
  const m = new Map();
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const s = {
    writes: 0,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      s.writes++;
      const was = m.get(k);
      m.set(k, String(v));
      if (used() > limit) {
        if (was === undefined) m.delete(k); else m.set(k, was);
        const e = new Error('full'); e.name = 'QuotaExceededError'; throw e;
      }
    },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  return s;
}

const snap = (seq, size = 100) => ({ label: `edit ${seq}`, seq, state: { data: { pad: 'x'.repeat(size) } } });
const stacks = (n, size) => ({ undo: Array.from({ length: n }, (_, i) => snap(i + 1, size)), play: [{ label: 'Ki 5 → 4', seq: 99, changes: [] }], redo: [] });

console.log('the stacks read back as written');
{
  globalThis.sessionStorage = fakeSession();
  const state = stacks(3, 10);
  check('written', writeUndo('a:undo', state), true);
  check('and read back the same', readUndo('a:undo'), state);
  check('empty stacks remove the key', [writeUndo('a:undo', { undo: [], play: [], redo: [] }), readUndo('a:undo')], [true, null]);
}

console.log('a write that does not fit drops other characters\' stacks before its own steps');
{
  const session = fakeSession(6000);
  globalThis.sessionStorage = session;
  writeUndo('other:undo', stacks(20, 100));   // about 3,000 characters
  const mine = stacks(20, 100);
  check('the write fits once the other stacks are gone', writeUndo('mine:undo', mine), true);
  check('the other character\'s stacks were dropped', readUndo('other:undo'), null);
  check('and none of this character\'s steps', readUndo('mine:undo').undo.length, 20);
}

console.log('then the oldest snapshots, keeping play actions');
{
  const session = fakeSession(1500);
  globalThis.sessionStorage = session;
  check('the write fits', writeUndo('mine:undo', stacks(20, 100)), true);
  const kept = readUndo('mine:undo');
  check('some of the oldest snapshots went', kept.undo.length < 20 && kept.undo.length > 0, true);
  check('the newest snapshot stayed', kept.undo.at(-1).seq, 20);
  check('the play action stayed', kept.play.length, 1);
  check('one try per dropped entry and no more', session.writes, 1 + (20 - kept.undo.length));
}

finish();
