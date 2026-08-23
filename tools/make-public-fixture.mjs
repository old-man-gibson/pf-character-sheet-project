/**
 * Build the public character fixture the test suites fall back to.
 *
 * The five real characters live in `private/` and belong to their players, so a
 * fresh clone -- and every CI run -- has no roster at all. The suites written
 * against a roster (see tests/fixtures.mjs) would rather check something than
 * nothing, so this writes one character they can all read: invented, not
 * converted, and carrying enough of the sheet to be worth checking.
 *
 * It is generated rather than hand-written because a fixture has to satisfy the
 * invariant every one of those suites leans on -- that the numbers stored on a
 * document are the numbers the model computes from it, so a freshly loaded
 * character reports no diff from its source. Hand-editing JSON breaks that on
 * the first ability score you touch. Here the character is instead *built
 * through the model*: the plain sheet fields are filled in, the model works out
 * everything that follows, and `toJSON()` writes back what it worked out.
 * Re-run this whenever the schema moves and the fixture follows it.
 *
 * Usage: node tools/make-public-fixture.mjs
 *        node tools/make-public-fixture.mjs --check   (fail if the file is stale)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { blankDocument, indexEntry } from '../app/js/convert.js';
import {
  Character, setManeuverCatalogue, setVancianTables, setPsionicTables,
  setCardcastingTables, setCookingTables,
} from '../app/js/model.js';
import { mergeTables, registerTables } from '../app/js/extensions.js';

const OUT_DIR = join('tests', 'fixtures', 'public', 'characters');
const ID = 'vesna';
// Pinned so that two runs write the same bytes: the document records when it
// was created, and so does every tracker added to it.
const CREATED_AT = '2026-01-01T00:00:00';
const CREATED_AT_UTC = `${CREATED_AT}.000Z`;

// The shared tables have to be registered before any character is built, exactly
// as the app does on load: the casting and manifesting blocks below are read
// against them, and without them the fixture would bake in empty ones.
const index = JSON.parse(readFileSync(join('data', 'extensions', 'index.json'), 'utf8'));
const packs = index.extensions
  .map((e) => JSON.parse(readFileSync(join('data', 'extensions', e.file), 'utf8')));
registerTables(mergeTables(packs), {
  setManeuverCatalogue, setVancianTables, setPsionicTables, setCardcastingTables, setCookingTables,
});

/**
 * A twelfth-level gestalt Wizard/Psion, invented for this repository.
 *
 * The build is deliberately unremarkable -- a caster on one side, a manifester
 * on the other -- because its job is coverage rather than cleverness: two
 * classes so the gestalt BAB and save tables have something to choose between,
 * a spread of scores that leaves no ability modifier at zero, ranks in trained
 * and untrained skills alike, worn armour so the Max Dex cap is live, trackers
 * whose maxima are formulas rather than numbers, and one block from each of the
 * two subsystems that read a shared table. Anything the suites sweep across a
 * roster finds something here to sweep.
 *
 * Everything set here is a *sheet* value -- what a player typed, or what the
 * workbook carried across -- and almost all of it goes in through the model's
 * own setters rather than onto the document. That is not ceremony: fields like
 * a skill's rank sources and a class's gestalt levels are worked out by the
 * model from what is stored, so writing them by hand produces a document that
 * looks right and computes to nothing.
 *
 * The exceptions are below: worn armour and the sheet's resource rows are
 * plain imported data with no setter behind them, so they are placed on the
 * document before the model ever sees it.
 */
function importedValues(doc) {
  // Worn armour and a shield, so `armorParts` has pieces to add up and the Max
  // Dex cap actually bites: Dex clears the cap once the picks land, so the
  // MIN(maxDex, stat) branch is the one being exercised, not the other.
  doc.equipment.armor = {
    kind: 'Armor',
    name: 'Mithral Chain Shirt',
    acBonus: 4,
    maxDex: 4,
    acp: 0,
    type: 'Light',
    ghostTouch: false,
    spellFailure: 10,
    others: [],
    weight: 12.5,
    cost: 1100,
    active: true,
  };
  doc.equipment.shields = [{
    kind: 'Shield 1',
    name: 'Darkwood Buckler',
    acBonus: 1,
    maxDex: null,
    acp: 0,
    type: 'Light',
    ghostTouch: false,
    spellFailure: 5,
    others: [],
    weight: 2.5,
    cost: 205,
    active: false,          // carried, not strapped on: the inactive branch
  }];

  // The sheet's own resource rows -- what a converted workbook would carry, and
  // what seeds the tracker list before the player adds any of their own.
  doc.resources = [
    { name: 'Arcane Bond', uses: 0, total: 1, refresh: 'Daily' },
    { name: 'Psionic Focus', uses: 0, total: 1, refresh: 'per encounter' },
  ];

  return doc;
}

