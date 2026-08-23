/**
 * Reading a document in, and writing one back out.
 *
 * `#normalise` is the compatibility layer: it reshapes what the converter
 * emits into forms the editor can address by path, and brings documents saved
 * by older schema versions up to date. It is long because every shape the
 * sheet has ever saved has to keep loading -- a character is somebody's
 * campaign, and a migration that drops a field loses their work.
 */

import {
  ABILITIES, AC_BONUS_TYPES, ARMOR_PROFICIENCIES, BACKGROUND_SKILLS, CONDITIONS,
  MYTHIC_STAT_BONUS, MYTHIC_STAT_TIERS, MYTHIC_TIERS, PRIMORDIA_LEVELS, SAVE_BONUS_TYPES,
  SHEET_CONDITIONS, SHIELD_PROFICIENCIES, TRAIT_SLOTS, WEAPON_FAMILIARITY, WEAPON_GROUPS,
  WEAPON_HANDEDNESS, conditionInfo, performCategory, skillVariantKind, tierAtLevel,
} from '../rules.js';
import {
  COMPANION_KINDS, COMPANION_TABS, defaultCompanion, normalizeCompanion,
} from '../companions.js';
import { FEATURE_GROUP_COLORS, normalizeHex } from '../tracker-style.js';
import { Character } from './character.js';
import { normalizeWealth } from './stats/wealth.js';
import { AKASHIC_DERIVED, importAkashic, splitVeilName } from './subsystems/akashic.js';
import {
  CARDCASTING_DERIVED, deckFeatNames, importCardcasting,
} from './subsystems/cardcasting.js';
import { COMPANION_DERIVED } from './subsystems/companions.js';
import { importCooking, normalizeDish } from './subsystems/cooking.js';
import { importCrafting } from './subsystems/crafting.js';
import { MANEUVER_DERIVED, importManeuvers, shrinkDiscipline } from './subsystems/maneuvers.js';
import { PRIMORDIA_DERIVED } from './subsystems/primordia.js';
import { PSIONIC_DERIVED, importPsionics } from './subsystems/psionics.js';
import { importTechniques, normalizeTechniques } from './subsystems/techniques.js';
import { VANCIAN_DERIVED, importVancian, mergeVancian } from './subsystems/vancian.js';
import { TEMPLATE_TABS, TEMPLATE_TYPES, importTemplateTab, templateEntry } from './templates.js';
import { SHEET_TRACKER_OVERRIDES, seedTrackers } from './trackers.js';
import { normalizeName, skillKey, slug } from './util.js';

/**
 * The document shape this build understands, written by tools/convert.py.
 *
 * Bumped whenever a section is added or restructured. Saved edits and imported
 * files are both refused when they disagree: an older document is missing
 * whatever has been added since, and loading it would quietly drop sections.
 */
export const SCHEMA_VERSION = 9;

/**
 * The tabs a fresh sheet puts on its tab bar, in order. Everything else --
 * Spheres & Magic, Crafting, the modelled sub-systems, the workbook's
 * own extra worksheets -- is reachable from the ⚙ manager, where the player
 * shows, hides and rearranges. Keys are the tab ids in sheet-element.js; a
 * workbook worksheet is `sys:<its name>`.
 */
export const DEFAULT_TAB_ORDER = [
  'overview', 'stats', 'lore', 'skills', 'progression', 'features', 'primordia', 'trackers', 'gear',
];

export const PROFICIENCY_LISTS = {
  familiarities: WEAPON_FAMILIARITY,
  handedness: WEAPON_HANDEDNESS,
  groups: WEAPON_GROUPS,
  weapons: null,
  armor: ARMOR_PROFICIENCIES,
  shields: SHIELD_PROFICIENCIES,
};

export const blankProficiencies = () => ({
  familiarities: [], handedness: [], groups: [], weapons: [], armor: [], shields: [], notes: '',
});

/**
 * Read the workbook's three proficiency sentences into the lists.
 *
 * Familiarities are single words ("simple", "martial", "exotic"); handedness
 * only when it stands on its own before "weapons" ("all light weapons",
 * "one-handed martial weapons") -- a "light hammer" is a weapon, not a
 * category. Weapon groups need the word "group" or an "all" in front, since
 * "double" and "close" are ordinary words in a list of weapon names. Whatever
 * is left after those are taken out, split on commas and "and", is a specific
 * weapon. Armor is its weights; a shield sentence is read for each kind, with
 * a bare "shields" meaning the three a Shield Proficiency covers and "tower"
 * counting only when it is not being excepted.
 */
export function parseProficiencyText({ weapons, armor, shield } = {}) {
  const p = blankProficiencies();
  const notes = [];
  const has = (list, v) => list.some((x) => x.toLowerCase() === v.toLowerCase());
  const add = (list, v) => { if (!has(list, v)) list.push(v); };

  const wtext = String(weapons || '').trim();
  if (wtext) {
    const low = wtext.toLowerCase();
    for (const f of WEAPON_FAMILIARITY) {
      if (new RegExp(`\\b${f.toLowerCase()}\\b`).test(low)) add(p.familiarities, f);
    }
    const handRe = (h) => new RegExp(`\\b(?:all )?${h.toLowerCase()}(?: (?:simple|martial|exotic))? weapons?\\b`);
    for (const h of WEAPON_HANDEDNESS) if (handRe(h).test(low)) add(p.handedness, h);
    const groupRe = (g) => new RegExp(`\\b(?:${g.toLowerCase()}(?: weapons?)? group|all ${g.toLowerCase()}(?: weapons)?)\\b`);
    for (const g of WEAPON_GROUPS) if (groupRe(g).test(low)) add(p.groups, g);

    const known = new Set([
      ...WEAPON_FAMILIARITY, ...WEAPON_HANDEDNESS, ...WEAPON_GROUPS,
      ...WEAPON_HANDEDNESS.flatMap((h) => WEAPON_FAMILIARITY.map((f) => `${h} ${f}`)),
    ].map((x) => x.toLowerCase()));
    for (const part of wtext.split(/,|;|\n|\band\b|\bplus\b/i)) {
      let token = part.trim().replace(/^(?:all|the|any)\s+/i, '').replace(/[.]+$/, '').trim();
      if (!token) continue;
      const bare = token.replace(/\s+(?:weapons?|(?:weapon )?group)$/i, '').toLowerCase();
      if (known.has(bare) || /^weapons?$/i.test(token)) continue;
      // "all simple weapons" was consumed above; "one-handed slashing
      // weapons" was not, and stays whole as something to read.
      add(p.weapons, token);
    }
  }

  const atext = String(armor || '').trim();
  if (atext) {
    const low = atext.toLowerCase();
    if (/\ball (?:types of |kinds of )?armou?r\b/.test(low)) ['Light', 'Medium', 'Heavy'].forEach((a) => add(p.armor, a));
    if (/\bunarmou?red\b/.test(low)) add(p.armor, 'Unarmored');
    if (/\blight\b/.test(low)) add(p.armor, 'Light');
    if (/\bmedium\b/.test(low)) add(p.armor, 'Medium');
    if (/\bheavy\b/.test(low)) add(p.armor, 'Heavy');
    if (!p.armor.length && !/^(?:none|no armou?r|-+|—)$/i.test(atext)) notes.push(`Armor: ${atext}`);
  }

  const stext = String(shield || '').trim();
  if (stext) {
    const low = stext.toLowerCase();
    if (/^(?:none|no shields?|-+|—)\b/.test(low)) add(p.shields, 'None');
    if (/\bbucklers?\b/.test(low)) add(p.shields, 'Buckler');
    if (/\blight shields?\b/.test(low)) add(p.shields, 'Light');
    if (/\bheavy shields?\b/.test(low)) add(p.shields, 'Heavy');
    const towerOut = /\b(?:except|excluding|but not|not|no|other than|save)\b[^,;)]*\btower\b/.test(low);
    if (/\btower\b/.test(low) && !towerOut) add(p.shields, 'Tower');
    // "shields", "all shields", "shields (except tower shields)": the three
    // that Shield Proficiency itself covers.
    if (/\bshields?\b/.test(low) && !/\b(?:light|heavy|tower) shields?\b/.test(low.replace(/\(.*?\)/g, ''))
      && !p.shields.includes('None')) {
      ['Buckler', 'Light', 'Heavy'].forEach((s) => add(p.shields, s));
    }
    if (!p.shields.length) notes.push(`Shields: ${stext}`);
  }

  p.notes = notes.join('\n');
  return p;
}

