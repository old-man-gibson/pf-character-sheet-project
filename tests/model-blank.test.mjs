/** Model checks that need no roster.
 *
 *  Every block here builds its own character from a blank document, or calls
 *  a rules function directly, so the suite runs in every checkout, CI
 *  included. The checks that sweep a roster or name a real character are in
 *  tests/model.test.mjs.
 *
 *  Run: node tests/model-blank.test.mjs */
import { bundledPacks, packCheck } from './fixtures.mjs';
import {
  Character, blankWeapon, setManeuverCatalogue, describeSource, maneuverDetails, maneuverIsWritten, maneuverOwn,
  setVancianTables, setPsionicTables, setCardcastingTables, setCookingTables, setAltTrainingTables,
  psionicTables, psionicCurve, psionicPoints, psionicClassTotal, wealthView, isoDay, rowLabel,
  hasManipulation, appendDiceText, appendListText, CARD_STAT_FIELDS, stepCastingTime,
  remoteAllowed, remotePlayArg,
} from '../app/js/model.js';
import {
  parseLevelRule, levelRuleLevels, levelRuleGrants, summariseLevels, COMBAT_SPHERES, MAGIC_SPHERES,
  ATTACK_MODES, ATTACK_MODE_KEY, attackModeTotal, wikiUrl, CONDITIONS, SHEET_CONDITIONS,
  conditionInfo, conditionCount, armorParts, statMod, critMultOf, threatText, GAME_SYSTEMS,
  stepDamageDice, stepDiceMap, enhancementCapNote, resolveAbility, GUILE_SPHERES, expertiseTalents,
  guilePackages, guileRanges, guileSkillHint, leveragePool, carryTiers, reducedSpeed,
} from '../app/js/rules.js';
import { mergeTables, registerTables } from '../app/js/extensions.js';
import { blankDocument } from '../app/js/convert.js';
import { featNames } from '../app/js/model/feats.js';
import { subsystems } from '../app/js/model/subsystems/registry.js';
import { normalizeCompanion } from '../app/js/companions.js';
import { rollSpec } from '../app/js/roll20.js';
import { NameIndex, evaluateFormula, resolvePath } from '../app/js/formula.js';
import { positionedRows } from '../app/js/model/templates.js';
import { blankGuileClass } from '../app/js/model/subsystems/guile.js';
import { emptyMonster } from '../app/js/monster/block.js';
import { working } from '../app/js/ui/rows.js';
import * as combatPanels from '../app/js/ui/panels/combat.js';
import * as trainingPanels from '../app/js/ui/panels/training.js';
import * as guilePanels from '../app/js/ui/panels/guile.js';
import * as subsystemPanels from '../app/js/ui/panels/subsystems.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// The shared tables, registered before any character is built, as the app
// does on load and as tests/model.test.mjs does.
const merged = mergeTables(bundledPacks());
registerTables(merged, {
  setManeuverCatalogue, setVancianTables, setPsionicTables, setCardcastingTables, setCookingTables,
  setAltTrainingTables,
});
const catalogue = merged.maneuvers;
const manipulationCheck = packCheck(check, (merged.cardcasting?.manipulations || []).length > 0,
  'the deck manipulations');

console.log('load -- the table, the worse of armour and load, quantities, coins, containers');
{
  check('Str 10 is 33 / 66 / 100', [carryTiers(10).light, carryTiers(10).medium, carryTiers(10).heavy], [33, 66, 100]);
  check('Str 30 is Str 20 four times over', carryTiers(30).heavy, 4 * carryTiers(20).heavy);
  check('a load cuts 30 to 20 and 20 to 15', [reducedSpeed(30), reducedSpeed(20), reducedSpeed(40)], [20, 15, 30]);

  const c = new Character(blankDocument({ name: 'Packmule', level: 5 }));
  c.data.equipment.armor = { ...c.data.equipment.armor, active: true, type: 'Light', name: 'Leather', acBonus: 2, maxDex: 6, acp: 0, weight: 15 };
  c.recompute();
  const str = c.data.carry.score;
  const { light, medium } = c.data.carry;
  const acAt = () => c.data.defenses.ac;
  const stealth = () => c.data.skills.find((s) => s.name === 'Stealth');
  const lightAc = acAt();
  c.listAdd('equipment.other', { slot: 'Other', name: 'Rations', qty: 1, weight: 1, cost: 0.5, note: '' });
  const rations = c.list('equipment.other').length - 1;
  c.setItem('equipment.other', rations, 'qty', medium - 15 - (light - 15) + light - 15);   // lands in the medium band
  check('a quantity multiplies the weight', c.data.carry.carried, 15 + (medium - 15));
  check('which is a medium load', c.data.carry.load, 'medium');
  check('the load caps Dexterity at +3 and has a −3 check penalty, worse than the leather',
    [armorParts(c.data).maxDex, armorParts(c.data).acp], [3, -3]);
  check('AC follows the cap when Dex is over it',
    acAt(), lightAc - Math.max(0, statMod(c.data, 'dex') - 3));
  c.set('carry.applyLoad', false);
  check('switched off, the leather alone applies', [armorParts(c.data).maxDex, armorParts(c.data).acp, acAt()], [6, 0, lightAc]);
  c.set('carry.applyLoad', true);

  // A bag of holding carries what is in it for nothing; a store is not carried.
  c.listAdd('equipment.other', { slot: 'Other', name: 'Bag of holding', qty: 1, weight: 15, cost: 2500, holds: 'weightless', note: '' });
  c.recompute();
  const bag = c.list('equipment.other').at(-1);
  check('a container is given an id', typeof bag.id, 'string');
  c.setItem('equipment.other', rations, 'inside', bag.id);
  check('rations in the bag weigh nothing; the bag weighs 15', [c.data.carry.carried, c.data.carry.load], [15 + 15, 'light']);
  c.setItem('equipment.other', rations, 'inside', 'stored');
  check('stored is not carried either', c.data.equipment.weights.stored > 0, true);

  c.set('equipment.coins', { gp: 500, sp: 120, cp: 5 });
  check('coins weigh a pound per fifty and are worth their gold', [c.data.equipment.weights.coins, c.data.equipment.coinValue], [12, 512.05]);
  // Coins go where an item can, or their weight is not tracked at all.
  const withCoins = c.data.carry.carried;
  c.set('equipment.coinsInside', bag.id);
  check('coins in the bag of holding weigh nothing',
    [c.data.equipment.weights.coins, c.data.equipment.weights.coinPounds, c.data.carry.carried], [0, 12, withCoins - 12]);
  c.set('equipment.coinsInside', 'stored');
  check('stored coins are not carried', [c.data.equipment.weights.coins, c.data.carry.carried], [0, withCoins - 12]);
  c.set('equipment.coinsInside', 'untracked');
  check('untracked coins weigh nothing and are still worth their gold',
    [c.data.equipment.weights.coins, c.data.equipment.weights.stored, c.data.equipment.coinValue], [0, c.data.equipment.weights.stored, 512.05]);
  c.setItem('equipment.other', c.list('equipment.other').length - 1, 'holds', 'counted');
  c.set('equipment.coinsInside', bag.id);
  check('in an ordinary container they weigh as usual', c.data.carry.carried, withCoins);
  c.set('equipment.coinsInside', '');
  check('on the character again', c.data.equipment.weights.coins, 12);

  // Carrying by another score: a class feature that carries by Intelligence.
  c.setBuild('int', 'untyped', 10);
  c.set('carry.ability', 'int');
  check('capacity reads the chosen score', [c.data.carry.score > str, c.data.carry.heavy], [true, carryTiers(c.data.carry.score).heavy]);

  // A sheet saved before load penalties, already past a light load, opens with
  // them off and its totals as saved.
  const old = JSON.parse(JSON.stringify(c.toJSON()));
  old.carry = { ...old.carry, ability: 'str', carried: 9999 };
  delete old.carry.applyLoad;
  delete old.carry.carriedOffset;
  old.corrections = old.corrections.filter((n) => n !== 'load-penalties');
  const savedAc = old.defenses.ac;
  const reopened = new Character(old);
  check('a heavy sheet from before opens with the penalties off, its AC as saved',
    [reopened.data.carry.applyLoad, reopened.data.defenses.ac], [false, savedAc]);
}

console.log('the attack totals carry a reconciliation offset, and it is reachable');
{
  // What the workbook said its attack bonus was, against what this sheet can
  // work out from BAB and the ability in the slot. The difference is the
  // offset, and it used to have nowhere at all to show: AC and the saves each
  // had an Other column, attack had none, so an imported figure nobody could
  // account for could not be found or corrected either.
  const doc = blankDocument({ id: 'atk', name: 'Atk' });
  doc.identity.level = 15;
  doc.attack = {
    ...doc.attack,
    bab: 11,
    babOverride: 11,
    miscBonus: 0,
    totalMelee: 38,
    totalRanged: 44,
    totalCmb: 38,
    modes: {
      melee: { value: -1, stat1: 'Str', stat2: null },
      altMelee: { value: 5, stat1: 'Dex', stat2: null },
      ranged: { value: 5, stat1: 'Dex', stat2: null },
      altRanged: { value: -1, stat1: 'Str', stat2: null },
      cmb: { value: -1, stat1: 'Str', stat2: null },
      altCmb: { value: 5, stat1: 'Dex', stat2: null },
    },
  };
  // Str 9 is -1 in the melee slot and Dex 20 is +5 in the ranged one.
  doc.statsBuild.str = { ...doc.statsBuild.str, pointBuy: 9, sheetTotal: 9 };
  doc.statsBuild.dex = { ...doc.statsBuild.dex, pointBuy: 20, sheetTotal: 20 };
  const c = new Character(doc);
  check('the imported figure is kept', c.data.attack.totalMelee, 38);
  check('and the part it cannot account for is the offset', c.offsetOf('attack.totalMelee'), 28);
  check('each mode carries its own', [c.offsetOf('attack.totalRanged'), c.offsetOf('attack.totalCmb')], [28, 28]);
  check('every real mode has a key to file it under',
    [ATTACK_MODE_KEY.melee, ATTACK_MODE_KEY.ranged, ATTACK_MODE_KEY.cmb],
    ['attack.totalMelee', 'attack.totalRanged', 'attack.totalCmb']);
  check('and an alternate has none of its own',
    ATTACK_MODES.filter((m) => ATTACK_MODE_KEY[m]), ['melee', 'ranged', 'cmb']);

  // Clearing it puts the total back to what the visible parts come to, and the
  // alternate follows, because it is that total with one ability swapped.
  c.setOffset('attack.totalMelee', 0);
  check('cleared, melee is BAB and the ability in the slot', c.data.attack.totalMelee, 11 - 1);
  check('and the alternate follows it', attackModeTotal(c.data, 'altMelee'), 11 + 5);
  check('the other two are untouched', [c.data.attack.totalRanged, c.data.attack.totalCmb], [44, 38]);
  c.setOffset('attack.totalMelee', 28);
  check('and it can be put back', c.data.attack.totalMelee, 38);

  // A bonus forwarded here is not an offset: it is written down and visible,
  // so it must not be swallowed into one when the document is reopened.
  c.setOffset('attack.totalMelee', 0);
  c.setClassFeature(c.data.classes[0]?.name || 'Fighter', 1, 'Features', 'Aim {attack.melee += 3}');
  check('a forwarded bonus lands', c.data.attack.totalMelee, 10 + 3);
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('and reopening leaves it forwarded, not folded into Other',
    [again.data.attack.totalMelee, again.offsetOf('attack.totalMelee')], [13, 0]);
}

console.log('what a class feature does is prose the sheet reads');
{
  /*
   * The notes under a class's ladder -- "What they do" -- are where a pack's
   * feature text lands and where a player writes a feature's rule. They used
   * to live on the Template tab, where every {…} was collected; once they
   * moved under the class, a name defined in one showed its value in the box
   * and was known nowhere else.
   */
  const c = new Character(blankDocument({ id: 'cfn', name: 'Cfn' }));
  const cls = 'Barbarian';
  const before = c.data.attack.totalMelee;
  c.addClassFeatureNote(cls, {
    name: 'Rage: the long form', type: 'Ex',
    text: 'Rage for {rage.rounds.max = 4 + 3} rounds, {attack.melee += 2} while raging.',
  });
  check('the note is a prose source, named after the feature',
    c.proseSources().some((f) => f.path === `featureNote:${cls}:Rage: the long form`), true);
  check('a name defined there is known everywhere',
    c.inlineNames['rage.rounds.max'], 7);
  check('a bonus forwarded there lands', c.data.attack.totalMelee, before + 2);
  check('the audit says where it was written, colon and all',
    describeSource(`featureNote:${cls}:Rage: the long form`), `Rage: the long form, under ${cls} features`);
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('and it survives a reopen', [back.inlineNames['rage.rounds.max'], back.data.attack.totalMelee],
    [7, before + 2]);
  c.setClassFeatureNote(cls, c.classFeatureNotes(cls).length - 1, { text: 'Rage.' });
  check('and leaves when the text does', ['rage.rounds.max' in c.inlineNames, c.data.attack.totalMelee],
    [false, before]);

  /*
   * A note waits on the level the ladder gives its feature. The ladder spells
   * the feature the way a class table does -- with a type tag, a size that
   * grows -- and the note is named once for all of those; only the first
   * arrival gates it, and the note's own formula scales from there.
   */
  c.set('identity.level', 3);
  c.addClassFeatureColumn(cls, 'Features');
  c.setClassFeature(cls, 6, 'Features', 'Trap sense +2 (Ex), Uncanny dodge');
  c.setClassFeature(cls, 3, 'Features', 'Trap sense +1 (Ex)');
  c.setClassFeature(cls, 5, 'Features', 'Improved uncanny dodge');
  c.addClassFeatureNote(cls, {
    name: 'Trap sense', type: 'Ex',
    text: '{trap.sense = floor(level / 3)} to Reflex saves against traps: {save.ref += trap.sense}',
  });
  c.addClassFeatureNote(cls, { name: 'Uncanny dodge', text: 'Keeps Dex to AC: {ac += 1}' });
  c.addClassFeatureNote(cls, { name: 'Nothing on the ladder', text: 'A house rule: {attack.melee += 1}' });
  check('the first level naming the feature is where it arrives',
    [c.classFeatureNoteLevel(cls, 'Trap sense'), c.classFeatureNoteLevel(cls, 'Uncanny dodge'),
      c.classFeatureNoteLevel(cls, 'Nothing on the ladder')], [3, 6, null]);
  check('a scaling feature is gated once, at its first step',
    c.proseSources().find((f) => f.path === `featureNote:${cls}:Trap sense`).future, undefined);
  check('a feature not yet reached is future',
    c.proseSources().find((f) => f.path === `featureNote:${cls}:Uncanny dodge`).future, true);
  check('a note the ladder never names is not gated',
    c.proseSources().find((f) => f.path === `featureNote:${cls}:Nothing on the ladder`).future, undefined);
  const ac = () => c.data.defenses.ac;
  const acBefore = ac();
  check('a name written in a future note still reads', c.inlineNames['trap.sense'], 1);
  // The level itself moves AC (attunement arrives on the way to 6th), so the
  // bonus is read as the difference the note makes at that level, not the
  // difference the level makes.
  c.set('identity.level', 6);
  const at6 = ac();
  const dodge = c.classFeatureNotes(cls).findIndex((n) => n.name === 'Uncanny dodge');
  c.setClassFeatureNote(cls, dodge, { text: 'Keeps Dex to AC.' });
  check('reaching the level turns its bonus on', at6 - ac(), 1);
  c.setClassFeatureNote(cls, dodge, { text: 'Keeps Dex to AC: {ac += 1}' });
  check('and the scaling note has scaled with the level', c.inlineNames['trap.sense'], 2);
  c.set('identity.level', 3);
  check('stepping back turns it off again', ac(), acBefore);

  // The notes are the player's list, in the player's order, and the ladder
  // above can ask which of them a cell is about.
  const order = () => c.classFeatureNotes(cls).map((n) => n.name);
  check('four notes, in the order they were written', order().length, 4);
  c.moveClassFeatureNote(cls, 3, 0);
  check('a note dragged to the front', order()[0], 'Nothing on the ladder');
  c.moveClassFeatureNote(cls, 0, 4);
  check('and back to the end', order()[3], 'Nothing on the ladder');
  c.moveClassFeatureNote(cls, 9, 0);
  check('a move from nowhere moves nothing', order()[3], 'Nothing on the ladder');
  check('a cell names the notes it is about, in their order',
    c.classFeatureNotesInCell(cls, 'Trap sense +2 (Ex), Uncanny dodge').map((x) => x.note.name),
    ['Trap sense', 'Uncanny dodge']);
  check('and a cell about nothing written names none',
    c.classFeatureNotesInCell(cls, 'Improved uncanny dodge'), []);

  /*
   * A feature specified in parentheses -- "Metalkinesis (Death Growl)" beside
   * "Metalkinesis" -- is its own feature when a note is written up under
   * exactly that name, and reads as the general one when it is not. The
   * general cell never reads a specialised note.
   */
  c.addClassFeatureNote(cls, { name: 'Metalkinesis', text: 'Bend metal.' });
  c.addClassFeatureNote(cls, { name: 'Metalkinesis (Death Growl)', text: 'Shriek through it.' });
  c.setClassFeature(cls, 2, 'Features', 'Metalkinesis');
  c.setClassFeature(cls, 4, 'Features', 'Metalkinesis (Death Growl)');
  c.setClassFeature(cls, 7, 'Features', 'Metalkinesis (Iron Skin)');
  const about = (text) => c.classFeatureNotesInCell(cls, text).map((x) => x.note.name);
  check('a specified feature written up under its name is that note alone',
    about('Metalkinesis (Death Growl)'), ['Metalkinesis (Death Growl)']);
  check('one not written up reads as the general feature',
    about('Metalkinesis (Iron Skin)'), ['Metalkinesis']);
  check('and the general cell is about the general note only', about('Metalkinesis'), ['Metalkinesis']);
  check('each arrives where its own spelling first appears',
    [c.classFeatureNoteLevel(cls, 'Metalkinesis'), c.classFeatureNoteLevel(cls, 'Metalkinesis (Death Growl)')],
    [2, 4]);
  check('a specialised note written up alone arrives at its own cell, not the general one',
    [c.classFeatureNoteLevel(cls, 'Metalkinesis (Iron Skin)')], [7]);
  c.removeClassFeatureNote(cls, c.classFeatureNotes(cls).findIndex((n) => n.name === 'Metalkinesis (Death Growl)'));
  check('without its own note, the specified cell falls back to the general one',
    about('Metalkinesis (Death Growl)'), ['Metalkinesis']);
}

console.log('dragging a feat -- up its own group, or across into another');
{
  const c = new Character(blankDocument({ id: 'drag', name: 'Drag' }));
  c.data.featGroups = [
    { name: 'A', entries: [{ name: 'one', detail: '' }, { name: 'two', detail: '' }, { name: 'three', detail: '' }] },
    { name: 'B', entries: [{ name: 'four', detail: '' }] },
    { name: 'C', entries: [] },
  ];
  const A = 'featGroups.0.entries';
  const B = 'featGroups.1.entries';
  const C = 'featGroups.2.entries';
  const names = (path) => c.list(path).map((f) => f.name);

  // Within one group this is listMoveTo, and `to` counts the list as it is
  // now: dropping below "three" is 3 even though the row came from above it.
  c.listMoveInto(A, 0, A, 3);
  check('a feat dropped below the last one lands last', names(A), ['two', 'three', 'one']);
  c.listMoveInto(A, 2, A, 0);
  check('and dropped above the first, first', names(A), ['one', 'two', 'three']);
  c.listMoveInto(A, 1, A, 1);
  check('dropped where it already was, nothing moves', names(A), ['one', 'two', 'three']);

  // Across groups it leaves one list and joins the other at the point named.
  c.listMoveInto(A, 1, B, 0);
  check('it leaves the group it came from', names(A), ['one', 'three']);
  check('and arrives where it was dropped', names(B), ['two', 'four']);

  // An empty group is a place a feat can be dropped, which is the whole
  // reason its table keeps a row to drop onto.
  c.listMoveInto(B, 1, C, 0);
  check('an empty group takes one', names(C), ['four']);
  check('leaving the other with what is left', names(B), ['two']);

  // Past the end of the destination, or before its start, still lands.
  c.listMoveInto(C, 0, A, 99);
  check('a drop past the end lands last', names(A), ['one', 'three', 'four']);
  c.listMoveInto(A, 2, B, -5);
  check('and before the start, first', names(B), ['four', 'two']);

  // An index that is not there moves nothing at all.
  const before = [names(A), names(B), names(C)];
  c.listMoveInto(A, 9, B, 0);
  check('an index off the end of the source is refused', [names(A), names(B), names(C)], before);
}

console.log('level-up feats -- ten fixed slots, one per odd level');
{
  const doc = blankDocument({ id: 'lvl', name: 'Lvl' });
  doc.feats = {
    'Level Up': [{ name: 'Dodge', detail: '3' }, { name: 'Toughness', detail: '1' }, { name: 'Undated', detail: '' }],
    Class: [{ name: 'Bonus', detail: 'Fighter 1' }],
  };
  const c = new Character(doc);
  const L = `featGroups.${c.data.featGroups.findIndex((g) => g.levelUp)}.entries`;
  const K = `featGroups.${c.data.featGroups.findIndex((g) => g.name === 'Class')}.entries`;
  const rows = () => c.list(L).map((f) => `${f.detail}:${f.name}`);
  check('feats are seated by their level, the undated one in the first free slot', rows().slice(0, 3),
    ['1:Toughness', '3:Dodge', '5:Undated']);
  check('and every odd level to 19 has a slot', c.list(L).map((f) => f.detail),
    ['1', '3', '5', '7', '9', '11', '13', '15', '17', '19']);
  c.listMove(L, 0, 1);
  check('a feat moved takes the level of where it lands', rows().slice(0, 2), ['1:Dodge', '3:Toughness']);
  c.listMoveTo(L, 2, 10);
  check('dragged to the end, it is the level-19 feat', [rows()[2], rows()[9]], ['5:', '19:Undated']);
  check('nothing is added', [c.listAdd(L, { name: 'Extra' }), c.list(L).length], [null, 10]);
  c.listRemove(L, 0);
  check('nothing is removed', rows()[0], '1:Dodge');
  c.listMoveInto(L, 0, K, 0);
  c.listMoveInto(K, 0, L, 0);
  check('nothing is dragged out or in', [rows()[0], c.list(K).map((f) => f.name)], ['1:Dodge', ['Bonus']]);
  const before = c.data.featGroups.length;
  c.listRemove('featGroups', c.data.featGroups.findIndex((g) => g.levelUp));
  check('and the group itself stays', c.data.featGroups.length, before);
  check('a blank character starts with the ten slots', new Character(blankDocument({ name: 'New' })).data.featGroups
    .find((g) => g.levelUp)?.entries.length, 10);

  const over = blankDocument({ id: 'over', name: 'Over' });
  over.feats = { 'Level Up': Array.from({ length: 12 }, (_, i) => ({ name: `F${i}`, detail: '' })) };
  const o = new Character(over);
  check('more feats than slots: the extras move to Other/Flex, not lost',
    o.data.featGroups.find((g) => g.name === 'Other/Flex')?.entries.map((f) => f.name), ['F10', 'F11']);
}

console.log('tags() -- feats counted by a tag in brackets');
{
  const c = new Character(blankDocument({ id: 'tags', name: 'Tags' }));
  c.data.featGroups.push({ name: 'Other', entries: [
    { name: 'Lucky Break [Chance]' }, { name: 'Card Shark [Chance, Deck]' },
    { name: 'Heart of the Cards [Deck]' }, { name: 'Chance Encounter' },
  ] });
  c.recompute();
  const s = c.scope();
  check('each tag counted, a feat with two counted toward both, an unbracketed word not at all',
    resolvePath(s, 'tags'), { chance: 2, deck: 2 });
  check('tags() reads the count', evaluateFormula('tags("Chance") + tags("Deck")', s), 4);
  check('and is 0 for a tag nobody has', evaluateFormula('tags("Kismet")', s), 0);
}

