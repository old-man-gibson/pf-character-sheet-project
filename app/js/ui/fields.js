/**
 * ui/fields.js -- the single controls a panel is built from.
 *
 * Every control carries the model path it writes to, so the bind step is one
 * generic listener per input kind rather than one per field. That is the whole
 * contract between a panel and the element: a panel writes `data-set` and
 * `data-kind`, and the element's delegated handler does the rest. Which is why
 * these can live outside the class at all -- they are string builders, and the
 * behaviour is somewhere else entirely.
 *
 * See ui/rows.js for the same idea applied to rows of a list (`data-item`).
 */
import { esc, abAttr, picksAbility, ABILITY_LABELS_LIST } from './html.js';

/**
 * `opts.list` points the cell at a `<datalist>`, the way `rows.itemText` does.
 * The granted-feat rows are the reason: they are `data-set` fields rather
 * than list items, and a feat picked there should offer the same catalogue a
 * feat picked anywhere else does.
 */
export function text(path, value, placeholder = '', opts = {}) {
  return `<input type="text" value="${esc(value ?? '')}" data-set="${path}"
      data-kind="text" placeholder="${esc(placeholder)}"${opts.list ? ` list="${esc(opts.list)}"` : ''}>`;
}

export function num(path, value, extra = '') {
  return `<input type="number" value="${Number(value) || 0}" data-set="${path}"
      data-kind="number" ${extra}>`;
}

/** A value that is read, not typed: same box as a field, but shown as derived. */
export function roField(value, title = '', extra = '') {
  return `<input type="text" class="ro" value="${esc(value ?? '')}" readonly tabindex="-1"
      ${title ? `title="${esc(title)}"` : ''} ${extra}>`;
}

/**
 * A value that is read, not typed, in a cell of a table: the dashed box the
 * Details panel gives the mythic tier, so a number the sheet works out is not
 * a stray word sitting in a column of fields.
 */
export function roValue(value, title = '') {
  return `<span class="rovalue"${title ? ` title="${esc(title)}"` : ''}>${esc(value ?? '')}</span>`;
}

export function area(path, value, rows = 3) {
  return `<textarea data-set="${path}" data-kind="text" rows="${rows}">${esc(value ?? '')}</textarea>`;
}

/** `title` is for a rule the switch obeys but should not be labelled with. */
export function check(path, value, label = '', title = '') {
  return `<label class="chk"${title ? ` title="${esc(title)}"` : ''}><input type="checkbox" ${value ? 'checked' : ''}
      data-set="${path}" data-kind="bool">${label ? `<span>${esc(label)}</span>` : ''}</label>`;
}

/** `blank: null` for a choice that must be made -- no empty option at all. */
export function select(path, value, options, blank = '—') {
  const pairs = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  const ab = picksAbility(pairs.map(([v]) => v));
  // Keep a value the option list doesn't know (e.g. a magic sphere recorded
  // in a combat column) instead of silently blanking it.
  if (value && !pairs.some(([v]) => String(v) === String(value))) {
    pairs.push([value, `${value} *`]);
  }
  const opts = (blank === null ? pairs : [['', blank], ...pairs])
    .map(([v, label]) => `<option value="${esc(v)}"${abAttr(ab, v)}${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  return `<select data-set="${path}" data-kind="text"${abAttr(ab, value)}>${opts}</select>`;
}

/** Ability-stat picker, used by the AC / attack / save stat slots. */
export function abilitySelect(path, value) {
  return select(path, value, ABILITY_LABELS_LIST.map((label) => [label, label]));
}

/**
 * A label and its control, side by side -- the shape most of the sheet is.
 *
 * `extra` is for the field that does not fit the grid it is in: a URL is not
 * the same shape of thing as a hero-point count, and sharing a 140px track
 * with one left it showing a sixth of what it held.
 */
export function field(label, control, extra = '') {
  return `<label class="fld${extra ? ` ${extra}` : ''}"><span>${esc(label)}</span>${control}</label>`;
}
