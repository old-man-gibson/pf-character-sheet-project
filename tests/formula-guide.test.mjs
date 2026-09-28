/** Tests for the Formulas tab's builders. Run: node tests/formula-guide.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { resolvePath } from '../app/js/formula.js';
import {
  classify, valueGroups, formulaPanelHtml, workingHtml, browserHtml, myFormulasHtml,
  scratchpadHtml, referenceHtml, problemsHtml, forwardedHtml, VALUE_SECTIONS,
  classifyTarget, targetGroups, targetsHtml, TARGET_SECTIONS,
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
check('a Spheres of Power number', classify('caster.sp'), 'power');
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
// Two boxes may narrow the one list -- the tab's, and the list's own -- and
// a name has to satisfy both.
check('two searches both apply',
  valueGroups(names, scope, inlineNames, ['tracker', 'max']).flatMap((g) => g.items.map((i) => i.name)),
  ['tracker.burn.max']);
check('a blank second search is no search',
  valueGroups(names, scope, inlineNames, ['', 'tracker']).length,
  valueGroups(names, scope, inlineNames, 'tracker').length);
{
  const own = browserHtml(valueGroups(names, scope, inlineNames, ['', 'wis']), names.length, '', 'wis');
  check('the values list carries a search box of its own, holding what was typed',
    own.includes('data-fx-value-query') && own.includes('value="wis"'), true);
  check('and counts the matches against the whole', /<span class="badge">1 of \d+<\/span>/.test(own), true);
  const tab = formulaPanelHtml({ names, scope, inlineNames, audit: [], valueQuery: 'zzz' });
  check('the list\'s own box narrows the list on the tab', tab.includes('No value on this character matches “zzz”'), true);
  check('and leaves the formulas list alone', tab.includes('data-fx-section="formulas"'), true);
}

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

console.log('where a bonus can be sent -- the half a reader cannot see on the sheet');
{
  // Every destination is invisible until something says it exists: a value is
  // printed in a column somewhere, a destination is printed nowhere at all.
  const targets = [
    { name: 'damage', label: 'Damage, every weapon' },
    { name: 'damage.crit', label: 'Damage on a crit only, every weapon' },
    { name: 'weapon.attack', label: 'Attack, every weapon' },
    { name: 'weapon.melee.damage', label: 'Damage, melee' },
    { name: 'weapon.rapier.damage.mult', label: 'Damage, multiplied on a crit, rapier' },
    { name: 'attack.melee', label: 'Melee attack' },
    { name: 'attack', label: 'All attack', family: ['attack.melee', 'attack.ranged', 'attack.cmb'] },
    { name: 'skill.bluff', label: 'Bluff' },
    { name: 'skill', label: 'Every skill', family: ['skill.bluff', 'skill.perception'] },
    { name: 'saves.will', label: 'Will' },
    { name: 'hp.total', label: 'Max hit points' },
    { name: 'str.score', label: 'Strength' },
    { name: 'initiative', label: 'Initiative' },
    { name: 'class.rogue.level', label: 'Rogue levels' },
    { name: 'tracker.luck.max', label: 'Luck max' },
  ];

  check('damage and every weapon shape land together',
    ['damage', 'damage.crit', 'weapon.attack', 'weapon.melee.damage', 'weapon.rapier.damage.mult']
      .map(classifyTarget),
    ['weapon', 'weapon', 'weapon', 'weapon', 'weapon']);
  check('the attack numbers are their own group',
    ['attack', 'attack.melee'].map(classifyTarget), ['attack', 'attack']);
  check('and the rest go where a reader would look for them',
    ['skill.bluff', 'saves.will', 'hp.total', 'str.score', 'initiative',
      'class.rogue.level', 'tracker.luck.max'].map(classifyTarget),
    ['skill', 'defence', 'defence', 'ability', 'character', 'character', 'tracker']);

  const groups = targetGroups(targets);
  check('weapons and damage come first, because they are the unguessable ones',
    groups[0].key, 'weapon');
  check('every destination is filed somewhere',
    groups.reduce((n, g) => n + g.items.length, 0), targets.length);
  check('an empty group is not shown',
    groups.every((g) => g.items.length > 0), true);
  check('the groups keep the declared order',
    groups.map((g) => g.key),
    TARGET_SECTIONS.map((sec) => sec.key).filter((k) => groups.some((g) => g.key === k)));

  // One that stands for several says how many, because that is the whole
  // difference between the two rows a reader is choosing between.
  const attack = groups.find((g) => g.key === 'attack').items;
  check('a family says what it reaches', attack.find((i) => i.name === 'attack').reaches, 3);
  check('a single destination reaches nothing extra',
    attack.find((i) => i.name === 'attack.melee').reaches, 0);

  // Searching by name and by label alike -- "damage" is in both, but a player
  // hunting for their rapier will type the weapon, not the channel.
  // Four of the five weapon rows: weapon.attack is a weapon row without being a damage one.
  check('search by name', targetGroups(targets, 'damage').reduce((n, g) => n + g.items.length, 0), 4);
  check('search by label', targetGroups(targets, 'rapier').map((g) => g.items.map((i) => i.name)),
    [['weapon.rapier.damage.mult']]);
  check('a search that matches nothing yields no groups', targetGroups(targets, 'zzz'), []);

  const html = targetsHtml(targetGroups(targets), targets.length, '');
  check('the section is findable for the search to replace',
    html.includes('data-fx-section="targets"'), true);
  check('every chip copies a whole token, not a bare name',
    [...html.matchAll(/data-fx-copy="([^"]*)"/g)].every((m) => /^\{.+ \+= .+\}$/.test(m[1])), true);
  check('there is one chip per destination',
    [...html.matchAll(/data-fx-copy="/g)].length, targets.length);
  check('none of them is offered to the try-it box, which cannot read a destination',
    html.includes('data-fx-insert'), false);
  check('the weapon grammar is taught, not just enumerated',
    html.includes('weapon.&lt;which&gt;.&lt;what&gt;'), true);
  check('a no-match search says so', targetsHtml(targetGroups(targets, 'zzz'), targets.length, 'zzz')
    .includes('No destination'), true);
  check('two searches both apply', targetGroups(targets, ['damage', 'rapier']).map((g) => g.items.map((i) => i.name)),
    [['weapon.rapier.damage.mult']]);
  const own = targetsHtml(targetGroups(targets, ['', 'rapier']), targets.length, '', 'rapier');
  check('the list carries a search box of its own, holding what was typed',
    own.includes('data-fx-target-query') && own.includes('value="rapier"'), true);
  check('and counts the matches against the whole', /<span class="badge">1 of \d+<\/span>/.test(own), true);
  const tab = formulaPanelHtml({ names, scope, inlineNames, audit: [], targets, targetQuery: 'zzz' });
  check('the list\'s own box narrows the list on the tab, and only it',
    [tab.includes('No destination on this character matches “zzz”'), tab.includes('No value on this character')],
    [true, false]);

  // On the whole tab, and only when the character has somewhere to send one.
  const withTargets = formulaPanelHtml({ names, scope, inlineNames, audit, targets });
  check('the tab carries the destinations', withTargets.includes('Bonuses you can send'), true);
  check('and leaves them out when there are none',
    formulaPanelHtml({ names, scope, inlineNames, audit }).includes('Bonuses you can send'), false);
}

console.log('a family broken into what it is made of -- a heading each');
{
  // One character with a bit of everything that groups: skills with ranks,
  // a familiar, and two eidolons, the second of which has to get a heading of
  // its own without anyone asking for one.
  const c = new Character(blankDocument({ name: 'Headings', level: 8 }));
  c.data.skills.find((s) => s.name === 'Bluff').rankSources.bought = 3;
  c.data.familiar[0].name = 'Pip';
  c.data.eidolon[0].name = 'Ahriman';
  const second = c.addCompanion('eidolon');
  second.name = 'Wisp';
  c.addTracker({ name: 'Burn Pool', maxFormula: '5' });
  c.recompute();
  const all = valueGroups(c.scopeNames(), c.scope(), c.inlineNames || {});
  const group = (key) => all.find((g) => g.key === key);
  const heading = (key, label) => group(key)?.subs.find((s) => s.label === label);

  check('each skill has a heading, called what the sheet calls it',
    heading('skill', 'Bluff')?.items.map((i) => i.name),
    ['skill.bluff', 'skill.bluff.classSkill', 'skill.bluff.ranks', 'skill.bluff.total']);
  check('a skill with a variant keeps its label', !!heading('skill', 'Kn. (arcana)'), true);
  check('no skill is left loose above the headings', group('skill').loose, []);
  check('every name is still counted once',
    group('skill').subs.reduce((n, s) => n + s.items.length, 0), group('skill').items.length);

  check('every companion in use has a heading of its own, named, in the sheet\'s order of kinds',
    group('companion').subs.map((s) => s.label).filter((l) => !/skills$/.test(l)),
    ['Pip (Familiar)', 'Ahriman (Eidolon)', 'Wisp (Eidolon 2)']);
  check('the blank blocks nobody is using are left out -- their names still read',
    [group('companion').items.some((i) => i.name.startsWith('animalCompanion.')),
      resolvePath(c.scope(), 'animalCompanion.hd') !== undefined], [false, true]);
  check('and the count beside the list is what the list holds',
    all.listed, all.reduce((n, g) => n + g.items.length, 0));
  check('a system the character does not play with is not listed',
    all.filter((g) => ['power', 'might', 'guile', 'vancian', 'psionic', 'akashic', 'cards'].includes(g.key))
      .map((g) => g.key), []);
  check('though its names still read', resolvePath(c.scope(), 'caster.level') !== undefined, true);
  check('and the unarmed strike stays, being the character\'s',
    group('character').subs.some((s) => s.label === 'Unarmed strike'), true);
  {
    // Mark a class as a Spheres of Power one and the section is back, the
    // way the Magic tab comes back on the bar.
    const tagged = new Character(blankDocument({ name: 'Tagged', level: 8 }));
    tagged.data.classes = [{ name: 'Incanter', systems: ['spheres-of-power'] }];
    tagged.recompute();
    check('marking a class with the system lists it again',
      valueGroups(tagged.scopeNames(), tagged.scope(), {}).find((g) => g.key === 'power')?.subs.map((s) => s.label)[0],
      'Casting');
  }
  check('a second of a kind reads under its own id', heading('companion', 'Wisp (Eidolon 2)')
    .items.every((i) => i.name.startsWith('eidolon2.')), true);
  check('and a companion\'s skills sit under a heading beside it',
    heading('companion', 'Pip (Familiar) — skills')?.items.every((i) => i.name.startsWith('familiar.skill.')), true);
  check('a tracker is headed by its name, not its id',
    heading('tracker', 'Burn Pool')?.items.map((i) => i.name).includes('tracker.burn_pool.max'), true);
  check('the abilities are headed in the order a sheet lists them',
    group('ability').subs.map((s) => s.label),
    ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']);
  check('hit points before armour, armour before the saves',
    group('defence').subs.map((s) => s.label).slice(0, 5), ['Hit points', 'Armour class', 'Fortitude', 'Reflex', 'Will']);
  check('level and size sit loose above the headings they have',
    group('character').loose.map((i) => i.name).includes('level'), true);

  check('a search finds a companion by its name',
    valueGroups(c.scopeNames(), c.scope(), {}, 'wisp').flatMap((g) => g.items.map((i) => i.name))
      .every((n) => n.startsWith('eidolon2.')), true);
  check('and a skill by its label',
    valueGroups(c.scopeNames(), c.scope(), {}, 'kn. (arcana)').flatMap((g) => g.items.map((i) => i.name)),
    ['skill.kn_arcana', 'skill.kn_arcana.classSkill', 'skill.kn_arcana.ranks', 'skill.kn_arcana.total']);

  const html = browserHtml(all, c.scopeNames().length, '');
  check('the headings are drawn', html.includes('<div class="fx-subhead">Bluff</div>'), true);
  check('a small heading is a card, a big one takes the row',
    [/class="fx-sub"><div class="fx-subhead">Bluff</.test(html),
      /class="fx-sub wide"><div class="fx-subhead">Pip \(Familiar\)</.test(html)], [true, true]);
  check('and every name is drawn exactly once',
    [...html.matchAll(/data-fx-insert="/g)].length, all.reduce((n, g) => n + g.items.length, 0));

  // The destinations, the same way: one companion, one heading.
  const targets = targetGroups(c.forwardTargetList);
  const tgroup = (key) => targets.find((g) => g.key === key);
  check('each companion\'s destinations sit under the same heading, in the same order',
    tgroup('companion').subs.map((s) => s.label).filter((l) => !/skills$/.test(l)),
    ['Pip (Familiar)', 'Ahriman (Eidolon)', 'Wisp (Eidolon 2)']);
  check('every skill at once comes before each one',
    tgroup('skill').subs.map((s) => s.label), ['All skills', 'Each skill']);
  const offered = c.forwardTargetList.filter((t) => !t.unused);
  check('every destination offered is drawn once',
    [...targetsHtml(targets, c.forwardTargetList.length, '').matchAll(/data-fx-copy="/g)].length, offered.length);
  check('a sphere of a system not in play is marked, not offered, and still takes a bonus',
    [c.forwardTargetList.find((t) => t.name === 'spheres.cl')?.unused,
      targets.some((g) => g.key === 'power'), c.forwardTargets().expand('spheres.cl')], [true, false, ['spheres.cl']]);
  check('and the count is of what is offered', targets.listed, offered.length);
}

console.log('the sub-systems, each a family of its own');
{
  const systems = {
    level: 12,
    caster: { level: 12, sp: 18 },
    spheres: { cl: 12 },
    practitioner: { dc: 17 },
    unarmed: { talents: 2 },
    operative: { mod: 4 },
    vancian: { cl: 9, wizard: { cl: 9 } },
    manifester: { level: 5, psion: { level: 5 } },
    pp: { pool: 30 },
    essence: { pool: 6, hands: 2 },
    deck: { size: 40, round: 3, manip: { loaded_hand: 1 } },
    mana: { current: 10 },
    // One sphere from each list: the branch says which.
    sphere: {
      dark: { cl: 12, dc: 18, talents: 3 },
      athletics: { bab: 10, dc: 16, talents: 2 },
      study: { ranks: 8, talents: 1, dc: 15, close: 30, medium: 110, long: 440 },
    },
  };
  const sysNames = ['caster.level', 'spheres.cl', 'practitioner.dc', 'unarmed.talents', 'operative.mod',
    'vancian.cl', 'vancian.wizard.cl', 'manifester.level', 'manifester.psion.level', 'pp.pool',
    'essence.pool', 'essence.hands', 'deck.size', 'deck.round', 'deck.manip.loaded_hand', 'mana.current',
    'sphere.dark.cl', 'sphere.dark.dc', 'sphere.athletics.bab', 'sphere.athletics.dc',
    'sphere.study.ranks', 'sphere.study.dc'];
  const families = Object.fromEntries(sysNames.map((n) => [n, classify(n, {}, systems)]));
  check('Spheres of Power', ['caster.level', 'spheres.cl', 'sphere.dark.cl', 'sphere.dark.dc'].map((n) => families[n]),
    ['power', 'power', 'power', 'power']);
  check('Spheres of Might', ['practitioner.dc', 'sphere.athletics.bab', 'sphere.athletics.dc']
    .map((n) => families[n]), ['might', 'might', 'might']);
  check('the unarmed strike is the character\'s, spheres or none', families['unarmed.talents'], 'character');
  check('Spheres of Guile', ['operative.mod', 'sphere.study.ranks', 'sphere.study.dc'].map((n) => families[n]),
    ['guile', 'guile', 'guile']);
  check('a sphere\'s DC goes where its sphere does, not by its own name',
    [families['sphere.dark.dc'], families['sphere.athletics.dc'], families['sphere.study.dc']], ['power', 'might', 'guile']);
  check('Vancian, psionics, Akashic and cardcasting each on their own',
    ['vancian.wizard.cl', 'manifester.psion.level', 'pp.pool', 'essence.hands', 'deck.manip.loaded_hand']
      .map((n) => families[n]), ['vancian', 'psionic', 'psionic', 'akashic', 'cards']);
  check('and the wallet is the character\'s', families['mana.current'], 'character');

  const sys = valueGroups(sysNames, systems, {});
  const sub = (key) => sys.find((g) => g.key === key)?.subs.map((s) => s.label);
  check('the casting numbers head the Power section, then each sphere', sub('power'), ['Casting', 'Dark']);
  {
    // A sphere with talents in it goes in front of one without, whatever the
    // alphabet says -- the way the sphere tables fold the untrained away.
    const both = { ...systems, sphere: { ...systems.sphere, alteration: { cl: 12, dc: 18, talents: 0 } } };
    check('a trained sphere comes before an untrained one',
      valueGroups(['caster.level', 'sphere.alteration.cl', 'sphere.dark.cl'], both, {})
        .find((g) => g.key === 'power').subs.map((s) => s.label), ['Casting', 'Dark', 'Alteration']);
  }
  check('the practitioner before the spheres', sub('might'), ['Practitioner', 'Athletics']);
  check('the operative before the spheres', sub('guile'), ['Operative', 'Study']);
  check('power points before the manifester levels', sub('psionic'), ['Power points', 'Manifester levels']);
  check('the pool before the receptacles', sub('akashic'), ['Essence', 'Receptacles']);
  check('the deck, the table, the manipulations', sub('cards'), ['The deck', 'The table', 'Manipulations taken']);

  // A destination does not carry its sphere's branch, so the model says which
  // list it came from.
  const sphereTargets = targetGroups([
    { name: 'spheres.cl', label: 'Spheres of Power caster level' },
    { name: 'sphere.dark.dc', label: 'Dark: save DC', system: 'magic', under: 'Dark' },
    { name: 'sphere.athletics.dc', label: 'Athletics: save DC', system: 'combat', under: 'Athletics' },
    { name: 'sphere.study.dc', label: 'Study: save DC', system: 'guile', under: 'Study' },
    { name: 'vancian.cl', label: 'Every Vancian caster level', family: ['vancian.wizard.cl'] },
    { name: 'manifester.psion.level', label: 'Psion: manifester level' },
  ]);
  check('each destination files under its own system', sphereTargets.map((g) => [g.key, g.items.map((i) => i.name)]),
    [['power', ['spheres.cl', 'sphere.dark.dc']], ['might', ['sphere.athletics.dc']], ['guile', ['sphere.study.dc']],
      ['vancian', ['vancian.cl']], ['psionic', ['manifester.psion.level']]]);
  check('a sphere is headed by its own name', sphereTargets[0].subs.map((s) => s.label), ['Casting', 'Dark']);
}

console.log('where a formula is written is a button back to it');
{
  const rows = [
    { id: '1', name: '{a.note}', source: 'inline', formula: '1 + 1', value: 2, error: null, status: 'ok',
      where: 'note 1 on Lore', place: 'note:0' },
    { id: '2', name: 'Loose', source: 'player', formula: '2', value: 2, error: null, status: 'ok' },
  ];
  const html = myFormulasHtml(rows, '');
  check('a formula with a place says where, as a button carrying it',
    html.includes('data-fx-goto="note:0"') && html.includes('note 1 on Lore<span class="fx-goto-arrow"'), true);
  check('and one with none keeps the plain badge', (html.match(/data-fx-goto=/g) || []).length, 1);
  const problems = problemsHtml([{
    kind: 'orphan', name: 'nope', detail: 'Nothing defines it.',
    places: [{ label: 'used in', where: 'note 2 on Lore', formula: 'nope + 1', place: 'note:1' },
      { label: 'used in', where: 'somewhere', formula: 'nope' }],
  }]);
  check('a problem\'s places go to where they are written',
    [problems.includes('data-fx-goto="note:1"'), (problems.match(/data-fx-goto=/g) || []).length], [true, 1]);
  const forwarded = forwardedHtml([{
    to: 'Bluff', value: 2, expr: '2', type: '', where: 'note 1 on Lore', place: 'note:0', error: null, dropped: [],
  }], '');
  check('and so does a forwarded bonus', forwarded.includes('data-fx-goto="note:0"'), true);
  check('a place is escaped like everything else',
    myFormulasHtml([{ ...rows[0], place: '"><b>x' }], '').includes('data-fx-goto="&quot;&gt;&lt;b&gt;x"'), true);
}

console.log('every insertable carries the text it inserts');
const inserts = [...panel.matchAll(/data-fx-insert="([^"]*)"/g)].map((m) => m[1]);
check('there are some', inserts.length > 10, true);
check('none is empty', inserts.every((s) => s.trim().length > 0), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
