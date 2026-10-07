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
 * model to resolve tokens against, `removeButton` needs to know which × is
 * currently armed. That is the whole reason they are arguments rather than
 * fields: it is what lets the rest of this file be plain functions.
 */
import { esc, val, EXPR_HINT, abKeyAttr, abAttr, picksAbility } from './html.js';
import { hasTokens, plainTokens } from '../inline.js';
import { foldButton, isCollapsed } from './folds.js';

// The fold helpers live in ./folds.js, which the escape-only modules can
// import without this one; panels have always reached them through here.
export { foldButton, isCollapsed, isOpen } from './folds.js';
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
      <input type="text" size="1" class="xf-src${isFormula ? ' mono' : ''}" value="${esc(src)}"
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

/**
 * The sheet's one ×: a button that takes something off the character.
 *
 * Every removal is drawn here, whatever it removes and however its click is
 * handled, so they all look and read alike: the danger colour, "Remove
 * <what>" on hover and to a screen reader, and a × unless the button is a
 * sentence ("Remove this one"). `attrs` say what it does: `data-remove` for a
 * row (`removeButton` below), a `data-action` and its parameters for a
 * removal with a model method of its own (`removeAction`), or one of the few
 * attributes the element binds by name.
 *
 * Some ask twice: the first click arms the × -- it turns into "sure?" -- and
 * the second carries it out. Every removal can be taken back with Ctrl+Z as
 * well; asking is for the ones a stray click would take a lot with. `arm` is
 * the key the button is armed under and `armed` the key armed now, the
 * view's `armedRemove`. (Reset, which cannot be undone, has its own panel.)
 *
 * @param attrs        the attributes that say what the button does, as given
 * @param opts.what    what goes, for the hover and the screen reader
 * @param opts.title   a longer hover, where "Remove <what>" does not say enough
 * @param opts.text    words in place of the ×
 * @param opts.tiny    the small × that sits inside a cell beside a value
 * @param opts.style   an inline style (a button pushed to the end of its row)
 * @param opts.arm     the key it is armed under, when it asks twice
 * @param opts.armed   the key armed now
 */
export function removeControl(attrs, {
  what = '', title = '', text = '', tiny = false, style = '', arm = null, armed = null,
} = {}) {
  const label = what ? `Remove ${what}` : 'Remove';
  const on = arm !== null && armed === arm;
  const hover = on ? `Click again to remove${what ? ` ${what}` : ''}`
    : `${title || label}${arm !== null ? ' — asks twice' : ''}`;
  return `<button class="danger${tiny ? ' tiny' : ''}${on ? ' armed' : ''}" ${attrs}${style ? ` style="${style}"` : ''} `
    + `title="${esc(hover)}" aria-label="${esc(on ? `${label} — click again to confirm` : label)}">`
    + `${on ? 'sure?' : text ? esc(text) : '×'}</button>`;
}

/**
 * A row's ×: the element takes row `i` off `list` with `listRemove`, which
 * keeps the way back. Pass `armed` -- the view's `armedRemove`, null and all
 * -- for a row that asks twice; it is then armed under "list|i".
 */
export function removeButton(list, i, opts = {}) {
  const key = `${list}|${i}`;
  return 'armed' in opts
    ? removeControl(`data-remove-armed="${key}"`, { ...opts, arm: key })
    : removeControl(`data-remove="${key}"`, opts);
}

/**
 * A × for a removal with its own model method: `data-action` and one
 * `data-<name>` a parameter, escaped. With `opts.arm` it asks twice, and the
 * element arms it under that key before it runs the action.
 */
export function removeAction(action, params = {}, opts = {}) {
  const attrs = [`data-action="${action}"`,
    ...Object.entries(params).map(([k, v]) => `data-${k}="${esc(v)}"`),
    ...(opts.arm != null ? [`data-arm="${esc(opts.arm)}"`] : [])].join(' ');
  return removeControl(attrs, opts);
}

export function rowTools(list, i) {
  return `<td class="tools">
      <button data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
      <button data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>
      ${removeButton(list, i)}
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
      ${removeButton(list, i)}
    </td>`;
}

/** The same arrows without the ×, for fixed slots that move but are never removed. */
export function rowToolsMoveOnly(list, i) {
  return `<td class="tools">
      <button class="cardmove" data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
      <button class="cardmove" data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>
    </td>`;
}

/**
 * The grip cell for a row of a dragged list, and the attribute that row
 * carries so the element knows which list and place it is. Any list can use
 * the pair: `#bindRowDrag` groups rows by the list they name, so two tables
 * on one tab never trade rows.
 */
