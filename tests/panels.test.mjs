/** Renders every panel module for every character, and fails if one throws.
 *
 *  This is the cheapest possible check on `app/js/ui/panels/*`, and it exists
 *  because the alternative was nothing: the panels are string builders that
 *  take `(model, ctx)` and touch no DOM at all, so Node can run them, and
 *  until this file none of the suites did. What that cost, once: a helper in
 *  `ui/prose.js` that shadowed the module function it meant to call recursed
 *  until the stack gave out, every panel holding a `{…}` formula threw on
 *  render, and because `#render()` builds the whole shadow root in one go, the
 *  tab simply stopped opening. No error reached the page. This suite fails in
 *  five lines of output instead.
 *
 *  It checks that a panel renders, not that it renders *correctly* — that
 *  still wants `tools/panel-snapshot.js` in a browser. Every tab's panel is a
 *  module now; the ⚙ manager's tab lists are the element's to work out, so it
 *  is drawn here with empty ones.
 *
 *  Every character is swept four times: folds shut and folds open, in each of
 *  the two view modes. The open pass is not thoroughness for its own sake — a
 *  branch that runs only while something is expanded is invisible to the shut
 *  one, which is how `ctx.dashArrangePanel()` reached players and took the
 *  whole Overview down for anyone who clicked *Arrange cards*.
 *
 *  Runs everywhere: the roster it sweeps is the private one when it is there
 *  and the committed public fixture otherwise, plus a blank sheet and a
 *  character with a formula in every kind of prose field, built here.
 *
 *  Run: node tests/panels.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { hasFixtures, fixtureIds, loadCharacter } from './fixtures.mjs';
import * as overview from '../app/js/ui/panels/overview.js';
import * as combat from '../app/js/ui/panels/combat.js';
import * as guile from '../app/js/ui/panels/guile.js';
import * as subsystems from '../app/js/ui/panels/subsystems.js';
import * as lore from '../app/js/ui/panels/lore.js';
import * as admin from '../app/js/ui/panels/admin.js';
import * as gear from '../app/js/ui/panels/gear.js';
import * as trackers from '../app/js/ui/panels/trackers.js';
import * as feats from '../app/js/ui/panels/feats.js';
import * as techniques from '../app/js/ui/panels/techniques.js';
import * as manager from '../app/js/ui/panels/manager.js';
import { renderStatsPanel } from '../app/js/ui/panels/stats.js';
import { renderSkillsPanel, skillRowIndices } from '../app/js/ui/panels/skills.js';
import { prose, foldedProse, renderedProse } from '../app/js/ui/prose.js';
import * as statBlock from '../app/js/monster/panel.js';
import { blankDraft, blankTrackerDraft, blankView } from '../app/js/ui/view-state.js';
import { foldValue } from '../app/js/ui/folds.js';

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

/**
 * The view a sheet opens on -- every fold shut, nothing armed, nothing typed --
 * from ui/view-state.js, which is where the element gets its own. The ⚙
 * manager's tab lists are the element's to work out, so they are drawn empty.
 */
const shutCtx = () => ({ ...blankView(), tabEntries: [], barEntries: [] });

/**
 * The same state with every fold open, which is the half the shut sweep can
 * never reach: a branch that only runs while something is expanded renders on
 * nobody's first look at the tab, so a mistake in one ships. That is exactly
 * what happened to the dashboard's card arranger -- `ctx.dashArrangePanel()`
 * for a function that was never on the ctx -- and the tab would not draw at
 * all for anyone who clicked Arrange cards.
 *
 * The lookups are answered rather than populated: a `has()` that always says
 * yes forces every branch keyed on one open without this file having to know
 * the table names, post ids and tracker ids each panel invents. The keys
 * matched with `===` do have to be real, so they are read off the character.
 */
const openCtx = (model) => {
  const d = model.data;
  const yes = { has: () => true, get: () => true, size: 1 };
  const disc = (d.maneuvers?.disciplines || [])[0];
  const firstManeuver = (disc?.entries || [])[0];
  return {
    ...shutCtx(),
    condPickerOpen: true,
    dashArrange: true,
    draft: { ...blankDraft(), newSystem: 'New' },
    openBuff: (d.buffs || []).length ? 0 : null,
    openClassSystems: (d.classes || []).length ? 0 : null,
    showCells: yes,
    openPosts: yes,
    showAllGear: true,
    openGear: (d.equipment?.gear || []).length ? 'equipment.gear|0' : null,
    deckView: 'deck',
    maneuverEdit: true,
    openManeuver: firstManeuver ? `maneuvers.disciplines.0|${firstManeuver.name}` : null,
    veilEdit: (d.akashic?.slots?.[0]?.veils || []).length ? 'akashic.slots.0.veils|0' : null,
    // The element sets these two together, so the harness does too: an
    // editor open on a tracker with no draft behind it is a state the sheet
    // cannot be in, and failing on it would be the test's fault.
    editDraft: blankTrackerDraft(),
    editMeter: 'hp',
    editTracker: (d.customTrackers || [])[0]?.id ?? null,
    openText: yes,
    formulaDraft: '{= 1 + 1}',
    formulaQuery: 'a',
    formulaValueQuery: 'mod',
    formulaTargetQuery: 'will',
    formulaRefOpen: true,
    tab: 'audit',
    showAllSkills: true,
    openCell: 'mythic:0:effect',
    armedRemove: (d.sheetTabs || []).length ? 'systab|0' : null,
    extSearch: 'a',
  };
};

