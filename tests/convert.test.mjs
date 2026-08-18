/** Holds the in-browser converter to what tools/convert.py produces.
 *
 *  The app can convert a workbook two ways -- Python on the GM's machine, and
 *  app/js/convert.js in a player's browser -- and two implementations of one
 *  format drift unless something makes them prove they agree. That is this
 *  file: it re-converts every fixture workbook with the JavaScript converter
 *  and compares the result, field for field, against the JSON the Python one
 *  wrote. A porting slip in either direction fails here.
 *
 *  Needs the private character fixtures (see tests/fixtures.mjs); without them
 *  it says so and exits 0.
 *
 *  Run: node tests/convert.test.mjs */
import { readFileSync } from 'node:fs';
import { CHARACTERS_DIR, characterPath, workbookPath, fixtureIds, requireFixtures } from './fixtures.mjs';
import { convertWorkbook, indexEntry, warningsFor, slug, blankDocument } from '../app/js/convert.js';
import { inspectDocument, SCHEMA_VERSION, Character } from '../app/js/model.js';
import { STANDARD_SKILLS } from '../app/js/rules.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

requireFixtures(['saburo'], 'convert.test');
const IDS = fixtureIds();

/**
 * Walk two documents together and report where they part company.
 *
 * Object key *order* is deliberately not compared: it carries no meaning in
 * JSON, and JavaScript reorders integer-like keys (the point-buy table) no
 * matter what order they went in. Everything else -- types, array order,
 * null-versus-missing -- is compared exactly.
 */
function differences(a, b, path = '', out = []) {
  if (out.length > 12) return out;                 // enough to diagnose with
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (kind(a) !== kind(b)) {
    out.push(`${path || '/'}: ${kind(a)} ${JSON.stringify(a)} vs ${kind(b)} ${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      differences(a[i], b[i], `${path}[${i}]`, out);
    }
    return out;
  }
  if (a !== null && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${path}/${k}: missing on the left`); continue; }
      if (!(k in b)) { out.push(`${path}/${k}: missing on the right`); continue; }
      differences(a[k], b[k], `${path}/${k}`, out);
    }
    return out;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

console.log('converter parity -- the browser must transcribe exactly as convert.py does');
const converted = new Map();
for (const id of IDS) {
  const expected = JSON.parse(readFileSync(characterPath(id), 'utf8'));
  const actual = await convertWorkbook(readFileSync(workbookPath(id)), {
    id,
    title: expected.source.title,
    fileId: expected.source.fileId,
    // The one field that cannot match: it records when the conversion ran.
    convertedAt: expected.source.convertedAt,
  });
  converted.set(id, actual);

  const diff = differences(actual, expected);
  if (diff.length) {
    fail++;
    console.log(`  FAIL ${id}: ${diff.length > 12 ? 'more than 12' : diff.length} differences`);
    for (const d of diff) console.log(`         ${d}`);
  } else {
    pass++;
  }
}

console.log('\nthe converted document is one the app will accept');
for (const id of IDS) {
  const doc = converted.get(id);
  const verdict = inspectDocument(doc);
  check(`${id} passes the import gate`, verdict.ok, true);
  check(`${id} declares the current schema`, doc.schemaVersion, SCHEMA_VERSION);
  check(`${id} converts without warnings`, warningsFor(doc), []);
}

console.log('\nthe index row matches the one already published');
{
  const published = JSON.parse(readFileSync(`${CHARACTERS_DIR}/index.json`, 'utf8')).characters;
  for (const row of published) {
    check(`${row.id} index row`, indexEntry(row.id, converted.get(row.id)), row);
  }
}

console.log('\nids are slugged the way the app slugs them');
{
  check('spaces and case', slug('Dokei Saburo'), 'dokei_saburo');
  check('punctuation collapses', slug('Nico "The Knife" Marcone!'), 'nico_the_knife_marcone');
  check('leading and trailing separators go', slug('  --Wayfinder--  '), 'wayfinder');
  check('a name with nothing usable still yields an id', slug('!!!'), 'x');
  check('an empty name still yields an id', slug(''), 'x');
}

