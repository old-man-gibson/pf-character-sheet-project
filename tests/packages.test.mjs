/** Archetype packages: reading them, swapping one for another, and the two limits.
 *
 *  A package is a named set of a class's features. A class may give one up
 *  for another package when the campaign allows it (`archetypePackages`).
 *  The swap is an archetype built on the spot, so the class's ladder loses
 *  the given-up features and gains the taken ones, and taking it off puts
 *  everything back.
 *
 *  Run: node tests/packages.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import {
  applyBlock, archetypeMarks, normalizeBlock, normalizeExtension, removeArchetype, swapLabel,
} from '../app/js/extensions.js';
import { looksLikePackageList, readPackageList, readPackageSentence } from '../app/js/package-text.js';
import { packageBlocks, packageCheck, packageProblems, swapPackage, swapsOn } from '../app/js/packages.js';
import { parsePaste } from '../app/js/paste-import.js';
import { runtime } from '../app/js/extension-runtime.js';
import { renderProgressionPanel } from '../app/js/ui/panels/lore.js';
import { campaignPanel } from '../app/js/ui/panels/campaign.js';
import { undoLabel } from '../app/js/model/undo.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

console.log('a package sentence names what it holds and what it grants');
{
  const read = (t, cls) => readPackageSentence(t, cls);
  check('features, single grants at their levels, and the Oxford "and"',
    read('The Iron Guard archetype grants a warden the bonus feats gained at 1st, 6th, and 12th levels, stalwart, and shield training. A warden that gives it up never gains them.', 'Warden'),
    { includes: ['bonus feats@1', 'bonus feats@6', 'bonus feats@12', 'stalwart', 'shield training'], grants: [] });
  check('all of its spellcasting is a power, not a feature',
    read('The Songweaver archetype grants a minstrel all his spellcasting ability. A minstrel that gives up this package gains no caster level.', 'Minstrel'),
    { includes: [], grants: ['spellcasting'] });
  check('"as well as" and "including" add their features',
    read('The Fury package includes a raider\'s frenzy class ability and all frenzy powers, including greater frenzy and endless frenzy.', 'Raider'),
    { includes: ['raider\'s frenzy', 'frenzy powers', 'greater frenzy', 'endless frenzy'], grants: [] });
  check('a list of levels before the feature',
    read('The Drillmaster archetype grants a recruit her 1st, 2nd, and 6th level bonus feats.', 'Recruit').includes,
    ['bonus feats@1', 'bonus feats@2', 'bonus feats@6']);
  check('a use gained later names the feature before it',
    read('The Herald archetype package includes 1 use/day of the summons ability gained at 1st level, 1 use/day gained at 16th level, and the herald\'s oath.', 'Herald').includes,
    ['summons@1', 'summons@16', 'herald\'s oath']);
  check('a feature with "spells" in its name is a feature',
    read('The Drainer package includes the Arcane Well, Drink Spells, and Deep Well class features.', 'Siphon'),
    { includes: ['Arcane Well', 'Drink Spells', 'Deep Well'], grants: [] });
  check('a class named outright goes, whatever word follows it',
    read('The Duelist archetype grants a spellblade Parry Spell, and Spell Riposte class abilities, plus all her spherecasting ability.', 'Spellblade'),
    { includes: ['Parry Spell', 'Spell Riposte'], grants: ['spherecasting'] });
  check('combat training is a feature and a power',
    read('The Breaker archetype grants a smith the Combat Training, and Hammerfall class abilities.', 'Smith'),
    { includes: ['Combat Training', 'Hammerfall'], grants: ['combat training'] });
  check('manifesting',
    read('The Seer archetype grants an oracle all of his manifesting ability.', 'Oracle').grants, ['manifesting']);
  check('a sentence with no lead holds nothing', read('A smith without this package has fewer talents.'), { includes: [], grants: [] });
}

console.log('\na document of packages');
{
  const doc = [
    '# House packages',
    '**Note:** A class may hold one package that grants spellcasting.',
    '## Martial',
    '### **Warden**',
    'The warden has one archetype package: *Iron Guard*',
    '**Iron Guard:** The Iron Guard archetype grants a warden the stalwart and shield training class abilities.',
    '### Minstrel',
    '**Stage Presence**: The Stage Presence archetype grants a minstrel the rousing song and versatile song class abilities.',
    '**  ',
    '****Songweaver:** The Songweaver archetype grants a minstrel all his spellcasting ability.',
    '### Warden (also in Martial)',
    '**Iron Guard:** The Iron Guard archetype grants a warden the stalwart class ability.',
  ].join('\n');
  check('reads as a package list', looksLikePackageList(doc), true);
  check('a class page does not', looksLikePackageList('Fighter\nBravery (Ex): At 2nd level, a fighter gains a bonus.\nArmor Training (Ex): Starting at 3rd level...'), false);
  const blocks = readPackageList(doc);
  check('one block per package under its class heading, a repeat read once',
    blocks.map((b) => `${b.class}/${b.name}`), ['Warden/Iron Guard', 'Minstrel/Stage Presence', 'Minstrel/Songweaver']);
  check('what each holds', blocks.map((b) => [b.includes, b.grants]),
    [[['stalwart', 'shield training'], []], [['rousing song', 'versatile song'], []], [[], ['spellcasting']]]);
  const pasted = parsePaste(doc);
  check('a paste of it comes back as package blocks', pasted.blocks.map((b) => b.kind), ['package', 'package', 'package']);
  check('and says so', pasted.report, ['3 archetype packages for 2 classes.']);
}

console.log('\nthe package block');
{
  const b = normalizeBlock({ kind: 'package', name: 'Iron Guard', class: 'Warden', text: 'The Iron Guard archetype grants a warden the stalwart class ability.' });
  check('reads what it holds off its text', [b.includes, b.grants], [['stalwart'], []]);
  const given = normalizeBlock({ kind: 'package', name: 'X', class: 'Warden', text: 'The X package includes the stalwart class ability.', includes: ['Guard@4'], grants: ['Spellcasting', 'flying'] });
  check('a pack that says outright wins, and only known powers count', [given.includes, given.grants], [['Guard@4'], ['spellcasting']]);
  check('a package of no class carries its own features',
    normalizeBlock({ kind: 'package', name: 'Exemplar', features: [{ name: 'Prowess', level: 1, text: 'Fit.' }, { name: 'Practice', level: 5 }] }).features.map((f) => `${f.level}:${f.name}`),
    ['1:Prowess', '5:Practice']);
}

/* ---------------- swapping ---------------- */

