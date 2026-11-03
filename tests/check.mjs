/**
 * The tally every suite keeps, the checks most of them make, and the line
 * they end on.
 *
 * A suite is a process of its own, so this module's one tally is that suite's.
 * A check that fails says why on a line of its own; the last line is
 * `N passed, M failed`, which is what a person reading the log and the scripts
 * that run the suites look for; and the exit code is 1 if anything failed.
 *
 * A suite whose failure line reads differently makes its check with
 * `checkWith`, and one with a check of another kind -- a throw expected, a
 * number within a tolerance -- builds it on `pass` and `fail`.
 */

export const tally = { pass: 0, fail: 0 };

/** Count a check that held. */
export function pass() {
  tally.pass++;
}

/** Count a check that did not, and print why when there is a why to print. */
export function fail(why) {
  tally.fail++;
  if (why !== undefined) console.log(why);
}

/**
 * A check of whether `actual` is `expected`, compared as JSON, whose failure
 * line is `say(label, actual, expected)`.
 */
export const checkWith = (say) => (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass();
  else fail(say(label, actual, expected));
};

/** Whether `actual` is `expected`, compared as JSON. */
export const check = checkWith((label, actual, expected) =>
  `  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** Whether `cond` holds; a failure prints only the label. */
export function ok(label, cond) {
  if (cond) pass();
  else fail(`  FAIL ${label}`);
}

/** `N passed, M failed`. */
export const summary = () => `${tally.pass} passed, ${tally.fail} failed`;

/**
 * Print the last line and exit, with 1 if anything failed. The line is the
 * summary after a blank line unless the suite says otherwise.
 */
export function finish(line = `\n${summary()}`) {
  console.log(line);
  process.exit(tally.fail ? 1 : 0);
}
