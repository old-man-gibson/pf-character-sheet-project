import { esc } from '../html.js';
import { D20_ICON } from '../roll.js';
import { sessionRolls } from '../../model/session-rolls.js';
import { renderedProse } from '../prose.js';
import { ACTION_TYPES, ACTION_POOLS, sessionState, actionBudget, planAction, useSessionAction,
  advanceTurn, sessionShortcuts } from '../../model/session.js';

const button = (command, text, attrs = '') => `<button data-session-command="${command}" ${attrs}>${text}</button>`;
const input = (field, value, attrs = '') => `<input data-session-field="${field}" value="${esc(String(value ?? ''))}" ${attrs}>`;

export function renderSessionBoard(model) {
  const state = sessionState(model), budget = actionBudget(model, state), shortcuts = sessionShortcuts(model);
  const types = (selected) => ACTION_TYPES.map(([key, label]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${label}</option>`).join('');
  const cardHtml = (card, index) => {
    const source = card.source ? shortcuts.find(x => x.key === card.source) : null;
    const title = card.title || source?.title || 'Untitled option';
    const plan = planAction(model, card, state, budget);
    const missing = card.source && !source;
    const reason = missing ? 'Source missing or renamed; edit this shortcut before using it' : plan.error;
    const tracker = model.trackers.find(t => t.id === card.resource);
    const edit = `cards.${index}`;
    const values = sessionRolls(model, card);
    const copy = (part, label) => `<button class="d20" data-roll="session|${index}:${part}" data-rollwhat="${esc(title)}" aria-label="Copy ${label} roll for ${esc(title)}" title="Copy ${label} roll for Roll20" ${values.errors.length ? 'disabled' : ''}>${D20_ICON}</button>`;
    const rollSummary = `<div class="session-roll-values">
      ${values.attack ? `<span><small>Attack</small><strong>${esc(values.attack)}</strong>${copy('attack', 'attack')}</span>` : ''}
      ${values.damage ? `<span><small>Damage</small><strong>${esc(values.damage)}</strong>${copy('damage', 'damage')}</span>` : ''}
      </div>`;
    return `<article class="session-option ${reason ? 'unavailable' : ''}">
      <details data-session-fold="card:${index}" ${state.folded[`card:${index}`] === false ? 'open' : ''}>
        <summary>${esc(title)}${card.resource ? `<small>${esc(card.cost || '1')} ${esc(tracker?.name || 'missing resource')}</small>` : ''}</summary>
        ${source ? `<p class="session-source">Linked ${esc(source.kind)} · ${esc(source.title)}</p>` : ''}
        ${source?.note ? `<div class="session-description">${renderedProse(model, source.note)}</div>` : ''}
        ${card.note ? `<div class="session-description">${renderedProse(model, card.note)}</div>` : ''}
        ${values.spec.rolls.length ? `<div class="session-source">Copy all rolls ${copy('all', 'all')}</div>` : ''}
        <details class="session-editor" data-session-fold="editor:${index}" ${state.folded[`editor:${index}`] === false ? 'open' : ''}><summary>Edit option</summary>
          <label>Title ${input(`${edit}.title`, card.title, 'aria-label="Option title"')}</label>
          <label>Action <select data-session-field="${edit}.type">${types(card.type)}</select></label>
          <div class="session-settings-grid">
            <label>Attack bonus or formula ${input(`${edit}.attackFormula`, card.attackFormula, 'placeholder="e.g. attack.melee or bab + dex.mod"')}</label>
            <label>Damage roll ${input(`${edit}.damageFormula`, card.damageFormula, 'placeholder="e.g. 2d6 + str.mod"')}</label>
            ${[['range', 'Range'], ['targets', 'Targets / area'], ['save', 'Save / DC'], ['duration', 'Duration']].map(([key,label]) => `<label>${label} ${input(`${edit}.${key}`, card[key], `placeholder="${esc(String(values[key] || ''))}"`)}</label>`).join('')}
          </div>
          <p class="hint">Leave blank to follow the linked source. Attack takes a number or formula. Damage accepts dice plus a formula, such as <code>2d6 + str.mod</code> or <code>{floor(level / 2)}d6</code>. Text fields accept inline values such as <code>{caster.dc}</code>. Custom rolls do not add other bonuses automatically; <code>attack.melee</code> and <code>attack.ranged</code> include current conditions. Overrides omit the linked weapon’s critical rolls.</p>
          <label>Notes <textarea data-session-field="${edit}.note">${esc(card.note || '')}</textarea></label>
          <label>Resource <select data-session-field="${edit}.resource"><option value="">No resource cost</option>
            ${card.resource && !tracker ? `<option value="${esc(card.resource)}" selected>Missing resource — choose another</option>` : ''}
            ${model.trackers.map(t => `<option value="${esc(t.id)}" ${card.resource === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label>Cost (number or formula) ${input(`${edit}.cost`, card.cost ?? '1')}</label>
          <p class="hint">Using adds this cost to the resource’s spent / accumulated amount.</p>
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
      <div>${state.onTurn ? button('end', 'End turn') : ''} ${button('next', state.onTurn ? 'Next turn' : 'Start my turn')}</div></header>
    <div class="session-budget">${ACTION_POOLS.map(([key, label]) => `<div class="session-pool ${!budget[key].remaining ? 'spent' : ''}">
      <span>${label}</span><strong>${budget[key].remaining}<small> / ${budget[key].max}</small></strong>
      <div>${button('spend', '−', `data-kind="${key}" aria-label="Spend one ${label}" ${planAction(model, {type:key}, state, budget).error ? 'disabled' : ''}`)}${button('restore', '+', `data-kind="${key}" aria-label="Restore one ${label}"`)}</div>
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
      const cards = state.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.type === key);
      return `<details class="session-group" data-session-fold="${key}" ${state.folded[key] ? '' : 'open'}>
        <summary><span>${label}</span><small>${cards.length} option${cards.length === 1 ? '' : 's'}${budget[key] ? ` · ${budget[key].remaining} left` : ''}</small></summary>
        <div class="session-options">${cards.map(({ c, i }) => cardHtml(c, i)).join('')}</div>
        <div class="session-add">${button('add', '+ Custom option', `data-kind="${key}"`)}
          <select data-session-shortcut="${key}" aria-label="Add ${label} shortcut"><option value="">+ Link an attack or ability…</option>${shortcuts.map(s => `<option value="${esc(s.key)}">${esc(s.kind)} · ${esc(s.title)}</option>`).join('')}</select></div>
      </details>`;
    }).join('')}</div>
    <p class="hint">Choose your go-to options above. Titles open details; Use spends the action and configured resource. Undo restores both.</p>
  </section>`;
}

export function bindSessionBoard(root, model, render) {
  const update = state => { model.set('session', state); render(); };
  root.querySelectorAll('[data-session-command]').forEach(el => el.addEventListener('click', () => {
    const state = sessionState(model), key = el.dataset.kind, i = Number(el.dataset.index);
    const command = el.dataset.sessionCommand;
    if (command === 'use') { useSessionAction(model, state.cards[i]); render(); return; }
    if (command === 'spend') { useSessionAction(model, {type:key}); render(); return; }
    if (command === 'next' || command === 'end') { advanceTurn(model, command === 'next'); render(); return; }
    model.markUndo(`Session: ${command}`);
    if (command === 'restore') state.spent[key] = Math.max(0, (Number(state.spent[key]) || 0) - 1);
    if (command === 'reset') Object.assign(state, { spent: {}, pendingSwift: 0, turn: 1, onTurn: true });
    if (command === 'add') {
      state.folded[`card:${state.cards.length}`] = false;
      state.folded[`editor:${state.cards.length}`] = false;
      state.cards = [...state.cards, { title: 'New option', type: key, note: '', cost: '1' }];
    }
    if (command === 'remove') state.cards = state.cards.filter((_, n) => n !== i);
    if (command === 'unlink') {
      const source = sessionShortcuts(model).find(s => s.key === state.cards[i].source);
      state.cards[i] = { ...state.cards[i], source: '', note: [source?.note, state.cards[i].note].filter(Boolean).join('\n') };
    }
    if (command === 'up' || command === 'down') {
      const indices = state.cards.map((c, n) => c.type === state.cards[i].type ? n : -1).filter(n => n >= 0);
      const j = indices[indices.indexOf(i) + (command === 'up' ? -1 : 1)];
      if (j !== undefined) [state.cards[i], state.cards[j]] = [state.cards[j], state.cards[i]];
    }
    update(state);
  }));
  root.querySelectorAll('[data-session-field]').forEach(el => el.addEventListener('change', () => {
    model.set(`session.${el.dataset.sessionField}`, el.type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value);
    render();
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
