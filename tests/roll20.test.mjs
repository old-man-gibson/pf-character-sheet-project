/** Tests the Roll20 export: the strings the d20 buttons put on the clipboard.
 *
 *  Runs in full without the private fixtures -- the characters here are built
 *  from `blankDocument`, the converter's own output for an empty template, so
 *  the model computes their weapons and conditions exactly as it does a real
 *  one. The fixture roster, when it is present, is then swept for rolls that
 *  come out malformed.
 *
 *  Run: node tests/roll20.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { hasFixtures, fixtureIds, loadCharacter } from './fixtures.mjs';
import { attackModeTotal } from '../app/js/rules.js';
import {
  ROLL_FORMATS, DEFAULT_ROLL_FORMAT, escapeRoll20, d20, damageFormula,
  rollText, rollSpec, roll20Text,
  abilityRollSpec, saveRollSpec, attackRollSpec, skillRollSpec, weaponRollSpec,
  initiativeRollSpec, concentrationRollSpec, companionRollSpec,
} from '../app/js/roll20.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const ok = (label, actual) => check(label, !!actual, true);

console.log('names are made safe -- chat resolves these before it prints');
check('braces', escapeRoll20('a {b} c'), 'a &#123;b&#125; c');
check('brackets close an inline roll', escapeRoll20('Longsword [holy]'), 'Longsword &#91;holy&#93;');
check('an ampersand is escaped once', escapeRoll20('Bow & Blade'), 'Bow &#38; Blade');
check('a pipe would split a query', escapeRoll20('a|b'), 'a&#124;b');
check('at, percent, question, tilde', escapeRoll20('@%?~'), '&#64;&#37;&#63;&#126;');
check('newlines collapse', escapeRoll20('two\n  lines'), 'two lines');
check('nothing is empty', escapeRoll20(null), '');
check('an ordinary name is untouched', escapeRoll20('Perception'), 'Perception');

console.log('the die itself');
check('a bonus', d20(12), '1d20+12');
check('a penalty', d20(-1), '1d20-1');
check('nothing to add', d20(0), '1d20');
check('rounded', d20(4.6), '1d20+5');
check('a threat range becomes cs>', d20(18, { critRange: 19 }), '1d20cs>19+18');
check('a natural 20 needs no cs>', d20(18, { critRange: 20 }), '1d20+18');
check('dice ride along', d20(18, { dice: { 6: 1 } }), '1d20+18+1d6');
check('negative dice keep their sign', d20(18, { dice: { 6: -1 } }), '1d20+18-1d6');
check('an empty dice map adds nothing', d20(18, { dice: {} }), '1d20+18');
check('dice with a threat range', d20(18, { dice: { 6: 1 }, critRange: 19 }), '1d20cs>19+18+1d6');
check('damage', damageFormula({ 6: 2 }, 7), '2d6+7');
check('damage with no dice', damageFormula({}, 7), '7');
check('damage with no bonus', damageFormula({ 6: 2 }, 0), '2d6');

console.log('the two shapes a spec comes out in');
{
  const one = { name: 'Perception', rolls: [{ label: 'Skill check', formula: '1d20+12' }], notes: [] };
  check('template', rollText(one, 'template'),
    '&{template:default} {{name=Perception}} {{Skill check=[[1d20+12]]}}');
  check('plain', rollText(one, 'plain'), '/roll 1d20+12 Perception');
  check('the default format is the template', rollText(one), rollText(one, 'template'));

  const noted = { ...one, notes: [{ label: 'Note', text: '+2 in dim light' }] };
  check('a note is a template row', rollText(noted, 'template'),
    '&{template:default} {{name=Perception}} {{Skill check=[[1d20+12]]}} {{Note=+2 in dim light}}');
  check('a note is a parenthesis in plain', rollText(noted, 'plain'),
    '/roll 1d20+12 Perception (Note: +2 in dim light)');

  const many = {
    name: 'Greatsword',
    rolls: [{ label: 'Attack', formula: '1d20+16' }, { label: 'Damage', formula: '2d6+7' }],
    notes: [],
  };
  check('several rolls, template', rollText(many, 'template'),
    '&{template:default} {{name=Greatsword}} {{Attack=[[1d20+16]]}} {{Damage=[[2d6+7]]}}');
  // Several /roll commands cannot share one message, so plain falls back to
  // inline rolls -- which do.
  check('several rolls, plain', rollText(many, 'plain'),
    'Greatsword: Attack [[1d20+16]], Damage [[2d6+7]]');
  check('nothing to roll is nothing to paste', rollText({ name: 'x', rolls: [] }), '');
  check('no spec at all', rollText(null), '');
  check('every advertised format is one rollText knows',
    ROLL_FORMATS.map(([k]) => rollText(one, k)).every((s) => s.includes('1d20+12')), true);
  check('the default is one of them', ROLL_FORMATS.some(([k]) => k === DEFAULT_ROLL_FORMAT), true);
}

/* ------------------------------------------------------------------ *
 * Specs, off hand-built characters -- the arithmetic, in isolation
 * ------------------------------------------------------------------ */

