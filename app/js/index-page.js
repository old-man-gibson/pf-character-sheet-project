// The script of app/index.html: the character picker, import, removal and the
// banner, the Extensions and Rules dialogs, and the GM tools menu. Kept out of
// the page so the page can forbid inline scripts (its Content-Security-Policy).
// Paths in fetch() and markup still resolve against the page, app/.
  import './sheet-element.js';
  import { inspectDocument } from './model.js';
  import { historyFor, forget } from './history.js';
  import { zip, safeName } from './zip.js';
  import { downloadFile } from './download.js';
  import { runtime as extensions } from './extension-runtime.js';
  import { looksLikeExtension, looksLikeLibrary } from './extensions.js';
  import { mountMonsterTool } from './monster/picker.js';
  import { normalizeHex, readableOn } from './tracker-style.js';
  import { esc } from './html-escape.js';
  import { gmToolsList } from './gm-tools.js';
  import { CAMPAIGN_DEFAULTS, campaignRules } from './model/campaign.js';
  import { readShared, writeShared } from './shared-rules.js';
  import * as roster from './roster.js';
  import { LAST_KEY, docKey, editsKey } from './roster.js';

  const sheet = document.getElementById('sheet');
  const picker = document.getElementById('picker');
  const adminToggle = document.getElementById('adminToggle');
  const banner = document.getElementById('banner');
  const importFile = document.getElementById('importFile');
  const newDialog = document.getElementById('newDialog');
  const newForm = document.getElementById('newForm');
  const importDialog = document.getElementById('importDialog');
  const welcome = document.getElementById('welcome');
  document.getElementById('newCancel').addEventListener('click', () => newDialog.close());
  /*
   * The New character dialog, at the campaign's lowest level: the one the
   * campaign rules every character shares give (shared-rules.js), the table's
   * 3rd where nothing is shared. The first character in a browser with none
   * also asks for that level -- the lowest a character can have in this
   * campaign -- and sets it as the standard every character shares. A level
   * below it may still be typed, from 1; a note says where the lowest level
   * is changed.
   */
  const newFirst = document.getElementById('newFirst');
  const newBelow = document.getElementById('newBelow');
  const standardLowest = () => {
    const shared = readShared();
    return shared?.on ? campaignRules({ campaign: shared.rules }).minLevel : CAMPAIGN_DEFAULTS.minLevel;
  };
  // What a typed level is measured against: the lowest being set, on a first character.
  const dialogLowest = () => (newFirst.hidden ? standardLowest()
    : Math.max(1, Math.floor(Number(newForm.elements.lowest.value)) || 1));
  function noteBelow() {
    const lowest = dialogLowest();
    const level = Math.floor(Number(newForm.elements.level.value));
    const below = Number.isFinite(level) && level >= 1 && level < lowest;
    newBelow.hidden = !below;
    newBelow.textContent = below ? `Below this campaign's lowest level, ${lowest}. The lowest level is a campaign `
      + 'rule: set it under Campaign rules on any character\'s ⚙ tab, or in Extensions and Rules.' : '';
  }
  function openNewDialog() {
    const first = library.length === 0;
    newFirst.hidden = !first;
    newFirst.disabled = !first;
    const lowest = String(standardLowest());
    newForm.elements.lowest.value = lowest;
    newForm.elements.lowest.dataset.was = lowest;
    newForm.elements.level.value = lowest;
    noteBelow();
    newDialog.showModal();
  }
  newForm.elements.level.addEventListener('input', noteBelow);
  // The level follows the lowest being set, until it is typed in itself.
  newForm.elements.lowest.addEventListener('input', () => {
    const el = newForm.elements.lowest;
    if (newForm.elements.level.value === el.dataset.was) newForm.elements.level.value = el.value;
    el.dataset.was = el.value;
    noteBelow();
  });
  /** Make `value` the campaign's lowest level, shared by every character (a lowest past the highest raises it). */
  function setCampaignLowest(value) {
    const lowest = Math.max(1, Math.floor(Number(value)) || CAMPAIGN_DEFAULTS.minLevel);
    const rules = { ...(readShared()?.rules || {}) };
    if (lowest === CAMPAIGN_DEFAULTS.minLevel) delete rules.minLevel;
    else rules.minLevel = lowest;
    if (lowest > campaignRules({ campaign: rules }).maxLevel) rules.maxLevel = lowest;
    writeShared({ on: true, rules });
  }
  // Cancel closes with no returnValue, which askWhereToPut reads as "not now";
  // Import closes with 'go'. A dialog dismissed with Escape lands on the same
  // empty value, so the two ways of backing out behave alike.
  document.getElementById('importCancel').addEventListener('click', () => importDialog.close(''));
  document.getElementById('importForm').addEventListener('submit', (e) => {
    e.preventDefault();
    importDialog.close('go');
  });
  const removeDialog = document.getElementById('removeDialog');

  // Help: on the button, and on a browser's first visit, once.
  const helpDialog = document.getElementById('helpDialog');
  const HELP_SEEN = 'character-sheet:help-seen';
  document.getElementById('helpBtn').addEventListener('click', () => helpDialog.showModal());
  document.getElementById('helpClose').addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('close', () => {
    try { localStorage.setItem(HELP_SEEN, '1'); } catch { /* not fatal */ }
  });
  try {
    if (!localStorage.getItem(HELP_SEEN)) helpDialog.showModal();
  } catch { /* no storage: no first-visit popup either */ }
  // GM tools: the tools in gm-module/ (see js/gm-tools.js). The list is read
  // the first time the menu opens: from tools/serve.mjs when the sheet runs on
  // this computer, otherwise from the static files, which list the tools that
  // work on a site with no server of their own. Each tool opens in a tab of
  // its own and keeps its saved files apart from the characters.
  const gmTools = document.getElementById('gmTools');
  const gmToolsBtn = document.getElementById('gmToolsBtn');
  const gmToolsDrop = document.getElementById('gmToolsList');
  let gmToolsLoaded = null;
  const loadGmTools = () => (gmToolsLoaded ??= gmToolsList().then((tools) => {
    gmToolsDrop.innerHTML = tools.length
      ? tools.map((t) => `<a href="../gm-module/${esc(encodeURI(t.href))}" target="_blank" rel="noopener">${esc(t.name)}<small>${esc(t.description)}</small></a>`).join('')
      : '<p class="hint">No GM tools here.</p>';
  }));
  const setGmToolsOpen = (open) => {
    gmTools.classList.toggle('open', open);
    gmToolsBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!gmToolsLoaded) gmToolsDrop.innerHTML = '<p class="hint">Loading…</p>';
      loadGmTools();
    }
  };
  gmToolsBtn.addEventListener('click', () => setGmToolsOpen(!gmTools.classList.contains('open')));
  gmTools.addEventListener('click', (e) => { if (e.target.closest('a')) setGmToolsOpen(false); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#gmTools')) setGmToolsOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gmTools.classList.contains('open')) {
      setGmToolsOpen(false);
      gmToolsBtn.focus();
    }
  });

  const removeForm = document.getElementById('removeForm');
  document.getElementById('removeCancel').addEventListener('click', () => removeDialog.close());
  document.getElementById('welcomeNew').addEventListener('click', () => openNewDialog());
  document.getElementById('welcomeImport').addEventListener('click', () => importFile.click());

  /*
   * Two kinds of character can sit in the picker.
   *
   * Bundled ones are static files under data/characters/, listed by index.json
   * -- the published app ships none, so the roster there is empty, but a
   * deployment that wants to pre-load characters drops their JSON in and lists
   * them. Imported ones exist only in this browser: the page cannot write to
   * data/, so an imported document lives in localStorage and the list kept by
   * roster.js is what makes it show up again after a reload.
   */
  // A private window can throw on any touch of localStorage; roster.js reads
  // a null storage as empty and refuses to write to it.
  const storage = (() => { try { return localStorage; } catch { return null; } })();

  let bundled = [];
  try {
    const index = await (await fetch('../data/characters/index.json')).json();
    bundled = (index.characters || []).map((c) => ({ ...c, local: false }));
  } catch { /* no roster file at all reads the same as an empty one */ }

  /** True when the list was saved. Says why when it was not. */
  function writeLibrary(list) {
    try {
      roster.writeLibrary(storage, list);
      return true;
    } catch (err) {
      say('err', err?.name === 'QuotaExceededError'
        ? 'Could not save the character list. This browser is out of space.'
        : `Could not save the character list: ${err?.message}`);
      return false;
    }
  }
  const readTrash = () => roster.readTrash(storage);
  const writeTrash = (list) => roster.writeTrash(storage, list);

  const read = roster.readLibrary(storage, inspectDocument);
  let library = read.list;
  if (read.rebuilt && writeLibrary(library)) {
    say('info', `The character list in this browser could not be read. It was rebuilt from the ${library.length} `
      + `character${library.length === 1 ? '' : 's'} stored here.`);
  }
  const all = () => [...bundled, ...library];

  /*
   * Removed characters are not erased, they are put out of sight.
   *
   * A × pressed by mistake used to take hours of work with it, at once and for
   * good. Now the entry moves from the library to this list and nothing else
   * is touched: the document, the working edits and the history all stay in
   * storage under the same keys, so Undo is just moving the entry back. What
   * is here is erased for real when it is a day old (checked on each load),
   * or sooner when the browser runs out of room for a new character.
   */
  const TRASH_TTL = 24 * 60 * 60 * 1000;
  /** Erase for real: the document, the edits and every history record. */
  async function erase(id) {
    localStorage.removeItem(docKey(id));
    await forget(id, { storageKey: editsKey(id) });
  }
  /** Empty the trash of what is older than `age`; everything, with 0. */
  async function emptyTrash(age = TRASH_TTL) {
    const now = Date.now();
    const keep = [];
    // A character still in the list is never erased, whatever the trash says.
    const listed = new Set(library.map((c) => c.id));
    for (const c of readTrash()) {
      if (listed.has(c.id)) continue;
      if (now - (c.removedAt || 0) >= age) await erase(c.id);
      else keep.push(c);
    }
    writeTrash(keep);
    return keep;
  }
  /*
   * The character you had open, not the first one on the list.
   *
   * Checked against the roster rather than trusted: a character can be removed
   * between one visit and the next, and landing on "its data is missing" would
   * be a worse greeting than landing on the wrong character. Per browser rather
   * than in any document -- which character you were looking at is not a fact
   * about any of them.
   */
  const lastOpened = () => {
    try { return localStorage.getItem(LAST_KEY); } catch { return null; }
  };
  let current = (() => {
    const want = lastOpened();
    return all().some((c) => c.id === want) ? want : all()[0]?.id;
  })();

  /** `action` is an optional { label, run } -- the Undo after a removal. */
  function say(kind, text, action = null) {
    banner.innerHTML = `<div class="banner ${kind}"><span></span>${action ? '<button class="act"></button>' : ''}<button>Dismiss</button></div>`;
    banner.querySelector('span').textContent = text;
    if (action) {
      const act = banner.querySelector('button.act');
      act.textContent = action.label;
      act.addEventListener('click', () => { banner.innerHTML = ''; action.run(); });
    }
    banner.querySelector('button:last-child').addEventListener('click', () => { banner.innerHTML = ''; });
  }

  // Names and ids in an imported file are arbitrary text, so nothing reaches
  // the picker's markup unescaped (esc, from html-escape.js).

  /*
   * The picker can fold to just the open character -- on a phone the full
   * roster is most of the screen. The choice is remembered per browser, and
   * a browser that never chose starts folded when the viewport is narrow.
   */
  const FOLD_KEY = 'character-sheet:picker-folded';
  function pickerFolded() {
    try {
      const saved = localStorage.getItem(FOLD_KEY);
      if (saved !== null) return saved === '1';
    } catch { /* no storage: fall through to the viewport */ }
    return window.matchMedia('(max-width: 900px)').matches;
  }
  function setPickerFolded(on) {
    try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch { /* not fatal */ }
  }

  function draw() {
    const folded = pickerFolded();
    const roster = all();
    const shown = folded ? roster.filter((c) => c.id === current) : roster;
    const others = roster.length - shown.length;
    // The surface a row's ink has to be read on, once per draw.
    const panel = normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--cs-bg')) || '#14161c';
    // The colour is worn at reading strength: the chip rule in chrome.css sets
    // the words in `--entry-color`, so the hue goes in already corrected.
    const tint = (c) => {
      const hex = normalizeHex(c.color);
      return hex ? ` class="chip pick tinted" style="--entry-color:${readableOn(hex, panel)}"` : ' class="chip pick"';
    };
    const chip = (c) => (c.local
      ? `<span class="member local">
           <button${tint(c)} data-id="${esc(c.id)}" aria-pressed="${c.id === current}" title="${esc(c.name)}. Right-click to colour">
             <span class="cname">${esc(c.name)}</span> <b>L${esc(c.level)}</b><span class="local-tag">${{ blank: 'new', copy: 'copy' }[c.origin] || 'imported'}</span>
           </button>
           <button class="drop" data-drop="${esc(c.id)}" title="Remove from this browser"
             aria-label="Remove ${esc(c.name)}">×</button>
         </span>`
      : `<span class="member"><button${tint(c)} data-id="${esc(c.id)}" aria-pressed="${c.id === current}" title="${esc(c.name)}. Right-click to colour">
           <span class="cname">${esc(c.name)}</span> <b>L${esc(c.level)}</b>
         </button></span>`);
    // Where the list was scrolled, so a redraw -- a colour picked, a level
    // changed -- does not throw the player back to the top of it.
    const oldBox = picker.querySelector('.roster');
    const keptScroll = picker.slot === 'rail' && oldBox?.clientHeight ? oldBox.scrollTop : null;
    picker.innerHTML = `${folded
    ? `<button class="chip fold" id="unfoldBtn" aria-expanded="false"
          title="Show every character, and the new/import/export controls">▸ ${others > 0 ? `${others} more` : 'roster'}…</button>`
    : `<button class="chip fold" id="foldBtn" aria-expanded="true"
        title="Fold the picker to just the open character">▾ Fold</button>`}
      <div class="rosterwrap">
        <button type="button" class="more up" hidden tabindex="-1" aria-hidden="true"></button>
        <div class="roster">${shown.map(chip).join('')}</div>
        <button type="button" class="more down" hidden tabindex="-1" aria-hidden="true"></button>
      </div>
      ${folded ? '' : `<button class="chip import" id="newBtn" title="Start a character from a blank sheet">+ New</button>
      ${current ? '<button class="chip import" id="dupBtn" title="Add a copy of the open character, as it is now">Duplicate</button>' : ''}
      <button class="chip import" id="importBtn" title="Add a character: a .xlsx workbook, or a JSON this app exported">+ Import</button>
      <button class="chip exportall" id="exportAllBtn"
        title="Download every character in this picker as one .zip">Export all</button>`}`;
    bindRosterScroll(keptScroll);

    picker.querySelectorAll('button.pick').forEach((b) => {
      b.addEventListener('click', () => { current = b.dataset.id; rememberOpen(); select(); draw(); });
      // Right-click colours the character, the way it colours a tab on the
      // bar. The colour is the character's own (identity.color), so the sheet
      // has to be showing that character to write it: a row that is not the
      // open one is opened first, then the panel comes up at the pointer.
      b.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        if (b.dataset.id !== current) { current = b.dataset.id; rememberOpen(); select(); draw(); }
        await sheet.whenReady();
        sheet.openCharacterColor(e.clientX, e.clientY);
      });
    });
    picker.querySelectorAll('button.drop').forEach((b) => {
      b.addEventListener('click', () => remove(b.dataset.drop));
    });
    picker.querySelector('#newBtn')?.addEventListener('click', () => openNewDialog());
    picker.querySelector('#dupBtn')?.addEventListener('click', duplicateOpen);
    picker.querySelector('#importBtn')?.addEventListener('click', () => importFile.click());
    picker.querySelector('#exportAllBtn')?.addEventListener('click', exportAll);
    picker.querySelector('#foldBtn')?.addEventListener('click', () => { setPickerFolded(true); draw(); });
    picker.querySelector('#unfoldBtn')?.addEventListener('click', () => { setPickerFolded(false); draw(); });
  }

  /*
   * The rail's roster box: how many characters are out of sight above and
   * below, said on the bar at that edge, and a click on a bar scrolls a box's
   * worth that way. Only in the rail -- in the header the box is not one.
   */
  function bindRosterScroll(keptScroll) {
    const box = picker.querySelector('.roster');
    const up = picker.querySelector('.more.up');
    const down = picker.querySelector('.more.down');
    if (!box || !up || !down) return;
    const update = () => {
      const inRail = picker.slot === 'rail';
      const rows = [...box.children];
      const top = box.scrollTop;
      const bottom = top + box.clientHeight;
      // A row counts as out of sight once less than half of it shows.
      const above = inRail ? rows.filter((r) => r.offsetTop + r.offsetHeight / 2 < top).length : 0;
      const below = inRail ? rows.filter((r) => r.offsetTop + r.offsetHeight / 2 > bottom).length : 0;
      up.hidden = !above;
      down.hidden = !below;
      up.textContent = `▲ ${above} more`;
      down.textContent = `▼ ${below} more`;
    };
    up.addEventListener('click', () => box.scrollBy({ top: -box.clientHeight * 0.8, behavior: 'smooth' }));
    down.addEventListener('click', () => box.scrollBy({ top: box.clientHeight * 0.8, behavior: 'smooth' }));
    box.addEventListener('scroll', update, { passive: true });
    // The open character in view, without moving the page around it.
    const reveal = () => {
      const open = box.querySelector('[aria-pressed="true"]');
      if (!open) return;
      const r = open.closest('.member') || open;
      if (r.offsetTop < box.scrollTop || r.offsetTop + r.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = r.offsetTop - (box.clientHeight - r.offsetHeight) / 2;
      }
      update();
    };
    rosterUpdate = update;
    rosterReveal = reveal;
    if (keptScroll !== null) { box.scrollTop = keptScroll; update(); } else reveal();
    // The box has no height until the sheet has drawn its rail, and changes
    // with the window: recount on every resize, and bring the open character
    // into view the first time there is a box to bring it into.
    let shown = keptScroll !== null;
    new ResizeObserver(() => {
      if (!shown && box.clientHeight) { shown = true; reveal(); } else update();
    }).observe(box);
    requestAnimationFrame(update);
  }
  let rosterUpdate = () => {};
  let rosterReveal = () => {};

  /*
   * A character from nothing. `blankDocument` is the converter's own output for
   * a template with every cell empty, with a name and level filled in -- so it
   * takes exactly the path an imported document takes from here on: vetted by
   * inspectDocument, stored in localStorage, listed in the library.
   */
  newForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { blankDocument } = await import('./convert.js');
    const doc = blankDocument({
      name: newForm.elements.name.value,
      level: newForm.elements.level.value,
      player: newForm.elements.player.value,
      // Any level from 1 up: the campaign rules say what is usual, not this box.
      minLevel: 1,
      maxLevel: Infinity,
    });
    // The first character sets the campaign's lowest level for every character,
    // before it opens, so it opens under it.
    if (!newFirst.hidden) setCampaignLowest(newForm.elements.lowest.value);
    // Every new character opens on its campaign rules first (the sheet's ⚙
    // tab), to be confirmed or changed before anything else; Continue there
    // takes the flag off.
    doc.uiPrefs = { ...(doc.uiPrefs || {}), rulesFirst: true };
    newDialog.close();
    newForm.reset();
    add(doc, [], 'blank');
  });

  /*
   * Export all: every character in the picker, as one .zip.
   *
   * The point is a backup that can be put back. Each entry is a plain document
   * of exactly the kind Export JSON writes, so any one of them drops straight
   * back in through Import -- there is no bundle format to explain, and nothing
   * that only this page can read. A ZIP because five characters are ~620 KB of
   * JSON and ~100 KB compressed.
   *
   * Which version of a character gets packed is the same question the sheet
   * answers when it opens one, and the answer has to match: the version the
   * player last saved, or where they last left off if they have not saved, or
   * the converted document if they have never touched it.
   */
  async function exportAll() {
    const button = picker.querySelector('#exportAllBtn');
    const entries = all();
    button.disabled = true;
    button.textContent = 'Packing…';
    say('info', `Collecting ${entries.length} character${entries.length === 1 ? '' : 's'}…`);

    const files = [];
    const missing = [];
    const taken = new Set();
    try {
      for (const entry of entries) {
        const doc = await currentDocument(entry);
        if (!doc) { missing.push(entry.name); continue; }
        // Two characters may share a display name, and a ZIP with two identical
        // entry names is a ZIP that loses one of them.
        let name = safeName(doc.identity?.name || entry.name || entry.id, entry.id);
        if (taken.has(name.toLowerCase())) name = `${name} (${entry.id})`;
        taken.add(name.toLowerCase());
        files.push({ name: `${name}.json`, data: JSON.stringify(doc, null, 1) });
      }

      if (!files.length) { say('err', 'There was nothing to export.'); return; }

      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([await zip(files)], { type: 'application/zip' });
      downloadFile(`character-sheets-${stamp}.zip`, blob);

      const size = (blob.size / 1024).toFixed(0);
      say(missing.length ? 'info' : 'ok',
        `Exported ${files.length} character${files.length === 1 ? '' : 's'} (${size} KB).`
        + (missing.length ? ` Could not read ${missing.join(', ')}.` : ''));
    } catch (err) {
      say('err', `Could not build the archive — ${err.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Export all';
    }
  }

  /** The version of a character that opening it in the sheet would show. */
  async function currentDocument(entry) {
    const store = historyFor(entry.id);
    const saved = await store.readSaved();
    if (saved?.data) return saved.data;
    const working = store.readWorking();
    if (working?.data) return working.data;
    if (entry.local) {
      const raw = localStorage.getItem(docKey(entry.id));
      return raw ? JSON.parse(raw) : null;
    }
    try {
      const res = await fetch(`../data/characters/${entry.file || `${entry.id}.json`}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /** Which character to open next time. Never worth failing a click over. */
  function rememberOpen() {
    try {
      if (current) localStorage.setItem(LAST_KEY, current);
      else localStorage.removeItem(LAST_KEY);
    } catch { /* a private window keeps nothing; the picker still works */ }
  }

  function select() {
    const entry = all().find((c) => c.id === current);
    // Nothing in the picker at all: a fresh visitor, or the last character
    // removed. Show the welcome instead of a sheet stuck on "Loading…".
    welcome.hidden = Boolean(entry);
    sheet.hidden = !entry;
    if (!entry) return;
    if (!entry.local) {
      sheet.setAttribute('src', `../data/characters/${entry.file || `${entry.id}.json`}`);
      return;
    }
    // An imported character has no URL to fetch: hand the document over
    // directly, and drop any src so the element does not re-fetch over it.
    const raw = localStorage.getItem(docKey(entry.id));
    if (!raw) { say('err', `${entry.name} is listed but its data is missing.`); return; }
    sheet.removeAttribute('src');
    sheet.character = JSON.parse(raw);
  }

  /** A character already in the picker keeps its id; a clash gets the next free one. */
  function freeId(wanted) {
    // A removed character still holds its keys until the trash is emptied, so
    // its id is not free either -- or an import could land on its document.
    const taken = new Set([...all(), ...readTrash()].map((c) => c.id));
    if (!taken.has(wanted)) return wanted;
    let n = 2;
    while (taken.has(`${wanted}-${n}`)) n += 1;
    return `${wanted}-${n}`;
  }

  /*
   * Where an imported character should land: beside the ones already here, or
   * over one of them.
   *
   * A workbook is exported again every time it changes, so most imports after
   * the first are the *same* character coming back with another level on it --
   * and the old behaviour, silently making "angou-2", left a roster of
   * near-duplicates with no way to say which was current. Asking is one click
   * and it is the click that decides which of two things is happening.
   *
   * Resolves to an id to replace, or null for a new character. Skipped
   * entirely when there is nothing to replace.
   */
  function askWhereToPut(summary) {
    const mine = library;
    if (!mine.length) return Promise.resolve(null);
    const form = document.getElementById('importForm');
    const target = document.getElementById('importTarget');
    document.getElementById('importName').textContent = summary.name;
    document.getElementById('importWhat').textContent =
      `Level ${summary.level}${summary.classes?.length ? ` ${summary.classes.join(' / ')}` : ''}`
      + `${summary.race ? `, ${summary.race}` : ''}.`;
    // The likeliest answer first: a character already here under the id this
    // one would take is almost certainly the same character, re-exported.
    const match = mine.find((c) => c.id === summary.id)
      || mine.find((c) => c.name?.toLowerCase() === summary.name?.toLowerCase());
    target.innerHTML = mine.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} — level ${esc(c.level)}</option>`).join('');
    form.reset();
    if (match) target.value = match.id;
    const sync = () => { target.disabled = form.how.value !== 'replace'; };
    form.addEventListener('change', sync);
    sync();
    importDialog.showModal();
    return new Promise((resolve) => {
      const done = () => {
        form.removeEventListener('change', sync);
        importDialog.removeEventListener('close', done);
        resolve(importDialog.returnValue === 'go' && form.how.value === 'replace'
          ? target.value : (importDialog.returnValue === 'go' ? null : undefined));
      };
      importDialog.addEventListener('close', done);
    });
  }

  /**
   * Put an imported document over a character already in the picker.
   *
   * The slot, the id and the history stay; what was there is filed as a named
   * checkpoint first, so "replace" is never a way to lose a character. The
   * working edits go, and the import becomes the saved version — otherwise the
   * sheet would open on half-finished edits to a document that no longer
   * exists and quietly write the old character back.
   */
  async function replaceWith(id, doc, warnings) {
    const entry = all().find((c) => c.id === id);
    const verdict = inspectDocument(doc);
    // Not `store`: that name is the helper below that writes the document.
    const revisions = historyFor(id, { storageKey: editsKey(id) });
    const before = entry ? await currentDocument(entry) : null;
    const stored = { ...doc, id };
    // History first: a replace that could not keep the current version would lose it.
    if (before) {
      try {
        await revisions.checkpoint(before, 'before import');
      } catch {
        say('err', `Could not replace ${entry.name}. Its current version could not be saved to History.`);
        return null;
      }
    }
    if (!(await store(docKey(id), stored, verdict.summary.name))) return null;
    try {
      revisions.clearWorking();
      await revisions.save(stored);
    } catch { /* no database: the document is in, the history simply is not */ }
    // A bundled character replaced becomes one of this browser's own.
    library = library.some((c) => c.id === id)
      ? library.map((c) => (c.id === id ? { ...verdict.summary, color: doc.identity?.color || null, id, origin: 'import', local: true } : c))
      : [...library, { ...verdict.summary, color: doc.identity?.color || null, id, origin: 'import', local: true }];
    const listed = writeLibrary(library);
    current = id;
    draw();
    select();
    if (!listed) return id;   // writeLibrary said why
    say(warnings.length ? 'info' : 'ok',
      `Replaced ${entry?.name || id} with ${verdict.summary.name} (level ${verdict.summary.level}).`
      + (before ? ' The old version is in History as “before import”.' : '')
      + (warnings.length ? ` Note — ${warnings.join('; ')}.` : ''));
    return id;
  }

  /**
   * Duplicate: the open character as it is on screen -- unsaved edits
   * included -- added beside it under the next free id. The copy starts with
   * no history and no publish link of its own; both are keyed by id.
   */
  async function duplicateOpen() {
    await sheet.whenReady();
    const doc = sheet.character;
    if (!doc) { say('err', 'There is no open character to copy.'); return; }
    const copy = structuredClone(doc);
    copy.identity = { ...(copy.identity || {}), name: `${copy.identity?.name || 'Character'} (copy)` };
    await addNew(copy, [], 'copy', inspectDocument(copy));
  }

  /** `origin` is 'import' for a file, 'blank' for a character started here, 'copy' for a duplicate. */
  function add(doc, warnings = [], origin = 'import') {
    const verdict = inspectDocument(doc);
    if (!verdict.ok) { say('err', verdict.error); return null; }
    if (origin === 'import' && library.length) {
      askWhereToPut(verdict.summary).then((into) => {
        if (into === undefined) { say('info', `${verdict.summary.name} was not imported.`); return null; }
        return into ? replaceWith(into, doc, warnings) : addNew(doc, warnings, origin, verdict);
      }).catch((err) => say('err', `Could not import ${verdict.summary.name}: ${err.message}`));
      return null;
    }
    return addNew(doc, warnings, origin, verdict);
  }

  async function addNew(doc, warnings, origin, verdict) {
    if (!verdict.ok) { say('err', verdict.error); return null; }
    const id = freeId(verdict.summary.id);
    const stored = { ...doc, id };
    if (!(await store(docKey(id), stored, verdict.summary.name))) return null;
    const grown = [...library, { ...verdict.summary, color: doc.identity?.color || null, id, origin, local: true }];
    if (!writeLibrary(grown)) {
      // Not in the list, the document would sit in storage where nothing can reach it.
      try { localStorage.removeItem(docKey(id)); } catch { /* nothing more to undo */ }
      return null;
    }
    library = grown;
    current = id;
    rememberOpen();
    draw();
    select();
    // Warnings mean the workbook converted but did not look like the campaign
    // template, so the sheet will be thin in places. Better said than
    // discovered.
    say(warnings.length ? 'info' : 'ok',
      `${{ blank: 'Created', copy: 'Added' }[origin] || 'Imported'} ${verdict.summary.name} (level ${verdict.summary.level})`
      + `${id === verdict.summary.id ? '' : ` as “${id}”, because “${verdict.summary.id}” was taken`}.`
      + (warnings.length ? ` Note — ${warnings.join('; ')}.` : '')
      + (origin !== 'import' ? ' It is saved in this browser like an import; use Export JSON to keep a copy.' : ''));
    return id;
  }

  /**
   * Write a character's document, making room if the browser is full.
   *
   * The trash is the first thing to go: what it holds was removed on purpose,
   * and the alternative is refusing the character that is being added now.
   * Says why on failure; true on success.
   */
  async function store(key, stored, name) {
    const json = JSON.stringify(stored);
    for (const attempt of [0, 1]) {
      try {
        localStorage.setItem(key, json);
        return true;
      } catch (err) {
        if (err.name === 'QuotaExceededError' && attempt === 0 && readTrash().length) {
          await emptyTrash(0);
          continue;
        }
        say('err', `Could not store ${name} — ${err.name === 'QuotaExceededError'
          ? 'this browser is out of space. Remove an imported character and try again.'
          : err.message}`);
        return false;
      }
    }
    return false;
  }

  /** The × on a chip: ask first, then put the character out of sight. */
  let removing = null;
  function remove(id) {
    const entry = library.find((c) => c.id === id);
    if (!entry) return;
    document.getElementById('removeName').textContent = entry.name;
    removing = id;
    removeDialog.showModal();
  }
  removeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = removing;
    removing = null;
    removeDialog.close();
    if (id) discard(id);
  });

  function discard(id) {
    const entry = library.find((c) => c.id === id);
    if (!entry) return;
    const { local, ...rest } = entry;
    // The trash first: out of the list but not in the trash, a character can
    // be neither restored nor erased.
    const trash = readTrash();
    if (!writeTrash([...trash.filter((c) => c.id !== id), { ...rest, removedAt: Date.now() }])) {
      say('err', `Could not remove ${entry.name}. This browser could not save the change.`);
      return;
    }
    const remaining = library.filter((c) => c.id !== id);
    if (!writeLibrary(remaining)) { writeTrash(trash); return; }
    library = remaining;
    if (current === id) current = all()[0]?.id;
    rememberOpen();
    draw();
    select();
    say('ok', `Removed ${entry.name} from this browser. It is kept out of sight for a day, then erased with its history.`,
      { label: 'Undo', run: () => restore(id) });
  }

  /** Undo a removal: the entry comes back, and everything under it was never gone. */
  function restore(id) {
    const trash = readTrash();
    const entry = trash.find((c) => c.id === id);
    if (!entry) { say('err', 'That character has already been erased.'); return; }
    const { removedAt, ...rest } = entry;
    // The list first: out of the trash but not in the list, it could not be found again.
    const back = [...library.filter((c) => c.id !== id), { ...rest, local: true }];
    if (!writeLibrary(back)) return;
    library = back;
    writeTrash(trash.filter((c) => c.id !== id));
    current = id;
    rememberOpen();
    draw();
    select();
    say('ok', `${entry.name} is back, with its edits and history.`);
  }

  /** "2 hours ago", for the offer to restore on the next visit. */
  function ago(when) {
    const mins = Math.max(0, Math.round((Date.now() - when) / 60000));
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }

  /*
   * Both ways in land here: the + Import chip and a file dropped on the page.
   *
   * The sheet element does the work — parsing an exported document, or
   * transcribing a workbook — and announces a good one with `character-import`,
   * which the listener below turns into a library entry. So all this has to do
   * is say up front that a workbook will take a moment, and report a refusal.
   */
  async function addFromFile(file) {
    // A .json can be a character or an extension pack; the pack says so in its
    // first line, so it is sniffed before the character importer gets it.
    if (/\.json$/i.test(file.name || '')) {
      let doc = null;
      try { doc = JSON.parse(await file.text()); } catch { /* the sheet's importer will say why */ }
      if (looksLikeExtension(doc) || looksLikeLibrary(doc)) { extManager().then((m) => m.importDoc(doc), () => {}); return; }
    }
    if (/\.xls[xm]$/i.test(file.name || '')) {
      say('info', `Converting ${file.name} — this runs in your browser; the workbook is not uploaded anywhere.`);
      // Let the banner paint before the parse takes over the main thread.
      await new Promise(requestAnimationFrame);
    }
    const verdict = await sheet.importFile(file);
    if (!verdict.ok) say('err', verdict.error);
  }

  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    importFile.value = '';               // so the same file can be picked twice
    if (file) addFromFile(file);
  });

  // The sheet's own Import button loads into the element; the library picks it
  // up here so it survives a reload and joins the picker.
  sheet.addEventListener('character-import', (e) => add(e.detail.character, e.detail.warnings));
  // …and an extension pack handed to the sheet's Import goes to the manager.
  sheet.addEventListener('extension-import', (e) => { e.preventDefault(); extManager().then((m) => m.importDoc(e.detail.extension), () => {}); });

  // Drop a file anywhere on the page.
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    picker.classList.add('dragging');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) picker.classList.remove('dragging');
  });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    picker.classList.remove('dragging');
    addFromFile(e.dataTransfer.files[0]);
  });

  adminToggle.addEventListener('change', () => {
    sheet.setAttribute('role', adminToggle.checked ? 'admin' : 'player');
  });

  /*
   * The page wears whatever the sheet is wearing.
   *
   * The palettes are declared once, in app/css/sheet.css, as the custom
   * properties the sheet reads -- and a custom property's computed value can
   * be read off the element from outside its shadow root. So the page keeps
   * no palette of its own: after each change it copies the handful it needs
   * onto :root, and the picker, banners and dialogs above follow. The sheet
   * announces a change with `theme-change`; the first copy is taken here,
   * since the element applied the remembered choice when it connected.
   *
   * The accent is read with the character's own colour lifted off first: that
   * is set inline on the element and would otherwise be what the page took,
   * and it changes with the character rather than with the theme.
   */
  const CHROME_VARS = [
    '--cs-bg', '--cs-panel', '--cs-panel-2', '--cs-line', '--cs-text', '--cs-muted',
    '--cs-accent', '--cs-accent-soft', '--cs-edit', '--cs-good', '--cs-bad',
    '--cs-font', '--cs-mono', '--cs-display',
  ];
  function followSheet() {
    const root = document.documentElement;
    const own = sheet.style.getPropertyValue('--cs-accent');
    if (own) sheet.style.removeProperty('--cs-accent');
    const cs = getComputedStyle(sheet);
    for (const name of CHROME_VARS) {
      const v = cs.getPropertyValue(name).trim();
      if (v) root.style.setProperty(name, v);
    }
    if (own) sheet.style.setProperty('--cs-accent', own);
    root.style.colorScheme = sheet.getAttribute('scheme') === 'light' ? 'light' : 'dark';
    root.dataset.scheme = sheet.getAttribute('scheme') === 'light' ? 'light' : 'dark';
    root.dataset.theme = sheet.getAttribute('theme') || 'dark';
    root.dataset.layout = sheet.getAttribute('layout') || 'top';
    root.dataset.width = sheet.getAttribute('width') || 'standard';
    placePicker();
  }

  /*
   * Where the roster stands: in the header as a strip, or inside the sheet's
   * own rail under its tabs. The sheet's rail is a column from 780px of sheet,
   * which with this page's margins is about 820px of window; below that the
   * sheet's rail is the bar again and a roster slotted into it would sit in
   * the bar's sticky strip, so it goes back to the header. The node is moved,
   * not rebuilt, and everything bound to it comes along.
   */
  const railFits = window.matchMedia('(min-width: 820px)');
  function placePicker() {
    const inRail = document.documentElement.dataset.layout === 'side' && railFits.matches;
    if (inRail) {
      picker.slot = 'rail';
      if (picker.parentElement !== sheet) sheet.prepend(picker);
    } else {
      picker.removeAttribute('slot');
      if (picker.parentElement === sheet) document.querySelector('header.app h1').after(picker);
    }
    // The box only scrolls in the rail, so the open character is brought into
    // view once it has arrived there.
    pinUnderHeader();
    requestAnimationFrame(() => { pinUnderHeader(); rosterReveal(); });
  }
  railFits.addEventListener('change', placePicker);
  window.addEventListener('resize', () => rosterUpdate());

  // The sheet scrolls in its own pane under the bar, so its pinned rail rests
  // at the top of that pane (`--cs-sticky-top` 0) and is as tall as the pane
  // (`--cs-view-height`), which follows every change to it -- the window, the
  // roster strip wrapping to a second row, the picker moving to the rail.
  // A function declaration, so placePicker can call it too: moving the roster
  // between the bar and the rail changes the bar's height, and the pane's.
  function pinUnderHeader() {
    sheet.style.setProperty('--cs-sticky-top', '0px');
    // Not before it has a height: a hidden sheet would size its rail to nothing.
    if (sheet.clientHeight) sheet.style.setProperty('--cs-view-height', `${sheet.clientHeight}px`);
  }
  new ResizeObserver(pinUnderHeader).observe(sheet);
  window.addEventListener('resize', pinUnderHeader);
  pinUnderHeader();
  // The roster is drawn again as well: a row's ink is picked to be read on the
  // panel it sits on, and the panel has just changed colour.
  sheet.addEventListener('theme-change', () => { followSheet(); draw(); });
  followSheet();

  // A colour picked on the sheet -- in Details, or from the roster's own
  // right-click -- lands on the roster row as it is picked. The library entry
  // carries it so the row is tinted next visit before any sheet has loaded.
  sheet.addEventListener('character-change', (e) => {
    const color = e.detail?.character?.identity?.color || null;
    const entry = library.find((c) => c.id === current);
    if (!entry || (entry.color || null) === color) return;
    library = library.map((c) => (c.id === current ? { ...c, color } : c));
    writeLibrary(library);
    draw();
  });

  /*
   * Extensions and Rules: the packs this browser holds and the campaign rules
   * every character can share, managed in a dialog. The runtime
   * is loaded here as well as by the sheet (both keep the one promise), so the
   * dialog can list the bundled packs before any character has opened.
   */
  // The dialog's code, with the paste and PDF readers it brings, is fetched
  // the first time it is wanted: most visits never open it.
  let managerLoading = null;
  const extManager = () => (managerLoading ??= import('./extension-manager.js')
    .then((m) => m.mountExtensionManager(document.getElementById('extDialog'), {
      say,
      currentCharacter: () => (sheet.hidden ? null : sheet.character),
    }))
    .catch((err) => {
      managerLoading = null;
      say('err', `Could not open Extensions: ${err.message}`);
      throw err;
    }));
  extensions.load(new URL('../', document.baseURI));
  document.getElementById('extBtn').addEventListener('click', () => extManager().then((m) => m.open(), () => {}));
  // Fetched once the page is idle as well, so the offline copy (sw.js) has it.
  (window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(() => { import('./extension-manager.js').catch(() => {}); });

  // The GM's + Monster button and its dialog; see docs/monsters.md.
  mountMonsterTool({ picker, welcome: welcome.querySelector('.actions'), adminToggle, add });

  draw();
  select();

  // What was removed on an earlier visit is still restorable until it is a day
  // old; say so, unless the load already had something to say.
  emptyTrash().then((held) => {
    if (!held.length || banner.innerHTML) return;
    const latest = held.reduce((a, b) => ((b.removedAt || 0) > (a.removedAt || 0) ? b : a));
    say('info', `${latest.name} was removed ${ago(latest.removedAt || 0)}`
      + (held.length > 1 ? ` (and ${held.length - 1} more before it)` : '')
      + '. It is kept for a day, then erased.', { label: 'Restore', run: () => restore(latest.id) });
  });
