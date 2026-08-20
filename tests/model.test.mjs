/** Tests the live model against the real converted characters.
 *
 *  Needs the private character fixtures (see tests/fixtures.mjs); without them
 *  it says so and exits 0.
 *
 *  Run: node tests/model.test.mjs */
import { readFileSync } from 'node:fs';
import { loadCharacter, fixtureIds, requireFixtures } from './fixtures.mjs';
import {
  Character, MYTHIC_POWER_FORMULA, SCHEMA_VERSION, DEFAULT_TAB_ORDER, inspectDocument,
  setManeuverCatalogue, disciplineEntries,
  setVancianTables, castingTableNames, castingTable, closestName,
  setPsionicTables, psionicTables, psionicCurve, psionicPoints, psionicClassTotal,
  setCardcastingTables, deckManipulation, deckManipulationCatalogue,
  setCookingTables, cookingDish, emptyDish,
  techniqueStats, emptyTechnique, normalizeTechnique, TECHNIQUE_SLOTS,
  wealthView, emptyWealth, isoDay, MATERIAL_CASTING_PER_MONTH,
  parseProficiencyText, normalizeProficiencies, weaponProficient,
} from '../app/js/model.js';
import {
  MENTAL_PROWESS_LEVELS, PHYSICAL_PROWESS_LEVELS, ARRAY_SLOTS,
  parseLevelRule, levelRuleLevels, levelRuleGrants, summariseLevels,
  cleanSkillVariant, skillVariantKind, skillLabel, PERFORM_CATEGORIES, performCategory,
  MYTHIC_TIERS, MYTHIC_STAT_TIERS, MYTHIC_TIER_LEVEL, mythicTierGrant,
  KHESHIG_VEILS, wikiUrl, mergeLayout,
  CONDITIONS, SHEET_CONDITIONS, conditionInfo, conditionCount, abilityMod, armorParts, statMod,
} from '../app/js/rules.js';
import { zoneAt, barLayout, normalizeStyle } from '../app/js/tracker-style.js';
import { mergeTables, registerTables } from '../app/js/extensions.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// The shared tables -- the discipline catalogue, the casting and manifesting
// tables, the deck manipulations, the iron chef's ingredients -- are what a
// character's disciplines, slots, pools and dishes are read from, so they are
// registered before any character is constructed, exactly as the app does on
// load: every bundled extension pack, merged, through the same registrars.
const packIndex = JSON.parse(readFileSync('data/extensions/index.json', 'utf8'));
const packs = packIndex.extensions.map((e) => JSON.parse(readFileSync(`data/extensions/${e.file}`, 'utf8')));
const merged = mergeTables(packs);
registerTables(merged, { setManeuverCatalogue, setVancianTables, setPsionicTables, setCardcastingTables, setCookingTables });
const catalogue = merged.maneuvers;
const castingTables = merged.vancian;
const psionicTableDoc = merged.psionics;

requireFixtures(['angou', 'bryva', 'narockro', 'nico', 'saburo'], 'model.test');
const load = loadCharacter;
// Every character in the fixture roster, so one added to it is tested without
// anyone having to remember to list it here too.
const IDS = fixtureIds();

console.log('import fidelity -- every derived stat must match the source sheet');
for (const id of IDS) {
  const raw = load(id);
  const c = new Character(raw);
  const d = c.data;
  check(`${id} AC`, d.defenses.ac, raw.defenses.ac);
  check(`${id} touch`, d.defenses.touch, raw.defenses.touch);
  check(`${id} flat-footed`, d.defenses.flatFooted, raw.defenses.flatFooted);
  check(`${id} CMD`, d.defenses.cmd, raw.defenses.cmd);
  check(`${id} fortitude`, d.saves.fortitude.total, raw.saves.fortitude.total);
  check(`${id} reflex`, d.saves.reflex.total, raw.saves.reflex.total);
  check(`${id} will`, d.saves.will.total, raw.saves.will.total);
  check(`${id} melee`, d.attack.totalMelee, raw.attack.totalMelee);
  check(`${id} ranged`, d.attack.totalRanged, raw.attack.totalRanged);
  check(`${id} cmb`, d.attack.totalCmb, raw.attack.totalCmb);
  check(`${id} initiative`, d.hp.initiative, raw.hp.initiative);
  check(`${id} no diff on load`, c.diffFromSource(), []);
}

console.log('skill totals reproduce the sheet');
for (const id of IDS) {
  const raw = load(id);
  const c = new Character(raw);
  const mismatched = c.data.skills
    .filter((s, i) => s.bonus !== raw.skills[i].bonus)
    .map((s) => s.name);
  check(`${id} all ${raw.skills.length} skills match`, mismatched, []);
}

console.log('live recalculation moves the right numbers by the right amount');
{
  // Scores are built on the Stats tab, so edits go through the build.
  const c = new Character(load('nico'));
  const fort0 = c.data.saves.fortitude.total;

  c.setBuild('con', 'untyped', 2);
  check('Con +2 raises Fortitude by 1', c.data.saves.fortitude.total, fort0 + 1);

  c.setBuild('con', 'untyped', 4);
  check('Con +4 raises Fortitude by 2', c.data.saves.fortitude.total, fort0 + 2);

  c.setBuild('con', 'untyped', 0);
  check('back to base restores Fortitude', c.data.saves.fortitude.total, fort0);
  check('and reports no diff', c.diffFromSource(), []);
}
{
  const c = new Character(load('bryva'));
  const ac0 = c.data.defenses.ac;
  c.setBuild('dex', 'morale', 4);
  // Bryva's AC keys off Str, so Dex must not move it.
  check('Dex does not change Str-based AC', c.data.defenses.ac, ac0);
  c.setBuild('dex', 'morale', 0);

  // Her armor's Max Dex 3 caps the stat portion (the sheet's MIN(MaxDex, stat)
  // rule), so Str edits cannot move AC while the breastplate is worn…
  c.setBuild('str', 'morale', 2);
  check('armored: Str +2 is capped by Max Dex', c.data.defenses.ac, ac0);
  c.setBuild('str', 'morale', 0);

  // …but with the armor doffed the cap lifts and Str flows again.
  c.set('equipment.armor.active', false);
  const acDoffed = c.data.defenses.ac;
  check('doffing armor drops its AC bonus', acDoffed < ac0, true);
  c.setBuild('str', 'morale', 2);
  check('unarmored: Str +2 raises AC by 1', c.data.defenses.ac, acDoffed + 1);
  c.setBuild('str', 'morale', 0);
  c.set('equipment.armor.active', true);
  check('donning restores', c.data.defenses.ac, ac0);
}
{
  const c = new Character(load('angou'));
  const bab0 = c.data.attack.bab;
  const melee0 = c.data.attack.totalMelee;
  c.set('attack.bab', bab0 + 1);
  check('BAB +1 raises melee attack by 1', c.data.attack.totalMelee, melee0 + 1);
  check('iteratives regenerate', c.data.attack.iterative, '+21/+16/+11/+6/+1');
  c.set('attack.bab', bab0);
  check('iteratives restore', c.data.attack.iterative, '+20/+15/+10/+5');
}

console.log('carry capacity follows Strength');
{
  const c = new Character(load('bryva'));
  const light0 = c.data.carry.light;
  c.setBuild('str', 'untyped', 10);
  if (!(c.data.carry.light > light0)) {
    fail++; console.log('  FAIL carry capacity did not rise with Str');
  } else pass++;
  check('medium is 2x light', c.data.carry.medium, c.data.carry.light * 2);
  check('heavy is 3x light', c.data.carry.heavy, c.data.carry.light * 3);
}

console.log('custom trackers');
{
  const c = new Character(load('nico'));
  const t = c.addTracker({ name: 'Luck Pool', maxFormula: 'level + int.mod', refresh: 'Daily' });
  check('tracker id slugged', t.id, 'luck_pool');
  check('tracker max computed', t.max, c.data.identity.level + c.data.abilities.int.mod);

  const before = t.max;
  c.setBuild('int', 'untyped', 2);
  check('tracker follows Int', c.trackers.find((x) => x.id === 'luck_pool').max, before + 1);

  c.addTracker({ name: 'Bad One', maxFormula: 'nonsense * 2' });
  const bad = c.trackers.find((x) => x.id === 'bad_one');
  check('bad formula does not throw', typeof bad.error, 'string');

  c.addTracker({ name: 'Luck Pool' });
  check('duplicate names get distinct ids', c.trackers.filter((x) => x.id.startsWith('luck_pool')).length, 2);

  c.removeTracker('bad_one');
  check('removed', c.trackers.some((x) => x.id === 'bad_one'), false);
}

console.log('audit view for admins/inspectors');
{
  const c = new Character(load('narockro'));
  c.addTracker({ name: 'Rage Rounds', maxFormula: 'level * 2 + con.mod', refresh: 'Daily' });
  c.addTracker({ name: 'Broken', maxFormula: 'wat + 1' });

  const audit = c.audit();
  const rage = audit.find((a) => a.id === 'rage_rounds');
  check('audit exposes exact source text', rage.formula, 'level * 2 + con.mod');
  check('audit lists what it reads', rage.reads.sort(), ['con.mod', 'level']);
  check('audit reports value', rage.value, c.data.identity.level * 2 + c.data.abilities.con.mod);
  check('audit status ok', rage.status, 'ok');

  const broken = audit.find((a) => a.id === 'broken');
  check('audit flags unknown reference', broken.unknownReferences, ['wat']);
  check('audit status error', broken.status, 'error');

  const sheetSeeded = c.trackers.filter((t) => t.source === 'sheet');
  if (sheetSeeded.length === 0) { fail++; console.log('  FAIL sheet resources were not seeded'); } else pass++;
}

console.log('ability build reproduces the Stats tab');
{
  for (const id of IDS) {
    const raw = load(id);
    const c = new Character(raw);
    for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      check(`${id} ${k} score`, c.data.abilities[k].score, raw.abilities[k].score);
      check(`${id} ${k} temp score`, c.data.abilities[k].tempScore, raw.abilities[k].tempScore);
      check(`${id} ${k} build total matches sheet`, c.data.statsBuild[k].resolved.total, raw.statsBuild[k].sheetTotal);
    }
  }
}

console.log('point buy costs');
{
  const c = new Character(load('angou'));
  const pb = c.pointBuySummary();
  // Angou buys Str 16, Dex 10, Con 16, Int 10, Wis 16, Cha 10 -> 10+0+10+0+10+0
  check('angou per-ability cost', pb.per, { str: 10, dex: 0, con: 10, int: 0, wis: 10, cha: 0 });
  check('angou total spend', pb.total, 30);
  check('matches sheet C9', pb.total, 30);

  c.setBuild('str', 'pointBuy', 18);
  check('raising to 18 costs 17', c.pointBuySummary().per.str, 17);
  check('total follows', c.pointBuySummary().total, 37);
  c.setBuild('str', 'pointBuy', 7);
  check('dumping to 7 refunds 4', c.pointBuySummary().per.str, -4);
}
for (const id of IDS) {
  const c = new Character(load(id));
  check(`${id} point buy total is 30`, c.pointBuySummary().total, 30);
}

console.log('the +6 enhancement cap (ABP + gear)');
{
  // Narockro's Cha has ABP 4 + gear 4 = 8, which the sheet counts as 6.
  const c = new Character(load('narockro'));
  const cha = c.data.statsBuild.cha;
  check('raw enhancement', cha.resolved.rawEnhancement, 8);
  check('capped enhancement', cha.resolved.enhancement, 6);
  check('wasted reported', cha.resolved.enhancementWasted, 2);
  check('total still matches sheet', cha.resolved.total, 30);

  const before = c.data.abilities.cha.score;
  c.setBuild('cha', 'gear', 6);           // even more gear
  check('over-cap gear changes nothing', c.data.abilities.cha.score, before);

  c.setBuild('cha', 'gear', 0);           // drop gear entirely
  check('dropping gear below cap costs 2', c.data.abilities.cha.score, before - 2);
}
{
  const c = new Character(load('saburo'));
  const str = c.data.statsBuild.str;      // ABP 2 + gear 2 = 4, under the cap
  check('under cap stacks fully', str.resolved.enhancement, 4);
  const before = c.data.abilities.str.score;
  c.setBuild('str', 'gear', 6);           // 2 + 6 = 8 -> capped to 6
  check('cap applies on the way up', c.data.abilities.str.score, before + 2);
}

console.log('progression picks drive ABP / array / Level-4');
{
  const c = new Character(load('angou'));  // level 20, all picks count
  check('str ABP from picks', c.data.statsBuild.str.abp, 6);
  check('con ABP from picks', c.data.statsBuild.con.abp, 6);
  check('dex ABP from picks', c.data.statsBuild.dex.abp, 4);
  check('con array from picks', c.data.statsBuild.con.array, 6);
  check('wis level4 from picks', c.data.statsBuild.wis.level4, 5);

  const str0 = c.data.abilities.str.score;
  c.setPick('abp', 13, 'physical', 'Dex');   // was Str
  check('reassigning a prowess pick moves 2 points', c.data.abilities.str.score, str0 - 2);
  check('and grants them elsewhere', c.data.statsBuild.dex.abp, 6);

  c.setPick('abp', 13, 'physical', 'Str');
  check('reassigning back restores', c.data.abilities.str.score, str0);
}
{
  // Picks above the character's level are plans, and must not count yet.
  const c = new Character(load('nico'));   // level 15
  const int0 = c.data.abilities.int.score;
  check('nico level4 counts 3 of 5 planned', c.data.statsBuild.int.level4, 3);
  c.set('identity.level', 16);
  check('levelling to 16 banks the next increase', c.data.statsBuild.int.level4, 4);
  check('and the score rises by 1', c.data.abilities.int.score, int0 + 1);
  c.set('identity.level', 15);
  check('levelling back down reverts', c.data.abilities.int.score, int0);
}

console.log('pick slots match the template shape in every source sheet');
{
  // The UI renders a control only where a slot actually exists, so these
  // shapes must hold for the imported data or picks would be hidden.
  for (const id of IDS) {
    const p = load(id).progressionPicks;

    const mental = p.abp.filter((r) => r.mental).map((r) => r.level);
    const physical = p.abp.filter((r) => r.physical).map((r) => r.level);
    check(`${id} mental prowess levels`, mental, MENTAL_PROWESS_LEVELS.filter((l) => mental.includes(l)));
    check(`${id} no mental pick off-schedule`, mental.filter((l) => !MENTAL_PROWESS_LEVELS.includes(l)), []);
    check(`${id} no physical pick off-schedule`, physical.filter((l) => !PHYSICAL_PROWESS_LEVELS.includes(l)), []);

    for (const row of p.array) {
      const allowed = ARRAY_SLOTS[row.level] || [];
      const used = row.slots.map((s, i) => (s ? i : null)).filter((i) => i !== null);
      check(`${id} array L${row.level} uses only declared slots`,
        used.filter((i) => !allowed.includes(i)), []);
      check(`${id} array L${row.level} slot count`, allowed.length,
        row.level === 8 ? 4 : 3);
    }
  }
}

console.log('attunement is gated at level 20');
{
  const c = new Character(load('nico'));   // level 15
  check('locked below 20', c.attunementUnlocked, false);
  const before = c.data.abilities.str.score;
  c.setBuild('str', 'attunement', 2);
  check('cannot buy below 20', c.data.abilities.str.score, before);

  const a = new Character(load('angou')); // level 20
  check('unlocked at 20', a.attunementUnlocked, true);
  const str0 = a.data.abilities.str.score;
  a.setBuild('str', 'attunement', true);
  check('grants +2', a.data.abilities.str.score, str0 + 2);
  a.setBuild('str', 'attunement', 3);
  check('any truthy value is the one +2', a.data.statsBuild.str.attunement, 2);
  a.setBuild('str', 'attunement', false);
  check('clears', a.data.abilities.str.score, str0);
}

console.log('AC and save bonuses are editable, not hidden in the offset');
{
  const c = new Character(load('angou'));
  const ac0 = c.data.defenses.ac;
  const will0 = c.data.saves.will.total;

  check('AC carries the sheet offset', c.offsetOf('defenses.ac') > 0, true);
  c.setOffset('defenses.ac', c.offsetOf('defenses.ac') + 3);
  check('raising it raises AC', c.data.defenses.ac, ac0 + 3);
  c.setOffset('defenses.ac', c.offsetOf('defenses.ac') - 3);
  check('and back', c.data.defenses.ac, ac0);

  c.setOffset('saves.will.total', c.offsetOf('saves.will.total') + 2);
  check('a Will bonus moves Will', c.data.saves.will.total, will0 + 2);
  check('and nothing else', c.data.saves.fortitude.total, load('angou').saves.fortitude.total);

  // Edited offsets are recovered from the saved totals, not stored twice.
  const round = new Character(c.toJSON());
  check('survives a save/load round trip', round.data.saves.will.total, will0 + 2);
  check('offset comes back with it', round.offsetOf('saves.will.total'), c.offsetOf('saves.will.total'));

  check('a stat with no offset is refused', c.setOffset('nonsense.key', 5).offsetOf('nonsense.key'), 0);
}

console.log('permanent vs temporary bonuses');
{
  const c = new Character(load('angou'));
  const score0 = c.data.abilities.str.score;
  const temp0 = c.data.abilities.str.tempScore;

  c.setBuild('str', 'untyped', 4);
  check('untyped raises the permanent score', c.data.abilities.str.score, score0 + 4);
  check('and the temp score with it', c.data.abilities.str.tempScore, temp0 + 4);
  c.setBuild('str', 'untyped', 0);

  c.setBuild('str', 'morale', 4);
  check('morale leaves the permanent score alone', c.data.abilities.str.score, score0);
  check('but raises the temp score', c.data.abilities.str.tempScore, temp0 + 4);
  c.setBuild('str', 'morale', 0);
  check('restores', c.data.abilities.str.tempScore, temp0);
}

console.log('build edits flow through to derived stats');
{
  const c = new Character(load('bryva'));
  const fort0 = c.data.saves.fortitude.total;
  const hp0 = c.data.abilities.con.score;
  c.setBuild('con', 'inherent', 4);
  check('Con +4 via inherent raises the score', c.data.abilities.con.score, hp0 + 4);
  check('and Fortitude by 2', c.data.saves.fortitude.total, fort0 + 2);
  c.setBuild('con', 'inherent', 0);
  check('reverting restores Fortitude', c.data.saves.fortitude.total, fort0);
}

console.log('scope exposes usable names');
{
  const c = new Character(load('angou'));
  const names = c.scopeNames();
  for (const want of ['level', 'bab', 'str.mod', 'con.mod', 'wis.tempMod', 'saves.will', 'ac.total', 'attack.melee', 'mythic.tier']) {
    if (!names.includes(want)) { fail++; console.log(`  FAIL scope missing "${want}"`); } else pass++;
  }
  if (!names.some((n) => n.startsWith('skill.'))) { fail++; console.log('  FAIL no skills in scope'); } else pass++;
}

console.log('ABP levels 11 and 12 follow the level 6 and 7 picks');
{
  for (const id of IDS) {
    const p = load(id).progressionPicks.abp;
    const at = (l) => p.find((r) => r.level === l) || {};
    check(`${id} L11 mental copies L6`, at(11).mental, at(6).mental);
    check(`${id} L12 physical copies L7`, at(12).physical, at(7).physical);
  }

  const c = new Character(load('angou'));
  const wis0 = c.data.abilities.wis.score;
  const cha0 = c.data.abilities.cha.score;
  check('starts as Wis at 6 and 11', c.data.progressionPicks.abp.find((r) => r.level === 11).mental, 'Wis');

  c.setPick('abp', 6, 'mental', 'Cha');
  check('changing 6 also changes 11', c.data.progressionPicks.abp.find((r) => r.level === 11).mental, 'Cha');
  check('both picks move off Wis', c.data.statsBuild.wis.abp, 2);
  check('and onto Cha', c.data.statsBuild.cha.abp, 8);
  check('Wis loses both increments', c.data.abilities.wis.score, wis0 - 4);
  // Cha was already at ABP 4, so the extra 4 runs into the +6 cap and only 2 land.
  check('Cha gains only what the cap allows', c.data.abilities.cha.score, cha0 + 2);
  check('and the waste is reported', c.data.statsBuild.cha.resolved.enhancementWasted, 2);

  c.setPick('abp', 6, 'mental', 'Wis');
  check('reverting restores Wis', c.data.abilities.wis.score, wis0);
  check('and Cha', c.data.abilities.cha.score, cha0);

  const con0 = c.data.abilities.con.score;
  c.setPick('abp', 7, 'physical', 'Dex');
  check('changing 7 also changes 12', c.data.progressionPicks.abp.find((r) => r.level === 12).physical, 'Dex');
  check('Con loses 4', c.data.abilities.con.score, con0 - 4);
  check('Dex picks up both', c.data.statsBuild.dex.abp, 8);
  c.setPick('abp', 7, 'physical', 'Con');
  check('restored', c.data.abilities.con.score, con0);
}

console.log('list editing');
{
  const c = new Character(load('nico'));

  // skills
  const n0 = c.data.skills.length;
  c.listAdd('skills', {
    name: 'Underwater Basketweaving', spec: '', bonus: 0, classSkill: true,
    totalRanks: 5, ranks: {}, abilities: ['Int'], offset: 0, importedBonus: 0,
    rankSources: { bought: 5, gear: false, other: false }, ranksOffset: 0,
  });
  check('skill added', c.data.skills.length, n0 + 1);
  const added = c.data.skills[c.data.skills.length - 1];
  check('new skill total = ranks + class + Int', added.bonus, 5 + 3 + c.data.abilities.int.mod);
  c.setItem('skills', c.data.skills.length - 1, 'rankSources.bought', 10);
  check('editing ranks recalculates', c.data.skills[c.data.skills.length - 1].bonus,
    10 + 3 + c.data.abilities.int.mod);
  c.listRemove('skills', c.data.skills.length - 1);
  check('skill removed', c.data.skills.length, n0);

  // weapons
  c.listAdd('weapons', { name: 'Rapier', type: 'melee', bonus: 2, damage: '1d6', crit: '18-20/x2' });
  check('weapon added', c.data.weapons.length, 1);
  c.setItem('weapons', 0, 'bonus', 5);
  check('weapon field edited', c.data.weapons[0].bonus, 5);

  // feat groups survive normalisation and stay editable
  if (!Array.isArray(c.data.featGroups)) { fail++; console.log('  FAIL featGroups not normalised'); } else pass++;
  const g0 = c.data.featGroups.length;
  c.listAdd('featGroups', { name: 'Story Feats', entries: [] });
  check('feat group added', c.data.featGroups.length, g0 + 1);
  c.listAdd(`featGroups.${g0}.entries`, { name: 'Hero of the People', detail: 'Level 3' });
  check('feat added to new group', c.data.featGroups[g0].entries.length, 1);
  c.setItem(`featGroups.${g0}.entries`, 0, 'name', 'Renamed');
  check('feat renamed', c.data.featGroups[g0].entries[0].name, 'Renamed');

  // reordering
  c.listAdd('weapons', { name: 'Dagger', type: 'melee', bonus: 0 });
  c.listMove('weapons', 1, -1);
  check('reordered', c.data.weapons[0].name, 'Dagger');
  c.listMove('weapons', 0, -1);
  check('cannot move past the start', c.data.weapons[0].name, 'Dagger');

  // groups with dots in their names are addressable
  c.listAdd('featGroups', { name: 'Odd. Name/With Stuff', entries: [] });
  const gi = c.data.featGroups.length - 1;
  c.listAdd(`featGroups.${gi}.entries`, { name: 'Works', detail: '' });
  check('awkward group name still addressable', c.data.featGroups[gi].entries[0].name, 'Works');
}

console.log('hit points at the table');
{
  const c = new Character(load('bryva'));
  const max = c.data.hp.total;
  check('starts at full', c.hpState.current, max);
  check('and is not hurt', c.hpState.unconscious, false);

  c.damage(50);
  check('damage applied', c.hpState.current, max - 50);
  c.heal(20);
  check('healing applied', c.hpState.current, max - 30);
  c.heal(9999);
  check('healing caps at max', c.hpState.current, max);

  c.set('hp.temp', 10);
  c.damage(6);
  check('temp hp absorbs first', c.hpState.temp, 4);
  check('and current is untouched', c.hpState.current, max);
  c.damage(10);
  check('overflow carries into current', c.hpState.current, max - 6);
  check('temp exhausted', c.hpState.temp, 0);

  c.damage(9999);
  check('unconscious below zero', c.hpState.unconscious, true);
  check('dying flagged', c.hpState.dying, true);
  check('dead below negative Con', c.hpState.dead, true);

  c.restoreAll();
  check('rest restores hp', c.hpState.current, max);
  check('rest clears temp', c.hpState.temp, 0);
  check('rest clears nonlethal', c.hpState.nonlethal, 0);
  check('rest resets trackers', c.trackers.every((t) => t.current === 0), true);

  c.damage(12, { nonlethal: true });
  check('nonlethal tracked separately', c.hpState.nonlethal, 12);
  check('and does not reduce current', c.hpState.current, max);

  check('hp is readable from formulas', c.scopeNames().includes('hp.current'), true);
}

console.log('the death threshold, and how loudly the sheet says so');
{
  const c = new Character(load('bryva'));
  const con = c.data.abilities.con.tempScore;
  check('dead at negative Con by default', c.hpState.deathAt, -con);
  check('and nothing is raising it', c.hpState.deathBonus, 0);

  c.set('hp.current', -1);
  check('one point under is dying, not dead', [c.hpState.dying, c.hpState.dead], [true, false]);
  check('and the warning has barely started', c.hpState.dyingFraction, 1 / con);
  c.set('hp.current', -con);
  check('at the threshold, dead', c.hpState.dead, true);
  check('and the warning is at full', c.hpState.dyingFraction, 1);

  // Death's Door and the like buy room past the threshold rather than a new
  // rule, so the bonus rides on Con and moves with it.
  c.set('hp.deathBonus', 6);
  check('a bonus pushes the threshold down', c.hpState.deathAt, -(con + 6));
  check('and the character is dying again, not dead', [c.hpState.dying, c.hpState.dead], [true, false]);
  check('the warning eases off', c.hpState.dyingFraction, con / (con + 6));
  // A rage or a bull's-strength potion is a temporary Con score, and the
  // threshold is Con's, so it follows without being told.
  c.setBuild('con', 'morale', 4);
  check('a temporary Con moves the threshold too', c.hpState.deathAt, -(con + 4 + 6));

  c.setBuild('con', 'morale', 0);
  c.set('hp.deathBonus', 0);
  c.restoreAll();
  check('and rest puts it all back', [c.hpState.current, c.hpState.dying], [c.data.hp.total, false]);
}

console.log('meters -- hit points and essence, drawn the way the player asked');
{
  const c = new Character(load('angou'));

  // Nobody has restyled anything, so nothing is stored and both read as bars.
  check('a fresh sheet stores no meter styles', Object.keys(c.data.meterStyles), []);
  check('and a meter is a bar', c.meterStyle('hp').shape, 'bar');

  const hpMax = c.hpState.max;
  let hp = c.meterSpec('hp');
  check('the track is the maximum', [hp.min, hp.max], [0, hpMax]);
  check('and it is full', hp.current, hpMax);
  check('with nothing layered over it', hp.layers, []);
  check('and no alarm', hp.alert, 0);

  // Temporary hit points are extra track past the maximum, not a fuller bar.
  c.set('hp.temp', 20);
  hp = c.meterSpec('hp');
  check('temporary points extend the track', hp.max, hpMax + 20);
  check('and fill it', hp.current, hpMax + 20);
  check('the borrowed stretch is marked', hp.layers.map((l) => [l.kind, l.from, l.to]),
    [['over', hpMax, hpMax + 20]]);

  // Nonlethal eats down from the top of what is left.
  c.set('hp.nonlethal', 30);
  hp = c.meterSpec('hp');
  check('nonlethal is marked, not subtracted', hp.current, hpMax + 20);
  check('and covers the top of the fill',
    hp.layers.find((l) => l.kind === 'mark'), { kind: 'mark', from: hpMax - 10, to: hpMax + 20, label: '30 nonlethal' });
  c.set('hp.nonlethal', 9999);
  check('more nonlethal than there is stops at the bottom',
    c.meterSpec('hp').layers.find((l) => l.kind === 'mark').from, 0);
  c.set('hp.nonlethal', 0);
  c.set('hp.temp', 0);

  // Below zero the bar has nothing to fill, so the alarm carries it.
  c.set('hp.current', -1);
  check('dying raises the alarm', c.meterSpec('hp').alert > 0, true);
  check('but the fill is empty, not red', c.meterSpec('hp').alertFill, false);
  check('at the threshold the alarm is full', (c.set('hp.current', c.hpState.deathAt), c.meterSpec('hp').alert), 1);
  c.restoreAll();

  // Essence: the same picture, with the spell-point capacity as its layer.
  let ess = c.meterSpec('essence');
  check('the essence track is the day\'s pool', [ess.min, ess.max, ess.current], [0, 20, 20]);
  check('with nothing borrowed', ess.layers, []);
  c.set('akashic.essence.spTemp', 4);
  ess = c.meterSpec('essence');
  check('condensed essence widens the track', ess.max, 24);
  check('and is marked as borrowed', ess.layers.map((l) => [l.kind, l.from, l.to]), [['over', 20, 24]]);
  check('the fill is still what is invested', ess.current, 20);
  check('and there is no alarm while it fits', ess.alert, 0);
  c.setItem('akashic.slots.5.veils', 0, 'essence', 30);
  check('over-investing sets the alarm off', c.meterSpec('essence').alert, 1);
  check('and it is the fill that has gone wrong', c.meterSpec('essence').alertFill, true);
  c.setItem('akashic.slots.5.veils', 0, 'essence', 6);
  c.set('akashic.essence.spTemp', 0);

  // Restyling: saved when it differs, dropped when it does not, kept on save.
  c.setMeterStyle('essence', { shape: 'pips', color: '#6ea8fe' });
  check('a restyled meter is stored', c.data.meterStyles.essence.shape, 'pips');
  check('and the meter takes it', c.meterSpec('essence').style.color, '#6ea8fe');
  c.setMeterStyle('essence', { shape: 'bar', fill: 'spent' });
  check('back to the default and it is dropped again', c.data.meterStyles.essence, undefined);
  c.setMeterStyle('nonsense', { shape: 'pips' });
  check('a meter nobody has heard of is ignored', Object.keys(c.data.meterStyles), []);

  // The power point pool is the third meter, and the one that starts drained.
  // None of the five sheets manifests, so it takes a class to have a pool.
  const pp = new Character(load('nico'));
  pp.listAdd('psionics.classes', {
    name: 'Psion', stat: 'Int', stat2: '', curveTotal: 343,
    manifesterLevelOverride: 10, powers: [],
  });
  const pool = pp.data.psionics.pool;
  check('a manifesting class fills the pool', pool > 0, true);
  check('the pool drains by default', pp.meterStyle('pp').fill, 'remaining');
  check('and its track is the pool', [pp.meterSpec('pp').min, pp.meterSpec('pp').max], [0, pool]);
  // Stored as points spent, so a full pool reads zero and a drained bar shows
  // it full -- the same arrangement a draining tracker uses.
  check('a full pool has spent nothing', pp.meterSpec('pp').current, 0);
  pp.set('psionics.spent', 7);
  check('spending seven counts seven', pp.meterSpec('pp').current, 7);
  check('drained is not worth saving for this one',
    (pp.setMeterStyle('pp', { shape: 'bar', fill: 'remaining' }), pp.data.meterStyles.pp), undefined);
  pp.setMeterStyle('pp', { shape: 'bar', fill: 'spent' });
  check('but filling is', pp.data.meterStyles.pp.fill, 'spent');

  c.setMeterStyle('hp', { shape: 'pips', zones: [{ from: '0', to: 'hp.total * 0.25', color: '#e0635f', label: 'bloodied' }] });
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('a style survives a save', back.meterStyle('hp').shape, 'pips');
  check('and so does its zone', back.meterStyle('hp').zones[0].label, 'bloodied');
  check('whose bounds resolve against the character',
    back.meterSpec('hp').resolvedZones[0].toValue, back.data.hp.total * 0.25);
}

console.log('editing flows into derived stats');
{
  const c = new Character(load('saburo'));
  const ac0 = c.data.defenses.ac;
  c.set('defenses.miscAC', (c.data.defenses.miscAC || 0) + 3);
  check('misc AC raises AC', c.data.defenses.ac, ac0 + 3);

  // Save bases are computed from the class table now (saburo is level 9):
  // one poor-save class gives floor(9/3)=3, a good one gives 2+floor(9/2)=6.
  const savedClasses = c.data.classes;
  c.data.classes = [{ name: 'Solo', hd: 10, goodFort: false, goodRef: false, goodWill: false, skillRanks: 4 }];
  c.recompute();
  check('poor save base at 9', c.data.saves.fortitude.base, 3);
  c.data.classes[0].goodFort = true;
  c.recompute();
  check('good save base at 9', c.data.saves.fortitude.base, 6);
  c.data.classes = savedClasses;
  c.recompute();

  // switching the ability a save keys off
  const will0 = c.data.saves.will.total;
  const wisMod = c.data.abilities.wis.totalMod;
  const intMod = c.data.abilities.int.totalMod;
  c.set('saves.will.stat1', 'Int');
  check('save follows its new ability', c.data.saves.will.total, will0 - wisMod + intMod);

  // size changes AC, CMD and carry capacity together
  const cmd0 = c.data.defenses.cmd;
  const light0 = c.data.carry.light;
  c.set('identity.size', 'Large');
  check('size shifts AC', c.data.defenses.ac, c.data.defenses.ac);
  check('size raises CMD', c.data.defenses.cmd, cmd0 + 1);
  if (!(c.data.carry.light > light0)) { fail++; console.log('  FAIL size did not change carry capacity'); } else pass++;
}

console.log('spheres training reproduces the sheet');
{
  // Talent progressions and granted flags, against every cached sheet value.
  for (const id of IDS) {
    const c = new Character(load(id));
    let mismatches = 0;
    for (const sideKey of ['combat', 'magic']) {
      for (const cls of c.data.training?.[sideKey]?.classes || []) {
        if (cls.classLevelsOverride != null) continue;
        for (const lv of cls.levels || []) {
          if (Math.floor(lv.count) !== Math.floor(lv.sheetCount)) mismatches++;
          if (lv.granted !== lv.sheetGranted) mismatches++;
        }
      }
    }
    check(`${id} talent progressions match sheet`, mismatches, 0);
  }
}
{
  // Angou's magic globals, all confirmed against his sheet's caches.
  const c = new Character(load('angou'));
  const m = c.data.training.magic;
  check('angou global CL', m.globalCL, 20);
  check('angou global DC', m.globalDC, 36);
  check('angou MSB', m.msb, 20);
  check('angou MSD', m.msd, 31);
  check('angou concentration', m.concentration, 36);
  check('angou drawbacks (x2 counts double)', m.drawbackCount, 8);
  check('angou bought off', m.boughtOffCount, 1);
  check('angou effective', m.effectiveDrawbacks, 6);
  check('angou SP tier', m.spTier, 5);
  check('angou boons -- every effective drawback is one', m.boons, 6);
  check('angou tradition SP (3 casting classes)', m.traditionSP, 12);
  check('angou total SP', m.totalSP, 83);

  // Bryva: the other internally-consistent workbook.
  const b = new Character(load('bryva'));
  const bm = b.data.training.magic;
  check('bryva global CL (Mid caster)', bm.globalCL, 12);
  check('bryva global DC', bm.globalDC, 23);
  check('bryva MSB', bm.msb, 16);
  check('bryva total SP', bm.totalSP, 23);
}
{
  // Editing flows: swapping a caster type moves CL (single-caster Bryva,
  // since global CL is the best across casters); drawbacks move SP.
  const b2 = new Character(load('bryva'));
  c2check: {
    check('bryva starts Mid at CL 12', b2.data.training.magic.globalCL, 12);
    b2.setItem('training.magic.classes', 0, 'type', 'High');
    check('promoting to High raises CL', b2.data.training.magic.globalCL, 16);
    check('and DC follows', b2.data.training.magic.globalDC, 25);
    b2.setItem('training.magic.classes', 0, 'type', 'Mid');
    check('restoring', b2.data.training.magic.globalCL, 12);
  }
  const c = new Character(load('angou'));

  const sp0 = c.data.training.magic.totalSP;
  c.listAdd('training.magic.tradition.boughtOff', 'Somatic Casting');
  check('buying off a drawback costs 2 effective', c.data.training.magic.effectiveDrawbacks, 4);
  check('which drops the boons with it', c.data.training.magic.boons, 4);
  check('and the tradition SP', c.data.training.magic.totalSP, sp0 - 12);
  c.listRemove('training.magic.tradition.boughtOff', 1);
  check('restored', c.data.training.magic.totalSP, sp0);
}
{
  // Talents/level vs type mismatch: Bryva's Blacksmith casts Mid, learns High.
  const b = new Character(load('bryva'));
  const cls = b.data.training.magic.classes[0];
  check('bryva mismatch imported', [cls.type, cls.talentsPerLevel], ['Mid', 'High Caster']);
  check('talents use the talent rate', cls.totalTalents, cls.classLevels);
  check('CL uses the type rate', b.data.training.magic.globalCL, Math.floor(cls.classLevelsCurrent * 0.75));
}
{
  // Granted slots respond to the talents/level selector.
  const c = new Character(load('angou'));
  const cls = () => c.data.training.combat.classes[0];
  check('Expert grants every level', cls().levels.filter((l) => l.granted).length, 20);
  c.setItem('training.combat.classes', 0, 'talentsPerLevel', 'Proficient');
  check('Proficient grants half', cls().levels.filter((l) => l.granted).length, 10);
  check('odd levels off', cls().levels[0].granted, false);
  check('even levels on', cls().levels[1].granted, true);
  c.setItem('training.combat.classes', 0, 'talentsPerLevel', 'Expert');
}

console.log('sphere skill ranks feed the skills table');
{
  const c = new Character(load('angou'));
  const rows = c.trainingSkillRanks;
  const at = (k) => rows.find((r) => r.skill === k);
  check('Acrobatics (Light Body) = level', at('Acrobatics').current, 20);
  check('Craft (mechanical) from 5 Tech talents', at('Craft (mechanical)').current, 20);
  const mech = c.data.skills.find((s) => s.name === 'Craft' && /mechan/i.test(s.spec || ''));
  check('flows into the skill row', mech.sphereRanks, 20);
  check('and its total ranks', mech.totalRanks, 20);

  // toggling the row off removes the ranks
  const i = rows.indexOf(at('Craft (mechanical)'));
  c.setItem('training.combat.skillRanks', i, 'enabled', false);
  const mech2 = c.data.skills.find((s) => s.name === 'Craft' && /mechan/i.test(s.spec || ''));
  check('disabling removes sphere ranks', mech2.sphereRanks, 0);
  c.setItem('training.combat.skillRanks', i, 'enabled', true);
}

