/**
 * ui/panels/lore.js -- the Progression tab, the Lore tab, and the leftovers.
 *
 * Progression is the class table: what each level of each class gave, with the
 * repeat features in a column each and the option menus a pack supplies. Lore
 * is the background sections and the notes. The leftovers are the tabs a
 * particular workbook had that the app has no model for -- kept as a grid so
 * nothing is lost in the import even where nothing can be computed from it.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import { collapsible } from '../rows.js';
import { prose } from '../prose.js';
import { systemExtrasPanel } from './subsystems.js';
import { itemArea } from '../prose.js';
import { addButton, itemText, rowTools } from '../rows.js';
import { same } from '../format.js';
import { optionCatalogues } from '../../model.js';
import { parseLevelRule, levelRuleLevels, summariseLevels } from '../../rules.js';
import { hasTokens } from '../../inline.js';
import { rgba } from '../../tracker-style.js';


export function renderProgressionPanel(model, ctx) {
    const c = model.data;
    const p = c.progression;
    if (!p) return '<div class="grid"><section class="panel"><h3>Progression</h3><p class="empty">No progression data.</p></section></div>';
    const classNames = c.classes.map((x) => x.name).filter(Boolean);
    const level = Number(c.identity.level) || 0;
    const tracks = Array.from({ length: p.tracks }, (_, i) => i);

    const classCell = (row, t) => {
      const value = row.classes?.[t] ?? '';
      const pairs = classNames.map((n) => [n, n]);
      if (value && !classNames.includes(value)) pairs.push([value, `${value} *`]);
      return `<select data-prog="${row.level}|${t}">
        <option value="">—</option>
        ${pairs.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`;
    };

    return `<div class="grid">
      ${collapsible(model, 'prog-levels', `<section class="panel span2">
        <h3>Level progression
          <button data-action="add-track" title="Tristalt and beyond">+ Class track</button>
        </h3>
        <div class="tablewrap"><table class="gridtab prog">
          <thead><tr>
            <th class="num">Lvl</th>
            ${tracks.map((t) => `<th><span class="pair">Track ${t + 1}
              ${p.tracks > 1 ? `<button class="danger" data-action="remove-track" data-track="${t}"
                title="Delete this track">×</button>` : ''}</span>
              <select class="fillcol" data-filltrack="${t}"
                title="Put one class on every level of this track"
                aria-label="Fill track ${t + 1} with one class">
                <option value="" selected disabled hidden>Fill column…</option>
                ${classNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
              </select></th>`).join('')}
            <th class="num" title="Best hit die among the classes that level">HP</th>
            <th class="num" title="Best skill ranks">Ranks</th>
            <th class="num">Fort</th><th class="num">Ref</th><th class="num">Will</th>
          </tr></thead>
          <tbody>${p.levels.map((row) => `<tr class="${row.level > level ? 'future' : ''}">
            <td class="num">${row.level}</td>
            ${tracks.map((t) => `<td>${classCell(row, t)}</td>`).join('')}
            <td class="num derived">${row.computed?.hp ? `d${row.computed.hp}` : ''}</td>
            <td class="num derived">${row.computed?.ranks || ''}</td>
            <td class="num derived">${row.computed?.fort || ''}</td>
            <td class="num derived">${row.computed?.ref || ''}</td>
            <td class="num derived">${row.computed?.will || ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">
          Class tracks pick from the classes on the Overview; HP, ranks and saves per level
          are read-only, computed gestalt-style from the classes chosen on that row
          (good saves ½, poor ⅓). Rows past level ${level} are plans. Class features live
          in the groups below; ability-boosting choices on the <strong>Stats</strong> tab.
        </p>
        <p class="hint">
          <strong>Rule groups.</strong> Under each feature column's name, <em>+ level rule</em>
          adds a named, coloured schedule saying which levels it grants on — write
          <code>odd</code>, <code>even</code>, <code>2, +4</code> (2 and every 4 thereafter),
          <code>1, 2, +2</code> (1st and every even level), <code>5-10</code>, or a list.
          Terms add up left to right, so <code>2, +4, 3</code> is that schedule plus a
          one-off at 3, and <code>odd, -13</code> takes one away. A column with no rule
          grants at every level, as before.
        </p>
        <p class="hint">
          <strong>Several rules can share one column</strong> — give a kineticist's Wild Talent
          column <code>{Infusions, odd}</code> and <code>{Utility, even}</code> and each level
          is tinted and tagged by whichever grants it. Typing the whole braced form into either
          box fills both. Levels count the <em>class's</em> own levels; start a rule with
          <code>char:</code> to count character levels instead. Anything that isn't a level
          list is treated as a formula over <code>classLevel</code> / <code>charLevel</code>,
          e.g. <code>classLevel % 3 == 1</code>. A level you have reached that grants something
          you haven't filled in is outlined and counted on the group header; one you haven't
          reached yet is only faintly marked.
        </p>
      </section>`)}
    </div>
    <div class="featgroups">
      ${classFeatureGroups(model, ctx, model, ctx)}
    </div>`;
  }

  /**
   * One collapsible group per class named in the progression, holding that
   * class's per-level feature columns.
   */
