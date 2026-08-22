/**
 * Spheres of Power and Might: the training pass.
 *
 * Talents come from several ladders at once (class progression, feats,
 * traditions, drawbacks bought off, customizations), and the sphere skill
 * ranks they grant feed back into the skills. This is the pass that counts
 * them, works out what is known, and pairs blended training.
 */

import {
  RANKS_PER_TALENT, SPHERE_SKILL_RANKS, TALENTS_TO_TYPE, TALENT_RATES, TRACK_SPHERE_SIDES,
  TYPE_RATES, TYPE_TO_TALENTS, boonStep, drawbackWeight, isBasePick, normalizeTalentTracks,
  spBoonPoints, sphereSide, sphereSkillLabel, sphereSkillRequirement, sphereSkillSpheres,
  statMod, tempEssenceCost, trackCount, trackSpheres,
} from '../rules.js';
import { emit } from './events.js';
import { plannerHasClass } from './progression.js';
import { forwarded } from './scope.js';
import { recomputeUnarmed } from './stats/attacks.js';
import { primordiaTalents } from './subsystems/primordia.js';
import { techniqueTalents } from './subsystems/techniques.js';
import { closestName, normalizeName, slug } from './util.js';

/* ------------------------------------------------------------------ *
 * The sphere catalogue.
 *
 * What a sphere *is* -- its base abilities and every talent in it -- is
 * content, so it arrives in an extension pack like the discipline catalogue
 * and is read where it stands rather than copied onto a character. The sheet
 * has always let a talent be typed in free-hand and still does; this is what
 * lets it eventually offer the list instead, and what makes a talent's tags
 * (`(counter)`, `(stance)`) and its source (`[3PP]`, `[Apoc]`) available to
 * anything that wants to search or filter by them.
 *
 * Note that `rules.js` still hard-codes the *names* of the spheres, because
 * skill-rank and unarmed logic key off them. This catalogue is the other
 * half -- their contents -- and the two are not yet joined up.
 * ------------------------------------------------------------------ */

let SPHERE_CATALOGUE = { spheres: [] };

/** Register the shared catalogue. Call before constructing a Character. */
export function setSphereCatalogue(doc) {
  const list = Array.isArray(doc?.spheres) ? doc.spheres : [];
  SPHERE_CATALOGUE = {
    spheres: list.map((s) => ({
      name: String(s.name || ''),
      // 'combat' or 'magic', the two sides the sheet already counts
      // separately; '' when a page never said.
      kind: s.kind === 'combat' || s.kind === 'magic' ? s.kind : '',
      description: String(s.description || ''),
      abilities: (s.abilities || []).map((a) => ({
        name: String(a.name || ''), text: String(a.text || ''),
      })),
      talents: (s.talents || []).map((t) => ({
        name: String(t.name || ''),
        group: String(t.group || ''),
        tags: (t.tags || []).map(String),
        sources: (t.sources || []).map(String),
        prerequisites: String(t.prerequisites || ''),
        text: String(t.text || ''),
      })),
    })),
  };
}

export function sphereCatalogue() {
  return SPHERE_CATALOGUE;
}

/** One sphere by name, however it was capitalised. */
export function sphereEntry(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return SPHERE_CATALOGUE.spheres.find((s) => s.name.trim().toLowerCase() === key) || null;
}

/** Every talent a sphere holds, or all of them when no sphere is named. */
export function sphereTalents(name = null) {
  if (name === null) {
    return SPHERE_CATALOGUE.spheres.flatMap((s) => s.talents.map((t) => ({ ...t, sphere: s.name })));
  }
  const s = sphereEntry(name);
  return s ? s.talents.map((t) => ({ ...t, sphere: s.name })) : [];
}

/**
 * Talents carrying a tag or a source, case-insensitively -- every `(counter)`
 * across every sphere, or everything a table wants to rule out because it
 * came from `[3PP]`. Both lists are searched, since which of the two a wiki
 * wrote a label in is its business rather than the reader's.
 */
export function talentsTagged(tag) {
  const key = String(tag || '').trim().toLowerCase();
  if (!key) return [];
  return sphereTalents().filter((t) => [...t.tags, ...t.sources]
    .some((x) => String(x).trim().toLowerCase() === key));
}

/**
 * A talent's name as it is matched: case, spacing and any trailing tag off.
 *
 * A player writes what the book calls it, which is not always what the wiki's
 * heading called it -- "Reaping (greater)", "reaping", "Reaping  ". The tags
 * go because the catalogue already keeps them in a field of their own.
 */
const talentKey = (s) => String(s ?? '')
  .replace(/\s*(?:\([^()]*\)|\[[^\][]*\])\s*$/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * What the catalogue knows about a talent somebody typed on their sheet.
 *
 * The row's own sphere is asked first. With no sphere on the row the whole
 * catalogue is searched, and an answer comes back only if exactly one sphere
 * has a talent by that name -- naming the sphere is then something the sheet
 * can tell the player rather than something it has to be told.
 */
export function sphereTalent(sphere, talent) {
  const key = talentKey(talent);
  if (!key) return null;
  const named = sphereEntry(sphere);
  if (named) {
    const hit = named.talents.find((t) => talentKey(t.name) === key);
    return hit ? { ...hit, sphere: named.name } : null;
  }
  if (String(sphere ?? '').trim()) return null;      // a sphere it does not carry
  const all = sphereTalents().filter((t) => talentKey(t.name) === key);
  return all.length === 1 ? all[0] : null;
}

/**
 * The spheres a picker offers: the names the engine knows, then any a pack
 * carries that it does not. `side` is 'combat', 'magic', or null for both; a
 * pack sphere whose page never said which side it was on is offered either
 * way, since a name in the wrong list is easier to ignore than one missing
 * from the right one.
 */
export function sphereNames(base, side = null) {
  const have = new Set((base || []).map((s) => String(s).trim().toLowerCase()));
  const extra = SPHERE_CATALOGUE.spheres
    .filter((s) => s.name && !have.has(s.name.trim().toLowerCase()))
    .filter((s) => !side || !s.kind || s.kind === side)
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b));
  // Appended rather than merged in: the built-in lists put their third-party
  // spheres at the end too, so "not one of the core ones" keeps reading as a
  // position in the list.
  return extra.length ? [...(base || []), ...extra] : (base || []);
}

