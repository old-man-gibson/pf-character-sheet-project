import assert from 'node:assert/strict';
import { historyFor, workingKey } from '../app/js/history.js';
import { SCHEMA_VERSION } from '../app/js/model.js';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const rows = new Map();
let deniedKey = null;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => rows.get(key) ?? null,
  setItem(key, value) {
    if (key === deniedKey) throw new Error('Quota exceeded');
    rows.set(key, String(value));
  },
  removeItem: (key) => rows.delete(key),
} });

try {
  const key = workingKey('recovery-test');
  const archive = `${key}:recovery`;
  const history = historyFor('recovery-test');
  const current = { schemaVersion: SCHEMA_VERSION, identity: { name: 'Current' } };
  for (const version of [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1]) {
    rows.clear();
    const raw = JSON.stringify({ savedAt: '2026-01-01', data: {
      schemaVersion: version, identity: { name: 'Original' }, notes: 'Unexported edits',
    } });
    rows.set(key, raw);
    assert.equal(history.readWorking(), null);
    assert.equal(rows.get(key), raw, 'reading must not erase unsupported data');
    assert.equal(history.readRecoveries()[0].raw, raw);
    assert.equal(history.writeWorking(current), true);
    assert.deepEqual(history.readWorking().data, current);
    assert.equal(history.readRecoveries()[0].raw, raw, 'replacement must retain the original bytes');
    assert.equal(history.writeWorking(current), true);
    assert.equal(history.readRecoveries().length, 1, 'normal edits do not duplicate backups');
    rows.set(key, raw);
    history.clearWorking();
    assert.equal(rows.has(key), false);
    assert.equal(history.readRecoveries().length, 1, 'clearing preserves and deduplicates recovery');
  }

  rows.clear();
  const malformed = '{"data": {"unfinished notes":';
  rows.set(key, malformed);
  deniedKey = archive;
  assert.equal(history.writeWorking(current), false, 'no replacement if recovery cannot be stored');
  history.clearWorking();
  assert.equal(rows.get(key), malformed, 'failed backup must also prevent clearing');
  deniedKey = null;
  assert.equal(history.writeWorking(current), true);
  assert.equal(history.readRecoveries()[0].raw, malformed);

  // Several upgrades or damaged drafts must not overwrite earlier recoveries.
  rows.set(key, 'another damaged draft');
  assert.equal(history.writeWorking(current), true);
  assert.equal(history.readRecoveries().length, 2);
  rows.set(key, 'third damaged draft');
  deniedKey = key;
  assert.equal(history.writeWorking(current), false);
  assert.equal(rows.get(key), 'third damaged draft');
  assert.equal(history.readRecoveries().length, 3, 'partial write deduplicates original and archive');
  deniedKey = null;
  rows.set(archive, 'corrupt archive');
  assert.equal(history.writeWorking(current), false, 'never replace an unreadable archive');
  assert.equal(rows.get(key), 'third damaged draft');

  const custom = historyFor('recovery-test', { storageKey: 'embedded-sheet' });
  assert.equal(custom.writeWorking(current), true);
  assert.deepEqual(custom.readWorking().data, current);
  assert.deepEqual(custom.readRecoveries(), [], 'embedded storage keys stay isolated');
  console.log('storage recovery: all checks passed');
} finally {
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
  else delete globalThis.localStorage;
}
