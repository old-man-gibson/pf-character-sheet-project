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
      const original = root.adoptedStyleSheets;
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
  } finally {
    sheet.remove();
    await forget(id);
    localStorage.removeItem(`${workingKey(id)}:recovery`);
    status.textContent = `${passed} passed, ${failed} failed`;
    run.disabled = false;
  }
});
