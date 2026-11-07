/**
 * pdf-import.js -- a PDF, as an outline the paste reader can be fed.
 *
 * A group's own material is often a PDF -- a homebrew document, a campaign
 * handout, house rules laid out to look like a book -- and it is the worst
 * form to read: it has no headings, no paragraphs and no columns, only pieces of text
 * with a position, a size and a font. What it does have is *consistency* --
 * a layout sets every talent's name in one style and every section's in
 * another -- and that is enough to get back an outline: sections, the entries
 * under each, and each entry's text in reading order.
 *
 * It is not enough to say what an entry **is**. "Iron Grip (stance)" and
 * "Craft Wondrous Trinket (item creation)" are set identically; one is a
 * talent and one is a feat, and only the section they stand in says which --
 * in words no two documents share. So this stops at the outline, and the
 * extension manager asks the one question a person answers at a glance: what
 * is each section? From there the text goes to `parsePaste`, which stays the
 * only reader.
 *
 * Two halves, deliberately. `readPdf` touches pdf.js and the browser and does
 * nothing clever; `outlineOf` and `sectionText` are pure and run in Node, so
 * the part with judgement in it is the part with tests.
 *
 * Nothing leaves the page: the file is read here, by a library served with
 * the app (`app/vendor/pdfjs`), loaded only when somebody chooses a PDF.
 */

import { minLevelIn, splitAbilityType } from './extensions.js';

const PDFJS = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/**
 * Every page's text items: `{ str, x, y, w, size, font }`, y measured *down*
 * from the top of the page so that reading order is ascending.
 */
export async function readPdf(data, { onProgress = null } = {}) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: view.width,
      height: view.height,
      items: content.items.filter((it) => it.str && it.str.trim()).map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: view.height - it.transform[5],
        w: it.width,
        size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 0,
        font: it.fontName || '',
      })),
    });
    onProgress?.(n, doc.numPages);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

/* ---------------- items ---------------- */

const round = (n, to = 1) => Math.round(n / to) * to;
const styleOf = (it) => `${it.font}@${round(it.size, 0.5)}`;
const center = (it) => it.x + it.w / 2;
const sameRow = (a, b) => Math.abs(a.y - b.y) <= Math.max(2, Math.max(a.size, b.size) * 0.35);

/**
 * Text drawn more than once for a bold or shadow effect: the same words over
 * each other on one row. Only the largest copy is kept, or "36" drawn three
 * times reads as the page number 363636.
 */
function dropDoubles(items) {
  const byText = new Map();
  const kept = [];
  for (const it of [...items].sort((a, b) => b.size - a.size)) {
    const t = it.str.trim();
    const same = byText.get(t) || [];
    const twin = same.some((k) => sameRow(k, it)
      && Math.min(k.x + k.w, it.x + it.w) - Math.max(k.x, it.x) >= Math.min(k.w, it.w) * 0.3);
    if (twin) continue;
    same.push(it);
    byText.set(t, same);
    kept.push(it);
  }
  return kept;
}

const MINOR_WORD = /(?<!^)\b(?:Of|The|And|A|An|To|In|On|With|From|For|Or|At|By)\b/g;
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, c) => a + c.toUpperCase())
  .replace(MINOR_WORD, (w) => w.toLowerCase());

/**
 * Small capitals set by hand: a capital, then smaller letters, one piece each
 * ("H" at 11 pt, "EADBAND" at 7.7 pt). The size change cuts the line apart,
 * so each run becomes one item at the capitals' size. The case of the small
 * letters is not reliable, so the run is title-cased.
 */
function mergeSmallCaps(items) {
  const sorted = [...items].sort((a, b) => (a.font < b.font ? -1 : a.font > b.font ? 1 : 0) || a.y - b.y || a.x - b.x);
  const out = [];
  let run = [];
  const flush = () => {
    const big = Math.max(...run.map((it) => it.size));
    const small = Math.min(...run.map((it) => it.size));
    // A capital is one or two letters; a longer piece at the large size is ordinary text.
    const capitals = run.filter((it) => it.size === big).every((it) => it.str.trim().length <= 3);
    if (run.length > 1 && capitals && small / big >= 0.55 && small / big <= 0.9) {
      let str = run[0].str;
      for (let i = 1; i < run.length; i++) {
        const gap = run[i].x - (run[i - 1].x + run[i - 1].w);
        str += (gap > big * 0.08 && !/\s$/.test(str) && !/^\s/.test(run[i].str) ? ' ' : '') + run[i].str;
      }
      const last = run[run.length - 1];
      out.push({ ...run.find((it) => it.size === big), str: titleCase(str.replace(/\s+/g, ' ').trim()), x: run[0].x, w: last.x + last.w - run[0].x, size: big });
    } else out.push(...run);
    run = [];
  };
  for (const it of sorted) {
    const prev = run[run.length - 1];
    const gap = prev ? it.x - (prev.x + prev.w) : 0;
    const joins = prev && it.font === prev.font && Math.abs(it.y - prev.y) < 1 && gap > -1
      && gap < Math.max(it.size, prev.size) * 0.4
      // A longer piece at a larger size is the ordinary text after the run.
      && !(it.size > prev.size && it.str.trim().length > 3);
    if (!joins && run.length) flush();
    run.push(it);
  }
  if (run.length) flush();
  return out;
}