console.log('unarmed practitioner damage');
{
  for (const id of IDS) {
    const c = new Character(load(id));
    const u = c.data.training?.combat?.unarmed;
    if (u?.sheetDice) check(`${id} unarmed matches sheet`, u.dice, u.sheetDice);
  }
  const c = new Character(load('angou'));
  const u = () => c.data.training.combat.unarmed;
  check('angou effective talents', u().effectiveTalents, 19);
  check('angou dice', u().dice, '12d8');

  // The sheet's numbers (2 and 4) read as the items being had.
  check('Talented Knuckle and the vest are toggles now', [u().talentedKnuckle, u().brawlersVest], [true, true]);
  c.set('training.combat.unarmed.brawlersVest', false);
  check('dropping the vest drops a bracket', u().dice, '12d6');
  c.set('training.combat.unarmed.brawlersVest', true);
  check('Unorthodox Unarmed Training: one feat, two picks, both taken', [u().unorthodoxFeats, u().unorthodoxSlots, u().otherSpheres], [1, 2, ['Tech', 'Berserker']]);
  c.listAdd('featGroups.0.entries', { name: 'Unorthodox Unarmed Training', detail: '' });
  check('a second feat opens two more', [u().unorthodoxFeats, u().unorthodoxSlots], [2, 4]);
  c.listRemove('featGroups.0.entries', c.data.featGroups[0].entries.length - 1);
  // The Bands of the Asura veil: 4 Open Hand talents per essence, only when it is shaped.
  check('no essence in the Bands, nothing added', u().asuraEssence, 0);
  const asuraSlot = c.data.akashic.slots.findIndex((s) => (s.veils || []).some((v) => /asura/i.test(v.name)));
  const asuraVeil = c.data.akashic.slots[asuraSlot].veils.findIndex((v) => /asura/i.test(v.name));
  c.setItem(`akashic.slots.${asuraSlot}.veils`, asuraVeil, 'essence', 2);
  check('two essence in the Bands is eight Open Hand talents', [u().asuraEssence, u().perSphere['Open Hand'], u().effectiveTalents], [2, 3 + 8, 27]);
  c.setItem(`akashic.slots.${asuraSlot}.veils`, asuraVeil, 'essence', 0);

  c.set('training.combat.unarmed.sizeIncreases', 0);
  check('no size increases: Medium 16-19 bracket', u().dice, '2d8');
  c.set('training.combat.unarmed.stepIncreases', 1);
  check('a step increase moves one step', u().dice, '3d6');
  c.set('training.combat.unarmed.stepIncreases', 0);
  c.set('training.combat.unarmed.sizeIncreases', 5);
  check('restored', u().dice, '12d8');

  c.set('training.combat.unarmed.usesOpenHand', false);
  check('toggling Open Hand off removes its talents', u().effectiveTalents, 16);
  c.set('training.combat.unarmed.usesOpenHand', true);
}

console.log('specialty skills');
{
  const c = new Character(load('angou'));
  const spec = c.data.specialtySkills;
  check('knowledge slot seeded', spec.knowledge, 'Kn. (local)|');
  check('free slot seeded', spec.free, 'Diplomacy|');
  const kn = c.data.skills.find((s) => s.name === 'Kn. (local)');
  check('specialty grants full ranks', kn.totalRanks, 20);
  check('flag set', kn.specialtyFlag, true);

  // moving the specialty moves the ranks
  c.set('specialtySkills.knowledge', 'Kn. (planes)|');
  const kn2 = c.data.skills.find((s) => s.name === 'Kn. (local)');
  const planes = c.data.skills.find((s) => s.name === 'Kn. (planes)');
  check('old skill loses the flag', kn2.specialtyFlag, false);
  check('new skill gains it', planes.specialtyFlag, true);
  check('new skill at full ranks', planes.totalRanks, 20);
  c.set('specialtySkills.knowledge', 'Kn. (local)|');
}

console.log('skill variants -- only Craft, Lore, Profession and Perform have one');
{
  for (const [name, kind] of [
    ['Artistry', 'text'], ['Craft', 'text'], ['Craft (Craftsman)', 'text'],
    ['Lore', 'text'], ['Profession', 'text'], ['Perform', 'perform'],
    ['Bluff', null], ['Kn. (arcana)', null], ['Acrobatics', null], ['', null],
    // Matched on a word boundary, so these are their own skills.
    ['Craftsmanship', null], ['Professional', null], ['Lorekeeper', null],
  ]) check(`${name || '(unnamed)'} slot`, skillVariantKind(name), kind);

  check('nine Perform categories', PERFORM_CATEGORIES.length, 9);
  check('each has examples', PERFORM_CATEGORIES.every(([c, ex]) => c && ex), true);

  // Players write the whole skill as often as they write only the variant.
  for (const [name, typed, want] of [
    ['Craft', 'Weapons and Armor', 'Weapons and Armor'],
    ['Craft', 'Craft (Weapons and Armor)', 'Weapons and Armor'],
    ['Craft', '(Weapons and Armor)', 'Weapons and Armor'],
    ['Craft', 'Craft: Weapons and Armor', 'Weapons and Armor'],
    ['Craft', '  Craft ( Weapons and Armor )  ', 'Weapons and Armor'],
    ['Craft (Craftsman)', 'Craft (Craftsman) (Carpentry)', 'Carpentry'],
    ['Lore', 'Lore (Mind Games & Gambling)', 'Mind Games & Gambling'],
    ['Artistry', 'Artistry (Sculpture)', 'Sculpture'],
    ['Craft', '', ''],
    ['Craft', null, ''],
    // Left alone: inner parentheses, and a word that merely starts the same.
    ['Craft', 'Bows (composite) and Arrows', 'Bows (composite) and Arrows'],
    ['Craft', 'Craftsmanship', 'Craftsmanship'],
    // A skill with no slot has no name to strip.
    ['Bluff', 'Craft (Weapons)', 'Craft (Weapons)'],
  ]) check(`clean ${JSON.stringify(typed)}`, cleanSkillVariant(name, typed), want);

  check('label composes', skillLabel('Craft', 'Weapons and Armor'), 'Craft (Weapons and Armor)');
  check('label without a variant', skillLabel('Bluff', ''), 'Bluff');

  // The sheets abbreviate a couple of the Perform categories.
  for (const [typed, want] of [
    ['String', 'String instruments'], ['wind', 'Wind instruments'],
    ['Sing', 'Sing'], ['Percussion', 'Percussion instruments'],
    // Too vague or not a category at all: left as written rather than guessed.
    ['S', null], ['instruments', null], ['Kazoo', null], ['', null], [null, null],
  ]) check(`performCategory ${JSON.stringify(typed)}`, performCategory(typed), want);

  const n = new Character(load('narockro'));
  check('an abbreviated Perform imports as the real category',
    n.data.skills.filter((s) => s.name === 'Perform' && s.spec).map((s) => s.spec),
    ['String instruments', 'Sing']);
  check('and the specialty pick follows it',
    n.data.specialtySkills.background, 'Perform|String instruments');

  // Cleaning happens on the write, and the specialty pick follows the rename.
  const c = new Character(load('bryva'));
  check('specialty starts on Craft (Weapons)', c.data.specialtySkills.background, 'Craft|Weapons');
  const i = c.data.skills.findIndex((s) => s.name === 'Craft' && s.spec === 'Weapons');
  c.setItem('skills', i, 'spec', 'Craft (Weapons and Armor)');
  check('typed-in skill name is cleaned off', c.data.skills[i].spec, 'Weapons and Armor');
  check('specialty pick follows the rename', c.data.specialtySkills.background, 'Craft|Weapons and Armor');
  check('and keeps its full ranks', c.data.skills[i].totalRanks, 16);
  check('flag still set', c.data.skills[i].specialtyFlag, true);

  c.setItem('skills', i, 'spec', '');
  check('clearing stores null', c.data.skills[i].spec, null);
  check('pick follows that too', c.data.specialtySkills.background, 'Craft|');
}

console.log('templates -- features, sub-abilities and their tables');
{
  const b = new Character(load('bryva'));
  const tp = b.data.templates[0];
  check('template extracted', !!tp, true);
  check('link kept', tp.link.startsWith('https://docs.google.com/document/'), true);
  check('approval link kept', tp.approvalLink.startsWith('https://discord.com/'), true);
  check('named after the tab it came from', [tp.tab, tp.name],
    ['Copy of Template', 'Copy of Template']);
  // The grid is read once and retired, like the other modelled tabs.
  check('raw grid retired', (b.data.sheetTabs || []).some((t) => /Template/.test(t.name)), false);

  const names = tp.features.map((f) => f.name);
  check('groups, in sheet order', names, ['Culinary Stamina', 'Omni-Cooking',
    'Burning Calories!', 'Exceptional Chef', 'Temporal Cookbook', 'Temporal Haze']);
  const cs = tp.features[0];
  check('typed Ex', cs.type, 'Ex');
  check('has description', cs.text.length > 20, true);

  // "Omni-Cooking: X" is how the sheet writes a sub-ability of Omni-Cooking.
  const omni = tp.features[1];
  check('sub-abilities gathered under their parent', omni.children.map((c) => c.name), [
    'Omni-Cooking: Precise Preparation',
    'Omni-Cooking: Ingredient Ranks',
    'Omni-Cooking: Nose-To-Tail',
  ]);
  check('a sub-ability carries its own type', omni.children[0].type, 'Ex');
  check('and its own text', omni.children[0].text.length > 20, true);
  check('groups do not nest further', omni.children.every((c) => c.children === undefined), true);

  // The second column of features is read the same way as the first, including
  // its Type: markers -- which the old block scan never looked at.
  check('right-hand column typed too', [tp.features[4].type, tp.features[5].type], ['Su', 'Su']);

  // Tables: the old scan turned each into a feature named after its first
  // header and threw the other columns away.
  const ranks = omni.children[1].tables[0];
  check('ingredient ranks table found', ranks.columns,
    ['Rank', 'Description', 'Minimum Effective Spell DC']);
  check('every row kept', ranks.rows.length, 7);
  check('and every column of them', ranks.rows[1].cells,
    ['E', 'Standard, run-of-the-mill.', 15]);
  const ingredients = omni.children[2].tables[0];
  check('nose-to-tail table found', ingredients.columns,
    ['Type', 'Ingredient 1', 'Ingredient 2', 'Additional Information']);
  check('with its eleven creature types', ingredients.rows.length, 11);
  // A table's columns are the ones the block uses, not the ones between them:
  // the school table spans L, N, Q and T because of the sheet's merged cells.
  const schools = tp.features[5].tables[0];
  check('school table spans its four real columns', schools.columns,
    ['School', 'Discipline', 'Sphere', 'Monster Abilities/Class Features']);
  check('school table rows', schools.rows.length, 20);

  // Nothing on Bryva's tab is left over, so she gets no Temporary group.
  check('no temporary group needed', tp.features.some((f) => f.temporary), false);

  b.setItem('templates.0.features', 0, 'name', 'Renamed Feature');
  check('feature editable', b.data.templates[0].features[0].name, 'Renamed Feature');
  b.setItem('templates.0.features.1.children', 0, 'type', 'Su');
  check('sub-ability editable', b.data.templates[0].features[1].children[0].type, 'Su');
  b.setItem(`templates.0.features.1.children.1.tables.0.rows`, 0, 'cells.1', 'Inedible.');
  check('table cell editable',
    b.data.templates[0].features[1].children[1].tables[0].rows[0].cells[1], 'Inedible.');

  // Everything above survives an export and a re-import: the workbook's grid
  // is retired on the way in, so the structured block is the only copy.
  const back = new Character(b.toJSON());
  const bt = back.data.templates[0];
  check('round trips through export', [
    bt.features.map((f) => f.name),
    bt.features[1].children.map((f) => f.name),
    bt.features[1].children[1].tables[0].columns,
    bt.features[1].children[1].tables[0].rows[0].cells[1],
  ], [
    ['Renamed Feature', 'Omni-Cooking', 'Burning Calories!', 'Exceptional Chef',
      'Temporal Cookbook', 'Temporal Haze'],
    ['Omni-Cooking: Precise Preparation', 'Omni-Cooking: Ingredient Ranks',
      'Omni-Cooking: Nose-To-Tail'],
    ['Rank', 'Description', 'Minimum Effective Spell DC'],
    'Inedible.',
  ]);
  // Re-importing does not re-run the sheet's "<parent>: <name>" grouping, so a
  // sub-ability the player promoted to a group of its own stays one.
  back.moveTemplateChild(0, 1, 2, 1, 2);
  const promoted = new Character(back.toJSON());
  promoted.data.templates[0].features.push(
    promoted.data.templates[0].features[1].children.pop(),
  );
  const settled = new Character(promoted.toJSON());
  check('a promoted sub-ability stays a group',
    settled.data.templates[0].features.map((f) => f.name).at(-1), 'Omni-Cooking: Nose-To-Tail');
}

console.log('templates -- an untouched template tab imports as nothing');
{
  // Four of the five sheets carry the blank template: two link labels and six
  // empty "Type:" slots. None of that is the character's, so none of it
  // arrives -- and the tab stays off until the ⚙ manager asks for it.
  for (const id of IDS.filter((x) => x !== 'bryva')) {
    const c = new Character(load(id));
    check(`${id} imports no template`, c.data.templates, []);
    check(`${id} keeps no raw Template grid`,
      (c.data.sheetTabs || []).some((t) => /Template/.test(t.name)), false);
  }
}

console.log('templates -- what cannot be placed is kept, not dropped');
{
  // A template laid out in a shape the scan does not understand: no "Type:"
  // markers at all, so there is nothing to hang the content off.
  const raw = load('bryva');
  raw.extraTabs['Copy of Template'] = {
    hidden: false,
    rows: [
      { r: 2, cells: [null, 'Template Link', 'https://example.invalid/doc'] },
      { r: 5, cells: [null, 'Grudge Table', 'Rank', 'Effect'] },
      { r: 6, cells: [null, null, 'I', 'A stern look'] },
    ],
  };
  const c = new Character(raw);
  const tp = c.data.templates[0];
  check('a template is still made', !!tp, true);
  check('the link is still read', tp.link, 'https://example.invalid/doc');
  check('one group, marked temporary', [tp.features.length, tp.features[0].temporary], [1, true]);
  check('and it is called Temporary', tp.features[0].name, 'Temporary');
  const t = tp.features[0].tables[0];
  check('every stray cell survives', t.rows.map((r) => r.cells),
    [['Grudge Table', 'Rank', 'Effect'], [null, 'I', 'A stern look']]);
  check('a temporary group is an ordinary group otherwise',
    [Array.isArray(tp.features[0].children), typeof tp.features[0].text], [true, 'string']);
  // Once its contents have been re-homed it is deleted like any other group,
  // and nothing brings it back: the grid it came from is gone.
  c.listRemove('templates.0.features', 0);
  const again = new Character(c.toJSON());
  check('deleting it sticks', again.data.templates[0].features.length, 0);

  // A table with no feature above it cannot be attached to one, so it is kept
  // the same way rather than being invented a home.
  const raw2 = load('bryva');
  raw2.extraTabs['Copy of Template'] = {
    hidden: false,
    rows: [
      { r: 5, cells: [null, 'Rank', null, null, null, 'DC'] },
      { r: 6, cells: [null, 'F', null, null, null, 1] },
      { r: 8, cells: [null, 'Real Feature', null, null, 'Type:', 'Su'] },
      { r: 9, cells: [null, 'It does a thing.'] },
    ],
  };
  const c2 = new Character(raw2);
  const f2 = c2.data.templates[0].features;
  check('the feature is read', [f2[0].name, f2[0].type, f2[0].text],
    ['Real Feature', 'Su', 'It does a thing.']);
  check('the orphan table lands in Temporary', f2[1].temporary, true);
  check('with its cells', f2[1].tables[0].rows.map((r) => r.cells),
    [['Rank', 'DC'], ['F', 1]]);
}

console.log('templates -- a sheet carrying both template tabs keeps both');
{
  const raw = load('bryva');
  raw.extraTabs.Template = {
    hidden: false,
    rows: [
      { r: 5, cells: [null, 'Second Template Ability', null, null, 'Type:', 'Sp'] },
      { r: 6, cells: [null, 'It also does a thing.'] },
    ],
  };
  const c = new Character(raw);
  check('both tabs import', c.data.templates.map((t) => t.tab), ['Template', 'Copy of Template']);
  check('and neither grid is left behind',
    (c.data.sheetTabs || []).some((t) => /Template/.test(t.name)), false);
  check('the second one is read the same way',
    [c.data.templates[0].features[0].name, c.data.templates[0].features[0].type],
    ['Second Template Ability', 'Sp']);
}

console.log('templates -- groups and sub-abilities reorder');
{
  const c = new Character(load('bryva'));
  const names = () => c.data.templates[0].features.map((f) => f.name);
  const kids = (i) => c.data.templates[0].features[i].children.map((x) => x.name);

  // A group moves among the groups. `to` counts positions before the move,
  // which is what a drop between two cards means.
  c.moveTemplateGroup(0, 5, 0);
  check('group dragged to the front', names()[0], 'Temporal Haze');
  c.moveTemplateGroup(0, 0, 6);
  check('and back to the end', names()[5], 'Temporal Haze');

  // A sub-ability reorders within its group...
  const omni = names().indexOf('Omni-Cooking');
  c.moveTemplateChild(0, omni, 2, omni, 0);
  check('sub-ability moved to the top of its group', kids(omni)[0], 'Omni-Cooking: Nose-To-Tail');
  check('without leaving the group', c.data.templates[0].features[omni].children.length, 3);

  // ...and moves to another group, where it is still a sub-ability.
  c.moveTemplateChild(0, omni, 0, 0, 0);
  check('moved out of its group', kids(omni).length, 2);
  check('and into the other one', kids(0), ['Omni-Cooking: Nose-To-Tail']);
  check('the group it left is untouched otherwise', names()[omni], 'Omni-Cooking');

  // There is no move that puts a sub-ability above the feature it hangs off:
  // the destination is a group and a position inside it, and a group index
  // that does not exist is refused rather than promoting it.
  c.moveTemplateChild(0, 0, 0, 99, 0);
  check('a group that does not exist is refused', kids(0).length, 1);
  check('nothing was promoted to a group', names().includes('Omni-Cooking: Nose-To-Tail'), false);

  // ↑ / ↓ do the same moves without a mouse, spilling into the next group at
  // either end rather than stopping dead.
  const d = new Character(load('bryva'));
  const dkids = (i) => d.data.templates[0].features[i].children.map((x) => x.name);
  d.nudgeTemplateChild(0, 1, 0, -1);
  check('↑ from the top lands in the group above', dkids(0), ['Omni-Cooking: Precise Preparation']);
  check('at the end of it', d.data.templates[0].features[0].children.length, 1);
  d.nudgeTemplateChild(0, 0, 0, 1);
  check('↓ from the bottom lands first in the group below', dkids(1)[0],
    'Omni-Cooking: Precise Preparation');
  d.nudgeTemplateChild(0, 0, 0, -1);
  check('↑ out of the first group does nothing', dkids(0), []);
}

console.log('templates -- tables are editable in both directions');
{
  const c = new Character(load('bryva'));
  const path = 'templates.0.features.1.children.1.tables.0';
  const table = () => c.data.templates[0].features[1].children[1].tables[0];

  c.addTemplateTableColumn(path, 'Notes');
  check('column added', table().columns.length, 4);
  check('every row grew with it', table().rows.every((r) => r.cells.length === 4), true);
  c.removeTemplateTableColumn(path, 1);
  check('column removed', table().columns, ['Rank', 'Minimum Effective Spell DC', 'Notes']);
  check('and the cell under it in every row', table().rows[0].cells.length, 3);
  check('the right cells went', table().rows[0].cells[0], 'F');

  // Rows are an ordinary list, so they add, move and delete like every other.
  c.listAdd(`${path}.rows`, { cells: [null, null, null] });
  check('row added', table().rows.length, 8);
  c.listMove(`${path}.rows`, 7, -1);
  check('row moved', table().rows[6].cells[0], null);
  c.listRemove(`${path}.rows`, 6);
  check('row removed', table().rows.length, 7);

  // Where a table is drawn is not always what it means: the spell-school table
  // is written beside Temporal Haze and belongs to Omni-Cooking.
  const haze = 'templates.0.features.5';
  const omni = 'templates.0.features.1';
  c.moveTemplateTable(haze, 0, omni);
  check('table moved to the ability it belongs to',
    [c.data.templates[0].features[5].tables.length,
      c.data.templates[0].features[1].tables[0].columns[0]], [0, 'School']);
  c.moveTemplateTable(omni, 0, `${omni}.children.1`);
  check('and on to a sub-ability',
    c.data.templates[0].features[1].children[1].tables.map((t) => t.columns[0]),
    ['Rank', 'School']);
  c.moveTemplateTable(omni, 0, omni);
  check('moving a table to where it already is does nothing',
    c.data.templates[0].features[1].tables.length, 0);

  // A feature can be given a table it never had, and a template can be
  // started from nothing on a character that never imported one.
  const fresh = new Character(load('angou'));
  fresh.listAdd('templates', { tab: null, name: 'Half-Dragon', link: null, approvalLink: null, features: [] });
  fresh.listAdd('templates.0.features', { name: 'Breath Weapon', type: 'Su', text: '', tables: [], children: [] });
  fresh.listAdd('templates.0.features.0.tables', { caption: '', columns: ['Level', 'Dice'], rows: [] });
  fresh.listAdd('templates.0.features.0.children', { name: 'Breath Weapon: Recharge', type: 'Su', text: '', tables: [] });
  check('a template can be built from nothing',
    [fresh.data.templates[0].features[0].name,
      fresh.data.templates[0].features[0].tables[0].columns,
      fresh.data.templates[0].features[0].children[0].name],
    ['Breath Weapon', ['Level', 'Dice'], 'Breath Weapon: Recharge']);
}

console.log('templates -- table cells merge by what is written in them');
{
  // The spans are worked out from the grid every time it is drawn; nothing
  // about a merge is stored beside the cells.
  const shape = (g) => mergeLayout(g).map((row) => row
    .map((s) => (s ? `${s.colspan}x${s.rowspan}` : '.')).join(' '));

  check('a plain grid merges nothing', shape([['A', 'B'], ['C', 'D']]),
    ['1x1 1x1', '1x1 1x1']);
  check('----- joins the cell on its left', shape([['A', '-----'], ['C', 'D']]),
    ['2x1 .', '1x1 1x1']);
  check('and keeps going', shape([['A', '-----', '-----']]), ['3x1 . .']);
  check('||||| joins the cell above', shape([['A', 'B'], ['|||||', 'D']]),
    ['1x2 1x1', '. 1x1']);
  check('a block merges both ways', shape([['A', '-----'], ['|||||', '|||||']]),
    ['2x2 .', '. .']);
  check('and either marker fills its corner', shape([['A', '-----'], ['|||||', '-----']]),
    ['2x2 .', '. .']);

  // Five is what the eye reads, but the count is not the point; three is the
  // floor so that the single "-" the sheets use for "none" stays content.
  check('the sheets\' own "-" is not a merge', shape([['A', '-'], ['B', '--']]),
    ['1x1 1x1', '1x1 1x1']);
  check('three or more is', shape([['A', '---'], ['B', '|||']]), ['2x1 .', '1x1 1x1']);

  // A marker with nothing to merge into is a cell holding dashes.
  check('a marker in the first column is content', shape([['-----', 'B']]), ['1x1 1x1']);
  check('a marker in the first row is content', shape([['|||||', 'B']]), ['1x1 1x1']);

  // A merge only grows while it stays rectangular -- an L-shaped run of
  // markers takes what it can and the rest shows as the text it is, which is
  // how a mistyped merge announces itself.
  check('an L-shape does not swallow its neighbour',
    shape([['A', '-----'], ['|||||', 'X']]), ['2x1 .', '1x1 1x1']);
  check('a merge cannot steal a claimed cell',
    shape([['A', 'B'], ['-----', '|||||']]), ['1x1 1x2', '1x1 .']);

  // The real one: Bryva's spell-school table, whose first column pairs a
  // school with the ingredients it yields.
  const c = new Character(load('bryva'));
  const school = c.data.templates[0].features[5].tables[0];
  const rows = school.rows.map((r) => [...r.cells]);
  check('imports unmerged', mergeLayout(rows)[1].every((s) => s && s.colspan === 1), true);
  // Merging the three empty cells beside "Grains, Plants" into it.
  rows[1] = [rows[1][0], '-----', '-----', '-----'];
  check('and merges once asked', shape(rows)[1], '4x1 . . .');
}

console.log('templates -- prose and tables carry inline formulas');
{
  const c = new Character(load('bryva'));
  c.setItem('templates.0.features', 0, 'text', 'Pool of {culinary.max = 2 + level}.');
  c.setItem('templates.0.features.1.children', 0, 'text', 'Bonus {omni.bonus = int.mod + 1}.');
  c.setItem('templates.0.features.1.children.1.tables.0.rows', 0, 'cells.2',
    'DC {ranks.floor = 10 + level}');
  const scope = c.scope();
  check('a feature defines a name', scope.culinary.max, 2 + c.data.identity.level);
  check('so does a sub-ability', scope.omni.bonus, scope.int.mod + 1);
  check('and so does a table cell', scope.ranks.floor, 10 + c.data.identity.level);
  const audited = c.audit().map((r) => r.formula);
  check('all three are audited', [
    audited.includes('2 + level'),
    audited.includes('int.mod + 1'),
    audited.includes('10 + level'),
  ], [true, true, true]);
}

console.log('training values reach the formula scope');
{
  const c = new Character(load('angou'));
  const scope = c.scope();
  check('caster.level', scope.caster.level, 20);
  check('caster.sp', scope.caster.sp, 83);
  check('practitioner.dc', scope.practitioner.dc, 36);
  check('unarmed.talents', scope.unarmed.talents, 19);
  const t = c.addTracker({ name: 'SP Pool', maxFormula: 'caster.sp' });
  check('tracker can read SP', t.max, 83);
}

console.log('gestalt classes drive save bases');
{
  // Import fidelity already asserts totals; here, the bases themselves.
  const c = new Character(load('angou'));
  check('angou fort base (20 good levels)', c.data.saves.fortitude.base, 12);
  check('angou ref base', c.data.saves.reflex.base, 12);
  check('angou will base', c.data.saves.will.base, 12);
  check('gestalt hp/level (best d10)', c.data.gestalt.hpPerLevel, 10);
  check('gestalt ranks/level', c.data.gestalt.ranksPerLevel, 4);

  // All-poor sanity: a lone poor-save class at 20 gives floor(20/3) = 6.
  const solo = new Character(load('angou'));
  solo.data.classes = [{ name: 'Test', hd: 8, goodFort: false, goodRef: false, goodWill: false, skillRanks: 2 }];
  solo.recompute();
  check('poor save at 20', solo.data.saves.fortitude.base, 6);
  solo.data.classes[0].goodFort = true;
  solo.recompute();
  check('good save at 20', solo.data.saves.fortitude.base, 12);

  // Class levels override.
  const b = new Character(load('bryva'));
  const armiger = b.data.classes.findIndex((x) => /Armiger/.test(x.name || ''));
  if (armiger >= 0) {
    b.setItem('classes', armiger, 'levelsOverride', 4);
    check('override caps counted levels', b.data.classes[armiger].gestaltLevels, 4);
    b.setItem('classes', armiger, 'levelsOverride', null);
  }
}

console.log('skill point budget');
{
  const c = new Character(load('angou'));
  const b = c.data.skillBudget;
  check('per level = ranks + int + bonus', b.perLevel, 8);
  check('available at 20', b.available, 160);
  check('assigned (bought only)', b.assigned, 140);
  check('remaining', b.remaining, 20);
  check('status warns on unspent', b.status, 'warning');

  // Over-assign -> error.
  const s0 = c.data.skills.findIndex((s) => (s.rankSources?.bought || 0) === 0);
  c.setItem('skills', s0, 'rankSources.bought', 25);
  check('over-assigning flags an error', c.data.skillBudget.status,
    c.data.skillBudget.assigned > c.data.skillBudget.available ? 'error' : c.data.skillBudget.status);
  c.setItem('skills', s0, 'rankSources.bought', 0);

  // Pseudo-rows no longer imported as skills.
  check('no budget pseudo-skills', c.data.skills.some((s) => /Bonus Skill|Int Bonus|Total Skill|Other Trackables|Name, Info/.test(s.name)), false);
}

console.log('formula-valued skill ranks');
{
  const c = new Character(load('nico'));
  const i = c.data.skills.findIndex((s) => s.name === 'Appraise');
  c.setItem('skills', i, 'rankSources.bought', 'level');
  check('"level" resolves', c.data.skills[i].boughtResolved, 15);
  c.setItem('skills', i, 'rankSources.bought', 'floor(level - 2)');
  check('floor(level-2) resolves', c.data.skills[i].boughtResolved, 13);
  check('counts against the budget', c.data.skillBudget.assigned >= 13, true);
  c.setItem('skills', i, 'rankSources.bought', 'wat + 1');
  check('bad formula reports', typeof c.data.skills[i].boughtError, 'string');
  check('and appears in the audit', c.audit().some((a) => a.source === 'skill' && a.status === 'error'), true);
  c.setItem('skills', i, 'rankSources.bought', 0);
}

console.log('trait slots');
{
  const c = new Character(load('angou'));
  const t = c.data.traitSlots;
  check('trait 1 category', t.trait1.category, 'Faith');
  check('trait 3 category', t.trait3.category, 'Combat');
  check('trait 3 text', /Talented Knuckle/.test(t.trait3.text || ''), true);
  check('drawback 1 filled', /Umbral Unmasking/.test(t.drawback1.text || ''), true);
  check('major drawback', /Blatant/.test(t.majorDrawback.category || t.majorDrawback.text || ''), true);
  c.set('traitSlots.trait5.text', 'New trait');
  check('slots editable', c.data.traitSlots.trait5.text, 'New trait');
  c.data.traitCategories.push('Akashic');
  check('custom categories stored', c.data.traitCategories.includes('Akashic'), true);
}

console.log('granted feats -- each row names what handed it over');
{
  const c = new Character(load('narockro'));
  const g = c.data.grantedFeats;
  check('drawback feat lifted out of the trait slot', g.drawback.name, 'Lingering Performance');
  check('with the description it came with', /bardic performance/.test(g.drawback.note), true);
  check('specialty feat is the row after the marker', g.specialty.name, 'Combat Tenacity');
  check('the "Specialty" label is not itself a feat',
    [g.drawback.name, g.specialty.name, ...g.others.map((o) => o.name)].includes('Specialty'), false);
  check('oaths carry their level as the source', g.others[0].source, 'Oath 2');
  check('oath feat', g.others[0].name, 'Muscular Reflexes (+5 AoOs)');
  check('the Drawback and Oaths columns are folded in',
    c.data.featGroups.some((x) => /^(drawbacks?|oaths?)$/i.test(x.name)), false);
  check('the picked-at-a-level groups are untouched',
    c.data.featGroups.map((x) => x.name), ['Level Up', 'Class', 'Other/Flex']);
  check('no second copy left in the trait slot', c.data.traitSlots.drawbackFeat, undefined);

  // The migration runs once; a saved document keeps what it already has.
  check('stable across a save/load',
    new Character(JSON.parse(JSON.stringify(c.toJSON()))).data.grantedFeats, g);

  // Bryva's import put the feat's name in the other of the two fields.
  check('name found whichever field the sheet filled',
    new Character(load('bryva')).data.grantedFeats.drawback.name, 'Apprentice Chef');
  // Angou's sheet never named a specialty feat, so the row waits to be filled.
  check('an unnamed specialty feat is simply empty',
    new Character(load('angou')).data.grantedFeats.specialty.name, '');
}

console.log('drawback feats header is not a drawback feat');
{
  const n = new Character(load('nico'));
  const bo = n.data.training.magic.tradition.boughtOff;
  check('nico bought-off list has no header', bo.includes('Drawback Feats'), false);
  check('nico bought-off entries (three rows of feats)', bo.length, 7);
  check('and stops before the bonus-talents block', bo.some((x) => /Casting Bonus|Sphere$/.test(x)), false);
  check('trailing bare number counts double', (await import('../app/js/rules.js')).drawbackWeight('Somatic Casting 2'), 2);
}

console.log('advanced magic training');
{
  // Saburo imports with AMT already on — his Wizard dip alone gives CL 1, and
  // the low-caster floor is what brings him to his sheet's cached CL 4.
  const s = new Character(load('saburo'));   // level 9
  check('saburo imports with AMT on', s.data.training.magic.amt, true);
  check('AMT floors CL at low-caster', s.data.training.magic.globalCL, Math.floor(9 * 0.5));
  check('which matches his sheet cache', s.data.training.magic.globalCL, s.data.training.magic.sheet.totalCL);
  s.set('training.magic.mythicAmt', true);
  check('mythic AMT upgrades to mid-caster', s.data.training.magic.globalCL, Math.floor(9 * 0.75));
  s.set('training.magic.mythicAmt', false);
  s.set('training.magic.amt', false);
  check('without AMT only the Wizard dip counts', s.data.training.magic.globalCL, 1);
  s.set('training.magic.amt', true);
  check('restored', s.data.training.magic.globalCL, 4);
}

console.log('mythic tier, HP, tradition and stat picks');
{
  const { tierAtLevel } = await import('../app/js/rules.js');
  check('tier table: 8→1', tierAtLevel(8), 1);
  check('tier table: 13→3', tierAtLevel(13), 3);
  check('tier table: 20→10', tierAtLevel(20), 10);

  const c = new Character(load('angou'));
  check('angou tier auto from level', c.data.identity.mythicTier, 10);
  check('no override needed', c.data.mythic.tierOverride, null);
  c.set('identity.level', 16);
  check('levelling down moves the tier', c.data.identity.mythicTier, 6);
  c.set('identity.level', 20);

  const s = new Character(load('saburo'));
  check('saburo computed tier is 1', s.data.mythic.computedTier, 1);
  check('matching his sheet, so no override', s.data.mythic.tierOverride, null);
  s.set('mythic.tierOverride', 2);
  check('a GM-granted override wins', s.data.identity.mythicTier, 2);
  s.set('mythic.tierOverride', null);
  check('cleared override falls back to auto', s.data.identity.mythicTier, 1);

  // Bonus HP per tier on top of the normal maximum.
  const max0 = c.hpState.max;
  c.set('mythic.bonusHpPerTier', 5);
  check('bonus HP adds 5 × tier', c.hpState.max, max0 + 50);
  check('and reaches the formula scope', c.scope().hp.total, max0 + 50);
  c.restoreAll();
  check('rest fills to the boosted maximum', c.hpState.current, max0 + 50);
  c.set('mythic.bonusHpPerTier', 0);

  // Tradition extracted as slots, not junk ability rows.
  const tr = c.data.mythic.tradition;
  check('mandatory drawback', tr.drawback1, 'Radiant Power');
  check('quality', tr.quality, 'When All Seems Lost');
  check('boon 1 present', /Expertise/.test(tr.boon1 || ''), true);
  check('tradition rows out of the abilities list',
    (c.data.mythic.abilities || []).some((a) => /Radiant Power|When All Seems Lost/.test(a.name || '')), false);

  const st = new Character(load('saburo'));
  check('saburo old-layout tradition', st.data.mythic.tradition.drawback1, 'Relic-Bound (Katana)');
  check('saburo quality', st.data.mythic.tradition.quality, 'Flowing Power');

  // Even-tier stat picks.
  check('angou seeded five Wis picks', c.data.mythicStatPicks.filter((p) => p.ability === 'Wis').length, 5);
  const wis0 = c.data.abilities.wis.score;
  const str0 = c.data.abilities.str.score;
  c.setMythicPick(2, 'Str');
  check('reassigning tier 2 moves 2 points off Wis', c.data.abilities.wis.score, wis0 - 2);
  check('and onto Str', c.data.abilities.str.score, str0 + 2);
  c.setMythicPick(2, 'Wis');
  check('restored', c.data.abilities.wis.score, wis0);

  // Picks above the current tier do not count.
  c.set('identity.level', 14);            // tier 4 -> only tiers 2 and 4 active
  check('only two picks active at tier 4', c.data.statsBuild.wis.mythic, 4);
  c.set('identity.level', 20);
  check('all five back at tier 10', c.data.statsBuild.wis.mythic, 10);
}

console.log('typed save and AC bonuses -- the Stats tab breakdown');
{
  const c = new Character(load('narockro'));

  // Seeded from the workbook's own names, and adding up to what it said.
  const f = c.data.saves.fortitude;
  check('ABP resistance imported', f.bonuses.abpResistance, 3);
  check('the rest of the sheet total is kept, not lost', f.bonuses.sheet, 2);
  check('save still reproduces the source exactly', f.total, load('narockro').saves.fortitude.total);
  check('AC ABP deflection imported', c.data.defenses.acBonuses.abpDeflection, 2);
  check('AC ABP natural imported', c.data.defenses.acBonuses.abpNatural, 1);
  check('AC still reproduces the source exactly', c.data.defenses.ac, load('narockro').defenses.ac);

  // A bonus type reaches the defences it should, and only those.
  const ac0 = c.data.defenses.ac;
  const touch0 = c.data.defenses.touch;
  const ff0 = c.data.defenses.flatFooted;
  c.set('defenses.acBonuses.dodge', 2);
  check('dodge raises AC', c.data.defenses.ac, ac0 + 2);
  check('and touch', c.data.defenses.touch, touch0 + 2);
  check('but not flat-footed', c.data.defenses.flatFooted, ff0);
  c.set('defenses.acBonuses.dodge', 0);

  c.set('defenses.acBonuses.natural', 4);
  check('natural armour raises AC', c.data.defenses.ac, ac0 + 4);
  check('and flat-footed', c.data.defenses.flatFooted, ff0 + 4);
  check('but not touch', c.data.defenses.touch, touch0);
  c.set('defenses.acBonuses.natural', 0);

  const will0 = c.data.saves.will.total;
  c.set('saves.will.bonuses.morale', 3);
  check('a save bonus moves that save', c.data.saves.will.total, will0 + 3);
  check('and nothing else', c.data.saves.fortitude.total, load('narockro').saves.fortitude.total);
  c.set('saves.will.bonuses.morale', 0);

  // A cell may be the rule rather than a number: Force Redirection lets Str
  // stand in for Dex, up to 3 + half BAB.
  c.set('defenses.acBonuses.untyped', 'min(str.mod - dex.mod, 3 + floor(bab / 2))');
  const str = c.data.abilities.str.totalMod;
  const dex = c.data.abilities.dex.totalMod;
  const want = Math.min(str - dex, 3 + Math.floor(c.data.attack.bab / 2));
  check('the formula resolves', c.data.defenses.acBonusesResolved.untyped, want);
  check('and reaches AC', c.data.defenses.ac, ac0 + want);
  c.setBuild('str', 'untyped', 6);          // three more points of Str mod
  check('and follows its inputs', c.data.defenses.acBonusesResolved.untyped,
    Math.min(c.data.abilities.str.totalMod - dex, 3 + Math.floor(c.data.attack.bab / 2)));
  c.setBuild('str', 'untyped', 0);

  c.set('defenses.acBonuses.untyped', 'nonsense_name');
  check('a bad formula is reported', /Unknown value/.test(c.data.defenses.acBonusErrors.untyped), true);
  check('and contributes nothing rather than breaking AC', c.data.defenses.ac, ac0);
  c.set('defenses.acBonuses.untyped', 0);
  check('cleared', c.data.defenses.ac, ac0);

  // Edited blocks survive a save/load, and are not counted twice on the way.
  c.set('saves.reflex.bonuses.luck', 2);
  const round = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('round trips', round.data.saves.reflex.total, c.data.saves.reflex.total);
  check('with the bonus still itemised', round.data.saves.reflex.bonuses.luck, 2);
}

