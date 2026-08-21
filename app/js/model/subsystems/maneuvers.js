/**
 * Path of War: disciplines, stances and maneuvers.
 *
 * The catalogue of what exists is an extension pack; what the character knows
 * and has readied is on the sheet, and the two are matched by name.
 */

import { sheetReader } from '../document.js';
import { emit } from '../events.js';
import { getPath } from '../util.js';

let MANEUVER_CATALOGUE = { disciplines: [] };

/** Register the shared catalogue. Call before constructing a Character. */
export function setManeuverCatalogue(doc) {
  const list = Array.isArray(doc?.disciplines) ? doc.disciplines : [];
  MANEUVER_CATALOGUE = {
    disciplines: list.map((d) => ({
      name: String(d.name || ''),
      entries: (d.entries || []).map((e) => ({
        level: Number(e.level) || 0,
        kind: e.kind === 'stance' ? 'stance' : 'maneuver',
        name: String(e.name || ''),
        type: String(e.type || ''),
      })),
    })),
  };
}

export function maneuverCatalogue() {
  return MANEUVER_CATALOGUE;
}

/* ------------------------------------------------------------------ *
 * The shared option catalogues.
 *
 * A class feature taken over and over -- a rogue talent, an iaijutsu
 * technique, a smithing insight -- picks from a menu that lives on a page of
 * its own, and so in a pack of its own. A character records which it picked,
 * never a copy of the menu, so a feature column points at a catalogue by name
 * and the menu itself arrives with whatever pack provides it.
 *
 * With no catalogue loaded the column is what it always was: a box to type in.
 * ------------------------------------------------------------------ */

/** Every maneuver and stance a discipline grants, by discipline name. */
export function disciplineEntries(name) {
  const key = String(name || '').trim().toLowerCase();
  return MANEUVER_CATALOGUE.disciplines
    .find((d) => d.name.trim().toLowerCase() === key)?.entries || [];
}

/* ------------------------------------------------------------------ *
 * Matching a name somebody typed.
 *
 * Every casting and manifesting lookup keys off a class name written by hand,
 * on a sheet where the dropdown warned but did not refuse: one workbook reaches
 * us with `;egendary druid`, a semicolon for the l, and the workbook's own
 * formula answered that with a silent zero across the whole block -- 123 power
 * points that simply were not there. Cheaper to forgive the typo than to make
 * every player proof-read a dropdown.
 *
 * Case and surrounding space never count. Beyond that a single slip is
 * forgiven, two on a long name, and a tie is refused rather than guessed --
 * picking the wrong class silently is the failure this exists to avoid.
 * ------------------------------------------------------------------ */

/**
 * Read the workbook's Maneuvers tab into disciplines the tab now edits.
 *
 * The sheet is a catalogue: each discipline owns three columns -- a 1/0 known
 * flag, the maneuver's name and its type -- and rows are grouped by level and
 * split into Maneuvers and Stances. All but one of the bundled characters carry
 * this tab as an untouched blank template, which imports to no disciplines.
 */
export function importManeuvers(tab) {
  const g = sheetReader(tab);
  const { at, text, num, mark } = g;

  const possibleManeuvers = num(g.take('Possible Maneuvers Known:'));
  const possibleStances = num(g.take('Possible Stances Known'));
  // Both totals are sums of the known flags below, so they are recomputed.
  g.take('Total Maneuvers Known:');
  g.take('Total Stances Known');
  for (const [ri, ci] of g.findAll('Not Legal')) mark(ri, ci);

  // The discipline name row is the one above the "Maneuver"/"Type" headers.
  const headers = g.findAll('Maneuver').filter(([ri, ci]) => text(at(ri, ci + 1)) === 'Type');
  const columns = [...new Set(headers.map(([, ci]) => ci - 1))].sort((a, b) => a - b);
  const headerRow = headers.length ? Math.min(...headers.map(([ri]) => ri)) : -1;
  for (const [ri, ci] of headers) {
    mark(ri, ci);
    mark(ri, ci + 1);
  }

  // Discipline names sit one row above the column headers -- but only on a
  // sheet that has any. An untouched template puts the headers on the first
  // row, where the row above is the "... Known" totals strip, so a name that
  // is really one of those counts is discarded.
  const nameRow = headerRow - 1;
  const namesAreCounts = nameRow < 0
    || g.rows[nameRow].some((v) => typeof v === 'string' && /Known/.test(v));

  const disciplines = columns.map((ci) => {
    const name = namesAreCounts ? '' : text(at(nameRow, ci));
    if (!namesAreCounts) mark(nameRow, ci);
    mark(headerRow, ci);          // the per-discipline count, recomputed
    return { col: ci, name, entries: [] };
  });

  let level = 0;
  let kind = 'maneuver';
  for (let ri = headerRow + 1; ri < g.rows.length; ri++) {
    const section = text(at(ri, 0));
    const sub = text(at(ri, 1));
    const lvl = /^(\d+)(?:st|nd|rd|th) Level$/.exec(section);
    if (lvl) {
      level = Number(lvl[1]);
      mark(ri, 0);
    }
    if (sub === 'Maneuvers' || sub === 'Maneuver') { kind = 'maneuver'; mark(ri, 1); }
    else if (sub === 'Stances' || sub === 'Stance') { kind = 'stance'; mark(ri, 1); }
    for (const d of disciplines) {
      const known = at(ri, d.col);
      const name = text(at(ri, d.col + 1));
      const type = text(at(ri, d.col + 2));
      mark(ri, d.col);
      mark(ri, d.col + 1);
      mark(ri, d.col + 2);
      if (name === '') continue;
      d.entries.push({ level, kind, name, type, known: num(known) > 0 });
    }
  }

  return {
    possibleManeuvers,
    possibleStances,
    // A discipline with no name and nothing under it is an empty template
    // column, not a discipline the character has.
    disciplines: disciplines
      .filter((d) => d.name !== '' || d.entries.length)
      .map(({ name, entries }) => shrinkDiscipline({ name, entries })),
    sourceExtras: g.extras(),
  };
}