console.log('a spec reads the totals the sheet shows');
{
  const c = {
    identity: { name: 'Angou' },
    abilities: { str: { totalMod: 4 }, dex: { totalMod: 2 }, wis: { totalMod: 3 } },
    saves: { fortitude: { total: 9 }, reflex: { total: 7 }, will: { total: 11 } },
    attack: { bab: 11, totalMelee: 18, totalRanged: 14, totalCmb: 16 },
    skills: [
      { name: 'Perception', spec: null, bonus: 12, abilities: ['Wis'], totalRanks: 9 },
      {
        name: 'Craft', spec: 'Weapons', bonus: 8, abilities: ['Int'], totalRanks: 0,
        requiresTraining: true, situational: '+2 with a whetstone',
      },
    ],
  };
  check('the character is named first',
    abilityRollSpec(c, 'str').name, 'Angou — Str check');
  check('an ability check is its modifier',
    rollText(abilityRollSpec(c, 'str'), 'plain'), '/roll 1d20+4 Angou — Str check');
  check('an unknown ability is not a roll', abilityRollSpec(c, 'luck'), null);
  check('a save', rollText(saveRollSpec(c, 'will'), 'plain'), '/roll 1d20+11 Angou — Will save');
  check('an unknown save is not a roll', saveRollSpec(c, 'sanity'), null);

  check('a skill reads its own bonus, not its ranks',
    rollText(skillRollSpec(c, 0), 'plain'), '/roll 1d20+12 Angou — Perception');
  check('a variant skill is named whole', skillRollSpec(c, 1).name, 'Angou — Craft (Weapons)');
  check('a skill carries its situational note and its training gate',
    skillRollSpec(c, 1).notes,
    [{ label: 'Note', text: '+2 with a whetstone' },
      { label: 'Trained only', text: 'no ranks in this skill' }]);
  check('a skill that is not there is not a roll', skillRollSpec(c, 99), null);

  // The iteratives step down from the attack in full, not from the BAB: a
  // BAB of 11 that lands at +18 is +18/+13/+8, never +11/+6/+1.
  check('iteratives step from the total', attackRollSpec(c, 'melee').rolls.map((r) => r.formula),
    ['1d20+18', '1d20+13', '1d20+8']);
  check('and are numbered once there is more than one',
    attackRollSpec(c, 'melee').rolls.map((r) => r.label), ['Attack 1', 'Attack 2', 'Attack 3']);
  check('a maneuver does not iterate',
    attackRollSpec(c, 'cmb').rolls, [{ label: 'Maneuver', formula: '1d20+16' }]);
  check('an unknown mode is not a roll', attackRollSpec(c, 'bite'), null);

  const low = { ...c, attack: { bab: 0, totalMelee: 3, totalRanged: 1, totalCmb: 2 } };
  check('no BAB is still one attack',
    attackRollSpec(low, 'melee').rolls, [{ label: 'Attack', formula: '1d20+3' }]);

  const nameless = { ...c, identity: {} };
  check('an unnamed character just says what it rolled',
    saveRollSpec(nameless, 'reflex').name, 'Reflex save');
}

