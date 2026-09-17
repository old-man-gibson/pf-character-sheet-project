import { evaluateFormula } from '../formula.js';
import { diceString } from '../rules.js';
import { d20, weaponRollSpec, queryText } from '../roll20.js';
import { sessionShortcuts, sessionState } from './session.js';
import { effectiveAction } from './action-features.js';

/** Resolve user rolls without executing dice or allowing chat commands. */
export function sessionRolls(model, card, answers = null) {
  card = effectiveAction(model,card);
  const source = card.source ? sessionShortcuts(model).find(s => s.key === card.source) : null;
  const inherited = source?.kind === 'attack'
    ? weaponRollSpec(model.data, source.index, model.conditionState, answers, card.type !== 'full') : null;
  const scope = model.scope();
  const adjusted = model.conditionState?.adjusted;
  if (adjusted) scope.attack = { ...scope.attack, melee: adjusted.melee, ranged: adjusted.ranged, cmb: adjusted.cmb };
  const number = text => {
    const n = Number(evaluateFormula(String(text).replace(/^\s*=\s*/, ''), scope));
    if (!Number.isFinite(n)) throw new Error('Formula must produce a finite number');
    return n;
  };
  const expand = text => String(text).replace(/\{([^{}]+)\}/g, (_, expr) => String(number(expr)));
  let rolls = [...(inherited?.rolls || [])], errors = [];
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
      const expanded = expand(damage).replace(/\s+/g, '');
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
      rolls.push({ label: 'Damage', formula: diceString(dice, Math.floor(number(scalar))) });
    } catch (e) { errors.push(`Damage: ${e.message}`); }
  }
  const spec = { name: `${model.data.identity.name} — ${card.title || source?.title || 'Action'}`,
    rolls, notes: (inherited?.notes || []).filter(n => !attack || n.label !== 'Threat'), queries: inherited?.queries || [] };
  const attackText = rolls.filter(r => r.label.startsWith('Attack')).map(r => {
    const bonus = r.formula.replace(/^1d20(?:cs>\d+)?/, '');
    return bonus || '+0';
  }).join(' / ');
  return { spec, errors, attack: attackText, damage: rolls.find(r => r.label === 'Damage')?.formula || '',
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
  spec.queries = spec.queries.filter(q => spec.rolls.some(r => r.formula.includes(queryText(q))));
  return spec.rolls.length ? spec : null;
}
