import { esc } from '../html.js';
import { D20_ICON } from '../roll.js';
import { sessionRolls } from '../../model/session-rolls.js';
import { renderedProse } from '../prose.js';
import { editableSession, choiceParent, moveSessionCard, removeSessionCard } from '../../model/session-layout.js';
import { bindSessionDrag } from '../session-drag.js';
import { actionFeatures, linkedFeature, effectiveAction } from '../../model/action-features.js';
import { previewChainUse } from '../../model/session-chains.js';
import { linkEditor, pendingChains } from '../session-chains.js';
import { ACTION_TYPES, ACTION_POOLS, sessionState, actionBudget, useSessionAction,
  advanceTurn, sessionShortcuts } from '../../model/session.js';

const button = (command, text, attrs = '') => `<button data-session-command="${command}" ${attrs}>${text}</button>`;
const input = (field, value, attrs = '') => `<input data-session-field="${field}" value="${esc(String(value ?? ''))}" ${attrs}>`;

export function renderSessionBoard(model) {
  const state = sessionState(model), budget = actionBudget(model, state), shortcuts = sessionShortcuts(model);
  const types = (selected) => ACTION_TYPES.map(([key, label]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${label}</option>`).join('');
  const handle = (index, title) => `<button class="session-drag" draggable="true" data-session-drag="${index}" aria-label="Drag ${esc(title)}" title="Drag to reorder or move to another action type">⠿</button>`;
  // Automatic width: one column, two for a choice group, a linked ability or a
  // routine of more than four attacks (so the attack line does not wrap into a
  // paragraph), three for several links.
  const width = (card, attackCount = 0) => Math.max(1,Math.min(3,Number(card.width) || (card.links?.length>1?3:(card.links?.length || card.kind==='choice' || attackCount>4)?2:1)));
  const typeLabel = { standard: 'Standard', move: 'Move', swift: 'Swift', immediate: 'Immediate', aoo: 'AoO', full: 'Full round', free: 'Free' };
  const typeTag = card => `<span class="session-type-tag" title="${esc(ACTION_TYPES.find(([k]) => k === card.type)?.[1] || card.type || '')}">${esc(typeLabel[card.type] || card.type || '')}</span>`;
  // "Attack: …" errors belong under the field they name as well as at the foot of the card.
  const FIELD_ERRORS = [['attackFormula', 'Attack'], ['damageFormula', 'Damage'], ['extraAttacks', 'Extra attacks'], ['attackModifier', 'Attack modifier'], ['extraDamage', 'Extra damage']];
  const fieldError = (values, key) => {
    const prefix = FIELD_ERRORS.find(([k]) => k === key)?.[1];
    const message = prefix && values.errors.find(e => e.startsWith(`${prefix}:`));
    return message ? `<small class="session-field-error" role="alert">${esc(message.slice(prefix.length + 1).trim())}</small>` : '';
  };
  const widthPicker = (card,index) => `<label>Card width<select data-session-field="cards.${index}.width"><option value="">Automatic</option>${[1,2,3].map(n=>`<option value="${n}" ${Number(card.width)===n?'selected':''}>${n} column${n===1?'':'s'}</option>`).join('')}</select></label>`;
  const cardHtml = (card, index) => {
    card = effectiveAction(model,card);
    if (card.kind === 'choice') {
      const members = state.cards.map((c, i) => ({c, i})).filter(({c}) => c.kind !== 'choice' && choiceParent(state, c) === card);
      const chosen = members.find(({c}) => c.id === card.selectedId) || members[0];
      return `<article class="session-choice session-width-${width(card)}" data-session-drop="${index}">
        <header>${handle(index, card.title || 'Choice group')}<strong>${esc(card.title || 'Choice group')}</strong><small>${members.length} choices</small></header>
        ${members.length ? `<details class="session-choice-picker" data-session-fold="choices:${esc(card.id)}" ${state.folded[`choices:${card.id}`] ? '' : 'open'}><summary>Choices</summary><div class="session-choice-buttons" role="group" aria-label="Choose an option in ${esc(card.title || 'Choice group')}">${members.map(({c,i}) => `<button data-session-choice="${index}" data-choice-index="${i}" aria-pressed="${chosen.i === i}">${esc(effectiveAction(model,c).title || 'Untitled option')}</button>`).join('')}</div></details>${cardHtml(chosen.c, chosen.i)}` : '<p class="hint">Drag options here, or choose this group in an option’s editor.</p>'}
        <div class="session-choice-drop" data-session-group-drop="${index}">Drop an option into this group</div>
        <details class="session-editor" data-session-fold="editor:${index}" ${state.folded[`editor:${index}`] === false ? 'open' : ''}><summary>Edit choice group</summary>
          <label>Group title ${input(`cards.${index}.title`, card.title)}</label>
          <label>Action <select data-session-field="cards.${index}.type">${types(card.type)}</select></label>
          ${widthPicker(card,index)}${linkEditor(model,card,`card:${index}`)}
          ${button('up','Move earlier',`data-index="${index}"`)} ${button('down','Move later',`data-index="${index}"`)}
          ${button('group-add','+ Custom choice',`data-index="${index}"`)}
          ${button('remove','Ungroup (keep options)',`data-index="${index}"`)}
        </details>
      </article>`;
    }
    const source = card.source ? shortcuts.find(x => x.key === card.source) : null;
    const title = card.title || source?.title || 'Untitled option';
    const plan = previewChainUse(model,card);
    const missing = card.source && !source;
    const reason = missing ? 'Source missing or renamed; edit this shortcut before using it' : plan.error;
    const tracker = model.trackers.find(t => t.id === card.resource);
    const edit = `cards.${index}`;
    const values = sessionRolls(model, card);
    const copy = (part, label) => `<button class="d20" data-roll="session|${index}:${part}" data-rollwhat="${esc(title)}" aria-label="Copy ${label} roll for ${esc(title)}" title="Copy ${label} roll for Roll20" ${values.errors.length ? 'disabled' : ''}>${D20_ICON}</button>`;
    const rollSummary = `<div class="session-roll-values">
      ${values.attack ? `<span><small>Attack</small><strong title="${esc(values.attack)}">${esc(values.attackSummary)}</strong>${copy('attack', 'attack')}</span>` : ''}
      ${values.damage ? `<span><small>Damage</small><strong>${esc(values.damage)}</strong>${copy('damage', 'damage')}</span>` : ''}
      </div>`;
    return `<article class="session-option session-width-${width(card, values.attackCount)} ${reason ? 'unavailable' : ''}" data-session-drop="${index}">
      ${handle(index, title)}
      <details data-session-fold="card:${index}" ${state.folded[`card:${index}`] === false ? 'open' : ''}>
        <summary>${esc(title)}${typeTag(card)}${card.resource ? `<small>${esc(card.cost || '1')} ${esc(tracker?.name || 'missing resource')}</small>` : ''}</summary>
        ${source ? `<p class="session-source">Linked ${esc(source.kind)} · ${esc(source.title)}</p>` : ''}
        ${source?.note && !linkedFeature(model,card) ? `<div class="session-description">${renderedProse(model, source.note)}</div>` : ''}
        ${card.note ? `<div class="session-description">${renderedProse(model, card.note)}</div>` : ''}
        ${values.spec.rolls.length ? `<div class="session-source">Copy all rolls ${copy('all', 'all')}</div>` : ''}
        <details class="session-editor" data-session-fold="editor:${index}" ${state.folded[`editor:${index}`] === false ? 'open' : ''}><summary>Edit option</summary>
          <label>Title ${input(`${edit}.title`, card.title, 'aria-label="Option title"')}</label>
          ${linkedFeature(model,card)?'<p class="hint">Rolls, costs, notes and links below edit the linked class feature in Progression.</p>':''}
          <details class="session-placement"><summary>Placement <small>${esc(ACTION_TYPES.find(([k]) => k === card.type)?.[1] || 'Standard')} · ${Number(card.width) ? `${card.width} column${Number(card.width) === 1 ? '' : 's'}` : 'automatic width'} · ${esc(choiceParent(state,card)?.title || 'standalone')}</small></summary>
            <div class="session-settings-grid">
              <label>Action <select data-session-field="${edit}.type">${types(card.type)}</select></label>
              ${widthPicker(card,index)}
              <label>Choice group <select data-session-membership="${index}"><option value="">Standalone option</option>${state.cards.filter(g => g.kind === 'choice' && g.type === card.type).map(g => `<option value="${esc(g.id)}" ${choiceParent(state,card) === g ? 'selected' : ''}>${esc(g.title || 'Choice group')}</option>`).join('')}</select></label>
            </div>
          </details>
          <fieldset class="session-fields"><legend>Rolls</legend>
            <div class="session-settings-grid">
              <label>Attack bonus or formula ${input(`${edit}.attackFormula`, card.attackFormula, 'placeholder="e.g. attack.melee or bab + dex.mod"')}${fieldError(values, 'attackFormula')}</label>
              <label>Damage roll ${input(`${edit}.damageFormula`, card.damageFormula, 'placeholder="e.g. 2d6 + str.mod"')}${fieldError(values, 'damageFormula')}</label>
              <label>Extra attacks (count, or count @ modifier) ${input(`${edit}.extraAttacks`, card.extraAttacks, 'placeholder="e.g. 3, or 1 @ -2, 2 @ -6"')}${fieldError(values, 'extraAttacks')}</label>
              <label>Attack modifier on every attack ${input(`${edit}.attackModifier`, card.attackModifier, 'placeholder="e.g. -2"')}${fieldError(values, 'attackModifier')}</label>
              <label>Extra damage on each hit ${input(`${edit}.extraDamage`, card.extraDamage, 'placeholder="e.g. 4d6 or kinetic.fist.simple"')}${fieldError(values, 'extraDamage')}</label>
              <label>Attack set <select data-session-field="${edit}.attackSet"><option value="">Normal (iteratives on a full round)</option><option value="top" ${card.attackSet === 'top' ? 'selected' : ''}>Highest bonus only (flurry)</option></select></label>
            </div>
            <details class="session-help"><summary>How the roll fields work</summary>
              <p class="hint">Leave a field blank to follow the linked source. Attack takes a number or formula; <code>attack.melee</code> and <code>attack.ranged</code> include current conditions, and custom rolls add nothing else on their own. Damage takes dice plus a formula, such as <code>2d6 + str.mod</code> or <code>{floor(level / 2)}d6</code>, and values defined as dice text. Overrides of either omit the linked weapon’s critical rolls.</p>
              <p class="hint">Extra attacks repeat the card’s highest attack, each group at its own modifier (<code>1 @ -2, 2 @ -max(0, 4 - essence.shoulders)</code>); counts and modifiers are formulas too. The attack modifier shifts every attack and crit confirmation. Extra damage is a rider: on the Damage roll, and once, unmultiplied, on the crit damage. <em>Highest bonus only</em> drops the reduced-bonus iteratives, as a flurry requires.</p>
            </details>
          </fieldset>
          <fieldset class="session-fields"><legend>Details</legend>
            <div class="session-settings-grid">
              ${[['range', 'Range'], ['targets', 'Targets / area'], ['save', 'Save / DC'], ['duration', 'Duration']].map(([key,label]) => `<label>${label} ${input(`${edit}.${key}`, card[key], `placeholder="${esc(String(values[key] || ''))}"`)}</label>`).join('')}
            </div>
            <label>Notes <textarea data-session-field="${edit}.note" placeholder="Inline values such as {caster.dc} work here">${esc(card.note || '')}</textarea></label>
          </fieldset>
          <fieldset class="session-fields"><legend>Cost</legend>
            <div class="session-settings-grid">
              <label>Resource <select data-session-field="${edit}.resource"><option value="">No resource cost</option>
                ${card.resource && !tracker ? `<option value="${esc(card.resource)}" selected>Missing resource — choose another</option>` : ''}
                ${model.trackers.map(t => `<option value="${esc(t.id)}" ${card.resource === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
              <label>Cost (number or formula) ${input(`${edit}.cost`, card.cost ?? '1')}</label>
            </div>
            <p class="hint">Using adds this cost to the resource’s spent / accumulated amount.</p>
          </fieldset>
          ${linkEditor(model,card,linkedFeature(model,card)?`feature:${actionFeatures(model).indexOf(linkedFeature(model,card))}`:`card:${index}`)}
          ${button('up', 'Move earlier', `data-index="${index}"`)}
          ${button('down', 'Move later', `data-index="${index}"`)}
          ${card.source ? button('unlink', 'Make custom', `data-index="${index}"`) : ''}
          ${button('remove', 'Remove', `data-index="${index}"`)}
        </details>
      </details>
      ${values.attack || values.damage ? rollSummary : ''}
      <div class="session-card-facts">${[['range','Range'],['targets','Targets'],['save','Save'],['duration','Duration']].filter(([key]) => values[key]).map(([key,label]) => `<span><small>${label}</small> ${renderedProse(model, String(values[key]))}</span>`).join('')}</div>
      ${values.errors.map(error => `<p class="session-roll-error" role="alert">${esc(error)}</p>`).join('')}
      <div class="session-option-use">${button('use', 'Use', `data-index="${index}" ${reason ? 'disabled' : ''}`)}
        <small>${esc(reason || (card.type === 'move' && !budget.move.remaining ? 'Uses a standard action' : card.type === 'full' ? 'Standard + movement' : card.type === 'immediate' && !state.onTurn ? 'Reserves next turn’s swift' : 'Ready'))}</small></div>
    </article>`;
  };
  return `<section class="session-board" aria-label="Session action board">
    <header class="session-heading"><div><span class="session-eyebrow">YOUR NEXT MOVE</span><h2>Turn ${Number(state.turn) || 1} <small>${state.onTurn ? 'Your turn' : 'Between turns'}</small></h2></div>
      <div>${state.onTurn ? button('end', 'End turn',state.pendingFollowups?.length?'disabled':'') : ''} ${button('next', state.onTurn ? 'Next turn' : 'Start my turn',state.pendingFollowups?.length?'disabled':'')}</div></header>
    ${pendingChains(model)}
    <div class="session-budget">${ACTION_POOLS.map(([key, label]) => `<div class="session-pool ${!budget[key].remaining ? 'spent' : ''}">
      <span>${label}</span><strong>${budget[key].remaining}<small> / ${budget[key].max}</small></strong>
      <div>${button('spend', '−', `data-kind="${key}" aria-label="Spend one ${label}" ${previewChainUse(model, {type:key}).error ? 'disabled' : ''}`)}${button('restore', '+', `data-kind="${key}" aria-label="Restore one ${label}"`)}</div>
      ${budget[key].error ? `<small role="alert">${esc(budget[key].error)}</small>` : ''}</div>`).join('')}</div>
    <p class="session-rule">${state.pendingSwift ? `${state.pendingSwift} swift reserved for your next turn. ` : ''}Movement can use an unused standard. Immediate shares your swift on your turn. − spends with these rules; + restores only that counter.</p>
    <details class="session-settings" data-session-fold="settings" ${state.folded.settings === false ? 'open' : ''}><summary>Action limits & manual adjustments</summary>
      <div class="session-settings-grid">${ACTION_POOLS.map(([key, label]) => `<div><label>${label} maximum ${input(`maxima.${key}`, state.maxima[key] ?? '1')}
        <span class="hint">Formula or number · bonus target: actions.${key}</span></label>
        <label>${label} spent (manual override) ${input(`spent.${key}`, state.spent[key] || 0, 'type="number" min="0"')}</label></div>`).join('')}
        <label>Swift reserved for next turn ${input('pendingSwift', state.pendingSwift, 'type="number" min="0"')}</label></div>
      <p class="hint">Combat Reflexes: use <code>1 + max(0, dex.mod)</code> for the AoO maximum, or put <code>{actions.aoo += max(0, dex.mod)}</code> in the feat’s text. Use one method. Spent overrides and + affect only the chosen counter. Next turn refreshes actions and AoOs, and applies reserved swift costs. Conditions and exceptional abilities still need your judgment.</p>
      ${button('reset', 'Reset encounter')}
    </details>
    <div class="session-groups">${ACTION_TYPES.map(([key, label]) => {
      const cards = state.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.type === key && !choiceParent(state,c));
      return `<details class="session-group" data-session-fold="${key}" ${state.folded[key] ? '' : 'open'}>
        <summary data-session-type-drop="${key}"><span>${label}</span><small>${cards.length} option${cards.length === 1 ? '' : 's'}${budget[key] ? ` · ${budget[key].remaining} left` : ''}</small></summary>
        <div class="session-options" data-session-type-drop="${key}">${cards.map(({ c, i }) => cardHtml(c, i)).join('')}<div class="session-type-drop">Drop here to place an option at the end</div></div>
        <div class="session-add">${button('add', '+ Custom option', `data-kind="${key}"`)}
          ${button('choice-add', '+ Choice group', `data-kind="${key}"`)}
          <select data-session-shortcut="${key}" aria-label="Add ${label} shortcut"><option value="">+ Link an attack or ability…</option>${shortcuts.map(s => `<option value="${esc(s.key)}">${esc(s.kind)} · ${esc(s.title)}</option>`).join('')}</select></div>
      </details>`;
    }).join('')}</div>
    <p class="hint">Drag by ⠿ to reorder, move between action types, or drop into a choice group. A group shows only the selected option; choosing it spends nothing. Use spends that option’s action and resource. Undo restores edits.</p>
  </section>`;
}

export function bindSessionBoard(root, model, render) {
  const update = state => { model.set('session', state); render(); };
  bindSessionDrag(root, model, render);
  root.querySelectorAll('[data-session-command]').forEach(el => el.addEventListener('click', () => {
    const state = sessionState(model), key = el.dataset.kind, i = Number(el.dataset.index);
    const command = el.dataset.sessionCommand;
    if (command === 'use') { useSessionAction(model, state.cards[i]); render(); return; }
    if (command === 'spend') { useSessionAction(model, {type:key}); render(); return; }
    if (command === 'next' || command === 'end') { advanceTurn(model, command === 'next'); render(); return; }
    if (command === 'remove') { removeSessionCard(model, i); render(); return; }
    if (command === 'up' || command === 'down') {
      const card = state.cards[i], parent = choiceParent(state, card);
      const indices = state.cards.map((c,n) => c.type === card.type && choiceParent(state,c) === parent ? n : -1).filter(n => n >= 0);
      const j = indices[indices.indexOf(i) + (command === 'up' ? -1 : 1)];
      if (j !== undefined) moveSessionCard(model, i, {type:card.type, groupId:parent?.id || '', target:j, after:command === 'down'});
      render(); return;
    }
    if (command === 'choice-add' || command === 'group-add') {
      const next = editableSession(model);
      const id = crypto.randomUUID();
      const group = next.cards[i];
      next.folded[`editor:${next.cards.length}`] = false;
      next.folded[`card:${next.cards.length}`] = false;
      next.cards.push(command === 'choice-add'
        ? {id, kind:'choice', title:'New choice group', type:key}
        : {id, title:'New choice', type:group.type, groupId:group.id});
      if (command === 'group-add') group.selectedId = id;
      model.markUndo('Added session choice'); update(next); return;
    }
    model.markUndo(`Session: ${command}`);
    if (command === 'restore') state.spent[key] = Math.max(0, (Number(state.spent[key]) || 0) - 1);
    if (command === 'reset') Object.assign(state, { spent: {}, pendingSwift: 0, turn: 1, onTurn: true, pendingFollowups:[] });
    if (command === 'add') {
      state.folded[`card:${state.cards.length}`] = false;
      state.folded[`editor:${state.cards.length}`] = false;
      state.cards = [...state.cards, { title: 'New option', type: key, note: '', cost: '1' }];
    }
    if (command === 'unlink') {
      const source = sessionShortcuts(model).find(s => s.key === state.cards[i].source);
      const card = effectiveAction(model,state.cards[i]);
      state.cards[i] = { ...card, source: '', note: [...new Set([source?.note,card.note].filter(Boolean))].join('\n') };
    }
    update(state);
  }));
  root.querySelectorAll('[data-session-field]').forEach(el => el.addEventListener('change', () => {
    const typeChange = el.dataset.sessionField.match(/^cards\.(\d+)\.type$/);
    if (typeChange) { moveSessionCard(model, Number(typeChange[1]), {type:el.value}); render(); return; }
    const featureField = el.dataset.sessionField.match(/^cards\.(\d+)\.([a-zA-Z]+)$/);
    const feature = featureField && linkedFeature(model,sessionState(model).cards[Number(featureField[1])]);
    if (feature && featureField[2]!=='width') {
      model.set(`progression.actionFeatures.${actionFeatures(model).indexOf(feature)}.${featureField[2]}`,el.value);render();return;
    }
    model.set(`session.${el.dataset.sessionField}`, el.type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value);
    render();
  }));
  root.querySelectorAll('[data-session-choice]').forEach(el => el.addEventListener('click', () => {
    const state = editableSession(model);
    const index = Number(el.dataset.choiceIndex);
    state.cards[Number(el.dataset.sessionChoice)].selectedId = state.cards[index].id;
    state.folded[`card:${index}`] = false;
    update(state);
    root.querySelector(`[data-session-choice="${el.dataset.sessionChoice}"][data-choice-index="${index}"]`)?.focus({preventScroll:true});
  }));
  root.querySelectorAll('[data-session-membership]').forEach(el => el.addEventListener('change', () => {
    const i = Number(el.dataset.sessionMembership);
    moveSessionCard(model, i, {type:sessionState(model).cards[i].type, groupId:el.value}); render();
  }));
  root.querySelectorAll('[data-session-shortcut]').forEach(el => el.addEventListener('change', () => {
    const source = sessionShortcuts(model).find(s => s.key === el.value);
    if (!source) return;
    const state = sessionState(model);
    state.cards = [...state.cards, { title: source.title, source: source.key, type: el.dataset.sessionShortcut, cost: '1' }];
    update(state);
  }));
  root.querySelectorAll('[data-session-fold]').forEach(el => el.addEventListener('toggle', () => {
    if (!el.isConnected) return;
    const key = el.dataset.sessionFold, state = sessionState(model);
    const defaultClosed = key === 'settings' || key.startsWith('card:') || key.startsWith('editor:');
    const wasOpen = defaultClosed ? state.folded[key] === false : !state.folded[key];
    if (wasOpen === el.open) return;
    state.folded[key] = !el.open;
    model.set('session', state);
  }));
}
