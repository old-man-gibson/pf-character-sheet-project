import { evaluateFormula } from '../formula.js';
import { diceString } from '../rules.js';
import { d20, weaponRollSpec, queryText, shiftD20 as shiftAttack } from '../roll20.js';
import { sessionShortcuts, sessionState } from './session.js';
import { effectiveAction } from './action-features.js';

/** "4d6", "2d8+3", "1d6 + 1d4 - 1": a value that is dice text rather than a number. */
const DICE_TEXT = /^\s*[+-]?\d*d\d+(?:\s*[+-]\s*(?:\d*d\d+|\d+))*\s*$/i;

/** Split on commas that are not inside parentheses, so "max(0, 4 - x)" stays whole. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    else if (text[i] === ',' && !depth) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** "2d6 + 1d8 - 3" (already expanded) as a dice map and the flat part its formula leaves. */
function parseDamage(expanded, number) {
  expanded = expanded.replace(/\s+/g, '');
  const dice = {};
  const scalar = expanded.replace(/(\d*)d(\d+)/gi, (match, n, sides, offset) => {
    const before = expanded.slice(0, offset), after = expanded.slice(offset + match.length);
    if ((before && !/[+-]$/.test(before)) || (after && !/^[+-]/.test(after))) throw new Error('Add dice with + or −; put calculated dice counts in braces');
    const count = Number(n || 1), die = Number(sides);
    if (die < 2 || !Number.isSafeInteger(die) || !Number.isSafeInteger(count)) throw new Error('Invalid dice');
    const signs = before.match(/[+-]+$/)?.[0] || '';
    dice[die] = (dice[die] || 0) + ((signs.match(/-/g) || []).length % 2 ? -count : count);
    return '0';
  });
  return { dice, flat: Math.floor(number(scalar)) };
}

