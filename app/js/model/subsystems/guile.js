/**
 * Spheres of Guile: the third training side.
 *
 * It reads like the other two -- classes with a talent per so many levels,
 * talents from elsewhere, a tradition, a table of spheres -- and underneath
 * it is built the other way round. Spheres of Power hangs everything off a
 * caster level and Spheres of Might off a practitioner level; a skill sphere
 * has neither. Every number an operative's sphere produces is read off her
 * *ranks in that sphere's associated skill*, and those ranks are themselves
 * paid out by the talents she spent in it. So the tab's central table is not
 * a second Sphere CL / DC: it is the sphere table and the bonus-skill-ranks
 * block fused, because in this system they are one fact seen twice.
 *
 * That circle -- talents grant ranks, ranks set the DC -- is why the pass is
 * split in two. `recomputeGuile` runs before the skills loop and works out
 * what each sphere is owed; `recomputeGuileSpheres` runs after it, once the
 * skill rows know their real totals, and reads the DCs and ranges off them.
 * It is the same two-step the martial side already needs for Alchemy and
 * Beastmastery, which key off Craft and Handle Animal rather than off BAB.
 *
 * Four more idiosyncrasies the other two sides have no place for:
 *
 *   - Two talent ladders at once. A tier of skill expertise grants
 *     unrestricted talents *and* [utility] talents, on different rungs, so a
 *     class's level table has two slots per row rather than one.
 *   - The associated skill is a choice, not a lookup. Where the martial side
 *     knows that Fencing pays Acrobatics, a skill sphere names a family
 *     ("a single Knowledge or Lore skill") and the operative picks a member
 *     of it once. Several spheres are further divided into packages, and it
 *     is the package that carries the skill.
 *   - Two spheres that land on the same skill do not stack their ranks. The
 *     second one pays a competence bonus of half the character's level
 *     instead -- and the same is true against a combat sphere reaching that
 *     skill, which is the rule the Spheres Variants section adds.
 *   - Skill leverage and plans are pools sized off Hit Dice and off how many
 *     [plan] talents the character has. The tags come from the sphere
 *     catalogue when a pack has been loaded, so the count is worked out
 *     rather than typed -- and there is a field to type it in when no pack
 *     is there to answer.
 */

import {
  EXPERTISE_TIERS, GUILE_SPHERES, OPERATIVE_ABILITIES, RANKS_PER_TALENT, TRADE_RANKS,
  expertiseTalents, guilePackages, guileRanges, leveragePool, skillLabel, statMod,
} from '../../rules.js';
import { plannerHasClass } from '../progression.js';
import { sphereTalent } from '../spheres.js';
import { amountOrText, evaluateAmount } from '../util.js';

/** Twenty rows, one per character level, the way both other sides are built. */
const blankLevels = () => Array.from({ length: 20 }, (_, i) => ({
  level: i + 1,
  talent: null, sphere: null, notes: null,
  utilityTalent: null, utilitySphere: null, utilityNotes: null,
}));

/** A class block with nothing typed into it. */
export function blankGuileClass(name = '') {
  return {
    name, expertise: null, classLevelsOverride: null, levels: blankLevels(),
  };
}

/** The guile side of a character who has never opened the tab. */
export function blankGuileTraining() {
  return {
    classes: [],
    bonusTalents: [],
    tradition: { name: '', rank: null, entries: [] },
    operativeMod: null,
    spheres: [],
    leverageBonus: 0,
    leverageDaily: false,
    leverageSkills: [],
    planBonus: 0,
    utilityPlanBonus: 0,
  };
}

const str = (v) => (v == null ? null : String(v));
const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
const oneOf = (v, list) => (list.includes(String(v || '').trim()) ? String(v).trim() : null);

/**
 * Fill in anything a saved document is missing, and drop nothing it has.
 *
 * Written to be safe on a block that predates any field here, because that
 * is what every character on the roster is: none of the five workbooks has a
 * guile tab, so the side is conjured empty the first time a sheet is loaded
 * and only ever grows from what a player types.
 */
