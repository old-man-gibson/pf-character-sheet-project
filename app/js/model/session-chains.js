import { actionFeatures, effectiveAction } from './action-features.js';
import { sessionState, planAction } from './session.js';

export function chainTargets(model) {
  return [...actionFeatures(model).map(f => ({key:`feature:${f.id}`, title:`${f.className}: ${f.title}`})),
    ...sessionState(model).cards.filter(c=>c.id).map(c=>({key:`card:${c.id}`,title:`${c.kind==='choice'?'Group':'Option'}: ${effectiveAction(model,c).title || 'Untitled'}`}))];
}
export function followupChoices(model, pending) {
  const state = sessionState(model);
  if (pending.target.startsWith('feature:')) {
    const f = actionFeatures(model).find(f=>`feature:${f.id}`===pending.target);
    return f ? [{...f,id:`feature:${f.id}`,source:`class-feature:${f.id}`}] : [];
  }
  const target = state.cards.find(c=>`card:${c.id}`===pending.target);
  if (!target) return [];
  return (target.kind==='choice' ? state.cards.filter(c=>c.kind!=='choice' && c.groupId===target.id && c.type===target.type) : [target]).map(c=>effectiveAction(model,c));
}
const identity = card => card.source?.startsWith('class-feature:') ? card.source : card.id;

export function previewChainUse(model, raw, pendingId = null) {
  const state = sessionState(model), pending = (state.pendingFollowups || []).find(p=>p.id===pendingId);
  if (pendingId && !pending) return {error:'This follow-up has already been resolved'};
  if (!pendingId && state.pendingFollowups?.length) return {error:'Resolve or cancel the pending chain first'};
  let card = effectiveAction(model,raw);
  if (pending) {
    const found = followupChoices(model,pending).find(c=>c.id===card.id);
    if (!found) return {error:'This option is no longer part of the follow-up'};
    card = found;
    if (pending.path.includes(identity(card))) return {error:'Cycle stopped: this ability already ran in this chain'};
    if (pending.path.length >= 20) return {error:'Chain limit reached (20 steps)'};
    if (pending.action) card = {...card,type:pending.action};
    if (pending.waiveResource) card = {...card,resource:''};
  }
  return {...planAction(model,card,state),card,pending};
}

export function executeChainAction(model, raw, pendingId = null) {
  const plan = previewChainUse(model,raw,pendingId);
  if (plan.error) return plan.error;
  const {card,pending,next} = plan;
  const path = [...(pending?.path || []),identity(card)].filter(Boolean);
  const group = next.cards.find(g=>g.kind==='choice' && g.id===card.groupId);
  const links = [...(card.links || []),...(group?.links || [])];
  const queue = (next.pendingFollowups || []).filter(p=>p.id!==pendingId);
  if (queue.length + links.length > 64) return 'Too many pending links (maximum 64)';
  // Snapshot the permission granted by this activation. Later configuration
  // changes cannot silently change a free-action offer already in progress.
  next.pendingFollowups = [...queue,...links.filter(l=>l.target).map(l=>({
    id:crypto.randomUUID(),target:l.target,action:l.action || '',waiveResource:!!l.waiveResource,
    required:!!l.required,note:l.note || '',from:card.title || 'Action',path,
  }))];
  model.markUndo(`Used ${card.title || card.type}`);
  if (group) next.cards = next.cards.map(c=>c.id===group.id?{...c,selectedId:card.id}:c);
  if (plan.tracker) plan.tracker.current = Number(plan.tracker.current)+plan.amount;
  model.set('session',next);
  return '';
}

export function dismissFollowup(model,id) {
  const state = sessionState(model), pending = (state.pendingFollowups || []).find(p=>p.id===id);
  if (!pending || pending.required) return false;
  model.markUndo('Skipped optional follow-up');
  state.pendingFollowups = state.pendingFollowups.filter(p=>p.id!==id);
  model.set('session',state); return true;
}