/** Every panel that is a module, by the name its tab wears. */
const panelsWith = (CTX) => [
  ['Overview', (m) => overview.renderOverviewPanel(m, CTX)],
  ['Overview (session dashboard)', (m) => overview.renderDashboardPanel(m, CTX)],
  ['Stats', (m) => renderStatsPanel(m, CTX)],
  ['Skills', (m) => renderSkillsPanel(m, CTX)],
  ['Martial Spheres', (m) => combat.renderMartialPanel(m)],
  ['Magic Spheres', (m) => combat.renderMagicPanel(m)],
  ['Guile Spheres', (m) => guile.renderGuilePanel(m)],
  ['Template', (m) => combat.renderTemplatePanel(m, CTX)],
  ['Equipment', (m) => gear.renderGearPanel(m, CTX)],
  ['Crafting', (m) => gear.renderCraftingPanel(m, CTX)],
  ['Wealth', (m) => gear.wealthPanel(m, CTX)],
  ['Trackers', (m) => trackers.renderTrackersPanel(m, CTX)],
  ['Alternate Training', (m) => subsystems.altTrainingPanel(m)],
  ['Akashic', (m) => subsystems.akashicPanel(m, CTX)],
  ['Maneuvers', (m) => subsystems.maneuversPanel(m, CTX)],
  ['Vancian', (m) => subsystems.vancianPanel(m)],
  ['Psionics', (m) => subsystems.psionicsPanel(m, CTX)],
  ['Cardcasting', (m) => subsystems.cardcastingPanel(m, CTX)],
  ['Familiar', (m) => subsystems.companionPanel(m, 'familiar')],
  ['Animal Companion', (m) => subsystems.companionPanel(m, 'animalCompanion')],
  ['Eidolon', (m) => subsystems.companionPanel(m, 'eidolon')],
  ['Conjured Companion', (m) => subsystems.companionPanel(m, 'conjured')],
  ['Progression', (m) => lore.renderProgressionPanel(m, CTX)],
  ['Lore', (m) => lore.renderLorePanel(m, CTX)],
  ['Extras & Notes', (m) => lore.renderExtrasPanel(m, CTX)],
  ['Formulas', (m) => admin.renderFormulaPanel(m, CTX)],
  ['Formula Audit', (m) => admin.renderAuditPanel(m, CTX)],
  ['Feats & Mythic', (m) => feats.renderFeaturesPanel(m, CTX)],
  ['Technique List', (m) => techniques.renderTechniqueListPanel(m, CTX)],
  ['AutoTechnique', (m) => techniques.renderAutoTechniquePanel(m, CTX)],
  ['Auto-Cooking', (m) => techniques.renderCookingPanel(m, CTX)],
  ['⚙ manager', (m) => manager.renderSystemManagerPanel(m, CTX)],
  ['Stat Block', (m) => statBlock.renderStatBlockPanel(m, CTX)],
];

const CTX = shutCtx();
const PANELS = panelsWith(CTX);

