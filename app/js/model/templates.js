/**
 * Template features: reading the Template tab, and reordering what it holds.
 *
 * A template is a block of granted abilities -- a race, a curse, an acquired
 * template -- laid out as a table of groups and children on its own tab.
 */

import { sheetReader } from './document.js';
import { emit } from './events.js';
import { getPath } from './util.js';

/** The tab names the workbook uses; a sheet carries one or the other. */
export const TEMPLATE_TABS = ['Template', 'Copy of Template'];

/** A feature's type, as the sheet writes it. Blank is a legitimate answer. */
export const TEMPLATE_TYPES = ['Ex', 'Su', 'Sp'];

/**
 * The template's own geometry: every feature slot carries a "Type:" marker
 * three columns right of the name, with the type itself in the next cell over.
 */
const TEMPLATE_TYPE_LABEL = 'Type:';

const TEMPLATE_TYPE_OFFSET = 3;

/** "Omni-Cooking: Precise Preparation" is a sub-ability of "Omni-Cooking". */
const SUB_ABILITY = /^\s*[:–—]\s*\S/;

/**
 * The tab's rows back at their sheet positions.
 *
 * The converter keeps only rows that hold something and records each one's
 * number. Here the gaps matter -- a blank row is what separates one feature's
 * block from the next -- so they are put back before the scan runs.
 */
