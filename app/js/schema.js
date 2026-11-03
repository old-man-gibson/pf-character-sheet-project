/**
 * The document shape this build understands, written by tools/convert.py
 * and by convert.js.
 *
 * Raised when the saved shape changes in a way `normalise` cannot see from the
 * document alone, together with a step in model/migrations.js that brings a
 * document from the old number to the new one. A document newer than this, or
 * older with no steps reaching up to it, is refused: loading it would quietly
 * drop whatever this build does not know. Kept in a module of its own so the
 * converter and the model read the one number; tools/convert.py has to be
 * bumped beside it.
 */
export const SCHEMA_VERSION = 9;
