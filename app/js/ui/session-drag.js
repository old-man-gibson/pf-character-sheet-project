import { sessionState } from '../model/session.js';
import { choiceParent, moveSessionCard } from '../model/session-layout.js';
import { bindDrag, half } from './drag.js';

/**
 * Dragging a session card: among its neighbours, into another action type,
 * or into a choice group. The gesture is the sheet's shared one (ui/drag.js);
 * what is here is only where a card may land.
 */
export function bindSessionDrag(root, model, render) {
  const board = root.querySelector('.session-board');
  if (!board) return;
  bindDrag({
    handles: board.querySelectorAll('[data-session-drag]'),
    item: (handle) => handle.closest('[data-session-drop]') || handle,
    source: (_, handle) => Number(handle.dataset.sessionDrag),
    target: (under, point, dragging) => {
      const el = under.closest('[data-session-group-drop],[data-session-drop],[data-session-type-drop]');
      if (!el || !board.contains(el)) return null;
      const state = sessionState(model);
      if (el.dataset.sessionGroupDrop !== undefined) {
        const group = state.cards[Number(el.dataset.sessionGroupDrop)];
        if (state.cards[dragging]?.kind === 'choice') return null;
        return { el, cls: 'session-drop-inside', options: { type: group.type, groupId: group.id } };
      }
      if (el.dataset.sessionDrop !== undefined) {
        const index = Number(el.dataset.sessionDrop), card = state.cards[index];
        if (index === dragging || (state.cards[dragging]?.kind === 'choice' && choiceParent(state, card))) return null;
        const after = half(el, point);
        return {
          el, cls: after ? 'session-drop-after' : 'session-drop-before',
          options: { type: card.type, groupId: choiceParent(state, card)?.id || '', target: index, after },
        };
      }
      return { el, cls: 'session-drop-inside', options: { type: el.dataset.sessionTypeDrop } };
    },
    drop: (dragging, t) => { moveSessionCard(model, dragging, t.options); render(); },
    onStart: () => board.classList.add('session-dragging'),
    onEnd: () => board.classList.remove('session-dragging'),
  });
}
