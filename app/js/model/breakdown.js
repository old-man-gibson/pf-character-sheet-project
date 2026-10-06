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
  ABILITIES, ABILITY_LABELS, AC_PENALTY_KEYS, ATTACK_MODE_KEY, BUILD_TEMPORARY, CONDITION_CHANNELS,
  abilityOf, acParts, acPenaltyToCmd, attackParts, cmdParts, conditionTotals, initiativeParts, recipePart,
  recipePlain, saveParts,
} from '../rules.js';
import { forwarded, forwardedSplit } from './scope.js';
import { abilityMoves, abilitySlots, mythicHp } from './stats/defenses.js';
import { COMPANION_KINDS, companionBreakdown, companionScopeName } from '../companions.js';

// The line makers are the recipes' own (rules.js), so a breakdown's lines
// are the lines its number is summed from.
const part = recipePart;
const plain = recipePlain;

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

/**
 * A number with a recipe: its lines, then the offset and the forwarded
 * bonus the recompute adds on top of the recipe's sum.
 */
const withExtras = (lines, derivedKey, forwardKey) => (model) => [
  ...lines(model.data), ...extras(model, derivedKey, forwardKey),
];

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
      ...BUILD_TEMPORARY.map(([k, , full]) => part(full, build[k])),
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
  const total = which === 'temp' ? (Number(a.workingScore ?? a.tempScore) || 0) : (Number(a.score) || 0);
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
  ['ac', { label: 'Armor Class', build: withExtras((c) => acParts(c, 'ac'), 'defenses.ac', 'ac.total'), total: (m) => m.data.defenses.ac }],
  ['touch', { label: 'Touch AC', build: withExtras((c) => acParts(c, 'touch'), 'defenses.touch', 'ac.touch'), total: (m) => m.data.defenses.touch }],
  ['flatFooted', { label: 'Flat-footed AC', build: withExtras((c) => acParts(c, 'flatFooted'), 'defenses.flatFooted', 'ac.flatFooted'), total: (m) => m.data.defenses.flatFooted }],
  ['cmd', { label: 'CMD', build: withExtras(cmdParts, 'defenses.cmd', 'ac.cmd'), total: (m) => m.data.defenses.cmd }],
  ...['fortitude', 'reflex', 'will'].map((k) => [k, {
    label: k[0].toUpperCase() + k.slice(1),
    build: withExtras((c) => saveParts(c, k), `saves.${k}.total`, `saves.${k}`),
    total: (m) => m.data.saves[k].total,
  }]),
  ...[['melee', 'Melee attack', 'totalMelee'], ['ranged', 'Ranged attack', 'totalRanged'], ['cmb', 'CMB', 'totalCmb']]
    .map(([mode, label, field]) => [mode, {
      label,
      build: withExtras((c) => attackParts(c, mode), ATTACK_MODE_KEY[mode], `attack.${mode}`),
      total: (m) => m.data.attack[field],
    }]),
  ['initiative', { label: 'Initiative', build: withExtras(initiativeParts, 'initiative', 'initiative'), total: (m) => m.data.hp.initiative }],
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
      total: (m) => m.data.abilities[k]?.workingScore ?? m.data.abilities[k]?.tempScore,
    }],
  ]),
]);

/* ------------------------------------------------------------------ *
 * What the ticked buffs and conditions are doing to it
 * ------------------------------------------------------------------ */

/** A channel's name, for a share that arrived by a wider road than the key. */
const CHANNEL_LABELS = {
  attack: 'every attack', melee: 'melee attacks', ranged: 'ranged attacks', cmb: 'CMB',
  ac: 'AC', cmd: 'CMD', saves: 'every save', fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will',
  initiative: 'initiative', hp: 'hit points',
};

/** 'Dex', 'dex', 'Dexterity' -> 'dex'; anything else -> null. */
const abilityKeyOf = abilityOf;

/** The ability slots a key is built on: the list `abilityMoves` sums by. */
const slotsOf = (c, key) => abilitySlots(c)[key] || [];

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
  // The channels conditionState sums for this key (CONDITION_CHANNELS).
  const chans = CONDITION_CHANNELS[key] || [];
  const counted = cs.counted || [];
  const slots = [...new Set(slotsOf(c, key).map(abilityKeyOf).filter(Boolean))];
  // Named by the abilities this source moved, of the ones the number is built
  // on: blindness reaches CMD through Dex alone, though CMD adds Str as well.
  // A source that moved no score took a bonus away instead -- blinded,
  // flat-footed -- and on CMD the bonus a creature loses is its Dexterity's.
  const lostBonus = key === 'cmd' || key === 'ffCmd' ? ['dex'] : slots;
  const throughLabel = (moved) => {
    const named = (moved.length ? moved : lostBonus).map((s) => ABILITY_LABELS[s]);
    return named.length ? `through ${named.join(' + ')}` : 'through the abilities';
  };
  // Each source's ability-borne share: the number with the sources up to and
  // including it, less the number with the sources before it.
  const through = new Map();
  const taken = [];
  let before = 0;
  let beforeDeltas = {};
  for (const entry of counted) {
    taken.push(entry);
    const moves = abilityMoves(c, conditionTotals(taken));
    const after = moves.byKey[key] || 0;
    if (after !== before) {
      const moved = slots.filter((s) => (moves.deltas[s] || 0) !== (beforeDeltas[s] || 0));
      through.set(entry, { value: after - before, label: throughLabel(moved) });
    }
    before = after;
    beforeDeltas = moves.deltas;
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
    if (AC_PENALTY_KEYS.has(key) && acPenaltyToCmd(info)) {
      value += acPenaltyToCmd(info) * n;
      via.push('an AC penalty applies to CMD too');
    }
    const share = through.get(entry);
    const indirect = share?.value || 0;
    if (value) {
      const p = part(label, value, [kind, ...via].join(' — '));
      if (indirect) p.lines = [part(share.label, indirect)];
      parts.push(p);
    } else if (indirect) {
      parts.push(part(label, indirect, `${kind} — ${share.label}`));
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
