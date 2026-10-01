/**
 * Rules the sheet once worked out wrong, put right in the documents it saved.
 *
 * A reconciled total is saved as the figure the sheet showed, and on load its
 * offset is measured as that figure less what the sheet now works out (see
 * reconcile.js). That is what keeps a workbook's own numbers intact. It also
 * means that when a rule the sheet got wrong is fixed, a document the sheet
 * wrote itself comes back showing the old figure, with the difference parked
 * in an offset nobody typed.
 *
 * So each fix here moves a saved figure by as much as the fix moves the rule,
 * once, before the offsets are measured -- and only where the figure was the
 * sheet's own work. A workbook's totals were the workbook's, and the sheet's
 * mistake is exactly what their offsets were making up for; a pasted
 * monster's saves are the stat block's. Those are left alone, and their
 * offsets come out smaller, which is to say right.
 *
 * `corrections` on the document lists what has been applied, and is written on
 * the first load. A pasted monster arrives with the whole list, because the
 * importer writes its totals under the current rules. A converted workbook and
 * a new blank sheet arrive with none and need none: nothing here moves a
 * workbook's totals, and a blank sheet has nothing yet for a fix to move.
 */

import { RULE_CORRECTIONS, SIZE_MODIFIERS, gestaltSaveBase } from '../rules.js';
import { classPresence, saveProgressions } from './progression.js';

/** The attack slots that take the size modifier the way AC does. */
const SIZED_ATTACKS = new Set(['Melee', 'Alt Melee', 'Ranged', 'Alt Ranged']);

/** A poor save as the sheet used to add it up: thirds, in floating point. */
const thirdsInFloat = (perLevel, anyGood) => (anyGood ? 2 : 0)
  + Math.floor(perLevel.reduce((t, good) => t + (good == null ? 0 : (good ? 0.5 : 1 / 3)), 0));

const FIXES = {
  /*
   * Melee and ranged attack subtracted the size modifier, as CMB does, where
   * they add it, as AC does: a Large character was +1 to hit instead of -1.
   * The fix moves both totals by twice the modifier. A weapon row keeps an
   * adjustment of its own against the figure its source printed, so that
   * adjustment gives the same amount back and the printed figure stands.
   */
  'attack-size-sign'(model, ownWork) {
    const d = model.data;
    const move = 2 * (SIZE_MODIFIERS[d.identity?.size] ?? 0);
    if (!move) return;
    if (ownWork) {
      for (const key of ['attack.totalMelee', 'attack.totalRanged']) model.imported[key] += move;
    }
    for (const w of d.equipment?.weapons || []) {
      if (!w || w.sheetAttack == null || typeof w.attackOffset !== 'number') continue;
      if (SIZED_ATTACKS.has(w.attackType)) w.attackOffset -= move;
    }
  },

  /*
   * Poor saves were added up in thirds in floating point, and six thirds came
   * to 1.999..., so a poor save was one short at 6th, 15th and 18th level.
   * Only the sheet's own saves move: a pasted monster's are its stat block's.
   */
  'poor-save-thirds'(model) {
    const d = model.data;
    if (d.source?.kind !== 'blank') return;
    const level = Number(d.identity?.level) || 0;
    const classes = (d.classes || []).filter((x) => x.name);
    const progressions = saveProgressions(classes, classPresence(model, classes, level), level);
    for (const [save, { perLevel, anyGood }] of Object.entries(progressions)) {
      const move = gestaltSaveBase(perLevel, anyGood) - thirdsInFloat(perLevel, anyGood);
      if (move) model.imported[`saves.${save}.total`] += move;
    }
  },
};

/*
 * A stored figure the importer wrote in the wrong form. A pasted monster's
 * weapons kept the crit range as its width (19-20 as 2), where every other
 * weapon row keeps the lowest roll that threatens (19). A width is at most 6
 * and a lowest roll at least 15, so one that was put right by hand on the Gear
 * tab is left alone.
 */
FIXES['monster-crit-range'] = (model) => {
  const d = model.data;
  if (d.source?.kind !== 'monster') return;
  for (const w of d.equipment?.weapons || []) {
    const width = Number(w?.critRange);
    if (Number.isInteger(width) && width >= 1 && width <= 10) w.critRange = 21 - width;
  }
};

/**
 * Apply every fix the document was saved before, once. Runs inside the first
 * reconciliation, before any offset is measured.
 */
export function applyCorrections(model) {
  const d = model.data;
  const done = new Set(Array.isArray(d.corrections) ? d.corrections : []);
  // What the sheet worked out itself: a character begun here, and a pasted
  // monster, whose attack totals the importer wrote to match the sheet's rule.
  const ownWork = d.source?.kind === 'blank' || d.source?.kind === 'monster';
  for (const name of RULE_CORRECTIONS) {
    if (!done.has(name)) FIXES[name]?.(model, ownWork);
  }
  d.corrections = [...new Set([...done, ...RULE_CORRECTIONS])];
}
