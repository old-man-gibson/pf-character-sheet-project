/**
 * Where the test suites find characters to check the model against.
 *
 * There are two rosters, and they are read in that order:
 *
 *   private/characters/index.json      the five real characters, when present
 *   tests/fixtures/public/characters/  one invented character, always present
 *
 * The real characters belong to the players, not the repository -- the
 * published app starts empty and each visitor adds their own -- so `private/`
 * is git-ignored and a fresh clone has none of it:
 *
 *   private/characters/index.json      the roster, in the app's own format
 *   private/characters/<id>.json       the converted documents
 *   private/raw/<id>.xlsx              the workbooks they were converted from
 *
 * What such a checkout does have is the public fixture: a single twelfth-level
 * character built by tools/make-public-fixture.mjs, committed, and shaped to
 * satisfy the invariant the roster suites lean on -- load it and the model
 * computes exactly the numbers stored on it. So a suite that sweeps *a roster*
 * falls back to it and keeps running; only the checks written against a
 * particular character by name have to stand down, and `requireFixtures` says
 * so and exits 0 rather than failing on a missing file.
 *
 * `CHARACTER_FIXTURES` overrides the first of the two: point it at a directory
 * holding `characters/` and `raw/` to test against a roster of your own. A
 * directory with no `characters/index.json` in it is not an error -- it simply
 * falls through to the public fixture, which is what CI does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The invented character that ships with the repository. */
export const PUBLIC_FIXTURES = join('tests', 'fixtures', 'public');

const hasRoster = (dir) => existsSync(join(dir, 'characters', 'index.json'));
const preferred = process.env.CHARACTER_FIXTURES || 'private';

export const FIXTURES = hasRoster(preferred) ? preferred : PUBLIC_FIXTURES;
export const CHARACTERS_DIR = join(FIXTURES, 'characters');
export const RAW_DIR = join(FIXTURES, 'raw');

/** True when the private roster was not found and the public one is in use. */
export const usingPublicFixtures = FIXTURES === PUBLIC_FIXTURES;

export const characterPath = (id) => join(CHARACTERS_DIR, `${id}.json`);
export const workbookPath = (id) => join(RAW_DIR, `${id}.xlsx`);

/**
 * Whether there is a roster to sweep at all.
 *
 * Now that the public fixture is committed this is true in every checkout, and
 * the suites that guard a sweep with it run everywhere. It stays because the
 * guard is still meaningful -- a fixture directory can be emptied, and one day
 * a suite may want the answer -- and because saying `hasFixtures()` at the top
 * of a sweep still reads as what it means.
 */
export const hasFixtures = () => existsSync(join(CHARACTERS_DIR, 'index.json'));

/** Every id in the roster in use, or none. */
export function fixtureIds() {
  if (!hasFixtures()) return [];
  return JSON.parse(readFileSync(join(CHARACTERS_DIR, 'index.json'), 'utf8'))
    .characters.map((c) => c.id);
}

/** Read one document from the roster in use. */
export const loadCharacter = (id) => JSON.parse(readFileSync(characterPath(id), 'utf8'));

/** Which of `ids` the roster in use does not have. */
export const missingCharacters = (ids) => ids.filter((id) => !existsSync(characterPath(id)));

/** One line explaining what a roster-specific check is standing down for. */
export const missingNote = (missing) => `needs the private character fixtures `
  + `(${missing.join(', ')} not in ${CHARACTERS_DIR}).`
  + '\n  Point CHARACTER_FIXTURES at a directory holding characters/ and raw/ to run it.';

/**
 * The one-line guard for a suite that cannot run at all without named
 * characters -- it explains and exits 0 when they are absent.
 *
 * A suite with checks of both kinds should not use this: it should run what it
 * can against whatever roster is in use, and call `missingCharacters` to decide
 * whether to go on to the rest. tests/model.test.mjs does exactly that.
 */
export function requireFixtures(ids, suite) {
  const missing = missingCharacters(ids);
  if (missing.length === 0) return;
  console.log(`${suite}: skipped -- ${missingNote(missing)}`);
  process.exit(0);
}
