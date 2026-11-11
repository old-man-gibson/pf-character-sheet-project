/** Wiki templates, as the text they leave behind: `tools/wikitext.mjs`.
 *
 *  The default rule for a template is "show its last argument", which is
 *  right for nearly every link template and exactly wrong for a few. Those few
 *  are written down in `NAMED`, and this is where each is held to what it says.
 *
 *  Run: node tests/wikitext.test.mjs */
import { unwrapTemplates, expandTemplate, wikiExpr, tablesAsPipes, useTemplateSources } from '../tools/wikitext.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
};

console.log('link templates');
check('the default is the last argument, which is the label', unwrapTemplates('cast {{AON|Spell|Magic Missile|magic missiles}}'), 'cast magic missiles');
check('pl shows its first argument; the second only names the page', unwrapTemplates('the {{pl|Alteration|sphere}}'), 'the Alteration');
check('pll shows both, since both are the name',
  unwrapTemplates('{{pll|Autumn|Blast}}, {{pll|Chilled Bone|Blast}}'), 'Autumn Blast, Chilled Bone Blast');

console.log('\nlist and label templates');
check('a list template is every argument, not the last', unwrapTemplates('{{AONList|x=Domain|Chaos|Death}}'), 'Chaos, Death');
check('the blasts an infusion goes with are a labelled line, each blast named in full',
  unwrapTemplates('{{Associated Blast|{{pll|Earth|Blast}}, {{pll|Wood|Blast}}}}\n\nYour blasts are sharp.'),
  'Associated Blasts: Earth Blast, Wood Blast\n\nYour blasts are sharp.');
check('furniture leaves nothing', unwrapTemplates('{{Header AON|x.aspx|X}}Text'), 'Text');

console.log('\na template expanded from its source');
check('expressions, in order of precedence', [wikiExpr('6+2*3'), wikiExpr('20 > 1'), wikiExpr('0 + 0 > 0'), wikiExpr('(1 + 1) * 3 = 6 and 1'), wikiExpr('7 mod 3'), wikiExpr('nonsense')],
  [12, 1, 0, 1, 1, NaN]);
check('parameters, with and without their defaults', expandTemplate('{{{a}}}/{{{b|none}}}/{{{c}}}', { a: 'x' }), 'x/none/{{{c}}}');
check('#if, #ifexpr, #len and #expr', expandTemplate('{{#if:{{{a|}}}|yes|no}} {{#if:{{{b|}}}|yes|no}} {{#ifexpr:{{{n|20}}} > 1|more|less}} {{#len:{{{a}}}}} {{#expr: {{#len:{{{a}}}}} * 2}}', { a: 'abc' }),
  'yes no more 3 6');
check('#switch: a match, a fall-through, the default, and a number that matches another spelling', [
  expandTemplate('{{#switch:{{{bab}}} |1 = full |3/4 = medium |#default = {{{bab1|?}}}}}', { bab: '3/4' }),
  expandTemplate('{{#switch:{{{s}}} |p1 |p2 = prestige |2 = good}}', { s: 'p1' }),
  expandTemplate('{{#switch:{{{bab}}} |1 = full |#default = {{{bab1|?}}}}}', { bab: 'x', bab1: '+4' }),
  expandTemplate('{{#switch:{{{n}}} |1.0 = one |two}}', { n: '1' }),
], ['medium', 'prestige', '+4', 'one']);
check('{{!}} is a pipe that does not split the call it is in', expandTemplate('{{#if:{{{a}}}|{{!}} {{{a}}}|none}}', { a: 'cell' }), '| cell');

const TABLE = [
  '{|class="wikitable"',
  '{{#if:{{{xa|}}}|!colspan="2"{{!}} Group|[[Category:Dummy]]}}',
  '|- align=center',
  '|+ Table: {{{name|{{PAGENAME}}}}}',
  '! Level',
  '! Special',
  '{{#if:{{{xa|}}}|!{{{xa}}}|[[Category:Dummy]]}}',
  '|-',
  '|1st',
  '{{!}} {{{sp1|—}}}',
  '{{#if:{{{xa|}}}|{{!}} {{{xa1|—}}}|[[Category:Dummy]]}}',
  '|-',
  '{{#ifexpr: {{{level|20}}} > 1 |{{!}}2nd',
  '{{!}} {{{sp2|—}}}',
  '{{#if:{{{xa|}}}|{{!}} {{{xa2|—}}}|[[Category:Dummy]]}}',
  '}}',
  '|}',
].join('\n');
check('a table as pipe rows: group headings and caption gone, attributes and links off',
  tablesAsPipes('{|\n!colspan="2"| Group\n|-\n|+ Caption\n! Level !! Special\n|-\n| 1st || [[Rage|Rage]], [[fast movement]]<br />+10\n|}'),
  '| Level | Special |\n| 1st | Rage, fast movement +10 |');
useTemplateSources([['Class Table', TABLE]]);
check('a Class Table call is the table it draws, with its extra column',
  unwrapTemplates('Class Features\n{{Class Table\n|sp1 =Rage, {{pl|Fast Movement|class}}\n|sp2 =Uncanny dodge\n|xa =Rage Rounds\n|xa1 =4\n|xa2 =6\n}}\nRage: She rages.', 'Barbarian'),
  'Class Features\n\n\n| Level | Special | Rage Rounds |\n| 1st | Rage, Fast Movement | 4 |\n| 2nd | Uncanny dodge | 6 |\n\n\nRage: She rages.');
check('and stops at the level it is told to', unwrapTemplates('{{Class Table|level=1|sp1=Rage}}', 'X').trim(), '| Level | Special |\n| 1st | Rage |');
useTemplateSources([]);
check('with no source, it is guessed at as before', unwrapTemplates('A{{Class Table|sp1=Rage}}B'), 'AB');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