console.log('a hit-point style saved before the meter was handed the damage keeps its look');
{
  const doc = blankDocument({ name: 'Styled', level: 5 });
  doc.meterStyles = { hp: { shape: 'bar', fill: 'spent', color: '#3b82f6', zones: [] } };
  const c = new Character(doc);
  check('a saved Fill, which drained, becomes Drain', [c.data.meterStyles.hp.fill, c.data.meterStyles.hp.color],
    ['remaining', '#3b82f6']);
  check('once, and the document says so', c.toJSON().corrections.includes('hp-meter-fill'), true);
  c.setMeterStyle('hp', { ...c.meterStyle('hp'), fill: 'spent' });
  const again = new Character(c.toJSON());
  check('a Fill chosen after it stays Fill', again.meterStyle('hp').fill, 'spent');
}

console.log('a weapon row read one column off by an older import gets its crit back');
{
  // The importer read "1d6+16 | 15 | 2" (total damage, crit range,
  // multiplier) into the crit range, multiplier and bonus crit damage.
  const shifted = { ...blankWeapon(), name: 'Katana', critRange: 1, critMult: 15, bonusCritDamage: 2 };
  const doc = blankDocument({ name: 'Shifted', level: 9 });
  doc.equipment.weapons = [
    shifted,
    { ...shifted, name: 'Wakizashi', critRange: 1, critMult: 18, bonusCritDamage: 'x3' },
    { ...blankWeapon(), name: 'Fixed by hand', critRange: 15, critMult: 2, bonusCritDamage: null },
    { ...blankWeapon(), name: 'Real bonus', critRange: 19, critMult: 'x3', bonusCritDamage: '1d6' },
  ];
  const c = new Character(doc);
  const crit = (i) => {
    const w = c.list('equipment.weapons')[i];
    return [w.critRange, w.critMult, w.bonusCritDamage];
  };
  check('the range, multiplier and bonus move back', crit(0), [15, 2, null]);
  check('the app prints the threat it should', threatText(c.list('equipment.weapons')[0].critRange,
    critMultOf(c.list('equipment.weapons')[0].critMult)), '15-20/x2');
  check('a multiplier written x3 moves back as written', crit(1), [18, 'x3', null]);
  check('a row put right by hand is left alone', crit(2), [15, 2, null]);
  check('a real bonus crit damage is left alone', crit(3), [19, 'x3', '1d6']);
  check('once, and the document says so', c.toJSON().corrections.includes('weapon-crit-shift'), true);

  // A document saved after the fix keeps whatever it holds.
  const later = JSON.parse(JSON.stringify(doc));
  later.corrections = [...c.toJSON().corrections];
  const kept = new Character(later);
  const w = kept.list('equipment.weapons')[0];
  check('a document already corrected is not touched again', [w.critRange, w.critMult, w.bonusCritDamage], [1, 15, 2]);
}

console.log('the differences from the source sheet can be cleared');
{
  // The header counts the totals that moved since the sheet opened; a level
  // gained moves most of them, and the count should be the player's to clear.
  const c = new Character(blankDocument({ name: 'Climber', level: 4 }));
  c.listAdd('classes', { name: 'Fighter', hd: 10, bab: 1, goodFort: true, goodRef: false, goodWill: false,
    skillRanks: 2, archetypes: '', levelsOverride: null, systems: [] });
  const opened = new Character(c.toJSON());
  check('a sheet opens with nothing changed', opened.diffFromSource().length, 0);
  opened.set('identity.level', 5);
  const moved = opened.diffFromSource();
  check('a level moves totals away from the source sheet', moved.length > 0, true);
  const at = (key) => (key === 'initiative' ? 'hp.initiative' : key).split('.').reduce((o, k) => o?.[k], opened.data);
  const totals = moved.map((d) => at(d.key));
  opened.acceptSourceDiffs();
  check('clearing starts the count again', opened.diffFromSource(), []);
  check('and moves nothing on the character',
    moved.map((d) => at(d.key)), totals);
  opened.set('identity.level', 6);
  check('the next change counts from there', opened.diffFromSource().length > 0, true);

  // The Magic tab's "sheet: 15": the workbook's cached casting totals, which
  // go stale with the first level. They can be let go, and that undoes.
  const doc = blankDocument({ name: 'Caster', level: 4 });
  doc.training = { ...(doc.training || {}) };
  const m = new Character(doc);
  m.addTrainingClass('magic');
  m.data.training.magic.sheet = { totalCL: 99, totalDC: 99, totalMSB: 99, totalMSD: 99, totalSP: 7, boons: 2 };
  m.recompute();
  const magic = () => combatPanels.renderMagicPanel(m);
  check('a cached total that differs is a button that lets it go',
    [magic().includes('<button class="badge err sheetfig" data-action="forget-sheet-casting"'), magic().includes('>sheet: 99 ×</button>')], [true, true]);
  m.forgetSheetCasting();
  check('let go, the five casting totals are gone and nothing else',
    m.data.training.magic.sheet, { boons: 2 });
  check('so the badges are gone', magic().includes('forget-sheet-casting'), false);
  check('and it can be taken back', [m.undo(), m.data.training.magic.sheet.totalCL], ['Stopped comparing with the Google Sheet', 99]);
}

console.log('mythic base abilities -- initiative, the death threshold, surge and power by tier');
{
  const c = new Character(blankDocument({ name: 'Hero', level: 20 }));
  const con = () => c.data.abilities.con.workingScore ?? c.data.abilities.con.tempScore;
  const init = () => c.breakdown('initiative').parts.find((p) => /Amazing Initiative/.test(p.label))?.value ?? null;
  c.set('mythic.tierOverride', 0);
  check('no tier: death at negative Con, no initiative part',
    [c.hpState.deathAt, init(), c.scope().mythic.surge, c.scope().mythic.power], [-con(), null, 0, 0]);
  c.set('mythic.tierOverride', 1);
  check('tier 1: Hard to Kill doubles the threshold, surge d6, 5 uses, still no initiative bonus',
    [c.hpState.deathAt, c.scope().hp.death, init(), c.scope().mythic.surge, c.scope().mythic.power], [-2 * con(), -2 * con(), null, 6, 5]);
  c.set('mythic.tierOverride', 2);
  check('tier 2: Amazing Initiative adds the tier', [init(), c.data.hp.initiative - (Number(c.scope().dex.tempMod) || 0)], [2, 2]);
  c.set('mythic.tierOverride', 7);
  check('tier 7: surge d10, 17 uses, +7 initiative', [c.scope().mythic.surge, c.scope().mythic.power, init()], [10, 17, 7]);
  c.set('hp.deathBonus', 5);
  check('the threshold bonus still adds on top', c.hpState.deathAt, -(2 * con() + 5));
  c.set('mythic.tierOverride', null);
  check('tier 10 by level: surge d12, 23 uses', [c.data.identity.mythicTier, c.scope().mythic.surge, c.scope().mythic.power], [10, 12, 23]);

  // Mythic Paragon: effects read the tier 2 higher; what is reached does not move.
  c.set('mythic.tierOverride', 5);
  c.set('mythic.paragon', true);
  check('paragon: formulas, initiative, power and surge read tier 7', [c.scope().mythic.tier, c.scope().mythic.baseTier, init(), c.scope().mythic.power, c.scope().mythic.surge], [7, 5, 7, 17, 10]);
  check('the tier reached stays 5', c.data.identity.mythicTier, 5);
  check('the Mythic Power tracker follows', c.trackers.find((t) => t.id === 'mythic_power')?.max, 17);
  c.set('mythic.paragon', false);
  check('off again', [c.scope().mythic.tier, init(), c.scope().mythic.power], [5, 5, 13]);
  check('and saved as a flag', new Character(c.toJSON()).data.mythic.paragon, false);
}

console.log('flowing power -- the increase, its damage, the free rounds and the day');
{
  const c = new Character(blankDocument({ name: 'Flow', level: 15 }));
  c.set('mythic.tierOverride', 5);
  // The scores with the buffs in: what the sheet shows in red.
  const str = () => c.conditionState.scores.str;
  const base = str();
  const left = () => { const t = c.trackers.find((x) => x.id === 'mythic_power'); return t.max - t.current; };
  c.set('mythic.flowing.increase', 3);
  check('without the tradition ability nothing happens', [str(), c.conditionState.buffsOn], [base, 0]);
  c.set('mythic.flowingPower', true);
  check('+3 to every score, counted as a buff', [str(), c.conditionState.scores.cha - c.data.abilities.cha.workingScore, c.conditionState.buffsOn], [base + 3, 3, 1]);
  c.set('mythic.flowing.increase', 9);
  check('capped at the tier', str(), base + 5);
  c.set('mythic.paragon', true);
  check('Paragon raises the cap', str(), base + 7);
  c.set('mythic.paragon', false);
  c.set('mythic.flowing.increase', 3);
  const max = c.hpMax;
  const cur = c.hpState.current;
  const r = c.flowingRound();
  check('a round costs the square of the increase, off real hit points and the maximum', [r.taken, c.hpState.current, c.hpMax, c.data.hp.strain], [9, cur - 9, max - 9, 9]);
  c.heal(50);
  check('healing cannot buy the strain back', c.hpState.current, max - 9);
  const uses = left();
  const fr = c.flowingFree();
  check('one use of mythic power buys half the tier in free rounds', [fr.rounds, left(), c.data.mythic.flowing.freeLeft], [2, uses - 1, 2]);
  const r2 = c.flowingRound();
  check('a free round costs nothing', [r2.free, r2.taken, c.hpMax, c.data.mythic.flowing.freeLeft], [true, 0, max - 9, 1]);
  check('a spent pool buys nothing', (() => { for (let i = left(); i > 0; i--) c.stepTracker('mythic_power', 1); return c.flowingFree().spent; })(), false);
  c.rest('day');
  check('a new day heals the strain and ends the effect', [c.hpMax, c.hpState.current, c.data.hp.strain, c.data.mythic.flowing.increase, c.data.mythic.flowing.freeLeft], [max, max, 0, 0, 0]);
}

console.log('mythic paths -- a second path, kept with the character');
{
  const c = new Character(blankDocument({ name: 'Dual', level: 20 }));
  check('no extra paths to start', c.data.mythic.paths, []);
  c.set('mythic.path', 'Champion');
  c.listAdd('mythic.paths', { path: 'Trickster', basePathAbility: 'Trickster Attack', grantedBy: 'Dual Path' });
  const back = new Character(c.toJSON());
  check('the path, its base ability and its source are saved',
    back.data.mythic.paths, [{ path: 'Trickster', basePathAbility: 'Trickster Attack', grantedBy: 'Dual Path' }]);
  check('bonus hit points per tier still follow the first path', back.data.mythic.path, 'Champion');
  check('a malformed entry is dropped on load', new Character({ ...c.toJSON(), mythic: { ...c.toJSON().mythic, paths: ['x', null, { path: 'Marshal' }] } }).data.mythic.paths,
    [{ path: 'Marshal', basePathAbility: '', grantedBy: '' }]);
}

console.log('gear bonuses -- an item\'s enhancement bonus to an ability fills the Gear column');
{
  const c = new Character(blankDocument({ name: 'Belted', level: 10 }));
  const str = () => c.data.abilities.str.score;
  const fwd = () => c.contributions.totals['str.score'] || 0;
  const s0 = str();
  c.setItem('equipment.gear', 0, 'name', 'Belt of Giant Strength');
  c.setItem('equipment.gear', 0, 'bonuses.0.value', 4);
  c.setItem('equipment.gear', 0, 'bonuses.0.type', 'Enhancement');
  c.setItem('equipment.gear', 0, 'bonuses.0.target', 'str.score');
  check('the score gains it', str(), s0 + 4);
  check('through the Gear column, not as a forwarded bonus', [c.data.statsBuild.str.resolved.gearItems, fwd()], [4, 0]);
  check('the Stats tab can name the item', c.gearItemBonuses('str'), [{ where: 'Belt of Giant Strength', value: 4 }]);
  check('and so does the working', c.breakdown('str').parts.find((p) => p.label === 'enhancement')?.note, 'gear 4 (Belt of Giant Strength)');
  c.setBuild('str', 'gear', 4);
  check('a typed Gear value of the same size does not stack with it', c.data.statsBuild.str.resolved.enhancement, 4);
  c.setBuild('str', 'gear', 6);
  check('a larger typed value is the one that counts', [str(), c.breakdown('str').parts.find((p) => p.label === 'enhancement')?.note],
    [s0 + 6, 'gear 6']);
  c.setBuild('str', 'gear', 0);
  c.setItem('equipment.gear', 0, 'bonuses.0.value', 8);
  check('an item above +6 counts in full', [str(), c.data.statsBuild.str.resolved.enhancement], [s0 + 8, 8]);
  // The +6 cap is on ABP and gear added together; gear above it stands alone.
  check('with ABP beside it, gear above +6 still counts in full and ABP adds nothing',
    [resolveAbility({ abp: 6 }, 8).enhancement, enhancementCapNote(resolveAbility({ abp: 6 }, 8))],
    [8, 'Gear above +6 counts on its own. ABP adds nothing to it.']);
  check('below +6 the two stack up to the cap',
    [resolveAbility({ abp: 4 }, 4).enhancement, enhancementCapNote(resolveAbility({ abp: 4 }, 4))],
    [6, 'ABP and gear stack up to +6. 2 is wasted.']);
  c.setItem('equipment.gear', 0, 'bonuses.0.value', 4);
  check('it survives a save', new Character(JSON.parse(JSON.stringify(c.toJSON()))).data.abilities.str.score, s0 + 4);
  c.setItem('equipment.gear', 0, 'bonuses.0.type', 'Morale');
  check('another type is still forwarded', [str(), fwd(), c.data.statsBuild.str.resolved.gearItems], [s0 + 4, 4, undefined]);
  c.setItem('equipment.gear', 0, 'bonuses.0.type', 'Enhancement');
  c.setItem('equipment.gear', 0, 'bonuses.0.target', '');
  check('aimed nowhere, it is gone again', [str(), c.data.statsBuild.str.resolved.gearItems], [s0, undefined]);

  // A headband of +6 to the three mental scores, as one bonus aimed at all three.
  const mental = ['int', 'wis', 'cha'];
  const m0 = mental.map((k) => c.data.abilities[k].score);
  c.setItem('equipment.gear', 1, 'name', 'Headband of Mental Prowess');
  c.setItem('equipment.gear', 1, 'bonuses.0.value', 6);
  c.setItem('equipment.gear', 1, 'bonuses.0.type', 'Enhancement');
  c.setItem('equipment.gear', 1, 'bonuses.0.target', 'int.score, wis.score, cha.score');
  check('a bonus aimed at three scores fills each one\'s Gear column',
    mental.map((k) => [c.data.abilities[k].score, c.data.statsBuild[k].resolved.gearItems, c.contributions.totals[`${k}.score`] || 0]),
    m0.map((s) => [s + 6, 6, 0]));
}

console.log('material casting: the next whole month, counted as DATEDIF counts it');
{
  const w = { materialCasting: true, lastOffering: '2026-01-31' };
  // No 31st in February: DATEDIF counts the month from the 1st of March.
  check('a month-end offering is counted again from the 1st', wealthView(w, new Date(2026, 1, 15), 3).nextMonth, '2026-03-01');
  check('nothing to count without a date', wealthView({ materialCasting: true }, new Date(2026, 1, 15), 3).nextMonth, '');
  check('nor without the switch', wealthView({ lastOffering: '2026-01-31' }, new Date(2026, 1, 15), 3).nextMonth, '');
}

console.log('a date box\'s six-digit year is no date, and a date after today counts nothing');
{
  // A date box lets its year run to 275760; the counts read "2757" off it and came out NaN.
  check('a year that is not four digits is not a date', [isoDay('275760-05-05'), isoDay('20261-05-05'), isoDay(new Date(275760, 4, 5))], ['', '', '']);
  const owing = { materialCasting: true, oathOfOfferings: true, manaPerDay: 10, current: 100 };
  const v = wealthView({ ...owing, lastOffering: '275760-05-05' }, new Date(2026, 9, 11), 16);
  check('so nothing is counted from it, and nothing is NaN', [v.lastOffering, v.days, v.months, v.expected.total, v.after], ['', 0, 0, 0, 100]);
  const f = wealthView({ ...owing, lastOffering: '2026-12-01' }, new Date(2026, 9, 11), 16);
  check('a last offering after today is flagged and counts nothing', [f.future, f.days, f.months, f.expected.total, f.today], [true, 0, 0, 0, '2026-10-11']);
  check('today is not after today', wealthView({ ...owing, lastOffering: '2026-10-11' }, new Date(2026, 9, 11), 16).future, false);
}

console.log('sub-systems in use, marked on classes, and the two views of the bar');
{
  const c = new Character(blankDocument({ name: 'Viewy' }));

  // A blank sheet uses nothing -- the two sphere tabs and Crafting included,
  // which is what the ⚙ manager's empty/in-use badges read.
  const inUse = c.systemTabsInUse();
  check('the badge list covers the sphere and crafting tabs too',
    ['martial', 'magic', 'crafting'].every((k) => k in inUse), true);
  check('a blank sheet uses nothing', Object.values(inUse).some(Boolean), false);

  // Data arriving flips a system to in use.
  c.set('training.magic.tradition.name', 'Fey Adept');
  check('a named casting tradition puts Magic Spheres in use', c.systemTabsInUse().magic, true);
  // The sides answer for themselves: a caster is not a practitioner.
  check('and leaves Martial Spheres empty', c.systemTabsInUse().martial, false);
  c.listAdd('crafting.projects', { name: 'Cloak of Resistance', value: 1000 });
  check('a crafting project puts Crafting in use', c.systemTabsInUse().crafting, true);

  // Marking a system on a class lights its tabs before any data exists.
  c.listAdd('classes', {
    name: 'Warlord', hd: 10, bab: 1, goodFort: true, goodRef: true, goodWill: false,
    skillRanks: 4, archetypes: '', levelsOverride: null, systems: [],
  });
  const ci = c.data.classes.length - 1;
  c.toggleClassSystem(ci, 'path-of-war');
  c.toggleClassSystem(ci, 'akashic');
  check('tags land on the class row', c.data.classes[ci].systems, ['path-of-war', 'akashic']);
  check('tags light their tabs', [...c.taggedSystemTabs()].sort(), ['akashic', 'maneuvers']);
  c.toggleClassSystem(ci, 'akashic');
  check('toggling again unmarks', [...c.taggedSystemTabs()], ['maneuvers']);

  // The session view seeds its bar from what is used or marked, and the two
  // views keep their orders apart from then on.
  check('starts in the build view', c.viewMode(), 'build');
  const buildOrder = c.tabOrder();
  c.setViewMode('session');
  check('the session bar carries what is in use or marked',
    ['magic', 'crafting', 'maneuvers'].every((k) => c.tabOrder().includes(k)), true);
  check('and skips the empty systems and the build machinery',
    ['martial', 'vancian', 'akashic', 'stats', 'progression'].some((k) => c.tabOrder().includes(k)), false);
  c.hideTab('lore');
  check('hiding in the session view edits the session bar', c.tabOrder().includes('lore'), false);
  c.setViewMode('build');
  check('the build bar is untouched', c.tabOrder(), buildOrder);
  c.setViewMode('session');
  check('the session bar is remembered, not re-seeded', c.tabOrder().includes('lore'), false);
  c.resetTabOrder();
  check('reset re-seeds the session bar from use', c.tabOrder().includes('lore'), true);
  check('the mode survives a round trip', new Character(c.toJSON()).viewMode(), 'session');

  // A worksheet's place on the session bar follows a rename and goes with a delete.
  const tab = c.addSystemTab('Rituals');
  const idx = c.data.sheetTabs.indexOf(tab);
  c.showTab('sys:Rituals');
  c.renameSystemTab(idx, 'Rites');
  check('rename carries the session bar entry',
    c.tabOrder().includes('sys:Rites') && !c.tabOrder().includes('sys:Rituals'), true);
  c.removeSystemTab(idx);
  check('delete drops the session bar entry', c.tabOrder().includes('sys:Rites'), false);
}

console.log('session quick actions -- damage, healing, and the night\'s rest');
{
  const c = new Character(blankDocument({ name: 'Quick', level: 5 }));
  const max = c.hpState.max;

  c.set('hp.temp', 5);
  const hit = c.applyDamage(8);
  check('temporary hit points absorb first', [hit.fromTemp, c.data.hp.temp, c.data.hp.current], [5, 0, max - 3]);
  c.applyDamage(max);
  check('damage crosses zero -- dying is watched, not clamped', c.data.hp.current < 0, true);

  c.set('hp.current', max - 10);
  c.set('hp.nonlethal', 4);
  const heal = c.applyHealing(6);
  check('healing raises current and erases nonlethal alike',
    [heal.healed, c.data.hp.current, c.data.hp.nonlethal], [6, max - 4, 0]);
  c.applyHealing(100);
  check('healing stops at the maximum', c.data.hp.current, max);

  // Rest refreshes what reads as daily and leaves other rhythms alone.
  const daily = c.addTracker({ name: 'Ki', maxFormula: '5', refresh: 'Daily' });
  const weekly = c.addTracker({ name: 'Favors', maxFormula: '3', refresh: 'per week' });
  c.updateTracker(daily.id, { current: 4 });
  c.updateTracker(weekly.id, { current: 2 });
  check('a new day refreshes the daily pool only', [c.rest('day').trackers,
    c.trackers.find((t) => t.id === daily.id).current,
    c.trackers.find((t) => t.id === weekly.id).current], [1, 0, 2]);

  // The dashboard's reminder list is ordinary list data and survives a round trip.
  c.listAdd('effects', { name: 'Studied Target', note: '+2 vs the marked foe', on: true });
  check('active-effect reminders round-trip',
    new Character(c.toJSON()).data.effects, [{ name: 'Studied Target', note: '+2 vs the marked foe', on: true }]);
}

console.log('buffs -- ticked bonuses riding the condition machinery, dials take formulas');
{
  const c = new Character(blankDocument({ name: 'Buffy', level: 6 }));
  c.listAdd('buffs', {
    name: 'Haste', on: true, attack: 1, damage: 0, ac: 1, saves: 0, skills: 0, initiative: 0, note: '',
  });
  let cs = c.conditionState;
  check('a ticked buff moves the now numbers',
    [cs.changed, cs.adjusted.melee - cs.base.melee, cs.adjusted.ac - cs.base.ac], [true, 1, 1]);
  check('and counts as on', cs.buffsOn, 1);
  c.setItem('buffs', 0, 'on', false);
  cs = c.conditionState;
  check('unticked it moves nothing', [cs.changed, cs.buffsOn], [false, 0]);

  // A dial takes a formula in the tracker sandbox and keeps up with the scope.
  c.setItem('buffs', 0, 'on', true);
  c.setItem('buffs', 0, 'attack', '1 + floor(level / 2)');
  check('a formula dial resolves against the scope', c.data.buffs[0].attackNum, 4);
  check('and lands on the roll numbers', c.conditionState.adjusted.melee - c.conditionState.base.melee, 4);
  c.setItem('buffs', 0, 'attack', 'no_such_name');
  check('a broken dial degrades to 0 with the error on the row',
    [c.data.buffs[0].attackNum, !!c.data.buffs[0].error], [0, true]);

  // Buffs and conditions add up in the same totals.
  c.setItem('buffs', 0, 'attack', 2);
  c.data.conditions = { Shaken: true };
  c.recompute();
  check('a +2 buff and shaken (−2) cancel on attacks',
    c.conditionState.adjusted.melee - c.conditionState.base.melee, 0);

  // A buff's note is prose: a {name = expr} written there is a definition the
  // whole sheet reads by name -- and it stands whether the buff is ticked.
  c.setItem('buffs', 0, 'note', '{deathgrip.dmg.max = 2 * (1 + level)}');
  check('a note definition lands in the inline names', c.inlineNames['deathgrip.dmg.max'], 14);
  c.setItem('buffs', 0, 'on', false);
  check('and stands while the buff is off', c.inlineNames['deathgrip.dmg.max'], 14);
}

