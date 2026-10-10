/**
 * weapon-now.js -- a weapon's attack and damage as the conditions and buffs
 * of the moment leave them.
 *
 * The stored totals are the weapon at rest. A buff to attack or damage moves
 * them, and a size buff (Enlarge Person, {size += 1}) steps the weapon's own
 * dice along the damage-by-size table from the size the weapon already is;
 * the [[…]] riders keep their dice, as the rules leave them. The Gear tab's
 * weapon card and the dashboard's Offense card both show this, so they read
 * the same.
 */

import {
  addDice, diceString, fmt, weaponMoves,
} from '../rules.js';
import { movedTitle } from './rows.js';

/**
 * `{ atk, dmg, atkBase, dmgBase, atkDelta, dmgMoved, title }` -- the strings
 * to show, what they were before, and the tooltip that says why they moved.
 */
export function weaponNow(c, w, cs) {
  const { calc } = w;
  const {
    atkDelta, dmgDelta, grow, sized,
  } = weaponMoves(c, w, cs);
  const atkBase = calc?.totalAtkStr ?? fmt(w.attackTotal ?? 0);
  const atk = !atkDelta ? atkBase
    : calc
      ? (Object.keys(calc.tokAtk?.dice || {}).length
        ? `${fmt(calc.totalAtk + atkDelta)}+${diceString(calc.tokAtk.dice)}`
        : fmt(calc.totalAtk + atkDelta))
      : fmt((Number(w.attackTotal) || 0) + atkDelta);
  const dmgBase = calc?.totalDmgStr ?? w.damageTotal ?? '—';
  const dmg = !(dmgDelta || grow) ? dmgBase
    : diceString(
      addDice(addDice(sized.dice, calc.tokDmg?.dice || {}), calc.tokMultDmg?.dice || {}),
      calc.totalDmgFlat + dmgDelta + sized.flat,
    ) + ((calc.notes || []).length ? ` ${calc.notes.join(' ')}` : '');
  const dmgMoved = dmgDelta || (grow ? 1 : 0);
  const title = (base) => `${movedTitle(base, cs?.sources)}${grow
    ? `, ${Math.abs(grow)} size step${Math.abs(grow) === 1 ? '' : 's'} ${grow > 0 ? 'larger' : 'smaller'}` : ''}`;
  return {
    atk, dmg, atkBase, dmgBase, atkDelta, dmgMoved,
    atkTitle: atkDelta ? movedTitle(atkBase, cs.sources) : '',
    dmgTitle: dmgMoved ? title(dmgBase) : '',
  };
}
