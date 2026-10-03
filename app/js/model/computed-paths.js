/**
 * computed-paths.js -- the values a saved document carries that the player
 * did not write.
 *
 * A document keeps its totals: a published sheet, the GM audit (diff.js) and
 * reconcile all read `defenses.ac` or a save's total straight from it. But
 * those values are recompute's answer, not an edit, and "changes since the
 * last save" (history.js `countChanges`) must not count them. Without this
 * one level edit moved about 230 of them, past the twenty that take an
 * automatic snapshot.
 *
 * A path is dotted; `*` stands for any one key or row index. A name in
 * `COMPUTED_KEYS` is computed wherever it stands, and so is everything
 * beneath it. tests/model.test.mjs makes a range of edits to every character
 * and fails on any value that moves without being the edited one or listed
 * here -- add the path here when it does.
 */

import { BUILD_DERIVED_KEYS } from '../rules.js';

/** Keys whose value, and everything under it, is always worked out. */
const COMPUTED_KEYS = new Set(['calc', 'resolved', 'forwarded']);

/** `fooResolved`, `fooForwarded`: the answer to a field written beside it. */
const COMPUTED_SUFFIX = /.(Resolved|Forwarded)$/;

const COMPUTED_PATHS = [
  // Ability scores: the build's parts are typed, the scores worked out.
  'abilities.*.score', 'abilities.*.mod', 'abilities.*.tempScore', 'abilities.*.totalMod',
  'abilities.*.checkMod', 'abilities.*.workingScore',
  // ABP, the stat array, level-4 and mythic increases follow the picks.
  ...BUILD_DERIVED_KEYS.map((k) => `statsBuild.*.${k}`),
  'identity.mythicTier', 'identity.languageSlots.*', 'mythic.computedTier',
  'hp.base', 'hp.total', 'hp.initiative',
  'attack.bab', 'attack.babBase', 'attack.iterative',
  'attack.totalMelee', 'attack.totalRanged', 'attack.totalCmb',
  'defenses.ac', 'defenses.touch', 'defenses.flatFooted', 'defenses.cmd', 'defenses.ffCmd',
  // The automatic bonus progression rows inside the typed bonus maps.
  'defenses.acBonuses.abpDeflection', 'defenses.acBonuses.abpNatural',
  'saves.*.base', 'saves.*.total', 'saves.*.bonuses.abpResistance',
  'skills.*.bonus', 'skills.*.abilityMod', 'skills.*.totalRanks', 'skills.*.sphereRanks',
  'skillBudget.*',
  'carry.*',
  'classes.*.gestaltLevels', 'classes.*.gestaltBeaten',
  'gestalt.bab', 'gestalt.babPerLevel', 'gestalt.hdTotal', 'gestalt.hp', 'gestalt.saves.*.base',
  'equipment.weapons.*.attackTotal', 'equipment.weapons.*.damageBonus',
  'equipment.weapons.*.damageTotal', 'equipment.weapons.*.diceResolved',
  'equipment.weapons.*.sizeNow', 'equipment.weapons.*.sizeSteps',
  'customTrackers.*.max',
  'training.*.classes.*.classLevelsCurrent', 'training.*.classes.*.levels.*.future',
  'training.combat.customizations.*.classLevels', 'training.combat.unarmed.native.classLevel',
  'training.combat.practitionerDC',
  'training.magic.msb', 'training.magic.msd', 'training.magic.globalCL', 'training.magic.globalDC',
  'training.magic.concentration', 'training.magic.totalSP', 'training.magic.availableSP',
  'training.magic.classSP.*.sp', 'training.magic.boonPoints', 'training.magic.traditionEssence',
  'training.magic.traditionSP', 'training.magic.traditionPools.*.essence',
  'training.magic.traditionPools.*.points', 'training.magic.traditionPools.*.sp',
].map((p) => p.split('.'));

/**
 * True when the value at `path` (an array of keys) is the engine's answer
 * rather than the player's -- so it, and anything under it, is not a change.
 */
export function isComputedPath(path) {
  if (path.some((k) => COMPUTED_KEYS.has(k) || COMPUTED_SUFFIX.test(k))) return true;
  return COMPUTED_PATHS.some((pattern) => pattern.length <= path.length
    && pattern.every((k, i) => k === '*' || k === String(path[i])));
}
