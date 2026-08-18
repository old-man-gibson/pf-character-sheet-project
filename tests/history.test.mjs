/** Tests the parts of the history store that do not need a database: what
 *  counts as a change, what gets evicted, and the compression snapshots use.
 *  Run: node tests/history.test.mjs */
import { existsSync } from 'node:fs';
import { characterPath, loadCharacter } from './fixtures.mjs';
import {
  countChanges, pack, unpack, evictable, workingKey, AUTO_KEEP, SNAPSHOT_EVERY,
} from '../app/js/history.js';
import { Character, SCHEMA_VERSION } from '../app/js/model.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, cond) => {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${label}`); }
};

const doc = loadCharacter;
// The checks against real characters need the private fixtures (see fixtures.mjs).
const REAL = ['saburo', 'angou'];
const FIX = REAL.every((id) => existsSync(characterPath(id)));
if (!FIX) console.log('(private character fixtures not found -- checks against real characters are skipped)\n');

console.log('counting changes -- nothing changed');
check('identical scalars', countChanges(1, 1), 0);
check('identical strings', countChanges('a', 'a'), 0);
check('identical nulls', countChanges(null, null), 0);
check('identical objects', countChanges({ a: 1, b: 2 }, { a: 1, b: 2 }), 0);
check('identical arrays', countChanges([1, 2, 3], [1, 2, 3]), 0);
check('identical nesting', countChanges({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } }), 0);
check('key order is not a change', countChanges({ a: 1, b: 2 }, { b: 2, a: 1 }), 0);

console.log('\ncounting changes -- one leaf at a time');
check('one scalar', countChanges(1, 2), 1);
check('one field', countChanges({ a: 1, b: 2 }, { a: 9, b: 2 }), 1);
check('two fields', countChanges({ a: 1, b: 2 }, { a: 9, b: 9 }), 2);
check('one nested field', countChanges({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }), 1);
check('one array element', countChanges([1, 2, 3], [1, 9, 3]), 1);
check('null to a number', countChanges({ a: null }, { a: 3 }), 1);
check('number to null', countChanges({ a: 3 }, { a: null }), 1);
check('string to number', countChanges({ a: '3' }, { a: 3 }), 1);
check('false is not missing', countChanges({ a: false }, { a: true }), 1);
check('zero is not null', countChanges({ a: 0 }, { a: null }), 1);

console.log('\ncounting changes -- whole subtrees appear and vanish');
check('added scalar key', countChanges({ a: 1 }, { a: 1, b: 2 }), 1);
check('removed scalar key', countChanges({ a: 1, b: 2 }, { a: 1 }), 1);
check('added subtree counts its leaves',
  countChanges({}, { a: { b: 1, c: 2, d: 3 } }), 3);
check('removed subtree counts its leaves',
  countChanges({ a: { b: 1, c: 2, d: 3 } }, {}), 3);
check('a longer array counts the new elements', countChanges([1], [1, 2, 3]), 2);
check('a shorter array counts the lost ones', countChanges([1, 2, 3], [1]), 2);
check('appending an object counts its leaves',
  countChanges([], [{ a: 1, b: 2 }]), 2);
check('a leaf becoming a subtree', countChanges({ a: 1 }, { a: { b: 1, c: 2 } }), 2);
check('an object becoming an array', countChanges({ a: { b: 1 } }, { a: [1] }), 1);
check('an empty object is one leaf', countChanges({ a: {} }, { a: 1 }), 1);
check('an empty array is one leaf', countChanges({ a: [] }, { a: 1 }), 1);

console.log('\ncounting changes -- undefined reads as absent, whichever store it came from');
// A document through JSON.stringify has dropped these keys; one read back from
// IndexedDB has kept them. The same sheet must not look edited either way.
check('undefined equals missing', countChanges({ a: 1, b: undefined }, { a: 1 }), 0);
check('missing equals undefined', countChanges({ a: 1 }, { a: 1, b: undefined }), 0);
check('undefined both sides', countChanges({ b: undefined }, { b: undefined }), 0);
check('undefined to a value is a change', countChanges({ b: undefined }, { b: 1 }), 1);

console.log('\ncounting changes -- the cap stops the walk');
{
  const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ v: i })) };
  const other = { rows: Array.from({ length: 5000 }, (_, i) => ({ v: -i })) };
  const capped = countChanges(big, other, 10);
  ok('the cap is respected', capped >= 10 && capped < 100);
  check('uncapped counts everything', countChanges(big, other), 4999); // v:0 === -0
  check('a cap does not invent changes', countChanges(big, big, 10), 0);
}

