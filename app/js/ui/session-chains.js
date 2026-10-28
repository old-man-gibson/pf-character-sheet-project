import { esc } from './html.js';
import { renderedProse } from './prose.js';
import { removeControl } from './rows.js';
import { ACTION_TYPES, sessionState } from '../model/session.js';
import { editableSession } from '../model/session-layout.js';
import { actionFeatures } from '../model/action-features.js';
import { STEP_KINDS, stepKindLabel, stepsOf, blankStep, chainTargets, followupChoices, previewChainUse, executeChainAction, dismissFollowup } from '../model/session-chains.js';
import { sessionRolls } from '../model/session-rolls.js';

const ATTACK_CHOICES = [['', 'As the card has them'], ['one', 'One attack'], ['full', 'Full attack (iteratives)'], ['top', 'Highest bonus only']];

/**
 * A card's or class feature's routine as an outline: each step a row, the
 * steps that follow it indented under it. `ref` is how the bindings find the
 * owner again (`card:3`, `feature:0`).
 */
export function routineEditor(model, owner, ref) {
  const steps = stepsOf(owner), targets = chainTargets(model);
  const ids = new Set(steps.map(s => s.id));
  const groups = [...new Set(targets.map(t => t.group))];
  const select = (step, field, options, label) => `<select aria-label="${label}" data-step-owner="${ref}" data-step-id="${esc(step.id)}" data-step-field="${field}">${options}</select>`;
  const input = (step, field, label, placeholder = '') => `<label>${label} <input data-step-owner="${ref}" data-step-id="${esc(step.id)}" data-step-field="${field}" value="${esc(String(step[field] ?? ''))}" ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}></label>`;
  const check = (step, field, label) => `<label><input type="checkbox" data-step-owner="${ref}" data-step-id="${esc(step.id)}" data-step-field="${field}" ${step[field] ? 'checked' : ''}> ${label}</label>`;
  const options = (list, value) => list.map(([k, l]) => `<option value="${esc(k)}" ${k === (value || '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const targetOptions = step => `<option value="">Choose a card, feature or attack</option>${step.target && !targets.some(t => t.key === step.target) ? `<option selected value="${esc(step.target)}">Missing target</option>` : ''}
    ${groups.map(g => `<optgroup label="${esc(g)}">${targets.filter(t => t.group === g).map(t => `<option value="${esc(t.key)}" ${t.key === step.target ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</optgroup>`).join('')}`;
  const row = step => {
    const branch = step.when !== 'then';
    const children = steps.filter(s => s.after === step.id);
    return `<li class="session-step" data-when="${esc(step.when)}">
      <div class="session-step-head">${select(step, 'when', options(STEP_KINDS, step.when), 'When')}${select(step, 'target', targetOptions(step), 'Step')}
        <button class="session-step-add" data-step-add="${ref}" data-step-after="${esc(step.id)}" title="Add a step that follows this one">+ Under</button>
        ${removeControl(`data-step-remove="${esc(step.id)}" data-step-owner="${ref}"`, { what: 'step', tiny: true })}</div>
      <details class="session-step-more"><summary>Rolls${branch ? ' and cost' : ''}</summary>
        <div class="session-settings-grid">
          <label>Attacks ${select(step, 'attacks', options(ATTACK_CHOICES, step.attacks), 'Attacks')}</label>
          ${input(step, 'attackModifier', 'Attack modifier', 'e.g. -5')}${input(step, 'extraAttacks', 'Extra attacks', 'e.g. 1')}${input(step, 'extraDamage', 'Extra damage on each hit', 'e.g. 1d6')}
          ${branch ? `<label>Action cost ${select(step, 'action', `<option value="">Normal action cost</option>${options(ACTION_TYPES, step.action)}`, 'Action cost')}</label>` : ''}
          ${input(step, 'note', 'Granted by / reminder')}
        </div>
        ${branch ? `${check(step, 'waiveResource', 'Waive resource cost too')}${check(step, 'required', 'Required follow-up')}` : ''}
      </details>
      ${children.length ? `<ol>${children.map(row).join('')}</ol>` : ''}</li>`;
  };
  // A step whose parent is gone still shows, at the top, so it can be fixed.
  const roots = steps.filter(s => !s.after || !ids.has(s.after));
  return `<details class="session-links" open><summary>Routine (${steps.length})</summary>
    <p class="hint">Then steps run with this one on the same Use and copy with it. Other steps are offered after it, and copy as buttons under its roll.</p>
    ${roots.length ? `<ol class="session-routine">${roots.map(row).join('')}</ol>` : ''}
    <button data-step-add="${ref}" data-step-after="">+ Step</button></details>`;
}

export function pendingChains(model) {
  const pending = sessionState(model).pendingFollowups || [];
  if (!pending.length) return '';
  return `<section class="session-chain-pending" aria-label="Pending ability chain"><h3>Continue your ability chain</h3>
    ${pending.map(p=>`<div class="session-chain-step"><strong>${p.when ? `${esc(stepKindLabel(p.when))} · after` : 'After'} ${esc(p.from)}</strong> · ${p.required?'Required':'Optional'}
      <p>${esc(p.note)} ${p.action ? `${esc(ACTION_TYPES.find(([k])=>k===p.action)?.[1] || p.action)} action`:'Normal action cost'} · ${p.waiveResource?'resource cost waived':'normal resource cost'}</p>
      ${followupChoices(model,p).map(c=>{
        const plan = previewChainUse(model,c,p.id), values = sessionRolls(model,c);
        return `<div class="session-chain-option"><button data-chain-use="${esc(p.id)}" data-chain-card="${esc(c.id)}" ${plan.error?'disabled':''}>Use ${esc(c.title || 'option')}</button>
          <span>${esc([values.attack && `Attack ${values.attack}`,values.damage && `Damage ${values.damage}`,values.range].filter(Boolean).join(' · '))}</span>
          ${plan.error?`<p class="hint">${esc(plan.error)}</p>`:''}
          <details><summary>Details</summary>${renderedProse(model,c.note || '')}</details></div>`;
      }).join('') || '<p class="hint">The linked target is missing or the group is empty. Restore it, undo the activation, or cancel the remaining chain.</p>'}
      ${!p.required?`<button data-chain-skip="${esc(p.id)}">Skip</button>`:''}</div>`).join('')}
    <button data-chain-cancel>Cancel remaining chain</button><p class="hint">Cancel keeps costs already paid. Undo reverses the last activation. Resolve or cancel this chain before another action or turn.</p></section>`;
}

export function bindChains(root,model,render) {
  const edit = (ref,fn)=>{
    const [kind,n] = ref.split(':'), index = Number(n);
    if (kind==='feature') {
      const rows = structuredClone(actionFeatures(model));
      fn(rows[index]); model.set('progression.actionFeatures',rows);
    } else { const state = editableSession(model); fn(state.cards[index]); model.set('session',state); }
  };
  root.querySelectorAll('[data-step-add]').forEach(el=>el.addEventListener('click',()=>{
    model.markUndo('Added routine step');
    model.set('session',editableSession(model));
    // A step under another is most often a branch of it; a step at the top runs with the card.
    const after = el.dataset.stepAfter || '';
    edit(el.dataset.stepAdd,owner=>{(owner.steps ||= []).push(blankStep(after, after ? 'hit' : 'then'));}); render();
  }));
  root.querySelectorAll('[data-step-remove]').forEach(el=>el.addEventListener('click',()=>{
    model.markUndo('Removed routine step');
    // The steps under it move up to its place rather than go with it.
    edit(el.dataset.stepOwner,owner=>{
      const gone = owner.steps.find(s=>s.id===el.dataset.stepRemove);
      owner.steps = owner.steps.filter(s=>s!==gone).map(s=>s.after===gone?.id?{...s,after:gone.after || ''}:s);
    }); render();
  }));
  root.querySelectorAll('[data-step-field]').forEach(el=>el.addEventListener('change',()=>{
    edit(el.dataset.stepOwner,owner=>{
      const step = stepsOf(owner).find(s=>s.id===el.dataset.stepId);
      if (step) step[el.dataset.stepField] = el.type==='checkbox'?el.checked:el.value;
    });
    // The kind decides which fields a step shows.
    if (el.dataset.stepField==='when') render();
  }));
  root.querySelectorAll('[data-chain-use]').forEach(el=>el.addEventListener('click',()=>{
    const pending = sessionState(model).pendingFollowups.find(p=>p.id===el.dataset.chainUse);
    const card = pending && followupChoices(model,pending).find(c=>c.id===el.dataset.chainCard);
    if (card) executeChainAction(model,card,pending.id); render();
  }));
  root.querySelectorAll('[data-chain-skip]').forEach(el=>el.addEventListener('click',()=>{dismissFollowup(model,el.dataset.chainSkip);render();}));
  root.querySelectorAll('[data-chain-cancel]').forEach(el=>el.addEventListener('click',()=>{model.play('Cancelled chain',()=>model.set('session.pendingFollowups',[]));render();}));
}
