/**
 * How a totalled number was arrived at, part by part.
 *
 * Every headline figure on the sheet is a sum -- AC is nine or ten things, a
 * save is four, an ability score is seven columns on a tab most players never
 * open -- and until now the only way to see the parts was to go and find the
 * panel they were typed in. The number is right there; what it is *made of*
 * was somewhere else. This is the answer to "why is my AC 50", handed over
 * where the 50 is printed.
 *
 * One function, `breakdown(model, key)`, returning `{ label, total, parts }`
 * where each part is `{ label, value, note }`. The view turns it into a
 * tooltip (see ui/rows.js `workingTitle`); nothing here knows about markup.
 *
 * **The parts must add up.** Each list below is written against the same
 * expression in rules.js DERIVED that produces the number, and a breakdown
 * whose parts do not sum to the total is a lie of exactly the kind this
 * exists to stop -- so the test suite checks the sum for every key on every
 * fixture rather than trusting the two to stay in step.
 */

import {
  AC_BONUS_TYPES, ABILITIES, ABILITY_LABELS, ATTACK_MODE_KEY,
  BUILD_TEMPORARY, SAVE_BONUS_TYPES, abpGroupTotal, armorParts, sizeMod, statMod,
} from '../rules.js';
import { forwarded, forwardedSplit } from './scope.js';
import { mythicHp } from './stats/defenses.js';

/** A part worth showing: anything but a zero nobody typed. */
const part = (label, value, note = '') => ({ label, value: Number(value) || 0, note });

/**
 * The typed bonus columns of a save or the AC, one line each.
 *
 * ABP pairs are shown as the pair the sum treats them as -- the progression's
 * deflection and a typed one are capped together, and two lines that add to
 * more than the total would be a worse answer than one that says so.
 */
function bonusParts(resolved, types, filter = null) {
  const keys = new Set(types.map(([key]) => key));
  const pairs = new Map();
  for (const [abp, typed] of [['abpResistance', 'resistance'], ['abpDeflection', 'deflection'],
    ['abpNatural', 'enhancedNatural']]) {
    if (keys.has(abp) && keys.has(typed)) pairs.set(abp, typed);
  }
  const out = [];
  const paired = new Set(pairs.values());
  for (const [key, label, flags] of types) {
    if (filter && flags && flags[filter] === false) continue;
    if (paired.has(key)) continue;                      // shown with its ABP partner
    const typed = pairs.get(key);
    const value = typed
      ? abpGroupTotal(resolved?.[key], resolved?.[typed])
      : Number(resolved?.[key]) || 0;
    if (!value) continue;
    const other = typed ? Number(resolved?.[typed]) || 0 : 0;
    out.push(part(typed && other ? `${label} + typed` : label, value,
      typed && other ? 'capped together — the progression’s and your own do not stack past the cap' : ''));
  }
  return out;
}

/** The ability slot a defence or an attack reads, as one line. */
function abilityPart(c, stat1, stat2, { cap = Infinity, label = 'ability' } = {}) {
  const raw = statMod(c, stat1, stat2);
  const value = Math.min(cap, raw);
  const names = [stat1, stat2].filter(Boolean).join(' + ') || label;
  return part(names, value, value === raw ? '' : `${raw} before the armour’s maximum Dexterity of ${cap}`);
}

/** The reconciliation offset and the forwarded bonus, where either is doing anything. */
function extras(model, derivedKey, forwardKey) {
  const out = [];
  const offset = derivedKey ? model.offsetOf(derivedKey) : 0;
  if (offset) {
    out.push(part('Other', offset,
      'what the source workbook added through formulas the export could not show — the “Other” column'));
  }
  const fwd = forwardKey ? forwarded(model, forwardKey) : 0;
  if (fwd) out.push(part('forwarded', fwd, 'a rule written elsewhere on the sheet — see the gold badge'));
  return out;
}

/* ------------------------------------------------------------------ *
 * One builder per headline number.
 * ------------------------------------------------------------------ */

function acBreakdown(model, which) {
  const c = model.data;
  const d = c.defenses;
  const worn = armorParts(c);
  const filter = which === 'ac' ? null : which === 'touch' ? 'touch' : 'flatFooted';
  const parts = [part('base', 10)];
  if (which !== 'flatFooted') {
    parts.push(abilityPart(c, d.acStat1, d.acStat2, { cap: worn.maxDex }));
  } else if (d.uncannyDodge) {
    parts.push({ ...abilityPart(c, d.acStat1, d.acStat2, { cap: worn.maxDex }), note: 'uncanny dodge keeps it while flat-footed' });
  }
  parts.push(part('size', sizeMod(c)));
  if (which !== 'touch') {
    parts.push(part('misc AC', d.miscAC));
    parts.push(part('armour', worn.armor));
    parts.push(part('shield', worn.shield));
  }
  parts.push(...bonusParts(d.acBonusesResolved, AC_BONUS_TYPES, filter));
  const key = which === 'ac' ? 'defenses.ac' : which === 'touch' ? 'defenses.touch' : 'defenses.flatFooted';
  const fwd = which === 'ac' ? 'ac.total' : which === 'touch' ? 'ac.touch' : 'ac.flatFooted';
  parts.push(...extras(model, key, fwd));
  return parts;
}

