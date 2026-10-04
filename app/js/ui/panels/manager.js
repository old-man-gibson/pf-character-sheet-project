/**
 * ui/panels/manager.js -- the ⚙ tab manager.
 *
 * The tab bar as a list to rearrange, everything that is off it, the
 * worksheets kept from the workbook, and the shelf of building blocks the
 * enabled extension packs offer. What it needs of the element's own state --
 * the tab lists, a typed draft, the delete waiting for confirmation, the
 * shelf's search and filter -- comes in on `ctx`.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import * as rows from '../rows.js';
import { runtime as extensionRuntime } from '../../extension-runtime.js';
import { BLOCK_KINDS, archetypeStatus, swapLabel } from '../../extensions.js';

/**
 * More blocks than this in one supergroup and it arrives folded.
 *
 * Measured rather than chosen per pack, the way `HELP_LENGTH` is: a chakra
 * carrying sixty veils is an index you open one line of, and a class with two
 * option menus and an archetype under it is worth reading whole. Folding that
 * second one by default would put a pack's content behind a click for nothing.
 */
const EXT_GROUP_FOLD = 12;

/**
 * The ⚙ manager: the tab bar as a list to rearrange, then everything that
 * is off it -- alphabetical, so a tab is found by name rather than by where
 * the workbook happened to put it -- with the odd sub-systems in a corner
 * of their own. Worksheets can be renamed, deleted or added here too.
 */
export function renderSystemManagerPanel(model, ctx) {
    const entries = ctx.tabEntries;
    const bar = ctx.barEntries;
    const onBar = new Set(bar.map((e) => e.key));
    const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    const off = entries.filter((e) => !onBar.has(e.key)).sort(byLabel);
    const hidden = off.filter((e) => !e.weird);
    const weird = off.filter((e) => e.weird);

    const badges = (e) => `${e.renamed ? `<span class="badge player" title="${esc(e.title || '')}">${
      this.isAdmin ? `player: “${esc(e.renamed)}”` : `originally ${esc(e.base)}`}</span>` : ''}
      ${e.kind === 'system' && e.tab.hidden ? '<span class="badge">hidden in source</span>' : ''}
      ${e.kind === 'system' && e.tab.custom ? '<span class="badge player">custom</span>' : ''}
      ${e.kind === 'system' ? `<span class="badge">${e.tab.rows.length} rows</span>` : ''}
      ${e.kind === 'modelled' ? (e.has ? '<span class="badge ok">in use</span>'
    : e.tagged ? '<span class="badge ok" title="A class on the Overview marks this system">marked</span>'
      : '<span class="badge">empty</span>') : ''}`;
    const name = (e) => (e.kind === 'system'
      ? `<input type="text" class="tabname" value="${esc(e.label)}" data-systab-name="${e.index}" aria-label="Tab name">`
      : esc(e.label));
    const del = (e) => (e.kind === 'system'
      ? rows.armedButton(`systab|${e.index}`, `data-action="delete-system" data-index="${e.index}" data-arm="systab|${e.index}"`,
        `“${e.label}” and all its rows`, ctx.armedRemove) : '');

    // The same panel the tabs' own right-click opens, reached from a row.
    const colorBtn = (e) => {
      const hex = model.tabColor(e.key);
      return `<button class="swatch tabswatch${hex ? '' : ' none'}" data-tabcolor-open="${esc(e.key)}"
        data-tabcolor-label="${esc(e.label)}"${hex ? ` style="background:${hex}"` : ''}
        title="${esc(hex ? `Colour: ${hex}` : 'Colour this tab')}" aria-label="Colour ${esc(e.label)}"></button>`;
    };
    const barRow = (e, i) => `<div class="item statline tabrow" data-tabkey="${esc(e.key)}">
      <span class="label pair" style="flex:1">
        <span class="grip" data-tabdrag title="Drag to reorder" aria-hidden="true">⋮⋮</span>
        ${name(e)} ${badges(e)}
      </span>
      <span class="value pair">
        ${colorBtn(e)}
        <button data-action="tab-move" data-key="${esc(e.key)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(e.label)} left" title="Move left">↑</button>
        <button data-action="tab-move" data-key="${esc(e.key)}" data-dir="1" ${i === bar.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(e.label)} right" title="Move right">↓</button>
        <button data-action="tab-hide" data-key="${esc(e.key)}" ${bar.length === 1 ? 'disabled' : ''}>Hide</button>
        ${del(e)}
      </span>
    </div>`;
    const offRow = (e) => `<div class="item statline">
      <span class="label pair" style="flex:1">${name(e)} ${badges(e)}</span>
      <span class="value pair">
        <button data-action="tab-show" data-key="${esc(e.key)}">Show</button>
        ${del(e)}
      </span>
    </div>`;

    const mode = model.viewMode();
    return `<div class="grid"><section class="panel span2">
      <h3>Tab bar — ${mode === 'session' ? 'session view' : 'build view'}
        <button data-action="view-mode" style="margin-left:auto" title="${mode === 'session'
    ? 'Switch to the build view and edit its bar' : 'Switch to the session view and edit its bar'}">
          Switch to ${mode === 'session' ? 'build' : 'session'} view</button>
      </h3>
      <p class="hint">
        The tabs across the top, in order. Drag a row -- or a tab on the bar itself --
        to rearrange; <strong>Hide</strong> moves a tab down into the lists below with
        its data intact, and it stays hidden. The swatch on each row colours and renames
        that tab (right-clicking the tab itself opens the same panel); the colour and the
        name are the tab's own and show on both bars. Each view keeps its own bar: the
        <em>build</em> view
        starts from Overview, Stats, Lore, Skills, Progression, Feats &amp; Mythic,
        Alternate Training, Trackers and Equipment, <em>plus every sub-system this character
        uses</em>; the <em>session</em> view starts from what comes up at the table --
        those sub-systems again, minus the build machinery.
        <button data-action="tab-reset">Reset this view's bar</button>
      </p>
      <div class="rowlist tabbar-list">
        ${bar.map(barRow).join('') || '<p class="empty">Nothing on the bar — show a tab below.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Hidden tabs</h3>
      <p class="hint">
        Everything else the sheet can show, alphabetically: the rest of the built-in
        tabs, the modelled sub-systems (Martial and Magic Spheres, Crafting, Akashic, Maneuvers,
        Vancian, Psionics, the companions…), and the workbook's own worksheets.
        <em>In use</em> marks a sub-system that already holds this character's data;
        <em>marked</em> means a class on the Overview names the system but its tab is
        still empty.
      </p>
      <div class="rowlist">
        ${hidden.map(offRow).join('') || '<p class="empty">Every tab is on the bar.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Extra — weird systems</h3>
      <p class="hint">
        The unusual machinery: casting off a deck, and a workbook's technique list
        and its auto-technique sheet. Off the bar unless the character uses them.
      </p>
      <div class="rowlist">
        ${weird.map(offRow).join('') || '<p class="empty">All of these are on the bar.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Worksheets</h3>
      <p class="hint">
        Add a free grid tab of your own (Vancian spellbook, mount, a homebrew system…).
        Rename any worksheet by typing over its name above; × deletes one and its data.
      </p>
      <div class="pair">
        <input type="text" data-draft="newSystem" placeholder="New tab name" value="${esc(ctx.draft.newSystem || '')}" style="max-width:16rem">
        <button class="primary" data-action="add-system">+ Add system tab</button>
      </div>
    </section>
    ${extensionBlocksPanel(model, ctx)}</div>`;
}

