/** Tests for the sandboxed formula engine. Run: node tests/formula.test.mjs */
import { evaluateFormula, analyse, validate, resolvePath, NameIndex, FormulaError } from '../app/js/formula.js';

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

console.log('a branch carrying a total reads as that total');
{
  const totalled = {
    saves: { will: { total: 13, base: 6, luck: 2, resistance: 5 } },
    ac: { total: 21, shield: 1 },
    str: { score: 9, mod: -1 },
    parts: { luck: 2 },
    fake: { total: 'lots' },
  };
  const t = (src) => evaluateFormula(src, totalled);
  check('the branch is the total', t('saves.will'), 13);
  check('and so is the total itself', t('saves.will.total'), 13);
  check('the parts are still reachable through it', t('saves.will.luck'), 2);
  check('it is a number, not an object', t('saves.will + 2'), 15);
  check('one level up is untouched', t('ac'), 21);
  check('a branch with no total stays a branch', typeof resolvePath(totalled, 'str'), 'object');
  check('so does one whose total is not a number', typeof resolvePath(totalled, 'fake'), 'object');
  check('a branch with no total keeps its parts', t('parts.luck'), 2);
  check('the rule reaches only the end of the path', resolvePath(totalled, 'saves.will.base'), 6);
}

console.log('names resolve whatever case they are typed in');
{
  const mixed = {
    level: 15,
    ac: { flatFooted: 13, total: 21 },
    animalCompanion: { hd: 4 },
    // Two names that differ only by case: each must go on meaning itself.
    Fort: 7,
    fort: 99,
  };
  const t = (src) => evaluateFormula(src, mixed);
  check('lower for lower', t('level'), 15);
  check('capitalised', t('Level'), 15);
  check('shouted', t('LEVEL'), 15);
  check('mid-path', t('ac.FLATFOOTED'), 13);
  check('whole path', t('ANIMALCOMPANION.HD'), 4);
  check('exact still wins over folded', t('Fort'), 7);
  check('and the other way round', t('fort'), 99);
  throws('a name that is not there is still not there', () => t('leval'), /Unknown value/);
  throws('case does not open the prototype', () => t('ac.__PROTO__'), /Unknown value/);
  throws('nor the constructor', () => t('ac.Constructor'), /Unknown value/);

  const known = new NameIndex(['level', 'ac.flatFooted', 'StrMod']);
  check('the name index agrees with the lookup', known.has('LEVEL'), true);
  check('and on a dotted name', known.has('ac.flatfooted'), true);
  check('and still says no to a typo', known.has('leval'), false);
  check('validate() accepts what resolves', validate('Level + AC.FlatFooted', ['level', 'ac.flatFooted']).ok, true);
  check('and rejects what does not', validate('Levle', ['level']).ok, false);
}

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