/** Render one panel, reporting a throw as the failure it is on the page. */
function renders(who, name, draw, model) {
  let html = null;
  try {
    html = draw(model);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${who} — ${name} threw ${err.constructor.name}: ${err.message.slice(0, 90)}`);
    return null;
  }
  if (typeof html !== 'string') {
    fail++;
    console.log(`  FAIL ${who} — ${name} returned ${typeof html}, not markup`);
    return null;
  }
  // Every gold badge is forwardedBadge's, which is what makes it open the
  // hover panel; one written by hand has the class and not the names.
  if (/<span class="fwd[^"]*"(?! data-fwd=)/.test(html)) {
    fail++;
    console.log(`  FAIL ${who} — ${name} draws a forwarded-bonus badge by hand`);
    return html;
  }
  // Every control that only changes how the sheet is read says so with
  // data-view, which is what a published sheet keeps working; one without it
  // is disabled for every reader. These attributes are view controls by what
  // they do, so each must carry it.
  const viewless = (html.match(/<button[^>]*>/g) || []).filter((b) => !/sdata-view[s=>]/.test(b)
    && /sdata-(?:collapse|tab|gearopen|mopen|mclose|textopen|deck-view|copy|cfpeek|foldcell|ladderfocus|buildcol|veilcols|cells)=/.test(b));
  if (viewless.length) {
    fail++;
    console.log(`  FAIL ${who} — ${name} has a view control a reader would lose: ${viewless[0].slice(0, 120)}`);
    return html;
  }
  // A list dropped into a template without `.join('')` comes out with a
  // comma between every item, and in a grid each comma takes a cell of its
  // own -- the conjured companion's ability increases sat in a grid half
  // made of commas. Two shapes are that and nothing else: a comma hard up
  // against both tags, and a comma that starts a line of its own. Prose's
  // comma follows its word and is followed by a space or a line break.
  const stray = /<\/[a-z0-9]+>(?:,<|\s*\n\s*,\s*<)/i.exec(html);
  if (stray) {
    fail++;
    console.log(`  FAIL ${who} — ${name} has a stray comma between tags (a list not joined): `
      + `${html.slice(Math.max(0, stray.index - 80), stray.index + 40).replace(/\s+/g, ' ')}`);
    return html;
  }
  // Every × is rows.removeControl's, which names what it takes; a remove
  // button that says nothing to a screen reader was written by hand.
  const bare = (html.match(/<button[^>]*\sdata-remove(?:-armed)?="[^"]*"[^>]*>/g) || [])
    .filter((b) => !/aria-label="Remove/.test(b));
  if (bare.length) {
    fail++;
    console.log(`  FAIL ${who} — ${name} draws a × by hand: ${bare[0].slice(0, 120)}`);
    return html;
  }
  pass++;
  return html;
}

const sweep = (who, model) => {
  for (const [name, draw] of PANELS) renders(who, name, draw, model);
  // Again with every fold open, which is where a branch can hide.
  for (const [name, draw] of panelsWith(openCtx(model))) {
    renders(`${who} (folds open)`, name, draw, model);
  }
  // The session view puts different panels up; the tab bar is the element's,
  // but which panels the model offers is not.
  model.setViewMode('session');
  for (const [name, draw] of PANELS) renders(`${who} (session view)`, name, draw, model);
  for (const [name, draw] of panelsWith(openCtx(model))) {
    renders(`${who} (session view, folds open)`, name, draw, model);
  }
  model.setViewMode('build');

  /*
   * And once with every panel fold *shut*, which is a different branch again
   * and until now an untested one. `collapsible()` keeps a collapsed panel's
   * header by regex-matching its own <h3>, and falls back to a bare button
   * when it finds none -- so a panel whose header is not shaped the way it
   * expects loses its whole body the moment somebody folds it, silently.
   *
   * The state lives in uiPrefs rather than in ctx, and the keys are strings
   * chosen panel by panel, so there is no list of them to iterate. A `get`
   * that answers "folded" for every key folds all of them at once without
   * needing one -- which is `true` for most keys and `false` for the few
   * that store *open* (ui/folds.js), or those few would be opened instead.
   */
  const realCollapsed = model.data.uiPrefs.collapsed;
  model.data.uiPrefs.collapsed = new Proxy({}, { get: (_, key) => foldValue(String(key), false) });
  for (const [name, draw] of PANELS) {
    const html = renders(`${who} (folds shut)`, name, draw, model);
    // A fold that ate its own header is the failure this is here to catch.
    if (html && html.includes('class="panel') && !/<h[34]/.test(html) && html.length > 40) {
      fail++;
      console.log(`  FAIL ${who} — ${name} collapsed to a body with no heading`);
    }
  }
  model.data.uiPrefs.collapsed = realCollapsed;
};

console.log('a blank sheet draws every panel');
sweep('a blank sheet', new Character(blankDocument('panels-test')));

console.log('a casting companion draws its pool and its tradition');
{
  // The blank sweep's conjured companion casts nothing, and the Casting panel
  // -- the pool's line, the tradition's lists -- is a branch of its own.
  const m = new Character(blankDocument('casting-panels-test'));
  m.set('conjured.0.levelOverride', 9);
  m.set('conjured.0.baseForm', 'Orb');
  m.set('conjured.0.archetypes.mage', true);
  m.set('conjured.0.tradition.name', 'Fey Magic');
  m.listAdd('conjured.0.tradition.drawbacks', 'Verbal Casting');
  m.listAdd('conjured.0.tradition.boons', 'Easy Focus {conjured.cha.score += 2}');
  const html = renders('a casting companion', 'Conjured Companion', (x) => subsystems.companionPanel(x, 'conjured'), m);
  for (const [what, needle] of [['its pool', 'data-pool-step="tracker:conjured_spell_points"'],
    ['its tradition', 'value="Fey Magic"'], ['a drawback', 'conjured.0.tradition.drawbacks|0|self'],
    ['a boon', 'conjured.0.tradition.boons|0|self'],
    // 9th level is 7 dice: four feat slots, open, and labelled by Hit Die.
    ['its last open feat slot', 'data-item="conjured.0.feats|3|name"'], ['a slot’s Hit Die', 'placeholder="7 HD"'],
    ['the bonus feats box', 'data-set="conjured.0.bonusFeats"']]) {
    if (html && !html.includes(needle)) {
      fail++;
      console.log(`  FAIL a casting companion — the Casting panel does not draw ${what}`);
    } else pass++;
  }
}

console.log('a conjured companion\'s talents are drawn in two groups');
{
  // One list, two panels: Form and Type talents, and Other Conjuration
  // Talents (the rows marked `group: 'other'`). Each row keeps its place in
  // the list, which is what its fields and its × are bound to.
  const m = new Character(blankDocument('talent-groups-test'));
  m.listAdd('conjured.0.talents', { source: '(form)', name: 'Glass Hide', notes: '' });
  m.listAdd('conjured.0.talents', { source: 'Conjuration', name: 'Spark Bond', notes: '', group: 'other' });
  m.listAdd('conjured.0.talents', { source: '(type)', name: 'Ember Kin', notes: '' });
  const html = renders('talent groups', 'Conjured Companion', (x) => subsystems.companionPanel(x, 'conjured'), m) || '';
  const section = (heading) => {
    const at = html.indexOf(`<h3>${heading} `);
    return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
  };
  const shape = section('Form and Type talents');
  const other = section('Other Conjuration Talents');
  const row = (i) => `data-item="conjured.0.talents|${i}|name"`;
  for (const [what, ok] of [
    ['the (form) and (type) rows under Form and Type talents, at their places in the list',
      shape.includes(row(0)) && shape.includes(row(2)) && !shape.includes(row(1))],
    ['the other row under Other Conjuration Talents, at its place in the list',
      other.includes(row(1)) && !other.includes(row(0)) && !other.includes(row(2))],
    ['each group\'s count', shape.includes('2 shaping this companion') && other.includes('1 taken')],
    ['Add under Other Conjuration Talents adds an other talent', other.includes('&quot;group&quot;:&quot;other&quot;')],
    ['Add under Form and Type talents adds one with no group', shape.includes('data-add="conjured.0.talents"')
      && !shape.includes('&quot;group&quot;')],
  ]) {
    if (!ok) {
      fail++;
      console.log(`  FAIL talent groups — ${what}`);
    } else pass++;
  }
}

console.log('a tradition\'s boons are split in a table of their own');
{
  // Each split is a steps box with what it comes to beside it. It used to
  // borrow the talent ladder's fixed columns, which squeezed the boxes into
  // a column sized for an icon button.
  const m = new Character(blankDocument('boon-split-test'));
  for (const d of ['Verbal Casting', 'Somatic Casting', 'Focus Casting']) m.listAdd('training.magic.tradition.drawbacks', d);
  const html = renders('boon split', 'Magic Spheres', (x) => combat.renderMagicPanel(x), m) || '';
  const table = html.slice(html.indexOf('<table class="build compact boonsplit">'), html.indexOf('</table>', html.indexOf('boonsplit')));
  for (const [what, ok] of [
    ['its own table, not the talent ladder\'s', table.length > 0 && !html.includes('talents pools')],
    ['a steps box beside what it comes to, for spell points and for essence',
      /<td class="steps"><input[^>]*\|sp\|[\s\S]*?<\/td>\s*<td class="gives total">/.test(table)
      && /<td class="steps"><input[^>]*\|essence\|[\s\S]*?<\/td>\s*<td class="gives total">/.test(table)],
  ]) {
    if (!ok) {
      fail++;
      console.log(`  FAIL boon split — ${what}`);
    } else pass++;
  }
}

console.log('a minionmancer\'s tab draws its chips and the companion selected');
{
  // Two of a kind: the sweep above only ever sees one, and the chip strip,
  // the id badge and the uiPrefs-selected second block are all branches of
  // their own.
  const m = new Character(blankDocument('minion-panels-test'));
  m.addCompanion('eidolon');
  m.set('eidolon.0.name', 'Alpha');
  m.set('eidolon.1.name', 'Brutus');
  m.set('eidolon.1.levelOverride', 5);
  const first = renders('a minionmancer', 'Eidolon (first selected)',
    (x) => subsystems.companionPanel(x, 'eidolon'), m);
  if (first && !(first.includes('Alpha') && first.includes('Brutus') && first.includes('companion-select'))) {
    fail++;
    console.log('  FAIL a minionmancer — the chip strip is missing a companion');
  }
  m.data.uiPrefs.activeCompanion = { eidolon: 1 };
  const second = renders('a minionmancer', 'Eidolon (second selected)',
    (x) => subsystems.companionPanel(x, 'eidolon'), m);
  if (second && !(second.includes('>eidolon2<') && second.includes('eidolon.1.name') && !second.includes('companion.'))) {
    fail++;
    console.log('  FAIL a minionmancer — the second companion does not draw under its own names');
  }
}

/**
 * A formula in every shape of prose field there is.
 *
 * This is the case the outage was made of: plain text rendered, `{…}` did not,
 * and each of these lands in a different panel.
 */
function formulaCharacter() {
  const model = new Character(blankDocument('prose-test'));
  const d = model.data;
  d.identity.name = 'Tokens Everywhere';
  d.identity.level = 6;
  d.classes[0] = { ...d.classes[0], name: 'Incanter', hd: 6, gestaltLevels: 6 };
  d.customTrackers = [{
    id: 'qi', name: 'Qi', max: 8, min: 0, current: 4, refresh: 'Daily',
    note: 'spend {= 1 + wis.mod} a round', style: null, maxFormula: '8', minFormula: null,
  }];
  d.notes = [{ title: 'Notes', body: 'carries {= level * 2} of them' }];
  d.backgroundSections = [{ label: 'History', text: 'walked {= level * 10} miles' }];
  d.skills[0].situational = '{= 2 + level} while running';
  d.equipment.weapons[0] = {
    ...d.equipment.weapons[0], name: 'Glaive', dice: '1d10',
    special: 'reach {= 5 + level} ft.',
  };
  d.featGroups = [{ name: 'Level Up', entries: [{ name: 'Toughness', detail: '{= level} hp' }] }];
  d.progression.classFeatures.General = {
    columns: ['Special'],
    byLevel: { 1: { Special: 'heals {= 2 + level}d8' } },
    rules: {},
    optionsFrom: {},
    notes: [{ name: 'Ki pool', type: 'Su', text: 'holds {= wis.mod + level} points' }],
  };
  d.effects = [{ name: 'Aura', text: 'allies gain {= level} temporary hit points', on: true }];
  model.recompute();
  return model;
}

console.log('and so does a character with a formula in every kind of prose field');
const tokens = formulaCharacter();
sweep('formulas everywhere', tokens);

console.log('the prose fields themselves, which is where this broke');
// A token of each kind, since each takes a different branch of renderedProse.
const proseModel = formulaCharacter();
for (const [what, text] of [
  ['a value', 'heals {= 2 + 3}d8'],
  ['a definition', 'pool of {qi.max = 4 + wis.mod}'],
  ['a forwarded bonus', 'grants {bluff += 2}'],
  ['a broken formula', 'bad {= nope + 1}'],
  ['no tokens at all', 'just words'],
]) {
  let html = null;
  try {
    html = renderedProse(proseModel, text);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${what} threw ${err.constructor.name}: ${err.message.slice(0, 60)}`);
    continue;
  }
  pass++;
  check(`${what} renders something`, html.length > 0, true);
}
// The tooltip is the part the shadowed helper was reaching for, so its
// absence is what the stack overflow would have looked like if it had failed
// quietly instead: check the working is really in there. Guarded like the
// panels above, so a throw is one line of failure rather than a dead suite.
const drew = (label, draw) => {
  try {
    return draw();
  } catch (err) {
    fail++;
    console.log(`  FAIL ${label} threw ${err.constructor.name}: ${err.message.slice(0, 60)}`);
    return '';
  }
};
const withTitle = drew('a value token', () => renderedProse(proseModel, 'heals {= 2 + 3}d8'));
ok('a token shows its value', withTitle.includes('>5<'));
ok('and its working on the tooltip', withTitle.includes('2 + 3'));
ok('a field wraps both layers',
  drew('a prose field', () => prose(proseModel, 'data-item="x|0|y"', 'heals {= 1 + 1}')).includes('prose-view'));
