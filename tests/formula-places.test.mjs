/** Every formula the Formulas tab lists has a go-to target, and that target
 *  is a field the panel actually renders.
 *
 *  The tab lists formulas by where they are written ("note 1 on Lore", "Bluff
 *  misc") and each of those is a button back to it: ui/formula-places.js turns
 *  the place into the palette's jump -- a tab, the selector of the field, and
 *  what has to be opened first when the field hides behind a fold, a card or
 *  an editor. A jump that names a field the tab never draws is a button that
 *  does nothing, which is worse than no button; so this renders the tab each
 *  jump names, the way the element would, and checks the field is in it --
 *  shut, or once its opener has been pressed.
 *
 *  The panels are string builders that run in Node (see tests/panels.test.mjs);
 *  the few still drawn by the element itself (Feats & Mythic) are checked for a
 *  place, not for markup, and left to the browser.
 *
 *  Run: node tests/formula-places.test.mjs */
import { blankDocument } from '../app/js/convert.js';
import { Character } from '../app/js/model.js';
import { formulaPlace, selectorAttribute } from '../app/js/ui/formula-places.js';
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

/**
 * The view state a panel is drawn with: everything shut, as a tab opens --
 * or, given the attributes of an opener, with what pressing it opens. The
 * element keeps most of that in its own state, which is the ctx; a companion
 * chosen from the strip is kept on the character, so that one is written to
 * uiPrefs (and taken back by the caller).
 */
function ctxFor(model, pressed = []) {
  const at = (name) => pressed.find((p) => p.name === name)?.value ?? null;
  const action = at('data-action');
  const tracker = at('data-tracker-edit');
  const t = tracker && model.trackers.find((x) => x.id === tracker);
  if (action === 'companion-select') {
    model.data.uiPrefs.activeCompanion = { [at('data-kind')]: Number(at('data-index')) };
  }
  // A weapon folded shut is folded on the weapon itself.
  if (action === 'toggle-weapon') model.data.equipment.weapons[Number(at('data-index'))].collapsed = false;
  return {
    overview: {
      condPickerOpen: false, dashArrange: false, draft: {}, openClassSystems: null,
      openBuff: action === 'buff-open' ? Number(at('data-index')) : null,
    },
    combat: { showCells: new Set() },
    gear: { draft: {}, openPosts: new Map(), showAllGear: false, openGear: at('data-gearopen') },
    system: {
      deckView: at('data-deck-view') || 'table',
      maneuverEdit: !!at('data-medit'),
      openManeuver: at('data-medit'),
      veilEdit: at('data-vedit'),
      peek: [],
    },
    tracker: {
      draft: {},
      editTracker: t ? t.id : null,
      editMeter: null,
      editDraft: t ? {
        name: t.name, maxFormula: t.maxFormula || '', minFormula: t.minFormula || '', refresh: t.refresh || '',
        note: t.note || '', style: normalizeStyle(t.style),
      } : null,
    },
    lore: { menuLists: new Map() },
    admin: {
      formulaDraft: '', formulaQuery: '', formulaValueQuery: '', formulaTargetQuery: '', formulaRefOpen: false, tab: 'formulas',
    },
    skills: { showAllSkills: action === 'toggle-skills' },
  };
}

/** The tabs a jump can name, drawn as the element draws them. */
const RENDER = {
  overview: (m, c) => overview.renderOverviewPanel(m, c.overview),
  stats: (m) => renderStatsPanel(m, {}),
  skills: (m, c) => renderSkillsPanel(m, c.skills),
  martial: (m) => combat.renderMartialPanel(m),
  magic: (m) => combat.renderMagicPanel(m),
  guile: (m) => guile.renderGuilePanel(m),
  template: (m, c) => combat.renderTemplatePanel(m, c.combat),
  gear: (m, c) => gear.renderGearPanel(m, c.gear),
  crafting: (m, c) => gear.renderCraftingPanel(m, c.gear),
  trackers: (m, c) => trackers.renderTrackersPanel(m, c.tracker),
  altTraining: (m) => subsystems.altTrainingPanel(m),
  akashic: (m, c) => subsystems.akashicPanel(m, c.system),
  maneuvers: (m, c) => subsystems.maneuversPanel(m, c.system),
  vancian: (m) => subsystems.vancianPanel(m),
  psionics: (m, c) => subsystems.psionicsPanel(m, c.system),
  cardcasting: (m, c) => subsystems.cardcastingPanel(m, c.system),
  familiar: (m) => subsystems.companionPanel(m, 'familiar'),
  animalCompanion: (m) => subsystems.companionPanel(m, 'animalCompanion'),
  eidolon: (m) => subsystems.companionPanel(m, 'eidolon'),
  conjured: (m) => subsystems.companionPanel(m, 'conjured'),
  progression: (m, c) => lore.renderProgressionPanel(m, c.lore),
  lore: (m, c) => lore.renderLorePanel(m, c.lore),
  extras: (m, c) => lore.renderExtrasPanel(m, c.lore),
  formulas: (m, c) => admin.renderFormulaPanel(m, c.admin),
};