/**
 * Bring a proficiencies block to the list shape, whatever it was saved as:
 * absent, the workbook's sentences, or already lists (which are then only
 * tidied -- strings, no duplicates, the fixed lists' own spelling).
 */
export function normalizeProficiencies(raw) {
  // The workbook shape is three strings (or nulls) and no list anywhere.
  const legacy = raw && typeof raw === 'object'
    && !Object.keys(PROFICIENCY_LISTS).some((k) => Array.isArray(raw[k]));
  if (!raw || typeof raw !== 'object' || legacy) return parseProficiencyText(raw || {});

  const p = blankProficiencies();
  for (const [key, fixed] of Object.entries(PROFICIENCY_LISTS)) {
    const src = Array.isArray(raw[key]) ? raw[key] : [];
    for (const v of src) {
      const s = String(v ?? '').trim();
      if (!s) continue;
      const canon = fixed ? fixed.find((x) => x.toLowerCase() === s.toLowerCase()) : s;
      if (!canon) continue;
      if (!p[key].some((x) => x.toLowerCase() === canon.toLowerCase())) p[key].push(canon);
    }
  }
  p.notes = String(raw.notes ?? '');
  return p;
}

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

/**
 * Vet a document offered for import, without loading it.
 *
 * Returns what the picker needs to list it, or an error plain enough to act
 * on. It parses the document for real -- a file that survives this will load.
 */
export function inspectDocument(doc) {
  const fail = (error) => ({ ok: false, error, summary: null });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return fail('That file is not a character document.');
  }
  if (doc.schemaVersion === undefined) {
    return fail('No schemaVersion — this does not look like a sheet export.');
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    return fail(`Built for schema ${doc.schemaVersion}, but this app reads schema ${SCHEMA_VERSION}.`
      + ' Re-run tools/convert.py on the workbook to bring it up to date.');
  }
  if (!doc.identity?.name) return fail('No character name in the document.');

  let model;
  try {
    model = new Character(doc);
  } catch (err) {
    return fail(`The document did not load — ${err.message}`);
  }
  const d = model.data;
  return {
    ok: true,
    error: null,
    summary: {
      id: String(doc.id || slug(d.identity.name)),
      name: d.identity.name,
      race: d.identity.race || '',
      level: Number(d.identity.level) || 0,
      classes: (d.classes || []).map((c) => c.name).filter(Boolean),
      image: d.identity.image || '',
      schemaVersion: doc.schemaVersion,
    },
  };
}

/**
 * A cursor over one imported worksheet grid.
 *
 * The three sub-system tabs below are all read the same way: find a label,
 * take the value that follows it, and remember which cells were consumed so
 * whatever no label claimed can be kept verbatim. Addresses are never
 * hard-coded -- a character's Akashic tab may carry a veil slot the others do
 * not, and Narockro's Maneuvers tab runs a row longer, and both fall out of the
 * same scan.
 */
export function sheetReader(tab) {
  const rows = (tab?.rows || []).map((r) => [...(r.cells || [])]);
  const used = new Set();

  const at = (ri, ci) => (rows[ri] ? rows[ri][ci] ?? null : null);
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const mark = (ri, ci) => used.add(`${ri}:${ci}`);
  const isUsed = (ri, ci) => used.has(`${ri}:${ci}`);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && text(v) !== '' ? n : 0;
  };

  /**
   * The first value to the right of a label, skipping the blanks a merged
   * cell leaves behind. "Veilweaving Base DC" spans two columns and its value
   * sits in the third; "Essence Cap" has its value immediately beside it.
   */
  const rightOf = (ri, ci, span = 3) => {
    for (let n = 1; n <= span; n++) {
      if (text(at(ri, ci + n)) !== '') {
        mark(ri, ci);
        mark(ri, ci + n);
        return at(ri, ci + n);
      }
    }
    mark(ri, ci);
    return null;
  };

  /** Every cell whose trimmed text equals `label`, as [row, col] pairs. */
  const findAll = (label) => {
    const hits = [];
    rows.forEach((cells, ri) => cells.forEach((v, ci) => {
      if (typeof v === 'string' && v.trim() === label) hits.push([ri, ci]);
    }));
    return hits;
  };
  const find = (label) => findAll(label)[0] || null;

  /** Take a label anywhere on the sheet and return the value beside it. */
  const take = (label, span = 3) => {
    const hit = find(label);
    return hit ? rightOf(hit[0], hit[1], span) : null;
  };

  /** Cells matching a pattern, as [row, col, match] triples. */
  const scan = (re) => {
    const hits = [];
    rows.forEach((cells, ri) => cells.forEach((v, ci) => {
      if (typeof v !== 'string') return;
      const m = re.exec(v.trim());
      if (m) hits.push([ri, ci, m]);
    }));
    return hits;
  };

  /**
   * Mark a column that is nothing but a counter as consumed.
   *
   * The Vancian tab carries three columns holding the literal integers 1 to
   * 156 -- the row numbers a spreadsheet dropdown was built from. They are not
   * character data and must not survive into `sourceExtras`.
   */
  const dropCounterColumns = (minRun = 8) => {
    const width = Math.max(0, ...rows.map((r) => r.length));
    for (let ci = 0; ci < width; ci++) {
      const filled = [];
      for (let ri = 0; ri < rows.length; ri++) {
        // A cell some label already claimed does not count against the run: the
        // Psionics tab heads its counter with "Power Known", and one word at the
        // top was enough to leave all sixty numbers behind as residue.
        if (isUsed(ri, ci)) continue;
        const v = at(ri, ci);
        if (text(v) !== '') filled.push([ri, Number(v)]);
      }
      if (filled.length < minRun || filled.some(([, n]) => !Number.isInteger(n))) continue;
      const ascends = filled.every(([, n], i) => i === 0 || n === filled[i - 1][1] + 1);
      if (ascends) for (const [ri] of filled) mark(ri, ci);
    }
  };

  /** Whatever no label claimed, trimmed of the blank columns it all shares. */
  const extras = () => {
    const out = [];
    rows.forEach((cells, ri) => {
      const kept = cells.map((v, ci) => (used.has(`${ri}:${ci}`) ? null : v));
      while (kept.length && (kept[kept.length - 1] === null || kept[kept.length - 1] === '')) kept.pop();
      if (kept.some((v) => v !== null && v !== undefined && v !== '')) out.push({ cells: kept, row: ri });
    });
    const lead = Math.min(...out.map(({ cells }) => cells.findIndex((v) => v !== null && v !== '')), Infinity);
    if (Number.isFinite(lead) && lead > 0) for (const r of out) r.cells = r.cells.slice(lead);
    return out.map(({ cells }) => ({ cells }));
  };

  return {
    rows, at, text, num, mark, isUsed, rightOf, find, findAll, take, scan,
    dropCounterColumns, extras,
  };
}

/**
 * Read the workbook's Psionics tab into manifesting classes and a point pool.
 *
 * Six blocks across, five columns apart, each holding a class name, one or two
 * manifesting abilities, the **PP@20** cell that picks which power-point curve
 * the class runs on, and then a list of powers with the level each is manifested
 * at. Beside them the tab keeps a Power Points panel -- one line per block, a
 * hand-entered Bonus PP, and a total.
 *
 * Every number in that panel was a formula, and a Google-only one, so it arrived
 * frozen. They are recomputed in `#recomputePsionics`; only Bonus PP is kept,
 * because on the sheet it is the one that was typed rather than worked out.
 *
 * The class name is free text -- a dropdown warned but did not refuse -- and one
 * workbook reaches us with `;egendary druid` where the Planner says `legendary
 * druid`. The sheet's COUNTIF answered that with a silent zero across the whole
 * block, which is 123 power points that simply were not there, so the name is
 * matched forgivingly against the progression instead.
 */
/**
 * The ExtrasNotes worksheet: three "Range" columns of free jottings and an
 * Approvals table (App / Approved by / Link). The template also ships eight
 * lines of hint text in the first two columns ("This sheet is not referenced
 * anywhere.", "Go ham.") which are not the player's and are not kept.
 *
 * Each Range column becomes a note; the approvals become rows; whatever else
 * was typed on the grid -- Saburo's "Veils to consider" table, Narockro's
 * claim tallies -- stays as extras, shown and editable, not modelled.
 * Returns `{ notes, approvals, sourceExtras }`.
 */
