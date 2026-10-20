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
import { CAMPAIGN_DEFAULTS, campaignChanges, campaignRules } from '../app/js/model/campaign.js';
import { MYTHIC_POWER_ID } from '../app/js/model/trackers.js';
import { abpDefence } from '../app/js/rules.js';
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
  campaignRules({ campaign: { abp: 'no', mythic: 0, mythicTier: 'trials', pointBuy: 'lots' } }), { ...CAMPAIGN_DEFAULTS });
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
  for (const [key, value] of [['abp', false], ['mythic', false], ['heroPoints', false], ['pointBuy', 20], ['mythicTier', 'awarded']]) {
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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