/** Is the element a selector names in this markup? Attribute selectors only. */
const inMarkup = (html, sel) => {
  const attr = selectorAttribute(sel);
  return !!attr && attr.every(({ name, value }) => html.includes(`${name}="${htmlEscape(value)}"`));
};

/**
 * Is there a field holding exactly this text -- the palette's fallback, which
 * finds the input whose value it is? A textarea holds it as its content, an
 * input as its value.
 */
const holding = (html, text) => !!String(text || '').trim()
  && (html.includes(`>${htmlEscape(text)}</textarea>`) || html.includes(`value="${htmlEscape(text)}"`));

/** Does this markup draw the field a jump is after, by selector or by its text? */
const drawsField = (html, entry) => (entry.sel || []).some((s) => inMarkup(html, s)) || holding(html, entry.find);
const htmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Check one place: it has a jump, the jump names a tab, and the tab draws the
 * field -- at once, or after the jump's opener has been pressed.
 */
function checkPlace(model, place, label) {
  const entry = formulaPlace(model, place);
  if (!entry) {
    fail++;
    console.log(`  FAIL ${label} (${place}): no place to go to`);
    return;
  }
  pass++;
  const draw = RENDER[entry.tab];
  if (!draw) return;       // drawn by the element itself; the browser checks it
  // Every place starts from the character as it is, and leaves it so: what
  // one jump opens must not be what lets the next one pass.
  const prefs = model.data.uiPrefs;
  const weapons = model.data.equipment?.weapons || [];
  const saved = {
    collapsed: { ...(prefs.collapsed || {}) },
    activeCompanion: prefs.activeCompanion,
    weaponFolds: weapons.map((w) => w?.collapsed),
  };
  const reached = reach(model, entry, draw, label, place);
  prefs.collapsed = saved.collapsed;
  prefs.activeCompanion = saved.activeCompanion;
  weapons.forEach((w, i) => { if (w) w.collapsed = saved.weaponFolds[i]; });
  if (reached === null) return;
  if (reached) { pass++; return; }
  fail++;
  console.log(`  FAIL ${label} (${place}): ${entry.tab} does not draw ${JSON.stringify(entry.sel)}`
    + `${entry.open ? ` even after ${JSON.stringify(entry.open)}` : ''}`);
}

/**
 * Travel as the element does: the folded panel the jump names opened (the
 * palette's `expand`), then each opener pressed in turn while the field is
 * not yet drawn -- what one opens staying open while the next is looked for.
 * True when the field is reached, false when not, null when the tab threw
 * (already reported).
 */
function reach(model, entry, draw, label, place) {
  const folds = model.data.uiPrefs.collapsed || (model.data.uiPrefs.collapsed = {});
  if (entry.expand && folds[entry.expand]) folds[entry.expand] = false;
  const pressed = [];
  let html;
  try {
    html = draw(model, ctxFor(model, pressed));
    if (drawsField(html, entry)) return true;
    for (const opener of entry.open || []) {
      if (!inMarkup(html, opener)) continue;
      const attrs = selectorAttribute(opener);
      const fold = attrs.find((x) => x.name === 'data-collapse');
      if (fold) folds[fold.value] = false;
      else pressed.push(...attrs);
      html = draw(model, ctxFor(model, pressed));
      if (drawsField(html, entry)) return true;
    }
  } catch (err) {
    fail++;
    console.log(`  FAIL ${label} (${place}): the ${entry.tab} tab threw ${err.message.slice(0, 80)}`);
    return null;
  }
  return false;
}

/* ---------------- a character with a formula nearly everywhere ---------------- */