console.log('the mythic ladder -- ten tiers, a feat on the odd ones and an increase on the even');
{
  check('grants alternate', MYTHIC_TIERS.map(mythicTierGrant),
    ['Feat 1', 'RP Power 1', 'Feat 2', 'RP Power 2', 'Feat 3',
      'RP Power 3', 'Feat 4', 'RP Power 4', 'Feat 5', 'RP Power 5']);
  check('every even tier grants an increase',
    MYTHIC_TIERS.filter((t) => t % 2 === 0), MYTHIC_STAT_TIERS);
  check('tiers map back to the level they are reached at',
    MYTHIC_TIER_LEVEL, { 1: 8, 2: 10, 3: 12, 4: 14, 5: 15, 6: 16, 7: 17, 8: 18, 9: 19, 10: 20 });

  for (const id of IDS) {
    const c = new Character(load(id));
    check(`${id} ladder is ten rows`, c.data.mythic.abilities.length, MYTHIC_TIERS.length);
    check(`${id} keeps the sheet's own grant labels in order`,
      c.data.mythic.abilities.every((a, i) => !a.feat || a.feat === mythicTierGrant(i + 1)), true);
    check(`${id} increases live in the picks, not a second column`,
      c.data.mythic.abilities.some((a) => 'statBonus' in a), false);
  }

  // The increase a row named is what the picks hold, so the two views agree.
  const b = new Character(load('bryva'));      // RP Power rows all named Con
  check('bryva picks read the ladder', b.data.mythicStatPicks,
    [{ tier: 2, ability: 'Con' }, { tier: 4, ability: 'Con' }, { tier: 6, ability: 'Con' }]);
  check('and nothing above the current tier', b.data.mythicStatPicks.every((p) => p.tier <= 6), true);

  // Editing from either view is the same write.
  const con0 = b.data.abilities.con.score;
  const int0 = b.data.abilities.int.score;
  b.setMythicPick(4, 'Int');
  check('moving tier 4 takes 2 off Con', b.data.abilities.con.score, con0 - 2);
  check('and puts them on Int', b.data.abilities.int.score, int0 + 2);
  check('one set of picks, not two', b.data.mythicStatPicks.find((p) => p.tier === 4).ability, 'Int');
  b.setMythicPick(4, 'Con');
  check('restored', b.data.abilities.con.score, con0);
}

console.log('structured progression');
{
  const c = new Character(load('angou'));
  const p = c.data.progression;
  check('20 static levels', p.levels.length, 20);
  check('level 1 classes', p.levels[0].classes.includes('Legendary Kineticist')
    && p.levels[0].classes.includes('Legendary Monk'), true);
  check('computed hp/level (best d10)', p.levels[0].computed.hp, 10);
  check('computed ranks', p.levels[0].computed.ranks, 4);
  check('computed fort inc (good)', p.levels[0].computed.fort, 0.5);
  // Features are grouped per class, mapped from the sheet's column blocks.
  const kin = p.classFeatures['Legendary Kineticist'];
  check('kineticist feature group exists', !!kin, true);
  check('class-N-features renamed to Features', kin.columns.includes('Features'), true);
  check('feature text preserved', /Flurry of Blows/.test(kin.byLevel[1]?.Features || ''), true);
  const monkG = p.classFeatures['Legendary Monk'];
  check('monk group holds its block columns', monkG.columns.includes('Wild Talent (Infusion, Utility)'), true);
  check('monk wild talent migrated', /Incorporeal/.test(monkG.byLevel[1]?.['Wild Talent (Infusion, Utility)'] || ''), true);
  check('class levels listed', c.classLevelsIn('Legendary Monk').length, 20);

  // Changing a class track flows into training and gestalt.
  const monk = c.data.training.combat.classes.find((x) => x.name === 'Legendary Monk');
  const talents0 = monk.totalTalents;
  const t1 = p.levels[19].classes.indexOf('Legendary Monk');
  c.setProgressionClass(20, t1, null);
  check('dropping a class level drops a talent', c.data.training.combat.classes
    .find((x) => x.name === 'Legendary Monk').totalTalents, talents0 - 1);
  c.setProgressionClass(20, t1, 'Legendary Monk');
  check('restored', c.data.training.combat.classes
    .find((x) => x.name === 'Legendary Monk').totalTalents, talents0);

  // Track management, including deletion.
  const tracks0 = p.tracks;
  c.addProgressionTrack();
  check('tristalt: track added', c.data.progression.tracks, tracks0 + 1);
  c.setProgressionClass(1, tracks0, 'Incanter');
  check('new track assignable', c.data.progression.levels[0].classes[tracks0], 'Incanter');
  // Deleting a track never deletes feature text: groups key by class name.
  c.setClassFeature('Incanter', 1, 'Features', 'Sphere specialization');
  c.removeProgressionTrack(tracks0);
  check('track deletable', c.data.progression.tracks, tracks0);
  check('its class assignments removed', c.data.progression.levels[0].classes.length <= tracks0, true);
  check('incanter features survive track removal',
    c.data.progression.classFeatures.Incanter?.byLevel?.[1]?.Features, 'Sphere specialization');

  // Per-class feature columns.
  c.addClassFeatureColumn('Legendary Monk', 'Ki Notes');
  check('column added', c.data.progression.classFeatures['Legendary Monk'].columns.includes('Ki Notes'), true);
  c.setClassFeature('Legendary Monk', 3, 'Ki Notes', 'Extra ki');
  check('cell set', c.data.progression.classFeatures['Legendary Monk'].byLevel[3]['Ki Notes'], 'Extra ki');
  const mcols = c.data.progression.classFeatures['Legendary Monk'].columns;
  c.renameClassFeatureColumn('Legendary Monk', mcols.indexOf('Ki Notes'), 'Ki Log');
  check('rename keeps values', c.data.progression.classFeatures['Legendary Monk'].byLevel[3]['Ki Log'], 'Extra ki');
  c.removeClassFeatureColumn('Legendary Monk', c.data.progression.classFeatures['Legendary Monk'].columns.indexOf('Ki Log'));
  check('column removed', c.data.progression.classFeatures['Legendary Monk'].columns.includes('Ki Log'), false);
  check('progressionClasses lists active classes', c.progressionClasses().includes('Legendary Kineticist'), true);

  // Column widths persist and follow renames.
  c.setColumnWidth('progfeat-Legendary Monk', 'Features', 340);
  check('width saved', c.data.uiPrefs.colWidths['progfeat-Legendary Monk'].Features, 340);
  const cols2 = c.data.progression.classFeatures['Legendary Monk'].columns;
  c.renameClassFeatureColumn('Legendary Monk', cols2.indexOf('Features'), 'Level Features');
  check('width follows rename', c.data.uiPrefs.colWidths['progfeat-Legendary Monk']['Level Features'], 340);
  c.renameClassFeatureColumn('Legendary Monk',
    c.data.progression.classFeatures['Legendary Monk'].columns.indexOf('Level Features'), 'Features');
}

console.log('equipment: weapons, armor, load');
{
  const c = new Character(load('angou'));
  const e = c.data.equipment;
  const un = e.weapons.find((w) => w.name === 'Unarmed Strike');
  check('unarmed weapon imported', !!un, true);
  check('attack reproduces the sheet (34 melee + 5 enh + 1 misc)', un.attackTotal, 40);
  check('with a zero offset', un.attackOffset, 0);
  check('damage bonus = Str 14 × 1.5 + enh 5', un.damageBonus, 26);
  check('damage string', un.damageTotal, '12d8+26');
  check('linked to practitioner unarmed dice', un.useUnarmedDice, true);

  // The link is live: fewer unarmed talents -> smaller weapon dice.
  c.set('training.combat.unarmed.brawlersVest', 0);
  check('weapon dice follow the unarmed calculator',
    c.data.equipment.weapons.find((w) => w.name === 'Unarmed Strike').damageTotal.startsWith('12d6'), true);
  c.set('training.combat.unarmed.brawlersVest', 4);

  // Enhancement flows into attack and damage.
  const i = e.weapons.indexOf(un);
  c.setItem('equipment.weapons', i, 'enhancement', 6);
  const un2 = c.data.equipment.weapons[i];
  check('enhancement +1 moves attack', un2.attackTotal, 41);
  check('and damage', un2.damageBonus, 27);
  c.setItem('equipment.weapons', i, 'enhancement', 5);
}
{
  const b = new Character(load('bryva'));
  const e = b.data.equipment;
  check('two shields extracted', e.shields.length, 2);
  check('only the first counts by default', e.shields[0].active && !e.shields[1].active, true);
  check('five kitchen weapons', e.weapons.length, 5);
  const knife = e.weapons[0];
  check('knife attack matches sheet', knife.attackTotal, 29);

  // ACP flows into armor-check skills.
  const acro = b.data.skills.find((s) => s.name === 'Acrobatics');
  const bonus0 = acro.bonus;
  b.set('equipment.armor.acp', -6);   // was -3
  check('worsening ACP lowers Acrobatics', b.data.skills.find((s) => s.name === 'Acrobatics').bonus, bonus0 - 3);
  b.set('equipment.armor.acp', -3);
  check('restored', b.data.skills.find((s) => s.name === 'Acrobatics').bonus, bonus0);
}
{
  // Carried weight reconciles and follows item weights.
  for (const id of IDS) {
    const raw = load(id);
    const c = new Character(raw);
    check(`${id} carried matches import`, c.data.carry.carried, raw.carry.carried);
  }
  const c = new Character(load('angou'));
  const carried0 = c.data.carry.carried;
  c.setItem('equipment.gear', 0, 'weight', 10);
  check('adding item weight raises carried', c.data.carry.carried, carried0 + 10);
  c.setItem('equipment.gear', 0, 'weight', 0);
  check('restored', c.data.carry.carried, carried0);
}

console.log('weapon damage/to-hit tokens');
{
  const { diceString, diceAverage, parseDiceExpr } = await import('../app/js/rules.js');
  const p = parseDiceExpr('2d6 + 13', null);
  check('dice parsed', p.dice, { 6: 2 });
  check('flat parsed', p.flat, 13);
  check('string form', diceString(p.dice, p.flat), '2d6+13');
  check('average', diceAverage(p.dice, p.flat), 20);
  check('notes kept aside', parseDiceExpr('4d6 (8d6)', null).notes, ['(8d6)']);

  const c = new Character(load('angou'));
  const i = c.data.equipment.weapons.findIndex((w) => w.name === 'Unarmed Strike');
  const w = () => c.data.equipment.weapons[i];
  check('base line: avg of 12d8+26', w().calc.baseAvg, 80);
  check('no tokens by default', w().calc.hasTokens, false);

  c.setItem('equipment.weapons', i, 'special', 'Deathgrip [[2d6+13]] and blessed {{2}}');
  check('damage tokens combine dice', w().calc.totalDmgStr, '12d8+2d6+39');
  check('total average', w().calc.totalAvg, 100);
  check('to-hit token adds', w().calc.totalAtk, 42);
  check('attack string', w().calc.totalAtkStr, '+42');

  c.setItem('equipment.weapons', i, 'special', 'Blood surge [[con.mod]]');
  check('formula token reads the sandbox', w().calc.tokDmg.flat, c.data.abilities.con.mod);
  c.setItem('equipment.weapons', i, 'special', 'Blood surge [[con.tempMod * 2]]');
  check('temp mods and maths work too', w().calc.tokDmg.flat, c.data.abilities.con.totalMod * 2);

  c.setItem('equipment.weapons', i, 'special', 'Inspired {{1d4}}');
  check('to-hit dice render in the string', w().calc.totalAtkStr, '+40+1d4');

  c.setItem('equipment.weapons', i, 'special', 'Broken [[wat + 1]]');
  check('bad token reported, not thrown', w().calc.errors.length, 1);
  check('and excluded from totals', w().calc.totalAvg, w().calc.baseAvg);
  check('and visible to the GM audit', c.audit().some((a) => a.source === 'weapon' && a.status === 'error'), true);

  // A name defined in prose, used in a weapon's tokens. Braces are prose
  // syntax and the sandbox does not know them, so the value has to be spliced
  // into the text *before* anything reads it as dice or as a formula --
  // otherwise every one of these reported "Unexpected character" and quietly
  // contributed nothing, while the same text rendered correctly in the note
  // it was written in.
  const notesWere = c.data.notes;
  c.data.notes = [{ title: 'Names', body:
    'grip {deathgrip.dmg = 13}, blast {kinetic.fist = dice(4, 8)}, small {bonus.b = 2}' }];
  c.recompute();
  check('the names resolved', [c.inlineNames['deathgrip.dmg'], c.inlineNames['kinetic.fist']], [13, '4d8']);

  c.setItem('equipment.weapons', i, 'special', 'Grip [[{deathgrip.dmg}]]');
  check('a name in a damage token', w().calc.tokDmg.flat, 13);
  check('and no error', w().calc.errors, []);

  c.setItem('equipment.weapons', i, 'special', 'Grip {{ {deathgrip.dmg} }}');
  check('a name in a to-hit token', w().calc.totalAtk, 40 + 13);
  check('which was the whole complaint', w().calc.totalAtkStr, '+53');

  c.setItem('equipment.weapons', i, 'special', 'Blast [[{kinetic.fist}]]');
  check('a name holding dice text reads as dice', w().calc.tokDmg.dice, { 8: 4 });
  check('and not as a number', w().calc.tokDmg.flat, 0);

  c.setItem('equipment.weapons', i, 'special', 'Mixed [[2d6 + {bonus.b}]]');
  check('a name mixed into an expression', [w().calc.tokDmg.dice, w().calc.tokDmg.flat], [{ 6: 2 }, 2]);

  c.setItem('equipment.weapons', i, 'special', 'Crit [[{deathgrip.dmg} Crit]]');
  check('a name in a crit-only token', w().calc.critExtra.flat, 13);
  check('and stays out of the normal total', w().calc.totalAvg, w().calc.baseAvg);

  c.setItem('equipment.weapons', i, 'special', 'Gone [[{no.such.name}]]');
  check('a name that does not resolve is reported',
    w().calc.errors, ['{no.such.name}: Unknown value "no.such.name"']);
  check('and contributes nothing', w().calc.totalAvg, w().calc.baseAvg);

  c.setItem('equipment.weapons', i, 'bonusCritDamage', '{deathgrip.dmg}');
  check('the Bonus Crit Damage column reads names too', w().calc.critExtra.flat, 13);
  c.setItem('equipment.weapons', i, 'bonusCritDamage', '');

  // The Dice field, on a weapon that uses its own dice -- Unarmed Strike
  // takes the unarmed sphere's, so its Dice field is never read.
  const diceWas = w().dice;
  const unarmedWas = w().useUnarmedDice;
  c.setItem('equipment.weapons', i, 'useUnarmedDice', false);
  c.setItem('equipment.weapons', i, 'dice', '1d8+{bonus.b}');
  check('a name inside the Dice field', w().diceResolved, '1d8+2');
  check('and it reads as dice plus a number', [w().calc.baseDmgDice, w().calc.baseDmgFlat - w().damageBonus], [{ 8: 1 }, 2]);
  c.setItem('equipment.weapons', i, 'dice', '{kinetic.fist}');
  check('a whole Dice field that is one name still works', w().diceResolved, '4d8');
  c.setItem('equipment.weapons', i, 'dice', '{bonus.b}');
  check('and a numeric one is still that many d6', w().diceResolved, '2d6');
  c.setItem('equipment.weapons', i, 'dice', diceWas);
  c.setItem('equipment.weapons', i, 'useUnarmedDice', unarmedWas);
  c.data.notes = notesWere;
  c.recompute();

  c.setItem('equipment.weapons', i, 'special', '');
  check('cleared', w().calc.hasTokens, false);

  // Criticals: the Crit tag marks what multiplies. Base damage always does;
  // untagged tokens add once; tagged tokens are crit-only and multiplied.
  check('crit mult parsed from x4', w().calc.critMultNum, 4);
  check('base crit average = avg × 4', w().calc.critAvg, 320);

  c.setItem('equipment.weapons', i, 'special', 'Burst [[2d8 Crit]] and sure strike {{4 Crit}}');
  check('crit damage token excluded from normal totals', w().calc.totalAvg, w().calc.baseAvg);
  check('and normal attack untouched', w().calc.totalAtk, 40);
  check('tagged crit dice are multiplied', w().calc.critAvg, 320 + 9 * 4);
  check('confirm bonus applies', w().calc.confirmTotal, 44);
  check('confirm string', w().calc.confirmStr, '+44');
  check('crit string shows the multiplied dice', w().calc.critStr, '(12d8+26)×4+2d8×4');

  // Mixed: untagged riders add once on a crit; tagged ones multiply.
  c.setItem('equipment.weapons', i, 'special', '[[2d6]] [[2d8 Crit]] {{2}} {{4 Crit}}');
  check('normal tokens still flow', w().calc.totalAvg, 80 + 7);
  check('crit: base ×4 + rider once + tagged ×4', w().calc.critAvg, 80 * 4 + 7 + 9 * 4);
  check('confirm stacks on the boosted attack', w().calc.confirmTotal, 42 + 4);

  // The crit string has to add up to the average printed beside it. A bare
  // "×4" could not: the multiplier takes the base and nothing else, so a row
  // reading "dmg 12d8+2d6+26 · crit ×4" gave no route to its own number and
  // read as though the rider had been dropped on a crit.
  check('every term is shown, in the order they are worked out',
    w().calc.critStr, '(12d8+26)×4+2d6+2d8×4');
  // (12d8+26)×4 = 320, +2d6 = 7, +2d8×4 = 36 — the 363 checked just above.
  check('which is the average beside it, term for term', w().calc.critAvg, 320 + 7 + 36);

  // The Mult tag: damage on every hit that multiplies with the weapon, for an
  // ability written with no "not multiplied" caveat on it. Neither of the other
  // two captures it -- untagged undercounts the crit, Crit misses the normal
  // roll -- so it is its own thing, and it behaves exactly like Misc dmg.
  c.setItem('equipment.weapons', i, 'special', 'Gauntlets [[13 Mult]]');
  check('mult damage lands on the normal roll', w().calc.totalAvg, 80 + 13);
  check('and multiplies on a crit', w().calc.critAvg, (80 + 13) * 4);
  check('the crit string keeps it with the base', w().calc.critStr, '(12d8+39)×4');
  const viaToken = w().calc.critAvg;
  c.setItem('equipment.weapons', i, 'special', '');
  c.setItem('equipment.weapons', i, 'miscDamage', 13);
  check('which is exactly what the Misc dmg column does', w().calc.critAvg, viaToken);
  c.setItem('equipment.weapons', i, 'miscDamage', 0);

  c.setItem('equipment.weapons', i, 'special', '[[2d6]] [[2d8 Crit]] [[13 Mult]]');
  check('all three kinds coexist', w().calc.totalAvg, 80 + 7 + 13);
  check('and each is multiplied or not, as tagged',
    w().calc.critAvg, (80 + 13) * 4 + 7 + 9 * 4);
  check('the string separates them', w().calc.critStr, '(12d8+39)×4+2d6+2d8×4');
  check('Mult is a damage keyword only', (() => {
    c.setItem('equipment.weapons', i, 'special', '{{4 Mult}}');
    return [w().calc.totalAtk, w().calc.atkTokens[0].mult];
  })(), [44, false]);

  // Misc dmg written as a rule rather than a number -- it used to read as 0,
  // silently, which is the worst way for a damage field to be wrong.
  c.setItem('equipment.weapons', i, 'special', '');
  c.setItem('equipment.weapons', i, 'miscDamage', 'floor(level / 4) + 1');
  check('a formula in Misc dmg resolves', w().miscDamageNum, Math.floor(20 / 4) + 1);
  check('and multiplies like the number it replaces', w().calc.critAvg, (80 + 6) * 4);
  check('and is visible to the audit',
    c.audit().some((a) => a.id === 'weapon-misc-' + i && a.status === 'ok'), true);
  c.setItem('equipment.weapons', i, 'miscDamage', 'nope + 1');
  check('a bad one is reported, not silently zero', w().miscDamageError !== null, true);
  check('and flagged in the audit',
    c.audit().find((a) => a.id === 'weapon-misc-' + i).status, 'error');
  c.setItem('equipment.weapons', i, 'miscDamage', 0);

  // The sheet's Bonus Crit Damage column stays unmultiplied (burst dice).
  c.setItem('equipment.weapons', i, 'special', '');
  c.setItem('equipment.weapons', i, 'bonusCritDamage', '1d10');
  check('bonus crit damage field folds in unmultiplied', w().calc.critAvg, 320 + 5.5);
  check('and shows in the crit string', w().calc.critStr, '(12d8+26)×4+1d10');
  c.setItem('equipment.weapons', i, 'bonusCritDamage', null);

  // Free ability multiplier beyond ×2.
  c.setItem('equipment.weapons', i, 'abilityMult', 3);
  check('×3 works', w().damageBonus, Math.floor(14 * 3) + 5);
  c.setItem('equipment.weapons', i, 'abilityMult', 1.5);
  check('restored', w().damageBonus, 26);
}

console.log('inline formulas in prose');
{
  const { tokenize, resolveDefinitions, renderTokens, formatValue } = await import('../app/js/inline.js');

  // Token grammar.
  const segs = tokenize('AC {= 10 + 2} and {arms.hp = 3 * con.mod} then {arms.hp} again');
  check('four segments + text', segs.filter((s) => s.kind !== 'text').length, 3);
  check('value token', segs[1].kind, 'value');
  check('define token name', segs[3].name, 'arms.hp');
  check('define token expr', segs[3].expr, '3 * con.mod');
  check('ref token', segs[5].kind, 'ref');
  check('"a + b = c" is a value, not a define', tokenize('{a + b = c}')[0].kind, 'value');
  check('formatValue rounds', formatValue(2.3333), '2.33');

  // Dependency-ordered resolution, regardless of definition order.
  const base = { con: { mod: 12 }, level: 20 };
  const res = resolveDefinitions([
    { name: 'qi.max', expr: 'floor((burn.max + qi.base) / 4)', path: 'a' },
    { name: 'burn.max', expr: '18', path: 'b' },
    { name: 'qi.base', expr: 'level - 4', path: 'c' },
  ], base);
  check('chain resolves out of order', res.values['qi.max'], Math.floor((18 + 16) / 4));
  check('no errors', res.errors.length, 0);

  // A cycle is one fault naming every member, not one complaint per member:
  // whichever is visited first must not be the only one told, and the others
  // must not be left saying "unknown value" about a name that plainly exists.
  const cyc = resolveDefinitions([
    { name: 'a', expr: 'b + 1', path: 'x' }, { name: 'b', expr: 'a + 1', path: 'y' },
  ], base);
  check('cycle reported, not thrown', cyc.errors.some((e) => /Circular/.test(e.error)), true);
  check('every name in the loop is told', cyc.errors.filter((e) => e.cycle).map((e) => e.name).sort(), ['a', 'b']);
  check('and told the same thing', new Set(cyc.errors.filter((e) => e.cycle).map((e) => e.error)).size, 1);
  check('the loop is spelt out', cyc.errors[0].cycle, ['a', 'b', 'a']);
  check('no cascading unknowns', cyc.errors.some((e) => /Unknown value/.test(e.error)), false);
  check('nothing in a loop resolves', cyc.values, {});

  // Something downstream of a broken definition names it, rather than
  // reporting the name as missing when it is right there and simply not working.
  const knockOn = resolveDefinitions([
    { name: 'a', expr: 'floor(', path: 'x' }, { name: 'c', expr: 'a * 2', path: 'y' },
  ], base);
  check('the knock-on names its cause',
    knockOn.errors.find((e) => e.name === 'c').error, 'Depends on "a", which is not working.');

  // The first definition of a duplicated name wins, so that adding another
  // one later cannot quietly change what the existing one was worth -- and
  // both are flagged, so neither looks fine while the other carries the
  // warning.
  const dup = resolveDefinitions([
    { name: 'k', expr: '1', path: 'x' }, { name: 'k', expr: '2', path: 'y' },
  ], base);
  check('first definition wins', dup.values.k, 1);
  check('both definitions are flagged', dup.errors.filter((e) => e.duplicate).map((e) => e.path), ['x', 'y']);
  check('one of them is named as in force', dup.errors.filter((e) => e.duplicate && e.inForce).length, 1);
  check('the clash is reported as a whole',
    dup.duplicates, [{ name: 'k', inForce: 'x', definitions: [{ path: 'x', expr: '1' }, { path: 'y', expr: '2' }] }]);
  check('three definitions, still the first',
    resolveDefinitions([
      { name: 'k', expr: '1', path: 'x' }, { name: 'k', expr: '2', path: 'y' }, { name: 'k', expr: '3', path: 'z' },
    ], base).values.k, 1);

  const r = renderTokens('HP {= con.mod * 3} / {nope}', {}, base);
  check('value renders', r[1].value, 36);
  check('unknown ref errors inline', typeof r[3].error, 'string');
}
{
  // On a real character: Angou's Elemental Arms, written as prose.
  const c = new Character(load('angou'));
  const conMod = c.data.abilities.con.mod;   // 12
  c.setClassFeature('Legendary Kineticist', 5, 'Features',
    'Elemental Arms: AC {arms.ac = 10 + con.mod + 2}, hardness {arms.hardness = con.mod}, '
    + 'HP {arms.hp = 3 * con.mod}, dispel DC {arms.dc = 11 + con.mod}; '
    + '{arms.pairs = 1 + (level >= 11) + (level >= 14) + (level >= 17)} pairs.');
  check('arms.ac defined', c.inlineNames['arms.ac'], 10 + conMod + 2);
  check('arms.hp defined', c.inlineNames['arms.hp'], 3 * conMod);
  check('boolean arithmetic for pairs at 20', c.inlineNames['arms.pairs'], 4);

  // Names reach the formula scope: trackers, weapon tokens, other prose.
  check('scope exposes dotted inline name', c.scope().arms.hp, 3 * conMod);
  const t = c.addTracker({ name: 'Arm HP', maxFormula: 'arms.hp' });
  check('tracker reads an inline name', t.max, 3 * conMod);

  c.setClassFeature('Legendary Monk', 3, 'Features', 'Fused pool: {qi.max = floor((burn.max + qi.base) / 4)}');
  c.setClassFeature('Legendary Monk', 1, 'Features', 'Burn {burn.max = 18}, Qi {qi.base = level - 4}');
  check('cross-field chain', c.inlineNames['qi.max'], Math.floor((18 + 16) / 4));
  const seg = c.renderProse('Pool is {qi.max}').find((s) => s.kind === 'ref');
  check('reference renders the value', seg.value, 8);

  // Live: Con changes flow into every arms value (inherent column is empty).
  c.setBuild('con', 'inherent', 2);
  check('Con +2 raises arms.hp by 3', c.inlineNames['arms.hp'], 3 * (conMod + 1));
  check('and the tracker follows', c.trackers.find((x) => x.id === 'arm_hp').max, 3 * (conMod + 1));
  c.setBuild('con', 'inherent', 0);
  check('restored', c.inlineNames['arms.hp'], 3 * conMod);

  // Weapon tokens can use inline names too.
  const wi = c.data.equipment.weapons.findIndex((w) => w.name === 'Unarmed Strike');
  c.setItem('equipment.weapons', wi, 'special', 'Arm slam [[arms.hardness]]');
  check('weapon token reads inline name', c.data.equipment.weapons[wi].calc.tokDmg.flat, conMod);
  c.setItem('equipment.weapons', wi, 'special', '');

  // Errors are visible to the GM audit, never thrown.
  c.setClassFeature('Legendary Monk', 4, 'Features', 'Broken {oops = nonsense * 2}');
  const bad = c.audit().find((a) => a.source === 'inline' && a.name === '{oops}');
  check('inline error in audit', bad?.status, 'error');
  c.setClassFeature('Legendary Monk', 4, 'Features', '');

  // A definition never shadows a built-in.
  c.setClassFeature('Legendary Monk', 6, 'Features', '{level = 1}');
  check('cannot shadow level', c.scope().level, 20);
  c.setClassFeature('Legendary Monk', 6, 'Features', '');
}

console.log('dice fields referencing inline names');
{
  const c = new Character(load('angou'));
  const wi = c.data.equipment.weapons.findIndex((w) => w.name === 'Kinetic Fist');
  const w = () => c.data.equipment.weapons[wi];

  // A number-valued name -> that many d6 (kineticist blast dice).
  c.setClassFeature('Legendary Monk', 1, 'Features',
    'Kinetic Fist {kinetic.fist = floor(ceil((min(level,20)+2+4)/2)/3)} dice');
  check('name evaluates to a count', c.inlineNames['kinetic.fist'], 4);
  c.setItem('equipment.weapons', wi, 'dice', '{kinetic.fist}');
  check('dice field resolves the name as d6 count', w().diceResolved, '4d6');
  check('damage string follows', w().damageTotal.startsWith('4d6'), true);
  check('no error', w().diceError, null);

  // A dice-text name via the dice() helper.
  c.setClassFeature('Legendary Monk', 1, 'Features',
    'Kinetic Fist {kinetic.fist = dice(floor(ceil((min(level,20)+2+4)/2)/3), 8)}');
  check('dice() helper yields dice text', c.inlineNames['kinetic.fist'], '4d8');
  check('dice field takes it verbatim', w().diceResolved, '4d8');

  // Names change with level; the weapon follows.
  c.set('identity.level', 10);
  check('level 10 -> fewer dice', w().diceResolved, '2d8');
  c.set('identity.level', 20);

  // [[…]] and {= …} spellings work in the dice field too.
  c.setItem('equipment.weapons', wi, 'dice', '[[kinetic.fist]]');
  check('[[name]] accepted', w().diceResolved, '4d8');
  c.setItem('equipment.weapons', wi, 'dice', '{= dice(3, 10)}');
  check('{= expr} accepted', w().diceResolved, '3d10');

  // Unknown name -> flagged, not thrown.
  c.setItem('equipment.weapons', wi, 'dice', '{no.such.thing}');
  check('unknown name flagged', typeof w().diceError, 'string');
  c.setItem('equipment.weapons', wi, 'dice', '4d6 (8d6)');
  c.setClassFeature('Legendary Monk', 1, 'Features', '');
}

console.log('custom system tabs');
{
  const c = new Character(load('nico'));
  const n0 = c.data.sheetTabs.length;
  const tab = c.addSystemTab('Spellbook');
  check('tab added', c.data.sheetTabs.length, n0 + 1);
  check('named', tab.name, 'Spellbook');
  check('flagged custom', tab.custom, true);
  check('starts with an empty grid', tab.rows.length > 0 && tab.rows[0].cells.length > 0, true);

  const dup = c.addSystemTab('Spellbook');
  check('duplicate names disambiguated', dup.name, 'Spellbook 2');

  const idx = c.data.sheetTabs.indexOf(tab);
  c.data.uiPrefs.hiddenTabs.Spellbook = true;
  c.renameSystemTab(idx, 'Grimoire');
  check('renamed', c.data.sheetTabs[idx].name, 'Grimoire');
  check('hidden pref follows the rename', c.data.uiPrefs.hiddenTabs.Grimoire, true);
  check('old pref key gone', 'Spellbook' in c.data.uiPrefs.hiddenTabs, false);
  // Any other tab's own name, rather than one written in here -- naming a
  // specific worksheet made this break the day that worksheet became a modelled
  // system and stopped being a grid at all.
  const taken = c.data.sheetTabs.find((t, i) => i !== idx)?.name;
  c.renameSystemTab(idx, taken);
  check('rename refuses collisions', c.data.sheetTabs[idx].name, 'Grimoire');

  // Cells accept inline formulas like anywhere else.
  c.data.sheetTabs[idx].rows[0].cells[0] = 'Slots {spell.slots = 3 + int.mod}';
  c.recompute();
  check('inline name from a custom tab', c.inlineNames['spell.slots'], 3 + c.data.abilities.int.mod);

  c.removeSystemTab(idx);
  check('deleted', c.data.sheetTabs.some((t) => t.name === 'Grimoire'), false);
  check('pref cleaned', 'Grimoire' in c.data.uiPrefs.hiddenTabs, false);
  check('inline name gone with it', 'spell.slots' in c.inlineNames, false);
  c.removeSystemTab(c.data.sheetTabs.indexOf(dup));
  check('back to original count', c.data.sheetTabs.length, n0);
}

console.log('techniques -- techRef, Technique List and AutoTechnique read once, the grids retired');
{
  const c = new Character(load('angou'));
  const t = c.data.techniques;
  check('the three grids are gone', c.data.sheetTabs.filter((x) => /^(techRef|Technique List|AutoTechnique)$/.test(x.name)).length, 0);
  check('every named column of techRef is a technique', t.catalogue.length, 53);
  check('the list opens on what the workbook showed', t.selected, 'Wheelbreaker');
  check('the AutoTechnique draft is Knucklebuster', t.draft.name, 'Knucklebuster');
  check('statuses read off the row under Subschool', t.catalogue.filter((x) => x.status === 'Known').length, 11);
  const w = c.techniqueByName('Wheelbreaker');
  check('prepends', [w.prepend1, w.prepend2], ['Nakano Style', '']);
  check('subschool is the Type column', w.subschool, 'Akashic');
  check('talent pairs keep their sphere', w.combatTalents.slice(0, 2), [{ sphere: 'Open Hand', talent: 'Mystic Fists' }, { sphere: 'Open Hand', talent: 'Godhand' }]);
  check('other cost', w.otherCost, 'Current Heat (Min. 5)');
  // The Technique List tab's own numbers for Wheelbreaker, as the workbook cached them.
  const v = c.techniqueView(w, 'list');
  check('Wheelbreaker complexity 6', v.stats.complexity, 6);
  check('base and total talents', [v.stats.baseText, v.stats.totalText], ['2', '6']);
  check('crafting time 7, effective 5', [v.stats.craftingTime, v.stats.effectiveTime], [7, 5]);
  check('DCs 35 / 26 / 22', [v.stats.craftDC, v.stats.decipherDC, v.stats.learnDC], [35, 26, 22]);
  check('prowess No -- it uses a magic sphere', v.stats.prowessText, 'No');
  check('effective 5: complexity less Adept Initiator', v.stats.effective, 5);
  check('total SP 5', v.stats.totalSp, 5);
  check('the context found Adept Initiator and BAB 20', c.techniqueContext(), { bab: 20, adeptInitiator: 1 });
  // And the AutoTechnique tab's, for Knucklebuster.
  const a = c.techniqueView(t.draft, 'auto');
  check('Knucklebuster complexity 5', a.stats.complexity, 5);
  check('DCs 30 / 25 / 20', [a.stats.craftDC, a.stats.decipherDC, a.stats.learnDC], [30, 25, 20]);
  check('prowess Yes -- no magic sphere', a.stats.prowessText, 'Yes (Martial Focus)');
  check('flags read: instant, versatile 0, signature', [t.draft.instantInitiation, t.draft.versatile, t.draft.signature], [true, 0, true]);
  check('effective 4: 5 + 1 + 0 - 1 - Adept Initiator', a.stats.effective, 4);
  check('the application names the character and the technique',
    a.export.split('\n').slice(0, 2), ['**Character Name:** Angou', '**What Are you Applying for:** the **Nakano Style Counter - Knucklebuster** technique']);
  check('spheres list their talents', /Combat Spheres: Boxing \(Punishing Cross, Reflecting Palm\); Open Hand \(Iron Fist\)/.test(a.export), true);
  check('a 0 Other Cost is not printed', /, 0\n/.test(a.export), false);

  // Prowess: a magic sphere turns it off and raises complexity past two distinct entries.
  const d = normalizeTechnique({ ...t.draft, magicSpheres: ['Destruction', '', '', '', ''] });
  const dv = techniqueStats(d, c.techniqueContext(), 'auto');
  check('three distinct: base 3, +1', [dv.base, dv.complexity, dv.baseText], [3, 7, '3 (+1)']);
  check('prowess off', dv.prowessText, 'No');
  // The list's own discount, when a technique does keep prowess.
  const lv = techniqueStats(normalizeTechnique(t.draft), { bab: 20, adeptInitiator: 1 }, 'list');
  check('list mode: 5 - 1 - 4 - 1 floors at 0', lv.effective, 0);
  check('the discount shows as prowess extra SP when complexity exceeds it',
    techniqueStats(normalizeTechnique({ ...t.draft, others: ['Feat', 'Wild Talent', 'Mythic Path Ability', 'X', 'Y'] }), { bab: 0, adeptInitiator: 0 }, 'list').prowessText.startsWith('Yes (Martial Focus +'), true);
  // Feat among the others counts for complexity's second term but not for base.
  const f = normalizeTechnique({ ...emptyTechnique(), name: 'F', combatSpheres: ['Boxing', '', '', '', ''], others: ['Feat', 'Wild Talents', '', '', ''] });
  const fv = techniqueStats(f, {}, 'list');
  check('base = distinct - feats', [fv.distinct, fv.feats, fv.base], [3, 1, 2]);
  check('complexity counts the feat via the distinct term', fv.complexity, 2);

  // Adding the draft to the list, and round trip.
  c.set('techniques.draft.name', 'Knucklebuster II');
  const added = c.addDraftTechnique('Design Phase');
  check('added under its own name', [added.name, added.status], ['Knucklebuster II', 'Design Phase']);
  check('the list opens on it', c.data.techniques.selected, 'Knucklebuster II');
  check('54 now', c.data.techniques.catalogue.length, 54);
  c.addDraftTechnique('Known');
  check('same name replaces, not duplicates', c.data.techniques.catalogue.filter((x) => x.name === 'Knucklebuster II').length, 1);
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('round-trips through JSON', back.data.techniques.catalogue.length, 54);
  c.removeTechnique('Knucklebuster II');
  check('removed', c.techniqueByName('Knucklebuster II'), null);
  check('every slot on a fresh technique', [emptyTechnique().combatSpheres.length, emptyTechnique().combatTalents.length, emptyTechnique().saves.length, emptyTechnique().descriptions.length],
    [TECHNIQUE_SLOTS.spheres, TECHNIQUE_SLOTS.talents, TECHNIQUE_SLOTS.saves, TECHNIQUE_SLOTS.descriptions]);
  check('a character without the tabs has an empty block', new Character(load('saburo')).data.techniques, { catalogue: [], selected: '', draft: emptyTechnique() });
}

