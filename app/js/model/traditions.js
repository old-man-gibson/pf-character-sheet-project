/**
 * model/traditions.js -- the character's casting traditions.
 *
 * A character has one casting tradition (`training.magic.tradition`). With
 * the campaign rule `traditionPerClass` on, a casting class may have one of
 * its own as well (`training.magic.extraTraditions`, each naming its class),
 * as the gestalt rules allow with the GM's permission. Everything that reads
 * a tradition's drawbacks or boons reads them through `castingTraditions`, so
 * an extra tradition counts wherever the first one does, and stops counting
 * everywhere at once when the rule is turned off.
 */
import { campaignRules } from './campaign.js';

/** Where the extra traditions are kept. */
export const EXTRA_TRADITIONS = 'training.magic.extraTraditions';

/** A new extra tradition, as the Add button seeds it. */
export function blankTradition() {
  return { name: '', className: '', drawbacks: [], boughtOff: [], essenceDrawbacks: null };
}

/**
 * The traditions in force: the first, then each extra while the campaign
 * allows them. `extra` is the extra's index, -1 for the first; `path` is
 * where its fields are set.
 */
export function castingTraditions(d) {
  const m = d?.training?.magic;
  if (!m) return [];
  const out = [{ tr: m.tradition || {}, path: 'training.magic.tradition', extra: -1 }];
  if (campaignRules(d).traditionPerClass) {
    (m.extraTraditions || []).forEach((tr, i) => {
      if (tr && typeof tr === 'object') out.push({ tr, path: `${EXTRA_TRADITIONS}.${i}`, extra: i });
    });
  }
  return out;
}

/** The extra traditions kept but not counted, because the campaign rule is off. */
export function idleTraditions(d) {
  const extras = (d?.training?.magic?.extraTraditions || []).filter((tr) => tr && typeof tr === 'object');
  return campaignRules(d).traditionPerClass ? 0 : extras.length;
}

/** Every boon on a tradition in force, a drawback feat taken as a boon included. */
export function traditionBoons(d) {
  return castingTraditions(d).flatMap(({ tr }) => (tr.boughtOff || []).map((x) => String(x ?? '')));
}

/** The fold key of an extra tradition's panel on the Magic Spheres tab. */
export function traditionFold(extra) {
  return `magic-tradition-${extra + 2}`;
}
