/**
 * ui/panels/campaign.js -- the Campaign rules panel, first on the ⚙ tab.
 *
 * One row per rule: its name, the control, and one short sentence on what it
 * does. A rule changed from its default is marked, and the heading counts
 * them. Everything binds straight to `campaign.*` on the document (see
 * model/campaign.js), so the ordinary change handler saves it and recomputes
 * the sheet.
 *
 * Two rules carry a ladder (how a level or a tier is earned), folded under
 * the row: a box per step, blank uses the default, a number overrides it.
 *
 * The first row says whom the rules are for: every character (the rules the
 * browser shares, see shared-rules.js, passed in as `ctx.sharedRules`) or
 * this character alone. The panel folds like any other.
 */
import { esc } from '../html.js';
import { collapsible, collapsibleSub, stepGrid } from '../rows.js';
import {
  MAX_TIER, TIER_CEILING, XP_TRACKS, campaignChanges, campaignRules, followsShared,
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

/** A box for the lowest or highest level, or the highest tier; no ceiling where it is null. */
function mostBox(key, value, ceiling, label, disabled = false) {
  return `<input type="number" min="1"${ceiling == null ? '' : ` max="${ceiling}"`} value="${esc(value)}" data-set="campaign.${key}" data-kind="number"
      aria-label="${esc(label)}" style="width:4.2rem"${disabled ? ' disabled' : ''}>`;
}

/**
 * A campaign ladder (rows.stepGrid): a box per step, blank following the
 * rule, a number the campaign's own, kept under `campaign.<map>`.
 */
function campaignSteps(d, map, from, to, auto, label) {
  return stepGrid(`campaign.${map}`, d.campaign?.[map], from, to, auto, label);
}

/**
 * Whom the rules are for: every character, sharing one set, or this one
 * alone. Choosing every character where nothing is shared yet shares these
 * rules with all of them, so it asks twice (`ctx.campaignShareArmed`).
 */
function scopeRow(d, ctx) {
  const shared = ctx.sharedRules || null;
  const follows = followsShared(d, shared);
  const button = (scope, label, on, title) => `<button data-action="campaign-scope" data-scope="${scope}"
      aria-pressed="${on}"${on ? ' class="primary"' : ''} title="${esc(title)}">${esc(label)}</button>`;
  const note = follows
    ? 'All characters in this browser use these rules. Also in <strong>Extensions and Rules</strong>.'
    : shared?.on
      ? 'This character uses its own rules. Other characters use the shared rules.'
      : ctx.campaignShareArmed
        ? 'Press <strong>Every character</strong> again to apply these rules to all characters.'
        : 'This character uses its own rules.';
  return `<div class="camprow campscope">
      <div class="campname">These rules apply to</div>
      <div class="campctl pair">
        ${button('all', 'Every character', follows, shared?.on ? 'Use the shared rules' : 'Share these rules with every character')}
        ${button('own', 'This character only', !follows, 'Use rules for this character only')}
      </div>
      <p class="campnote">${note}</p>
    </div>`;
}

export function campaignPanel(model, ctx = {}) {
  const d = model.data;
  const rules = campaignRules(d);
  const changed = new Set(campaignChanges(d));
  // A row may hold more than one rule (ABP and which ABP): it is changed
  // when any of them is.
  const differs = (k) => [].concat(k).some((x) => changed.has(x));
  const mark = (k) => (differs(k)
    ? '<span class="badge player" title="Not the default">changed</span>' : '');
  const check = (k, label, disabled = false) => `<label class="chk">
      <input type="checkbox" ${rules[k] ? 'checked' : ''} data-set="campaign.${k}" data-kind="bool"${disabled ? ' disabled' : ''}>
      <span>${esc(label)}</span></label>`;
  // A character just made opens here first (`uiPrefs.rulesFirst`), with the
  // lowest level marked as the one rule it must set.
  const first = d.uiPrefs?.rulesFirst === true;
  const required = (k) => first && k === 'minLevel';
  const row = (k, title, control, hint, below = '') => `<div class="camprow${differs(k) ? ' changed' : ''}${required(k) ? ' required' : ''}">
      <div class="campname">${esc(title)} ${mark(k)}${required(k) ? ' <span class="badge need">required</span>' : ''}</div>
      <div class="campctl">${control}</div>
      <p class="campnote">${hint}</p>
      ${below ? `<div class="campmore">${below}</div>` : ''}
    </div>`;

  /* How levels are earned. */
  const levels = ruleSelect('advancement', rules.advancement, [
    ['typed', 'Manual'], ['xp', 'Experience points'], ['milestones', 'Milestones'],
  ], 'How levels are earned');
  const xpTable = XP_TRACKS[rules.xpTrack];
  const levelsHint = {
    typed: 'Level is entered manually.',
    xp: `Levels are earned with XP (${esc(XP_TRACK_NAMES[rules.xpTrack].toLowerCase())} track). Level up appears at each
      threshold.${rules.maxLevel > MAX_LEVEL ? ' Set XP for levels above 20 below.' : ''}`,
    milestones: `Levels are earned with milestones (${rules.milestoneRate} per level). Level up appears at each threshold.`,
  }[rules.advancement];
  const levelsMore = rules.advancement === 'xp'
    ? `<div class="pair">Track ${ruleSelect('xpTrack', rules.xpTrack, Object.entries(XP_TRACK_NAMES), 'XP track')}</div>
      ${collapsibleSub(model, 'campaign-xp-steps', 'XP per level (total)', `${campaignSteps(d, 'xpSteps', 2, rules.maxLevel,
    (l) => xpTable[l] ?? '', (l) => `XP for level ${l}`)}
        <p class="campnote">Blank uses the track.</p>`, '', true)}`
    : rules.advancement === 'milestones'
      ? `<div class="pair">${ruleCount('milestoneRate', rules.milestoneRate, 'Milestones per level', 'per level')}</div>
      ${collapsibleSub(model, 'campaign-milestone-steps', 'Milestones per level', `${campaignSteps(d, 'milestoneSteps', 2, rules.maxLevel,
    () => rules.milestoneRate, (l) => `Milestones for level ${l}`)}
        <p class="campnote">Blank uses the rate.</p>`, '', true)}`
      : '';

  /* Where the mythic tier comes from. */
  const tierSelect = ruleSelect('mythicTier', rules.mythicTier, [
    ['level', 'Character level'], ['trials', 'Trials'], ['awarded', 'Set by GM'],
  ], 'Where the mythic tier comes from', !rules.mythic);
  const tierHint = {
    level: `Tier is set by character level (default: 1 at 8th, 2 at 10th, 3 at 12th, 4 at 14th, then +1 per
      level to 10 at 20th).${rules.maxTier > MAX_TIER ? ' Set levels for tiers above 10 below.' : ''}`,
    trials: `Tier is set by completed trials (${rules.mythicTrialRate} per tier). Tier up appears at each threshold.`,
    awarded: 'Tier is entered manually on <strong>Feats &amp; Mythic</strong>.',
  }[rules.mythicTier];
  const tierMore = !rules.mythic ? ''
    : rules.mythicTier === 'level'
      ? collapsibleSub(model, 'campaign-tier-levels', 'Level per tier', `${campaignSteps(d, 'mythicLevels', 1, rules.maxTier,
        (t) => MYTHIC_TIER_LEVEL[t] ?? '', (t) => `Level for tier ${t}`)}
        <p class="campnote">Blank uses the default.</p>`, '', true)
      : rules.mythicTier === 'trials'
        ? `<div class="pair">${ruleCount('mythicTrialRate', rules.mythicTrialRate, 'Trials per tier', 'per tier')}</div>
        ${collapsibleSub(model, 'campaign-trial-steps', 'Trials per tier', `${campaignSteps(d, 'mythicTrialSteps', 1, rules.maxTier,
    () => rules.mythicTrialRate, (t) => `Trials for tier ${t}`)}
        <p class="campnote">Blank uses the rate.</p>`, '', true)}`
        : '';

  return collapsible(model, CAMPAIGN_PANEL_ID, `<section class="panel span2 campaign" id="${CAMPAIGN_PANEL_ID}">
      <h3>Campaign rules
        <span class="badge${changed.size ? ' player' : ' ok'}">${changed.size ? `${changed.size} changed` : 'defaults'}</span>
        <span class="pair" style="margin-left:auto">
          <button data-action="campaign-save" title="Download these rules as campaign-rules.json">Save as a file</button>
          <button data-action="campaign-load" title="Load rules from a campaign rules file or a character file">Load from a file…</button>
          ${changed.size ? '<button data-action="campaign-reset" title="Reset every rule to its default">Reset to defaults</button>' : ''}
        </span>
        <input type="file" accept="application/json,.json" data-campaignfile hidden>
      </h3>
      <p class="hint">Rules for this character. Changes apply immediately.</p>
      ${first ? `<div class="rulesfirst" role="note">
        <p><strong>New character:</strong> set the campaign rules. Lowest level is required; the rest are optional.</p>
        <button class="btn primary" data-action="rules-first-done">Continue</button>
      </div>` : ''}
      <div class="camprows">
        ${scopeRow(d, ctx)}
        ${row('pointBuy', 'Point buy',
    `<input type="number" min="0" max="99" value="${esc(rules.pointBuy)}" data-set="campaign.pointBuy" data-kind="number"
          aria-label="Point-buy budget" style="width:4.5rem"> points`,
    'Point budget for ability scores.')}
        ${row('agingEffects', 'Age effects', check('agingEffects', 'Age effects'),
    'Age categories change ability scores. Cumulative: Middle-Aged −1 Str/Dex/Con, +1 Int/Wis/Cha; Old −2/+1; Venerable −3/+1.')}
        ${row('advancement', 'Levels', levels, levelsHint, levelsMore)}
        ${row('minLevel', 'Lowest level', mostBox('minLevel', rules.minLevel, rules.maxLevel, 'Lowest level'),
    'This is the minimum legal level for a character. New characters start here.')}
        ${row('maxLevel', 'Highest level', mostBox('maxLevel', rules.maxLevel, null, 'Highest level'),
    `This is the maximum legal level for a character and ends its progression there.${rules.maxLevel > MAX_LEVEL
      ? ' Tables that stop at 20 use their 20th-level row.' : ''}`)}
        ${row('gestalt', 'Gestalt', check('gestalt', 'Gestalt'),
    'Each level advances two classes; base saves and BAB use the better of the two. Off: one class per level.')}
        ${row('hitPoints', 'Hit points', ruleSelect('hitPoints', rules.hitPoints, [
    ['max', 'Maximum per level'], ['average', 'Average after 1st'], ['rolled', 'Rolled after 1st'],
  ], 'Hit points per level'),
    {
      max: 'The character gains HP equal to their die size.',
      average: 'Full die at 1st level, then half the die +1 per level.',
      rolled: 'Full die at 1st level, then rolled per level on the <strong>Hit points</strong> panel. Unrolled levels use the average.',
    }[rules.hitPoints])}
        ${row(['skillSystem', 'backgroundRanks', 'backgroundUse'], 'Background', ruleSelect('skillSystem', rules.skillSystem, [
    ['specialty', 'Specialty'], ['background', 'Background skills'],
  ], 'Specialty or background skills'),
    rules.skillSystem === 'specialty'
      ? 'Specialty name, feat, two perks, and three specialty skills at full ranks.'
      : 'Background skills replace the Specialty. Background ranks can only buy background skills.',
    rules.skillSystem === 'background'
      ? `<div class="pair">${ruleCount('backgroundRanks', rules.backgroundRanks, 'Background ranks per level', 'ranks per level')}
          ${ruleSelect('backgroundUse', rules.backgroundUse, [['allocated', 'Allocated'], ['floating', 'Floating']], 'How background ranks are used')}</div>
        <p class="campnote">${rules.backgroundUse === 'allocated'
    ? 'Each background rank per level gives one picked skill full ranks (picked on <strong>Skills</strong>).'
    : 'Background ranks form a pool for background skills only.'}</p>`
      : '')}
        ${row('vmc', 'Variant multiclassing', check('vmc', 'Variant multiclassing'),
    'Characters may pick a secondary class on <strong>Progression</strong>. Its features replace the feats at 3rd, 7th, 11th, 15th and 19th.')}
        ${row('heroPoints', 'Hero points', check('heroPoints', 'Hero points'),
    'Hero points are tracked on <strong>Details</strong> and as a <strong>Trackers</strong> pool.')}
        ${row('antiheroes', 'Antiheroes', check('antiheroes', 'Antiheroes', !rules.heroPoints),
    'Characters may give up hero points for a bonus feat.')}
        ${row('mythic', 'Mythic', check('mythic', 'Mythic'),
    'Enables mythic tiers. Off sets the tier to 0.')}
        ${row('mythicTier', 'Mythic tier', tierSelect, tierHint, tierMore)}
        ${row('maxTier', 'Highest mythic tier', mostBox('maxTier', rules.maxTier, TIER_CEILING, 'Highest mythic tier', !rules.mythic),
    'This is the maximum mythic tier.')}
        ${row('mythicLadder', 'What a tier grants', ruleSelect('mythicLadder', rules.mythicLadder,
    [['table', 'Table'], ['core', 'Core (Mythic Adventures)']], 'What a mythic tier grants', !rules.mythic),
    rules.mythicLadder === 'core'
      ? 'Path ability every tier; mythic feat on odd tiers; +2 ability on even tiers.'
      : 'Path ability every tier; mythic feat on odd tiers; path power and +2 ability on even tiers.')}
        ${row(['abp', 'abpLadder'], 'Automatic Bonus Progression', `${check('abp', 'ABP')} ${ruleSelect('abpLadder', rules.abpLadder,
    [['table', 'Table'], ['core', 'Core (Unchained)']], 'Which ABP', !rules.abp)}`,
    `Enables Automatic Bonus Progression (saves, AC, prowess).${rules.abpLadder === 'core'
      ? ' Core adds armor and weapon attunement and legendary gifts; prowess stops at 18th.' : ''}`)}
        ${row('altTraining', 'Alternate Training', check('altTraining', 'Alternate Training'),
    'Enables Alternate Training techniques.')}
        ${row('pastColossal', 'Past Colossal', check('pastColossal', 'Past Colossal'),
    'Allows sizes beyond Colossal. Each step adds 1d6 weapon damage.')}
        ${row('currency', 'Currency',
    `<input type="text" value="${esc(d.campaign?.currency ?? '')}" placeholder="${esc(rules.currency)}" data-set="campaign.currency"
          data-kind="text" aria-label="Currency name" style="width:9rem">`,
    'Name of the campaign currency.')}
      </div>
    </section>`);
}
