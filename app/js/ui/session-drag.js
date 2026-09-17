import { sessionState } from '../model/session.js';
import { choiceParent, moveSessionCard } from '../model/session-layout.js';

export function bindSessionDrag(root, model, render) {
  const board = root.querySelector('.session-board');
  if (!board) return;
  let dragging = null;
  let pointer = null;
  const clear = () => board.querySelectorAll('.session-drop-before,.session-drop-after,.session-drop-inside')
    .forEach(el => el.classList.remove('session-drop-before','session-drop-after','session-drop-inside'));
  const destination = event => {
    const el = event.target.closest('[data-session-group-drop],[data-session-drop],[data-session-type-drop]');
    if (!el || dragging === null) return null;
    const state = sessionState(model);
    if (el.dataset.sessionGroupDrop !== undefined) {
      const group = state.cards[Number(el.dataset.sessionGroupDrop)];
      if (state.cards[dragging]?.kind === 'choice') return null;
      return {el, options:{type:group.type,groupId:group.id}, css:'session-drop-inside'};
    }
    if (el.dataset.sessionDrop !== undefined) {
      const index = Number(el.dataset.sessionDrop), card = state.cards[index];
      if (index === dragging || (state.cards[dragging]?.kind === 'choice' && choiceParent(state,card))) return null;
      const rect = el.getBoundingClientRect(), after = event.clientY > rect.top + rect.height / 2;
      return {el, options:{type:card.type,groupId:choiceParent(state,card)?.id || '',target:index,after},css:after?'session-drop-after':'session-drop-before'};
    }
    return {el,options:{type:el.dataset.sessionTypeDrop},css:'session-drop-inside'};
  };
  // Pointer capture makes the handle work with mouse, pen and touch, including
  // embedded browsers that do not start native HTML drag from a button.
  board.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-session-drag]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    pointer = {id:event.pointerId,index:Number(handle.dataset.sessionDrag),x:event.clientX,y:event.clientY};
    handle.setPointerCapture(event.pointerId);
  });
  const pointed = event => destination({target:root.elementFromPoint(event.clientX,event.clientY) || board,clientY:event.clientY});
  board.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (dragging === null && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y) < 6) return;
    dragging = pointer.index;
    board.classList.add('session-dragging');
    clear();
    const dest = pointed(event);
    if (dest) dest.el.classList.add(dest.css);
  });
  board.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dest = dragging === null ? null : pointed(event);
    const index = dragging;
    pointer = null; dragging = null; clear(); board.classList.remove('session-dragging');
    if (dest) { moveSessionCard(model,index,dest.options); render(); }
  });
  board.addEventListener('pointercancel', () => { pointer=null; dragging=null; clear(); board.classList.remove('session-dragging'); });
  board.addEventListener('dragstart', event => {
    const handle = event.target.closest('[data-session-drag]');
    if (!handle) return;
    dragging = Number(handle.dataset.sessionDrag);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'Session option');
    board.classList.add('session-dragging');
  });
  board.addEventListener('dragover', event => {
    clear();
    const dest = destination(event);
    if (!dest) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; dest.el.classList.add(dest.css);
  });
  board.addEventListener('drop', event => {
    const dest = destination(event);
    if (!dest) return;
    event.preventDefault(); event.stopPropagation();
    moveSessionCard(model, dragging, dest.options);
    dragging = null; clear(); board.classList.remove('session-dragging'); render();
  });
  board.addEventListener('dragend', () => { dragging = null; clear(); board.classList.remove('session-dragging'); });
}