const EXTRAS_HINTS = new Set([
  'This sheet is not referenced anywhere.', "It's just for you to make notes.",
  'Or for stuff that doesn\'t fit elsewhere.', 'Go ham.', 'Just so you know, you can add links.',
  "It's Ctrl+K.", 'One cool idea I saw is to put approvals here.', 'So that\'s what the Range 4 is now.',
]);

function importExtras(tab) {
  const g = sheetReader(tab);
  const { rows, at, text, mark, find } = g;
  // A blank row on the worksheet is where one thing ends and the next begins,
  // and the converter's row numbers are what still show where those were.
  const rowNo = (tab?.rows || []).map((row, i) => Number(row?.r) || i + 1);
  const gapBefore = (r) => r > 0 && rowNo[r] !== rowNo[r - 1] + 1;
  const notes = [];
  for (const label of ['Range 1', 'Range 2', 'Range 3', 'Range 4']) {
    const hit = find(label);
    if (!hit) continue;
    const [r0, c] = hit;
    mark(r0, c);
    const lines = [];
    for (let r = r0 + 1; r < rows.length; r++) {
      const v = text(at(r, c));
      if (v === '' || gapBefore(r)) break;
      mark(r, c);
      if (!EXTRAS_HINTS.has(v)) lines.push(v);
    }
    if (lines.length) notes.push({ title: label, body: lines.join('\n') });
  }
  const approvals = [];
  const head = find('Approvals');
  if (head) {
    mark(head[0], head[1]);
    const [r1, c] = [head[0] + 1, head[1]];
    for (const [dc, want] of [[0, 'App'], [1, 'Approved by'], [2, 'Link']]) {
      if (text(at(r1, c + dc)) === want) mark(r1, c + dc);
    }
    for (let r = r1 + 1; r < rows.length; r++) {
      const name = text(at(r, c));
      const by = text(at(r, c + 1));
      const link = text(at(r, c + 2));
      if ((!name && !by && !link) || gapBefore(r)) break;
      mark(r, c); mark(r, c + 1); mark(r, c + 2);
      approvals.push({ name, approvedBy: by, link });
    }
  }
  return { notes, approvals, sourceExtras: g.extras() };
}

/** Copy a block without the values `recompute` will write back into it. */
function stripDerived(block, rules) {
  if (!block) return block;
  const out = { ...block };
  const drop = (obj, keys) => {
    const copy = { ...obj };
    for (const k of keys) delete copy[k];
    return copy;
  };
  for (const rule of rules) {
    if (typeof rule === 'string') {
      delete out[rule];
      continue;
    }
    // `obj` addresses one nested object rather than a list.
    if (rule.obj) {
      if (out[rule.obj] && typeof out[rule.obj] === 'object') out[rule.obj] = drop(out[rule.obj], rule.keys);
      continue;
    }
    const rows = out[rule.path];
    if (!Array.isArray(rows)) continue;
    out[rule.path] = rows.map((row) => {
      if (!rule.list) return drop(row, rule.keys);
      const inner = row[rule.list];
      if (!Array.isArray(inner)) return row;
      return { ...row, [rule.list]: inner.map((item) => drop(item, rule.keys)) };
    });
  }
  return out;
}

/**
 * Reshape imported data into forms the editor can address by path.
 *
 * The converter emits feats as an object keyed by group name, but group
 * names contain spaces, slashes and dots, which cannot be used as path
 * segments. They become an ordered list instead, which also lets groups be
 * added, renamed and reordered.
 */
