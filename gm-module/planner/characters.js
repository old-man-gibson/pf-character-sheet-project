// The sheet app's characters, for the planner's odds. The planner is served
// from the same site as the sheet (on the public site and from tools/serve.mjs
// alike), so it can read what the sheet keeps in this browser. It only reads.
//
//   roster()           the characters this browser has, and the ones the site
//                      bundles: [{ id, name, file? }]
//   loadCharacter(e)   a roster entry's current document, computed by the
//                      sheet's own model, as the sheet would open it (its saved
//                      version, else its working copy, else the imported
//                      document, else the bundled file)
//   checkBonus(m, n)   the bonus for a check named n: a skill ("Disable
//                      Device", "Knowledge (arcana)"), a save, initiative, or an
//                      ability check. Read through the sheet's roll code, so
//                      the character's conditions count.
//   chance(b, dc, s)   the chance of reaching dc on d20 + b.
//
// planner.js imports this module only once a player has a character, since it
// brings the sheet's model with it.

import { historyFor } from '../../app/js/history.js';
import { Character } from '../../app/js/model.js';
import { rollSpec } from '../../app/js/roll20.js';
import { skillLabel } from '../../app/js/rules.js';
import { normalizeName } from '../../app/js/model/util.js';

const LIBRARY_KEY = 'character-sheet:library';
const docKey = id => `character-sheet:doc:${id}`;
const bundled = file => new URL(`../../data/characters/${file}`, import.meta.url);

export async function roster() {
  const list = [];
  try {
    for (const c of JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? 'null')?.characters ?? []) {
      if (c?.id) list.push({ id: c.id, name: c.name || 'Unnamed character' });
    }
  } catch { /* storage blocked or unreadable: no local characters */ }
  try {
    const res = await fetch(new URL('../../data/characters/index.json', import.meta.url));
    if (res.ok) {
      for (const c of (await res.json()).characters ?? []) {
        if (c?.id && !list.some(x => x.id === c.id)) list.push({ id: c.id, name: c.name || 'Unnamed character', file: c.file });
      }
    }
  } catch { /* no bundled characters here */ }
  return list.sort((x, y) => x.name.localeCompare(y.name));
}

// The packs a character's rules may come from (spheres and other sub-systems),
// loaded once, as the sheet does. A character still computes without them.
let packs = null;
async function loadPacks() {
  packs ??= import('../../app/js/extension-runtime.js')
    .then(({ runtime }) => runtime.load(new URL('../../', import.meta.url)))
    .catch(() => null);
  return packs;
}

export async function loadCharacter(entry) {
  const history = historyFor(entry.id);
  let doc = null;
  try { doc = (await history.readSaved())?.data ?? null; } catch { /* no saved version */ }
  doc ??= history.readWorking()?.data ?? null;
  if (!doc) {
    try { doc = JSON.parse(localStorage.getItem(docKey(entry.id)) ?? 'null'); } catch { /* unreadable */ }
  }
  if (!doc && entry.file) {
    const res = await fetch(bundled(entry.file));
    if (res.ok) doc = await res.json();
  }
  if (!doc) throw new Error('not in this browser');
  await loadPacks();
  return new Character(doc);
}

// A name reduced to letters and digits, with "Knowledge" as the sheet spells
// it ("Kn. (arcana)"), so "Knowledge (arcana)", "Kn. (arcana)" and "kn arcana"
// all meet.
const key = s => normalizeName(s).replace(/^knowledge\b/, 'kn').replace(/[^a-z0-9]/g, '');

const SAVES = { fortitude: ['fortitude', 'fort'], reflex: ['reflex', 'ref'], will: ['will'] };
const ABILITY_NAMES = {
  str: ['strength', 'str'], dex: ['dexterity', 'dex'], con: ['constitution', 'con'],
  int: ['intelligence', 'int'], wis: ['wisdom', 'wis'], cha: ['charisma', 'cha'],
};
const strip = (k, words) => words.reduce((s, w) => (s.endsWith(w) && s !== w ? s.slice(0, -w.length) : s), k);

// What a check name reads as on a character: { kind, ref, label, untrained }
// for rollSpec, or null when the sheet has nothing by that name.
function findCheck(model, name) {
  const k = key(name);
  if (!k) return null;
  const skills = model.data.skills ?? [];
  // A skill by its full label, else by its name alone (the best of its
  // variants, as with several Craft skills).
  let i = skills.findIndex(s => key(skillLabel(s.name, s.spec)) === k);
  if (i < 0) {
    const named = skills.map((s, n) => [s, n]).filter(([s]) => key(s.name) === k);
    if (named.length) i = named.sort(([x], [y]) => (y.bonus ?? 0) - (x.bonus ?? 0))[0][1];
  }
  if (i >= 0) {
    const s = skills[i];
    return { kind: 'skill', ref: i, label: skillLabel(s.name, s.spec), untrained: !!s.requiresTraining && !s.totalRanks };
  }
  const bare = strip(k, ['save', 'savingthrow', 'check']);
  for (const [save, words] of Object.entries(SAVES)) {
    if (words.includes(bare)) return { kind: 'save', ref: save, label: save[0].toUpperCase() + save.slice(1), untrained: false };
  }
  if (bare === 'initiative' || bare === 'init') return { kind: 'initiative', ref: 'self', label: 'Initiative', untrained: false };
  for (const [ability, words] of Object.entries(ABILITY_NAMES)) {
    if (words.includes(bare)) return { kind: 'ability', ref: ability, label: `${words[0][0].toUpperCase()}${words[0].slice(1)} check`, untrained: false };
  }
  return null;
}

// { bonus, label, untrained, save } for a check on a character, or null.
export function checkBonus(model, name) {
  const found = findCheck(model, name);
  if (!found) return null;
  const formula = rollSpec(model.data, found.kind, found.ref, model.conditionState)?.rolls?.[0]?.formula ?? '';
  const m = /^\s*1d20\s*([+-]\s*\d+)?/i.exec(formula);
  if (!m) return null;
  return { bonus: Number((m[1] ?? '0').replace(/\s/g, '')), label: found.label, untrained: found.untrained, save: found.kind === 'save' };
}

// The chance that d20 + bonus reaches dc. A save always fails on a 1 and
// succeeds on a 20; a skill or ability check does not.
export function chance(bonus, dc, { save = false } = {}) {
  const p = Math.min(1, Math.max(0, (21 + bonus - dc) / 20));
  return save ? Math.min(0.95, Math.max(0.05, p)) : p;
}