console.log('energy drain -- the full scope of a negative level');
{
  const c = new Character(blankDocument({ name: 'Drained', level: 5 }));
  c.data.conditions = { 'Energy Drain': 2 };
  c.recompute();
  const cs = c.conditionState;
  check('cumulative −1 on attacks, CMB, CMD, saves, skills and ability checks',
    [cs.delta.melee, cs.delta.cmb, cs.delta.cmd, cs.delta.fortitude, cs.delta.skills, cs.delta.abilityChecks],
    [-2, -2, -2, -2, -2, -2]);
  check('−5 total hit points per level', cs.delta.hp, -10);
  const info = conditionInfo('Energy Drain');
  check('the notes carry the level-dependent, no-lost-spells and death clauses',
    info.notes.some((n) => /level-dependent/.test(n))
    && info.notes.some((n) => /no prepared spells/.test(n))
    && info.notes.some((n) => /dies/.test(n)), true);
}

console.log('maneuver notes -- the player\'s line under a readied maneuver');
{
  const c = new Character(blankDocument({ name: 'Blade', level: 5 }));
  c.listAdd('maneuvers.disciplines', { name: 'Golden Lion', known: ['Demoralizing Roar'] });
  c.setManeuverNote('maneuvers.disciplines.0', 'Demoralizing Roar', 'Allies move {5 * floor(level / 2)} ft.');
  check('the note is stored by name',
    c.data.maneuvers.disciplines[0].notes['Demoralizing Roar'], 'Allies move {5 * floor(level / 2)} ft.');
  check('and survives a round trip',
    new Character(c.toJSON()).data.maneuvers.disciplines[0].notes['Demoralizing Roar'],
    'Allies move {5 * floor(level / 2)} ft.');
  c.setManeuverNote('maneuvers.disciplines.0', 'Demoralizing Roar', '   ');
  check('an emptied note is removed, not stored blank',
    'Demoralizing Roar' in c.data.maneuvers.disciplines[0].notes, false);

  /*
   * The cells beside the description. The bundled catalogue fills in only the
   * type -- the rest is a publisher's rules text -- so on this discipline the
   * action, range, target, duration and save are the player's to write, and
   * they read {…} the way the description always has.
   */
  const disc = () => c.data.maneuvers.disciplines[0];
  check('nothing written yet', maneuverIsWritten(maneuverOwn(disc(), 'Demoralizing Roar')), false);
  c.setManeuverField('maneuvers.disciplines.0', 'Demoralizing Roar', 'action', 'Standard');
  c.setManeuverField('maneuvers.disciplines.0', 'Demoralizing Roar', 'range', '{= 5 * level} ft.');
  c.setManeuverField('maneuvers.disciplines.0', 'Demoralizing Roar', 'save', 'Will');
  check('a cell is stored under its own key',
    disc().notes['Demoralizing Roar'],
    { action: 'Standard', range: '{= 5 * level} ft.', save: 'Will' });
  check('the player wrote just those three',
    maneuverOwn(disc(), 'Demoralizing Roar'),
    {
      type: '', action: 'Standard', range: '{= 5 * level} ft.', target: '',
      duration: '', save: 'Will', dc: '', text: '',
    });
  // ...and reading it back lays the catalogue's type underneath them.
  check('the card reads them over the catalogue',
    maneuverDetails(disc(), 'Demoralizing Roar'),
    {
      type: 'Boost', action: 'Standard', range: '{= 5 * level} ft.', target: '',
      duration: '', save: 'Will', dc: '', text: '',
    });
  check('something is written now', maneuverIsWritten(maneuverOwn(disc(), 'Demoralizing Roar')), true);
  check('the cells round-trip',
    maneuverDetails(new Character(c.toJSON()).data.maneuvers.disciplines[0], 'Demoralizing Roar').range,
    '{= 5 * level} ft.');
  // Every cell is prose, so a formula in one is a formula the sheet knows about.
  check('a formula in a cell is collected',
    c.proseSources().some((f) => f.path === 'maneuver:0:range:Demoralizing Roar'), true);
  // The audit says where a formula was written, and a name with a colon in it
  // ("Lesson I: Balance") must not lose half of itself to the path separator.
  check('the audit names the cell it came from',
    describeSource('maneuver:0:range:Lesson I: Balance'), 'Lesson I: Balance, its range');
  check('and the description by its own name',
    describeSource('maneuverNote:0:Lesson I: Balance'), 'Lesson I: Balance, its description');

  // A field that is not one of the cells is refused rather than invented.
  c.setManeuverField('maneuvers.disciplines.0', 'Demoralizing Roar', 'flavour', 'loud');
  check('an unknown field writes nothing', 'flavour' in disc().notes['Demoralizing Roar'], false);

  /*
   * A description on its own is still stored as the bare string it always was,
   * so a character who never opens the other cells round-trips unchanged.
   */
  c.setManeuverNote('maneuvers.disciplines.0', 'Roar of Command', 'Allies gain {2 + int.mod}');
  check('description alone stays a plain string',
    typeof disc().notes['Roar of Command'], 'string');
  check('and still reads back as an entry',
    maneuverDetails(disc(), 'Roar of Command').text, 'Allies gain {2 + int.mod}');
  c.setManeuverField('maneuvers.disciplines.0', 'Roar of Command', 'duration', '1 round');
  check('a second cell promotes it to a record',
    disc().notes['Roar of Command'],
    { duration: '1 round', text: 'Allies gain {2 + int.mod}' });
  check('the description keeps its own source name',
    c.proseSources().some((f) => f.path === 'maneuverNote:0:Roar of Command'), true);

  // Emptying the last cell takes the whole entry with it.
  for (const f of ['action', 'range', 'save']) {
    c.setManeuverField('maneuvers.disciplines.0', 'Demoralizing Roar', f, '');
  }
  check('an entry with nothing left is dropped',
    'Demoralizing Roar' in disc().notes, false);
}

console.log('maneuvers from a pack -- the catalogue fills the cells, the sheet writes over them');
{
  /*
   * A discipline somebody wrote in the Extensions manager, carrying the cells
   * the bundled Path of War catalogue is not allowed to (its rules text is a
   * publisher's). What a player writes on their own sheet sits over the top,
   * cell by cell, and is the only thing ever saved with the character -- so a
   * corrected pack reaches every sheet, including the ones already in play.
   */
  setManeuverCatalogue({
    disciplines: [{
      name: 'Iron Tortoise',
      entries: [
        {
          level: 1, kind: 'maneuver', name: 'Shield Slam', type: 'Strike',
          action: 'Standard', range: 'Melee attack', save: 'Fortitude',
          text: 'Slams for {= level}d6.',
        },
        { level: 1, kind: 'stance', name: 'Wall of Iron', type: 'Stance' },
      ],
    }],
  });
  const c = new Character(blankDocument({ name: 'Turtle', level: 6 }));
  c.listAdd('maneuvers.disciplines', { name: 'Iron Tortoise', known: ['Shield Slam'] });
  const disc = () => c.data.maneuvers.disciplines[0];
  const entry = (n) => disc().entries.find((e) => e.name === n);

  check('the pack fills the card', maneuverDetails(disc(), 'Shield Slam'), {
    type: 'Strike', action: 'Standard', range: 'Melee attack', target: '',
    duration: '', save: 'Fortitude', dc: '', text: 'Slams for {= level}d6.',
  });
  check('and the row it was built from carries them too',
    entry('Shield Slam').action, 'Standard');
  check('but the player has written nothing',
    maneuverIsWritten(maneuverOwn(disc(), 'Shield Slam')), false);
  check('a pack formula resolves against the character',
    c.renderProse(maneuverDetails(disc(), 'Shield Slam').text)
      .map((s) => (s.kind === 'text' ? s.text : s.value)).join(''),
    'Slams for 6d6.');

  // A ruling at the table: one cell, and only that cell, becomes the player's.
  c.setManeuverField('maneuvers.disciplines.0', 'Shield Slam', 'action', 'Swift');
  check('only the cell written is stored', disc().notes['Shield Slam'], { action: 'Swift' });
  check('the card shows it over the pack',
    maneuverDetails(disc(), 'Shield Slam').action, 'Swift');
  check('the cells beside it still come from the pack',
    maneuverDetails(disc(), 'Shield Slam').range, 'Melee attack');
  check('and the character carries no copy of them',
    JSON.stringify(new Character(c.toJSON()).data.maneuvers.disciplines[0].notes),
    '{"Shield Slam":{"action":"Swift"}}');

  // Clearing it hands the cell back rather than leaving a hole.
  c.setManeuverField('maneuvers.disciplines.0', 'Shield Slam', 'action', '');
  check('clearing it falls back to the pack',
    maneuverDetails(disc(), 'Shield Slam').action, 'Standard');
  check('and the entry is gone entirely', 'Shield Slam' in disc().notes, false);

  // A pack that corrects itself reaches a sheet already in play.
  setManeuverCatalogue({
    disciplines: [{
      name: 'Iron Tortoise',
      entries: [{
        level: 1, kind: 'maneuver', name: 'Shield Slam', type: 'Strike',
        action: 'Swift', range: 'Melee attack', save: 'Fortitude',
        text: 'Slams for {= level}d8.',
      }],
    }],
  });
  c.recompute();
  check('a corrected pack corrects the sheet',
    maneuverDetails(disc(), 'Shield Slam').text, 'Slams for {= level}d8.');

  // Put the real catalogue back for whatever runs after this.
  setManeuverCatalogue(catalogue);

  // A prepared spell's note is prose data too, and survives the round trip.
  c.listAdd('vancian.prepared', {
    prepUsed: '', classLevel: 'Ora 1', name: 'Cure Light Wounds', uses: 2, used: 0,
    note: 'heals {1 + min(5, level)}d8',
  });
  check('a spell note round-trips',
    new Character(c.toJSON()).data.vancian.prepared.at(-1).note, 'heals {1 + min(5, level)}d8');
}

console.log('buff extra bonuses -- targets past the six dials');
{
  const c = new Character(blankDocument({ name: 'Shifter', level: 6 }));
  const buff = (bonuses) => {
    c.data.buffs = [{
      name: 'Test', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0,
      note: '', bonuses,
    }];
    c.recompute();
    return c.conditionState;
  };

  // Plain channels: CMB, CMD, one save, the display-level DC and essence.
  let cs = buff([{ target: 'cmb', value: 2 }, { target: 'cmd', value: 3 },
    { target: 'reflex', value: 4 }, { target: 'dc', value: 1 }, { target: 'essence', value: 2 }]);
  check('cmb, cmd and a single save move',
    [cs.delta.cmb, cs.delta.cmd, cs.delta.reflex, cs.delta.fortitude], [2, 3, 4, 0]);
  check('dc and essence ride as display deltas', [cs.delta.dc, cs.delta.essence, cs.changed], [1, 2, true]);
  check('a lone buff names itself, not conditions', cs.sources, 'buffs');
  c.data.conditions = { Shaken: true };
  c.recompute();
  check('with a condition too, both are named', c.conditionState.sources, 'conditions and buffs');
  c.data.buffs = [];
  c.recompute();
  check('conditions alone name conditions', c.conditionState.sources, 'conditions');
  c.data.conditions = {};

  // An ability score cascades through its modifier (blank sheet: Str 10, melee off Str).
  cs = buff([{ target: 'str', value: 4 }]);
  check('+4 Str is +2 melee and +2 CMB through the modifier',
    [cs.delta.melee, cs.delta.cmb, cs.scores.str], [2, 2, 14]);

  // Size: +1 true step larger moves the four numbers a step moves.
  cs = buff([{ target: 'size', value: 1 }]);
  check('one size larger: −1 attack and AC, +1 CMB and CMD',
    [cs.delta.melee, cs.delta.ac, cs.delta.cmb, cs.delta.cmd], [-1, -1, 1, 1]);
  check('and the dice walk one step', cs.sizeSteps, 1);

  // Within a type only the largest counts; true and effective stack together.
  c.data.buffs = [
    { name: 'A', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0, note: '', bonuses: [{ target: 'size', value: 1 }] },
    { name: 'B', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0, note: '', bonuses: [{ target: 'size', value: 2 }, { target: 'sizeEffective', value: 1 }] },
  ];
  c.recompute();
  cs = c.conditionState;
  check('two true increases take the largest, the effective stacks on top',
    [cs.delta.melee, cs.delta.cmd, cs.sizeSteps], [-2, 2, 3]);

  // An effective increase reaches the dice alone.
  cs = buff([{ target: 'sizeEffective', value: 1 }]);
  check('effective size: dice step, the four numbers stand',
    [cs.delta.melee, cs.delta.ac, cs.delta.cmb, cs.delta.cmd, cs.sizeSteps], [0, 0, 0, 0, 1]);

  // The Colossal cap binds everything: modifiers and dice both run off the
  // capped steps, so an absurd row still reads as Colossal.
  c.data.identity.size = 'Huge';
  cs = buff([{ target: 'size', value: 4 }, { target: 'sizeEffective', value: 3 }]);
  // Huge -2 to Colossal -8: the modifier's own change, which doubles past Large.
  check('a Huge character stops at Colossal in numbers and dice alike',
    [cs.delta.melee, cs.delta.ac, cs.delta.cmb, cs.delta.cmd, cs.sizeSteps], [-6, -6, 6, 6, 2]);
  c.data.identity.size = 'Medium';
  cs = buff([{ target: 'size', value: 500 }]);
  check('a +500 row is four steps from Medium, everywhere -- Colossal at -8',
    [cs.delta.melee, cs.delta.ac, cs.delta.cmb, cs.delta.cmd, cs.sizeSteps], [-8, -8, 8, 8, 4]);
  cs = buff([{ target: 'size', value: -2 }]);
  check('and down: Medium to Tiny is +2, doubled from the +1 of Small, as Size Change says',
    [cs.delta.melee, cs.delta.ac, cs.delta.cmd], [2, 2, -2]);

  // {size} reads the true size after buffs -- and only the true size: the
  // stacking and effective kinds change what a character counts as, not what
  // it is, which is the wraps' own distinction.
  cs = buff([{ target: 'size', value: 2 }, { target: 'sizeEffective', value: 1 }, { target: 'sizeStacking', value: 1 }]);
  check('a formula\'s size follows the true rows alone', c.scope().size, 'Huge');
  check('and the ladder caps it',
    (() => { c.data.buffs[0].bonuses[0].value = 20; c.recompute(); return c.scope().size; })(), 'Colossal');
  c.data.buffs[0].on = false;
  c.recompute();
  check('unticked, the size comes home', c.scope().size, 'Medium');
  c.data.identity.size = 'Medium';
  cs = buff([{ target: 'size', value: 3 }, { target: 'sizeEffective', value: 3 }]);
  check('from Medium, true and effective together stop at Colossal', cs.sizeSteps, 4);

  // Wraps of suppressed size: the item's own example. Kinetic form (Large)
  // plus enlarge person written as stacking: the wearer becomes Large in
  // fact, but is Huge for attack, AC, CMB, CMD and weapon dice -- which is
  // exactly the sheet's true-size bundle, so both steps land there.
  c.data.buffs = [
    { name: 'Kinetic Form', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0, note: '', bonuses: [{ target: 'size', value: 1 }] },
    { name: 'Enlarge Person (wraps)', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0, note: '', bonuses: [{ target: 'sizeStacking', value: 1 }] },
  ];
  c.recompute();
  cs = c.conditionState;
  check('with the wraps, the stacking row sums with the largest true one',
    [cs.delta.melee, cs.delta.ac, cs.delta.cmb, cs.delta.cmd, cs.sizeSteps], [-2, -2, 2, 2, 2]);
  check('and the cap still holds a stack of them',
    (() => { c.data.buffs[1].bonuses[0].value = 9; c.recompute(); return c.conditionState.sizeSteps; })(), 4);
  c.recompute();

  // Speed is flat feet, applied before a condition's halving.
  c.data.identity.speeds = [{ type: 'Land', base: 30, bonus: 0 }];
  cs = buff([{ target: 'speed', value: 10 }]);
  check('+10 ft on a 30 ft move', cs.speeds[0].adjusted, 40);
  c.data.conditions = { Entangled: true };
  c.recompute();
  cs = c.conditionState;
  check('the bonus goes on before entangled halves', cs.speeds[0].adjusted, 20);
  c.data.conditions = {};

  // A bonus value takes a formula, and a broken one lands on the row.
  cs = buff([{ target: 'cmd', value: '1 + floor(level / 3)' }]);
  check('a formula bonus resolves', cs.delta.cmd, 3);
  cs = buff([{ target: 'cmd', value: 'no_such' }]);
  check('a broken bonus degrades to 0 with the error kept',
    [cs.delta.cmd, !!c.data.buffs[0].bonuses[0].valueError, !!c.data.buffs[0].error], [0, true, true]);
}

console.log('size changes walk the official damage-dice chart');
{
  const step = (n, d, s, size = 'Medium') => {
    const r = stepDamageDice(n, d, s, size);
    return r ? `${r[0]}${r[1] > 1 ? `d${r[1]}` : ''}` : null;
  };
  // The enlarge/reduce table's own values.
  check('1d6 up from Medium (1d6 or less: one step)', step(1, 6, 1), '1d8');
  check('1d8 up from Medium (two steps)', step(1, 8, 1), '2d6');
  check('2d6 up from Medium (greatsword enlarged)', step(2, 6, 1), '3d6');
  check('1d4 up from Small (small size: one step)', step(1, 4, 1, 'Small'), '1d6');
  check('1d8 down from Medium (1d8 or less: one step)', step(1, 8, -1), '1d6');
  check('2d6 down from Medium (medium size: one step)', step(2, 6, -1), '1d10');
  // The FAQ's own remap examples.
  check('10d6 reads as 8d8, then two steps up', step(10, 6, 1), '12d8');
  check('5d8 reads as 6d6, then two steps up', step(5, 8, 1), '8d6');
  check('2d4 reads as 1d8', step(2, 4, 1), '2d6');
  check('3d4 reads as 2d6', step(3, 4, 1), '3d6');
  check('1d12 reads as 2d6', step(1, 12, 1), '3d6');
  check('2d10 up is 4d8 regardless of size', step(2, 10, 1, 'Small'), '4d8');
  check('2d10 down is 2d8 regardless of size', step(2, 10, -1, 'Small'), '2d8');
  // Multi-step changes read each step's own size and dice.
  check('1d6 up twice from Medium: 1d8 then 2d6', step(1, 6, 2), '2d6');
  check('the chart floors at 1', step(1, 2, -2), '1');
  check('an unknown die is left alone', stepDamageDice(2, 3, 1), null);
  // A map steps per component, and a flat 1 lands in flat.
  check('a mixed map steps each part on its own (1d8 → 2d6, 1d6 → 1d8)',
    stepDiceMap({ 8: 1, 6: 1 }, 1, 'Medium'), { dice: { 6: 2, 8: 1 }, flat: 0 });
  check('stepping down to the flat 1', stepDiceMap({ 2: 1 }, -1, 'Medium'), { dice: {}, flat: 1 });

  // And on a weapon: a size buff steps the dice in the d20 copy.
  const c = new Character(blankDocument({ name: 'Big', level: 6 }));
  c.listAdd('equipment.weapons', {
    name: 'Greatsword', attackType: 'Melee', dice: '2d6', damageAbility: 'Str', abilityMult: 1.5,
    miscDamage: 0, miscAttack: 0, enhancement: 0, critRange: 19, critMult: 'x2',
    damageType: '', groups: [], special: '', size: '', range: '', handedness: '',
    familiarity: '', ammunition: '', weight: 0, price: 0, attackOffset: 0,
  });
  c.data.buffs = [{
    name: 'Enlarge', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0,
    note: '', bonuses: [{ target: 'size', value: 1 }],
  }];
  c.recompute();
  const spec = rollSpec(c.data, 'weapon', 0, c.conditionState);
  const dmg = spec.rolls.find((r) => r.label === 'Damage');
  check('an enlarged greatsword rolls 3d6', dmg.formula.startsWith('3d6'), true);
}