function classFeatureGroups(model, ctx) {
    const p = model.data.progression;
    // The menus this grid's cells pick from, gathered as the cells render so
    // one list is written per menu however many cells offer it.
    ctx.menuLists = new Map();
    const names = model.progressionClasses();
    // Feature groups whose class is no longer in any track keep their data
    // and stay visible so nothing silently disappears.
    for (const key of Object.keys(p.classFeatures || {})) {
      const g = p.classFeatures[key];
      if (!names.includes(key) && key !== 'General'
        && (g.columns.length || Object.keys(g.byLevel).length)) names.push(key);
    }
    if (p.classFeatures?.General?.columns?.length) names.push('General');

    // Narrow groups first: flex wrapping packs in order, so putting the small
    // tables ahead lets two or three of them share a row before a wide one
    // claims its own.
    const widthOf = (name) => {
      const g = p.classFeatures?.[name] || { columns: [] };
      const saved = model.data.uiPrefs?.colWidths?.[`progfeat-${name}`] || {};
      return 46 + g.columns.reduce((t, col) => t + Math.max(90, Number(saved[col]) || 260), 0);
    };
    names.sort((a, b) => widthOf(a) - widthOf(b));

    return names.map((name) => {
      const g = p.classFeatures?.[name] || { columns: [], byLevel: {}, rules: {} };
      const orphaned = name !== 'General' && !model.classLevelsIn(name).length;
      // Rows carry both levels: the character level they sit at and the
      // class's own level count, which is what a rule counts by default.
      const rows = model.classFeatureRows(name);

      // Column widths are draggable; saved per character in uiPrefs.
      const tableKey = `progfeat-${name}`;
      const saved = model.data.uiPrefs?.colWidths?.[tableKey] || {};
      const colW = (col) => Math.max(90, Number(saved[col]) || 260);
      const total = 46 + g.columns.reduce((t, col) => t + colW(col), 0);
      const charLevel = Number(model.data.identity.level) || 0;
      const due = Object.values(model.classFeatureDue(name)).reduce((t, n) => t + n, 0);

      // Cells waiting on a class level the character has not got back yet.
      const parked = Object.keys(model.classFeatureParked(name)).map(Number).sort((a, b) => a - b);
      const arming = ctx.confirmGroup === name;
      return collapsible(model, `progfeat-${name}`, `<section class="panel featpanel">
        <h3>${esc(name)} features
          <span class="badge">${orphaned ? 'not in progression' : `levels ${rows.length ? `${rows[0].level}–${rows[rows.length - 1].level}` : '—'}`}</span>
          ${due ? `<span class="badge due" title="Levels you have reached that grant something you have not filled in">${due} to pick</span>` : ''}
          ${parked.length ? `<span class="badge" title="Written for ${esc(name)} level${parked.length === 1 ? '' : 's'} ${parked.join(', ')}, which this character no longer has. Kept, and back the moment the class is that long again.">${parked.length} parked</span>` : ''}
          ${orphaned ? groupDelete(name, g, arming) : ''}
        </h3>
        <div class="tablewrap"><table class="gridtab featgrid" style="width:${total}px">
          <colgroup>
            <col style="width:46px">
            ${g.columns.map((col) => `<col style="width:${colW(col)}px">`).join('')}
          </colgroup>
          <thead><tr><th class="num">Lvl</th>
            ${g.columns.map((col, i) => featureColumnHead(model, name, col, i, tableKey)).join('')}
          </tr></thead>
          <tbody>${rows.map((row) => `<tr class="${row.level > charLevel ? 'future' : ''}">
            <td class="num"${name === 'General' ? ''
    : ` title="Character level ${row.level} — ${esc(name)} level ${row.classLevel}"`}>${row.level}</td>
            ${g.columns.map((col) => featureCell(ctx, model, name, col, row,
    (g.rules?.[col] || []).length > 1)).join('')}
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:6px">
          <button class="primary" data-action="add-cf-column" data-class="${esc(name)}">+ Add column</button>
        </div>
        ${classFeatureNotes(model, name)}
      </section>`);
    }).join('') + menuListMarkup(ctx, ctx);
  }

  /**
   * Deleting a group the progression no longer names, in two clicks.
   *
   * Both states live in the heading, because a group is usually met folded --
   * a ghost class is exactly the one nobody has open -- and a confirmation in
   * the body would be a click on a × that visibly did nothing. The second
   * click says what is going: a group is a column of the player's own writing
   * per level, and History is the only way back.
   */
function groupDelete(name, g, arming) {
    if (!arming) {
      return `<button class="danger" data-action="remove-cf-group" data-class="${esc(name)}"
        style="margin-left:auto" title="Delete this group and everything in it">×</button>`;
    }
    const cols = g.columns.length;
    // A ghost with no columns left is the one that has been stuck the longest,
    // so it gets a sentence of its own rather than "delete 0 columns".
    const what = cols ? `${cols} column${cols === 1 ? '' : 's'} and everything in ${cols === 1 ? 'it' : 'them'}` : 'this empty group';
    return `<span class="pair" style="margin-left:auto">
      <span class="hint warn">Delete ${what}?</span>
      <button class="danger" data-action="remove-cf-group-confirm" data-class="${esc(name)}">Delete</button>
      <button data-action="remove-cf-group-cancel">Keep</button>
    </span>`;
  }

  /**
   * What a class's features do, under the ladder that says when each arrives.
   *
   * One entry per distinct feature however many levels grant it, an archetype's
   * among them. This is where a pack's rules text lands: the Template tab is
   * for templates, and a class is not one.
   */
function classFeatureNotes(model, className) {
    const notes = model.classFeatureNotes(className);
    const open = !model.data.uiPrefs.collapsed?.[`cfnotes-${className}`];
    return `<div class="cfnotes">
      <button class="notehead" data-collapse="cfnotes-${esc(className)}"
        data-collapse-to="${open}" aria-expanded="${open}">
        ${open ? '▾' : '▸'} What they do <span class="badge">${notes.length}</span>
      </button>
      ${open ? `${notes.map((f, i) => `<div class="cfnote">
        <span class="pair">
          <input type="text" class="notename" value="${esc(f.name)}" spellcheck="false"
            data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'name' }))}">
          <select data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'type' }))}">
            ${['', 'Ex', 'Su', 'Sp'].map((t) => `<option value="${t}"${(f.type || '') === t ? ' selected' : ''}>${t || '—'}</option>`).join('')}
          </select>
          <button class="danger" data-action="remove-cfnote" data-class="${esc(className)}" data-index="${i}"
            title="Remove ${esc(f.name)}">×</button>
        </span>
        ${prose(model, `data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'text' }))}"`, f.text, 3, 'grow')}
      </div>`).join('') || '<p class="empty">Nothing yet — a class added from a pack brings its features\' text here.</p>'}
      <div style="margin-top:6px">
        <button data-action="add-cfnote" data-class="${esc(className)}">+ Add feature text</button>
      </div>` : ''}
    </div>`;
  }

  /**
   * The id of the list a menu's cells offer, made on first use.
   *
   * A menu belongs to the pack that provides it, not to the character, so the
   * grid never holds a copy: it writes the list once and every cell picking
   * from that menu points at it.
   */
function menuListId(ctx, menu, atLevel) {
    // A cell offers what it could actually take: an entry asking for a level
    // above this one is not on this cell's list. Levels that can take the same
    // entries share a list, so a twenty-level column writes two or three.
    const options = menu.options.filter((o) => !o.minLevel || o.minLevel <= atLevel);
    const key = `${menu.name}|${options.length}`;
    if (!ctx.menuLists.has(key)) {
      ctx.menuLists.set(key, { id: `cfmenu-${ctx.menuLists.size}`, menu: { ...menu, options } });
    }
    return ctx.menuLists.get(key).id;
  }

  /** Those lists, written once each after the tables that offer them. */
function menuListMarkup(ctx) {
    return [...ctx.menuLists.values()].map(({ id, menu }) => `<datalist id="${id}">${
      menu.options.map((o) => {
        // What the browser shows beside the name: where it sits in the menu
        // and the level it asks for, which is what a player is choosing on.
        const hint = [o.category, o.minLevel ? `${o.minLevel}th+` : '', o.source].filter(Boolean).join(' · ');
        return `<option value="${esc(o.name)}">${esc(hint)}</option>`;
      }).join('')
    }</datalist>`).join('');
  }

  /**
   * A feature column's header: its name, its level rule, and the drag handle.
   *
   * The rule box is deliberately plain text rather than a builder -- what a
   * player types ("2, +4") is what gets stored, so the schedule stays legible
   * and extensible after the fact.
   */
function featureColumnHead(model, className, col, index, tableKey) {
    const groups = model.classFeatureRuleGroups(className, col);
    const due = model.classFeatureDue(className)[col] || 0;

    const groupRow = (grp, gi) => {
      const rule = parseLevelRule(grp.rule || '');
      const basis = rule.basis === 'char' ? 'character' : 'class';
      const title = rule.kind === 'error' ? `Rule not understood — ${rule.error}. Granting every level.`
        : rule.kind === 'formula' ? `Formula over ${basis} level: ${rule.expr}`
          : `Grants at ${basis} levels ${summariseLevels(levelRuleLevels(rule))}`;
      return `<span class="rulegroup" style="--gc:${esc(grp.color)}">
        <input type="color" value="${esc(grp.color)}" data-cfgcolor="${esc(className)}|${index}|${gi}"
          aria-label="Colour for ${esc(grp.name || col)}" title="Group colour">
        <input type="text" class="gname" value="${esc(grp.name)}" placeholder="name"
          data-cfgname="${esc(className)}|${index}|${gi}" spellcheck="false">
        <input type="text" class="grule ${rule.kind === 'error' ? 'bad' : ''}" value="${esc(grp.rule)}"
          placeholder="levels" data-cfgrule="${esc(className)}|${index}|${gi}"
          title="${esc(title)}" spellcheck="false">
        <button class="danger" data-action="remove-rule-group" data-class="${esc(className)}"
          data-col="${index}" data-group="${gi}" title="Remove this rule group">×</button>
      </span>`;
    };

    return `<th class="resizable">
      <span class="pair">
        <input type="text" class="colname" value="${esc(col)}" data-cfcol="${esc(className)}|${index}">
        ${due ? `<span class="badge due" title="${due} level${due === 1 ? '' : 's'} reached with nothing filled in">${due}</span>` : ''}
        <button class="danger" data-action="remove-cf-column" data-class="${esc(className)}" data-col="${index}" title="Remove column">×</button>
      </span>
      ${groups.map(groupRow).join('')}
      ${featureColumnMenu(model, className, col, index)}
      <button class="addgroup" data-action="add-rule-group" data-class="${esc(className)}" data-col="${index}"
        title="${groups.length ? 'Another schedule sharing this column'
    : 'Limit this column to certain levels — try "odd", "even", "2, +4"'}">${groups.length ? '+ rule group' : '+ level rule'}</button>
      <div class="col-resizer" data-resize-table="${esc(tableKey)}" data-resize-col="${esc(col)}"
        title="Drag to resize"></div>
    </th>`;
  }

  /**
   * One feature cell. A column with no rule looks exactly as it always has;
   * a ruled column tints the levels it grants and locks the rest, the same
   * green/grey the sphere-talent grid uses.
   *
   * Text already sitting on a level a later rule excludes is kept and flagged
   * rather than hidden, so tightening a rule never quietly eats an entry.
   */
function featureCell(ctx, model, className, col, row, multi) {
    const cell = row.cells[col];
    // Two rule groups granting at the same level are two things to write down,
    // so each gets its own field, stacked, in its own colour.
    return `<td class="featcell${cell.fields.length > 1 ? ' stacked' : ''}">
      ${cell.fields.map((f) => featureField(ctx, model, className, col, row, f, multi)).join('')}
    </td>`;
  }

  /** One writable field inside a feature cell: its tag, its box, its state. */
function featureField(ctx, model, className, col, row, field, multi) {
    const cell = row.cells[col];
    const colour = field.group?.color || null;
    const label = field.group?.name || col;

    const state = !cell.ruled ? ''
      : !field.on ? `slot-off${field.stranded ? ' kept' : ''}`
        : `slot-on${field.due ? ' due' : ''}${field.planned ? ' planned' : ''}`;
    const title = !cell.ruled ? ''
      : field.group?.orphan ? `“${field.group.name}” is no longer a rule group on this column — text kept, but not editable here.`
        : !field.on ? (field.stranded ? 'Outside every rule on this column — text kept, but not editable here.'
          : `No ${col} at this level.`)
          : `${label}${field.due ? ' — nothing chosen yet' : field.planned ? ' — not reached yet' : ''}`;

    // With one rule group the column heading already names it; a tag earns its
    // space once two schedules share a column, or two fields share a level.
    const tagged = (multi || cell.fields.length > 1) && field.group;
    const tag = tagged
      ? `<span class="ftag${field.group.orphan ? ' orphan' : ''}">${esc(label)}</span>` : '';
    const placeholder = field.due || field.planned ? ` placeholder="${esc(label)}…"` : '';
    // JSON rather than a delimiter: class, column and group names are free
    // text and any of them may contain the separator.
    const ref = esc(JSON.stringify({
      c: className, l: row.level, k: col, g: field.key,
    }));

    // Where a menu is attached the cell offers it, and says what the entry
    // written in it does. Still a box to type in: a GM's ruling, an option no
    // pack carries, or a note beside the name all go in as they always did.
    const menu = field.menu?.options?.length ? field.menu : null;
    const body = menu
      ? menuField(ctx, ref, field, menu, placeholder, row.classLevel)
      : prose(model, `class="cfeat" data-cfeat="${ref}"${field.on ? '' : ' disabled'}${placeholder}`, field.text, 1, 'grow');

    return `<span class="ffield ${state}"${colour ? ` style="--gc:${esc(colour)};--gc-soft:${rgba(colour, 0.13)}"` : ''}${title ? ` title="${esc(title)}"` : ''}>
      ${tag}${body}
    </span>`;
  }

  /**
   * Which menu a column's cells pick from.
   *
   * Only shown once a pack provides one, since with none there is nothing to
   * choose between. A menu named on the column but no longer provided stays
   * listed, so switching its pack off does not quietly forget the choice.
   */
function featureColumnMenu(model, className, col, index) {
    // A column may name several menus, layered -- an archetype's over the
    // class's. The dropdown edits the first; the rest are shown after it,
    // since an archetype's pill is where those come and go.
    const stack = model.classFeatureColumnOptions(className, col);
    const [chosen = '', ...layered] = stack;
    const all = optionCatalogues();
    if (!all.length && !chosen) return '';
    const names = all.map((c) => c.name);
    if (chosen && !names.some((n) => same(n, chosen))) names.push(chosen);
    const missing = chosen && !all.some((c) => same(c.name, chosen));
    const claimed = chosen && !model.classFeatureColumnOptionsChosen(className, col);
    return `<select class="colmenu${missing ? ' bad' : ''}" data-cfmenu="${esc(className)}|${index}"
      title="${esc(missing ? `“${chosen}” is not switched on — its pack is off or not installed.`
    : claimed ? `“${chosen}” names this class and this feature, so this column picks from it. Choose another, or none.`
      : chosen ? `Cells in this column pick from “${chosen}”.`
        : 'Pick from a menu a pack provides, rather than typing each entry.')}">
      <option value=""${chosen ? '' : ' selected'}>— no menu —</option>
      ${names.map((n) => `<option value="${esc(n)}"${same(n, chosen) ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>${layered.map((n) => `<span class="colmenu layered" title="${
      esc(`“${n}” is layered over the menu above — its entries win, and the ones it replaces drop out.`)}">+ ${esc(n)}</span>`).join('')}`;
  }

  /** A cell that picks from a menu: the names on offer, and what the one written means. */
