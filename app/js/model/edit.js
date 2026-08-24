/**
 * The generic editing surface: set a path, add/remove/reorder a list item,
 * move a tab.
 *
 * These are the operations the UI's `data-set` and `data-item` controls reach
 * for, so they are deliberately dumb: they touch one place, recompute, and
 * emit. Anything that needs to know what it is editing belongs in the module
 * for that domain instead.
 */

import { GAME_SYSTEMS, cleanSkillVariant } from '../rules.js';
import { COMPANION_KINDS, companionInUse } from '../companions.js';
import { DEFAULT_TAB_ORDER, PROFICIENCY_LISTS, blankProficiencies } from './document.js';
import { emit } from './events.js';
import { COOKING_COURSES } from './subsystems/cooking.js';
import { guileInUse } from './subsystems/guile.js';
import { getPath, setPath, skillKey } from './util.js';

/**
 * Update any field by path and recompute.
 * Used by every input in the UI, so it is the single write entry point.
 */
export function setValue(model, path, value) {
  setPath(model.data, path, value);
  model.recompute();
  emit(model, { type: 'set', path, value });
  return model;
}

/** Read an array at `path`, creating it if absent. */
export function listAt(model, path) {
  let arr = getPath(model.data, path);
  if (!Array.isArray(arr)) {
    arr = [];
    setPath(model.data, path, arr);
  }
  return arr;
}

/** Append an item to a list section and return it. */
export function listAdd(model, path, item = {}) {
  const arr = model.list(path);
  arr.push(item);
  model.recompute();
  emit(model, { type: 'list-add', path, item });
  return item;
}

export function listRemove(model, path, index) {
  const arr = model.list(path);
  if (index < 0 || index >= arr.length) return model;
  const [removed] = arr.splice(index, 1);
  model.recompute();
  emit(model, { type: 'list-remove', path, removed });
  return model;
}

/**
 * Ready or unready one maneuver on a discipline.
 *
 * `path` addresses the discipline (`maneuvers.disciplines.0`) and the
 * maneuver is named rather than indexed, because the row it sits on comes
 * from the shared catalogue and its position there is not the character's
 * to depend on.
 */
/**
 * Tick or untick one proficiency on one of the fixed lists (familiarities,
 * handedness, groups, armor, shields). "None" on the shields list is a
 * statement rather than a kind, so it clears the others and they clear it.
 */
export function toggleProficiency(model, list, value) {
  const fixed = PROFICIENCY_LISTS[list];
  if (!fixed) return model;
  const canon = fixed.find((x) => x.toLowerCase() === String(value || '').toLowerCase());
  if (!canon) return model;
  const p = model.data.identity.proficiencies || (model.data.identity.proficiencies = blankProficiencies());
  const cur = p[list] || (p[list] = []);
  if (cur.includes(canon)) {
    p[list] = cur.filter((x) => x !== canon);
  } else if (list === 'shields' && canon === 'None') {
    p[list] = ['None'];
  } else {
    p[list] = [...cur.filter((x) => !(list === 'shields' && x === 'None')), canon];
  }
  // Keep the fixed list's own order, so the chips read the same way every time.
  p[list].sort((a, b) => fixed.indexOf(a) - fixed.indexOf(b));
  model.recompute();
  emit(model, { type: 'set', path: `identity.proficiencies.${list}`, value: p[list] });
  return model;
}

/** Move an item within a list, for reordering rows. */
export function listMove(model, path, index, delta) {
  const arr = model.list(path);
  const to = index + delta;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return model;
  const [item] = arr.splice(index, 1);
  arr.splice(to, 0, item);
  model.recompute();
  return model;
}

/**
 * Move an item to a place in its own list, for dragging one row past
 * another. `to` is where the item should land counting the list as it is
 * now, so dropping "after the third" is 3 whether the item came from before
 * it or after; the shift a removal causes is taken off here rather than by
 * every caller.
 */
export function listMoveTo(model, path, from, to) {
  const arr = model.list(path);
  if (from < 0 || from >= arr.length) return model;
  const target = Math.max(0, Math.min(arr.length - 1, to > from ? to - 1 : to));
  if (target === from) return model;
  const [item] = arr.splice(from, 1);
  arr.splice(target, 0, item);
  model.recompute();
  return model;
}

/**
 * Move an item out of one list and into another, for dragging a row from
 * one group's table to a different group's.
 *
 * `to` counts the destination as it is now, the same way `listMoveTo` does.
 * Moving within one list is that method's job and is handed straight to it,
 * so a caller that cannot tell the two apart -- a drop handler reading two
 * paths off the DOM -- does not have to.
 */
export function listMoveInto(model, fromPath, from, toPath, to) {
  if (fromPath === toPath) return model.listMoveTo(fromPath, from, to);
  const src = model.list(fromPath);
  if (from < 0 || from >= src.length) return model;
  const dest = model.list(toPath);
  const [item] = src.splice(from, 1);
  dest.splice(Math.max(0, Math.min(dest.length, to)), 0, item);
  model.recompute();
  return model;
}

