import { actionFeatures, effectiveAction } from './action-features.js';
import { sessionState, planAction, sessionShortcuts } from './session.js';

/*
 * A routine is the steps a card or class feature brings after its own. A
 * `then` step is part of the same Use: the card's action covers it, its
 * resource is paid with the card's, and its rolls copy with the card's. The
 * other kinds are offered once the Use is done, as follow-ups on the board
 * and as buttons under the copy, and the steps under them follow in turn.
 * Steps nest by `after`, the id of the step they follow ('' for the owner).
 */
export const STEP_KINDS = [['then', 'Then, same Use'], ['hit', 'On a hit'], ['crit', 'On a crit'], ['after', 'Afterwards']];
export const stepKindLabel = when => STEP_KINDS.find(([k]) => k === when)?.[1] || 'Afterwards';
export const stepsOf = owner => (Array.isArray(owner?.steps) ? owner.steps : []);
export const blankStep = (after = '', when = 'then') => ({ id: crypto.randomUUID(), after, when, target: '',
  action: '', waiveResource: false, required: false, note: '', attacks: '', attackModifier: '', extraAttacks: '', extraDamage: '' });
const MAX_STEPS = 20;

/**
 * A card's or class feature's `links`, from before routines, as `after` steps
 * on the owner itself. Run on load; the ids are fixed so a reload writes the
 * same document.
 */
export function linksToSteps(owner) {
  if (!owner || typeof owner !== 'object' || !('links' in owner)) return;
  const links = Array.isArray(owner.links) ? owner.links.filter(l => l && typeof l === 'object') : [];
  owner.steps = [...stepsOf(owner), ...links.map((l, i) => ({ ...blankStep('', 'after'), id: `link${i + 1}`,
    target: l.target || '', action: l.action || '', waiveResource: !!l.waiveResource, required: !!l.required, note: l.note || '' }))];
  delete owner.links;
}

// A class feature pinned to the board keeps its steps in Progression.
const ownerKey = card => (card.source?.startsWith('class-feature:') ? `feature:${card.source.slice('class-feature:'.length)}` : `card:${card.id}`);
function ownerSteps(model, key) {
  if (key.startsWith('feature:')) return stepsOf(actionFeatures(model).find(f => `feature:${f.id}` === key));
  return stepsOf(sessionState(model).cards.find(c => `card:${c.id}` === key));
}
const identity = card => (card.source?.startsWith('class-feature:') ? card.source : card.id);

export function chainTargets(model) {
  return [...actionFeatures(model).map(f => ({ key: `feature:${f.id}`, title: `${f.className}: ${f.title}`, group: 'Class features' })),
    ...sessionState(model).cards.filter(c => c.id).map(c => ({ key: `card:${c.id}`, title: `${c.kind === 'choice' ? 'Group' : 'Option'}: ${effectiveAction(model, c).title || 'Untitled'}`, group: 'Session cards' })),
    // A routine can name a weapon or ability straight off the sheet, so a
    // blender's bite and claws need no card of their own on the board.
    ...sessionShortcuts(model).filter(s => !s.key.startsWith('class-feature:'))
      .map(s => ({ key: `source:${s.key}`, title: `${s.kind[0].toUpperCase()}${s.kind.slice(1)}: ${s.title}`, group: 'From the sheet' }))];
}

/** The cards a step's target can be: one, or each option of a choice group. */
function targetCards(model, target) {
  const state = sessionState(model);
  if (target.startsWith('feature:')) {
    const f = actionFeatures(model).find(f => `feature:${f.id}` === target);
    return f ? [{ ...f, id: target, source: `class-feature:${f.id}` }] : [];
  }
  if (target.startsWith('source:')) {
    const s = sessionShortcuts(model).find(x => x.key === target.slice('source:'.length));
    return s ? [{ id: target, source: s.key, title: s.title, type: s.actionType || 'standard' }] : [];
  }
  const card = state.cards.find(c => `card:${c.id}` === target);
  if (!card) return [];
  return (card.kind === 'choice' ? state.cards.filter(c => c.kind !== 'choice' && c.groupId === card.id && c.type === card.type) : [card])
    .map(c => effectiveAction(model, c));
}

// "Attacks" picks the weapon's attacks for this step whatever the card's
// action is: one, the iteratives, or the highest bonus only.
const ATTACK_SETS = { one: 'one', full: 'full', top: 'top' };
function applyStep(card, step) {
  if (!step) return card;
  const out = { ...card, stepId: step.id };
  for (const key of ['attackModifier', 'extraAttacks', 'extraDamage']) if (String(step[key] ?? '').trim()) out[key] = step[key];
  if (ATTACK_SETS[step.attacks]) out.attackSet = ATTACK_SETS[step.attacks];
  return out;
}

/** The card a `then` step runs: a choice group runs its selected option. */
function stepCard(model, step) {
  const cards = targetCards(model, step.target);
  const group = sessionState(model).cards.find(c => `card:${c.id}` === step.target && c.kind === 'choice');
  const card = cards.find(c => group && c.id === group.selectedId) || cards[0];
  return card ? applyStep(card, step) : null;
}

/**
 * Everything one Use of `card` does: the cards it rolls and pays for, in
 * order -- the card, then each `then` step and what that step brings -- and
 * the steps it leaves to offer. `from` is where `card` sits in a routine
 * already running ({ owner, after }), so the steps under it there follow it.
 */
