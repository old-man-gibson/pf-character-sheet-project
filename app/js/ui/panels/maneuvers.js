/**
 * ui/panels/maneuvers.js -- the Path of War Maneuvers tab.
 *
 * Disciplines as narrow columns of tick boxes, side by side, and one
 * maneuver opened as a card to read or fill in. The disciplines and what
 * they grant come from the shared catalogue a pack supplies; anything the
 * player writes on a maneuver sits over the pack's cell.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, packText } from '../html.js';
import { prose, renderedProse } from '../prose.js';
import { maneuverCatalogue, maneuverDetails, maneuverIsWritten, maneuverOwn } from '../../model.js';
import { MANEUVER_FIELDS, WIKI_BASE, wikiUrl } from '../../rules.js';
import { hasTokens } from '../../inline.js';
import { num } from '../fields.js';
import { foldButton, isCollapsed, miniStat, removeButton } from '../rows.js';
import { systemExtrasPanel } from './system-tabs.js';

/**
 * Maneuver types, short enough for a narrow column.
 *
 * The sheet writes qualifiers in brackets -- "Strike [curse]", "Strike [G]" --
 * which the full name carries in the row's tooltip.
 */
const TYPE_ABBREV = {
  Strike: 'Str', Boost: 'Bst', Counter: 'Ctr', Stance: 'Stc', Untyped: 'Unt',
};

