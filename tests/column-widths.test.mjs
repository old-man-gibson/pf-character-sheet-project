/** Tests for the hand-set column widths: keys, storage and re-application.
 *
 *  The module's DOM work is done through a handful of properties (`tHead`,
 *  `rows`, `cells`, `colSpan`, `classList`, `querySelectorAll`), so a small
 *  stand-in table is enough to exercise it here without a browser. The drag
 *  itself -- pointer events and `getBoundingClientRect` -- is not covered.
 *
 *  Run: node tests/column-widths.test.mjs */
import {
  COLUMN_WIDTHS_KEY, MIN_COLUMN, readColumnWidths, writeColumnWidths,
  headerRow, columnCount, headingLabels, tableKey, keyedTables,
  setWidths, clearWidths, applyColumnWidths,
} from '../app/js/ui/column-widths.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/* ---- a stand-in DOM, just wide enough ---- */
const el = (tag, props = {}) => {
  const node = {
    tagName: tag.toUpperCase(), style: {}, children: [], dataset: {},
    classList: Object.assign(new Set(), { contains(c) { return this.has(c); }, remove(c) { this.delete(c); } }), ownerDocument: null,
    append(...kids) { for (const k of kids) { k.parentElement = node; node.children.push(k); } },
    insertBefore(k, before) { k.parentElement = node; const i = node.children.indexOf(before); node.children.splice(i < 0 ? node.children.length : i, 0, k); },
    remove() { const p = node.parentElement; if (p) p.children.splice(p.children.indexOf(node), 1); },
    ...props,
  };
  node.ownerDocument = { createElement: (t) => el(t) };
  return node;
};
const cell = (text, colSpan = 1) => el('th', { textContent: text, colSpan });
const row = (...cells) => { const r = el('tr', { cells }); cells.forEach((c, i) => { c.parentElement = r; c.cellIndex = i; }); return r; };
function table(classes, headRows, bodyRows = [], cols = null) {
  const t = el('table');
  for (const c of classes) t.classList.add(c);
  const thead = headRows.length ? el('thead', { rows: headRows }) : null;
  t.tHead = thead;
  t.rows = [...headRows, ...bodyRows];
  if (cols) {
    const group = el('colgroup');
    group.append(...cols.map(() => el('col')));
    t.append(group);
  }
  if (thead) t.append(thead);
  t.querySelector = (sel) => {
    if (sel === ':scope > colgroup') return t.children.find((c) => c.tagName === 'COLGROUP') || null;
    if (sel === ':scope > colgroup[data-cs-cols]') return t.children.find((c) => c.tagName === 'COLGROUP' && c.dataset.csCols) || null;
    throw new Error(sel);
  };
  t.querySelectorAll = (sel) => {
    if (sel === ':scope > colgroup') return t.children.filter((c) => c.tagName === 'COLGROUP');
    if (sel === ':scope > colgroup > col') return t.children.filter((c) => c.tagName === 'COLGROUP').flatMap((g) => g.children);
    throw new Error(sel);
  };
  return t;
}
const root = (...tables) => ({ querySelectorAll: (sel) => (sel === 'table' ? tables : []) });
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

console.log('storage');
{
  const store = memory();
  check('empty to start', readColumnWidths(store), {});
  writeColumnWidths({ 'a#0:x|y': [40, 60] }, store);
  check('round trip', readColumnWidths(store), { 'a#0:x|y': [40, 60] });
  writeColumnWidths({}, store);
  check('an empty map clears the key', store.getItem(COLUMN_WIDTHS_KEY), null);
  store.setItem(COLUMN_WIDTHS_KEY, '[1,2]');
  check('a list is not a map', readColumnWidths(store), {});
  store.setItem(COLUMN_WIDTHS_KEY, 'not json');
  check('garbage reads as empty', readColumnWidths(store), {});
  check('no storage at all', readColumnWidths(null), {});
  store.setItem('cs-column-widths', '{"old":[1]}');
  readColumnWidths(store);
  check('the old key is dropped on read', store.getItem('cs-column-widths'), null);
}

