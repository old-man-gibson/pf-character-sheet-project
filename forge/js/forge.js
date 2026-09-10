/**
 * Homebrew Workbench: the page.
 *
 * Three panes -- the entry list, the editor, a rulebook-style preview with
 * backlinks and, for a discipline, a slot audit against the published Path
 * of War numbers. Entries live in this browser (store.js); packs go out and
 * come in through pack.js; "Publish to this sheet" writes the pack into the
 * sheet's own local extension store so the app next door reads it on its
 * next load.
 */
import { TYPES, GROUPS, BASE, esc, uid, slug, now, ord, str, newEntry, linksIn, sortEntries } from './schema.js';
import { forgeStore } from './store.js';
import { forgeToPack, importPack } from './pack.js';
import { extensionStore, isPackKey, packsWorthMoving } from '../../app/js/extensions.js';
import { packMedium } from '../../app/js/pack-storage.js';
import { mountThemes } from './theme.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, kk) => { a[kk] = v[kk]; return a; }, {}) : v));

const store = forgeStore();
const S = { selected: null, dirty: false, filter: 'all', tag: '', q: '', nameIndex: new Map(), saveTimer: null, pendingSave: new Map(), rendered: '' };

/* ===================== Entries ===================== */
const entries = () => store.entries();
const nameOf = (id) => entries().get(id)?.name || '';
const sortedEntries = () => sortEntries(entries().values(), nameOf);
const childrenOf = (id) => sortedEntries().filter((e) => e.parent === id);
const fieldText = (e) => Object.values(e.fields || {}).join(' ');
const firstId = () => sortedEntries()[0]?.id || null;
function reindex() {
  S.nameIndex = new Map();
  for (const e of entries().values()) { const k = e.name.trim().toLowerCase(); if (k && !S.nameIndex.has(k)) S.nameIndex.set(k, e.id); }
}
const resolveName = (n) => S.nameIndex.get(String(n).trim().toLowerCase()) || null;
const backlinksTo = (id) => sortedEntries().filter((e) => e.id !== id && linksIn(`${e.body} ${fieldText(e)}`).some((n) => resolveName(n) === id));
const allTags = () => {
  const c = new Map();
  for (const e of entries().values()) for (const t of e.tags || []) { const k = t.trim(); if (k) c.set(k, (c.get(k) || 0) + 1); }
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

function setStatus(mode, text) { $('#status').className = `status ${mode}`; $('#statusText').textContent = text; }
async function writeEntry(e) {
  reindex();
  setStatus(store.medium === 'IndexedDB' ? 'ok saving' : 'local saving', `${entries().size} entries`);
  try { await store.save(e); } catch (err) { toast(`Save failed: ${err.message}`, 'bad'); }
  reindex(); statusIdle();
}
async function removeEntry(id) { try { await store.remove(id); } catch (err) { toast(`Delete failed: ${err.message}`, 'bad'); } reindex(); statusIdle(); }
function statusIdle() { setStatus(store.medium === 'IndexedDB' ? 'ok' : 'local', `${entries().size} entries · ${store.medium === 'IndexedDB' ? 'this browser' : 'localStorage only'}`); }

/* ===================== Rendering helpers ===================== */
function inline(s) {
  s = esc(s);
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, n, label) => {
    const id = resolveName(n); const t = esc((label || n).trim());
    return id ? `<a class="wl" data-go="${id}">${t}</a>` : `<a class="wl broken" data-make="${esc(n.trim())}" title="No entry named “${esc(n.trim())}” yet — click to create it">${t}</a>`;
  });
  return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
}
function md(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let out = ''; let para = []; let list = null; let table = null;
  const flushP = () => { if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const flushL = () => { if (list) { out += `<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`; list = null; } };
  const flushT = () => {
    if (!table) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    out += `<div class="tablewrap"><table>${rows.map((r, i) => `<tr>${r.map((c) => `${i ? '<td>' : '<th>'}${inline(c)}${i ? '</td>' : '</th>'}`).join('')}</tr>`).join('')}</table></div>`;
    table = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\|/.test(l)) { flushP(); flushL(); (table = table || []).push(l); continue; } else flushT();
    if (/^\s*[-*] /.test(l)) { flushP(); (list = list || []).push(l.replace(/^\s*[-*] /, '')); continue; } else flushL();
    if (/^#{1,3} /.test(l)) { flushP(); out += `<h3>${inline(l.replace(/^#+ /, ''))}</h3>`; continue; }
    if (/^> ?/.test(l)) { flushP(); out += `<blockquote>${inline(l.replace(/^> ?/, ''))}</blockquote>`; continue; }
    if (!l.trim()) { flushP(); continue; }
    para.push(l);
  }
  flushP(); flushL(); flushT();
  return out;
}
const kv = (l, v) => (v ? `<p class="kv"><b>${esc(l)}</b> ${inline(v)}</p>` : '');
const actionText = (a) => ({ Standard: '1 standard action', 'Full-round': '1 full-round action', Swift: '1 swift action', Immediate: '1 immediate action', Move: '1 move action', Free: '1 free action' }[a] || a);

function renderSheet(e) {
  const T = TYPES[e.type] || TYPES.article; const f = e.fields || {}; const tags = (e.tags || []).filter(Boolean);
  const tagStr = tags.length ? ` <span class="desc">[${tags.map(esc).join('] [')}]</span>` : '';
  let h = `<h1>${esc(e.name) || '<span style="opacity:.4">Untitled</span>'}</h1>`;
  const parentLink = e.parent && entries().get(e.parent) ? `<a class="wl" data-go="${e.parent}">${esc(nameOf(e.parent))}</a>` : '';
  switch (e.type) {
    case 'maneuver':
      h += `<p class="sub">${parentLink || '<i>No discipline</i>'} (${esc(f.mtype || 'Maneuver')})${tagStr}</p>`;
      h += kv('Level:', f.level ? String(f.level) : '') + kv('Initiation Action:', f.action ? actionText(f.action) : '') + kv('Range:', f.range) + kv('Target:', f.target) + kv('Duration:', f.duration) + kv('Saving Throw:', f.save) + kv('DC:', f.dc);
      h += `<div class="sect">Description</div>${md(e.body)}`; break;
    case 'feat':
      h += `<p class="sub">${esc(f.featType || 'General')}${tagStr}</p>`;
      h += `${kv('Prerequisites:', f.prereq || 'None.')}<p class="kv"><b>Benefit:</b> </p>${md(e.body)}${kv('Normal:', f.normal)}${kv('Special:', f.special)}`; break;
    case 'trait':
      h += `<p class="sub">${esc(f.category || '')} trait${tagStr}</p>${kv('Prerequisites:', f.prereq)}<p class="kv"><b>Benefit:</b></p>${md(e.body)}`; break;
    case 'spell':
      h += `<p class="sub">${esc(f.school || '')}${tagStr}</p>${kv('Level', f.level)}`;
      h += `<div class="sect">Casting</div>${kv('Casting Time', f.casting)}${kv('Components', f.components)}`;
      h += `<div class="sect">Effect</div>${kv('Range', f.range)}${kv('Target', f.target)}${kv('Duration', f.duration)}${kv('Saving Throw', f.save)}${kv('Spell Resistance', f.sr)}`;
      h += `<div class="sect">Description</div>${md(e.body)}`; break;
    case 'classFeature':
      h += `<p class="sub">${parentLink || ''}${f.level ? ` · ${ord(f.level)} level` : ''}${f.kind && f.kind !== '—' ? ` (${esc(f.kind)})` : ''}${tagStr}</p>${kv('Replaces:', f.replaces)}${kv('Alters:', f.alters)}${md(e.body)}`; break;
    case 'archetype':
      h += `<p class="sub">Archetype for ${parentLink || esc(f.baseClass || '')}${tagStr}</p>${kv('Replaced features:', f.replaces)}${md(e.body)}`; break;
    case 'class':
      h += `<p class="sub">Hit die ${esc(f.hd || '—')} · ${esc(f.ranks || '—')} + Int ranks · BAB ${esc(f.bab || '—')} · Fort ${esc(f.fort || '—')} / Ref ${esc(f.ref || '—')} / Will ${esc(f.will || '—')}${tagStr}</p>`;
      h += `${kv('Class Skills:', f.classSkills)}${kv('Weapon and Armor Proficiency:', f.prof)}<div class="sect">Description</div>${md(e.body)}`; break;
    case 'discipline':
      h += `<p class="sub">Discipline${tagStr}</p>${kv('Discipline Skill:', f.skill)}${kv('Discipline Weapons:', f.weapons)}${kv('Tradition:', f.tradition)}<div class="sect">Description</div>${md(e.body)}`; break;
    case 'item':
      h += `<p class="sub">${esc(f.category || 'Item')}${tagStr}</p>${kv('Aura', f.aura)}${kv('CL', f.cl)}${kv('Slot', f.slot)}${kv('Price', f.price)}${kv('Weight', f.weight)}<div class="sect">Description</div>${md(e.body)}${f.construction ? `<div class="sect">Construction</div>${kv('Requirements', f.construction)}` : ''}`; break;
    case 'race':
      h += `<p class="sub">${esc(f.size || '')} ${esc(f.ctype || '')}${tagStr}</p>${kv('Ability Score Modifiers:', f.abilities)}${kv('Speed:', f.speed)}${kv('Languages:', f.languages)}<div class="sect">Racial traits</div>${md(e.body)}`; break;
    case 'creature':
      h += `<p class="sub">CR ${esc(f.cr || '—')} · ${esc(f.size || '')} ${esc(f.ctype || '')} · ${esc(f.alignment || '')}${tagStr}</p>${f.statblock ? `<pre>${esc(f.statblock)}</pre>` : ''}${md(e.body)}`; break;
    case 'npc':
      h += `<p class="sub">${esc(f.role || '')}${f.cr ? ` · CR ${esc(f.cr)}` : ''}${f.alignment ? ` · ${esc(f.alignment)}` : ''}${parentLink ? ` · ${parentLink}` : ''}${tagStr}</p>${kv('Faction:', f.faction)}${md(e.body)}`; break;
    case 'location':
      h += `<p class="sub">${esc(f.kind || 'Location')}${f.region ? ` · ${esc(f.region)}` : ''}${parentLink ? ` · in ${parentLink}` : ''}${tagStr}</p>${md(e.body)}`; break;
    case 'session':
      h += `<p class="sub">${parentLink ? `${parentLink} · ` : ''}Session ${esc(f.number || '?')}${f.date ? ` · ${esc(f.date)}` : ''}${tagStr}</p>${f.title ? `<h3>${esc(f.title)}</h3>` : ''}${md(e.body)}`; break;
    case 'campaign':
      h += `<p class="sub">${esc(f.setting || 'Campaign')}${f.status ? ` · ${esc(f.status)}` : ''}${tagStr}</p>${kv('Players:', f.players)}${md(e.body)}`; break;
    default:
      h += `<p class="sub">${esc(T.label)}${tagStr}</p>${md(e.body)}`;
  }
  const kids = childrenOf(e.id);
  if (kids.length) {
    h += '<div class="children"><div class="sect">Contents</div>';
    if (e.type === 'discipline') {
      for (let L = 1; L <= 9; L++) {
        const k = kids.filter((m) => +m.fields?.level === L); if (!k.length) continue;
        h += `<div class="lvl">${ord(L)}-Level Maneuvers</div><ul>${k.map((m) => `<li><a class="wl" data-go="${m.id}">${esc(m.name)}</a> <span class="badge">${esc(m.fields?.mtype || '')}</span></li>`).join('')}</ul>`;
      }
      const un = kids.filter((m) => !(+m.fields?.level >= 1 && +m.fields?.level <= 9));
      if (un.length) h += `<div class="lvl">Unleveled</div><ul>${un.map((m) => `<li><a class="wl" data-go="${m.id}">${esc(m.name)}</a></li>`).join('')}</ul>`;
    } else {
      const byType = {}; kids.forEach((k) => (byType[k.type] = byType[k.type] || []).push(k));
      for (const t in byType) h += `<div class="lvl">${esc(TYPES[t]?.plural || t)}</div><ul>${byType[t].map((m) => `<li><a class="wl" data-go="${m.id}">${esc(m.name)}</a>${m.fields?.level ? ` <span class="badge">L${esc(m.fields.level)}</span>` : ''}</li>`).join('')}</ul>`;
    }
    h += '</div>';
  }
  return `<article class="sheet">${h}</article>`;
}

function renderAudit(e) {
  const kids = childrenOf(e.id).filter((k) => k.type === 'maneuver');
  const cnt = { Strike: [], Boost: [], Counter: [], Stance: [], total: [] }; for (const k in cnt) cnt[k] = Array(9).fill(0);
  kids.forEach((k) => { const L = +k.fields?.level; if (L >= 1 && L <= 9) { const t = cnt[k.fields?.mtype] ? k.fields.mtype : null; if (t) cnt[t][L - 1]++; cnt.total[L - 1]++; } });
  const cell = (t, i) => { const v = cnt[t][i]; const b = BASE[t]; const c = v < b.lo[i] ? 'low' : v > b.hi[i] ? 'high' : (v ? 'ok' : ''); return `<td class="${c}">${v}<small> /${b.a[i]}</small></td>`; };
  let rows = ''; for (let i = 0; i < 9; i++) rows += `<tr><td>L${i + 1}</td>${cell('Strike', i)}${cell('Boost', i)}${cell('Counter', i)}${cell('Stance', i)}${cell('total', i)}</tr>`;
  const sum = (t) => cnt[t].reduce((a, b) => a + b, 0);
  const tot = `<tr><td>All</td><td>${sum('Strike')}<small> /16</small></td><td>${sum('Boost')}<small> /7</small></td><td>${sum('Counter')}<small> /5.5</small></td><td>${sum('Stance')}<small> /6</small></td><td>${sum('total')}<small> /34.5</small></td></tr>`;
  return `<h5>Slot audit against 30 published disciplines</h5><div class="audit"><table><thead><tr><th>Lvl</th><th>Strike</th><th>Boost</th><th>Counter</th><th>Stance</th><th>Total</th></tr></thead><tbody>${rows}</tbody><tfoot>${tot}</tfoot></table>
  <div class="cap">Each cell is your count / published average. Amber is below the published minimum, red above the maximum. Published stances land on levels 1, 1, 3, 5, 6, 8 in 20 of 30 disciplines.</div></div>`;
}

/* ===================== Render: rail ===================== */
function renderRail() {
  const counts = {}; for (const e of entries().values()) counts[e.type] = (counts[e.type] || 0) + 1;
  let h = `<div class="tg"><div class="chips"><button class="chip" data-f="all" aria-pressed="${S.filter === 'all'}">All <b>${entries().size}</b></button></div></div>`;
  for (const g of GROUPS) {
    const ts = Object.keys(TYPES).filter((t) => TYPES[t].group === g);
    h += `<div class="tg"><h4>${esc(g)}</h4><div class="chips">${ts.map((t) => `<button class="chip" data-f="${t}" aria-pressed="${S.filter === t}">${esc(TYPES[t].plural)} <b>${counts[t] || 0}</b></button>`).join('')}</div></div>`;
  }
  const tags = allTags();
  if (tags.length) h += `<div class="tg"><h4>Tags</h4><div class="chips">${tags.map(([t, n]) => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${S.tag === t}">${esc(t)} <b>${n}</b></button>`).join('')}</div></div>`;
  $('#typegroups').innerHTML = h;
  const q = S.q.trim().toLowerCase();
  const items = sortedEntries().filter((e) => (S.filter === 'all' || e.type === S.filter)
    && (!S.tag || (e.tags || []).some((t) => t.toLowerCase() === S.tag.toLowerCase()))
    && (!q || `${e.name} ${(e.tags || []).join(' ')} ${e.body} ${fieldText(e)}`.toLowerCase().includes(q)));
  if (!items.length) {
    $('#list').innerHTML = `<div class="empty">${entries().size ? 'Nothing matches.' : 'No entries yet.<br>Click <b>New entry</b> to start, or import a JSON file.'}</div>`;
    return;
  }
  $('#list').innerHTML = items.map((e) => {
    const f = e.fields || {};
    const meta = [TYPES[e.type]?.label, f.mtype, f.level ? `L${f.level}` : '', f.number ? `#${f.number}` : '', nameOf(e.parent)].filter(Boolean).join(' · ');
    const tagBadges = (e.tags || []).filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ');
    return `<div class="row" data-id="${e.id}" aria-current="${e.id === S.selected}"><span class="n">${esc(e.name) || '<i>Untitled</i>'}</span><span class="k">${f.level ? `L${esc(f.level)}` : ''}</span><span class="m">${esc(meta)}${tagBadges ? ` ${tagBadges}` : ''}</span></div>`;
  }).join('');
}

