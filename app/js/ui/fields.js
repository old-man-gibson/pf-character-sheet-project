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
import { isPinned, numOrNull } from '../model/util.js';

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

/**
 * A number that may be left blank: "a number, or blank to work it out".
 *
 * Every box of that kind on the sheet is this one control. It writes back a
 * number or nothing (`number-or-null`, read by the element's `readControl`),
 * and what it draws into the box is coerced the same way. A document edited
 * by hand can hold a string where a number belongs, and a box that printed
 * the stored value as it stood let that string into the page as markup. So
 * anything that is not a finite number is drawn as blank.
 *
 * `binding` is the attribute that addresses the value, `data-set="…"` for a
 * path or `data-item="…"` for a cell of a row, the way `rows.exprField`
 * takes it. `auto` gives the box the dashed "worked out" look while it is
 * blank. `extra` is trusted markup (min, max, disabled), never document text.
 */
export function autoNum(binding, value, {
  placeholder = '', title = '', label = '', width = '', auto = false, extra = '',
} = {}) {
  const n = numOrNull(value);
  const shown = n === null ? '' : String(n);
  const look = auto ? ` class="autonum${shown === '' ? ' auto' : ''}"` : '';
  return `<input type="number"${look} value="${shown}" ${binding} data-kind="number-or-null"${
    placeholder === '' || placeholder == null ? '' : ` placeholder="${esc(placeholder)}"`}${
    width ? ` style="width:${width}"` : ''}${title ? ` title="${esc(title)}"` : ''}${
    label ? ` aria-label="${esc(label)}"` : ''}${extra ? ` ${extra}` : ''}>`;
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

/**
 * A dropdown bound to a path. `blank: null` for a choice that must be made --
 * no empty option at all. `attrs` is trusted markup for anything else the
 * select carries (a label, a second binding), never document text.
 */
export function select(path, value, options, blank = '—', { attrs = '' } = {}) {
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
  return `<select data-set="${path}" data-kind="text"${abAttr(ab, value)}${attrs ? ` ${attrs}` : ''}>${opts}</select>`;
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

/**
 * A box that pins a class's level, or follows the Planner when blank: the
 * Planner's count is its placeholder and its tooltip. Vancian caster level
 * and Psionic manifester level are both one.
 */
export function levelPin(path, override, planner, { width = '' } = {}) {
  return autoNum(`data-set="${path}"`, override, {
    placeholder: planner ?? 0,
    width,
    title: `Auto: ${planner ?? 0} level(s) of this class in the Planner. Enter a number to pin it.`,
  });
}

/** The note under a pinned level that the Planner now counts differently, or ''. */
export function levelPinHint(override, base, planner) {
  if (!isPinned(override) || Number(base) === Number(planner)) return '';
  return `<p class="hint">The Planner gives ${planner} level${planner === 1 ? '' : 's'} of this class.</p>`;
}
