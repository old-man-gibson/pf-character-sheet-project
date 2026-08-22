/** Tests the extension packs: the format, the local store, merging tables,
 *  and attaching blocks to a character. Needs no fixtures.
 *  Run: node tests/extensions.test.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_FORMAT, inspectExtension, normalizeExtension, normalizeBlock, blankExtension, slugId, babFromText,
  extensionStore, mergeTables, registerTables, activeExtensions, activeBlocks, applyBlock,
  blocksFromCharacter, describeSummary, looksLikeExtension, loadBundledExtensions, parseReplaces,
  swapKey, parseSwaps, parseStacksWith, archetypeStatus, removeArchetype,
  ruleForLevels, repeatColumns, optionCataloguesFrom, parseOptionReplaces, applyArchetype, swapsMeet,
} from '../app/js/extensions.js';
import {
  parseClassFeatures, parseGroupFeatures, parseNamedLines, parseMenuOptions, menuOptionLines,
} from '../app/js/extension-manager.js';
import {
  Character, setManeuverCatalogue, disciplineEntries, setOptionCatalogues, optionCatalogues, resolveOptionMenu, optionCatalogueFor,
  setSphereCatalogue, sphereEntry, sphereNames, sphereTalent, talentsTagged,
} from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`); } };

/** A Storage the tests own. */
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
};

console.log('format -- ids, vetting, normalising');
check('slug from a name', slugId('Path of War: Expanded!'), 'path-of-war-expanded');
check('slug strips accents', slugId('Dōkei Saburō'), 'dokei-saburo');
check('slug of nothing', slugId('///'), '');
check('bab words', [babFromText('Full'), babFromText('3/4'), babFromText('half'), babFromText('')], [1, 0.75, 0.5, 0.75]);
check('not an object', inspectExtension('nope').ok, false);
check('wrong format', inspectExtension({ format: 'character-sheet' }).ok, false);
check('newer format version refused', inspectExtension({ format: EXTENSION_FORMAT, formatVersion: 99, name: 'x' }).ok, false);
check('no name, no id', inspectExtension({ format: EXTENSION_FORMAT }).ok, false);
{
  const v = inspectExtension({ format: EXTENSION_FORMAT, name: 'My Pack', blocks: [{ kind: 'class', name: 'A' }, { kind: 'dragon', name: 'B' }] });
  check('a good pack is ok', v.ok, true);
  check('id derived from the name', v.summary.id, 'my-pack');
  check('unknown block kinds counted as dropped', v.warnings, ['1 block(s) of an unknown kind were dropped']);
  check('block counts by kind', v.summary.blocks, { class: 1 });
}
check('looksLikeExtension', [looksLikeExtension({ format: EXTENSION_FORMAT }), looksLikeExtension({ schemaVersion: 9 }), looksLikeExtension(null)], [true, false, false]);
{
  const e = normalizeExtension({ id: 'X Y', name: ' Named ', revision: '3.7', provides: { maneuvers: { disciplines: [] }, later: { a: 1 } }, unknown: 1 });
  check('id slugged', e.id, 'x-y');
  check('name trimmed', e.name, 'Named');
  check('revision floored, at least 1', e.revision, 3);
  check('unknown provides kept', Object.keys(e.provides), ['maneuvers', 'later']);
  check('unknown top-level dropped', 'unknown' in e, false);
}
{
  const b = normalizeBlock({ kind: 'Class', name: 'Barbarian', hd: '12', bab: 'full', goodFort: 'true', skillRanks: 4, classSkills: ['Climb', ''], features: [{ level: 25, name: 'Late' }, { level: 0, name: 'Early' }, { name: '' }] });
  check('class block normalised', [b.kind, b.hd, b.bab, b.goodFort, b.goodRef, b.classSkills], ['class', 12, 1, true, false, ['Climb']]);
  check('feature levels clamped, blanks dropped', b.features.map((f) => [f.level, f.name]), [[20, 'Late'], [1, 'Early']]);
  const r = normalizeBlock({ kind: 'race', name: 'Dwarf', abilityMods: { con: 2, wis: '2', cha: -2, str: 0 }, traits: [{ name: 'Hardy', text: 't' }] });
  check('race mods keep only non-zero', r.abilityMods, { con: 2, wis: 2, cha: -2 });
  check('race speed null when absent', r.speed, null);
  const t = normalizeBlock({ kind: 'tracker', name: 'Rage', max: '4 + con.mod', minFormula: '' });
  check('tracker takes max as maxFormula, empty min is null', [t.maxFormula, t.minFormula], ['4 + con.mod', null]);
  const n = normalizeBlock({ kind: 'note', title: 'T', body: 'B' });
  check('note accepts title/body', [n.name, n.text], ['T', 'B']);
  const f = normalizeBlock({ kind: 'feature', name: 'Rage', type: '(ex)', group: 'Barbarian' });
  check('feature type normalised', f.type, 'Ex');
  check('unknown kind is null', normalizeBlock({ kind: 'spell' }), null);
}
{
  // A class whose talents arrive on several tracks at once. The pack states
  // the two counting rules and nothing else; the sheet does the rest.
  const t = normalizeBlock({
    kind: 'class',
    name: 'Armiger',
    hd: 10,
    bab: 1,
    goodFort: true,
    goodRef: true,
    skillRanks: 4,
    tracks: { name: 'Customized weapon', unit: 'weapon', sets: { start: 3, gainsAt: '11, 19' }, talents: { start: 1, gainsAt: '3, +4' } },
  });
  check('a class block carries its talent tracks',
    [t.tracks.name, t.tracks.unit, t.tracks.sets, t.tracks.talents],
    ['Customized weapon', 'weapon', { start: 3, gainsAt: '11, 19' }, { start: 1, gainsAt: '3, +4' }]);
  const shorthand = normalizeBlock({ kind: 'class', name: 'X', tracks: { sets: 2, talents: '4, +4' } });
  check('a bare number is a count that never moves; a bare string is where it goes up from one',
    [shorthand.tracks.sets, shorthand.tracks.talents],
    [{ start: 2, gainsAt: '' }, { start: 1, gainsAt: '4, +4' }]);
  check('a class that grants none has none',
    normalizeBlock({ kind: 'class', name: 'Y' }).tracks, null);

  const c = new Character(blankDocument({ name: 'Bryva', level: 11 }));
  for (let l = 1; l <= 11; l++) c.setProgressionClass(l, 0, 'Armiger');
  const said = applyBlock(c, t);
  check('attaching says where the weapons landed', /customized weapons/.test(said), true);
  const cust = c.data.training.combat.customizations[0];
  check('and the character carries the spec, not a pointer at the pack',
    [cust.className, cust.spec.sets.gainsAt, cust.setCount, cust.talentCount],
    ['Armiger', '11, 19', 4, 4]);
}

{
  // An archetype that changes what its class's talent track may learn, and
  // nothing else about it. The armiger's customized weapons teach martial
  // spheres; the archetype that lets them teach magical ones is where that
  // fact belongs, so it is one line of its block rather than a rule in the
  // engine.
  const CLASS = {
    kind: 'class', name: 'Armiger', hd: 10, bab: 1, goodFort: true, goodRef: true, skillRanks: 4,
    tracks: {
      name: 'Customized weapon',
      unit: 'weapon',
      sets: { start: 3, gainsAt: '11, 19' },
      talents: { start: 1, gainsAt: '3, +4' },
      spheres: 'combat',
    },
  };
  const ARCHETYPE = {
    kind: 'archetype', name: 'Antiquarian', class: 'Armiger', tracks: { spheres: 'Both' },
    features: [{ level: 1, name: 'Relic lore', text: 'This replaces quick change.' }],
  };
  check('a class block carries the sphere side of its track',
    normalizeBlock(CLASS).tracks.spheres, 'combat');
  check('an archetype block carries only what it changes, cased as the sheet reads it',
    normalizeBlock(ARCHETYPE).tracks, { spheres: 'both' });
  check('and one that changes nothing about the track carries none',
    normalizeBlock({ kind: 'archetype', name: 'Plain', class: 'Armiger' }).tracks, null);

  const c = new Character(blankDocument({ name: 'Vessa', level: 12 }));
  for (let l = 1; l <= 12; l++) c.setProgressionClass(l, 0, 'Armiger');
  applyBlock(c, CLASS);
  const track = () => c.data.training.combat.customizations[0];
  check('the class lands its track, martial', [track().spec.spheres, track().setCount, track().talentCount],
    ['combat', 4, 4]);

  const said = applyBlock(c, ARCHETYPE);
  check('adding the archetype says it touched the weapons', /customized weapons/.test(said), true);
  check('and widens the track without touching the counting rules',
    [track().spec.spheres, track().setCount, track().talentCount], ['both', 4, 4]);

  removeArchetype(c, 'Armiger', 'Antiquarian');
  check('taking it off puts the track back the way the class states it',
    [track().spec.spheres, track().setCount, track().talentCount], ['combat', 4, 4]);

  // An archetype whose class has no track on the sheet says so rather than
  // inventing counting rules it does not have.
  const bare = new Character(blankDocument({ name: 'Noone', level: 5 }));
  for (let l = 1; l <= 5; l++) bare.setProgressionClass(l, 0, 'Armiger');
  applyBlock(bare, { kind: 'class', name: 'Armiger', hd: 10, bab: 1, skillRanks: 4 });
  const alone = applyBlock(bare, ARCHETYPE);
  check('it reports the track it cannot find', /talent track, which is not on this sheet/.test(alone), true);
  check('and makes none up', (bare.data.training?.combat?.customizations || []).length, 0);
}