if (FIX) console.log('\ncounting changes -- a real character');
if (FIX) {
  const a = doc('saburo');
  const b = structuredClone(a);
  check('a document equals itself', countChanges(a, b), 0);

  b.abilities.str.score += 1;
  check('one ability score', countChanges(a, b), 1);

  b.identity.name = 'Someone Else';
  check('and a name', countChanges(a, b), 2);

  // What a typo typed and corrected is worth: nothing.
  b.abilities.str.score -= 1;
  b.identity.name = a.identity.name;
  check('corrected back to source', countChanges(a, b), 0);

  const c = doc('angou');
  ok('two different characters differ a lot', countChanges(a, c, 500) >= 500);
}

if (FIX) console.log('\ncounting changes -- the baseline has to be a settled document');
if (FIX) {
  /*
   * `hpState` fills in current, temporary and nonlethal hit points the first time
   * it is read. A baseline taken before that read sees three fields appear on
   * their own afterwards, and the sheet then reports three changes nobody made --
   * and can never get back to zero, because undoing an edit cannot unmake them.
   * `#adoptDocument` settles the play state first; this is the assertion that
   * says why.
   */
  const raw = doc('saburo');

  const eager = new Character(structuredClone(raw));
  const beforeSettling = structuredClone(eager.toJSON());
  void eager.hpState;                     // what the first render does
  check('an unsettled baseline drifts on its own',
    countChanges(beforeSettling, eager.toJSON()), 3);

  const settled = new Character(structuredClone(raw));
  void settled.hpState;
  const baseline = structuredClone(settled.toJSON());
  check('a settled baseline does not', countChanges(baseline, settled.toJSON()), 0);

  // And an edit made against it counts once, and unmakes cleanly.
  const was = settled.data.identity.alignment;
  settled.set('identity.alignment', 'Chaotic Good');
  check('one edit counts once', countChanges(baseline, settled.toJSON()), 1);
  settled.set('identity.alignment', was);
  check('and undoing it returns to zero', countChanges(baseline, settled.toJSON()), 0);
}

console.log('\nthe eviction policy');
{
  const rec = (seq, kind, label = '') => ({ key: `x#${seq}`, seq, kind, label });
  check('nothing to evict when empty', evictable([]), []);
  check('under the limit keeps everything',
    evictable([rec(1, 'auto'), rec(2, 'auto')]), []);
  check('at the limit keeps everything',
    evictable(Array.from({ length: AUTO_KEEP }, (_, i) => rec(i + 1, 'auto'))), []);
  check('over the limit drops the oldest',
    evictable(Array.from({ length: AUTO_KEEP + 2 }, (_, i) => rec(i + 1, 'auto'))),
    ['x#2', 'x#1']);
  check('checkpoints are never evicted',
    evictable([
      ...Array.from({ length: 20 }, (_, i) => rec(i + 1, 'checkpoint', `c${i}`)),
      ...Array.from({ length: AUTO_KEEP }, (_, i) => rec(100 + i, 'auto')),
    ]), []);
  check('checkpoints do not count toward the limit',
    evictable([
      ...Array.from({ length: 20 }, (_, i) => rec(i + 1, 'checkpoint')),
      ...Array.from({ length: AUTO_KEEP + 1 }, (_, i) => rec(100 + i, 'auto')),
    ]), ['x#100']);
  check('the canonical version is not a snapshot',
    evictable([rec(0, 'saved'), ...Array.from({ length: AUTO_KEEP + 1 }, (_, i) => rec(i + 1, 'auto'))]),
    ['x#1']);
  check('a custom depth is honoured',
    evictable([rec(1, 'auto'), rec(2, 'auto'), rec(3, 'auto')], 1), ['x#2', 'x#1']);
}

console.log('\ncompression -- what a snapshot actually costs');
{
  for (const id of FIX ? REAL : []) {
    const original = doc(id);
    const bytes = await pack(original);
    const back = await unpack(bytes);
    check(`${id} survives the round trip`,
      JSON.stringify(back), JSON.stringify(original));
    ok(`${id} is bytes, not a string`, bytes instanceof Uint8Array);

    const json = JSON.stringify(original).length;
    ok(`${id} compresses at least fivefold`, bytes.length * 5 < json);
    console.log(`  ${id}: ${(json / 1024).toFixed(0)} KB of JSON`
      + ` -> ${(bytes.length / 1024).toFixed(1)} KB gzipped`
      + ` (${AUTO_KEEP} snapshots = ${(bytes.length * AUTO_KEEP / 1024).toFixed(0)} KB)`);
  }

  // Awkward payloads, because a character document is arbitrary player text.
  const odd = {
    schemaVersion: SCHEMA_VERSION,
    text: 'ō ✦ — 日本語   \\ " \n\t',
    empty: {}, list: [], nothing: null, deep: { a: { b: { c: [1, [2, [3]]] } } },
  };
  check('awkward text survives', await unpack(await pack(odd)), odd);
}

console.log('\nconstants and keys');
check('the working key is the one the app already used',
  workingKey('saburo'), 'character-sheet:saburo');
ok('five snapshots deep', AUTO_KEEP === 5);
ok('a snapshot every twenty changes', SNAPSHOT_EVERY === 20);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