console.log('an alternate is the same attack with a different ability in the slot');
{
  const c = {
    identity: { name: 'Angou' },
    abilities: {
      str: { totalMod: 4 }, dex: { totalMod: 8 }, wis: { totalMod: 2 }, cha: { totalMod: 0 },
    },
    attack: {
      bab: 11,
      totalMelee: 18,
      totalRanged: 14,
      totalCmb: 16,
      modes: {
        melee: { stat1: 'Str' }, altMelee: { stat1: 'Dex' },
        ranged: { stat1: 'Dex' }, altRanged: { stat1: 'Str' },
        cmb: { stat1: 'Str' }, altCmb: { stat1: 'Dex' },
      },
    },
  };
  // Melee is +18 on a +4 Str; the same attack on a +8 Dex is +22. Everything
  // else -- BAB, misc, size, the import offset -- is shared, so only the
  // modifier moves.
  check('alt melee swaps the modifier', attackModeTotal(c, 'altMelee'), 22);
  check('alt ranged swaps it back', attackModeTotal(c, 'altRanged'), 10);
  check('alt cmb too', attackModeTotal(c, 'altCmb'), 20);
  check('a stored mode is read, not recomputed', attackModeTotal(c, 'melee'), 18);
  check('anything else is not a mode', attackModeTotal(c, 'bite'), null);

  check('and it iterates like the attack it alternates',
    attackRollSpec(c, 'altMelee').rolls.map((r) => r.formula),
    ['1d20+22', '1d20+17', '1d20+12']);
  // The ability is the whole difference between the two, so the title says it.
  check('the title names the ability', attackRollSpec(c, 'altMelee').name,
    'Angou — Melee attack (Dex)');
  check('a primary mode does not need to', attackRollSpec(c, 'melee').name,
    'Angou — Melee attack');
  check('an alt maneuver still does not iterate',
    attackRollSpec(c, 'altCmb').rolls, [{ label: 'Maneuver', formula: '1d20+20' }]);
  check('two abilities in one slot are both named',
    attackRollSpec({ ...c, attack: { ...c.attack, modes: { ...c.attack.modes, altMelee: { stat1: 'Dex', stat2: 'Wis' } } } }, 'altMelee').name,
    'Angou — Melee attack (Dex + Wis)');
}

console.log('initiative, and the two places a concentration check lives');
{
  const c = {
    identity: { name: 'Angou' },
    hp: { initiative: 9 },
    training: { magic: { concentration: 17, globalCL: 14 } },
    vancian: { classes: [{ name: 'Oracle', concentration: 21, casterLevel: 11 }, { concentration: 4 }] },
  };
  check('initiative', rollText(initiativeRollSpec(c), 'plain'), '/roll 1d20+9 Angou — Initiative');
  check('a sheet with no hit points block is not a roll', initiativeRollSpec({}), null);

  check('the Spheres side has one global figure',
    rollText(concentrationRollSpec(c, 'magic'), 'template'),
    '&{template:default} {{name=Angou — Concentration}} {{Concentration=[[1d20+17]]}} {{Caster level=14}}');
  check('a prepared class has its own',
    rollText(concentrationRollSpec(c, 'vancian:0'), 'plain'),
    '/roll 1d20+21 Angou — Oracle concentration (Caster level: 11)');
  check('an unnamed class still rolls', concentrationRollSpec(c, 'vancian:1').name,
    'Angou — Concentration');
  check('a class that is not there is not a roll', concentrationRollSpec(c, 'vancian:9'), null);
  check('nor is a source that does not exist', concentrationRollSpec(c, 'psionics'), null);
  // Shaken and its kin are worded at attacks, saves, skills and ability checks.
  // A concentration check is none of those, so nothing here takes a delta.
  check('conditions do not reach it',
    concentrationRollSpec(c, 'magic').rolls[0].formula, '1d20+17');
}