export const shortType = (t) => {
  const base = String(t || '').replace(/\s*\[.*$/, '').trim();
  return TYPE_ABBREV[base] || base.slice(0, 3);
};

  /**
   * Disciplines as tick lists, side by side.
   *
   * Knowing a discipline grants everything in it, so the character picks the
   * discipline from the shared catalogue and the maneuvers it grants appear
   * underneath to be readied. Each discipline is a narrow column rather than a
   * full-width table: the useful width is a name and a tick box, and a dozen
   * disciplines want to be readable side by side.
   */
export function renderManeuversPanel(model, ctx) {
    const m = model.data.maneuvers;
    if (!m) return '<div class="grid"><p class="empty">No maneuver data.</p></div>';
    const k = m.calc || {};
    // Matched as the packs merge them: case and space do not make a second discipline.
    const key = (n) => String(n ?? '').trim().toLowerCase();
    const taken = new Set((m.disciplines || []).map((d) => key(d.name)));
    const available = [...new Map(maneuverCatalogue().disciplines
      .map((d) => [key(d.name), d.name])).entries()]
      .filter(([k]) => k && !taken.has(k)).map(([, name]) => name);

    return `<div class="grid">
      <section class="panel span2">
        <h3>Maneuvers ${k.legal === false ? '<span class="badge err">over the limit</span>' : ''}</h3>
        <div class="statbar">
          ${miniStat('Maneuvers', `${k.maneuvers ?? 0}/${k.possibleManeuvers ?? 0}`)}
          ${miniStat('Stances', `${k.stances ?? 0}/${k.possibleStances ?? 0}`)}
          ${miniStat('Disciplines', (m.disciplines || []).length)}
          <span class="statbar-fill"></span>
          <label class="minifield">Maneuvers allowed
            ${num('maneuvers.possibleManeuvers', m.possibleManeuvers, 'style="width:3.4rem"')}</label>
          <label class="minifield">Stances allowed
            ${num('maneuvers.possibleStances', m.possibleStances, 'style="width:3.4rem"')}</label>
        </div>
        <div class="pair" style="margin-top:8px">
          <select data-action="add-discipline" aria-label="Add a discipline">
            <option value="">Train a discipline…</option>
            ${available.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
          </select>
          ${available.length ? '' : '<span class="hint">Every discipline in the catalogue is trained.</span>'}
        </div>
        <p class="hint" style="margin-top:6px">
          <strong>Tick</strong> a maneuver to ready it. Only the box toggles it; nothing else
          on the row does. <strong>Click its name</strong> to read what you wrote
          about it. Click the ✎ to write it: type, action, range, target, duration,
          saving throw and description. Each field takes <code>{…}</code> formulas.
          <strong>Right-click</strong> a name to open its page on the
          <a href="${esc(WIKI_BASE)}" target="_blank" rel="noopener noreferrer">wiki</a>.
        </p>
      </section>

      <section class="panel span2 discipline-wrap">
        ${(m.disciplines || []).length
    ? `<div class="disciplines">${(m.disciplines || []).map((d, i) => disciplineColumn(model, ctx, d, i)).join('')}</div>`
    : '<p class="empty">No disciplines trained. Pick one above to see what it grants.</p>'}
      </section>

      ${systemExtrasPanel(model, m, 'maneuvers', 'Maneuvers')}
    </div>`;
  }

  /**
   * One discipline: its readied count, then every maneuver it grants, grouped
   * by level. Ticking a row readies it; the row itself comes from the shared
   * catalogue and is not stored on the character.
   */
function disciplineColumn(model, ctx, d, i) {
    const list = `maneuvers.disciplines.${i}`;
    const entries = d.entries || [];
    const levels = [...new Set(entries.map((e) => e.level))].sort((a, b) => a - b);
    const collapsed = isCollapsed(model, `disc:${d.name}`);

    return `<div class="discipline${collapsed ? ' is-collapsed' : ''}">
      <div class="discipline-head">
        ${foldButton(model, `disc:${d.name}`, { open: !collapsed, cls: 'disclose', title: collapsed ? 'Expand' : 'Collapse' })}
        <span class="dname" title="${esc(d.name)}">${esc(d.name) || '<em>Unnamed</em>'}</span>
        <span class="dcount" title="readied maneuvers / stances">${d.knownManeuvers ?? 0}<i>/</i>${d.knownStances ?? 0}</span>
        ${removeButton('maneuvers.disciplines', i, { what: 'discipline', title: `Stop training ${d.name}`, tiny: true })}
      </div>
      ${collapsed ? '' : `<div class="discipline-body">
        ${d.inCatalogue === false && !entries.length
    ? '<p class="empty">Not in the catalogue.</p>' : ''}
        ${levels.map((lvl) => `
          <div class="dlevel">${lvl ? `Level ${lvl}` : 'Other'}</div>
          ${entries.map((e, ei) => [e, ei]).filter(([e]) => e.level === lvl).map(([e, ei]) => {
    const wiki = wikiUrl(e.name);
    const key = `${list}|${e.name}`;
    const open = ctx.openManeuver === key;
    // Two readings of the same maneuver: what it says (the player's cells over
    // the catalogue's) and what the player wrote (which is what the pen means,
    // and all that is ever saved).
    const entry = maneuverDetails(d, e.name, e);
    const own = maneuverOwn(d, e.name);
    const written = maneuverIsWritten(own);
    return `
            <div class="mrow${e.known ? ' is-known' : ''}${open ? ' is-open' : ''}">
              <label class="mtick" title="${esc(e.known ? `Stop readying ${e.name}` : `Ready ${e.name}`)}">
                <input type="checkbox" ${e.known ? 'checked' : ''}
                  data-ready="${list}|${esc(e.name)}" data-kind="bool"
                  aria-label="Ready ${esc(e.name)}"></label>
              <button data-view type="button" class="mname" data-mopen="${esc(key)}"
                ${wiki ? `data-wiki="${esc(wiki)}"` : ''} aria-expanded="${open}"
                title="${esc(e.name)}${entry.type ? ` — ${esc(entry.type)}` : ''}

Click to ${open ? 'close' : 'open'} it${wiki ? ', right-click for the wiki' : ''}">${esc(e.name)}</button>
              <span class="mtype ${e.kind === 'stance' ? 'is-stance' : ''}">${esc(shortType(entry.type))}</span>
              <button class="mnote-btn${written ? ' has-note' : ''}" data-medit="${esc(key)}"
                title="${written ? 'What you wrote down about it — click to edit' : 'Write down what it does — {…} formulas work'}"
                aria-label="Edit ${esc(e.name)}" aria-expanded="${open && !!ctx.maneuverEdit}">✎</button>
            </div>
            ${open ? maneuverCard(model, ctx, list, e, entry, own, key, wiki) : ''}`;
  }).join('')}
        `).join('')}
      </div>`}
    </div>`;
  }

/* ------------------------------------------------------------------ *
 * One maneuver, opened.
 *
 * Two faces of the same card -- read it, or fill it in -- because at the
 * table you are reading it and only ever writing it once.
 *
 * What it says can come from two places. A pack may carry the cells (the
 * bundled Path of War catalogue carries only the type: the rest is a
 * publisher's rules text and is not ours to ship, but a player's own pack is
 * their own content). Anything the player writes on their sheet sits over the
 * top of that, cell by cell -- so a table ruling scribbled mid-session wins,
 * and emptying the cell again hands it back to the pack.
 * ------------------------------------------------------------------ */

function maneuverCard(model, ctx, list, e, entry, own, key, wiki) {
  const editing = !!ctx.maneuverEdit;
  const sub = [e.level ? `Level ${e.level}` : '', e.kind === 'stance' ? 'Stance' : 'Maneuver']
    .filter(Boolean).join(' · ');

  return `<div class="mdetail${editing ? ' is-editing' : ''}">
      <div class="mdetail-head">
        <span class="mdetail-name" title="${esc(e.name)}">${esc(e.name)}</span>
        <span class="mdetail-sub">${esc(sub)}</span>
        ${wiki ? `<a class="mdetail-wiki" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer"
          title="Its page on the wiki">wiki ↗</a>` : ''}
        <button class="tiny" ${editing ? `data-view data-mopen="${esc(key)}"` : `data-medit="${esc(key)}"`}
          aria-pressed="${editing}"
          title="${editing ? 'Back to reading it' : 'Fill in what it does'}">${editing ? 'Done' : 'Edit'}</button>
        <button data-view class="tiny" data-mclose="${esc(key)}" title="Close" aria-label="Close ${esc(e.name)}">×</button>
      </div>
      ${editing ? maneuverCells(model, list, e, own) : maneuverRead(model, ctx, entry, key, e.known)}
    </div>`;
}

/**
 * What it says, with the blanks left out.
 *
 * A stat entry prints the lines it has; the ones nobody filled in are not
 * "Target: —", they are simply not part of the maneuver, and a card of seven
 * em-dashes is a form rather than a rules entry.
 */
// A bonus written on a maneuver applies only while it is readied.
const UNREADIED = { inactiveTitle: 'Not readied, so the bonus is not applying. Ready it to switch it on.' };

function maneuverRead(model, ctx, entry, key, readied = true) {
  const shown = MANEUVER_FIELDS
    .map((f) => [f, entry[f.key]])
    .filter(([, v]) => String(v).trim() !== '');
  const value = (v) => (hasTokens(v) ? renderedProse(model, v, null, { ...UNREADIED, inactive: !readied }) : esc(v));
  const cells = shown.filter(([f]) => f.key !== 'text');
  const body = shown.find(([f]) => f.key === 'text');
  return `${cells.length ? `<dl class="mdetail-cells">${cells.map(([f, v]) => `
      <dt>${esc(f.label)}</dt><dd>${value(v)}</dd>`).join('')}</dl>` : ''}
    ${body ? packText(ctx, `man:${key}`, 'mdetail-text', value(body[1])) : ''}
    ${maneuverIsWritten(entry) ? '' : '<p class="empty">Nothing written down yet — <strong>Edit</strong> fills it in.</p>'}`;
}

/**
 * The same entry with every cell open.
 *
 * Three of them are picked from a list because the rules only allow those
 * answers; the rest are prose, so a range that scales -- `Close ({= 25 + 5 *
 * floor(level / 2)} ft.)` -- keeps up with the level instead of going stale
 * the way a typed number does.
 *
 * A cell holds the player's own answer and nothing else, so that clearing one
 * really does clear it. What the catalogue says sits behind as the greyed
 * placeholder -- which is also what the cell falls back to the moment it is
 * emptied, so the ghost text is a promise rather than a hint.
 */
function maneuverCells(model, list, e, own) {
  const key = `${list}|${e.name}`;
  const bind = (f) => `data-mfield="${esc(key)}" data-mf="${f.key}" aria-label="${esc(f.label)}"`;
  const cell = (f) => {
    // What the catalogue's own row says for this cell, whether or not the
    // player has written over it -- because that is what emptying it gives
    // back, which makes the ghost text a promise rather than a hint.
    //
    // A cell the catalogue says nothing about falls back to an example
    // instead, and the two must not read alike: "Melee attack" is what the
    // cell *will* say if left alone, "e.g. One creature" is only a suggestion.
    const under = String(e?.[f.key] ?? '');
    const ghost = under || (f.hint ? `e.g. ${f.hint}` : '');
    const control = f.options
      ? maneuverSelect(bind(f), own[f.key], f.options,
        under ? `${under} — from the catalogue` : '—')
      : prose(model, `${bind(f)} placeholder="${esc(ghost)}"`,
        own[f.key], f.lines || 1, 'grow', null, { ...UNREADIED, inactive: !e.known });
    return `<div class="mcell"><span class="k">${esc(f.label)}</span>${control}</div>`;
  };
  const lines = [...new Set(MANEUVER_FIELDS.map((f) => f.line))];
  return `<div class="medit">${lines.map((n) => `<div class="mline">${
    MANEUVER_FIELDS.filter((f) => f.line === n).map(cell).join('')}</div>`).join('')}</div>`;
}

/** A picker that keeps an answer its list has never heard of, marked with a *. */
function maneuverSelect(bindingAttr, value, options, blank) {
  const pairs = options.map((o) => [o, o]);
  if (value && !pairs.some(([v]) => v === value)) pairs.push([value, `${value} *`]);
  const opts = [['', blank], ...pairs]
    .map(([v, label]) => `<option value="${esc(v)}"${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  return `<select ${bindingAttr} data-kind="text">${opts}</select>`;
}
