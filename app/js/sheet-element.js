/**
 * sheet-element.js -- the <character-sheet> custom element.
 *
 * Embedding contract (this is the piece meant to drop into an existing site):
 *
 *   <script type="module" src=".../sheet-element.js"></script>
 *   <character-sheet src="/characters/your-character.json"></character-sheet>
 *
 * Attributes
 *   src    URL of a character JSON document
 *   role   "player" (default) or "admin" -- admin reveals the formula audit tab
 *   published  present on a sheet the reader was sent rather than owns: hides
 *          Save, History, Import and Reset, and keeps Export JSON
 *   packs  "none" skips this browser's extension packs entirely, so the sheet
 *          shows only what the document itself carries. This is what a
 *          published view wants: a reader who happens to own the same packs
 *          would otherwise see them quietly filling in gaps that a stranger
 *          gets empty, which is the one thing a preview must not do.
 *   theme  "dark" (default) or "light"
 *   storage-key  localStorage key for edits; omit to disable persistence
 *   snapshot-every  changes between automatic snapshots (default 20)
 *   hotkeys  "off" stops the sheet claiming Ctrl+K on the host page (see
 *            #onDocumentKey and docs/embedding.md)
 *
 * Properties / methods
 *   .character = {...}      load a document directly, no fetch
 *   .model                  the live Character instance
 *   .toJSON()               current state, for saving server-side
 *   .audit()                every player-authored formula, as plain data
 *   .whenReady()            resolves once stored state has been reconciled
 *   .changeCount            changes between the saved version and the sheet
 *
 * Events
 *   character-change  {detail:{character, diff}}  fired on any edit
 *   tracker-change    {detail:{tracker}}
 *   character-import  {detail:{character, summary, warnings}}  a document came in through Import
 *   extension-import  {detail:{extension}}  an extension pack came in through Import;
 *                     preventDefault() to say a host page took it (see extension-manager.js)
 *
 * State is kept in three places, and `history.js` explains why each is where it
 * is: the working sheet in localStorage, the canonical saved version and the
 * snapshot history in IndexedDB. The sheet opens on the canonical version, and
 * offers to pick up anything unsaved it finds.
 *
 * Everything renders into a shadow root, so the host page's CSS and the
 * sheet's CSS cannot collide.
 */

import {
  Character, inspectDocument, maneuverCatalogue, TEMPLATE_TYPES,
  castingTableNames,
  psionicTables, psionicCurveTotals,
  CARD_COLORS, CARD_MODIFICATIONS, deckManipulationCatalogue, deckManipulation,
  TECHNIQUE_SLOTS, TECHNIQUE_STATUSES, techniqueTitle,
  COOKING_COURSES, cookingTables, cookingDish, normalizeDish, emptyDish,
  MATERIAL_CASTING_PER_LEVEL, optionCatalogues, skillForwardKey, describeSource, weaponHandle,
  classForwardKey, gearColumnInUse,
} from './model.js';
import { runtime as extensionRuntime } from './extension-runtime.js';
import {
  applyBlock, BLOCK_KINDS, looksLikeExtension, archetypeStatus, removeArchetype, swapLabel,
} from './extensions.js';
import { describePublish, publishDocument } from './publish.js';
import { SHEET_LINK, adoptSheetStyles } from './styles.js';
import {
  esc, val, abilityKey, picksAbility, abAttr, abKeyAttr, EXPR_HINT, ABILITY_LABELS_LIST,
} from './ui/html.js';
import * as fields from './ui/fields.js';
import * as rows from './ui/rows.js';
import { showBrackets, hideBrackets } from './ui/brackets.js';
import * as badges from './ui/badges.js';
import * as roll from './ui/roll.js';
import * as palette from './ui/palette.js';
import * as overview from './ui/panels/overview.js';
import * as combat from './ui/panels/combat.js';
import * as guile from './ui/panels/guile.js';
import * as subsystems from './ui/panels/subsystems.js';
import { slotSpend } from './ui/panels/subsystems.js';
import * as lore from './ui/panels/lore.js';
import * as admin from './ui/panels/admin.js';
import { renderGearPanel, renderCraftingPanel, weaponsPanel, wealthPanel } from './ui/panels/gear.js';
import * as trackerUi from './ui/panels/trackers.js';
import { round, group, pct, same, PIP_LIMIT } from './ui/format.js';
import * as prose from './ui/prose.js';
import { renderStatsPanel, pickSelect, mythicPickAt } from './ui/panels/stats.js';
import { renderSkillsPanel } from './ui/panels/skills.js';
import {
  fmt, iterativeAttacks, ABILITY_LABELS, ABILITIES, BUILD_TEMPORARY,
  BUILD_PERMANENT_GROUPS, BUILD_OPTIONAL_KEYS, SAVE_BONUS_TYPES, AC_BONUS_TYPES,
  BUILD_DERIVED_KEYS, PROWESS_TRACKS, ABP_LEVELS, ARRAY_LEVELS, LEVEL4_LEVELS,
  ENHANCEMENT_CAP, ATTUNEMENT_BONUS, ATTUNEMENT_MIN_LEVEL, MENTAL_PROWESS_LEVELS,
  PHYSICAL_PROWESS_LEVELS, ARRAY_SLOTS, SIZE_MODIFIERS,
  ABP_LINKED_LEVELS, abpSourceLevel,
  CASTING_TYPES, PRACTITIONER_TYPES, TALENT_RATES, COMBAT_SPHERES, MAGIC_SPHERES,
  BACKGROUND_SKILLS, UNARMED_SPHERES, TRAIT_CATEGORIES, TRAIT_SLOTS,
  PERFORM_CATEGORIES, VARIANT_SKILLS, skillVariantKind, skillVariantRoot, skillLabel,
  parseLevelRule, levelRuleLevels, summariseLevels,
  MYTHIC_PATH_HP, MYTHIC_STAT_TIERS, MYTHIC_TRADITION_SLOTS, MYTHIC_TIERS,
  MYTHIC_TIER_LEVEL, mythicTierGrant,
  GEAR_BONUS_TYPES, WEAPON_ATTACK_TYPES, WEAPON_GROUPS, WEAPON_HANDEDNESS,
  WEAPON_FAMILIARITY, WEAPON_CRIT_MULTS, diceString,
  ARMOR_PROFICIENCIES, SHIELD_PROFICIENCIES,
  ATTACK_MODES, ATTACK_MODE_LABELS, ALT_ATTACK_OF, ATTACK_MODE_KEY, attackModeTotal,
  attackModeAbility,
  CRAFT_SPEED_KINDS, CRAFT_CHECK_MODES, CRAFT_TIME_BASES, CRAFT_SPEED_MULTIPLIER,
  BLENDED_SPHERES, sphereSide, conditionInfo, trackSpheres, TRACK_SPHERE_SIDES, TRACK_SPHERE_LABELS,
  TRACK_SPHERE_NOUNS,
  ABP_DEFENCE_GROUPS, ABP_DEFENCE_CAP, abpGroupTotal,
  TALENTED_KNUCKLE_TALENTS, BRAWLERS_VEST_TALENTS, ASURA_TALENTS_PER_ESSENCE,
  VEIL_SLOTS, ESSENCE_SOURCES, SP_PER_TEMP_ESSENCE,
  MANEUVER_TYPES, SPELL_LEVELS, wikiUrl, WIKI_BASE,
  PREP_STYLES, CASTING_SOURCES, prepStyle, castingNoun,
  PRIMORDIA_NAMES, PRIMORDIA_TECHNIQUES, PRIMORDIA_REPEAT_FROM, EITR_URL,
  mergeLayout, GAME_SYSTEMS, CONDITIONS, CONDITION_CATS, BUFF_MOD_KEYS, BUFF_TARGETS,
  conditionTotals, statModDelta, stepDiceMap, addDice,
} from './rules.js';
import {
  COMPANION_LABELS, NATURAL_ATTACKS, BODY_TYPES, COMPANION_LEVEL_SOURCES,
  ABILITY_INCREASE_LEVELS,
} from './companions.js';
import { evaluateFormula, analyse, resolvePath } from './formula.js';
import { highlight, highlightFlagging, workingLine, workings, pretty } from './formula-format.js';
import {
  formulaPanelHtml, workingHtml, browserHtml, myFormulasHtml, forwardedHtml, valueGroups,
  targetsHtml, targetGroups,
} from './formula-guide.js';
import { hasTokens, formatValue } from './inline.js';
import {
  historyFor, countChanges, requestPersistence, SNAPSHOT_EVERY, AUTO_KEEP,
} from './history.js';
import {
  TRACKER_PALETTE, THEME_ACCENT, THEME_NEGATIVE, normalizeStyle, normalizeHex, isDefaultStyle,
  resolveZones, zoneAt, stepColor, barLayout, squareLayout, barClickValue, rgba,
  trackBand, readableOn,
} from './tracker-style.js';
import {
  ROLL_FORMATS, DEFAULT_ROLL_FORMAT, rollSpec, rollText, WEAPON_MODE_KEYS,
} from './roll20.js';

/**
 * What the gold left edge on a field means, in the two flavours it comes in:
 * prose that may carry {…} tokens anywhere in the text, and a field whose
 * whole value may be written as an expression.
 */
/**
 * The die on a roll button: a hexagon -- a d20's silhouette -- with the face
 * you would read on top of it. Drawn rather than typed, because Unicode's dice
 * characters are all six-sided and an emoji would take the host page's font.
 */
/** Which Roll20 shape the buttons copy. A player preference, so it is theirs. */
const ROLL_FORMAT_KEY = 'cs-roll20-format';

function readRollFormat() {
  try {
    const saved = globalThis.localStorage?.getItem(ROLL_FORMAT_KEY);
    if (ROLL_FORMATS.some(([key]) => key === saved)) return saved;
  } catch { /* an embed with storage blocked keeps the default */ }
  return DEFAULT_ROLL_FORMAT;
}

function writeRollFormat(format) {
  try { globalThis.localStorage?.setItem(ROLL_FORMAT_KEY, format); } catch { /* not fatal */ }
}

/**
 * The palette's three numbers: how many rows a page of results is, what one
 * costs in pixels (for PageUp/PageDown, which have to guess), and how many
 * picks it remembers. The recent list is held for the session rather than
 * saved -- one browser holds many characters, and a palette that opens on
 * somebody else's last five choices would be worse than one that opens on the
 * character's own vitals.
 */
const PALETTE_PAGE = 40;
const PALETTE_ROW_PX = 46;
const PALETTE_RECENT = 8;

const TABS = [
  ['overview', 'Overview'],
  ['stats', 'Stats'],
  ['skills', 'Skills'],
  ['martial', 'Martial Spheres'],
  ['magic', 'Magic Spheres'],
  ['guile', 'Guile Spheres'],
  ['features', 'Feats & Mythic'],
  ['primordia', 'Primordia'],
  ['gear', 'Equipment'],
  ['crafting', 'Crafting'],
  ['akashic', 'Akashic'],
  ['maneuvers', 'Maneuvers'],
  ['vancian', 'Vancian'],
  ['psionics', 'Psionics'],
  ['cardcasting', 'Cardcasting'],
  ['techniques', 'Technique List'],
  ['autoTechnique', 'AutoTechnique'],
  ['cooking', 'Auto-Cooking'],
  ['template', 'Template'],
  ['familiar', 'Familiar'],
  ['animalCompanion', 'Animal Companion'],
  ['eidolon', 'Eidolon'],
  ['trackers', 'Trackers'],
  ['progression', 'Progression'],
  ['extras', 'Extras & Notes'],
  ['lore', 'Lore'],
  ['formulas', 'Formulas'],
  ['audit', 'Formula Audit'],
];

/**
 * Tabs that are not the player's to arrange: the Formula Audit, which only an
 * admin sees, and the Formulas guide, which is help rather than character data
 * and so is always on the end of the bar where it can be found.
 */
const FIXED_TABS = new Set(['audit', 'formulas']);

/** The modelled sub-systems: tabs whose visibility the ⚙ manager controls by key. */
const MODELLED_TAB_IDS = new Set([
  'akashic', 'maneuvers', 'vancian', 'psionics', 'cardcasting', 'template',
  'techniques', 'autoTechnique', 'cooking',
  'familiar', 'animalCompanion', 'eidolon',
]);

/**
 * Sub-systems odd enough to sit in their own corner of the manager: a deck a
 * character casts off, the technique machinery, and the iron chef's kitchen.
 * Matched by label so a worksheet named for the system lands there too.
 */
const WEIRD_TAB_LABELS = new Set(['cardcasting', 'technique list', 'autotechnique', 'auto-cooking']);
const isWeirdTab = (label) => WEIRD_TAB_LABELS.has(String(label || '').trim().toLowerCase());



/**
 * Past this many steps a row of pips is a wall rather than a reading, so the
 * pip shape draws nothing and a meter falls back to its bar.
 */



/**
 * Register the shared reference tables once: the discipline catalogue, the
 * casting and manifesting tables, deck manipulations, cooking ingredients.
 *
 * None of them ship with the engine. They come from extension packs -- the
 * ones a deployment bundles under data/extensions/ and the ones this browser
 * holds locally -- merged by the extension runtime, which every character on
 * the page shares. A missing pack is not fatal: without the catalogue a
 * discipline still lists what the character knows and simply has no maneuvers
 * to offer, and without a casting table a casting class keeps its own numbers.
 * Both beat refusing to load at all.
 */
function loadSharedTables() {
  return extensionRuntime.load(new URL('../../', import.meta.url));
}

/**
 * The same, unless this sheet was asked to stand on its own.
 *
 * `packs="none"` is for a published document, which carries the entries the
 * character had and nothing else (see publish.js). Loading the reader's own
 * packs on top would fill in whatever they happen to own, so the sheet would
 * look complete to the one person who cannot tell whether it is.
 */
function loadTablesFor(el) {
  return el.getAttribute('packs') === 'none' ? Promise.resolve() : loadSharedTables();
}

/**
 * The buttons a published sheet leaves working, as one selector.
 *
 * Everything here moves the reader around the character or takes a copy of it;
 * nothing here changes it. `data-collapse` folds a panel, `data-tab` opens one,
 * `data-mopen` and `data-mclose` open and shut a maneuver's card, `data-gearopen`
 * does the same for an item, `data-foldcell` unfolds a cell of prose. The named
 * actions are the sheet's own furniture -- search, the view switch, the theme,
 * the formula tab -- plus Export JSON, because a read-only sheet is still the
 * reader's to take away, and the two dismiss buttons, which only close a notice
 * this page put up.
 *
 * Anything that opens is paired with what shuts it. Leaving a card openable and
 * not closeable is the kind of half-locked state that reads as a broken sheet
 * rather than a read-only one.
 *
 * `<details>` needs no help: the browser opens it whatever this does.
 */
const READERS_KEEP = [
  '[data-tab]', '[data-collapse]', '[data-foldcell]', '[data-wiki]',
  '[data-mopen]', '[data-mclose]', '[data-gearopen]',
  '[data-action="palette"]', '[data-action="view-mode"]', '[data-action="formulas"]',
  '[data-action="theme"]', '[data-action="export"]', '[data-action="copy-text"]',
  '[data-action="goto-trackers"]', '[data-action="ext-filter"]',
  '[data-action="toggle-gear"]', '[data-action="toggle-weapon"]', '[data-action="toggle-skills"]',
  '[data-action="dismiss-history-note"]', '[data-action="dismiss-import-error"]',
].join(',');









/**
 * When a stored state was written, as a person would say it.
 *
 * A history list is read to answer "which one do I want", and for anything from
 * the last day that question is answered by the clock rather than the date.
 * Older entries get the date, because "23 hours ago" stops being useful the
 * moment it could mean yesterday morning.
 */
