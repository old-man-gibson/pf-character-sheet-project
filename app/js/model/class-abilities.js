/**
 * The ability a class's own pages name for its veilweaving and practitioner
 * modifiers, checked against the player's pick.
 *
 * Packs are read in extension-runtime.js (classAbilitiesFromPacks) and the
 * readings registered here. Nothing is changed: a pick that differs gets a
 * note beside it, and the sheet goes on using the pick.
 */

import { ABILITIES, abilityOf, statMod } from '../rules.js';
import { normalizeName } from './util.js';

/** Class readings by class name; archetype readings by archetype name, one per class. */
let CLASSES = new Map();
let ARCHETYPES = new Map();

/**
 * Register what the packs' pages say:
 * `[{ kind: 'class' | 'archetype', name, class?, veilweaving?, practitioner?, swap? }]`.
 */
export function setClassAbilities(list) {
  CLASSES = new Map();
  ARCHETYPES = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const key = normalizeName(r?.name);
    if (!key) continue;
    if (r.kind === 'class') CLASSES.set(key, r);
    else if (r.kind === 'archetype') {
      if (!ARCHETYPES.has(key)) ARCHETYPES.set(key, []);
      ARCHETYPES.get(key).push({ ...r, classKey: normalizeName(r.class) });
    }
  }
}

/** Where each side's picks are: the Akashic tab's class rows, the Martial tab's classes. */
const SIDES = {
  veilweaving: { rows: (d) => d.akashic?.classes, pick: 'mod' },
  practitioner: { rows: (d) => d.training?.combat?.classes, pick: 'mod1' },
};

/**
 * An archetype on a class: the reading for that class, or, when no pack
 * lists it for that class, the one reading under its name.
 */
function archetypeOn(name, classKey) {
  const all = ARCHETYPES.get(normalizeName(name)) || [];
  return all.find((r) => r.classKey === classKey) || (all.length === 1 ? all[0] : null);
}

/**
 * The ability `side` ('veilweaving' or 'practitioner') of class `className`
 * should use, as its pages say: the class page, then the archetypes in its
 * Archetypes cell on the Classes table, each one that names the ability
 * standing over the class, then any that swaps it ("in place of their
 * Wisdom modifier for all of their shardweaver class features"). "Their
 * casting ability" is the class's casting ability on the Magic tab.
 *
 * `{ ability: 'wis', source: 'Shardweaver', casting }` (`source` is the class
 * or the archetype that decided it), or null where the pages name none, offer
 * a choice, or point at a casting ability the Magic tab does not give.
 */
export function classAbility(model, className, side) {
  const key = normalizeName(className);
  if (!key || !SIDES[side]) return null;
  const d = model.data;
  const base = CLASSES.get(key);
  let answer = base?.[side];
  let source = base ? String(base.name).trim() : String(className).trim();
  const row = (d.classes || []).find((c) => normalizeName(c?.name) === key);
  const archetypes = String(row?.archetypes ?? '').split(',').map((n) => n.trim()).filter(Boolean)
    .map((n) => archetypeOn(n, key)).filter(Boolean);
  for (const a of archetypes) {
    if (a[side] !== undefined) {
      answer = a[side];
      source = String(a.name).trim();
    }
  }
  for (const a of archetypes) {
    if (a.swap && answer === a.swap.from) {
      answer = a.swap.to;
      source = String(a.name).trim();
    }
  }
  if (answer === 'casting') {
    const caster = (d.training?.magic?.classes || []).find((c) => normalizeName(c?.name) === key);
    const ability = abilityOf(caster?.mod1);
    return ability ? { ability, source, casting: true } : null;
  }
  return ABILITIES.includes(answer) ? { ability: answer, source, casting: false } : null;
}

/**
 * The note for row `index` of one side's picks: what its class's pages name,
 * when the row's pick differs. Null when they agree, when nothing is picked,
 * or when the pages name no single ability.
 *
 * A character with several of these modifiers uses the highest. A pick that
 * is the highest of the abilities the character's classes name stands on
 * every row: two classes naming Intelligence and Wisdom may both use
 * Intelligence when it is the higher.
 */
export function abilityHint(model, side, index) {
  const at = SIDES[side];
  const rows = at?.rows(model.data) || [];
  const row = rows[index];
  const picked = abilityOf(row?.[at?.pick]);
  if (!picked) return null;
  const want = classAbility(model, row.name, side);
  if (!want || want.ability === picked) return null;
  const named = new Set(rows.map((r) => classAbility(model, r?.name, side)?.ability).filter(Boolean));
  const best = Math.max(...[...named].map((k) => statMod(model.data, k, null)));
  if (named.has(picked) && statMod(model.data, picked, null) === best) return null;
  return want;
}