function everywhere() {
  const c = new Character(blankDocument({ name: 'Places', level: 8 }));
  const d = c.data;
  d.notes = [{ title: 'A', body: 'note {a.note = 1}' }, { title: 'B', body: 'second {b.note = 2}' }];
  d.backgroundSections = [{ label: 'History', text: 'history {a.bg = 3}' }];
  d.defenses.dr = 'DR {= 5 + floor(level / 2)}/magic';
  d.raceTraits = [{ name: 'Fiendish', text: 'racial {skill.disguise += 2}' }];
  d.buffs = [{ name: 'Rage', on: true, note: 'raging {rage.bonus = 2}', bonuses: [] }];
  d.equipment.weapons[0] = { ...d.equipment.weapons[0], name: 'Glaive', dice: '1d10', special: 'reach {glaive.reach = 10}', miscDamage: 'floor(level / 4)' };
  d.formulaNotes = 'house rule {house.rule = 1}';
  d.identity.languageExtra = 'floor(level / 4)';
  d.hp.misc = 'level';
  d.skills.find((s) => s.name === 'Bluff').offset = 'floor(level / 2)';
  d.skills.find((s) => s.name === 'Climb').rankSources.bought = 'level - 2';
  // A rank formula that comes to nothing leaves its skill off the table
  // until Show all -- the jump has to press it.
  d.skills.find((s) => s.name === 'Swim').rankSources.bought = 'max(0, level - 20)';
  d.skills.find((s) => s.name === 'Acrobatics').rankSources.bought = 2;
  // A gear row: its note and Other columns are in the row's card; a bonus is
  // on the row itself.
  Object.assign(d.equipment.gear[0], { name: 'Circlet', note: 'glows {circlet.glow = 1}' });
  d.equipment.gear[0].others[0] = 'hums {circlet.hum = 2}';
  d.equipment.gear[0].bonuses[0] = { value: 'floor(level / 4)', type: 'enhancement', target: 'wis.score' };
  d.crafting.speedIncreases = [{ label: 'Fast', value: 'level * 10' }];
  d.crafting.projects = [{
    name: 'Wand', resources: 'costs {wand.cost = 750}', notes: 'sparks {wand.spark = 1}', value: 'level * 100',
    itemDC: '5 + level', dcAdjustments: [{ label: 'Rush', value: 'floor(level / 2)' }],
  }];
  d.identity.speeds = [{ type: 'Land', base: 30, bonus: 'floor(level / 4) * 5' }];
  d.altTraining.notes = 'trains {alt.note = 1}';
  d.cardcasting.notes = 'deals {deck.note = 1}';
  d.eidolon[0].name = 'Ahriman';
  d.eidolon[0].notes = 'first {ahriman.note = 1}';
  // A class's ladder cell and the note under it, on Progression.
  d.classes[0] = { ...d.classes[0], name: 'Incanter', hd: 6, gestaltLevels: 8 };
  d.progression.classFeatures.Incanter = {
    columns: ['Special'],
    byLevel: { 1: { Special: 'Ki pool {ki.heal = 2 + level}' } },
    rules: {},
    optionsFrom: {},
    notes: [{ name: 'Ki pool', type: 'Su', text: 'holds {ki.size = wis.mod + level} points' }],
  };
  // A talent's note on a training side.
  d.training.magic.classes = [{
    name: 'Incanter', type: 'High', levels: [{ level: 1, talent: 'Dark Sphere', sphere: 'Dark', notes: 'shade {dark.shade = 2}' }],
  }];
  // A worksheet the player keeps, as its own tab.
  d.sheetTabs = [{ name: 'Ledger', rows: [{ cells: ['gold {ledger.gold = 10}'] }] }];
  // A template's feature and the ability under it.
  d.templates = [{
    name: 'Half-Fiend',
    features: [{
      name: 'Smite', text: 'smite {smite.dmg = level}', tables: [],
      children: [{ name: 'Smite, greater', text: 'twice {smite.twice = 2}', tables: [] }],
    }],
  }];
  // A veil in a chakra slot.
  d.akashic.slots = [{ slot: 'Hands', twinveil: false, veils: [{ name: 'Test Veil', essence: 2, desc: 'grips {veil.grip = 3}' }] }];
  // A prepared spell's note, a deck manipulation's note, leftovers from a sheet.
  d.vancian.prepared = [{ name: 'Fireball', note: 'burns {fireball.x = 1}' }];
  d.cardcasting.manipulations = [{ name: 'Loaded Hand', count: 1, group: 'Draw', note: 'loads {loaded.x = 1}' }];
  d.akashic.sourceExtras = [{ cells: ['left over {akashic.left = 1}'] }];
  d.eidolon[0].attacks = [{ type: 'Bite', qualities: 'bites {bite.x = 1}' }];
  // A bonus talent, and a talent note long enough to start folded.
  d.training.magic.bonusTalents = [{ talent: 'Extra', notes: 'bonus {bonus.talent = 1}' }];
  d.training.magic.classes[0].levels.push({
    level: 2, talent: 'Darkness', sphere: 'Dark',
    notes: `a long note ${'that goes on '.repeat(14)}{dark.long = 5}`,
  });
  // A weapon the player folded shut on the Equipment tab.
  d.equipment.weapons[0].collapsed = true;
  c.recompute();
  // A customized weapon whose drawn talent says something.
  c.listAdd('training.combat.classes', { name: 'Armiger', type: 'Expert', classLevelsOverride: 3, levels: [] });
  c.addCustomization('Armiger', { sets: { start: 2, gainsAt: '' }, talents: { start: 1, gainsAt: '' } });
  c.setItem('training.combat.customizations.0.sets.0.talents', 0, 'talent', 'Keen Edge {edge.x = 1}');
  c.setItem('training.combat.customizations.0.sets.1.talents', 0, 'talent', 'Stowed {stowed.x = 1}');
  const wisp = c.addCompanion('eidolon');
  wisp.name = 'Wisp';
  wisp.notes = 'second {wisp.note = 1}';
  c.addTracker({ name: 'Burn', maxFormula: 'level', minFormula: '0 - level',
    style: { zones: [{ from: 'self.max - 2', to: 'self.max', color: '#aa2222', label: 'danger' }] } });
  c.addTracker({ name: 'Ki', maxFormula: 'floor(level / 2)', note: 'spend {= 1 + wis.mod}' });
  c.setOffset('saves.will.total', 'floor(level / 4)');
  c.setOffset('attack.totalMelee', 'floor(level / 5)');
  c.setOffset('defenses.touch', '1');
  c.setOffset('initiative', 'floor(level / 3)');
  // Folded shut, as a player may have left them: the jump has to open them --
  // the hit-point parts, the language slots, a class's whole ladder, and the
  // notes under it both as a block and one by one.
  c.data.uiPrefs.collapsed = {
    ...(c.data.uiPrefs.collapsed || {}),
    'hp:build': true,
    languages: true,
    'sg-defenses': true,
    'progfeat-Incanter': true,
    'cfnotes-Incanter': true,
    'cfnote-Incanter-Ki pool': true,
    'customized-weapons': true,
  };
  return c;
}