/* ===================== Render: editor ===================== */
function renderEditor() {
  const e = entries().get(S.selected);
  if (!e) {
    $('#edit').innerHTML = '<div class="empty" style="padding-top:80px">Select an entry on the left, or create one.<br><br><button class="btn primary" id="newBtn2">+ New entry</button></div>';
    $('#newBtn2')?.addEventListener('click', createEntry);
    return;
  }
  const T = TYPES[e.type] || TYPES.article; const f = e.fields || {};
  const typeSel = `<select class="type" data-k="__type" aria-label="Entry type">${GROUPS.map((g) => `<optgroup label="${esc(g)}">${Object.keys(TYPES).filter((t) => TYPES[t].group === g).map((t) => `<option value="${t}" ${t === e.type ? 'selected' : ''}>${esc(TYPES[t].label)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  let h = `<div class="head">${typeSel}<input class="name" data-k="__name" value="${esc(e.name)}" placeholder="Name" aria-label="Name"></div><div class="grid">`;
  if (T.parent) {
    const opts = sortedEntries().filter((p) => T.parent.includes(p.type) && p.id !== e.id);
    h += `<div class="field wide"><label>Belongs to (${T.parent.map((t) => TYPES[t].label).join(' or ')})</label><select data-k="__parent"><option value="">— none —</option>${opts.map((p) => `<option value="${p.id}" ${p.id === e.parent ? 'selected' : ''}>${esc(p.name)} (${esc(TYPES[p.type].label)})</option>`).join('')}</select></div>`;
  }
  for (const fd of T.fields) {
    const v = f[fd.k] ?? ''; let inp;
    if (fd.t === 'select') inp = `<select data-k="${fd.k}"><option value="">—</option>${fd.o.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (fd.t === 'textarea') inp = `<textarea data-k="${fd.k}" ${fd.mono ? 'style="font-family:var(--mono);font-size:12.5px"' : ''}>${esc(v)}</textarea>`;
    else inp = `<input data-k="${fd.k}" type="${fd.t === 'number' ? 'number' : 'text'}" ${fd.t === 'number' ? 'min="0" step="1"' : ''} value="${esc(v)}">`;
    h += `<div class="field ${fd.wide ? 'wide' : ''} ${fd.mono ? 'mono' : ''}"><label>${esc(fd.l)}</label>${inp}</div>`;
  }
  h += `<div class="field wide"><label>Tags / descriptors</label><input data-k="__tags" value="${esc((e.tags || []).join(', '))}" placeholder="Condition, Airborne, Fear"></div>`;
  h += `<div class="field wide"><label>${esc(T.bodyLabel)}</label><textarea class="body" data-k="__body" placeholder="Write the rules text here.">${esc(e.body)}</textarea>
      <div class="hint">Type <code>[[</code> to link an entry: a list of matches appears as you type, ↑↓ and Enter pick one. <code>[[Entry Name|shown text]]</code> changes the shown text. <code>**bold**</code>, <code>*italic*</code>, <code>- bullets</code>, <code>## heading</code>, <code>&gt; note</code>, and <code>| pipe | tables |</code> all render.</div></div></div>`;
  h += `<div class="editfoot"><span class="save" id="saveState">${S.dirty ? 'unsaved changes' : 'saved'}</span>
      ${T.children ? `<button class="btn small" id="addChild">+ Add ${esc(TYPES[T.children[0]].label.toLowerCase())}</button>` : ''}
      <button class="btn small" id="dupBtn">Duplicate</button><button class="btn small danger" id="delBtn">Delete</button></div>`;
  $('#edit').innerHTML = h; S.rendered = stable(e);
  $('#edit').querySelectorAll('[data-k]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', onEdit));
  $('#addChild')?.addEventListener('click', async () => {
    const c = newEntry(T.children[0], '', e.id);
    if (c.type === 'maneuver') c.fields = { level: 1, mtype: 'Strike', action: 'Standard' };
    S.selected = c.id; await writeEntry(c); renderAll(); $('#edit .name')?.focus();
  });
  $('#dupBtn').addEventListener('click', async () => {
    const c = { ...structuredClone(e), id: `${slug(e.name)}-${uid()}`, name: `${e.name} (copy)`, createdAt: now(), updatedAt: now() };
    S.selected = c.id; await writeEntry(c); renderAll();
  });
  $('#delBtn').addEventListener('click', async () => {
    const kids = childrenOf(e.id);
    if (!await ask(`Delete “${e.name || 'Untitled'}”?${kids.length ? ` Its ${kids.length} child entries will be kept but unlinked.` : ''}`)) return;
    for (const k of kids) { k.parent = ''; await writeEntry(k); }
    await removeEntry(e.id); S.selected = firstId(); S.dirty = false; renderAll(); toast('Deleted');
  });
}
function onEdit(ev) {
  const e = entries().get(S.selected); if (!e) return;
  const el = ev.target; const k = el.dataset.k; const v = el.value;
  if (k === '__type') { e.type = v; if (!TYPES[v].parent) e.parent = ''; e.fields = e.fields || {}; e.updatedAt = now(); S.dirty = true; scheduleSave(e); renderAll(); return; }
  if (k === '__name') e.name = v; else if (k === '__parent') e.parent = v; else if (k === '__tags') e.tags = v.split(',').map((s) => s.trim()).filter(Boolean);
  else if (k === '__body') e.body = v; else { e.fields = e.fields || {}; e.fields[k] = el.type === 'number' ? (v === '' ? '' : +v) : v; }
  e.updatedAt = now(); S.dirty = true; S.rendered = stable(e); $('#saveState').textContent = 'unsaved changes';
  scheduleSave(e); renderPreview(); if (['__name', '__parent', '__tags', 'level', 'mtype'].includes(k)) renderRail();
}
function scheduleSave(e) { S.pendingSave.set(e.id, e); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flushSaves, 600); }
async function flushSaves() {
  const list = [...S.pendingSave.values()]; S.pendingSave.clear();
  for (const e of list) await writeEntry(e);
  S.dirty = false; const st = $('#saveState'); if (st) st.textContent = 'saved';
}
window.addEventListener('beforeunload', () => { if (S.pendingSave.size) flushSaves(); });

