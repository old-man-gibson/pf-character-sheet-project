/** Wiki templates, as the text they leave behind: `tools/wikitext.mjs`.
 *
 *  The default rule for a template is "show its last argument", which is
 *  right for nearly every link template and exactly wrong for a few. Those few
 *  are written down in `NAMED`, and this is where each is held to what it says.
 *
 *  Run: node tests/wikitext.test.mjs */
import { unwrapTemplates } from '../tools/wikitext.mjs';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
