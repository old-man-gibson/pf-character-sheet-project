/**
 * The document shape this build understands, written by tools/convert.py
 * and by convert.js.
 *
 * Bumped whenever a section is added or restructured. Saved edits and imported
 * files are both refused when they disagree: an older document is missing
 * whatever has been added since, and loading it would quietly drop sections.
 * Kept in a module of its own so the converter and the model read the one
 * number; tools/convert.py has to be bumped beside it.
 */
export const SCHEMA_VERSION = 9;
