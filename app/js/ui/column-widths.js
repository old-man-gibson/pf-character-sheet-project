/**
 * Column widths a player sets by hand, and keeps.
 *
 * Every table on the sheet divides its width by its own rule -- a percentage
 * here, a `<col>` in rem there -- and none of them can know that this player's
 * talent names run long or that their notes column is where the reading is.
 * So the edge between two column headings can be dragged, like a spreadsheet's,
 * and the widths that come of it are remembered per browser and put back after
 * every render (a render rewrites the whole shadow root, so anything that is
 * not re-applied is lost the next time a number changes).
 *
 * Only the dragged column moves. The others are frozen at their current pixel
 * widths the moment a drag starts and the table is told to be exactly their
 * sum, so widening one column widens the table -- which then scrolls inside
 * its `.tablewrap` -- rather than crushing its neighbours to make room. That
 * is what "make this column wider" means to the person doing it.
 *
 * A table is known by its classes and its column headings rather than by
 * anything it might carry in a `data-` attribute: the panels are string
 * builders that know nothing of this, and the same table rendered on the next
 * tab visit has the same headings. Two tables on one tab with the same
 * headings (a talent table per sphere, say) are told apart by their order.
 *
 * No DOM at module level: the key derivation and the storage are plain
 * functions so they can be exercised in Node.
 */

export const COLUMN_WIDTHS_KEY = 'cs-column-widths-2';
/** The first key's widths were set by presses on heading controls, not by anyone's hand; they go. */
const STALE_KEY = 'cs-column-widths';
/** Narrower than this and a heading is a smear; the drag stops here. */
export const MIN_COLUMN = 36;
/**
 * A table that sizes its own columns -- the class-feature grid has a drag
 * handle of its own and keeps its widths in the character -- says so with
 * `data-colresize="off"`, and is left entirely alone here.
 */
const optedOut = (table) => table.dataset?.colresize === 'off';
/** A press on one of these is a press on it, however close to the cell's edge. */
const CONTROLS = 'button, select, input, textarea, label, a, summary, [contenteditable]';
/** How close to a heading's edge counts as taking hold of it, in px. */
const EDGE = 7;