export function normalise(model) {
  const d = model.data;
  if (!Array.isArray(d.featGroups)) {
    d.featGroups = Object.entries(d.feats || {}).map(([name, entries]) => ({
      name,
      entries: (entries || []).map((e) => ({ name: e.name ?? '', detail: e.detail ?? '' })),
    }));
  }
  delete d.feats;
  // Every feat takes a note, the way the granted feats beside them always
  // have. A group saved before the column existed has none, and a row with no
  // field for it would drop what a drag put there.
  for (const group of d.featGroups) {
    for (const e of group.entries || []) {
      if (e && typeof e === 'object' && e.note === undefined) e.note = '';
    }
  }

  // Background sections are keyed by prose labels ("Friends/Family",
  // "Ez'atian Certifications") which are not usable as path segments either.
  if (!Array.isArray(d.backgroundSections)) {
    const seed = d.background || {};
    const ORDER = ['Personality', 'Appearance', 'Likes', 'Dislikes', 'Goals', 'Fears',
      'Character Strengths', 'Character Flaws', 'Friends/Family', 'Enemies/Rivals',
      "Ez'atian Certifications", 'Additional Information'];
    const keys = [...new Set([...ORDER, ...Object.keys(seed)])];
    d.backgroundSections = keys.map((label) => ({ label, text: seed[label] ?? '' }));
  }
  delete d.background;

  // Tabs we did not model explicitly keep their raw cell grid, but the
  // object was keyed by tab title ("Combat Training", "Auto-Cooking"), which
  // is awkward to address. An ordered list keeps them editable.
  if (!Array.isArray(d.sheetTabs)) {
    d.sheetTabs = Object.entries(d.extraTabs || {}).map(([name, tab]) => ({
      name,
      hidden: !!tab.hidden,
      rows: (tab.rows || []).map((r) => ({ cells: [...(r.cells || [])] })),
    }));
  }
  // The Template tab is read below, and its blank rows are what separate one
  // feature from the next -- so keep the converter's row numbers, which the
  // list above drops, for as long as they are still here.
  const templateGrids = Object.fromEntries(Object.entries(d.extraTabs || {})
    .filter(([name]) => TEMPLATE_TABS.includes(name)));
  // ExtrasNotes wants them too: its columns end at a blank row.
  const extrasGrid = d.extraTabs?.ExtrasNotes ?? null;
  // And techRef, whose fields are one per row: keep the converter's copy for
  // the techniques import below.
  const techRefGrid = d.extraTabs?.techRef ?? null;
  delete d.extraTabs;

  // Item Crafting is a calculator, not a grid: read the workbook's tab into
  // the structured block the Crafting tab edits, then retire the raw copy so
  // the two cannot drift apart.
  const craftIndex = d.sheetTabs.findIndex((t) => t.name === 'Item Crafting');
  if (!d.crafting) {
    d.crafting = importCrafting(craftIndex < 0 ? null : d.sheetTabs[craftIndex], d.identity);
  }
  if (craftIndex >= 0) d.sheetTabs.splice(craftIndex, 1);

  // The three sub-systems that were worth modelling read the same way: take
  // the workbook's grid once, then retire it so the structured block and the
  // raw copy cannot drift apart. A document saved after this point no longer
  // carries the grid at all, which is most of what these tabs weighed.
  for (const [name, key, read] of [
    ['Akashic', 'akashic', importAkashic],
    ['Maneuvers', 'maneuvers', importManeuvers],
    ['Psionics', 'psionics', importPsionics],
  ]) {
    const index = d.sheetTabs.findIndex((t) => t.name === name);
    if (!d[key]) d[key] = read(index < 0 ? null : d.sheetTabs[index], d.identity);
    if (index >= 0) d.sheetTabs.splice(index, 1);
  }

  // The card caster's deck reads the same way. Its tab is one character's
  // own ("Cardcaster Deck"), so it is found by what it is called rather than
  // by an exact name, and the tradition's drawbacks seed the switches for a
  // caster who took Card Casting without ever building the tab.
  {
    const index = d.sheetTabs.findIndex((t) => /card\s*-?cast/i.test(String(t?.name || '')));
    if (!d.cardcasting) {
      d.cardcasting = importCardcasting(index < 0 ? null : d.sheetTabs[index],
        d.training?.magic?.tradition?.drawbacks || [], d.training?.magic?.classes || [], deckFeatNames(d));
    }
    if (index >= 0) d.sheetTabs.splice(index, 1);
  }

  /*
   * ExtrasNotes -- the workbook's scratch page -- reads into the Extras &
   * Notes tab: its Range columns join the character's notes, its Approvals
   * table becomes rows, and the grid is retired.
   */
  {
    const index = d.sheetTabs.findIndex((t) => t.name === 'ExtrasNotes');
    if (!d.extras) {
      const got = importExtras(extrasGrid ?? (index < 0 ? null : d.sheetTabs[index]));
      d.extras = { approvals: got.approvals, sourceExtras: got.sourceExtras };
      if (!Array.isArray(d.notes)) d.notes = [];
      d.notes.push(...got.notes);
    }
    if (!Array.isArray(d.extras.approvals)) d.extras.approvals = [];
    if (index >= 0) d.sheetTabs.splice(index, 1);
  }

  /*
   * The three companion sheets -- Familiar, Animal Companion, Eidolon -- were
   * template worksheets on every workbook, each a grid of formulas against
   * `dataSheet` that the export left as `#ERROR!`. They become structured
   * blocks that start empty and are worked out from the tables in
   * `companions.js`. None of the five characters ever filled one in, so
   * there is nothing to read off the grid; if a workbook's copy does carry a
   * name, the grid is kept beside the block rather than dropped.
   */
  for (const kind of COMPANION_KINDS) {
    const index = d.sheetTabs.findIndex((t) => t.name === COMPANION_TABS[kind]);
    d[kind] = normalizeCompanion(kind, d[kind] || defaultCompanion(kind));
    if (index < 0) continue;
    const g = sheetReader(d.sheetTabs[index]);
    const named = g.text(g.take('Name')) !== '';
    if (!named) d.sheetTabs.splice(index, 1);
  }

  /*
   * Vancian is the one of them that can arrive on more than one tab. The
   * older template fits two casting classes per tab and puts the epic ones on
   * a second, "Vancian Magic (Epic Classes)" -- which the single-name lookup
   * above would have left behind as a raw grid, stranding two of the
   * character's casting classes in it.
   */
  const isVancianTab = (t) => /^Vancian Magic\b/.test(String(t?.name || ''));
  if (!d.vancian) {
    const tabs = d.sheetTabs.filter(isVancianTab);
    d.vancian = mergeVancian((tabs.length ? tabs : [null])
      .map((t) => importVancian(t, d.identity)));
  }
  d.sheetTabs = d.sheetTabs.filter((t) => !isVancianTab(t));

  /*
   * Templates read the same way, and for the same reason: the workbook's
   * Template tab is imported once into the groups the Template tab edits and
   * the grid is then retired, so the two cannot drift apart.
   *
   * Whatever the scan cannot place lands in a Temporary group rather than
   * being dropped -- see `importTemplateTab`.
   */
  if (!Array.isArray(d.templates)) d.templates = [];
  // A document that already carries templates has been through this once; a
  // workbook carrying both tabs contributes both.
  const importedTemplates = d.templates.length > 0;
  for (const name of TEMPLATE_TABS) {
    const index = d.sheetTabs.findIndex((t) => t.name === name);
    const grid = templateGrids[name] ?? (index < 0 ? null : d.sheetTabs[index]);
    if (grid && !importedTemplates) {
      const doc = importTemplateTab(grid, name);
      if (doc) d.templates.push(doc);
    }
    if (index >= 0) d.sheetTabs.splice(index, 1);
  }
  d.templates = d.templates.map((tp) => ({
    ...tp,
    name: tp.name ?? tp.tab ?? 'Template',
    link: tp.link ?? null,
    approvalLink: tp.approvalLink ?? null,
    features: (Array.isArray(tp.features) ? tp.features : []).map((f) => templateEntry(f)),
  }));

  /*
   * Primordia techniques and the iron chef's dish read the same way as the
   * rest: the workbook's grids -- techRef, Technique List, AutoTechnique;
   * Auto-Cooking -- are imported once into their blocks and retired.
   */
  {
    const take = (name) => {
      const i = d.sheetTabs.findIndex((t) => t.name === name);
      return i < 0 ? null : d.sheetTabs.splice(i, 1)[0];
    };
    const refTab = take('techRef') ?? techRefGrid;
    const listTab = take('Technique List');
    const autoTab = take('AutoTechnique');
    if (!d.techniques) d.techniques = importTechniques(refTab, listTab, autoTab);
    d.techniques = normalizeTechniques(d.techniques);
    const cookTab = take('Auto-Cooking');
    if (!d.cooking) d.cooking = importCooking(cookTab);
    d.cooking = normalizeDish(d.cooking);
  }

  // The wallet: the converter's block when the workbook had one, else empty.
  d.wealth = normalizeWealth(d.wealth);

  // A document saved before the catalogue existed carries every maneuver its
  // disciplines grant. Reduce each one to the picks the character made.
  if (d.maneuvers) {
    d.maneuvers.disciplines = (d.maneuvers.disciplines || []).map(shrinkDiscipline);
  }

  // A veil saved before the description had its own field keeps the effect
  // bracketed inside the name.
  for (const holder of [...(d.akashic?.slots || []), ...(d.akashic?.kheshig || [])]) {
    holder.veils = (holder.veils || []).map((v) => (v.desc === undefined
      ? { ...splitVeilName(v.name), essence: v.essence } : v));
  }

  // Skills: split the imported rank columns into their editable sources.
  // The sheet's rule: total ranks = MIN(level, bought + flags*level + spheres)
  // where Specialty / Gear / Other are flags worth full level ranks.
  for (const s of d.skills || []) {
    if (!s.rankSources) {
      const r = s.ranks || {};
      s.rankSources = {
        bought: Number(r.Level) || 0,
        gear: (Number(r.Gear) || 0) > 0,
        other: (Number(r.Other) || 0) > 0,
      };
      s.importedSpecialty = (Number(r.Specialty) || 0) > 0;
      s.importedSphereRanks = Number(r.Spheres) || 0;
    }
  }

  // Seed the three specialty-skill choices from the imported flags:
  // one Knowledge/Lore skill, one background skill, one free pick.
  if (!d.specialtySkills) {
    const key = skillKey;
    const flagged = (d.skills || []).filter((s) => s.importedSpecialty);
    const isKn = (s) => /^(Kn\.|Knowledge|Lore)/i.test(s.name);
    const isBg = (s) => BACKGROUND_SKILLS.some((b) => s.name === b || s.name.startsWith(b));
    const kn = flagged.find(isKn);
    const bg = flagged.find((s) => s !== kn && isBg(s));
    const free = flagged.find((s) => s !== kn && s !== bg);
    d.specialtySkills = {
      knowledge: kn ? key(kn) : null,
      background: bg ? key(bg) : null,
      free: free ? key(free) : null,
    };
  }

  // Perform is a fixed list of nine, and the sheets abbreviate a couple of
  // them ("String" for "String instruments"). Resolve those to the real
  // category, carrying any specialty pick that named the old spelling.
  for (const s of d.skills || []) {
    if (skillVariantKind(s.name) !== 'perform') continue;
    const canonical = performCategory(s.spec);
    if (!canonical || canonical === s.spec) continue;
    const wasKey = skillKey(s);
    s.spec = canonical;
    const nowKey = skillKey(s);
    for (const slot of Object.keys(d.specialtySkills || {})) {
      if (d.specialtySkills[slot] === wasKey) d.specialtySkills[slot] = nowKey;
    }
  }

  // Structured trait/drawback slots: three mandatory traits, optional pairs
  // (Drawback 1 unlocks Trait 4, Drawback 2 unlocks Trait 5, a Major
  // Drawback buys a Drawback Feat), plus free additional traits.
  if (!d.traitSlots) {
    const bySheet = {};
    const additional = [];
    for (const t of d.traits || []) {
      const slot = TRAIT_SLOTS.find((s) => s.sheet === t.slot);
      if (slot) bySheet[slot.key] = { category: t.category ?? null, text: t.text ?? '' };
      else additional.push({ category: t.category ?? null, text: t.text ?? '' });
    }
    d.traitSlots = {};
    for (const s of TRAIT_SLOTS) {
      d.traitSlots[s.key] = bySheet[s.key] || { category: null, text: '' };
    }
    d.traitSlots.additional = additional;
  }
  delete d.traits;
  if (!Array.isArray(d.traitCategories)) d.traitCategories = [];

  /*
   * Feats that come with something rather than being picked at a level: the
   * one a Major Drawback buys, the mandatory Specialty feat, and the Oath and
   * Attunement feats.
   *
   * The sheet scattered these. The Drawback column reads [feat, "Specialty",
   * feat] -- a header row masquerading as a feat, with the source of each
   * only implied by its position -- while Oaths and Attunement were columns
   * of their own. Here they are one list, each row saying what granted it.
   */
  if (!d.grantedFeats) {
    const takeGroup = (re) => {
      const i = (d.featGroups || []).findIndex((g) => re.test(String(g.name || '').trim()));
      return i === -1 ? null : d.featGroups.splice(i, 1)[0];
    };
    // The importer put the feat's name in whichever of the two fields the
    // sheet happened to fill, so take the first that has anything.
    const slot = d.traitSlots?.drawbackFeat;
    const drawback = {
      name: String(slot?.category || slot?.text || '').trim(),
      note: slot?.category ? String(slot.text || '').trim() : '',
    };
    delete d.traitSlots?.drawbackFeat;   // one home for it, not two

    const names = (takeGroup(/^drawbacks?$/i)?.entries || []).map((e) => String(e.name || '').trim());
    const marker = names.findIndex((n) => /^specialty$/i.test(n));
    const specialty = marker === -1 ? '' : names.slice(marker + 1).find(Boolean) || '';

    const others = [];
    for (const [re, label] of [[/^oaths?$/i, 'Oath'], [/^attunement/i, 'Attunement']]) {
      for (const e of takeGroup(re)?.entries || []) {
        const detail = String(e.detail ?? '').trim();
        others.push({ source: detail ? `${label} ${detail}` : label, name: e.name ?? '', note: '' });
      }
    }

    d.grantedFeats = { drawback, specialty: { name: specialty, note: '' }, others };
  }
  if (!Array.isArray(d.grantedFeats.others)) d.grantedFeats.others = [];

  /*
   * A trait's name, which the workbook had nowhere to put.
   *
   * There were two cells for three things, so every sheet overloaded one of
   * them, and not the same one: a trait reads "Fate's Favored (+1 to any
   * existing Luck bonuses)" with the name and the effect in the one cell,
   * while a drawback's name went in the category column -- which is not a
   * category, has never been shown, and so has been carrying "Pride" and
   * "Overly Cautious" invisibly on every sheet that used it.
   *
   * The name gets its own field here, once, on any slot that has not been
   * through this: taken from the category on a drawback, and otherwise split
   * off the front of the text where the text is written as "Name (effect)"
   * or is a bare name with no sentence in it. A slot that reads as neither
   * keeps its text whole and starts with no name, which is what prose should
   * do. A category on a drawback is dropped once its name is out: it was
   * never a category, and the column does not show one.
   */
  {
    // "Name (effect)", the shape every sheet writes a trait in. The name is
    // short and paren-free; the effect is everything the brackets hold,
    // which may itself contain brackets.
    const shaped = /^([^()]{1,60}?)\s*\(([\s\S]+)\)\s*$/;
    const bare = (s) => s.length <= 48 && !/[.;:!?]/.test(s);
    const split = (text) => {
      const t = String(text ?? '').trim();
      const m = shaped.exec(t);
      if (m) return { name: m[1].trim(), text: m[2].trim() };
      if (t && bare(t)) return { name: t, text: '' };
      return { name: '', text: t };
    };
    const kindOf = (key) => TRAIT_SLOTS.find((s) => s.key === key)?.kind || 'trait';
    const name = (slot, kind) => {
      if (!slot || typeof slot !== 'object' || typeof slot.name === 'string') return;
      const drawback = kind !== 'trait';
      const category = String(slot.category ?? '').trim();
      const own = String(slot.text ?? '').trim();
      // A drawback whose category cell holds something holds its name there:
      // that cell is the only place the sheet had for it, and taking it
      // beats guessing at the front of the effect. It carries the effect too
      // when the effect column is empty, and then it is split like any other.
      if (drawback && category && !/^drawbacks?$/i.test(category)) {
        if (own) {
          slot.name = category;
        } else {
          const inner = split(category);
          slot.name = inner.name || category;
          slot.text = inner.text;
        }
      } else {
        const from = split(own);
        slot.name = from.name;
        slot.text = from.text;
      }
      if (drawback) slot.category = null;
    };
    for (const [key, slot] of Object.entries(d.traitSlots || {})) {
      if (key === 'additional') (slot || []).forEach((s) => name(s, 'trait'));
      else name(slot, kindOf(key));
    }
  }

  if (!d.skillBudget) d.skillBudget = { bonusPerLevel: 0, intPerLevel: 0 };

  /*
   * Typed save and AC bonuses -- the Stats tab's own breakdown, and the only
   * place a flat save or AC bonus is written down.
   *
   * The export does not carry the whole table, but the workbook names the
   * parts that matter: ABPFort/Ref/Will and ABPDef/ABPNat give the ABP
   * columns, and FortBonuses/RefBonuses/WillBonuses and ACStatsTotal give
   * what each row came to. The difference goes in `sheet`, so the row still
   * adds up to what the character sheet says while every part stays visible
   * and editable. Reconciliation does the rest: whatever these do not
   * explain stays in the stat's offset exactly as before.
   */
  const named = d.named || {};
  const zeroed = (types) => Object.fromEntries(types.map(([k]) => [k, 0]));
  for (const [key, abpName, totalName] of [
    ['fortitude', 'ABPFort', 'FortBonuses'],
    ['reflex', 'ABPRef', 'RefBonuses'],
    ['will', 'ABPWill', 'WillBonuses'],
  ]) {
    const save = d.saves?.[key];
    if (!save || save.bonuses) continue;
    const abp = Number(named[abpName]) || 0;
    save.bonuses = { ...zeroed(SAVE_BONUS_TYPES), abpResistance: abp };
    save.bonuses.sheet = (Number(named[totalName]) || 0) - abp;
  }
  if (d.defenses && !d.defenses.acBonuses) {
    const deflect = Number(named.ABPDef) || 0;
    const nat = Number(named.ABPNat) || 0;
    d.defenses.acBonuses = {
      ...zeroed(AC_BONUS_TYPES), abpDeflection: deflect, abpNatural: nat,
    };
    d.defenses.acBonuses.sheet = (Number(named.ACStatsTotal) || 0) - deflect - nat;
  }

  // Per-view preferences: hidden system tabs and collapsed panels.
  if (!d.uiPrefs) d.uiPrefs = {};
  if (!d.uiPrefs.hiddenTabs) {
    // System tabs the source workbook kept hidden start hidden here too.
    d.uiPrefs.hiddenTabs = {};
    for (const t of d.sheetTabs || []) {
      if (t.hidden) d.uiPrefs.hiddenTabs[t.name] = true;
    }
  }
  delete d.uiPrefs.hiddenTabs['Item Crafting'];   // now a panel, not a system tab
  // The tab bar: which tabs are on it, in what order. Everything not listed
  // waits in the ⚙ manager. Started from the standard eight; the player
  // rearranges, hides and shows from there.
  if (!Array.isArray(d.uiPrefs.tabOrder)) d.uiPrefs.tabOrder = [...DEFAULT_TAB_ORDER];
  // Two views of the same sheet: the build view (everything) and the session
  // view (what actually comes up at the table). Each keeps its own tab bar;
  // the session bar is seeded from what the character uses the first time
  // the view is opened, and is the player's to rearrange from there.
  if (d.uiPrefs.viewMode !== 'session') d.uiPrefs.viewMode = 'build';
  if (d.uiPrefs.sessionTabOrder !== undefined && !Array.isArray(d.uiPrefs.sessionTabOrder)) {
    delete d.uiPrefs.sessionTabOrder;
  }
  // The sub-systems a class is marked with (GAME_SYSTEMS ids). An old save
  // simply has none marked.
  for (const cls of d.classes || []) {
    if (cls && typeof cls === 'object' && !Array.isArray(cls.systems)) cls.systems = [];
  }
  // Active-effect reminders on the session dashboard: a name, a note and an
  // on/off tick. They move no numbers -- a buff that should is a buff row --
  // they just keep "watching the north door" in sight during play.
  if (!Array.isArray(d.effects)) d.effects = [];
  // Buffs: named, tickable bonuses whose dials (BUFF_MOD_KEYS) take a number
  // or a formula, and ride the condition totals so every "now" figure moves.
  if (!Array.isArray(d.buffs)) d.buffs = [];
  if (!d.uiPrefs.collapsed) d.uiPrefs.collapsed = {};
  // The Auto-Cooking ingredient list is long and a reference, so it starts folded.
  if (d.uiPrefs.collapsed['cooking-ref'] === undefined) d.uiPrefs.collapsed['cooking-ref'] = true;
  // So do the alternate attacks: three of the six rows are the same attack
  // with one ability swapped, and most characters use one of them.
  for (const k of ['melee', 'ranged', 'cmb']) {
    if (d.uiPrefs.collapsed[`atk:${k}`] === undefined) d.uiPrefs.collapsed[`atk:${k}`] = true;
  }
  // And the hit-point parts: the sum above them says what they come to, and
  // the ability is the only one most characters ever touch.
  if (d.uiPrefs.collapsed['hp:build'] === undefined) d.uiPrefs.collapsed['hp:build'] = true;

  /*
   * Hit points. `total` used to be the whole of it -- a number the workbook
   * worked out and this sheet kept -- and is now what `applyHitPoints`
   * arrives at from the class table, with `totalOverride` holding a figure
   * pinned over it. The parts the workbook summed were always imported;
   * `misc` is the last of them and older saves have no field for it.
   */
  if (!d.hp || typeof d.hp !== 'object') d.hp = {};
  for (const k of ['fcb', 'toughness', 'misc']) {
    if (d.hp[k] === undefined || d.hp[k] === null) d.hp[k] = 0;
  }
  if (d.hp.ability === undefined) d.hp.ability = null;
  if (d.hp.ability2 === undefined) d.hp.ability2 = null;
  if (!d.uiPrefs.colWidths) d.uiPrefs.colWidths = {};
  // How the built-in meters are painted. Empty on a sheet nobody has
  // restyled, and only the meters that differ from the default are in it.
  if (!d.meterStyles || typeof d.meterStyles !== 'object') d.meterStyles = {};

  // Mythic: tier auto-derives from level (override kept when the imported
  // tier disagrees, e.g. a GM-granted extra tier), tradition slots, bonus
  // HP per tier, and even-tier stat picks seeded from the Stats-tab column.
  if (!d.mythic) d.mythic = {};
  if (d.mythic.tierOverride === undefined) {
    const computed = tierAtLevel(d.identity?.level);
    const imported = Number(d.identity?.mythicTier) || 0;
    d.mythic.tierOverride = imported !== computed ? imported : null;
  }
  /*
   * Bonus HP per tier is an override over the path's own figure now that hit
   * points are worked out rather than stored, so "not set" has to be sayable
   * and null is how this file says it.
   *
   * The zero is migrated rather than honoured. It was this line's own default
   * back when the field was added on top of an imported total that already
   * counted the tiers -- so zero was the only figure that did not double the
   * bonus, and every sheet saved since carries it without anyone having
   * chosen it. A player who means zero can still say so on a path the table
   * has no row for, which is what the field is for.
   */
  if (d.mythic.bonusHpPerTier === undefined || d.mythic.bonusHpPerTier === 0) {
    d.mythic.bonusHpPerTier = null;
  }
  if (!d.mythic.tradition) d.mythic.tradition = {};
  for (const k of ['drawback1', 'drawback2', 'drawback3', 'quality', 'boon1', 'boon2', 'boon3']) {
    if (d.mythic.tradition[k] === undefined) d.mythic.tradition[k] = null;
  }
  // Each slot's note, beside its name. Under `notes` rather than alongside the
  // slots so that the seven keys above stay the whole of what a slot is.
  if (!d.mythic.tradition.notes || typeof d.mythic.tradition.notes !== 'object') {
    d.mythic.tradition.notes = {};
  }
  /*
   * The mythic ladder is ten tiers, one row each: a feat on the odd ones, a
   * path power plus the +2 ability increase on the even ones. The sheet's
   * column is already in that order, so a row's position is its tier -- kept
   * exactly ten long so every tier has somewhere to write.
   */
  if (!Array.isArray(d.mythic.abilities)) d.mythic.abilities = [];
  while (d.mythic.abilities.length < MYTHIC_TIERS.length) {
    d.mythic.abilities.push({ name: '', path: '', featChoice: '', effect: '', featEffect: '' });
  }
  // What the path ability and the feat actually do. Prose, so both read
  // {…} like any other description; a row that predates them gets the
  // fields empty rather than missing, so every tier has the same shape.
  for (const a of d.mythic.abilities) {
    a.effect ??= '';
    a.featEffect ??= '';
  }

  if (!Array.isArray(d.mythicStatPicks)) {
    const tier = Number(d.identity?.mythicTier) || 0;
    // Each even tier's row names the ability it raised. Where the sheet left
    // that blank, fall back to spreading the mythic column's own total.
    const spare = [];
    for (const ab of ABILITIES) {
      let m = Number(d.statsBuild?.[ab]?.mythic) || 0;
      while (m >= MYTHIC_STAT_BONUS) {
        spare.push(ab[0].toUpperCase() + ab.slice(1));
        m -= MYTHIC_STAT_BONUS;
      }
    }
    d.mythicStatPicks = MYTHIC_STAT_TIERS.filter((t) => t <= tier).map((t) => {
      const named = String(d.mythic.abilities[t - 1]?.statBonus || '').trim();
      if (!named) return { tier: t, ability: spare.shift() ?? null };
      const dup = spare.indexOf(named);
      if (dup >= 0) spare.splice(dup, 1);
      return { tier: t, ability: named };
    });
  }
  // The picks are where an increase lives now; the column it was read from
  // would only drift.
  for (const a of d.mythic.abilities) delete a.statBonus;

  // Progression: the Planner's raw rows become a structured level list —
  // class tracks (dropdowns) plus per-class feature groups. In the source
  // sheet, feature columns sit inside a class's column block ("Class 2 HD"
  // … "Class 3 HD"), which tells us whose features they are; texts are
  // stored under the class NAME so they survive track reshuffles.
  if (!d.progression && Array.isArray(d.planner)) {
    const CLASS_KEY = /^Class (\d+) HD$/;
    const SKIP = new Set(['Level', 'Level/4', 'HP/ Level', 'BAB', 'Skill Ranks',
      'Fort', 'Ref', 'Will', 'Mental Prowess', 'Physical Prowess',
      // ABP / technique machinery columns living beside the class blocks.
      'Armored Discipline Technique', 'Resist', 'Deflect', 'Natural',
      'Toughening', 'Attunement']);
    const isSkipped = (k) => SKIP.has(k) || k.startsWith('Array')
      || /^\d+(\.\d+)?$/.test(k);   // stray numeric block-index headers
    const colName = (k) => k
      .replace(/^Class \d+ Features$/, 'Features')
      .replace(/^Prestige Class \d+/, 'Prestige Class');

    const classKeys = [...new Set(d.planner.flatMap((r) => Object.keys(r).filter((k) => CLASS_KEY.test(k))))]
      .sort((a, b) => parseInt(a.match(/\d+/), 10) - parseInt(b.match(/\d+/), 10));
    const levels = [];
    const classFeatures = {};
    const group = (name) => {
      const key = name || 'General';
      if (!classFeatures[key]) classFeatures[key] = { columns: [], byLevel: {} };
      return classFeatures[key];
    };

    for (let lvl = 1; lvl <= 20; lvl++) {
      const row = d.planner.find((r) => Math.round(Number(r.Level)) === lvl) || {};
      const classes = classKeys.map((k) => row[k] ?? null);
      levels.push({ level: lvl, classes });

      let block = 0;
      for (const [k, v] of Object.entries(row)) {
        const m = CLASS_KEY.exec(k);
        if (m) { block = parseInt(m[1], 10); continue; }
        if (isSkipped(k) || v === null || v === undefined || v === '') continue;
        const g = group(block > 0 ? classes[block - 1] : null);
        const col = colName(k);
        if (!g.columns.includes(col)) g.columns.push(col);
        (g.byLevel[lvl] ||= {})[col] = v;
      }
    }
    d.progression = { tracks: Math.max(2, classKeys.length), levels, classFeatures };
  }

  /*
   * The Primordia Technique ladder, off the Planner's own column.
   *
   * The template calls that column "Armored Discipline Technique" on every
   * sheet whatever technique the character took -- it is the one technique
   * that fills it in as it goes -- and parks the technique's *name* on the
   * level 2 row, which is not a level the ladder grants at. Reading only the
   * granting levels therefore separates the ladder from the label on all five
   * sheets at once, and the name is already on the identity block anyway.
   *
   * The column is on the progression's SKIP list, so before this it went
   * nowhere: Bryva's seven filled-in rows were dropped with it.
   */
  if (!d.primordia) {
    const picks = {};
    const key = (d.planner || []).flatMap(Object.keys).find((k) => /\bTechnique$/i.test(k));
    if (key) {
      for (const row of d.planner) {
        const lvl = Math.round(Number(row.Level));
        const text = String(row[key] ?? '').trim();
        if (text && PRIMORDIA_LEVELS.includes(lvl)) picks[lvl] = text;
      }
    }
    d.primordia = { picks, alt: {}, notes: '' };
  }
  if (!d.primordia.picks || typeof d.primordia.picks !== 'object') d.primordia.picks = {};
  if (!d.primordia.alt || typeof d.primordia.alt !== 'object') d.primordia.alt = {};
  /*
   * The ladder's own notes, one per granting level, beside the name.
   *
   * Empty on a sheet that predates the column, and deliberately so: the pick
   * box was the only writing surface a row had, and what the workbooks put in
   * it -- "Endurance, Armor Adept" at Bryva's 1st, "Armor Trick" at her 3rd --
   * is a name, not a note. Moving that text across on load would take the
   * technique's own talents out of the column that counts them, which is
   * where `trainingSkillRanks` goes looking for them.
   */
  if (!d.primordia.rowNotes || typeof d.primordia.rowNotes !== 'object') {
    d.primordia.rowNotes = {};
  }

  delete d.planner;
  if (!d.progression) {
    d.progression = {
      tracks: 2,
      levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, classes: [] })),
      classFeatures: {},
    };
  }
  if (!d.progression.classFeatures) d.progression.classFeatures = {};
  // Column level rules arrived after the first saves; a column without them
  // grants at every level, as before. A rule started life as a bare string
  // and is now a list of named, coloured groups sharing the column, so a
  // string folds into a single unnamed group.
  for (const g of Object.values(d.progression.classFeatures)) {
    if (!g.rules || typeof g.rules !== 'object') g.rules = {};
    for (const [col, value] of Object.entries(g.rules)) {
      const list = typeof value === 'string' ? [{ rule: value }] : (Array.isArray(value) ? value : []);
      const groups = list
        .map((x, i) => ({
          name: String(x?.name ?? '').trim(),
          rule: String(x?.rule ?? '').trim(),
          color: normalizeHex(x?.color) || FEATURE_GROUP_COLORS[i % FEATURE_GROUP_COLORS.length],
          // the menu this group's cells pick from, by catalogue name
          ...(String(x?.optionsFrom ?? '').trim() ? { optionsFrom: String(x.optionsFrom).trim() } : {}),
        }))
        .filter((x) => x.name || x.rule || x.optionsFrom);
      if (groups.length) g.rules[col] = groups;
      else delete g.rules[col];
    }
    // A class's own feature text sits with the class, under its ladder.
    g.notes = (Array.isArray(g.notes) ? g.notes : []).map((n) => ({
      name: String(n?.name ?? '').trim(),
      type: TEMPLATE_TYPES.includes(n?.type) ? n.type : null,
      text: String(n?.text ?? ''),
    })).filter((n) => n.name);
    // A column may name a menu of its own, which every group in it shares --
    // or several, layered, where an archetype has joined its own to the class's.
    if (!g.optionsFrom || typeof g.optionsFrom !== 'object' || Array.isArray(g.optionsFrom)) g.optionsFrom = {};
    for (const [col, v] of Object.entries(g.optionsFrom)) {
      if (!g.columns?.includes(col)) { delete g.optionsFrom[col]; continue; }
      const list = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').trim()).filter(Boolean);
      // The empty list is kept: it is the player having said "no menu".
      g.optionsFrom[col] = list.length === 1 ? list[0] : list;
    }
  }

  // Equipment: the structured shape (gear slots, armor & shields, weapon
  // blocks). Older saves carried a flat `slots` grid and a separate simple
  // weapons list; both fold into the new shape.
  if (!d.equipment || Array.isArray(d.equipment.slots)) d.equipment = {};
  const e = d.equipment;
  if (!Array.isArray(e.gear)) e.gear = [];
  if (!Array.isArray(e.other)) e.other = [];
  /*
   * Every item takes a description. The row is fourteen narrow boxes because
   * it has to fit a page; what the item actually is goes here, and it reads
   * {…} the way the rest of the sheet's prose does.
   *
   * How many bonus and Other columns a list has is deliberately not recorded:
   * it is the longest row in it (see gearColumnCount), so the rows are their
   * own answer and there is nothing here to keep in step with them.
   */
  for (const g of [...e.gear, ...e.other]) {
    if (g && typeof g === 'object' && g.note === undefined) g.note = '';
  }
  if (!Array.isArray(e.shields)) e.shields = e.shield ? [e.shield] : [];
  delete e.shield;
  if (!e.armor) e.armor = { kind: 'Armor', name: null, acBonus: 0, maxDex: null, acp: 0, others: [], weight: 0, cost: 0 };
  if (!Array.isArray(e.weapons)) e.weapons = [];
  // Worn pieces count toward AC; extra shields start stowed.
  if (e.armor.active === undefined) e.armor.active = !!(e.armor.name || e.armor.acBonus);
  e.shields.forEach((s, i) => {
    if (s.active === undefined) s.active = i === 0 && !!(s.name || s.acBonus);
  });
  for (const w of e.weapons) {
    if (w.useUnarmedDice === undefined) {
      const sheetUnarmed = d.training?.combat?.unarmed?.sheetDice;
      w.useUnarmedDice = !!sheetUnarmed && w.dice === sheetUnarmed;
    }
    // Proficiency on the row: '' reads it (Auto), 'yes' / 'no' overrides.
    if (!['yes', 'no'].includes(w.proficiency)) w.proficiency = '';
    w.proficiencyNote = String(w.proficiencyNote ?? '');
    w.baseWeapon = String(w.baseWeapon ?? '');
  }

  // An earlier version put a class's feature text on the Template tab, which
  // is for templates. Such a group is recognised exactly -- named for a class
  // on this sheet, carrying no template link, every one of its features named
  // on that class's ladder, and the class holding no text of its own yet --
  // and moves under the class, where the rest of its progression already
  // lives. Anything less exact is a template, and stays one.
  if (Array.isArray(d.classes) && d.classes.length) {
    d.templates = d.templates.filter((tp) => {
      const cls = d.classes.find((c) => normalizeName(c.name) === normalizeName(tp.name))?.name;
      const g = cls ? d.progression.classFeatures[cls] : null;
      if (!g || tp.link || tp.approvalLink || tp.tab || g.notes?.length) return true;
      const onLadder = new Set([...(g.columns || []),
        ...Object.values(g.byLevel || {}).flatMap((row) => Object.values(row)
          .flatMap((cell) => String(typeof cell === 'string' ? cell : Object.values(cell || {}).join(', ')).split(/,\s*/)))]
        .map(normalizeName).filter(Boolean));
      const features = tp.features || [];
      if (!features.length || !features.every((f) => onLadder.has(normalizeName(f.name)))) return true;
      g.notes = features.map((f) => ({ name: f.name, type: f.type ?? null, text: f.text || '' }));
      return false;
    });
  }

  // Legacy user-added simple weapons.
  if (Array.isArray(d.weapons) && d.weapons.length) {
    for (const w of d.weapons) {
      e.weapons.push({
        name: w.name || '', attackType: w.type === 'ranged' ? 'Ranged' : w.type === 'cmb' ? 'CMB' : 'Melee',
        dice: w.damage || '', critMult: w.crit || '', special: w.notes || '',
        enhancement: 0, miscAttack: Number(w.bonus) || 0, miscDamage: 0,
        abilityMult: 1, damageAbility: null, groups: [], weight: 0, price: 0,
      });
    }
  }
  delete d.weapons;

  if (!Array.isArray(d.notes)) d.notes = [];
  if (!d.mythic) d.mythic = {};
  if (!Array.isArray(d.mythic.abilities)) d.mythic.abilities = [];
  if (!Array.isArray(d.traits)) d.traits = [];
  if (!Array.isArray(d.identity.speeds)) d.identity.speeds = [];
  for (const sp of d.identity.speeds) {
    sp.type = sp.type ?? '';
    sp.base = Number(sp.base) || 0;
    // The bonus may be a formula ("floor(level / 3) * 10" for fast
    // movement), so only a real number is coerced to one.
    if (typeof sp.bonus !== 'string') sp.bonus = Number(sp.bonus) || 0;
  }
  // Weapon and armor proficiencies: the workbook's three sentences become
  // lists (see parseProficiencyText); lists already saved are only tidied.
  d.identity.proficiencies = normalizeProficiencies(d.identity.proficiencies);

  /*
   * Race traits: what the race hands you, which the sheets keep as a column
   * of sentences and every race has a different number of.
   *
   * The workbook writes each as "Darkvision: sees in the dark for 60 feet",
   * so the name is split off where that reads as a name -- short, and not a
   * sentence of its own -- and the rest becomes the effect. Anything that
   * does not split stays whole as the effect, which is what a race trait
   * written as prose should do.
   */
  if (!Array.isArray(d.raceTraits)) d.raceTraits = [];
  d.raceTraits = d.raceTraits.map((t) => {
    // A row that is already an object is the app's own -- an empty one is a
    // slot still to fill (a blank character starts with three), and stays.
    if (t && typeof t === 'object') {
      const row = { name: String(t.name ?? '').trim(), text: String(t.text ?? '').trim() };
      // An alternate racial trait added from an extension remembers the
      // standard traits it displaced, so a later alternate that overlaps
      // it can put back the ones it does not itself replace.
      if (Array.isArray(t.replaced) && t.replaced.length) {
        row.replaced = t.replaced
          .filter((r) => r && typeof r === 'object')
          .map((r) => ({ name: String(r.name ?? '').trim(), text: String(r.text ?? '').trim() }))
          .filter((r) => r.name);
        if (!row.replaced.length) delete row.replaced;
      }
      return row;
    }
    const raw = String(t ?? '').trim();
    if (!raw) return null;
    const at = raw.indexOf(':');
    if (at > 0 && at <= 48 && !/[.!?]/.test(raw.slice(0, at))) {
      return { name: raw.slice(0, at).trim(), text: raw.slice(at + 1).trim() };
    }
    return { name: '', text: raw };
  }).filter(Boolean);

  /*
   * Specialty: the background the character came from, its feat and its
   * perks. The workbook has room for two perks; here it is a list.
   */
  if (!Array.isArray(d.identity.specialtyPerks)) d.identity.specialtyPerks = [];
  d.identity.specialtyPerks = d.identity.specialtyPerks
    .map((p) => (p && typeof p === 'object' ? String(p.text ?? p.name ?? '') : String(p ?? '')));
  if (d.grantedFeats && !String(d.grantedFeats.specialty?.name || '').trim()) {
    // The importer's own guess at the specialty feat, when the Drawbacks
    // column did not name one -- unless it is the template's placeholder.
    const guess = String(d.identity.specialtyFeat || '').trim();
    if (guess && !/^specialty feat$/i.test(guess)) {
      d.grantedFeats.specialty = { ...(d.grantedFeats.specialty || {}), name: guess };
    }
  }

  /*
   * Languages: one list, seeded from the workbook's three cells (native,
   * bonus for Int, from Linguistics). Those cells were free text with any
   * separator the player felt like -- commas, pipes, "+9 languages" -- so
   * they are split on the separators and whatever does not read as a name
   * is kept as a row anyway; the player tidies it once. Slots are computed
   * from Int and Linguistics ranks, plus a formula for anything else.
   */
  if (!Array.isArray(d.identity.languages)) {
    const split = (s) => String(s || '').split(/[,;|]+|\n/).map((x) => x.trim()).filter(Boolean);
    const seen = new Set();
    const langs = [];
    for (const cell of [d.identity.intLanguages, d.identity.downtimeLanguages, d.identity.linguisticsLanguages]) {
      for (const l of split(cell)) {
        const key = l.toLowerCase();
        if (!seen.has(key)) { seen.add(key); langs.push(l); }
      }
    }
    d.identity.languages = langs;
  }
  d.identity.languages = d.identity.languages.map((l) => (l && typeof l === 'object' ? String(l.name ?? '') : String(l ?? '')));
  if (d.identity.nativeLanguages === undefined) d.identity.nativeLanguages = null;
  if (d.identity.languageExtra === undefined) d.identity.languageExtra = 0;

  // A workbook with nowhere to put its customized weapons put them where it
  // could. Bryva's has an "Armiger customization" block sitting among her
  // casting classes -- no casting type, no talent rate, not one talent on
  // its twenty rows -- and the weapons themselves on a spare corner of the
  // Item Crafting tab, headed Weapon. Read as written it is a caster who
  // never cast anything, and it turns up in every list of her classes.
  //
  // It is not one. It is the name of a talent track, so it becomes one: the
  // empty block goes and the class it names gets a track of its own, waiting
  // for the two counting rules its pack states.
  //
  // Only an entirely empty block is read this way -- anything typed into it
  // is somebody's data. Hers sits on the extended-level page and so has no
  // level rows at all, which an extended block never does; empty is empty
  // either way.
  const emptyTrainingClass = (cls) => !cls.type && !cls.talentsPerLevel && !cls.mod1 && !cls.mod2
    && !cls.blended && cls.classLevelsOverride == null
    && (cls.levels || []).every((lv) => !lv.talent && !lv.sphere && !lv.notes);
  if (d.training?.combat) {
    const combat = d.training.combat;
    if (!Array.isArray(combat.customizations)) combat.customizations = [];
    for (const sideKey of ['combat', 'magic']) {
      const side = d.training[sideKey];
      if (!Array.isArray(side?.classes)) continue;
      for (let i = side.classes.length - 1; i >= 0; i--) {
        const cls = side.classes[i];
        const named = /^(.*?)\s+customi[sz]ations?$/i.exec(String(cls?.name || '').trim());
        if (!named || !emptyTrainingClass(cls)) continue;
        const owner = named[1].trim();
        side.classes.splice(i, 1);
        if (combat.customizations.some((b) => normalizeName(b.className) === normalizeName(owner))) continue;
        combat.customizations.push({ className: owner, active: 0, sets: [], spec: null });
      }
    }
  }

  // Conditions. A character with none at all gets the standard list to tick;
  // an imported one keeps the workbook's own labels ("Fatigue", "Grapple")
  // because those are what its named ranges and its export use. Values are
  // kept numeric: all but negative levels are 0 or 1.
  if (!d.conditions || typeof d.conditions !== 'object') d.conditions = {};
  if (!Object.keys(d.conditions).length) {
    for (const key of SHEET_CONDITIONS) {
      d.conditions[CONDITIONS.find((x) => x.key === key).label] = 0;
    }
  }
  for (const [name, value] of Object.entries(d.conditions)) {
    d.conditions[name] = value === true ? 1 : Number(value) || 0;
  }
  // The shared template ships with Helpless and Paralyzed set to 1 and
  // nothing else, in every workbook -- nobody is paralysed at rest, and the
  // sheets' own totals do not reflect it. That exact fingerprint is the
  // template's, so it is cleared; anything else ticked is the player's.
  const on = Object.entries(d.conditions).filter(([, v]) => v).map(([k]) => conditionInfo(k)?.key).sort();
  if (on.length === 2 && on[0] === 'helpless' && on[1] === 'paralyzed') {
    for (const name of Object.keys(d.conditions)) d.conditions[name] = 0;
  }
}