/** Everything the model has a setter for, set the way the app sets it. */
function playerValues(c) {
  // Who she is. Nothing here is derived; it is the top of the sheet.
  for (const [path, value] of Object.entries({
    'identity.race': 'Human',
    'identity.size': 'Medium',
    'identity.gender': 'Female',
    'identity.age': 34,
    'identity.alignment': 'Neutral Good',
    'identity.deity': 'None',
    'identity.specialty': 'Scholar',
    'identity.color': '#6ea8fe',
    /*
     * Hit points as the player rolled and recorded them -- which is why they
     * are pinned rather than left to the class table. Twelve levels of d6
     * taken at maximum would be 120 with her Constitution, and she rolled 78;
     * a character who cannot reach her own total from her hit dice is the
     * case worth having in the fixture, because it is the one every imported
     * sheet is in until its player decides otherwise.
     */
    'hp.totalOverride': 78,
    'hp.current': 78,
    // The ability the total counts, which the class table needs in order to
    // work out what the alternative would have been.
    'hp.ability': 'Con',
  })) c.set(path, value);

  // Two classes, one per gestalt side: a d6 caster and a d6 manifester, both on
  // the half-BAB track, differing in their good saves so the model has a real
  // choice to make rather than one class it can only echo.
  c.listAdd('classes', {
    name: 'Wizard', hd: 6, bab: 0.5, goodFort: false, goodRef: false, goodWill: true,
    skillRanks: 2, archetypes: '', levelsOverride: null, systems: [],
  });
  c.listAdd('classes', {
    name: 'Psion', hd: 6, bab: 0.5, goodFort: false, goodRef: true, goodWill: true,
    skillRanks: 2, archetypes: '', levelsOverride: null, systems: [],
  });

  // The campaign's own budget -- every character in it is built on 30 points --
  // spent so that no ability modifier ends up at zero, because a fixture whose
  // modifiers are 0 lets an arithmetic slip straight through a multiplication.
  const SPREAD = { str: 12, dex: 15, con: 14, int: 17, wis: 13, cha: 10 };
  for (const [ability, score] of Object.entries(SPREAD)) c.setBuild(ability, 'pointBuy', score);
  c.setBuild('int', 'race', 2);

  // The progression ladder, planned to 20th the way the template does it: the
  // model counts only the rows at or below this character's level, which is the
  // behaviour worth having in a fixture. Levels 11 and 12 follow the picks at
  // 6 and 7 rather than offering their own, and `setPick` fills them in.
  // No two ladders are pointed at the same ability more than they have to be:
  // spread picks exercise more of the stacking rules than five stacked on Int,
  // and they keep the resulting scores somewhere a reader recognises.
  for (const [level, ability] of [[4, 'Int'], [8, 'Int'], [12, 'Int'], [16, 'Dex'], [20, 'Int']]) {
    c.setPick('level4', level, null, ability);
  }
  c.setPick('abp', 6, 'mental', 'Int');
  c.setPick('abp', 7, 'physical', 'Dex');
  // The optional array, one row per level that has slots, each slot on the
  // ladder that level actually declares -- a null where that level has none.
  for (const [level, slots] of [
    [8, ['Con', 'Dex', 'Wis', 'Cha']],
    [12, ['Con', 'Str', null, 'Dex']],
    [16, ['Con', null, 'Wis', 'Cha']],
  ]) {
    slots.forEach((ability, slot) => { if (ability) c.setPick('array', level, slot, ability); });
  }

  // Ranks, on the template's own skill names. Class skills first so the +3
  // lands, and trained-only skills among them so that path is live too.
  const RANKS = {
    Spellcraft: 12, 'Kn. (arcana)': 12, 'Kn. (psionics)': 8, Perception: 12,
    'Sense Motive': 8, Diplomacy: 6, Stealth: 4, Acrobatics: 2,
  };
  for (const [name, ranks] of Object.entries(RANKS)) {
    const i = c.data.skills.findIndex((s) => s.name === name);
    if (i < 0) throw new Error(`the template no longer has a "${name}" skill row`);
    c.setItem('skills', i, 'classSkill', true);
    c.setItem('skills', i, 'rankSources.bought', ranks);
  }

  c.listAdd('equipment.weapons', {
    name: 'Quarterstaff', attackType: 'Melee', sheetAttack: 0, dice: '1d6',
    damageAbility: 'Str', abilityMult: 1, miscDamage: 0, sheetTotalDamage: 0,
    critRange: 1, critMult: 2, bonusCritDamage: 0, damageType: 'B',
    groups: ['Monk', null, null], miscAttack: 0, special: '', ammunition: null,
    size: 'Medium', range: null, enhancement: 1, familiarity: 'Simple',
    handedness: 'Two-Handed', weight: 4, price: 2000,
  });
  c.listAdd('equipment.weapons', {
    name: 'Light Crossbow', attackType: 'Ranged', sheetAttack: 0, dice: '1d8',
    damageAbility: '', abilityMult: 0, miscDamage: 0, sheetTotalDamage: 0,
    critRange: 2, critMult: 2, bonusCritDamage: 0, damageType: 'P',
    groups: ['Crossbows', null, null], miscAttack: 0,
    special: 'Reloads as a move action', ammunition: 20,
    size: 'Medium', range: 80, enhancement: 0, familiarity: 'Simple',
    handedness: 'Two-Handed', weight: 4, price: 35,
  });

  // Trackers, with formulas rather than constants for their maxima -- the point
  // of a tracker here is that reloading the fixture re-evaluates them.
  c.addTracker({ name: 'Arcane Reservoir', maxFormula: 'floor(level / 2) + int.mod', refresh: 'Daily' });
  c.addTracker({ name: 'Focus Points', maxFormula: '3', refresh: 'per encounter' });
  // A tracker stamps itself with the moment it was added, which is the one
  // thing in this file that would differ between two runs. Pin it, as the
  // document's own createdAt is pinned, so the fixture is reproducible.
  for (const t of c.trackers) if (t.source === 'player') t.createdAt = CREATED_AT_UTC;

  // One block from each shared-table subsystem. Both read their progression
  // from the tables registered above, so these exercise the lookup rather than
  // freezing a column of cached numbers into the fixture.
  c.listAdd('vancian.classes', {
    name: 'Wizard', slotType: '', stat: 'Int', stat2: '', types: '',
    casterLevelOverride: null, concentration: 0,
    spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
  });
  c.listAdd('psionics.classes', {
    name: 'Psion', stat: 'Int', stat2: '', curveTotal: null,
    manifesterLevelOverride: null, powers: [],
  });
  return c;
}