console.log('auto-cooking -- the iron chef dish maker, read from Bryva and cooked for anyone');
{
  const b = new Character(load('bryva'));
  check('the grid is gone', b.data.sheetTabs.some((x) => x.name === 'Auto-Cooking'), false);
  check('the dish as the workbook left it', b.data.cooking, {
    level: 16, chef: '', dishName: '',
    entrees: ['Mycoprotein', 'Red Meat'], flavors: ['Savory', 'Spicy', 'Sweet'], sides: ['Melons', 'Rice'], aroma: ['Fetid'], garnish: ['Ginger'],
  });
  const v = b.cookingView();
  check('duration floor(16/3)+1 = 6 hours', v.hours, 6);
  const text = (name) => v.effects.find((e) => e.name === name)?.text;
  // Level-only numbers match the workbook's cached values exactly.
  check('Mycoprotein +4 Will', text('Mycoprotein'), '+4 bonus to Will saves.');
  check('Red Meat +4 Fort', text('Red Meat'), '+4 bonus to Fortitude saves.');
  check('Rice text', text('Rice'), 'All numerical effects of the recipe are determined as though the iron chef were 3 class levels higher than he actually is.');
  // Where the workbook's COUNTIF ranges had broken to #REF! (and so counted 0),
  // the combos its own Combo Bonus column names apply here: Rice +3 levels, Sweet +2 on Ginger.
  check('Spicy: level + rice*3 = 19 resistance', text('Spicy'), '+19 cold and fire resistance.');
  check('Ginger: 2 + 2 (level 10+) + 2 sweet', text('Ginger'), '+6 alchemical bonus to saving throws against the nauseated and sickened conditions for the duration of the effect.');
  check('Fetid DC 10 + floor(19/2) + 16 = 35', /DC 35\)/.test(text('Fetid')), true);
  check('the post leads with the chef and level', v.export.split('\n')[0], '**Iron Chef Dish** — cooked by Nakano Bryva (iron chef level 16)');
  check('and lists the courses', v.export.split('\n')[1], 'Entrees: Mycoprotein, Red Meat · Flavors: Savory, Spicy, Sweet · Side Dishes: Melons, Rice · Aroma: Fetid · Garnish: Ginger');
  check('one bullet per ingredient', v.export.split('\n').filter((l) => l.startsWith('• ')).length, 9);

  // Anyone can cook: a dish on a character who has no tab, with a level typed in.
  const s = new Character(load('saburo'));
  check('starts empty', s.data.cooking, emptyDish());
  s.set('cooking.level', 7);
  s.set('cooking.entrees.0', 'Fish');
  s.set('cooking.sides.0', 'Carrots');
  s.set('cooking.sides.1', 'Bread');
  const sv = s.cookingView();
  check('3 hours at level 7', sv.hours, 3);
  check('Fish at 7: 1 + floor(7/5) = 2', sv.effects.find((e) => e.name === 'Fish').text, '+2 dodge AC bonus while swimming and competence bonus on Swim checks.');
  check('Carrots with a Fish entree: 2 + 0 + 2', sv.effects.find((e) => e.name === 'Carrots').text, '+4 enhancement bonus to their Wisdom score for the duration of the effect.');
  check('the chef defaults to the character', sv.chef, s.data.identity.name);
  check('blank level uses the character level', cookingDish({ ...emptyDish(), entrees: ['Fowl', ''] }, { level: 12 }).effects[0].text, '+3 bonus to Reflex saves.');
  check('an unknown ingredient is flagged, not dropped', cookingDish({ ...emptyDish(), garnish: ['Truffle'] }).effects[0].unknown, true);
  check('Grapes past 10 gain the immunity clause', /immunity to the dazzled/.test(cookingDish({ ...emptyDish(), sides: ['Grapes', ''] }, { level: 10 }).effects[0].text), true);
  check('and not below', /immunity/.test(cookingDish({ ...emptyDish(), sides: ['Grapes', ''] }, { level: 9 }).effects[0].text), false);
  check('Fetid with Sour says the immunity is off', /\(bonus applied\)\.$/.test(cookingDish({ ...emptyDish(), aroma: ['Fetid'], flavors: ['Sour', '', ''] }, { level: 5 }).effects[1].text), true);
  const back = new Character(JSON.parse(JSON.stringify(s.toJSON())));
  check('round-trips through JSON', back.data.cooking.sides, ['Carrots', 'Bread']);
}

console.log('wealth -- the wallet in mana, the offering owed, and the ledger');
{
  const c = new Character(load('saburo'));
  const w = c.data.wealth;
  check('read off the workbook', [w.baseline, w.current, w.oathOfOfferings, w.materialCasting, w.lastOffering, w.manaPerDay, w.sessionMana],
    [16198, 16198, true, true, '2026-08-02', 190, 0]);
  const today = new Date(2026, 7, 17);
  const v = c.wealthView(today);
  check('OoO/day is half the mana a day', v.offeringPerDay, 95);
  check('15 days since the last offering', v.days, 15);
  check('oath: days x OoO/day + floor(session mana / 2)', v.expected.oath, 1425);
  check('casting: no whole month yet', v.expected.casting, 0);
  check('mana after', v.after, 16198 - 1425);
  check('the workbook cached 13 days on the day it was exported', c.wealthView(new Date(2026, 7, 15)).expected.total, 1235);
  // Session mana and the month roll over.
  c.set('wealth.sessionMana', 301);
  check('half the session mana is owed, rounded down', c.wealthView(today).expected.oath, 1425 + 150);
  check('a whole month adds 30 for casting', c.wealthView(new Date(2026, 8, 2)).expected.casting, MATERIAL_CASTING_PER_MONTH);
  check('and the day before it does not', c.wealthView(new Date(2026, 8, 1)).expected.casting, 0);
  c.set('wealth.sessionMana', 0);
  // The switches.
  c.set('wealth.oathOfOfferings', false);
  check('no oath, no oath part', c.wealthView(today).expected.oath, 0);
  c.set('wealth.materialCasting', false);
  check('nothing due at all', [c.wealthView(today).due, c.wealthView(today).expected.total], [false, 0]);
  c.set('wealth.oathOfOfferings', true); c.set('wealth.materialCasting', true);

  // Narockro's older block reads too; his own sheet halved the gains since the baseline instead.
  const n = new Character(load('narockro'));
  check('Narockro: baseline, current, 280 a day, no sessions cell', [n.data.wealth.baseline, n.data.wealth.current, n.data.wealth.manaPerDay, n.data.wealth.sessionMana], [38159, 38779, 280, 0]);
  check('gains since baseline', n.wealthView(today).gains, 620);
  // A wallet label with no figure, and no wallet at all.
  check('Angou: label only -> empty wallet', new Character(load('angou')).data.wealth, emptyWealth());
  check('Bryva: no block -> empty wallet', new Character(load('bryva')).data.wealth, emptyWealth());

  // The ledger, and the hooks.
  const e = c.addWealthEntry({ amount: 500, label: 'Session 12', kind: 'session', date: today });
  check('a session line', e, { date: '2026-08-17', label: 'Session 12', amount: 500, kind: 'session' });
  check('the wallet and the session mana move', [c.data.wealth.current, c.data.wealth.sessionMana], [16698, 500]);
  check('and half the reward is now owed', c.wealthView(today).expected.oath, 1425 + 250);
  c.addWealthEntry({ amount: 200, kind: 'spend', label: 'Potions', date: today });
  check('a spend comes off', c.data.wealth.current, 16498);
  check('a spend typed positive is stored negative', c.data.wealth.ledger.at(-1).amount, -200);
  const paid = c.makeOffering(today);
  check('the offering pays what is owed today', paid.amount, -(1425 + 250));
  check('after: balance = mana after, baseline follows, session mana restarts', [c.data.wealth.current, c.data.wealth.baseline, c.data.wealth.lastOffering, c.data.wealth.sessionMana],
    [16498 - 1675, 16498 - 1675, '2026-08-17', 0]);
  check('nothing owed the same day', c.wealthView(today).expected.total, 0);
  check('the ledger has all three lines', c.data.wealth.ledger.map((l) => l.kind), ['session', 'spend', 'offering']);
  c.removeWealthEntry(0);
  check('removing the session line undoes it', [c.data.wealth.current, c.data.wealth.ledger.length], [16498 - 1675 - 500, 2]);
  check('a document saved with the old "sessions" count still reads', new Character({ ...load('saburo'), wealth: { current: 10, sessions: 40 } }).data.wealth.sessionMana, 40);
  check('formulas can read the wallet', c.scope().mana.current, c.data.wealth.current);
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('round-trips through JSON', back.data.wealth.ledger.length, 2);
  check('isoDay reads the workbook stamp and a Date alike', [isoDay('2026-08-02T00:00:00'), isoDay(new Date(2026, 7, 2, 23, 30))], ['2026-08-02', '2026-08-02']);
  check('wealthView on nothing', wealthView(null, today).expected.total, 0);
}

console.log('the tab bar -- an ordered preference, saved with the character');
{
  const c = new Character(load('angou'));
  check('starts on the default eight', c.tabOrder(), DEFAULT_TAB_ORDER);
  check('the default is the requested order', DEFAULT_TAB_ORDER,
    ['overview', 'stats', 'lore', 'skills', 'progression', 'features', 'primordia', 'trackers', 'gear']);
  c.showTab('crafting');
  check('show appends', c.tabOrder().at(-1), 'crafting');
  c.showTab('crafting');
  check('showing twice does not duplicate', c.tabOrder().filter((k) => k === 'crafting').length, 1);
  c.moveTab('crafting', 0);
  check('move to the front', c.tabOrder()[0], 'crafting');
  c.moveTab('crafting', 3);
  check('move before the third', c.tabOrder().slice(0, 3), ['overview', 'stats', 'crafting']);
  c.moveTab('crafting', c.tabOrder().length);
  check('move past the end goes last', c.tabOrder().at(-1), 'crafting');
  c.hideTab('crafting');
  check('hide removes', c.tabOrder().includes('crafting'), false);
  check('the preference is what is exported', c.toJSON().uiPrefs.tabOrder, c.tabOrder());
  check('a document without one gets the default', new Character({ ...load('saburo'), uiPrefs: {} }).tabOrder(), DEFAULT_TAB_ORDER);

  // A worksheet's place is keyed by name, so it follows a rename and goes with a delete.
  const tab = c.addSystemTab('Spellbook');
  const idx = c.data.sheetTabs.indexOf(tab);
  c.showTab('sys:Spellbook');
  c.renameSystemTab(idx, 'Grimoire');
  check('rename carries the bar entry', c.tabOrder().includes('sys:Grimoire') && !c.tabOrder().includes('sys:Spellbook'), true);
  c.removeSystemTab(idx);
  check('delete drops the bar entry', c.tabOrder().includes('sys:Grimoire'), false);
}

console.log('skill misc accepts formulas and named values');
{
  const c = new Character(load('nico'));   // the vigilante
  const idx = c.data.skills.findIndex((s) => s.name === 'Bluff');
  const bluff = () => c.data.skills[idx];
  const base = bluff().bonus - (Number(bluff().offset) || 0);   // bonus without misc
  const intMod = c.data.abilities.int.mod;                      // Int 37 -> +13

  // Plain integers still work, including negatives.
  c.setItem('skills', idx, 'offset', 3);
  check('integer misc', bluff().bonus, base + 3);
  c.setItem('skills', idx, 'offset', -2);
  check('negative misc', bluff().bonus, base - 2);

  // An ability modifier by name.
  c.setItem('skills', idx, 'offset', 'int.mod');
  check('int.mod as misc', bluff().bonus, base + intMod);
  check('resolved value exposed', bluff().miscResolved, intMod);
  check('no error', bluff().miscError, null);

  // …and it follows Int live. Bluff itself is Int-keyed for Nico (Clever
  // Wordplay), so +2 Int moves the total by +2: +1 ability, +1 misc.
  c.setBuild('int', 'inherent', 2);
  check('misc follows Int', bluff().miscResolved, intMod + 1);
  check('total moves by ability + misc', bluff().bonus, base + intMod + 2);
  c.setBuild('int', 'inherent', 0);

  // A name defined in prose (Skill Familiarity social talent).
  c.setClassFeature('Vigilante', 1, 'Features',
    'Skill Familiarity: {skill_familiarity = 4 + floor(level / 5)}');
  check('name defined', c.inlineNames.skill_familiarity, 4 + Math.floor(15 / 5));
  c.setItem('skills', idx, 'offset', 'skill_familiarity');
  check('named misc', bluff().bonus, base + 7);
  c.set('identity.level', 20);
  check('named misc follows level through the name', bluff().miscResolved, 8);
  c.set('identity.level', 15);

  // Arithmetic and functions.
  c.setItem('skills', idx, 'offset', 'skill_familiarity + floor(level / 2)');
  check('compound formula', bluff().miscResolved, 7 + 7);

  // Errors are reported, never thrown, and excluded from the total.
  c.setItem('skills', idx, 'offset', 'no_such_thing');
  check('unknown name flagged', typeof bluff().miscError, 'string');
  check('and contributes nothing', bluff().bonus, base);
  check('audit lists the misc formula', c.audit().some((a) => a.id === `skill-misc-${idx}` && a.status === 'error'), true);

  // Skills cannot be read by names (no cycles between the two).
  c.setClassFeature('Vigilante', 2, 'Features', '{peek = skill.bluff}');
  check('names cannot read skill totals', c.inlineErrors.some((e) => e.name === 'peek'), true);
  c.setClassFeature('Vigilante', 2, 'Features', '');

  // Skill misc formulas that read *another* skill are also refused —
  // the misc scope is taken before skill totals exist for this cycle.
  c.setItem('skills', idx, 'offset', 'skill.diplomacy');
  check('misc reads stale-or-missing skill values as an error or 0, not a cycle',
    bluff().miscError !== undefined, true);

  c.setItem('skills', idx, 'offset', 0);
  c.setClassFeature('Vigilante', 1, 'Features', '');
  check('restored', bluff().bonus, base);
}

console.log('forwarded bonuses -- a rule written once, added everywhere it applies');
{
  const { tokenize } = await import('../app/js/inline.js');

  // Grammar. The new form has to earn its place without moving any of the old
  // ones: a definition is still a definition and a comparison is still a
  // comparison, whatever punctuation they happen to contain.
  const push = tokenize('{skill.bluff += 4}')[0];
  check('push token', push.kind, 'push');
  check('push target', push.targets, ['skill.bluff']);
  check('push expr', push.expr, '4');
  check('push sign', push.sign, 1);
  check('a penalty', tokenize('{ac.total -= 2}')[0].sign, -1);
  check('several destinations at once',
    tokenize('{skill.bluff, skill.diplomacy += level}')[0].targets, ['skill.bluff', 'skill.diplomacy']);
  check('the long spelling means the same', tokenize('{target.skill.bluff = 4}')[0].targets, ['skill.bluff']);
  check('and is still a push', tokenize('{target.skill.bluff = 4}')[0].kind, 'push');
  check('a definition is still a definition', tokenize('{qi.max = wis.mod + level}')[0].kind, 'define');
  check('">=" is not an operator here', tokenize('{= a >= 3}')[0].kind, 'value');
  check('"a + b = c" is still a value', tokenize('{a + b = c}')[0].kind, 'value');

  const c = new Character(load('nico'));   // the vigilante, and Social Grace
  const level = Number(c.data.identity.level) || 0;
  const skill = (name) => c.data.skills.find((s) => s.name === name);
  const bluffBase = skill('Bluff').bonus;
  const bluffMiscBase = skill('Bluff').miscResolved;
  const diploBase = skill('Diplomacy').bonus;
  const willBase = c.data.saves.will.total;
  const acBase = c.data.defenses.ac;
  const touchBase = c.data.defenses.touch;
  const meleeBase = c.data.attack.totalMelee;
  const initBase = c.data.hp.initiative;
  const hpBase = c.hpMax;

  // The rule as it is actually written: one sentence in the feature that
  // grants it, naming the skills it was taken for.
  c.setClassFeature('Vigilante', 1, 'Features',
    'Mythic Social Grace {skill.bluff, skill.diplomacy += if(level >= 4, 4 + if(level >= 8, level, 0), 0)}');
  const grace = 4 + level;
  check('one token, two skills', [skill('Bluff').bonus, skill('Diplomacy').bonus],
    [bluffBase + grace, diploBase + grace]);
  check('the amount is exposed on the row', skill('Bluff').forwarded, grace);
  check('and the Misc column still says what was typed', skill('Bluff').miscResolved, bluffMiscBase);
  check('the destination knows where it came from',
    c.forwardedInto('skill.bluff').from.map((f) => f.value), [grace]);
  check('and by what rule', c.forwardedInto('skill.bluff').from[0].expr,
    'if(level >= 4, 4 + if(level >= 8, level, 0), 0)');

  // It is a rule, not a number, so it moves when the character does.
  c.set('identity.level', 3);
  check('nothing below the level it starts at', skill('Bluff').forwarded, 0);
  check('and nothing shown at the destination either', c.forwardedInto('skill.bluff'), null);
  c.set('identity.level', 6);
  check('the first step', skill('Bluff').forwarded, 4);
  c.set('identity.level', level);

  // Every other kind of destination, including the ones totalled before the
  // prose that feeds them is read.
  c.setClassFeature('Vigilante', 2, 'Features',
    'Steady {saves.will += 2} {ac += 1} {attack.melee -= 1} {initiative += 3} {hp.total += level}');
  check('a save', c.data.saves.will.total, willBase + 2);
  check('AC, and the family reaches touch as well',
    [c.data.defenses.ac, c.data.defenses.touch], [acBase + 1, touchBase + 1]);
  check('an attack, downwards', c.data.attack.totalMelee, meleeBase - 1);
  check('initiative', c.data.hp.initiative, initBase + 3);
  check('max hit points', c.hpMax, hpBase + level);

  // Recomputing must be a fixed point: the second pass reuses the amounts the
  // first arrived at, so nothing climbs by repeating the sum.
  const settled = [skill('Bluff').bonus, c.data.saves.will.total, c.data.defenses.ac, c.hpMax];
  c.recompute(); c.recompute(); c.recompute();
  check('recompute settles',
    [skill('Bluff').bonus, c.data.saves.will.total, c.data.defenses.ac, c.hpMax], settled);

  // ...and so must saving and reopening. The saved document carries the moved
  // totals, so a reconciliation offset that swallowed a forwarded bonus would
  // add it again on every load and the sheet would drift a little each time.
  let again = c;
  for (let i = 0; i < 3; i++) again = new Character(again.toJSON());
  check('and so does reopening the document',
    [again.data.skills.find((s) => s.name === 'Bluff').bonus, again.data.saves.will.total,
      again.data.defenses.ac, again.hpMax], settled);

  // Two features aimed at the same number both count, and both are findable.
  c.setClassFeature('Vigilante', 3, 'Features', 'Resolve {saves.will += 1}');
  check('bonuses stack', c.data.saves.will.total, willBase + 3);
  check('and each is named', c.forwardedInto('saves.will').from.length, 2);

  // A bonus may be written in terms of a name the character defines.
  c.setClassFeature('Vigilante', 4, 'Features',
    'Familiarity {skill_familiarity = 4 + floor(level / 5)} {skill.stealth += skill_familiarity}');
  check('a bonus can read a name', c.forwardedInto('skill.stealth').total, 4 + Math.floor(level / 5));

  // Nowhere to land. Two different mistakes, told apart, and neither thrown.
  c.setClassFeature('Vigilante', 5, 'Features', '{skill.bluf += 3} {caster.level += 1}');
  const misdirected = c.formulaProblems().filter((p) => p.kind === 'misdirected');
  check('both are reported', misdirected.length, 2);
  check('a misspelt destination',
    /is not something a bonus can be forwarded to/.test(
      misdirected.find((p) => /bluf/.test(p.name)).detail), true);
  check('a readable value with nowhere to put a bonus',
    /you can read, but the sheet has nowhere to put a bonus/.test(
      misdirected.find((p) => /caster/.test(p.name)).detail), true);
  check('and neither one moves a number', skill('Bluff').forwarded, grace);

  // A formula that does not work is reported against where it is written.
  c.setClassFeature('Vigilante', 6, 'Features', '{saves.reflex += floor(}');
  check('a broken bonus is caught, not thrown',
    c.contributions.errors.some((e) => e.path === 'feature:Vigilante:6:Features'), true);

  for (const lvl of [1, 2, 3, 4, 5, 6]) c.setClassFeature('Vigilante', lvl, 'Features', '');
  check('removing the rules puts every number back',
    [skill('Bluff').bonus, c.data.saves.will.total, c.data.defenses.ac,
      c.data.attack.totalMelee, c.data.hp.initiative, c.hpMax],
    [bluffBase, willBase, acBase, meleeBase, initBase, hpBase]);
}

console.log('forwarded bonuses -- ability scores, bonus types, and the note beside a resource');
{
  const { tokenize } = await import('../app/js/inline.js');

  check('a bonus can name its type', tokenize('{str.score += 2 as size}')[0].type, 'size');
  check('and the type is not part of the expression', tokenize('{str.score += 2 as size}')[0].expr, '2');
  check('the type belongs to the whole token, not one destination',
    tokenize('{skill.bluff, skill.diplomacy += level as morale}')[0].type, 'morale');
  check('a penalty can be typed too', tokenize('{ac -= 2 as size}')[0].sign, -1);
  check('untyped is the default', tokenize('{str.score += 2}')[0].type, '');
  check('"as" outside a bonus is just text', tokenize('{= a as b}')[0].kind, 'value');

  const c = new Character(load('narockro'));   // the kineticist, and Burn
  const str = () => c.data.abilities.str.score;
  const strBase = str();
  const meleeBase = c.data.attack.totalMelee;
  const cmdBase = c.data.defenses.cmd;
  const climbBase = c.data.skills.find((s) => s.name === 'Climb').bonus;
  const carryBase = c.data.carry.heavy;

  // An ability score is not a total but the thing a dozen totals are built
  // from, so one bonus has to move all of them without naming any.
  c.setClassFeature('Legendary Kineticist', 1, 'Features', 'Overflow {str.score += 4}');
  check('the score moves', str(), strBase + 4);
  check('and so does everything built on it',
    [c.data.attack.totalMelee, c.data.defenses.cmd,
      c.data.skills.find((s) => s.name === 'Climb').bonus],
    [meleeBase + 2, cmdBase + 2, climbBase + 2]);
  check('carrying capacity included', c.data.carry.heavy > carryBase, true);
  check('the build columns still add up to what they add up to',
    c.data.statsBuild.str.resolved.total, strBase);

  // Reopening must not drift: the imported totals were saved with the bonus in
  // them, and an offset that swallowed it would leave the rule doing nothing.
  let again = c;
  for (let i = 0; i < 3; i++) again = new Character(again.toJSON());
  check('and reopening the document keeps it',
    [again.data.abilities.str.score, again.data.attack.totalMelee, again.data.defenses.cmd],
    [strBase + 4, meleeBase + 2, cmdBase + 2]);

  // Types. Two of a kind do not stack; the largest wins and the loser stays on
  // the list, because it is the reason the winner is not adding to it.
  c.setClassFeature('Legendary Kineticist', 2, 'Features',
    'Kinetic form {str.score += 2 as size} Enlarge {str.score += 4 as size} '
    + 'Rage {str.score += 4 as morale} Trait {str.score += 1}');
  check('largest of each type, and untyped all of them', str(), strBase + 4 + 4 + 4 + 1);
  const into = c.forwardedInto('str.score');
  check('every bonus is still listed', into.from.length, 5);
  check('and the superseded one says so',
    into.from.filter((f) => !f.counts).map((f) => [f.value, f.type]), [[2, 'size']]);
  check('a penalty of a type is not the same slot as a bonus of it', (() => {
    c.setClassFeature('Legendary Kineticist', 3, 'Features', '{str.score -= 1 as size}');
    const v = str();
    c.setClassFeature('Legendary Kineticist', 3, 'Features', '');
    return v;
  })(), strBase + 4 + 4 + 4 + 1 - 1);
  c.setClassFeature('Legendary Kineticist', 2, 'Features', '');

  // The note beside a resource is where a rule that scales with it belongs.
  // It may not define a name -- it is read after the trackers it reads -- but
  // a bonus is not a name.
  c.setClassFeature('Legendary Kineticist', 1, 'Features', '');
  c.addTracker({ name: 'Burn', maxFormula: '3 + con.mod' });
  c.updateTracker('burn', { note: 'Overflow {str.score += if(self.current >= 3, 2, 0) as size}' });
  c.updateTracker('burn', { current: 0 });
  check('below the threshold, nothing', str(), strBase);
  c.updateTracker('burn', { current: 5 });
  check('over it, the bonus', str(), strBase + 2);
  check('and it is named by where it was written',
    c.forwardedInto('str.score').from[0].where, 'the burn tracker’s note');
  check('a name written in a note is still not published',
    (() => {
      c.updateTracker('burn', { note: '{burn_share = 3}' });
      return c.inlineNames.burn_share;
    })(), undefined);
  c.updateTracker('burn', { note: '' });
  check('and removing it puts the score back', str(), strBase);
}

// The same slugging the model names a weapon or a group under.
const slugify = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';

console.log('forwarded bonuses -- damage, and the weapons a rule applies to');
{
  const c = new Character(load('narockro'));   // three weapons: two melee, one veil
  const w = (i) => c.data.equipment.weapons[i];
  const melee = c.data.equipment.weapons
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => /melee/i.test(String(x.attackType || '')))
    .map(({ i }) => i);
  check('the fixture has melee weapons to aim at', melee.length > 0, true);
  const atkBase = c.data.equipment.weapons.map((x) => x.attackTotal);
  const flatBase = c.data.equipment.weapons.map((x) => x.calc.totalDmgFlat);
  const critBase = c.data.equipment.weapons.map((x) => x.calc.critAvg);

  // Damage with no weapon named reaches every weapon; the three keywords are
  // the same three the [[…]] tokens already use.
  c.setClassFeature('Warlord', 1, 'Features', 'Everywhere {damage += 2}');
  check('every weapon takes it',
    c.data.equipment.weapons.map((x) => x.calc.totalDmgFlat),
    flatBase.map((v) => v + 2));
  check('and it is a rider, so a crit does not multiply it',
    c.data.equipment.weapons[0].calc.critAvg, critBase[0] + 2);

  c.setClassFeature('Warlord', 1, 'Features', 'Like the weapon {damage.mult += 2}');
  check('mult damage lands on every hit as well',
    c.data.equipment.weapons.map((x) => x.calc.totalDmgFlat),
    flatBase.map((v) => v + 2));
  check('but multiplies on a crit',
    c.data.equipment.weapons[0].calc.critAvg,
    critBase[0] + 2 * c.data.equipment.weapons[0].calc.critMultNum);

  c.setClassFeature('Warlord', 1, 'Features', 'Only on a crit {damage.crit += 6}');
  check('crit damage is not there on an ordinary hit',
    c.data.equipment.weapons.map((x) => x.calc.totalDmgFlat), flatBase);
  check('and is multiplied when it is',
    c.data.equipment.weapons[0].calc.critAvg,
    critBase[0] + 6 * c.data.equipment.weapons[0].calc.critMultNum);

  // Which weapons: by how they are used, by fighter group, by name.
  c.setClassFeature('Warlord', 1, 'Features', 'Weapon Focus {weapon.melee.attack += 1}');
  check('only the melee rows move',
    c.data.equipment.weapons.map((x, i) => x.attackTotal - atkBase[i]),
    atkBase.map((_, i) => (melee.includes(i) ? 1 : 0)));
  check('and a weapon shape that matches nothing today is not an error',
    (() => {
      c.setClassFeature('Warlord', 2, 'Features', '{weapon.ranged.damage += 4}');
      const bad = c.contributions.errors.length;
      c.setClassFeature('Warlord', 2, 'Features', '');
      return bad;
    })(), 0);

  const group = (w(0).groups || []).filter(Boolean)[0];
  check('the fixture weapon carries a group', !!group, true);
  c.setClassFeature('Warlord', 1, 'Features', `Group {weapon.${slugify(group)}.damage += 5}`);
  check('a group picks out the weapons in it',
    c.data.equipment.weapons.map((x) => x.calc.totalDmgFlat - flatBase[c.data.equipment.weapons.indexOf(x)]),
    c.data.equipment.weapons.map((x) => ((x.groups || []).includes(group) ? 5 : 0)));

  c.setClassFeature('Warlord', 1, 'Features', `One row {weapon.${slugify(w(1).name)}.attack += 7}`);
  check('and one weapon can be named on its own',
    c.data.equipment.weapons.map((x, i) => x.attackTotal - atkBase[i]),
    atkBase.map((_, i) => (i === 1 ? 7 : 0)));

  // A selector that names no group and no weapon is a misspelling, and says so.
  c.setClassFeature('Warlord', 1, 'Features', '{weapon.trebuchets.damage += 9}');
  check('a made-up selector is reported',
    c.contributions.errors.some((e) => /trebuchets/.test(e.error)), true);

  // The character's own attack totals reach the weapon rows: one attack must
  // not read two ways on two panels.
  c.setClassFeature('Warlord', 1, 'Features', 'Inspire {attack.melee += 3}');
  check('a character-wide melee bonus is on the weapon rows too',
    c.data.equipment.weapons.map((x, i) => x.attackTotal - atkBase[i]),
    atkBase.map((_, i) => (melee.includes(i) ? 3 : 0)));
  check('and on the Attack panel, by the same amount',
    c.data.attack.totalMelee - c.data.attack.totalRanged,
    (() => {
      c.setClassFeature('Warlord', 1, 'Features', '');
      const gap = c.data.attack.totalMelee - c.data.attack.totalRanged;
      c.setClassFeature('Warlord', 1, 'Features', 'Inspire {attack.melee += 3}');
      return gap + 3;
    })());

  c.setClassFeature('Warlord', 1, 'Features', '');
  check('and taking the rules away puts the weapons back',
    [c.data.equipment.weapons.map((x) => x.attackTotal),
      c.data.equipment.weapons.map((x) => x.calc.totalDmgFlat)],
    [atkBase, flatBase]);
}

console.log('class levels -- readable by name, and raisable by a rule');
{
  const c = new Character(load('narockro'));   // Warlord 10 / Legendary Kineticist 11 / Incanter 1
  const names = c.classNames();
  check('both lists are read, the table first',
    names.includes('Warlord') && names.includes('Legendary Kineticist'), true);

  // Readable, under the same slug a skill would use.
  const scope = c.scope();
  check('a class publishes its levels', scope.class.legendary_kineticist.level,
    c.classLevelCount('Legendary Kineticist'));
  check('gestalt classes each get their own count',
    [scope.class.warlord.level, scope.class.incanter.level],
    [c.classLevelCount('Warlord'), c.classLevelCount('Incanter')]);
  check('and the index lists them', c.scopeNames().includes('class.warlord.level'), true);
  check('a formula can read one',
    c.renderProse('{= class.warlord.level}').find((s) => s.kind === 'value').value,
    c.classLevelCount('Warlord'));

  // Raisable: "counts as two levels higher" is a rule about this number.
  const kin = () => c.classLevelCount('Legendary Kineticist');
  const kinBase = kin();
  const clBase = c.data.training.magic.globalCL;
  const talentsBase = (c.data.training.magic.classes || []).map((x) => x.totalTalents);
  c.setClassFeature('Legendary Kineticist', 1, 'Features',
    'Practiced {class.legendary_kineticist.level += 2}');
  check('the effective level moves', kin(), kinBase + 2);
  check('and reading it back agrees', c.scope().class.legendary_kineticist.level, kinBase + 2);
  check('the levels actually taken do not', c.classLevelsIn('Legendary Kineticist').length,
    c.data.progression.levels.filter((r) => (r.classes || []).includes('Legendary Kineticist')).length);
  check('nor does the talent budget',
    (c.data.training.magic.classes || []).map((x) => x.totalTalents), talentsBase);
  check('caster level follows, at the class’s own rate',
    c.data.training.magic.globalCL >= clBase, true);

  // Reopening must not drift, and the rule must be reversible.
  let again = c;
  for (let i = 0; i < 3; i++) again = new Character(again.toJSON());
  check('and reopening the document keeps it',
    again.classLevelCount('Legendary Kineticist'), kinBase + 2);

  // A class the character has no levels in takes nothing: an effective level
  // is a multiplier on a class you have, not a way to acquire one.
  c.setClassFeature('Legendary Kineticist', 2, 'Features', '{class.wizard.level += 4}');
  check('a class that is not there is reported',
    c.contributions.errors.some((e) => /class\.wizard\.level/.test(e.error)), true);
  c.setClassFeature('Legendary Kineticist', 2, 'Features', '');

  c.setClassFeature('Legendary Kineticist', 1, 'Features', '');
  check('taking the rule away puts the level back', kin(), kinBase);
  check('and the caster level with it', c.data.training.magic.globalCL, clBase);
}

console.log('round-trips through JSON');
{
  const c = new Character(load('bryva'));
  c.addTracker({ name: 'Culinary Stamina', maxFormula: 'floor(level / 2) + con.mod' });
  const json = JSON.parse(JSON.stringify(c.toJSON()));
  const c2 = new Character(json);
  check('custom tracker survives', c2.trackers.some((t) => t.id === 'culinary_stamina'), true);
  check('AC survives', c2.data.defenses.ac, c.data.defenses.ac);
  check('saves survive', c2.data.saves.will.total, c.data.saves.will.total);
}

console.log('two-sided trackers -- a min below zero makes a meter that swings negative');
{
  const c = new Character(load('angou'));
  const con = c.data.abilities.con.mod;
  const wis = c.data.abilities.wis.mod;
  // Hellfire Qi: min and max of ±floor((max Burn + max Qi) / 4), with Burn
  // 3 + Con and Qi = Wis written straight into the formulas here.
  const t = c.addTracker({
    name: 'Hellfire Qi',
    maxFormula: 'floor((3 + con.mod + wis.mod) / 4)',
    minFormula: '-floor((3 + con.mod + wis.mod) / 4)',
    refresh: 'At Will',
  });
  const half = Math.floor((3 + con + wis) / 4);
  const get = () => c.trackers.find((x) => x.id === 'hellfire_qi');
  check('max evaluates', t.max, half);
  check('min mirrors it', t.min, -half);
  check('starts at 0', t.current, 0);
  check('min is in the formula scope', c.scope().tracker.hellfire_qi.min, -half);
  check('scope names list it', c.scopeNames().includes('tracker.hellfire_qi.min'), true);

  // Steps are clamped to [min, max] on both sides.
  for (let i = 0; i < half + 3; i++) c.stepTracker('hellfire_qi', -1);
  check('cannot step below min', get().current, -half);
  for (let i = 0; i < 2 * half + 5; i++) c.stepTracker('hellfire_qi', 1);
  check('cannot step above max', get().current, half);
  c.stepTracker('hellfire_qi', -2);
  check('steps move by the delta', get().current, half - 2);

  // An ordinary tracker still bottoms out at 0.
  const plain = c.addTracker({ name: 'Plain', maxFormula: '5' });
  check('no min formula means min 0', plain.min, 0);
  check('no min formula means minFormula null', plain.minFormula, null);
  c.stepTracker('plain', -3);
  check('plain trackers clamp at 0', plain.current, 0);
  c.stepTracker('plain', 9);
  check('plain trackers clamp at max', plain.current, 5);

  // Rest brings a meter back to its neutral 0.
  c.updateTracker('hellfire_qi', { current: -3 });
  check('can sit at a negative value', get().current, -3);
  c.restoreAll();
  check('rest zeroes the meter', get().current, 0);
  check('rest zeroes plain trackers', plain.current, 0);

  // Both formulas follow the character (Angou's Con already carries an
  // untyped bonus, so edits are relative to it).
  const untyped0 = Number(c.data.statsBuild.con.untyped) || 0;
  c.setBuild('con', 'untyped', untyped0 + 8);
  const half2 = Math.floor((3 + con + 4 + wis) / 4);
  check('max follows Con', get().max, half2);
  check('min follows Con', get().min, -half2);
  c.setBuild('con', 'untyped', untyped0);
  check('and back', get().max, half);

  // Both show up in the audit, separately.
  const audit = c.audit();
  check('audit has the max formula', audit.find((a) => a.id === 'hellfire_qi')?.value, half);
  const minAudit = audit.find((a) => a.id === 'hellfire_qi:min');
  check('audit has the min formula', minAudit?.formula, '-floor((3 + con.mod + wis.mod) / 4)');
  check('audit min value', minAudit?.value, -half);
  check('audit min reads', minAudit?.reads.sort(), ['con.mod', 'wis.mod']);
  check('audit min status', minAudit?.status, 'ok');

  // A min above max is flagged rather than silently accepted.
  c.addTracker({ name: 'Upside Down', maxFormula: '2', minFormula: '5' });
  check('min above max is an error', typeof c.trackers.find((x) => x.id === 'upside_down').error, 'string');
  const broken = c.addTracker({ name: 'Broken Min', maxFormula: '3', minFormula: 'nope - 1' });
  check('bad min formula reported', /min:/.test(broken.error), true);
  check('bad min formula keeps max', broken.max, 3);

  // Formulas can be edited in place.
  c.updateTracker('plain', { minFormula: '-2' });
  check('edited min applies', c.trackers.find((x) => x.id === 'plain').min, -2);
  c.updateTracker('plain', { minFormula: null });
  check('cleared min returns to 0', c.trackers.find((x) => x.id === 'plain').min, 0);
  c.updateTracker('plain', { maxFormula: 'level' });
  check('edited max applies', c.trackers.find((x) => x.id === 'plain').max, c.data.identity.level);

  // Round trip keeps the min formula and recomputes it.
  const c2 = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  const t2 = c2.trackers.find((x) => x.id === 'hellfire_qi');
  check('minFormula survives JSON', t2.minFormula, '-floor((3 + con.mod + wis.mod) / 4)');
  check('min recomputed after reload', t2.min, -half);
}

console.log('sheet-seeded tracker state survives a round trip');
{
  const c = new Character(load('angou'));
  const mp = c.trackers.find((t) => t.source === 'sheet');
  c.updateTracker(mp.id, { current: 5 });
  const c2 = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('spent count restored', c2.trackers.find((t) => t.id === mp.id).current, 5);
  check('sheet tracker min defaults to 0', c2.trackers.find((t) => t.id === mp.id).min, 0);
  check('still a sheet tracker', c2.trackers.find((t) => t.id === mp.id).source, 'sheet');
}