console.log('feature-column level rules');
{
  const at = (rule) => levelRuleLevels(rule);

  // The three schedules the syntax exists for.
  check('kineticist infusions -- odd', at('odd'), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
  check('kineticist utility -- even', at('even'), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  check('kheshig veils -- 2 and every 4 after', at('2, +4'), [2, 6, 10, 14, 18]);
  check('fighter bonus feats -- 1st and every even',
    at('1, 2, +2'), [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);

  // Terms union left to right, so a generated pattern stays extensible.
  check('an extra level bolts onto a pattern', at('2, +4, 3'), [2, 3, 6, 10, 14, 18]);
  check('several extras', at('2, +4, 3, 20'), [2, 3, 6, 10, 14, 18, 20]);
  check('a term can subtract', at('odd, -13'), [1, 3, 5, 7, 9, 11, 15, 17, 19]);
  // Terms apply strictly in order, so a subtraction only removes what is
  // already there and a later term may put it back. Subtract last.
  check('subtracting last removes the level', at('2, +4, -2'), [6, 10, 14, 18]);
  check('subtracting early is undone by a later term', at('2, -2, +4'), [2, 6, 10, 14, 18]);
  check('subtraction does not move the step anchor', at('1, -1, +4'), [1, 5, 9, 13, 17]);
  check('ranges', at('5-8'), [5, 6, 7, 8]);
  check('a range is inclusive and reversible', at('8-5'), at('5-8'));
  check('"thereafter" counts from the end of the term before', at('5-10, +3'), [5, 6, 7, 8, 9, 10, 13, 16, 19]);
  check('a bare step starts at 1', at('+5'), [1, 6, 11, 16]);
  check('single levels', at('7, 11'), [7, 11]);
  check('no rule means every level', at(''), Array.from({ length: 20 }, (_, i) => i + 1));
  check('"all" is the same', at('all'), at(''));
  check('whitespace and case do not matter', at('  ODD , -13 '), at('odd,-13'));

  // Unrecognised text falls through to the formula evaluator.
  check('formula rules parse as formulas', parseLevelRule('classLevel % 3 == 1').kind, 'formula');
  check('and select the right levels', at('classLevel % 3 == 1'), [1, 4, 7, 10, 13, 16, 19]);
  check('formulas may use charLevel', parseLevelRule('charLevel >= 5').kind, 'formula');

  // A rule nobody can read must not hide anything.
  const broken = parseLevelRule('2, +(');
  check('unreadable rules are flagged', broken.kind, 'error');
  check('and still grant every level', levelRuleLevels(broken).length, 20);
  check('with the reason kept', typeof broken.error, 'string');

  // Basis: class levels by default, character levels on request.
  check('rules count class levels by default', parseLevelRule('2, +4').basis, 'class');
  check('char: switches the basis', parseLevelRule('char: 2, +4').basis, 'char');
  check('and keeps the pattern', at('char: 2, +4'), [2, 6, 10, 14, 18]);
  check('class level 2 grants, character level 2 need not',
    [levelRuleGrants('2, +4', 2, 9), levelRuleGrants('char: 2, +4', 2, 9)], [true, false]);
  check('char: reads the character level', levelRuleGrants('char: 2, +4', 5, 6), true);

  check('level lists condense for display', summariseLevels([1, 2, 3, 7, 9, 10]), '1-3, 7, 9-10');
}

console.log('maneuvers -- every one links to its page on the wiki');
{
  check('spaces become underscores',
    wikiUrl('Demoralizing Roar'), 'https://metzo.miraheze.org/wiki/Demoralizing_Roar');
  // Google Sheets autocorrected most apostrophes in the catalogue to U+2019.
  // Both spellings have to reach the same page.
  check('a curly apostrophe is straightened first',
    wikiUrl('Seraph’s Wrath'), 'https://metzo.miraheze.org/wiki/Seraph%27s_Wrath');
  check('and a plain one lands in the same place',
    wikiUrl("Seraph's Wrath"), wikiUrl('Seraph’s Wrath'));
  check('hyphens survive', wikiUrl('Iron-Breaking Palm'),
    'https://metzo.miraheze.org/wiki/Iron-Breaking_Palm');
  check('a colon is encoded', wikiUrl('Lesson I: Balance'),
    'https://metzo.miraheze.org/wiki/Lesson_I%3A_Balance');
  check('nothing to link to gives no link', [wikiUrl(''), wikiUrl('  '), wikiUrl(null)],
    [null, null, null]);

  // Nothing in the catalogue should reach the wiki as a mangled escape.
  const names = [...new Set(catalogue.disciplines.flatMap((d) => d.entries.map((e) => e.name)))];
  const mangled = names.filter((n) => /%E2%80|%C2|%EF%BF/.test(wikiUrl(n) || ''));
  check('no maneuver produces a mojibake link', mangled, []);
  check('every maneuver has one', names.filter((n) => !wikiUrl(n)), []);
}

console.log('blended guile training -- a pool that reaches skill talents, and a skill class that reaches out');
{
  const blankLevels = () => Array.from({ length: 20 }, (_, i) => ({ level: i + 1, talent: null, sphere: null, notes: null }));
  const fresh = () => {
    const c = new Character(blankDocument({ name: 'Blend' }));
    c.data.identity.level = 10;
    c.listAdd('training.combat.classes', {
      name: 'Champion', type: 'Expert', talentsPerLevel: 'Expert', mod1: null, mod2: null,
      classLevelsOverride: 10, levels: blankLevels(),
    });
    for (const [i, sphere] of [[0, 'Boxing'], [1, 'Study'], [2, 'Nature']]) c.set(`training.combat.classes.0.levels.${i}.sphere`, sphere);
    return c;
  };
  const tallies = (c) => [c.data.training.combat.tally, c.data.training.magic?.tally || {}, c.data.training.guile.tally];
  const champ = (c) => c.data.training.combat.classes[0];
  const rows = (c, key) => champ(c).levels.filter((lv) => lv[key]).map((lv) => lv.level);

  /* ----- a martial class that reaches skill talents ----- */
  const c = fresh();
  check('unblended, every row counts on its own side, whatever its sphere', tallies(c),
    [{ Boxing: 1, Study: 1, Nature: 1 }, {}, {}]);
  check('and the guile tab is not in use', c.systemTabsInUse().guile, false);

  c.setBlendedSkill('combat', 0, true);
  check('ticking skill changes no count of the any ladder: the class keeps its own rate',
    [champ(c).totalTalents, champ(c).totalUtility, rows(c, 'granted').length], [10, 0, 10]);
  check('the skill sphere moves to the guile side; the magic one, unreached, counts nowhere',
    tallies(c), [{ Boxing: 1 }, {}, { Study: 1 }]);
  check('as a spent talent, which buys ranks', c.data.training.guile.tallySpent, { Study: 1 });
  check('the guile side gains a row for the sphere', c.data.training.guile.spheres.map((r) => r.sphere), ['Study']);
  check('and the guile tab is in use', c.systemTabsInUse().guile, true);
  check('one blended class, reaching martial and skill',
    c.blendedClasses().map((p) => [p.name, p.kind, p.systems, p.twin]), [['Champion', 'sphere', ['combat', 'guile'], null]]);
  check('what went where, and the one that went nowhere',
    trainingPanels.poolCounts(champ(c), ['combat', 'guile']), { combat: 1, magic: 0, guile: 1, none: 1 });
  const martialHtml = combatPanels.renderMartialPanel(c);
  check('the unreached pick is marked on its row and in the ticks',
    [martialHtml.includes('side-none'), martialHtml.includes('1 not counted')], [true, true]);
  check('drawn on the martial and guile tabs, not the magic one',
    [martialHtml, combatPanels.renderMagicPanel(c), guilePanels.renderGuilePanel(c)]
      .map((html) => html.includes('Blended training')), [true, false, true]);
  check('as two ladders, stacked, with the rate kept and a rule box for [utility]',
    ['ladderstack', 'training.combat.classes|0|talentsPerLevel', 'training.combat.classes|0|utilityRule',
      'training.combat.classes|0|anyRule'].map((x) => martialHtml.includes(x)), [true, true, true, false]);

  // [utility] talents at the levels a rule names: the book's "1 a level, and a
  // bonus utility talent at 2nd and every 2 levels thereafter".
  c.set('training.combat.classes.0.utilityRule', '2, +2');
  check('a [utility] rule opens a slot at each level it names',
    [rows(c, 'utilityGranted'), champ(c).totalUtility], [[2, 4, 6, 8, 10], 5]);
  c.set('training.combat.classes.0.levels.1.utilitySphere', 'Investigation');
  c.set('training.combat.classes.0.levels.3.utilitySphere', 'Boxing');
  c.set('training.combat.classes.0.levels.4.utilitySphere', 'Investigation');
  check('a [utility] talent counts where its sphere lands; a slot not granted counts nothing',
    tallies(c), [{ Boxing: 2 }, {}, { Study: 1, Investigation: 1 }]);
  c.set('training.combat.classes.0.utilityRule', 'odd');
  check('parity works too -- and moving the rule moves which slots count', [rows(c, 'utilityGranted'), tallies(c)[2]],
    [[1, 3, 5, 7, 9], { Study: 1, Investigation: 1 }]);
  c.set('training.combat.classes.0.utilityRule', 'every other');
  check('a rule that does not parse grants nothing rather than everything',
    [champ(c).totalUtility, combatPanels.renderMartialPanel(c).includes('not a rule')], [0, true]);
  c.set('training.combat.classes.0.utilityRule', 'char: 6-10');
  check('char: counts character levels', rows(c, 'utilityGranted'), [6, 7, 8, 9, 10]);

  // A book tier: both ladders off the table, and the rate put away.
  c.set('training.combat.classes.0.utilityRule', 'even');
  c.set('training.combat.classes.0.expertise', 'Trained');
  check('a tier sizes both ladders off the table', [champ(c).totalTalents, champ(c).totalUtility], [2, 5]);
  // Trained grants its any talents at 4th and 8th and its [utility] ones on odd
  // levels, so neither Boxing pick -- the 1st-level any, the 4th-level utility --
  // is a slot it grants any more.
  check('and the rows it no longer grants stop counting', [rows(c, 'granted'), tallies(c)[0].Boxing], [[4, 8], undefined]);
  const tierHtml = combatPanels.renderMartialPanel(c);
  check('with the rate picker and the rule boxes put away',
    ['training.combat.classes|0|talentsPerLevel', 'training.combat.classes|0|utilityRule'].map((x) => tierHtml.includes(x)),
    [false, false]);

  // Custom: both ladders written out.
  c.set('training.combat.classes.0.expertise', 'Custom');
  c.set('training.combat.classes.0.anyRule', 'all, -5');
  check('custom rules for both ladders', [champ(c).totalTalents, champ(c).totalUtility, rows(c, 'granted')],
    [9, 5, [1, 2, 3, 4, 6, 7, 8, 9, 10]]);
  c.set('training.combat.classes.0.anyRule', '');
  check('an any ladder with no rule grants nothing', champ(c).totalTalents, 0);
  c.set('training.combat.classes.0.expertise', '');
  check('and back to the rate', [champ(c).totalTalents, champ(c).totalUtility], [10, 5]);

  // Unticking skill hides the [utility] ladder and keeps what was in it.
  c.setBlendedSkill('combat', 0, false);
  check('unticked: one ladder again, every row read the old way',
    [champ(c).totalUtility, rows(c, 'utilityGranted'), tallies(c)], [undefined, [], [{ Boxing: 1, Study: 1, Nature: 1 }, {}, {}]]);
  check('the [utility] picks and the pool setting are kept, not counted',
    [champ(c).levels[1].utilitySphere, champ(c).utilityRule], ['Investigation', 'even']);
  c.setBlendedSkill('combat', 0, true);
  check('and come back when it is ticked again', tallies(c)[2], { Study: 1, Investigation: 1 });

  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('it all survives saving',
    [back.data.training.combat.classes[0].blendedSkill, back.data.training.combat.classes[0].utilityRule,
      back.data.training.guile.tally],
    [true, 'even', { Study: 1, Investigation: 1 }]);

  /* ----- all three, and a pair's two halves ----- */
  c.setBlended('combat', 0, true);
  check('all three: the magic sphere now lands magically (Boxing twice: the 1st-level pick and the 4th-level [utility] one)',
    tallies(c), [{ Boxing: 2 }, { Nature: 1 }, { Study: 1, Investigation: 1 }]);
  const magicHalf = c.data.training.magic.classes.findIndex((x) => x.name === 'Champion');
  c.setBlendedSkill('magic', magicHalf, false);
  check('unticking skill on the mirror reaches the owner that carries it',
    [champ(c).blendedSkill, tallies(c)[2]], [undefined, {}]);
  c.setBlendedSkill('magic', magicHalf, true);
  check('and ticking it there lands on the owner too',
    [champ(c).blendedSkill, c.data.training.magic.classes[magicHalf].blendedSkill], [true, undefined]);
  c.data.training.magic.classes[magicHalf].utilityRule = 'odd';
  c.data.training.combat.classes[0].utilityRule = '';
  c.recompute();
  check('a pool setting found on the mirror moves to the owner',
    [champ(c).utilityRule, c.data.training.magic.classes[magicHalf].utilityRule], ['odd', undefined]);
  c.setBlended('combat', 0, false);
  check('splitting from magic keeps the skill reach', c.blendedClasses().map((p) => p.systems), [['combat', 'guile']]);

  // A pool owned on the magic side (its martial block has no rows of its own)
  // that spends [utility] talents martially is counted right on the very first
  // pass: every class is worked out before either side is tallied.
  const doc = blankDocument({ name: 'Magic owned' });
  doc.identity.level = 4;
  const hybridLevels = blankLevels();
  hybridLevels[1].utilitySphere = 'Boxing';
  doc.training = {
    ...(doc.training || {}),
    magic: { classes: [{ name: 'Hybrid', type: 'High', talentsPerLevel: 'High Caster', classLevelsOverride: 4,
      blendedSkill: true, utilityRule: 'even', levels: hybridLevels }] },
    combat: { classes: [{ name: 'Hybrid', type: 'Expert', classLevelsOverride: 4, levels: [] }] },
  };
  const h = new Character(doc);
  check('magic-owned, martial, magical and skill', h.blendedClasses().map((p) => [p.owner.side, p.systems]),
    [['magic', ['magic', 'combat', 'guile']]]);
  check('its martial [utility] talent counts on the martial side from the start', h.data.training.combat.tally, { Boxing: 1 });

  /* ----- a skill class whose ladders reach out ----- */
  const s = fresh();
  s.addGuileClass('Shifter');
  s.set('training.guile.classes.0.expertise', 'Virtuoso');
  s.set('training.guile.classes.0.classLevelsOverride', 6);
  const g = () => s.data.training.guile.classes[0];
  const anyAt = g().levels.findIndex((lv) => lv.granted);
  const anyAt2 = g().levels.findIndex((lv, i) => i > anyAt && lv.granted);
  const utilAt = g().levels.findIndex((lv) => lv.utilityGranted);
  s.set(`training.guile.classes.0.levels.${anyAt}.sphere`, 'Boxing');
  s.set(`training.guile.classes.0.levels.${anyAt2}.sphere`, 'Infiltration');
  s.set(`training.guile.classes.0.levels.${utilAt}.utilitySphere`, 'Nature');
  check('unblended, a skill class counts only its skill spheres; the rest count nowhere',
    [tallies(s)[2], trainingPanels.poolCounts(g(), ['guile']).none], [{ Infiltration: 1 }, 2]);
  check('which its block says', guilePanels.renderGuilePanel(s).includes('2 not counted'), true);

  s.setGuileBlend(0, 'combat', true);
  check('reaching martial: the martial sphere counts martially',
    [tallies(s)[0].Boxing, tallies(s)[2].Boxing], [2, undefined]);
  check('the magic sphere still counts nowhere', [tallies(s)[1].Nature, tallies(s)[2].Nature], [undefined, undefined]);
  s.setGuileBlend(0, 'magic', true);
  check('reaching magical as well: its [utility] slot lands magically', tallies(s)[1].Nature, 1);
  check('the skill sphere never leaves', tallies(s)[2].Infiltration, 1);
  check('a blended skill class is its own kind of blended class',
    s.blendedClasses().filter((p) => p.kind === 'guile').map((p) => [p.name, p.systems]),
    [['Shifter', ['guile', 'combat', 'magic']]]);
  const guileHtml = guilePanels.renderGuilePanel(s);
  check('it moves out of Skill expertise into Blended training',
    [guileHtml.includes('data-reach="guile|0|combat"'), guileHtml.includes('Also operative classes')], [true, true]);
  check('and heads the martial tab with its ladders, stacked', combatPanels.renderMartialPanel(s).includes('ladderstack'), true);
  check('which puts the martial and magic tabs in use for a character with no classes there',
    (() => { const x = fresh(); x.data.training.combat.classes = []; x.addGuileClass('Only');
      x.setGuileBlend(0, 'magic', true); return [x.systemTabsInUse().martial, x.systemTabsInUse().magic]; })(),
    [false, true]);

  // A guile class may be Custom as well, blended or not.
  s.set('training.guile.classes.0.expertise', 'Custom');
  s.set('training.guile.classes.0.anyRule', 'all');
  s.set('training.guile.classes.0.utilityRule', 'even');
  check('a custom skill class', [g().totalTalents, g().totalUtility], [6, 3]);
  s.set('training.guile.classes.0.expertise', 'Nonsense');
  const reread = new Character(JSON.parse(JSON.stringify(s.toJSON())));
  check('an expertise no picker offers is dropped on load, and grants nothing',
    [reread.data.training.guile.classes[0].expertise, reread.data.training.guile.classes[0].totalTalents], [null, 0]);
  check('while the rules written for Custom are kept for when it comes back',
    reread.data.training.guile.classes[0].utilityRule, 'even');
  s.set('training.guile.classes.0.expertise', 'Custom');
  s.setGuileBlend(0, 'combat', false);
  s.setGuileBlend(0, 'magic', false);
  check('unticking both leaves only the skill picks counting', tallies(s)[2], { Infiltration: 1 });

  /* ----- how the two ladders share the width ----- */
  const L = fresh();
  L.setBlendedSkill('combat', 0, true);
  const key = 'ladder:training.combat.classes:Champion';
  const r2 = (n) => Math.round(n * 100) / 100;
  const lay = () => trainingPanels.ladderLayout(L, key, champ(L), ['Boxing', 'Study', 'Nature']);
  check('a pool with no [utility] rule: nothing to choose between, that ladder drawn narrow',
    [lay().toggles, lay().focus, lay().utility.shrunk, lay().any.shrunk], [false, 'any', true, false]);
  check('and no switch on its headings', combatPanels.renderMartialPanel(L).includes('data-ladderfocus'), false);
  L.set('training.combat.classes.0.utilityRule', 'even');
  const normal = lay();
  check('both ladders granting: a switch, and both halves given the same shares',
    [normal.toggles, normal.focus, normal.any.talent === normal.utility.talent, normal.any.notes === normal.utility.notes],
    [true, null, true, true]);
  check('side by side, both sphere columns fit the longest pick of either -- Nature, six letters',
    [normal.any.sphere, normal.utility.sphere], [6, 6]);
  check('so the two halves are the same width', [normal.any.talent + normal.any.notes, normal.utility.talent + normal.utility.notes]
    .map(r2).reduce((a, b) => a === b), true);
  check('the notes get twice the talent name, so what the sphere column saves splits 1:2 as well',
    [normal.any.notes / normal.any.talent, normal.utility.notes / normal.utility.talent].map(r2), [2, 2]);
  check('the shares add up past what a table holds, so fixed columns keep their width',
    Math.round(normal.any.talent + normal.any.notes + normal.utility.talent + normal.utility.notes), 400);
  // In the blended panel the ladders stack, a level to a box, so there is no
  // width to share and no switch; the Guile tab's side-by-side ladders keep it.
  const blendedHtml = combatPanels.renderMartialPanel(L);
  check('the blended panel stacks them instead, with no switch to share the width',
    [blendedHtml.includes('ladderstack'), blendedHtml.includes('data-ladderfocus')], [true, false]);
  const lvls = champ(L).levels;
  check('each level draws only the ladders it grants',
    [(blendedHtml.match(/class="[^"]*utilrow/g) || []).length, (blendedHtml.match(/<tbody class="lvlbox">/g) || []).length],
    [lvls.filter((lv) => lv.utilityGranted).length, lvls.length]);
  L.data.uiPrefs.ladderFocus = { [key]: 'utility' };
  const focused = lay();
  check('focusing [utility] narrows the any ladder to a quarter of its shares and a short dropdown',
    [focused.focus, focused.any.shrunk, r2(focused.utility.talent / focused.any.talent), focused.any.sphere,
      r2(focused.utility.notes / focused.utility.talent)],
    ['utility', true, 4, 4.5, 2]);
  L.set('training.combat.classes.0.levels.1.utilitySphere', 'Homebrewed Sphere');
  check('a focused ladder fits its own picks: none on the narrowed side counts, and " *" gets room',
    lay().utility.sphere, 3 + 0.5 * ('Homebrewed Sphere'.length + 2));
  L.set('training.combat.classes.0.utilityRule', '');
  check('a focus stored for a ladder that no longer grants is ignored, not obeyed',
    [lay().toggles, lay().focus], [false, 'any']);
}

console.log('psionics -- five curves, chosen by what they reach at level 20');
{
  const t = psionicTables();
  check('five curves', t.curves.length, 5);
  check('the thirteen classes come along as a crib', t.classes.length, 13);
  check('and the power levels', t.powerLevels, ['Talent', '1st', '2nd', '3rd', '4th',
    '5th', '6th', '7th', '8th', '9th']);

  // A curve is named by its level-20 total, which is what the workbook's PP@20
  // dropdown offered -- so nothing keys off a class name and a homebrew
  // manifesting class needs no special handling at all.
  check('the full manifester curve', psionicCurve(343).points[19], 343);
  check('its first few levels', psionicCurve(343).points.slice(0, 5), [2, 6, 11, 17, 25]);
  check('the soulknife curve starts empty', psionicCurve(52).points.slice(0, 4), [0, 0, 0, 1]);
  check('a curve nobody has is not invented', psionicCurve(999), null);

  check('points at a level', psionicPoints(343, 10), 88);
  check('level zero manifests nothing', psionicPoints(343, 0), null);
  check('and neither does level 21', psionicPoints(343, 21), null);

  // The crib maps a known class to the curve it uses, forgiving a typo.
  check('a psion is a full manifester', psionicClassTotal('Psion'), 343);
  check('a soulknife is not', psionicClassTotal('Soulknife'), 52);
  check('case does not matter', psionicClassTotal('psion'), 343);
  check('nor does a slip', psionicClassTotal('Soulkinfe'), 52);
  check('an unknown class has no curve', psionicClassTotal('Bear Mind'), 0);
}

console.log('conditions -- the catalogue answers to the workbook\'s own labels');
{
  check('Fatigue is fatigued', conditionInfo('Fatigue')?.key, 'fatigued');
  check('Grapple is grappled', conditionInfo('Grapple')?.key, 'grappled');
  check('Energy Drain counts', conditionInfo('Energy Drain')?.kind, 'count');
  check('an unknown name is null', conditionInfo('Bewildered'), null);
  check('a flag counts once however big', conditionCount(conditionInfo('Shaken'), 3), 1);
  check('negative levels count each', conditionCount(conditionInfo('Energy Drain'), 3), 3);
  check('and never below zero', conditionCount(conditionInfo('Energy Drain'), -2), 0);
  check('every sheet condition is in the catalogue', SHEET_CONDITIONS.every((k) => CONDITIONS.some((c) => c.key === k)), true);
}

console.log('companions -- a feat that kept its level in the note gets it back');
{
  // Every document saved before the Source column holds the importer's own
  // shape: the level, alone, in the note. It has to end up in the right box on
  // reopening, and a note anybody actually wrote has to survive untouched.
  const b = normalizeCompanion('animalCompanion', {
    feats: [
      { name: 'Weapon Focus (bite)', notes: 'Level 1' },
      { name: 'Toughness', notes: 'Level 5' },
      { name: 'Multiattack', notes: 'Bought with the 7th-level slot, see the log' },
      { name: 'Improved Natural Armor', source: 'Level 9', notes: 'Level 3' },
      { name: 'Endurance' },
    ],
    tricks: [{ name: 'Attack' }],
  });
  check('the level moves to Source', b.feats.map((f) => f.source),
    ['Level 1', 'Level 5', '', 'Level 9', '']);
  check('and is out of the note', b.feats.map((f) => f.notes),
    ['', '', 'Bought with the 7th-level slot, see the log', 'Level 3', '']);
  check('a row that already has a source keeps both', b.feats[3], {
    source: 'Level 9', name: 'Improved Natural Armor', notes: 'Level 3',
  });
  check('a trick gets the field too', b.tricks[0], { source: '', name: 'Attack', notes: '' });
  check('running it twice changes nothing more',
    normalizeCompanion('animalCompanion', b).feats, b.feats);
  // A familiar has feats and no tricks, and must not grow one.
  const fam = normalizeCompanion('familiar', { feats: [{ name: 'Alertness', notes: 'Level 1' }] });
  check('a familiar feat is migrated the same way', fam.feats[0].source, 'Level 1');
  check('and it has no tricks list to speak of', fam.tricks, undefined);
}

/* A tab the converter hands over keeps only the rows that hold something, and
 * records what number each one had. For several tabs that number is the whole
 * meaning: a blank worksheet row is what separates one Template feature from
 * the next, and what ends a column of notes on ExtrasNotes. These check that
 * the number survives the trip into `sheetTabs`, because for a while it did
 * not -- three importers each kept a private copy of the converter's grid to
 * work around it, and a fourth would have had to do the same. */
console.log('sheet tabs keep their row numbers');
{
  const doc = blankDocument({ name: 'Row Numbers' });
  doc.extraTabs = {
    'Combat Training': {
      rows: [
        { r: 1, cells: ['Stance', 'Iron Tortoise'] },
        // Worksheet rows 2 to 4 are blank, so the converter dropped them.
        { r: 5, cells: ['Boost', 'Broken Blade'] },
      ],
    },
  };
  const c = new Character(doc);
  const kept = (c.data.sheetTabs || []).find((t) => t.name === 'Combat Training');
  check('the tab survives as a grid', kept?.rows?.length, 2);
  check('each row keeps its sheet position', kept?.rows?.map((x) => x.r), [1, 5]);
  check('so the blank rows come back', positionedRows(kept).length, 5);
  check('with the last row where the sheet had it', positionedRows(kept)[4]?.cells[1], 'Broken Blade');

  // Saving and reopening has to keep them, or the first reload reads a packed
  // grid the converter never produced.
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  const back = (again.data.sheetTabs || []).find((t) => t.name === 'Combat Training');
  check('and a round trip keeps them', back?.rows?.map((x) => x.r), [1, 5]);
}

console.log('a row typed into the grid editor has no number of its own');
{
  // The grid editor adds rows carrying no `r`, and they sit beside rows that
  // have one. Neither may land on top of the other.
  const mixed = { rows: [{ r: 1, cells: ['a'] }, { cells: ['added'] }, { r: 2, cells: ['b'] }] };
  const placed = positionedRows(mixed).map((x) => x.cells[0] ?? null);
  check('every row is placed', placed.filter((x) => x !== null).length, 3);
  check('in the order they were given', placed, ['a', 'added', 'b']);
}

console.log('a blank worksheet row ends a column of notes');
{
  const doc = blankDocument({ name: 'Extras Gaps' });
  doc.extraTabs = {
    ExtrasNotes: {
      rows: [
        { r: 1, cells: ['Range 1'] },
        { r: 2, cells: ['first line'] },
        { r: 3, cells: ['second line'] },
        // Worksheet row 4 is blank, which is where the column ends.
        { r: 5, cells: ['a note about something else'] },
      ],
    },
  };
  const note = (new Character(doc).data.notes || []).find((n) => n.title === 'Range 1');
  check('the column stops at the gap', note?.body, 'first line\nsecond line');
}

console.log('spheres of guile -- two talent ladders, and DCs read off a skill');
{
  // The printed Skill Talents by Expertise Tier table, all sixty rows of it.
  // Two columns per tier, gained in addition to each other, and the two do
  // not keep step -- which is the whole reason this system needed a table of
  // its own rather than another rate in TALENT_RATES.
  const TIER_TABLE = {
    Virtuoso: [[1, 0], [2, 1], [3, 1], [3, 2], [4, 2], [5, 3], [6, 3], [6, 4], [7, 4], [8, 5],
      [9, 5], [9, 6], [10, 6], [11, 7], [12, 7], [12, 8], [13, 8], [14, 9], [15, 9], [15, 10]],
    Journeyman: [[0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 4], [4, 4], [4, 5], [5, 5],
      [5, 6], [6, 6], [6, 7], [7, 7], [7, 8], [8, 8], [8, 9], [9, 9], [9, 10], [10, 10]],
    Trained: [[0, 1], [0, 1], [0, 2], [1, 2], [1, 3], [1, 3], [1, 4], [2, 4], [2, 5], [2, 5],
      [2, 6], [3, 6], [3, 7], [3, 7], [3, 8], [4, 8], [4, 9], [4, 9], [4, 10], [5, 10]],
  };
  const wrong = [];
  for (const [tier, rows] of Object.entries(TIER_TABLE)) {
    rows.forEach(([any, utility], i) => {
      const got = expertiseTalents(tier, i + 1);
      if (got.any !== any || got.utility !== utility) wrong.push(`${tier} ${i + 1}`);
    });
  }
  check('every row of the expertise table', wrong, []);
  check('and no tier at all is no talents', expertiseTalents(null, 20), { any: 0, utility: 0 });

  // A live operative. Nothing imports a guile side -- no workbook ever had
  // the tab -- so it is conjured empty on load and grows from what is typed.
  const doc = blankDocument({ name: 'Operative', level: 9 });
  const m = new Character(doc);
  check('a blank sheet gets an empty guile side', !!m.data.training.guile, true);
  check('and it is not "in use" until something is typed', m.systemTabsInUse().guile, false);

  const g = m.data.training.guile;
  g.classes.push({ ...blankGuileClass('Envoy'), expertise: 'Virtuoso', classLevelsOverride: 9 });
  g.operativeMod = 'Cha';
  m.recompute();
  const cls = g.classes[0];
  check('a Virtuoso 9 has seven free talents and four utility ones',
    [cls.totalTalents, cls.totalUtility], [7, 4]);
  check('granted on their own rungs',
    [cls.levels.filter((l) => l.granted).map((l) => l.level),
      cls.levels.filter((l) => l.utilityGranted).map((l) => l.level)],
    [[1, 2, 3, 5, 6, 7, 9], [2, 4, 6, 8]]);
  check('the tab now counts as in use', m.systemTabsInUse().guile, true);

  // Spend them. A base pick is a talent spent like any other -- taking the
  // sphere is what the first one buys.
  const put = (level, sphere, talent, util = false) => {
    const lv = cls.levels[level - 1];
    if (util) Object.assign(lv, { utilitySphere: sphere, utilityTalent: talent });
    else Object.assign(lv, { sphere, talent });
  };
  put(1, 'Bluster', 'Bluster Sphere (Base)');
  put(2, 'Bluster', 'Piercing Wit');
  put(3, 'Bluster', 'Never Gets Old');
  put(2, 'Bluster', 'Fascinating Bluster', true);
  put(5, 'Study', 'Study Sphere (Base)');
  put(6, 'Study', 'Flawless Recall');
  m.recompute();
  check('both ladders feed the same tally', g.tally, { Bluster: 4, Study: 2 });
  check('and a row appears for each sphere', g.spheres.map((r) => r.sphere), ['Bluster', 'Study']);

  // The associated skill is a choice, so nothing pays out until it is made.
  const row = (name) => g.sphereRows.find((r) => r.sphere === name);
  check('no skill chosen is no ranks',
    [row('Bluster').ranksGranted, row('Bluster').skillIndex], [0, -1]);

  g.spheres.find((r) => r.sphere === 'Bluster').skill = 'Bluff';
  g.spheres.find((r) => r.sphere === 'Study').skill = 'Kn. (local)';
  m.recompute();
  const cha = m.data.abilities.cha.totalMod;
  check('5 ranks a talent, capped at Hit Dice',
    [row('Bluster').ranksGranted, row('Study').ranksGranted], [9, 9]);
  check('which land in the Skills tab where they were sent',
    [m.data.skills.find((s) => s.name === 'Bluff').sphereRanks,
      m.data.skills.find((s) => s.name === 'Kn. (local)').sphereRanks], [9, 9]);
  check('the DC is 10 + half the ranks + the operative modifier',
    row('Bluster').dc, 10 + 4 + cha);
  check('and the ranges come off the same ranks',
    [row('Bluster').close, row('Bluster').medium, row('Bluster').long], [45, 190, 760]);
  check('guileRanges agrees on its own', guileRanges(9), { close: 45, medium: 190, long: 760 });

  // Readable from a formula, per sphere -- there is no one number to read.
  const scope = m.scope();
  check('and readable from a formula', scope.sphere.bluster.dc, 10 + 4 + cha);
  check('with the operative under its own name',
    [scope.operative.mod, scope.operative.leverage], [cha, 4]);

  // Two spheres on one skill: the ranks do not stack, the overlap is worth a
  // competence bonus of half the character's level instead.
  g.spheres.find((r) => r.sphere === 'Study').skill = 'Bluff';
  m.recompute();
  const bluff = m.data.skills.find((s) => s.name === 'Bluff');
  check('sharing a skill pays it once', bluff.sphereRanks, 9);
  check('and the overlap pays half a level in competence instead', bluff.competence, 4);
  check('which the skill total actually carries', bluff.bonus, 9 + 4);
  check('one sphere is shown paying and the rest as sharing',
    g.sphereRows.map((r) => [r.paysRanks, r.duplicate, r.competence]),
    [[true, true, 4], [false, true, 0]]);
  check('and the skill they left is empty again',
    m.data.skills.find((s) => s.name === 'Kn. (local)').sphereRanks, 0);

  // A bonus talent handed over by a base sphere or a drawback is not a talent
  // spent, so it buys no ranks -- a counting rule with no counterpart on
  // either of the other two sides.
  g.spheres.find((r) => r.sphere === 'Study').skill = 'Kn. (local)';
  g.bonusTalents.push({ talent: 'Verbal Trap', sphere: 'Bluster', source: 'Alternate start', free: true });
  m.recompute();
  check('a free talent is known', g.tally.Bluster, 5);
  check('but not spent', g.tallySpent.Bluster, 4);
  check('so the ranks do not move', row('Bluster').ranksGranted, 9);
  g.bonusTalents[0].free = false;
  m.recompute();
  check('untick it and it counts', g.tallySpent.Bluster, 5);

  // Two talents on one row, and setTalentEntry has to be told which. It used
  // to write `row.talent` whatever it was called from, so typing a utility
  // talent landed in the free pick beside it and overwrote it.
  const slots = 'training.guile.classes.0.levels';
  m.setTalentEntry(slots, 1, 'Piercing Wit', { sphere: 'sphere', notes: 'notes' });
  m.setTalentEntry(slots, 1, 'Fascinating Bluster',
    { talent: 'utilityTalent', sphere: 'utilitySphere', notes: 'utilityNotes' });
  check('each slot keeps its own talent',
    [cls.levels[1].talent, cls.levels[1].utilityTalent],
    ['Piercing Wit', 'Fascinating Bluster']);
  check('and the write is reported under the column it landed in',
    m.setTalentEntry(slots, 3, 'Breath Control',
      { talent: 'utilityTalent', sphere: 'utilitySphere' })
      && [cls.levels[3].utilityTalent, cls.levels[3].talent],
    ['Breath Control', null]);
  // (What the *catalogue* fills in beside a talent has to land in the named
  // columns too; that half needs a sphere catalogue and is checked in
  // tests/extensions.test.mjs, where one is registered.)
  // Put the row back the way the checks below expect it.
  Object.assign(cls.levels[3], { talent: null, sphere: null, notes: null });
  Object.assign(cls.levels[3], { utilityTalent: null, utilitySphere: null, utilityNotes: null });
  Object.assign(cls.levels[1], { talent: 'Piercing Wit', sphere: 'Bluster' });
  Object.assign(cls.levels[1], { utilityTalent: 'Fascinating Bluster', utilitySphere: 'Bluster' });
  m.recompute();

  // The pools.
  check('leverage is 1 + a third of the Hit Dice', g.leverage.pool, 4);
  check('unlocked by every sphere but Vocation', g.leverage.spheres, ['Bluster', 'Study']);
  check('no plan talents is no plan pool', g.plans.pool, 0);
  g.planBonus = 2;
  g.utilityPlanBonus = 1;
  m.recompute();
  check('and 1 + the non-utility ones once there are',
    [g.plans.pool, g.plans.utilityPool], [3, 1]);

  // A saved sheet carries only what was typed, and comes back the same.
  const saved = m.toJSON();
  const sg = saved.training.guile;
  check('saves no tally, rows or pools',
    ['tally', 'tallySpent', 'sphereRows', 'plans', 'leverage', 'operativeAbilityMod']
      .filter((k) => k in sg), []);
  check('nor a class ladder it can recount',
    Object.keys(sg.classes[0]).filter((k) => k !== 'name' && k !== 'expertise'
      && k !== 'classLevelsOverride' && k !== 'levels'), []);
  check('nor a level slot flag', 'granted' in sg.classes[0].levels[0], false);
  check('nor a sphere row it derives', 'ranksGranted' in sg.spheres[0], false);
  check('but keeps every choice', [sg.classes[0].expertise, sg.operativeMod,
    sg.spheres.map((r) => r.skill)], ['Virtuoso', 'Cha', ['Bluff', 'Kn. (local)']]);

  const back = new Character(JSON.parse(JSON.stringify(saved)));
  check('a round trip keeps the ladder and the DCs',
    [back.data.training.guile.classes[0].totalTalents,
      back.data.training.guile.sphereRows.find((r) => r.sphere === 'Bluster').dc],
    [7, 10 + 4 + cha]);

  // A sphere pointed at a skill row that is not there reads as no ranks
  // rather than quietly picking a neighbour.
  back.data.training.guile.spheres.find((r) => r.sphere === 'Bluster').skill = 'Bluffing';
  back.recompute();
  const lost = back.data.training.guile.sphereRows.find((r) => r.sphere === 'Bluster');
  check('a skill the sheet has not got is marked, not guessed',
    [lost.skillIndex, lost.ranksGranted, lost.ranks], [-1, 0, 0]);
}

console.log('spheres of guile -- the associated skills the book prints');
{
  check('the six spheres divided into packages',
    GUILE_SPHERES.filter((s) => guilePackages(s).length),
    ['Artifice', 'Faction', 'Herbalism', 'Navigation', 'Performance', 'Survivalism']);
  check('Performance names one Perform skill per package',
    guilePackages('Performance').map((p) => guileSkillHint('Performance', p)),
    ['Perform (act or comedy)', 'Perform (dance)',
      'Perform (keyboard, percussion, string, or wind)', 'Perform (comedy, oratory, or sing)']);
  check('a sphere with no packages answers with its own skill',
    [guileSkillHint('Investigation'), guileSkillHint('Subterfuge'), guileSkillHint('Spellhacking')],
    ['Sense Motive', 'Disguise', 'Use Magic Device']);
  check('and Vocation, which has neither', guileSkillHint('Vocation'), '');
  check('leverage pools by Hit Dice',
    [1, 2, 3, 6, 9, 20].map(leveragePool), [1, 1, 2, 3, 4, 7]);
}

console.log('row labels -- what a toast calls the thing that just went');
{
  check('a name', rowLabel({ name: 'Cloak of Resistance' }), 'Cloak of Resistance');
  check('a label, where there is no name', rowLabel({ label: 'Second wind' }), 'Second wind');
  check('the first field with anything in it',
    rowLabel({ name: '', title: 'Untitled', text: 'body' }), 'Untitled');
  check('whitespace is not a name', rowLabel({ name: '   ' }, 'row'), 'row');
  check('a bare string is its own label', rowLabel('Wild Talent'), 'Wild Talent');
  check('nothing at all falls back', rowLabel({}, 'weapon'), 'weapon');
  check('and so does nothing', rowLabel(null, 'weapon'), 'weapon');
  check('a long one is cut to fit a sentence', rowLabel({ name: 'x'.repeat(80) }).length, 40);
}

console.log('a question in prose -- the fifth inline form');
{
  const { tokenize, plainTokens, renderTokens, collectUses } = await import('../app/js/inline.js');
  const one = (text) => tokenize(text)[0];

  const list = one('{?Deathgrip | Spend nothing, 0 | 1 HP, 2 | 1 + invested, 2 * (1 + 3)}');
  check('a list of answers', [list.kind, list.label, list.free], ['query', 'Deathgrip', false]);
  check('each answer is a label and an expression',
    list.options.map((o) => [o.label, o.expr]),
    [['Spend nothing', '0'], ['1 HP', '2'], ['1 + invested', '2 * (1 + 3)']]);
  check('the first answer is the one the sheet reads', list.expr, '0');

  // Roll20 offers both shapes, and so does this: the difference is the comma.
  const free = one('{?Extra damage | 0}');
  check('no comma and one answer is a free number', [free.free, free.expr], [true, '0']);
  check('nothing after the label still opens on something',
    [one('{?Bonus}').free, one('{?Bonus}').expr], [true, '0']);
  const bare = one('{?Attack die | 0 | 2 | 4}');
  check('several answers with no commas are their own labels',
    [bare.free, bare.options.map((o) => o.label)], [false, ['0', '2', '4']]);

  check('the four older forms are untouched',
    ['{= 1 + 2}', '{name = 4}', '{skill.bluff += 4}', '{name}'].map((t) => one(t).kind),
    ['value', 'define', 'push', 'ref']);
  check('a question reads as its first answer',
    plainTokens(renderTokens('deals {?Blood | none, 0 | 1 HP, 2} extra', {}, {})),
    'deals 0 extra');
  // Every answer is checked, not just the one that is usually taken -- the
  // unpicked answer is exactly the one whose broken name would go unnoticed.
  check('every answer is watched for a missing name',
    collectUses([{ path: 'p', text: '{?Q | a, str.mod | b, con.mod}' }]).map((u) => u.name),
    ['str.mod', 'con.mod']);
}

console.log('a question on a weapon -- the sheet takes the first answer');
{
  const doc = blankDocument({ name: 'Gauntlet', level: 11 });
  delete doc.statsBuild;
  doc.abilities.str = { ...doc.abilities.str, score: 18, tempScore: 18 };
  doc.attack.bab = 11;
  const gauntlet = {
    name: 'Deathgrip Gauntlets', attackType: 'Melee', dice: '1d3', damageAbility: 'Str',
    abilityMult: 1, miscDamage: 0, miscAttack: 0, enhancement: 1, critRange: 20, critMult: 'x2',
    damageType: 'B', groups: [], size: '', range: '', handedness: '', familiarity: '',
    ammunition: '', weight: 2, price: 0, attackOffset: 0,
    special: '[[{?Deathgrip | Spend nothing, 0 | 1 HP, 2 | 1 + invested, 2 * (1 + 3)} Mult]]',
  };
  doc.equipment.weapons.push({ ...gauntlet });
  const w = new Character(doc).data.equipment.weapons[0];
  // 1d3 + Str 4 + enhancement 1, and nothing from the question: its first
  // answer is 0, which is the ability not being used.
  check('the printed total is still a number', w.calc.totalDmgStr, '1d3+5');
  check('and nothing is broken about it', w.calc.errors, []);
  check('the question rides in the pool the multiplier takes',
    w.calc.tokMultDmg.queries.map((q) => q.label), ['Deathgrip']);
  check('with every answer worked out',
    w.calc.tokMultDmg.queries[0].answers.map((a) => a.text), ['0', '2', '8']);

  // The keywords are read after the answers are spliced in, so a label that
  // happens to say "multiply" is prose and not the Mult keyword.
  const proseKeyword = { ...gauntlet, special: '[[{?Multiply your blood | none, 0 | some, 4}]]' };
  const w2 = new Character({ ...doc, equipment: { ...doc.equipment, weapons: [proseKeyword] } })
    .data.equipment.weapons[0];
  check('a label is not a keyword',
    [w2.calc.tokMultDmg.queries.length, w2.calc.tokDmg.queries.length], [0, 1]);

  // A question survives to the roll by keeping the whole expression it sits
  // in, and only the two token properties are carried that way. The plain
  // columns are read as one number each, so they refuse it out loud rather
  // than splicing the first answer and losing the rest.
  const refused = /can only be asked in a/;
  const only = (w) => new Character({ ...doc, equipment: { ...doc.equipment, weapons: [w] } })
    .data.equipment.weapons[0];
  const q = '{?Size | small, 1 | large, 2}';
  check('a question in the Dice field is refused out loud',
    refused.test(only({ ...gauntlet, dice: q, special: '' }).diceError || ''), true);
  check('and in Misc dmg',
    refused.test(only({ ...gauntlet, miscDamage: q, special: '' }).miscDamageError || ''), true);
  check('and in Bonus crit damage',
    refused.test(only({ ...gauntlet, bonusCritDamage: q, special: '' })
      .calc.errors.concat(only({ ...gauntlet, bonusCritDamage: q, special: '' }).bonusCritError || '')
      .join(' ') || ''), true);

  // The arithmetic *around* a question has to survive with it. This was wrong
  // once: the sheet doubled its own total and handed the table an undoubled
  // question, which is the one outcome worse than not supporting it.
  const doubled = only({ ...gauntlet, special: '[[{?Blood|}*2 Mult]]' });
  check('a question keeps the expression it was written in',
    doubled.calc.tokMultDmg.terms.length, 1);
  check('and the sheet still reads its first answer', doubled.calc.totalDmgStr, '1d3+5');
  check('the pool remembers what the term already stands for',
    doubled.calc.tokMultDmg.termFlat, 0);
}

/*
 * The Other column takes a formula. A number is recovered on load as the
 * saved total less the visible parts, as it always was; a rule cannot be, so
 * its text rides on the document and is worked out again each pass.
 */
console.log('\nthe Other column -- a number, or a rule the sheet keeps as one');
{
  const control = (level) => {
    const k = new Character(blankDocument({ name: 'Control' }));
    k.set('identity.level', level);
    return k;
  };
  const c = new Character(blankDocument({ name: 'Offset' }));
  c.set('identity.level', 8);
  const will = (m = c) => m.data.saves.will.total;
  check('nothing in Other to begin with',
    [c.offsetSource('saves.will.total'), c.offsetOf('saves.will.total')], [0, 0]);

  c.setOffset('saves.will.total', 'floor(level / 4)');
  check('a formula in Other is worked out', [c.offsetOf('saves.will.total'), will()], [2, will(control(8)) + 2]);
  check('and kept as the text it was typed', c.offsetSource('saves.will.total'), 'floor(level / 4)');
  check('on the document, under the stat it belongs to',
    c.data.otherFormulas, { 'saves.will.total': 'floor(level / 4)' });
  c.set('identity.level', 12);
  check('it follows the level', [c.offsetOf('saves.will.total'), will()], [3, will(control(12)) + 3]);
  const row = c.audit().find((r) => r.id === 'other-saves.will.total');
  check('and the audit lists it', [row?.name, row?.status, row?.value, row?.formula],
    ['Will — Other', 'ok', 3, 'floor(level / 4)']);

  // Round trip: the rule survives a save, and is not counted twice on the
  // way back in -- the saved total already holds it, and the offset is the
  // rule rather than a measurement of that total.
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('reopened, it is still a rule', again.offsetSource('saves.will.total'), 'floor(level / 4)');
  check('and the total is what it was, not that plus the rule again',
    [will(again), again.offsetOf('saves.will.total')], [will(), 3]);
  check('so nothing reads as drifted', again.diffFromSource(), []);
  // A document whose level moved between the save and the load: the rule is
  // read against the level it finds, not the number it came to before.
  const doc = JSON.parse(JSON.stringify(c.toJSON()));
  doc.identity.level = 16;
  const later = new Character(doc);
  check('and a rule reopened at a new level is read at that level',
    [later.offsetOf('saves.will.total'), will(later)], [4, will(control(16)) + 4]);

  // A rule that cannot be read is worth nothing and says so.
  c.setOffset('saves.will.total', 'level +');
  check('a broken rule adds nothing and carries its error',
    [c.offsetOf('saves.will.total'), will(), typeof c.offsetError('saves.will.total')],
    [0, will(control(12)), 'string']);
  check('and the audit flags it', c.audit().find((r) => r.id === 'other-saves.will.total')?.status, 'error');

  // Back to a number, typed as a field types it -- text -- and the document
  // has nothing extra to say.
  c.setOffset('saves.will.total', '4');
  check('a number typed into the field is a number',
    [c.offsetSource('saves.will.total'), will(), c.data.otherFormulas], [4, will(control(12)) + 4, undefined]);
  check('and nothing is left in the audit', c.audit().some((r) => r.id.startsWith('other-')), false);
  c.setOffset('saves.will.total', '');
  check('cleared is zero', [c.offsetSource('saves.will.total'), will()], [0, will(control(12))]);

  // Hit points carry the same field, on a different footing (not a DERIVED
  // stat), and take the same rule.
  const hp = (m = c) => m.data.hp.total;
  const hpBase = (m = c) => Number(m.data.hp.base) || 0;
  // A blank sheet's hit points are all Other: nothing in the class table
  // reaches them, so the template's figure is the offset. A rule written
  // there replaces that figure, as a number typed there would.
  check('a blank sheet keeps its hit points in Other', hp(), hpBase() + c.offsetOf('hp.total'));
  c.setOffset('hp.total', 'level * 2');
  check('hit points take a rule in Other too', [c.offsetOf('hp.total'), hp()], [24, hpBase() + 24]);
  const hpAgain = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('and keep it across a save without doubling',
    [hpAgain.offsetSource('hp.total'), hp(hpAgain), hpAgain.diffFromSource()], ['level * 2', hp(), []]);
  check('named for the reader', c.audit().find((r) => r.id === 'other-hp.total')?.name, 'Hit points — Other');
}

/*
 * The sphere tables' bonus columns -- CL+ and DC+ on the magic side, BAB+
 * and DC+ on the martial, Rank+ and DC+ on the guile -- take a rule as well
 * as a number, the way the speed bonus does.
 */
console.log('\nthe sphere tables -- a bonus column that takes a rule');
{
  const c = new Character(blankDocument({ name: 'Spheres' }));
  c.set('identity.level', 8);
// A casting class with levels: a caster-level bonus waits until casting is unlocked.
  c.listAdd('training.magic.classes', { name: 'Incanter', type: 'High', classLevelsOverride: 8, levels: [] });
  c.listAdd('training.magic.sphereBonuses', { sphere: 'Dark', clBonus: 0, dcBonus: 0 });
  c.listAdd('training.combat.sphereBonuses', { sphere: 'Athletics', rankBonus: 0, dcBonus: 0 });
  c.addGuileSphere('Study');
  const magic = () => c.data.training.magic.sphereRows.find((r) => r.sphere === 'Dark');
  const combat = () => c.data.training.combat.sphereRows.find((r) => r.sphere === 'Athletics');
  const guile = () => c.data.training.guile.sphereRows.find((r) => r.sphere === 'Study');
  const globalCL = () => c.data.training.magic.globalCL;
  const globalDC = () => c.data.training.magic.globalDC;
  const pracDC = () => c.data.training.combat.practitionerDC;

  // Magic: CL+ and DC+.
  c.setItem('training.magic.sphereBonuses', 0, 'clBonus', 'floor(level / 4)');
  check('a CL+ written as a rule', [magic().clBonusNum, magic().cl, magic().dc],
    [2, globalCL() + 2, globalDC() + 1]);
  c.setItem('training.magic.sphereBonuses', 0, 'dcBonus', 'level / 2');
  check('and a DC+', [magic().dcBonusNum, magic().dc], [4, globalDC() + 1 + 4]);
  c.set('identity.level', 12);
  check('both follow the level', [magic().clBonusNum, magic().dcBonusNum], [3, 6]);
  check('the rule is what is stored', c.data.training.magic.sphereBonuses[0].clBonus, 'floor(level / 4)');

  // Martial: BAB+ (stored as rankBonus) and DC+.
  const bab = Number(c.data.attack.bab) || 0;
  c.setItem('training.combat.sphereBonuses', 0, 'rankBonus', 'level / 3');
  c.setItem('training.combat.sphereBonuses', 0, 'dcBonus', 'floor(level / 6)');
  check('a BAB+ and DC+ written as rules',
    [combat().rankBonusNum, combat().attack, combat().dcBonusNum, combat().dc],
    [4, Math.min(bab + 4, 12), 2, pracDC() + 2]);

  // Guile: Rank+ resolves before the skills (it feeds them); DC+ after.
  c.setItem('training.guile.spheres', 0, 'skill', 'Perception');
  const dcBefore = guile().dc;
  c.setItem('training.guile.spheres', 0, 'rankBonus', 'level / 4');
  c.setItem('training.guile.spheres', 0, 'dcBonus', 'level / 6');
  check('a Rank+ and DC+ written as rules',
    [guile().rankBonusNum, guile().dcBonusNum, guile().dc], [3, 2, dcBefore + 2]);

  // The audit lists every one of them.
  const audit = c.audit();
  check('the audit lists them', ['sphere-magic-dark-clBonus', 'sphere-magic-dark-dcBonus',
    'sphere-combat-athletics-rankBonus', 'sphere-combat-athletics-dcBonus', 'sphere-guile-0-rankBonus',
    'sphere-guile-0-dcBonus'].map((id) => audit.find((r) => r.id === id)?.status), Array(6).fill('ok'));
  check('by the column they sit in',
    [audit.find((r) => r.id === 'sphere-magic-dark-clBonus')?.name,
      audit.find((r) => r.id === 'sphere-combat-athletics-rankBonus')?.name,
      audit.find((r) => r.id === 'sphere-guile-0-rankBonus')?.name],
    ['Dark CL+', 'Athletics BAB+', 'Study Rank+']);

  // A rule that cannot be read adds nothing and says so.
  c.setItem('training.magic.sphereBonuses', 0, 'clBonus', 'nope');
  check('a broken rule is worth nothing and carries its error',
    [magic().clBonusNum, magic().cl, typeof magic().clBonusError], [0, globalCL(), 'string']);
  check('and the audit flags it', c.audit().find((r) => r.id === 'sphere-magic-dark-clBonus')?.status, 'error');
  c.setItem('training.magic.sphereBonuses', 0, 'clBonus', 1);
  check('a number is still a number', [magic().clBonusNum, magic().clBonusError, magic().cl], [1, null, globalCL() + 1]);

  // Saved and reopened: the rules survive, and the guile side saves only
  // what was typed.
  const doc = JSON.parse(JSON.stringify(c.toJSON()));
  check('the guile row saves the rule and not its working',
    doc.training.guile.spheres[0], {
      sphere: 'Study', package: '', skill: 'Perception', rankBonus: 'level / 4', dcBonus: 'level / 6',
    });
  const again = new Character(doc);
  const g2 = again.data.training.guile.sphereRows.find((r) => r.sphere === 'Study');
  check('and reopened, every rule still reads',
    [again.data.training.magic.sphereRows.find((r) => r.sphere === 'Dark').dcBonusNum,
      again.data.training.combat.sphereRows.find((r) => r.sphere === 'Athletics').rankBonusNum,
      g2.rankBonusNum, g2.dcBonusNum],
    [6, 4, 3, 2]);
  check('with nothing drifted', again.diffFromSource(), []);
}

/*
 * The same numbers are destinations: a rule written in prose can send a
 * bonus to a sphere's caster level, attack bonus, ranks or DC, and it lands
 * beside the typed bonus in the same column.
 */
console.log('\nthe sphere tables -- a place to send a bonus');
{
  const c = new Character(blankDocument({ name: 'Spheres' }));
  c.set('identity.level', 8);
// A casting class with levels: a caster-level bonus waits until casting is unlocked.
  c.listAdd('training.magic.classes', { name: 'Incanter', type: 'High', classLevelsOverride: 8, levels: [] });
  c.listAdd('training.magic.sphereBonuses', { sphere: 'Sphere', clBonus: 0, dcBonus: 0, sheetValue: 'Sphere CL / DC' });
  c.listAdd('training.magic.sphereBonuses', { sphere: 'Dark', clBonus: 1, dcBonus: 0 });
  c.listAdd('training.combat.sphereBonuses', { sphere: 'Athletics', rankBonus: 0, dcBonus: 0 });
  c.addGuileSphere('Study');
  c.setItem('training.guile.spheres', 0, 'skill', 'Perception');
  const magic = () => c.data.training.magic.sphereRows.find((r) => r.sphere === 'Dark');
  const combat = () => c.data.training.combat.sphereRows.find((r) => r.sphere === 'Athletics');
  const guile = () => c.data.training.guile.sphereRows.find((r) => r.sphere === 'Study');

  // Readable first: the numbers publish under the sphere's slugged name.
  check('a magic sphere publishes its caster level and DC',
    [c.scope().sphere.dark.cl, c.scope().sphere.dark.dc, c.scope().sphere.dark.talents],
    [magic().cl, magic().dc, 0]);
  check('a combat sphere its attack bonus and DC',
    [c.scope().sphere.athletics.bab, c.scope().sphere.athletics.dc], [combat().attack, combat().dc]);
  check('the skill spheres are still there beside them', c.scope().sphere.study.dc, guile().dc);
  check('and the workbook\'s header row publishes nothing', c.scope().sphere.sphere, undefined);
  check('the names validate', ['sphere.dark.cl', 'sphere.athletics.bab', 'sphere.study.ranks']
    .filter((n) => !new NameIndex(c.scopeNames()).has(n)), []);

  // Destinations: every sphere on the tables, which is the whole catalogue,
  // and never the workbook's header row.
  const names = c.forwardTargets().list.filter((t) => t.name.startsWith('sphere.')).map((t) => t.name);
  check('every column is a destination',
    ['sphere.dark.cl', 'sphere.dark.dc', 'sphere.athletics.bab', 'sphere.athletics.dc',
      'sphere.study.ranks', 'sphere.study.dc', 'sphere.alteration.cl', 'sphere.alchemy.bab']
      .filter((n) => !names.includes(n)), []);
  check('and the header row is not', names.some((n) => n.startsWith('sphere.sphere.')), false);
  check('labelled by the sphere', c.forwardTargets().list.find((t) => t.name === 'sphere.dark.cl')?.label,
    'Dark: caster level');

  const before = {
    cl: magic().cl, mdc: magic().dc, attack: combat().attack, cdc: combat().dc, gdc: guile().dc,
  };
  const note = (text) => {
    const at = c.data.notes.length;
    c.listAdd('notes', { title: 'Test', body: text });
    return () => c.listRemove('notes', at);
  };

  // Magic: a CL bonus is worth half of itself to the DC, as a typed one is.
  let drop = note('Dark focus {sphere.dark.cl += 2} and {sphere.dark.dc += 1}.');
  check('a forwarded CL lands beside the typed one', [magic().clForwarded, magic().clBonusNum, magic().cl],
    [2, 1, before.cl + 2]);
  check('and carries half of itself into the DC, with the DC bonus on top',
    [magic().dcForwarded, magic().dc], [1, before.mdc + 1 + 1]);
  check('the column still says what was typed in it', c.data.training.magic.sphereBonuses[1].clBonus, 1);
  check('and the badge knows where it came from, by the note\'s title',
    c.forwardedInto('sphere.dark.cl')?.from?.[0]?.where, 'Test, on Lore');
  drop();
  check('gone when the note goes', [magic().cl, magic().dc], [before.cl, before.mdc]);

  // Combat.
  drop = note('Athletic focus {sphere.athletics.bab += 3} and {sphere.athletics.dc += 2}.');
  check('a combat sphere takes an attack bonus and a DC bonus',
    [combat().babForwarded, combat().attack, combat().dcForwarded, combat().dc],
    [3, Math.min(before.attack + 3, 8), 2, before.cdc + 2]);
  drop();

  // Guile: the DC lands after the skills; the ranks land before them and
  // so cost a second pass, which the sheet takes.
  drop = note('Studious {sphere.study.dc += 2}.');
  check('a skill sphere takes a DC bonus', [guile().dcForwarded, guile().dc], [2, before.gdc + 2]);
  drop();
  drop = note('Studious {sphere.study.ranks += 4}.');
  check('a rank bonus is early, and read on the second pass', guile().ranksForwarded, 4);
  // With no talents in the sphere the ranks are owed nothing, so the bonus
  // is held rather than paid -- the same line the typed Rank+ draws.
  check('and is held until the sphere has a talent to pay on', guile().ranksGranted, 0);
  drop();

  // Saved and reopened with a bonus in play: forwarded, not absorbed.
  drop = note('Dark focus {sphere.dark.cl += 2}.');
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  const dark = again.data.training.magic.sphereRows.find((r) => r.sphere === 'Dark');
  check('reopened, the bonus is still forwarded rather than absorbed',
    [dark.clForwarded, dark.cl, dark.clBonus], [2, before.cl + 2, 1]);
  check('and the saved row carries nothing of the working',
    Object.keys(JSON.parse(JSON.stringify(again.toJSON())).training.guile.spheres[0]).sort(),
    ['dcBonus', 'package', 'rankBonus', 'skill', 'sphere']);
  drop();
}

/*
 * The three casting systems' own levels are destinations too, each under
 * its own prefix: spheres.cl, vancian.<class>.cl, manifester.<class>.level.
 * A caster-level bonus moves the caster level and what is built on it, and
 * never the slots or power points, which are keyed to levels of the class.
 */
console.log('\ncaster levels -- spheres.*, vancian.* and manifester.* take a bonus');
{
  const c = new Character(blankDocument({ name: 'Casters' }));
  c.set('identity.level', 8);
// A casting class with levels: a caster-level bonus waits until casting is unlocked.
  c.listAdd('training.magic.classes', { name: 'Incanter', type: 'High', classLevelsOverride: 8, levels: [] });
  c.set('training.magic.clBonus', 1);
  c.listAdd('training.magic.sphereBonuses', { sphere: 'Dark', clBonus: 0, dcBonus: 0 });
  c.listAdd('vancian.classes', {
    name: 'Hedgewitch', slotType: 'Wizard', stat: 'Int', stat2: '', prep: '', source: '',
    casterLevelOverride: 5, concentration: 0,
    spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
  });
  c.listAdd('psionics.classes', {
    name: 'Psion', stat: 'Int', stat2: '', curveTotal: 343, manifesterLevelOverride: 6, powers: [],
  });
  const m = () => c.data.training.magic;
  const dark = () => m().sphereRows.find((r) => r.sphere === 'Dark');
  const hedge = () => c.data.vancian.classes[0];
  const psion = () => c.data.psionics.classes[0];
  const before = {
    cl: m().globalCL, dc: m().globalDC, msb: m().msb, msd: m().msd, conc: m().concentration,
    dark: dark().cl, slots: hedge().totalPerDay, pp: psion().points,
  };

  const names = c.forwardTargets().list.map((t) => t.name);
  check('each system offers its own names',
    ['spheres.cl', 'spheres.dc', 'spheres.msb', 'spheres.msd', 'vancian.hedgewitch.cl', 'vancian.cl',
      'manifester.psion.level', 'manifester.level'].filter((n) => !names.includes(n)), []);
  check('and reads under them',
    [c.scope().spheres.cl, c.scope().vancian.hedgewitch.cl, c.scope().vancian.cl,
      c.scope().manifester.psion.level, c.scope().manifester.level],
    [before.cl, 5, 5, 6, 6]);
  check('a system the character has not got is not offered',
    new Character(blankDocument({ name: 'Plain' })).forwardTargets().list
      .some((t) => /^(vancian|manifester)\./.test(t.name)), false);

  const note = (text) => {
    const at = c.data.notes.length;
    c.listAdd('notes', { title: 'Test', body: text });
    return () => c.listRemove('notes', at);
  };

  // Spheres: worked out before the prose, so it takes the second pass.
  let drop = note('Orange prism {spheres.cl += 2}, and {spheres.msb += 1}.');
  check('a Spheres CL bonus lands beside the typed one',
    [m().clForwarded, m().clBonus, m().globalCL], [2, 1, before.cl + 2]);
  check('and carries into the DC, concentration and every sphere',
    [m().globalDC, m().concentration, dark().cl],
    [before.dc + Math.floor((before.cl + 2) / 2) - Math.floor(before.cl / 2), before.conc + 2, before.dark + 2]);
  check('MSB takes one too, and MSD follows it', [m().msb, m().msd], [before.msb + 1, before.msd + 1]);
  check('the scope reads the new number', [c.scope().spheres.cl, c.scope().caster.level],
    [before.cl + 2, before.cl + 2]);
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('reopened, forwarded rather than absorbed',
    [again.data.training.magic.globalCL, again.data.training.magic.clBonus], [before.cl + 2, 1]);
  drop();
  check('gone when the note goes', [m().globalCL, dark().cl], [before.cl, before.dark]);

  // Vancian: caster level only, never the slots.
  drop = note('Ioun stone {vancian.hedgewitch.cl += 1}.');
  check('a Vancian CL bonus raises the caster level',
    [hedge().casterLevel, hedge().casterLevelBase, hedge().casterLevelForwarded], [6, 5, 1]);
  check('and not the slots', hedge().totalPerDay, before.slots);
  check('the badge knows where it came from',
    c.forwardedInto('vancian.hedgewitch.cl')?.from?.[0]?.value, 1);
  drop();
  drop = note('{vancian.cl += 2}');
  check('vancian.cl is every Vancian class', hedge().casterLevel, 7);
  drop();

  // Manifester: manifester level only, never the power points.
  drop = note('{manifester.level += 2}');
  check('a manifester level bonus raises the ML',
    [psion().manifesterLevel, psion().manifesterLevelBase], [8, 6]);
  check('and not the power points', psion().points, before.pp);
  drop();

  check('the saved document carries none of the working',
    [Object.keys(JSON.parse(JSON.stringify(c.toJSON())).vancian.classes[0])
      .filter((k) => /casterLevel(Base|Forwarded)/.test(k)),
    Object.keys(JSON.parse(JSON.stringify(c.toJSON())).psionics.classes[0])
      .filter((k) => /manifesterLevel(Base|Forwarded)/.test(k)),
    Object.keys(JSON.parse(JSON.stringify(c.toJSON())).training.magic)
      .filter((k) => /Forwarded$/.test(k))], [[], [], []]);
}

/*
 * The sphere tables list the whole catalogue, worked out, whether or not
 * the document stores a row -- a character built here rather than imported
 * has none. A sphere with a talent in it, from any source, is on the table;
 * the rest fold away; and the first edit to one writes its row.
 */
console.log('\nthe sphere tables -- every sphere, and only the trained ones in front');
{
  const c = new Character(blankDocument({ name: 'Fresh' }));
  const magicRows = () => c.data.training.magic.sphereRows;
  const combatRows = () => c.data.training.combat.sphereRows;
  check('nothing is stored on a fresh sheet',
    [c.data.training.magic.sphereBonuses, c.data.training.combat.sphereBonuses], [[], []]);
  check('but every sphere is on the table, in catalogue order',
    [magicRows().length >= MAGIC_SPHERES.length, magicRows().slice(0, 3).map((r) => r.sphere),
      combatRows().length >= COMBAT_SPHERES.length, combatRows()[0].sphere],
    [true, MAGIC_SPHERES.slice(0, 3), true, COMBAT_SPHERES[0]]);
  const dark = () => magicRows().find((r) => r.sphere === 'Dark');
  check('and worked out', [dark().cl, dark().dc, dark().talents],
    [c.data.training.magic.globalCL, c.data.training.magic.globalDC, 0]);
  check('readable and targetable without a row',
    [c.scope().sphere.dark.cl, c.forwardTargets().list.some((t) => t.name === 'sphere.alteration.cl')],
    [dark().cl, true]);

  // A talent from a class level puts the sphere in front -- a level the class
  // has, which with an empty Planner is the level count it is given.
  c.listAdd('training.magic.classes', {
    name: 'Incanter', type: 'High', classLevelsOverride: 1, levels: [{ level: 1, talent: 'Dark Sphere', sphere: 'Dark' }],
  });
  check('a class talent counts', dark().talents, 1);
  const magicHtml = combatPanels.renderMagicPanel(c);
  const start = magicHtml.indexOf('<h3>Sphere CL / DC');
  const foldAt = magicHtml.indexOf('<details', start);
  check('the panel rendered its table and its fold', [start > 0, foldAt > start], [true, true]);
  const table = magicHtml.slice(start, foldAt);
  const folded = magicHtml.slice(foldAt);
  check('and the table shows it, with the rest folded',
    [table.includes('<td>Dark</td>'), table.includes('<td>Alteration</td>'), folded.includes('<td>Alteration</td>')],
    [true, false, true]);

  // The first edit to a sphere writes its row; a later one finds it.
  c.setSphereBonus('magic', 'Weather', 'clBonus', 'floor(level / 4)');
  check('an edit writes the one row', c.data.training.magic.sphereBonuses,
    [{ sphere: 'Weather', clBonus: 'floor(level / 4)', dcBonus: 0 }]);
  c.setSphereBonus('magic', 'Weather', 'dcBonus', 2);
  check('and the next finds it', c.data.training.magic.sphereBonuses.length, 1);
  const weather = () => magicRows().find((r) => r.sphere === 'Weather');
  check('the row reads the edit', [weather().clBonus, weather().dcBonusNum], ['floor(level / 4)', 2]);
  c.setSphereBonus('combat', 'Athletics', 'rankBonus', 1);
  check('the combat side names its column', c.data.training.combat.sphereBonuses,
    [{ sphere: 'Athletics', rankBonus: 1, dcBonus: 0 }]);
  c.setSphereBonus('combat', 'Athletics', 'clBonus', 1);
  check('and refuses the other side\'s', c.data.training.combat.sphereBonuses[0].clBonus, undefined);

  // The guile tab folds the catalogue the same way, and Add names the sphere.
  const guileHtml = guilePanels.renderGuilePanel(c);
  check('the guile tab offers the rest of its catalogue',
    guileHtml.includes('data-action="add-guile-sphere" data-sphere="Study"'), true);
  c.addGuileSphere('Study');
  check('and adds the one named', c.data.training.guile.spheres.map((r) => r.sphere), ['Study']);
}

/*
 * A class gains talents the way its own system grants them, so each tab's
 * Talents / level offers that system's three rates and no other's; and the
 * guile block carries the operative modifier where the other two carry the
 * class's casting score or practitioner modifier.
 */
console.log('\ntalents per level -- each system\'s own three rates');
{
  const c = new Character(blankDocument({ name: 'Rates' }));
  const blankLevels = () => Array.from({ length: 20 }, (_, i) => ({ level: i + 1, talent: null, sphere: null, notes: null }));
  c.listAdd('training.magic.classes', { name: 'Incanter', type: null, talentsPerLevel: null, mod1: null, mod2: null, levels: blankLevels() });
  c.listAdd('training.combat.classes', { name: 'Armiger', type: null, talentsPerLevel: 'Mid-Caster', mod1: null, mod2: null, levels: blankLevels() });
  c.addGuileClass('Operative');
  const options = (html, path) => {
    const at = html.indexOf(`data-item="${path}"`);
    const open = html.lastIndexOf('<select', at);
    const close = html.indexOf('</select>', at);
    return [...html.slice(open, close).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  };
  check('the magic tab offers the caster rates',
    options(combatPanels.renderMagicPanel(c), 'training.magic.classes|0|talentsPerLevel'),
    ['High Caster', 'Mid-Caster', 'Low Caster']);
  check('the martial tab the practitioner rates, keeping a stray value rather than blanking it',
    options(combatPanels.renderMartialPanel(c), 'training.combat.classes|0|talentsPerLevel'),
    ['Expert', 'Adept', 'Proficient', 'Mid-Caster']);
  const guile = guilePanels.renderGuilePanel(c);
  const tier = guile.indexOf('Expertise tier');
  const operative = guile.indexOf('Operative modifier', tier);
  const levels = guile.indexOf('Class levels', tier);
  check('the guile block puts the operative modifier between the tier and the levels',
    [tier > 0, operative > tier, levels > operative], [true, true, true]);
  check('and it is the one setting, bound to the character', guile.includes('data-set="training.guile.operativeMod"'), true);
}

  console.log('\na card as a Roll20 message: its dice worked out, its cost and effect as notes');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 15 }));
  c.data.cardcasting.enabled = true;
  c.data.cardcasting.castingStat = 'Int';
  c.data.cardcasting.cards = [
    { name: 'Big Sky', qty: 2, cost: '1', color: 'R', mana: 'RU', sphere: 'Destruction', tags: 'blast',
      effect: 'Fire Blast (Chain Blast) — Reflex DC {= 10 + floor(level/2) + int.mod}',
      dice: 'damage: {1+floor(level/2)}d6+level; boost (1 SP): 15d6; aside: see the sphere' },
    { name: 'Betrayal', qty: 1, cost: '1', color: 'B', mana: '', sphere: 'Death', tags: '', effect: 'Corpse Bomb (Exhausting)', dice: '' },
    { name: 'Desert', qty: 1, cost: '1', color: 'R', mana: '', sphere: 'Destruction', tags: '', effect: 'Fire Blast (Chain Blast) — Reflex DC {= 10 + floor(level/2) + int.mod}', dice: '' },
    { name: 'Long', qty: 1, cost: '2', color: 'U', mana: '', sphere: 'Mind', tags: '', effect: 'A'.repeat(90) + '\nsecond line', dice: '' },
  ];
  c.recompute();
  const intMod = c.data.abilities.int.mod;
  const spec = c.cardRollSpec('cardcasting.cards|0');
  check('a short effect joins the name, formulas resolved', spec.name, `Big Sky — Fire Blast (Chain Blast) — Reflex DC ${17 + intMod}`);
  check('each dice entry is a roll with plain dice', spec.rolls, [
    { label: 'damage', formula: '8d6+15' }, { label: 'boost (1 SP)', formula: '15d6' },
  ]);
  check('an entry that is not dice travels as a note, before the cost', spec.notes[0], { label: 'aside', text: 'see the sphere' });
  check('cost with its colour, sphere with its tags, the mana a fused card carries',
    spec.notes.slice(1), [{ label: 'Cost', text: '1 SP (Red)' }, { label: 'Sphere', text: 'Destruction — blast' }, { label: 'Mana', text: 'RU' }]);
  check('an instance on the table names the same card', c.cardRollSpec('0#1').name, spec.name);
  check('a card with no dice is notes alone', [c.cardRollSpec('cardcasting.cards|1').rolls, c.cardRollSpec('cardcasting.cards|1').notes.length], [[], 2]);
  const long = c.cardRollSpec('cardcasting.cards|3');
  check('a long effect is a note of its own, and the name stays the card\'s', [long.name, long.notes.at(-1).label, long.notes.at(-1).text.startsWith('AAAA')], ['Long', 'Effect', true]);
  c.data.cardcasting.cards[3].effect = 'A talent copied verbatim. '.repeat(100);
  c.recompute();
  check('a talent copied verbatim travels whole', c.cardRollSpec('cardcasting.cards|3').notes.at(-1).text.length, 'A talent copied verbatim. '.repeat(100).trim().length);
  check('nothing for a reference that names no card', [c.cardRollSpec('9#0'), c.cardRollSpec('cardcasting.cards|9'), c.cardRollSpec('weapon|0')], [null, null, null]);
  check('the face\'s preview reads the same entries, with the one that is not dice saying why',
    c.cardRollFormulas(c.data.cardcasting.cards[0]).map((r) => [r.label, r.formula, !!r.error]),
    [['damage', '8d6+15', false], ['boost (1 SP)', '15d6', false], ['aside', '', true]]);
  check('a card with no Dice field rolls the first dice in its text', c.cardRollFormulas({ effect: 'Deals 3d8+2 and [Draw 1]' }).map((r) => r.formula), ['3d8+2']);
  check('a die stepped by level — Mana Siphon\'s spell-point drain — is dice the field rolls',
    c.cardRollFormulas({ dice: 'siphon: {step("1", floor(level/5))}' }).map((r) => [r.label, r.formula]), [['siphon', '1d4']]);
  check('and before the fifth level the flat 1 it drains is still a roll, not "no dice"',
    c.cardRollFormulas({ dice: 'siphon: {step("1", 0)}' }).map((r) => [r.formula, r.error]), [['1', '']]);

  check('the cards that share an effect are the card\'s siblings', c.cardSiblings('cardcasting.cards', 0), [2]);
  check('a card whose effect is unique has none', c.cardSiblings('cardcasting.cards', 1), []);
  check('and the dice go to them, and to nobody else', [c.shareCardDice('cardcasting.cards', 0), c.data.cardcasting.cards[2].dice, c.data.cardcasting.cards[1].dice],
    [1, c.data.cardcasting.cards[0].dice, '']);
  check('the switch for copying on cast rides with the character', new Character({ ...c.toJSON(), cardcasting: { ...c.toJSON().cardcasting, copyOnCast: true } }).data.cardcasting.copyOnCast, true);
}