/**
 * Save, reload and save again until the bytes stop moving.
 *
 * A first save is not yet stable: a block the player never touched -- the
 * casting tab, say -- only joins the document when the model writes it, so the
 * *order* of the keys shifts between the first save and the second even though
 * no value does. JSON does not care, but a fixture that reshuffles itself on
 * every run would churn the history, so the document is settled here and the
 * settled form is what gets written.
 *
 * Two things are asserted on the way. The document must reload with no diff
 * from its source -- the invariant every roster suite leans on -- and it must
 * reach that fixed point quickly; a character that never settles is a bug in
 * the model, and this is a better place to find out than CI.
 */
function settle(c) {
  let current = JSON.parse(JSON.stringify(c.toJSON()));
  for (let pass = 0; pass < 5; pass++) {
    const reloaded = new Character(JSON.parse(JSON.stringify(current)));
    const diff = reloaded.diffFromSource();
    if (diff.length) {
      console.error('the fixture does not reload cleanly -- the model moves these:');
      for (const d of diff) console.error(`  ${d.label}: stored ${d.was}, computed ${d.now}`);
      process.exit(1);
    }
    const next = JSON.parse(JSON.stringify(reloaded.toJSON()));
    if (JSON.stringify(next) === JSON.stringify(current)) return current;
    current = next;
  }
  console.error('the fixture never settles: five saves in a row all differed.');
  for (const line of driftBetween(current, JSON.parse(JSON.stringify(new Character(current).toJSON())))) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

/** Where two saves of the same character part company, for the message above. */
function driftBetween(a, b, path = '', out = []) {
  if (out.length > 15 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      driftBetween(a[k], b[k], `${path}/${k}`, out);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return out;
}

/**
 * Copy each built ability total onto the sheet total it is checked against.
 *
 * `sheetTotal` is the number the workbook itself had in the cell -- the thing
 * the model reconciles its own arithmetic against -- and a blank document
 * starts every one of them at the template's 10. A converted character carries
 * the total its build actually comes to, so the fixture does too; leaving them
 * at 10 would make it the one character on which the build disagrees with its
 * own sheet.
 */
function reconcileSheetTotals(c) {
  for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    c.data.statsBuild[ability].sheetTotal = c.data.statsBuild[ability].resolved.total;
  }
  return c;
}

// `createdAt` is pinned so that re-running this writes a byte-identical file
// and the fixture does not churn in the history for no reason.
const built = importedValues(blankDocument({
  id: ID,
  name: 'Vesna Ashgrove',
  level: 12,
  player: 'Public Fixture',
  createdAt: CREATED_AT,
}));
const character = settle(reconcileSheetTotals(playerValues(new Character(built))));
const roster = { characters: [indexEntry(ID, character)] };

const files = [
  [join(OUT_DIR, 'index.json'), `${JSON.stringify(roster, null, 1)}\n`],
  [join(OUT_DIR, `${ID}.json`), `${JSON.stringify(character, null, 1)}\n`],
];

if (process.argv.includes('--check')) {
  const stale = files.filter(([path, body]) => {
    try { return readFileSync(path, 'utf8') !== body; } catch { return true; }
  });
  if (stale.length) {
    console.error(`public fixture is stale: ${stale.map(([p]) => p).join(', ')}`);
    console.error('  regenerate it with: node tools/make-public-fixture.mjs');
    process.exit(1);
  }
  console.log('public fixture is up to date.');
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [path, body] of files) writeFileSync(path, body);
  console.log(`wrote ${files.map(([p]) => p).join(', ')}`);
}
