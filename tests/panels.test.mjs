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
    formulaDraft: '', formulaQuery: '', formulaValueQuery: '', formulaTargetQuery: '', formulaRefOpen: false, tab: 'formulas',
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
      formulaDraft: '{= 1 + 1}', formulaQuery: 'a', formulaValueQuery: 'mod', formulaTargetQuery: 'will', formulaRefOpen: true, tab: 'audit',
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
  ['Alternate Training', (m) => subsystems.altTrainingPanel(m)],
  ['Akashic', (m) => subsystems.akashicPanel(m, CTX.system)],
  ['Maneuvers', (m) => subsystems.maneuversPanel(m, CTX.system)],
  ['Vancian', (m) => subsystems.vancianPanel(m)],
  ['Psionics', (m) => subsystems.psionicsPanel(m, CTX.system)],
  ['Cardcasting', (m) => subsystems.cardcastingPanel(m, CTX.system)],
  ['Familiar', (m) => subsystems.companionPanel(m, 'familiar')],
  ['Animal Companion', (m) => subsystems.companionPanel(m, 'animalCompanion')],
  ['Eidolon', (m) => subsystems.companionPanel(m, 'eidolon')],
  ['Conjured Companion', (m) => subsystems.companionPanel(m, 'conjured')],
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
    /<option value="Deflection" title="Deflection"[^>]*selected>Defl\.</.test(html));
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

console.log('\nno character text reaches the page as markup');
{
  const SHAPES = {
    'a double-quoted attribute': 'Zq"><svg/onload=x(1)>',
    'a single-quoted attribute': "Zq'><svg/onload=x(1)>",
    'a textarea': 'Zq</textarea><svg/onload=x(1)>',
    'element content': 'Zq</td></tr><svg/onload=x(1)>',
  };
  const poisonWith = (payload) => function walk(v) {
    if (typeof v === 'string') return v === '' ? '' : payload;
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
  for (const [where, payload] of Object.entries(SHAPES)) {
    const poison = poisonWith(payload);
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
    if (drawn) check(`escaped on the way out of ${where}`, leaked, 0);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