const LEVEL_CELL = /^(\d{1,2})(?:st|nd|rd|th)?$/;

/**
 * A class table: "Level" over 1st, 2nd, 3rd... with a base attack column.
 * pdf.js gives the cells one at a time in drawing order, so the table is
 * rebuilt from positions. Header words in the header's font that overlap
 * across lines are one column heading ("Base" / "Attack" / "Bonus"). Rows are
 * keyed on the level column, and each word goes to the column whose center is
 * nearest. The result is a tab-separated header and one line per level, which
 * is what the class reader takes. Returns null when "Level" is not the head
 * of such a table.
 */
function classTable(items, level, pageWidth) {
  const levelX = center(level);
  const rows = [];
  for (const it of items.filter((x) => x.y > level.y && Math.abs(center(x) - levelX) < level.size * 1.6 && LEVEL_CELL.test(x.str.trim())).sort((a, b) => a.y - b.y)) {
    if (Number(it.str.trim().match(LEVEL_CELL)[1]) === rows.length + 1) rows.push(it);
  }
  if (rows.length < 5) return null;
  const firstY = rows[0].y;
  const head = items.filter((it) => it.font === level.font && it.y >= level.y - level.size * 3 && it.y < firstY - level.size * 0.4);
  const cols = [];
  for (const it of [...head].sort((a, b) => a.x - b.x)) {
    const col = cols.find((c) => it.x <= c.x1 + 2 && it.x + it.w >= c.x0 - 2);
    if (col) { col.words.push(it); col.x0 = Math.min(col.x0, it.x); col.x1 = Math.max(col.x1, it.x + it.w); } else cols.push({ x0: it.x, x1: it.x + it.w, words: [it] });
  }
  // A header word set in another font by mistake still sits in its column, inside the header's lines.
  const headSpan = [Math.min(...head.map((h) => h.y)) - 2, Math.max(...head.map((h) => h.y)) + 2];
  for (const it of items) {
    if (head.includes(it) || it.y < headSpan[0] || it.y > headSpan[1]) continue;
    const col = cols.find((c) => it.x < c.x1 && it.x + it.w > c.x0);
    if (col) { col.words.push(it); head.push(it); }
  }
  cols.sort((a, b) => a.x0 - b.x0);
  const header = cols.map((c) => c.words.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' '));
  if (!/base attack|\bbab\b/i.test(header.join(' '))) return null;
  const spacing = (rows[rows.length - 1].y - firstY) / Math.max(1, rows.length - 1);
  const headTop = Math.min(...head.map((h) => h.y));
  const headBottom = Math.max(...head.map((h) => h.y));
  let x0 = Math.min(...cols.map((c) => c.x0)) - 4;
  let x1 = Math.max(...cols.map((c) => c.x1)) + 30;
  // A table in one column of two stops at the middle of the page.
  if (x1 - 30 < pageWidth / 2) x1 = Math.min(x1, pageWidth / 2);
  if (x0 + 4 > pageWidth / 2) x0 = Math.max(x0, pageWidth / 2);
  const colOf = (it) => {
    let best = 0;
    cols.forEach((c, ci) => { if (Math.abs(center(it) - (c.x0 + c.x1) / 2) < Math.abs(center(it) - (cols[best].x0 + cols[best].x1) / 2)) best = ci; });
    return best;
  };
  const cells = rows.map((r, i) => {
    const top = i === 0 ? headBottom + 2 : (rows[i - 1].y + r.y) / 2;
    const bottom = i === rows.length - 1 ? r.y + Math.min(level.size * 1.3, spacing * 0.8) : (r.y + rows[i + 1].y) / 2;
    const inRow = items.filter((it) => it.y > top && it.y <= bottom && it.x >= x0 && it.x <= x1 && !head.includes(it));
    const out = cols.map(() => []);
    for (const it of inRow) {
      // A line-end hyphen is a piece of its own; it belongs to the word left of it.
      if (it.str.trim() === '-') {
        const left = inRow.filter((o) => o !== it && Math.abs(o.y - it.y) < 2 && o.x < it.x).sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];
        if (left) { out[colOf(left)].push(it); continue; }
      }
      out[colOf(it)].push(it);
    }
    return out.map((c) => c.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.str.trim()).join(' ').replace(/\s+/g, ' ').replace(/(\w) ?- (\w)/g, '$1$2'));
  });
  // "Table: Warlord" just above the header is its caption.
  const caption = items.filter((it) => !head.includes(it) && it.y < headTop && it.y >= headTop - level.size * 2.5
    && it.x + it.w > x0 && it.x < x1 && /^Table\b/i.test(it.str.trim())).sort((a, b) => b.y - a.y)[0];
  const y0 = (caption ? caption.y : headTop) - 2;
  const y1 = rows[rows.length - 1].y + Math.min(level.size * 1.3, spacing * 0.8);
  return {
    y: y0 + 2,
    x0,
    x1,
    text: [caption?.str.trim(), header.join('\t'), ...cells.map((r) => r.join('\t'))].filter(Boolean).join('\n'),
    inside: (it) => it.y >= y0 && it.y <= y1 && it.x >= x0 && it.x <= x1,
  };
}