/**
 * The building blocks the enabled extension packs offer -- a class, a race,
 * a feature, a tracker -- each with a button that copies it into this
 * character. The packs themselves are managed by the host page; this is
 * only the shelf.
 */
function extensionBlocksPanel(model, ctx) {
    const packs = extensionRuntime.active();
    const blocks = extensionRuntime.blocks();
    const kinds = [...new Set(blocks.map((b) => b.kind))];
    const filter = kinds.includes(ctx.extFilter) ? ctx.extFilter : '';
    const byKind = filter ? blocks.filter((b) => b.kind === filter) : blocks;
    // A pack of thirty archetypes is a list to search, not one to scroll. The
    // words are looked for in the block's name, its pack and what it is for,
    // so "warrior" finds an archetype that replaces warrior's grace.
    const words = ctx.extSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = (b) => [b.name, b.kind, BLOCK_KINDS[b.kind]?.label, b.extName, b.class, b.group, b.feature,
      ...(b.features || []).flatMap((f) => [f.name, ...(f.replaces || []), ...(f.alters || [])]),
      ...(b.options || []).map((o) => o.name)].filter(Boolean).join(' ').toLowerCase();
    const shown = words.length ? byKind.filter((b) => { const h = haystack(b); return words.every((w) => h.includes(w)); }) : byKind;
    const byPack = new Map();
    for (const b of shown) {
      if (!byPack.has(b.extId)) byPack.set(b.extId, { name: b.extName, blocks: [] });
      byPack.get(b.extId).blocks.push(b);
    }
    // Searching looks through what a block is for as well as what it is called,
    // so "warrior" finds an archetype that replaces warrior's grace. A block
    // the words name outright comes first all the same.
    if (words.length) {
      const named = (b) => words.every((w) => String(b.name || '').toLowerCase().includes(w));
      for (const p of byPack.values()) p.blocks.sort((a, b) => Number(named(b)) - Number(named(a)));
    }
    const detail = (b) => {
      switch (b.kind) {
        case 'class': return `d${b.hd}, BAB ${b.bab === 1 ? 'full' : b.bab === 0.5 ? '½' : '¾'}, ${['goodFort', 'goodRef', 'goodWill'].filter((k) => b[k]).map((k) => k.slice(4)).join('/') || 'no good'} saves, ${b.skillRanks} ranks${b.features.length ? `, ${b.features.length} features` : ''}`;
        case 'race': return [b.size, Object.entries(b.abilityMods).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(' '), b.traits.length ? `${b.traits.length} traits` : ''].filter(Boolean).join(' · ');
        case 'template': return `${b.features.length} feature(s)`;
        case 'tracker': return `max ${b.maxFormula || '—'}${b.refresh ? ` · ${b.refresh}` : ''}`;
        case 'feature': return `${b.type ? `(${b.type}) ` : ''}${b.group ? `→ ${b.group}` : ''}`;
        case 'veil': return `${b.slot || 'no slot'} slot${b.descriptor ? ` · ${b.descriptor}` : ''}`;
        case 'trait': return b.replaces.length ? `replaces ${b.replaces.join(', ')}` : '';
        case 'archetype': {
          // "warriors grace@10" is how a swap of one grant is filed; here it reads.
          const rep = [...new Set(b.features.flatMap((f) => f.replaces))].map(swapLabel);
          const alt = [...new Set(b.features.flatMap((f) => f.alters))].map(swapLabel);
          return [`for ${b.class || 'its class'}`, rep.length ? `replaces ${rep.join(', ')}` : '', alt.length ? `alters ${alt.join(', ')}` : '',
            b.stacksWith.length ? `combines with ${b.stacksWith.join(', ')}` : ''].filter(Boolean).join(' · ');
        }
        default: return '';
      }
    };
    // An archetype's button says whether it can go on right now, and why not.
    const gate = (b) => {
      if (b.kind !== 'archetype') return { on: true, why: '' };
      const s = archetypeStatus(model, b);
      if (s.ok) return { on: true, why: '' };
      if (s.reason === 'applied') return { on: false, why: 'on the sheet' };
      if (s.reason === 'no-class') return { on: false, why: `needs ${s.className} on the Classes table` };
      return { on: false, why: `blocked: ${s.with} also changes ${s.shared.join(', ')}` };
    };
    const blockRow = (id, b) => { const g = gate(b); return `<div class="item statline">
        <span class="label pair" style="flex:1">
          <span class="badge">${esc(BLOCK_KINDS[b.kind]?.label || b.kind)}</span>
          <strong>${esc(b.name || '(unnamed)')}</strong>
          <span class="hint" style="margin:0">${esc(detail(b))}</span>
        </span>
        <span class="value pair">
          ${g.why ? `<span class="hint ${/^blocked/.test(g.why) ? 'warn' : ''}" style="margin:0">${esc(g.why)}</span>` : ''}
          <button class="primary" data-action="ext-add-block" data-ext="${esc(id)}" data-index="${b.index}" ${g.on ? '' : 'disabled'}
            title="${esc(BLOCK_KINDS[b.kind]?.lands || '')}">+ Add</button>
        </span>
      </div>`; };

    /*
     * Which supergroup a block sits in, inside its pack.
     *
     * What the pack says first, so a block can always be filed by hand; then
     * the class it is for, which is how an archetype and an option menu name
     * theirs; then, for a class, its own name -- so the class heads the group
     * its archetypes and menus have already joined, and folding it takes the
     * lot. A veil groups by the chakra it is worn on, an alternate trait by
     * the race it is an alternative for.
     *
     * A block with none of those is loose in its pack rather than filed under
     * a guess. Notes are the ones that land there: a note carries no link to
     * what it is about, so a pack that wants "Favored class options" to fold
     * with its class says `"group": "<class name>"` on it.
     */
    const groupOf = (b) => b.group
      || b.class
      || (b.kind === 'class' ? b.name : '')
      || (b.kind === 'veil' ? b.slot : '')
      || (b.kind === 'trait' ? b.race : '')
      || '';
    // Searching folds nothing: a hit inside a shut group is a hit you cannot
    // see, which reads as the search having missed it.
    const seeking = words.length > 0;
    const packList = [...byPack.entries()].map(([id, p]) => {
      const groups = new Map();
      for (const b of p.blocks) {
        const key = groupOf(b);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }
      const loose = groups.get('') || [];
      groups.delete('');
      /*
       * A note, filed by what it is called.
       *
       * Every other kind says where it belongs -- an option menu and an
       * archetype name their class, a veil its chakra -- and a note says
       * nothing at all: `kind, name, text, source` is the whole of it. So a
       * note whose name contains one of its own pack's group names is taken to
       * be about it, which is what "Favored class options — Legendary Samurai"
       * plainly is. Notes only: the other kinds have a field to be believed
       * instead of a string to be guessed at, and `group` overrides this for a
       * pack that would rather say so outright.
       *
       * Longest name first, so a pack holding both Samurai and Legendary
       * Samurai files the note under the one it actually named.
       */
      const groupNames = [...groups.keys()].sort((a, b) => b.length - a.length);
      for (const note of [...loose]) {
        if (note.kind !== 'note') continue;
        const hay = String(note.name || '').toLowerCase();
        const owner = groupNames.find((n) => n && hay.includes(n.toLowerCase()));
        if (!owner) continue;
        groups.get(owner).push(note);
        loose.splice(loose.indexOf(note), 1);
      }
      const packKey = `extpack:${id}`;
      const packShut = !seeking && rows.isCollapsed(model, packKey);
      const groupHtml = [...groups.entries()].map(([name, list]) => {
        const key = `extgrp:${id}:${name}`;
        // Big groups arrive folded, small ones open. A chakra of sixty veils
        // is an index to open one line of; a class with three menus under it
        // is worth reading whole, and folding it by default would hide the
        // pack's content behind a click for nothing.
        const shut = !seeking && rows.isCollapsed(model, key, list.length > EXT_GROUP_FOLD);
        return `<div class="foldsub extgroup${shut ? ' collapsed' : ''}">
          <h4 class="subhead">${esc(name)}
            <span class="badge">${list.length}</span>
            ${rows.foldButton(model, key, shut)}</h4>
          ${shut ? '' : list.map((b) => blockRow(id, b)).join('')}
        </div>`;
      }).join('');
      return `<div class="foldsub extpack${packShut ? ' collapsed' : ''}">
        <h4 class="subhead ext-pack">${esc(p.name)}
          <span class="badge">${p.blocks.length}</span>
          ${rows.foldButton(model, packKey, packShut)}</h4>
        ${packShut ? '' : `${loose.map((b) => blockRow(id, b)).join('')}${groupHtml}`}
      </div>`;
    }).join('');

    return `<section class="panel span2">
      <h3>Extensions — building blocks</h3>
      <p class="hint">
        What the enabled extension packs offer this character: ${packs.length
    ? `${packs.length} pack${packs.length === 1 ? '' : 's'} on, ${blocks.length} block${blocks.length === 1 ? '' : 's'}.`
    : 'no packs are enabled.'} <strong>+ Add</strong> copies a block onto the sheet — a class into
        the Classes table, a race into the Overview, a feature onto the Template tab, a tracker
        onto Trackers — where it is then yours to edit like anything typed in. Packs are managed
        from the page's <em>Extensions</em> button.
      </p>
      ${blocks.length ? `<p class="pair extfind" style="margin:0 0 6px">
        ${kinds.length > 1 ? `<button data-action="ext-filter" data-kind="" aria-pressed="${!filter}">All</button>
        ${kinds.map((k) => `<button data-action="ext-filter" data-kind="${k}" aria-pressed="${filter === k}">${esc(BLOCK_KINDS[k]?.label || k)}</button>`).join('')}` : ''}
        <input type="search" data-ext-search="1" value="${esc(ctx.extSearch)}" spellcheck="false"
          placeholder="Search ${byKind.length} block${byKind.length === 1 ? '' : 's'}…"
          title="By name, pack, class, or what a block's features are called and replace">
        ${words.length ? `<span class="hint" style="margin:0">${shown.length} of ${byKind.length}</span>` : ''}
      </p>` : ''}
      <div class="rowlist">
        ${packList || `<p class="empty">${words.length ? `Nothing matches “${esc(ctx.extSearch)}”.`
    : packs.length ? 'The enabled packs carry tables only — no blocks.' : 'Nothing to offer yet.'}</p>`}
      </div>
    </section>`;
}
