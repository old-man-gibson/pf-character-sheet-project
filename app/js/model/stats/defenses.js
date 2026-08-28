/**
 * What it takes to hurt the character: AC's typed bonuses, hit points, the
 * conditions that modify both, and the meters that display them.
 *
 * As with the saves, the AC/touch/flat-footed/CMD totals are formulas in
 * rules.js; the AC bonus cells resolve here. `conditionState` is the larger
 * half -- conditions do not simply add, they suppress each other, change size,
 * and reach attack, AC, CMB and CMD by different amounts.
 */

import {
  ABILITIES, AC_BONUS_TYPES, BUFF_MOD_KEYS, CONDITIONS, SIZE_MODIFIERS, abilityMod, abpDefence,
  armorParts, conditionCount, conditionInfo, conditionTotals, statMod, statModDelta,
} from '../../rules.js';
import { evaluateFormula } from '../../formula.js';
import {
  METERS, dyingFraction, isDefaultMeterStyle, meterDefaultStyle, normalizeStyle, resolveZones,
} from '../../tracker-style.js';
import { emit } from '../events.js';
import { forwarded, proseText } from '../scope.js';
import {
  applyForwarded, applyImmunities, formatDr, formatEnergy, formatImmunities,
  formatSpellResistance, parseDr, parseEnergy, parseImmunities, parseSpellResistance, unslug,
} from './defence-lists.js';
import { mythicHpPerTier } from '../progression.js';
import { resolveSaveBonuses } from './saves.js';
import { resolveBonusBlock } from '../util.js';

/**
 * Resolve the typed save and AC bonuses before anything reads them.
 *
 * A cell is a plain number or a formula in the tracker sandbox, which is what
 * lets a conditional bonus be written as the rule it actually is -- Force
 * Redirection's `min(str.mod - dex.mod, 3 + floor(bab / 2))` rather than a
 * number that silently goes stale the next time BAB moves. Resolved values
 * land beside the source so the compute stays a plain sum, and a bad formula
 * contributes nothing rather than breaking the sheet.
 *
 * The saves and the AC resolve the same way but live in different files, so
 * the one scope and the one ABP reading are taken here and handed to both.
 */
export function resolveDefenceBonuses(model) {
  // Ability modifiers and BAB are current by now; skills are not, and are
  // deliberately out of reach here -- a skill's own bonus can read AC.
  const scope = model.scope();
  // The three ABP defence bonuses follow the character's level along the
  // progression's own ladder; they are read, not typed.
  const abp = abpDefence(model.data.identity?.level);
  resolveSaveBonuses(model, scope, abp);
  resolveAcBonuses(model, scope, abp);
}

/** The AC's typed bonuses, ABP deflection and natural armour included. */
export function resolveAcBonuses(model, scope, abp) {
  const d = model.data.defenses;
  if (!d) return;
  if (d.acBonuses) {
    d.acBonuses.abpDeflection = abp.abpDeflection;
    d.acBonuses.abpNatural = abp.abpNatural;
  }
  d.acBonusErrors = {};
  d.acBonusesResolved = resolveBonusBlock(
    scope, d.acBonuses, AC_BONUS_TYPES, d.acBonusErrors,
  );
}

/**
 * The defence boxes that hold a sentence: spell resistance, damage reduction,
 * energy resistance, vulnerability, the immunities -- and the death
 * threshold, which is a number written the same way.
 *
 * Two things happen to each. Its {…} tokens are resolved, so "DR {= 5 +
 * floor(level/2)}/magic" is a rule rather than a number that goes stale; and
 * what it comes to is parsed into the parts it is made of, so a bonus
 * forwarded at `dr.magic` or `resistance.fire` has somewhere to land. See
 * stats/defence-lists.js for the parsing itself.
 *
 * Runs *after* the prose has been read, which is what tells it apart from
 * `resolveDefenceBonuses` above: these boxes are both a source of forwarded
 * bonuses and a destination for them, and a destination has to be worked out
 * once the bonuses are known.
 */
