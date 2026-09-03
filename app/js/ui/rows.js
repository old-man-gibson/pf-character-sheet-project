/**
 * ui/rows.js -- the cells and furniture a list row is made of.
 *
 * The counterpart to ui/fields.js: where those write `data-set` and address a
 * path on the document, these write `data-item="list|index|field"` and address
 * one cell of one row. Same bargain -- the panel writes the attribute, the
 * element's delegated handler is what actually does anything -- so these are
 * string builders with no character and no element behind them.
 *
 * The few that need something more take it as an argument: `proseText` needs a
 * model to resolve tokens against, `rowRemoveArmed` needs to know which × is
 * currently armed. That is the whole reason they are arguments rather than
 * fields: it is what lets the rest of this file be plain functions.
 */
import { esc, val, EXPR_HINT, abKeyAttr, abAttr, picksAbility } from './html.js';
import { hasTokens, plainTokens } from '../inline.js';
import { fmt } from '../rules.js';

/**
 * `title` is for a cell narrow enough to cut its own value off: an input
 * scrolls rather than showing an ellipsis, so the whole of it has to be
 * readable from somewhere. Left off where the column is wide enough to
 * speak for itself, so the tooltip stays a signal.
 *
 * The last argument grew a second job when the catalogue tables arrived: a
 * feat, a spell and a power are typed into a cell like this with the
 * catalogue behind them, which wants a `list`. It still takes the bare
 * boolean every existing caller passes -- `true` is `{ title: true }` -- so
 * that adding the option changed nothing that was already written.
 */
export function itemText(list, i, field, value, placeholder = '', opts = false) {
  const o = (opts && typeof opts === 'object') ? opts : { title: !!opts };
  const text = String(value ?? '');
  return `<input type="text" value="${esc(text)}" data-item="${list}|${i}|${field}"
      data-kind="text" placeholder="${esc(placeholder)}"${
  o.list ? ` list="${esc(o.list)}"` : ''}${o.title && text.trim() ? ` title="${esc(text)}"` : ''}>`;
}

export function itemNum(list, i, field, value) {
  return `<input type="number" value="${Number(value) || 0}" data-item="${list}|${i}|${field}" data-kind="number">`;
}

export function itemCheck(list, i, field, value) {
  return `<input type="checkbox" ${value ? 'checked' : ''} data-item="${list}|${i}|${field}" data-kind="bool">`;
}

/**
 * A field whose value may be written as a formula (`level * 100`, `int.mod`,
 * a name defined in prose) rather than typed as a number.
 *
 * Same two-layer trick as the prose fields, for the same reason: a cell full
 * of source with the answer parked beside it reads as neither. The resolved
 * value is what sits in the cell, the raw source appears in place the moment
 * the field is clicked or tabbed into, and both layers carry the one binding
 * so this is still a plain data-item/data-set control.
 *
 * `value` is the resolved result; pass null to keep the raw text showing (a
 * literal `1d8`, an unresolvable formula).
 */
export function exprField(bindingAttr, raw, {
  kind = 'expr', width = '5rem', placeholder = '', title = '', value = null, error = null,
} = {}) {
  const src = raw ?? '';
  const isFormula = typeof src === 'string' && src.trim() !== '';
  const view = isFormula && !error && value !== null && value !== undefined && value !== '';
  const explain = `${src} = ${value}`;
  return `<span class="xf${view ? ' has-value' : ''}${error ? ' invalid' : ''}" style="--xf-w:${width}">
      <input type="text" class="xf-src${isFormula ? ' mono' : ''}" value="${esc(src)}"
        ${bindingAttr} data-kind="${kind}" placeholder="${esc(placeholder)}"
        title="${esc(error || (view ? explain : title) || EXPR_HINT)}">
      ${view ? `<span class="xf-view" title="${esc(explain)} — click to edit">${esc(value)}</span>` : ''}
    </span>`;
}

/**
 * A number a player may write as a formula instead (`level * 100`).
 *
 * The model resolves it in the same sandbox as the trackers and writes the
 * result into `<field>Num`, so the cell can show what it currently means and
 * a bad formula is flagged here as well as in the Formula Audit.
 */
