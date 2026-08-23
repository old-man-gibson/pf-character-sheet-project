/*
 * Convert an exported Pathfinder character workbook into the app's JSON schema.
 *
 * This is a port of `tools/convert.py`, and deliberately a literal one: the same
 * extractors, in the same order, reading the same cells. `tests/convert.test.mjs`
 * holds it to that by converting every bundled workbook and comparing the
 * result against what the Python converter wrote, so the two cannot drift.
 *
 * Why it exists twice: the Python converter needs Python and openpyxl on the
 * machine doing the converting, which is fine for the GM rebuilding the bundled
 * characters and useless for a player handed a URL. This runs in the browser,
 * so a tester can drop their own .xlsx onto the page and get their character —
 * the workbook is parsed in memory and thrown away, and never leaves the
 * machine, because there is nowhere for it to go.
 *
 * The extraction strategy is the Python file's, and its reasoning is worth
 * repeating: the workbooks all descend from one template, so nothing is keyed to
 * hard-coded cell addresses. Instead it leans on the template's ~476 defined
 * names, and on label-anchored scans that find a table by its header text and
 * walk down from there. Google-only formulas (ARRAYFORMULA, FILTER) do not
 * survive an .xlsx export, but their cached values do — so values are what get
 * read, and the derived-stat maths is reimplemented in the app's formula engine.
 */

import { readWorkbook, columnIndex, destinations } from './xlsx.js';
import { POINT_BUY_COST, STANDARD_SKILLS, abpDefence } from './rules.js';

/** Bump in step with SCHEMA_VERSION in model.js and convert.py. */
export const SCHEMA_VERSION = 9;

const ABILITIES = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];

// Reference/lookup tabs: machinery, not character data.
const REF_TABS = new Set([
  'InstructionsProviso', 'vancianRef', 'dataSheet', 'maneuversRef',
  'psionicRef', 'techRef',
]);

// Reference tabs that are nonetheless captured cell-for-cell: techRef is a
// character's own technique catalogue (one column per technique, an approval
// status on each), which the model reads into its techniques block on load --
// see `importTechniques` in model.js. Its named ranges are still skipped.
const CAPTURED_REF_TABS = new Set(['techRef']);

// Tabs handled by a dedicated extractor; everything else visible is captured
// generically so nothing silently disappears.
// The Template tab is not one of them: it is captured cell-for-cell like any
// other tab and read into feature groups by the model (`importTemplateTab`),
// which keeps that scan in one place rather than in both converters.
const STRUCTURED_TABS = new Set([
  'Character Info', 'Stats', 'Planner', 'Feats', 'Mythic', 'Equipment',
  'Background & Lore', 'Combat Training', 'Magic Training',
]);

/* ---------------------------------------------------------------------- *
 * Value normalisation — the Python `clean`, `num`, `slug` and `str`
 * ---------------------------------------------------------------------- */

/** A filename- and URL-safe id, matching the app's own slug rule. */
export function slug(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'x';
}

/** `datetime.isoformat()`: seconds precision, microseconds only when non-zero. */
function isoFromDate(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const base = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  const ms = d.getUTCMilliseconds();
  return ms ? `${base}.${p(ms * 1000, 6)}` : base;
}

/** Normalise a cell value: trim strings, collapse float-ints, drop blanks. */
function clean(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    // '' and the spreadsheet's own error values (#REF!, #NAME?, ...) are noise.
    return t === '' || t.startsWith('#') ? null : t;
  }
  if (v instanceof Date) return isoFromDate(v);
  return v;
}

function num(v, fallback = 0) {
  const c = clean(v);
  if (typeof c === 'boolean') return c ? 1 : 0;
  if (typeof c === 'number') return c;
  if (typeof c === 'string') {
    const m = /^[+\s]*(-?\d+(?:\.\d+)?)/.exec(c.replace(/,/g, ''));
    if (m) return Number(m[1]);
  }
  return fallback;
}