export function resolveDefenceText(model) {
  const c = model.data;
  const d = c.defenses;

  // The death threshold takes a formula, like the skills' Misc does: "Death's
  // Door" is a rule about Constitution, not a 3 typed in once and forgotten.
  const hp = c.hp;
  if (hp) {
    const raw = hp.deathBonus;
    hp.deathBonusError = null;
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        hp.deathBonusResolved = Math.trunc(Number(evaluateFormula(raw, model.scope())) || 0);
      } catch (err) {
        hp.deathBonusResolved = 0;
        hp.deathBonusError = err.message;
      }
    } else hp.deathBonusResolved = Number(raw) || 0;
  }

  if (!d) return;
  const totals = model.contributions?.totals || {};
  const at = (key) => Number(totals[key]) || 0;
  // Every part anything was aimed at, whether the box holds it or not -- the
  // list a granted resistance comes off.
  const aimedAt = (family) => Object.keys(totals)
    .filter((k) => k.startsWith(`${family}.`) && Number(totals[k]));
  const plain = (text) => proseText(model, text);

  const sr = parseSpellResistance(plain(d.spellResistance));
  const srBonus = at('defenses.sr');
  const drParts = applyForwarded(parseDr(plain(d.dr)), 'dr',
    at('defenses.dr'), at, aimedAt('dr'), (n) => (n === 'none' ? '—' : unslug(n)));
  const resParts = applyForwarded(parseEnergy(plain(d.resistance), 'resistance'), 'resistance',
    at('defenses.resistance'), at, aimedAt('resistance'), unslug);
  const weakParts = applyForwarded(parseEnergy(plain(d.weakness), 'weakness'), 'weakness',
    at('defenses.weakness'), at, aimedAt('weakness'), unslug);
  const immune = applyImmunities(parseImmunities(plain(d.immunities)), at, aimedAt('immune'));

  // The best of each, for the one-word answer a formula asking `dr` wants.
  const best = (parts) => parts.reduce((n, p) => Math.max(n, Number(p.amount) || 0), 0);

  d.calc = {
    sr: {
      base: sr.amount,
      bonus: srBonus,
      total: sr.amount + srBonus,
      has: sr.has || srBonus > 0,
      text: formatSpellResistance(sr, sr.amount + srBonus),
    },
    dr: drParts,
    resistance: resParts,
    weakness: weakParts,
    immunities: immune,
    drText: formatDr(drParts),
    resistanceText: formatEnergy(resParts),
    weaknessText: formatEnergy(weakParts),
    immunitiesText: formatImmunities(immune.filter((p) => !p.off)),
    drBest: best(drParts),
    resistanceBest: best(resParts),
    weaknessBest: best(weakParts),
  };
}

/**
 * The size the character is at right now: the base plus the largest ticked
 * true-size change, capped to the ladder. This is what a formula's `size`
 * reads. Stacking and effective rows do not move it -- they change what the
 * character counts as, not what it is (the wraps' own distinction).
 */