ok('a folded cell computes its peek',
  drew('a folded cell', () => foldedProse(proseModel, { openCell: null }, 'k', 'data-item="x|0|y"', '{= 1 + 1} hits')).includes('class="tok'));

console.log('\nthe unarmed practitioner table folds, and the shared increases do not go with it');
{
  // A default fold is not the same as a stored one: the practitioner table
  // starts folded once a class progression is live, but a click still has to
  // open it -- which it would not if the handler toggled storage rather than
  // what is on screen (`!undefined` is `true`, so the first click would store
  // the fold it was already showing and nothing would move).
  const KEY = 'unarmed-practitioner';
  const c = new Character(blankDocument('Fold Test'));
  // No weapon reads the unarmed dice, so there is nothing unarmed to show.
  ok('without a 🥊 weapon the unarmed setup is not there at all',
    !/unarmed-setup|usesBoxing/.test(gear.renderGearPanel(c, {})));
  // One that does carries the setup in its card, folded, the dice on its line.
  c.listAdd('equipment.weapons', { name: 'Fist', useUnarmedDice: true });
  c.listAdd('equipment.weapons', { name: 'Kick', useUnarmedDice: true });
  const shut = gear.renderGearPanel(c, {});
  ok('a 🥊 weapon brings it, folded, with the dice still showing',
    /data-collapse="unarmed-setup"/.test(shut) && !/usesBoxing/.test(shut) && /class="unarmed-dice">1d3</.test(shut));
  ok('and a second one points at the first rather than repeating it',
    shut.match(/data-collapse="unarmed-setup"/g).length === 1 && /worked out under\s+Fist/.test(shut));
  c.data.uiPrefs.collapsed['unarmed-setup'] = false;
  const seen = () => {
    const html = gear.renderGearPanel(c, {});
    const sub = html.slice(html.indexOf('Practitioner table'));
    return {
      // Its own fold's button: the weapon card around it has folds of its own.
      folded: sub.match(/aria-expanded="(\w+)"/)?.[1] === 'false',
      expanded: sub.match(/aria-expanded="(\w+)"/)?.[1],
      controls: /usesBoxing/.test(html),
      shared: /sizeIncreases/.test(html),
    };
  };
  // What the click handler in sheet-element.js does, in one line.
  const click = () => { c.data.uiPrefs.collapsed[KEY] = seen().expanded === 'true'; };

  ok('the practitioner table is open while it is what the character uses', !seen().folded && seen().controls);
  c.set('training.combat.unarmed.nativeProgression', true);
  ok('a class progression folds it by default', seen().folded && !seen().controls);
  ok('but the step and size increases stay reachable', seen().shared);
  click();
  ok('the first click opens it rather than doing nothing', !seen().folded && seen().controls);
  click();
  ok('and the second folds it again', seen().folded);
  c.set('training.combat.unarmed.nativeProgression', false);
  ok('a fold asked for by hand outranks the default', seen().folded);
  ok('the shared increases were never inside the fold', seen().shared);
}

