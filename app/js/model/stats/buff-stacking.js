/**
 * buff-stacking.js -- typed buffs, settled the way the rules settle bonuses.
 *
 * A buff row may say what kind of bonus it is (`b.type`, a BONUS_TYPES key).
 * Untyped, dodge and circumstance bonuses stack, as they always did. Every
 * other type counts once, at its best, wherever it lands:
 *
 *  - among the ticked buffs: two morale bonuses to attack give the larger;
 *  - on saves, AC and ability scores, against what the sheet already holds of
 *    that type there -- the save's or AC's typed column, a belt's enhancement
 *    on the Stats tab, a forwarded `{… as resistance}` -- so a buff adds only
 *    what it brings past it. That is the same settling `typedColumns` gives a
 *    forwarded bonus. The other numbers keep no typed columns, so a buff
 *    there settles against the other buffs only.
 *
 * Penalties always stack. A dial that reaches several numbers (Attack: melee,
 * ranged and CMB; Saves: all three) is split first, so each number settles on
 * its own -- a +2 resistance buff can add nothing to Fortitude, where the
 * cloak already gives +2, and still add to a save the cloak does not reach.
 *
 * What did not count is kept on the row (`lost`), so the Buffs panel can say
 * why a ticked buff is not moving a number.
 */

import { ABILITIES, BONUS_TYPES, baseType, bonusTypeKey, stacksWithItself } from '../../rules.js';
import { typedColumns } from '../scope.js';

/** The dials that reach more than one number, and the numbers they reach. */
const SPLIT = { attack: ['melee', 'ranged', 'cmb'], saves: ['fortitude', 'reflex', 'will'] };

/** The numbers that keep typed bonuses of their own, by the name `typedColumns` knows them. */
const DESTINATION = {
  fortitude: 'saves.fortitude', reflex: 'saves.reflex', will: 'saves.will', ac: 'ac.total',
  ...Object.fromEntries(ABILITIES.map((k) => [k, `${k}.score`])),
};

const LABEL = {
  melee: 'melee attack', ranged: 'ranged attack', cmb: 'CMB', cmd: 'CMD', ac: 'AC',
  fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will', damage: 'damage', skills: 'skills',
  initiative: 'initiative', hp: 'max HP', dc: 'save DCs', essence: 'essence',
  abilityChecks: 'ability checks', speedFt: 'speed',
  str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha',
};

/** What the character already has of `type` at one number: its typed column, or a forwarded bonus. */
function alreadyThere(model, type, key) {
  const dest = DESTINATION[key];
  if (!dest) return 0;
  const cols = typedColumns(model, dest) || {};
  let have = Number(cols[type]) || 0;
  // An ability score keeps its permanent and temporary enhancement apart;
  // a buff is either, and only the better of the two is there to beat.
  if (ABILITIES.includes(key)) have = Math.max(have, Number(cols[`temp.${type}`]) || 0);
  for (const e of model.contributions?.by?.[dest] || []) {
    if (!e.error && e.value > 0 && baseType(e.type) === type) have = Math.max(have, e.value);
  }
  return have;
}

/**
 * Settle the ticked buffs' numbers in place.
 *
 * `rows` are `{ label, type, mods, ability, lost }`, `mods` keyed by condition
 * channel and `ability` by ability key, as conditionState builds them. Typed
 * rows have their positive numbers cut to what counts; `lost` collects
 * `{ key, value, kept, by }` for each cut -- `by` naming the buff that
 * counts instead, or null for the sheet's own bonus.
 */
export function settleTypedBuffs(model, rows) {
  const groups = new Map();
  for (const r of rows) {
    const type = bonusTypeKey(r.type);
    if (!type || stacksWithItself(type)) continue;
    for (const [dial, keys] of Object.entries(SPLIT)) {
      const v = r.mods[dial];
      if (!v) continue;
      delete r.mods[dial];
      for (const k of keys) r.mods[k] = (r.mods[k] || 0) + v;
    }
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(r);
  }
  for (const [type, group] of groups) {
    const slots = new Map();
    for (const r of group) {
      for (const block of ['mods', 'ability']) {
        for (const key of Object.keys(r[block])) slots.set(`${block}:${key}`, [block, key]);
      }
    }
    for (const [block, key] of slots.values()) {
      const values = group.map((r) => Math.max(0, Number(r[block][key]) || 0));
      const best = Math.max(...values);
      if (best <= 0) continue;
      const winner = group[values.indexOf(best)];
      const have = alreadyThere(model, type, key);
      for (const r of group) {
        const v = Number(r[block][key]) || 0;
        if (v <= 0) continue;
        const kept = r === winner ? Math.max(0, best - have) : 0;
        if (kept === v) continue;
        r[block][key] = kept;
        r.lost.push({ key, value: v, kept, by: r === winner ? null : winner.label });
      }
    }
  }
  return rows;
}

/**
 * What a row's `lost` comes to, in words: "+1 attack, saves: Heroism's morale
 * bonus counts instead", "Fortitude: the sheet already has +2 resistance".
 * One line per reason, the split numbers joined back where all of them went.
 */
export function stackingSummary(row, type) {
  if (!row?.lost?.length) return [];
  const name = BONUS_TYPES[bonusTypeKey(type)]?.name?.toLowerCase() || String(type || '').toLowerCase();
  const reasons = new Map();
  for (const l of row.lost) {
    const why = l.by ? `${l.by}’s ${name} bonus counts instead`
      : l.kept ? `adds only ${l.kept}, past the ${name} bonus already there`
        : `the ${name} bonus already there is as large`;
    if (!reasons.has(why)) reasons.set(why, []);
    reasons.get(why).push(l.key);
  }
  const join = (keys) => {
    const set = new Set(keys);
    const out = [];
    for (const [dial, parts] of Object.entries(SPLIT)) {
      if (parts.every((k) => set.has(k))) {
        out.push(dial);
        for (const k of parts) set.delete(k);
      }
    }
    return [...out, ...[...set].map((k) => LABEL[k] || k)].join(', ');
  };
  return [...reasons].map(([why, keys]) => `${join(keys)}: ${why}`);
}
