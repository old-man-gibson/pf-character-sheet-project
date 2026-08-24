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
 *  still wants `tools/panel-snapshot.js` in a browser. And the few panels that
 *  are still methods on the element rather than modules (Feats & Mythic, the
 *  Technique List, Auto-Cooking) cannot be reached from here at all.
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
import { renderStatsPanel } from '../app/js/ui/panels/stats.js';
import { renderSkillsPanel } from '../app/js/ui/panels/skills.js';
import { prose, foldedProse, renderedProse } from '../app/js/ui/prose.js';
import { normalizeStyle } from '../app/js/tracker-style.js';

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
 * The view state each panel reads, as the element's own `#…Ctx()` builders
 * put it together -- the shut state of every fold, which is what a sheet
 * opens on.
 */
const shutCtx = () => ({
  overview: {
    condPickerOpen: false, dashArrange: false, draft: {}, openBuff: null, openClassSystems: null,
  },
  combat: { showCells: new Set() },
  gear: { draft: {}, openPosts: new Map(), showAllGear: false },
  system: {
    deckView: 'table', maneuverEdit: false, openManeuver: null, peek: [],
  },
  tracker: {
    draft: {}, editDraft: null, editMeter: null, editTracker: null,
  },
  lore: { menuLists: new Map() },
  admin: {
    formulaDraft: '', formulaQuery: '', formulaRefOpen: false, tab: 'formulas',
  },
  skills: { showAllSkills: false },
});

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
    overview: {
      condPickerOpen: true,
      dashArrange: true,
      draft: {},
      openBuff: (d.buffs || []).length ? 0 : null,
      openClassSystems: (d.classes || []).length ? 0 : null,
    },
    combat: { showCells: yes },
    gear: { draft: {}, openPosts: yes, showAllGear: true },
    system: {
      deckView: 'deck',
      maneuverEdit: true,
      openManeuver: firstManeuver ? `maneuvers.disciplines.0|${firstManeuver.name}` : null,
      peek: [],
    },
    tracker: {
      draft: {},
      // The element sets these two together, so the harness does too: an
      // editor open on a tracker with no draft behind it is a state the sheet
      // cannot be in, and failing on it would be the test's fault.
      editDraft: {
        name: '', maxFormula: '', minFormula: '', refresh: '', note: '', style: normalizeStyle(null),
      },
      editMeter: 'hp',
      editTracker: (d.customTrackers || [])[0]?.id ?? null,
    },
    lore: { menuLists: new Map() },
    admin: {
      formulaDraft: '{= 1 + 1}', formulaQuery: 'a', formulaRefOpen: true, tab: 'audit',
    },
    skills: { showAllSkills: true },
  };
};

/** Every panel that is a module, by the name its tab wears. */
const panelsWith = (CTX) => [
  ['Overview', (m) => overview.renderOverviewPanel(m, CTX.overview)],
  ['Overview (session dashboard)', (m) => overview.renderDashboardPanel(m, CTX.overview)],
  ['Stats', (m) => renderStatsPanel(m, {})],
  ['Skills', (m) => renderSkillsPanel(m, CTX.skills)],
  ['Martial Spheres', (m) => combat.renderMartialPanel(m)],
  ['Magic Spheres', (m) => combat.renderMagicPanel(m)],
  ['Guile Spheres', (m) => guile.renderGuilePanel(m)],
  ['Template', (m) => combat.renderTemplatePanel(m, CTX.combat)],
  ['Equipment', (m) => gear.renderGearPanel(m, CTX.gear)],
  ['Crafting', (m) => gear.renderCraftingPanel(m, CTX.gear)],
  ['Wealth', (m) => gear.wealthPanel(m, CTX.gear)],
  ['Trackers', (m) => trackers.renderTrackersPanel(m, CTX.tracker)],
  ['Primordia', (m) => subsystems.primordiaPanel(m)],
  ['Akashic', (m) => subsystems.akashicPanel(m, CTX.system)],
  ['Maneuvers', (m) => subsystems.maneuversPanel(m, CTX.system)],
  ['Vancian', (m) => subsystems.vancianPanel(m)],
  ['Psionics', (m) => subsystems.psionicsPanel(m, CTX.system)],
  ['Cardcasting', (m) => subsystems.cardcastingPanel(m, CTX.system)],
  ['Familiar', (m) => subsystems.companionPanel(m, 'familiar')],
  ['Animal Companion', (m) => subsystems.companionPanel(m, 'animalCompanion')],
  ['Eidolon', (m) => subsystems.companionPanel(m, 'eidolon')],
  ['Progression', (m) => lore.renderProgressionPanel(m, CTX.lore)],
  ['Lore', (m) => lore.renderLorePanel(m, CTX.lore)],
  ['Extras & Notes', (m) => lore.renderExtrasPanel(m, CTX.lore)],
  ['Formulas', (m) => admin.renderFormulaPanel(m, CTX.admin)],
  ['Formula Audit', (m) => admin.renderAuditPanel(m, CTX.admin)],
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
   * that answers yes to every key folds all of them at once without needing
   * one.
   */
  const realCollapsed = model.data.uiPrefs.collapsed;
  model.data.uiPrefs.collapsed = new Proxy({}, { get: () => true });
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

if (hasFixtures()) {
  console.log('\nevery character on the roster, every panel');
  for (const id of fixtureIds()) sweep(id, new Character(loadCharacter(id)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
