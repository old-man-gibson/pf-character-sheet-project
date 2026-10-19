/**
 * from-level.js -- the From lvl box on a feat, a granted feat or a bonus
 * talent, and how a row waiting for its level is drawn.
 *
 * A row with a level the character has not reached is the plan, the way a
 * Progression row past the current level is: greyed, counted for nothing,
 * its {…} bonuses held back (see rowLevel in model/feats.js). The Feats tab
 * and the three Spheres tabs draw these the same way.
 */

import { esc } from './html.js';
import { rowLevel } from '../model/feats.js';

/** What From lvl means, on its header. */
export const FROM_LEVEL_TITLE = 'The character level this is gained at. Until then it is the plan: greyed, '
  + 'not counted for requirements or tallies, and its {…} bonuses wait. Blank: from the start.';

/** The column heading. */
export const fromLevelHead = () => `<th class="num flvl" title="${esc(FROM_LEVEL_TITLE)}">From lvl</th>`;

/** A From lvl box: a level, or blank for "from the start". */
export function fromLevelField(list, i, row) {
  const at = rowLevel(row);
  return `<input type="number" min="1" max="40" value="${at ?? ''}" data-item="${list}|${i}|level" data-kind="number"
    placeholder="—" aria-label="From level" style="width:3.6rem;max-width:100%">`;
}

/** A row waiting for a level: the `future` class every planned row wears, and why on hover. */
export function plannedRow(ahead, at) {
  return ahead ? ` class="future" title="Planned for level ${at}: not counted yet, and its bonuses wait until then"` : '';
}
