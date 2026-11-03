/**
 * Saved documents brought up to the schema this build reads.
 *
 * `SCHEMA_VERSION` (schema.js) names the shape of a saved document. Most
 * changes to that shape never move it: `normalise` (document.js) knows an
 * older shape by looking at it -- a field missing, an object where a list now
 * goes -- and brings it up to date on every load. The number is for a change
 * that cannot be seen that way, where the same saved shape means one thing
 * before the change and another after it. Such a change raises the number by
 * one and adds a step here that takes a document from the old number to the
 * new one.
 *
 * A document saved under an older number is walked up the steps in order
 * before anything else reads it, so a character kept in somebody's browser
 * still opens after the change. A document newer than this build is refused,
 * as is one with no path up: this build cannot know what a shape it has no
 * step for means, and loading it would quietly drop whatever it does not know.
 *
 * The list is empty. The shape has been schema 9 since the public release, and
 * every change since has been one `normalise` could see.
 */

import { SCHEMA_VERSION } from '../schema.js';

/**
 * Each step takes a document saved at `from` and leaves it in the shape of
 * `to`, in place, the way `normalise` works. `to` is `from + 1` unless two
 * changes were made together. The runner writes the new `schemaVersion`.
 *
 * @type {{ from: number, to: number, run: (doc: object) => void }[]}
 */
export const MIGRATIONS = [];

/**
 * The steps that take a document saved at `version` up to `target`, in the
 * order they run. Empty when it is already there. Null when there is no way
 * up: the version is not a whole number, it is newer than `target`, or no step
 * starts where the last one ended.
 */
export function migrationPath(version, { steps = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  if (!Number.isInteger(version) || version > target) return null;
  const path = [];
  for (let at = version; at < target;) {
    const step = steps.find((s) => s.from === at);
    if (!step || !(step.to > at && step.to <= target)) return null;
    path.push(step);
    at = step.to;
  }
  return path;
}

/** Whether this build can read a document saved at `version`. */
export const readableSchema = (version, options) => migrationPath(version, options) !== null;

/**
 * Bring a document up to `target`, in place, and return it.
 *
 * A document already there, or with no path up, comes back untouched: turning
 * one away is the gate's job (`readableSchema`), and a document built in code
 * with no `schemaVersion` at all still has to load. A step that throws stops
 * the walk with an error naming the step; the document is left at the last
 * version it reached, so the caller hands in a copy it can discard.
 */
export function migrateDocument(doc, { steps = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  const path = migrationPath(doc?.schemaVersion, { steps, target });
  for (const step of path || []) {
    try {
      step.run(doc);
    } catch (err) {
      throw new Error(`it could not be brought from schema ${step.from} to ${step.to}: ${err.message}`, { cause: err });
    }
    doc.schemaVersion = step.to;
  }
  return doc;
}
