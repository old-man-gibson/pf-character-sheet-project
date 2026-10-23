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
 *
 * The first row says whom the rules are for: every character (the rules the
 * browser shares, see shared-rules.js, passed in as `ctx.sharedRules`) or
 * this character alone. The panel folds like any other.
 */
import { esc } from '../html.js';
import { collapsible, collapsibleSub, stepGrid } from '../rows.js';
import {
  CAMPAIGN_DEFAULTS, MAX_TIER, TIER_CEILING, XP_TRACKS, campaignChanges, campaignRules, followsShared,
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

/** A box for the lowest or highest level, or the highest tier, a campaign has; no ceiling where it is null. */
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
    ? `Every character in this browser follows these rules unless it is set to its own, so a change here
      changes them all. They are also under <strong>Extensions and Rules</strong>.`
    : shared?.on
      ? `This character keeps rules of its own. The others follow the rules every character shares, under
        <strong>Extensions and Rules</strong>.`
      : ctx.campaignShareArmed
        ? `Press <strong>Every character</strong> again: every character will follow these rules from the next
          time it opens, unless it is set to its own.`
        : `Each character keeps its own rules. <strong>Every character</strong> shares these with all of them.`;
  return `<div class="camprow campscope">
      <div class="campname">These rules apply to</div>
      <div class="campctl pair">
        ${button('all', 'Every character', follows, shared?.on ? 'Follow the rules every character shares' : 'Share these rules with every character')}
        ${button('own', 'This character only', !follows, 'Keep rules of this character\'s own')}
      </div>
      <p class="campnote">${note}</p>
    </div>`;
}

