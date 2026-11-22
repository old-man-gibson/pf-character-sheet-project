/**
 * model/wizard.js -- the setup guide: its steps, and where a character is in
 * them.
 *
 * The guide walks a new character through its build in order. It has no forms
 * of its own. Each step names a tab and, where the tab holds more than the
 * step is about, the panels on it to show; the sheet draws those panels as it
 * always does, so what is typed in the guide is typed on the sheet.
 *
 * One step is the guide's own: Systems, where the player picks the rules
 * systems the character uses (the GAME_SYSTEMS rows in rules.js). A picked
 * system puts its tabs on the build bar and adds a step for each of them.
 *
 * What is saved, in `uiPrefs.wizard`:
 *
 *   on       the guide is open
 *   step     the step it is on
 *   systems  the systems picked, as GAME_SYSTEMS ids
 */
import { GAME_SYSTEMS } from '../rules.js';
import { emit } from './events.js';

/** The tab id the Systems step is drawn on. It is on no bar. */
export const WIZARD_TAB = 'wizard';

/**
 * The steps before the systems. `panels` are the headings of the panels a
 * step shows; without it the step shows its whole tab. `folds` are fold keys
 * the step opens, for a panel that is not drawn while its group is folded.
 * `text` is the one instruction the guide gives.
 */
const BEFORE = [
  {
    id: 'rules', label: 'Campaign rules', tab: 'systabs', panels: ['Campaign rules'], folds: ['campaign-rules'],
    text: 'Set the campaign rules. Lowest level is required.',
  },
  {
    id: 'details', label: 'Details', tab: 'overview', panels: ['Details', 'Languages'],
    text: 'Enter the name, race, level and other details.',
  },
  { id: 'abilities', label: 'Ability scores', tab: 'stats', text: 'Set the ability scores.' },
  {
    id: 'traits', label: 'Race and traits', tab: 'overview', panels: ['Race traits', 'Traits & drawbacks', 'Specialty'],
    text: 'Add the race traits, traits and drawbacks.',
  },
  {
    id: 'classes', label: 'Classes', tab: 'overview', panels: ['Classes', 'Hit points'], folds: ['sg-defenses'],
    text: 'Add the classes and set the hit points.',
  },
  { id: 'progression', label: 'Class features', tab: 'progression', text: 'Check the class features gained at each level.' },
  {
    id: 'systems', label: 'Systems', tab: WIZARD_TAB,
    text: 'Select the rules systems this character uses. Each selected system adds a step.',
  },
];

/** The steps after the systems. */
const AFTER = [
  { id: 'skills', label: 'Skills', tab: 'skills', text: 'Spend the skill ranks.' },
  { id: 'feats', label: 'Feats', tab: 'features', text: 'Add the feats.' },
  { id: 'gear', label: 'Equipment', tab: 'gear', text: 'Add weapons, armor and other items.' },
];

/** Every step that is always there, in order, for a test to check against the panels. */
export const WIZARD_FIXED_STEPS = [...BEFORE, ...AFTER];

const KNOWN = new Set(GAME_SYSTEMS.map((s) => s.id));

/**
 * The systems picked for this character, in table order.
 *
 * Until the Systems step has been used there is nothing stored, and the
 * answer is the systems the character already shows: one a class is marked
 * with, or one whose first tab holds data. A system drawn on the same first
 * tab as an earlier row is not read from data (two systems share the Martial
 * tab), only from a class mark.
 */
export function wizardSystems(model) {
  const stored = model.data.uiPrefs?.wizard?.systems;
  if (Array.isArray(stored)) return GAME_SYSTEMS.filter((s) => stored.includes(s.id)).map((s) => s.id);
  const inUse = model.systemTabsInUse();
  const marked = new Set((model.data.classes || []).flatMap((c) => c?.systems || []));
  const firstTabs = new Set();
  const out = [];
  for (const s of GAME_SYSTEMS) {
    const own = !firstTabs.has(s.tabs[0]);
    firstTabs.add(s.tabs[0]);
    if (marked.has(s.id) || (own && inUse[s.tabs[0]])) out.push(s.id);
  }
  return out;
}

/**
 * The guide's steps for this character: the fixed ones, with a step for each
 * tab of each picked system after Systems. A tab two picked systems share is
 * one step, which lists both (`systems`).
 */
export function wizardSteps(model) {
  const picked = new Set(wizardSystems(model));
  const byTab = new Map();
  for (const s of GAME_SYSTEMS) {
    if (!picked.has(s.id)) continue;
    for (const tab of s.tabs) {
      if (!byTab.has(tab)) byTab.set(tab, []);
      byTab.get(tab).push(s.id);
    }
  }
  const systems = [...byTab].map(([tab, ids]) => ({ id: `system:${tab}`, tab, systems: ids }));
  return [...BEFORE, ...systems, ...AFTER];
}

/** Whether the guide is open, the step it is on, and that step's neighbors. */
export function wizardState(model) {
  const saved = model.data.uiPrefs?.wizard;
  const steps = wizardSteps(model);
  const found = steps.findIndex((s) => s.id === saved?.step);
  const index = found < 0 ? 0 : found;
  return {
    on: saved?.on === true && !model.data.monster,
    steps,
    index,
    step: steps[index],
    back: steps[index - 1] || null,
    next: steps[index + 1] || null,
  };
}

/** Write the guide's saved state and tell the sheet. */
function save(model, changes) {
  const prefs = model.data.uiPrefs || (model.data.uiPrefs = {});
  prefs.wizard = { ...(prefs.wizard || {}), ...changes };
  emit(model, { type: 'wizard', ...changes });
  return model;
}

/**
 * Open the guide, on `step` or where it was left. The guide works on the
 * build view's tabs, so a sheet in the session view is switched over.
 */
export function startWizard(model, step = null) {
  if (model.data.monster) return model;
  if (model.viewMode() !== 'build') model.setViewMode('build');
  const steps = wizardSteps(model);
  const wanted = step ?? model.data.uiPrefs?.wizard?.step;
  return save(model, {
    on: true,
    step: steps.some((s) => s.id === wanted) ? wanted : steps[0].id,
    // Stored from here on, so a system unpicked later stays unpicked.
    systems: wizardSystems(model),
  });
}

/** Close the guide. The step and the picked systems are kept for the next time. */
export function closeWizard(model) {
  return save(model, { on: false });
}

/** Go to a step by id; an id that is not a step changes nothing. */
export function setWizardStep(model, id) {
  if (!wizardSteps(model).some((s) => s.id === id)) return model;
  return save(model, { step: id });
}

/**
 * Pick a system, or take the pick back.
 *
 * Picking puts the system's tabs on the build bar. Taking it back takes off
 * the tabs no other picked system uses, unless the tab holds data: that data
 * is the character's, and its tab stays where it can be seen.
 */
export function toggleWizardSystem(model, id) {
  const system = GAME_SYSTEMS.find((s) => s.id === id);
  if (!system) return model;
  if (model.viewMode() !== 'build') model.setViewMode('build');
  const was = wizardSystems(model);
  const on = !was.includes(id);
  const now = GAME_SYSTEMS.map((s) => s.id).filter((x) => (x === id ? on : was.includes(x)));
  if (on) {
    for (const tab of system.tabs) model.showTab(tab);
  } else {
    const needed = new Set(GAME_SYSTEMS.filter((s) => now.includes(s.id)).flatMap((s) => s.tabs));
    const inUse = model.systemTabsInUse();
    for (const tab of system.tabs) if (!needed.has(tab) && !inUse[tab]) model.hideTab(tab);
  }
  return save(model, { systems: now.filter((x) => KNOWN.has(x)) });
}