export const rowDrop = (list, i) => `data-rowdrop="${list}|${i}"`;
export const rowGrip = () => '<td class="grip"><span class="grip" data-rowgrip title="Drag to reorder">&#10495;</span></td>';

/**
 * Tools for a list whose rows are summed, so their order means nothing: the
 * row's ×, in its cell. `opts` are `removeButton`'s.
 */
export function rowRemove(list, i, opts = {}) {
  return `<td class="tools">
      ${removeButton(list, i, opts)}
    </td>`;
}

/** Prose rendered to plain text -- for a title, where markup cannot go. */
export function proseText(model, text) {
  if (!hasTokens(text)) return String(text ?? '');
  return plainTokens(model.renderProse(text));
}

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
  // A part is something added and wears its sign; the number a sum starts
  // from -- the 10 under an AC -- is a number, and does not.
  const figure = (p) => (p.plain ? String(p.value) : fmt(p.value));
  const row = (p, indent = '  ') => `${indent}${figure(p)}  ${p.label}${p.note ? ` — ${p.note}` : ''}`;
  const lines = b.parts.map((p) => row(p));
  if (b.sum !== b.total) lines.push(`  ${fmt(b.total - b.sum)}  unaccounted for`);
  const moved = Array.isArray(b.adjustments) && b.adjustments.length > 0;
  if (!moved) return `${b.label} ${b.total}\n${lines.join('\n')}${extra ? `\n\n${extra}` : ''}`;
  // Moved by a buff or a condition: the heading is the number as it stands,
  // the parts add up to the permanent total, and the temporary half follows
  // under its own net, one entry a source -- what one did through an ability
  // on a line under its own.
  const net = Number(b.delta) || 0;
  const tail = [`  ${net ? fmt(net) : '0'}  Buffs and conditions`];
  for (const p of b.adjustments) {
    tail.push(row(p));
    for (const l of p.lines || []) tail.push(row(l, '    '));
  }
  return `${b.label} ${b.adjusted}\nPermanent total ${b.total}\n${lines.join('\n')}\n\n${tail.join('\n')}`;
}

/**
 * A number with its working behind it, where nothing is moving it: the
 * companion's AC, its saves, its ability totals. The same span `movedInline`
 * writes -- the key for the panel, the plain working on the title -- without
 * the condition layer, which a companion has none of. The number itself
 * comes in already formatted, and goes out untouched when there is no
 * working to open on it.
 */
export function working(model, key, shown) {
  const b = model?.breakdown?.(key);
  if (!b) return shown;
  return `<span class="working" title="${esc(workingTitle(b))}" data-bd="${esc(key)}">${shown}</span>`;
}

/**
 * A number a condition or buff has moved, shown in place of the base --
 * red down, green up, with the base and what moved it in the tooltip.
 * The plain base when nothing moved it; the same read on every view.
 *
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
  // `format` makes text, and `base` can be a stored value no rule has
  // touched (flat-footed CMD is carried, not computed), so it is escaped.
  if (!d) {
    return title
      ? `<span class="working" title="${esc(title)}"${bd}>${esc(format(base))}</span>`
      : esc(format(base));
  }
  return `<strong class="adj working ${d > 0 ? 'up' : ''}" title="${esc(title)}"${bd}>${esc(format(cs.adjusted[key]))}</strong>`;
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
  if (!d) return esc(format(base));
  return `<span class="adj ${d > 0 ? 'up' : ''}" title="${esc(`Base ${format(base)} — with ${cs.sources} applied`)}">${esc(format(cs.adjusted[key]))}</span>`;
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
 *
 * The collapsed state lives in uiPrefs and persists with the character.
 */
export function collapsible(model, key, panelHtml, defaultCollapsed = false) {
  // A panel that is setup rather than reading starts folded; see `isOpen`.
  const collapsed = isCollapsed(model, key, defaultCollapsed);
  const btn = foldButton(model, key, { open: !collapsed });
  if (!collapsed) return panelHtml.replace('</h3>', ` ${btn}</h3>`);
  // Collapsed: keep only the header line of the panel.
  const m = panelHtml.match(/<h3[\s\S]*?<\/h3>/);
  const header = m ? m[0].replace('</h3>', ` ${btn}</h3>`) : btn;
  const cls = panelHtml.match(/class="panel([^"]*)"/)?.[1] ?? '';
  return `<section class="panel${cls} collapsed">${header}</section>`;
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
    <h4 class="subhead">${title} ${foldButton(model, key, { open: !collapsed })}</h4>
    ${collapsed ? '' : bodyHtml}
  </div>`;
}