/**
 * Edit one field of one item in a list section.
 *
 * Some field names come from spreadsheet headers and can contain dots, so an
 * exact own-property match wins over treating the name as a path.
 */
export function setItem(model, path, index, field, value) {
  const arr = model.list(path);
  if (arr[index] === undefined) return model;
  // A skill is identified by name and variant together, so renaming either
  // has to carry the specialty picks along or they silently detach.
  const renamingSkill = path === 'skills' && (field === 'name' || field === 'spec');
  const oldKey = renamingSkill ? skillKey(arr[index]) : null;
  if (field === 'self') {
    // Lists of plain strings (tradition drawbacks) replace the whole item.
    arr[index] = value;
  } else if (arr[index] === null || typeof arr[index] !== 'object') {
    return model;
  } else if (Object.prototype.hasOwnProperty.call(arr[index], field) || !String(field).includes('.')) {
    arr[index][field] = value;
  } else {
    setPath(arr[index], field, value);
  }
  if (renamingSkill) renameSkill(model, arr[index], oldKey);
  model.recompute();
  emit(model, { type: 'set-item', path, index, field, value });
  return model;
}

/**
 * Tidy a renamed skill and follow it wherever it was referred to by name.
 *
 * The variant is cleaned first -- a player who typed the whole thing,
 * "Craft (Weapons and Armor)", meant the variant -- and only then do the
 * specialty picks move to the new key.
 */
export function renameSkill(model, skill, oldKey) {
  skill.spec = cleanSkillVariant(skill.name, skill.spec) || null;
  const newKey = skillKey(skill);
  if (newKey === oldKey) return;
  const picks = model.data.specialtySkills || {};
  for (const slot of Object.keys(picks)) {
    if (picks[slot] === oldKey) picks[slot] = newKey;
  }
}

/** Create a new, empty system tab (a small editable grid). */
export function addSystemTab(model, name = 'New system', rows = 12, cols = 6) {
  const tabs = model.data.sheetTabs || (model.data.sheetTabs = []);
  let n = name;
  let i = 2;
  while (tabs.some((t) => t.name === n)) n = `${name} ${i++}`;
  const tab = {
    name: n,
    hidden: false,
    custom: true,
    rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: cols }, () => null) })),
  };
  tabs.push(tab);
  model.recompute();
  return tab;
}

/** Rename a system tab, carrying its hidden/collapsed prefs along. */
export function renameSystemTab(model, index, name) {
  const tabs = model.data.sheetTabs || [];
  const tab = tabs[index];
  const next = String(name || '').trim();
  if (!tab || !next || next === tab.name || tabs.some((t) => t.name === next)) return model;
  const prefs = model.data.uiPrefs;
  if (prefs?.hiddenTabs && tab.name in prefs.hiddenTabs) {
    prefs.hiddenTabs[next] = prefs.hiddenTabs[tab.name];
    delete prefs.hiddenTabs[tab.name];
  }
  // Its place on the tab bars is keyed by name, so the place follows the name.
  for (const listKey of ['tabOrder', 'sessionTabOrder']) {
    if (Array.isArray(prefs?.[listKey])) {
      prefs[listKey] = prefs[listKey].map((k) => (k === `sys:${tab.name}` ? `sys:${next}` : k));
    }
  }
  tab.name = next;
  model.recompute();
  return model;
}

export function removeSystemTab(model, index) {
  const tabs = model.data.sheetTabs || [];
  const tab = tabs[index];
  if (!tab) return model;
  tabs.splice(index, 1);
  if (model.data.uiPrefs?.hiddenTabs) delete model.data.uiPrefs.hiddenTabs[tab.name];
  for (const listKey of ['tabOrder', 'sessionTabOrder']) {
    if (Array.isArray(model.data.uiPrefs?.[listKey])) {
      model.data.uiPrefs[listKey] = model.data.uiPrefs[listKey].filter((k) => k !== `sys:${tab.name}`);
    }
  }
  model.recompute();
  return model;
}

/** Which view the sheet is in: 'build' (everything) or 'session' (at the table). */
export function viewMode(model) {
  return model.data.uiPrefs?.viewMode === 'session' ? 'session' : 'build';
}

/**
 * Switch views. Each view keeps its own tab bar; entering the session view
 * for the first time seeds its bar from what the character actually uses,
 * so the first look is already the right one.
 */
export function setViewMode(model, mode) {
  const next = mode === 'session' ? 'session' : 'build';
  if (!model.data.uiPrefs) model.data.uiPrefs = {};
  if (next === 'session' && !Array.isArray(model.data.uiPrefs.sessionTabOrder)) {
    model.data.uiPrefs.sessionTabOrder = model.sessionDefaultTabs();
  }
  model.data.uiPrefs.viewMode = next;
  model.recompute();
  emit(model, { type: 'view-mode', mode: next });
  return model;
}