console.log('\nTerrain Casting: every cast pays a point, a step, a blight, or a Drawback Freedom use');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 9 }));
  c.data.training.magic.tradition = { ...(c.data.training.magic.tradition || {}), drawbacks: ['Terrain Casting'], boughtOff: [] };
  c.data.cardcasting.enabled = true;
  c.data.cardcasting.cards = [
    { name: 'Bolt', qty: 3, cost: '1', color: 'R', mana: '', sphere: 'Destruction', effect: 'Fire Blast', dice: '', casting: 'standard action' },
    { name: 'Glow', qty: 3, cost: '0', color: 'W', mana: '', sphere: 'Light', effect: 'Glow', dice: '', casting: 'standard action' },
  ];
  c.addTracker({ name: 'Spell Points', maxFormula: '20' });
  c.recompute();
  const cards = c.data.cardcasting.cards;
  const t = () => c.data.cardcasting.table;
  const sp = () => Number(c.spellPointTracker().current) || 0;
  const log = () => t().log.join('\n');
  const inHand = (id) => { if (!t().hand.includes(id)) { t().hand.push(id); t().deck = t().deck.filter((x) => x !== id); } };
  check('the drawback is read off the tradition', c.terrainCasting(), true);
  check('a costed card defaults to the point, an at-will one to the step', [c.terrainDefault(cards[0]), c.terrainDefault(cards[1])], ['sp', 'step']);
  check('the step walks the casting-time ladder', [stepCastingTime('standard action'), stepCastingTime('Swift Action'), stepCastingTime('10 minutes'), stepCastingTime('')], ['full-round action', 'immediate action', null, null]);
  c.tableStart();
  inHand('0#0'); inHand('1#0');
  check('the cast check counts the terrain point in the cost', [c.castCheck('0#0').need, c.castCheck('0#0').terrain, c.castCheck('1#0').need, c.castCheck('1#0').terrain], [2, 'sp', 0, 'step']);
  const before = sp();
  c.tablePlay('0#0', 'cast');
  check('a cast pays the card and the terrain point, and says so', [sp() - before, /Terrain Casting — one spell point more/.test(log())], [2, true]);
  const b2 = sp();
  c.tablePlay('1#0', 'cast');
  check('an at-will card pays nothing and is cast a step slower', [sp() - b2, /cast as a full-round action rather than a standard action/.test(log())], [0, true]);
  inHand('0#1');
  const b3 = sp();
  c.tablePlay('0#1', 'cast', { terrain: 'blight' });
  check('blight costs nothing now and is written down for the map', [sp() - b3, /blighted: dead magic for you/.test(log())], [1, true]);
  const html = subsystemPanels.cardcastingPanel(c, { deckView: 'table', openCards: new Set(), castPick: t().hand[0] || null });
  check('the table says the drawback is in force', /Terrain Casting: every cast pays one spell point more/.test(html), true);
  check('and the tradition panel does too', /Terrain Casting is in force/.test(combatPanels.renderMagicPanel(c)), true);
  // Drawback Freedom (Terrain Casting) as a mythic path ability -- here the
  // pick of an Extra Mythic Path Ability -- switches the drawback off.
  c.data.mythic.abilities[0] = { ...c.data.mythic.abilities[0], name: 'Extra Mythic Path Ability', featChoice: 'Drawback Freedom (Terrain Casting)' };
  c.recompute();
  inHand('0#2');
  const b4 = sp();
  c.tablePlay('0#2', 'cast');
  check('with Drawback Freedom for it, nothing pays the drawback', [c.terrainFreedom(), c.terrainDefault(cards[0]), c.castCheck('0#2').need, sp() - b4],
    ['Drawback Freedom (Terrain Casting), a mythic path ability', null, 1, 1]);
  check('and both panels say the ability ignores it', [/ignores it: no cast pays it/.test(subsystemPanels.cardcastingPanel(c, { deckView: 'table', openCards: new Set() })), /ignores it/.test(combatPanels.renderMagicPanel(c))], [true, true]);
  check('a copy taken for another drawback does not', (c.data.mythic.abilities[0].featChoice = 'Drawback Freedom (Card Casting)', c.recompute(), c.terrainFreedom()), '');
  c.data.training.magic.tradition.boughtOff = ['Terrain Casting'];
  c.recompute();
  check('bought off, the drawback is gone', [c.terrainCasting(), c.terrainDefault(cards[0]), c.castCheck('0#0').need], [false, null, 1]);
}

