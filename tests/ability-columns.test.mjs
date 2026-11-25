/** Bonus type columns a player adds to the Stats tab's two ability tables.
 *
 *  A column is a bonus type the tables have no column for (sacred, profane,
 *  a type of the player's own), with a cell per ability. This holds that the
 *  cells feed the scores and stack by type like every other bonus, that a
 *  forwarded bonus of the column's type settles against it and is shown in
 *  it, that the cells are formula boxes the Formulas tab lists, and that the
 *  columns survive a save, a reload and an import. It also holds that the
 *  built-in columns settle a forwarded bonus exactly as they did before the
 *  column types were read off the column lists.
 *
 *  Run: node tests/ability-columns.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character, FORMULA_FIELDS, auditSummary, inspectDocument } from '../app/js/model.js';
import { breakdown } from '../app/js/model/breakdown.js';
import { typedColumns } from '../app/js/model/scope.js';
import {
  ENHANCEMENT_CAP, abilityColumnChoices, abilityColumnName, abpPair, buildColumnsByType, resolveAbility, stackAt,
} from '../app/js/rules.js';
import { renderStatsPanel } from '../app/js/ui/panels/stats.js';
import { formulaPlace } from '../app/js/ui/formula-places.js';
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

const fresh = (level = 1) => new Character(blankDocument({ name: 'Columns', level, createdAt: '2026-01-01T00:00:00' }));
const reopen = (m) => new Character(JSON.parse(JSON.stringify(m.toJSON())));
const str = (m) => m.data.abilities.str;
/** Add a column and fill some cells: `cells` is `{ str: 2, ... }`. */
const column = (m, table, type, cells = {}) => {
  m.addAbilityColumn(table, type);
  const i = m.data.abilityColumns[table].length - 1;
  for (const [ab, v] of Object.entries(cells)) m.setItem(`abilityColumns.${table}`, i, ab, v);
  return i;
};
const prose = (m, text) => { m.data.formulaNotes = text; m.recompute(); };

console.log('the types on offer');
{
  const keys = (list) => list.map(([key]) => key);
  const perm = keys(abilityColumnChoices('permanent'));
  check('permanent leaves out the types it has a column for',
    ['racial', 'enhancement', 'inherent', 'size', 'untyped'].filter((k) => perm.includes(k)), []);
  check('no type that is never a bonus to a score',
    ['armor', 'shield', 'natural', 'deflection', 'dodge', 'resistance'].filter((k) => perm.includes(k)), []);
  check('the usual ones are there', ['sacred', 'profane', 'insight', 'luck', 'competence'].every((k) => perm.includes(k)), true);
  const temp = keys(abilityColumnChoices('temporary'));
  check('temporary leaves out its own five',
    ['alchemical', 'circumstance', 'morale', 'enhancement', 'size'].filter((k) => temp.includes(k)), []);
  check('temporary offers untyped', temp.includes('untyped'), true);
  check('a type already added is not offered again', keys(abilityColumnChoices('permanent', ['Sacred'])).includes('sacred'), false);
  check('choices are [key, name, short]', abilityColumnChoices('permanent').find(([k]) => k === 'sacred'), ['sacred', 'Sacred', 'Sacr']);
  check('a column is called by its type', [abilityColumnName({ type: 'Sacred' }), abilityColumnName({ type: 'Primordial' }),
    abilityColumnName({ type: '' })], ['Sacred', 'Primordial', 'Untyped']);
}

