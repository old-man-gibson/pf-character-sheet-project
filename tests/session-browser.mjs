import '../app/js/sheet-element.js';
import { blankDocument } from '../app/js/convert.js';
import { forget } from '../app/js/history.js';
const run = document.querySelector('#run');
const status = document.querySelector('#status');
const assert = (v, message) => { if (!v) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
run.onclick = async () => {
  run.disabled = true;
  const doc = blankDocument({ name: 'Session browser checks', level: 5 });
  doc.id = `session-test-${Date.now()}`;
  doc.uiPrefs = { viewMode: 'session' };
  doc.equipment.weapons = [{ name: 'Training sword', attackType: 'Melee', dice: '1d6' }];
  doc.session = { cards: [{ title: 'Strike', type: 'standard', cost: '1' }] };
  const sheet = document.createElement('character-sheet');
  document.querySelector('#mount').replaceChildren(sheet);
  sheet.character = doc;
  await sheet.whenReady();
  const find = selector => sheet.shadowRoot.querySelector(selector);
  const click = async selector => { assert(find(selector), `Missing ${selector}`); find(selector).click(); await pause(); };
  const test = async (name, body) => {
    await body();
    const li = document.createElement('li'); li.textContent = `PASS: ${name}`; document.querySelector('#results').append(li);
  };
  try {
    await test('Opening the session view does not dirty the character', async () => {
      await pause();
      assert(sheet.changeCount === 0, 'Initial detail toggles created edits');
    });
    await test('Use spends an action and disables the option', async () => {
      await click('[data-session-command="use"]');
      assert(sheet.model.data.session.spent.standard === 1, 'Standard not spent');
      assert(find('[data-session-command="use"]').disabled, 'Spent action still usable');
    });
    await test('Next turn restores the action', async () => {
      await click('[data-session-command="next"]');
      assert(!find('[data-session-command="use"]').disabled, 'Use not restored');
    });
    await test('New option is editable and retains its expanded editor', async () => {
      await click('[data-session-command="add"][data-kind="move"]');
      const editor = find('[data-session-field="cards.1.title"]').closest('.session-editor');
      editor.open = true; await pause();
      const field = find('[data-session-field="cards.1.title"]');
      field.value = 'Advance'; field.dispatchEvent(new Event('change'));
      await pause();
      assert(sheet.model.data.session.cards[1].title === 'Advance', 'Edit lost');
      assert(find('[data-session-field="cards.1.title"]').closest('.session-editor').open, 'Editor collapsed on change');
    });
    await test('Collapsed groups remain collapsed after another action', async () => {
      find('[data-session-fold="move"]').open = false; await pause();
      await click('[data-session-command="spend"][data-kind="aoo"]');
      assert(!find('[data-session-fold="move"]').open, 'Fold lost');
    });
    await test('End turn blocks standard actions', async () => {
      await click('[data-session-command="end"]');
      assert(find('[data-session-command="use"]').disabled, 'Off-turn standard permitted');
    });
    await test('Shortcut picker adds a linked action in the selected group', async () => {
      const select = find('[data-session-shortcut="aoo"]');
      select.value = 'attack:Training sword'; select.dispatchEvent(new Event('change'));
      await pause();
      const card = sheet.model.data.session.cards.at(-1);
      assert(card.type === 'aoo' && card.source === 'attack:Training sword', 'Shortcut not linked');
      const group = find('[data-session-fold="aoo"]');
      assert(group.textContent.includes('Training sword'), 'Shortcut not displayed');
    });
    await test('General actions accept roll formulas and show them while closed', async () => {
      find('[data-session-fold="move"]').open = true; await pause();
      for (const [key, value] of Object.entries({attackFormula:'12', damageFormula:'2d6 + 3', range:'30 ft.', targets:'One creature'})) {
        const field = find(`[data-session-field="cards.1.${key}"]`);
        field.value = value; field.dispatchEvent(new Event('change')); await pause();
      }
      find('[data-session-fold="card:1"]').open = false; await pause();
      const card = find('[data-session-fold="card:1"]').closest('.session-option');
      assert(card.querySelector('.session-roll-values').textContent.includes('+12'), 'Attack summary missing');
      assert(card.querySelector('.session-roll-values').textContent.includes('2d6+3'), 'Damage summary missing');
      assert(card.querySelector('.session-card-facts').textContent.includes('30 ft.'), 'Range missing');
      assert(card.querySelector('[data-roll="session|1:damage"]'), 'Damage copy button missing');
      assert(!find('[data-session-fold="card:1"]').open, 'Summary requires open details');
    });
    await test('Damage copying uses the custom formula without spending an action', async () => {
      const before = JSON.stringify(sheet.model.data.session.spent);
      await click('[data-roll="session|1:damage"]');
      for (let i = 0; i < 100 && !find('.rolltext'); i++) await pause();
      assert(find('.rolltext')?.value.includes('2d6+3'), 'Copied damage not shown');
      assert(!find('.rolltext').value.includes('1d20'), 'Damage-only button included an attack');
      assert(JSON.stringify(sheet.model.data.session.spent) === before, 'Copying spent an action');
    });
    const indexOf = title => sheet.model.data.session.cards.findIndex(c => c.title === title);
    const drag = async (index, selector) => {
      const handle = find(`[data-session-drag="${index}"]`), target = find(selector);
      assert(handle && target, 'Drag source or destination missing');
      const transfer = new DataTransfer(), rect = target.getBoundingClientRect();
      handle.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+2}));
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+2}));
      handle.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));
      await pause();
    };
    await test('Drag cards between action types and into a choice group', async () => {
      await click('[data-session-command="choice-add"][data-kind="standard"]');
      await drag(indexOf('Strike'), `[data-session-group-drop="${indexOf('New choice group')}"]`);
      await drag(indexOf('Training sword'), 'summary[data-session-type-drop="standard"]');
      assert(sheet.model.data.session.cards[indexOf('Training sword')].type === 'standard','Action type not changed');
      await drag(indexOf('Training sword'), `[data-session-group-drop="${indexOf('New choice group')}"]`);
      const group = find('.session-choice');
      assert(group.querySelectorAll('.session-option').length === 1,'Group renders all choices');
      assert(group.querySelectorAll('[data-session-choice]').length === 2,'Choice buttons missing');
    });
    await test('Choosing an alternative changes the displayed card without spending', async () => {
      const before = JSON.stringify(sheet.model.data.session.spent);
      await click(`[data-session-choice][data-choice-index="${indexOf('Training sword')}"]`);
      assert(find('.session-choice .session-option').textContent.includes('Training sword'),'Selected card not displayed');
      assert(find(`[data-session-choice][data-choice-index="${indexOf('Training sword')}"]`).getAttribute('aria-pressed') === 'true','Selection not highlighted');
      assert(find(`[data-session-fold="card:${indexOf('Training sword')}"]`).open,'Choice details not opened');
      assert(JSON.stringify(sheet.model.data.session.spent) === before,'Choosing spent an action');
    });
    await test('Choice buttons collapse independently and stay collapsed after edits', async () => {
      find('.session-choice-picker').open = false; await pause();
      await click('[data-session-command="restore"][data-kind="aoo"]');
      assert(!find('.session-choice-picker').open,'Choices reopened after edit');
      assert(find('.session-choice .session-option').textContent.includes('Training sword'),'Selected action disappeared');
      const button = find('[data-session-choice]');
      assert(!button.checkVisibility(),'Choice button still visible');
    });
    await test('Groups drag as a unit, and ungrouping keeps their cards', async () => {
      await drag(indexOf('New choice group'), 'summary[data-session-type-drop="full"]');
      assert(!find('.session-choice-picker').open,'Dragging lost collapsed choice state');
      assert(sheet.model.data.session.cards[indexOf('Strike')].type === 'full','Child action type not moved');
      assert(sheet.model.data.session.cards[indexOf('Training sword')].type === 'full','Second child not moved');
      await click(`[data-session-command="remove"][data-index="${indexOf('New choice group')}"]`);
      assert(indexOf('Strike') >= 0 && indexOf('Training sword') >= 0,'Ungroup deleted children');
      assert(!sheet.model.data.session.cards[indexOf('Strike')].groupId,'Child still grouped');
    });
    status.textContent = 'All session browser checks passed';
  } catch (error) { status.textContent = `FAIL: ${error.message}`; }
  finally { await forget(doc.id); run.disabled = false; }
};
