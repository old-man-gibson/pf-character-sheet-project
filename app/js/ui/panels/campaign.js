/**
 * ui/panels/campaign.js -- the Campaign rules panel, first on the ⚙ tab.
 *
 * One line per switch: what it is, the control, and what turning it changes.
 * A switch that still follows the table's rules says so; one that does not is
 * marked, and the heading counts them, so a sheet played under other rules is
 * obvious at a glance. Everything binds straight to `campaign.*` on the
 * document (see model/campaign.js), so the ordinary change handler saves it
 * and recomputes the sheet.
 *
 * Two rules carry a ladder -- how a level or a tier is earned -- and the
 * ladder sits under its row, folded: a box per step, blank where the step
 * follows the rule's rate or table, a number where the campaign says
 * otherwise.
 */
import { esc } from '../html.js';
import { collapsibleSub } from '../rows.js';
import {
  CAMPAIGN_DEFAULTS, LEVEL_CEILING, MAX_TIER, TIER_CEILING, XP_TRACKS, campaignChanges, campaignRules,
} from '../../model/campaign.js';
import { MAX_LEVEL, MYTHIC_TIER_LEVEL } from '../../rules.js';

/** The anchor the ⋯ menu and the search scroll to. */
export const CAMPAIGN_PANEL_ID = 'campaign-rules';

const XP_TRACK_NAMES = { slow: 'Slow', medium: 'Medium', fast: 'Fast' };

