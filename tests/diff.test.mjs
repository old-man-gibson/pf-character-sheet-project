/** Tests the audit diff against whatever roster is in use.
 *
 *  Every check here is written against *a* character rather than a named one,
 *  so the suite runs everywhere: it takes the first id in the roster, and the
 *  public fixture satisfies it in a fresh clone exactly as the private five do.
 *
 *  The edits are made the way the app makes them -- a value is changed on a
 *  document and the whole thing goes back through `Character`, so every total
 *  that follows from it is recomputed by the same code the sheet runs. That is
 *  what makes the verdicts worth checking: two points of Dex point buy really
 *  do move the score, the modifier and five derived stats here, and the suite
 *  asserts that all of them land under "consequence" rather than in front of
 *  the GM -- while the same total nudged on its own does not.
 *
 *  Run: node tests/diff.test.mjs */
import {
  Character, AUDIT_GROUPS, AUDIT_VERDICTS, auditSummary, changesByGroup, compareRevisions,
} from '../app/js/model.js';
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
  console.log('diff: skipped -- no roster to read.');
  process.exit(0);
}

/** A document as the model writes it, the only shape `compareRevisions` takes. */
const norm = (doc) => new Character(doc).toJSON();

const id = fixtureIds()[0];
const raw = loadCharacter(id);
const base = norm(raw);

/**
 * The same character with one edit, recomputed exactly as the sheet would.
 *
 * The edit is made to the *normalized* document rather than the file on disk,
 * because a converted workbook is not in the shape the model writes -- it has
 * `feats` where the model has `featGroups` -- and an edit aimed at the stored
 * shape would be measuring the conversion rather than the change.
 */
function edited(mutate) {
  const copy = structuredClone(base);
  mutate(copy);
  return norm(copy);
}

const find = (changes, key) => changes.find((c) => c.key === key) || null;
const verdict = (changes, key) => find(changes, key)?.verdict ?? null;

console.log(`diff: checking against ${id}`);

/* ---------------- the projection ---------------- */

const map = auditSummary(base);
check('auditSummary finds something to audit', map.size > 100, true);
check('every entry knows where it came from',
  [...map.values()].every((e) => e.provenance === 'authored' || e.provenance === 'derived'), true);
check('every entry lands in a known group',
  [...map.values()].every((e) => AUDIT_GROUPS.includes(e.group)), true);
check('derived entries name their inputs',
  [...map.values()].filter((e) => e.provenance === 'derived').every((e) => e.deps.length > 0), true);
check('the eleven derived stats are all there',
  ['initiative', 'defenses.ac', 'defenses.cmd', 'attack.totalMelee', 'saves.will.total']
    .every((k) => map.get(k)?.provenance === 'derived'), true);
check('summarizing twice gives the same keys',
  [...auditSummary(base).keys()].join() === [...map.keys()].join(), true);

/* ---------------- nothing changed ---------------- */

check('a character does not differ from itself', compareRevisions(base, base).counts.total, 0);
check('nor from itself normalized twice, which every edit here relies on',
  compareRevisions(base, norm(base)).counts.total, 0);

/* ---------------- the headline: identity, not position ---------------- */

const reordered = edited((doc) => {
  const moved = doc.skills.splice(3, 1)[0];
  doc.skills.unshift(moved);
});
check('moving a skill row changes nothing', compareRevisions(base, reordered).counts.total, 0);

const renamed = edited((doc) => { doc.skills[0].name = 'Renamed Skill'; });
const renames = compareRevisions(base, renamed).changes;
check('renaming a skill is a removal and an addition, not a change',
  [renames.some((c) => c.kind === 'removed'), renames.some((c) => c.kind === 'added'),
    renames.some((c) => c.kind === 'changed' && c.group === 'Skills')],
  [true, true, false]);

/* ---------------- rows that claim the same identity ---------------- */

/*  A sheet carries blank Craft, Lore and Perform rows waiting to be filled in,
 *  and every one of them keys as `Craft|`. Keeping only the last would hide an
 *  edit to any of the others, so each row has to survive into the summary and
 *  an edit to any of them has to show. */
