/**
 * roll20.js -- the sheet's numbers as text a Roll20 chat box will roll.
 *
 * The sheet already knows every total there is to know; what it could not do
 * was hand one to the table. A d20 button beside a skill, an ability, a save or
 * a weapon copies that row as a roll, so play is paste-and-enter rather than
 * read-the-number-then-type-it -- which is where the transcription errors were.
 *
 * Two shapes come out of here, because Roll20 games use both:
 *
 *   template   &{template:default} {{name=Perception}} {{Skill check=[[1d20+12]]}}
 *              The default roll template ships with every Roll20 game, sheet or
 *              no sheet, and draws a titled box with a row per roll -- so the
 *              extras a roll has (a crit line, the conditions behind a number)
 *              have somewhere to go.
 *   plain      /roll 1d20+12 Perception
 *              One line, no template, for a game that wants the bare roll.
 *
 * Everything here is a pure function of an already-computed character, which is
 * what makes it testable off the page: tests/roll20.test.mjs builds characters
 * by hand and reads the strings back.
 *
 * Two Roll20 details worth naming, because they are why this is a module and
 * not a template literal in the view:
 *
 *   - A crit range wider than a natural 20 is "cs>19" on the die itself
 *     (1d20cs>19+18), which is what makes Roll20 colour a threat green. The
 *     sheet knows each weapon's range, so the roll it hands over knows it too.
 *   - Chat resolves macros, attributes, queries and inline rolls before it
 *     prints, so a weapon called "Longsword [holy]" would truncate the message
 *     it is pasted into. Names and notes go through `escapeRoll20` for that
 *     reason; formulas do not, since those brackets are the point.
 */
import {
  ABILITIES, ABILITY_LABELS, fmt, diceString, addDice, skillLabel, statModDelta,
  attackModeTotal, parseDiceExpr, stepDiceMap,
} from './rules.js';
import { COMPANION_LABELS } from './companions.js';

/** The formats a copy can be taken in, and what to call them in the UI. */
export const ROLL_FORMATS = [
  ['template', 'Roll template'],
  ['plain', 'Plain /roll'],
];

export const DEFAULT_ROLL_FORMAT = 'template';

/**
 * Text that is a name, not a roll, made safe to paste.
 *
 * The numeric entities below are what Roll20 documents for the job: they get
 * past the chat parser and print as the character they stand for.
 */
const ROLL20_ENTITIES = [
  ['&', '&#38;'],   // first, or it would re-escape the entities below
  ['{', '&#123;'], ['}', '&#125;'],
  ['[', '&#91;'], [']', '&#93;'],
  ['|', '&#124;'], ['@', '&#64;'], ['%', '&#37;'],
  ['?', '&#63;'], ['~', '&#126;'],
];

export function escapeRoll20(text) {
  let out = String(text ?? '').replace(/\s+/g, ' ').trim();
  for (const [ch, ent] of ROLL20_ENTITIES) out = out.split(ch).join(ent);
  return out;
}

/**
 * A d20 roll: the die, the modifier, and anything else rolled alongside it.
 *
 * `dice` is the sheet's {size: count} map, which is how a `{{1d6}}` bonus
 * written into a weapon's special properties reaches the attack roll.
 * `critRange` below 20 becomes Roll20's `cs>`, so a threat is highlighted at
 * the table rather than worked out by hand.
 */
export function d20(mod, { dice = null, critRange = 20 } = {}) {
  const range = Math.floor(Number(critRange) || 20);
  let out = `1d20${range > 1 && range < 20 ? `cs>${range}` : ''}`;
  const m = Math.round(Number(mod) || 0);
  if (m) out += fmt(m);
  const extra = dice && Object.values(dice).some((n) => n) ? diceString(dice) : '';
  if (extra) out += extra.startsWith('-') ? extra : `+${extra}`;
  return out;
}

/** "2d6+12" from the sheet's dice map and its flat part. */
export function damageFormula(dice, flat = 0) {
  return diceString(dice || {}, Math.round(Number(flat) || 0));
}

/** Every count in a dice map multiplied -- a critical rolls its dice again. */
function scaleDice(dice, times) {
  const out = {};
  for (const [size, count] of Object.entries(dice || {})) {
    if (count * times) out[size] = count * times;
  }
  return out;
}