/**
 * What taking a sphere itself gets you, for the row that records it.
 *
 * A base pick is not a talent -- it is the sphere, and what it grants is the
 * sphere's base abilities. The row reads as the sphere and what it opened
 * (`Destruction Sphere (Destructive Blast)`), which is the name a player
 * scanning their own list wants; the abilities' full text is far too long for
 * a name, so it goes in the note beside it where the rest of the rules live.
 *
 * `isBasePick` already reads that shape as a base pick -- it strips
 * parentheses before looking for the word -- so the label counts as one for
 * the sphere tallies the moment it is written.
 */
export function sphereBasePick(sphere) {
  const s = sphereEntry(sphere);
  if (!s || !s.abilities.length) return null;
  return {
    sphere: s.name,
    label: `${s.name} Sphere (${s.abilities.map((a) => a.name).join(', ')})`,
    // Each ability under its own name: with one it reads as a heading, and
    // with several it is the only thing telling them apart.
    text: s.abilities.map((a) => `${a.name}: ${a.text}`).join('\n\n'),
  };
}

/**
 * The sphere a base pick names, from the row's own text or its sphere cell.
 * "Destruction Sphere" and "Destruction Sphere (…)" both mean Destruction.
 */
export const basePickSphere = (talent, sphere) => {
  const named = String(talent ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bspheres?\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sphereEntry(named) ? named : sphere;
};

/**
 * Write a talent, and fill in what the catalogue can answer for free.
 *
 * A row has three parts and typing the first often settles the other two: the
 * sphere a talent belongs to is a fact, and its effect is what the player was
 * about to go and look up. So when a name matches, an **empty** sphere and an
 * **empty** notes cell are filled from the catalogue.
 *
 * Only empty ones, ever. What a player wrote is theirs -- a note is where the
 * table's own ruling goes, and having that overwritten by a book would be
 * worse than never filling anything. Emptying a cell and leaving the talent
 * alone leaves it empty; retyping the talent fills it again, which is the
 * only way to ask for it back.
 *
 * `fields` names the row's own columns, because they differ: a customized
 * weapon and a martial tradition have a sphere and no notes.
 */
export function setTalentEntry(model, path, index, value, fields = {}) {
  const { sphere: sphereField = 'sphere', notes: notesField = null } = fields;
  const row = model.list(path)?.[index];
  if (!row || typeof row !== 'object') return model;

  row.talent = String(value ?? '');
  const filled = [];

  /*
   * A base sphere pick is the sphere itself, not a talent in it. What it
   * grants is the sphere's base abilities, so the row reads as the sphere and
   * what it opened -- "Destruction Sphere (Destructive Blast)" -- and the
   * abilities' full text goes in the note.
   *
   * The label is only written over a pick that has no parenthesis of its own:
   * somebody who wrote "Destruction Sphere (from the feat)" said something,
   * and it is not ours to replace.
   */
  const base = isBasePick(row.talent)
    ? sphereBasePick(basePickSphere(row.talent, sphereField ? row[sphereField] : null))
    : null;
  if (base) {
    if (!/\(/.test(row.talent)) { row.talent = base.label; filled.push('talent'); }
    if (sphereField && !String(row[sphereField] ?? '').trim()) {
      row[sphereField] = base.sphere;
      filled.push('sphere');
    }
    if (notesField && !String(row[notesField] ?? '').trim()) {
      row[notesField] = base.text;
      filled.push('notes');
    }
  }

  const hit = base ? null : sphereTalent(sphereField ? row[sphereField] : null, row.talent);
  if (hit) {
    if (sphereField && !String(row[sphereField] ?? '').trim()) {
      row[sphereField] = hit.sphere;
      filled.push('sphere');
    }
    if (notesField && !String(row[notesField] ?? '').trim() && hit.text) {
      row[notesField] = hit.text;
      filled.push('notes');
    }
  }
  model.recompute();
  emit(model, {
    type: 'set-item', path, index, field: 'talent', value: row.talent, filled,
  });
  return model;
}

/** Every tag and source in the catalogue, with how many talents carry each. */
export function talentTagCounts() {
  const out = new Map();
  for (const t of sphereTalents()) {
    for (const x of [...t.tags, ...t.sources]) {
      const k = String(x).trim();
      if (k) out.set(k, (out.get(k) || 0) + 1);
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
}

/** A talent row nobody has written anything into. */
const isBlankTalentRow = (row) => !String(row?.talent ?? '').trim()
  && !String(row?.sphere ?? '').trim() && !String(row?.notes ?? '').trim();

/**
 * Skill-rank budget: ranks/level (best class, gestalt) + Int bonus/level +
 * bonus points/level, times character level, against the ranks bought.
 */
export function applyBudget(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const b = c.skillBudget || (c.skillBudget = { bonusPerLevel: 0, intPerLevel: 0 });
  const perLevel = (c.gestalt?.ranksPerLevel || 0)
    + (Number(b.intPerLevel) || 0) + (Number(b.bonusPerLevel) || 0);
  const available = perLevel * level;
  const assigned = (c.skills || []).reduce(
    (t, s) => t + (Number(s.boughtResolved) || 0), 0,
  );
  b.perLevel = perLevel;
  b.available = available;
  b.assigned = assigned;
  b.remaining = available - assigned;
  b.status = assigned > available ? 'error' : assigned < available ? 'warning' : 'ok';
}

/**
 * A class's own levels at or below the character's.
 *
 * Not `classLevelCount`, which adds the "counts as levels higher"
 * forwarding: a talent budget is deliberately not moved by an
 * effective-level rule, the same line the casting block draws, and for the
 * same reason -- counting as two levels higher says what the class can do,
 * not that it was handed two more levels to spend.
 */
export function ownClassLevels(model, className) {
  const match = closestName(className, model.progressionClasses());
  if (!match) return 0;
  const cap = Number(model.data.identity?.level) || 20;
  return model.classLevelsIn(match).filter((lvl) => lvl <= cap).length;
}

/**
 * Size each parallel talent track, and settle which one is live.
 *
 * The counts are computed and never stored, exactly as a class ladder's
 * granted rows are: taking the next armiger level opens the next weapon and
 * one more row on every weapon at once, and losing it folds them shut again
 * with what was written in them still there.
 *
 * A weapon carrying a drawback holds one extra row, because that is what a
 * drawback on a weapon-granted sphere is for; buying it off spends the row
 * again, which is why the tick is beside the drawback rather than replacing
 * it.
 */
export function recomputeCustomizations(model, side) {
  if (!Array.isArray(side.customizations)) side.customizations = [];
  for (const block of side.customizations) {
    const spec = normalizeTalentTracks(block.spec) || normalizeTalentTracks({});
    block.spec = spec;
    block.classLevels = ownClassLevels(model, block.className);
    block.setCount = trackCount(spec.sets, block.classLevels);
    block.talentCount = trackCount(spec.talents, block.classLevels);

    if (!Array.isArray(block.sets)) block.sets = [];
    while (block.sets.length < block.setCount) block.sets.push({ weapon: '', talents: [] });
    block.sets.forEach((set, i) => {
      // A set past the count is one the character used to be able to keep --
      // a level lost to a rebuild, an override typed down. It is greyed and
      // counts for nothing, but it is not thrown away.
      set.spare = i >= block.setCount;
      set.drawback = String(set.drawback ?? '');
      set.boughtOff = !!set.boughtOff;
      set.bonusTalent = set.drawback.trim() && !set.boughtOff ? 1 : 0;
      const rows = set.spare ? 0 : block.talentCount + set.bonusTalent;
      if (!Array.isArray(set.talents)) set.talents = [];
      while (set.talents.length < rows) set.talents.push({ talent: '', sphere: null, notes: '' });
      // A row that closed with nothing in it was never anything; one that
      // closed with a talent written on it is kept and greyed, so a level
      // typed down by mistake costs nobody their notes.
      while (set.talents.length > rows && isBlankTalentRow(set.talents[set.talents.length - 1])) {
        set.talents.pop();
      }
      set.talents.forEach((row, ri) => { row.granted = ri < rows; });
    });
    // The same for a weapon nobody ever named.
    while (block.sets.length > block.setCount
      && block.sets[block.sets.length - 1].spare
      && !String(block.sets[block.sets.length - 1].weapon || '').trim()
      && !(block.sets[block.sets.length - 1].talents || []).length) {
      block.sets.pop();
    }
    // The switch must land on a weapon that exists. It stays where it is
    // whenever it can, so opening a fourth weapon never moves what is drawn.
    const live = Math.floor(Number(block.active) || 0);
    block.active = block.setCount ? Math.min(Math.max(0, live), block.setCount - 1) : 0;
  }
}

/**
 * Flag the rule that actually bites: a weapon may not learn a talent of a
 * sphere it has no base in.
 *
 * "A customized weapon must possess a base sphere before additional talents
 * of that sphere may be added unless the armiger possesses that sphere" --
 * so the question is asked of the weapon first and of the character second,
 * and the character's half reads `tallyOwn`, since a sphere she only has
 * from *another* weapon is not one she possesses.
 *
 * Three-valued like every other requirement here: a row with no talent
 * written in it yet is unknown, not wrong, and is left alone.
 */
export function checkCustomizationBases(model, t) {
  const owned = (sphere) => ((t.combat?.tallyOwn || {})[sphere] || 0) > 0
    || ((t.magic?.tallyOwn || {})[sphere] || 0) > 0;
  for (const block of t.combat?.customizations || []) {
    // What the track may learn from at all. A sphere outside it is flagged
    // and kept, never dropped: it is nearly always a track whose archetype
    // has not been added yet, and throwing the row away would lose the
    // player's work to punish them for the order they did things in.
    const allowed = new Set(trackSpheres(block.spec));
    for (const set of block.sets || []) {
      const bases = new Set((set.talents || [])
        .filter((r) => r.granted !== false && isBasePick(r.talent))
        .map((r) => String(r.sphere || '').trim())
        .filter(Boolean));
      for (const row of set.talents || []) {
        const sphere = String(row.sphere || '').trim();
        row.offList = !!sphere && row.granted !== false && !allowed.has(sphere);
        row.needsBase = !!sphere && !!String(row.talent || '').trim()
          && row.granted !== false && !isBasePick(row.talent)
          && !bases.has(sphere) && !owned(sphere);
      }
    }
  }
}

/**
 * Start a track for a class, or hand its spec to the one already there.
 *
 * A pack's class block carries the spec, and attaching copies it in like
 * everything else a pack lands, so the character travels without the pack.
 * Adding the same class twice tunes what is there rather than making a
 * second block -- a class grants its customizations once.
 */
export function addCustomization(model, className, spec = {}) {
  const t = model.data.training;
  if (!t?.combat) return null;
  if (!Array.isArray(t.combat.customizations)) t.combat.customizations = [];
  const name = String(className ?? '').trim();
  const at = t.combat.customizations.findIndex((b) => normalizeName(b.className) === normalizeName(name));
  const block = at === -1
    ? { className: name, active: 0, sets: [] }
    : t.combat.customizations[at];
  block.spec = normalizeTalentTracks(spec) || normalizeTalentTracks({});
  if (at === -1) t.combat.customizations.push(block);
  model.recompute();
  emit(model, { type: 'customization-add', className: name });
  return block;
}

/** The track a class grants, or null where it grants none. */
export function customizationFor(model, className) {
  return (model.data.training?.combat?.customizations || [])
    .find((b) => normalizeName(b.className) === normalizeName(className)) || null;
}

/**
 * Change an existing track's spec, and hand back what it was.
 *
 * Only a track that is there: this is the door an archetype comes through,
 * and an archetype that merely widens the sphere list has no counting rules
 * of its own to invent one with. The returned spec is what puts it back when
 * the archetype comes off.
 */
export function setCustomizationSpec(model, className, spec) {
  const block = model.customizationFor(className);
  if (!block) return null;
  const before = block.spec ? JSON.parse(JSON.stringify(block.spec)) : null;
  block.spec = normalizeTalentTracks(spec) || normalizeTalentTracks({});
  model.recompute();
  emit(model, { type: 'customization-spec', className, spec: block.spec });
  return before;
}

export function removeCustomization(model, index) {
  const list = model.data.training?.combat?.customizations;
  if (!list?.[index]) return model;
  list.splice(index, 1);
  model.recompute();
  emit(model, { type: 'customization-remove', index });
  return model;
}

/**
 * Edit one of the two counting rules. `key` is 'sets' or 'talents', `field`
 * its start or the levels it goes up at.
 */
export function setCustomizationRule(model, index, key, field, value) {
  const block = model.data.training?.combat?.customizations?.[index];
  if (!block) return model;
  if (!block.spec) block.spec = normalizeTalentTracks({});
  // Which sphere lists the track may learn from is a property of the track
  // rather than of either counting rule, so it comes through the same door
  // with no field of its own.
  if (key === 'spheres') {
    if (!TRACK_SPHERE_SIDES.includes(field)) return model;
    block.spec.spheres = field;
    model.recompute();
    emit(model, { type: 'customization-rule', index, key, field });
    return model;
  }
  if (!['sets', 'talents'].includes(key)) return model;
  if (field === 'start') block.spec[key].start = Math.max(0, Math.floor(Number(value) || 0));
  else if (field === 'gainsAt') block.spec[key].gainsAt = String(value ?? '').trim();
  else return model;
  model.recompute();
  emit(model, { type: 'customization-rule', index, key, field, value });
  return model;
}

/** Which weapon of a track is live. */
export function setCustomizationActive(model, index, setIndex) {
  const block = model.data.training?.combat?.customizations?.[index];
  if (!block) return model;
  block.active = Math.max(0, Math.floor(Number(setIndex) || 0));
  model.recompute();
  emit(model, { type: 'customization-active', index, setIndex: block.active });
  return model;
}

/**
 * Count sphere occurrences across a training side's talent sources.
 *
 * `side` is the side's own block, which does not say which side it is, so
 * technique talents -- the only source that has to know -- are keyed off the
 * caller's `sideKey`.
 */
export function sphereTally(model, side, { includeTradition = true, sideKey = null, customizations = 'active' } = {}) {
  const tally = {};
  const bump = (s, n = 1) => {
    if (typeof s === 'string' && s.trim()) tally[s.trim()] = (tally[s.trim()] || 0) + n;
  };
  // A blended class holds one pool of talents spent on either kind, so each
  // of its talents is counted once, on the side its sphere belongs to --
  // wherever the block itself happens to live. Its mirror on the other side
  // is the same pool seen twice and contributes nothing of its own.
  const blendedTalents = (cls) => {
    for (const lv of cls.levels || []) {
      if (sphereSide(lv.sphere, cls.side ?? sideKey) === sideKey) bump(lv.sphere);
    }
  };
  for (const cls of side.classes || []) {
    if (cls.blendedMirror) continue;
    if (cls.blended) blendedTalents(cls);
    else for (const lv of cls.levels || []) bump(lv.sphere);
  }
  if (sideKey) {
    const other = model.data.training?.[sideKey === 'magic' ? 'combat' : 'magic'];
    for (const cls of other?.classes || []) {
      if (cls.blended && !cls.blendedMirror) blendedTalents(cls);
    }
  }
  for (const b of side.bonusTalents || []) bump(b.sphere);
  if (includeTradition) {
    for (const e of side.tradition?.entries || []) bump(e.sphere);
  }
  // A parallel track -- an armiger's customized weapon -- is a talent source
  // with a switch, so it is the one source that has to be told which
  // question is being asked: what is live right now ('active'), everything
  // the tracks have been granted ('all'), or nothing of theirs at all
  // ('none' -- what the character possesses in her own right). A track lives
  // on the martial side whichever sphere it teaches, so each row lands on
  // the side its sphere belongs to, the way a blended class's talents do.
  if (customizations !== 'none') {
    for (const block of model.data.training?.combat?.customizations || []) {
      (block.sets || []).forEach((set, i) => {
        if (set.spare || (customizations === 'active' && i !== block.active)) return;
        for (const row of set.talents || []) {
          if (row.granted !== false && sphereSide(row.sphere, 'combat') === sideKey) bump(row.sphere);
        }
      });
    }
  }
  const technique = primordiaTalents(model);
  if (technique && technique.side === sideKey) bump(technique.sphere, technique.count);
  return tally;
}

/**
 * Tie the two halves of each blended class together.
 *
 * A class that trains both ways -- Angou's Legendary Monk, Bryva's
 * Blacksmith -- is one class with one pool of talents and two progressions:
 * it advances as a practitioner at one rate and as a caster at another, and
 * each talent it learns is martial or magical depending on the sphere. The
 * workbook writes it as a block on each tab holding the same talents twice,
 * which is where the doubled groups came from.
 *
 * Rather than merge the two records -- every per-side number, from the
 * practitioner DC to the spell-point pool, is computed off the block sitting
 * on that side -- the pair is kept and the talents are shared: the combat
 * half owns the rows and the magic half is pointed at the same array. One
 * list of talents, edited in one place, counted once.
 */
export function pairBlended(model) {
  const t = model.data.training || {};
  const magic = t.magic?.classes || [];
  for (const cls of t.combat?.classes || []) {
    delete cls.blendedMirror;
    const twin = cls.name && magic.find((m) => m.name === cls.name);
    // `blended: false` is a decision -- two blocks that share a name and are
    // deliberately kept apart -- and is left alone.
    if (!twin || cls.blended === false || twin.blended === false) continue;
    cls.blended = true;
    twin.blended = true;
    twin.blendedMirror = true;
    // The owner's rows are the pool. An extended block has none of its own,
    // so it is the twin that holds them and the roles swap.
    if (!(cls.levels || []).length && (twin.levels || []).length) {
      cls.levels = twin.levels;
      cls.blendedMirror = true;
      delete twin.blendedMirror;
    } else {
      twin.levels = cls.levels || [];
    }
  }
  for (const m of magic) {
    if (m.blended && !(t.combat?.classes || []).some((x) => x.name === m.name)) {
      delete m.blended;
      delete m.blendedMirror;
    }
  }
}

/**
 * Turn a training class into a blended one, or split it back apart.
 *
 * Blending gives the class a block on the other side too -- that is where
 * its caster level, or its practitioner DC, is worked out from -- with no
 * talents of its own: the pool it already has is shared with it.
 */
export function setBlended(model, sideKey, index, on) {
  const t = model.data.training || {};
  const cls = t[sideKey]?.classes?.[index];
  if (!cls || !cls.name) return model;
  const otherKey = sideKey === 'magic' ? 'combat' : 'magic';
  const other = t[otherKey];
  if (!other) return model;
  const at = (other.classes || []).findIndex((x) => x.name === cls.name);
  if (on) {
    if (at < 0) {
      other.classes = [...(other.classes || []), {
        name: cls.name, type: null, talentsPerLevel: cls.talentsPerLevel,
        mod1: cls.mod1, mod2: null, levels: [],
      }];
    }
  } else if (at >= 0) {
    // The talents stay with the block that owns them; the mirror never had
    // any of its own, so splitting drops it and leaves the pool alone.
    const twin = other.classes[at];
    if (twin.blendedMirror) other.classes.splice(at, 1);
    else twin.levels = (twin.levels || []).map((lv) => ({ ...lv }));
    // An explicit false, not a missing flag: the two blocks still share a
    // name, and pairing would otherwise put them straight back together.
    for (const x of [cls, twin]) { x.blended = false; delete x.blendedMirror; }
  }
  model.recompute();
  emit(model, { type: 'blend', side: sideKey, index, on: !!on });
  return model;
}

/** The blended classes, once each, as the pair that makes them up. */
export function blendedClasses(model) {
  const t = model.data.training || {};
  const pairs = [];
  for (const side of ['combat', 'magic']) {
    (t[side]?.classes || []).forEach((cls, index) => {
      if (!cls.blended || cls.blendedMirror) return;
      const other = side === 'combat' ? 'magic' : 'combat';
      const ti = (t[other]?.classes || []).findIndex((x) => x.name === cls.name);
      pairs.push({
        name: cls.name,
        owner: { side, index, cls },
        twin: ti < 0 ? null : { side: other, index: ti, cls: t[other].classes[ti] },
      });
    });
  }
  return pairs;
}

/**
 * Recompute both training sides: per-class talent progressions, tradition
 * spell points and boons, and the global casting numbers. Runs before the
 * skills loop because sphere talents grant skill ranks.
 */
export function recomputeTraining(model) {
  const t = model.data.training;
  if (!t) return;
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const mod = (name) => statMod(c, name, null);
  pairBlended(model);
  // Sized before anything counts them, since the tallies below read the rows
  // this opens.
  if (t.combat) recomputeCustomizations(model, t.combat);

  for (const sideKey of ['combat', 'magic']) {
    const side = t[sideKey];
    if (!side) continue;

    for (const cls of side.classes || []) {
      cls.side = sideKey;
      // Several sheets fill in only one of type / talents-per-level;
      // each falls back to the other.
      const tpl = cls.talentsPerLevel || TYPE_TO_TALENTS[cls.type] || null;
      const type = cls.type || TALENTS_TO_TYPE[cls.talentsPerLevel] || null;
      const rate = TALENT_RATES[tpl] ?? 0;
      const progRate = TYPE_RATES[type] ?? 0;
      cls.effectiveType = type;
      cls.effectiveTalentsPerLevel = tpl;
      // Sparse planners list a class once rather than on every row; the
      // override lets the player state the real class level count directly.
      const override = cls.classLevelsOverride == null ? null : Number(cls.classLevelsOverride);
      let cum = 0;
      let prog = 0;
      let classLevels = 0;
      let classLevelsCurrent = 0;
      for (const lv of cls.levels || []) {
        const has = override != null
          ? lv.level <= override
          : plannerHasClass(model, cls.name, lv.level);
        const before = Math.floor(cum);
        if (has) {
          cum += rate;
          prog += progRate;
          classLevels += 1;
          if (lv.level <= level) classLevelsCurrent += 1;
        }
        // A mirror shares the owner's rows; it counts its own talents off
        // them but must not restate the slot flags in its own rate's terms.
        if (!cls.blendedMirror) {
          lv.count = Math.floor(cum * 100) / 100;
          lv.granted = Math.floor(cum) > before;
          lv.progression = Math.floor(prog);
          lv.future = lv.level > level;
        }
      }
      if (cls.extended) {
        // Blocks from the extended page carry no level rows of their own;
        // count their class levels straight from the Planner.
        for (let l = 1; l <= 20; l++) {
          const has = override != null ? l <= override : plannerHasClass(model, cls.name, l);
          if (has) {
            classLevels += 1;
            if (l <= level) classLevelsCurrent += 1;
          }
        }
      }
      cls.classLevels = classLevels;
      cls.classLevelsCurrent = classLevelsCurrent;
      cls.totalTalents = Math.floor(cum);
    }
    // Two readings of the same spheres, because two different questions get
    // asked of them. `tally` is what is live -- the class ladders, the bonus
    // talents, the tradition, and whichever customized weapon is drawn --
    // and drives the sphere tables. `tallyOwn` leaves the weapons out
    // entirely: it is what the character possesses in her own right, which
    // is what a prerequisite asks about and what the bonus skill ranks pay
    // out on, since talents from a customized weapon may not qualify for
    // feats and never grant skill retraining. (There is a third question --
    // every weapon at once, drawn or stowed -- and the unarmed block below
    // is the only thing that asks it, so it asks on the spot.)
    side.tally = sphereTally(model, side, { sideKey });
    side.tallyOwn = sphereTally(model, side, { sideKey, customizations: 'none' });
  }
  checkCustomizationBases(model, t);

  // ----- combat side -----
  if (t.combat) {
    const bestPracMod = Math.max(0, ...(t.combat.classes || [])
      .filter((x) => x.name)
      .map((x) => mod(x.mod1)));
    t.combat.practitionerDC = 10 + Math.floor((Number(c.attack.bab) || 0) / 2) + bestPracMod;
    recomputeUnarmed(model);
  }

  // ----- magic side -----
  if (t.magic) {
    const m = t.magic;
    const casters = (m.classes || []).filter((x) => x.name);
    const bestMod = Math.max(0, ...casters.map((x) => mod(x.mod1)));

    // Advanced Magic Training grants casting to non-casting classes:
    // Low-Caster progression, or Mid-Caster with the mythic version.
    const amtFloor = m.mythicAmt ? Math.floor(level * 0.75)
      : m.amt ? Math.floor(level * 0.5) : 0;
    // A class counting as levels higher counts here: caster level and magic
    // skill bonus are read off the class level, so a rule that raises one
    // raises the other. Deliberately not the talent budget or the spell
    // points -- "counts as two levels higher" is a rule about what a class
    // can do, not about being handed two more levels' worth of it.
    //
    // The distinction is worth the arithmetic: two class levels on a
    // mid-caster is one caster level, which is what the boost is worth and
    // not what m.clBonus would give.
    const effectiveLevels = (x) => (x.classLevelsCurrent ?? 0)
      + forwarded(model, `class.${slug(x.name)}.level`);
    m.globalCL = Math.max(0, amtFloor, ...casters.map(
      (x) => Math.floor(effectiveLevels(x) * (TYPE_RATES[x.effectiveType] ?? 0)),
    )) + (Number(m.clBonus) || 0);
    m.globalDC = 10 + Math.floor(m.globalCL / 2) + bestMod + (Number(m.dcBonus) || 0);
    m.msb = Math.max(0, ...casters.map(effectiveLevels))
      + (Number(m.msbBonus) || 0);
    m.msd = m.msb + 11 + (Number(m.msdBonus) || 0);
    m.concentration = m.globalCL + bestMod;

    // Tradition drawbacks -> spell points and boons.
    // "x2" entries count double; each drawback feat buys off two drawbacks.
    const tr = m.tradition || {};
    const drawbacks = (tr.drawbacks || []).reduce((n, d) => n + drawbackWeight(d), 0);
    const boughtOff = (tr.boughtOff || []).length;
    const effective = Math.max(0, drawbacks - 2 * boughtOff);
    m.drawbackCount = drawbacks;
    m.boughtOffCount = boughtOff;
    m.effectiveDrawbacks = effective;
    // Every drawback past what the feats bought off is a boon. The sheet
    // separated the first five as a "spell-point tier" and the rest as
    // "boons", but a boon is a boon: they are one count and one ladder.
    m.spTier = Math.min(5, effective);
    m.boons = effective;

    // A tradition grants two pools, and each is spent one way or the other.
    //
    // The spell-point tier grants the ladder read at the tier itself, which
    // is where every one of these sheets put its Essence Boon: Angou's 20 at
    // 20th, Narockro's 11 at 11th, Saburo's 9 at 9th, all exactly the ladder
    // at tier 5, and Bryva -- the one at tier 0 -- has no Essence Boon at
    // all. So essence is what this pool defaults to. It is one pool and is
    // not multiplied.
    //
    // Boons past the tier grant spell points instead, per casting class, the
    // way the sheet totals them: Angou's 1 boon is 4 × 3 classes = the 12 his
    // workbook cached. Taken a step at a time -- boon n is worth what it adds
    // on top of the n-1 below it -- so the steps add back up to the ladder
    // however they are split.
    const castingClassCount = new Set(casters.map((x) => x.name)).size;

    /**
     * A pool, split step by step between the two things it can become.
     *
     * The ladder is quoted for a whole number of steps, so one step is worth
     * what it adds to the step below it -- which keeps any split summing back
     * to the ladder exactly. Steps are spent from the bottom up: the first
     * `spSteps` of them are the spell points, the rest are essence.
     */
    const poolSplit = (key, label, steps, spSteps) => {
      const each = Array.from({ length: steps }, (_, i) => boonStep(i + 1, level));
      const k = Math.max(0, Math.min(steps, Math.floor(Number(spSteps) || 0)));
      const sum = (xs) => xs.reduce((n, x) => n + x, 0);
      return {
        key,
        label,
        steps,
        spSteps: k,
        essenceSteps: steps - k,
        points: sum(each),
        sp: sum(each.slice(0, k)) * castingClassCount,
        essence: sum(each.slice(k)),
      };
    };

    // Carried over from the two-pool shape and its either/or choice.
    for (const [old, kept] of [['tierUse', 'tierSP'], ['boonUses', 'boonSP']]) {
      if (tr[old] === undefined) continue;
      if (tr[kept] === undefined) {
        tr[kept] = old === 'tierUse'
          ? (tr[old] === 'sp' ? m.spTier : 0)
          : tr[old].filter((u) => u !== 'essence').length;
      }
      delete tr[old];
    }
    if (tr.tierSP !== undefined) {
      if (tr.boonSP === undefined) tr.boonSP = tr.tierSP;
      delete tr.tierSP;
    }

    // What the player asked for is kept as they wrote it and clamped only on
    // the way in: buying off a drawback drops the count for a moment, and a
    // split written back then would be a nought outliving its reason.
    //
    // The default is the split the sheets were written with -- the boons past
    // the fifth as spell points, everything up to it as essence, which is
    // where each of these characters' Essence Boon came from.
    const want = tr.boonSP ?? Math.max(0, m.boons - 5);
    const boonSP = Math.max(0, Math.min(m.boons, Math.floor(Number(want) || 0)));

    m.traditionPools = m.boons ? [poolSplit('boons', `Boons ${m.boons}`, m.boons, boonSP)] : [];
    m.boonPoints = spBoonPoints(m.boons, level);
    m.traditionSP = m.traditionPools.reduce((n, p) => n + p.sp, 0);
    m.traditionEssence = m.traditionPools.reduce((n, p) => n + p.essence, 0);
    m.castingClassCount = castingClassCount;

    m.classSP = casters.map((x) => ({
      name: x.name,
      sp: Math.min(x.classLevels ?? 0, level) + mod(x.mod1) + (x.mod2 ? mod(x.mod2) : 0),
    }));
    m.totalSP = m.classSP.reduce((s, x) => s + x.sp, 0)
      + (Number(m.bonusSP) || 0) + m.traditionSP;

    // Points condensed into temporary essence on the Akashic tab are spent
    // for the day: they are held against the pool here so what is left reads
    // as what can still be cast with. Asking for more than the pool holds is
    // flagged rather than clamped -- the number the player typed is kept and
    // both tabs say it does not add up.
    m.spOnEssence = tempEssenceCost(model.data.akashic);
    m.spShort = Math.max(0, m.spOnEssence - m.totalSP);
    m.availableSP = m.totalSP - m.spOnEssence;
  }
}

/**
 * What this side's talents are, sphere by sphere, for a rule that has to ask
 * whether a particular one is there: the names it can read, the choices it
 * knows were made without knowing which way, and how many are neither.
 *
 * The unnamed count is the tally less what is accounted for rather than a
 * count of its own, so it cannot drift from the number the rest of the sheet
 * is working with.
 */
export function sphereTalentKnowledge(model, side, sideKey) {
  const out = new Map();
  const of = (sphere) => {
    const s = String(sphere || '').trim();
    if (!s) return null;
    if (!out.has(s)) out.set(s, { names: [], choices: [], unnamed: 0 });
    return out.get(s);
  };
  const put = (sphere, talent) => {
    const t = String(talent || '').trim();
    const row = t ? of(sphere) : null;
    if (row) row.names.push(t);
  };
  for (const cls of side?.classes || []) {
    if (cls.blendedMirror) continue;
    for (const lv of cls.levels || []) put(lv.sphere, lv.talent);
  }
  for (const b of side?.bonusTalents || []) put(b.sphere, b.talent);
  for (const e of side?.tradition?.entries || []) put(e.sphere, e.talent);

  const tech = techniqueTalents(model);
  if (tech && tech.side === sideKey) {
    const row = of(tech.sphere);
    row.names.push(...tech.names);
    row.choices.push(...tech.choices);
  }

  for (const [sphere, row] of out) {
    // The named sources above are the character's own, so the count they are
    // measured against has to be too -- a customized weapon's talents are
    // neither named here nor countable as unnamed ones.
    const total = Number((side?.tallyOwn || side?.tally || {})[sphere]) || 0;
    row.unnamed = Math.max(0, total - row.names.length - row.choices.length);
  }
  return out;
}

/**
 * Bonus skill ranks from sphere talents: 5 per talent in the associated
 * sphere, capped at level. Returns a map of skill index -> ranks.
 *
 * A row only pays out if what it asks for is on the character -- the sphere
 * for a "(Base)" row, the named package or talent for the rest. Where the
 * sheet cannot tell (a sphere whose talents are all unnamed, which is what
 * a Primordia technique's grants look like) the row falls back to the
 * player's own switch, which is what that column has always been.
 */
export function sphereRanksBySkill(model) {
  const map = new Map();
  const t = model.data.training?.combat;
  if (!t) return map;
  const level = Number(model.data.identity.level) || 0;
  // Her own talents, never a customized weapon's: "spheres and talents that
  // grant skill retraining never grant it when gained via a customized
  // weapon".
  const tally = t.tallyOwn || t.tally || {};
  const lightBody = model.data.identity.primordiaTechnique === 'Light Body';
  const known = sphereTalentKnowledge(model, t, 'combat');
  const of = (sphere) => known.get(sphere) || { names: [], choices: [], unnamed: 0 };
  const check = {
    has: (sphere) => (tally[sphere] || 0) > 0,
    named: (sphere) => of(sphere).names,
    choices: (sphere) => of(sphere).choices,
    unnamed: (sphere) => of(sphere).unnamed,
  };

  model.trainingSkillRanks = (t.skillRanks || []).map((row) => {
    const def = SPHERE_SKILL_RANKS.find((d) => d.key === row.skill);
    if (!def) return { ...row, talents: 0, requirement: '', state: 'unmet', current: 0 };
    const state = sphereSkillRequirement(def, check);
    const talents = sphereSkillSpheres(def).reduce((n, s) => n + (tally[s] || 0), 0);
    const on = row.enabled && state !== 'unmet';
    const ranks = !on ? 0
      : (def.lightBody && lightBody) ? level
        : talents > 0
          ? Math.min(level, talents * RANKS_PER_TALENT * (Number(row.multiplier) || 1))
          : 0;
    return { ...row, talents, requirement: sphereSkillLabel(def), state, current: ranks };
  });

  for (const row of model.trainingSkillRanks) {
    const def = SPHERE_SKILL_RANKS.find((d) => d.key === row.skill);
    if (!def?.match) continue;
    const idx = model.data.skills.findIndex((s) => {
      if (s.name !== def.match.name) return false;
      if (def.match.spec === undefined) return true;
      if (def.match.spec === null) return !s.spec;
      return def.match.spec.test(String(s.spec || ''));
    });
    if (idx >= 0) map.set(idx, row.current);
  }
  return map;
}

/**
 * Per-sphere attack/DC rows. Runs after skills because two spheres
 * (Alchemy, Beastmastery) key off skill ranks instead of BAB.
 */
export function recomputeSphereRows(model) {
  const t = model.data.training;
  if (!t) return;
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const bab = Number(c.attack.bab) || 0;
  const ranksOf = (name, specRe) => {
    const s = c.skills.find((x) => x.name === name
      && (specRe ? specRe.test(String(x.spec || '')) : true));
    return Number(s?.totalRanks) || 0;
  };

  if (t.combat) {
    const dcBase = t.combat.practitionerDC;
    const bestMod = dcBase - 10 - Math.floor(bab / 2);
    t.combat.sphereRows = (t.combat.sphereBonuses || []).map((row) => {
      let attackBase = bab;
      let dc = dcBase;
      if (row.sphere === 'Alchemy') {
        const r = ranksOf('Craft', /alchem/i);
        attackBase = r;
        dc = 10 + Math.floor(r / 2) + bestMod;
      } else if (row.sphere === 'Beastmastery') {
        const r = Math.max(ranksOf('Handle Animal'), ranksOf('Ride'));
        attackBase = r;
        dc = 10 + Math.floor(ranksOf('Handle Animal') / 2) + bestMod;
      }
      return {
        ...row,
        talents: (t.combat.tally || {})[row.sphere] || 0,
        attack: Math.min(Math.floor(attackBase + (Number(row.rankBonus) || 0)), level),
        dc: dc + (Number(row.dcBonus) || 0),
      };
    });
  }
  if (t.magic) {
    t.magic.sphereRows = (t.magic.sphereBonuses || []).map((row) => ({
      ...row,
      talents: (t.magic.tally || {})[row.sphere] || 0,
      cl: t.magic.globalCL + (Number(row.clBonus) || 0),
      dc: t.magic.globalDC + Math.floor((Number(row.clBonus) || 0) / 2) + (Number(row.dcBonus) || 0),
    }));
  }
}