console.log('every formula on the Formulas tab has somewhere to go, and it is there');
{
  const c = everywhere();
  const rows = c.audit();
  check('the character has formulas in many places', rows.length > 10, true);
  for (const r of rows) checkPlace(c, r.place, `formula ${r.name}`);
  check('every formula row carries its place', rows.filter((r) => !r.place).map((r) => r.id), []);
  const forwarded = admin.forwardedRows(c);
  for (const f of forwarded) checkPlace(c, f.place, `bonus to ${f.to}`);
}

console.log('a formula that does not work can be gone to from Needs attention');
{
  const c = everywhere();
  c.data.notes.push({ title: 'Broken', body: 'twice {a.note = 7}, missing {= nope + 1}' });
  c.recompute();
  const problems = c.formulaProblems();
  check('there are problems to go to', problems.length > 0, true);
  for (const p of problems) {
    for (const pl of p.places) if (pl.place) checkPlace(c, pl.place, `${p.kind} ${p.name}`);
  }
  check('each duplicate names where both definitions are',
    problems.find((p) => p.kind === 'duplicate')?.places.map((pl) => pl.place), ['note:0', 'note:2']);
}

console.log('a companion is reached by id wherever it stands, the first of a kind too');
{
  const c = everywhere();
  // Wisp is the one showing; the jump to the first eidolon has to bring it back.
  c.data.uiPrefs.activeCompanion = { eidolon: 1 };
  checkPlace(c, 'eidolon:notes', 'the first eidolon while the second is showing');
  // The first removed, Wisp (eidolon2) is first in the list, still by its id.
  c.listRemove('eidolon', 0);
  check('Wisp keeps its id at the head of the list', c.data.eidolon[0].id, 'eidolon2');
  checkPlace(c, 'eidolon:eidolon2:notes', 'the second eidolon, now first');
}

console.log('a place nobody can go to is not offered');
{
  const c = everywhere();
  check('an unknown place has no jump', formulaPlace(c, 'nowhere:at:all'), null);
  check('nor does a blank one', formulaPlace(c, ''), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
