/**
 * Classes, the level-by-level progression table, and class features.
 *
 * The progression table is the character's plan: which classes are taken at
 * which level, what each grants, and the option menus a repeating feature
 * chooses from. `#applyGestalt` turns that plan into the base saves, hit
 * points and skill ranks per level that the derived stats then read.
 */

import { gestaltSaveBase, levelRuleGrants, parseGroupText, parseLevelRule } from '../rules.js';
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

/**
 * Make an edit that moves a class's levels, and carry its feature cells along.
 *
 * A feature cell is stored under the character level it sits at, because that
 * is the row the player types on. What the text is *about*, though, is the
 * class's own level -- "the veil I picked at Kheshig 6" -- and so is every
 * rule that decides which cells are writable, which counts class levels for
 * exactly that reason. The two agree only while the class runs every level.
 * Open a gap in a gestalt track, or close one, and every class level past it
 * lands on a different row: the grants move, because they are computed, and
 * the text stays behind, because it is stored. A column written on
 * `1, 2, +4` comes back one row out, its veils sitting between the levels
 * that grant them.
 *
 * So an edit that changes which levels a class occupies re-keys that class's
 * cells to match, and class level 6's text follows class level 6 wherever it
 * went. What a shortened class has no room for is parked rather than dropped;
 * see `reanchorFeatureCells` below.
 */
function movingClassLevels(model, mutate) {
  const groups = model.data.progression?.classFeatures || {};
  const before = Object.keys(groups).map((name) => [name, classLevelsIn(model, name)]);
  mutate();
  const rows = (model.data.progression?.levels || []).map((r) => r.level);
  for (const [name, was] of before) {
    const now = classLevelsIn(model, name);
    if (was.length === now.length && was.every((lvl, i) => lvl === now[i])) continue;
    reanchorFeatureCells(groups[name], was, now, rows);
  }
  model.recompute();
  return model;
}

/** A cell's text, whatever shape it is stored in, as one string. */
const cellText = (v) => (v && typeof v === 'object'
  ? Object.values(v).map((x) => String(x ?? '').trim()).filter(Boolean).join('\n')
  : String(v ?? ''));

const hasText = (cells) => Object.values(cells || {}).some((v) => cellText(v).trim());

/**
 * Re-key one group's cells from the rows its class had onto the rows it has.
 *
 * Cells are gathered by class level for the length of the move, because that
 * is what they belong to; where each lands is then just `now[level - 1]`.
 *
 * A class that has shrunk has levels with no row to land on -- its last one or
 * two, the end the ladder just lost. Those cells go to `overflow`, under the
 * class level they were written for and the row they were on, and come back
 * the moment the class is long enough to have that level again. Parking rather
 * than folding them into the row that took their place is what makes taking a
 * level away and putting it back the no-op it looks like: a group whose class
 * is being pushed about does not grind its capstone into the level below.
 */
function reanchorFeatureCells(g, was, now, rows = []) {
  if (!g?.byLevel) return;
  // A class that has just joined the progression has no old ladder to line its
  // cells up against, and re-keying them against nothing would only move text
  // the player put where they wanted it.
  if (!was.length) return;
  // One that has left has no new ladder: the group falls back to showing the
  // rows it holds text for, so everything parked comes back out onto the row
  // it was parked from and the bay closes. Otherwise a class removed a level
  // at a time would empty itself into a bay nothing on the page mentions.
  if (!now.length) return unparkAll(g, rows);

  const byClassLevel = new Map();
  was.forEach((row, i) => { if (g.byLevel[row]) byClassLevel.set(i + 1, { row, cells: g.byLevel[row] }); });
  // Levels the class has grown back into take their cells out of the bay.
  for (const [key, held] of Object.entries(g.overflow || {})) {
    if (!byClassLevel.has(Number(key)) && held?.cells) byClassLevel.set(Number(key), held);
  }

  const next = {};
  const overflow = {};
  const place = (level, cells) => {
    for (const [col, text] of Object.entries(cells || {})) {
      if (!cellText(text).trim()) continue;
      const row = (next[level] ||= {});
      // Two cells on one row happens only where a row the class never held
      // carried text of its own; the class level that owns the row keeps what
      // it has and the rest is folded in beside it rather than dropped.
      if (row[col] === undefined) row[col] = text;
      else row[col] = [cellText(row[col]), cellText(text)].filter(Boolean).join('\n');
    }
  };

  for (const level of [...byClassLevel.keys()].sort((a, b) => a - b)) {
    const held = byClassLevel.get(level);
    const to = now[level - 1];
    if (to === undefined) { if (hasText(held.cells)) overflow[level] = held; continue; }
    place(to, held.cells);
  }
  // A row the class never occupied is nobody's class level, so it keeps its own.
  for (const [key, cells] of Object.entries(g.byLevel)) {
    if (!was.includes(Number(key))) place(Number(key), cells);
  }

  g.byLevel = next;
  if (Object.keys(overflow).length) g.overflow = overflow;
  else delete g.overflow;
}