function menuField(ctx, ref, field, menu, placeholder, atLevel) {
    const chosen = menu.options.find((o) => same(o.name, field.text));
    const offered = menu.options.filter((o) => !o.minLevel || o.minLevel <= atLevel).length;
    // An entry written into a level below the one it asks for is flagged, not
    // refused: a GM may allow it, and the sheet's job is to say what the book
    // says rather than to stop anyone.
    const tooSoon = chosen?.minLevel > atLevel;
    const hint = chosen
      ? [chosen.category, chosen.minLevel ? `needs ${chosen.minLevel}th level` : '', chosen.source]
        .filter(Boolean).join(' · ')
        + (tooSoon ? `\n\nThis is a ${chosen.minLevel}th-level entry, written at ${atLevel}th.` : '')
        + (chosen.text ? `\n\n${chosen.text}` : '')
      : `${offered} of ${menu.options.length} on offer at this level — ${menu.name}`;
    // A locked cell never opens its list, so it does not ask for one written.
    const list = field.on ? ` list="${menuListId(ctx, menu, atLevel)}"` : '';
    return `<input type="text" class="cfeat pick${tooSoon ? ' early' : ''}"${list} data-cfeat="${ref}"
      value="${esc(field.text)}"${field.on ? '' : ' disabled'}${placeholder}
      title="${esc(hint)}" spellcheck="false">`;
  }

  /* ---------------- lore & leftover tabs ---------------- */