console.log('keys');
{
  const band = row(cell('Group', 2), cell('More', 2));
  const names = row(cell(' Talent '), cell('Sphere\n  x'), cell('Notes'), cell(''));
  const t = table(['build', 'stacked'], [band, names]);
  check('the last heading row is the header', headerRow(t) === names, true);
  check('columns are counted by span', columnCount(band), 4);
  check('labels are collapsed', headingLabels(names), ['Talent', 'Sphere x', 'Notes', '']);
  check('key ignores stacked and sorts classes', tableKey(t), 'build#0:Talent|Sphere x|Notes|');
  const headless = table(['ledger'], [], [row(cell('Date'), cell('Amount'))]);
  check('no thead: first row stands in', headingLabels(headerRow(headless)), ['Date', 'Amount']);
  const twin = table(['build'], [row(cell('Talent'), cell('Sphere'), cell('Notes'), cell(''))]);
  const keyed = keyedTables(root(t, twin, headless));
  check('same shape twice gets an ordinal', keyed.map((k) => k.key),
    ['build#0:Talent|Sphere x|Notes|', 'build#0:Talent|Sphere|Notes|', 'ledger#0:Date|Amount']);
  const own = table(['featgrid'], [row(cell('Lvl'), cell('Features'))]);
  own.dataset.colresize = 'off';
  check('a table that sizes itself is not keyed', keyedTables(root(own, twin)).length, 1);
  const twin2 = table(['build'], [row(cell('Talent'), cell('Sphere'), cell('Notes'), cell(''))]);
  check('a true twin is #1', keyedTables(root(twin, twin2))[1].key, 'build#1:Talent|Sphere|Notes|');
}

console.log('widths');
{
  const t = table(['talents'], [row(cell('A'), cell('B'), cell('C'))]);
  setWidths(t, [50, 70, 90]);
  const cols = t.querySelectorAll(':scope > colgroup > col');
  check('a colgroup is made when missing', cols.length, 3);
  check('each column gets its width', cols.map((c) => c.style.width), ['50px', '70px', '90px']);
  check('the table is their sum, fixed', [t.style.width, t.style.tableLayout, t.style.minWidth], ['210px', 'fixed', '0']);
  check('the made colgroup is marked', t.querySelector(':scope > colgroup').dataset.csCols, '1');
  check('the table is marked as hand-sized', t.classList.has('colsized'), true);
  clearWidths(t);
  check('clearing removes the made colgroup', t.querySelectorAll(':scope > colgroup > col').length, 0);
  check('clearing takes the inline styles off', [t.style.width, t.style.tableLayout, t.style.minWidth], ['', '', '']);
  const inline = table(['featgrid'], [row(cell('Lvl'), cell('Features'))]);
  inline.style.width = '640px';
  setWidths(inline, [46, 300]);
  check('a width the table came with is overridden', inline.style.width, '346px');
  clearWidths(inline);
  check('…and comes back when cleared', inline.style.width, '640px');
  check('clearing takes the mark off', t.classList.has('colsized'), false);

  const own = table(['classes'], [row(cell('A'), cell('B'), cell('C'))], [], ['a', 'b']);
  setWidths(own, [10, 20, 30]);
  const ownCols = own.querySelectorAll(':scope > colgroup > col');
  check('a short colgroup of the table\'s own is topped up', ownCols.length, 3);
  clearWidths(own);
  check('the table\'s own colgroup stays', own.querySelectorAll(':scope > colgroup > col').length, 3);
  check('…with its widths cleared', ownCols.map((c) => c.style.width), ['', '', '']);
}

console.log('apply');
{
  const a = table(['talents'], [row(cell('A'), cell('B'))]);
  const b = table(['talents', 'stacked'], [row(cell('C'), cell('D'))]);
  const c = table(['talents'], [row(cell('E'), cell('F'), cell('G'))]);
  const map = {
    'talents#0:A|B': [40, 60],
    'talents#0:C|D': [30, 30],
    'talents#0:E|F|G': [1, 2],          // the wrong count: a column was added since
  };
  applyColumnWidths(root(a, b, c), map, { stacked: true });
  check('a matching table is sized', a.style.width, '100px');
  check('a stacked table is left alone', b.style.width, undefined);
  check('a shape that moved on is left alone', c.style.width, undefined);
  applyColumnWidths(root(b), map, { stacked: false });
  check('the same table is sized when not stacked', b.style.width, '60px');
  check('MIN_COLUMN is a sane floor', MIN_COLUMN >= 20 && MIN_COLUMN <= 40, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
