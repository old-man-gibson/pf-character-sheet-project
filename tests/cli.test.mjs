/** How every tool in tools/ reads its command line (tools/lib/cli.mjs).
 *
 *  The tools used to read it each their own way, and each kept its own list
 *  of the options whose next word is a value; an option missing from that
 *  list had its value taken for an input file. These pin the one reading.
 *
 *  Run: node tests/cli.test.mjs */
import { readArgs } from '../tools/lib/cli.mjs';
import { check, finish } from './check.mjs';

console.log('a tool\'s command line');
{
  const a = readArgs(['out', 'drop'], ['in.txt', '--out', 'dir', '--dry', 'more.txt', '--drop', 'a', '--drop', 'b']);
  check('inputs leave out options and their values', a.inputs, ['in.txt', 'more.txt']);
  check('an option gives its value', a.opt('out'), 'dir');
  check('a repeated option gives every value, opt the first and last the last', [a.all('drop'), a.opt('drop'), a.last('drop')],
    [['a', 'b'], 'a', 'b']);
  check('a flag is there or not', [a.flag('dry'), a.flag('out'), a.flag('list')], [true, true, false]);
  check('an option not given gives its fallback', [a.opt('name'), a.opt('name', 'x'), a.last('name', 'x')], [null, 'x', 'x']);
  check('names lists every option given, once each', a.names, ['out', 'dry', 'drop']);
}
{
  // A value-taking option with nothing after it is given, with no value --
  // not `true`, which a tool would have written a file called "true" for.
  const a = readArgs(['out'], ['in.txt', '--out']);
  check('an option at the end has no value', [a.flag('out'), a.opt('out', 'fallback'), a.inputs], [true, null, ['in.txt']]);
  // Repeated, with nothing after the last one: last says so where opt
  // still has the first.
  const b = readArgs(['out'], ['--out', 'dir', '--out']);
  check('a repeated option at the end has no last value', [b.opt('out'), b.last('out'), b.all('out')], ['dir', null, ['dir']]);
}
{
  // An option's value is not an option, whatever it looks like.
  const a = readArgs(['out'], ['--out', '--dry']);
  check('a value that looks like an option is a value', [a.opt('out'), a.flag('dry'), a.names], ['--dry', false, ['out']]);
}
{
  // An option not named as taking a value is a flag, and the word after it
  // an input, as the tools have always let an unknown flag through.
  const a = readArgs(['out'], ['--verbose', 'in.txt']);
  check('an unknown option is a flag', [a.flag('verbose'), a.inputs], [true, ['in.txt']]);
}

finish();
