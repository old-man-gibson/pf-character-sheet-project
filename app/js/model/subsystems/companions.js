/**
 * Familiars, animal companions and eidolons.
 *
 * A companion's numbers come from its master's, so the master's side is
 * gathered first and handed to companions.js, which holds the tables.
 */

import { COMPANION_KINDS, computeCompanion } from '../../companions.js';
import { classLevelCount } from '../progression.js';

// A companion: the level, HD, hit points, attack, saves, AC and every skill
// and attack total come from the tables and the master, so only what was
// typed -- scores, ranks, the attacks' names and damage -- is saved.
export const COMPANION_DERIVED = [
  'calc',
  { path: 'skills', keys: ['masterRanks', 'effectiveRanks', 'abilityMod', 'total'] },
  { path: 'attacks', keys: ['damageType', 'primaryResolved', 'toHit'] },
];

/**
 * The master's side of a companion's sums: level, BAB, hit points, base
 * saves, skill ranks by name and levels in a class. All of it is read off
 * what the passes above have already worked out.
 */
export function companionMaster(model) {
  const c = model.data;
  const ranksOf = (name, spec = '') => {
    const want = String(name || '').trim().toLowerCase();
    const wantSpec = String(spec || '').trim().toLowerCase();
    let best = 0;
    for (const s of c.skills || []) {
      if (String(s.name || '').trim().toLowerCase() !== want) continue;
      if (wantSpec && String(s.spec || '').trim().toLowerCase() !== wantSpec) continue;
      best = Math.max(best, Number(s.totalRanks) || 0);
    }
    return best;
  };
  return {
    level: Number(c.identity?.level) || 0,
    bab: Number(c.attack?.bab) || 0,
    hp: model.hpMax,
    baseSaves: {
      fort: Number(c.saves?.fortitude?.base) || 0,
      ref: Number(c.saves?.reflex?.base) || 0,
      will: Number(c.saves?.will?.base) || 0,
    },
    skillRanks: ranksOf,
    classLevelCount: (name) => model.classLevelCount(name),
  };
}

export function recomputeCompanions(model) {
  const master = companionMaster(model);
  for (const kind of COMPANION_KINDS) {
    const b = model.data[kind];
    if (!b) continue;
    const { calc, skills, attacks } = computeCompanion(kind, b, master);
    b.calc = calc;
    b.skills = skills;
    b.attacks = attacks;
  }
}

/** The companion takes damage (temporary points first), heals, or rests. */
export function companionDamage(model, kind, amount) {
  const b = model.data[kind];
  if (!b) return model;
  let n = Math.max(0, Math.floor(Number(amount) || 0));
  const hp = b.hp || (b.hp = { damage: 0, temp: 0, bonus: 0 });
  const temp = Math.max(0, Number(hp.temp) || 0);
  const fromTemp = Math.min(temp, n);
  hp.temp = temp - fromTemp;
  n -= fromTemp;
  hp.damage = Math.max(0, (Number(hp.damage) || 0) + n);
  return model.recompute();
}

export function companionHeal(model, kind, amount) {
  const b = model.data[kind];
  if (!b) return model;
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const hp = b.hp || (b.hp = { damage: 0, temp: 0, bonus: 0 });
  hp.damage = Math.max(0, (Number(hp.damage) || 0) - n);
  return model.recompute();
}

export function companionRest(model, kind) {
  const b = model.data[kind];
  if (!b) return model;
  b.hp = { ...(b.hp || {}), damage: 0, temp: 0 };
  return model.recompute();
}