/* ===================== Render: preview ===================== */
function renderPreview() {
  const e = entries().get(S.selected);
  if (!e) { $('#view').innerHTML = ''; return; }
  let h = `${renderSheet(e)}<div class="side">`;
  if (e.type === 'discipline') h += renderAudit(e);
  const tags = (e.tags || []).filter(Boolean);
  if (tags.length) h += `<h5>Tags</h5><ul><li>${tags.map((t) => `<a class="wl" data-tag-go="${esc(t)}">${esc(t)}</a>`).join(' · ')}</li></ul>`;
  const bl = backlinksTo(e.id);
  h += `<h5>Linked from</h5>${bl.length ? `<ul>${bl.map((b) => `<li><a class="wl" data-go="${b.id}">${esc(b.name)}</a> <span class="badge">${esc(TYPES[b.type]?.label || b.type)}</span></li>`).join('')}</ul>` : `<div class="none">Nothing links here yet. Write [[${esc(e.name || 'Name')}]] in another entry to create a link.</div>`}`;
  const broken = [...new Set(linksIn(`${e.body} ${fieldText(e)}`).filter((n) => !resolveName(n)))];
  if (broken.length) h += `<h5>Unresolved links</h5><ul>${broken.map((n) => `<li><a class="wl broken" data-make="${esc(n)}">${esc(n)}</a> <span class="badge">click to create</span></li>`).join('')}</ul>`;
  $('#view').innerHTML = `${h}</div>`;
}
function renderAll(keepEditor) { renderRail(); if (!keepEditor) renderEditor(); renderPreview(); }