export function renderExtrasPanel(model, ctx) {
    const c = model.data;
    const x = c.extras || {};
    const list = 'extras.approvals';
    const isUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());
    return `<div class="grid">
      <section class="panel span2">
        <h3>Notes <span class="badge">${(c.notes || []).length}</span></h3>
        ${(c.notes || []).map((n, i) => `<div class="notecard editable">
          <div class="noterow">
            ${itemText('notes', i, 'title', n.title, 'Title')}
            <button class="danger" data-remove="notes|${i}" aria-label="Remove note">×</button>
          </div>
          ${itemArea(model, 'notes', i, 'body', n.body, 4)}
        </div>`).join('') || '<p class="empty">No notes yet — jot anything here: links, ideas, things to ask the GM.</p>'}
        <div style="margin-top:8px">${addButton('notes', 'Add note', { title: '', body: '' })}</div>
        <p class="hint">Plain text, with inline formulas if you want them: <code>{= level * 2}</code>.
          Links are kept as typed.</p>
      </section>

      <section class="panel span2">
        <h3>Approvals <span class="badge">${(x.approvals || []).length}</span></h3>
        ${(x.approvals || []).length ? `<div class="tablewrap"><table class="approvals stacked">
          <thead><tr>
            <th style="width:14rem">App</th>
            <th style="width:9rem">Approved by</th>
            <th>Link</th><th style="width:2.4rem"></th>
          </tr></thead>
          <tbody>${x.approvals.map((a, i) => `<tr>
            <td data-stack="name">${itemText(list, i, 'name', a.name, 'What was applied for', true)}</td>
            <td data-label="Approved by">${itemText(list, i, 'approvedBy', a.approvedBy, 'Who', true)}</td>
            <td data-label="Link"><span class="pair link">${itemText(list, i, 'link', a.link, 'https://…', true)}
              ${isUrl(a.link) ? `<a href="${esc(a.link)}" target="_blank" rel="noopener" title="Open">↗</a>` : ''}</span></td>
            ${rowTools(list, i)}
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">No approvals recorded.</p>'}
        <div style="margin-top:8px">${addButton(list, 'Add approval', { name: '', approvedBy: '', link: '' })}</div>
        <label class="fld tall" style="margin-top:10px"><span>Notes</span>
          ${prose(model, 'data-set="extras.approvalNotes"', x.approvalNotes, 3, 'grow')}</label>
        <p class="hint">Custom archetypes, feats and items that needed a sign-off, and where the
          approval lives. The two short columns carry the whole of what was typed on their
          tooltips, so a long name is cut on screen and never lost; the Link column takes the
          rest of the row, since a URL is the one thing here that cannot be abbreviated.
          The notes box reads {…} like the rest of the sheet.</p>
      </section>
      ${systemExtrasPanel(x, 'extras', 'ExtrasNotes')}
    </div>`;
  }


export function renderLorePanel(model, ctx) {
    const c = model.data;

    return `<div class="grid">
      <section class="panel span2">
        <h3>Background</h3>
        <div class="fieldgrid two">
          ${(c.backgroundSections || []).map((sec, i) => `<label class="fld tall">
            <span>${esc(sec.label)}</span>${itemArea(model, 'backgroundSections', i, 'text', sec.text, 3)}
          </label>`).join('')}
        </div>
        <div style="margin-top:8px">${addButton('backgroundSections', 'Add section', { label: 'New section', text: '' })}</div>
      </section>
    </div>`;
  }

  /**
   * Render a tab we did not model explicitly, as an editable grid.
   *
   * These hold each character's bespoke machinery -- sphere talents, veils,
   * technique lists -- whose shape differs per character, so they stay a grid
   * rather than being forced into a schema. Every cell is editable and rows
   * can be added or removed.
   */
export function gridTab(model, index, tab) {
    const list = `sheetTabs.${index}.rows`;
    const rows = tab.rows || [];
    const width = Math.min(14, Math.max(...rows.map((r) => r.cells.length), 3));
    return `<section class="panel span2">
      <h3>${esc(tab.name)} ${tab.hidden ? '<span class="badge">hidden in source</span>' : ''}
        <span class="badge">${rows.length} rows</span></h3>
      <div class="tablewrap"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${
  hasTokens(r.cells[ci]) ? prose(model, `data-item="${list}|${ri}|cells.${ci}"`, r.cells[ci], 1, 'grow')
    : itemText(list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
      <div style="margin-top:8px">
        ${addButton(list, 'Add row', { cells: Array.from({ length: width }, () => null) })}
      </div>
    </section>`;
  }
