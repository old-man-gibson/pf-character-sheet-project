/**
 * model/note-fill.js -- blank notes filled from packs, one list at a time.
 *
 * Every list whose rows name something a pack describes -- a side's sphere
 * talents, a feat group, the granted feats, a companion's feats and its
 * abilities -- has the same two questions: how many of its notes are empty
 * and could be filled, and fill them. A `scope` names the list:
 *
 *   combat | magic | guile | altTraining   a side's talents (model/spheres.js)
 *   feats|<list path>|<note field>         feat rows: featGroups.0.entries, <kind>.<i>.feats
 *   feats|grantedFeats|note                the granted feats, fixed rows and the others
 *   abilities|<kind>.<i>                   a familiar's or an animal companion's abilities
 *
 * The rule is the talents' and is the same everywhere: only a note that is
 * empty, only from a name a pack knows. Each list is filled on its own, so
 * filling one never touches another.
 */
import { abilityTextKey, addedAbilitiesOf, companionAbilityText, takesArchetypes } from '../companions.js';
import { isAntihero, specialtyInPlay, vmcTakesSlot } from './campaign.js';
import { emit } from './events.js';
import { featLevel } from './feats.js';
import { blankTalentNotes, fillTalentNotes } from './spheres.js';
import { featDetails } from './subsystems/catalogues.js';
import { markUndo } from './undo.js';

const TALENT_SCOPES = new Set(['combat', 'magic', 'guile', 'altTraining']);

const blank = (v) => !String(v ?? '').trim();

/** The fixed granted feats the sheet shows, by key. */
export function shownGrantedFeats(d) {
  const major = d?.traitSlots?.majorDrawback || {};
  return [
    major.name || major.category || major.text ? 'drawback' : '',
    specialtyInPlay(d) ? 'specialty' : '',
    isAntihero(d) ? 'antihero' : '',
  ].filter(Boolean);
}

/**
 * What the packs say about one of a companion's abilities, as `{ text,
 * source }`, or null: its archetype's text for it, a pack's, or the text a
 * published sheet carries.
 */
export function companionAbilityShared(b, name) {
  const key = abilityTextKey(name);
  if (!key) return null;
  const info = b?.calc?.abilityInfo;
  const from = info && Object.hasOwn(info, key) ? info[key] : null;
  const hit = (from?.archetype && String(from.text ?? '').trim() ? from : null)
    || companionAbilityText(name) || b?.citedAbilities?.[key] || null;
  const text = String(hit?.text ?? '').trim();
  return text ? { text, source: String(hit.source || hit.pack || '') } : null;
}

/** A feat row as a fillable note: `{ id, note, text, write }`. */
function featRow(row, id, field) {
  if (!row || typeof row !== 'object' || blank(row.name)) return null;
  return {
    id,
    note: row[field],
    text: String(featDetails(row)?.text ?? '').trim(),
    write: (text) => { row[field] = text; },
  };
}

/** The rows of a scope that a note can be written on, each with what the packs say. */
function noteRows(model, scope) {
  const d = model.data;
  const [kind, path, field = 'note'] = String(scope ?? '').split('|');
  if (kind === 'feats' && path === 'grantedFeats') {
    const g = d.grantedFeats || {};
    return [
      ...shownGrantedFeats(d).map((key) => featRow(g[key], key, field)),
      ...(Array.isArray(g.others) ? g.others : []).map((row, i) => featRow(row, i, field)),
    ].filter(Boolean);
  }
  if (kind === 'feats') {
    // A Level Up slot a variant multiclass feature takes holds no feat.
    const group = /^featGroups\.\d+\.entries$/.test(path) ? d.featGroups?.[Number(path.split('.')[1])] : null;
    const taken = (row) => group?.levelUp === true && vmcTakesSlot(d, featLevel(group, row));
    return (model.list(path) || []).map((row, i) => (taken(row) ? null : featRow(row, i, field))).filter(Boolean);
  }
  if (kind === 'abilities') {
    const [list, index] = path.split('.');
    const b = d[list]?.[Number(index)];
    if (!b || typeof b !== 'object') return [];
    const k = b.calc || {};
    const listed = Array.isArray(k.abilitiesListed) ? k.abilitiesListed
      : (k.gains || []).flatMap((g) => (g.abilities || [g.text]).map((name) => ({ name })));
    const own = () => {
      if (!b.abilityNotes || typeof b.abilityNotes !== 'object') b.abilityNotes = {};
      return b.abilityNotes;
    };
    const seen = new Set();
    const rows = [];
    for (const { name } of listed) {
      const key = abilityTextKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        id: key,
        note: b.abilityNotes?.[key],
        text: companionAbilityShared(b, name)?.text || '',
        write: (text) => { own()[key] = text; },
      });
    }
    // Abilities added by hand keep their notes on the entry.
    for (const a of takesArchetypes(list) ? addedAbilitiesOf(b) : []) {
      if (!a.name) continue;
      rows.push({
        id: `+${a.index}`,
        note: a.notes,
        text: companionAbilityShared({ citedAbilities: b.citedAbilities }, a.name)?.text || '',
        write: (text) => { b.addedAbilities[a.index].notes = text; },
      });
    }
    return rows;
  }
  return [];
}

const fillable = (model, scope) => noteRows(model, scope).filter((r) => blank(r.note) && r.text);

/** How many notes in a scope are empty and could be filled from packs. */
export function blankNotes(model, scope) {
  if (TALENT_SCOPES.has(scope)) return blankTalentNotes(model, scope);
  return fillable(model, scope).length;
}

/**
 * Fill the notes a sheet saved before notes were filled was shown pack text
 * under: every feat group's, the granted feats', and each familiar's and
 * animal companion's abilities'. That text was on screen whenever the note
 * was empty, so it goes into the note, where it stays until the player
 * deletes it. Asked once, as the document is opened (the `pack-notes`
 * correction); it takes no step back, being part of the load. Returns how
 * many were filled.
 */
export function fillShownNotes(model) {
  const d = model.data;
  const scopes = [
    ...(Array.isArray(d.featGroups) ? d.featGroups : []).map((_, g) => `feats|featGroups.${g}.entries|note`),
    'feats|grantedFeats|note',
    ...['familiar', 'animalCompanion'].flatMap((kind) => (Array.isArray(d[kind]) ? d[kind] : []).map((_, i) => `abilities|${kind}.${i}`)),
  ];
  let filled = 0;
  for (const scope of scopes) {
    for (const r of fillable(model, scope)) {
      r.write(r.text);
      filled++;
    }
  }
  if (filled) {
    model.recompute();
    emit(model, { type: 'notes-filled', scope: 'shown', filled });
  }
  return filled;
}

/**
 * Fill them, as one step back. With `only`, fill that row alone and take no
 * step: it is what follows a name being typed, and belongs to that edit.
 * Returns how many were filled.
 */
export function fillNotes(model, scope, only = undefined) {
  if (TALENT_SCOPES.has(scope)) return fillTalentNotes(model, scope);
  const rows = fillable(model, scope).filter((r) => only === undefined || String(r.id) === String(only));
  if (!rows.length) return 0;
  if (only === undefined) markUndo(model, scope.startsWith('abilities') ? 'Filled ability notes' : 'Filled feat notes');
  for (const r of rows) r.write(r.text);
  model.recompute();
  emit(model, { type: 'notes-filled', scope, filled: rows.length });
  return rows.length;
}
