/**
 * model.js -- the live character model.
 *
 * Responsibilities:
 *   1. Hold the imported character data.
 *   2. Recompute derived stats whenever an input changes.
 *   3. Expose a flat, read-only scope that player-authored formulas evaluate
 *      against (see trackers.js).
 *
 * ## Reconciliation
 *
 * The source spreadsheets compute many totals through Google-only formulas
 * (ARRAYFORMULA/FILTER) that do not survive an .xlsx export, and through gear
 * and Automatic Bonus Progression tables spread over several tabs. Rather than
 * guess at those, the model computes each derived stat from the parts it can
 * see and stores the difference against the sheet's own value as an `offset`.
 *
 * offset = sheetValue - computedFromVisibleParts
 *
 * So on import every number matches the Google Sheet exactly, and when you
 * raise Con by 2 the Fortitude save still moves by exactly +1. The offset is
 * visible and editable in the UI, which keeps the "where did this number come
 * from" question answerable instead of hidden in a formula.
 */

import {
  ABILITIES, DERIVED, abilityMod, carryTiers, iterativeAttacks, skillTotal,
  statMod, statModDelta, sizeMod, SIZE_MODIFIERS, SIZE_CARRY_MULTIPLIER, POINT_BUY_COST, BUILD_DERIVED_KEYS,
  CONDITIONS, SHEET_CONDITIONS, conditionInfo, conditionCount, conditionTotals,
  foldPicks, resolveAbility, pointBuyCost, ATTUNEMENT_BONUS, ATTUNEMENT_MIN_LEVEL,
  abpFollowers, abpSourceLevel, armorParts, fmt,
  parseDiceExpr, addDice, diceString, diceAverage,
  TALENT_RATES, TYPE_RATES, TYPE_TO_TALENTS, TALENTS_TO_TYPE,
  SPHERE_SKILL_RANKS, RANKS_PER_TALENT, BACKGROUND_SKILLS,
  sphereSkillRequirement, sphereSkillSpheres, sphereSkillLabel,
  SAVE_BONUS_TYPES, AC_BONUS_TYPES, abpDefence,
  cleanSkillVariant, skillLabel, skillVariantKind, performCategory,
  spBoonPoints, boonStep, sphereSide, drawbackWeight, unarmedDice, UNARMED_SPHERES,
  TALENTED_KNUCKLE_TALENTS, BRAWLERS_VEST_TALENTS, ASURA_TALENTS_PER_ESSENCE, ASURA_VEIL,
  UNORTHODOX_FEAT, UNORTHODOX_SPHERES_PER_FEAT,
  TRAIT_SLOTS, gestaltSaveBase,
  WEAPON_GROUPS, WEAPON_HANDEDNESS, WEAPON_FAMILIARITY, ARMOR_PROFICIENCIES, SHIELD_PROFICIENCIES,
  parseLevelRule, levelRuleGrants, parseGroupText,
  tierAtLevel, MYTHIC_STAT_TIERS, MYTHIC_STAT_BONUS, MYTHIC_TIERS,
  CRAFT_BASE_COSTS, CRAFT_BASE_SPEED, CRAFT_SPEED_MULTIPLIER, CRAFT_DC_PER_BYPASS,
  craftingFraction, craftingSpeed,
  ESSENCE_SOURCES, KHESHIG_VEILS, SPELL_LEVELS, veilDC, essenceInvested, spellDC,
  tempEssence, tempEssenceCost,
  PREP_STYLE_KEYS, CASTING_SOURCE_KEYS, prepStyle, castingNoun,
  bonusSpellSlots, castableAt, statScore,
  PRIMORDIA_LEVELS, PRIMORDIA_REPEAT_FROM, primordiaTechnique, primordiaGrantsAt, grantCount,
  GAME_SYSTEMS, BUFF_MOD_KEYS,
} from './rules.js';
import {
  COMPANION_KINDS, COMPANION_TABS, defaultCompanion, normalizeCompanion, computeCompanion,
  companionScope, companionInUse,
} from './companions.js';
import { evaluateFormula, analyse, resolvePath } from './formula.js';
import {
  collectDefinitions, collectUses, resolveDefinitions, renderTokens, hasTokens,
} from './inline.js';
import {
  normalizeStyle, resolveZones, isDefaultStyle, normalizeHex, FEATURE_GROUP_COLORS, zoneAt,
  METERS, meterDefaultStyle, isDefaultMeterStyle, dyingFraction,
} from './tracker-style.js';

const slug = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'x';

/** How the specialty picks name a skill: its skill and its variant together. */
const skillKey = (s) => `${s.name}|${s.spec || ''}`;

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

const PROFICIENCY_LISTS = {
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
 * Mythic Power is the one tracker every character carries -- granted at tier 1
 * (level 8) and worth 3 + 2 per tier, which is exactly what all five source
 * sheets record. It is created when missing and refuses to be deleted; every
 * other tracker, sheet-seeded or not, is the player's to rename, retype or
 * remove.
 */
export const MYTHIC_POWER_ID = 'mythic_power';
export const MYTHIC_POWER_FORMULA = 'if(mythic.tier = 0, 0, 3 + mythic.tier * 2)';
const mythicPowerAt = (tier) => (tier > 0 ? 3 + tier * 2 : 0);
// It reads as a pool you draw down over an adventuring day, so it starts full
// and drains. Fresh objects per call: styles are mutated in place by the editor.
const mythicPowerStyle = () => normalizeStyle({ fill: 'remaining' });

/**
 * The numbers a tracker knows about itself.
 *
 * These are exactly what `tracker.<id>.*` publishes character-wide and what
 * `self.*` publishes inside that tracker's own note and zone bounds -- one
 * definition, so the two can never drift apart.
 *
 * `pct` is the position on the track, so a plain 0..max pool reads as "how
 * full" and a two-sided meter reads as "where on the swing". `spent` counts up
 * from the floor, which for the usual min of 0 is just `current`.
 */
export function trackerFacts(t) {
  const current = Number(t?.current) || 0;
  const max = Number(t?.max) || 0;
  const min = Number(t?.min) || 0;
  const span = max - min;
  return {
    current,
    max,
    min,
    remaining: max - current,
    spent: current - min,
    pct: span > 0 ? ((current - min) / span) * 100 : 0,
  };
}

/** Fields of a sheet-seeded tracker a player may change; saved when they differ. */
const SHEET_TRACKER_OVERRIDES = ['name', 'maxFormula', 'minFormula', 'refresh', 'note'];

function getPath(obj, path) {
  return String(path).split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);
}

function setPath(obj, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  const target = keys.reduce((a, k) => {
    if (a[k] == null || typeof a[k] !== 'object') a[k] = {};
    return a[k];
  }, obj);
  target[last] = value;
}

/* ------------------------------------------------------------------ *
 * Item Crafting: from the sheet's grid to a structured block.
 * ------------------------------------------------------------------ */

/** Labels whose value we keep, read from the cell immediately to their right. */
const CRAFT_LABELS = {
  'Base Crafting %': 'basePercent',
  Item: 'itemName',
  Value: 'itemValue',
  '% Discount': 'discount',
  'Zero Profit': 'zeroProfit',
  'Item DC': 'itemDC',
  'DC Notes': 'dcNotes',
  'Bypassed Reqs.': 'bypassText',
  'Resources Used': 'resources',
  'Buyer (Character)': 'buyerName',
  'Buyer (Player#WXYZ)': 'buyerTag',
  'Mana Remaining': 'remaining',
  Notes: 'notes',
  'Character Name': 'sellerName',
};

/** Labels the sheet computed and this tab now recomputes, so they are dropped. */
const CRAFT_DERIVED_LABELS = ['Final Crafting Cost', 'Gross Profit', 'Net Profit (w/ Discount)',
  'Final Sale', 'Crafting DC', 'Check Result', 'Compounding % CR', 'Final Value:Craft Ratio'];

const CRAFT_POST_LABELS = ['Crafting Post', 'Marketplace Post'];

/**
 * CEILING() with the spreadsheet's tolerance for float drift.
 *
 * 200000 x 0.5 x 0.9 lands on 90000.000000000015 in binary floating point,
 * which a plain Math.ceil would round up to 90001 -- a price a penny over the
 * one the workbook shows.
 */
const ceilExact = (n) => {
  const v = Number(n) || 0;
  return Math.ceil(Number(v.toPrecision(12)));
};

/**
 * Split a DC note into the adjustments it describes.
 *
 * The sheet could not add these up, so players wrote them as reminders next
 * to a base DC ("+5 Rush", "Rush +5, +2 exotic"). Each recognised piece
 * becomes a real adjustment that moves the total; anything unparsed stays as
 * free text.
 */
function parseDcNotes(text) {
  const adjustments = [];
  const rest = [];
  for (const part of String(text ?? '').split(/[,;\n]+/)) {
    const piece = part.trim();
    if (!piece) continue;
    const lead = piece.match(/^([+-]\s*\d+)\s*(.*)$/);
    const trail = piece.match(/^(.*?)\s*([+-]\s*\d+)$/);
    const hit = lead || trail;
    if (!hit) { rest.push(piece); continue; }
    const [value, label] = lead ? [hit[1], hit[2]] : [hit[2], hit[1]];
    adjustments.push({
      label: label.trim() || 'DC adjustment',
      value: Number(value.replace(/\s+/g, '')),
      enabled: true,
    });
  }
  return { adjustments, rest: rest.join(', ') };
}

/**
 * Read the workbook's Item Crafting tab into the structured block this tab
 * now edits.
 *
 * Everything is found by label rather than by cell address: Bryva's copy has
 * her speed increases as named toggles and her buyer block nine rows further
 * down than the other four, and both layouts fall out of the same scan. Cells
 * no label claims -- her Armiger/veil block in M2:S9 -- are kept verbatim in
 * `sourceExtras` so nothing from the workbook is silently dropped.
 */
function importCrafting(tab, identity = {}) {
  const rows = (tab?.rows || []).map((r) => [...(r.cells || [])]);
  const used = new Set();
  const mark = (ri, ci) => used.add(`${ri}:${ci}`);
  const at = (ri, ci) => (rows[ri] ? rows[ri][ci] ?? null : null);
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  /** A cell carrying an amount: numbers as numbers, anything else verbatim. */
  const amount = (raw) => {
    if (text(raw) === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : text(raw);
  };

  const find = (label) => {
    for (let ri = 0; ri < rows.length; ri++) {
      const ci = rows[ri].findIndex((v) => typeof v === 'string' && v.trim() === label);
      if (ci >= 0) return [ri, ci];
    }
    return null;
  };
  /** Consume a label, the value beside it, and any derived cells after that. */
  const take = (label, derived = 0) => {
    const hit = find(label);
    if (!hit) return null;
    for (let n = 0; n <= derived + 1; n++) mark(hit[0], hit[1] + n);
    return at(hit[0], hit[1] + 1);
  };

  const found = {};
  for (const [label, key] of Object.entries(CRAFT_LABELS)) {
    // Base Crafting % keeps its fraction (the sheet's G2) in the next cell over.
    found[key] = take(label, label === 'Base Crafting %' ? 1 : 0);
  }
  for (const label of CRAFT_DERIVED_LABELS) take(label);
  for (const label of CRAFT_POST_LABELS) {
    const hit = find(label);
    if (!hit) continue;
    mark(hit[0], hit[1]);
    mark(hit[0] + 1, hit[1]);   // the generated post text sits on the next row
  }

  // The bypassed-requirement count sits one row above its notes. Its own label
  // ("# of Bypassed Reqs.") starts with a #, which the converter strips as a
  // spreadsheet error marker, so it is located from the row below instead.
  let bypassCount = 0;
  const bypassAt = find('Bypassed Reqs.');
  if (bypassAt) {
    const above = at(bypassAt[0] - 1, bypassAt[1] + 1);
    if (Number.isFinite(Number(above)) && text(above) !== '') {
      bypassCount = Math.max(0, Math.trunc(Number(above)));
      mark(bypassAt[0] - 1, bypassAt[1] + 1);
    }
  }

  // Speed increases: the rows under "Crafting Speed/day", in its own column.
  // A numeric entry is a flat bonus to progress per day; a ticked box is one
  // of Bryva's named crafting bonuses, each worth x2.
  const speedIncreases = [];
  const speedAt = find('Crafting Speed/day');
  if (speedAt) {
    const [top, col] = speedAt;
    mark(top, col);
    mark(top, col + 1);
    for (let ri = top + 1; ri < rows.length; ri++) {
      const label = text(at(ri, col));
      if (CRAFT_POST_LABELS.includes(label)) break;
      if (!label) continue;
      const raw = at(ri, col + 1);
      mark(ri, col);
      mark(ri, col + 1);
      if (typeof raw === 'boolean') {
        speedIncreases.push({
          label, kind: 'multiplier', value: CRAFT_SPEED_MULTIPLIER, enabled: raw,
        });
      } else if (amount(raw) !== null) {
        speedIncreases.push({
          // "Speed Increase" is the template's placeholder, not a name.
          label: label === 'Speed Increase' ? '' : label,
          kind: 'flat',
          value: amount(raw),
          enabled: true,
        });
      }
    }
  }

  // Cost reductions: every "% Cost Reduction" row. The sheet had no room for
  // names, so imported ones start unnamed.
  const costReductions = [];
  rows.forEach((cells, ri) => cells.forEach((cell, ci) => {
    if (text(cell) !== '% Cost Reduction') return;
    mark(ri, ci);
    mark(ri, ci + 1);
    const pct = amount(at(ri, ci + 1));
    if (pct !== null && pct !== 0) costReductions.push({ label: '', value: pct, enabled: true });
  }));

  // A percentage the sheet formatted as a percent comes through as a fraction.
  const asPercent = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n) || text(v) === '') return fallback;
    return n > 0 && n <= 1 ? n * 100 : n;
  };

  const basePercent = asPercent(found.basePercent, CRAFT_BASE_COSTS[0].percent);
  const baseCosts = CRAFT_BASE_COSTS.map((b) => ({ ...b }));
  if (!baseCosts.some((b) => b.percent === basePercent)) {
    baseCosts.push({ label: 'From the sheet', percent: basePercent });
  }

  const notes = parseDcNotes(found.dcNotes);
  const bypassed = String(found.bypassText ?? '').split(/[,;\n]+/)
    .map((s) => s.trim()).filter(Boolean)
    .map((label) => ({ label, enabled: true }));
  while (bypassed.length < bypassCount) bypassed.push({ label: '', enabled: true });

  const sourceExtras = [];
  rows.forEach((cells, ri) => {
    const kept = cells.map((cell, ci) => (used.has(`${ri}:${ci}`) ? null : cell));
    while (kept.length && kept[kept.length - 1] === null) kept.pop();
    if (kept.some((v) => v !== null && v !== undefined && v !== '')) sourceExtras.push({ cells: kept });
  });
  // Drop the columns every leftover row shares as empty, so the block keeps its
  // own alignment instead of trailing a dozen blank cells from the sheet.
  const lead = Math.min(...sourceExtras.map(({ cells }) => cells.findIndex((v) => v !== null)), Infinity);
  if (Number.isFinite(lead) && lead > 0) for (const row of sourceExtras) row.cells = row.cells.slice(lead);

  const project = {
    name: text(found.itemName),
    value: Number(found.itemValue) || 0,
    discountOverride: null,
    zeroProfit: found.zeroProfit === true,
    itemDC: Number(found.itemDC) || 0,
    checkMod: 0,
    dcAdjustments: notes.adjustments,
    bypassed,
    dcNotes: notes.rest,
    resources: text(found.resources),
    notes: text(found.notes),
    buyerName: text(found.buyerName),
    buyerTag: text(found.buyerTag),
    remaining: text(found.remaining),
  };

  return {
    baseSpeed: CRAFT_BASE_SPEED,
    speedIncreases,
    baseCosts,
    baseCostIndex: Math.max(0, baseCosts.findIndex((b) => b.percent === basePercent)),
    costReductions,
    discount: asPercent(found.discount, 0),
    dcPerBypass: CRAFT_DC_PER_BYPASS,
    timeBasis: 'value',
    checkMode: 'take10',
    checkSkill: null,
    checkMisc: 0,
    checkRoll: 0,
    currency: 'mana',
    sellerName: text(found.sellerName) || text(identity.name),
    // Everything the sheet held that no label claimed -- Bryva's Armiger
    // customisation block. Kept, shown, but not modelled.
    sourceExtras,
    projects: [project],
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
function sheetReader(tab) {
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

/** The sheet leaves an unreadable glyph where its dashes were. */
const isPlaceholder = (v) => v === null || v === undefined
  || String(v).trim() === '' || /^[�–—-]+$/.test(String(v).trim());

/* ------------------------------------------------------------------ *
 * The shared discipline catalogue.
 *
 * Knowing a discipline grants every maneuver in it, so a character records
 * which disciplines they know and which maneuvers they have readied -- not a
 * copy of the discipline's contents. The names and types come from
 * the Path of War disciplines extension pack (`data/extensions/path-of-war-disciplines.json`), built from the workbook's own maneuversRef tab by
 * tools/maneuvers_ref.py; it is identical in every workbook, so one shared
 * file replaces up to 20 KB of catalogue per character.
 *
 * Registered once at startup and read synchronously afterwards. With no
 * catalogue loaded a character still opens: its disciplines list what it
 * knows, they simply have no maneuvers to offer.
 * ------------------------------------------------------------------ */

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

const normalizeName = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Edit distance, abandoned once it cannot come in under `limit`.
 *
 * Swapping two neighbours counts as one slip rather than two, because that is
 * what typing "Oracel" for "Oracle" actually is -- and a plain edit distance
 * charges two for it, which puts the commonest typo of all out of reach of a
 * one-slip allowance.
 */
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, before[j - 2] + 1);
      }
      row[j] = d;
      if (d < best) best = d;
    }
    if (best > limit) return limit + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The candidate `name` most likely meant, or '' for none.
 *
 * Returns the candidate as spelled in the list, so the caller gets the
 * canonical form back and can show what it corrected to.
 */
export function closestName(name, candidates) {
  const want = normalizeName(name);
  if (!want) return '';
  const list = [...new Set(candidates.map((c) => String(c ?? '')).filter(Boolean))];
  const exact = list.find((c) => normalizeName(c) === want);
  if (exact) return exact;

  const limit = want.length >= 12 ? 2 : 1;
  let best = limit + 1;
  let winner = '';
  let tied = false;
  for (const c of list) {
    const d = editDistance(want, normalizeName(c), limit);
    if (d > limit) continue;
    if (d < best) { best = d; winner = c; tied = false; } else if (d === best) tied = true;
  }
  return tied ? '' : winner;
}

/* ------------------------------------------------------------------ *
 * The shared casting table.
 *
 * A casting block records which class's table it draws from, not a copy of the
 * table: 34 classes of slots per day and spells known, for class levels 1-20
 * across spell levels 0-9, live in the casting-tables extension pack (`data/extensions/vancian-casting-tables.json`), built from the
 * workbook's own vancianRef tab by tools/vancian_ref.py.
 *
 * The workbook reached those same numbers through a named range that was never
 * widened when classes were appended to the tab, so its last two -- Legendary
 * Sorceror and Pale Theologian -- had full tables that nothing could read. All
 * 34 are here.
 * ------------------------------------------------------------------ */

let VANCIAN_TABLES = { classes: [] };

/** Register the shared casting table. Call before constructing a Character. */
export function setVancianTables(doc) {
  const list = Array.isArray(doc?.classes) ? doc.classes : [];
  const grid = (rows) => (Array.isArray(rows) ? rows.map((r) => (Array.isArray(r) ? [...r] : [])) : null);
  VANCIAN_TABLES = {
    classes: list.map((c) => ({
      name: String(c.name || ''),
      perDay: grid(c.perDay),
      known: grid(c.known),
      bonus: grid(c.bonus),
    })),
  };
}

export function vancianTables() {
  return VANCIAN_TABLES;
}

/** Every class name the shared table can supply, for pickers and matching. */
export function castingTableNames() {
  return VANCIAN_TABLES.classes.map((c) => c.name);
}

/**
 * One class's tables, by the name a block's slot type gives -- forgiving a
 * typo, since nothing downstream can recover from picking the wrong row.
 */
export function castingTable(name) {
  const match = closestName(name, castingTableNames());
  if (!match) return null;
  return VANCIAN_TABLES.classes.find((c) => c.name === match) || null;
}

/* ------------------------------------------------------------------ *
 * The shared power-point table.
 *
 * Five curves of power points per manifester level, from the manifesting-tables extension pack (`data/extensions/psionic-manifesting-tables.json`)
 * (tools/psionic_ref.py). A manifesting class does not name a row here: it names
 * the **total it reaches at level 20**, which is what the workbook's PP@20
 * dropdown offered and what its HLOOKUP searched for. The thirteen class names
 * come along as a crib for choosing, and nothing keys off them -- which is why a
 * homebrew manifesting class needs no special handling at all. It was never a
 * class lookup.
 * ------------------------------------------------------------------ */

let PSIONIC_TABLES = { powerLevels: [], curves: [], classes: [] };

/** Register the shared power-point table. Call before constructing a Character. */
export function setPsionicTables(doc) {
  const curves = Array.isArray(doc?.curves) ? doc.curves : [];
  PSIONIC_TABLES = {
    powerLevels: (Array.isArray(doc?.powerLevels) ? doc.powerLevels : []).map((s) => String(s)),
    curves: curves.map((c) => ({
      total: Number(c.total) || 0,
      points: (Array.isArray(c.points) ? c.points : []).map((p) => (p === null ? null : Number(p))),
    })),
    classes: (Array.isArray(doc?.classes) ? doc.classes : []).map((c) => ({
      name: String(c.name || ''),
      total: Number(c.total) || 0,
    })),
  };
}

export function psionicTables() {
  return PSIONIC_TABLES;
}

/** Every level-20 total a block can pick from, which is the curve's own name. */
export function psionicCurveTotals() {
  return PSIONIC_TABLES.curves.map((c) => c.total);
}

/** The curve reaching `total` at level 20. */
export function psionicCurve(total) {
  const want = Number(total);
  if (!Number.isFinite(want)) return null;
  return PSIONIC_TABLES.curves.find((c) => c.total === want) || null;
}

/**
 * Power points a curve grants at a manifester level, before ability bonuses.
 * Null where the class cannot manifest at that level yet.
 */
export function psionicPoints(total, level) {
  const curve = psionicCurve(total);
  const lvl = Math.floor(Number(level) || 0);
  if (!curve || lvl < 1 || lvl > curve.points.length) return null;
  return curve.points[lvl - 1];
}

/** The level-20 total a named manifesting class uses, or 0 for an unknown one. */
export function psionicClassTotal(name) {
  const match = closestName(name, PSIONIC_TABLES.classes.map((c) => c.name));
  if (!match) return 0;
  return PSIONIC_TABLES.classes.find((c) => c.name === match)?.total || 0;
}

/* ------------------------------------------------------------------ *
 * What each modelled sub-system recomputes, and therefore never saves.
 *
 * These were the cells that made the workbook's tabs so heavy: a save DC
 * beside every veil, a count beside every discipline, a DC beside every
 * spell level, all of them restated from numbers already on the sheet.
 * Recomputing them on load costs nothing and keeps a saved document to
 * what the player actually chose.
 *
 * `path` addresses a list inside the block; `keys` are dropped from each
 * of its entries. A bare string drops that key from the block itself.
 * ------------------------------------------------------------------ */

const AKASHIC_DERIVED = [
  'calc',
  { path: 'classes', keys: ['totalCap'] },
  { path: 'slots', list: 'veils', keys: ['dc'] },
  { path: 'kheshig', list: 'veils', keys: ['dc'] },
];

const MANEUVER_DERIVED = [
  'calc',
  // `entries` is the discipline's whole catalogue, rebuilt from the shared
  // file on every recompute. Saving it would put back the 206 rows this was
  // meant to get rid of.
  { path: 'disciplines', keys: ['knownManeuvers', 'knownStances', 'entries', 'inCatalogue'] },
];

const VANCIAN_DERIVED = [
  'calc',
  // Caster level, slots per day, spells known and the save DC all come from the
  // shared casting table and the Planner now, so none of them is saved -- which
  // is what the tab's columns of cached formula results were. What survives is
  // what a player chose: `perDay`, `known` and `casterLevelOverride` pin a value,
  // and `used` records what has been spent today.
  {
    path: 'classes',
    keys: ['statMod', 'statScore', 'plannerLevel', 'casterLevel', 'tableName',
      'slotTypeUnknown', 'noun', 'totalPerDay', 'totalKnown', 'totalLeft', 'highestLevel'],
  },
  {
    // `used` is play state and stays; `left` is the subtraction and does not.
    path: 'classes',
    list: 'spells',
    keys: ['dc', 'base', 'classBonus', 'abilityBonus', 'atWill', 'slots', 'knownCount', 'left'],
  },
  { path: 'prepared', keys: ['left'] },
];

const PSIONIC_DERIVED = [
  'calc',
  // The whole Power Points panel was formulas; only the bonus line was typed.
  'pool', 'left',
  {
    path: 'classes',
    keys: ['plannerLevel', 'manifesterLevel', 'curveKnown', 'basePoints',
      'abilityPoints', 'points', 'powerCount'],
  },
];

// The technique ladder is the rules table plus what the player wrote on it,
// so only the writing is saved.
const PRIMORDIA_DERIVED = ['calc'];

// The deck: every tally, check and draw range is worked out from the cards.
const CARDCASTING_DERIVED = [
  'calc',
  { path: 'cards', keys: ['calc'] },
  { path: 'sideboard', keys: ['calc'] },
  { path: 'manipulations', keys: ['calc'] },
  // The table's zones are play state and stay; its counts do not.
  { obj: 'table', keys: ['calc'] },
];

// A companion: the level, HD, hit points, attack, saves, AC and every skill
// and attack total come from the tables and the master, so only what was
// typed -- scores, ranks, the attacks' names and damage -- is saved.
const COMPANION_DERIVED = [
  'calc',
  { path: 'skills', keys: ['masterRanks', 'effectiveRanks', 'abilityMod', 'total'] },
  { path: 'attacks', keys: ['damageType', 'primaryResolved', 'toHit'] },
];

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
 * Split a veil's cell into its name and what it does.
 *
 * The workbook had one cell per veil, so players wrote the effect into it in
 * brackets -- "Citadel Banner (20-foot radius, +4 Atk/AC)". The bracketed part
 * is a description, and belongs in a field that can hold a paragraph and
 * resolve `{…}` formulas, rather than in the name. Inner brackets are part of
 * the description: only the outermost pair is the split.
 */
function splitVeilName(raw) {
  const text = String(raw ?? '').trim();
  const open = text.indexOf('(');
  if (open <= 0) return { name: text, desc: '' };
  const name = text.slice(0, open).trim();
  let desc = text.slice(open + 1).trim();
  if (desc.endsWith(')')) desc = desc.slice(0, -1).trim();
  return { name, desc };
}

/**
 * Read the workbook's Akashic tab into the veil board this tab now edits.
 *
 * Every shaped veil's save DC on the sheet was exactly the veilweaver's base
 * DC plus the essence invested in it, checked across every character, so only
 * the essence is kept and the DC is recomputed. That is roughly forty cells a
 * sheet that no longer have to round-trip.
 *
 * Slots are found by their "<name> Veil" header rather than by address: the
 * template lays them out down two columns at a one-row offset, a sheet may
 * carry an extra slot, and the same scan reads either.
 */
function importAkashic(tab) {
  const g = sheetReader(tab);
  const { at, text, num, mark, rightOf } = g;

  // ---- veilweaving classes ----
  // Class 1 carries the shared numbers (level, essence cap, the DCs); the
  // other five blocks are a mod and a bonus cap each.
  const classes = [];
  for (const [ri, ci, m] of g.scan(/^Veilweaving Class(?: (\d+))?$/)) {
    const index = Number(m[1] || 1);
    const stop = ri + 8;
    const block = { index, name: text(rightOf(ri, ci)) };
    for (let r = ri + 1; r < Math.min(stop, g.rows.length); r++) {
      const label = text(at(r, ci));
      if (/^Veilweaving Class/.test(label)) break;
      // How far past its label a value may sit. The short labels put it in the
      // next cell and nowhere else -- an empty class block would otherwise
      // reach across and read the neighbouring "Essence" column heading as its
      // ability. The two DC labels are merged across two columns, so theirs is
      // genuinely further out.
      const KEYS = {
        Mod: ['mod', 1],
        'Essence Cap': ['essenceCap', 1],
        'Bonus Cap': ['bonusCap', 1],
        'Total Cap': ['totalCap', 1],
        'Veilweaving Base DC': ['baseDC', 3],
        'Steady Veil DC': ['steadyVeilDC', 3],
      };
      if (KEYS[label]) {
        const [key, span] = KEYS[label];
        block[key] = rightOf(r, ci, span);
      }
      // "Veilweaving Level" sits in the second column of the same block.
      const right = text(at(r, ci + 2));
      if (right === 'Veilweaving Level') block.level = rightOf(r, ci + 2, 2);
      else if (right === 'Essence') mark(r, ci + 2);
    }
    classes.push({
      index,
      name: text(block.name),
      mod: text(block.mod) || null,
      level: num(block.level),
      essenceCap: num(block.essenceCap),
      bonusCap: num(block.bonusCap),
      baseDC: num(block.baseDC),
      steadyVeilDC: num(block.steadyVeilDC),
    });
  }
  // Total Cap is essence cap + bonus cap, so it is dropped rather than stored.
  const primary = classes.find((c) => c.baseDC) || classes[0] || null;

  // ---- the essence pool ----
  const essence = {};
  for (const [key, label] of ESSENCE_SOURCES) essence[key] = num(g.take(label));
  const usedTotal = text(g.take('Used/Total'));
  const split = /^(\d+)\s*\/\s*(\d+)$/.exec(usedTotal);
  // Used is the sum of what the veils hold, so only the pool size is kept.
  essence.pool = split ? Number(split[2]) : 0;

  /**
   * One slot block: a header row naming the slot, the veil under it, a
   * Bound toggle, and -- when Twinveil is ticked -- a second veil below that.
   * The Kheshig receptacles use the same shape but name a slot instead of
   * being one, and have no second veil.
   */
  const readBlock = (ri, ci, { twin }) => {
    const veils = [];
    const readVeil = (r) => {
      const name = text(at(r, ci));
      const ess = at(r, ci + 3);
      mark(r, ci);
      mark(r, ci + 3);
      mark(r, ci + 4);            // the DC cell, recomputed from base + essence
      // An empty slot still has its essence cell sitting at zero; a veil needs
      // a name or some essence in it to be a veil.
      if (name === '' && num(ess) === 0) return;
      veils.push({ ...splitVeilName(name), essence: num(ess) });
    };
    readVeil(ri + 1);
    // The row below the veil carries the Bound toggle and the two column
    // headings the block repeats.
    if (text(at(ri + 2, ci)) === 'Bound') {
      mark(ri + 2, ci);
      mark(ri + 2, ci + 1);
    }
    if (text(at(ri + 2, ci + 3)) === 'Essence') mark(ri + 2, ci + 3);
    if (text(at(ri + 2, ci + 4)) === 'DC') mark(ri + 2, ci + 4);
    const bound = at(ri + 2, ci + 1) === true;
    let twinveil = false;
    if (twin) {
      if (text(at(ri, ci + 3)) === 'Twinveil') {
        mark(ri, ci + 3);
        mark(ri, ci + 4);
        twinveil = at(ri, ci + 4) === true;
      }
      readVeil(ri + 3);
    }
    return { bound, twinveil, veils };
  };

  // ---- veil slots ----
  const slots = [];
  for (const [ri, ci, m] of g.scan(/^(.+) Veil$/)) {
    if (KHESHIG_VEILS.includes(m[0].trim())) continue;
    mark(ri, ci);
    slots.push({ slot: m[1].trim(), ...readBlock(ri, ci, { twin: true }) });
  }

  // ---- the two Kheshig receptacles ----
  const kheshig = [];
  for (const label of KHESHIG_VEILS) {
    const hit = g.find(label);
    if (!hit) continue;
    const [ri, ci] = hit;
    mark(ri, ci);
    let slot = '';
    if (text(at(ri, ci + 3)) === 'Slot') {
      mark(ri, ci + 3);
      slot = text(at(ri, ci + 4));
      mark(ri, ci + 4);
    }
    const block = readBlock(ri, ci, { twin: false });
    kheshig.push({ label, slot, bound: block.bound, veils: block.veils });
  }

  // ---- other receptacles ----
  // Anything holding essence that is not one of the slots. The essence column
  // is found from its own heading rather than assumed to be the next one
  // along: a sheet that added an active/bound tick between the name and the
  // essence would otherwise have the tick counted as one point of essence.
  const otherAt = g.find('Other Receptacles');
  const otherReceptacles = [];
  if (otherAt) {
    const [ri, ci] = otherAt;
    mark(ri, ci);
    let essCol = ci + 1;
    for (let n = 1; n <= 3; n++) {
      if (text(at(ri, ci + n)) === 'Essence') { essCol = ci + n; mark(ri, ci + n); break; }
    }
    for (let r = ri + 1; r < g.rows.length; r++) {
      const name = text(at(r, ci));
      if (name === '') continue;
      for (let c = ci; c <= essCol; c++) mark(r, c);
      // A boolean between the name and the essence is the receptacle's own
      // on/off tick, not a quantity.
      const flag = essCol > ci + 1 ? at(r, ci + 1) : null;
      const row = { name, essence: num(at(r, essCol)) };
      if (typeof flag === 'boolean') row.active = flag;
      otherReceptacles.push(row);
    }
  }

  if (text(g.find('Essence') ? at(...g.find('Essence')) : '') === 'Essence') mark(...g.find('Essence'));

  return {
    classes,
    baseDC: primary ? primary.baseDC : 0,
    steadyVeilDC: primary ? primary.steadyVeilDC : 0,
    essence,
    slots,
    kheshig,
    otherReceptacles,
    sourceExtras: g.extras(),
  };
}

/**
 * Read the workbook's Maneuvers tab into disciplines the tab now edits.
 *
 * The sheet is a catalogue: each discipline owns three columns -- a 1/0 known
 * flag, the maneuver's name and its type -- and rows are grouped by level and
 * split into Maneuvers and Stances. All but one of the bundled characters carry
 * this tab as an untouched blank template, which imports to no disciplines.
 */
function importManeuvers(tab) {
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
function shrinkDiscipline({ name, entries = [], known, custom, notes }) {
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

/**
 * Read the workbook's Vancian Magic tab into casting classes.
 *
 * The tab holds up to six blocks -- a display name, the class whose table it
 * draws slots from, casting stats, caster level, concentration, and a spell
 * level 0-9 table. None of the five original characters had a field of it
 * filled in, so it imported to six empty blocks and stayed that way; the three
 * sheets that arrived later are the first with anything in it, and the first
 * evidence of what the numbers were supposed to be.
 *
 * **"Casting Types" is one merged label over two separate cells**: how the
 * class prepares (prepared / spontaneous) and where its magic comes from
 * (arcane / divine / occult / alchemy). Reading only the first and calling the
 * pair `types` is what lost the source, so they are read as `prep` and
 * `source` here. The pair drives real behaviour -- see PREP_STYLES.
 *
 * Slots per day, spells known and the save DC are **not** kept: every one of
 * them was a formula on the sheet, and they are recomputed from the shared
 * casting table in `#recomputeVancian`. The `perDay` and `known` fields survive
 * as player overrides, seeded from the sheet only where the slot type names a
 * class the shared table does not have -- a homebrew class, where the sheet's
 * own numbers are the only ones there are.
 *
 * Two template generations are in the wild. The older lays out two blocks per
 * tab and puts its epic casting classes on a second tab; the newer fits six on
 * one. Their prepared-spell lists differ too, so both headings are read.
 */
function importVancian(tab, identity = {}) {
  const g = sheetReader(tab);
  const { at, text, num, mark, rightOf } = g;

  // Three columns of the literal integers 1..156, left over from a dropdown.
  g.dropCounterColumns();

  // The technique picker the sheet parked on this tab: a heading, the odd
  // levels it advances on, and the character's own choice -- which the
  // identity block already carries, so none of it is character data.
  for (const [ri, ci] of g.findAll('Keen Mind Technique')) {
    mark(ri, ci);
    for (let r = ri + 1; r < g.rows.length; r++) {
      if (!/^Level \d+$/.test(text(at(r, ci)))) continue;
      mark(r, ci);
      // What the level grants sits beside it. The panel is the same fixed list
      // on every sheet -- it appears in full even on a character whose
      // technique is something else entirely -- so it is template furniture,
      // not this character's data.
      mark(r, ci + 1);
    }
  }
  const technique = text(identity.primordiaTechnique);
  if (technique) for (const [ri, ci] of g.findAll(technique)) mark(ri, ci);

  const classes = [];
  for (const [ri, ci, m] of g.scan(/^Casting Class(?: (\d+))?$/)) {
    const index = Number(m[1] || 1);
    mark(ri, ci);
    const name = text(at(ri + 1, ci));
    mark(ri + 1, ci);
    if (text(at(ri, ci + 2)) === 'Casting Spell Slot/Known Type') {
      mark(ri, ci + 2);
      mark(ri + 1, ci + 2);
    }
    const slotType = text(at(ri + 1, ci + 2));

    /*
     * The stat labels sit two rows down with their values under them. Three
     * labels, four values: "Casting Types" is merged across two columns and
     * carries the preparation style in the first and the magic's source in the
     * second, so its second value has no label of its own to find it by.
     */
    const stats = { stat: '', stat2: '', prep: '', source: '' };
    if (text(at(ri + 2, ci)) === 'Casting Stat') {
      const LABELS = [
        ['Casting Stat', ['stat']],
        ['Casting Stat 2', ['stat2']],
        ['Casting Types', ['prep', 'source']],
      ];
      LABELS.forEach(([label, keys], n) => {
        if (text(at(ri + 2, ci + n)) !== label) return;
        mark(ri + 2, ci + n);
        keys.forEach((key, k) => {
          mark(ri + 3, ci + n + k);
          stats[key] = text(at(ri + 3, ci + n + k));
        });
      });
    }
    // Both cells are free text on the sheet; they become keys or nothing.
    stats.prep = closestName(stats.prep, PREP_STYLE_KEYS);
    stats.source = closestName(stats.source, CASTING_SOURCE_KEYS);

    /*
     * The Caster Level cell is read only to consume it: it was a COUNTIF over
     * the Planner's rows for this class, so it is another cached formula result
     * and is recomputed the same way. Nothing pins it unless a player asks.
     */
    let concentration = 0;
    for (let r = ri + 2; r < Math.min(ri + 7, g.rows.length); r++) {
      if (text(at(r, ci)) === 'Caster Level') rightOf(r, ci, 1);
      if (text(at(r, ci + 2)) === 'Concentration') concentration = num(rightOf(r, ci + 2, 1));
    }

    /*
     * The spell table: its header row, then one row per spell level.
     *
     * The heading is not a fixed string -- the sheet rewrote it from the source
     * cell, so an alchemist's block says "Extract level" and matching the one
     * spelling would walk straight past the table.
     */
    const spells = [];
    let tableRow = -1;
    for (let r = ri + 4; r < Math.min(ri + 9, g.rows.length); r++) {
      if (/^(?:Spell|Extract) level$/.test(text(at(r, ci)))) { tableRow = r; break; }
    }
    if (tableRow >= 0) {
      for (let n = 0; n < 4; n++) mark(tableRow, ci + n);
      for (const level of SPELL_LEVELS) {
        const r = tableRow + 1 + level;
        // All four cells are consumed: slots per day, save DC and spells known
        // were formulas on the sheet and are recomputed from the shared casting
        // table, so keeping the cached copies would be keeping derived data.
        // `perDay` and `known` stay as player overrides, empty until set.
        for (let n = 0; n < 4; n++) mark(r, ci + n);
        spells.push({ level, perDay: null, known: null });
      }
    }

    classes.push({
      index, name, slotType, ...stats, casterLevelOverride: null, concentration, spells,
    });
  }

  /*
   * The spell list, which the two template generations head differently.
   *
   * The newer one repeats a `Prep/Used | Class/Level | Spells Known` triple
   * three times across. Its first column was never a tick box -- a formula cell
   * cannot also be something you tick and reset each morning -- so players used
   * it as a label column instead, and one sheet arrives with `FCB` and
   * `Mystery Spells` in it. That is kept verbatim rather than interpreted.
   *
   * The older one has a single `Spells Known/Prepared` heading over three name
   * columns two apart, the stride left by the counter columns between them.
   */
  const prepared = [];
  const KNOWN_HEAD = /^(?:Spells|Extracts) Known$/;
  for (const [ri, ci] of g.findAll('Prep/Used')) {
    mark(ri, ci);
    if (text(at(ri, ci + 1)) === 'Class/Level') mark(ri, ci + 1);
    if (KNOWN_HEAD.test(text(at(ri, ci + 2)))) mark(ri, ci + 2);
    for (let r = ri + 1; r < g.rows.length; r++) {
      const label = text(at(r, ci));
      const classLevel = text(at(r, ci + 1));
      const spell = text(at(r, ci + 2));
      // A row with a label and no spell is a section heading -- `FCB`,
      // `Mystery Spells` -- and heads the rows under it. Requiring a spell name
      // dropped those into the leftovers and took the list's shape with them.
      if (label === '' && classLevel === '' && spell === '') continue;
      mark(r, ci);
      mark(r, ci + 1);
      mark(r, ci + 2);
      prepared.push({ prepUsed: label, classLevel, name: spell });
    }
  }
  for (const [ri, ci] of g.scan(/^(?:Spells|Extracts) Known\/Prepared$/)) {
    mark(ri, ci);
    for (const col of [ci, ci + 2, ci + 4]) {
      for (let r = ri + 1; r < g.rows.length; r++) {
        const spell = text(at(r, col));
        if (spell === '') continue;
        mark(r, col);
        prepared.push({ prepUsed: '', classLevel: '', name: spell });
      }
    }
  }

  return {
    // A block with nothing but a caster level cannot exist -- the sheet's COUNTIF
    // needed a class name to produce one -- so the name and the picks decide.
    classes: classes.filter((c) => c.name || c.slotType || c.stat || c.prep || c.source),
    prepared,
    sourceExtras: g.extras(),
  };
}

/**
 * Several Vancian tabs' blocks as one block.
 *
 * Each tab numbers its own casting classes from one, so the indices are reissued
 * across the merged list -- otherwise the epic tab's "Casting Class 1" collides
 * with the main tab's.
 */
function mergeVancian(parts) {
  const out = { classes: [], prepared: [], sourceExtras: [] };
  for (const part of parts) {
    for (const c of part.classes || []) {
      out.classes.push({ ...c, index: out.classes.length + 1 });
    }
    out.prepared.push(...(part.prepared || []));
    out.sourceExtras.push(...(part.sourceExtras || []));
  }
  return out;
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

function importPsionics(tab, identity = {}) {
  const g = sheetReader(tab);
  const { at, text, num, mark, rightOf } = g;

  // A column of the literal integers 1..60 under a "Power Known" heading: the
  // power list's row numbers. The heading is claimed first so it does not
  // disqualify the run beneath it.
  for (const [ri, ci] of g.findAll('Power Known')) mark(ri, ci);
  g.dropCounterColumns();

  /*
   * The technique panel: a heading, the odd levels it advances on, and what each
   * grants. It is the same fixed list on every sheet -- it shows in full even on
   * a character whose technique is something else -- so it is template furniture.
   */
  for (const [ri, ci] of g.scan(/\bTechnique$/)) {
    mark(ri, ci);
    for (let r = ri + 1; r < g.rows.length; r++) {
      if (!/^Level \d+$/.test(text(at(r, ci)))) continue;
      // The level, what it grants, and the note the sheet put beside it when the
      // character's technique is the one this panel describes.
      for (let n = 0; n <= 3; n++) mark(r, ci + n);
    }
  }
  const technique = text(identity.primordiaTechnique);
  if (technique) for (const [ri, ci] of g.findAll(technique)) mark(ri, ci);

  const classes = [];
  for (const [ri, ci] of g.findAll('Ability 1')) {
    mark(ri, ci);
    const name = text(at(ri - 1, ci));
    mark(ri - 1, ci);
    const stat = text(at(ri, ci + 1));
    mark(ri, ci + 1);

    let stat2 = '';
    if (text(at(ri + 1, ci)) === 'Ability 2') {
      mark(ri + 1, ci);
      stat2 = text(at(ri + 1, ci + 1));
      mark(ri + 1, ci + 1);
    }

    // The curve, named by the total it reaches at level 20.
    let curveTotal = 0;
    if (text(at(ri, ci + 2)) === 'PP@20') {
      mark(ri, ci + 2);
      curveTotal = num(at(ri, ci + 3));
      mark(ri, ci + 3);
    }

    // The power list: a header, then a name and the level it is manifested at.
    const powers = [];
    let headerRow = -1;
    for (let r = ri; r < Math.min(ri + 3, g.rows.length); r++) {
      if (text(at(r, ci + 3)) === 'Power Level') { headerRow = r; break; }
    }
    if (headerRow >= 0) {
      mark(headerRow, ci + 3);
      for (let r = headerRow + 1; r < g.rows.length; r++) {
        const power = text(at(r, ci));
        const level = text(at(r, ci + 3));
        if (power === '' && level === '') continue;
        mark(r, ci);
        mark(r, ci + 3);
        powers.push({ name: power, level });
      }
    }

    classes.push({ index: classes.length + 1, name, stat, stat2, curveTotal, powers });
  }

  /*
   * The Power Points panel. Each line but Bonus PP was a formula, so only that
   * one is read -- the rest are recomputed from the curves.
   */
  let bonusPoints = 0;
  for (const [ri, ci] of g.findAll('Power Points')) mark(ri, ci);
  for (const [ri, ci] of g.scan(/^Class (\d+) PP$/)) rightOf(ri, ci, 1);
  for (const [ri, ci] of g.findAll('Total PP')) rightOf(ri, ci, 1);
  for (const [ri, ci] of g.findAll('Bonus PP')) bonusPoints = num(rightOf(ri, ci, 1));

  return {
    classes: classes.filter((c) => c.name || c.stat || c.curveTotal || c.powers.length),
    bonusPoints,
    spent: 0,
    sourceExtras: g.extras(),
  };
}

/* ------------------------------------------------------------------ *
 * Card Casting (Expanded Spheres: Cardcaster's Gamble).
 *
 * A caster with the Card Casting drawback keeps a deck: one card per effect
 * that costs spell points, drawn at random in combat. The block below is that
 * deck plus the drawback's ladder (Cooldown, Mana Pool, Mana Graveyard) and its
 * modifications, so the sheet can check the deck rules -- minimum size, the
 * identical-effect spread, colour balance -- and hand the numbers to formulas.
 * ------------------------------------------------------------------ */

/** The five mana colours, in the order the deck tab lists them. */
export const CARD_COLORS = [
  ['R', 'Red'], ['B', 'Black'], ['U', 'Blue'], ['W', 'White'], ['G', 'Green'],
];
const COLOR_LETTERS = CARD_COLORS.map(([k]) => k);
const COLOR_WORDS = {
  red: 'R', black: 'B', back: 'B', blue: 'U', white: 'W', green: 'G',
};

/**
 * The modifications a card caster may add to the drawback. Each is one more
 * drawback for boons (Colored Mana with five colours is two), and each has the
 * prerequisite the rules give it. `kind` says what the switch stores.
 */
export const CARD_MODIFICATIONS = [
  { key: 'bleedingHand', label: 'Bleeding Hand', kind: 'count', max: 2, needs: null,
    hint: 'Discard a card from your hand whenever you take a standard or full-round action that does not play or discard one. Taken twice: move, swift and immediate actions too.' },
  { key: 'coloredMana', label: 'Colored Mana', kind: 'colors', needs: 'manaPool',
    hint: 'Mana Point cards and effects each have a colour; mana only pays for effects of its colour. Three colours: no colour may be more than half your effects. Five colours: no more than a quarter, and it counts as two drawbacks.' },
  { key: 'deckout', label: 'Deckout', kind: 'bool', needs: 'cooldown',
    hint: 'You can never shuffle the discard pile back into the deck. Every turn the deck is empty you take 4 Constitution burn (Charisma if you have no Con). Reaching 0 kills you.' },
  { key: 'exposedGrip', label: 'Exposed Grip', kind: 'bool', needs: 'cooldown',
    hint: 'No card at the start of your turn; a move, swift or standard action draws one. Whenever you are hit or fail a save, discard a card — or take 4 Con burn if your hand is empty.' },
  { key: 'gradualRamp', label: 'Gradual Ramp', kind: 'bool', needs: 'manaPool',
    hint: 'Only one Mana Point card may be played from your hand per round.' },
  { key: 'lifeboundDeck', label: 'Lifebound Deck', kind: 'bool', needs: null,
    hint: 'Three extra piles — Stun, Wounds, Death. Lifebound value = one third of total HP divided by the deck size at the start of the day (minimum 1). Every Lifebound value of damage lost moves a card down the piles; every Lifebound value healed moves one back.' },
  { key: 'singleton', label: 'Singleton', kind: 'bool', needs: 'cooldown',
    hint: 'One copy of each card in the deck; Mana Point cards not affected by Specialized Mana Cards may still repeat.' },
  { key: 'stagnantPool', label: 'Stagnant Pool', kind: 'bool', needs: 'manaPool', clashes: 'manaGraveyard',
    hint: 'Mana Point cards in play are the spell points you may spend each round; turn one sideways per point spent, and untap them all at the start of your next turn. Incompatible with Mana Graveyard.' },
  { key: 'strikableAssets', label: 'Strikable Assets', kind: 'bool', needs: null,
    hint: 'Hand, deck and discard pile are worn objects that can be attacked; damage to them is dealt to you, and a hit or failed save reveals a card at random from one of them.' },
  { key: 'tightHand', label: 'Tight Hand', kind: 'bool', needs: null,
    hint: 'Maximum hand size 3, plus 1 for each Loaded Hand deck manipulation. Draws that would go past it stop at it.' },
];

/** "Draw Power Enhancement (Draw 3 cards)" → the name and the note in brackets. */
function splitBracketNote(raw) {
  return splitVeilName(raw);
}

/* ------------------------------------------------------------------ *
 * The deck manipulation catalogue.
 *
 * "For every deck feat a character possesses, they may also select a special
 * deck manipulation" -- the list is on the wiki's Card and Deck Feats page and
 * lives in the deck-manipulations extension pack (`data/extensions/deck-manipulations.json`): name, group, what it needs, and the rule.
 * Registered once at startup; without it a manipulation is still a name and a
 * count, it simply has no rule text to show.
 * ------------------------------------------------------------------ */

let DECK_MANIPULATIONS = [];

/** Register the shared deck manipulation list. Call before constructing a Character. */
export function setCardcastingTables(doc) {
  DECK_MANIPULATIONS = (Array.isArray(doc?.manipulations) ? doc.manipulations : []).map((m) => ({
    name: String(m.name || ''),
    group: String(m.group || 'General'),
    requires: Array.isArray(m.requires) ? m.requires.map(String) : [],
    needs: String(m.needs || ''),
    repeat: !!m.repeat,
    max: Number(m.max) || 0,
    text: String(m.text || ''),
  }));
}

export function deckManipulationCatalogue() {
  return DECK_MANIPULATIONS;
}

/** "Draw Power Enhancement", "Drawpower Enhancement" and "Wildcard" / "Wild Card" are the same pick. */
const manipulationKey = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

/** The catalogue entry a manipulation's name refers to, or null. */
export function deckManipulation(name) {
  const key = manipulationKey(name);
  if (!key) return null;
  return DECK_MANIPULATIONS.find((m) => manipulationKey(m.name) === key) || null;
}

/** The deck feats a character has: every feat or bought-off drawback tagged [Deck]. */
function deckFeatNames(d) {
  const out = [];
  // Feats arrive keyed by group and are normalised into `featGroups`; a
  // document may be at either stage when this is asked.
  const groups = Array.isArray(d?.featGroups) ? d.featGroups.map((g) => g.entries || [])
    : Object.values(d?.feats || {});
  for (const rows of groups) {
    if (!Array.isArray(rows)) continue;
    for (const f of rows) if (/\[[^\]]*deck/i.test(String(f?.name || ''))) out.push(String(f.name));
  }
  for (const x of d?.training?.magic?.tradition?.boughtOff || []) {
    if (/\[[^\]]*deck/i.test(String(x || ''))) out.push(String(x));
  }
  return out;
}

/** Uppercase colour letters only, in first-seen order: "u/b" → "UB". */
function normalizeColors(value) {
  const letters = String(value ?? '').toUpperCase().replace(/[^RBUWG]/g, '');
  return [...new Set(letters)].join('');
}

/**
 * Colour words in a card's text: "Blue/Black Mana" → "UB". The sheet spelt
 * "Back" for Black on two cards, which is why the typo is in the table.
 */
function colorsFromWords(text) {
  const out = [];
  for (const word of String(text || '').toLowerCase().match(/[a-z]+/g) || []) {
    const c = COLOR_WORDS[word];
    if (c && !out.includes(c)) out.push(c);
  }
  return out.join('');
}

/**
 * Read the workbook's Cardcaster Deck tab into the deck the Cardcasting tab
 * edits.
 *
 * The tab is one character's own design rather than template furniture, so
 * everything is found by its label: the drawback switches beside their names,
 * the deck manipulations under their group headings, the land-attuned spheres
 * under theirs, and the deck itself under the "Suit / Align. / Mana / Effect"
 * header. What the sheet worked out for itself -- colour tallies, the Harrow
 * suit and alignment totals, the decklist, the identical-effect spread -- is
 * recomputed here and not kept, which is most of the tab's right-hand side.
 *
 * `drawbacks` is the tradition's drawback list from the Magic Training tab, so
 * a caster who took Card Casting without a deck tab still gets the switches
 * ticked that the tradition says are on.
 */
function importCardcasting(tab, drawbacks = [], magicClasses = [], deckFeats = []) {
  const g = sheetReader(tab);
  const { at, text, num, mark, isUsed, rightOf, find, findAll, scan } = g;
  const bool = (v) => v === true || (typeof v === 'number' && v > 0)
    || /^(true|yes|x|✓)$/i.test(text(v));

  const drawbackList = (drawbacks || []).map((x) => text(x).toLowerCase());
  const hasDrawback = (re) => drawbackList.some((x) => re.test(x));

  const block = {
    enabled: !!tab || hasDrawback(/card\s*cast/),
    castingStat: '',
    useD100: false,
    cooldown: hasDrawback(/^cooldown/),
    manaPool: hasDrawback(/^mana pool/),
    manaGraveyard: hasDrawback(/^mana graveyard/),
    mods: {
      bleedingHand: hasDrawback(/^bleeding hand/) ? 1 : 0,
      coloredMana: hasDrawback(/^colored mana/) ? 3 : 0,
      deckout: hasDrawback(/^deckout/),
      exposedGrip: hasDrawback(/^exposed grip/),
      gradualRamp: hasDrawback(/^gradual ramp/),
      lifeboundDeck: hasDrawback(/^lifebound deck/),
      singleton: hasDrawback(/^singleton/),
      stagnantPool: hasDrawback(/^stagnant pool/),
      strikableAssets: hasDrawback(/^strikable assets/),
      tightHand: hasDrawback(/^tight hand/),
    },
    colors: '',
    colorSpheres: Object.fromEntries(COLOR_LETTERS.map((c) => [c, []])),
    attunedSpheres: [],
    manipulations: [],
    manipulationsAvailable: null,
    cards: [],
    sideboard: [],
    harrow: false,
    notes: '',
    sourceExtras: [],
  };
  // "Colored Mana (RBU)" on the tradition names the colours in play.
  const coloredNote = drawbackList.find((x) => /^colored mana/.test(x));
  if (coloredNote) {
    const letters = normalizeColors((coloredNote.match(/\(([^)]*)\)/) || [])[1]);
    if (letters.length === 3 || letters.length === 5) {
      block.colors = letters;
      block.mods.coloredMana = letters.length;
    }
  }
  const firstMod = text(magicClasses.find((c) => c?.mod1)?.mod1);
  if (firstMod) block.castingStat = firstMod;

  if (!tab) return block;

  // ---- the header block: casting stat, switches, and the sheet's own tallies ----
  const camCell = find('Cardcaster CAM');
  if (camCell) block.castingStat = text(rightOf(camCell[0], camCell[1], 6)) || block.castingStat;
  const flag = (label, span = 3) => {
    const hit = find(label);
    if (!hit) return null;
    const v = rightOf(hit[0], hit[1], span);
    // A stray tick beside a switch's value (the sheet kept one next to
    // Deckout) belongs to nothing; it goes with the value.
    for (let n = 1; n <= span; n++) {
      if (isUsed(hit[0], hit[1] + n) && typeof at(hit[0], hit[1] + n + 1) === 'boolean') mark(hit[0], hit[1] + n + 1);
    }
    return v;
  };
  for (const label of ['Deck Size:', 'Min-Max Diff', 'Deck Feats']) flag(label, 6);   // recomputed below
  const remaining = num(flag('Remaining Deck Manip.', 6));
  const d100 = flag('Using d100', 6);
  if (d100 !== null) block.useD100 = bool(d100);
  const mp = flag('Mana Pool');
  if (mp !== null) block.manaPool = bool(mp);
  const cd = flag('Cooldown');
  if (cd !== null) block.cooldown = bool(cd);
  const mg = flag('Mana Graveyard');
  if (mg !== null) block.manaGraveyard = bool(mg);
  const cm = flag('Colored Mana');
  if (cm !== null) {
    const n = num(cm);
    block.mods.coloredMana = n === 5 ? 5 : n > 0 ? 3 : 0;
  }
  for (const [label, key] of [['Deckout', 'deckout'], ['Stagnant Pool', 'stagnantPool'],
    ['Gradual Ramp', 'gradualRamp'], ['Exposed Grip', 'exposedGrip'], ['Lifebound Deck', 'lifeboundDeck'],
    ['Singleton', 'singleton'], ['Strikable Assets', 'strikableAssets'], ['Tight Hand', 'tightHand']]) {
    const v = flag(label);
    if (v !== null) block.mods[key] = bool(v);
  }
  const bh = flag('Bleeding Hand');
  if (bh !== null) block.mods.bleedingHand = Math.min(2, num(bh) || (bool(bh) ? 1 : 0));

  // ---- deck manipulations: label + count under each group heading ----
  const headings = scan(/^(.*) Deck Manipulations$|^Specialized Mana Cards\b/)
    .map(([ri, ci, m]) => ({ ri, ci, group: (m[1] || 'Specialized Mana Cards').trim() }));
  const landHit = find('Land-Attuned Magic');
  const columns = [...new Set(headings.map((h) => h.ci))].sort((a, b) => a - b);
  for (const h of headings) {
    mark(h.ri, h.ci);
    const nextCol = columns.find((c) => c > h.ci);
    // The land-attuned block keeps its colour letters one column left of its
    // heading, so a group's columns stop short of that too.
    const colEnd = Math.min(nextCol ?? Infinity, landHit && landHit[1] > h.ci ? landHit[1] - 1 : Infinity, h.ci + 8) - 1;
    const below = headings.filter((o) => o.ci === h.ci && o.ri > h.ri).map((o) => o.ri);
    const rowEnd = below.length ? Math.min(...below) - 1 : g.rows.length - 1;
    for (let r = h.ri + 1; r <= rowEnd; r++) {
      let any = false;
      for (let c = h.ci; c <= colEnd; c++) {
        if (isUsed(r, c) || typeof at(r, c) !== 'string' || text(at(r, c)) === '') continue;
        any = true;
        // The count sits within two cells to the right: a number, or a tick.
        let value = null;
        for (let n = 1; n <= 2 && c + n <= colEnd; n++) {
          const v = at(r, c + n);
          if (typeof v === 'number' || typeof v === 'boolean') { value = v; mark(r, c + n); break; }
        }
        mark(r, c);
        const { name, desc } = splitBracketNote(at(r, c));
        block.manipulations.push({
          group: h.group,
          name,
          note: desc,
          count: typeof value === 'number' ? value : value === true ? 1 : 0,
        });
      }
      // The first row with nothing in the group's columns ends it -- the deck
      // table starts under the General group and must not be read as feats.
      if (!any && r > h.ri + 1) break;
    }
  }
  const taken = block.manipulations.reduce((n, m) => n + (Number(m.count) || 0), 0);
  // One manipulation per deck feat, plus Card Shark's extra: when the sheet's
  // total is exactly that, leave it automatic so a new deck feat raises it.
  const auto = deckFeats.length + (deckFeats.some((f) => /card shark/i.test(f)) ? 1 : 0);
  block.manipulationsAvailable = taken + remaining === auto ? null : taken + remaining;

  // ---- land-attuned magic: a colour, five spheres, a tick each ----
  if (landHit) {
    const [lr, lc] = landHit;
    mark(lr, lc);
    for (let r = lr + 1; r < g.rows.length; r++) {
      const letter = text(at(r, lc - 1)).toUpperCase();
      if (COLOR_LETTERS.includes(letter) && letter.length === 1) {
        mark(r, lc - 1);
        const spheres = [];
        const ticks = [];
        for (let c = lc; c <= lc + 20; c++) {
          const v = at(r, c);
          if (typeof v === 'string' && text(v)) { spheres.push(text(v)); mark(r, c); } else if (typeof v === 'boolean') { ticks.push(v); mark(r, c); }
        }
        block.colorSpheres[letter] = spheres;
        spheres.forEach((s, i) => { if (ticks[i]) block.attunedSpheres.push(s); });
        // The row beneath is the sheet's own count of cards per sphere.
        for (let c = lc - 1; c <= lc + 20; c++) {
          const v = at(r + 1, c);
          if (typeof v === 'number' || text(v) === 'Cards') mark(r + 1, c);
        }
        r += 1;
      } else break;      // the colour rows are contiguous; the tally table below reuses the letters
    }
  }

  // ---- colours in play: the "All Cards" tick row under the R B U W G letters ----
  const allCards = find('All Cards');
  if (allCards) {
    const [ar, ac] = allCards;
    mark(ar, ac);
    let letters = '';
    for (let c = ac + 1; c <= ac + 5; c++) {
      const l = text(at(ar - 1, c)).toUpperCase();
      if (COLOR_LETTERS.includes(l) && at(ar, c) === true) letters += l;
      mark(ar - 1, c);
      mark(ar, c);
    }
    if (letters) block.colors = letters;
  }

  // ---- the deck ----
  const header = find('Suit');
  if (header) {
    const [hr, hc] = header;
    const col = {};
    for (let c = 0; c < (g.rows[hr] || []).length; c++) {
      const label = text(at(hr, c));
      if (label) { col[label] = c; mark(hr, c); }
    }
    const suitCol = col.Suit;
    const effectCol = col.Effect ?? suitCol + 4;
    const manaCol = col.Mana ?? suitCol + 2;
    const harrowCol = col['Harrow Name'];
    const deckHit = find('Deck');
    if (deckHit && deckHit[0] < hr) mark(deckHit[0], deckHit[1]);

    for (let r = hr + 1; r < g.rows.length; r++) {
      const index = at(r, suitCol - 1);
      const suit = text(at(r, suitCol));
      const effectRaw = text(at(r, effectCol));
      if (typeof index !== 'number' && !suit && !effectRaw) break;
      mark(r, suitCol - 1);
      mark(r, suitCol);
      const alignment = text(at(r, col['Align.'] ?? suitCol + 1));
      mark(r, col['Align.'] ?? suitCol + 1);
      const color = normalizeColors(at(r, manaCol));
      const mana2 = normalizeColors(at(r, manaCol + 1));
      mark(r, manaCol);
      mark(r, manaCol + 1);
      mark(r, effectCol);
      // "Reanimate | Blue/Black Mana": the effect, and the mana the fused card
      // also carries. Without the suffix, the second Mana column is the mana.
      // Only a trailing "| … Mana" is the mana half; a bar inside the effect's
      // own brackets ("Chain Blast|Explosive Orb") is part of the effect.
      const manaSuffix = /^(.*?)\s*\|\s*([^|]*\bmana\b[^|]*)$/i.exec(effectRaw);
      const mana = manaSuffix ? (colorsFromWords(manaSuffix[2]) || mana2) : mana2;
      const effect = manaSuffix ? manaSuffix[1].trim() : effectRaw;
      const cost = col.Cost !== undefined ? at(r, col.Cost) : null;
      if (col.Cost !== undefined) mark(r, col.Cost);
      const tags = col.Other !== undefined ? text(at(r, col.Other)) : '';
      if (col.Other !== undefined) mark(r, col.Other);
      const sphere = col.Sphere !== undefined ? text(at(r, col.Sphere)) : '';
      if (col.Sphere !== undefined) mark(r, col.Sphere);
      // An unlabelled number between Sphere and Harrow Name is how many copies.
      let qty = 1;
      if (harrowCol !== undefined && col.Sphere !== undefined) {
        for (let c = col.Sphere + 1; c < harrowCol; c++) {
          if (typeof at(r, c) === 'number') { qty = at(r, c); mark(r, c); break; }
        }
      }
      const harrow = harrowCol !== undefined ? text(at(r, harrowCol)) : '';
      if (harrowCol !== undefined) mark(r, harrowCol);
      const tech = col['Tech.'] !== undefined ? bool(at(r, col['Tech.'])) : false;
      if (col['Tech.'] !== undefined) mark(r, col['Tech.']);
      if (col.Drawable !== undefined) mark(r, col.Drawable);
      const roll = col['Roll #'] !== undefined && typeof at(r, col['Roll #']) === 'number'
        ? at(r, col['Roll #']) : null;
      if (col['Roll #'] !== undefined) mark(r, col['Roll #']);

      // The Harrow card's name is the card's name: Nico's deck is a Harrow
      // deck, and "Betrayal" is what he calls the card, not a note about it.
      block.cards.push({
        name: harrow, suit, alignment, color, mana, effect,
        cost: cost === null || cost === undefined ? '' : String(cost),
        sphere, tags, qty, tech, roll, art: '', notes: '',
      });
    }
  }

  // ---- the sideboard: effect / cost / sphere / mana, under its heading ----
  const side = find('Sideboard');
  // "Sideboard" is also a General deck manipulation; the table is the one with
  // a Cost header on the same row.
  for (const [sr, sc] of findAll('Sideboard')) {
    let costCol = -1;
    let sphereCol = -1;
    let manaCol = -1;
    for (let c = sc + 1; c <= sc + 12; c++) {
      const label = text(at(sr, c));
      if (label === 'Cost') costCol = c;
      else if (label === 'Sphere') sphereCol = c;
      else if (label === 'Mana') manaCol = c;
    }
    if (costCol < 0 || sphereCol < 0) continue;
    mark(sr, sc);
    for (const c of [costCol, sphereCol, manaCol]) if (c >= 0) mark(sr, c);
    for (let r = sr + 1; r < g.rows.length; r++) {
      const cells = [];
      for (let c = sc; c <= sc + 12; c++) if (text(at(r, c))) cells.push(c);
      if (!cells.length) break;
      const nameCells = cells.filter((c) => c < costCol);
      const effect = nameCells.map((c) => text(at(r, c))).join(' ');
      const cost = text(at(r, costCol));
      const sphere = text(at(r, sphereCol));
      let mana = '';
      for (const c of cells) if (c >= (manaCol < 0 ? sphereCol + 1 : manaCol)) mana += normalizeColors(at(r, c));
      for (const c of cells) mark(r, c);
      block.sideboard.push({ name: '', effect, cost, sphere, tags: '', color: '', mana: normalizeColors(mana), art: '', notes: '' });
    }
  }
  void side;

  // ---- what the sheet tallied for itself: dropped, recomputed on load ----
  const dropRegion = (r0, r1, c0, c1) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (at(r, c) !== null && at(r, c) !== undefined) mark(r, c);
  };
  if (allCards) {
    // From the colour letters down to the row before the Harrow totals or the
    // sideboard, whichever comes first: per-colour counts, Σ Cards, Σ Mana Cards.
    const stops = [find('Harrow Deck'), side].filter(Boolean).map((h) => h[0]).filter((r) => r > allCards[0]);
    const end = stops.length ? Math.min(...stops) - 1 : allCards[0] + 8;
    dropRegion(allCards[0] - 1, end, allCards[1], allCards[1] + 10);
  }
  const harrow = find('Harrow Deck');
  if (harrow) dropRegion(harrow[0], harrow[0] + 6, harrow[1], harrow[1] + 7);
  const decklist = find('Decklist');
  if (decklist) dropRegion(decklist[0], g.rows.length - 1, decklist[1], decklist[1] + 7);
  // The suit+alignment key beside each card, and the zero-filled Min / Max /
  // colour columns past it.
  const keyRe = /^(Str|Dex|Con|Int|Wis|Cha)(LG|NG|CG|LN|TN|CN|LE|NE|CE)$/;
  const tailFrom = allCards ? allCards[1] + 11 : Infinity;
  g.rows.forEach((cells, r) => {
    // A row of nothing but unticked boxes is a hidden control strip, not data.
    const live = cells.map((v, c) => [v, c]).filter(([v]) => v !== null && v !== undefined && v !== '');
    if (live.length && live.every(([v]) => v === false)) live.forEach(([, c]) => mark(r, c));
    cells.forEach((v, c) => {
      if (isUsed(r, c)) return;
      if (typeof v === 'string' && keyRe.test(v.trim())) mark(r, c);
      else if (c >= tailFrom && (typeof v === 'number' || ['Min', 'Max', ...COLOR_LETTERS].includes(text(v)))) mark(r, c);
    });
  });

  block.harrow = block.cards.some((card) => card.suit || card.alignment);
  block.sourceExtras = g.extras();
  return block;
}

/* ------------------------------------------------------------------ *
 * The Template tab: from the sheet's columns of blocks to feature groups.
 * ------------------------------------------------------------------ */

/** The tab names the workbook uses; a sheet carries one or the other. */
const TEMPLATE_TABS = ['Template', 'Copy of Template'];

/** A feature's type, as the sheet writes it. Blank is a legitimate answer. */
export const TEMPLATE_TYPES = ['Ex', 'Su', 'Sp'];

/**
 * The template's own geometry: every feature slot carries a "Type:" marker
 * three columns right of the name, with the type itself in the next cell over.
 */
const TEMPLATE_TYPE_LABEL = 'Type:';
const TEMPLATE_TYPE_OFFSET = 3;

/** "Omni-Cooking: Precise Preparation" is a sub-ability of "Omni-Cooking". */
const SUB_ABILITY = /^\s*[:–—]\s*\S/;

/**
 * The tab's rows back at their sheet positions.
 *
 * The converter keeps only rows that hold something and records each one's
 * number. Here the gaps matter -- a blank row is what separates one feature's
 * block from the next -- so they are put back before the scan runs.
 */
function positionedRows(tab) {
  const rows = [];
  (tab?.rows || []).forEach((row, i) => {
    const n = Number(row?.r);
    rows[(Number.isFinite(n) && n > 0 ? n : i + 1) - 1] = { cells: [...(row?.cells || [])] };
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = { cells: [] };
  return rows;
}

/**
 * One table inside a feature block.
 *
 * The header row is the first row of the run and its cells name the columns;
 * everything below is a row. The columns are whichever of the block's columns
 * the run actually uses, because the sheet's merged cells leave the ones
 * between them empty -- Bryva's spell-school table spans L, N, Q and T.
 *
 * Returns the last row consumed, so the caller can carry on beneath it.
 */
function readTemplateTable(g, feature, top, filled, starts) {
  const { at, text, mark } = g;
  let last = top;
  for (let ri = top + 1; ri < g.rows.length; ri++) {
    if (starts(ri) || !filled(ri).length) break;
    last = ri;
  }
  const cols = new Set();
  for (let ri = top; ri <= last; ri++) for (const ci of filled(ri)) cols.add(ci);
  const at_ = [...cols].sort((a, b) => a - b);
  const row = (ri) => at_.map((ci) => {
    mark(ri, ci);
    return at(ri, ci);
  });

  const table = { caption: '', columns: row(top).map((v) => text(v)), rows: [] };
  for (let ri = top + 1; ri <= last; ri++) table.rows.push({ cells: row(ri) });
  feature.tables.push(table);
  return last;
}

/**
 * Gather the flat list of features into groups and their sub-abilities.
 *
 * The sheet has no nesting of its own -- a sub-ability is written as
 * "<parent>: <name>" in the column below its parent, which is how
 * Omni-Cooking's four blocks read. The longest matching parent wins, so a
 * group whose own name starts with another group's still collects its own.
 */
function groupTemplateFeatures(flat) {
  const groups = [];
  for (const f of flat) {
    const parent = groups
      .filter((p) => p.name && f.name.startsWith(p.name)
        && SUB_ABILITY.test(f.name.slice(p.name.length)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (parent) parent.children.push({ name: f.name, type: f.type, text: f.text, tables: f.tables });
    else groups.push(f);
  }
  return groups;
}

/**
 * What the scan could not place, kept rather than dropped.
 *
 * A template laid out in a shape this does not understand still has to arrive
 * whole, so its cells land in one group at the end of the template as a table
 * the player can read and cut up. Nothing treats it specially afterwards:
 * rename it, retype it, drag it, give it sub-abilities, or delete it once its
 * contents have found homes.
 */
function temporaryTemplateGroup(rows) {
  const width = Math.max(1, ...rows.map((r) => (r.cells || []).length));
  // A column the sheet left empty between two it used is spacing, not data, and
  // an empty column of a table is only width. The order of what is left is the
  // order it was written in, so the block still reads as it did on the tab.
  const cols = [];
  for (let ci = 0; ci < width; ci++) {
    if (rows.some((r) => (r.cells || [])[ci] !== null && (r.cells || [])[ci] !== undefined
      && String((r.cells || [])[ci]).trim() !== '')) cols.push(ci);
  }
  return {
    name: 'Temporary',
    type: null,
    temporary: true,
    text: '',
    tables: [{
      caption: 'Cells the import could not place',
      columns: cols.map(() => ''),
      rows: rows.map((r) => ({ cells: cols.map((ci) => (r.cells || [])[ci] ?? null) })),
    }],
    children: [],
  };
}

/* ------------------------------------------------------------------ *
 * Wealth: the wallet, in mana.
 *
 * The campaign's currency is mana. The workbook's wallet block (Character
 * Info, beside the mythic path) records the balance after the last Oath of
 * Offerings, whether the character keeps the Oath and casts materially, when
 * the last offering was made, the mana earned a day and the mana earned in
 * sessions since ("Sessions" on the sheet is that sum, not a count),
 * and the current balance -- and derives what the next offering will come to
 * and what is left after it. That derivation, from the most recent sheet
 * (Saburo's), with the two switches the earlier one (Narockro's) had:
 *
 *   OoO/Day          = Mana/Day / 2
 *   expected, oath   = days since the last offering x OoO/Day + floor(session mana / 2)
 *                      -- half of everything earned, the daily income and the rewards alike
 *   expected, casting = whole months since the last offering x 30
 *   expected         = the parts whose switch is on
 *   Mana After       = current - expected
 *
 * `ledger` is the hook for what comes later: every reward, spend and offering
 * is a line with a date, a label and an amount, and `current` moves with it.
 * A session reward is a line of kind "session" that also adds to the session
 * mana the oath takes half of.
 * ------------------------------------------------------------------ */

export const WEALTH_KINDS = ['session', 'reward', 'spend', 'offering', 'adjust'];
/** Material casting costs this much per caster level, every whole month. */
export const MATERIAL_CASTING_PER_LEVEL = 10;

const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
/** "2026-08-02T00:00:00" or a Date → "2026-08-02"; anything unreadable → ''. */
export function isoDay(v) {
  if (v === null || v === undefined || v === '') return '';
  // Local calendar day, not UTC: an offering made at eleven at night is made
  // that day, and the day count reads the same clock.
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : local(v);
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : local(d);
}

export function emptyWealth() {
  return {
    currency: 'Mana', baseline: null, current: 0,
    oathOfOfferings: false, materialCasting: false,
    lastOffering: '', manaPerDay: 0, sessionMana: 0, ledger: [],
  };
}

export function normalizeWealth(w) {
  const src = w && typeof w === 'object' ? w : {};
  const e = emptyWealth();
  const ledger = (Array.isArray(src.ledger) ? src.ledger : []).map((l) => ({
    date: isoDay(l?.date), label: String(l?.label ?? '').trim(),
    amount: Number(l?.amount) || 0,
    kind: WEALTH_KINDS.includes(l?.kind) ? l.kind : 'adjust',
  }));
  return {
    ...e,
    currency: String(src.currency || 'Mana'),
    baseline: numOrNull(src.baseline),
    // A workbook with a wallet label and no figure (Angou's) has a wallet at 0.
    current: numOrNull(src.current) ?? 0,
    oathOfOfferings: !!src.oathOfOfferings,
    materialCasting: !!src.materialCasting,
    lastOffering: isoDay(src.lastOffering),
    manaPerDay: numOrNull(src.manaPerDay) ?? 0,
    // Read as `sessions` off the sheet and in documents saved before the rename.
    sessionMana: Math.max(0, numOrNull(src.sessionMana) ?? numOrNull(src.sessions) ?? 0),
    ledger,
  };
}

/** Whole days from `from` (YYYY-MM-DD) to `to`, as TODAY() - date counts them; 0 if unknown or in the future. */
function daysBetween(from, to) {
  if (!from) return 0;
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Complete months from `from` to `to`, as DATEDIF(..., "M") counts them. */
function monthsBetween(from, to) {
  if (!from) return 0;
  const y = +from.slice(0, 4);
  const m = +from.slice(5, 7) - 1;
  const d = +from.slice(8, 10);
  let months = (to.getFullYear() - y) * 12 + (to.getMonth() - m);
  if (to.getDate() < d) months -= 1;
  return Math.max(0, months);
}

/**
 * The wallet as it stands today: what the next offering will cost, part by
 * part, and what is left after it. `today` is injectable so a test does not
 * move with the calendar, and so is `casterLevel`, which the material-casting
 * upkeep is charged against: it is 10 a level every whole month, so the same
 * month costs a 4th-level caster 40 and a 15th-level one 150.
 */
export function wealthView(w, today = new Date(), casterLevel = 0) {
  const v = normalizeWealth(w);
  const cl = Math.max(0, Number(casterLevel) || 0);
  const offeringPerDay = v.manaPerDay / 2;
  const castingPerMonth = MATERIAL_CASTING_PER_LEVEL * cl;
  const days = daysBetween(v.lastOffering, today);
  const months = monthsBetween(v.lastOffering, today);
  const oath = v.oathOfOfferings ? days * offeringPerDay + Math.floor(v.sessionMana / 2) : 0;
  const casting = v.materialCasting ? months * castingPerMonth : 0;
  const expected = oath + casting;
  return {
    ...v,
    offeringPerDay, days, months, casterLevel: cl, castingPerMonth,
    expected: { oath, casting, total: expected },
    after: v.current - expected,
    gains: v.baseline === null ? null : v.current - v.baseline,
    due: v.oathOfOfferings || v.materialCasting,
  };
}

/* ------------------------------------------------------------------ *
 * Primordia techniques: the Technique List and AutoTechnique tabs.
 *
 * A technique is a recipe of spheres, talents and "other" features; its
 * complexity, DCs and SP cost fall out of how many of each it uses. The
 * workbook keeps every technique the character knows or is designing in one
 * column each of `techRef`, with the Technique List tab reading one of them by
 * name (HLOOKUP row by row) and the AutoTechnique tab being the same layout
 * typed by hand for a new one, with a Discord application built underneath.
 *
 * All three grids are read once, here, into `techniques`: the catalogue, the
 * name the list is open on, and the AutoTechnique draft. The grids are then
 * retired, so the block and the copy it came from cannot drift apart.
 *
 * The maths below is each tab's own. They agree on complexity, talents and the
 * DCs; they differ on effective complexity (Technique List applies the
 * Technique Prowess discount, AutoTechnique applies its Instant / Versatile /
 * Signature adjustments) and each is reproduced as written -- see
 * `techniqueStats`.
 * ------------------------------------------------------------------ */

/** How many of each slot the layout carries: five spheres, eight talent pairs, three saves, four description lines. */
export const TECHNIQUE_SLOTS = { spheres: 5, talents: 8, saves: 3, descriptions: 4 };

/** The statuses the workbook uses on `techRef`, for the Technique List's picker. */
export const TECHNIQUE_STATUSES = ['Known', 'Design Phase', 'Approved', 'Pending', 'Rejected'];

const pad = (arr, n, fill) => Array.from({ length: n }, (_, i) => arr?.[i] ?? (typeof fill === 'function' ? fill() : fill));
const cleanText = (v) => (v === null || v === undefined ? '' : String(v).trim());
const isFeatWord = (v) => cleanText(v).toLowerCase() === 'feat';

/** A technique with every slot present and empty. */
export function emptyTechnique() {
  return {
    name: '', prepend1: '', prepend2: '',
    combatSpheres: pad([], TECHNIQUE_SLOTS.spheres, ''),
    combatTalents: pad([], TECHNIQUE_SLOTS.talents, () => ({ sphere: '', talent: '' })),
    magicSpheres: pad([], TECHNIQUE_SLOTS.spheres, ''),
    magicTalents: pad([], TECHNIQUE_SLOTS.talents, () => ({ sphere: '', talent: '' })),
    others: pad([], TECHNIQUE_SLOTS.spheres, ''),
    otherFeatures: pad([], TECHNIQUE_SLOTS.talents, () => ({ sphere: '', talent: '' })),
    craftingSkill: '', range: '', duration: '', target: '',
    saves: pad([], TECHNIQUE_SLOTS.saves, () => ({ save: '', type: '' })),
    spellResistance: '',
    descriptions: pad([], TECHNIQUE_SLOTS.descriptions, ''),
    extraSp: '', otherCost: '', subschool: '', status: '',
    // The AutoTechnique tab's crafting choices. Zero on a technique read off techRef.
    instantInitiation: false, versatile: 0, signature: false,
  };
}

/** Every slot present, every string trimmed, whatever shape a saved technique arrived in. */
export function normalizeTechnique(t) {
  const e = emptyTechnique();
  const src = t && typeof t === 'object' ? t : {};
  const pair = (p) => ({ sphere: cleanText(p?.sphere), talent: cleanText(p?.talent) });
  const savePair = (p) => ({ save: cleanText(p?.save), type: cleanText(p?.type) });
  return {
    ...e,
    name: cleanText(src.name), prepend1: cleanText(src.prepend1), prepend2: cleanText(src.prepend2),
    combatSpheres: pad(src.combatSpheres, TECHNIQUE_SLOTS.spheres, '').map(cleanText),
    combatTalents: pad(src.combatTalents, TECHNIQUE_SLOTS.talents, () => ({})).map(pair),
    magicSpheres: pad(src.magicSpheres, TECHNIQUE_SLOTS.spheres, '').map(cleanText),
    magicTalents: pad(src.magicTalents, TECHNIQUE_SLOTS.talents, () => ({})).map(pair),
    others: pad(src.others, TECHNIQUE_SLOTS.spheres, '').map(cleanText),
    otherFeatures: pad(src.otherFeatures, TECHNIQUE_SLOTS.talents, () => ({})).map(pair),
    craftingSkill: cleanText(src.craftingSkill), range: cleanText(src.range),
    duration: cleanText(src.duration), target: cleanText(src.target),
    saves: pad(src.saves, TECHNIQUE_SLOTS.saves, () => ({})).map(savePair),
    spellResistance: cleanText(src.spellResistance),
    descriptions: pad(src.descriptions, TECHNIQUE_SLOTS.descriptions, '').map(cleanText),
    extraSp: src.extraSp === '' || src.extraSp === null || src.extraSp === undefined ? '' : (Number(src.extraSp) || 0),
    otherCost: cleanText(src.otherCost), subschool: cleanText(src.subschool), status: cleanText(src.status),
    instantInitiation: !!src.instantInitiation && src.instantInitiation !== '0',
    versatile: Number(src.versatile) || 0,
    signature: !!src.signature && src.signature !== '0',
  };
}

/** "Nakano Style Counter - Wheelbreaker": what the workbook prints as the technique's full name. */
export function techniqueTitle(t) {
  const head = [t.prepend1, t.prepend2].filter(Boolean).join(' ');
  return head && t.name ? `${head} - ${t.name}` : head || t.name;
}

/**
 * Read `techRef`: one technique per column from C on, one field per row, the
 * field named in column A. Rows are found by that label, so a workbook whose
 * catalogue gained a row still reads. The status row is the one below
 * "Subschool" -- it carries no label of its own.
 */
function importTechniqueCatalogue(tab) {
  if (!tab) return [];
  const rows = positionedRows(tab);
  const byLabel = new Map();
  rows.forEach((row, ri) => {
    const label = cleanText(row.cells[0]);
    if (label && !byLabel.has(label)) byLabel.set(label, ri);
  });
  const rowOf = (label) => byLabel.get(label);
  const cell = (label, ci) => cleanText(rows[rowOf(label)]?.cells[ci]);
  const nameRow = rowOf('Technique Name');
  if (nameRow === undefined) return [];
  const statusRow = rowOf('Subschool') !== undefined ? rowOf('Subschool') + 1 : undefined;
  const width = Math.max(0, ...rows.map((r) => r.cells.length));

  const out = [];
  const seen = new Map();
  for (let ci = 2; ci < width; ci++) {
    let name = cleanText(rows[nameRow].cells[ci]);
    if (!name) continue;
    // Placeholder columns share a name ("???" nine times over); each keeps its
    // own entry, told apart by a suffix, rather than the later ones vanishing
    // behind the first when the list is looked up by name.
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    const t = emptyTechnique();
    t.name = name;
    t.prepend1 = cell('Technique Prepend 1', ci);
    t.prepend2 = cell('Technique Prepend 2', ci);
    for (let i = 0; i < TECHNIQUE_SLOTS.spheres; i++) {
      t.combatSpheres[i] = cell(`Combat Sphere ${i + 1}`, ci);
      t.magicSpheres[i] = cell(`Magic Sphere ${i + 1}`, ci);
      t.others[i] = cell(`Other ${i + 1}`, ci);
    }
    // Talent rows come in pairs: the odd one names the sphere, the even one the talent.
    for (let i = 0; i < TECHNIQUE_SLOTS.talents; i++) {
      t.combatTalents[i] = { sphere: cell(`Combat Talents ${2 * i + 1}`, ci), talent: cell(`Combat Talents ${2 * i + 2}`, ci) };
      t.magicTalents[i] = { sphere: cell(`Magic Talents ${2 * i + 1}`, ci), talent: cell(`Magic Talents ${2 * i + 2}`, ci) };
      t.otherFeatures[i] = { sphere: cell(`Other Features ${2 * i + 1}`, ci), talent: cell(`Other Features ${2 * i + 2}`, ci) };
    }
    t.craftingSkill = cell('Crafting Skill', ci);
    t.range = cell('Range', ci);
    t.duration = cell('Duration', ci);
    t.target = cell('Target', ci);
    for (let i = 0; i < TECHNIQUE_SLOTS.saves; i++) {
      t.saves[i] = { save: cell(`Saving Throw ${i + 1}`, ci), type: cell(`ST Type ${i + 1}`, ci) };
    }
    t.spellResistance = cell('Spell Resistance', ci);
    for (let i = 0; i < TECHNIQUE_SLOTS.descriptions; i++) t.descriptions[i] = cell(`Description ${i + 1}`, ci);
    const sp = cell('Extra SP', ci);
    t.extraSp = sp === '' ? '' : (Number(sp) || 0);
    t.otherCost = cell('Other Cost', ci);
    t.subschool = cell('Subschool', ci);
    t.status = statusRow === undefined ? '' : cleanText(rows[statusRow]?.cells[ci]);
    out.push(normalizeTechnique(t));
  }
  return out;
}

/**
 * Read a Technique List or AutoTechnique grid -- the same layout: labels down
 * column B, the technique's parts beside them, the talents to the right under
 * their sphere. Label-anchored, so a saved document that kept the grid without
 * its row numbers reads the same as a fresh conversion.
 */
function importTechniqueSheet(tab) {
  if (!tab) return null;
  const g = sheetReader(tab);
  const { rows, at, text, find } = g;
  const t = emptyTechnique();
  const rowAt = (label) => find(label)?.[0];
  const cellsAt = (label) => (rowAt(label) === undefined ? [] : rows[rowAt(label)]);
  const rightOfLabel = (label, cells) => {
    const i = cells.findIndex((v) => text(v) === label);
    return i < 0 ? '' : text(cells[i + 1]);
  };

  const nameRow = cellsAt('Technique Name');
  if (!nameRow.length) return null;
  t.prepend1 = text(nameRow[2]);
  // AutoTechnique allows a third prepend in E; fold it into the second.
  t.prepend2 = [text(nameRow[3]), text(nameRow[4])].filter(Boolean).join(' ');
  t.name = text(nameRow[5]);
  t.status = rightOfLabel('Approval Status', nameRow);
  t.subschool = rightOfLabel('Type', nameRow);

  const block = (sphereLabel, talentLabel, spheres, talents) => {
    const ri = rowAt(sphereLabel);
    if (ri === undefined) return;
    for (let i = 0; i < TECHNIQUE_SLOTS.spheres; i++) spheres[i] = text(at(ri, 2 + i));
    // Talent spheres sit on the sphere row from J (index 9); their talents on
    // the row below, headed by `talentLabel` at I.
    const tri = rows[ri + 1] && text(at(ri + 1, 8)) === talentLabel ? ri + 1 : rowAt(talentLabel);
    for (let i = 0; i < TECHNIQUE_SLOTS.talents; i++) {
      talents[i] = { sphere: text(at(ri, 9 + i)), talent: tri === undefined ? '' : text(at(tri, 9 + i)) };
    }
  };
  block('Combat Spheres', 'Combat Talents', t.combatSpheres, t.combatTalents);
  block('Magic Spheres', 'Magic Talents', t.magicSpheres, t.magicTalents);
  block('Other', 'Other Features', t.others, t.otherFeatures);

  const valueBeside = (label) => rightOfLabel(label, cellsAt(label));
  t.craftingSkill = valueBeside('Crafting Skill');
  t.range = valueBeside('Range');
  t.duration = valueBeside('Duration');
  t.target = valueBeside('Target');
  t.spellResistance = valueBeside('Spell Resistance');
  const saveRow = cellsAt('Saving Throw');
  const typeRow = cellsAt('Saving Throw Type');
  for (let i = 0; i < TECHNIQUE_SLOTS.saves; i++) t.saves[i] = { save: text(saveRow[2 + i]), type: text(typeRow[2 + i]) };
  for (let i = 0; i < TECHNIQUE_SLOTS.descriptions; i++) t.descriptions[i] = text(cellsAt(`Description ${i + 1}`)[2]);
  const sp = valueBeside('Other SP Cost');
  t.extraSp = sp === '' ? '' : (Number(sp) || 0);
  t.otherCost = valueBeside('Other Cost');
  // AutoTechnique's crafting choices; absent on the Technique List.
  const flag = (label) => { const v = valueBeside(label); return v !== '' && v !== '0' && v.toLowerCase() !== 'false'; };
  t.instantInitiation = flag('Instant Initiation');
  t.versatile = Number(valueBeside('Verstatile Technique') || valueBeside('Versatile Technique')) || 0;
  t.signature = flag('Signature Technique');
  return normalizeTechnique(t);
}

/**
 * The techniques block from the workbook's three grids. Absent grids read as
 * empty; a Technique List whose technique is not in the catalogue (the
 * catalogue was not captured, or the name was retyped) is added to it, so the
 * list opens on what the workbook showed.
 */
function importTechniques(refTab, listTab, autoTab) {
  const catalogue = importTechniqueCatalogue(refTab);
  const shown = importTechniqueSheet(listTab);
  const draft = importTechniqueSheet(autoTab) || emptyTechnique();
  let selected = '';
  if (shown?.name) {
    selected = shown.name;
    if (!catalogue.some((t) => t.name === shown.name)) catalogue.push(shown);
  }
  return { catalogue, selected, draft: normalizeTechnique(draft) };
}

/** Every technique with a name, and the draft, in a saveable shape. */
export function normalizeTechniques(block) {
  const src = block && typeof block === 'object' ? block : {};
  const catalogue = (Array.isArray(src.catalogue) ? src.catalogue : []).map(normalizeTechnique).filter((t) => t.name);
  const selected = catalogue.some((t) => t.name === src.selected) ? src.selected : (catalogue[0]?.name ?? '');
  return { catalogue, selected, draft: normalizeTechnique(src.draft) };
}

/** Distinct non-empty values, the way COUNTUNIQUE counts them (case-sensitive, trimmed). */
const uniqueCount = (values) => new Set(values.map(cleanText).filter(Boolean)).size;

/**
 * The numbers each tab derives from a technique, as its own formulas do.
 *
 *   base talents   distinct spheres and "other" entries, less any "Feat" among the others
 *   complexity     base, +(distinct - 2) once there are more than two, + every talent named
 *   crafting time  1 + complexity; effective time knocks a third off (rounded down)
 *   craft DC       5 + 5 x complexity;  decipher DC 20 + complexity;  learn DC 10 + 2 x complexity
 *   prowess        "Yes (Martial Focus …)" when the technique uses no magic sphere at all
 *   effective      list: with prowess, complexity - 1 - floor(BAB / 5) - Adept Initiator (floor 0),
 *                        else complexity - Adept Initiator
 *                  auto: complexity + Instant Initiation + Versatile - Signature - Adept Initiator (floor 0)
 *   total SP       effective + the technique's own extra SP
 *
 * `mode` is 'list' or 'auto' -- the two tabs' effective-complexity rules.
 */
export function techniqueStats(t, { bab = 0, adeptInitiator = 0 } = {}, mode = 'list') {
  const distinct = uniqueCount([...t.combatSpheres, ...t.magicSpheres, ...t.others]);
  const feats = t.others.filter(isFeatWord).length;
  const talentNames = [...t.combatTalents, ...t.magicTalents, ...t.otherFeatures].map((p) => p.talent);
  const talents = talentNames.filter((v) => cleanText(v)).length;
  const base = distinct - feats;
  const complexity = Math.max(0, base + (base > 2 ? distinct - 2 : 0) + talents);
  const suffix = base > 2 ? ` (+${distinct - 2 - feats})` : '';
  const baseText = `${base}${suffix}`;
  const totalText = `${uniqueCount(talentNames) + base}${suffix}`;

  const craftingTime = 1 + complexity;
  const effectiveTime = craftingTime - Math.floor(craftingTime / 3);
  const craftDC = 5 + 5 * complexity;
  const decipherDC = 20 + complexity;
  const learnDC = 10 + 2 * complexity;

  const prowess = t.magicSpheres.every((s) => !cleanText(s));
  const discount = 1 + Math.floor(bab / 5) + adeptInitiator;
  const prowessExtra = Math.max(complexity - discount, 0);
  const prowessText = prowess
    ? `Yes (Martial Focus${prowessExtra ? ` +${prowessExtra} SP` : ''})`
    : 'No';

  const effective = mode === 'auto'
    ? Math.max(0, complexity + (t.instantInitiation ? 1 : 0) + (Number(t.versatile) || 0)
      - (t.signature ? 1 : 0) - (adeptInitiator ? 1 : 0))
    : prowess ? Math.max(complexity - discount, 0) : complexity - adeptInitiator;
  const extraSp = Number(t.extraSp) || 0;

  return {
    distinct, feats, talents, base, baseText, totalText, complexity,
    craftingTime, effectiveTime, craftDC, decipherDC, learnDC,
    prowess, prowessText, prowessExtra, effective, extraSp, totalSp: effective + extraSp,
  };
}

/** "Open Hand Sphere (Mystic Fists, Godhand)" for each sphere the technique names, in order. */
export function techniquePrerequisites(t) {
  const lines = [];
  const group = (spheres, talents, suffix) => {
    for (const s of spheres) {
      const name = cleanText(s);
      if (!name || lines.some((l) => l.key === name)) continue;
      const own = talents.filter((p) => cleanText(p.sphere) === name && cleanText(p.talent)).map((p) => cleanText(p.talent));
      lines.push({ key: name, text: `${name}${suffix}${own.length ? ` (${own.join(', ')})` : ''}` });
    }
  };
  group(t.combatSpheres, t.combatTalents, ' Sphere');
  group(t.magicSpheres, t.magicTalents, ' Sphere');
  group(t.others, t.otherFeatures, '');
  return lines.map((l) => l.text);
}

/**
 * The Discord application the workbook builds under both tabs -- character
 * name, what is being applied for, and the technique in a code block. Same
 * text from either tab; the numbers are the tab's own (`mode`).
 */
export function techniqueExport(t, stats, { characterName = '' } = {}) {
  const title = techniqueTitle(t);
  const list = (spheres, talents, suffix) => {
    const parts = [];
    for (const s of spheres) {
      const name = cleanText(s);
      if (!name || parts.some((p) => p.startsWith(name))) continue;
      const own = talents.filter((p) => cleanText(p.sphere) === name && cleanText(p.talent)).map((p) => cleanText(p.talent));
      parts.push(`${name}${suffix}${own.length ? ` (${own.join(', ')})` : ''}`);
    }
    return parts.length ? parts.join('; ') : 'N/A';
  };
  const saves = t.saves.filter((p) => cleanText(p.save))
    .map((p) => `${cleanText(p.save)}${cleanText(p.type) ? ` ${cleanText(p.type)}` : ''}`);
  const skill = cleanText(t.craftingSkill);
  const cost = [`SP cost ${stats.complexity} (minimum 1)`];
  if (stats.extraSp) cost.push(`+${stats.extraSp} SP`);
  // A 0 typed in the Other Cost box is no cost, not a cost of nought.
  if (cleanText(t.otherCost) && cleanText(t.otherCost) !== '0') cost.push(cleanText(t.otherCost));
  const desc = t.descriptions.map(cleanText).filter(Boolean).join('\n');
  return [
    `**Character Name:** ${characterName}`,
    `**What Are you Applying for:** the **${title}** technique`,
    '```' + title + ' ',
    `- Combat Spheres: ${list(t.combatSpheres, t.combatTalents, '')}`,
    `- Magic Spheres: ${list(t.magicSpheres, t.magicTalents, '')}`,
    `- Other: ${list(t.others, t.otherFeatures, '')}`,
    `- Complexity: ${stats.complexity} (${stats.baseText} base talents, ${stats.totalText} talents total); ${cost.join(', ')}`,
    `- Crafting Time: ${stats.craftingTime} days; Craft DC ${stats.craftDC} ${skill}; Learn DC ${stats.learnDC} ${skill}, ${stats.complexity} hours; Decipher DC ${stats.decipherDC} ${skill}`,
    `- Range: ${cleanText(t.range)}`,
    `- Target: ${cleanText(t.target)}`,
    `- Duration: ${cleanText(t.duration)}`,
    `- Saving Throw: ${saves.length ? saves.join(', ') : 'none'}; Spell Resistance ${cleanText(t.spellResistance)}`,
    `- Prerequisites: ${techniquePrerequisites(t).join(', ')} `,
    `- Description: ${desc}` + '```',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Auto-Cooking: the Iron Chef dish maker.
 *
 * An iron chef's meal is two entrees, three flavors, two side dishes, an aroma
 * and a garnish; each ingredient grants the diners an effect whose numbers
 * scale with the chef's level, and some strengthen each other (a Red Meat
 * entree adds to the Strength a side of Apples grants; Rice makes the recipe
 * count as three levels higher). The ingredient list and every effect's
 * formula live in the Iron Chef extension pack (`data/extensions/iron-chef-ingredients.json`) -- shared rules, not character data --
 * so any character can show the tab and cook with a chef's level typed in.
 * The character's own tab keeps the dish it last built.
 *
 * Effects are templates: `{expr}` inside the text is a formula evaluated in a
 * scope of the chef's level and how many of each ingredient the dish uses --
 * `level`, `rice`, `spicy`, `sweet`, `sour`, `avocados`, `redMeat`,
 * `mycoprotein`, `fish`, `fowl` -- exactly the counts the workbook's own
 * COUNTIFs read.
 * ------------------------------------------------------------------ */

export const COOKING_COURSES = [
  ['entrees', 'Entrees', 2],
  ['flavors', 'Flavors', 3],
  ['sides', 'Side Dishes', 2],
  ['aroma', 'Aroma', 1],
  ['garnish', 'Garnish', 1],
];

let COOKING_TABLES = { durationHours: 'floor(level / 3) + 1', entrees: [], flavors: [], sides: [], aroma: [], garnish: [] };

/** Register the shared ingredient list. Call before constructing a Character. */
export function setCookingTables(doc) {
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => ({
    name: String(x?.name || ''), effect: String(x?.effect || ''), combo: String(x?.combo || ''),
  })).filter((x) => x.name);
  COOKING_TABLES = {
    durationHours: String(doc?.durationHours || 'floor(level / 3) + 1'),
    entrees: list(doc?.entrees), flavors: list(doc?.flavors), sides: list(doc?.sides),
    aroma: list(doc?.aroma), garnish: list(doc?.garnish),
  };
}

export function cookingTables() {
  return COOKING_TABLES;
}

/** A dish with nothing on it. */
export function emptyDish() {
  const d = { level: null, chef: '', dishName: '' };
  for (const [key, , slots] of COOKING_COURSES) d[key] = pad([], slots, '');
  return d;
}

export function normalizeDish(dish) {
  const src = dish && typeof dish === 'object' ? dish : {};
  const d = emptyDish();
  d.level = src.level === null || src.level === undefined || src.level === '' ? null : (Number(src.level) || 0);
  d.chef = cleanText(src.chef);
  d.dishName = cleanText(src.dishName);
  for (const [key, , slots] of COOKING_COURSES) d[key] = pad(src[key], slots, '').map(cleanText);
  return d;
}

/**
 * Read the workbook's Auto-Cooking tab: the chef's level in B1 and the dish
 * beside the course labels (Entrees C:D, Flavors C:E, Side Dishes C:D, Aroma
 * C with the Garnish label and value further along the same row).
 */
function importCooking(tab) {
  const d = emptyDish();
  if (!tab) return d;
  const g = sheetReader(tab);
  const { rows, text, find } = g;
  const first = rows[0] || [];
  const lvl = Number(first[1]);
  d.level = Number.isFinite(lvl) && text(first[1]) !== '' ? lvl : null;
  const cellsAt = (label) => { const hit = find(label); return hit ? rows[hit[0]] : []; };
  const after = (cells, label, n) => {
    const i = cells.findIndex((v) => text(v) === label);
    return i < 0 ? [] : cells.slice(i + 1, i + 1 + n).map(text);
  };
  for (const [key, label, slots] of COOKING_COURSES) {
    const cells = cellsAt(label);
    if (!cells.length) continue;
    // Aroma and Garnish share a row: "Aroma | Fetid | Garnish | Ginger".
    const vals = after(cells, label, key === 'aroma' ? 1 : key === 'garnish' ? 1 : slots)
      .filter((v) => !COOKING_COURSES.some(([, l]) => l === v));
    d[key] = pad(vals, slots, '');
  }
  return normalizeDish(d);
}

/** How many of each ingredient the dish uses, plus the level, for the effect templates. */
function cookingScope(dish, level) {
  const count = (course, name) => dish[course].filter((v) => v.toLowerCase() === name).length;
  return {
    level,
    rice: count('sides', 'rice'),
    avocados: count('sides', 'avocados'),
    spicy: count('flavors', 'spicy'),
    sweet: count('flavors', 'sweet'),
    sour: count('flavors', 'sour'),
    salty: count('flavors', 'salty'),
    savory: count('flavors', 'savory'),
    redMeat: count('entrees', 'red meat'),
    mycoprotein: count('entrees', 'mycoprotein'),
    fish: count('entrees', 'fish'),
    fowl: count('entrees', 'fowl'),
  };
}

/** Fill a template's `{expr}` holes from a scope; a bad formula shows as its own text. */
function fillTemplate(template, scope) {
  return String(template || '').replace(/\{([^{}]+)\}/g, (_, expr) => {
    try {
      const v = evaluateFormula(expr.trim(), scope);
      return v === null || v === undefined ? '' : String(v);
    } catch {
      return `{${expr}}`;
    }
  });
}

/**
 * The dish as it lands on the table: duration, and every ingredient's effect
 * with the numbers worked out for this chef and this combination.
 */
export function cookingDish(dish, { level = 0, characterName = '' } = {}) {
  const d = normalizeDish(dish);
  const lvl = d.level === null ? Number(level) || 0 : d.level;
  const scope = cookingScope(d, lvl);
  const hours = (() => { try { return Number(evaluateFormula(COOKING_TABLES.durationHours, scope)) || 0; } catch { return 0; } })();
  const effects = [];
  for (const [key, course] of COOKING_COURSES) {
    for (const name of d[key]) {
      if (!name) continue;
      const entry = COOKING_TABLES[key].find((x) => x.name.toLowerCase() === name.toLowerCase());
      effects.push({
        course, name,
        text: entry ? fillTemplate(entry.effect, scope) : '',
        combo: entry?.combo || '',
        unknown: !entry,
      });
    }
  }
  return {
    level: lvl, chef: d.chef || characterName, dishName: d.dishName, hours, scope, effects,
    courses: COOKING_COURSES.map(([key, label]) => ({ key, label, picks: d[key].filter(Boolean) })),
  };
}

/** The dish as a Discord post: what is in it, how long it lasts, and each effect as a bullet. */
export function cookingExport(view) {
  const head = view.dishName ? `**${view.dishName}**` : '**Iron Chef Dish**';
  const by = view.chef ? ` — cooked by ${view.chef}` : '';
  const lines = [
    `${head}${by} (iron chef level ${view.level})`,
    view.courses.filter((c) => c.picks.length).map((c) => `${c.label}: ${c.picks.join(', ')}`).join(' · '),
    `Duration: ${view.hours} Hours`,
    ...view.effects.map((e) => `• ${e.text || `${e.name} (no rule text)`}`),
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Read the workbook's Template tab into the groups this tab now edits.
 *
 * The template lays a feature out as a name with a "Type:" marker three
 * columns to its right and its description in the rows below, and repeats that
 * down as many columns as the player added -- Bryva's second column of
 * features sits at L because that is where she put it. So the columns are
 * found by that marker rather than by address, and everything from one feature
 * to the next belongs to it: further rows are more description, and a run of
 * rows using more than one column is a table.
 */
function importTemplateTab(tab, tabName) {
  const g = sheetReader({ rows: positionedRows(tab) });
  const { at, text, mark, isUsed } = g;

  // The link rows are the tab's own header: a label, the link beside it and
  // the instructions the workbook prints further along, identical on every
  // sheet. The whole row is consumed rather than left over as a stray.
  const links = { link: null, approvalLink: null };
  for (const [label, key] of [['Template Link', 'link'], ['Approval Link', 'approvalLink']]) {
    const hit = g.find(label);
    if (!hit) continue;
    const [ri, ci] = hit;
    links[key] = text(at(ri, ci + 1)) || null;
    (g.rows[ri] || []).forEach((_, c) => mark(ri, c));
  }

  // A "Type:" marker means a feature slot, filled in or not, so the empty ones
  // an untouched template carries are consumed here and import as nothing.
  const cols = new Set();
  for (const [ri, ci] of g.findAll(TEMPLATE_TYPE_LABEL)) {
    if (ci >= TEMPLATE_TYPE_OFFSET) cols.add(ci - TEMPLATE_TYPE_OFFSET);
    mark(ri, ci);
    mark(ri, ci + 1);
  }
  const columns = [...cols].sort((a, b) => a - b);
  const width = Math.max(0, ...g.rows.map((r) => r.length));

  const flat = [];
  columns.forEach((col, n) => {
    // A column's block runs to the next feature column, or to the far edge.
    const end = n + 1 < columns.length ? columns[n + 1] - 1 : Math.max(width - 1, col);
    const filled = (ri) => {
      const out = [];
      for (let ci = col; ci <= end; ci++) {
        if (!isUsed(ri, ci) && text(at(ri, ci)) !== '') out.push(ci);
      }
      return out;
    };
    const starts = (ri) => text(at(ri, col)) !== ''
      && text(at(ri, col + TEMPLATE_TYPE_OFFSET)) === TEMPLATE_TYPE_LABEL;

    let feature = null;
    let blank = true;
    for (let ri = 0; ri < g.rows.length; ri++) {
      const cells = filled(ri);
      // A typed slot always starts a feature; so does a lone heading after a
      // blank row, which is how a feature written without one reads.
      if (starts(ri) || (blank && cells.length === 1 && cells[0] === col)) {
        feature = {
          name: text(at(ri, col)),
          type: text(at(ri, col + TEMPLATE_TYPE_OFFSET + 1)) || null,
          text: '',
          tables: [],
          children: [],
        };
        flat.push(feature);
        mark(ri, col);
        blank = false;
        continue;
      }
      if (!cells.length) { blank = true; continue; }
      blank = false;
      if (feature && cells.length === 1 && cells[0] === col) {
        const line = text(at(ri, col));
        feature.text = feature.text ? `${feature.text}\n${line}` : line;
        mark(ri, col);
        continue;
      }
      // More than one column: a table, which belongs to the feature it sits
      // under. With no feature above it there is nothing to attach it to, so
      // it is left unclaimed and lands in the Temporary group instead.
      if (cells.length > 1 && feature) ri = readTemplateTable(g, feature, ri, filled, starts);
    }
  });

  const features = groupTemplateFeatures(flat);
  const extras = g.extras();
  if (extras.length) features.push(temporaryTemplateGroup(extras));

  if (!features.length && !links.link && !links.approvalLink) return null;
  return { tab: tabName, name: tabName, ...links, features };
}

/** One table, in the shape the editor addresses: a header row and rows. */
function templateTable(t = {}) {
  const columns = (Array.isArray(t.columns) ? t.columns : []).map((c) => (c ?? ''));
  const width = Math.max(columns.length,
    ...(Array.isArray(t.rows) ? t.rows : []).map((r) => (r?.cells || []).length), 1);
  while (columns.length < width) columns.push('');
  return {
    caption: String(t.caption ?? ''),
    columns,
    rows: (Array.isArray(t.rows) ? t.rows : []).map((r) => {
      const cells = [...(r?.cells || [])];
      while (cells.length < width) cells.push(null);
      return { cells };
    }),
  };
}

/** One feature or sub-ability, with the fields the editor expects present. */
function templateEntry(f = {}, nested = false) {
  const entry = {
    name: String(f.name ?? ''),
    type: f.type ?? null,
    text: String(f.text ?? ''),
    tables: (Array.isArray(f.tables) ? f.tables : []).map(templateTable),
  };
  if (f.temporary) entry.temporary = true;
  if (!nested) {
    entry.children = (Array.isArray(f.children) ? f.children : [])
      .map((c) => templateEntry(c, true));
  }
  return entry;
}

export class Character {
  /** @param {object} data  a document produced by tools/convert.py */
  constructor(data) {
    this.data = structuredClone(data);
    this.listeners = new Set();

    // Values as the Google Sheet had them, kept for reconciliation and for the
    // "differs from source sheet" indicator.
    this.imported = {};
    for (const d of DERIVED) this.imported[d.key] = Number(getPath(this.data, d.key) ?? 0);
    this.imported['initiative'] = Number(this.data.hp?.initiative ?? 0);

    this.offsets = {};
    this.#normalise();
    this.trackers = this.#loadTrackers();
    this.#reconcile();
    this.recompute();
  }

  /**
   * Reshape imported data into forms the editor can address by path.
   *
   * The converter emits feats as an object keyed by group name, but group
   * names contain spaces, slashes and dots, which cannot be used as path
   * segments. They become an ordered list instead, which also lets groups be
   * added, renamed and reordered.
   */
  #normalise() {
    const d = this.data;
    if (!Array.isArray(d.featGroups)) {
      d.featGroups = Object.entries(d.feats || {}).map(([name, entries]) => ({
        name,
        entries: (entries || []).map((e) => ({ name: e.name ?? '', detail: e.detail ?? '' })),
      }));
    }
    delete d.feats;

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
    if (d.mythic.bonusHpPerTier === undefined) d.mythic.bonusHpPerTier = 0;
    if (!d.mythic.tradition) d.mythic.tradition = {};
    for (const k of ['drawback1', 'drawback2', 'drawback3', 'quality', 'boon1', 'boon2', 'boon3']) {
      if (d.mythic.tradition[k] === undefined) d.mythic.tradition[k] = null;
    }
    /*
     * The mythic ladder is ten tiers, one row each: a feat on the odd ones, a
     * path power plus the +2 ability increase on the even ones. The sheet's
     * column is already in that order, so a row's position is its tier -- kept
     * exactly ten long so every tier has somewhere to write.
     */
    if (!Array.isArray(d.mythic.abilities)) d.mythic.abilities = [];
    while (d.mythic.abilities.length < MYTHIC_TIERS.length) {
      d.mythic.abilities.push({ name: '', path: '', featChoice: '' });
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

  /* ---------------- change notification ---------------- */

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(detail) {
    for (const fn of this.listeners) fn(this, detail);
  }

  /* ---------------- derived-stat pipeline ---------------- */

  /**
   * The reconciliation offset of one derived stat -- everything the source
   * sheet added through formulas that did not survive the export (gear,
   * ABP, resistance bonuses, traits).
   */
  offsetOf(key) {
    return Number(this.offsets[key]) || 0;
  }

  /**
   * Edit that offset. It is the only place a flat AC or save bonus can go, so
   * it is a real field rather than hidden bookkeeping.
   *
   * Nothing extra is stored: the offset is recovered on load as
   * `savedTotal - computedFromVisibleParts`, so an edited one round-trips
   * through localStorage and Export JSON exactly as an imported one does.
   */
  setOffset(key, value) {
    if (!DERIVED.some((d) => d.key === key && d.reconcile)) return this;
    this.offsets[key] = Number(value) || 0;
    this.recompute();
    this.#emit({ type: 'set', path: `offset:${key}`, value });
    return this;
  }

  /** Compute the one-time offsets that make imported values reproduce exactly. */
  #reconcile() {
    this.#applyMythic();
    this.#refreshAbilities();
    this.#applyGestalt();
    // Before the offsets are measured, or every typed bonus would be counted
    // once in the offset and again in the compute.
    this.#resolveDefenceBonuses();
    for (const d of DERIVED) {
      if (!d.reconcile) continue;
      const bare = safe(() => d.compute(this.data), 0);
      const target = d.key === 'initiative'
        ? Number(this.data.hp?.initiative ?? 0)
        : Number(getPath(this.data, d.key) ?? 0);
      this.offsets[d.key] = target - bare;
    }
  }

  /**
   * Recompute ability scores from the Stats-tab build, when one is present.
   *
   * The ABP, array and Level/4 columns are not stored as free numbers: they are
   * folded from the Planner picks, counting only choices at or below the
   * character's current level (the Planner is a full 20-level plan, so a level
   * 15 character has picks recorded for levels they have not reached).
   */
  /** Mythic tier derives from level (with a manual override). */
  #applyMythic() {
    const m = this.data.mythic || (this.data.mythic = {});
    m.computedTier = tierAtLevel(this.data.identity?.level);
    this.data.identity.mythicTier = m.tierOverride ?? m.computedTier;
  }

  #refreshAbilities() {
    const build = this.data.statsBuild;
    if (build) {
      const level = Number(this.data.identity.level) || 0;
      const folded = foldPicks(this.data.progressionPicks, level);

      // Mythic ability picks: +2 at each even tier reached.
      const tier = Number(this.data.identity.mythicTier) || 0;
      folded.mythic = Object.fromEntries(ABILITIES.map((k) => [k, 0]));
      for (const p of this.data.mythicStatPicks || []) {
        if (Number(p.tier) > tier) continue;
        const k = String(p.ability || '').trim().toLowerCase().slice(0, 3);
        if (k in folded.mythic) folded.mythic[k] += MYTHIC_STAT_BONUS;
      }
      for (const key of ABILITIES) {
        const entry = build[key];
        if (!entry) continue;
        for (const k of BUILD_DERIVED_KEYS) entry[k] = folded[k][key];
        const r = resolveAbility(entry);
        entry.resolved = r;
        const a = this.data.abilities[key];
        if (a) {
          a.score = r.total;
          a.tempScore = r.tempTotal;
        }
      }
    }

    for (const key of ABILITIES) {
      const a = this.data.abilities[key];
      if (!a) continue;
      a.mod = abilityMod(a.score);
      // A blank temp score means "same as base".
      if (!a.tempScore) a.tempScore = a.score;
      a.totalMod = abilityMod(a.tempScore);
      a.checkMod = a.totalMod;
    }
  }

  /* ---------------- ability build ---------------- */

  get pointBuyTable() {
    const t = this.data.pointBuyTable;
    if (!t) return POINT_BUY_COST;
    // JSON object keys are strings; normalise back to numbers.
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [Number(k), Number(v)]));
  }

  /** Point-buy cost of one ability, and the total spend across all six. */
  pointBuySummary() {
    const table = this.pointBuyTable;
    const build = this.data.statsBuild;
    const per = {};
    let total = 0;
    for (const key of ABILITIES) {
      const score = build?.[key]?.pointBuy ?? 10;
      const cost = pointBuyCost(score, table);
      per[key] = cost;
      total += cost;
    }
    return { per, total, budget: this.data.pointBuyBudget ?? 30 };
  }

  /** Attunement can only be purchased at level 20 and above. */
  get attunementUnlocked() {
    return (Number(this.data.identity.level) || 0) >= ATTUNEMENT_MIN_LEVEL;
  }

  /** Edit one cell of the ability build. Derived columns are read-only. */
  setBuild(ability, key, value) {
    const entry = this.data.statsBuild?.[ability];
    if (!entry || BUILD_DERIVED_KEYS.includes(key)) return this;
    let v = Number(value) || 0;
    if (key === 'attunement') {
      // Attunement is on or off, worth +2, and only at level 20. Anything
      // truthy buys it, so a checkbox and an imported number both land right.
      v = this.attunementUnlocked && (value === true || v > 0) ? ATTUNEMENT_BONUS : 0;
    }
    entry[key] = v;
    this.recompute();
    return this;
  }

  /**
   * Assign a progression pick.
   * @param kind  'abp' | 'array' | 'level4'
   * @param level the level the choice is made at
   * @param slot  'mental'|'physical' for abp, 0-3 for array, ignored for level4
   */
  setPick(kind, level, slot, ability) {
    const picks = this.data.progressionPicks
      || (this.data.progressionPicks = { abp: [], array: [], level4: [] });
    const list = picks[kind] || (picks[kind] = []);
    let row = list.find((r) => r.level === level);
    const value = ability || null;

    if (kind === 'abp') {
      if (!row) { row = { level, mental: null, physical: null }; list.push(row); }
      row[slot] = value;
      // Levels 11 (mental) and 12 (physical) raise the ability chosen at 6 / 7
      // rather than offering a new choice, so they follow the source pick.
      for (const follower of abpFollowers(slot, level)) {
        let f = list.find((r) => r.level === follower);
        if (!f) { f = { level: follower, mental: null, physical: null }; list.push(f); }
        f[slot] = value;
      }
    } else if (kind === 'array') {
      if (!row) { row = { level, slots: [null, null, null, null] }; list.push(row); }
      row.slots[slot] = value;
    } else {
      if (!row) { row = { level, ability: null }; list.push(row); }
      row.ability = value;
    }

    list.sort((a, b) => a.level - b.level);
    this.recompute();
    return this;
  }

  /** Assign the mythic +2 for an even tier. */
  setMythicPick(tier, ability) {
    const list = this.data.mythicStatPicks || (this.data.mythicStatPicks = []);
    let row = list.find((r) => Number(r.tier) === Number(tier));
    if (!row) { row = { tier: Number(tier), ability: null }; list.push(row); }
    row.ability = ability || null;
    list.sort((a, b) => a.tier - b.tier);
    this.recompute();
    return this;
  }

  /* ---------------- progression ---------------- */

  setProgressionClass(level, track, className) {
    const row = this.data.progression?.levels?.[level - 1];
    if (!row) return this;
    while (row.classes.length < this.data.progression.tracks) row.classes.push(null);
    row.classes[track] = className || null;
    this.recompute();
    return this;
  }

  /**
   * Put one class on every level of a track, or clear the track.
   *
   * A single-classed track is twenty identical dropdowns, and a gestalt sheet
   * has two or three of them: the common case for this table is "this side is
   * Fighter the whole way", and it should not take twenty clicks to say so.
   */
  fillProgressionTrack(track, className) {
    const p = this.data.progression;
    if (!p || track < 0 || track >= p.tracks) return this;
    const value = className ? String(className) : null;
    for (const row of p.levels || []) {
      while (row.classes.length < p.tracks) row.classes.push(null);
      row.classes[track] = value;
    }
    this.recompute();
    return this;
  }

  addProgressionTrack() {
    const p = this.data.progression;
    if (!p) return this;
    p.tracks += 1;
    this.recompute();
    return this;
  }

  /** Delete a class track; feature text is keyed by class name, so it survives. */
  removeProgressionTrack(index) {
    const p = this.data.progression;
    if (!p || p.tracks <= 1 || index < 0 || index >= p.tracks) return this;
    p.tracks -= 1;
    for (const row of p.levels) {
      if (row.classes.length > index) row.classes.splice(index, 1);
    }
    this.recompute();
    return this;
  }

  /** Every class named anywhere in the progression, in first-appearance order. */
  progressionClasses() {
    const out = [];
    for (const row of this.data.progression?.levels || []) {
      for (const n of row.classes || []) {
        if (n && !out.includes(n)) out.push(n);
      }
    }
    return out;
  }

  /** The levels at which a class appears. */
  classLevelsIn(className) {
    return (this.data.progression?.levels || [])
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
  classLevelCount(className) {
    const match = closestName(className, this.progressionClasses());
    if (!match) return 0;
    const cap = Number(this.data.identity?.level) || 20;
    return this.classLevelsIn(match).filter((lvl) => lvl <= cap).length;
  }

  #featureGroup(className) {
    const p = this.data.progression;
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
  #classLevelAt(className, level) {
    const levels = className === 'General'
      ? (this.data.progression?.levels || []).map((r) => r.level)
      : this.classLevelsIn(className);
    const i = levels.indexOf(Number(level));
    return i === -1 ? Number(level) : i + 1;
  }

  /** The rule groups granting in a column at a level, in declaration order. */
  #grantingGroups(className, column, level) {
    const groups = this.data.progression?.classFeatures?.[className]?.rules?.[column] || [];
    if (!groups.length) return [];
    const classLevel = this.#classLevelAt(className, level);
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
  setClassFeature(className, level, column, text, key = null) {
    const g = this.#featureGroup(className);
    if (!g) return this;
    if (!g.columns.includes(column)) g.columns.push(column);
    const row = (g.byLevel[level] ||= {});

    if (key == null) {
      row[column] = text;
      this.recompute();
      return this;
    }

    const granting = this.#grantingGroups(className, column, level);
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
    this.recompute();
    return this;
  }

  /** `at` puts the column back where it was, which is what restoring one wants. */
  addClassFeatureColumn(className, name, at = null) {
    const g = this.#featureGroup(className);
    if (!g || !name || g.columns.includes(name)) return this;
    if (at === null || at < 0 || at > g.columns.length) g.columns.push(name);
    else g.columns.splice(at, 0, name);
    this.recompute();
    return this;
  }

  renameClassFeatureColumn(className, index, name) {
    const g = this.#featureGroup(className);
    const old = g?.columns?.[index];
    if (!g || old === undefined || !name || name === old || g.columns.includes(name)) return this;
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
    const widths = this.data.uiPrefs?.colWidths?.[`progfeat-${className}`];
    if (widths && widths[old] !== undefined) {
      widths[name] = widths[old];
      delete widths[old];
    }
    this.recompute();
    return this;
  }

  /**
   * The rule groups sharing a feature column, as {name, rule, color}.
   *
   * A column may carry several: a kineticist's one Wild Talent column holds
   * Infusions on odd levels and Utility talents on even ones, each with its
   * own colour, rather than being split in two.
   */
  classFeatureRuleGroups(className, column) {
    return this.data.progression?.classFeatures?.[className]?.rules?.[column] || [];
  }

  addClassFeatureRuleGroup(className, index, { name = '', rule = '', color = null } = {}) {
    const g = this.#featureGroup(className);
    const col = g?.columns?.[index];
    if (!g || col === undefined) return this;
    const list = (g.rules[col] ||= []);
    list.push({
      name: String(name).trim(),
      rule: String(rule).trim(),
      color: normalizeHex(color) || FEATURE_GROUP_COLORS[list.length % FEATURE_GROUP_COLORS.length],
    });
    this.recompute();
    return this;
  }

  /**
   * Edit one group. Typing the braced form "{Infusions, odd, -5}" into either
   * text field fills both, since that is how a group reads written out.
   */
  setClassFeatureRuleGroup(className, index, groupIndex, patch = {}) {
    const g = this.#featureGroup(className);
    const col = g?.columns?.[index];
    const group = g?.rules?.[col]?.[groupIndex];
    if (!group) return this;

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
    if (!group.name && !group.rule && !group.optionsFrom) return this.removeClassFeatureRuleGroup(className, index, groupIndex);
    this.recompute();
    return this;
  }

  removeClassFeatureRuleGroup(className, index, groupIndex) {
    const g = this.#featureGroup(className);
    const col = g?.columns?.[index];
    const list = g?.rules?.[col];
    if (!list?.[groupIndex]) return this;
    list.splice(groupIndex, 1);
    if (!list.length) delete g.rules[col];
    this.recompute();
    return this;
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
  classFeatureNotes(className) {
    return this.data.progression?.classFeatures?.[className]?.notes || [];
  }

  addClassFeatureNote(className, { name, type = null, text = '' } = {}) {
    const g = this.#featureGroup(className);
    const n = String(name ?? '').trim();
    if (!g || !n) return this;
    if (!Array.isArray(g.notes)) g.notes = [];
    if (g.notes.some((x) => normalizeName(x.name) === normalizeName(n))) return this;
    g.notes.push({ name: n, type: TEMPLATE_TYPES.includes(type) ? type : null, text: String(text ?? '') });
    this.recompute();
    return this;
  }

  setClassFeatureNote(className, index, patch = {}) {
    const note = this.#featureGroup(className)?.notes?.[index];
    if (!note) return this;
    if (patch.name !== undefined) note.name = String(patch.name);
    if (patch.text !== undefined) note.text = String(patch.text);
    if (patch.type !== undefined) note.type = TEMPLATE_TYPES.includes(patch.type) ? patch.type : null;
    this.recompute();
    return this;
  }

  removeClassFeatureNote(className, index) {
    const notes = this.#featureGroup(className)?.notes;
    if (!notes?.[index]) return this;
    notes.splice(index, 1);
    this.recompute();
    return this;
  }

  /**
   * Point a whole column at a menu, by catalogue name. Every group in it picks
   * from that menu unless the group names one of its own. Empty text clears it.
   */
  setClassFeatureColumnOptions(className, index, catalogue) {
    const g = this.#featureGroup(className);
    const col = g?.columns?.[index];
    if (!g || col === undefined) return this;
    const list = (Array.isArray(catalogue) ? catalogue : [catalogue])
      .map((s) => String(s ?? '').trim()).filter(Boolean);
    // One menu is stored as the name itself; several as the list they are; and
    // none as the empty list, which is the player saying so rather than saying
    // nothing -- a pack's own claim on the column does not come back over it.
    g.optionsFrom[col] = list.length === 1 ? list[0] : list;
    this.recompute();
    return this;
  }

  /**
   * The menus a column picks from, in the order they layer.
   *
   * Nothing recorded means the packs decide: a menu that names this class and
   * this feature is what the column is for. An empty list recorded means the
   * player said no menu, which no pack then overrides.
   */
  classFeatureColumnOptions(className, column) {
    const v = this.data.progression?.classFeatures?.[className]?.optionsFrom?.[column];
    if (v === undefined) {
      const auto = optionCatalogueFor(className, column);
      return auto ? [auto.name] : [];
    }
    return Array.isArray(v) ? [...v] : (v ? [v] : []);
  }

  /** Did the player name the column's menu, or did a pack claim it? */
  classFeatureColumnOptionsChosen(className, column) {
    return this.data.progression?.classFeatures?.[className]?.optionsFrom?.[column] !== undefined;
  }

  /**
   * Layer another menu onto a column, or take it off again.
   *
   * This is how an archetype's own menu joins the class's: it goes on the end,
   * so its entries win and the ones its text replaces drop out, and removing
   * the archetype is taking the name off the list again.
   */
  addClassFeatureColumnOptions(className, column, catalogue) {
    const g = this.#featureGroup(className);
    const index = (g?.columns || []).indexOf(column);
    const name = String(catalogue ?? '').trim();
    if (index === -1 || !name) return this;
    const list = this.classFeatureColumnOptions(className, column)
      .filter((n) => n.toLowerCase() !== name.toLowerCase());
    return this.setClassFeatureColumnOptions(className, index, [...list, name]);
  }

  removeClassFeatureColumnOptions(className, column, catalogue) {
    const g = this.#featureGroup(className);
    const index = (g?.columns || []).indexOf(column);
    const name = String(catalogue ?? '').trim();
    if (index === -1 || !name) return this;
    const list = this.classFeatureColumnOptions(className, column)
      .filter((n) => n.toLowerCase() !== name.toLowerCase());
    return this.setClassFeatureColumnOptions(className, index, list);
  }

  /**
   * Set a column's whole rule from one string: the single-group shorthand.
   * Empty text clears every group, so the column grants at every level again.
   */
  setClassFeatureColumnRule(className, index, source) {
    const g = this.#featureGroup(className);
    const col = g?.columns?.[index];
    if (!g || col === undefined) return this;
    const text = String(source ?? '').trim();
    if (!text) { delete g.rules[col]; this.recompute(); return this; }
    if (!g.rules[col]?.length) this.addClassFeatureRuleGroup(className, index);
    return this.setClassFeatureRuleGroup(className, index, 0, { rule: text });
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
  classFeatureRows(className) {
    const p = this.data.progression;
    const g = p?.classFeatures?.[className] || { columns: [], byLevel: {}, rules: {} };
    const columns = g.columns || [];
    const occupied = className === 'General'
      ? (p?.levels || []).map((r) => r.level)
      : this.classLevelsIn(className);
    // A group whose class has left the progression keeps the levels it holds
    // text for, so nothing it recorded goes out of view.
    const levels = occupied.length
      ? occupied
      : Object.keys(g.byLevel || {}).map(Number).sort((a, b) => a - b);
    const charLevel = Number(this.data.identity.level) || 0;

    // Parse each group's rule once for the whole column, not once per cell,
    // and resolve its menu once too -- the group's own, else the column's.
    const menuOf = (col, grp) => resolveOptionMenu(grp?.optionsFrom
      ? [grp.optionsFrom] : this.classFeatureColumnOptions(className, col));
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
  classFeatureDue(className) {
    const out = {};
    for (const row of this.classFeatureRows(className)) {
      for (const [col, cell] of Object.entries(row.cells)) {
        const n = cell.fields.filter((f) => f.due).length;
        if (n) out[col] = (out[col] || 0) + n;
      }
    }
    return out;
  }

  /** Persist a dragged column width (px) for a feature-group table. */
  setColumnWidth(tableKey, column, px) {
    const all = this.data.uiPrefs.colWidths || (this.data.uiPrefs.colWidths = {});
    (all[tableKey] ||= {})[column] = Math.round(px);
    this.recompute();
    return this;
  }

  removeClassFeatureColumn(className, index) {
    const g = this.#featureGroup(className);
    const name = g?.columns?.[index];
    if (!g || name === undefined) return this;
    g.columns.splice(index, 1);
    for (const row of Object.values(g.byLevel)) delete row[name];
    delete g.rules[name];
    delete g.optionsFrom[name];
    this.recompute();
    return this;
  }

  /**
   * Resolve the typed save and AC bonuses before anything reads them.
   *
   * A cell is a plain number or a formula in the tracker sandbox, which is what
   * lets a conditional bonus be written as the rule it actually is -- Force
   * Redirection's `min(str.mod - dex.mod, 3 + floor(bab / 2))` rather than a
   * number that silently goes stale the next time BAB moves. Resolved values
   * land beside the source so the compute stays a plain sum, and a bad formula
   * contributes nothing rather than breaking the sheet.
   */
  #resolveDefenceBonuses() {
    // Ability modifiers and BAB are current by now; skills are not, and are
    // deliberately out of reach here -- a skill's own bonus can read AC.
    const scope = this.scope();
    const resolve = (block, types, errors) => {
      const out = {};
      for (const [key] of types) {
        const raw = block?.[key];
        if (typeof raw !== 'string' || raw.trim() === '') {
          out[key] = Number(raw) || 0;
          continue;
        }
        try {
          out[key] = Math.trunc(Number(evaluateFormula(raw, scope)) || 0);
        } catch (err) {
          out[key] = 0;
          errors[key] = err.message;
        }
      }
      return out;
    };

    // The three ABP defence bonuses follow the character's level along the
    // progression's own ladder; they are read, not typed.
    const abp = abpDefence(this.data.identity?.level);
    for (const key of ['fortitude', 'reflex', 'will']) {
      const save = this.data.saves?.[key];
      if (!save) continue;
      if (save.bonuses) save.bonuses.abpResistance = abp.abpResistance;
      save.bonusErrors = {};
      save.bonusesResolved = resolve(save.bonuses, SAVE_BONUS_TYPES, save.bonusErrors);
    }
    const d = this.data.defenses;
    if (d) {
      if (d.acBonuses) {
        d.acBonuses.abpDeflection = abp.abpDeflection;
        d.acBonuses.abpNatural = abp.abpNatural;
      }
      d.acBonusErrors = {};
      d.acBonusesResolved = resolve(d.acBonuses, AC_BONUS_TYPES, d.acBonusErrors);
    }
  }

  /** Recompute every derived value. Cheap enough to run on each keystroke. */
  recompute() {
    const c = this.data;
    this.#applyMythic();
    this.#refreshAbilities();
    this.#applyGestalt();
    this.#resolveDefenceBonuses();

    for (const d of DERIVED) {
      const value = safe(() => d.compute(c), 0) + (this.offsets[d.key] || 0);
      if (d.key === 'initiative') c.hp.initiative = value;
      else setPath(c, d.key, value);
    }

    c.attack.iterative = iterativeAttacks(c.attack.bab);

    // Carry capacity follows Strength, size, Ant Haul and quadruped status.
    const tiers = carryTiers(c.abilities.str.tempScore + (c.carry?.strBonus || 0), {
      multiplier: SIZE_CARRY_MULTIPLIER[c.identity.size] ?? 1,
      antHaul: c.carry?.antHaul || 1,
      quadruped: !!c.carry?.quadruped,
    });
    c.carry = { ...c.carry, ...tiers };

    this.#recomputeSpeeds();
    this.#recomputeTraining();

    // Skills: total ranks from their sources, then the bonus.
    // totalRanks = MIN(level, bought + (specialty+gear+other)*level + spheres)
    const level = Number(c.identity.level) || 0;
    const specialtyKeys = new Set(Object.values(c.specialtySkills || {}).filter(Boolean));
    const sphereRanksBySkill = this.#sphereRanksBySkill();

    // Inline names ({skill_familiarity = …}) resolve before skill misc so a
    // misc formula can read them. Their scope has no skill totals yet, which
    // is intended: skills may read names, names may not read skills, so no
    // cycle can form between the two.
    this.#resolveInlineNames();
    const miscScope = this.scope();

    c.skills.forEach((s, i) => {
      const primary = (s.abilities || [])[0];
      const am = statMod(c, primary, null);
      const src = s.rankSources || { bought: 0, gear: false, other: false };
      const specialty = specialtyKeys.has(skillKey(s));
      const spheres = sphereRanksBySkill.has(i)
        ? sphereRanksBySkill.get(i)
        : (Number(s.importedSphereRanks) || 0);

      // Bought ranks accept a plain number or a level-derived formula
      // ("level", "floor(level - 2)"), evaluated in the same sandbox as
      // the trackers.
      let bought = 0;
      s.boughtError = null;
      if (typeof src.bought === 'string' && src.bought.trim() !== '') {
        try {
          bought = Math.max(0, Math.floor(Number(evaluateFormula(src.bought, { level })) || 0));
        } catch (err) {
          s.boughtError = err.message;
        }
      } else {
        bought = Number(src.bought) || 0;
      }
      s.boughtResolved = bought;

      const flags = (specialty ? 1 : 0) + (src.gear ? 1 : 0) + (src.other ? 1 : 0);
      const capped = Math.min(level, bought + flags * level + spheres);
      if (s.ranksOffset === undefined) {
        s.ranksOffset = (Number(s.totalRanks) || 0) - capped;
      }
      s.specialtyFlag = specialty;
      s.sphereRanks = spheres;
      s.totalRanks = capped + s.ranksOffset;

      const computed = skillTotal({
        ranks: s.totalRanks,
        classSkill: !!s.classSkill,
        abilityMod: am,
        misc: 0,
        acp: s.armorPenalty ? armorParts(c).acp : 0,
      });
      if (s.importedBonus === undefined) {
        s.importedBonus = Number(s.bonus) || 0;
        s.offset = s.importedBonus - computed;
      }

      // Misc accepts an integer or a formula ("int.mod", "skill_familiarity",
      // "floor(level/2)") reading abilities, level and inline names.
      s.miscError = null;
      let misc = 0;
      if (typeof s.offset === 'string' && s.offset.trim() !== '') {
        try {
          const v = evaluateFormula(s.offset, miscScope);
          misc = Math.floor(Number(v) || 0);
        } catch (err) {
          s.miscError = err.message;
        }
      } else {
        misc = Number(s.offset) || 0;
      }
      s.miscResolved = misc;
      s.bonus = computed + misc;
      s.abilityMod = am;
    });

    this.#applyBudget();
    this.#recomputeLanguages();
    this.#recomputeSphereRows();
    this.#recomputeEquipment();
    this.#recomputeCrafting();
    this.#recomputeAkashic();
    this.#recomputeManeuvers();
    this.#recomputeVancian();
    this.#recomputePsionics();
    this.#recomputeCardcasting();
    // Last of the systems: its prerequisite check reads the casting types the
    // training pass works out and the casting classes the Vancian one names.
    this.#recomputePrimordia();
    this.#recomputeCompanions();
    this.#recomputeTrackers();
    // After the trackers and sub-systems, so a buff's formula can read them
    // ("1 + essence.shoulder" follows the essence as it is re-invested).
    this.#recomputeBuffs();
    this.#emit({ type: 'recompute' });
    return this;
  }

  /* ---------------- companions ---------------- */

  /**
   * The master's side of a companion's sums: level, BAB, hit points, base
   * saves, skill ranks by name and levels in a class. All of it is read off
   * what the passes above have already worked out.
   */
  #companionMaster() {
    const c = this.data;
    const ranksOf = (name, spec = '') => {
      const want = String(name || '').trim().toLowerCase();
      const wantSpec = String(spec || '').trim().toLowerCase();
      let best = 0;
      for (const s of c.skills || []) {
        if (String(s.name || '').trim().toLowerCase() !== want) continue;
        if (wantSpec && String(s.spec || '').trim().toLowerCase() !== wantSpec) continue;
        best = Math.max(best, Number(s.totalRanks) || 0);
      }
      return best;
    };
    return {
      level: Number(c.identity?.level) || 0,
      bab: Number(c.attack?.bab) || 0,
      hp: (Number(c.hp?.total) || 0) + (Number(this.mythicHp) || 0),
      baseSaves: {
        fort: Number(c.saves?.fortitude?.base) || 0,
        ref: Number(c.saves?.reflex?.base) || 0,
        will: Number(c.saves?.will?.base) || 0,
      },
      skillRanks: ranksOf,
      classLevelCount: (name) => this.classLevelCount(name),
    };
  }

  #recomputeCompanions() {
    const master = this.#companionMaster();
    for (const kind of COMPANION_KINDS) {
      const b = this.data[kind];
      if (!b) continue;
      const { calc, skills, attacks } = computeCompanion(kind, b, master);
      b.calc = calc;
      b.skills = skills;
      b.attacks = attacks;
    }
  }

  /** The companion takes damage (temporary points first), heals, or rests. */
  companionDamage(kind, amount) {
    const b = this.data[kind];
    if (!b) return this;
    let n = Math.max(0, Math.floor(Number(amount) || 0));
    const hp = b.hp || (b.hp = { damage: 0, temp: 0, bonus: 0 });
    const temp = Math.max(0, Number(hp.temp) || 0);
    const fromTemp = Math.min(temp, n);
    hp.temp = temp - fromTemp;
    n -= fromTemp;
    hp.damage = Math.max(0, (Number(hp.damage) || 0) + n);
    return this.recompute();
  }

  companionHeal(kind, amount) {
    const b = this.data[kind];
    if (!b) return this;
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    const hp = b.hp || (b.hp = { damage: 0, temp: 0, bonus: 0 });
    hp.damage = Math.max(0, (Number(hp.damage) || 0) - n);
    return this.recompute();
  }

  companionRest(kind) {
    const b = this.data[kind];
    if (!b) return this;
    b.hp = { ...(b.hp || {}), damage: 0, temp: 0 };
    return this.recompute();
  }

  /**
   * Update any field by path and recompute.
   * Used by every input in the UI, so it is the single write entry point.
   */
  set(path, value) {
    setPath(this.data, path, value);
    this.recompute();
    this.#emit({ type: 'set', path, value });
    return this;
  }

  /* ---------------- list editing ---------------- */

  /** Read an array at `path`, creating it if absent. */
  list(path) {
    let arr = getPath(this.data, path);
    if (!Array.isArray(arr)) {
      arr = [];
      setPath(this.data, path, arr);
    }
    return arr;
  }

  /** Append an item to a list section and return it. */
  listAdd(path, item = {}) {
    const arr = this.list(path);
    arr.push(item);
    this.recompute();
    this.#emit({ type: 'list-add', path, item });
    return item;
  }

  listRemove(path, index) {
    const arr = this.list(path);
    if (index < 0 || index >= arr.length) return this;
    const [removed] = arr.splice(index, 1);
    this.recompute();
    this.#emit({ type: 'list-remove', path, removed });
    return this;
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
  toggleProficiency(list, value) {
    const fixed = PROFICIENCY_LISTS[list];
    if (!fixed) return this;
    const canon = fixed.find((x) => x.toLowerCase() === String(value || '').toLowerCase());
    if (!canon) return this;
    const p = this.data.identity.proficiencies || (this.data.identity.proficiencies = blankProficiencies());
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
    this.recompute();
    this.#emit({ type: 'set', path: `identity.proficiencies.${list}`, value: p[list] });
    return this;
  }

  toggleManeuver(path, name, ready) {
    const d = getPath(this.data, path);
    if (!d) return this;
    const known = new Set(d.known || []);
    if (ready) known.add(name);
    else known.delete(name);
    d.known = [...known];
    this.recompute();
    this.#emit({ type: 'set', path: `${path}.known`, value: d.known });
    return this;
  }

  /**
   * The player's own line on a maneuver -- what the dashboard's Readied
   * maneuvers card says under the name. Prose, so {…} formulas resolve.
   * Keyed by the maneuver's name, because the rows themselves live in the
   * shared catalogue; an emptied note is removed rather than stored blank.
   */
  setManeuverNote(path, name, text) {
    const d = getPath(this.data, path);
    if (!d) return this;
    if (!d.notes || typeof d.notes !== 'object' || Array.isArray(d.notes)) d.notes = {};
    const t = String(text ?? '');
    if (t.trim()) d.notes[name] = t;
    else delete d.notes[name];
    this.recompute();
    this.#emit({ type: 'maneuver-note', path, name });
    return this;
  }

  /** Move an item within a list, for reordering rows. */
  listMove(path, index, delta) {
    const arr = this.list(path);
    const to = index + delta;
    if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return this;
    const [item] = arr.splice(index, 1);
    arr.splice(to, 0, item);
    this.recompute();
    return this;
  }

  /**
   * Move an item to a place in its own list, for dragging one row past
   * another. `to` is where the item should land counting the list as it is
   * now, so dropping "after the third" is 3 whether the item came from before
   * it or after; the shift a removal causes is taken off here rather than by
   * every caller.
   */
  listMoveTo(path, from, to) {
    const arr = this.list(path);
    if (from < 0 || from >= arr.length) return this;
    const target = Math.max(0, Math.min(arr.length - 1, to > from ? to - 1 : to));
    if (target === from) return this;
    const [item] = arr.splice(from, 1);
    arr.splice(target, 0, item);
    this.recompute();
    return this;
  }

  /**
   * Edit one field of one item in a list section.
   *
   * Some field names come from spreadsheet headers and can contain dots, so an
   * exact own-property match wins over treating the name as a path.
   */
  setItem(path, index, field, value) {
    const arr = this.list(path);
    if (arr[index] === undefined) return this;
    // A skill is identified by name and variant together, so renaming either
    // has to carry the specialty picks along or they silently detach.
    const renamingSkill = path === 'skills' && (field === 'name' || field === 'spec');
    const oldKey = renamingSkill ? skillKey(arr[index]) : null;
    if (field === 'self') {
      // Lists of plain strings (tradition drawbacks) replace the whole item.
      arr[index] = value;
    } else if (arr[index] === null || typeof arr[index] !== 'object') {
      return this;
    } else if (Object.prototype.hasOwnProperty.call(arr[index], field) || !String(field).includes('.')) {
      arr[index][field] = value;
    } else {
      setPath(arr[index], field, value);
    }
    if (renamingSkill) this.#renameSkill(arr[index], oldKey);
    this.recompute();
    this.#emit({ type: 'set-item', path, index, field, value });
    return this;
  }

  /**
   * Tidy a renamed skill and follow it wherever it was referred to by name.
   *
   * The variant is cleaned first -- a player who typed the whole thing,
   * "Craft (Weapons and Armor)", meant the variant -- and only then do the
   * specialty picks move to the new key.
   */
  #renameSkill(skill, oldKey) {
    skill.spec = cleanSkillVariant(skill.name, skill.spec) || null;
    const newKey = skillKey(skill);
    if (newKey === oldKey) return;
    const picks = this.data.specialtySkills || {};
    for (const slot of Object.keys(picks)) {
      if (picks[slot] === oldKey) picks[slot] = newKey;
    }
  }

  /* ---------------- template groups ---------------- */

  /**
   * Reorder a template's groups.
   *
   * `to` is the position the group should end up at, counted before the move,
   * which is what a drop between two cards means.
   */
  moveTemplateGroup(ti, from, to) {
    const groups = this.data.templates?.[ti]?.features;
    if (!Array.isArray(groups) || !groups[from]) return this;
    const target = Math.max(0, Math.min(groups.length - 1, to > from ? to - 1 : to));
    const [item] = groups.splice(from, 1);
    groups.splice(target, 0, item);
    this.recompute();
    this.#emit({ type: 'template-move', ti, from, to: target });
    return this;
  }

  /**
   * Move a sub-ability, within its group or into another one.
   *
   * A sub-ability belongs to a group, so a destination is a group and a
   * position inside it: there is no position here that would put one above the
   * feature it hangs off, which is the whole point of the group.
   */
  moveTemplateChild(ti, fromGroup, fromIndex, toGroup, toIndex) {
    const groups = this.data.templates?.[ti]?.features;
    const src = groups?.[fromGroup];
    const dst = groups?.[toGroup];
    if (!src || !dst || !Array.isArray(src.children) || !src.children[fromIndex]) return this;
    if (!Array.isArray(dst.children)) dst.children = [];
    const shift = src === dst && toIndex > fromIndex ? 1 : 0;
    const [item] = src.children.splice(fromIndex, 1);
    dst.children.splice(Math.max(0, Math.min(dst.children.length, toIndex - shift)), 0, item);
    this.recompute();
    this.#emit({ type: 'template-move', ti, fromGroup, fromIndex, toGroup });
    return this;
  }

  /**
   * ↑ / ↓ on a sub-ability, spilling into the neighbouring group at either
   * end -- the same moves the drag offers, for anyone not using a mouse.
   */
  nudgeTemplateChild(ti, gi, ci, delta) {
    const groups = this.data.templates?.[ti]?.features || [];
    const children = groups[gi]?.children || [];
    const to = ci + delta;
    if (to >= 0 && to < children.length) return this.moveTemplateChild(ti, gi, ci, gi, to);
    const nextGroup = gi + delta;
    if (nextGroup < 0 || nextGroup >= groups.length) return this;
    const landing = delta < 0 ? (groups[nextGroup].children || []).length : 0;
    return this.moveTemplateChild(ti, gi, ci, nextGroup, landing);
  }

  /**
   * Move a table from one feature to another.
   *
   * Where a table is drawn says which feature it is under, and on a spreadsheet
   * that is not always what it means: Bryva's spell-school table sits in the
   * right-hand column beside Temporal Haze but belongs to Omni-Cooking. The
   * import puts a table where it was written rather than guessing, and this is
   * how it gets where it should be -- without retyping eighty cells.
   *
   * `fromPath` and `toPath` address the features, not the tables.
   */
  moveTemplateTable(fromPath, index, toPath) {
    const from = getPath(this.data, fromPath);
    const to = getPath(this.data, toPath);
    if (!from || !to || fromPath === toPath) return this;
    if (!Array.isArray(from.tables) || !from.tables[index]) return this;
    if (!Array.isArray(to.tables)) to.tables = [];
    to.tables.push(from.tables.splice(index, 1)[0]);
    this.recompute();
    this.#emit({ type: 'template-table-move', fromPath, toPath });
    return this;
  }

  /** Add a column to a template table, keeping every row the same width. */
  addTemplateTableColumn(path, label = '') {
    const table = getPath(this.data, path);
    if (!table) return this;
    table.columns = [...(table.columns || []), label];
    for (const row of table.rows || []) {
      row.cells = [...(row.cells || [])];
      while (row.cells.length < table.columns.length) row.cells.push(null);
    }
    this.recompute();
    this.#emit({ type: 'set', path: `${path}.columns`, value: table.columns });
    return this;
  }

  /** Remove a column and the cell under it in every row. */
  removeTemplateTableColumn(path, index) {
    const table = getPath(this.data, path);
    if (!table || !Array.isArray(table.columns) || index < 0) return this;
    table.columns.splice(index, 1);
    for (const row of table.rows || []) (row.cells || []).splice(index, 1);
    this.recompute();
    this.#emit({ type: 'set', path: `${path}.columns`, value: table.columns });
    return this;
  }

  /* ---------------- system tabs ---------------- */

  /** Create a new, empty system tab (a small editable grid). */
  addSystemTab(name = 'New system', rows = 12, cols = 6) {
    const tabs = this.data.sheetTabs || (this.data.sheetTabs = []);
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
    this.recompute();
    return tab;
  }

  /** Rename a system tab, carrying its hidden/collapsed prefs along. */
  renameSystemTab(index, name) {
    const tabs = this.data.sheetTabs || [];
    const tab = tabs[index];
    const next = String(name || '').trim();
    if (!tab || !next || next === tab.name || tabs.some((t) => t.name === next)) return this;
    const prefs = this.data.uiPrefs;
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
    this.recompute();
    return this;
  }

  removeSystemTab(index) {
    const tabs = this.data.sheetTabs || [];
    const tab = tabs[index];
    if (!tab) return this;
    tabs.splice(index, 1);
    if (this.data.uiPrefs?.hiddenTabs) delete this.data.uiPrefs.hiddenTabs[tab.name];
    for (const listKey of ['tabOrder', 'sessionTabOrder']) {
      if (Array.isArray(this.data.uiPrefs?.[listKey])) {
        this.data.uiPrefs[listKey] = this.data.uiPrefs[listKey].filter((k) => k !== `sys:${tab.name}`);
      }
    }
    this.recompute();
    return this;
  }

  /* ---------------- the tab bar, in two views ---------------- */

  /** Which view the sheet is in: 'build' (everything) or 'session' (at the table). */
  viewMode() {
    return this.data.uiPrefs?.viewMode === 'session' ? 'session' : 'build';
  }

  /**
   * Switch views. Each view keeps its own tab bar; entering the session view
   * for the first time seeds its bar from what the character actually uses,
   * so the first look is already the right one.
   */
  setViewMode(mode) {
    const next = mode === 'session' ? 'session' : 'build';
    if (!this.data.uiPrefs) this.data.uiPrefs = {};
    if (next === 'session' && !Array.isArray(this.data.uiPrefs.sessionTabOrder)) {
      this.data.uiPrefs.sessionTabOrder = this.sessionDefaultTabs();
    }
    this.data.uiPrefs.viewMode = next;
    this.recompute();
    this.#emit({ type: 'view-mode', mode: next });
    return this;
  }

  /**
   * Which modelled sub-system tabs already hold this character's data, keyed
   * by tab id -- the single source for the ⚙ manager's "in use"/"empty"
   * badges and for seeding the session bar.
   */
  systemTabsInUse() {
    const d = this.data;
    const cr = d.crafting;
    const trainingSide = (side) => !!side
      && ((side.classes || []).some((x) => x?.name) || !!side.tradition?.name);
    const out = {
      combat: trainingSide(d.training?.combat) || trainingSide(d.training?.magic),
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
  taggedSystemTabs() {
    const byId = new Map(GAME_SYSTEMS.map((s) => [s.id, s]));
    const tagged = new Set();
    for (const cls of this.data.classes || []) {
      for (const id of cls?.systems || []) {
        for (const tabId of byId.get(id)?.tabs || []) tagged.add(tabId);
      }
    }
    return tagged;
  }

  /** Mark or unmark one class as using one sub-system (a GAME_SYSTEMS id). */
  toggleClassSystem(index, systemId) {
    const cls = (this.data.classes || [])[index];
    if (!cls || typeof cls !== 'object') return this;
    if (!Array.isArray(cls.systems)) cls.systems = [];
    const at = cls.systems.indexOf(systemId);
    if (at >= 0) cls.systems.splice(at, 1);
    else cls.systems.push(systemId);
    this.recompute();
    this.#emit({ type: 'class-system', index, systemId, on: at < 0 });
    return this;
  }

  /**
   * The session bar a character starts from: the tabs that come up at the
   * table, plus every sub-system that is in use or marked on a class. The
   * heavy build machinery -- Stats, Progression, the worksheets -- waits in
   * the ⚙ manager, where it can always be pulled back on.
   */
  sessionDefaultTabs() {
    const inUse = this.systemTabsInUse();
    const tagged = this.taggedSystemTabs();
    const systems = Object.keys(inUse).filter((id) => inUse[id] || tagged.has(id));
    return ['overview', 'skills', ...systems, 'features', 'primordia', 'trackers', 'gear', 'lore'];
  }

  /** The keys on the active view's tab bar, in order (a copy). */
  tabOrder() {
    const prefs = this.data.uiPrefs || {};
    if (this.viewMode() === 'session') {
      return [...(prefs.sessionTabOrder || this.sessionDefaultTabs())];
    }
    return [...(prefs.tabOrder || DEFAULT_TAB_ORDER)];
  }

  /** Replace the active view's tab bar wholesale; keys are de-duplicated, order kept. */
  setTabOrder(keys) {
    const listKey = this.viewMode() === 'session' ? 'sessionTabOrder' : 'tabOrder';
    this.data.uiPrefs[listKey] = [...new Set(keys.map(String))];
    this.recompute();
    return this;
  }

  /** Put the active view's bar back to its default. */
  resetTabOrder() {
    return this.setTabOrder(this.viewMode() === 'session'
      ? this.sessionDefaultTabs() : DEFAULT_TAB_ORDER);
  }

  /**
   * Resolve each buff's dials. A dial takes a plain number or a formula in
   * the tracker sandbox -- "1 + essence.shoulder" keeps a Citadel banner's
   * bonus right as essence moves -- and the resolved number lands beside the
   * source (`attackNum`…), exactly as a speed's bonus does. conditionState
   * reads only the resolved side, so a broken formula degrades to 0 with the
   * error on the row rather than taking the sheet down.
   */
  #recomputeBuffs() {
    const buffs = this.data.buffs || [];
    if (!buffs.length) return;
    const scope = this.scope();
    for (const b of buffs) {
      if (!b || typeof b !== 'object') continue;
      const errs = [];
      const resolve = (raw, name, setError) => {
        setError(null);
        if (typeof raw === 'string' && raw.trim() !== '') {
          try {
            return Math.floor(Number(evaluateFormula(raw, scope)) || 0);
          } catch (err) {
            setError(err.message);
            errs.push(`${name}: ${err.message}`);
            return 0;
          }
        }
        return Math.floor(Number(raw) || 0);
      };
      for (const [key] of BUFF_MOD_KEYS) {
        b[`${key}Num`] = resolve(b[key], key, (e) => { b[`${key}Error`] = e; });
      }
      // The extra bonuses: [target, value] rows pointed at anything the six
      // dials do not cover. Values take formulas exactly as the dials do.
      if (!Array.isArray(b.bonuses)) b.bonuses = [];
      for (const row of b.bonuses) {
        if (!row || typeof row !== 'object') continue;
        row.valueNum = resolve(row.value, row.target || 'bonus', (e) => { row.valueError = e; });
      }
      b.error = errs.length ? errs.join('; ') : null;
    }
  }

  /* ---------------- session quick actions ---------------- */

  /**
   * Take damage the way the table calls it out: temporary hit points absorb
   * first, the rest comes off current. No floor -- below zero is the dying
   * machinery's business, and it already watches `current`.
   * Returns what actually happened, for the toast that reports it.
   */
  applyDamage(amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (!n) return { taken: 0, fromTemp: 0 };
    const hp = this.data.hp;
    const temp = Math.max(0, Number(hp.temp) || 0);
    const fromTemp = Math.min(temp, n);
    hp.temp = temp - fromTemp;
    hp.current = (Number(hp.current) || 0) - (n - fromTemp);
    this.recompute();
    this.#emit({ type: 'quick-action', action: 'damage', amount: n });
    return { taken: n, fromTemp };
  }

  /**
   * Heal: current climbs to the maximum, and the same points erase nonlethal
   * (healing removes nonlethal damage point for point alongside lethal).
   */
  applyHealing(amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (!n) return { healed: 0 };
    const hp = this.data.hp;
    const max = this.hpState.max;
    const before = Number(hp.current) || 0;
    hp.current = Math.min(max, before + n);
    hp.nonlethal = Math.max(0, (Number(hp.nonlethal) || 0) - n);
    this.recompute();
    this.#emit({ type: 'quick-action', action: 'heal', amount: n });
    return { healed: hp.current - before };
  }

  /**
   * A night's rest: every tracker whose refresh reads as daily -- "Daily",
   * "per day", "on rest", "at dawn" -- goes back to unspent (a two-sided
   * meter to its zero mark). Hit points, spell slots and pools with other
   * rhythms keep their own rules and are the player's to move.
   * Returns how many trackers moved.
   */
  restRefresh() {
    let count = 0;
    for (const t of this.trackers) {
      if (!/daily|day|rest|dawn|morning|night/i.test(String(t.refresh || ''))) continue;
      if ((Number(t.current) || 0) !== 0) { t.current = 0; count++; }
    }
    if (count) this.recompute();
    this.#emit({ type: 'quick-action', action: 'rest', count });
    return count;
  }

  /** Put a tab on the bar (at the end, or at `at`) -- a no-op if it is already there. */
  showTab(key, at) {
    const order = this.tabOrder();
    if (order.includes(key)) return this;
    if (at === undefined || at < 0 || at > order.length) order.push(key);
    else order.splice(at, 0, key);
    return this.setTabOrder(order);
  }

  /** Take a tab off the bar; it waits in the manager with its data intact. */
  hideTab(key) {
    return this.setTabOrder(this.tabOrder().filter((k) => k !== key));
  }

  /** Move a tab on the bar to sit before the tab at `to` (or at the end). */
  moveTab(key, to) {
    const order = this.tabOrder();
    const from = order.indexOf(key);
    if (from < 0) return this;
    order.splice(from, 1);
    const target = Math.max(0, Math.min(order.length, to > from ? to - 1 : to));
    order.splice(target, 0, key);
    return this.setTabOrder(order);
  }

  /* ---------------- wealth ---------------- */

  /**
   * The caster level the sheet charges upkeep against: the global caster level
   * the magic training works out, and the character's own level for someone
   * who casts without a sphere block behind it.
   */
  get casterLevel() {
    return Number(this.data.training?.magic?.globalCL ?? this.data.identity?.level) || 0;
  }

  /** The wallet today: current mana, the offering owed part by part, and what is left after it. */
  wealthView(today = new Date()) {
    return wealthView(this.data.wealth, today, this.casterLevel);
  }

  /**
   * A line in the ledger, and the wallet moves with it. `kind` is one of
   * WEALTH_KINDS; a "session" line also adds to the session mana the next
   * offering takes half of. This is the hook a session-reward automation calls.
   */
  addWealthEntry({ amount, label = '', kind = 'reward', date = null } = {}) {
    const w = this.data.wealth = normalizeWealth(this.data.wealth);
    const n = Number(amount) || 0;
    const entry = {
      date: isoDay(date) || isoDay(new Date()),
      label: String(label || '').trim() || (kind === 'session' ? 'Session reward' : kind === 'spend' ? 'Spent' : 'Adjustment'),
      amount: kind === 'spend' && n > 0 ? -n : n,
      kind: WEALTH_KINDS.includes(kind) ? kind : 'adjust',
    };
    w.ledger.push(entry);
    w.current += entry.amount;
    if (entry.kind === 'session') w.sessionMana = Math.max(0, w.sessionMana + entry.amount);
    this.recompute();
    this.#emit({ type: 'wealth', entry, current: w.current });
    return entry;
  }

  removeWealthEntry(index) {
    const w = this.data.wealth = normalizeWealth(this.data.wealth);
    const [gone] = w.ledger.splice(index, 1);
    if (!gone) return this;
    // Undoing the line undoes what it did to the wallet.
    w.current -= gone.amount;
    if (gone.kind === 'session') w.sessionMana = Math.max(0, w.sessionMana - gone.amount);
    this.recompute();
    this.#emit({ type: 'wealth', removed: gone, current: w.current });
    return this;
  }

  /**
   * Pay the offering: what the sheet's "Mana After" shows becomes the balance,
   * that balance is the new baseline, today is the last offering, and the
   * session mana starts over -- with the payment written to the ledger.
   */
  makeOffering(today = new Date()) {
    const view = this.wealthView(today);
    if (!view.due) return null;
    const w = this.data.wealth;
    const entry = { date: isoDay(today), label: 'Oath of Offerings' + (view.expected.casting ? ' & material casting' : ''), amount: -view.expected.total, kind: 'offering' };
    w.ledger.push(entry);
    w.current = view.after;
    w.baseline = view.after;
    w.lastOffering = isoDay(today);
    w.sessionMana = 0;
    this.recompute();
    this.#emit({ type: 'wealth', entry, current: w.current });
    return entry;
  }

  /* ---------------- techniques and cooking ---------------- */

  /** What the technique formulas read off the character: BAB and the Adept Initiator feat. */
  techniqueContext() {
    let adept = 0;
    for (const g of this.data.featGroups || []) {
      for (const f of g.entries || []) {
        if (/^adept initiator\b/i.test(String(f?.name || '').trim())) adept += 1;
      }
    }
    return { bab: Number(this.data.attack?.bab) || 0, adeptInitiator: adept };
  }

  techniqueByName(name) {
    return (this.data.techniques?.catalogue || []).find((t) => t.name === name) || null;
  }

  /** A technique with its numbers and its Discord text: `mode` 'list' or 'auto' picks the tab's rule. */
  techniqueView(t, mode = 'list') {
    const tech = normalizeTechnique(t);
    const stats = techniqueStats(tech, this.techniqueContext(), mode);
    return {
      technique: tech, stats,
      prerequisites: techniquePrerequisites(tech),
      export: techniqueExport(tech, stats, { characterName: String(this.data.identity?.name || '') }),
    };
  }

  selectTechnique(name) {
    if (!this.data.techniques) return this;
    this.data.techniques.selected = String(name || '');
    this.recompute();
    return this;
  }

  /**
   * Add the AutoTechnique draft to the technique list -- what the workbook's
   * tab does to techRef. A technique of the same name is replaced; the list
   * opens on it; the draft stays put so it can be tweaked and re-added.
   */
  addDraftTechnique(status = '') {
    const block = this.data.techniques;
    const draft = normalizeTechnique(block?.draft);
    if (!block || !draft.name) return null;
    const entry = { ...draft, status: String(status || '') };
    const at = block.catalogue.findIndex((t) => t.name === draft.name);
    if (at >= 0) block.catalogue[at] = entry;
    else block.catalogue.push(entry);
    block.selected = draft.name;
    this.recompute();
    this.#emit({ type: 'set', path: 'techniques.catalogue', value: block.catalogue });
    return entry;
  }

  /** Start the draft over from empty. */
  resetDraftTechnique() {
    if (!this.data.techniques) return this;
    this.data.techniques.draft = emptyTechnique();
    this.recompute();
    return this;
  }

  /** Copy a catalogue technique into the draft, to make a variant of it. */
  draftFromTechnique(name) {
    const t = this.techniqueByName(name);
    if (!t) return this;
    this.data.techniques.draft = normalizeTechnique({ ...t, status: '' });
    this.recompute();
    return this;
  }

  /**
   * Merge the techniques out of a converted workbook into this character --
   * for a character imported before the catalogue was captured, or to bring
   * new techniques over without re-importing the whole sheet. `doc` is what
   * `convertWorkbook` returns; its techRef, Technique List and AutoTechnique
   * grids are read the same way a fresh import reads them. Same-name entries
   * are replaced (their status comes from the workbook); the rest are kept.
   * Returns how many were added and replaced.
   */
  mergeTechniquesFrom(doc) {
    const grids = doc?.extraTabs || {};
    const incoming = importTechniques(grids.techRef ?? null, grids['Technique List'] ?? null, grids.AutoTechnique ?? null);
    if (!this.data.techniques) this.data.techniques = { catalogue: [], selected: '', draft: emptyTechnique() };
    const block = this.data.techniques;
    let added = 0;
    let replaced = 0;
    for (const t of incoming.catalogue) {
      const at = block.catalogue.findIndex((x) => x.name === t.name);
      if (at >= 0) { block.catalogue[at] = t; replaced += 1; } else { block.catalogue.push(t); added += 1; }
    }
    if (!block.draft?.name && incoming.draft?.name) block.draft = incoming.draft;
    if (!block.selected && incoming.selected) block.selected = incoming.selected;
    this.data.techniques = normalizeTechniques(block);
    this.recompute();
    this.#emit({ type: 'set', path: 'techniques.catalogue', value: this.data.techniques.catalogue });
    return { added, replaced, total: this.data.techniques.catalogue.length };
  }

  removeTechnique(name) {
    const block = this.data.techniques;
    if (!block) return this;
    block.catalogue = block.catalogue.filter((t) => t.name !== name);
    if (block.selected === name) block.selected = block.catalogue[0]?.name ?? '';
    this.recompute();
    return this;
  }

  /** The iron chef's dish as it lands on the table, and as a Discord post. */
  cookingView() {
    const view = cookingDish(this.data.cooking, {
      level: Number(this.data.identity?.level) || 0,
      characterName: String(this.data.identity?.name || ''),
    });
    return { ...view, export: cookingExport(view) };
  }

  /* ---------------- inline formulas in prose ---------------- */

  /**
   * Every prose field that may carry {…} tokens, as {path, text}. Kept in one
   * place so the resolver, the renderer and the audit agree on the set.
   */
  proseSources() {
    const d = this.data;
    const out = [];
    const push = (path, text, scope) => {
      if (typeof text === 'string' && hasTokens(text)) out.push({ path, text, scope });
    };
    for (const [cls, g] of Object.entries(d.progression?.classFeatures || {})) {
      for (const [lvl, row] of Object.entries(g.byLevel || {})) {
        for (const [col, value] of Object.entries(row || {})) {
          // A cell shared by two rule groups holds one entry per group.
          if (value && typeof value === 'object') {
            for (const [key, text] of Object.entries(value)) {
              push(`feature:${cls}:${lvl}:${col}:${key}`, text);
            }
          } else push(`feature:${cls}:${lvl}:${col}`, value);
        }
      }
    }
    // A template feature, its sub-abilities and the cells of their tables:
    // everything a player writes on that tab reads {…} the way prose does.
    (d.templates || []).forEach((tp, ti) => (tp.features || []).forEach((f, fi) => {
      const entry = (path, x) => {
        push(path, x.text);
        (x.tables || []).forEach((t, bi) => (t.rows || []).forEach((row, ri) => {
          (row.cells || []).forEach((cell, ci) => push(`${path}:table:${bi}:${ri}:${ci}`, cell));
        }));
      };
      entry(`template:${ti}:${fi}`, f);
      (f.children || []).forEach((c, ci) => entry(`template:${ti}:${fi}:${ci}`, c));
    }));
    (d.notes || []).forEach((n, i) => push(`note:${i}`, n.body));
    (d.backgroundSections || []).forEach((s, i) => push(`background:${i}`, s.text));
    for (const [k, slot] of Object.entries(d.traitSlots || {})) {
      if (k === 'additional') (slot || []).forEach((t, i) => push(`trait:additional:${i}`, t.text));
      else push(`trait:${k}`, slot?.text);
    }
    (d.mythic?.abilities || []).forEach((a, i) => push(`mythic:${i}`, a.name));
    for (const [lvl, text] of Object.entries(d.primordia?.picks || {})) push(`primordia:${lvl}`, text);
    push('primordia:notes', d.primordia?.notes);
    for (const [k, v] of Object.entries(d.mythic?.tradition || {})) push(`mythicTradition:${k}`, v);
    (d.crafting?.projects || []).forEach((p, i) => {
      push(`crafting:${i}:resources`, p.resources);
      push(`crafting:${i}:notes`, p.notes);
    });
    (d.equipment?.weapons || []).forEach((w, i) => push(`weapon:${i}`, w.special));
    // A buff's note reads {…} like any prose, so a buff can carry its rule as
    // a definition -- "{deathgrip.dmg.max = 2 * (1 + essence.shoulder) * …}" --
    // that weapons and trackers then read by name. The definition stands
    // whether the buff is ticked or not (a reference must not break when the
    // buff is off); a value that should switch with something says so itself,
    // with if(…), exactly as the dials do.
    (d.buffs || []).forEach((b, i) => push(`buff:${i}`, b.note));
    // A maneuver's overview note is prose too, and so is a prepared spell's.
    (d.maneuvers?.disciplines || []).forEach((disc, di) => {
      for (const [name, text] of Object.entries(disc.notes || {})) {
        push(`maneuverNote:${di}:${name}`, text);
      }
    });
    (d.vancian?.prepared || []).forEach((r, i) => push(`spellNote:${i}`, r.note));
    (d.equipment?.gear || []).forEach((g, i) => (g.others || []).forEach((o, j) => push(`gear:${i}:${j}`, o)));
    (d.equipment?.other || []).forEach((g, i) => (g.others || []).forEach((o, j) => push(`other:${i}:${j}`, o)));
    // Everything a player writes on a training side reads {…}: the talent
    // itself, the note beside it, the talents a tradition or a feat handed
    // over, and the drawbacks -- a locus priced in mana or a pool sized off
    // level is a number the rest of the sheet may as well be able to read.
    for (const [side, t] of Object.entries(d.training || {})) {
      (t?.classes || []).forEach((cls, ci) => (cls.levels || []).forEach((lv, li) => {
        push(`talent:${side}:${ci}:${li}`, lv.talent);
        push(`talent:${side}:${ci}:${li}:notes`, lv.notes);
      }));
      (t?.bonusTalents || []).forEach((b, bi) => {
        push(`bonusTalent:${side}:${bi}`, b.talent);
        push(`bonusTalent:${side}:${bi}:notes`, b.notes);
      });
      (t?.tradition?.entries || []).forEach((e, ei) => push(`tradition:${side}:${ei}`, e.talent));
      (t?.tradition?.drawbacks || []).forEach((x, xi) => push(`drawback:${side}:${xi}`, x));
      (t?.tradition?.boughtOff || []).forEach((x, xi) => push(`boughtOff:${side}:${xi}`, x));
    }
    // Veils used to be cells on a raw grid, so their text resolved `{…}` the
    // way every other cell did. Now that they are a modelled field, they have
    // to be listed here or a veil that reads "{= con.mod + 2}" would stop
    // computing the moment its tab was modelled.
    //
    // Each one also gets `essence.self`, which is what a veil that scales off
    // its own investment wants to say without naming its own slot.
    [...(d.akashic?.slots || []), ...(d.akashic?.kheshig || [])].forEach((holder, hi) => {
      (holder.veils || []).forEach((v, vi) => {
        const local = { essence: { self: Number(v.essence) || 0 } };
        push(`veil:${hi}:${vi}:name`, v.name, local);
        push(`veil:${hi}:${vi}`, v.desc, local);
      });
    });
    // A card's effect is prose -- "Fort DC {= 10 + floor(level/2) + int.mod}"
    // is what a card wants to carry -- and so are the notes beside it, the
    // sideboard's and a deck manipulation's.
    (d.cardcasting?.cards || []).forEach((card, i) => {
      push(`card:${i}`, card.effect);
      push(`card:${i}:notes`, card.notes);
    });
    (d.cardcasting?.sideboard || []).forEach((card, i) => {
      push(`sideboard:${i}`, card.effect);
      push(`sideboard:${i}:notes`, card.notes);
    });
    (d.cardcasting?.manipulations || []).forEach((m, i) => push(`deckManipulation:${i}`, m.note));
    push('cardcasting:notes', d.cardcasting?.notes);
    // The companions' prose: abilities, qualities, evolutions and notes.
    for (const kind of COMPANION_KINDS) {
      const b = d[kind];
      if (!b) continue;
      for (const key of ['abilities', 'specialAbility', 'specialQualities', 'baseEvolutions',
        'dr', 'resistances', 'immunities', 'notes']) {
        push(`${kind}:${key}`, b[key]);
      }
      (b.evolutions || []).forEach((e, i) => push(`${kind}:evolution:${i}`, e.notes));
      (b.attacks || []).forEach((a, i) => push(`${kind}:attack:${i}`, a.qualities));
      (b.feats || []).forEach((f, i) => push(`${kind}:feat:${i}`, f.notes));
      (b.tricks || []).forEach((t, i) => push(`${kind}:trick:${i}`, t.notes));
    }
    for (const [key, block] of [['akashic', d.akashic], ['maneuvers', d.maneuvers],
      ['vancian', d.vancian], ['psionics', d.psionics], ['cardcasting', d.cardcasting],
      ['extras', d.extras]]) {
      (block?.sourceExtras || []).forEach((row, ri) => {
        (row.cells || []).forEach((cell, ci) => push(`${key}Extra:${ri}:${ci}`, cell));
      });
    }
    (d.sheetTabs || []).forEach((tab, ti) => (tab.rows || []).forEach((row, ri) => {
      (row.cells || []).forEach((cell, ci) => push(`tab:${tab.name}:${ri}:${ci}`, cell));
    }));
    return out;
  }

  /**
   * Resolve every {name = expr} on the character into `this.inlineNames`,
   * available to trackers, weapon tokens, skill formulas and other inline
   * tokens through the formula scope.
   */
  #resolveInlineNames() {
    const sources = this.proseSources();
    const defs = collectDefinitions(sources);
    // Base scope excludes inline names (they are being computed) and skill
    // totals (skills may read names, so names must not read skills — that
    // rules out cycles between the two).
    this.inlineNames = {};
    const base = this.scope();
    // What the sheet works out for itself, captured before `skill` is emptied
    // so that a definition cannot take a skill's name either.
    const builtin = new Set(flatNames(base));
    base.skill = {};
    const { values, errors, duplicates } = resolveDefinitions(defs, base);

    // A definition may not take a name the sheet already works out. The scope
    // merge has always refused to overwrite one, but refusing quietly is the
    // worst of both worlds: {level = 30} would show 30 where it was written
    // while every formula reading `level` went on getting the real number.
    // Better to say so and publish nothing.
    const shadowed = [];
    for (const d of defs) {
      const reason = shadowReason(d.name, builtin);
      if (!reason) continue;
      shadowed.push({ name: d.name, path: d.path, reason });
      delete values[d.name];
      errors.push({ name: d.name, path: d.path, error: reason, shadow: true });
    }

    this.inlineNames = values;
    this.inlineErrors = errors;
    this.inlineDefinitions = defs;
    this.inlineDuplicates = duplicates;
    this.inlineShadowed = shadowed;
    // Every name the prose *reads*, kept beside every name it defines: the
    // parse of each expression is cached by source, so the second pass costs
    // little and orphans() becomes a set lookup rather than another walk.
    this.inlineUses = collectUses(sources);
  }

  /**
   * Names something on this character asks for that nothing provides.
   *
   * Usually the definition was deleted or renamed and the places quoting it
   * were not: the name vanishes from every list, because nothing defines it,
   * and all that is left is a red token in a sentence somewhere. This walks
   * the other way round -- from the uses back -- so the sheet can say "three
   * things still ask for {qi.max}, and here they are".
   *
   * A name that was only ever a typo comes out the same way, which is right:
   * the symptom and the fix are identical.
   */
  orphans(auditRows = null) {
    const known = new Set(this.scopeNames());
    // A name that *is* defined but did not resolve -- one caught in a cycle,
    // one whose formula does not parse -- is not an orphan. It has a
    // definition and that definition has its own problem; saying "nothing
    // defines it" as well would send the player looking for something that is
    // right there.
    const defined = new Set((this.inlineDefinitions || []).map((d) => d.name));
    const found = new Map();
    const add = (name, use) => {
      if (!found.has(name)) found.set(name, { name, uses: [] });
      found.get(name).uses.push(use);
    };

    for (const u of this.inlineUses || []) {
      if (known.has(u.name) || defined.has(u.name)) continue;
      // Legal where it was written: a veil's own essence.self, and the like.
      if (u.scope && resolvePath(u.scope, u.name) !== undefined) continue;
      add(u.name, {
        where: describeSource(u.path),
        path: u.path,
        formula: u.source,
        kind: u.kind,
      });
    }
    // Everything that is not prose -- tracker maxima, skill formulas, weapon
    // tokens, crafting numbers -- has already been checked against the scope
    // it resolves in, so take that verdict rather than redoing it.
    for (const r of auditRows || this.audit()) {
      // Inline definitions are prose, and collectUses has already walked every
      // one of them; counting their audit rows too would list the same text
      // under the same name twice.
      if (r.source === 'inline') continue;
      for (const name of r.unknownReferences || []) {
        if (known.has(name) || defined.has(name)) continue;
        add(name, { where: r.where || r.name, path: r.id, formula: r.formula, kind: 'field' });
      }
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Everything wrong with the names on this character, as one list a reader
   * can work down. Four kinds, and each is a different fix:
   *
   *   cycle      two or more definitions waiting on each other
   *   duplicate  one name defined in more than one place
   *   shadow     a definition trying to take a name the sheet already owns
   *   orphan     a name being asked for that nothing defines
   *
   * The individual formulas carry their own errors as well -- this is the
   * view from above, where a cycle is one problem naming three formulas
   * rather than three formulas each complaining separately.
   */
  formulaProblems(auditRows = null) {
    const rows = auditRows || this.audit();
    const valueAt = new Map(rows
      .filter((r) => r.source === 'inline')
      .map((r) => [`${r.name}@${r.location}`, r.value]));
    const out = [];

    const seen = new Set();
    for (const e of this.inlineErrors || []) {
      if (!e.cycle) continue;
      const key = [...e.cycle].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'cycle',
        name: e.cycle.join(' → '),
        detail: e.error,
        places: [...new Set(e.cycle)].map((n) => {
          const d = (this.inlineDefinitions || []).find((x) => x.name === n);
          return { label: n, where: d ? describeSource(d.path) : '', formula: d?.expr || '' };
        }),
      });
    }

    for (const dup of this.inlineDuplicates || []) {
      out.push({
        kind: 'duplicate',
        name: dup.name,
        detail: `Defined in ${dup.definitions.length} places. The first is the one in force; `
          + 'the rest are ignored. Delete the ones you do not want, or give them their own names.',
        places: dup.definitions.map((d) => ({
          label: d.path === dup.inForce ? 'in force' : 'ignored',
          where: describeSource(d.path),
          formula: d.expr,
          value: valueAt.get(`{${dup.name}}@${d.path}`) ?? null,
          inForce: d.path === dup.inForce,
        })),
      });
    }

    for (const sh of this.inlineShadowed || []) {
      out.push({
        kind: 'shadow',
        name: sh.name,
        detail: sh.reason,
        places: [{ label: 'written in', where: describeSource(sh.path), formula: '' }],
      });
    }

    const orphanNames = new Set();
    for (const o of this.orphans(rows)) {
      orphanNames.add(o.name);
      out.push({
        kind: 'orphan',
        name: o.name,
        detail: `${o.uses.length} ${o.uses.length === 1 ? 'place asks' : 'places ask'} for `
          + `"${o.name}" and nothing defines it. Either the definition was deleted or renamed, `
          + 'or the name is misspelt here.',
        places: o.uses.map((u) => ({ label: u.kind === 'ref' ? 'quoted in' : 'used in', where: u.where, formula: u.formula })),
      });
    }

    // Anything else that does not work -- a tracker max that does not parse, a
    // skill formula reading something it may not. Listed here so that "needs
    // attention" really is everything, and the count beside it can be trusted.
    const spokenFor = new Set(this.inlineErrors
      ?.filter((e) => e.duplicate || e.cycle || e.shadow)
      .map((e) => `${e.name}@${e.path}`) || []);
    for (const r of rows) {
      if (r.status !== 'error') continue;
      if (r.source === 'inline' && spokenFor.has(`${String(r.name).slice(1, -1)}@${r.location}`)) continue;
      const unknowns = r.unknownReferences || [];
      // A row whose only fault is naming an orphan is that orphan's problem,
      // and it is already listed under it.
      if (unknowns.length && unknowns.every((n) => orphanNames.has(n))) continue;
      out.push({
        kind: 'broken',
        name: r.name,
        detail: r.error || 'This formula does not work.',
        places: [{ label: 'written in', where: r.where || SOURCE_WORD[r.source] || r.source, formula: r.formula }],
      });
    }
    return out;
  }

  /** Rendered segments for a prose field (used by the view layer). */
  /**
   * @param local  scope that exists only where this text was written, such as
   *               `{ essence: { self } }` for a veil's own description.
   */
  renderProse(text, local = null) {
    return renderTokens(text, this.inlineNames || {}, this.scope(), local);
  }

  /**
   * The local scope a tracker's own note resolves in.
   *
   * `self` is that tracker's row -- current, max, min, remaining, spent, pct
   * and the label of the zone the value is sitting in -- so a note can say how
   * full its own tracker is without naming it. Character-wide, the same numbers
   * are `tracker.<id>.*`.
   */
  trackerScope(t) {
    const zone = zoneAt(Number(t?.current) || 0, t?.resolvedZones || []);
    return { self: { ...trackerFacts(t), zone: zone?.label || '' } };
  }

  /** The local scope a veil's own text resolves in. */
  veilScope(veil) {
    return { essence: { self: Number(veil?.essence) || 0 } };
  }

  /* ---------------- equipment ---------------- */

  /**
   * Weapons and load. Each weapon's attack is its base mode total plus
   * enhancement and misc; damage is dice + floor(ability × mult) + misc +
   * enhancement. A per-weapon offset reconciles against the workbook's cached
   * attack roll, so imports match and edits still move the number.
   */
  #recomputeEquipment() {
    const c = this.data;
    const e = c.equipment;
    if (!e) return;

    const modeBase = (type) => {
      const modes = {
        Melee: 'melee', 'Alt Melee': 'altMelee', Ranged: 'ranged',
        'Alt Ranged': 'altRanged', CMB: 'cmb', 'Alt CMB': 'altCmb',
      };
      const key = modes[type];
      if (!key) return null;
      const m = c.attack.modes[key];
      return (Number(c.attack.bab) || 0)
        + statMod(c, m?.stat1, m?.stat2)
        - sizeMod(c)
        + (Number(c.attack.miscBonus) || 0);
    };

    const unarmedDiceNow = c.training?.combat?.unarmed?.dice;
    const scope = this.scope();
    const evalFormula = (src) => evaluateFormula(src, scope);
    const prof = c.identity?.proficiencies;

    /**
     * Put the value of every {name} and {= …} into the text, before anything
     * tries to read it as dice or as a formula.
     *
     * A weapon's fields are not formulas, they are dice expressions with
     * formulas in them -- "2d6 + con.mod", "[[4d8 crit]]" -- so a name in one
     * cannot simply be evaluated: it has to be *substituted*, because the
     * name may hold dice text rather than a number. {kinetic.fist} is "4d8"
     * and has to reach the dice reader as those characters; {deathgrip.dmg}
     * is 13 and has to reach the formula reader as that number. Splicing the
     * value in as text is the one treatment that serves both.
     *
     * Braces are prose syntax, and the sandbox has never known what to do
     * with them: without this, every one of these reported the tokeniser's
     * "Unexpected character" and quietly contributed nothing.
     */
    const spliceNames = (text) => {
      const src = String(text ?? '');
      if (!src.includes('{')) return { text: src, error: null };
      let error = null;
      const out = src.replace(/\{([^{}]*)\}/g, (whole, inner) => {
        const expr = inner.trim().replace(/^=\s*/, '').trim();
        if (!expr) return whole;
        try {
          const v = evaluateFormula(expr, scope);
          return typeof v === 'number' ? String(v) : String(v ?? '');
        } catch (err) {
          // Just the reason: every caller already shows the text it came from,
          // and "Unknown value X" names the culprit itself.
          error = error || err.message;
          return '';
        }
      });
      return { text: out, error };
    };

    for (const w of e.weapons) {
      // Read against the row's own Proficient field, the [Enhanced] veil rule
      // and the Overview's proficiencies; a `false` is shown, not applied --
      // the -4 is the player's to write, as it always was.
      const pr = weaponProficient(prof, w);
      w.proficient = pr.state;
      w.proficiencyWhy = pr.why;
      w.proficiencySource = pr.source;
      // The Dice field may reference an inline name or hold a formula:
      //   "12d8"                 literal
      //   "{kinetic.fist}"       a {name = …} defined in prose (may be dice text
      //                          like "4d6", or a number = count of d6)
      //   "{= …}" / "[[…]]"      an inline expression, same rules
      w.diceError = null;
      let diceText = w.dice ?? '';
      const ref = String(diceText).trim().match(/^(?:\{\{|\[\[|\{)\s*=?\s*(.+?)\s*(?:\}\}|\]\]|\})$/);
      if (ref) {
        try {
          const v = evaluateFormula(ref[1], scope);
          // A whole field that is one name: a number means that many d6, the
          // kineticist blast rule. Only here -- a name spliced into the middle
          // of an expression is worth the number it says.
          diceText = typeof v === 'number' ? `${Math.floor(v)}d6` : String(v ?? '');
        } catch (err) {
          w.diceError = err.message;
          diceText = '';
        }
      } else {
        const named = spliceNames(diceText);
        diceText = named.text;
        w.diceError = named.error;
      }
      w.diceResolved = w.useUnarmedDice && unarmedDiceNow ? unarmedDiceNow : diceText;
      const base = modeBase(w.attackType);
      const attack = (base ?? (Number(w.baseOverride) || 0))
        + (Number(w.enhancement) || 0) + (Number(w.miscAttack) || 0);
      if (w.attackOffset === undefined) {
        w.attackOffset = w.sheetAttack != null ? (Number(w.sheetAttack) || 0) - attack : 0;
      }
      w.attackTotal = attack + w.attackOffset;

      const abilityPart = w.damageAbility
        ? Math.floor(statMod(c, w.damageAbility, null) * (Number(w.abilityMult) || 1))
        : 0;
      // Misc damage is flat damage that behaves like the weapon's own -- it
      // multiplies on a crit -- and it is often a rule rather than a number
      // ("Int mod + invested essence x2"), so it resolves in the sandbox like
      // every other value a player may write. It used to take a plain number
      // and read a formula as 0, silently.
      const misc = spliceNames(w.miscDamage);
      w.miscDamageNum = 0;
      w.miscDamageError = misc.error;
      if (String(misc.text).trim()) {
        try {
          w.miscDamageNum = Math.floor(Number(evalFormula(misc.text)) || 0);
        } catch (err) {
          w.miscDamageError = w.miscDamageError || err.message;
        }
      }
      const bonus = abilityPart + w.miscDamageNum + (Number(w.enhancement) || 0);
      w.damageBonus = bonus;
      w.damageTotal = `${w.diceResolved || '—'}${bonus ? fmt(bonus) : ''}`;

      // Inline bonuses written into the special-properties text:
      //   {{…}} adds to hit, [[…]] adds damage — dice, a sandbox formula, a
      //   {name} defined in prose, or a mix ("2d6 + con.mod").
      //
      // Two keywords say when the damage happens and whether it multiplies,
      // which between them cover every rule an ability is written with:
      //
      //   [[6]]        every hit, and added once more on a crit -- the usual
      //                rider (flaming, sneak attack), which the rules do not
      //                multiply
      //   [[6 Crit]]   only on a confirmed crit, and multiplied
      //   [[6 Mult]]   every hit, and multiplied on a crit -- damage that
      //                behaves like the weapon's own, with no "not multiplied"
      //                caveat on it (Deathgrip Gauntlets)
      //
      //   {{4}}        attack and confirmation rolls
      //   {{4 Crit}}   confirmation rolls only
      //
      // Mult means nothing on an attack token: attack rolls are not multiplied.
      const special = String(w.special ?? '');
      const parseTokens = (re, damage) => [...special.matchAll(re)].map((m) => {
        const raw = m[1].trim();
        const crit = /\bcrit\b/i.test(raw);
        const mult = damage && !crit && /\bmult(iplied)?\b/i.test(raw);
        const named = spliceNames(raw.replace(/\b(?:crit|mult(?:iplied)?)\.?\b/gi, ' '));
        const p = parseDiceExpr(named.text, evalFormula);
        // The token still reads as what the player wrote; only the fault, if
        // there is one, comes from the name that would not resolve.
        return { text: raw, crit, mult, ...p, error: named.error || p.error };
      });
      const atkTokens = parseTokens(/\{\{(.+?)\}\}/gs, false);
      const dmgTokens = parseTokens(/\[\[(.+?)\]\]/gs, true);

      const baseDice = parseDiceExpr(w.diceResolved, null);
      const tok = (list) => list.reduce(
        (acc, t) => ({ dice: addDice(acc.dice, t.dice), flat: acc.flat + (t.error ? 0 : t.flat) }),
        { dice: {}, flat: 0 },
      );
      const atk = tok(atkTokens.filter((t) => !t.crit));
      const dmg = tok(dmgTokens.filter((t) => !t.crit && !t.mult));
      // Damage on every hit that multiplies with the weapon: it joins the
      // normal total like a rider, and the crit multiplier takes it with the
      // base rather than adding it once afterwards.
      const multDmg = tok(dmgTokens.filter((t) => t.mult));
      const critAtk = tok(atkTokens.filter((t) => t.crit));
      const critDmg = tok(dmgTokens.filter((t) => t.crit));
      // The weapon's own Bonus Crit Damage column joins the crit-only pool,
      // and reads names the same way the tokens do.
      const bcdNamed = spliceNames(w.bonusCritDamage);
      const bcdParsed = parseDiceExpr(bcdNamed.text, evalFormula);
      const bcd = { ...bcdParsed, error: bcdNamed.error || bcdParsed.error };
      const critExtra = {
        dice: addDice(critDmg.dice, bcd.error ? {} : bcd.dice),
        flat: critDmg.flat + (bcd.error ? 0 : bcd.flat),
      };

      w.calc = {
        baseAtk: w.attackTotal,
        baseDmgDice: baseDice.dice,
        baseDmgFlat: baseDice.flat + bonus,
        baseAvg: diceAverage(baseDice.dice, baseDice.flat + bonus),
        notes: baseDice.notes,
        atkTokens,
        dmgTokens,
        tokAtk: atk,
        tokDmg: dmg,
        totalAtk: w.attackTotal + atk.flat,
        totalAtkStr: Object.keys(atk.dice).length
          ? `${fmt(w.attackTotal + atk.flat)}+${diceString(atk.dice)}`
          : fmt(w.attackTotal + atk.flat),
        tokMultDmg: multDmg,
        totalDmgDice: addDice(addDice(baseDice.dice, dmg.dice), multDmg.dice),
        totalDmgFlat: baseDice.flat + bonus + dmg.flat + multDmg.flat,
        errors: [...atkTokens, ...dmgTokens].filter((t) => t.error)
          .map((t) => `${t.text}: ${t.error}`),
      };
      w.calc.totalDmgStr = diceString(w.calc.totalDmgDice, w.calc.totalDmgFlat)
        + (baseDice.notes.length ? ` ${baseDice.notes.join(' ')}` : '');
      w.calc.totalAvg = diceAverage(w.calc.totalDmgDice, w.calc.totalDmgFlat);
      w.calc.hasTokens = atkTokens.length > 0 || dmgTokens.length > 0;

      // Criticals. What multiplies and what does not:
      //   - base weapon damage, ability, enhancement and misc: multiplied;
      //   - [[… Mult]] tokens: multiplied, with the base;
      //   - untagged [[…]] tokens: added once, unmultiplied (damage riders);
      //   - [[… Crit]] tokens: crit-only damage, multiplied;
      //   - the Bonus Crit Damage column: crit-only, unmultiplied (burst dice);
      //   - {{… Crit}}: applies to confirmation rolls only.
      const multMatch = String(w.critMult ?? '').match(/(\d+)/);
      const critMultNum = Math.max(2, multMatch ? Number(multMatch[1]) : 2);
      const critTagged = critDmg;
      const hasCritTagged = Object.keys(critTagged.dice).length > 0 || critTagged.flat !== 0;
      const hasBcd = !bcd.error && (Object.keys(bcd.dice).length > 0 || bcd.flat !== 0);
      w.calc.critMultNum = critMultNum;
      w.calc.critAtk = critAtk;
      w.calc.critTagged = critTagged;
      w.calc.critExtra = critExtra;
      w.calc.hasCritTokens = atkTokens.some((t) => t.crit) || dmgTokens.some((t) => t.crit);
      w.calc.confirmTotal = w.calc.totalAtk + critAtk.flat;
      w.calc.confirmStr = Object.keys(critAtk.dice).length
        ? `${fmt(w.calc.confirmTotal)}+${diceString(critAtk.dice)}`
        : fmt(w.calc.confirmTotal);
      // Everything that multiplies is gathered first and multiplied once, so
      // the printed string can be read straight down: (base + mult)×N + …
      const multBase = {
        dice: addDice(baseDice.dice, multDmg.dice),
        flat: baseDice.flat + bonus + multDmg.flat,
      };
      w.calc.critAvg = Math.round((
        diceAverage(multBase.dice, multBase.flat) * critMultNum
        + diceAverage(dmg.dice, dmg.flat)
        + diceAverage(critTagged.dice, critTagged.flat) * critMultNum
        + (hasBcd ? diceAverage(bcd.dice, bcd.flat) : 0)
      ) * 10) / 10;
      // Every term, in the order they are worked out, so the string adds up to
      // the average printed beside it. A bare "×2" could not: the multiplier
      // takes the base and nothing else, so a weapon showing "dmg 10 · crit ×2"
      // with an average of 15 gave a reader no way of reaching 15 from what
      // the row said, and read as though the rider had been dropped.
      const hasRiders = Object.keys(dmg.dice).length > 0 || dmg.flat !== 0;
      // Only a term of more than one part needs bracketing to keep × from
      // looking as though it binds to the last bit of it.
      const critTerm = (t) => (/[+-]/.test(String(t).slice(1)) ? `(${t})` : t);
      w.calc.critStr = [
        `${critTerm(diceString(multBase.dice, multBase.flat))}×${critMultNum}`,
        hasRiders ? `+${diceString(dmg.dice, dmg.flat).replace(/^\+/, '')}` : '',
        hasCritTagged ? `+${critTerm(diceString(critTagged.dice, critTagged.flat).replace(/^\+/, ''))}×${critMultNum}` : '',
        hasBcd ? `+${diceString(bcd.dice, bcd.flat).replace(/^\+/, '')}` : '',
      ].filter(Boolean).join('');
    }

    // Carried weight: every section's weights, plus a manual adjustment that
    // reconciles the imported figure.
    const sum = (arr, key = 'weight') => (arr || []).reduce((t, x) => t + (Number(x[key]) || 0), 0);
    const computed = sum(e.gear) + sum(e.other) + (Number(e.armor?.weight) || 0)
      + sum(e.shields) + sum(e.weapons);
    if (c.carry.carriedOffset === undefined) {
      c.carry.carriedOffset = (Number(c.carry.carried) || 0) - computed;
    }
    e.totalWeight = computed;
    c.carry.carried = computed + (Number(c.carry.carriedOffset) || 0);
    e.totalValue = sum(e.gear, 'cost') + sum(e.other, 'cost')
      + (Number(e.armor?.cost) || 0) + sum(e.shields, 'cost') + sum(e.weapons, 'price');
  }

  /* ---------------- movement ---------------- */

  /**
   * Movement rates: base plus bonus, with the bonus allowed to be a formula.
   *
   * A monk's fast movement is not a number, it is a rule -- "+10 ft. at 3rd
   * level and every 3 levels after" -- and typed as a number it goes stale the
   * moment the character levels. Written as `floor(level / 3) * 10` it does
   * not, so the bonus resolves in the same sandbox as everything else players
   * may write, and lands in `bonusNum` with any error beside it.
   */
  #recomputeSpeeds() {
    const speeds = this.data.identity?.speeds;
    if (!Array.isArray(speeds) || !speeds.length) return;
    const scope = this.scope();
    for (const sp of speeds) {
      sp.bonusError = null;
      let bonus = 0;
      if (typeof sp.bonus === 'string' && sp.bonus.trim() !== '') {
        try {
          const v = Number(evaluateFormula(sp.bonus, scope));
          bonus = Number.isFinite(v) ? v : 0;
        } catch (err) {
          sp.bonusError = err.message;
        }
      } else {
        bonus = Number(sp.bonus) || 0;
      }
      sp.bonusNum = bonus;
      sp.final = (Number(sp.base) || 0) + bonus;
    }
  }

  /* ---------------- languages ---------------- */

  /**
   * How many languages the character may know beyond the native ones.
   *
   * One per point of Intelligence bonus, one per rank of Linguistics, and
   * whatever else grants some -- a race, a trait, a class feature -- as a
   * number or a formula, since "+1 per two levels" is a rule and not a value.
   * The count is against the list, so the panel can say how many are spare
   * or how many too many.
   */
  #recomputeLanguages() {
    const c = this.data;
    const i = c.identity;
    const int = Math.max(0, Number(c.abilities.int?.totalMod) || 0);
    const ling = (c.skills || [])
      .filter((s) => /^Linguistics\b/i.test(String(s.name || '')))
      .reduce((t, s) => t + (Number(s.totalRanks) || 0), 0);
    let extra = 0;
    let extraError = null;
    if (typeof i.languageExtra === 'string' && i.languageExtra.trim() !== '') {
      try {
        const v = Number(evaluateFormula(i.languageExtra, this.scope()));
        extra = Number.isFinite(v) ? Math.floor(v) : 0;
      } catch (err) {
        extraError = err.message;
      }
    } else {
      extra = Number(i.languageExtra) || 0;
    }
    const known = (i.languages || []).filter((l) => String(l).trim()).length;
    i.languageSlots = {
      int, linguistics: ling, extra, extraError, total: int + ling + extra, known,
    };
  }

  /* ---------------- item crafting ---------------- */

  /**
   * The Craft skills the crafting check may key off, with the live bonus from
   * the Skills tab. Labels are unique so they can be stored as the choice.
   */
  craftSkills() {
    const seen = new Map();
    return (this.data.skills || [])
      .filter((s) => /^Craft\b|^Craft\(/i.test(s.name))
      .map((s) => {
        const base = skillLabel(s.name, s.spec);
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return {
          key: n > 1 ? `${base} ${n}` : base,
          label: n > 1 ? `${base} ${n}` : base,
          bonus: Number(s.bonus) || 0,
          ranks: Number(s.totalRanks) || 0,
        };
      });
  }

  /**
   * The crafting calculator.
   *
   * Speed, base cost and the cost reductions are the crafter's standing setup;
   * each project then costs `CEILING(value x ratio)`, sells for the discounted
   * price or its cost, and takes `CEILING(basis / speed per day)` days. Every
   * number a player types may instead be a formula, resolved in the same
   * sandbox as the trackers, so a bonus that scales with the character does.
   */
  #recomputeCrafting() {
    const cr = this.data.crafting;
    if (!cr) return;
    const scope = this.scope();
    const errors = [];

    /** A plain number, or a player formula; resolved into `<field>Num`. */
    const resolve = (obj, field, where) => {
      const raw = obj[field];
      obj[`${field}Error`] = null;
      let out = 0;
      if (typeof raw === 'number') {
        out = raw;
      } else {
        const src = String(raw ?? '').trim();
        if (src !== '') {
          try {
            const v = Number(evaluateFormula(src, scope));
            out = Number.isFinite(v) ? v : 0;
          } catch (err) {
            obj[`${field}Error`] = err.message;
            errors.push(`${where}: ${err.message}`);
          }
        }
      }
      obj[`${field}Num`] = out;
      return out;
    };

    for (const s of cr.speedIncreases || []) resolve(s, 'value', s.label || 'Speed increase');
    const speedPerDay = craftingSpeed(cr.baseSpeed, cr.speedIncreases || []);

    const presets = cr.baseCosts || [];
    const preset = presets[Number(cr.baseCostIndex) || 0] || presets[0] || { percent: 0 };
    const basePercent = Number(preset.percent) || 0;
    const baseFraction = craftingFraction(basePercent);

    let compounding = 1;
    for (const r of cr.costReductions || []) {
      const pct = resolve(r, 'value', r.label || 'Cost reduction');
      if (r.enabled !== false) compounding *= 1 - pct / 100;
    }
    const ratio = compounding * baseFraction;

    // Crafting check: take 10 by default, off the Craft skill's live total.
    // An unset choice takes the sheet's own default (the first Craft skill the
    // character actually has ranks in); "None" is a real choice and stays one.
    const skills = this.craftSkills();
    const skill = cr.checkSkill === null || cr.checkSkill === undefined
      ? skills.find((s) => s.ranks > 0) || skills[0] || null
      : skills.find((s) => s.key === cr.checkSkill) || null;
    const roll = cr.checkMode === 'take20' ? 20
      : cr.checkMode === 'manual' ? (Number(cr.checkRoll) || 0) : 10;
    const checkBase = roll + (skill?.bonus || 0) + (Number(cr.checkMisc) || 0);

    const unit = String(cr.currency || '').trim();
    const suffix = unit ? ` ${unit}` : '';

    for (const p of cr.projects || []) {
      const where = p.name || 'Project';
      const value = resolve(p, 'value', `${where} value`);
      const cost = ceilExact(value * ratio);
      const discount = p.discountOverride === null || p.discountOverride === undefined
        ? Number(cr.discount) || 0
        : Number(p.discountOverride) || 0;
      const sale = p.zeroProfit ? cost : Math.max(ceilExact(value * (1 - discount / 100)), cost);

      const itemDC = resolve(p, 'itemDC', `${where} item DC`);
      for (const a of p.dcAdjustments || []) resolve(a, 'value', `${where} DC — ${a.label || 'adjustment'}`);
      const adjustments = (p.dcAdjustments || []).filter((a) => a.enabled !== false);
      const bypasses = (p.bypassed || []).filter((b) => b.enabled !== false);
      const perBypass = Number(cr.dcPerBypass) || 0;
      const dc = itemDC + adjustments.reduce((t, a) => t + a.valueNum, 0) + bypasses.length * perBypass;
      const check = checkBase + (Number(p.checkMod) || 0);

      const basis = cr.timeBasis === 'cost' ? cost : value;
      const daysExact = speedPerDay > 0 ? basis / speedPerDay : 0;

      // The DC line explains itself: every adjustment and bypass that moved it.
      const dcParts = [
        ...adjustments.map((a) => `${a.label || 'adjustment'} ${fmt(a.valueNum)}`),
        ...bypasses.map((b) => `bypass${b.label ? `: ${b.label}` : ''} ${fmt(perBypass)}`),
      ];
      if (String(p.dcNotes ?? '').trim()) dcParts.push(String(p.dcNotes).trim());

      p.calc = {
        value,
        cost,
        basis,
        gross: value - cost,
        sale,
        net: sale - cost,
        discount,
        dc,
        dcParts,
        check,
        succeeds: check >= dc,
        days: speedPerDay > 0 ? Math.ceil(Number(daysExact.toPrecision(12))) : 0,
        daysExact: Math.round(daysExact * 100) / 100,
      };
      const dcLine = dcParts.length ? `${dc} (${dcParts.join(', ')})` : `${dc}`;

      // The workbook's own two Discord posts, regenerated from live values.
      p.calc.craftPost = [
        `**Crafting**: ${p.name ?? ''}`,
        `**Value**: ${value}${suffix}`,
        `**Cost**: ${cost}${suffix}`,
        `**Profit**: ${p.zeroProfit ? 'No Profit' : `${p.calc.net}${suffix}`}`,
        `**DC**: ${dcLine}`,
        `**Check**: ${check}`,
        `**Time to Completion**: ${p.calc.days} (${p.calc.daysExact}) days`,
        `**Resources used:** ${p.resources ?? ''}`,
        `**Notes/Description**: ${p.notes ?? ''}`,
      ].join('\n');

      p.calc.marketPost = [
        `**Character Name:** ${cr.sellerName ?? ''}`,
        `**Item:** ${p.name ?? ''}`,
        `**Market Value:** ${value}`,
        `**Price Sold:** ${sale}`,
        `**Sold To:** ${p.buyerName ?? ''} (@${p.buyerTag ?? ''})`,
        `**Gold or Mana Remaining:** ${p.remaining ?? ''}${suffix}`,
      ].join('\n');
    }

    cr.calc = {
      speedPerDay,
      basePercent,
      baseFraction,
      compounding,
      ratio,
      checkBase,
      skill: skill?.key ?? null,
      skillBonus: skill?.bonus || 0,
      roll,
      errors,
    };
  }

  /* ---------------- akashic veilweaving ---------------- */

  /**
   * Veil DCs, the essence bill, and the caps that bound it.
   *
   * The workbook stored every veil's DC beside its essence; both come back
   * from base DC + essence, so only the essence round-trips and this puts the
   * DC back. Essence spent is the sum across every shaped veil, which is what
   * the sheet's "Used/Total" showed.
   */
  #recomputeAkashic() {
    const a = this.data.akashic;
    if (!a) return;

    const base = Number(a.baseDC) || 0;
    const cap = (a.classes || []).reduce(
      (m, c) => Math.max(m, (Number(c.essenceCap) || 0) + (Number(c.bonusCap) || 0)), 0,
    );
    for (const c of a.classes || []) {
      c.totalCap = (Number(c.essenceCap) || 0) + (Number(c.bonusCap) || 0);
    }

    const over = [];
    for (const holder of [...(a.slots || []), ...(a.kheshig || [])]) {
      for (const v of holder.veils || []) {
        v.dc = veilDC(base, v.essence);
        if (cap > 0 && (Number(v.essence) || 0) > cap) {
          over.push(v.name || holder.slot || holder.label);
        }
      }
    }

    const pool = Number(a.essence?.pool) || 0;
    // The sheet's "Essence Boon" is the casting tradition's own pool taken as
    // essence rather than as spell points -- the same number, written twice.
    // Now that the Spheres tab works it out, it is computed here instead of
    // typed, and the typed figure stands in only for a character whose
    // tradition grants nothing (a homebrew source the tradition never saw).
    const traditionBoon = Number(this.data.training?.magic?.traditionEssence) || 0;
    const sources = ESSENCE_SOURCES.reduce(
      (t, [key]) => t + (key === 'boon' && traditionBoon ? traditionBoon : Number(a.essence?.[key]) || 0),
      0,
    );
    const used = essenceInvested([...(a.slots || []), ...(a.kheshig || [])])
      + (a.otherReceptacles || []).reduce((t, r) => t + (Number(r.essence) || 0), 0);

    // The Veilweaving sphere condenses spell points into essence for the day.
    // It rides on top of the daily pool rather than inside it -- the pool is
    // what the veilweaving classes grant -- and the points it costs come off
    // the caster's own total, which #recomputeTraining has already worked out.
    const temp = tempEssence(a);
    const spSpent = tempEssenceCost(a);
    const spPool = Number(this.data.training?.magic?.totalSP) || 0;

    a.calc = {
      base,
      totalCap: cap,
      pool,
      sources,
      traditionBoon,
      // The pool is what the veilweaving classes and their sources come to, and
      // the sheet writes that total itself; where the two disagree the panel
      // says so rather than quietly picking one.
      sourcesShort: sources - pool,
      temp,
      spSpent,
      spPool,
      spShort: Math.max(0, spSpent - spPool),
      total: pool + temp,
      used,
      free: pool + temp - used,
      overCap: over,
      shaped: (a.slots || []).reduce((n, s) => n + (s.veils || []).length, 0)
        + (a.kheshig || []).reduce((n, s) => n + (s.veils || []).length, 0),
    };
  }

  /* ---------------- path of war maneuvers ---------------- */

  /**
   * Expand each discipline against the catalogue, and count what is readied.
   *
   * A discipline saves its name and the maneuvers readied from it; everything
   * the discipline grants comes back from the shared catalogue here, so
   * `entries` is rebuilt on every recompute rather than stored. The sheet's
   * per-discipline counts and its two totals are sums of those ticks, so they
   * are recomputed too.
   */
  #recomputeManeuvers() {
    const m = this.data.maneuvers;
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

  /* ---------------- vancian casting ---------------- */

  /**
   * Every casting class's spell table, from the shared casting table.
   *
   * The whole tab was formula-driven on the sheet, in Google-only functions that
   * Excel could not carry, so it exported as frozen numbers and arrived looking
   * like a hand-typed grid. Those formulas, in order:
   *
   *   caster level  levels of the block's class at or below the character's own
   *   spells known  the table's own column, and only where the style has a list
   *   slots per day the table's base, plus bonus slots for each casting stat,
   *                 gated on a score of 10 + the spell level
   *   save DC       10 + spell level + the casting stats' modifiers
   *
   * Level 0 is settled before any of that: cantrips are at will for anyone with
   * a list of them, which is why an oracle has unlimited orisons despite the
   * slots table holding no 0-level entry for the class at all. A prepared caster
   * has no such list -- a spellbook is not slot-derived -- so its cantrips are
   * the table's own number, four for a wizard rather than unlimited.
   *
   * A slot type the shared table does not know keeps whatever the player typed
   * and says so, rather than reporting zero slots the way the sheet did.
   */
  #recomputeVancian() {
    const v = this.data.vancian;
    if (!v) return;

    for (const c of v.classes || []) {
      const style = prepStyle(c.prep);
      const mod = statMod(this.data, c.stat, c.stat2);
      const score = statScore(this.data, c.stat, c.stat2);
      const table = castingTable(c.slotType);

      /*
       * Caster level follows the Planner, because that is where it came from: the
       * sheet's cell was a COUNTIF over the class's rows, and the number in it is
       * a cached answer like every other number on the tab. Following the count
       * keeps it right as the character levels.
       *
       * `casterLevelOverride` pins it instead -- for a class the progression does
       * not carry, or a block a player wants to hold still. Same shape as the
       * Classes table's `levelsOverride`, and null means "follow".
       */
      const fromProgression = this.classLevelCount(c.name || c.slotType);
      const pinned = c.casterLevelOverride;
      const level = Math.max(0, Math.min(20,
        pinned === null || pinned === undefined ? fromProgression : Math.floor(Number(pinned) || 0)));
      c.casterLevel = level;

      c.statMod = mod;
      c.statScore = score;
      c.plannerLevel = fromProgression;
      c.tableName = table?.name || '';
      c.slotTypeUnknown = Boolean(String(c.slotType || '').trim() && !table);
      c.noun = castingNoun(c.source);

      const rowOf = (grid) => (level >= 1 && Array.isArray(grid) ? grid[level - 1] || [] : []);
      const base = rowOf(table?.perDay);
      const baseKnown = rowOf(table?.known);
      const classBonus = rowOf(table?.bonus);
      const cell = (row, level_) => {
        const raw = row[level_];
        return raw === null || raw === undefined || raw === '' ? null : raw;
      };

      // Known first: level 0's slots depend on it.
      for (const s of c.spells || []) {
        s.knownCount = style.known
          ? (s.known ?? cell(baseKnown, s.level))
          : null;
      }
      const hasCantrips = (c.spells || [])
        .find((s) => s.level === 0)?.knownCount !== null;

      for (const s of c.spells || []) {
        s.dc = spellDC(s.level, mod);
        s.base = cell(base, s.level);
        s.classBonus = cell(classBonus, s.level);
        s.abilityBonus = s.base === null ? 0 : bonusSpellSlots(mod, s.level);
        s.atWill = s.level === 0 && hasCantrips;

        if (s.perDay !== null && s.perDay !== undefined) {
          s.slots = Number(s.perDay);          // the player's own number wins
          s.atWill = false;
        } else if (s.atWill) {
          s.slots = null;
        } else if (s.base === null || !castableAt(score, s.level)) {
          s.slots = null;
        } else {
          s.slots = s.base + s.abilityBonus;
        }

        // A domain slot at a spell level the class cannot reach is not a slot.
        // The table lists them for all nine levels regardless, so a cleric who
        // stops at 6th would otherwise show three he can never fill.
        if (s.slots === null && !s.atWill) s.classBonus = null;

        /*
         * What has been spent today. This is the one thing here the player owns
         * rather than the table, so it is kept -- but clamped to what the class
         * actually has, or a level that shrinks (a stat drops, a level is
         * retrained) would be left claiming more spent than it ever had.
         *
         * A spontaneous caster only needs the count: which spell went into which
         * slot is not a question their sheet can ask. Cantrips are at will and so
         * have nothing to spend.
         */
        const cap = s.atWill ? 0 : Math.max(0, Number(s.slots) || 0);
        s.used = Math.max(0, Math.min(cap, Math.floor(Number(s.used) || 0)));
        s.left = s.atWill ? null : cap - s.used;
      }

      c.totalPerDay = (c.spells || []).reduce((t, s) => t + (Number(s.slots) || 0), 0);
      c.totalKnown = (c.spells || []).reduce((t, s) => t + (Number(s.knownCount) || 0), 0);
      c.totalLeft = (c.spells || []).reduce((t, s) => t + (Number(s.left) || 0), 0);
      c.highestLevel = (c.spells || [])
        .reduce((hi, s) => (s.slots || s.atWill ? Math.max(hi, s.level) : hi), 0);
    }

    /*
     * A prepared caster commits an exact number of uses to each spell, so their
     * play state hangs off the list rather than off the spell level: two castings
     * of one spell is a different thing from one each of two.
     */
    for (const p of v.prepared || []) {
      p.uses = Math.max(0, Math.floor(Number(p.uses) || 0));
      p.used = Math.max(0, Math.min(p.uses, Math.floor(Number(p.used) || 0)));
      p.left = p.uses - p.used;
    }

    v.calc = {
      classes: (v.classes || []).length,
      prepared: (v.prepared || []).length,
      unknownSlotTypes: (v.classes || []).filter((c) => c.slotTypeUnknown).map((c) => c.slotType),
      // Anything left to spend today, across every block and the prepared list.
      spent: (v.classes || []).reduce((t, c) => t
        + (c.spells || []).reduce((n, s) => n + (Number(s.used) || 0), 0), 0)
        + (v.prepared || []).reduce((t, p) => t + (Number(p.used) || 0), 0),
    };
  }

  /**
   * A night's rest: every slot and every prepared use comes back.
   *
   * The workbook could not do this at all -- a cell holding a formula cannot also
   * hold what you spent out of it, which is why its Prep/Used column ended up as
   * somewhere to write notes instead.
   */
  vancianNewDay() {
    const v = this.data.vancian;
    if (!v) return this;
    for (const c of v.classes || []) for (const s of c.spells || []) s.used = 0;
    for (const p of v.prepared || []) p.used = 0;
    return this.recompute();
  }

  /* ---------------- psionics ---------------- */

  /**
   * Manifesting classes and the day's power points.
   *
   * One pool, fed by every manifesting class the character has:
   *
   *   class points = curve[manifester level]
   *                + floor(ability mod x manifester level / 2), per named ability
   *   pool         = the sum of those, plus a hand-entered bonus
   *
   * A class picks its curve by the total that curve reaches at level 20, not by
   * name -- so a homebrew manifesting class works by choosing the curve it runs
   * on, which is what the workbook's dropdown always did.
   *
   * The two ability terms are floored separately rather than as a sum, because
   * that is how the sheet's formula adds them.
   */
  #recomputePsionics() {
    const p = this.data.psionics;
    if (!p) return;

    const oneStat = (name) => (String(name || '').trim() ? statMod(this.data, name, '') : 0);
    let pool = 0;

    for (const c of p.classes || []) {
      // Manifester level is levels of the class, counted off the Planner the way
      // the sheet's COUNTIF did, unless a block pins it.
      const fromProgression = this.classLevelCount(c.name);
      const pinned = c.manifesterLevelOverride;
      const level = Math.max(0, Math.min(20,
        pinned === null || pinned === undefined
          ? fromProgression : Math.floor(Number(pinned) || 0)));
      c.plannerLevel = fromProgression;
      c.manifesterLevel = level;

      const base = psionicPoints(c.curveTotal, level);
      c.curveKnown = psionicCurve(c.curveTotal) !== null;
      c.basePoints = base;
      // No curve, or no level on it, means the class manifests nothing at all --
      // so it earns no ability share either. The sheet gated the whole sum the
      // same way, and showing a share of points that are not in the pool would
      // only invite adding it up by hand and getting a different answer.
      c.abilityPoints = base === null ? 0
        : Math.floor((oneStat(c.stat) * level) / 2) + Math.floor((oneStat(c.stat2) * level) / 2);
      c.points = base === null ? 0 : Math.max(0, base + c.abilityPoints);
      c.powerCount = (c.powers || []).filter((x) => x.name).length;
      pool += c.points;
    }

    p.bonusPoints = Math.max(0, Math.floor(Number(p.bonusPoints) || 0));
    p.pool = pool + p.bonusPoints;
    // Points spent today. The player's, so it is kept -- but never more than the
    // pool holds, or a class that shrinks would leave the pool overdrawn.
    p.spent = Math.max(0, Math.min(p.pool, Math.floor(Number(p.spent) || 0)));
    p.left = p.pool - p.spent;
    p.calc = {
      classes: (p.classes || []).length,
      powers: (p.classes || []).reduce((n, c) => n + (c.powerCount || 0), 0),
      unknownCurves: (p.classes || [])
        .filter((c) => c.curveTotal && !c.curveKnown).map((c) => c.curveTotal),
    };
  }

  /** A night's rest: the whole power-point pool comes back. */
  psionicsNewDay() {
    if (!this.data.psionics) return this;
    this.data.psionics.spent = 0;
    return this.recompute();
  }

  /* ---------------- card casting ---------------- */

  /**
   * The deck, checked against the drawback's rules.
   *
   * Everything here is worked out from the cards and the switches, so none of
   * it is saved:
   *
   *   casting modifier   the casting stat's modifier (Int for Nico)
   *   opening hand       1 + that modifier, at least 2 -- drawn at initiative
   *   deck size          Σ copies; the rules want at least 20
   *   spread             most copies of one effect minus fewest may not exceed
   *                      the casting modifier
   *   colour balance     with Colored Mana: every colour has an effect, and no
   *                      colour has more than half (three colours) or a quarter
   *                      (five) of them
   *   lifebound value    floor(HP / 3 / deck size), minimum 1
   *   hand limit         Tight Hand: 3 + Loaded Hand picks
   *   drawbacks for boons  1, +1 for Cooldown or Mana Pool, +1 for both, +1 for
   *                      Mana Graveyard, +1 per modification (+2 for five-colour
   *                      Colored Mana)
   *
   * Every check is advisory -- a badge and a line, never a gate. A deck the
   * table has been happy with for months is not the place to start refusing.
   */
  #recomputeCardcasting() {
    const p = this.data.cardcasting;
    if (!p) return;
    const c = this.data;

    // ---- normalise what the player typed ----
    p.mods = p.mods || {};
    for (const m of CARD_MODIFICATIONS) {
      if (m.kind === 'count') p.mods[m.key] = Math.max(0, Math.min(m.max, Math.floor(Number(p.mods[m.key]) || 0)));
      else if (m.kind === 'colors') {
        const n = Number(p.mods[m.key]) || 0;
        p.mods[m.key] = n >= 5 ? 5 : n > 0 ? 3 : 0;
      } else p.mods[m.key] = !!p.mods[m.key];
    }
    p.colors = normalizeColors(p.colors);
    p.useD100 = !!p.useD100 && p.useD100 !== '0';
    p.attunedSpheres = Array.isArray(p.attunedSpheres) ? p.attunedSpheres : [];
    p.colorSpheres = p.colorSpheres || {};
    for (const [k] of CARD_COLORS) if (!Array.isArray(p.colorSpheres[k])) p.colorSpheres[k] = [];
    p.cards = Array.isArray(p.cards) ? p.cards : [];
    p.sideboard = Array.isArray(p.sideboard) ? p.sideboard : [];
    p.manipulations = Array.isArray(p.manipulations) ? p.manipulations : [];
    for (const card of [...p.cards, ...p.sideboard]) {
      // A card saved before it had a name of its own carried the Harrow name.
      if (card.name === undefined) card.name = String(card.harrow ?? '');
      delete card.harrow;
      // Rainbow Efficiency lets an effect cost two colours, Improved up to five.
      card.color = normalizeColors(card.color);
      card.mana = normalizeColors(card.mana);
      card.effect = String(card.effect ?? '');
      card.art = String(card.art ?? '');
      card.dice = String(card.dice ?? '');
    }
    for (const card of p.cards) card.qty = Math.max(0, Math.floor(Number(card.qty ?? 1) || 0));
    p.harrow = !!p.harrow;
    // Mana Graveyard needs both halves of the ladder; Stagnant Pool and it
    // cannot both be on. Neither is forced off -- the check below says so.

    // ---- the casting modifier and what hangs off it ----
    const stat = String(p.castingStat || '').trim()
      || String((c.training?.magic?.classes || []).find((x) => x?.mod1)?.mod1 || '').trim();
    const cam = stat ? statMod(c, stat, '') : 0;
    const openingHand = Math.max(2, 1 + cam);

    // ---- deck feats, and what they bring ----
    const deckFeats = deckFeatNames(c);
    const rainbow = deckFeats.some((f) => /rainbow efficiency,? improved|improved rainbow/i.test(f)) ? 2
      : deckFeats.some((f) => /rainbow efficiency/i.test(f)) ? 1 : 0;

    // A card with no colour of its own takes its sphere's, from the
    // land-attuned table; a plain Mana Point card wears its mana.
    const sphereColor = (sphere) => {
      const want = String(sphere || '').trim().toLowerCase();
      if (!want) return '';
      for (const [k] of CARD_COLORS) {
        if ((p.colorSpheres[k] || []).some((s) => String(s).trim().toLowerCase() === want)) return k;
      }
      return '';
    };
    for (const card of [...p.cards, ...p.sideboard]) {
      const own = card.color;
      const fromSphere = own ? '' : sphereColor(card.sphere);
      const colors = own || fromSphere || (String(card.effect || '').trim() ? '' : card.mana);
      // Veilweaving sits outside sphere magic, so its cards are artifacts.
      const artifact = /veil/i.test(`${card.sphere || ''} ${card.tags || ''}`);
      card.calc = { ...(card.calc || {}), colors, fromSphere: !!fromSphere, artifact };
    }

    // ---- the deck's shape ----
    const inDeck = p.cards.filter((card) => card.qty > 0);
    const deckSize = inDeck.reduce((n, card) => n + card.qty, 0);
    const isEffect = (card) => card.effect.trim() !== '';
    const effectCards = inDeck.filter(isEffect).reduce((n, card) => n + card.qty, 0);
    const manaCards = inDeck.filter((card) => card.mana).reduce((n, card) => n + card.qty, 0);
    const pureMana = inDeck.filter((card) => !isEffect(card) && card.mana).reduce((n, card) => n + card.qty, 0);
    const fused = inDeck.filter((card) => isEffect(card) && card.mana).reduce((n, card) => n + card.qty, 0);

    // Copies of each distinct effect. The rule reads "identical effect", so the
    // name is what is compared -- case and spacing aside.
    const effectCounts = new Map();
    for (const card of inDeck) {
      if (!isEffect(card)) continue;
      const key = card.effect.trim().replace(/\s+/g, ' ').toLowerCase();
      const row = effectCounts.get(key) || { effect: card.effect.trim(), count: 0, sphere: card.sphere || '' };
      row.count += card.qty;
      effectCounts.set(key, row);
    }
    const effects = [...effectCounts.values()].sort((a, b) => b.count - a.count || a.effect.localeCompare(b.effect));
    const spreadMax = effects.length ? Math.max(...effects.map((e) => e.count)) : 0;
    const spreadMin = effects.length ? Math.min(...effects.map((e) => e.count)) : 0;

    // ---- per colour, per sphere, per suit ----
    const colorTally = Object.fromEntries(CARD_COLORS.map(([k]) => [k, { effects: 0, mana: 0 }]));
    const sphereTally = {};
    const suitTally = {};
    const alignTally = {};
    for (const card of inDeck) {
      // A two-colour effect (Rainbow Efficiency) is of each of its colours.
      if (isEffect(card)) for (const k of card.calc.colors) if (colorTally[k]) colorTally[k].effects += card.qty;
      for (const m of card.mana) if (colorTally[m]) colorTally[m].mana += card.qty;
      if (card.sphere) sphereTally[card.sphere] = (sphereTally[card.sphere] || 0) + card.qty;
      if (card.suit) suitTally[card.suit] = (suitTally[card.suit] || 0) + card.qty;
      if (card.alignment) alignTally[card.alignment] = (alignTally[card.alignment] || 0) + card.qty;
    }
    // The colours in play: what the player named, else every colour a card uses.
    const colorsInPlay = p.colors
      || CARD_COLORS.map(([k]) => k).filter((k) => colorTally[k].effects || colorTally[k].mana).join('');

    // ---- draw ranges: card n covers the copies before it ----
    let cursor = 0;
    for (const card of p.cards) {
      if (card.qty > 0) {
        Object.assign(card.calc, { from: cursor + 1, to: cursor + card.qty });
        cursor += card.qty;
      } else Object.assign(card.calc, { from: null, to: null });
    }

    // ---- the checks ----
    const issues = [];
    const mods = p.mods;
    if (deckSize && deckSize < 20) issues.push(`The deck holds ${deckSize} cards; the rules want at least 20.`);
    if (effects.length && spreadMax - spreadMin > cam) {
      issues.push(`Copies of one effect range from ${spreadMin} to ${spreadMax}, a spread of ${spreadMax - spreadMin}; the casting modifier allows ${cam}.`);
    }
    if (mods.coloredMana) {
      const n = mods.coloredMana;
      // Rainbow Efficiency loosens the balance: ¾ of effects may share a
      // colour with three colours in play, ½ with five.
      const share = n === 5 ? (rainbow ? 0.5 : 0.25) : (rainbow ? 0.75 : 0.5);
      const named = colorsInPlay.split('').filter(Boolean);
      if (named.length && named.length !== n) {
        issues.push(`Colored Mana names ${n} colours but ${named.length} ${named.length === 1 ? 'is' : 'are'} in play (${named.join(', ')}).`);
      }
      for (const k of named) {
        const t = colorTally[k];
        if (t && effectCards && t.effects === 0) issues.push(`No ${CARD_COLORS.find(([x]) => x === k)[1]} effect in the deck; every colour needs at least one.`);
        if (t && effectCards && t.effects > effectCards * share) {
          const cap = share === 0.75 ? 'three quarters' : share === 0.5 ? 'half' : 'quarter';
          issues.push(`${CARD_COLORS.find(([x]) => x === k)[1]} effects are ${t.effects} of ${effectCards}, over the ${cap} ${rainbow ? 'Rainbow Efficiency' : 'Colored Mana'} allows.`);
        }
      }
      // A card may cost as many colours as the feats allow: two with Rainbow
      // Efficiency, up to five with Improved and Colored Mana taken twice.
      const maxColors = rainbow === 2 ? (n === 5 ? 5 : 3) : rainbow === 1 ? 2 : 1;
      const over = inDeck.filter((card) => card.color.length > maxColors);
      if (over.length) {
        issues.push(`${over.length} card${over.length === 1 ? ' costs' : 's cost'} more than ${maxColors} colour${maxColors === 1 ? '' : 's'} (${over.slice(0, 3).map((x) => x.name || x.effect).join(', ')}${over.length > 3 ? '…' : ''}); that takes ${rainbow ? 'Improved ' : ''}Rainbow Efficiency.`);
      }
    }
    if (mods.singleton) {
      const dupes = effects.filter((e) => e.count > 1);
      if (dupes.length) issues.push(`Singleton: ${dupes.map((e) => `${e.effect} ×${e.count}`).join(', ')}.`);
    }
    if (p.manaGraveyard && !(p.cooldown && p.manaPool)) issues.push('Mana Graveyard needs both Cooldown and Mana Pool.');
    for (const m of CARD_MODIFICATIONS) {
      const on = m.kind === 'bool' ? mods[m.key] : Number(mods[m.key]) > 0;
      if (!on) continue;
      if (m.needs === 'cooldown' && !p.cooldown) issues.push(`${m.label} needs Cooldown.`);
      if (m.needs === 'manaPool' && !p.manaPool) issues.push(`${m.label} needs Mana Pool.`);
      if (m.clashes === 'manaGraveyard' && p.manaGraveyard) issues.push(`${m.label} and Mana Graveyard cannot both be taken.`);
    }
    if (p.useD100 && deckSize > 100) issues.push(`A d100 cannot draw from ${deckSize} cards.`);

    // ---- what the drawback is worth for boons ----
    let drawbackValue = 1;
    if (p.cooldown || p.manaPool) drawbackValue += 1;
    if (p.cooldown && p.manaPool) drawbackValue += 1;
    if (p.manaGraveyard && p.cooldown && p.manaPool) drawbackValue += 1;
    for (const m of CARD_MODIFICATIONS) {
      if (m.kind === 'count') drawbackValue += Number(mods[m.key]) || 0;
      else if (m.kind === 'colors') drawbackValue += mods[m.key] === 5 ? 2 : mods[m.key] ? 1 : 0;
      else if (mods[m.key]) drawbackValue += 1;
    }

    // ---- deck manipulations: taken against the number available ----
    for (const m of p.manipulations) m.count = Math.max(0, Math.floor(Number(m.count) || 0));
    const manipulationsTaken = p.manipulations.reduce((n, m) => n + m.count, 0);
    const loadedHand = p.manipulations
      .filter((m) => /^loaded hand/i.test(String(m.name || '')))
      .reduce((n, m) => n + m.count, 0);
    // Available: one per deck feat, plus one for Card Shark -- unless a
    // number or a formula is written over it.
    const autoAvailable = deckFeats.length + (deckFeats.some((f) => /card shark/i.test(f)) ? 1 : 0);
    let manipulationsAvailable = autoAvailable;
    let manipulationsError = null;
    if (typeof p.manipulationsAvailable === 'string' && p.manipulationsAvailable.trim() !== '') {
      try {
        const v = Number(evaluateFormula(p.manipulationsAvailable, this.scope()));
        manipulationsAvailable = Number.isFinite(v) ? Math.floor(v) : 0;
      } catch (err) {
        manipulationsError = err.message;
      }
    } else if (p.manipulationsAvailable !== null && p.manipulationsAvailable !== undefined && p.manipulationsAvailable !== '') {
      manipulationsAvailable = Math.floor(Number(p.manipulationsAvailable) || 0);
    }
    // What each pick needs, checked against the switches.
    const flagOn = { cooldown: p.cooldown, manaPool: p.manaPool, coloredMana: mods.coloredMana > 0,
      singleton: mods.singleton, gradualRamp: mods.gradualRamp, notManaGraveyard: !p.manaGraveyard };
    for (const m of p.manipulations) {
      const entry = deckManipulation(m.name);
      const unmet = entry && m.count > 0 ? entry.requires.filter((r) => !flagOn[r]) : [];
      const overMax = entry && entry.max && m.count > entry.max;
      m.calc = { known: !!entry, unmet, overMax: !!overMax };
      if (unmet.length) issues.push(`${m.name} needs ${unmet.map((r) => ({ cooldown: 'Cooldown', manaPool: 'Mana Pool', coloredMana: 'Colored Mana', singleton: 'Singleton', gradualRamp: 'Gradual Ramp', notManaGraveyard: 'no Mana Graveyard' })[r]).join(' and ')}.`);
      if (overMax) issues.push(`${m.name} can only be taken ${entry.max} times.`);
    }

    const hpTotal = (Number(c.hp?.total) || 0) + (this.mythicHp || 0);
    const lifebound = mods.lifeboundDeck && deckSize ? Math.max(1, Math.floor(hpTotal / 3 / deckSize)) : null;
    const handMax = mods.tightHand ? 3 + loadedHand : null;

    p.calc = {
      stat,
      cam,
      openingHand,
      deckSize,
      effectCards,
      manaCards,
      pureMana,
      fused,
      uniqueEffects: effects.length,
      effects,
      spreadMax,
      spreadMin,
      colorTally,
      colorsInPlay,
      sphereTally,
      suitTally,
      alignTally,
      issues,
      drawbackValue,
      deckFeats,
      rainbow,
      autoAvailable,
      manipulationsTaken,
      manipulationsAvailable,
      manipulationsError,
      manipulationsLeft: manipulationsAvailable - manipulationsTaken,
      loadedHand,
      lifebound,
      handMax,
    };

    this.#recomputeTable();
  }

  /* ---------------- the table: an encounter in play ---------------- */

  /**
   * The encounter's zones, kept on `cardcasting.table` as card instance ids
   * (`<card index>#<copy>`) so a deck of 54 saves as a few short lists.
   *
   * Nothing here is derived except `calc`; the zones are play state, kept
   * like hit points. Cards that no longer exist in the deck (a row deleted
   * mid-encounter) fall out of every zone on recompute rather than lingering
   * as ghosts, and copies added mid-encounter wait for the next shuffle.
   */
  #recomputeTable() {
    const p = this.data.cardcasting;
    if (!p) return;
    const t = p.table || (p.table = {});
    t.active = !!t.active;
    t.round = Math.max(0, Math.floor(Number(t.round) || 0));
    t.redraws = Math.max(0, Math.floor(Number(t.redraws) || 0));
    t.manaPlayed = Math.max(0, Math.floor(Number(t.manaPlayed) || 0));
    for (const zone of ['deck', 'hand', 'play', 'discard', 'exile', 'stun', 'wounds', 'death', 'faceDown']) {
      t[zone] = (Array.isArray(t[zone]) ? t[zone] : []).filter((id) => this.tableCard(id));
    }
    // A trap is a card in play that is face down; the list is the flag.
    t.faceDown = t.faceDown.filter((id) => t.play.includes(id));
    if (t.lastRoll && typeof t.lastRoll !== 'object') t.lastRoll = null;
    if (t.counters && (typeof t.counters !== 'object' || !this.tableCard(t.counters.id))) t.counters = null;
    t.lastTrigger = typeof t.lastTrigger === 'string' ? t.lastTrigger : '';
    // Mana in play carries a tapped flag (Stagnant Pool), so it is a list of
    // {id, tapped} rather than bare ids.
    t.mana = (Array.isArray(t.mana) ? t.mana : [])
      .map((m) => (typeof m === 'string' ? { id: m, tapped: false } : m))
      .filter((m) => m && this.tableCard(m.id))
      .map((m) => ({ id: String(m.id), tapped: !!m.tapped }));
    t.log = (Array.isArray(t.log) ? t.log : []).slice(-30).map(String);

    const k = p.calc;
    const seen = new Set([...t.deck, ...t.hand, ...t.play, ...t.discard, ...t.exile, ...t.stun, ...t.wounds, ...t.death, ...t.mana.map((m) => m.id)]);
    // Gradual Ramp: one Mana Point card from the hand a round -- a Mana Rock
    // (for a spell point) or a Moxen may still be played.
    const manaBlocked = !!(p.mods.gradualRamp && t.manaPlayed >= 1);
    // Copies the deck holds that are in no zone: what the next shuffle adds.
    const missing = this.tableInstances().filter((id) => !seen.has(id));
    const untapped = t.mana.filter((m) => !m.tapped);
    const handMax = k.handMax;
    t.calc = {
      inDeck: t.deck.length,
      inHand: t.hand.length,
      inPlay: t.play.length,
      inDiscard: t.discard.length,
      manaInPlay: t.mana.length,
      manaUntapped: untapped.length,
      missing: missing.length,
      handOver: handMax ? Math.max(0, t.hand.length - handMax) : 0,
      manaBlocked,
      // What each card in hand may do: cast, play as mana, roll.
      // With Mana Pool a card needs as many Mana Point cards in play as it
      // costs; under Colored Mana only mana of the card's colour counts.
      castable: Object.fromEntries(t.hand.map((id) => [id, this.#castCheck(id)])),
      manaOk: Object.fromEntries(t.hand.map((id) => [id, this.#manaPlayCheck(id, manaBlocked)])),
      trapCard: this.#hasDeckFeat(/trap card/i),
    };
  }

  /** Is a deck feat by that name on the character? */
  #hasDeckFeat(re) {
    return (this.data.cardcasting?.calc?.deckFeats || []).some((f) => re.test(f));
  }

  /** Is a manipulation by that name taken? */
  #hasManipulation(re) {
    return (this.data.cardcasting?.manipulations || []).some((m) => re.test(String(m.name || '')) && Number(m.count) > 0);
  }

  /** May this card go onto the table as mana right now? */
  #manaPlayCheck(id, blocked) {
    const card = this.tableCard(id);
    if (!card?.mana) return { ok: false, why: 'no mana on the card' };
    if (!blocked) return { ok: true, why: '' };
    const tags = String(card.tags || '');
    if (/mana rock/i.test(tags)) return { ok: true, why: 'Mana Rock: spend a spell point to play it past Gradual Ramp' };
    if (/moxen/i.test(tags)) return { ok: true, why: 'Moxen: may be played past Gradual Ramp' };
    return { ok: false, why: 'Gradual Ramp: one Mana Point card a round' };
  }

  /** Every copy of every card as an instance id, in deck order. */
  tableInstances() {
    const p = this.data.cardcasting;
    const out = [];
    (p?.cards || []).forEach((card, i) => {
      for (let n = 0; n < (Number(card.qty) || 0); n++) out.push(`${i}#${n}`);
    });
    return out;
  }

  /** The card an instance id stands for, or null. */
  tableCard(id) {
    const m = /^(\d+)#(\d+)$/.exec(String(id || ''));
    if (!m) return null;
    const card = this.data.cardcasting?.cards?.[Number(m[1])];
    if (!card || Number(m[2]) >= (Number(card.qty) || 0)) return null;
    return card;
  }

  /** Can this card in hand be cast right now, and with what? Advisory. */
  #castCheck(id) {
    const p = this.data.cardcasting;
    const t = p.table;
    const card = this.tableCard(id);
    if (!card) return { ok: false, why: 'no such card' };
    const isEffect = String(card.effect || '').trim() !== '';
    const cost = parseInt(String(card.cost || '').trim(), 10);
    const need = Number.isFinite(cost) ? Math.max(0, cost) : 0;
    if (!isEffect) return { ok: true, need: 0, have: 0, mana: true };
    if (!p.manaPool) return { ok: true, need, have: need };
    const colors = String(card.calc?.colors || '');
    const usable = t.mana.filter((m) => {
      if (m.tapped) return false;
      if (!p.mods.coloredMana || !colors) return true;
      const manaCard = this.tableCard(m.id);
      const letters = String(manaCard?.mana || '');
      return [...colors].some((c) => letters.includes(c));
    });
    // Rainbow Efficiency: a two-colour card needs a mana card of each colour.
    let ok = usable.length >= need;
    let why = ok ? '' : `needs ${need} mana in play, has ${usable.length}`;
    if (ok && p.mods.coloredMana && colors.length > 1) {
      const covered = [...colors].every((c) => t.mana.some((m) => !m.tapped && String(this.tableCard(m.id)?.mana || '').includes(c)));
      if (!covered) { ok = false; why = `needs mana of each colour (${colors})`; }
    }
    return { ok, need, have: usable.length, why };
  }

  /** A shuffle. `this.rng` may be replaced for a deterministic test. */
  #shuffle(ids) {
    const out = [...ids];
    const rng = this.rng || Math.random;
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  #tableLog(t, text) {
    t.log = [...(t.log || []), `R${t.round}: ${text}`].slice(-30);
  }

  #tableName(id) {
    const card = this.tableCard(id);
    if (!card) return id;
    return card.name || card.effect || (card.mana ? `Mana (${card.mana})` : 'card');
  }

  /**
   * Draw n cards to the hand. A Mana Point card drawn under Mana Pool goes
   * straight to the table (unless Gradual Ramp holds it in hand to be played
   * one a round); Tight Hand stops a draw at the limit; an empty deck under
   * Cooldown reshuffles the discard first (a free action) unless Deckout
   * forbids it. Returns what was drawn, by name.
   */
  #tableDraw(n, why = 'draw') {
    const p = this.data.cardcasting;
    const t = p.table;
    const k = p.calc;
    const drawn = [];
    const triggered = [];
    for (let i = 0; i < n; i++) {
      if (k.handMax && t.hand.length >= k.handMax) { this.#tableLog(t, `hand is full (${k.handMax})`); break; }
      if (!t.deck.length && p.cooldown && !p.mods.deckout && t.discard.length) {
        t.deck = this.#shuffle(t.discard);
        t.discard = [];
        this.#tableLog(t, 'deck empty — discard shuffled back in');
      }
      if (!t.deck.length) { this.#tableLog(t, 'deck is empty — no card to draw'); break; }
      const id = t.deck.shift();
      const card = this.tableCard(id);
      const pureMana = card && !String(card.effect || '').trim() && card.mana;
      if (pureMana && p.manaPool && !p.mods.gradualRamp) {
        t.mana.push({ id, tapped: false });
        drawn.push(`${this.#tableName(id)} → table`);
      } else {
        t.hand.push(id);
        drawn.push(this.#tableName(id));
      }
      // Grave Peril's clause: drawn with nothing else in deck or hand.
      if (/\[\s*on\s*draw\s*\]/i.test(String(card?.effect || ''))) triggered.push(id);
      if (t.counters?.id === id && !t.counters.drawn) {
        t.counters.drawn = true;
        const { early, late } = t.counters;
        const branch = early > 0 ? `Early counters (${early}): discard the top ${2 * early} cards of the deck, then remove them`
          : late > 0 ? `Late counters (${late}): take Life Draw × ${2 * late} damage, then remove them`
            : 'no counters: a free-action ranged attack with every erratic blast';
        this.#tableLog(t, `[Ante] ${this.#tableName(id)} drawn — ${branch}`);
      }
    }
    if (drawn.length) this.#tableLog(t, `${why}: ${drawn.join(', ')}`);
    for (const id of triggered) this.#tableTrigger(id, 'draw');
    return drawn;
  }

  /** Initiative: build the deck from every copy, shuffle, draw the opening hand. */
  tableStart() {
    const p = this.data.cardcasting;
    if (!p) return this;
    const t = p.table;
    const k = p.calc;
    Object.assign(t, {
      active: true, round: 1, redraws: 0, manaPlayed: 0,
      deck: this.#shuffle(this.tableInstances()), hand: [], play: [], mana: [], discard: [], exile: [],
      stun: [], wounds: [], death: [], faceDown: [], log: [], counters: null, lastRoll: null, lastTrigger: '',
    });
    const loaded = 2 * (k.loadedHand || 0);
    this.#tableLog(t, `encounter begins — ${t.deck.length} cards shuffled`);
    this.#tableDraw(k.openingHand + loaded, `opening hand (${k.openingHand}${loaded ? ` + ${loaded} Loaded Hand` : ''})`);
    return this.recompute();
  }

  /** Shuffle the hand back and draw one fewer -- the same number the first time with Mulligan. */
  tableRedraw() {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    const k = p.calc;
    const size = t.hand.length + (t.round === 1 ? t.mana.length : 0);
    const mulligan = t.redraws === 0 && (p.manipulations || []).some((m) => /^mulligan/i.test(m.name) && m.count > 0);
    const next = Math.max(0, mulligan ? size : size - 1);
    if (size <= 1) { this.#tableLog(t, 'cannot redraw a hand of one'); return this.recompute(); }
    // Mana drawn into play at initiative goes back with the hand.
    const back = [...t.hand];
    t.deck = this.#shuffle([...t.deck, ...t.hand, ...(t.round === 1 ? t.mana.map((m) => m.id) : [])]);
    t.hand = [];
    for (const id of back) this.#tableTrigger(id, 'redraw');
    if (t.round === 1) t.mana = [];
    t.redraws += 1;
    this.#tableLog(t, `hand shuffled back${mulligan ? ' (Mulligan)' : ''}`);
    this.#tableDraw(next, `redraw ${t.redraws}`);
    return this.recompute();
  }

  /** A new round: draw one (not under Exposed Grip), untap Stagnant Pool mana. */
  tableNextRound() {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    t.round += 1;
    t.manaPlayed = 0;
    if (p.mods.stagnantPool) for (const m of t.mana) m.tapped = false;
    // Perfect Draw's counters: Early ones tick down each turn; once they are
    // gone and the card is still in the deck, a Late one arrives each turn.
    if (t.counters && !t.counters.drawn) {
      const level = Number(this.data.identity?.level) || 0;
      const maxAnte = 2 + Math.floor(Math.max(0, level - 1) / 4);
      if (t.counters.early > 0) t.counters.early -= 1;
      else if (t.counters.late < maxAnte) t.counters.late += 1;
      this.#tableLog(t, `[Ante] ${this.#tableName(t.counters.id)}: ${t.counters.early} Early, ${t.counters.late} Late`);
    }
    if (p.mods.exposedGrip) this.#tableLog(t, 'round begins — Exposed Grip: no automatic draw');
    else this.#tableDraw(1, 'round draw');
    if (p.mods.deckout && !t.deck.length) this.#tableLog(t, 'Deckout: the deck is empty — 4 Constitution burn this turn');
    return this.recompute();
  }

  /** Draw n cards for whatever reason (Rapid Fill, Life Draw, Prize Card…). */
  tableDraw(n = 1, why = 'draw') {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    this.#tableDraw(Math.max(1, Math.floor(Number(n) || 1)), why);
    return this.recompute();
  }

  /**
   * Play a card from the hand.
   *
   *   mode 'cast'     the effect resolves at once: the card goes back to the
   *                   deck, or to the discard under Cooldown
   *   mode 'ongoing'  the effect lasts: the card stays in play until resolved
   *   mode 'mana'     a Mana Point card (or the mana half of a fused one) onto
   *                   the table
   *
   * Under Mana Pool the cost is paid from mana in play: Mana Graveyard sends
   * that many Mana Point cards to the discard, Stagnant Pool taps them, and
   * otherwise they simply need to be there. Nothing is refused -- the check
   * is shown beside the card and the player decides.
   */
  tablePlay(id, mode = 'cast') {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    const at = t.hand.indexOf(id);
    if (at < 0) return this;
    const card = this.tableCard(id);
    if (!card) return this;
    const name = this.#tableName(id);

    if (mode === 'mana') {
      const may = this.#manaPlayCheck(id, !!(p.mods.gradualRamp && t.manaPlayed >= 1));
      if (!may.ok) { this.#tableLog(t, `${name} not played — ${may.why}`); return this.recompute(); }
      t.hand.splice(at, 1);
      t.mana.push({ id, tapped: false });
      t.manaPlayed += 1;
      this.#tableLog(t, `${name} played as mana${may.why ? ` (${may.why})` : ''}`);
      return this.recompute();
    }
    t.hand.splice(at, 1);

    // A trap: face down in play until it springs. Nothing is paid yet.
    if (mode === 'trap') {
      t.play.push(id);
      t.faceDown.push(id);
      this.#tableLog(t, `a card set face down${this.#hasDeckFeat(/trap card/i) ? '' : ' (Trap Card is not among the deck feats)'}`);
      return this.recompute();
    }

    // Pay for it, where paying means anything.
    const check = this.#castCheck(id);
    const cost = check.need || 0;
    if (p.manaPool && cost > 0 && (p.manaGraveyard || p.mods.stagnantPool)) {
      const colors = String(card.calc?.colors || '');
      const eligible = (m) => !m.tapped && (!p.mods.coloredMana || !colors
        || [...colors].some((c) => String(this.tableCard(m.id)?.mana || '').includes(c)));
      let left = cost;
      // Colour-matching mana first, one of each colour a multi-colour card wants.
      const order = [...t.mana].sort((a, b) => (eligible(b) ? 1 : 0) - (eligible(a) ? 1 : 0));
      const spent = [];
      for (const m of order) {
        if (left <= 0) break;
        if (!eligible(m)) continue;
        spent.push(m);
        left -= 1;
      }
      if (p.manaGraveyard) {
        t.mana = t.mana.filter((m) => !spent.includes(m));
        t.discard.push(...spent.map((m) => m.id));
      } else for (const m of spent) m.tapped = true;
      this.#tableLog(t, `${name} cast for ${cost}${check.ok ? '' : ` — ${check.why}`}; ${spent.length} mana ${p.manaGraveyard ? 'to the discard' : 'tapped'}`);
    } else {
      this.#tableLog(t, `${name} cast${cost ? ` for ${cost}` : ''}${check.ok ? '' : ` — ${check.why}`}`);
    }

    // The spell points themselves, from the tracker if there is one.
    if (cost > 0) this.#spendSP(cost, name);
    // Its dice, if it has any.
    this.#rollFor(id);

    // Keywords in the card's text fire as it is cast.
    const fate = this.#tableKeywords(id, card);
    if (mode === 'ongoing') t.play.push(id);
    else this.#tableSettle(id, fate);
    return this.recompute();
  }

  /**
   * Retrace: cast a card straight from the discard pile, for one spell point
   * more (or a longer casting time -- the player's choice; the point is
   * charged here, and Spend 1 SP can be left alone if time was paid instead).
   * The card is paid for, rolled and its keywords fire, and it returns to the
   * discard, since it was never in the hand.
   */
  tableRetrace(id) {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    const at = t.discard.indexOf(id);
    if (at < 0) return this;
    const card = this.tableCard(id);
    if (!card) return this;
    t.discard.splice(at, 1);
    const name = this.#tableName(id);
    const cost = parseInt(String(card.cost || '').trim(), 10) || 0;
    this.#tableLog(t, `Retrace: ${name} cast from the discard${cost ? ` for ${cost}` : ''} + 1 spell point`);
    this.#spendSP(cost + 1, `${name} (Retrace)`);
    this.#rollFor(id);
    const fate = this.#tableKeywords(id, card);
    if (fate && fate !== 'deck') this.#tableSettle(id, fate);
    else t.discard.push(id);
    return this.recompute();
  }

  /** Read the Cards: the top card to the bottom of the deck, for a spell point. */
  tableBury(id) {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    if (t.deck[0] !== id && !t.deck.slice(0, 3).includes(id)) return this;
    t.deck = t.deck.filter((x) => x !== id);
    t.deck.push(id);
    this.#tableLog(t, `Read the Cards: ${this.#tableName(id)} to the bottom of the deck`);
    this.#spendSP(1, 'Read the Cards');
    return this.recompute();
  }

  /** Roll a card's dice as part of casting it, if it has any; quiet otherwise. */
  #rollFor(id) {
    const card = this.tableCard(id);
    if (!card) return;
    if (this.cardRolls(card).length) this.tableRoll(id, { quiet: true });
  }

  /**
   * Keywords in square brackets on a card do table things when it is cast:
   *
   *   [Draw N]      draw N                    [Mill N]    top N of the deck to the discard
   *   [Discard N]   discard N (you choose)    [Peek N]    Read the Cards
   *   [Shuffle]     the discard into the deck [Untap]     untap every Mana Point card
   *   [Tap N]       tap N Mana Point cards    [Wild]      Wild Card: search the deck
   *   [Exile]       this card is exiled       [Bottom]    …goes to the bottom of the deck
   *   [Return]      …returns to the hand      [Top]       …goes on top of the deck
   *
   * The ones that stand in for a deck manipulation want it taken: [Peek] Read
   * the Cards, [Wild] Wild Card, [Exile] Impulse or Control Caster, [Return]
   * Recollection. Otherwise the keyword is logged and skipped rather than
   * refused outright -- the table says what it did not do.
   * Returns where the card itself should end up, if a keyword said.
   */
  #tableKeywords(id, card) {
    const p = this.data.cardcasting;
    const t = p.table;
    let fate = null;
    const text = String(card.effect || '');
    const re = /\[\s*(draw|discard|shuffle|tap|untap|mill|peek|wild|exile|bottom|top|return|deck|ante)\s*(\d+)?\s*\]/gi;
    // What a card does to itself -- exile, bottom, top, return -- is its own
    // rule; only the keywords that stand in for a manipulation want it taken.
    const may = {
      peek: [() => this.#hasManipulation(/^read the cards/i), 'Read the Cards'],
      wild: [() => this.#hasManipulation(/^wild ?card/i), 'Wild Card'],
    };
    let m;
    while ((m = re.exec(text))) {
      const kw = m[1].toLowerCase();
      const n = Math.max(1, Number(m[2]) || 1);
      if (may[kw] && !may[kw][0]()) { this.#tableLog(t, `[${kw}] skipped — needs ${may[kw][1]}`); continue; }
      switch (kw) {
        case 'draw': this.#tableDraw(n, `[Draw ${n}]`); break;
        case 'discard': this.#tableLog(t, `[Discard ${n}]: choose ${n} card${n === 1 ? '' : 's'} in hand to discard`); break;
        case 'shuffle':
          if (p.cooldown && t.discard.length && !p.mods.deckout) { t.deck = this.#shuffle([...t.deck, ...t.discard]); this.#tableLog(t, `[Shuffle]: ${t.discard.length} from the discard into the deck`); t.discard = []; } else { t.deck = this.#shuffle(t.deck); this.#tableLog(t, '[Shuffle]: deck shuffled'); }
          break;
        case 'tap': { let left = n; for (const x of t.mana) { if (left && !x.tapped) { x.tapped = true; left--; } } this.#tableLog(t, `[Tap ${n}]`); break; }
        case 'untap': for (const x of t.mana) x.tapped = false; this.#tableLog(t, '[Untap]: all mana untapped'); break;
        case 'mill': {
          const gone = t.deck.splice(0, n);
          t.discard.push(...gone);
          this.#tableLog(t, `[Mill ${n}]: ${gone.map((g) => this.#tableName(g)).join(', ') || 'nothing'}`);
          for (const g of gone) this.#tableTrigger(g, 'mill');
          break;
        }
        case 'peek': this.#tableLog(t, `[Peek ${n}]: ${this.tablePeek(n).map((g) => this.#tableName(g)).join(', ') || 'deck is empty'}`); break;
        case 'wild': this.#tableLog(t, '[Wild]: search the deck for a card — move it to the hand'); break;
        case 'exile': fate = 'exile'; break;
        case 'bottom': fate = 'deckBottom'; break;
        case 'top': fate = 'deckTop'; break;
        case 'return': fate = 'hand'; break;
        case 'deck': fate = 'deck'; break;
        case 'ante': {
          // Perfect Draw: shuffle back in with Early counters equal to the
          // maximum ante (2 + 1 per 4 levels past 1st); a second cast, once
          // drawn again, exiles it.
          if (t.counters?.id === id && t.counters.drawn) {
            fate = 'exile';
            t.counters = null;
            this.#tableLog(t, `[Ante] ${this.#tableName(id)} played after its draw — exiled`);
          } else {
            const level = Number(this.data.identity?.level) || 0;
            const maxAnte = 2 + Math.floor(Math.max(0, level - 1) / 4);
            t.counters = { id, early: maxAnte, late: 0, drawn: false };
            fate = 'deck';
            this.#tableLog(t, `[Ante] ${this.#tableName(id)} shuffled back with ${maxAnte} Early counters`);
          }
          break;
        }
        default: break;
      }
    }
    return fate;
  }

  /**
   * A card's trigger tags: [OnMill], [OnRedraw], [OnDraw], [OnDiscard],
   * [OnExile] mark the sentence that applies when that happens to the card.
   * The table logs it and keeps it in `lastTrigger` for the header.
   */
  #tableTrigger(id, when) {
    const t = this.data.cardcasting?.table;
    const card = this.tableCard(id);
    if (!t || !card) return;
    const re = new RegExp(`\\[\\s*on\\s*${when}\\s*\\]\\s*([^\\n]*)`, 'i');
    const m = re.exec(String(card.effect || ''));
    if (!m) return;
    const sentence = m[1].trim().slice(0, 220);
    const line = `⚡ ${this.#tableName(id)} (${when}): ${sentence}`;
    t.lastTrigger = line;
    this.#tableLog(t, line);
  }

  /** A resolved card goes home: the discard under Cooldown, else back into the deck -- unless a keyword said otherwise. */
  #tableSettle(id, fate = null) {
    const p = this.data.cardcasting;
    const t = p.table;
    if (fate === 'exile') { t.exile.push(id); this.#tableLog(t, `${this.#tableName(id)} exiled`); this.#tableTrigger(id, 'exile'); return; }
    if (fate === 'deck') { t.deck = this.#shuffle([...t.deck, id]); return; }
    if (fate === 'deckBottom') { t.deck.push(id); return; }
    if (fate === 'deckTop') { t.deck.unshift(id); return; }
    if (fate === 'hand') { t.hand.push(id); this.#tableLog(t, `${this.#tableName(id)} returns to the hand`); return; }
    if (p.cooldown) t.discard.push(id);
    else t.deck = this.#shuffle([...t.deck, id]);
  }

  /** An ongoing effect ends, or a trap springs: its card leaves play. */
  tableResolve(id) {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    const at = t.play.indexOf(id);
    if (at < 0) return this;
    t.play.splice(at, 1);
    const wasTrap = t.faceDown.includes(id);
    t.faceDown = t.faceDown.filter((x) => x !== id);
    const card = this.tableCard(id);
    // A trap that springs is cast then: it is paid for and its keywords fire now.
    if (wasTrap) {
      const cost = parseInt(String(card?.cost || '').trim(), 10);
      if (cost > 0) this.#spendSP(cost, this.#tableName(id));
      this.#rollFor(id);
    }
    const fate = wasTrap ? this.#tableKeywords(id, card) : null;
    this.#tableSettle(id, fate);
    this.#tableLog(t, `${this.#tableName(id)} ${wasTrap ? 'springs' : 'resolved'}`);
    return this.recompute();
  }

  /**
   * The Spell Points tracker, if the character keeps one -- by name, so a
   * player's own "Spell Points" (or "SP") pool is found however it was made.
   * A tracker's `current` counts what has been spent.
   */
  spellPointTracker() {
    return this.trackers.find((t) => /^spell\s*points?$|^sp$/i.test(String(t.name || '').trim())) || null;
  }

  /** Spend n spell points from the tracker, if there is one; log it on the table. */
  #spendSP(n, why) {
    const t = this.data.cardcasting?.table;
    const sp = this.spellPointTracker();
    if (!sp || !(n > 0)) return null;
    const max = Number(sp.max) || 0;
    const before = Number(sp.current) || 0;
    const after = Math.max(Number(sp.min) || 0, Math.min(max, before + n));
    sp.current = after;
    const left = max - after;
    if (t) this.#tableLog(t, `${why}: ${after - before} spell point${after - before === 1 ? '' : 's'} spent, ${left} left${after - before < n ? ' — the pool ran out' : ''}`);
    return left;
  }

  /** Spend spell points on a card's modal effect (a boost, an extra option). */
  tableSpend(id, n = 1) {
    const p = this.data.cardcasting;
    if (!p?.table) return this;
    if (!this.spellPointTracker()) { this.#tableLog(p.table, 'no Spell Points tracker to spend from'); return this.recompute(); }
    this.#spendSP(Math.max(1, Math.floor(Number(n) || 1)), id ? `${this.#tableName(id)} — extra` : 'spent');
    return this.recompute();
  }

  /** A face-down trap turned face up, still in play. */
  tableReveal(id) {
    const t = this.data.cardcasting?.table;
    if (!t || !t.faceDown.includes(id)) return this;
    t.faceDown = t.faceDown.filter((x) => x !== id);
    this.#tableLog(t, `${this.#tableName(id)} revealed`);
    return this.recompute();
  }

  /**
   * Roll a card's dice: its Dice field, or the first dice in its text.
   * `4d6+int.mod` rolls four dice and adds the modifier from the sheet.
   */
  /**
   * A card's rolls, from its Dice field: several may be listed, separated by
   * ";" or newlines, each optionally labelled -- "8d6; boost: 15d6; milled: 8d4".
   * The first is what a cast rolls on its own; the rest are offered by name.
   * With no Dice field, the first dice in the text is the one roll.
   */
  cardRolls(card) {
    const field = String(card?.dice || '').trim();
    if (field) {
      return field.split(/[;\n]+/).map((part, i) => {
        const m = /^\s*([^:]{1,40}?)\s*:\s*(.+)$/.exec(part);
        const label = m ? m[1].trim() : (i === 0 ? 'roll' : `roll ${i + 1}`);
        const expr = (m ? m[2] : part).trim();
        // "boost (1 SP): 15d6" -- the points a variant costs, spent when it is picked.
        const cost = /\((\d+)\s*sp\)/i.exec(label);
        return expr ? { label, expr, sp: cost ? Number(cost[1]) : 0 } : null;
      }).filter(Boolean);
    }
    const inText = String(card?.effect || '').match(/(?:\{[^{}]*\}|\d+)\s*d\s*\d+(?:\s*[+-]\s*(?:\{[^{}]*\}|[\w.]+))*/i);
    return inText ? [{ label: 'roll', expr: inText[0], sp: 0 }] : [];
  }

  tableRoll(id, { quiet = false, which = 0 } = {}) {
    const p = this.data.cardcasting;
    if (!p?.table) return this;
    const t = p.table;
    const card = this.tableCard(id);
    if (!card) return this;
    const done = () => (quiet ? this : this.recompute());
    // Formulas in the dice come first: "{ceil(caster.level/2)}d6" is 8d6 at
    // caster level 15, in the Dice field or in the text.
    const resolved = (text) => this.renderProse(text).map((s) => (s.kind === 'text' ? s.text : s.error ? s.raw : String(s.value))).join('');
    const options = this.cardRolls(card);
    const pick = typeof which === 'number' ? options[which] : options.find((r) => r.label.toLowerCase() === String(which).toLowerCase());
    const source = pick ? resolved(pick.expr) : '';
    const label = pick && pick.label !== 'roll' ? ` (${pick.label})` : '';
    if (!source) { if (!quiet) this.#tableLog(t, `${this.#tableName(id)}: nothing to roll`); return done(); }
    const scope = this.scope();
    const { dice, flat, error } = parseDiceExpr(source, (rem) => evaluateFormula(rem, scope));
    const rng = this.rng || Math.random;
    const rolls = [];
    let total = flat;
    for (const [sides, count] of Object.entries(dice)) {
      for (let i = 0; i < Math.abs(count); i++) {
        const r = 1 + Math.floor(rng() * Number(sides));
        rolls.push(r);
        total += count < 0 ? -r : r;
      }
    }
    t.lastRoll = { id, source, rolls, flat, total, error: error || null, label: pick?.label || 'roll' };
    this.#tableLog(t, `${this.#tableName(id)} rolls${label} ${source}: [${rolls.join(', ')}]${flat ? ` ${flat >= 0 ? '+' : '−'} ${Math.abs(flat)}` : ''} = ${total}${error ? ` (${error})` : ''}`);
    return done();
  }

  /** Spend spell points and roll a named variant in one go -- "boost" for a point more. */
  tableBoost(id, which) {
    const p = this.data.cardcasting;
    if (!p?.table) return this;
    const roll = this.cardRolls(this.tableCard(id)).find((r) => r.label.toLowerCase() === String(which).toLowerCase());
    if (!roll) return this;
    if (roll.sp > 0 && this.spellPointTracker()) this.#spendSP(roll.sp, `${this.#tableName(id)} — ${roll.label}`);
    return this.tableRoll(id, { which });
  }

  /**
   * Move one card between zones by hand -- discard from the hand (Bleeding
   * Hand, Into Nothing), return from the discard (Recollection, Resupply),
   * exile (Impulse), the Lifebound piles, or just putting right a misclick.
   * `to` is a zone name; 'deck' shuffles it in, 'deckTop' puts it on top.
   */
  tableMove(id, to) {
    const p = this.data.cardcasting;
    if (!p?.table) return this;
    const t = p.table;
    let from = null;
    for (const zone of ['deck', 'hand', 'play', 'discard', 'exile', 'stun', 'wounds', 'death']) {
      const at = t[zone].indexOf(id);
      if (at >= 0) { t[zone].splice(at, 1); from = zone; }
    }
    const mi = t.mana.findIndex((m) => m.id === id);
    if (mi >= 0) { t.mana.splice(mi, 1); from = 'mana'; }
    if (!from) return this;
    if (to === 'mana') t.mana.push({ id, tapped: false });
    else if (to === 'deck') t.deck = this.#shuffle([...t.deck, id]);
    else if (to === 'deckTop') t.deck.unshift(id);
    else if (to === 'deckBottom') t.deck.push(id);
    else if (t[to]) t[to].push(id);
    else return this.recompute();
    this.#tableLog(t, `${this.#tableName(id)} → ${to === 'deckTop' ? 'top of deck' : to === 'deckBottom' ? 'bottom of deck' : to}`);
    // What the move means to the card: off the top of the deck into the
    // discard is a mill, out of the hand into it a discard, and so on.
    if (to === 'discard' && from === 'deck') this.#tableTrigger(id, 'mill');
    else if (to === 'discard' && from === 'hand') this.#tableTrigger(id, 'discard');
    else if (to === 'exile') this.#tableTrigger(id, 'exile');
    else if ((to === 'deck' || to === 'deckTop' || to === 'deckBottom') && from === 'hand') this.#tableTrigger(id, 'redraw');
    return this.recompute();
  }

  /** Exile n cards at random from the discard (Blood and Dust, Grave Peril). */
  tableExileRandom(n = 1) {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    const rng = this.rng || Math.random;
    const gone = [];
    for (let i = 0; i < n && t.discard.length; i++) {
      const at = Math.floor(rng() * t.discard.length);
      gone.push(t.discard.splice(at, 1)[0]);
    }
    if (!gone.length) return this;
    t.exile.push(...gone);
    this.#tableLog(t, `${gone.length} exiled at random from the discard: ${gone.map((g) => this.#tableName(g)).join(', ')}`);
    for (const g of gone) this.#tableTrigger(g, 'exile');
    return this.recompute();
  }

  /** Tap or untap a Mana Point card in play (Stagnant Pool). */
  tableTap(id, tapped = null) {
    const p = this.data.cardcasting;
    const m = p?.table?.mana.find((x) => x.id === id);
    if (!m) return this;
    m.tapped = tapped === null ? !m.tapped : !!tapped;
    return this.recompute();
  }

  /** Cooldown's full-round action: the discard pile shuffled into the deck. */
  tableShuffleDiscard() {
    const p = this.data.cardcasting;
    if (!p?.table?.active) return this;
    const t = p.table;
    if (!t.discard.length) return this;
    t.deck = this.#shuffle([...t.deck, ...t.discard]);
    this.#tableLog(t, `${t.discard.length} cards shuffled from the discard into the deck`);
    t.discard = [];
    return this.recompute();
  }

  /** Read the Cards: the top n of the deck, by id, without moving them. */
  tablePeek(n = 1) {
    return (this.data.cardcasting?.table?.deck || []).slice(0, Math.max(1, n));
  }

  /** The encounter ends: everything back into the deck, shuffled. */
  tableEnd() {
    const p = this.data.cardcasting;
    if (!p?.table) return this;
    const t = p.table;
    const all = [...t.deck, ...t.hand, ...t.play, ...t.discard, ...t.exile, ...t.mana.map((m) => m.id)];
    const exiled = t.exile.length;
    Object.assign(t, {
      active: false, round: 0, redraws: 0, manaPlayed: 0,
      deck: this.#shuffle(all), hand: [], play: [], mana: [], discard: [], exile: [], faceDown: [],
      counters: null, lastRoll: null, lastTrigger: '',
    });
    this.#tableLog(t, `encounter over — everything shuffled back${exiled ? ` (${exiled} exiled cards: half return now, the rest one a minute)` : ''}`);
    return this.recompute();
  }

  /* ---------------- primordia techniques ---------------- */

  /**
   * Is the chosen technique's prerequisite met?
   *
   * Advisory, never a gate. Three of the five can be answered outright from
   * what the sheet models; the other two cannot always be, and a technique the
   * player has plainly been using for fifteen levels is not the place to start
   * arguing -- so an answer this cannot reach is `unknown` and says why, rather
   * than a "no" that is really "I could not tell".
   */
  #primordiaPrereq(technique) {
    const c = this.data;
    const key = technique?.prereq?.key;
    const met = (detail) => ({ state: 'met', detail });
    const unmet = (detail) => ({ state: 'unmet', detail });
    const unknown = (detail) => ({ state: 'unknown', detail });

    if (key === 'bab') {
      const best = Math.max(0, ...(c.classes || []).filter((x) => x.name).map((x) => Number(x.bab) || 0));
      if (!best) return unknown('No class on the Overview names a BAB progression.');
      const label = best >= 1 ? 'full' : `${Math.round(best * 4)}/4`;
      return best >= 0.75 ? met(`Best BAB progression is ${label}.`)
        : unmet(`Best BAB progression is ${label}.`);
    }
    if (key === 'spherecasting') {
      const casters = (c.training?.magic?.classes || []).filter((x) => x.name);
      const good = casters.filter((x) => ['Mid', 'High'].includes(x.effectiveType));
      if (good.length) return met(`${good.map((x) => `${x.name} (${x.effectiveType})`).join(', ')}.`);
      // Advanced Magic Training casts as a Low caster, or Mid with the mythic one.
      if (c.training?.magic?.mythicAmt) return met('Mythic Advanced Magic Training casts as Mid.');
      return casters.length
        ? unmet(`${casters.map((x) => x.name).join(', ')} — none casts at Mid or High.`)
        : unmet('No spherecasting class on the Spheres & Magic tab.');
    }
    if (key === 'vancian') {
      const named = (c.vancian?.classes || []).filter((x) => String(x.name || '').trim());
      return named.length
        ? met(`${named.map((x) => x.name).join(', ')} on the Vancian tab.`)
        : unmet('No casting class on the Vancian tab.');
    }
    if (key === 'armor') {
      const p = c.identity?.proficiencies || {};
      const armor = p.armor || [];
      if (!armor.length) {
        return /armor/i.test(p.notes || '')
          ? unknown(`Armor proficiency on the Overview is only a note: ${p.notes}`)
          : unknown('Armor proficiency is blank on the Overview.');
      }
      const label = `${armor.join(', ')} armor`;
      return armor.some((a) => /^(?:medium|heavy)$/i.test(a)) ? met(label) : unmet(label);
    }
    if (key === 'psionics') {
      return unknown('Psionics is a plain worksheet here, so manifesting is not something '
        + 'the sheet can check.');
    }
    return unknown('');
  }

  /**
   * The technique ladder: one row per granting level, each carrying what the
   * rules hand over there and what the player wrote against it.
   *
   * Everything on it is rebuilt from the rules table and the character's level,
   * so the only thing stored is the writing -- the same bargain the Akashic and
   * Maneuvers tabs made with their worksheets.
   */
  #recomputePrimordia() {
    const c = this.data;
    const p = c.primordia || (c.primordia = { picks: {}, alt: {}, notes: '' });
    const level = Number(c.identity.level) || 0;
    const technique = primordiaTechnique(c.identity.primordiaTechnique);

    const counts = {
      talent: 0, feat: 0, spell: 0, power: 0, due: 0, planned: 0,
    };
    const rows = PRIMORDIA_LEVELS.map((lvl) => {
      const reached = lvl <= level;
      const grants = primordiaGrantsAt(technique, lvl).map((g) => {
        // "If they already possess it, they instead gain…": one grant with two
        // faces, and which one is live decides what the ladder counts. The
        // branch *replaces* the grant rather than adding to it, so the kinds
        // come off before the alternative's go on -- a feat swapped for a
        // spell is one thing gained, not two.
        if (!g.alt || !p.alt[lvl]) return { ...g, base: g, alt: false };
        const {
          talent, feat, spell, power, ...rest
        } = g;
        return { ...rest, ...g.alt, base: g, alt: true };
      });
      const text = String(p.picks[lvl] ?? '');
      const pick = grants.find((g) => g.pick)?.pick || null;
      const filled = text.trim() !== '';
      const due = !!pick && reached && !filled;

      if (reached) {
        for (const g of grants) {
          for (const kind of ['talent', 'feat', 'spell', 'power']) {
            counts[kind] += grantCount(g, kind);
          }
        }
        if (due) counts.due += 1;
      } else if (pick && !filled) counts.planned += 1;

      return {
        level: lvl,
        repeating: lvl >= PRIMORDIA_REPEAT_FROM,
        grants,
        pick,
        text,
        reached,
        filled,
        due,
      };
    });

    p.calc = {
      technique: technique?.name || null,
      unknown: !technique && !!String(c.identity.primordiaTechnique || '').trim(),
      note: technique?.note || '',
      // Printed once under the ladder, because it lands on seven rows.
      repeat: technique?.repeat || null,
      prereq: technique ? { text: technique.prereq.text, ...this.#primordiaPrereq(technique) } : null,
      talents: this.#primordiaTalents(),
      counts,
      rows,
    };
  }

  /* ---------------- hit points at the table ---------------- */

  /**
   * Current/temporary/nonlethal hit points.
   *
   * The source sheets only record a maximum, so play state is initialised to
   * full the first time it is needed and then tracked here.
   */
  /** Bonus hit points from mythic tiers (bonus HP/tier × tier). */
  get mythicHp() {
    return (Number(this.data.mythic?.bonusHpPerTier) || 0)
      * (Number(this.data.identity?.mythicTier) || 0);
  }

  get hpState() {
    const hp = this.data.hp;
    const max = (Number(hp.total) || 0) + this.mythicHp;
    if (hp.current === undefined || hp.current === null) hp.current = max;
    if (hp.temp === undefined || hp.temp === null) hp.temp = 0;
    if (hp.nonlethal === undefined || hp.nonlethal === null) hp.nonlethal = 0;
    const current = Number(hp.current) || 0;
    const temp = Number(hp.temp) || 0;
    const nonlethal = Number(hp.nonlethal) || 0;
    // Pathfinder: you fall unconscious at 0 and die at negative Con. Anything
    // that buys more room before that -- Death's Door, a mythic tier, a GM's
    // ruling -- is a bonus on the threshold rather than a different rule, so
    // it stays tied to Con and moves when Con does.
    const conScore = this.data.abilities.con?.tempScore ?? 10;
    const deathBonus = Number(hp.deathBonus) || 0;
    const deathAt = -(conScore + deathBonus);
    return {
      max,
      current,
      temp,
      nonlethal,
      effective: current + temp,
      conScore,
      deathBonus,
      deathAt,
      dyingFraction: dyingFraction(current, deathAt),
      unconscious: current <= 0 || nonlethal >= current,
      dying: current < 0,
      dead: current <= deathAt,
    };
  }

  /* ---------------- conditions ---------------- */

  /**
   * What the ticked conditions are doing to the character, right now.
   *
   * These are deliberately a layer *over* the sheet's own totals rather than
   * part of them. Every derived number here is reconciled against the source
   * workbook, and a condition is a thing that happens during a fight, not part
   * of the build -- so folding a penalty into AC would silently move the
   * imported number and quietly change what the reconciliation offset means.
   * The panels show the base value and this beside it.
   *
   * Ability penalties are applied to the score and the modifier taken again,
   * rather than halved by hand: a −2 to a score is −1 to the modifier, but
   * Dexterity *set to* 0 by paralysis is −5, whatever it was before.
   */
  get conditionState() {
    const c = this.data;
    const active = [];
    for (const [name, value] of Object.entries(c.conditions || {})) {
      const info = conditionInfo(name);
      const count = conditionCount(info, value);
      if (count > 0) active.push({ name, info: info || { key: name, label: name }, count });
    }
    // Ticked buffs ride the same totals as conditions: their resolved dials
    // (recomputeBuffs) are mods, so every "now" figure moves without a second
    // pipeline. They have no ladder group, so nothing supersedes them.
    const buffsOn = [];
    // Size rows come in types: within true and effective, only the largest
    // increase (and the deepest reduction) counts, and the two stack with
    // each other; the stacking kind (wraps of suppressed size and its ilk)
    // sums outright and rides the true bundle.
    const sizeRows = { size: { up: 0, down: 0 }, sizeEffective: { up: 0, down: 0 }, stacking: 0 };
    for (const b of c.buffs || []) {
      if (!b?.on) continue;
      const bmods = {};
      const bability = {};
      const add = (key, v) => { bmods[key] = (bmods[key] || 0) + v; };
      for (const [key] of BUFF_MOD_KEYS) {
        const v = Number(b[`${key}Num`]) || 0;
        if (v) add(key, v);
      }
      // The extra bonuses. An ability score rides the totals' ability block so
      // its modifier cascades; the size types are gathered across every buff
      // and applied once below; `speed` is flat feet, kept apart from the
      // multiplier conditions use; the rest are plain channels.
      for (const row of b.bonuses || []) {
        const v = Number(row?.valueNum) || 0;
        if (!v) continue;
        const t = row.target;
        if (ABILITIES.includes(t)) bability[t] = (bability[t] || 0) + v;
        else if (t === 'size' || t === 'sizeEffective') {
          const slot = sizeRows[t];
          if (v > 0) slot.up = Math.max(slot.up, v);
          else slot.down = Math.min(slot.down, v);
        } else if (t === 'sizeStacking') sizeRows.stacking += v;
        else if (t === 'speed') add('speedFt', v);
        else if (t) add(t, v);
      }
      const label = String(b.name || '').trim() || 'Buff';
      buffsOn.push({ name: label, info: { key: `buff:${label}`, label, mods: bmods, ability: bability }, count: 1 });
    }
    const buffCount = buffsOn.length;

    /*
     * Apply the size change once. The Colossal cap binds the damage dice
     * alone: the dice walk stops where the ladder does (nothing rolls past
     * Colossal's dice, effective steps landing after true ones), while the
     * attack and AC penalties and the CMB and CMD bonuses run with the full
     * summed steps, uncapped. (TODO: a campaign setting for tables that
     * allow colossal+ sizes.)
     *
     * True steps change the size itself: −1 attack and AC per step larger
     * (the size modifier) and +1 CMB and CMD (the special size modifier).
     * The attack channel reaches CMB too -- rightly, for penalties like
     * shaken -- so CMB takes 2v: v to cancel the size modifier that does not
     * apply to maneuvers, and v for the special one that does. Effective
     * steps are "treated as larger", which reaches the damage dice alone --
     * so both kinds feed `sizeSteps`, the walk the weapon dice take.
     */
    const ladder = Object.keys(SIZE_MODIFIERS);
    let baseIdx = ladder.indexOf(c.identity?.size);
    if (baseIdx < 0) baseIdx = ladder.indexOf('Medium');
    const clampSteps = (from, want) => Math.max(-from, Math.min(ladder.length - 1 - from, want));
    const modSteps = sizeRows.size.up + sizeRows.size.down + sizeRows.stacking;
    const trueSteps = clampSteps(baseIdx, modSteps);
    const effSteps = clampSteps(baseIdx + trueSteps, sizeRows.sizeEffective.up + sizeRows.sizeEffective.down);
    const sizeSteps = trueSteps + effSteps;
    if (modSteps) {
      buffsOn.push({
        name: 'Size',
        info: {
          key: 'buff:size',
          label: `${modSteps > 0 ? `${modSteps} size larger` : `${-modSteps} size smaller`}`,
          mods: {
            attack: -modSteps, ac: -modSteps, cmb: 2 * modSteps, cmd: modSteps,
          },
        },
        count: 1,
      });
    }
    const totals = conditionTotals([...active, ...buffsOn]);
    const { mods } = totals;

    // Ability modifiers as the conditions leave them, against the temporary
    // score every derived stat is already built from.
    const deltas = {};
    const scores = {};
    for (const key of ABILITIES) {
      const a = c.abilities[key];
      const base = Number(a?.tempScore) || 0;
      let score = base + (totals.ability[key] || 0);
      if (totals.abilitySet[key] !== undefined) score = Math.min(score, totals.abilitySet[key]);
      score = Math.max(0, score);
      scores[key] = score;
      deltas[key] = abilityMod(score) - (Number(a?.totalMod) || 0);
    }
    const slot = (stat1, stat2) => statModDelta(deltas, stat1, stat2);

    // The ability bonus to AC, before and after -- capped by armour either way,
    // and dropped entirely when a condition takes it. A penalty is not a bonus,
    // so a negative modifier stays even when the bonus is lost.
    const armor = armorParts(c);
    const acAbility = Math.min(armor.maxDex, statMod(c, c.defenses.acStat1, c.defenses.acStat2));
    const acAbilityAfter = Math.min(armor.maxDex,
      statMod(c, c.defenses.acStat1, c.defenses.acStat2) + slot(c.defenses.acStat1, c.defenses.acStat2));
    const acAbilityDelta = (totals.losesDex ? Math.min(0, acAbilityAfter) : acAbilityAfter) - acAbility;

    const dexMod = Number(c.abilities.dex?.totalMod) || 0;
    const dexAfter = dexMod + (deltas.dex || 0);
    const cmdDexDelta = (totals.losesDex ? Math.min(0, dexAfter) : dexAfter) - dexMod;

    const mode = (key) => c.attack.modes?.[key] || {};
    const atk = (key) => mods.attack + slot(mode(key).stat1, mode(key).stat2);
    const sv = (key) => mods.saves + (mods[key] || 0) + slot(c.saves[key]?.stat1, c.saves[key]?.stat2);

    const delta = {
      melee: atk('melee') + mods.melee,
      altMelee: atk('altMelee') + mods.melee,
      ranged: atk('ranged') + mods.ranged,
      altRanged: atk('altRanged') + mods.ranged,
      cmb: atk('cmb') + mods.cmb,
      altCmb: atk('altCmb') + mods.cmb,
      ac: mods.ac + acAbilityDelta,
      touch: mods.ac + acAbilityDelta,
      flatFooted: mods.ac + (c.defenses.uncannyDodge ? acAbilityDelta : 0),
      cmd: cmdDexDelta + mods.cmd,
      fortitude: sv('fortitude'),
      reflex: sv('reflex'),
      will: sv('will'),
      initiative: mods.initiative + (deltas.dex || 0),
      skills: mods.skills,
      abilityChecks: mods.abilityChecks,
      damage: mods.damage,
      hp: mods.hp,
      // Display-level channels: shown where DCs and the essence pool are
      // read, without re-running slot tables or investment math.
      dc: mods.dc,
      essence: mods.essence,
    };

    const base = {
      melee: c.attack.totalMelee,
      altMelee: c.attack.totalMelee,
      ranged: c.attack.totalRanged,
      altRanged: c.attack.totalRanged,
      cmb: c.attack.totalCmb,
      altCmb: c.attack.totalCmb,
      ac: c.defenses.ac,
      touch: c.defenses.touch,
      flatFooted: c.defenses.flatFooted,
      cmd: c.defenses.cmd,
      fortitude: c.saves.fortitude.total,
      reflex: c.saves.reflex.total,
      will: c.saves.will.total,
      initiative: c.hp.initiative,
      hp: (Number(c.hp.total) || 0) + this.mythicHp,
    };
    const adjusted = {};
    for (const [key, value] of Object.entries(base)) adjusted[key] = value + (delta[key] || 0);
    adjusted.hp = Math.max(0, adjusted.hp);

    // Speed halves rather than scales: a 35 ft. move at half speed is 15 ft.,
    // not 17.5, so it rounds down to the 5-foot square it is measured in.
    // A flat bonus (longstrider, a buff's Speed row) is an enhancement to the
    // base speed, so it goes on before a condition halves the total.
    const speeds = (c.identity.speeds || []).map((sp) => {
      const final = Number(sp.final) || 0;
      // A flat bonus quickens the speeds the character has; it does not
      // conjure a fly speed out of an empty row.
      const bonus = final > 0 ? (mods.speedFt || 0) : 0;
      return {
        type: sp.type,
        final,
        adjusted: Math.floor(((final + bonus) * totals.speed) / 5) * 5,
      };
    });

    const notes = [];
    for (const { info } of totals.counted) {
      for (const note of info.notes || []) if (!notes.includes(note)) notes.push(note);
    }

    return {
      active, buffsOn: buffCount, sizeSteps, ...totals, deltas, scores, delta, base, adjusted, speeds, notes,
      // What moved the numbers, for the tooltips: named honestly, so a lone
      // buff never reads as "conditions".
      sources: active.length && buffCount ? 'conditions and buffs'
        : buffCount ? 'buffs' : 'conditions',
      changed: Object.entries(delta).filter(([, v]) => v !== 0).length > 0
        || totals.speed !== 1 || !!mods.speedFt || !!sizeSteps
        || !!totals.acVsMelee || !!totals.acVsRanged,
    };
  }

  /** The conditions a character could add: the standard list, minus what it has. */
  availableConditions() {
    const held = new Set(Object.keys(this.data.conditions || {})
      .map((name) => conditionInfo(name)?.key)
      .filter(Boolean));
    return CONDITIONS.filter((cond) => !held.has(cond.key));
  }

  /* ---------------- built-in meters ---------------- */

  /**
   * The style a meter is painted with, defaults filled in.
   *
   * A meter that has never been styled reads as the bar every character
   * starts with; anything the player set is layered over that.
   */
  meterStyle(key) {
    const saved = this.data.meterStyles?.[key];
    return normalizeStyle({ ...meterDefaultStyle(key), ...(saved || {}) });
  }

  /**
   * Restyle a meter. A style that is back to the default is deleted rather
   * than stored, so a sheet nobody has restyled saves nothing at all.
   */
  setMeterStyle(key, style) {
    if (!METERS.some(([k]) => k === key)) return this;
    const store = this.data.meterStyles || (this.data.meterStyles = {});
    if (isDefaultMeterStyle(style, key)) delete store[key];
    else store[key] = normalizeStyle({ ...meterDefaultStyle(key), ...(style || {}) });
    this.recompute();
    return this;
  }

  /**
   * What a meter shows: its track, where the fill reaches, and the layers
   * over it.
   *
   * `layers` are value ranges rather than pixels so they survive a change of
   * shape -- `over` is capacity that was borrowed rather than granted, `mark`
   * is a stretch that is filled but spoken for. `alert` runs 0..1 and drives
   * how red and how loud the meter goes; `alertFill` says the fill itself is
   * the thing that has gone wrong, not the room left in the track.
   */
  meterSpec(key) {
    const zones = (spec) => {
      const style = this.meterStyle(key);
      return {
        ...spec,
        id: key,
        meter: true,
        style,
        resolvedZones: resolveZones(style.zones, (src) => evaluateFormula(src, this.scope())),
      };
    };

    if (key === 'hp') {
      const hp = this.hpState;
      // Temporary hit points are extra track rather than a fuller one: they
      // sit past the maximum, so the bar can read over full without lying
      // about what the character's maximum is.
      const max = hp.max + Math.max(0, hp.temp);
      const filled = Math.max(0, hp.current) + Math.max(0, hp.temp);
      const layers = [];
      if (hp.temp > 0) {
        layers.push({
          kind: 'over', from: hp.max, to: max, label: `${hp.temp} temporary`,
        });
      }
      if (hp.nonlethal > 0) {
        // Nonlethal eats down from the top of what is left: when the marked
        // stretch reaches the bottom of the fill, the character is out.
        layers.push({
          kind: 'mark',
          from: Math.max(0, filled - hp.nonlethal),
          to: filled,
          label: `${hp.nonlethal} nonlethal`,
        });
      }
      return zones({
        name: 'Hit points',
        min: 0,
        max,
        current: filled,
        layers,
        alert: hp.dyingFraction,
        alertFill: false,
        zoneExample: 'hp.total * 0.25',
      });
    }

    if (key === 'essence') {
      const k = this.data.akashic?.calc || {};
      const pool = Number(k.pool) || 0;
      const temp = Number(k.temp) || 0;
      const total = Number(k.total ?? pool) || 0;
      const used = Number(k.used) || 0;
      const layers = temp > 0
        ? [{ kind: 'over', from: pool, to: total, label: `${temp} temporary, from spell points` }]
        : [];
      return zones({
        name: 'Essence',
        min: 0,
        max: total,
        current: used,
        layers,
        // Over-investment is the fill's own problem: there is nothing left in
        // the track to colour, so the essence already spent goes red.
        alert: (k.free ?? 0) < 0 ? 1 : 0,
        alertFill: true,
        zoneExample: 'essence.total * 0.5',
      });
    }

    if (key === 'pp') {
      // The power point pool drains rather than fills -- what matters is what
      // is left -- so the stored value is what has been spent and the default
      // style reads the other way round.
      const p = this.data.psionics || {};
      const pool = Number(p.pool) || 0;
      const left = Math.max(0, Math.min(pool, Number(p.left) || 0));
      return zones({
        name: 'Power points',
        min: 0,
        max: pool,
        current: pool - left,
        layers: [],
        alert: 0,
        alertFill: false,
        zoneExample: 'caster.sp * 0.5',
      });
    }
    return null;
  }

  /** Apply damage, spending temporary hit points first. */
  damage(amount, { nonlethal = false } = {}) {
    const hp = this.data.hp;
    const state = this.hpState;
    let left = Math.max(0, Number(amount) || 0);
    if (nonlethal) {
      hp.nonlethal = state.nonlethal + left;
    } else {
      const fromTemp = Math.min(state.temp, left);
      hp.temp = state.temp - fromTemp;
      left -= fromTemp;
      hp.current = state.current - left;
    }
    this.recompute();
    return this;
  }

  heal(amount) {
    const hp = this.data.hp;
    const state = this.hpState;
    const n = Math.max(0, Number(amount) || 0);
    hp.current = Math.min(state.max, state.current + n);
    hp.nonlethal = Math.max(0, state.nonlethal - n);
    this.recompute();
    return this;
  }

  /** Full rest: back to maximum, temporary and nonlethal cleared. */
  restoreAll() {
    const hp = this.data.hp;
    hp.current = (Number(hp.total) || 0) + this.mythicHp;
    hp.temp = 0;
    hp.nonlethal = 0;
    // Back to the resting point: nothing spent, or the neutral 0 of a two-sided
    // meter -- but never outside the tracker's own range.
    for (const t of this.trackers) {
      t.current = Math.max(Number(t.min) || 0, Math.min(Number(t.max) || 0, 0));
    }
    this.recompute();
    return this;
  }

  /* ---------------- gestalt classes ---------------- */

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
  #applyGestalt() {
    const c = this.data;
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
        byLevel = Array.from({ length: level }, (_, i) => this.#plannerHasClass(cls.name, i + 1));
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
   * Skill-rank budget: ranks/level (best class, gestalt) + Int bonus/level +
   * bonus points/level, times character level, against the ranks bought.
   */
  #applyBudget() {
    const c = this.data;
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

  /* ---------------- spheres training ---------------- */

  /**
   * Does the progression grant a level of `className` at character level `lvl`?
   *
   * Matched the way `classLevelCount` matches, because it is the same join and
   * the same trap: a class table reading `Legendary Kineticist` against a
   * Planner reading `legendary kineticst` is one character, and an exact
   * comparison answers "never" for every level -- which the caller then reads
   * as a class the Planner does not mention at all.
   */
  #plannerHasClass(className, lvl) {
    const row = this.data.progression?.levels?.[lvl - 1];
    if (!row) return false;
    const classes = row.classes || [];
    return classes.includes(className)
      || !!closestName(className, classes);
  }

  /**
   * The sphere talents a Primordia Technique has granted so far, as
   * `{ side, sphere, count }`, or null for a technique that grants none.
   *
   * A talent arrives with its level whether or not the player has got round to
   * naming which one it is, so this counts granting levels reached rather than
   * filled-in picks -- the empty ones are what the ladder reports as owed.
   */
  #primordiaTalents() {
    const t = primordiaTechnique(this.data.identity?.primordiaTechnique);
    if (!t?.talents) return null;
    const level = Number(this.data.identity.level) || 0;
    const count = PRIMORDIA_LEVELS
      .filter((l) => l <= level)
      .reduce((n, l) => n + primordiaGrantsAt(t, l).reduce((k, g) => k + grantCount(g, 'talent'), 0), 0);
    return count ? { ...t.talents, count } : null;
  }

  /**
   * Count sphere occurrences across a training side's talent sources.
   *
   * `side` is the side's own block, which does not say which side it is, so
   * technique talents -- the only source that has to know -- are keyed off the
   * caller's `sideKey`.
   */
  #sphereTally(side, { includeTradition = true, sideKey = null } = {}) {
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
      const other = this.data.training?.[sideKey === 'magic' ? 'combat' : 'magic'];
      for (const cls of other?.classes || []) {
        if (cls.blended && !cls.blendedMirror) blendedTalents(cls);
      }
    }
    for (const b of side.bonusTalents || []) bump(b.sphere);
    if (includeTradition) {
      for (const e of side.tradition?.entries || []) bump(e.sphere);
    }
    const technique = this.#primordiaTalents();
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
  #pairBlended() {
    const t = this.data.training || {};
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
  setBlended(sideKey, index, on) {
    const t = this.data.training || {};
    const cls = t[sideKey]?.classes?.[index];
    if (!cls || !cls.name) return this;
    const otherKey = sideKey === 'magic' ? 'combat' : 'magic';
    const other = t[otherKey];
    if (!other) return this;
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
    this.recompute();
    this.#emit({ type: 'blend', side: sideKey, index, on: !!on });
    return this;
  }

  /** The blended classes, once each, as the pair that makes them up. */
  blendedClasses() {
    const t = this.data.training || {};
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
  #recomputeTraining() {
    const t = this.data.training;
    if (!t) return;
    const c = this.data;
    const level = Number(c.identity.level) || 0;
    const mod = (name) => statMod(c, name, null);
    this.#pairBlended();

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
            : this.#plannerHasClass(cls.name, lv.level);
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
            const has = override != null ? l <= override : this.#plannerHasClass(cls.name, l);
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
      side.tally = this.#sphereTally(side, { sideKey });
    }

    // ----- combat side -----
    if (t.combat) {
      const bestPracMod = Math.max(0, ...(t.combat.classes || [])
        .filter((x) => x.name)
        .map((x) => mod(x.mod1)));
      t.combat.practitionerDC = 10 + Math.floor((Number(c.attack.bab) || 0) / 2) + bestPracMod;
      this.#recomputeUnarmed();
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
      m.globalCL = Math.max(0, amtFloor, ...casters.map(
        (x) => Math.floor((x.classLevelsCurrent ?? 0) * (TYPE_RATES[x.effectiveType] ?? 0)),
      )) + (Number(m.clBonus) || 0);
      m.globalDC = 10 + Math.floor(m.globalCL / 2) + bestMod + (Number(m.dcBonus) || 0);
      m.msb = Math.max(0, ...casters.map((x) => x.classLevelsCurrent ?? 0))
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
      m.spOnEssence = tempEssenceCost(this.data.akashic);
      m.spShort = Math.max(0, m.spOnEssence - m.totalSP);
      m.availableSP = m.totalSP - m.spOnEssence;
    }
  }

  /**
   * What the Primordia technique has put in its own sphere, level by level.
   *
   * The technique names most of what it grants -- Light Body's Wall Stunt at
   * 3rd and Air Stunt at 5th are in the rules, not in the player's hands -- so
   * those are names like any other. Its first level is a choice between two
   * packages, which is a name once the player has made it and a pair of
   * possible names until they do. The levels from 7th are the player's pick
   * outright: a name when it is filled in, and nothing the sheet can read when
   * it is not.
   */
  #techniqueTalents() {
    const t = primordiaTechnique(this.data.identity?.primordiaTechnique);
    const sphere = t?.talents?.sphere;
    if (!sphere) return null;
    const level = Number(this.data.identity.level) || 0;
    const picks = this.data.primordia?.picks || {};
    const names = [];
    const choices = [];
    for (const lvl of PRIMORDIA_LEVELS) {
      if (lvl > level) break;
      for (const g of primordiaGrantsAt(t, lvl)) {
        if (!grantCount(g, 'talent')) continue;
        const pick = String(picks[lvl] ?? '').trim();
        if (g.name) names.push(g.name);
        else if (pick) names.push(pick);
        else if (g.pick?.options?.length) choices.push(g.pick.options);
      }
    }
    return { side: t.talents.side, sphere, names, choices };
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
  #sphereTalentKnowledge(side, sideKey) {
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

    const tech = this.#techniqueTalents();
    if (tech && tech.side === sideKey) {
      const row = of(tech.sphere);
      row.names.push(...tech.names);
      row.choices.push(...tech.choices);
    }

    for (const [sphere, row] of out) {
      const total = Number((side?.tally || {})[sphere]) || 0;
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
  #sphereRanksBySkill() {
    const map = new Map();
    const t = this.data.training?.combat;
    if (!t) return map;
    const level = Number(this.data.identity.level) || 0;
    const tally = t.tally || {};
    const lightBody = this.data.identity.primordiaTechnique === 'Light Body';
    const known = this.#sphereTalentKnowledge(t, 'combat');
    const of = (sphere) => known.get(sphere) || { names: [], choices: [], unnamed: 0 };
    const check = {
      has: (sphere) => (tally[sphere] || 0) > 0,
      named: (sphere) => of(sphere).names,
      choices: (sphere) => of(sphere).choices,
      unnamed: (sphere) => of(sphere).unnamed,
    };

    this.trainingSkillRanks = (t.skillRanks || []).map((row) => {
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

    for (const row of this.trainingSkillRanks) {
      const def = SPHERE_SKILL_RANKS.find((d) => d.key === row.skill);
      if (!def?.match) continue;
      const idx = this.data.skills.findIndex((s) => {
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
  #recomputeSphereRows() {
    const t = this.data.training;
    if (!t) return;
    const c = this.data;
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

  /** The sheet's unarmed practitioner damage, from V65's exact algorithm. */
  /** How many feats on the character match `re` -- feat groups and granted feats. */
  featCount(re) {
    const d = this.data;
    let n = 0;
    for (const g of d.featGroups || []) {
      for (const f of g.entries || []) if (re.test(String(f?.name || ''))) n += 1;
    }
    const gf = d.grantedFeats || {};
    for (const f of [gf.drawback, gf.specialty, ...(gf.others || [])]) {
      if (re.test(String(f?.name || ''))) n += 1;
    }
    return n;
  }

  #recomputeUnarmed() {
    const t = this.data.training?.combat;
    if (!t?.unarmed) return;
    const u = t.unarmed;
    // The Unorthodox sphere list was once one comma-separated field; it is
    // picks now, two per Unorthodox Unarmed Training feat on the character.
    if (typeof u.otherSpheresText === 'string') {
      u.otherSpheres = u.otherSpheresText.split(',').map((s) => s.trim()).filter(Boolean);
      delete u.otherSpheresText;
    }
    if (!Array.isArray(u.otherSpheres)) u.otherSpheres = [];
    u.unorthodoxFeats = this.featCount(UNORTHODOX_FEAT);
    u.unorthodoxSlots = Math.max(u.unorthodoxFeats * UNORTHODOX_SPHERES_PER_FEAT,
      u.otherSpheres.filter(Boolean).length);
    // Talented Knuckle and the Brawler's Vest are had or not; a document that
    // still carries the sheet's numbers (2 and 4) reads them as had.
    u.talentedKnuckle = !!u.talentedKnuckle;
    u.brawlersVest = !!u.brawlersVest;
    // The Bands of the Asura veil: its invested essence, wherever it is shaped.
    u.asuraEssence = [...(this.data.akashic?.slots || []), ...(this.data.akashic?.kheshig || [])]
      .flatMap((h) => h.veils || [])
      .filter((v) => ASURA_VEIL.test(String(v?.name || '')))
      .reduce((n, v) => n + (Number(v.essence) || 0), 0);
    delete u.veilEssence;
    // The sheet counts class and bonus talents only, never tradition ones;
    // includeTradition is an explicit player toggle on top of that.
    const tally = this.#sphereTally(t, {
      includeTradition: !!u.includeTradition, sideKey: 'combat',
    });

    const per = {};
    for (const s of UNARMED_SPHERES) per[s] = tally[s] || 0;
    per['Open Hand'] += u.asuraEssence * ASURA_TALENTS_PER_ESSENCE;

    let talents = 0;
    if (u.usesBoxing) talents += per.Boxing;
    if (u.usesBrute) talents += per.Brute;
    if (u.usesOpenHand) talents += per['Open Hand'];
    if (u.usesWrestling) talents += per.Wrestling;
    for (const s of new Set((u.otherSpheres || []).filter(Boolean))) talents += tally[s] || 0;
    if (u.talentedKnuckle) talents += TALENTED_KNUCKLE_TALENTS;
    if (u.brawlersVest) talents += BRAWLERS_VEST_TALENTS;
    talents += Number(u.extraTalents) || 0;

    u.perSphere = per;
    u.effectiveTalents = Math.floor(talents);
    u.dice = unarmedDice(u.effectiveTalents, {
      stepIncreases: u.stepIncreases,
      sizeIncreases: u.sizeIncreases,
    });
    const anyUnarmedTalent = UNARMED_SPHERES.some((s) => (tally[s] || 0) > 0)
      || (u.otherSpheres || []).some((s) => (tally[s] || 0) > 0);
    u.improvedUnarmedStrike = anyUnarmedTalent;
  }

  /* ---------------- formula scope ---------------- */

  /**
   * The flat, read-only view player formulas see. Rebuilt on demand so it can
   * never drift from the model.
   */
  /**
   * The `essence.*` names a formula can read.
   *
   * The workbook published one defined name per receptacle -- VeilEssenceHands
   * for the veil in the Hands slot, VeilEssenceHands2 for its twinned second,
   * VeilEssenceWeapon and VeilEssenceArmor for the two Kheshig ones -- because
   * veils routinely scale their effect off the essence invested in them rather
   * than only their save DC. The same names live here as `essence.hands`,
   * `essence.hands2`, `essence.weapon` and `essence.armor`, alongside the
   * pool totals and any other receptacle by its own slugged name.
   */
  #essenceScope() {
    const a = this.data.akashic;
    const out = {
      pool: Number(a?.essence?.pool) || 0,
      // `pool` stays the day's own essence so a formula written against it does
      // not move when spell points are condensed; `total` is the two together.
      temp: Number(a?.calc?.temp) || 0,
      total: Number(a?.calc?.total ?? a?.essence?.pool) || 0,
      used: Number(a?.calc?.used) || 0,
      free: Number(a?.calc?.free) || 0,
      cap: Number(a?.calc?.totalCap) || 0,
    };
    const put = (key, value) => {
      if (key && out[key] === undefined) out[key] = value;
    };
    for (const slot of a?.slots || []) {
      const key = slug(slot.slot);
      const veils = slot.veils || [];
      // Both names exist whether or not the slot is twinned, and an empty slot
      // reads zero -- the workbook published VeilEssenceShoulder2 even with
      // nothing in it, and a formula asking should get 0 rather than an error.
      put(key, Number(veils[0]?.essence) || 0);
      put(`${key}2`, Number(veils[1]?.essence) || 0);
      for (let i = 2; i < veils.length; i++) put(`${key}${i + 1}`, Number(veils[i].essence) || 0);
    }
    for (const r of a?.kheshig || []) {
      // "Weapon Veil (Kheshig)" -> essence.weapon
      const key = slug(String(r.label || '').replace(/\s*Veil\s*\(Kheshig\)\s*$/i, ''));
      put(key, Number((r.veils || [])[0]?.essence) || 0);
    }
    for (const r of a?.otherReceptacles || []) {
      put(slug(r.name), Number(r.essence) || 0);
    }
    return out;
  }

  scope() {
    const c = this.data;
    const s = {
      level: Number(c.identity.level) || 0,
      bab: Number(c.attack.bab) || 0,
      hp: {
        total: (Number(c.hp.total) || 0) + this.mythicHp,
        current: Number(c.hp.current ?? c.hp.total) || 0,
        temp: Number(c.hp.temp) || 0,
      },
      mythic: { tier: Number(c.identity.mythicTier) || 0 },
      size: c.identity.size,
      initiative: Number(c.hp.initiative) || 0,
      saves: {
        fortitude: c.saves.fortitude.total,
        reflex: c.saves.reflex.total,
        will: c.saves.will.total,
      },
      ac: {
        total: c.defenses.ac,
        touch: c.defenses.touch,
        flatFooted: c.defenses.flatFooted,
        cmd: c.defenses.cmd,
      },
      attack: {
        melee: c.attack.totalMelee,
        ranged: c.attack.totalRanged,
        cmb: c.attack.totalCmb,
      },
      // The wallet: what is on hand, what the next offering costs, what is left after it.
      mana: (() => { const w = wealthView(c.wealth, new Date(), this.casterLevel); return { current: w.current, expected: w.expected.total, after: w.after, perDay: w.manaPerDay }; })(),
      caster: {
        level: this.casterLevel,
        dc: Number(c.training?.magic?.globalDC) || 0,
        msb: Number(c.training?.magic?.msb) || 0,
        msd: Number(c.training?.magic?.msd) || 0,
        sp: Number(c.training?.magic?.totalSP) || 0,
        // What is left to cast with once the day's essence has been condensed.
        spAvailable: Number(c.training?.magic?.availableSP ?? c.training?.magic?.totalSP) || 0,
      },
      practitioner: { dc: Number(c.training?.combat?.practitionerDC) || 0 },
      unarmed: {
        talents: Number(c.training?.combat?.unarmed?.effectiveTalents) || 0,
        dice: c.training?.combat?.unarmed?.dice || '',
      },
      skill: {},
      tracker: {},
      // Essence invested per receptacle, mirroring the workbook's own named
      // ranges (VeilEssenceHands, VeilEssenceShoulder2, VeilEssenceWeapon...).
      // Many veils scale something other than their DC off what is invested
      // in them, so these have to be readable from a formula.
      essence: this.#essenceScope(),
      // The day's power points, for the same reason: a psionic power that scales
      // off the pool should be able to say so rather than restate the number.
      pp: {
        pool: Number(c.psionics?.pool) || 0,
        spent: Number(c.psionics?.spent) || 0,
        left: Number(c.psionics?.left) || 0,
        bonus: Number(c.psionics?.bonusPoints) || 0,
      },
      // The card caster's deck, for the same reason again: a tracker sized to
      // the opening hand, or a card whose text reads the deck, should be able
      // to say so.
      deck: {
        size: Number(c.cardcasting?.calc?.deckSize) || 0,
        cam: Number(c.cardcasting?.calc?.cam) || 0,
        hand: Number(c.cardcasting?.calc?.openingHand) || 0,
        handMax: Number(c.cardcasting?.calc?.handMax) || 0,
        effects: Number(c.cardcasting?.calc?.effectCards) || 0,
        mana: Number(c.cardcasting?.calc?.manaCards) || 0,
        unique: Number(c.cardcasting?.calc?.uniqueEffects) || 0,
        lifebound: Number(c.cardcasting?.calc?.lifebound) || 0,
        drawbacks: Number(c.cardcasting?.calc?.drawbackValue) || 0,
        feats: (c.cardcasting?.calc?.deckFeats || []).length,
        manipulations: Number(c.cardcasting?.calc?.manipulationsTaken) || 0,
        manipulationsLeft: Number(c.cardcasting?.calc?.manipulationsLeft) || 0,
        // How many times each manipulation was taken, by name:
        // deck.manip.draw_power_enhancement, deck.manip.loaded_hand.
        manip: {},
        // The encounter in play.
        round: Number(c.cardcasting?.table?.round) || 0,
        inHand: Number(c.cardcasting?.table?.calc?.inHand) || 0,
        inDeck: Number(c.cardcasting?.table?.calc?.inDeck) || 0,
        inPlay: Number(c.cardcasting?.table?.calc?.inPlay) || 0,
        inDiscard: Number(c.cardcasting?.table?.calc?.inDiscard) || 0,
        manaInPlay: Number(c.cardcasting?.table?.calc?.manaInPlay) || 0,
        manaUntapped: Number(c.cardcasting?.table?.calc?.manaUntapped) || 0,
      },
    };
    for (const m of c.cardcasting?.manipulations || []) {
      const key = slug(m.name);
      if (!key) continue;
      s.deck.manip[key] = (s.deck.manip[key] || 0) + (Number(m.count) || 0);
    }

    for (const key of ABILITIES) {
      const a = c.abilities[key];
      s[key] = {
        score: a.score,
        mod: a.mod,
        temp: a.tempScore,
        tempMod: a.totalMod,
      };
    }

    for (const sk of c.skills) {
      const name = slug(sk.spec ? `${sk.name} ${sk.spec}` : sk.name);
      if (s.skill[name] === undefined) s.skill[name] = sk.bonus;
    }

    // The companions, so a tracker or an ability can read them: familiar.hp,
    // eidolon.hd, animalCompanion.str.mod, eidolon.evoLeft.
    for (const kind of COMPANION_KINDS) {
      const cs = companionScope(c[kind]);
      if (cs) s[kind] = cs;
    }

    // Every tracker publishes its numbers as tracker.<id>.* -- the id is the
    // one shown on the tracker's own row, and it never changes when the tracker
    // is renamed, so a formula pointing at it cannot be broken by a rename.
    for (const t of this.trackers) s.tracker[t.id] = trackerFacts(t);

    // Character-wide inline names ({qi.max = …}) become dotted paths in the
    // scope. They never overwrite a built-in value.
    for (const [name, value] of Object.entries(this.inlineNames || {})) {
      const parts = name.split('.');
      let node = s;
      let clash = false;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (node[k] === undefined) node[k] = {};
        else if (typeof node[k] !== 'object' || node[k] === null) { clash = true; break; }
        node = node[k];
      }
      const leaf = parts[parts.length - 1];
      if (!clash && node[leaf] === undefined) node[leaf] = value;
    }

    return s;
  }

  /** Every variable name a formula may legally use -- drives validation + autocomplete. */
  scopeNames() {
    return flatNames(this.scope()).sort();
  }

  /* ---------------- custom trackers ---------------- */

  /**
   * The sheet's own Resource Tracker block, as trackers -- the pristine seed,
   * before any player edits. A pure function of `data.resources`, so the same
   * list can be diffed against at save time.
   */
  #seedTrackers() {
    return (this.data.resources || []).map((r, i) => {
      const id = slug(r.name) || `resource_${i}`;
      const total = Number(r.total) || 0;
      // Mythic Power is the one pool every character has: it is 3 + 2 per tier
      // by the campaign's rules, and all five sheets agree, so it follows the
      // tier instead of freezing the imported number. A sheet that disagrees
      // keeps its own value rather than being "corrected".
      const tierDriven = id === MYTHIC_POWER_ID && total === mythicPowerAt(this.#tierNow());
      return {
        id,
        name: r.name,
        current: Number(r.uses) || 0,
        maxFormula: tierDriven ? MYTHIC_POWER_FORMULA
          : typeof r.total === 'number' ? String(r.total) : null,
        max: total,
        minFormula: null,
        min: 0,
        refresh: r.refresh || '',
        source: 'sheet',
        note: typeof r.total === 'string' ? String(r.total) : '',
        style: id === MYTHIC_POWER_ID ? mythicPowerStyle() : null,
      };
    });
  }

  /** Mythic tier as it stands (override wins), without needing a recompute first. */
  #tierNow() {
    const m = this.data.mythic || {};
    return Number(m.tierOverride ?? tierAtLevel(this.data.identity?.level)) || 0;
  }

  #loadTrackers() {
    // Seed from the sheet's own Resource Tracker block so nothing is lost, then
    // lay the player's changes over the top. Sheet-seeded trackers are fully
    // editable, so `sheetTrackerState` carries whatever differs from the seed
    // -- the spent count, any renamed/retyped field, the style, and deletions.
    // `resources` itself stays exactly as imported.
    const savedState = new Map((this.data.sheetTrackerState || []).map((s) => [s.id, s]));
    const seeded = [];
    for (const seed of this.#seedTrackers()) {
      const saved = savedState.get(seed.id);
      if (saved?.deleted) continue;          // removed by the player; stays removed
      if (!saved) { seeded.push(seed); continue; }
      const t = { ...seed };
      if (saved.current !== undefined) t.current = Number(saved.current) || 0;
      for (const key of SHEET_TRACKER_OVERRIDES) {
        if (saved[key] !== undefined) t[key] = saved[key];
      }
      // `style` is saved only when it differs from the seed, and an explicit
      // null is meaningful: it is how "I turned Mythic Power's drain off" is
      // recorded, and must not fall back to the seeded default.
      if ('style' in saved) t.style = saved.style ? normalizeStyle(saved.style) : null;
      seeded.push(t);
    }
    const custom = (this.data.customTrackers || []).map((t) => ({
      minFormula: null, min: 0, style: null, ...t,
    }));
    // Ids must stay unique -- they name the tracker in the formula scope.
    const out = [];
    const seen = new Set();
    for (const t of [...seeded, ...custom]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }

  /**
   * Every character has Mythic Power once they are mythic, so it is created if
   * missing and cannot be deleted. Nothing else is privileged: Spell Points,
   * Culinary Stamina and the rest are ordinary editable trackers.
   */
  #ensureMythicPower() {
    if (this.#tierNow() < 1) return;
    if (this.trackers.some((t) => t.id === MYTHIC_POWER_ID)) return;
    this.trackers.unshift({
      id: MYTHIC_POWER_ID,
      name: 'Mythic Power',
      current: 0,
      maxFormula: MYTHIC_POWER_FORMULA,
      max: 0,
      minFormula: null,
      min: 0,
      refresh: 'Daily',
      note: '',
      style: mythicPowerStyle(),
      source: 'player',
      createdAt: null,
    });
  }

  /**
   * Every tracker has a range [min, max]. `max` comes from the tracker's
   * formula as before; `min` comes from an optional second formula and is 0
   * when there is none, so an ordinary pool is unchanged. A negative min turns
   * the tracker into a two-sided meter (Angou's Hellfire Qi swings between
   * -floor((burn.max + qi.max) / 4) and +floor(...)); `current` then reads as a
   * signed position rather than a spent count.
   */
  #recomputeTrackers() {
    // A character who has just reached level 8 gains Mythic Power here.
    this.#ensureMythicPower();
    const scope = this.scope();
    const toInt = (v) => (typeof v === 'number' ? Math.floor(v) : Math.floor(Number(v)) || 0);
    const errors = new Map();
    // Which sheet-seeded trackers the player has since changed -- shown as an
    // "edited" badge, and the reason they are saved as overrides.
    const seeds = new Map(this.#seedTrackers().map((s) => [s.id, s]));
    for (const t of this.trackers) {
      const seed = t.source === 'sheet' ? seeds.get(t.id) : null;
      t.edited = !!seed && SHEET_TRACKER_OVERRIDES.some((k) => (t[k] ?? null) !== (seed[k] ?? null));
      const errs = [];
      if (t.maxFormula) {
        try { t.max = toInt(evaluateFormula(t.maxFormula, scope)); } catch (err) { errs.push(`max: ${err.message}`); }
      } else {
        t.max = 0;
      }
      if (t.minFormula) {
        // The max is already computed, so a symmetric meter can be written as
        // `-self.max` instead of repeating the whole max formula.
        const withMax = { ...scope, self: { max: t.max, current: Number(t.current) || 0 } };
        try { t.min = toInt(evaluateFormula(t.minFormula, withMax)); } catch (err) { errs.push(`min: ${err.message}`); }
      } else {
        t.min = 0;
      }
      if (!errs.length && (Number(t.min) || 0) > (Number(t.max) || 0)) {
        errs.push(`min (${t.min}) is above max (${t.max})`);
      }
      errors.set(t, errs);
    }

    // Appearance: normalise whatever was saved, drop an all-default style, and
    // resolve zone bounds (they are formulas). Zones commonly refer to their
    // own tracker ("tracker.burn.max - 2"), so they see the ranges computed
    // just above rather than last recompute's.
    const zoneScope = this.scope();
    for (const t of this.trackers) {
      const errs = errors.get(t);
      t.style = t.style && !isDefaultStyle(t.style) ? normalizeStyle(t.style) : null;
      // `self` is the tracker's own row: a zone can be written as
      // `floor(self.max * 0.3)` without naming the tracker, which matters
      // because the id keeps the tracker's original name through a rename.
      const selfScope = { ...zoneScope, self: trackerFacts(t) };
      t.resolvedZones = t.style
        ? resolveZones(t.style.zones, (src) => evaluateFormula(src, selfScope))
        : [];
      t.resolvedZones.forEach((z, i) => { if (z.error) errs.push(`zone ${i + 1}: ${z.error}`); });
      t.error = errs.length ? errs.join('; ') : null;
    }
  }

  addTracker({ name, maxFormula, minFormula = null, current = 0, refresh = '', note = '', style = null }) {
    const base = slug(name);
    let id = base;
    let n = 2;
    while (this.trackers.some((t) => t.id === id)) id = `${base}_${n++}`;
    const tracker = {
      id, name, maxFormula: maxFormula || null, max: 0, minFormula: minFormula || null, min: 0, current,
      refresh, note, style, source: 'player', createdAt: new Date().toISOString(),
    };
    this.trackers.push(tracker);
    this.recompute();
    return tracker;
  }

  /** Move a tracker by `delta`, staying inside its [min, max] range. */
  stepTracker(id, delta) {
    const t = this.trackers.find((x) => x.id === id);
    if (!t) return null;
    const min = Number(t.min) || 0;
    const max = Number(t.max) || 0;
    const next = Math.max(min, Math.min(max, (Number(t.current) || 0) + (Number(delta) || 0)));
    return this.updateTracker(id, { current: next });
  }

  updateTracker(id, patch) {
    const t = this.trackers.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    this.recompute();
    return t;
  }

  /** True when a tracker may not be deleted (Mythic Power, and only that). */
  isProtectedTracker(id) {
    return id === MYTHIC_POWER_ID;
  }

  /** @returns {boolean} whether the tracker was removed. */
  removeTracker(id) {
    if (this.isProtectedTracker(id)) return false;
    const i = this.trackers.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.trackers.splice(i, 1);
    this.recompute();
    return true;
  }

  /**
   * Full audit of every player-authored formula on this character.
   * Returns plain data so an admin view (or a server-side checker) can render
   * the exact text a player wrote, what it reads, and what it evaluates to.
   */
  audit() {
    const scope = this.scope();
    const known = new Set(this.scopeNames());

    // Skill ranks entered as formulas are player-authored too.
    const skillFormulas = (this.data.skills || [])
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => typeof s.rankSources?.bought === 'string' && s.rankSources.bought.trim())
      .map(({ s, i }) => {
        const info = analyse(s.rankSources.bought);
        return {
          id: `skill-ranks-${i}`,
          name: `${skillLabel(s.name, s.spec)} ranks`,
          source: 'skill',
          formula: s.rankSources.bought,
          reads: info.variables,
          functions: info.functions,
          unknownReferences: info.variables.filter((v) => v !== 'level'),
          value: s.boughtResolved ?? null,
          error: s.boughtError || info.error
            || (info.variables.some((v) => v !== 'level') ? 'Rank formulas may only read "level"' : null),
          status: (s.boughtError || info.error || info.variables.some((v) => v !== 'level')) ? 'error' : 'ok',
          createdAt: null,
        };
      });

    // Skill misc bonuses entered as formulas.
    const skillMiscFormulas = (this.data.skills || [])
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => typeof s.offset === 'string' && s.offset.trim())
      .map(({ s, i }) => {
        const info = analyse(s.offset);
        const unknown = info.variables.filter((v) => !known.has(v));
        return {
          id: `skill-misc-${i}`,
          name: `${skillLabel(s.name, s.spec)} misc`,
          source: 'skill',
          formula: s.offset,
          reads: info.variables,
          functions: info.functions,
          unknownReferences: unknown,
          value: s.miscResolved ?? null,
          error: s.miscError || info.error || null,
          status: (s.miscError || info.error) ? 'error' : 'ok',
          createdAt: null,
        };
      });

    // Inline {name = expr} definitions and their errors.
    //
    // What a definition may legally read is wider than the character: the
    // other definitions (they resolve in dependency order, so one may name a
    // sibling that has not been computed yet), and whatever local scope the
    // text was written in -- a veil's `essence.self`, which exists in that
    // veil's own description and nowhere else. Judging these against the
    // character alone would report a working formula as broken.
    const definedNames = new Set((this.inlineDefinitions || []).map((d) => d.name));
    // Each definition is worked out on its own terms, in the scope it was
    // written in. That matters when a name is defined twice: the row has to
    // say what *its* formula comes to, not what the winning one came to, or a
    // player choosing between them is comparing a number against itself.
    const ownValue = (d) => {
      try {
        return evaluateFormula(d.expr, {
          lookup: (n) => {
            if (d.scope) {
              const v = resolvePath(d.scope, n);
              if (v !== undefined) return v;
            }
            return resolvePath(scope, n);
          },
        });
      } catch {
        return null;
      }
    };
    const inlineFormulas = (this.inlineDefinitions || []).map((d, i) => {
      const err = (this.inlineErrors || []).find((e) => e.name === d.name && e.path === d.path);
      const info = analyse(d.expr);
      const local = new Set(flatNames(d.scope));
      return {
        id: `inline-${i}`,
        name: `{${d.name}}`,
        source: 'inline',
        formula: d.expr,
        reads: info.variables,
        functions: info.functions,
        unknownReferences: info.variables.filter(
          (v) => !known.has(v) && !definedNames.has(v) && !local.has(v),
        ),
        value: ownValue(d),
        error: err?.error || info.error || null,
        status: err || info.error ? 'error' : 'ok',
        createdAt: null,
        location: d.path,
        where: describeSource(d.path),
        // The scope this text was written in, so a reader can work the formula
        // out the way the sheet did rather than against the character alone.
        locals: d.scope || null,
      };
    });

    // Misc damage written as a rule rather than a number.
    const weaponMiscFormulas = (this.data.equipment?.weapons || [])
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => typeof w.miscDamage === 'string' && w.miscDamage.trim())
      .map(({ w, i }) => {
        const info = analyse(String(w.miscDamage).replace(/\{[^{}]*\}/g, '0'));
        return {
          id: `weapon-misc-${i}`,
          name: `${w.name || `Weapon ${i + 1}`} misc damage`,
          source: 'weapon',
          formula: w.miscDamage,
          reads: info.variables,
          functions: info.functions,
          unknownReferences: info.variables.filter((v) => !known.has(v)),
          value: w.miscDamageError ? null : w.miscDamageNum ?? null,
          error: w.miscDamageError || null,
          status: w.miscDamageError ? 'error' : 'ok',
          createdAt: null,
          where: 'a weapon\u2019s Misc dmg',
        };
      });

    // Weapon damage/to-hit tokens written into special properties.
    const weaponFormulas = (this.data.equipment?.weapons || []).flatMap((w, wi) => {
      const items = [
        ...(w.calc?.atkTokens || []).map((t) => ({ t, kind: 'to-hit' })),
        ...(w.calc?.dmgTokens || []).map((t) => ({ t, kind: 'damage' })),
      ];
      return items.map(({ t, kind }, ti) => ({
        id: `weapon-${wi}-${kind}-${ti}`,
        name: `${w.name || `Weapon ${wi + 1}`} ${kind} token`,
        source: 'weapon',
        formula: t.text,
        reads: [],
        functions: [],
        unknownReferences: [],
        value: t.error ? null : diceString(t.dice, t.flat),
        error: t.error || null,
        status: t.error ? 'error' : 'ok',
        createdAt: null,
      }));
    });

    // Movement: a speed bonus written as a rule rather than a number.
    const speedFormulas = (this.data.identity?.speeds || [])
      .map((sp, i) => ({ sp, i }))
      .filter(({ sp }) => typeof sp.bonus === 'string' && sp.bonus.trim())
      .map(({ sp, i }) => {
        const info = analyse(sp.bonus);
        const unknown = info.variables.filter((v) => !known.has(v));
        const error = sp.bonusError || info.error
          || (unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : null);
        return {
          id: `speed-${i}`,
          name: `${sp.type || `Speed ${i + 1}`} bonus`,
          source: 'player',
          formula: sp.bonus,
          reads: info.variables,
          functions: info.functions,
          unknownReferences: unknown,
          value: error ? null : sp.bonusNum ?? null,
          error,
          status: error ? 'error' : 'ok',
          createdAt: null,
        };
      });

    // Extra language slots, when written as a rule.
    const langExtra = this.data.identity?.languageExtra;
    const languageFormulas = typeof langExtra === 'string' && langExtra.trim() ? [(() => {
      const info = analyse(langExtra);
      const unknown = info.variables.filter((v) => !known.has(v));
      const error = this.data.identity.languageSlots?.extraError || info.error
        || (unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : null);
      return {
        id: 'languages-extra',
        name: 'Extra language slots',
        source: 'player',
        formula: langExtra,
        reads: info.variables,
        functions: info.functions,
        unknownReferences: unknown,
        value: error ? null : this.data.identity.languageSlots?.extra ?? null,
        error,
        status: error ? 'error' : 'ok',
        createdAt: null,
      };
    })()] : [];

    // Crafting: any speed increase, cost reduction, item value or DC the
    // player typed as a formula rather than a number.
    const cr = this.data.crafting || {};
    const craftFields = [
      ...(cr.speedIncreases || []).map((s, i) => ({
        id: `crafting-speed-${i}`, name: `Speed increase — ${s.label || `#${i + 1}`}`, obj: s, field: 'value',
      })),
      ...(cr.costReductions || []).map((r, i) => ({
        id: `crafting-reduction-${i}`, name: `Cost reduction — ${r.label || `#${i + 1}`}`, obj: r, field: 'value',
      })),
      ...(cr.projects || []).flatMap((p, i) => {
        const item = p.name || `Project ${i + 1}`;
        return [
          { id: `crafting-value-${i}`, name: `${item} — market value`, obj: p, field: 'value' },
          { id: `crafting-dc-${i}`, name: `${item} — item DC`, obj: p, field: 'itemDC' },
          ...(p.dcAdjustments || []).map((a, j) => ({
            id: `crafting-dc-${i}-${j}`, name: `${item} — DC ${a.label || `adjustment ${j + 1}`}`, obj: a, field: 'value',
          })),
        ];
      }),
    ];
    const craftingFormulas = craftFields
      .filter(({ obj, field }) => typeof obj[field] === 'string' && obj[field].trim())
      .map(({ id, name, obj, field }) => {
        const formula = obj[field];
        const info = analyse(formula);
        const unknown = info.variables.filter((v) => !known.has(v));
        const error = obj[`${field}Error`] || info.error
          || (unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : null);
        return {
          id,
          name,
          source: 'crafting',
          formula,
          reads: info.variables,
          functions: info.functions,
          unknownReferences: unknown,
          value: error ? null : obj[`${field}Num`] ?? null,
          error,
          status: error ? 'error' : 'ok',
          createdAt: null,
        };
      });

    // The card caster's deck manipulations available, when written as a rule.
    const cc = this.data.cardcasting;
    const deckFormulas = typeof cc?.manipulationsAvailable === 'string' && cc.manipulationsAvailable.trim() ? [(() => {
      const info = analyse(cc.manipulationsAvailable);
      const unknown = info.variables.filter((v) => !known.has(v));
      const error = cc.calc?.manipulationsError || info.error
        || (unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : null);
      return {
        id: 'deck-manipulations',
        name: 'Deck manipulations available',
        source: 'player',
        formula: cc.manipulationsAvailable,
        reads: info.variables,
        functions: info.functions,
        unknownReferences: unknown,
        value: error ? null : cc.calc?.manipulationsAvailable ?? null,
        error,
        status: error ? 'error' : 'ok',
        createdAt: null,
      };
    })()] : [];

    // Trackers: the max formula, and the min formula when the tracker has one
    // (a two-sided meter). Each is audited on its own.
    const trackerFormulas = this.trackers.flatMap((t) => {
      // Zone bounds and the note read `self`, which only exists on this
      // tracker's own row, so those entries are checked against a scope that
      // has it -- otherwise the audit would report every one as unknown.
      const selfScope = { ...scope, ...this.trackerScope(t) };
      const selfKnown = new Set([...known,
        ...Object.keys(this.trackerScope(t).self).map((k) => `self.${k}`)]);

      const parts = [];
      if (t.maxFormula) parts.push({ id: t.id, name: t.name, formula: t.maxFormula });
      if (t.minFormula) {
        parts.push({ id: `${t.id}:min`, name: `${t.name} min`, formula: t.minFormula, self: true });
      }
      // Zone bounds are player formulas too (a danger zone from `self.max - 2`).
      (t.style?.zones || []).forEach((z, i) => {
        const label = z.label ? ` (${z.label})` : '';
        if (z.from) parts.push({ id: `${t.id}:zone${i + 1}:from`, name: `${t.name} zone ${i + 1}${label} from`, formula: z.from, self: true });
        if (z.to) parts.push({ id: `${t.id}:zone${i + 1}:to`, name: `${t.name} zone ${i + 1}${label} to`, formula: z.to, self: true });
      });
      // Every {…} the player wrote in the tracker's note, one row each.
      if (hasTokens(t.note)) {
        this.renderProse(t.note, this.trackerScope(t))
          .filter((seg) => seg.kind !== 'text')
          .forEach((seg, i) => parts.push({
            id: `${t.id}:note${i + 1}`,
            name: `${t.name} note`,
            formula: seg.kind === 'ref' ? seg.name : seg.expr,
            self: true,
            noteError: seg.error || null,
          }));
      }
      return parts.map(({ id, name, formula, self: usesSelf, noteError }) => {
        const info = analyse(formula);
        const unknown = info.variables.filter((v) => !(usesSelf ? selfKnown : known).has(v));
        let value = null;
        let error = noteError || info.error;
        if (info.ok && !unknown.length && !noteError) {
          try { value = evaluateFormula(formula, usesSelf ? selfScope : scope); } catch (e) { error = e.message; }
        }
        return {
          id,
          name,
          source: t.source,
          formula,
          reads: info.variables,
          functions: info.functions,
          unknownReferences: unknown,
          value,
          error: unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : error,
          status: error || unknown.length ? 'error' : 'ok',
          createdAt: t.createdAt || null,
          locals: usesSelf ? this.trackerScope(t) : null,
          where: 'the Trackers tab',
        };
      });
    });

    return skillFormulas.concat(skillMiscFormulas).concat(inlineFormulas)
      .concat(weaponMiscFormulas).concat(weaponFormulas)
      .concat(speedFormulas).concat(languageFormulas).concat(craftingFormulas).concat(deckFormulas)
      .concat(trackerFormulas);
  }

  /* ---------------- persistence ---------------- */

  toJSON() {
    // Sheet-seeded trackers save only what the player changed against the
    // sheet's own block: the spent count, any edited field, the style, and a
    // marker for the ones they deleted. `resources` stays as imported, so a
    // Reset really does go back to the sheet.
    const live = new Map(this.trackers.filter((t) => t.source === 'sheet').map((t) => [t.id, t]));
    const sheetTrackerState = this.#seedTrackers().map((seed) => {
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
      ...this.data,
      // resolvedZones is derived every recompute; the zone formulas themselves
      // live in style.zones.
      customTrackers: this.trackers
        .filter((t) => t.source === 'player')
        .map(({ resolvedZones, edited, ...t }) => t),
      sheetTrackerState,
      akashic: stripDerived(this.data.akashic, AKASHIC_DERIVED),
      maneuvers: stripDerived(this.data.maneuvers, MANEUVER_DERIVED),
      vancian: stripDerived(this.data.vancian, VANCIAN_DERIVED),
      psionics: stripDerived(this.data.psionics, PSIONIC_DERIVED),
      primordia: stripDerived(this.data.primordia, PRIMORDIA_DERIVED),
      cardcasting: stripDerived(this.data.cardcasting, CARDCASTING_DERIVED),
      familiar: stripDerived(this.data.familiar, COMPANION_DERIVED),
      animalCompanion: stripDerived(this.data.animalCompanion, COMPANION_DERIVED),
      eidolon: stripDerived(this.data.eidolon, COMPANION_DERIVED),
    };
  }

  /** Values the player has changed away from the imported sheet. */
  diffFromSource() {
    const out = [];
    for (const d of DERIVED) {
      const now = d.key === 'initiative' ? this.data.hp.initiative : getPath(this.data, d.key);
      const was = this.imported[d.key];
      if (Number(now) !== Number(was)) out.push({ key: d.key, label: d.label, was, now });
    }
    return out;
  }
}

/** Where a non-prose formula lives, for a reader who needs to go and find it. */
const SOURCE_WORD = {
  skill: 'the Skills tab',
  weapon: 'a weapon',
  crafting: 'the Crafting tab',
  sheet: 'a tracker from the sheet',
  player: 'a field on the sheet',
};

/**
 * Why `name` may not be defined by a player, or null if it may.
 *
 * Three ways a name can collide with what the sheet works out for itself: it
 * *is* one (`level`), it hangs off one (`level.bonus`, where level is a
 * number and cannot hold anything), or it is the branch one lives on (`str`,
 * which already holds str.mod and the rest).
 */
function shadowReason(name, builtin) {
  if (builtin.has(name)) {
    return `"${name}" is a value the sheet works out for itself, so it cannot be defined here. `
      + 'Pick a name of your own — a dotted one such as my.' + String(name).split('.').pop()
      + ' never collides.';
  }
  const parts = String(name).split('.');
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join('.');
    if (builtin.has(head)) {
      return `"${head}" is a value the sheet works out for itself, so nothing can be hung off it. `
        + `Pick a name of your own rather than "${name}".`;
    }
  }
  const branch = `${name}.`;
  const under = [...builtin].filter((b) => b.startsWith(branch));
  if (under.length) {
    return `"${name}" is where the sheet keeps ${under.slice(0, 3).join(', ')}`
      + `${under.length > 3 ? ' and more' : ''}, so it cannot be defined here. `
      + 'Pick a name of your own.';
  }
  return null;
}

/**
 * A prose source path (`note:1`, `feature:Monk:5:Special`) as something a
 * player can go and look at. The paths are internal, stable and meaningless
 * to a reader; this is the one place that translates them.
 */
export function describeSource(path) {
  const parts = String(path || '').split(':');
  const [head, a, b] = parts;
  const nth = (i) => Number(i) + 1;
  switch (head) {
    case 'feature': return `${a} class feature, level ${b}`;
    case 'template': return 'a template feature';
    case 'note': return `note ${nth(a)} on Lore`;
    case 'background': return `background section ${nth(a)}`;
    case 'trait': return a === 'additional' ? `additional trait ${nth(b)}` : `${a} trait`;
    case 'mythic': return `mythic ability ${nth(a)}`;
    case 'mythicTradition': return 'mythic tradition';
    case 'primordia': return a === 'notes' ? 'Primordia notes' : `Primordia, level ${a}`;
    case 'crafting': return `crafting project ${nth(a)}`;
    case 'weapon': return `weapon ${nth(a)}, special properties`;
    case 'gear':
    case 'other': return `gear ${nth(a)}`;
    case 'talent':
    case 'bonusTalent': return `a ${a} talent`;
    case 'tradition': return `${a} tradition`;
    case 'drawback': return `${a} drawback`;
    case 'boughtOff': return `${a} drawback bought off`;
    case 'veil': return parts[3] === 'name' ? 'a veil’s name' : 'a veil’s description';
    case 'card': return `card ${nth(a)}`;
    case 'sideboard': return `sideboard card ${nth(a)}`;
    case 'deckManipulation': return 'a deck manipulation';
    case 'cardcasting': return 'Cardcasting notes';
    case 'familiar': return 'the familiar';
    case 'animalCompanion': return 'the animal companion';
    case 'eidolon': return 'the eidolon';
    case 'tab': return `the ${a} tab`;
    default:
      if (head?.endsWith('Extra')) return `the ${head.replace(/Extra$/, '')} tab`;
      return head ? `${head}` : 'somewhere on the sheet';
  }
}

/**
 * The dotted names in a scope object: {essence: {self: 3}} -> ['essence.self'].
 *
 * One definition, used both for the character's own names and for the little
 * local scopes a field brings with it, so "what may this formula read" is
 * answered the same way in both places.
 */
function flatNames(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatNames(v, path));
    else out.push(path);
  }
  return out;
}

function safe(fn, fallback) {
  try {
    const v = fn();
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export { slug };