/** A page with doubled text, small capitals and class tables dealt with; the tables come back as whole lines. */
function tidyPage(page) {
  let items = mergeSmallCaps(dropDoubles(page.items));
  const tables = [];
  for (const level of items.filter((it) => it.str.trim() === 'Level').sort((a, b) => a.y - b.y)) {
    if (!items.includes(level)) continue;
    const t = classTable(items, level, page.width);
    if (!t) continue;
    items = items.filter((it) => !t.inside(it));
    tables.push({ y: t.y, x0: t.x0, x1: t.x1, text: t.text });
  }
  return { ...page, items, tables };
}

/* ---------------- lines ---------------- */

/**
 * The style a line is *in* (the one most of its characters are set in),
 * whether it is in that style throughout, and the style it opens in, for a
 * run-in label: "Prerequisites: Boxing sphere." `alias` renames styles.
 */
function styleLine(l, alias = null) {
  const name = (p) => { const s = styleOf(p); return alias?.get(s) ?? s; };
  const tally = new Map();
  for (const p of l.parts) tally.set(name(p), (tally.get(name(p)) || 0) + p.str.trim().length);
  const ranked = [...tally].sort((a, b) => b[1] - a[1]);
  l.style = ranked[0][0];
  l.size = Number(l.style.split('@')[1]);
  l.pure = ranked.length === 1 || ranked[0][1] >= l.text.replace(/\s/g, '').length * 0.9;
  l.lead = name(l.parts[0]);
}

/**
 * A page's items as lines, each cut where a gutter's worth of space opens.
 *
 * Items on one baseline are one line until the gap between two of them is
 * wider than any space between words -- which is what the space between two
 * columns is, and what makes this work without knowing where the gutter is.
 */
function linesOf(page, book = new Map()) {
  const items = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.35));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  /*
   * Where the right-hand column begins: the commonest place, past the middle
   * of the page, for a piece of text to start after a gap. A gutter is often
   * no wider than two or three spaces of the heading type set beside it, so
   * width alone cannot tell it from a gap between words -- but words do not
   * all begin at one x, and a column does.
   */
  const starts = new Map();
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.items.forEach((it, i) => {
      const prev = row.items[i - 1];
      if (!prev || it.x < page.width * 0.4 || it.x > page.width * 0.7) return;
      if (it.x - (prev.x + prev.w) > it.size * 0.4) starts.set(round(it.x, 2), (starts.get(round(it.x, 2)) || 0) + 1);
    });
  }
  // A page says where its own right column starts when it has the evidence;
  // one that does not -- two headings on a row and little else -- is told by
  // the rest of the book, which was set on the same grid. `book` is filled in
  // by a first pass over every page and is empty during it.
  for (const [x, n] of starts) book.set(`${round(page.width, 1)}|${x}`, (book.get(`${round(page.width, 1)}|${x}`) || 0) + n);
  const best = (tally) => [...tally].sort((a, b) => b[1] - a[1])[0] ?? [Infinity, 0];
  let [rightStart, hits] = best(starts);
  if (hits < 4) {
    const mine = [...book].filter(([k]) => k.startsWith(`${round(page.width, 1)}|`)).map(([k, n]) => [Number(k.split('|')[1]), n]);
    [rightStart, hits] = best(mine);
  }
  const atGutter = (it) => hits >= 4 && Math.abs(it.x - rightStart) <= 3;

  const lines = [];
  for (const row of rows) {
    let cur = null;
    for (const it of row.items) {
      const gap = cur ? it.x - cur.x1 : 0;
      // Type of another size across a gap, past the middle of the page, is the
      // other column: a heading set beside the last line of a paragraph. Bold
      // or italic words inside a sentence are the same size as the sentence.
      const prev = cur?.parts[cur.parts.length - 1];
      const otherColumn = prev && gap > it.size * 0.25 && it.x > page.width * 0.4
        && Math.abs(it.size - prev.size) > 1.5;
      // A space between words is about a quarter of the type size and a
      // justified line stretches it to perhaps twice that; a gutter is rarely
      // under one and a half. One whole type size is the line between them --
      // at 1.8 a 19-point gutter beside 11-point text read as a word space,
      // and two columns came out as one sentence.
      if (cur && gap <= it.size && !otherColumn && !(atGutter(it) && gap > it.size * 0.3)) {
        // Some books set word spaces as narrow as a tenth of the type size.
        // A gap that narrow beside a hyphen, a bracket or punctuation is kerning.
        const space = gap > it.size * 0.18 || (gap >= it.size * 0.06
          && !/[-–—(\[‘“/]$/.test(cur.text) && !/^[-–—,.;:!?)\]’”/]/.test(it.str));
        cur.text += (space && !cur.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        cur.x1 = it.x + it.w;
        cur.parts.push(it);
      } else {
        cur = { y: row.y, x0: it.x, x1: it.x + it.w, text: it.str, parts: [it] };
        lines.push(cur);
      }
    }
  }
  for (const l of lines) {
    l.text = l.text.replace(/\s+/g, ' ').trim();
    styleLine(l);
  }
  // A rebuilt table is one line of its own, kept as it was written.
  const tables = (page.tables || []).map((t) => ({ ...t, parts: [], table: true, style: 'table@0', size: 0, pure: false, lead: 'table@0' }));
  return [...lines.filter((l) => l.text), ...tables];
}