console.log('tracker style -- colours, fill direction and zones are data on the tracker');
{
  const c = new Character(load('angou'));
  const t = c.addTracker({
    name: 'Burn',
    maxFormula: '3 + con.mod',
    style: {
      shape: 'bar',
      fill: 'remaining',
      color: '#F07F3C',
      zones: [
        { from: '1', to: '3', color: '#6bbf7b', label: 'fine' },
        { from: 'tracker.burn.max - 2', to: 'tracker.burn.max', color: 'not-a-colour', label: 'lethal' },
        { from: 'nope + 1', to: '9', color: '#123456' },
      ],
    },
  });
  const con = c.data.abilities.con.mod;
  check('style normalised on write', t.style.color, '#f07f3c');
  check('shape kept', t.style.shape, 'bar');
  check('fill kept', t.style.fill, 'remaining');
  check('zone with junk colour gets the palette red', t.style.zones[1].color, '#e0635f');
  check('zones resolve against the character', [t.resolvedZones[1].fromValue, t.resolvedZones[1].toValue], [3 + con - 2, 3 + con]);
  check('bad zone bound is reported on the tracker', /zone 3: from: Unknown value "nope"/.test(t.error), true);
  check('good zones unaffected by the bad one', t.resolvedZones[0].error, null);
  check('remaining is in scope', c.scope().tracker.burn.remaining, 3 + con);
  c.updateTracker('burn', { current: 4 });
  check('remaining follows current', c.scope().tracker.burn.remaining, 3 + con - 4);
  check('scope names list remaining', c.scopeNames().includes('tracker.burn.remaining'), true);

  // Zone bounds follow the character like any formula.
  const untyped0 = Number(c.data.statsBuild.con.untyped) || 0;
  c.setBuild('con', 'untyped', untyped0 + 4);
  check('zone moves with Con', t.resolvedZones[1].toValue, 3 + con + 2);
  c.setBuild('con', 'untyped', untyped0);
  check('and back', t.resolvedZones[1].toValue, 3 + con);

  // Zone bounds are audited as player formulas.
  const audit = c.audit();
  const zoneFrom = audit.find((a) => a.id === 'burn:zone2:from');
  check('audit has zone bounds', zoneFrom?.formula, 'tracker.burn.max - 2');
  check('audit zone value', zoneFrom?.value, 3 + con - 2);
  check('audit zone label in name', /lethal/.test(zoneFrom?.name), true);
  check('audit flags the broken zone', audit.find((a) => a.id === 'burn:zone3:from')?.status, 'error');

  // An all-default style is stored as nothing at all.
  c.updateTracker('burn', { style: { shape: 'pips', fill: 'spent', color: '', zones: [] } });
  check('default style collapses to null', c.trackers.find((x) => x.id === 'burn').style, null);
  check('no zones -> none resolved', c.trackers.find((x) => x.id === 'burn').resolvedZones, []);
  check('error clears with the zones', c.trackers.find((x) => x.id === 'burn').error, null);

  // Round trip keeps the style, and derived zone data stays out of the file.
  c.updateTracker('burn', { style: { color: '#6ea8fe', gradientTo: '#a06fd6', zones: [{ from: '2', to: '2', color: '#ffffff', label: 'exact' }] } });
  const json = JSON.parse(JSON.stringify(c.toJSON()));
  const saved = json.customTrackers.find((x) => x.id === 'burn');
  check('style saved', [saved.style.color, saved.style.gradientTo], ['#6ea8fe', '#a06fd6']);
  check('zone formula saved', saved.style.zones[0].from, '2');
  check('resolved zones not persisted', 'resolvedZones' in saved, false);
  const c2 = new Character(json);
  const t2 = c2.trackers.find((x) => x.id === 'burn');
  check('style restored', t2.style.gradientTo, '#a06fd6');
  check('zones re-resolved on load', t2.resolvedZones[0].toValue, 2);
}

console.log('zones as states -- Bryva\'s Satiety from percentages of the pool');
{
  // Bryva's sheet already tracks Culinary Stamina (15 of 17, "Stuffed (88%)"
  // kept by hand). Percentage zones on the sheet's own tracker replace that.
  const c = new Character(load('bryva'));
  const satiety = (id) => [
    { from: '0', to: `floor(tracker.${id}.max * 0.3)`, color: '#e0635f', label: 'Hungry' },
    { from: `floor(tracker.${id}.max * 0.3) + 1`, to: `floor(tracker.${id}.max * 0.7)`, color: '#6bbf7b', label: 'Sated' },
    { from: `floor(tracker.${id}.max * 0.7) + 1`, to: `tracker.${id}.max`, color: '#a06fd6', label: 'Stuffed' },
  ];
  const t = c.updateTracker('culinary_stamina', {
    style: { shape: 'bar', fill: 'remaining', color: '#f2c14e', zones: satiety('culinary_stamina') },
  });
  check('sheet tracker keeps its max', t.max, 17);
  check('zones resolve off the tracker\'s own max', t.resolvedZones.map((z) => [z.fromValue, z.toValue]), [[0, 5], [6, 11], [12, 17]]);
  check('no zone errors', t.error, null);
  const stateAt = (remaining) => zoneAt(remaining, t.resolvedZones)?.label ?? null;
  check('full pool is Stuffed', stateAt(17), 'Stuffed');
  check('the sheet\'s 15 is Stuffed (88%)', stateAt(15), 'Stuffed');
  check('empty pool is Hungry (zone from 0)', stateAt(0), 'Hungry');
  check('middle is Sated', stateAt(8), 'Sated');
  check('boundary belongs to the lower band', stateAt(5), 'Hungry');
  check('just above it is Sated', stateAt(6), 'Sated');
  // Bar bands: three contiguous bands covering the track.
  const layout = barLayout({ min: 0, max: 17, current: 2, style: t.style, resolvedZones: t.resolvedZones });
  check('three bands', layout.bands.length, 3);
  check('bands tile the track', layout.bands[0].from === 0 && layout.bands[2].to === 1
    && Math.abs(layout.bands[0].to - layout.bands[1].from) < 1e-9 && Math.abs(layout.bands[1].to - layout.bands[2].from) < 1e-9, true);
  check('audit lists the zone formulas', c.audit().filter((a) => a.id.startsWith('culinary_stamina:zone')).length, 6);
  check('audit names carry the state', c.audit().find((a) => a.id === 'culinary_stamina:zone3:to')?.name, 'Culinary Stamina zone 3 (Stuffed) to');

  // On a formula-driven pool the bands move with it -- and they are right on
  // the very first compute, because zones resolve after all ranges are set.
  const p = c.addTracker({ name: 'Stamina Pool', maxFormula: 'floor(level / 2) + con.mod', style: { zones: satiety('stamina_pool') } });
  const max = p.max;
  check('own max is fresh on first compute', p.resolvedZones[2].toValue, max);
  const untyped0 = Number(c.data.statsBuild.con.untyped) || 0;
  c.setBuild('con', 'untyped', untyped0 + 4);
  check('bands follow the new max', p.resolvedZones[2].toValue, max + 2);
  check('and the 30% line moves', p.resolvedZones[0].toValue, Math.floor((max + 2) * 0.3));
  c.setBuild('con', 'untyped', untyped0);
}

console.log('sheet trackers can be styled without touching the sheet numbers');
{
  const c = new Character(load('angou'));
  const mp = c.trackers.find((t) => t.source === 'sheet');
  check('mythic power carries only its seeded default', mp.style, normalizeStyle({ fill: 'remaining' }));
  c.updateTracker(mp.id, { current: 3, style: { color: '#7b7fe6', fill: 'remaining' } });
  check('style applied', c.trackers.find((t) => t.id === mp.id).style.color, '#7b7fe6');
  check('sheet max untouched', c.trackers.find((t) => t.id === mp.id).max, 23);
  const json = JSON.parse(JSON.stringify(c.toJSON()));
  const state = json.sheetTrackerState.find((s) => s.id === mp.id);
  check('style rides in sheetTrackerState', state.style.color, '#7b7fe6');
  check('current still there', state.current, 3);
  const c2 = new Character(json);
  const mp2 = c2.trackers.find((t) => t.id === mp.id);
  check('style restored for the sheet tracker', [mp2.style.color, mp2.style.fill], ['#7b7fe6', 'remaining']);
  check('still from the sheet', mp2.source, 'sheet');
  check('a style matching the seed saves no style key', 'style' in (JSON.parse(JSON.stringify(new Character(load('angou')).toJSON())).sheetTrackerState[0]), false);
  const bry = new Character(load('bryva'));
  bry.updateTracker('spell_points', { style: { color: '#4cc3e0' } });
  const bryState = JSON.parse(JSON.stringify(bry.toJSON())).sheetTrackerState;
  check('an unstyled sheet tracker saves its new style', bryState.find((s) => s.id === 'spell_points').style.color, '#4cc3e0');
  check('and its untouched neighbour saves none', 'style' in bryState.find((s) => s.id === 'culinary_stamina'), false);
}

console.log('Mythic Power drains by default');
{
  for (const id of IDS) {
    const raw = load(id);
    const c = new Character(raw);
    const mp = c.trackers.find((t) => t.id === 'mythic_power');
    check(`${id} mythic power drains`, mp.style?.fill, 'remaining');
    check(`${id} nothing else is styled`, c.trackers.filter((t) => t.id !== 'mythic_power' && t.style), []);
    // Draining is presentation only -- the stored value is still the sheet's
    // own Uses count, and `remaining` is the drained view of it. (Saburo's
    // sheet is the one that ships with a non-zero count.)
    const uses = Number(raw.resources.find((r) => /mythic power/i.test(r.name)).uses) || 0;
    check(`${id} keeps the sheet's count`, mp.current, uses);
    check(`${id} remaining is max - spent`, c.scope().tracker.mythic_power.remaining, mp.max - uses);
  }

  // Spending still moves `current` upward; `remaining` is the drained view.
  const c = new Character(load('angou'));
  c.stepTracker('mythic_power', 3);
  check('spent three', c.trackers[0].current, 3);
  check('twenty left', c.scope().tracker.mythic_power.remaining, 20);
  c.restoreAll();
  check('rest refills', c.scope().tracker.mythic_power.remaining, 23);

  // The default is a seed, not a lock: turning it off must survive a reload.
  c.updateTracker('mythic_power', { style: null });
  check('drain turned off', c.trackers[0].style, null);
  const off = JSON.parse(JSON.stringify(c.toJSON()));
  check('recorded as an explicit null', off.sheetTrackerState[0].style, null);
  check('and stays off after a reload', new Character(off).trackers[0].style, null);

  // A different style choice also sticks.
  const c2 = new Character(off);
  c2.updateTracker('mythic_power', { style: { shape: 'bar', color: '#7b7fe6' } });
  const c3 = new Character(JSON.parse(JSON.stringify(c2.toJSON())));
  check('a chosen style survives', [c3.trackers[0].style.shape, c3.trackers[0].style.fill], ['bar', 'spent']);

  // An auto-granted Mythic Power drains too.
  const bare = load('angou');
  bare.resources = [];
  bare.identity.level = 7;
  bare.identity.mythicTier = 0;
  const low = new Character(bare);
  low.set('identity.level', 8);
  check('auto-granted mythic power drains', low.trackers[0].style?.fill, 'remaining');
  check('and keeps it through a round trip',
    new Character(JSON.parse(JSON.stringify(low.toJSON()))).trackers[0].style?.fill, 'remaining');
}

console.log('Mythic Power is the one required tracker; everything else is the player\'s');
{
  // It is 3 + 2 per tier, which is what every source sheet recorded, so it
  // imports unchanged and now follows the tier.
  for (const id of IDS) {
    const raw = load(id);
    const c = new Character(raw);
    const mp = c.trackers.find((t) => t.id === 'mythic_power');
    const sheet = raw.resources.find((r) => /mythic power/i.test(r.name));
    check(`${id} mythic power matches the sheet`, mp.max, Number(sheet.total));
    check(`${id} mythic power follows the tier`, mp.maxFormula, MYTHIC_POWER_FORMULA);
  }

  const c = new Character(load('saburo'));
  const mp = () => c.trackers.find((t) => t.id === 'mythic_power');
  check('saburo tier 1 -> 5', mp().max, 5);
  c.set('identity.level', 20);
  check('levelling to 20 raises it to 23', mp().max, 23);
  c.set('identity.level', 7);
  check('below level 8 it is 0', mp().max, 0);
  check('but it is still there', !!mp(), true);
  c.set('identity.level', 9);
  check('and comes back with the tier', mp().max, 5);

  check('protected', c.isProtectedTracker('mythic_power'), true);
  check('nothing else is', c.isProtectedTracker('theory'), false);
  check('removal refused', c.removeTracker('mythic_power'), false);
  check('still there after the attempt', !!mp(), true);

  // A character with no Mythic Power in their sheet gains one when mythic.
  // (Both level and the imported tier have to say "not mythic yet", or the
  // model reads the mismatch as a GM-granted tier.)
  const bare = load('angou');
  bare.resources = [];
  bare.identity.level = 7;
  bare.identity.mythicTier = 0;
  const low = new Character(bare);
  check('no tier override inferred', low.data.mythic.tierOverride, null);
  check('not mythic yet -> no tracker', low.trackers.some((t) => t.id === 'mythic_power'), false);
  low.set('identity.level', 8);
  const gained = low.trackers.find((t) => t.id === 'mythic_power');
  check('reaching level 8 grants it', gained?.max, 5);
  check('and it is first in the list', low.trackers[0].id, 'mythic_power');
  const lowAgain = new Character(JSON.parse(JSON.stringify(low.toJSON())));
  check('it survives a round trip', lowAgain.trackers.filter((t) => t.id === 'mythic_power').length, 1);
}

