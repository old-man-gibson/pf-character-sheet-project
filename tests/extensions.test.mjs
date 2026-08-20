/** Tests the extension packs: the format, the local store, merging tables,
 *  and attaching blocks to a character. Needs no fixtures.
 *  Run: node tests/extensions.test.mjs */
import { readFileSync } from 'node:fs';
import {
  EXTENSION_FORMAT, inspectExtension, normalizeExtension, normalizeBlock, blankExtension, slugId, babFromText,
  extensionStore, mergeTables, registerTables, activeExtensions, activeBlocks, applyBlock,
  blocksFromCharacter, describeSummary, looksLikeExtension, loadBundledExtensions, parseReplaces,
  swapKey, parseSwaps, parseStacksWith, archetypeStatus, removeArchetype,
} from '../app/js/extensions.js';
import { parseClassFeatures, parseGroupFeatures, parseNamedLines } from '../app/js/extension-manager.js';
import { Character, setManeuverCatalogue, disciplineEntries } from '../app/js/model.js';
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
  check('discipline replaced by name, case-insensitively', m.maneuvers.disciplines.map((d) => [d.name, d.entries.length]), [['broken blade', 1], ['Iron Tortoise', 0], ['Solar Wind', 0]]);
  check('later entries win', m.maneuvers.disciplines[0].entries[0].name, 'Y');
  check('vancian classes concatenate, spellLevels kept', [m.vancian.classes.map((c) => c.name), m.vancian.spellLevels], [['Cleric', 'Wizard'], ['0', '1st']]);
  check('psionic curve replaced by total', m.psionics.curves, [{ total: 52, points: [1] }]);
  check('cardcasting from the one pack', m.cardcasting.manipulations.length, 1);
  check('cooking entree replaced, duration kept', [m.cooking.entrees, m.cooking.durationHours], [[{ name: 'rice', effect: 'b' }], 'level']);
  check('empty merge has no optional keys', Object.keys(mergeTables([]).vancian), ['classes']);
  const calls = [];
  registerTables(m, { setManeuverCatalogue: (d) => calls.push(['m', d.disciplines.length]), setCookingTables: (d) => calls.push(['c', d.entrees.length]) });
  check('registrars called with the merged docs, missing ones skipped', calls, [['m', 3], ['c', 1]]);
}

console.log('bundled -- the shipped packs load through the index and merge cleanly');
{
  const fetcher = async (url) => {
    const path = decodeURIComponent(String(url).replace(/^file:\/\/\/?/, ''));
    try { return { ok: true, json: async () => JSON.parse(readFileSync(path, 'utf8')) }; } catch { return { ok: false }; }
  };
  const base = new URL('../', import.meta.url);
  const packs = await loadBundledExtensions(base, { fetcher });
  ok('five bundled packs', packs.length === 5);
  check('ids follow the index', packs.map((p) => p.id), ['path-of-war-disciplines', 'vancian-casting-tables', 'psionic-manifesting-tables', 'deck-manipulations', 'iron-chef-ingredients']);
  const m = mergeTables(packs);
  check('30 disciplines, 34 casting tables, 5 curves, 33 manipulations', [m.maneuvers.disciplines.length, m.vancian.classes.length, m.psionics.curves.length, m.cardcasting.manipulations.length], [30, 34, 5, 33]);
  setManeuverCatalogue(m.maneuvers);
  ok('the catalogue answers by discipline name', disciplineEntries('Broken Blade').length > 0);
  const none = await loadBundledExtensions(new URL('nowhere/', base), { fetcher });
  check('a missing index is no packs', none, []);
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
  check('features with text go on the Template tab once each, +N variants folded', c.data.templates.map((t) => [t.name, t.features.map((f) => f.name)]), [['Barbarian', ['Rage', 'Trap sense +1']]]);
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
  const tplNames = () => (c3.data.templates.find((t) => t.name === LS)?.features || []).map((f) => f.name);
  check('needs its class', archetypeStatus(c3, other), { ok: false, reason: 'no-class', className: 'Wizard' });
  ok('gunblade goes on', /Added Gunblade Duelist to Legendary Samurai, replacing Resolve, Greater resolve, iaijutsu master, altering sheath control\./.test(applyBlock(c3, gun)));
  check('replaced features leave their cells, new ones arrive at their levels', [cell(2), cell(9), cell(10)], ['Perfect Craftsmanship', '', 'Gun Fusion']);
  ok('template group swapped too', !tplNames().includes('Resolve') && tplNames().includes('Gun Fusion') && tplNames().includes('Bullet Control'));
  check('the class row names it', [c3.data.classes[0].archetypes, c3.data.classes[0].archetypeStack.map((e) => e.name)], ['Gunblade Duelist', ['Gunblade Duelist']]);
  check('oni conflicts on sheath control', archetypeStatus(c3, oni), { ok: false, reason: 'conflict', with: 'Gunblade Duelist', shared: ['sheath control'] });
  ok('and is refused with a reason', /cannot be added: it and Gunblade Duelist both change sheath control\./.test(applyBlock(c3, oni)));
  ok('yojimbo touches nothing gunblade touches, so it stacks', /Added Yojimbo/.test(applyBlock(c3, yoj)) && c3.data.classes[0].archetypeStack.length === 2);
  check('banner replaced, challenge kept beside its alteration', [cell(4), cell(1)], ["Guardian's Toughness", 'Challenge, sheath control, Bullet Control, Bonded Challenge']);
  check('applied twice is refused', archetypeStatus(c3, yoj).reason, 'applied');
  ok('removing gunblade restores exactly its features', /Removed Gunblade Duelist from Legendary Samurai; Resolve, Greater resolve, iaijutsu master restored\./.test(removeArchetype(c3, LS, 'Gunblade Duelist')));
  check('cells back, yojimbo untouched', [cell(2), cell(9), cell(10), cell(4)], ['Resolve', 'Greater resolve', 'iaijutsu master', "Guardian's Toughness"]);
  ok('template group restored', tplNames().includes('Resolve') && !tplNames().includes('Gun Fusion') && tplNames().includes("Guardian's Toughness"));
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
  check('round trip keeps the class, race, templates and tracker', [back.data.classes.length, back.data.identity.race, back.data.templates.length, back.trackers.some((x) => x.name === 'Rage rounds')], [1, 'Dwarf', 2, true]);
}

console.log('editor -- the textarea line formats');
check('class features by level', parseClassFeatures('1st: Fast movement, Rage\n3: Trap sense +1 — +1 on Reflex vs traps\nno level'), [
  { level: 1, name: 'Fast movement', text: '' }, { level: 1, name: 'Rage', text: '' },
  { level: 3, name: 'Trap sense +1', text: '+1 on Reflex vs traps' }, { level: 1, name: 'no level', text: '' },
]);
check('group features with a type', parseGroupFeatures('Rage (Ex): text\nPlain: t2\nBare'), [
  { name: 'Rage', type: 'Ex', text: 'text' }, { name: 'Plain', type: null, text: 't2' }, { name: 'Bare', type: null, text: '' },
]);
check('named lines keep later colons', parseNamedLines('Darkvision: sees 60 ft: really'), [{ name: 'Darkvision', text: 'sees 60 ft: really' }]);
check('blank pack has an id and no blocks', [blankExtension({ name: 'A B' }).id, blankExtension().blocks], ['a-b', []]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