export function normalizeGuileTraining(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const base = blankGuileTraining();
  const out = { ...base, ...g };

  out.classes = (Array.isArray(g.classes) ? g.classes : []).map((c) => {
    const cls = { ...blankGuileClass(), ...(c && typeof c === 'object' ? c : {}) };
    cls.name = String(cls.name || '');
    cls.expertise = oneOf(cls.expertise, EXPERTISE_TIERS);
    cls.classLevelsOverride = cls.classLevelsOverride == null ? null : int(cls.classLevelsOverride);
    const rows = Array.isArray(cls.levels) ? cls.levels : [];
    cls.levels = blankLevels().map((blank, i) => ({ ...blank, ...(rows[i] || {}), level: i + 1 }));
    return cls;
  });

  out.bonusTalents = (Array.isArray(g.bonusTalents) ? g.bonusTalents : []).map((b) => ({
    talent: str(b?.talent) ?? '', sphere: str(b?.sphere), source: str(b?.source) ?? '',
    notes: str(b?.notes) ?? '',
    utility: !!b?.utility,
    // A talent handed over by a base sphere or a drawback is not a talent
    // *spent*, so it buys no skill ranks. The rulebook is explicit about it
    // and the distinction is invisible from the name, so it is a tick.
    free: !!b?.free,
  }));

  const tr = g.tradition && typeof g.tradition === 'object' ? g.tradition : {};
  out.tradition = {
    name: String(tr.name || ''),
    rank: oneOf(tr.rank, TRADE_RANKS),
    entries: (Array.isArray(tr.entries) ? tr.entries : []).map((e) => ({
      talent: str(e?.talent) ?? '', sphere: str(e?.sphere),
      // Three of a tradition's talents come to everybody; the other three
      // wait on adroit rank. The tick is which kind this row is.
      adroit: !!e?.adroit,
    })),
  };

  out.operativeMod = oneOf(out.operativeMod, OPERATIVE_ABILITIES);
  out.spheres = (Array.isArray(g.spheres) ? g.spheres : []).map((s) => ({
    sphere: String(s?.sphere || ''),
    package: str(s?.package) ?? '',
    skill: str(s?.skill) ?? '',
    // A number, or a rule kept as the text it was written in.
    rankBonus: amountOrText(s?.rankBonus),
    dcBonus: amountOrText(s?.dcBonus),
  })).filter((s) => s.sphere);

  out.leverageBonus = Number(out.leverageBonus) || 0;
  out.leverageDaily = !!out.leverageDaily;
  out.leverageSkills = (Array.isArray(out.leverageSkills) ? out.leverageSkills : []).map(String);
  out.planBonus = Number(out.planBonus) || 0;
  out.utilityPlanBonus = Number(out.utilityPlanBonus) || 0;
  return out;
}

/**
 * Everything on the guile side that the model works out, so a saved sheet
 * carries only what somebody typed.
 *
 * Both other training sides do save their tallies and their granted flags,
 * which is an accident of their age rather than a decision -- this one is
 * new, so it does it the way the modelled sub-systems do.
 */
export const GUILE_DERIVED = [
  'tally', 'tallySpent', 'sphereRows', 'plans', 'leverage', 'operativeAbilityMod',
  { path: 'classes', keys: ['side', 'classLevels', 'classLevelsCurrent', 'totalTalents', 'totalUtility'] },
  { path: 'classes', list: 'levels', keys: ['count', 'utilityCount', 'granted', 'utilityGranted', 'future'] },
  {
    path: 'spheres',
    keys: ['skillIndex', 'talents', 'ranksGranted', 'paysRanks', 'duplicate', 'competence',
      'rankBonusNum', 'rankBonusError'],
  },
];

/* ------------------------------------------------------------------ *
 * Counting what was learned
 * ------------------------------------------------------------------ */

/**
 * Every talent the guile side holds, once each, as a flat list.
 *
 * `spent` is the half of it that counts toward a sphere's skill ranks: a
 * class ladder's picks, the tradition's, and any bonus talent not ticked
 * *free*. `free` rows are the ones a base sphere or a drawback handed over,
 * which the rulebook says are not talents spent.
 */
export function guileTalentRows(side) {
  const out = [];
  (side?.classes || []).forEach((cls, ci) => {
    (cls.levels || []).forEach((lv, li) => {
      if (lv.granted) {
        out.push({ talent: lv.talent, sphere: lv.sphere, utility: false, spent: true, from: `class:${ci}:${li}` });
      }
      if (lv.utilityGranted) {
        out.push({ talent: lv.utilityTalent, sphere: lv.utilitySphere, utility: true, spent: true, from: `class:${ci}:${li}:u` });
      }
    });
  });
  (side?.bonusTalents || []).forEach((b, bi) => {
    out.push({ talent: b.talent, sphere: b.sphere, utility: !!b.utility, spent: !b.free, from: `bonus:${bi}` });
  });
  (side?.tradition?.entries || []).forEach((e, ei) => {
    out.push({ talent: e.talent, sphere: e.sphere, utility: false, spent: true, from: `tradition:${ei}` });
  });
  return out;
}