/**
 * Which modelled sub-system tabs already hold this character's data, keyed
 * by tab id -- the single source for the ⚙ manager's "in use"/"empty"
 * badges and for seeding the session bar.
 */
export function systemTabsInUse(model) {
  const d = model.data;
  const cr = d.crafting;
  const trainingSide = (side) => !!side
    && ((side.classes || []).some((x) => x?.name) || !!side.tradition?.name);
  const out = {
    martial: trainingSide(d.training?.combat),
    magic: trainingSide(d.training?.magic),
    guile: guileInUse(d.training?.guile),
    crafting: !!cr && ((cr.projects || []).some((p) => String(p.name || '').trim() || Number(p.value))
      || (cr.speedIncreases || []).length > 0 || (cr.costReductions || []).length > 0),
    akashic: !!(d.akashic?.slots || []).length,
    maneuvers: !!(d.maneuvers?.disciplines || []).length,
    vancian: !!(d.vancian?.classes || []).length,
    psionics: !!(d.psionics?.classes || []).length,
    // A deck, or the Card Casting drawback on the tradition, is enough.
    cardcasting: !!(d.cardcasting?.cards || []).length || !!d.cardcasting?.enabled,
    techniques: !!(d.techniques?.catalogue || []).length,
    autoTechnique: !!d.techniques?.draft?.name,
    cooking: COOKING_COURSES.some(([k]) => (d.cooking?.[k] || []).some(Boolean)),
    template: !!(d.templates || []).length,
  };
  for (const kind of COMPANION_KINDS) out[kind] = companionInUse(kind, d[kind]);
  return out;
}

/** The tab ids lit up by the systems marked on the Classes table. */
export function taggedSystemTabs(model) {
  const byId = new Map(GAME_SYSTEMS.map((s) => [s.id, s]));
  const tagged = new Set();
  for (const cls of model.data.classes || []) {
    for (const id of cls?.systems || []) {
      for (const tabId of byId.get(id)?.tabs || []) tagged.add(tabId);
    }
  }
  return tagged;
}

/** Mark or unmark one class as using one sub-system (a GAME_SYSTEMS id). */
export function toggleClassSystem(model, index, systemId) {
  const cls = (model.data.classes || [])[index];
  if (!cls || typeof cls !== 'object') return model;
  if (!Array.isArray(cls.systems)) cls.systems = [];
  const at = cls.systems.indexOf(systemId);
  if (at >= 0) cls.systems.splice(at, 1);
  else cls.systems.push(systemId);
  model.recompute();
  emit(model, { type: 'class-system', index, systemId, on: at < 0 });
  return model;
}

/**
 * The session bar a character starts from: the tabs that come up at the
 * table, plus every sub-system that is in use or marked on a class. The
 * heavy build machinery -- Stats, Progression, the worksheets -- waits in
 * the ⚙ manager, where it can always be pulled back on.
 */
export function sessionDefaultTabs(model) {
  const inUse = model.systemTabsInUse();
  const tagged = model.taggedSystemTabs();
  const systems = Object.keys(inUse).filter((id) => inUse[id] || tagged.has(id));
  return ['overview', 'skills', ...systems, 'features', 'primordia', 'trackers', 'gear', 'lore'];
}

/** The keys on the active view's tab bar, in order (a copy). */
export function tabOrder(model) {
  const prefs = model.data.uiPrefs || {};
  if (model.viewMode() === 'session') {
    return [...(prefs.sessionTabOrder || model.sessionDefaultTabs())];
  }
  return [...(prefs.tabOrder || DEFAULT_TAB_ORDER)];
}

/** Replace the active view's tab bar wholesale; keys are de-duplicated, order kept. */
export function setTabOrder(model, keys) {
  const listKey = model.viewMode() === 'session' ? 'sessionTabOrder' : 'tabOrder';
  model.data.uiPrefs[listKey] = [...new Set(keys.map(String))];
  model.recompute();
  return model;
}

/** Put the active view's bar back to its default. */
export function resetTabOrder(model) {
  return model.setTabOrder(model.viewMode() === 'session'
    ? model.sessionDefaultTabs() : DEFAULT_TAB_ORDER);
}

/** Put a tab on the bar (at the end, or at `at`) -- a no-op if it is already there. */
export function showTab(model, key, at) {
  const order = model.tabOrder();
  if (order.includes(key)) return model;
  if (at === undefined || at < 0 || at > order.length) order.push(key);
  else order.splice(at, 0, key);
  return model.setTabOrder(order);
}

/** Take a tab off the bar; it waits in the manager with its data intact. */
export function hideTab(model, key) {
  return model.setTabOrder(model.tabOrder().filter((k) => k !== key));
}

/** Move a tab on the bar to sit before the tab at `to` (or at the end). */
export function moveTab(model, key, to) {
  const order = model.tabOrder();
  const from = order.indexOf(key);
  if (from < 0) return model;
  order.splice(from, 1);
  const target = Math.max(0, Math.min(order.length, to > from ? to - 1 : to));
  order.splice(target, 0, key);
  return model.setTabOrder(order);
}
