/**
 * ui/panels/campaign.js -- the Campaign rules panel, first on the ⚙ tab.
 *
 * One line per switch: what it is, the control, and what turning it changes.
 * A switch that still follows the table's rules says so; one that does not is
 * marked, and the heading counts them, so a sheet played under other rules is
 * obvious at a glance. Everything binds straight to `campaign.*` on the
 * document (see model/campaign.js), so the ordinary change handler saves it
 * and recomputes the sheet.
 */
import { esc } from '../html.js';
import { CAMPAIGN_DEFAULTS, campaignChanges, campaignRules } from '../../model/campaign.js';

/** The anchor the ⋯ menu and the search scroll to. */
export const CAMPAIGN_PANEL_ID = 'campaign-rules';

export function campaignPanel(model) {
  const d = model.data;
  const rules = campaignRules(d);
  const changed = new Set(campaignChanges(d));
  const mark = (k) => (changed.has(k)
    ? '<span class="badge player" title="Not the table\'s rule">changed</span>' : '');
  const check = (k, label) => `<label class="chk">
      <input type="checkbox" ${rules[k] ? 'checked' : ''} data-set="campaign.${k}" data-kind="bool">
      <span>${esc(label)}</span></label>`;
  const row = (k, title, control, hint) => `<div class="camprow${changed.has(k) ? ' changed' : ''}">
      <div class="campname">${esc(title)} ${mark(k)}</div>
      <div class="campctl">${control}</div>
      <p class="campnote">${hint}</p>
    </div>`;
  const tierSelect = `<select data-set="campaign.mythicTier" aria-label="Where the mythic tier comes from"${rules.mythic ? '' : ' disabled'}>
      <option value="level"${rules.mythicTier === 'level' ? ' selected' : ''}>From character level</option>
      <option value="awarded"${rules.mythicTier === 'awarded' ? ' selected' : ''}>Awarded by the GM</option>
    </select>`;
  return `<section class="panel span2 campaign" id="${CAMPAIGN_PANEL_ID}">
      <h3>Campaign rules
        <span class="badge${changed.size ? ' player' : ' ok'}">${changed.size
    ? `${changed.size} changed from the table's` : 'the table\'s rules'}</span>
        ${changed.size ? '<button data-action="campaign-reset" style="margin-left:auto" title="Put every switch back to the table\'s rule">Back to the table\'s rules</button>' : ''}
      </h3>
      <p class="hint">The rules this character is played under. Each switch starts at the table's
        rule; changing one changes the sheet's numbers at once, and only for this character.</p>
      <div class="camprows">
        ${row('pointBuy', 'Point buy',
    `<input type="number" min="0" max="99" value="${esc(rules.pointBuy)}" data-set="campaign.pointBuy" data-kind="number"
          aria-label="Point-buy budget" style="width:4.5rem"> points`,
    `What the ability scores may cost, checked on the <strong>Stats</strong> tab. The table's is ${CAMPAIGN_DEFAULTS.pointBuy}.`)}
        ${row('heroPoints', 'Hero points', check('heroPoints', 'Track hero points'),
    'Off, the Details panel drops its hero point counter. The points written there are kept.')}
        ${row('mythic', 'Mythic', check('mythic', 'Mythic is in play'),
    `Off, the tier is 0: no mythic hit points, Mythic Power, ability increases or tradition.
          <strong>Feats &amp; Mythic</strong> becomes <strong>Feats</strong>, with a note in place of
          the mythic panels. What was written there is kept.`)}
        ${row('mythicTier', 'Mythic tier', tierSelect,
    `From level is the table's ladder: tier 1 at 8th level, 2 at 10th, 3 at 12th, 4 at 14th,
          then one a level to 10 at 20th. Awarded is the tier the GM hands out (for trials, say):
          type it in <strong>Tier</strong> on <strong>Feats &amp; Mythic</strong>. It starts at 0.`)}
        ${row('abp', 'Automatic Bonus Progression', check('abp', 'Use ABP'),
    `Off, ABP adds nothing: no resistance, deflection or natural armour bonuses and no prowess
          picks, and the <strong>Stats</strong> tab drops their columns. A cloak's resistance or a
          ring's deflection goes in the typed columns there instead.`)}
      </div>
      <p class="hint">Not here yet: experience points and levelling up, gestalt off, and hit points
        rolled or averaged per level. The sheet uses the table's rules for those.</p>
    </section>`;
}