/** Dice-map subtraction, for pulling one pool back out of a combined one. */
function subDice(a, b) {
  return addDice(a, scaleDice(b, -1));
}

/* ------------------------------------------------------------------ *
 * Turning a spec into text
 * ------------------------------------------------------------------ */

/**
 * A roll spec is what the sheet knows about one thing you can roll:
 *
 *   { name, rolls: [{ label, formula }], notes: [{ label, text }] }
 *
 * The builders below produce these; `rollText` is the only thing that knows
 * what Roll20's syntax looks like, so a third format would be a third branch
 * here and nothing else.
 */
export function rollText(spec, format = DEFAULT_ROLL_FORMAT) {
  if (!spec || !(spec.rolls || []).length) return '';
  const { rolls } = spec;
  const notes = spec.notes || [];
  const name = escapeRoll20(spec.name);

  if (format === 'plain') {
    const tail = notes.length
      ? ` (${notes.map((n) => `${escapeRoll20(n.label)}: ${escapeRoll20(n.text)}`).join('; ')})`
      : '';
    // One roll is a real /roll command; several have to share a message, and
    // inline rolls are how Roll20 puts more than one result on one line.
    if (rolls.length === 1) return `/roll ${rolls[0].formula} ${name}${tail}`.trimEnd();
    return `${name}: ${rolls.map((r) => `${escapeRoll20(r.label)} [[${r.formula}]]`).join(', ')}${tail}`;
  }

  return ['&{template:default}', `{{name=${name}}}`,
    ...rolls.map((r) => `{{${escapeRoll20(r.label)}=[[${r.formula}]]}}`),
    ...notes.map((n) => `{{${escapeRoll20(n.label)}=${escapeRoll20(n.text)}}}`),
  ].join(' ');
}

/* ------------------------------------------------------------------ *
 * Specs, read off a computed character
 * ------------------------------------------------------------------ */

/** The character's name in front of the thing rolled, when it has one. */
function titled(c, what) {
  const name = String(c?.identity?.name ?? '').trim();
  return name ? `${name} — ${what}` : what;
}

/**
 * The conditions behind a number, named -- but only when they moved it.
 *
 * Every roll here is the roll as the ticked conditions leave it, which is the
 * one you would actually make. That would otherwise be a silent disagreement
 * with the total printed beside the button, so a shifted roll says what shifted
 * it and by how much.
 */
function conditionNote(cs, delta) {
  if (!delta || !cs?.active?.length) return [];
  const names = cs.active
    .map(({ info, count }) => `${info?.label ?? ''}${count > 1 ? ` ×${count}` : ''}`)
    .filter((s) => s.trim()).join(', ');
  return names ? [{ label: 'Conditions', text: `${names} (${fmt(delta)})` }] : [];
}

/** An ability check -- the modifier, not the score. */
export function abilityRollSpec(c, key, cs = null) {
  if (!ABILITIES.includes(key)) return null;
  const a = c?.abilities?.[key];
  if (!a) return null;
  const delta = (cs?.deltas?.[key] || 0) + (cs?.delta?.abilityChecks || 0);
  return {
    name: titled(c, `${ABILITY_LABELS[key]} check`),
    rolls: [{ label: 'Ability check', formula: d20((Number(a.totalMod) || 0) + delta) }],
    notes: conditionNote(cs, delta),
  };
}

const SAVE_LABELS = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' };

export function saveRollSpec(c, key, cs = null) {
  const label = SAVE_LABELS[key];
  const s = c?.saves?.[key];
  if (!label || !s) return null;
  const delta = cs?.delta?.[key] || 0;
  return {
    name: titled(c, `${label} save`),
    rolls: [{ label: 'Saving throw', formula: d20((Number(s.total) || 0) + delta) }],
    notes: conditionNote(cs, delta),
  };
}

/**
 * The attacks a base attack bonus buys, at the usual five-point steps.
 *
 * `total` is the first attack in full; the rest step down from it, so a
 * character whose ability and gear put them at +18 off a BAB of 11 gets
 * +18/+13, not +11/+6. A weapon's own dice and crit range ride on every one
 * of them, which is what `opts` carries.
 */
