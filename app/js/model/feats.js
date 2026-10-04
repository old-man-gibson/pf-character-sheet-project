/**
 * The level-up feats: one at every odd level, 1 through 19.
 *
 * A character gains those feats at fixed levels, so the group holding them
 * is ten fixed slots rather than a list. A slot's feat can be renamed,
 * cleared, or swapped with another slot's, and its Source / level always
 * reads the level of the slot it sits in. Nothing is added to the group or
 * taken out of it, and the group itself cannot be deleted; edit.js asks
 * `lockedFeatList` before every add, remove and cross-group move.
 */

export const LEVEL_UP_LEVELS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

const LEVEL_UP_NAME = /^level[\s-]*ups?(\s+feats?)?$/i;

const blankSlot = (level) => ({ name: '', detail: String(level), note: '' });
const hasContent = (e) => Boolean(String(e?.name ?? '').trim() || String(e?.note ?? '').trim());

/** The index of the level-up group in `featGroups`, or -1. */
export function levelUpGroupIndex(d) {
  return (d?.featGroups || []).findIndex((g) => g?.levelUp === true);
}

/**
 * Hold the level-up group to its ten slots. Run on every compute pass, so
 * whatever moved a row -- the arrows, a drag, an undo -- the levels are read
 * off the positions afterwards. `create` (on load only) makes the group when
 * the document has none; a compute pass never adds a group, since that would
 * shift the index of every group after it under whoever is holding one.
 *
 * The first time a document is seen, the group named "Level Up" is adopted
 * (or, with `create`, one is made, first in the list), and its feats are
 * seated by the level written beside them; a feat with no level, or one on a level already taken,
 * takes the first free slot. More feats than slots is a sheet that broke the
 * rule by hand, and the extras move to an "Other/Flex" group rather than
 * being lost.
 */
export function shapeLevelUpFeats(d, { create = false } = {}) {
  if (!Array.isArray(d?.featGroups) || d.monster) return;
  let gi = levelUpGroupIndex(d);
  if (gi === -1) {
    gi = d.featGroups.findIndex((g) => LEVEL_UP_NAME.test(String(g?.name ?? '').trim()));
    if (gi === -1) {
      if (!create) return;
      d.featGroups.unshift({ name: 'Level Up', entries: [] });
      gi = 0;
    }
    const group = d.featGroups[gi];
    group.levelUp = true;
    group.entries = seat(d, group.entries || []);
  }
  const group = d.featGroups[gi];
  if (!Array.isArray(group.entries)) group.entries = [];
  if (group.entries.length !== LEVEL_UP_LEVELS.length) group.entries = seat(d, group.entries, true);
  group.entries.forEach((e, i) => { e.detail = String(LEVEL_UP_LEVELS[i]); });
}

/** Seat `entries` into the ten slots; `inOrder` keeps their order instead of reading their levels. */
function seat(d, entries, inOrder = false) {
  const slots = LEVEL_UP_LEVELS.map(() => null);
  const waiting = [];
  for (const e of entries) {
    if (!hasContent(e)) continue;
    const at = inOrder ? -1 : LEVEL_UP_LEVELS.indexOf(Number(String(e.detail ?? '').trim()));
    if (at !== -1 && !slots[at]) slots[at] = e;
    else waiting.push(e);
  }
  for (let i = 0; i < slots.length && waiting.length; i++) if (!slots[i]) slots[i] = waiting.shift();
  if (waiting.length) {
    let flex = d.featGroups.find((g) => /^other\s*\/?\s*flex$/i.test(String(g?.name ?? '').trim()));
    if (!flex) d.featGroups.push(flex = { name: 'Other/Flex', entries: [] });
    flex.entries.push(...waiting);
  }
  return slots.map((e, i) => (e ? { note: '', ...e } : blankSlot(LEVEL_UP_LEVELS[i])));
}

/**
 * Why a list edit on `path` is refused, or null when it is allowed. `path`
 * is the list being added to or taken from; `index` names the group when the
 * list is `featGroups` itself.
 */
export function lockedFeatList(d, path, index = null) {
  const gi = levelUpGroupIndex(d);
  if (gi === -1) return null;
  if (path === 'featGroups') return index === gi ? 'The level-up feats cannot be removed.' : null;
  return path === `featGroups.${gi}.entries` ? 'The level-up feats are fixed slots, one per odd level.' : null;
}