/* ===================== Actions ===================== */
async function createEntry() {
  const type = S.filter !== 'all' ? S.filter : 'article'; const e = newEntry(type, '');
  if (type === 'maneuver') e.fields = { level: 1, mtype: 'Strike', action: 'Standard' };
  if (S.tag) e.tags = [S.tag];
  S.selected = e.id; S.dirty = false; await writeEntry(e); renderAll(); $('#app').dataset.pane = 'edit'; $('#edit .name')?.focus();
}
function go(id) { if (S.pendingSave.size) flushSaves(); S.selected = id; S.dirty = false; renderAll(); if (window.innerWidth <= 1100) $('#app').dataset.pane = 'edit'; }
async function makeFromLink(name) {
  const cur = entries().get(S.selected); let type = 'article'; let parent = '';
  if (cur?.type === 'discipline') { type = 'maneuver'; parent = cur.id; } else if (cur?.type === 'maneuver') { type = 'maneuver'; parent = cur.parent; } else if (cur?.type === 'campaign') { parent = cur.id; type = 'location'; }
  const e = newEntry(type, name, parent); if (type === 'maneuver') e.fields = { level: cur?.fields?.level || 1, mtype: 'Strike', action: 'Standard' };
  if (S.pendingSave.size) await flushSaves();
  await writeEntry(e); S.selected = e.id; S.dirty = false; renderAll();
  toast(`Created “${name}” as ${TYPES[type].label.toLowerCase()} — change its type in the editor if needed`);
}
document.addEventListener('click', (ev) => {
  const go_ = ev.target.closest('[data-go]'); if (go_) { go(go_.dataset.go); return; }
  const mk = ev.target.closest('[data-make]'); if (mk) { makeFromLink(mk.dataset.make); return; }
  const tg = ev.target.closest('[data-tag-go]'); if (tg) { S.tag = tg.dataset.tagGo; S.filter = 'all'; renderRail(); $('#app').dataset.pane = 'list'; return; }
  const row = ev.target.closest('.row[data-id]'); if (row) { go(row.dataset.id); return; }
  const chip = ev.target.closest('.chip[data-f]'); if (chip) { S.filter = chip.dataset.f; renderRail(); return; }
  const tchip = ev.target.closest('.chip[data-tag]'); if (tchip) { S.tag = S.tag === tchip.dataset.tag ? '' : tchip.dataset.tag; renderRail(); return; }
  const tab = ev.target.closest('.panetabs [data-pane]'); if (tab) { $('#app').dataset.pane = tab.dataset.pane; $$('.panetabs button').forEach((b) => b.setAttribute('aria-selected', b === tab)); return; }
  if (!ev.target.closest('#ioMenu')) $('#ioMenu').classList.remove('open');
});
$('#newBtn').addEventListener('click', createEntry);
$('#q').addEventListener('input', (ev) => { S.q = ev.target.value; renderRail(); });
$('#ioBtn').addEventListener('click', () => $('#ioMenu').classList.toggle('open'));
$('#ioMenu .drop').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-act]'); if (!b) return; $('#ioMenu').classList.remove('open'); doIO(b.dataset.act); });
$('#publishBtn').addEventListener('click', publishToSheet);
document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); flushSaves(); toast('Saved'); }
  if (ev.key === 'Escape') $('#ask').classList.remove('open');
});

