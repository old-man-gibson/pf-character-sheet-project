import '../app/js/sheet-element.js';
import { blankDocument } from '../app/js/convert.js';
import { SCHEMA_VERSION } from '../app/js/model.js';
import { historyFor, workingKey, forget } from '../app/js/history.js';

const run = document.querySelector('#run');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const mount = document.querySelector('#mount');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for browser state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

run.addEventListener('click', async () => {
  run.disabled = true;
  results.replaceChildren();
  mount.replaceChildren();
  let passed = 0;
  let failed = 0;
  const id = `browser-check-${crypto.randomUUID()}`;
  const doc = blankDocument({ id, name: 'Browser check', level: 10 });
  const history = historyFor(id);
  const sheet = document.createElement('character-sheet');
  sheet.setAttribute('packs', 'none');
  mount.append(sheet);
  const test = async (name, action) => {
    status.textContent = name;
    const row = document.createElement('li');
    try { await action(); row.className = 'pass'; row.textContent = `PASS: ${name}`; passed++; }
    catch (error) { row.className = 'fail'; row.textContent = `FAIL: ${name}: ${error.message}`; failed++; }
    results.append(row);
  };
  const editName = (value) => {
    const input = sheet.shadowRoot.querySelector('[data-set="identity.name"]');
    assert(input, 'Character name input missing');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  try {
    await test('Open a blank sheet', async () => {
      sheet.character = doc;
      await sheet.whenReady();
      assert(sheet.model.data.identity.name === 'Browser check', 'Wrong character');
      assert(sheet.shadowRoot.querySelector('#sheet-panel'), 'Panel missing');
    });
    await test('Typing persists a working copy and enables Save', async () => {
      editName('Saved browser check');
      await until(() => history.readWorking()?.data.identity.name === 'Saved browser check');
      await until(() => sheet.changeCount > 0);
    });
    await test('Save writes to real IndexedDB and survives reopening', async () => {
      sheet.shadowRoot.querySelector('[data-action="save"]').click();
      await until(async () => (await history.readSaved())?.data.identity.name === 'Saved browser check');
      sheet.character = doc;
      await sheet.whenReady();
      assert(sheet.model.data.identity.name === 'Saved browser check', 'Saved version lost');
      assert(sheet.changeCount === 0, 'Reopened saved version is dirty');
    });
    await test('Unsaved edits can be picked up after reopening', async () => {
      editName('Unsaved browser check');
      sheet.character = doc;
      await sheet.whenReady();
      assert(sheet.model.data.identity.name === 'Saved browser check', 'Canonical version did not open');
      const resume = sheet.shadowRoot.querySelector('[data-action="resume"]');
      assert(resume, 'Recovery offer missing');
      resume.click();
      await until(() => sheet.model.data.identity.name === 'Unsaved browser check');
    });
    await test('Edits made while Save is running remain unsaved', async () => {
      await until(() => sheet.shadowRoot.querySelector('[data-action="save"]')?.disabled === false
        && sheet.shadowRoot.querySelector('[data-set="identity.name"]')?.value === 'Unsaved browser check');
      sheet.shadowRoot.querySelector('[data-action="save"]').click();
      editName('Typed during Save');
      await until(() => sheet.shadowRoot.textContent.includes('Newer edits are still unsaved.'));
      assert((await history.readSaved()).data.identity.name === 'Unsaved browser check', 'Save captured later typing');
      assert(sheet.model.data.identity.name === 'Typed during Save', 'Later typing was lost');
      assert(sheet.changeCount > 0, 'Later typing was incorrectly marked saved');
      editName('Unsaved browser check');
    });
    await test('Named checkpoints survive Reset', async () => {
      const checkpointDoc = structuredClone(sheet.character);
      const checkpoint = await history.checkpoint(checkpointDoc, 'Before reset', 1);
      await history.snapshot(sheet.character, 20);
      await history.resetKeepingCheckpoints();
      const rows = await history.list();
      assert(rows.some((row) => row.key === checkpoint.key), 'Checkpoint lost');
      assert(rows.every((row) => row.kind === 'checkpoint'), 'Automatic snapshots survived Reset');
      assert(JSON.stringify(await history.load(checkpoint.key)) === JSON.stringify(checkpointDoc), 'Checkpoint payload changed');
    });
    await test('Unsupported working copies show a recovery download and survive editing', async () => {
      const old = JSON.stringify({ data: { ...doc, schemaVersion: SCHEMA_VERSION + 1 }, savedAt: '2026-01-01' });
      localStorage.setItem(workingKey(id), old);
      sheet.character = doc;
      await sheet.whenReady();
      assert(sheet.shadowRoot.querySelector('[data-action="export-recovery"]'), 'Recovery download missing');
      editName('After recovery');
      assert(history.readRecoveries().some((entry) => entry.raw === old), 'Earlier edits lost');
    });
    await test('Unsupported saved versions remain downloadable after a new Save', async () => {
      const old = { ...doc, schemaVersion: SCHEMA_VERSION + 1, identity: { ...doc.identity, name: 'Future version' } };
      await history.save(old);
      sheet.character = doc;
      await sheet.whenReady();
      assert(sheet.shadowRoot.querySelector('[data-action="export-saved-recovery"]'), 'Saved recovery download missing');
      assert((await history.readSaved()).data === null, 'Unsupported saved document was adopted');
      assert((await history.readSaved({ includeStale: true })).data.identity.name === 'Future version', 'Original save cannot be exported');
      await history.save(doc);
      const backup = (await history.list()).find((row) => row.stale && row.kind === 'checkpoint');
      assert(backup, 'New Save overwrote the unsupported version without a checkpoint');
      assert((await history.load(backup.key, { includeStale: true })).identity.name === 'Future version', 'Checkpoint does not contain original save');
      let refused = false;
      try { await history.load(backup.key); } catch { refused = true; }
      assert(refused, 'Normal restore should still refuse unsupported versions');
    });
    await test('Every default tab renders in the browser', async () => {
      const ids = [...sheet.shadowRoot.querySelectorAll('[role="tab"][id]')].map((tab) => tab.id);
      for (const tabId of ids) {
        sheet.shadowRoot.getElementById(tabId).click();
        assert(sheet.shadowRoot.querySelector('#sheet-panel')?.textContent.trim(), `Empty panel: ${tabId}`);
      }
    });
    await test('Print rules retain resource pips and readable colors', async () => {
      const root = sheet.shadowRoot;
      const print = new CSSStyleSheet();
      const rules = root.adoptedStyleSheets.flatMap((css) => [...css.cssRules])
        .filter((rule) => rule instanceof CSSMediaRule && rule.conditionText === 'print')
        .flatMap((rule) => [...rule.cssRules]).map((rule) => rule.cssText).join('\n');
      assert(rules, 'No print rules found');
      print.replaceSync(rules);
      // A copy: the property is a live list, and keeping the list itself kept
      // the print sheet added below for every check after this one.
      const original = [...root.adoptedStyleSheets];
      const probe = document.createElement('div');
      probe.innerHTML = '<button class="pip used">1</button><button class="pip zero">0</button><button class="edit-probe">Edit</button>';
      root.append(probe);
      try {
        root.adoptedStyleSheets = [...original, print];
        assert(getComputedStyle(probe.querySelector('.pip.used')).display !== 'none', 'Resource pip hidden');
        assert(getComputedStyle(probe.querySelector('.pip.zero')).display === 'none', 'Reset control printed');
        assert(getComputedStyle(probe.querySelector('.edit-probe')).display === 'none', 'Edit control printed');
        assert(getComputedStyle(sheet).getPropertyValue('--fx-number').trim() === '#1f7a43', 'Dark formula color printed');
      } finally { root.adoptedStyleSheets = original; probe.remove(); }
    });
    // Leaving a half-typed cell by pressing something else, in the order a real
    // press runs: the press, the cell's change, focus landing, the release.
    const pressOutOf = (edited, value, target) => {
      edited.focus();
      edited.value = value;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
      edited.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const release = (target) => target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true }));
    await test('A cell clicked into mid-edit opens where it was clicked', async () => {
      const root = sheet.shadowRoot;
      root.getElementById('tab-overview').click();
      const name = root.querySelector('[data-set="identity.name"]');
      pressOutOf(root.querySelector('[data-set="identity.heroPoints.current"]'), '2', name);
      assert(root.querySelector('[data-set="identity.name"]') === name, 'Re-rendered under the press');
      name.focus();
      name.setSelectionRange(3, 3);
      release(name);
      await until(() => root.querySelector('[data-set="identity.name"]') !== name);
      const now = root.activeElement;
      assert(now?.dataset.set === 'identity.name', 'Focus did not follow the click');
      assert(now.selectionStart === 3 && now.selectionEnd === 3, `Caret at ${now.selectionStart}, not where the click put it`);
      assert(sheet.model.data.identity.heroPoints.current === 2, 'The edit was lost');
    });
    await test('A box pressed mid-edit takes the click', async () => {
      const root = sheet.shadowRoot;
      const box = root.querySelector('[data-set="conditions.Blinded"]');
      const was = !!sheet.model.data.conditions.Blinded;
      pressOutOf(root.querySelector('[data-set="identity.heroPoints.current"]'), '1', box);
      release(box);
      // A click is a press and a release on the same element.
      if (root.querySelector('[data-set="conditions.Blinded"]') === box) box.click();
      await until(() => root.querySelector('[data-set="conditions.Blinded"]') !== box);
      assert(!!sheet.model.data.conditions.Blinded === !was, 'The click never reached the box');
      assert(sheet.model.data.identity.heroPoints.current === 1, 'The edit was lost');
    });
    // A date box reports a whole date as soon as its parts make one: typing
    // 01 01 2026 reports the year 2 on the way. Drawn again there, the box
    // came back with the cursor in its month and the rest of the year went in.
    await test('A date box being typed in is drawn again once it is left', async () => {
      const root = sheet.shadowRoot;
      sheet.model.set('wealth.oathOfOfferings', true);   // the box takes a date only while something is owed
      root.getElementById('tab-overview').click();
      const box = root.querySelector('[data-set="wealth.lastOffering"]');
      assert(box && !box.disabled, 'Last offering box missing');
      // Past the window in which the check before's press could still be
      // ending, so nothing here is put off for a press instead.
      await new Promise((resolve) => setTimeout(resolve, 200));
      box.focus();
      box.value = '0002-01-01';
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert(root.querySelector('[data-set="wealth.lastOffering"]') === box, 'Drawn again while still being typed in');
      assert(sheet.model.data.wealth.lastOffering === '0002-01-01', 'The date was not kept');
      box.value = '2026-01-01';
      box.dispatchEvent(new Event('change', { bubbles: true }));
      box.blur();
      // A window that does not itself have focus moves focus without firing
      // the event, so the leaving is said outright too; a box already left
      // has stopped listening for it.
      box.dispatchEvent(new FocusEvent('blur'));
      await until(() => root.querySelector('[data-set="wealth.lastOffering"]') !== box);
      assert(sheet.model.data.wealth.lastOffering === '2026-01-01', 'The last date was not kept');
      assert(root.querySelector('[data-set="wealth.lastOffering"]').value === '2026-01-01', 'Drawn without its date');
    });
    // Clicking into a date box ends the edit in the field before it, and the
    // render that edit owes waited for the date box's first value -- which is
    // the month, typed -- so the box was drawn again with its cursor sent back.
    await test('A date box clicked into from another field waits until it is left', async () => {
      const root = sheet.shadowRoot;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const box = root.querySelector('[data-set="wealth.lastOffering"]');
      assert(box && !box.disabled, 'Last offering box missing');
      pressOutOf(root.querySelector('[data-set="wealth.manaPerDay"]'), '12', box);
      box.focus();
      release(box);
      box.value = '2026-02-01';
      box.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert(root.querySelector('[data-set="wealth.lastOffering"]') === box, 'Drawn again on its first value');
      assert(sheet.model.data.wealth.manaPerDay === 12, 'The field before it lost its edit');
      box.blur();
      box.dispatchEvent(new FocusEvent('blur'));
      await until(() => root.querySelector('[data-set="wealth.lastOffering"]') !== box);
      assert(sheet.model.data.wealth.lastOffering === '2026-02-01', 'The date was not kept');
    });
    // A web address typed into a prose field (a Lore section here; notes,
    // feats and traits are the same field) is a link once the field is left.
    // A press on the link is left to the browser, whose click then follows
    // it; a press anywhere else on the text opens it to edit, as it always
    // has. Only presses are sent: a click on the link would leave this page.
    await test('A link in a prose field takes the press, and the rest of the field still edits', async () => {
      const root = sheet.shadowRoot;
      await new Promise((resolve) => setTimeout(resolve, 200));
      root.getElementById('tab-lore').click();
      root.querySelector('[data-add="backgroundSections"]').click();
      const index = sheet.model.data.backgroundSections.length - 1;
      const body = () => root.querySelector(`textarea[data-item="backgroundSections|${index}|text"]`);
      const typed = body();
      assert(typed, 'New section missing');
      typed.focus();
      typed.value = 'Map: https://example.com/map. Ask the GM.';
      typed.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => body() !== typed);
      body().blur();
      body().dispatchEvent(new FocusEvent('blur'));
      const wrap = body().closest('.prose');
      const link = wrap.querySelector('.prose-view a[href]');
      assert(link, 'The address is not a link');
      assert(link.getAttribute('href') === 'https://example.com/map', `Links to ${link.getAttribute('href')}`);
      assert(link.target === '_blank' && link.rel === 'noopener noreferrer', 'Not a new tab that is told nothing');
      const press = (target) => {
        const event = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true, button: 0 });
        target.dispatchEvent(event);
        return event;
      };
      const onLink = press(link);
      assert(!onLink.defaultPrevented, 'The press on the link was taken from the browser');
      assert(!wrap.classList.contains('editing') && root.activeElement !== body(), 'The press on the link opened the field');
      const onText = press(wrap.querySelector('.prose-view'));
      assert(onText.defaultPrevented && wrap.classList.contains('editing'), 'A press beside the link did not open the field');
      body().blur();
      body().dispatchEvent(new FocusEvent('blur'));
    });
    // The weapon's Special properties caption holds a long help, so the help's
    // button sat inside the field's label ahead of the field, and the label
    // passed every click on the field's computed view to the button.
    await test('A field whose caption holds a help keeps its own clicks', async () => {
      const root = sheet.shadowRoot;
      sheet.model.listAdd('equipment.weapons', { name: 'Help check', dice: '1d6', special: 'Bane {{2}} to hit' });
      const index = sheet.model.data.equipment.weapons.length - 1;
      root.getElementById('tab-overview').click();
      root.getElementById('tab-gear').click();
      const field = root.querySelector(`textarea[data-item="equipment.weapons|${index}|special"]`);
      assert(field, 'Special properties missing');
      const label = field.closest('label');
      const help = label?.querySelector('button.helpopen');
      assert(help, 'No help in the caption to test with');
      assert(label.control === field, `The label names ${label.control?.className || 'nothing'}, not the field`);
      const view = field.closest('.prose').querySelector('.prose-view');
      assert(view, 'No computed view');
      const shut = help.getAttribute('aria-expanded');
      view.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true, button: 0 }));
      view.click();
      assert(help.getAttribute('aria-expanded') === shut, 'A click on the field opened its help');
      assert(root.activeElement === field, 'A click on the field left it');
      field.blur();
      help.click();
      assert(help.getAttribute('aria-expanded') !== shut, 'The help button no longer opens the help');
      help.click();
    });
    // A worksheet cell is a one-line box until it holds a formula or a web
    // address, and a prose field from then on (rows.gridCell). An edit to a
    // worksheet redraws nothing else, so a box that gains one is drawn again
    // to show it: the value, or the link, which a press leaves to the browser.
    await test('A worksheet cell that gains an address or a formula is drawn again to show it', async () => {
      const root = sheet.shadowRoot;
      await new Promise((resolve) => setTimeout(resolve, 200));
      sheet.model.set('sheetTabs', [{ name: 'Scratch', custom: true, rows: [{ cells: ['words', null, null] }] }]);
      sheet.model.showTab('sys:Scratch');
      root.getElementById('tab-overview').click();   // drawn again, with the worksheet on the bar
      root.getElementById('tab-sys-0').click();
      const cell = (col) => root.querySelector(`[data-item="sheetTabs.0.rows|0|cells.${col}"]`);
      for (const [col, typed] of [[1, 'Map: https://example.com/grid.'], [2, 'Reach {= level * 2} ft.']]) {
        const box = cell(col);
        assert(box?.matches('input[data-gridcell]'), `Cell ${col} is not a plain box`);
        box.focus();
        box.value = typed;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => cell(col) !== box);
        cell(col).blur();
        cell(col).dispatchEvent(new FocusEvent('blur'));
      }
      const view = (col) => cell(col).closest('.prose')?.querySelector('.prose-view');
      assert(view(1)?.querySelector('a[href="https://example.com/grid"]'), 'The address is not a link');
      assert(view(2)?.querySelector('.tok')?.textContent === '20', 'The formula does not show its value');
      assert(cell(0).matches('input[data-gridcell]'), 'A cell of plain words is not a box');
      const wrap = cell(1).closest('.prose');
      const press = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true, button: 0 });
      view(1).querySelector('a').dispatchEvent(press);
      assert(!press.defaultPrevented && !wrap.classList.contains('editing'), 'A press on the link opened the cell');
    });
    // A chip list in a band asks for no width of its own, so beside its label
    // it was given none: one chip per line, each broken at its longest word.
    await test('The proficiency chips take the row beside their label', async () => {
      const root = sheet.shadowRoot;
      root.getElementById('tab-overview').click();
      const lists = [...root.querySelectorAll('.panel.proficiencies .profrow .chips')];
      assert(lists.length >= 5, 'Proficiency chip lists missing');
      for (const list of lists) {
        const row = list.parentElement.getBoundingClientRect().width;
        const width = list.getBoundingClientRect().width;
        assert(width > row / 2, `A chip list has ${Math.round(width)}px of a ${Math.round(row)}px row`);
        for (const chip of list.children) {
          assert(chip.getBoundingClientRect().height < 24, `"${chip.textContent}" is broken over two lines`);
        }
      }
    });
    // The row folds and Help buttons are put in by the render below 620px,
    // so a sheet dragged across that width has to be drawn again to gain or
    // lose them; before, it kept whichever it had.
    await test('A sheet crossing 620px wide gains and loses the narrow layout', async () => {
      const root = sheet.shadowRoot;
      root.getElementById('tab-overview').click();
      // The sheet hears of its width from a ResizeObserver, which reports on
      // drawn frames only; a window behind another draws none.
      const drawing = await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(true));
        setTimeout(() => resolve(false), 1000);
      });
      assert(drawing, 'The page is not being drawn; bring the window forward and run again');
      try {
        mount.style.width = '600px';
        await until(() => root.querySelector('button.rowfold'));
        mount.style.width = '900px';
        await until(() => !root.querySelector('button.rowfold'));
      } finally { mount.style.width = ''; }
    });
    // A full undo list in the side rail's column: its rows were squeezed to a
    // sliver of their text, and the list was wider than the rail.
    await test('The undo list stays readable in the side rail, and Clear asks twice', async () => {
      const root = sheet.shadowRoot;
      const layout = sheet.getAttribute('layout');
      try {
        mount.style.width = '900px';
        sheet.setAttribute('layout', 'side');
        for (let i = 0; i < 30; i++) sheet.model.applyDamage(1);
        await until(() => root.querySelector('.playundomore'));
        root.querySelector('.playundomore').click();
        await until(() => root.querySelector('.playundomenu'));
        const rail = root.querySelector('.railbody');
        const rows = [...root.querySelectorAll('.playundomenu button')];
        assert(rows.length === 31, `${rows.length} rows in the list`);
        for (const row of rows) {
          assert(row.scrollHeight <= row.clientHeight + 1, `"${row.textContent}" is ${row.clientHeight}px of ${row.scrollHeight}px`);
        }
        const menu = root.querySelector('.playundomenu').getBoundingClientRect();
        assert(menu.right <= rail.getBoundingClientRect().right + 0.5, 'The list is wider than the rail');
        assert(rail.scrollWidth <= rail.clientWidth, `The rail scrolls ${rail.scrollWidth - rail.clientWidth}px sideways`);
        const count = sheet.model.playActions.length;
        root.querySelector('[data-action="undo-play-clear"]').click();
        assert(sheet.model.playActions.length === count, 'The first press cleared the list');
        assert(/sure\?/.test(root.querySelector('[data-action="undo-play-clear"]')?.textContent), 'Clear did not ask');
        root.querySelector('[data-action="undo-play-clear"]').click();
        assert(sheet.model.playActions.length === 0 && !root.querySelector('.playundo'), 'The list is still there');
      } finally {
        if (layout) sheet.setAttribute('layout', layout);
        mount.style.width = '';
      }
    });
    // The app page scrolls the sheet in a box of its own under the app's bar,
    // and the page itself is meant never to scroll. The sheet's live region,
    // positioned against the page rather than the sheet, made the page as tall
    // as the sheet's content, and a tab switch then scrolled the page as well
    // as the box: the sheet slid up under the bar.
    await test("A tab switch scrolls only the sheet's own box and lands clear of the rail", async () => {
      const root = sheet.shadowRoot;
      const layout = sheet.getAttribute('layout');
      const page = document.scrollingElement;
      // The app page's own rules for the sheet (app/index.html), with the
      // both-edges gutter it gets on a wide window: the stray height only
      // counted towards the page with that gutter on.
      const box = { height: '360px', overflowY: 'auto', overflowX: 'hidden', scrollbarGutter: 'stable both-edges' };
      try {
        Object.assign(sheet.style, box);
        sheet.style.setProperty('--cs-view-height', '360px');
        mount.style.width = '900px';
        for (const side of [false, true]) {
          const where = side ? 'side rail' : 'tab bar';
          sheet.setAttribute('layout', side ? 'side' : 'top');
          root.getElementById('tab-overview').click();
          page.scrollTop = 0;
          const foot = sheet.getBoundingClientRect().bottom + 20;
          assert(page.scrollHeight <= Math.max(foot + 20, page.clientHeight),
            `The page runs ${Math.round(page.scrollHeight - foot)}px past the sheet's box (${where})`);
          sheet.scrollTop = sheet.scrollHeight;
          root.getElementById('tab-features').click();
          assert(page.scrollTop === 0, `The page scrolled ${Math.round(page.scrollTop)}px (${where})`);
          const top = sheet.getBoundingClientRect().top;
          const rail = root.querySelector('.tabrail').getBoundingClientRect();
          const body = root.querySelector('.body').getBoundingClientRect();
          assert(rail.top >= top - 0.5, `The rail starts ${Math.round(top - rail.top)}px above the box (${where})`);
          const line = top + (side ? 10 : Math.round(rail.height) + 10);
          assert(sheet.scrollTop > 0 && Math.abs(body.top - line) <= 1.5,
            `The panel lands ${Math.round(body.top - top)}px down the box, not ${Math.round(line - top)}px (${where})`);
        }
      } finally {
        if (layout) sheet.setAttribute('layout', layout); else sheet.removeAttribute('layout');
        for (const key of Object.keys(box)) sheet.style[key] = '';
        sheet.style.removeProperty('--cs-view-height');
        mount.style.width = '';
        page.scrollTop = 0;
      }
    });
  } finally {
    sheet.remove();
    await forget(id);
    localStorage.removeItem(`${workingKey(id)}:recovery`);
    localStorage.removeItem(`character-sheet:tab:${id}`);
    status.textContent = `${passed} passed, ${failed} failed`;
    run.disabled = false;
  }
});