/**
 * Talents per sphere. `spentOnly` counts the ones that buy skill ranks;
 * without it, everything the character knows.
 *
 * A row with a sphere and no talent written in it still counts: the first
 * pick in a sphere *is* the sphere, and a player who has chosen where a
 * talent went before deciding which talent it was has still spent it.
 */
export function guileTally(side, { spentOnly = false } = {}) {
  const tally = {};
  for (const row of guileTalentRows(side)) {
    if (spentOnly && !row.spent) continue;
    const s = String(row.sphere || '').trim();
    if (s) tally[s] = (tally[s] || 0) + 1;
  }
  return tally;
}

/* ------------------------------------------------------------------ *
 * The pass before the skills loop
 * ------------------------------------------------------------------ */

/**
 * Class ladders, tallies, the sphere rows' rank entitlements, and the two
 * pools. Everything that does not need the skill totals, which do not exist
 * yet.
 */
export function recomputeGuile(model) {
  const g = model.data.training?.guile;
  if (!g) return;
  const c = model.data;
  const level = Number(c.identity.level) || 0;

  for (const cls of g.classes || []) {
    cls.side = 'guile';
    const tier = cls.expertise;
    const override = cls.classLevelsOverride == null ? null : Number(cls.classLevelsOverride);
    let classLevels = 0;
    let classLevelsCurrent = 0;
    for (const lv of cls.levels || []) {
      const has = override != null
        ? lv.level <= override
        : plannerHasClass(model, cls.name, lv.level);
      // The rung reached before this class level and after it: a slot is
      // granted where the two differ, which is how a table printed as
      // running totals says "and here is another one".
      const before = expertiseTalents(tier, classLevels);
      if (has) {
        classLevels += 1;
        if (lv.level <= level) classLevelsCurrent += 1;
      }
      const now = expertiseTalents(tier, classLevels);
      lv.count = now.any;
      lv.utilityCount = now.utility;
      lv.granted = now.any > before.any;
      lv.utilityGranted = now.utility > before.utility;
      lv.future = lv.level > level;
    }
    cls.classLevels = classLevels;
    cls.classLevelsCurrent = classLevelsCurrent;
    const total = expertiseTalents(tier, classLevels);
    cls.totalTalents = total.any;
    cls.totalUtility = total.utility;
  }

  g.tally = guileTally(g);
  g.tallySpent = guileTally(g, { spentOnly: true });

  // A sphere is on the table because a talent went into it, or because the
  // player put it there to choose its skill before spending anything. Rows
  // keep the order they were added in so the selects under them do not move
  // about; spheres that arrived by talent are appended in catalogue order.
  const rows = g.spheres || [];
  const have = new Set(rows.map((r) => r.sphere.trim().toLowerCase()));
  const seen = Object.keys(g.tally)
    .sort((a, b) => GUILE_SPHERES.indexOf(a) - GUILE_SPHERES.indexOf(b));
  for (const sphere of seen) {
    if (have.has(sphere.trim().toLowerCase())) continue;
    rows.push({ sphere, package: '', skill: '', rankBonus: 0, dcBonus: 0 });
    have.add(sphere.trim().toLowerCase());
  }
  g.spheres = rows;

  // A package the sphere does not have (the player changed the sphere on the
  // row) would silently pick the wrong associated skill, so it is cleared.
  for (const row of g.spheres) {
    const packages = guilePackages(row.sphere);
    if (row.package && !packages.includes(row.package)) row.package = '';
  }

  g.operativeAbilityMod = g.operativeMod ? statMod(c, g.operativeMod, null) : 0;
  recomputeGuilePools(model, g, level);
}

/**
 * Skill leverage and plans.
 *
 * Both are counted off the talents rather than typed, using the tags the
 * sphere catalogue carries -- `[plan]`, `[utility]`. With no pack loaded the
 * catalogue knows nothing and every count is zero, which is what the two
 * "extra" fields beside them are for.
 */
