/**
 * tools/lib/cli.mjs -- a tool's command line, read the one way.
 *
 * Every tool here takes `--name value` options, `--name` flags, and anything
 * else as its inputs. Each used to read that with its own opt/flag helpers
 * and its own list -- in a regular expression beside them -- of the options
 * whose next word is a value. That list had to be kept in step with the
 * options by hand, or an option's value was taken for an input file. Here
 * the options that take a value are named once, and the inputs follow.
 *
 * Not node:util's parseArgs: that refuses an option it was not told about,
 * and these tools have always let an unknown flag through.
 */

/**
 * Read `argv` (the words after the script) given the options that take a
 * value. Returns:
 *
 *   inputs       every word that is neither an option nor an option's value
 *   opt(name, fallback = null)
 *                the value given after `--name` (the first, if repeated);
 *                `fallback` when `--name` is not there, null when it is
 *                there with nothing after it
 *   all(name)    every value given for an option that may be repeated
 *                (`--drop a --drop b`)
 *   flag(name)   whether `--name` is there at all
 */
export function readArgs(valued = [], argv = process.argv.slice(2)) {
  const takesValue = new Set(valued);
  const values = new Map();
  const given = new Set();
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith('--')) {
      inputs.push(word);
      continue;
    }
    const name = word.slice(2);
    given.add(name);
    if (!takesValue.has(name)) continue;
    const value = i + 1 < argv.length ? argv[++i] : null;
    if (!values.has(name)) values.set(name, []);
    values.get(name).push(value);
  }
  return {
    inputs,
    opt: (name, fallback = null) => (values.has(name) ? values.get(name)[0] : fallback),
    all: (name) => (values.get(name) || []).filter((v) => v !== null),
    flag: (name) => given.has(name),
  };
}
