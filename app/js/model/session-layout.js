import { ACTION_TYPES, sessionState } from './session.js';

// IDs are assigned on the first layout edit, not on render. Old saves stay clean.
export function editableSession(model) {
  const state = structuredClone(sessionState(model));
  state.cards.forEach(card => { card.id ||= crypto.randomUUID(); });
  return state;
}

export function choiceParent(state, card) {
  return state.cards.find(g => g.kind === 'choice' && g.id === card.groupId && g.type === card.type);
}

function commitLayout(model, state, before, label) {
  // Older folds address array positions. Preserve their card identity on moves.
  for (const key of Object.keys(state.folded)) if (/^(card|editor):\d+$/.test(key)) delete state.folded[key];
  state.cards.forEach((card, i) => {
    const old = before.cards.findIndex(c => c.id === card.id);
    if (old < 0) return;
    for (const prefix of ['card', 'editor']) {
      const value = before.folded[`${prefix}:${old}`];
      if (value !== undefined) state.folded[`${prefix}:${i}`] = value;
    }
  });
  model.markUndo(label);
  model.set('session', state);
}

export function moveSessionCard(model, index, { type, groupId = '', target = null, after = false } = {}) {
  const state = editableSession(model), before = structuredClone(state), card = state.cards[index];
  if (!card || !ACTION_TYPES.some(([key]) => key === type)) return false;
  const group = groupId && state.cards.find(g => g.id === groupId && g.kind === 'choice' && g.type === type);
  if (groupId && (!group || card.kind === 'choice')) return false;
  const anchor = target === null ? null : state.cards[target];
  if (anchor === card) return false;
  card.type = type;
  card.groupId = group ? group.id : '';
  state.folded[type] = false;
  if (card.kind === 'choice') state.cards.filter(c => c.groupId === card.id).forEach(c => { c.type = type; });
  if (anchor) {
    state.cards.splice(index, 1);
    state.cards.splice(state.cards.indexOf(anchor) + (after ? 1 : 0), 0, card);
  } else {
    state.cards.splice(index, 1);
    state.cards.push(card);
  }
  commitLayout(model, state, before, 'Rearranged session options');
  return true;
}

export function removeSessionCard(model, index) {
  const state = editableSession(model), before = structuredClone(state), card = state.cards[index];
  if (!card) return;
  if (card.kind === 'choice') state.cards.filter(c => c.groupId === card.id).forEach(c => { c.groupId = ''; });
  state.cards.splice(index, 1);
  commitLayout(model, state, before, card.kind === 'choice' ? 'Ungrouped session options' : 'Removed session option');
}
