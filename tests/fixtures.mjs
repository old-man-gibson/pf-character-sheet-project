/**
 * Where the test suites find real characters to check the model against.
 *
 * The repository ships no characters -- they belong to the players, and the
 * published app starts empty -- so the suites that need converted documents
 * and their source workbooks read them from a directory that is not committed:
 * `private/` by default (git-ignored), or wherever CHARACTER_FIXTURES points.
 *
 *   private/characters/index.json      the roster, in the app's own format
 *   private/characters/<id>.json       the converted documents
 *   private/raw/<id>.xlsx              the workbooks they were converted from
 *
 * A checkout without them can still run every fixture-free suite; a suite that
 * cannot run without them says so and exits 0 rather than failing on a missing
 * file, so a fresh clone's test run is green and honest about what it skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FIXTURES = process.env.CHARACTER_FIXTURES || 'private';
export const CHARACTERS_DIR = join(FIXTURES, 'characters');
export const RAW_DIR = join(FIXTURES, 'raw');

export const characterPath = (id) => join(CHARACTERS_DIR, `${id}.json`);
export const workbookPath = (id) => join(RAW_DIR, `${id}.xlsx`);

export const hasFixtures = () => existsSync(join(CHARACTERS_DIR, 'index.json'));

/** Every id in the fixture roster, or none. */
export function fixtureIds() {
  if (!hasFixtures()) return [];
  return JSON.parse(readFileSync(join(CHARACTERS_DIR, 'index.json'), 'utf8'))
    .characters.map((c) => c.id);
}

/** Read one fixture document. */
export const loadCharacter = (id) => JSON.parse(readFileSync(characterPath(id), 'utf8'));

/**
 * The suites written against the original five characters call `load('angou')`
 * and friends by name; a fixture set that lacks one of them cannot run those
 * checks. `requireFixtures(ids)` is the one-line guard at the top of such a
 * suite: it explains and exits 0 when the fixtures are absent or incomplete.
 */
export function requireFixtures(ids, suite) {
  const missing = ids.filter((id) => !existsSync(characterPath(id)));
  if (hasFixtures() && missing.length === 0) return;
  console.log(`${suite}: skipped -- needs private character fixtures`
    + (hasFixtures() ? ` (${missing.join(', ')} not in ${CHARACTERS_DIR})` : ` (no ${CHARACTERS_DIR}/index.json)`)
    + '.\n  Point CHARACTER_FIXTURES at a directory holding characters/ and raw/ to run it.');
  process.exit(0);
}