export function readColumnWidths(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STALE_KEY);
    const raw = JSON.parse(storage?.getItem(COLUMN_WIDTHS_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

export function writeColumnWidths(map, storage = globalThis.localStorage) {
  try {
    if (Object.keys(map).length) storage?.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(map));
    else storage?.removeItem(COLUMN_WIDTHS_KEY);
  } catch { /* an embed with storage blocked keeps the widths for the session only */ }
}

/**
 * The row whose cells stand over the columns: the last heading row (a
 * `table.build` has a group band above its column names), or the first row of
 * a table with no heading block at all.
 */
export function headerRow(table) {
  const head = table.tHead;
  if (head && head.rows.length) return head.rows[head.rows.length - 1];
  return table.rows[0] || null;
}

/** How many columns the table has, counted the way the browser does: by span. */
export function columnCount(row) {
  let n = 0;
  for (const cell of row?.cells || []) n += cell.colSpan || 1;
  return n;
}

/** The text of every heading, for the key. Whitespace collapsed, buttons and all. */
export function headingLabels(row) {
  return Array.from(row?.cells || [], (c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
}

/**
 * What one table is called in storage.
 *
 * `ordinal` is its place among the tables in the same root that would
 * otherwise share a key; the caller counts them in document order.
 */
export function tableKey(table, ordinal = 0) {
  const classes = Array.from(table.classList || []).filter((c) => c !== 'stacked').sort().join('.');
  const labels = headingLabels(headerRow(table)).join('|');
  return `${classes}#${ordinal}:${labels}`;
}

/** Every table under `root`, each with its key, in document order. */
export function keyedTables(root) {
  const seen = new Map();
  const out = [];
  for (const table of root.querySelectorAll('table')) {
    if (optedOut(table)) continue;
    const base = tableKey(table);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.push({ table, key: n ? tableKey(table, n) : base });
  }
  return out;
}

/** The `<col>` elements standing for the first `n` columns, made if missing. */
function colsFor(table, n) {
  const doc = table.ownerDocument;
  let group = table.querySelector(':scope > colgroup');
  if (!group) {
    group = doc.createElement('colgroup');
    group.dataset.csCols = '1';
    table.insertBefore(group, table.firstChild);
  }
  const cols = Array.from(table.querySelectorAll(':scope > colgroup > col'));
  let last = group;
  const groups = table.querySelectorAll(':scope > colgroup');
  if (groups.length) last = groups[groups.length - 1];
  while (cols.length < n) {
    const col = doc.createElement('col');
    last.append(col);
    cols.push(col);
  }
  return cols.slice(0, n);
}

/** Put a list of pixel widths on a table: one per column, and the table their sum. */
export function setWidths(table, widths) {
  const cols = colsFor(table, widths.length);
  let sum = 0;
  widths.forEach((w, i) => { cols[i].style.width = `${w}px`; sum += w; });
  // A table that came with a width of its own (the feature grid says its
  // sum inline) gets it back when the hand-set widths are cleared.
  if (table.dataset.csWidth0 === undefined) table.dataset.csWidth0 = table.style.width || '';
  table.style.tableLayout = 'fixed';
  table.style.width = `${sum}px`;
  table.style.minWidth = '0';
  // The stylesheet lets a formula field shrink with its column only once the
  // column is the player's own; see `td > .xf` in sheet.css.
  table.classList.add('colsized');
}

/** Take the hand-set widths off again; the stylesheet's own rules come back. */
export function clearWidths(table) {
  for (const col of table.querySelectorAll(':scope > colgroup > col')) col.style.width = '';
  const made = table.querySelector(':scope > colgroup[data-cs-cols]');
  if (made) made.remove();
  table.style.tableLayout = '';
  table.style.width = table.dataset.csWidth0 || '';
  table.style.minWidth = '';
  delete table.dataset.csWidth0;
  table.classList.remove('colsized');
}

/**
 * The columns' widths as the browser has them now, in px, one per column.
 *
 * Exactly as they are -- not rounded, not raised to the floor. These become
 * the table's width the moment a drag starts, and a grip column of 18px
 * raised to the floor, or fifteen columns each rounded up, made the table a
 * few pixels wider than its box on every press: it grew a scrollbar before
 * anything had been dragged. The floor is for the column being dragged.
 */
function measuredWidths(row) {
  const widths = [];
  for (const cell of row.cells) {
    const span = cell.colSpan || 1;
    const w = cell.getBoundingClientRect().width / span;
    for (let i = 0; i < span; i += 1) widths.push(Math.round(w * 100) / 100);
  }
  return widths;
}

/**
 * Put the remembered widths back on every table under `root` whose shape
 * still matches. Called after each render. A stacked table -- one folded into
 * cards for a narrow screen -- has no columns to be wide, and is left alone.
 */
export function applyColumnWidths(root, map, { stacked = false } = {}) {
  for (const { table, key } of keyedTables(root)) {
    const widths = map[key];
    if (!Array.isArray(widths)) continue;
    if (stacked && table.classList.contains('stacked')) continue;
    if (widths.length !== columnCount(headerRow(table))) continue;
    setWidths(table, widths);
  }
}

/**
 * Which heading cell's edge the pointer is on, if any.
 *
 * The right edge of a cell, or the left edge of the one after it: both mean
 * the border between the two, and both resize the column on the left. A cell
 * that spans several columns has no one column to resize and is skipped.
 */
function edgeAt(root, x, y) {
  const el = root.elementFromPoint?.(x, y);
  const cell = el?.closest?.('th, td');
  if (!cell) return null;
  // The feature grid's headings are made of controls -- a × that deletes the
  // column, a menu, a level-rule button -- and the × sits on the cell's edge.
  // A press on a control is a press on the control.
  if (el.closest(CONTROLS)) return null;
  const row = cell.parentElement;
  const table = row?.closest('table');
  if (!table || optedOut(table) || headerRow(table) !== row) return null;
  const rect = cell.getBoundingClientRect();
  let target = null;
  if (rect.right - x <= EDGE) target = cell;
  else if (x - rect.left <= EDGE && cell.cellIndex > 0) target = row.cells[cell.cellIndex - 1];
  if (!target || (target.colSpan || 1) !== 1) return null;
  return { cell: target, row, table };
}

/** The column index a heading cell stands over -- spans before it count. */
function columnIndex(cell) {
  let n = 0;
  for (const c of cell.parentElement.cells) {
    if (c === cell) return n;
    n += c.colSpan || 1;
  }
  return n;
}

/**
 * Wire dragging up on a root (the sheet's shadow root). Returns the function
 * that takes the listeners off again.
 *
 * `read()` gives the current map and `write(map)` keeps it; the caller owns
 * the storage so a drag on one tab and the re-apply on the next agree.
 */
export function bindColumnResize(root, { read, write }) {
  let hot = null;     // the heading cell whose edge the pointer is resting on
  let drag = null;    // the drag in progress, if one is
  const win = root.ownerDocument?.defaultView || globalThis;

  const unhot = () => { if (hot) hot.classList.remove('colgrip'); hot = null; };

  /*
   * A drag ends on release -- and on anything that could have swallowed the
   * release. The pointer-up is listened for on the window rather than the
   * root, because a button let go over the page header never reaches the
   * sheet; a render in the middle of a drag (a tracker ticking over) replaces
   * the captured heading cell, and with it any chance of that cell reporting
   * the release; and a move with no button held is a release that was missed
   * however it happened. Without all three a drag once stuck was stuck for
   * good, and every pass of the pointer over the sheet resized the column.
   */
  const finish = () => {
    if (!drag) return;
    const { table, key, widths, w0, col, had } = drag;
    drag = null;
    table.classList.remove('colresizing');
    // A click on an edge that never moved is not a decision about widths:
    // a table that was sizing itself goes on doing so.
    if (widths[col] === w0 && !had) { clearWidths(table); return; }
    if (key) write({ ...read(), [key]: widths });
  };

  const onMove = (e) => {
    if (drag) {
      if (e.buttons === 0 || !drag.table.isConnected) { finish(); return; }
      const dx = e.clientX - drag.x0;
      drag.widths[drag.col] = Math.max(MIN_COLUMN, Math.round(drag.w0 + dx));
      setWidths(drag.table, drag.widths);
      return;
    }
    if (e.pointerType === 'touch') return;
    const at = edgeAt(root, e.clientX, e.clientY);
    if (at?.cell === hot) return;
    unhot();
    if (at) { hot = at.cell; hot.classList.add('colgrip'); }
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    const at = edgeAt(root, e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    const widths = measuredWidths(at.row);
    const col = columnIndex(at.cell);
    // The key is taken now: by the time the drag ends the table may have
    // been rendered away, and the widths still deserve keeping.
    const key = keyedTables(root).find((t) => t.table === at.table)?.key || null;
    const had = Boolean(key && read()[key]);
    drag = { table: at.table, key, had, col, widths, x0: e.clientX, w0: widths[col] };
    at.table.classList.add('colresizing');
    setWidths(at.table, widths);
    try { at.cell.setPointerCapture(e.pointerId); } catch { /* not a pointer that captures */ }
  };

  // A double-click on the edge lets the table go back to sizing itself.
  const onDouble = (e) => {
    const at = edgeAt(root, e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    clearWidths(at.table);
    const entry = keyedTables(root).find((t) => t.table === at.table);
    if (!entry) return;
    const map = read();
    delete map[entry.key];
    write(map);
  };

  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('dblclick', onDouble);
  win.addEventListener('pointerup', finish, true);
  win.addEventListener('pointercancel', finish, true);
  win.addEventListener('blur', finish);
  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('dblclick', onDouble);
    win.removeEventListener('pointerup', finish, true);
    win.removeEventListener('pointercancel', finish, true);
    win.removeEventListener('blur', finish);
    finish();
    unhot();
  };
}