/** Resolve user rolls without executing dice or allowing chat commands. */
export function sessionRolls(model, card, answers = null) {
  card = effectiveAction(model,card);
  const source = card.source ? sessionShortcuts(model).find(s => s.key === card.source) : null;
  // "Highest bonus only" is a flurry's rule: no attacks at a reduced base
  // attack bonus, so a full-round card starts from the single attack too.
  const topOnly = card.attackSet === 'top';
  const inherited = source?.kind === 'attack'
    ? weaponRollSpec(model.data, source.index, model.conditionState, answers, card.type !== 'full' || topOnly) : null;
  const scope = model.scope();
  const adjusted = model.conditionState?.adjusted;
  if (adjusted) scope.attack = { ...scope.attack, melee: adjusted.melee, ranged: adjusted.ranged, cmb: adjusted.cmb };
  const value = text => evaluateFormula(String(text).replace(/^\s*=\s*/, ''), scope);
  const number = text => {
    const v = value(text);
    const n = Number(v);
    if (!Number.isFinite(n)) {
      if (typeof v === 'string' && v.trim()) throw new Error(`${String(text).trim()} is text (“${v}”), not a number${DICE_TEXT.test(v) ? '; dice values go in Damage roll or Extra damage' : ''}`);
      throw new Error('Formula must produce a finite number');
    }
    return n;
  };
  // A braced value that is itself dice ("4d6" from kinetic.fist.simple) is
  // spliced in as written; anything else must be a number.
  const expand = text => String(text).replace(/\{([^{}]+)\}/g, (_, expr) => {
    const v = value(expr);
    return typeof v === 'string' && DICE_TEXT.test(v) ? v.trim() : String(number(expr));
  });
  // The same for a bare name in a damage expression -- "2d6 + kinetic.fist.simple"
  // -- so a dice value needs no braces there. Names that are numbers, unknown
  // or functions are left for the formula to handle.
  const expandDice = text => expand(text).replace(/(?<![\w.])[A-Za-z_][\w.]*(?![\w.(])/g, name => {
    try { const v = value(name); return typeof v === 'string' && DICE_TEXT.test(v) ? v.trim() : name; }
    catch { return name; }
  });
  let rolls = (inherited?.rolls || []).map(r => ({ ...r })), errors = [];
  const attack = String(card.attackFormula ?? '').trim();
  const damage = String(card.damageFormula ?? '').trim();
  if (attack || damage) rolls = rolls.filter(r => !r.label.startsWith('Crit'));
  if (attack) {
    rolls = rolls.filter(r => !r.label.startsWith('Attack'));
    try { rolls.unshift({ label: 'Attack', formula: d20(number(expand(attack))) }); }
    catch (e) { errors.push(`Attack: ${e.message}`); }
  }
  if (damage) {
    rolls = rolls.filter(r => r.label !== 'Damage');
    try {
      const { dice, flat } = parseDamage(expandDice(damage), number);
      rolls.push({ label: 'Damage', formula: diceString(dice, flat) });
    } catch (e) { errors.push(`Damage: ${e.message}`); }
  }
  // The multi-attack fields work on whatever the card has by now -- the linked
  // weapon's rolls or the custom ones -- so a flurry, Haste or a veil's extra
  // arms never mean retyping the weapon. Extra damage is a rider: it joins the
  // Damage line, and the crit line once, unmultiplied -- the same rule the
  // weapon's own riders follow, so "crit minus damage" stays the weapon's crit.
  const extraDamage = String(card.extraDamage ?? '').trim();
  if (extraDamage) {
    try {
      const { dice, flat } = parseDamage(expandDice(extraDamage), number);
      const piece = diceString(dice, flat);
      const target = rolls.find(r => r.label === 'Damage');
      if (!target) rolls.push({ label: 'Damage', formula: piece });
      else if (piece !== '0') {
        for (const r of rolls) {
          if (r.label === 'Damage' || r.label.startsWith('Crit damage')) r.formula = `${r.formula}${piece.startsWith('-') ? '' : '+'}${piece}`;
        }
      }
    } catch (e) { errors.push(`Extra damage: ${e.message}`); }
  }
  const modifier = String(card.attackModifier ?? '').trim();
  if (modifier) {
    try {
      const by = Math.round(number(expand(modifier)));
      rolls = rolls.map(r => r.label.startsWith('Attack') || r.label === 'Crit confirm' ? { ...r, formula: shiftAttack(r.formula, by) } : r);
    } catch (e) { errors.push(`Attack modifier: ${e.message}`); }
  }
  // "3", or groups with their own penalty, "1 @ -2, 2 @ -6": each group is a
  // count and an optional modifier, so off hands, grown arms and a flurry's
  // extra strikes can share one card. Extras follow the highest attack and
  // land after the weapon's own iteratives.
  const extra = String(card.extraAttacks ?? '').trim();
  if (extra) {
    try {
      const first = rolls.findIndex(r => r.label.startsWith('Attack'));
      if (first < 0) throw new Error('Nothing to repeat yet — link a weapon from the picker, or fill in Attack bonus or formula (e.g. attack.melee)');
      const copies = [];
      for (const group of splitTopLevel(expand(extra))) {
        if (!group.trim()) continue;
        const [countText, modText = '0', ...more] = group.split('@');
        if (more.length) throw new Error('Write each group as a count, or count @ modifier');
        const n = Math.floor(number(countText));
        if (n < 0 || n > 20) throw new Error('Each count must be between 0 and 20');
        const by = Math.round(number(modText));
        for (let k = 0; k < n; k++) copies.push({ ...rolls[first], formula: shiftAttack(rolls[first].formula, by) });
      }
      if (copies.length > 20) throw new Error('At most 20 extra attacks');
      const last = rolls.length - 1 - [...rolls].reverse().findIndex(r => r.label.startsWith('Attack'));
      rolls.splice(last + 1, 0, ...copies);
    } catch (e) { errors.push(`Extra attacks: ${e.message}`); }
  }
  const attacks = rolls.filter(r => r.label.startsWith('Attack'));
  attacks.forEach((r, i) => { r.label = attacks.length > 1 ? `Attack ${i + 1}` : 'Attack'; });
  const spec = { name: `${model.data.identity.name} — ${card.title || source?.title || 'Action'}`,
    rolls, notes: (inherited?.notes || []).filter(n => !attack || n.label !== 'Threat'), queries: inherited?.queries || [] };
  const bonuses = attacks.map(r => r.formula.replace(/^1d20(?:cs>\d+)?/, '') || '+0');
  const attackText = bonuses.join(' / ');
  // The closed card reads "16 attacks · +40 ×9 · +38 ×2 · +35 · +30 · +25":
  // equal bonuses gathered, highest first, with how many there are of each.
  const counts = new Map();
  bonuses.forEach(b => counts.set(b, (counts.get(b) || 0) + 1));
  const lead = b => Number(b.match(/^[+-]\d+/)?.[0]) || 0;
  const grouped = [...counts].sort((a, b) => lead(b[0]) - lead(a[0])).map(([b, n]) => (n > 1 ? `${b} ×${n}` : b)).join(' · ');
  const attackSummary = attacks.length > 1 ? `${attacks.length} attacks · ${grouped}` : attackText;
  return { spec, errors, attack: attackText, attackSummary, attackCount: attacks.length, damage: rolls.find(r => r.label === 'Damage')?.formula || '',
    range: card.range || source?.range || '', targets: card.targets || source?.targets || '',
    save: card.save || source?.save || '', duration: card.duration || source?.duration || '' };
}

export function sessionRollSpec(model, ref, answers = null) {
  const [index, part = 'all'] = String(ref).split(':');
  const card = sessionState(model).cards[Number(index)];
  if (!card) return null;
  const result = sessionRolls(model, card, answers);
  if (result.errors.length) return null;
  const spec = result.spec;
  if (part === 'attack') spec.rolls = spec.rolls.filter(r => r.label.startsWith('Attack'));
  if (part === 'damage') spec.rolls = spec.rolls.filter(r => r.label === 'Damage');
  if (part === 'all') {
    // A routine of several attacks is rolled as attack, damage, attack, damage:
    // each hit has its own damage, and the crit lines follow once at the end.
    const attacks = spec.rolls.filter(r => r.label.startsWith('Attack'));
    const damage = spec.rolls.find(r => r.label === 'Damage');
    if (attacks.length > 1 && damage) {
      const rest = spec.rolls.filter(r => !r.label.startsWith('Attack') && r.label !== 'Damage');
      spec.rolls = [...attacks.flatMap((a, i) => [a, { label: `Damage ${i + 1}`, formula: damage.formula }]), ...rest];
    }
  }
  spec.queries = spec.queries.filter(q => spec.rolls.some(r => r.formula.includes(queryText(q))));
  return spec.rolls.length ? spec : null;
}
