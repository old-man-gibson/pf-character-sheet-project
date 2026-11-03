/** Tests how a saved document gets from the build that wrote it to this one.
 *
 *  Three parts. The migration runner (model/migrations.js) is driven with
 *  steps made up here, since the real list is empty: it walks a document up
 *  in order, refuses one newer than the build or with a gap below it, and
 *  names the step that failed. The import gate is checked against the public
 *  fixture. And the documents under tests/fixtures/old -- the public fixture
 *  as it was committed at four points since August -- are loaded by the
 *  current model, which must read each one, keep what a reader would look
 *  for, and settle after one load.
 *
 *  Run: node tests/migrations.test.mjs */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Character, SCHEMA_VERSION, inspectDocument } from '../app/js/model.js';
import { MIGRATIONS, migrateDocument, migrationPath, readableSchema } from '../app/js/model/migrations.js';
import { RULE_CORRECTIONS } from '../app/js/rules.js';
import { PUBLIC_FIXTURES } from './fixtures.mjs';
import { check, finish } from './check.mjs';

const threw = (fn) => {
  try { fn(); return null; } catch (err) { return err; }
};

/* ---------------- the runner, with made-up steps ---------------- */

const ran = [];
const to10 = { from: 9, to: 10, run: (d) => { ran.push(9); d.renamed = d.old; delete d.old; } };
const to11 = { from: 10, to: 11, run: (d) => { ran.push(10); d.list = [d.renamed]; delete d.renamed; } };
const to12 = { from: 11, to: 12, run: (d) => { ran.push(11); d.list.push('twelve'); } };
// Listed out of order on purpose: a step is found by where it starts.
const steps = { steps: [to11, to10], target: 11 };

check('a path runs from the saved version up, in order', migrationPath(9, steps), [to10, to11]);
check('one already at the target has nothing to do', migrationPath(11, steps), []);
check('one newer than the target has no path', migrationPath(12, steps), null);
check('nor one below the first step', migrationPath(8, steps), null);
check('nor one with a gap below the target', migrationPath(9, { steps: [to10, to12], target: 12 }), null);
check('though the part above the gap still has its path', migrationPath(11, { steps: [to10, to12], target: 12 }), [to12]);
check('a step past the target is not taken', migrationPath(9, { steps: [{ from: 9, to: 12, run() {} }], target: 11 }), null);
check('a version that is not a whole number has no path',
  [undefined, null, '9', 9.5, NaN].map((v) => migrationPath(v, steps)), [null, null, null, null, null]);
check('readableSchema says the same', [9, 10, 11, 12, 8].map((v) => readableSchema(v, steps)),
  [true, true, true, false, false]);

{
  const doc = { schemaVersion: 9, old: 'kept' };
  ran.length = 0;
  const out = migrateDocument(doc, steps);
  check('a document is walked up in place', out === doc, true);
  check('through every step, in order', ran, [9, 10]);
  check('and ends at the target with each change made', doc, { schemaVersion: 11, list: ['kept'] });
}
{
  const newer = { schemaVersion: 12, list: ['x'] };
  const before = JSON.stringify(newer);
  ran.length = 0;
  check('a newer document comes back as it was', [migrateDocument(newer, steps) === newer, JSON.stringify(newer)],
    [true, before]);
  check('with no step run', ran, []);
  const unversioned = { identity: { name: 'Built in code' } };
  check('so does one with no schemaVersion', JSON.stringify(migrateDocument(unversioned, steps)), JSON.stringify(unversioned));
}
{
  const boom = { from: 10, to: 11, run: () => { throw new Error('the list was not there'); } };
  const doc = { schemaVersion: 9, old: 'kept' };
  const err = threw(() => migrateDocument(doc, { steps: [to10, boom], target: 11 }));
  check('a step that throws stops the walk', err instanceof Error, true);
  check('and the error names the step and why', err?.message,
    'it could not be brought from schema 10 to 11: the list was not there');
  check('with the step\'s own error as the cause', err?.cause?.message, 'the list was not there');
  check('leaving the document at the last version it reached', doc, { schemaVersion: 10, renamed: 'kept' });
}

