import { evaluateFormula } from '../formula.js';
import { forwarded } from './scope.js';
import { maneuverDetails } from './subsystems/maneuvers.js';

export const ACTION_TYPES = [['standard', 'Standard'], ['move', 'Movement'], ['swift', 'Swift'],
  ['immediate', 'Immediate'], ['aoo', 'Attacks of opportunity'], ['full', 'Full round'], ['free', 'Free']];
export const ACTION_POOLS = ACTION_TYPES.slice(0, 5);
const count = v => Math.max(0, Math.floor(Number(v) || 0));

export function sessionState(model) {
  const raw = model.data.session || {};
  return { turn: 1, onTurn: true, spent: {}, maxima: {}, cards: [], folded: {}, pendingSwift: 0,
    ...raw, spent: { ...raw.spent }, maxima: { ...raw.maxima },
    cards: Array.isArray(raw.cards) ? raw.cards : [], folded: { ...raw.folded } };
}

export function actionBudget(model, state = sessionState(model)) {
  const out = {};
  const scope = model.scope();
  for (const [key] of ACTION_POOLS) {
    let max = 0, error = '';
    try {
      const result = Number(evaluateFormula(String(state.maxima[key] ?? '1'), scope));
      if (!Number.isFinite(result)) throw new Error('Enter a finite number or formula');
      max = count(result + forwarded(model, `actions.${key}`));
    } catch (e) { error = e.message; }
    out[key] = { max, remaining: Math.max(0, max - count(state.spent[key])), error };
  }
  if (state.onTurn) out.immediate.remaining = Math.min(out.immediate.remaining, out.swift.remaining);
  return out;
}

// Build a transaction before touching either actions or resources. A failed Use
// must never charge just one of its costs.
export function planAction(model, card, state = sessionState(model), budget = actionBudget(model, state)) {
  const next = { ...state, spent: { ...state.spent } };
  const type = card.type;
  const take = key => {
    if (budget[key].error) throw new Error(`${key}: ${budget[key].error}`);
    if (!budget[key].remaining) throw new Error(`No ${ACTION_TYPES.find(x => x[0] === key)[1].toLowerCase()} remaining`);
    next.spent[key] = count(next.spent[key]) + 1;
  };
  try {
    if (card.kind === 'choice') throw new Error('Select an option from the choice group');
    if (!ACTION_TYPES.some(([k]) => k === type)) throw new Error('Choose an action type');
    if (card.source && !sessionShortcuts(model).some(s => s.key === card.source)) throw new Error('The linked source is missing or renamed');
    if (!state.onTurn && !['immediate', 'aoo', 'free'].includes(type)) throw new Error('Start your turn to use this action');
    if (type === 'full') { take('standard'); take('move'); }
    else if (type === 'move') take(budget.move.remaining ? 'move' : 'standard');
    else if (type === 'immediate') {
      take('immediate');
      if (state.onTurn) take('swift');
      else next.pendingSwift = count(state.pendingSwift) + 1;
    } else if (type !== 'free') take(type);
    let tracker = null, amount = 0;
    if (card.resource) {
      tracker = model.trackers.find(t => t.id === card.resource);
      if (!tracker) throw new Error('The linked resource no longer exists');
      amount = Number(evaluateFormula(String(card.cost ?? '1'), model.scope()));
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Resource cost must be zero or a positive number');
      if (tracker.error || Number(tracker.current) + amount > Number(tracker.max)) throw new Error(`Not enough ${tracker.name}`);
    }
    return { next, tracker, amount, error: '' };
  } catch (e) { return { error: e.message }; }
}

export function useSessionAction(model, card) {
  const plan = planAction(model, card);
  if (plan.error) return plan.error;
  model.markUndo(`Used ${card.title || card.type}`);
  if (plan.tracker) plan.tracker.current = Number(plan.tracker.current) + plan.amount;
  model.set('session', plan.next);
  return '';
}

export function advanceTurn(model, start) {
  const state = sessionState(model);
  model.markUndo(start ? 'Started next turn' : 'Ended turn');
  if (start) {
    state.turn = count(state.turn) + 1;
    state.spent = { swift: count(state.pendingSwift), immediate: count(state.pendingSwift) };
    state.pendingSwift = 0;
    state.onTurn = true;
  } else {
    if (!state.onTurn) return;
    state.onTurn = false;
    // An immediate taken on your turn uses that turn's swift. After the
    // turn, a new immediate borrows from the next one instead.
    state.spent.immediate = count(state.pendingSwift);
  }
  model.set('session', state);
}

// Shortcuts resolve by name, not position, so rearranging a sheet cannot point
// an existing card at a different attack. Duplicate names require a custom card.
export function sessionShortcuts(model) {
  const out = [];
  const add = (kind, name, note, extra = {}) => {
    if (typeof name !== 'string' || !name.trim()) return;
    out.push({ key: `${kind}:${name}`, title: name, note: typeof note === 'string' ? note : '', kind, ...extra });
  };
  (model.data.equipment?.weapons || []).forEach((w, i) => add('attack', w.name, w.notes || w.note, { index: i, range: w.range }));
  // Named feature entries across optional systems share this small shape.
  const walk = (value, path = '', depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 7) return;
    if (value.name || value.talent) add('ability', value.name || value.talent, value.text || value.description || value.note || value.notes);
    for (const [key, v] of Object.entries(value)) if (typeof v === 'object') walk(v, `${path}.${key}`, depth + 1);
  };
  for (const key of ['featGroups', 'grantedFeats', 'akashic', 'templates', 'training']) walk(model.data[key]);
  for (const discipline of model.data.maneuvers?.disciplines || []) {
    for (const name of discipline.known || []) {
      const entry = maneuverDetails(discipline, name);
      const note = [entry.action, entry.range, entry.target, entry.duration, entry.text].filter(Boolean).join('\n');
      add('maneuver', name, note || 'See the Maneuvers tab for the full rules.', { range: entry.range, targets: entry.target, duration: entry.duration, save: [entry.save, entry.dc && `DC ${entry.dc}`].filter(Boolean).join(' · ') });
    }
  }
  const counts = new Map();
  out.forEach(x => counts.set(x.key, (counts.get(x.key) || 0) + 1));
  return out.filter(x => counts.get(x.key) === 1);
}