function recomputeGuilePools(model, g, level) {
  let plan = 0;
  let utilityPlan = 0;
  const unnamedPlans = [];
  for (const row of guileTalentRows(g)) {
    const hit = sphereTalent(row.sphere, row.talent);
    if (!hit) {
      if (String(row.talent || '').trim()) unnamedPlans.push(row.talent);
      continue;
    }
    const tags = hit.tags.map((t) => String(t).toLowerCase());
    if (!tags.includes('plan')) continue;
    if (tags.includes('utility')) utilityPlan += 1;
    else plan += 1;
  }
  const extraPlan = Number(g.planBonus) || 0;
  const extraUtility = Number(g.utilityPlanBonus) || 0;
  const planTalents = plan + extraPlan;
  const utilityPlanTalents = utilityPlan + extraUtility;
  g.plans = {
    talents: planTalents,
    utilityTalents: utilityPlanTalents,
    // "1 + the number of plan talents you have without the [utility] tag",
    // and only for a character who has any plan talent at all.
    pool: planTalents || utilityPlanTalents ? 1 + planTalents : 0,
    utilityPool: utilityPlanTalents,
    counted: plan + utilityPlan,
    unknown: unnamedPlans.length,
  };

  // Every skill sphere unlocks leverage except Vocation, which has no base
  // ability to unlock it with.
  const unlocking = Object.keys(g.tally || {}).filter((s) => s !== 'Vocation');
  g.leverage = {
    unlocked: unlocking.length > 0,
    spheres: unlocking,
    // The daily-pool variant: the same pool, plus half a day's encounters,
    // which the book puts at 2 for a traditional four-encounter day.
    base: unlocking.length ? leveragePool(level) : 0,
    daily: !!g.leverageDaily,
    bonus: Number(g.leverageBonus) || 0,
  };
  g.leverage.pool = g.leverage.base
    ? g.leverage.base + g.leverage.bonus + (g.leverage.daily ? DAILY_LEVERAGE_EXTRA : 0)
    : 0;
}

/** The daily-pool variant's suggested top-up: half a four-encounter day. */
export const DAILY_LEVERAGE_EXTRA = 2;

/* ------------------------------------------------------------------ *
 * Ranks into the skills
 * ------------------------------------------------------------------ */

/**
 * Where each sphere's associated skill sits in the character's skill list.
 * The pick is stored as the label the Skills tab shows -- "Craft (alchemy)",
 * "Perform (dance)" -- because that is the only name a player recognises and
 * the only one that survives a row being added above it.
 */
function skillIndexOf(model, label) {
  const want = String(label || '').trim().toLowerCase();
  if (!want) return -1;
  return (model.data.skills || []).findIndex(
    (s) => skillLabel(s.name, s.spec).trim().toLowerCase() === want,
  );
}

/**
 * The ranks a guile sphere pays into its associated skill, and the
 * competence bonus paid instead where two of them land on the same one.
 *
 * Returns `{ranks, competence}`, both keyed by the skill's index in the
 * character's list. `combatRanks` is the martial side's map, already worked
 * out, because the Spheres Variants section extends the no-stacking rule
 * across the two systems: a skill a combat sphere already fills gets the
 * competence bonus from a guile sphere rather than a second helping of
 * ranks, and that takes precedence over the combat sphere's own half-BAB
 * rule.
 */