/** Left column down, then right; a line across both ends the columns above it. */
function inReadingOrder(lines, width) {
  if (lines.length < 8) return [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  /*
   * Where the right column starts: the *leftmost* margin, past the middle of
   * the page, that several lines share -- not the commonest. A column with a
   * picture let into its edge sets most of its lines further in, and taking
   * that inner margin for the column's own sent the lines above and below the
   * picture to the left column, where they were shuffled in among it by
   * height. And the page is two columns when a fair share of its lines start
   * anywhere past that margin, wherever exactly.
   */
  const tally = new Map();
  for (const l of lines) if (l.x0 > width * 0.45 && l.x0 < width * 0.75) tally.set(round(l.x0, 4), (tally.get(round(l.x0, 4)) || 0) + 1);
  const right = [...tally].filter(([, n]) => n >= 3).sort((a, b) => a[0] - b[0])[0]?.[0] ?? 0;
  const count = right ? lines.filter((l) => l.x0 >= right - 8).length : 0;
  if (count < lines.length * 0.2) return [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out = [];
  let left = [];
  let rightCol = [];
  const flush = () => { out.push(...left, ...rightCol); left = []; rightCol = []; };
  for (const l of [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    if (l.x0 >= right - 8) rightCol.push(l);
    else if (l.x1 > right + width * 0.12) { flush(); out.push(l); } else left.push(l);
  }
  flush();
  return out;
}

/* ---------------- the outline ---------------- */

/**
 * The book as sections of entries.
 *
 * Returns `{ title, sections: [{ heading, page, lead, entries: [{ heading,
 * page, text }] }] }`. `lead` is what a section says before its first entry
 * -- for a sphere, that is the sphere's own description and base abilities.
 */
export function outlineOf(pages, { title = '', debug = false } = {}) {
  const tidy = pages.map(tidyPage);
  // Twice: once to learn where the book's right column starts, once knowing it.
  const book = new Map();
  tidy.forEach((p) => linesOf(p, book));
  const learned = new Map(book);
  const perPage = tidy.map((p) => linesOf(p, new Map(learned)));

  /*
   * Furniture: the same words at the same height on many pages -- a running
   * head, a page number, a footer. None of it is an entry's text. Height and
   * not place: a running head stands at one x on left pages and another on
   * right ones, and a right-aligned page number moves with its digits.
   */
  const band = (l) => Math.round(l.y / 3);
  const numberless = (t) => t.replace(/\d+/g, '#');
  const seen = new Map();
  perPage.forEach((lines) => {
    const once = new Set(lines.filter((l) => !l.table).flatMap((l) => [`${band(l)}|${numberless(l.text)}`, `${band(l)}=${l.text}`]));
    for (const k of once) seen.set(k, (seen.get(k) || 0) + 1);
  });
  const near = (l, key) => (l.table ? 0 : [-1, 0, 1].reduce((n, d) => n + (seen.get(`${band(l) + d}${key}`) || 0), 0));
  const common = (l) => near(l, `|${numberless(l.text)}`) >= Math.max(3, pages.length * 0.4);
  // A running head that changes with the chapter is on too few pages for
  // that. It is still the top or bottom line of its page, apart from the
  // text, in the same words at the same height on other pages. The same
  // words exactly: a table row at the foot of a page can share its shape
  // with others ("1d6 1d8 x2").
  const furnitureOn = perPage.map((lines) => {
    const rest = lines.filter((l) => !common(l) && !l.table).sort((a, b) => a.y - b.y);
    const repeated = (l) => l.text.length <= 100 && near(l, `=${l.text}`) >= 3;
    const outer = new Set();
    if (rest.length > 1) {
      const top = rest[0].y;
      const bottom = rest[rest.length - 1].y;
      const below = rest.find((l) => l.y - top >= 2);
      const above = [...rest].reverse().find((l) => bottom - l.y >= 2);
      for (const l of rest.filter((x) => x.y - top < 2)) if (below && below.y - l.y >= l.size * 1.5 && repeated(l)) outer.add(l);
      for (const l of rest.filter((x) => bottom - x.y < 2)) if (above && l.y - above.y >= l.size * 1.5 && repeated(l)) outer.add(l);
    }
    return new Set(lines.filter((l) => common(l) || outer.has(l)));
  });

  const flow = [];
  perPage.forEach((lines, pi) => {
    const furniture = furnitureOn[pi];
    const kept = lines.filter((l) => !furniture.has(l));
    // A printed page number, when the page has one, is the one to cite.
    const printed = lines.find((l) => furniture.has(l) && /^\d{1,4}$/.test(l.text));
    const page = printed ? Number(printed.text) : pi + 1;
    for (const l of inReadingOrder(kept, pages[pi].width)) flow.push({ ...l, page, colWidth: pages[pi].width / 2 });
  });

  /*
   * The body is whatever most of the book is set in -- which may be more than
   * one style. A justified page is often set in two cuts of one face, sharing
   * the text between them at the same size, and calling
   * only the commoner one "body" makes a heading of every short line in the
   * other. So any style carrying a real share of the text is body.
   */
  const weight = new Map();
  let total = 0;
  for (const l of flow) if (!l.table) { weight.set(l.style, (weight.get(l.style) || 0) + l.text.length); total += l.text.length; }
  const ranked = [...weight].sort((a, b) => b[1] - a[1]);
  const bodyStyles = new Set(ranked.filter(([, n], i) => i === 0 || n >= total * 0.12).map(([s]) => s));
  const body = ranked[0]?.[0] ?? '';
  const bodySize = Number(body.split('@')[1]) || 10;

  // A heading: a short line, all in one style that is not the body's, that
  // does not read as the end of a sentence.
  const open = (t) => (t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length;
  const isHeading = (l) => l.pure && !bodyStyles.has(l.style) && l.size >= bodySize * 0.95
    && l.text.length <= 80 && /^[A-Z0-9(]/.test(l.text) && !/^\d+$/.test(l.text)
    // Not the end of a sentence -- though a heading whose tags run on to the
    // next line does end in a comma: "Internal Tool (accessory, augment,".
    && (!/[.;:,]$/.test(l.text) || (/,$/.test(l.text) && open(l.text)));
  const headingStyles = new Map();
  const countHeadings = () => {
    headingStyles.clear();
    for (const l of flow) if (isHeading(l)) headingStyles.set(l.style, (headingStyles.get(l.style) || 0) + 1);
  };
  countHeadings();
  /*
   * A heading with "fi", "fl" or "ff" in it is sometimes set in a second
   * font object of the same face, which holds the ligature. That style's
   * headings all have a ligature in them. It is read as the commonest
   * heading style of its size, or every such talent reads as a sub-heading
   * of the one above it.
   */
  const ligatures = new Map();
  for (const l of flow) if (isHeading(l) && /f[fil]/.test(l.text)) ligatures.set(l.style, (ligatures.get(l.style) || 0) + 1);
  const ligatureOnly = (s) => headingStyles.get(s) >= 3 && (ligatures.get(s) || 0) >= headingStyles.get(s) * 0.9;
  const alias = new Map();
  for (const s of headingStyles.keys()) {
    if (!ligatureOnly(s)) continue;
    const twin = [...headingStyles].filter(([t]) => !ligatureOnly(t) && t.split('@')[1] === s.split('@')[1]).sort((a, b) => b[1] - a[1])[0];
    if (twin) alias.set(s, twin[0]);
  }
  if (alias.size) {
    for (const l of flow) if (!l.table) styleLine(l, alias);
    countHeadings();
  }
  // The style most headings are in is the entries'. Larger ones are sections;
  // the rest are sub-headings inside an entry (one mode of a talent that has several).
  const entryStyle = [...headingStyles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const entrySize = entryStyle ? Number(entryStyle.split('@')[1]) : Infinity;
  const tier = (l) => (!isHeading(l) ? null : l.style === entryStyle ? 'entry' : l.size > entrySize ? 'section' : 'sub');

  const sections = [];
  let section = { heading: title || 'Opening', page: 1, lead: [], entries: [] };
  let entry = null;
  let para = null;
  const target = () => (entry ? entry.body : section.lead);
  const endPara = () => { if (para) { target().push(para.text); para = null; } };
  let last = null;

  for (const l of flow) {
    // A rebuilt table is a paragraph of its own.
    if (l.table) { endPara(); target().push(l.text); last = l; continue; }
    /*
     * The tail of a heading whose tags ran on: "…(augment, drone," then
     * "gadget)". It is in the heading's style, it closes a bracket, and it
     * opens none -- which is what tells it from the *next* heading, because
     * a heading at the foot of one column has the next column's first heading
     * after it in reading order, and only later its own last word. So the
     * tail goes to whichever entry is still waiting for one, not simply to
     * the one before it.
     */
    if (l.pure && l.style === entryStyle && /^[^(]*\)/.test(l.text) && !/^[A-Z]/.test(l.text)) {
      const waiting = [...section.entries].reverse().find((e) => open(e.heading));
      if (waiting) { waiting.heading += ` ${l.text}`; last = l; continue; }
    }
    const t = tier(l);
    // A heading that wraps without a bracket to say so -- "Superior Mechanical
    // Ranged" over "Weaponry" -- is two lines in one style, one directly under
    // the other at the same margin. Two headings that merely share a row in
    // different columns are not that.
    const under = t && last && tier(last) === t && last.style === l.style && last.page === l.page
      && Math.abs(l.x0 - last.x0) <= 3 && l.y > last.y && l.y - last.y < l.size * 1.6;
    if (under && t === 'entry' && entry && !entry.body.length) { entry.heading += ` ${l.text}`; last = l; continue; }
    if (under && t === 'section' && !section.lead.length && !section.entries.length) { section.heading += ` ${l.text}`; last = l; continue; }
    if (t === 'section') {
      endPara();
      const empty = !section.lead.length && !section.entries.length;
      if (!empty) sections.push(section);
      /*
       * A section heading with nothing under it yet is a banner over the real
       * one ("Section 2", "Class Options", then "Duskblade") and is let go
       * -- unless what follows is its own bracketed subtitle: "Duskblade"
       * over "(Magus Archetype)" is one heading in two sizes, and the reader
       * wants both halves of it.
       */
      const subtitle = empty && sections.length && l.text.startsWith('(');
      section = { heading: subtitle ? `${section.heading} ${l.text}` : l.text, page: l.page, lead: [], entries: [] };
      entry = null;
    } else if (t === 'entry') {
      endPara();
      entry = { heading: l.text, page: l.page, body: [] };
      section.entries.push(entry);
    } else if (t === 'sub') {
      endPara();
      target().push(`**${l.text}**`);
    } else {
      // Body text. A new paragraph after a gap, or after a line that stopped
      // short of the column's edge at the end of a sentence.
      const gap = last && last.page === l.page ? l.y - last.y : 0;
      const shortEnd = para && /[.:!?)]$/.test(para.text) && para.lastWidth < l.colWidth * 0.78;
      if (para && (gap > l.size * 1.75 || gap < 0 || shortEnd)) endPara();
      // A run-in label in a heading style -- "Prerequisites:" -- opens a paragraph.
      if (para && !bodyStyles.has(l.lead) && /^[A-Z][A-Za-z ]{2,24}:/.test(l.text)) endPara();
      if (!para) para = { text: l.text, lastWidth: l.x1 - l.x0 };
      else {
        para.text = /[a-z]-$/.test(para.text) && /^[a-z]/.test(l.text) ? para.text.slice(0, -1) + l.text : `${para.text} ${l.text}`;
        para.lastWidth = l.x1 - l.x0;
      }
    }
    last = l;
  }
  endPara();
  if (section.lead.length || section.entries.length) sections.push(section);

  return {
    title,
    // For looking at a book the outline gets wrong: every line, and what it was taken for.
    ...(debug ? { flow: flow.map((l) => ({ page: l.page, x: Math.round(l.x0), y: Math.round(l.y), style: l.style, pure: l.pure, tier: tier(l), text: l.text.slice(0, 70) })) } : {}),
    sections: sections.map((s) => ({
      heading: s.heading,
      page: s.page,
      lead: s.lead.join('\n\n'),
      entries: s.entries.map((e) => ({ heading: e.heading, page: e.page, text: e.body.join('\n\n') })),
    })),
  };
}

/* ---------------- a section, as text the reader takes ---------------- */

/** What a section can be told to be. `text` is for a class, an archetype or a race: the page reader's ground. */
export const SECTION_KINDS = [
  ['skip', 'Leave out'],
  ['talents', 'Sphere talents'],
  ['sphere', 'A sphere’s own page (base abilities)'],
  ['feats', 'Feats'],
  ['text', 'Class, archetype or race'],
  ['options', 'A class feature’s menu (what a column picks from)'],
  ['reference', 'Reference entries'],
];

/** A first guess at a section, from its heading alone. Only ever a guess: the panel shows it to be changed. */
export function guessKind(section) {
  const h = section.heading.toLowerCase();
  if (/\btalents?\b/.test(h) && section.entries.length) return 'talents';
  if (/\bsphere$/.test(h)) return 'sphere';
  if (/^feats?\b|\bfeats$/.test(h) && section.entries.length) return 'feats';
  if (/archetype|class options?|^classes$|races?$/.test(h)) return 'text';
  return 'skip';
}

/** "Boxing Talents" and "Boxing Sphere" are both about Boxing; "Legendary Talents" says nothing, and takes the last one named. */
export function guessSphere(section, previous = '') {
  const m = section.heading.match(/^(.*?)\s+(?:sphere|(?:basic |advanced |legendary )?talents)$/i);
  const name = m ? m[1].replace(/^(?:basic|advanced|legendary)\s*/i, '').trim() : '';
  return name || previous;
}

const fieldLine = (k, v) => (String(v ?? '').trim() ? `* **${k}:** ${String(v).replace(/\s+/g, ' ').trim()}` : '');

/** An entry's opening `Prerequisites: …` paragraph, lifted out as the field it is. */
function liftPrerequisites(text) {
  const m = String(text).match(/^Prerequisites?:\s*([^\n]+)(?:\n\n|$)/);
  return m ? { prerequisites: m[1].replace(/\.$/, ''), text: text.slice(m[0].length).trim() } : { prerequisites: '', text };
}

/**
 * One section as a document for `parsePaste`, given what it was said to be.
 *
 * `spheres` carries the base-ability sections already seen, by sphere name,
 * so that a sphere's talents and its own page -- two sections in the book --
 * leave as the one document a sphere is.
 */
export function sectionText(section, { kind, sphere = '', entryKind = '', book = '' }, spheres = new Map()) {
  const source = (page) => fieldLine('Source', [book, page ? `p. ${page}` : ''].filter(Boolean).join(' '));
  if (kind === 'skip') return '';
  if (kind === 'text') {
    // The page reader wants a page: headings on their own lines, text beneath.
    // "Duskblade (Magus Archetype)" is a name and a line about it, not a name.
    const titled = section.heading.match(/^(.*?)\s*\(([^)]*\b(?:archetype|class|race)[^)]*)\)$/i);
    const head = titled ? `${titled[1]}\n${titled[2]}` : section.heading;
    return [head, section.lead, ...section.entries.flatMap((e) => [e.heading, e.text])].filter(Boolean).join('\n\n');
  }
  if (kind === 'sphere') {
    // Kept for the talents section to open with; it is not a document alone.
    // A base ability is headed either the way an entry is or, more often, the
    // way a sub-heading is -- which the outline leaves in the lead as a bold
    // paragraph of its own. Both become the `*Name:* text` the reader looks for.
    const out = [];
    for (const para of String(section.lead).split(/\n{2,}/)) {
      const head = para.match(/^\*\*([^*]{2,60})\*\*$/);
      if (head) out.push(`*${head[1].replace(/:/g, '')}:*`);
      else if (out.length && /^\*[^*]+:\*$/.test(out[out.length - 1])) out[out.length - 1] += ` ${para}`;
      else out.push(para);
    }
    const abilities = section.entries.map((e) => `*${e.heading.replace(/[*:]/g, '')}:* ${e.text}`);
    spheres.set(sphere.toLowerCase(), [...out, ...abilities].filter(Boolean).join('\n\n'));
    return '';
  }
  const entries = section.entries.map((e) => {
    const { prerequisites, text } = liftPrerequisites(e.text);
    const type = kind === 'feats' ? (e.heading.match(/\(([^)]+)\)\s*$/)?.[1] || 'Feat') : '';
    const heading = kind === 'feats' ? e.heading.replace(/\s*\([^)]+\)\s*$/, '') : e.heading;
    return [`#### ${heading}`,
      // A book about one sphere heads its list plain "Talents"; beside another
      // document's "Boxing Talents" in the same sphere that is no group at all.
      kind === 'talents' ? fieldLine('Section', /^(?:basic |advanced )?talents$/i.test(section.heading) && sphere ? `${sphere} ${section.heading}` : section.heading) : '',
      kind === 'feats' ? fieldLine('Feat type', type.replace(/\b\w/g, (c) => c.toUpperCase())) : '',
      kind === 'reference' ? fieldLine('Entry kind', entryKind || section.heading.toLowerCase()) : '',
      fieldLine('Prerequisites', prerequisites), source(e.page), '', text].filter((x, i) => x !== '' || i === 6).join('\n');
  });
  if (!entries.length) return '';
  if (kind === 'talents') {
    const intro = spheres.get(sphere.toLowerCase()) || '';
    const quoted = intro ? `${intro.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n` : '';
    return `# ${sphere || 'Sphere'}\n\n${quoted}## Sphere Talents\n\n${entries.join('\n\n')}\n`;
  }
  return `# ${section.heading}\n\n${entries.join('\n\n')}\n`;
}

/* ---------------- the whole book ---------------- */

/**
 * One section as the menu a class feature picks from: an `options` block.
 *
 * A list of things a class takes one of at a time -- each entry a name and
 * what it does -- is set in a book exactly as a list of talents is, so only
 * being told makes it one. The class and the feature are what a feature
 * column is matched on, which is how the menu finds its column unasked.
 *
 * Built directly rather than written out for a reader: there is no page
 * shape to recognise here, only entries.
 */
export function sectionOptions(section, { className = '', feature = '', book = '' } = {}) {
  const cls = String(className).trim();
  const feat = String(feature).trim() || section.heading;
  const options = section.entries.map((e) => {
    const typed = splitAbilityType(e.heading);
    // "Level 2; Burn 1" in an entry's opening lines is what a player chooses
    // on, so it rides beside the name in the list.
    const opening = String(e.text).split(/\n{2,}/).slice(0, 2).join(' ');
    const facts = [...opening.matchAll(/\b(Level|Burn)\s+(\d+|[-–—])/g)].map((m) => `${m[1]} ${m[2]}`);
    return {
      name: typed.name,
      type: typed.type,
      category: [...new Set(facts)].join(', '),
      text: e.text,
      source: [book, e.page ? `p. ${e.page}` : ''].filter(Boolean).join(' '),
      // The level it asks for, read the way every other route reads it.
      minLevel: minLevelIn(e.text),
    };
  }).filter((o) => o.name);
  if (!options.length) return null;
  return {
    kind: 'options',
    name: [cls, feat].filter(Boolean).join(' '),
    class: cls,
    feature: feat,
    text: section.lead,
    source: [book, section.page ? `p. ${section.page}` : ''].filter(Boolean).join(' '),
    options,
  };
}

/** A first guess for every section, in order. "Legendary Talents" names no sphere, and takes the one whose page came before it. */
export function guessTags(outline) {
  let sphere = '';
  return outline.sections.map((sec) => {
    const kind = guessKind(sec);
    if (kind === 'sphere') sphere = guessSphere(sec, sphere);
    return { kind, sphere: kind === 'talents' || kind === 'sphere' ? guessSphere(sec, '') || sphere : '', entryKind: '', className: '', feature: '' };
  });
}

/**
 * The chosen sections, each through the reader it suits, as one result.
 *
 * A class or an archetype is a *page* and goes to `parsePaste`. Talents, feats
 * and reference entries are written out as the scraper's own document and go
 * straight to `readStructured`: whoever calls this knows what it made, and the
 * guess `parsePaste` makes first wants three field lines, which a section
 * holding a single talent does not have.
 *
 * The readers are handed in rather than imported, so that this module stays
 * about PDFs and the extension manager and the command line tool both bring
 * the one reader there is.
 */
export function readSections(outline, tags, { book = '', parsePaste, readStructured }) {
  const lower = (s) => String(s ?? '').trim().toLowerCase();
  const merged = { blocks: [], maneuvers: [], spheres: [], feats: [], spells: [], powers: [], catalogue: [], report: [], leftovers: [] };
  const intros = new Map();
  // A sphere's own page is only an opening for its talents, so those are
  // gathered first, wherever in the book they stand.
  outline.sections.forEach((sec, i) => { if (tags[i]?.kind === 'sphere') sectionText(sec, { ...tags[i], book }, intros); });
  outline.sections.forEach((sec, i) => {
    const t = tags[i];
    if (!t || t.kind === 'skip' || t.kind === 'sphere') return;
    if (t.kind === 'options') {
      const block = sectionOptions(sec, { ...t, book });
      if (block) {
        merged.blocks.push(block);
        merged.report.push(`Option menu ${block.name}: ${block.options.length} option(s)`
          + `${block.class ? ` for ${block.class}'s ${block.feature}` : ''}.`);
      }
      return;
    }
    const text = sectionText(sec, { ...t, book }, intros);
    if (!text) return;
    const r = t.kind === 'text' ? parsePaste(text) : readStructured(text);
    for (const key of ['blocks', 'maneuvers', 'feats', 'spells', 'powers', 'catalogue', 'report', 'leftovers']) merged[key].push(...(r[key] || []));
    // Two sections of one sphere -- its talents and its legendary talents --
    // are one sphere.
    for (const sp of r.spheres || []) {
      const had = merged.spheres.find((x) => lower(x.name) === lower(sp.name));
      if (!had) merged.spheres.push(sp);
      else {
        had.talents.push(...sp.talents);
        if (!had.abilities.length) had.abilities = sp.abilities;
        if (!had.description) had.description = sp.description;
      }
    }
  });
  // A base-ability page nobody gave talents to still has something to say.
  for (const [name, intro] of intros) {
    if (merged.spheres.some((x) => lower(x.name) === name)) continue;
    const quoted = intro.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    const r = readStructured(`# ${name.replace(/\b\w/g, (c) => c.toUpperCase())}\n\n${quoted}\n\n## Sphere Talents\n`);
    merged.spheres.push(...(r.spheres || []));
  }
  return merged;
}