export function unfold(model, card, from = null, path = []) {
  const state = sessionState(model), parts = [], offers = [];
  let error = '';
  const walk = (card, lists, path) => {
    if (parts.length >= MAX_STEPS) { error ||= `A routine runs at most ${MAX_STEPS} steps`; return; }
    parts.push(card);
    const group = card.groupId && state.cards.find(g => g.kind === 'choice' && g.id === card.groupId);
    const all = [...lists, { owner: ownerKey(card), after: '' }, ...(group ? [{ owner: `card:${group.id}`, after: '' }] : [])];
    for (const { owner, after } of all) {
      for (const step of ownerSteps(model, owner).filter(s => (s.after || '') === after && s.target)) {
        if (step.when !== 'then') { offers.push({ owner, step, from: card.title || 'Action', path }); continue; }
        const next = stepCard(model, step);
        if (!next) { error ||= 'A step’s target is missing or the group is empty'; continue; }
        if (path.includes(identity(next))) { error ||= 'Cycle stopped: this ability already ran in this chain'; continue; }
        walk(next, [{ owner, after: step.id }], [...path, identity(next)]);
      }
    }
  };
  walk(card, from ? [from] : [], [...path, identity(card)].filter(Boolean));
  return { parts, offers, error };
}

export function followupChoices(model, pending) {
  // A follow-up saved before routines has no step; it offers its target as it is.
  const step = pending.owner ? ownerSteps(model, pending.owner).find(s => s.id === pending.step) : null;
  if (pending.owner && !step) return [];
  return targetCards(model, pending.target).map(c => applyStep(c, step));
}

// What a bare spend is called on the Undo button: "Undo standard action".
const SPEND_NAMES = { standard: 'standard action', move: 'move action', swift: 'swift action', immediate: 'immediate action',
  aoo: 'attack of opportunity', full: 'full-round action', free: 'free action' };

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
    if (pending.path.length >= MAX_STEPS) return {error:`Chain limit reached (${MAX_STEPS} steps)`};
    if (pending.action) card = {...card,type:pending.action};
    if (pending.waiveResource) card = {...card,resource:''};
  }
  const run = unfold(model, card, pending?.owner ? { owner: pending.owner, after: pending.step } : null, pending?.path || []);
  if (run.error) return { error: run.error };
  return {...planAction(model,card,state,undefined,run.parts.slice(1)),card,pending,run};
}

export function executeChainAction(model, raw, pendingId = null) {
  const plan = previewChainUse(model,raw,pendingId);
  if (plan.error) return plan.error;
  const {card,next,run} = plan;
  const group = next.cards.find(g=>g.kind==='choice' && g.id===card.groupId);
  const queue = (next.pendingFollowups || []).filter(p=>p.id!==pendingId);
  if (queue.length + run.offers.length > 64) return 'Too many pending follow-ups (maximum 64)';
  // Snapshot the permission granted by this activation. Later configuration
  // changes cannot silently change a free-action offer already in progress.
  next.pendingFollowups = [...queue,...run.offers.map(({owner,step,from,path})=>({
    id:crypto.randomUUID(),owner,step:step.id,when:step.when,target:step.target,action:step.action || '',
    waiveResource:!!step.waiveResource,required:!!step.required,note:step.note || '',from,path,
  }))];
  // One play action, named for what was used, so the button can take back
  // this Use alone -- its action, its resources -- and leave the rest.
  return model.play(card.title || SPEND_NAMES[card.type] || card.type || 'action', () => {
    if (group) next.cards = next.cards.map(c=>c.id===group.id?{...c,selectedId:card.id}:c);
    for (const {tracker,amount} of plan.costs) tracker.current = Number(tracker.current)+amount;
    model.set('session',next);
    return '';
  });
}

/**
 * The branches a Use leaves, flattened for a copy: a row per kind and the
 * card it follows, a button per card the branch can run. A branch's own
 * `then` steps are buttons beside it, since a button posts one message, and
 * its branches join the rows.
 */
export function routineBranches(model, card) {
  const rows = new Map();
  const root = card.title || 'Action';
  const add = (offers, depth) => {
    if (depth > 4) return;
    for (const { owner, step, from, path } of offers) {
      for (const choice of targetCards(model, step.target).map(c => applyStep(c, step))) {
        if (path.includes(identity(choice))) continue;
        const sub = unfold(model, choice, { owner, after: step.id }, path);
        const label = `${stepKindLabel(step.when)}${from !== root ? ` after ${from}` : ''}`;
        if (!rows.has(label)) rows.set(label, []);
        sub.parts.forEach((part, i) => rows.get(label).push({ label: i ? `${choice.title || 'Option'}: ${part.title || 'step'}` : choice.title || 'Option', card: part }));
        add(sub.offers, depth + 1);
      }
    }
  };
  add(unfold(model, card).offers, 0);
  return [...rows].map(([label, buttons]) => ({ label, buttons }));
}

export function dismissFollowup(model,id) {
  const state = sessionState(model), pending = (state.pendingFollowups || []).find(p=>p.id===id);
  if (!pending || pending.required) return false;
  model.play('Skipped follow-up', () => {
    state.pendingFollowups = state.pendingFollowups.filter(p=>p.id!==id);
    model.set('session',state);
  });
  return true;
}
