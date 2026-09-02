/**
 * Familiars, animal companions and eidolons.
 *
 * A companion's numbers come from its master's, so the master's side is
 * gathered first and handed to companions.js, which holds the tables.
 */

import {
  COMPANION_KINDS, COMPANION_TARGETS, companionAttackKey, companionSkillKey,
  computeCompanion, defaultCompanion, seedSkills,
} from '../../companions.js';
import { ABILITIES } from '../../rules.js';
import { sheetReader } from '../document.js';
import { classLevelCount } from '../progression.js';
import { forwarded } from '../scope.js';
import { setPath } from '../util.js';

// A companion: the level, HD, hit points, attack, saves, AC and every skill
// and attack total come from the tables and the master, so only what was
// typed -- scores, ranks, the attacks' names and damage -- is saved.
export const COMPANION_DERIVED = [
  'calc',
  { path: 'skills', keys: ['masterRanks', 'effectiveRanks', 'abilityMod', 'forwarded', 'total'] },
  { path: 'attacks', keys: ['damageType', 'primaryResolved', 'toHit', 'damageBonus'] },
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
 * Labels are found rather than addressed. Half the tab writes its values
 * *under* a heading rather than beside it, so the reads below go a row down
 * as often as a column across -- and "a row down" here means the next row
 * that holds anything, not the next row of the worksheet. By the time this
 * runs the grid has lost its row numbers (`normalise` drops them when it
 * builds `sheetTabs`, and a document saved by an older build never had them
 * to give), so a blank worksheet row is already gone. That suits the tab:
 * every label sits directly above its own value in a fixed block, and the
 * lists below read through a blank row a player left in the middle of one
 * rather than stopping at it.
 */
export function importAnimalCompanion(tab) {
  const b = defaultCompanion('animalCompanion');
  if (!tab) return b;
  const g = sheetReader(tab);
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
      // Which side of the table it came from is not written down anywhere the
      // workbook can be read from, so it stays for the player to fill in.
      if (name) b.tricks.push({ source: '', name, notes: '' });
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
      // The level is where the feat came from, not a note about it -- so it
      // goes in the Source column and the note stays the player's own.
      if (name) b.feats.push({ source: `Level ${Number(level)}`, name, notes: '' });
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
    // The conjured companion grows with this rather than a class's levels:
    // the magic training's global caster level, or the character's own level
    // for a caster with no sphere block behind it -- the same number the
    // wallet charges material casting against. Temporary caster-level boosts
    // never land in globalCL, which is exactly the sphere's own rule that a
    // companion gains nothing from them.
    casterLevel: Number(model.casterLevel) || 0,
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

/**
 * What has been forwarded at one companion, in the shape `computeCompanion`
 * takes it: `{eidolon.str.score += 2}` arriving as `scores.str`.
 *
 * The fixed stats come off COMPANION_TARGETS, which is the same list the
 * scope publishes them under, so a name can never be readable and unaimable.
 * The skills and the natural attacks are this companion's own rows, and are
 * gathered by the key each row answers to -- two rows with the same name
 * collapse to one destination and both take the bonus, which is what "+2 to
 * Craft" means when a creature keeps two Craft rows.
 *
 * Every companion is aimable under its own id -- `eidolon.…` for the first
 * of its kind, `eidolon2.…` and so on after -- and under nothing else.
 */
export function companionBonuses(model, kind, b) {
  const at = (name) => (b.id ? forwarded(model, `${b.id}.${name}`) : 0);
  const out = { saves: {}, scores: {}, skill: {}, attackBy: {}, damageBy: {} };
  for (const [name, , path] of COMPANION_TARGETS) setPath(out, path, at(name));
  for (const s of b.skills || []) {
    const key = companionSkillKey(s);
    if (key && key !== 'x' && out.skill[key] === undefined) out.skill[key] = at(`skill.${key}`);
  }
  for (const a of b.attacks || []) {
    const key = companionAttackKey(a);
    if (!key || key === 'x' || out.attackBy[key] !== undefined) continue;
    out.attackBy[key] = at(`attack.${key}`);
    out.damageBy[key] = at(`damage.${key}`);
  }
  return out;
}

export function recomputeCompanions(model) {
  const master = companionMaster(model);
  for (const kind of COMPANION_KINDS) {
    (model.data[kind] || []).forEach((b) => {
      const { calc, skills, attacks } = computeCompanion(kind, b, master, companionBonuses(model, kind, b));
      b.calc = calc;
      b.skills = skills;
      b.attacks = attacks;
    });
  }
}

/**
 * Another companion of this kind -- what the minionmancer's Add button does.
 *
 * The block starts as the kind's default; the id it will answer to in a
 * formula is coined here and never changes afterwards, the way a tracker's
 * is: the kind's own name for the first of a kind, then the kind with a
 * number appended -- eidolon2, eidolon3 -- the lowest not in use. The ids
 * are top-level names in the scope, so they are kept unique across every
 * kind. Neither a rename nor a reordering of the list moves one.
 */
export function addCompanion(model, kind) {
  const list = model.data[kind] || (model.data[kind] = []);
  const taken = new Set(COMPANION_KINDS.flatMap((k) => (model.data[k] || []).map((b) => String(b.id))));
  let id = kind;
  for (let n = 2; taken.has(id); n++) id = `${kind}${n}`;
  const block = { ...defaultCompanion(kind), id };
  list.push(block);
  model.recompute();
  return block;
}

/** One kind's block by its place in the list, however the caller counted. */
const blockAt = (model, kind, index) => (model.data[kind] || [])[Math.max(0, Math.floor(Number(index) || 0))];

/** The companion takes damage (temporary points first), heals, or rests. */
export function companionDamage(model, kind, index, amount) {
  const b = blockAt(model, kind, index);
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

export function companionHeal(model, kind, index, amount) {
  const b = blockAt(model, kind, index);
  if (!b) return model;
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const hp = b.hp || (b.hp = { damage: 0, temp: 0, bonus: 0 });
  hp.damage = Math.max(0, (Number(hp.damage) || 0) - n);
  return model.recompute();
}

export function companionRest(model, kind, index) {
  const b = blockAt(model, kind, index);
  if (!b) return model;
  b.hp = { ...(b.hp || {}), damage: 0, temp: 0 };
  return model.recompute();
}
