/** Tests for the Formulas tab's builders. Run: node tests/formula-guide.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import {
  classify, valueGroups, formulaPanelHtml, workingHtml, browserHtml, myFormulasHtml,
  scratchpadHtml, referenceHtml, problemsHtml, VALUE_SECTIONS,
} from '../app/js/formula-guide.js';

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
  wis: { score: 20, mod: 5 },
  int: { score: 18, mod: 4 },
  saves: { fortitude: 20, reflex: 18, will: 22 },
  attack: { melee: 25, ranged: 20, cmb: 24 },
  skill: { perception: 30, sense_motive: 25 },
  mythic: { tier: 5 },
  caster: { level: 20, sp: 40 },
  eidolon: { hd: 12 },
  tracker: { burn: { max: 18, current: 3, remaining: 15 } },
  qi: { max: 12 },
  arms: { hp: 18 },
};
const names = [
  'level', 'bab', 'mythic.tier', 'str.mod', 'str.score', 'wis.mod', 'int.mod',
  'saves.will', 'attack.cmb', 'skill.perception', 'skill.sense_motive',
  'caster.level', 'caster.sp', 'eidolon.hd',
  'tracker.burn.max', 'tracker.burn.current', 'tracker.burn.remaining',
  'qi.max', 'arms.hp',
];
const inlineNames = { 'qi.max': 12, 'arms.hp': 18 };

console.log('classify: a dotted name lands in the right family');
check('an inline name is the player’s own', classify('qi.max', inlineNames), 'mine');
check('...even when it looks built-in', classify('level', { level: 1 }), 'mine');
check('tracker', classify('tracker.burn.max'), 'tracker');
check('skill', classify('skill.perception'), 'skill');
check('ability', classify('str.mod'), 'ability');
check('defence', classify('saves.will'), 'defence');
check('attack', classify('attack.cmb'), 'offence');
check('companion', classify('eidolon.hd'), 'companion');
check('magic', classify('caster.sp'), 'magic');
check('character', classify('level'), 'character');
check('a class level is the character too', classify('class.legendary_kineticist.level'), 'character');
check('anything else', classify('somethingNew.x'), 'other');
check('every family has a section', VALUE_SECTIONS.map((s) => s.key).includes('other'), true);

console.log('valueGroups: grouped, ordered, and carrying live values');
const groups = valueGroups(names, scope, inlineNames);
check('the player’s own names come first', groups[0].key, 'mine');
check('and are all there', groups[0].items.map((i) => i.name), ['qi.max', 'arms.hp']);
check('with their values', groups[0].items.map((i) => i.display), ['12', '18']);
check('sections follow the declared order',
  groups.map((g) => g.key),
  VALUE_SECTIONS.map((s) => s.key).filter((k) => groups.some((g) => g.key === k)));
check('empty sections are dropped', groups.every((g) => g.items.length > 0), true);

console.log('valueGroups: only real values, never branches');
check('a branch is not offered', valueGroups(['str'], scope, {}).length, 0);
check('a leaf is', valueGroups(['str.mod'], scope, {})[0].items[0].display, '-1');
check('a name the scope does not have is dropped', valueGroups(['nope.nope'], scope, {}).length, 0);

console.log('valueGroups: the search box');
check('narrows by substring',
  valueGroups(names, scope, inlineNames, 'tracker').flatMap((g) => g.items.map((i) => i.name)),
  ['tracker.burn.max', 'tracker.burn.current', 'tracker.burn.remaining']);
check('is case-insensitive', valueGroups(names, scope, inlineNames, 'WIS').length, 1);
check('matches mid-name', valueGroups(names, scope, inlineNames, 'perception')[0].items.length, 1);
check('no match is an empty list', valueGroups(names, scope, inlineNames, 'zzz'), []);

console.log('workingHtml: the substitution, and what it reads');
const w = workingHtml('floor(level / 2) + wis.mod', scope, new Set(names));
check('shows what was written', w.includes('written'), true);
check('shows the substitution', w.includes('this character'), true);
check('shows the answer', w.includes('fx-answer'), true);
check('answer is right', w.includes('>15<'), true);
check('lists what it reads', w.includes('data-fx-insert="level"'), true);
check('a constant has nothing to substitute', workingHtml('12', scope).includes('this character'), false);
const bad = workingHtml('floor(', scope);
check('a broken formula says so', bad.includes('problem'), true);
check('and shows no answer', bad.includes('fx-answer'), false);
const unknown = workingHtml('level + nope', scope, new Set(names));
check('an unknown name is marked', unknown.includes('fx-unknown'), true);

console.log('the panel: every section, and nothing unescaped');
const audit = [
  { id: '1', name: '{qi.max}', source: 'inline', formula: 'floor(level / 2) + wis.mod', value: 15, error: null, status: 'ok' },
  { id: '2', name: 'Burn', source: 'player', formula: 'floor(', value: null, error: 'Unexpected end of formula', status: 'error' },
];
const panel = formulaPanelHtml({ names, scope, inlineNames, audit, draft: 'level + 1', query: '' });
for (const needle of ['Try one', 'Values you can read', 'Formulas on this character', 'Reference',
  'data-fx-draft', 'data-fx-query', 'data-fx-section="values"', 'data-fx-section="formulas"']) {
  check(`panel has ${needle}`, panel.includes(needle), true);
}
check('a broken formula is counted', panel.includes('1 not working'), true);
check('the reference is folded away by default', /<details\s[^>]*data-fx-ref>/.test(panel), true);
check('and can be asked to open',
  /<details open data-fx-ref>/.test(formulaPanelHtml({ names, scope, inlineNames, audit, refOpen: true })), true);

console.log('the panel: hostile input cannot become markup');
const nasty = '<img src=x onerror=alert(1)>';
const injected = formulaPanelHtml({
  names: [...names, nasty],
  scope: { ...scope, [nasty]: 1 },
  inlineNames,
  audit: [{ id: 'x', name: nasty, source: nasty, formula: nasty, value: nasty, error: nasty, status: 'error' }],
  draft: nasty,
  query: nasty,
});
check('no live img tag anywhere', injected.includes('<img'), false);
check('the raw text never survives verbatim', injected.includes(nasty), false);
check('it is escaped instead', injected.includes('&lt;img'), true);

// A quote is the one character that could end an attribute early and start a
// handler, so it gets its own check rather than riding on the tag test above.
const quoted = '" onmouseover="alert(1)';
const attacked = formulaPanelHtml({
  names: [...names, quoted],
  scope: { ...scope, [quoted]: 1 },
  inlineNames: { [quoted]: 1 },
  audit: [{ id: 'q', name: quoted, source: 'inline', formula: quoted, value: 1, error: null, status: 'ok' }],
  draft: quoted,
  query: quoted,
});
check('a quote cannot close an attribute', attacked.includes('" onmouseover='), false);
check('it is escaped instead', attacked.includes('&quot; onmouseover='), true);

console.log('empty and awkward characters still render');
check('no names at all', typeof formulaPanelHtml({ names: [], scope: {}, audit: [] }), 'string');
check('says so when nothing has been written',
  formulaPanelHtml({ names, scope, audit: [] }).includes('Nothing yet'), true);
check('says so when the search finds no formula',
  myFormulasHtml(audit, 'zzz').includes('No formula here matches'), true);
check('says so when the search finds no value',
  browserHtml([], names.length, 'zzz').includes('No value on this character matches'), true);
check('an empty try-it box offers starters',
  scratchpadHtml('', scope, new Set(names)).includes('fx-starter'), true);
check('a filled one does not',
  scratchpadHtml('level', scope, new Set(names)).includes('fx-starter'), false);
check('the reference builds without a scope', typeof referenceHtml({}, false), 'string');

console.log('a formula is judged where it lives, not against the character alone');
// The bug this pins: essence.self is real inside a veil's own description and
// nowhere else, so a tab that checked names against the character called four
// working formulas broken. The model decides (unknownReferences), the tab obeys.
const veiled = new Character({
  ...blankDocument({ name: 'Veiled', level: 10 }),
  akashic: {
    slots: [{
      slot: 'Hands',
      twinveil: false,
      veils: [{
        name: 'Bloodburst',
        essence: 4,
        desc: 'Max {bloodburst_max = 2 + floor(essence.self / 2)}, '
          + 'damage {bloodburst_damage = int.mod + essence.self * 2}, '
          + 'and {broken_one = 1 + notAThing}.',
      }],
    }],
  },
});
const veilRows = veiled.audit().filter((r) => r.source === 'inline');
const row = (name) => veilRows.find((r) => r.name === name);
check('a veil formula reading essence.self is not broken', row('{bloodburst_max}').status, 'ok');
check('and nothing in it is called unknown', row('{bloodburst_max}').unknownReferences, []);
check('it works out against the essence invested', row('{bloodburst_max}').value, 4);
check('one mixing character and veil values is fine too',
  row('{bloodburst_damage}').unknownReferences, []);
check('a genuinely missing name is still caught',
  row('{broken_one}').unknownReferences, ['notAThing']);
check('the row carries the scope it was written in',
  row('{bloodburst_max}').locals, { essence: { self: 4 } });

const veilHtml = myFormulasHtml(veilRows, '');
check('so the tab does not underline essence.self',
  veilHtml.split('bloodburst_max')[1]?.split('</div>')[0]?.includes('fx-unknown'), false);
check('but does underline the name that is missing',
  veilHtml.includes('fx-unknown'), true);
check('and none of the three is badged as not working',
  (veilHtml.match(/not working/g) || []).length, 2);   // the badge in the head, and one row

console.log('the four ways a set of names can go wrong');
// One character carrying all of them at once, because they interact: a name in
// a cycle must not also be reported as undefined, and a duplicate must not
// stop the sheet computing.
const troubled = new Character({
  ...blankDocument({ name: 'Trouble', level: 10 }),
  notes: [
    { title: 'A', body: 'twice {qi.max = 100}, loop {a = b + 1}, taken {level = 30}, branch {str = 4}' },
    { title: 'B', body: 'twice {qi.max = 7}, loop {b = a + 1}, gone {deleted.name}, in a sum {= other.missing + 1}' },
  ],
});
const problems = troubled.formulaProblems();
const kind = (k) => problems.filter((x) => x.kind === k);

check('a duplicate is one problem, not two', kind('duplicate').map((p) => p.name), ['qi.max']);
check('the first definition is the one in force', troubled.inlineNames['qi.max'], 100);
check('both definitions are shown', kind('duplicate')[0].places.length, 2);
check('with what each one comes to', kind('duplicate')[0].places.map((p) => p.value), [100, 7]);
check('and which is in force', kind('duplicate')[0].places.map((p) => p.inForce), [true, false]);
check('each says where it is', kind('duplicate')[0].places.map((p) => p.where),
  ['note 1 on Lore', 'note 2 on Lore']);

check('a cycle is one problem naming its members', kind('cycle').length, 1);
check('and lists both places', kind('cycle')[0].places.map((p) => p.label).sort(), ['a', 'b']);
check('nothing in the loop resolves', [troubled.inlineNames.a, troubled.inlineNames.b], [undefined, undefined]);

check('a name the sheet owns is refused', kind('shadow').map((p) => p.name).sort(), ['level', 'str']);
check('and does not publish', troubled.inlineNames.level, undefined);
check('the real value is untouched', troubled.scope().level, 10);
check('a branch of built-ins is refused too', troubled.scope().str.mod, 0);

check('a name nothing defines is an orphan',
  kind('orphan').map((p) => p.name), ['deleted.name', 'other.missing']);
check('a quoted one says where it is quoted',
  kind('orphan')[0].places[0].where, 'note 2 on Lore');
check('one inside a sum is found too',
  kind('orphan')[1].places[0].formula, 'other.missing + 1');
check('a name that IS defined but broken is not called an orphan',
  kind('orphan').some((p) => p.name === 'a' || p.name === 'b'), false);

const troubledHtml = problemsHtml(problems);
check('the panel names every problem',
  problems.every((p) => troubledHtml.includes(p.name.split(' ')[0])), true);
check('it counts them', troubledHtml.includes(`<span class="badge err">${problems.length}</span>`), true);
check('the in-force definition is marked', troubledHtml.includes('fx-place inforce'), true);
check('a clean character gets no panel at all', problemsHtml([]), '');

const clean = new Character({
  ...blankDocument({ name: 'Clean', level: 10 }),
  notes: [{ title: 'A', body: 'fine {my.pool = floor(level / 2)} and {my.pool} again' }],
});
check('nothing wrong, nothing reported', clean.formulaProblems(), []);
check('and the name resolves', clean.inlineNames['my.pool'], 5);
check('a name quoted after being defined is not an orphan', clean.orphans(), []);

console.log('every insertable carries the text it inserts');
const inserts = [...panel.matchAll(/data-fx-insert="([^"]*)"/g)].map((m) => m[1]);
check('there are some', inserts.length > 10, true);
check('none is empty', inserts.every((s) => s.trim().length > 0), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
