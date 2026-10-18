/**
 * carry.js -- carrying capacity and the load, worked out early.
 *
 * A medium or heavy load caps the Dexterity bonus to AC and has an armour
 * check penalty of its own (armorParts takes the worse of it and the
 * armour's), so the load has to be known before the AC and the skills are
 * totalled. Everything it needs is on the document -- the item weights, the
 * score it carries by, size, Ant Haul -- so it is read straight off it
 * (carryState in rules.js) at the top of each pass, rather than waiting for
 * the equipment to be worked out at the bottom.
 *
 * `carry.applyLoad` switches the penalties off for a table that does not
 * track encumbrance; a sheet already past a light load when this arrived
 * opens with them off (see the `load-penalties` correction), so its saved
 * totals do not move under it.
 */

import { carryState } from '../../rules.js';

/** The capacity tiers and the current load onto `carry`. */
export function applyCarry(model) {
  const c = model.data;
  if (!c.carry || typeof c.carry !== 'object') c.carry = {};
  const s = carryState(c);
  c.carry.light = s.light;
  c.carry.medium = s.medium;
  c.carry.heavy = s.heavy;
  c.carry.offGround = s.offGround;
  c.carry.pushDrag = s.pushDrag;
  c.carry.load = s.load;
  c.carry.score = s.score;
  return s;
}