console.log('\nthe built-in columns settle a forwarded bonus as before');
{
  // The literal map typedColumns used before the column lists carried types.
  const OLD = {
    enhancement: null, 'temp.enhancement': 'tempEnhancement', size: 'size', 'temp.size': 'tempSize',
    inherent: 'inherent', racial: 'race', alchemical: 'alchemical', morale: 'morale',
  };
  const old = (b, key) => {
    const gear = Math.max(Number(b.gear) || 0, Number(b.resolved?.gearItems) || 0);
    const tempPair = abpPair(b.abp, Math.max(gear, Number(b.tempEnhancement) || 0), ENHANCEMENT_CAP);
    const out = {};
    for (const [type, col] of Object.entries(OLD)) {
      out[type] = type === 'temp.enhancement' ? tempPair : col ? Number(b[col]) || 0 : abpPair(b.abp, gear, ENHANCEMENT_CAP);
    }
    return key === 'score' ? out : { enhancement: tempPair };
  };
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  let checked = 0;
  let differs = 0;
  for (const id of fixtureIds()) {
    const m = new Character(loadCharacter(id));
    if (!m.data.statsBuild) continue;
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      for (const key of ['score', 'temp']) {
        checked++;
        if (JSON.stringify(sorted(typedColumns(m, `${ab}.${key}`))) !== JSON.stringify(sorted(old(m.data.statsBuild[ab], key)))) differs++;
      }
    }
  }
  check(`every fixture's columns by type are unchanged (${checked} checked)`, differs, 0);
  const b = { race: 2, abp: 2, gear: 3, inherent: 1, size: 4, untyped: 9, alchemical: 2, circumstance: 7, morale: 3, tempEnhancement: 5, tempSize: 2 };
  check('buildColumnsByType reads each table', buildColumnsByType(b), {
    permanent: { racial: 2, enhancement: abpPair(2, 3, ENHANCEMENT_CAP), inherent: 1, size: 4 },
    temporary: { alchemical: 2, morale: 3, enhancement: abpPair(2, 5, ENHANCEMENT_CAP), size: 2 },
  });
  check('stackAt: best of a type, against the column', stackAt([{ type: 'sacred', value: 2 }, { type: 'sacred', value: 4 }], { sacred: 3 }).total, 1);
  check('resolveAbility without columns saves nothing new', 'own' in resolveAbility({ pointBuy: 12 }), false);
}

console.log('\nthe cells add to the score by type');
{
  const m = fresh();
  check('a blank sheet has no columns', 'abilityColumns' in m.toJSON(), false);
  column(m, 'permanent', 'Sacred', { str: 2 });
  check('a sacred +2 raises Strength', str(m).score, 12);
  check('Total and the working score follow', [str(m).workingScore, m.data.statsBuild.str.resolved.own], [12, 2]);
  column(m, 'permanent', 'Profane', { str: 3 });
  check('profane stacks with sacred', str(m).score, 15);
  column(m, 'permanent', 'Sacred', { str: 4 });
  check('a second sacred column: only the larger counts', str(m).score, 17);
  column(m, 'permanent', 'Primordial', { str: 1, dex: -2 });
  check('a type of your own counts', str(m).score, 18);
  check('a negative cell is a penalty', m.data.abilities.dex.score, 8);
  column(m, 'permanent', '', { str: 1 });
  column(m, 'permanent', '', { str: 1 });
  check('untyped columns stack', str(m).score, 20);
}
{
  const m = fresh();
  m.data.statsBuild.str.gear = 4;
  m.recompute();
  column(m, 'permanent', 'Enhancement', { str: 5 });
  check('an added enhancement column does not stack with gear', str(m).score, 15);
  const t = fresh();
  column(t, 'temporary', 'Profane', { str: 4 });
  check('a temporary column moves only the working score', [str(t).score, str(t).workingScore, str(t).totalMod], [10, 14, 2]);
  check('it shows in Temp', renderStatsPanel(t, {}).includes('>+4</td>'), true);
}

console.log('\na cell is a formula box');
{
  const m = fresh(6);
  column(m, 'permanent', 'Sacred', { str: 'floor(level / 2)', dex: 'str.mod' });
  check('a formula reads the level', str(m).score, 13);
  m.data.identity.level = 10;
  m.recompute();
  check('and follows it', str(m).score, 15);
  const col = m.data.abilityColumns.permanent[0];
  check('a name built on the scores is refused', [col.resolved.dex, !!col.errors?.dex], [0, true]);
  const rows = FORMULA_FIELDS.find((f) => f.key === 'abilityCell').collect(m);
  check('the Formulas tab lists both', rows.map((r) => [r.name, r.place, r.value, !!r.error]),
    [['Str: Sacred', 'abilityCell:permanent:0:str', 5, false], ['Dex: Sacred', 'abilityCell:permanent:0:dex', 0, true]]);
  check('its place is the cell on the Stats tab', [formulaPlace(m, 'abilityCell:permanent:0:str')?.tab,
    formulaPlace(m, 'abilityCell:permanent:0:str')?.sel?.[0]], ['stats', '[data-item="abilityColumns.permanent|0|str"]']);
  const t = fresh(4);
  t.data.mythic = { ...(t.data.mythic || {}), tierOverride: 3 };
  t.recompute();
  column(t, 'temporary', 'Luck', { cha: 'mythic.tier' });
  check('a formula reads the mythic tier', t.data.abilityColumns.temporary[0].resolved.cha, t.data.identity.mythicTier);
}

