/** Tests what leaves the browser when a character is published.
 *
 *  The suite comes in two halves, because the claim worth making can only be
 *  made by something that does not have the packs. The first half registers
 *  the bundled packs and publishes. The second writes the two documents out
 *  and reads them back in a *child process* with nothing registered at all,
 *  which is the only honest way to ask the question: table registration is
 *  module-global, so there is no un-registering inside one process, and a fake
 *  would be testing the fake.
 *
 *  Run: node tests/publish.test.mjs */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Character } from '../app/js/model.js';
import * as model from '../app/js/model.js';
import { mergeTables, registerTables } from '../app/js/extensions.js';
import { describePublish, publishDocument } from '../app/js/publish.js';
import { blankDocument } from '../app/js/convert.js';
import { fixtureIds, hasFixtures, loadCharacter } from './fixtures.mjs';

let pass = 0;
let fail = 0;

const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/** Every pack a deployment carries, from either folder the app reads. */
function bundledPacks() {
  const packs = [];
  for (const dir of [join('data', 'extensions'), join('private', 'extensions')]) {
    const indexPath = join(dir, 'index.json');
    if (!existsSync(indexPath)) continue;
    for (const e of JSON.parse(readFileSync(indexPath, 'utf8')).extensions || []) {
      const file = join(dir, e.file);
      if (existsSync(file)) packs.push(JSON.parse(readFileSync(file, 'utf8')));
    }
  }
  return packs;
}

registerTables(mergeTables(bundledPacks()), model);

/*  Feats, spells and powers travel as the pack's words beside the player's
 *  own, never in their place, and a sheet with no pack reads them there. A
 *  small catalogue of our own, so this runs whatever the roster holds; the
 *  bundled tables are registered again after it. */
{
  model.setFeatCatalogue({ feats: [{ name: 'Power Attack', type: 'Combat', text: 'Trade attack for damage.', source: 'Core' }] });
  model.setSpellCatalogue({ spells: [{ name: 'Shield', school: 'abjuration', text: 'An invisible disc.', source: 'Core' }] });
  model.setPowerCatalogue({ powers: [{ name: 'Mind Thrust', discipline: 'telepathy', text: 'Deal damage to a mind.', source: 'Psionics' }] });
  const c = new Character(blankDocument({ name: 'Cited' }));
  c.data.featGroups = [{ name: 'Feats', entries: [{ name: 'Power Attack', detail: '', note: 'mine' }, { name: 'Homebrew Feat', detail: '', note: '' }] }];
  c.data.vancian.prepared = [{ prepUsed: '', classLevel: '', name: 'Shield', note: '' }];
  c.data.psionics.classes = [{ name: 'Psion', stat: 'Int', stat2: '', curveTotal: 343, manifesterLevelOverride: 1, powers: [{ name: 'Mind Thrust', level: 1, note: '' }] }];
  const { doc: out, report: r } = publishDocument(c.toJSON());
  const feat = out.featGroups[0].entries[0];
  check('a feat carries the pack’s words as cited, and the player’s note is untouched',
    [feat.cited?.text, feat.cited?.source, feat.note], ['Trade attack for damage.', 'Core', 'mine']);
  check('so do a prepared spell and a power',
    [out.vancian.prepared[0].cited?.text, out.psionics.classes[0].powers[0].cited?.text], ['An invisible disc.', 'Deal damage to a mind.']);
  check('each is counted under its kind, and the unpacked one is named',
    [r.carriedBy.feat, r.carriedBy.spell, r.carriedBy.power, r.unknown], [1, 1, 1, ['feat: Homebrew Feat']]);
  // No pack at all now: what the sheet reads is the cited text.
  model.setFeatCatalogue({ feats: [] });
  const reopened = new Character(out).toJSON();
  const back = reopened.featGroups[0].entries[0];
  check('with no pack, the published feat still shows its text, and says where it came from',
    [model.featDetails(back).known, model.featDetails(back).text, model.featDetails(back).cited], [true, 'Trade attack for damage.', true]);
  check('and an unpublished one shows nothing, as before', model.featDetails({ name: 'Power Attack' }).known, false);
  model.setFeatCatalogue({ feats: [{ name: 'Power Attack', type: 'Combat', text: 'Corrected since.', source: 'Core' }] });
  check('with the pack back, the pack answers rather than the copy',
    [model.featDetails(back).cited, model.featDetails(back).text], [false, 'Corrected since.']);
  registerTables(mergeTables(bundledPacks()), model);
}

if (!hasFixtures()) {
  console.log('publish: skipped -- no roster to read.');
  process.exit(0);
}

/** Whichever character in the roster leans hardest on pack content. */
const richest = fixtureIds()
  .map((id) => {
    const doc = new Character(loadCharacter(id)).toJSON();
    const { report } = publishDocument(doc);
    // Veils and maneuvers, which the stranger below reads back.
    const weight = (report.carriedBy.veil || 0) + (report.carriedBy.maneuver || 0)
      + report.outline.filter((o) => /^(veil|maneuver):/.test(o)).length;
    return { id, doc, weight };
  })
  .sort((a, b) => b.weight - a.weight)[0];

console.log(`publish: checking against ${richest.id}`);

/* ---------------- the transform ---------------- */

const before = JSON.stringify(richest.doc);
const { doc: published, report } = publishDocument(richest.doc);

check('publishing never touches the document it was given', JSON.stringify(richest.doc), before);
check('a published document is still a character the model accepts',
  new Character(published).toJSON().identity.name, richest.doc.identity.name);
check('publishing twice changes nothing the first pass did not',
  JSON.stringify(publishDocument(published).doc), JSON.stringify(published));
