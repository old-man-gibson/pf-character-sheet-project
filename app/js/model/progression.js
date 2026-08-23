/**
 * Classes, the level-by-level progression table, and class features.
 *
 * The progression table is the character's plan: which classes are taken at
 * which level, what each grants, and the option menus a repeating feature
 * chooses from. `#applyGestalt` turns that plan into the base saves, hit
 * points and skill ranks per level that the derived stats then read.
 */

import {
  MYTHIC_PATH_HP, gestaltSaveBase, hitPointBase, levelRuleGrants, parseGroupText, parseLevelRule,
  statMod,
} from '../rules.js';
import { FEATURE_GROUP_COLORS, normalizeHex } from '../tracker-style.js';
import { orphans } from './reconcile.js';
import { forwarded } from './scope.js';
import { TEMPLATE_TYPES } from './templates.js';
import { closestName, normalizeName, slug } from './util.js';

/**
 * The key a rule group's text is stored under within a feature cell.
 *
 * The name, so it survives reordering and follows a rename the way a column's
 * text does. An unnamed group -- the single-rule shorthand -- falls back to its
 * position, which is stable as long as it stays the only one.
 */
export const featureGroupKey = (group, index) => (group?.name || `#${index}`);

/* ------------------------------------------------------------------ *
 * Weapon and armor proficiencies.
 *
 * The workbook kept these as three sentences on Character Info ("all simple
 * and double-chained kama, katana…", "light and medium armor", "none"). The
 * sheet keeps them as lists it can reason about, in the same terms the
 * weapon rows on Gear already use: familiarity (simple / martial / exotic),
 * handedness, fighter weapon group, and the specific weapon by name -- plus
 * the armor weights and the shield kinds. Anything the lists cannot say is
 * kept as a note rather than dropped.
 * ------------------------------------------------------------------ */

let OPTION_CATALOGUES = new Map();

/**
 * A class or feature name as it is matched on, across the ways two pages
 * spell it: "Iaijutsu Technique" against a column reading "Iaijutsu
 * technique", "Rogue Talents" against "Rogue talent".
 */
const menuKey = (s) => String(s || '').toLowerCase()
  .replace(/\((?:ex|su|sp)\)/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/(\w{3,})s$/, '$1');

/** Register the menus the active packs provide. Keyed by name, case-blind. */
export function setOptionCatalogues(list) {
  OPTION_CATALOGUES = new Map();
  for (const c of Array.isArray(list) ? list : []) {
    const name = String(c?.name || '').trim();
    if (!name) continue;
    OPTION_CATALOGUES.set(name.toLowerCase(), {
      name,
      class: String(c?.class || '').trim(),
      feature: String(c?.feature || '').trim(),
      classKey: menuKey(c?.class),
      featureKey: menuKey(c?.feature),
      text: String(c?.text || ''),
      options: (Array.isArray(c?.options) ? c.options : []).map((o) => ({
        name: String(o?.name || ''),
        type: o?.type ? String(o.type) : null,
        category: String(o?.category || ''),
        source: String(o?.source || ''),
        text: String(o?.text || ''),
        minLevel: o?.minLevel == null ? null : Number(o.minLevel) || null,
        replaces: (Array.isArray(o?.replaces) ? o.replaces : []).map(String).filter(Boolean),
      })).filter((o) => o.name),
    });
  }
}

/** One menu by name, or null where no pack provides it. */
export function optionCatalogue(name) {
  const key = String(name || '').trim().toLowerCase();
  return key ? OPTION_CATALOGUES.get(key) || null : null;
}

/** Every menu registered, for a picker of catalogues. */
export function optionCatalogues() {
  return [...OPTION_CATALOGUES.values()];
}

/**
 * The menu a pack means for this class's column, where one says so.
 *
 * A menu block names the class and the feature it is for, so a column of that
 * name is what it is for -- switching the pack on is enough, and nothing has
 * to be added a second time to make the cells offer it. A menu naming no
 * class is offered to any class's column of that name.
 */
export function optionCatalogueFor(className, column) {
  const cls = menuKey(className);
  const col = menuKey(column);
  if (!col) return null;
  const hits = [...OPTION_CATALOGUES.values()].filter((c) => c.featureKey === col && (!c.classKey || c.classKey === cls));
  // A menu that names the class is meant more particularly than one that does not.
  return hits.find((c) => c.classKey) || hits[0] || null;
}

/**
 * One menu made of several, in the order a column names them.
 *
 * An archetype's menu joins the class's rather than replacing it outright:
 * the Isougiri's topological techniques push out the four base techniques
 * their own text names ("this replaces the Ranged Cut and Armor Rending
 * Slash") and leave the rest of the samurai's list standing. Later menus win,
 * so removing an archetype is putting its name back off the list.
 */