export function guileRanksBySkill(model, combatRanks = new Map()) {
  const ranks = new Map();
  const competence = new Map();
  const g = model.data.training?.guile;
  if (!g) return { ranks, competence };
  const level = Number(model.data.identity.level) || 0;
  const tally = g.tallySpent || g.tally || {};

  // Rank+ may be a rule rather than a number. This runs before the prose is
  // read -- the ranks it grants feed the skills, which feed everything -- so
  // a rule here reads abilities, level and class levels, and a name defined
  // in prose only as the last pass left it. The scope is built once, and
  // only if a row asks for it.
  let scope = null;
  const amount = (raw) => {
    if (typeof raw === 'string' && raw.trim() !== '') scope ??= model.scope();
    return evaluateAmount(raw, scope);
  };

  // What each row is owed, before any of them find out they are sharing.
  const byIndex = new Map();
  for (const row of g.spheres || []) {
    const talents = Number(tally[row.sphere]) || 0;
    const i = skillIndexOf(model, row.skill);
    const rank = amount(row.rankBonus);
    row.skillIndex = i;
    row.talents = talents;
    row.rankBonusNum = rank.value;
    row.rankBonusError = rank.error;
    row.ranksGranted = i < 0 || !talents
      ? 0
      : Math.min(level, talents * RANKS_PER_TALENT + rank.value);
    row.paysRanks = false;
    row.duplicate = false;
    row.competence = 0;
    if (i < 0 || !talents) continue;
    if (!byIndex.has(i)) byIndex.set(i, []);
    byIndex.get(i).push(row);
  }

  // One payer per skill. Whichever sphere is owed the most fills the row --
  // it makes no difference to the total, and a reader has to be able to see
  // *a* sphere paying rather than a table of struck-out numbers with the
  // ranks arriving from nowhere.
  for (const [i, rows] of byIndex) {
    const fromCombat = Number(combatRanks.get(i)) || 0;
    const best = rows.reduce((a, b) => (b.ranksGranted > a.ranksGranted ? b : a));
    ranks.set(i, Math.max(best.ranksGranted, fromCombat));
    // "they do not gain more ranks than their usual maximum. Instead, they
    // gain a competence bonus ... equal to one-half their character level
    // (minimum +1)" -- one bonus for the overlap, however many spheres are
    // piled onto the skill, and the Spheres Variants section says a combat
    // sphere reaching the same skill counts as one of them.
    if (rows.length === 1 && !fromCombat) {
      best.paysRanks = true;
      continue;
    }
    const bonus = Math.max(1, Math.floor(level / 2));
    competence.set(i, bonus);
    for (const row of rows) row.duplicate = true;
    // The bonus is shown once, on whichever row is owed the most, so the
    // skill's whole story ("9 ranks and +4") is on one line and the others
    // read as what they are: spheres that share a skill already full. It
    // stays on that row even when a *combat* sphere is the one paying and no
    // guile row is, since the tab still has to say the bonus exists.
    best.competence = bonus;
    if (fromCombat <= best.ranksGranted) best.paysRanks = true;
  }
  return { ranks, competence };
}

/* ------------------------------------------------------------------ *
 * The pass after the skills loop
 * ------------------------------------------------------------------ */

/**
 * Save DCs and ranges, off the skill totals the loop has just settled.
 *
 * Ranks here are the row's *total* ranks, not the ones the sphere paid for:
 * the rulebook asks for "the operative's ranks in the sphere's associated
 * skill", and a character who bought more of them has them.
 */
export function recomputeGuileSpheres(model) {
  const g = model.data.training?.guile;
  if (!g) return;
  const mod = Number(g.operativeAbilityMod) || 0;
  const skills = model.data.skills || [];
  // DC+ may be a rule. Unlike Rank+ this runs after the prose, so a name
  // defined there resolves. The scope is built once, and only if asked for.
  let scope = null;
  const amount = (raw) => {
    if (typeof raw === 'string' && raw.trim() !== '') scope ??= model.scope();
    return evaluateAmount(raw, scope);
  };
  g.sphereRows = (g.spheres || []).map((row) => {
    const skill = row.skillIndex >= 0 ? skills[row.skillIndex] : null;
    const ranks = Number(skill?.totalRanks) || 0;
    const dcPlus = amount(row.dcBonus);
    return {
      ...row,
      ranks,
      dcBonusNum: dcPlus.value,
      dcBonusError: dcPlus.error,
      // No associated skill, no DC. Not zero ranks' worth of one: the whole
      // number is built on a skill this sphere has not been pointed at yet,
      // and a DC of 10 + the operative modifier is a number that would read
      // as real. Vocation never has one at all -- it has no base ability and
      // no skill of its own; its talents borrow whichever skill they name.
      dc: skill ? 10 + Math.floor(ranks / 2) + mod + dcPlus.value : null,
      ...guileRanges(ranks),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

/** Add a class block to the guile side. */
export function addGuileClass(model, name = '') {
  const g = model.data.training?.guile;
  if (!g) return model;
  g.classes = [...(g.classes || []), blankGuileClass(name)];
  model.recompute();
  return model;
}

/** Put a sphere on the table before any talent has been spent in it. */
export function addGuileSphere(model, sphere = '') {
  const g = model.data.training?.guile;
  if (!g) return model;
  const name = String(sphere || '').trim()
    || GUILE_SPHERES.find((s) => !(g.spheres || []).some((r) => r.sphere === s))
    || '';
  g.spheres = [...(g.spheres || []), { sphere: name, package: '', skill: '', rankBonus: 0, dcBonus: 0 }];
  model.recompute();
  return model;
}

/** Whether anything has been typed on the guile side. */
export function guileInUse(g) {
  if (!g) return false;
  return (g.classes || []).some((c) => c?.name)
    || !!g.tradition?.name
    || (g.bonusTalents || []).some((b) => String(b?.talent || '').trim())
    || (g.spheres || []).some((s) => s?.skill || s?.package)
    || !!g.operativeMod;
}
