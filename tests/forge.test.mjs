/** Tests the Forge page's own modules: the pack importer against the pack
 *  exporter (a round trip lands every entry back where it was), the store over
 *  a fake Storage, and the schema helpers. Needs no fixtures, no DOM.
 *  Run: node tests/forge.test.mjs */
import { importPack, forgeToPack } from '../forge/js/pack.js';
import { forgeStore } from '../forge/js/store.js';
import { TYPES, GROUPS, newEntry, linksIn, sortEntries, normalizeCustomTypes, applyCustomTypes } from '../forge/js/schema.js';

let pass = 0;
let fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}\n  got      ${JSON.stringify(a)}\n  expected ${JSON.stringify(b)}`);

const entry = (id, type, name, fields = {}, body = '', parent = '', tags = []) => ({ ...newEntry(type, name, parent), id, tags, fields, body });
const original = [
  entry('sky', 'discipline', 'Sky Doctrine', { skill: 'Fly', weapons: 'Polearms, Firearms', tradition: '' }, 'See [[Airborne]].'),
  entry('impaler', 'maneuver', 'Aerial Impaler', { level: 1, mtype: 'Strike', action: 'Standard', range: 'Melee attack', target: 'One creature', duration: 'Instant', save: 'None', dc: '' }, 'Deal +1d6 damage.', 'sky', ['Airborne']),
  entry('wings', 'maneuver', 'Iron Wings', { level: 1, mtype: 'Stance', action: 'Swift', range: 'Personal', target: 'You', duration: 'Stance', save: 'None', dc: '' }, 'A stance.', 'sky'),
  entry('airborne', 'article', 'Airborne', {}, 'A condition.', '', ['Condition']),
  entry('feat1', 'feat', 'Sky Sentinel', { featType: 'Combat', prereq: 'Fly 3 ranks', normal: 'Nothing.', special: 'Twice.' }, 'You gain wings.'),
  entry('spell1', 'spell', 'Gale Step', { school: 'Transmutation [air]', level: 'sorcerer/wizard 2, druid 2', casting: '1 standard action', components: 'V, S', range: 'Personal', target: '', duration: '1 round/level', save: 'None', sr: 'No' }, 'You fly.'),
  entry('cls', 'class', 'Sky Knight', { hd: 'd10', ranks: '4', bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', classSkills: 'Fly, Perception', prof: '' }, 'A knight of the air.'),
  entry('cf1', 'classFeature', 'Wingborne', { level: 1, kind: '—', replaces: '', alters: '' }, 'You fly.', 'cls'),
  entry('arch', 'archetype', 'Cloud Lancer', { baseClass: 'Sky Knight', replaces: '' }, 'Lances.', 'cls'),
  entry('cf3', 'classFeature', 'Lance dive', { level: 3, kind: 'Ex', replaces: 'wingborne', alters: 'weapon and armor proficiency' }, 'Replaces wingborne.', 'arch'),
  entry('race', 'race', 'Aerin', { size: 'Medium', ctype: '', abilities: '+2 Dex, -2 Con', speed: '30 ft.', languages: 'Common, Auran' }, 'Sky folk.\n\n**Wings:** Fly 30 ft.'),
  entry('rt', 'trait', 'Storm Eyes', { category: 'Race', prereq: '' }, 'See in rain.'),
  entry('ct', 'trait', 'Sky Born', { category: 'Regional', prereq: '' }, 'Plus one Fly.', '', ['Regional']),
  entry('item', 'item', 'Wind Lance', { category: 'Weapon', price: '8,000 gp' }, 'A lance.'),
  entry('camp', 'campaign', 'Primordia', { setting: 'Primordia', status: 'Running' }, 'The campaign.'),
  entry('npc', 'npc', 'Kestrel', { role: 'Captain' }, 'An NPC.', 'camp'),
];

/* ---- round trip: export, import into an empty Forge, compare ---- */
const pack = forgeToPack(original, { revision: 2 });
const back = importPack(pack, []);
const byKey = (list) => new Map(list.map((e) => [`${e.type}|${e.name}`, e]));
const o = byKey(original); const b = byKey(back);
eq(back.length, original.length, 'every entry comes back');
for (const [k, e] of o) {
  const r = b.get(k);
  ok(r, `${k} is back`);
  if (!r) continue;
  // links flatten to their label on the way out; a race's trait lines come back bold, so emphasis is ignored on both sides
  eq(r.body.replace(/\*\*/g, '').replace(/\s+/g, ' '), e.body.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, n, l) => l || n).replace(/\*\*/g, '').replace(/\s+/g, ' '), `${k} body survives (links flattened)`);
  const parentName = e.parent ? o.get([...o.values()].find((x) => x.id === e.parent) && `${[...o.values()].find((x) => x.id === e.parent).type}|${[...o.values()].find((x) => x.id === e.parent).name}`)?.name : '';
  const rParent = r.parent ? back.find((x) => x.id === r.parent)?.name : '';
  eq(rParent || '', parentName || '', `${k} keeps its container`);
}
eq(b.get('maneuver|Aerial Impaler').fields, o.get('maneuver|Aerial Impaler').fields, 'maneuver cells round-trip exactly');
eq(b.get('spell|Gale Step').fields, o.get('spell|Gale Step').fields, 'spell cells round-trip exactly');
eq(b.get('feat|Sky Sentinel').fields, o.get('feat|Sky Sentinel').fields, 'feat normal and special come back as fields');
eq(b.get('class|Sky Knight').fields, o.get('class|Sky Knight').fields, 'class cells round-trip');
eq(b.get('classFeature|Lance dive').fields, o.get('classFeature|Lance dive').fields, 'an archetype feature keeps what it replaces and what it alters');
eq(b.get('race|Aerin').fields, o.get('race|Aerin').fields, 'race cells round-trip');
eq(b.get('trait|Storm Eyes').fields.category, 'Race', 'race trait block reads as a Race trait');
eq(b.get('trait|Sky Born').tags, ['Regional'], 'catalogue tags come back as tags');
eq(b.get('article|Airborne').tags, ['Condition'], 'article tags come back');
eq(b.get('discipline|Sky Doctrine').fields.skill, 'Fly', 'discipline description fills the discipline that its maneuvers made');
ok(!back.some((e) => e.type === 'discipline' && e.name === 'Sky Doctrine' && e !== b.get('discipline|Sky Doctrine')), 'one discipline, not two');

/* ---- importing again adds nothing ---- */
eq(importPack(pack, back).length, 0, 'a second import of the same pack adds nothing');
const more = structuredClone(pack); more.provides.maneuvers.disciplines[0].entries.push({ level: 2, kind: 'maneuver', name: 'Wing Clipper', type: 'Strike', action: 'Standard', text: 'Clip.' });
const added = importPack(more, back);
eq(added.map((e) => [e.type, e.name, back.find((x) => x.id === e.parent)?.name]), [['maneuver', 'Wing Clipper', 'Sky Doctrine']], 'a new maneuver joins its existing discipline');

/* ---- a pack the sheet wrote by hand ---- */
const hand = importPack({ format: 'character-sheet-extension', blocks: [
  { kind: 'class', name: 'Barbarian', hd: 12, bab: 1, goodFort: true, skillRanks: 4, classSkills: ['Acrobatics'], features: [{ level: 1, name: 'Rage' }] },
  { kind: 'note', name: 'House rule', text: 'No crits on 19.' },
] }, []);
eq(hand.map((e) => [e.type, e.name]), [['class', 'Barbarian'], ['classFeature', 'Rage'], ['article', 'House rule']], 'hand-written blocks land as entries');
eq(hand[0].fields.hd, 'd12', 'hit die back as text');

/* ---- store over a fake Storage ---- */
const fake = new Map();
const storage = { getItem: (k) => (fake.has(k) ? fake.get(k) : null), setItem: (k, v) => fake.set(k, String(v)), removeItem: (k) => fake.delete(k), keys: () => fake.keys() };
const st = forgeStore({ factory: null, storage });
eq(await st.open(), 'localStorage', 'falls back to localStorage without IndexedDB');
await st.save(original[0]); await st.saveMany(original.slice(1, 3));
eq(st.entries().size, 3, 'three entries held');
await st.setMeta('packRevision', 4); eq(st.getMeta('packRevision'), 4, 'meta kept');
const st2 = forgeStore({ factory: null, storage }); await st2.open();
eq([...st2.entries().keys()].sort(), ['impaler', 'sky', 'wings'], 'a fresh store reads them back');
eq(st2.getMeta('packRevision'), 4, 'meta reads back');
await st2.remove('wings'); eq(st2.entries().size, 2, 'removed');

/* ---- helpers ---- */
eq(linksIn('a [[B]] and [[C|see c]]'), ['B', 'C'], 'linksIn');
const nameOf = (id) => original.find((e) => e.id === id)?.name || '';
eq(sortEntries(original, nameOf).map((e) => e.name).slice(0, 3), ['Cloud Lancer', 'Sky Knight', 'Lance dive'], 'sorted by group, type, container, level');
ok(Object.values(TYPES).every((t) => t.label && t.plural && t.group && Array.isArray(t.fields)), 'every type is complete');
ok(Object.entries(TYPES).every(([id, t]) => t.parent.includes(id) && t.children.includes(id)), 'every kind nests under its own kind');
eq(TYPES.discipline.children[0], 'maneuver', 'a container still adds what it always added first');
eq(TYPES.classFeature.parent, ['class', 'archetype', 'classFeature'], 'a class feature sits under a class, an archetype, or a class feature');

/* ----- nested groups flatten into the pack ----- */
{
  const arch = newEntry('archetype', 'Isougiri'); arch.fields = { baseClass: 'Legendary Samurai' };
  const tech = newEntry('classFeature', 'Topological Iaijutsu Techniques', arch.id); tech.fields = { level: 1 };
  const cuts = newEntry('classFeature', 'Cuts', tech.id); cuts.fields = {};
  const zpt = newEntry('classFeature', 'Zero Point Thrust', cuts.id); zpt.fields = { level: 3 }; zpt.body = 'A thrust.';
  const loose = newEntry('classFeature', 'Loose feature'); loose.body = 'On its own.';
  const disc = newEntry('discipline', 'Sky Doctrine');
  const m1 = newEntry('maneuver', 'Wing Cut', disc.id); m1.fields = { level: 2, mtype: 'Strike' };
  const m2 = newEntry('maneuver', 'Feathered Wing Cut', m1.id); m2.fields = { mtype: 'Strike' };
  const pack = forgeToPack([arch, tech, cuts, zpt, loose, disc, m1, m2], { revision: 1 });
  const a = pack.blocks.find((b) => b.kind === 'archetype');
  eq(a.features.map((x) => `${x.name}@${x.level}`), ['Topological Iaijutsu Techniques@1', 'Topological Iaijutsu Techniques: Cuts@1', 'Cuts: Zero Point Thrust@3'],
    'nested features flatten in tree order, named by their group, at their own level or the group\'s');
  eq(pack.blocks.filter((b) => b.kind === 'feature').map((b) => b.name), ['Loose feature'], 'a feature under a feature under an archetype is not loose');
  eq(pack.provides.maneuvers.disciplines[0].entries.map((x) => `${x.name}@${x.level}`), ['Wing Cut@2', 'Wing Cut: Feathered Wing Cut@2'], 'nested maneuvers flatten the same way');
}

/* ----- categories of the player's own ----- */
const builtinCount = Object.keys(TYPES).length;
const builtinGroups = GROUPS.length;
const cats = normalizeCustomTypes([
  { label: 'Ritual', group: 'Magic & gear', fields: 'Casting time, Cost' },
  { label: 'Rite', parent: 'x-ritual', fields: [{ k: 'dc', l: 'DC' }] },
  { label: 'Vow', group: 'Oaths', parent: 'campaign' },
  { label: '' }, null, { id: 'feat', label: 'Feat again' },
]);
eq(cats.map((c) => c.id), ['x-ritual', 'x-rite', 'x-vow', 'x-feat'], 'ids are slugged and prefixed, never a built-in id');
eq(cats[0].plural, 'Rituals', 'plural defaults from the label');
eq(cats[0].fields, [{ k: 'casting_time', l: 'Casting time', t: 'text' }, { k: 'cost', l: 'Cost', t: 'text' }], 'cells from a comma list');
eq(cats[1].fields, [{ k: 'dc', l: 'DC', t: 'text' }], 'cells as objects keep their keys');
eq(cats[1].group, 'Reference', 'group defaults');
applyCustomTypes(cats);
eq(Object.keys(TYPES).length, builtinCount + 4, 'four custom types applied');
ok(TYPES['x-ritual'].custom && TYPES['x-ritual'].children?.includes('x-rite'), 'a custom parent lists its custom child');
eq(TYPES['x-rite'].parent, ['x-ritual', 'x-rite'], 'the child names its parent, and itself');
ok(TYPES.campaign.children.includes('x-vow'), 'a built-in parent gains a custom child');
ok(GROUPS.includes('Oaths') && GROUPS.length === builtinGroups + 1, 'a new group is listed once');
ok(sortEntries([newEntry('x-vow', 'Silence'), newEntry('article', 'A')], () => '').map((e) => e.type)[0] === 'article', 'custom groups sort after the built-in ones');
applyCustomTypes([{ label: 'Ritual' }]);
eq(Object.keys(TYPES).length, builtinCount + 1, 're-applying replaces the set');
ok(!TYPES.campaign.children.includes('x-vow'), 'a dropped child leaves its built-in parent');
ok(!TYPES['x-ritual'].children.includes('x-rite'), 'a dropped child leaves its custom parent');
eq(GROUPS.length, builtinGroups, 'a dropped group goes');
applyCustomTypes([]);
eq(Object.keys(TYPES).length, builtinCount, 'none applied is the built-in set');

console.log(`forge: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
