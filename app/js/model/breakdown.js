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
  BUILD_TEMPORARY, SAVE_BONUS_TYPES, abpGroupTotal, armorParts, conditionTotals, sizeMod, statMod,
} from '../rules.js';
import { forwarded, forwardedSplit } from './scope.js';
import { abilityMoves, mythicHp } from './stats/defenses.js';
import { COMPANION_KINDS, companionBreakdown, companionScopeName } from '../companions.js';

/** A part worth showing: anything but a zero nobody typed. */
const part = (label, value, note = '') => ({ label, value: Number(value) || 0, note });

/**
 * The number a sum starts from -- the 10 under every AC, a save's base off the
 * Classes table, the score a working score is built on. Shown without a sign,
 * because it is a number and not a bonus to one: "Base 10", then "+14" for
 * everything laid on it.
 */
const plain = (label, value, note = '') => ({ label, value: Number(value) || 0, note, plain: true });
const base = (value, note = '') => plain('Base', value, note);

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
  const parts = [base(10)];
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
    base(10),
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
    base(sv.base, 'from the Classes table'),
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
    plain('hit dice', c.gestalt?.hdTotal ?? 0, `the best die on each of ${level} level${level === 1 ? '' : 's'}`),
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
      ? [plain('Score', a.score), part('typed temporary', (Number(a.tempScore) || 0) - (Number(a.score) || 0)),
        part('forwarded', fwd.total + tempFwd.total)]
      : [plain('Score', a.score), part('forwarded', fwd.permanent)];
  }
  const r = build.resolved || {};
  let parts;
  if (which === 'temp') {
    // The working score is the permanent one plus the temporary columns:
    // saying so is more use than repeating all ten permanent columns under a
    // heading that is about the other five.
    parts = [
      plain('Score', a.score, 'everything the permanent columns come to'),
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

/* ------------------------------------------------------------------ *
 * What the ticked buffs and conditions are doing to it
 * ------------------------------------------------------------------ */

/**
 * The condition-state channels that reach each key -- the same pairings
 * `conditionState` sums into `delta`, written down once more here so that
 * each ticked buff and condition can be shown with its own share of the
 * move. A key with no entry is one the conditions never touch.
 */
const CHANNELS = {
  melee: ['attack', 'melee'], altMelee: ['attack', 'melee'],
  ranged: ['attack', 'ranged'], altRanged: ['attack', 'ranged'],
  cmb: ['attack', 'cmb'], altCmb: ['attack', 'cmb'],
  ac: ['ac'], touch: ['ac'], flatFooted: ['ac'],
  cmd: ['cmd'], ffCmd: ['cmd'],
  fortitude: ['saves', 'fortitude'], reflex: ['saves', 'reflex'], will: ['saves', 'will'],
  initiative: ['initiative'], hp: ['hp'],
};

/** A channel's name, for a share that arrived by a wider road than the key. */
const CHANNEL_LABELS = {
  attack: 'every attack', melee: 'melee attacks', ranged: 'ranged attacks', cmb: 'CMB',
  ac: 'AC', cmd: 'CMD', saves: 'every save', fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will',
  initiative: 'initiative', hp: 'hit points',
};

/** 'Dex', 'dex', 'Dexterity' -> 'dex'; anything else -> null. */
const abilityKeyOf = (x) => {
  const s = String(x || '').trim().toLowerCase().slice(0, 3);
  return ABILITIES.includes(s) ? s : null;
};

/** The ability slots a key is built on, whose movement reaches it. */
function slotsOf(c, key) {
  const d = c.defenses;
  if (key === 'ac' || key === 'touch') return [d.acStat1, d.acStat2];
  if (key === 'flatFooted') return d.uncannyDodge ? [d.acStat1, d.acStat2] : [];
  if (key === 'cmd' || key === 'initiative') return ['dex'];
  if (key === 'fortitude' || key === 'reflex' || key === 'will') return [c.saves[key]?.stat1, c.saves[key]?.stat2];
  if (CHANNELS[key]?.[0] === 'attack') {
    const m = c.attack.modes?.[key] || {};
    return [m.stat1, m.stat2];
  }
  return [];
}

/**
 * The ticked buffs and conditions, one entry each, with its share of what
 * moved `key`.
 *
 * An entry's own line is the direct share: a buff's AC dial on the AC,
 * shaken's −2 on every attack and every save, with the channel named where
 * it is a wider one than the number itself, and an AC penalty's second life
 * on CMD said out loud. What the same source did *through an ability* -- a
 * Dexterity buff reaching the AC as a larger modifier, blindness taking the
 * modifier away, paralysis setting the score to 0 -- is a line under that
 * one (`lines`), "through Dex", and no further broken down; a source with
 * only that to show gets it as its own line.
 *
 * The through-ability shares are found by running `abilityMoves` over the
 * sources one at a time, in order, and crediting each with the difference it
 * made -- because that share is not a per-source figure by nature (two +2s
 * to Dexterity are one +2 to the modifier, and blindness takes whatever
 * bonus is left, whoever gave it), and taking each in turn is what makes the
 * shares add up to the whole exactly. `conditionState` stays the sole
 * authority on the number; this only says who is responsible for it, and a
 * last line owns up to anything it could not.
 */
function adjustmentParts(model, key, cs) {
  // Not short-circuited on a move of nothing: two sources that cancel -- a
  // +2 and a −2 -- are still two entries, under a net of 0.
  const delta = cs.delta[key] || 0;
  const c = model.data;
  const chans = CHANNELS[key] || [];
  const counted = cs.counted || [];
  const slots = [...new Set(slotsOf(c, key).map(abilityKeyOf).filter(Boolean))].map((s) => ABILITY_LABELS[s]);
  const throughLabel = slots.length ? `through ${slots.join(' + ')}` : 'through the abilities';
  // Each source's ability-borne share: the number with the sources up to and
  // including it, less the number with the sources before it.
  const through = new Map();
  const taken = [];
  let before = 0;
  for (const entry of counted) {
    taken.push(entry);
    const after = abilityMoves(c, conditionTotals(taken)).byKey[key] || 0;
    if (after !== before) through.set(entry, after - before);
    before = after;
  }
  const parts = [];
  for (const entry of counted) {
    const { info, count } = entry;
    const n = Math.max(1, count);
    const source = String(info?.key || '');
    const kind = source === 'buff:size' ? 'size' : source.startsWith('buff:') ? 'buff' : 'condition';
    const label = `${info?.label || 'condition'}${n > 1 ? ` ×${n}` : ''}`;
    let value = 0;
    const via = [];
    for (const ch of chans) {
      const v = (Number(info?.mods?.[ch]) || 0) * n;
      if (!v) continue;
      value += v;
      if (ch !== key) via.push(CHANNEL_LABELS[ch] || ch);
    }
    // "Any penalties to a creature's AC also apply to its CMD" -- the
    // acPenalty conditionTotals keeps, source by source.
    if ((key === 'cmd' || key === 'ffCmd') && info?.mods?.cmd === undefined && (Number(info?.mods?.ac) || 0) < 0) {
      value += info.mods.ac * n;
      via.push('an AC penalty applies to CMD too');
    }
    const indirect = through.get(entry) || 0;
    if (value) {
      const p = part(label, value, [kind, ...via].join(' — '));
      if (indirect) p.lines = [part(throughLabel, indirect)];
      parts.push(p);
    } else if (indirect) {
      parts.push(part(label, indirect, `${kind} — ${throughLabel}`));
    }
  }
  const shown = parts.reduce((t, p) => t + p.value + (p.lines || []).reduce((s, l) => s + l.value, 0), 0);
  if (shown !== delta) parts.push(part('unaccounted for', delta - shown));
  return parts;
}

/**
 * A companion's number, by the name it reads by: `eidolon.ac`,
 * `familiar.fort`, `conjured2.str`. The first word is the block's scope name
 * -- its id, or the kind for the first of a kind -- and the rest the stat,
 * which `companionBreakdown` in companions.js knows how to open.
 */
function companionWorking(model, key) {
  const dot = String(key).indexOf('.');
  if (dot < 0) return null;
  const sn = key.slice(0, dot);
  const stat = key.slice(dot + 1);
  for (const kind of COMPANION_KINDS) {
    for (const b of model.data[kind] || []) {
      if (companionScopeName(kind, b) !== sn) continue;
      const w = companionBreakdown(kind, b, stat);
      return w ? { label: w.label, total: Number(w.total) || 0, all: w.parts } : null;
    }
  }
  return null;
}

/**
 * How one number was arrived at.
 *
 * Zero parts are dropped -- a form with six noughts in it explains nothing --
 * but the total is always the sheet's own, never the sum of what is shown, so
 * a part this file has forgotten shows up as a discrepancy rather than as a
 * quietly wrong total. `sum` is what the parts come to, for exactly that
 * check.
 *
 * The character's own numbers carry a second layer: what the ticked buffs
 * and conditions are doing to this one, as `adjustments` -- one entry a
 * source, adding up to `delta`, the move -- and `adjusted`, the number as it
 * then stands, which is the one the sheet is showing. `total` stays the
 * permanent number, because that is what the parts add up to; `delta` can
 * be 0 with entries under it, when what is ticked cancels out. A companion
 * has no condition layer and gets none of this.
 */
export function breakdown(model, key) {
  const spec = BREAKDOWNS.get(key);
  const own = spec
    ? { label: spec.label, total: Number(spec.total(model)) || 0, all: spec.build(model) }
    : companionWorking(model, key);
  if (!own) return null;
  const parts = own.all.filter((p) => p.value);
  const sum = own.all.reduce((t, p) => t + p.value, 0);
  const out = { key, label: own.label, total: own.total, parts, sum };
  if (spec) {
    const cs = model.conditionState;
    const adjustments = adjustmentParts(model, key, cs);
    if (adjustments.length) {
      out.adjustments = adjustments;
      out.delta = cs.delta[key] || 0;
      out.adjusted = Number(cs.adjusted[key] ?? (out.total + out.delta)) || 0;
      out.moved = cs.sources;
    }
  }
  return out;
}