check('parseReplaces: one', parseReplaces('Text. This racial trait replaces hatred.'), ['hatred']);
check('parseReplaces: and', parseReplaces('This replaces defensive training and hatred.'), ['defensive training', 'hatred']);
check('parseReplaces: oxford list', parseReplaces('This racial trait replaces greed, hatred, stonecunning, and weapon familiarity.'), ['greed', 'hatred', 'stonecunning', 'weapon familiarity']);
check('parseReplaces: in place of', parseReplaces('Dwarves can take this trait in place of stonecunning. Source PZO9466'), ['stonecunning']);
check('parseReplaces: the … racial trait', parseReplaces('This racial trait replaces the hatred racial trait.'), ['hatred']);
check('parseReplaces: typo "replaced"', parseReplaces('This racial trait replaced stonecunning.'), ['stonecunning']);
check('parseReplaces: nothing', parseReplaces('Dwarves gain a +2 bonus.'), []);
check('trait block reads replaces off its text', normalizeBlock({ kind: 'trait', name: 'X', text: 'This replaces hatred and greed.' }).replaces, ['hatred', 'greed']);
check('describeSummary', describeSummary({ tables: { maneuvers: 30, vancian: 1 }, blocks: { class: 2, race: 1 } }), '30 disciplines · 1 casting table · 2 classes · 1 race');
check('describeSummary empty', describeSummary({ tables: {}, blocks: {} }), 'empty');

console.log('store -- save, list, read, enable, remove; bundled toggles remembered');
{
  const storage = fakeStorage();
  const store = extensionStore(storage);
  check('empty to start', store.list(), []);
  const row = store.save({ format: EXTENSION_FORMAT, name: 'Pack A', blocks: [{ kind: 'note', name: 'n' }] });
  check('saved row', [row.id, row.name, row.enabled, row.replaced, row.local], ['pack-a', 'Pack A', true, false, true]);
  check('listed', store.list().map((e) => e.id), ['pack-a']);
  check('read back normalised', store.read('pack-a').blocks.length, 1);
  check('missing reads null', store.read('nope'), null);
  const again = store.save({ format: EXTENSION_FORMAT, id: 'pack-a', name: 'Pack A2', revision: 2 });
  check('same id replaces', [again.replaced, again.revision, store.list().length, store.list()[0].name], [true, 2, 1, 'Pack A2']);
  store.setEnabled('pack-a', false);
  check('disabled', store.list()[0].enabled, false);
  store.setEnabled('bundled-x', false, { bundled: true });
  check('bundled disable remembered', [...store.disabledBundled()], ['bundled-x']);
  store.setEnabled('bundled-x', true, { bundled: true });
  check('bundled re-enabled', [...store.disabledBundled()], []);
  store.remove('pack-a');
  check('removed from index and storage', [store.list(), storage.keys().filter((k) => k.includes(':ext:'))], [[], []]);
  let threw = false;
  try { store.save({ format: EXTENSION_FORMAT, name: '' }); } catch { threw = true; }
  check('a nameless pack is refused', threw, true);
}

console.log('active set -- bundled first, disabled dropped, local packs after');
{
  const storage = fakeStorage();
  const store = extensionStore(storage);
  const bundled = [normalizeExtension({ id: 'b1', name: 'B1', blocks: [{ kind: 'note', name: 'from b1' }] }), normalizeExtension({ id: 'b2', name: 'B2' })];
  store.save({ format: EXTENSION_FORMAT, id: 'l1', name: 'L1', blocks: [{ kind: 'note', name: 'from l1' }] });
  store.save({ format: EXTENSION_FORMAT, id: 'l2', name: 'L2' }, { enabled: false });
  store.setEnabled('b2', false, { bundled: true });
  const active = activeExtensions(bundled, store);
  check('order and filtering', active.map((e) => [e.id, e.bundled]), [['b1', true], ['l1', false]]);
  check('blocks tagged with their pack', activeBlocks(active).map((b) => [b.extId, b.extName, b.index, b.name]), [['b1', 'B1', 0, 'from b1'], ['l1', 'L1', 0, 'from l1']]);
  check('no store: bundled only', activeExtensions(bundled, null).length, 2);
}

console.log('merge -- later packs win by name, tables concatenate');
{
  const a = normalizeExtension({ id: 'a', name: 'a', provides: {
    maneuvers: { disciplines: [{ name: 'Broken Blade', entries: [{ level: 1, kind: 'maneuver', name: 'X', type: 'Strike' }] }, { name: 'Iron Tortoise', entries: [] }] },
    vancian: { spellLevels: ['0', '1st'], classes: [{ name: 'Cleric', perDay: [[1]] }] },
    psionics: { curves: [{ total: 52, points: [0] }], classes: [{ name: 'Psion', total: 52 }] },
    cardcasting: { manipulations: [{ name: 'Deck Ripper', group: 'Cooldown' }] },
    cooking: { durationHours: 'level', entrees: [{ name: 'Rice', effect: 'a' }] },
  } });
  const b = normalizeExtension({ id: 'b', name: 'b', provides: {
    maneuvers: { disciplines: [{ name: 'broken blade', entries: [{ level: 2, kind: 'stance', name: 'Y', type: 'Stance' }] }, { name: 'Solar Wind', entries: [] }] },
    vancian: { classes: [{ name: 'Wizard', perDay: [[2]] }] },
    psionics: { curves: [{ total: 52, points: [1] }] },
    cooking: { entrees: [{ name: 'rice', effect: 'b' }] },
  } });
  const m = mergeTables([a, b]);
  // A discipline is the one table that adds up rather than replacing: two
  // packs naming it join maneuver by maneuver, and the later pack's header
  // still wins (its casing is the one kept).
  check('same discipline joined by name, case-insensitively', m.maneuvers.disciplines.map((d) => [d.name, d.entries.length]), [['broken blade', 2], ['Iron Tortoise', 0], ['Solar Wind', 0]]);
  check('both packs\' maneuvers are there', m.maneuvers.disciplines[0].entries.map((e) => e.name), ['X', 'Y']);
  check('vancian classes concatenate, spellLevels kept', [m.vancian.classes.map((c) => c.name), m.vancian.spellLevels], [['Cleric', 'Wizard'], ['0', '1st']]);
  check('psionic curve replaced by total', m.psionics.curves, [{ total: 52, points: [1] }]);
  check('cardcasting from the one pack', m.cardcasting.manipulations.length, 1);
  check('cooking entree replaced, duration kept', [m.cooking.entrees, m.cooking.durationHours], [[{ name: 'rice', effect: 'b' }], 'level']);
  check('empty merge has no optional keys', Object.keys(mergeTables([]).vancian), ['classes']);
  const calls = [];
  registerTables(m, { setManeuverCatalogue: (d) => calls.push(['m', d.disciplines.length]), setCookingTables: (d) => calls.push(['c', d.entrees.length]) });
  check('registrars called with the merged docs, missing ones skipped', calls, [['m', 3], ['c', 1]]);

  /*
   * The case the joining rule exists for. A player pastes one maneuver off a
   * wiki page; it is filed under Golden Lion, which the bundled catalogue
   * already carries thirty-odd of. Under a replace-by-name rule the other
   * thirty would vanish the moment the pack was switched on.
   */
  const pow = normalizeExtension({
    id: 'pow',
    name: 'Path of War',
    provides: {
      maneuvers: {
        disciplines: [{
          name: 'Golden Lion',
          entries: [
            { level: 1, kind: 'maneuver', name: 'Demoralizing Roar', type: 'Boost' },
            { level: 1, kind: 'maneuver', name: 'Encouraging Roar', type: 'Boost' },
            { level: 1, kind: 'maneuver', name: 'Lion\'s Pounce', type: 'Strike' },
          ],
        }],
      },
    },
  });
  const pasted = normalizeExtension({
    id: 'mine',
    name: 'Mine',
    provides: {
      maneuvers: {
        disciplines: [{
          name: 'Golden Lion',
          entries: [{
            level: 1, kind: 'maneuver', name: 'Encouraging Roar', type: 'Boost',
            action: 'Swift', text: 'Roars.',
          }],
        }],
      },
    },
  });
  const both = mergeTables([pow, pasted]).maneuvers.disciplines[0];
  check('one pasted maneuver does not delete the discipline around it',
    both.entries.map((e) => e.name), ['Demoralizing Roar', 'Encouraging Roar', 'Lion\'s Pounce']);
  check('and the one it names is the corrected copy',
    both.entries[1].text, 'Roars.');
  check('the ones it did not name are untouched',
    both.entries[0].text, undefined);
}