/** A select bound to a `campaign.*` rule. */
function ruleSelect(key, value, options, label, disabled = false) {
  return `<select data-set="campaign.${key}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>
      ${options.map(([id, name]) => `<option value="${id}"${value === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}
    </select>`;
}

/** A small number box for a count a rule is measured in. */
function ruleCount(key, value, label, unit) {
  return `<span class="pair"><input type="number" min="0" max="99" value="${esc(value)}" data-set="campaign.${key}"
      data-kind="number" aria-label="${esc(label)}" style="width:4.2rem"> ${esc(unit)}</span>`;
}

/** A box for the highest level or tier a campaign reaches. */
function mostBox(key, value, ceiling, label, disabled = false) {
  return `<input type="number" min="1" max="${ceiling}" value="${esc(value)}" data-set="campaign.${key}" data-kind="number"
      aria-label="${esc(label)}" style="width:4.2rem"${disabled ? ' disabled' : ''}>`;
}

/**
 * A ladder, a box per step. Blank follows `auto(step)`, shown as the box's
 * placeholder; a number is the campaign's own, kept under `campaign.<map>`.
 */
function stepGrid(d, map, from, to, auto, label) {
  const own = d.campaign?.[map] || {};
  return `<div class="stepgrid">${Array.from({ length: to - from + 1 }, (_, i) => {
    const step = from + i;
    const value = own[step] ?? '';
    return `<label class="stepcell${value !== '' && value !== null ? ' own' : ''}"><span>${step}</span>
        <input type="number" min="0" value="${esc(value ?? '')}" placeholder="${esc(auto(step))}"
          data-set="campaign.${map}.${step}" data-kind="number-or-null" aria-label="${esc(label(step))}"></label>`;
  }).join('')}</div>`;
}

export function campaignPanel(model) {
  const d = model.data;
  const rules = campaignRules(d);
  const changed = new Set(campaignChanges(d));
  const mark = (k) => (changed.has(k)
    ? '<span class="badge player" title="Not the table\'s rule">changed</span>' : '');
  const check = (k, label, disabled = false) => `<label class="chk">
      <input type="checkbox" ${rules[k] ? 'checked' : ''} data-set="campaign.${k}" data-kind="bool"${disabled ? ' disabled' : ''}>
      <span>${esc(label)}</span></label>`;
  const row = (k, title, control, hint, below = '') => `<div class="camprow${changed.has(k) ? ' changed' : ''}">
      <div class="campname">${esc(title)} ${mark(k)}</div>
      <div class="campctl">${control}</div>
      <p class="campnote">${hint}</p>
      ${below ? `<div class="campmore">${below}</div>` : ''}
    </div>`;

  /* How levels are earned. */
  const levels = ruleSelect('advancement', rules.advancement, [
    ['typed', 'Typed in'], ['xp', 'Experience points'], ['milestones', 'Milestones'],
  ], 'How levels are earned');
  const xpTable = XP_TRACKS[rules.xpTrack];
  const levelsHint = {
    typed: 'The level is typed on the <strong>Overview</strong>, as the table does.',
    xp: `XP is kept on the <strong>Overview</strong> against the ${esc(XP_TRACK_NAMES[rules.xpTrack].toLowerCase())}
      table (${xpTable[2].toLocaleString('en-US')} for 2nd, ${xpTable[MAX_LEVEL].toLocaleString('en-US')} for 20th).${
  rules.maxLevel > MAX_LEVEL ? ' Past 20th the table has no figures: give each level its own below.' : ''}
      Once the next level is earned, a <strong>Level up</strong> button offers it.`,
    milestones: `Milestones are counted on the <strong>Overview</strong>, ${rules.milestoneRate} a level unless a
      level below says otherwise. Once the next level is earned, a <strong>Level up</strong> button offers it.`,
  }[rules.advancement];
  const levelsMore = rules.advancement === 'xp'
    ? `<div class="pair">Table ${ruleSelect('xpTrack', rules.xpTrack, Object.entries(XP_TRACK_NAMES), 'XP table')}</div>
      ${collapsibleSub(model, 'campaign-xp-steps', 'XP for each level, in all', `${stepGrid(d, 'xpSteps', 2, rules.maxLevel,
    (l) => xpTable[l] ?? '', (l) => `XP for level ${l}`)}
        <p class="campnote">Blank follows the table. A number is this campaign's own.</p>`, '', true)}`
    : rules.advancement === 'milestones'
      ? `<div class="pair">${ruleCount('milestoneRate', rules.milestoneRate, 'Milestones a level', 'a level')}</div>
      ${collapsibleSub(model, 'campaign-milestone-steps', 'Milestones for each level, from the one before', `${stepGrid(d, 'milestoneSteps', 2, rules.maxLevel,
    () => rules.milestoneRate, (l) => `Milestones for level ${l}`)}
        <p class="campnote">Blank takes the rate above. A number is that level's own.</p>`, '', true)}`
      : '';

  /* Where the mythic tier comes from. */
  const tierSelect = ruleSelect('mythicTier', rules.mythicTier, [
    ['level', 'From character level'], ['trials', 'From trials'], ['awarded', 'Awarded by the GM'],
  ], 'Where the mythic tier comes from', !rules.mythic);
  const tierHint = {
    level: `A tier at each of a ladder of levels. The table's is 1 at 8th level, 2 at 10th, 3 at 12th,
      4 at 14th, then one a level to 10 at 20th.${rules.maxTier > MAX_TIER
    ? ' Past 10th the table\'s ladder has no levels: give each tier its own below.' : ''}`,
    trials: `Trials completed, counted on <strong>Feats &amp; Mythic</strong>: ${rules.mythicTrialRate} a tier
      unless a tier below says otherwise. Once the next tier is earned, a <strong>Tier up</strong> button offers it.`,
    awarded: 'The tier the GM hands out: type it in <strong>Tier</strong> on <strong>Feats &amp; Mythic</strong>. It starts at 0.',
  }[rules.mythicTier];
  const tierMore = !rules.mythic ? ''
    : rules.mythicTier === 'level'
      ? collapsibleSub(model, 'campaign-tier-levels', 'The level each tier comes at', `${stepGrid(d, 'mythicLevels', 1, rules.maxTier,
        (t) => MYTHIC_TIER_LEVEL[t] ?? '', (t) => `Level for tier ${t}`)}
        <p class="campnote">Blank follows the table's ladder. A number is this campaign's own.</p>`, '', true)
      : rules.mythicTier === 'trials'
        ? `<div class="pair">${ruleCount('mythicTrialRate', rules.mythicTrialRate, 'Trials a tier', 'a tier')}</div>
        ${collapsibleSub(model, 'campaign-trial-steps', 'Trials for each tier, from the one before', `${stepGrid(d, 'mythicTrialSteps', 1, rules.maxTier,
    () => rules.mythicTrialRate, (t) => `Trials for tier ${t}`)}
        <p class="campnote">Blank takes the rate above. A number is that tier's own.</p>`, '', true)}`
        : '';

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
        ${row('advancement', 'Levels', levels, levelsHint, levelsMore)}
        ${row('maxLevel', 'Highest level', mostBox('maxLevel', rules.maxLevel, LEVEL_CEILING, 'Highest level'),
    `Where a character stops: <strong>Level up</strong> goes no further and the ladders end there.
          The table's is ${CAMPAIGN_DEFAULTS.maxLevel}.${rules.maxLevel > MAX_LEVEL ? ` Past 20th the <strong>Planner</strong>
          gains a row for each level and class progressions carry on; spell, power point and companion
          tables stay at their 20th-level row, and the Level Up feats stay ten.` : ''}`)}
        ${row('heroPoints', 'Hero points', check('heroPoints', 'Track hero points'),
    `Kept on the <strong>Details</strong> panel and as a Hero Points pool on <strong>Trackers</strong>,
          where a point spent is undone like any play. Off, the counter goes and the pool may be
          removed. The points written there are kept.`)}
        ${row('antiheroes', 'Antiheroes', check('antiheroes', 'Allow antiheroes', !rules.heroPoints),
    `A character may give up hero points for a bonus feat: an <strong>Antihero</strong> box beside
          the hero points on <strong>Details</strong>. Ticked, the points go and <strong>Feats</strong>
          gains an Antihero feat row.`)}
        ${row('mythic', 'Mythic', check('mythic', 'Mythic is in play'),
    `Off, the tier is 0: no mythic hit points, Mythic Power, ability increases or tradition.
          <strong>Feats &amp; Mythic</strong> becomes <strong>Feats</strong>, with a note in place of
          the mythic panels. What was written there is kept.`)}
        ${row('mythicTier', 'Mythic tier', tierSelect, tierHint, tierMore)}
        ${row('maxTier', 'Highest mythic tier', mostBox('maxTier', rules.maxTier, TIER_CEILING, 'Highest mythic tier', !rules.mythic),
    `Where mythic stops: the ladders, trials and <strong>Tier up</strong> end there, and
          <strong>Feats &amp; Mythic</strong> lists that many tiers. The table's is ${CAMPAIGN_DEFAULTS.maxTier}.`)}
        ${row('abp', 'Automatic Bonus Progression', check('abp', 'Use ABP'),
    `Off, ABP adds nothing: no resistance, deflection or natural armour bonuses and no prowess
          picks, and the <strong>Stats</strong> tab drops their columns. A cloak's resistance or a
          ring's deflection goes in the typed columns there instead.`)}
        ${row('altTraining', 'Alternate Training', check('altTraining', 'Offer Alternate Training techniques'),
    `Off, the <strong>Alternate Training</strong> tab goes and its technique grants nothing: no
          talents, feats or bonus ranks from it. What was picked there is kept.`)}
        ${row('currency', 'Currency',
    `<input type="text" value="${esc(d.campaign?.currency ?? '')}" placeholder="${esc(rules.currency)}" data-set="campaign.currency"
          data-kind="text" aria-label="What the money is called" style="width:9rem">`,
    `What the money is called: the <strong>Wealth</strong> wallet's name, and crafting's unit where a
          crafter has not named one. The coin purse on <strong>Gear</strong> keeps its platinum, gold,
          silver and copper. The table's is ${esc(CAMPAIGN_DEFAULTS.currency)}.`)}
      </div>
      <p class="hint">Not here yet: gestalt off, and hit points rolled or averaged per level. The
        sheet uses the table's rules for those.</p>
    </section>`;
}
