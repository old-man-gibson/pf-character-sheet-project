import assert from 'node:assert/strict';
import { Character } from '../app/js/model.js';
import { blankDocument } from '../app/js/convert.js';
import { sessionRolls, sessionRollSpec } from '../app/js/model/session-rolls.js';
import { weaponRollSpec } from '../app/js/roll20.js';
import { renderSessionBoard } from '../app/js/ui/panels/session.js';
const doc = blankDocument({ name: 'Action rolls', level: 10 });
doc.equipment.weapons = [{ name: 'Sword', attackType: 'Melee', dice: '2d6', damageAbility: 'Str', abilityMult: 1, range: 'Melee' }];
const m = new Character(doc);
const linked = { title: 'Strike', type: 'standard', source: 'attack:Sword' };
let result = sessionRolls(m, linked);
assert.deepEqual(result.spec.rolls, weaponRollSpec(m.data, 0, m.conditionState, null, true).rolls);
assert.equal(result.range, 'Melee');
assert.ok(result.attack.startsWith('+'));
m.set('conditions', { sickened: true });
result = sessionRolls(m, linked);
assert.deepEqual(result.spec.rolls, weaponRollSpec(m.data, 0, m.conditionState, null, true).rolls, 'condition adjustments match existing rolls');
const custom = { title: 'Blast', type: 'standard', attackFormula: 'attack.ranged', damageFormula: '{floor(level / 2)}d6 + str.mod', range: '30 ft.', targets: 'One creature', save: 'Reflex {caster.dc}', note: 'A note' };
result = sessionRolls(m, custom);
assert.equal(result.errors.length, 0);
assert.ok(result.damage.startsWith('5d6'));
assert.equal(result.spec.rolls[0].formula, `1d20${m.conditionState.adjusted.ranged >= 0 ? '+' : ''}${m.conditionState.adjusted.ranged}`.replace(/\+0$/, ''));
assert.equal(sessionRolls(m, { damageFormula: '2d6 + floor(level / 2)' }).damage, '2d6+5');
assert.equal(sessionRolls(m, { damageFormula: '2d6 + 1d8 - 3' }).damage, '1d8+2d6-3');
assert.equal(sessionRolls(m, { damageFormula: '2d6--1d6' }).damage, '3d6');
for (const damageFormula of ['2 * 1d6', '1d0', '2d6 + unknown', '1d6 | malicious', '1d6 + 1/0']) {
  assert.ok(sessionRolls(m, { damageFormula }).errors.length, damageFormula);
}
assert.ok(sessionRolls(m, { attackFormula: 'unknown' }).errors.length);
m.set('session.cards', [custom]);
assert.equal(sessionRollSpec(m, '0:damage').rolls.length, 1);
assert.equal(sessionRollSpec(m, '0:attack').rolls[0].label, 'Attack');
m.set('session.cards', [{ ...linked, type: 'full', extraAttacks: '1' }]);
const routine = sessionRollSpec(m, '0:all').rolls.map(r => r.label);
assert.deepEqual(routine.slice(0, 4), ['Attack 1', 'Damage 1', 'Attack 2', 'Damage 2'], 'copy all pairs each attack with its own damage');
assert.deepEqual(routine.filter(l => l.startsWith('Crit')), ['Crit confirm', 'Crit damage (x2)'], 'the crit lines follow once');
assert.equal(sessionRollSpec(m, '0:damage').rolls.length, 1, 'the damage button still copies one damage roll');
m.set('session.cards', [custom]);
const reopened = new Character(JSON.parse(JSON.stringify(m.toJSON())));
assert.deepEqual(sessionRolls(reopened, reopened.data.session.cards[0]), sessionRolls(m, custom));
const override = sessionRolls(m, { ...linked, attackFormula: '12', damageFormula: '3d8+2' });
assert.deepEqual(override.spec.rolls, [{label:'Attack',formula:'1d20+12'},{label:'Damage',formula:'3d8+2'}]);
// Multi-attack routines: a flurry, a hasted full attack, and a veil's extra arms.
const single = weaponRollSpec(m.data, 0, m.conditionState, null, true).rolls;
const bonus = Number(single[0].formula.replace(/^1d20(?:cs>\d+)?/, '')) || 0;
const plus = n => (n > 0 ? `+${n}` : n ? String(n) : '');
const flurry = sessionRolls(m, { ...linked, type: 'full', attackSet: 'top', extraAttacks: '3' });
const flurryAttacks = flurry.spec.rolls.filter(r => r.label.startsWith('Attack'));
assert.deepEqual(flurryAttacks.map(r => r.formula), Array(4).fill(single[0].formula), 'a flurry repeats the highest attack');
assert.equal(flurryAttacks.map(r => r.label).join(','), 'Attack 1,Attack 2,Attack 3,Attack 4');
assert.ok(flurry.spec.rolls.some(r => r.label === 'Crit confirm'), 'extra attacks keep the crit lines');
assert.equal(flurry.attack.split(' / ').length, 4);
assert.deepEqual(sessionRolls(m, { ...linked, type: 'full' }).spec.rolls,
  weaponRollSpec(m.data, 0, m.conditionState, null, false).rolls, 'a full-round card still takes the iteratives');
