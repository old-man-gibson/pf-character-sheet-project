/**
 * proficiency.js -- whether the character is proficient with a weapon row.
 *
 * Read by the attack figures and by a saved-figure correction. It lived in
 * document.js, which the attack figures then imported for this one function.
 */

/**
 * Whether the character is proficient with a weapon row, and why.
 *
 * Returns `{ state, why, source }`: `state` is `true` on any match, `false`
 * when the row is described (a familiarity, group or base weapon is set) and
 * nothing covers it, and `null` when there is nothing to judge by. `source`
 * says where the answer came from -- `override` (the row's own Proficient
 * field), `veil` (the [Enhanced] veil rule), `overview` (the Proficiencies
 * panel) -- so the sheet can show the ones that are not the plain reading.
 *
 * Read in this order:
 *  - the row's own Proficient field, Yes or No, with its note (Custom
 *    Training, a class feature, anything the lists cannot say);
 *  - the [Enhanced] veil rule: a veilweaver is always proficient with the
 *    weapon a veil creates, so a row in the Veil group, or naming [Enhanced],
 *    is proficient with no list consulted;
 *  - the Overview's specific weapons, against the row's name and its base
 *    weapon ("As: katana") -- and against a group the fixed list does not know;
 *  - the row's familiarity, handedness and groups against the chips.
 * Handedness alone does not describe a weapon well enough to refuse it.
 */
export function weaponProficient(prof, w) {
  const none = { state: null, why: '', source: null };
  if (!w) return none;
  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const note = String(w.proficiencyNote || '').trim();
  if (w.proficiency === 'yes') return { state: true, why: note ? `proficient via ${note}` : 'marked proficient on the row', source: 'override' };
  if (w.proficiency === 'no') return { state: false, why: note ? `not proficient — ${note}` : 'marked not proficient on the row', source: 'override' };

  const groups = (w.groups || []).filter(Boolean);
  const text = `${w.name || ''} ${w.special || ''}`;
  if (groups.some((g) => eq(g, 'Veil')) || /\[\s*enhanced\b|\benhanced\s*\]|\benhanced veil\b/i.test(text)) {
    return {
      state: true, source: 'veil',
      why: 'a veil weapon — a veilweaver is always proficient with the armor, shield or weapon an [Enhanced] veil creates',
    };
  }

  if (!prof) return none;
  const recorded = ['familiarities', 'handedness', 'groups', 'weapons', 'armor', 'shields']
    .some((k) => (prof[k] || []).length) || String(prof.notes || '').trim();
  if (!recorded) return none;
  const name = String(w.name || '').trim().toLowerCase();
  const base = String(w.baseWeapon || '').trim().toLowerCase();
  const hit = (prof.weapons || []).find((x) => {
    const n = String(x).trim().toLowerCase();
    if (!n) return false;
    if (base && (n === base || base.includes(n) || n.includes(base))) return true;
    if (name && (n === name || name.includes(n) || n.includes(name))) return true;
    return groups.some((g) => eq(g, n));
  });
  if (hit) return { state: true, why: `${hit} on the Overview`, source: 'overview' };
  if (w.familiarity && (prof.familiarities || []).some((f) => eq(f, w.familiarity))) {
    return { state: true, why: `${w.familiarity.toLowerCase()} weapons on the Overview`, source: 'overview' };
  }
  if (w.handedness && (prof.handedness || []).some((h) => eq(h, w.handedness))) {
    return { state: true, why: `${w.handedness.toLowerCase()} weapons on the Overview`, source: 'overview' };
  }
  const g = groups.find((x) => (prof.groups || []).some((y) => eq(x, y)));
  if (g) return { state: true, why: `the ${g} group on the Overview`, source: 'overview' };
  return (w.familiarity || groups.length || base)
    ? { state: false, why: 'nothing on the Overview\'s Proficiencies covers this weapon\'s familiarity, handedness, group, name or base weapon', source: 'overview' }
    : none;
}