console.log('\nthe gear table: three cells a bonus, and the card grows with its description');
{
  const c = new Character(blankDocument('Gear Test'));
  c.setItem('equipment.gear', 0, 'name', 'Ring of protection');
  c.setItem('equipment.gear', 0, 'bonuses.0.value', 'floor(level / 4) + 1');
  c.setItem('equipment.gear', 0, 'bonuses.0.type', 'Deflection');
  c.setItem('equipment.gear', 0, 'bonuses.0.target', 'ac.total');
  c.setItem('equipment.gear', 0, 'bonuses.1.value', 1);
  c.setItem('equipment.gear', 0, 'bonuses.1.target', 'nowhere.at.all');
  const html = gear.renderGearPanel(c, { showAllGear: false });
  const at = html.indexOf('<table class="gear');
  const head = html.slice(at, html.indexOf('<tbody>', at));
  ok('the header reads B1, Type, To for each bonus', (head.match(/>To</g) || []).length === 3 && /B1<\/th>/.test(head));
  ok('the amount is a formula field showing what it came to',
    /data-item="equipment\.gear\|0\|bonuses\.0\.value" data-kind="expr-or-null"/.test(html)
      && /class="xf-view"[^>]*>1</.test(html));
  ok('the type picker shows the short form and keeps the whole name',
    /<option value="Deflection" title="Deflection"[^>]*selected>Defl</.test(html));
  const to = html.match(/<select class="target"[^>]*bonuses\.0\.target[\s\S]*?<\/select>/)?.[0] || '';
  ok('the To cell is a grouped picker showing plain names',
    /<optgroup label="Armour class">/.test(to) && /<option value="ac\.total" selected title="ac\.total">AC</.test(to)
      && /<optgroup label="Skills">[\s\S]*<option value="skill\.bluff"[^>]*>Bluff</.test(to));
  ok('the working scores stay off it', !/dex\.temp/.test(to));
  const bad = html.match(/<select class="target invalid"[^>]*bonuses\.1\.target[\s\S]*?<\/select>/)?.[0] || '';
  ok('a destination the sheet cannot place is marked on its cell, and kept',
    /is not something a bonus can be forwarded to/.test(bad) && /<option value="nowhere\.at\.all" selected>nowhere\.at\.all \*</.test(bad));

  const open = gear.renderGearPanel(c, { showAllGear: false, openGear: 'equipment.gear|0' });
  ok('the open card lists the bonuses as rows of amount, type, To', /<table class="gearbonuses">/.test(open)
    && (open.match(/<th scope="row">Bonus \d<\/th>/g) || []).length === 3);
  ok('the card adds a free box for a destination the list has not got',
    /<input type="text" class="target-free"[^>]*bonuses\.0\.target/.test(open));
  ok('and its description is a growing prose field', /<span class="prose  grow"[^>]*>\s*<textarea data-item="equipment\.gear\|0\|note"/.test(open));
  const span = Number(open.match(/gearcardrow"><td colspan="(\d+)"/)?.[1]);
  ok('the card spans exactly the row’s cells', span === 5 + 3 * 3 + 4);
}

if (hasFixtures()) {
  console.log('\nevery character on the roster, every panel');
  for (const id of fixtureIds()) sweep(id, new Character(loadCharacter(id)));
}

/* ---------------------------------------------------------------------- *
 * nothing a character carries becomes markup
 * ---------------------------------------------------------------------- */

/*
 * Every panel is a string builder writing straight into `innerHTML`, and every
 * value it writes came out of a spreadsheet cell or a text box. So a character
 * document that holds `"><svg onload=...>` in a field nobody escaped puts a
 * script on the page of whoever opens it -- and since `app/published.html`
 * takes a `?src=` URL, whoever opens it need not be the person who wrote it.
 * There is no CSP behind this and a shadow root is not a boundary, so the
 * escaping *is* the defence.
 *
 * Two helpers had holes when this was written: `bigStat`'s `sub`, which took
 * raw markup while carrying ability names straight off the workbook, and
 * `foldButton`, which built `data-collapse` out of a feature group's name.
 * Both are shared, so the leak showed up in panels neither one is named in --
 * which is the argument for sweeping all of them rather than testing the two.
 *
 * Poison every string in the document, render everything, and look for the
 * payload still able to open a tag. Four shapes, because a value can land in a
 * double- or single-quoted attribute, inside a <textarea>, or as element text,
 * and each leaves by a different door.
 */
console.log('\nthe ladder offers a peek at what a feature does, once something is written');
{
  const c = new Character(blankDocument({ id: 'peek', name: 'Peek' }));
  c.set('identity.level', 3);
  c.addClassFeatureColumn('Monk', 'Features');
  c.setClassFeature('Monk', 3, 'Features', 'Fast movement (Ex), Maneuver training');
  c.data.uiPrefs.collapsed = {};
  const draw = () => lore.renderProgressionPanel(c, { menuLists: new Map() });
  check('no note, no peek', draw().includes('data-cfpeek'), false);
  c.addClassFeatureNote('Monk', {
    name: 'Fast movement', type: 'Ex', text: 'Faster by {fast = 10 * floor(level / 3)} ft.',
  });
  const html = draw();
  check('a cell naming a written feature gets one', html.includes('data-cfpeek'), true);
  check('the notes can be dragged and folded',
    [html.includes('data-cfngrip'), html.includes('data-collapse="cfnote-Monk-Fast movement"')], [true, true]);
  check('open, a note binds its name, its type and its text', html.split('data-cfnote=').length - 1, 3);
  const peek = lore.featurePeekHtml(c, 'Monk', 'Fast movement (Ex), Maneuver training');
  check('the peek shows the note, its type and its level, with the formula worked out',
    [peek.includes('Fast movement'), peek.includes('Ex · arrived at level 3'), /class="tok[^"]*"[^>]*>10</.test(peek)],
    [true, true, true]);
  check('a cell about nothing written peeks at nothing', lore.featurePeekHtml(c, 'Monk', 'Maneuver training'), '');
  c.data.uiPrefs.collapsed['cfnote-Monk-Fast movement'] = true;
  const shut = draw();
  check('a folded note keeps its name row and drops its text',
    [shut.includes('class="cfnote collapsed"'), shut.split('data-cfnote=').length - 1], [true, 2]);
}

console.log('\nthe dashboard lays out the cards a character uses, and the wallet names its currency once');
{
  const c = new Character(blankDocument({ name: 'Caster', level: 5 }));
  check('no magic class, no casting card', overview.dashCardIds(c).includes('spheres'), false);
  c.listAdd('training.magic.classes', {
    name: 'Incanter', type: 'High', talentsPerLevel: null, mod1: 'Int', mod2: null, classLevelsOverride: 5,
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, talent: null, sphere: null, notes: null })),
  });
  check('a magic class brings the casting card', overview.dashCardIds(c).includes('spheres'), true);
  c.set('wealth.currency', 'Gold & Glory');
  const html = overview.renderOverviewPanel(c, CTX);
  check('the currency is escaped once', [html.includes('Gold &amp; Glory'), html.includes('&amp;amp;')], [true, false]);
}

console.log('\nthe spell list\'s ask-twice × says when it is armed');
{
  // The panel moved out of the element and stopped being told which × was
  // armed, so the second click still removed -- with no "sure?" in between.
  const c = new Character(blankDocument({ name: 'Wizard', level: 3 }));
  c.set('vancian', { classes: [], prepared: [{ name: 'Sleep', prepared: 1, used: 0 }] });
  const plain = subsystems.vancianPanel(c);
  const armed = subsystems.vancianPanel(c, { armedRemove: 'vancian.prepared|0' });
  check('unarmed it is a ×, armed it asks', [plain.includes('>sure?<'), armed.includes('>sure?<')], [false, true]);
}