const FIGHTER = {
  kind: 'class', name: 'Fighter', hd: 10, bab: 1, skillRanks: 2, goodFort: true,
  features: [
    { level: 1, name: 'Bonus feat' }, { level: 2, name: 'Bonus feat' }, { level: 4, name: 'Bonus feat' }, { level: 6, name: 'Bonus feat' },
    { level: 2, name: 'Bravery', text: 'A bonus on Will saves against fear.' },
    { level: 3, name: 'Armor training' }, { level: 5, name: 'Weapon training' },
  ],
};
const MINSTREL = {
  kind: 'class', name: 'Minstrel', hd: 8, bab: 0.75, skillRanks: 6, goodRef: true, goodWill: true,
  features: [
    { level: 1, name: 'Rousing Song (Su)', text: 'Songs that help allies.' },
    { level: 2, name: 'Versatile Song (Ex)', text: 'Song ranks stand in for other skills.' },
  ],
};
const PACKAGES = [
  { kind: 'package', name: 'Blade Drill', class: 'Fighter', text: 'The Blade Drill archetype grants a fighter the bonus feats gained at 1st and 6th levels, bravery, and weapon training.' },
  { kind: 'package', name: 'Stage Presence', class: 'Minstrel', text: 'The Stage Presence archetype grants a minstrel the rousing song and versatile song class abilities.' },
  { kind: 'package', name: 'Songweaver', class: 'Minstrel', text: 'The Songweaver archetype grants a minstrel all his spellcasting ability.' },
  { kind: 'package', name: 'Exemplar', text: 'Anyone fit.', features: [{ name: 'Prowess', level: 1, text: '+1 on Fortitude saves.' }, { name: 'Practice', level: 5, text: 'A bonus feat.' }] },
].map(normalizeBlock);
const BLOCKS = [normalizeBlock(FIGHTER), normalizeBlock(MINSTREL), ...PACKAGES];
const pkg = (name) => PACKAGES.find((p) => p.name === name);

