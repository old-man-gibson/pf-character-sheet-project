/** Tests the Homebrew Workbench converter: a Forge export becomes one pack the
 *  sheet's own inspector accepts, with each entry type landing where the
 *  mapping says. Needs no fixtures.
 *  Run: node tests/forge-pack.test.mjs */
import { forgeToPack, plainText } from '../tools/forge-pack.mjs';
import { inspectExtension, normalizeExtension } from '../app/js/extensions.js';
import { setFeatCatalogue, featEntry, setSpellCatalogue, spellEntry, setReferenceCatalogue, referenceEntry } from '../app/js/model/subsystems/catalogues.js';

let pass = 0;
let fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}\n  got      ${JSON.stringify(a)}\n  expected ${JSON.stringify(b)}`);

const entry = (id, type, name, fields = {}, body = '', parent = '', tags = []) => ({ id, type, name, parent, tags, fields, body });
const entries = [
  entry('sky', 'discipline', 'Sky Doctrine', { skill: 'Fly', weapons: 'Polearms, Firearms' }, 'See [[Airborne]].'),
  entry('impaler', 'maneuver', 'Aerial Impaler', { level: 1, mtype: 'Strike', action: 'Standard', range: 'Melee attack', target: 'One creature', duration: 'Instant', save: 'None', dc: '' }, 'Deal **+1d6** damage to a [[Descending|falling]] target.', 'sky', ['Airborne']),
  entry('wings', 'maneuver', 'Iron Wings', { level: 1, mtype: 'Stance', action: 'Swift' }, 'A stance.', 'sky'),
  entry('airborne', 'article', 'Airborne', {}, 'A condition.\n\n| a | b |\n|---|---|\n| 1 | 2 |', '', ['Condition']),
  entry('feat1', 'feat', 'Sky Sentinel', { featType: 'Combat', prereq: 'Fly 3 ranks', normal: 'Nothing.', special: '' }, 'You gain wings.'),
  entry('spell1', 'spell', 'Gale Step', { school: 'Transmutation [air]', level: 'sorcerer/wizard 2, druid 2', casting: '1 standard action', components: 'V, S', range: 'Personal', duration: '1 round/level' }, 'You fly.'),
  entry('cls', 'class', 'Sky Knight', { hd: 'd10', ranks: '4', bab: 'Full', fort: 'Good', ref: 'Poor', will: 'Poor', classSkills: 'Fly, Perception' }, 'A knight of the air.'),
  entry('cf1', 'classFeature', 'Wingborne', { level: 1, kind: 'Ex' }, 'You fly.', 'cls'),
  entry('cf2', 'classFeature', 'Skyfall', { level: 5, kind: 'Su' }, 'You fall well.', 'cls'),
  entry('arch', 'archetype', 'Cloud Lancer', {}, 'Lances.', 'cls'),
  entry('cf3', 'classFeature', 'Lance dive', { level: 3, kind: 'Ex', replaces: 'Skyfall', alters: 'Wingborne' }, 'Replaces skyfall.', 'arch'),
  entry('loose', 'classFeature', 'Loose feature', { kind: 'Ex' }, 'Belongs to nothing.'),
  entry('race', 'race', 'Aerin', { size: 'Medium', speed: '30 ft.', abilities: '+2 Dex, -2 Con', languages: 'Common, Auran' }, '**Wings:** Fly 30 ft.\nGlide: Slow falls.'),
  entry('rt', 'trait', 'Storm Eyes', { category: 'Race' }, 'See in rain.'),
  entry('ct', 'trait', 'Sky Born', { category: 'Regional', prereq: '' }, 'Plus one Fly.'),
  entry('item', 'item', 'Wind Lance', { category: 'Weapon', price: '8,000 gp' }, 'A lance.'),
  entry('camp', 'campaign', 'Primordia', { setting: 'Primordia' }, 'The campaign.'),
  entry('npc', 'npc', 'Kestrel', { role: 'Captain' }, 'An NPC.', 'camp'),
];

const pack = forgeToPack(entries, { id: 'test-forge', name: 'Test', revision: 3 });

// plain text
eq(plainText('See **bold** and *it* and [[A|b]] and [[C]].'), 'See bold and it and b and C.', 'markdown and links flatten');
eq(plainText('| a | b |\n|---|---|\n| 1 | 2 |'), 'a\tb\n1\t2', 'pipe tables become tab rows, rule dropped');

// the pack passes the sheet's own inspector
const verdict = inspectExtension(pack);
ok(verdict.ok, `inspector accepts the pack: ${verdict.error}`);
eq(verdict.warnings, [], 'no block dropped');
eq(pack.revision, 3, 'revision carried');
const norm = normalizeExtension(pack);

// disciplines
const disc = pack.provides.maneuvers.disciplines;
eq(disc.length, 1, 'one discipline');
eq(disc[0].entries.map((e) => [e.name, e.kind, e.type, e.level]), [['Aerial Impaler', 'maneuver', 'Strike', 1], ['Iron Wings', 'stance', 'Stance', 1]], 'maneuvers under it, stances marked');
eq(disc[0].entries[0].text, 'Deal +1d6 damage to a falling target.', 'maneuver text flattened');
ok('dc' in disc[0].entries[0] && 'save' in disc[0].entries[0], 'save and dc cells present');

// feats and spells land in the catalogues the sheet reads
setFeatCatalogue(pack.provides.feats);
const feat = featEntry('Sky Sentinel');
eq([feat.type, feat.prerequisites], ['Combat', 'Fly 3 ranks'], 'feat fields');
ok(feat.text.includes('Normal: Nothing.') && !feat.text.includes('Special'), 'feat normal appended, empty special omitted');
setSpellCatalogue(pack.provides.spells);
const spell = spellEntry('Gale Step');
eq([spell.school, spell.descriptor, spell.time], ['Transmutation', 'air', '1 standard action'], 'spell school, descriptor, time');
eq(spell.classes, [{ name: 'sorcerer/wizard', level: 2 }, { name: 'druid', level: 2 }], 'spell class list parsed from the level line');

// blocks
const block = (kind, name) => norm.blocks.find((b) => b.kind === kind && b.name === name);
const cls = block('class', 'Sky Knight');
eq([cls.hd, cls.bab, cls.goodFort, cls.goodRef, cls.skillRanks, cls.classSkills], [10, 1, true, false, 4, ['Fly', 'Perception']], 'class numbers');
eq(cls.features.map((x) => [x.level, x.name]), [[1, 'Wingborne'], [5, 'Skyfall']], 'class features by level');
eq(cls.archetypes, 'Cloud Lancer', 'archetype names on the class');
const arch = block('archetype', 'Cloud Lancer');
eq(arch.class, 'Sky Knight', 'archetype names its class');
eq(arch.features[0].replaces, ['skyfall'], 'archetype feature replaces, as the sheet keys it');
eq(arch.features[0].alters, ['wingborne'], 'archetype feature alters, kept apart from replaces');
ok(block('feature', 'Loose feature'), 'a loose class feature becomes a feature block');
const race = block('race', 'Aerin');
eq([race.size, race.speed, race.abilityMods, race.languages], ['Medium', 30, { dex: 2, con: -2 }, ['Common', 'Auran']], 'race numbers');
eq(race.traits, [{ name: 'Wings', text: 'Fly 30 ft.' }, { name: 'Glide', text: 'Slow falls.' }], 'race traits read off the body');
ok(block('trait', 'Storm Eyes'), 'a Race-category trait is a race trait block');
ok(!block('trait', 'Sky Born'), 'a character trait is not a race trait block');

// the rest is reference
setReferenceCatalogue(pack.provides.catalogues);
ok(referenceEntry('Sky Born', 'trait'), 'character trait in the trait catalogue');
eq(referenceEntry('Airborne').text, 'A condition.\n\na\tb\n1\t2', 'article text with its table');
eq(referenceEntry('Airborne').fields, [['Tags', 'Condition']], 'tags kept as a field');
eq(referenceEntry('Kestrel', 'npc').fields, [['Role', 'Captain'], ['Belongs to', 'Primordia']], 'npc fields and its campaign');
ok(referenceEntry('Wind Lance', 'item') && referenceEntry('Sky Doctrine', 'discipline'), 'items and discipline descriptions are reference entries');
ok(!referenceEntry('Aerial Impaler'), 'a maneuver under a discipline is not doubled into reference');

console.log(`forge-pack: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
