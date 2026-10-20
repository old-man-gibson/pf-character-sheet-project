/** Campaign rules: the per-character switches in model/campaign.js.
 *
 *  Three promises are held here. A sheet with no campaign block, or with every
 *  switch written at the table's rule, works out exactly as it did before
 *  there were switches -- every total, every hidden adjustment. A switch
 *  flipped while playing survives a save and reload without anything drifting
 *  into those adjustments. And each switch does what its panel says.
 *
 *  Run: node tests/campaign.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import {
  CAMPAIGN_DEFAULTS, XP_TRACKS, awardXp, campaignChanges, campaignRules, levelProgress, levelUp, mythicComputedTier,
  mythicLevels, mythicTierReached, trialProgress, xpThresholds,
} from '../app/js/model/campaign.js';
import { MYTHIC_POWER_ID } from '../app/js/model/trackers.js';
import { abpDefence, tierAtLevel } from '../app/js/rules.js';
import { fixtureIds, loadCharacter } from './fixtures.mjs';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/** A value as text with its keys sorted, so the order a reload writes them in does not count. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
/** What a character works out to, as one comparable value. */
const numbers = (m) => canon({ data: m.toJSON(), offsets: m.offsets });
const reopen = (m) => new Character(JSON.parse(JSON.stringify(m.toJSON())));

console.log('the rules read back with the table\'s as the default');
check('no block is the table\'s rules', campaignRules({}), { ...CAMPAIGN_DEFAULTS });
check('a value of the wrong kind is the default',
  campaignRules({ campaign: { abp: 'no', mythic: 0, mythicTier: 'sometimes', pointBuy: 'lots', advancement: 'vibes', xpTrack: 'glacial', milestoneRate: -2, mythicTrialRate: 'x' } }),
  { ...CAMPAIGN_DEFAULTS });
check('a number typed as text is still a number', campaignRules({ campaign: { pointBuy: '25' } }).pointBuy, 25);
check('the old top-level budget is still read', campaignRules({ pointBuyBudget: 20 }).pointBuy, 20);
check('changes name only what differs', campaignChanges({ campaign: { abp: false, mythic: true } }), ['abp']);

console.log('\nevery character works out the same with the table\'s rules written down');
for (const id of fixtureIds()) {
  const doc = loadCharacter(id);
  const plain = new Character(JSON.parse(JSON.stringify(doc)));
  const written = new Character({ ...JSON.parse(JSON.stringify(doc)), campaign: { ...CAMPAIGN_DEFAULTS } });
  const a = JSON.parse(numbers(plain));
  const b = JSON.parse(numbers(written));
  delete b.data.campaign;
  check(`${id}: same totals and adjustments`, canon(b), canon(a));
}

console.log('\na switch flipped in play survives a reload, and flipping it back restores everything');
for (const id of fixtureIds()) {
  for (const [key, value] of [['abp', false], ['mythic', false], ['heroPoints', false], ['pointBuy', 20], ['mythicTier', 'awarded'],
    ['mythicTier', 'trials'], ['advancement', 'xp'], ['advancement', 'milestones'], ['mythicTrialRate', 3]]) {
    const m = new Character(loadCharacter(id));
    const before = numbers(m);
    m.set(`campaign.${key}`, value);
    const flipped = numbers(m);
    const again = reopen(m);
    check(`${id} ${key}: nothing drifts on reopen`, numbers(again), flipped);
    again.set(`campaign.${key}`, CAMPAIGN_DEFAULTS[key]);
    const back = JSON.parse(numbers(again));
    const orig = JSON.parse(before);
    delete back.data.campaign;
    check(`${id} ${key}: back on, back where it was`, canon(back), canon(orig));
  }
}

console.log('\npoint buy and hero points');
{
  const c = new Character(blankDocument({ name: 'Budget', level: 1 }));
  check('the table\'s budget', c.pointBuySummary().budget, 30);
  c.set('campaign.pointBuy', 15);
  check('a campaign budget', c.pointBuySummary().budget, 15);
}