console.log('\na workbook off the template converts thin rather than failing, and says so');
{
  // What a player's non-template spreadsheet produces: the extractors return
  // empty structures, and the warnings are the only thing that says why the
  // sheet looks bare.
  const thin = JSON.parse(JSON.stringify(converted.get(IDS[0])));
  thin.identity.name = null;
  thin.identity.level = 0;
  thin.skills = [];
  thin.classes = [];
  thin.named = {};
  thin.planner = [];
  const w = warningsFor(thin);
  check('every gap is reported', w.length, 6);
  check('the name gap points at the tab', /Character Info/.test(w[0]), true);
  check('and one of them names the template', w.some((x) => x.includes('campaign template')), true);

  // A Planner with rows but no levels is the subtle case: everything else is
  // present, so only the Progression tab would come up empty.
  const noLevels = JSON.parse(JSON.stringify(converted.get(IDS[0])));
  noLevels.planner = [{ 'Some Column': 'x' }];
  check('an empty Planner is called out on its own',
    warningsFor(noLevels), ['Planner is empty, so the Progression tab will start blank']);
}

console.log('\na workbook that is not a character sheet fails clearly');
{
  const notAZip = new Uint8Array(200);            // all zeroes: no ZIP directory
  let message = null;
  try {
    await convertWorkbook(notAZip, { id: 'junk' });
  } catch (err) {
    message = err.message;
  }
  check('a non-workbook is refused', /not a \.xlsx/.test(message ?? ''), true);
}

