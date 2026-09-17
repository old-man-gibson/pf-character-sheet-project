import { esc } from './html.js';
import { renderedProse } from './prose.js';
import { ACTION_TYPES, sessionState } from '../model/session.js';
import { editableSession } from '../model/session-layout.js';
import { actionFeatures } from '../model/action-features.js';
import { chainTargets, followupChoices, previewChainUse, executeChainAction, dismissFollowup } from '../model/session-chains.js';
import { sessionRolls } from '../model/session-rolls.js';

export function linkEditor(model, owner, ref) {
  const targets = chainTargets(model);
  return `<details class="session-links" open><summary>Linked follow-ups (${owner.links?.length || 0})</summary>
    <p class="hint">After using this ability, offer another ability or a choice group. Links can lead to further links. Describe the feat or rule granting the link.</p>
    ${(owner.links || []).map((link,i)=>{
      const attr = field=>`data-link-owner="${ref}" data-link-index="${i}" data-link-field="${field}"`;
      return `<div class="session-link-row"><label>Then use <select ${attr('target')}><option value="">Choose an ability or group</option>${link.target && !targets.some(t=>t.key===link.target)?`<option selected value="${esc(link.target)}">Missing target</option>`:''}${targets.map(t=>`<option value="${esc(t.key)}" ${t.key===link.target?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label>
        <label>Action cost for this follow-up <select ${attr('action')}><option value="">Normal action cost</option>${ACTION_TYPES.map(([key,label])=>`<option value="${key}" ${link.action===key?'selected':''}>${label}</option>`).join('')}</select></label>
        <label><input type="checkbox" ${attr('waiveResource')} ${link.waiveResource?'checked':''}> Waive resource cost too</label>
        <label><input type="checkbox" ${attr('required')} ${link.required?'checked':''}> Required follow-up</label>
        <label>Granted by / reminder <input ${attr('note')} value="${esc(link.note || '')}"></label>
        <button data-link-remove="${i}" data-link-owner="${ref}">Remove link</button></div>`;
    }).join('')}
    <button data-link-add="${ref}">+ Link ability or group</button></details>`;
}

export function pendingChains(model) {
  const pending = sessionState(model).pendingFollowups || [];
  if (!pending.length) return '';
  return `<section class="session-chain-pending" aria-label="Pending ability chain"><h3>Continue your ability chain</h3>
    ${pending.map(p=>`<div class="session-chain-step"><strong>After ${esc(p.from)}</strong> · ${p.required?'Required':'Optional'}
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
  root.querySelectorAll('[data-link-add]').forEach(el=>el.addEventListener('click',()=>{
    model.markUndo('Added ability link');
    model.set('session',editableSession(model));
    edit(el.dataset.linkAdd,owner=>{(owner.links ||= []).push({target:'',action:'',required:false,waiveResource:false,note:''});}); render();
  }));
  root.querySelectorAll('[data-link-remove]').forEach(el=>el.addEventListener('click',()=>{
    model.markUndo('Removed ability link'); edit(el.dataset.linkOwner,owner=>owner.links.splice(Number(el.dataset.linkRemove),1)); render();
  }));
  root.querySelectorAll('[data-link-field]').forEach(el=>el.addEventListener('change',()=>{
    edit(el.dataset.linkOwner,owner=>{owner.links[Number(el.dataset.linkIndex)][el.dataset.linkField]=el.type==='checkbox'?el.checked:el.value;});
  }));
  root.querySelectorAll('[data-chain-use]').forEach(el=>el.addEventListener('click',()=>{
    const pending = sessionState(model).pendingFollowups.find(p=>p.id===el.dataset.chainUse);
    const card = pending && followupChoices(model,pending).find(c=>c.id===el.dataset.chainCard);
    if (card) executeChainAction(model,card,pending.id); render();
  }));
  root.querySelectorAll('[data-chain-skip]').forEach(el=>el.addEventListener('click',()=>{dismissFollowup(model,el.dataset.chainSkip);render();}));
  root.querySelectorAll('[data-chain-cancel]').forEach(el=>el.addEventListener('click',()=>{model.markUndo('Cancelled remaining chain');model.set('session.pendingFollowups',[]);render();}));
}