console.log('\nABP off takes away the ladder and the prowess picks');
{
  const c = new Character(blankDocument({ name: 'Ladder', level: 10 }));
  c.data.progressionPicks = { ...(c.data.progressionPicks || {}), abp: [{ level: 6, mental: 'Int', physical: 'Str' }] };
  c.recompute();
  const on = abpDefence(10);
  const read = () => [c.data.saves.fortitude.bonuses.abpResistance, c.data.defenses.acBonuses.abpDeflection,
    c.data.defenses.acBonuses.abpNatural, c.data.statsBuild.int.abp, c.data.statsBuild.str.abp];
  check('on: the ladder and the picks', read(), [on.abpResistance, on.abpDeflection, on.abpNatural, 2, 2]);
  const intOn = c.data.abilities.int.score;
  c.set('campaign.abp', false);
  check('off: none of it', read(), [0, 0, 0, 0, 0]);
  check('off: the ability score loses the pick', c.data.abilities.int.score, intOn - 2);
  check('off: the picks are kept', c.data.progressionPicks.abp.length, 1);
}

console.log('\nmythic off, and a tier the GM awards');
{
  // Levelled to 16th rather than made there: a blank sheet made at 16th saves
  // its tier as 0, which then reads as a typed tier.
  const c = new Character(blankDocument({ name: 'Mythic', level: 1 }));
  c.set('identity.level', 16);
  c.set('mythic.path', 'Champion');
  check('the table\'s ladder at 16th', c.data.identity.mythicTier, 6);
  check('with mythic hit points', c.mythicHp > 0, true);
  check('and a Mythic Power tracker that stays', [c.trackers.some((t) => t.id === MYTHIC_POWER_ID), c.isProtectedTracker(MYTHIC_POWER_ID)], [true, true]);
  c.set('campaign.mythic', false);
  check('off: tier 0, no mythic hit points', [c.data.identity.mythicTier, c.mythicHp], [0, 0]);
  check('off: Mythic Power may go', c.isProtectedTracker(MYTHIC_POWER_ID), false);
  c.data.mythic.tierOverride = 4;
  c.recompute();
  check('off: a typed tier counts for nothing', c.data.identity.mythicTier, 0);
  c.data.mythic.tierOverride = null;
  c.set('campaign.mythic', true);
  c.set('campaign.mythicTier', 'awarded');
  check('awarded: nothing until the GM says', [c.data.mythic.computedTier, c.data.identity.mythicTier], [0, 0]);
  c.set('mythic.tierOverride', 6);
  check('awarded: the GM\'s tier', c.data.identity.mythicTier, 6);
  check('awarded: kept on reopen, even where the ladder agrees', reopen(c).data.identity.mythicTier, 6);
}
{
  // A mythic tradition's bonus is written down, not in force, with mythic off.
  const c = new Character(blankDocument({ name: 'Tradition', level: 1 }));
  c.set('identity.level', 16);
  const fort = () => c.data.saves.fortitude.total;
  const without = fort();
  c.set('mythic.tradition.notes.quality', 'Hardy {fort += 2}');
  check('on: the tradition\'s bonus counts', fort(), without + 2);
  c.set('campaign.mythic', false);
  check('off: it waits', fort(), without);
}

console.log('\nlevels earned by XP or milestones');
{
  check('the core tables', [XP_TRACKS.slow[20], XP_TRACKS.medium[9], XP_TRACKS.fast[2]], [5350000, 75000, 1300]);
  const c = new Character(blankDocument({ name: 'Levels', level: 1 }));
  c.set('identity.level', 8);
  check('typed: no progress to show', levelProgress(c.data), null);
  c.set('campaign.advancement', 'xp');
  c.set('identity.xp', 51000);
  const p = levelProgress(c.data);
  check('xp: what the next level takes', [p.next, p.need, p.short, p.ready], [9, 75000, 24000, false]);
  check('xp: no level up before it is earned', levelUp(c), false);
  check('xp: an award is a play action', [awardXp(c, 24000), c.data.identity.xp, c.playActions[0]?.label], [true, 75000, '+24,000 XP']);
  check('xp: the level does not move on its own', c.data.identity.level, 8);
  check('xp: levelling is a press', [levelUp(c), c.data.identity.level, c.playActions[0]?.label], [true, 9, 'Levelled up to 9']);
  c.undoPlay();
  check('xp: and undone like one', c.data.identity.level, 8);
  c.set('campaign.xpTrack', 'fast');
  check('xp: the fast table', xpThresholds(c.data)[9], 50000);
  c.set('campaign.xpSteps.9', 60000);
  check('xp: a level of the campaign\'s own', [xpThresholds(c.data)[9], xpThresholds(c.data)[10]], [60000, 71000]);
  check('xp: and it counts as a change', campaignChanges(c.data).includes('advancement'), true);
  c.set('campaign.xpSteps.9', null);
  check('xp: blank goes back to the table', xpThresholds(c.data)[9], 50000);

  c.set('campaign.advancement', 'milestones');
  c.set('campaign.milestoneRate', 2);
  c.set('campaign.milestoneSteps.9', 3);
  c.set('identity.milestones', 4);
  const m = levelProgress(c.data);
  check('milestones: counted since the last level', [m.have, m.need, m.ready], [4, 3, true]);
  levelUp(c);
  check('milestones: levelling spends what it took', [c.data.identity.level, c.data.identity.milestones], [9, 1]);
  check('milestones: the next takes the rate', [levelProgress(c.data).need, levelProgress(c.data).short], [2, 1]);
}

