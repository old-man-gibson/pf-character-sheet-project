/**
 * Fortitude, Reflex and Will -- the typed bonuses that stack into them.
 *
 * The save totals themselves are formulas in rules.js (DERIVED), because a
 * total is a rule and belongs with the rules. What is here is the part that
 * cannot be a formula: resolving each typed bonus cell, which may itself be a
 * formula, and folding in the ABP resistance bonus that is read from the
 * character's level rather than typed.
 */

import { SAVE_BONUS_TYPES } from '../../rules.js';
import { resolveBonusBlock } from '../util.js';

/** The three saves' typed bonuses, ABP resistance included. */
export function resolveSaveBonuses(model, scope, abp) {
  for (const key of ['fortitude', 'reflex', 'will']) {
    const save = model.data.saves?.[key];
    if (!save) continue;
    if (save.bonuses) save.bonuses.abpResistance = abp.abpResistance;
    save.bonusErrors = {};
    save.bonusesResolved = resolveBonusBlock(
      scope, save.bonuses, SAVE_BONUS_TYPES, save.bonusErrors,
    );
  }
}
