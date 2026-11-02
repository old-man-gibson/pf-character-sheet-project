/** Aligned classes: a prestige class that adds some of its levels to a class
 *  the character had before it, for that class's features only.
 *
 *  The promises: the aligned class counts the added levels wherever its level
 *  is read and its feature ladder gets their rows, while hit dice, BAB, saves
 *  and skill ranks stay exactly what the Planner gives. The several-class form
 *  picks a class per level, and its lowest-class levels go to whichever is
 *  lowest at that point, with a tie the player settles.
 *
 *  Run: node tests/aligned.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import * as M from '../app/js/model.js';
import { renderProgressionPanel } from '../app/js/ui/panels/lore.js';

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
const classRow = (name, extra = {}) => ({
  name, hd: 6, bab: 0.5, babOverride: null, goodFort: false, goodRef: false, goodWill: true,
  skillRanks: 2, archetypes: '', levelsOverride: null, systems: [], ...extra,
});
/** A character with the given class on each Planner row, and a Classes row for each. */
function build(name, plan, rows) {
  const c = new Character(blankDocument({ name, level: plan.length }));
  c.data.classes = [];
  for (const row of rows) c.listAdd('classes', row);
  plan.forEach((cls, i) => c.setProgressionClass(i + 1, 0, cls));
  return c;
}
const indexOf = (c, name) => c.data.classes.findIndex((x) => x.name === name);