console.log('\na card moves between the deck and the sideboard, or is copied across; a subtitle names what it does');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 5 }));
  c.data.cardcasting.enabled = true;
  c.data.cardcasting.cards = [
    { name: 'Big Sky', subtitle: 'Explosive Orb (Fire Blast)', qty: 2, cost: '1', color: 'R', mana: '', sphere: 'Destruction', effect: 'Fire Blast (Explosive Orb) — a short effect', dice: '' },
    { name: 'Desert', qty: 1, cost: '1', color: 'R', mana: '', sphere: 'Destruction', effect: 'Fire Blast', dice: '' },
  ];
  c.data.cardcasting.sideboard = [{ name: 'Spare', cost: '2', color: 'U', mana: '', sphere: 'Mind', effect: 'Suggestion', dice: '' }];
  c.recompute();
  const deck = () => c.data.cardcasting.cards.map((x) => x.name);
  const side = () => c.data.cardcasting.sideboard.map((x) => x.name);
  check('a subtitle is the name\'s second half in the Roll20 text, and the effect a note of its own',
    [c.cardRollSpec('cardcasting.cards|0').name, c.cardRollSpec('cardcasting.cards|0').notes.some((n) => n.label === 'Effect')], ['Big Sky — Explosive Orb (Fire Blast)', true]);
  check('without one, a short effect still joins the name', c.cardRollSpec('cardcasting.cards|1').name, 'Desert — Fire Blast');
  check('to the sideboard', [c.moveCard('cardcasting.cards', 1, 'cardcasting.sideboard').ok, deck(), side()], [true, ['Big Sky'], ['Spare', 'Desert']]);
  check('back to the deck, with a copy to play', [c.moveCard('cardcasting.sideboard', 0, 'cardcasting.cards').ok, deck(), side(), c.data.cardcasting.cards[1].qty], [true, ['Big Sky', 'Spare'], ['Desert'], 1]);
  check('a copy leaves the original where it is, and carries no worked-out fields', [c.moveCard('cardcasting.cards', 0, 'cardcasting.sideboard', { copy: true }).ok, deck(), side(), 'calc' in c.data.cardcasting.sideboard[1]], [true, ['Big Sky', 'Spare'], ['Desert', 'Big Sky'], true]);
  check('and the copy is its own card', c.data.cardcasting.sideboard[1] !== c.data.cardcasting.cards[0] && c.data.cardcasting.sideboard[1].subtitle, 'Explosive Orb (Fire Blast)');
  check('the same list, or no such card, is refused', [c.moveCard('cardcasting.cards', 0, 'cardcasting.cards').ok, c.moveCard('cardcasting.cards', 9, 'cardcasting.sideboard').ok, c.moveCard('weapons', 0, 'cardcasting.sideboard').ok], [false, false, false]);
  c.tableStart();
  const held = c.moveCard('cardcasting.cards', 0, 'cardcasting.sideboard');
  check('while the deck is in play nothing leaves it, and the reason is given', [held.ok, /end the encounter/.test(held.why), deck()], [false, true, ['Big Sky', 'Spare']]);
  check('but a copy, and a card joining the deck, are fine', [c.moveCard('cardcasting.cards', 0, 'cardcasting.sideboard', { copy: true }).ok, c.moveCard('cardcasting.sideboard', 0, 'cardcasting.cards').ok, deck()], [true, true, ['Big Sky', 'Spare', 'Desert']]);
  const html = subsystemPanels.cardcastingPanel(c, { deckView: 'deck', openCards: new Set() });
  check('the face edits the subtitle and offers the move and the copy', [html.includes('data-item="cardcasting.cards|0|subtitle"'), html.includes('data-card-move="cardcasting.cards|0|cardcasting.sideboard|move" disabled'), html.includes('data-card-move="cardcasting.cards|0|cardcasting.sideboard|copy"'), html.includes('data-card-move="cardcasting.sideboard|0|cardcasting.cards|move" ')], [true, true, true, true]);
  c.data.cardcasting.table.hand = ['0#0'];
  check('and the small face shows the subtitle under the name', subsystemPanels.cardcastingPanel(c, { deckView: 'table', openCards: new Set() }).includes('<div class="bar sub subtitle"><span>Explosive Orb (Fire Blast)</span></div>'), true);
  c.tableEnd();
}