/* ---------------- the real list ---------------- */

check('every step goes up from a whole number to a higher one and has something to run',
  MIGRATIONS.every((s) => Number.isInteger(s.from) && Number.isInteger(s.to) && s.to > s.from
    && typeof s.run === 'function'), true);
check('no two steps start at the same version', new Set(MIGRATIONS.map((s) => s.from)).size, MIGRATIONS.length);
check('every step starts at a version that reaches this build',
  MIGRATIONS.filter((s) => !readableSchema(s.from)).map((s) => s.from), []);
check('the current schema is read', readableSchema(SCHEMA_VERSION), true);
check('a newer one is not', readableSchema(SCHEMA_VERSION + 1), false);

/* ---------------- the import gate ---------------- */

const vesna = JSON.parse(readFileSync(join(PUBLIC_FIXTURES, 'characters', 'vesna.json'), 'utf8'));
const refusal = (v) => `Built for schema ${v}, but this app reads schema ${SCHEMA_VERSION}.`
  + ' Re-run tools/convert.py on the workbook to bring it up to date.';

check('a current document passes', inspectDocument(structuredClone(vesna)).ok, true);
check('and is left alone by the runner', migrateDocument(vesna) === vesna && vesna.schemaVersion === SCHEMA_VERSION, true);
const newer = inspectDocument({ ...structuredClone(vesna), schemaVersion: SCHEMA_VERSION + 1 });
check('a newer document is refused, as it always was', [newer.ok, newer.error], [false, refusal(SCHEMA_VERSION + 1)]);
const older = inspectDocument({ ...structuredClone(vesna), schemaVersion: SCHEMA_VERSION - 1 });
check('an older one passes exactly when a path reaches it', older.ok, readableSchema(SCHEMA_VERSION - 1));
if (!older.ok) check('and is otherwise refused the same way', older.error, refusal(SCHEMA_VERSION - 1));

/* ---------------- old saved documents ---------------- */

/*
 * What each frozen document is for: the shape it was saved in, which the
 * check beside it confirms is still there, so the file cannot quietly be
 * replaced by a newer save.
 */
const OLD_DIR = join('tests', 'fixtures', 'old');
const OLD = {
  'vesna-2026-08-20.json': ['one block per companion kind, the primordia block, no guile side',
    (d) => !Array.isArray(d.familiar) && 'primordia' in d && !('guile' in d.training)],
  'vesna-2026-08-30.json': ['companion lists, the sphere tables saved, no corrections recorded',
    (d) => Array.isArray(d.familiar) && 'sphereRows' in d.training.magic && !('corrections' in d)],
  'vesna-2026-10-02.json': ['three corrections recorded, one speed per companion, no Level Up feat slots',
    (d) => d.corrections.length === 3 && 'speed' in d.familiar[0] && !d.featGroups.some((g) => 'levelUp' in g)],
  'vesna-2026-10-13.json': ['four corrections recorded, mythic paths, carrying without load penalties',
    (d) => d.corrections.length === 4 && 'paths' in d.mythic && !('load' in d.carry)],
};
check('every frozen document is listed here', readdirSync(OLD_DIR).filter((f) => f.endsWith('.json')).sort(),
  Object.keys(OLD).sort());

/* What a reader would look for first, and what must survive the load. */
const reader = (d) => ({
  name: d.identity?.name,
  level: d.identity?.level,
  race: d.identity?.race,
  player: d.identity?.player,
  classes: (d.classes || []).map((c) => c.name),
  scores: Object.fromEntries(Object.entries(d.abilities || {}).map(([k, a]) => [k, a.score])),
  hp: d.hp?.total,
  skills: (d.skills || []).map((s) => s.name),
  weapons: (d.equipment?.weapons || []).map((w) => w.name),
  casting: (d.vancian?.classes || []).map((c) => c.name),
});
const trackerNames = (d) => (d.customTrackers || []).map((t) => t.name);