export function itemExpr(list, i, field, obj, { width = '5rem', placeholder = '' } = {}) {
  return exprField(`data-item="${list}|${i}|${field}"`, obj[field], {
    width,
    placeholder,
    value: obj[`${field}Num`],
    error: obj[`${field}Error`],
    title: 'A number, or a formula like level * 100',
  });
}

/**
 * Options are `value`, `[value, label]` or `[value, label, tooltip]`.
 *
 * `abOf` colours a picker whose choices are not themselves ability names:
 * given a choice, it answers which ability that choice runs on. Each option
 * carries its own answer, so the open list is coded too and the select can
 * repaint from the option it lands on.
 */
export function itemSelect(list, i, field, value, options, blank = '—', abOf = null) {
  const pairs = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  const ab = picksAbility(pairs.map(([v]) => v));
  if (value && !pairs.some(([v]) => String(v) === String(value))) {
    pairs.push([value, `${value} *`]);
  }
  const mark = (v) => (abOf ? abKeyAttr(abOf(v)) : abAttr(ab, v));
  const opts = (blank === null ? pairs : [['', blank], ...pairs])
    .map(([v, label, hint]) => `<option value="${esc(v)}"${hint ? ` title="${esc(hint)}"` : ''}${mark(v)}${
      String(value ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  return `<select data-item="${list}|${i}|${field}" data-kind="text"${mark(value)}>${opts}</select>`;
}

export function rowTools(list, i) {
  return `<td class="tools">
      <button data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
      <button data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>
      <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
    </td>`;
}

/**
 * Tools for a list that is reordered by dragging a grip.
 *
 * The grip is the only way such a list moves, and a card hides it -- a drag
 * from one row to another is not a gesture a phone has. So the two arrows
 * every other list carries are written here as well, and shown only where the
 * grip is not; see `button.cardmove` in the stylesheet.
 */
export function rowToolsDragged(list, i) {
  return `<td class="tools">
      <button class="cardmove" data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
      <button class="cardmove" data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>
      <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
    </td>`;
}

/** Tools for a list whose rows are summed, so their order means nothing. */
export function rowRemove(list, i) {
  return `<td class="tools">
      <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
    </td>`;
}

/**
 * A × that asks twice: the first click arms it (it says so), the second
 * removes. For rows a stray click would genuinely hurt to lose.
 *
 * `armedKey` is whichever × is currently armed, which the element holds.
 */
export function rowRemoveArmed(list, i, what = 'row', armedKey = null) {
  const key = `${list}|${i}`;
  const armed = armedKey === key;
  return `<td class="tools">
      <button class="danger${armed ? ' armed' : ''}" data-remove-armed="${key}"
        title="${esc(armed ? `Click again to remove ${what}` : `Remove ${what} — asks twice`)}"
        aria-label="${esc(`Remove ${what}${armed ? ' — click again to confirm' : ''}`)}">${armed ? 'sure?' : '×'}</button>
    </td>`;
}

/** Prose rendered to plain text -- for a title, where markup cannot go. */
export function proseText(model, text) {
  if (!hasTokens(text)) return String(text ?? '');
  return plainTokens(model.renderProse(text));
}

/**
 * A number a condition or buff has moved, shown in place of the base --
 * red down, green up, with the base and what moved it in the tooltip.
 * The plain base when nothing moved it; the same read on every view.
 */
/**
 * A breakdown as the sentence a totalled number wears on its tooltip.
 *
 * The parts in the order the sum takes them, each with the note that explains
 * it where there is one, and the total underneath. A part that came to
 * nothing is already gone; a part this sheet has not accounted for shows up
 * as a last line saying so, because a working that does not add up is worse
 * than no working at all.
 */
export function workingTitle(b, extra = '') {
  if (!b) return extra;
  const lines = b.parts.map((p) => `  ${fmt(p.value)}  ${p.label}${p.note ? ` — ${p.note}` : ''}`);
  if (b.sum !== b.total) lines.push(`  ${fmt(b.total - b.sum)}  unaccounted for`);
  return `${b.label} ${b.total}\n${lines.join('\n')}${extra ? `\n\n${extra}` : ''}`;
}

/**
 * @param model  when given, the tooltip carries the whole working -- every
 *               part the number is made of, in the order they are added. The
 *               figure is printed in a dozen places and the parts in one, so
 *               the answer to "why is my AC 50" belongs on the 50.
 */
export function movedInline(cs, key, base, format = fmt, model = null) {
  const d = cs.changed ? (cs.delta[key] || 0) : 0;
  const moved = d ? `Base ${format(base)} — with ${cs.sources} applied` : '';
  const b = model ? model.breakdown(key) : null;
  const title = workingTitle(b, moved);
  /*
   * The key, not the sentence. The panel that opens on hover asks the model
   * for the breakdown again when it opens, so what it shows can never be a
   * render old; `data-bdx` carries the one line it could not work out for
   * itself. See ui/breakdown-popover.js.
   *
   * The `title` stays exactly as it was. It is what a browser with no popover
   * API keeps, what prints, and what the accessibility tree reads -- the panel
   * borrows it while it is up and hands it straight back.
   *
   * Only where there is something to open. `key` is the name a condition delta
   * goes by, and most but not all of those are in BREAKDOWNS; the ones that
   * are not keep the tooltip they have always had and gain nothing.
   */
  const bd = b ? ` data-bd="${esc(key)}"${moved ? ` data-bdx="${esc(moved)}"` : ''}` : '';
  if (!d) {
    return title
      ? `<span class="working" title="${esc(title)}"${bd}>${format(base)}</span>`
      : `${format(base)}`;
  }
  return `<strong class="adj working ${d > 0 ? 'up' : ''}" title="${esc(title)}"${bd}>${format(cs.adjusted[key])}</strong>`;
}

/**
 * The same reading, for a line that is already small print.
 *
 * `movedInline` puts the moved number in bold, which is right where it is the
 * figure being rolled and wrong under one -- a `touch 43 · FF 34` sub-line in
 * bold reads louder than the AC above it. Same colour, same tooltip, no
 * weight. It exists because the sub-lines were not being adjusted at all: the
 * headline followed a buff and the two numbers beneath it did not, so one card
 * disagreed with itself.
 */
export function movedSub(cs, key, base, format = fmt) {
  const d = cs.changed ? (cs.delta[key] || 0) : 0;
  if (!d) return `${format(base)}`;
  return `<span class="adj ${d > 0 ? 'up' : ''}" title="${esc(`Base ${format(base)} — with ${cs.sources} applied`)}">${format(cs.adjusted[key])}</span>`;
}

export function addButton(list, label, template) {
  return `<button class="primary" data-add="${list}" data-template="${esc(JSON.stringify(template))}">+ ${esc(label)}</button>`;
}

/**
 * A whole list seeded in one click, for a table that is copied rather than
 * composed: a class's printed progression is six rows that are already right,
 * and adding them one at a time is six clicks before the first correction.
 */
export function addManyButton(list, label, items) {
  return `<button data-add-many="${list}" data-template="${esc(JSON.stringify(items))}">+ ${esc(label)}</button>`;
}

/**
 * `now` is the conditioned reading, shown under the base when it differs.
 *
 * `v` and `sub` take either a value or `{html}`. A value is escaped; `{html}`
 * is markup we built ourselves -- a moved value shown in the base's place, or
 * a line with an entity in it. The opt-in is that way round because `sub` is
 * mostly *workbook text*: an ability name, an iterative line, a companion's
 * attack stat, each of which is whatever was typed into a spreadsheet cell and
 * none of which the model constrains. It used to be interpolated raw, which
 * made a character document able to put markup on the page of whoever opened
 * it -- and since a published sheet is fetched from a URL and opened by a
 * stranger, "whoever opened it" is not only its author.
 */
export function bigStat(k, v, sub, now = '', roll = '') {
  const markup = (x) => (x && typeof x === 'object' && 'html' in x ? x.html : esc(x));
  const shown = markup(v);
  const under = markup(sub);
  return `<div class="bigstat${now ? ' has-now' : ''}"><div class="k">${esc(k)}</div><div class="v">${shown}</div><div class="sub">${under || '&nbsp;'}</div>${now}${roll}</div>`;
}

/** A stat for a header strip: one line, sized to read rather than to fill. */
export function miniStat(k, v, title = '') {
  return `<span class="ministat"${title ? ` title="${esc(title)}"` : ''}>
      <span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></span>`;
}

export function line(label, value, big = false) {
  return `<div class="statline"><span class="label">${esc(label)}</span><span class="value ${big ? 'big' : ''}">${val(value)}</span></div>`;
}

/** A stat line whose value is markup of our own making, not a value to escape. */
export function lineHtml(label, html, big = false) {
  return `<div class="statline"><span class="label">${esc(label)}</span><span class="value ${big ? 'big' : ''}">${html}</span></div>`;
}

export function editLine(label, path, value) {
  return `<div class="statline">
      <span class="label">${esc(label)}</span>
      <span class="value"><input type="number" value="${Number(value) || 0}" data-set="${path}" style="width:4.2rem" aria-label="${esc(label)}"></span>
    </div>`;
}

/**
 * A panel that can be folded down to its heading.
 *
 * The button is spliced into the panel's own <h3> rather than wrapped around
 * it, so a collapsed panel is the same header in the same place -- nothing
 * moves when it folds, which is the point of folding it.
 */
export function collapsible(model, key, panelHtml) {
  const collapsed = !!model.data.uiPrefs?.collapsed?.[key];
  const btn = foldButton(model, key);
  if (!collapsed) return panelHtml.replace('</h3>', ` ${btn}</h3>`);
  // Collapsed: keep only the header line of the panel.
  const m = panelHtml.match(/<h3[\s\S]*?<\/h3>/);
  const header = m ? m[0].replace('</h3>', ` ${btn}</h3>`) : btn;
  const cls = panelHtml.match(/class="panel([^"]*)"/)?.[1] ?? '';
  return `<section class="panel${cls} collapsed">${header}</section>`;
}

/**
 * Whether `key` is folded right now.
 *
 * Unset is not the same as open: a block may want to start folded in one
 * situation and open in another -- the practitioner table is controls while it
 * is what the character uses and reference once a class progression takes
 * over. So `fallback` decides only while nothing has been clicked, and the
 * moment it is, the choice is stored and outranks it.
 */
export function isCollapsed(model, key, fallback = false) {
  const stored = model.data.uiPrefs?.collapsed?.[key];
  return stored === undefined ? !!fallback : !!stored;
}

/**
 * The ▾/▸ that folds whatever `key` names; the click lands on the element.
 *
 * `collapsedNow` is the state being drawn, which is the stored one unless a
 * caller has a default of its own. The click handler reads it back off
 * `aria-expanded` rather than off storage, so the first click on a block that
 * started folded by default opens it instead of storing the fold it is
 * already showing.
 */
export function foldButton(model, key, collapsedNow = null) {
  const collapsed = collapsedNow === null ? isCollapsed(model, key) : !!collapsedNow;
  // Escaped because a fold key is not always ours: `progfeat-${name}` builds
  // one out of a feature group's name, which is workbook text. The reader
  // decodes character references in an attribute value, so `dataset.collapse`
  // still hands the click handler back the exact key that went in.
  return `<button data-collapse="${esc(key)}" data-collapse-to="${!collapsed}"
    title="${collapsed ? 'Expand' : 'Minimize'}"
    aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>`;
}

/**
 * One block inside a panel, folded down to its subhead.
 *
 * The same state and the same button as `collapsible`, a heading level down: a
 * panel's <h3> folds the whole panel, and this folds one group within it --
 * which is what a panel holding two tables of its own wants. Collapsed it
 * keeps the subhead exactly where it was, so nothing moves but the body.
 */
export function collapsibleSub(model, key, title, bodyHtml, className = '', defaultCollapsed = false) {
  const collapsed = isCollapsed(model, key, defaultCollapsed);
  const classes = `${className}${className ? ' ' : ''}foldsub${collapsed ? ' collapsed' : ''}`;
  return `<div class="${classes}">
    <h4 class="subhead">${title} ${foldButton(model, key, collapsed)}</h4>
    ${collapsed ? '' : bodyHtml}
  </div>`;
}