console.log('a blank character is the thinnest converted document there is');
{
  const doc = blankDocument({ name: 'Kaito', level: 3, player: 'Mel', createdAt: '2026-08-17T00:00:00' });
  // Same top-level shape as a converted workbook, so nothing downstream has
  // to know it started from nothing.
  const converted = JSON.parse(readFileSync(characterPath('saburo'), 'utf8'));
  check('same keys as a converted document', Object.keys(doc).sort(), Object.keys(converted).sort());
  check('schema, id, name, level, player', [doc.schemaVersion, doc.id, doc.identity.name, doc.identity.level, doc.identity.player],
    [SCHEMA_VERSION, 'kaito', 'Kaito', 3, 'Mel']);
  check('marked as started from a blank sheet', doc.source.kind, 'blank');
  check('every structured section is present, not null',
    ['statsBuild', 'progressionPicks', 'skillBudget', 'mythic', 'equipment'].map((k) => doc[k] !== null && doc[k] !== undefined)
      .concat([!!doc.training.combat, !!doc.training.magic]),
    [true, true, true, true, true, true, true]);
  check('no raw tabs at all', Object.keys(doc.extraTabs), []);
  check('the standard skill list, untouched', [doc.skills.length, doc.skills.every((s) => s.totalRanks === 0 && !s.classSkill)], [STANDARD_SKILLS.length, true]);
  check('bought at 10 across the board', Object.values(doc.statsBuild).map((b) => b.pointBuy), [10, 10, 10, 10, 10, 10]);
  check('the usual abilities behind each number',
    [doc.hp.ability, doc.hp.initAbility, doc.saves.fortitude.stat1, doc.saves.reflex.stat1, doc.saves.will.stat1,
      doc.defenses.acStat1, doc.attack.modes.melee.stat1, doc.attack.modes.ranged.stat1],
    ['Con', 'Dex', 'Con', 'Dex', 'Wis', 'Dex', 'Str', 'Dex']);
  const verdict = inspectDocument(doc);
  check('passes the import gate', [verdict.ok, verdict.summary?.name, verdict.summary?.level], [true, 'Kaito', 3]);
  check('a nameless one gets a name', blankDocument().identity.name, 'New Character');
  check('level is clamped to the campaign floor of 3, and to 20', [blankDocument({ level: 0 }).identity.level, blankDocument().identity.level, blankDocument({ level: 99 }).identity.level], [3, 3, 20]);
  check('6 hit points a level to start, two perk slots, three race-trait slots', [doc.hp.total, doc.identity.specialtyPerks, doc.raceTraits.length], [18, ['', ''], 3]);
  // `warningsFor` is for workbooks; on a blank it lists exactly the three
  // things a template has that nothing has yet -- so the page does not ask it.
  check('the workbook warnings on it are the three expected absences',
    warningsFor(doc).map((w) => w.split(/ [-(]/)[0]), ['no classes found', 'no defined names', 'Planner is empty, so the Progression tab will start blank']);

  // What the model makes of it: 10s, zero offsets, and every number where a
  // fresh sheet should have it.
  const c = new Character(doc);
  check('scores are 10, modifiers 0', [c.data.abilities.str.score, c.data.abilities.cha.mod], [10, 0]);
  check('AC 10 with no offset hiding in it',
    [c.data.defenses.ac, c.data.defenses.touch, c.data.defenses.flatFooted, c.data.defenses.cmd, c.offsets['defenses.ac'] || 0],
    [10, 10, 10, 10, 0]);
  check('saves at +1 (ABP resistance at 3rd), attacks and initiative at +0', [c.data.saves.fortitude.total, c.data.attack.totalMelee, c.data.hp.initiative], [1, 0, 0]);
  check('nothing reads as changed from source', c.diffFromSource(), []);
  check('the ABP defence bonuses follow the level: +1 resistance at 3rd, nothing else yet',
    [c.data.saves.fortitude.bonuses.abpResistance, c.data.defenses.acBonuses.abpDeflection, c.data.defenses.acBonuses.abpNatural, c.data.saves.fortitude.total], [1, 0, 0, 1]);
  c.set('identity.level', 18);
  check('and at 18th they are +5 across the board', [c.data.saves.will.bonuses.abpResistance, c.data.defenses.acBonuses.abpDeflection, c.data.defenses.acBonuses.abpNatural], [5, 5, 5]);
  c.set('saves.will.bonuses.resistance', 3);
  check('a typed resistance bonus stacks with ABP only up to +5', c.data.saves.will.total, 5);
  c.set('saves.will.bonuses.resistance', 7);
  check('past the cap on its own, the typed bonus stands alone', c.data.saves.will.total, 7);
  c.set('saves.will.bonuses.resistance', 0);
  c.set('defenses.acBonuses.enhancedNatural', 2);
  check('the same for toughening and enhanced natural armour', [c.data.defenses.ac, c.data.defenses.touch], [10 + 5 + 5, 10 + 5]);
  c.set('defenses.acBonuses.enhancedNatural', 0);
  c.set('identity.level', 3);
  check('the companions are there and empty', [!!c.data.familiar?.calc, !!c.data.eidolon?.calc, c.data.familiar.calc.level], [true, true, 3]);
  // And it plays: a point of Dex moves AC, Reflex and initiative; a class on
  // the tracks moves the skill budget; a rank moves a skill.
  c.setBuild('dex', 'pointBuy', 14);
  check('Dex 14 moves AC, Reflex and initiative', [c.data.defenses.ac, c.data.saves.reflex.total, c.data.hp.initiative], [12, 3, 2]);
  c.listAdd('classes', {
    name: 'Fighter', hd: 10, bab: 1, babOverride: null, goodFort: true, goodRef: false, goodWill: false,
    skillRanks: 2, archetypes: null, levelsOverride: null,
  });
  for (let i = 0; i < 3; i++) c.setProgressionClass(i + 1, 0, 'Fighter');
  check('three Fighter levels give a Fort base of 3 and 6 skill points', [c.data.saves.fortitude.base, c.data.skillBudget.available], [3, 6]);
  const acro = c.data.skills.findIndex((s) => s.name === 'Acrobatics');
  c.setItem('skills', acro, 'rankSources.bought', 2);
  c.setItem('skills', acro, 'classSkill', true);
  check('two ranks in a class skill with Dex 14 is +7', c.data.skills[acro].bonus, 7);
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('and it round-trips through export', [back.data.skills[acro].bonus, back.data.defenses.ac, back.data.identity.name], [7, 12, 'Kaito']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
