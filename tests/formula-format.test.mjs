/** Tests for the formula display layer. Run: node tests/formula-format.test.mjs */
import { FUNCTIONS } from '../app/js/formula.js';
import {
  lex, highlight, highlightAgainst, highlightFlagging, contextualNote,
  pretty, workings, workingLine, formatNumber,
  FUNCTION_HELP, OPERATOR_HELP, VALUE_GUIDE, PLACES_GUIDE, TOKEN_FORMS, CONTEXTUAL_VALUES,
  NEST_COLOURS,
} from '../app/js/formula-format.js';
import { scanBrackets, pairAtCaret, mirrorHtml } from '../app/js/ui/brackets.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; } else {
    fail++;
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n            got ${JSON.stringify(actual)}`);
  }
}

const scope = {
  level: 20,
  bab: 15,
  str: { score: 9, mod: -1 },
  dex: { score: 14, mod: 2 },
  con: { score: 22, mod: 6 },
  wis: { score: 20, mod: 5 },
  mythic: { tier: 5 },
  burn: { max: 18 },
  qi: { max: 12 },
  kinetic: { fist: '4d8' },
};

console.log('lexer: never throws, classifies every piece');
check('kinds', lex('floor(level / 2) + wis.mod').filter((t) => t.kind !== 'space').map((t) => [t.kind, t.text]), [
  ['fn', 'floor'], ['bracket', '('], ['name', 'level'], ['op', '/'], ['number', '2'],
  ['bracket', ')'], ['op', '+'], ['name', 'wis.mod'],
]);
check('call detected across a space', lex('floor (2)')[0].kind, 'fn');
check('bare name is not a call', lex('floor')[0].kind, 'name');
check('two-character operator stays whole', lex('a >= b').map((t) => t.text).join('|'), 'a| |>=| |b');
check('unknown character is bad, not fatal', lex('level # 2').filter((t) => t.kind === 'bad').map((t) => t.text), ['#']);
check('half-typed formula still lexes', lex('floor(level /').map((t) => t.kind), ['fn', 'bracket', 'name', 'space', 'op']);
check('unterminated string does not hang', lex('"abc').map((t) => [t.kind, t.text]), [['string', '"abc']]);
check('empty source', lex(''), []);
check('null source', lex(null), []);

console.log('highlight: HTML-safe, one span per token');
check('marks up a formula', highlight('2 + a'),
  '<span class="fx-number">2</span> <span class="fx-op">+</span> <span class="fx-name">a</span>');
check('escapes the source', highlight('a < "<b>"').includes('&lt;'), true);
check('never emits raw markup', /<(?!\/?span)/.test(highlight('x < 1 && y > "<i>"')), false);

console.log('highlightAgainst: unknown names are flagged');
const known = ['level', 'wis.mod'];
check('known name is plain', highlightAgainst('level', known).includes('fx-unknown'), false);
check('unknown name is marked', highlightAgainst('wisdom', known).includes('fx-unknown'), true);
check('known function is plain', highlightAgainst('floor(level)', known).includes('fx-unknown'), false);
check('unknown function is marked', highlightAgainst('flor(level)', known).includes('fx-unknown'), true);
check('function case does not matter', highlightAgainst('FLOOR(level)', known).includes('fx-unknown'), false);

console.log('highlightFlagging: the field the formula lives in has the last word');
// essence.self is real inside a veil's own description and nowhere else, so a
// highlighter that judges by the character alone calls a working formula broken.
const veilSrc = '2 + floor(essence.self / 2)';
check('a name the field supplies is not flagged', highlightFlagging(veilSrc, []).includes('fx-unknown'), false);
check('the same name is flagged where it does not belong',
  highlightFlagging(veilSrc, ['essence.self']).includes('fx-unknown'), true);
check('and highlighting against the character alone would have flagged it',
  highlightAgainst(veilSrc, ['level']).includes('fx-unknown'), true);
check('flagging still catches a function that does not exist',
  highlightFlagging('flor(2)', []).includes('fx-unknown'), true);
check('nothing to flag is the common case', highlightFlagging('level + 1', []).includes('fx-unknown'), false);
check('flagging is HTML-safe', highlightFlagging('a < "<b>"', ['a']).includes('&lt;'), true);

console.log('contextualNote: why a name is missing, not just that it is');
check('a veil name explains itself', contextualNote('essence.self').includes('veil'), true);
check('a tracker name too', contextualNote('self.max').includes('tracker'), true);
check('bare self counts', contextualNote('self').includes('tracker'), true);
check('an ordinary name has no note', contextualNote('wis.mod'), null);
check('a near miss is not swept in', contextualNote('essence.hands'), null);
check('nor is a name that merely starts the same way', contextualNote('selfish'), null);
check('every entry says where and what',
  CONTEXTUAL_VALUES.every((v) => v.where && v.what && v.names && typeof v.match === 'function'), true);
check('the flag explains rather than denies',
  highlightAgainst('essence.self', ['level']).includes('only exists in'), true);

console.log('pretty: re-spacing without changing meaning');
check('spaces operators', pretty('floor(level/2)+wis.mod'), 'floor(level / 2) + wis.mod');
check('spaces arguments', pretty('min(level,20)'), 'min(level, 20)');
check('drops redundant brackets', pretty('((level))+1'), 'level + 1');
check('keeps brackets that matter', pretty('(level + 4) / 2'), '(level + 4) / 2');
check('keeps precedence right', pretty('1 + 2 * 3'), '1 + 2 * 3');
check('keeps left-associativity', pretty('10 - (2 - 1)'), '10 - (2 - 1)');
check('keeps division order', pretty('100 / (2 * 5)'), '100 / (2 * 5)');
check('power is right-associative', pretty('2 ^ 3 ^ 2'), '2 ^ 3 ^ 2');
check('brackets a negated sum', pretty('-(a + b)'), '-(a + b)');
check('negative base of a power', pretty('-2 ^ 3'), '(-2) ^ 3');
check('ternary inside arithmetic', pretty('1 + (a ? 2 : 3)'), '1 + (a ? 2 : 3)');
check('leading = is a spreadsheet habit', pretty('=level+1'), 'level + 1');
check('a bare = is kept as the player wrote it', pretty('mythic.tier=0'), 'mythic.tier = 0');
check('and == is kept too', pretty('mythic.tier==0'), 'mythic.tier == 0');
check('an = inside a call survives', pretty('if(mythic.tier=0,0,1)'), 'if(mythic.tier = 0, 0, 1)');
check('unparseable source comes back untouched', pretty('floor(level /'), 'floor(level /');
check('empty source', pretty(''), '');

console.log('pretty output still parses to the same answer');
for (const src of ['floor(level/2)+wis.mod', '-2^3', '10-(2-1)', '100/(2*5)', '2^3^2',
  '-(str.mod + 1)', 'if(mythic.tier=0,0,3+mythic.tier*2)', 'level>=11?2:1', '(level+4)/2']) {
  const before = workings(src, scope).value;
  const after = workings(pretty(src), scope).value;
  check(`round-trip ${src}`, after, before);
}

console.log('workings: the substitution is the teaching');
const w = workings('floor(level / 2) + wis.mod', scope);
check('pretty', w.pretty, 'floor(level / 2) + wis.mod');
check('substituted', w.substituted, 'floor(20 / 2) + 5');
check('value', w.value, 15);
check('display', w.display, '15');
check('reads', w.reads, [
  { name: 'level', value: 20, known: true },
  { name: 'wis.mod', value: 5, known: true },
]);
check('functions', w.functions, ['floor']);
check('ok', w.ok, true);
check('no error', w.error, null);

check('negative values are bracketed', workings('2 * str.mod', scope).substituted, '2 * (-1)');
check('and still evaluate', workings('2 * str.mod', scope).value, -2);
check('a text value is bracketed too', workings('kinetic.fist', scope).substituted, '(4d8)');
check('unknown name keeps its name', workings('level + nope', scope).substituted, '20 + nope');
check('unknown name is reported', workings('level + nope', scope).reads.find((r) => r.name === 'nope').known, false);
check('unknown name is an error', workings('level + nope', scope).ok, false);
check('constants substitute to themselves', workings('3 + 4', scope).substituted, '3 + 4');

console.log('workings: bad input is reported, never thrown');
for (const bad of ['floor(', '', null, undefined, 'level #', '1 / 0', 'nosuch(2)']) {
  const r = workings(bad, scope);
  check(`bad "${bad}" reports`, typeof r.error === 'string' && r.error.length > 0, true);
  check(`bad "${bad}" not ok`, r.ok, false);
}
check('a long formula is refused by the engine, not here',
  typeof workings('1+'.repeat(400), scope).error, 'string');

console.log('workingLine: one line for a tooltip');
check('three steps', workingLine('floor(level / 2) + wis.mod', scope),
  'floor(level / 2) + wis.mod  =  floor(20 / 2) + 5  =  15');
check('nothing to substitute', workingLine('3 + 4', scope), '3 + 4  =  7');
check('nothing to work out', workingLine('12', scope), '12');
check('one name only', workingLine('level', scope), 'level  =  20');
check('an error explains itself', workingLine('floor(', scope).includes('—'), true);

console.log('formatNumber');
check('integer', formatNumber(15), '15');
check('rounds a tail', formatNumber(1 / 3), '0.333');
check('boolean', formatNumber(true), 'yes');
check('string passes through', formatNumber('4d8'), '4d8');
check('infinity is not printed raw', formatNumber(Infinity), 'Infinity');

console.log('the guide cannot drift from the engine');
const documented = FUNCTION_HELP.map((f) => f.name).sort();
const implemented = Object.keys(FUNCTIONS).sort();
check('every built-in is documented', implemented.filter((n) => !documented.includes(n)), []);
check('nothing documented has been removed', documented.filter((n) => !implemented.includes(n)), []);
check('no duplicate entries', documented.length, new Set(documented).size);

console.log('every example in the guide is a formula that works');
for (const { name, eg } of FUNCTION_HELP) {
  check(`${name}() example runs`, workings(eg, scope).ok, true);
}
for (const { op, eg } of OPERATOR_HELP) {
  check(`operator ${op} example runs`, workings(eg, scope).ok, true);
}
for (const { prefix, eg } of VALUE_GUIDE) {
  // The value examples name things a real character has; here only the shape
  // has to hold, so an unknown name is fine but a syntax error is not.
  check(`value example ${prefix} parses`, workings(eg, scope).error?.startsWith('Unknown value') !== false, true);
}
check('every function entry has a group', FUNCTION_HELP.every((f) => f.group && f.what && f.sig), true);
check('places guide is populated', PLACES_GUIDE.length >= 4, true);
check('four token forms', TOKEN_FORMS.map((t) => t.form),
  ['{= expr}', '{name = expr}', '{name}', '{dest += expr}']);

/* ---- brackets: the depth a bracket is drawn at, and its other end ---- */

// A pair shares one depth, so a nest is read by matching colours rather than
// by counting inwards; a comma takes the depth of the call it separates.
const depths = (src) => lex(src).filter((t) => t.kind === 'bracket').map((t) => `${t.text}${t.depth}`);
check('a flat call is all depth 0', depths('if(a, b, c)'), ['(0', ',0', ',0', ')0']);
check('a nested one steps in and back out',
  depths('floor(min(level, 20) / 2)'), ['(0', '(1', ',1', ')1', ')0']);
check('two calls side by side each start again',
  depths('max(a) + max(b)'), ['(0', ')0', '(0', ')0']);
check('an unbalanced closer does not go negative', depths('floor(x))'), ['(0', ')0', ')0']);
check('and the colour cycles rather than running out',
  lex('((((x))))').filter((t) => t.text === '(').map((t) => t.depth % NEST_COLOURS), [0, 1, 2, 0]);
check('the class says the depth',
  highlight('min(a, 1)').includes('class="fx-bracket fx-d0"'), true);
check('and the nested one differs',
  /fx-bracket fx-d1">\(/.test(highlight('floor(min(a, 1))')), true);

// The caret's own pair. Everything here is what ui/brackets.js draws.
const pairs = (src) => scanBrackets(src).map((m) => `${m.ch}@${m.at}${m.partner < 0 ? '!' : ''}`);
check('each bracket knows where its partner is',
  scanBrackets('a(b(c))').map((m) => m.partner), [3, 2, 1, 0]);
check('a bracket inside a string is a character, not a nest',
  pairs('if(name = "a)b", 1, 0)'), ['(@2', ')@21']);
check('a stray closer has no partner', pairs('floor(x))'), ['(@5', ')@7', ')@8!']);
check('a brace closed by a bracket matches neither', pairs('{a)'), ['{@0!', ')@2!']);
check('prose braces nest with the formula inside them',
  scanBrackets('{= floor((a+b)/2)}').map((m) => m.depth), [0, 1, 2, 2, 1, 0]);

check('the character before the caret wins',
  pairAtCaret('min(a)', 6), { at: 5, partner: 3, depth: 0, matched: true });
check('and the one after it answers when there is nothing before',
  pairAtCaret('min(a)', 3), { at: 3, partner: 5, depth: 0, matched: true });
check('a caret in the middle of a word matches nothing', pairAtCaret('min(a)', 2), null);
check('an unmatched bracket is still found, and says it is unmatched',
  pairAtCaret('min(a', 4), { at: 3, partner: -1, depth: 0, matched: false });

// The mirror is the text with the pair wrapped and nothing else touched, so
// that every mark sits under the character it belongs to.
const mirror = mirrorHtml('min(a)', pairAtCaret('min(a)', 4));
check('the mirror keeps the whole text', mirror.replace(/<[^>]+>/g, ''), 'min(a)');
check('and marks both ends at the depth they are',
  (mirror.match(/<mark class="bx-hit bx-d0">/g) || []).length, 2);
check('an unmatched bracket is marked as such',
  mirrorHtml('min(a', pairAtCaret('min(a', 4)).includes('bx-miss'), true);
check('with no pair there is nothing to mark',
  mirrorHtml('min(a)', null), 'min(a)');
check('and the text is escaped on the way out',
  mirrorHtml('a<b(c)', pairAtCaret('a<b(c)', 4)).startsWith('a&lt;b'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