function cmdBreakdown(model) {
  const c = model.data;
  const d = c.defenses;
  const parts = [
    part('base', 10),
    part('BAB', c.attack.bab),
    part('Str', c.abilities.str.totalMod),
    part('Dex', c.abilities.dex.totalMod),
    part('special size', -sizeMod(c)),
    part('misc CMD', d.miscCMD),
    // Only the columns CMD is allowed the bonus from -- and every penalty,
    // whatever column it was typed in, because "any penalties to a creature's
    // AC also apply to its CMD".
    ...bonusParts(d.acBonusesResolved, AC_BONUS_TYPES, 'cmd'),
    ...AC_BONUS_TYPES.filter(([, , flags]) => flags?.cmd === false).map(([key, label]) => part(
      `${label} penalty`, Math.min(0, Number(d.acBonusesResolved?.[key]) || 0),
      'a penalty to AC applies to CMD whatever type it is',
    )),
    part('misc AC penalty', Math.min(0, Number(d.miscAC) || 0),
      'a penalty to AC applies to CMD whatever column it was typed in'),
    ...extras(model, 'defenses.cmd', 'ac.cmd'),
  ];
  return parts;
}

function saveBreakdown(model, key) {
  const sv = model.data.saves[key] || {};
  return [
    part('base', sv.base, 'from the Classes table'),
    abilityPart(model.data, sv.stat1, sv.stat2),
    ...bonusParts(sv.bonusesResolved, SAVE_BONUS_TYPES),
    ...extras(model, `saves.${key}.total`, `saves.${key}`),
  ];
}

function attackBreakdown(model, mode) {
  const c = model.data;
  const m = c.attack.modes?.[mode] || {};
  return [
    part('BAB', c.attack.bab),
    abilityPart(c, m.stat1, m.stat2),
    part('size', -sizeMod(c)),
    part('misc', c.attack.miscBonus),
    ...extras(model, ATTACK_MODE_KEY[mode], `attack.${mode}`),
  ];
}

function hpBreakdown(model) {
  const c = model.data;
  const level = Number(c.identity?.level) || 0;
  const abilityMod = Number(c.gestalt?.hp?.abilityMod) || 0;
  const fcb = Number(c.hp.fcbResolved ?? c.hp.fcb) || 0;
  const tough = Number(c.hp.toughnessResolved ?? c.hp.toughness) || 0;
  const misc = Number(c.hp.miscResolved ?? c.hp.misc) || 0;
  const parts = [
    part('hit dice', c.gestalt?.hdTotal ?? 0, `the best die on each of ${level} level${level === 1 ? '' : 's'}`),
    part(`${c.hp.ability || 'ability'}${c.hp.ability2 ? ` + ${c.hp.ability2}` : ''} × ${level}`, abilityMod * level),
    part('favoured class', fcb),
    part(`Toughness × ${level}`, tough * level),
    part('mythic', mythicHp(model)),
    part('misc', misc),
  ];
  parts.push(...extras(model, 'hp.total', 'hp.total'));
  return parts;
}