export function resolveOptionMenu(names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const found = list.map((n) => optionCatalogue(n)).filter(Boolean);
  if (found.length < 2) return found[0] || null;
  // One page writes "Armor-Rending Slash" and the next "Armor Rending Slash",
  // so entries meet on their letters rather than their punctuation.
  const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const out = [];
  for (const cat of found) {
    const gone = new Set(cat.options.flatMap((o) => o.replaces).map(key));
    for (let i = out.length - 1; i >= 0; i--) if (gone.has(key(out[i].name))) out.splice(i, 1);
    for (const o of cat.options) {
      const at = out.findIndex((x) => key(x.name) === key(o.name));
      if (at === -1) out.push(o); else out[at] = o;
    }
  }
  return { ...found[found.length - 1], name: found.map((c) => c.name).join(' + '), options: out };
}

export function setProgressionClass(model, level, track, className) {
  const row = model.data.progression?.levels?.[level - 1];
  if (!row) return model;
  while (row.classes.length < model.data.progression.tracks) row.classes.push(null);
  row.classes[track] = className || null;
  model.recompute();
  return model;
}

/**
 * Put one class on every level of a track, or clear the track.
 *
 * A single-classed track is twenty identical dropdowns, and a gestalt sheet
 * has two or three of them: the common case for this table is "this side is
 * Fighter the whole way", and it should not take twenty clicks to say so.
 */
export function fillProgressionTrack(model, track, className) {
  const p = model.data.progression;
  if (!p || track < 0 || track >= p.tracks) return model;
  const value = className ? String(className) : null;
  for (const row of p.levels || []) {
    while (row.classes.length < p.tracks) row.classes.push(null);
    row.classes[track] = value;
  }
  model.recompute();
  return model;
}

export function addProgressionTrack(model) {
  const p = model.data.progression;
  if (!p) return model;
  p.tracks += 1;
  model.recompute();
  return model;
}

/** Delete a class track; feature text is keyed by class name, so it survives. */
export function removeProgressionTrack(model, index) {
  const p = model.data.progression;
  if (!p || p.tracks <= 1 || index < 0 || index >= p.tracks) return model;
  p.tracks -= 1;
  for (const row of p.levels) {
    if (row.classes.length > index) row.classes.splice(index, 1);
  }
  model.recompute();
  return model;
}

