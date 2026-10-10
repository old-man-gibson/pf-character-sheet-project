/** Tests for the pools spent at the table (model/pools.js): a tracker, a row
 *  of spell slots, a prepared spell's uses and the power-point pool, read one
 *  way and spent by the same four controls.
 *  Run: node tests/pools.test.mjs */
import {
  Character, poolAt, poolBar, poolPip, poolShown, poolStep, poolTyped,
} from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';
import { slotSpend } from '../app/js/ui/panels/subsystems.js';
import { meterVisual, poolStepper, trackerLine } from '../app/js/ui/panels/trackers.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

const fresh = () => new Character(blankDocument({ name: 'Pools', level: 5 }));
const labels = (c) => c.playActions.map((a) => a.label);

console.log('a tracker that fills: the box is the count, + spends');
{
  const c = fresh();
  const ki = c.addTracker({ name: 'Ki', maxFormula: '5' });
  const pool = () => poolAt(c, `tracker:${ki.id}`);
  const now = () => c.trackers.find((t) => t.id === ki.id).current;
  check('read as a range and a count', [pool().min, pool().max, pool().current, pool().left], [0, 5, 0, false]);
  pool().set(poolStep(pool(), 1));
  check('+ adds one', now(), 1);
  pool().set(poolTyped(pool(), 4));
  check('a typed number is the count', now(), 4);
  pool().set(poolTyped(pool(), 99));
  check('held to the range', now(), 5);
  pool().set(poolPip(pool(), 2));
  check('pip 2 leaves 2', now(), 2);
  pool().set(poolPip(pool(), 2));
  check('the last lit pip puts itself out', now(), 1);
  pool().set(poolBar(pool(), 0.6));
  check('a bar reads left to right', now(), 3);
  check('the box shows the count', poolShown(pool()), 3);
  check('each is one undo step, named as before', labels(c).slice(0, 3), ['Ki 1 → 3', 'Ki 2 → 1', 'Ki 5 → 2']);
}

console.log('a tracker that drains: the box is what is left, + gives one back');
{
  const c = fresh();
  const t = c.addTracker({ name: 'Grit', maxFormula: '6', style: { fill: 'remaining' } });
  const pool = () => poolAt(c, `tracker:${t.id}`);
  const now = () => c.trackers.find((x) => x.id === t.id).current;
  check('reads as left', [pool().left, poolShown(pool())], [true, 6]);
  pool().set(poolStep(pool(), -1));
  check('− spends one', [now(), poolShown(pool())], [1, 5]);
  pool().set(poolStep(pool(), 1));
  check('+ gives it back', now(), 0);
  pool().set(poolTyped(pool(), 2));
  check('a typed 2 leaves 2', [now(), poolShown(pool())], [4, 2]);
  pool().set(poolPip(pool(), 5));
  check('pip 5 leaves 5', poolShown(pool()), 5);
  pool().set(poolPip(pool(), 5));
  check('clicking it again spends it', poolShown(pool()), 4);
  pool().set(poolBar(pool(), 1));
  check('the right end of a draining bar is full', poolShown(pool()), 6);
}

console.log('a draining tracker above a floor counts its pips from the floor');
{
  const c = fresh();
  const t = c.addTracker({ name: 'Band', maxFormula: '6', minFormula: '2', style: { fill: 'remaining' } });
  const pool = () => poolAt(c, `tracker:${t.id}`);
  const now = () => c.trackers.find((x) => x.id === t.id).current;
  check('min and max', [pool().min, pool().max], [2, 6]);
  // Pips carry 3..6; pip 4 is the second above the floor, so it leaves two.
  pool().set(poolPip(pool(), 4));
  check('pip 4 leaves the two above the floor', now(), 4);
}

console.log('a two-sided tracker steps through zero');
{
  const c = fresh();
  const t = c.addTracker({ name: 'Qi', maxFormula: '3', minFormula: '-3' });
  const pool = () => poolAt(c, `tracker:${t.id}`);
  const now = () => c.trackers.find((x) => x.id === t.id).current;
  pool().set(poolPip(pool(), -2));
  check('a negative pip', now(), -2);
  pool().set(poolPip(pool(), -2));
  check('clicked again, back toward zero', now(), -1);
  pool().set(poolStep(pool(), -5));
  check('stepped past the floor, held to it', now(), -3);
  pool().set(poolPip(pool(), 0));
  check('the zero mark', now(), 0);
  pool().set(poolBar(pool(), 0.5));
  check('the middle of a two-sided bar is zero', now(), 0);
}

