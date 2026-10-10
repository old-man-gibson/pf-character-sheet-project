/** How every tool in tools/ reads its command line (tools/lib/cli.mjs).
 *
 *  The tools used to read it each their own way, and each kept its own list
 *  of the options whose next word is a value; an option missing from that
 *  list had its value taken for an input file. These pin the one reading.
 *
 *  Run: node tests/cli.test.mjs */
import { readArgs } from '../tools/lib/cli.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

console.log('a tool\'s command line');
{
  const a = readArgs(['out', 'drop'], ['in.txt', '--out', 'dir', '--dry', 'more.txt', '--drop', 'a', '--drop', 'b']);
  check('inputs leave out options and their values', a.inputs, ['in.txt', 'more.txt']);
  check('an option gives its value', a.opt('out'), 'dir');
  check('a repeated option gives every value, opt the first', [a.all('drop'), a.opt('drop')], [['a', 'b'], 'a']);
  check('a flag is there or not', [a.flag('dry'), a.flag('out'), a.flag('list')], [true, true, false]);
  check('an option not given gives its fallback', [a.opt('name'), a.opt('name', 'x')], [null, 'x']);
}
{
  // A value-taking option with nothing after it is given, with no value --
  // not `true`, which a tool would have written a file called "true" for.
  const a = readArgs(['out'], ['in.txt', '--out']);
  check('an option at the end has no value', [a.flag('out'), a.opt('out', 'fallback'), a.inputs], [true, null, ['in.txt']]);
}
{
  // An option not named as taking a value is a flag, and the word after it
  // an input, as the tools have always let an unknown flag through.
  const a = readArgs(['out'], ['--verbose', 'in.txt']);
  check('an unknown option is a flag', [a.flag('verbose'), a.inputs], [true, ['in.txt']]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
