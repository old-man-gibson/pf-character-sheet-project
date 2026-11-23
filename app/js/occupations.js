/**
 * occupations.js -- occupations (a campaign rule) picked from the enabled packs.
 *
 * An occupation is what the character did before adventuring: a list of
 * skills to pick some of, which become class skills, and for some a bonus
 * feat. The lists are `occupation` blocks in packs; the sheet itself knows
 * none. Picking one copies what it offers onto the character
 * (`d.occupation`), so the sheet works out the same with the pack gone.
 * What the picks do is in model/campaign.js (`occupationOf`).
 */
import { OCCUPATION_PICKS } from './model/campaign.js';

const str = (v) => String(v ?? '').trim();

/** The select's value for an occupation the player writes themself. */
export const OWN_OCCUPATION = '__own';

/** The enabled packs' occupations, by name; the last pack to name one wins. */
export function occupationBlocks(blocks) {
  const byName = new Map();
  for (const b of blocks || []) {
    if (b?.kind !== 'occupation' || !str(b.name)) continue;
    byName.set(str(b.name).toLowerCase(), b);
  }
  return [...byName.values()].sort((a, b) => str(a.name).localeCompare(str(b.name)));
}

/**
 * Set the character's occupation: a pack's block, the player's own
 * (`OWN_OCCUPATION`), or none (''). One undo step; the picks made for the
 * occupation before start again.
 */
export function chooseOccupation(model, choice) {
  if (choice && typeof choice === 'object') {
    model.set('occupation', {
      name: str(choice.name),
      listed: true,
      picks: Number(choice.picks) || OCCUPATION_PICKS,
      offers: [...(choice.skills || [])],
      feats: [...(choice.feats || [])],
      money: str(choice.money),
      alignment: str(choice.alignment),
      skills: {},
    });
    return;
  }
  model.set('occupation', choice === OWN_OCCUPATION ? { name: '', picks: OCCUPATION_PICKS, skills: {} } : {});
}
