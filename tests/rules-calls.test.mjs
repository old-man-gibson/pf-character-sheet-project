/** Two rules calls: a combat sphere's attack bonus has no ceiling at the
 *  character's level, and the core rules' trials per tier are the default
 *  ladder.
 *
 *  Run: node tests/rules-calls.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import {
  campaignChanges, campaignRules, mythicTierReached, mythicTrialSteps, tierUp, trialProgress,
} from '../app/js/model/campaign.js';
import { foldValue } from '../app/js/ui/folds.js';
import { campaignPanel } from '../app/js/ui/panels/campaign.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const reopen = (m) => new Character(JSON.parse(JSON.stringify(m.toJSON())));

console.log('a combat sphere\'s attack bonus has no ceiling');
{
  const c = new Character(blankDocument({ name: 'Uncapped' }));
  c.set('identity.level', 10);
  c.set('attack.babOverride', 10);
  const row = (name) => c.data.training.combat.sphereRows.find((r) => r.sphere === name);
  check('full BAB at 10th is 10', row('Athletics').attack, 10);
  c.listAdd('training.combat.sphereBonuses', { sphere: 'Athletics', rankBonus: 1, dcBonus: 0 });
  check('a BAB+ of 1 adds past the level', row('Athletics').attack, 11);
  c.listAdd('notes', { title: 'Focus', body: 'Focus {sphere.athletics.bab += 1}' });
  check('and a forwarded bonus adds on top', [row('Athletics').babForwarded, row('Athletics').attack], [1, 12]);
  check('formulas read the same figure', c.scope().sphere.athletics.bab, 12);
  // Alchemy follows BAB like every other sphere; its BAB+ adds the same way.
  c.listAdd('training.combat.sphereBonuses', { sphere: 'Alchemy', rankBonus: 12, dcBonus: 0 });
  check('Alchemy has no ceiling either', row('Alchemy').attack, 22);
  const again = reopen(c);
  check('reopened, nothing moves',
    [again.data.training.combat.sphereRows.find((r) => r.sphere === 'Athletics').attack,
      again.data.training.combat.sphereRows.find((r) => r.sphere === 'Alchemy').attack, again.diffFromSource()],
    [12, 22, []]);
}

console.log('\nthe core rules\' trials per tier are the default');
{
  check('no rate is the default', campaignRules({}).mythicTrialRate, null);
  check('the core table: none for the 1st, then half the tier, rounded up',
    mythicTrialSteps({ campaign: { mythicTier: 'trials' } }), [null, 0, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  check('and on past 10th the same way',
    mythicTrialSteps({ campaign: { mythicTier: 'trials', maxTier: 12 } }).slice(11), [6, 6]);
  check('a rate saved before, 1 included, stays the campaign\'s own',
    [mythicTrialSteps({ campaign: { mythicTrialRate: 1 } }).slice(1, 4), campaignChanges({ campaign: { mythicTrialRate: 1 } })],
    [[1, 1, 1], ['mythicTrialRate']]);
  check('a blank rate is the core table and no change', [mythicTrialSteps({ campaign: { mythicTrialRate: null } })[3],
    campaignChanges({ campaign: { mythicTrialRate: null } })], [2, []]);
  check('steps typed for some tiers keep them; the rest follow the core table',
    mythicTrialSteps({ campaign: { mythicTrialSteps: { 3: 4 } } }).slice(1, 5), [0, 1, 4, 2]);

  // Made at 1st and raised, so the blank sheet carries no typed tier of 0.
  const c = new Character(blankDocument({ id: 'zz-core-trials', name: 'Trials', level: 1 }));
  c.set('identity.level', 10);
  c.set('campaign.mythicTier', 'trials');
  check('no trials, no tier: the 1st is not handed over', [c.data.identity.mythicTier, c.data.mythic.trialTier], [0, 0]);
  const p = trialProgress(c.data);
  check('it is offered for the press', [p.next, p.need, p.ready], [1, 0, true]);
  check('and stays 0 until pressed', reopen(c).data.identity.mythicTier, 0);
  check('Tier up takes it', [tierUp(c), c.data.identity.mythicTier], [true, 1]);
  check('the 2nd takes one trial', [trialProgress(c.data).need, trialProgress(c.data).ready], [1, false]);
  c.set('mythic.trials', 3);
  tierUp(c);
  tierUp(c);
  check('three trials: the 2nd and the 3rd', [c.data.identity.mythicTier, trialProgress(c.data).need, trialProgress(c.data).short], [3, 2, 2]);

  // Switched to trials with some already done: the count buys the 1st too.
  const s = new Character(blankDocument({ id: 'zz-core-switch', name: 'Switch', level: 1 }));
  s.set('identity.level', 10);
  s.set('mythic.trials', 5);
  s.set('campaign.mythicTier', 'trials');
  check('five trials already done buy the 4th', s.data.identity.mythicTier, 4);

  // A tier reached under one a tier does not drop; only the next one costs more.
  const old = JSON.parse(JSON.stringify(c.toJSON()));
  old.mythic.trials = 5;
  old.mythic.trialTier = 5;
  const o = new Character(old);
  const q = trialProgress(o.data);
  check('a tier already reached stays', o.data.identity.mythicTier, 5);
  check('and the 6th takes the core table\'s 3', [q.next, q.need, q.short], [6, 3, 6]);

  check('the tables show the 1st blank, not 0',
    [mythicTierReached(c.data, 1).value, mythicTierReached(c.data, 1).title, mythicTierReached(c.data, 3).value],
    ['', 'Tier 1 at ascension, with no trials', 3]);
  c.data.uiPrefs.collapsed = { ...c.data.uiPrefs.collapsed, 'campaign-trial-steps': foldValue('campaign-trial-steps', true) };
  const panel = campaignPanel(c);
  check('the rules panel names the core table', panel.includes('tier 1 at ascension, then half the tier, rounded up'), true);
  check('the trial rate box is blank, and may be left blank',
    /data-set="campaign\.mythicTrialRate"\s+data-kind="number-or-null"[^>]*placeholder="Core"/.test(panel), true);
  check('the ladder\'s 1st tier box is blank, the 3rd shows 2',
    [/placeholder="([^"]*)"\s+data-set="campaign\.mythicTrialSteps\.1"/.exec(panel)?.[1],
      /placeholder="([^"]*)"\s+data-set="campaign\.mythicTrialSteps\.3"/.exec(panel)?.[1]], ['', '2']);
  c.set('campaign.mythicTrialRate', 2);
  check('a rate fills every box', /placeholder="([^"]*)"\s+data-set="campaign\.mythicTrialSteps\.1"/.exec(campaignPanel(c))?.[1], '2');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