console.log('bundled -- the shipped packs load through the index and merge cleanly');
{
  // `fileURLToPath` rather than trimming the scheme off by hand: a Windows file
  // URL is file:///C:/... and a POSIX one file:///home/..., so the same strip
  // that leaves the first absolute leaves the second relative, and the packs go
  // missing on every machine but the one this was written on.
  const fetcher = async (url) => {
    try {
      const body = readFileSync(fileURLToPath(url), 'utf8');
      return { ok: true, json: async () => JSON.parse(body) };
    } catch { return { ok: false }; }
  };
  const base = new URL('../', import.meta.url);
  const packs = await loadBundledExtensions(base, { fetcher });
  ok('five bundled packs', packs.length === 5);
  check('ids follow the index', packs.map((p) => p.id), ['path-of-war-disciplines', 'vancian-casting-tables', 'psionic-manifesting-tables', 'deck-manipulations', 'iron-chef-ingredients']);
  const m = mergeTables(packs);
  check('30 disciplines, 34 casting tables, 5 curves, 33 manipulations', [m.maneuvers.disciplines.length, m.vancian.classes.length, m.psionics.curves.length, m.cardcasting.manipulations.length], [30, 34, 5, 33]);
  setManeuverCatalogue(m.maneuvers);
  ok('the catalogue answers by discipline name', disciplineEntries('Broken Blade').length > 0);
  // The bundled catalogue is names and types only: the rules text of 1,033
  // publisher maneuvers is not ours to ship, and this is the check that says
  // so if somebody ever pastes it in.
  const bundled = disciplineEntries('Broken Blade');
  ok('every bundled entry has a type', bundled.every((e) => e.type !== ''));
  check('and no bundled entry carries rules text',
    bundled.filter((e) => ['action', 'range', 'target', 'duration', 'save', 'dc', 'text']
      .some((k) => (e[k] || '') !== '')).length, 0);
  const none = await loadBundledExtensions(new URL('nowhere/', base), { fetcher });
  check('a missing index is no packs', none, []);
}

console.log('spheres -- a whole sphere as a shared table, tags and all');
{
  const sphere = {
    name: 'Boxing',
    kind: 'combat',
    description: 'Boxers specialize in fighting with their fists.',
    abilities: [{ name: 'Counter Punch', text: 'You may ready an action.' }],
    talents: [
      { name: 'Clinch', group: 'Counter Talents', tags: ['counter'], sources: [], prerequisites: '', text: 'Grapple.' },
      { name: 'Elongated Step', group: 'Boxing Talents', tags: ['stance'], sources: ['3PP'], prerequisites: '', text: 'Reach.' },
    ],
  };
  const pack = normalizeExtension({ id: 'som', name: 'SoM', provides: { spheres: { spheres: [sphere] } } });
  const merged = mergeTables([pack]);
  check('the sphere survives the merge', merged.spheres.spheres.map((s) => s.name), ['Boxing']);
  check('a pack of spheres counts as spheres',
    describeSummary({ tables: { spheres: 2 }, blocks: {} }), '2 spheres');

  const calls = [];
  registerTables(merged, { setSphereCatalogue: (d) => calls.push(d.spheres.length) });
  check('and reaches its registrar', calls, [1]);

  setSphereCatalogue(merged.spheres);
  check('read back by name, however it was capitalised',
    sphereEntry('boxing').talents.length, 2);
  check('unknown sphere is null', sphereEntry('Nowhere'), null);
  // The tags are what a table filters on -- both kinds are searched, since
  // which of the two a wiki wrote a label in is its business, not ours.
  check('found by a rules tag', talentsTagged('counter').map((t) => t.name), ['Clinch']);
  check('and by a source tag', talentsTagged('3PP').map((t) => t.name), ['Elongated Step']);
  check('case does not count', talentsTagged('3pp').length, 1);
  check('a talent knows its sphere', talentsTagged('counter')[0].sphere, 'Boxing');

  /*
   * A sphere replaces a sphere of the same name outright -- unlike a
   * discipline, which joins. One page is the whole sphere, so a later pack
   * carrying it means a corrected copy of all of it, not an addition to it.
   */
  const fixed = normalizeExtension({
    id: 'fix',
    name: 'Fix',
    provides: { spheres: { spheres: [{ ...sphere, talents: [sphere.talents[0]] }] } },
  });
  check('a later pack replaces the sphere whole',
    mergeTables([pack, fixed]).spheres.spheres[0].talents.map((t) => t.name), ['Clinch']);

  /*
   * Matching a talent somebody typed on their sheet against the catalogue.
   * The sheet has always taken a talent as free text and still does -- this
   * is a second opinion, so a miss is silence rather than an error.
   */
  setSphereCatalogue(merged.spheres);
  check('an exact name matches', sphereTalent('Boxing', 'Clinch').group, 'Counter Talents');
  check('case and spacing do not count', !!sphereTalent('boxing', '  clinch '), true);
  // A player writes what their book calls it, tags and all.
  check('a tag the player typed is ignored', !!sphereTalent('Boxing', 'Clinch (counter)'), true);
  check('a talent the sphere lacks is a miss', sphereTalent('Boxing', 'Nonesuch'), null);
  check('a sphere no pack carries is a miss', sphereTalent('Alteration', 'Clinch'), null);
  check('and nothing typed is a miss', sphereTalent('Boxing', '   '), null);
  // With no sphere named the whole catalogue is searched, so the sheet can
  // tell the player which sphere it came from rather than being told.
  check('an unnamed sphere is found when only one has it',
    sphereTalent('', 'Elongated Step').sphere, 'Boxing');

  /*
   * The sphere pickers offer what the packs carry as well as what rules.js
   * knows, so a homebrew sphere turns up where a player looks for it.
   */
  check('a pack sphere joins the picker',
    sphereNames(['Alteration', 'Death'], 'magic'), ['Alteration', 'Death']);
  check('one of the other side stays out',
    sphereNames(['Alteration'], 'magic'), ['Alteration']);
  check('and joins its own side, after the built-in names',
    sphereNames(['Alchemy', 'Athletics'], 'combat'), ['Alchemy', 'Athletics', 'Boxing']);
  check('a name the engine already knows is not doubled',
    sphereNames(['Alchemy', 'Boxing'], 'combat'), ['Alchemy', 'Boxing']);

  /*
   * Typing a talent fills in what the catalogue can answer for free -- the
   * sphere it belongs to, and its rules text as the row's note. Only ever
   * into cells that are empty: a note is where the table's own ruling goes,
   * and having that overwritten by a book would be worse than never filling.
   */
  const c = new Character(blankDocument({ name: 'Boxer', level: 4 }));
  const L = 'training.combat.bonusTalents';
  c.data.training.combat.bonusTalents = [
    { talent: '', sphere: null, source: '', notes: '' },
    { talent: '', sphere: null, source: '', notes: 'my own ruling' },
    { talent: '', sphere: 'Alchemy', source: '', notes: '' },
    { talent: '', sphere: null, source: '', notes: '' },
  ];
  const row = (i) => c.data.training.combat.bonusTalents[i];
  const cols = { sphere: 'sphere', notes: 'notes' };

  c.setTalentEntry(L, 0, 'Clinch', cols);
  check('an empty row takes the sphere and the text',
    [row(0).sphere, row(0).notes], ['Boxing', 'Grapple.']);
  c.setTalentEntry(L, 1, 'Clinch', cols);
  check('a note already written is left alone',
    [row(1).sphere, row(1).notes], ['Boxing', 'my own ruling']);
  // A sphere already chosen is the row's own answer, and it is also what the
  // match is made against -- so a talent that sphere does not have is a miss.
  c.setTalentEntry(L, 2, 'Clinch', cols);
  check('a sphere already chosen decides, and misses',
    [row(2).sphere, row(2).notes], ['Alchemy', '']);
  c.setTalentEntry(L, 3, 'Nothing Known', cols);
  check('no match fills nothing', [row(3).sphere, row(3).notes], [null, '']);

  // A table with no notes column must not grow one.
  c.data.training.combat.tradition = { entries: [{ talent: '', sphere: null }] };
  c.setTalentEntry('training.combat.tradition.entries', 0, 'Clinch', { sphere: 'sphere' });
  check('a row without notes keeps its shape',
    c.data.training.combat.tradition.entries[0], { talent: 'Clinch', sphere: 'Boxing' });

  // Emptying a filled cell and leaving the talent alone leaves it empty --
  // the fill happens on entry, not on every recompute.
  row(0).notes = '';
  c.recompute();
  check('a cleared note stays cleared', row(0).notes, '');
}

