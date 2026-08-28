/**
 * ui/breakdown-popover.js -- the working, as something you can read.
 *
 * `workingTitle` in ui/rows.js flattens a breakdown into plain text because a
 * `title` attribute can hold nothing else: no columns, so a figure and its
 * label are held apart by two spaces and hope; no weight, so the total reads
 * the same as the parts it is made of; and the operating system decides how
 * long it stays and how much of it it is willing to show. Fifteen lines of AC
 * is the case a native tooltip is worst at, and AC is the number most often
 * asked about.
 *
 * So the same data gets a panel. Two halves, split the way this repo splits
 * everything that touches the DOM: `breakdownHtml` and `placeAt` are pure and
 * are what the tests can reach, and sheet-element owns the one element, its
 * listeners and its lifetime.
 *
 * The panel is drawn in the **top layer**, via the popover API, and that is
 * not decoration -- `.tablewrap` is a scroll box with a max-height, so a panel
 * positioned inside a table cell is cropped at the box's edge. The top layer
 * is the only place a tooltip over a scrolling table can finish its sentence.
 *
 * The plain-text title stays in the markup that panels write. A browser with
 * no popover API keeps it and loses nothing; `#armBreakdowns` takes it off the
 * numbers it is going to answer for itself, because two tooltips on one figure
 * is worse than the ugly one on its own.
 */
import { esc } from './html.js';
import { fmt } from '../rules.js';

/** How far the panel stands off the number it explains. */
const GAP = 8;

/** How near the window's edge it may come before it is pushed back. */
const MARGIN = 8;

/**
 * A breakdown as the panel shows it.
 *
 * The heading is the name and the total; the parts follow in the order the sum
 * takes them, each with the note that explains it where there is one. Signs
 * are `fmt` on the parts and bare on the total, which is what `workingTitle`
 * already did and is right both times: a part is something added, a total is
 * a number.
 *
 * The last row is the discrepancy `breakdown()` goes to the trouble of
 * computing. The total is always the sheet's own and never the sum of what is
 * shown, so a part this app has forgotten shows up as a line saying so rather
 * than as arithmetic that quietly does not work.
 *
 * `extra` is the sentence the caller already had -- "Base 43 -- with 2
 * conditions applied" -- and sits under the heading, because it is about the
 * reading rather than about any one part of it.
 *
 * Every string is escaped. A part's label can be an item's name, which is
 * whatever somebody typed into a spreadsheet cell, and a published sheet is
 * opened by people who did not type it.
 */
export function breakdownHtml(b, extra = '') {
  if (!b) return '';
  const parts = b.parts.map((p) => partRow(fmt(p.value), p.label, p.note));
  if (b.sum !== b.total) parts.push(partRow(fmt(b.total - b.sum), 'unaccounted for', '', ' odd'));
  return `<div class="bdhead"><span class="bdname">${esc(b.label)}</span>`
    + `<span class="bdtotal">${esc(String(b.total))}</span></div>`
    + (extra ? `<div class="bdsub">${esc(extra)}</div>` : '')
    + (parts.length
      ? `<div class="bdparts">${parts.join('')}</div>`
      : '<div class="bdsub">Nothing is adding to it.</div>');
}

function partRow(value, label, note, cls = '') {
  return `<div class="bdrow${cls}">`
    + `<span class="k">${esc(label)}${note ? `<span class="bdnote">${esc(note)}</span>` : ''}</span>`
    + `<span class="v">${esc(value)}</span>`
    + '</div>';
}

/**
 * Where the panel goes: under the number, centred on it, and inside the window.
 *
 * Under by preference, above when there is no room under -- and "room" is
 * measured against the panel that was actually drawn rather than guessed at,
 * which is why this takes measurements and not elements. Sideways it is
 * centred and then clamped, so a stat in the rightmost column gets a panel
 * with its right edge on the margin instead of one half off the screen.
 *
 * Every rectangle is in viewport coordinates -- what `getBoundingClientRect`
 * returns and what `position: fixed` wants -- so nothing here has to know how
 * far anything has scrolled.
 *
 * @param anchor {left, top, right, bottom, width} of the number
 * @param box    {width, height} of the panel, measured
 * @param view   {width, height} of the window
 * @returns {{left:number, top:number, below:boolean}} viewport coordinates,
 *   and which side it settled on -- the caller wears that as a class so the
 *   panel's shadow and its entrance both point the right way.
 */
export function placeAt(anchor, box, view, gap = GAP, margin = MARGIN) {
  const under = anchor.bottom + gap;
  const over = anchor.top - gap - box.height;
  // Under unless it would run off the bottom and above would actually fit.
  const below = under + box.height <= view.height - margin || over < margin;
  const centred = anchor.left + (anchor.width / 2) - (box.width / 2);
  const left = Math.max(margin, Math.min(centred, view.width - box.width - margin));
  return { left: Math.round(left), top: Math.round(below ? under : over), below };
}