export function sizeNow(model) {
  const ladder = Object.keys(SIZE_MODIFIERS);
  let idx = ladder.indexOf(model.data.identity?.size);
  if (idx < 0) idx = ladder.indexOf('Medium');
  let up = 0;
  let down = 0;
  for (const b of model.data.buffs || []) {
    if (!b?.on) continue;
    for (const row of b.bonuses || []) {
      if (row?.target !== 'size') continue;
      const v = Number(row.valueNum ?? row.value) || 0;
      if (v > 0) up = Math.max(up, v);
      else down = Math.min(down, v);
    }
  }
  return ladder[Math.max(0, Math.min(ladder.length - 1, idx + up + down))];
}

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
export function conditionState(model) {
  const c = model.data;
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
   * Apply the size change once, capped to the ladder: nothing grows past
   * Colossal or shrinks past Fine, effective steps landing after true
   * ones -- and every consequence runs off the capped steps, modifiers and
   * dice alike, so a +500 written on a row still reads as Colossal.
   * (TODO: a campaign setting for tables that allow colossal+ sizes.)
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
  const trueSteps = clampSteps(baseIdx, sizeRows.size.up + sizeRows.size.down + sizeRows.stacking);
  const effSteps = clampSteps(baseIdx + trueSteps, sizeRows.sizeEffective.up + sizeRows.sizeEffective.down);
  const sizeSteps = trueSteps + effSteps;
  if (trueSteps) {
    buffsOn.push({
      name: 'Size',
      info: {
        key: 'buff:size',
        label: `${trueSteps > 0 ? `${trueSteps} size larger` : `${-trueSteps} size smaller`}`,
        mods: {
          attack: -trueSteps, ac: -trueSteps, cmb: 2 * trueSteps, cmd: trueSteps,
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
    // Every AC penalty among the ticked conditions and buffs reaches CMD too
    // (see conditionTotals' acPenalty), on top of whatever they say about CMD
    // outright -- so blinded is −2 to both, and a flat-footed character's
    // lost Dexterity comes off both.
    cmd: cmdDexDelta + mods.cmd + totals.acPenalty,
    // Flat-footed CMD has no Dexterity in it to lose, so it takes everything
    // else: what a condition says about CMD outright, and every AC penalty.
    ffCmd: mods.cmd + totals.acPenalty,
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
    ffCmd: c.defenses.ffCmd,
    fortitude: c.saves.fortitude.total,
    reflex: c.saves.reflex.total,
    will: c.saves.will.total,
    initiative: c.hp.initiative,
    hp: model.hpMax,
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
export function availableConditions(model) {
  const held = new Set(Object.keys(model.data.conditions || {})
    .map((name) => conditionInfo(name)?.key)
    .filter(Boolean));
  return CONDITIONS.filter((cond) => !held.has(cond.key));
}

/**
 * Current/temporary/nonlethal hit points.
 *
 * The source sheets only record a maximum, so play state is initialised to
 * full the first time it is needed and then tracked here.
 */
/**
 * Bonus hit points from mythic tiers (bonus HP/tier × tier).
 *
 * A component of `hp.base` rather than something added on top of it, since
 * the class table started working the whole maximum out; it stays a getter of
 * its own because the hit-points panel names it separately, and because a
 * sheet whose total is pinned still wants to say what the tiers were worth.
 */
export function mythicHp(model) {
  return (Number(model.data.identity?.mythicTier) || 0) * mythicHpPerTier(model.data);
}

/**
 * The maximum: the total the class table came to (or the one pinned over it),
 * and whatever a feature forwards here with `{hp.total += ...}`.
 *
 * One getter rather than the same sum written out at every place that needs
 * it -- the table, the companions' master block, the deck's lifebound cards,
 * the formula scope -- because they must never disagree about how many hit
 * points the character has.
 */
export function hpMax(model) {
  return (Number(model.data.hp?.total) || 0) + forwarded(model, 'hp.total');
}

/**
 * Temporary hit points a rule grants, and how much of that pool is gone.
 *
 * Kept apart from the box the player types in, for the reason every forwarded
 * bonus is kept apart from the column beside it: the box has to go on saying
 * what was written in it. A grant that shrinks takes its spending with it, so
 * a buff switched off cannot leave a debt behind.
 */
export function tempHpGrant(model) {
  const hp = model.data.hp || {};
  const granted = Math.max(0, forwarded(model, 'hp.temp'));
  const spent = Math.max(0, Math.min(granted, Number(hp.tempSpent) || 0));
  return { granted, spent, left: granted - spent };
}

export function hpState(model) {
  const hp = model.data.hp;
  const max = model.hpMax;
  if (hp.current === undefined || hp.current === null) hp.current = max;
  if (hp.temp === undefined || hp.temp === null) hp.temp = 0;
  if (hp.nonlethal === undefined || hp.nonlethal === null) hp.nonlethal = 0;
  const current = Number(hp.current) || 0;
  const typedTemp = Number(hp.temp) || 0;
  const grant = tempHpGrant(model);
  const temp = typedTemp + grant.left;
  const nonlethal = Number(hp.nonlethal) || 0;
  // Pathfinder: you fall unconscious at 0 and die at negative Con. Anything
  // that buys more room before that -- Death's Door, a mythic tier, a GM's
  // ruling -- is a bonus on the threshold rather than a different rule, so
  // it stays tied to Con and moves when Con does. The threshold takes a
  // formula and a forwarded bonus alike, so the rule that moves it can be
  // written where the rule is.
  const conScore = model.data.abilities.con?.tempScore ?? 10;
  const deathBonus = (Number(hp.deathBonusResolved ?? hp.deathBonus) || 0)
    + forwarded(model, 'hp.deathBonus');
  const deathAt = -(conScore + deathBonus);
  return {
    max,
    current,
    temp,
    typedTemp,
    tempGranted: grant.granted,
    tempGrantLeft: grant.left,
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

/**
 * Spend temporary hit points: the box the player typed first, then whatever
 * a rule granted. The typed box goes first because it is the one on screen,
 * and a character with nothing forwarded spends exactly as it always did.
 * Returns how many were actually there to spend.
 */
function spendTemp(model, want) {
  const hp = model.data.hp;
  const state = model.hpState;
  const n = Math.max(0, want);
  const fromTyped = Math.min(Math.max(0, state.typedTemp), n);
  hp.temp = state.typedTemp - fromTyped;
  const fromGrant = Math.min(state.tempGrantLeft, n - fromTyped);
  if (fromGrant > 0) hp.tempSpent = (Number(hp.tempSpent) || 0) + fromGrant;
  return fromTyped + fromGrant;
}

/** Apply damage, spending temporary hit points first. */
export function takeDamage(model, amount, { nonlethal = false } = {}) {
  const hp = model.data.hp;
  const state = model.hpState;
  let left = Math.max(0, Number(amount) || 0);
  if (nonlethal) {
    hp.nonlethal = state.nonlethal + left;
  } else {
    left -= spendTemp(model, left);
    hp.current = state.current - left;
  }
  model.recompute();
  return model;
}

export function healDamage(model, amount) {
  const hp = model.data.hp;
  const state = model.hpState;
  const n = Math.max(0, Number(amount) || 0);
  hp.current = Math.min(state.max, state.current + n);
  hp.nonlethal = Math.max(0, state.nonlethal - n);
  model.recompute();
  return model;
}

/** Full rest: back to maximum, temporary and nonlethal cleared. */
export function restoreAll(model) {
  const hp = model.data.hp;
  hp.current = model.hpMax;
  hp.temp = 0;
  // The granted pool comes back full too: what was spent of it is play state
  // and rests with everything else.
  hp.tempSpent = 0;
  hp.nonlethal = 0;
  // Back to the resting point: nothing spent, or the neutral 0 of a two-sided
  // meter -- but never outside the tracker's own range.
  for (const t of model.trackers) {
    t.current = Math.max(Number(t.min) || 0, Math.min(Number(t.max) || 0, 0));
  }
  model.recompute();
  return model;
}

/**
 * Take damage the way the table calls it out: temporary hit points absorb
 * first, the rest comes off current. No floor -- below zero is the dying
 * machinery's business, and it already watches `current`.
 * Returns what actually happened, for the toast that reports it.
 */
export function applyDamage(model, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n) return { taken: 0, fromTemp: 0 };
  const hp = model.data.hp;
  const fromTemp = spendTemp(model, n);
  hp.current = (Number(hp.current) || 0) - (n - fromTemp);
  model.recompute();
  emit(model, { type: 'quick-action', action: 'damage', amount: n });
  return { taken: n, fromTemp };
}

/**
 * Nonlethal damage: it does not touch current hit points at all, it piles up
 * against them, and a character is out when it catches up.
 *
 * A separate action from `applyDamage` rather than a flag on it, because at
 * the table they are two different buttons pressed for two different reasons
 * -- and because temporary hit points absorb one and not the other.
 */
export function applyNonlethal(model, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n) return { taken: 0 };
  const hp = model.data.hp;
  hp.nonlethal = Math.max(0, (Number(hp.nonlethal) || 0) + n);
  model.recompute();
  emit(model, { type: 'quick-action', action: 'nonlethal', amount: n });
  return { taken: n };
}

/**
 * Grant temporary hit points, as the rules grant them.
 *
 * They do not stack: "when temporary hit points come from two sources, only
 * the highest applies" -- so a second casting of false life over a first is
 * not eleven points, it is whichever of the two was better. That is the whole
 * reason this is a button rather than a box you add to by hand, and it is
 * measured against what the character actually has, rules-granted pool
 * included, rather than against the box alone.
 *
 * Returns what happened, so the toast can say "kept the 8 you had" rather
 * than reporting a grant that did nothing.
 */
export function grantTempHp(model, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const state = model.hpState;
  if (n <= state.temp) {
    emit(model, { type: 'quick-action', action: 'temp', amount: 0 });
    return { granted: 0, kept: state.temp, now: state.temp };
  }
  // The box holds the player's own, and the difference between the two is
  // what a rule is already granting; setting the box to the shortfall would
  // be arithmetic nobody asked for. The box takes the whole figure, and the
  // granted pool goes on being counted beside it -- which is the same answer,
  // because the two do not stack either way.
  model.data.hp.temp = n - Math.max(0, state.tempGrantLeft);
  model.recompute();
  emit(model, { type: 'quick-action', action: 'temp', amount: n });
  return { granted: n, kept: 0, now: n };
}

/**
 * Heal: current climbs to the maximum, and the same points erase nonlethal
 * (healing removes nonlethal damage point for point alongside lethal).
 */
export function applyHealing(model, amount) {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n) return { healed: 0 };
  const hp = model.data.hp;
  const max = model.hpState.max;
  const before = Number(hp.current) || 0;
  hp.current = Math.min(max, before + n);
  hp.nonlethal = Math.max(0, (Number(hp.nonlethal) || 0) - n);
  model.recompute();
  emit(model, { type: 'quick-action', action: 'heal', amount: n });
  return { healed: hp.current - before };
}

/**
 * A night's rest: every tracker whose refresh reads as daily -- "Daily",
 * "per day", "on rest", "at dawn" -- goes back to unspent (a two-sided
 * meter to its zero mark). Hit points, spell slots and pools with other
 * rhythms keep their own rules and are the player's to move.
 * Returns how many trackers moved.
 */
export function restRefresh(model) {
  let count = 0;
  for (const t of model.trackers) {
    if (!/daily|day|rest|dawn|morning|night/i.test(String(t.refresh || ''))) continue;
    if ((Number(t.current) || 0) !== 0) { t.current = 0; count++; }
  }
  if (count) model.recompute();
  emit(model, { type: 'quick-action', action: 'rest', count });
  return count;
}

/**
 * The style a meter is painted with, defaults filled in.
 *
 * A meter that has never been styled reads as the bar every character
 * starts with; anything the player set is layered over that.
 */
export function meterStyle(model, key) {
  const saved = model.data.meterStyles?.[key];
  return normalizeStyle({ ...meterDefaultStyle(key), ...(saved || {}) });
}

/**
 * Restyle a meter. A style that is back to the default is deleted rather
 * than stored, so a sheet nobody has restyled saves nothing at all.
 */
export function setMeterStyle(model, key, style) {
  if (!METERS.some(([k]) => k === key)) return model;
  const store = model.data.meterStyles || (model.data.meterStyles = {});
  if (isDefaultMeterStyle(style, key)) delete store[key];
  else store[key] = normalizeStyle({ ...meterDefaultStyle(key), ...(style || {}) });
  model.recompute();
  return model;
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
export function meterSpec(model, key) {
  const zones = (spec) => {
    const style = model.meterStyle(key);
    return {
      ...spec,
      id: key,
      meter: true,
      style,
      resolvedZones: resolveZones(style.zones, (src) => evaluateFormula(src, model.scope())),
    };
  };

  if (key === 'hp') {
    const hp = model.hpState;
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
    const k = model.data.akashic?.calc || {};
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
    const p = model.data.psionics || {};
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