export function toDocument(model) {
  // Sheet-seeded trackers save only what the player changed against the
  // sheet's own block: the spent count, any edited field, the style, and a
  // marker for the ones they deleted. `resources` stays as imported, so a
  // Reset really does go back to the sheet.
  const live = new Map(model.trackers.filter((t) => t.source === 'sheet').map((t) => [t.id, t]));
  const sheetTrackerState = seedTrackers(model).map((seed) => {
    const t = live.get(seed.id);
    if (!t) return { id: seed.id, deleted: true };
    const state = { id: t.id, current: Number(t.current) || 0 };
    for (const key of SHEET_TRACKER_OVERRIDES) {
      if ((t[key] ?? null) !== (seed[key] ?? null)) state[key] = t[key];
    }
    // Styles are compared against the seed's, not against "no style", so that
    // clearing a seeded default (Mythic Power drains) is saved as an explicit
    // null rather than read back as "unset" and re-defaulted on load.
    const sameStyle = JSON.stringify(t.style ?? null) === JSON.stringify(seed.style ?? null);
    if (!sameStyle) state.style = t.style ?? null;
    return state;
  });

  return {
    ...model.data,
    // resolvedZones is derived every recompute; the zone formulas themselves
    // live in style.zones.
    customTrackers: model.trackers
      .filter((t) => t.source === 'player')
      .map(({ resolvedZones, edited, ...t }) => t),
    sheetTrackerState,
    akashic: stripDerived(model.data.akashic, AKASHIC_DERIVED),
    maneuvers: stripDerived(model.data.maneuvers, MANEUVER_DERIVED),
    vancian: stripDerived(model.data.vancian, VANCIAN_DERIVED),
    psionics: stripDerived(model.data.psionics, PSIONIC_DERIVED),
    primordia: stripDerived(model.data.primordia, PRIMORDIA_DERIVED),
    cardcasting: stripDerived(model.data.cardcasting, CARDCASTING_DERIVED),
    familiar: stripDerived(model.data.familiar, COMPANION_DERIVED),
    animalCompanion: stripDerived(model.data.animalCompanion, COMPANION_DERIVED),
    eidolon: stripDerived(model.data.eidolon, COMPANION_DERIVED),
  };
}