console.log('\nno character text reaches the page as markup');
{
  const SHAPES = {
    'a double-quoted attribute': 'Zq"><svg/onload=x(1)>',
    'a single-quoted attribute': "Zq'><svg/onload=x(1)>",
    'a textarea': 'Zq</textarea><svg/onload=x(1)>',
    'element content': 'Zq</td></tr><svg/onload=x(1)>',
  };
  // Which values a pass replaces with the payload. Text is most of a
  // document. Blanks and numbers matter as much: an edited file can put a
  // string where a number or a "blank to work it out" belongs, and a box that
  // prints its stored value as it stands would let it in. The fixtures hold
  // null in every such box, so a text-only sweep never reached them.
  const KINDS = {
    text: (v) => typeof v === 'string' && v !== '',
    blank: (v) => v === null,
    number: (v) => typeof v === 'number',
  };
  const poisonWith = (payload, picks) => function walk(v) {
    if (picks(v)) return payload;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      // The schema version steers which importers run; poisoning it would
      // test a document shape the app never loads.
      for (const [k, x] of Object.entries(v)) o[k] = k === 'schemaVersion' ? x : walk(x);
      return o;
    }
    return v;
  };

  const ids = hasFixtures() ? fixtureIds() : [];
  for (const [kind, picks] of Object.entries(KINDS)) {
    for (const [where, payload] of Object.entries(SHAPES)) {
      const poison = poisonWith(payload, picks);
      let leaked = 0;
      let drawn = 0;
      for (const id of ids) {
        const model = new Character(poison(loadCharacter(id)));
        for (const [name, draw] of [...PANELS, ...panelsWith(openCtx(model))]) {
          let html;
          try { html = String(draw(model) ?? ''); } catch { continue; }
          drawn++;
          // Escaped, the payload is still in the output -- as text. What must
          // not survive is the `<` that makes it a tag again.
          if (html.includes('<svg/onload=x')) {
            leaked++;
            if (leaked === 1) console.log(`  FAIL first leak: ${id} — ${name}`);
          }
        }
      }
      if (drawn) check(`${kind} values: escaped on the way out of ${where}`, leaked, 0);
    }
  }
}

/*
 * A talent's text in the panel. A pack keeps a table as tab-separated rows,
 * which is all a string can do; the panel is markup, so there it is drawn as
 * one. And it is pack text going into `innerHTML`, so every cell is escaped.
 */
{
  const { richText } = await import('../app/js/ui/talents.js');
  console.log('\nrules text in the panel -- tables drawn, and nothing let through');
  const html = richText('Fire grows.\n\nTable: Fire Size\nLevel\tSize\n1st\tFine\n3rd\t<svg/onload=x>\n\nAfter it.');
  check('a run of tabbed rows is a table, its first row the header',
    [html.includes('<thead><tr><th>Level</th><th>Size</th></tr></thead>'), html.includes('<td>1st</td><td>Fine</td>')], [true, true]);
  check('the line above it is the caption, and not said twice',
    [html.includes('<caption>Table: Fire Size</caption>'), html.split('Table: Fire Size').length], [true, 2]);
  check('the text either side is still there', [html.startsWith('Fire grows.'), html.endsWith('After it.')], [true, true]);
  check('a cell is escaped', [html.includes('<svg'), html.includes('&lt;svg/onload=x&gt;')], [false, true]);
  check('one line with a tab in it is a line', richText('a\tb').includes('<table'), false);
  // An earlier build of the wiki packs wrote a table as rows of pipes, and a
  // note filled from one keeps them; markdown writes them the same way.
  const piped = richText('Teleport capacity:\n\n| Creature Size | Equivalent |\n|---|:-:|\n| Fine | 1/16 |\n| Colossal | 16 |');
  check('rows of pipes are a table too, and markdown\'s rule is not a row',
    [piped.includes('<th>Creature Size</th><th>Equivalent</th>'), piped.includes('<td>Fine</td><td>1/16</td>'),
      piped.includes('---'), piped.includes('| Fine')],
    [true, true, false, false]);
  check('a lone piped line is left as it was written', richText('| not a table |').includes('<table'), false);

  // A Notes box is a text box and has no tables in it, so a note with one is
  // read through a rendered view and edited in the box underneath -- the
  // bargain formula fields already strike. A note without one is the plain
  // box, and one with a formula keeps the formula view, which computes.
  const { talentNote } = await import('../app/js/ui/talents.js');
  const noteModel = new Character(blankDocument({ name: 'Reader', level: 1 }));
  const tabled = talentNote(noteModel, 'data-item="x|0|notes"', 'Sizes.\n\nLevel\tSize\n1st\tFine\n3rd\tSmall', 'x|0|notes');
  check('a note with a table is read as a table and still edited as text',
    [tabled.includes('<table class="peektable">'), tabled.includes('prose-view rich'), tabled.includes('<textarea data-item="x|0|notes"'), tabled.includes('Level\tSize')],
    [true, true, true, true]);
  check('a note without one is the plain box', talentNote(noteModel, 'data-item="x|0|notes"', 'Taken at 5th.', 'x|0|notes').includes('prose-view'), false);
}

console.log('skill rows stay put while the player is on the tab');
{
  const c = new Character(blankDocument({ name: 'Ranks', level: 3 }));
  const all = skillRowIndices(c, {});
  check('nothing in use: every row', all.length, c.data.skills.length);
  c.setItem('skills', 0, 'rankSources.bought', 2);
  check('a first rank alone narrows the table to that row', skillRowIndices(c, {}), [0]);
  check('but the rows shown a moment ago are kept', skillRowIndices(c, { keep: new Set(all) }).length, all.length);
  c.setItem('skills', 1, 'hidden', true);
  check('except one hidden with the eye', skillRowIndices(c, { keep: new Set(all) }).includes(1), false);
}

console.log('\nthe dashboard Offense card opens the same breakdowns as the Defense card');
{
  const c = new Character(blankDocument({ name: 'Striker', level: 5 }));
  const html = overview.renderDashboardPanel(c, CTX);
  const card = (title) => html.slice(html.indexOf(`<h3>${title}`), html.indexOf('</section>', html.indexOf(`<h3>${title}`)));
  const keys = (title) => (card(title).match(/data-bd="([a-z]+)"/g) || []).map((m) => m.slice(9, -1));
  check('Melee, Ranged, CMB and Init each open theirs', keys('Offense'), ['melee', 'ranged', 'cmb', 'initiative']);
  ok('as the Defense card does', keys('Defense').includes('ac'));
}

