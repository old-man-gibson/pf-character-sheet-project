/**
 * Vancian casting: spell slots, preparation, and spells known.
 *
 * The slot tables are an extension pack keyed by class name; bonus slots from
 * a high casting ability are added on top, and the block order the workbook
 * uses is preserved so an imported spell list stays where its owner put it.
 */

import {
  CASTING_SOURCE_KEYS, PREP_STYLE_KEYS, SPELL_LEVELS, bonusSpellSlots, castableAt, castingNoun,
  prepStyle, spellDC, statMod, statScore,
} from '../../rules.js';
import { sheetReader } from '../document.js';
import { closestName } from '../util.js';

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

export const VANCIAN_DERIVED = [
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
export function importVancian(tab, identity = {}) {
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
export function mergeVancian(parts) {
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
export function recomputeVancian(model) {
  const v = model.data.vancian;
  if (!v) return;

  for (const c of v.classes || []) {
    const style = prepStyle(c.prep);
    const mod = statMod(model.data, c.stat, c.stat2);
    const score = statScore(model.data, c.stat, c.stat2);
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
    const fromProgression = model.classLevelCount(c.name || c.slotType);
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
export function vancianNewDay(model) {
  const v = model.data.vancian;
  if (!v) return model;
  for (const c of v.classes || []) for (const s of c.spells || []) s.used = 0;
  for (const p of v.prepared || []) p.used = 0;
  return model.recompute();
}