console.log('\nthe decklist: each card under its subtitle with its copies, and the magic talents the cards are');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 5 }));
  c.data.cardcasting.enabled = true;
  c.listAdd('training.magic.bonusTalents', { sphere: 'Destruction', talent: 'Fire Blast' });
  c.listAdd('training.magic.bonusTalents', { sphere: 'Destruction', talent: 'Explosive Orb' });
  c.listAdd('training.magic.bonusTalents', { sphere: 'Destruction', talent: 'Frost Blast' });
  c.data.cardcasting.cards = [
    { name: 'Big Sky', subtitle: 'Explosive Orb (Fire Blast)', qty: 2, cost: '1', color: 'R', effect: 'x', sphere: 'Destruction' },
    { name: 'Sun', subtitle: 'Explosive Orb (Fire Blast)', qty: 1, cost: '1', color: 'R', effect: 'x', sphere: 'Destruction' },
    { name: 'Fire Blast', qty: 3, cost: '1', color: 'R', effect: 'x', sphere: 'Destruction' },
    { name: 'Desert', qty: 1, cost: '2', color: 'RU', effect: 'x', sphere: 'Mind' },
    { name: '', qty: 4, cost: '', mana: 'R', effect: '' },
  ];
  c.recompute();
  const l = c.deckList();
  check('the counts: every copy, effects apart from Mana Points', [l.total, l.effects, l.mana], [11, 7, 4]);
  check('one line per subtitle, or name, with the copies summed', l.lines.map((x) => [x.label, x.qty, x.costs[0]]),
    [['Explosive Orb (Fire Blast)', 3, '1R'], ['Fire Blast', 3, '1R'], ['Desert', 1, '2RU']]);
  check('the magic talents tallied by the cards whose subtitle or name says them', l.talents.map((t) => [t.name, t.cards]),
    [['Fire Blast', 6], ['Explosive Orb', 3], ['Frost Blast', 0]]);
  check('a card naming no talent of theirs is listed as such', l.unmatched, [{ label: 'Desert', qty: 1 }]);
  check('the text to post', l.text.split('\n'), [
    'Dealer: 11 cards (7 effects, 4 Mana Points)',
    '3× Explosive Orb (Fire Blast) · 1R · Destruction', '3× Fire Blast · 1R · Destruction', '1× Desert · 2RU · Mind',
    'Mana Points: 4× R', '', 'Talents', '6× Fire Blast (Destruction)', '3× Explosive Orb (Destruction)',
    'No card: Frost Blast', 'No talent of theirs: Desert (1)']);
  check('"Blast" alone is not Fire Blast', (c.data.cardcasting.cards[3].subtitle = 'Blast', c.recompute(), c.deckList().unmatched.map((x) => x.label)), ['Blast']);
  const html = subsystemPanels.cardcastingPanel(c, { openCards: new Set(), openPosts: new Map() });
  check('the deck panel carries the list in a Copy box', /data-post="decklist"/.test(html) && /data-copy="decklist"/.test(html), true);
  check('every face\'s colour field holds its pips, the Mana Point card wearing its mana\'s', [(html.match(/class="colorcell filled" style="--n:2"/g) || []).length, (html.match(/class="colorcell"/g) || []).length], [5, 0]);
}

console.log('\nan ongoing card carries who it is affecting while it is in play');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 5 }));
  c.data.cardcasting.enabled = true;
  c.data.cardcasting.cards = [{ name: 'Slow', qty: 3, cost: '1', color: 'U', mana: '', sphere: 'Time', effect: 'Slow', dice: '' }];
  c.recompute();
  const t = () => c.data.cardcasting.table;
  c.tableStart();
  const id = t().hand[0];
  c.tablePlay(id, 'ongoing');
  check('the card is in play', t().play.includes(id), true);
  c.tableTargets(id, '  the ogre and both guards ');
  check('the targets are written beside it, trimmed', t().targets[id], 'the ogre and both guards');
  check('undo takes it back as one step, named for the card', [c.undo(), id in t().targets], ['Slow targets', false]);
  c.tableTargets(id, 'the ogre and both guards');
  const tab = subsystemPanels.cardcastingPanel(c, { deckView: 'table', openCards: new Set() });
  check('the tab draws a field to type them in', tab.includes(`data-table-targets="${id}"`) && tab.includes('value="the ogre and both guards"'), true);
  const screen = subsystemPanels.cardTableView(c, { openCards: new Set() }, 'table');
  check('the shared screen reads them, with no field', screen.includes('<small>targets</small> the ogre and both guards') && !screen.includes('data-table-targets'), true);
  c.tableTargets(id, '');
  check('blank clears them', id in t().targets, false);
  c.tableTargets(id, 'the ogre');
  c.tableMove(id, 'discard');
  check('and they go with the card when it leaves play', [t().play.includes(id), id in t().targets], [false, false]);
  check('a card not in play takes none', [c.tableTargets(t().hand[0] || '9#9', 'x'), Object.keys(t().targets).length], [c, 0]);
  check('an encounter starts with none', (c.tableEnd(), c.tableStart(), t().targets), {});
  c.tableEnd();
}

console.log('the Dice picker joins what it adds to what is there');
{
  check('a roll into an empty field', appendDiceText('', '{1+floor(caster.level/2)}d6'), '{1+floor(caster.level/2)}d6');
  check('a bonus onto a roll', appendDiceText('8d6', '+int.mod'), '8d6+int.mod');
  check('a bonus into an empty field loses its plus', appendDiceText('', '+int.mod'), 'int.mod');
  check('a second roll opens a new entry', appendDiceText('8d6+int.mod', '; boost (1 SP): '), '8d6+int.mod; boost (1 SP): ');
  check('a new entry into an empty field starts the field', appendDiceText('', '; boost (1 SP): '), 'boost (1 SP): ');
  check('a roll after an open label fills it', appendDiceText('damage: 8d6; boost (1 SP):', '15d6'), 'damage: 8d6; boost (1 SP): 15d6');
  check('a roll after a finished roll becomes a second one', appendDiceText('8d6', '{caster.level}d6'), '8d6; {caster.level}d6');
}

console.log('\na card\'s stat line: save, DC, range, target and damage types, each taking a formula');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 15 }));
  c.data.cardcasting.enabled = true;
  c.data.cardcasting.castingStat = 'Int';
  c.data.cardcasting.cards = [
    { name: 'Big Sky', qty: 2, cost: '1', color: 'R', sphere: 'Destruction', effect: 'Fire Blast', dice: '8d6',
      save: 'Ref', dc: '10 + floor(level/2) + int.mod', range: 'close', target: 'burst', duration: '{level} rounds', casting: 'standard action', damage: 'fire, cold' },
    { name: 'Desert', qty: 1, cost: '1', color: 'R', sphere: 'Destruction', effect: 'Fire Blast', dice: '' },
    { name: 'Touch', qty: 1, cost: '1', color: 'B', effect: 'Corpse Bomb', dc: '24', range: 'melee', target: '{= 2 + 3} targets', damage: 'negative energy' },
    { name: 'Far', qty: 1, cost: '1', color: 'U', effect: 'Push', dc: 'no.such.name', range: '{= 10 * level}', save: 'none' },
    { name: 'Plain', qty: 1, cost: '1', color: 'G', effect: 'Nothing special' },
  ];
  c.recompute();
  const cards = c.data.cardcasting.cards;
  const intMod = c.data.abilities.int.mod;
  const cl = c.scope().caster.level;
  const big = c.cardStats(cards[0]);
  check('a bare formula in the DC works out to a number', [big.dc, big.dcError], [String(17 + intMod), '']);
  check('a range word is feet for the caster level', [big.range, big.rangeFeet], ['close', 25 + 5 * Math.floor(cl / 2)]);
  check('damage types split on commas', big.damage, ['fire', 'cold']);
  check('the line as read: save and DC together, the range with its feet', c.cardStatLines(cards[0]),
    [['Save', `Reflex DC ${17 + intMod}`], ['Range', `close (${25 + 5 * Math.floor(cl / 2)} ft)`], ['Target', 'burst'], ['Duration', '15 rounds'], ['Casting time', 'standard action'], ['Damage type', 'fire, cold']]);
  check('and the Roll20 message carries it after the cost', c.cardRollSpec('cardcasting.cards|0').notes.map((n) => n.label),
    ['Cost', 'Save', 'Range', 'Target', 'Duration', 'Casting time', 'Damage type', 'Sphere']);
  const touch = c.cardStats(cards[2]);
  check('a number is a number, melee has no feet, an inline formula resolves in any field',
    [touch.dc, touch.rangeFeet, touch.target], ['24', null, '5 targets']);
  check('a DC alone is its own line', c.cardStatLines(cards[2])[0], ['DC', '24']);
  const far = c.cardStats(cards[3]);
  check('a DC that does not work out keeps its text and says why', [far.dc, far.dcError !== ''], ['no.such.name', true]);
  check('a range worked out to a number is feet', [far.rangeFeet, c.cardStatLines(cards[3]).find(([l]) => l === 'Range')], [150, ['Range', '150 ft']]);
  check('"none" is a save line of its own', c.cardStatLines(cards[3])[0], ['Save', 'none']);
  check('a card with none of it has nothing to say', [c.cardStats(cards[4]).any, c.cardStatLines(cards[4]), c.cardStats({}).any], [false, [], false]);
  check('every card carries the seven fields as text once read', CARD_STAT_FIELDS.map((f) => cards[4][f]), ['', '', '', '', '', '', '']);
  c.shareCardDice('cardcasting.cards', 0);
  check('"alike" hands the stat line on with the dice', CARD_STAT_FIELDS.map((f) => cards[1][f]),
    ['Ref', '10 + floor(level/2) + int.mod', 'close', 'burst', '{level} rounds', 'standard action', 'fire, cold']);
  check('and leaves a card with another effect alone', cards[2].save, '');
  const html = subsystemPanels.cardcastingPanel(c, { deckView: 'deck', openCards: new Set() });
  check('the face edits each field, with a pick list behind it',
    ['save', 'dc', 'range', 'target', 'duration', 'casting', 'damage'].map((f) => html.includes(`data-item="cardcasting.cards|0|${f}" data-kind="text" list="card-`)), [true, true, true, true, true, true, true]);
  check('and previews what differs from what was typed', [html.includes(`DC ${17 + intMod}</span>`), html.includes('Range close = ')], [true, true]);
  check('the pick lists are declared once', ['card-saves', 'card-dcs', 'card-ranges', 'card-targets', 'card-durations', 'card-casting-times', 'card-damage'].map((id) => html.split(`<datalist id="${id}"`).length - 1), [1, 1, 1, 1, 1, 1, 1]);
}

console.log('the damage type picker adds a word to the list once');
{
  check('a word into an empty field', appendListText('', 'fire'), 'fire');
  check('a second word joins with a comma', appendListText('fire', 'cold'), 'fire, cold');
  check('a word already there is not added twice', appendListText('fire, cold', 'Fire'), 'fire, cold');
  check('a trailing comma is tidied first', appendListText('fire, ', 'acid'), 'fire, acid');
}

console.log('\na card cast in a mode: that mode rolls, and the points put into it are spent');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 9 }));
  c.data.cardcasting.enabled = true;
  c.data.cardcasting.cards = [
    { name: 'Bolt', qty: 3, cost: '1', color: 'R', mana: '', effect: 'Fire Blast', sphere: 'Destruction', tags: '',
      dice: '0 SP: 5d6; boost (1 SP): 7d6; big (3 SP): 11d6' },
  ];
  const sp = c.addTracker({ name: 'Spell Points', maxFormula: '20' });
  c.recompute();
  let seed = 3;
  c.rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  c.tableStart();
  const t = () => c.data.cardcasting.table;
  const left = () => { const x = c.trackers.find((k) => k.id === sp.id); return x.max - x.current; };
  const before = left();
  c.tablePlay(t().hand[0], 'cast', { which: 'boost (1 SP)', sp: 1 });
  check('the picked mode is what rolled', [t().lastRoll.label, t().lastRoll.rolls.length], ['boost (1 SP)', 7]);
  check('the cost and the points on top both came off the tracker', before - left(), 2);
  check('and the log says what the extra was for', t().log.some((l) => /Bolt — boost \(1 SP\)/.test(l)), true);
  c.tablePlay(t().hand[0], 'cast', { which: 'BIG (3 SP)', sp: 3 });
  check('a mode is matched by name, whatever the case', t().lastRoll.rolls.length, 11);
  c.tableDraw(1);
  c.tablePlay(t().hand[0], 'cast');
  check('no mode picked: the first entry, as before', [t().lastRoll.label, t().lastRoll.rolls.length], ['0 SP', 5]);
  const spec = c.cardRollSpec('cardcasting.cards|0', 'boost (1 SP)');
  check('the Roll20 text for a mode is that roll alone, with the card\'s notes', [spec.rolls, spec.notes.length > 0], [[{ label: 'boost (1 SP)', formula: '7d6' }], true]);
  check('and with no mode, every roll', c.cardRollSpec('cardcasting.cards|0').rolls.length, 3);
}