const banded = sessionRolls(m, { ...linked, extraAttacks: '1', attackModifier: '-2', extraDamage: '4d6 + 1' });
assert.equal(banded.spec.rolls[0].formula, `1d20${plus(bonus - 2)}`, 'the modifier folds into the attack bonus');
assert.equal(banded.spec.rolls.filter(r => r.label.startsWith('Attack')).length, 2);
const confirm = single.find(r => r.label === 'Crit confirm').formula;
assert.equal(banded.spec.rolls.find(r => r.label === 'Crit confirm').formula,
  confirm.replace(/^(1d20(?:cs>\d+)?)([+-]\d+)?/, (_, d, n) => d + plus((Number(n) || 0) - 2)), 'the modifier shifts the crit confirmation');
assert.equal(banded.damage, `${single.find(r => r.label === 'Damage').formula}+4d6+1`, 'extra damage joins the Damage roll');
assert.equal(banded.spec.rolls.find(r => r.label.startsWith('Crit damage')).formula,
  `${single.find(r => r.label.startsWith('Crit damage')).formula}+4d6+1`, 'and the crit line once, unmultiplied, like any rider');
const arms = sessionRolls(m, { ...linked, type: 'full', attackModifier: '-2', extraAttacks: '1, 2 @ -max(0, 4 - 1), 2 @ -8' });
const iteratives = weaponRollSpec(m.data, 0, m.conditionState, null, false).rolls.filter(r => r.label.startsWith('Attack')).length;
assert.deepEqual(arms.spec.rolls.filter(r => r.label.startsWith('Attack')).map(r => r.formula).slice(iteratives),
  [bonus - 2, bonus - 5, bonus - 5, bonus - 10, bonus - 10].map(n => `1d20${plus(n)}`), 'arm groups take their own penalty after the iteratives');
assert.ok(sessionRolls(m, { ...linked, extraAttacks: '1 @ -2 @ 3' }).errors.length, 'a group takes one modifier');
const dynamic = sessionRolls(m, { attackFormula: '10', extraAttacks: 'floor(level / 5) @ -level, {level >= 10} @ -(max(0, 4 - 1)), {level >= 30} @ -8' });
assert.deepEqual(dynamic.spec.rolls.filter(r => r.label.startsWith('Attack')).map(r => r.formula),
  ['1d20+10', '1d20', '1d20', '1d20+7'], 'counts and modifiers are both formulas, with or without braces');
assert.ok(sessionRolls(m, { attackFormula: '10', extraAttacks: '1 @ essence.nowhere' }).errors[0].includes('essence.nowhere'), 'an unknown value names itself');
// A value that is dice text -- defined with dice() in any description -- reads as dice in damage fields.
m.set('featGroups', [{ name: 'Test', entries: [{ name: 'Kinetic Fist', note: '{fist.simple = dice(4, 6)}', detail: '' }] }]);
assert.equal(m.scope().fist.simple, '4d6');
assert.equal(sessionRolls(m, { damageFormula: 'fist.simple' }).damage, '4d6', 'a bare dice value is damage');
assert.equal(sessionRolls(m, { damageFormula: '2d6 + {fist.simple}' }).damage, '6d6', 'braced dice text is spliced in');
assert.equal(sessionRolls(m, { damageFormula: '2d6 + fist.simple + 3' }).damage, '6d6+3', 'unbraced dice text too');
assert.equal(sessionRolls(m, { ...linked, extraDamage: '{fist.simple} + str.mod' }).damage,
  `${single.find(r => r.label === 'Damage').formula}+4d6${plus(m.scope().str.mod)}`, 'dice text works as extra damage');
assert.match(sessionRolls(m, { attackFormula: 'fist.simple' }).errors[0], /is text .*4d6.*Damage roll or Extra damage/, 'a dice value in a number field says where it belongs');
assert.ok(sessionRolls(m, { ...linked, extraAttacks: '-1' }).errors.length, 'negative extra attacks are rejected');
assert.ok(sessionRolls(m, { ...linked, extraDamage: '2 * 1d6' }).errors.length, 'extra damage is validated like damage');
assert.equal(sessionRolls(m, { attackFormula: '10', extraAttacks: '{floor(level / 5)}', attackModifier: '-1' }).attack, '+9 / +9 / +9', 'custom attacks take extras and modifiers');
const html = renderSessionBoard(m);
assert.ok(html.includes('session-roll-values'));
assert.ok(html.includes('5d6'));
m.set('session.cards.0.targets', '<img src=x onerror=alert(1)>');
assert.ok(!renderSessionBoard(m).includes('<img src=x'));
console.log('Session rolls: linked values, conditions, custom formulas, validation, separate rolls and persistence passed');