console.log('the dispatcher covers every button on the sheet');
{
  const c = {
    identity: { name: 'A' },
    abilities: { con: { totalMod: 3 }, dex: { totalMod: 2 }, str: { totalMod: 1 } },
    saves: { fortitude: { total: 9 } },
    hp: { initiative: 4 },
    training: { magic: { concentration: 12, globalCL: 9 } },
    attack: {
      bab: 6,
      totalMelee: 9,
      totalRanged: 7,
      totalCmb: 8,
      modes: { ranged: { stat1: 'Dex' }, altRanged: { stat1: 'Str' } },
    },
    skills: [{ name: 'Stealth', bonus: 14, abilities: ['Dex'] }],
    equipment: { weapons: [{ name: 'Dagger', attackType: 'Melee', attackTotal: 9, critRange: 19 }] },
    familiar: { name: 'Hoot', calc: { saves: { will: { total: 7 } } } },
  };
  ok('ability', rollSpec(c, 'ability', 'con'));
  ok('save', rollSpec(c, 'save', 'fortitude'));
  ok('mode', rollSpec(c, 'mode', 'melee'));
  ok('alt mode', rollSpec(c, 'mode', 'altRanged'));
  ok('skill by index', rollSpec(c, 'skill', '0'));
  ok('weapon by index', rollSpec(c, 'weapon', '0'));
  ok('initiative', rollSpec(c, 'initiative', 'self'));
  ok('concentration', rollSpec(c, 'concentration', 'magic'));
  ok('a companion row', rollSpec(c, 'familiar', 'save:will'));
  check('an unknown kind is not a roll', rollSpec(c, 'nonsense', '0'), null);
  check('nor is a companion the character does not have',
    rollSpec(c, 'eidolon', 'init'), null);
  // A weapon added a moment ago has no costing yet, but it has an attack.
  check('an uncosted weapon still rolls its attack',
    rollText(rollSpec(c, 'weapon', 0), 'plain'), '/roll 1d20cs>19+9 A — Dagger');
  check('roll20Text is spec and text in one', roll20Text(c, 'save', 'fortitude', null, 'plain'),
    '/roll 1d20+9 A — Fortitude save');
}

/* ------------------------------------------------------------------ *
 * Against the live model
 * ------------------------------------------------------------------ */

/** A blank sheet with the bits a roll needs filled in, computed by the model. */
function built({ level = 11, weapons = [], conditions = {} } = {}) {
  const doc = blankDocument({ name: 'Test Subject', level });
  // Scores are built from point buy on a blank sheet; without the build they
  // are typed in, which is what this fixture wants.
  delete doc.statsBuild;
  doc.abilities.str = { ...doc.abilities.str, score: 18, tempScore: 18 };
  doc.abilities.dex = { ...doc.abilities.dex, score: 14, tempScore: 14 };
  doc.abilities.wis = { ...doc.abilities.wis, score: 16, tempScore: 16 };
  doc.attack.bab = 11;
  // A blank sheet's skills all read 0, so the model would hold each one there
  // with a reconciliation offset. Clearing it lets the rows say what they add
  // up to, which is what the buttons on them are for.
  for (const s of doc.skills) { s.offset = 0; s.importedBonus = 0; }
  doc.conditions = conditions;
  doc.equipment.weapons.push(...weapons);
  return new Character(doc);
}

const GREATSWORD = {
  name: 'Greatsword', attackType: 'Melee', dice: '2d6', damageAbility: 'Str', abilityMult: 1.5,
  miscDamage: 0, miscAttack: 0, enhancement: 1, critRange: 19, critMult: 'x2',
  damageType: 'S', groups: [], special: '', size: '', range: '', handedness: '',
  familiarity: '', ammunition: '', weight: 8, price: 50, attackOffset: 0,
};

console.log('a weapon the model has costed');
{
  const c = built({ weapons: [{ ...GREATSWORD }] });
  const spec = weaponRollSpec(c.data, 0, c.conditionState);
  const by = (label) => spec.rolls.find((r) => r.label.startsWith(label))?.formula;
  // BAB 11 + Str 4 + enhancement 1; damage 2d6 + floor(4 × 1.5) + 1.
  check('the attack carries the threat range', by('Attack 1'), '1d20cs>19+16');
  check('iteratives keep the threat range', spec.rolls.filter((r) => r.label.startsWith('Attack'))
    .map((r) => r.formula), ['1d20cs>19+16', '1d20cs>19+11', '1d20cs>19+6']);
  check('damage', by('Damage'), '2d6+7');
  check('the confirmation is the attack again', by('Crit confirm'), '1d20cs>19+16');
  check('a x2 crit rolls it all twice', by('Crit damage'), '4d6+14');
  check('the threat is written out',
    spec.notes.find((n) => n.label === 'Threat')?.text, '19-20/x2');
  check('and so is the damage type',
    spec.notes.find((n) => n.label === 'Damage type')?.text, 'S');
}

