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
import { TYPES, GROUPS, BASE, esc, uid, slug, now, ord, str, newEntry, linksIn, sortEntries, applyCustomTypes, normalizeCustomTypes } from './schema.js';
import { forgeStore } from './store.js';
import { forgeToPack, importPack } from './pack.js';
import { extensionStore, isPackKey, packsWorthMoving } from '../../app/js/extensions.js';
import { packMedium } from '../../app/js/pack-storage.js';
import { mountThemes } from './theme.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, kk) => { a[kk] = v[kk]; return a; }, {}) : v));

const store = forgeStore();
const S = { selected: null, dirty: false, filter: 'all', tag: '', q: '', nameIndex: new Map(), saveTimer: null, pendingSave: new Map(), rendered: '', folded: readFolded(), revealed: null };

/* Which containers in the list are folded shut. A browser preference: the
   list is a way of reading, and which disciplines you keep shut is nothing
   about the disciplines. */
const FOLD_KEY = 'homebrew-workbench:folded';
function readFolded() { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); } }
function writeFolded() { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...S.folded])); } catch { /* not fatal */ } }

/* ===================== Entries ===================== */
const entries = () => store.entries();
const nameOf = (id) => entries().get(id)?.name || '';
const sortedEntries = () => sortEntries(entries().values(), nameOf);
const childrenOf = (id) => sortedEntries().filter((e) => e.parent === id);
/*
 * The second way an entry sits under a container: by naming it in a tag. An
 * article tagged "Tempest Gale" is filed with that discipline -- in the list,
 * in the discipline's preview, in the Markdown -- rather than at the end of
 * the list with the other articles, though nothing structural has changed:
 * it has no parent, and deleting the discipline leaves it where it is. The
 * tag has to be the container's name (case aside), and only a kind that
 * holds children counts as a container. `contentsOf` is what the readers
 * use; `childrenOf` stays for what needs the real link, such as unlinking
 * on delete.
 */