function ask(msg) {
  return new Promise((res) => {
    $('#askMsg').textContent = msg; $('#ask').classList.add('open');
    const done = (v) => { $('#ask').classList.remove('open'); $('#askOk').onclick = null; $('#askNo').onclick = null; res(v); };
    $('#askOk').onclick = () => done(true); $('#askNo').onclick = () => done(false); $('#askOk').focus();
  });
}
function toast(msg, kind) { const t = document.createElement('div'); t.className = `toast ${kind || ''}`; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3200); }

/* ===================== Import / Export ===================== */
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: filename.endsWith('.json') ? 'application/json' : 'text/markdown' }));
  a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function mdOf(e, depth = 0) {
  const T = TYPES[e.type] || TYPES.article; const f = e.fields || {};
  let s = `${'#'.repeat(Math.min(depth + 1, 4))} ${e.name}\n*${T.label}${e.parent ? ` · ${nameOf(e.parent)}` : ''}${(e.tags || []).length ? ` [${e.tags.join('] [')}]` : ''}*\n\n`;
  for (const fd of T.fields) if (f[fd.k] !== '' && f[fd.k] != null) s += `**${fd.l}:** ${f[fd.k]}  \n`;
  s += `\n${e.body}\n\n`;
  for (const k of childrenOf(e.id)) s += mdOf(k, depth + 1);
  return s;
}
async function nextRevision() { const rev = (Number(store.getMeta('packRevision')) || 0) + 1; await store.setMeta('packRevision', rev); return rev; }
async function doIO(act) {
  const cur = entries().get(S.selected);
  if (act === 'import') { $('#fileIn').value = ''; $('#fileIn').click(); return; }
  if (act === 'sheet') { window.open('../app/', '_blank'); return; }
  if (act === 'exp-project') return download('homebrew-workbench-project.json', JSON.stringify({ format: 'homebrew-workbench', version: 1, exportedAt: now(), entries: sortedEntries() }, null, 1));
  if (act === 'exp-ext') {
    if (!entries().size) return toast('Nothing to export', 'bad');
    const rev = await nextRevision();
    return download('homebrew-workbench.json', JSON.stringify(forgeToPack(sortedEntries(), { revision: rev }), null, 1));
  }
  if (act === 'exp-md') { if (!cur) return toast('Select an entry first', 'bad'); return download(`${slug(cur.name)}.md`, mdOf(cur)); }
  if (act === 'exp-md-all') {
    let s = '# Homebrew Workbench\n\n';
    for (const g of GROUPS) { const ts = Object.keys(TYPES).filter((t) => TYPES[t].group === g); const es = sortedEntries().filter((e) => ts.includes(e.type) && !e.parent); if (es.length) { s += `# ${g}\n\n`; es.forEach((e) => { s += mdOf(e, 1); }); } }
    return download('homebrew-workbench.md', s);
  }
  return undefined;
}
$('#fileIn').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  let data; try { data = JSON.parse(await file.text()); } catch { return toast('That file is not valid JSON', 'bad'); }
  let list = [];
  if ((data.format === 'homebrew-workbench' || data.format === 'primordia-forge') && Array.isArray(data.entries)) list = data.entries.filter((e) => e && e.id && TYPES[e.type]);
  else if (data.format === 'character-sheet-extension' || data.provides || data.blocks) list = importPack(data, sortedEntries());
  else return toast('Unrecognised file. Expected a Forge project or a character-sheet-extension pack.', 'bad');
  if (!list.length) return toast('Nothing new to import');
  if (!await ask(`Import ${list.length} entries?`)) return;
  try { await store.saveMany(list); } catch (err) { return toast(`Import failed: ${err.message}`, 'bad'); }
  reindex(); if (!S.selected) S.selected = list[0].id; renderAll(); statusIdle(); toast(`Imported ${list.length} entries`);
  return undefined;
});

