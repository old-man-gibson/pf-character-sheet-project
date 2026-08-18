/** Tests for the sandboxed formula engine. Run: node tests/formula.test.mjs */
import { evaluateFormula, analyse, validate, FormulaError } from '../app/js/formula.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else {
    fail++;
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function throws(label, fn, matcher) {
  try {
    fn();
    fail++;
    console.log(`  FAIL ${label} -- expected a throw`);
  } catch (err) {
    if (matcher && !String(err.message).match(matcher)) {
      fail++;
      console.log(`  FAIL ${label} -- message "${err.message}" did not match ${matcher}`);
    } else pass++;
  }
}

const scope = {
  level: 15,
  bab: 11,
  str: { score: 9, mod: -1 },
  con: { score: 22, mod: 6 },
  int: { score: 37, mod: 13 },
  mythic: { tier: 5 },
  hasToughness: true,
  name: 'Nico',
};
const ev = (src) => evaluateFormula(src, scope);

console.log('arithmetic & precedence');
check('add', ev('2 + 3'), 5);
check('precedence', ev('2 + 3 * 4'), 14);
check('parens', ev('(2 + 3) * 4'), 20);
check('unary minus', ev('-5 + 2'), -3);
check('power right-assoc', ev('2 ^ 3 ^ 2'), 512);
check('modulo', ev('17 % 5'), 2);
check('leading equals accepted', ev('= 2 + 2'), 4);

console.log('variables');
check('dotted path', ev('con.mod'), 6);
check('negative mod', ev('str.mod'), -1);
check('expression', ev('bab + con.mod * 2'), 23);
check('nested path', ev('mythic.tier * 2'), 10);

console.log('functions');
check('floor', ev('floor(7 / 2)'), 3);
check('floor negative', ev('floor(-7 / 2)'), -4);
check('floor to step', ev('floor(17, 5)'), 15);
check('mod() helper', ev('mod(37)'), 13);
check('mod() odd', ev('mod(9)'), -1);
check('min/max', ev('max(1, 5, 3)'), 5);
check('min spread', ev('min(4, 2, 8)'), 2);
check('clamp', ev('clamp(99, 0, 20)'), 20);
check('sum', ev('sum(1, 2, 3, 4)'), 10);
check('abs', ev('abs(0 - 7)'), 7);
check('iterations', ev('iterations(11)'), 3);
check('round', ev('round(3.456, 2)'), 3.46);

console.log('logic');
check('if true', ev('if(level >= 10, 100, 50)'), 100);
check('if false', ev('if(level > 20, 100, 50)'), 50);
check('ternary', ev('level >= 10 ? 1 : 0'), 1);
check('and', ev('and(level > 1, bab > 1)'), true);
check('or', ev('or(level > 99, bab > 1)'), true);
check('not', ev('not(level > 99)'), true);
check('&&', ev('level > 1 && bab > 100'), false);
check('||', ev('level > 100 || bab > 1'), true);
check('equality via single =', ev('level = 15'), true);
check('comparison', ev('con.mod >= 6'), true);
check('boolean var', ev('if(hasToughness, level, 0)'), 15);

console.log('short-circuit safety');
check('&& guards divide', ev('level > 100 && 1 / 0 > 0'), false);
check('if() skips bad branch', ev('if(level > 100, 1 / 0, 42)'), 42);

console.log('strings');
check('string compare', ev('name == "Nico"'), true);
check('concat', ev('name + " the gambler"'), 'Nico the gambler');

console.log('realistic sheet formulas');
check('HP-ish', ev('level * 8 + con.mod * level'), 210);
check('save', ev('floor(level / 2) + 2 + con.mod'), 15);
check('mythic power', ev('mythic.tier = 0 ? 0 : 3 + mythic.tier * 2'), 13);
check('iterative count', ev('iterations(bab)'), 3);

console.log('errors are caught, not thrown at the page');
throws('unknown variable', () => ev('nonsense + 1'), /Unknown value/);
throws('unknown function', () => ev('hack(1)'), /Unknown function/);
throws('divide by zero', () => ev('1 / 0'), /Division by zero/);
throws('unbalanced parens', () => ev('(1 + 2'), /Expected/);
throws('empty', () => ev(''), /empty/);
throws('bad arity', () => ev('clamp(1)'), /argument/);
throws('trailing junk', () => ev('1 + 2 3'), /Unexpected/);
throws('too long', () => ev('1+'.repeat(300) + '1'), /too long|complex/);

console.log('sandbox: host objects are unreachable');
throws('constructor escape', () => ev('constructor'), /Unknown value/);
throws('global access', () => ev('globalThis'), /Unknown value/);
throws('function ctor', () => ev('Function("return 1")'), /Unknown function/);
throws('prototype walk', () => ev('str.__proto__'), /Unknown value/);
throws('toString reach', () => ev('str.constructor'), /Unknown value/);

console.log('analyse() for the admin audit view');
const a = analyse('floor(con.mod / 2) + level + mythic.tier');
check('analyse ok', a.ok, true);
check('analyse vars', a.variables.sort(), ['con.mod', 'level', 'mythic.tier']);
check('analyse fns', a.functions, ['floor']);
const bad = analyse('floor(');
check('analyse bad ok=false', bad.ok, false);
check('analyse bad never throws', typeof bad.error, 'string');

console.log('validate() against a known-name allowlist');
const known = ['level', 'bab', 'con.mod'];
check('valid', validate('level + bab', known).ok, true);
check('invalid name', validate('level + wat', known).ok, false);
check('invalid reports', validate('level + wat', known).error, 'Unknown value(s): wat');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