function abilityBreakdown(model, key, which) {
  const build = model.data.statsBuild?.[key];
  const a = model.data.abilities[key] || {};
  if (!build) {
    // No build tab: the score is a plain typed number with whatever a rule
    // has forwarded at it beside.
    const fwd = forwardedSplit(model, `${key}.score`);
    const tempFwd = forwardedSplit(model, `${key}.temp`);
    return which === 'temp'
      ? [part('score', a.score), part('typed temporary', (Number(a.tempScore) || 0) - (Number(a.score) || 0)),
        part('forwarded', fwd.total + tempFwd.total)]
      : [part('score', a.score), part('forwarded', fwd.permanent)];
  }
  const r = build.resolved || {};
  let parts;
  if (which === 'temp') {
    // The working score is the permanent one plus the temporary columns:
    // saying so is more use than repeating all ten permanent columns under a
    // heading that is about the other five.
    parts = [
      part('score', a.score, 'everything the permanent columns come to'),
      ...BUILD_TEMPORARY.map(([k, label]) => part(label, build[k])),
      part('forwarded', (a.forwarded?.total || 0) + (a.forwardedTemp?.total || 0),
        'a rule written elsewhere on the sheet'),
    ];
  } else {
    // The permanent columns as `resolveAbility` sums them: ABP and gear are
    // one enhancement bonus and stop at the cap, so they are shown as the one
    // line the sum treats them as, with what the cap wasted on the note.
    parts = [
      part('point buy', build.pointBuy),
      part('race', build.race),
      part('enhancement', r.enhancement,
        r.enhancementWasted ? `ABP ${build.abp || 0} + gear ${build.gear || 0}, ${r.enhancementWasted} over the cap` : 'ABP and gear together'),
      ...[['attunement', 'attuned'], ['inherent', 'inherent'], ['array', 'array'],
        ['level4', 'level/4'], ['mythic', 'mythic'], ['size', 'size'], ['untyped', 'untyped']]
        .map(([k, label]) => part(label, build[k])),
      part('forwarded', a.forwarded?.permanent || 0, 'a rule written elsewhere on the sheet'),
    ];
  }
  // The build's own resolver may cap or floor a column; where it does, the
  // difference is named rather than left to make the sum wrong.
  const shown = parts.reduce((t, p) => t + p.value, 0);
  const total = which === 'temp' ? (Number(a.tempScore) || 0) : (Number(a.score) || 0);
  if (shown !== total) parts.push(part('the build’s own rules', total - shown, 'caps and floors on the Stats tab'));
  return parts;
}

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */

/**
 * Every key a breakdown can be asked for, and what it is called.
 *
 * Keyed by the same names `conditionState` uses for its deltas, so a panel
 * that already has one has the other -- `movedInline(cs, 'ac', …)` and
 * `breakdown(model, 'ac')` are the same number twice.
 */
export const BREAKDOWNS = new Map([
  ['ac', { label: 'Armor Class', build: (m) => acBreakdown(m, 'ac'), total: (m) => m.data.defenses.ac }],
  ['touch', { label: 'Touch AC', build: (m) => acBreakdown(m, 'touch'), total: (m) => m.data.defenses.touch }],
  ['flatFooted', { label: 'Flat-footed AC', build: (m) => acBreakdown(m, 'flatFooted'), total: (m) => m.data.defenses.flatFooted }],
  ['cmd', { label: 'CMD', build: cmdBreakdown, total: (m) => m.data.defenses.cmd }],
  ['fortitude', { label: 'Fortitude', build: (m) => saveBreakdown(m, 'fortitude'), total: (m) => m.data.saves.fortitude.total }],
  ['reflex', { label: 'Reflex', build: (m) => saveBreakdown(m, 'reflex'), total: (m) => m.data.saves.reflex.total }],
  ['will', { label: 'Will', build: (m) => saveBreakdown(m, 'will'), total: (m) => m.data.saves.will.total }],
  ['melee', { label: 'Melee attack', build: (m) => attackBreakdown(m, 'melee'), total: (m) => m.data.attack.totalMelee }],
  ['ranged', { label: 'Ranged attack', build: (m) => attackBreakdown(m, 'ranged'), total: (m) => m.data.attack.totalRanged }],
  ['cmb', { label: 'CMB', build: (m) => attackBreakdown(m, 'cmb'), total: (m) => m.data.attack.totalCmb }],
  ['initiative', {
    label: 'Initiative',
    build: (m) => [part('Dex', m.data.abilities.dex.totalMod), ...extras(m, 'initiative', 'initiative')],
    total: (m) => m.data.hp.initiative,
  }],
  ['hp', { label: 'Hit points', build: hpBreakdown, total: (m) => m.hpMax }],
  ...ABILITIES.flatMap((k) => [
    [k, {
      label: `${ABILITY_LABELS[k]} score`,
      build: (m) => abilityBreakdown(m, k, 'score'),
      total: (m) => m.data.abilities[k]?.score,
    }],
    [`${k}.temp`, {
      label: `${ABILITY_LABELS[k]} (working score)`,
      build: (m) => abilityBreakdown(m, k, 'temp'),
      total: (m) => m.data.abilities[k]?.tempScore,
    }],
  ]),
]);

/**
 * How one number was arrived at.
 *
 * Zero parts are dropped -- a form with six noughts in it explains nothing --
 * but the total is always the sheet's own, never the sum of what is shown, so
 * a part this file has forgotten shows up as a discrepancy rather than as a
 * quietly wrong total. `sum` is what the parts come to, for exactly that
 * check.
 */
export function breakdown(model, key) {
  const spec = BREAKDOWNS.get(key);
  if (!spec) return null;
  const all = spec.build(model);
  const parts = all.filter((p) => p.value);
  const sum = all.reduce((t, p) => t + p.value, 0);
  return { key, label: spec.label, total: Number(spec.total(model)) || 0, parts, sum };
}
