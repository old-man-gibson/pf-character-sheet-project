/**
 * Psionics: power points, the manifester curves, and the powers known.
 *
 * Power points come from a curve keyed on the class total rather than a
 * per-class formula, so the tables are loaded from an extension pack and
 * looked up.
 */

import { abilityKey, statMod } from '../../rules.js';
import { sheetReader } from '../document.js';
import { forwarded } from '../scope.js';
import { closestName, manifesterForwardKey } from '../util.js';

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

/**
 * The curve reaching `total` at level 20. None chosen is no curve at all, not
 * the curve that reaches 0: `Number(null)` is 0, and that used to hand a class
 * nobody had set up the non-manifesting curve and its ability share with it.
 */
export function psionicCurve(total) {
  if (total === null || total === undefined || String(total).trim() === '') return null;
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

export const PSIONIC_DERIVED = [
  'calc',
  // The whole Power Points panel was formulas; only the bonus line was typed.
  'pool', 'left', 'spentNow',
  {
    path: 'classes',
    keys: ['plannerLevel', 'manifesterLevel', 'manifesterLevelBase', 'manifesterLevelForwarded',
      'manifesterLevelWaiting', 'levelClass', 'curveKnown', 'basePoints',
      'abilityPoints', 'points', 'powerCount'],
  },
];

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
export function importPsionics(tab, identity = {}) {
  const g = sheetReader(tab);
  const { at, text, num, mark, rightOf } = g;

  // A column of the literal integers 1..60 under a "Power Known" heading: the
  // power list's row numbers. The heading is claimed first so it does not
  // disqualify the run beneath it.
  for (const [ri, ci] of g.findAll('Power Known')) mark(ri, ci);
  g.dropCounterColumns();

  // The technique panel the sheet parked on this tab is template furniture.
  g.skipTechniquePanel(identity.primordiaTechnique);

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
export function recomputePsionics(model) {
  const p = model.data.psionics;
  if (!p) return;

  const oneStat = (name) => (String(name || '').trim() ? statMod(model.data, name, '') : 0);
  let pool = 0;

  for (const c of p.classes || []) {
    // Manifester level is levels of the class, counted off the Planner the way
    // the sheet's COUNTIF did, unless a block pins it.
    c.levelClass = model.blockClassName(c.name);
    const fromProgression = model.classLevelCount(c.levelClass);
    const pinned = c.manifesterLevelOverride;
    const level = Math.max(0, Math.min(20,
      pinned === null || pinned === undefined
        ? fromProgression : Math.floor(Number(pinned) || 0)));
    c.plannerLevel = fromProgression;
    // A bonus forwarded to `manifester.<class>.level` raises the manifester
    // level and not the power points below, which are keyed to levels of the
    // class; a rule that grants those forwards to `class.<slug>.level`.
    const key = manifesterForwardKey(c);
    c.manifesterLevelBase = level;
    c.manifesterLevelForwarded = key ? forwarded(model, key) : 0;
    // A class with no levels yet cannot manifest: the bonus waits for its
    // first level (`manifesterLevelWaiting`).
    c.manifesterLevelWaiting = level ? 0 : c.manifesterLevelForwarded;
    c.manifesterLevel = Math.max(0, level + (level ? c.manifesterLevelForwarded : 0));

    // A select writes its option as text; the curve is a number, and stays one.
    // Blank is no curve chosen, which is not the curve that reaches 0.
    if (c.curveTotal === undefined || String(c.curveTotal ?? '').trim() === '') c.curveTotal = null;
    else if (Number.isFinite(Number(c.curveTotal))) c.curveTotal = Number(c.curveTotal);
    // A published class carries its curve (publish.js), for a reader with no
    // manifesting pack; a pack that has the curve still wins.
    const cited = c.cited?.curve && Number(c.cited.curve.total) === c.curveTotal
      && Array.isArray(c.cited.curve.points) ? c.cited.curve : null;
    const curve = psionicCurve(c.curveTotal) || cited;
    const base = curve && level >= 1 && level <= curve.points.length ? curve.points[level - 1] : null;
    c.curveKnown = curve !== null;
    c.basePoints = base;
    // No curve, or no level on it, means the class manifests nothing at all --
    // so it earns no ability share either. The sheet gated the whole sum the
    // same way, and showing a share of points that are not in the pool would
    // only invite adding it up by hand and getting a different answer.
    // The same ability in both slots counts once, as `statMod` reads a slot
    // everywhere else: Int and Int is Int, not twice its bonus points.
    const same = abilityKey(c.stat) !== '' && abilityKey(c.stat) === abilityKey(c.stat2);
    c.abilityPoints = base === null ? 0
      : Math.floor((oneStat(c.stat) * level) / 2) + (same ? 0 : Math.floor((oneStat(c.stat2) * level) / 2));
    c.points = base === null ? 0 : Math.max(0, base + c.abilityPoints);
    c.powerCount = (c.powers || []).filter((x) => x.name).length;
    pool += c.points;
  }

  p.bonusPoints = Math.max(0, Math.floor(Number(p.bonusPoints) || 0));
  p.pool = pool + p.bonusPoints;
  // Points spent today. The player's, so it is kept as spent, and only what
  // is shown is held to the pool as it stands (`spentNow`, `left`). It used to
  // be cut down to fit, so a pool that shrank for a moment came back with the
  // difference unspent, and was saved that way.
  p.spent = Math.max(0, Math.floor(Number(p.spent) || 0));
  p.spentNow = Math.min(p.pool, p.spent);
  p.left = p.pool - p.spentNow;
  p.calc = {
    classes: (p.classes || []).length,
    powers: (p.classes || []).reduce((n, c) => n + (c.powerCount || 0), 0),
    unknownCurves: (p.classes || [])
      .filter((c) => c.curveTotal && !c.curveKnown).map((c) => c.curveTotal),
  };
}

/** A night's rest: the whole power-point pool comes back. */
export function psionicsNewDay(model) {
  if (!model.data.psionics) return model;
  model.data.psionics.spent = 0;
  return model.recompute();
}