function whenText(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'an unknown time';
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago, ${time}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago, ${time}`;
  return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Read a control's value according to the coercion its data-kind asks for. */
function readControl(input) {
  const kind = input.dataset.kind || (input.type === 'number' ? 'number' : 'text');
  if (kind === 'bool') return input.checked;
  // A switch stored as 0/1: a condition ticked here exports as the number the
  // workbook's own named range holds, not as true/false.
  if (kind === 'flag') return input.checked ? 1 : 0;
  if (kind === 'number-or-null') {
    if (String(input.value).trim() === '') return null;
    const n = Number(input.value);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'number') {
    const n = Number(input.value);
    return Number.isFinite(n) ? n : 0;
  }
  if (kind === 'rank') {
    // Skill ranks: keep integers as numbers, anything else as formula text.
    const raw = String(input.value).trim();
    if (raw === '') return 0;
    if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
    return raw;
  }
  if (kind === 'expr') {
    // Crafting amounts: a plain number stays a number, anything else is a
    // formula the model resolves in the sandbox.
    const raw = String(input.value).trim();
    if (raw === '') return 0;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }
  return input.value;
}

/**
 * Paths whose edits can change a number shown elsewhere on the sheet.
 *
 * Everything else -- raw sheet grids, planner rows, notes, feat text -- is
 * plain data, so the control already shows the new value and a re-render would
 * only cost time. The biggest grids run to several thousand inputs, where a
 * needless rebuild is plainly laggy.
 */
const AFFECTS_DERIVED = /^(abilities|attack|saves|defenses|carry|hp|conditions|buffs|effects|statsBuild|progressionPicks|mythic|mythicStatPicks|progression|skills|skillBudget|weapons|classes|equipment|crafting|akashic|maneuvers|vancian|psionics|cardcasting|primordia|techniques|cooking|wealth|familiar|animalCompanion|eidolon|training|specialtySkills|traitSlots|raceTraits|identity\.(level|size|heroPoints|primordiaTechnique|speeds|languageExtra|languages|proficiencies))/;

/** Two names the player typed, or a pack wrote, meaning the same thing. */
/**
 * The input types a caret can be put back into after a re-render.
 *
 * `setSelectionRange` throws on the rest -- number, email, date, colour -- so
 * `#rerender` has to ask before it restores. This was `type === 'text'`, which
 * quietly excluded the block shelf's `type="search"` box: the caret landed at
 * 0 after every keystroke and each new character was inserted in front of the
 * last, so a search for "asdf" filtered on "fdsa". The set is the standard
 * one rather than "text and search", so the next field to be typed into is not
 * the next thing to type backwards.
 */
const CARET_TYPES = new Set(['text', 'search', 'url', 'tel', 'password']);

/** A stable identifier for a control, so focus survives a re-render. */
function controlKey(input) {
  if (!input) return null;
  const attr = input.dataset.set ? `set:${input.dataset.set}`
    : input.dataset.item ? `item:${input.dataset.item}`
      : input.dataset.build ? `build:${input.dataset.build}`
        : input.dataset.offset ? `offset:${input.dataset.offset}`
          : input.dataset.pick ? `pick:${input.dataset.pick}`
            : input.dataset.extSearch ? `extsearch:${input.dataset.extSearch}` : null;
  return attr;
}

/**
 * Is this element one somebody is typing into?
 *
 * Asked of a key that would otherwise be swallowed -- Ctrl+K from the host
 * page, `/` on the sheet -- so that a shortcut never eats a keystroke meant
 * for a field.
 */
function isTypingIn(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export class CharacterSheetElement extends HTMLElement {
  static observedAttributes = ['src', 'role', 'theme'];

  #model = null;
  #sourceDoc = null;        // the document as loaded, before any local edits
  #importError = null;      // why the last offered file was refused
  /*
   * Saving, and going back.
   *
   * `#history` is this character's store. `#savedDoc` is the canonical version
   * it opened on, kept in memory because every change count is measured against
   * it. `#changes` is that count; `#snapshotAt` is what it stood at when the
   * last automatic snapshot was taken, so snapshots land every
   * `SNAPSHOT_EVERY` changes rather than on every edit once the threshold is
   * passed. `#resume` is an offer to pick up unsaved work found on load.
   */
  #history = null;
  #savedDoc = null;
  #openedDoc = null;        // stands in for a saved version until there is one
  #changes = 0;
  #snapshotAt = 0;
  #resume = null;
  #showHistory = false;
  #snapshots = [];
  #historyNote = null;      // "Saved", "Restored ..." -- clears on the next action
  #storageFailed = false;   // the working state is not being written -- see #writeWorking
  #tabColorFor = null;      // { key, label, x, y } while the tab colour panel is open
  #roBoxObserver = null;    // watches the width of the self-sizing read-only boxes
  #checkpointDraft = '';
  #renameDraft = null;      // { key, label } while a checkpoint is being renamed
  #snapshotTimer = null;
  #adopting = null;
  #tab = 'overview';
  #draft = { name: '', formula: '', minFormula: '', refresh: '', note: '' };
  #menuLists = new Map();   // option menus a render's feature cells offer, name -> {id, menu}
  #editTracker = null;   // id of the custom tracker being edited in place
  #editMeter = null;     // key of the built-in meter whose style is open ('hp', 'essence')
  #editDraft = { name: '', maxFormula: '', minFormula: '', refresh: '', note: '', style: normalizeStyle(null) };
  #showAllSkills = false;
  #showAllGear = false;
  /**
   * Which gear item is open as a card ("equipment.gear|3"), or null.
   *
   * Element state, not the character's: which row somebody is reading is a
   * way of looking at the list, not a fact about what they are carrying.
   */
  #openGear = null;
  /** Which gear column's − has been armed ("equipment.gear|bonuses"), or null. */
  #armedGearCol = null;
  #confirmDelete = null;
  /** The class whose feature group is one click from being deleted, or null. */
  #confirmGroup = null;
  /** Which Classes row has its sub-system picker open (index, or null). */
  #openClassSystems = null;
  /** Whether the dashboard's grouped condition picker is unfolded. */
  #condPickerOpen = false;
  /** Which buff row has its editor open (index, or null). */
  #openBuff = null;
  /** Whether the header's Reset is asking to be armed (type RESET to confirm). */
  #confirmReset = false;
  /** Whether the rail's `⋯` menu is open. */
  #chromeMenu = false;
  /** Whether the dashboard's card arranger is open. */
  #dashArrange = false;
  /** Which maneuver is open ("<list>|<name>", or null). One at a time. */
  #openManeuver = null;
  /** Whether the open maneuver is showing its cells rather than reading them. */
  #maneuverEdit = false;

  /**
   * Which shaped veil is showing what the player wrote rather than what its
   * pack says. Not saved with the character: it is a way of reading the tab.
   */
  #veilEdit = null;
  /** Which folded table cell is open ("mythic:3:effect", or null). One at a time. */
  #openCell = null;
  /** The armed two-click × ("<list>|<index>", or null): first click arms, second removes. */
  #armedRemove = null;
  #openPosts = new Map();   // generated crafting post -> expanded?
  // Template tables showing every stored cell rather than the merges they
  // describe. An editing mode rather than a preference, so it is not saved.
  #showCells = new Set();
  /** Which face of the Cardcasting tab is up: the table in play, or the deck. */
  #deckView = 'table';
  /** Cards peeked at with Read the Cards, by id, until the next action. */
  #peek = [];
  /** Which kind of extension block the ⚙ manager's list is narrowed to ('' = all). */
  #extFilter = '';
  #extSearch = '';   // what is typed into the block shelf's search box
  /* The Formulas tab. Working state, not character data: what is in the
     try-it box, what the one search box is narrowing to, and whether the
     reference underneath has been unfolded. */
  #formulaDraft = '';
  #formulaQuery = '';
  #formulaRefOpen = false;
  /** The last roll copied, shown back so the player can see what they got. */
  #rollToast = null;    // { kind, ref, what, text, failed }
  #rollToastTimer = null;
  /* What the last structural change was, offered back. One slot, shared with
     the roll toast: both report the last thing that happened, and there is
     only ever one last thing. */
  #undoToast = null;    // { label }
  #undoToastTimer = null;
  /**
   * Roll template or bare /roll. A preference of the person playing rather than
   * of the character -- their Roll20 game is what decides it -- so it lives in
   * localStorage beside the library, not in the document. An embed without
   * storage falls back to the field's own value for the session.
   */
  #rollFormat = readRollFormat();
  /**
   * The search palette (Ctrl+K).
   *
   * The <dialog> is built once per opening and kept here rather than looked up,
   * because a render throws every node in the shadow root away and this one has
   * to survive it: the reference keeps it alive with its listeners, and the
   * render puts it back (see the end of #render). Everything else is what the
   * open palette is showing -- the index it searched, the rows it found, and
   * where the selection sits.
   */
  #palette = null;
  #paletteIndex = null;
  #paletteRows = [];
  #paletteAt = 0;
  #paletteShown = 0;
  #paletteTerms = [];
  #paletteFrame = 0;
  #paletteReturn = null;    // what had focus when it opened
  /** The last few things picked, newest first: an empty box opens on them. */
  #paletteRecent = [];
  /**
   * A tab reached from the palette that is not on the bar.
   *
   * Search can find something on a tab this view has hidden -- most of the
   * sheet is hidden in the session view -- and hiding a tab should not put its
   * contents out of reach. So the bar grows a guest entry for as long as you
   * are on it, and drops it the moment you leave. View state, not a tab order:
   * nothing is written to the character.
   */
  #visitTab = null;

  constructor() {
    super();
    // The stylesheet is adopted once, here: it survives the innerHTML
    // rewrites a render does, so no render has to put it back.
    adoptSheetStyles(this.attachShadow({ mode: 'open' }));
  }

  /**
   * A pack switched on or off in the page's extension manager changes what a
   * discipline offers and which blocks the ⚙ manager lists, so the sheet
   * recomputes and redraws -- the model's data is untouched.
   */
  #onExtensionsChange = () => {
    if (!this.#model) return;
    this.#model.recompute();
    this.#render();
  };

  /**
   * Ctrl+K from anywhere on the page.
   *
   * Inside the sheet the shadow root's own handler is enough; this is what
   * catches the shortcut when focus is on the host page -- the picker, the
   * body, a heading -- which is where it usually is when someone reaches for
   * search. It stays a good guest about it: a host that handles the key first
   * and calls preventDefault keeps it, a host page's own text field keeps it,
   * and `hotkeys="off"` turns it off outright (see docs/embedding.md).
   */
  #onDocumentKey = (e) => {
    if (e.defaultPrevented || !this.#model) return;
    if (this.getAttribute('hotkeys') === 'off') return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key?.toLowerCase();
    if (key !== 'k' && key !== 's' && key !== 'z') return;
    // The path, not `contains`: an event from inside the shadow root is
    // retargeted at the host, and `contains` cannot see across the boundary.
    const path = e.composedPath?.() || [];
    const inside = path.includes(this);
    /*
     * Ctrl+S saves, which is the one verb on the sheet that had no key at all
     * -- and the one the browser's own Ctrl+S is most likely to be mistaken
     * for, since "save this page" is never what anyone meant here. Only when
     * the sheet is what is being used, though: a host page's own field keeps
     * the key, and so does a page with no sheet in focus, because taking
     * Ctrl+S away from a document someone is editing elsewhere is worse than
     * not having it.
     */
    if (key === 's') {
      if (!inside || this.isPublished || !this.#changes) return;
      e.preventDefault();
      this.#action('save');
      return;
    }
    /*
     * Ctrl+Z takes back the last row that was removed -- and only ever that.
     * A field has an undo of its own that works per character rather than per
     * commit, and it is better at typing than anything here would be, so the
     * key is left alone wherever a caret is standing. Shift is left alone too:
     * there is no redo, and taking the key for nothing would be worse than not
     * taking it.
     */
    if (key === 'z') {
      if (!inside || e.shiftKey || this.isPublished) return;
      if (isTypingIn(path[0] ?? e.target)) return;
      if (!this.#model?.undoLabel) return;
      e.preventDefault();
      this.#undo();
      return;
    }
    // Typing somewhere else on the page: leave the key to whoever is typing.
    if (!inside && isTypingIn(path[0] ?? e.target)) return;
    e.preventDefault();
    this.#togglePalette();
  };

  connectedCallback() {
    if (!this.hasAttribute('theme')) this.setAttribute('theme', 'dark');
    this.#bindBracketMatching();
    this.#renderShell();
    extensionRuntime.addEventListener('change', this.#onExtensionsChange);
    this.ownerDocument.addEventListener('keydown', this.#onDocumentKey);
    this.shadowRoot.addEventListener('pointerdown', this.#onPointerDownAway, true);
    const src = this.getAttribute('src');
    if (src && !this.#model) this.load(src);
  }

  disconnectedCallback() {
    extensionRuntime.removeEventListener('change', this.#onExtensionsChange);
    this.ownerDocument.removeEventListener('keydown', this.#onDocumentKey);
    this.shadowRoot.removeEventListener('pointerdown', this.#onPointerDownAway, true);
    this.#closePalette();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === 'src' && newValue) this.load(newValue);
    else if (this.#model) this.#render();
  }

  /* ---------------- public API ---------------- */

  get model() { return this.#model; }

  set character(doc) {
    // Adopting reads the canonical version out of IndexedDB, so it cannot be
    // synchronous. The promise is kept for `whenReady()` and for `load()`.
    this.#adopting = this.#adopt(doc);
  }

  get character() { return this.#model?.toJSON() ?? null; }

  /** Resolves once the sheet has settled on which stored state to show. */
  whenReady() { return this.#adopting ?? Promise.resolve(); }

  /**
   * Decide which version of this character to open, and show it.
   *
   * Three documents can be in play. `doc` is the sheet as converted or
   * imported. The *working* state is where the player last left off, written on
   * every edit. The *canonical* version is what they last pressed Save on, and
   * that is what opens -- so Save means something, and so a session of
   * experiments does not silently become the character.
   *
   * Unsaved work is never dropped on the floor for that. When the working state
   * has drifted from the canonical one, it is filed as a snapshot before
   * anything else happens, and the offer to pick it up points at that snapshot.
   * So the recovery survives ignoring the banner, closing the tab, or a crash
   * two minutes later -- it is in the history like any other earlier state.
   */
  async #adopt(doc) {
    // A palette left open over an import would be searching the character that
    // just left, and so would its list of recent picks.
    this.#closePalette();
    this.#paletteRecent = [];
    // The shared tables -- the maneuver catalogue, casting and power-point
    // tables, deck manipulations, the iron chef's ingredients -- have to be in
    // place before the model is built, whichever way the document arrived. Once
    // they were fetched by `load(src)` alone, and a character handed in through
    // this property (every imported one, and every one at all now that the app
    // bundles none) opened with its disciplines "not in the catalogue".
    await loadTablesFor(this);
    // Kept pristine so Reset works for a document handed in directly, where
    // there is no src to re-fetch.
    this.#sourceDoc = structuredClone(doc);
    this.#history = historyFor(doc?.id ?? 'character',
      { storageKey: this.getAttribute('storage-key') });
    // Ask once that this browser keep what it is about to be given. A published
    // view is exempt: it writes nothing down, so asking a stranger's browser to
    // set aside durable room for a sheet it will not keep is a prompt for
    // nothing. Deliberately not awaited -- the answer changes no code path here.
    if (!this.isPublished) requestPersistence();
    this.#resume = null;
    this.#historyNote = null;
    this.#showHistory = false;
    this.#snapshotAt = 0;

    /*
     * A published document is the whole truth and nothing stored here outranks
     * it. What this browser holds under the same id is a different copy of the
     * character -- and on a preview it is the author's own, which would quietly
     * replace the document being previewed with the one it was made from. That
     * is the single thing a preview must never do, and it is not only a preview
     * problem: two people can each be sent a sheet whose id matches one they
     * already have.
     */
    const working = this.isPublished ? null : this.#history.readWorking();
    const canonical = this.isPublished ? null : await this.#history.readSaved();
    this.#savedDoc = canonical?.data ?? null;

    // A canonical version written for an older schema cannot be loaded, but the
    // player is told rather than left wondering where their save went.
    if (canonical && !canonical.data) {
      this.#historyNote = `The saved version was written for schema ${canonical.schemaVersion}`
        + ' and cannot be opened by this build. The sheet has opened where you left off instead.';
    }

    const open = this.isPublished ? doc : (this.#savedDoc ?? working?.data ?? doc);
    let drifted = false;
    if (this.#savedDoc && working) {
      const drift = countChanges(this.#savedDoc, working.data);
      if (drift > 0) {
        drifted = true;
        this.#resume = { changes: drift, savedAt: working.savedAt, key: null, doc: working.data };
        // Filed before the working slot is reconciled below, so the recovery
        // outlives the banner rather than depending on it.
        try {
          const filed = await this.#history.snapshot(working.data, drift);
          this.#resume.key = filed.key;
        } catch { /* no room or no database: the offer stands for this session */ }
      }
    }

    this.#adoptDocument(open);
    /*
     * The working slot is only rewritten when it had drifted, and then only to
     * settle it against what is now on screen -- otherwise the next reload would
     * find the same drift and file the same snapshot again.
     *
     * It must not be written in any other case. An imported document whose id
     * collides with a character already in the library is adopted once under
     * that id before the picker renames it, and a write here would land on the
     * other character's state.
     */
    if (drifted) this.#writeWorking();
    if (!this.isPublished) await this.#refreshSnapshots();
    this.#render();
  }

  /**
   * Build the model from one document and start watching it.
   *
   * Deliberately does not touch `#sourceDoc`: restoring a snapshot must not
   * redefine what "as imported" means, or Reset would quietly come to mean
   * "back to whichever old state I last looked at".
   */
  #adoptDocument(doc) {
    this.#model = new Character(structuredClone(doc));
    /*
     * Settle the play state before anything is measured.
     *
     * `hpState` fills in current, temporary and nonlethal hit points the first
     * time it is read, which is when the Overview draws the damage bar. Taking
     * the baseline before that happens means those three fields materialise
     * afterwards and read as three changes the player never made -- visible as a
     * sheet that opens clean, then refuses to go back below "3 changes" however
     * much is undone.
     */
    void this.#model.hpState;
    const normalized = this.#model.toJSON();
    // Cloned, not kept: `toJSON()` spreads `this.data` shallowly, so the object
    // it returns shares every nested branch with the live model. Holding it as
    // the baseline would mean comparing the sheet against itself, and the change
    // count would sit at zero forever.
    if (!this.#savedDoc) this.#openedDoc = structuredClone(normalized);
    this.#changes = this.#baseline ? countChanges(this.#baseline, normalized) : 0;
    this.#model.subscribe((_model, detail) => {
      // Something destructive is about to happen and has already saved the
      // way back; offer it. Before the change rather than after, which is
      // fine: the render that follows draws the toast from the same field.
      if (detail?.type === 'undo-mark') this.#showUndoToast(detail.label);
      this.#persist();
      this.dispatchEvent(new CustomEvent('character-change', {
        detail: { character: this.#model.toJSON(), diff: this.#model.diffFromSource() },
        bubbles: true,
        composed: true,
      }));
    });
  }

  async load(src) {
    try {
      // The discipline catalogue and the casting table are shared by every
      // character and never change, so they are fetched once and kept. A
      // character still opens without them -- its disciplines simply have no
      // maneuvers to offer, and its casting classes no table to derive from.
      await loadTablesFor(this);
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      this.character = await res.json();
      await this.whenReady();
    } catch (err) {
      this.#fail(`Could not load character from ${esc(src)} — ${esc(err.message)}`);
    }
  }

  toJSON() { return this.#model?.toJSON() ?? null; }

  audit() { return this.#model?.audit() ?? []; }

  /**
   * Open this character the way someone you sent it to would receive it.
   *
   * Two things make the preview honest rather than flattering. The document is
   * put through `publishDocument` first, so it carries the pack entries this
   * character actually has and none of the catalogues they came from; and the
   * page it opens in mounts the sheet with `packs="none"`, so the reader's own
   * packs -- which here are the author's own packs -- cannot quietly fill in
   * the gaps a stranger would be left with.
   *
   * The handover goes through localStorage rather than sessionStorage, which
   * is per-tab: a tab opened with `noopener` does not inherit the opener's
   * session, and dropping `noopener` to make it would be a worse trade than
   * one key written and removed on read.
   */
  #previewPublished() {
    const { doc, report } = publishDocument(this.#model.toJSON());
    const key = `published-preview:${doc?.id || 'character'}:${Date.now()}`;
    try {
      localStorage.setItem(key, JSON.stringify({ doc, summary: describePublish(report) }));
    } catch (err) {
      this.#historyNote = `Could not open the preview — ${err.message}`;
      this.#render();
      return;
    }
    const url = new URL('../published.html', import.meta.url);
    url.searchParams.set('k', key);
    const opened = window.open(url.href, '_blank', 'noopener');
    this.#historyNote = opened
      ? `Published preview opened — ${describePublish(report)}`
      : 'The preview was blocked by the browser. Allow pop-ups for this page and try again.';
    this.#render();
  }

  get isAdmin() { return this.getAttribute('role') === 'admin'; }

  /**
   * A sheet someone was sent rather than one they own.
   *
   * It hides the controls that act on a character this reader does not have:
   * Save and History write to a store keyed by a character that is not theirs,
   * Import and Reset would replace what they were sent. Export JSON stays --
   * being handed a read-only sheet is not a reason to be unable to take the
   * data away. Nothing here is a permission: it is an honest set of controls
   * for a document that has already left its author.
   */
  get isPublished() { return this.hasAttribute('published'); }

  /* ---------------- persistence ---------------- */

  /** How far the sheet may drift from the saved version before a snapshot. */
  get #snapshotEvery() {
    const n = Number(this.getAttribute('snapshot-every'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : SNAPSHOT_EVERY;
  }

  /** Changes between the canonical version and what is on screen. */
  get changeCount() { return this.#changes; }

  /**
   * What the change count is counted from.
   *
   * The saved version once there is one. Until then it is the sheet as this page
   * opened it, because there is no other fixed point: a character that has never
   * been saved has to count from somewhere, or the Save button would sit
   * disabled at zero changes and the first save could never be made.
   *
   * Not `#sourceDoc`, which is the document as converted or imported. That is
   * the right thing for Reset to restore but the wrong thing to count against --
   * `toJSON()` normalises a document on the way out, adding tracker state and
   * dropping derived values, so an untouched sheet would open reporting dozens
   * of changes it has not made.
   */
  get #baseline() { return this.#savedDoc ?? this.#openedDoc; }

  /**
   * Every edit lands here.
   *
   * The working state is written straight away and synchronously, which is the
   * whole reason it lives in localStorage: this is the write that has to have
   * happened if the tab is closed a moment later. Counting changes and taking a
   * snapshot are neither cheap nor urgent, so they wait for the typing to stop.
   */
  #persist() {
    if (!this.#model || !this.#history) return;
    this.#writeWorking();

    clearTimeout(this.#snapshotTimer);
    this.#snapshotTimer = setTimeout(() => this.#considerSnapshot(), 800);
  }

  /**
   * Write the working state, and say so when it does not land.
   *
   * `writeWorking` has always returned whether the write happened, and until
   * now every caller threw the answer away -- so a player whose localStorage
   * was full, or who was in a private window that gives none, kept editing a
   * sheet that had quietly stopped being written down and found out when they
   * closed the tab. Silence is the one wrong answer here: the sheet cannot fix
   * it, but it can stop the player from spending an evening on a character
   * that is not going to be there.
   *
   * The banner is toggled in place rather than through `#render()`, because
   * this is called on every edit and a wholesale re-render mid-word takes the
   * caret out of whatever is being typed. It is only touched when the state
   * actually turns over, so the ordinary path costs one boolean compare.
   */
  #writeWorking() {
    const ok = this.#history.writeWorking(this.#model.toJSON()) !== false;
    if (ok === !this.#storageFailed) return ok;   // nothing has changed
    this.#storageFailed = !ok;
    const banner = this.shadowRoot?.querySelector('.savefail');
    if (banner) banner.hidden = ok;
    return ok;
  }

  /**
   * Recount the drift from the saved version, and snapshot if it has gone far
   * enough.
   *
   * The trigger is measured from `#snapshotAt` rather than from zero, so
   * snapshots fall every `snapshot-every` changes -- at 20, 40, 60 -- instead of
   * on every edit once the sheet is 20 changes out.
   */
  async #considerSnapshot() {
    if (!this.#model || !this.#history || !this.#baseline) return;
    const before = this.#changes;
    const live = this.#model.toJSON();
    this.#changes = countChanges(this.#baseline, live);

    // Drifting back towards the saved version moves the next trigger back with
    // it, or undoing twenty edits would earn a snapshot for standing still.
    if (this.#changes < this.#snapshotAt) this.#snapshotAt = this.#changes;

    if (this.#changes - this.#snapshotAt >= this.#snapshotEvery) {
      this.#snapshotAt = this.#changes;
      try {
        await this.#history.snapshot(live, this.#changes);
        await this.#refreshSnapshots();
      } catch { /* no database or no room: editing carries on regardless */ }
    }
    // The header shows the count, so it only needs redrawing when it moved.
    if (this.#changes !== before) this.#renderHeader({ gentle: true });
  }

  /** Re-read the stored history, for the panel and the button's count. */
  async #refreshSnapshots() {
    this.#snapshots = this.#history ? await this.#history.list() : [];
  }

  /**
   * Make what is on screen the canonical version.
   *
   * The change count returns to zero and the snapshot trigger resets with it, so
   * the next twenty edits are measured from here.
   */
  async #save() {
    if (!this.#model || !this.#history) return;
    const doc = this.#model.toJSON();
    try {
      await this.#history.save(doc);
      // Cloned for the same reason as in `#adoptDocument`: what `toJSON()`
      // returns still points into the live model.
      this.#savedDoc = structuredClone(doc);
      this.#changes = 0;
      this.#snapshotAt = 0;
      this.#resume = null;
      this.#historyNote = 'Saved. This is the version the sheet will open on.';
    } catch (err) {
      this.#historyNote = `Could not save — ${err.message}.`
        + ' Your edits are still here and still restored on reload.';
    }
    // Nothing outside the header depends on the saved version, and the body may
    // be several thousand inputs.
    this.#renderHeader();
  }

  /** Store the current state under a name, where nothing will evict it. */
  async #saveCheckpoint() {
    const label = this.#checkpointDraft.trim();
    if (!label || !this.#model || !this.#history) return;
    try {
      await this.#history.checkpoint(this.#model.toJSON(), label, this.#changes);
      this.#checkpointDraft = '';
      this.#historyNote = `Checkpoint “${label}” kept. Automatic snapshots will not evict it.`;
      await this.#refreshSnapshots();
    } catch (err) {
      this.#historyNote = `Could not keep that checkpoint — ${err.message}.`;
    }
    this.#renderHeader();
  }

  /**
   * Open an earlier state.
   *
   * The restored document becomes the working state, not the canonical one --
   * looking at an old state is not the same as declaring it current, and the
   * player still has to press Save to mean that. The state being left behind is
   * filed first, so a restore is itself undoable.
   */
  async #restoreSnapshot(key) {
    if (!this.#history) return;
    try {
      const doc = await this.#history.load(key);
      const current = this.#model?.toJSON();
      if (current && this.#changes > 0) {
        try { await this.#history.snapshot(current, this.#changes); } catch { /* best effort */ }
      }
      this.#adoptDocument(doc);
      this.#writeWorking();
      this.#snapshotAt = this.#changes;
      this.#resume = null;
      const when = this.#snapshots.find((s) => s.key === key);
      this.#historyNote = `Restored ${when?.label ? `“${when.label}”` : 'that snapshot'}.`
        + ' Press Save to make it the version this sheet opens on.';
      await this.#refreshSnapshots();
    } catch (err) {
      this.#historyNote = `Could not restore that — ${err.message}.`;
    }
    this.#render();
  }

  /**
   * Reset: back to the character as converted or imported.
   *
   * Takes the working state, the canonical version and the automatic snapshots
   * with it, and leaves the named checkpoints alone -- a Reset pressed by
   * mistake should not be the one action a player cannot walk back.
   */
  async resetToSource() {
    if (this.#history) await this.#history.resetKeepingCheckpoints();
    this.#savedDoc = null;
    this.#changes = 0;
    this.#snapshotAt = 0;
    this.#resume = null;
    const src = this.getAttribute('src');
    if (src) await this.load(src);
    else if (this.#sourceDoc) await this.#adopt(structuredClone(this.#sourceDoc));
  }

  /**
   * Load a parsed document, as Import does.
   *
   * The file is vetted first so a wrong or stale one says why instead of
   * half-loading. A host page listens for `character-import` to add the
   * character to its own library; the sheet itself just shows it.
   */
  importDocument(doc, warnings = []) {
    const verdict = inspectDocument(doc);
    if (!verdict.ok) {
      this.#importError = verdict.error;
      this.#render();
      return { ...verdict, warnings };
    }
    this.#importError = null;
    // An imported document is its own source: local edits made against a
    // different character must not bleed into it.
    this.removeAttribute('src');
    this.character = doc;
    this.dispatchEvent(new CustomEvent('character-import', {
      detail: { character: structuredClone(doc), summary: verdict.summary, warnings },
      bubbles: true,
      composed: true,
    }));
    return { ...verdict, warnings };
  }

  /**
   * Read a File/Blob and import it.
   *
   * Two kinds of file arrive here. A `.json` is a document this app exported.
   * An `.xlsx` is a workbook straight out of Drive, which gets transcribed on
   * the spot — so a player handed nothing but a URL can still get their own
   * character in. The converter is pulled in only when a workbook actually
   * turns up, so a host page embedding the sheet does not carry it for nothing.
   *
   * Either way the file is read here in the page. Nothing is uploaded, and the
   * workbook itself is dropped once its contents have been transcribed; only
   * the resulting document is kept.
   */
  async importFile(file) {
    const name = file.name || '';
    const fail = (message) => {
      this.#importError = message;
      this.#render();
      return { ok: false, error: message, summary: null, warnings: [] };
    };

    if (/\.xls[xm]$/i.test(name)) {
      try {
        const { convertWorkbook, warningsFor, slug } = await import('./convert.js');
        const stem = name.replace(/\.[^.]*$/, '');
        const doc = await convertWorkbook(await file.arrayBuffer(),
          { id: slug(stem), title: stem });
        return this.importDocument(doc, warningsFor(doc));
      } catch (err) {
        return fail(`${name} could not be converted — ${err.message}`);
      }
    }

    let doc;
    try {
      doc = JSON.parse(await file.text());
    } catch (err) {
      return fail(`${name} is not valid JSON — ${err.message}`);
    }
    // An extension pack is not a character. The sheet cannot store one, but a
    // host page with an extension manager can, so it is handed up rather than
    // refused; without a listener the player is told what the file was.
    if (looksLikeExtension(doc)) {
      const event = new CustomEvent('extension-import', {
        detail: { extension: doc }, bubbles: true, composed: true, cancelable: true,
      });
      this.dispatchEvent(event);
      if (event.defaultPrevented) return { ok: true, error: null, summary: null, warnings: [], extension: true };
      return fail(`${name} is an extension pack, not a character. Open the page's Extensions manager to bring it in.`);
    }
    return this.importDocument(doc);
  }

  /* ---------------- rendering ---------------- */

  #renderShell() {
    this.shadowRoot.innerHTML = `${SHEET_LINK}<div class="wrap"><p class="empty">Loading…</p></div>`;
  }

  /**
   * Re-render, then put focus back where it was.
   *
   * Editing rewrites the panel, which would otherwise drop focus mid-edit and
   * make tabbing through a row impossible.
   */
  #rerender(activeInput) {
    const key = controlKey(activeInput);
    const caret = activeInput?.selectionStart ?? null;
    this.#render();
    if (!key) return;
    const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const attr = { set: 'data-set', item: 'data-item', build: 'data-build', offset: 'data-offset', pick: 'data-pick', extsearch: 'data-ext-search' }[kind];
    const next = this.shadowRoot.querySelector(`[${attr}="${CSS.escape(ref)}"]`);
    if (!next) return;
    // A formula field that regains focus keeps showing its source. Set that
    // here rather than leaning on the focus event, which a browser window that
    // is not itself focused never fires.
    next.closest('.xf')?.classList.add('editing');
    next.focus();
    if (caret !== null && typeof next.setSelectionRange === 'function' && CARET_TYPES.has(next.type)) {
      try { next.setSelectionRange(caret, caret); } catch { /* unsupported input type */ }
    }
  }

  #fail(msg) {
    this.shadowRoot.innerHTML = `${SHEET_LINK}<div class="wrap"><div class="panel"><h3>Character sheet</h3><p class="empty">${msg}</p></div></div>`;
  }

  /**
   * Every tab the sheet could show, as one list the tab bar and the manager
   * both read: the built-in tabs, the modelled sub-systems, and the workbook's
   * own worksheets. Each has a stable `key` -- the tab id, or `sys:<name>` for
   * a worksheet -- which is what `uiPrefs.tabOrder` lists; `id` is what the
   * panel switch is keyed on (a worksheet's is by index, and its index moves).
   */
  #tabEntries() {
    const d = this.#model.data;
    const modelled = this.#modelledSystems();
    const out = [];
    for (const [id, label] of TABS) {
      if (FIXED_TABS.has(id)) continue;                // not the player's to arrange (see FIXED_TABS)
      const m = modelled[id];
      out.push({
        key: id, id, label, kind: m ? 'modelled' : 'core',
        inUse: m ? m.has || m.tagged : true, has: m ? m.has : true,
        tagged: !!m?.tagged, weird: isWeirdTab(label),
      });
    }
    (d.sheetTabs || []).forEach((tab, index) => {
      out.push({
        key: `sys:${tab.name}`, id: `sys-${index}`, label: tab.name, kind: 'system',
        index, tab, inUse: tab.rows.length > 0, weird: isWeirdTab(tab.name),
      });
    });
    return out;
  }

  /** The tab bar: entries in `tabOrder`, skipping keys that no longer exist. */
  #barEntries() {
    const byKey = new Map(this.#tabEntries().map((e) => [e.key, e]));
    return this.#model.tabOrder().map((k) => byKey.get(k)).filter(Boolean);
  }

  #render() {
    if (!this.#model) return;
    const bar = this.#barEntries();
    // A tab the search took you to that this view's bar does not carry rides
    // along as a guest, so the panel it holds can actually be shown.
    if (this.#visitTab && this.#visitTab.id !== this.#tab) this.#visitTab = null;
    if (this.#visitTab && !bar.some((e) => e.id === this.#visitTab.id)) {
      bar.push({ ...this.#visitTab, kind: 'visiting' });
    }
    // The guide sits last on every bar, and the audit after it for an admin.
    bar.push({ key: 'formulas', id: 'formulas', label: 'ƒx Formulas', kind: 'core' });
    if (this.isAdmin) bar.push({ key: 'audit', id: 'audit', label: 'Formula Audit', kind: 'core' });
    const allIds = [...bar.map((e) => e.id), 'systabs'];
    if (!allIds.includes(this.#tab)) this.#tab = bar[0]?.id ?? 'systabs';

    // Read once for the whole bar rather than per coloured tab: it is a
    // computed-style lookup, and the answer cannot change inside one render.
    const surface = this.#surface();

    this.shadowRoot.innerHTML = `
      ${SHEET_LINK}
      <div class="wrap">
        ${this.#header()}
        <div class="tabrail">
        <div class="railtop">${this.#sessionStrip()}${this.#railActions()}</div>
        <nav class="tabs" role="tablist" aria-label="Character sheet sections">
          ${bar.map((e) => {
    // A colour is a normalised `#rrggbb` or nothing, so it is safe in the
    // style attribute; the class list is built rather than written inline
    // because a tab can be both a guest and coloured.
    const color = this.#model.tabColor(e.key);
    // Two properties, not one: `--tab-color` draws the edge and the wash and is
    // the hue as picked; `--tab-ink` is what the label is set in, and is that
    // hue taken far enough to be read on this theme. See `#applyCharacterColor`.
    const tint = color ? `--tab-color:${color};--tab-ink:${readableOn(color, surface)}` : '';
    const cls = [e.kind === 'visiting' ? 'visiting' : '', color ? 'tinted' : ''].filter(Boolean).join(' ');
    return `
            <button role="tab" id="tab-${e.id}" data-tab="${e.id}" data-tabkey="${esc(e.key)}"
              aria-selected="${this.#tab === e.id}" aria-controls="sheet-panel"
              tabindex="${this.#tab === e.id ? '0' : '-1'}"
              ${cls ? `class="${cls}"` : ''}${tint ? ` style="${tint}"` : ''}
              ${e.kind === 'visiting' ? 'title="Not on this view’s bar — search took you here"' : ''}
              ${FIXED_TABS.has(e.key) || e.kind === 'visiting' ? '' : 'draggable="true"'}>${esc(e.label)}</button>`;
  }).join('')}
          <button role="tab" id="tab-systabs" data-tab="systabs" aria-selected="${this.#tab === 'systabs'}"
            aria-controls="sheet-panel" tabindex="${this.#tab === 'systabs' ? '0' : '-1'}"
            aria-label="Tabs" title="Show, hide and rearrange tabs">⚙</button>
        </nav>
        <div class="rollslot">${this.#slotHtml()}</div>
        </div>
        ${this.#tabColorMenuHtml()}
        ${this.#notices()}
        <div class="body" id="sheet-panel" role="tabpanel" aria-labelledby="tab-${this.#tab}"
          tabindex="0">${this.#panel()}</div>
      </div>`;
    this.#applyCharacterColor();
    this.#bind();
    this.#showActiveTab();
    if (this.isPublished) this.#lockPublished();
    // The palette outlives the markup around it: innerHTML dropped it, and the
    // node (with its listeners) is still here to be put back.
    if (this.#palette) this.shadowRoot.append(this.#palette);
  }

  /**
   * Take the writing out of a published sheet, and leave the reading in.
   *
   * A reader still has to be able to get around: open a tab, fold a panel
   * down, click a maneuver's name to see what it does. Those are the whole
   * value of being sent a sheet rather than a screenshot, and all three only
   * move `uiPrefs`, which on a published sheet is discarded with the tab. So
   * the split is not "interactive or not" -- it is between what changes the
   * character and what changes the view of it.
   *
   * Deny by default, because the actions that change a character outnumber the
   * ones that do not by about ten to one, and a mutation left live by an
   * oversight is worse than a fold that stops working. Fields go `readonly`
   * rather than `disabled` wherever the browser will still let the text be
   * selected: a reader who wants to copy a number out should be able to.
   *
   * This runs after every render because `#render` rewrites the markup
   * wholesale, so there is nothing here to keep in sync -- the lock is simply
   * re-applied to whatever was just drawn.
   */
  #lockPublished() {
    const root = this.shadowRoot;
    for (const el of root.querySelectorAll('input, select, textarea')) {
      // A checkbox, radio, colour well or file input has no readonly state the
      // browser honours, so those are the ones that have to be disabled.
      if (el.matches('input[type="checkbox"], input[type="radio"], input[type="color"], input[type="file"], select')) {
        el.disabled = true;
      } else {
        el.readOnly = true;
      }
    }
    for (const el of root.querySelectorAll('[draggable="true"]')) el.draggable = false;
    for (const el of root.querySelectorAll('[contenteditable="true"]')) el.contentEditable = 'false';
    for (const btn of root.querySelectorAll('button')) {
      if (!btn.matches(READERS_KEEP)) btn.disabled = true;
    }
  }

  /**
   * Light the bracket under the caret, and the one that answers it.
   *
   * Bound to the shadow root once and never again: it is delegated, and the
   * root outlives every render, so this is the one listener on the sheet that
   * must not be re-bound by #bind(). The mirror it draws lives inside the
   * field's own wrapper and is dropped with the rest of the markup on the next
   * render -- the focus that follows a render draws it again.
   *
   * Nothing here touches the model or the value. If any of it throws on a
   * browser that does something unusual with selections, the field still works
   * and the sheet still saves.
   */
  #bindBracketMatching() {
    const root = this.shadowRoot;
    const draw = (el) => { try { showBrackets(el); } catch { /* a hint, not a feature */ } };
    root.addEventListener('focusin', (e) => draw(e.target));
    root.addEventListener('focusout', (e) => hideBrackets(e.target));
    // Typing, arrow keys, clicking into the middle of a formula, and dragging
    // the field's own scroll are each a way of standing somewhere else.
    for (const kind of ['input', 'keyup', 'pointerup']) {
      root.addEventListener(kind, (e) => draw(e.target));
    }
    root.addEventListener('scroll', (e) => draw(e.target), true);
  }

  /**
   * Who this is: the portrait, the name, and the two lines under it.
   *
   * No controls. They used to live here -- ten buttons at one weight, in one
   * row, wrapping to four rows and 104px on a phone -- and they went to the
   * rail, which is the part of the sheet that stays on screen. What is left is
   * the part you read once, which is also the part that can afford to scroll
   * away. See `#railActions`.
   */
  #header() {
    const c = this.#model.data;
    const i = c.identity;
    const classes = c.classes.map((x) => x.name).filter(Boolean).join(' / ');
    const diff = this.#model.diffFromSource();
    return `
      <header class="head">
        ${i.image ? `<img class="portrait" src="${esc(i.image)}" alt="" loading="lazy">` : '<div class="portrait"></div>'}
        <div class="head-main">
          <div class="name">${val(i.name)}</div>
          <div class="subtitle">
            Level ${val(i.level)} ${val(i.race)}${i.variant ? ` (${esc(i.variant)})` : ''}
            ${classes ? ` &middot; ${esc(classes)}` : ''}
            ${i.alignment ? ` &middot; ${esc(i.alignment)}` : ''}
          </div>
          <div class="subtitle">
            ${i.mythicPath ? `${esc(i.mythicPath)} ${val(i.mythicTier)}` : ''}
            ${i.specialty ? ` &middot; ${esc(i.specialty)}` : ''}
            ${diff.length ? `<span class="dirty"> &middot; ${diff.length} value(s) changed from source sheet</span>` : ''}
          </div>
        </div>
      </header>`;
  }

  /**
   * The two controls worth a permanent place, and a menu for the other eight.
   *
   * Ten buttons at equal weight is a list, not a toolbar: everything is
   * findable and nothing is obvious, and the two that are pressed every few
   * minutes -- Search and Save -- sat fifth and first among things pressed
   * twice a month. So those two ride the rail, where they are always to hand,
   * and the rest are one press away behind `⋯`.
   *
   * Search keeps its shortcut on its face, because that is how the second
   * press of it stops needing the button. Save wears the change count and
   * goes quiet when there is nothing to save.
   */
  #railActions() {
    return `<div class="railactions">
        ${this.#searchButton()}
        ${this.isPublished ? '' : `
        <button data-action="save" class="${this.#changes ? 'primary' : ''}"
          ${this.#changes ? '' : 'disabled'}
          title="${this.#changes
            ? 'Make this the version the sheet opens on (Ctrl+S)'
            : 'Nothing has changed since the last save'}">
          Save${this.#changes ? ` (${this.#changes})` : ''}
        </button>`}
        <button class="railmore" data-action="chrome-menu" aria-haspopup="menu"
          aria-expanded="${this.#chromeMenu}" aria-label="More"
          title="Views, formulas, history, export">⋯</button>
        ${this.#chromeMenu ? this.#chromeMenuHtml() : ''}
        ${/* Out here rather than in the menu: choosing Import takes the menu
             away with it, and the input the action reaches for has to outlive
             that click. */''}
        ${this.isPublished ? '' : '<input type="file" accept="application/json,.json,.xlsx,.xlsm" data-importfile hidden>'}
      </div>`;
  }

  /** Everything the rail does not keep on its face. */
  #chromeMenuHtml() {
    const light = this.getAttribute('theme') === 'light';
    return `<div class="chromemenu" role="menu" aria-label="Sheet actions">
        ${this.#viewModeButton()}
        ${this.#formulaButton()}
        <button data-action="theme">${light ? 'Dark theme' : 'Light theme'}</button>
        ${this.isPublished ? '' : `
        <button data-action="history" aria-pressed="${this.#showHistory}"
          title="Earlier states of this sheet">History${this.#snapshots.length ? ` (${this.#snapshots.length})` : ''}</button>`}
        <button data-action="export">Export JSON</button>
        ${this.isPublished ? '' : `
        <button data-action="preview-published"
          title="Open this character the way someone you send it to would see it: only the pack entries it actually carries, none of your own packs, nothing saved">Preview published</button>
        <button data-action="import" title="Load a character this app exported, or convert a .xlsx workbook">Import…</button>
        <button data-action="reset" class="danger" aria-expanded="${this.#confirmReset}"
          title="Back to the character as imported. Asks first, and named checkpoints are kept.">Reset</button>`}
        <p class="menukeys"><kbd>Ctrl</kbd><kbd>K</kbd> search
          &middot; <kbd>Ctrl</kbd><kbd>S</kbd> save
          &middot; <kbd>←</kbd><kbd>→</kbd> tabs</p>
      </div>`;
  }

  /**
   * What the sheet has to say to you, under the rail rather than up in the
   * header.
   *
   * Every one of these is opened or raised by something on the rail, and the
   * rail is pinned -- so a History panel that rendered where the buttons used
   * to be would open three screens above wherever you were standing. Directly
   * under the thing that opened them is the only place they can be.
   */
  #notices() {
    return `<div class="notices">
        ${this.#resumeBanner()}
        ${this.#confirmReset ? this.#resetConfirmHtml() : ''}
        ${this.#historyNote ? `<div class="histnote" role="status">
          ${esc(this.#historyNote)}
          <button data-action="dismiss-history-note" aria-label="Dismiss">×</button>
        </div>` : ''}
        ${this.#showHistory ? this.#historyPanel() : ''}
        ${this.#importError ? `<div class="importerr" role="alert">
          ${esc(this.#importError)}
          <button data-action="dismiss-import-error" aria-label="Dismiss">×</button>
        </div>` : ''}
        ${/*
           * Always in the markup, hidden until it is true, so `#writeWorking`
           * can turn it on without a re-render (see there). There is no dismiss
           * on it: every other notice here reports something that has finished
           * happening, and this one reports something that is still the case.
           */''}
        <div class="savefail" role="alert" ${this.#storageFailed ? '' : 'hidden'}>
          <strong>Not being saved.</strong> This browser refused to store the sheet —
          a private window, or storage that is full. Your edits are here on screen but
          will not survive closing the tab.
          <button data-action="export" class="primary">Export JSON</button>
        </div>
      </div>`;
  }

  /**
   * The armed Reset: a banner that says exactly what goes and what stays, and
   * a button that stays dead until the player types RESET. A destructive
   * action this size should never ride on one click landing an inch left of
   * History.
   */
  #resetConfirmHtml() {
    const checkpoints = (this.#snapshots || []).filter((s) => s.kind === 'checkpoint').length;
    return `<div class="resetconfirm" role="alertdialog" aria-label="Confirm reset">
      <span>
        <strong>Reset to the character as imported?</strong>
        This discards the saved version, any unsaved edits${this.#changes ? ` (${this.#changes} right now)` : ''}
        and the automatic snapshots. Named checkpoints are kept${checkpoints
    ? ` — you have ${checkpoints}` : ' (you have none; History can name one first)'}.
        Type <code>RESET</code> to arm the button.
      </span>
      <span class="pair">
        <input type="text" data-reset-word placeholder="RESET" autocomplete="off" spellcheck="false"
          aria-label="Type RESET to arm the reset button" style="width:6.5rem">
        <button class="danger" data-action="reset-confirm" disabled>Reset</button>
        <button data-action="reset-cancel">Keep everything</button>
      </span>
    </div>`;
  }

  /**
   * The way in for anyone who does not know the shortcut -- which is everyone,
   * the first time. It wears the shortcut so the second time it is not needed.
   */
  #searchButton() {
    return `<button class="searchbtn" data-action="palette"
      title="Search this character — skills, feats, gear, spells, anything (Ctrl+K)">
      <svg class="cmdk-glass" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>
      </svg><span class="searchlabel">Search</span><kbd>Ctrl K</kbd></button>`;
  }

  /** The Session/Build switch: which view of the sheet is showing. */
  #viewModeButton() {
    const session = this.#model.viewMode() === 'session';
    // Named for where it goes, not for where you are. It reads the other way
    // round as a toggle -- a pressed button says which state it is in -- but
    // this is a row in a menu now, and a menu item is a thing you are about to
    // do. The `⚙` panel's own switch has said it this way all along.
    return `<button data-action="view-mode"
      title="${session
    ? 'Everything the sheet can show, including the build machinery'
    : 'Only the tabs that come up at the table, and the Overview as a dashboard'}">
      Switch to ${session ? 'build' : 'session'} view</button>`;
  }

  /**
   * The numbers a table asks for mid-fight, on every tab while the session
   * view is on: hit points, AC and the three saves. When a ticked condition
   * moves one, the moved value is what shows -- that is what is being rolled.
   */
  #sessionStrip() {
    if (this.#model.viewMode() !== 'session') return '';
    const c = this.#model.data;
    const hp = this.#model.hpState;
    const d = c.defenses;
    const s = c.saves;
    const cs = this.#model.conditionState;
    const shown = (key, base, format = fmt) => (cs.changed && cs.delta[key]
      ? `<strong class="adj ${cs.delta[key] > 0 ? 'up' : ''}" title="${esc(`Base ${format(base)} — with ${cs.sources} applied`)}">${format(cs.adjusted[key])}</strong>`
      : `<strong>${format(base)}</strong>`);
    const moved = (key, base) => (cs.changed && cs.delta[key] ? cs.adjusted[key] : base);
    const maxNow = moved('hp', hp.max);
    // Negative levels take current and total alike, so the shown current never
    // stands above the drained maximum; the stored value is untouched and
    // comes back when the levels do.
    const curNow = Math.min(hp.current, maxNow);
    return `<div class="subtitle sessionstrip">
      HP <strong class="${curNow < maxNow ? 'bad' : ''}"
        title="${maxNow !== hp.max ? esc(`Base ${hp.current}/${hp.max} — negative levels reduce current and total hit points`) : ''}"
        >${curNow}/${maxNow}</strong>${hp.temp > 0 ? `<span class="hptemp">+${hp.temp}</span>` : ''}
      &middot; AC ${shown('ac', d.ac, String)} <span class="dim">touch ${moved('touch', d.touch)} &middot; FF ${moved('flatFooted', d.flatFooted)}</span>
      &middot; Fort ${shown('fortitude', s.fortitude.total)}
      Ref ${shown('reflex', s.reflex.total)}
      Will ${shown('will', s.will.total)}
      ${(() => {
    // How far you can move is asked as often as any of the above, and it is
    // the one of them a condition is most likely to have halved. The fastest
    // rate the character actually has is the one shown; the rest are on the
    // tooltip, because a strip with four movement rates in it is a table.
    const rows = (c.identity?.speeds || [])
      .map((sp, i) => ({ sp, adj: (cs.speeds || [])[i] }))
      .filter(({ sp }) => (Number(sp.final) || 0) > 0);
    if (!rows.length) return '';
    const at = ({ sp, adj }) => (adj ? adj.adjusted : Number(sp.final) || 0);
    const best = rows.reduce((a, b) => (at(b) > at(a) ? b : a));
    const slowed = cs.changed && best.adj && best.adj.adjusted !== best.adj.final;
    const all = rows.map((r) => `${r.sp.type || 'Movement'} ${at(r)} ft.`).join(' · ');
    return `&middot; ${esc(rows.length > 1 ? best.sp.type || 'Speed' : 'Speed')}
      ${slowed
    ? `<strong class="adj ${best.adj.adjusted > best.adj.final ? 'up' : ''}"
        title="${esc(`Base ${best.adj.final} ft. — with ${cs.sources} applied\n${all}`)}">${at(best)} ft.</strong>`
    : `<strong title="${esc(all)}">${at(best)} ft.</strong>`}`;
  })()}
      ${(() => {
    // A changed size is worth a standing word: {size} and the dice follow it.
    const sizeNow = this.#model.sizeNow();
    const base = this.#model.data.identity?.size;
    if (sizeNow === base) return '';
    const ladder = Object.keys(SIZE_MODIFIERS);
    const up = ladder.indexOf(sizeNow) > ladder.indexOf(base);
    return `&middot; <strong class="adj ${up ? 'up' : ''}"
      title="${esc(`Base ${base} — with buffs applied`)}">${esc(sizeNow)}</strong>`;
  })()}
      ${cs.active.length ? `<span class="badge err">${cs.active.length} condition${cs.active.length === 1 ? '' : 's'}</span>` : ''}
    </div>`;
  }

  /**
   * The offer to pick up work that was never saved.
   *
   * Shown because the sheet opens on the canonical version, so edits made after
   * the last Save would otherwise be somewhere the player has no reason to look.
   */
  #resumeBanner() {
    if (!this.#resume) return '';
    const { changes, savedAt } = this.#resume;
    return `<div class="resume" role="status">
      <span>
        <strong>${changes} unsaved change${changes === 1 ? '' : 's'}</strong>
        from ${esc(whenText(savedAt))} were not part of the saved version.
      </span>
      <button class="primary" data-action="resume">Pick them up</button>
      <button data-action="discard-resume">Discard</button>
    </div>`;
  }

  /**
   * Earlier states, and the two ways to make one.
   *
   * Automatic snapshots are listed with what they cost in changes, checkpoints
   * with the name the player gave them. The distinction the list has to make
   * obvious is which ones will be evicted: five automatic snapshots are kept
   * and a checkpoint is kept until it is deleted.
   */
  #historyPanel() {
    const autos = this.#snapshots.filter((s) => s.kind === 'auto');
    const kept = this.#snapshots.filter((s) => s.kind === 'checkpoint');

    const row = (s) => {
      const renaming = this.#renameDraft?.key === s.key;
      return `<li class="histrow${s.stale ? ' stale' : ''}">
        <span class="histwhen">${esc(whenText(s.savedAt))}</span>
        ${renaming
          ? `<input class="histname" data-hfield="rename" value="${esc(this.#renameDraft.label)}"
               aria-label="Checkpoint name">
             <button data-action="rename-commit">Rename</button>
             <button data-action="rename-cancel">Cancel</button>`
          : `<span class="histwhat">
               ${s.label ? `<strong>${esc(s.label)}</strong>` : `${s.changes} change${s.changes === 1 ? '' : 's'} in`}
               ${s.label ? '' : `<span class="histsize">${(s.size / 1024).toFixed(0)} KB</span>`}
             </span>
             ${s.stale
               ? '<span class="histsize">written for an older schema</span>'
               : `<button data-action="restore" data-key="${esc(s.key)}">Open</button>`}
             ${s.kind === 'checkpoint'
               ? `<button data-action="rename-start" data-key="${esc(s.key)}"
                    data-label="${esc(s.label)}">Rename</button>` : ''}
             <button class="danger" data-action="forget-snapshot" data-key="${esc(s.key)}"
               aria-label="Delete this entry">×</button>`}
      </li>`;
    };

    return `<div class="history">
      <div class="histhead">
        <strong>Earlier states</strong>
        <span class="histsize">
          ${this.#savedDoc
            ? `saved version is ${this.#changes} change${this.#changes === 1 ? '' : 's'} behind the sheet`
            : 'nothing saved yet — press Save to set the version this sheet opens on'}
        </span>
      </div>

      <div class="histmake">
        <input data-hfield="checkpoint" value="${esc(this.#checkpointDraft)}"
          placeholder="Name a checkpoint — “before respec”, “end of session 12”"
          aria-label="Checkpoint name">
        <button class="primary" data-action="save-checkpoint"
          ${this.#checkpointDraft.trim() ? '' : 'disabled'}>Keep checkpoint</button>
      </div>

      ${kept.length ? `<div class="histgroup">Checkpoints — kept until you delete them</div>
        <ul class="histlist">${kept.map(row).join('')}</ul>` : ''}

      ${autos.length ? `<div class="histgroup">
          Automatic — one every ${this.#snapshotEvery} changes, ${AUTO_KEEP} kept
        </div>
        <ul class="histlist">${autos.map(row).join('')}</ul>`
        : `<div class="histgroup">
            No automatic snapshots yet — one is taken every ${this.#snapshotEvery} changes.
          </div>`}
    </div>`;
  }

  /**
   * The panel for the tab that is up -- and, if drawing it throws, a panel
   * saying so instead.
   *
   * `#render()` builds the whole shadow root from one string, so an exception
   * anywhere in a panel takes the *render* down, not the panel: the old markup
   * stays on screen and the tab that was clicked simply never opens. That is
   * the worst shape a bug can have here, because nothing on the page says
   * anything is wrong. One helper shadowing the function it meant to call cost
   * a day of exactly that (see ui/prose.js). Caught here, the same bug is one
   * tab showing what went wrong while the rest of the sheet keeps working.
   */
  #panel() {
    try {
      return this.#panelHtml();
    } catch (err) {
      // The console still gets the stack -- this is a bug report, not a
      // condition to handle, and whoever is fixing it needs the trace.
      console.error(`character-sheet: the ${this.#tab} tab failed to draw`, err);
      return `<div class="grid"><section class="panel span2">
        <h3>This tab could not be drawn</h3>
        <p class="empty">Something in the <strong>${esc(this.#tabLabel())}</strong> tab threw
          while it was being drawn, so the sheet is showing this instead of nothing.
          Your character is untouched — every other tab still works, and so does Export JSON.</p>
        <p class="hint"><code>${esc(err?.message || String(err))}</code></p>
        <p class="hint">If a formula on this tab is the cause, the <strong>ƒx Formulas</strong>
          tab lists every one on the character. The browser console has the full trace.</p>
      </section></div>`;
    }
  }

  /** What the tab bar calls the tab that is up, for a message about it. */
  #tabLabel() {
    if (this.#tab === 'systabs') return 'tab manager';
    return this.#tabEntries().find((t) => t.id === this.#tab)?.label
      || TABS.find(([id]) => id === this.#tab)?.[1] || this.#tab;
  }

  #panelHtml() {
    if (this.#tab.startsWith('sys-')) return this.#systemPanel(Number(this.#tab.slice(4)));
    switch (this.#tab) {
      case 'stats': return this.#statsPanel();
      case 'skills': return this.#skillsPanel();
      case 'martial': return this.#martialPanel();
      case 'magic': return this.#magicPanel();
      case 'guile': return this.#guilePanel();
      case 'template': return this.#templatePanel();
      case 'systabs': return this.#systemManagerPanel();
      case 'features': return this.#featuresPanel();
      case 'primordia': return this.#primordiaPanel();
      case 'gear': return this.#gearPanel();
      case 'crafting': return this.#craftingPanel();
      case 'akashic': return this.#akashicPanel();
      case 'maneuvers': return this.#maneuversPanel();
      case 'vancian': return this.#vancianPanel();
      case 'psionics': return this.#psionicsPanel();
      case 'cardcasting': return this.#cardcastingPanel();
      case 'techniques': return this.#techniqueListPanel();
      case 'autoTechnique': return this.#autoTechniquePanel();
      case 'cooking': return this.#cookingPanel();
      case 'familiar': return this.#companionPanel('familiar');
      case 'animalCompanion': return this.#companionPanel('animalCompanion');
      case 'eidolon': return this.#companionPanel('eidolon');
      case 'trackers': return this.#trackersPanel();
      case 'progression': return this.#progressionPanel();
      case 'lore': return this.#lorePanel();
      case 'extras': return this.#extrasPanel();
      case 'formulas': return this.#formulaPanel();
      case 'audit': return this.#auditPanel();
      // In the session view the Overview is a dashboard: the numbers a table
      // asks for, in cards. The full page is one Build-view click away.
      default: return this.#model.viewMode() === 'session'
        ? this.#dashboardPanel() : this.#overviewPanel();
    }
  }

  /* ---------------- overview ---------------- */

  /**
   * The Overview, in both of its forms, lives in ui/panels/overview.js. The
   * view state it reads is the folded-open detail: which buff is expanded,
   * whether the condition picker is showing, whether the cards are being
   * rearranged.
   */
  #overviewCtx() {
    return {
      condPickerOpen: this.#condPickerOpen,
      dashArrange: this.#dashArrange,
      draft: this.#draft,
      openBuff: this.#openBuff,
      openClassSystems: this.#openClassSystems,
    };
  }

  #overviewPanel() { return overview.renderOverviewPanel(this.#model, this.#overviewCtx()); }

  #dashboardPanel() { return overview.renderDashboardPanel(this.#model, this.#overviewCtx()); }

  /** The action dispatcher needs the card list when the player rearranges it. */
  #dashCardIds(...a) { return overview.dashCardIds(this.#model, ...a); }

  /* ---------------- stats (ability build) ---------------- */

  /** The Stats tab lives in ui/panels/stats.js. */
  #statsPanel() { return renderStatsPanel(this.#model, {}); }

  /** Two of its pickers are drawn by the Feats & Mythic tab as well. */
  #pickSelect(...args) { return pickSelect(...args); }

  #mythicPickAt(tier) { return mythicPickAt(this.#model, tier); }

  /* ---------------- skills ---------------- */

  /**
   * The Skills tab lives in ui/panels/skills.js. What it needs from the
   * element is the model and the one piece of view state it reads.
   */
  #skillsPanel() {
    return renderSkillsPanel(this.#model, { showAllSkills: this.#showAllSkills });
  }

  /* ---------------- the two sphere tabs ---------------- */

  /** Folding a panel down to its heading; the builder is in ui/rows.js. */
  #collapsible(key, panelHtml) { return rows.collapsible(this.#model, key, panelHtml); }

  /** The two sphere tabs and Templates live in ui/panels/combat.js. */
  #combatCtx() { return { showCells: this.#showCells }; }

  #martialPanel() { return combat.renderMartialPanel(this.#model); }
  #guilePanel() { return guile.renderGuilePanel(this.#model); }

  #magicPanel() { return combat.renderMagicPanel(this.#model); }

  #templatePanel() { return combat.renderTemplatePanel(this.#model, this.#combatCtx()); }

  /** The class names, which the action dispatcher needs when adding a track. */
  #classNames(...a) { return combat.classNames(this.#model, ...a); }

  /* ---------------- feats & mythic ---------------- */

  /**
   * Feats something hands you, rather than ones picked at a level.
   *
   * Source first, then the feat: what granted it is the fixed part and the feat
   * is the answer, which is the way round they are actually read. The Drawback
   * row appears only once a Major Drawback is taken, because until then there
   * is no feat to name; Specialty is mandatory, so it is always there. Oath and
   * Attunement feats sit in the same list, each naming its own source.
   */
  #grantedFeatsSection() {
    const c = this.#model.data;
    const g = c.grantedFeats || { others: [] };
    const major = c.traitSlots?.majorDrawback || {};
    const hasMajor = !!(major.name || major.category || major.text);
    // What bought the feat is the drawback's NAME -- "Spell Vulnerability
    // (Divination)" -- not what it does to you. Before traits had a name field
    // the effect was all there was to show, and it read as the source.
    const majorName = String(major.name || major.category || major.text || '').trim();

    const fixed = (key, label, hint) => `<tr>
      <td><span class="fsource">${esc(label)}</span>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</td>
      <td>${this.#text(`grantedFeats.${key}.name`, g[key]?.name, 'Which feat?')}</td>
      <td>${this.#prose(`data-set="grantedFeats.${key}.note"`, g[key]?.note, 1, 'grow')}</td>
    </tr>`;

    return `<h4 class="subhead">Granted feats
        <span class="badge">${(hasMajor ? 2 : 1) + (g.others || []).length}</span>
      </h4>
      <div class="tablewrap"><table>
        <thead><tr><th>Source</th><th>Feat</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${hasMajor ? fixed('drawback', 'Drawback', majorName.slice(0, 60)) : ''}
          ${fixed('specialty', 'Specialty')}
          ${(g.others || []).map((f, i) => `<tr>
            <td>${this.#itemText('grantedFeats.others', i, 'source', f.source, 'Oath 2, Attunement…')}</td>
            <td>${this.#itemText('grantedFeats.others', i, 'name', f.name, 'Which feat?')}</td>
            <td>${this.#prose(`data-item="grantedFeats.others|${i}|note"`, f.note, 1, 'grow')}</td>
            ${this.#rowTools('grantedFeats.others', i)}
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div style="margin-top:8px">
        ${this.#addButton('grantedFeats.others', 'Add granted feat', { source: '', name: '', note: '' })}
      </div>
      <p class="hint">
        ${hasMajor
          ? 'A Major Drawback buys the Drawback feat.'
          : 'The Drawback row appears once a Major Drawback is taken on the Overview.'}
        The Specialty feat is mandatory, so it is always here. Oath and Attunement feats
        name their own source.
        ${c.primordia?.calc?.counts?.feat
    ? `Technique feats (${c.primordia.calc.counts.feat} from
        <strong>${esc(c.primordia.calc.technique)}</strong>) live on the
        <strong>Primordia</strong> tab, beside the levels that grant them — one home
        each, so they cannot drift apart.` : ''}
      </p>`;
  }

  /**
   * A feat group's heading: its name, how many it holds, and the × that
   * removes the whole group. The same three whether the group is the panel on
   * the right or a section stacked on the left, so the two cannot drift.
   */
  #featGroupTitle(group, g) {
    return `<input class="grouptitle" type="text" value="${esc(group.name)}"
        data-item="featGroups|${g}|name" data-kind="text" aria-label="Group name">
      <span class="badge">${group.entries.length}</span>
      <button class="danger" data-remove="featGroups|${g}" title="Remove group">×</button>`;
  }

  /**
   * One group's feats: the table and the button that adds a row to it.
   *
   * Three columns of writing, not two. A feat's name and where it came from
   * were all a group held, so what a feat actually *does* had nowhere to go
   * but the source cell -- and the granted feats beside it had carried a
   * proper notes column all along. This is that column, on every group, and
   * it takes formulas like the rest of the prose on the sheet: a feat that
   * grants a pool can define it where the feat is written down.
   */
  #featGroupTable(group, g) {
    return `<div class="tablewrap"><table class="feats">
        <thead><tr><th class="grip"></th><th class="fname">Feat</th><th class="src">Source / level</th>
          <th class="fnote">Notes</th><th></th></tr></thead>
        <tbody>${group.entries.map((f, i) => `<tr data-featdrop="${g}|${i}">
          <td class="grip"><span class="grip" data-featgrip title="Drag to reorder — or onto another group">&#10495;</span></td>
          <td>${this.#itemText(`featGroups.${g}.entries`, i, 'name', f.name)}</td>
          <td>${this.#itemText(`featGroups.${g}.entries`, i, 'detail', f.detail)}</td>
          <td class="fnote">${this.#prose(`data-item="featGroups.${g}.entries|${i}|note"`, f.note, 1, 'grow')}</td>
          ${this.#rowRemove(`featGroups.${g}.entries`, i)}
        </tr>`).join('')}
        ${group.entries.length ? '' : `<tr class="featempty" data-featdrop="${g}|0">
          <td colspan="5" class="empty">No feats here yet — add one, or drag one in.</td>
        </tr>`}</tbody>
      </table></div>
      <div style="margin-top:8px">
        ${this.#addButton(`featGroups.${g}.entries`, 'Add feat', { name: '', detail: '', note: '' })}
      </div>`;
  }

  #featuresPanel() {
    const c = this.#model.data;
    const feats = c.feats || {};
    const m = c.mythic || {};
    const tier = Number(c.identity.mythicTier) || 0;
    /*
     * The feats stack, each panel the width of the page.
     *
     * They used to read as two columns -- the granted feats and the smaller
     * groups on the left, the level-up list beside them -- which balanced the
     * row while a feat was a name and a source. It stopped balancing once
     * every row grew a notes column: half a page is not enough width for
     * three columns of writing, and the level-up list is the one a character
     * actually fills. So the first group stands on its own, full width, and
     * the rest stack under the granted feats as they always did.
     */
    const groups = c.featGroups || [];
    const featured = groups[0]
      ? this.#collapsible('featgroup-0', `<section class="panel span2 featgroup">
          <h3>${this.#featGroupTitle(groups[0], 0)}</h3>
          ${this.#featGroupTable(groups[0], 0)}
        </section>`)
      : '';
    const main = this.#collapsible('feats', `<section class="panel span2 featmain">
      <h3>Feats</h3>
      ${this.#grantedFeatsSection()}
      ${groups.slice(1).map((group, i) => `<div class="featsection">
        <h4 class="subhead">${this.#featGroupTitle(group, i + 1)}</h4>
        ${this.#featGroupTable(group, i + 1)}
      </div>`).join('')}
    </section>`);

    return `<div class="grid">
      ${featured}${main}
      <div class="addgroup">
        ${this.#addButton('featGroups', 'Add group', { name: 'New group', entries: [] })}
        <span class="hint">Groups mirror the columns on the sheet's Feats tab — Level Up,
          Oaths, Attunement, Class, and so on. The first group stands on its own; the rest
          stack under the granted feats. Drag a feat by its grip to reorder it, or onto
          another group to move it there.</span>
      </div>

      ${this.#collapsible('mythic', `<section class="panel span2">
        <h3>Mythic <span class="badge">tier ${tier}</span></h3>
        <div class="fieldgrid">
          ${this.#field('Path', this.#text('mythic.path', m.path))}
          ${this.#field(`Tier (auto: ${m.computedTier ?? 0})`, `<span class="pair">
            <input type="number" value="${m.tierOverride ?? ''}" placeholder="${m.computedTier ?? 0}"
              data-set="mythic.tierOverride" data-kind="number-or-null" style="width:3.6rem"
              title="Automatic from level; enter a number to override.">
            <span class="value">→ ${c.identity.mythicTier ?? 0}</span></span>`)}
          ${this.#field(`Bonus HP / tier (path: ${MYTHIC_PATH_HP[String(m.path || '').trim()] ?? '—'})`,
    `<input type="number" class="autonum${m.bonusHpPerTier == null ? ' auto' : ''}"
            value="${m.bonusHpPerTier ?? ''}" placeholder="${MYTHIC_PATH_HP[String(m.path || '').trim()] ?? 0}"
            data-set="mythic.bonusHpPerTier" data-kind="number-or-null" style="width:3.6rem"
            title="From the path; enter a number to override it."
            aria-label="Bonus hit points per mythic tier">`)}
          ${this.#field('Base path ability', this.#text('mythic.basePathAbility', m.basePathAbility))}
        </div>
        <p class="hint">
          Tier comes from character level (8→1, 10→2, 12→3, 14→4, then one per level to
          20→10). Bonus HP/tier is ${(Number(this.#model.mythicHp) || 0) / (c.identity.mythicTier || 1)}
          × ${c.identity.mythicTier ?? 0} = <strong>${this.#model.mythicHp}</strong> hit points, counted
          into the maximum on the Hit points panel (Champion/Guardian 5, Marshal/Trickster 4,
          Archmage/Hierophant 3).
        </p>
        ${rows.collapsibleSub(this.#model, 'mythic-abilities', 'Mythic path abilities', `
          <div class="tablewrap"><table class="mythic">
            <!-- Six columns and one of them prose. The tier, the level it is
                 reached at, the path and the ability's name are all a few words,
                 so they are held narrow and Effect takes what is left. -->
            <colgroup>
              <col class="tier"><col class="lvl"><col class="mpath"><col class="mname">
              <col class="meffect"><col class="mstat">
            </colgroup>
            <thead><tr>
              <th class="num">Tier</th>
              <th class="num" title="The character level this tier is reached at">Level</th>
              <th>Path</th>
              <th>Ability</th>
              <th title="What the path ability does. Formulas work here.">Effect</th>
              <th title="+2 to one ability, at every even tier">Stat</th>
            </tr></thead>
            <tbody>${MYTHIC_TIERS.map((t) => {
              const a = (m.abilities || [])[t - 1] || {};
              const i = t - 1;
              return `<tr class="${t > tier ? 'future' : ''}">
                <td class="num">${t}</td>
                <td class="num derived" title="Tier ${t} at level ${MYTHIC_TIER_LEVEL[t]}">${MYTHIC_TIER_LEVEL[t] ?? ''}</td>
                <td>${this.#itemText('mythic.abilities', i, 'path', a.path, '', true)}</td>
                <td>${this.#itemText('mythic.abilities', i, 'name', a.name, '', true)}</td>
                <td>${this.#foldedProse(`mythic:${i}:effect`, `data-item="mythic.abilities|${i}|effect"`, a.effect, 'What it does')}</td>
                ${t % 2 === 0
                  ? `<td>${this.#pickSelect('mythicStat', t, 0, this.#mythicPickAt(t), ABILITY_LABELS_LIST, false)}</td>`
                  : '<td class="noslot"></td>'}
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="hint">
            Ten tiers, one row each, beside the character level it is reached at. A
            <strong>+2 ability increase</strong> comes at every even tier, which is why
            only those rows offer a Stat; the same increases are on the
            <strong>Stats</strong> tab, and either place edits the one set. Rows above
            tier ${tier} are greyed: planned, not counted yet.
          </p>`, 'mythladder')}

        ${rows.collapsibleSub(this.#model, 'mythic-feats', 'Mythic Feats', `
          <div class="tablewrap"><table class="mythic">
            <!-- The slot, then what was taken for it, then what that does. Off
                 the ladder above so both halves have room: nine columns across
                 one table left the two Effects sharing a third of the width. -->
            <colgroup>
              <col class="tier"><col class="lvl"><col class="grants"><col class="mname">
              <col class="meffect">
            </colgroup>
            <thead><tr>
              <th class="num">Tier</th>
              <th class="num" title="The character level this tier is reached at">Level</th>
              <th title="What the tier hands over — a feat on odd tiers, an RP power on even ones">Grants</th>
              <th>Name</th>
              <th title="What the granted feat does. Formulas work here.">Effect</th>
            </tr></thead>
            <tbody>${MYTHIC_TIERS.map((t) => {
              const a = (m.abilities || [])[t - 1] || {};
              const i = t - 1;
              return `<tr class="${t > tier ? 'future' : ''}">
                <td class="num">${t}</td>
                <td class="num derived" title="Tier ${t} at level ${MYTHIC_TIER_LEVEL[t]}">${MYTHIC_TIER_LEVEL[t] ?? ''}</td>
                <td><span class="fsource">${esc(a.feat || mythicTierGrant(t))}</span></td>
                <td>${this.#itemText('mythic.abilities', i, 'featChoice', a.featChoice, '', true)}</td>
                <td>${this.#foldedProse(`mythic:${i}:featEffect`, `data-item="mythic.abilities|${i}|featEffect"`, a.featEffect, 'What it does')}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="hint">
            A mythic feat on the odd tiers, an RP power on the even ones:
            <strong>Grants</strong> is what the tier hands over, <strong>Name</strong> is
            what you took for it, and <strong>Effect</strong> says what that thing does —
            folded to one line to keep the table readable, so click one to open it and
            click away to shut it again. Formulas work here and in the path abilities
            above: write “{= tier * 2}” for a value, or “{fort += 2}” to send a bonus
            somewhere. A bonus written above tier ${tier} does not apply until it is
            reached.
          </p>`, 'mythladder')}
      </section>`)}

      ${this.#collapsible('mythic-tradition', this.#mythicTraditionPanel(m))}
    </div>`;
  }

  #mythicTraditionPanel(m) {
    const tr = m.tradition || {};
    const filled = (k) => !!(tr[k] && String(tr[k]).trim());
    return `<section class="panel span2">
      <h3>Mythic tradition
        ${!filled('drawback1') ? '<span class="badge err">Drawback 1 is mandatory</span>' : ''}
        <label class="chk" style="margin-left:auto">
          <input type="checkbox" ${m.flowingPower ? 'checked' : ''} data-set="mythic.flowingPower" data-kind="bool">
          <span>Flowing Power</span></label>
      </h3>
      <div class="tablewrap"><table class="tradition">
        <thead><tr><th class="slot">Slot</th><th class="choice">Choice</th><th>Notes</th></tr></thead>
        <tbody>${MYTHIC_TRADITION_SLOTS.map((def) => {
          const locked = def.requires && !filled(def.requires);
          return `<tr class="${locked ? 'lockedslot' : ''}">
            <td>${esc(def.label)}${def.mandatory ? ' <span class="badge err">required</span>' : ''}
              ${def.requires ? `<div class="hint">needs ${esc(MYTHIC_TRADITION_SLOTS.find((s) => s.key === def.requires)?.label)}</div>` : ''}
              ${def.kind === 'quality' ? '<div class="hint">bonus + drawback</div>' : ''}</td>
            <td>${this.#prose(`data-set="mythic.tradition.${def.key}" placeholder="${esc(locked ? `Take ${MYTHIC_TRADITION_SLOTS.find((s) => s.key === def.requires)?.label} first` : '')}"`, tr[def.key], 1, 'grow')}</td>
            <td>${this.#prose(`data-set="mythic.tradition.notes.${def.key}" placeholder="${esc(locked ? '' : 'What it does')}"`, tr.notes?.[def.key], 1, 'grow')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">
        One mandatory drawback unlocks one boon; each further drawback (up to two)
        unlocks another. The quality carries both a bonus and a drawback. The name and
        the note both resolve <code>{name = expr}</code>, so a boon that grants a pool
        can define it where it is written down.
      </p>
    </section>`;
  }

  /* ---------------- equipment & crafting ---------------- */

  /** Both tabs live in ui/panels/gear.js. */
  #gearCtx() {
    return {
      draft: this.#draft,
      openPosts: this.#openPosts,
      showAllGear: this.#showAllGear,
      openGear: this.#openGear,
      armedGearCol: this.#armedGearCol,
    };
  }

  #gearPanel() { return renderGearPanel(this.#model, this.#gearCtx()); }

  /** The session dashboard's offense card draws the weapons table too. */
  #weaponsPanel(e) { return weaponsPanel(this.#model, e); }

  #craftingPanel() { return renderCraftingPanel(this.#model, this.#gearCtx()); }

  #wealthPanel() { return wealthPanel(this.#model, this.#gearCtx()); }

  /* ---------------- modelled sub-systems ---------------- */

  /**
   * Every sub-system tab lives in ui/panels/subsystems.js. What they need from
   * the element is the model and the few bits of view state their tabs keep:
   * which deck view is showing, which maneuver is open and whether it is being
   * read or written, and the cards currently peeked at.
   */
  #systemCtx() {
    return {
      deckView: this.#deckView,
      openManeuver: this.#openManeuver,
      maneuverEdit: this.#maneuverEdit,
      veilEdit: this.#veilEdit,
      peek: this.#peek,
    };
  }

  #modelledSystems(...a) { return subsystems.modelledSystems(this.#model, ...a); }

  #systemExtrasPanel(...a) { return subsystems.systemExtrasPanel(...a); }

  #rowRemoveButton(...a) { return subsystems.rowRemoveButton(...a); }

  #primordiaPanel() { return subsystems.primordiaPanel(this.#model); }

  #akashicPanel() { return subsystems.akashicPanel(this.#model, this.#systemCtx()); }

  #maneuversPanel() { return subsystems.maneuversPanel(this.#model, this.#systemCtx()); }

  #vancianPanel() { return subsystems.vancianPanel(this.#model); }

  #psionicsPanel() { return subsystems.psionicsPanel(this.#model, this.#systemCtx()); }

  #cardcastingPanel() { return subsystems.cardcastingPanel(this.#model, this.#systemCtx()); }

  #companionPanel(kind) { return subsystems.companionPanel(this.#model, kind); }

  /* ---------------- trackers ---------------- */

  /**
   * The Trackers tab and the meters are in ui/panels/trackers.js. Most of it
   * is reached from elsewhere on the sheet -- the Overview's resource card,
   * the hit-points and psionics panels -- so most of it is delegated here.
   */
  #trackerCtx() {
    return {
      draft: this.#draft,
      editDraft: this.#editDraft,
      editMeter: this.#editMeter,
      editTracker: this.#editTracker,
    };
  }

  #trackersPanel() { return trackerUi.renderTrackersPanel(this.#model, this.#trackerCtx()); }

  #formulaMeta(...a) { return trackerUi.formulaMeta(this.#model, ...a); }

  #isDraining(...a) { return trackerUi.isDraining(...a); }

  #trackerVisual(...a) { return trackerUi.trackerVisual(...a); }

  #meterVisual(...a) { return trackerUi.meterVisual(...a); }

  #meterStyleButton(...a) { return trackerUi.meterStyleButton(this.#trackerCtx(), ...a); }

  #meterStyleEditor(...a) { return trackerUi.meterStyleEditor(this.#model, this.#trackerCtx(), ...a); }

  #styleTarget(...a) { return trackerUi.styleTarget(this.#model, this.#trackerCtx(), ...a); }

  #stylePreviewHtml(...a) { return trackerUi.stylePreviewHtml(this.#model, this.#trackerCtx(), ...a); }

  #trackerStyleEditor(...a) { return trackerUi.trackerStyleEditor(this.#model, this.#trackerCtx(), ...a); }

  #trackerPreview(...a) { return trackerUi.trackerPreview(this.#model, ...a); }

  /* ---------------- progression, lore & leftover tabs ---------------- */

  /** All three live in ui/panels/lore.js. */
  #loreCtx() { return { menuLists: this.#menuLists, confirmGroup: this.#confirmGroup }; }

  #progressionPanel() { return lore.renderProgressionPanel(this.#model, this.#loreCtx()); }

  #lorePanel() { return lore.renderLorePanel(this.#model, this.#loreCtx()); }

  #extrasPanel() { return lore.renderExtrasPanel(this.#model, this.#loreCtx()); }

  #gridTab(...a) { return lore.gridTab(this.#model, ...a); }

  /* ---------------- techniques: Technique List and AutoTechnique ---------------- */

  /**
   * The workbook's technique layout, drawn once for both tabs: the name row,
   * the three sphere rows with their talent grids beside them, the numbers the
   * formulas derive, range and saves, and the four description lines.
   *
   * On the Technique List every field is read off the catalogue (a technique
   * is edited by copying it to AutoTechnique and adding it back); on
   * AutoTechnique every field writes to `techniques.draft`.
   */
  #techniqueSheet(view, { editable = false, path = 'techniques.draft', mode = 'list' } = {}) {
    const t = view.technique;
    const s = view.stats;
    const ro = (v) => this.#roField(v);
    const cell = (field, value, opts = {}) => (editable
      ? this.#text(`${path}.${field}`, value, opts.placeholder || '')
      : ro(value));
    const spheres = (key, label, talentKey, talentLabel) => `
      <tr class="sphererow">
        <th>${label}</th>
        ${t[key].map((v, i) => `<td>${cell(`${key}.${i}`, v, { placeholder: 'sphere' })}</td>`).join('')}
      </tr>
      <tr class="talentrow">
        <th>${talentLabel}</th>
        <td colspan="${TECHNIQUE_SLOTS.spheres}">
          <div class="talentgrid">
            ${t[talentKey].map((p, i) => `<div class="talent">
              ${editable
    ? this.#select(`${path}.${talentKey}.${i}.sphere`, p.sphere, t[key].filter(Boolean), '—')
    : ro(p.sphere)}
              ${cell(`${talentKey}.${i}.talent`, p.talent, { placeholder: 'talent' })}
            </div>`).join('')}
          </div>
        </td>
      </tr>`;

    const stat = (label, value, hint = '') => `<div class="statline">
      <span class="label" ${hint ? `title="${esc(hint)}"` : ''}>${label}</span>
      <span class="value">${esc(value)}</span></div>`;

    const numbers = `
      <div class="techstats">
        <div>
          ${stat('Complexity', s.complexity, 'base talents, +(distinct − 2) past two, + every talent named')}
          ${stat('Base Talents', s.baseText, 'distinct spheres and other entries, less any Feat')}
          ${stat('Total Talents', s.totalText)}
          ${stat('Crafting Skill', t.craftingSkill)}
        </div>
        <div>
          ${stat('Crafting Time', `${s.craftingTime} days`, '1 + complexity')}
          ${stat('Effective Time (−⅓ days)', `${s.effectiveTime} days`)}
          ${stat('Crafting DC', s.craftDC, '5 + 5 × complexity')}
          ${stat('Decipher DC', s.decipherDC, '20 + complexity')}
          ${stat('Learn DC', s.learnDC, '10 + 2 × complexity')}
        </div>
        <div>
          ${stat('Technique Prowess', s.prowessText, 'Yes when the technique uses no magic sphere')}
          ${stat('Effective Complexity', s.effective, mode === 'auto'
    ? 'complexity + Instant Initiation + Versatile − Signature − Adept Initiator'
    : 'with prowess: complexity − 1 − ⌊BAB/5⌋ − Adept Initiator; else complexity − Adept Initiator')}
          ${stat('Other SP Cost', t.extraSp === '' ? '—' : t.extraSp)}
          ${stat('Total SP Cost', s.totalSp, 'effective complexity + other SP cost')}
          ${stat('Other Cost', t.otherCost || '—')}
        </div>
      </div>`;

    const flags = mode === 'auto' ? `<div class="techflags">
        ${this.#check(`${path}.instantInitiation`, t.instantInitiation, 'Instant Initiation (+1)')}
        <label class="pair"><span>Versatile Technique</span>${this.#num(`${path}.versatile`, t.versatile, 'min="0"')}</label>
        ${this.#check(`${path}.signature`, t.signature, 'Signature Technique (−1)')}
        <span class="hint">These are the AutoTechnique tab's crafting choices; they move Effective Complexity and nothing else.</span>
      </div>` : '';

    return `
      <div class="tablewrap"><table class="techsheet">
        <tr>
          <th>Technique Name</th>
          <td>${cell('prepend1', t.prepend1, { placeholder: 'style / prefix' })}</td>
          <td>${cell('prepend2', t.prepend2, { placeholder: 'e.g. Counter' })}</td>
          <td colspan="3" class="techname">${cell('name', t.name, { placeholder: 'technique name' })}</td>
        </tr>
        ${spheres('combatSpheres', 'Combat Spheres', 'combatTalents', 'Combat Talents')}
        ${spheres('magicSpheres', 'Magic Spheres', 'magicTalents', 'Magic Talents')}
        ${spheres('others', 'Other', 'otherFeatures', 'Other Features')}
      </table></div>
      ${flags}
      ${editable ? `<div class="fieldgrid" style="margin-top:8px">
        <label class="fld"><span>Crafting Skill</span>${this.#text(`${path}.craftingSkill`, t.craftingSkill, 'Kn. (martial)')}</label>
        <label class="fld"><span>Other SP Cost</span>${this.#text(`${path}.extraSp`, t.extraSp, '')}</label>
        <label class="fld"><span>Other Cost</span>${this.#text(`${path}.otherCost`, t.otherCost, 'e.g. Martial focus')}</label>
      </div>` : ''}
      ${numbers}
      <div class="tablewrap"><table class="techsheet">
        <tr>
          <th>Range</th><td colspan="2">${cell('range', t.range)}</td>
          <th>Duration</th><td colspan="2">${cell('duration', t.duration)}</td>
        </tr>
        <tr>
          <th>Saving Throw</th>
          ${t.saves.map((p, i) => `<td>${cell(`saves.${i}.save`, p.save, { placeholder: i ? '' : 'None' })}</td>`).join('')}
          <th>Target</th><td>${cell('target', t.target)}</td>
        </tr>
        <tr>
          <th>Saving Throw Type</th>
          ${t.saves.map((p, i) => `<td>${cell(`saves.${i}.type`, p.type, { placeholder: 'e.g. Halves' })}</td>`).join('')}
          <th>Spell Resistance</th><td>${cell('spellResistance', t.spellResistance, { placeholder: 'No' })}</td>
        </tr>
      </table></div>
      <div class="techdesc">
        ${t.descriptions.map((d, i) => `<label class="fld tall"><span>Description ${i + 1}</span>
          ${editable ? this.#area(`${path}.descriptions.${i}`, d, 3) : `<div class="ro-text">${esc(d) || '<span class="empty">—</span>'}</div>`}
        </label>`).join('')}
      </div>`;
  }

  /** The Discord application under a technique, and a button that copies it. */
  #techniqueExportBox(text, id) {
    return `<section class="panel span2">
      <h3>Discord application
        <span class="pair" style="margin-left:auto">
          <button data-action="copy-text" data-copy="${id}">Copy for Discord</button>
        </span>
      </h3>
      <p class="hint">The workbook's application text — character, what is applied for, and the technique in a code block. Paste it as-is.</p>
      <textarea id="${id}" class="exportbox" readonly rows="14" spellcheck="false">${esc(text)}</textarea>
    </section>`;
  }

  #techniqueListPanel() {
    const block = this.#model.data.techniques || { catalogue: [], selected: '', draft: null };
    const cat = block.catalogue;
    const byStatus = {};
    for (const t of cat) byStatus[t.status || '—'] = (byStatus[t.status || '—'] || 0) + 1;
    const selected = cat.find((t) => t.name === block.selected) || cat[0] || null;
    const idx = selected ? cat.indexOf(selected) : -1;
    const view = selected ? this.#model.techniqueView(selected, 'list') : null;
    const options = cat.map((t) => [t.name, `${techniqueTitle(t)}${t.status ? ` · ${t.status}` : ''}`]);
    const statuses = [...new Set([...TECHNIQUE_STATUSES, ...cat.map((t) => t.status).filter(Boolean)])];

    return `<div class="grid">
      <section class="panel span2">
        <h3>Technique List
          ${Object.entries(byStatus).map(([k, n]) => `<span class="badge">${esc(k)} ${n}</span>`).join('')}
        </h3>
        <p class="hint">
          Every technique on the character's <code>techRef</code>, read one at a time as the
          workbook's tab does. The list is read-only apart from the approval status; to
          change a technique, copy it to AutoTechnique, edit it there and add it back — the
          same name replaces the entry. Missing techniques — a character imported before the
          catalogue was read, or new ones on the sheet — come in with
          <strong>Import from workbook</strong>: only the techniques are taken, nothing else
          on this character changes.
          <button data-action="tech-import" title="Merge the techniques from a .xlsx export of the workbook into this list">Import from workbook…</button>
          <input type="file" accept=".xlsx,.xlsm" data-techfile hidden>
        </p>
        <div class="pair techpick">
          <select data-action="tech-select" aria-label="Technique">
            ${cat.length ? '' : '<option value="">No techniques yet</option>'}
            ${options.map(([v, l]) => `<option value="${esc(v)}" ${selected?.name === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
          ${selected ? `
            <label class="pair"><span class="hint">Approval Status</span>
              ${this.#select(`techniques.catalogue.${idx}.status`, selected.status, statuses, '—')}
            </label>
            <label class="pair"><span class="hint">Type</span>${this.#text(`techniques.catalogue.${idx}.subschool`, selected.subschool, 'e.g. Electric')}</label>
            <button data-action="tech-to-draft" data-name="${esc(selected.name)}" title="Copy this technique into AutoTechnique to edit it">Copy to AutoTechnique</button>
            <button class="danger" data-action="tech-remove" data-name="${esc(selected.name)}" title="Remove from the list">×</button>` : ''}
        </div>
      </section>
      ${view ? `<section class="panel span2">
        <h3>${esc(techniqueTitle(selected))}
          ${selected.status ? `<span class="badge ${/known|approved/i.test(selected.status) ? 'ok' : ''}">${esc(selected.status)}</span>` : ''}
          ${selected.subschool ? `<span class="badge">${esc(selected.subschool)}</span>` : ''}
        </h3>
        ${this.#techniqueSheet(view, { editable: false, mode: 'list' })}
      </section>
      ${this.#techniqueExportBox(view.export, 'techListExport')}` : `<section class="panel span2">
        <p class="empty">Nothing to show. Design a technique on the AutoTechnique tab and add it here.</p>
      </section>`}
    </div>`;
  }

  #autoTechniquePanel() {
    const block = this.#model.data.techniques || { catalogue: [], selected: '', draft: null };
    const view = this.#model.techniqueView(block.draft, 'auto');
    const t = view.technique;
    const exists = !!t.name && block.catalogue.some((x) => x.name === t.name);
    return `<div class="grid">
      <section class="panel span2">
        <h3>AutoTechnique
          <span class="pair" style="margin-left:auto">
            <button class="primary" data-action="tech-add" ${t.name ? '' : 'disabled'}
              title="${exists ? 'Replace the technique of this name on the list' : 'Add to the Technique List'}">
              ${exists ? 'Update on Technique List' : '+ Add to Technique List'}</button>
            <button data-action="tech-new" title="Clear the form">New</button>
          </span>
        </h3>
        <p class="hint">
          Design a technique: name it, pick its spheres and the talents each contributes,
          and the complexity, DCs and SP cost work themselves out as the workbook's
          formulas do. <strong>Add to Technique List</strong> puts it on the list (the
          workbook's <code>techRef</code>); the application below is ready to paste.
        </p>
        ${this.#techniqueSheet(view, { editable: true, path: 'techniques.draft', mode: 'auto' })}
      </section>
      ${this.#techniqueExportBox(view.export, 'autoTechExport')}
    </div>`;
  }

  /* ---------------- Auto-Cooking: the iron chef's dish ---------------- */

  #cookingPanel() {
    const dish = this.#model.data.cooking || emptyDish();
    const view = this.#model.cookingView();
    const tables = cookingTables();
    const levelText = dish.level === null ? '' : dish.level;
    return `<div class="grid">
      <section class="panel span2">
        <h3>Iron Chef Dish Maker
          <span class="badge">Duration: ${view.hours} hours</span>
          <span class="pair" style="margin-left:auto">
            <button data-action="cook-clear" title="Empty the plate">Clear dish</button>
          </span>
        </h3>
        <p class="hint">
          Bryva's iron chef ability, for anyone at the table: pick the courses, and each
          ingredient's effect is worked out for the chef's level and the combination — a
          Red Meat entree strengthens Apples and Potatoes, Rice counts the recipe as three
          levels higher, and so on. Duration is ⌊level ÷ 3⌋ + 1 hours.
        </p>
        <div class="fieldgrid" style="margin-bottom:10px">
          <label class="fld"><span>Iron chef level</span>
            <input type="number" min="1" max="20" value="${esc(levelText)}" data-set="cooking.level" data-kind="number-or-null"
              placeholder="${Number(this.#model.data.identity?.level) || ''}" title="Blank uses this character's level"></label>
          <label class="fld"><span>Chef</span>${this.#text('cooking.chef', dish.chef, String(this.#model.data.identity?.name || 'the chef'))}</label>
          <label class="fld"><span>Dish name</span>${this.#text('cooking.dishName', dish.dishName, 'optional')}</label>
        </div>
        <div class="tablewrap"><table class="techsheet cooksheet">
          ${COOKING_COURSES.map(([key, label]) => `<tr>
            <th>${label}</th>
            ${dish[key].map((v, i) => `<td>${this.#select(`cooking.${key}.${i}`, v, tables[key].map((x) => [x.name, x.name]), '—')}</td>`).join('')}
          </tr>`).join('')}
        </table></div>
      </section>

      <section class="panel span2">
        <h3>What the meal does</h3>
        ${view.effects.length ? `<ul class="dishlist">
          ${view.effects.map((e) => `<li>
            <span class="badge">${esc(e.course)}</span> <strong>${esc(e.name)}</strong>
            ${e.unknown ? '<span class="badge err">not in the ingredient list</span>' : ''}
            <div>${esc(e.text)}</div>
            ${e.combo ? `<div class="hint">Combo: ${esc(e.combo)}</div>` : ''}
          </li>`).join('')}
        </ul>` : '<p class="empty">An empty plate. Pick some ingredients above.</p>'}
      </section>

      <section class="panel span2">
        <h3>For Discord
          <span class="pair" style="margin-left:auto">
            <button data-action="copy-text" data-copy="cookExport">Copy for Discord</button>
          </span>
        </h3>
        <textarea id="cookExport" class="exportbox" readonly rows="10" spellcheck="false">${esc(view.export)}</textarea>
      </section>

      ${this.#collapsible('cooking-ref', `<section class="panel span2">
        <h3>Ingredient list <span class="badge">at level ${view.level}</span></h3>
        <p class="hint">Every ingredient and what it grants at the chef's level above, with the combos that raise it.</p>
        <div class="tablewrap"><table class="gridtab dishref">
          ${COOKING_COURSES.map(([key, label]) => tables[key].map((x, i) => {
    const one = normalizeDish({ level: view.level, [key]: [x.name] });
    const resolved = cookingDish(one, { level: view.level }).effects[0]?.text || '';
    return `<tr>${i === 0 ? `<th rowspan="${tables[key].length}">${label}</th>` : ''}
              <td class="ingname">${esc(x.name)}</td><td>${esc(resolved)}${x.combo ? `<div class="hint">Combo: ${esc(x.combo)}</div>` : ''}</td></tr>`;
  }).join('')).join('')}
        </table></div>
      </section>`)}
    </div>`;
  }

  /* ---------------- formulas & audit ---------------- */

  /** Both tabs live in ui/panels/admin.js. */
  #adminCtx() {
    return {
      formulaDraft: this.#formulaDraft,
      formulaQuery: this.#formulaQuery,
      formulaRefOpen: this.#formulaRefOpen,
      tab: this.#tab,
    };
  }

  #formulaPanel() { return admin.renderFormulaPanel(this.#model, this.#adminCtx()); }

  #auditPanel() { return admin.renderAuditPanel(this.#model, this.#adminCtx()); }

  #formulaButton(...a) { return admin.formulaButton(this.#model, this.#adminCtx(), ...a); }

  #forwardedRows(...a) { return admin.forwardedRows(this.#model, ...a); }

  /* ---------------- small helpers ---------------- */

  /* ----- kept in the element -----
   * The colour setter writes to the host element's own style, and the field
   * wrapper is still reached from panels that have not moved.
   */

  /**
   * Push the character's colour onto the host element, where it overrides the
   * theme's accent for everything inside the shadow root. Removing it hands
   * the theme back its own.
   */
  /**
   * The surface a player-chosen colour has to be legible on.
   *
   * `--cs-panel-2` rather than `--cs-panel`: it is the ground under buttons,
   * inputs and the swatches, and it is the tighter of the two on both themes --
   * paler than the panel on the light one, lighter than it on the dark. Read
   * off the element rather than written down, so a host that themed the sheet
   * is measured against its own colours; the built-in pair is the fallback for
   * a host that set something `normalizeHex` cannot read, and for the moment
   * before the stylesheet is adopted.
   */
  #surface() {
    const declared = normalizeHex(getComputedStyle(this).getPropertyValue('--cs-panel-2'));
    return declared || (this.getAttribute('theme') === 'light' ? '#eef0f5' : '#232733');
  }

  /**
   * The character's own colour, wherever the sheet wears it.
   *
   * The accent is read as text far more often than it is seen as an edge -- it
   * is every panel heading, every derived value, every big attack bonus -- so
   * it takes the legible version of the hue. The three washes under it keep the
   * raw one: they are backgrounds and borders, they have no ratio to meet, and
   * they are most of what makes the sheet still look like the colour that was
   * picked. See `readableOn`.
   */
  #applyCharacterColor() {
    const hex = normalizeHex(this.#model?.data?.identity?.color);
    const vars = ['--cs-accent', '--cs-accent-soft', '--cs-formula', '--cs-formula-strong'];
    if (!hex) { vars.forEach((v) => this.style.removeProperty(v)); return; }
    this.style.setProperty('--cs-accent', readableOn(hex, this.#surface()));
    this.style.setProperty('--cs-accent-soft', rgba(hex, 0.14));
    this.style.setProperty('--cs-formula', rgba(hex, 0.40));
    this.style.setProperty('--cs-formula-strong', rgba(hex, 0.85));
  }

  #field(label, control) { return fields.field(label, control); }

  /* ----- prose fields -----
   * The two-layer prose control and everything that renders a token live in
   * ui/prose.js, because two dozen panels put one somewhere. These pass on
   * what the module cannot see: the model, and which folded cell is open.
   */

  #prose(...a) { return prose.prose(this.#model, ...a); }

  #itemArea(...a) { return prose.itemArea(this.#model, ...a); }

  #foldedProse(...a) { return prose.foldedProse(this.#model, { openCell: this.#openCell }, ...a); }

  #renderedProse(...a) { return prose.renderedProse(this.#model, ...a); }

  #tokenScope(...a) { return prose.tokenScope(this.#model, ...a); }

  #tokenTitle(...a) { return prose.tokenTitle(this.#model, ...a); }

  #targetLabels(...a) { return prose.targetLabels(this.#model, ...a); }


  /**
   * Extras & Notes: the workbook's scratch page, as a tab. Notes to jot on,
   * the Approvals table (what was applied for, who approved it, the link),
   * and whatever else the worksheet held, kept as an editable grid.
   */
  #systemPanel(index) {
    const tab = (this.#model.data.sheetTabs || [])[index];
    if (!tab) return '<div class="grid"><section class="panel"><p class="empty">Missing tab.</p></section></div>';
    return `<div class="grid">
      <section class="panel span2" style="padding-bottom:4px">
        <h3>
          <input type="text" class="tabname big" value="${esc(tab.name)}" data-systab-name="${index}" aria-label="Tab name">
          <span class="pair" style="margin-left:auto">
            <button data-action="add-system-column" data-index="${index}">+ Column</button>
            <button data-action="tab-hide" data-key="sys:${esc(tab.name)}">Hide tab</button>
          </span>
        </h3>
        <p class="hint">${tab.hidden ? 'This worksheet was hidden in the source workbook. ' : ''}
          ${tab.custom ? 'Custom tab — a free grid for anything the sheet doesn\'t model. '
    : 'Cell-for-cell from the workbook. '}Every cell is editable; rows and columns can be added.
          Cells accept inline formulas like <code>{name = expr}</code>.</p>
      </section>
      ${this.#gridTab(index, tab)}
    </div>`;
  }

  /**
   * The ⚙ manager: the tab bar as a list to rearrange, then everything that
   * is off it -- alphabetical, so a tab is found by name rather than by where
   * the workbook happened to put it -- with the odd sub-systems in a corner
   * of their own. Worksheets can be renamed, deleted or added here too.
   */
  #systemManagerPanel() {
    const entries = this.#tabEntries();
    const bar = this.#barEntries();
    const onBar = new Set(bar.map((e) => e.key));
    const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    const off = entries.filter((e) => !onBar.has(e.key)).sort(byLabel);
    const hidden = off.filter((e) => !e.weird);
    const weird = off.filter((e) => e.weird);
    const all = (this.#model.data.sheetTabs || []).map((tab, index) => ({ tab, index }));

    const badges = (e) => `${e.kind === 'system' && e.tab.hidden ? '<span class="badge">hidden in source</span>' : ''}
      ${e.kind === 'system' && e.tab.custom ? '<span class="badge player">custom</span>' : ''}
      ${e.kind === 'system' ? `<span class="badge">${e.tab.rows.length} rows</span>` : ''}
      ${e.kind === 'modelled' ? (e.has ? '<span class="badge ok">in use</span>'
    : e.tagged ? '<span class="badge ok" title="A class on the Overview marks this system">marked</span>'
      : '<span class="badge">empty</span>') : ''}`;
    const name = (e) => (e.kind === 'system'
      ? `<input type="text" class="tabname" value="${esc(e.label)}" data-systab-name="${e.index}" aria-label="Tab name">`
      : esc(e.label));
    const del = (e) => (e.kind === 'system'
      ? `<button class="danger" data-action="delete-system" data-index="${e.index}"
           title="Delete this tab and its data" aria-label="Delete tab">×</button>` : '');

    // The same panel the tabs' own right-click opens, reached from a row.
    const colorBtn = (e) => {
      const hex = this.#model.tabColor(e.key);
      return `<button class="swatch tabswatch${hex ? '' : ' none'}" data-tabcolor-open="${esc(e.key)}"
        data-tabcolor-label="${esc(e.label)}"${hex ? ` style="background:${hex}"` : ''}
        title="${esc(hex ? `Colour: ${hex}` : 'Colour this tab')}" aria-label="Colour ${esc(e.label)}"></button>`;
    };
    const barRow = (e, i) => `<div class="item statline tabrow" draggable="true" data-tabkey="${esc(e.key)}">
      <span class="label pair" style="flex:1">
        <span class="grip" aria-hidden="true">⋮⋮</span>
        ${name(e)} ${badges(e)}
      </span>
      <span class="value pair">
        ${colorBtn(e)}
        <button data-action="tab-move" data-key="${esc(e.key)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(e.label)} left" title="Move left">↑</button>
        <button data-action="tab-move" data-key="${esc(e.key)}" data-dir="1" ${i === bar.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(e.label)} right" title="Move right">↓</button>
        <button data-action="tab-hide" data-key="${esc(e.key)}" ${bar.length === 1 ? 'disabled' : ''}>Hide</button>
        ${del(e)}
      </span>
    </div>`;
    const offRow = (e) => `<div class="item statline">
      <span class="label pair" style="flex:1">${name(e)} ${badges(e)}</span>
      <span class="value pair">
        <button data-action="tab-show" data-key="${esc(e.key)}">Show</button>
        ${del(e)}
      </span>
    </div>`;

    const mode = this.#model.viewMode();
    return `<div class="grid"><section class="panel span2">
      <h3>Tab bar — ${mode === 'session' ? 'session view' : 'build view'}
        <button data-action="view-mode" style="margin-left:auto" title="${mode === 'session'
    ? 'Switch to the build view and edit its bar' : 'Switch to the session view and edit its bar'}">
          Switch to ${mode === 'session' ? 'build' : 'session'} view</button>
      </h3>
      <p class="hint">
        The tabs across the top, in order. Drag a row -- or a tab on the bar itself --
        to rearrange; <strong>Hide</strong> moves a tab down into the lists below with
        its data intact, and it stays hidden. The swatch on each row colours that tab
        (right-clicking the tab itself opens the same picker); a colour is the tab's own
        and shows on both bars. Each view keeps its own bar: the <em>build</em> view
        starts from Overview, Stats, Lore, Skills, Progression, Feats &amp; Mythic,
        Primordia, Trackers and Equipment, <em>plus every sub-system this character
        uses</em>; the <em>session</em> view starts from what comes up at the table --
        those sub-systems again, minus the build machinery.
        <button data-action="tab-reset">Reset this view's bar</button>
      </p>
      <div class="rowlist tabbar-list">
        ${bar.map(barRow).join('') || '<p class="empty">Nothing on the bar — show a tab below.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Hidden tabs</h3>
      <p class="hint">
        Everything else the sheet can show, alphabetically: the rest of the built-in
        tabs, the modelled sub-systems (Martial and Magic Spheres, Crafting, Akashic, Maneuvers,
        Vancian, Psionics, the companions…), and the workbook's own worksheets.
        <em>In use</em> marks a sub-system that already holds this character's data;
        <em>marked</em> means a class on the Overview names the system but its tab is
        still empty.
      </p>
      <div class="rowlist">
        ${hidden.map(offRow).join('') || '<p class="empty">Every tab is on the bar.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Extra — weird systems</h3>
      <p class="hint">
        The unusual machinery: casting off a deck, and a workbook's technique list
        and its auto-technique sheet. Off the bar unless the character uses them.
      </p>
      <div class="rowlist">
        ${weird.map(offRow).join('') || '<p class="empty">All of these are on the bar.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Worksheets</h3>
      <p class="hint">
        Add a free grid tab of your own (Vancian spellbook, mount, a homebrew system…).
        Rename any worksheet by typing over its name above; × deletes one and its data.
      </p>
      <div class="pair">
        <input type="text" data-draft="newSystem" placeholder="New tab name" value="${esc(this.#draft.newSystem || '')}" style="max-width:16rem">
        <button class="primary" data-action="add-system">+ Add system tab</button>
      </div>
      ${this.#confirmDelete !== null ? `<p class="hint warn">
        Delete “${esc(all[this.#confirmDelete]?.tab.name)}” and all its rows?
        <button class="danger" data-action="delete-system-confirm">Delete</button>
        <button data-action="delete-system-cancel">Keep</button></p>` : ''}
    </section>
    ${this.#extensionBlocksPanel()}</div>`;
  }

  /**
   * The building blocks the enabled extension packs offer -- a class, a race,
   * a feature, a tracker -- each with a button that copies it into this
   * character. The packs themselves are managed by the host page; this is
   * only the shelf.
   */
  #extensionBlocksPanel() {
    const packs = extensionRuntime.active();
    const blocks = extensionRuntime.blocks();
    const kinds = [...new Set(blocks.map((b) => b.kind))];
    const filter = kinds.includes(this.#extFilter) ? this.#extFilter : '';
    const byKind = filter ? blocks.filter((b) => b.kind === filter) : blocks;
    // A pack of thirty archetypes is a list to search, not one to scroll. The
    // words are looked for in the block's name, its pack and what it is for,
    // so "warrior" finds an archetype that replaces warrior's grace.
    const words = this.#extSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = (b) => [b.name, b.kind, BLOCK_KINDS[b.kind]?.label, b.extName, b.class, b.group, b.feature,
      ...(b.features || []).flatMap((f) => [f.name, ...(f.replaces || []), ...(f.alters || [])]),
      ...(b.options || []).map((o) => o.name)].filter(Boolean).join(' ').toLowerCase();
    const shown = words.length ? byKind.filter((b) => { const h = haystack(b); return words.every((w) => h.includes(w)); }) : byKind;
    const byPack = new Map();
    for (const b of shown) {
      if (!byPack.has(b.extId)) byPack.set(b.extId, { name: b.extName, blocks: [] });
      byPack.get(b.extId).blocks.push(b);
    }
    // Searching looks through what a block is for as well as what it is called,
    // so "warrior" finds an archetype that replaces warrior's grace. A block
    // the words name outright comes first all the same.
    if (words.length) {
      const named = (b) => words.every((w) => String(b.name || '').toLowerCase().includes(w));
      for (const p of byPack.values()) p.blocks.sort((a, b) => Number(named(b)) - Number(named(a)));
    }
    const detail = (b) => {
      switch (b.kind) {
        case 'class': return `d${b.hd}, BAB ${b.bab === 1 ? 'full' : b.bab === 0.5 ? '½' : '¾'}, ${['goodFort', 'goodRef', 'goodWill'].filter((k) => b[k]).map((k) => k.slice(4)).join('/') || 'no good'} saves, ${b.skillRanks} ranks${b.features.length ? `, ${b.features.length} features` : ''}`;
        case 'race': return [b.size, Object.entries(b.abilityMods).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(' '), b.traits.length ? `${b.traits.length} traits` : ''].filter(Boolean).join(' · ');
        case 'template': return `${b.features.length} feature(s)`;
        case 'tracker': return `max ${b.maxFormula || '—'}${b.refresh ? ` · ${b.refresh}` : ''}`;
        case 'feature': return `${b.type ? `(${b.type}) ` : ''}${b.group ? `→ ${b.group}` : ''}`;
        case 'veil': return `${b.slot || 'no slot'} slot${b.descriptor ? ` · ${b.descriptor}` : ''}`;
        case 'trait': return b.replaces.length ? `replaces ${b.replaces.join(', ')}` : '';
        case 'archetype': {
          // "warriors grace@10" is how a swap of one grant is filed; here it reads.
          const rep = [...new Set(b.features.flatMap((f) => f.replaces))].map(swapLabel);
          const alt = [...new Set(b.features.flatMap((f) => f.alters))].map(swapLabel);
          return [`for ${b.class || 'its class'}`, rep.length ? `replaces ${rep.join(', ')}` : '', alt.length ? `alters ${alt.join(', ')}` : '',
            b.stacksWith.length ? `combines with ${b.stacksWith.join(', ')}` : ''].filter(Boolean).join(' · ');
        }
        default: return '';
      }
    };
    // An archetype's button says whether it can go on right now, and why not.
    const gate = (b) => {
      if (b.kind !== 'archetype') return { on: true, why: '' };
      const s = archetypeStatus(this.#model, b);
      if (s.ok) return { on: true, why: '' };
      if (s.reason === 'applied') return { on: false, why: 'on the sheet' };
      if (s.reason === 'no-class') return { on: false, why: `needs ${s.className} on the Classes table` };
      return { on: false, why: `blocked: ${s.with} also changes ${s.shared.join(', ')}` };
    };
    const rows = [...byPack.entries()].map(([id, p]) => `
      <h4 class="ext-pack">${esc(p.name)}</h4>
      ${p.blocks.map((b) => { const g = gate(b); return `<div class="item statline">
        <span class="label pair" style="flex:1">
          <span class="badge">${esc(BLOCK_KINDS[b.kind]?.label || b.kind)}</span>
          <strong>${esc(b.name || '(unnamed)')}</strong>
          <span class="hint" style="margin:0">${esc(detail(b))}</span>
        </span>
        <span class="value pair">
          ${g.why ? `<span class="hint ${/^blocked/.test(g.why) ? 'warn' : ''}" style="margin:0">${esc(g.why)}</span>` : ''}
          <button class="primary" data-action="ext-add-block" data-ext="${esc(id)}" data-index="${b.index}" ${g.on ? '' : 'disabled'}
            title="${esc(BLOCK_KINDS[b.kind]?.lands || '')}">+ Add</button>
        </span>
      </div>`; }).join('')}`).join('');

    return `<section class="panel span2">
      <h3>Extensions — building blocks</h3>
      <p class="hint">
        What the enabled extension packs offer this character: ${packs.length
    ? `${packs.length} pack${packs.length === 1 ? '' : 's'} on, ${blocks.length} block${blocks.length === 1 ? '' : 's'}.`
    : 'no packs are enabled.'} <strong>+ Add</strong> copies a block onto the sheet — a class into
        the Classes table, a race into the Overview, a feature onto the Template tab, a tracker
        onto Trackers — where it is then yours to edit like anything typed in. Packs are managed
        from the page's <em>Extensions</em> button.
      </p>
      ${blocks.length ? `<p class="pair extfind" style="margin:0 0 6px">
        ${kinds.length > 1 ? `<button data-action="ext-filter" data-kind="" aria-pressed="${!filter}">All</button>
        ${kinds.map((k) => `<button data-action="ext-filter" data-kind="${k}" aria-pressed="${filter === k}">${esc(BLOCK_KINDS[k]?.label || k)}</button>`).join('')}` : ''}
        <input type="search" data-ext-search="1" value="${esc(this.#extSearch)}" spellcheck="false"
          placeholder="Search ${byKind.length} block${byKind.length === 1 ? '' : 's'}…"
          title="By name, pack, class, or what a block's features are called and replace">
        ${words.length ? `<span class="hint" style="margin:0">${shown.length} of ${byKind.length}</span>` : ''}
      </p>` : ''}
      <div class="rowlist">
        ${rows || `<p class="empty">${words.length ? `Nothing matches “${esc(this.#extSearch)}”.`
    : packs.length ? 'The enabled packs carry tables only — no blocks.' : 'Nothing to offer yet.'}</p>`}
      </div>
    </section>`;
  }


  /* ---------------- field helpers ----------------
   * Every control carries the model path it writes to, so the bind step is
   * one generic listener per input kind rather than per field.
   *
   * The builders themselves live in ui/fields.js and ui/rows.js, where the
   * panel modules can reach them too. What stays here is one line each: the
   * private name the several hundred call sites in this file already use, and
   * -- for the three that need it -- the bit of element state they cannot see
   * from outside the class.
   */

  #text(path, value, placeholder = '') { return fields.text(path, value, placeholder); }

  #num(path, value, extra = '') { return fields.num(path, value, extra); }

  #roField(value, title = '', extra = '') { return fields.roField(value, title, extra); }

  #area(path, value, rowCount = 3) { return fields.area(path, value, rowCount); }

  #check(path, value, label = '', title = '') { return fields.check(path, value, label, title); }

  #select(path, value, options, blank = '—') { return fields.select(path, value, options, blank); }

  #abilitySelect(path, value) { return fields.abilitySelect(path, value); }


  /* ----- list rows ----- */

  #itemText(list, i, field, value, placeholder = '', title = false) {
    return rows.itemText(list, i, field, value, placeholder, title);
  }

  #itemNum(list, i, field, value) { return rows.itemNum(list, i, field, value); }

  #itemCheck(list, i, field, value) { return rows.itemCheck(list, i, field, value); }

  #exprField(bindingAttr, raw, opts = {}) { return rows.exprField(bindingAttr, raw, opts); }

  #itemExpr(list, i, field, obj, opts = {}) { return rows.itemExpr(list, i, field, obj, opts); }

  #itemSelect(list, i, field, value, options, blank = '—', abOf = null) {
    return rows.itemSelect(list, i, field, value, options, blank, abOf);
  }

  #rowTools(list, i) { return rows.rowTools(list, i); }

  #rowRemove(list, i) { return rows.rowRemove(list, i); }

  /** Which × is armed is element state, so it is handed over here. */
  #rowRemoveArmed(list, i, what = 'row') {
    return rows.rowRemoveArmed(list, i, what, this.#armedRemove);
  }

  /** Resolving tokens needs the model, so it is handed over here. */
  #proseText(text) { return rows.proseText(this.#model, text); }

  #movedInline(cs, key, base, format = fmt) { return rows.movedInline(cs, key, base, format); }

  #addButton(list, label, template) { return rows.addButton(list, label, template); }

  #bigStat(k, v, sub, now = '', roll = '') { return rows.bigStat(k, v, sub, now, roll); }

  #miniStat(k, v, title = '') { return rows.miniStat(k, v, title); }

  #line(label, value, big = false) { return rows.line(label, value, big); }

  #lineHtml(label, html, big = false) { return rows.lineHtml(label, html, big); }

  #editLine(label, path, value) { return rows.editLine(label, path, value); }

  /* ---------------- rolling ---------------- */

  /**
   * The d20 beside a row: one click puts that row's roll on the clipboard.
   *
   * The button carries only which row it is (`skill|12`, `save|will`); the text
   * is built at the moment it is pressed, so a sheet that has been edited since
   * it was drawn -- or a condition ticked on another tab -- copies the number
   * that is true now rather than the one that was true when the table was.
   *
   * The tooltip shows the formula anyway, because a roll that quietly differs
   * from the total printed next to it is worse than no button: conditions move
   * these numbers, and the tooltip is where that becomes visible before the
   * paste rather than after it.
   */
  #rollButton(kind, ref, what, cs = null) {
    return roll.rollButton(this.#model, kind, ref, what, cs);
  }

  /**
   * What was copied, shown back.
   *
   * Partly so a paste that goes wrong can be read and fixed by hand, partly
   * because it is the only place the two Roll20 shapes can be compared: the
   * switch re-copies the same roll in the other one and remembers the choice.
   * It appears where it is asked for and leaves on its own, so nothing on the
   * sheet moves to make room for it.
   */
  #rollToastHtml() {
    const t = this.#rollToast;
    if (!t) return '';
    return `<div class="rolltoast${t.failed ? ' failed' : ''}" role="status">
      <div class="rollhead">
        <strong>${t.failed ? 'Copy it yourself' : 'Copied'}</strong>
        <span class="hint">${esc(t.what)}</span>
        <span class="rollformats">${ROLL_FORMATS.map(([key, label]) => `
          <button data-rollformat="${key}" aria-pressed="${this.#rollFormat === key}"
            title="${key === 'template'
    ? 'A titled box with a row per roll, using Roll20’s built-in default template'
    : 'One bare /roll line, for a game that wants no template'}">${esc(label)}</button>`).join('')}</span>
        <button class="rollclose" data-rollclose aria-label="Dismiss">×</button>
      </div>
      <textarea class="rolltext" readonly rows="2" spellcheck="false"
        aria-label="The copied roll">${esc(t.text)}</textarea>
      ${t.failed ? `<p class="hint warn">The clipboard is not available here — a page served
        over plain <code>http://</code> or an embed without permission. The text is selected;
        <kbd>Ctrl</kbd>+<kbd>C</kbd> takes it.</p>` : ''}
    </div>`;
  }

  /**
   * What the slot under the rail is showing.
   *
   * A copied roll and an offer to undo are both "the last thing that
   * happened", and there is only ever one of those, so they share the slot
   * rather than stacking. Whichever was set last is the one that is up --
   * setting either clears the other.
   */
  #slotHtml() {
    if (this.#rollToast) return this.#rollToastHtml();
    if (this.#undoToast) return this.#undoToastHtml();
    return '';
  }

  /**
   * "Removed Cloak of Resistance -- Undo".
   *
   * It leaves on its own after twelve seconds, which is longer than the roll
   * toast gets because that one is confirming something you meant and this one
   * is offering to reverse something you may not have. The stack outlives the
   * toast either way: Ctrl+Z still works after it has gone.
   */
  #undoToastHtml() {
    const t = this.#undoToast;
    if (!t) return '';
    // The button only while there is something behind it. After the last step
    // has been taken back the toast is a receipt, and a receipt with a dead
    // control on it reads as a control that stopped working.
    const more = this.#model?.undoLabel;
    return `<div class="rolltoast undotoast" role="status">
      <div class="rollhead">
        <strong>${esc(t.label)}</strong>
        ${more ? '<button class="primary" data-undo>Undo <kbd>Ctrl</kbd><kbd>Z</kbd></button>' : ''}
        <button class="rollclose" data-undoclose aria-label="Dismiss">×</button>
      </div>
    </div>`;
  }

  /** Offer the last structural change back. */
  #showUndoToast(label) {
    clearTimeout(this.#rollToastTimer);
    this.#rollToast = null;
    this.#undoToast = { label };
    this.#renderRollToast();
  }

  /** Redraw the toast alone -- copying a roll must not disturb the sheet. */
  #renderRollToast({ select = false } = {}) {
    const slot = this.shadowRoot.querySelector('.rollslot');
    if (!slot) return;
    slot.innerHTML = this.#slotHtml();
    this.#bindRollToast(slot);
    if (select) slot.querySelector('.rolltext')?.select();
    clearTimeout(this.#rollToastTimer);
    clearTimeout(this.#undoToastTimer);
    // A failed copy is still needed -- it is the only copy of the text there
    // is -- so only a successful one clears itself.
    if (this.#rollToast && !this.#rollToast.failed) {
      this.#rollToastTimer = setTimeout(() => {
        this.#rollToast = null;
        if (this.isConnected) this.#renderRollToast();
      }, 6000);
    }
    if (this.#undoToast) {
      this.#undoToastTimer = setTimeout(() => {
        this.#undoToast = null;
        if (this.isConnected) this.#renderRollToast();
      }, 12000);
    }
  }

  /**
   * Copy one roll.
   *
   * `navigator.clipboard` is unavailable outside a secure context and can be
   * refused inside one, so a failure is not an error state: the text goes into
   * the toast selected, which is the same thing one keystroke later.
   */
  async #copyRoll(kind, ref, what) {
    const spec = rollSpec(this.#model.data, kind, ref, this.#model.conditionState);
    const text = rollText(spec, this.#rollFormat);
    if (!text) return;
    let failed = false;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      failed = true;
    }
    this.#undoToast = null;
    this.#rollToast = {
      kind, ref, what: what || spec.name, text, failed,
    };
    this.#renderRollToast({ select: failed });
  }

  #bindRollToast(scope) {
    scope.querySelectorAll('[data-rollformat]').forEach((b) => {
      b.addEventListener('click', () => {
        this.#rollFormat = b.dataset.rollformat;
        writeRollFormat(this.#rollFormat);
        const t = this.#rollToast;
        if (t) this.#copyRoll(t.kind, t.ref, t.what);
      });
    });
    scope.querySelectorAll('[data-rollclose]').forEach((b) => {
      b.addEventListener('click', () => {
        clearTimeout(this.#rollToastTimer);
        this.#rollToast = null;
        this.#renderRollToast();
      });
    });
    scope.querySelectorAll('[data-undo]').forEach((b) => {
      b.addEventListener('click', () => this.#undo());
    });
    scope.querySelectorAll('[data-undoclose]').forEach((b) => {
      b.addEventListener('click', () => {
        clearTimeout(this.#undoToastTimer);
        this.#undoToast = null;
        this.#renderRollToast();
      });
    });
  }

  /**
   * Take back the last structural change, and say what came back.
   *
   * The toast that follows names the thing that was restored rather than
   * going quiet: an undo that leaves no trace is indistinguishable from a
   * keypress that did nothing, and this one can be pressed several times.
   */
  #undo() {
    if (!this.#model) return;
    const label = this.#model.undo();
    if (!label) { this.#showUndoToast('Nothing left to undo'); return; }
    this.#undoToast = null;
    this.#render();
    this.#showUndoToast(`${label} — put back`);
  }

  /* ---------------- the search palette ---------------- */

  /**
   * Open the palette, or shut it if it is already up.
   *
   * The index is built here, on the way in: a couple of milliseconds on the
   * heaviest character in the roster, against the certainty that what it holds
   * is what the sheet holds right now. Keeping one in step with every edit
   * would cost more and could still be wrong.
   */
  #openPalette() {
    if (!this.#model) return;
    if (this.#palette) {
      if (this.#palette.open) return;
      // The browser shut it without us hearing about it (Esc reaches the
      // dialog directly). Tidy the node away before putting up another.
      this.#closePalette();
    }
    const dlg = this.ownerDocument.createElement('dialog');
    dlg.className = 'cmdk';
    dlg.innerHTML = palette.paletteHtml({
      placeholder: `Search ${this.#model.data.identity?.name || 'this character'}…`,
    });
    this.#palette = dlg;
    this.#paletteIndex = palette.buildIndex(this.#model, {
      tabs: this.#tabEntries(), isAdmin: this.isAdmin,
    });
    this.#paletteReturn = this.shadowRoot.activeElement;
    this.shadowRoot.append(dlg);
    this.#bindPalette(dlg);
    dlg.showModal();
    this.#paletteSearch('');
    const input = dlg.querySelector('.cmdk-input');
    input?.focus();
    input?.select();
  }

  #closePalette() {
    const dlg = this.#palette;
    if (!dlg) return;
    // Cleared first: closing the dialog fires `close`, which comes back here.
    this.#palette = null;
    this.#paletteIndex = null;
    this.#paletteRows = [];
    this.#paletteTerms = [];
    cancelAnimationFrame(this.#paletteFrame);
    if (dlg.open) dlg.close();
    dlg.remove();
    const back = this.#paletteReturn;
    this.#paletteReturn = null;
    if (back?.isConnected) back.focus?.();
  }

  #togglePalette() {
    if (this.#palette?.open) this.#closePalette();
    else this.#openPalette();
  }

  /**
   * Everything the open palette listens to.
   *
   * All of it hangs off the dialog, which is thrown away when it closes, so
   * nothing here has to be taken down and nothing accumulates over a session's
   * worth of openings.
   */
  #bindPalette(dlg) {
    const input = dlg.querySelector('.cmdk-input');
    const list = dlg.querySelector('.cmdk-list');

    // Typing redraws the list and nothing else -- not the panel behind it, not
    // even the input -- and does it once per frame however fast the typing is.
    input.addEventListener('input', () => {
      cancelAnimationFrame(this.#paletteFrame);
      this.#paletteFrame = requestAnimationFrame(() => this.#paletteSearch(input.value));
    });

    input.addEventListener('keydown', (e) => {
      const page = Math.max(1, Math.floor(list.clientHeight / PALETTE_ROW_PX) - 1);
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this.#paletteMove(1, true); break;
        case 'ArrowUp': e.preventDefault(); this.#paletteMove(-1, true); break;
        case 'PageDown': e.preventDefault(); this.#paletteMove(page, false); break;
        case 'PageUp': e.preventDefault(); this.#paletteMove(-page, false); break;
        case 'Home': e.preventDefault(); this.#paletteMove(-1e6, false); break;
        case 'End': e.preventDefault(); this.#paletteMove(1e6, false); break;
        case 'Enter':
          e.preventDefault();
          this.#paletteChoose(this.#paletteAt, { roll: e.ctrlKey || e.metaKey });
          break;
        default: break;
      }
    });

    list.addEventListener('click', (e) => {
      const row = e.target.closest?.('.cmdk-row');
      if (!row) return;
      this.#paletteChoose(Number(row.dataset.i), { roll: !!e.target.closest('.cmdk-roll') });
    });

    // Hover follows the mouse, but only once the mouse has actually moved:
    // arrowing a row under a resting cursor must not hand the selection back.
    let last = null;
    list.addEventListener('pointermove', (e) => {
      if (last && last[0] === e.clientX && last[1] === e.clientY) return;
      last = [e.clientX, e.clientY];
      const row = e.target.closest?.('.cmdk-row');
      if (row) this.#paletteSelect(Number(row.dataset.i), { scroll: false });
    });

    // More rows arrive as you reach them; the first frame draws one screenful.
    list.addEventListener('scroll', () => {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - PALETTE_ROW_PX * 4) {
        this.#paletteGrow();
      }
    });

    dlg.querySelector('[data-cmdk-close]')?.addEventListener('click', () => this.#closePalette());
    // A click on the backdrop lands on the dialog itself, never on its box.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) this.#closePalette(); });
    // Esc is the browser's to handle, and it fires both of these on the way
    // out. Either one is enough; taking both means a browser that skips the
    // second still leaves the sheet in a state that knows the palette is gone.
    dlg.addEventListener('cancel', () => this.#closePalette());
    dlg.addEventListener('close', () => this.#closePalette());
  }

  /** Run the query and redraw the list under the box. */
  #paletteSearch(query) {
    if (!this.#palette) return;
    const found = palette.searchIndex(this.#paletteIndex, query, { recent: this.#paletteRecent });
    this.#paletteRows = found.rows;
    this.#paletteTerms = found.terms;
    this.#paletteAt = 0;
    this.#paletteShown = Math.min(found.rows.length, PALETTE_PAGE);
    const list = this.#palette.querySelector('.cmdk-list');
    list.innerHTML = found.rows.length
      ? palette.resultsHtml(found.rows.slice(0, this.#paletteShown), found.terms, { at: 0 })
      : palette.emptyHtml(found.query, found.scope);
    list.scrollTop = 0;
    this.#paletteFoot(found.total);
  }

  /** Draw the next page of a long result list. */
  #paletteGrow() {
    const rows = this.#paletteRows;
    if (!this.#palette || this.#paletteShown >= rows.length) return;
    const from = this.#paletteShown;
    const to = Math.min(rows.length, from + PALETTE_PAGE);
    this.#palette.querySelector('.cmdk-list')
      .insertAdjacentHTML('beforeend', palette.resultsHtml(
        rows.slice(from, to), this.#paletteTerms, { at: this.#paletteAt, from },
      ));
    this.#paletteShown = to;
    this.#paletteFoot();
  }

  /**
   * Move the selection.
   *
   * Rows are not redrawn to move it -- two class changes are -- which is what
   * keeps holding an arrow key down smooth on a list of hundreds.
   */
  #paletteMove(delta, wrap) {
    const n = this.#paletteRows.length;
    if (!n) return;
    let next = this.#paletteAt + delta;
    if (wrap) next = (next + n) % n;
    this.#paletteSelect(Math.max(0, Math.min(n - 1, next)));
  }

  #paletteSelect(i, { scroll = true } = {}) {
    if (!this.#palette || i === this.#paletteAt || !this.#paletteRows[i]) return;
    while (i >= this.#paletteShown && this.#paletteShown < this.#paletteRows.length) this.#paletteGrow();
    const list = this.#palette.querySelector('.cmdk-list');
    list.querySelector(`.cmdk-row[data-i="${this.#paletteAt}"]`)?.setAttribute('aria-selected', 'false');
    const row = list.querySelector(`.cmdk-row[data-i="${i}"]`);
    row?.setAttribute('aria-selected', 'true');
    this.#paletteAt = i;
    if (scroll) row?.scrollIntoView({ block: 'nearest' });
    this.#paletteFoot();
  }

  /** The line along the bottom: what Enter would do, and how much matched. */
  #paletteFoot(total = null) {
    const dlg = this.#palette;
    if (!dlg) return;
    if (total !== null) dlg.dataset.total = String(total);
    const count = Number(dlg.dataset.total) || 0;
    const entry = this.#paletteRows[this.#paletteAt] || null;
    dlg.querySelector('[data-cmdk-count]').textContent = palette.countText(this.#paletteShown, count);
    dlg.querySelector('[data-cmdk-primary]').textContent = entry?.action ? 'Run' : 'Jump';
    dlg.classList.toggle('has-roll', !!entry?.roll);
    dlg.querySelector('.cmdk-input')
      ?.setAttribute('aria-activedescendant', entry ? `cmdk-o-${this.#paletteAt}` : '');
  }

  /**
   * Take the row: jump to it, run it, or roll it.
   *
   * The palette always closes first. A roll's toast and a jump's landing are
   * both behind the dialog, and showing neither of them is not much of an
   * answer to having chosen.
   */
  #paletteChoose(i, { roll = false } = {}) {
    const entry = this.#paletteRows[i];
    if (!entry) return;
    this.#paletteRecent = [entry.id, ...this.#paletteRecent.filter((id) => id !== entry.id)]
      .slice(0, PALETTE_RECENT);
    this.#closePalette();
    if (roll && entry.roll) {
      this.#copyRoll(entry.roll.kind, entry.roll.ref, entry.roll.what);
      return;
    }
    if (entry.action) {
      this.#action(entry.action);
      return;
    }
    this.#paletteJump(entry);
  }

  /**
   * Land on what was chosen: the right tab, the section it hides in opened,
   * and the row itself lit up for a moment so the eye has somewhere to go.
   */
  #paletteJump(entry) {
    if (entry.tab) {
      const known = this.#tabEntries().find((t) => t.id === entry.tab);
      const onBar = this.#barEntries().some((t) => t.id === entry.tab)
        || FIXED_TABS.has(entry.tab) || entry.tab === 'systabs';
      this.#visitTab = onBar || !known ? null : { ...known };
      this.#tab = entry.tab;
    }
    // A collapsed panel renders none of its rows, so there would be nothing to
    // land on. Opening it is the same edit the ▸ button makes.
    const collapsed = this.#model.data.uiPrefs?.collapsed;
    if (entry.expand && collapsed?.[entry.expand]) {
      collapsed[entry.expand] = false;
      this.#model.recompute();
    }
    this.#render();
    const el = this.#findOnPanel(entry);
    if (!el) return;
    const row = el.closest('tr, li, .buffcard, .weaponset, .trainclass, .dashtracker, .trackerrow, '
      + '.card, .fx-row, .featcard, .panel') || el;
    row.classList.add('cmdk-found');
    setTimeout(() => row.classList.remove('cmdk-found'), 2000);
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    // Landing in the field itself means the next keystroke edits the thing you
    // went looking for -- but only where that field is really a field.
    if (isTypingIn(el) && !el.disabled && !el.readOnly) el.focus({ preventScroll: true });
  }

  /**
   * Find the entry on the panel that is now up.
   *
   * A selector first, where the panel writes one this can count on. Failing
   * that, the text: nearly everything on this sheet is an input holding the
   * words that were searched for, and matching on those keeps the jump working
   * through markup changes that would break any selector.
   */
  #findOnPanel(entry) {
    const root = this.shadowRoot;
    for (const sel of entry.sel || []) {
      // A selector built around a value the character supplies (a tracker's id)
      // can be malformed on a hand-edited document; falling through to the text
      // is a worse jump, not a broken one.
      let hit = null;
      try { hit = root.querySelector(sel); } catch { /* not a selector */ }
      if (hit) return hit;
    }
    const wanted = String(entry.find || '').trim().toLowerCase();
    if (!wanted) return null;
    const body = root.querySelector('.body') || root;
    let loose = null;
    for (const f of body.querySelectorAll('input, textarea, select')) {
      const value = String(f.value ?? '').trim().toLowerCase();
      if (!value) continue;
      if (value === wanted) return f;
      if (!loose && value.includes(wanted)) loose = f;
    }
    for (const el of body.querySelectorAll('td, th, li, h3, h4, strong, label, summary, .tname, .sname')) {
      const value = el.textContent.trim().toLowerCase();
      if (value === wanted) return el;
      if (!loose && value.length < 200 && value.includes(wanted)) loose = el;
    }
    return loose;
  }

  /* ---------------- events ---------------- */

  /**
   * The bindings the header needs, scoped so the header can be redrawn alone.
   *
   * The change count moves on a debounce after every edit, and rebuilding the
   * whole sheet to update one number would be absurd on a grid of several
   * thousand inputs. So `#renderHeader` replaces just that subtree and rebinds
   * just that subtree -- which only works if the header's listeners are
   * attachable to a scope rather than always to the whole shadow root.
   */
  #bindActions(scope) {
    scope.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', () => {
        /*
         * Choosing something from the `⋯` menu is also the gesture that shuts
         * it. Taken out by hand rather than by a redraw: several of these
         * actions render something and then put the caret in it -- the armed
         * Reset does exactly that -- and a redraw chasing the action would
         * take that field away again.
         */
        const menu = b.dataset.action === 'chrome-menu' ? null : b.closest('.chromemenu');
        if (menu) {
          this.#chromeMenu = false;
          menu.remove();
          this.shadowRoot.querySelector('[data-action="chrome-menu"]')?.setAttribute('aria-expanded', 'false');
        }
        this.#action(b.dataset.action, b);
      });
    });

    scope.querySelectorAll('[data-importfile]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        // Cleared first, so choosing the same file twice still fires.
        input.value = '';
        if (file) await this.importFile(file);
      });
    });

    // Text being typed into the history panel: a checkpoint's name, or a
    // rename in progress. Held as a draft so a redraw does not lose it.
    scope.querySelectorAll('[data-hfield]').forEach((input) => {
      input.addEventListener('input', () => {
        if (input.dataset.hfield === 'checkpoint') {
          this.#checkpointDraft = input.value;
          // The button that consumes this draft is disabled while it is empty,
          // so it has to be let go of here. Redrawing the panel instead would
          // take the field out from under whoever is typing into it.
          const keep = scope.querySelector('[data-action="save-checkpoint"]');
          if (keep) keep.disabled = !input.value.trim();
        } else if (this.#renameDraft) this.#renameDraft.label = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        this.#action(input.dataset.hfield === 'checkpoint' ? 'save-checkpoint' : 'rename-commit');
      });
    });
  }

  /**
   * Opening and shutting the folded cells (#foldedProse).
   *
   * One listener for the whole sheet rather than one per cell, because a
   * click has to be able to shut a cell it did not land on. It listens on
   * `pointerdown` rather than `click` so that opening a second cell while the
   * first is open is a single click: the press that shuts the old one is the
   * same press that opens the new one, and by `click` time the button it
   * landed on would already have been redrawn away.
   *
   * The listener goes on `.wrap`, which every render replaces, so it cannot
   * pile up the way one on the shadow root itself would.
   */
  #bindFoldedCells(root) {
    const wrap = root.querySelector('.wrap');
    if (!wrap) return;
    wrap.addEventListener('pointerdown', (e) => {
      const peek = e.target.closest?.('[data-foldcell]');
      if (peek) {
        e.preventDefault();          // focus is placed below, not by the press
        const key = peek.dataset.foldcell;
        this.#shutFoldedCell();
        this.#openCell = key;
        this.#render();
        this.shadowRoot.querySelector('.foldcell.open textarea')?.focus();
        return;
      }
      if (!this.#openCell || e.target.closest?.('.foldcell.open')) return;
      this.#shutFoldedCell();
      this.#render();
    });
    // Enter or Space on a shut cell that was tabbed to. A mouse press never
    // reaches here: it opened the cell on the way down, and by now the button
    // it landed on has been redrawn away.
    wrap.addEventListener('click', (e) => {
      const peek = e.target.closest?.('[data-foldcell]');
      if (!peek || this.#openCell === peek.dataset.foldcell) return;
      this.#shutFoldedCell();
      this.#openCell = peek.dataset.foldcell;
      this.#render();
      this.shadowRoot.querySelector('.foldcell.open textarea')?.focus();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // The `⋯` menu first: it is the thing most recently opened if both are,
      // and Escape should shut one layer, not two.
      if (this.#chromeMenu) {
        e.stopPropagation();
        this.#action('chrome-menu');
        return;
      }
      if (!this.#openCell) return;
      this.#shutFoldedCell();
      this.#render();
    });
  }

  /**
   * Shut whatever folded cell is open, keeping what was typed in it.
   *
   * A textarea commits on blur, so the field has to be blurred while it is
   * still in the document -- taking it away first would drop the edit. The
   * flag is cleared before the blur so that the re-render the commit triggers
   * already draws the cell shut, rather than opening it again for one frame.
   */
  #shutFoldedCell() {
    const field = this.shadowRoot.querySelector('.foldcell.open textarea');
    this.#openCell = null;
    field?.blur();
  }

  /**
   * Redraw the header alone.
   *
   * `gentle` is for the redraw that follows an edit rather than a click. That one
   * arrives on a timer, so it can land while the player is halfway through
   * typing a checkpoint name -- and replacing the header would take the field
   * out from under them. In that case only the number that actually moved is
   * touched.
   */
  #renderHeader({ gentle = false } = {}) {
    const root = this.shadowRoot;
    // Two subtrees now rather than one: the buttons live on the rail and what
    // they raise -- the History panel, the notices -- sits under it. Neither is
    // inside `header.head` any more, and the header itself holds nothing this
    // ever changes.
    const parts = [['.railactions', () => this.#railActions()], ['.notices', () => this.#notices()]];
    const found = parts.map(([sel]) => root.querySelector(sel));
    if (found.some((n) => !n) || !this.#model) { this.#render(); return; }

    if (gentle && found.some((n) => n.contains(root.activeElement))) {
      const save = root.querySelector('[data-action="save"]');
      if (save) {
        save.textContent = `Save${this.#changes ? ` (${this.#changes})` : ''}`;
        save.disabled = !this.#changes;
        save.classList.toggle('primary', !!this.#changes);
      }
      return;
    }

    parts.forEach(([sel, html], i) => {
      const holder = document.createElement('div');
      holder.innerHTML = html();
      const fresh = holder.firstElementChild;
      found[i].replaceWith(fresh);
      this.#bindActions(fresh);
    });
  }

  /**
   * Read-only boxes that stand as tall as what is in them.
   *
   * Today that is the folded language list, which wraps to as many lines as
   * the character has languages for. Sized here rather than with a `rows`
   * count in the markup because the count depends on how wide the box ended
   * up, and that is not knowable while the string is being built: the same
   * list wraps differently across a third of a wide row and the whole of a
   * narrow one, and it rewraps again when the window changes.
   *
   * Deliberately narrow -- `textarea.ro`, not every `[data-post]`. The
   * generated Discord posts next door are also `[data-post]` and are meant to
   * be a fixed height with a resize grip; worse, they sit inside a `<details>`
   * that may be shut, where `scrollHeight` reads 0 and this would flatten them
   * to nothing the moment they were opened.
   */
  #bindReadOnlyBoxes(root) {
    const fit = (t) => {
      t.style.height = 'auto';
      // Plus the borders. Everything here is `box-sizing: border-box`, so the
      // height set includes them, while `scrollHeight` is the content and its
      // padding and no more -- and a box set to exactly `scrollHeight` is two
      // pixels short and clips its own last line.
      const cs = getComputedStyle(t);
      const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      t.style.height = `${t.scrollHeight + (Number.isFinite(borders) ? borders : 0)}px`;
    };
    const boxes = [...root.querySelectorAll('textarea.ro[data-post]')];
    boxes.forEach(fit);
    if (!boxes.length || typeof ResizeObserver !== 'function') return;

    /*
     * A narrowed sheet rewraps the list, so the box has to follow it -- the
     * height set above is only right for the width it was measured at.
     *
     * Two things this has to be careful about. It watches *width*: setting the
     * height is itself a resize, so a callback that refits on any change would
     * feed itself. And it is one observer for the element rather than one per
     * render -- `#bind` runs after every one of them, and a fresh observer
     * each time would leave a trail of them pointed at detached textareas.
     */
    this.#roBoxObserver?.disconnect();
    const seen = new WeakMap();
    this.#roBoxObserver = new ResizeObserver((entries) => {
      for (const e of entries) {
        const width = e.contentRect.width;
        if (seen.get(e.target) === width) continue;
        seen.set(e.target, width);
        fit(e.target);
      }
    });
    boxes.forEach((t) => this.#roBoxObserver.observe(t));
  }

  /**
   * The colour picker for one tab: a small panel, opened two ways.
   *
   * Right-clicking a tab is the fast way and the one nobody discovers, so the
   * ⚙ manager gives every row on the bar a swatch that opens the same thing.
   * One panel with two triggers rather than two controls, because the second
   * would be the first with a different way of being wrong.
   *
   * It rides in `#render` like every other piece of view state instead of
   * being a floating node: a right-click is not a keystroke, so the re-render
   * it causes costs nothing, and this way the panel cannot outlive the tab it
   * is colouring.
   */
  #tabColorMenuHtml() {
    const m = this.#tabColorFor;
    if (!m || !this.#model) return '';
    const cur = this.#model.tabColor(m.key);
    const swatch = (hex, name) => `<button class="swatch${hex ? '' : ' none'}" data-tabswatch
      data-hex="${hex}"${hex ? ` style="background:${hex}"` : ''}
      title="${esc(hex ? `${name} ${hex}` : 'Theme default')}" aria-label="${esc(hex ? name : 'Theme default')}"
      aria-pressed="${(cur || '') === hex}"></button>`;
    return `<div class="tabmenu" style="left:${m.x}px;top:${m.y}px" role="dialog" aria-label="Tab colour">
      <div class="tabmenu-head">
        <span class="tabmenu-name">${esc(m.label)}</span>
        <button data-action="tabcolor-close" title="Close" aria-label="Close">×</button>
      </div>
      <div class="swatches" role="group" aria-label="Tab colour">
        ${swatch('', '')}
        ${TRACKER_PALETTE.map(([h, n]) => swatch(h, n)).join('')}
      </div>
      <div class="pair">
        <input class="mono hexin" data-tabhex value="${esc(cur || '')}" placeholder="#rrggbb"
          maxlength="7" aria-label="Tab colour hex">
        <input type="color" data-tabpick value="${esc(cur || THEME_ACCENT.hex)}" aria-label="Tab colour picker">
      </div>
    </div>`;
  }

  /**
   * Open the colour panel for one tab, positioned inside the sheet.
   *
   * The coordinates are relative to the host so the panel travels with the
   * component rather than the page, and they are clamped to keep it on the
   * sheet when a tab near the right edge is the one clicked.
   */
  #openTabColor(key, label, atX, atY) {
    if (this.isPublished) return;            // a reader's colours go nowhere
    const box = this.getBoundingClientRect();
    const WIDTH = 232;
    const x = Math.max(6, Math.min(atX - box.left, box.width - WIDTH - 6));
    this.#tabColorFor = { key, label, x, y: Math.max(6, atY - box.top) };
    this.#render();
  }

  /**
   * The colour panel's own controls, plus the two ways out of it.
   *
   * A swatch, the hex box and the native picker all land on the same setter,
   * and none of them re-renders. That is the same bargain `#bindCharacterColor`
   * strikes one panel over, for a sharper version of the same reason: the
   * native picker sends `input` continuously while its hue slider is dragged,
   * and a re-render replaces the `<input type="color">` node it is attached to
   * -- so re-rendering there tears down the very popup the player is dragging
   * in. Everything the colour shows on is repainted in place instead, and the
   * one re-render happens when the panel closes.
   *
   * Nothing calls `#persist` either: `setTabColor` recomputes, every model
   * change notifies the subscriber set up with the document, and saving is
   * what that subscriber does.
   */
  #bindTabColor(root) {
    root.querySelectorAll('[data-tabcolor-open]').forEach((b) => {
      b.addEventListener('click', (e) => {
        const r = b.getBoundingClientRect();
        this.#openTabColor(b.dataset.tabcolorOpen, b.dataset.tabcolorLabel || 'Tab', r.left, r.bottom + 4);
        e.stopPropagation();
      });
    });

    const menu = root.querySelector('.tabmenu');
    if (!menu) return;
    const hexBox = menu.querySelector('[data-tabhex]');

    /** Write the colour, then repaint everything wearing it, in place. */
    const apply = (hex, { fromHexBox = false } = {}) => {
      const key = this.#tabColorFor.key;
      this.#model.setTabColor(key, hex);
      const sel = `[data-tabkey="${CSS.escape(key)}"]`;
      const tab = root.querySelector(`nav.tabs ${sel}`);
      if (tab) {
        tab.classList.toggle('tinted', !!hex);
        if (hex) {
          tab.style.setProperty('--tab-color', hex);
          tab.style.setProperty('--tab-ink', readableOn(hex, this.#surface()));
        } else {
          tab.style.removeProperty('--tab-color');
          tab.style.removeProperty('--tab-ink');
        }
      }
      const rowSwatch = root.querySelector(`[data-tabcolor-open="${CSS.escape(key)}"]`);
      if (rowSwatch) {
        rowSwatch.classList.toggle('none', !hex);
        if (hex) rowSwatch.style.background = hex;
        else rowSwatch.style.removeProperty('background');
      }
      menu.querySelectorAll('[data-tabswatch]').forEach((b) => {
        b.setAttribute('aria-pressed', String((normalizeHex(b.dataset.hex) || '') === (hex || '')));
      });
      // Not while it is the field being typed in, or the caret jumps.
      if (hexBox && !fromHexBox) {
        hexBox.value = hex || '';
        hexBox.classList.remove('bad');
      }
    };

    menu.querySelectorAll('[data-tabswatch]').forEach((b) => {
      b.addEventListener('click', () => apply(normalizeHex(b.dataset.hex)));
    });
    menu.querySelector('[data-tabpick]')?.addEventListener('input', (e) => {
      apply(normalizeHex(e.target.value));
    });
    hexBox?.addEventListener('input', () => {
      // Typed a character at a time, so an incomplete hex is not an error yet
      // -- it is only marked, and nothing is written until it reads.
      const hex = normalizeHex(hexBox.value);
      hexBox.classList.toggle('bad', !!hexBox.value.trim() && !hex);
      if (hex || !hexBox.value.trim()) apply(hex, { fromHexBox: true });
    });

    const close = () => { this.#tabColorFor = null; this.#render(); };
    menu.querySelector('[data-action="tabcolor-close"]')?.addEventListener('click', close);
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    // Closing on a click elsewhere is *not* bound here: `#bind` runs after
    // every render and the shadow root outlives all of them, so a listener
    // added here would be added again on each one, and the stale copies --
    // closing over a menu node that has since been replaced -- would see every
    // later click as "elsewhere" and shut the panel before the swatch under
    // the pointer could act. It is one listener for the element's life
    // instead: `#onPointerDownAway`, installed in `connectedCallback`.
  }

  /**
   * A press anywhere but the colour panel closes it.
   *
   * `pointerdown` rather than `click` so it lands before whatever is underneath
   * acts, and `composedPath` rather than `contains` because an event from
   * inside the shadow root is retargeted at the host on its way out. Reads the
   * live state rather than closing over a node, which is what lets it be bound
   * once and survive every re-render.
   */
  #onPointerDownAway = (e) => {
    const path = e.composedPath?.() || [];
    // The `⋯` menu shuts on a press outside it the same way, and on the same
    // listener -- one for the element's life rather than one per render.
    // Its own toggle is excluded, or the press that opens it would also be the
    // press that closes it.
    if (this.#chromeMenu && !path.some((n) => n?.classList?.contains?.('chromemenu')
      || n?.dataset?.action === 'chrome-menu')) {
      this.#chromeMenu = false;
      this.#renderHeader();
    }
    if (!this.#tabColorFor) return;
    // Inside the panel, or on a control whose own handler opens it: not away.
    if (path.some((n) => n?.classList?.contains?.('tabmenu')
      || n?.dataset?.tabcolorOpen !== undefined)) return;
    /*
     * The native colour picker is browser chrome, drawn outside this document
     * entirely -- so a press on its hue slider, its saturation square or its
     * own hex box is not in `path` and reads exactly like a press somewhere
     * else on the sheet. That shut the panel the instant anyone touched it,
     * which made the control useless: it could be opened and not used.
     *
     * While `<input type="color">` holds focus its popup is what is being
     * used and nothing out here is, so the press is not ours to act on. The
     * input keeps focus for as long as the popup is open, which is what makes
     * this self-clearing rather than a flag with a lifetime to get wrong.
     */
    if (this.shadowRoot.activeElement?.matches?.('[data-tabpick]')) return;
    this.#tabColorFor = null;
    this.#render();
  };

  /**
   * Arrow keys along the tab bar, which is the half of `role="tablist"` that
   * is a promise rather than a label.
   *
   * A tablist tells a screen reader "these are the sections, and one of them
   * is open" -- and having said so, it owes the reader the navigation that
   * comes with it: the bar is *one* stop on the Tab key (the roving tabindex
   * in `#render`), and the arrows move within it. Without this the reader is
   * told there are twenty sections and given no way to walk them.
   *
   * Selection follows focus, which the ARIA practices allow where showing a
   * panel is cheap and is what clicking already does here. That costs a
   * re-render per arrow press, and a re-render replaces the button the key
   * came from -- so focus is put back on the tab that is now selected, or the
   * bar would drop the reader on the document after one press.
   *
   * Bound to the bar rather than the root on purpose: a sheet is mostly text
   * inputs, and a document-level arrow handler would fight every one of them.
   */
  #bindTabKeys(root) {
    const bar = root.querySelector('nav.tabs');
    if (!bar) return;
    // Right-click a tab to colour it. The native menu is given up on the tabs
    // only -- everywhere else on the sheet it is left alone, because "copy
    // this cell" is worth more there than any menu of ours would be.
    bar.addEventListener('contextmenu', (e) => {
      const btn = e.target?.closest?.('[role="tab"][data-tabkey]');
      if (!btn || this.isPublished) return;
      e.preventDefault();
      this.#openTabColor(btn.dataset.tabkey, btn.textContent.trim(), e.clientX, e.clientY);
    });
    bar.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const tabs = [...bar.querySelectorAll('[role="tab"]')];
      const at = tabs.findIndex((t) => t === e.target);
      if (at < 0) return;
      let to = at;
      switch (e.key) {
        // Wrapping at both ends, so the bar is a loop rather than a dead stop.
        case 'ArrowRight': to = (at + 1) % tabs.length; break;
        case 'ArrowLeft': to = (at - 1 + tabs.length) % tabs.length; break;
        case 'Home': to = 0; break;
        case 'End': to = tabs.length - 1; break;
        default: return;
      }
      e.preventDefault();
      const id = tabs[to].dataset.tab;
      if (id === this.#tab) return;
      this.#tab = id;
      this.#render();
      this.shadowRoot.getElementById(`tab-${id}`)?.focus({ preventScroll: true });
      this.#showPanelTop();
    });
  }

  /**
   * Where a tab switch leaves you.
   *
   * The panel that just opened starts at its top, so that is where the reader
   * should be standing. Without this you keep whatever offset the last tab had
   * -- clamped to the new panel's height, which is an arbitrary place inside
   * it -- and the commonest way to open a tab is also the commonest way to
   * arrive somewhere you did not ask for.
   *
   * Only ever upwards. Clicking a tab while the header is still on screen must
   * not scroll the header away to satisfy a rule about panel tops.
   *
   * `scrollIntoView` rather than `window.scrollTo` because an embedded sheet
   * may sit inside a scroll container belonging to the host, and the margin is
   * measured rather than written in the stylesheet because the rail stands one
   * row taller in the session view.
   */
  #showPanelTop() {
    const body = this.shadowRoot.querySelector('.body');
    if (!body) return;
    const rail = this.shadowRoot.querySelector('.tabrail')?.getBoundingClientRect();
    body.style.scrollMarginTop = `${Math.round(rail?.height ?? 0) + 10}px`;
    if (body.getBoundingClientRect().top < (rail?.bottom ?? 0) - 1) {
      body.scrollIntoView({ block: 'start' });
    }
  }

  /**
   * Keep the open tab in sight on a bar that scrolls sideways.
   *
   * Below 700px the bar is one scrolling row rather than five wrapped ones, so
   * that pinning it costs a strip and not half the screen -- and a row that
   * scrolls starts every render back at its left edge. Centring the open tab
   * is what stops "which tab am I on" from being a horizontal search.
   */
  #showActiveTab() {
    const bar = this.shadowRoot.querySelector('nav.tabs');
    const tab = bar?.querySelector('[role="tab"][aria-selected="true"]');
    if (!tab || bar.scrollWidth <= bar.clientWidth) return;
    const t = tab.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    if (t.left >= b.left && t.right <= b.right) return;
    bar.scrollLeft += (t.left - b.left) - (b.width - t.width) / 2;
  }

  /**
   * Rearranging by drag: the tabs on the bar, and the rows of the manager's
   * "Tab bar" list. Both carry `data-tabkey`; dropping one on another puts it
   * before that one (or after, when dropped on the right/lower half), and a
   * drop on the bar's empty end puts it last. Reordering is a preference, so
   * it goes through the model like a Hide or Show and is saved with the rest.
   */
  #bindTabDrag(root) {
    const draggables = root.querySelectorAll('[draggable="true"][data-tabkey]');
    if (!draggables.length) return;
    let dragging = null;
    const clear = () => root.querySelectorAll('.drop-before, .drop-after')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const after = (e, el) => {
      const r = el.getBoundingClientRect();
      const horizontal = el.matches('nav.tabs [data-tabkey]');
      return horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    };
    draggables.forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragging = el.dataset.tabkey;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragging);
      });
      el.addEventListener('dragend', () => { dragging = null; el.classList.remove('dragging'); clear(); });
      el.addEventListener('dragover', (e) => {
        if (!dragging || dragging === el.dataset.tabkey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clear();
        el.classList.add(after(e, el) ? 'drop-after' : 'drop-before');
      });
      el.addEventListener('drop', (e) => {
        if (!dragging || dragging === el.dataset.tabkey) return;
        e.preventDefault();
        const order = this.#model.tabOrder();
        const at = order.indexOf(el.dataset.tabkey);
        if (at < 0) return;
        this.#model.moveTab(dragging, after(e, el) ? at + 1 : at);
        dragging = null;
        this.#render();
      });
    });
    // The bar itself: a drop past the last tab (on the ⚙ or the empty run) goes last.
    const nav = root.querySelector('nav.tabs');
    if (nav) {
      nav.addEventListener('dragover', (e) => {
        if (!dragging || e.target.closest('[data-tabkey]')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      nav.addEventListener('drop', (e) => {
        if (!dragging || e.target.closest('[data-tabkey]')) return;
        e.preventDefault();
        this.#model.moveTab(dragging, this.#model.tabOrder().length);
        dragging = null;
        this.#render();
      });
    }
  }

  #bind() {
    const root = this.shadowRoot;

    root.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.#tab = b.dataset.tab;
        this.#render();
        // The button that was clicked no longer exists -- `#render` replaced
        // the whole root -- so focus has to be put back on the one that took
        // its place, or a keyboard is dropped on the document mid-bar. The
        // arrow keys have always done this; the click path had not.
        this.shadowRoot.getElementById(`tab-${this.#tab}`)?.focus({ preventScroll: true });
        this.#showPanelTop();
      });
    });
    this.#bindTabKeys(root);
    this.#bindTabColor(root);
    this.#bindTabDrag(root);

    // The d20 buttons. One listener per button rather than one on the root,
    // because the skills table alone puts dozens of them on the page and each
    // already carries everything the handler needs.
    root.querySelectorAll('[data-roll]').forEach((b) => {
      b.addEventListener('click', () => {
        // Only the first bar separates kind from ref; what follows is the ref's
        // own business ("eidolon|attack:0", "concentration|vancian:1").
        const at = b.dataset.roll.indexOf('|');
        this.#copyRoll(b.dataset.roll.slice(0, at), b.dataset.roll.slice(at + 1),
          b.dataset.rollwhat);
      });
    });
    this.#bindRollToast(root);

    // The Technique List's picker: a select, so a change rather than a click.
    root.querySelectorAll('select[data-action="tech-select"]').forEach((sel) => {
      sel.addEventListener('change', () => { this.#model.selectTechnique(sel.value); this.#render(); });
    });
    // A workbook offered to the Technique List: converted in the browser like an
    // import, but only its techniques are taken.
    root.querySelectorAll('[data-techfile]').forEach((input) => {
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
          const { convertWorkbook } = await import('./convert.js');
          const doc = await convertWorkbook(await file.arrayBuffer(), { id: 'techniques' });
          const { added, replaced, total } = this.#model.mergeTechniquesFrom(doc);
          this.#historyNote = `Techniques from ${file.name}: ${added} added, ${replaced} updated — ${total} on the list.`;
        } catch (err) {
          this.#historyNote = `Could not read ${file.name} — ${err.message}`;
        }
        this.#render();
      });
    });

    this.#bindActions(root);

    // Generic field -> model path. data-kind decides the coercion.
    root.querySelectorAll('[data-set]').forEach((input) => {
      if (input.dataset.build || input.dataset.pick) return;
      input.addEventListener('change', () => {
        const path = input.dataset.set;
        this.#model.set(path, readControl(input));
        if (AFFECTS_DERIVED.test(path)) this.#rerender(input);
      });
    });

    /*
     * A sphere talent, which writes more than the cell it was typed in: a
     * name the pack catalogue knows settles the row's sphere, and its rules
     * text is what the player was about to go and look up. Both are filled
     * only when blank -- see setTalentEntry. The cell is skipped by the
     * generic writer below, so this is the one write and the one render.
     */
    root.querySelectorAll('[data-talent-fill]').forEach((input) => {
      input.addEventListener('change', () => {
        const [list, index, field] = input.dataset.item.split('|');
        const fill = JSON.parse(input.dataset.talentFill);
        // The cell it was typed in is the cell it is written to. `fill` names
        // the row's *other* columns; the talent's own comes off the binding
        // and overrides anything the fill says, because a row can hold two
        // talents -- a guile level has a free pick and a [utility] one -- and
        // a fill that forgot to say which would quietly write to the wrong
        // one. It did, once.
        this.#model.setTalentEntry(list, Number(index), input.value, { ...fill, talent: field });
        this.#rerender(input);
      });
    });

    // Generic list-item field -> model path.
    root.querySelectorAll('[data-item]').forEach((input) => {
      if (input.dataset.talentFill) return;
      input.addEventListener('change', () => {
        const [list, index, field] = input.dataset.item.split('|');
        this.#model.setItem(list, Number(index), field, readControl(input));
        if (AFFECTS_DERIVED.test(list)) this.#rerender(input);
      });
    });

    // An ability picker wears the colour of the ability it picked, so it has to
    // repaint the moment the choice changes. Every ability slot on the sheet
    // today sits under a path AFFECTS_DERIVED matches, and so comes back as
    // fresh markup anyway; this is what keeps one that does not -- a slot an
    // extension adds, a new top-level key -- from wearing the old colour.
    root.querySelectorAll('select[data-ab]').forEach((sel) => {
      sel.addEventListener('change', () => {
        // The option knows best: a picker whose choices are not ability names
        // ("Alt Melee") carries the answer on each option instead.
        const picked = sel.selectedOptions?.[0];
        sel.dataset.ab = picked?.dataset.ab ?? abilityKey(sel.value);
      });
    });

    /*
     * Spending a slot. The nth pip leaves n unspent, and the lowest lit one
     * spends it -- the same rule the tracker pips follow, so the two shapes
     * behave alike wherever they turn up.
     */
    root.querySelectorAll('[data-spend]').forEach((b) => {
      b.addEventListener('click', () => {
        const [list, index, field] = b.dataset.spend.split('|');
        const total = Number(b.dataset.total) || 0;
        const left = Number(b.dataset.left) || 0;
        const n = Number(b.dataset.n) || 0;
        const keep = left === n ? n - 1 : n;
        this.#model.setItem(list, Number(index), field,
          Math.max(0, Math.min(total, total - keep)));
        this.#render();
      });
    });

    /*
     * The power-point pool. One pool for the character rather than a tracker of
     * its own, so it carries its own controls: the bar sets what is left from
     * where you click, and the field and the two buttons do it by the number.
     */
    const setPoolLeft = (left) => {
      const pool = Number(this.#model.data.psionics?.pool) || 0;
      const keep = Math.max(0, Math.min(pool, Math.round(left)));
      this.#model.set('psionics.spent', pool - keep);
      this.#render();
    };
    root.querySelectorAll('[data-pool-step]').forEach((b) => {
      b.addEventListener('click', () => setPoolLeft(
        (Number(this.#model.data.psionics?.left) || 0) + Number(b.dataset.poolStep),
      ));
    });
    root.querySelectorAll('[data-pool-left]').forEach((input) => {
      input.addEventListener('change', () => setPoolLeft(Number(input.value) || 0));
    });
    // The power point meter is still click-to-set, whatever it has been
    // restyled to: a bar reads the position along the track, and the pips
    // carry the number they stand for.
    root.querySelectorAll('.meter.pp .bar').forEach((bar) => {
      bar.classList.add('clickable');
      bar.addEventListener('click', (e) => {
        const box = bar.getBoundingClientRect();
        if (!box.width) return;
        const pool = Number(this.#model.data.psionics?.pool) || 0;
        // `current` is what a tracker would store -- points spent -- and the
        // pool stores what is left, so it goes back the other way. Doing it
        // through barClickValue keeps a drained bar reading left-to-right.
        const { current } = barClickValue((e.clientX - box.left) / box.width, {
          min: 0, max: pool, style: this.#model.meterStyle('pp'),
        });
        setPoolLeft(pool - current);
      });
    });
    root.querySelectorAll('.meter.pp .pips').forEach((row) => {
      const pips = [...row.querySelectorAll('.pip')];
      pips.forEach((pip, i) => {
        pip.classList.add('clickable');
        pip.addEventListener('click', () => {
          const pool = Number(this.#model.data.psionics?.pool) || 0;
          const n = i + 1;                      // the pool starts at 0, so pips run 1..max
          const draining = this.#model.meterStyle('pp').fill === 'remaining';
          setPoolLeft(Math.max(0, Math.min(pool, draining ? n : pool - n)));
        });
      });
    });

    // The Cardcasting tab's two faces.
    root.querySelectorAll('[data-deck-view]').forEach((b) => {
      b.addEventListener('click', () => { this.#deckView = b.dataset.deckView; this.#render(); });
    });

    // The table in play: every button carries its action, the card and an argument.
    root.querySelectorAll('[data-table]').forEach((b) => {
      b.addEventListener('click', () => {
        const [action, id, arg] = b.dataset.table.split('|');
        const m = this.#model;
        this.#peek = [];
        switch (action) {
          case 'start': m.tableStart(); break;
          case 'redraw': m.tableRedraw(); break;
          case 'next': m.tableNextRound(); break;
          case 'draw': m.tableDraw(1, 'draw'); break;
          case 'shuffle': m.tableShuffleDiscard(); break;
          case 'end': m.tableEnd(); break;
          case 'play': m.tablePlay(id, arg || 'cast'); break;
          case 'resolve': m.tableResolve(id); break;
          case 'reveal': m.tableReveal(id); break;
          case 'roll': m.tableRoll(id); break;
          case 'exileRandom': m.tableExileRandom(Number(arg) || 1); break;
          case 'sp': m.tableSpend(id, Number(arg) || 1); break;
          case 'retrace': m.tableRetrace(id); break;
          case 'bury': m.tableBury(id); break;
          case 'move': m.tableMove(id, arg); break;
          case 'tap': m.tableTap(id); break;
          case 'peek': this.#peek = m.tablePeek(Number(arg) || 1); break;
          default: return;
        }
        this.#render();
      });
    });
    // A named roll picked on a card: spends what its label says, then rolls.
    root.querySelectorAll('[data-table-roll]').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        this.#model.tableBoost(sel.dataset.tableRoll, sel.value);
        this.#render();
      });
    });
    root.querySelectorAll('[data-table-move]').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        this.#peek = [];
        this.#model.tableMove(sel.dataset.tableMove, sel.value);
        this.#render();
      });
    });

    // A deck manipulation picked from the catalogue: it lands in its own group
    // with a count of one, or bumps the count of the row that already has it.
    root.querySelectorAll('select.manip-pick').forEach((sel) => {
      sel.addEventListener('change', () => {
        const entry = deckManipulation(sel.value);
        sel.value = '';
        if (!entry) return;
        const list = this.#model.data.cardcasting?.manipulations || [];
        const idx = list.findIndex((m) => deckManipulation(m.name) === entry);
        if (idx >= 0) this.#model.setItem('cardcasting.manipulations', idx, 'count', (Number(list[idx].count) || 0) + 1);
        else this.#model.listAdd('cardcasting.manipulations', { group: entry.group, name: entry.name, note: '', count: 1 });
        this.#render();
      });
    });

    root.querySelectorAll('[data-add]').forEach((b) => {
      b.addEventListener('click', () => {
        let template = {};
        try { template = JSON.parse(b.dataset.template || '{}'); } catch { /* default */ }
        this.#model.listAdd(b.dataset.add, template);
        this.#render();
      });
    });

    // A list seeded whole rather than a row at a time: see addManyButton.
    root.querySelectorAll('[data-add-many]').forEach((b) => {
      b.addEventListener('click', () => {
        let items = [];
        try { items = JSON.parse(b.dataset.template || '[]'); } catch { /* default */ }
        for (const item of items) this.#model.listAdd(b.dataset.addMany, item);
        this.#render();
      });
    });

    // A condition taken off the list altogether -- keyed by name, since the
    // list is a map and not a row array.
    root.querySelectorAll('[data-remove-condition]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        const conds = this.#model.data.conditions || {};
        delete conds[b.dataset.removeCondition];
        this.#model.recompute();
        this.#render();
      });
    });

    root.querySelectorAll('[data-remove]').forEach((b) => {
      b.addEventListener('click', () => {
        const [list, index] = b.dataset.remove.split('|');
        this.#model.listRemove(list, Number(index));
        this.#render();
      });
    });

    // The two-click ×: the first click arms it, the second removes. Arming a
    // different one disarms the first, and a removal drops the armed state so
    // it can never point at the row that slid into the gap.
    root.querySelectorAll('[data-remove-armed]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.removeArmed;
        if (this.#armedRemove === key) {
          const [list, index] = key.split('|');
          this.#armedRemove = null;
          this.#model.listRemove(list, Number(index));
        } else {
          this.#armedRemove = key;
        }
        this.#render();
      });
    });

    root.querySelectorAll('[data-move]').forEach((b) => {
      b.addEventListener('click', () => {
        const [list, index, delta] = b.dataset.move.split('|');
        this.#model.listMove(list, Number(index), Number(delta));
        this.#render();
      });
    });

    // A merged cell is not drawn, so this is the way back to it: the table
    // shows every cell it stores, merge markers included.
    root.querySelectorAll('[data-cells]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.cells;
        if (this.#showCells.has(key)) this.#showCells.delete(key);
        else this.#showCells.add(key);
        this.#render();
      });
    });

    // A table follows its feature, so moving one is a matter of naming the
    // feature it should be under.
    root.querySelectorAll('[data-tmove]').forEach((select) => {
      select.addEventListener('change', () => {
        if (!select.value) return;
        const cut = select.dataset.tmove.lastIndexOf('|');
        this.#model.moveTemplateTable(select.dataset.tmove.slice(0, cut),
          Number(select.dataset.tmove.slice(cut + 1)), select.value);
        this.#render();
      });
    });

    // ↑/↓ on a template sub-ability, which spills into the next ability at
    // either end rather than stopping there.
    root.querySelectorAll('[data-tnudge]').forEach((b) => {
      b.addEventListener('click', () => {
        const [ti, gi, ci, delta] = b.dataset.tnudge.split('|').map(Number);
        this.#model.nudgeTemplateChild(ti, gi, ci, delta);
        this.#render();
      });
    });

    root.querySelectorAll('[data-postbox]').forEach((d) => {
      d.addEventListener('toggle', () => this.#openPosts.set(d.dataset.postbox, d.open));
    });

    this.#bindReadOnlyBoxes(root);

    // Generated Discord posts, and the folded language list: hand the text to
    // the clipboard, or select it when the browser refuses (a page served over
    // plain http). The box is not always inside a <details> -- the languages
    // are already in the open -- so opening one is only if there is one.
    root.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.preventDefault();   // the button lives in a <summary>
        const box = root.querySelector(`[data-post="${CSS.escape(b.dataset.copy)}"]`);
        if (!box) return;
        const done = (label) => {
          b.textContent = label;
          setTimeout(() => { if (b.isConnected) b.textContent = 'Copy'; }, 1500);
        };
        try {
          await navigator.clipboard.writeText(box.value);
          done('Copied');
        } catch {
          const holder = b.closest('details');
          if (holder) holder.open = true;
          box.focus();
          box.select();
          done('Press Ctrl+C');
        }
      });
    });

    root.querySelectorAll('[data-prog]').forEach((select) => {
      select.addEventListener('change', () => {
        const [lvl, track] = select.dataset.prog.split('|');
        this.#model.setProgressionClass(Number(lvl), Number(track), select.value || null);
        this.#render();
      });
    });

    // "Fill column…": one class down every level of a track. The picker is an
    // action rather than a value, so it goes back to its prompt afterwards --
    // which the re-render does for it.
    root.querySelectorAll('[data-filltrack]').forEach((select) => {
      select.addEventListener('change', () => {
        if (!select.value) return;
        this.#model.fillProgressionTrack(Number(select.dataset.filltrack), select.value);
        this.#render();
      });
    });

    // Feature cells: multi-line, auto-growing. When a rendered view is showing
    // (formulas collapsed to values) the view is the in-flow element and sizes
    // itself; the textarea only needs sizing while editing.
    const grow = (t) => {
      const wrap = t.closest('.prose');
      const showingView = wrap?.querySelector('.prose-view') && !wrap.classList.contains('editing');
      if (showingView) return;
      t.style.height = 'auto';
      t.style.height = `${Math.max(26, t.scrollHeight)}px`;
    };
    root.querySelectorAll('.cfeat').forEach((t) => {
      const isBox = t.tagName === 'TEXTAREA';
      if (isBox) { grow(t); t.addEventListener('input', () => grow(t)); }
      t.addEventListener('change', () => {
        const { c, l, k, g } = JSON.parse(t.dataset.cfeat);
        this.#model.setClassFeature(c, Number(l), k, t.value, g ?? null);
        // Re-render so any {…} tokens (here and elsewhere) pick up the change.
        this.#rerender(t);
      });
    });

    // Prose fields with inline formulas: show computed values until focused,
    // raw source while editing. Any prose edit may define or change a name
    // used elsewhere, so it re-renders on change.
    root.querySelectorAll('.prose').forEach((wrap) => {
      const ta = wrap.querySelector('textarea');
      const view = wrap.querySelector('.prose-view');
      if (!ta) return;
      if (wrap.classList.contains('grow') && !ta.classList.contains('cfeat')) {
        grow(ta);
        ta.addEventListener('input', () => grow(ta));
      }
      if (view) {
        view.addEventListener('mousedown', (e) => {
          e.preventDefault();
          wrap.classList.add('editing');
          grow(ta);
          ta.focus();
          try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch { /* ignore */ }
        });
        ta.addEventListener('focus', () => { wrap.classList.add('editing'); grow(ta); });
        ta.addEventListener('blur', () => { wrap.classList.remove('editing'); grow(ta); });
      }
      if (!ta.classList.contains('cfeat')) {
        ta.addEventListener('change', () => {
          if (hasTokens(ta.value) || wrap.classList.contains('has-tokens')) this.#rerender(ta);
        });
      }
    });

    // Formula fields: the resolved value sits in the cell, the source appears
    // in place on click or tab. The change listener is the generic
    // data-item/data-set one, already bound above.
    root.querySelectorAll('.xf').forEach((wrap) => {
      const input = wrap.querySelector('input.xf-src');
      const view = wrap.querySelector('.xf-view');
      if (!input || !view) return;
      view.addEventListener('mousedown', (e) => {
        e.preventDefault();
        wrap.classList.add('editing');
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* ignore */ }
      });
      input.addEventListener('focus', () => wrap.classList.add('editing'));
      input.addEventListener('blur', () => wrap.classList.remove('editing'));
    });

    // Draggable column widths on the feature-group tables.
    root.querySelectorAll('.col-resizer').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const th = handle.closest('th');
        const table = handle.closest('table');
        const colEl = table.querySelectorAll('colgroup col')[th.cellIndex];
        if (!colEl) return;
        const startX = e.clientX;
        const startW = colEl.getBoundingClientRect().width;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('dragging');

        const onMove = (ev) => {
          const w = Math.max(90, Math.round(startW + ev.clientX - startX));
          colEl.style.width = `${w}px`;
          const cols = [...table.querySelectorAll('colgroup col')];
          table.style.width = `${cols.reduce((t, c) => t + parseFloat(c.style.width || 0), 0)}px`;
          // Re-fit the wrapped text as the column moves.
          const idx = th.cellIndex;
          table.querySelectorAll('tbody tr').forEach((row) => {
            const cell = row.cells[idx]?.querySelector('textarea.cfeat');
            if (cell) grow(cell);
          });
        };
        const onUp = () => {
          handle.classList.remove('dragging');
          handle.removeEventListener('pointermove', onMove);
          const w = parseFloat(colEl.style.width);
          this.#model.setColumnWidth(handle.dataset.resizeTable, handle.dataset.resizeCol, w);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp, { once: true });
        handle.addEventListener('pointercancel', onUp, { once: true });
      });
    });

    // The two halves of a tradition pool always add up to its steps, so typing
    // into either one is really moving the boundary between them.
    root.querySelectorAll('[data-split]').forEach((input) => {
      input.addEventListener('change', () => {
        const [target, total, kind] = input.dataset.split.split('|');
        const n = Math.max(0, Math.min(Number(total), Math.floor(Number(input.value) || 0)));
        this.#model.set(target, kind === 'sp' ? n : Number(total) - n);
        this.#rerender(input);
      });
    });

    // Blending a class adds or drops its block on the other side, so the whole
    // tab is redrawn rather than the one control.
    root.querySelectorAll('[data-blend]').forEach((box) => {
      box.addEventListener('change', () => {
        const [side, index] = box.dataset.blend.split('|');
        this.#model.setBlended(side, Number(index), box.checked);
        this.#render();
      });
    });

    // Drawing a weapon moves every sphere number on the tab, so the tab is
    // redrawn rather than the radio.
    root.querySelectorAll('[data-custactive]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const [block, set] = radio.dataset.custactive.split('|');
        this.#model.setCustomizationActive(Number(block), Number(set));
        this.#render();
      });
    });
    // Widening or narrowing what a track may learn changes every sphere
    // dropdown under it, so the tab is redrawn.
    root.querySelectorAll('[data-custspheres]').forEach((select) => {
      select.addEventListener('change', () => {
        this.#model.setCustomizationRule(Number(select.dataset.custspheres), 'spheres', select.value);
        this.#render();
      });
    });
    // A counting rule opens and shuts rows under the panel it is typed in.
    root.querySelectorAll('[data-custrule]').forEach((input) => {
      input.addEventListener('change', () => {
        const [block, key, field] = input.dataset.custrule.split('|');
        this.#model.setCustomizationRule(Number(block), key, field, input.value);
        this.#render();
      });
    });
    root.querySelectorAll('[data-remove-customization]').forEach((button) => {
      button.addEventListener('click', () => {
        this.#model.removeCustomization(Number(button.dataset.removeCustomization));
        this.#render();
      });
    });

    this.#bindTemplateDrag(root);
    this.#bindLanguageDrag(root);
    this.#bindFeatDrag(root);

    root.querySelectorAll('[data-cfcol]').forEach((input) => {
      input.addEventListener('change', () => {
        const sep = input.dataset.cfcol.lastIndexOf('|');
        const cls = input.dataset.cfcol.slice(0, sep);
        const idx = Number(input.dataset.cfcol.slice(sep + 1));
        this.#model.renameClassFeatureColumn(cls, idx, input.value.trim());
        this.#rerender(input);
      });
    });

    // The block shelf's search: typed into, so it filters as you go and keeps
    // the caret where it was.
    root.querySelectorAll('[data-ext-search]').forEach((input) => {
      input.addEventListener('input', () => {
        this.#extSearch = input.value;
        this.#rerender(input);
      });
    });

    // A class's own feature text, under its ladder.
    root.querySelectorAll('[data-cfnote]').forEach((el) => {
      el.addEventListener('change', () => {
        const { c, i, k } = JSON.parse(el.dataset.cfnote);
        this.#model.setClassFeatureNote(c, Number(i), { [k]: el.value });
        this.#rerender(el);
      });
    });

    root.querySelectorAll('[data-cfmenu]').forEach((select) => {
      select.addEventListener('change', () => {
        const sep = select.dataset.cfmenu.lastIndexOf('|');
        const cls = select.dataset.cfmenu.slice(0, sep);
        const idx = Number(select.dataset.cfmenu.slice(sep + 1));
        this.#model.setClassFeatureColumnOptions(cls, idx, select.value);
        this.#render();
      });
    });

    // A column's rule groups: name, levels and colour. Each re-renders,
    // because a rule decides which cells in the whole column are live.
    for (const [attr, field] of [['cfgname', 'name'], ['cfgrule', 'rule'], ['cfgcolor', 'color']]) {
      root.querySelectorAll(`[data-${attr}]`).forEach((input) => {
        input.addEventListener('change', () => {
          const parts = input.dataset[attr].split('|');
          const gi = Number(parts.pop());
          const idx = Number(parts.pop());
          this.#model.setClassFeatureRuleGroup(parts.join('|'), idx, gi, { [field]: input.value });
          this.#rerender(input);
        });
      });
    }

    root.querySelectorAll('[data-systab-name]').forEach((input) => {
      input.addEventListener('change', () => {
        this.#model.renameSystemTab(Number(input.dataset.systabName), input.value);
        this.#rerender(input);
      });
    });

    this.#bindFoldedCells(root);

    // `/` opens the search, the way it does everywhere else -- but only when
    // it is not a character being typed into a field. It rides on `.wrap`,
    // which every render replaces, so it cannot pile up.
    root.querySelector('.wrap')?.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingIn(e.composedPath?.()[0] ?? e.target)) return;
      e.preventDefault();
      this.#openPalette();
    });

    /*
     * A focused number input takes the wheel as an increment.
     *
     * That is the browser's own behaviour and it is fine on a short form. Here
     * the Magic Spheres tab carries 213 number fields and runs past three
     * screens, so "click a cell, keep scrolling" -- which is how you read a
     * tab -- silently edits the cell you just clicked, and the sheet has no
     * undo to notice it with.
     *
     * Blurring drops the increment without touching the scroll: the value
     * change is the *default action* of the wheel event, and an input with no
     * focus has none. Nothing is preventDefault-ed, so the page moves exactly
     * as far as it was going to, and a value genuinely typed is committed by
     * the blur rather than lost by it.
     *
     * On `.wrap`, like the handler above and for the same reason: every render
     * replaces it, so these cannot pile up.
     */
    root.querySelector('.wrap')?.addEventListener('wheel', (e) => {
      const el = e.composedPath?.()[0] ?? e.target;
      // `shadowRoot.activeElement` rather than `:focus`, which needs the window
      // itself to be focused and so would answer no to a question that is only
      // about which field the wheel is about to land on.
      if (el === root.activeElement && el?.matches?.('input[type="number"]')) el.blur();
    });

    root.querySelectorAll('[data-collapse]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.collapse;
        // Against what is on screen, not what is in storage. The two agree
        // everywhere except a block that starts folded by default and has
        // never been clicked -- where reading storage would toggle `undefined`
        // to `true` and fold something that already looked folded.
        this.#model.data.uiPrefs.collapsed[key] = b.getAttribute('aria-expanded') === 'true';
        this.#model.recompute();
        this.#render();
      });
    });

    /*
     * Opening a gear item out into its card. One at a time -- the card is
     * most of a screen and two of them open at once would put the second
     * one somewhere nobody is looking -- so clicking a second closes the
     * first, and the card's own caret carries an empty key to close it.
     */
    root.querySelectorAll('[data-gearopen]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.gearopen;
        this.#openGear = !key || this.#openGear === key ? null : key;
        this.#render();
        if (this.#openGear) {
          this.shadowRoot.querySelector('.gearcard input, .gearcard textarea')?.focus();
        }
      });
    });

    /*
     * Readying a maneuver adds or removes its name on the discipline. The row
     * itself belongs to the shared catalogue, so only the name is stored.
     *
     * The name is everything past the first "|", not the second field of a
     * split: it is whatever a player typed, and a homebrew maneuver with a
     * pipe in its name must tick the same row the card opens.
     */
    const maneuverRef = (key) => [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
    root.querySelectorAll('[data-ready]').forEach((box) => {
      box.addEventListener('change', () => {
        const [path, name] = maneuverRef(box.dataset.ready);
        this.#model.toggleManeuver(path, name, box.checked);
        this.#rerender(box);
      });
    });

    /*
     * Opening a maneuver. The name reads it, the ✎ writes it, and both are
     * their own buttons -- the row used to be one big <label>, so a click
     * anywhere on it readied the maneuver and the ✎ was the only thing you
     * could safely hit. Now the tick box is the only thing that ticks.
     *
     * One maneuver is open at a time, and which one is not saved with the
     * character: it is a way of reading the tab, not something about the
     * character.
     */
    const showManeuver = (key, edit) => {
      // Asking for the face that is already up shuts it; asking for the other
      // one turns the card over instead of closing it.
      const showing = this.#openManeuver === key && this.#maneuverEdit === edit;
      this.#openManeuver = showing ? null : key;
      this.#maneuverEdit = showing ? false : edit;
      this.#render();
    };
    root.querySelectorAll('[data-mopen]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        showManeuver(b.dataset.mopen, false);
      });
    });
    root.querySelectorAll('[data-medit]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        showManeuver(b.dataset.medit, true);
      });
    });
    // The pen on a veil card turns it over to what the player wrote. Pressing
    // it again turns it back, which is how you read the pack's text after
    // writing your own -- your text is still there, under the pen.
    root.querySelectorAll('[data-vedit]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.#veilEdit = this.#veilEdit === b.dataset.vedit ? null : b.dataset.vedit;
        this.#render();
      });
    });
    root.querySelectorAll('[data-mclose]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.#openManeuver = null;
        this.#maneuverEdit = false;
        this.#render();
      });
    });

    // One cell of a maneuver's entry. Which cell rides beside the key rather
    // than on the end of it, for the same reason the name is read whole.
    root.querySelectorAll('[data-mfield]').forEach((input) => {
      input.addEventListener('change', () => {
        const [path, name] = maneuverRef(input.dataset.mfield);
        this.#model.setManeuverField(path, name, input.dataset.mf, input.value);
        this.#render();
      });
    });

    // Right-click a maneuver for its rules text. Left-click opens what the
    // player wrote, so the wiki gets the button that was otherwise unused;
    // the native menu is given up only on these names.
    root.querySelectorAll('.mname[data-wiki]').forEach((name) => {
      name.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        window.open(name.dataset.wiki, '_blank', 'noopener,noreferrer');
      });
    });

    root.querySelectorAll('[data-action="add-discipline"]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const name = sel.value;
        if (!name) return;
        this.#model.listAdd('maneuvers.disciplines', { name, known: [], custom: [] });
        this.#render();
      });
    });

    root.querySelectorAll('[data-hp]').forEach((b) => {
      b.addEventListener('click', () => {
        const box = root.querySelector('[data-hp-amount]');
        const amount = Number(box?.value) || 0;
        const action = b.dataset.hp;
        if (action === 'damage') this.#model.damage(amount);
        else if (action === 'nonlethal') this.#model.damage(amount, { nonlethal: true });
        else if (action === 'heal') this.#model.heal(amount);
        else if (action === 'rest') this.#model.restoreAll();
        this.#render();
      });
    });

    root.querySelectorAll('[data-build]').forEach((input) => {
      input.addEventListener('change', () => {
        const [ability, key] = input.dataset.build.split('|');
        this.#model.setBuild(ability, key, readControl(input));
        this.#render();
      });
    });

    root.querySelectorAll('[data-offset]').forEach((input) => {
      input.addEventListener('change', () => {
        this.#model.setOffset(input.dataset.offset, Number(input.value) || 0);
        this.#rerender(input);
      });
    });

    root.querySelectorAll('[data-veilcols]').forEach((b) => {
      b.addEventListener('click', () => {
        this.#model.data.uiPrefs.veilColumns = Number(b.dataset.veilcols) || 0;
        this.#model.recompute();
        this.#render();
      });
    });

    root.querySelectorAll('[data-buildcol]').forEach((b) => {
      b.addEventListener('click', () => {
        const prefs = this.#model.data.uiPrefs;
        const cols = prefs.buildColumns || (prefs.buildColumns = {});
        cols[b.dataset.buildcol] = b.getAttribute('aria-pressed') !== 'true';
        this.#model.recompute();
        this.#render();
      });
    });

    root.querySelectorAll('[data-pick]').forEach((select) => {
      select.addEventListener('change', () => {
        const [kind, level, slot] = select.dataset.pick.split('|');
        if (kind === 'mythicStat') {
          this.#model.setMythicPick(Number(level), select.value || null);
        } else {
          const slotKey = kind === 'array' ? Number(slot) : slot;
          this.#model.setPick(kind, Number(level), slotKey, select.value || null);
        }
        this.#render();
      });
    });

    this.#bindFormulas(root);

    // Add-tracker form: draft fields, with the formula preview refreshed in
    // place so the field keeps focus and caret.
    root.querySelectorAll('[data-draft]').forEach((input) => {
      const key = input.dataset.draft;
      input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
        this.#draft[key] = input.value;
        if (key === 'formula' || key === 'minFormula') {
          this.#refreshPreview(root, 'add', this.#draft.formula, this.#draft.minFormula);
        }
        // The full-attack d20 is built for the picked weapon, so the pick
        // has to rebuild it.
        if (key === 'fullAttackWeapon') this.#render();
      });
    });

    // The word that arms Reset. Toggled in place -- a re-render per keystroke
    // would drop focus mid-word.
    root.querySelectorAll('[data-reset-word]').forEach((input) => {
      input.addEventListener('input', () => {
        const armed = input.value.trim().toUpperCase() === 'RESET';
        const btn = root.querySelector('[data-action="reset-confirm"]');
        if (btn) btn.disabled = !armed;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().toUpperCase() === 'RESET') {
          root.querySelector('[data-action="reset-confirm"]')?.click();
        }
      });
    });

    // In-place tracker editor: same idea, its own draft and preview.
    root.querySelectorAll('[data-tedit]').forEach((input) => {
      const key = input.dataset.tedit;
      input.addEventListener('input', () => {
        this.#editDraft[key] = input.value;
        if (key === 'maxFormula' || key === 'minFormula') {
          this.#refreshPreview(root, 'edit', this.#editDraft.maxFormula, this.#editDraft.minFormula);
        }
      });
      input.addEventListener('keydown', (e) => {
        // The note is prose over several lines, so Enter belongs to the text.
        if (e.key === 'Enter' && key !== 'note') {
          e.preventDefault();
          this.#action('save-tracker', root.querySelector('[data-action="save-tracker"]'));
        }
        if (e.key === 'Escape') { e.preventDefault(); this.#action('cancel-tracker'); }
      });
    });

    root.querySelectorAll('[data-tracker-current]').forEach((input) => {
      input.addEventListener('change', () => {
        const t = this.#model.trackers.find((x) => x.id === input.dataset.trackerCurrent);
        if (!t) return;
        const typed = Number(input.value) || 0;
        // A draining tracker's number is what is left; the model stores spent.
        const current = this.#isDraining(t) ? (Number(t.max) || 0) - typed : typed;
        this.#model.updateTracker(t.id, { current });
        this.#render();
      });
    });

    root.querySelectorAll('[data-tracker-step]').forEach((b) => {
      b.addEventListener('click', () => {
        const t0 = this.#model.trackers.find((x) => x.id === b.dataset.trackerStep);
        if (!t0) return;
        // "+" adds to what the row shows: spent for a filling pool, what is
        // left for a draining one. Clamped to [min, max] by the model.
        const delta = Number(b.dataset.delta) * (this.#isDraining(t0) ? -1 : 1);
        const t = this.#model.stepTracker(t0.id, delta);
        this.#emitTracker(t);
        this.#render();
      });
    });

    root.querySelectorAll('[data-pip]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = this.#model.trackers.find((x) => x.id === b.dataset.pip);
        if (!t) return;
        const n = Number(b.dataset.n);
        const max = Number(t.max) || 0;
        const cur = Number(t.current) || 0;
        let next;
        if (this.#isDraining(t)) {
          // Pips show what is left: clicking pip n leaves n; clicking the last
          // lit pip spends it.
          const remaining = max - cur;
          next = max - (remaining === n ? n - 1 : n);
        } else {
          // Clicking the outermost lit pip steps back one toward zero, so pips
          // toggle sensibly on either side of a meter; the zero mark resets.
          next = cur === n ? n - Math.sign(n) : n;
        }
        this.#model.updateTracker(t.id, { current: next });
        this.#emitTracker(t);
        this.#render();
      });
    });

    // Bar shape: click anywhere on the track to set the value there.
    root.querySelectorAll('[data-bar]').forEach((bar) => {
      bar.addEventListener('click', (e) => {
        const t = this.#model.trackers.find((x) => x.id === bar.dataset.bar);
        if (!t) return;
        const rect = bar.getBoundingClientRect();
        if (!rect.width) return;
        const { current } = barClickValue((e.clientX - rect.left) / rect.width, {
          min: Number(t.min) || 0, max: Number(t.max) || 0, style: t.style,
        });
        this.#model.updateTracker(t.id, { current });
        this.#emitTracker(t);
        this.#render();
      });
    });

    // The built-in meters share the tracker's style editor, so opening one
    // loads the same draft the tracker editor works on.
    root.querySelectorAll('[data-meter-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.meterEdit;
        if (this.#editMeter === key) { this.#editMeter = null; this.#render(); return; }
        this.#editMeter = key;
        this.#editTracker = null;
        this.#editDraft = {
          ...this.#editDraft, style: this.#model.meterStyle(key),
        };
        this.#render();
      });
    });

    root.querySelectorAll('[data-tracker-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = this.#model.trackers.find((x) => x.id === b.dataset.trackerEdit);
        if (!t) return;
        this.#editTracker = t.id;
        // One draft and one set of style controls, so only one of the two can
        // be open: a meter left open would keep the editor pointed at itself.
        this.#editMeter = null;
        this.#editDraft = {
          name: t.name || '',
          maxFormula: t.maxFormula || '',
          minFormula: t.minFormula || '',
          refresh: t.refresh || '',
          note: t.note || '',
          style: normalizeStyle(t.style),
        };
        this.#render();
        root.querySelector('[data-tedit="name"]')?.focus();
      });
    });

    this.#bindCharacterColor(root);

    this.#bindTrackerStyle(root);

    root.querySelectorAll('[data-tracker-remove]').forEach((b) => {
      b.addEventListener('click', () => {
        this.#model.removeTracker(b.dataset.trackerRemove);
        this.#render();
      });
    });
  }

  /**
   * The character-colour control.
   *
   * Every change is applied straight to the host's custom properties rather
   * than through a re-render, so the sheet recolours live while a hex is being
   * typed and the field keeps its caret.
   */
  #bindCharacterColor(scope) {
    const root = this.shadowRoot;
    const apply = (hex) => {
      this.#model.set('identity.color', hex);
      this.#applyCharacterColor();
      const box = root.querySelector('[data-charhex]');
      if (box) { box.value = hex || ''; box.classList.remove('bad'); }
      const pick = root.querySelector('[data-charpick]');
      if (pick && hex) pick.value = hex;
      root.querySelectorAll('[data-charswatch]').forEach((b) => {
        b.setAttribute('aria-pressed', (normalizeHex(b.dataset.hex) || null) === hex ? 'true' : 'false');
      });
    };

    scope.querySelectorAll('[data-charswatch]').forEach((b) => {
      b.addEventListener('click', () => apply(normalizeHex(b.dataset.hex)));
    });
    scope.querySelectorAll('[data-charhex]').forEach((input) => {
      input.addEventListener('input', () => {
        const raw = input.value.trim();
        const hex = normalizeHex(raw);
        input.classList.toggle('bad', !!raw && !hex);
        if (!raw || hex) apply(hex);
      });
    });
    scope.querySelectorAll('[data-charpick]').forEach((pick) => {
      pick.addEventListener('input', () => {
        const hex = normalizeHex(pick.value);
        if (hex) apply(hex);
      });
    });
  }

  /**
   * Controls of the tracker style editor. Bound on the whole shadow root after
   * a render, and again on just the style block when that block is redrawn in
   * place (adding a zone, picking a swatch) so the rest of the editor keeps
   * its focus and caret.
   */
  #bindTrackerStyle(scope) {
    const root = this.shadowRoot;
    const draft = () => this.#editDraft.style;
    const tracker = () => this.#styleTarget();
    const preview = () => this.#refreshStylePreview(root);
    const redraw = () => this.#refreshStyleEditor(root);

    scope.querySelectorAll('[data-tstyle]').forEach((select) => {
      select.addEventListener('change', () => {
        draft()[select.dataset.tstyle] = select.value;
        preview();
      });
    });

    scope.querySelectorAll('[data-swatch]').forEach((b) => {
      b.addEventListener('click', () => {
        const field = b.dataset.swatch;
        const hex = normalizeHex(b.dataset.hex);
        draft()[field] = hex;
        // Reflect into the paired hex field and picker, and move the pressed state.
        const hexin = root.querySelector(`[data-hexin="${field}"]`);
        if (hexin) { hexin.value = hex || ''; hexin.classList.remove('bad'); }
        const pick = root.querySelector(`[data-hexpick="${field}"]`);
        if (pick && hex) pick.value = hex;
        b.closest('.swatches')?.querySelectorAll('[data-swatch]').forEach((s) => {
          s.setAttribute('aria-pressed', s === b ? 'true' : 'false');
        });
        preview();
      });
    });

    scope.querySelectorAll('[data-hexin]').forEach((input) => {
      input.addEventListener('input', () => {
        const field = input.dataset.hexin;
        const raw = input.value.trim();
        const hex = normalizeHex(raw);
        input.classList.toggle('bad', !!raw && !hex);
        if (!raw || hex) {
          draft()[field] = hex;
          const pick = root.querySelector(`[data-hexpick="${field}"]`);
          if (pick && hex) pick.value = hex;
          root.querySelectorAll(`[data-swatch="${field}"]`).forEach((s) => {
            s.setAttribute('aria-pressed', normalizeHex(s.dataset.hex) === hex || (!hex && !s.dataset.hex) ? 'true' : 'false');
          });
          preview();
        }
      });
    });

    scope.querySelectorAll('[data-hexpick]').forEach((pick) => {
      pick.addEventListener('input', () => {
        const field = pick.dataset.hexpick;
        const hex = normalizeHex(pick.value);
        if (!hex) return;
        draft()[field] = hex;
        const hexin = root.querySelector(`[data-hexin="${field}"]`);
        if (hexin) { hexin.value = hex; hexin.classList.remove('bad'); }
        root.querySelectorAll(`[data-swatch="${field}"]`).forEach((s) => {
          s.setAttribute('aria-pressed', normalizeHex(s.dataset.hex) === hex ? 'true' : 'false');
        });
        preview();
      });
    });

    scope.querySelectorAll('[data-zone]').forEach((input) => {
      input.addEventListener('input', () => {
        const [i, key] = input.dataset.zone.split('|');
        const z = draft().zones[Number(i)];
        if (!z) return;
        if (key === 'color') {
          const hex = normalizeHex(input.value);
          input.classList.toggle('bad', !!input.value.trim() && !hex);
          if (!hex) return;
          z.color = hex;
          const pick = root.querySelector(`[data-zonepick="${i}"]`);
          if (pick) pick.value = hex;
        } else {
          z[key] = input.value;
        }
        preview();
      });
    });

    scope.querySelectorAll('[data-zonepick]').forEach((pick) => {
      pick.addEventListener('input', () => {
        const i = Number(pick.dataset.zonepick);
        const z = draft().zones[i];
        const hex = normalizeHex(pick.value);
        if (!z || !hex) return;
        z.color = hex;
        const hexin = root.querySelector(`[data-zone="${i}|color"]`);
        if (hexin) { hexin.value = hex; hexin.classList.remove('bad'); }
        preview();
      });
    });

    scope.querySelectorAll('[data-zone-remove]').forEach((b) => {
      b.addEventListener('click', () => {
        draft().zones.splice(Number(b.dataset.zoneRemove), 1);
        redraw();
      });
    });

    scope.querySelectorAll('[data-add-zone]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = tracker();
        const max = Number(t?.max) || 0;
        // A sensible starting range: the top of the pool, in the palette red.
        draft().zones.push({ from: String(Math.max(1, max - 1)), to: String(max), color: TRACKER_PALETTE[2][0], label: '' });
        redraw();
        root.querySelector(`[data-zone="${draft().zones.length - 1}|from"]`)?.focus();
      });
    });
  }

  /** Repaint the editor's live preview only. */
  #refreshStylePreview(root) {
    const t = this.#styleTarget();
    const box = root.querySelector('.style-preview');
    if (t && box) box.innerHTML = this.#stylePreviewHtml(t);
  }

  /** Redraw the whole style block in place (structure changed) and rebind it. */
  #refreshStyleEditor(root) {
    const t = this.#styleTarget();
    const block = root.querySelector('.tstyle');
    if (!t || !block) return;
    block.innerHTML = this.#trackerStyleEditor(t);
    this.#bindTrackerStyle(block);
  }

  /** Update a formula preview box in place, without re-rendering the panel. */
  /**
   * The Formulas tab's live parts.
   *
   * Everything here refreshes the section it belongs to rather than calling
   * #render(): a search box that loses the caret after every letter is not a
   * search box, and the try-it working has to keep up with typing.
   */
  #bindFormulas(root) {
    const draft = root.querySelector('[data-fx-draft]');
    const query = root.querySelector('[data-fx-query]');
    if (!draft && !query) return;

    const scope = () => this.#model.scope();
    const known = () => new Set(this.#model.scopeNames());

    // The working only exists once something has been typed, so going from
    // empty to typed (or back) is the one case that has to rebuild the tab.
    const refreshWorking = () => {
      const box = root.querySelector('.fx-working');
      if (!box || !this.#formulaDraft.trim()) {
        this.#render();
        const again = root.querySelector('[data-fx-draft]');
        again?.focus();
        again?.setSelectionRange(again.value.length, again.value.length);
        return;
      }
      box.innerHTML = workingHtml(this.#formulaDraft, scope(), known());
      this.#bindFormulaInserts(root);
    };

    const refreshSearch = () => {
      const q = this.#formulaQuery;
      const names = this.#model.scopeNames();
      const formulaSection = root.querySelector('[data-fx-section="formulas"]');
      const forwardedSection = root.querySelector('[data-fx-section="forwarded"]');
      const valueSection = root.querySelector('[data-fx-section="values"]');
      if (formulaSection) {
        formulaSection.outerHTML = myFormulasHtml(this.#model.audit(), q);
      }
      if (forwardedSection) {
        forwardedSection.outerHTML = forwardedHtml(this.#forwardedRows(), q);
      }
      if (valueSection) {
        valueSection.outerHTML = browserHtml(
          valueGroups(names, scope(), this.#model.inlineNames || {}, q), names.length, q,
        );
      }
      const targetSection = root.querySelector('[data-fx-section="targets"]');
      if (targetSection) {
        const targets = this.#model.forwardTargetList || [];
        targetSection.outerHTML = targetsHtml(targetGroups(targets, q), targets.length, q);
      }
      this.#bindFormulaInserts(root);
    };

    draft?.addEventListener('input', () => {
      const wasEmpty = !this.#formulaDraft.trim();
      this.#formulaDraft = draft.value;
      if (wasEmpty !== !this.#formulaDraft.trim()) {
        const caret = draft.selectionStart;
        this.#render();
        const again = root.querySelector('[data-fx-draft]');
        if (again) { again.focus(); again.setSelectionRange(caret, caret); }
        return;
      }
      refreshWorking();
    });
    // Tidy the spacing on demand, never while typing: pretty() rewrites the
    // text under the caret, which is intolerable mid-word but is exactly what
    // is wanted once the formula is finished.
    draft?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.#formulaDraft = pretty(draft.value);
      draft.value = this.#formulaDraft;
      refreshWorking();
    });

    query?.addEventListener('input', () => {
      this.#formulaQuery = query.value;
      refreshSearch();
    });

    root.querySelector('[data-fx-ref]')?.addEventListener('toggle', (e) => {
      this.#formulaRefOpen = e.target.open;
    });

    this.#bindFormulaInserts(root);
  }

  /**
   * Anything on the Formulas tab that puts text in the try-it box: a name from
   * the index, a name a formula reads, a worked example, a formula already on
   * the character. A name is inserted at the caret (you are building an
   * expression); a whole formula replaces what is there.
   */
  #bindFormulaInserts(root) {
    // A destination chip copies its whole token rather than typing into the
    // try-it box: a destination is written to, not read, so most of them
    // would not evaluate there at all.
    root.querySelectorAll('[data-fx-copy]').forEach((el) => {
      if (el.dataset.fxBound) return;
      el.dataset.fxBound = '1';
      el.addEventListener('click', async () => {
        const text = el.dataset.fxCopy;
        const mark = (label) => {
          el.classList.add('copied');
          el.setAttribute('data-copied', label);
          setTimeout(() => {
            if (!el.isConnected) return;
            el.classList.remove('copied');
            el.removeAttribute('data-copied');
          }, 1400);
        };
        try {
          await navigator.clipboard.writeText(text);
          mark('copied');
          return;
        } catch { /* no permission, or no clipboard at all -- fall through */ }
        // No clipboard. Select the name where it is on screen instead, so the
        // reader can take it with Ctrl+C -- "press Ctrl+C" has to be true when
        // it is said, and it is only true once something is selected.
        const name = el.querySelector('.n') || el;
        const sel = this.shadowRoot.getSelection?.() ?? document.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(name);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        mark(sel ? 'press Ctrl+C' : 'copy it by hand');
      });
    });
    root.querySelectorAll('[data-fx-insert]').forEach((el) => {
      if (el.dataset.fxBound) return;
      el.dataset.fxBound = '1';
      el.addEventListener('click', () => {
        const box = root.querySelector('[data-fx-draft]');
        if (!box) return;
        const text = el.dataset.fxInsert;
        if (el.dataset.fxReplace) {
          this.#formulaDraft = text;
        } else {
          const at = box.selectionStart ?? box.value.length;
          const before = box.value.slice(0, at);
          const after = box.value.slice(box.selectionEnd ?? at);
          // A name landing straight after a name or a number is not what was
          // meant, so give it room; anything else is inserted as typed.
          const gap = /[A-Za-z0-9_.]$/.test(before) ? ' ' : '';
          this.#formulaDraft = `${before}${gap}${text}${after}`;
        }
        const wasEmpty = !box.value.trim();
        box.value = this.#formulaDraft;
        if (wasEmpty) {
          this.#render();
          root.querySelector('[data-fx-draft]')?.focus();
          return;
        }
        const working = root.querySelector('.fx-working');
        if (working) {
          working.innerHTML = workingHtml(this.#formulaDraft, this.#model.scope(),
            new Set(this.#model.scopeNames()));
          this.#bindFormulaInserts(root);
        }
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
    });
  }

  #refreshPreview(root, kind, maxSrc, minSrc) {
    const box = root.querySelector(`.preview.${kind}`);
    if (!box) return;
    const info = this.#trackerPreview(maxSrc, minSrc);
    box.className = `preview ${kind} ${info.ok ? 'ok' : 'err'}`;
    box.textContent = info.text;
    box.style.display = info.text ? '' : 'none';
  }

  #emitTracker(tracker) {
    this.dispatchEvent(new CustomEvent('tracker-change', {
      detail: { tracker }, bubbles: true, composed: true,
    }));
  }

  /**
   * Dragging on the Template tab.
   *
   * Two kinds of card move. A group is reordered among the groups; a
   * sub-ability is reordered within its own or dragged into another one. What a
   * sub-ability cannot do is land at the top level: it hangs off the feature
   * above it, so a group card accepts one only as a child of itself, and there
   * is no drop that would put it above that feature.
   *
   * `draggable` is switched on by the grip and off again when the drag ends, so
   * the fields inside a card stay selectable with the mouse.
   */
  /**
   * Dragging a language past its neighbours.
   *
   * The chips are a row rather than a column, so the half a chip the pointer is
   * on decides which side of it the drop lands, and the marker is drawn on that
   * edge. As on the Template tab the grip is the only part that starts a drag:
   * the chip is mostly a text field, and a field that cannot be selected with
   * the mouse is worse than a list that cannot be reordered.
   */
  #bindLanguageDrag(root) {
    const list = root.querySelector('[data-langlist]');
    if (!list) return;
    const chips = [...list.querySelectorAll('[data-langdrop]')];
    if (chips.length < 2) return;
    let from = null;
    const clear = () => chips.forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const after = (e, el) => {
      const r = el.getBoundingClientRect();
      return e.clientX > r.left + r.width / 2;
    };

    chips.forEach((chip) => {
      const grip = chip.querySelector('[data-langgrip]');
      if (grip) {
        grip.addEventListener('pointerdown', () => { chip.draggable = true; });
        grip.addEventListener('pointerup', () => { chip.draggable = false; });
      }
      chip.addEventListener('dragstart', (e) => {
        from = Number(chip.dataset.langdrop);
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag with nothing on the transfer.
        e.dataTransfer.setData('text/plain', chip.dataset.langdrop);
      });
      chip.addEventListener('dragend', () => {
        chip.draggable = false;
        chip.classList.remove('dragging');
        from = null;
        clear();
      });
      chip.addEventListener('dragover', (e) => {
        if (from === null || Number(chip.dataset.langdrop) === from) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clear();
        chip.classList.add(after(e, chip) ? 'drop-after' : 'drop-before');
      });
      chip.addEventListener('drop', (e) => {
        const at = Number(chip.dataset.langdrop);
        if (from === null || at === from) return;
        e.preventDefault();
        const to = at + (after(e, chip) ? 1 : 0);
        clear();
        this.#model.listMoveTo('identity.languages', from, to);
        from = null;
        this.#render();
      });
    });
  }

  /**
   * Dragging a feat: up and down its own group, or across into another.
   *
   * The row carries the fields, so only the grip starts a drag -- otherwise a
   * player could not select the text in a feat's name. Everything about where
   * a drop would land is worked out from the row under the pointer: which
   * group it belongs to, and which half of it the pointer is in. An empty
   * group keeps one placeholder row for exactly this reason, so it is
   * something a feat can be dropped onto rather than a gap that refuses.
   */
  #bindFeatDrag(root) {
    const rows = [...root.querySelectorAll('[data-featdrop]')];
    if (!rows.length) return;
    const parse = (el) => (el?.dataset.featdrop || '').split('|').map(Number);
    const entries = (g) => `featGroups.${g}.entries`;
    const clear = () => rows.forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    let from = null;                       // [group, index] being dragged
    const after = (e, el) => {
      const box = el.getBoundingClientRect();
      return e.clientY > box.top + box.height / 2;
    };
    // Where a drop at this point lands: the row under the pointer decides the
    // group, and which half of it decides the side. An empty group's
    // placeholder is always position 0, whichever half it was hit on.
    const targetOf = (e) => {
      const row = e.target.closest?.('[data-featdrop]');
      if (!from || !row) return null;
      const [g, i] = parse(row);
      if (row.classList.contains('featempty')) return { row, g, to: 0, side: 'drop-before' };
      const past = after(e, row);
      return { row, g, to: i + (past ? 1 : 0), side: past ? 'drop-after' : 'drop-before' };
    };

    root.querySelectorAll('[data-featgrip]').forEach((grip) => {
      const row = grip.closest('[data-featdrop]');
      if (!row) return;
      grip.addEventListener('pointerdown', () => { row.draggable = true; });
      grip.addEventListener('pointerup', () => { row.draggable = false; });
    });

    rows.forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        from = parse(row);
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag with nothing on the transfer.
        e.dataTransfer.setData('text/plain', row.dataset.featdrop);
      });
      row.addEventListener('dragend', () => {
        row.draggable = false;
        row.classList.remove('dragging');
        from = null;
        clear();
      });
      row.addEventListener('dragover', (e) => {
        const t = targetOf(e);
        if (!t || t.row.classList.contains('dragging')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clear();
        t.row.classList.add(t.side);
      });
      row.addEventListener('drop', (e) => {
        const t = targetOf(e);
        if (!t) return;
        e.preventDefault();
        const [g, i] = from;
        clear();
        from = null;
        this.#model.listMoveInto(entries(g), i, entries(t.g), t.to);
        this.#render();
      });
    });
  }

  #bindTemplateDrag(root) {
    const parse = (el) => (el?.dataset.tdrop || '').split('|').map(Number);
    const clear = () => root.querySelectorAll('.drop-before, .drop-after, .drop-into')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
    let from = null;                       // [template, group, child] being dragged

    root.querySelectorAll('[data-tgrip]').forEach((grip) => {
      const card = grip.closest('[data-tdrop]');
      if (!card) return;
      grip.addEventListener('pointerdown', () => { card.draggable = true; });
      grip.addEventListener('pointerup', () => { card.draggable = false; });
    });

    root.querySelectorAll('[data-tdrop]').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        from = parse(card);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag with nothing on the transfer.
        e.dataTransfer.setData('text/plain', card.dataset.tdrop);
        card.classList.add('dragging');
        e.stopPropagation();               // a child drag is not its group's
      });
      card.addEventListener('dragend', () => {
        card.draggable = false;
        card.classList.remove('dragging');
        from = null;
        clear();
      });
    });

    /** Where a drop at this point would land, or null if it cannot land. */
    const targetOf = (e) => {
      if (!from) return null;
      const draggingGroup = from[2] < 0;
      let card = e.target.closest?.('[data-tdrop]');
      // A group only ever goes among groups, so a pointer inside another
      // group's sub-abilities means that group.
      while (card && draggingGroup && parse(card)[2] >= 0) {
        card = card.parentElement?.closest('[data-tdrop]');
      }
      if (!card || card.classList.contains('dragging')) return null;
      const [ti, gi, ci] = parse(card);
      if (ti !== from[0]) return null;     // one template at a time
      const box = card.getBoundingClientRect();
      const after = e.clientY > box.top + box.height / 2;
      if (draggingGroup) return { kind: 'group', to: gi + (after ? 1 : 0), card, after };
      if (ci >= 0) return { kind: 'child', gi, to: ci + (after ? 1 : 0), card, after };
      // Dropped on the group itself: last in its list, never above its head.
      const kids = this.#model.data.templates?.[ti]?.features?.[gi]?.children || [];
      return { kind: 'child', gi, to: kids.length, card, into: true };
    };

    root.querySelectorAll('[data-tmpl]').forEach((box) => {
      box.addEventListener('dragover', (e) => {
        const t = targetOf(e);
        if (!t) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clear();
        t.card.classList.add(t.into ? 'drop-into' : (t.after ? 'drop-after' : 'drop-before'));
      });
      box.addEventListener('dragleave', (e) => { if (e.target === box) clear(); });
      box.addEventListener('drop', (e) => {
        const t = targetOf(e);
        clear();
        if (!t) return;
        e.preventDefault();
        const [ti, gi, ci] = from;
        if (t.kind === 'group') this.#model.moveTemplateGroup(ti, gi, t.to);
        else this.#model.moveTemplateChild(ti, gi, ci, t.gi, t.to);
        from = null;
        this.#render();
      });
    });
  }

  #action(name, button) {
    switch (name) {
      case 'add-training-class': {
        const side = button?.dataset.side === 'magic' ? 'magic' : 'combat';
        this.#model.listAdd(`training.${side}.classes`, {
          name: '',
          type: null,
          talentsPerLevel: null,
          mod1: null,
          mod2: null,
          levels: Array.from({ length: 20 }, (_, i) => ({
            level: i + 1, talent: null, sphere: null, notes: null,
          })),
        });
        this.#render();
        break;
      }
      case 'add-guile-class':
        this.#model.addGuileClass();
        this.#render();
        break;
      case 'add-guile-sphere':
        this.#model.addGuileSphere();
        this.#render();
        break;
      case 'add-customization': {
        // Named after whichever class on the sheet has none yet, since that is
        // nearly always the one meant; blank when they all have.
        const taken = new Set((this.#model.data.training?.combat?.customizations || [])
          .map((b) => String(b.className || '')));
        const first = this.#classNames().find((n) => !taken.has(n)) || '';
        this.#model.addCustomization(first, { sets: { start: 1 }, talents: { start: 1 } });
        this.#render();
        break;
      }
      case 'theme':
        this.setAttribute('theme', this.getAttribute('theme') === 'light' ? 'dark' : 'light');
        break;
      case 'palette':
        this.#togglePalette();
        break;
      case 'palette-tabs':
        this.#tab = 'systabs';
        this.#render();
        break;
      case 'formulas':
        this.#tab = 'formulas';
        this.#render();
        this.shadowRoot.querySelector('[data-fx-draft]')?.focus();
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(this.#model.toJSON(), null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${this.#model.data.id}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        break;
      }
      case 'preview-published':
        this.#previewPublished();
        break;
      case 'chrome-menu':
        this.#chromeMenu = !this.#chromeMenu;
        this.#renderHeader();
        // Focus lands on the first item so the menu can be walked from the
        // keyboard; the toggle it came from is gone, replaced by the redraw.
        if (this.#chromeMenu) this.shadowRoot.querySelector('.chromemenu button')?.focus();
        else this.shadowRoot.querySelector('[data-action="chrome-menu"]')?.focus();
        break;
      case 'import':
        this.shadowRoot.querySelector('[data-importfile]')?.click();
        break;
      case 'dismiss-import-error':
        this.#importError = null;
        this.#render();
        break;

      /* ---- saving, and going back ---- */
      case 'save':
        this.#save();
        break;
      case 'history':
        this.#showHistory = !this.#showHistory;
        this.#renameDraft = null;
        if (this.#showHistory) {
          this.#refreshSnapshots().then(() => this.#renderHeader());
        }
        this.#renderHeader();
        break;
      case 'save-checkpoint':
        this.#saveCheckpoint();
        break;
      case 'restore':
        if (button?.dataset.key) this.#restoreSnapshot(button.dataset.key);
        break;
      case 'forget-snapshot':
        if (button?.dataset.key) {
          this.#history?.remove(button.dataset.key)
            .then(() => this.#refreshSnapshots())
            .then(() => this.#renderHeader())
            .catch(() => { /* already gone */ });
        }
        break;
      case 'rename-start':
        this.#renameDraft = { key: button.dataset.key, label: button.dataset.label || '' };
        this.#renderHeader();
        break;
      case 'rename-cancel':
        this.#renameDraft = null;
        this.#renderHeader();
        break;
      case 'rename-commit': {
        const draft = this.#renameDraft;
        this.#renameDraft = null;
        if (draft?.label.trim()) {
          this.#history?.rename(draft.key, draft.label.trim())
            .then(() => this.#refreshSnapshots())
            .then(() => this.#renderHeader())
            .catch(() => { /* gone while being renamed */ });
        } else {
          this.#renderHeader();
        }
        break;
      }
      case 'resume':
        // The unsaved work was filed as a snapshot on load, so picking it up is
        // an ordinary restore -- and one that is itself undoable.
        if (this.#resume?.key) this.#restoreSnapshot(this.#resume.key);
        else if (this.#resume?.doc) {
          this.#adoptDocument(this.#resume.doc);
          if (this.#history) this.#writeWorking();
          this.#resume = null;
          this.#render();
        }
        break;
      case 'discard-resume': {
        const key = this.#resume?.key;
        this.#resume = null;
        if (key) {
          this.#history?.remove(key)
            .then(() => this.#refreshSnapshots())
            .then(() => this.#renderHeader())
            .catch(() => { /* already gone */ });
        }
        this.#renderHeader();
        break;
      }
      case 'dismiss-history-note':
        this.#historyNote = null;
        this.#renderHeader();
        break;
      case 'add-tracker': {
        const { name: n, formula, minFormula, refresh, note } = this.#draft;
        if (!n.trim()) return;
        // The preview already shows why a formula does not parse.
        if (formula.trim() && !analyse(formula).ok) return;
        if ((minFormula || '').trim() && !analyse(minFormula).ok) return;
        this.#model.addTracker({
          name: n.trim(),
          maxFormula: formula.trim() || null,
          minFormula: (minFormula || '').trim() || null,
          refresh,
          note: note || '',
        });
        this.#draft = { name: '', formula: '', minFormula: '', refresh: '', note: '' };
        this.#render();
        break;
      }
      case 'save-tracker': {
        const id = button?.dataset.id || this.#editTracker;
        const t = this.#model.trackers.find((x) => x.id === id);
        const d = this.#editDraft;
        if (!t) return;
        // Zones with an unparsable bound are dropped rather than saved broken;
        // an all-default style is stored as null.
        const style = normalizeStyle(d.style);
        style.zones = style.zones.filter((z) => (!z.from || analyse(z.from).ok) && (!z.to || analyse(z.to).ok));
        if (!d.name.trim()) return;
        if (d.maxFormula.trim() && !analyse(d.maxFormula).ok) return;
        if (d.minFormula.trim() && !analyse(d.minFormula).ok) return;
        this.#model.updateTracker(id, {
          name: d.name.trim(),
          maxFormula: d.maxFormula.trim() || null,
          minFormula: d.minFormula.trim() || null,
          refresh: d.refresh.trim(),
          note: d.note,
          style: isDefaultStyle(style) ? null : style,
        });
        this.#editTracker = null;
        this.#render();
        break;
      }
      case 'cancel-tracker':
        this.#editTracker = null;
        this.#render();
        break;
      case 'save-meter':
        this.#model.setMeterStyle(button?.dataset.key, this.#editDraft.style);
        this.#editMeter = null;
        this.#render();
        break;
      case 'cancel-meter':
        this.#editMeter = null;
        this.#render();
        break;
      case 'reset-meter':
        // Back to the default, and left open so the change is visible.
        this.#model.setMeterStyle(button?.dataset.key, null);
        this.#editDraft.style = this.#model.meterStyle(button?.dataset.key);
        this.#render();
        break;
      case 'toggle-skills':
        this.#showAllSkills = !this.#showAllSkills;
        this.#render();
        break;
      case 'toggle-weapon': {
        const i = Number(button?.dataset.index);
        const w = this.#model.data.equipment?.weapons?.[i];
        if (w) this.#model.setItem('equipment.weapons', i, 'collapsed', !w.collapsed);
        this.#render();
        break;
      }
      case 'toggle-skill-hidden': {
        const i = Number(button?.dataset.index);
        const s = this.#model.data.skills?.[i];
        if (s) this.#model.setItem('skills', i, 'hidden', !s.hidden);
        this.#render();
        break;
      }
      case 'vancian-new-day':
        this.#model.vancianNewDay();
        this.#render();
        break;
      case 'psionics-new-day':
        this.#model.psionicsNewDay();
        this.#render();
        break;
      case 'companion-hp': {
        // Damage, heal or rest one companion; the amount box sits beside the buttons.
        const kind = button?.dataset.kind;
        const op = button?.dataset.op;
        const box = this.shadowRoot.querySelector(`[data-companion-amount="${CSS.escape(kind || '')}"]`);
        const amount = Number(box?.value) || 0;
        if (op === 'damage') this.#model.companionDamage(kind, amount);
        else if (op === 'heal') this.#model.companionHeal(kind, amount);
        else if (op === 'rest') this.#model.companionRest(kind);
        this.#render();
        break;
      }
      case 'attune-sphere': {
        // Land-attuned magic: a sphere is attuned or not, kept as a list of names.
        const sphere = button?.dataset.sphere;
        if (!sphere) break;
        const list = new Set(this.#model.data.cardcasting?.attunedSpheres || []);
        if (list.has(sphere)) list.delete(sphere);
        else list.add(sphere);
        this.#model.set('cardcasting.attunedSpheres', [...list]);
        this.#render();
        break;
      }
      case 'tab-hide': {
        const key = button?.dataset.key;
        if (key) {
          this.#model.hideTab(key);
          if (this.#tab !== 'systabs') this.#tab = 'systabs';
          this.#render();
        }
        break;
      }
      case 'tab-show': {
        const key = button?.dataset.key;
        if (key) {
          this.#model.showTab(key);
          this.#render();
        }
        break;
      }
      case 'tab-move': {
        const key = button?.dataset.key;
        const dir = Number(button?.dataset.dir);
        const order = this.#model.tabOrder();
        const from = order.indexOf(key);
        if (from >= 0 && dir) {
          // Up: before the previous tab. Down: after the next one.
          this.#model.moveTab(key, dir < 0 ? from - 1 : from + 2);
          this.#render();
        }
        break;
      }
      case 'tab-reset':
        this.#model.resetTabOrder();
        this.#render();
        break;
      case 'view-mode':
        this.#model.setViewMode(this.#model.viewMode() === 'session' ? 'build' : 'session');
        this.#render();
        break;
      case 'class-systems': {
        const index = Number(button?.dataset.index);
        this.#openClassSystems = this.#openClassSystems === index ? null : index;
        this.#render();
        break;
      }
      case 'class-system-toggle':
        this.#model.toggleClassSystem(Number(button?.dataset.index), button?.dataset.system);
        this.#render();
        break;
      // The dashboard's condition chips: the picker puts a condition on
      // ticked (Energy Drain climbs a level per click), × takes it off (it
      // stays in the build view's grid, unticked).
      case 'dash-cond-picker':
        this.#condPickerOpen = !this.#condPickerOpen;
        this.#render();
        break;
      // Arranging the dashboard: the first edit pins the automatic set into
      // uiPrefs.dashCards; Reset hands the composition back to automatic.
      case 'dash-arrange':
        this.#dashArrange = !this.#dashArrange;
        this.#render();
        break;
      case 'dash-card-hide': {
        const order = this.#dashCardIds().filter((id) => id !== button?.dataset.id);
        this.#model.set('uiPrefs.dashCards', order);
        this.#render();
        break;
      }
      case 'dash-card-show': {
        const order = [...this.#dashCardIds(), button?.dataset.id].filter(Boolean);
        this.#model.set('uiPrefs.dashCards', order);
        this.#render();
        break;
      }
      case 'dash-card-move': {
        const order = this.#dashCardIds();
        const from = order.indexOf(button?.dataset.id);
        const to = from + Number(button?.dataset.dir);
        if (from >= 0 && to >= 0 && to < order.length) {
          [order[from], order[to]] = [order[to], order[from]];
          this.#model.set('uiPrefs.dashCards', order);
        }
        this.#render();
        break;
      }
      case 'dash-cards-reset':
        this.#model.set('uiPrefs.dashCards', null);
        this.#render();
        break;
      case 'buff-add':
        this.#openBuff = (this.#model.data.buffs || []).length;
        this.#model.listAdd('buffs', {
          name: '', on: true, attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, initiative: 0, note: '', bonuses: [],
        });
        this.#render();
        break;
      case 'buff-bonus-add': {
        const b = (this.#model.data.buffs || [])[Number(button?.dataset.index)];
        if (b) {
          if (!Array.isArray(b.bonuses)) b.bonuses = [];
          b.bonuses.push({ target: 'melee', value: 0 });
          this.#model.recompute();
        }
        this.#render();
        break;
      }
      case 'buff-bonus-remove': {
        const b = (this.#model.data.buffs || [])[Number(button?.dataset.index)];
        if (b && Array.isArray(b.bonuses)) {
          b.bonuses.splice(Number(button?.dataset.j), 1);
          this.#model.recompute();
        }
        this.#render();
        break;
      }
      case 'buff-open': {
        const index = Number(button?.dataset.index);
        this.#openBuff = this.#openBuff === index ? null : index;
        this.#render();
        break;
      }
      case 'dash-cond-on': {
        const name = button?.dataset.name;
        if (name) {
          const conds = this.#model.data.conditions || (this.#model.data.conditions = {});
          // The sheet may already list this condition under an alias of its
          // own ("Fatigue" for Fatigued) -- tick that entry, not a twin.
          const info = conditionInfo(name);
          const key = (info && Object.keys(conds).find((n) => conditionInfo(n)?.key === info.key)) || name;
          conds[key] = info?.kind === 'count' ? (Number(conds[key]) || 0) + 1 : true;
          this.#model.recompute();
        }
        this.#render();
        break;
      }
      case 'dash-cond-off': {
        const name = button?.dataset.name;
        if (name) {
          const conds = this.#model.data.conditions || {};
          conds[name] = conditionInfo(name)?.kind === 'count' ? 0 : false;
          this.#model.recompute();
        }
        this.#render();
        break;
      }
      case 'quick-damage': {
        const n = Number(this.#draft.quickHp) || 0;
        if (n > 0) {
          const r = this.#model.applyDamage(n);
          this.#historyNote = `Took ${r.taken} damage${r.fromTemp ? ` (${r.fromTemp} to temporary hit points)` : ''}.`;
        }
        this.#draft.quickHp = '';
        this.#render();
        break;
      }
      case 'quick-heal': {
        const n = Number(this.#draft.quickHp) || 0;
        if (n > 0) {
          const r = this.#model.applyHealing(n);
          this.#historyNote = r.healed ? `Healed ${r.healed}.` : 'Already at full hit points.';
        }
        this.#draft.quickHp = '';
        this.#render();
        break;
      }
      case 'quick-rest': {
        const count = this.#model.restRefresh();
        this.#historyNote = count
          ? `Rested — ${count} tracker${count === 1 ? '' : 's'} refreshed.`
          : 'Rested — nothing with a daily refresh was spent.';
        this.#render();
        break;
      }
      case 'goto-trackers':
        if (this.#barEntries().some((x) => x.id === 'trackers')) this.#tab = 'trackers';
        else this.#historyNote = 'The Trackers tab is hidden in this view — show it from the ⚙ manager.';
        this.#render();
        break;
      case 'tech-select':
        break;                                   // handled on change, not click
      case 'tech-add': {
        const t = this.#model.addDraftTechnique('');
        if (t) {
          this.#tab = 'techniques';
          this.#historyNote = `Added ${techniqueTitle(t)} to the Technique List.`;
        }
        this.#render();
        break;
      }
      case 'tech-import':
        this.shadowRoot.querySelector('[data-techfile]')?.click();
        break;
      case 'tech-new':
        this.#model.resetDraftTechnique();
        this.#render();
        break;
      case 'tech-to-draft': {
        const name = button?.dataset.name;
        if (name) {
          this.#model.draftFromTechnique(name);
          this.#tab = 'autoTechnique';
          this.#render();
        }
        break;
      }
      case 'tech-remove': {
        const name = button?.dataset.name;
        if (name) { this.#model.removeTechnique(name); this.#render(); }
        break;
      }
      case 'wealth-record': {
        const amount = Number(this.#draft.wealthAmount);
        if (!Number.isFinite(amount) || amount === 0) {
          this.#historyNote = 'Give the ledger line an amount.';
          this.#render();
          break;
        }
        this.#model.addWealthEntry({ amount, label: this.#draft.wealthLabel, kind: this.#draft.wealthKind || 'session' });
        this.#draft.wealthAmount = '';
        this.#draft.wealthLabel = '';
        this.#render();
        break;
      }
      case 'wealth-remove':
        this.#model.removeWealthEntry(Number(button?.dataset.index));
        this.#render();
        break;
      case 'wealth-offering': {
        const paid = this.#model.makeOffering();
        if (paid) this.#historyNote = `Offering made: ${Math.abs(paid.amount).toLocaleString('en-US')} paid; the count starts over from today.`;
        this.#render();
        break;
      }
      case 'cook-clear':
        this.#model.set('cooking', { ...emptyDish(), level: this.#model.data.cooking?.level ?? null, chef: this.#model.data.cooking?.chef ?? '' });
        this.#render();
        break;
      case 'copy-text': {
        // Copy a text box's contents: the Discord application or dish post.
        const box = this.shadowRoot.getElementById(button?.dataset.copy || '');
        if (!box) break;
        const done = () => {
          const was = button.textContent;
          button.textContent = 'Copied ✓';
          setTimeout(() => { button.textContent = was; }, 1400);
        };
        const fallback = () => {
          box.focus();
          box.select();
          try { document.execCommand('copy'); done(); } catch { /* the text is selected, at least */ }
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(box.value).then(done, fallback);
        else fallback();
        break;
      }
      case 'add-system': {
        const name = (this.#draft.newSystem || '').trim() || 'New system';
        const tab = this.#model.addSystemTab(name);
        this.#draft.newSystem = '';
        const idx = this.#model.data.sheetTabs.indexOf(tab);
        this.#tab = `sys-${idx}`;
        this.#render();
        break;
      }
      case 'delete-system':
        this.#confirmDelete = Number(button?.dataset.index);
        this.#render();
        break;
      case 'delete-system-confirm': {
        const idx = this.#confirmDelete;
        this.#confirmDelete = null;
        if (idx !== null) this.#model.removeSystemTab(idx);
        this.#tab = 'systabs';
        this.#render();
        break;
      }
      case 'delete-system-cancel':
        this.#confirmDelete = null;
        this.#render();
        break;
      case 'ext-add-block': {
        // Copy a block out of an enabled extension pack into this character.
        const block = extensionRuntime.blocks()
          .find((b) => b.extId === button?.dataset.ext && b.index === Number(button?.dataset.index));
        if (!block) break;
        try {
          this.#historyNote = applyBlock(this.#model, block);
        } catch (err) {
          this.#historyNote = `Could not add ${block.name || 'that block'} — ${err.message}`;
        }
        this.#render();
        break;
      }
      case 'ext-filter':
        this.#extFilter = button?.dataset.kind || '';
        this.#render();
        break;
      case 'arch-remove': {
        // Take an archetype off its class; its record restores what it replaced.
        this.#historyNote = removeArchetype(this.#model, button?.dataset.class, button?.dataset.name);
        this.#render();
        break;
      }
      case 'prof-toggle':
        this.#model.toggleProficiency(button?.dataset.list, button?.dataset.value);
        this.#render();
        break;
      case 'add-system-column': {
        const tab = this.#model.data.sheetTabs?.[Number(button?.dataset.index)];
        if (tab) {
          for (const row of tab.rows) row.cells.push(null);
          if (!tab.rows.length) tab.rows.push({ cells: [null] });
          this.#model.recompute();
          this.#render();
        }
        break;
      }
      case 'add-template-column':
        this.#model.addTemplateTableColumn(button?.dataset.path);
        this.#render();
        break;
      case 'remove-template-column':
        this.#model.removeTemplateTableColumn(button?.dataset.path, Number(button?.dataset.col));
        this.#render();
        break;
      case 'add-track':
        this.#model.addProgressionTrack();
        this.#render();
        break;
      case 'remove-track':
        this.#model.removeProgressionTrack(Number(button?.dataset.track));
        this.#render();
        break;
      case 'add-cfnote':
        this.#model.addClassFeatureNote(button?.dataset.class, { name: 'New feature' });
        this.#render();
        return;
      case 'remove-cfnote':
        this.#model.removeClassFeatureNote(button?.dataset.class, Number(button?.dataset.index));
        this.#render();
        return;
      case 'add-cf-column': {
        const cls = button?.dataset.class;
        const cols = this.#model.data.progression.classFeatures?.[cls]?.columns || [];
        let n = 1;
        while (cols.includes(`Column ${n}`)) n += 1;
        this.#model.addClassFeatureColumn(cls, cols.length ? `Column ${n}` : 'Features');
        this.#render();
        break;
      }
      case 'remove-cf-column':
        this.#model.removeClassFeatureColumn(button?.dataset.class, Number(button?.dataset.col));
        this.#render();
        break;
      // Deleting a whole feature group takes a second click even now that
      // Ctrl+Z can put it back: it is a column of the player's own writing per
      // level, and twenty levels of it is more than a toast should be the only
      // thing standing between you and losing.
      case 'remove-cf-group':
        this.#confirmGroup = button?.dataset.class ?? null;
        this.#render();
        break;
      case 'remove-cf-group-confirm':
        this.#model.removeClassFeatureGroup(button?.dataset.class);
        this.#confirmGroup = null;
        this.#render();
        break;
      case 'remove-cf-group-cancel':
        this.#confirmGroup = null;
        this.#render();
        break;
      case 'add-rule-group':
        this.#model.addClassFeatureRuleGroup(button?.dataset.class, Number(button?.dataset.col));
        this.#render();
        break;
      case 'remove-rule-group':
        this.#model.removeClassFeatureRuleGroup(button?.dataset.class,
          Number(button?.dataset.col), Number(button?.dataset.group));
        this.#render();
        break;
      case 'add-condition': {
        const name = String(this.#draft.condition || '').trim();
        if (name) {
          const conds = this.#model.data.conditions || (this.#model.data.conditions = {});
          if (!(name in conds)) conds[name] = 0;
          this.#model.recompute();
        }
        this.#draft.condition = '';
        this.#render();
        break;
      }
      case 'add-trait-category': {
        const cat = (this.#draft.traitCategory || '').trim();
        if (cat && !this.#model.data.traitCategories.includes(cat)) {
          this.#model.data.traitCategories.push(cat);
          this.#model.recompute();
        }
        this.#draft.traitCategory = '';
        this.#render();
        break;
      }
      case 'toggle-gear':
        this.#showAllGear = !this.#showAllGear;
        this.#render();
        break;
      // Widen or narrow a gear table. Dropping a column that has something
      // written in it still asks twice, because it takes that writing off
      // every row at once -- a scale where being asked is worth more than
      // being able to take it back afterwards.
      case 'gear-col': {
        const list = button?.dataset.list;
        const kind = button?.dataset.kind;
        const delta = Number(button?.dataset.delta) || 0;
        const armKey = `${list}|${kind}`;
        if (delta < 0 && gearColumnInUse(this.#model.list(list), kind)
          && this.#armedGearCol !== armKey) {
          this.#armedGearCol = armKey;
          this.#render();
          break;
        }
        this.#armedGearCol = null;
        this.#model.setGearColumns(list, kind, delta);
        this.#render();
        break;
      }
      case 'take-technique':
        // Same write the dropdown makes; the chooser is just a wider way to
        // read the five before making it.
        this.#model.set('identity.primordiaTechnique', button?.dataset.name || '');
        this.#render();
        break;
      case 'reset':
        this.#confirmReset = true;
        this.#render();
        this.shadowRoot.querySelector('[data-reset-word]')?.focus();
        break;
      case 'reset-cancel':
        this.#confirmReset = false;
        this.#render();
        // Back where it came from. Opening the confirm moves focus into it, so
        // closing it owes the reader the other half: without this the render
        // that takes the panel away takes the caret to the document with it,
        // and a keyboard is left at the top of the sheet having pressed a
        // button on the rail. Reset lives in the `⋯` menu, which closed on the
        // way in, so the fallback is the control that menu hangs off.
        (this.shadowRoot.querySelector('[data-action="reset"]')
          ?? this.shadowRoot.querySelector('[data-action="chrome-menu"]'))?.focus();
        break;
      case 'reset-confirm': {
        // The button only exists armed, but check the word anyway -- the DOM
        // is not the gate, the word is.
        const word = this.shadowRoot.querySelector('[data-reset-word]')?.value || '';
        if (word.trim().toUpperCase() !== 'RESET') break;
        this.#confirmReset = false;
        this.resetToSource();
        break;
      }
      default:
        break;
    }
  }
}

if (!customElements.get('character-sheet')) {
  customElements.define('character-sheet', CharacterSheetElement);
}

export default CharacterSheetElement;