console.log('a pack may carry a maneuver\'s cells, and they survive the whole path');
{
  /*
   * A discipline written in the Extensions editor: names, and the cells the
   * sheet's maneuver card shows. Nothing between the file and the catalogue
   * may quietly drop them -- which is exactly what happened before, where
   * setManeuverCatalogue narrowed every entry to four keys.
   */
  const pack = normalizeExtension({
    id: 'homebrew', name: 'Homebrew',
    provides: {
      maneuvers: {
        disciplines: [{
          name: 'Iron Tortoise',
          entries: [{
            level: 1, kind: 'maneuver', name: 'Shield Slam', type: 'Strike',
            action: 'Standard', range: 'Melee attack', target: 'One creature',
            duration: 'Instantaneous', save: 'Fortitude', dc: '{= 10 + 1 + str.mod}',
            text: 'Slams for {= level}d6.',
          }],
        }],
      },
    },
  });
  const cells = ['type', 'action', 'range', 'target', 'duration', 'save', 'dc', 'text'];
  check('normalizeExtension keeps them',
    cells.every((k) => k in pack.provides.maneuvers.disciplines[0].entries[0]), true);
  const merged = mergeTables([pack]);
  check('mergeTables keeps them',
    cells.every((k) => k in merged.maneuvers.disciplines[0].entries[0]), true);
  registerTables(merged, { setManeuverCatalogue });
  const entry = disciplineEntries('Iron Tortoise')[0];
  check('and the catalogue registers them', cells.map((k) => entry[k]), [
    'Strike', 'Standard', 'Melee attack', 'One creature',
    'Instantaneous', 'Fortitude', '{= 10 + 1 + str.mod}', 'Slams for {= level}d6.',
  ]);
  // A cell the pack left out is a blank string, never undefined -- every
  // reader treats these as strings and one hole would show as "undefined".
  registerTables(mergeTables([normalizeExtension({
    id: 'bare', name: 'Bare',
    provides: { maneuvers: { disciplines: [{ name: 'Bare', entries: [{ name: 'Thing' }] }] } },
  })]), { setManeuverCatalogue });
  check('a cell the pack left out is blank, not missing',
    cells.map((k) => disciplineEntries('Bare')[0][k]), cells.map(() => ''));
}