export function campaignPanel(model, ctx = {}) {
  const d = model.data;
  const rules = campaignRules(d);
  const changed = new Set(campaignChanges(d));
  // A row may hold more than one switch (ABP and which ABP): it is changed
  // when any of them is.
  const differs = (k) => [].concat(k).some((x) => changed.has(x));
  const mark = (k) => (differs(k)
    ? '<span class="badge player" title="Not the table\'s rule">changed</span>' : '');
  const check = (k, label, disabled = false) => `<label class="chk">
      <input type="checkbox" ${rules[k] ? 'checked' : ''} data-set="campaign.${k}" data-kind="bool"${disabled ? ' disabled' : ''}>
      <span>${esc(label)}</span></label>`;
  // A character just made opens here first (`uiPrefs.rulesFirst`): its rules
  // before anything else, the lowest level the one question that must be
  // answered and the rest the table's or the shared rules until changed.
  const first = d.uiPrefs?.rulesFirst === true;
  const required = (k) => first && k === 'minLevel';
  const row = (k, title, control, hint, below = '') => `<div class="camprow${differs(k) ? ' changed' : ''}${required(k) ? ' required' : ''}">
      <div class="campname">${esc(title)} ${mark(k)}${required(k) ? ' <span class="badge need">set this</span>' : ''}</div>
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
      ${collapsibleSub(model, 'campaign-xp-steps', 'XP for each level, in all', `${campaignSteps(d, 'xpSteps', 2, rules.maxLevel,
    (l) => xpTable[l] ?? '', (l) => `XP for level ${l}`)}
        <p class="campnote">Blank follows the table. A number is this campaign's own.</p>`, '', true)}`
    : rules.advancement === 'milestones'
      ? `<div class="pair">${ruleCount('milestoneRate', rules.milestoneRate, 'Milestones a level', 'a level')}</div>
      ${collapsibleSub(model, 'campaign-milestone-steps', 'Milestones for each level, from the one before', `${campaignSteps(d, 'milestoneSteps', 2, rules.maxLevel,
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
      ? collapsibleSub(model, 'campaign-tier-levels', 'The level each tier comes at', `${campaignSteps(d, 'mythicLevels', 1, rules.maxTier,
        (t) => MYTHIC_TIER_LEVEL[t] ?? '', (t) => `Level for tier ${t}`)}
        <p class="campnote">Blank follows the table's ladder. A number is this campaign's own.</p>`, '', true)
      : rules.mythicTier === 'trials'
        ? `<div class="pair">${ruleCount('mythicTrialRate', rules.mythicTrialRate, 'Trials a tier', 'a tier')}</div>
        ${collapsibleSub(model, 'campaign-trial-steps', 'Trials for each tier, from the one before', `${campaignSteps(d, 'mythicTrialSteps', 1, rules.maxTier,
    () => rules.mythicTrialRate, (t) => `Trials for tier ${t}`)}
        <p class="campnote">Blank takes the rate above. A number is that tier's own.</p>`, '', true)}`
        : '';

  return collapsible(model, CAMPAIGN_PANEL_ID, `<section class="panel span2 campaign" id="${CAMPAIGN_PANEL_ID}">
      <h3>Campaign rules
        <span class="badge${changed.size ? ' player' : ' ok'}">${changed.size
    ? `${changed.size} changed from the table's` : 'the table\'s rules'}</span>
        <span class="pair" style="margin-left:auto">
          <button data-action="campaign-save" title="Download these rules as campaign-rules.json">Save as a file</button>
          <button data-action="campaign-load" title="Take the rules from a campaign rules file or a character's file">Load from a file…</button>
          ${changed.size ? '<button data-action="campaign-reset" title="Put every switch back to the table\'s rule">Back to the table\'s rules</button>' : ''}
        </span>
        <input type="file" accept="application/json,.json" data-campaignfile hidden>
      </h3>
      ${/* Kept under the 180 characters past which a hint folds into a
            "Help —" line (#clampHints). */''}
      <p class="hint">The rules this character is played under. Each switch starts at the table's
        rule, and changing one changes the sheet's numbers at once.</p>
      ${first ? `<div class="rulesfirst" role="note">
        <p><strong>A new character: first, the rules this campaign plays by.</strong> Set the lowest level.
          Every other switch starts at ${followsShared(d) ? 'the rules every character shares' : 'the table\'s rules'};
          pick the ones your campaign plays differently, now or later.</p>
        <button class="btn primary" data-action="rules-first-done">Continue to the character</button>
      </div>` : ''}
      <div class="camprows">
        ${scopeRow(d, ctx)}
        ${row('pointBuy', 'Point buy',
    `<input type="number" min="0" max="99" value="${esc(rules.pointBuy)}" data-set="campaign.pointBuy" data-kind="number"
          aria-label="Point-buy budget" style="width:4.5rem"> points`,
    `What the ability scores may cost, checked on the <strong>Stats</strong> tab. The table's is ${CAMPAIGN_DEFAULTS.pointBuy}.`)}
        ${row('advancement', 'Levels', levels, levelsHint, levelsMore)}
        ${row('minLevel', 'Lowest level', mostBox('minLevel', rules.minLevel, rules.maxLevel, 'Lowest level'),
    `Where a character starts: the level box on the <strong>Overview</strong> goes no lower, and a new
          character starts here when every character shares these rules. Any level from 1 up to the highest.
          The table's is ${CAMPAIGN_DEFAULTS.minLevel}.`)}
        ${row('maxLevel', 'Highest level', mostBox('maxLevel', rules.maxLevel, null, 'Highest level'),
    `Where a character stops: <strong>Level up</strong> goes no further and the ladders end there.
          Any level from 1 up. The table's is ${CAMPAIGN_DEFAULTS.maxLevel}.${rules.maxLevel > MAX_LEVEL ? ` Past 20th the <strong>Planner</strong>
          gains a row for each level and class progressions carry on; spell, power point and companion
          tables stay at their 20th-level row, and the Level Up feats stay ten.` : ''}`)}
        ${row('gestalt', 'Gestalt', check('gestalt', 'Gestalt characters'),
    `Each level takes the best of the classes on the <strong>Planner</strong>'s tracks: a good save's
          +2 once, base attack bonus rounded down once. Off, one class a level from the first track,
          each class with its own +2 and its own base attack bonus rounded down; the other tracks are
          kept but not read.`)}
        ${row('hitPoints', 'Hit points', ruleSelect('hitPoints', rules.hitPoints, [
    ['max', 'Maximum every level'], ['average', 'Average after 1st'], ['rolled', 'Rolled after 1st'],
  ], 'Hit points each level'),
    {
      max: 'The whole hit die at every level, as the table does.',
      average: `The whole die at 1st level, then half the die and 1 (5 on a d8) at each level after.`,
      rolled: `The whole die at 1st level, then the roll for each level, kept on the <strong>Hit points</strong>
          panel; a level not rolled yet counts the average.`,
    }[rules.hitPoints])}
        ${row(['skillSystem', 'backgroundRanks', 'backgroundUse'], 'Background', ruleSelect('skillSystem', rules.skillSystem, [
    ['specialty', 'Specialty'], ['background', 'Background skills'],
  ], 'What a character\'s background gives'),
    rules.skillSystem === 'specialty'
      ? `A <strong>Specialty</strong> on the Overview: its name, a feat and two perks, and three specialty
          skills at full ranks, picked on <strong>Skills</strong>, as the table does.`
      : `The skills split into adventuring and background ones, and background ranks each level only
          background skills may take, on <strong>Skills</strong>. They replace the Specialty, its feat and
          perks; what was written there is kept.`,
    rules.skillSystem === 'background'
      ? `<div class="pair">${ruleCount('backgroundRanks', rules.backgroundRanks, 'Background ranks a level', 'ranks a level')}
          ${ruleSelect('backgroundUse', rules.backgroundUse, [
    ['allocated', 'Allocated to picked skills'], ['floating', 'Floating, spent by hand'],
  ], 'How background ranks are taken')}</div>
        <p class="campnote">${rules.backgroundUse === 'allocated'
    ? `Each rank a level is a background skill at full ranks: ${rules.backgroundRanks} picked under
          <strong>Background skills</strong> on Skills, with no ranks typed in. The official rules give 2.`
    : `A pool of ${rules.backgroundRanks} ranks a level, bought by hand in background skills only; past the pool
          they take skill points. The official rules give 2.`}</p>`
      : '')}
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
        ${row('mythicLadder', 'What a tier grants', ruleSelect('mythicLadder', rules.mythicLadder,
    [['table', 'The table\'s'], ['core', 'Core (Mythic Adventures)']], 'What a mythic tier grants', !rules.mythic),
    rules.mythicLadder === 'core'
      ? 'A path ability every tier, a mythic feat on odd tiers and +2 to an ability on even ones.'
      : 'A path ability every tier, a mythic feat on odd tiers, and a path power and +2 to an ability on even ones.')}
        ${row(['abp', 'abpLadder'], 'Automatic Bonus Progression', `${check('abp', 'Use ABP')} ${ruleSelect('abpLadder', rules.abpLadder,
    [['table', 'The table\'s'], ['core', 'Core (Unchained)']], 'Which ABP', !rules.abp)}`,
    `Off, ABP adds nothing: no resistance, deflection or natural armour bonuses and no prowess
          picks, and the <strong>Stats</strong> tab drops their columns. A cloak's resistance or a
          ring's deflection goes in the typed columns there instead.${rules.abpLadder === 'core' ? ` Core adds armour
          and weapon attunement, ticked on the <strong>Stats</strong> tab, stops prowess at 18th, and
          gives legendary gifts at 19th and 20th, written down there.` : ''}`)}
        ${row('altTraining', 'Alternate Training', check('altTraining', 'Offer Alternate Training techniques'),
    `Off, the <strong>Alternate Training</strong> tab goes and its technique grants nothing: no
          talents, feats or bonus ranks from it. What was picked there is kept.`)}
        ${row('pastColossal', 'Past Colossal', check('pastColossal', 'Sizes may grow past Colossal'),
    `A size change past Colossal is counted, not lost: the header reads Colossal+1, +2…, and each step
          past adds 1d6 to a weapon's damage. Attack, AC and maneuver modifiers stay at Colossal's.`)}
        ${row('currency', 'Currency',
    `<input type="text" value="${esc(d.campaign?.currency ?? '')}" placeholder="${esc(rules.currency)}" data-set="campaign.currency"
          data-kind="text" aria-label="What the money is called" style="width:9rem">`,
    `What the money is called: the <strong>Wealth</strong> wallet's name, and crafting's unit where a
          crafter has not named one. The coin purse on <strong>Gear</strong> keeps its platinum, gold,
          silver and copper. The table's is ${esc(CAMPAIGN_DEFAULTS.currency)}.`)}
      </div>
    </section>`);
}