/**
 * Put every parked cell back on a row, lowest class level first, and close
 * the bay.
 *
 * The row each was parked from is the first choice, but a class that retreated
 * a level at a time parked several of them off the same row -- each shrink
 * pushed a new class level onto the end of the ladder before losing it -- so a
 * cell whose old row is spoken for takes the first row that has nothing in
 * that column. Which row exactly matters little here: the class is out of the
 * progression, and the group is showing whatever rows it holds text for.
 */
function unparkAll(g, rows = []) {
  for (const level of Object.keys(g.overflow || {}).map(Number).sort((a, b) => a - b)) {
    const held = g.overflow[level];
    for (const [col, text] of Object.entries(held?.cells || {})) {
      if (!cellText(text).trim()) continue;
      const free = (lvl) => lvl !== undefined && g.byLevel[lvl]?.[col] === undefined;
      const at = free(held.row) ? held.row : rows.find(free);
      if (at === undefined) continue;              // every row already answers for this column
      (g.byLevel[at] ||= {})[col] = text;
    }
  }
  delete g.overflow;
}

/**
 * Delete a feature group whose class no longer appears in the progression.
 *
 * A group outliving its class is deliberate: the text in it is the player's,
 * and losing a column of picks to a mistyped dropdown would be worse than a
 * stale panel, so it stays put and says "not in progression". What was
 * missing is the other end of that -- a way to say the class is really gone,
 * which a character who has renamed a class, or imported one twice, needs or
 * else carries the ghost for ever.
 *
 * Only a group with no levels can go. One the progression still names holds
 * the levels it is showing, and would be built again empty on the next
 * render, so deleting it would read as a bug rather than as a delete.
 */
export function removeClassFeatureGroup(model, className) {
  const p = model.data.progression;
  if (!p?.classFeatures?.[className]) return model;
  if (classLevelsIn(model, className).length) return model;
  delete p.classFeatures[className];
  model.recompute();
  return model;
}

/**
 * Cells parked by a class that shrank, by the class level each is waiting on.
 *
 * What the feature group's heading counts, so a player who shortens a class
 * can see that the text on the levels it lost is being held rather than gone.
 */
export function classFeatureParked(model, className) {
  return model.data.progression?.classFeatures?.[className]?.overflow || {};
}

export function setProgressionClass(model, level, track, className) {
  const row = model.data.progression?.levels?.[level - 1];
  if (!row) return model;
  return movingClassLevels(model, () => {
    while (row.classes.length < model.data.progression.tracks) row.classes.push(null);
    row.classes[track] = className || null;
  });
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
  return movingClassLevels(model, () => {
    for (const row of p.levels || []) {
      while (row.classes.length < p.tracks) row.classes.push(null);
      row.classes[track] = value;
    }
  });
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
  return movingClassLevels(model, () => {
    p.tracks -= 1;
    for (const row of p.levels) {
      if (row.classes.length > index) row.classes.splice(index, 1);
    }
  });
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
  for (let l = 1; l <= level; l++) {
    const present = classes.filter((x) => presence.get(x)[l - 1]);
    if (present.length) rate += Math.max(...present.map(rateOf));
  }
  summary.babPerLevel = rate;
  summary.bab = Math.floor(rate);
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
