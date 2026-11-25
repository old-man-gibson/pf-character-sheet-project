/** The note beside a veilweaving or practitioner ability pick that differs
 *  from the ability the class's own pages name. The pick is never changed.
 *
 *  Run: node tests/class-modifier-hint.test.mjs */
import { Character, abilityHint, classAbility, setClassAbilities } from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';
import { EXTENSION_FORMAT, classAbilitiesFromPacks, classAbilitiesFromText, normalizeExtension } from '../app/js/extensions.js';
import { abilityNote } from '../app/js/ui/ability-note.js';
import { renderMartialPanel } from '../app/js/ui/panels/combat.js';
import { akashicPanel } from '../app/js/ui/panels/subsystems.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const count = (html, text) => html.split(text).length - 1;

// An archetype page that swaps its class's ability for the casting ability.
const STARLIT = [
  'Starlit Veils: The starlit glasswright shapes veils from the star list.',
  'Starlit Power: The starlit glasswright uses their casting ability modifier in place of their Wisdom modifier for all of their glasswright class features.',
].join('\n');

// ------------------------------------------------------------ the reader

console.log('a page names its veilweaving ability in either of two ways');
{
  check('"uses their X as their veilweaving modifier"',
    classAbilitiesFromText('The shardweaver uses their Intelligence as their veilweaving modifier, and has a veilweaving level equal to their class level.'),
    { veilweaving: 'int' });
  check('the veil DC line only',
    classAbilitiesFromText('The DC for a saving throw against a veil\'s abilities is 10 + the number of points of essence invested in the veil + the glasswright\'s Wisdom modifier.'),
    { veilweaving: 'wis' });
  check('the DC line with a short name',
    classAbilitiesFromText('The DC for a saving throw against a lantern veil is 10 + the number of points of essence invested in the veil + your Cha modifier.'),
    { veilweaving: 'cha' });
  check('"use X to determine their veilweaving modifier"',
    classAbilitiesFromText('They gain the ability to shape veils, use their Intelligence to determine their veilweaving modifier, and their character level as their veilweaver level.'),
    { veilweaving: 'int' });
  check('both ways naming the same ability is one answer',
    classAbilitiesFromText('The gleamer uses their Charisma as their veilweaving modifier.\nThe DC for a saving throw against a veil is 10 + the essence invested in the veil + the gleamer\'s Charisma modifier.'),
    { veilweaving: 'cha' });
}

console.log('a choice, two abilities or another modifier is no single answer');
{
  check('a choice of three',
    classAbilitiesFromText('At 1st level, the prismist chooses whether they use their Intelligence, Wisdom, or Charisma as their veilweaving modifier.'),
    { veilweaving: 'choice' });
  check('two different abilities',
    classAbilitiesFromText('The gleamer uses their Charisma as their veilweaving modifier. The DC for a saving throw against a veil is 10 + the essence invested in the veil + the gleamer\'s Wisdom modifier.'),
    { veilweaving: 'choice' });
  check('set by something else on the sheet',
    classAbilitiesFromText('A dustwalker\'s key ability score for veilweaving is determined by their order.'),
    { veilweaving: 'choice' });
  check('another modifier in the DC line',
    classAbilitiesFromText('The DC for a saving throw against a veil\'s abilities is 10 + the number of points of essence invested in the veil + the regent\'s initiation modifier.'),
    { veilweaving: 'choice' });
  check('the higher of two',
    classAbilitiesFromText('Marshals are considered Adept combatants and use the higher of their Charisma or Intelligence as their practitioner modifier.'),
    { practitioner: 'choice' });
  check('the operative modifier',
    classAbilitiesFromText('A cutpurse uses their operative modifier as their practitioner modifier.'),
    { practitioner: 'choice' });
}

console.log('some veils only, or only "if", is not the class\'s answer');
{
  check('for some veils only',
    classAbilitiesFromText('Lumen Veils: The gleamer uses their Charisma as their veilweaving modifier for their lumen veils.'), {});
  check('when determining some effects only',
    classAbilitiesFromText('She uses her Wisdom modifier as her veilweaving modifier when determining the effects of the tide veils she shapes.'), {});
  check('a sentence starting "If"',
    classAbilitiesFromText('If the gleamer does not have a veilweaving level, they use their Wisdom as their veilweaving modifier.'), {});
  check('a page about neither', classAbilitiesFromText('Skill Ranks per Level: 4 + Int modifier.'), {});
}