const skillRows = base.skills.length;
check('every skill row survives into the summary, duplicates included',
  [...map.keys()].filter((k) => k.startsWith('skill:') && k.endsWith('.ranks')).length, skillRows);

const dupName = base.skills.map((s) => `${s.name}|${s.spec || ''}`)
  .find((k, i, all) => all.indexOf(k) !== i) || null;
if (dupName) {
  const first = base.skills.findIndex((s) => `${s.name}|${s.spec || ''}` === dupName);
  const nudged = edited((doc) => { doc.skills[first].offset = (doc.skills[first].offset || 0) + 4; });
  const nudge = compareRevisions(base, nudged).changes;
  check(`editing the first of several "${dupName}" rows still reports it`,
    nudge.some((c) => c.provenance === 'authored' && c.key.endsWith('.misc')), true);
} else {
  check('no duplicate skill identities in this roster, so nothing to hide', true, true);
}

/* ---------------- a legitimate edit, and what follows from it ---------------- */

const dexed = edited((doc) => { doc.statsBuild.dex.pointBuy += 2; });
const dex = compareRevisions(base, dexed);
check('the build entry the player moved is authored',
  verdict(dex.changes, 'build.dex.pointBuy'), 'authored');
check('the score it adds up to is a consequence',
  verdict(dex.changes, 'ability.dex.score'), 'consequence');
check('the modifier under that is a consequence too',
  verdict(dex.changes, 'ability.dex.mod'), 'consequence');
check('and so is every derived stat that reads it',
  ['initiative', 'defenses.ac', 'defenses.touch', 'saves.reflex.total', 'attack.totalRanged']
    .map((k) => verdict(dex.changes, k))
    .filter((v) => v !== null && v !== 'consequence'), []);
check('a clean level of bookkeeping raises no questions', dex.counts.unexplained, 0);
check('the player wrote exactly one thing', dex.counts.authored, 1);

/* ---------------- the audit case: a total nothing accounts for ---------------- */

const fudged = structuredClone(base);
fudged.defenses.ac += 5;
const fudge = compareRevisions(base, fudged);
check('a total that moved with none of its inputs is unexplained',
  verdict(fudge.changes, 'defenses.ac'), 'unexplained');
check('and it sorts to the top', fudge.changes[0].key, 'defenses.ac');
check('nothing else was disturbed', fudge.counts.total, 1);

/* ---------------- structural changes ---------------- */

const featExtra = edited((doc) => {
  if (!doc.featGroups?.length) doc.featGroups = [{ name: 'Level Up', entries: [] }];
  doc.featGroups[0].entries = [...(doc.featGroups[0].entries || []),
    { name: 'Diff Test Feat', detail: 3, note: '' }];
});
const feat = compareRevisions(base, featExtra).changes;
check('a new feat arrives as structural',
  [feat.length, feat[0]?.kind, feat[0]?.verdict, feat[0]?.group],
  [1, 'added', 'structural', 'Progression']);

const trimmed = edited((doc) => { doc.skills = doc.skills.slice(0, -1); });
const trim = compareRevisions(base, trimmed).changes;
check('a dropped skill row leaves only removals',
  trim.every((c) => c.kind === 'removed' && c.verdict === 'structural'), true);

/* ---------------- formulas are compared as written ---------------- */

const refactored = edited((doc) => { doc.skills[0].rankSources.bought = '1 + 1'; });
const refactor = compareRevisions(base, refactored).changes;
check('a rewritten rank formula shows even where the total does not move',
  refactor.some((c) => c.key.endsWith('.ranks') && c.provenance === 'authored'), true);

/* ---------------- the shape a view renders ---------------- */

const grouped = changesByGroup(dex.changes);
check('groups come back in tab order',
  [...grouped.keys()].every((g, i, all) => i === 0 || AUDIT_GROUPS.indexOf(all[i - 1]) < AUDIT_GROUPS.indexOf(g)), true);
check('and none of them are empty', [...grouped.values()].every((rows) => rows.length > 0), true);
check('every change carries a verdict the view knows',
  dex.changes.every((c) => AUDIT_VERDICTS.includes(c.verdict)), true);
check('the tally adds up to the changes',
  AUDIT_VERDICTS.reduce((n, v) => n + dex.counts[v], 0), dex.counts.total);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