console.log('\nCounts as waits for a class name, on every training tab');
{
  const c = new Character(blankDocument({ name: 'Unnamed', level: 5 }));
  const blank = { type: 'Expert', talentsPerLevel: 'Expert', mod1: null, mod2: null, classLevelsOverride: 5,
    levels: Array.from({ length: 20 }, (_, i) => ({ level: i + 1, talent: null, sphere: null, notes: null })) };
  c.listAdd('training.combat.classes', { name: '', ...blank });
  c.listAdd('training.combat.classes', { name: 'Sentinel', ...blank });
  c.addGuileClass('');
  const live = (html, attr) => (html.match(new RegExp(`<input type="checkbox"[^>]*${attr}="[^"]*"`, 'g')) || []).length;
  const martial = combat.renderMartialPanel(c);
  check('the named martial class can be ticked, the unnamed one cannot', live(martial, 'data-reach'), 2);
  const guileHtml = guile.renderGuilePanel(c);
  check('nor the unnamed guile class', [live(guileHtml, 'data-reach'), guileHtml.includes('Pick the class first')], [0, true]);
  ok('and it says why', martial.includes('Pick the class first'));
}

console.log('\none way of asking twice: the worksheet and feature-group ×');
{
  const c = new Character(blankDocument({ name: 'Asker', level: 3 }));
  c.set('sheetTabs', [{ name: 'Scratch', custom: true, rows: [{ cells: ['a'] }] }]);
  // A feature group whose class has gone: the only kind with a ×.
  c.set('progression.classFeatures', { ...(c.data.progression?.classFeatures || {}), Ghost: { columns: ['Old'], byLevel: {}, rules: {}, optionsFrom: {} } });
  const sheet = { id: 'sys-0', key: 'sys:Scratch', label: 'Scratch', kind: 'system', index: 0, tab: c.data.sheetTabs[0] };
  const mgr = (armed) => manager.renderSystemManagerPanel(c, { ...CTX, tabEntries: [sheet], armedRemove: armed });
  const prog = (armed) => lore.renderProgressionPanel(c, { ...CTX, armedRemove: armed });
  const sure = (html, key) => new RegExp(`data-arm="${key.replace('|', '\\|')}"[^>]*>sure\\?<`).test(html.replace(/\n\s*/g, ' '));
  check('the worksheet × arms, then says sure?', [sure(mgr(null), 'systab|0'), sure(mgr('systab|0'), 'systab|0')], [false, true]);
  check('so does the feature group ×', [sure(prog(null), 'cfgroup|Ghost'), sure(prog('cfgroup|Ghost'), 'cfgroup|Ghost')], [false, true]);
  check('and no Delete / Keep sentence is left', /delete-system-confirm|remove-cf-group-confirm/.test(mgr('systab|0') + prog('cfgroup|Ghost')), false);
}

console.log('\ndeck manipulations fold to their names, and the hover says the card or the note');
{
  const model = await import('../app/js/model.js');
  const { talentPopHtml } = await import('../app/js/ui/talents.js');
  const kept = model.deckManipulationCatalogue();
  model.setCardcastingTables({ manipulations: [{ name: 'Loaded Hand', group: 'General', requires: ['cooldown'], text: 'Hold one more card.' }] });
  const c = new Character(blankDocument({ name: 'Dealer', level: 5 }));
  c.set('cardcasting.manipulations', [
    { name: 'Loaded Hand', count: 1, group: 'General', note: '' },
    { name: 'Loaded Hand', count: 1, group: 'Cooldown', note: 'Mine: {= 2 + 2} cards' },
  ]);
  const html = subsystems.cardcastingPanel(c, { ...CTX, deckView: 'deck' });
  check('shut by default: rows drawn, no rule text in them', [/class="manipname"/.test(html), /class="rule"/.test(html)], [true, false]);
  const pop = (i) => talentPopHtml(c, JSON.stringify({ k: 'manip', p: `cardcasting.manipulations|${i}` }));
  ok('an empty note shows the card', pop(0).includes('Hold one more card.'));
  check('a written note shows instead, worked out', [pop(1).includes('Mine: 4 cards'), pop(1).includes('Hold one more card.')], [true, false]);
  c.set('uiPrefs.collapsed', { 'manip:loaded hand': false });
  ok('opened, the row shows the card and the note field', /class="rule"/.test(subsystems.cardcastingPanel(c, { ...CTX, deckView: 'deck' })));
  model.setCardcastingTables({ manipulations: kept });
}

console.log('\nmanipulation groups keep their columns');
{
  const { manipColumns } = await import('../app/js/ui/panels/subsystems.js');
  check('four groups into three even runs, in order', manipColumns([17, 8, 4, 10], 3), [[0], [1, 2], [3]]);
  check('fewer groups than columns: one each', manipColumns([5, 5], 3), [[0], [1]]);
  check('none: no columns', manipColumns([], 3), []);
}

console.log('\nThe Sheet column on Stats stays only while it holds something');
{
  const c = new Character(blankDocument({ name: 'Imported', level: 5 }));
  // The two typed-bonus tables, saves first, as the panel draws them.
  const tables = () => {
    const html = renderStatsPanel(c, {});
    const at = html.indexOf('Save &amp; AC bonuses');
    return html.slice(at).split('<table').slice(1, 3).map((t) => t.split('</table>')[0].includes('>Sht<'));
  };
  check('a character built here has no Sheet column', tables(), [false, false]);
  c.set('saves.will.bonuses.sheet', 3);
  check('an imported save remainder shows it on the saves table only', tables(), [true, false]);
  c.set('defenses.acBonuses.sheet', 'floor(level / 5)');
  check('and a formula left on AC shows it there', tables(), [true, true]);
  c.set('saves.will.bonuses.sheet', 0);
  c.set('defenses.acBonuses.sheet', '');
  check('cleared, both go', tables(), [false, false]);
}