console.log('the practitioner ability, the casting ability and a swap');
{
  check('"use X as their practitioner modifier"',
    classAbilitiesFromText('Mirrorknights are considered Expert practitioners and use Constitution as their practitioner modifier.'),
    { practitioner: 'con' });
  check('their casting ability',
    classAbilitiesFromText('Thornbinders use their casting ability modifier as their practitioner modifier.'),
    { practitioner: 'casting' });
  check('"as both their practitioner modifier and …"',
    classAbilitiesFromText('Unified Arts: The thornbinder uses their casting ability modifier as both their practitioner modifier and their operative modifier.'),
    { practitioner: 'casting' });
  check('a swap for all of the class features',
    classAbilitiesFromText(STARLIT),
    { swap: { from: 'wis', to: 'casting' } });
  check('a page that never mentions veils or practitioners is not read',
    classAbilitiesFromText('Starlit Power: The starlit glasswright uses their casting ability modifier in place of their Wisdom modifier for all of their glasswright class features.'),
    {});
  check('a swap to a named ability',
    classAbilitiesFromText('The dimglass uses their Charisma in place of their Wisdom when determining the effects of their glasswright class features and veils.'),
    { swap: { from: 'wis', to: 'cha' } });
}

// ------------------------------------------------------------ the packs

const SHARD = 'The shardweaver uses their Intelligence as their veilweaving modifier, and has a veilweaving level equal to their class level.';
const GLASS = 'Veilweaving: The DC for a saving throw against a veil\'s abilities is 10 + the number of points of essence invested in the veil + the glasswright\'s Wisdom modifier.';
const catalogue = (kind, entries) => ({ kind, entries });
const pack = (id, { catalogues = [], blocks = [] } = {}) => normalizeExtension({
  format: EXTENSION_FORMAT, formatVersion: 1, id, name: id, blocks, provides: { catalogues: { catalogues } },
});

console.log('catalogue entries and written blocks read the same');
{
  const read = classAbilitiesFromPacks([pack('a', {
    catalogues: [
      catalogue('class', [{ name: 'Shardweaver', fields: [], text: SHARD }, { name: 'Plainblade', fields: [], text: 'Skill Ranks per Level: 2 + Int modifier.' }]),
      catalogue('archetype', [
        { name: 'Gleamward (Lanternguard)', fields: [], text: 'Gleamwards are considered Expert practitioners and use Wisdom as their practitioner modifier.' },
        { name: 'Starlit Glasswright', fields: [['Class', 'Glasswright']], text: STARLIT },
      ]),
    ],
  }), pack('b', {
    blocks: [{ kind: 'class', name: 'Glasswright', features: [{ level: 1, name: 'Veilweaving', text: GLASS }] }],
  })]);
  check('one reading per class or archetype that names something', read.map((r) => [r.kind, r.name, r.class ?? null]), [
    ['class', 'Shardweaver', null],
    ['archetype', 'Gleamward', 'Lanternguard'],
    ['archetype', 'Starlit Glasswright', 'Glasswright'],
    ['class', 'Glasswright', null],
  ]);
  check('what each says', read.map((r) => r.veilweaving || r.practitioner || r.swap), ['int', 'wis', { from: 'wis', to: 'casting' }, 'wis']);
}

console.log('a written block stands over a catalogue entry, and a later pack over an earlier one');
{
  const entry = (id, text) => pack(id, { catalogues: [catalogue('class', [{ name: 'Mirrorknight', fields: [], text }])] });
  const block = (id, text) => pack(id, { blocks: [{ kind: 'class', name: 'Mirrorknight', features: [{ level: 1, name: 'Martial Training', text }] }] });
  const con = 'Mirrorknights use Constitution as their practitioner modifier.';
  const wis = 'Mirrorknights use Wisdom as their practitioner modifier.';
  const said = (packs) => classAbilitiesFromPacks(packs).map((r) => r.practitioner);
  check('later catalogue pack', said([entry('a', con), entry('b', wis)]), ['wis']);
  check('written block after', said([entry('a', con), block('b', wis)]), ['wis']);
  check('written block before', said([block('a', wis), entry('b', con)]), ['wis']);
}

console.log('registering the packs registers what they say');
{
  const { registerPacks } = await import('../app/js/extension-runtime.js');
  const c = new Character(blankDocument({ name: 'Weaver', level: 5 }));
  registerPacks([pack('a', { catalogues: [catalogue('class', [{ name: 'Shardweaver', fields: [], text: SHARD }])] })]);
  check('by class name, case aside', classAbility(c, 'shardweaver', 'veilweaving'), { ability: 'int', source: 'Shardweaver', casting: false });
  registerPacks([]);
  check('and none with no packs', classAbility(c, 'Shardweaver', 'veilweaving'), null);
}