function iterativeRolls(bab, total, label, opts = {}) {
  const b = Math.floor(Number(bab) || 0);
  const values = [];
  for (let at = b; at > 0; at -= 5) values.push(total - (b - at));
  if (!values.length) values.push(total);
  return values.map((v, i) => ({
    label: values.length > 1 ? `${label} ${i + 1}` : label,
    formula: d20(v, opts),
  }));
}

/**
 * The six attack slots, and how each one rolls.
 *
 * An alternate is the same attack with a different ability in the slot, so it
 * takes the same title -- and then says which ability, since that is the whole
 * difference between the two and the reason a character keeps both.
 */
const MODE_ROLLS = {
  melee: { title: 'Melee attack', row: 'Attack', iteratives: true },
  altMelee: { title: 'Melee attack', row: 'Attack', iteratives: true, alt: true },
  ranged: { title: 'Ranged attack', row: 'Attack', iteratives: true },
  altRanged: { title: 'Ranged attack', row: 'Attack', iteratives: true, alt: true },
  cmb: { title: 'Combat maneuver', row: 'Maneuver', iteratives: false },
  altCmb: { title: 'Combat maneuver', row: 'Maneuver', iteratives: false, alt: true },
};

/** Melee, ranged, CMB or any of their alternates, iteratives and all. */
export function attackRollSpec(c, mode, cs = null) {
  const m = MODE_ROLLS[mode];
  if (!m || !c?.attack) return null;
  const delta = cs?.delta?.[mode] || 0;
  const total = (attackModeTotal(c, mode) ?? 0) + delta;
  const slot = c.attack.modes?.[mode] || {};
  const abilities = [slot.stat1, slot.stat2].filter(Boolean).join(' + ');
  return {
    name: titled(c, m.alt && abilities ? `${m.title} (${abilities})` : m.title),
    rolls: m.iteratives
      ? iterativeRolls(c.attack.bab, total, m.row)
      : [{ label: m.row, formula: d20(total) }],
    notes: conditionNote(cs, delta),
  };
}

/** Initiative. Dexterity and the bonus, as the Overview reads it. */
export function initiativeRollSpec(c, cs = null) {
  if (!c?.hp) return null;
  const delta = cs?.delta?.initiative || 0;
  return {
    name: titled(c, 'Initiative'),
    rolls: [{ label: 'Initiative', formula: d20((Number(c.hp.initiative) || 0) + delta) }],
    notes: conditionNote(cs, delta),
  };
}

/**
 * A concentration check, from either place the sheet keeps one.
 *
 * `magic` is the Spheres side's global figure (caster level + the best casting
 * modifier); `vancian:<i>` is one prepared-casting class's own, which is a
 * typed number because a class can have any number of things adding to it.
 *
 * No condition moves this one: shaken and its kin are worded at attack rolls,
 * saves, skill checks and ability checks, and a concentration check is none of
 * those. So the number is the number.
 */