/**
 * Reduce a discipline to what the character actually chose.
 *
 * The workbook wrote every maneuver a discipline grants into the character's
 * own tab, which is how one sheet came to carry 206 rows of catalogue. Knowing
 * the discipline is what grants them, so all that needs saving is its name and
 * the maneuvers readied from it; the rest comes back from the shared
 * catalogue. Anything the catalogue does not have -- a homebrew maneuver, a
 * discipline the reference tab never listed -- is kept in `custom` so nothing
 * from a sheet is lost.
 */
export function shrinkDiscipline({ name, entries = [], known, custom, notes }) {
  // The player's overview notes ride along whichever shape arrives.
  const keptNotes = notes && typeof notes === 'object' && !Array.isArray(notes) ? { ...notes } : {};
  // Already in the new shape (a saved document, or a discipline just added).
  if (Array.isArray(known)) {
    return { name, known: [...known], custom: custom ? [...custom] : [], notes: keptNotes };
  }
  const granted = new Set(disciplineEntries(name).map((e) => e.name));
  const out = { name, known: [], custom: [], notes: keptNotes };
  for (const e of entries) {
    if (e.known) out.known.push(e.name);
    if (!granted.has(e.name)) {
      out.custom.push({
        level: e.level, kind: e.kind, name: e.name, type: e.type,
      });
    }
  }
  return out;
}

export const MANEUVER_DERIVED = [
  'calc',
  // `entries` is the discipline's whole catalogue, rebuilt from the shared
  // file on every recompute. Saving it would put back the 206 rows this was
  // meant to get rid of.
  { path: 'disciplines', keys: ['knownManeuvers', 'knownStances', 'entries', 'inCatalogue'] },
];

/**
 * Expand each discipline against the catalogue, and count what is readied.
 *
 * A discipline saves its name and the maneuvers readied from it; everything
 * the discipline grants comes back from the shared catalogue here, so
 * `entries` is rebuilt on every recompute rather than stored. The sheet's
 * per-discipline counts and its two totals are sums of those ticks, so they
 * are recomputed too.
 */
export function recomputeManeuvers(model) {
  const m = model.data.maneuvers;
  if (!m) return;

  let maneuvers = 0;
  let stances = 0;
  for (const d of m.disciplines || []) {
    const readied = new Set(d.known || []);
    // A maneuver readied from a discipline the catalogue no longer lists
    // still has to appear, or ticking it would silently drop it.
    const granted = disciplineEntries(d.name);
    const extra = (d.custom || []).filter((e) => !granted.some((g) => g.name === e.name));
    const missing = [...readied]
      .filter((name) => !granted.some((g) => g.name === name)
        && !extra.some((e) => e.name === name))
      .map((name) => ({ level: 0, kind: 'maneuver', name, type: '' }));

    d.entries = [...granted, ...extra, ...missing]
      .map((e) => ({ ...e, known: readied.has(e.name) }));
    d.knownManeuvers = d.entries.filter((e) => e.known && e.kind !== 'stance').length;
    d.knownStances = d.entries.filter((e) => e.known && e.kind === 'stance').length;
    d.inCatalogue = granted.length > 0;
    maneuvers += d.knownManeuvers;
    stances += d.knownStances;
  }

  const possibleManeuvers = Number(m.possibleManeuvers) || 0;
  const possibleStances = Number(m.possibleStances) || 0;
  m.calc = {
    maneuvers,
    stances,
    possibleManeuvers,
    possibleStances,
    // The sheet's "Not Legal" flag: more picked than the class allows.
    legal: maneuvers <= possibleManeuvers && stances <= possibleStances,
  };
}

export function toggleManeuver(model, path, name, ready) {
  const d = getPath(model.data, path);
  if (!d) return model;
  const known = new Set(d.known || []);
  if (ready) known.add(name);
  else known.delete(name);
  d.known = [...known];
  model.recompute();
  emit(model, { type: 'set', path: `${path}.known`, value: d.known });
  return model;
}

/**
 * The player's own line on a maneuver -- what the dashboard's Readied
 * maneuvers card says under the name. Prose, so {…} formulas resolve.
 * Keyed by the maneuver's name, because the rows themselves live in the
 * shared catalogue; an emptied note is removed rather than stored blank.
 */
export function setManeuverNote(model, path, name, text) {
  const d = getPath(model.data, path);
  if (!d) return model;
  if (!d.notes || typeof d.notes !== 'object' || Array.isArray(d.notes)) d.notes = {};
  const t = String(text ?? '');
  if (t.trim()) d.notes[name] = t;
  else delete d.notes[name];
  model.recompute();
  emit(model, { type: 'maneuver-note', path, name });
  return model;
}
