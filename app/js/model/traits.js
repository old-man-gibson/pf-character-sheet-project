/**
 * Movement rates, languages, and counting feats.
 *
 * Three small passes over what the character simply *is*, kept together
 * because none of them is big enough to be a domain and none of them belongs
 * to one. A speed's bonus is allowed to be a formula, which is the only part
 * here with any depth to it.
 */

import { evaluateFormula } from '../formula.js';
import { forwarded } from './scope.js';
import { speedForwardKey } from './util.js';

/**
 * Movement rates: base plus bonus, with the bonus allowed to be a formula.
 *
 * A monk's fast movement is not a number, it is a rule -- "+10 ft. at 3rd
 * level and every 3 levels after" -- and typed as a number it goes stale the
 * moment the character levels. Written as `floor(level / 3) * 10` it does
 * not, so the bonus resolves in the same sandbox as everything else players
 * may write, and lands in `bonusNum` with any error beside it.
 */
export function recomputeSpeeds(model) {
  const speeds = model.data.identity?.speeds;
  if (!Array.isArray(speeds) || !speeds.length) return;
  const scope = model.scope();
  // A speed may read the speeds *above* it, and not the ones below. "Your
  // fly speed is equal to your land speed" is a real rule and wants saying
  // that way rather than restating a number that will move; a rule reading
  // downward would be a cycle waiting to happen. So the rows resolve top to
  // bottom and the scope grows as they do, which makes the cycle impossible
  // rather than merely unlikely -- the same line the inline names draw
  // against the skills.
  scope.speed = {};
  for (const sp of speeds) {
    sp.bonusError = null;
    let bonus = 0;
    if (typeof sp.bonus === 'string' && sp.bonus.trim() !== '') {
      try {
        const v = Number(evaluateFormula(sp.bonus, scope));
        bonus = Number.isFinite(v) ? v : 0;
      } catch (err) {
        sp.bonusError = err.message;
      }
    } else {
      bonus = Number(sp.bonus) || 0;
    }
    sp.bonusNum = bonus;
    // A bonus forwarded here from elsewhere on the sheet is kept beside the
    // one typed in, never folded into it -- the same way a skill keeps its
    // Misc and its forwarded amount apart, and for the same reason: the
    // field has to go on saying what was written in it.
    sp.handle = speedForwardKey(sp);
    sp.forwarded = sp.handle ? forwarded(model, sp.handle) : 0;
    sp.final = (Number(sp.base) || 0) + bonus + sp.forwarded;
    if (sp.handle) scope.speed[sp.handle.slice('speed.'.length)] = sp.final;
  }
}

/**
 * How many languages the character may know beyond the native ones.
 *
 * One per point of Intelligence bonus, one per rank of Linguistics, and
 * whatever else grants some -- a race, a trait, a class feature -- as a
 * number or a formula, since "+1 per two levels" is a rule and not a value.
 * The count is against the list, so the panel can say how many are spare
 * or how many too many.
 */
export function recomputeLanguages(model) {
  const c = model.data;
  const i = c.identity;
  const int = Math.max(0, Number(c.abilities.int?.totalMod) || 0);
  const ling = (c.skills || [])
    .filter((s) => /^Linguistics\b/i.test(String(s.name || '')))
    .reduce((t, s) => t + (Number(s.totalRanks) || 0), 0);
  let extra = 0;
  let extraError = null;
  if (typeof i.languageExtra === 'string' && i.languageExtra.trim() !== '') {
    try {
      const v = Number(evaluateFormula(i.languageExtra, model.scope()));
      extra = Number.isFinite(v) ? Math.floor(v) : 0;
    } catch (err) {
      extraError = err.message;
    }
  } else {
    extra = Number(i.languageExtra) || 0;
  }
  const known = (i.languages || []).filter((l) => String(l).trim()).length;
  i.languageSlots = {
    int, linguistics: ling, extra, extraError, total: int + ling + extra, known,
  };
}

/** The sheet's unarmed practitioner damage, from V65's exact algorithm. */
/** How many feats on the character match `re` -- feat groups and granted feats. */
export function featCount(model, re) {
  const d = model.data;
  let n = 0;
  for (const g of d.featGroups || []) {
    for (const f of g.entries || []) if (re.test(String(f?.name || ''))) n += 1;
  }
  const gf = d.grantedFeats || {};
  for (const f of [gf.drawback, gf.specialty, ...(gf.others || [])]) {
    if (re.test(String(f?.name || ''))) n += 1;
  }
  return n;
}