console.log('a spell level\'s slots');
{
  const c = fresh();
  c.listAdd('vancian.classes', {
    name: 'Sorcerer', slotType: '', stat: 'Cha', stat2: '', types: '', casterLevelOverride: 5, concentration: 0,
    spells: [0, 1, 2].map((level) => ({ level, perDay: level === 1 ? 3 : null, known: null })),
  });
  const row = () => c.data.vancian.classes[0].spells[1];
  const ref = 'slots:vancian.classes.0.spells|1';
  check('three slots, none spent', [poolAt(c, ref).max, poolAt(c, ref).current, poolShown(poolAt(c, ref))], [3, 0, 3]);
  poolAt(c, ref).set(poolPip(poolAt(c, ref), 1));
  check('pip 1 leaves one', [row().used, row().left], [2, 1]);
  poolAt(c, ref).set(poolPip(poolAt(c, ref), 1));
  check('clicking the last lit pip spends it', row().left, 0);
  // The count shown in place of pips carries what is left, so it spends one.
  poolAt(c, ref).set(poolPip(poolAt(c, ref), 3));
  poolAt(c, ref).set(poolPip(poolAt(c, ref), poolShown(poolAt(c, ref))));
  check('the count spends one', row().left, 2);
  check('named for the Undo button as before, newest first', labels(c).slice(0, 3),
    ['Spell level 1 3 → 2', 'Spell level 1 0 → 3', 'Spell level 1 1 → 0']);
  check('a level with no slots is an empty pool', poolAt(c, 'slots:vancian.classes.0.spells|2').max, 0);
  check('a row that is not there', poolAt(c, 'slots:vancian.classes.0.spells|9'), null);
}

console.log('a prepared spell\'s uses');
{
  const c = fresh();
  c.listAdd('vancian.prepared', { prepUsed: '', classLevel: '', name: 'Shield', note: '', uses: 2, used: 0 });
  const ref = 'slots:vancian.prepared|0';
  poolAt(c, ref).set(poolPip(poolAt(c, ref), 2));
  check('pip 2 of 2 spends one', c.data.vancian.prepared[0].used, 1);
  check('named for the spell', labels(c)[0], 'Shield 2 → 1');
}

console.log('the power-point pool');
{
  const c = fresh();
  c.set('psionics.bonusPoints', 7);
  const pool = () => poolAt(c, 'pp');
  const p = () => c.data.psionics;
  check('read from the Psionics tab', [pool().max, pool().current, poolShown(pool())], [7, 0, 7]);
  pool().set(poolStep(pool(), -1));
  check('− spends one', [p().spent, p().left], [1, 6]);
  pool().set(poolTyped(pool(), 3));
  check('a typed 3 leaves 3', p().left, 3);
  pool().set(poolTyped(pool(), 2.5));
  check('a typed half rounds as it did', p().left, 3);
  // The meter drains by default: pip 5 leaves 5.
  pool().set(poolPip(pool(), 5));
  check('pip 5 leaves 5', p().left, 5);
  pool().set(poolBar(pool(), 1));
  check('the right end of the bar is full', p().left, 7);
  check('named as before', labels(c)[0], 'power points 5 → 7');
  // Restyled to fill, its pips count what is spent; the box still shows left.
  c.setMeterStyle('pp', { fill: 'fill' });
  pool().set(poolPip(pool(), 2));
  check('a filling meter\'s pip 2 is two spent', [p().spent, poolShown(pool())], [2, 5]);
}

console.log('references that name nothing');
{
  const c = fresh();
  check('no such tracker', poolAt(c, 'tracker:nope'), null);
  check('no such kind', poolAt(c, 'hp'), null);
  check('nothing at all', poolAt(c, undefined), null);
}

console.log('the controls carry the pool they spend');
{
  const c = fresh();
  const ki = c.addTracker({ name: 'Ki', maxFormula: '3' });
  const line = trackerLine(c.trackers.find((t) => t.id === ki.id));
  check('a tracker line steps, types and pips its tracker',
    ['data-pool-step="tracker:ki"', 'data-pool-value="tracker:ki"', 'data-pool-pip="tracker:ki"'].map((s) => line.includes(s)), [true, true, true]);
  const slots = slotSpend({ pool: 'slots:vancian.prepared|0', total: 2, left: 1, shape: 'squares', name: 'Shield' });
  check('slot squares spend their row', [slots.includes('data-pool-pip="slots:vancian.prepared|0"'), slots.includes('data-spend')], [true, false]);
  const many = slotSpend({ pool: 'slots:x|0', total: 20, left: 4, name: 'Spell level 1' });
  check('a big pool\'s count spends one', many.includes('data-pool-pip="slots:x|0" data-n="4"'), true);
  c.set('psionics.bonusPoints', 4);
  const live = meterVisual(c.meterSpec('pp'), { pool: 'pp' });
  const picture = meterVisual(c.meterSpec('pp'));
  check('the power-point meter spends the pool; its preview does not',
    [live.includes('data-pool-bar="pp"'), picture.includes('data-pool')], [true, false]);
  c.setMeterStyle('pp', { shape: 'pips', fill: 'remaining' });
  check('and so do its pips', meterVisual(c.meterSpec('pp'), { pool: 'pp' }).includes('data-pool-pip="pp" data-n="4"'), true);
  check('one stepper', (poolStepper('pp', { shown: 3, range: '/ 4', what: 'w', minus: 'm', plus: 'p' })
    .match(/data-pool-(step|value)="pp"/g) || []).length, 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
