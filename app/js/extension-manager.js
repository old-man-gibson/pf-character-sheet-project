/**
 * The Extensions dialog: where a player sees the packs this browser has,
 * switches them on and off, brings one in, writes one, and sends one out.
 *
 *   import { mountExtensionManager } from './extension-manager.js';
 *   const mgr = mountExtensionManager(dialogElement, {
 *     say(kind, text) {},              // the host page's banner
 *     currentCharacter() {},           // the open sheet's data, for "from this character"
 *   });
 *   mgr.open();  mgr.importFile(file);  mgr.importText(json);
 *
 * Renders into the dialog with plain DOM and its own scoped stylesheet, so a
 * host page needs nothing but a `<dialog>` to give it. Everything it does goes
 * through `extension-runtime.js`, so the sheet on the same page sees a change
 * the moment it is made.
 *
 * Two views. The **list** is the packs, bundled first (a deployment's, not
 * editable here -- copy one to make it yours) then local. The **editor** is a
 * form for a pack: its header, and its blocks as one small form each, with the
 * whole document also editable as JSON for anyone who prefers that. Tables a
 * pack provides (a discipline catalogue…) are shown by count and edited as
 * JSON only: they are big, regular, and usually built by a tool.
 */

import { runtime } from './extension-runtime.js';
import {
  BLOCK_KINDS, TABLE_KINDS, inspectExtension, normalizeExtension, normalizeBlock, blankExtension,
  describeSummary, summarize, slugId, looksLikeExtension, blocksFromCharacter,
} from './extensions.js';
import { parsePaste, splitChunk } from './paste-import.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** A source is a link only when it is one; a book-and-page reads as text. */
const sourceLink = (source) => {
  const s = String(source || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s)
    ? ` <a href="${esc(s)}" target="_blank" rel="noopener">source</a>`
    : ` · ${esc(s)}`;
};

const CSS = `
.extmgr { font-size: 0.86rem; min-width: min(46rem, 94vw); max-width: 94vw; max-height: 88vh; overflow: auto; }
.extmgr h2 { margin: 0 0 4px; font-size: 1rem; }
.extmgr h3 { margin: 16px 0 6px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.75; }
.extmgr p.hint { margin: 0 0 10px; opacity: 0.75; line-height: 1.45; }
.extmgr .row { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--line, #333); }
.extmgr .row:first-of-type { border-top: 0; }
.extmgr .row .main { flex: 1; min-width: 0; }
.extmgr .row .name { font-weight: 600; }
.extmgr .row .meta { opacity: 0.7; font-size: 0.78rem; margin-top: 2px; }
.extmgr .row .meta a { color: inherit; }
.extmgr .row .acts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.extmgr .row.off .name, .extmgr .row.off .meta { opacity: 0.45; }
.extmgr button { font: inherit; font-size: 0.82rem; color: inherit; background: transparent; border: 1px solid var(--line, #555); border-radius: 16px; padding: 3px 11px; cursor: pointer; }
.extmgr button:hover { border-color: var(--accent, #d4a24a); }
.extmgr button.primary { border-color: var(--accent, #d4a24a); color: var(--accent, #d4a24a); }
.extmgr button.danger:hover { border-color: #e0635f; color: #e0635f; }
.extmgr button:disabled { opacity: 0.5; cursor: default; }
.extmgr label.sw { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; white-space: nowrap; }
.extmgr .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
.extmgr .actions .spacer { flex: 1; }
.extmgr textarea, .extmgr input[type=text], .extmgr input[type=number], .extmgr input[type=url], .extmgr select {
  font: inherit; font-size: 0.84rem; color: inherit; background: var(--bg, #111); border: 1px solid var(--line, #444); border-radius: 6px; padding: 4px 7px; }
.extmgr textarea { width: 100%; box-sizing: border-box; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 0.78rem; }
.extmgr textarea.prose { font-family: inherit; font-size: 0.84rem; }
.extmgr .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 8px 14px; }
.extmgr .fields label { display: flex; flex-direction: column; gap: 3px; font-size: 0.76rem; opacity: 0.9; }
.extmgr .fields label.wide { grid-column: 1 / -1; }
.extmgr .fields label.check { flex-direction: row; align-items: center; gap: 6px; }
.extmgr .fields input[type=number] { width: 5.5rem; }
.extmgr .block { border: 1px solid var(--line, #444); border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
.extmgr .block > .head { display: flex; gap: 8px; align-items: center; }
.extmgr .block > .head .kind { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 7px; border: 1px solid var(--line, #444); border-radius: 10px; opacity: 0.8; }
.extmgr .block > .head .title { flex: 1; font-weight: 600; }
.extmgr .block > .head button { padding: 1px 8px; }
.extmgr .block .body { margin-top: 8px; }
.extmgr .abil { display: flex; gap: 6px; flex-wrap: wrap; }
.extmgr .abil label { display: flex; flex-direction: column; font-size: 0.7rem; text-transform: uppercase; }
.extmgr .abil input { width: 3.6rem; }
.extmgr .err { color: #e0635f; margin: 8px 0; }
.extmgr .ok { color: #6bbf7b; margin: 8px 0; }
.extmgr code { background: var(--bg, #111); padding: 1px 4px; border-radius: 3px; }
.extmgr .paste { margin-top: 10px; }
.extmgr .land { font-size: 0.74rem; opacity: 0.65; margin-top: 4px; }
.extmgr .report { margin: 8px 0; padding: 8px 10px; border-left: 3px solid var(--accent, #d4a24a); font-size: 0.8rem; line-height: 1.5; }
.extmgr .found { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; border-top: 1px solid var(--line, #333); }
.extmgr .found:first-of-type { border-top: 0; }
.extmgr .found .kind { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 7px; border: 1px solid var(--line, #444); border-radius: 10px; opacity: 0.8; white-space: nowrap; }
.extmgr .found .what { flex: 1; min-width: 0; }
.extmgr .found .what .d { opacity: 0.65; font-size: 0.76rem; }
.extmgr .found.off .what { opacity: 0.45; text-decoration: line-through; }
.extmgr .left { border: 1px dashed var(--line, #444); border-radius: 8px; padding: 6px 10px; margin: 6px 0; }
.extmgr .left .top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.extmgr .left .top .near { opacity: 0.6; font-size: 0.74rem; }
.extmgr .left .top select { max-width: 18rem; }
.extmgr .left .top input[type=text] { width: 12rem; }
.extmgr .left pre { margin: 6px 0 0; white-space: pre-wrap; font: inherit; font-size: 0.78rem; opacity: 0.85; max-height: 7.5em; overflow: auto; }
.extmgr .left.skip pre { opacity: 0.4; }
`;