/** Every class named anywhere in the progression, in first-appearance order. */
export function progressionClasses(model) {
  const out = [];
  for (const row of model.data.progression?.levels || []) {
    for (const n of row.classes || []) {
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Every class this character has, by the name it is written under.
 *
 * Two lists that normally agree: the Classes table, which is where hit dice
 * and save progressions live, and the Planner, which is where the levels
 * are. A class can be in one and not the other -- a Planner column named but
 * never given a row, a class row the Planner never mentions -- so both are
 * read, table first, because that is the spelling the player chose.
 */
export function classNames(model) {
  const out = [];
  for (const name of [...(model.data.classes || []).map((x) => x?.name), ...model.progressionClasses()]) {
    const clean = String(name || '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** The levels at which a class appears. */
export function classLevelsIn(model, className) {
  return (model.data.progression?.levels || [])
    .filter((row) => (row.classes || []).includes(className))
    .map((row) => row.level);
}

/**
 * How many levels of a class the progression grants at or below the
 * character's own level.
 *
 * This is the count the workbook reached with
 * `COUNTIF(FILTER(PlannerClasses, PlannerLevel <= Level), <class>)`, and so
 * the caster or manifester level of any block naming that class. The name is
 * matched forgivingly against the progression's own spelling, because that
 * join is where the sheet broke: one workbook names a block `;egendary druid`
 * against a Planner reading `legendary druid`, the count came back zero, and
 * the block silently lost every slot it should have had.
 */
export function classLevelCount(model, className) {
  const match = closestName(className, model.progressionClasses());
  if (!match) return 0;
  const cap = Number(model.data.identity?.level) || 20;
  const own = model.classLevelsIn(match).filter((lvl) => lvl <= cap).length;
  // "Counts as two levels higher of Kineticist" is a rule about this number
  // and nothing else, so it goes on here rather than in the Planner: the
  // levels the character actually took do not move, and neither do the hit
  // dice, base saves and BAB that are built from which class ran when.
  // Nothing is conjured out of nothing -- a class with no levels stays at 0,
  // because an effective level is a multiplier on a class you have.
  return own + (own ? forwarded(model, `class.${slug(match)}.level`) : 0);
}

export function featureGroup(model, className) {
  const p = model.data.progression;
  if (!p) return null;
  const key = className || 'General';
  if (!p.classFeatures[key]) p.classFeatures[key] = { columns: [], byLevel: {}, rules: {}, optionsFrom: {} };
  if (!p.classFeatures[key].rules) p.classFeatures[key].rules = {};
  if (!p.classFeatures[key].optionsFrom) p.classFeatures[key].optionsFrom = {};
  return p.classFeatures[key];
}

/**
 * The class's own level count at a character level, for rule evaluation.
 */
export function classLevelAt(model, className, level) {
  const levels = className === 'General'
    ? (model.data.progression?.levels || []).map((r) => r.level)
    : model.classLevelsIn(className);
  const i = levels.indexOf(Number(level));
  return i === -1 ? Number(level) : i + 1;
}

/** The rule groups granting in a column at a level, in declaration order. */
export function grantingGroups(model, className, column, level) {
  const groups = model.data.progression?.classFeatures?.[className]?.rules?.[column] || [];
  if (!groups.length) return [];
  const classLevel = classLevelAt(model, className, level);
  return groups
    .map((grp, index) => ({
      index, key: featureGroupKey(grp, index), name: grp.name, color: grp.color, rule: grp.rule,
    }))
    .filter((x) => levelRuleGrants(x.rule || '', classLevel, Number(level)));
}

/**
 * Write one feature cell.
 *
 * A cell holds a single string while a column has one field at that level --
 * which is every cell of an unruled column, and how every imported sheet is
 * stored. Where two rule groups grant at the same level the level has two
 * fields, and the cell becomes {groupKey: text} so each is its own entry. It
 * collapses back to a string as soon as only the owning group has anything,
 * so the saved shape stays as simple as the data really is.
 */
export function setClassFeature(model, className, level, column, text, key = null) {
  const g = featureGroup(model, className);
  if (!g) return model;
  if (!g.columns.includes(column)) g.columns.push(column);
  const row = (g.byLevel[level] ||= {});

  if (key == null) {
    row[column] = text;
    model.recompute();
    return model;
  }

  const granting = grantingGroups(model, className, column, level);
  const ownerKey = granting[0]?.key ?? null;
  let store = row[column];
  if (typeof store !== 'object' || store === null) {
    // A bare string belonged to whichever group owns the level.
    const prior = typeof store === 'string' ? store : '';
    store = {};
    if (prior.trim() && ownerKey !== null) store[ownerKey] = prior;
    row[column] = store;
  }
  if (String(text).trim()) store[key] = text;
  else delete store[key];

  const keys = Object.keys(store);
  if (!keys.length) delete row[column];
  else if (keys.length === 1 && keys[0] === ownerKey) row[column] = store[ownerKey];
  model.recompute();
  return model;
}

/** `at` puts the column back where it was, which is what restoring one wants. */
export function addClassFeatureColumn(model, className, name, at = null) {
  const g = featureGroup(model, className);
  if (!g || !name || g.columns.includes(name)) return model;
  if (at === null || at < 0 || at > g.columns.length) g.columns.push(name);
  else g.columns.splice(at, 0, name);
  model.recompute();
  return model;
}

export function renameClassFeatureColumn(model, className, index, name) {
  const g = featureGroup(model, className);
  const old = g?.columns?.[index];
  if (!g || old === undefined || !name || name === old || g.columns.includes(name)) return model;
  g.columns[index] = name;
  for (const row of Object.values(g.byLevel)) {
    if (Object.prototype.hasOwnProperty.call(row, old)) {
      row[name] = row[old];
      delete row[old];
    }
  }
  // The level rule, the menu and a saved column width all follow the rename.
  if (g.rules?.[old] !== undefined) {
    g.rules[name] = g.rules[old];
    delete g.rules[old];
  }
  if (g.optionsFrom?.[old] !== undefined) {
    g.optionsFrom[name] = g.optionsFrom[old];
    delete g.optionsFrom[old];
  }
  const widths = model.data.uiPrefs?.colWidths?.[`progfeat-${className}`];
  if (widths && widths[old] !== undefined) {
    widths[name] = widths[old];
    delete widths[old];
  }
  model.recompute();
  return model;
}

/**
 * The rule groups sharing a feature column, as {name, rule, color}.
 *
 * A column may carry several: a kineticist's one Wild Talent column holds
 * Infusions on odd levels and Utility talents on even ones, each with its
 * own colour, rather than being split in two.
 */
export function classFeatureRuleGroups(model, className, column) {
  return model.data.progression?.classFeatures?.[className]?.rules?.[column] || [];
}

export function addClassFeatureRuleGroup(model, className, index, { name = '', rule = '', color = null } = {}) {
  const g = featureGroup(model, className);
  const col = g?.columns?.[index];
  if (!g || col === undefined) return model;
  const list = (g.rules[col] ||= []);
  list.push({
    name: String(name).trim(),
    rule: String(rule).trim(),
    color: normalizeHex(color) || FEATURE_GROUP_COLORS[list.length % FEATURE_GROUP_COLORS.length],
  });
  model.recompute();
  return model;
}

/**
 * Edit one group. Typing the braced form "{Infusions, odd, -5}" into either
 * text field fills both, since that is how a group reads written out.
 */
export function setClassFeatureRuleGroup(model, className, index, groupIndex, patch = {}) {
  const g = featureGroup(model, className);
  const col = g?.columns?.[index];
  const group = g?.rules?.[col]?.[groupIndex];
  if (!group) return model;

  if (patch.optionsFrom !== undefined) {
    const menu = String(patch.optionsFrom ?? '').trim();
    if (menu) group.optionsFrom = menu; else delete group.optionsFrom;
  }
  const wasKey = featureGroupKey(group, groupIndex);
  for (const key of ['name', 'rule']) {
    if (patch[key] === undefined) continue;
    const text = String(patch[key]).trim();
    const braced = parseGroupText(text);
    if (braced) { group.name = braced.name; group.rule = braced.rule; }
    else group[key] = text;
  }
  if (patch.color !== undefined) group.color = normalizeHex(patch.color) || group.color;

  // Cell text is filed under the group's name, so a rename takes it along --
  // the same way renaming a column carries its column.
  const nowKey = featureGroupKey(group, groupIndex);
  if (nowKey !== wasKey) {
    for (const row of Object.values(g.byLevel)) {
      const store = row[col];
      if (store && typeof store === 'object'
        && Object.prototype.hasOwnProperty.call(store, wasKey)) {
        store[nowKey] = store[wasKey];
        delete store[wasKey];
      }
    }
  }

  // A group with neither a name nor a rule nor a menu is nothing; drop it,
  // and the column's list with the last one, so it reads as unruled again.
  if (!group.name && !group.rule && !group.optionsFrom) return model.removeClassFeatureRuleGroup(className, index, groupIndex);
  model.recompute();
  return model;
}

export function removeClassFeatureRuleGroup(model, className, index, groupIndex) {
  const g = featureGroup(model, className);
  const col = g?.columns?.[index];
  const list = g?.rules?.[col];
  if (!list?.[groupIndex]) return model;
  list.splice(groupIndex, 1);
  if (!list.length) delete g.rules[col];
  model.recompute();
  return model;
}

/**
 * A class's own feature text, kept with the class rather than on the
 * Template tab, which is for templates.
 *
 * The ladder above says which feature arrives when; this says what each one
 * does, one entry per distinct feature however many levels grant it. An
 * archetype's features join the same list and leave it again with the
 * archetype.
 */
export function classFeatureNotes(model, className) {
  return model.data.progression?.classFeatures?.[className]?.notes || [];
}

export function addClassFeatureNote(model, className, { name, type = null, text = '' } = {}) {
  const g = featureGroup(model, className);
  const n = String(name ?? '').trim();
  if (!g || !n) return model;
  if (!Array.isArray(g.notes)) g.notes = [];
  if (g.notes.some((x) => normalizeName(x.name) === normalizeName(n))) return model;
  g.notes.push({ name: n, type: TEMPLATE_TYPES.includes(type) ? type : null, text: String(text ?? '') });
  model.recompute();
  return model;
}

export function setClassFeatureNote(model, className, index, patch = {}) {
  const note = featureGroup(model, className)?.notes?.[index];
  if (!note) return model;
  if (patch.name !== undefined) note.name = String(patch.name);
  if (patch.text !== undefined) note.text = String(patch.text);
  if (patch.type !== undefined) note.type = TEMPLATE_TYPES.includes(patch.type) ? patch.type : null;
  model.recompute();
  return model;
}

export function removeClassFeatureNote(model, className, index) {
  const notes = featureGroup(model, className)?.notes;
  if (!notes?.[index]) return model;
  notes.splice(index, 1);
  model.recompute();
  return model;
}

/**
 * Point a whole column at a menu, by catalogue name. Every group in it picks
 * from that menu unless the group names one of its own. Empty text clears it.
 */
export function setClassFeatureColumnOptions(model, className, index, catalogue) {
  const g = featureGroup(model, className);
  const col = g?.columns?.[index];
  if (!g || col === undefined) return model;
  const list = (Array.isArray(catalogue) ? catalogue : [catalogue])
    .map((s) => String(s ?? '').trim()).filter(Boolean);
  // One menu is stored as the name itself; several as the list they are; and
  // none as the empty list, which is the player saying so rather than saying
  // nothing -- a pack's own claim on the column does not come back over it.
  g.optionsFrom[col] = list.length === 1 ? list[0] : list;
  model.recompute();
  return model;
}

/**
 * The menus a column picks from, in the order they layer.
 *
 * Nothing recorded means the packs decide: a menu that names this class and
 * this feature is what the column is for. An empty list recorded means the
 * player said no menu, which no pack then overrides.
 */
export function classFeatureColumnOptions(model, className, column) {
  const v = model.data.progression?.classFeatures?.[className]?.optionsFrom?.[column];
  if (v === undefined) {
    const auto = optionCatalogueFor(className, column);
    return auto ? [auto.name] : [];
  }
  return Array.isArray(v) ? [...v] : (v ? [v] : []);
}

/** Did the player name the column's menu, or did a pack claim it? */
export function classFeatureColumnOptionsChosen(model, className, column) {
  return model.data.progression?.classFeatures?.[className]?.optionsFrom?.[column] !== undefined;
}

/**
 * Layer another menu onto a column, or take it off again.
 *
 * This is how an archetype's own menu joins the class's: it goes on the end,
 * so its entries win and the ones its text replaces drop out, and removing
 * the archetype is taking the name off the list again.
 */
export function addClassFeatureColumnOptions(model, className, column, catalogue) {
  const g = featureGroup(model, className);
  const index = (g?.columns || []).indexOf(column);
  const name = String(catalogue ?? '').trim();
  if (index === -1 || !name) return model;
  const list = model.classFeatureColumnOptions(className, column)
    .filter((n) => n.toLowerCase() !== name.toLowerCase());
  return model.setClassFeatureColumnOptions(className, index, [...list, name]);
}

export function removeClassFeatureColumnOptions(model, className, column, catalogue) {
  const g = featureGroup(model, className);
  const index = (g?.columns || []).indexOf(column);
  const name = String(catalogue ?? '').trim();
  if (index === -1 || !name) return model;
  const list = model.classFeatureColumnOptions(className, column)
    .filter((n) => n.toLowerCase() !== name.toLowerCase());
  return model.setClassFeatureColumnOptions(className, index, list);
}

/**
 * Set a column's whole rule from one string: the single-group shorthand.
 * Empty text clears every group, so the column grants at every level again.
 */
export function setClassFeatureColumnRule(model, className, index, source) {
  const g = featureGroup(model, className);
  const col = g?.columns?.[index];
  if (!g || col === undefined) return model;
  const text = String(source ?? '').trim();
  if (!text) { delete g.rules[col]; model.recompute(); return model; }
  if (!g.rules[col]?.length) model.addClassFeatureRuleGroup(className, index);
  return model.setClassFeatureRuleGroup(className, index, 0, { rule: text });
}

/**
 * A feature group's rows, with everything the grid needs to paint a cell.
 *
 * Rules count class levels by default, so this is where the two meet -- the
 * row is a character level, its position in the class's own list is the
 * class level, and a gestalt gap makes them diverge.
 *
 * Each cell comes back as a list of `fields`, one per rule group granting at
 * that level, because two groups landing on the same level -- a Blacksmith's
 * Smithing Insight on `even, 1` and Creation Specialist on `1, 5, +5` both
 * granting at 1 -- are two things to write down, not one. An unruled column
 * has exactly one field, which is every cell of every imported sheet.
 */
export function classFeatureRows(model, className) {
  const p = model.data.progression;
  const g = p?.classFeatures?.[className] || { columns: [], byLevel: {}, rules: {} };
  const columns = g.columns || [];
  const occupied = className === 'General'
    ? (p?.levels || []).map((r) => r.level)
    : model.classLevelsIn(className);
  // A group whose class has left the progression keeps the levels it holds
  // text for, so nothing it recorded goes out of view.
  const levels = occupied.length
    ? occupied
    : Object.keys(g.byLevel || {}).map(Number).sort((a, b) => a - b);
  const charLevel = Number(model.data.identity.level) || 0;

  // Parse each group's rule once for the whole column, not once per cell,
  // and resolve its menu once too -- the group's own, else the column's.
  const menuOf = (col, grp) => resolveOptionMenu(grp?.optionsFrom
    ? [grp.optionsFrom] : model.classFeatureColumnOptions(className, col));
  const parsed = Object.fromEntries(columns.map((col) => [col,
    (g.rules?.[col] || []).map((grp, i) => ({
      index: i, key: featureGroupKey(grp, i), name: grp.name, color: grp.color,
      optionsFrom: grp.optionsFrom || null, menu: menuOf(col, grp),
      ast: parseLevelRule(grp.rule || ''),
    }))]));
  // An unruled column has no group to hang a menu on, so it keeps its own.
  const columnMenu = Object.fromEntries(columns.map((col) => [col, menuOf(col, null)]));

  return levels.map((level, i) => {
    const classLevel = i + 1;
    const future = level > charLevel;
    const cells = {};
    for (const col of columns) {
      const groups = parsed[col];
      const ruled = groups.length > 0;
      const store = g.byLevel?.[level]?.[col];
      const asMap = store && typeof store === 'object';
      const hits = groups.filter((grp) => levelRuleGrants(grp.ast, classLevel, level));
      const on = !ruled || hits.length > 0;
      // A bare string is the owning group's text; a map holds one per group.
      const textFor = (grp) => (asMap
        ? String(store[grp.key] ?? '')
        : (grp && grp !== hits[0] ? '' : String(store ?? '')));

      const state = (text) => ({
        text,
        on: true,
        due: ruled && !text.trim() && !future,
        planned: ruled && !text.trim() && future,
        stranded: false,
      });
      const fields = ruled
        ? hits.map((grp) => ({ group: grp, key: grp.key, menu: grp.menu, ...state(textFor(grp)) }))
        : [{
          group: null, key: null, menu: columnMenu[col],
          ...state(String(store ?? '')), due: false, planned: false,
        }];

      // Text on a level no rule covers, or under a group since removed --
      // kept, flagged and read-only, never dropped.
      const orphanKeys = asMap
        ? Object.keys(store).filter((k) => !hits.some((h) => h.key === k)
          && String(store[k] ?? '').trim())
        : [];
      const orphans = orphanKeys.map((k) => ({
        group: { key: k, name: k, color: null, orphan: true },
        key: k,
        menu: columnMenu[col],
        text: String(store[k]),
        on: false,
        due: false,
        planned: false,
        stranded: true,
      }));
      if (ruled && !hits.length && !asMap && String(store ?? '').trim()) {
        orphans.push({
          group: null, key: null, menu: columnMenu[col], text: String(store), on: false,
          due: false, planned: false, stranded: true,
        });
      }
      // A locked, empty cell still needs one field to draw.
      if (ruled && !hits.length && !orphans.length) {
        orphans.push({
          group: null, key: null, menu: columnMenu[col], text: '', on: false,
          due: false, planned: false, stranded: false,
        });
      }

      cells[col] = {
        ruled,
        on,
        menu: columnMenu[col],
        fields: ruled && !hits.length ? orphans : [...fields, ...orphans],
        stranded: orphans.some((o) => o.stranded),
      };
    }
    return { level, classLevel, future, cells };
  });
}

/** How many slots a class's feature grid is owing, by column. */
export function classFeatureDue(model, className) {
  const out = {};
  for (const row of model.classFeatureRows(className)) {
    for (const [col, cell] of Object.entries(row.cells)) {
      const n = cell.fields.filter((f) => f.due).length;
      if (n) out[col] = (out[col] || 0) + n;
    }
  }
  return out;
}

/** Persist a dragged column width (px) for a feature-group table. */
export function setColumnWidth(model, tableKey, column, px) {
  const all = model.data.uiPrefs.colWidths || (model.data.uiPrefs.colWidths = {});
  (all[tableKey] ||= {})[column] = Math.round(px);
  model.recompute();
  return model;
}

export function removeClassFeatureColumn(model, className, index) {
  const g = featureGroup(model, className);
  const name = g?.columns?.[index];
  if (!g || name === undefined) return model;
  g.columns.splice(index, 1);
  for (const row of Object.values(g.byLevel)) delete row[name];
  delete g.rules[name];
  delete g.optionsFrom[name];
  model.recompute();
  return model;
}

/**
 * Everything the class table implies, following gestalt rules: at each
 * character level the classes present (from the Planner) contribute their
 * best progression.
 *
 *   - saves: good = +2 at the class's first level and +1/2 per level,
 *     poor = +1/3 per level; the +2 applies once per save.
 *   - hp/level and skill ranks/level: best among classes present.
 *
 * Writes the computed save bases onto saves.*.base, so the sheet's saves
 * follow the class table live. Runs before reconciliation, which keeps
 * imported totals intact (anything the sheet added beyond the base —
 * resistance bonuses, ABP — lands in the reconciliation offset as before).
 */
export function applyGestalt(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const classes = (c.classes || []).filter((x) => x.name);

  // Per class, which character levels it is present at.
  const presence = new Map();
  for (const cls of classes) {
    const override = cls.levelsOverride == null ? null : Number(cls.levelsOverride);
    let byLevel;
    if (override != null) {
      byLevel = Array.from({ length: level }, (_, i) => i + 1 <= override);
    } else {
      byLevel = Array.from({ length: level }, (_, i) => plannerHasClass(model, cls.name, i + 1));
      // A class the Planner never mentions is assumed to run all levels —
      // sparse planners name a class once rather than on every row.
      if (!byLevel.some(Boolean)) byLevel = byLevel.map(() => true);
    }
    presence.set(cls, byLevel);
    cls.gestaltLevels = byLevel.filter(Boolean).length;
  }

  const saves = { fortitude: 'goodFort', reflex: 'goodRef', will: 'goodWill' };
  const summary = { saves: {}, hpPerLevel: 0, ranksPerLevel: 0 };

  for (const [save, flag] of Object.entries(saves)) {
    const perLevel = [];
    for (let l = 1; l <= level; l++) {
      const present = classes.filter((x) => presence.get(x)[l - 1]);
      perLevel.push(present.length ? present.some((x) => !!x[flag]) : null);
    }
    const anyGood = classes.some((x) => x.gestaltLevels > 0 && !!x[flag]);
    const base = gestaltSaveBase(perLevel, anyGood);
    summary.saves[save] = { base, anyGood };
    if (c.saves?.[save]) c.saves[save].base = base;
  }

  const active = classes.filter((x) => x.gestaltLevels > 0);
  summary.hpPerLevel = Math.max(0, ...active.map((x) => Number(x.hd) || 0));
  summary.ranksPerLevel = Math.max(0, ...active.map((x) => Number(x.skillRanks) || 0));

  /*
   * Base attack bonus, the same way as the saves: each level takes the best
   * progression among the classes present at it, and the sum is floored
   * once at the end rather than per class. Floor-at-the-end is what the
   * workbook did, and the difference is real -- fifteen levels of 3/4 is
   * 11 that way and 11 the other, but ten of full plus one of 3/4 is 10,
   * not 10 and a bit rounded up somewhere.
   *
   * `babOverride` on a class row overrides that class's rate, which is what
   * the workbook's own column beside BAB was for.
   */
  // The workbook wrote "no override" as an empty cell, as a dash, and as a
  // null, and `Number(null)` is a perfectly finite zero -- which would
  // quietly give every class a BAB progression of none.
  const rateOf = (cls) => {
    const raw = cls.babOverride;
    const over = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(over) ? over : (Number(cls.bab) || 0);
  };
  let rate = 0;
  // The hit die taken at each level, alongside the progression -- the two
  // walk the same levels and ask the same question of them, and the Planner's
  // own sheet kept them as neighbouring columns for that reason.
  const hdPerLevel = [];
  /*
   * How often each class is the one setting the pace.
   *
   * Best-of-the-classes-present is a rule with a quiet failure mode: on a
   * character who already has a full-BAB class, dropping another class to
   * half changes the sheet by nothing at all, and a table that says so only
   * by not moving looks broken. Counted here, where presence is already in
   * hand, so the table can say which rows are being beaten and by how much.
   */
  const beaten = new Map(classes.map((x) => [x, { hd: 0, bab: 0, levels: 0 }]));
  for (let l = 1; l <= level; l++) {
    const present = classes.filter((x) => presence.get(x)[l - 1]);
    const bestBab = present.length ? Math.max(...present.map(rateOf)) : 0;
    const bestHd = present.length ? Math.max(...present.map((x) => Number(x.hd) || 0)) : 0;
    if (present.length) rate += bestBab;
    hdPerLevel.push(bestHd);
    for (const x of present) {
      const tally = beaten.get(x);
      tally.levels += 1;
      if (rateOf(x) < bestBab) tally.bab += 1;
      if ((Number(x.hd) || 0) < bestHd) tally.hd += 1;
    }
  }
  for (const cls of classes) cls.gestaltBeaten = beaten.get(cls);
  summary.babPerLevel = rate;
  summary.bab = Math.floor(rate);
  // The total rather than the array: the per-level figures are already on the
  // Planner rows, and the sum is the only one the hit-points readout asks for.
  summary.hdTotal = hdPerLevel.reduce((n, hd) => n + hd, 0);
  c.gestalt = summary;

  /*
   * The BAB the sheet was imported with, once.
   *
   * All five source workbooks agree with the rule above to the point, so
   * nothing moves on a normal import -- but a sheet whose classes do not
   * explain its BAB (a class table left half-filled, a progression the app
   * has no row for) would otherwise lose it the moment this ran. So the
   * first pass compares the two and pins the imported number as an override
   * when they differ, and leaves the field automatic when they agree.
   */
  if (c.attack) {
    if (c.attack.babOverride === undefined) {
      const imported = Number(c.attack.bab);
      c.attack.babOverride = Number.isFinite(imported) && imported !== summary.bab ? imported : null;
    }
    c.attack.babBase = summary.bab;
    c.attack.bab = c.attack.babOverride == null ? summary.bab : Number(c.attack.babOverride) || 0;
  }

  applyHitPoints(model, summary, hdPerLevel);

  // Per-level read-only numbers for the Progression tab, from the class
  // tracks actually chosen on each row.
  const byName = new Map(classes.map((x) => [x.name, x]));
  for (const row of c.progression?.levels || []) {
    const present = (row.classes || []).map((n) => byName.get(n)).filter(Boolean);
    const inc = (flag) => (present.length
      ? (present.some((x) => !!x[flag]) ? 0.5 : 0.33) : 0);
    row.computed = {
      hp: present.length ? Math.max(...present.map((x) => Number(x.hd) || 0)) : 0,
      ranks: present.length ? Math.max(...present.map((x) => Number(x.skillRanks) || 0)) : 0,
      fort: inc('goodFort'),
      ref: inc('goodRef'),
      will: inc('goodWill'),
    };
  }
}

/**
 * The bonus hit points a mythic tier is worth on this character.
 *
 * Typed in when the player has typed one, and otherwise the path's own figure
 * -- a sheet that says "Champion" has already said "five a tier", and asking
 * for the number again is asking it to repeat itself. Zero for a path the
 * table has no row for, which leaves the field to say what it is.
 */
export function mythicHpPerTier(c) {
  const typed = c.mythic?.bonusHpPerTier;
  if (typed !== null && typed !== undefined && typed !== '') return Number(typed) || 0;
  return MYTHIC_PATH_HP[String(c.mythic?.path || c.identity?.mythicPath || '').trim()] || 0;
}

/**
 * Hit points, worked out from the class table the way the saves and the base
 * attack bonus are.
 *
 * The parts live in `rules.hitPointBase`; what happens here is the same
 * arrangement the BAB field already uses, and for the same reason. `hp.base`
 * is what the classes come to and `hp.totalOverride` is a number the player
 * pinned over it, with the total following whichever is in force.
 *
 * The first pass is where a sheet that cannot explain its own hit points
 * keeps them: an imported total that the class table does not reproduce --
 * rolled dice rather than maximums, a bonus the workbook applied through some
 * formula that did not survive the export -- is pinned as an override then
 * and there, so importing never costs a character hit points. Where the two
 * agree, and they do on every workbook this was written against, the field
 * stays automatic and the total follows the classes from then on.
 */
export function applyHitPoints(model, summary, hdPerLevel = []) {
  const c = model.data;
  if (!c.hp) return;
  const level = Number(c.identity?.level) || 0;

  const abilityMod = statMod(c, c.hp.ability, c.hp.ability2);
  const perTier = mythicHpPerTier(c);
  const base = hitPointBase({
    perLevel: hdPerLevel,
    level,
    abilityMod,
    fcb: c.hp.fcb,
    toughness: c.hp.toughness,
    misc: c.hp.misc,
    mythicTier: c.identity?.mythicTier,
    mythicHpPerTier: perTier,
  });

  if (c.hp.totalOverride === undefined) {
    const imported = Number(c.hp.total);
    c.hp.totalOverride = Number.isFinite(imported) && imported !== base ? imported : null;
  }
  c.hp.base = base;
  c.hp.total = c.hp.totalOverride == null ? base : Number(c.hp.totalOverride) || 0;

  /*
   * The two figures the readout needs that are nowhere else: what the ability
   * slot came to, and what a tier turned out to be worth once the path had
   * been consulted. Everything else in the sum is already a field on `hp`,
   * and a summary that copied them would be a second place for them to be
   * wrong -- the hit dice above are the whole of what this block adds.
   */
  summary.hp = { abilityMod, mythicHpPerTier: perTier, base };
}

/**
 * Does the progression grant a level of `className` at character level `lvl`?
 *
 * Matched the way `classLevelCount` matches, because it is the same join and
 * the same trap: a class table reading `Legendary Kineticist` against a
 * Planner reading `legendary kineticst` is one character, and an exact
 * comparison answers "never" for every level -- which the caller then reads
 * as a class the Planner does not mention at all.
 */
export function plannerHasClass(model, className, lvl) {
  const row = model.data.progression?.levels?.[lvl - 1];
  if (!row) return false;
  const classes = row.classes || [];
  return classes.includes(className)
    || !!closestName(className, classes);
}