check('the report says something a button could print', /carrying/.test(describePublish(report)), true);

/*  Every entry the character references lands in exactly one bucket. If the
 *  four do not add up to what was referenced, something travelled unreported
 *  or was reported twice -- and the whole point of the report is that an
 *  author can trust it about a sheet only a stranger can judge. */
const named = (list) => (list || []).filter((r) => String(r?.name ?? '').trim()).length;
const g = richest.doc.grantedFeats || {};
const referenced = [...(richest.doc.akashic?.slots || []), ...(richest.doc.akashic?.kheshig || [])]
  .flatMap((s) => s.veils || []).filter((v) => v?.name).length
  + (richest.doc.maneuvers?.disciplines || [])
    .reduce((n, d) => n + (d.known || []).length + (d.custom || []).length, 0)
  + (richest.doc.featGroups || []).reduce((n, grp) => n + named(grp.entries), 0)
  + named([g.drawback, g.specialty, ...(g.others || [])])
  + named(richest.doc.vancian?.prepared)
  + (richest.doc.psionics?.classes || []).reduce((n, c) => n + named(c.powers), 0);
check('every referenced entry is accounted for exactly once',
  report.carried + report.outline.length + report.blank.length + report.unknown.length,
  referenced);

/*  "Carried" has to mean a reader can read it. A maneuver whose pack gave only
 *  its type is an outline, not content: the bundled Path of War catalogue is
 *  deliberately that way, and counting it as carried is how an author sends
 *  out a sheet of names with badges beside them believing it readable. */
for (const d of published.maneuvers?.disciplines || []) {
  const outlined = report.outline
    .filter((o) => o.startsWith(`maneuver: ${d.name} / `))
    .map((o) => o.slice(`maneuver: ${d.name} / `.length));
  check(`${d.name}: nothing counted as an outline has rules text`,
    outlined.filter((n) => String(d.notes?.[n]?.text ?? '').trim()), []);
}

/*  A discipline gives up its name and the maneuvers this character listed --
 *  never its catalogue. */
for (const d of published.maneuvers?.disciplines || []) {
  const listed = new Set([...(d.known || []), ...(d.custom || [])]);
  check(`${d.name} carries only what it listed`,
    Object.keys(d.notes || {}).filter((n) => !listed.has(n)), []);
}

/*  An encounter in progress is not the character, so the card table stays
 *  behind. The player's own count of manipulations is the character, and
 *  travels: dropping it showed a reader the table's number, not the author's. */
{
  const withCount = JSON.parse(JSON.stringify(richest.doc));
  withCount.cardcasting = {
    ...(withCount.cardcasting || {}), manipulationsAvailable: 'int.mod + 7', table: { active: true, round: 3 },
  };
  const out = publishDocument(withCount).doc;
  check("the player's own count of manipulations travels", out.cardcasting?.manipulationsAvailable, 'int.mod + 7');
  check('the encounter in progress does not', out.cardcasting?.table ?? null, null);
}

/* ---------------- what a stranger sees ---------------- */

/*  The half below needs a character that actually references a pack, and the
 *  public fixture references none -- it is invented rather than converted, and
 *  the repository ships no catalogue for it to draw on. So in a fresh clone
 *  (and in CI) this stands down and says so, exactly as the roster suites do
 *  for checks written against a named character.
 *
 *  This is a real coverage gap and not a comfortable one: materializing pack
 *  text is the whole claim of publish.js, and CI never exercises it. Closing
 *  it means a small test-only pack -- one discipline, one veil -- committed
 *  for the fixture to reference. */
if (richest.weight === 0) {
  console.log('\npublish: no character in this roster references a pack, so what a stranger\n'
    + '  sees is not checked here. It needs a roster with veils or maneuvers on it.');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const APP = pathToFileURL(resolve('app', 'js')).href;
const STRANGER = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* Nothing registered: this process is a browser that has none of the packs. */
const { Character } = await import('${APP}/model.js');
const A = await import('${APP}/model/subsystems/akashic.js');
const N = await import('${APP}/model/subsystems/maneuvers.js');
const dir = process.argv[2];
const look = (file) => {
  const doc = new Character(JSON.parse(readFileSync(join(dir, file), 'utf8'))).toJSON();
  const veils = (doc.akashic?.slots || []).flatMap((s) => s.veils || []).filter((v) => v?.name);
  const disc = (doc.maneuvers?.disciplines || []).find((d) => (d.known || []).length);
  return {
    veil: veils.length ? A.veilDetails(veils[0]).desc : '',
    veilCount: veils.length,
    maneuver: disc ? N.maneuverDetails(disc, disc.known[0]).type : '',
  };
};
process.stdout.write(JSON.stringify({ plain: look('plain.json'), published: look('published.json') }));
`;

const dir = mkdtempSync(join(tmpdir(), 'publish-'));
writeFileSync(join(dir, 'plain.json'), JSON.stringify(richest.doc));
writeFileSync(join(dir, 'published.json'), JSON.stringify(published));
writeFileSync(join(dir, 'stranger.mjs'), STRANGER);

const seen = JSON.parse(execFileSync(process.execPath, [join(dir, 'stranger.mjs'), dir], {
  encoding: 'utf8',
}));

check('without the packs an unpublished character shows a stranger nothing',
  [seen.plain.veil, seen.plain.maneuver], ['', '']);
check('the published one still carries its veil text', seen.published.veil.length > 0, true);
check('and what its maneuvers are', seen.published.maneuver.length > 0, true);
check('a stranger is shown no more entries than the author had',
  seen.published.veilCount, seen.plain.veilCount);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
