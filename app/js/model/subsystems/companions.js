/**
 * Familiars, animal companions and eidolons.
 *
 * A companion's numbers come from its master's, so the master's side is
 * gathered first and handed to companions.js, which holds the tables.
 */

import {
  COMPANION_KINDS, computeCompanion, defaultCompanion, seedSkills,
} from '../../companions.js';
import { ABILITIES } from '../../rules.js';
import { sheetReader } from '../document.js';
import { positionedRows } from '../templates.js';
import { classLevelCount } from '../progression.js';

// A companion: the level, HD, hit points, attack, saves, AC and every skill
// and attack total come from the tables and the master, so only what was
// typed -- scores, ranks, the attacks' names and damage -- is saved.
export const COMPANION_DERIVED = [
  'calc',
  { path: 'skills', keys: ['masterRanks', 'effectiveRanks', 'abilityMod', 'total'] },
  { path: 'attacks', keys: ['damageType', 'primaryResolved', 'toHit'] },
];

const abilityKey = (label) => {
  const s = String(label || '').trim().toLowerCase().slice(0, 3);
  return ABILITIES.includes(s) ? s : null;
};

/**
 * Read the workbook's Animal Companion tab into a companion block.
 *
 * Nearly every cell on that tab was a formula against `dataSheet` -- the
 * level, the HD, the BAB, the base saves, the AC line, the skill totals, the
 * Str/Dex ladder, the slots a body type allows. None of them are read here:
 * they are what `computeCompanion` works out, and keeping the frozen answers
 * instead would pin the companion to the level its workbook was exported at
 * and to the sheet's own habit of indexing a level-keyed table by hit dice.
 * What is read is everything the player typed around them -- the name and the
 * creature, where the level comes from, the base scores and the increases
 * chosen, the typed bonuses, the tricks, feats, skill ranks, attacks, items.
 *
 * Labels are found rather than addressed, but the rows are put back at their
 * sheet positions first, because half the tab writes its values *under* a
 * heading rather than beside it and a dropped blank row would shift them.
 */
