/**
 * ui/format.js -- the small number-and-string helpers the panels share.
 *
 * Rounding, thousands separators, percentages, and the loose string compare
 * that decides whether two names on a sheet are the same name. None of them
 * know anything about the character; they are here so a panel module can reach
 * them without importing the element.
 */

export const round = (v, places = 2) => {
  const f = 10 ** places;
  return Math.round((Number(v) || 0) * f) / f;
};

/** Crafting deals in six-figure prices, which are unreadable ungrouped. */
export const group = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const pct = (v) => `${round((Number(v) || 0) * 100, 2)}%`;

/** Two names off a sheet, compared the way a reader would compare them. */
export const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * How many pips a tracker will draw before it gives up and shows a bar.
 *
 * Past this the pips are too small to count, which is the only thing pips are
 * better than a bar at.
 */
export const PIP_LIMIT = 40;