console.log('\na forwarded bonus of the column\'s type');
{
  const m = fresh();
  column(m, 'permanent', 'Sacred', { str: 2 });
  prose(m, 'Blessed {str.sacred += 4}');
  check('{str.sacred += 4} over a sacred +2 adds 2', str(m).score, 14);
  const into = m.forwardedInto('str.score', 'permanent', { type: 'sacred' });
  check('it is shown in the column', [into?.total, into?.from?.[0]?.adds], [2, 2]);
  check('and not in Fwd', m.forwardedInto('str.score', 'permanent', { notTypes: ['sacred'] }), null);
  prose(m, 'Blessed {str.score += 1 as sacred}');
  check('one the column covers adds nothing', str(m).score, 12);
  prose(m, 'Blessed {str.luck += 2}');
  check('{str.luck += 2} with no luck column is a luck bonus in Fwd',
    [str(m).score, m.forwardedInto('str.score', 'permanent', { notTypes: ['sacred'] })?.from?.[0]?.type], [14, 'luck']);
  const html = renderStatsPanel(m, {});
  check('the Fwd badge leaves the column\'s type out', html.includes('&quot;notTypes&quot;:[&quot;sacred&quot;]'), true);
  prose(m, 'Blessed {str.primordial += 3}');
  check('a type with no column and no name is not a destination', m.contributions.errors.length, 1);
  column(m, 'permanent', 'Primordial', { str: 1 });
  check('a column of your own type is one', [m.contributions.errors.length, str(m).score], [0, 15]);
}
{
  const m = fresh();
  column(m, 'temporary', 'Profane', { str: 3 });
  prose(m, 'Rage {str.temp.profane += 5}');
  check('{str.temp.profane += 5} over a temporary profane +3', [str(m).score, str(m).workingScore], [10, 15]);
  check('it is shown in the column', m.forwardedInto('str.temp', '', { type: 'profane' })?.total, 2);
  prose(m, 'Rage {str.score += 6 as temp.profane}');
  check('{str.score += 6 as temp.profane} settles the same way', str(m).workingScore, 16);
  prose(m, 'Rage {str.profane += 2}');
  // As a permanent morale bonus meets the temporary Morale column: the
  // permanent table has no profane column, so the two are one type.
  check('a permanent profane bonus does not stack with the temporary profane column', [str(m).score, str(m).workingScore], [10, 13]);
  column(m, 'permanent', 'Profane', { str: 1 });
  check('with a permanent profane column as well, the tables are apart, as the two Size columns are',
    [str(m).score, str(m).workingScore], [12, 15]);
}

console.log('\nrename, remove, undo');
{
  const m = fresh();
  column(m, 'permanent', 'Sacred', { str: 2, wis: 4 });
  m.setItem('abilityColumns.permanent', 0, 'type', 'Profane');
  check('renaming keeps the cells', [str(m).score, m.data.abilities.wis.score, abilityColumnName(m.data.abilityColumns.permanent[0])],
    [12, 14, 'Profane']);
  m.setItem('abilityColumns.permanent', 0, 'type', 'Custom');
  m.setItem('abilityColumns.permanent', 0, 'type', 'Abyssal');
  check('a name of your own', abilityColumnName(m.data.abilityColumns.permanent[0]), 'Abyssal');
  m.removeAbilityColumn('permanent', 0);
  check('removing takes the cells with it', [str(m).score, m.data.abilities.wis.score, 'abilityColumns' in m.data], [10, 10, false]);
  m.undo();
  check('undo puts it back', [str(m).score, m.data.abilityColumns?.permanent?.[0]?.type], [12, 'Abyssal']);
  check('a sheet with no Stats tab takes none', new Character({ ...blankDocument({ name: 'x' }), statsBuild: undefined }).addAbilityColumn('permanent', 'Sacred'), null);
}

