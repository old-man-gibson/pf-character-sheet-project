/**
 * A two-column PDF's text, in reading order.
 *
 *   pdftotext -raw    book.pdf book.raw.txt
 *   pdftotext -layout book.pdf book.layout.txt
 *   node tools/pdf-text.mjs book.raw.txt book.layout.txt --out book.txt [--drop "<regex>"]…
 *
 * Neither extraction is enough alone, and each has what the other lacks.
 *
 * `-raw` gives clean lines -- one column's line at a time, never two glued
 * together -- but in the order the page was *drawn*, which is a layout
 * program's business: most pages come left column then right, and then one
 * comes right column first, with its page number ahead of both.
 *
 * `-layout` keeps every line where it stood, so it knows which column a line
 * is in and how far down -- but it sets proportional type on a character grid,
 * and where a justified left-hand line runs up to the gutter it arrives glued
 * to the right-hand one with a single space, with nothing to say where the cut
 * goes.
 *
 * So the lines come from `-raw` and their places from `-layout`: each raw
 * line is found on the layout page (compared with the spaces taken out, which
 * is the only thing the two disagree about), and the page is read left column
 * down, then right column down. A line set across both columns -- a section
 * title, a wide table's row -- ends the columns above it and is kept whole.
 *
 * `--drop` removes lines matching a pattern first, for a running header or a
 * footer that is on every page. A line of digits alone is a page number: it is written
 * as `[[page N]]` at the head of its page, so a later step can cite pages.
 *
 * What comes out is text, not structure: it still needs somebody to say where
 * a talent starts. Extracted text is content, and content is its author's:
 * write it somewhere git-ignored (`private/`).
 */

import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
const drops = argv.map((a, i) => (a === '--drop' ? argv[i + 1] : null)).filter(Boolean).map((p) => new RegExp(p));
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(out|drop)$/.test(argv[i - 1])));
const out = opt('out');
if (inputs.length !== 2 || !out) {
  console.error('usage: node tools/pdf-text.mjs <raw.txt> <layout.txt> --out <file> [--drop "<regex>"]…');
  process.exit(2);
}

const pagesOf = (file) => readFileSync(file, 'utf8').replace(/\r/g, '').split('\f')
  .map((p) => p.split('\n').filter((l) => !drops.some((d) => d.test(l))));
const rawPages = pagesOf(inputs[0]);
const layPages = pagesOf(inputs[1]);

const result = [];
let unplaced = 0;
let reordered = 0;

rawPages.forEach((rawLines, pi) => {
  const lay = layPages[pi] || [];
  const texty = lay.filter((l) => l.trim());
  const width = Math.max(0, ...lay.map((l) => l.length));

  // The gutter: the column in the middle third that is blank on most lines.
  let gutter = -1;
  let best = 0;
  for (let c = Math.floor(width * 0.35); c <= Math.ceil(width * 0.65); c++) {
    const blank = texty.filter((l) => (l[c] ?? ' ') === ' ' && (l[c - 1] ?? ' ') === ' ').length;
    if (blank > best) { best = blank; gutter = c; }
  }
  const twoColumn = gutter !== -1 && texty.length >= 8 && best >= texty.length * 0.5;

  // Each layout line without its spaces, and where each kept character stood.
  const squeezed = lay.map((l) => {
    const cols = [];
    let s = '';
    for (let c = 0; c < l.length; c++) if (l[c] !== ' ') { s += l[c]; cols.push(c); }
    return { s, cols, taken: [] };
  });

  let page = null;
  const placed = [];
  let lastRow = 0;
  for (const rawLine of rawLines) {
    const text = rawLine.trim();
    if (!text) continue;
    if (/^\d{1,3}$/.test(text)) { page = Number(text); continue; }
    const key = text.replace(/\s+/g, '');
    // Found nearest the last line placed, because a rules document repeats itself:
    // "Prerequisites: …" is on the page a dozen times.
    let hit = null;
    for (let r = 0; r < squeezed.length; r++) {
      let from = 0;
      for (let at = squeezed[r].s.indexOf(key, from); at !== -1; at = squeezed[r].s.indexOf(key, from)) {
        from = at + 1;
        if (squeezed[r].taken.some(([a, b]) => at < b && at + key.length > a)) continue;
        const cand = { row: r, at, start: squeezed[r].cols[at], end: squeezed[r].cols[at + key.length - 1] };
        if (!hit || Math.abs(cand.row - lastRow) < Math.abs(hit.row - lastRow)) hit = cand;
      }
    }
    if (!hit) { unplaced++; placed.push({ text, row: lastRow + 0.5, start: 0, end: 0, lost: true }); continue; }
    squeezed[hit.row].taken.push([hit.at, hit.at + key.length]);
    lastRow = hit.row;
    placed.push({ text, ...hit });
  }

  let ordered;
  if (!twoColumn) ordered = [...placed].sort((a, b) => a.row - b.row || a.start - b.start);
  else {
    // A line is the right column's when it starts at the gutter or past it; it
    // spans the page when it starts well left and ends well right.
    /*
     * Where the right column begins is read off the lines themselves: the
     * commonest starting position in the middle of the page. The blankest
     * column is only a first guess at it -- on a tightly set page it sits a
     * few characters inside the right column, and every line of that column
     * then reads as the left's.
     */
    const tally = new Map();
    for (const q of placed) if (!q.lost && q.start > width * 0.35 && q.start < width * 0.7) tally.set(q.start, (tally.get(q.start) || 0) + 1);
    const rightStart = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? gutter;
    /*
     * Two lines on one row settle it between them: the one further left is
     * the left column's, whatever the grid says about where it ends. That
     * matters because the grid drifts -- a full justified left-hand line
     * pushes its neighbour's start in by half a dozen characters, which is
     * more than any fixed margin can allow for. Alone on its row, a line is
     * the right column's when it starts near where that column starts, spans
     * the page when it starts left and runs well past the middle, and is the
     * left column's otherwise.
     */
    const side = (p) => {
      const mates = placed.filter((q) => q !== p && !q.lost && q.row === p.row);
      if (mates.length) return mates.some((q) => q.start < p.start) ? 'R' : 'L';
      if (p.start >= rightStart - 8) return 'R';
      return p.end > rightStart + 12 ? 'W' : 'L';
    };
    ordered = [];
    let left = [];
    let right = [];
    const flush = () => { ordered.push(...left.sort((a, b) => a.row - b.row), ...right.sort((a, b) => a.row - b.row)); left = []; right = []; };
    for (const p of [...placed].sort((a, b) => a.row - b.row || a.start - b.start)) {
      const s = side(p);
      if (s === 'W') { flush(); ordered.push(p); } else (s === 'L' ? left : right).push(p);
    }
    flush();
  }
  if (ordered.some((p, i) => p !== placed[i])) reordered++;
  result.push(`${page !== null ? `[[page ${page}]]\n` : ''}${ordered.map((p) => p.text).join('\n')}`);
});

writeFileSync(out, `${result.join('\n\n')}\n`, 'utf8');
console.log(`${rawPages.length} pages, ${reordered} put in a different order from the raw stream, ${unplaced} line(s) not found on their page → ${out}`);
