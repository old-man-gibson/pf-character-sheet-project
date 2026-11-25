/**
 * The note under a veilweaving or practitioner ability pick that differs from
 * what the class's own pages name (model/class-abilities.js). Drawn by the
 * Akashic tab's class rows and the Martial tab's classes alike.
 */

import { abilityHint } from '../model.js';
import { ABILITY_NAMES } from '../rules.js';
import { esc } from './html.js';

/** `side` is 'veilweaving' or 'practitioner'; `index` the row in that side's list. */
export function abilityNote(model, side, index) {
  const hint = abilityHint(model, side, index);
  if (!hint) return '';
  const ability = ABILITY_NAMES[hint.ability];
  const uses = hint.casting ? `its casting ability, ${ability},` : ability;
  return `<p class="hint warn abilitynote">${esc(hint.source)} uses ${uses} as the ${side} modifier.</p>`;
}
