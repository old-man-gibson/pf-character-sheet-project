/**
 * Primordia: the technique ladder and its prerequisites.
 *
 * Techniques are granted at fixed levels and each has prerequisites that read
 * the rest of the sheet, so this pass runs last of the sub-systems.
 */

import {
  PRIMORDIA_LEVELS, PRIMORDIA_REPEAT_FROM, grantCount, primordiaGrantsAt, primordiaTechnique,
} from '../../rules.js';

// The technique ladder is the rules table plus what the player wrote on it,
// so only the writing is saved.
export const PRIMORDIA_DERIVED = ['calc'];

/**
 * Is the chosen technique's prerequisite met?
 *
 * Advisory, never a gate. Three of the five can be answered outright from
 * what the sheet models; the other two cannot always be, and a technique the
 * player has plainly been using for fifteen levels is not the place to start
 * arguing -- so an answer this cannot reach is `unknown` and says why, rather
 * than a "no" that is really "I could not tell".
 */
export function primordiaPrereq(model, technique) {
  const c = model.data;
  const key = technique?.prereq?.key;
  const met = (detail) => ({ state: 'met', detail });
  const unmet = (detail) => ({ state: 'unmet', detail });
  const unknown = (detail) => ({ state: 'unknown', detail });

  if (key === 'bab') {
    const best = Math.max(0, ...(c.classes || []).filter((x) => x.name).map((x) => Number(x.bab) || 0));
    if (!best) return unknown('No class on the Overview names a BAB progression.');
    const label = best >= 1 ? 'full' : `${Math.round(best * 4)}/4`;
    return best >= 0.75 ? met(`Best BAB progression is ${label}.`)
      : unmet(`Best BAB progression is ${label}.`);
  }
  if (key === 'spherecasting') {
    const casters = (c.training?.magic?.classes || []).filter((x) => x.name);
    const good = casters.filter((x) => ['Mid', 'High'].includes(x.effectiveType));
    if (good.length) return met(`${good.map((x) => `${x.name} (${x.effectiveType})`).join(', ')}.`);
    // Advanced Magic Training casts as a Low caster, or Mid with the mythic one.
    if (c.training?.magic?.mythicAmt) return met('Mythic Advanced Magic Training casts as Mid.');
    return casters.length
      ? unmet(`${casters.map((x) => x.name).join(', ')} — none casts at Mid or High.`)
      : unmet('No spherecasting class on the Spheres & Magic tab.');
  }
  if (key === 'vancian') {
    const named = (c.vancian?.classes || []).filter((x) => String(x.name || '').trim());
    return named.length
      ? met(`${named.map((x) => x.name).join(', ')} on the Vancian tab.`)
      : unmet('No casting class on the Vancian tab.');
  }
  if (key === 'armor') {
    const p = c.identity?.proficiencies || {};
    const armor = p.armor || [];
    if (!armor.length) {
      return /armor/i.test(p.notes || '')
        ? unknown(`Armor proficiency on the Overview is only a note: ${p.notes}`)
        : unknown('Armor proficiency is blank on the Overview.');
    }
    const label = `${armor.join(', ')} armor`;
    return armor.some((a) => /^(?:medium|heavy)$/i.test(a)) ? met(label) : unmet(label);
  }
  if (key === 'psionics') {
    return unknown('Psionics is a plain worksheet here, so manifesting is not something '
      + 'the sheet can check.');
  }
  return unknown('');
}

/**
 * The technique ladder: one row per granting level, each carrying what the
 * rules hand over there and what the player wrote against it.
 *
 * Everything on it is rebuilt from the rules table and the character's level,
 * so the only thing stored is the writing -- the same bargain the Akashic and
 * Maneuvers tabs made with their worksheets.
 */
export function recomputePrimordia(model) {
  const c = model.data;
  const p = c.primordia || (c.primordia = { picks: {}, alt: {}, notes: '' });
  const level = Number(c.identity.level) || 0;
  const technique = primordiaTechnique(c.identity.primordiaTechnique);

  const counts = {
    talent: 0, feat: 0, spell: 0, power: 0, due: 0, planned: 0,
  };
  const rows = PRIMORDIA_LEVELS.map((lvl) => {
    const reached = lvl <= level;
    const grants = primordiaGrantsAt(technique, lvl).map((g) => {
      // "If they already possess it, they instead gain…": one grant with two
      // faces, and which one is live decides what the ladder counts. The
      // branch *replaces* the grant rather than adding to it, so the kinds
      // come off before the alternative's go on -- a feat swapped for a
      // spell is one thing gained, not two.
      if (!g.alt || !p.alt[lvl]) return { ...g, base: g, alt: false };
      const {
        talent, feat, spell, power, ...rest
      } = g;
      return { ...rest, ...g.alt, base: g, alt: true };
    });
    const text = String(p.picks[lvl] ?? '');
    const pick = grants.find((g) => g.pick)?.pick || null;
    /*
     * What the rules already named at this level.
     *
     * A level that hands over Detect Spellcaster has said which talent it is,
     * so the name column can say so too rather than leaving the player to
     * copy it across from the sentence beside it. Levels that only offer a
     * choice name nothing, and their column stays a question.
     */
    const auto = grants.map((g) => g.name).filter(Boolean).join(' + ');
    const filled = text.trim() !== '';
    const due = !!pick && reached && !filled;

    if (reached) {
      for (const g of grants) {
        for (const kind of ['talent', 'feat', 'spell', 'power']) {
          counts[kind] += grantCount(g, kind);
        }
      }
      if (due) counts.due += 1;
    } else if (pick && !filled) counts.planned += 1;

    return {
      level: lvl,
      repeating: lvl >= PRIMORDIA_REPEAT_FROM,
      grants,
      pick,
      text,
      auto,
      // The name that stands in the column when nothing has been typed over
      // it: what the player wrote, or failing that what the rules named.
      name: text.trim() || auto,
      note: String(p.rowNotes?.[lvl] ?? ''),
      reached,
      filled,
      due,
    };
  });

  p.calc = {
    technique: technique?.name || null,
    unknown: !technique && !!String(c.identity.primordiaTechnique || '').trim(),
    note: technique?.note || '',
    // Printed once under the ladder, because it lands on seven rows.
    repeat: technique?.repeat || null,
    prereq: technique ? { text: technique.prereq.text, ...primordiaPrereq(model, technique) } : null,
    talents: primordiaTalents(model),
    counts,
    rows,
  };
}

/**
 * The sphere talents a Primordia Technique has granted so far, as
 * `{ side, sphere, count }`, or null for a technique that grants none.
 *
 * A talent arrives with its level whether or not the player has got round to
 * naming which one it is, so this counts granting levels reached rather than
 * filled-in picks -- the empty ones are what the ladder reports as owed.
 */
export function primordiaTalents(model) {
  const t = primordiaTechnique(model.data.identity?.primordiaTechnique);
  if (!t?.talents) return null;
  const level = Number(model.data.identity.level) || 0;
  const count = PRIMORDIA_LEVELS
    .filter((l) => l <= level)
    .reduce((n, l) => n + primordiaGrantsAt(t, l).reduce((k, g) => k + grantCount(g, 'talent'), 0), 0);
  return count ? { ...t.talents, count } : null;
}
