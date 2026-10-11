/**
 * Caster level transparency, by choice.
 *
 * The Spheres of Power caster level, each Vancian class's caster level and
 * each manifesting class's manifester level are separate numbers, and stay
 * so unless a player marks one as counting toward another. A mark is kept on
 * the level that counts (`countsToward`, a list of the names it counts
 * toward) and becomes the bonus a player could write in a note:
 * `{spheres.cl += vancian.wizard.cl}`. So it is worked out, shown on the
 * level it lands on and listed on the Formulas tab exactly as a written one
 * would be.
 *
 * A bonus aimed at a caster level is worked out from the figures the sheet
 * had before any bonus applied (see resolveInlineNames), so a level marked
 * both ways counts each side's own levels once and never feeds itself:
 * Wizard 5 and Psion 3, each counting toward the other, are 8 and 8.
 */

import { manifesterForwardKey, vancianForwardKey } from './util.js';

/**
 * Every caster level on the character a mark can come from or go to:
 * `{ name, label, tab, holder }`, with `holder` the block whose
 * `countsToward` keeps the marks. The Spheres caster level is one once the
 * character can cast with spheres; each named Vancian and manifesting class
 * is one.
 */
export function casterLevelSources(model) {
  const d = model.data;
  const out = [];
  const magic = d.training?.magic;
  if (magic?.castingUnlocked) out.push({ name: 'spheres.cl', label: 'Sphere caster level', tab: 'magic', holder: magic });
  for (const c of d.vancian?.classes || []) {
    const name = vancianForwardKey(c);
    if (name && !out.some((s) => s.name === name)) {
      out.push({ name, label: `${String(c.name || c.slotType).trim()} caster level`, tab: 'vancian', holder: c });
    }
  }
  for (const c of d.psionics?.classes || []) {
    const name = manifesterForwardKey(c);
    if (name && !out.some((s) => s.name === name)) {
      out.push({ name, label: `${String(c.name).trim()} manifester level`, tab: 'psionics', holder: c });
    }
  }
  return out;
}

/** The names a caster level is marked to count toward. */
export const countsToward = (holder) => (Array.isArray(holder?.countsToward)
  ? holder.countsToward.filter((t) => typeof t === 'string' && t)
  : []);

/**
 * The marks as prose sources, `{ path, text }`, for the prose walk: each the
 * bonus it stands for. The path names both ends, `transparency:<from>:<to>`.
 */
export function transparencySources(model) {
  const out = [];
  for (const s of casterLevelSources(model)) {
    for (const to of new Set(countsToward(s.holder))) {
      if (to !== s.name) out.push({ path: `transparency:${s.name}:${to}`, text: `{${to} += ${s.name}}` });
    }
  }
  return out;
}

/** Mark one caster level as counting toward another, or take the mark off. */
export function toggleCountsToward(model, from, to) {
  const source = casterLevelSources(model).find((s) => s.name === from);
  if (!source || !to || to === from) return model;
  const marks = countsToward(source.holder);
  const next = marks.includes(to) ? marks.filter((t) => t !== to) : [...marks, to];
  // Nothing saved for a level that counts toward nothing: separate is the default.
  if (next.length) source.holder.countsToward = next;
  else delete source.holder.countsToward;
  model.recompute();
  return model;
}

/** What a caster level is called from its name alone, for a source line: "Wizard caster level". */
export function casterLevelLabel(name) {
  const [system, key] = String(name || '').split('.');
  const words = String(key || '').split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  if (system === 'spheres') return 'Sphere caster level';
  if (system === 'vancian') return `${words} caster level`;
  if (system === 'manifester') return `${words} manifester level`;
  return String(name || '');
}