console.log('what a critical multiplies, and what it does not');
{
  // {{…}} adds to hit, [[…]] adds damage, and a trailing Crit makes a token
  // crit-only. Riders are added once; the weapon's own damage multiplies.
  const c = built({
    weapons: [{
      ...GREATSWORD, critMult: 'x3', critRange: 20,
      special: '{{1d6}} guiding, [[2d6]] flaming, [[1d6 Crit]] holy',
    }],
  });
  const spec = weaponRollSpec(c.data, 0, c.conditionState);
  const by = (label) => spec.rolls.find((r) => r.label.startsWith(label))?.formula;
  check('a to-hit token rides on the attack', by('Attack 1'), '1d20+16+1d6');
  // Dice are held by size, so a d6 rider joins the greatsword's own d6s.
  check('an untagged damage token is in the damage', by('Damage'), '4d6+7');
  // 2d6 base ×3 = 6d6, +7 flat ×3 = 21, the 2d6 rider once, the 1d6 Crit ×3.
  check('base and crit-tagged multiply, riders do not', by('Crit damage'), '11d6+21');
  check('a x3 is worth saying', spec.notes.find((n) => n.label === 'Threat')?.text, '20/x3');
}

console.log('a Mult token multiplies with the weapon, a rider does not');
{
  // The two look alike on the row and are silently different on a crit, which
  // is the whole reason the keyword exists -- so the copied roll has to split
  // them the same way the card's crit line does.
  const c = built({
    weapons: [{ ...GREATSWORD, critRange: 20, special: '[[6 Mult]] holy, [[6]] flaming' }],
  });
  const spec = weaponRollSpec(c.data, 0, c.conditionState);
  const by = (label) => spec.rolls.find((r) => r.label.startsWith(label))?.formula;
  // Both are on every hit: 2d6 + 7 + 6 + 6.
  check('both land on a normal hit', by('Damage'), '2d6+19');
  // (2d6+7+6)×2 + 6 -- the Mult token goes inside the multiplier, the rider after.
  check('only one of them doubles', by('Crit damage'), '4d6+32');
}