/** Python's `str()`, which spells booleans differently from JavaScript's. */
function pystr(v) {
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/** Python truthiness, which agrees with JavaScript's on everything used here. */
const truthy = (v) => Boolean(v);

/* ---------------------------------------------------------------------- *
 * Book — label- and name-based access to a workbook
 * ---------------------------------------------------------------------- */

class Book {
  constructor(workbook) {
    this.sheets = workbook.sheets;
    this.definedNames = workbook.definedNames;
    this.grids = new Map();
    for (const s of workbook.sheets) {
      this.grids.set(s.name, s.grid.map((row) => row.map(clean)));
    }
  }

  tabs() {
    return this.sheets.map((s) => [s.name, s.state]);
  }

  has(tab) {
    return this.grids.has(tab);
  }

  /** 1-indexed row/col. */
  cell(tab, row, col) {
    const g = this.grids.get(tab);
    if (!g || !row || row > g.length || row < 1) return null;
    const r = g[row - 1];
    if (!col || col > r.length || col < 1) return null;
    return r[col - 1];
  }

  rows(tab) {
    return this.grids.get(tab)?.length ?? 0;
  }

  /** Return [row, col] of the first cell exactly matching `label`. */
  findLabel(tab, label, maxRow = null) {
    const g = this.grids.get(tab);
    if (!g) return null;
    for (let i = 0; i < g.length; i++) {
      if (maxRow && i >= maxRow) break;
      const r = g[i];
      for (let j = 0; j < r.length; j++) {
        if (typeof r[j] === 'string' && r[j] === label) return [i + 1, j + 1];
      }
    }
    return null;
  }

  /** Value `offset` columns right of a label cell — the sheet's dominant idiom. */
  rightOf(tab, label, offset = 1) {
    const pos = this.findLabel(tab, label);
    return pos ? this.cell(tab, pos[0], pos[1] + offset) : null;
  }

  /** Resolve every defined name to a scalar or small 2D block. */
  named() {
    const out = {};
    const REF = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/;
    for (const { name, value } of this.definedNames) {
      if (typeof value !== 'string' || value.startsWith('LAMBDA')) continue;
      for (const [tab, ref] of destinations(value)) {
        if (!this.grids.has(tab) || REF_TABS.has(tab)) continue;
        const m = REF.exec(ref);
        if (!m) continue;
        const [, c1, r1, c2, r2] = m;
        const col1 = columnIndex(c1);
        const row1 = Number(r1);
        if (c2 === undefined) {
          const v = this.cell(tab, row1, col1);
          if (v !== null) out[name] = v;
        } else {
          const col2 = columnIndex(c2);
          const row2 = Number(r2);
          // Skip giant lookup blocks; they are rules data, not character data.
          // A `continue` rather than a `break`, so a name whose first
          // destination is a lookup table can still resolve through a later one.
          if ((row2 - row1 + 1) * (col2 - col1 + 1) > 400) continue;
          const block = [];
          for (let r = row1; r <= row2; r++) {
            const line = [];
            for (let c = col1; c <= col2; c++) line.push(this.cell(tab, r, c));
            block.push(line);
          }
          if (block.some((r) => r.some((x) => x !== null))) out[name] = block;
        }
        break;
      }
    }
    return out;
  }
}

/** Trim trailing nulls so rows compare cleanly. */
function stripRow(row) {
  const r = [...row];
  while (r.length && r[r.length - 1] === null) r.pop();
  return r;
}

/** Read a rectangular table into a list of objects keyed by the header row. */
function table(bk, tab, headerRow, startRow, colStart, colEnd, stopBlank = 3) {
  if (!bk.has(tab)) return [];
  const headers = [];
  for (let c = colStart; c <= colEnd; c++) {
    const h = bk.cell(tab, headerRow, c);
    headers.push(h !== null ? pystr(h) : `col${c}`);
  }
  const rows = [];
  let blanks = 0;
  let r = startRow;
  const total = bk.rows(tab);
  while (r <= total) {
    const vals = [];
    for (let c = colStart; c <= colEnd; c++) vals.push(bk.cell(tab, r, c));
    if (vals.every((v) => v === null)) {
      blanks += 1;
      if (blanks >= stopBlank) break;
      r += 1;
      continue;
    }
    blanks = 0;
    const row = {};
    headers.forEach((h, i) => { if (vals[i] !== null) row[h] = vals[i]; });
    rows.push(row);
    r += 1;
  }
  return rows;
}

/* ---------------------------------------------------------------------- *
 * Section extractors
 * ---------------------------------------------------------------------- */

function extractIdentity(bk) {
  const CI = 'Character Info';
  const speeds = [];
  for (let r = 4; r < 8; r++) {
    const t = bk.cell(CI, r, 13);  // M: movement type
    if (t === null) continue;
    speeds.push({
      type: pystr(t),
      base: num(bk.cell(CI, r, 14)),
      bonus: num(bk.cell(CI, r, 15)),
      final: num(bk.cell(CI, r, 16)),
    });
  }
  return {
    name: bk.cell(CI, 3, 3),
    player: bk.cell(CI, 3, 9),
    race: bk.cell(CI, 4, 3),
    size: bk.cell(CI, 4, 6),
    gender: bk.cell(CI, 4, 9),
    age: bk.cell(CI, 4, 11),
    variant: bk.cell(CI, 5, 3),
    heroPoints: { current: num(bk.cell(CI, 5, 5)), max: num(bk.cell(CI, 5, 7), 3) },
    height: bk.cell(CI, 5, 9),
    weight: bk.cell(CI, 5, 11),
    level: num(bk.cell(CI, 6, 3)),
    alignment: bk.cell(CI, 6, 6),
    deity: bk.cell(CI, 6, 9),
    specialty: bk.cell(CI, 7, 3),
    specialtyFeat: bk.cell(CI, 7, 6) ?? bk.cell(CI, 7, 8),
    specialtyPerks: [bk.cell(CI, 8, 3), bk.cell(CI, 8, 8)].filter(truthy),
    image: bk.cell(CI, 4, 18),
    nativeLanguages: bk.cell(CI, 10, 3),
    downtimeLanguages: bk.cell(CI, 10, 8),
    intLanguages: bk.cell(CI, 11, 3),
    linguisticsLanguages: bk.cell(CI, 12, 3),
    proficiencies: {
      weapons: bk.cell(CI, 11, 15),
      armor: bk.cell(CI, 12, 15),
      shield: bk.cell(CI, 13, 15),
    },
    speeds,
    mythicPath: bk.cell(CI, 18, 14),
    mythicTier: num(bk.cell(CI, 19, 14)),
    focusStat: bk.cell(CI, 20, 14),
    guild: bk.cell(CI, 15, 17),
    primordiaTechnique: bk.cell(CI, 16, 14),
  };
}

/** Ability scores plus the Stats-tab breakdown of where each bonus came from. */
function extractAbilities(bk) {
  const CI = 'Character Info';
  const ST = 'Stats';
  const breakdownHeaders = [];
  if (bk.has(ST)) {
    for (let c = 3; c < 20; c++) breakdownHeaders.push(bk.cell(ST, 2, c));
  }

  const out = {};
  ABILITIES.forEach((ab, i) => {
    const r = 15 + i;
    const entry = {
      score: num(bk.cell(CI, r, 3)),
      mod: num(bk.cell(CI, r, 4)),
      tempScore: num(bk.cell(CI, r, 5)),
      totalMod: num(bk.cell(CI, r, 6)),
      checkMod: num(bk.cell(CI, r, 7)),
    };
    if (bk.has(ST)) {
      const src = {};
      breakdownHeaders.forEach((h, j) => {
        if (!h) return;
        const v = bk.cell(ST, 3 + i, 3 + j);
        if (v !== null && v !== false && v !== 0) src[pystr(h)] = v;
      });
      entry.sources = src;
    }
    out[ab.toLowerCase()] = entry;
  });
  return out;
}

// Stats-tab column letters -> build keys. Column B holds the computed total.
const STATS_COLUMNS = [
  [3, 'pointBuy'],        // C
  [4, 'race'],            // D
  [5, 'abp'],             // E  Automatic Bonus Progression enhancement
  [6, 'gear'],            // F  gear enhancement (caps with abp at +6)
  [7, 'attunement'],      // G  boolean in the sheet; +2 when set
  [8, 'inherent'],        // H
  [9, 'array'],           // I  optional array
  [10, 'level4'],         // J  the every-fourth-level increase
  [11, 'mythic'],         // K
  [12, 'size'],           // L  permanent
  [13, 'untyped'],        // M  permanent
  [15, 'alchemical'],     // O  temporary from here down
  [16, 'circumstance'],   // P
  [17, 'morale'],         // Q
  [18, 'tempEnhancement'],// R
  [19, 'tempSize'],       // S
];

/**
 * The Stats tab: every bonus that feeds an ability score, by source.
 *
 * Reproduces as:
 *   enhancement = min(6, abp + gear)
 *   total       = pointBuy + race + enhancement + attunement + inherent
 *                 + array + level4 + mythic + size + untyped
 *   tempTotal   = total + alchemical + circumstance + morale
 *                 + tempEnhancement + tempSize
 */
function extractStatsBuild(bk) {
  const ST = 'Stats';
  if (!bk.has(ST)) return null;
  const build = {};
  ABILITIES.forEach((ab, i) => {
    const r = 3 + i;
    const entry = {};
    for (const [col, key] of STATS_COLUMNS) {
      const v = bk.cell(ST, r, col);
      entry[key] = key === 'attunement' ? (v === true ? 2 : num(v)) : num(v);
    }
    entry.sheetTotal = num(bk.cell(ST, r, 2));
    build[ab.toLowerCase()] = entry;
  });
  return build;
}

/** dataSheet K21:L33 — ability score to point-buy cost. */
function extractPointBuyTable(bk) {
  if (!bk.has('dataSheet')) return null;
  const out = {};
  let any = false;
  for (let r = 22; r < 40; r++) {
    const score = bk.cell('dataSheet', r, 11);   // K
    const cost = bk.cell('dataSheet', r, 12);    // L
    if (typeof score === 'number' && typeof cost === 'number'
        && typeof score !== 'boolean' && typeof cost !== 'boolean') {
      out[Math.trunc(score)] = Math.trunc(cost);
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * Find a Planner column by the start of its header text.
 *
 * The Prowess/Array block sits at a different offset in different characters'
 * sheets (AN/AO/AP in some, AL/AM/AN in others), so it must be located by label
 * rather than by a fixed column index.
 */
function plannerColumn(bk, prefix) {
  for (let c = 1; c < 80; c++) {
    const h = bk.cell('Planner', 1, c);
    if (typeof h === 'string' && h.trimStart().startsWith(prefix)) return c;
  }
  return null;
}

/**
 * Ability-boosting choices recorded on the Planner, by level.
 *
 *   "Level/4"           the every-fourth-level +1 increase
 *   Mental Prowess      ABP, +2 each
 *   Physical Prowess    ABP, +2 each
 *   "Array (Optional)"  the optional array, +2 each, 4 slots per row
 *
 * Planner row = level + 1.
 */
function extractProgressionPicks(bk) {
  if (!bk.has('Planner')) return null;

  const colL4 = plannerColumn(bk, 'Level/4') ?? 2;
  const colMental = plannerColumn(bk, 'Mental Prowess');
  const colPhysical = plannerColumn(bk, 'Physical Prowess');
  const colArray = plannerColumn(bk, 'Array');

  const level4 = [];
  const abp = [];
  const array = [];
  for (let level = 1; level <= 20; level++) {
    const r = level + 1;
    const pick = bk.cell('Planner', r, colL4);
    if (typeof pick === 'string' && pick.trim()) {
      level4.push({ level, ability: pick.trim() });
    }

    const mental = colMental ? bk.cell('Planner', r, colMental) : null;
    const physical = colPhysical ? bk.cell('Planner', r, colPhysical) : null;
    if (typeof mental === 'string' || typeof physical === 'string') {
      abp.push({
        level,
        mental: typeof mental === 'string' ? mental.trim() : null,
        physical: typeof physical === 'string' ? physical.trim() : null,
      });
    }

    if (colArray) {
      const slots = [];
      for (let c = colArray; c < colArray + 4; c++) {
        const s = bk.cell('Planner', r, c);
        slots.push(typeof s === 'string' ? s.trim() : null);
      }
      if (slots.some(truthy)) array.push({ level, slots });
    }
  }

  return {
    level4,
    abp,
    array,
    arrayNote: colArray ? bk.cell('Planner', 1, colArray) : null,
  };
}

function extractClasses(bk) {
  const CI = 'Character Info';
  const out = [];
  for (let r = 23; r < 41; r++) {
    const name = bk.cell(CI, r, 2);
    if (!name || (typeof name === 'string' && /^Class \d+$/.test(name))) continue;
    out.push({
      name,
      hd: num(bk.cell(CI, r, 4)),
      bab: bk.cell(CI, r, 5),
      babOverride: bk.cell(CI, r, 6),
      goodFort: truthy(bk.cell(CI, r, 7)),
      goodRef: truthy(bk.cell(CI, r, 8)),
      goodWill: truthy(bk.cell(CI, r, 9)),
      skillRanks: num(bk.cell(CI, r, 10)),
      archetypes: bk.cell(CI, r, 11),
    });
  }
  return out;
}

/** The two condition columns (K/L and M/N) on Character Info. */
function extractConditions(bk) {
  const CI = 'Character Info';
  const out = {};
  for (let r = 44; r < 53; r++) {
    for (const [lblC, valC] of [[11, 12], [13, 14]]) {
      const lbl = bk.cell(CI, r, lblC);
      if (lbl) out[pystr(lbl)] = num(bk.cell(CI, r, valC));
    }
  }
  // The shared template has Helpless and Paralyzed at 1 in every workbook,
  // with nothing else on: a leftover, not a state. Cleared here so a fresh
  // import does not open with the character paralysed.
  const on = Object.keys(out).filter((k) => out[k]).sort();
  if (on.length === 2 && on[0] === 'Helpless' && on[1] === 'Paralyzed') {
    for (const k of on) out[k] = 0;
  }
  return out;
}

function extractDefenses(bk) {
  const CI = 'Character Info';
  return {
    ac: num(bk.cell(CI, 44, 3)),
    touch: num(bk.cell(CI, 45, 3)),
    flatFooted: num(bk.cell(CI, 46, 3)),
    cmd: num(bk.cell(CI, 47, 3)),
    ffCmd: num(bk.cell(CI, 47, 5)),
    acStat1: bk.cell(CI, 44, 5),
    acStat2: bk.cell(CI, 45, 5),
    bonusAC: bk.cell(CI, 46, 5),
    uncannyDodge: truthy(bk.cell(CI, 44, 9)),
    nonTouch: num(bk.cell(CI, 45, 8)),
    miscAC: num(bk.cell(CI, 46, 8)),
    miscCMD: num(bk.cell(CI, 47, 8)),
    spellResistance: bk.cell(CI, 48, 3),
    dr: bk.cell(CI, 48, 5),
    weakness: bk.cell(CI, 48, 8),
    immunities: bk.cell(CI, 49, 5),
    resistance: bk.cell(CI, 50, 5),
  };
}

function extractAttack(bk) {
  const CI = 'Character Info';
  const rows = [
    ['melee', 53], ['altMelee', 54], ['ranged', 55],
    ['altRanged', 56], ['cmb', 57], ['altCmb', 58],
  ];
  const modes = {};
  for (const [key, r] of rows) {
    modes[key] = {
      value: num(bk.cell(CI, r, 3)),
      stat1: bk.cell(CI, r, 5),
      stat2: bk.cell(CI, r, 7),
    };
  }
  return {
    bab: num(bk.cell(CI, 52, 3)),
    iterative: bk.cell(CI, 52, 5),
    miscBonus: num(bk.cell(CI, 52, 9)),
    modes,
    totalMelee: num(bk.cell(CI, 54, 9)),
    totalRanged: num(bk.cell(CI, 56, 9)),
    totalCmb: num(bk.cell(CI, 58, 9)),
  };
}

function extractSaves(bk) {
  const CI = 'Character Info';
  const out = {};
  for (const [key, r] of [['fortitude', 61], ['reflex', 62], ['will', 63]]) {
    out[key] = {
      total: num(bk.cell(CI, r, 3)),
      stat1: bk.cell(CI, r, 5),
      stat2: bk.cell(CI, r, 7),
      base: num(bk.cell(CI, r, 10)),
    };
  }
  return out;
}

function extractTraits(bk) {
  const CI = 'Character Info';
  const traits = [];
  for (let r = 60; r < 74; r++) {
    const label = bk.cell(CI, r, 11);
    if (!label) continue;
    const kind = bk.cell(CI, r, 12);
    const desc = bk.cell(CI, r, 14);
    if (kind === null && desc === null) continue;
    traits.push({ slot: pystr(label), category: kind, text: desc });
  }
  const raceTraits = [];
  for (let r = 66; r < 74; r++) {
    const v = bk.cell(CI, r, 3);
    if (v) raceTraits.push(v);
  }
  return [traits, raceTraits];
}

/** Skills table: label-anchored so a shifted template still lines up. */
function extractSkills(bk) {
  const CI = 'Character Info';
  const pos = bk.findLabel(CI, 'Skills');
  if (!pos) return [];
  const headerRow = pos[0];
  const sub = headerRow + 1;  // Level / Specialty / Gear / Other / ... sub-headers
  const rankHeaders = [];
  for (let c = 7; c < 15; c++) rankHeaders.push(bk.cell(CI, sub, c));

  const out = [];
  let r = headerRow + 2;
  const total = bk.rows(CI);
  let blanks = 0;
  while (r <= total) {
    const name = bk.cell(CI, r, 2);
    if (name === null) {
      blanks += 1;
      if (blanks >= 3) break;
      r += 1;
      continue;
    }
    blanks = 0;
    if (pystr(name) === 'Skills') { r += 1; continue; }
    // The rank-budget metrics live directly under the skill rows; they are not
    // skills, and everything from there on belongs to other sections.
    if (['Bonus Skill points', 'Int Bonus per', 'Total Skill Points',
         'Other Trackables', 'Name, Info'].some((p) => pystr(name).startsWith(p))) {
      break;
    }
    const ranks = {};
    rankHeaders.forEach((h, j) => {
      if (!h) return;
      const v = num(bk.cell(CI, r, 7 + j), null);
      if (v) ranks[pystr(h)] = v;
    });
    const abil = [17, 18, 19].map((c) => bk.cell(CI, r, c));
    out.push({
      name: pystr(name),
      spec: bk.cell(CI, r, 3),
      bonus: num(bk.cell(CI, r, 4)),
      classSkill: truthy(bk.cell(CI, r, 5)),
      totalRanks: num(bk.cell(CI, r, 6)),
      ranks,
      requiresTraining: pystr(bk.cell(CI, r, 15) ?? '').toLowerCase() === 'yes',
      armorPenalty: truthy(bk.cell(CI, r, 16)),
      abilities: abil.filter(truthy),
      situational: bk.cell(CI, r, 20),
    });
    r += 1;
  }
  return out;
}

/**
 * The rank-budget metrics under the skills table: bonus skill points per level
 * and the Int bonus per level, used to validate assigned ranks.
 */
function extractSkillBudget(bk) {
  const CI = 'Character Info';
  const pos = bk.findLabel(CI, 'Bonus Skill points per Level');
  if (!pos) return { bonusPerLevel: 0, intPerLevel: 0 };
  const [r, c] = pos;
  const out = {
    bonusPerLevel: num(bk.cell(CI, r, c + 1)),
    intPerLevel: 0,
    sheetPerLevel: 0,
  };
  const total = bk.rows(CI);
  for (let rr = r; rr < Math.min(r + 4, total + 1); rr++) {
    const lbl = bk.cell(CI, rr, c);
    if (typeof lbl === 'string' && lbl.startsWith('Int Bonus per')) {
      out.intPerLevel = num(bk.cell(CI, rr, c + 1));
    }
    if (typeof lbl === 'string' && lbl.startsWith('Total Skill Points per')) {
      out.sheetPerLevel = num(bk.cell(CI, rr, c + 1));
    }
  }
  return out;
}

function extractCarry(bk) {
  const CI = 'Character Info';
  const out = { tiers: [] };
  for (let r = 44; r < 49; r++) {
    const lbl = bk.cell(CI, r, 22);
    if (lbl) out.tiers.push({ name: pystr(lbl), limit: num(bk.cell(CI, r, 24)) });
  }
  out.antHaul = num(bk.cell(CI, 49, 23), 1);
  out.strBonus = num(bk.cell(CI, 50, 23));
  out.quadruped = truthy(bk.cell(CI, 51, 23));
  out.carried = num(bk.cell(CI, 52, 23));
  return out;
}

/** The sheet's own Resource Tracker — seeds of the custom tracker system. */
function extractResources(bk) {
  const CI = 'Character Info';
  const pos = bk.findLabel(CI, 'Resource Tracker');
  if (!pos) return [];
  const hdr = pos[0] + 1;
  const c = pos[1];
  const out = [];
  for (let r = hdr + 1; r <= hdr + 20; r++) {
    const name = bk.cell(CI, r, c);
    if (name) {
      out.push({
        name: pystr(name),
        uses: num(bk.cell(CI, r, c + 1)),
        total: bk.cell(CI, r, c + 2),
        refresh: bk.cell(CI, r, c + 3),
      });
    }
  }
  return out;
}

/**
 * The wallet: the campaign's currency is mana, and the block beside the
 * mythic path on Character Info tracks it -- the balance recorded after the
 * last Oath of Offerings ("Wallet (Baseline after OoO)"), whether the
 * character keeps the Oath and casts materially, when the last offering was
 * made, the mana earned a day, sessions since, and the current balance. The
 * expected offering and the balance after it are formulas, recomputed by the
 * model. Older sheets carry only the "Wallet" label (Angou) or none at all
 * (Bryva, Nico): the block is null then and the model starts one empty.
 */
function extractWealth(bk) {
  const CI = 'Character Info';
  const g = bk.grids.get(CI);
  if (!g) return null;
  let wallet = null;
  for (let i = 0; i < g.length && !wallet; i++) {
    for (let j = 0; j < g[i].length; j++) {
      if (typeof g[i][j] === 'string' && g[i][j].startsWith('Wallet')) { wallet = [i + 1, j + 1]; break; }
    }
  }
  if (!wallet) return null;
  // The value beside a label, skipping the blank a merged cell leaves.
  const beside = (label) => {
    const p = bk.findLabel(CI, label);
    if (!p) return null;
    for (let n = 1; n <= 3; n++) {
      const v = bk.cell(CI, p[0], p[1] + n);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const bool = (v) => v === true;
  return {
    baseline: bk.cell(CI, wallet[0] + 1, wallet[1]),
    current: beside('Current Mana'),
    oathOfOfferings: bool(beside('Oath of Offerings')),
    materialCasting: bool(beside('Material Casting')),
    lastOffering: beside('Last Offering'),
    manaPerDay: beside('Mana/Day'),
    sessions: beside('Sessions'),
  };
}

function extractHp(bk) {
  const CI = 'Character Info';
  return {
    total: num(bk.cell(CI, 18, 10)),
    ability: bk.cell(CI, 18, 12),
    fcb: num(bk.cell(CI, 19, 10)),
    ability2: bk.cell(CI, 19, 12),
    toughness: num(bk.cell(CI, 20, 10)),
    // Beside Toughness, and the last part of the workbook's own HP sum. It
    // is empty on every sheet converted so far, which is exactly why it was
    // missed: the total was kept and the parts that made it were not.
    misc: num(bk.cell(CI, 20, 12)),
    initiative: num(bk.cell(CI, 15, 9)),
    initAbility: bk.cell(CI, 15, 10),
    initAbility2: bk.cell(CI, 15, 11),
  };
}

function extractPlanner(bk) {
  if (!bk.has('Planner')) return [];
  const headers = [];
  for (let c = 1; c < 60; c++) {
    const h = bk.cell('Planner', 1, c);
    if (h) headers.push([c, pystr(h)]);
  }
  const out = [];
  for (let r = 2; r < 22; r++) {
    const row = {};
    let any = false;
    for (const [c, h] of headers) {
      const v = bk.cell('Planner', r, c);
      if (v !== null) { row[h] = v; any = true; }
    }
    if (any) out.push(row);
  }
  return out;
}

/** Feats tab is a set of side-by-side category columns. */
function extractFeats(bk) {
  if (!bk.has('Feats')) return {};
  const groups = {};
  for (let c = 1; c < 40; c++) {
    const cat = bk.cell('Feats', 2, c);
    if (!cat) continue;
    const entries = [];
    for (let r = 3; r < 25; r++) {
      const name = bk.cell('Feats', r, c);
      if (!name || pystr(name) === 'Name') continue;
      entries.push({ name: pystr(name), detail: bk.cell('Feats', r, c + 2) });
    }
    if (entries.length) {
      const base = pystr(cat);
      let key = base;
      let n = 2;
      while (key in groups) { key = `${base} ${n}`; n += 1; }
      groups[key] = entries;
    }
  }
  return groups;
}

function extractMythic(bk) {
  if (!bk.has('Mythic')) return {};
  const out = {
    path: bk.rightOf('Mythic', 'Mythic Path'),
    tier: num(bk.rightOf('Mythic', 'Mythic Tier')),
    baseAbilities: [],
    abilities: [],
    tradition: {},
    flowingPower: false,
  };
  for (let r = 6; r < 10; r++) {
    const v = bk.cell('Mythic', r, 3);
    if (v && !['Base Path Ability', 'Base Mythic Abilities'].includes(pystr(v))) {
      out.baseAbilities.push(v);
    }
  }
  out.basePathAbility = bk.rightOf('Mythic', 'Base Path Ability');

  // Two layouts: the current template has a Lvl column (labels in C), the older
  // one starts the ability slots in column B.
  const newLayout = bk.cell('Mythic', 11, 2) === 'Lvl';
  const cSlot = newLayout ? 3 : 2;

  let rTrad = null;
  for (let r = 12; r < 40; r++) {
    if (bk.cell('Mythic', r, cSlot) === 'Mythic Tradition') { rTrad = r; break; }
  }

  for (let r = 12; r < (rTrad ?? 32); r++) {
    const slot = bk.cell('Mythic', r, cSlot);
    const name = bk.cell('Mythic', r, cSlot + 1);
    const feat = bk.cell('Mythic', r, cSlot + 3);
    const extra = bk.cell('Mythic', r, cSlot + 4);
    const stat = bk.cell('Mythic', r, cSlot + 5);
    if (!(name || feat || extra || stat)) continue;
    out.abilities.push({
      level: newLayout ? num(bk.cell('Mythic', r, 2), null) : null,
      slot,
      name,
      path: bk.cell('Mythic', r, cSlot + 2),
      feat,
      featChoice: extra,
      statBonus: stat,
    });
  }

  // Mythic tradition: one mandatory drawback unlocking a boon, up to two more
  // drawbacks for two more boons, and a quality.
  if (rTrad) {
    const keys = {
      'Drawback 1': 'drawback1', 'Drawback 2': 'drawback2',
      'Drawback 3': 'drawback3', Quality: 'quality',
      'Boon 1': 'boon1', 'Boon 2': 'boon2', 'Boon 3': 'boon3',
    };
    for (let r = rTrad + 1; r < rTrad + 9; r++) {
      const lbl = bk.cell('Mythic', r, cSlot);
      if (typeof lbl === 'string' && lbl in keys) {
        out.tradition[keys[lbl]] = bk.cell('Mythic', r, cSlot + 1);
      }
    }
    // Flowing Power checkbox sits beside the header in the new layout.
    const fp = bk.cell('Mythic', rTrad, cSlot + 3);
    out.flowingPower = typeof fp === 'boolean' ? fp : false;
  }
  return out;
}

const GEAR_SLOTS = ['Head', 'Headband', 'Eyes', 'Shoulders', 'Neck', 'Chest',
  'Body', 'Armor', 'Belt', 'Wrists', 'Hands', 'Ring 1', 'Ring 2', 'Feet'];

/** One slotted-gear row: name, three typed bonuses, four other bonuses. */
function gearRow(bk, tab, r, slot) {
  const bonuses = [];
  for (const [vc, tc] of [[3, 4], [5, 6], [7, 8]]) {
    const v = bk.cell(tab, r, vc);
    const t = bk.cell(tab, r, tc);
    bonuses.push({
      value: v !== null ? num(v) : null,
      type: typeof t === 'string' ? t : null,
    });
  }
  const others = [9, 11, 13, 15].map((c) => bk.cell(tab, r, c));
  return {
    slot,
    name: bk.cell(tab, r, 2),
    bonuses,
    others: others.map((o) => (typeof o === 'string' ? o : (o !== null ? pystr(o) : null))),
    weight: num(bk.cell(tab, r, 17)),
    cost: num(bk.cell(tab, r, 18)),
  };
}

function armorRow(bk, tab, r, kind) {
  return {
    kind,
    name: bk.cell(tab, r, 2),
    acBonus: num(bk.cell(tab, r, 3)),
    maxDex: num(bk.cell(tab, r, 4), null),
    acp: num(bk.cell(tab, r, 5)),
    type: bk.cell(tab, r, 6),
    ghostTouch: truthy(bk.cell(tab, r, 7)),
    spellFailure: bk.cell(tab, r, 8),
    others: [9, 11, 13, 15].map((c) => bk.cell(tab, r, c)).filter(truthy),
    weight: num(bk.cell(tab, r, 17)),
    cost: num(bk.cell(tab, r, 18)),
  };
}

/**
 * Equipment worksheet: slotted gear, other items, armor & shields, and up to six
 * weapon blocks. Every section is label-anchored — some characters have extra
 * shield rows that shift everything below them.
 */
function extractEquipment(bk) {
  const tab = 'Equipment';
  if (!bk.has(tab)) {
    return { gear: [], other: [], armor: null, shields: [], weapons: [] };
  }

  const gear = GEAR_SLOTS.map((s, i) => gearRow(bk, tab, 2 + i, s));
  const other = [];
  for (let i = 0; i < 8; i++) other.push(gearRow(bk, tab, 17 + i, `Other ${i + 1}`));

  // Armor block: header row "Armor | Armor Value | Max Dex ...", then an Armor
  // row and one or more Shield rows.
  let armor = null;
  const shields = [];
  let rHdr = null;
  for (let r = 20; r < 36; r++) {
    if (bk.cell(tab, r, 1) === 'Armor' && bk.cell(tab, r, 3) === 'Armor Value') {
      rHdr = r;
      break;
    }
  }
  if (rHdr) {
    armor = armorRow(bk, tab, rHdr + 1, 'Armor');
    let r = rHdr + 2;
    while (typeof bk.cell(tab, r, 1) === 'string'
           && bk.cell(tab, r, 1).startsWith('Shield')) {
      shields.push(armorRow(bk, tab, r, bk.cell(tab, r, 1)));
      r += 1;
    }
  }

  // Weapon blocks, anchored on their "Weapon Name N" header rows.
  const weapons = [];
  const total = bk.rows(tab);
  for (let rName = 1; rName <= total; rName++) {
    const hdr = bk.cell(tab, rName, 1);
    if (!(typeof hdr === 'string' && /^Weapon Name \d+$/.test(hdr))) continue;
    const row1 = rName + 1;
    const row2 = rName + 3;
    const row3 = rName + 4;
    const name = bk.cell(tab, row1, 1);
    if (!name && !bk.cell(tab, row1, 5)) continue;
    weapons.push({
      name,
      attackType: bk.cell(tab, row1, 3),
      sheetAttack: num(bk.cell(tab, row1, 4), null),
      dice: bk.cell(tab, row1, 5),
      damageAbility: bk.cell(tab, row1, 6),
      abilityMult: num(bk.cell(tab, row1, 7), 1) || 1,
      miscDamage: num(bk.cell(tab, row1, 8)),
      sheetTotalDamage: bk.cell(tab, row1, 9),
      critRange: num(bk.cell(tab, row1, 10), null),
      critMult: bk.cell(tab, row1, 11),
      bonusCritDamage: bk.cell(tab, row1, 12),
      damageType: bk.cell(tab, row1, 13),
      groups: [bk.cell(tab, row2, 1), bk.cell(tab, row2, 2), bk.cell(tab, row2, 3)],
      miscAttack: num(bk.cell(tab, row2, 4)),
      special: bk.cell(tab, row2, 5),
      ammunition: bk.cell(tab, row2, 9),
      size: bk.cell(tab, row2, 10),
      range: bk.cell(tab, row2, 13),
      enhancement: num(bk.cell(tab, row3, 2)),
      familiarity: bk.cell(tab, row3, 4),
      handedness: bk.cell(tab, row3, 6),
      weight: num(bk.cell(tab, row3, 8)),
      price: num(bk.cell(tab, row3, 10)),
    });
  }

  return { gear, other, armor, shields, weapons };
}

const BACKGROUND_LABELS = new Set([
  'Personality', 'Appearance', 'Likes', 'Dislikes', 'Goals', 'Fears',
  'Character Strengths', 'Character Flaws', 'Friends/Family', 'Enemies/Rivals',
  'Additional Information', "Ez'atian Certifications",
]);

function extractBackground(bk) {
  const TAB = 'Background & Lore';
  if (!bk.has(TAB)) return {};
  const out = {};
  const total = bk.rows(TAB);
  for (let r = 1; r <= total; r++) {
    for (let c = 1; c < 12; c++) {
      const lbl = bk.cell(TAB, r, c);
      if (typeof lbl !== 'string') continue;
      if (!BACKGROUND_LABELS.has(lbl)) continue;
      const chunks = [];
      for (let rr = r + 1; rr < Math.min(r + 10, total + 1); rr++) {
        const v = bk.cell(TAB, rr, c);
        if (v) chunks.push(pystr(v));
      }
      out[lbl] = chunks.length ? chunks.join('\n') : null;
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- *
 * Spheres training (Combat Training / Magic Training)
 *
 * Both tabs share one layout: up to three class blocks side by side, each with
 * a per-level row (rows 5-24 = levels 1-20). Cached values (cumulative talents,
 * granted flags, CL) are extracted alongside the entered talent names so the app
 * can verify its own progression maths against the sheet's.
 * ---------------------------------------------------------------------- */

// [name, type, talents/level, mod1, mod2, countCol, grantedCol, progCol, nameCol, sphereCol]
const TRAINING_BLOCKS = [
  [[1, 5], [2, 6], [4, 6], [3, 6], [3, 7], 2, 3, 4, 5, 7],          // E/K block 1
  [[1, 11], [2, 12], [4, 12], [3, 12], [3, 13], 8, 9, 10, 11, 13],  // class 2
  [[1, 17], [2, 18], [4, 18], [3, 18], [3, 19], 14, 15, 16, 17, 19],// class 3
];

// Blocks 4-6 sit on the extended (level 21-40) page. Their per-level rows are
// out of scope, but their headers still name casting classes, which count for
// the tradition spell-point multiplier.
const TRAINING_BLOCKS_EXT = [
  [[26, 5], [27, 6], [29, 6], [28, 6], [28, 7]],
  [[26, 11], [27, 12], [29, 12], [28, 12], [28, 13]],
  [[26, 17], [27, 18], [29, 18], [28, 18], [28, 19]],
];

function trainingClasses(bk, tab) {
  const classes = [];
  for (const [nm, ty, tpl, m1, m2, cCnt, cGrant, cProg, cName, cSph] of TRAINING_BLOCKS) {
    const name = bk.cell(tab, ...nm);
    if (!name) continue;
    const levels = [];
    for (let lvl = 1; lvl <= 20; lvl++) {
      const r = 4 + lvl;
      levels.push({
        level: lvl,
        sheetCount: num(bk.cell(tab, r, cCnt)),
        sheetGranted: truthy(bk.cell(tab, r, cGrant)),
        sheetProgression: num(bk.cell(tab, r, cProg)),
        talent: bk.cell(tab, r, cName),
        sphere: bk.cell(tab, r, cSph),
      });
    }
    classes.push({
      name: pystr(name),
      type: bk.cell(tab, ...ty),
      talentsPerLevel: bk.cell(tab, ...tpl),
      mod1: bk.cell(tab, ...m1),
      mod2: bk.cell(tab, ...m2),
      levels,
    });
  }
  for (const [nm, ty, tpl, m1, m2] of TRAINING_BLOCKS_EXT) {
    const name = bk.cell(tab, ...nm);
    if (!name) continue;
    classes.push({
      name: pystr(name),
      type: bk.cell(tab, ...ty),
      talentsPerLevel: bk.cell(tab, ...tpl),
      mod1: bk.cell(tab, ...m1),
      mod2: bk.cell(tab, ...m2),
      levels: [],
      extended: true,
    });
  }
  return classes;
}

function gridTexts(bk, tab, r1, r2, c1, c2) {
  const out = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const v = bk.cell(tab, r, c);
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
  }
  return out;
}

/**
 * Row of the first cell in `col` whose text starts with `label`.
 *
 * The tradition/global blocks sit on slightly different rows across template
 * revisions, so every read is anchored to its label rather than a fixed row.
 */
function labelRow(bk, tab, col, label, start = 1, end = 80) {
  for (let r = start; r <= end; r++) {
    const v = bk.cell(tab, r, col);
    if (typeof v === 'string' && v.trimStart().startsWith(label)) return r;
  }
  return null;
}

function extractCombatTraining(bk) {
  const tab = 'Combat Training';
  if (!bk.has(tab)) return null;
  const U = 21, V = 22, W = 23, X = 24;

  const rMt = labelRow(bk, tab, U, 'Martial Tradition') ?? 4;
  const tradition = { name: bk.cell(tab, rMt, V), entries: [] };
  const rBt = labelRow(bk, tab, U, 'Bonus Talents') ?? (rMt + 15);
  for (let r = rMt + 2; r < rBt - 1; r++) {
    const t = bk.cell(tab, r, U);
    const s = bk.cell(tab, r, X);
    if (t || s) tradition.entries.push({ talent: t, sphere: s });
  }

  const bonus = [];
  const rBr = labelRow(bk, tab, U, 'Bonus Ranks') ?? (rBt + 27);
  for (let r = rBt + 1; r < rBr - 1; r++) {
    const t = bk.cell(tab, r, U);
    if (t) {
      bonus.push({ talent: t, sphere: bk.cell(tab, r, W), source: bk.cell(tab, r, X) });
    }
  }

  const sphereBonuses = [];
  const rSs = labelRow(bk, tab, 26, 'Sphere');
  if (rSs) {
    for (let r = rSs + 1; r < rSs + 27; r++) {
      const s = bk.cell(tab, r, 26);
      if (s) {
        sphereBonuses.push({
          sphere: pystr(s),
          rankBonus: num(bk.cell(tab, r, 27)),
          dcBonus: num(bk.cell(tab, r, 28)),
          sheetValue: bk.cell(tab, r, 29),
        });
      }
    }
  }

  const skillRanks = [];
  for (let r = rBr + 1; r < rBr + 18; r++) {
    const s = bk.cell(tab, r, U);
    if (!s) continue;
    const enabled = bk.cell(tab, r, V);
    skillRanks.push({
      skill: pystr(s),
      enabled: enabled === null ? true : truthy(num(enabled, 0) || enabled === true),
      multiplier: num(bk.cell(tab, r, 25), 1) || 1,
      sheetCurrent: num(bk.cell(tab, r, W)),
      sheetMax: num(bk.cell(tab, r, X)),
    });
  }

  const vrow = (label, col = V, fallback = 0) => {
    const r = labelRow(bk, tab, U, label);
    return r ? num(bk.cell(tab, r, col)) : fallback;
  };

  const rDice = labelRow(bk, tab, U, 'Unarmed Strike dice');
  const rKn = labelRow(bk, tab, U, 'Talented Knuckle');
  const rSt = labelRow(bk, tab, U, 'Step Increases');
  const rSz = labelRow(bk, tab, U, 'Size Increases');
  const rUb = labelRow(bk, tab, U, 'Uses Boxing');
  const rUo = labelRow(bk, tab, U, 'Uses Open Hand');
  const other = [];
  for (const r of [rKn, rSt, rSz]) {
    if (!r) continue;
    for (const c of [W, X]) {
      const v = bk.cell(tab, r, c);
      if (typeof v === 'string' && v.trim()
          && !['Uses', 'Other', 'Unorth'].some((p) => v.trim().startsWith(p))) {
        other.push(v.trim());
      }
    }
  }

  const unarmed = {
    sheetDice: rDice ? bk.cell(tab, rDice, V) : null,
    talentedKnuckle: vrow('Talented Knuckle'),
    brawlersVest: vrow("Brawler's Vest"),
    stepIncreases: vrow('Step Increases'),
    sizeIncreases: vrow('Size Increases'),
    usesBoxing: rUb ? truthy(num(bk.cell(tab, rUb, V), 1)) : true,
    usesBrute: rUb ? truthy(num(bk.cell(tab, rUb, X), 1)) : true,
    usesOpenHand: rUo ? truthy(num(bk.cell(tab, rUo, V), 1)) : true,
    usesWrestling: rUo ? truthy(num(bk.cell(tab, rUo, X), 1)) : true,
    otherSpheres: other,
    veilEssence: bk.has('Akashic') ? num(bk.cell('Akashic', 35, 21)) : 0,
  };

  const rDc = labelRow(bk, tab, 28, 'DC Base');
  return {
    classes: trainingClasses(bk, tab),
    tradition,
    bonusTalents: bonus,
    sphereBonuses,
    skillRanks,
    unarmed,
    sheetBaseDC: rDc ? num(bk.cell(tab, rDc, 29)) : 0,
  };
}

function extractMagicTraining(bk) {
  const tab = 'Magic Training';
  if (!bk.has(tab)) return null;
  const U = 21, V = 22, W = 23;

  // Drawbacks fill every row between the Tradition header and the Boons line —
  // templates differ in how many rows that is. Bought-off drawbacks follow,
  // under a "Drawback Feats" heading in newer revisions.
  const rTrad = labelRow(bk, tab, U, 'Tradition /') ?? 2;
  const rBoons = labelRow(bk, tab, U, 'Boons:') ?? (rTrad + 6);
  const drawbacks = gridTexts(bk, tab, rTrad + 1, rBoons - 1, U, W);

  const rowsUntilBlank = (r1, r2) => {
    const out = [];
    for (let r = r1; r <= r2; r++) {
      const texts = [];
      for (let c = U; c <= W; c++) {
        const t = bk.cell(tab, r, c);
        if (typeof t === 'string' && t.trim()) texts.push(t.trim());
      }
      if (!texts.length || texts.some((t) => t.startsWith('Casting Bonus'))) break;
      out.push(...texts);
    }
    return out;
  };

  const rFeats = labelRow(bk, tab, U, 'Drawback Feats', rBoons);
  let boughtOff = rFeats
    ? rowsUntilBlank(rFeats + 1, rFeats + 5)
    : rowsUntilBlank(rBoons + 1, rBoons + 5);
  boughtOff = boughtOff.filter((b) => !b.startsWith('Drawback Feats'));

  const bonus = [];
  const rBt = labelRow(bk, tab, U, 'Casting Bonus Spheres');
  if (rBt) {
    for (let r = rBt + 1; r < rBt + 5; r++) {
      const t = bk.cell(tab, r, U);
      if (t) bonus.push({ talent: t, sphere: bk.cell(tab, r, W) });
    }
  }

  const sphereBonuses = [];
  const rSs = labelRow(bk, tab, 25, 'Sphere');   // Y column header
  if (rSs) {
    for (let r = rSs + 1; r < rSs + 27; r++) {
      const s = bk.cell(tab, r, 25);
      if (s) {
        sphereBonuses.push({
          sphere: pystr(s),
          clBonus: num(bk.cell(tab, r, 26)),
          dcBonus: num(bk.cell(tab, r, 27)),
          sheetValue: bk.cell(tab, r, 28),
        });
      }
    }
  }

  /** [bonusValue, sheetTotal] for a Base X / Bonus X / Total X block. */
  const block = (label) => {
    const r = labelRow(bk, tab, U, label);
    if (!r) return [0, 0];
    return [num(bk.cell(tab, r + 1, V)), num(bk.cell(tab, r + 1, W))];
  };

  const [dcBonus, dcTotal] = block('Base Global DC');
  const [clBonus, clTotal] = block('Global Caster Level');
  const [msbBonus, msbTotal] = block('Base MSB');
  const [msdBonus, msdTotal] = block('Base MSD');

  const atLabel = (label, col = V) => {
    const r = labelRow(bk, tab, U, label);
    return r ? num(bk.cell(tab, r, col)) : 0;
  };

  const rAmt = labelRow(bk, tab, U, 'AMT');
  const rMamt = labelRow(bk, tab, U, 'Mythic AMT');
  const rSp1 = labelRow(bk, tab, U, 'Class 1 SP');

  const classSP = [];
  if (rSp1) for (let i = 0; i < 6; i++) classSP.push(num(bk.cell(tab, rSp1 + i, V)));

  return {
    classes: trainingClasses(bk, tab),
    sphereBonuses,
    tradition: {
      name: bk.cell(tab, rTrad, V),
      drawbacks,
      boughtOff,
    },
    bonusTalents: bonus,
    amt: rAmt ? truthy(bk.cell(tab, rAmt, V)) : false,
    mythicAmt: rMamt ? truthy(bk.cell(tab, rMamt, V)) : false,
    dcBonus,
    clBonus,
    msbBonus,
    msdBonus,
    bonusSP: atLabel('Bonus SP'),
    sheet: {
      boons: rBoons ? num(bk.cell(tab, rBoons, V)) : 0,
      spTier: rBoons ? num(bk.cell(tab, rBoons, W)) : 0,
      totalDC: dcTotal,
      totalCL: clTotal,
      totalMSB: msbTotal,
      totalMSD: msdTotal,
      traditionSP: atLabel('Tradition SP'),
      totalSP: atLabel('Total SP'),
      classSP,
    },
  };
}

/** Fallback: keep a tab's non-empty cells so nothing is lost in conversion. */
function extractGeneric(bk, tab) {
  const g = bk.grids.get(tab);
  if (!g) return null;
  const rows = [];
  g.forEach((r, i) => {
    const rr = stripRow(r);
    if (rr.some((v) => v !== null)) rows.push({ r: i + 1, cells: rr });
  });
  return { rows };
}

/* ---------------------------------------------------------------------- *
 * Assembly
 * ---------------------------------------------------------------------- */

function build(bk, key, title, fileId, convertedAt) {
  const [traits, raceTraits] = extractTraits(bk);

  const tabs = bk.tabs();
  const extra = {};
  for (const [name, state] of tabs) {
    if ((REF_TABS.has(name) && !CAPTURED_REF_TABS.has(name)) || STRUCTURED_TABS.has(name)) continue;
    if (name === 'Character Info') continue;
    const gen = extractGeneric(bk, name);
    if (gen && gen.rows.length) extra[name] = { hidden: state !== 'visible', ...gen };
  }

  return {
    // Bump whenever the shape changes: the app discards saved local edits whose
    // schemaVersion does not match, rather than silently loading a document that
    // is missing newly added sections.
    schemaVersion: SCHEMA_VERSION,
    id: key,
    source: {
      title,
      fileId,
      url: fileId ? `https://docs.google.com/spreadsheets/d/${fileId}/edit` : '',
      convertedAt,
    },
    tabs: tabs.map(([n, s]) => ({ name: n, hidden: s !== 'visible' })),
    identity: extractIdentity(bk),
    abilities: extractAbilities(bk),
    statsBuild: extractStatsBuild(bk),
    pointBuyTable: extractPointBuyTable(bk),
    progressionPicks: extractProgressionPicks(bk),
    hp: extractHp(bk),
    classes: extractClasses(bk),
    defenses: extractDefenses(bk),
    conditions: extractConditions(bk),
    attack: extractAttack(bk),
    saves: extractSaves(bk),
    traits,
    raceTraits,
    skills: extractSkills(bk),
    skillBudget: extractSkillBudget(bk),
    carry: extractCarry(bk),
    resources: extractResources(bk),
    wealth: extractWealth(bk),
    planner: extractPlanner(bk),
    feats: extractFeats(bk),
    mythic: extractMythic(bk),
    equipment: extractEquipment(bk),
    background: extractBackground(bk),
    training: {
      combat: extractCombatTraining(bk),
      magic: extractMagicTraining(bk),
    },
    named: bk.named(),
    extraTabs: extra,
  };
}

/**
 * Convert workbook bytes into a character document.
 *
 * @param {Uint8Array|ArrayBuffer} bytes  the raw .xlsx
 * @param {object} [options]
 * @param {string} [options.id]         character id and filename stem
 * @param {string} [options.title]      source sheet title recorded in the document
 * @param {string} [options.fileId]     Google Sheets file id, to record a link back
 * @param {string} [options.convertedAt] ISO timestamp; defaults to now
 */
export async function convertWorkbook(bytes, options = {}) {
  const bk = new Book(await readWorkbook(bytes));
  const key = options.id || 'character';
  const title = options.title ?? key;
  const fileId = options.fileId ?? '';
  const convertedAt = options.convertedAt
    ?? new Date().toISOString().slice(0, 19);
  return build(bk, key, title, fileId, convertedAt);
}

/**
 * A character from nothing: the document a workbook with no tabs would
 * convert to, with a name and a level filled in.
 *
 * This is the same path an off-template workbook takes -- every extractor
 * returns its empty structure -- so a blank character is not a second shape
 * for the model to know about; it is the thinnest converted document there
 * is, and everything the model fills in on load (the six abilities, the
 * skill list, the companions, the trackers) is filled in here too.
 *
 * @param {object} [options]
 * @param {string} [options.name]       the character's name (default "New Character")
 * @param {string} [options.id]         document id (default: the name, slugified)
 * @param {number} [options.level]      starting level (default 3, the campaign's floor)
 * @param {string} [options.player]     player name
 * @param {string} [options.createdAt]  ISO timestamp; defaults to now
 */
export const BLANK_MIN_LEVEL = 3;
export const BLANK_HP_PER_LEVEL = 6;

export function blankDocument(options = {}) {
  const name = String(options.name || '').trim() || 'New Character';
  const key = options.id || slug(name) || 'character';
  const createdAt = options.createdAt ?? new Date().toISOString().slice(0, 19);
  // Every structured tab present and empty, so each extractor returns the
  // empty structure it would for a template with nothing typed in, rather than
  // the null it returns for a tab that is not there at all.
  const sheets = [...STRUCTURED_TABS, 'Character Info', 'dataSheet']
    .map((tabName) => ({ name: tabName, state: 'visible', grid: [] }));
  const bk = new Book({ sheets, definedNames: [] });
  const doc = build(bk, key, name, '', createdAt);
  doc.source = { ...doc.source, title: name, kind: 'blank' };
  doc.identity = {
    ...doc.identity,
    name,
    player: String(options.player || ''),
    // Characters start no lower than 3rd in this campaign.
    level: Math.max(BLANK_MIN_LEVEL, Math.min(20, Math.floor(Number(options.level) || BLANK_MIN_LEVEL))),
    size: doc.identity.size || 'Medium',
    heroPoints: { current: 1, max: 3 },
    // Two perk slots, to be filled.
    specialtyPerks: ['', ''],
  };
  // A simple starting maximum -- 6 a level -- so the sheet is not standing at
  // 0; the player sets the real number once the classes are in.
  const level = doc.identity.level;

  // What the template itself starts with: 10 in every score, bought at 10 on
  // the standard point-buy table; the usual ability behind each number.
  for (const ab of ABILITIES) {
    const key = ab.toLowerCase();
    doc.abilities[key] = { ...doc.abilities[key], score: 10, mod: 0, tempScore: 10, totalMod: 0, checkMod: 0 };
    doc.statsBuild[key] = { ...doc.statsBuild[key], pointBuy: 10, sheetTotal: 10 };
  }
  doc.pointBuyTable = { ...POINT_BUY_COST };
  doc.hp = { ...doc.hp, ability: 'Con', initAbility: 'Dex', total: level * BLANK_HP_PER_LEVEL };
  // Three race-trait slots to fill in.
  doc.raceTraits = [0, 1, 2].map(() => ({ name: '', text: '' }));
  doc.saves.fortitude.stat1 = 'Con';
  doc.saves.reflex.stat1 = 'Dex';
  doc.saves.will.stat1 = 'Wis';
  // The imported totals are what the model reconciles its offsets against, so
  // they must be what it will compute: 10, plus whatever the ABP ladder gives
  // at this level -- +1 resistance from 3rd, deflection and toughening later.
  const abp = abpDefence(level);
  doc.defenses = {
    ...doc.defenses,
    acStat1: 'Dex',
    ac: 10 + abp.abpDeflection + abp.abpNatural,
    touch: 10 + abp.abpDeflection,
    flatFooted: 10 + abp.abpDeflection + abp.abpNatural,
    cmd: 10,
    ffCmd: 10,
  };
  for (const key of ['fortitude', 'reflex', 'will']) doc.saves[key].total = abp.abpResistance;
  for (const [mode, stat] of [['melee', 'Str'], ['altMelee', 'Dex'], ['ranged', 'Dex'], ['altRanged', 'Str'], ['cmb', 'Str']]) {
    if (doc.attack.modes[mode]) doc.attack.modes[mode].stat1 = stat;
  }
  // The template's skill list, every row untouched.
  doc.skills = STANDARD_SKILLS.map((s) => ({
    name: s.name,
    spec: null,
    bonus: 0,
    classSkill: false,
    totalRanks: 0,
    ranks: {},
    requiresTraining: s.trained,
    armorPenalty: s.acp,
    abilities: [s.ability],
    situational: null,
  }));
  doc.background = Object.fromEntries([...BACKGROUND_LABELS].map((label) => [label, null]));
  return doc;
}

/** The row index.json carries for a character: what the picker needs. */
export function indexEntry(key, doc) {
  const ident = doc.identity;
  return {
    id: key,
    name: ident.name,
    race: ident.race,
    level: ident.level,
    classes: doc.classes.map((c) => c.name),
    image: ident.image,
    file: `${key}.json`,
  };
}

/**
 * Flag the things a sheet off the template is likely to be missing.
 *
 * The extractors return empty structures rather than failing, so a workbook that
 * is not the campaign template converts to a thin document instead of an error.
 * These lines are what tells you that happened.
 */
export function warningsFor(doc) {
  const out = [];
  const ident = doc.identity;
  if (!ident.name) out.push('no character name found (Character Info tab missing or renamed?)');
  if (!ident.level) out.push('no character level found');
  if (!doc.skills.length) out.push('no skills table found');
  if (!doc.classes.length) out.push('no classes found');
  if (!Object.keys(doc.named).length) {
    out.push('no defined names - this does not look like the campaign template');
  }
  if (!doc.planner.some((r) => r.Level)) {
    out.push('Planner is empty, so the Progression tab will start blank');
  }
  return out;
}
