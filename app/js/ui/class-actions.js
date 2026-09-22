import { esc } from './html.js';
import { collapsible, collapsibleSub } from './rows.js';
import { actionFeatures } from '../model/action-features.js';
import { ACTION_TYPES } from '../model/session.js';
import { editableSession } from '../model/session-layout.js';
import { linkEditor } from './session-chains.js';

export function classActionsPanel(model) {
  const rows = actionFeatures(model);
  const names = [...new Set([...(model.data.classes || []).map(c=>c.name),...model.progressionClasses(),...rows.map(f=>f.className)].filter(Boolean))];
  // Setup for the session board, not something read off the sheet: folded
  // until it is wanted, and each class folded inside it, so that adding one
  // monk ability does not mean scrolling past the kineticist's.
  const count = (name) => rows.filter((f) => f.className === name).length;
  return collapsible(model, 'classactions', `<section class="panel span2 class-actions"><h3>Class features · abilities & actions
      <span class="badge">${rows.length}</span></h3>
    <p class="hint">Define each ability once here, then pin it to the session board. Rolls, resources, descriptions and links stay connected. Session placement can use a different action type.</p>
    ${names.map(name=>collapsibleSub(model, `classactions-${name}`, `${esc(name)} <span class="badge">${count(name)}</span>`, `
      ${rows.map((f,i)=>f.className!==name?'':collapsibleSub(model, `classactions-feature-${f.id}`, esc(f.title || 'New class feature'), `
        <div class="session-settings-grid">${[['title','Feature name'],['attackFormula','Attack bonus / formula'],['damageFormula','Damage roll'],['extraAttacks','Extra attacks (count, or count @ modifier)'],['attackModifier','Attack modifier'],['extraDamage','Extra damage per hit'],['range','Range'],['targets','Targets / area'],['save','Save / DC'],['duration','Duration'],['cost','Resource cost']].map(([key,label])=>`<label>${label}<input data-class-action="${i}" data-feature-field="${key}" value="${esc(String(f[key] ?? ''))}"></label>`).join('')}
        <label>Action<select data-class-action="${i}" data-feature-field="type">${ACTION_TYPES.map(([k,l])=>`<option value="${k}" ${f.type===k?'selected':''}>${l}</option>`).join('')}</select></label>
        <label>Attack set<select data-class-action="${i}" data-feature-field="attackSet"><option value="">Normal</option><option value="top" ${f.attackSet==='top'?'selected':''}>Highest bonus only (flurry)</option></select></label>
        <label>Resource<select data-class-action="${i}" data-feature-field="resource"><option value="">None</option>${f.resource && !model.trackers.some(t=>t.id===f.resource)?`<option selected value="${esc(f.resource)}">Missing resource</option>`:''}${model.trackers.map(t=>`<option value="${esc(t.id)}" ${f.resource===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label></div>
        <label>Description / notes<textarea data-class-action="${i}" data-feature-field="note">${esc(f.note || '')}</textarea></label>
        ${linkEditor(model,f,`feature:${i}`)}
        <button data-feature-pin="${i}">${model.data.session?.cards?.some(c=>c.source===`class-feature:${f.id}`)?'Pinned to session':'Pin to session'}</button>
        <button data-feature-remove="${i}">Remove feature</button>`, 'session-editor', true)).join('')}
      <button data-feature-add="${esc(name)}">+ Class feature</button>`, '', true)).join('') || '<p class="hint">Add a class on Overview to start defining class features.</p>'}</section>`, true);
}

export function bindClassActions(root,model,render) {
  root.querySelectorAll('[data-feature-add]').forEach(el=>el.addEventListener('click',()=>{
    model.markUndo('Added class feature');
    model.set('progression.actionFeatures',[...actionFeatures(model),{id:crypto.randomUUID(),className:el.dataset.featureAdd,title:'New class feature',type:'standard',cost:'1',links:[]}]);render();
  }));
  root.querySelectorAll('[data-feature-field]').forEach(el=>el.addEventListener('change',()=>{
    const rows = structuredClone(actionFeatures(model)), f = rows[Number(el.dataset.classAction)], oldType = f.type;
    f[el.dataset.featureField] = el.value;
    if (el.dataset.featureField==='type') {
      const state = editableSession(model);
      state.cards.forEach(c=>{if(c.source===`class-feature:${f.id}` && c.type===oldType)c.type=f.type;});
      model.set('session',state);
    }
    model.set('progression.actionFeatures',rows);
  }));
  root.querySelectorAll('[data-feature-pin]').forEach(el=>el.addEventListener('click',()=>{
    const f = actionFeatures(model)[Number(el.dataset.featurePin)], state = editableSession(model);
    if (!state.cards.some(c=>c.source===`class-feature:${f.id}`)) {
      model.markUndo('Pinned class feature');state.cards.push({id:crypto.randomUUID(),source:`class-feature:${f.id}`,type:f.type});model.set('session',state);
    }
    render();
  }));
  root.querySelectorAll('[data-feature-remove]').forEach(el=>el.addEventListener('click',()=>{
    model.markUndo('Removed class feature');model.set('progression.actionFeatures',actionFeatures(model).filter((_,i)=>i!==Number(el.dataset.featureRemove)));render();
  }));
}