console.log('sheet-seeded trackers are fully editable and removable');
{
  const c = new Character(load('bryva'));
  const ids = c.trackers.map((t) => t.id);
  check('bryva\'s sheet trackers', ids, ['mythic_power', 'spell_points', 'culinary_stamina', 'satiety', 'stuffed_88']);

  // Rename and retype Spell Points -- a plain number becomes a live formula.
  const sp = c.updateTracker('spell_points', { name: 'Spell Points (SP)', maxFormula: 'caster.sp', refresh: 'Per rest' });
  check('renamed', sp.name, 'Spell Points (SP)');
  check('max now computed', sp.max, c.data.training.magic.totalSP);
  check('flagged as edited', sp.edited, true);
  check('untouched sheet trackers are not flagged', c.trackers.find((t) => t.id === 'culinary_stamina').edited, false);
  check('id is stable across a rename', c.scope().tracker.spell_points !== undefined, true);

  // The two hand-kept state rows go away; zones replace them.
  check('delete a sheet tracker', c.removeTracker('satiety'), true);
  check('and another', c.removeTracker('stuffed_88'), true);
  check('gone', c.trackers.map((t) => t.id), ['mythic_power', 'spell_points', 'culinary_stamina']);

  // The import itself is untouched, so Reset still restores the sheet.
  check('resources block is pristine', c.data.resources.map((r) => r.name),
    ['Mythic Power', 'Spell Points', 'Culinary Stamina', 'Satiety', 'Stuffed (88%)']);

  const json = JSON.parse(JSON.stringify(c.toJSON()));
  const state = Object.fromEntries(json.sheetTrackerState.map((s) => [s.id, s]));
  check('edits saved as overrides', [state.spell_points.name, state.spell_points.maxFormula], ['Spell Points (SP)', 'caster.sp']);
  check('untouched tracker saves no overrides', Object.keys(state.culinary_stamina).sort(), ['current', 'id']);
  check('deletions are remembered', [state.satiety.deleted, state.stuffed_88.deleted], [true, true]);

  const c2 = new Character(json);
  check('edits restored', c2.trackers.find((t) => t.id === 'spell_points').name, 'Spell Points (SP)');
  check('formula restored', c2.trackers.find((t) => t.id === 'spell_points').max, c.data.training.magic.totalSP);
  check('still edited after reload', c2.trackers.find((t) => t.id === 'spell_points').edited, true);
  check('deleted stay deleted', c2.trackers.map((t) => t.id), ['mythic_power', 'spell_points', 'culinary_stamina']);
  check('and are not resurrected by a second round trip',
    new Character(JSON.parse(JSON.stringify(c2.toJSON()))).trackers.map((t) => t.id),
    ['mythic_power', 'spell_points', 'culinary_stamina']);

  // Editing a field back to the sheet's value clears the override.
  c2.updateTracker('spell_points', { name: 'Spell Points', maxFormula: '23', refresh: 'Daily' });
  check('back to the sheet -> not edited', c2.trackers.find((t) => t.id === 'spell_points').edited, false);
  const clean = JSON.parse(JSON.stringify(c2.toJSON())).sheetTrackerState.find((s) => s.id === 'spell_points');
  check('and no overrides saved', Object.keys(clean).sort(), ['current', 'id']);

  // A fresh import brings everything back.
  const fresh = new Character(load('bryva'));
  check('reset restores the sheet\'s trackers', fresh.trackers.length, 5);
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

console.log('column rules gate the feature grid');
{
  const c = new Character(load('angou'));
  const cls = c.progressionClasses()[0];
  const cols = () => c.data.progression.classFeatures[cls].columns;
  const rulesOf = (col) => c.data.progression.classFeatures[cls].rules[col];
  c.addClassFeatureColumn(cls, 'Veil');
  c.setClassFeatureColumnRule(cls, cols().indexOf('Veil'), '2, +4');

  const rows = c.classFeatureRows(cls);
  check('a row knows both its levels', [rows[0].level, rows[0].classLevel], [1, 1]);
  check('granting levels follow the rule',
    rows.filter((r) => r.cells.Veil.on).map((r) => r.classLevel), [2, 6, 10, 14, 18]);
  check('an unruled column still grants everywhere',
    rows.every((r) => r.cells[cols()[0]].on), true);
  check('the one-string shorthand makes a single group',
    rulesOf('Veil').map((g) => g.rule), ['2, +4']);
  check('and it gets a colour', /^#[0-9a-f]{6}$/.test(rulesOf('Veil')[0].color), true);

  // The rule follows a rename and dies with the column.
  c.renameClassFeatureColumn(cls, cols().indexOf('Veil'), 'Veils');
  check('the rule follows a rename', rulesOf('Veils')[0].rule, '2, +4');
  check('and does not linger under the old name', rulesOf('Veil'), undefined);
  check('renamed column still gates the same levels',
    c.classFeatureRows(cls).filter((r) => r.cells.Veils.on).map((r) => r.classLevel), [2, 6, 10, 14, 18]);

  // Text on an excluded level is kept, not destroyed, and says so.
  const excluded = c.classFeatureRows(cls).find((r) => !r.cells.Veils.on).level;
  c.setClassFeature(cls, excluded, 'Veils', 'typed before the rule');
  check('text outside the rule survives',
    c.data.progression.classFeatures[cls].byLevel[excluded].Veils, 'typed before the rule');
  check('and is flagged stranded',
    c.classFeatureRows(cls).find((r) => r.level === excluded).cells.Veils.stranded, true);

  // Clearing the rule opens the column back up.
  c.setClassFeatureColumnRule(cls, cols().indexOf('Veils'), '');
  check('an empty rule unlocks every level',
    c.classFeatureRows(cls).every((r) => r.cells.Veils.on), true);
  check('and is not stored', rulesOf('Veils'), undefined);

  // Round trip.
  c.setClassFeatureColumnRule(cls, cols().indexOf('Veils'), 'odd');
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('rules survive save and reload',
    back.data.progression.classFeatures[cls].rules.Veils[0].rule, 'odd');

  c.removeClassFeatureColumn(cls, cols().indexOf('Veils'));
  check('removing a column removes its rule', rulesOf('Veils'), undefined);
}

console.log('several named rule groups can share one column');
{
  const c = new Character(load('angou'));          // level 20, so nothing is future
  const cls = c.progressionClasses()[0];
  c.addClassFeatureColumn(cls, 'Wild Talent');
  const at = () => c.data.progression.classFeatures[cls].columns.indexOf('Wild Talent');
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Infusions', rule: 'odd, -5, -9, -13' });
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Utility', rule: 'even' });

  const rows = c.classFeatureRows(cls);
  const at7 = (lvl, rs = rows) => rs.find((r) => r.level === lvl).cells['Wild Talent'];
  const owners = (lvl, rs) => at7(lvl, rs).fields.map((f) => f.group?.name);
  check('two groups sit on one column', c.classFeatureRuleGroups(cls, 'Wild Talent').length, 2);
  check('odd levels belong to the first',
    [owners(1), owners(3), owners(7)], [['Infusions'], ['Infusions'], ['Infusions']]);
  check('even levels to the second',
    [owners(2), owners(4), owners(6)], [['Utility'], ['Utility'], ['Utility']]);
  check('and the subtracted levels to neither',
    [owners(5), owners(9), owners(13)], [[null], [null], [null]]);
  check('which locks them', rows.filter((r) => !at7(r.level).on).map((r) => r.level), [5, 9, 13]);
  check('one group granting means one field',
    rows.every((r) => at7(r.level).fields.length === 1), true);
  check('each group keeps its own colour',
    c.classFeatureRuleGroups(cls, 'Wild Talent').map((g) => g.color).filter((x, i, a) => a.indexOf(x) === i).length, 2);

  // Overlap: both groups grant, so the level gets a field each.
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Elemental', rule: '7' });
  const rows2 = c.classFeatureRows(cls);
  check('two groups on one level give two fields', owners(7, rows2), ['Infusions', 'Elemental']);
  check('in the order the groups are declared',
    at7(7, rows2).fields.map((f) => f.key), ['Infusions', 'Elemental']);
  check('and levels only one grants keep a single field', owners(3, rows2), ['Infusions']);

  // The braced form fills both fields at once.
  c.setClassFeatureRuleGroup(cls, at(), 2, { rule: '{Metakinesis, 5, +4}' });
  const braced = c.classFeatureRuleGroups(cls, 'Wild Talent')[2];
  check('{Name, rule} splits into both fields', [braced.name, braced.rule], ['Metakinesis', '5, +4']);

  // Emptying a group drops it; dropping the last unrules the column.
  c.setClassFeatureRuleGroup(cls, at(), 2, { name: '', rule: '' });
  check('an empty group is dropped', c.classFeatureRuleGroups(cls, 'Wild Talent').length, 2);
  c.removeClassFeatureRuleGroup(cls, at(), 1);
  c.removeClassFeatureRuleGroup(cls, at(), 0);
  check('removing the last group unrules the column',
    c.data.progression.classFeatures[cls].rules['Wild Talent'], undefined);
  check('so every level is live again',
    c.classFeatureRows(cls).every((r) => r.cells['Wild Talent'].on), true);

  // Groups round-trip whole.
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Infusions', rule: 'odd', color: '#6ea8fe' });
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('name, rule and colour all survive a reload',
    back.classFeatureRuleGroups(cls, 'Wild Talent'), [{ name: 'Infusions', rule: 'odd', color: '#6ea8fe' }]);
}

console.log('two rule groups on one level each get their own field');
{
  // Bryva's Blacksmith: Smithing Insight on "even, 1" and Creation Specialist
  // on "1, 5, +5" both grant at class levels 1, 10 and 20.
  const c = new Character(load('bryva'));
  const cls = 'Blacksmith';
  const col = 'Feature Selection';
  c.addClassFeatureColumn(cls, col);
  const at = () => c.data.progression.classFeatures[cls].columns.indexOf(col);
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Smithing Insight', rule: 'even, 1' });
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Creation Specialist', rule: '1, 5, +5' });

  const cell = (lvl) => c.classFeatureRows(cls).find((r) => r.level === lvl).cells[col];
  const names = (lvl) => cell(lvl).fields.map((f) => f.group?.name);
  check('a shared level stacks both groups', names(1), ['Smithing Insight', 'Creation Specialist']);
  check('and so do the later overlaps', [names(10), names(20)],
    [['Smithing Insight', 'Creation Specialist'], ['Smithing Insight', 'Creation Specialist']]);
  check('a level only one grants stays single', [names(2), names(5)],
    [['Smithing Insight'], ['Creation Specialist']]);
  check('a level neither grants has no group', names(3), [null]);

  // Level 1 already carries the sheet's own text, as one string. It belongs to
  // the first group that grants, and the second field is the one still owed --
  // which is the whole point: the slot was previously invisible.
  check('the sheet\'s text lands on the first group',
    cell(1).fields[0].text.startsWith('Recipes'), true);
  check('and the second group is the one still owed',
    cell(1).fields.map((f) => f.due), [false, true]);

  // Each field is written and read independently, and counted separately.
  const owed = () => c.classFeatureDue(cls)[col];
  const before = owed();
  c.setClassFeature(cls, 1, col, 'Blended Training', 'Creation Specialist');
  check('filling the empty field of a stacked level settles just it',
    [cell(1).fields[1].due, owed()], [false, before - 1]);
  check('and leaves the first field alone', cell(1).fields[0].text.startsWith('Recipes'), true);
  check('the cell now holds one entry per group',
    Object.keys(c.data.progression.classFeatures[cls].byLevel[1][col]),
    ['Smithing Insight', 'Creation Specialist']);

  // A single-field level still stores a plain string, as every sheet does.
  c.setClassFeature(cls, 2, col, 'Vegetables', 'Smithing Insight');
  check('a level with one field stays a plain string',
    c.data.progression.classFeatures[cls].byLevel[2][col], 'Vegetables');

  // Clearing one field leaves the other, and the cell collapses back to the
  // plain string it was before a second field existed.
  const sheetText = cell(1).fields[0].text;
  c.setClassFeature(cls, 1, col, '', 'Creation Specialist');
  check('clearing one field collapses the cell back to a string',
    c.data.progression.classFeatures[cls].byLevel[1][col], sheetText);
  check('and the other still reads back under its own group',
    cell(1).fields.map((f) => f.text), [sheetText, '']);

  // Text written before a second group existed belongs to the owning group.
  const c2 = new Character(load('bryva'));
  c2.addClassFeatureColumn(cls, col);
  c2.setClassFeature(cls, 1, col, 'written first');
  c2.addClassFeatureRuleGroup(cls, at(), { name: 'Smithing Insight', rule: 'even, 1' });
  c2.addClassFeatureRuleGroup(cls, at(), { name: 'Creation Specialist', rule: '1, 5, +5' });
  const first = c2.classFeatureRows(cls).find((r) => r.level === 1).cells[col];
  check('a bare string belongs to the first group that grants',
    first.fields.map((f) => f.text), ['written first', '']);
  c2.setClassFeature(cls, 1, col, 'written second', 'Creation Specialist');
  check('and survives writing the other field',
    c2.data.progression.classFeatures[cls].byLevel[1][col],
    { 'Smithing Insight': 'written first', 'Creation Specialist': 'written second' });

  // Renaming a group carries its text, the way renaming a column does.
  c2.setClassFeatureRuleGroup(cls, at(), 1, { name: 'Creation Spec.' });
  check('a renamed group keeps its text',
    c2.data.progression.classFeatures[cls].byLevel[1][col],
    { 'Smithing Insight': 'written first', 'Creation Spec.': 'written second' });
  check('and reads back under the new name',
    c2.classFeatureRows(cls).find((r) => r.level === 1).cells[col].fields.map((f) => f.text),
    ['written first', 'written second']);

  // Removing a group strands its text rather than deleting it.
  c2.removeClassFeatureRuleGroup(cls, at(), 1);
  const orphaned = c2.classFeatureRows(cls).find((r) => r.level === 1).cells[col];
  check('a removed group leaves its text stranded',
    orphaned.fields.map((f) => [f.group?.name, f.text, f.on]),
    [['Smithing Insight', 'written first', true], ['Creation Spec.', 'written second', false]]);
  check('flagged as an orphan', orphaned.fields[1].group.orphan, true);
  check('and not counted as owed', orphaned.fields[1].due, false);

  // Round trip, with both fields filled so the map form is what gets saved.
  c.setClassFeature(cls, 1, col, 'Blended Training', 'Creation Specialist');
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('per-group text survives a reload',
    back.classFeatureRows(cls).find((r) => r.level === 1).cells[col].fields.map((f) => f.text),
    [sheetText, 'Blended Training']);
}

console.log('unfilled slots are counted, and only once you reach them');
{
  const c = new Character(load('saburo'));         // level 9, so 10-20 are plans
  const cls = 'L. Samurai';                        // runs 1-20, so class level == character level
  c.addClassFeatureColumn(cls, 'Veil');
  const at = () => c.data.progression.classFeatures[cls].columns.indexOf('Veil');
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Veils', rule: '2, +4' });
  const cell = (lvl) => {
    const x = c.classFeatureRows(cls).find((r) => r.level === lvl).cells.Veil;
    return { ...x, ...x.fields[0] };     // one group here, so one field
  };

  check('a reached, empty, granted level is due', [cell(2).due, cell(6).due], [true, true]);
  check('an unreached one is only planned',
    [cell(10).due, cell(10).planned, cell(18).planned], [false, true, true]);
  check('a level that grants nothing is neither',
    [cell(3).due, cell(3).planned, cell(3).on], [false, false, false]);
  check('the count covers only what you owe now', c.classFeatureDue(cls).Veil, 2);

  c.setClassFeature(cls, 6, 'Veil', 'Cloak of Discretion');
  check('filling one settles it', [cell(6).due, c.classFeatureDue(cls).Veil], [false, 1]);
  c.setClassFeature(cls, 2, 'Veil', '   ');
  check('whitespace does not count as filled in', [cell(2).due, c.classFeatureDue(cls).Veil], [true, 1]);

  // An unruled column never nags: it has no notion of a slot.
  check('unruled columns owe nothing',
    c.classFeatureDue(cls)[c.data.progression.classFeatures[cls].columns[0]], undefined);
}

console.log('a gap in a track moves a rule off the character levels');
{
  // Saburo's Kheshig skips character level 2, so the class's own 2nd level is
  // character level 3: "a veil at 2 and every 4 thereafter" walks 3/7/11/15/19
  // rather than 2/6/10/14/18. This is the whole reason rules count class levels.
  const c = new Character(load('saburo'));
  const cls = 'Kheshig';
  check('the track really has a gap', c.classLevelsIn(cls).includes(2), false);
  c.addClassFeatureColumn(cls, 'Veil');
  const at = () => c.data.progression.classFeatures[cls].columns.indexOf('Veil');
  c.addClassFeatureRuleGroup(cls, at(), { name: 'Veils', rule: '2, +4' });
  const granting = () => c.classFeatureRows(cls).filter((r) => r.cells.Veil.on);

  check('class levels still walk 2, 6, 10, 14, 18',
    granting().map((r) => r.classLevel), [2, 6, 10, 14, 18]);
  check('but they land on shifted character levels',
    granting().map((r) => r.level), [3, 7, 11, 15, 19]);

  c.setClassFeatureRuleGroup(cls, at(), 0, { rule: 'char: 2, +4' });
  check('char: puts them back on the character levels',
    granting().map((r) => r.level), [6, 10, 14, 18]);   // character level 2 is not a Warlord level at all
}

console.log('imported characters gain no rules');
for (const id of IDS) {
  const c = new Character(load(id));
  const groups = Object.values(c.data.progression.classFeatures);
  check(`${id} every group has a rules map`, groups.every((g) => g.rules && typeof g.rules === 'object'), true);
  check(`${id} but no column is gated on import`,
    groups.every((g) => Object.keys(g.rules).length === 0), true);
  check(`${id} so every feature cell stays live`,
    c.progressionClasses().every((n) => c.classFeatureRows(n)
      .every((r) => Object.values(r.cells).every((x) => x.on && !x.ruled))), true);
  check(`${id} and nothing is reported as owed`,
    c.progressionClasses().every((n) => Object.keys(c.classFeatureDue(n)).length === 0), true);
}

console.log('a rule saved as a bare string still loads');
{
  const raw = load('angou');
  const c0 = new Character(raw);
  const cls = c0.progressionClasses()[0];
  const json = JSON.parse(JSON.stringify(c0.toJSON()));
  // What the first version of this feature wrote to localStorage.
  json.progression.classFeatures[cls].rules = { Features: 'odd' };
  const c = new Character(json);
  check('the string becomes one unnamed group',
    c.classFeatureRuleGroups(cls, 'Features').map((g) => [g.name, g.rule]), [['', 'odd']]);
  check('with a colour filled in', /^#[0-9a-f]{6}$/.test(c.classFeatureRuleGroups(cls, 'Features')[0].color), true);
  check('and it gates the same levels',
    c.classFeatureRows(cls).filter((r) => r.cells.Features.on).map((r) => r.classLevel),
    [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
}

console.log('item crafting reproduces the workbook, then recalculates');
{
  // Bryva is the only character whose Item Crafting tab was filled in, so her
  // numbers are the fixed point: 5 crafting bonuses at x2 = 10,000 mana of
  // progress a day, a 10% reduction on a half-cost item, a 200,000 ring that
  // costs 90,000 and sells at cost, and a take-10 check off Craft (Weapons).
  const c = new Character(load('bryva'));
  const cr = c.data.crafting;
  const p = cr.projects[0];
  check('the raw tab is gone', (c.data.sheetTabs || []).some((t) => t.name === 'Item Crafting'), false);
  check('speed per day', cr.calc.speedPerDay, 10000);
  check('base cost fraction', cr.calc.baseFraction, 0.5);
  check('reductions compound', cr.calc.compounding, 0.9);
  check('value : craft ratio', cr.calc.ratio, 0.45);
  check('item and value', [p.name, p.calc.value], ['Ring of Flexibility', 200000]);
  check('final crafting cost', p.calc.cost, 90000);
  check('gross profit', p.calc.gross, 110000);
  check('final sale at a 100% discount is cost', p.calc.sale, 90000);
  check('net profit', p.calc.net, 0);
  check('days to complete', [p.calc.days, p.calc.daysExact], [20, 20]);
  // Progress is measured against the item's base price, not what it cost to
  // make: 200,000 / 10,000 a day, never 90,000 / 10,000.
  check('days come off the base price', p.calc.basis, p.calc.value);
  c.set('crafting.timeBasis', 'cost');
  check('the crafting-cost basis is the other option', [p.calc.basis, p.calc.days], [90000, 9]);
  c.set('crafting.timeBasis', 'value');
  check('and back', [p.calc.basis, p.calc.days], [200000, 20]);
  check('check is take 10 + Craft (Weapons)', p.calc.check, 56);
  check('and names the skill it used', cr.calc.skill, 'Craft (Weapons)');

  // "+5 Rush" was a note the sheet could not add up. It is an adjustment now.
  check('the DC note became an adjustment', p.dcAdjustments.map((a) => [a.label, a.value]), [['Rush', 5]]);
  check('so the DC includes it', p.calc.dc, 15);

  // Bryva's Armiger block (M2:S9) is not modelled, but it is not lost either.
  check('unmodelled cells kept', cr.sourceExtras.length, 7);
  check('with their content', cr.sourceExtras[1].cells.slice(0, 2), ['Weapon', 'Handwraps 1']);

  // Live recalculation.
  c.setItem('crafting.speedIncreases', 3, 'enabled', false);   // Demiplane off
  check('one bonus fewer is x8', c.data.crafting.calc.speedPerDay, 8000);
  check('so the ring takes longer', p.calc.days, 25);
  c.setItem('crafting.speedIncreases', 3, 'enabled', true);

  c.set('crafting.baseCostIndex', 1);                          // a third, not a half
  check('a third of market value', c.data.crafting.calc.ratio, 0.3);
  check('costs 60,000', p.calc.cost, 60000);
  c.set('crafting.baseCostIndex', 0);
  check('back to 90,000', p.calc.cost, 90000);

  // CEILING() over binary floats: 200000 x 0.5 x 0.9 must not round to 90001.
  check('no float drift in the price', p.calc.cost, 90000);

  c.set('crafting.discount', 25);
  check('a 25% discount sells at 150,000', p.calc.sale, 150000);
  check('for 60,000 profit', p.calc.net, 60000);
  c.setItem('crafting.projects', 0, 'zeroProfit', true);
  check('zero profit sells at cost', [p.calc.sale, p.calc.net], [90000, 0]);
  check('and the post says so', p.calc.craftPost.includes('**Profit**: No Profit'), true);
  c.setItem('crafting.projects', 0, 'zeroProfit', false);
  c.setItem('crafting.projects', 0, 'discountOverride', 0);
  check('a per-project override wins', p.calc.sale, 200000);
  c.setItem('crafting.projects', 0, 'discountOverride', null);
  c.set('crafting.discount', 100);

  // Bypassed requirements are +5 DC each.
  c.listAdd('crafting.projects.0.bypassed', { label: 'Craft Wondrous Item', enabled: true });
  check('bypassing raises the DC', p.calc.dc, 20);
  check('and says why', p.calc.dcParts, ['Rush +5', 'bypass: Craft Wondrous Item +5']);
  c.listRemove('crafting.projects.0.bypassed', 0);

  // Amounts may be formulas, resolved in the trackers' sandbox and audited.
  c.listAdd('crafting.speedIncreases', { label: 'Workshop', kind: 'flat', value: 'level * 100', enabled: true });
  check('a formula amount resolves', c.data.crafting.speedIncreases.at(-1).valueNum, 1600);
  check('and feeds the speed', c.data.crafting.calc.speedPerDay, (1000 + 1600) * 10);
  const audited = c.audit().filter((r) => r.source === 'crafting');
  check('it is in the audit', audited.map((r) => [r.formula, r.value, r.status]), [['level * 100', 1600, 'ok']]);

  c.setItem('crafting.speedIncreases', c.data.crafting.speedIncreases.length - 1, 'value', 'level * bogus');
  const broken = c.audit().find((r) => r.source === 'crafting');
  check('a bad reference is flagged, not thrown', broken.status, 'error');
  check('and the speed falls back to the rest', c.data.crafting.calc.speedPerDay, 10000);
  c.listRemove('crafting.speedIncreases', c.data.crafting.speedIncreases.length - 1);

  // The generated Discord post is the sheet's own format.
  check('crafting post', p.calc.craftPost.split('\n'), [
    '**Crafting**: Ring of Flexibility',
    '**Value**: 200000 mana',
    '**Cost**: 90000 mana',
    '**Profit**: 0 mana',
    '**DC**: 15 (Rush +5)',
    '**Check**: 56',
    '**Time to Completion**: 20 (20) days',
    '**Resources used:** ',
    '**Notes/Description**: ',
  ]);
  check('marketplace post', p.calc.marketPost.split('\n')[0], '**Character Name:** Nakano Bryva');
}

console.log('the three modelled sub-systems replace their raw grids');
{
  // Every character's Akashic, Maneuvers and Vancian tab is read once into a
  // structured block, and the grid it came from is retired so the two cannot
  // drift apart.
  for (const id of IDS) {
    const c = new Character(load(id));
    const names = (c.data.sheetTabs || []).map((t) => t.name);
    check(`${id} keeps no raw Akashic grid`, names.includes('Akashic'), false);
    check(`${id} keeps no raw Maneuvers grid`, names.includes('Maneuvers'), false);
    check(`${id} keeps no raw Vancian grid`, names.includes('Vancian Magic'), false);
    check(`${id} has an akashic block`, !!c.data.akashic, true);
    check(`${id} has a maneuvers block`, !!c.data.maneuvers, true);
    check(`${id} has a vancian block`, !!c.data.vancian, true);
  }

  // Vancian Magic held no character data on any of these sheets: the one cell
  // that varied between them repeated identity.primordiaTechnique.
  for (const id of IDS) {
    const c = new Character(load(id));
    check(`${id} vancian imports empty`, c.data.vancian.classes.length, 0);
    check(`${id} vancian leaves no residue`, c.data.vancian.sourceExtras.length, 0);
  }
}

console.log('akashic -- veil DCs come back from base DC plus essence');
{
  const c = new Character(load('angou'));
  const a = c.data.akashic;
  check('veilweaving class read', [a.classes[0].name, a.classes[0].mod], ['Incanter', 'Con']);
  check('essence cap and bonus cap', [a.classes[0].essenceCap, a.classes[0].bonusCap], [4, 3]);
  check('total cap is computed, not stored', a.classes[0].totalCap, 7);
  check('base DC', a.baseDC, 25);
  check('steady veil DC', a.steadyVeilDC, 35);

  // The workbook's own "Used/Total" read 20/20.
  check('essence pool', a.calc.pool, 20);
  check('essence invested matches the sheet', a.calc.used, 20);
  check('nothing left over', a.calc.free, 0);

  const shaped = a.slots.filter((s) => s.veils.length);
  check('only shaped slots hold veils', shaped.length, 4);
  const hands = a.slots.find((s) => s.slot === 'Hands');
  check('twinveil holds two', [hands.twinveil, hands.veils.length], [true, 2]);
  check('and both carry their own essence', hands.veils.map((v) => v.essence), [7, 7]);
  check('DC is base + essence', hands.veils.map((v) => v.dc), [32, 32]);

  const marilith = a.slots.find((s) => s.slot === 'Shoulder').veils[0];
  check("Marilith's Aspect DC", [marilith.essence, marilith.dc], [6, 31]);

  // Raising the base DC moves every veil with it.
  c.set('akashic.baseDC', 30);
  check('a new base DC lifts every veil', a.slots.find((s) => s.slot === 'Shoulder').veils[0].dc, 36);
  c.set('akashic.baseDC', 25);

  // Essence spent is the sum across every shaped veil.
  c.setItem('akashic.slots.5.veils', 0, 'essence', 10);
  check('spending more essence is counted', c.data.akashic.calc.used, 24);
  check('and shows as over budget', c.data.akashic.calc.free, -4);
  check('and over the per-veil cap', c.data.akashic.calc.overCap.length, 1);
  c.setItem('akashic.slots.5.veils', 0, 'essence', 6);
  check('and back again', c.data.akashic.calc.used, 20);
}

console.log('akashic -- essence spent reproduces every sheet');
{
  // The workbook's own "Used/Total" cell, against what the model adds up from
  // the veils and receptacles that hold the essence.
  const sheetUsedTotal = (doc) => {
    for (const row of doc.extraTabs?.Akashic?.rows || []) {
      const i = row.cells.findIndex((v) => String(v).trim() === 'Used/Total');
      if (i >= 0) return String(row.cells[i + 1]);
    }
    return null;
  };
  for (const id of IDS) {
    const doc = load(id);
    const k = new Character(doc).data.akashic.calc;
    check(`${id} essence used/total`, `${k.used}/${k.pool}`, sheetUsedTotal(doc));
  }

  // Narockro's receptacles put an on/off tick between the name and the
  // essence, so the essence column is found by its heading rather than
  // assumed to be the next one along -- otherwise the tick reads as a point.
  const n = new Character(load('narockro')).data.akashic;
  const caged = n.otherReceptacles.find((r) => r.name === 'The Caged Sun');
  check('a ticked receptacle keeps its essence', [caged.essence, caged.active], [3, true]);
  check('and an unticked one holds none',
    n.otherReceptacles.find((r) => r.name === 'Spoils of War').essence, 0);
  check('nothing is left unclaimed', n.sourceExtras.length, 0);
}

console.log('akashic -- a veil is a name and a description, not one cell');
{
  const c = new Character(load('saburo'));
  const veil = (name) => [...c.data.akashic.slots, ...c.data.akashic.kheshig]
    .flatMap((s) => s.veils).find((v) => v.name === name);

  // The workbook had one cell per veil, so the effect was written into it in
  // brackets. The bracketed half is a description.
  check('the bracketed half becomes the description',
    veil('Citadel Banner').desc, '20-foot radius, +4 Atk/AC');
  check('a veil with no brackets has no description',
    veil('Binding of the Immortal').desc, '');
  // Only the outermost brackets split; inner ones are part of the text.
  check('inner brackets stay in the description',
    veil('Bloodburst Blade').desc,
    'Up to 3 Blood Points x 13 (Int Mod + Invested Essence x2) Damage');
  check('a multi-line description keeps its lines',
    veil('Deathgrip Gauntlets').desc.includes('\n'), true);

  // A description resolves {…} the way it did when veils were grid cells.
  const si = c.data.akashic.slots.findIndex((s) => s.veils.length);
  c.setItem(`akashic.slots.${si}.veils`, 0, 'desc', 'holds {= 2 + 3} charges');
  const seg = c.renderProse(c.data.akashic.slots[si].veils[0].desc);
  check('a description computes its formulas', seg.map((s) => s.value ?? s.text), ['holds ', 5, ' charges']);

  // A name defined in a veil is visible to the rest of the sheet.
  c.setItem(`akashic.slots.${si}.veils`, 0, 'desc', '{veil_bonus = 4} to hit');
  check('and can define a name others read',
    c.renderProse('{veil_bonus}').map((s) => s.value), [4]);
}

console.log('akashic -- invested essence is readable from a formula');
{
  const raw = load('angou');
  const c = new Character(raw);
  const e = c.scope().essence;

  // The workbook published one defined name per receptacle. The same numbers
  // have to be reachable here, or a veil that scales off its own investment
  // has nothing to read.
  for (const [key, name] of [
    ['hands', 'VeilEssenceHands'], ['hands2', 'VeilEssenceHands2'],
    ['shoulder', 'VeilEssenceShoulder'], ['shoulder2', 'VeilEssenceShoulder2'],
    ['head', 'VeilEssenceHead'], ['belt', 'VeilEssenceBelt'],
    ['weapon', 'VeilEssenceWeapon'], ['armor', 'VeilEssenceArmor'],
  ]) {
    check(`essence.${key} matches ${name}`, e[key], raw.named[name]);
  }
  check('the pool totals are there too',
    [e.pool, e.used, e.free, e.cap], [20, 20, 0, 7]);

  // A slot with nothing in it answers zero rather than failing to resolve.
  check('an empty slot reads zero', e.voice, 0);
  check('and so does its twin', e.voice2, 0);

  // Reachable from an actual formula, not just present on the scope object.
  check('a formula can read a receptacle',
    c.renderProse('{= essence.hands * 2}').map((s) => s.value), [14]);
  check('and the free pool', c.renderProse('{= essence.pool - essence.used}').map((s) => s.value), [0]);

  // A veil's own description reads its investment without naming its slot.
  const si = c.data.akashic.slots.findIndex((s) => s.slot === 'Shoulder');
  const veil = c.data.akashic.slots[si].veils[0];
  check('essence.self is the veil it is written on',
    c.renderProse('{= essence.self}', c.veilScope(veil)).map((s) => s.value), [6]);
  check('without a veil there is no self',
    c.renderProse('{= essence.self}').map((s) => s.error !== undefined), [true]);

  // ...and it works in a definition, not only in a displayed value.
  c.setItem(`akashic.slots.${si}.veils`, 0, 'desc', '{marilith_dmg = essence.self * 3} damage');
  check('a definition resolves against the veil it sits on',
    c.renderProse('{marilith_dmg}').map((s) => s.value), [18]);

  // Changing the investment moves everything that reads it.
  c.setItem(`akashic.slots.${si}.veils`, 0, 'essence', 4);
  check('and follows the essence when it changes',
    [c.scope().essence.shoulder, c.renderProse('{marilith_dmg}').map((s) => s.value)[0]], [4, 12]);
  c.setItem(`akashic.slots.${si}.veils`, 0, 'essence', 6);

  // A receptacle that is not a slot is named too.
  const n = new Character(load('narockro'));
  check('an other receptacle is named after itself',
    n.renderProse('{= essence.the_caged_sun}').map((s) => s.value), [3]);
}

console.log('akashic -- Kheshig receptacles name a slot instead of filling one');
{
  const c = new Character(load('saburo'));
  const k = c.data.akashic.kheshig;
  check('both receptacles read', k.map((r) => r.label), KHESHIG_VEILS);
  check('weapon veil slot', [k[0].slot, k[0].bound], ['Hands', true]);
  check('its veil and essence', [k[0].veils[0].name.slice(0, 16), k[0].veils[0].essence], ['Bloodburst Blade', 3]);
  check('DC is base + essence', k[0].veils[0].dc, 20);
  check('armor veil slot', k[1].slot, 'Shoulder');
}

console.log('akashic -- spell points condense into temporary essence');
{
  const c = new Character(load('angou'));
  const a = c.data.akashic;
  const sp = () => c.data.training.magic;

  check('nothing condensed to begin with', [a.calc.temp, a.calc.spSpent], [0, 0]);
  check('and the day is just the pool', [a.calc.total, a.calc.free], [20, 0]);
  const totalSP = sp().totalSP;
  check('the whole spell-point pool is castable', sp().availableSP, totalSP);

  // Two points to the essence, which lasts the day and sits on top of the pool.
  c.set('akashic.essence.spTemp', 3);
  check('three temporary essence', c.data.akashic.calc.temp, 3);
  check('costs six spell points', c.data.akashic.calc.spSpent, 6);
  check('and widens the day', [c.data.akashic.calc.total, c.data.akashic.calc.free], [23, 3]);
  check('the pool itself does not move', c.data.akashic.calc.pool, 20);

  // The points are spent whether or not the essence gets invested.
  check('spell points come off the total', sp().spOnEssence, 6);
  check('leaving that much to cast with', sp().availableSP, totalSP - 6);
  check('and the total itself is untouched', sp().totalSP, totalSP);

  // Asking for more than the character has is flagged, not clamped: the number
  // typed is kept so it can be corrected rather than silently rewritten.
  c.set('akashic.essence.spTemp', 60);
  check('over-condensing is counted', c.data.akashic.calc.spSpent, 120);
  check('and says how far short it falls', c.data.akashic.calc.spShort, 120 - totalSP);
  check('the magic side agrees', [sp().spShort, sp().availableSP], [120 - totalSP, totalSP - 120]);

  // Half an essence is not a thing, and neither is a negative one.
  c.set('akashic.essence.spTemp', 2.5);
  check('a fraction rounds down', c.data.akashic.calc.temp, 2);
  c.set('akashic.essence.spTemp', -4);
  check('and a negative reads as none', [c.data.akashic.calc.temp, c.data.akashic.calc.spSpent], [0, 0]);

  // A formula reads the day's essence the same way the panel does.
  c.set('akashic.essence.spTemp', 3);
  const e = c.scope().essence;
  check('essence.temp and essence.total', [e.temp, e.total], [3, 23]);
  check('while essence.pool stays the day\'s own', e.pool, 20);
  check('caster.spAvailable follows', c.scope().caster.spAvailable, totalSP - 6);

  // And it is the player's choice, so it survives a round trip.
  const back = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('a saved sheet remembers what was condensed', back.data.akashic.calc.temp, 3);
  check('and it is still off the spell points',
    back.data.training.magic.availableSP, totalSP - 6);
}

console.log('maneuvers -- a catalogue of ticks, counted rather than stored');
{
  // Narockro is the only character who uses the tab; the other five carry it
  // as an untouched blank template, which must import to nothing at all.
  for (const id of IDS.filter((x) => x !== 'narockro')) {
    const c = new Character(load(id));
    check(`${id} has no disciplines`, c.data.maneuvers.disciplines.length, 0);
    check(`${id} leaves no residue`, c.data.maneuvers.sourceExtras.length, 0);
  }

  const c = new Character(load('narockro'));
  const m = c.data.maneuvers;
  check('six disciplines', m.disciplines.map((d) => d.name), [
    'Golden Lion', 'Radiant Dawn', 'Primal Fury', 'Shattered Mirror', 'Veiled Moon', 'Leaden Hyena',
  ]);
  // The maneuvers themselves come from the shared catalogue, so the character
  // stores only the names it readied.
  check('only the readied names are stored',
    m.disciplines.every((d) => Array.isArray(d.known)), true);
  check('the discipline still offers its whole list',
    m.disciplines[0].entries.length, disciplineEntries('Golden Lion').length);

  // The sheet's own header read 10/11 maneuvers and 4/4 stances.
  check('maneuvers known', m.calc.maneuvers, 10);
  check('maneuvers allowed', m.calc.possibleManeuvers, 11);
  check('stances known', m.calc.stances, 4);
  check('stances allowed', m.calc.possibleStances, 4);
  check('the build is legal', m.calc.legal, true);

  // The sheet's per-discipline counts were maneuvers and stances together.
  check('per-discipline counts reproduce the sheet',
    m.disciplines.map((d) => d.knownManeuvers + d.knownStances), [2, 7, 0, 3, 2, 0]);

  const gl = m.disciplines[0];
  check('entries carry their level and kind',
    gl.entries[0].level >= 1 && ['maneuver', 'stance'].includes(gl.entries[0].kind), true);
  check('a stance is typed as one', gl.entries.some((e) => e.kind === 'stance' && e.type === 'Stance'), true);

  // Readying one more maneuver takes the build to its allowance, and the one
  // after that past it. A maneuver is named rather than indexed, because the
  // row it sits on belongs to the catalogue.
  const spare = gl.entries.filter((e) => !e.known && e.kind !== 'stance');
  c.toggleManeuver('maneuvers.disciplines.0', spare[0].name, true);
  check('readying one is counted', c.data.maneuvers.calc.maneuvers, 11);
  check('still legal at the limit', c.data.maneuvers.calc.legal, true);
  c.toggleManeuver('maneuvers.disciplines.0', spare[1].name, true);
  check('one over is flagged', c.data.maneuvers.calc.legal, false);
  c.toggleManeuver('maneuvers.disciplines.0', spare[1].name, false);
  c.toggleManeuver('maneuvers.disciplines.0', spare[0].name, false);
  check('and unreadying puts it back', c.data.maneuvers.calc.maneuvers, 10);

  // A discipline is trained by name; its maneuvers come from the catalogue.
  c.listAdd('maneuvers.disciplines', { name: 'Silver Crane', known: [], custom: [] });
  const added = c.data.maneuvers.disciplines.at(-1);
  check('a newly trained discipline arrives fully stocked',
    added.entries.length, disciplineEntries('Silver Crane').length);
  check('with nothing readied yet', added.knownManeuvers + added.knownStances, 0);
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

console.log('vancian -- spell DCs pick up the casting stat the sheet never had');
{
  const c = new Character(load('nico'));
  c.listAdd('vancian.classes', {
    name: 'Hedgewitch', slotType: '', stat: 'Int', stat2: '', types: '',
    casterLevelOverride: 15, concentration: 0,
    spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
  });
  const v = c.data.vancian.classes[0];
  check('the stat modifier is read off the character', v.statMod, c.data.abilities.int.totalMod);
  check('DC is 10 + level + stat mod',
    v.spells.map((s) => s.dc), v.spells.map((s) => 10 + s.level + v.statMod));

  c.setItem('vancian.classes.0.spells', 3, 'perDay', 4);
  c.setItem('vancian.classes.0.spells', 4, 'perDay', 2);
  check('slots per day are totalled', c.data.vancian.classes[0].totalPerDay, 6);
}

console.log('vancian -- the shared casting table, read by header and not by order');
{
  check('every class in the tab is extracted', castingTableNames().length, 34);

  // The tab's column A is the dropdown's option list and is in a different
  // order from the ten-column blocks across row 1: A's second entry is Druid
  // while the second block is Sorcerer. Indexing blocks by that order would
  // hand 32 of the 34 classes another class's table, so a couple of rows are
  // pinned here against numbers read straight off the sheet.
  check('Cleric CL20 slots per day are the table\'s own row',
    castingTable('Cleric').perDay[19], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
  check('Druid did not get the Sorcerer block',
    castingTable('Druid').perDay[19], castingTable('Druid').perDay[19].map(() => 4));
  check('Occultist stops at 6th like a six-level caster',
    castingTable('Occultist').perDay[19], [null, 5, 5, 5, 5, 5, 5, null, null, null]);

  // Only two classes carry the third table -- the domain slots a cleric's
  // formula asked for, which the sheet showed by gluing " +1" onto the count.
  check('Cleric carries domain slots', castingTable('Cleric').bonus[19],
    [null, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  check('Wizard carries none', castingTable('Wizard').bonus, null);

  // The table lists a domain slot at all nine levels, but one at a level the
  // cleric cannot reach is not a slot he could ever fill.
  {
    const c = new Character(load('nico'));
    c.listAdd('vancian.classes', {
      name: 'Cleric', slotType: 'Cleric', stat: 'Wis', stat2: '',
      prep: 'prepared', source: 'divine', casterLevelOverride: 20, concentration: 0,
      spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
    });
    const v = c.data.vancian.classes[0];
    const unreachable = v.spells.filter((s) => s.slots === null && !s.atWill);
    check('a cleric whose stat stops short shows no slots there',
      unreachable.length > 0, true);
    check('and no domain slot beside them',
      unreachable.map((s) => s.classBonus), unreachable.map(() => null));
    check('the levels he does reach keep theirs',
      v.spells.filter((s) => s.level >= 1 && s.slots !== null).every((s) => s.classBonus === 1), true);
  }

  // Both were appended to the tab without widening the named range the sheet's
  // own HLOOKUP went through, so on the sheet they had full tables that nothing
  // could reach.
  for (const name of ['Legendary Sorceror', 'Pale Theologian']) {
    check(`${name} is reachable here`, !!castingTable(name)?.perDay, true);
  }
}

console.log('vancian -- slots per day come back from the table, the stat and the gate');
{
  /** Raise an ability to an exact score through the build's untyped column. */
  const setScore = (c, ability, target) => {
    const untyped = Number(c.data.statsBuild?.[ability]?.untyped) || 0;
    c.set(`statsBuild.${ability}.untyped`,
      untyped + (target - (Number(c.data.abilities[ability].tempScore) || 0)));
    c.recompute();
    return c.data.abilities[ability].totalMod;
  };
  const add = (c, fields) => {
    c.listAdd('vancian.classes', {
      name: '', slotType: '', stat: '', stat2: '', prep: '', source: '',
      casterLevelOverride: 0, concentration: 0,
      spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
      ...fields,
    });
    return c.data.vancian.classes[c.data.vancian.classes.length - 1];
  };
  const slots = (v) => v.spells.map((s) => (s.atWill ? '∞' : (s.slots === null ? '—' : s.slots)));
  const known = (v) => v.spells.map((s) => (s.knownCount === null ? '—' : s.knownCount));

  // A wizard with Int 54 off one of the sheets that arrived with this filled
  // in. Every number is the sheet's, bar 0th -- see below.
  {
    const c = new Character(load('nico'));
    check('Int 54 is a +22 modifier', setScore(c, 'int', 54), 22);
    const v = add(c, {
      name: 'Wizard', slotType: 'Wizard', stat: 'Int',
      prep: 'prepared', source: 'arcane', casterLevelOverride: 20,
    });
    check('a prepared wizard at CL20 with +22',
      slots(v), [4, 10, 10, 9, 9, 9, 9, 8, 8, 8]);
    // A spellbook is not slot-derived, so the column means nothing for them --
    // and that is what makes 0th fall through to the table's four prepared
    // cantrips rather than the unlimited the older template showed.
    check('a prepared caster has no spells-known column', known(v), Array(10).fill('—'));

    const o = add(c, {
      name: 'Occultist', slotType: 'Occultist', stat: 'Int',
      prep: 'spontaneous', source: 'occult', casterLevelOverride: 20,
    });
    check('a spontaneous occultist at CL20 with +22',
      slots(o), ['—', 11, 11, 10, 10, 10, 10, '—', '—', '—']);
    check('and its known list comes from the table',
      known(o), ['—', 5, 5, 5, 5, 5, 5, '—', '—', '—']);
  }

  // An oracle at caster level 4 with Cha 21.
  {
    const c = new Character(load('nico'));
    check('Cha 21 is a +5 modifier', setScore(c, 'cha', 21), 5);
    const v = add(c, {
      name: 'Oracle', slotType: 'Oracle', stat: 'Cha',
      prep: 'spontaneous', source: 'divine', casterLevelOverride: 4,
    });
    check('a spontaneous oracle at CL4 with +5', slots(v), ['∞', 8, 4, '—', '—', '—', '—', '—', '—', '—']);
    check('its orisons are at will', v.spells[0].atWill, true);
    check('known is the table verbatim, with no ability bonus',
      known(v), [6, 3, 1, '—', '—', '—', '—', '—', '—', '—']);
    check('bonus slots are separated from the base',
      [v.spells[1].base, v.spells[1].abilityBonus], [6, 2]);

    // The score gates the level: 10 + the spell level to cast there at all.
    const low = add(c, {
      name: 'Oracle', slotType: 'Oracle', stat: 'Str',
      prep: 'spontaneous', source: 'divine', casterLevelOverride: 4,
    });
    check('a stat too low to reach 1st level casts nothing there',
      low.spells[1].slots, null);
  }
}

console.log('vancian -- a typo in a class name costs nothing');
{
  // The sheet joined a block to the Planner by an exact string match, so one
  // mistyped character zeroed the entire block in silence. Both sides of that
  // join now forgive a slip.
  check('a substitution', closestName(';egendary druid', ['legendary druid', 'psion']), 'legendary druid');
  check('a transposition', closestName('Oracel', castingTableNames()), 'Oracle');
  check('a dropped letter', closestName('Wizrd', castingTableNames()), 'Wizard');
  check('case and spacing never count', closestName('  occULTist ', castingTableNames()), 'Occultist');
  // The table's own spelling wins, misspelling included.
  check('and it corrects toward the table', closestName('Legendary Sorcerer', castingTableNames()),
    'Legendary Sorceror');

  // Guessing wrong is worse than not guessing: a real class that simply is not
  // in the table must not be silently bent into one that is.
  check('a class the table has never heard of stays unmatched',
    closestName('Bear Whisperer', castingTableNames()), '');
  check('and an ambiguous name is refused rather than picked',
    closestName('Legendary Wizard (Mage', ['Legendary Wizard (Mage)', 'Legendary Wizard (Mag)']), '');

  const c = new Character(load('nico'));
  c.listAdd('vancian.classes', {
    name: 'Oracle', slotType: 'Oracel', stat: 'Cha', stat2: '',
    prep: 'spontaneous', source: 'divine', casterLevelOverride: 4, concentration: 0,
    spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
  });
  const v = c.data.vancian.classes[0];
  check('a misspelled slot type still finds its table', v.tableName, 'Oracle');
  check('and is not flagged as unknown', v.slotTypeUnknown, false);

  c.setItem('vancian.classes', 0, 'slotType', 'Bear Whisperer');
  const off = c.data.vancian.classes[0];
  check('a class off the table is flagged rather than zeroed quietly',
    [off.tableName, off.slotTypeUnknown], ['', true]);
  check('and the block is listed in the calc', c.data.vancian.calc.unknownSlotTypes,
    ['Bear Whisperer']);
}

console.log('vancian -- slots are spent at the table and come back with the day');
{
  const c = new Character(load('nico'));
  // High enough to clear the 10 + spell level gate at the levels used below.
  c.set('statsBuild.cha.untyped',
    (Number(c.data.statsBuild.cha.untyped) || 0) + (21 - c.data.abilities.cha.tempScore));
  c.listAdd('vancian.classes', {
    name: 'Oracle', slotType: 'Oracle', stat: 'Cha', stat2: '',
    prep: 'spontaneous', source: 'divine', casterLevelOverride: 8, concentration: 0,
    spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
  });
  const at = (lvl) => c.data.vancian.classes[0].spells[lvl];
  const slots1 = at(1).slots;
  check('the level has slots to spend', slots1 > 0, true);
  check('and none are spent yet', [at(1).used, at(1).left], [0, slots1]);

  c.setItem('vancian.classes.0.spells', 1, 'used', 2);
  check('spending two leaves two fewer', [at(1).used, at(1).left], [2, slots1 - 2]);
  check('the class total counts what is left',
    c.data.vancian.classes[0].totalLeft, c.data.vancian.classes[0].totalPerDay - 2);
  check('and the block reports what was spent', c.data.vancian.calc.spent, 2);

  // Cantrips are at will, so there is nothing there to spend.
  check('at-will levels have no pool', [at(0).atWill, at(0).left], [true, null]);

  // Overspending, or a level that shrinks under it, must not leave a negative.
  c.setItem('vancian.classes.0.spells', 1, 'used', 999);
  check('spending more than exists clamps to the pool',
    [at(1).used, at(1).left], [slots1, 0]);

  // Pinning the caster level low takes the higher spell levels away entirely, and
  // whatever was spent out of them has to go with them.
  c.setItem('vancian.classes.0.spells', 2, 'used', 1);
  check('a 2nd-level slot was spent', at(2).used, 1);
  c.setItem('vancian.classes', 0, 'casterLevelOverride', 1);
  check('an oracle pinned to CL1 has no 2nd-level slots', at(2).slots, null);
  check('and the spend goes with them', [at(2).used, at(2).left], [0, 0]);

  c.setItem('vancian.classes', 0, 'casterLevelOverride', 8);
  c.setItem('vancian.classes.0.spells', 2, 'used', 1);
  c.vancianNewDay();
  check('a new day restores everything', c.data.vancian.calc.spent, 0);

  // Play state is the player's, so unlike the derived numbers it is saved.
  c.setItem('vancian.classes.0.spells', 1, 'used', 1);
  const saved = c.toJSON();
  check('used survives a save', saved.vancian.classes[0].spells[1].used, 1);
  check('but the subtraction does not', 'left' in saved.vancian.classes[0].spells[1], false);
  check('and it comes back on reload',
    new Character(saved).data.vancian.classes[0].spells[1].left, at(1).slots - 1);
}

console.log('vancian -- a prepared caster spends per spell, not per level');
{
  const c = new Character(load('nico'));
  c.listAdd('vancian.prepared', { prepUsed: 'Mystery Spells', classLevel: '', name: '' });
  c.listAdd('vancian.prepared', { prepUsed: '', classLevel: '2', name: 'Cure Light Wounds', uses: 3, used: 0 });
  const row = () => c.data.vancian.prepared[1];
  check('three uses committed', [row().uses, row().used, row().left], [3, 0, 3]);

  c.setItem('vancian.prepared', 1, 'used', 1);
  check('casting it once leaves two', row().left, 2);
  check('the block counts it as spent', c.data.vancian.calc.spent, 1);

  c.setItem('vancian.prepared', 1, 'used', 9);
  check('it cannot be cast more times than prepared', [row().used, row().left], [3, 0]);
  c.setItem('vancian.prepared', 1, 'uses', 1);
  check('and preparing fewer drops the spend to match', [row().used, row().left], [1, 0]);

  // A heading the player typed is not a spell and gets no pool.
  check('a section heading has nothing to spend',
    [c.data.vancian.prepared[0].uses, c.data.vancian.prepared[0].left], [0, 0]);

  c.vancianNewDay();
  check('a new day restores prepared uses too', row().left, 1);
  check('left is not saved on the list either',
    'left' in c.toJSON().vancian.prepared[1], false);
}

console.log('vancian -- casting types is two cells, not one');
{
  const c = new Character(load('nico'));
  // Alchemy renames what the block makes; the other three leave it a spell.
  for (const [source, many] of [['alchemy', 'Extracts'], ['arcane', 'Spells'],
    ['divine', 'Spells'], ['occult', 'Spells']]) {
    c.listAdd('vancian.classes', {
      name: 'X', slotType: 'Alchemist', stat: 'Int', stat2: '',
      prep: 'hybrid', source, casterLevelOverride: 10, concentration: 0,
      spells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, perDay: null, known: null })),
    });
    const v = c.data.vancian.classes[c.data.vancian.classes.length - 1];
    check(`${source} calls them ${many}`, v.noun.many, many);
  }

  // A hybrid picks a fresh list each day and then spends a pool against it, so
  // it has a list where a prepared caster does not.
  const hybrid = c.data.vancian.classes[0];
  check('a hybrid has a list', hybrid.spells[1].knownCount !== null, true);
}

console.log('primordia -- the ladder comes off the Planner column the import used to drop');
{
  // The template names that column "Armored Discipline Technique" whatever
  // technique the character took, and parks the technique's own name on the
  // level 2 row -- a level the ladder does not grant at, which is what tells
  // the two apart. Bryva is the only sheet that filled the rest in.
  const b = new Character(load('bryva'));
  check('bryva keeps every level she wrote', b.data.primordia.picks, {
    1: 'Endurance, Armor Adept',
    3: 'Armor Trick',
    5: 'Heavy Armor Focus',
    7: 'Medium Armor Focus',
    9: 'Armored Casting',
    13: 'Dodge',
  });
  check('and the level 2 label is not one of them', 2 in b.data.primordia.picks, false);

  for (const id of IDS) {
    const c = new Character(load(id));
    const levels = c.data.primordia.calc.rows.map((r) => r.level);
    check(`${id} grants at 1/3/5 then every other level`, levels,
      [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
    check(`${id} writes nothing outside those levels`,
      Object.keys(c.data.primordia.picks).every((l) => levels.includes(Number(l))), true);
  }
}

console.log('blended training -- one class, one pool, two progressions');
{
  // Angou's Legendary Monk and Bryva's Blacksmith are written on both tabs
  // holding the same talents twice. They are one class with one pool.
  const a = new Character(load('angou'));
  const pairs = a.blendedClasses();
  check('angou has one blended class', pairs.map((p) => p.name), ['Legendary Monk']);
  check('owned by the combat block, mirrored on the magic one',
    [pairs[0].owner.side, pairs[0].twin.side], ['combat', 'magic']);
  check('and the mirror is pointed at the same rows',
    pairs[0].twin.cls.levels === pairs[0].owner.cls.levels, true);
  check('each half keeps its own progression',
    [pairs[0].owner.cls.type, pairs[0].twin.cls.type], ['Expert', 'High']);

  // The point of it: each talent is counted once, on the side its sphere
  // belongs to, instead of all twenty landing in both tallies.
  const combat = a.data.training.combat.tally;
  const magic = a.data.training.magic.tally;
  check('martial talents count martially', [combat.Tech, combat.Boxing, combat.Berserker], [5, 3, 2]);
  check('and not magically', [magic.Tech, magic.Boxing, magic.Berserker],
    [undefined, undefined, undefined]);
  check('magical ones count magically', [magic.Nature, magic.Veilweaving, magic.Dark], [4, 3, 3]);
  check('and not martially', [combat.Nature, combat.Veilweaving, combat.Dark],
    [undefined, undefined, undefined]);
  check('and no sphere is counted on both sides',
    Object.keys(combat).filter((s) => magic[s]), []);
  check('every talent lands somewhere exactly once',
    Object.values(combat).reduce((n, x) => n + x, 0)
      + Object.values(magic).reduce((n, x) => n + x, 0),
    // The blended pool's 20, ten Athletics from Light Body, five combat and two
    // magic bonus talents, and three of the martial tradition's four (one has
    // no sphere). Before, the pool's twenty were counted twice.
    20 + 10 + 5 + 2 + 3);

  // None of the per-side numbers move: they are still computed off the block
  // sitting on that side, which is why the pair is kept rather than merged.
  check('caster level unmoved', a.data.training.magic.globalCL, 20);
  check('spell points unmoved', a.data.training.magic.totalSP, 83);
  check('practitioner DC unmoved', a.data.training.combat.practitionerDC, 36);
  check('bryva too', [new Character(load('bryva')).blendedClasses().map((p) => p.name)],
    [['Blacksmith']]);

  // Blending and splitting from the class head.
  const n = new Character(load('nico'));
  check('nico has none', n.blendedClasses().length, 0);
  n.setBlended('magic', 0, true);
  check('blending the Hedgewitch gives it a martial block too',
    (n.data.training.combat.classes || []).map((x) => x.name), ['Hedgewitch']);
  check('and one blended group', n.blendedClasses().map((p) => p.name), ['Hedgewitch']);
  check('sharing the one pool of talents',
    n.data.training.combat.classes[0].levels === n.data.training.magic.classes[0].levels, true);
  n.setBlended('magic', 0, false);
  check('splitting drops the block it added', (n.data.training.combat.classes || []).length, 0);
  check('and the talents stay where they were',
    (n.data.training.magic.classes[0].levels || []).filter((l) => l.talent).length, 9);
  check('two blocks kept apart are not re-paired', n.blendedClasses().length, 0);
}

console.log('tradition boons -- one pool of steps, split between points and essence');
{
  // Every effective drawback is a boon, and they are one pool on one ladder:
  // step n is worth what it adds to the n-1 below it, and the ladder tops out
  // at five, so a sixth step adds nothing.
  const c = new Character(load('angou'));
  const m = () => c.data.training.magic;
  check('six effective drawbacks are six boons', [m().effectiveDrawbacks, m().boons], [6, 6]);
  check('worth the ladder, which caps at five steps', m().boonPoints, 20);
  check('split by default the way the sheets were written -- the ones past the '
    + 'fifth as points, the rest as essence',
  m().traditionPools.map((p) => [p.label, p.spSteps, p.sp, p.essenceSteps, p.essence]),
  [['Boons 6', 1, 12, 5, 16]]);
  check("which is the 12 tradition SP his sheet cached, and its total",
    [m().traditionSP, m().totalSP, m().sheet.totalSP], [12, 83, 83]);
  // His workbook reads the ladder twice -- 20 as the Akashic tab's Essence Boon
  // *and* 4 x 3 classes as spell points, 32 points from a 20-point ladder. One
  // pool can only read it once, so the essence is 4 short of what he wrote.
  check('the essence reaches the akashic tab',
    [c.data.akashic.calc.traditionBoon, c.data.akashic.calc.sources], [16, 16]);
  check('and the shortfall against his typed pool is flagged, not hidden',
    c.data.akashic.calc.sourcesShort, 16 - c.data.akashic.calc.pool);

  // The split moves a step at a time, and the halves always add back up.
  c.set('training.magic.tradition.boonSP', 6);
  check('all of it as spell points, multiplied per casting class',
    [m().traditionSP, m().traditionEssence], [60, 0]);
  c.set('training.magic.tradition.boonSP', 0);
  check('all of it as essence, unmultiplied', [m().traditionSP, m().traditionEssence], [0, 20]);
  c.set('training.magic.tradition.boonSP', 3);
  const p = () => m().traditionPools[0];
  check('a middling split splits the steps, not the points',
    [p().spSteps, p().essenceSteps], [3, 3]);
  check('and the two halves still come to the ladder',
    p().sp / m().castingClassCount + p().essence, m().boonPoints);
  c.set('training.magic.tradition.boonSP', 1);
  check('restored', [m().totalSP, m().traditionEssence], [83, 16]);

  // Buying a drawback off drops the count for a moment. The split is clamped
  // to what is left, but the number the player wrote survives the dip.
  c.set('training.magic.tradition.boonSP', 5);
  check('five of six as spell points', m().traditionSP, 60);
  c.listAdd('training.magic.tradition.boughtOff', 'Somatic Casting');
  check('buying one off leaves four to split, and clamps to them',
    [m().boons, m().traditionPools[0].spSteps, m().traditionSP], [4, 4, 42]);
  c.listRemove('training.magic.tradition.boughtOff', 1);
  check('and the fifth comes back when the boon does',
    [m().boons, m().traditionPools[0].spSteps, m().traditionSP], [6, 5, 60]);
  c.set('training.magic.tradition.boonSP', 1);

  for (const [id, boons, sp, essence] of [
    ['angou', 6, 12, 16], ['narockro', 6, 2, 9], ['saburo', 8, 5, 4],
    ['nico', 4, 0, 11], ['bryva', 0, 0, 0],
  ]) {
    const x = new Character(load(id)).data.training.magic;
    check(`${id}: ${boons} boons -> ${sp} SP and ${essence} essence`,
      [x.boons, x.traditionSP, x.traditionEssence], [boons, sp, essence]);
  }
}

console.log('primordia -- what a technique has granted so far, counted');
{
  // Light Body: the Athletics sphere at 1st, Wall Stunt at 3rd, Air Stunt at
  // 5th, then one Athletics talent every other level from 7th -- so ten at 20th
  // -- plus Unarmed Combatant.
  const a = new Character(load('angou'));
  const k = () => a.data.primordia.calc.counts;
  check('angou at 20 has ten Athletics talents', k().talent, 10);
  check('and the one bonus feat', k().feat, 1);
  check('they land in the combat tally', a.data.training.combat.tally.Athletics, 10);

  // Levels not yet reached are the plan, and are not counted.
  const s = new Character(load('saburo'));
  check('saburo at 9 has five', s.data.primordia.calc.counts.talent, 5);
  s.set('identity.level', 11);
  check('levelling to 11 grants the next one', s.data.primordia.calc.counts.talent, 6);

  // The magic side gets its own: Keen Mind (Spheres) is Divination talents.
  const n = new Character(load('nico'));
  check('nico at 15 has eight Divination talents', n.data.primordia.calc.counts.talent, 8);
  check('on the magic side', n.data.training.magic.tally.Divination, 8);
  check('and none on the combat side', n.data.training.combat.tally.Divination, undefined);

  // Armored Discipline grants feats and no talents at all.
  const b = new Character(load('bryva'));
  check('bryva at 16 has nine bonus feats', b.data.primordia.calc.counts.feat, 9);
  check('and no sphere talents', b.data.primordia.calc.counts.talent, 0);
  check('so nothing is added to either tally', b.data.primordia.calc.talents, null);
}

console.log('primordia -- a level reached with nothing written against it is owed');
{
  const b = new Character(load('bryva'));
  const due = () => b.data.primordia.calc.rows.filter((r) => r.due).map((r) => r.level);
  check('bryva owes the two she skipped', due(), [11, 15]);
  check('counted on the panel', b.data.primordia.calc.counts.due, 2);
  check('and 17 and 19 are planned, not owed', b.data.primordia.calc.counts.planned, 2);

  b.set('primordia.picks.11', 'Armor Adept');
  check('filling one clears it', due(), [15]);
  b.set('primordia.picks.15', '   ');
  check('whitespace does not count as filled', due(), [15]);

  // A fixed grant is not a choice, so it is never owed -- but still takes a note.
  const fixed = b.data.primordia.calc.rows.find((r) => r.level === 3);
  check('a fixed level offers no pick', fixed.pick, null);
  check('yet keeps what the sheet wrote there', fixed.text, 'Armor Trick');
}

console.log('primordia -- the prerequisite is checked, and says so when it cannot be');
{
  const state = (id) => new Character(load(id)).data.primordia.calc.prereq.state;
  check('angou has a full-BAB class, so Light Body is met', state('angou'), 'met');
  check("nico's Hedgewitch casts at Mid, so Keen Mind is met", state('nico'), 'met');
  // Bryva really does have Armored Discipline; her sheet just never imported an
  // armor proficiency, and a technique she has been using for sixteen levels is
  // not the place to start arguing.
  check('bryva has nothing to check against', state('bryva'), 'unknown');

  const a = new Character(load('angou'));
  a.set('identity.primordiaTechnique', 'Keen Mind (Vancian)');
  check('and vancian casting he does not have reads unmet',
    a.data.primordia.calc.prereq.state, 'unmet');
  a.set('identity.primordiaTechnique', 'Piercing Eye');
  check('psionics is not modelled, so it is unchecked rather than refused',
    a.data.primordia.calc.prereq.state, 'unknown');
}

console.log('primordia -- "if you already possess it" is a branch, not a footnote');
{
  const c = new Character(load('nico'));
  c.set('identity.primordiaTechnique', 'Keen Mind (Vancian)');
  const counts = () => c.data.primordia.calc.counts;
  // Two feats (1st, 3rd) and a spell at 5th, 7th, 9th, 11th, 13th and 15th.
  check('two feats and six spells by 15th', [counts().feat, counts().spell], [2, 6]);

  c.set('primordia.alt.1', true);
  check('already having Spell Focus swaps the feat for a spell rather than adding one',
    [counts().feat, counts().spell], [1, 7]);
  check('and the row says so',
    c.data.primordia.calc.rows[0].grants[0].text,
    'One Divination spell added to your spells known');
}

console.log('primordia -- the choice is one thing, the writing beside it another');
{
  const b = new Character(load('bryva'));
  b.set('identity.primordiaTechnique', 'Light Body');
  check('switching technique changes what the levels grant',
    b.data.primordia.calc.counts.talent, 8);
  check('but keeps every line already written', b.data.primordia.picks[9], 'Armored Casting');
  check('and a technique off the list empties the ladder, not the writing', (() => {
    b.set('identity.primordiaTechnique', 'Bear Style');
    const k = b.data.primordia.calc;
    return [k.technique, k.unknown, k.rows[0].grants.length, b.data.primordia.picks[9]];
  })(), [null, true, 0, 'Armored Casting']);

  const saved = new Character(load('bryva')).toJSON();
  check('a save carries the writing', saved.primordia.picks[13], 'Dodge');
  check('and none of the ladder', 'calc' in saved.primordia, false);
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

console.log('psionics -- the pool is the curve plus half a modifier per level');
{
  const c = new Character(load('nico'));
  c.set('statsBuild.int.untyped',
    (Number(c.data.statsBuild.int.untyped) || 0) + (24 - c.data.abilities.int.tempScore));
  check('Int 24 is a +7 modifier', c.data.abilities.int.totalMod, 7);

  const add = (fields) => {
    c.listAdd('psionics.classes', {
      name: '', stat: '', stat2: '', curveTotal: 0, manifesterLevelOverride: null, powers: [],
      ...fields,
    });
    return c.data.psionics.classes[c.data.psionics.classes.length - 1];
  };

  /*
   * The numbers off the workbook that first showed what this tab was doing: a
   * tactician at manifester level 10 with Int +7 reads 123, and a psion at 1
   * reads 5. Both come out of curve + floor(mod x level / 2).
   */
  const tac = add({
    name: 'Tactician', stat: 'Int', curveTotal: 343, manifesterLevelOverride: 10,
  });
  check('a tactician at ML10 with Int +7',
    [tac.basePoints, tac.abilityPoints, tac.points], [88, 35, 123]);

  const psi = add({ name: 'Psion', stat: 'Int', curveTotal: 343, manifesterLevelOverride: 1 });
  check('a psion at ML1 with the same stat',
    [psi.basePoints, psi.abilityPoints, psi.points], [2, 3, 5]);

  // Every manifesting class feeds one pool, and the bonus line is added to it.
  c.set('psionics.bonusPoints', 53);
  check('the pool is both classes plus the bonus', c.data.psionics.pool, 123 + 5 + 53);
  check('and nothing is spent yet', c.data.psionics.left, 181);

  // A class whose curve is not in the table contributes nothing, and says so
  // rather than quietly reading zero the way the sheet did.
  const odd = add({ name: 'Beast Mind', stat: 'Int', curveTotal: 777, manifesterLevelOverride: 5 });
  check('an unknown curve gives no points', [odd.curveKnown, odd.points], [false, 0]);
  // ...and no ability share either, or the breakdown would advertise points that
  // are not in the pool and invite adding it up by hand to a different answer.
  check('and no ability share to go with them', odd.abilityPoints, 0);
  check('and is reported', c.data.psionics.calc.unknownCurves, [777]);
  c.setItem('psionics.classes', 2, 'curveTotal', 128);
  check('picking a curve it does run on fixes it',
    [c.data.psionics.classes[2].curveKnown, c.data.psionics.classes[2].points > 0], [true, true]);

  // The second ability is floored on its own, the way the sheet's formula adds
  // the two terms -- not as half of their sum.
  c.setItem('psionics.classes', 1, 'stat2', 'Cha');
  const two = c.data.psionics.classes[1];
  const cha = c.data.abilities.cha.totalMod;
  check('two abilities each contribute their own half',
    two.abilityPoints, Math.floor((7 * 1) / 2) + Math.floor((cha * 1) / 2));
}

console.log('psionics -- points are spent out of one pool and come back with the day');
{
  const c = new Character(load('nico'));
  c.listAdd('psionics.classes', {
    name: 'Wilder', stat: 'Cha', stat2: '', curveTotal: 343,
    manifesterLevelOverride: 20, powers: [{ name: 'energy ray', level: '1st' }],
  });
  const p = () => c.data.psionics;
  const pool = p().pool;
  check('a wilder at ML20 draws the full curve', p().classes[0].basePoints, 343);
  check('and the pool is at least that', pool >= 343, true);
  check('its powers are counted', p().classes[0].powerCount, 1);

  c.set('psionics.spent', 40);
  check('spending forty leaves the rest', p().left, pool - 40);
  c.set('psionics.spent', pool + 500);
  check('the pool cannot be overdrawn', [p().spent, p().left], [pool, 0]);

  // A class that shrinks must not leave the pool spent past its size.
  c.setItem('psionics.classes', 0, 'manifesterLevelOverride', 1);
  check('a smaller pool drags the spend down with it', p().spent <= p().pool, true);

  c.psionicsNewDay();
  check('a new day restores the pool', [p().spent, p().left], [0, p().pool]);

  // The pool is readable from a formula, like invested essence is.
  c.setItem('psionics.classes', 0, 'manifesterLevelOverride', 20);
  c.set('psionics.spent', 10);
  check('pp.pool reads from a formula', c.scope().pp.pool, p().pool);
  check('pp.left too', c.scope().pp.left, p().pool - 10);

  // Only what was typed is saved; the panel's own arithmetic is not.
  const saved = c.toJSON();
  check('spent survives a save', saved.psionics.spent, 10);
  check('the pool does not', 'pool' in saved.psionics, false);
  check('nor does a class\'s point total', 'points' in saved.psionics.classes[0], false);
  check('and it all comes back on reload', new Character(saved).data.psionics.left, p().left);
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

console.log('conditions -- the template\'s stray Helpless + Paralyzed is cleared, a real one is kept');
{
  const c = new Character(load('bryva'));
  check('the workbook fingerprint clears', Object.values(c.data.conditions).some(Boolean), false);
  const raw = load('bryva');
  raw.conditions.Helpless = 1;
  raw.conditions.Paralyzed = 1;
  raw.conditions.Shaken = 1;
  const kept = new Character(raw);
  check('but three ticked is state, not template', kept.conditionState.active.length, 3);
  const flag = load('nico');
  flag.conditions.Blinded = true;
  check('a boolean import becomes 1', new Character(flag).data.conditions.Blinded, 1);
  const bare = load('nico');
  delete bare.conditions;
  check('a document with none gets the standard eighteen', Object.keys(new Character(bare).data.conditions).length, 18);
}

console.log('conditions -- what is ticked moves the numbers beside the base, never the base');
{
  const c = new Character(load('angou'));
  const before = { ac: c.data.defenses.ac, melee: c.data.attack.totalMelee, fort: c.data.saves.fortitude.total, ref: c.data.saves.reflex.total };
  check('nothing on, nothing changed', c.conditionState.changed, false);

  c.set('conditions.Shaken', 1);
  let s = c.conditionState;
  check('the base AC is untouched', c.data.defenses.ac, before.ac);
  check('the base melee is untouched', c.data.attack.totalMelee, before.melee);
  check('shaken is −2 to attack', s.delta.melee, -2);
  check('and −2 to saves', s.delta.fortitude, -2);
  check('but nothing to AC', s.delta.ac, 0);
  check('the adjusted melee is base − 2', s.adjusted.melee, before.melee - 2);

  c.set('conditions.Frightened', 1);
  s = c.conditionState;
  check('frightened supersedes shaken', s.superseded.map((x) => x.name), ['Shaken']);
  check('so the fear penalty is still −2, not −4', s.delta.melee, -2);
  check('shaken still shows as on', s.active.length, 2);

  c.set('conditions.Shaken', 0);
  c.set('conditions.Frightened', 0);
  c.set('conditions.Sickened', 1);
  c.set('conditions.Energy Drain', 3);
  s = c.conditionState;
  check('sickened and three negative levels stack: −2 −3 to attack', s.delta.melee, -5);
  check('and to saves', s.delta.will, -5);
  check('negative levels take 5 hp each', s.delta.hp, -15);
  check('sickened is −2 on damage', s.delta.damage, -2);
  check('adjusted hp never goes negative', new Character({ ...load('saburo'), conditions: { 'Energy Drain': 99 } }).conditionState.adjusted.hp >= 0, true);

  c.set('conditions.Energy Drain', 0);
  c.set('conditions.Sickened', 0);
  c.set('conditions.Entangled', 1);
  s = c.conditionState;
  const dexBefore = c.data.abilities.dex.totalMod;
  const dexAfter = abilityMod(c.data.abilities.dex.tempScore - 4);
  check('entangled is −4 Dex', s.scores.dex, c.data.abilities.dex.tempScore - 4);
  check('which moves the Dex modifier', s.deltas.dex, dexAfter - dexBefore);
  check('and Reflex with it, plus nothing else', s.delta.reflex, dexAfter - dexBefore);
  check('and initiative', s.delta.initiative, dexAfter - dexBefore);
  check('and −2 to attack on top', s.delta.ranged, -2 + (c.data.attack.modes.ranged.stat1?.toLowerCase().startsWith('dex') ? dexAfter - dexBefore : 0));
  check('speed halves', s.speed, 0.5);
  check('to a 5 ft. step', s.speeds[0].adjusted, Math.floor((s.speeds[0].final / 2) / 5) * 5);

  c.set('conditions.Entangled', 0);
  c.set('conditions.Paralyzed', 1);
  s = c.conditionState;
  check('paralysed sets Dex to 0', s.scores.dex, 0);
  check('and Str to 0', s.scores.str, 0);
  check('so the Dex modifier is −5', s.deltas.dex, -5 - c.data.abilities.dex.totalMod);
  check('CMD loses the Dex bonus and takes the penalty', s.delta.cmd, -5 - c.data.abilities.dex.totalMod);
  check('melee attacks against it gain +4', s.acVsMelee, -4);
  check('it cannot move', s.speeds.every((sp) => sp.adjusted === 0), true);
  c.set('conditions.Helpless', 1);
  s = c.conditionState;
  check('helpless on top is superseded, not doubled', s.acVsMelee, -4);

  c.set('conditions.Paralyzed', 0);
  c.set('conditions.Helpless', 0);
  c.set('conditions.Blinded', 1);
  s = c.conditionState;
  const acDex = Math.min(armorParts(c.data).maxDex, statMod(c.data, c.data.defenses.acStat1, c.data.defenses.acStat2));
  check('blinded is −2 AC and loses the ability bonus to AC', s.delta.ac, -2 - Math.max(0, acDex));
  check('touch the same', s.delta.touch, -2 - Math.max(0, acDex));
  check('flat-footed had no ability bonus to lose', s.delta.flatFooted, c.data.defenses.uncannyDodge ? -2 - Math.max(0, acDex) : -2);
  check('CMD loses Dex', s.delta.cmd, -Math.max(0, c.data.abilities.dex.totalMod));

  check('a condition added by name from the catalogue is available', c.availableConditions().some((x) => x.key === 'nauseated'), true);
  check('one the sheet has is not', c.availableConditions().some((x) => x.key === 'blinded'), false);
}

console.log('speeds -- the bonus may be a rule, and the final follows it');
{
  const c = new Character(load('angou'));
  const land = c.data.identity.speeds[0];
  check('imported: base plus bonus', land.final, land.base + land.bonus);
  c.setItem('identity.speeds', 0, 'bonus', 'floor(level / 3) * 10');
  check('a formula resolves against the level', c.data.identity.speeds[0].bonusNum, Math.floor(20 / 3) * 10);
  check('and the final follows', c.data.identity.speeds[0].final, land.base + 60);
  check('with no error', c.data.identity.speeds[0].bonusError, null);
  check('and it shows in the audit', c.audit().some((r) => r.id === 'speed-0' && r.status === 'ok' && r.value === 60), true);
  c.set('identity.level', 12);
  check('level up or down and it moves', c.data.identity.speeds[0].final, land.base + 40);
  c.setItem('identity.speeds', 0, 'bonus', 'nonsense(');
  check('a broken formula is flagged', typeof c.data.identity.speeds[0].bonusError, 'string');
  check('and counts as zero', c.data.identity.speeds[0].final, land.base);
  check('and the audit says so', c.audit().find((r) => r.id === 'speed-0')?.status, 'error');
  c.setItem('identity.speeds', 0, 'bonus', 10);
  check('a plain number is a number', c.data.identity.speeds[0].final, land.base + 10);
  const saved = JSON.parse(JSON.stringify(c.toJSON()));
  check('the formula source round-trips as written', (() => { c.setItem('identity.speeds', 0, 'bonus', 'level'); return JSON.parse(JSON.stringify(c.toJSON())).identity.speeds[0].bonus; })(), 'level');
  check('and the reload resolves it again', new Character(JSON.parse(JSON.stringify(c.toJSON()))).data.identity.speeds[0].final, land.base + 12);
  void saved;
}

console.log('race traits -- the workbook\'s sentences become name and effect, and stay editable');
{
  const c = new Character(load('bryva'));
  const rt = c.data.raceTraits;
  check('four for a tiefling', rt.length, 4);
  check('the name is split off at the colon', rt[3].name, 'Darkvision');
  check('and the effect is the rest', rt[3].text.startsWith('Tieflings can see'), true);
  const shape = new Character({ ...load('nico'), raceTraits: ['Just a sentence with no name in it. Really.', { name: 'Keen', text: 'Sharp' }, '', 'Long lead-in that runs on and on and on and on and on: nope'] });
  check('a sentence with no name keeps whole as the effect', shape.data.raceTraits[0], { name: '', text: 'Just a sentence with no name in it. Really.' });
  check('an object is kept', shape.data.raceTraits[1], { name: 'Keen', text: 'Sharp' });
  check('an empty one is dropped', shape.data.raceTraits.length, 3);
  check('a colon too far in is not a name', shape.data.raceTraits[2].name, '');
  c.listAdd('raceTraits', { name: 'Prehensile Tail', text: 'Retrieve small stowed objects as a swift action.' });
  check('one can be added', c.data.raceTraits.length, 5);
  check('and it saves as objects', JSON.parse(JSON.stringify(c.toJSON())).raceTraits[4].name, 'Prehensile Tail');
  check('a character with none has an empty list, not nothing', new Character({ ...load('angou'), raceTraits: undefined }).data.raceTraits, []);
}

console.log('languages -- slots from Int and Linguistics, plus a rule; the list against them');
{
  const c = new Character(load('saburo'));
  const sl = c.data.identity.languageSlots;
  check('one slot per point of Int bonus', sl.int, c.data.abilities.int.totalMod);
  check('one per Linguistics rank', sl.linguistics, 9);
  check('the total is their sum', sl.total, sl.int + sl.linguistics);
  check('the workbook cells are split into a list', c.data.identity.languages.includes('Undercommon'), true);
  check('with duplicates dropped', new Set(c.data.identity.languages.map((l) => l.toLowerCase())).size, c.data.identity.languages.length);
  check('and native kept apart', c.data.identity.nativeLanguages, 'Common');
  c.set('identity.languageExtra', 'floor(level / 3)');
  check('extra as a formula resolves', c.data.identity.languageSlots.extra, 3);
  check('and joins the total', c.data.identity.languageSlots.total, sl.int + sl.linguistics + 3);
  check('and is audited', c.audit().find((r) => r.id === 'languages-extra')?.status, 'ok');
  c.set('identity.languageExtra', 2);
  check('or a number', c.data.identity.languageSlots.extra, 2);
  c.listAdd('identity.languages', 'Tengu');
  check('a language added counts as known', c.data.identity.languageSlots.known, 15);
  const dumb = new Character({ ...load('bryva'), statsBuild: null });
  dumb.set('abilities.int.tempScore', 6);
  check('a negative Int bonus grants nothing, not a debt', dumb.data.identity.languageSlots.int, 0);
  const messy = new Character({ ...load('nico'), identity: { ...load('nico').identity, languages: undefined } });
  check('the pipe-separated cells still split', messy.data.identity.languages.includes('Ignan'), true);
  check('and what does not parse is kept as a row to tidy', messy.data.identity.languages.includes('+9 languages'), true);
}

console.log('proficiencies -- the workbook sentences become lists the sheet can read');
{
  const sab = new Character(load('saburo')).data.identity.proficiencies;
  check('"all simple and …" is the simple familiarity', sab.familiarities, ['Simple']);
  check('and the rest of the sentence is the weapons, one by one',
    sab.weapons.slice(0, 3).concat(sab.weapons.slice(-1)), ['double-chained kama', 'double walking stick katana', 'dual blade', 'wakizashi']);
  check('"double" in a weapon name is not the Double group', sab.groups, []);
  check('nothing on armor is an empty list, not a note', [sab.armor, sab.notes], [[], '']);

  const nar = new Character(load('narockro')).data.identity.proficiencies;
  check('"light and medium armor" is the two weights', nar.armor, ['Light', 'Medium']);
  check('"none" on shields is None', nar.shields, ['None']);
  check('an instrument in parentheses stays one entry', nar.weapons[0], 'instruments (as the rockstar gonzo class)');
  check('the trailing "and whip" is a weapon', nar.weapons.at(-1), 'whip');

  const nico = new Character(load('nico')).data.identity.proficiencies;
  check('"simple and martial weapons" is two familiarities and no weapons', [nico.familiarities, nico.weapons], [['Simple', 'Martial'], []]);
  check('a document with all three null starts blank', new Character(load('bryva')).data.identity.proficiencies,
    { familiarities: [], handedness: [], groups: [], weapons: [], armor: [], shields: [], notes: '' });

  const barb = parseProficiencyText({
    weapons: 'all simple and martial weapons, light armor, medium armor, and shields (except tower shields)',
    armor: 'light armor, medium armor', shield: 'shields (except tower shields)',
  });
  check('a bare "shields" is the three Shield Proficiency covers', barb.shields, ['Buckler', 'Light', 'Heavy']);
  check('and "except tower" keeps tower off', barb.shields.includes('Tower'), false);
  const sam = parseProficiencyText({ weapons: 'all simple and martial weapons, plus the tetsubo and all one-handed slashing weapons' });
  check('a qualified handedness is not the handedness chip', sam.handedness, []);
  check('but stays whole as a weapon entry, with the tetsubo', sam.weapons, ['tetsubo', 'one-handed slashing weapons']);
  const grp = parseProficiencyText({ weapons: 'all light weapons, the heavy blades group and all bows', armor: 'all armor', shield: 'bucklers and tower shields' });
  check('"all light weapons" is the Light handedness', grp.handedness, ['Light']);
  check('groups need "group" or "all" in front', grp.groups, ['Bows', 'Heavy Blades']);
  check('"all armor" is the three weights', grp.armor, ['Light', 'Medium', 'Heavy']);
  check('bucklers and tower shields, named', grp.shields, ['Buckler', 'Tower']);
  const odd = parseProficiencyText({ armor: 'whatever the GM allows', shield: 'see notes' });
  check('what the lists cannot say is kept as a note', odd.notes, 'Armor: whatever the GM allows\nShields: see notes');

  check('lists already saved are tidied, not reparsed',
    normalizeProficiencies({ familiarities: ['simple', 'Simple', 'bogus'], weapons: ['Katana', ''], shields: ['tower'], notes: 'x' }),
    { familiarities: ['Simple'], handedness: [], groups: [], weapons: ['Katana'], armor: [], shields: ['Tower'], notes: 'x' });

  const c = new Character(load('narockro'));
  c.toggleProficiency('shields', 'Buckler');
  check('ticking a shield kind clears None', c.data.identity.proficiencies.shields, ['Buckler']);
  c.toggleProficiency('shields', 'Heavy');
  c.toggleProficiency('shields', 'None');
  check('and None clears the kinds', c.data.identity.proficiencies.shields, ['None']);
  c.toggleProficiency('familiarities', 'Martial');
  c.toggleProficiency('groups', 'Axes');
  check('a familiarity and a group tick on', [c.data.identity.proficiencies.familiarities, c.data.identity.proficiencies.groups], [['Simple', 'Martial'], ['Axes']]);
  c.toggleProficiency('familiarities', 'Martial');
  check('and off again', c.data.identity.proficiencies.familiarities, ['Simple']);
  c.toggleProficiency('groups', 'Not A Group');
  check('an unknown value is refused', c.data.identity.proficiencies.groups, ['Axes']);
  check('the lists save as lists', JSON.parse(JSON.stringify(c.toJSON())).identity.proficiencies.groups, ['Axes']);
  c.set('identity.primordiaTechnique', 'Armored Discipline');
  check('and the primordia armor check reads the list', c.data.primordia.calc.prereq.state, 'met');
  c.toggleProficiency('armor', 'Medium');
  check('and turns unmet with only light armor', c.data.primordia.calc.prereq.state, 'unmet');
  c.toggleProficiency('armor', 'Light');
  check('and unknown with none recorded', c.data.primordia.calc.prereq.state, 'unknown');
}

console.log('proficiencies -- a weapon on Gear is read against them');
{
  const prof = { familiarities: ['Simple'], handedness: [], groups: ['Axes'], weapons: ['guitar axe', 'katana', 'Brand'], armor: [], shields: [], notes: '' };
  const wp = (w, p = prof) => weaponProficient(p, w).state;
  check('a matching familiarity is proficient', wp({ name: 'Club', familiarity: 'Simple' }), true);
  check('a matching group is', wp({ name: 'Battleaxe', familiarity: 'Martial', groups: ['Axes'] }), true);
  check('a named weapon is, whatever its category', wp({ name: 'Guitar Axe +1', familiarity: 'Exotic' }), true);
  check('a specific entry also covers a group the fixed list does not know', wp({ name: 'Bloodvine Embrace', familiarity: 'Exotic', groups: ['Brand'] }), true);
  check('a described weapon nothing covers is not', wp({ name: 'Longsword', familiarity: 'Martial', groups: ['Heavy Blades'] }), false);
  check('handedness alone is not enough to refuse', wp({ name: 'Mic & Cord', handedness: 'Two-Handed' }), null);
  check('nor a row with no category', wp({ name: 'Thing' }), null);
  check('and nothing recorded judges nothing', wp({ name: 'Longsword', familiarity: 'Martial' }, { familiarities: [], groups: [], weapons: [], notes: '' }), null);
  // The base weapon: a named blade that is a katana.
  check('"As" reads against the specific list', wp({ name: 'Enpitsu to Keshi', familiarity: 'Exotic', baseWeapon: 'katana' }), true);
  check('and a base weapon nothing covers refuses on its own', wp({ name: 'Thing', baseWeapon: 'nodachi' }), false);
  check('and says why', weaponProficient(prof, { name: 'Enpitsu to Keshi', baseWeapon: 'Katana' }).why, 'katana on the Overview');
  // The [Enhanced] veil rule: a veilweaver is always proficient with what a veil creates.
  const veil = weaponProficient(prof, { name: 'Bloodburst Blade', familiarity: 'Exotic', groups: ['Veil', 'Heavy Blades'] });
  check('a weapon in the Veil group is proficient by the [Enhanced] rule', [veil.state, veil.source], [true, 'veil']);
  check('and so is one that names [Enhanced], with no list consulted', weaponProficient(null, { name: 'Sword [Enhanced (longsword)]', familiarity: 'Martial' }).state, true);
  // The row's own field beats everything.
  const yes = weaponProficient(prof, { name: 'Falcata', familiarity: 'Exotic', proficiency: 'yes', proficiencyNote: 'Custom Training' });
  check('Yes on the row is proficient, via its note', [yes.state, yes.source, yes.why], [true, 'override', 'proficient via Custom Training']);
  check('No on the row refuses even a veil weapon', weaponProficient(prof, { name: 'Brand', groups: ['Veil'], proficiency: 'no' }).state, false);
  const nar = new Character(load('narockro'));
  check("narockro's guitar axe is martial and unlisted, so it is flagged", nar.data.equipment.weapons[0].proficient, false);
  nar.listAdd('identity.proficiencies.weapons', 'guitar axe');
  check('until it is written in', nar.data.equipment.weapons[0].proficient, true);
  check("bryva's sheet recorded nothing, so her weapons are not judged", new Character(load('bryva')).data.equipment.weapons.every((w) => w.proficient === null), true);
  const sab = new Character(load('saburo'));
  check("saburo's veil blade is proficient by the veil rule, not refused", sab.data.equipment.weapons.map((w) => [w.proficient, w.proficiencySource]), [[true, 'veil'], [true, 'veil'], [true, 'veil']]);
  check('rows carry the three fields, blank', [sab.data.equipment.weapons[0].proficiency, sab.data.equipment.weapons[0].baseWeapon, sab.data.equipment.weapons[0].proficiencyNote], ['', '', '']);
  sab.set('equipment.weapons.0.proficiency', 'no');
  check('and the row can still say No', sab.data.equipment.weapons[0].proficient, false);
  check('which saves', JSON.parse(JSON.stringify(sab.toJSON())).equipment.weapons[0].proficiency, 'no');
}

console.log('specialty -- feat has one home, perks are a list');
{
  const c = new Character(load('bryva'));
  check('the perks are strings', c.data.identity.specialtyPerks, ['Kitchen Magic', 'Neat Freak']);
  check('the feat is the granted one', c.data.grantedFeats.specialty.name, 'Master Chef');
  const guess = load('bryva');
  guess.grantedFeats = { drawback: { name: '', note: '' }, specialty: { name: '', note: '' }, others: [] };
  guess.identity.specialtyFeat = 'Iron Stomach';
  check('the importer\'s guess fills an empty granted feat', new Character(guess).data.grantedFeats.specialty.name, 'Iron Stomach');
  guess.identity.specialtyFeat = 'Specialty Feat';
  check('but not the template\'s placeholder', new Character(guess).data.grantedFeats.specialty.name, '');
}

console.log('conditions -- the temporary score column shows the conditioned score');
{
  const c = new Character(load('saburo'));
  c.set('conditions.Entangled', 1);
  check('entangled: the score is four lower', c.conditionState.scores.dex, c.data.abilities.dex.tempScore - 4);
  check('and the stored temp score is untouched', c.data.abilities.dex.tempScore, load('saburo').abilities.dex.tempScore ?? c.data.abilities.dex.tempScore);
}

console.log('a saved document carries no value the model recomputes');
{
  for (const id of IDS) {
    const c = new Character(load(id));
    const saved = c.toJSON();

    // The DC beside every veil, the count beside every discipline and the DC
    // beside every spell level were what made these tabs heavy on the sheet.
    const veilKeys = [...saved.akashic.slots, ...saved.akashic.kheshig]
      .flatMap((s) => (s.veils || []).flatMap((v) => Object.keys(v)));
    check(`${id} saves no veil DC`, veilKeys.includes('dc'), false);
    check(`${id} saves no akashic calc`, 'calc' in saved.akashic, false);
    check(`${id} saves no computed cap`,
      saved.akashic.classes.some((x) => 'totalCap' in x), false);
    check(`${id} saves no discipline counts`,
      saved.maneuvers.disciplines.some((d) => 'knownManeuvers' in d), false);
    check(`${id} saves no maneuver calc`, 'calc' in saved.maneuvers, false);
    check(`${id} saves no vancian calc`, 'calc' in saved.vancian, false);

    // ...and reloading puts all of it straight back.
    const again = new Character(saved);
    check(`${id} veil DCs survive the round trip`,
      again.data.akashic.slots.flatMap((s) => s.veils.map((v) => v.dc)),
      c.data.akashic.slots.flatMap((s) => s.veils.map((v) => v.dc)));
    check(`${id} maneuver counts survive the round trip`,
      again.data.maneuvers.calc.maneuvers, c.data.maneuvers.calc.maneuvers);
    check(`${id} essence spend survives the round trip`,
      again.data.akashic.calc.used, c.data.akashic.calc.used);
  }
}

console.log('the three tabs weigh a fraction of the grids they replaced');
{
  const size = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
  let raw = 0;
  let modelled = 0;
  for (const id of IDS) {
    const doc = load(id);
    for (const name of ['Akashic', 'Maneuvers', 'Vancian Magic']) {
      const t = doc.extraTabs?.[name];
      if (t) raw += size({ name, hidden: !!t.hidden, rows: t.rows.map((r) => ({ cells: r.cells })) });
    }
    const saved = new Character(doc).toJSON();
    modelled += size(saved.akashic) + size(saved.maneuvers) + size(saved.vancian);
  }
  // 126,336 bytes of grid across the six characters became 31,539.
  check('the modelled blocks are at least 70% smaller', modelled < raw * 0.3, true);
  console.log(`  ${raw.toLocaleString()} b of raw grid -> ${modelled.toLocaleString()} b modelled `
    + `(${Math.round(100 - (100 * modelled) / raw)}% smaller)`);
}
{
  // The other four sheets carry the empty template, which imports as a clean
  // calculator rather than a grid of blank cells.
  for (const id of ['angou', 'nico', 'narockro', 'saburo']) {
    const c = new Character(load(id));
    const cr = c.data.crafting;
    check(`${id} default speed`, cr.calc.speedPerDay, 1000);
    check(`${id} default ratio`, cr.calc.ratio, 0.5);
    check(`${id} nothing left unmodelled`, cr.sourceExtras.length, 0);
    check(`${id} one empty project`, cr.projects.length, 1);
    check(`${id} crafts with a Craft skill`, /^Craft/.test(cr.calc.skill || ''), true);
    check(`${id} check is take 10 + that skill`, cr.calc.checkBase, 10 + cr.calc.skillBonus);
  }
}
{
  // Round trip: the block persists, and a second load does not re-import.
  const c = new Character(load('bryva'));
  c.setItem('crafting.projects', 0, 'name', 'Ring of Flexibility II');
  c.listAdd('crafting.costReductions', { label: 'Cooperative', value: 20, enabled: true });
  const again = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('edits survive a save', again.data.crafting.projects[0].name, 'Ring of Flexibility II');
  check('reductions still compound', again.data.crafting.calc.compounding, 0.9 * 0.8);
  check('and the tab is not re-imported', again.data.crafting.projects.length, 1);
}
{
  // A document with no Item Crafting tab still gets a usable calculator.
  const raw = load('saburo');
  delete raw.extraTabs['Item Crafting'];
  const c = new Character(raw);
  check('crafting exists anyway', c.data.crafting.calc.speedPerDay, 1000);
  check('with the standard base costs', c.data.crafting.baseCosts.length, 3);
  check('and one blank project', c.data.crafting.projects[0].name, '');
}

console.log('importing a document');
{
  // Every converted character must pass the gate the Import button uses.
  for (const id of IDS) {
    const raw = load(id);
    const v = inspectDocument(raw);
    check(`${id} imports`, [v.ok, v.error], [true, null]);
    check(`${id} summary matches the sheet`,
      [v.summary.id, v.summary.name, v.summary.level],
      [raw.id, raw.identity.name, raw.identity.level]);
    check(`${id} summary lists its classes`,
      v.summary.classes, raw.classes.map((c) => c.name).filter(Boolean));
  }
  check('the converter writes the schema the app reads', load('angou').schemaVersion, SCHEMA_VERSION);

  // What the app exports is what the app can import: the round trip that makes
  // Export/Import a pair rather than a one-way door.
  const c = new Character(load('nico'));
  c.set('identity.level', 16);
  const exported = JSON.parse(JSON.stringify(c.toJSON()));
  const v = inspectDocument(exported);
  check('an exported document imports', v.ok, true);
  check('carrying the edits with it', v.summary.level, 16);
  check('and reloads to the same state',
    new Character(exported).data.identity.level, 16);

  // Refusals, each with something to act on.
  const bad = (doc) => inspectDocument(doc);
  check('null is refused', bad(null).ok, false);
  check('an array is refused', bad([]).ok, false);
  check('a string is refused', bad('angou').ok, false);
  check('an object with no schemaVersion is refused', bad({ id: 'x' }).ok, false);
  check('and says so', /schemaVersion/.test(bad({ id: 'x' }).error), true);

  const stale = { ...load('angou'), schemaVersion: SCHEMA_VERSION - 1 };
  check('a stale schema is refused', bad(stale).ok, false);
  check('naming both versions', [
    bad(stale).error.includes(String(SCHEMA_VERSION - 1)),
    bad(stale).error.includes(String(SCHEMA_VERSION)),
  ], [true, true]);
  check('and pointing at the fix', /convert\.py/.test(bad(stale).error), true);

  const nameless = JSON.parse(JSON.stringify(load('angou')));
  delete nameless.identity.name;
  check('a document with no name is refused', bad(nameless).ok, false);

  // A document with no id of its own still gets one, from its name.
  const anonymous = JSON.parse(JSON.stringify(load('bryva')));
  delete anonymous.id;
  check('a missing id is derived from the name', bad(anonymous).summary.id, 'nakano_bryva');

  check('refusals never carry a summary', bad(stale).summary, null);
}

console.log('card casting -- the deck reads off the Cardcaster Deck tab');
{
  const c = new Character(load('nico'));
  const p = c.data.cardcasting;
  const k = p.calc;
  check('the tab is retired into the block', c.data.sheetTabs.some((t) => /cardcast/i.test(t.name)), false);
  check('the deck is enabled', p.enabled, true);
  check('the casting stat is read', p.castingStat, 'Int');
  check('and its modifier is the casting modifier', k.cam, 13);
  check('opening hand is 1 + modifier', k.openingHand, 14);
  check('54 cards, one Harrow deck', k.deckSize, 54);
  check('six suits of nine', Object.values(k.suitTally), [9, 9, 9, 9, 9, 9]);
  check('nine alignments of six', Object.values(k.alignTally).every((n) => n === 6), true);
  check('the switches: Cooldown, Mana Pool, no Graveyard', [p.cooldown, p.manaPool, p.manaGraveyard], [true, true, false]);
  check('the modifications ticked on the tab', [p.mods.deckout, p.mods.stagnantPool, p.mods.gradualRamp, p.mods.coloredMana, p.mods.singleton],
    [true, true, true, 3, false]);
  check('three colours in play', p.colors, 'RBU');
  check('worth seven drawbacks for boons', k.drawbackValue, 7);
  check('the deck is legal as imported', k.issues, []);
  check('the identical-effect spread is 1 to 4', [k.spreadMin, k.spreadMax], [1, 4]);
  // A fused card: the effect, and the mana it carries, split from one cell.
  const reanimate = p.cards[1];
  check('the Harrow name is the card\'s name', reanimate.name, 'Crows');
  check('and the deck knows it is a Harrow deck', p.harrow, true);
  check('a fused card keeps its effect', reanimate.effect, 'Reanimate');
  check('and its mana as letters', reanimate.mana, 'UB');
  check('and its effect colour', reanimate.color, 'B');
  const nether = p.cards.find((x) => /^Nether Blast/.test(x.effect));
  check('a bar inside the effect stays in the effect', nether.effect, 'Nether Blast (Chain Blast|Explosive Orb)');
  check('while the mana suffix comes off', nether.mana, 'RU');
  check('and so the two Nether Blasts are one effect', k.effects.find((e) => /^Nether/.test(e.effect)).count, 2);
  check('the deck manipulations count up to what the sheet said', [k.manipulationsTaken, k.manipulationsAvailable], [11, 11]);
  check('grouped as the sheet grouped them', p.manipulations.find((m) => m.name === 'Retrace').group, 'Cooldown');
  const dpe = p.manipulations.find((m) => m.name === 'Draw Power Enhancement');
  check('with the note beside the pick', [dpe.group, dpe.note, dpe.count], ['General', 'Draw 3 cards', 2]);
  check('and the sheet\'s spelling still finds the catalogue entry', deckManipulation(dpe.name)?.name, 'Drawpower Enhancement');
  check('as does Wildcard / Wild Card', deckManipulation('Wildcard')?.name, 'Wild Card');
  check('the catalogue has the wiki\'s list', deckManipulationCatalogue().length >= 30, true);
  check('every pick Nico took is known', p.manipulations.every((m) => m.calc.known), true);
  check('and none wants a switch he lacks', p.manipulations.every((m) => !m.calc.unmet.length), true);
  check('ten deck feats between the Feats tab and the tradition', k.deckFeats.length, 10);
  check('one manipulation each, plus one for Card Shark', k.autoAvailable, 11);
  check('so the sheet\'s 11 is left automatic', p.manipulationsAvailable, null);
  check('Rainbow Efficiency is seen among the deck feats', k.rainbow, 1);
  check('land-attuned spheres by colour', p.colorSpheres.U, ['Illusion', 'Mana', 'Mind', 'Technomancy', 'Time']);
  check('with the attuned ones listed', p.attunedSpheres, ['Destruction', 'Warp', 'Dark', 'Death', 'Mana', 'Mind', 'Time', 'Fate']);
  check('the sideboard is read', p.sideboard.length, 5);
  check('and nothing on the tab is left unclaimed', p.sourceExtras, []);
  check('draw ranges run down the deck', [p.cards[0].calc.from, p.cards[0].calc.to, p.cards[53].calc.from], [1, 1, 54]);
  check('a card\'s frame is its cost colour', p.cards[0].calc.colors, 'B');
  // No colour of its own: the sphere's colour from the land-attuned table.
  c.setItem('cardcasting.cards', 0, 'color', '');
  check('a colourless Death card wears Black from its sphere', [c.data.cardcasting.cards[0].calc.colors, c.data.cardcasting.cards[0].calc.fromSphere], ['B', true]);
  c.setItem('cardcasting.cards', 0, 'sphere', 'Veilweaving');
  check('a veilweaving card is an artifact', c.data.cardcasting.cards[0].calc.artifact, true);
  c.setItem('cardcasting.cards', 0, 'sphere', 'Death');
  c.setItem('cardcasting.cards', 0, 'color', 'RU');
  check('two colours are kept for a Rainbow Efficiency cost', c.data.cardcasting.cards[0].calc.colors, 'RU');
  check('and count towards both colours', c.data.cardcasting.calc.colorTally.R.effects, 21);
  check('two colours is within Rainbow Efficiency', c.data.cardcasting.calc.issues.some((i) => /more than/.test(i)), false);
  c.setItem('cardcasting.cards', 0, 'color', 'RUB');
  check('three is not, without Improved', c.data.cardcasting.calc.issues.some((i) => /more than 2 colours/.test(i)), true);
  c.setItem('cardcasting.cards', 0, 'color', 'B');
  // A manipulation that wants a switch the caster lacks is flagged, not refused.
  c.listAdd('cardcasting.manipulations', { group: 'General', name: 'Trimmed Deck', note: '', count: 1 });
  check('Trimmed Deck without Singleton is flagged', c.data.cardcasting.calc.issues.some((i) => /Trimmed Deck needs Singleton/.test(i)), true);
  c.listRemove('cardcasting.manipulations', c.data.cardcasting.manipulations.length - 1);
  check('and the manipulation count is in scope', c.scope().deck.feats, 10);
  check('the scope carries the deck', c.scope().deck.hand, 14);
  check('and each manipulation\'s count by name', [c.scope().deck.manip.draw_power_enhancement, c.scope().deck.manip.loaded_hand], [2, 0]);
  check('so a formula can read one', c.renderProse('{= deck.manip.fused_cards * 2}').find((s) => s.kind === 'value').value, 6);
  // A card saved before it had a name carried the Harrow name in `harrow`.
  const old = new Character(JSON.parse(JSON.stringify(load('nico'))));
  old.data.cardcasting.cards[0].harrow = 'Betrayal';
  delete old.data.cardcasting.cards[0].name;
  old.recompute();
  check('an old card\'s Harrow name becomes its name', [old.data.cardcasting.cards[0].name, old.data.cardcasting.cards[0].harrow], ['Betrayal', undefined]);

  // The checks are advisory and move with the switches and the cards.
  c.set('cardcasting.mods.singleton', true);
  check('Singleton flags the duplicates', c.data.cardcasting.calc.issues.some((i) => /^Singleton/.test(i)), true);
  check('and is one more drawback', c.data.cardcasting.calc.drawbackValue, 8);
  c.set('cardcasting.mods.singleton', false);
  c.set('cardcasting.manaGraveyard', true);
  check('Mana Graveyard on both halves is another', c.data.cardcasting.calc.drawbackValue, 8);
  check('but clashes with Stagnant Pool', c.data.cardcasting.calc.issues.some((i) => /Stagnant Pool and Mana Graveyard/.test(i)), true);
  c.set('cardcasting.manaGraveyard', false);
  c.set('cardcasting.mods.tightHand', true);
  check('Tight Hand caps the hand at 3 + Loaded Hand', c.data.cardcasting.calc.handMax, 3);
  c.set('cardcasting.mods.lifeboundDeck', true);
  const hp = c.data.hp.total + c.mythicHp;
  check('Lifebound is HP / 3 / deck size, at least 1', c.data.cardcasting.calc.lifebound, Math.max(1, Math.floor(hp / 3 / 54)));
  c.set('cardcasting.mods.tightHand', false);
  c.set('cardcasting.mods.lifeboundDeck', false);
  c.setItem('cardcasting.cards', 0, 'qty', 20);
  check('twenty copies of one effect breaks the spread', c.data.cardcasting.calc.issues.some((i) => /spread of/.test(i)), true);
  c.setItem('cardcasting.cards', 0, 'qty', 1);
  c.setItem('cardcasting.cards', 0, 'mana', 'x/u/b');
  check('mana letters are normalised', c.data.cardcasting.cards[0].mana, 'UB');
  c.set('cardcasting.manipulationsAvailable', 'floor(level / 3) + 6');
  check('the manipulations available may be a formula', c.data.cardcasting.calc.manipulationsAvailable, 11);
  check('and is audited', c.audit().some((r) => r.id === 'deck-manipulations' && r.status === 'ok'), true);
  c.setItem('cardcasting.cards', 0, 'effect', 'Corpse Bomb — Fort DC {= 10 + floor(level/2) + int.mod}');
  const rendered = c.renderProse(c.data.cardcasting.cards[0].effect).find((s) => s.kind === 'value');
  check('a card effect resolves formulas', rendered?.value, 30);

  // What is saved is what was typed; the tallies come back on load.
  const saved = c.toJSON().cardcasting;
  check('the checks are not saved', saved.calc, undefined);
  check('nor a card\'s draw range', saved.cards[0].calc, undefined);
  const again = new Character({ ...c.toJSON(), sheetTabs: c.toJSON().sheetTabs });
  check('and a reload rebuilds them', again.data.cardcasting.calc.deckSize, 54);
  check('with the edits kept', again.data.cardcasting.manipulationsAvailable, 'floor(level / 3) + 6');

  // A caster with the drawback but no deck tab still gets the switches.
  const bare = JSON.parse(JSON.stringify(load('nico')));
  delete bare.extraTabs['Cardcaster Deck'];
  const b = new Character(bare);
  check('no tab, no cards', b.data.cardcasting.cards.length, 0);
  check('but the tradition still enables the tab', b.data.cardcasting.enabled, true);
  check('and seeds the ladder from the drawbacks', [b.data.cardcasting.cooldown, b.data.cardcasting.manaPool, b.data.cardcasting.mods.deckout], [true, true, true]);
  check('and the colours from "Colored Mana (RBU)"', b.data.cardcasting.colors, 'RBU');
  check('and the casting stat from the casting class', b.data.cardcasting.castingStat, 'Int');
  check('opening hand still reads', b.data.cardcasting.calc.openingHand, 14);

  // A character without the drawback carries an empty, disabled block.
  const a = new Character(load('angou'));
  check('Angou has no deck', [a.data.cardcasting.enabled, a.data.cardcasting.cards.length], [false, 0]);
  check('and no issues from it', a.data.cardcasting.calc.issues, []);
}

console.log('card casting -- the table: an encounter played through');
{
  const c = new Character(load('nico'));
  // A fixed shuffle, so the hand is the same every run.
  let seed = 7;
  c.rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const t = () => c.data.cardcasting.table;
  const k = () => c.data.cardcasting.calc;

  check('no encounter to begin with', [t().active, t().deck.length], [false, 0]);
  c.tableStart();
  check('the deck is every copy, shuffled', t().deck.length + t().hand.length + t().mana.length, 54);
  check('the opening hand is 1 + Int', t().hand.length, k().openingHand);
  check('and it is round one', t().round, 1);
  check('nothing that costs is castable with no mana in play', Object.values(t().calc.castable).every((x) => x.ok === (x.need === 0)), true);
  const first = t().hand[0];
  const firstName = c.tableCard(first).name;
  const inHand = t().hand.length;

  // Nico's cards are all fused: the mana half goes to the table.
  const fused = t().hand.find((id) => c.tableCard(id).mana);
  c.tablePlay(fused, 'mana');
  check('a fused card played as mana sits on the table', [t().mana.length, t().hand.length], [1, inHand - 1]);
  check('the log says so', /played as mana/.test(t().log[t().log.length - 1]), true);
  check('under Gradual Ramp that is the one for this round', t().manaPlayed, 1);

  // Cast: with Cooldown the card goes to the discard, and Stagnant Pool taps the mana.
  const castable = t().hand.find((id) => t().calc.castable[id].ok);
  const before = t().discard.length;
  if (castable) c.tablePlay(castable, 'cast');
  check('a cast card goes to the discard under Cooldown', t().discard.length, castable ? before + 1 : before);
  check('and its mana is tapped under Stagnant Pool', castable ? t().mana.filter((m) => m.tapped).length >= 1 : true, true);

  c.tableNextRound();
  check('a new round draws one', t().round, 2);
  check('and untaps the mana', t().mana.every((m) => !m.tapped), true);
  check('and Gradual Ramp resets', t().manaPlayed, 0);

  // Ongoing effects wait in play until resolved.
  const eff = t().hand.find((id) => String(c.tableCard(id).effect).trim());
  c.tablePlay(eff, 'ongoing');
  check('an ongoing card is in play', t().play.includes(eff), true);
  c.tableResolve(eff);
  check('and resolves into the discard', [t().play.includes(eff), t().discard.includes(eff)], [false, true]);

  // Cooldown's full-round action.
  const inDiscard = t().discard.length;
  const deckBefore = t().deck.length;
  c.tableShuffleDiscard();
  check('the discard shuffles back into the deck', [t().discard.length, t().deck.length], [0, deckBefore + inDiscard]);

  // Moving by hand: anywhere to anywhere.
  const h0 = t().hand[0];
  c.tableMove(h0, 'exile');
  check('a card can be exiled by hand', t().exile.includes(h0), true);
  c.tableMove(h0, 'deckTop');
  check('and put on top of the deck', t().deck[0], h0);
  check('which Read the Cards then sees', c.tablePeek(1), [h0]);
  c.tableMove(h0, 'hand');

  // A redraw is one fewer -- Nico has no Mulligan.
  const size = t().hand.length;
  c.tableRedraw();
  check('a redraw is one card fewer', t().hand.length, size - 1);

  // The scope reads the table.
  check('the scope reads the table', [c.scope().deck.round, c.scope().deck.inHand], [2, size - 1]);

  // What is saved is the zones, not the counts.
  const saved = c.toJSON().cardcasting.table;
  check('zones are saved', Array.isArray(saved.hand) && saved.hand.length === size - 1, true);
  check('counts are not', saved.calc, undefined);
  const again = new Character(c.toJSON());
  check('and an encounter survives a reload', [again.data.cardcasting.table.active, again.data.cardcasting.table.hand.length], [true, size - 1]);

  c.tableEnd();
  check('the encounter ends with everything back in the deck', [t().active, t().deck.length, t().hand.length, t().mana.length, t().discard.length], [false, 54, 0, 0, 0]);

  // Keywords, dice, traps and the Gradual Ramp gate.
  const g = new Character(load('nico'));
  let s2 = 11;
  g.rng = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
  const gt = () => g.data.cardcasting.table;
  g.setItem('cardcasting.cards', 0, 'effect', 'Corpse Bomb 6d6 fire [Draw 2] [Mill 1] [Peek] [Wild] [Exile]');
  g.setItem('cardcasting.cards', 0, 'dice', '6d6+int.mod');
  g.tableStart();
  g.tableMove('0#0', 'hand');
  g.tableRoll('0#0');
  check('a roll adds the sheet\'s modifier to the dice', [gt().lastRoll.rolls.length, gt().lastRoll.flat, gt().lastRoll.total], [6, 13, gt().lastRoll.rolls.reduce((a, b) => a + b, 0) + 13]);
  const handBefore = gt().hand.length;
  const deckBefore2 = gt().deck.length;
  g.tablePlay('0#0', 'cast');
  check('[Draw 2] draws two and [Mill 1] mills one', [gt().hand.length, gt().deck.length], [handBefore - 1 + 2, deckBefore2 - 3]);
  check('[Peek] reads the top card (Read the Cards is taken)', gt().log.some((l) => /\[Peek 1\]: \w/.test(l)), true);
  check('[Wild] is skipped without Wild Card', gt().log.some((l) => /\[wild\] skipped — needs Wild Card/.test(l)), true);
  check('[Exile] is the card\'s own rule and always applies', [gt().exile.includes('0#0'), gt().discard.includes('0#0')], [true, false]);
  check('and being exiled is a trigger event', gt().log.some((l) => /exiled$/.test(l)), true);
  const fusedA = gt().hand.find((id) => g.tableCard(id).mana);
  g.tablePlay(fusedA, 'mana');
  const fusedB = gt().hand.find((id) => g.tableCard(id).mana);
  const handNow = gt().hand.length;
  g.tablePlay(fusedB, 'mana');
  check('Gradual Ramp blocks a second Mana Point card in the round', [gt().mana.length, gt().hand.length, gt().calc.manaBlocked], [1, handNow, true]);
  g.setItem('cardcasting.cards', Number(fusedB.split('#')[0]), 'tags', 'Fused, Mana Rock');
  g.tablePlay(fusedB, 'mana');
  check('but a Mana Rock may still be played', gt().mana.length, 2);
  g.tableNextRound();
  check('and the gate lifts next round', gt().calc.manaBlocked, false);
  const trap = gt().hand.find((id) => String(g.tableCard(id).effect).trim());
  g.tablePlay(trap, 'trap');
  check('a trap is face down in play (Nico has Trap Card)', [gt().play.includes(trap), gt().faceDown.includes(trap), gt().calc.trapCard], [true, true, true]);
  g.tableReveal(trap);
  check('revealed, it is still in play', [gt().play.includes(trap), gt().faceDown.includes(trap)], [true, false]);
  g.tableResolve(trap);
  check('and springs into the discard', gt().discard.includes(trap), true);

  // Nico's special cards: formulas in the text, dice from formulas, triggers, [Ante].
  const n = new Character(load('nico'));
  let s3 = 5;
  n.rng = () => { s3 = (s3 * 16807) % 2147483647; return s3 / 2147483647; };
  const nt = () => n.data.cardcasting.table;
  const IC = 'Infernal Combustion — When played, make a ranged touch attack against a target, dealing {ceil(caster.level/2)}d6 fire damage for every odd caster level you possess.\n'
    + '[OnMill] If this card is discarded from the top of your deck to the discard pile, you can make a ranged touch attack as a free action, but deal {ceil(caster.level/2)}d4 fire damage instead.\n'
    + '[OnRedraw] If this card is shuffled from the hand back into the deck, the user loses {level} HP.';
  const PD = 'Perfect Draw — [Ante] Shuffle this back into your deck and gain a number of Early Counters equal to your Maximum Ante ({= 2 + floor((level - 1) / 4)}). This card is exiled afterwards.';
  const GP = 'Grave Peril — deal {ceil(caster.level/2)}d6+{ceil(caster.level/2)} bludgeoning damage. [OnDraw] If this card is drawn with no other cards in your deck or hand, cast it for free.';
  n.setItem('cardcasting.cards', 18, 'effect', IC);
  n.setItem('cardcasting.cards', 22, 'effect', PD);
  n.setItem('cardcasting.cards', 6, 'effect', GP);
  n.setItem('cardcasting.cards', 6, 'dice', '{ceil(caster.level/2)}d6+{ceil(caster.level/2)}');
  check('bare {expr} in card text evaluates', n.renderProse(IC).find((s) => s.kind === 'value').value, 8);
  n.tableStart();
  n.tableMove('18#0', 'hand');
  n.tableRoll('18#0');
  check('dice found in the text resolve their formula first: 8d6', [nt().lastRoll.source, nt().lastRoll.rolls.length], ['8d6', 8]);
  n.tableMove('6#0', 'hand');
  n.tableRoll('6#0');
  check('a Dice field with formulas: 8d6+8', [nt().lastRoll.rolls.length, nt().lastRoll.flat], [8, 8]);
  n.tableMove('18#0', 'deckTop');
  n.tableMove('18#0', 'discard');
  check('[OnMill] fires when the card goes from the top of the deck to the discard', /⚡ Cyclone \(mill\): If this card is discarded/.test(nt().lastTrigger), true);
  n.tableMove('18#0', 'hand');
  n.tableRedraw();
  check('[OnRedraw] fires when the hand is shuffled back', /⚡ Cyclone \(redraw\): If this card is shuffled/.test(nt().log.join('\n')), true);
  n.tableMove('22#0', 'hand');
  n.tablePlay('22#0', 'cast');
  check('[Ante] shuffles Perfect Draw back with Early counters = max ante (5 at level 15)', [nt().deck.includes('22#0'), nt().counters?.early, nt().counters?.late], [true, 5, 0]);
  n.tableNextRound();
  check('a round ticks an Early counter down', nt().counters.early, 4);
  n.tableMove('22#0', 'deckTop');
  n.tableDraw(1);
  check('drawing it logs the branch and marks it drawn', [nt().counters.drawn, /\[Ante\] Snakebite drawn — Early counters \(4\)/.test(nt().log.join('\n'))], [true, true]);
  n.tablePlay('22#0', 'cast');
  check('the second cast exiles it and clears the counters', [nt().exile.includes('22#0'), nt().counters], [true, null]);
  n.tableMove('6#0', 'deckTop');
  n.tableDraw(1);
  check('[OnDraw] fires on the draw', /⚡ Fiend \(draw\)/.test(nt().lastTrigger), true);
  n.tableMove(nt().hand[0], 'discard');
  n.tableMove(nt().hand[0], 'discard');
  n.tableMove(nt().hand[0], 'discard');
  const exiledBefore = nt().exile.length;
  n.tableExileRandom(2);
  check('random exile takes from the discard', [nt().discard.length, nt().exile.length], [1, exiledBefore + 2]);
  n.tableEnd();
  check('the end of the encounter notes the exiled cards\' return', /exiled cards: half return now/.test(nt().log[nt().log.length - 1]), true);

  // Spell points: paid from a Spell Points tracker when there is one.
  const s = new Character(load('nico'));
  s.rng = () => 0.4;
  check('no tracker, nothing to pay from', s.spellPointTracker(), null);
  s.tableStart();
  const paid0 = s.data.cardcasting.table.hand.find((id) => parseInt(s.tableCard(id).cost, 10) > 0);
  s.tablePlay(paid0, 'cast');
  check('a cast without a tracker just logs the cast', /spell point/.test(s.data.cardcasting.table.log[s.data.cardcasting.table.log.length - 1]), false);
  const spT = s.addTracker({ name: 'Spell Points', maxFormula: 'caster.sp' });
  check('a tracker named Spell Points is found', s.spellPointTracker()?.id, spT.id);
  const paid = s.data.cardcasting.table.hand.find((id) => parseInt(s.tableCard(id).cost, 10) === 1);
  s.tablePlay(paid, 'cast');
  check('a 1-point card spends one from the tracker', s.spellPointTracker().current, 1);
  s.tableSpend(s.data.cardcasting.table.hand[0], 1);
  check('and a modal +1 SP spends another', s.spellPointTracker().current, 2);
  check('the log says what was spent and what is left', /1 spell point spent, \d+ left/.test(s.data.cardcasting.table.log[s.data.cardcasting.table.log.length - 1]), true);
  s.updateTracker(spT.id, { current: spT.max });
  s.tableSpend(null, 1);
  check('an empty pool cannot go negative', s.spellPointTracker().current, spT.max);
  s.updateTracker(spT.id, { current: 0 });
  // Casting rolls the card's dice by itself; Retrace casts from the discard for +1; Read the Cards buries for 1.
  s.setItem('cardcasting.cards', 6, 'dice', '{ceil(caster.level/2)}d6+{ceil(caster.level/2)}');
  s.tableMove('6#0', 'hand');
  s.tablePlay('6#0', 'cast');
  check('a cast rolls the card\'s dice on its own', /Fiend rolls 8d6\+8/.test(s.data.cardcasting.table.log.join('\n')), true);
  const spentAfterCast = s.spellPointTracker().current;
  s.tableRetrace('6#0');
  check('Retrace pays the cost plus one and leaves the card in the discard', [s.spellPointTracker().current - spentAfterCast, s.data.cardcasting.table.discard.includes('6#0')], [6, true]);
  check('and rolls again', s.data.cardcasting.table.log.filter((l) => /Fiend rolls/.test(l)).length, 2);
  const topCard = s.tablePeek(1)[0];
  const spentBeforeBury = s.spellPointTracker().current;
  s.tableBury(topCard);
  check('Read the Cards buries the top card for a spell point', [s.data.cardcasting.table.deck[s.data.cardcasting.table.deck.length - 1], s.spellPointTracker().current - spentBeforeBury], [topCard, 1]);
  // Named rolls: the first is the cast's, the others are picked, and a "(1 SP)" label spends.
  s.setItem('cardcasting.cards', 18, 'dice', '{ceil(caster.level/2)}d6; boost (1 SP): {caster.level}d6; milled: {ceil(caster.level/2)}d4');
  check('the Dice field lists named rolls', s.cardRolls(s.data.cardcasting.cards[18]).map((r) => `${r.label}:${r.sp}`), ['roll:0', 'boost (1 SP):1', 'milled:0']);
  s.tableStart();
  s.updateTracker(spT.id, { current: 0 });
  s.tableMove('18#0', 'deckTop');
  s.tableMove('18#0', 'discard');
  s.tableBoost('18#0', 'milled');
  check('a named roll can be made from the discard', [s.data.cardcasting.table.lastRoll.label, s.data.cardcasting.table.lastRoll.rolls.length], ['milled', 8]);
  s.tableBoost('18#0', 'boost (1 SP)');
  check('a boost spends its point and rolls the bigger dice', [s.spellPointTracker().current, s.data.cardcasting.table.lastRoll.rolls.length], [1, 15]);
  s.tableEnd();

  // A deck of one card, all Mana Point cards, straight to the table under Mana Pool.
  const m = new Character(load('nico'));
  m.rng = () => 0.5;
  m.data.cardcasting.cards = [{ name: 'Mana', effect: '', mana: 'R', color: '', qty: 20, cost: '', sphere: '', tags: '' }];
  m.set('cardcasting.mods.gradualRamp', false);
  m.tableStart();
  check('plain Mana Point cards drawn go straight to the table without Gradual Ramp', [m.data.cardcasting.table.mana.length, m.data.cardcasting.table.hand.length], [14, 0]);
  m.set('cardcasting.mods.tightHand', true);
  m.set('cardcasting.mods.gradualRamp', true);
  m.tableStart();
  check('Tight Hand stops the draw at 3', m.data.cardcasting.table.hand.length, 3);
  // Deckout: an empty deck stays empty.
  m.data.cardcasting.cards[0].qty = 2;
  m.tableStart();
  m.tableDraw(1);
  const dry = m.data.cardcasting.table.deck.length;
  check('a deck runs dry', dry, 0);
  m.tablePlay(m.data.cardcasting.table.hand[0], 'mana');
  m.tableMove(m.data.cardcasting.table.mana[0].id, 'discard');
  m.tableDraw(1);
  check('and Deckout keeps the discard out of it', [m.data.cardcasting.table.deck.length, /empty/.test(m.data.cardcasting.table.log[m.data.cardcasting.table.log.length - 1])], [0, true]);
  m.set('cardcasting.mods.deckout', false);
  m.tableDraw(1);
  check('without Deckout the discard shuffles back in as a free action', m.data.cardcasting.table.discard.length, 0);
}

console.log('extras & notes -- the ExtrasNotes worksheet becomes notes, approvals and extras');
{
  for (const id of IDS) {
    const c = new Character(load(id));
    check(`${id} keeps no raw ExtrasNotes grid`, (c.data.sheetTabs || []).map((t) => t.name).includes('ExtrasNotes'), false);
    check(`${id} has an extras block`, Array.isArray(c.data.extras?.approvals), true);
    check(`${id} keeps none of the template's hint lines as notes`,
      c.data.notes.some((n) => /not referenced anywhere|Go ham/.test(n.body)), false);
  }
  const angou = new Character(load('angou'));
  check('angou: two Range columns become two notes', angou.data.notes.map((n) => n.title), ['Range 1', 'Range 2']);
  check('angou: the links column is one note, a line each', angou.data.notes[0].body.split(/\n/).length, 8);
  const saburo = new Character(load('saburo'));
  check('saburo: the Approvals table becomes rows', saburo.data.extras.approvals.map((a) => a.name),
    ['Ronin custom archetype', 'Arcforge - Abnormal Interfacing feat', 'Ancestral Weapon', 'Collapse Manipulator - Dual Sphere Drawback']);
  check('saburo: with their links', saburo.data.extras.approvals[0].link, 'https://primordia.online/applications/6000120');
  check('saburo: the veils-to-consider table below is kept as extras, not lost', saburo.data.extras.sourceExtras.length > 0, true);
  const nar = new Character(load('narockro'));
  check('narockro: only hint text in the columns, so no notes; the claim tallies stay as extras', [nar.data.notes.length, nar.data.extras.sourceExtras.length > 0], [0, true]);
  // Round trip: a saved document does not re-import.
  saburo.listAdd('extras.approvals', { name: 'New thing', approvedBy: 'GM', link: '' });
  const back = new Character(JSON.parse(JSON.stringify(saburo.toJSON())));
  check('approvals round-trip and are not re-imported on top', back.data.extras.approvals.length, 5);
}

console.log('companions -- the three worksheets become blocks and the grids retire');
for (const id of IDS) {
  const c = new Character(load(id));
  const names = (c.data.sheetTabs || []).map((t) => t.name);
  for (const [tab, key] of [['Familiar', 'familiar'], ['Animal Companion', 'animalCompanion'], ['Eidolon', 'eidolon']]) {
    check(`${id} keeps no raw ${tab} grid`, names.includes(tab), false);
    check(`${id} has a ${key} block`, !!c.data[key]?.calc, true);
  }
  // Nothing on any workbook's companion tabs was ever filled in, so none of
  // them counts as in use -- and the tabs stay off until asked for.
  check(`${id} starts with no companion in use`, [c.data.familiar.name, c.data.animalCompanion.masterClass, c.data.eidolon.masterClass], ['', '', '']);
}

console.log('companions -- a familiar is its master, halved');
{
  const c = new Character(load('angou'));
  const f = c.data.familiar;
  // The worksheet's own cached numbers for Angou: HP 275, HD 20, BAB 20, Int 15,
  // saves 12, Acrobatics 20 from the master's ranks.
  check('half the master\'s hit points', f.calc.hpMax, Math.floor((c.data.hp.total + c.mythicHp) / 2));
  check('the master\'s level and BAB', [f.calc.level, f.calc.hd, f.calc.bab], [20, 20, c.data.attack.bab]);
  check('Intelligence off the familiar table at 20th', f.calc.scores.int.total, 15);
  check('natural armour off the table at 20th', f.calc.tableNatural, 10);
  check('base saves are the master\'s, never below 2', f.calc.saves.fort.base, Math.max(2, c.data.saves.fortitude.base));
  const acro = f.skills.find((s) => s.name === 'Acrobatics');
  const masterAcro = c.data.skills.find((s) => s.name === 'Acrobatics');
  check('a skill uses the master\'s ranks when they are higher', acro.masterRanks, masterAcro.totalRanks);
  check('and the class-skill +3 once there is a rank', acro.total, masterAcro.totalRanks + 3 + f.calc.scores.dex.mod);
  // Tiny: +2 to AC and attack, -2 to CMD; attack ability is the better of Str and Dex.
  c.set('familiar.scores.dex.base', 16);
  check('a Tiny familiar with Dex 16 attacks with Dex', [c.data.familiar.calc.attackAbility, c.data.familiar.calc.totalAttack], ['Dex', c.data.attack.bab + 3 + 2]);
  check('AC counts Dex, size and the table\'s natural armour', c.data.familiar.calc.ac, 10 + 3 + 2 + 10);
  check('touch leaves the natural armour out', c.data.familiar.calc.touch, 10 + 3 + 2);
  check('CMD takes the size the other way', c.data.familiar.calc.cmd, 10 + c.data.attack.bab + 0 + 3 - 2);
  c.set('familiar.protector', true);
  check('a Protector at 11th has double', c.data.familiar.calc.hpMax, Math.floor((c.data.hp.total + c.mythicHp) / 2) * 2);
  c.set('familiar.masterLevelPenalty', 3);
  check('the master-level penalty lowers the level and the table row', [c.data.familiar.calc.level, c.data.familiar.calc.scores.int.total], [17, 14]);
  c.set('familiar.scores.int.base', 20);
  check('a typed Intelligence pins it', c.data.familiar.calc.scores.int.total, 20);
}

console.log('companions -- the animal companion follows its table by effective level');
{
  const c = new Character(load('angou'));
  c.set('animalCompanion.masterClass', 'Legendary Monk');
  const a = c.data.animalCompanion;
  check('level counts the class off the Planner', a.calc.level, c.classLevelCount('Legendary Monk'));
  c.set('animalCompanion.levelOverride', 9);
  const k = c.data.animalCompanion.calc;
  // The table at 9th: 8 HD, BAB +6, good +6 / poor +2, 8 ranks, 4 feats, +6 natural, +3 Str/Dex, 4 tricks.
  check('9th: HD, BAB, natural armour, Str/Dex bonus', [k.hd, k.bab, k.tableNatural, k.scores.str.lvlUp, k.scores.dex.lvlUp], [8, 6, 6, 3, 3]);
  check('9th: ranks, feats, bonus tricks', [k.ranksAllowed, k.featsAllowed, k.bonusTricks], [8, 4, 4]);
  check('good Fort and Ref, poor Will', [k.saves.fort.base, k.saves.ref.base, k.saves.will.base], [6, 6, 2]);
  check('hit points are 8 a die plus Con', k.hpMax, 8 * 8 + 0);
  c.set('animalCompanion.scores.con.base', 14);
  check('Con moves them by HD', c.data.animalCompanion.calc.hpMax, 8 * 8 + 2 * 8);
  c.setItem('animalCompanion.abilityIncreases', 0, 'ability', 'Con');
  check('the 4th-level +1 lands on the ability chosen', c.data.animalCompanion.calc.scores.con.total, 15);
  c.setItem('animalCompanion.abilityIncreases', 2, 'ability', 'Con');
  check('the 14th-level one waits', c.data.animalCompanion.calc.scores.con.total, 15);
  c.set('animalCompanion.levelOverride', 20);
  check('20th: 16 HD, BAB +12, +12 natural, +6 Str/Dex, and every increase in', [c.data.animalCompanion.calc.hd, c.data.animalCompanion.calc.bab, c.data.animalCompanion.calc.tableNatural, c.data.animalCompanion.calc.scores.str.lvlUp, c.data.animalCompanion.calc.scores.con.total], [16, 12, 12, 6, 16]);
  // Attacks: primary at full, secondary at -5, -2 with Multiattack.
  c.set('animalCompanion.levelOverride', 9);
  c.listAdd('animalCompanion.attacks', { type: 'Bite', damage: '1d8', crit: '20/×2', primary: null, bonus: 0, qualities: '' });
  c.listAdd('animalCompanion.attacks', { type: 'Hoof', damage: '1d4', crit: '20/×2', primary: null, bonus: 0, qualities: '' });
  const total = c.data.animalCompanion.calc.totalAttack;
  check('bite is primary, hoof secondary', c.data.animalCompanion.attacks.map((x) => x.toHit), [total, total - 5]);
  check('and the table names the damage type', c.data.animalCompanion.attacks.map((x) => x.damageType), ['B, P, and S', 'B']);
  c.listAdd('animalCompanion.feats', { name: 'Multiattack', notes: '' });
  check('Multiattack softens the secondary to -2', c.data.animalCompanion.attacks[1].toHit, total - 2);
  c.setItem('animalCompanion.attacks', 1, 'primary', 'primary');
  check('a role chosen by hand wins', c.data.animalCompanion.attacks[1].toHit, total);
  // Body type drives the item slots.
  c.set('animalCompanion.bodyType', 'Avian');
  check('an avian has ten slots and can grasp', [c.data.animalCompanion.calc.slots.length, c.data.animalCompanion.calc.canGrasp], [10, true]);
  // A Spheres companion levels by ranks instead.
  c.set('animalCompanion.levelOverride', null);
  c.set('animalCompanion.levelSource', 'handleAnimal');
  const ha = c.data.skills.find((s) => s.name === 'Handle Animal');
  check('Handle Animal ranks as the level', c.data.animalCompanion.calc.level, Math.min(20, ha?.totalRanks || 0));
}

console.log('companions -- the eidolon spends an evolution pool');
{
  const c = new Character(load('nico'));
  c.set('eidolon.levelOverride', 12);
  const k = c.data.eidolon.calc;
  // The table at 12th: 9 HD, BAB +9, +10 natural, +5 Str/Dex, 9 evolution points, 5 attacks, 5 feats.
  check('12th: HD, BAB, natural, Str/Dex, pool, attacks, feats', [k.hd, k.bab, k.tableNatural, k.scores.str.lvlUp, k.evoPool, k.maxAttacks, k.featsAllowed], [9, 9, 10, 5, 9, 5, 5]);
  check('skill ranks are HD × (6 + Int), the sheet\'s cell', k.ranksAllowed, 9 * 6);
  check('the increases at 5th and 10th are in, 15th is not', [c.data.eidolon.abilityIncreases.map((x) => x.level), k.level], [[5, 10, 15], 12]);
  c.listAdd('eidolon.evolutions', { name: 'Claws', cost: 1, type: '', notes: '' });
  c.listAdd('eidolon.evolutions', { name: 'Improved natural armor', cost: 2, type: '', notes: '' });
  check('evolutions spend the pool', [c.data.eidolon.calc.evoSpent, c.data.eidolon.calc.evoLeft], [3, 6]);
  c.set('eidolon.bonusEvoPoints', 2);
  check('bonus points widen it', c.data.eidolon.calc.evoPool, 11);
  c.set('eidolon.masterLevelPenalty', 1);
  check('a master-level penalty costs a level and a point', [c.data.eidolon.calc.level, c.data.eidolon.calc.evoPool], [11, 9 - 1 + 2]);
  c.set('eidolon.scores.str.evo', 8);
  check('an evolution bonus over the cap (2 + 2 per six levels) is flagged', [c.data.eidolon.calc.maxBonusPerStat, c.data.eidolon.calc.evoBonusOver], [4, ['Str']]);
}

console.log('companions -- readable from a formula, and only what was typed is saved');
{
  const c = new Character(load('angou'));
  c.set('eidolon.levelOverride', 20);
  const s = c.scope();
  check('familiar.hp and eidolon.hd read', [s.familiar.hp, s.eidolon.hd, s.eidolon.evoPool], [c.data.familiar.calc.hpMax, 15, 15]);
  check('the names validate', c.scopeNames().includes('animalCompanion.str.mod'), true);
  c.set('familiar.notes', 'Bites for {= familiar.attack}');
  check('prose on the tab resolves', c.renderProse(c.data.familiar.notes).some((seg) => seg.kind !== 'text' && seg.value === c.data.familiar.calc.totalAttack), true);
  c.companionDamage('eidolon', 30);
  check('damage comes off the current', c.data.eidolon.calc.hpCurrent, c.data.eidolon.calc.hpMax - 30);
  c.set('eidolon.hp.temp', 5);
  c.companionDamage('eidolon', 3);
  check('temporary points go first', [c.data.eidolon.hp.temp, c.data.eidolon.calc.hpCurrent], [2, c.data.eidolon.calc.hpMax - 30]);
  c.companionRest('eidolon');
  check('a rest clears both', [c.data.eidolon.hp.damage, c.data.eidolon.hp.temp], [0, 0]);
  const saved = JSON.parse(JSON.stringify(c.toJSON()));
  check('no derived numbers are saved', [saved.familiar.calc, saved.eidolon.calc, saved.familiar.skills[0].total, saved.familiar.skills[0].masterRanks], [undefined, undefined, undefined, undefined]);
  const back = new Character(saved);
  check('and they come back on load', [back.data.eidolon.calc.hd, back.data.familiar.skills[0].total], [15, c.data.familiar.skills[0].total]);
  // A document saved before a field existed gets the default for it.
  const old = new Character({ ...saved, eidolon: { name: 'Old', levelOverride: 3 } });
  check('an older eidolon block fills in', [old.data.eidolon.name, old.data.eidolon.calc.hd, old.data.eidolon.skills.length > 0, old.data.eidolon.goodSaves.fort], ['Old', 3, true, true]);
}

console.log('a tracker can read itself: self.* in notes and zone bounds');
{
  const c = new Character(load('angou'));
  const t = c.addTracker({
    name: 'Burn',
    maxFormula: '3 + con.mod',
    note: 'Nonlethal {= self.current * level}, +{= self.current} to DCs, {= self.remaining} left ({= self.pct}% full)',
  });
  const con = c.data.abilities.con.mod;
  const level = c.data.identity.level;
  const max = 3 + con;
  check('max as before', t.max, max);

  const read = (tr) => c.renderProse(tr.note, c.trackerScope(tr))
    .map((seg) => (seg.kind === 'text' ? seg.text : seg.error ? `!${seg.error}` : String(seg.value))).join('');
  check('note reads an empty pool', read(t), `Nonlethal 0, +0 to DCs, ${max} left (0% full)`);

  c.stepTracker('burn', 4);
  const t4 = c.trackers.find((x) => x.id === 'burn');
  check('and follows the pool as it fills', read(t4),
    `Nonlethal ${4 * level}, +4 to DCs, ${max - 4} left (${(4 / max) * 100}% full)`);

  // The same numbers character-wide, under the tracker's id.
  const sc = c.scope().tracker.burn;
  check('tracker.<id>.current', sc.current, 4);
  check('tracker.<id>.remaining', sc.remaining, max - 4);
  check('tracker.<id>.spent', sc.spent, 4);
  check('tracker.<id>.pct', sc.pct, (4 / max) * 100);
  check('scope names list them', ['current', 'max', 'min', 'remaining', 'spent', 'pct']
    .every((k) => c.scopeNames().includes(`tracker.burn.${k}`)), true);
  check('self is not published character-wide', c.scopeNames().some((n) => n.startsWith('self.')), false);

  // A zone bound may name the tracker itself.
  c.updateTracker('burn', { style: { zones: [{ from: 'floor(self.max * 0.7)', to: 'self.max', color: '#e0635f', label: 'lethal' }] } });
  const z = c.trackers.find((x) => x.id === 'burn');
  check('zone bound reads self.max', [z.resolvedZones[0].fromValue, z.resolvedZones[0].toValue], [Math.floor(max * 0.7), max]);
  check('no error', z.error, null);
  check('zone label is empty below the band', c.renderProse('{= self.zone}', c.trackerScope(z))[0].value, '');
  c.updateTracker('burn', { current: max });
  const zf = c.trackers.find((x) => x.id === 'burn');
  check('and named once inside it', c.renderProse('{= self.zone}', c.trackerScope(zf))[0].value, 'lethal');

  // A min may mirror the max without repeating it.
  const meter = c.addTracker({ name: 'Swing', maxFormula: '2 + wis.mod', minFormula: '-self.max' });
  const half = 2 + c.data.abilities.wis.mod;
  check('min mirrors max', [meter.min, meter.max], [-half, half]);
  check('no error', meter.error, null);

  // self is local: an ordinary formula cannot reach it.
  const stray = c.addTracker({ name: 'Stray', maxFormula: 'self.max + 1' });
  check('self is unavailable to the max formula', /self\.max/.test(stray.error || ''), true);

  // Notes are audited like every other player formula.
  const audit = c.audit();
  const notes = audit.filter((a) => a.id.startsWith('burn:note'));
  check('every note token is audited', notes.length, 4);
  check('a note token resolves', notes[0].value, max * level);
  check('and knows what it reads', notes[0].reads.sort(), ['level', 'self.current']);
  check('a zone bound reading self is not flagged unknown',
    audit.find((a) => a.id === 'burn:zone1:to')?.status, 'ok');

  // A broken note token is reported rather than thrown.
  c.updateTracker('burn', { note: 'x {= self.nope + 1}' });
  const bad = c.audit().find((a) => a.id === 'burn:note1');
  check('bad note token flagged', bad.status, 'error');
  check('the tracker itself still works', c.trackers.find((x) => x.id === 'burn').error, null);

  // The note survives a round trip, on a sheet-seeded tracker too.
  c.updateTracker('mythic_power', { note: '{= self.remaining} surges left' });
  const c2 = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('custom tracker note saved', c2.trackers.find((x) => x.id === 'burn').note, 'x {= self.nope + 1}');
  const mp2 = c2.trackers.find((x) => x.id === 'mythic_power');
  check('sheet tracker note saved as an override', mp2.note, '{= self.remaining} surges left');
  check('and reads correctly after reload', c2.renderProse(mp2.note, c2.trackerScope(mp2))[0].value, 23);
}

console.log('character colour');
{
  const c = new Character(load('angou'));
  check('none by default', c.data.identity.color ?? null, null);
  c.set('identity.color', '#6ea8fe');
  check('stored', c.data.identity.color, '#6ea8fe');
  const c2 = new Character(JSON.parse(JSON.stringify(c.toJSON())));
  check('survives a round trip', c2.data.identity.color, '#6ea8fe');
  check('and moves no derived number', c2.diffFromSource(), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