export function mountExtensionManager(dialog, { say = () => {}, currentCharacter = () => null } = {}) {
  let view = 'list';         // 'list' | 'edit'
  let draft = null;          // the pack being edited (normalized document)
  let draftIsNew = false;
  let asJson = false;
  let jsonText = '';
  let error = null;
  let notice = null;
  let showPaste = false;
  let confirmRemove = null;
  const openBlocks = new Set();
  /**
   * The paste importer's two stages inside the editor: `text` (a box to
   * paste into) and `review` (what was read, and the rest to tag). Null when
   * the editor shows its form.
   */
  let paste = null;   // { stage: 'text'|'review', text, result, keep: bool[], tags: [{choice, name}] }

  dialog.classList.add('extmgr');

  /* ---------------- rendering ---------------- */

  function render() {
    dialog.innerHTML = `<style>${CSS}</style>${view === 'edit' ? editorHtml() : listHtml()}`;
    bind();
  }

  function listHtml() {
    const store = runtime.store;
    const bundled = runtime.bundled;
    const off = store ? store.disabledBundled() : new Set();
    const local = store ? store.list() : [];
    const row = (s, { bundled: isBundled, enabled }) => `
      <div class="row ${enabled ? '' : 'off'}" data-id="${esc(s.id)}">
        <label class="sw" title="${enabled ? 'On — its tables and blocks are in use' : 'Off — ignored until switched on'}">
          <input type="checkbox" data-toggle="${esc(s.id)}" data-bundled="${isBundled}" ${enabled ? 'checked' : ''}>
        </label>
        <div class="main">
          <div class="name">${esc(s.name)} <span style="opacity:.55;font-weight:400">rev ${esc(s.revision)}${s.author ? ` · ${esc(s.author)}` : ''}</span></div>
          <div class="meta">${esc(describeSummary(s))}${s.description ? ` — ${esc(s.description)}` : ''}${sourceLink(s.source)}</div>
        </div>
        <div class="acts">
          ${isBundled
    ? `<button data-copy="${esc(s.id)}" title="Make an editable local copy of this pack">Copy to mine</button>`
    : `<button data-edit="${esc(s.id)}">Edit</button>`}
          <button data-export="${esc(s.id)}" data-bundled="${isBundled}" title="Download this pack as a .json file to share">Export</button>
          ${isBundled ? '' : (confirmRemove === s.id
    ? `<button class="danger" data-remove-confirm="${esc(s.id)}">Really remove</button><button data-remove-cancel>Keep</button>`
    : `<button class="danger" data-remove="${esc(s.id)}" title="Remove from this browser">×</button>`)}
        </div>
      </div>`;

    return `
      <h2>Extensions</h2>
      <p class="hint">Content the sheet does not carry on its own — class and discipline
        catalogues, casting tables, and building blocks (a class, a race, a feature, a
        tracker) you can add to a character. Each pack is one <code>.json</code> file: write
        your own, export it to share, and drop a friend's onto the page to bring it in.
        Everything stays in this browser.</p>
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      ${error ? `<p class="err">${esc(error)}</p>` : ''}

      <h3>Bundled with this deployment</h3>
      ${bundled.length
    ? bundled.map((e) => row(summarize(e), { bundled: true, enabled: !off.has(e.id) })).join('')
    : '<p class="hint">None — this deployment ships the engine alone.</p>'}

      <h3>Mine, in this browser</h3>
      ${local.length
    ? local.map((s) => row(s, { bundled: false, enabled: s.enabled !== false })).join('')
    : '<p class="hint">Nothing yet. Start one below, or import a pack somebody sent you.</p>'}

      <div class="actions">
        <button class="primary" data-action="new">+ New extension</button>
        <button data-action="import" title="A .json extension pack">Import a pack…</button>
        <button data-action="paste" aria-pressed="${showPaste}">Paste JSON</button>
        <button data-action="from-character" title="Lift the open character's classes, race, feature groups and trackers into a new pack"
          ${currentCharacter() ? '' : 'disabled'}>From this character…</button>
        <span class="spacer"></span>
        <button data-action="close">Close</button>
        <input type="file" accept="application/json,.json" data-file hidden>
      </div>
      ${showPaste ? `<div class="paste">
        <textarea rows="6" data-paste placeholder='{"format": "character-sheet-extension", "name": "…", …}'></textarea>
        <div class="actions" style="margin-top:6px"><button class="primary" data-action="paste-go">Import pasted JSON</button></div>
      </div>` : ''}`;
  }

  function editorHtml() {
    const d = draft;
    const tables = Object.keys(d.provides);
    const s = summarize(d);
    return `
      <h2>${draftIsNew ? 'New extension' : `Edit — ${esc(d.name)}`}</h2>
      <p class="hint">A pack has a header (who wrote it, where it came from), any shared
        tables it provides, and blocks a player adds to a character. Save keeps it in this
        browser; Export on the list sends it out.</p>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <div class="actions" style="margin:0 0 10px">
        <button data-action="mode-form" aria-pressed="${!asJson && !paste}" ${asJson || paste ? '' : 'class="primary"'}>Form</button>
        <button data-action="mode-json" aria-pressed="${asJson}" ${asJson ? 'class="primary"' : ''}>JSON</button>
        <button data-action="mode-paste" aria-pressed="${!!paste}" ${paste ? 'class="primary"' : ''}
          title="Paste a class, race or veil copied off a rules page and read it into blocks">Paste text…</button>
      </div>
      ${paste ? pasteHtml() : asJson ? `
        <textarea rows="22" data-json spellcheck="false">${esc(jsonText)}</textarea>
      ` : `
        <div class="fields">
          <label>Name <input type="text" data-h="name" value="${esc(d.name)}" maxlength="80"></label>
          <label>Id <input type="text" data-h="id" value="${esc(d.id)}" maxlength="60" ${draftIsNew ? '' : 'readonly title="An id is fixed once saved; a pack with the same id replaces this one on import"'} placeholder="from the name"></label>
          <label>Author <input type="text" data-h="author" value="${esc(d.author)}" maxlength="80"></label>
          <label>Source URL <input type="url" data-h="source" value="${esc(d.source)}" placeholder="where this came from"></label>
          <label>Licence <input type="text" data-h="license" value="${esc(d.license)}" placeholder="OGL 1.0a, CC-BY, homebrew…"></label>
          <label>Revision <input type="number" data-h="revision" value="${esc(d.revision)}" min="1" step="1"></label>
          <label class="wide">Description <textarea class="prose" rows="2" data-h="description">${esc(d.description)}</textarea></label>
        </div>

        <h3>Shared tables</h3>
        <p class="hint">${tables.length
    ? `This pack provides ${esc(describeSummary({ tables: s.tables, blocks: {} }))}. Tables are edited in the JSON view.`
    : `None. A pack can carry ${TABLE_KINDS.map((k) => `<code>${k}</code>`).join(', ')} under <code>provides</code> — see the JSON view, or copy a bundled pack to start from one.`}</p>

        <h3>Blocks</h3>
        <p class="hint">Building blocks a player adds to a character from the sheet's ⚙ manager.</p>
        ${d.blocks.map((b, i) => blockHtml(b, i)).join('') || '<p class="hint">No blocks yet.</p>'}
        <div class="actions" style="margin-top:6px">
          <select data-newkind>${Object.entries(BLOCK_KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
          <button data-action="add-block">+ Add block</button>
        </div>
      `}
      ${paste ? '' : `<div class="actions">
        <button class="primary" data-action="save">Save</button>
        <button data-action="cancel">Cancel</button>
      </div>`}`;
  }

  /* ---------------- the paste importer's two stages ---------------- */

  function pasteHtml() {
    if (paste.stage === 'text') {
      return `
        <p class="hint">Copy a class, a race or a veil off a rules page — the whole page is fine,
          several pages one after another too — and paste it here. The reader picks out the
          progression table, hit die, saves, class skills and feature text of a class; the ability
          modifiers, size, speed, languages and traits of a race; a veil's essence and bind text.
          Then it shows you what it read, and asks you to tag whatever it could not place.</p>
        <textarea rows="16" data-paste-text placeholder="Barbarian
Source PRPG Core Rulebook pg. 31
…
Hit Die: d12.
…">${esc(paste.text)}</textarea>
        <div class="actions">
          <button class="primary" data-action="paste-read">Read it</button>
          <button data-action="paste-cancel">Back to the form</button>
        </div>`;
    }
    const { result, keep, tags } = paste;
    const classes = result.blocks.map((b, i) => [b, i]).filter(([b, i]) => b.kind === 'class' && keep[i]);
    const races = result.blocks.map((b, i) => [b, i]).filter(([b, i]) => b.kind === 'race' && keep[i]);
    const archs = result.blocks.map((b, i) => [b, i]).filter(([b, i]) => b.kind === 'archetype' && !b.single && keep[i]);
    const detail = (b) => {
      switch (b.kind) {
        case 'class': return `d${b.hd} · ${b.bab === 1 ? 'full' : b.bab === 0.5 ? '½' : '¾'} BAB · good ${['goodFort', 'goodRef', 'goodWill'].filter((k) => b[k]).map((k) => k.slice(4)).join('/') || 'no'} save · ${b.skillRanks} ranks · ${b.classSkills.length} class skills · ${b.features.length} features (${b.features.filter((f) => f.text).length} with text)`;
        case 'race': return [b.size, b.speed && `${b.speed} ft`, Object.entries(b.abilityMods).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(' '), `${b.traits.length} traits`, b.languages.length && b.languages.join(', ')].filter(Boolean).join(' · ');
        case 'trait': return `${b.replaces.length ? `replaces ${b.replaces.join(', ')} · ` : ''}${b.text.slice(0, 90)}${b.text.length > 90 ? '…' : ''}`;
        case 'feature': case 'note': return `${b.text.slice(0, 110)}${b.text.length > 110 ? '…' : ''}`;
        case 'veil': return `${b.slot || 'no slot'}${b.descriptor ? ` · ${b.descriptor}` : ''} · ${b.text.slice(0, 80)}…`;
        case 'archetype': { const rep = [...new Set(b.features.flatMap((f) => f.replaces))]; const alt = [...new Set(b.features.flatMap((f) => f.alters))]; return [`for ${b.class || '?'}`, `${b.features.length} feature(s)`, rep.length ? `replaces ${rep.join(', ')}` : '', alt.length ? `alters ${alt.join(', ')}` : ''].filter(Boolean).join(' · '); }
        case 'template': return `${b.features.length} feature(s): ${b.features.map((f) => f.name).join(', ')}`;
        case 'options': return [b.class && `for ${b.class}'s ${b.feature || '?'}`, `${b.options.length} entr${b.options.length === 1 ? 'y' : 'ies'}`,
          [...new Set(b.options.map((o) => o.category).filter(Boolean))].join(', ')].filter(Boolean).join(' · ');
        default: return '';
      }
    };
    const choicesFor = (l) => {
      const opts = [['skip', 'Leave it out']];
      for (const [c, i] of classes) opts.push([`class:${i}`, `Feature of ${c.name} (added with the class)`]);
      for (const [a, i] of archs) opts.push([`arch:${i}`, `Feature of the ${a.name} archetype`]);
      for (const [r, i] of races) opts.push([`race:${i}`, `Standard trait of ${r.name} (comes with the race)`]);
      opts.push(['trait', 'Alternate / optional race trait (its own block)'], ['feature', 'A feature block (in a group)'], ['note', 'A note']);
      return opts;
    };
    return `
      <div class="report">${result.report.map((l) => esc(l)).join('<br>')}${result.report.length ? '' : 'Nothing was recognised.'}</div>

      <h3>Read into blocks</h3>
      <p class="hint">Untick anything you do not want. Each of these becomes a block on the pack you can then edit in the form.</p>
      ${result.blocks.map((b, i) => `<div class="found ${keep[i] ? '' : 'off'}">
        <label class="sw"><input type="checkbox" data-keep="${i}" ${keep[i] ? 'checked' : ''}></label>
        <span class="kind">${esc(BLOCK_KINDS[b.kind]?.label || b.kind)}</span>
        <span class="what"><strong>${esc(b.name || '(unnamed)')}</strong> <span class="d">${esc(detail(b))}</span></span>
      </div>`).join('') || '<p class="hint">Nothing.</p>'}

      <h3>Not placed — tag it, or leave it</h3>
      <p class="hint">${result.leftovers.length
    ? 'Stretches of the paste nothing claimed. Say what each is — a feature of the class above it, a race trait, a note — or leave it out. Page chrome and tables of ages and heights are the usual leftovers.'
    : 'Everything in the paste was placed.'}</p>
      ${result.leftovers.map((l, i) => {
    const tag = tags[i];
    const split = splitChunk(l.text);
    return `<div class="left ${tag.choice === 'skip' ? 'skip' : ''}" data-left="${i}">
        <div class="top">
          <select data-tag="${i}">${choicesFor(l).map(([v, label]) => `<option value="${esc(v)}" ${tag.choice === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
          ${tag.choice === 'skip' ? '' : `<input type="text" data-tagname="${i}" value="${esc(tag.name ?? split.name)}" placeholder="name" title="The name it gets">`}
          ${tag.choice === 'feature' ? `<input type="text" data-taggroup="${i}" value="${esc(tag.group ?? (l.near?.name || ''))}" placeholder="group" title="The template group it joins">` : ''}
          <span class="near">${l.near ? `near ${esc(l.near.name)}` : ''} · ${l.text.split('\n').length} line(s)</span>
        </div>
        <pre>${esc(l.text.length > 600 ? `${l.text.slice(0, 600)}…` : l.text)}</pre>
      </div>`;
  }).join('')}

      <div class="actions">
        <button class="primary" data-action="paste-apply">Add ${keep.filter(Boolean).length + tags.filter((t) => t.choice !== 'skip' && !/^(class|race|arch):/.test(t.choice)).length} block(s) to the pack</button>
        <button data-action="paste-back">Back to the text</button>
        <button data-action="paste-cancel">Cancel</button>
      </div>`;
  }

  /** Read the pasted text and open the review stage. */
  function pasteRead() {
    const result = parsePaste(paste.text);
    const classes = result.blocks.map((b, i) => [b, i]).filter(([b]) => b.kind === 'class');
    const races = result.blocks.map((b, i) => [b, i]).filter(([b]) => b.kind === 'race');
    const archs = result.blocks.map((b, i) => [b, i]).filter(([b]) => b.kind === 'archetype' && !b.single);
    const nearest = (l, kind, list) => {
      if (!list.length) return null;
      const hit = l.near && l.near.kind === kind ? list.find(([b]) => b.name === l.near.name) : null;
      return (hit || list[list.length - 1])[1];
    };
    const tags = result.leftovers.map((l) => {
      let choice = l.suggest;
      if (choice === 'feature') {
        const ai = l.near?.kind === 'archetype' ? nearest(l, 'archetype', archs) : null;
        const i = ai !== null ? null : nearest(l, 'class', classes);
        choice = ai !== null ? `arch:${ai}` : i !== null ? `class:${i}` : 'feature';
      }
      if (choice === 'trait') {
        // "This racial trait replaces hardy" is an alternate: its own block,
        // not something every member of the race gets.
        const alternate = /\breplaces?\b/i.test(l.text) || /alternate racial trait/i.test(l.text);
        const i = alternate ? null : nearest(l, 'race', races);
        choice = i !== null ? `race:${i}` : 'trait';
      }
      return { choice, name: null, group: null };
    });
    paste = { stage: 'review', text: paste.text, result, keep: result.blocks.map(() => true), tags };
    error = null;
    render();
  }

  /** Fold the review's decisions into the draft and go back to the form. */
  function pasteApply() {
    const { result, keep, tags } = paste;
    const taken = result.blocks.map((b) => structuredClone(b));
    const extra = [];
    // Leftovers tagged onto a recognised class or race are folded into it;
    // the rest become blocks of their own, behind the recognised ones.
    result.leftovers.forEach((l, i) => {
      const tag = tags[i];
      if (tag.choice === 'skip') return;
      const split = splitChunk(l.text);
      const name = (tag.name ?? split.name).trim() || split.name;
      const m = tag.choice.match(/^(class|race|arch):(\d+)$/);
      if (m) {
        const target = taken[Number(m[2])];
        if (!target || !keep[Number(m[2])]) return;
        if (m[1] === 'class') target.features.push({ level: 1, name, text: split.text });
        else if (m[1] === 'arch') target.features.push({ name, type: split.type, text: split.text });
        else target.traits.push({ name, text: split.text });
        return;
      }
      if (tag.choice === 'trait') extra.push(normalizeBlock({ kind: 'trait', name, text: split.text }));
      else if (tag.choice === 'feature') extra.push(normalizeBlock({ kind: 'feature', name, type: split.type, text: split.text, group: (tag.group ?? (l.near?.name || '')).trim() }));
      else extra.push(normalizeBlock({ kind: 'note', name, text: split.text }));
    });
    const fresh = [...taken.filter((b, i) => keep[i]).map((b) => normalizeBlock(b)), ...extra].filter(Boolean);
    const first = draft.blocks.length;
    draft.blocks.push(...fresh);
    notice = null;
    error = fresh.length ? null : 'Nothing was added — every block was unticked and every leftover left out.';
    paste = null;
    openBlocks.clear();
    render();
    if (fresh.length) dialog.querySelector(`.block[data-block="${first}"]`)?.scrollIntoView({ block: 'start' });
  }

  function blockHtml(b, i) {
    const open = openBlocks.has(i);
    const kind = BLOCK_KINDS[b.kind];
    return `<div class="block" data-block="${i}">
      <div class="head">
        <span class="kind">${esc(kind.label)}</span>
        <span class="title">${esc(b.name || '(unnamed)')}</span>
        <button data-bmove="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button data-bmove="${i}" data-dir="1" ${i === draft.blocks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button data-bopen="${i}" aria-expanded="${open}">${open ? 'Done' : 'Edit'}</button>
        <button class="danger" data-bremove="${i}" title="Remove this block">×</button>
      </div>
      ${open ? `<div class="body">${blockFormHtml(b, i)}<div class="land">Lands on: ${esc(kind.lands)}.</div></div>` : ''}
    </div>`;
  }

  const F = (i, key, label, value, { type = 'text', wide = false, ph = '', extra = '' } = {}) => `
    <label class="${wide ? 'wide' : ''}">${esc(label)}
      <input type="${type}" data-b="${i}" data-k="${key}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" ${extra}></label>`;
  const A = (i, key, label, value, rows = 3, ph = '', prose = true) => `
    <label class="wide">${esc(label)}
      <textarea class="${prose ? 'prose' : ''}" rows="${rows}" data-b="${i}" data-k="${key}" placeholder="${esc(ph)}">${esc(value ?? '')}</textarea></label>`;
  const C = (i, key, label, on) => `
    <label class="check"><input type="checkbox" data-b="${i}" data-k="${key}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;

  function blockFormHtml(b, i) {
    switch (b.kind) {
      case 'class':
        return `<div class="fields">
          ${F(i, 'name', 'Class name', b.name)}
          ${F(i, 'hd', 'Hit die (d)', b.hd, { type: 'number', extra: 'min="4" max="12" step="2"' })}
          <label>Base attack
            <select data-b="${i}" data-k="bab">
              <option value="1" ${b.bab === 1 ? 'selected' : ''}>Full (+1/level)</option>
              <option value="0.75" ${b.bab === 0.75 ? 'selected' : ''}>3/4</option>
              <option value="0.5" ${b.bab === 0.5 ? 'selected' : ''}>1/2</option>
            </select></label>
          ${F(i, 'skillRanks', 'Skill ranks / level', b.skillRanks, { type: 'number', extra: 'min="0" max="10"' })}
          ${C(i, 'goodFort', 'Good Fortitude', b.goodFort)}
          ${C(i, 'goodRef', 'Good Reflex', b.goodRef)}
          ${C(i, 'goodWill', 'Good Will', b.goodWill)}
          ${F(i, 'archetypes', 'Archetypes', b.archetypes, { wide: true, ph: 'optional' })}
          ${F(i, 'classSkills', 'Class skills', b.classSkills.join(', '), { wide: true, ph: 'Acrobatics, Climb, Craft, … (comma-separated; ticked on the Skills tab when added)' })}
          ${A(i, 'features', 'Features by level', b.features.map((f) => `${f.level}: ${f.name}${f.text ? ` — ${f.text}` : ''}`).join('\n'), 6,
    'one per line, "level: name — text", e.g.\n1: Fast movement, Rage\n2: Rage power, Uncanny dodge\n3: Trap sense +1', false)}
          ${A(i, 'text', 'Description', b.text, 3, 'flavour, role, alignment — free text')}
          ${F(i, 'source', 'Source', b.source, { wide: true, ph: 'book and page, or a URL' })}
        </div>`;
      case 'race':
        return `<div class="fields">
          ${F(i, 'name', 'Race', b.name)}
          ${F(i, 'size', 'Size', b.size, { ph: 'Medium' })}
          ${F(i, 'speed', 'Base speed', b.speed ?? '', { type: 'number', extra: 'min="0" step="5"' })}
          <label class="wide">Ability modifiers
            <span class="abil">${ABILITIES.map((ab) => `<label>${ab}<input type="number" data-b="${i}" data-k="abilityMods.${ab}" value="${esc(b.abilityMods[ab] || 0)}" step="1"></label>`).join('')}</span></label>
          ${A(i, 'traits', 'Racial traits', b.traits.map((t) => `${t.name}: ${t.text}`).join('\n'), 6,
    'one per line, "Name: text", e.g.\nDarkvision: Dwarves can see perfectly in the dark up to 60 feet.\nHardy: +2 racial bonus on saving throws against poison, spells, and spell-like abilities.', false)}
          ${F(i, 'languages', 'Languages', b.languages.join(', '), { wide: true, ph: 'Common, Dwarven' })}
          ${A(i, 'text', 'Description', b.text, 3)}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
        </div>`;
      case 'trait':
        return `<div class="fields">
          ${F(i, 'name', 'Trait name', b.name)}
          ${F(i, 'race', 'Race', b.race, { ph: 'Dwarf' })}
          ${F(i, 'replaces', 'Replaces', b.replaces.join(', '), { wide: true, ph: 'hatred, stonecunning — the standard traits it swaps out when added (read from the text if blank)' })}
          ${A(i, 'text', 'Text', b.text, 3)}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
        </div>`;
      case 'feature':
        return `<div class="fields">
          ${F(i, 'name', 'Feature name', b.name)}
          <label>Type <select data-b="${i}" data-k="type">
            <option value="" ${!b.type ? 'selected' : ''}>—</option>
            ${['Ex', 'Su', 'Sp'].map((t) => `<option ${b.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
          ${F(i, 'group', 'Group (template) it joins', b.group, { ph: 'e.g. Barbarian — made if missing' })}
          ${A(i, 'text', 'Text', b.text, 5)}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
        </div>`;
      case 'template':
        return `<div class="fields">
          ${F(i, 'name', 'Group name', b.name)}
          ${A(i, 'features', 'Features', b.features.map((f) => `${f.name}${f.type ? ` (${f.type})` : ''}: ${f.text}`).join('\n'), 8,
    'one per line, "Name (Ex): text"', false)}
          ${A(i, 'text', 'Description', b.text, 2)}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
        </div>`;
      case 'tracker':
        return `<div class="fields">
          ${F(i, 'name', 'Tracker name', b.name)}
          ${F(i, 'maxFormula', 'Maximum (number or formula)', b.maxFormula, { ph: '4 + con.mod + (level - 1) * 2' })}
          ${F(i, 'minFormula', 'Minimum', b.minFormula ?? '', { ph: 'blank = 0' })}
          ${F(i, 'refresh', 'Refresh', b.refresh, { ph: 'per day, per encounter, …' })}
          ${A(i, 'text', 'Note', b.text, 2)}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
        </div>`;
      case 'veil':
        return `<div class="fields">
          ${F(i, 'name', 'Veil name', b.name)}
          ${F(i, 'slot', 'Chakra slot', b.slot, { ph: 'Hands, Feet, Head, Headband, Neck, Shoulders, Chest, Body, Belt, Wrists, Ring…' })}
          ${F(i, 'descriptor', 'Descriptor', b.descriptor, { ph: 'Enhanced (katana), Aura…' })}
          ${A(i, 'text', 'Text (shaping, Essence, Chakra Bind)', b.text, 8, 'What the veil does; {name = expr} formulas resolve on the card')}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
        </div>`;
      case 'archetype':
        return `<div class="fields">
          ${F(i, 'name', 'Archetype name', b.name)}
          ${F(i, 'class', 'Class it applies to', b.class, { ph: 'Legendary Samurai' })}
          ${F(i, 'stacksWith', 'Can be combined with', b.stacksWith.join(', '), { wide: true, ph: 'names of archetypes it may overlap with (read from the text if blank)' })}
          ${A(i, 'features', 'Features', b.features.map((f) => `${f.name}${f.type ? ` (${f.type})` : ''}: ${f.text.replace(/\n+/g, ' ')}`).join('\n'), 10,
    'one per line, "Name (Ex): text" — end the text with what it does, e.g. "This ability replaces challenge and kiai arts." or "This ability alters resolve."', false)}
          ${A(i, 'text', 'Description', b.text, 2)}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
          <p class="hint" style="grid-column:1/-1;margin:0">Read from the features: ${esc([...new Set(b.features.flatMap((f) => f.replaces))].map((k) => `replaces ${k}`).concat([...new Set(b.features.flatMap((f) => f.alters))].map((k) => `alters ${k}`)).join(' · ') || 'nothing yet')}.</p>
        </div>`;
      case 'options':
        return `<div class="fields">
          ${F(i, 'name', 'Menu name', b.name, { ph: 'Legendary Samurai Iaijutsu Technique' })}
          ${F(i, 'class', 'Class it is for', b.class, { ph: 'Legendary Samurai' })}
          ${F(i, 'feature', 'Feature that picks from it', b.feature, { ph: 'Iaijutsu Technique — a column of this name picks from the menu' })}
          ${A(i, 'options', 'Entries', menuOptionLines(b.options), 10,
    'one per line, "Category / Name (Ex) 5+: text" — the category and the "(Ex)" and the level it asks for are all optional, e.g.\nSlashes / Bloody Slash (Ex) 5+: The target takes bleed damage.\nCuts / Ranged Cut (Ex): Strike at a range of 30 feet.\nDurable: Items the blacksmith maintains resist sundering.', false)}
          ${A(i, 'text', 'About these options', b.text, 2, 'what the menu is, a condition its entries use')}
          ${F(i, 'source', 'Source', b.source, { wide: true })}
          <p class="hint" style="grid-column:1/-1;margin:0">${b.options.length
    ? `${b.options.length} entr${b.options.length === 1 ? 'y' : 'ies'}${
      [...new Set(b.options.map((o) => o.category).filter(Boolean))].length
        ? ` in ${[...new Set(b.options.map((o) => o.category).filter(Boolean))].join(', ')}` : ''}. An entry saying what it replaces (“this replaces the Ranged Cut and Armor Rending Slash iaijutsu techniques”) pushes those out where this menu layers over another.`
    : 'No entries yet.'}</p>
        </div>`;
      case 'note':
        return `<div class="fields">
          ${F(i, 'name', 'Title', b.name)}
          ${A(i, 'text', 'Body', b.text, 6)}
        </div>`;
      default:
        return '';
    }
  }

  /* ---------------- events ---------------- */

  function bind() {
    const q = (sel) => dialog.querySelector(sel);
    const qa = (sel) => [...dialog.querySelectorAll(sel)];

    if (view === 'list') {
      qa('[data-toggle]').forEach((el) => el.addEventListener('change', () => {
        runtime.store?.setEnabled(el.dataset.toggle, el.checked, { bundled: el.dataset.bundled === 'true' });
        runtime.refresh();
        notice = null; error = null;
        render();
      }));
      qa('[data-edit]').forEach((el) => el.addEventListener('click', () => startEdit(runtime.store.read(el.dataset.edit), false)));
      qa('[data-copy]').forEach((el) => el.addEventListener('click', () => {
        const src = runtime.bundled.find((e) => e.id === el.dataset.copy);
        if (!src) return;
        const copy = normalizeExtension({ ...structuredClone(src), id: `${src.id}-mine`, name: `${src.name} (mine)`, revision: 1, createdAt: '', updatedAt: '' });
        startEdit(copy, true);
      }));
      qa('[data-export]').forEach((el) => el.addEventListener('click', () => {
        const id = el.dataset.export;
        const doc = el.dataset.bundled === 'true' ? runtime.bundled.find((e) => e.id === id) : runtime.store.read(id);
        if (doc) download(doc);
      }));
      qa('[data-remove]').forEach((el) => el.addEventListener('click', () => { confirmRemove = el.dataset.remove; render(); }));
      q('[data-remove-cancel]')?.addEventListener('click', () => { confirmRemove = null; render(); });
      qa('[data-remove-confirm]').forEach((el) => el.addEventListener('click', () => {
        const row = runtime.store.list().find((e) => e.id === el.dataset.removeConfirm);
        runtime.store.remove(el.dataset.removeConfirm);
        runtime.refresh();
        confirmRemove = null;
        notice = `Removed ${row?.name || 'the pack'} from this browser.`; error = null;
        render();
      }));
      q('[data-action="new"]')?.addEventListener('click', () => startEdit(blankExtension({ name: 'My extension' }), true));
      q('[data-action="import"]')?.addEventListener('click', () => q('[data-file]').click());
      q('[data-file]')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) importFile(file);
      });
      q('[data-action="paste"]')?.addEventListener('click', () => { showPaste = !showPaste; render(); });
      q('[data-action="paste-go"]')?.addEventListener('click', () => importText(q('[data-paste]').value));
      q('[data-action="from-character"]')?.addEventListener('click', () => {
        const data = currentCharacter();
        if (!data) return;
        const name = `${data.identity?.name || 'Character'} — pack`;
        const ext = blankExtension({ name });
        ext.blocks = blocksFromCharacter(data);
        ext.description = `Lifted from ${data.identity?.name || 'a character'}: classes, race, feature groups and trackers.`;
        startEdit(ext, true);
      });
      q('[data-action="close"]')?.addEventListener('click', () => dialog.close());
      return;
    }

    // editor
    q('[data-action="mode-form"]')?.addEventListener('click', () => { if (paste) { paste = null; render(); } else switchMode(false); });
    q('[data-action="mode-json"]')?.addEventListener('click', () => { if (paste) { paste = null; asJson = false; } switchMode(true); });
    q('[data-action="mode-paste"]')?.addEventListener('click', () => {
      if (paste) return;
      if (asJson) { switchMode(false); if (asJson) return; }     // a JSON that will not parse stays put
      paste = { stage: 'text', text: '', result: null, keep: [], tags: [] };
      render();
      dialog.querySelector('[data-paste-text]')?.focus();
    });
    q('[data-paste-text]')?.addEventListener('input', (e) => { paste.text = e.target.value; });
    q('[data-action="paste-read"]')?.addEventListener('click', () => {
      if (!paste.text.trim()) { error = 'Paste something first.'; render(); return; }
      pasteRead();
    });
    q('[data-action="paste-back"]')?.addEventListener('click', () => { paste = { ...paste, stage: 'text', result: null }; error = null; render(); });
    q('[data-action="paste-cancel"]')?.addEventListener('click', () => { paste = null; error = null; render(); });
    q('[data-action="paste-apply"]')?.addEventListener('click', pasteApply);
    qa('[data-keep]').forEach((el) => el.addEventListener('change', () => { paste.keep[Number(el.dataset.keep)] = el.checked; render(); }));
    qa('[data-tag]').forEach((el) => el.addEventListener('change', () => { paste.tags[Number(el.dataset.tag)].choice = el.value; render(); }));
    qa('[data-tagname]').forEach((el) => el.addEventListener('input', () => { paste.tags[Number(el.dataset.tagname)].name = el.value; }));
    qa('[data-taggroup]').forEach((el) => el.addEventListener('input', () => { paste.tags[Number(el.dataset.taggroup)].group = el.value; }));
    q('[data-json]')?.addEventListener('input', (e) => { jsonText = e.target.value; });
    qa('[data-h]').forEach((el) => el.addEventListener('input', () => {
      const key = el.dataset.h;
      draft[key] = key === 'revision' ? Math.max(1, Math.floor(Number(el.value) || 1)) : el.value;
      if (key === 'name' && draftIsNew) {
        const idField = q('[data-h="id"]');
        if (idField && !idField.dataset.touched) { draft.id = slugId(el.value); idField.value = draft.id; }
      }
      if (key === 'id') { el.dataset.touched = '1'; }
    }));
    qa('[data-b]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
      setBlockField(Number(el.dataset.b), el.dataset.k, el.type === 'checkbox' ? el.checked : el.value);
      // The block title follows the name field without a full redraw.
      if (el.dataset.k === 'name') {
        const t = dialog.querySelector(`.block[data-block="${el.dataset.b}"] .title`);
        if (t) t.textContent = el.value || '(unnamed)';
      }
    }));
    qa('[data-bopen]').forEach((el) => el.addEventListener('click', () => {
      const i = Number(el.dataset.bopen);
      if (openBlocks.has(i)) openBlocks.delete(i); else openBlocks.add(i);
      render();
    }));
    qa('[data-bremove]').forEach((el) => el.addEventListener('click', () => {
      draft.blocks.splice(Number(el.dataset.bremove), 1);
      openBlocks.clear();
      render();
    }));
    qa('[data-bmove]').forEach((el) => el.addEventListener('click', () => {
      const i = Number(el.dataset.bmove);
      const to = i + Number(el.dataset.dir);
      if (to < 0 || to >= draft.blocks.length) return;
      const [b] = draft.blocks.splice(i, 1);
      draft.blocks.splice(to, 0, b);
      openBlocks.clear();
      render();
    }));
    q('[data-action="add-block"]')?.addEventListener('click', () => {
      const kind = q('[data-newkind]').value;
      draft.blocks.push(normalizeBlock({ kind, name: '' }));
      openBlocks.clear();
      openBlocks.add(draft.blocks.length - 1);
      render();
      dialog.querySelector(`.block[data-block="${draft.blocks.length - 1}"] input`)?.focus();
    });
    q('[data-action="save"]')?.addEventListener('click', save);
    q('[data-action="cancel"]')?.addEventListener('click', () => { view = 'list'; draft = null; error = null; render(); });
  }

  /**
   * Write one form field into the draft block. The multi-line fields --
   * features by level, racial traits, a group's features -- are parsed line
   * by line, so the textarea is the source and the structure follows it.
   */
  function setBlockField(i, key, value) {
    const b = draft.blocks[i];
    if (!b) return;
    if (key.startsWith('abilityMods.')) {
      const ab = key.slice('abilityMods.'.length);
      const n = Number(value) || 0;
      if (n) b.abilityMods[ab] = n; else delete b.abilityMods[ab];
      return;
    }
    switch (key) {
      case 'hd': case 'skillRanks': b[key] = Number(value) || 0; return;
      case 'bab': b.bab = Number(value) || 0.75; return;
      case 'speed': b.speed = value === '' ? null : Number(value) || 0; return;
      case 'goodFort': case 'goodRef': case 'goodWill': b[key] = !!value; return;
      case 'type': b.type = value || null; return;
      case 'minFormula': b.minFormula = value === '' ? null : value; return;
      case 'classSkills': case 'languages': case 'replaces': case 'stacksWith': b[key] = String(value).split(',').map((s) => s.trim()).filter(Boolean); return;
      case 'features':
        if (b.kind === 'archetype') {
          // re-normalise so each feature's replaces/alters/level are read off its new text
          const fresh = normalizeBlock({ ...b, features: parseGroupFeatures(value) });
          b.features = fresh.features;
          return;
        }
        b.features = b.kind === 'class' ? parseClassFeatures(value) : parseGroupFeatures(value);
        return;
      case 'traits': b.traits = parseNamedLines(value); return;
      case 'options': {
        // re-normalise so each entry's "this replaces…" is read off its new text
        const fresh = normalizeBlock({ ...b, options: parseMenuOptions(value) });
        b.options = fresh.options;
        return;
      }
      default: b[key] = value;
    }
  }

  function switchMode(json) {
    if (json === asJson) return;
    if (json) {
      jsonText = JSON.stringify(draft, null, 2);
      asJson = true; error = null;
    } else {
      try {
        const doc = JSON.parse(jsonText);
        draft = normalizeExtension(doc);
        asJson = false; error = null;
      } catch (err) {
        error = `The JSON does not parse — ${err.message}. Fix it, or Cancel to drop the edit.`;
      }
    }
    render();
  }

  function startEdit(doc, isNew) {
    draft = normalizeExtension(doc);
    draftIsNew = isNew;
    asJson = false; jsonText = ''; error = null; notice = null; paste = null;
    openBlocks.clear();
    view = 'edit';
    render();
    dialog.querySelector('[data-h="name"]')?.focus();
  }

  function save() {
    if (asJson) {
      try { draft = normalizeExtension(JSON.parse(jsonText)); } catch (err) { error = `The JSON does not parse — ${err.message}.`; render(); return; }
    }
    if (!draft.name.trim()) { error = 'Give the pack a name.'; render(); return; }
    draft.id = slugId(draft.id) || slugId(draft.name);
    if (!draft.id) { error = 'The name has no letters or digits to make an id from.'; render(); return; }
    if (draftIsNew && runtime.store.list().some((e) => e.id === draft.id)) {
      error = `A pack with the id “${draft.id}” is already here. Change the id, or edit that one instead.`;
      render(); return;
    }
    if (runtime.bundled.some((e) => e.id === draft.id)) {
      error = `“${draft.id}” is a bundled pack's id. Pick another so the two do not shadow each other.`;
      render(); return;
    }
    try {
      const row = runtime.store.save(draft, { origin: 'local' });
      runtime.refresh();
      notice = `${row.replaced ? 'Updated' : 'Saved'} ${row.name} (${describeSummary(row)}).`;
      error = null; view = 'list'; draft = null;
      render();
    } catch (err) {
      error = err.name === 'QuotaExceededError'
        ? 'This browser is out of space — remove a pack or a character and try again.'
        : `Could not save — ${err.message}`;
      render();
    }
  }

  /* ---------------- bringing a pack in ---------------- */

  function importDoc(doc, label = 'the pack') {
    const verdict = inspectExtension(doc);
    if (!verdict.ok) { error = `${label}: ${verdict.error}`; notice = null; render(); return verdict; }
    if (runtime.bundled.some((e) => e.id === verdict.summary.id)) {
      error = `${label} has the same id as the bundled pack “${verdict.summary.name}”. Change its id first (edit the file's "id"), or copy the bundled one and edit that.`;
      render(); return { ok: false, error };
    }
    try {
      const row = runtime.store.save(doc, { origin: 'import' });
      runtime.refresh();
      notice = `${row.replaced ? 'Updated' : 'Imported'} ${row.name} rev ${row.revision} (${describeSummary(row)}).`
        + (verdict.warnings?.length ? ` Note — ${verdict.warnings.join('; ')}.` : '');
      error = null; showPaste = false;
      say('ok', notice);
    } catch (err) {
      error = err.name === 'QuotaExceededError'
        ? 'This browser is out of space — remove a pack or a character and try again.'
        : `Could not store ${label} — ${err.message}`;
      say('err', error);
    }
    render();
    return { ok: !error, error };
  }

  async function importFile(file) {
    let doc;
    try { doc = JSON.parse(await file.text()); } catch (err) { error = `${file.name} is not valid JSON — ${err.message}`; render(); return { ok: false, error }; }
    return importDoc(doc, file.name);
  }

  function importText(text) {
    let doc;
    try { doc = JSON.parse(text); } catch (err) { error = `That is not valid JSON — ${err.message}`; render(); return { ok: false, error }; }
    return importDoc(doc, 'the pasted pack');
  }

  function download(doc) {
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.id || 'extension'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return {
    open() { view = 'list'; error = null; notice = null; confirmRemove = null; render(); if (!dialog.open) dialog.showModal(); },
    close() { dialog.close(); },
    importFile(file) { this.open(); return importFile(file); },
    importText(text) { this.open(); return importText(text); },
    importDoc(doc) { this.open(); return importDoc(doc); },
    render,
  };
}

/* ---------------- line parsers for the textareas ---------------- */

/** "3: Trap sense +1, Rage power — text" -> [{level, name, text}] one per name. */
export function parseClassFeatures(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*[:.)-]\s*(.*)$/);
    if (!m) { out.push({ level: 1, name: line, text: '' }); continue; }
    const level = Number(m[1]);
    const [names, ...rest] = m[2].split(/\s+[—–]\s+|\s+--\s+/);
    const desc = rest.join(' — ').trim();
    const list = names.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    list.forEach((name, i) => out.push({ level, name, text: i === list.length - 1 ? desc : '' }));
  }
  return out;
}

/** "Name (Ex): text" -> {name, type, text}, one per line. */
export function parseGroupFeatures(text) {
  return parseNamedLines(text).map(({ name, text: t }) => {
    const m = name.match(/^(.*?)\s*\((Ex|Su|Sp)\)\s*$/i);
    return m ? { name: m[1].trim(), type: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase(), text: t } : { name, type: null, text: t };
  });
}

/**
 * A menu's entries, one per line:
 *
 *   Slashes / Bloody Slash (Ex) 5+: The target takes bleed damage.
 *   Cuts / Ranged Cut (Ex): Strike at a range of 30 feet.
 *   Durable: Items the blacksmith maintains resist sundering.
 *
 * The category, the type and the level the entry asks for are each optional.
 * What an entry replaces is read from its own text, as it is off a page.
 */
export function parseMenuOptions(text) {
  return parseNamedLines(text).map(({ name, text: t }) => {
    const cut = name.lastIndexOf('/');
    const category = cut === -1 ? '' : name.slice(0, cut).trim();
    let rest = (cut === -1 ? name : name.slice(cut + 1)).trim();
    let minLevel = null;
    const lvl = rest.match(/\s+(\d{1,2})(?:st|nd|rd|th)?\+$/);
    if (lvl) { minLevel = Number(lvl[1]); rest = rest.slice(0, lvl.index).trim(); }
    const typed = rest.match(/^(.*?)\s*\((Ex|Su|Sp)\)\s*$/i);
    return {
      name: (typed ? typed[1] : rest).trim(),
      type: typed ? typed[2][0].toUpperCase() + typed[2].slice(1).toLowerCase() : null,
      category,
      minLevel,
      text: t,
    };
  }).filter((o) => o.name);
}

/** Those entries written back out, so the box reads as what it parses. */
export function menuOptionLines(options) {
  return (Array.isArray(options) ? options : []).map((o) => {
    const head = [o.category ? `${o.category} / ` : '', o.name, o.type ? ` (${o.type})` : '', o.minLevel ? ` ${o.minLevel}+` : ''].join('');
    return `${head}: ${String(o.text || '').replace(/\n+/g, ' ')}`;
  }).join('\n');
}

/** "Name: text" per line; a line without a colon is a name with no text. */
export function parseNamedLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i === -1) out.push({ name: line, text: '' });
    else out.push({ name: line.slice(0, i).trim(), text: line.slice(i + 1).trim() });
  }
  return out;
}

export { looksLikeExtension };
