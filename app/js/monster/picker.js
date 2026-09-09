/**
 * The picker's side of the monster tool: a + Monster button while the GM
 * view is on, and the dialog it opens.
 *
 * Mounted by the host page with one call. The page's own markup and script
 * are not edited for it: the dialog and its styles are written into the
 * document here, and the button is placed into the picker after each of the
 * picker's own redraws (watched, since the picker rewrites itself). The
 * document the dialog produces goes through the page's own `add`, so it is
 * vetted, stored and listed exactly as an import is.
 *
 * The reader is loaded on the first open rather than with the page: it is
 * the GM's tool, and most visitors are not the GM.
 */

const STYLE = `
  dialog#monsterDialog {
    background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 10px; padding: 18px 20px; width: min(44rem, 92vw);
  }
  dialog#monsterDialog::backdrop { background: rgba(0,0,0,0.55); }
  dialog#monsterDialog h2 { margin: 0 0 6px; font-size: 1rem; color: var(--accent); }
  dialog#monsterDialog .hint { margin: 0 0 12px; font-size: 0.8rem; color: var(--muted); }
  dialog#monsterDialog label { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 0.85rem; }
  dialog#monsterDialog label input {
    flex: 1; font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px;
  }
  dialog#monsterDialog textarea {
    display: block; width: 100%; box-sizing: border-box; min-height: 14rem; resize: vertical;
    font: inherit; font-size: 0.8rem; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
  }
  dialog#monsterDialog .preview { font-size: 0.8rem; color: var(--muted); min-height: 1.2em; margin: 8px 0 0; }
  dialog#monsterDialog .preview.err { color: #e0635f; }
  dialog#monsterDialog .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  dialog#monsterDialog button {
    font: inherit; font-size: 0.85rem; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: 20px; padding: 5px 14px; cursor: pointer;
  }
  dialog#monsterDialog button.primary { border-color: var(--accent); color: var(--accent); }
`;

const DIALOG = `
  <form id="monsterForm" method="dialog">
    <h2>New monster from a stat block</h2>
    <p class="hint">Paste a creature's stat block — Archives of Nethys, d20pfsrd, a PDF — from its
      <em>Name CR n</em> line down through its description. The reader takes the scores, AC,
      hit points, saves, attacks, feats, skills and special abilities onto a sheet whose
      numbers come out exactly as pasted and still move when a score is edited. Lines it
      cannot place are kept on the Stat Block tab to file by hand.</p>
    <textarea name="block" spellcheck="false" placeholder="Baalzebul CR 30
XP 9,830,400
LE Large outsider (devil, evil, extraplanar, lawful)
Init +14; Senses …
Defense
AC 48, touch 40, flat-footed 37 (…)
hp 717 (35d10+525)
…"></textarea>
    <p class="preview" id="monsterPreview"></p>
    <label>Name <input name="name" type="text" maxlength="80" placeholder="Read from the block unless given" autocomplete="off"></label>
    <div class="actions">
      <button type="button" id="monsterCancel">Cancel</button>
      <button type="submit" class="primary">Create</button>
    </div>
  </form>`;

/**
 * @param {object} host
 * @param {HTMLElement} host.picker      the roster nav the page redraws
 * @param {HTMLElement} [host.welcome]   the welcome page's button row, if any
 * @param {HTMLInputElement} host.adminToggle  the GM / inspector switch
 * @param {(doc: object, warnings: string[], origin: string) => unknown} host.add
 *        the page's own way of taking a document in
 */
export function mountMonsterTool({ picker, welcome, adminToggle, add }) {
  const doc = picker.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);
  const dialog = doc.createElement('dialog');
  dialog.id = 'monsterDialog';
  dialog.innerHTML = DIALOG;
  doc.body.append(dialog);
  const form = dialog.querySelector('#monsterForm');
  const preview = dialog.querySelector('#monsterPreview');

  let reader = null;
  const loadReader = () => {
    reader ??= import('./import.js');
    return reader;
  };
  const open = () => {
    loadReader();
    preview.textContent = '';
    preview.classList.remove('err');
    dialog.showModal();
    form.elements.block.focus();
  };
  dialog.querySelector('#monsterCancel').addEventListener('click', () => dialog.close());

  // The preview line: what the reader makes of the paste as it is typed, so
  // a block that came through wrong is seen before it becomes a sheet.
  form.elements.block.addEventListener('input', async () => {
    const text = form.elements.block.value;
    if (!text.trim()) { preview.textContent = ''; return; }
    const { parseStatBlock, describeBlock } = await loadReader();
    const block = parseStatBlock(text);
    const read = describeBlock(block);
    const notes = [...block.warnings, block.unread.length
      ? `${block.unread.length} line${block.unread.length === 1 ? '' : 's'} not placed` : ''].filter(Boolean);
    preview.textContent = `${block.name ? `${block.name}: ` : ''}${read || 'nothing read yet'}${notes.length ? ` — ${notes.join('; ')}` : ''}`;
    preview.classList.toggle('err', !read);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { parseStatBlock, monsterDocument, describeBlock } = await loadReader();
    const block = parseStatBlock(form.elements.block.value);
    if (!describeBlock(block)) {
      preview.textContent = 'Nothing here reads as a stat block — it wants a "Name CR n" line, then the AC, hp and ability-score lines.';
      preview.classList.add('err');
      return;
    }
    const name = form.elements.name.value.trim();
    if (name) block.name = name;
    const document_ = monsterDocument(block);
    dialog.close();
    form.reset();
    const warnings = [...block.warnings];
    if (block.unread.length) {
      warnings.push(`${block.unread.length} line${block.unread.length === 1 ? ' was' : 's were'} not placed and wait on the Stat Block tab`);
    }
    add(document_, warnings, 'monster');
  });

  // The buttons come and go with the GM view. The picker one is placed
  // after the page's own + Import whenever the picker has just been drawn
  // unfolded; the welcome one is made once and shown or hidden.
  let welcomeBtn = null;
  if (welcome) {
    welcomeBtn = doc.createElement('button');
    welcomeBtn.type = 'button';
    welcomeBtn.textContent = '+ Monster from a stat block';
    welcomeBtn.addEventListener('click', open);
    welcome.append(welcomeBtn);
  }
  const place = () => {
    const on = !!adminToggle.checked;
    if (welcomeBtn) welcomeBtn.hidden = !on;
    const have = picker.querySelector('#monsterBtn');
    const after = picker.querySelector('#importBtn');
    if (!on || !after) { have?.remove(); return; }
    if (have) return;
    const b = doc.createElement('button');
    b.id = 'monsterBtn';
    b.className = after.className;
    b.title = "Paste a stat block off a page and get it as a sheet: the GM's monster view";
    b.textContent = '+ Monster';
    b.addEventListener('click', open);
    after.after(b);
  };
  new MutationObserver(place).observe(picker, { childList: true });
  adminToggle.addEventListener('change', place);
  place();
  return { open };
}