export function concentrationRollSpec(c, ref) {
  const [which, index] = String(ref ?? '').split(':');
  if (which === 'magic') {
    const m = c?.training?.magic;
    if (!m) return null;
    return {
      name: titled(c, 'Concentration'),
      rolls: [{ label: 'Concentration', formula: d20(m.concentration) }],
      notes: [{ label: 'Caster level', text: `${m.globalCL ?? 0}` }],
    };
  }
  if (which === 'vancian') {
    const k = c?.vancian?.classes?.[Number(index)];
    if (!k) return null;
    const name = String(k.name ?? '').trim();
    return {
      name: titled(c, name ? `${name} concentration` : 'Concentration'),
      rolls: [{ label: 'Concentration', formula: d20(k.concentration) }],
      notes: k.casterLevel ? [{ label: 'Caster level', text: `${k.casterLevel}` }] : [],
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Companions
 * ------------------------------------------------------------------ */

const COMPANION_SAVE_LABELS = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };

/**
 * Whose companion, and which one.
 *
 * A companion acts on its own initiative and its own sheet, so it is the actor
 * in chat -- but a table with three summoners in it needs to know whose eidolon
 * just bit something, and the block's own name is the first thing to go unfilled.
 */
function companionTitle(c, kind, b, what) {
  const own = String(b?.name ?? '').trim() || COMPANION_LABELS[kind] || kind;
  const master = String(c?.identity?.name ?? '').trim();
  return `${master ? `${master}’s ` : ''}${own} — ${what}`;
}

/** "19-20/×3" and its kin, as a range and a multiplier. */
function parseCrit(text) {
  const s = String(text ?? '');
  const range = s.match(/(\d+)\s*[-–]\s*20/);
  const mult = s.match(/[x×*]\s*(\d+)/i);
  return {
    range: range ? Math.min(20, Math.max(2, Number(range[1]))) : 20,
    mult: mult ? Math.max(2, Number(mult[1])) : 2,
  };
}

/**
 * Is this damage text something to roll, or something to read?
 *
 * A companion's damage column is free text -- "1d6+7" on one row and "1d6 plus
 * grab" on the next -- and a parser that took the second for the first would
 * hand over 1d6 and drop the rest without saying so.
 */
function rollableDice(text) {
  const s = String(text ?? '').replace(/\([^)]*\)/g, ' ').trim();
  if (!s) return false;
  return /^[+-]?\s*(\d+\s*d\s*\d+|\d+)(\s*[+-]\s*(\d+\s*d\s*\d+|\d+))*$/i.test(s);
}

/** One natural attack: to hit, damage as written, and what a threat does. */
function companionAttackSpec(named, a) {
  const { range, mult } = parseCrit(a.crit);
  const rolls = [{ label: 'Attack', formula: d20(a.toHit, { critRange: range }) }];
  const notes = [];
  // What a rule or an item adds to this attack's damage. The column stays the
  // free text it is; the bonus goes on the flat part of the roll, and is
  // multiplied on a critical exactly as any other flat damage is.
  const bonus = Math.trunc(Number(a.damageBonus) || 0);
  if (rollableDice(a.damage)) {
    const dmg = parseDiceExpr(a.damage, null);
    const flat = dmg.flat + bonus;
    rolls.push({ label: 'Damage', formula: damageFormula(dmg.dice, flat) });
    rolls.push({ label: 'Crit confirm', formula: d20(a.toHit, { critRange: range }) });
    rolls.push({
      label: `Crit damage (x${mult})`,
      formula: damageFormula(scaleDice(dmg.dice, mult), flat * mult),
    });
  } else if (String(a.damage ?? '').trim()) {
    notes.push({ label: 'Damage', text: `${a.damage}${bonus ? `, ${fmt(bonus)}` : ''}` });
  } else if (bonus) {
    notes.push({ label: 'Damage', text: fmt(bonus) });
  }
  if (range < 20 || mult !== 2) {
    notes.push({ label: 'Threat', text: `${range < 20 ? `${range}-20` : '20'}/x${mult}` });
  }
  if (String(a.damageType ?? '').trim()) notes.push({ label: 'Damage type', text: a.damageType });
  if (a.primaryResolved === false) {
    notes.push({ label: 'Secondary', text: 'the penalty is already in the to-hit' });
  }
  if (String(a.qualities ?? '').trim()) notes.push({ label: 'On a hit', text: a.qualities });
  return { name: named(String(a.type ?? '').trim() || 'Attack'), rolls, notes };
}

/**
 * The familiar, the animal companion or the eidolon.
 *
 * `ref` says which of its rows: `init`, `save:will`, `ability:str`, `skill:3`,
 * `attack:0`. The master's conditions are the master's, so nothing here takes a
 * condition state -- a shaken summoner does not make their eidolon shaken.
 */
export function companionRollSpec(c, kind, ref) {
  const b = c?.[kind];
  if (!b) return null;
  const k = b.calc || {};
  const [what, arg] = String(ref ?? '').split(':');
  const named = (label) => companionTitle(c, kind, b, label);

  switch (what) {
    case 'init':
      return {
        name: named('Initiative'),
        rolls: [{ label: 'Initiative', formula: d20(k.initiative) }],
        notes: [],
      };
    // A companion that trips or grapples rolls the same d20 its master does.
    case 'cmb':
      return {
        name: named('Combat maneuver'),
        rolls: [{ label: 'Combat maneuver', formula: d20(k.cmb ?? 0) }],
        notes: [{ label: 'CMD', text: String(k.cmd ?? 10) }],
      };
    case 'save': {
      const label = COMPANION_SAVE_LABELS[arg];
      if (!label) return null;
      return {
        name: named(`${label} save`),
        rolls: [{ label: 'Saving throw', formula: d20(k.saves?.[arg]?.total) }],
        notes: [],
      };
    }
    case 'ability': {
      if (!ABILITIES.includes(arg)) return null;
      return {
        name: named(`${ABILITY_LABELS[arg]} check`),
        rolls: [{ label: 'Ability check', formula: d20(k.scores?.[arg]?.mod) }],
        notes: [],
      };
    }
    case 'skill': {
      const s = b.skills?.[Number(arg)];
      if (!s) return null;
      const notes = s.trained && !(Number(s.effectiveRanks) > 0)
        ? [{ label: 'Trained only', text: 'no ranks in this skill' }] : [];
      return {
        name: named(skillLabel(s.name, s.spec) || 'Skill'),
        rolls: [{ label: 'Skill check', formula: d20(s.total) }],
        notes,
      };
    }
    case 'attack': {
      const a = b.attacks?.[Number(arg)];
      return a ? companionAttackSpec(named, a) : null;
    }
    default:
      return null;
  }
}

/** One skill row, by its index in the character's skill list. */
export function skillRollSpec(c, index, cs = null) {
  const s = c?.skills?.[index];
  if (!s) return null;
  // A skill moves with its own ability as well as with the flat penalty a
  // condition puts on skill checks, so both halves are summed here.
  const primary = (s.abilities || [])[0];
  const delta = (cs ? statModDelta(cs.deltas || {}, primary, null) : 0)
    + (cs?.delta?.skills || 0);
  const notes = [];
  if (String(s.situational ?? '').trim()) notes.push({ label: 'Note', text: s.situational });
  if (s.requiresTraining && !(Number(s.totalRanks) > 0)) {
    notes.push({ label: 'Trained only', text: 'no ranks in this skill' });
  }
  return {
    name: titled(c, skillLabel(s.name, s.spec) || 'Skill'),
    rolls: [{ label: 'Skill check', formula: d20((Number(s.bonus) || 0) + delta) }],
    notes: [...notes, ...conditionNote(cs, delta)],
  };
}

/** Which condition slot a weapon's attack type is penalised through. */
export const WEAPON_MODE_KEYS = {
  Melee: 'melee', 'Alt Melee': 'altMelee', Ranged: 'ranged',
  'Alt Ranged': 'altRanged', CMB: 'cmb', 'Alt CMB': 'altCmb',
};
/** ... and whether that slot iterates. A maneuver does not. */
const iterates = (modeKey) => !!MODE_ROLLS[modeKey]?.iteratives;

/**
 * A weapon: the attack, the damage, and what a threat turns into.
 *
 * The crit line is the part worth having written down. Pathfinder multiplies
 * the weapon's own damage and leaves riders alone, and the sheet already sorts
 * a weapon's special properties into those pools -- so the crit damage here is
 * base x mult, plus the untagged [[...]] riders once, plus [[... Crit]] damage
 * multiplied, plus the bonus crit damage column once.
 */
export function weaponRollSpec(c, index, cs = null) {
  const w = c?.equipment?.weapons?.[index];
  if (!w) return null;
  const { calc } = w;
  const modeKey = WEAPON_MODE_KEYS[w.attackType];
  const atkDelta = (modeKey && cs?.delta?.[modeKey]) || 0;
  const dmgDelta = cs?.delta?.damage || 0;
  const name = titled(c, String(w.name ?? '').trim() || 'Weapon');
  const critRange = Math.floor(Number(w.critRange) || 20);

  // A weapon the model has not costed yet -- a row just added -- still has an
  // attack total, so it can still be rolled, just without the damage lines.
  if (!calc) {
    return {
      name,
      rolls: [{
        label: 'Attack',
        formula: d20((Number(w.attackTotal) || 0) + atkDelta, { critRange }),
      }],
      notes: conditionNote(cs, atkDelta),
    };
  }

  // A size buff steps the weapon's own dice along the official chart; the
  // token riders (sneak, flaming) keep their dice, exactly as the rules leave
  // them alone.
  const grow = cs?.sizeSteps || 0;
  const sized = grow
    ? stepDiceMap(calc.baseDmgDice || {}, grow, c.identity?.size)
    : { dice: calc.baseDmgDice || {}, flat: 0 };

  const atkOpts = { dice: calc.tokAtk?.dice, critRange };
  const rolls = iterates(modeKey)
    ? iterativeRolls(c.attack?.bab, calc.totalAtk + atkDelta, 'Attack', atkOpts)
    : [{ label: 'Attack', formula: d20(calc.totalAtk + atkDelta, atkOpts) }];
  rolls.push({
    label: 'Damage',
    formula: damageFormula(
      addDice(addDice(sized.dice, calc.tokDmg?.dice || {}), calc.tokMultDmg?.dice || {}),
      calc.totalDmgFlat + dmgDelta + sized.flat,
    ),
  });

  const mult = Math.max(2, Math.floor(Number(calc.critMultNum) || 2));
  // The bonus-crit-damage column is the part of `critExtra` that is not the
  // [[... Crit]] tokens, and it is the only crit pool that is never multiplied.
  const bcd = {
    dice: subDice(calc.critExtra?.dice || {}, calc.critTagged?.dice || {}),
    flat: (calc.critExtra?.flat || 0) - (calc.critTagged?.flat || 0),
  };
  // Everything the multiplier takes, gathered before it is applied -- the same
  // `multBase` the card prints as `(12d8+26)×4`: the weapon's own damage, the
  // ability, enhancement and Misc dmg, and any [[... Mult]] token.
  const multBase = {
    dice: addDice(sized.dice, calc.tokMultDmg?.dice || {}),
    flat: (calc.baseDmgFlat || 0) + dmgDelta + sized.flat + (calc.tokMultDmg?.flat || 0),
  };
  const critDice = addDice(
    addDice(scaleDice(multBase.dice, mult), calc.tokDmg?.dice || {}),
    addDice(scaleDice(calc.critTagged?.dice || {}, mult), bcd.dice),
  );
  const critFlat = multBase.flat * mult
    + (calc.tokDmg?.flat || 0)
    + (calc.critTagged?.flat || 0) * mult
    + bcd.flat;
  rolls.push({
    label: 'Crit confirm',
    formula: d20((calc.confirmTotal || 0) + atkDelta, { dice: calc.critAtk?.dice, critRange }),
  });
  rolls.push({ label: `Crit damage (x${mult})`, formula: damageFormula(critDice, critFlat) });

  const notes = [];
  if (critRange < 20 || mult !== 2) {
    notes.push({ label: 'Threat', text: `${critRange < 20 ? `${critRange}-20` : '20'}/x${mult}` });
  }
  if (String(w.damageType ?? '').trim()) notes.push({ label: 'Damage type', text: w.damageType });
  // A parenthesised aside in the Dice field ("4d6 (8d6)") is not rollable, so
  // it is not in the formula -- but it is on the sheet, and dropping it without
  // saying so would quietly hand over the smaller of two numbers.
  if (calc.notes?.length) notes.push({ label: 'Dice', text: `${w.diceResolved ?? ''}`.trim() });
  return { name, rolls, notes: [...notes, ...conditionNote(cs, atkDelta || dmgDelta)] };
}

/**
 * The dispatcher the view uses: one `kind|ref` pair per button.
 *
 * `kind` is split off at the first bar, so a ref is free to carry its own
 * parts after it -- `eidolon|attack:0`, `concentration|vancian:1`.
 */
export function rollSpec(c, kind, ref, cs = null) {
  switch (kind) {
    case 'ability': return abilityRollSpec(c, ref, cs);
    case 'save': return saveRollSpec(c, ref, cs);
    case 'mode': return attackRollSpec(c, ref, cs);
    case 'skill': return skillRollSpec(c, Number(ref), cs);
    case 'weapon': return weaponRollSpec(c, Number(ref), cs);
    case 'initiative': return initiativeRollSpec(c, cs);
    case 'concentration': return concentrationRollSpec(c, ref);
    case 'familiar':
    case 'animalCompanion':
    case 'eidolon':
    case 'conjured':
      return companionRollSpec(c, kind, ref);
    default: return null;
  }
}

/** Spec and text in one call, for a caller that only wants the string. */
export function roll20Text(c, kind, ref, cs = null, format = DEFAULT_ROLL_FORMAT) {
  return rollText(rollSpec(c, kind, ref, cs), format);
}