console.log('\nsave, reload, import');
{
  const m = fresh(8);
  column(m, 'permanent', 'Sacred', { str: 2, cha: 'floor(level / 4)' });
  column(m, 'temporary', 'Insight', { int: 3 });
  prose(m, '{str.sacred += 4} {int.temp.insight += 1}');
  const saved = JSON.parse(JSON.stringify(m.toJSON()));
  check('the columns are saved', saved.abilityColumns.permanent.map((c) => [c.type, c.str, c.cha]), [['Sacred', 2, 'floor(level / 4)']]);
  check('an import accepts it', inspectDocument(structuredClone(saved)).ok, true);
  const again = reopen(m);
  const figures = (x) => ['str', 'int', 'cha'].map((ab) => [x.data.abilities[ab].score, x.data.abilities[ab].workingScore]);
  check('reloaded, every figure is the same', figures(again), figures(m));
  let x = again;
  for (let i = 0; i < 4; i++) x = reopen(x);
  check('five reloads change nothing', JSON.stringify(x.toJSON()), JSON.stringify(again.toJSON()));
  const summary = auditSummary(saved);
  check('the change audit names the cells', [summary.get?.('build.str.permanent.0')?.label ?? summary['build.str.permanent.0']?.label],
    ['Str sacred']);
}

console.log('\nthe panel');
{
  const m = fresh();
  column(m, 'permanent', 'Sacred', { str: 2 });
  column(m, 'temporary', 'Custom');
  prose(m, '{str.sacred += 4}');
  const html = renderStatsPanel(m, {});
  check('both tables offer + Bonus type', (html.match(/data-abcol-add="(permanent|temporary)"/g) || []).length, 2);
  check('the header picks the type', html.includes('<select data-item="abilityColumns.permanent|0|type"'), true);
  check('a type of your own is a text box', html.includes('class="owntype" value="Custom" data-item="abilityColumns.temporary|0|type"'), true);
  check('each cell is a formula box, not a number box',
    [html.includes('data-item="abilityColumns.permanent|0|str"'), /type="number"[^>]*abilityColumns/.test(html)], [true, false]);
  check('each column has its ×', (html.match(/data-action="remove-ability-column"/g) || []).length, 2);
  check('the forwarded sacred bonus is in the column',
    /data-item="abilityColumns\.permanent\|0\|str"[\s\S]*?<\/span>\s*<span class="fwd" data-fwd="str\.score"/.test(html), true);
  const addPicker = /<select[^>]*data-abcol-add="permanent"[\s\S]*?<\/select>/.exec(html)[0];
  check('the add picker leaves out a type already added', addPicker.includes('value="Sacred"'), false);
  check('the add picker and the header open as search lists, as a gear row’s type does',
    [/^<select data-search="own" class="addcol"/.test(addPicker), /<select data-item="abilityColumns\.permanent\|0\|type"[^>]*data-search="own"/.test(html)],
    [true, true]);
  check('the add picker shows its prompt, which is not a choice, and ends in Custom…',
    [addPicker.includes('<option value="" disabled selected>+ Bonus type</option>'), /<option value="Custom"[^>]*>Custom…<\/option><\/select>$/.test(addPicker)],
    [true, true]);
  check('its choices are short names with the whole name as the title, as on a gear row',
    addPicker.includes('<option value="Profane" title="Profane">Prof</option>'), true);
  const typed = m.addAbilityColumn('permanent', 'Fury');
  check('a name typed in the search list adds a column of that name', [typed?.type, abilityColumnName(typed)], ['Fury', 'Fury']);
  check('its header is the name of your own', renderStatsPanel(m, {}).includes('class="owntype" value="Fury" data-item="abilityColumns.permanent|1|type"'), true);
  const lines = breakdown(m, 'str').parts || breakdown(m, 'str');
  const sacred = (Array.isArray(lines) ? lines : []).find((p) => p.label === 'Sacred');
  check('the breakdown has a line for it', [sacred?.value, sacred?.place], [2, 'abilityCell:permanent:0:str']);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