// ------------------------------------------------------------ the model

const READINGS = [
  { kind: 'class', name: 'Shardweaver', veilweaving: 'int' },
  { kind: 'class', name: 'Glasswright', veilweaving: 'wis' },
  { kind: 'class', name: 'Prismist', veilweaving: 'choice' },
  { kind: 'class', name: 'Mirrorknight', practitioner: 'con' },
  { kind: 'archetype', name: 'Gleamward', class: 'Lanternguard', practitioner: 'wis' },
  { kind: 'archetype', name: 'Starlit Glasswright', class: 'Glasswright', swap: { from: 'wis', to: 'casting' } },
  { kind: 'archetype', name: 'Dimglass', class: 'Glasswright', veilweaving: 'cha' },
];

/** A level-10 character with these classes (name -> archetypes) and Int 18, Wis 12. */
function character(classes, { int = 18, wis = 12 } = {}) {
  const c = new Character(blankDocument({ name: 'Weaver', level: 10 }));
  c.data.classes = Object.entries(classes).map(([name, archetypes]) => ({
    name, hd: 8, bab: 0.75, goodFort: false, goodRef: false, goodWill: true, skillRanks: 4, archetypes, levelsOverride: 10,
  }));
  c.set('statsBuild.int.pointBuy', int);
  c.set('statsBuild.wis.pointBuy', wis);
  return c;
}
const veilRow = (c, name, mod) => c.listAdd('akashic.classes', { name, mod, levelOverride: null, essenceCap: 0, bonusCap: 0, added: true });
const combatRow = (c, name, mod1) => c.listAdd('training.combat.classes', {
  name, type: 'Expert', talentsPerLevel: 'Expert', mod1, mod2: null, classLevelsOverride: 10, levels: [],
});
const plain = (html) => html.replace(/<[^>]+>/g, '');

console.log('a pick that differs from the class gets a note, and keeps its pick');
{
  setClassAbilities(READINGS);
  const c = character({ Glasswright: '' });
  veilRow(c, 'Glasswright', 'Int');
  check('the class and the ability it names', abilityHint(c, 'veilweaving', 0), { ability: 'wis', source: 'Glasswright', casting: false });
  check('one plain sentence', plain(abilityNote(c, 'veilweaving', 0)), 'Glasswright uses Wisdom as the veilweaving modifier.');
  const row = c.data.akashic.classes[0];
  check('the pick and its modifier stand', [row.mod, row.modValue, c.data.akashic.veilweaving.mod], ['Int', 4, 4]);
  c.setItem('akashic.classes', 0, 'mod', 'Wis');
  check('the named ability has no note', abilityHint(c, 'veilweaving', 0), null);
  c.setItem('akashic.classes', 0, 'mod', null);
  check('nothing picked has no note', abilityHint(c, 'veilweaving', 0), null);
}

console.log('a class that offers a choice or names nothing gets no note');
{
  setClassAbilities(READINGS);
  const c = character({ Prismist: '', Duskrunner: '' });
  veilRow(c, 'Prismist', 'Str');
  veilRow(c, 'Duskrunner', 'Str');
  check('a choice', abilityHint(c, 'veilweaving', 0), null);
  check('a class no pack names', abilityHint(c, 'veilweaving', 1), null);
  setClassAbilities([]);
  veilRow(c, 'Glasswright', 'Int');
  check('no packs, no notes', abilityHint(c, 'veilweaving', 2), null);
}

console.log('the practitioner ability, from the class or an archetype on its Classes row');
{
  setClassAbilities(READINGS);
  const c = character({ Mirrorknight: '', Lanternguard: 'Gleamward' });
  combatRow(c, 'Mirrorknight', 'Int');
  combatRow(c, 'Lanternguard', 'Int');
  check('the class page', plain(abilityNote(c, 'practitioner', 0)), 'Mirrorknight uses Constitution as the practitioner modifier.');
  check('an archetype the class page does not have', plain(abilityNote(c, 'practitioner', 1)), 'Gleamward uses Wisdom as the practitioner modifier.');
  c.data.classes[1].archetypes = '';
  check('without the archetype, nothing', abilityHint(c, 'practitioner', 1), null);
}