console.log('apply -- blocks land on a blank character through the model');
{
  const c = new Character(blankDocument({ name: 'Grunyar', level: 5 }));
  const barb = {
    kind: 'class', name: 'Barbarian', hd: 12, bab: 1, goodFort: true, skillRanks: 4,
    classSkills: ['Acrobatics', 'Climb', 'Nonesuch'],
    features: [{ level: 1, name: 'Fast movement' }, { level: 1, name: 'Rage' }, { level: 3, name: 'Trap sense +1' }],
  };
  const note = applyBlock(c, barb);
  ok('says what it did', /Added class Barbarian/.test(note) && /2 class skill/.test(note));
  check('class row', c.data.classes.map((x) => [x.name, x.hd, x.bab, x.goodFort, x.goodRef, x.skillRanks]), [['Barbarian', 12, 1, true, false, 4]]);
  check('features on the progression, by class level', c.data.progression.classFeatures.Barbarian.byLevel, { 1: { Special: 'Fast movement, Rage' }, 3: { Special: 'Trap sense +1' } });
  check('class skills ticked where the sheet has them', c.data.skills.filter((s) => s.classSkill).map((s) => s.name), ['Acrobatics', 'Climb']);
  check('good Fort at level 5 from the one class', [c.data.saves.fortitude.base, c.data.saves.reflex.base], [4, 1]);
  applyBlock(c, { ...barb, hd: 10 });
  check('same class again updates rather than duplicating', c.data.classes.map((x) => [x.name, x.hd]), [['Barbarian', 10]]);
  applyBlock(c, { ...barb, systems: ['Path-of-War'] });
  check('system tags come along, lower-cased', c.data.classes[0].systems, ['path-of-war']);
  c.toggleClassSystem(0, 'spheres-of-might');
  applyBlock(c, { ...barb, systems: ['path-of-war'] });
  check('re-applying merges tags with what the player marked', [...c.data.classes[0].systems].sort(), ['path-of-war', 'spheres-of-might']);
  check('features without text add no template group', (c.data.templates || []).length, 0);
  applyBlock(c, { ...barb, features: [{ level: 1, name: 'Rage', text: 'r' }, { level: 3, name: 'Trap sense +1', text: 't' }, { level: 6, name: 'Trap sense +2', text: '' }, { level: 9, name: 'Trap sense +3', text: 't' }] });
  check('features with text go under the class once each, +N variants folded -- the Template tab is for templates',
    [c.classFeatureNotes('Barbarian').map((f) => f.name), c.data.templates.length], [['Rage', 'Trap sense +1'], 0]);
  c.data.templates.length = 0;

  const before = c.data.abilities.con.score;
  applyBlock(c, { kind: 'race', name: 'Dwarf', size: 'Medium', abilityMods: { con: 2, cha: -2 }, traits: [{ name: 'Darkvision', text: '60 ft.' }, { name: 'Hardy', text: '+2 vs poison' }] });
  check('race and size set', [c.data.identity.race, c.data.identity.size], ['Dwarf', 'Medium']);
  check('racial modifier reaches the score', c.data.abilities.con.score - before, 2);
  check('traits fill the blank slots first', c.data.raceTraits.map((t) => t.name), ['Darkvision', 'Hardy', '']);
  applyBlock(c, { kind: 'trait', name: 'Stability', text: '+4 CMD' });
  applyBlock(c, { kind: 'trait', name: 'Greed', text: '+2 Appraise' });
  check('then append', c.data.raceTraits.map((t) => t.name), ['Darkvision', 'Hardy', 'Stability', 'Greed']);

  applyBlock(c, { kind: 'tracker', name: 'Rage rounds', maxFormula: '4 + con.mod + (level - 1) * 2', refresh: 'per day', text: 'n' });
  const t = c.trackers.find((x) => x.name === 'Rage rounds');
  check('tracker evaluates its formula (Con 12 at level 5)', [t.max, t.refresh, t.note], [13, 'per day', 'n']);

  applyBlock(c, { kind: 'feature', name: 'Rage', type: 'Ex', text: 'r', group: 'Barbarian' });
  applyBlock(c, { kind: 'feature', name: 'Fast Movement', type: 'Ex', text: 'f', group: 'barbarian' });
  check('features share one group, matched case-insensitively', c.data.templates.map((tp) => [tp.name, tp.features.map((f) => f.name)]), [['Barbarian', ['Rage', 'Fast Movement']]]);
  applyBlock(c, { kind: 'template', name: 'Bloodburst Blade', features: [{ name: 'Essence', type: 'Su', text: 'e' }] });
  check('a template block is its own group', c.data.templates.map((tp) => tp.name), ['Barbarian', 'Bloodburst Blade']);
  applyBlock(c, { kind: 'note', name: 'House rule', text: 'body' });
  check('note', c.data.notes.at(-1), { title: 'House rule', body: 'body' });

  // alternate racial traits swap out what they replace, and remember it
  const c2 = new Character(blankDocument({ name: 'Rusilka', level: 3 }));
  c2.data.raceTraits = [];
  applyBlock(c2, { kind: 'race', name: 'Dwarf', traits: [{ name: 'Defensive Training', text: 'dt' }, { name: 'Hardy', text: 'h' }, { name: 'Hatred', text: 'ht' }, { name: 'Stonecunning', text: 'sc' }, { name: 'Greed', text: 'g' }] });
  const names = () => c2.data.raceTraits.map((t) => t.name);
  // X replaces A and B
  let msg = applyBlock(c2, { kind: 'trait', name: 'Sky Sentinel', text: 'ss. This racial trait replaces defensive training, hatred, and stonecunning.' });
  check('X replaces the three it names', names(), ['Hardy', 'Greed', 'Sky Sentinel']);
  ok('and says so', /Added Sky Sentinel, replacing Defensive Training and Hatred and Stonecunning\./.test(msg));
  check('X remembers what it took', c2.data.raceTraits.at(-1).replaced.map((r) => r.name), ['Defensive Training', 'Hatred', 'Stonecunning']);
  // N (an alternate to hatred) displaces X; the two X held that N does not replace come back
  msg = applyBlock(c2, { kind: 'trait', name: 'Ancient Enmity', text: 'ae. This racial trait replaces hatred.' });
  check('N displaces X, restores the rest, keeps only what it replaces', names(), ['Hardy', 'Greed', 'Defensive Training', 'Stonecunning', 'Ancient Enmity']);
  ok('message names the swap', /Added Ancient Enmity, replacing Hatred, displacing Sky Sentinel \(Defensive Training and Stonecunning restored\)\./.test(msg));
  check('N holds only hatred', c2.data.raceTraits.at(-1).replaced, [{ name: 'Hatred', text: 'ht' }]);
  // a trait naming something not on the sheet is added and says so
  msg = applyBlock(c2, { kind: 'trait', name: 'Stubborn', text: 's. This racial trait replaces hardy.', replaces: ['hardy', 'nonesuch'] });
  ok('explicit replaces list wins, missing name reported', /replacing Hardy, \(nonesuch not on the sheet\)/.test(msg) && !names().includes('Hardy'));
  check('twice is refused', applyBlock(c2, { kind: 'trait', name: 'Stubborn', text: 's' }), 'Stubborn is already on the sheet.');
  // and it survives a round trip through the model
  const back2 = new Character(JSON.parse(JSON.stringify(c2.toJSON())));
  check('replaced history round-trips', back2.data.raceTraits.find((t) => t.name === 'Ancient Enmity').replaced, [{ name: 'Hatred', text: 'ht' }]);
  check('rows without history stay plain', 'replaced' in back2.data.raceTraits.find((t) => t.name === 'Greed'), false);

  // archetypes: swap keys and the sentences that name what a feature does
  const LS = 'Legendary Samurai';
  check('swapKey', ['Iaijutsu Mastery', 'iaijutsu master', 'Kiai Arts', 'kiai art', 'sheathe block', 'Sheath Block', "the legendary samurai's weapon proficiencies", 'armor proficiencies', 'Trap Sense +1'].map((s) => swapKey(s, LS)),
    ['iaijutsu master', 'iaijutsu master', 'kiai art', 'kiai art', 'sheath block', 'sheath block', 'weapon and armor proficiency', 'weapon and armor proficiency', 'trap sense']);
  check('parseSwaps: replaces list', parseSwaps('x. This ability replaces challenge and kiai arts.', LS), { replaces: ['challenge', 'kiai art'], alters: [] });
  check('parseSwaps: alters', parseSwaps('x. This ability alters resolve.', LS), { replaces: [], alters: ['resolve'] });
  check('parseSwaps: modifies proficiencies', parseSwaps('x. This modifies proficiencies.', LS), { replaces: [], alters: ['weapon and armor proficiency'] });
  check('parseSwaps: "normal weapon and armor proficiencies" is one thing', parseSwaps("x. This alters a legendary samurai's normal weapon and armor proficiencies.", LS), { replaces: [], alters: ['weapon and armor proficiency'] });
  check('parseSwaps: a sub-ability replaced alters its parent', parseSwaps('x. This ability replaces the determined ability of the resolve class feature.', LS), { replaces: [], alters: ['resolve'] });
  check('parseSwaps: a named kiai art replaced alters kiai arts', parseSwaps("x. This ability replaces the duty's call, charm kiai art.", LS), { replaces: [], alters: ['kiai art'] });
  check('parseSwaps: oxford list', parseSwaps('x. This replaces challenge, iaijutsu techniques, and kiai arts.', LS), { replaces: ['challenge', 'iaijutsu technique', 'kiai art'], alters: [] });
  check('parseStacksWith', parseStacksWith("This alters iaijutsu strike. This alternative class feature can be combined with either the Yumi Sniper archetype or the Skirmisher's Strike alternative class feature (but not both), in which case both alterations apply."), ['Yumi Sniper', "Skirmisher's Strike"]);
  check('archetype block reads swaps and levels off its features', normalizeBlock({ kind: 'archetype', name: 'A', class: LS, features: [{ name: 'Gun Fusion', type: 'Ex', text: 'At 10th level, x. This ability replaces iaijutsu master.' }, { name: 'Bullet Control', text: 'y. This ability alters sheathe control.' }] }).features.map((f) => [f.name, f.level, f.replaces, f.alters]),
    [['Gun Fusion', 10, ['iaijutsu master'], []], ['Bullet Control', 1, [], ['sheath control']]]);

  // …and on a character: apply, stack, block, remove-restores
  const c3 = new Character(blankDocument({ name: 'Kaito', level: 10 }));
  applyBlock(c3, { kind: 'class', name: LS, hd: 10, bab: 1, goodFort: true, goodWill: true, skillRanks: 4,
    features: [{ level: 1, name: 'Challenge', text: 'ch' }, { level: 1, name: 'sheath control', text: 'sc' }, { level: 2, name: 'Resolve', text: 'r' }, { level: 4, name: 'Banner', text: 'b' }, { level: 9, name: 'Greater resolve', text: 'gr' }, { level: 10, name: 'iaijutsu master', text: 'im' }] });
  const gun = { kind: 'archetype', name: 'Gunblade Duelist', class: LS, features: [
    { name: 'Bullet Control', type: 'Ex', text: 'x. This ability alters sheathe control.' },
    { name: 'Perfect Craftsmanship', type: 'Ex', text: 'At 2nd level, y. This ability replaces resolve and greater resolve.' },
    { name: 'Gun Fusion', type: 'Ex', text: 'At 10th level, z. This ability replaces iaijutsu master.' }] };
  const oni = { kind: 'archetype', name: 'Oni Warrior', class: LS, features: [{ name: 'Rage', type: 'Ex', text: 'At 1st level, r. This ability replaces challenge and sheathe control.' }] };
  const yoj = { kind: 'archetype', name: 'Yojimbo', class: LS, features: [{ name: 'Bonded Challenge', text: 'b. This ability alters challenge.' }, { name: "Guardian's Toughness", type: 'Ex', text: 'At 4th level, g. This ability replaces banner.' }] };
  const other = { kind: 'archetype', name: 'Nobody', class: 'Wizard', features: [{ name: 'X', text: 'x. This ability replaces spells.' }] };
  const cell = (lvl) => c3.data.progression.classFeatures[LS].byLevel[lvl]?.Special || '';
  const tplNames = () => c3.classFeatureNotes(LS).map((f) => f.name);
  check('needs its class', archetypeStatus(c3, other), { ok: false, reason: 'no-class', className: 'Wizard' });
  ok('gunblade goes on', /Added Gunblade Duelist to Legendary Samurai, replacing Resolve, Greater resolve, iaijutsu master, altering sheath control\./.test(applyBlock(c3, gun)));
  check('replaced features leave their cells, new ones arrive at their levels', [cell(2), cell(9), cell(10)], ['Perfect Craftsmanship', '', 'Gun Fusion']);
  ok("the class's own feature text swapped too", !tplNames().includes('Resolve') && tplNames().includes('Gun Fusion') && tplNames().includes('Bullet Control'));
  check('the class row names it', [c3.data.classes[0].archetypes, c3.data.classes[0].archetypeStack.map((e) => e.name)], ['Gunblade Duelist', ['Gunblade Duelist']]);
  check('oni conflicts on sheath control', archetypeStatus(c3, oni), { ok: false, reason: 'conflict', with: 'Gunblade Duelist', shared: ['sheath control'] });
  ok('and is refused with a reason', /cannot be added: it and Gunblade Duelist both change sheath control\./.test(applyBlock(c3, oni)));
  ok('yojimbo touches nothing gunblade touches, so it stacks', /Added Yojimbo/.test(applyBlock(c3, yoj)) && c3.data.classes[0].archetypeStack.length === 2);
  check('banner replaced, challenge kept beside its alteration', [cell(4), cell(1)], ["Guardian's Toughness", 'Challenge, sheath control, Bullet Control, Bonded Challenge']);
  check('applied twice is refused', archetypeStatus(c3, yoj).reason, 'applied');
  ok('removing gunblade restores exactly its features', /Removed Gunblade Duelist from Legendary Samurai; Resolve, Greater resolve, iaijutsu master restored\./.test(removeArchetype(c3, LS, 'Gunblade Duelist')));
  check('cells back, yojimbo untouched', [cell(2), cell(9), cell(10), cell(4)], ['Resolve', 'Greater resolve', 'iaijutsu master', "Guardian's Toughness"]);
  ok("and the class's own feature text restored", tplNames().includes('Resolve') && !tplNames().includes('Gun Fusion') && tplNames().includes("Guardian's Toughness"));
  check('row names only yojimbo now', [c3.data.classes[0].archetypes, c3.data.classes[0].archetypeStack.map((e) => e.name)], ['Yojimbo', ['Yojimbo']]);
  check('oni now conflicts with yojimbo on challenge', archetypeStatus(c3, oni), { ok: false, reason: 'conflict', with: 'Yojimbo', shared: ['challenge'] });
  // "can be combined with" lets an overlap through
  const finesse = { kind: 'archetype', name: "Samurai's Finesse", class: LS, single: true, features: [{ name: "Samurai's Finesse", text: 'x. This ability alters iaijutsu strike. This alternative class feature can be combined with the Yumi Sniper archetype.' }] };
  const yumi = { kind: 'archetype', name: 'Yumi Sniper', class: LS, features: [{ name: "Archer's Technique", text: 'y. This ability alters iaijutsu strike.' }] };
  applyBlock(c3, finesse);
  check('a declared combination overrides the overlap', archetypeStatus(c3, yumi).ok, true);
  const back3 = new Character(JSON.parse(JSON.stringify(c3.toJSON())));
  check('the stack round-trips', back3.data.classes[0].archetypeStack.map((e) => e.name), ['Yojimbo', "Samurai's Finesse"]);

  // veils go onto the Akashic board, into their chakra slot
  const v1 = applyBlock(c, { kind: 'veil', name: 'Unyielding', slot: 'Body', text: 'stands firm' });
  ok('says where it went', /Shaped Unyielding in a new Body slot/.test(v1));
  const body = c.data.akashic.slots.find((s) => s.slot === 'Body');
  check('the veil sits in the slot with essence 0', body.veils.map((v) => [v.name, v.desc, v.essence]), [['Unyielding', 'stands firm', 0]]);
  const v2 = applyBlock(c, { kind: 'veil', name: 'Second Skin', slot: 'body', text: 't' });
  ok('a full slot gets a second slot of the same name, nothing displaced', /in a second Body slot/.test(v2) && body.veils.length === 1
    && c.data.akashic.slots.filter((s) => s.slot === 'Body').length === 2);
  body.twinveil = true;
  applyBlock(c, { kind: 'veil', name: 'Twin', slot: 'Body', text: 't' });
  check('twinveil takes a second veil in the first slot', body.veils.map((v) => v.name), ['Unyielding', 'Twin']);
  let threw = false;
  try { applyBlock(c, { kind: 'spell', name: 'x' }); } catch { threw = true; }
  check('unknown kinds throw', threw, true);

  // and back out again
  const lifted = blocksFromCharacter(c.toJSON());
  check('lifted kinds', lifted.map((b) => [b.kind, b.name]), [['class', 'Barbarian'], ['race', 'Dwarf'], ['template', 'Barbarian'], ['template', 'Bloodburst Blade'], ['tracker', 'Rage rounds']]);
  check('lifted race carries mods and traits', [lifted[1].abilityMods, lifted[1].traits.length], [{ con: 2, cha: -2 }, 4]);
  // round trip: the same document reloads with everything in place
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('round trip keeps the class with its feature text, the race, the templates and the tracker',
    [back.data.classes.length, back.classFeatureNotes('Barbarian').length, back.data.identity.race, back.data.templates.length, back.trackers.some((x) => x.name === 'Rage rounds')],
    [1, 2, 'Dwarf', 2, true]);
  ok('a group named for a class that a feature block made is a group still, not swallowed',
    back.data.templates.some((t) => t.name === 'Barbarian'));
}

