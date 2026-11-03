/**
 * sheet-reader.js -- a cursor over one imported worksheet grid.
 *
 * Every sub-system that reads a workbook tab reads it through this. It lived
 * in document.js, which made each of those modules import the whole document
 * reader, and the document reader import them back.
 */

/**
 * A cursor over one imported worksheet grid.
 *
 * The three sub-system tabs below are all read the same way: find a label,
 * take the value that follows it, and remember which cells were consumed so
 * whatever no label claimed can be kept verbatim. Addresses are never
 * hard-coded -- a character's Akashic tab may carry a veil slot the others do
 * not, and Narockro's Maneuvers tab runs a row longer, and both fall out of the
 * same scan.
 */
export function sheetReader(tab) {
  const rows = (tab?.rows || []).map((r) => [...(r.cells || [])]);
  const used = new Set();

  const at = (ri, ci) => (rows[ri] ? rows[ri][ci] ?? null : null);
  const text = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const mark = (ri, ci) => used.add(`${ri}:${ci}`);
  const isUsed = (ri, ci) => used.has(`${ri}:${ci}`);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && text(v) !== '' ? n : 0;
  };

  /**
   * The first value to the right of a label, skipping the blanks a merged
   * cell leaves behind. "Veilweaving Base DC" spans two columns and its value
   * sits in the third; "Essence Cap" has its value immediately beside it.
   */
  const rightOf = (ri, ci, span = 3) => {
    for (let n = 1; n <= span; n++) {
      if (text(at(ri, ci + n)) !== '') {
        mark(ri, ci);
        mark(ri, ci + n);
        return at(ri, ci + n);
      }
    }
    mark(ri, ci);
    return null;
  };

  /** Every cell whose trimmed text equals `label`, as [row, col] pairs. */
  const findAll = (label) => {
    const hits = [];
    rows.forEach((cells, ri) => cells.forEach((v, ci) => {
      if (typeof v === 'string' && v.trim() === label) hits.push([ri, ci]);
    }));
    return hits;
  };
  const find = (label) => findAll(label)[0] || null;

  /** Take a label anywhere on the sheet and return the value beside it. */
  const take = (label, span = 3) => {
    const hit = find(label);
    return hit ? rightOf(hit[0], hit[1], span) : null;
  };

  /** Cells matching a pattern, as [row, col, match] triples. */
  const scan = (re) => {
    const hits = [];
    rows.forEach((cells, ri) => cells.forEach((v, ci) => {
      if (typeof v !== 'string') return;
      const m = re.exec(v.trim());
      if (m) hits.push([ri, ci, m]);
    }));
    return hits;
  };

  /**
   * Mark a column that is nothing but a counter as consumed.
   *
   * The Vancian tab carries three columns holding the literal integers 1 to
   * 156 -- the row numbers a spreadsheet dropdown was built from. They are not
   * character data and must not survive into `sourceExtras`.
   */
  const dropCounterColumns = (minRun = 8) => {
    const width = Math.max(0, ...rows.map((r) => r.length));
    for (let ci = 0; ci < width; ci++) {
      const filled = [];
      for (let ri = 0; ri < rows.length; ri++) {
        // A cell some label already claimed does not count against the run: the
        // Psionics tab heads its counter with "Power Known", and one word at the
        // top was enough to leave all sixty numbers behind as residue.
        if (isUsed(ri, ci)) continue;
        const v = at(ri, ci);
        if (text(v) !== '') filled.push([ri, Number(v)]);
      }
      if (filled.length < minRun || filled.some(([, n]) => !Number.isInteger(n))) continue;
      const ascends = filled.every(([, n], i) => i === 0 || n === filled[i - 1][1] + 1);
      if (ascends) for (const [ri] of filled) mark(ri, ci);
    }
  };

  /**
   * Mark the Primordia technique panel as consumed: a "… Technique" heading
   * with "Level 1" just below it, the odd levels down to the first cell in
   * that column that is not one, and beside each level what it grants and
   * the note the sheet adds when the panel is the character's own technique.
   * It is the same fixed list on every sheet, so it is template furniture --
   * as is the character's technique written anywhere on the tab, which the
   * identity block already carries.
   */
  const skipTechniquePanel = (technique = '') => {
    for (const [ri, ci] of scan(/\bTechnique$/)) {
      const first = [1, 2].map((n) => text(at(ri + n, ci))).find(Boolean);
      if (!/^Level 1$/.test(first || '')) continue;
      mark(ri, ci);
      for (let r = ri + 1; r < rows.length; r++) {
        const cell = text(at(r, ci));
        if (!cell) continue;
        if (!/^Level \d+$/.test(cell)) break;
        for (let n = 0; n <= 3; n++) mark(r, ci + n);
      }
    }
    const own = text(technique);
    if (own) for (const [ri, ci] of findAll(own)) mark(ri, ci);
  };

  /** Whatever no label claimed, trimmed of the blank columns it all shares. */
  const extras = () => {
    const out = [];
    rows.forEach((cells, ri) => {
      const kept = cells.map((v, ci) => (used.has(`${ri}:${ci}`) ? null : v));
      while (kept.length && (kept[kept.length - 1] === null || kept[kept.length - 1] === '')) kept.pop();
      if (kept.some((v) => v !== null && v !== undefined && v !== '')) out.push({ cells: kept, row: ri });
    });
    const lead = Math.min(...out.map(({ cells }) => cells.findIndex((v) => v !== null && v !== '')), Infinity);
    if (Number.isFinite(lead) && lead > 0) for (const r of out) r.cells = r.cells.slice(lead);
    return out.map(({ cells }) => ({ cells }));
  };

  return {
    rows, at, text, num, mark, isUsed, rightOf, find, findAll, take, scan,
    dropCounterColumns, skipTechniquePanel, extras,
  };
}
