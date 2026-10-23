/** Tests the Myth-Weavers export: a character as a backup file for the
 *  Myth-Weavers Pathfinder sheet (app/js/myth-weavers.js).
 *
 *  What matters is what that sheet does with the file: its sums over the parts
 *  of a total, its sort of the Spells & Powers rows, and the width of its
 *  cells. An invented character exercises the feat slots and the Spells &
 *  Powers codes; the fixture roster, public or private, is then swept for the
 *  same rules.
 *
 *  Run: node tests/myth-weavers.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character, blankClassRow } from '../app/js/model.js';
import { fixtureIds, loadCharacter } from './fixtures.mjs';
import { mythWeaversBackup, mwSkillName, textWidth, MW_CELLS, FEAT_COLUMNS } from '../app/js/myth-weavers.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const n = (f, k) => Number(f[k]) || 0;
const spellNames = (f) => Array.from({ length: 132 }, (_, i) => f[`Spell${String(i + 1).padStart(2, '0')}`]).filter(Boolean);

/** The rules every export keeps, checked the way the sheet would read it. */
function sweep(label, model) {
  const { fields: f, report } = mythWeaversBackup(model);
  const d = model.data;
  check(`${label}: every value is text`, Object.values(f).every((v) => typeof v === 'string'), true);
  // legacy_pathfinder's own formulas.
  const ac = 10 + ['ACArmor', 'ACShield', 'ACDex', 'ACSize', 'ACDodge', 'ACNat', 'ACDeflect', 'ACMisc'].reduce((a, k) => a + n(f, k), 0);
  const touch = 10 + ['ACDex', 'ACSize', 'ACDodge', 'ACDeflect', 'ACMisc'].reduce((a, k) => a + n(f, k), 0);
  const flat = 10 + Math.min(n(f, 'ACDex'), 0) + ['ACArmor', 'ACShield', 'ACSize', 'ACNat', 'ACDeflect', 'ACMisc'].reduce((a, k) => a + n(f, k), 0);
  check(`${label}: the AC parts give the app's AC, touch and flat-footed`, [ac, touch, flat],
    [d.defenses.ac, d.defenses.touch, d.defenses.flatFooted].map(Number));
  for (const s of ['Fort', 'Reflex', 'Will']) {
    if (!f[s]) continue;
    check(`${label}: ${s} parts add up`, ['Base', 'Ability', 'Magic', 'Misc'].reduce((a, p) => a + n(f, `${s}${p}`), 0), n(f, s));
  }
  const badSkills = [];
  for (let i = 1; i <= 51; i++) {
    const k = `Skill${String(i).padStart(2, '0')}`;
    if (!f[k]) continue;
    const sum = n(f, `${k}AbMod`) + n(f, `${k}Rank`) + n(f, `${k}MiscMod`) + n(f, `${k}ACP`) + (f[`${k}CC`] && n(f, `${k}Rank`) > 0 ? 3 : 0);
    if (sum !== n(f, `${k}Mod`)) badSkills.push(f[k]);
  }
  check(`${label}: every skill row adds up to its total`, badSkills, []);
  check(`${label}: Feat1-Feat10 are the slots f01 to f19`,
    Array.from({ length: 10 }, (_, i) => String(f[`Feat${i + 1}`]).slice(0, 3)), Array.from({ length: 10 }, (_, i) => `f${String(2 * i + 1).padStart(2, '0')}`));
  const rows = spellNames(f);
  check(`${label}: every Spells & Powers row is coded`,
    rows.filter((r) => !/^[A-Z]+(00 === .+ ===|(\d\d|\?\?)[a-z]?\+? .+)$/.test(r)), []);
  check(`${label}: a name sort on the sheet changes nothing`, [...rows].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), rows);
  check(`${label}: nothing is cut off in its cell`, report.clipped, []);
}

console.log('skills are spelled the way the sheet\'s Update CS reads them');
check('a short Knowledge', mwSkillName({ name: 'Kn. (arcana)', spec: null }), 'Knowledge (Arcana)');
check('a Knowledge the sheet does not list takes #', mwSkillName({ name: 'Kn. (martial)', spec: null }), '#Knowledge (Martial)');
check('a craft with its specialty', mwSkillName({ name: 'Craft', spec: 'Tattoos' }), 'Craft (Tattoos)');
check('a skill the sheet does not list takes #', mwSkillName({ name: 'Lore', spec: 'Mathematics' }), '#Lore (Mathematics)');
check('a core skill as it is', mwSkillName({ name: 'Sense Motive', spec: null }), 'Sense Motive');

console.log('\ntext widths follow the sheet\'s 9px Helvetica/Arial');
{
  // Measured in the sheet's 225px feat cell: 54 characters of this fit.
  const text = 'the quick brown fox jumps over the lazy dog and keeps on running';
  check('54 characters fit a feat cell', textWidth(text.slice(0, 54)) <= MW_CELLS.feat[0], true);
  check('55 do not', textWidth(text.slice(0, 55)) <= MW_CELLS.feat[0], false);
  check('the feat columns are 4 x 15 cells', FEAT_COLUMNS.map((c) => c.length), [15, 15, 15, 15]);
}