console.log('repeat features -- a column each, on the schedule their levels describe');
{
  check('an arithmetic run to the top is written the way a book writes it',
    [ruleForLevels([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]), ruleForLevels([1, 6, 11, 16]), ruleForLevels([9, 13, 17])],
    ['2, +2', '1, +5', '9, +4']);
  check('anything else is the levels themselves, which is never wrong',
    [ruleForLevels([3, 5]), ruleForLevels([2, 4, 6, 8]), ruleForLevels([7]), ruleForLevels([])],
    ['3, 5', '2, 4, 6, 8', '7', '']);

  const feats = [
    { level: 1, name: 'Combat training' }, { level: 1, name: 'thunderous blows +1d6' },
    { level: 2, name: 'Skilled craftsman' }, { level: 2, name: 'smithing insight' },
    { level: 3, name: 'Thunderous blows +2d6' }, { level: 4, name: 'Smithing insight' },
    { level: 5, name: 'thunderous blows +3d6' }, { level: 6, name: 'Smithing insight' },
    { level: 20, name: "Smith's masterpiece" },
  ];
  const cols = repeatColumns(feats);
  check('only what repeats gets a column, best-cased', cols.map((c) => [c.name, c.rule]),
    [['Thunderous blows', '1, 3, 5'], ['Smithing insight', '2, 4, 6']]);
  check('a ladder writes the number it grew by; a menu writes nothing, so the level reads as owed',
    cols.map((c) => c.at.map((a) => a.text)), [['+1d6', '+2d6', '+3d6'], ['', '', '']]);

  const c = new Character(blankDocument({ name: 'Smith', level: 6 }));
  for (let l = 1; l <= 6; l++) c.setProgressionClass(l, 0, 'Blacksmith');
  applyBlock(c, {
    kind: 'class', name: 'Blacksmith', hd: 10, bab: 1, goodFort: true, goodWill: true, skillRanks: 4, features: feats,
  });
  const g = c.data.progression.classFeatures.Blacksmith;
  check('columns made, the one-offs left in Special', g.columns, ['Special', 'Thunderous blows', 'Smithing insight']);
  check('each column carries its own schedule, named for itself',
    Object.fromEntries(Object.entries(g.rules).map(([k, v]) => [k, v.map((x) => [x.name, x.rule])])),
    { 'Thunderous blows': [['Thunderous blows', '1, 3, 5']], 'Smithing insight': [['Smithing insight', '2, 4, 6']] });
  check('cells: the ladder filled in, the menu left to pick, Special holding the rest',
    [g.byLevel[1], g.byLevel[2], g.byLevel[20]],
    [{ Special: 'Combat training', 'Thunderous blows': '+1d6' }, { Special: 'Skilled craftsman', 'Smithing insight': '' }, { Special: "Smith's masterpiece" }]);
  check('the grid says how many picks are owed at this level', c.classFeatureDue('Blacksmith'), { 'Smithing insight': 3 });
}

console.log('option menus -- a pack provides them, a column points at one');
{
  const menu = {
    kind: 'options', name: 'Blacksmith Smithing Insight', class: 'Blacksmith', feature: 'Smithing insight',
    text: 'Pick one each time the class grants an insight.',
    options: [
      { name: 'Durable', type: 'Ex', category: 'Insights', text: 'Items resist sundering.' },
      { name: 'Gunsmith', type: 'ex', category: 'Insights', minLevel: '5', text: 'Craft firearms.' },
      { name: '', text: 'nameless, dropped' },
    ],
  };
  const b = normalizeBlock(menu);
  check('the block keeps the class, the feature and its entries',
    [b.kind, b.class, b.feature, b.options.map((o) => [o.name, o.type, o.category, o.minLevel])],
    ['options', 'Blacksmith', 'Smithing insight', [['Durable', 'Ex', 'Insights', null], ['Gunsmith', 'Ex', 'Insights', 5]]]);

  const c = new Character(blankDocument({ name: 'Smith', level: 6 }));
  for (let l = 1; l <= 6; l++) c.setProgressionClass(l, 0, 'Blacksmith');
  applyBlock(c, {
    kind: 'class', name: 'Blacksmith', hd: 10, bab: 1, skillRanks: 4,
    features: [{ level: 2, name: 'Smithing insight' }, { level: 4, name: 'Smithing insight' }],
  });
  const said = applyBlock(c, menu);
  ok('says which column it landed on', /Smithing insight column now picks from/.test(said));
  check('the sheet holds the menu\'s name, never a copy of it',
    c.data.progression.classFeatures.Blacksmith.optionsFrom, { 'Smithing insight': 'Blacksmith Smithing Insight' });
  check('and nothing of the menu itself is on the character', JSON.stringify(c.toJSON()).includes('Craft firearms'), false);

  // The runtime hands the model what the active packs provide.
  setOptionCatalogues(optionCataloguesFrom([{ ...menu }, { kind: 'note', name: 'not a menu' }]));
  check('one catalogue, by name', optionCatalogues().map((x) => [x.name, x.options.length]), [['Blacksmith Smithing Insight', 2]]);
  const row = c.classFeatureRows('Blacksmith').find((r) => r.level === 2);
  check('the cell that picks from it knows its entries',
    row.cells['Smithing insight'].fields.map((f) => f.menu?.options.map((o) => o.name)), [['Durable', 'Gunsmith']]);
  setOptionCatalogues([]);
  const off = c.classFeatureRows('Blacksmith').find((r) => r.level === 2);
  check('with its pack switched off the cell is a box to type in again, and the name is still on the sheet',
    [off.cells['Smithing insight'].fields[0].menu, c.classFeatureColumnOptions('Blacksmith', 'Smithing insight')],
    [null, ['Blacksmith Smithing Insight']]);

  // No such column: the menu stays in its pack rather than being copied anywhere.
  const bare = new Character(blankDocument({ name: 'Nobody', level: 1 }));
  const note = applyBlock(bare, menu);
  ok('says nothing picks from it yet, and copies nothing onto the sheet',
    /Nothing on this sheet picks from .Blacksmith Smithing Insight./.test(note) && bare.data.templates.length === 0);
}