const isContainer = (e) => !!(e && TYPES[e.type]?.children);
const taggedTo = (id) => {
  const c = entries().get(id);
  if (!isContainer(c)) return [];
  const key = c.name.trim().toLowerCase();
  return key ? sortedEntries().filter((e) => e.id !== id && e.parent !== id && (e.tags || []).some((t) => t.trim().toLowerCase() === key)) : [];
};
const contentsOf = (id) => [...childrenOf(id), ...taggedTo(id)];
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
  // Web links: [label](https://…), and a bare https://… on its own. Both open
  // in a new tab, since this page is the one being written in. The text was
  // escaped above, so an & in an address is already &amp;, which an href reads.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="ext" href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+?)([.,;:!?)]*)(?=\s|$)/g, '$1<a class="ext" href="$2" target="_blank" rel="noopener">$2</a>$3');
  return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/__([^_\n]+)__/g, '<u>$1</u>');
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
      h += `<p class="sub">${parentLink || ''}${f.level ? ` · ${ord(f.level)} level` : ''}${f.kind && f.kind !== '—' ? ` (${esc(f.kind)})` : ''}${tagStr}</p>${md(e.body)}${kv('Replaces:', f.replaces)}${kv('Alters:', f.alters)}`; break;
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
      // A category of the player's own: its cells, then its text.
      h += `<p class="sub">${esc(T.label)}${tagStr}</p>${T.fields.map((fd) => kv(`${fd.l}:`, f[fd.k])).join('')}${md(e.body)}`;
  }
  // Contents: what is directly under this, and what is under those, indented
  // by depth -- a group of cuts under a technique reads as the group it is.
  const deep = (id, depth, seen = new Set()) => contentsOf(id).flatMap((k) => (seen.has(k.id) ? [] : (seen.add(k.id), [{ k, depth }, ...deep(k.id, depth + 1, seen)])));
  const kids = contentsOf(e.id);
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
      for (const t in byType) h += `<div class="lvl">${esc(TYPES[t]?.plural || t)}</div><ul>${byType[t].flatMap((m) => [{ k: m, depth: 0 }, ...deep(m.id, 1)]).map(({ k: m, depth }) => `<li style="margin-left:${depth * 14}px">${depth ? '↳ ' : ''}<a class="wl" data-go="${m.id}">${esc(m.name)}</a>${m.fields?.level ? ` <span class="badge">L${esc(m.fields.level)}</span>` : ''}</li>`).join('')}</ul>`;
    }
    h += '</div>';
  }
  const tint = /^#[0-9a-f]{6}$/i.test(e.color || '') ? ` style="--entry-color:${e.color}"` : '';
  return `<article class="sheet"${tint}>${h}</article>`;
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
  /*
   * A tree, where the list holds both a container and what it holds: a
   * maneuver sits under its discipline, a class feature under its class or
   * archetype, and a container with something under it folds -- shut, it is
   * one row and a count. An entry whose container is not in the list (the
   * filter is on Maneuvers, say) stands at the top level as before. A search
   * unfolds everything, since a match hidden in a fold is no match; and the
   * open entry's containers are never shut over it.
   */
  const inList = new Set(items.map((e) => e.id));
  const kidsOf = new Map();
  const under = new Map();   // entry id -> the container it is shown under
  const file = (e, under_) => { if (!kidsOf.has(under_)) kidsOf.set(under_, []); kidsOf.get(under_).push(e); under.set(e.id, under_); };
  for (const e of items) if (e.parent && inList.has(e.parent)) file(e, e.parent);
  // Then the tagged ones, after a container's own children.
  for (const e of items) {
    if (under.has(e.id)) continue;
    const host = (e.tags || []).map((t) => resolveName(t)).find((id) => id && id !== e.id && inList.has(id) && isContainer(entries().get(id)));
    if (host) file(e, host);
  }
  // The open entry's containers open -- once, when it becomes the open one.
  // Not on every redraw: a fold made over the open entry would otherwise be
  // undone by the redraw the fold itself causes, and a group holding the open
  // entry could never be shut at all.
  if (S.revealed !== S.selected) {
    for (let p = under.get(S.selected); p; p = under.get(p)) S.folded.delete(p);
    S.revealed = S.selected;
  }
  const drawn = new Set();
  const row = (e, depth) => {
    // Two containers tagged with each other's names would otherwise nest forever.
    if (drawn.has(e.id)) return '';
    drawn.add(e.id);
    const f = e.fields || {};
    const kids = kidsOf.get(e.id) || [];
    const folded = !q && kids.length > 0 && S.folded.has(e.id);
    const meta = [TYPES[e.type]?.label, f.mtype, f.level ? `L${f.level}` : '', f.number ? `#${f.number}` : '', depth ? '' : nameOf(e.parent)].filter(Boolean).join(' · ');
    const tagBadges = (e.tags || []).filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ');
    const fold = kids.length
      ? `<button class="fold" data-fold="${e.id}" aria-expanded="${!folded}" title="${folded ? 'Show' : 'Hide'} the ${kids.length} ${kids.length === 1 ? 'entry' : 'entries'} under this">${folded ? '▸' : '▾'}</button>`
      : '';
    const tint = /^#[0-9a-f]{6}$/i.test(e.color || '') ? `;--entry-color:${e.color}` : '';
    return `<div class="row${depth ? ' child' : ''}${kids.length ? ' hasfold' : ''}${tint ? ' tinted' : ''}" data-id="${e.id}" style="--depth:${depth}${tint}" aria-current="${e.id === S.selected}">${fold}<span class="n">${esc(e.name) || '<i>Untitled</i>'}</span><span class="k">${f.level ? `L${esc(f.level)}` : folded ? `${kids.length}` : ''}</span><span class="m">${esc(meta)}${tagBadges ? ` ${tagBadges}` : ''}</span></div>`
      + (folded ? '' : kids.map((k) => row(k, depth + 1)).join(''));
  };
  $('#list').innerHTML = items.filter((e) => !under.has(e.id)).map((e) => row(e, 0)).join('');
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
    // Not itself, and not anything under it: a container inside its own
    // contents is a loop the list, the preview and the export would follow forever.
    const below = new Set(); const walk = (id) => { for (const k of childrenOf(id)) if (!below.has(k.id)) { below.add(k.id); walk(k.id); } }; walk(e.id);
    const opts = sortedEntries().filter((p) => T.parent.includes(p.type) && p.id !== e.id && !below.has(p.id));
    h += `<div class="field wide"><label>Belongs to (${T.parent.map((t) => TYPES[t].label).join(' or ')})</label><select data-k="__parent"><option value="">— none —</option>${opts.map((p) => `<option value="${p.id}" ${p.id === e.parent ? 'selected' : ''}>${esc(p.name)} (${esc(TYPES[p.type].label)})</option>`).join('')}</select></div>`;
  }
  const fieldHtml = (fd) => {
    const v = f[fd.k] ?? ''; let inp;
    if (fd.t === 'select') inp = `<select data-k="${fd.k}"><option value="">—</option>${fd.o.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (fd.t === 'textarea') inp = `<textarea data-k="${fd.k}" ${fd.mono ? 'style="font-family:var(--mono);font-size:12.5px"' : ''}>${esc(v)}</textarea>`;
    else inp = `<input data-k="${fd.k}" type="${fd.t === 'number' ? 'number' : 'text'}" ${fd.t === 'number' ? 'min="0" step="1"' : ''} value="${esc(v)}">`;
    return `<div class="field ${fd.wide ? 'wide' : ''} ${fd.mono ? 'mono' : ''}"><label>${esc(fd.l)}</label>${inp}</div>`;
  };
  // A field marked `after` sits under the description -- a class feature's
  // "replaces" and "alters", which are the last thing said about it.
  for (const fd of T.fields.filter((fd) => !fd.after)) h += fieldHtml(fd);
  h += `<div class="field wide"><label>Tags / descriptors</label><input data-k="__tags" value="${esc((e.tags || []).join(', '))}" placeholder="Condition, Airborne, Fear"></div>`;
  h += `<div class="field wide"><label>${esc(T.bodyLabel)}</label><textarea class="body" data-k="__body" placeholder="Write the rules text here.">${esc(e.body)}</textarea>
      <div class="hint">Type <code>[[</code> to link an entry: a list of matches appears as you type, ↑↓ and Enter pick one. <code>[[Entry Name|shown text]]</code> changes the shown text; <code>[shown text](https://…)</code> is a web link, and a bare address links itself. <code>**bold**</code>, <code>*italic*</code>, <code>__underline__</code>, <code>- bullets</code>, <code>## heading</code>, <code>&gt; note</code>, and <code>| pipe | tables |</code> all render.
      <kbd>Ctrl</kbd><kbd>B</kbd> bold · <kbd>Ctrl</kbd><kbd>I</kbd> italic · <kbd>Ctrl</kbd><kbd>U</kbd> underline · <kbd>Ctrl</kbd><kbd>K</kbd> link · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>8</kbd> bullets · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>9</kbd> note · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>1</kbd>–<kbd>3</kbd> heading.</div></div>`;
  for (const fd of T.fields.filter((fd) => fd.after)) h += fieldHtml(fd);
  h += '</div>';
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
    // What Undo puts back: the entry as it was, and the children's link to it.
    const gone = structuredClone(e);
    const unlinked = kids.map((k) => k.id);
    // A save the editor scheduled for this entry must not land after the
    // delete and write it back: an edit followed within the second by Delete
    // used to come back on its own.
    S.pendingSave.delete(e.id);
    for (const k of kids) { k.parent = ''; await writeEntry(k); }
    await removeEntry(e.id); S.selected = firstId(); S.dirty = false; renderAll();
    toast(`Deleted “${gone.name || 'Untitled'}”`, '', { label: 'Undo', run: async () => {
      await writeEntry(gone);
      for (const id of unlinked) { const k = entries().get(id); if (k) { k.parent = gone.id; await writeEntry(k); } }
      S.selected = gone.id; renderAll(); statusIdle();
    } });
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
  S.selected = e.id; S.dirty = false; await writeEntry(e); renderAll(); if (window.innerWidth <= 1100) setPane('edit'); $('#edit .name')?.focus();
}
/* Which pane a narrow window shows; the tab buttons follow. */
function setPane(pane) { $('#app').dataset.pane = pane; $$('.panetabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.pane === pane)); }
/* Open an entry. On a narrow window the pane it opens in is the editor,
   unless the link was followed from inside the preview, where a reader who
   is reading stays reading. */
function go(id, pane = 'edit') { if (S.pendingSave.size) flushSaves(); S.selected = id; S.dirty = false; renderAll(); if (window.innerWidth <= 1100) setPane(pane); }
async function makeFromLink(name) {
  const cur = entries().get(S.selected); let type = 'article'; let parent = '';
  if (cur?.type === 'discipline') { type = 'maneuver'; parent = cur.id; } else if (cur?.type === 'maneuver') { type = 'maneuver'; parent = cur.parent; } else if (cur?.type === 'campaign') { parent = cur.id; type = 'location'; }
  const e = newEntry(type, name, parent); if (type === 'maneuver') e.fields = { level: cur?.fields?.level || 1, mtype: 'Strike', action: 'Standard' };
  if (S.pendingSave.size) await flushSaves();
  await writeEntry(e); S.selected = e.id; S.dirty = false; renderAll();
  toast(`Created “${name}” as ${TYPES[type].label.toLowerCase()} — change its type in the editor if needed`);
}
document.addEventListener('click', (ev) => {
  const go_ = ev.target.closest('[data-go]'); if (go_) { go(go_.dataset.go, go_.closest('#view') && $('#app').dataset.pane === 'view' ? 'view' : 'edit'); return; }
  const mk = ev.target.closest('[data-make]'); if (mk) { makeFromLink(mk.dataset.make); return; }
  const tg = ev.target.closest('[data-tag-go]'); if (tg) { S.tag = tg.dataset.tagGo; S.filter = 'all'; renderRail(); setPane('list'); return; }
  const fold = ev.target.closest('[data-fold]');
  if (fold) { const id = fold.dataset.fold; if (S.folded.has(id)) S.folded.delete(id); else S.folded.add(id); writeFolded(); renderRail(); return; }
  const row = ev.target.closest('.row[data-id]'); if (row) { go(row.dataset.id); return; }
  const chip = ev.target.closest('.chip[data-f]'); if (chip) { S.filter = chip.dataset.f; renderRail(); return; }
  const tchip = ev.target.closest('.chip[data-tag]'); if (tchip) { S.tag = S.tag === tchip.dataset.tag ? '' : tchip.dataset.tag; renderRail(); return; }
  const tab = ev.target.closest('.panetabs [data-pane]'); if (tab) { setPane(tab.dataset.pane); return; }
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
/* A toast, and optionally one thing to do about it -- Undo, mostly. A toast
   with an action stays longer, since it is asking for a decision. */
function toast(msg, kind, action = null) {
  const t = document.createElement('div'); t.className = `toast ${kind || ''}`; t.textContent = msg;
  if (action) {
    const b = document.createElement('button'); b.className = 'act'; b.textContent = action.label;
    b.addEventListener('click', () => { t.remove(); action.run(); });
    t.appendChild(b);
  }
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), action ? 9000 : 3200);
}

/* ===================== Import / Export ===================== */
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: filename.endsWith('.json') ? 'application/json' : 'text/markdown' }));
  a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function mdOf(e, depth = 0, seen = new Set()) {
  if (seen.has(e.id)) return ''; seen.add(e.id);
  const T = TYPES[e.type] || TYPES.article; const f = e.fields || {};
  let s = `${'#'.repeat(Math.min(depth + 1, 4))} ${e.name}\n*${T.label}${e.parent ? ` · ${nameOf(e.parent)}` : ''}${(e.tags || []).length ? ` [${e.tags.join('] [')}]` : ''}*\n\n`;
  const has = (fd) => f[fd.k] !== '' && f[fd.k] != null;
  for (const fd of T.fields) if (!fd.after && has(fd)) s += `**${fd.l}:** ${f[fd.k]}  \n`;
  s += `\n${e.body}\n\n`;
  for (const fd of T.fields) if (fd.after && has(fd)) s += `**${fd.l}:** ${f[fd.k]}  \n`;
  if (T.fields.some((fd) => fd.after && has(fd))) s += '\n';
  for (const k of contentsOf(e.id)) s += mdOf(k, depth + 1, seen);
  return s;
}
async function nextRevision() { const rev = (Number(store.getMeta('packRevision')) || 0) + 1; await store.setMeta('packRevision', rev); return rev; }
async function doIO(act) {
  const cur = entries().get(S.selected);
  if (act === 'import') { $('#fileIn').value = ''; $('#fileIn').click(); return; }
  if (act === 'sheet') { window.open('../app/', '_blank'); return; }
  if (act === 'exp-project') return download('homebrew-workbench-project.json', JSON.stringify({ format: 'homebrew-workbench', version: 1, exportedAt: now(), customTypes: store.getMeta('customTypes') || [], entries: sortedEntries() }, null, 1));
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
  let cats = 0;
  if ((data.format === 'homebrew-workbench' || data.format === 'primordia-forge') && Array.isArray(data.entries)) {
    // The other workbench's categories first, so its entries of those kinds
    // are kinds here too. Merged by id, the file's version winning.
    const incoming = normalizeCustomTypes(data.customTypes);
    if (incoming.length) {
      const mine = normalizeCustomTypes(store.getMeta('customTypes'));
      const merged = [...mine.filter((c) => !incoming.some((i) => i.id === c.id)), ...incoming];
      await store.setMeta('customTypes', merged); applyCustomTypes(merged); cats = incoming.length;
    }
    list = data.entries.filter((e) => e && e.id && TYPES[e.type]);
  }
  else if (data.format === 'character-sheet-extension' || data.provides || data.blocks) list = importPack(data, sortedEntries());
  else return toast('Unrecognised file. Expected a Forge project or a character-sheet-extension pack.', 'bad');
  if (!list.length) { if (cats) renderAll(); return toast(cats ? `Read ${cats} categories; no entries to import` : 'Nothing new to import'); }
  if (!await ask(`Import ${list.length} entries${cats ? ` and ${cats} categories` : ''}?`)) return;
  try { await store.saveMany(list); } catch (err) { return toast(`Import failed: ${err.message}`, 'bad'); }
  reindex(); if (!S.selected) S.selected = list[0].id; renderAll(); statusIdle(); toast(`Imported ${list.length} entries${cats ? ` and ${cats} categories` : ''}`);
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

/* ===================== The rail divider ===================== */
/* The bar between the filter chips and the entry list slides. The chips'
   height is kept in the browser and put on the rail as `--rail-split`; the
   stylesheet reads it, and without it the chips take what they need up to
   46% of the rail as they always did. Each side keeps a minimum -- the chips
   two rows, the list a few entries -- so neither can be dragged away, and a
   double-click gives the default back. */
const SPLIT_KEY = 'homebrew-workbench:rail-split';
const SPLIT_MIN_CHIPS = 72;
const SPLIT_MIN_LIST = 140;
function applySplit(px) {
  const rail = $('.rail');
  if (px == null) { rail.style.removeProperty('--rail-split'); rail.classList.remove('split'); return; }
  rail.style.setProperty('--rail-split', `${px}px`); rail.classList.add('split');
}
try { const saved = Number(localStorage.getItem(SPLIT_KEY)); if (saved > 0) applySplit(saved); } catch { /* no storage: the default */ }
$('#railSplit').addEventListener('pointerdown', (ev) => {
  const rail = $('.rail'); const bar = ev.currentTarget;
  const top = $('#typegroups').getBoundingClientRect().top;
  const room = rail.getBoundingClientRect().bottom - top - bar.offsetHeight;
  bar.setPointerCapture(ev.pointerId); bar.classList.add('dragging');
  let px = null;
  const move = (e) => { px = Math.round(Math.max(SPLIT_MIN_CHIPS, Math.min(room - SPLIT_MIN_LIST, e.clientY - top))); applySplit(px); };
  const up = () => {
    bar.classList.remove('dragging'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up);
    if (px != null) { try { localStorage.setItem(SPLIT_KEY, String(px)); } catch { /* not fatal */ } }
  };
  bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
  ev.preventDefault();
});
$('#railSplit').addEventListener('dblclick', () => { applySplit(null); try { localStorage.removeItem(SPLIT_KEY); } catch { /* not fatal */ } });

/* ===================== Entry colours ===================== */
/* A right-click on a row colours the entry, the way a right-click colours a
   tab on the sheet: a strip of swatches and a way to take the colour off.
   The colour is the entry's own (`e.color`), so it travels in a project
   export and comes back on import; the row wears it on its edge and its
   name, and the preview's heading takes it. */
const ENTRY_COLORS = ['#c0392b', '#d35400', '#c98a12', '#7d8a1c', '#2e8b57', '#1f8a8a', '#2a6fb0', '#5b4fbf', '#8e44ad', '#b3366f', '#8b6b4a', '#6b7280'];
const colorBox = $('#colorMenu');
const COL = { id: null };
function openColor(id, x, y) {
  const e = entries().get(id); if (!e) return;
  COL.id = id;
  colorBox.innerHTML = `<div class="ac-none" style="padding:2px 6px 6px">${esc(e.name || 'Untitled')}</div>
    <div class="swatches"><button class="swatch none" data-color="" title="No colour" aria-label="No colour" aria-pressed="${!e.color}"></button>
    ${ENTRY_COLORS.map((c) => `<button class="swatch" data-color="${c}" style="background:${c}" title="${c}" aria-label="${c}" aria-pressed="${e.color === c}"></button>`).join('')}</div>`;
  colorBox.hidden = false;
  const w = colorBox.offsetWidth; const h = colorBox.offsetHeight;
  colorBox.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  colorBox.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
}
function closeColor() { colorBox.hidden = true; COL.id = null; }
$('#list').addEventListener('contextmenu', (ev) => {
  const row = ev.target.closest('.row[data-id]'); if (!row) return;
  ev.preventDefault(); openColor(row.dataset.id, ev.clientX, ev.clientY);
});
colorBox.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-color]'); if (!b) return;
  const e = entries().get(COL.id); if (!e) return closeColor();
  const hex = b.dataset.color;
  if (hex) e.color = hex; else delete e.color;
  e.updatedAt = now(); await writeEntry(e); closeColor(); renderRail(); renderPreview();
  return undefined;
});
document.addEventListener('pointerdown', (ev) => { if (!colorBox.hidden && !ev.target.closest('#colorMenu')) closeColor(); }, true);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !colorBox.hidden) closeColor(); });

/* ===================== Settings: categories ===================== */
/* A category of the player's own is a kind of entry beside the built-in
   ones: a name, a group to list it under, the label its text carries, the
   cells it has, and -- what makes it a subcategory -- a parent kind it sits
   under, the way a maneuver sits under a discipline. The dialog edits a draft
   and Save applies it (see applyCustomTypes); the set lives in the store's
   meta and rides in a project export, so another workbench reads the same
   kinds in with the entries. */
const CAT = { draft: [] };
const catDraftFrom = (list) => normalizeCustomTypes(list).map((c) => ({ ...c, fields: c.fields.map((fd) => fd.l).join(', ') }));
function renderSettings() {
  const groups = [...new Set([...GROUPS, ...CAT.draft.map((c) => c.group).filter(Boolean)])];
  const parents = Object.keys(TYPES).filter((t) => !TYPES[t].custom || CAT.draft.some((c) => c.id === t));
  const rows = CAT.draft.map((c, i) => `<div class="catrow">
      <div class="field"><label>Name</label><input data-ci="${i}" data-ck="label" value="${esc(c.label)}" placeholder="Ritual"></div>
      <div class="field"><label>Plural</label><input data-ci="${i}" data-ck="plural" value="${esc(c.plural)}" placeholder="Rituals"></div>
      <div class="field"><label>Group in the list</label><input data-ci="${i}" data-ck="group" list="groupList" value="${esc(c.group)}" placeholder="Magic &amp; gear"></div>
      <div class="field"><label>Under (makes it a subcategory)</label><select data-ci="${i}" data-ck="parent"><option value="">— top level —</option>${parents.filter((t) => t !== c.id).map((t) => `<option value="${t}" ${t === c.parent ? 'selected' : ''}>${esc(TYPES[t].label)}</option>`).join('')}</select></div>
      <div class="field"><label>What its text is called</label><input data-ci="${i}" data-ck="bodyLabel" value="${esc(c.bodyLabel)}" placeholder="Description"></div>
      <div class="field wide"><label>Cells, comma-separated</label><input data-ci="${i}" data-ck="fields" value="${esc(c.fields)}" placeholder="Casting time, Components, Cost"></div>
      <div class="field"><label>&nbsp;</label><button class="btn small danger" data-catdel="${i}">Remove</button></div>
    </div>`).join('');
  $('#catList').innerHTML = `${rows || '<div class="none">No categories of your own yet.</div>'}<datalist id="groupList">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`;
}
function openSettings() { CAT.draft = catDraftFrom(store.getMeta('customTypes')); renderSettings(); $('#settings').classList.add('open'); }
function closeSettings() { $('#settings').classList.remove('open'); }
$('#settingsBtn').addEventListener('click', openSettings);
$('#catCancel').addEventListener('click', closeSettings);
$('#catAdd').addEventListener('click', () => {
  CAT.draft.push({ id: '', label: '', plural: '', group: '', parent: '', bodyLabel: '', fields: '' });
  renderSettings(); $('#catList .catrow:last-of-type input')?.focus();
});
$('#catList').addEventListener('input', (ev) => { const el = ev.target; if (el.dataset.ci !== undefined) CAT.draft[+el.dataset.ci][el.dataset.ck] = el.value; });
$('#catList').addEventListener('change', (ev) => { const el = ev.target; if (el.dataset.ci !== undefined) CAT.draft[+el.dataset.ci][el.dataset.ck] = el.value; });
$('#catList').addEventListener('click', (ev) => { const b = ev.target.closest('[data-catdel]'); if (!b) return; CAT.draft.splice(+b.dataset.catdel, 1); renderSettings(); });
$('#catSave').addEventListener('click', async () => {
  const clean = normalizeCustomTypes(CAT.draft);
  try { await store.setMeta('customTypes', clean); } catch (err) { return toast(`Could not save: ${err.message}`, 'bad'); }
  applyCustomTypes(clean); closeSettings(); renderAll();
  return toast(clean.length ? `${clean.length} ${clean.length === 1 ? 'category' : 'categories'} saved` : 'No categories of your own');
});
$('#settings').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSettings(); });

/* ===================== Markdown shortcuts ===================== */
/* The keys an editor is expected to have, on every field that renders as
   text: Ctrl+B, I and U wrap the selection (or unwrap it, pressed again on a
   wrapped one; or drop the marks with the caret between them, with nothing
   selected), Ctrl+K makes a link, and Ctrl+Shift+8, 9 and 1-3 put a bullet,
   a note mark or a heading on every line the selection touches, off again on
   a second press. Shift on the line ones because Chrome keeps Ctrl+digit for
   its tabs and will not hand it over; `code` rather than `key` for those,
   since Shift turns 8 into * on most layouts. Everything goes through
   setRangeText, which keeps the undo stack, and an input event, which is
   what saves it. */
const WRAPS = { b: ['**', '**'], i: ['*', '*'], u: ['__', '__'], k: ['[[', ']]'] };
/* Ctrl+K on a selected web address makes a web link of it, with the caret in
   the label; on anything else it makes a wiki link, as before. */
function mdLink(el) {
  const s = el.selectionStart; const e = el.selectionEnd; const sel = el.value.slice(s, e);
  if (!/^https?:\/\/\S+$/.test(sel.trim())) return mdWrap(el, WRAPS.k);
  el.setRangeText(`[](${sel.trim()})`, s, e, 'preserve');
  el.setSelectionRange(s + 1, s + 1);
  return undefined;
}
const LINE_MARKS = { Digit8: '- ', Digit9: '> ', Digit1: '# ', Digit2: '## ', Digit3: '### ' };
function mdWrap(el, [open, close]) {
  const s = el.selectionStart; const e = el.selectionEnd; const v = el.value;
  const inner = v.slice(s, e);
  if (v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
    el.setRangeText(inner, s - open.length, e + close.length, 'select');
  } else if (inner.startsWith(open) && inner.endsWith(close) && inner.length >= open.length + close.length) {
    el.setRangeText(inner.slice(open.length, inner.length - close.length), s, e, 'select');
  } else {
    el.setRangeText(open + inner + close, s, e, 'preserve');
    el.setSelectionRange(s + open.length, e + open.length);
  }
}
function mdLines(el, mark) {
  const v = el.value; const s = el.selectionStart; const e = el.selectionEnd;
  const from = v.lastIndexOf('\n', s - 1) + 1;
  const toBreak = v.indexOf('\n', e); const to = toBreak < 0 ? v.length : toBreak;
  const lines = v.slice(from, to).split('\n');
  const isHeading = /^#{1,3} $/.test(mark);
  const strip = (l) => (isHeading ? l.replace(/^#{1,3} /, '') : l.startsWith(mark) ? l.slice(mark.length) : l);
  const on = lines.every((l) => (isHeading ? /^#{1,3} /.test(l) && l.startsWith(mark) : l.startsWith(mark)));
  const out = lines.map((l) => (on ? strip(l) : mark + strip(l))).join('\n');
  el.setRangeText(out, from, to, 'select');
}
$('#edit').addEventListener('keydown', (ev) => {
  if (!ev.ctrlKey && !ev.metaKey) return;
  if (ev.altKey) return;
  const el = ev.target;
  if (!el.matches('textarea, input[type="text"]') || ['__name', '__tags'].includes(el.dataset.k)) return;
  if (ev.shiftKey && LINE_MARKS[ev.code] && el.tagName === 'TEXTAREA') { ev.preventDefault(); mdLines(el, LINE_MARKS[ev.code]); }
  else if (!ev.shiftKey && ev.key.toLowerCase() === 'k') { ev.preventDefault(); mdLink(el); }
  else if (!ev.shiftKey && WRAPS[ev.key.toLowerCase()]) { ev.preventDefault(); mdWrap(el, WRAPS[ev.key.toLowerCase()]); }
  else return;
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

/* ===================== Boot ===================== */
mountThemes($('#themePick'));
(async () => {
  try { await store.open(); } catch (err) { setStatus('local', err.message); }
  applyCustomTypes(store.getMeta('customTypes'));
  reindex(); if (!S.selected && entries().size) S.selected = firstId();
  statusIdle(); renderAll();
})();
