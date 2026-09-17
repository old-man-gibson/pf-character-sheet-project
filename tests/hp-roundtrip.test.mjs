import assert from 'node:assert/strict';
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';

for (const bonus of [14, -4]) {
  const model = new Character(blankDocument({ name: 'HP regression', level: 10 }));
  const base = model.data.hp.total;
  model.set('extras.approvalNotes', `{con.score += ${bonus}}`);
  const expected = base + bonus / 2 * 10;
  assert.equal(model.data.hp.total, expected, 'Constitution bonuses still change HP');
  let reopened = model;
  for (let i = 0; i < 5; i++) {
    reopened = new Character(JSON.parse(JSON.stringify(reopened.toJSON())));
    assert.equal(reopened.data.hp.total, expected, 'reload must not compound the ability bonus');
  }
  reopened.set('extras.approvalNotes', '');
  assert.equal(reopened.data.hp.total, base, 'removing the bonus restores the original maximum');
}

const formula = new Character(blankDocument({ name: 'Formula HP', level: 10 }));
formula.setOffset('hp.total', 'level * 3');
formula.set('extras.approvalNotes', '{con.score += 4}');
const total = formula.data.hp.total;
const restored = new Character(formula.toJSON());
assert.equal(restored.offsetSource('hp.total'), 'level * 3');
assert.equal(restored.data.hp.total, total, 'formula offsets must not be replaced by measurements');
console.log('HP round trips: all checks passed');