console.log('\nthe Overview shows the progress, and offers the level once it is earned');
{
  const { renderOverviewPanel } = await import('../app/js/ui/panels/overview.js');
  const { campaignPanel } = await import('../app/js/ui/panels/campaign.js');
  const c = new Character(blankDocument({ name: 'Bar', level: 1 }));
  const draw = () => renderOverviewPanel(c, { draft: {}, buildView: true });
  check('typed: no progress row', draw().includes('class="levelprogress"'), false);
  c.set('campaign.advancement', 'xp');
  c.set('identity.xp', 1000);
  check('xp: the row, the box and the Add, no button yet',
    [draw().includes('class="levelprogress"'), draw().includes('data-set="identity.xp"'), draw().includes('data-action="xp-award"'), draw().includes('data-action="level-up"')],
    [true, true, true, false]);
  c.set('identity.xp', 99999);
  check('xp: earned, the button', draw().includes(`Level up to ${c.data.identity.level + 1}`), true);
  check('the rules panel draws in every mode', ['typed', 'xp', 'milestones'].flatMap((a) => ['level', 'trials', 'awarded'].map((t) => {
    c.set('campaign.advancement', a);
    c.set('campaign.mythicTier', t);
    const h = campaignPanel(c);
    return h.includes('id="campaign-rules"') && !h.includes('undefined') && !h.includes('NaN');
  })).every(Boolean), true);
}

console.log('\nmythic tiers from trials, and a ladder of the campaign\'s own');
{
  const c = new Character(blankDocument({ name: 'Trials', level: 1 }));
  c.set('identity.level', 16);
  c.set('campaign.mythicTier', 'trials');
  check('no trials, no tier', c.data.identity.mythicTier, 0);
  c.set('campaign.mythicTrialRate', 2);
  c.set('campaign.mythicTrialSteps.3', 4);
  c.set('mythic.trials', 7);
  check('the tier follows the trials, a tier of its own counted', c.data.identity.mythicTier, 2);
  const t = trialProgress(c.data);
  check('and says what the next takes', [t.tier, t.next, t.toward, t.need, t.short], [2, 3, 3, 4, 1]);
  check('the tables say trials in all', mythicTierReached(c.data, 3), { head: 'Trials', value: 8, title: 'Tier 3 after 8 trials in all (4 for this tier)' });
  check('a typed tier still overrides', (c.set('mythic.tierOverride', 5), c.data.identity.mythicTier), 5);
  c.set('mythic.tierOverride', null);

  c.set('campaign.mythicTier', 'level');
  check('back to the level ladder', c.data.identity.mythicTier, 6);
  c.set('campaign.mythicLevels.1', 1);
  c.set('campaign.mythicLevels.6', 18);
  check('a ladder of the campaign\'s own', [c.data.identity.mythicTier, mythicLevels(c.data)[1], mythicLevels(c.data)[2]], [5, 1, 10]);
  for (let level = 0; level <= 25; level++) {
    const same = mythicComputedTier({ identity: { level }, campaign: { mythicLevels: { 4: 14 } } }) === tierAtLevel(level);
    if (!same) check(`the table's ladder written down agrees at ${level}`, false, true);
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
