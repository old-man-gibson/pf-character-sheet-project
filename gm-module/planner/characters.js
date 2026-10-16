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
//   hasNeeds(m, text)  whether a character has what a hidden check needs
//                      ("Alchemist, or ranks in Craft (alchemy)"), and what on
//                      their sheet says so.
//
// planner.js imports this module only once a player has a character, since it
// brings the sheet's model with it.

import { COMPANION_KINDS } from '../../app/js/companions.js';
import { historyFor } from '../../app/js/history.js';
import { Character } from '../../app/js/model.js';
import { rollSpec } from '../../app/js/roll20.js';
import { skillLabel } from '../../app/js/rules.js';
import { normalizeName } from '../../app/js/model/util.js';
import { buildIndex, kindLabel } from '../../app/js/ui/palette.js';

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

// ---- What a character has, for a hidden check's needs ---------------------------
//
// A character's toolkit is what the sheet's search palette lists of them
// (ui/palette.js): classes and archetypes, feats and traits, spheres and
// talents, spells, powers, veils, known maneuvers, cards, techniques, gear,
// class features, companions and pools, plus the skills they have ranks in.
//
// A need is read as alternatives ("Alchemist, or ranks in Craft (alchemy)":
// split at commas, semicolons, slashes and "or"), each of parts that must all
// be had ("and", "&", "+"). A part is met by one thing on the sheet that has
// every word of it in its name (a talent's sphere and a companion's kind
// count too), words compared by their stem ("alchemist" meets "alchemy",
// "necromancy" meets "Necromancer"). Words that say nothing about which thing
// it is ("ranks in", "being an", "magic") are skipped; a part that mentions
// ranks looks only at skills, with "5 ranks" asking for five. The match is
// loose on purpose, so what it found is always shown: the GM decides.

const TOOLKIT_KINDS = new Set([
  'class', 'feat', 'sphere', 'talent', 'spell', 'power', 'veil', 'maneuver', 'card', 'technique',
  'gear', 'weapon', 'feature', 'progression', 'companion', 'tracker',
]);
const SKIP = new Set(('a an the and of in on to at by for with any some all has have having had be being is are '
  + 'can could who which that their its least more one or level levels class classes skill skills rank ranks '
  + 'feat feats talent talents sphere spheres spell spells magic power powers ability abilities use using '
  + 'cast casting caster trained training access able').split(' '));
const SUFFIXES = ['ings', 'ing', 'ists', 'ist', 'ical', 'ic', 'ers', 'er', 'ies', 'es', 'ed', 'al', 'y', 's'];

function stem(w) {
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 4 && w.endsWith(s) && !(s === 's' && w.endsWith('ss'))) return w.slice(0, -s.length);
  }
  return w;
}
// Words by their stem, with "Knowledge" as the sheet spells it ("Kn."),
// leaving out numbers and any in `skip`.
const wordsOf = (s, skip = null) => normalizeName(s).split(/[^a-z0-9]+/).filter(w => w && !/^\d+$/.test(w) && !skip?.has(w))
  .map(w => (w === 'knowledge' ? 'kn' : stem(w)));
// The same word, or one the start of the other that is most of it
// ("transmut", "transmutation"), not a short root ("shape", "shapeshift").
const sameWord = (x, y) => {
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && short.length >= long.length * 0.6 && long.startsWith(short);
};
// The kinds whose subtitle names what they belong to ("Dark · Bonus talent",
// "Animal companion"); the rest carry numbers or prose there.
const NAMED_BY_SUB = new Set(['talent', 'companion']);

const toolkits = new WeakMap();
function toolkit(model) {
  let list = toolkits.get(model);
  if (list) return list;
  list = [];
  const seen = new Set();
  const add = (label, words, also = [], ranks = null) => {
    if (seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    list.push({ label, words, also: [...words, ...also], ranks });
  };
  for (const row of buildIndex(model)) {
    if (!TOOLKIT_KINDS.has(row.kind)) continue;
    // A companion's own feats and skills are the companion's.
    if (COMPANION_KINDS.includes(row.tab) && row.kind !== 'companion') continue;
    // A discipline lists every maneuver in it; the known ones say so.
    if (row.kind === 'maneuver' && !row.value) continue;
    add(`${row.title} (${kindLabel(row.kind).toLowerCase()})`, wordsOf(row.title), NAMED_BY_SUB.has(row.kind) ? wordsOf(row.sub) : []);
  }
  for (const s of model.data.skills ?? []) {
    const ranks = Number(s.totalRanks) || 0;
    if (ranks <= 0) continue;
    const label = skillLabel(s.name, s.spec);
    add(`${label}, ${ranks} rank${ranks === 1 ? '' : 's'}`, wordsOf(label), [], ranks);
  }
  toolkits.set(model, list);
  return list;
}

// One part of a need, read: { words, ranks: null | n, skillsOnly }.
function readPart(text) {
  const ranks = /(\d+)\s*\+?\s*ranks?\b|\branks?\s*(?:of\s+|>=?\s*|≥\s*)?(\d+)/i.exec(text);
  return {
    words: wordsOf(text, SKIP),
    ranks: ranks ? Number(ranks[1] ?? ranks[2]) : null,
    skillsOnly: /\branks?\b/i.test(text),
  };
}

// { met: true | false | null, found: [label] }: whether the character has
// one of the needs' alternatives, and the things on the sheet that make it.
// `met` is null when the needs name nothing the sheet could have.
export function hasNeeds(model, needs) {
  // "5 or more ranks" is one need, not two alternatives.
  const alternatives = String(needs ?? '').replace(/\bor more\b/gi, '+').split(/\s*(?:[,;/|]|\bor\b)\s*/i)
    .map(alt => alt.split(/\s*(?:\band\b|&|\+(?!\s*ranks?))\s*/i).map(readPart).filter(p => p.words.length))
    .filter(parts => parts.length);
  if (!alternatives.length) return { met: null, found: [] };
  const list = toolkit(model);
  for (const parts of alternatives) {
    const found = [];
    for (const part of parts) {
      const fits = t => (!part.skillsOnly || t.ranks != null) && (part.ranks == null || (t.ranks ?? 0) >= part.ranks);
      const named = key => t => fits(t) && part.words.every(w => t[key].some(x => sameWord(w, x)));
      // A thing named for it ("Dark", the sphere) before one that only belongs
      // to it (a talent of the Dark sphere).
      const thing = list.find(named('words')) ?? list.find(named('also'));
      if (!thing) break;
      found.push(thing.label);
    }
    if (found.length === parts.length) return { met: true, found };
  }
  return { met: false, found: [] };
}