console.log('an archetype\'s own menu -- layered on the class\'s, and off again with it');
{
  check('an entry says which of the menu it joins it pushes out',
    parseOptionReplaces('This replaces the Ranged Cut and Armor Rending Slash Iaijutsu Techniques.', 'Topological Iaijutsu Techniques'),
    ['Ranged Cut', 'Armor Rending Slash']);
  check('singular or plural, and nothing where nothing is said',
    [parseOptionReplaces('This replaces the Explosive Cut and Vacuum Slash Iaijutsu Technique.', 'Topological Iaijutsu Techniques'),
      parseOptionReplaces('An Isougiri must be 5th level or higher to select this technique.', 'Topological Iaijutsu Techniques')],
    [['Explosive Cut', 'Vacuum Slash'], []]);

  const base = {
    kind: 'options', name: 'Legendary Samurai Iaijutsu Technique', class: 'Legendary Samurai', feature: 'Iaijutsu Technique',
    options: [
      { name: 'Armor-Rending Slash', type: 'Ex', category: 'Slashes', text: 'a' },
      { name: 'Death Slash', type: 'Ex', category: 'Slashes', minLevel: 17, text: 'b' },
      { name: 'Ranged Cut', type: 'Ex', category: 'Cuts', text: 'c' },
    ],
  };
  const arch = {
    kind: 'archetype', name: 'Isougiri', class: 'Legendary Samurai',
    features: [{
      level: 1, name: 'Topological Iaijutsu Techniques', text: 'Topological Draw alters Iaijutsu Techniques.',
      options: [
        { name: 'Zero-Point Thrust', type: 'Ex', category: 'Cuts', text: 'This replaces the Ranged Cut and Armor Rending Slash Iaijutsu Techniques.' },
        { name: 'Folding Thrust', type: 'Su', category: 'Cuts', minLevel: 9, text: 'x' },
      ],
    }],
  };
  setOptionCatalogues(optionCataloguesFrom([base, arch]));
  check('an archetype\'s menu is a catalogue of its own, named for both',
    optionCatalogues().map((c) => c.name),
    ['Legendary Samurai Iaijutsu Technique', 'Isougiri — Topological Iaijutsu Techniques']);

  const c = new Character(blankDocument({ name: 'Isou', level: 9 }));
  for (let l = 1; l <= 9; l++) c.setProgressionClass(l, 0, 'Legendary Samurai');
  applyBlock(c, {
    kind: 'class', name: 'Legendary Samurai', hd: 10, bab: 1, skillRanks: 4,
    features: [{ level: 1, name: 'Iaijutsu technique' }, { level: 5, name: 'Iaijutsu technique' }, { level: 9, name: 'Iaijutsu technique' }],
  });
  applyBlock(c, base);
  check('the class\'s column takes the class\'s menu', c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'),
    ['Legendary Samurai Iaijutsu Technique']);

  applyArchetype(c, arch);
  check('the archetype layers its own on top rather than replacing it',
    c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'),
    ['Legendary Samurai Iaijutsu Technique', 'Isougiri — Topological Iaijutsu Techniques']);
  const merged = resolveOptionMenu(c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'));
  check('the entries it replaces drop out -- punctuation and all -- and the rest of the class\'s list stands',
    merged.options.map((o) => o.name), ['Death Slash', 'Zero-Point Thrust', 'Folding Thrust']);

  // What a level offers is what a level offers: an entry asking for more is not on it.
  const offered = (lvl) => merged.options.filter((o) => !o.minLevel || o.minLevel <= lvl).map((o) => o.name);
  check('level 1 offers what asks for nothing', offered(1), ['Zero-Point Thrust']);
  check('level 9 offers what it has reached, not the 17th-level entry', offered(9), ['Zero-Point Thrust', 'Folding Thrust']);

  removeArchetype(c, 'Legendary Samurai', 'Isougiri');
  check('taking the archetype off takes its menu with it',
    [c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'),
      resolveOptionMenu(c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique')).options.map((o) => o.name)],
    [['Legendary Samurai Iaijutsu Technique'], ['Armor-Rending Slash', 'Death Slash', 'Ranged Cut']]);
}

console.log('a replaced repeat feature -- its whole column goes, and comes back where it was');
{
  const c = new Character(blankDocument({ name: 'Isou', level: 11 }));
  for (let l = 1; l <= 11; l++) c.setProgressionClass(l, 0, 'Legendary Samurai');
  applyBlock(c, {
    kind: 'class', name: 'Legendary Samurai', hd: 10, bab: 1, skillRanks: 4,
    features: [{ level: 1, name: 'Challenge' }, { level: 3, name: 'Kiai art' }, { level: 7, name: 'Kiai art' },
      { level: 11, name: 'Kiai art' }, { level: 6, name: 'Advanced blade' }, { level: 11, name: 'Advanced blade' }],
  });
  setOptionCatalogues(optionCataloguesFrom([{ kind: 'options', name: 'Kiai Arts', class: 'Legendary Samurai', feature: 'Kiai art', options: [{ name: 'Follow My Lead', text: 'y' }] }]));
  applyBlock(c, { kind: 'options', name: 'Kiai Arts', class: 'Legendary Samurai', feature: 'Kiai art', options: [{ name: 'Follow My Lead', text: 'y' }] });
  c.setClassFeature('Legendary Samurai', 3, 'Kiai art', 'Follow My Lead');
  const cols = () => c.data.progression.classFeatures['Legendary Samurai'].columns;
  check('the class made a column each', cols(), ['Special', 'Kiai art', 'Advanced blade']);

  applyArchetype(c, {
    kind: 'archetype', name: 'Silent Retainer', class: 'Legendary Samurai',
    features: [{ level: 3, name: 'Wordless Service', text: 'This replaces kiai art.' }],
  });
  check('replacing a repeat feature takes its column with it', cols(), ['Special', 'Advanced blade']);
  removeArchetype(c, 'Legendary Samurai', 'Silent Retainer');
  check('and it comes back where it was, with its schedule, its menu and what was written in it',
    [cols(), c.classFeatureColumnOptions('Legendary Samurai', 'Kiai art'),
      c.data.progression.classFeatures['Legendary Samurai'].byLevel[3]['Kiai art'],
      c.classFeatureRuleGroups('Legendary Samurai', 'Kiai art').map((g) => g.rule)],
    [['Special', 'Kiai art', 'Advanced blade'], ['Kiai Arts'], 'Follow My Lead', ['3, 7, 11']]);
  setOptionCatalogues([]);
}

console.log('one grant at a time -- an archetype that takes the 10th and 14th, not the feature');
{
  check('the levels ride on the key, so each is its own thing to swap',
    parseSwaps("This replaces the 10th and 14th level Warrior's grace.", 'Legendary Samurai'),
    { replaces: ['warriors grace@10', 'warriors grace@14'], alters: [] });
  check('a single one, hyphenated, reads the same',
    parseSwaps('This replaces the 4th-level rage power.', 'Barbarian').replaces, ['rage power@4']);
  check('two grants of one feature do not meet; the whole feature meets either',
    [swapsMeet('warriors grace@10', 'warriors grace@14'), swapsMeet('warriors grace@10', 'warriors grace'),
      swapsMeet('warriors grace@10', 'warriors grace@10'), swapsMeet('warriors grace@10', 'spirit')],
    [false, true, true, false]);

  const samurai = (level = 20) => {
    const c = new Character(blankDocument({ name: 'Isou', level }));
    for (let l = 1; l <= level; l++) c.setProgressionClass(l, 0, 'Legendary Samurai');
    applyBlock(c, {
      kind: 'class', name: 'Legendary Samurai', hd: 10, bab: 1, skillRanks: 4,
      features: [{ level: 1, name: 'Challenge' },
        ...[2, 6, 10, 14, 18].map((l) => ({ level: l, name: "Warrior's grace", text: 'A social talent.' }))],
    });
    c.setClassFeature('Legendary Samurai', 10, "Warrior's grace", 'Social Grace');
    return c;
  };
  const rule = (c) => c.classFeatureRuleGroups('Legendary Samurai', "Warrior's grace")[0]?.rule;
  const grants = (c) => c.classFeatureRows('Legendary Samurai')
    .filter((r) => r.cells["Warrior's grace"]?.fields.some((f) => f.on && f.group)).map((r) => r.classLevel);
  const iso = {
    kind: 'archetype', name: 'Isougiri', class: 'Legendary Samurai',
    features: [{ level: 11, name: 'Spatial Discontinuity', text: "This replaces the 10th and 14th level Warrior's grace." }],
  };
  const envoy = {
    kind: 'archetype', name: 'Court Envoy', class: 'Legendary Samurai',
    features: [{ level: 18, name: 'Envoy', text: "This replaces the 18th level Warrior's grace." }],
  };

  const c = samurai();
  check('the class grants at every fourth level from the second', [rule(c), grants(c)], ['2, +4', [2, 6, 10, 14, 18]]);
  ok('and says which levels went', /replacing Warrior's grace at 10th and 14th/.test(applyArchetype(c, iso)));
  check('the schedule loses those levels and keeps the rest -- the column stands',
    [rule(c), grants(c), c.data.progression.classFeatures['Legendary Samurai'].columns.includes("Warrior's grace")],
    ['2, +4, -10, -14', [2, 6, 18], true]);
  check('what had been picked at a level it took is kept, to put back',
    c.data.progression.classFeatures['Legendary Samurai'].byLevel[10]["Warrior's grace"], '');
  ok('the feature\'s own text stays: it arrives one time fewer, it does not go',
    c.classFeatureNotes('Legendary Samurai').some((f) => f.name === "Warrior's grace"));

  // The point of counting grants rather than features: these two can stand together.
  check('an archetype taking a different grant of the same feature is not a clash',
    archetypeStatus(c, envoy).ok, true);
  applyArchetype(c, envoy);
  check('both subtractions stand', [rule(c), grants(c)], ['2, +4, -10, -14, -18', [2, 6]]);
  const whole = {
    kind: 'archetype', name: 'Recluse', class: 'Legendary Samurai',
    features: [{ level: 2, name: 'Hermit', text: "This replaces warrior's grace." }],
  };
  check('one taking the whole feature is', [archetypeStatus(c, whole).ok, archetypeStatus(c, whole).shared],
    [false, ['warriors grace (10th)', 'warriors grace (14th)']]);

  // Undoing takes the subtraction back out, so the order they come off in does not matter.
  for (const order of [['Isougiri', 'Court Envoy'], ['Court Envoy', 'Isougiri']]) {
    const x = samurai();
    applyArchetype(x, iso);
    applyArchetype(x, envoy);
    for (const n of order) removeArchetype(x, 'Legendary Samurai', n);
    check(`removing ${order.join(' then ')} puts every level and its pick back`,
      [rule(x), grants(x), x.data.progression.classFeatures['Legendary Samurai'].byLevel[10]["Warrior's grace"]],
      ['2, +4', [2, 6, 10, 14, 18], 'Social Grace']);
  }

  // A level the class does not grant at is not a swap that happened.
  const other = new Character(blankDocument({ name: 'Other', level: 20 }));
  for (let l = 1; l <= 20; l++) other.setProgressionClass(l, 0, 'Legendary Samurai');
  applyBlock(other, {
    kind: 'class', name: 'Legendary Samurai', hd: 10, bab: 1, skillRanks: 4,
    features: [2, 6, 12, 18, 20].map((l) => ({ level: l, name: "Warrior's grace", text: 'A social talent.' })),
  });
  const said = applyArchetype(other, iso);
  ok('a grant the class never had is said, not silently skipped',
    /warriors grace \(10th\), warriors grace \(14th\) not on the sheet/.test(said)
    && other.classFeatureRuleGroups('Legendary Samurai', "Warrior's grace")[0].rule === '2, 6, 12, 18, 20');
}

console.log('a menu names its class and its feature, so a column of that name picks from it');
{
  const menu = (name, feature, cls = 'Legendary Samurai') => ({
    kind: 'options', name, class: cls, feature, options: [{ name: `${name} entry`, text: 'x' }],
  });
  setOptionCatalogues(optionCataloguesFrom([
    menu('Legendary Samurai Iaijutsu Technique', 'Iaijutsu Technique'),
    menu('Legendary Samurai Kiai Art', 'Kiai Art'),
    menu('Rogue Talent', 'Rogue Talents', 'Rogue'),
  ]));
  check('matched across the spellings two pages use, and across the plural',
    [optionCatalogueFor('Legendary Samurai', 'Iaijutsu technique')?.name,
      optionCatalogueFor('Legendary Samurai', "Kiai art")?.name,
      optionCatalogueFor('Rogue', 'Rogue talent')?.name],
    ['Legendary Samurai Iaijutsu Technique', 'Legendary Samurai Kiai Art', 'Rogue Talent']);
  check('another class\'s menu is not this class\'s, and an unnamed column matches nothing',
    [optionCatalogueFor('Rogue', 'Iaijutsu technique'), optionCatalogueFor('Legendary Samurai', 'Special')],
    [null, null]);

  const c = new Character(blankDocument({ name: 'Isou', level: 9 }));
  for (let l = 1; l <= 9; l++) c.setProgressionClass(l, 0, 'Legendary Samurai');
  applyBlock(c, {
    kind: 'class', name: 'Legendary Samurai', hd: 10, bab: 1, skillRanks: 4,
    features: [1, 5, 9].map((l) => ({ level: l, name: 'Iaijutsu technique' })),
  });
  check('the column picks from it with nothing added and nothing recorded',
    [c.data.progression.classFeatures['Legendary Samurai'].optionsFrom,
      c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'),
      c.classFeatureRows('Legendary Samurai')[0].cells['Iaijutsu technique'].fields[0].menu?.options.length],
    [{}, ['Legendary Samurai Iaijutsu Technique'], 1]);
  ok('adding the menu block says it was already picked from, and changes nothing',
    /already picks from/.test(applyBlock(c, menu('Legendary Samurai Iaijutsu Technique', 'Iaijutsu Technique')))
    && JSON.stringify(c.data.progression.classFeatures['Legendary Samurai'].optionsFrom) === '{}');

  // An archetype layering onto a column no one recorded keeps the pack's own claim under it.
  applyArchetype(c, {
    kind: 'archetype', name: 'Isougiri', class: 'Legendary Samurai',
    features: [{
      level: 1, name: 'Topological Iaijutsu Techniques', text: 'Topological Draw alters Iaijutsu Techniques.',
      options: [{ name: 'Zero-Point Thrust', text: 'y' }],
    }],
  });
  check('the class\'s menu is still under the archetype\'s',
    c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'),
    ['Legendary Samurai Iaijutsu Technique', 'Isougiri — Topological Iaijutsu Techniques']);
  removeArchetype(c, 'Legendary Samurai', 'Isougiri');

  // Saying no is a decision, and no pack takes it back.
  const index = c.data.progression.classFeatures['Legendary Samurai'].columns.indexOf('Iaijutsu technique');
  c.setClassFeatureColumnOptions('Legendary Samurai', index, '');
  check('"no menu" is recorded as such, and survives a save',
    [c.classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique'),
      c.classFeatureColumnOptionsChosen('Legendary Samurai', 'Iaijutsu technique'),
      new Character(JSON.parse(JSON.stringify(c.toJSON()))).classFeatureColumnOptions('Legendary Samurai', 'Iaijutsu technique')],
    [[], true, []]);
  setOptionCatalogues([]);
}

console.log('the Template tab is for templates: a class\'s feature text moves under the class');
{
  const doc = blankDocument({ name: 'Old', level: 5 });
  doc.classes = [{ name: 'Barbarian', hd: 12, bab: 1, goodFort: true, skillRanks: 4 }];
  doc.progression = {
    tracks: 2,
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, classes: i < 5 ? ['Barbarian'] : [] })),
    classFeatures: { Barbarian: { columns: ['Special'], byLevel: { 1: { Special: 'Rage, Fast movement' }, 3: { Special: 'Trap sense +1' } }, rules: {} } },
  };
  doc.templates = [
    { tab: null, name: 'Barbarian', link: null, approvalLink: null, features: [
      { name: 'Rage', type: null, text: 'Rage text.', tables: [], children: [] },
      { name: 'Trap sense +1', type: 'Ex', text: 'Trap text.', tables: [], children: [] }] },
    { tab: null, name: 'Half-Dragon', link: 'http://x', approvalLink: null, features: [{ name: 'Breath weapon', type: 'Su', text: 'b', tables: [], children: [] }] },
  ];
  const c = new Character(doc);
  check('a group named for a class, every feature of it on that class\'s ladder, moves under the class',
    [c.data.templates.map((t) => t.name), c.classFeatureNotes('Barbarian').map((n) => [n.name, n.type, n.text])],
    [['Half-Dragon'], [['Rage', null, 'Rage text.'], ['Trap sense +1', 'Ex', 'Trap text.']]]);
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('and having moved, it stays moved -- the move happens once', [again.data.templates.length, again.classFeatureNotes('Barbarian').length], [1, 2]);

  const other = blankDocument({ name: 'Keep', level: 5 });
  other.classes = [{ name: 'Barbarian', hd: 12, bab: 1, skillRanks: 4 }];
  other.templates = [{ tab: null, name: 'Barbarian', link: null, approvalLink: null, features: [{ name: 'Something Else', type: null, text: 'x', tables: [], children: [] }] }];
  check('a template that merely shares a class\'s name is a template still', new Character(other).data.templates.map((t) => t.name), ['Barbarian']);
}

console.log('editor -- the textarea line formats');
check('class features by level', parseClassFeatures('1st: Fast movement, Rage\n3: Trap sense +1 — +1 on Reflex vs traps\nno level'), [
  { level: 1, name: 'Fast movement', text: '' }, { level: 1, name: 'Rage', text: '' },
  { level: 3, name: 'Trap sense +1', text: '+1 on Reflex vs traps' }, { level: 1, name: 'no level', text: '' },
]);
check('group features with a type', parseGroupFeatures('Rage (Ex): text\nPlain: t2\nBare'), [
  { name: 'Rage', type: 'Ex', text: 'text' }, { name: 'Plain', type: null, text: 't2' }, { name: 'Bare', type: null, text: '' },
]);
check('menu entries: category, type and the level it asks for are each optional', parseMenuOptions(
  ['Slashes / Bloody Slash (Ex) 5+: The target takes bleed damage.',
    'Cuts / Ranged Cut (Ex): Strike at 30 feet.',
    'Durable: Items resist sundering.'].join('\n')), [
  { name: 'Bloody Slash', type: 'Ex', category: 'Slashes', minLevel: 5, text: 'The target takes bleed damage.' },
  { name: 'Ranged Cut', type: 'Ex', category: 'Cuts', minLevel: null, text: 'Strike at 30 feet.' },
  { name: 'Durable', type: null, category: '', minLevel: null, text: 'Items resist sundering.' },
]);
ok('and they write back out as what they parse from', menuOptionLines(parseMenuOptions('Cuts / Ranged Cut (Ex) 9+: x')) === 'Cuts / Ranged Cut (Ex) 9+: x');
check('an entry keeps what its own text says it replaces', normalizeBlock({ kind: 'options', name: 'M', feature: 'Smithing insight',
  options: parseMenuOptions('Gunsmith: Craft firearms. This replaces the Polish smithing insight.') }).options[0].replaces, ['Polish']);
check('named lines keep later colons', parseNamedLines('Darkvision: sees 60 ft: really'), [{ name: 'Darkvision', text: 'sees 60 ft: really' }]);
check('blank pack has an id and no blocks', [blankExtension({ name: 'A B' }).id, blankExtension().blocks], ['a-b', []]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