export function importAnimalCompanion(tab) {
  const b = defaultCompanion('animalCompanion');
  if (!tab) return b;
  const g = sheetReader({ rows: positionedRows(tab) });
  const { rows, at, text, num, find } = g;
  const t = (ri, ci) => text(at(ri, ci));
  const ticked = (v) => v === true || /^(true|yes|y|x)$/i.test(String(v ?? '').trim());
  /** The column a label occupies in one row, at or after `from`. */
  const columnOf = (ri, label, from = 0) => {
    const cells = rows[ri] || [];
    for (let ci = from; ci < cells.length; ci++) if (text(cells[ci]) === label) return ci;
    return -1;
  };
  /** The first value to the right of a label inside one row. */
  const after = (ri, label, from = 0) => {
    const ci = columnOf(ri, label, from);
    const cells = rows[ri] || [];
    for (let k = ci + 1; ci >= 0 && k <= ci + 4 && k < cells.length; k++) {
      if (text(cells[k]) !== '') return cells[k];
    }
    return null;
  };
  /** The cell under a label -- where the tab keeps its ticks and bonuses. */
  const under = (label, dc = 0) => {
    const hit = find(label);
    return hit ? at(hit[0] + 1, hit[1] + dc) : null;
  };

  b.name = text(g.take('Name', 1));
  b.masterClass = text(g.take('Master Class', 1));
  b.masterLevelPenalty = Math.abs(num(g.take('Master Lvl Penalty', 1)));
  b.size = text(g.take('Size', 1)) || b.size;
  b.archetype = text(g.take('Archetype', 1));
  b.bodyType = text(g.take('Body Type', 1));
  b.hpAbility = text(g.take('Ability Score', 1)) || b.hpAbility;
  b.hp.bonus = num(g.take('Bonus HP', 1));

  // Ticking Spheres takes the level from ranks in the skill named beside it
  // instead of from a class's levels.
  const spheres = find('Spheres');
  if (spheres && ticked(at(spheres[0], spheres[1] + 1))) {
    b.levelSource = /ride/i.test(t(spheres[0], spheres[1] + 2)) ? 'ride' : 'handleAnimal';
  }

  // "Type" heads the creature line on the left and every attack block on the
  // right; the creature's is the one in the column the tab's heading sits in.
  const headCol = (find('Animal Companion') || [0, 1])[1];
  for (let ri = 0; ri < rows.length; ri++) {
    if (t(ri, headCol) !== 'Type') continue;
    b.creature = t(ri, headCol + 1);
    break;
  }

  // Special qualities are two merged lines, the second starting back in the
  // label's own column.
  const quality = find('Special Qualities');
  if (quality) {
    b.specialQualities = [t(quality[0], quality[1] + 1), t(quality[0] + 1, quality[1])]
      .filter(Boolean).join('\n');
  }

  // The attack ability is the "Ability" a row above "Total Attack": the tab
  // labels the saves and the AC lines "Ability" too.
  const attack = find('Total Attack');
  if (attack && t(attack[0] - 1, attack[1]) === 'Ability') {
    b.attackAbility = t(attack[0] - 1, attack[1] + 1) || b.attackAbility;
  }

  for (const [key, label] of [['fort', 'Good Fort'], ['ref', 'Good Ref'], ['will', 'Good Will']]) {
    const hit = find(label);
    if (hit) b.goodSaves[key] = ticked(at(hit[0] + 1, hit[1]));
  }
  b.ac.all = num(under('Bonus AC (All)'));
  b.ac.touch = num(under('Bonus AC (Touch)'));
  b.ac.ff = num(under('Natural & other FF'));
  b.cmdOther = num(under('Other Bonus'));
  b.initBonus = num(under('Initiative', 1));

  // Scores: the Base column only. The one beside it is the table's Str/Dex
  // bonus plus the increases, which are worked out again on every load.
  const scores = find('Scores');
  if (scores) {
    for (let ri = scores[0] + 1; ri < rows.length; ri++) {
      const key = abilityKey(t(ri, scores[1]));
      if (!key) break;
      const base = at(ri, scores[1] + 1);
      if (text(base) !== '') b.scores[key].base = num(base);
    }
  }

  const increases = find('Ability Score Increase');
  if (increases) {
    const picks = [];
    for (let ri = increases[0] + 1; ri < rows.length; ri++) {
      const level = at(ri, increases[1]);
      if (text(level) === '' || !Number.isFinite(Number(level))) break;
      picks.push({ level: Number(level), ability: t(ri, increases[1] + 1) });
    }
    if (picks.length) b.abilityIncreases = picks;
  }

  const speed = find('Speed');
  if (speed) {
    for (let ri = speed[0] + 1; ri < rows.length; ri++) {
      const key = t(ri, speed[1]).toLowerCase();
      if (!Object.hasOwn(b.speed, key)) break;
      b.speed[key] = t(ri, speed[1] + 1);
    }
  }

  // Tricks run down a column of merged rows as far as the Slotless Items
  // block beneath them; the items themselves are a slot, a name and a cost.
  const tricks = find('Tricks');
  const slotless = find('Slotless Items');
  if (tricks) {
    const end = slotless && slotless[1] === tricks[1] ? slotless[0] : rows.length;
    for (let ri = tricks[0] + 1; ri < end; ri++) {
      const name = t(ri, tricks[1]);
      if (name) b.tricks.push({ name, notes: '' });
    }
  }
  if (slotless) {
    const cost = columnOf(slotless[0], 'Cost', slotless[1]);
    for (let ri = slotless[0] + 1; ri < rows.length; ri++) {
      const name = t(ri, slotless[1]);
      if (name) b.slotless.push({ name, cost: cost < 0 ? 0 : num(at(ri, cost)) });
    }
  }
  const items = find('Items');
  if (items) {
    const cost = columnOf(items[0], 'Cost', items[1]);
    for (let ri = items[0] + 1; ri < rows.length; ri++) {
      const slot = t(ri, items[1]);
      if (!slot) break;
      const name = t(ri, items[1] + 1);
      const price = cost < 0 ? 0 : num(at(ri, cost));
      if (name || price) b.items[slot] = { name, cost: price };
    }
  }

  // A feat, and the level on the ladder the table lays out beside it.
  const feat = find('Feat');
  if (feat) {
    for (let ri = feat[0] + 1; ri < rows.length; ri++) {
      const level = at(ri, feat[1] - 1);
      if (text(level) === '' || !Number.isFinite(Number(level))) break;
      const name = t(ri, feat[1]);
      if (name) b.feats.push({ name, notes: `Level ${Number(level)}` });
    }
  }

  // Skills: the ranks, the class-skill tick and the racial and misc columns
  // are the player's; the bonus beside them is only their sum.
  const skills = find('Familiar Skills');
  if (skills) {
    const [sr, sc] = skills;
    const col = (label) => columnOf(sr, label, sc);
    const [cls, ranks, race, ability, misc] = ['Class Skill', 'Ranks', 'Race', 'Ability', 'Misc'].map(col);
    const seeded = new Map(seedSkills('animalCompanion').map((s) => [s.name.toLowerCase(), s]));
    const numAt = (ri, ci) => (ci < 0 ? 0 : num(at(ri, ci)));
    const list = [];
    for (let ri = sr + 1; ri < rows.length; ri++) {
      const name = t(ri, sc);
      if (!name) break;
      const seed = seeded.get(name.toLowerCase());
      list.push({
        name,
        spec: '',
        ability: (ability < 0 ? '' : t(ri, ability)) || seed?.ability || 'Int',
        trained: !!seed?.trained,
        classSkill: cls < 0 ? !!seed?.classSkill : numAt(ri, cls) > 0,
        ranks: numAt(ri, ranks),
        misc: numAt(ri, race) + numAt(ri, misc),
      });
    }
    if (list.length) b.skills = list;
  }

  // An attack is three rows: the natural attack and whether it is primary,
  // its qualities, then the damage and crit beside a to-hit already summed.
  const attacks = find('Attacks');
  if (attacks) {
    const [ar, ac] = attacks;
    for (let ri = ar + 1; ri < rows.length; ri++) {
      if (t(ri, ac) !== 'Type') continue;
      const type = t(ri, ac + 1);
      if (!type) continue;
      const role = text(after(ri, 'Primary?', ac));
      const critAt = columnOf(ri + 2, 'Crit', ac);
      b.attacks.push({
        type,
        damage: text(after(ri + 2, 'Damage', ac)),
        crit: critAt < 0 ? '' : `${t(ri + 2, critAt + 1)}${t(ri + 2, critAt + 2)}`.replace(/x/i, '×'),
        primary: /^y/i.test(role) ? true : /^n/i.test(role) ? false : null,
        bonus: 0,
        qualities: t(ri + 1, ac + 1),
      });
    }
  }

  return b;
}

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