console.log('\nevery gold badge is the one badge, and opens the same panel');
{
  const { forwardedPop } = await import('../app/js/ui/badges.js');
  const c = new Character(blankDocument({ name: 'Badges', level: 8 }));
  c.data.defenses.dr = '5/magic, 2/—';
  c.addCompanion('eidolon');
  const id = c.data.eidolon[0].id || 'eidolon';
  c.listAdd('eidolon.0.attacks', { type: 'Bite', damage: '1d8', crit: '20/×2', primary: null, bonus: 0, dmgBonus: 2, qualities: '' });
  c.data.notes = [{
    title: 'Aegis',
    body: `{dr.magic += 3} {defenses.dr += 1} {hp.temp += 10} {${id}.damage += 2} {${id}.damage.bite += 1}`,
  }];
  c.recompute();
  c.data.hp.tempSpent = 3;
  c.recompute();
  // Every panel, every view, with badges actually up -- `renders` fails on
  // one drawn by hand.
  sweep('a character with forwarded bonuses', c);
  const html = overview.renderOverviewPanel(c, CTX);
  const mate = subsystems.companionPanel(c, 'eidolon');

  const dr = html.match(/<span class="fwd" data-fwd="defenses\.dr dr\.magic dr\.none" data-fwdx="([^"]*)"[^>]*>([^<]*)</);
  ok('the DR box: one badge for the family and every part', dr);
  check('saying the line as it stands', dr && dr[2], c.data.defenses.calc.drText);
  const drPop = forwardedPop(c, 'defenses.dr dr.magic dr.none', dr ? dr[1].replace(/&quot;/g, '"') : '');
  ok('its panel names the part each rule went to',
    drPop.includes('to dr.magic · += 3') && drPop.includes('to defenses.dr · += 1'));
  ok('under the line it is explaining', drPop.includes(`<span class="bdtotal">${c.data.defenses.calc.drText}</span>`));

  const temp = html.match(/<span class="fwd" data-fwd="hp\.temp" data-fwdx="([^"]*)"[^>]*>([^<]*)</);
  check('temporary hit points: the ones still unspent', temp && temp[2], '+7');
  const tempPop = forwardedPop(c, 'hp.temp', temp ? temp[1].replace(/&quot;/g, '"') : '');
  ok('and the panel says how many were spent',
    tempPop.includes('<div class="bdsub">10 temporary hit points forwarded here, 3 of them already spent.'));
  ok('above the rule that granted them', tempPop.includes('<span class="v">+10</span>'));

  const bite = mate.match(new RegExp(`<span class="fwd" data-fwd="${id}\\.damage ${id}\\.damage\\.bite"[^>]*>([^<]*)<`));
  check('a companion attack\'s damage: the bonus to every attack and to this one', bite && bite[1], '+3');
  ok('the typed Dmg + is not in it', !mate.includes('>+5</span>'));

  // The Stats tab asks for each half of what reaches a score on its own.
  c.data.notes.push({ title: 'Bull', body: '{str.score += 1} {str.score += 2 as temp.size}' });
  c.recompute();
  const stats = renderStatsPanel(c, {});
  const half = (only) => stats.match(new RegExp(
    `data-fwd="str\\.score" data-fwdx="\\{&quot;only&quot;:&quot;${only}&quot;\\}"[^>]*>([^<]*)<`))?.[1];
  check('the Stats tab splits a score\'s badge into its permanent and temporary halves',
    [half('permanent'), half('temporary')], ['+1', '+2']);
}

console.log('\nevery × is the one ×');
{
  const { removeAction, removeButton, removeControl, rowRemove } = await import('../app/js/ui/rows.js');
  check('a row\'s ×', removeButton('buffs', 2, { what: 'buff' }),
    '<button class="danger" data-remove="buffs|2" title="Remove buff" aria-label="Remove buff">×</button>');
  check('with nothing named, the plain one the row tools always drew', removeButton('x', 0),
    '<button class="danger" data-remove="x|0" title="Remove" aria-label="Remove">×</button>');
  const ask = (armed) => removeButton('vancian.prepared', 1, { what: 'Fireball', armed });
  check('one that asks twice is armed under list|i', ask(null).includes('data-remove-armed="vancian.prepared|1"'), true);
  check('and says so on the hover', ask(null).includes('title="Remove Fireball — asks twice"'), true);
  check('armed, it reads sure?', [ask('vancian.prepared|1').includes('class="danger armed"'),
    ask('vancian.prepared|1').endsWith('>sure?</button>')], [true, true]);
  check('another key armed leaves it a ×', ask('vancian.prepared|0').endsWith('>×</button>'), true);
  check('an action carries its parameters, escaped, and the key it arms under',
    removeAction('remove-cf-group', { class: 'Ghost "One"' }, { what: 'the group', arm: 'cfgroup|Ghost', armed: null })
      .includes('data-action="remove-cf-group" data-class="Ghost &quot;One&quot;" data-arm="cfgroup|Ghost"'), true);
  check('words in place of the ×', removeButton('psionics.classes', 0, { what: 'this class', text: 'Remove' }).endsWith('>Remove</button>'), true);
  check('what it takes is escaped', removeControl('data-x="1"', { what: '<b>' }).includes('aria-label="Remove &lt;b&gt;"'), true);
  check('a row\'s cell holds it', /^<td class="tools">\s*<button class="danger" data-remove="a\|1"/.test(rowRemove('a', 1, { what: 'row' })), true);

  // The two removals that had no way back now leave one.
  const { handleAction } = await import('../app/js/monster/sheet.js');
  const m = new Character(blankDocument('monster-undo'));
  handleAction(m, 'monster-block');
  check('a stat block asks twice before it goes',
    statBlock.renderStatBlockPanel(m, { ...CTX, armedRemove: 'monster-block' }).includes('>sure?</button>'), true);
  handleAction(m, 'monster-unblock');
  check('and leaves the way back', [m.data.monster, m.undoStack?.at(-1)?.label], [undefined, 'Removed the monster block']);
}

console.log('\nevery moved number is the one moved number');
{
  const { movedValue } = await import('../app/js/ui/rows.js');
  check('down: red, with what it was and what moved it on the hover',
    movedValue('12', -2, { base: '14', sources: 'Shaken' }),
    '<strong class="adj" title="Base 14 — with Shaken applied">12</strong>');
  check('up: green', movedValue('16', 2, { base: '14', sources: 'Bull' }).includes('class="adj up"'), true);
  check('not moved: the figure as it is', movedValue('14', 0, { base: '14' }), '14');
  check('kept: its own classes either way', movedValue('+3', 0, { tag: 'span', cls: 'mod', keep: true }), '<span class="mod">+3</span>');

  // The Overview's ability panel marked a moved score in a class that was
  // always red, so a buff that raised Strength showed as a loss.
  const c = new Character(blankDocument({ name: 'Bull', level: 5 }));
  c.data.buffs = [{ name: 'Bull', on: true, bonuses: [{ target: 'str', value: 4 }] }];
  c.recompute();
  const html = overview.renderOverviewPanel(c, CTX);
  const str = html.slice(html.indexOf('data-ab="str"'), html.indexOf('data-ab="dex"'));
  check('a buff that raises a score shows it raised', [/temp-score[^"]*adj up/.test(str), /temp-mod[^"]*adj up/.test(str)], [true, true]);
  check('and nothing on the sheet wears the always-red class', /\bconditioned\b/.test(html), false);
}

console.log('\none way to write a sign');
{
  const { group, minus, signed } = await import('../app/js/ui/format.js');
  check('plus, a true minus, and a bare zero', [signed(2), signed(-3), signed(0)], ['+2', '−3', '0']);
  check('the size written its own way', signed(-1200, group), '−1,200');
  check('a figure that carries no plus', [minus(-12), minus(4)], ['−12', '4']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