console.log('\nan invented character: feat slots, class columns and Spells & Powers codes');
{
  const doc = blankDocument({ name: 'Coded', level: 6 });
  doc.classes = [{ ...blankClassRow(), name: 'L. Samurai', archetypes: 'Ronin' }, { ...blankClassRow(), name: 'Kheshig' }];
  doc.feats = {
    'Level Up': [{ name: 'Power Attack', detail: '1' }, { name: 'Cleave', detail: '3' }, { name: 'Planned', detail: '7' }],
    Class: [{ name: 'Quick Draw', detail: 'Legendary Samurai (Sheath Control)' },
      { name: 'Vital Strike', detail: 'Legendary Samurai (Advanced Blade, 6)' },
      { name: 'Improved Vital Strike', detail: 'Legendary Samurai (Advanced Blade, 11)' }],
  };
  doc.training.combat.classes = [{ name: 'Kheshig', type: 'Expert', talentsPerLevel: 'Expert', mod1: 'Int', mod2: null,
    levels: [{ level: 1, talent: 'Fencing Sphere', sphere: 'Fencing' }, { level: 2, talent: 'Parry and Riposte', sphere: 'Fencing' },
      { level: 8, talent: 'Not yet', sphere: 'Fencing' }] }];
  doc.training.combat.tradition = { name: 'Legendary Samurai Tradition', entries: [{ talent: 'Bushido Training', sphere: 'Equipment' }] };
  doc.training.combat.bonusTalents = [
    { talent: 'Fast Feint', sphere: 'Fencing', source: 'Bonus Talents 2' },
    { talent: 'Unplaced', sphere: 'Fencing', source: null },
    { talent: 'Guardian Sphere', sphere: 'Guardian', source: 'Ronin (Guardian of the Weak)' },
  ];
  const c = new Character(doc);
  // The class features as the model keeps them, which is what the export reads.
  c.data.progression.classFeatures = {
    'L. Samurai': { columns: ['Features', 'Feature Selections'], byLevel: {
      1: { Features: 'Sheath Control, Studied Target (1)', 'Feature Selections': 'Veil: Deathgrip Gauntlets' },
      3: { Features: 'Studied Target (2)' }, 6: { Features: 'Advanced Blade' }, 7: { Features: 'Too late' } } },
    Kheshig: { columns: ['Features'], byLevel: { 1: { Features: 'Guardian of the Weak' } } },
  };
  c.data.akashic.slots = [{ slot: 'Hands', bound: true, twinveil: false, veils: [{ name: 'Deathgrip Gauntlets', desc: '', essence: 3, dc: 20 }] }];
  const { fields: f, report } = mythWeaversBackup(c, { publishedUrl: 'https://example.test/published.html?s=abc' });

  check('the level-up slots, reached and not', [1, 2, 3, 4, 10].map((i) => f[`Feat${i}`]), ['f01 Power Attack', 'f03 Cleave', 'f05', 'f07', 'f19']);
  check('a class block: heading, the later step of Studied Target, nothing past level 6, no veil pick',
    ['Feat22', 'Feat23', 'Feat24'].map((k) => f[k]), ['L. Samurai 6 (Ronin)', '1: Sheath Control, 3: Studied Target (2),', '6: Advanced Blade']);
  check('Spells & Powers by class and level', spellNames(f), [
    'K00 === Kheshig ===',
    'K01a Fencing Sphere',
    // Ronin is the samurai's archetype, but the feature it names is the Kheshig's.
    'K01b Guardian Sphere',
    'K02a Parry and Riposte',
    'K02b Fast Feint',
    'K?? Unplaced',
    'LS00 === Legendary Samurai ===',
    'LS01a Combat tradition: Legendary Samurai Tradition',
    'LS01b Bushido Training',
    'LS01c Quick Draw',
    'LS01d Deathgrip Gauntlets (Hands, bound, DC 20)',
    'LS06 Vital Strike',
  ]);
  check('the Cast column carries the sphere, the feat, the essence', ['Spell02Cast', 'Spell10Cast', 'Spell11Cast'].map((k) => f[k]), ['Fencing', 'Feat', '3 ess']);
  check('an entry with no recorded level is reported', report.noLevel, ['K?? Unplaced']);
  check('the share link goes in Other Notes', f.__txt_Notes.endsWith('Full sheet: https://example.test/published.html?s=abc'), true);
  check('with no link, no line for one', /Full sheet/.test(mythWeaversBackup(c).fields.__txt_Notes ?? ''), false);
  sweep('invented', c);
}

console.log('\nthe roster');
for (const id of fixtureIds()) sweep(id, new Character(loadCharacter(id)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