/**
 * The pack, straight into the sheet's local extension store -- the same
 * IndexedDB the Extensions dialog imports into -- under the id
 * `homebrew-workbench`, replacing the last revision. The sheet reads its packs
 * at load, so a tab already open needs a reload to see the new one.
 */
let sheetStore = null;
async function publishToSheet() {
  if (!entries().size) return toast('Nothing to publish', 'bad');
  try {
    sheetStore = sheetStore || extensionStore(() => packMedium({ holds: isPackKey, keep: packsWorthMoving }));
    await sheetStore.open();
    const prior = sheetStore.read('homebrew-workbench');
    const rev = Math.max(await nextRevision(), (Number(prior?.revision) || 0) + 1);
    const pack = forgeToPack(sortedEntries(), { revision: rev, createdAt: prior?.createdAt });
    const row = await sheetStore.save(pack, { origin: 'forge' });
    toast(`${row.replaced ? 'Updated' : 'Published'} “${row.name}” rev ${rev} in this browser's sheet — reload the sheet to load it`);
  } catch (err) { toast(`Publish failed: ${err.message}`, 'bad'); }
  return undefined;
}

/* ===================== [[link]] autocomplete ===================== */
const AC = { el: null, items: [], idx: 0, start: 0 };
const acBox = document.createElement('div'); acBox.id = 'ac'; acBox.hidden = true; document.body.appendChild(acBox);
const acField = 'textarea[data-k],input[data-k]:not([type="number"]):not(.name)';
function acContext(el) { if (!el || !('selectionStart' in el)) return null; const pos = el.selectionStart; const m = el.value.slice(0, pos).match(/\[\[([^[\]|]*)$/); return m ? { q: m[1], start: pos - m[0].length } : null; }
function acUpdate(el) {
  const c = acContext(el); if (!c) { acClose(); return; }
  const q = c.q.trim().toLowerCase();
  const items = sortedEntries().filter((e) => e.name && e.id !== S.selected)
    .map((e) => { const n = e.name.toLowerCase(); return { e, score: !q ? 1 : n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2 }; }).filter((x) => x.score < 2)
    .sort((a, b) => a.score - b.score || a.e.name.localeCompare(b.e.name)).slice(0, 8).map((x) => x.e);
  Object.assign(AC, { el, items, idx: 0, start: c.start });
  acBox.innerHTML = items.length
    ? items.map((e, i) => `<div class="ac-row" data-i="${i}" aria-selected="${i === 0}"><span>${esc(e.name)}</span><span class="badge">${esc(TYPES[e.type]?.label || e.type)}${e.parent && nameOf(e.parent) ? ` · ${esc(nameOf(e.parent))}` : ''}</span></div>`).join('')
    : `<div class="ac-none">No entry matches “${esc(c.q)}”. Close the brackets and the link will be offered as a new entry.</div>`;
  acBox.hidden = false; acPlace(el);
}
function caretXY(el) {
  const d = document.createElement('div'); const cs = getComputedStyle(el);
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderTopWidth', 'boxSizing']) d.style[p] = cs[p];
  Object.assign(d.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '0', width: `${el.clientWidth}px`, whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word' });
  d.textContent = el.value.slice(0, el.selectionStart); const s = document.createElement('span'); s.textContent = '​'; d.appendChild(s); document.body.appendChild(d);
  const r = { x: s.offsetLeft - el.scrollLeft, y: s.offsetTop - el.scrollTop }; d.remove(); return r;
}
function acPlace(el) {
  const r = el.getBoundingClientRect(); const c = caretXY(el);
  const left = Math.max(8, Math.min(r.left + c.x, window.innerWidth - acBox.offsetWidth - 8));
  let top = r.top + c.y + 24; if (top + acBox.offsetHeight > window.innerHeight - 8) top = r.top + c.y - acBox.offsetHeight - 4;
  acBox.style.left = `${left}px`; acBox.style.top = `${Math.max(8, top)}px`;
}
function acClose() { acBox.hidden = true; AC.el = null; AC.items = []; }
function acAccept(i) {
  const e = AC.items[i]; const el = AC.el; if (!e || !el) return;
  const before = el.value.slice(0, AC.start); const after = el.value.slice(el.selectionStart); const ins = `[[${e.name}]]`;
  el.value = before + ins + after; const pos = before.length + ins.length; el.setSelectionRange(pos, pos);
  acClose(); el.dispatchEvent(new Event('input', { bubbles: true })); el.focus();
}
function acMove(d) { if (!AC.items.length) return; AC.idx = (AC.idx + d + AC.items.length) % AC.items.length; acBox.querySelectorAll('.ac-row').forEach((r, i) => r.setAttribute('aria-selected', i === AC.idx)); }
$('#edit').addEventListener('input', (ev) => { if (ev.target.matches(acField)) acUpdate(ev.target); });
$('#edit').addEventListener('click', (ev) => { if (ev.target.matches(acField)) acUpdate(ev.target); });
$('#edit').addEventListener('keydown', (ev) => {
  if (acBox.hidden || ev.target !== AC.el) return;
  if (ev.key === 'ArrowDown') { ev.preventDefault(); acMove(1); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); acMove(-1); } else if ((ev.key === 'Enter' || ev.key === 'Tab') && AC.items.length) { ev.preventDefault(); acAccept(AC.idx); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); acClose(); }
});
$('#edit').addEventListener('focusout', () => setTimeout(() => { if (document.activeElement !== AC.el) acClose(); }, 150));
$('#edit').addEventListener('scroll', () => { if (!acBox.hidden && AC.el) acPlace(AC.el); });
acBox.addEventListener('mousedown', (ev) => { ev.preventDefault(); const r = ev.target.closest('.ac-row'); if (r) acAccept(+r.dataset.i); });

/* ===================== Boot ===================== */
mountThemes($('#themePick'));
(async () => {
  try { await store.open(); } catch (err) { setStatus('local', err.message); }
  reindex(); if (!S.selected && entries().size) S.selected = firstId();
  statusIdle(); renderAll();
})();