console.log('a question the sheet cannot answer becomes a Roll20 query');
{
  // Deathgrip Gauntlets: spend your own blood for twice as much damage. The
  // amount is the player's to choose, and Mult means the multiplier takes it.
  const c = built({
    weapons: [{
      ...GREATSWORD,
      critRange: 20,
      special: '[[{?Deathgrip | Spend nothing, 0 | 1 HP, 2 | 1 + invested, 8} Mult]]',
    }],
  });
  const spec = weaponRollSpec(c.data, 0, c.conditionState);
  const by = (label) => spec.rolls.find((r) => r.label.startsWith(label))?.formula;
  const QUERY = '?{Deathgrip|Spend nothing, 0|1 HP, 2|1 + invested, 8}';
  check('the sheet prints the first answer and asks for the rest',
    by('Damage'), `2d6+7+${QUERY}`);
  // The multiplier goes outside the question, not inside each answer, so the
  // pool behaves on a threat exactly as the weapon's own damage does.
  check('the multiplier takes the answer, whatever it turns out to be',
    by('Crit damage'), `4d6+14+(${QUERY})*2`);
  check('and the roll says what it will ask',
    spec.notes.find((n) => n.label === 'Question')?.text,
    'Deathgrip — answer the same way each time you are asked');
  check('the questions are listed for a caller that would rather ask them',
    spec.queries.map((q) => q.label), ['Deathgrip']);

  // Answered here instead: the numbers go in, the question does not, and the
  // note goes with it -- there is nothing left to be asked.
  const settled = weaponRollSpec(c.data, 0, c.conditionState, { Deathgrip: 8 });
  const at = (label) => settled.rolls.find((r) => r.label.startsWith(label))?.formula;
  // Kept as its own term rather than folded into the flat part: an answer may
  // be dice, and a reader at the table can see which +8 came from the choice.
  check('an answer given here is just a number', at('Damage'), '2d6+7+8');
  check('and it multiplies as the number it is', at('Crit damage'), '4d6+14+16');
  check('nothing is left to ask', settled.notes.some((n) => n.label === 'Question'), false);

  // A question on the attack side needs a space inside the {{…}}, or the
  // token's own closing braces eat the question's. Worth a test: the broken
  // form looks right and fails quietly.
  const atk = built({
    weapons: [{
      ...GREATSWORD, critRange: 20, special: '{{ {?Power attack | No, 0 | Yes, -3} }}',
    }],
  });
  check('a question can move the attack roll',
    weaponRollSpec(atk.data, 0, atk.conditionState).rolls[0].formula,
    '1d20+16+?{Power attack|No, 0|Yes, -3}');
  check('and the confirmation carries it too, since it is the attack again',
    weaponRollSpec(atk.data, 0, atk.conditionState).rolls
      .find((r) => r.label === 'Crit confirm').formula,
    '1d20+16+?{Power attack|No, 0|Yes, -3}');
  const jammed = built({
    weapons: [{ ...GREATSWORD, critRange: 20, special: '{{{?Power attack | No, 0 | Yes, -3}}}' }],
  });
  check('jammed against the braces it is not a question at all',
    weaponRollSpec(jammed.data, 0, jammed.conditionState).queries, []);

  // The arithmetic around a question has to travel with it. This was wrong
  // once, and quietly: the sheet doubled its own total while the table was
  // handed an undoubled question, so the two disagreed and neither said so.
  const doubled = built({
    weapons: [{ ...GREATSWORD, critRange: 20, special: '[[{?Deathgrip Self-HP Damage|}*2 Mult]]' }],
  });
  const dbl = (label, given = null) => weaponRollSpec(doubled.data, 0, doubled.conditionState, given)
    .rolls.find((r) => r.label.startsWith(label))?.formula;
  check('a doubled question arrives doubled',
    dbl('Damage'), '2d6+7+(?{Deathgrip Self-HP Damage|0})*2');
  // Doubled by the gauntlets, then again by the critical -- two multipliers
  // that are two different rules, so they stay two.
  check('and the critical doubles it again',
    dbl('Crit damage'), '4d6+14+((?{Deathgrip Self-HP Damage|0})*2)*2');
  check('answered here, the arithmetic is simply done',
    [dbl('Damage', { 'Deathgrip Self-HP Damage': 3 }),
      dbl('Crit damage', { 'Deathgrip Self-HP Damage': 3 })],
    ['2d6+7+6', '4d6+14+12']);

  const free = built({
    weapons: [{ ...GREATSWORD, critRange: 20, special: '[[{?Extra damage | 0}]]' }],
  });
  check('a free number is Roll20’s other shape',
    weaponRollSpec(free.data, 0, free.conditionState).rolls
      .find((r) => r.label === 'Damage').formula, '2d6+7+?{Extra damage|0}');

  // A bar, a brace or a comma in a label is query syntax and would split the
  // question in two; nothing else needs escaping, and escaping it would only
  // put entities on the screen.
  const risky = built({
    weapons: [{ ...GREATSWORD, critRange: 20, special: '[[{?Spend, or not | No, 0 | Yes, 4}]]' }],
  });
  check('a comma in a label is escaped, and only that',
    weaponRollSpec(risky.data, 0, risky.conditionState).rolls
      .find((r) => r.label === 'Damage').formula,
    '2d6+7+?{Spend&#44; or not|No, 0|Yes, 4}');
}

console.log('an aside in the dice field is carried, not silently dropped');
{
  // "4d6 (8d6)" is what a kineticist's fist looks like on the sheet: the
  // parenthesis is a note about a second form, not something to roll.
  const c = built({ weapons: [{ ...GREATSWORD, dice: '4d6 (8d6)' }] });
  const spec = weaponRollSpec(c.data, 0, c.conditionState);
  check('only the rollable part is rolled',
    spec.rolls.find((r) => r.label === 'Damage').formula, '4d6+7');
  check('the field itself comes along',
    spec.notes.find((n) => n.label === 'Dice')?.text, '4d6 (8d6)');
  check('a plain dice field adds no such note',
    weaponRollSpec(built({ weapons: [{ ...GREATSWORD }] }).data, 0)
      .notes.some((n) => n.label === 'Dice'), false);
}