/*
 * Values, not key order: a key holding undefined is dropped from the export
 * and comes back at the end of its object on the next load, which moves no
 * value but does move the text.
 */
const canonical = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const exported = (doc) => JSON.parse(JSON.stringify(new Character(structuredClone(doc)).toJSON()));

for (const [file, [shape, isShape]] of Object.entries(OLD)) {
  const doc = JSON.parse(readFileSync(join(OLD_DIR, file), 'utf8'));
  check(`${file} is still the shape it was kept for (${shape})`, isShape(doc), true);
  const verdict = inspectDocument(structuredClone(doc));
  check(`${file} passes the import gate`, [verdict.ok, verdict.error], [true, null]);
  check(`${file} is listed by its name, level and classes`,
    [verdict.summary?.name, verdict.summary?.level, verdict.summary?.classes],
    [doc.identity.name, doc.identity.level, doc.classes.map((c) => c.name)]);

  let first = null;
  const err = threw(() => { first = exported(doc); });
  check(`${file} loads`, err?.message ?? null, null);
  if (!first) continue;
  check(`${file} keeps what a reader looks for`, reader(first), reader(doc));
  // A load may add a pool's tracker the character now qualifies for; it
  // must not lose one the player made.
  check(`${file} keeps every tracker it had`, trackerNames(doc).filter((n) => !trackerNames(first).includes(n)), []);
  check(`${file} has every correction recorded once loaded`, RULE_CORRECTIONS.every((c) => first.corrections.includes(c)), true);
  check(`${file} settles after one load`, canonical(exported(first)), canonical(first));
}

/* ---------------- where documents come in ---------------- */

// A made-up step from the version before this one, put in the real list for
// the length of these checks: an older document then opens wherever one
// arrives, and a step that fails keeps the stored copy rather than losing it.
{
  const { historyFor, workingKey } = await import('../app/js/history.js');
  const rows = new Map();
  globalThis.localStorage = {
    getItem: (k) => rows.get(k) ?? null,
    setItem: (k, v) => { rows.set(k, String(v)); },
    removeItem: (k) => { rows.delete(k); },
  };
  let broken = false;
  const step = {
    from: SCHEMA_VERSION - 1, to: SCHEMA_VERSION,
    run: (d) => { if (broken) throw new Error('no way to read it'); d.identity.name = `${d.identity.name} (moved)`; },
  };
  const older = () => ({ ...structuredClone(vesna), schemaVersion: SCHEMA_VERSION - 1 });
  MIGRATIONS.push(step);
  try {
    const model = new Character(older());
    check('a Character built from an older document is brought up',
      [model.data.schemaVersion, model.data.identity.name.endsWith('(moved)')], [SCHEMA_VERSION, true]);
    check('the import gate takes it', inspectDocument(older()).ok, true);

    const key = workingKey('zz-migrate');
    const store = historyFor('zz-migrate');
    rows.set(key, JSON.stringify({ savedAt: 'then', data: older() }));
    const working = store.readWorking();
    check('an older working copy is read, brought up',
      [working?.data.schemaVersion, working?.data.identity.name.endsWith('(moved)')], [SCHEMA_VERSION, true]);
    check('and is not taken for a copy to recover', store.readRecoveries(), []);

    broken = true;
    const raw = JSON.stringify({ savedAt: 'then', data: older() });
    rows.set(key, raw);
    check('a copy whose step fails is not opened', store.readWorking(), null);
    store.writeWorking(model.toJSON());
    check('and is kept, byte for byte, before it is replaced', store.readRecoveries().map((r) => r.raw), [raw]);
  } finally {
    MIGRATIONS.pop();
    delete globalThis.localStorage;
  }
}

finish();
