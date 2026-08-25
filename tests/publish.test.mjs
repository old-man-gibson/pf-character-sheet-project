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

if (!hasFixtures()) {
  console.log('publish: skipped -- no roster to read.');
  process.exit(0);
}

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

/** Whichever character in the roster leans hardest on pack content. */
const richest = fixtureIds()
  .map((id) => {
    const doc = new Character(loadCharacter(id)).toJSON();
    const { report } = publishDocument(doc);
    return { id, doc, weight: report.carried };
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

/*  A discipline gives up its name and the maneuvers this character listed --
 *  never its catalogue. */
for (const d of published.maneuvers?.disciplines || []) {
  const listed = new Set([...(d.known || []), ...(d.custom || [])]);
  check(`${d.name} carries only what it listed`,
    Object.keys(d.notes || {}).filter((n) => !listed.has(n)), []);
}

/*  Catalogue slices the sheet keeps to fill its pickers are not about this
 *  character, and a published sheet has no pickers. */
check('what the sheet only offers is dropped',
  published.cardcasting ? published.cardcasting.manipulationsAvailable : null, null);

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