export function positionedRows(tab) {
  const rows = [];
  let next = 0;
  for (const row of tab?.rows || []) {
    const n = Number(row?.r);
    let at = Number.isFinite(n) && n > 0 ? n - 1 : next;
    // A row typed into the grid editor has no number of its own, and a tab
    // can carry both kinds at once. Such a row follows the one before it, and
    // never lands on top of a row already placed -- the alternative is one
    // row silently replacing another.
    while (rows[at]) at++;
    rows[at] = { cells: [...(row?.cells || [])] };
    next = at + 1;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = { cells: [] };
  return rows;
}

/**
 * One table inside a feature block.
 *
 * The header row is the first row of the run and its cells name the columns;
 * everything below is a row. The columns are whichever of the block's columns
 * the run actually uses, because the sheet's merged cells leave the ones
 * between them empty -- Bryva's spell-school table spans L, N, Q and T.
 *
 * Returns the last row consumed, so the caller can carry on beneath it.
 */
function readTemplateTable(g, feature, top, filled, starts) {
  const { at, text, mark } = g;
  let last = top;
  for (let ri = top + 1; ri < g.rows.length; ri++) {
    if (starts(ri) || !filled(ri).length) break;
    last = ri;
  }
  const cols = new Set();
  for (let ri = top; ri <= last; ri++) for (const ci of filled(ri)) cols.add(ci);
  const at_ = [...cols].sort((a, b) => a - b);
  const row = (ri) => at_.map((ci) => {
    mark(ri, ci);
    return at(ri, ci);
  });

  const table = { caption: '', columns: row(top).map((v) => text(v)), rows: [] };
  for (let ri = top + 1; ri <= last; ri++) table.rows.push({ cells: row(ri) });
  feature.tables.push(table);
  return last;
}

/**
 * Gather the flat list of features into groups and their sub-abilities.
 *
 * The sheet has no nesting of its own -- a sub-ability is written as
 * "<parent>: <name>" in the column below its parent, which is how
 * Omni-Cooking's four blocks read. The longest matching parent wins, so a
 * group whose own name starts with another group's still collects its own.
 */
function groupTemplateFeatures(flat) {
  const groups = [];
  for (const f of flat) {
    const parent = groups
      .filter((p) => p.name && f.name.startsWith(p.name)
        && SUB_ABILITY.test(f.name.slice(p.name.length)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (parent) parent.children.push({ name: f.name, type: f.type, text: f.text, tables: f.tables });
    else groups.push(f);
  }
  return groups;
}

/**
 * What the scan could not place, kept rather than dropped.
 *
 * A template laid out in a shape this does not understand still has to arrive
 * whole, so its cells land in one group at the end of the template as a table
 * the player can read and cut up. Nothing treats it specially afterwards:
 * rename it, retype it, drag it, give it sub-abilities, or delete it once its
 * contents have found homes.
 */
function temporaryTemplateGroup(rows) {
  const width = Math.max(1, ...rows.map((r) => (r.cells || []).length));
  // A column the sheet left empty between two it used is spacing, not data, and
  // an empty column of a table is only width. The order of what is left is the
  // order it was written in, so the block still reads as it did on the tab.
  const cols = [];
  for (let ci = 0; ci < width; ci++) {
    if (rows.some((r) => (r.cells || [])[ci] !== null && (r.cells || [])[ci] !== undefined
      && String((r.cells || [])[ci]).trim() !== '')) cols.push(ci);
  }
  return {
    name: 'Temporary',
    type: null,
    temporary: true,
    text: '',
    tables: [{
      caption: 'Cells the import could not place',
      columns: cols.map(() => ''),
      rows: rows.map((r) => ({ cells: cols.map((ci) => (r.cells || [])[ci] ?? null) })),
    }],
    children: [],
  };
}

/* ------------------------------------------------------------------ *
 * Wealth: the wallet, in mana.
 *
 * The campaign's currency is mana. The workbook's wallet block (Character
 * Info, beside the mythic path) records the balance after the last Oath of
 * Offerings, whether the character keeps the Oath and casts materially, when
 * the last offering was made, the mana earned a day and the mana earned in
 * sessions since ("Sessions" on the sheet is that sum, not a count),
 * and the current balance -- and derives what the next offering will come to
 * and what is left after it. That derivation, from the most recent sheet
 * (Saburo's), with the two switches the earlier one (Narockro's) had:
 *
 *   OoO/Day          = Mana/Day / 2
 *   expected, oath   = days since the last offering x OoO/Day + floor(session mana / 2)
 *                      -- half of everything earned, the daily income and the rewards alike
 *   expected, casting = whole months since the last offering x 30
 *   expected         = the parts whose switch is on
 *   Mana After       = current - expected
 *
 * `ledger` is the hook for what comes later: every reward, spend and offering
 * is a line with a date, a label and an amount, and `current` moves with it.
 * A session reward is a line of kind "session" that also adds to the session
 * mana the oath takes half of.
 * ------------------------------------------------------------------ */

/**
 * Read the workbook's Template tab into the groups this tab now edits.
 *
 * The template lays a feature out as a name with a "Type:" marker three
 * columns to its right and its description in the rows below, and repeats that
 * down as many columns as the player added -- Bryva's second column of
 * features sits at L because that is where she put it. So the columns are
 * found by that marker rather than by address, and everything from one feature
 * to the next belongs to it: further rows are more description, and a run of
 * rows using more than one column is a table.
 */
export function importTemplateTab(tab, tabName) {
  const g = sheetReader({ rows: positionedRows(tab) });
  const { at, text, mark, isUsed } = g;

  // The link rows are the tab's own header: a label, the link beside it and
  // the instructions the workbook prints further along, identical on every
  // sheet. The whole row is consumed rather than left over as a stray.
  const links = { link: null, approvalLink: null };
  for (const [label, key] of [['Template Link', 'link'], ['Approval Link', 'approvalLink']]) {
    const hit = g.find(label);
    if (!hit) continue;
    const [ri, ci] = hit;
    links[key] = text(at(ri, ci + 1)) || null;
    (g.rows[ri] || []).forEach((_, c) => mark(ri, c));
  }

  // A "Type:" marker means a feature slot, filled in or not, so the empty ones
  // an untouched template carries are consumed here and import as nothing.
  const cols = new Set();
  for (const [ri, ci] of g.findAll(TEMPLATE_TYPE_LABEL)) {
    if (ci >= TEMPLATE_TYPE_OFFSET) cols.add(ci - TEMPLATE_TYPE_OFFSET);
    mark(ri, ci);
    mark(ri, ci + 1);
  }
  const columns = [...cols].sort((a, b) => a - b);
  const width = Math.max(0, ...g.rows.map((r) => r.length));

  const flat = [];
  columns.forEach((col, n) => {
    // A column's block runs to the next feature column, or to the far edge.
    const end = n + 1 < columns.length ? columns[n + 1] - 1 : Math.max(width - 1, col);
    const filled = (ri) => {
      const out = [];
      for (let ci = col; ci <= end; ci++) {
        if (!isUsed(ri, ci) && text(at(ri, ci)) !== '') out.push(ci);
      }
      return out;
    };
    const starts = (ri) => text(at(ri, col)) !== ''
      && text(at(ri, col + TEMPLATE_TYPE_OFFSET)) === TEMPLATE_TYPE_LABEL;

    let feature = null;
    let blank = true;
    for (let ri = 0; ri < g.rows.length; ri++) {
      const cells = filled(ri);
      // A typed slot always starts a feature; so does a lone heading after a
      // blank row, which is how a feature written without one reads.
      if (starts(ri) || (blank && cells.length === 1 && cells[0] === col)) {
        feature = {
          name: text(at(ri, col)),
          type: text(at(ri, col + TEMPLATE_TYPE_OFFSET + 1)) || null,
          text: '',
          tables: [],
          children: [],
        };
        flat.push(feature);
        mark(ri, col);
        blank = false;
        continue;
      }
      if (!cells.length) { blank = true; continue; }
      blank = false;
      if (feature && cells.length === 1 && cells[0] === col) {
        const line = text(at(ri, col));
        feature.text = feature.text ? `${feature.text}\n${line}` : line;
        mark(ri, col);
        continue;
      }
      // More than one column: a table, which belongs to the feature it sits
      // under. With no feature above it there is nothing to attach it to, so
      // it is left unclaimed and lands in the Temporary group instead.
      if (cells.length > 1 && feature) ri = readTemplateTable(g, feature, ri, filled, starts);
    }
  });

  const features = groupTemplateFeatures(flat);
  const extras = g.extras();
  if (extras.length) features.push(temporaryTemplateGroup(extras));

  if (!features.length && !links.link && !links.approvalLink) return null;
  return { tab: tabName, name: tabName, ...links, features };
}

/** One table, in the shape the editor addresses: a header row and rows. */
function templateTable(t = {}) {
  const columns = (Array.isArray(t.columns) ? t.columns : []).map((c) => (c ?? ''));
  const width = Math.max(columns.length,
    ...(Array.isArray(t.rows) ? t.rows : []).map((r) => (r?.cells || []).length), 1);
  while (columns.length < width) columns.push('');
  return {
    caption: String(t.caption ?? ''),
    columns,
    rows: (Array.isArray(t.rows) ? t.rows : []).map((r) => {
      const cells = [...(r?.cells || [])];
      while (cells.length < width) cells.push(null);
      return { cells };
    }),
  };
}

/** One feature or sub-ability, with the fields the editor expects present. */
export function templateEntry(f = {}, nested = false) {
  const entry = {
    name: String(f.name ?? ''),
    type: f.type ?? null,
    text: String(f.text ?? ''),
    tables: (Array.isArray(f.tables) ? f.tables : []).map(templateTable),
  };
  if (f.temporary) entry.temporary = true;
  if (!nested) {
    entry.children = (Array.isArray(f.children) ? f.children : [])
      .map((c) => templateEntry(c, true));
  }
  return entry;
}

/**
 * Reorder a template's groups.
 *
 * `to` is the position the group should end up at, counted before the move,
 * which is what a drop between two cards means.
 */
export function moveTemplateGroup(model, ti, from, to) {
  const groups = model.data.templates?.[ti]?.features;
  if (!Array.isArray(groups) || !groups[from]) return model;
  const target = Math.max(0, Math.min(groups.length - 1, to > from ? to - 1 : to));
  const [item] = groups.splice(from, 1);
  groups.splice(target, 0, item);
  model.recompute();
  emit(model, { type: 'template-move', ti, from, to: target });
  return model;
}

/**
 * Move a sub-ability, within its group or into another one.
 *
 * A sub-ability belongs to a group, so a destination is a group and a
 * position inside it: there is no position here that would put one above the
 * feature it hangs off, which is the whole point of the group.
 */
export function moveTemplateChild(model, ti, fromGroup, fromIndex, toGroup, toIndex) {
  const groups = model.data.templates?.[ti]?.features;
  const src = groups?.[fromGroup];
  const dst = groups?.[toGroup];
  if (!src || !dst || !Array.isArray(src.children) || !src.children[fromIndex]) return model;
  if (!Array.isArray(dst.children)) dst.children = [];
  const shift = src === dst && toIndex > fromIndex ? 1 : 0;
  const [item] = src.children.splice(fromIndex, 1);
  dst.children.splice(Math.max(0, Math.min(dst.children.length, toIndex - shift)), 0, item);
  model.recompute();
  emit(model, { type: 'template-move', ti, fromGroup, fromIndex, toGroup });
  return model;
}

/**
 * ↑ / ↓ on a sub-ability, spilling into the neighbouring group at either
 * end -- the same moves the drag offers, for anyone not using a mouse.
 */
export function nudgeTemplateChild(model, ti, gi, ci, delta) {
  const groups = model.data.templates?.[ti]?.features || [];
  const children = groups[gi]?.children || [];
  const to = ci + delta;
  if (to >= 0 && to < children.length) return model.moveTemplateChild(ti, gi, ci, gi, to);
  const nextGroup = gi + delta;
  if (nextGroup < 0 || nextGroup >= groups.length) return model;
  const landing = delta < 0 ? (groups[nextGroup].children || []).length : 0;
  return model.moveTemplateChild(ti, gi, ci, nextGroup, landing);
}

/**
 * Move a table from one feature to another.
 *
 * Where a table is drawn says which feature it is under, and on a spreadsheet
 * that is not always what it means: Bryva's spell-school table sits in the
 * right-hand column beside Temporal Haze but belongs to Omni-Cooking. The
 * import puts a table where it was written rather than guessing, and this is
 * how it gets where it should be -- without retyping eighty cells.
 *
 * `fromPath` and `toPath` address the features, not the tables.
 */
export function moveTemplateTable(model, fromPath, index, toPath) {
  const from = getPath(model.data, fromPath);
  const to = getPath(model.data, toPath);
  if (!from || !to || fromPath === toPath) return model;
  if (!Array.isArray(from.tables) || !from.tables[index]) return model;
  if (!Array.isArray(to.tables)) to.tables = [];
  to.tables.push(from.tables.splice(index, 1)[0]);
  model.recompute();
  emit(model, { type: 'template-table-move', fromPath, toPath });
  return model;
}

/** Add a column to a template table, keeping every row the same width. */
export function addTemplateTableColumn(model, path, label = '') {
  const table = getPath(model.data, path);
  if (!table) return model;
  table.columns = [...(table.columns || []), label];
  for (const row of table.rows || []) {
    row.cells = [...(row.cells || [])];
    while (row.cells.length < table.columns.length) row.cells.push(null);
  }
  model.recompute();
  emit(model, { type: 'set', path: `${path}.columns`, value: table.columns });
  return model;
}

/** Remove a column and the cell under it in every row. */
export function removeTemplateTableColumn(model, path, index) {
  const table = getPath(model.data, path);
  if (!table || !Array.isArray(table.columns) || index < 0) return model;
  table.columns.splice(index, 1);
  for (const row of table.rows || []) (row.cells || []).splice(index, 1);
  model.recompute();
  emit(model, { type: 'set', path: `${path}.columns`, value: table.columns });
  return model;
}