console.log('an archetype that names or swaps the ability stands over the class');
{
  setClassAbilities(READINGS);
  const c = character({ Glasswright: 'Dimglass' });
  veilRow(c, 'Glasswright', 'Int');
  check('an archetype naming another ability', abilityHint(c, 'veilweaving', 0), { ability: 'cha', source: 'Dimglass', casting: false });
  c.data.classes[0].archetypes = 'Starlit Glasswright';
  check('a swap to the casting ability with no casting class', abilityHint(c, 'veilweaving', 0), null);
  c.listAdd('training.magic.classes', { name: 'Glasswright', type: 'Mid', mod1: 'Cha', mod2: null, classLevelsOverride: 10, levels: [] });
  check('the casting ability is the Magic tab\'s', plain(abilityNote(c, 'veilweaving', 0)),
    'Starlit Glasswright uses its casting ability, Charisma, as the veilweaving modifier.');
  c.setItem('training.magic.classes', 0, 'mod1', 'Int');
  check('and matches when it is the pick', abilityHint(c, 'veilweaving', 0), null);
}

console.log('with several veilweaving classes the highest of their abilities stands on every row');
{
  setClassAbilities(READINGS);
  const c = character({ Shardweaver: '', Glasswright: '' }, { int: 18, wis: 12 });
  veilRow(c, 'Shardweaver', 'Int');
  veilRow(c, 'Glasswright', 'Int');
  check('Int is higher: no note on either', [abilityHint(c, 'veilweaving', 0), abilityHint(c, 'veilweaving', 1)], [null, null]);
  c.set('statsBuild.int.pointBuy', 12);
  c.set('statsBuild.wis.pointBuy', 18);
  check('Wis is higher: the Glasswright row\'s Int gets the note', abilityHint(c, 'veilweaving', 1)?.ability, 'wis');
  c.setItem('akashic.classes', 0, 'mod', 'Wis');
  c.setItem('akashic.classes', 1, 'mod', 'Wis');
  check('and Wis on both rows has none', [abilityHint(c, 'veilweaving', 0), abilityHint(c, 'veilweaving', 1)], [null, null]);
  c.setItem('akashic.classes', 1, 'mod', 'Cha');
  check('an ability neither class names gets the note however high', abilityHint(c, 'veilweaving', 1)?.ability, 'wis');
}

console.log('one class whose pick is higher than its own ability still gets the note');
{
  setClassAbilities(READINGS);
  const c = character({ Glasswright: '', Mirrorknight: '' }, { int: 18, wis: 12 });
  veilRow(c, 'Glasswright', 'Int');
  combatRow(c, 'Mirrorknight', 'Int');
  check('veilweaving', abilityHint(c, 'veilweaving', 0)?.ability, 'wis');
  check('practitioner', abilityHint(c, 'practitioner', 0)?.ability, 'con');
}

console.log('the note is drawn on the Akashic and Martial tabs');
{
  setClassAbilities(READINGS);
  const c = character({ Glasswright: '', Mirrorknight: '', Lanternguard: 'Gleamward' });
  veilRow(c, 'Glasswright', 'Int');
  combatRow(c, 'Mirrorknight', 'Int');
  const akashic = akashicPanel(c, {});
  check('the Akashic class table', count(akashic, 'Glasswright uses Wisdom as the veilweaving modifier.'), 1);
  const martial = renderMartialPanel(c);
  check('the Martial class block', count(martial, 'Mirrorknight uses Constitution as the practitioner modifier.'), 1);
  combatRow(c, 'Lanternguard', 'Int');
  c.listAdd('training.magic.classes', { name: 'Lanternguard', type: 'Mid', mod1: 'Int', mod2: null, classLevelsOverride: 10, levels: [] });
  c.setBlended('combat', 1, true);
  check('a blended class, once', count(renderMartialPanel(c), 'Gleamward uses Wisdom as the practitioner modifier.'), 1);
  c.setItem('training.combat.classes', 0, 'mod1', 'Con');
  check('gone once the pick agrees', count(renderMartialPanel(c), 'Mirrorknight uses'), 0);
}

console.log('a name with markup is escaped');
{
  setClassAbilities([{ kind: 'class', name: 'Glass & <Thorn>', veilweaving: 'wis' }]);
  const c = character({ 'Glass & <Thorn>': '' });
  veilRow(c, 'Glass & <Thorn>', 'Int');
  check('escaped', abilityNote(c, 'veilweaving', 0).includes('Glass &amp; &lt;Thorn&gt; uses Wisdom'), true);
}

console.log('nothing is saved');
{
  setClassAbilities(READINGS);
  const c = character({ Glasswright: '', Mirrorknight: '' });
  veilRow(c, 'Glasswright', 'Int');
  combatRow(c, 'Mirrorknight', 'Int');
  const withNotes = JSON.stringify(c.toJSON());
  setClassAbilities([]);
  check('the saved document is the same with and without the packs', JSON.stringify(c.recompute().toJSON()), withNotes);
}
setClassAbilities([]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