console.log('conditions move the roll, and say that they did');
{
  const clean = built({ weapons: [{ ...GREATSWORD }] });
  const shaken = built({ weapons: [{ ...GREATSWORD }], conditions: { Shaken: true } });
  const cs = shaken.conditionState;
  check('shaken is on', cs.active.map((a) => a.info.label), ['Shaken']);

  const before = saveRollSpec(clean.data, 'will', clean.conditionState);
  const after = saveRollSpec(shaken.data, 'will', cs);
  check('the save drops by two', [before.rolls[0].formula, after.rolls[0].formula],
    ['1d20+3', '1d20+1']);
  check('and says why', after.notes, [{ label: 'Conditions', text: 'Shaken (-2)' }]);
  check('an untouched roll says nothing',
    saveRollSpec(clean.data, 'will', clean.conditionState).notes, []);

  const skill = skillRollSpec(shaken.data, 0, cs);
  check('a skill check takes the same two', skill.notes,
    [{ label: 'Conditions', text: 'Shaken (-2)' }]);
  check('an attack too', weaponRollSpec(shaken.data, 0, cs).rolls[0].formula, '1d20cs>19+14');
  check('and an ability check', abilityRollSpec(shaken.data, 'str', cs).rolls[0].formula, '1d20+2');
}

console.log('a condition that damages an ability reaches the skills that use it');
{
  // Exhausted is -6 Str and -6 Dex: Acrobatics is a Dex skill, so it moves by
  // three even though nothing puts a flat penalty on skill checks.
  const clean = built();
  const worn = built({ conditions: { Exhausted: true } });
  const i = clean.data.skills.findIndex((s) => s.name === 'Acrobatics');
  const before = skillRollSpec(clean.data, i, clean.conditionState).rolls[0].formula;
  const after = skillRollSpec(worn.data, i, worn.conditionState).rolls[0].formula;
  check('the ability damage lands on the skill', [before, after], ['1d20+2', '1d20-1']);
}

console.log('a companion rolls on its own sheet');
{
  const c = built();
  const f = c.data.familiar[0];
  f.name = 'Hoot';
  f.scores.dex = { base: 16 };
  f.scores.str = { base: 12 };
  f.initBonus = 2;
  f.skills[0].ranks = 4;          // Acrobatics, a class skill for a familiar
  f.skills[0].classSkill = true;
  f.attacks = [
    { type: 'Bite', damage: '1d4+2', crit: '20/×2', primary: null, bonus: 0, qualities: '' },
    {
      type: 'Claw', damage: '1d3 plus grab', crit: '19-20/×3',
      primary: 'secondary', bonus: 1, qualities: 'trip',
    },
  ];
  c.recompute();
  const d = c.data;
  const spec = (ref) => companionRollSpec(d, 'familiar', ref);

  check('the companion is the actor, its master the possessive',
    spec('init').name, 'Test Subject’s Hoot — Initiative');
  check('initiative is its own Dex plus its own bonus',
    spec('init').rolls[0].formula, '1d20+5');
  check('a save', rollText(spec('save:will'), 'plain'), '/roll 1d20+2 Test Subject’s Hoot — Will save');
  check('an unknown save is not a roll', spec('save:sanity'), null);
  check('an ability check is the companion’s own modifier',
    spec('ability:dex').rolls[0].formula, '1d20+3');
  // 4 ranks + 3 Dex + 3 for a class skill.
  check('a skill', rollText(spec('skill:0'), 'plain'), '/roll 1d20+10 Test Subject’s Hoot — Acrobatics');
  check('a row that is not there is not a roll', spec('skill:999'), null);
  check('nor is a ref that means nothing', spec('nonsense'), null);

  const bite = spec('attack:0');
  check('an attack rolls to hit and for damage',
    bite.rolls.map((r) => [r.label, r.formula]),
    [['Attack', `1d20+${d.familiar[0].attacks[0].toHit}`], ['Damage', '1d4+2'],
      ['Crit confirm', `1d20+${d.familiar[0].attacks[0].toHit}`], ['Crit damage (x2)', '2d4+4']]);

  // The damage column is free text on this tab. Prose is carried, not guessed at.
  const claw = spec('attack:1');
  check('prose damage is a note, not a roll',
    claw.rolls.map((r) => r.label), ['Attack']);
  check('and the text comes along whole',
    claw.notes.find((n) => n.label === 'Damage')?.text, '1d3 plus grab');
  check('a crit column is read for range and multiplier',
    [claw.rolls[0].formula, claw.notes.find((n) => n.label === 'Threat')?.text],
    ['1d20cs>19+' + d.familiar[0].attacks[1].toHit, '19-20/x3']);
  check('a secondary attack says the penalty is already counted',
    claw.notes.some((n) => n.label === 'Secondary'), true);
  check('and what it does on a hit',
    claw.notes.find((n) => n.label === 'On a hit')?.text, 'trip');
  check('the master’s conditions are the master’s', companionRollSpec(
    built({ conditions: { Shaken: true } }).data, 'familiar', 'save:will',
  ).notes, []);
  check('a companion block that is not there is not a roll',
    companionRollSpec({}, 'eidolon', 'init'), null);
}