/** A level 6 fighter with the class's ladder from its block. */
function fighter() {
  const c = new Character(blankDocument({ name: 'Tess', level: 6 }));
  for (let l = 1; l <= 6; l++) c.setProgressionClass(l, 0, 'Fighter');
  applyBlock(c, FIGHTER);
  return c;
}
/** A class's ladder as text, cells left empty dropped (taking an archetype off leaves them ''). */
const ladder = (c, cls = 'Fighter') => JSON.stringify(c.data.progression.classFeatures[cls], (k, v) => (v === '' ? undefined : v));
const notes = (c, cls = 'Fighter') => c.classFeatureNotes(cls).map((n) => n.name);

console.log('\na swap waits for the campaign rule');
{
  const c = fighter();
  const before = ladder(c);
  check('off by default: nothing happens', swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Stage Presence'), blocks: BLOCKS }),
    'Archetype packages are off in Campaign rules.');
  check('and the ladder is as it was', ladder(c), before);
  check('the Progression tab has no package panel', renderProgressionPanel(c, { draft: {} }).includes('pkgpanel'), false);
  c.set('campaign.archetypePackages', true);
  check('the Campaign rules panel shows the switch on', campaignPanel(c).includes('data-set="campaign.archetypePackages" data-kind="bool"'), true);
}