console.log('Land-Attuned Magic: a Mana Point card pays two points on an attuned sphere');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 9 }));
  const p = c.data.cardcasting;
  p.enabled = true;
  p.manaPool = true;
  p.attunedSpheres = ['Destruction'];
  p.cards = [
    { name: 'Bolt', qty: 2, cost: '4', color: 'R', mana: '', effect: 'Fire Blast', sphere: 'Destruction', tags: '', dice: '' },
    { name: 'Hex', qty: 2, cost: '4', color: 'B', mana: '', effect: 'Curse', sphere: 'Death', tags: '', dice: '' },
    { name: 'Ember', qty: 4, cost: '', color: '', mana: 'R', effect: '', sphere: '', tags: '', dice: '' },
  ];
  c.recompute();
  check('without the feat the rule is off, and says why', [p.calc.landAttuned, p.calc.landAttunedWhy], [false, 'Land-Attuned Magic is not among the feats']);
  c.data.training.magic.tradition.boughtOff = ['Land-Attuned Magic [Deck]'];
  c.recompute();
  check('with it among the deck feats it still wants the tradition', p.calc.landAttunedWhy, 'Land-Attuned Magic wants Terrain Casting or Area Bound in the tradition');
  // Area Bound rather than Terrain Casting, so the costs here are the feat's alone.
  c.data.training.magic.tradition.drawbacks = ['Area Bound'];
  c.recompute();
  check('and then it is in force', p.calc.landAttuned, true);
  c.tableStart();
  const t = c.data.cardcasting.table;
  // Two mana in play, by hand, and the two effect cards in hand.
  t.hand = ['0#0', '1#0'];
  t.deck = t.deck.filter((id) => !['0#0', '1#0', '2#0', '2#1'].includes(id));
  t.mana = [{ id: '2#0', tapped: false }, { id: '2#1', tapped: false }];
  c.recompute();
  const bolt = c.data.cardcasting.table.calc.castable['0#0'];
  const hex = c.data.cardcasting.table.calc.castable['1#0'];
  check('an attuned card needs half the mana cards for its cost', [bolt.ok, bolt.need, bolt.spend, bolt.worth, bolt.why], [true, 4, 2, 2, 'attuned: each mana card pays two']);
  check('a card of another sphere still needs one per point', [hex.ok, hex.spend, hex.why], [false, 4, 'needs 4 mana in play, has 2']);
  p.mods.stagnantPool = true;
  c.recompute();
  c.tablePlay('0#0', 'cast');
  check('casting it under Stagnant Pool taps two cards for four points', c.data.cardcasting.table.mana.filter((m) => m.tapped).length, 2);
  check('and the log says so', c.data.cardcasting.table.log.some((l) => /cast for 4.*2 mana tapped \(attuned: two points each\)/.test(l)), true);
  // A sphere is matched however it is spaced or capitalised, as every other name is.
  p.attunedSpheres = ['  destruction '];
  c.recompute();
  check('an attuned sphere ticked in other spelling still matches', c.cardAttuned(c.data.cardcasting.cards[0]), true);
}

console.log('a monster block\'s prose is read like any note');
{
  const c = new Character(blankDocument({ name: 'Wyrmling', level: 4 }));
  c.data.monster = {
    ...emptyMonster(),
    senses: 'darkvision 60 ft. {skill.perception += 4}',
    specialAttacks: 'breath weapon (DC {breath.dc = 10 + 2})',
    tactics: 'opens with it {= breath.dc}',
  };
  c.recompute();
  const perception = c.data.skills.find((s) => s.name === 'Perception');
  check('a bonus in its senses lands', perception.forwarded, 4);
  check('a name defined in its special attacks reads elsewhere', c.inlineNames.breath?.dc ?? c.inlineNames['breath.dc'], 12);
  check('and the source is named as the field', describeSource('monster:senses'), 'the stat block’s senses');
  delete c.data.monster;
  c.recompute();
  check('without a block, nothing is read', c.data.skills.find((s) => s.name === 'Perception').forwarded, 0);
}

console.log('caster levels are separate until one is marked to count toward another');
{
  const c = new Character(blankDocument({ name: 'Theurge', level: 10 }));
  c.listAdd('vancian.classes', { name: 'Wizard', slotType: '', stat: 'Int', stat2: '', types: '', casterLevelOverride: 5, concentration: 0 });
  c.listAdd('psionics.classes', { name: 'Psion', stat: 'Int', stat2: '', curveTotal: 343, manifesterLevelOverride: 3, powers: [] });
  const levels = () => [c.data.vancian.classes[0].casterLevel, c.data.psionics.classes[0].manifesterLevel];
  check('each caster level the character has, by the name a bonus goes to',
    c.casterLevelSources().map((s) => [s.name, s.label]),
    [['vancian.wizard.cl', 'Wizard caster level'], ['manifester.psion.level', 'Psion manifester level']]);
  check('separate by default', levels(), [5, 3]);
  c.toggleCountsToward('vancian.wizard.cl', 'manifester.psion.level');
  check('the wizard\'s levels count toward the psion\'s, and not the other way', levels(), [5, 8]);
  c.toggleCountsToward('manifester.psion.level', 'vancian.wizard.cl');
  check('marked both ways, each counts its own levels once', levels(), [8, 8]);
  const reopened = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('the marks are saved and read back', [reopened.data.vancian.classes[0].casterLevel, reopened.data.psionics.classes[0].manifesterLevel], [8, 8]);
  check('the mark is listed as where the bonus comes from',
    c.contributions.entries.filter((e) => e.path.startsWith('transparency:')).map((e) => describeSource(e.path)),
    ['the Wizard caster level, marked to count toward this', 'the Psion manifester level, marked to count toward this']);
  c.toggleCountsToward('vancian.wizard.cl', 'manifester.psion.level');
  c.toggleCountsToward('manifester.psion.level', 'vancian.wizard.cl');
  check('taken off, they are separate again, and nothing is left saved', [levels(), 'countsToward' in c.data.vancian.classes[0]], [[5, 3], false]);
  c.toggleCountsToward('vancian.wizard.cl', 'vancian.wizard.cl');
  check('a level cannot count toward itself', 'countsToward' in c.data.vancian.classes[0], false);
}

console.log('every sub-system is one row: what it saves, whether it is in use, what a day gives back');
{
  const rows = subsystems();
  const tabs = new Set(rows.filter((s) => s.inUse).map((s) => s.tab));
  check('every tab a game system names has an in-use test',
    GAME_SYSTEMS.flatMap((s) => s.tabs).filter((t) => !tabs.has(t)), []);
  check('a block with worked-out fields names where it lives',
    rows.filter((s) => s.derived && !s.key).map((s) => s.tab), []);
  const c = new Character(blankDocument({ name: 'Rows', level: 5 }));
  check('the in-use map is the table, in its order',
    Object.keys(c.systemTabsInUse()), rows.filter((s) => s.inUse).map((s) => s.tab));
}

console.log('one walk over every feat on the character');
{
  const d = {
    featGroups: [{ name: 'Level Up', entries: [{ name: 'Adept Initiator' }, { name: '' }] }, { name: 'Other', entries: [{ name: 'Lucky Break [Chance]' }] }],
    grantedFeats: { drawback: { name: 'Card Shark [Deck]' }, specialty: null, others: [{ name: 'Toughness' }] },
  };
  check('the groups and the granted feats', featNames(d), ['Adept Initiator', '', 'Lucky Break [Chance]', 'Card Shark [Deck]', 'Toughness']);
  check('the groups alone', featNames(d, { granted: false }), ['Adept Initiator', '', 'Lucky Break [Chance]']);
  check('a document not yet normalised, its feats keyed by group', featNames({ feats: { General: [{ name: 'Dodge' }] } }), ['Dodge']);
  const c = new Character(blankDocument({ name: 'Feats', level: 3 }));
  c.data.featGroups[0].entries[0].name = 'Weapon Focus';
  c.data.grantedFeats = { others: [{ name: 'Weapon Focus (dagger)' }] };
  check('featCount counts both', c.featCount(/^weapon focus/i), 2);
}

console.log('\nMulti-Headed Play: a squad member brings its own deck, and casts on its own numbers');
{
  const c = new Character(blankDocument({ name: 'Dealer', level: 15 }));
  const p = c.data.cardcasting;
  Object.assign(p, { enabled: true, manaPool: true, cooldown: true, colors: 'RBU', castingStat: 'Int' });
  p.mods.coloredMana = 3;
  p.mods.stagnantPool = true;
  c.addCompanion('conjured');
  const cc = c.data.conjured.at(-1);
  Object.assign(cc, { name: 'Lira', archetypes: { mage: true }, talents: [{ name: 'Magical Companion' }], levelSource: 'override', levelOverride: 12 });
  cc.tradition = { name: 'Fey', drawbacks: ['Card Casting', 'Cooldown', 'Mana Pool', 'Stagnant Pool', 'Colored Mana (WG)', 'Verbal Casting'], boons: [] };
  p.cards = [
    { name: 'Bolt', qty: 20, cost: '1', color: 'R', mana: '', effect: 'Fire Blast', sphere: 'Destruction', tags: '', dice: '{1+floor(caster.level/2)}d6+caster.mod' },
    { name: 'Mend', qty: 10, cost: '1', color: 'W', mana: '', effect: 'Cure', sphere: 'Life', tags: '', dice: '{caster.level}d8+caster.mod', owner: cc.id },
    { name: 'Bloom', qty: 10, cost: '1', color: 'G', mana: '', effect: 'Grow', sphere: 'Enhancement', tags: '', dice: '', owner: cc.id },
    { name: 'Leaf', qty: 4, cost: '', color: '', mana: 'G', effect: '', sphere: '', tags: '', dice: '', owner: cc.id },
    { name: 'Ghost', qty: 1, cost: '1', color: 'B', mana: '', effect: 'Haunt', sphere: 'Death', tags: '', dice: '', owner: 'nobody' },
  ];
  c.recompute();
  let k = p.calc;
  const lira = k.squad.find((m) => m.id === cc.id);
  check('the companion is a squad member: Card Casting, the same switches, its own colours', [lira.ok, lira.why, lira.colors, lira.casts, lira.cl], [true, '', 'WG', true, cc.calc.casting.cl]);
  check('its deck is checked on its own, and two colours is not a Colored Mana the rule allows', [lira.deck.deckSize, lira.deck.effectCards, lira.deck.issues], [24, 20, ['Colored Mana names 2 colours; the rule wants three or five.']]);
  check('the character\'s own figures are the character\'s deck alone', [k.deckSize, k.colorsInPlay], [21, 'RBU']);
  check('a card owned by nobody on the sheet is the character\'s, and said so', [c.cardOwner(p.cards[4]), k.issues.some((i) => /no longer on the sheet/.test(i))], ['', true]);
  check('the combined deck is everything', [k.combined.deckSize, k.combined.colors, k.combined.members], [45, 'RBUWG', 1]);

  cc.tradition.drawbacks = ['Card Casting', 'Cooldown', 'Colored Mana (WG)'];
  c.recompute();
  check('a switch missing keeps the decks apart', [p.calc.squad.at(-1).ok, p.calc.squad.at(-1).why], [false, 'switches differ: Mana Pool missing, Stagnant Pool missing']);
  cc.tradition.drawbacks = ['Card Casting', 'Cooldown', 'Mana Pool', 'Stagnant Pool', 'Colored Mana (WG)'];
  c.recompute();
  k = p.calc;

  let seed = 7;
  c.rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  check('before the member is at the table only the character\'s cards shuffle', c.tableInstances().length, 21);
  c.tableSquad(cc.id, true);
  check('at the table, its cards come too', [c.tableInstances().length, p.table.squad], [45, [cc.id]]);
  c.tableStart();
  const t = p.table;
  const mend = [...t.deck, ...t.hand].find((id) => id.startsWith('1#'));
  c.tableMove(mend, 'hand');
  const leaf = [...t.deck, ...t.hand].find((id) => id.startsWith('3#'));
  c.tableMove(leaf, 'mana');
  const pool = () => { const x = c.trackers.find((tr) => tr.pool === `sp:${cc.id}`); return x.max - x.current; };
  const mine = () => { const x = c.trackers.find((tr) => tr.pool === 'sp'); return x ? x.max - x.current : null; };
  const before = [pool(), mine()];
  const ownCl = c.scope().caster.level;
  check('a member\'s card previews on the character\'s level and modifier, who casts by default', c.cardRollFormulas(c.tableCard(mend)).map((r) => r.formula), [`${ownCl ? `${ownCl}d8` : '0'}${k.cam ? `+${k.cam}` : ''}`]);
  check('and as the member would cast it, on the member\'s', c.cardRollFormulas(c.tableCard(mend), cc.id).map((r) => r.formula), [`${lira.cl}d8${lira.mod ? `+${lira.mod}` : ''}`]);
  c.tablePlay(mend, 'cast');
  check('cast with no caster named, the character casts a borrowed card: the member\'s pool is untouched, no name in the log', [pool() === before[0], t.lastRoll.whoName, t.log.some((l) => /^R1: Mend cast for 1/.test(l))],
    [true, '', true]);
  const spec = c.cardRollSpec(mend, null, cc.id);
  check('the Roll20 text names a member casting', spec.notes.find((n) => n.label === 'Cast by').text, `Lira (CL ${lira.cl})`);
  check('and not the character', c.cardRollSpec(mend).notes.some((n) => n.label === 'Cast by'), false);

  // The member casting, when the chooser says so: its numbers, its pool, its name.
  const bloom = [...t.deck, ...t.hand].find((id) => id.startsWith('2#'));
  c.tableMove(bloom, 'hand');
  c.tablePlay(bloom, 'cast', { who: cc.id });
  check('a member casts when named: its points, its name in the log', [before[0] - pool(), mine() === before[1], t.log.some((l) => /^R1: Lira: Bloom cast for 1/.test(l))], [1, true, true]);

  // Land-Attuned Magic is the character's: a member casting gets no double.
  p.attunedSpheres = ['Life'];
  c.data.training.magic.tradition.boughtOff = ['Land-Attuned Magic [Deck]'];
  c.data.training.magic.tradition.drawbacks = ['Terrain Casting'];
  c.recompute();
  const mend2 = [...t.deck].find((id) => id.startsWith('1#'));
  c.tableMove(mend2, 'hand');
  check('attuned mana pays double for the character but not for the member', [c.castCheck(mend2, '').worth, c.castCheck(mend2, cc.id).worth, c.castCheck(mend2).caster], [2, 1, '']);

  c.tableSquad(cc.id, false);
  check('when the member leaves, every card of its goes with it', [t.hand.some((id) => c.cardOwner(c.tableCard(id)) === cc.id), t.deck.some((id) => c.cardOwner(c.tableCard(id)) === cc.id), t.mana.length, t.log.at(-1).startsWith('R1: Lira leaves')], [false, false, 0, true]);
  c.tableSquad(cc.id, true);
  check('and comes back shuffled in when it returns', [t.deck.filter((id) => c.cardOwner(c.tableCard(id)) === cc.id).length > 0, t.log.at(-1)], [true, 'R1: Lira joins: 24 cards shuffled in']);

  // Rainbow Efficiency is read per deck: the member's own feat discounts the
  // member's cards, the character's feat the character's.
  cc.feats = [{ source: '1 HD', name: 'Rainbow Efficiency', notes: '' }];
  p.cards.push(
    { name: 'Dawn', qty: 1, cost: '3', color: 'WG', mana: '', effect: 'Bless', sphere: 'Life', tags: '', dice: '', owner: cc.id },
    { name: 'Dusk', qty: 1, cost: '2', color: 'RB', mana: '', effect: 'Curse', sphere: 'Death', tags: '', dice: '', owner: '' },
    { name: 'Ruby', qty: 1, cost: '', color: '', mana: 'R', effect: '', sphere: '', tags: '', dice: '', owner: '' },
    { name: 'Onyx', qty: 1, cost: '', color: '', mana: 'B', effect: '', sphere: '', tags: '', dice: '', owner: '' },
    { name: 'Alloy', qty: 1, cost: '', color: '', mana: 'RB', effect: '', sphere: '', tags: '', dice: '', owner: '' },
  );
  c.recompute();
  const dawn = () => p.cards.find((x) => x.name === 'Dawn').calc;
  const dusk = () => p.cards.find((x) => x.name === 'Dusk').calc;
  check('the member\'s two-colour card is discounted by its own feat', [p.calc.squad.find((m) => m.id === cc.id).rainbow, dawn().cost, dawn().discount], [1, 2, 1]);
  check('the character\'s is not, without the feat, and is flagged', [dusk().cost, dusk().rainbow, p.calc.issues.some((i) => /more than 1 colour/.test(i))], [2, 0, true]);
  c.data.training.magic.tradition.boughtOff = ['Rainbow Efficiency [Deck]'];
  c.recompute();
  check('with the feat the character\'s card costs one less', [dusk().cost, dusk().discount, dusk().rainbow], [1, 1, 1]);
  p.cards.find((x) => x.name === 'Dusk').color = 'RBU';
  p.cards.find((x) => x.name === 'Dusk').cost = '5';
  c.recompute();
  check('a third colour takes nothing more off without Improved', dusk().cost, 4);
  c.data.training.magic.tradition.boughtOff = ['Rainbow Efficiency [Deck]', 'Rainbow Efficiency, Improved [Deck]'];
  c.recompute();
  check('Improved takes one more off per colour past the second', [dusk().cost, dusk().rainbow], [3, 2]);
  p.cards.find((x) => x.name === 'Dusk').cost = '2';
  c.recompute();
  check('to a minimum of one less than the colours', dusk().cost, 2);
  // At the table: mana of each colour, and under Improved one card a colour.
  // Terrain Casting's toll is set aside so the cost read is the card's own.
  p.cards.find((x) => x.name === 'Dusk').color = 'RB';
  c.data.training.magic.tradition.drawbacks = [];
  c.recompute();
  c.tableEnd();
  c.tableStart();
  const find = (name) => [...t.deck, ...t.hand, ...t.mana.map((m) => m.id)].find((id) => c.tableCard(id).name === name);
  const duskId = find('Dusk');
  c.tableMove(duskId, 'hand');
  for (const id of [...t.mana.map((m) => m.id)]) c.tableMove(id, 'deck');
  c.tableMove(find('Alloy'), 'mana');
  check('one two-colour Mana Point card is not a card for each colour under Improved', [c.castCheck(duskId).ok, c.castCheck(duskId).why], [false, 'needs a Mana Point card for each colour (RB), one colour a card']);
  c.tableMove(find('Ruby'), 'mana');
  check('a card for each colour is', [c.castCheck(duskId).ok, c.castCheck(duskId).need, c.castCheck(duskId).why], [true, 1, 'Rainbow Efficiency: 1 off']);
  c.data.training.magic.tradition.boughtOff = ['Rainbow Efficiency [Deck]'];
  c.recompute();
  c.tableMove(find('Ruby'), 'deck');
  check('without Improved the two-colour card covers both colours', [c.castCheck(duskId).ok, c.castCheck(duskId).why], [true, 'Rainbow Efficiency: 1 off']);
  check('the Roll20 text says what is paid and why', c.cardRollSpec(duskId).notes.find((n) => n.label === 'Cost').text, '1 SP (2 less 1 for Rainbow Efficiency) (Red/Black)');

  // Manipulations are per member: its own picks against its own deck feats,
  // checked against its own switches, usable at the table while it is there.
  cc.feats = [{ source: '1 HD', name: 'Rainbow Efficiency [Deck]', notes: '' }, { source: '3 HD', name: 'Card Shark [Deck]', notes: '' }];
  c.listAdd('cardcasting.manipulations', { group: 'General', name: 'Mulligan', note: '', count: 1, owner: cc.id });
  c.listAdd('cardcasting.manipulations', { group: 'General', name: 'Trimmed Deck', note: '', count: 1, owner: cc.id });
  const member = () => p.calc.squad.find((m) => m.id === cc.id);
  check('a member\'s picks count against its own deck feats, and two for Card Shark', [member().manipulationsTaken, member().manipulationsAvailable, member().manipulationsLeft], [2, 3, 1]);
  cc.feats = [{ source: '3 HD', name: 'Card Shark', notes: '' }];
  c.recompute();
  check('Card Shark counts two whether or not it is tagged [Deck]', member().manipulationsAvailable, 2);
  cc.feats = [{ source: '3 HD', name: 'Card Shark', notes: '' }, { source: '5 HD', name: 'Card Shark [Deck]', notes: '' }, { source: '7 HD', name: 'Card Shark', notes: '' }];
  c.recompute();
  check('and two more each further time it is taken', member().manipulationsAvailable, 6);
  cc.feats = [{ source: '1 HD', name: 'Rainbow Efficiency [Deck]', notes: '' }, { source: '3 HD', name: 'Card Shark [Deck]', notes: '' }];
  c.recompute();
  check('and not against the character\'s', p.calc.manipulationsTaken, 0);
  manipulationCheck('a pick wanting a switch the member lacks is the member\'s issue', [p.manipulations.at(-1).calc.unmet, member().deck.issues.some((i) => /Trimmed Deck needs Singleton/.test(i)), p.calc.issues.some((i) => /Trimmed Deck/.test(i))], [['singleton'], true, false]);
  check('the member\'s Mulligan is usable at the table while it is present', [hasManipulation(c, 'Mulligan'), hasManipulation(c, 'Mulligan', ''), hasManipulation(c, 'Mulligan', cc.id)], [true, false, true]);
  c.tableSquad(cc.id, false);
  check('and not once it has left', hasManipulation(c, 'Mulligan'), false);
  check('the scope reads the character\'s picks alone', c.scope().deck.manip.mulligan, undefined);
  c.listAdd('cardcasting.manipulations', { group: 'General', name: 'Mulligan', note: '', count: 1, owner: '' });
  check('the character\'s own Mulligan counts, present member or not', [hasManipulation(c, 'Mulligan'), c.scope().deck.manip.mulligan], [true, 1]);
  // Each copy of a pick is given on its own: one Fused Cards to the member, two kept.
  c.listAdd('cardcasting.manipulations', { group: 'General', name: 'Fused Cards', note: '', count: 3, owner: '' });
  const fused = () => p.manipulations.map((m, i) => ({ m, i })).filter(({ m }) => m.name === 'Fused Cards');
  c.moveManipulationPick(fused()[0].i, cc.id);
  check('moving one copy splits the row: two stay, one goes', fused().map(({ m }) => [m.owner, m.count]), [['', 2], [cc.id, 1]]);
  c.moveManipulationPick(fused()[0].i, cc.id);
  check('a second copy joins the member\'s row', fused().map(({ m }) => [m.owner, m.count]), [['', 1], [cc.id, 2]]);
  c.moveManipulationPick(fused()[1].i, '');
  check('and one back again', fused().map(({ m }) => [m.owner, m.count]), [['', 2], [cc.id, 1]]);
  c.moveManipulationPick(fused()[1].i, '');
  check('the last copy of a row joins the owner\'s row and the row goes', fused().map(({ m }) => [m.owner, m.count]), [['', 3]]);
  check('the member\'s count follows its copies', member().manipulationsTaken, 2);

  // A GM holding the member may act on its cards alone, and casts as it.
  c.tableSquad(cc.id, true);
  const mendId = [...t.deck, ...t.hand, ...t.discard].find((id) => id.startsWith('1#'));
  const boltId = [...t.deck, ...t.hand, ...t.discard].find((id) => id.startsWith('0#'));
  check('the GM may play, move, roll and resolve the member\'s cards', ['play', 'move', 'roll', 'resolve', 'targets', 'pick'].map((a) => remoteAllowed(c, cc.id, a, mendId)), [true, true, true, true, true, true]);
  check('and not the character\'s, nor drive the round, peek, or spend the character\'s points', [remoteAllowed(c, cc.id, 'play', boltId), remoteAllowed(c, cc.id, 'next', mendId), remoteAllowed(c, cc.id, 'start', ''), remoteAllowed(c, cc.id, 'peek', mendId), remoteAllowed(c, cc.id, 'sp', mendId), remoteAllowed(c, cc.id, 'exileRandom', mendId), remoteAllowed(c, '', 'play', mendId), remoteAllowed(c, cc.id, 'play', 'no#such')], [false, false, false, false, false, false, false, false]);
  check('a GM\'s cast is the member\'s cast', remotePlayArg('cast?mode=big&sp=1', cc.id), `cast?mode=big&sp=1&who=${cc.id}`);
  check('even with no argument, and whoever the page named', [remotePlayArg('', cc.id), remotePlayArg('ongoing?who=', cc.id)], [`cast?who=${cc.id}`, `ongoing?who=${cc.id}`]);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