/* ------------------------------------------------------------------ *
 * The fixture roster, swept
 * ------------------------------------------------------------------ */

if (!hasFixtures()) {
  console.log('fixture sweep: skipped -- no private characters (the rest ran in full)');
} else {
  console.log('every roll on every real character is well formed');
  // A roll is well formed if it is a d20 (or damage dice) and nothing in it
  // could start a construct the chat parser would try to resolve.
  const FORMULA = /^(1d20(cs>\d+)?)?[-+0-9d ()*]*$/;
  // A question is the one construct that is *meant* to reach the parser, so it
  // is taken out before the rest is held to the rule above rather than the rule
  // being loosened to let it through -- which would let anything else through
  // with it. What is left must still be dice and numbers.
  const QUERY = /\?\{[^{}]*\}/g;
  const bare = (f) => f.replace(QUERY, '0');
  for (const id of fixtureIds()) {
    const c = new Character(loadCharacter(id));
    const d = c.data;
    const cs = c.conditionState;
    const specs = [
      ...['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => rollSpec(d, 'ability', k, cs)),
      ...['fortitude', 'reflex', 'will'].map((k) => rollSpec(d, 'save', k, cs)),
      ...['melee', 'altMelee', 'ranged', 'altRanged', 'cmb', 'altCmb']
        .map((k) => rollSpec(d, 'mode', k, cs)),
      rollSpec(d, 'initiative', 'self', cs),
      rollSpec(d, 'concentration', 'magic', cs),
      ...(d.vancian?.classes || []).map((x, i) => rollSpec(d, 'concentration', `vancian:${i}`, cs)),
      ...d.skills.map((s, i) => rollSpec(d, 'skill', i, cs)),
      ...(d.equipment?.weapons || []).map((w, i) => rollSpec(d, 'weapon', i, cs)),
      ...['familiar', 'animalCompanion', 'eidolon'].flatMap((kind) => [
        rollSpec(d, kind, 'init'),
        ...['fort', 'ref', 'will'].map((s) => rollSpec(d, kind, `save:${s}`)),
        ...['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => rollSpec(d, kind, `ability:${a}`)),
        ...(d[kind]?.skills || []).map((s, i) => rollSpec(d, kind, `skill:${i}`)),
        ...(d[kind]?.attacks || []).map((a, i) => rollSpec(d, kind, `attack:${i}`)),
      ]),
    ];
    check(`${id} every row builds a spec`, specs.filter((s) => !s).length, 0);
    const rolls = specs.flatMap((s) => s.rolls);
    check(`${id} ${rolls.length} formulas are dice and numbers`,
      rolls.map((r) => bare(r.formula)).filter((f) => !FORMULA.test(f)), []);
    for (const format of ROLL_FORMATS.map(([k]) => k)) {
      const texts = specs.map((s) => rollText(s, format));
      check(`${id} ${format}: nothing comes out empty`, texts.filter((t) => !t).length, 0);
      // The template's own braces are the only ones allowed through; a name
      // that carried its own would truncate the message at the table.
      if (format === 'template') {
        const bad = texts.map((t) => t.replace(QUERY, '0'))
          .filter((t) => !/^&\{template:default\}( \{\{[^{}]*\}\})+$/.test(t));
        check(`${id} template: every field closes`, bad, []);
      }
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