console.log('one aligned class from 2nd level');
{
  const plan = [...Array(6).fill('Wizard'), ...Array(10).fill('Seer')];
  const c = build('Seer', plan, [classRow('Wizard'), classRow('Seer', { hd: 8, bab: 0.75, goodFort: true })]);
  const fixed = () => [c.data.saves.fortitude.base, c.data.saves.reflex.base, c.data.saves.will.base,
    c.data.gestalt.bab, c.data.gestalt.hdTotal];
  const before = fixed();
  check('no block: Wizard has its 6', c.classLevelCount('Wizard'), 6);
  check('no block: nothing saved on the row', 'aligned' in c.data.classes[1], false);

  const i = indexOf(c, 'Seer');
  c.addAligned(i);
  check('a block with no class adds nothing', c.classLevelCount('Wizard'), 6);
  c.setAligned(i, { classes: ['Wizard'] });
  check('a block with no levels adds nothing', c.classLevelCount('Wizard'), 6);
  c.setAligned(i, { levels: '2+' });
  check('a rule that does not parse adds nothing', c.classLevelCount('Wizard'), 6);
  check('and the box says so', renderProgressionPanel(c, { draft: {} }).includes('class="bad"'), true);
  c.setAligned(i, { levels: '2, +1' });
  check('Seer 2 to 10 add 9 Wizard levels', c.classLevelCount('Wizard'), 15);
  check('Seer keeps its own 10', c.classLevelCount('Seer'), 10);
  check('saves, BAB and hit dice stay the Planner\'s', fixed(), before);
  check('Wizard gains at the Seer rows from 8', c.classLevelsIn('Wizard'), [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const rows = c.classFeatureRows('Wizard');
  check('the ladder has 15 rows, the 7th at level 8 from Seer',
    [rows.length, rows[6].level, rows[6].classLevel, rows[6].aligned, rows[5].aligned], [15, 8, 7, 'Seer', null]);
  check('one step per gain, each reaching the next Wizard level',
    c.alignedSteps().map((s) => [s.prcLevel, s.level, s.class, s.reaches]).slice(0, 3),
    [[2, 8, 'Wizard', 7], [3, 9, 'Wizard', 8], [4, 10, 'Wizard', 9]]);
  check('a Spheres ladder sees the gain', [M.classGainsAt(c, 'Wizard', 7), M.classGainsAt(c, 'Wizard', 8)], [0, 1]);

  c.setClassFeature('Wizard', 8, 'Special', 'Arcane discovery');
  c.setAligned(i, { levels: '3, +1' });
  check('a cell written for Wizard 7 follows it to level 9',
    [c.data.progression.classFeatures.Wizard.byLevel[9]?.Special, c.data.progression.classFeatures.Wizard.byLevel[8]?.Special],
    ['Arcane discovery', undefined]);
  check('Seer 3 to 10 add 8', c.classLevelCount('Wizard'), 14);

  c.set('identity.level', 10);
  check('only levels reached count', c.classLevelCount('Wizard'), 6 + 2);   // Seer 3 and 4
  c.set('identity.level', 16);
  check('a reload reads the same', reopen(c).classLevelCount('Wizard'), 14);

  c.removeAligned(i);
  check('removed: Wizard back to 6, the block gone', [c.classLevelCount('Wizard'), 'aligned' in c.data.classes[i]], [6, false]);
  check('removed: the cell goes back with the level', c.data.progression.classFeatures.Wizard.byLevel[9]?.Special, undefined);
  check('removed: the cell is kept, not lost', JSON.stringify(c.data.progression.classFeatures.Wizard).includes('Arcane discovery'), true);
  c.undoLast();
  check('undo puts the block back', c.classLevelCount('Wizard'), 14);
}

console.log('\nthree aligned classes, picked per level, with lowest-class levels');
{
  const plan = ['Ace', 'Ace', 'Bard', 'Bard', 'Bard', 'Cleric', ...Array(10).fill('Trinity')];
  const c = build('Trinity', plan, [classRow('Ace'), classRow('Bard'), classRow('Cleric'), classRow('Trinity', { hd: 10, bab: 1 })]);
  const i = indexOf(c, 'Trinity');
  c.addAligned(i);
  c.setAligned(i, { classes: ['Ace', 'Bard', 'Cleric'], levels: '1, +1', lowest: '3, +3' });
  const steps = () => c.alignedSteps().filter((s) => s.prcLevel <= 3).map((s) => [s.prcLevel, s.kind, s.class, s.reaches, s.tied]);
  check('nothing picked: chosen levels owe a pick, the lowest goes to Cleric',
    steps(), [[1, 'chosen', '', 0, []], [2, 'chosen', '', 0, []], [3, 'chosen', '', 0, []], [3, 'lowest', 'Cleric', 2, []]]);
  check('an unpicked level counts for nothing', c.classLevelCount('Cleric'), 1 + 2);   // the lowest at 3, 6 and 9

  c.setAlignedPick(i, 'chosen', 1, 'Cleric');
  c.setAlignedPick(i, 'chosen', 2, 'Ace');
  c.setAlignedPick(i, 'chosen', 3, 'Cleric');
  check('Ace 3, Bard 3, Cleric 3 after the picks: the lowest is a three-way tie, Ace by default',
    steps(), [[1, 'chosen', 'Cleric', 2, []], [2, 'chosen', 'Ace', 3, []], [3, 'chosen', 'Cleric', 3, []],
      [3, 'lowest', 'Ace', 4, ['Ace', 'Bard', 'Cleric']]]);
  c.setAlignedPick(i, 'lowest', 3, 'Bard');
  check('the tie settled for Bard', steps()[3], [3, 'lowest', 'Bard', 4, ['Ace', 'Bard', 'Cleric']]);
  check('a tie pick that is no longer tied is ignored', (() => {
    c.setAlignedPick(i, 'chosen', 2, 'Bard');
    const s = steps()[3];
    c.setAlignedPick(i, 'chosen', 2, 'Ace');
    return s;
  })(), [3, 'lowest', 'Ace', 3, []]);

  // Every pick Ace but Trinity 6 (level 12), which goes to Cleric; the tie for
  // lowest there is settled for Cleric too, so it gains two levels on one row.
  c.setAlignedPick(i, 'lowest', 3, '');
  for (let p = 1; p <= 10; p++) c.setAlignedPick(i, 'chosen', p, p === 6 ? 'Cleric' : 'Ace');
  c.setAlignedPick(i, 'lowest', 6, 'Cleric');
  const again = c.alignedSteps().filter((s) => s.prcLevel === 6).map((s) => [s.class, s.reaches, s.tied]);
  check('both gains at Trinity 6 go to Cleric', again, [['Cleric', 3, []], ['Cleric', 4, ['Bard', 'Cleric']]]);

  const keys = c.classLevelsIn('Cleric').filter((k) => Math.floor(k) === 12);
  check('its second level on that row is stored at 12.1', keys, [12, 12.1]);
  const rows = c.classFeatureRows('Cleric').filter((r) => r.level === 12);
  check('the ladder shows both, one class level apart', [rows.length, rows[1].classLevel - rows[0].classLevel, rows[1].key], [2, 1, 12.1]);
  check('a Spheres ladder counts two on that row', M.classGainsAt(c, 'Cleric', 12), 2);
  c.setClassFeature('Cleric', 12.1, 'Special', 'Second');
  c.setClassFeature('Cleric', 12, 'Special', 'First');
  check('each keeps its own cell', [12, 12.1].map((k) => c.data.progression.classFeatures.Cleric.byLevel[k].Special), ['First', 'Second']);
  check('the second is not a level in the future', c.classFeatureRows('Cleric').find((r) => r.key === 12.1).future, false);
  const total = ['Ace', 'Bard', 'Cleric'].map((n) => c.classLevelCount(n)).reduce((a, b) => a + b, 0);
  check('ten chosen and three lowest: 6 taken + 13 gained', total, 19);
  check('a reload reads the same', ['Ace', 'Bard', 'Cleric'].map((n) => reopen(c).classLevelCount(n)),
    ['Ace', 'Bard', 'Cleric'].map((n) => c.classLevelCount(n)));
}

console.log('\nthe panel');
{
  const one = new Character(blankDocument({ name: 'Solo', level: 3 }));
  one.data.classes = [classRow('Wizard')];
  check('one class: no panel', renderProgressionPanel(one, { draft: {} }).includes('Aligned classes'), false);
  const plan = ['Ace', 'Bard', 'Cleric', 'Trinity', 'Trinity'];
  const c = build('Panel', plan, [classRow('Ace'), classRow('Bard'), classRow('Cleric'), classRow('Trinity')]);
  let h = renderProgressionPanel(c, { draft: {} });
  check('two or more classes: the panel, with a way to add', [h.includes('Aligned classes'), h.includes('data-alignedadd')], [true, true]);
  const i = indexOf(c, 'Trinity');
  c.addAligned(i);
  c.setAligned(i, { classes: ['Ace', 'Bard', 'Cleric'], levels: '1, +1' });
  h = renderProgressionPanel(c, { draft: {} });
  check('a pick per level, owed picks counted', [h.includes('data-alignedpick'), h.includes('2 to pick')], [true, true]);
  check('the block can be removed', h.includes('data-action="remove-aligned"'), true);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
