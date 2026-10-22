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
  isAntihero, milestoneSteps as milestoneStepsOf, mythicLevels, mythicTierReached, tierUp, trialProgress, xpThresholds,
} from '../app/js/model/campaign.js';
import { HERO_POINTS_ID, MYTHIC_POWER_ID } from '../app/js/model/trackers.js';
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
    ['mythicTier', 'trials'], ['advancement', 'xp'], ['advancement', 'milestones'], ['mythicTrialRate', 3], ['currency', 'Gold'], ['altTraining', false], ['antiheroes', true],
    ['maxLevel', 6], ['maxLevel', 25], ['maxTier', 5], ['maxTier', 12], ['gestalt', false], ['hitPoints', 'average'], ['hitPoints', 'rolled'],
    ['abpLadder', 'core'], ['mythicLadder', 'core'], ['pastColossal', true]]) {
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

console.log('\nhero points are a pool, and an antihero gives them up for a feat');
{
  const { featNames } = await import('../app/js/model/feats.js');
  const { renderOverviewPanel } = await import('../app/js/ui/panels/overview.js');
  const { renderFeaturesPanel } = await import('../app/js/ui/panels/feats.js');
  const c = new Character(blankDocument({ name: 'Hero', level: 3 }));
  const pool = () => c.trackers.find((t) => t.id === HERO_POINTS_ID);
  c.data.identity.heroPoints = { current: 2, max: 3 };
  c.recompute();
  check('a pool on Trackers: 2 of 3 left, so 1 spent', [!!pool(), pool()?.max, pool()?.current, pool()?.refresh], [true, 3, 1, '']);
  check('kept while hero points are tracked', c.isProtectedTracker(HERO_POINTS_ID), true);
  c.updateTracker(HERO_POINTS_ID, { current: 2 });
  check('spending one is play, written back to Details', [c.data.identity.heroPoints.current, c.playActions.length > 0], [1, true]);
  c.undoPlay();
  check('and undone', c.data.identity.heroPoints.current, 2);

  const draw = () => renderOverviewPanel(c, { draft: {}, buildView: true });
  check('no antihero box unless the campaign offers it', draw().includes('identity.antihero'), false);
  c.set('identity.antihero', true);
  check('a ticked box with the rule off means nothing', [isAntihero(c.data), pool()?.max], [false, 3]);
  c.set('campaign.antiheroes', true);
  c.data.grantedFeats.antihero = { name: 'Toughness', note: '{hp.misc += 3}' };
  c.recompute();
  check('an antihero: no points to spend, the feat counts', [isAntihero(c.data), pool()?.max, pool()?.current, featNames(c.data).includes('Toughness')],
    [true, 0, 0, true]);
  check('the points written down are kept', c.data.identity.heroPoints.current, 2);
  check('Details says so, Feats has the row', [draw().includes('none: antihero'), renderFeaturesPanel(c, { draft: {} }).includes('grantedFeats.antihero.name')], [true, true]);
  check('the pool may go', c.isProtectedTracker(HERO_POINTS_ID), false);
  c.set('campaign.antiheroes', false);
  check('the bargain withdrawn: points back, feat gone', [isAntihero(c.data), pool()?.max, featNames(c.data).includes('Toughness')], [false, 3, false]);
}

console.log('\nwhat the money is called');
{
  const { wealthPanel } = await import('../app/js/ui/panels/gear.js');
  const c = new Character(blankDocument({ name: 'Purse', level: 1 }));
  const draw = () => wealthPanel(c, { draft: {} });
  check('the table\'s: mana', [c.wealthView().currency, draw().includes('Current mana')], ['Mana', true]);
  c.set('campaign.currency', ' Gold ');
  check('the campaign\'s own', [c.wealthView().currency, draw().includes('Current gold'), draw().includes('Gold / day'), draw().includes('Current mana')],
    ['Gold', true, true, false]);
  check('and it counts as a change', campaignChanges(c.data), ['currency']);
  c.set('campaign.currency', '');
  check('blank is the table\'s again', [c.wealthView().currency, campaignChanges(c.data)], ['Mana', []]);
}

console.log('\nAlternate Training off grants nothing, and keeps what was picked');
{
  const { setAltTrainingTables } = await import('../app/js/model/subsystems/alt-training.js');
  setAltTrainingTables({
    levels: [1, 3, 5, 7],
    repeatFrom: 7,
    techniques: [{
      name: 'Green Thumb',
      talents: { side: 'magic', sphere: 'Nature' },
      grants: { 1: [{ text: 'A talent', talent: true }], 3: [{ text: 'A feat', feat: true }] },
    }],
  });
  const c = new Character(blankDocument({ name: 'Gardener', level: 8 }));
  c.data.altTraining.technique = 'Green Thumb';
  c.data.altTraining.picks[3] = 'Power Attack';
  c.recompute();
  const calc = () => c.data.altTraining.calc;
  check('on: the grants count', [calc().counts.talent, calc().counts.feat, calc().talents?.count], [1, 1, 1]);
  c.set('campaign.altTraining', false);
  check('off: nothing counts', [calc().off, calc().counts.talent, calc().counts.feat, calc().talents, calc().unknown], [true, 0, 0, null, false]);
  check('off: the picks are kept', c.data.altTraining.picks[3], 'Power Attack');
  c.set('campaign.altTraining', true);
  check('back on, the grants again', [calc().off, calc().counts.feat], [false, 1]);
  setAltTrainingTables({});
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
  check('trials only offer the tier', [c.data.identity.mythicTier, trialProgress(c.data).ready, trialProgress(c.data).next], [0, true, 1]);
  check('taking it is a press', [tierUp(c), c.data.identity.mythicTier, c.playActions[0]?.label], [true, 1, 'Reached mythic tier 1']);
  c.undoPlay();
  check('undone like one', c.data.identity.mythicTier, 0);
  tierUp(c);
  tierUp(c);
  check('a tier of its own counted: no third press', [c.data.identity.mythicTier, tierUp(c)], [2, false]);
  const t = trialProgress(c.data);
  check('and says what the next takes', [t.tier, t.next, t.toward, t.need, t.short, t.ready], [2, 3, 3, 4, 1, false]);
  check('the pressed tier is kept on reopen', reopen(c).data.identity.mythicTier, 2);
  c.set('mythic.trials', 3);
  check('fewer trials typed do not take a tier back', c.data.identity.mythicTier, 2);
  c.set('mythic.trials', 7);
  {
    // Saved under trials before the press existed: opens at the tier the count bought.
    const old = JSON.parse(JSON.stringify(c.toJSON()));
    delete old.mythic.trialTier;
    old.mythic.trials = 9;
    const o = new Character(old);
    check('an older sheet keeps the tier its trials gave', [o.data.identity.mythicTier, o.data.mythic.trialTier], [3, 3]);
  }
  check('the tables say trials in all', mythicTierReached(c.data, 3), { head: 'Trials', value: 8, title: 'Tier 3 after 8 trials in all (4 for this tier)' });
  check('a typed tier still overrides', (c.set('mythic.tierOverride', 5), c.data.identity.mythicTier), 5);
  c.set('mythic.tierOverride', null);

  c.set('campaign.mythicTier', 'level');
  check('back to the level ladder, the trial tier dropped', [c.data.identity.mythicTier, 'trialTier' in c.data.mythic], [6, false]);
  c.set('campaign.mythicLevels.1', 1);
  c.set('campaign.mythicLevels.6', 18);
  check('a ladder of the campaign\'s own', [c.data.identity.mythicTier, mythicLevels(c.data)[1], mythicLevels(c.data)[2]], [5, 1, 10]);
  for (let level = 0; level <= 25; level++) {
    const same = mythicComputedTier({ identity: { level }, campaign: { mythicLevels: { 4: 14 } } }) === tierAtLevel(level);
    if (!same) check(`the table's ladder written down agrees at ${level}`, false, true);
  }
}

console.log('\ngestalt off: one class a level, each its own progression');
{
  const cls = (name, hd, bab, fort, ref, will, ranks, extra = {}) => ({
    name, hd, bab, babOverride: null, goodFort: fort, goodRef: ref, goodWill: will, skillRanks: ranks,
    archetypes: '', levelsOverride: null, systems: [], ...extra,
  });
  const c = new Character(blankDocument({ name: 'Multi', level: 1 }));
  c.data.classes = [cls('Fighter', 10, 1, true, false, false, 2), cls('Rogue', 8, 0.75, false, true, false, 8),
    cls('Monk', 8, 0.75, true, true, true, 4)];
  c.data.progression.tracks = 1;
  ['Fighter', 'Rogue', 'Monk'].forEach((n, i) => { c.data.progression.levels[i].classes = [n]; });
  c.set('identity.level', 3);
  const read = () => [c.data.saves.fortitude.base, c.data.saves.reflex.base, c.data.saves.will.base, c.data.attack.babBase,
    c.data.gestalt.ranksTotal];
  check('gestalt-style: one +2 a save, BAB rounded down once', read(), [3, 3, 3, 2, 24]);
  c.set('campaign.gestalt', false);
  check('core: a +2 for each good save, BAB rounded down per class, each class its ranks', read(), [4, 4, 2, 1, 14]);
  check('the skill budget counts them', c.data.skillBudget.available - (c.data.skillBudget.intPerLevel + c.data.skillBudget.bonusResolved) * 3, 14);
  check('one die a level: d10, d8, d8', [c.data.gestalt.dice, c.data.gestalt.hdTotal], [[10, 8, 8], 26]);
  c.data.progression.levels[1].classes = ['Rogue', 'Fighter'];
  c.recompute();
  check('a second track is not read', read(), [4, 4, 2, 1, 14]);

  const p = new Character(blankDocument({ name: 'Pinned', level: 1 }));
  p.data.classes = [cls('Wizard', 6, 0.5, false, false, true, 2), cls('Fighter', 10, 1, true, false, false, 2, { levelsOverride: 2 }),
    cls('Rogue', 8, 0.75, false, true, false, 8)];
  p.set('identity.level', 5);
  p.set('campaign.gestalt', false);
  check('an empty Planner: the pinned count, then the first class unnamed', p.data.classes.map((x) => x.gestaltLevels), [3, 2, 0]);
  const { renderOverviewPanel } = await import('../app/js/ui/panels/overview.js');
  check('and the class left without levels is named', renderOverviewPanel(p, { draft: {}, buildView: true }).includes('<strong>Rogue</strong>'), true);
}

console.log('\nhit points: maximum, average or rolled after 1st');
{
  const c = new Character(blankDocument({ name: 'Dice', level: 1 }));
  c.data.classes = [{ name: 'Fighter', hd: 10, bab: 1, goodFort: true, goodRef: false, goodWill: false, skillRanks: 2,
    archetypes: '', levelsOverride: null, systems: [] }];
  c.set('identity.level', 3);
  const dice = () => c.data.gestalt.hdTotal;
  const total = c.data.hp.total;
  check('the table\'s: every die whole', dice(), 30);
  c.set('campaign.hitPoints', 'average');
  check('average: half the die and 1 after 1st', [dice(), c.data.hp.total], [22, total - 8]);
  c.set('campaign.hitPoints', 'rolled');
  check('rolled, none kept: the average', dice(), 22);
  c.set('hp.rolls.2', 3);
  c.set('hp.rolls.3', 99);
  check('a roll counts; one above the die is the average', dice(), 10 + 3 + 6);
  check('the rolls are kept on reopen', reopen(c).data.gestalt.hdTotal, 19);
  c.set('campaign.hitPoints', 'max');
  check('back to the table\'s, the rolls kept', [dice(), c.data.hp.rolls[2]], [30, 3]);
}

console.log('\ncore ABP: attunement, prowess to 18th, legendary gifts');
{
  const { armorParts } = await import('../app/js/rules.js');
  const { blankWeapon } = await import('../app/js/model.js');
  const c = new Character(blankDocument({ name: 'Attuned', level: 1 }));
  c.set('identity.level', 9);
  Object.assign(c.data.equipment.armor, { name: 'Breastplate', acBonus: 6, active: true });
  c.data.equipment.shields = [{ kind: 'Shield', name: 'Heavy shield', acBonus: 2, enhancement: 0, active: true }];
  c.data.equipment.weapons = [{ ...blankWeapon(), name: 'Longsword' }, { ...blankWeapon(), name: 'Dagger', enhancement: 1 }];
  c.recompute();
  const worn = () => [armorParts(c.data).armor, armorParts(c.data).shield];
  const hits = () => c.data.equipment.weapons.map((w) => w.enhancementNow);
  const ac = c.data.defenses.ac;
  const attack = c.data.equipment.weapons[0].attackTotal;
  check('the table\'s ABP attunes nothing', [worn(), hits(), c.data.abpAttune], [[6, 2], [0, 1], undefined]);
  c.set('campaign.abpLadder', 'core');
  check('core: none ticked, the armour takes +2 at 9th', [worn(), hits(), c.data.defenses.ac], [[8, 2], [0, 1], ac + 2]);
  c.set('equipment.weapons.0.attuned', true);
  check('a weapon ticked: +2 on attack and damage', [hits(), c.data.equipment.weapons[0].attackTotal - attack, c.data.equipment.weapons[0].damageBonus >= 2], [[2, 1], 2, true]);
  c.set('equipment.weapons.1.attuned', true);
  check('two ticked: split +1 and +1, the higher of its own counting', hits(), [1, 1]);
  c.set('equipment.armor.attuned', true);
  c.set('equipment.shields.0.attuned', true);
  check('armour and shield ticked: split too', worn(), [7, 3]);
  c.set('equipment.armor.active', false);
  c.set('equipment.shields.0.attuned', false);
  check('nothing worn: the clothes take it', [armorParts(c.data).armor, c.data.abpAttune.clothing], [2, 2]);
  c.set('identity.level', 3);
  check('before 4th, nothing', [armorParts(c.data).armor, hits()], [0, [0, 1]]);

  const p = new Character(blankDocument({ name: 'Prowess', level: 1 }));
  p.set('identity.level', 20);
  p.data.progressionPicks = { ...(p.data.progressionPicks || {}), abp: [{ level: 19, mental: 'Int', physical: 'Str' }] };
  p.recompute();
  check('the table counts a 19th-level prowess pick', [p.data.statsBuild.int.abp, p.data.statsBuild.str.abp], [2, 2]);
  p.set('campaign.abpLadder', 'core');
  check('core stops prowess at 18th', [p.data.statsBuild.int.abp, p.data.statsBuild.str.abp], [0, 0]);
  const fort = p.data.saves.fortitude.total;
  p.set('progressionPicks.legendaryGifts', 'Legendary Body {fort += 1}');
  check('a legendary gift written with a formula counts at 19th and up', p.data.saves.fortitude.total, fort + 1);
  p.set('campaign.abpLadder', 'table');
  check('and waits under the table\'s ABP', p.data.saves.fortitude.total, fort);
}

console.log('\nthe core mythic ladder: no feat on an even tier');
{
  const { renderFeaturesPanel } = await import('../app/js/ui/panels/feats.js');
  const c = new Character(blankDocument({ name: 'Ladder', level: 1 }));
  c.set('identity.level', 12);
  const fort = c.data.saves.fortitude.total;
  c.data.mythic.abilities[1].featChoice = 'Path power';
  c.data.mythic.abilities[1].featEffect = '{fort += 2}';
  c.recompute();
  check('the table\'s: an even tier\'s grant counts', c.data.saves.fortitude.total, fort + 2);
  c.set('campaign.mythicLadder', 'core');
  check('core: it waits', c.data.saves.fortitude.total, fort);
  const html = renderFeaturesPanel(c, { draft: {} });
  check('the table says so', [html.includes('Mythic feat 1'), html.includes('The core ladder grants no feat at this tier')], [true, true]);
}

console.log('\none set of rules for the party, as a file');
{
  const { campaignPreset, presetCampaign } = await import('../app/js/model/campaign.js');
  const gm = new Character(blankDocument({ name: 'GM', level: 1 }));
  gm.set('campaign.abp', false);
  gm.set('campaign.xpSteps.9', 60000);
  gm.data.campaign.nonsense = 'kept out';
  const file = JSON.parse(JSON.stringify(campaignPreset(gm.data)));
  check('the file is the rules alone', file, { kind: 'campaign-rules', campaign: { abp: false, xpSteps: { 9: 60000 } } });
  const player = new Character(blankDocument({ name: 'Player', level: 1 }));
  player.set('campaign', presetCampaign(file));
  check('loaded, the player plays under them', [campaignRules(player.data).abp, xpThresholds(player.data)[9]], [false, 60000]);
  check('another character\'s file gives its rules', presetCampaign(gm.toJSON()), { abp: false, xpSteps: { 9: 60000 } });
  check('a character with none gives the table\'s', presetCampaign(blankDocument({ name: 'Plain', level: 1 })), {});
  check('a file of neither gives nothing', [presetCampaign({ hello: 1 }), presetCampaign(null)], [null, null]);
}

console.log('\nrules every character shares, or this one alone');
{
  const { changedRuleTitles, followsShared, sameCampaign } = await import('../app/js/model/campaign.js');
  const { campaignPanel } = await import('../app/js/ui/panels/campaign.js');
  const { buildLibrary } = await import('../app/js/extensions.js');
  check('the same block, key order aside', [sameCampaign({ abp: false, gestalt: false }, { gestalt: false, abp: false }), sameCampaign({}, { abp: true }), sameCampaign({}, { abp: false })],
    [true, false, false]);
  check('named for a summary', changedRuleTitles({ gestalt: false, abpLadder: 'core' }), ['Gestalt', 'Which ABP']);
  const c = new Character(blankDocument({ name: 'Scope', level: 1 }));
  check('nothing shared: own rules', followsShared(c.data, null), false);
  check('shared and on: followed', followsShared(c.data, { on: true, rules: {} }), true);
  check('shared but off: own rules', followsShared(c.data, { on: false, rules: {} }), false);
  c.data.campaignOwn = true;
  check('set to its own: own rules', followsShared(c.data, { on: true, rules: {} }), false);
  delete c.data.campaignOwn;
  const draw = (ctx) => campaignPanel(c, ctx);
  check('the row says whom they are for', [draw({}).includes('Each character keeps its own rules'),
    draw({ campaignShareArmed: true }).includes('Press <strong>Every character</strong> again'),
    draw({ sharedRules: { on: true, rules: {} } }).includes('Every character in this browser follows these rules'),
    (c.data.campaignOwn = true, draw({ sharedRules: { on: true, rules: {} } }).includes('This character keeps rules of its own'))],
  [true, true, true, true]);
  delete c.data.campaignOwn;
  c.data.uiPrefs.collapsed = { ...(c.data.uiPrefs.collapsed || {}), 'campaign-rules': true };
  const shut = draw({});
  check('the panel folds to its heading', [shut.includes('collapsed'), shut.includes('campaign.pointBuy')], [true, false]);
  check('a library carries the shared rules', buildLibrary({ campaignRules: { on: true, rules: { gestalt: false } } }).campaignRules,
    { on: true, rules: { gestalt: false } });
  check('and leaves them out where there are none', 'campaignRules' in buildLibrary({}), false);

  // The browser's store, against a stand-in localStorage.
  const held = new Map();
  globalThis.localStorage = { getItem: (k) => held.get(k) ?? null, setItem: (k, v) => held.set(k, String(v)), removeItem: (k) => held.delete(k) };
  const { readShared, sharedRules, writeShared } = await import('../app/js/shared-rules.js');
  let heard = 0;
  sharedRules.addEventListener('change', () => { heard += 1; });
  check('none until written', readShared(), null);
  writeShared({ on: true, rules: { gestalt: false, nonsense: 1 } });
  check('written: on, the rules alone, and said', [readShared().on, readShared().rules, heard], [true, { gestalt: false }, 1]);
  writeShared({ on: false });
  check('a part left out keeps what was there', [readShared().on, readShared().rules], [false, { gestalt: false }]);
  delete globalThis.localStorage;
}

console.log('\nsizes past Colossal');
{
  const { blankWeapon } = await import('../app/js/model.js');
  const { weaponMoves, diceString } = await import('../app/js/rules.js');
  const c = new Character(blankDocument({ name: 'Titan', level: 5 }));
  c.set('identity.size', 'Gargantuan');
  c.data.equipment.weapons = [{ ...blankWeapon(), name: 'Greatclub', dice: '1d10' }];
  c.data.buffs = [{ name: 'Grow', on: true, bonuses: [{ target: 'size', value: 3, valueNum: 3 }] }];
  c.recompute();
  const w = () => c.data.equipment.weapons[0];
  const dice = () => diceString(weaponMoves(c.data, w(), c.conditionState).sized.dice);
  const atk = c.conditionState.delta?.melee;
  check('the table\'s: held at Colossal', [c.sizeNow(), c.conditionState.sizePast], ['Colossal', 0]);
  const atColossal = dice();
  c.set('campaign.pastColossal', true);
  check('allowed: two steps past, named so', [c.sizeNow(), c.conditionState.sizePast], ['Colossal+2', 2]);
  check('modifiers stay at Colossal\'s', c.conditionState.delta?.melee, atk);
  check('each step past adds 1d6', [dice() !== atColossal, dice().includes('d6')], [true, true]);
}

console.log('\nthe highest level and tier');
{
  const { renderFeaturesPanel } = await import('../app/js/ui/panels/feats.js');
  const c = new Character(blankDocument({ name: 'Capped', level: 1 }));
  c.set('identity.level', 6);
  c.set('campaign.advancement', 'xp');
  c.set('identity.xp', 999999);
  c.set('campaign.maxLevel', 6);
  check('at the highest level: nothing to take', [levelProgress(c.data).next, levelUp(c), xpThresholds(c.data).length], [null, false, 7]);
  c.set('campaign.maxLevel', 22);
  c.set('identity.level', 20);
  c.set('identity.xp', 4000000);
  const p = levelProgress(c.data);
  check('past 20th, a level with no XP figure waits for one', [p.next, p.need, p.unset, p.ready], [21, null, true, false]);
  c.set('campaign.xpSteps.21', 3900000);
  check('given one, it is offered', [levelProgress(c.data).ready, levelUp(c), c.data.identity.level], [true, true, 21]);
  check('the Planner has a row for every level', c.data.progression.levels.length, 22);
  c.data.progression.levels[20].classes = ['Fighter'];
  c.set('campaign.maxLevel', 20);
  check('lowered, a row with a class on it stays, the blank one goes', c.data.progression.levels.length, 21);
  c.data.progression.levels[20].classes = [];
  c.recompute();
  check('and once it is blank it goes too', c.data.progression.levels.length, 20);
  check('the table\'s twenty are never taken away', (c.set('campaign.maxLevel', 6), c.data.progression.levels.length), 20);
  c.set('campaign.advancement', 'milestones');
  c.set('campaign.maxLevel', 25);
  check('milestones carry on at the rate', milestoneStepsOf(c.data)[24], 1);

  const m = new Character(blankDocument({ name: 'Tiers', level: 1 }));
  m.set('identity.level', 20);
  check('the table\'s ladder at 20th', m.data.identity.mythicTier, 10);
  m.set('campaign.maxTier', 5);
  check('held to the campaign\'s highest', m.data.identity.mythicTier, 5);
  const panel = renderFeaturesPanel(m, { draft: {} });
  check('Feats & Mythic lists that many tiers', (panel.match(/data-rowkey="mythladder"/g) || []).length, 5);
  check('a tier typed in is still the GM\'s word', (m.set('mythic.tierOverride', 7), m.data.identity.mythicTier), 7);
  m.set('mythic.tierOverride', null);
  m.set('campaign.maxTier', 12);
  check('raised: rows for every tier, no level for the new ones yet', [m.data.mythic.abilities.length, m.data.identity.mythicTier, mythicLevels(m.data)[11]], [12, 10, null]);
  m.set('campaign.mythicLevels.11', 20);
  check('given a level, the tier comes', m.data.identity.mythicTier, 11);
  m.set('campaign.mythicTier', 'trials');
  m.set('mythic.trials', 30);
  for (let i = 0; i < 20; i++) tierUp(m);
  check('trials stop at the highest tier', [m.data.identity.mythicTier, trialProgress(m.data).next], [12, null]);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