console.log('\ngiving up one package for another class\'s');
{
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  const before = ladder(c);
  const beforeNotes = notes(c);
  const said = swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Stage Presence'), blocks: BLOCKS });
  check('says what it did', /^Added Stage Presence to Fighter, replacing .*Bravery.*Weapon training.*Bonus feat at 1st and 6th/.test(said), true);
  const special = (lvl) => c.data.progression.classFeatures.Fighter.byLevel[lvl]?.Special || '';
  check('bravery and weapon training leave the ladder', [special(2).includes('Bravery'), special(5).includes('Weapon training')], [false, false]);
  check('the taken features arrive at their own class\'s levels', [special(1).includes('Rousing Song (Su)'), special(2).includes('Versatile Song (Ex)')], [true, true]);
  check('with their text under the class', ['Stage Presence package', 'Rousing Song (Su)', 'Versatile Song (Ex)'].every((n) => notes(c).includes(n)), true);
  check('the given-up text goes', notes(c).includes('Bravery'), false);
  const row = c.data.classes.find((x) => x.name === 'Fighter');
  check('the swap is on the class row', swapsOn(row).map((e) => e.package), [{
    gives: 'Blade Drill', givesClass: 'Fighter', givesGrants: [], takes: 'Stage Presence', takesClass: 'Minstrel', grants: [],
  }]);
  check('and named in its archetypes', row.archetypes, 'Stage Presence');
  check('the same package cannot be given up twice',
    swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Exemplar'), blocks: BLOCKS }), 'Fighter has already given up Blade Drill.');

  const reopened = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('it survives a reload', swapsOn(reopened.data.classes.find((x) => x.name === 'Fighter')).length, 1);

  check('one undo step, named for the swap', undoLabel(c), 'Swapped Blade Drill for Stage Presence on Fighter');
  const u = fighter();
  u.set('campaign.archetypePackages', true);
  const uBefore = ladder(u);
  swapPackage(u, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Stage Presence'), blocks: BLOCKS });
  u.undo();
  check('one undo takes the whole swap back', [ladder(u), swapsOn(u.data.classes.find((x) => x.name === 'Fighter')).length], [uBefore, 0]);

  check('the pill takes it off', /^Removed Stage Presence from Fighter/.test(removeArchetype(c, 'Fighter', 'Stage Presence')), true);
  check('in one undo step too', undoLabel(c), 'Removed Stage Presence from Fighter');
  check('and the ladder is back exactly', ladder(c), before);
  check('and the class text', notes(c).slice().sort(), beforeNotes.slice().sort());
  check('and the row', [swapsOn(c.data.classes.find((x) => x.name === 'Fighter')).length, c.data.classes.find((x) => x.name === 'Fighter').archetypes], [0, '']);
}

console.log('\na package of no class brings its own features');
{
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Exemplar'), blocks: BLOCKS });
  const special = (lvl) => c.data.progression.classFeatures.Fighter.byLevel[lvl]?.Special || '';
  check('at their own levels', [special(1).includes('Prowess'), special(5).includes('Practice')], [true, true]);
}

console.log('\na package that grants spellcasting gets a casting class');
{
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  const said = swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Songweaver'), blocks: BLOCKS });
  check('says so', said.includes('Added the casting class Fighter (Songweaver) on Vancian Magic.'), true);
  const cast = c.data.vancian.classes.find((x) => x.name === 'Fighter (Songweaver)');
  check('on the taken class\'s slot table, counting the fighter\'s levels', [cast?.slotType, cast?.levelClass, cast?.casterLevelBase], ['Minstrel', 'Fighter', 6]);
  const fighterRow = () => c.data.classes.find((x) => x.name === 'Fighter');
  check('the class is marked as using Vancian magic, and its tab is on the bar', [fighterRow().systems.includes('vancian'), c.tabOrder().includes('vancian')], [true, true]);
  removeArchetype(c, 'Fighter', 'Songweaver');
  check('and it goes when the swap does', c.data.vancian.classes.length, 0);
  check('with the mark and the tab it turned on', [fighterRow().systems.includes('vancian'), c.tabOrder().includes('vancian')], [false, false]);
  check('undo puts the swap back', [c.undo() !== null, swapsOn(c.data.classes.find((x) => x.name === 'Fighter')).length], [true, 1]);
}

console.log('\nan archetype that touches the same features blocks the swap');
{
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  applyBlock(c, { kind: 'archetype', name: 'Shieldbearer', class: 'Fighter', features: [{ level: 2, name: 'Steady', text: 'This ability replaces bravery.' }] });
  const before = ladder(c);
  check('says which', /^Stage Presence cannot be added: it and Shieldbearer both change braver/.test(
    swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Stage Presence'), blocks: BLOCKS })), true);
  check('and changes nothing', ladder(c), before);
}

console.log('\nthe two limits');
{
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  applyBlock(c, MINSTREL);
  swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Songweaver'), blocks: BLOCKS });
  check('a package held by two classes', packageProblems(c, BLOCKS).map((p) => p.text),
    ['Songweaver is on Fighter and Minstrel. A character can hold each package only once.']);

  const w = new Character(blankDocument({ name: 'Wren', level: 4 }));
  for (let l = 1; l <= 4; l++) w.setProgressionClass(l, 0, 'Wizard');
  w.set('campaign.archetypePackages', true);
  applyBlock(w, { kind: 'class', name: 'Wizard', hd: 6, bab: 0.5, features: [{ level: 1, name: 'Arcane bond' }] });
  w.listAdd('vancian.classes', { name: 'Wizard', slotType: 'Wizard', spells: [] });
  const wiz = [{ kind: 'package', name: 'Bondmage', class: 'Wizard', text: 'The Bondmage archetype grants a wizard the arcane bond class ability.' }].map(normalizeBlock);
  const all = [...BLOCKS, ...wiz];
  swapPackage(w, { className: 'Wizard', gives: wiz[0], takes: pkg('Songweaver'), blocks: all });
  check('spellcasting outside any package counts', packageProblems(w, all).map((p) => p.text),
    ['Wizard already casts spells, and Songweaver grants spellcasting.']);

  const two = [{ kind: 'package', name: 'Runecaster', class: 'Runner', text: 'The Runecaster package grants a runner all of her spellcasting.' },
    { kind: 'package', name: 'Footwork', class: 'Runner', text: 'The Footwork package includes the sprint class feature.' }].map(normalizeBlock);
  const r = new Character(blankDocument({ name: 'Ro', level: 2 }));
  r.set('campaign.archetypePackages', true);
  applyBlock(r, { kind: 'class', name: 'Runner', hd: 8, bab: 0.75, features: [{ level: 1, name: 'Sprint' }] });
  swapPackage(r, { className: 'Runner', gives: two[1], takes: pkg('Songweaver'), blocks: [...BLOCKS, ...two] });
  check('two packages granting one power on a class', packageProblems(r, [...BLOCKS, ...two]).map((p) => p.text),
    ['Runner has spellcasting from Runecaster and Songweaver. A class can hold only one package that grants spellcasting.']);
}

console.log('\nthe Progression panel');
{
  runtime.bundled = [normalizeExtension({ id: 'zz-packages', name: 'Packages', blocks: [FIGHTER, MINSTREL, ...PACKAGES] })];
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  let html = renderProgressionPanel(c, { draft: {} });
  check('a row to swap for each class with packages', [html.includes('pkgpanel'), html.includes('data-action="package-swap" data-class="Fighter"')], [true, true]);
  check('its own packages to give up', /data-pkg="give"[^>]*>\s*<option value="fighter\|blade drill"/.test(html), true);
  check('every other package to take, by class', ['<optgroup label="Any class">', '<optgroup label="Minstrel">', 'value="minstrel|songweaver"'].every((s) => html.includes(s)), true);
  swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Songweaver'), blocks: runtime.blocks() });
  html = renderProgressionPanel(c, { draft: {} });
  check('a swap made is listed with its ×', html.includes('data-action="arch-remove"'), true);
  check('and with nothing left to give up, no swap row', html.includes('data-action="package-swap"'), false);
  check('packageBlocks keeps one per class and name', packageBlocks([...runtime.blocks(), ...PACKAGES]).length, PACKAGES.length);
  runtime.bundled = [];
}

console.log('\nthe check before a swap');
{
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  const drill = normalizeBlock({ ...pkg('Blade Drill'), text: undefined, includes: ['bonus feats@1', 'bonus feats@6', 'bonus feats@12', 'bravery', 'weapon training', 'iron will'] });
  const said = packageCheck(c, { className: 'Fighter', gives: drill, takes: pkg('Stage Presence'), blocks: BLOCKS });
  check('what leaves the ladder, at the levels it sits at', said.removes, [
    { name: 'Bonus feat', levels: [1, 6] }, { name: 'Bravery', levels: [2] }, { name: 'Weapon training', levels: [5] }]);
  check('what the package names that the ladder has not got, with the levels it lacks', said.absent, ['Bonus feats at 12th', 'Iron will']);
  check('what joins it, at its own class\'s levels', said.adds, [{ name: 'Rousing Song (Su)', levels: [1] }, { name: 'Versatile Song (Ex)', levels: [2] }]);
  check('a package taken from no class in the packs says so', packageCheck(c, {
    className: 'Fighter', takes: normalizeBlock({ kind: 'package', name: 'Lost', class: 'Nobody', text: 'The Lost package includes the wander class feature.' }), blocks: BLOCKS,
  }).noClass, true);
  check('the swap records the absent ones in the package\'s spelling', (() => {
    swapPackage(c, { className: 'Fighter', gives: drill, takes: pkg('Stage Presence'), blocks: BLOCKS });
    return swapsOn(c.data.classes[0])[0].package.absent;
  })(), ['Bonus feats at 12th', 'Iron will']);
  check('grant levels read as ordinals', [swapLabel('bonus feat@1'), swapLabel('bonus feat@12'), swapLabel('bonus feat@22')],
    ['bonus feat (1st)', 'bonus feat (12th)', 'bonus feat (22nd)']);
}

console.log('\na grant past the Planner\'s levels');
{
  const c = new Character(blankDocument({ name: 'Ward', level: 4 }));
  for (let l = 1; l <= 4; l++) c.setProgressionClass(l, 0, 'Warden');
  applyBlock(c, { kind: 'class', name: 'Warden', hd: 10, bab: 1, features: [2, 8, 14].map((level) => ({ level, name: 'Guard' })) });
  c.set('campaign.archetypePackages', true);
  const guard = normalizeBlock({ kind: 'package', name: 'Watch', class: 'Warden', includes: ['guard@14'] });
  check('is found on the column\'s schedule', packageCheck(c, { className: 'Warden', gives: guard, blocks: BLOCKS }).removes, [{ name: 'Guard', levels: [14] }]);
  swapPackage(c, { className: 'Warden', gives: guard, takes: pkg('Exemplar'), blocks: BLOCKS });
  check('and taken off it, so the class does not get it back on reaching 14th', c.classFeatureRuleGroups('Warden', 'Guard')[0].rule, '2, 8, 14, -14');
}

console.log('\nwhat a swap changed, marked');
{
  runtime.bundled = [normalizeExtension({ id: 'zz-packages', name: 'Packages', blocks: [FIGHTER, MINSTREL, ...PACKAGES] })];
  const c = fighter();
  c.set('campaign.archetypePackages', true);
  let html = renderProgressionPanel(c, { draft: {} });
  check('the swap row lists what it would take and bring before the swap', [
    html.includes('<li><span class="archlost">Bravery</span> <span class="pkglv">2</span></li>'),
    html.includes('<span class="pkglv">1, 6</span>'),
  ], [true, true]);
  html = renderProgressionPanel(c, { draft: { 'pkgTake:0': 'minstrel|stage presence' } });
  check('and the taken package\'s features once one is picked', html.includes('<li><span class="archgain">Rousing Song (Su)</span> <span class="pkglv">1</span></li>'), true);
  check('and the powers it grants', renderProgressionPanel(c, { draft: { 'pkgTake:0': 'minstrel|songweaver' } }).includes('Also grants spellcasting.'), true);

  swapPackage(c, { className: 'Fighter', gives: pkg('Blade Drill'), takes: pkg('Stage Presence'), blocks: runtime.blocks() });
  const marks = archetypeMarks(c, 'Fighter');
  check('the marks: what each row lost', marks.cells.get(2).lost.map((l) => [l.name, l.column, l.by.name]), [['Bravery', null, 'Stage Presence']]);
  check('a grant taken off a repeat column, in that column', marks.cells.get(6).lost.map((l) => [l.name, l.column]), [['Bonus feat', 'Bonus feat']]);
  check('what each row gained', marks.cells.get(1).gained.map((g) => g.name), ['Stage Presence package', 'Rousing Song (Su)']);
  check('the notes taken out and put in', [marks.lostNotes.map((n) => n.name), marks.gainedNotes.has('rousing song (su)')], [['Bravery'], true]);

  html = renderProgressionPanel(c, { draft: {} });
  check('the ladder highlights what the package brought', html.includes('<span class="archgain" title="From the Stage Presence package, in place of Blade Drill.">Rousing Song (Su)</span>'), true);
  check('and strikes what it took, in the row it was on', html.includes('<span class="archlost" title="Given up for the Stage Presence package.">Bravery</span>'), true);
  check('a grant taken off a column is locked and says why', /slot-off archoff[^>]*title="No Bonus feat at this level\. Given up for the Stage Presence package\."/.test(html), true);
  check('the notes it brought carry its name', html.includes('<span class="badge archfrom" title="From the Stage Presence package, in place of Blade Drill.">Stage Presence</span>'), true);
  check('the notes it took are counted, folded', [html.includes('1 given up'), html.includes('cflost'), html.includes('A bonus on Will saves against fear.')], [true, true, false]);
  c.data.uiPrefs.collapsed = { ...(c.data.uiPrefs.collapsed || {}), 'cflost-Fighter': false };
  check('and read when opened', renderProgressionPanel(c, { draft: {} }).includes('A bonus on Will saves against fear.'), true);
  check('the swap row lists what it took and brought', [
    html.includes('<li><span class="archlost">Weapon training</span> <span class="pkglv">5</span></li>'),
    html.includes('<li><span class="archgain">Versatile Song (Ex)</span> <span class="pkglv">2</span></li>'),
    html.includes('<span class="archgain">Stage Presence package</span>'),
  ], [true, true, false]);

  c.setClassFeature('Fighter', 1, 'Special', 'Stage Presence package, Rousing Song (Su), Toughness');
  check('a name typed in later is plain', /archgain[^>]*>Toughness</.test(renderProgressionPanel(c, { draft: {} })), false);

  removeArchetype(c, 'Fighter', 'Stage Presence');
  html = renderProgressionPanel(c, { draft: {} });
  check('taking the swap off clears every mark', [html.includes('class="archgain"'), html.includes('class="archlost" title'), html.includes('cflost')], [false, false, false]);

  applyBlock(c, { kind: 'archetype', name: 'Shieldbearer', class: 'Fighter', features: [{ level: 2, name: 'Steady', text: 'This ability replaces bravery.' }] });
  html = renderProgressionPanel(c, { draft: {} });
  check('an ordinary archetype is marked the same way', [
    html.includes('<span class="archlost" title="Replaced by the Shieldbearer archetype.">Bravery</span>'),
    html.includes('<span class="archgain" title="From the Shieldbearer archetype.">Steady</span>'),
  ], [true, true]);
  runtime.bundled = [];
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
