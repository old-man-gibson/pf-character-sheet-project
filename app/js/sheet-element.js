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
 *   theme  "dark" (default) or "light"
 *   storage-key  localStorage key for edits; omit to disable persistence
 *   snapshot-every  changes between automatic snapshots (default 20)
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
  MATERIAL_CASTING_PER_LEVEL, optionCatalogues,
} from './model.js';
import { runtime as extensionRuntime } from './extension-runtime.js';
import {
  applyBlock, BLOCK_KINDS, looksLikeExtension, archetypeStatus, removeArchetype, swapLabel,
} from './extensions.js';
import { SHEET_CSS } from './styles.js';
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
  MYTHIC_STAT_TIERS, MYTHIC_TRADITION_SLOTS, MYTHIC_TIERS,
  MYTHIC_TIER_LEVEL, mythicTierGrant,
  GEAR_BONUS_TYPES, WEAPON_ATTACK_TYPES, WEAPON_GROUPS, WEAPON_HANDEDNESS,
  WEAPON_FAMILIARITY, WEAPON_CRIT_MULTS, diceString,
  ARMOR_PROFICIENCIES, SHIELD_PROFICIENCIES,
  ATTACK_MODES, ATTACK_MODE_LABELS, ALT_ATTACK_OF, attackModeTotal,
  CRAFT_SPEED_KINDS, CRAFT_CHECK_MODES, CRAFT_TIME_BASES, CRAFT_SPEED_MULTIPLIER,
  BLENDED_SPHERES, sphereSide, conditionInfo,
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
import { formulaPanelHtml, workingHtml, browserHtml, myFormulasHtml, valueGroups } from './formula-guide.js';
import { hasTokens, formatValue } from './inline.js';
import { historyFor, countChanges, SNAPSHOT_EVERY, AUTO_KEEP } from './history.js';
import {
  TRACKER_PALETTE, THEME_ACCENT, THEME_NEGATIVE, normalizeStyle, normalizeHex, isDefaultStyle,
  resolveZones, zoneAt, stepColor, barLayout, squareLayout, barClickValue, rgba,
  trackBand,
} from './tracker-style.js';
import {
  ROLL_FORMATS, DEFAULT_ROLL_FORMAT, rollSpec, rollText, WEAPON_MODE_KEYS,
} from './roll20.js';

/**
 * What the gold left edge on a field means, in the two flavours it comes in:
 * prose that may carry {…} tokens anywhere in the text, and a field whose
 * whole value may be written as an expression.
 */
const PROSE_HINT = 'Formulas work here: {= 2 + con.mod} shows a value, '
  + '{qi.max = wis.mod} names one, {qi.max} reuses it.';
const EXPR_HINT = 'Formulas work here: write an expression (level * 100, 3 + con.mod) '
  + 'instead of a number.';

/**
 * The die on a roll button: a hexagon -- a d20's silhouette -- with the face
 * you would read on top of it. Drawn rather than typed, because Unicode's dice
 * characters are all six-sided and an emoji would take the host page's font.
 */
const D20_ICON = '<svg class="d20icon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
  + '<path d="M50 4 93 28v44L50 96 7 72V28z"/>'
  + '<path d="M50 30 74 70H26z"/>'
  + '<path d="M50 30V4M74 70l19 2M26 70 7 72"/>'
  + '</svg>';

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

const TABS = [
  ['overview', 'Overview'],
  ['stats', 'Stats'],
  ['skills', 'Skills'],
  ['combat', 'Spheres & Magic'],
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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * The session dashboard's building blocks, in their default order. The blocks
 * are fixed; which of them show, and in what order, is the player's
 * (`uiPrefs.dashCards`) -- and until they arrange it themselves, the caster
 * cards come and go with the systems the character actually uses.
 */
const DASH_CARDS = [
  ['conditions', 'Conditions'],
  ['buffs', 'Buffs'],
  ['resources', 'Resources'],
  ['vancian', 'Spells & slots'],
  ['psionics', 'Power points'],
  ['spheres', 'Casting numbers'],
  ['veils', 'Veils shaped'],
  ['maneuvers', 'Readied maneuvers'],
  ['talents', 'Talents'],
  ['offense', 'Offense'],
  ['defense', 'Defense'],
  ['skills', 'Key skills'],
  ['effects', 'Active effects'],
  ['quick', 'Quick actions'],
];
const DASH_CARD_LABELS = new Map(DASH_CARDS);

/**
 * Past this many steps a row of pips is a wall rather than a reading, so the
 * pip shape draws nothing and a meter falls back to its bar.
 */
const PIP_LIMIT = 40;

/** What a template feature's type means, on the dropdown that sets it. */
const TEMPLATE_TYPE_HINTS = {
  Ex: 'Extraordinary — not magical, works in an antimagic field',
  Su: 'Supernatural — magical, but no spell resistance or concentration',
  Sp: 'Spell-like — as a spell, subject to spell resistance',
};

/** A table starts as two named columns and a row, which is enough to type into. */
const NEW_TEMPLATE_TABLE = () => ({
  caption: '', columns: ['', ''], rows: [{ cells: [null, null] }],
});

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

const val = (v) => (v === null || v === undefined || v === '' ? '—' : esc(v));

/** The base attack progressions a class can run, as the rules name them. */
const BAB_RATES = [[1, 'full'], [0.75, '&frac34;'], [0.5, '&frac12;'], [0, 'none']];

/**
 * The frame colours a card wears: frame, its darker edge, and the card-stock
 * tint of its bars. One colour is a flat frame; two or more split the frame
 * into bands, each colour its own stretch with a narrow gradient between.
 */
const CARD_FRAMES = {
  R: ['#a4402f', '#6a2418', '#f6e5de'],
  B: ['#4a4356', '#26212e', '#e6e1ec'],
  U: ['#2f5f92', '#1a3656', '#dfe9f5'],
  W: ['#b8ad84', '#7f7550', '#f8f5e8'],
  G: ['#3a6d43', '#1f4326', '#e2eedf'],
};
/** [Draw 2], [Shuffle], [Exile]… in a card's rendered text, marked as keyword chips. */
const KEYWORD_RE = /\[\s*(on\s*mill|on\s*redraw|on\s*draw|on\s*discard|on\s*exile|draw|discard|shuffle|tap|untap|mill|peek|wild|exile|bottom|top|return|deck|ante)(\s+\d+)?\s*\]/gi;
function markKeywords(html) {
  return String(html).replace(KEYWORD_RE, (m, kw, n) => {
    const word = kw.toLowerCase().replace(/^on\s*/, 'on ');
    const trigger = word.startsWith('on ');
    const label = word.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
    return `<span class="kw${trigger ? ' trig' : ''}" title="${trigger ? 'Trigger: fires when this happens to the card' : 'Fires when the card is cast'}">${trigger ? '⚡ ' : ''}${label}${n ? ` ${n.trim()}` : ''}</span>`;
  });
}

function cardFrameStyle(colors) {
  const letters = String(colors || '').split('').filter((c) => CARD_FRAMES[c]);
  if (letters.length <= 1) return '';
  const n = letters.length;
  const band = 6;                        // width of each blend, in percent
  const stops = [];
  letters.forEach((c, i) => {
    const start = (i / n) * 100;
    const end = ((i + 1) / n) * 100;
    const from = i === 0 ? 0 : start + band / 2;
    const to = i === n - 1 ? 100 : end - band / 2;
    stops.push(`${CARD_FRAMES[c][0]} ${from.toFixed(1)}% ${to.toFixed(1)}%`);
  });
  const dark = letters.map((c) => CARD_FRAMES[c][1]);
  return `--frame-bg: linear-gradient(90deg, ${stops.join(', ')}); --frame: ${CARD_FRAMES[letters[0]][0]}; --frame-dark: ${dark[0]}; --frame-dark-2: ${dark[dark.length - 1]}; --stock: #f4efe0;`;
}

/** A slot count as the sheet showed it: a number, unlimited, or not at all. */
const slotText = (s) => {
  if (s.atWill) return '∞';
  return s.slots === null || s.slots === undefined ? '—' : String(s.slots);
};

/**
 * What is left of a pool of slots, drawn with the tracker shapes.
 *
 * The same pips and squares the Trackers tab uses, on state that lives with the
 * casting block instead of on a tracker of its own -- six classes times ten spell
 * levels would be sixty trackers, which is not a list anybody wants. The shapes
 * and their layout maths are shared; only the plumbing differs.
 *
 * `path` is the item the click writes to, as `list|index|field`. Clicking the nth
 * pip leaves n unspent, and clicking the lowest lit one spends it -- the rule the
 * tracker pips already follow.
 */
function slotSpend({ path, total, left, shape = 'pips', name = 'slot' }) {
  const cap = Math.max(0, Number(total) || 0);
  if (!cap) return '';
  const lit = Math.max(0, Math.min(cap, Number(left) || 0));
  const attrs = (n) => `data-spend="${path}" data-total="${cap}" data-left="${lit}" data-n="${n}"`;
  const title = `${lit} of ${cap} left`;

  if (shape === 'squares') {
    const sq = squareLayout({ min: 0, max: cap, current: cap - lit, style: { shape, fill: 'remaining' } });
    if (sq.mode === 'number') {
      return `<button class="pipcount" ${attrs(Math.max(1, lit - 1))}
        title="${esc(`${title} — click to spend one`)}">${lit}<span class="of">/${cap}</span></button>`;
    }
    return `<span class="pips square" title="${esc(title)}">${
      Array.from({ length: sq.slots }, (_, i) => `<button class="pip ${i + 1 <= lit ? 'used' : ''}"
        ${attrs(i + 1)} title="${esc(`${i + 1} of ${cap}`)}"
        aria-label="Leave ${i + 1} of ${esc(name)}"></button>`).join('')
    }</span>`;
  }

  // A long row of pips stops being readable, so a big pool just shows the count.
  if (cap > 12) {
    return `<button class="pipcount" ${attrs(Math.max(1, lit - 1))}
      title="${esc(`${title} — click to spend one`)}">${lit}<span class="of">/${cap}</span></button>`;
  }
  return `<span class="pips" title="${esc(title)}">${
    Array.from({ length: cap }, (_, i) => `<button class="pip ${i + 1 <= lit ? 'used' : ''}"
      ${attrs(i + 1)} title="${esc(`${i + 1} of ${cap}`)}"
      aria-label="Leave ${i + 1} of ${esc(name)}"></button>`).join('')
  }</span>`;
}

/** The six abilities as the pick selectors label them. */
const ABILITY_LABELS_LIST = ABILITIES.map((k) => ABILITY_LABELS[k]);

const round = (v, places = 2) => {
  const f = 10 ** places;
  return Math.round((Number(v) || 0) * f) / f;
};

/** Crafting deals in six-figure prices, which are unreadable ungrouped. */
const group = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Maneuver types, short enough for a narrow column.
 *
 * The sheet writes qualifiers in brackets -- "Strike [curse]", "Strike [G]" --
 * which the full name carries in the row's tooltip.
 */
const TYPE_ABBREV = {
  Strike: 'Str', Boost: 'Bst', Counter: 'Ctr', Stance: 'Stc', Untyped: 'Unt',
};
const shortType = (t) => {
  const base = String(t || '').replace(/\s*\[.*$/, '').trim();
  return TYPE_ABBREV[base] || base.slice(0, 3);
};

const pct = (v) => `${round((Number(v) || 0) * 100, 2)}%`;

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
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

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
  #confirmDelete = null;
  /** Which Classes row has its sub-system picker open (index, or null). */
  #openClassSystems = null;
  /** Whether the dashboard's grouped condition picker is unfolded. */
  #condPickerOpen = false;
  /** Which buff row has its editor open (index, or null). */
  #openBuff = null;
  /** Whether the header's Reset is asking to be armed (type RESET to confirm). */
  #confirmReset = false;
  /** Whether the dashboard's card arranger is open. */
  #dashArrange = false;
  /** Which maneuver's overview note is being edited ("<list>|<name>", or null). */
  #openManeuverNote = null;
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
  /**
   * Roll template or bare /roll. A preference of the person playing rather than
   * of the character -- their Roll20 game is what decides it -- so it lives in
   * localStorage beside the library, not in the document. An embed without
   * storage falls back to the field's own value for the session.
   */
  #rollFormat = readRollFormat();

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
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

  connectedCallback() {
    if (!this.hasAttribute('theme')) this.setAttribute('theme', 'dark');
    this.#renderShell();
    extensionRuntime.addEventListener('change', this.#onExtensionsChange);
    const src = this.getAttribute('src');
    if (src && !this.#model) this.load(src);
  }

  disconnectedCallback() {
    extensionRuntime.removeEventListener('change', this.#onExtensionsChange);
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
    // The shared tables -- the maneuver catalogue, casting and power-point
    // tables, deck manipulations, the iron chef's ingredients -- have to be in
    // place before the model is built, whichever way the document arrived. Once
    // they were fetched by `load(src)` alone, and a character handed in through
    // this property (every imported one, and every one at all now that the app
    // bundles none) opened with its disciplines "not in the catalogue".
    await loadSharedTables();
    // Kept pristine so Reset works for a document handed in directly, where
    // there is no src to re-fetch.
    this.#sourceDoc = structuredClone(doc);
    this.#history = historyFor(doc?.id ?? 'character',
      { storageKey: this.getAttribute('storage-key') });
    this.#resume = null;
    this.#historyNote = null;
    this.#showHistory = false;
    this.#snapshotAt = 0;

    const working = this.#history.readWorking();
    const canonical = await this.#history.readSaved();
    this.#savedDoc = canonical?.data ?? null;

    // A canonical version written for an older schema cannot be loaded, but the
    // player is told rather than left wondering where their save went.
    if (canonical && !canonical.data) {
      this.#historyNote = `The saved version was written for schema ${canonical.schemaVersion}`
        + ' and cannot be opened by this build. The sheet has opened where you left off instead.';
    }

    const open = this.#savedDoc ?? working?.data ?? doc;
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
    if (drifted) this.#history.writeWorking(this.#model.toJSON());
    await this.#refreshSnapshots();
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
    this.#model.subscribe(() => {
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
      await loadSharedTables();
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

  get isAdmin() { return this.getAttribute('role') === 'admin'; }

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
    this.#history.writeWorking(this.#model.toJSON());

    clearTimeout(this.#snapshotTimer);
    this.#snapshotTimer = setTimeout(() => this.#considerSnapshot(), 800);
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
      this.#history.writeWorking(this.#model.toJSON());
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
    this.shadowRoot.innerHTML = `<style>${SHEET_CSS}</style><div class="wrap"><p class="empty">Loading…</p></div>`;
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
    if (caret !== null && typeof next.setSelectionRange === 'function' && next.type === 'text') {
      try { next.setSelectionRange(caret, caret); } catch { /* unsupported input type */ }
    }
  }

  #fail(msg) {
    this.shadowRoot.innerHTML = `<style>${SHEET_CSS}</style><div class="wrap"><div class="panel"><h3>Character sheet</h3><p class="empty">${msg}</p></div></div>`;
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
    // The guide sits last on every bar, and the audit after it for an admin.
    bar.push({ key: 'formulas', id: 'formulas', label: 'ƒx Formulas', kind: 'core' });
    if (this.isAdmin) bar.push({ key: 'audit', id: 'audit', label: 'Formula Audit', kind: 'core' });
    const allIds = [...bar.map((e) => e.id), 'systabs'];
    if (!allIds.includes(this.#tab)) this.#tab = bar[0]?.id ?? 'systabs';

    this.shadowRoot.innerHTML = `
      <style>${SHEET_CSS}</style>
      <div class="wrap">
        ${this.#header()}
        <nav class="tabs" role="tablist">
          ${bar.map((e) => `
            <button role="tab" data-tab="${e.id}" data-tabkey="${esc(e.key)}" aria-pressed="${this.#tab === e.id}"
              ${FIXED_TABS.has(e.key) ? '' : 'draggable="true" title="Drag to rearrange"'}>${esc(e.label)}</button>
          `).join('')}
          <button role="tab" data-tab="systabs" aria-pressed="${this.#tab === 'systabs'}" title="Show, hide and rearrange tabs">⚙</button>
        </nav>
        <div class="rollslot">${this.#rollToastHtml()}</div>
        <div class="body">${this.#panel()}</div>
      </div>`;
    this.#applyCharacterColor();
    this.#bind();
  }

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
          ${this.#sessionStrip()}
        </div>
        <div class="head-actions">
          ${this.#viewModeButton()}
          ${this.#formulaButton()}
          <button data-action="theme">${this.getAttribute('theme') === 'light' ? 'Dark' : 'Light'}</button>
          <button data-action="save" class="${this.#changes ? 'primary' : ''}"
            ${this.#changes ? '' : 'disabled'}
            title="${this.#changes
              ? 'Make this the version the sheet opens on'
              : 'Nothing has changed since the last save'}">
            Save${this.#changes ? ` (${this.#changes})` : ''}
          </button>
          <button data-action="history" aria-pressed="${this.#showHistory}"
            title="Earlier states of this sheet">History${this.#snapshots.length ? ` (${this.#snapshots.length})` : ''}</button>
          <button data-action="export">Export JSON</button>
          <button data-action="import" title="Load a character this app exported, or convert a .xlsx workbook">Import</button>
          <input type="file" accept="application/json,.json,.xlsx,.xlsm" data-importfile hidden>
          <button data-action="reset" class="danger" aria-expanded="${this.#confirmReset}"
            title="Back to the character as imported. Asks first, and named checkpoints are kept.">Reset</button>
        </div>
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
      </header>`;
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

  /** The Session/Build switch: which view of the sheet is showing. */
  #viewModeButton() {
    const session = this.#model.viewMode() === 'session';
    return `<button data-action="view-mode" aria-pressed="${session}"
      title="${session
    ? 'Session view: the tabs that come up at the table. Switch back to see everything.'
    : 'Switch to the session view: only the tabs that come up at the table'}">
      ${session ? 'Session' : 'Build'} view</button>`;
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
      ? `<strong class="now ${cs.delta[key] > 0 ? 'up' : ''}" title="With conditions and buffs applied">${format(cs.adjusted[key])}</strong>`
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

  #panel() {
    if (this.#tab.startsWith('sys-')) return this.#systemPanel(Number(this.#tab.slice(4)));
    switch (this.#tab) {
      case 'stats': return this.#statsPanel();
      case 'skills': return this.#skillsPanel();
      case 'combat': return this.#combatPanel();
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
   * The Overview, top to bottom: who the character is, the numbers a table
   * asks for, the classes those numbers come out of, then what defends them
   * and what they attack with -- each of those a supergroup of the panels that
   * belong together -- and last the things that change less often: conditions,
   * the wallet, traits.
   */
  #overviewPanel() {
    const c = this.#model.data;
    const d = c.defenses;
    const s = c.saves;
    const cs = this.#model.conditionState;
    // A stat's read-out: the reconciled base, and the conditioned value under
    // it when a ticked condition moves it. The base is what the sheet says;
    // the second line is what the character is rolling right now.
    const now = (key, format = fmt) => (cs.changed && cs.delta[key]
      ? `<span class="now" title="With conditions applied">now ${format(cs.adjusted[key])}</span>` : '');

    return `<div class="grid overview">
      <section class="panel span2">
        <h3>At a glance
          ${cs.active.length ? `<span class="badge err">${cs.active.length} condition${cs.active.length === 1 ? '' : 's'} on</span>` : ''}
        </h3>
        <div class="bigstats">
          ${this.#bigStat('HP', c.hp.total, c.hp.ability ? `${c.hp.ability} based` : '', now('hp', String))}
          ${this.#bigStat('AC', d.ac, `touch ${d.touch} &middot; FF ${d.flatFooted}`, now('ac', String))}
          ${this.#bigStat('CMD', d.cmd, `FF ${d.ffCmd}`, now('cmd', String))}
          ${this.#bigStat('Init', fmt(c.hp.initiative), c.hp.initAbility || '', now('initiative'),
    this.#rollButton('initiative', 'self', 'initiative', cs))}
          ${this.#bigStat('Fort', fmt(s.fortitude.total), s.fortitude.stat1 || '', now('fortitude'))}
          ${this.#bigStat('Ref', fmt(s.reflex.total), s.reflex.stat1 || '', now('reflex'))}
          ${this.#bigStat('Will', fmt(s.will.total), s.will.stat1 || '', now('will'))}
          ${this.#bigStat('BAB', fmt(c.attack.bab), c.attack.iterative || '')}
          ${(() => {
    // The wallet, beside the numbers a table asks for: what is on hand, and
    // what is left once the offering owed today is paid.
    const w = this.#model.wealthView();
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    return this.#bigStat(esc(w.currency), n(w.current), w.due && w.expected.total
      ? `after offering ${n(w.after)}` : (w.due ? 'nothing owed' : 'on hand'));
  })()}
        </div>
      </section>

      <div class="pairrow span2">
        ${this.#detailsPanel()}
        ${this.#abilityScoresPanel()}
      </div>
      <div class="pairrow even span2">
        ${this.#specialtyPanel()}
        ${this.#languagesPanel()}
      </div>

      ${this.#classesPanel()}

      <div class="supergroup span2" aria-label="Defenses">
        <div class="supergroup-title">Defenses</div>
        <div class="supergroup-body">
          ${this.#hitPointsPanel()}
          ${this.#acPanel()}
          ${this.#savesPanel()}
        </div>
      </div>

      <div class="supergroup span2" aria-label="Offenses">
        <div class="supergroup-title">Offenses</div>
        <div class="supergroup-body offenses">
          ${this.#attackPanel()}
          ${this.#speedPanel()}
          ${this.#proficienciesPanel()}
        </div>
      </div>

      <div class="pairrow span2 wide-first">
        ${this.#conditionsPanel()}
        ${this.#carryPanel()}
      </div>
      ${this.#collapsible('buffs', this.#buffsPanel())}
      ${this.#collapsible('wealth', this.#wealthPanel())}
      ${this.#traitsPanel()}
    </div>`;
  }

  /* ---------------- the session dashboard ---------------- */

  /**
   * The Overview as it reads mid-session: cards answering what a table
   * actually asks -- what is on me, what can I spend, what do I roll, what
   * is running -- with the full machinery one Expand (the same panels the
   * build view shows) or one Build-view click away. Expand states persist
   * in uiPrefs.collapsed under dash:* keys, where true means open.
   */
  #dashboardPanel() {
    const open = (key) => !!this.#model.data.uiPrefs?.collapsed?.[`dash:${key}`];
    const e = this.#model.data.equipment || {};
    const render = {
      conditions: () => this.#dashConditionsCard(),
      buffs: () => this.#buffsPanel(),
      resources: () => this.#dashResourcesCard(),
      vancian: () => this.#dashVancianCard(),
      psionics: () => this.#dashPsionicsCard(),
      spheres: () => this.#dashSpheresCard(),
      veils: () => this.#dashVeilsCard(),
      maneuvers: () => this.#dashManeuversCard(),
      talents: () => this.#dashTalentsCard(),
      offense: () => this.#dashOffenseCard(open('offense'))
        + (open('offense') ? `${this.#attackPanel()}${this.#weaponsPanel(e)}` : ''),
      defense: () => this.#dashDefenseCard(open('defense'))
        + (open('defense') ? `${this.#acPanel()}${this.#savesPanel()}` : ''),
      skills: () => this.#dashSkillsCard(open('skills')),
      effects: () => this.#dashEffectsCard(),
      quick: () => this.#dashQuickCard(),
    };
    return `<div class="grid dashboard">
      <div class="dashtools span2">
        <button class="linkish" data-action="dash-arrange" aria-expanded="${this.#dashArrange}">
          ${this.#dashArrange ? 'Done arranging' : 'Arrange cards'}</button>
      </div>
      ${this.#dashArrange ? this.#dashArrangePanel() : ''}
      ${this.#dashCardIds().map((id) => render[id]?.() || '').join('')}
    </div>`;
  }

  /**
   * The dashboard's default composition: the standing cards, plus the caster
   * cards for whatever the character actually uses -- Vancian slots, the
   * psionic pool, the Spheres casting numbers. The reference lists (veils,
   * readied maneuvers, talents) wait in the arranger, because which of those
   * belongs on a player's overview is a playstyle call, not a data one.
   */
  #dashDefaultCards() {
    const inUse = this.#model.systemTabsInUse();
    const tagged = this.#model.taggedSystemTabs();
    const on = (id) => inUse[id] || tagged.has(id);
    const out = ['conditions', 'buffs', 'resources'];
    if (on('vancian')) out.push('vancian');
    if (on('psionics')) out.push('psionics');
    if (on('combat') && this.#model.data.training?.magic) out.push('spheres');
    out.push('offense', 'defense', 'skills', 'effects', 'quick');
    return out;
  }

  /** The cards to show, in order: the player's arrangement, else the automatic one. */
  #dashCardIds() {
    const saved = this.#model.data.uiPrefs?.dashCards;
    if (!Array.isArray(saved)) return this.#dashDefaultCards();
    const known = new Set(DASH_CARD_LABELS.keys());
    return saved.filter((id) => known.has(id));
  }

  /**
   * The arranger: every building block, the shown ones in order with move and
   * hide, the rest one click from joining. The first edit pins the automatic
   * arrangement into uiPrefs.dashCards; Reset hands it back to automatic.
   */
  #dashArrangePanel() {
    const visible = this.#dashCardIds();
    const custom = Array.isArray(this.#model.data.uiPrefs?.dashCards);
    const hidden = DASH_CARDS.filter(([id]) => !visible.includes(id));
    const row = (id, i) => `<div class="item statline">
      <span class="label">${esc(DASH_CARD_LABELS.get(id) || id)}</span>
      <span class="value pair">
        <button data-action="dash-card-move" data-id="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(DASH_CARD_LABELS.get(id))} up">↑</button>
        <button data-action="dash-card-move" data-id="${id}" data-dir="1" ${i === visible.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(DASH_CARD_LABELS.get(id))} down">↓</button>
        <button data-action="dash-card-hide" data-id="${id}" ${visible.length === 1 ? 'disabled' : ''}>Hide</button>
      </span>
    </div>`;
    const offRow = ([id, label]) => `<div class="item statline">
      <span class="label">${esc(label)}</span>
      <span class="value"><button data-action="dash-card-show" data-id="${id}">Show</button></span>
    </div>`;
    return `<section class="panel span2">
      <h3>Your overview ${custom ? '<span class="badge player">arranged by you</span>' : '<span class="badge">automatic</span>'}
        ${custom ? '<button style="margin-left:auto" data-action="dash-cards-reset" title="Back to the automatic arrangement: the standing cards plus whatever this character casts or manifests with">Reset to automatic</button>' : ''}
      </h3>
      <p class="hint">
        The cards are fixed building blocks; which show, and in what order, is yours.
        Left automatic, the caster cards come and go with what the character uses; the
        first change you make here pins the arrangement. The reference lists — veils,
        readied maneuvers, talents — are below, for whatever your playstyle keeps
        reaching for.
      </p>
      <div class="rowlist">${visible.map(row).join('')}</div>
      ${hidden.length ? `<h4 class="subhead" style="margin-top:10px">More to add</h4>
      <div class="rowlist">${hidden.map(offRow).join('')}</div>` : ''}
    </section>`;
  }

  /** The card's corner control: one click between the summary and the full read. */
  #dashExpand(key, openNow) {
    return `<button class="linkish" style="margin-left:auto" data-collapse="dash:${key}"
      aria-expanded="${openNow}">${openNow ? 'Collapse' : 'Expand'}</button>`;
  }

  /** What is on the character right now, as chips; everything else one pick away. */
  #dashConditionsCard() {
    const conds = this.#model.data.conditions || {};
    const cs = this.#model.conditionState;
    const chip = (name) => {
      const info = conditionInfo(name);
      const label = info?.label || name;
      const title = info ? info.rule : '';
      if (info?.kind === 'count') {
        return `<span class="pill cond-pill" title="${esc(title)}">${esc(label)}
          ${this.#num(`conditions.${name}`, Number(conds[name]) || 0, `min="0" style="width:3rem" aria-label="${esc(label)} count"`)}
        </span>`;
      }
      return `<span class="pill cond-pill" title="${esc(title)}">${esc(label)}
        <button data-action="dash-cond-off" data-name="${esc(name)}" aria-label="Take ${esc(label)} off">×</button></span>`;
    };
    const active = Object.keys(conds).filter((n) => Number(conds[n]) > 0)
      .sort((a, b) => a.localeCompare(b));
    return `<section class="panel span2">
      <h3>Conditions ${cs.active.length ? `<span class="badge err">${cs.active.length} on</span>` : ''}
        <button class="linkish" style="margin-left:auto" data-action="dash-cond-picker"
          aria-expanded="${this.#condPickerOpen}">${this.#condPickerOpen ? 'Close' : '+ Add condition'}</button>
      </h3>
      <div class="pills dashconds">
        ${active.map(chip).join('') || '<span class="empty">None — all clear.</span>'}
      </div>
      ${this.#dashCondNumbers()}
      ${this.#dashCondPicker()}
      ${cs.notes.length ? `<ul class="condnotes">${cs.notes.map((n) => `<li>${esc(n[0].toUpperCase() + n.slice(1))}.</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  /**
   * What the ticked conditions add up to, one tag per number they move --
   * conditions alone, so a buff's bonus never reads as a penalty here. An
   * ability score shows where it lands (floored at 0: a penalty past the
   * score empties it, no further).
   */
  #dashCondNumbers() {
    const cs = this.#model.conditionState;
    if (!cs.active.length) return '';
    const t = conditionTotals(cs.active);
    const bits = [];
    const labels = [['attack', 'Attack'], ['melee', 'Melee'], ['ranged', 'Ranged'], ['damage', 'Damage'],
      ['ac', 'AC'], ['cmb', 'CMB'], ['cmd', 'CMD'], ['saves', 'Saves'],
      ['fortitude', 'Fort'], ['reflex', 'Ref'], ['will', 'Will'], ['dc', 'Save DCs'],
      ['skills', 'Skills'], ['abilityChecks', 'Ability checks'], ['initiative', 'Init'],
      ['hp', 'HP'], ['essence', 'Essence'], ['speedFt', 'Speed (ft)']];
    for (const [key, label] of labels) {
      if (t.mods[key]) bits.push(`${label} ${fmt(t.mods[key])}`);
    }
    for (const key of ABILITIES) {
      const base = Number(this.#model.data.abilities[key]?.tempScore) || 0;
      let score = base + (t.ability[key] || 0);
      if (t.abilitySet[key] !== undefined) score = Math.min(score, t.abilitySet[key]);
      score = Math.max(0, score);
      if (score !== base) bits.push(`${ABILITY_LABELS[key]} ${base} → ${score}`);
    }
    if (t.losesDex) bits.push('no Dex to AC');
    if (t.speed === 0) bits.push('no move');
    else if (t.speed < 1) bits.push('half speed');
    if (t.acVsMelee) bits.push(`AC vs melee ${fmt(t.acVsMelee)}`);
    if (t.acVsRanged) bits.push(`AC vs ranged ${fmt(t.acVsRanged)}`);
    if (!bits.length) return '';
    return `<div class="condnums">${bits.map((b) => `<span class="tag">${esc(b)}</span>`).join('')}</div>`;
  }

  /**
   * The catalogue as short shelves rather than one long dropdown: a column per
   * kind of trouble, a button per condition. A click puts it on already
   * ticked; Energy Drain climbs a level per click; what is on shows pressed.
   */
  #dashCondPicker() {
    if (!this.#condPickerOpen) return '';
    const conds = this.#model.data.conditions || {};
    const onNow = (info) => Object.entries(conds)
      .some(([n, v]) => Number(v) > 0 && conditionInfo(n)?.key === info.key);
    const btn = (info) => {
      const on = onNow(info);
      const count = info.kind === 'count';
      return `<button data-action="dash-cond-on" data-name="${esc(info.label)}"
        aria-pressed="${on}" ${on && !count ? 'disabled' : ''}
        title="${esc(info.rule)}">${esc(info.label)}${count && on ? ' +1' : ''}</button>`;
    };
    const cats = CONDITION_CATS.map((cat) => `<div class="condcat">
      <h4>${esc(cat)}</h4>
      ${CONDITIONS.filter((x) => x.cat === cat).map(btn).join('')}
    </div>`);
    // Whatever the workbook listed that the catalogue does not know.
    const custom = Object.keys(conds).filter((n) => !conditionInfo(n) && !(Number(conds[n]) > 0));
    if (custom.length) {
      cats.push(`<div class="condcat"><h4>From the sheet</h4>
        ${custom.map((n) => `<button data-action="dash-cond-on" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
      </div>`);
    }
    return `<div class="condcats">${cats.join('')}</div>`;
  }

  /**
   * Buffs: named, tickable bonuses that ride the condition machinery, so a
   * ticked buff moves every "now" figure exactly as a ticked condition does.
   * Each dial takes a number or a formula -- a Citadel banner's
   * "1 + essence.shoulder" keeps up as essence moves. Shown on the session
   * dashboard and on the build Overview alike.
   */
  #buffsPanel() {
    const buffs = this.#model.data.buffs || [];
    const cs = this.#model.conditionState;
    const list = 'buffs';
    // Collapsed, a buff is one line: tick, name, what it comes to. Opened, each
    // dial is a full-width formula field with its working, because the formulas
    // worth writing -- nested if(…) off hit points and essence -- need room.
    const targetLabels = new Map(BUFF_TARGETS);
    const summary = (b) => {
      const bits = BUFF_MOD_KEYS
        .map(([key, label]) => { const v = Number(b[`${key}Num`]) || 0; return v ? `${fmt(v)} ${label}` : ''; })
        .filter(Boolean);
      for (const row of b.bonuses || []) {
        const v = Number(row?.valueNum) || 0;
        if (!v) continue;
        bits.push(row.target === 'size' ? `${v > 0 ? `+${v}` : v} true size`
          : row.target === 'sizeEffective' ? `${v > 0 ? `+${v}` : v} effective size`
            : row.target === 'sizeStacking' ? `${v > 0 ? `+${v}` : v} size (stacks)`
              : `${fmt(v)} ${targetLabels.get(row.target) || row.target}`);
      }
      return bits.join(' · ') || 'no numbers yet';
    };
    const dial = (b, i, [key, label]) => `<label class="fld"><span>${label}</span>
      ${this.#itemExpr(list, i, key, b, { width: '100%', placeholder: '0, or a formula' })}</label>`;
    // The cards never move: the editor is its own full-width block under the
    // grid, tied to the open card by the shared highlight.
    const row = (b, i) => {
      const open = this.#openBuff === i;
      return `<div class="buffcard${b.on ? '' : ' off'}${b.error ? ' invalid' : ''}${open ? ' open' : ''}">
        <div class="buffhead">
          ${this.#itemCheck(list, i, 'on', b.on !== false)}
          <span class="bname">${esc(b.name || 'Unnamed buff')}</span>
          <span class="bsum hint" style="margin:0">${esc(summary(b))}</span>
          ${b.error ? `<span class="badge err" title="${esc(b.error)}">formula problem</span>` : ''}
          <span class="pair" style="margin-left:auto">
            <button data-action="buff-open" data-index="${i}" aria-expanded="${open}"
              title="${open ? 'Close the editor' : 'Open the dials and formulas'}">${open ? '▾ Close' : '▸ Edit'}</button>
            <button class="danger" data-remove="buffs|${i}" aria-label="Remove buff">×</button>
          </span>
        </div>
      </div>`;
    };
    const editing = buffs[this.#openBuff] ? this.#openBuff : null;
    const editor = editing === null ? '' : (() => {
      const b = buffs[editing];
      const i = editing;
      const bonusRow = (row, j) => `<span class="buffbonus">
        <select data-item="${list}|${i}|bonuses.${j}.target" data-kind="text" aria-label="What this bonus moves">
          ${BUFF_TARGETS.map(([key, label]) => `<option value="${key}"${row.target === key ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
        ${this.#exprField(`data-item="${list}|${i}|bonuses.${j}.value"`, row.value, {
    width: '5.5rem', value: row.valueNum, error: row.valueError, title: 'A number, or a formula — 1 + essence.shoulder',
  })}
        <button class="danger" data-action="buff-bonus-remove" data-index="${i}" data-j="${j}"
          aria-label="Remove this bonus">×</button>
      </span>`;
      return `<div class="buffeditor">
        <div class="fieldgrid">
          <label class="fld"><span>Buff</span>${this.#itemText(list, i, 'name', b.name, 'Citadel banner')}</label>
          ${BUFF_MOD_KEYS.map((k) => dial(b, i, k)).join('')}
        </div>
        ${BUFF_MOD_KEYS.filter(([key]) => typeof b[key] === 'string' && b[key].trim() !== '')
    .map(([key, label]) => this.#formulaMeta(label.toLowerCase(), b[key])).join('')}
        <div class="buffbonuses">
          ${(b.bonuses || []).map(bonusRow).join('')}
          <button data-action="buff-bonus-add" data-index="${i}">+ Add bonus</button>
        </div>
        <p class="hint">Extra bonuses reach what the dials do not: an ability score cascades
          into everything built on its modifier; <em>Save DCs</em> and <em>Essence pool</em>
          show where those numbers are read. <em>Size</em> comes in types that stack with
          each other, while within a type only the largest counts: <em>true</em> changes
          the size itself — attack, AC, CMB, CMD and every weapon's damage dice along the
          official chart — <em>effective</em> ("treated as larger") steps the dice alone,
          and <em>stacking</em> is for the odd item that makes size effects stack outright
          (wraps of suppressed size): it sums with everything and carries the full true
          bundle. Nothing grows past Colossal nor shrinks past Fine; riders like sneak
          keep their dice, and reach stays yours. Values take formulas, like the dials.</p>
        <label class="fld" style="margin-top:6px"><span>Note</span>
          ${this.#prose(`data-item="${list}|${i}|note"`, b.note, 2, 'grow')}</label>
        <p class="hint">The note reads {…} like prose: a definition written here — say
          <code>{deathgrip.dmg.max = 2 * (1 + essence.shoulder) * if(hp.current / hp.total &lt; 0.5, 2, 1)}</code>
          — is a name the whole sheet can then read: a weapon's dice, a tracker, another buff.
          It stands whether the buff is ticked or not; a value that should switch says so itself, with if(…).</p>
      </div>`;
    })();
    return `<section class="panel span2">
      <h3>Buffs ${cs.buffsOn ? `<span class="badge ok">${cs.buffsOn} on</span>` : ''}
        <button style="margin-left:auto" data-action="buff-add">+ Add buff</button>
      </h3>
      <div class="bufflist">
        ${buffs.map(row).join('') || '<p class="empty">No buffs yet.</p>'}
      </div>
      ${editor}
      <p class="hint">A ticked buff rides the same machinery as a condition: attacks, AC,
        saves, skills, initiative and damage all show their <em>now</em> value with it in.
        Every dial takes a number or a formula — <code>1 + essence.shoulder</code> keeps a
        banner's bonus right as the essence moves.</p>
    </section>`;
  }

  /** Every tracker as one row: name, its own meter, and the − n + controls. */
  #dashResourcesCard() {
    const trackers = this.#model.trackers;
    const row = (t) => {
      const max = Number(t.max) || 0;
      const min = Number(t.min) || 0;
      const cur = Number(t.current) || 0;
      const draining = this.#isDraining(t);
      const twoSided = min < 0;
      const shown = draining ? max - cur : cur;
      const signed = (n) => (n > 0 ? `+${n}` : String(n).replace('-', '−'));
      const range = min === 0 ? `/ ${max}`
        : (twoSided && min === -max) ? `/ ±${max}` : `/ ${signed(min)}…${signed(max)}`;
      return `<div class="dashtracker${t.error ? ' invalid' : ''}">
        <span class="tname" title="${esc(t.refresh || '')}">${esc(t.name)}</span>
        <div class="dashmeter">${this.#trackerVisual(t, normalizeStyle(t.style), t.resolvedZones || [], { interactive: true })}</div>
        <span class="tracker-controls">
          <button data-tracker-step="${t.id}" data-delta="-1" aria-label="${esc(t.name)} down one">−</button>
          <input type="number" class="${shown < 0 ? 'neg' : ''}" value="${shown}" data-tracker-current="${t.id}"
            aria-label="${esc(t.name)} ${draining ? 'remaining' : 'current'}">
          <span class="pool">${range}</span>
          <button data-tracker-step="${t.id}" data-delta="1" aria-label="${esc(t.name)} up one">+</button>
        </span>
      </div>`;
    };
    return `<section class="panel span2">
      <h3>Resources
        <button class="linkish" style="margin-left:auto" data-action="goto-trackers"
          title="The Trackers tab: add one, restyle one, give one a formula">+ New tracker</button>
      </h3>
      <div class="dashtrackers">
        ${trackers.map(row).join('') || '<p class="empty">No trackers yet — the Trackers tab starts one.</p>'}
      </div>
    </section>`;
  }

  /** The attack numbers and every weapon's line; Expand brings the full panels up. */
  #dashOffenseCard(openNow) {
    const c = this.#model.data;
    const cs = this.#model.conditionState;
    const weapons = c.equipment?.weapons || [];
    // Moved numbers replace the base in place, coloured by direction, with the
    // base in the tooltip -- the same read as AC and the saves, everywhere.
    const stat = (label, value, nowKey, kind, ref, rollLabel) => {
      const delta = cs.changed ? (cs.delta[nowKey] || 0) : 0;
      const shown = delta
        ? `<strong class="adj ${delta > 0 ? 'up' : ''}" title="Base ${fmt(value)} — with conditions and buffs">${fmt(cs.adjusted[nowKey])}</strong>`
        : `<strong>${fmt(value)}</strong>`;
      return `<span class="dashstat">${esc(label)} ${shown}${this.#rollButton(kind, ref, rollLabel, cs)}</span>`;
    };
    const wrow = (w, i) => {
      const { calc } = w;
      const modeKey = WEAPON_MODE_KEYS[w.attackType];
      const atkDelta = (cs.changed && modeKey && cs.delta[modeKey]) || 0;
      const dmgDelta = (cs.changed && calc && cs.delta.damage) || 0;
      const grow = (cs.changed && calc && cs.sizeSteps) || 0;
      const baseAtkStr = calc?.totalAtkStr ?? fmt(w.attackTotal ?? 0);
      const atkStr = !atkDelta ? baseAtkStr
        : calc
          ? (Object.keys(calc.tokAtk?.dice || {}).length
            ? `${fmt(calc.totalAtk + atkDelta)}+${diceString(calc.tokAtk.dice)}`
            : fmt(calc.totalAtk + atkDelta))
          : fmt((Number(w.attackTotal) || 0) + atkDelta);
      const baseDmgStr = calc?.totalDmgStr ?? w.damageTotal ?? '—';
      // A size buff steps the weapon's own dice along the official chart; the
      // token riders keep theirs, exactly as the rules leave them alone.
      const sized = grow
        ? stepDiceMap(calc.baseDmgDice || {}, grow, c.identity?.size)
        : { dice: calc?.baseDmgDice || {}, flat: 0 };
      const dmgStr = !(dmgDelta || grow) ? baseDmgStr
        : diceString(
          addDice(addDice(sized.dice, calc.tokDmg?.dice || {}), calc.tokMultDmg?.dice || {}),
          calc.totalDmgFlat + dmgDelta + sized.flat,
        ) + ((calc.notes || []).length ? ` ${calc.notes.join(' ')}` : '');
      const dmgMoved = dmgDelta || (grow ? 1 : 0);
      const cls = (d) => (d ? ` adj${d > 0 ? ' up' : ''}` : '');
      return `<div class="statline">
      <span class="label">${esc(String(w.name || '').trim() || `Weapon ${i + 1}`)}</span>
      <span class="value rollpair"><strong class="${cls(atkDelta)}"
          title="${atkDelta ? esc(`Base ${baseAtkStr} — with conditions and buffs`) : ''}">${esc(atkStr)}</strong>
        <span class="dashdmg${cls(dmgMoved)}"
          title="${dmgMoved ? esc(`Base ${baseDmgStr} — with conditions and buffs${grow ? `, ${Math.abs(grow)} size step${Math.abs(grow) === 1 ? '' : 's'} ${grow > 0 ? 'larger' : 'smaller'}` : ''}`) : ''}">${esc(dmgStr)}</span>
        ${this.#rollButton('weapon', i, `a full attack with ${String(w.name || '').trim() || 'this weapon'} — every iterative, damage and crit`, cs)}</span>
    </div>`;
    };
    return `<section class="panel">
      <h3>Offense ${this.#dashExpand('offense', openNow)}</h3>
      <div class="dashstats">
        ${stat('Melee', c.attack.totalMelee, 'melee', 'mode', 'melee', 'a melee attack')}
        ${stat('Ranged', c.attack.totalRanged, 'ranged', 'mode', 'ranged', 'a ranged attack')}
        ${stat('CMB', c.attack.totalCmb, 'cmb', 'mode', 'cmb', 'a combat maneuver')}
        ${stat('Init', c.hp.initiative, 'initiative', 'initiative', 'self', 'initiative')}
      </div>
      <div class="rowlist" style="margin-top:6px">
        ${weapons.map(wrow).join('') || '<p class="empty">No weapons yet — Expand to add one.</p>'}
      </div>
      ${(() => {
    // The full-attack line names the weapon whose damage rides along; with
    // no weapons it falls back to the bare melee iterative chain.
    const pick = Number(this.#draft.fullAttackWeapon);
    const chosen = Number.isInteger(pick) && weapons[pick] ? pick : (weapons.length ? 0 : null);
    const wname = (w, i) => String(w.name || '').trim() || `Weapon ${i + 1}`;
    const control = weapons.length > 1
      ? `<select data-draft="fullAttackWeapon" aria-label="Weapon for the full attack">
          ${weapons.map((w, i) => `<option value="${i}"${i === chosen ? ' selected' : ''}>${esc(wname(w, i))}</option>`).join('')}
        </select>`
      : weapons.length === 1 ? `<span class="dim">${esc(wname(weapons[0], 0))}</span>` : '';
    const roll = chosen !== null
      ? this.#rollButton('weapon', chosen, `a full attack with ${wname(weapons[chosen], chosen)} — every iterative, its damage and crit`, cs)
      : this.#rollButton('mode', 'melee', 'a full-round melee attack — every iterative', cs);
    return this.#lineHtml('Full attack', `${control}
      <span class="dim">${esc(c.attack.iterative || '—')}</span> ${roll}`);
  })()}
      ${cs.changed && cs.delta.damage
    ? `<p class="hint">${fmt(cs.delta.damage)} on damage rolls from conditions and buffs.</p>` : ''}
    </section>`;
  }

  /** AC, CMD and the saves at a glance, adjusted; Expand brings the breakdowns up. */
  #dashDefenseCard(openNow) {
    const d = this.#model.data.defenses;
    const s = this.#model.data.saves;
    const cs = this.#model.conditionState;
    const shown = (key, base, format = String) => (cs.changed && cs.delta[key]
      ? `<strong class="now ${cs.delta[key] > 0 ? 'up' : ''}" title="With conditions and buffs applied">${format(cs.adjusted[key])}</strong>`
      : `<strong>${format(base)}</strong>`);
    const save = (key, label) => this.#lineHtml(label,
      `${shown(key, s[key].total, fmt)}${this.#rollButton('save', key, `a ${label} save`, cs)}`, true);
    const moved = (key, base) => (cs.changed && cs.delta[key] ? cs.adjusted[key] : base);
    return `<section class="panel">
      <h3>Defense ${this.#dashExpand('defense', openNow)}</h3>
      ${this.#lineHtml('AC', `${shown('ac', d.ac)} <span class="dim">touch ${moved('touch', d.touch)} · FF ${moved('flatFooted', d.flatFooted)}</span>`, true)}
      ${this.#lineHtml('CMD', `${shown('cmd', d.cmd)} <span class="dim">FF ${d.ffCmd}</span>`, true)}
      ${save('fortitude', 'Fortitude')}
      ${save('reflex', 'Reflex')}
      ${save('will', 'Will')}
      <p class="hint">Expand for the armour and save breakdowns by bonus type.</p>
    </section>`;
  }

  /** The skills that come up, best first; Expand lists every trained one. */
  #dashSkillsCard(openNow) {
    const cs = this.#model.conditionState;
    const all = (this.#model.data.skills || []).map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden);
    const byBonus = (a, b) => (Number(b.s.bonus) || 0) - (Number(a.s.bonus) || 0);
    const trained = all.filter(({ s }) => (Number(s.totalRanks) || 0) > 0).sort(byBonus);
    const pool = trained.length ? trained : [...all].sort(byBonus);
    const rows = openNow ? pool : pool.slice(0, 6);
    // The same delta the d20 copy applies: the flat skill-check penalty plus
    // whatever the skill's own ability lost or gained.
    const row = ({ s, i }) => {
      const delta = cs.changed
        ? statModDelta(cs.deltas || {}, (s.abilities || [])[0], null) + (cs.delta.skills || 0) : 0;
      const shown = delta
        ? `<strong class="adj ${delta > 0 ? 'up' : ''}" title="Base ${fmt(s.bonus)} — with conditions and buffs">${fmt((Number(s.bonus) || 0) + delta)}</strong>`
        : fmt(s.bonus);
      return `<div class="statline">
      <span class="label">${esc(skillLabel(s.name, s.spec) || s.name || '—')}</span>
      <span class="value rollpair">${shown}${this.#rollButton('skill', i, `a ${skillLabel(s.name, s.spec) || 'skill'} check`, cs)}</span>
    </div>`;
    };
    return `<section class="panel">
      <h3>Key skills ${this.#dashExpand('skills', openNow)}</h3>
      <div class="rowlist">${rows.map(row).join('') || '<p class="empty">No skills yet.</p>'}</div>
      <p class="hint">${trained.length} trained · ${openNow ? 'all of them above'
    : `the top ${Math.min(6, pool.length)} by bonus`} — ranks are spent on the Skills tab.</p>
    </section>`;
  }

  /** Player-written reminders of what is running. They move no numbers. */
  #dashEffectsCard() {
    const effects = this.#model.data.effects || [];
    const row = (x, i) => `<div class="effectrow${x.on === false ? ' off' : ''}">
      <div class="pair">
        ${this.#itemCheck('effects', i, 'on', x.on !== false)}
        ${this.#itemText('effects', i, 'name', x.name, 'Watching the north door')}
        <button class="danger" data-remove="effects|${i}" aria-label="Remove effect">×</button>
      </div>
      ${this.#itemText('effects', i, 'note', x.note, 'the detail worth remembering')}
    </div>`;
    return `<section class="panel">
      <h3>Active effects</h3>
      <div class="effectlist">${effects.map(row).join('') || '<p class="empty">Nothing running.</p>'}</div>
      <div style="margin-top:8px">${this.#addButton('effects', 'Add effect', { name: '', note: '', on: true })}</div>
      <p class="hint">Reminders, not rules: these move no numbers. A bonus with numbers
        behind it belongs in <strong>Buffs</strong> above, where it moves everything.</p>
    </section>`;
  }

  /** Damage, healing and the night's rest, one field and three buttons. */
  #dashQuickCard() {
    const hp = this.#model.hpState;
    return `<section class="panel span2">
      <h3>Quick actions</h3>
      <div class="pair" style="flex-wrap:wrap">
        <input type="number" min="0" data-draft="quickHp" value="${esc(this.#draft.quickHp ?? '')}"
          placeholder="Amount" style="width:5.5rem" aria-label="Hit points to apply">
        <button data-action="quick-damage"
          title="Temporary hit points absorb first; the rest comes off current">Damage</button>
        <button data-action="quick-heal"
          title="Current climbs to the maximum, and the same points erase nonlethal">Heal</button>
        <span class="dashsep" aria-hidden="true"></span>
        <button data-action="quick-rest"
          title="Every tracker with a daily refresh goes back to unspent. Slots and pools with other rhythms are yours to move.">Rest</button>
      </div>
      <p class="hint">HP ${(() => {
    const cs = this.#model.conditionState;
    const maxNow = cs.changed && cs.delta.hp ? cs.adjusted.hp : hp.max;
    return `${Math.min(hp.current, maxNow)}/${maxNow}`;
  })()}${hp.temp ? ` (+${hp.temp} temp)` : ''}${hp.nonlethal
    ? ` · ${hp.nonlethal} nonlethal` : ''} — the strip above follows along.</p>
    </section>`;
  }

  /**
   * Vancian, as the table spends it: a row per casting class with its slot
   * pips (spontaneous and hybrid casters), then the prepared list with its
   * squares -- the same paths the Vancian tab writes, so the two views are one
   * pool. Tables, DCs and known lists stay on the tab.
   */
  #dashVancianCard() {
    const v = this.#model.data.vancian;
    const classes = v?.classes || [];
    if (!classes.length) {
      return `<section class="panel"><h3>Spells &amp; slots</h3>
        <p class="empty">No casting classes yet — the Vancian tab starts one.</p></section>`;
    }
    const classRow = (c, ci) => {
      const base = `vancian.classes.${ci}`;
      const spends = prepStyle(c.prep).slots === 'pool';
      const noun = c.noun || castingNoun(c.source);
      const levels = (c.spells || []).map((s, si) => {
        if (!s.slots || s.atWill) return '';
        return `<span class="dashslot"><span class="dim">L${s.level}</span>${spends
          ? slotSpend({ path: `${base}.spells|${si}|used`, total: s.slots, left: s.left, name: `${noun.one} level ${s.level}` })
          : `<span class="pool">${s.slots}/day</span>`}</span>`;
      }).filter(Boolean).join('');
      return `<div class="dashcaster">
        <span class="tname">${esc(c.name || 'Casting class')} <span class="dim">CL ${c.casterLevel ?? 0}</span></span>
        <span class="dashslots">${levels || '<span class="empty">no slots at this level</span>'}</span>
        ${this.#rollButton('concentration', `vancian:${ci}`, `${c.name || 'this class'} concentration`)}
      </div>`;
    };
    const prepared = (v.prepared || []).map((r, i) => ({ r, i })).filter(({ r }) => r.name);
    // Spell rows pack into columns, and every row's squares start at the same
    // left edge -- pip one top-left, filling rightward, whatever the count.
    const prow = ({ r, i }) => `<div class="dashspell">
      <span class="sname" title="${esc(r.note ? `${r.name} — ${this.#proseText(r.note)}` : r.name)}">${esc(r.name)}${r.classLevel ? ` <span class="dim">${esc(r.classLevel)}</span>` : ''}</span>
      <span class="suses">${slotSpend({ path: `vancian.prepared|${i}|used`, total: r.uses, left: r.left, shape: 'squares', name: r.name })
        || '<span class="dim">—</span>'}</span>
    </div>`;
    return `<section class="panel span2">
      <h3>Spells &amp; slots
        ${v.calc?.spent ? `<span class="badge">${v.calc.spent} spent today</span>` : ''}
        <button style="margin-left:auto" data-action="vancian-new-day"
          title="Everything spent comes back">New day</button>
      </h3>
      ${classes.map(classRow).join('')}
      ${prepared.length ? `<div class="dashspells">${prepared.map(prow).join('')}</div>` : ''}
      <p class="hint">Pips spend an anonymous slot; squares spend a prepared casting —
        the Vancian tab holds the tables, DCs and spell lists.</p>
    </section>`;
  }

  /** The day's power points, spendable in place; the tab holds the powers. */
  #dashPsionicsCard() {
    const p = this.#model.data.psionics;
    const pool = Number(p?.pool) || 0;
    if (!p || (!pool && !(p.classes || []).length)) {
      return `<section class="panel"><h3>Power points</h3>
        <p class="empty">No manifesting classes yet — the Psionics tab starts one.</p></section>`;
    }
    const left = Number(p.left) || 0;
    return `<section class="panel">
      <h3>Power points <span class="badge">${left} of ${pool}</span>
        <button class="linkish" style="margin-left:auto" data-action="psionics-new-day"
          title="The whole pool comes back">New day</button>
      </h3>
      ${this.#meterVisual(this.#model.meterSpec('pp'))}
      <div class="tracker-controls" style="margin-top:6px">
        <button data-pool-step="-1" aria-label="Spend one power point">−</button>
        <input type="number" value="${left}" data-pool-left aria-label="Power points remaining">
        <span class="pool">/ ${pool}</span>
        <button data-pool-step="1" aria-label="Restore one power point">+</button>
      </div>
    </section>`;
  }

  /** A DC as it stands right now: buffed values replace the base, base in the tooltip. */
  #dcShown(base) {
    const cs = this.#model.conditionState;
    const d = cs.changed ? (cs.delta.dc || 0) : 0;
    if (!d) return `${base ?? 0}`;
    return `<strong class="adj ${d > 0 ? 'up' : ''}"
      title="Base ${base ?? 0} — with conditions and buffs">${(Number(base) || 0) + d}</strong>`;
  }

  /** The Spheres casting figures a round actually asks for, with the concentration d20. */
  #dashSpheresCard() {
    const t = this.#model.data.training || {};
    const m = t.magic;
    if (!m) {
      return `<section class="panel"><h3>Casting numbers</h3>
        <p class="empty">No magic training — the Spheres &amp; Magic tab starts it.</p></section>`;
    }
    return `<section class="panel">
      <h3>Casting numbers</h3>
      ${this.#line('Caster level', m.globalCL ?? 0)}
      ${this.#lineHtml('Concentration', `<span class="rollpair">${fmt(m.concentration ?? 0)}${
        this.#rollButton('concentration', 'magic', 'a concentration check')}</span>`, true)}
      ${this.#line('MSB / MSD', `${fmt(m.msb ?? 0)} / ${m.msd ?? 0}`)}
      ${this.#lineHtml('Save DC', this.#dcShown(m.globalDC), true)}
      ${this.#line('Spell points', `${m.availableSP ?? m.totalSP ?? 0} of ${m.totalSP ?? 0}`)}
      ${t.combat ? this.#lineHtml('Practitioner DC', this.#dcShown(t.combat.practitionerDC), true) : ''}
      <p class="hint">Points spent in play live on their tracker in Resources; the
        talents are on Spheres &amp; Magic.</p>
    </section>`;
  }

  /** Every shaped veil at a glance: slot, essence invested, save DC -- buffed values in place. */
  #dashVeilsCard() {
    const a = this.#model.data.akashic;
    const cs = this.#model.conditionState;
    const holders = [...(a?.slots || []), ...(a?.kheshig || [])];
    const shaped = holders.flatMap((s) => (s.veils || []).map((v) => ({ slot: s.slot, v })));
    const dEss = cs.changed ? (cs.delta.essence || 0) : 0;
    const free = Number(a?.calc?.free) || 0;
    const total = Number(a?.calc?.total) || 0;
    const pool = dEss
      ? `<strong class="adj ${dEss > 0 ? 'up' : ''}" title="Base ${free} free of ${total} — with buffs; investment math stays on the Akashic tab">${free + dEss} free of ${total + dEss}</strong>`
      : `${free} free of ${total}`;
    return `<section class="panel">
      <h3>Veils shaped ${shaped.length ? `<span class="badge">${shaped.length}</span>` : ''}</h3>
      ${total || dEss ? this.#lineHtml('Essence', pool, true) : ''}
      <div class="rowlist">${shaped.map(({ slot, v }) => `<div class="statline">
        <span class="label" title="${esc(v.name || '')}">${esc(v.name || '—')} <span class="dim">${esc(slot || '')}</span></span>
        <span class="value">${Number(v.essence) ? `${v.essence} essence · ` : ''}DC ${this.#dcShown(v.dc)}</span>
      </div>`).join('') || '<p class="empty">No veils shaped — the Akashic tab is where they go on.</p>'}</div>
    </section>`;
  }

  /**
   * What is readied, by discipline, each with the player's own note under it
   * (the ✎ on the Maneuvers tab writes it; {…} formulas resolve). The ticks
   * themselves live on the tab.
   */
  #dashManeuversCard() {
    const m = this.#model.data.maneuvers;
    const disciplines = (m?.disciplines || [])
      .map((d) => ({ name: d.name, notes: d.notes || {}, readied: (d.entries || []).filter((e) => e.known) }))
      .filter((d) => d.readied.length);
    const row = (e, notes) => {
      const note = notes[e.name] || '';
      return `<div class="statline">
        <span class="label" title="${esc(e.name)}${e.type ? ` — ${esc(e.type)}` : ''}">${esc(e.name)}</span>
        <span class="value dim">${e.kind === 'stance' ? 'stance' : `L${e.level ?? '—'}`}</span>
      </div>
      ${note ? `<div class="dashtalent mnote" title="${esc(note)}">${hasTokens(note)
    ? this.#renderedProse(note) : esc(note)}</div>` : ''}`;
    };
    return `<section class="panel">
      <h3>Readied maneuvers</h3>
      ${disciplines.map((d) => `
        <h4 class="subhead">${esc(d.name)}</h4>
        <div class="rowlist">${d.readied.map((e) => row(e, d.notes)).join('')}</div>`).join('')
    || '<p class="empty">Nothing readied — tick maneuvers on the Maneuvers tab.</p>'}
    </section>`;
  }

  /**
   * The sphere talents, one clamped line each, grouped by side -- a reference
   * the table can scan without opening the training grids.
   */
  #dashTalentsCard() {
    const t = this.#model.data.training || {};
    const line = (text) => `<div class="dashtalent" title="${esc(text)}">${hasTokens(text)
      ? this.#renderedProse(text) : esc(text)}</div>`;
    const side = (key, label) => {
      const s = t[key];
      if (!s) return '';
      const texts = [];
      for (const cls of s.classes || []) {
        if (cls.blendedMirror) continue;
        for (const lv of cls.levels || []) {
          const v = String(lv.talent || '').trim();
          if (v) texts.push(v);
        }
      }
      for (const b of s.bonusTalents || []) {
        const v = String(b.talent || '').trim();
        if (v) texts.push(v);
      }
      for (const e of s.tradition?.entries || []) {
        const v = String(e.talent || '').trim();
        if (v) texts.push(v);
      }
      if (!texts.length) return '';
      return `<h4 class="subhead">${label} <span class="badge">${texts.length}</span></h4>
        ${texts.map(line).join('')}`;
    };
    const body = `${side('combat', 'Combat')}${side('magic', 'Magic')}`;
    return `<section class="panel">
      <h3>Talents</h3>
      ${body || '<p class="empty">No talents yet — they are written on Spheres &amp; Magic.</p>'}
      ${body ? '<p class="hint">Hover a line for its full text; the training grids are on Spheres &amp; Magic.</p>' : ''}
    </section>`;
  }

  #detailsPanel() {
    const c = this.#model.data;
    return `<section class="panel details">
      <h3>Details</h3>
      <div class="fieldgrid">
        ${this.#field('Character name', this.#text('identity.name', c.identity.name))}
        ${this.#field('Player', this.#text('identity.player', c.identity.player))}
        ${this.#field('Race', this.#text('identity.race', c.identity.race))}
        ${this.#field('Variant', this.#text('identity.variant', c.identity.variant))}
        ${this.#field('Level', this.#num('identity.level', c.identity.level))}
        ${this.#field('Size', this.#select('identity.size', c.identity.size, Object.keys(SIZE_MODIFIERS)))}
        ${this.#field('Alignment', this.#text('identity.alignment', c.identity.alignment))}
        ${this.#field('Deity', this.#text('identity.deity', c.identity.deity))}
        ${this.#field('Gender', this.#text('identity.gender', c.identity.gender))}
        ${this.#field('Age', this.#text('identity.age', c.identity.age))}
        ${this.#field('Height', this.#text('identity.height', c.identity.height))}
        ${this.#field('Weight', this.#text('identity.weight', c.identity.weight))}
        ${this.#field('Mythic path', this.#text('identity.mythicPath', c.identity.mythicPath))}
        ${this.#field('Mythic tier (auto)', `<span class="value" title="From level; override on Feats & Mythic">${c.identity.mythicTier ?? 0}</span>`)}
        ${this.#field('Hero points', `<span class="pair">
          ${this.#num('identity.heroPoints.current', c.identity.heroPoints?.current ?? 0)}
          <span>/</span>${this.#num('identity.heroPoints.max', c.identity.heroPoints?.max ?? 3)}</span>`)}
        ${this.#field('Portrait URL', this.#text('identity.image', c.identity.image, 'https://…'))}
      </div>
      ${this.#characterColorRow(c.identity.color)}
    </section>`;
  }

  /**
   * The character's own colour.
   *
   * It is applied as the sheet's accent, which is the one colour every
   * unstyled thing already reads -- panel headings, pips, the marks on
   * formula fields -- so choosing it here colours the character everywhere
   * without a second setting. Blank keeps the theme's own gold.
   */
  #characterColorRow(value) {
    const hex = normalizeHex(value);
    return `<div class="tstyle-row charcolor">
      <span class="tlabel">Character colour</span>
      <div class="swatches" role="group" aria-label="Character colour">
        <button class="swatch none" data-charswatch data-hex=""
          title="Theme default" aria-label="Theme default" aria-pressed="${hex ? 'false' : 'true'}"></button>
        ${TRACKER_PALETTE.map(([h, name]) => `<button class="swatch" data-charswatch data-hex="${h}"
          style="background:${h}" title="${esc(name)} ${h}" aria-label="${esc(name)}"
          aria-pressed="${hex === h ? 'true' : 'false'}"></button>`).join('')}
      </div>
      <input class="mono hexin" data-charhex value="${esc(hex || '')}" placeholder="#rrggbb"
        maxlength="7" aria-label="Character colour hex">
      <input type="color" data-charpick value="${esc(hex || THEME_ACCENT.hex)}" aria-label="Character colour picker">
      <span class="hint">Tints the whole sheet, and is what an unstyled tracker or meter is drawn in.</span>
    </div>`;
  }

  /**
   * Push the character's colour onto the host element, where it overrides the
   * theme's accent for everything inside the shadow root. Removing it hands
   * the theme back its own.
   */
  #applyCharacterColor() {
    const hex = normalizeHex(this.#model?.data?.identity?.color);
    const vars = ['--cs-accent', '--cs-accent-soft', '--cs-formula', '--cs-formula-strong'];
    if (!hex) { vars.forEach((v) => this.style.removeProperty(v)); return; }
    this.style.setProperty('--cs-accent', hex);
    this.style.setProperty('--cs-accent-soft', rgba(hex, 0.14));
    this.style.setProperty('--cs-formula', rgba(hex, 0.40));
    this.style.setProperty('--cs-formula-strong', rgba(hex, 0.85));
  }

  /**
   * The specialty: what the character did before, the feat it grants and its
   * perks. The feat is the same field as the Granted feats row on Feats &
   * Mythic -- one home, seen from two places.
   */
  #specialtyPanel() {
    const c = this.#model.data;
    const perks = c.identity.specialtyPerks || [];
    return `<section class="panel">
      <h3>Specialty</h3>
      <div class="fieldgrid two">
        ${this.#field('Specialty', this.#text('identity.specialty', c.identity.specialty, 'Chef, Gambling Villain…'))}
        ${this.#field('Specialty feat', this.#text('grantedFeats.specialty.name', c.grantedFeats?.specialty?.name, 'Which feat?'))}
      </div>
      <div class="tablewrap" style="margin-top:8px"><table class="perks">
        <thead><tr><th>Perk</th><th></th></tr></thead>
        <tbody>${perks.map((p, i) => `<tr>
          <td>${this.#prose(`data-item="identity.specialtyPerks|${i}|self"`, p, 1, 'grow')}</td>
          ${this.#rowTools('identity.specialtyPerks', i)}
        </tr>`).join('')}
        ${perks.length ? '' : '<tr><td colspan="2" class="empty">No perks yet.</td></tr>'}
        </tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton('identity.specialtyPerks', 'Add perk', '')}</div>
      <p class="hint">The specialty feat is also listed under <strong>Granted feats</strong>
        on Feats &amp; Mythic; the three specialty skills are chosen on the Skills tab.</p>
    </section>`;
  }

  /**
   * Languages, against the slots the character has for them.
   *
   * One slot per point of Int bonus and one per Linguistics rank are the
   * rules; anything else that grants some is a number or a formula in Extra,
   * so a "+1 per two levels" stays true as the character levels.
   *
   * The list is edited once and read constantly, so folded down the panel is
   * the thing that gets read: every language the character speaks on one line,
   * in a box, ready to be copied into a post. Opened it is the fields again,
   * and the order is the player's -- a chip can be dragged past its
   * neighbours by the grip, which is what keeps the trade tongues at the front
   * and the dead ones at the back.
   */
  #languagesPanel() {
    const c = this.#model.data;
    const i = c.identity;
    const slots = i.languageSlots || { int: 0, linguistics: 0, extra: 0, total: 0, known: 0 };
    const langs = i.languages || [];
    const spare = slots.total - slots.known;
    const shut = !!c.uiPrefs?.collapsed?.languages;
    const spoken = [...String(i.nativeLanguages || '').split(/[,;]/), ...langs]
      .map((s) => String(s).trim()).filter(Boolean);
    const head = `<h3>Languages
        <span class="badge${spare < 0 ? ' err' : ''}" title="Known, against the slots Int, Linguistics and Extra grant">${slots.known} / ${slots.total}</span>
        <button class="disclose" data-collapse="languages" aria-expanded="${!shut}"
          title="${shut ? 'Open the list to edit it' : 'Fold it down to one line'}">${shut ? '▸' : '▾'}</button>
      </h3>`;
    if (shut) {
      return `<section class="panel collapsed">
        ${head}
        <div class="langcopy">
          <input class="ro" data-post="languages" readonly value="${esc(spoken.join(', '))}"
            placeholder="No languages yet." aria-label="Every language spoken">
          <button data-copy="languages" title="Copy the whole list">Copy</button>
        </div>
      </section>`;
    }
    return `<section class="panel">
      ${head}
      <div class="fieldgrid">
        ${this.#field('Native', this.#text('identity.nativeLanguages', i.nativeLanguages, 'Common'))}
        ${this.#field('From Int', `<span class="value" title="One per point of Intelligence bonus">${slots.int}</span>`)}
        ${this.#field('From Linguistics', `<span class="value" title="One per rank">${slots.linguistics}</span>`)}
        ${this.#field('Extra slots', this.#exprField('data-set="identity.languageExtra"', i.languageExtra, {
          width: '100%',
          value: typeof i.languageExtra === 'string' && i.languageExtra.trim() ? slots.extra : null,
          error: slots.extraError,
          title: 'A number, or a formula — e.g. floor(level / 2)',
        }))}
      </div>
      <div class="langlist" data-langlist>
        ${langs.map((l, li) => `<span class="lang" data-langdrop="${li}">
          <span class="grip" data-langgrip title="Drag to reorder">&#10495;</span>
          ${this.#itemText('identity.languages', li, 'self', l, 'Language')}
          <button class="danger tiny" data-remove="identity.languages|${li}" aria-label="Remove">×</button>
        </span>`).join('')}
      </div>
      <div class="pair" style="margin-top:8px">
        ${this.#addButton('identity.languages', 'Add language', '')}
        <span class="hint">${spare > 0 ? `${spare} slot${spare === 1 ? '' : 's'} spare`
    : spare < 0 ? `${-spare} over the slots` : 'every slot used'}</span>
      </div>
      <p class="hint">Native languages are free. One slot per point of Int bonus, one per
        Linguistics rank; <strong>Extra</strong> takes a number or a formula for what a race
        or a trait adds.</p>
    </section>`;
  }

  #abilityScoresPanel() {
    const c = this.#model.data;
    const cs = this.#model.conditionState;
    const built = !!c.statsBuild;
    return `<section class="panel">
      <h3>Ability scores</h3>
      <div class="ability-head">
        <span>&nbsp;</span><span>Score</span><span>Mod</span>
        <span class="h-temp">Temp</span><span class="h-temp">Mod</span><span>Roll</span>
      </div>
      <div class="abilities">
        ${ABILITIES.map((k) => {
          const a = c.abilities[k];
          const moved = cs.changed && cs.deltas[k];
          return `<div class="ability">
            <span class="ab">${ABILITY_LABELS[k]}</span>
            ${built
              ? `<span class="mod">${a.score}</span>`
              : `<input type="number" value="${a.score}" data-set="abilities.${k}.score" aria-label="${ABILITY_LABELS[k]} score">`}
            <span class="mod">${fmt(a.mod)}</span>
            ${moved
              ? `<span class="mod temp-score conditioned" title="${a.tempScore} before conditions">${cs.scores[k]}</span>`
              : built
                ? `<span class="mod temp-score">${a.tempScore}</span>`
                : `<input class="temp-score" type="number" value="${a.tempScore}" data-set="abilities.${k}.tempScore" aria-label="${ABILITY_LABELS[k]} temporary score">`}
            <span class="mod temp temp-mod${moved ? ' conditioned' : ''}"
              ${moved ? `title="${fmt(a.totalMod)} before conditions"` : ''}>${
              moved ? fmt(a.totalMod + cs.deltas[k]) : fmt(a.totalMod)}</span>
            ${this.#rollButton('ability', k, `a ${ABILITY_LABELS[k]} check`, cs)}
          </div>`;
        }).join('')}
      </div>
      ${built ? `<p class="hint" style="margin-top:8px">
        Scores are built from point buy, race, ABP and the rest —
        edit them on the <strong>Stats</strong> tab.
      </p>` : ''}
      ${cs.changed && ABILITIES.some((k) => cs.deltas[k]) ? `<p class="hint warn">
        Scores and modifiers in red are what the ticked conditions leave —
        the temporary score less the condition's penalty, and its modifier.
      </p>` : ''}
    </section>`;
  }

  #acPanel() {
    const d = this.#model.data.defenses;
    const cs = this.#model.conditionState;
    const cell = (key, base) => `<td class="num total">${base}${
      cs.changed && cs.delta[key] ? `<span class="now" title="With conditions applied">now ${cs.adjusted[key]}</span>` : ''}</td>`;
    return `<section class="panel">
      <h3>Armor class</h3>
      <div class="tablewrap"><table class="defense">
        <thead><tr><th></th><th class="num">Total</th>
          <th class="num" title="Your own flat bonus">Misc</th>
          ${this.#sheetBonusHead()}</tr></thead>
        <tbody>
          <tr><td>Armor Class</td>${cell('ac', d.ac)}
            <td class="num">${this.#num('defenses.miscAC', d.miscAC, 'style="width:3.6rem"')}</td>
            ${this.#sheetBonusCell('defenses.ac')}</tr>
          <tr><td>Touch</td>${cell('touch', d.touch)}
            <td class="num" title="Misc AC is armor-side, so it does not reach touch">—</td>
            ${this.#sheetBonusCell('defenses.touch')}</tr>
          <tr><td>Flat-footed</td>${cell('flatFooted', d.flatFooted)}
            <td class="num">${this.#roField(d.miscAC || 0, 'The Misc AC above — armour-side, so flat-footed keeps it', 'style="width:3.6rem"')}</td>
            ${this.#sheetBonusCell('defenses.flatFooted')}</tr>
          <tr><td>CMD</td>${cell('cmd', d.cmd)}
            <td class="num">${this.#num('defenses.miscCMD', d.miscCMD, 'style="width:3.6rem"')}</td>
            ${this.#sheetBonusCell('defenses.cmd')}</tr>
        </tbody>
      </table></div>
      ${cs.acVsMelee || cs.acVsRanged ? `<p class="hint warn">
        ${cs.acVsMelee ? `${fmt(cs.acVsMelee)} AC against melee` : ''}${cs.acVsMelee && cs.acVsRanged ? ', ' : ''}${
          cs.acVsRanged ? `${fmt(cs.acVsRanged)} AC against ranged` : ''} from conditions, on top of the numbers above.
      </p>` : ''}
      <div class="statline"><span class="label">AC ability</span>
        <span class="value pair">${this.#abilitySelect('defenses.acStat1', d.acStat1)}
          <span class="hint">+</span>${this.#abilitySelect('defenses.acStat2', d.acStat2)}</span></div>
      <div class="statline"><span class="label">Uncanny dodge</span>
        <span class="value">${this.#check('defenses.uncannyDodge', d.uncannyDodge)}</span></div>
      <div class="statline"><span class="label">Spell resistance</span>
        <span class="value">${this.#text('defenses.spellResistance', d.spellResistance)}</span></div>
      <div class="statline"><span class="label">DR</span>
        <span class="value">${this.#text('defenses.dr', d.dr)}</span></div>
      <div class="statline"><span class="label">Immunities</span>
        <span class="value">${this.#text('defenses.immunities', d.immunities)}</span></div>
      <div class="statline"><span class="label">Resistance</span>
        <span class="value">${this.#text('defenses.resistance', d.resistance)}</span></div>
      ${this.#sheetBonusHint('Deflection, natural armor, insight and the rest')}
    </section>`;
  }

  #savesPanel() {
    const s = this.#model.data.saves;
    const cs = this.#model.conditionState;
    return `<section class="panel">
      <h3>Saving throws</h3>
      <div class="tablewrap"><table class="saves">
        <thead><tr><th>Save</th><th class="num">Total</th>
          <th class="num" title="Computed from the class table (gestalt)">Base</th>
          <th>Ability</th><th title="A second ability that adds its modifier">2nd</th>
          ${this.#sheetBonusHead()}</tr></thead>
        <tbody>${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => `
          <tr>
            <td>${label}</td>
            <td class="num total"><span class="rollpair">${fmt(s[k].total)}${
              cs.changed && cs.delta[k] ? `<span class="now" title="With conditions applied">now ${fmt(cs.adjusted[k])}</span>` : ''
}${this.#rollButton('save', k, `a ${label} save`, cs)}</span></td>
            <td class="num" title="From the Classes table">${s[k].base}</td>
            <td>${this.#abilitySelect(`saves.${k}.stat1`, s[k].stat1)}</td>
            <td>${this.#abilitySelect(`saves.${k}.stat2`, s[k].stat2)}</td>
            ${this.#sheetBonusCell(`saves.${k}.total`)}
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Base saves follow the Classes table.</p>
      ${this.#sheetBonusHint('Resistance bonuses, ABP and traits')}
    </section>`;
  }

  #attackPanel() {
    const c = this.#model.data;
    const cs = this.#model.conditionState;
    const now = (key) => (cs.changed && cs.delta[key]
      ? `<span class="now" title="With conditions applied">now ${fmt(cs.adjusted[key])}</span>` : '');
    return `<section class="panel">
      <h3>Attack</h3>
      ${this.#lineHtml('Melee', `${fmt(c.attack.totalMelee)}${now('melee')}${
        this.#rollButton('mode', 'melee', 'a melee attack', cs)}`, true)}
      ${this.#lineHtml('Ranged', `${fmt(c.attack.totalRanged)}${now('ranged')}${
        this.#rollButton('mode', 'ranged', 'a ranged attack', cs)}`, true)}
      ${this.#lineHtml('CMB', `${fmt(c.attack.totalCmb)}${now('cmb')}${
        this.#rollButton('mode', 'cmb', 'a combat maneuver', cs)}`, true)}
      ${this.#line('Iteratives', c.attack.iterative)}
      ${(() => {
    // BAB comes off the class table now, gestalt-style, so the field is a
    // read-out with an override behind it -- the same arrangement as a class's
    // Levels, and for the same reason.
    const base = Number(c.attack.babBase) || 0;
    const over = c.attack.babOverride == null ? null : Number(c.attack.babOverride);
    const why = over == null
      ? `From the Classes table: the best BAB progression among the classes on each level, summed and floored. Type a number to override it.`
      : `Pinned at ${over}. The Classes table comes to ${base}; clear the box to go back to that.`;
    return this.#lineHtml('Base attack bonus', `<input type="number"
      class="autonum${over == null ? ' auto' : ''}" value="${over ?? ''}" placeholder="${base}"
      data-set="attack.babOverride" data-kind="number-or-null" style="width:4.2rem"
      title="${esc(why)}" aria-label="Base attack bonus">`);
  })()}
      ${this.#editLine('Misc attack bonus', 'attack.miscBonus', c.attack.miscBonus)}
      ${cs.changed && cs.delta.damage ? `<p class="hint warn">${fmt(cs.delta.damage)} on weapon damage rolls from conditions.</p>` : ''}
      <div class="tablewrap" style="margin-top:8px"><table class="attackmodes">
        <thead><tr><th>Mode</th>
          <th class="num" title="An alternate is this attack with the ability beside it in the slot instead">Total</th>
          <th>Ability</th><th>2nd ability</th></tr></thead>
        <tbody>${ATTACK_MODES.map((k) => {
          const alt = ALT_ATTACK_OF[k];
          const shut = !!this.#model.data.uiPrefs?.collapsed?.[`atk:${alt || k}`];
          // An alternate is folded into the attack it is an alternate of: the
          // caret is on that row and says what is under it, so a sheet with
          // nothing but a finesse swap does not carry six rows to say three.
          if (alt && shut) return '';
          const total = attackModeTotal(c, k) ?? 0;
          const delta = cs.changed && cs.delta[k] ? cs.delta[k] : 0;
          const altOf = ATTACK_MODES.find((m) => ALT_ATTACK_OF[m] === k);
          const altTotal = altOf ? attackModeTotal(c, altOf) ?? 0 : 0;
          const altStat = altOf ? (c.attack.modes[altOf]?.stat1 || '—') : '';
          const caret = altOf ? `<button class="disclose" data-collapse="atk:${k}"
            aria-expanded="${!shut}" title="${esc(shut
    ? `Show the alternate — ${altStat}, ${fmt(altTotal)}`
    : 'Fold the alternate back in')}">${shut ? '▸' : '▾'}</button>` : '';
          return `
          <tr class="${alt ? 'altrow' : ''}"><td>${caret}${ATTACK_MODE_LABELS[k]}</td>
            <td class="num total"><span class="rollpair">${fmt(total)}${
              delta ? `<span class="now" title="With conditions applied">now ${fmt(total + delta)}</span>` : ''
}${this.#rollButton('mode', k, `${ATTACK_MODE_LABELS[k].toLowerCase()} attacks`, cs)}</span></td>
            <td>${this.#abilitySelect(`attack.modes.${k}.stat1`, c.attack.modes[k]?.stat1)}</td>
            <td>${this.#abilitySelect(`attack.modes.${k}.stat2`, c.attack.modes[k]?.stat2)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">Base attack bonus is the Classes table's, gestalt-style: the best
        progression among the classes present at each level, summed and floored once.
        An <strong>alternate</strong> is the same attack with a different
        ability in the slot — Dex for a finessed blade, Wis for a monk's fist — so it
        carries the same BAB, misc and size, and the same import reconciliation. Each one
        folds into the attack it belongs to; the caret says what is under it.</p>
    </section>`;
  }

  /**
   * Movement, with the bonus as a formula field.
   *
   * The bonus is where class features land -- fast movement, a boots-of-
   * striding enhancement -- and those are rules, so the field takes one:
   * `floor(level / 3) * 10` stays right as the character levels. The final
   * column is the model's, so it moves the moment either field does.
   */
  #speedPanel() {
    const c = this.#model.data;
    const cs = this.#model.conditionState;
    const speeds = c.identity.speeds || [];
    return `<section class="panel">
      <h3>Speed</h3>
      <div class="tablewrap"><table class="speeds">
        <thead><tr><th>Type</th><th class="num">Base</th>
          <th class="num" title="A number, or a formula — e.g. floor(level / 3) * 10">Bonus</th>
          <th class="num">Final</th><th></th></tr></thead>
        <tbody>${speeds.map((sp, i) => {
          const adj = cs.speeds[i];
          const slowed = cs.changed && adj && adj.adjusted !== adj.final;
          return `<tr>
          <td>${this.#itemText('identity.speeds', i, 'type', sp.type, 'Land')}</td>
          <td class="num">${this.#itemNum('identity.speeds', i, 'base', sp.base)}</td>
          <td class="num">${this.#exprField(`data-item="identity.speeds|${i}|bonus"`, sp.bonus, {
            width: '5.6rem',
            value: typeof sp.bonus === 'string' && sp.bonus.trim() ? sp.bonusNum : null,
            error: sp.bonusError,
            title: 'A number, or a formula — e.g. floor(level / 3) * 10 for fast movement',
          })}</td>
          <td class="num total">${Number(sp.final) || 0} ft.${
            slowed ? `<span class="now" title="With conditions applied">now ${adj.adjusted} ft.</span>` : ''}</td>
          <td class="tools quiet">${this.#rowRemoveButton('identity.speeds', i, `Remove ${sp.type || 'this movement'}`)}</td>
        </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton('identity.speeds', 'Add movement', { type: '', base: 30, bonus: 0 })}</div>
      <p class="hint">Bonus takes a formula, so fast movement can be written as the rule
        it is — <code>floor(level / 3) * 10</code> — and keep up with the level.</p>
    </section>`;
  }

  /**
   * Weapon and armor proficiencies, as the lists a class hands them out in.
   *
   * The weapon side is the same four terms the Gear weapon rows carry --
   * familiarity, handedness, weapon group, and the weapon itself -- so a row
   * there can be read against this and say when it is not covered. Armor is
   * its weights and shields their kinds; the chips are toggles, and specific
   * weapons are typed in like languages.
   */
  #proficienciesPanel() {
    const p = this.#model.data.identity.proficiencies || {};
    const chips = (list, options, title = '') => `<div class="chips" role="group"${title ? ` aria-label="${esc(title)}"` : ''}>
      ${options.map((o) => `<button class="chip-toggle" data-action="prof-toggle" data-list="${list}"
        data-value="${esc(o)}" aria-pressed="${(p[list] || []).includes(o)}">${esc(o)}</button>`).join('')}
    </div>`;
    const row = (label, body, hint = '') => `<div class="profrow">
      <span class="tlabel"${hint ? ` title="${esc(hint)}"` : ''}>${esc(label)}</span>${body}</div>`;
    const weapons = p.weapons || [];
    const named = weapons.filter((w) => String(w).trim());
    // The named weapons are a list a race or a class hands over once and then
    // nobody edits again, and it is the longest thing in the panel. Folded
    // away it is a sentence; opened it is the fields it was.
    const wkey = 'prof-weapons';
    const wshut = !!this.#model.data.uiPrefs?.collapsed?.[wkey];
    const summary = [
      ...(p.familiarities || []).map((f) => `${f.toLowerCase()} weapons`),
      ...(p.handedness || []).map((h) => `${h.toLowerCase()} weapons`),
      ...(p.groups || []).map((g) => `${g.toLowerCase()} group`),
      ...named,
    ];
    return `<section class="panel proficiencies">
      <h3>Proficiencies</h3>
      <div class="profgrid">
        <div class="profcol">
          <h4>Weapons</h4>
          ${row('Familiarities', chips('familiarities', WEAPON_FAMILIARITY, 'Weapon familiarities'), 'Simple, martial and exotic — the categories a class grants whole')}
          ${row('Handedness', chips('handedness', WEAPON_HANDEDNESS, 'Weapon handedness'), '"All light weapons", "all one-handed weapons" — as some classes and traits grant them')}
          ${row('Weapon groups', chips('groups', WEAPON_GROUPS.filter((g) => g !== 'Veil'), 'Weapon groups'), 'The fighter weapon groups')}
        </div>
        <div class="profcol">
          <h4>Armor</h4>
          ${row('Armor', chips('armor', ARMOR_PROFICIENCIES, 'Armor proficiencies'), 'Unarmored is its own proficiency in some systems; light, medium and heavy are the weights')}
          <h4>Shields</h4>
          ${row('Shields', chips('shields', SHIELD_PROFICIENCIES, 'Shield proficiencies'), '"None" is a statement — ticking it clears the kinds, and a kind clears it')}
          <label class="fld" style="margin-top:8px"><span>Notes
            <span class="hint">— anything the lists cannot say</span></span>
            ${this.#area('identity.proficiencies.notes', p.notes, 2)}</label>
        </div>
      </div>
      <!-- The named weapons take the whole panel rather than half of it: a
           race's list runs to a dozen, and a dozen chips in a half-width
           column is a dozen rows. -->
      <div class="profrow profwide">
        <span class="tlabel" title="Weapons named one by one — a race's or a class's list">
          <button class="disclose" data-collapse="${wkey}" aria-expanded="${!wshut}"
            title="${wshut ? 'Expand' : 'Collapse'}">${wshut ? '▸' : '▾'}</button>
          Specific weapons ${named.length ? `<span class="badge">${named.length}</span>` : ''}
        </span>
        <div class="profweaponbody">
          ${wshut
    ? `<span class="profnamed" title="Click the caret to edit them">${named.length
      ? esc(named.join(', ')) : 'none named'}</span>`
    : `<div class="langlist proflist">
            ${weapons.map((w, i) => `<span class="lang">
              ${this.#itemText('identity.proficiencies.weapons', i, 'self', w, 'Weapon')}
              <button class="danger tiny" data-remove="identity.proficiencies.weapons|${i}" aria-label="Remove">×</button>
            </span>`).join('')}
            ${this.#addButton('identity.proficiencies.weapons', 'Add weapon', '')}
          </div>`}
        </div>
      </div>
      <p class="hint">${summary.length
    ? `Proficient with ${esc(summary.join(', '))}. `
    : 'No weapon proficiencies recorded. '}A weapon on Equipment is read against these — by its
        familiarity, handedness, group, name and <strong>As</strong> (the base weapon it is) — and marked
        when nothing covers it; a veil weapon is proficient by the [Enhanced] rule, and a row's own
        <strong>Proficient</strong> field overrides all of it for Custom Training and the like. The −4 stays yours to write.</p>
    </section>`;
  }

  #carryPanel() {
    const c = this.#model.data;
    return `<section class="panel">
      <h3>Carrying capacity</h3>
      ${['light', 'medium', 'heavy', 'offGround', 'pushDrag'].map((k) => this.#line(
        k === 'offGround' ? 'Off ground' : k === 'pushDrag' ? 'Push / drag' : k[0].toUpperCase() + k.slice(1),
        c.carry?.[k] != null ? `${c.carry[k]} lbs` : '—',
      )).join('')}
      ${this.#line('Currently carried', `${c.carry?.carried ?? 0} lbs`)}
      ${this.#editLine('Ant Haul multiplier', 'carry.antHaul', c.carry?.antHaul ?? 1)}
      ${this.#editLine('Carry Str bonus', 'carry.strBonus', c.carry?.strBonus ?? 0)}
      <div class="statline"><span class="label">Quadruped</span>
        <span class="value">${this.#check('carry.quadruped', c.carry?.quadruped)}</span></div>
    </section>`;
  }

  /* ---------------- classes (gestalt) ---------------- */

  /**
   * The class table, and the levels each class actually runs for.
   *
   * Levels is a read-out before it is a field: the number is how often the
   * Planner features that class at or below the character's own level, which
   * is what every other tab means by "class level". Left alone it stays that
   * count and moves when the Planner does; a number typed in pins it instead,
   * and clearing the box hands it back.
   *
   * The gestalt summary under the table is for a character running more than
   * one class track. On a single track there is no best-of to take, so the
   * same three numbers are said without the gestalt language.
   */
  #classesPanel() {
    const c = this.#model.data;
    const g = c.gestalt || { saves: {} };
    const sv = (k) => g.saves?.[k] || {};
    const level = Number(c.identity.level) || 0;
    const gestalt = (c.progression?.tracks ?? 1) > 1;
    // The sub-system picker: a row of toggles under the class it belongs to.
    // Marking a system badges its tabs in the ⚙ manager and puts them on the
    // session view's bar before anything is typed into them.
    const sysButton = (x, i) => {
      const n = (x.systems || []).length;
      const open = this.#openClassSystems === i;
      return `<button data-action="class-systems" data-index="${i}" aria-expanded="${open}"
        title="Mark the sub-systems this class uses — they light their tabs up in the ⚙ manager and on the session view">
        ${open ? '▾' : '▸'} ${n || '—'}</button>`;
    };
    const sysPicker = (x, i) => {
      if (this.#openClassSystems !== i) return '';
      const on = new Set(x.systems || []);
      const known = new Set(GAME_SYSTEMS.map((s) => s.id));
      const extra = [...on].filter((id) => !known.has(id));
      return `<tr class="syspicker"><td colspan="11">
        <p class="hint" style="margin:2px 0 6px">
          The machinery ${esc(x.name || 'this class')} plays with. A marked system shows
          <em>marked</em> on its tabs in the ⚙ manager and joins the session view's bar,
          even before anything is typed into it.
        </p>
        <div class="pair" style="flex-wrap:wrap">
          ${GAME_SYSTEMS.map((s) => `<button data-action="class-system-toggle" data-index="${i}"
            data-system="${s.id}" aria-pressed="${on.has(s.id)}">${esc(s.label)}</button>`).join('')}
          ${extra.map((id) => `<button data-action="class-system-toggle" data-index="${i}"
            data-system="${esc(id)}" aria-pressed="true"
            title="A tag from an extension pack this app has no tab for">${esc(id)}</button>`).join('')}
        </div>
      </td></tr>`;
    };
    return `<section class="panel span2">
      <h3>Classes</h3>
      <div class="tablewrap"><table class="classes">
        <colgroup><col class="cls"><col class="lvl"><col class="hd"><col class="bab">
          <col class="save"><col class="save"><col class="save">
          <col class="ranks"><col class="arch"><col class="sys"><col class="tools"></colgroup>
        <thead><tr>
          <th>Class</th>
          <th class="num" title="How many of the character's levels feature this class in the Planner; type a number to override">Levels</th>
          <th class="num">HD</th>
          <th title="Base attack progression — the best one on each level is what the character's BAB is built from">BAB</th>
          <th class="mid" title="Good Fortitude">Fort</th><th class="mid" title="Good Reflex">Ref</th><th class="mid" title="Good Will">Will</th>
          <th class="num" title="Skill ranks per level">Ranks</th>
          <th>Archetypes</th>
          <th title="The sub-systems this class uses (Spheres, Path of War, psionics…)">Systems</th><th></th>
        </tr></thead>
        <tbody>${c.classes.map((x, i) => {
          const auto = Number(x.gestaltLevels) || 0;
          const over = x.levelsOverride == null ? null : Number(x.levelsOverride);
          const why = over == null
            ? `Featured on ${auto} of ${level} level${level === 1 ? '' : 's'} in the Planner. Type a number to override it.`
            : `Pinned at ${over}. The Planner features it on ${auto} of ${level}; clear the box to go back to that.`;
          return `<tr>
          <td>${this.#itemText('classes', i, 'name', x.name)}</td>
          <td class="num"><input type="number" class="autonum${over == null ? ' auto' : ''}"
            value="${over ?? ''}" placeholder="${auto}" title="${esc(why)}"
            data-item="classes|${i}|levelsOverride" data-kind="number-or-null"
            aria-label="Levels of ${esc(x.name || 'this class')}"></td>
          <td class="num">d${val(x.hd)}</td>
          <td>${(() => {
    // The progression, not a bonus: what the class adds to BAB per level.
    // Kept as the fraction the rules state it in, because that is what the
    // gestalt sum adds up and floors.
    const rate = Number(x.bab) || 0;
    const known = BAB_RATES.some(([v]) => v === rate);
    const opts = known ? BAB_RATES : [...BAB_RATES, [rate, String(rate)]];
    return `<select data-item="classes|${i}|bab" data-kind="number"
      aria-label="BAB progression for ${esc(x.name || 'this class')}">
      ${opts.map(([v, label]) => `<option value="${v}"${v === rate ? ' selected' : ''}>${label}</option>`).join('')}
    </select>`;
  })()}</td>
          <td class="mid">${this.#itemCheck('classes', i, 'goodFort', x.goodFort)}</td>
          <td class="mid">${this.#itemCheck('classes', i, 'goodRef', x.goodRef)}</td>
          <td class="mid">${this.#itemCheck('classes', i, 'goodWill', x.goodWill)}</td>
          <td class="num">${this.#itemNum('classes', i, 'skillRanks', x.skillRanks)}</td>
          <td>${(Array.isArray(x.archetypeStack) && x.archetypeStack.length) ? `<span class="pills">${x.archetypeStack.map((a) => `
            <span class="pill" title="${esc(`${a.name} — an archetype added from an extension.${a.removedCells?.length ? ` Replaced ${[...new Set(a.removedCells.map((r) => r.name))].join(', ')}.` : ''}${a.touches?.length ? ` Touches: ${a.touches.join(', ')}.` : ''} × removes it and puts the class's own features back.`)}">
              ${esc(a.name)}<button data-action="arch-remove" data-class="${esc(x.name)}" data-name="${esc(a.name)}" aria-label="Remove ${esc(a.name)}">×</button>
            </span>`).join('')}</span>` : ''}${this.#itemText('classes', i, 'archetypes', x.archetypes)}</td>
          <td class="mid">${sysButton(x, i)}</td>
          ${this.#rowTools('classes', i)}
        </tr>${sysPicker(x, i)}`;
        }).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton('classes', 'Add class', {
        name: 'New class', hd: 8, bab: 0.75, goodFort: false, goodRef: false,
        goodWill: false, skillRanks: 4, archetypes: '', levelsOverride: null, systems: [],
      })}</div>
      <div class="fieldgrid" style="margin-top:8px">
        <div class="statline"><span class="label">Save bases${gestalt ? ' (gestalt)' : ''}</span>
          <span class="value">Fort ${sv('fortitude').base ?? 0} &middot;
            Ref ${sv('reflex').base ?? 0} &middot; Will ${sv('will').base ?? 0}</span></div>
        <div class="statline"><span class="label">HP / level${gestalt ? ' (best HD)' : ''}</span>
          <span class="value">d${g.hpPerLevel || 0}</span></div>
        <div class="statline"><span class="label">Skill ranks / level${gestalt ? ' (best)' : ''}</span>
          <span class="value">${g.ranksPerLevel || 0}</span></div>
      </div>
      <p class="hint">
        ${gestalt ? `Gestalt: each level takes the best progression among the classes present that
        level (from the Planner). Good saves give +2 once plus &frac12;/level; poor give &#8531;/level.`
    : `Good saves give +2 once plus &frac12;/level; poor give &#8531;/level.`}
        These bases drive the Saves panel automatically.
      </p>
    </section>`;
  }

  #field(label, control) {
    return `<label class="fld"><span>${esc(label)}</span>${control}</label>`;
  }

  /* ----- the import offset, as a field -----
   * AC, touch, flat-footed, CMD and the three saves all carry a reconciliation
   * offset: everything the Google formulas added that the export could not
   * show. Left hidden it is the only place those bonuses live and there is no
   * way to add one, so it is an ordinary editable column here.
   */

  #sheetBonusHead() {
    return '<th class="num" title="Bonuses the source sheet added through formulas the export could not show — and where a new one goes">Other</th>';
  }

  #sheetBonusCell(key) {
    return `<td class="num"><input type="number" value="${this.#model.offsetOf(key)}"
      data-offset="${key}" style="width:3.6rem" aria-label="Other bonuses to ${esc(key)}"></td>`;
  }

  #sheetBonusHint(examples) {
    return `<p class="hint"><strong>Other</strong> holds what the source sheet added
      through formulas that did not survive the export — ${esc(examples)}. It is the
      number that makes the import match, and the place to add your own.</p>`;
  }

  /* ---------------- hit points ---------------- */

  /**
   * Hit points, as a meter with everything that is happening to them on it.
   *
   * The bar carries three things at once: what is left, the temporary points
   * stacked past the maximum, and how much of what is left is nonlethal. Below
   * zero it stops being a bar at all -- there is nothing to fill -- so the
   * track itself goes red and glows, harder the closer the character gets to
   * the threshold where they die.
   */
  #hitPointsPanel() {
    const hp = this.#model.hpState;
    const status = hp.dead ? 'dead' : hp.dying ? 'dying' : hp.unconscious ? 'unconscious' : null;
    const signed = (n) => String(n).replace('-', '−');
    return `<section class="panel">
      <h3>Hit points
        ${hp.temp > 0 ? `<span class="badge">+${hp.temp} temp</span>` : ''}
        ${hp.nonlethal > 0 ? `<span class="badge${hp.nonlethal >= hp.effective ? ' err' : ''}">${hp.nonlethal} nonlethal</span>` : ''}
        ${this.#meterStyleButton('hp')}
      </h3>
      ${this.#meterVisual(this.#model.meterSpec('hp'))}
      ${this.#meterStyleEditor('hp')}
      <div class="hprow">
        ${this.#num('hp.current', hp.current)}<span class="hpsep">/</span>
        <span class="value" title="Base maximum + mythic bonus">${hp.max}</span>
        ${hp.temp > 0 ? `<span class="hptemp" title="Temporary hit points, spent first">+${hp.temp}</span>` : ''}
      </div>
      <div class="fieldgrid two">
        ${this.#field('Base maximum', this.#num('hp.total', this.#model.data.hp.total))}
        ${this.#field('Mythic bonus', `<span class="value">+${this.#model.mythicHp}</span>`)}
      </div>
      <div class="fieldgrid two">
        ${this.#field('Temporary', this.#num('hp.temp', hp.temp))}
        ${this.#field('Nonlethal', this.#num('hp.nonlethal', hp.nonlethal))}
      </div>
      <div class="fieldgrid two">
        ${this.#field('Death threshold +', this.#num('hp.deathBonus', hp.deathBonus))}
        ${this.#field('Dead at', `<span class="value${hp.dying ? ' bad' : ''}">${signed(hp.deathAt)}</span>`)}
      </div>
      ${status ? `<p class="hint warn">${status === 'dead' ? `Dead — at or past ${signed(hp.deathAt)}.`
        : status === 'dying' ? `Dying — ${hp.current - hp.deathAt} point${hp.current - hp.deathAt === 1 ? '' : 's'} from death at ${signed(hp.deathAt)}.`
          : hp.nonlethal >= hp.effective && hp.current > 0 ? 'Unconscious — nonlethal damage has caught up with what is left.'
            : 'Unconscious.'}</p>` : ''}
      <div class="hpactions">
        <input type="number" value="0" data-hp-amount aria-label="Amount" min="0">
        <button data-hp="damage" class="danger">Damage</button>
        <button data-hp="nonlethal">Nonlethal</button>
        <button data-hp="heal">Heal</button>
        <button data-hp="rest" class="primary">Rest</button>
      </div>
      <p class="hint">Damage spends temporary hit points first. Death comes at
        −(Con ${hp.deathBonus ? `+ ${hp.deathBonus} ` : ''}), so the threshold moves
        with Con; raise it for Death's Door and the like. “Rest” restores everything
        and resets all trackers.</p>
    </section>`;
  }

  /**
   * Conditions, as switches -- and one counter.
   *
   * All but negative levels are on or off, so a number box for each was
   * asking the player to type a 1. Each is a toggle that names what it costs;
   * the one that counts keeps its field. What they add up to is read out
   * beside the stats they move (as "now +N"), so the base stays what the
   * sheet says and the penalties are still in plain view.
   */
  #conditionsPanel() {
    const conditions = this.#model.data.conditions || {};
    const cs = this.#model.conditionState;
    const names = Object.keys(conditions).sort((a, b) => a.localeCompare(b));
    const superseded = new Set(cs.superseded.map((x) => x.name));

    const short = (info) => {
      if (!info) return '';
      const bits = [];
      const m = info.mods || {};
      if (m.attack) bits.push(`${fmt(m.attack)} atk`);
      if (m.melee) bits.push(`${fmt(m.melee)} melee`);
      if (m.ac) bits.push(`${fmt(m.ac)} AC`);
      if (m.saves) bits.push(`${fmt(m.saves)} saves`);
      if (m.skills) bits.push(`${fmt(m.skills)} skills`);
      if (m.initiative) bits.push(`${fmt(m.initiative)} init`);
      if (m.hp) bits.push(`${fmt(m.hp)} hp`);
      for (const [k, v] of Object.entries(info.ability || {})) bits.push(`${fmt(v)} ${ABILITY_LABELS[k]}`);
      for (const [k, v] of Object.entries(info.abilitySet || {})) bits.push(`${ABILITY_LABELS[k]} ${v}`);
      if (info.losesDex) bits.push('no Dex to AC');
      if (info.speed === 0) bits.push('no move');
      else if (info.speed !== undefined && info.speed < 1) bits.push('half speed');
      if (info.acVsMelee) bits.push(`${fmt(info.acVsMelee)} AC vs melee`);
      if (info.acVsRanged) bits.push(`${fmt(info.acVsRanged)} AC vs ranged`);
      return info.kind === 'count' ? `${bits.join(', ')} each` : bits.join(', ');
    };

    const chip = (name) => {
      const info = conditionInfo(name);
      const value = Number(conditions[name]) || 0;
      const on = value > 0;
      const beaten = superseded.has(name);
      const title = info ? `${info.rule}${info.notes?.length ? ` ${info.notes.map((n) => `${n[0].toUpperCase()}${n.slice(1)}.`).join(' ')}` : ''}` : '';
      const label = info?.label || name;
      if (info?.kind === 'count') {
        return `<label class="cond count${on ? ' on' : ''}" title="${esc(title)}">
          <span class="cname">${esc(label)}</span>
          <span class="ceffect">${esc(short(info))}</span>
          ${this.#num(`conditions.${name}`, value, 'min="0" style="width:3.2rem" aria-label="Negative levels"')}
        </label>`;
      }
      return `<label class="cond${on ? ' on' : ''}${beaten ? ' beaten' : ''}" title="${esc(beaten ? `${title} (Superseded by a worse condition on the same ladder.)` : title)}">
        <input type="checkbox" ${on ? 'checked' : ''} data-set="conditions.${esc(name)}" data-kind="flag" aria-label="${esc(label)}">
        <span class="cname">${esc(label)}</span>
        <span class="ceffect">${esc(short(info) || (info ? 'no numbers' : ''))}</span>
        <button class="danger tiny" data-remove-condition="${esc(name)}" title="Remove this condition from the list" aria-label="Remove ${esc(label)}">×</button>
      </label>`;
    };

    const spare = this.#model.availableConditions();
    return `<section class="panel span2 conditions">
      <h3>Conditions ${cs.active.length ? `<span class="badge err">${cs.active.length} on</span>` : ''}</h3>
      <div class="condgrid">${names.map(chip).join('')}</div>
      <div class="pair" style="margin-top:8px; flex-wrap:wrap">
        <select data-draft="condition" aria-label="Condition to add">
          <option value="">Add a condition…</option>
          ${spare.map((x) => `<option value="${esc(x.label)}">${esc(x.label)}</option>`).join('')}
        </select>
        <button data-action="add-condition">Add</button>
      </div>
      ${cs.active.length ? `<div class="condsummary">
        <strong>In effect:</strong>
        ${cs.counted.map(({ name, info, count }) => `<span class="tag">${esc(info.label || name)}${count > 1 ? ` ×${count}` : ''}</span>`).join('')}
        ${cs.superseded.length ? `<span class="hint">(${cs.superseded.map(({ info, name }) => esc(info.label || name)).join(', ')} superseded)</span>` : ''}
        ${cs.notes.length ? `<ul class="hint">${cs.notes.map((n) => `<li>${esc(n[0].toUpperCase() + n.slice(1))}.</li>`).join('')}</ul>` : ''}
      </div>` : ''}
      <p class="hint">Tick a condition and every number it moves shows what it is
        <em>now</em> beside the base — attacks, AC, saves, initiative, speed and the
        ability modifiers. The base stays as the sheet has it. Shaken, frightened and
        panicked do not stack, nor fatigued and exhausted: the worse one counts.</p>
    </section>`;
  }

  #traitsPanel() {
    const c = this.#model.data;
    const slots = c.traitSlots || {};
    const categories = [...TRAIT_CATEGORIES, ...(c.traitCategories || [])];
    const filled = (key) => !!(slots[key]?.name || slots[key]?.text || slots[key]?.category);

    const standard = ['trait1', 'trait2', 'trait3'];
    const picked = standard.filter(filled).length;
    const row = (def) => {
      const v = slots[def.key] || {};
      const locked = def.requires && !filled(def.requires);
      const isDrawback = def.kind !== 'trait';
      // The three standard picks are owed; an empty one says so.
      const owed = standard.includes(def.key) && !filled(def.key);
      const wants = locked ? `Take ${TRAIT_SLOTS.find((s) => s.key === def.requires)?.label} first`
        : owed ? 'Pick a trait' : '';
      return `<tr class="${locked ? 'lockedslot' : ''}${owed ? ' needsfill' : ''}"${owed ? ' title="A standard trait pick, still to be chosen"' : ''}>
        <td>${esc(def.label)}${def.requires ? `<div class="hint">needs ${esc(TRAIT_SLOTS.find((s) => s.key === def.requires)?.label)}</div>` : ''}</td>
        <td>${isDrawback ? '<span class="hint">—</span>'
          : this.#select(`traitSlots.${def.key}.category`, v.category, categories)}</td>
        <td>${this.#text(`traitSlots.${def.key}.name`, v.name, wants || (isDrawback ? 'Drawback' : 'Trait'))}</td>
        <td>${this.#prose(`data-set="traitSlots.${def.key}.text"`, v.text, 1, 'grow')}</td>
      </tr>`;
    };

    const race = c.raceTraits || [];
    return `<section class="panel span2">
      <h3>Traits &amp; drawbacks</h3>
      <div class="traitpair">
        <div>
          <h4 class="subhead">Character traits
            <span class="badge${picked < standard.length ? ' err' : ' ok'}">${picked} of ${standard.length} picked</span>
          </h4>
          <div class="tablewrap"><table class="traits">
            <colgroup><col class="slot"><col class="cat"><col class="tname"><col class="effect"></colgroup>
            <thead><tr><th>Slot</th><th>Category</th><th>Name</th><th>Trait / effect</th></tr></thead>
            <tbody>
              ${TRAIT_SLOTS.filter((s) => s.kind !== 'feat').map(row).join('')}
              ${(slots.additional || []).map((x, i) => `<tr>
                <td>Additional</td>
                <td>${this.#itemSelect('traitSlots.additional', i, 'category', x.category, categories)}</td>
                <td>${this.#itemText('traitSlots.additional', i, 'name', x.name, 'Trait')}</td>
                <td><span class="pair" style="width:100%">
                  ${this.#prose(`data-item="traitSlots.additional|${i}|text"`, x.text, 1, 'grow')}
                  <button class="danger" data-remove="traitSlots.additional|${i}" aria-label="Remove">×</button>
                </span></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
          <div style="margin-top:8px" class="pair">
            ${this.#addButton('traitSlots.additional', 'Add additional trait', { category: null, name: '', text: '' })}
            <input data-draft="traitCategory" placeholder="New category (e.g. Akashic)"
              value="${esc(this.#draft.traitCategory || '')}" style="max-width:14rem">
            <button data-action="add-trait-category">Add category</button>
          </div>
          <p class="hint">
            Traits 1–3 are the standard picks. Drawback 1 unlocks Trait 4, Drawback 2 unlocks
            Trait 5, and a Major Drawback buys a Drawback Feat — which is named under
            <strong>Granted feats</strong> on the Feats &amp; Mythic tab, with the other feats
            something hands you. Categories cover the standard list plus any you add
            (Akashic, Mythic, Psionic…).
          </p>
        </div>
        <div>
          <h4 class="subhead">Race traits
            <span class="badge">${race.filter((t) => String(t.name || '').trim() || String(t.text || '').trim()).length}${race.some((t) => !String(t.name || '').trim() && !String(t.text || '').trim()) ? ` of ${race.length}` : ''}</span>
            ${c.identity.race ? `<span class="hint">${esc(c.identity.race)}${c.identity.variant ? ` (${esc(c.identity.variant)})` : ''}</span>` : ''}
          </h4>
          <div class="tablewrap"><table class="racetraits">
            <thead><tr><th>Trait</th><th>Effect</th><th></th></tr></thead>
            <tbody>${race.map((t, i) => `<tr${String(t.name || '').trim() || String(t.text || '').trim() ? '' : ' class="needsfill" title="A race-trait slot still to fill"'}>
              <td>${this.#itemText('raceTraits', i, 'name', t.name, 'Darkvision')}${Array.isArray(t.replaced) && t.replaced.length
    ? ` <span class="badge player" title="${esc(`Alternate racial trait — took the place of ${t.replaced.map((r) => r.name).join(' and ')}. Removing this row does not put them back; add them again from the race's pack if you need them.`)}">alt</span>` : ''}</td>
              <td>${this.#prose(`data-item="raceTraits|${i}|text"`, t.text, 1, 'grow')}</td>
              ${this.#rowTools('raceTraits', i)}
            </tr>`).join('')}
            ${race.length ? '' : '<tr><td colspan="3" class="empty">No race traits yet — add what the race grants.</td></tr>'}
            </tbody>
          </table></div>
          <div style="margin-top:8px">${this.#addButton('raceTraits', 'Add race trait', { name: '', text: '' })}</div>
          <p class="hint">What the race hands you — a few for some, ten for others.
            Alternate racial traits go here too, in place of what they replace.</p>
        </div>
      </div>
    </section>`;
  }

  /* ---------------- stats (ability build) ---------------- */

  #statsPanel() {
    const c = this.#model.data;
    const build = c.statsBuild;
    if (!build) {
      return '<div class="grid"><section class="panel"><h3>Stats</h3><p class="empty">This character has no Stats tab in its source sheet.</p></section></div>';
    }
    const pb = this.#model.pointBuySummary();
    const unlocked = this.#model.attunementUnlocked;
    const showOptional = this.#showOptionalBuildColumns(build);
    const allCols = BUILD_PERMANENT_GROUPS.flatMap((g) => g.cols);
    // A group's columns, minus any retired one the player has not asked to see.
    // A group emptied that way drops out of the header entirely.
    const groups = BUILD_PERMANENT_GROUPS
      .map((g) => ({ ...g, cols: g.cols.filter(([k]) => showOptional[k] !== false) }))
      .filter((g) => g.cols.length);
    const permCols = groups.flatMap((g) => g.cols);

    /** The banding classes for column `i` of a group, if the group has a label. */
    const band = (g, i) => (g.label ? `grouped${i === 0 ? ' groupstart' : ''}` : '');

    const cell = (ab, key, banding = '') => {
      const entry = build[ab];
      const v = Number(entry[key]) || 0;
      if (BUILD_DERIVED_KEYS.includes(key)) {
        return `<td class="num derived ${banding}" title="From the picks below">${v || ''}</td>`;
      }
      if (key === 'attunement') {
        // On or off, worth +2. An imported value that is neither says so
        // rather than being silently rounded away by the checkbox.
        return `<td class="mid ${banding}">
          <input type="checkbox" ${v ? 'checked' : ''} data-build="${ab}|attunement" data-kind="bool"
            aria-label="${ABILITY_LABELS[ab]} attunement"
            ${unlocked ? `title="+${ATTUNEMENT_BONUS} when attuned"`
    : `disabled title="Attunement unlocks at level ${ATTUNEMENT_MIN_LEVEL}"`}>
          ${v && v !== ATTUNEMENT_BONUS ? `<span class="hint">${fmt(v)}</span>` : ''}
        </td>`;
      }
      return `<td class="num ${banding}"><input type="number" value="${v}" data-build="${ab}|${key}"></td>`;
    };

    const over = ABILITIES.filter((a) => build[a].resolved?.enhancementWasted > 0);

    return `<div class="grid">
      <div class="statpair">
      <section class="panel">
        <h3>Permanent bonuses
          ${BUILD_OPTIONAL_KEYS.map((k) => {
            const label = allCols.find(([key]) => key === k)?.[1] || k;
            const on = showOptional[k];
            return `<button data-buildcol="${k}" aria-pressed="${on}"
              title="${on ? 'Hide' : 'Show'} the ${esc(label)} column">${on ? 'Hide' : 'Show'} ${esc(label)}</button>`;
          }).join('')}
        </h3>
        <div class="tablewrap">
          <table class="build">
            <thead>
              <tr class="groups">
                <th></th>
                ${groups.map((g) => (g.label
                  ? `<th class="num grouphead" colspan="${g.cols.length + (g.sum ? 1 : 0)}" title="${esc(g.hint || '')}">
                       ${esc(g.label)}${g.cap ? ` <span class="capnote">max +${g.cap}</span>` : ''}</th>`
                  : `<th colspan="${g.cols.length}"></th>`)).join('')}
                <th></th>
              </tr>
              <tr>
                <th></th>
                ${groups.map((g) => `${g.cols.map(([, label], i) => `<th class="num ${band(g, i)}">${esc(label)}</th>`).join('')}${
                  g.sum ? '<th class="num grouped groupend" title="What the group actually contributes after its cap">Used</th>' : ''}`).join('')}
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              ${ABILITIES.map((ab) => {
                const r = build[ab].resolved || {};
                return `<tr>
                  <th scope="row">${ABILITY_LABELS[ab]}</th>
                  ${groups.map((g) => `${g.cols.map(([k], i) => cell(ab, k, band(g, i))).join('')}${
                    g.sum ? `<td class="num grouped groupend total ${r.enhancementWasted ? 'over' : ''}"
                      title="${r.enhancementWasted
    ? `${r.rawEnhancement} bought, capped at +${g.cap} — ${r.enhancementWasted} wasted`
    : `${g.cols.map(([k]) => build[ab][k] || 0).join(' + ')} = ${r[g.sum] ?? 0}`}">${r[g.sum] ?? 0}</td>` : ''}`).join('')}
                  <td class="num total">${r.total ?? 0}</td>
                </tr>`;
              }).join('')}
              <tr class="costrow">
                <th scope="row">Cost</th>
                <td class="num">${pb.total}</td>
                ${permCols.slice(1).map(() => '<td></td>').join('')}
                ${groups.filter((g) => g.sum).map(() => '<td></td>').join('')}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="statline" style="margin-top:8px">
          <span class="label">Point-buy spend</span>
          <span class="value ${pb.total > pb.budget ? 'over' : ''}">
            ${pb.total} / ${pb.budget}
            ${pb.total > pb.budget ? ` (${pb.total - pb.budget} over)` : ''}
          </span>
        </div>
        <p class="hint">
          Per ability: ${ABILITIES.map((a) => `${ABILITY_LABELS[a]} ${pb.per[a] >= 0 ? '' : ''}${pb.per[a]}`).join(' &middot; ')}
        </p>
        <p class="hint">
          <strong>ABP</strong>, <strong>Array</strong> and <strong>Level/4</strong> are
          filled in from the picks below and cannot be typed over.
          <strong>Attuned</strong> is a single +${ATTUNEMENT_BONUS}, and unlocks at
          level ${ATTUNEMENT_MIN_LEVEL}${unlocked ? '' : ' (locked)'}.
        </p>
        ${over.length ? `<p class="hint warn">
          Over the enhancement cap on ${over.map((a) => `<strong>${ABILITY_LABELS[a]}</strong>
          (${build[a].resolved.rawEnhancement} → ${ENHANCEMENT_CAP},
          ${build[a].resolved.enhancementWasted} wasted)`).join(', ')}.
        </p>` : ''}
      </section>

      <section class="panel">
        <h3>Temporary bonuses</h3>
        <div class="tablewrap">
          <table class="build">
            <thead>
              <tr class="groups"><th colspan="${BUILD_TEMPORARY.length + 4}"></th></tr>
              <tr>
                <th></th>
                ${BUILD_TEMPORARY.map(([, label]) => `<th class="num">${esc(label)}</th>`).join('')}
                <th class="num" title="Everything the temporary columns add up to">Temp</th>
                <th class="num" title="Temporary score, used by every derived stat">Score</th>
                <th class="num">Mod</th>
              </tr>
            </thead>
            <tbody>
              ${ABILITIES.map((ab) => {
                const r = build[ab].resolved || {};
                const a = c.abilities[ab];
                return `<tr>
                  <th scope="row">${ABILITY_LABELS[ab]}</th>
                  ${BUILD_TEMPORARY.map(([k]) => cell(ab, k)).join('')}
                  <td class="num">${r.temporary ? fmt(r.temporary) : '—'}</td>
                  <td class="num total">${r.tempTotal ?? 0}</td>
                  <td class="num total">${fmt(a.totalMod)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <p class="hint">
          Temporary bonuses feed the Temp Score used by every derived stat;
          the permanent Total is left untouched.
        </p>
      </section>
      </div>

      ${this.#defenceBonusPanel()}
      ${this.#abpPicksPanel()}
      ${this.#milestonePicksPanel()}
      ${this.#arrayPicksPanel()}
    </div>`;
  }

  /**
   * Which retired build columns the table shows.
   *
   * Inherent bonuses are no longer handed out, so the column is dead weight on
   * a fresh character -- but a character imported with one must not have it
   * quietly dropped. So the default is "show it only if it holds something",
   * and the header button overrides that either way, remembered per character.
   */
  #showOptionalBuildColumns(build) {
    const pref = this.#model.data.uiPrefs?.buildColumns || {};
    return Object.fromEntries(BUILD_OPTIONAL_KEYS.map((k) => [k,
      pref[k] ?? ABILITIES.some((ab) => Number(build[ab]?.[k]) || 0)]));
  }

  /**
   * The two milestone ladders, side by side.
   *
   * Level/4 and mythic are the same shape -- one ability at each of five
   * milestones -- and each was a narrow table with a column of empty space
   * beside it, so they share one panel. They are greyed independently: a level
   * you have not reached and a tier you have not reached are different things.
   */
  /**
   * Saves and AC, broken down by bonus type -- the sheet's own two tables.
   *
   * They live here rather than on the Overview because this is where the sheet
   * keeps them, and because a flat save or AC bonus has nowhere else to go: the
   * Overview shows the totals, this is where they are built.
   *
   * Every cell takes a number or a formula, so a conditional bonus can be
   * written as the rule it is rather than a number that goes stale.
   */
  #defenceBonusPanel() {
    const c = this.#model.data;
    // The ABP columns are read off the level, and each sits beside the typed
    // bonus of the same kind: the pair sums to the cap, and a typed value past
    // the cap stands alone. The group styling says so.
    const abpOf = Object.fromEntries(ABP_DEFENCE_GROUPS);
    const typedOf = Object.fromEntries(ABP_DEFENCE_GROUPS.map(([a, t]) => [t, a]));
    const groupClass = (key) => (key === 'sheet' || abpOf[key] ? ' grouped groupstart'
      : typedOf[key] ? ' grouped groupend' : '');
    const cells = (block, resolved, errors, types, bind) => types.map(([key, , flags]) => {
      const off = flags && (flags.touch === false || flags.flatFooted === false);
      const title = off ? `title="${flags.touch === false ? 'Armour-side: touch attacks ignore it' : 'Lost when flat-footed'}"` : '';
      if (abpOf[key]) {
        return `<td class="num${groupClass(key)}" ${title}>
          ${this.#roField(resolved?.[key] ?? 0, `From the ABP ladder at level ${c.identity.level}. With the typed bonus beside it, the pair stops at +${ABP_DEFENCE_CAP}.`)}</td>`;
      }
      const pairTitle = typedOf[key]
        ? ` Counts with the ABP bonus beside it up to +${ABP_DEFENCE_CAP} in all; past +${ABP_DEFENCE_CAP} on its own, it stands alone.` : '';
      const over = typedOf[key] && abpGroupTotal(resolved?.[typedOf[key]], resolved?.[key]) < (Number(resolved?.[typedOf[key]]) || 0) + (Number(resolved?.[key]) || 0);
      return `<td class="num${groupClass(key)}${over ? ' over' : ''}" ${title}>
        ${this.#exprField(bind(key), block?.[key] ?? 0, {
          width: '4.4rem',
          value: resolved?.[key],
          error: errors?.[key],
          title: 'A number, or a formula — e.g. min(str.mod - dex.mod, 3 + floor(bab / 2)).' + pairTitle,
        })}</td>`;
    }).join('');

    const head = (types) => types.map(([key, label, flags]) => `<th class="num${groupClass(key)}"
      ${flags?.touch === false ? 'title="Not counted against touch attacks"'
    : flags?.flatFooted === false ? 'title="Not counted while flat-footed"' : ''}>${esc(label)}${typedOf[key] ? `<span class="capnote"> ≤ +${ABP_DEFENCE_CAP}</span>` : ''}</th>`).join('');

    return `<section class="panel span2">
      <h3>Save &amp; AC bonuses</h3>
      <div class="tablewrap"><table class="build bonusgrid">
        <thead><tr><th></th><th class="num">Total</th>${head(SAVE_BONUS_TYPES)}</tr></thead>
        <tbody>${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => {
          const s = c.saves[k];
          return `<tr>
            <th scope="row">${label}</th>
            <td class="num total" title="Base ${s.base} + ability + these">${fmt(s.total)}</td>
            ${cells(s.bonuses, s.bonusesResolved, s.bonusErrors, SAVE_BONUS_TYPES,
              (key) => `data-set="saves.${k}.bonuses.${key}"`)}
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div class="tablewrap" style="margin-top:10px"><table class="build bonusgrid">
        <thead><tr><th></th><th class="num">Total</th>${head(AC_BONUS_TYPES)}</tr></thead>
        <tbody><tr>
          <th scope="row">AC</th>
          <td class="num total" title="Touch ${c.defenses.touch} · flat-footed ${c.defenses.flatFooted}">${c.defenses.ac}</td>
          ${cells(c.defenses.acBonuses, c.defenses.acBonusesResolved, c.defenses.acBonusErrors,
            AC_BONUS_TYPES, (key) => `data-set="defenses.acBonuses.${key}"`)}
        </tr></tbody>
      </table></div>
      <p class="hint">
        Each cell takes a number or a formula, so a conditional bonus can be written as
        the rule it is — Force Redirection's
        <code>min(str.mod - dex.mod, 3 + floor(bab / 2))</code> keeps up when BAB moves,
        where a typed-in number would not. Formulas read abilities, level, BAB and any
        name defined in prose, and show in the GM's Formula Audit.
      </p>
      <p class="hint">
        Natural-armour and enhancement bonuses do not count against <strong>touch</strong>,
        and dodge is lost while <strong>flat-footed</strong> — both follow from the column,
        so all three numbers move together. The three <strong>ABP</strong> columns follow the
        character's level along the progression's ladder and are not typed; each is paired
        with the typed bonus of the same kind (resistance, deflection, enhanced natural
        armour), and the pair adds up to at most +${ABP_DEFENCE_CAP} — unless the typed side is
        past +${ABP_DEFENCE_CAP} by itself, in which case it stands alone.
        <strong>Sheet</strong> is what the source total held beyond the columns the export
        could read; it is an ordinary field, and starts at 0 on a character built here.
      </p>
    </section>`;
  }

  #milestonePicksPanel() {
    const c = this.#model.data;
    const level = Number(c.identity.level) || 0;
    const tier = Number(c.identity.mythicTier) || 0;
    const level4 = (l) => (c.progressionPicks?.level4 || []).find((p) => p.level === l) || {};
    const rows = Math.max(LEVEL4_LEVELS.length, MYTHIC_STAT_TIERS.length);
    return `<section class="panel">
      <h3>Level/4 &amp; mythic increases</h3>
      <div class="tablewrap"><table class="build">
        <thead>
          <tr class="groups">
            <th class="num grouphead" colspan="2">Level/4 <span class="capnote">+1</span></th>
            <th class="num grouphead grouped groupstart" colspan="2">Mythic <span class="capnote">+2</span></th>
          </tr>
          <tr>
            <th class="num">Lvl</th><th>Ability</th>
            <th class="num grouped groupstart">Tier</th><th class="grouped groupend">Ability</th>
          </tr>
        </thead>
        <tbody>${Array.from({ length: rows }, (_, i) => {
          // One milestone pair per row: its number, then its ability.
          const pair = (milestone, reached, control, band) => (milestone === undefined
            ? `<td class="noslot ${band}"></td><td class="noslot ${band}"></td>`
            : `<td class="num ${band} ${reached ? '' : 'future'}">${milestone}</td>
               <td class="${band} ${reached ? '' : 'future'}">${control}</td>`);
          const l = LEVEL4_LEVELS[i];
          const t = MYTHIC_STAT_TIERS[i];
          return `<tr>
            ${pair(l, l <= level, l === undefined ? ''
              : this.#pickSelect('level4', l, 0, level4(l).ability, ABILITY_LABELS_LIST, false), '')}
            ${pair(t, t <= tier, t === undefined ? ''
              : this.#pickSelect('mythicStat', t, 0, this.#mythicPickAt(t), ABILITY_LABELS_LIST, false),
            'grouped')}
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">
        <strong>Level/4</strong> is +1 at every fourth level. <strong>Mythic</strong> is
        +2 at every even tier — the same increases as the ladder on
        <strong>Feats &amp; Mythic</strong>, either place edits the one set.
        Currently level ${level}, tier ${tier}; anything past that is greyed and does not
        count yet.
      </p>
    </section>`;
  }

  /** The ability picked for one mythic tier's +2, if any. */
  #mythicPickAt(tier) {
    return (this.#model.data.mythicStatPicks || [])
      .find((p) => Number(p.tier) === tier)?.ability;
  }

  /** A select of allowed abilities for one progression pick. */
  #pickSelect(kind, level, slot, value, allowed, disabled) {
    const opts = ['', ...allowed].map((a) => {
      const v = a || '';
      const label = a || '—';
      const sel = String(value || '').toLowerCase().slice(0, 3) === v.toLowerCase().slice(0, 3) && (a || !value);
      return `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
    return `<select data-pick="${kind}|${level}|${slot}" ${disabled ? 'disabled' : ''}>${opts}</select>`;
  }

  #abpPicksPanel() {
    const c = this.#model.data;
    const level = Number(c.identity.level) || 0;
    const picks = c.progressionPicks?.abp || [];
    const at = (l) => picks.find((p) => p.level === l) || {};
    return `<section class="panel">
      <h3>ABP — Mental &amp; Physical Prowess</h3>
      <div class="tablewrap"><table class="build">
        <thead><tr><th class="num">Lvl</th><th>Mental</th><th>Physical</th></tr></thead>
        <tbody>${ABP_LEVELS.map((l) => {
          const row = at(l);
          const future = l > level;
          // A track that gains nothing at this level has no slot at all, so
          // the cell is left empty rather than showing a dead control.
          // Levels that only raise an earlier pick show it, locked.
          const cell = (track, allowed) => {
            const levels = track === 'mental' ? MENTAL_PROWESS_LEVELS : PHYSICAL_PROWESS_LEVELS;
            if (!levels.includes(l)) return '<td class="noslot"></td>';
            const src = abpSourceLevel(track, l);
            if (src !== l) {
              return `<td class="linked" title="Raises the level ${src} choice">
                ${val(at(src)[track])} <span class="badge">from ${src}</span></td>`;
            }
            return `<td>${this.#pickSelect('abp', l, track, row[track], allowed, false)}</td>`;
          };
          return `<tr class="${future ? 'future' : ''}">
            <td class="num">${l}</td>
            ${cell('mental', PROWESS_TRACKS.mental)}
            ${cell('physical', PROWESS_TRACKS.physical)}
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">
        +2 each. The two tracks advance on different levels, so most rows offer a
        choice on one side only. Levels 11 and 12 raise the ability chosen at 6 and 7
        rather than offering a new choice. Rows above level ${level} are greyed: they
        are planned but do not count toward the score yet.
      </p>
    </section>`;
  }

  #arrayPicksPanel() {
    const c = this.#model.data;
    const level = Number(c.identity.level) || 0;
    const picks = c.progressionPicks?.array || [];
    const at = (l) => picks.find((p) => p.level === l) || { slots: [] };
    // Laid out as wrapping groups rather than a table: four picks side by side
    // needs more width than this column has, and a table would just overflow.
    return `<section class="panel">
      <h3>Optional array</h3>
      <p class="hint warn" style="margin-top:0">
        Bought separately, with Primordia shards — these do not come with the level.
      </p>
      ${ARRAY_LEVELS.map((l) => {
        const row = at(l);
        const slots = ARRAY_SLOTS[l] || [];
        return `<div class="pickgroup ${l > level ? 'future' : ''}">
          <span class="picklvl">Level ${l}</span>
          <div class="picks">
            ${slots.map((slot) => this.#pickSelect('array', l, slot, row.slots?.[slot], ABILITY_LABELS_LIST, false)).join('')}
          </div>
        </div>`;
      }).join('')}
      <p class="hint">+2 each — four picks at 8, three at 12 and 16.${c.progressionPicks?.arrayNote
        ? ` Sheet note: ${esc(String(c.progressionPicks.arrayNote).replace(/^Array \(Optional\)\s*/, '').replace(/\s+/g, ' '))}` : ''}</p>
    </section>`;
  }

  /* ---------------- skills ---------------- */

  #skillsPanel() {
    const skills = this.#model.data.skills || [];
    // Read once: every row's d20 asks what the ticked conditions do to it.
    const cs = this.#model.conditionState;
    const inUse = (s) => s.totalRanks > 0 || s.offset || s.spec || s.custom;
    // A character with no ranks anywhere -- one just started from a blank
    // sheet -- would otherwise open on an empty table with nothing to fill in,
    // so the unused-skill filter only applies once there is something it keeps.
    const showAll = this.#showAllSkills || !skills.some(inUse);
    // The list is the template's, in the template's order: rows are not
    // reordered or deleted, only hidden -- the eye at the end of each row --
    // and a hidden skill comes back under Show all, eye closed, to be reopened.
    const rows = skills
      .map((s, i) => ({ s, i }))
      // A skill the player just added has nothing in it yet, so it needs the
      // custom flag to survive the unused-skill filter and be fillable at all.
      .filter(({ s }) => this.#showAllSkills || (!s.hidden && (showAll || inUse(s))));
    const hiddenCount = skills.filter((s) => s.hidden).length;
    const key = (s) => `${s.name}|${s.spec || ''}`;
    const label = (s) => skillLabel(s.name, s.spec);
    const spec = this.#model.data.specialtySkills || {};

    const pickOptions = (filter) => skills
      .filter(filter)
      .map((s) => [key(s), label(s)]);
    const isKn = (s) => /^(Kn\.|Knowledge|Lore)/i.test(s.name);
    const isBg = (s) => BACKGROUND_SKILLS.some((b) => s.name === b || s.name.startsWith(b));

    const b = this.#model.data.skillBudget || {};
    const budgetClass = b.status === 'error' ? 'err' : b.status === 'warning' ? 'warn' : 'ok';

    return `<div class="grid">
      <section class="panel span2">
        <h3>Skill points
          <span class="badge ${budgetClass === 'err' ? 'err' : budgetClass === 'ok' ? 'ok' : ''}">
            ${b.assigned ?? 0} / ${b.available ?? 0} assigned</span>
        </h3>
        <div class="fieldgrid">
          ${this.#field('Class ranks / level (gestalt)', `<span class="value">${this.#model.data.gestalt?.ranksPerLevel ?? 0}</span>`)}
          ${this.#field('Int bonus / level', this.#num('skillBudget.intPerLevel', b.intPerLevel))}
          ${this.#field('Bonus points / level', this.#num('skillBudget.bonusPerLevel', b.bonusPerLevel))}
          ${this.#field('Total / level', `<span class="value">${b.perLevel ?? 0}</span>`)}
        </div>
        ${b.status === 'error' ? `<p class="hint warn"><strong>Too many ranks assigned:</strong>
            ${b.assigned} bought, only ${b.available} available (${-b.remaining} over).</p>`
    : b.status === 'warning' ? `<p class="hint" style="color:var(--cs-edit)">
            ${b.remaining} skill point(s) unspent.</p>`
      : '<p class="hint" style="color:var(--cs-good)">Every skill point is spent.</p>'}
        <p class="hint">
          Only <strong>Bought</strong> ranks count against the budget — specialty, gear,
          Other and sphere ranks are free. Int bonus/level is a flat metric (retroactive
          Int increases don't refund ranks unless your table rules otherwise).
        </p>
      </section>

      <section class="panel span2">
        <h3>Specialty skills</h3>
        <div class="fieldgrid">
          ${this.#field('Knowledge / Lore skill', this.#select('specialtySkills.knowledge', spec.knowledge, pickOptions(isKn)))}
          ${this.#field('Background skill', this.#select('specialtySkills.background', spec.background, pickOptions(isBg)))}
          ${this.#field('Free choice', this.#select('specialtySkills.free', spec.free, pickOptions(() => true)))}
        </div>
        <p class="hint">
          Each specialty skill gets full ranks for your level, like the sheet's Specialty
          column. Marked with ★ in the table below.
        </p>
      </section>

      <section class="panel span2">
        <h3>Skills
          <span class="badge">${rows.length} of ${skills.length}</span>
          ${hiddenCount ? `<span class="badge" title="Hidden with the eye; Show all brings them back">${hiddenCount} hidden</span>` : ''}
          <button data-action="toggle-skills" style="margin-left:8px">
            ${this.#showAllSkills ? 'Hide unused' : 'Show all'}
          </button>
        </h3>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th>Skill</th><th class="num">Total</th>
              <th class="num" title="Total ranks: min(level, bought + flags × level + spheres)">Ranks</th>
              <th class="num" title="Ranks bought with skill points">Bought</th>
              <th title="Specialty skill (full ranks)">★</th>
              <th title="Gear grants full ranks (e.g. headband)">Gear</th>
              <th title="Another source grants full ranks (class features, templates)">Other</th>
              <th class="num" title="From sphere talents">Spheres</th>
              <th>Ability</th><th class="num">Mod</th><th class="num">Misc</th>
              <th>Class</th><th>Notes</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map(({ s, i }) => `<tr class="${s.totalRanks > 0 ? 'trained' : 'untrained'}${s.hidden ? ' hiddenskill' : ''}">
                <td>${this.#skillNameCell(s, i)}</td>
                <td class="num total"><span class="rollpair">${fmt(s.bonus)}${
                  this.#rollButton('skill', i, `a ${skillLabel(s.name, s.spec) || 'skill'} check`, cs)}</span></td>
                <td class="num">${s.totalRanks}</td>
                <td class="num bought">${this.#exprField(`data-item="skills|${i}|rankSources.bought"`,
                  s.rankSources?.bought ?? 0, {
                    kind: 'rank',
                    width: '5.4rem',
                    value: s.boughtResolved,
                    error: s.boughtError,
                    title: 'Number or formula, e.g. level or floor(level-2)',
                  })}</td>
                <td class="mid">${s.specialtyFlag ? '★' : ''}</td>
                <td class="mid">${this.#itemCheck('skills', i, 'rankSources.gear', s.rankSources?.gear)}</td>
                <td class="mid">${this.#itemCheck('skills', i, 'rankSources.other', s.rankSources?.other)}</td>
                <td class="num">${s.sphereRanks || ''}</td>
                <td>${this.#itemSelect('skills', i, 'abilities.0', (s.abilities || [])[0], ABILITIES.map((k) => ABILITY_LABELS[k]))}</td>
                <td class="num">${fmt(s.abilityMod || 0)}</td>
                <td class="num bought">${this.#exprField(`data-item="skills|${i}|offset"`, s.offset ?? 0, {
                  kind: 'rank',
                  width: '5.4rem',
                  value: s.miscResolved,
                  error: s.miscError,
                  title: 'Number or formula, e.g. int.mod, skill_familiarity, floor(level/2)',
                })}</td>
                <td class="mid">${this.#itemCheck('skills', i, 'classSkill', s.classSkill)}</td>
                <td>${this.#itemText('skills', i, 'situational', s.situational)}</td>
                <td class="tools"><button data-action="toggle-skill-hidden" data-index="${i}" class="eye"
                  title="${s.hidden ? 'Hidden — show this skill again' : 'Hide this skill from the list'}"
                  aria-pressed="${!!s.hidden}" aria-label="${s.hidden ? 'Show skill' : 'Hide skill'}">${s.hidden ? '◌' : '👁'}</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px">
          ${this.#addButton('skills', 'Add skill', {
            name: '', spec: '', bonus: 0, classSkill: false, totalRanks: 0,
            ranks: {}, requiresTraining: false, armorPenalty: false, abilities: ['Int'],
            situational: '', offset: 0, importedBonus: 0,
            rankSources: { bought: 0, gear: false, other: false }, ranksOffset: 0,
            // The player's own row: this is the one skill whose name they name.
            custom: true,
          })}
        </div>
        <p class="hint">
          Total ranks = min(level, Bought + (★ + Gear + Other) × level + Spheres).
          <strong>Spheres</strong> comes from the training tab's talent counts.
          <strong>Misc</strong> holds flat bonuses from gear, traits and the like — a number, or a
          formula such as <code>int.mod</code>, <code>floor(level/2)</code>, or a name defined
          in prose like <code>skill_familiarity</code>.
        </p>
        <p class="hint">
          Only ${VARIANT_SKILLS.map((v) => `<strong>${esc(v)}</strong>`).join(', ')} and
          <strong>Perform</strong> take a variant — the highlighted slots. Write just the
          variant, or the whole <em>Craft (Weapons and Armor)</em>; either way the skill
          reads as one name. Perform is one of nine:
          ${PERFORM_CATEGORIES.map(([c, examples]) => `<span title="${esc(examples)}">${esc(c)}</span>`).join(', ')}.
          Every other skill is fixed; <strong>Add skill</strong> is where a new one — a
          further Craft, a homebrew — gets its own name.
        </p>
      </section>
    </div>`;
  }

  /**
   * The Skill cell: the skill and its variant, as one name.
   *
   * The skill itself is a fixed label -- the Pathfinder list is what it is, and
   * a row imported from the sheet is not a thing to rename. What is open is the
   * variant, and only on the skills that have one: Artistry, Craft, Lore and
   * Profession as free text, Perform as its nine categories. The parentheses
   * are drawn around the control so the cell reads as the whole name,
   * Craft ( Weapons and Armor ), and a player who types that whole thing in
   * has the skill's own name cleaned back off.
   *
   * A skill the player added is the exception: it has no name yet, so that one
   * is editable, which is also how a fifth Craft or a new Lore gets made.
   */
  #skillNameCell(s, i) {
    const name = s.custom
      ? this.#itemText('skills', i, 'name', s.name, 'Skill name')
      : `<span class="sname" title="${esc(skillLabel(s.name, s.spec))}">${esc(s.name)}</span>`;
    return `<span class="skillcell">${name}${this.#variantSlot(s, i)}</span>`;
  }

  /** The editable variant, for the skills that have one. */
  #variantSlot(s, i) {
    const kind = skillVariantKind(s.name);
    if (!kind) {
      // No slot to fill, but never hide a variant an import brought in.
      return s.spec
        ? `<span class="novariant">(${esc(s.spec)})</span>`
        : '';
    }
    const root = skillVariantRoot(s.name);
    const control = kind === 'perform'
      ? this.#itemSelect('skills', i, 'spec', s.spec,
        PERFORM_CATEGORIES.map(([c, examples]) => [c, c, examples]), 'pick one')
      : `<input type="text" value="${esc(s.spec ?? '')}" data-item="skills|${i}|spec" data-kind="text"
          placeholder="which one?"
          title="${esc(`Which ${root}? Reads as "${skillLabel(s.name, s.spec || '…')}" — typing the whole thing works too.`)}">`;
    return `<span class="variant ${s.spec ? '' : 'empty'}">${control}</span>`;
  }

  /* ---------------- combat & magic ---------------- */

  /**
   * Each side reads top to bottom as one story: the classes and what they
   * learned, the talents that came from elsewhere, then the numbers that fall
   * out of both. The first two are full width because their tables are; the
   * rest share a row of their own, which is why they sit in a `.sidepanels`
   * strip rather than in the page grid. In the page grid a side with three
   * panels left the fourth column of the shared four empty, and a side with
   * four squeezed all of them into a quarter each.
   */
  #combatPanel() {
    const t = this.#model.data.training || {};
    const wrap = (key, html) => this.#collapsible(key, html);
    const blended = this.#model.blendedClasses();
    return `<div class="grid">
      ${blended.length ? wrap('blended-training', this.#blendedPanel(blended)) : ''}
      ${t.combat ? `
        ${wrap('combat-training', this.#trainingSide('combat', t.combat))}
        ${wrap('combat-bonus', this.#bonusTalentPanel('combat', t.combat))}
        <div class="sidepanels">
          ${wrap('combat-tradition', this.#combatTraditionPanel(t.combat))}
          ${wrap('unarmed', this.#unarmedPanel(t.combat))}
          ${wrap('sphere-skills', this.#sphereSkillPanel())}
          ${wrap('combat-spheres', this.#sphereBonusPanel('combat', t.combat))}
        </div>` : ''}
      ${t.magic ? `
        ${wrap('magic-training', this.#trainingSide('magic', t.magic))}
        ${wrap('magic-bonus', this.#bonusTalentPanel('magic', t.magic))}
        <div class="sidepanels">
          ${wrap('magic-tradition', this.#magicTraditionPanel(t.magic))}
          ${wrap('magic-globals', this.#magicGlobalsPanel(t.magic))}
          ${wrap('magic-spheres', this.#sphereBonusPanel('magic', t.magic))}
        </div>` : ''}
    </div>`;
  }

  /**
   * Wrap a panel so its body can be minimized. The collapsed state lives in
   * uiPrefs and persists with the character.
   */
  #collapsible(key, panelHtml) {
    const collapsed = !!this.#model.data.uiPrefs?.collapsed?.[key];
    const btn = `<button data-collapse="${key}" title="${collapsed ? 'Expand' : 'Minimize'}" aria-expanded="${!collapsed}">${collapsed ? '▸' : '▾'}</button>`;
    if (!collapsed) return panelHtml.replace('</h3>', ` ${btn}</h3>`);
    // Collapsed: keep only the header line of the panel.
    const m = panelHtml.match(/<h3[\s\S]*?<\/h3>/);
    const header = m ? m[0].replace('</h3>', ` ${btn}</h3>`) : btn;
    const cls = panelHtml.match(/class="panel([^"]*)"/)?.[1] ?? '';
    return `<section class="panel${cls} collapsed">${header}</section>`;
  }

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

    const barRow = (e, i) => `<div class="item statline tabrow" draggable="true" data-tabkey="${esc(e.key)}">
      <span class="label pair" style="flex:1">
        <span class="grip" aria-hidden="true">⋮⋮</span>
        ${name(e)} ${badges(e)}
      </span>
      <span class="value pair">
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
        its data intact. Each view keeps its own bar: the <em>build</em> view starts from
        Overview, Stats, Lore, Skills, Progression, Feats &amp; Mythic, Primordia, Trackers,
        Equipment; the <em>session</em> view starts from what comes up at the table -- the
        tabs above plus every sub-system in use or marked on a class, minus the build
        machinery. <button data-action="tab-reset">Reset this view's bar</button>
      </p>
      <div class="rowlist tabbar-list">
        ${bar.map(barRow).join('') || '<p class="empty">Nothing on the bar — show a tab below.</p>'}
      </div>
    </section>

    <section class="panel span2">
      <h3>Hidden tabs</h3>
      <p class="hint">
        Everything else the sheet can show, alphabetically: the rest of the built-in
        tabs, the modelled sub-systems (Spheres &amp; Magic, Crafting, Akashic, Maneuvers,
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

  /* ----- training class blocks with per-level talent slots ----- */

  #classNames() {
    const names = new Set(this.#model.data.classes.map((x) => x.name).filter(Boolean));
    for (const side of Object.values(this.#model.data.training || {})) {
      for (const cls of side?.classes || []) if (cls.name) names.add(cls.name);
    }
    return [...names];
  }

  #trainingSide(sideKey, side) {
    const isMagic = sideKey === 'magic';
    const title = isMagic ? 'Magic training' : 'Combat training';
    const spheres = isMagic ? MAGIC_SPHERES : COMBAT_SPHERES;
    const types = isMagic ? CASTING_TYPES : PRACTITIONER_TYPES;
    const tplOptions = Object.keys(TALENT_RATES);
    const list = `training.${sideKey}.classes`;
    // A blended class trains both ways off one pool of talents; it has a group
    // of its own above, and appears here only as the note that says so.
    const classes = (side.classes || []).filter((x) => !x.extended && !x.blended);
    const extended = (side.classes || []).filter((x) => x.extended && !x.blended);
    const blended = (side.classes || []).filter((x) => x.blended);

    return `<section class="panel span2">
      <h3>${title}</h3>
      ${classes.map((cls, rawIndex) => {
        const ci = (side.classes || []).indexOf(cls);
        return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld"><span>Class</span>
            ${this.#itemSelect(list, ci, 'name', cls.name, this.#classNames())}</label>
          <label class="fld"><span>${isMagic ? 'Casting type' : 'Practitioner type'}</span>
            ${this.#itemSelect(list, ci, 'type', cls.type, types)}</label>
          <label class="fld"><span>Talents / level</span>
            ${this.#itemSelect(list, ci, 'talentsPerLevel', cls.talentsPerLevel, tplOptions)}</label>
          <label class="fld"><span>${isMagic ? 'Casting score' : 'Practitioner mod'}</span>
            ${this.#itemSelect(list, ci, 'mod1', cls.mod1, ABILITIES.map((k) => ABILITY_LABELS[k]))}</label>
          <label class="fld"><span>2nd score</span>
            ${this.#itemSelect(list, ci, 'mod2', cls.mod2, ABILITIES.map((k) => ABILITY_LABELS[k]))}</label>
          <label class="fld"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              <input type="number" value="${cls.classLevelsOverride ?? ''}" placeholder="${cls.classLevels ?? 0}"
                data-item="${list}|${ci}|classLevelsOverride" data-kind="number-or-null" style="width:3.6rem">
              <span class="hint">talents: ${cls.totalTalents ?? 0}</span>
            </span></label>
          <label class="fld"><span>Blended</span>
            <label class="chk" title="This class learns ${isMagic ? 'martial' : 'magical'} talents from the same pool — give it a group of its own that draws on both sphere lists.">
              <input type="checkbox" data-blend="${sideKey}|${ci}">
              <span class="hint">also ${isMagic ? 'martial' : 'magical'}</span></label></label>
          <button class="danger" data-remove="${list}|${ci}" title="Remove class">×</button>
        </div>
        <div class="tablewrap"><table class="talents">
          <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes"></colgroup>
          <thead><tr><th class="num">Lvl</th><th>Talent</th><th>Sphere</th><th>Notes</th></tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
            const on = !!lv.granted;
            const slots = `${list}.${ci}.levels`;
            const state = on ? 'slot-on' : 'slot-off';
            // The running talent count used to be a column of its own; it says
            // the same thing as a tooltip on the level it belongs to.
            const count = on ? `Talent #${Math.floor(lv.count)} at level ${lv.level}`
              : `Level ${lv.level} grants no talent`;
            return `<tr class="${lv.future ? 'future' : ''}">
              <td class="num" title="${esc(count)}">${lv.level}</td>
              <td class="${state}">${this.#prose(
    `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, 1, 'grow')}</td>
              <td class="${state}">
                ${on ? this.#itemSelect(slots, li, 'sphere', lv.sphere, spheres)
                  : '<select disabled><option></option></select>'}
              </td>
              <td class="${state}">${this.#prose(
    `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, 1, 'grow')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
      }).join('')}
      ${extended.length ? `<p class="hint">Also counted as ${isMagic ? 'casting' : 'practitioner'} classes:
        ${extended.map((x) => esc(x.name)).join(', ')} (extended-level page).</p>` : ''}
      ${blended.length ? `<p class="hint">Also counted as ${isMagic ? 'casting' : 'practitioner'} classes:
        ${blended.map((x) => esc(x.name)).join(', ')} — blended, so their talents are
        listed once under <strong>Blended training</strong> and counted here by sphere.</p>` : ''}
      <div style="margin-top:8px">
        <button class="primary" data-action="add-training-class" data-side="${sideKey}">+ Add class</button>
      </div>
      <p class="hint">
        A level's talent fields unlock when that level grants a talent — from the class's
        levels in the Planner and the Talents/level rate (Type drives ${isMagic ? 'caster level' : 'practitioner level'}
        separately, for classes where the two differ). Set Class levels to override a sparse Planner.
      </p>
    </section>`;
  }

  /**
   * Classes that train both ways: one pool of talents, two progressions.
   *
   * The workbook keeps such a class as a block on each tab holding the same
   * talents twice, which read as two classes that had each learned everything.
   * Here it is one group. The pool is sized by the practitioner-side talent
   * rate that owns it, each level picks from both sphere lists, and where each
   * talent lands -- the martial tables or the magical ones -- follows the
   * sphere rather than which tab the block came off.
   */
  #blendedPanel(pairs) {
    const tplOptions = Object.keys(TALENT_RATES);
    const abilities = ABILITIES.map((k) => ABILITY_LABELS[k]);
    const head = (half, label, types) => {
      if (!half) return `<label class="fld"><span>${label} type</span><select disabled><option>—</option></select></label>`;
      const list = `training.${half.side}.classes`;
      return `<label class="fld"><span>${label} type</span>
          ${this.#itemSelect(list, half.index, 'type', half.cls.type, types)}</label>
        <label class="fld"><span>${label === 'Casting' ? 'Casting score' : 'Practitioner mod'}</span>
          ${this.#itemSelect(list, half.index, 'mod1', half.cls.mod1, abilities)}</label>`;
    };

    return `<section class="panel span2">
      <h3>Blended training <span class="badge">${pairs.length}</span></h3>
      ${pairs.map(({ name, owner, twin }) => {
    const list = `training.${owner.side}.classes`;
    const cls = owner.cls;
    const martial = owner.side === 'combat' ? owner : twin;
    const casting = owner.side === 'magic' ? owner : twin;
    const counts = this.#blendedCounts(cls);
    return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld"><span>Class</span>
            ${this.#itemSelect(list, owner.index, 'name', cls.name, this.#classNames())}</label>
          <label class="fld"><span>Talents / level</span>
            ${this.#itemSelect(list, owner.index, 'talentsPerLevel', cls.talentsPerLevel, tplOptions)}</label>
          ${head(martial, 'Practitioner', PRACTITIONER_TYPES)}
          ${head(casting, 'Casting', CASTING_TYPES)}
          <label class="fld"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              <input type="number" value="${cls.classLevelsOverride ?? ''}" placeholder="${cls.classLevels ?? 0}"
                data-item="${list}|${owner.index}|classLevelsOverride" data-kind="number-or-null" style="width:3.6rem">
              <span class="hint">talents: ${cls.totalTalents ?? 0}</span>
            </span></label>
          <label class="fld"><span>Blended</span>
            <label class="chk" title="Untick to split this back into separate combat and magic classes.">
              <input type="checkbox" checked data-blend="${owner.side}|${owner.index}">
              <span class="hint">${counts.combat} martial · ${counts.magic} magical</span></label></label>
        </div>
        <div class="tablewrap"><table class="talents">
          <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes"></colgroup>
          <thead><tr><th class="num">Lvl</th><th>Talent</th><th>Sphere</th><th>Notes</th></tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
      const on = !!lv.granted;
      const slots = `${list}.${owner.index}.levels`;
      const state = on ? 'slot-on' : 'slot-off';
      const side = on ? sphereSide(lv.sphere) : null;
      const count = on ? `Talent #${Math.floor(lv.count)} at level ${lv.level}${
        side ? ` — counts as ${side === 'magic' ? 'magical' : 'martial'}` : ''}`
        : `Level ${lv.level} grants no talent`;
      return `<tr class="${lv.future ? 'future' : ''}">
              <td class="num" title="${esc(count)}">${lv.level}</td>
              <td class="${state}">${this.#prose(
        `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, 1, 'grow')}</td>
              <td class="${state}${side ? ` side-${side}` : ''}">
                ${on ? this.#itemSelect(slots, li, 'sphere', lv.sphere, BLENDED_SPHERES)
        : '<select disabled><option></option></select>'}
              </td>
              <td class="${state}">${this.#prose(
        `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, 1, 'grow')}</td>
            </tr>`;
    }).join('')}</tbody>
        </table></div>
      </div>`;
  }).join('')}
      <p class="hint">
        One pool of talents, spent either way: the sphere on each row decides whether the
        talent counts toward Sphere BAB / DC or Sphere CL / DC. Each side keeps its own
        type and ability score above, because a blended class rarely advances at the same
        rate as both.
      </p>
    </section>`;
  }

  /** How a blended class's talents so far divide between the two sides. */
  #blendedCounts(cls) {
    const counts = { combat: 0, magic: 0 };
    for (const lv of cls.levels || []) {
      if (!lv.granted || lv.future) continue;
      const side = sphereSide(lv.sphere);
      if (side) counts[side] += 1;
    }
    return counts;
  }

  /* ----- traditions ----- */

  #combatTraditionPanel(t) {
    const list = 'training.combat.tradition.entries';
    return `<section class="panel wide">
      <h3>Martial tradition</h3>
      <label class="fld"><span>Tradition</span>
        ${this.#text('training.combat.tradition.name', t.tradition?.name)}</label>
      <div class="tablewrap" style="margin-top:6px"><table class="talents">
        <colgroup><col class="talent"><col class="sphere"><col class="tool"></colgroup>
        <thead><tr><th>Grants</th><th>Sphere</th><th></th></tr></thead>
        <tbody>${(t.tradition?.entries || []).map((e, i) => `<tr>
          <td>${this.#prose(`data-item="${list}|${i}|talent"`, e.talent, 1, 'grow')}</td>
          <td>${this.#itemSelect(list, i, 'sphere', e.sphere, COMBAT_SPHERES)}</td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:6px">${this.#addButton(list, 'Add entry', { talent: '', sphere: null })}</div>
      ${this.#line('Practitioner base DC', t.practitionerDC)}
    </section>`;
  }

  /**
   * Talents from anywhere but a class's own ladder — a feat, an item, a
   * template. Its own group under the class blocks rather than a corner of the
   * tradition panel: a tradition grants talents because of what the character
   * is, and these arrive for unrelated reasons, so the rows want a Source and
   * the width to write it in.
   */
  #bonusTalentPanel(sideKey, side) {
    const isMagic = sideKey === 'magic';
    const list = `training.${sideKey}.bonusTalents`;
    const rows = side.bonusTalents || [];
    return `<section class="panel span2">
      <h3>Bonus ${isMagic ? 'magic' : 'combat'} talents
        ${rows.length ? `<span class="badge">${rows.length}</span>` : ''}</h3>
      <div class="tablewrap"><table class="talents bonus">
        <colgroup><col class="talent"><col class="sphere"><col class="source"><col class="notes"><col class="tools"></colgroup>
        <thead><tr><th>Talent</th><th>Sphere</th><th>Source</th><th>Notes</th><th></th></tr></thead>
        <tbody>${rows.map((e, i) => `<tr>
          <td>${this.#prose(`data-item="${list}|${i}|talent"`, e.talent, 1, 'grow')}</td>
          <td>${this.#itemSelect(list, i, 'sphere', e.sphere, isMagic ? MAGIC_SPHERES : COMBAT_SPHERES)}</td>
          <td>${this.#itemText(list, i, 'source', e.source, 'Feat, item…')}</td>
          <td>${this.#prose(`data-item="${list}|${i}|notes"`, e.notes, 1, 'grow')}</td>
          ${this.#rowTools(list, i)}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:6px">${this.#addButton(list, 'Add talent', {
    talent: '', sphere: null, source: '', notes: '',
  })}</div>
    </section>`;
  }

  #magicTraditionPanel(m) {
    const tr = m.tradition || {};
    const dlist = 'training.magic.tradition.drawbacks';
    const blist = 'training.magic.tradition.boughtOff';
    // Drawbacks read {…} like prose: "Expensive Locus ({locus = 22500} mana)"
    // is a drawback and a number the rest of the sheet can spend.
    const textRow = (lst, v, i) => `<div class="listrow">
      ${this.#prose(`data-item="${lst}|${i}|self"`, v, 1, 'grow')}
      <button class="danger" data-remove="${lst}|${i}" aria-label="Remove">×</button>
    </div>`;
    // A drawback is a few words, and a tradition can run to twenty of them, so
    // they sit as many to a row as the panel is wide enough for rather than
    // one per line down a column of mostly empty space.
    const textList = (lst, items) => (items.length
      ? `<div class="listgrid">${items.map((d, i) => textRow(lst, d, i)).join('')}</div>`
      : '<p class="empty">None.</p>');
    return `<section class="panel wide">
      <h3>Casting tradition</h3>
      <label class="fld"><span>Tradition</span>${this.#text('training.magic.tradition.name', tr.name)}</label>

      <h4 class="subhead">Drawbacks <span class="badge">${m.drawbackCount ?? 0} total</span></h4>
      ${textList(dlist, tr.drawbacks || [])}
      <div>${this.#addButton(dlist, 'Add drawback', '')}</div>
      <p class="hint">Write “… x2” on a drawback taken twice — it counts double.
        Formulas work here too: “Expensive Locus ({locus = 22500} mana)”.</p>

      <h4 class="subhead">Bought off with drawback feats <span class="badge">${m.boughtOffCount ?? 0}</span></h4>
      ${textList(blist, tr.boughtOff || [])}
      <div>${this.#addButton(blist, 'Add bought-off drawback', '')}</div>

      <div class="statline" style="margin-top:8px"><span class="label">Effective drawbacks</span>
        <span class="value">${m.drawbackCount ?? 0} − 2×${m.boughtOffCount ?? 0} = ${m.effectiveDrawbacks ?? 0}</span></div>
      ${this.#line('Boons', m.boons ?? 0, true)}
      ${this.#boonSplit(m)}
      <p class="hint">
        The ladder is 1 → 1+level/6, 2 → 1+level/3, 3 → level/2, 4 → 1+level/1.5,
        5 → level, and tops out there; each boon grants the step it adds to the one
        below it. Spell points are granted per casting class
        (${m.castingClassCount ?? 0}); essence is one pool, and lands on the Akashic
        tab as the Essence Boon.
      </p>
      <div class="statline"><span class="label">Advanced Magic Training</span>
        <span class="value">${this.#check('training.magic.amt', m.amt)}</span></div>
      <div class="statline"><span class="label">Mythic AMT</span>
        <span class="value">${this.#check('training.magic.mythicAmt', m.mythicAmt)}</span></div>
    </section>`;
  }

  /**
   * What each boon was spent on. A boon is a choice the player makes, not a
   * number that falls out of the drawback count, so each one gets its own row:
   * spell points for the casting pool, or essence for the veilweaving one.
   */
  /**
   * How each tradition pool was spent: so many of its steps as spell points,
   * the rest as essence. Two fields rather than a choice per step, because
   * what a step is worth depends only on how many are taken, not on which.
   */
  #boonSplit(m) {
    const pools = m.traditionPools || [];
    if (!pools.length) {
      return `${this.#line('Tradition SP granted', 0, true)}
        <p class="hint">Nothing to spend yet — a tradition grants a boon per drawback
          left after the drawback feats have bought theirs off.</p>`;
    }
    const steps = (p, value, kind) => `<input type="number" min="0" max="${p.steps}"
      value="${value}" data-split="training.magic.tradition.boonSP|${p.steps}|${kind}"
      aria-label="${esc(p.label)} — steps as ${kind === 'sp' ? 'spell points' : 'essence'}">`;

    return `<h4 class="subhead">Granted, and how it was spent</h4>
      <div class="tablewrap"><table class="talents pools">
        <colgroup><col class="talent"><col class="tool"><col class="sphere"><col class="tool"><col class="sphere"></colgroup>
        <thead><tr><th>Pool</th>
          <th class="num" colspan="2">As spell points</th>
          <th class="num" colspan="2">As essence</th></tr></thead>
        <tbody>${pools.map((p) => `<tr>
          <td>${esc(p.label)} <span class="badge">${p.points}</span></td>
          <td class="num">${steps(p, p.spSteps, 'sp')}</td>
          <td class="num total">${p.sp} SP</td>
          <td class="num">${steps(p, p.essenceSteps, 'essence')}</td>
          <td class="num total">${p.essence}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Steps, not points: each pool's steps add back up to its ladder
        however they are split.</p>
      ${this.#line('Tradition SP granted', m.traditionSP ?? 0, true)}
      ${this.#line('Essence granted', m.traditionEssence ?? 0, true)}`;
  }

  #magicGlobalsPanel(m) {
    const hint = (mine, sheet) => (sheet && mine !== sheet
      ? `<span class="badge err" title="The Google Sheet cached a different value">sheet: ${esc(sheet)}</span>` : '');
    const s = m.sheet || {};
    return `<section class="panel">
      <h3>Casting numbers</h3>
      <div class="statline"><span class="label">Caster level</span>
        <span class="value big">${m.globalCL} ${hint(m.globalCL, s.totalCL)}</span></div>
      ${this.#editLine('CL bonus', 'training.magic.clBonus', m.clBonus)}
      <div class="statline"><span class="label">Global DC</span>
        <span class="value big">${m.globalDC} ${hint(m.globalDC, s.totalDC)}</span></div>
      ${this.#editLine('DC bonus', 'training.magic.dcBonus', m.dcBonus)}
      <div class="statline"><span class="label">MSB</span><span class="value">${m.msb} ${hint(m.msb, s.totalMSB)}</span></div>
      ${this.#editLine('MSB bonus', 'training.magic.msbBonus', m.msbBonus)}
      <div class="statline"><span class="label">MSD</span><span class="value">${m.msd} ${hint(m.msd, s.totalMSD)}</span></div>
      ${this.#editLine('MSD bonus', 'training.magic.msdBonus', m.msdBonus)}
      ${this.#lineHtml('Concentration', `<span class="rollpair">d20+${m.concentration}${
        this.#rollButton('concentration', 'magic', 'a concentration check')}</span>`)}

      <h4 class="subhead">Spell points</h4>
      ${(m.classSP || []).map((x) => this.#line(`${x.name}`, x.sp)).join('')}
      ${this.#editLine('Bonus SP', 'training.magic.bonusSP', m.bonusSP)}
      ${this.#line('Tradition SP', m.traditionSP ?? 0)}
      <div class="statline"><span class="label">Total SP</span>
        <span class="value big">${m.totalSP} ${hint(m.totalSP, s.totalSP)}</span></div>
      ${m.spOnEssence ? `
      <div class="statline"><span class="label">Condensed to essence
        <span class="badge">${m.spOnEssence / SP_PER_TEMP_ESSENCE} temp essence</span></span>
        <span class="value">−${m.spOnEssence}</span></div>
      <div class="statline"><span class="label">Available to cast with</span>
        <span class="value big${m.spShort ? ' bad' : ''}">${m.availableSP}</span></div>
      <p class="hint${m.spShort ? ' warn' : ''}">
        ${m.spShort
    ? `Condensing that much essence costs ${m.spOnEssence} points and there are only ${m.totalSP}: ${m.spShort} short. Edit it on the Akashic tab.`
    : `${SP_PER_TEMP_ESSENCE} spell points make 1 temporary essence, set on the Akashic tab.`}
      </p>` : ''}
      <p class="hint">Class SP = class levels + casting ability modifier.</p>
    </section>`;
  }

  /* ----- sphere bonuses / skill ranks / unarmed ----- */

  #sphereBonusPanel(sideKey, side) {
    const rows = side.sphereRows || [];
    const active = rows.filter((r) => r.talents > 0 || r.rankBonus || r.dcBonus || r.clBonus);
    const isMagic = sideKey === 'magic';
    const list = `training.${sideKey}.sphereBonuses`;
    const render = (r) => {
      const i = (side.sphereBonuses || []).findIndex((x) => x.sphere === r.sphere);
      return `<tr>
        <td>${esc(r.sphere)}</td>
        <td class="num">${r.talents || ''}</td>
        <td class="num">${this.#itemNum(list, i, isMagic ? 'clBonus' : 'rankBonus', isMagic ? r.clBonus : r.rankBonus)}</td>
        <td class="num">${this.#itemNum(list, i, 'dcBonus', r.dcBonus)}</td>
        <td class="num total">${isMagic ? `${r.cl} / ${r.dc}` : `${fmt(r.attack)} / ${r.dc}`}</td>
      </tr>`;
    };
    return `<section class="panel">
      <h3>${isMagic ? 'Sphere CL / DC' : 'Sphere BAB / DC'}</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>Sphere</th><th class="num">Talents</th>
          <th class="num">${isMagic ? 'CL+' : 'Rank+'}</th><th class="num">DC+</th>
          <th class="num">${isMagic ? 'CL / DC' : 'BAB / DC'}</th></tr></thead>
        <tbody>${active.map(render).join('')}</tbody>
      </table></div>
      <details style="margin-top:6px"><summary class="hint" style="cursor:pointer">All spheres</summary>
        <div class="tablewrap"><table><tbody>${rows.filter((r) => !active.includes(r)).map(render).join('')}</tbody></table></div>
      </details>
      ${!isMagic ? '<p class="hint">Alchemy keys off Craft (alchemy) ranks; Beastmastery off Handle Animal / Ride.</p>' : ''}
    </section>`;
  }

  /**
   * Bonus skill ranks, for the skills that have any coming.
   *
   * The block is seventeen rows of which a character has two or three: the
   * rest ask for a sphere they have no talent in, or for a package they did
   * not take, and a row that can only ever read zero is not information. What
   * is left is the rows their talents can reach -- shown whether or not the
   * switch is on, because the switch is the point of them -- and a character
   * with none of those is told so in a sentence instead of in a table of
   * noughts.
   *
   * **From** is what the row wants. Where the sheet can see the talent it says
   * so and the row is automatic; where the sphere still holds talents nobody
   * has written down -- a Primordia technique's picks from 7th level, most
   * often -- the row is marked and the switch decides, because a talent this
   * sheet cannot see is not a talent the character does not have. Naming them
   * on the Primordia tab settles those rows one way or the other.
   */
  #sphereSkillPanel() {
    const list = 'training.combat.skillRanks';
    // The index is the row's place in the stored list, which the filter must
    // not renumber: it is what every field on the row binds to.
    const rows = (this.#model.trainingSkillRanks || [])
      .map((r, i) => ({ ...r, i }))
      .filter((r) => r.state !== 'unmet' || r.current > 0);
    if (!rows.length) {
      return `<section class="panel">
        <h3>Bonus skill ranks from spheres</h3>
        <p class="empty">This character has no talents that grant bonus ranks.</p>
      </section>`;
    }
    const anyUnsure = rows.some((r) => r.state === 'unknown');
    return `<section class="panel">
      <h3>Bonus skill ranks from spheres</h3>
      <div class="tablewrap"><table class="sphereranks">
        <thead><tr><th></th><th>Skill</th>
          <th class="num">Talents</th><th class="num">Ranks</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.current ? 'trained' : 'untrained'}">
          <td class="mid">${this.#itemCheck(list, r.i, 'enabled', r.enabled)}</td>
          <td>${esc(r.skill)}
            <div class="req${r.state === 'unknown' ? ' unsure' : ''}"
              title="${esc(r.state === 'met'
    ? `${r.requirement} — found on this character.`
    : `${r.requirement} — the sphere is here, but it still holds talents nobody has named. Write them in on the Primordia tab and this row answers itself; until then the tick beside it decides.`)}">${esc(r.requirement)}</div></td>
          <td class="num">${r.talents || ''}</td>
          <td class="num total">${r.current || ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">
        5 ranks per talent in the associated sphere, capped at level; these flow
        into the Spheres column of the Skills tab automatically. A row appears
        only when what it asks for — the sphere for a <em>Base</em> row, the named
        package or talent otherwise — is on the character.
        ${anyUnsure ? 'A <span class="req unsure">dotted</span> requirement is one the sheet cannot yet confirm: '
    + 'the sphere is there and still holds talents nobody has written down — a technique\'s picks from 7th '
    + 'level, usually. Name them on the <strong>Primordia</strong> tab and the row answers itself; '
    + 'until then the tick is yours to make.' : ''}
      </p>
    </section>`;
  }

  #unarmedPanel(t) {
    const u = t.unarmed || {};
    const per = u.perSphere || {};
    const base = 'training.combat.unarmed';
    const chk = (label, path, value, count) => `<div class="statline">
      <span class="label">${label} <span class="badge">${count ?? 0} talents</span></span>
      <span class="value">${this.#check(path, value)}</span></div>`;
    // Unorthodox Unarmed Training: two sphere picks per feat on the character.
    const slots = Number(u.unorthodoxSlots) || 0;
    const picks = u.otherSpheres || [];
    const unorthodox = slots ? `<div class="fld" style="margin-top:6px"><span>Unorthodox Unarmed Training spheres
        <span class="badge">${u.unorthodoxFeats || 0} feat${u.unorthodoxFeats === 1 ? '' : 's'} · ${slots} picks</span></span>
      <div class="picks">${Array.from({ length: slots }, (_, i) => this.#select(`${base}.otherSpheres.${i}`, picks[i] || '', COMBAT_SPHERES.filter((s) => !UNARMED_SPHERES.includes(s)))).join('')}</div>
      </div>`
      : '<p class="hint">Unorthodox Unarmed Training, once taken as a feat, gives two more sphere picks here — two per time it is taken.</p>';
    return `<section class="panel">
      <h3>Unarmed damage</h3>
      <div class="bigstats" style="margin-bottom:8px">
        ${this.#bigStat('Dice', u.dice ?? '—', `${u.effectiveTalents ?? 0} effective talents`)}
      </div>
      <div class="unarmed-grid">
        ${chk('Boxing', `${base}.usesBoxing`, u.usesBoxing, per.Boxing)}
        ${chk('Brute', `${base}.usesBrute`, u.usesBrute, per.Brute)}
        ${chk('Open Hand', `${base}.usesOpenHand`, u.usesOpenHand, per['Open Hand'])}
        ${chk('Wrestling', `${base}.usesWrestling`, u.usesWrestling, per.Wrestling)}
      </div>
      ${unorthodox}
      <div class="unarmed-grid" style="margin-top:6px">
        <div class="statline" title="Counts as ${TALENTED_KNUCKLE_TALENTS} virtual talents">
          <span class="label">Talented Knuckle <span class="badge">+${TALENTED_KNUCKLE_TALENTS}</span></span>
          <span class="value">${this.#check(`${base}.talentedKnuckle`, u.talentedKnuckle)}</span></div>
        <div class="statline" title="Counts as ${BRAWLERS_VEST_TALENTS} virtual talents">
          <span class="label">Brawler's Vest <span class="badge">+${BRAWLERS_VEST_TALENTS}</span></span>
          <span class="value">${this.#check(`${base}.brawlersVest`, u.brawlersVest)}</span></div>
      </div>
      ${u.asuraEssence ? `<div class="statline" title="The essence invested in the Bands of the Asura veil, ${ASURA_TALENTS_PER_ESSENCE} Open Hand talents a point">
        <span class="label">Bands of the Asura <span class="badge">${u.asuraEssence} essence</span></span>
        <span class="value">+${u.asuraEssence * ASURA_TALENTS_PER_ESSENCE} talents</span></div>` : ''}
      ${this.#editLine('Extra effective talents', `${base}.extraTalents`, u.extraTalents ?? 0)}
      ${this.#editLine('Step increases (+1 die step)', `${base}.stepIncreases`, u.stepIncreases)}
      ${this.#editLine('Size increases (+2 die steps)', `${base}.sizeIncreases`, u.sizeIncreases)}
      <div class="statline"><span class="label">Count tradition talents too</span>
        <span class="value">${this.#check('training.combat.unarmed.includeTradition', u.includeTradition)}</span></div>
      ${u.improvedUnarmedStrike ? '<p class="hint">Gains Improved Unarmed Strike (1+ unarmed-sphere talents).</p>' : ''}
      <div class="statline"><span class="label">Class has its own unarmed progression</span>
        <span class="value">${this.#check('training.combat.unarmed.nativeProgression', u.nativeProgression)}</span></div>
      ${u.nativeProgression ? '<p class="hint warn">Native progression: treat unarmed strikes as one size larger with 3+ talents instead of using this table.</p>' : ''}
    </section>`;
  }

  /* ----- templates -----
   *
   * A template is a list of features, each a title, a type and its text, and
   * each able to carry sub-abilities and tables -- which is how the source
   * sheets are written: Omni-Cooking has four blocks under it and two of them
   * are tables. Groups reorder by dragging, and so do sub-abilities, which can
   * also be dragged into another group. What a sub-ability cannot do is leave
   * its group for the top level: it hangs off the feature above it.
   */

  #templatePanel() {
    const templates = this.#model.data.templates || [];
    const blankTemplate = {
      tab: null, name: 'Template', link: null, approvalLink: null, features: [],
    };
    const blankAbility = { name: '', type: null, text: '', tables: [], children: [] };
    if (!templates.length) {
      return `<div class="grid"><section class="panel span2">
        <h3>Template</h3>
        <p class="hint">A template's features live here — a name, whether each is
          extraordinary, supernatural or spell-like, its text, and any tables or
          sub-abilities it grants.</p>
        <div style="margin-top:8px">${this.#addButton('templates', 'Add template', blankTemplate)}</div>
      </section></div>`;
    }
    return `<div class="grid">${templates.map((tp, ti) => {
      const features = tp.features || [];
      return `<section class="panel span2">
        <h3>
          ${this.#text(`templates.${ti}.name`, tp.name ?? tp.tab ?? 'Template', 'Template name')}
          ${tp.tab ? `<span class="badge">from “${esc(tp.tab)}”</span>` : ''}
          <button class="danger" data-remove="templates|${ti}" title="Remove template" aria-label="Remove template">×</button>
        </h3>
        <div class="fieldgrid two">
          ${this.#field('Template link', this.#text(`templates.${ti}.link`, tp.link))}
          ${this.#field('Approval link', this.#text(`templates.${ti}.approvalLink`, tp.approvalLink))}
        </div>
        <div class="tmpl" data-tmpl="${ti}">
          ${features.map((f, fi) => this.#templateGroup(ti, fi, f, features.length)).join('')}
        </div>
        <div style="margin-top:8px">
          ${this.#addButton(`templates.${ti}.features`, 'Add ability', blankAbility)}
        </div>
      </section>`;
    }).join('')}
    </div>`;
  }

  /** One template feature: the group head, its tables and its sub-abilities. */
  #templateGroup(ti, fi, f, total) {
    const list = `templates.${ti}.features`;
    const path = `${list}.${fi}`;
    const kids = f.children || [];
    return `<article class="feature tgroup${f.temporary ? ' temporary' : ''}" data-tdrop="${ti}|${fi}|-1">
      <div class="featurehead">
        ${this.#grip(ti, fi, -1, 'Drag to reorder this ability')}
        ${this.#itemText(list, fi, 'name', f.name, 'Ability name')}
        ${this.#itemSelect(list, fi, 'type', f.type, TEMPLATE_TYPES.map((t) => [t, t, TEMPLATE_TYPE_HINTS[t]]))}
        <span class="tools">
          <button data-move="${list}|${fi}|-1" title="Move up" aria-label="Move up" ${fi === 0 ? 'disabled' : ''}>↑</button>
          <button data-move="${list}|${fi}|1" title="Move down" aria-label="Move down" ${fi === total - 1 ? 'disabled' : ''}>↓</button>
          <button class="danger" data-remove="${list}|${fi}" title="Remove ability" aria-label="Remove ability">×</button>
        </span>
      </div>
      ${f.temporary ? `<p class="hint pending">Temporary — the import could not place these cells
        under a feature, so they were kept here rather than dropped. Move what they say into
        abilities of their own, and delete this once it is empty.</p>` : ''}
      ${this.#itemArea(list, fi, 'text', f.text, 4)}
      ${this.#templateTables(ti, path, f)}
      ${kids.length ? `<div class="tkids">
        ${kids.map((c, ci) => this.#templateChild(ti, fi, ci, c, {
    first: fi === 0 && ci === 0,
    last: fi === total - 1 && ci === kids.length - 1,
  })).join('')}
      </div>` : ''}
      <div class="tadd">
        ${this.#addButton(`${path}.children`, 'Sub-ability', { name: '', type: null, text: '', tables: [] })}
        ${this.#addButton(`${path}.tables`, 'Table', NEW_TEMPLATE_TABLE())}
      </div>
    </article>`;
  }

  /**
   * A sub-ability: the same card, indented, and never above its group head.
   *
   * Its ↑ / ↓ carry on into the neighbouring ability rather than stopping at
   * the ends of their own group, so a sub-ability can be moved between groups
   * without a mouse. They are only disabled where there is no ability left to
   * move into.
   */
  #templateChild(ti, fi, ci, c, { first, last }) {
    const list = `templates.${ti}.features.${fi}.children`;
    const path = `${list}.${ci}`;
    return `<article class="feature tchild" data-tdrop="${ti}|${fi}|${ci}">
      <div class="featurehead">
        ${this.#grip(ti, fi, ci, 'Drag to reorder, or into another ability')}
        ${this.#itemText(list, ci, 'name', c.name, 'Sub-ability name')}
        ${this.#itemSelect(list, ci, 'type', c.type, TEMPLATE_TYPES.map((t) => [t, t, TEMPLATE_TYPE_HINTS[t]]))}
        <span class="tools">
          <button data-tnudge="${ti}|${fi}|${ci}|-1" title="Move up (into the ability above, at the top)"
            aria-label="Move up" ${first ? 'disabled' : ''}>↑</button>
          <button data-tnudge="${ti}|${fi}|${ci}|1" title="Move down (into the ability below, at the bottom)"
            aria-label="Move down" ${last ? 'disabled' : ''}>↓</button>
          <button class="danger" data-remove="${list}|${ci}" title="Remove sub-ability" aria-label="Remove sub-ability">×</button>
        </span>
      </div>
      ${this.#itemArea(list, ci, 'text', c.text, 3)}
      ${this.#templateTables(ti, path, c)}
      <div class="tadd">${this.#addButton(`${path}.tables`, 'Table', NEW_TEMPLATE_TABLE())}</div>
    </article>`;
  }

  #grip(ti, fi, ci, title) {
    return `<span class="grip" data-tgrip="${ti}|${fi}|${ci}" title="${esc(title)}"
      role="button" tabindex="-1" aria-hidden="true">⠿</span>`;
  }

  /**
   * The abilities of a template, as somewhere a table can be moved to.
   *
   * Where a table is drawn on the sheet says which feature it is under, and
   * that is not always what it means -- Bryva's spell-school table is written
   * beside Temporal Haze and belongs to Omni-Cooking.
   */
  #templateHomes(ti) {
    const out = [];
    (this.#model.data.templates?.[ti]?.features || []).forEach((f, fi) => {
      const label = (n, fallback) => (String(n || '').trim() || fallback);
      out.push([`templates.${ti}.features.${fi}`, label(f.name, `Ability ${fi + 1}`)]);
      (f.children || []).forEach((c, ci) => {
        out.push([`templates.${ti}.features.${fi}.children.${ci}`,
          `↳ ${label(c.name, `Sub-ability ${ci + 1}`)}`]);
      });
    });
    return out;
  }

  /**
   * The tables a feature carries.
   *
   * Every cell is a growing prose field rather than a one-line input: these
   * hold rules text ("consumer gains 2 temporary hit points per 1 by which the
   * dish beats the cooking DC"), and they resolve {…} like any other prose.
   *
   * Cells merge by what is written in them -- `-----` joins the cell to its
   * left, `|||||` the cell above -- and a merged cell is not drawn, so the
   * **Cells** toggle shows the grid as it is stored when a merge needs undoing
   * or adjusting. See `mergeLayout` in rules.js for how the spans are worked
   * out; nothing about them is stored.
   */
  #templateTables(ti, path, f) {
    const homes = this.#templateHomes(ti).filter(([p]) => p !== path);
    return (f.tables || []).map((t, bi) => {
      const table = `${path}.tables.${bi}`;
      const rows = `${table}.rows`;
      const width = (t.columns || []).length;
      const raw = this.#showCells.has(table);
      const grid = (t.rows || []).map((row) => Array.from({ length: width },
        (_, ci) => row.cells?.[ci] ?? null));
      const body = raw ? null : mergeLayout(grid);
      const head = raw ? null : mergeLayout([t.columns || []])[0];
      const span = (s) => (s.colspan > 1 ? ` colspan="${s.colspan}"` : '')
        + (s.rowspan > 1 ? ` rowspan="${s.rowspan}"` : '');
      return `<div class="ttable">
        <div class="ttablehead">
          ${this.#text(`${table}.caption`, t.caption, 'Table caption (optional)')}
          ${homes.length ? `<select data-tmove="${path}|${bi}" title="Move this table to another ability">
            <option value="">Move to…</option>
            ${homes.map(([p, label]) => `<option value="${p}">${esc(label)}</option>`).join('')}
          </select>` : ''}
          <button data-cells="${table}" aria-pressed="${raw}"
            title="Show every cell as it is stored, merge markers and all">Cells</button>
          <button data-action="add-template-column" data-path="${table}">+ Column</button>
          <button class="danger" data-remove="${path}.tables|${bi}" title="Remove table">Remove table</button>
        </div>
        ${raw ? `<p class="hint">Every cell, as stored. Type <code>-----</code> in a cell to
          merge it into the one on its left, or <code>|||||</code> to merge it into the one
          above; clear it again to split them.</p>` : ''}
        <div class="tablewrap"><table class="tmpltable${raw ? ' raw' : ''}">
          <thead><tr>
            ${(t.columns || []).map((c, ci) => (head && !head[ci] ? '' : `<th${head ? span(head[ci]) : ''}>
              <span class="colhead">
                ${this.#text(`${table}.columns.${ci}`, c, `Column ${ci + 1}`)}
                <button class="danger" data-action="remove-template-column" data-path="${table}"
                  data-col="${ci}" title="Remove column" aria-label="Remove column">×</button>
              </span>
            </th>`)).join('')}
            <th class="tools"></th>
          </tr></thead>
          <tbody>
            ${(t.rows || []).map((row, ri) => `<tr>
              ${Array.from({ length: width }, (_, ci) => (body && !body[ri][ci] ? '' : `<td${
  body ? span(body[ri][ci]) : ''}>${
  this.#prose(`data-item="${rows}|${ri}|cells.${ci}"`, row.cells?.[ci], 1, 'grow')}</td>`)).join('')}
              ${this.#rowTools(rows, ri)}
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="tadd">
          ${this.#addButton(rows, 'Row', { cells: Array.from({ length: width }, () => null) })}
        </div>
      </div>`;
    }).join('');
  }

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
  #grantedFeatsPanel() {
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

    return `<section class="panel span2">
      <h3>Granted feats</h3>
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
      </p>
    </section>`;
  }

  #featuresPanel() {
    const c = this.#model.data;
    const feats = c.feats || {};
    const m = c.mythic || {};
    const tier = Number(c.identity.mythicTier) || 0;
    return `<div class="grid">
      ${this.#grantedFeatsPanel()}
      ${(c.featGroups || []).map((group, g) => `
        <section class="panel">
          <h3>
            <input class="grouptitle" type="text" value="${esc(group.name)}"
              data-item="featGroups|${g}|name" data-kind="text" aria-label="Group name">
            <span class="badge">${group.entries.length}</span>
            <button class="danger" data-remove="featGroups|${g}" title="Remove group">×</button>
          </h3>
          <div class="tablewrap"><table>
            <thead><tr><th>Feat</th><th>Source / level</th><th></th></tr></thead>
            <tbody>${group.entries.map((f, i) => `<tr>
              <td>${this.#itemText(`featGroups.${g}.entries`, i, 'name', f.name)}</td>
              <td>${this.#itemText(`featGroups.${g}.entries`, i, 'detail', f.detail)}</td>
              ${this.#rowTools(`featGroups.${g}.entries`, i)}
            </tr>`).join('')}</tbody>
          </table></div>
          <div style="margin-top:8px">
            ${this.#addButton(`featGroups.${g}.entries`, 'Add feat', { name: '', detail: '' })}
          </div>
        </section>`).join('')}

      <section class="panel">
        <h3>New feat group</h3>
        <p class="hint">Groups mirror the columns on the sheet's Feats tab — Level Up, Oaths, Attunement, Class, and so on.</p>
        <div style="margin-top:8px">
          ${this.#addButton('featGroups', 'Add group', { name: 'New group', entries: [] })}
        </div>
      </section>

      <section class="panel span2">
        <h3>Mythic <span class="badge">tier ${tier}</span></h3>
        <div class="fieldgrid">
          ${this.#field('Path', this.#text('mythic.path', m.path))}
          ${this.#field(`Tier (auto: ${m.computedTier ?? 0})`, `<span class="pair">
            <input type="number" value="${m.tierOverride ?? ''}" placeholder="${m.computedTier ?? 0}"
              data-set="mythic.tierOverride" data-kind="number-or-null" style="width:3.6rem"
              title="Automatic from level; enter a number to override.">
            <span class="value">→ ${c.identity.mythicTier ?? 0}</span></span>`)}
          ${this.#field('Bonus HP / tier', this.#num('mythic.bonusHpPerTier', m.bonusHpPerTier))}
          ${this.#field('Base path ability', this.#text('mythic.basePathAbility', m.basePathAbility))}
        </div>
        <p class="hint">
          Tier comes from character level (8→1, 10→2, 12→3, 14→4, then one per level to
          20→10). Bonus HP/tier adds ${(Number(m.bonusHpPerTier) || 0)} × ${c.identity.mythicTier ?? 0}
          = <strong>${this.#model.mythicHp}</strong> HP on top of the normal maximum
          (Champion/Guardian 5, Marshal/Trickster 4, Archmage/Hierophant 3).
        </p>
        <div class="tablewrap" style="margin-top:8px"><table>
          <thead><tr>
            <th class="num">Tier</th>
            <th class="num" title="The character level this tier is reached at">Lvl</th>
            <th>Ability</th><th>Path</th>
            <!-- Grants sits beside Choice: the slot and what was taken for it. -->
            <th title="What the tier hands over — a feat on odd tiers, a path power on even ones">Grants</th>
            <th>Choice</th>
            <th title="+2 to one ability, at every even tier">Stat</th>
          </tr></thead>
          <tbody>${MYTHIC_TIERS.map((t) => {
            const a = (m.abilities || [])[t - 1] || {};
            const i = t - 1;
            const even = t % 2 === 0;
            return `<tr class="${t > tier ? 'future' : ''}">
              <td class="num">${t}</td>
              <td class="num derived" title="Tier ${t} at level ${MYTHIC_TIER_LEVEL[t]}">${MYTHIC_TIER_LEVEL[t] ?? ''}</td>
              <td>${this.#itemText('mythic.abilities', i, 'name', a.name)}</td>
              <td>${this.#itemText('mythic.abilities', i, 'path', a.path)}</td>
              <td><span class="fsource">${esc(a.feat || mythicTierGrant(t))}</span></td>
              <td>${this.#itemText('mythic.abilities', i, 'featChoice', a.featChoice)}</td>
              ${even
                ? `<td>${this.#pickSelect('mythicStat', t, 0, this.#mythicPickAt(t), ABILITY_LABELS_LIST, false)}</td>`
                : '<td class="noslot"></td>'}
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="hint">
          Ten tiers, one row each: a mythic feat on the odd ones, a path power and a
          <strong>+2 ability increase</strong> on the even ones — which is why only those
          rows offer a Stat. <strong>Grants</strong> is what the tier hands over;
          <strong>Choice</strong> is what you took for it. The same increases are on the
          <strong>Stats</strong> tab, either place edits the one set. Rows above tier
          ${tier} are greyed: planned, not counted yet.
        </p>
      </section>

      ${this.#mythicTraditionPanel(m)}
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
      <div class="tablewrap"><table>
        <thead><tr><th>Slot</th><th>Choice</th></tr></thead>
        <tbody>${MYTHIC_TRADITION_SLOTS.map((def) => {
          const locked = def.requires && !filled(def.requires);
          return `<tr class="${locked ? 'lockedslot' : ''}">
            <td>${esc(def.label)}${def.mandatory ? ' <span class="badge err">required</span>' : ''}
              ${def.requires ? `<div class="hint">needs ${esc(MYTHIC_TRADITION_SLOTS.find((s) => s.key === def.requires)?.label)}</div>` : ''}
              ${def.kind === 'quality' ? '<div class="hint">bonus + drawback</div>' : ''}</td>
            <td>${this.#prose(`data-set="mythic.tradition.${def.key}" placeholder="${esc(locked ? `Take ${MYTHIC_TRADITION_SLOTS.find((s) => s.key === def.requires)?.label} first` : '')}"`, tr[def.key], 1, 'grow')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">
        One mandatory drawback unlocks one boon; each further drawback (up to two)
        unlocks another. The quality carries both a bonus and a drawback.
      </p>
    </section>`;
  }

  /* ---------------- equipment ---------------- */

  #gearPanel() {
    const c = this.#model.data;
    const e = c.equipment;
    return `<div class="grid">
      ${this.#weaponsPanel(e)}
      ${this.#armorPanel(e)}
      ${this.#gearSlotsPanel(e)}
      ${this.#otherItemsPanel(e)}
      ${this.#loadPanel(e)}
    </div>`;
  }

  /** The six-block weapon layout from the workbook, as editable cards. */
  #weaponsPanel(e) {
    const weapons = e.weapons || [];
    const cs = this.#model.conditionState;
    return `<section class="panel span2">
      <h3>Weapons <span class="badge">${weapons.length}</span></h3>
      ${weapons.map((w, i) => `<div class="weapon">
        <div class="weaponhead">
          ${this.#itemText('equipment.weapons', i, 'name', w.name, 'Weapon name')}
          <span class="bigroll" title="Attack including {{…}} tokens">${esc(w.calc?.totalAtkStr ?? fmt(w.attackTotal ?? 0))}</span>
          <span class="bigroll dmg" title="Damage including [[…]] tokens">${esc(w.calc?.totalDmgStr ?? w.damageTotal ?? '—')}</span>
          ${w.proficient === false ? `<span class="badge err nonprof"
            title="${esc(w.proficiencyWhy)} — non-proficiency is −4 to hit, yours to write in Misc">not proficient</span>`
    : w.proficient === true && w.proficiencySource !== 'overview' ? `<span class="badge ok nonprof"
            title="${esc(w.proficiencyWhy)}">proficient · ${w.proficiencySource === 'veil' ? 'veil' : esc(w.proficiencyNote || 'row')}</span>` : ''}
          ${this.#rollButton('weapon', i, `${String(w.name || '').trim() || 'this weapon'} — attack and damage`, cs)}
          <button class="danger" data-remove="equipment.weapons|${i}" aria-label="Remove weapon">×</button>
        </div>
        <div class="weapongrid">
          ${this.#field('Base', this.#itemSelect('equipment.weapons', i, 'attackType', w.attackType, WEAPON_ATTACK_TYPES))}
          ${this.#field('Enh.', this.#itemNum('equipment.weapons', i, 'enhancement', w.enhancement))}
          ${this.#field('Misc', this.#itemNum('equipment.weapons', i, 'miscAttack', w.miscAttack))}
          ${this.#field('Adj.', this.#itemNum('equipment.weapons', i, 'attackOffset', w.attackOffset))}
          <span class="wsep"></span>
          ${this.#field('Dice', `<span class="pair">
            ${this.#exprField(`data-item="equipment.weapons|${i}|dice"`, w.dice, {
              kind: 'text',
              width: '5.5rem',
              placeholder: '1d8 or {name}',
              // A literal 1d8 is already what it means; only a reference has
              // something to resolve to.
              value: /^\s*(\{|\[\[)/.test(String(w.dice ?? '')) && !w.useUnarmedDice ? w.diceResolved : null,
              error: w.diceError,
              title: w.useUnarmedDice ? 'Overridden by the unarmed calculator'
                : 'Literal dice (12d8), or a reference like {kinetic.fist} to a name defined in prose',
            })}
            <label class="chk" title="Use the unarmed practitioner dice from Spheres & Magic">
              ${this.#itemCheck('equipment.weapons', i, 'useUnarmedDice', w.useUnarmedDice)}<span>🥊</span></label>
          </span>`)}
          ${this.#field('Ability', this.#itemSelect('equipment.weapons', i, 'damageAbility', w.damageAbility, ABILITIES.map((k) => ABILITY_LABELS[k])))}
          ${this.#field('×', `<input type="number" value="${w.abilityMult ?? 1}" step="0.5" min="0"
            data-item="equipment.weapons|${i}|abilityMult" data-kind="number" style="width:3.2rem"
            title="Ability multiplier — usually 1, 1.5 or 2, but anything goes">`)}
          ${this.#field('Misc dmg', this.#itemExpr('equipment.weapons', i, 'miscDamage', w, { width: '4.5rem' }))}
          <span class="wsep"></span>
          ${this.#field('Crit', this.#itemNum('equipment.weapons', i, 'critRange', w.critRange))}
          ${this.#field('Mult', this.#itemSelect('equipment.weapons', i, 'critMult', w.critMult, WEAPON_CRIT_MULTS))}
          ${this.#field('Damage type', this.#itemText('equipment.weapons', i, 'damageType', w.damageType))}
        </div>
        <div class="weapongrid">
          ${this.#field('Size', this.#itemSelect('equipment.weapons', i, 'size', w.size, Object.keys(SIZE_MODIFIERS)))}
          ${this.#field('Groups', `<span class="pair">
            ${this.#itemSelect('equipment.weapons', i, 'groups.0', (w.groups || [])[0], WEAPON_GROUPS)}
            ${this.#itemSelect('equipment.weapons', i, 'groups.1', (w.groups || [])[1], WEAPON_GROUPS)}
            ${this.#itemSelect('equipment.weapons', i, 'groups.2', (w.groups || [])[2], WEAPON_GROUPS)}</span>`)}
          ${this.#field('Handedness', this.#itemSelect('equipment.weapons', i, 'handedness', w.handedness, WEAPON_HANDEDNESS))}
          ${this.#field('Familiarity', this.#itemSelect('equipment.weapons', i, 'familiarity', w.familiarity, WEAPON_FAMILIARITY))}
          ${this.#field('Range', this.#itemText('equipment.weapons', i, 'range', w.range))}
          ${this.#field('Ammo', this.#itemText('equipment.weapons', i, 'ammunition', w.ammunition))}
          ${this.#field('Wt', this.#itemNum('equipment.weapons', i, 'weight', w.weight))}
          ${this.#field('Price', this.#itemNum('equipment.weapons', i, 'price', w.price))}
          <span class="wsep"></span>
          ${this.#field('As', `<input type="text" value="${esc(w.baseWeapon ?? '')}" data-item="equipment.weapons|${i}|baseWeapon"
            data-kind="text" placeholder="katana" style="width:6.5rem"
            title="The base weapon this is — a named blade that is a katana, a veil that takes a longsword's form — read against the Overview's specific weapons">`)}
          ${this.#field('Proficient', `<select data-item="equipment.weapons|${i}|proficiency" data-kind="text"
            title="${esc(w.proficiencyWhy || 'Auto reads the row against the Overview\'s Proficiencies and the [Enhanced] veil rule')}">
            <option value=""${!w.proficiency ? ' selected' : ''}>Auto${w.proficient === true ? ' ✓' : w.proficient === false ? ' ✗' : ''}</option>
            <option value="yes"${w.proficiency === 'yes' ? ' selected' : ''}>Yes</option>
            <option value="no"${w.proficiency === 'no' ? ' selected' : ''}>No</option></select>`)}
          ${w.proficiency ? this.#field('Via', `<input type="text" value="${esc(w.proficiencyNote ?? '')}" data-item="equipment.weapons|${i}|proficiencyNote"
            data-kind="text" placeholder="Custom Training" style="width:8rem"
            title="What grants or denies it — a talent, a class feature, a trait">`) : ''}
        </div>
        <label class="fld" style="margin-top:6px"><span>Special properties
          <span class="hint">— write {{…}} to add to hit and [[…]] to add damage; dice, formulas, a
            {name} you defined, or a mix. Tag a damage token <strong>Crit</strong> for crit-only
            (multiplied) or <strong>Mult</strong> for damage that multiplies with the weapon;
            untagged is a rider, added once on a crit.</span></span>
          ${this.#itemArea('equipment.weapons', i, 'special', w.special, 2)}</label>
        ${w.calc ? `<div class="wcalc">
          <div class="hint">atk ${fmt(w.calc.baseAtk)} · dmg ${esc(diceString(w.calc.baseDmgDice, w.calc.baseDmgFlat))}
            <span class="avg">avg ${w.calc.baseAvg}</span>
            ${!w.calc.hasTokens && !w.calc.hasCritTokens
    ? `<span class="crit">crit ${esc(w.calc.critStr)} <span class="avg">avg ${w.calc.critAvg}</span></span>` : ''}</div>
          ${w.calc.hasTokens ? `<div class="hint">
            ${w.calc.atkTokens.some((t) => !t.crit) ? `{{…}} ${esc(diceString(w.calc.tokAtk.dice, w.calc.tokAtk.flat))} to hit` : ''}
            ${w.calc.dmgTokens.some((t) => !t.crit && !t.mult) ? ` · [[…]] ${esc(diceString(w.calc.tokDmg.dice, w.calc.tokDmg.flat))} damage, added once on a crit` : ''}
            ${w.calc.dmgTokens.some((t) => t.mult) ? ` · [[Mult]] ${esc(diceString(w.calc.tokMultDmg.dice, w.calc.tokMultDmg.flat))} damage, multiplied on a crit` : ''}
            ${w.calc.atkTokens.some((t) => t.crit) ? ` · {{Crit}} ${esc(diceString(w.calc.critAtk.dice, w.calc.critAtk.flat))} to confirm` : ''}
            ${w.calc.dmgTokens.some((t) => t.crit) ? ` · [[Crit]] ${esc(diceString(w.calc.critTagged.dice, w.calc.critTagged.flat))}×${w.calc.critMultNum} crit damage` : ''}
          </div>` : ''}
          ${w.calc.hasTokens || w.calc.hasCritTokens ? `<div class="wtotal">atk <strong>${esc(w.calc.totalAtkStr)}</strong> ·
            dmg <strong>${esc(w.calc.totalDmgStr)}</strong>
            <span class="avg">avg ${w.calc.totalAvg}</span>
            <span class="crit">crit ${esc(w.calc.critStr)}
              ${w.calc.critAtk.flat || Object.keys(w.calc.critAtk.dice).length ? `confirm ${esc(w.calc.confirmStr)} ·` : ''}
              <span class="avg">avg ${w.calc.critAvg}</span></span></div>` : ''}
          ${w.calc.errors.length ? `<div class="hint" style="color:var(--cs-bad)">
            ${w.calc.errors.map(esc).join(' · ')}</div>` : ''}
        </div>` : ''}
        ${w.sheetTotalDamage && String(w.sheetTotalDamage) !== w.damageTotal
    ? `<p class="hint">Sheet noted: ${esc(w.sheetTotalDamage)}</p>` : ''}
      </div>`).join('') || '<p class="empty">No weapons yet.</p>'}
      <div style="margin-top:8px">${this.#addButton('equipment.weapons', 'Add weapon', {
        name: '', attackType: 'Melee', dice: '', damageAbility: 'Str', abilityMult: 1,
        miscDamage: 0, miscAttack: 0, enhancement: 0, critRange: 20, critMult: 'x2',
        damageType: '', groups: [], special: '', size: '', range: '', handedness: '',
        familiarity: '', ammunition: '', weight: 0, price: 0, attackOffset: 0,
      })}</div>
      <p class="hint">
        Attack = base mode total + enhancement + misc + adjustment; damage = dice +
        floor(ability × mult) + misc + enhancement. 🥊 links the dice to the unarmed
        practitioner calculator.
      </p>
    </section>`;
  }

  #armorPanel(e) {
    const row = (piece, path, tools = '') => `<tr class="${piece.active ? '' : 'untrained'}">
      <td class="mid">${this.#check(`${path}.active`, piece.active)}</td>
      <td>${esc(piece.kind || 'Armor')}</td>
      <td>${this.#text(`${path}.name`, piece.name)}</td>
      <td class="num">${this.#num(`${path}.acBonus`, piece.acBonus, 'style="width:3.2rem"')}</td>
      <td class="num"><input type="number" value="${piece.maxDex ?? ''}" placeholder="—"
        data-set="${path}.maxDex" data-kind="number-or-null" style="width:3.2rem"></td>
      <td class="num">${this.#num(`${path}.acp`, piece.acp, 'style="width:3.2rem"')}</td>
      <td>${this.#text(`${path}.type`, piece.type)}</td>
      <td class="mid">${this.#check(`${path}.ghostTouch`, piece.ghostTouch)}</td>
      <td class="num">${this.#num(`${path}.weight`, piece.weight, 'style="width:3.6rem"')}</td>
      <td class="num">${this.#num(`${path}.cost`, piece.cost, 'style="width:4rem"')}</td>
      ${tools}
    </tr>`;
    return `<section class="panel span2">
      <h3>Armor &amp; shields</h3>
      <div class="tablewrap"><table>
        <thead><tr><th title="Worn — counts toward AC">On</th><th></th><th>Name</th>
          <th class="num">AC</th><th class="num">Max Dex</th><th class="num">ACP</th>
          <th>Type</th><th>Ghost</th><th class="num">Wt</th><th class="num">Cost</th><th></th></tr></thead>
        <tbody>
          ${row(e.armor || {}, 'equipment.armor')}
          ${(e.shields || []).map((s, i) => row(s, `equipment.shields.${i}`,
    `<td class="tools"><button class="danger" data-remove="equipment.shields|${i}" aria-label="Remove">×</button></td>`)).join('')}
        </tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton('equipment.shields', 'Add shield', {
        kind: 'Shield', name: '', acBonus: 0, maxDex: null, acp: 0, type: '',
        ghostTouch: false, others: [], weight: 0, cost: 0, active: false,
      })}</div>
      <p class="hint">
        Worn pieces feed AC, cap the AC stat at the lowest Max Dex, and apply their
        armor check penalty to flagged skills — all live.
      </p>
    </section>`;
  }

  #gearRow(list, i, g, tools) {
    const bonus = (bi) => `
      <td class="num"><input type="number" value="${g.bonuses?.[bi]?.value ?? ''}" placeholder="—"
        data-item="${list}|${i}|bonuses.${bi}.value" data-kind="number-or-null" style="width:3rem"></td>
      <td>${this.#itemSelect(list, i, `bonuses.${bi}.type`, g.bonuses?.[bi]?.type, GEAR_BONUS_TYPES)}</td>`;
    return `<tr>
      <td>${esc(g.slot)}</td>
      <td>${this.#itemText(list, i, 'name', g.name)}</td>
      ${bonus(0)}${bonus(1)}${bonus(2)}
      <td>${this.#itemText(list, i, 'others.0', g.others?.[0])}</td>
      <td>${this.#itemText(list, i, 'others.1', g.others?.[1])}</td>
      <td>${this.#itemText(list, i, 'others.2', g.others?.[2])}</td>
      <td>${this.#itemText(list, i, 'others.3', g.others?.[3])}</td>
      <td class="num">${this.#itemNum(list, i, 'weight', g.weight)}</td>
      <td class="num">${this.#itemNum(list, i, 'cost', g.cost)}</td>
      ${tools || '<td></td>'}
    </tr>`;
  }

  static #GEAR_HEAD = `<thead><tr>
    <th>Slot</th><th>Item</th>
    <th class="num">B1</th><th>Type</th><th class="num">B2</th><th>Type</th>
    <th class="num">B3</th><th>Type</th>
    <th>Other 1</th><th>Other 2</th><th>Other 3</th><th>Other 4</th>
    <th class="num">Wt</th><th class="num">Cost</th><th></th></tr></thead>`;

  #gearSlotsPanel(e) {
    const showAll = this.#showAllGear;
    const filled = (g) => g.name || g.bonuses?.some((b) => b.value != null && b.value !== '')
      || g.others?.some(Boolean);
    const rows = (e.gear || []).map((g, i) => ({ g, i }))
      .filter(({ g }) => showAll || filled(g));
    return `<section class="panel span2">
      <h3>Slotted gear
        <span class="badge">${rows.length} of ${(e.gear || []).length}</span>
        <button data-action="toggle-gear" style="margin-left:8px">${showAll ? 'Hide empty slots' : 'Show all slots'}</button>
      </h3>
      <div class="tablewrap"><table>
        ${CharacterSheetElement.#GEAR_HEAD}
        <tbody>${rows.map(({ g, i }) => this.#gearRow('equipment.gear', i, g)).join('')
    || '<tr><td colspan="15"><p class="empty">Nothing worn — show all slots to fill them in.</p></td></tr>'}</tbody>
      </table></div>
      <p class="hint">Three typed bonuses per item (value + bonus type) plus four freeform ones, like the sheet.</p>
    </section>`;
  }

  #otherItemsPanel(e) {
    return `<section class="panel span2">
      <h3>Other items</h3>
      <div class="tablewrap"><table>
        ${CharacterSheetElement.#GEAR_HEAD}
        <tbody>${(e.other || []).map((g, i) => this.#gearRow('equipment.other', i, g,
    `<td class="tools"><button class="danger" data-remove="equipment.other|${i}" aria-label="Remove">×</button></td>`)).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton('equipment.other', 'Add item', {
        slot: 'Other', name: '', bonuses: [{ value: null, type: null }, { value: null, type: null }, { value: null, type: null }],
        others: [null, null, null, null], weight: 0, cost: 0,
      })}</div>
    </section>`;
  }

  #loadPanel(e) {
    const c = this.#model.data;
    const sum = (arr, key = 'weight') => (arr || []).reduce((t, x) => t + (Number(x[key]) || 0), 0);
    return `<section class="panel">
      <h3>Load &amp; value</h3>
      ${this.#line('Slotted gear', `${sum(e.gear)} lbs`)}
      ${this.#line('Other items', `${sum(e.other)} lbs`)}
      ${this.#line('Armor & shields', `${(Number(e.armor?.weight) || 0) + sum(e.shields)} lbs`)}
      ${this.#line('Weapons', `${sum(e.weapons)} lbs`)}
      ${this.#editLine('Adjustment', 'carry.carriedOffset', c.carry?.carriedOffset ?? 0)}
      <div class="statline"><span class="label">Total carried</span>
        <span class="value big">${c.carry?.carried ?? 0} lbs</span></div>
      ${this.#line('Light load', `≤ ${c.carry?.light ?? 0} lbs`)}
      ${(c.carry?.carried ?? 0) > (c.carry?.light ?? 0)
    ? `<p class="hint warn">Over light load (${c.carry?.carried} > ${c.carry?.light}).</p>` : ''}
      ${this.#line('Total value', `${e.totalValue ?? 0} gp`)}
    </section>`;
  }

  /* ---------------- item crafting ---------------- */

  /**
   * The workbook's Item Crafting tab as a calculator.
   *
   * The top three panels are the crafter's standing setup -- how fast they
   * work, what an item costs them to make, and what they roll -- and every
   * project below is priced, dated and turned into its Discord post from
   * those. Nothing here is typed in twice.
   */
  #craftingPanel() {
    const cr = this.#model.data.crafting;
    if (!cr) return '<div class="grid"><p class="empty">No crafting data.</p></div>';
    return `<div class="grid crafting">
      ${this.#craftSummaryPanel(cr)}
      ${this.#craftSpeedPanel(cr)}
      ${this.#craftCostPanel(cr)}
      ${this.#craftCrafterPanel(cr)}
      ${this.#craftProjectsPanel(cr)}
      ${this.#craftExtrasPanel(cr)}
    </div>`;
  }

  #craftSummaryPanel(cr) {
    const k = cr.calc || {};
    const mode = { take10: 'take 10', take20: 'take 20', manual: `rolled ${k.roll ?? 0}` }[cr.checkMode] || 'take 10';
    return `<section class="panel span2">
      <h3>Crafting ${k.errors?.length ? `<span class="badge err">${k.errors.length} formula problem(s)</span>` : ''}</h3>
      <div class="bigstats">
        ${this.#bigStat('Progress / day', group(k.speedPerDay), `${esc(cr.currency || '')} of base price`)}
        ${this.#bigStat('Base cost', pct(k.baseFraction), 'of base price')}
        ${this.#bigStat('Reductions', `×${round(k.compounding, 4)}`, `${(cr.costReductions || []).filter((r) => r.enabled !== false).length} applied`)}
        ${this.#bigStat('You pay', pct(k.ratio), 'value : craft ratio')}
        ${this.#bigStat('Craft check', fmt(k.checkBase), `${esc(mode)}${k.skill ? ` · ${esc(k.skill)}` : ''}`)}
      </div>
      ${k.errors?.length ? `<p class="hint warn" style="margin-top:8px">${k.errors.map(esc).join(' · ')}</p>` : ''}
    </section>`;
  }

  /** Progress per day: a base rate plus the increases the crafter has earned. */
  #craftSpeedPanel(cr) {
    const list = 'crafting.speedIncreases';
    const rows = cr.speedIncreases || [];
    return `<section class="panel">
      <h3>Crafting speed</h3>
      ${this.#field('Base progress / day', this.#num('crafting.baseSpeed', cr.baseSpeed, 'style="width:6rem"'))}
      <div class="tablewrap"><table class="craftlist">
        <thead><tr><th>On</th><th>Increase</th><th>Kind</th><th>Amount</th><th></th></tr></thead>
        <tbody>${rows.map((s, i) => `<tr>
          <td class="mid">${this.#itemCheck(list, i, 'enabled', s.enabled !== false)}</td>
          <td>${this.#itemText(list, i, 'label', s.label, 'Rush, workshop…')}</td>
          <td class="narrow">${this.#itemSelect(list, i, 'kind', s.kind || 'flat', CRAFT_SPEED_KINDS, null)}</td>
          <td class="narrow">${this.#itemExpr(list, i, 'value', s, { width: '4.2rem' })}</td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('') || '<tr><td colspan="5"><span class="empty">No increases yet.</span></td></tr>'}</tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton(list, 'Add speed increase', {
        label: '', kind: 'multiplier', value: CRAFT_SPEED_MULTIPLIER, enabled: true,
      })}</div>
      ${this.#line('Progress / day', group(cr.calc?.speedPerDay))}
      <p class="hint">
        Flat increases add to the base rate; multipliers stack additively —
        two ×2 bonuses make ×4, as the sheet's own count did. Amounts may be
        formulas (<code>level * 100</code>).
      </p>
      <p class="hint">
        A project takes its <strong>base price</strong> ÷ this, rounded up —
        progress is measured against what the item is worth, not what it costs
        you to make.
      </p>
    </section>`;
  }

  /** What an item costs to make: the base fraction, then the reductions. */
  #craftCostPanel(cr) {
    const list = 'crafting.costReductions';
    const rows = cr.costReductions || [];
    const presets = cr.baseCosts || [];
    return `<section class="panel">
      <h3>Crafting cost</h3>
      ${this.#field('Base crafting cost', this.#select('crafting.baseCostIndex',
    String(cr.baseCostIndex ?? 0), presets.map((b, i) => [String(i), `${b.label} — ${b.percent}%`]), null))}
      <details style="margin:6px 0">
        <summary class="hint" style="cursor:pointer">Edit base costs (${presets.length})</summary>
        <div class="tablewrap" style="margin-top:6px"><table class="craftlist">
          <thead><tr><th>Name</th><th>%</th><th></th></tr></thead>
          <tbody>${presets.map((b, i) => `<tr>
            <td>${this.#itemText('crafting.baseCosts', i, 'label', b.label, 'Name')}</td>
            <td class="narrow"><input type="number" value="${Number(b.percent) || 0}"
              data-item="crafting.baseCosts|${i}|percent" data-kind="number" style="width:4.2rem"></td>
            ${this.#rowRemove('crafting.baseCosts', i)}
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:6px">${this.#addButton('crafting.baseCosts', 'Add base cost', { label: '', percent: 50 })}</div>
        <p class="hint">50, 33 and 25 mean a true half, third and quarter of market value, as the sheet's own dropdown did.</p>
      </details>
      <div class="subhead">Manufacturing cost reductions</div>
      <div class="tablewrap"><table class="craftlist">
        <thead><tr><th>On</th><th>Reduction</th><th>%</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td class="mid">${this.#itemCheck(list, i, 'enabled', r.enabled !== false)}</td>
          <td>${this.#itemText(list, i, 'label', r.label, 'Hands of the Crafter…')}</td>
          <td class="narrow">${this.#itemExpr(list, i, 'value', r, { width: '4.2rem' })}</td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('') || '<tr><td colspan="4"><span class="empty">No reductions yet.</span></td></tr>'}</tbody>
      </table></div>
      <div style="margin-top:8px">${this.#addButton(list, 'Add cost reduction', { label: '', value: 10, enabled: true })}</div>
      ${this.#line('Compounding reduction', `×${round(cr.calc?.compounding, 4)}`)}
      ${this.#line('Final value : craft ratio', pct(cr.calc?.ratio))}
      <p class="hint">
        Reductions compound rather than add: 10% and 20% leave
        0.9 × 0.8 = 72% of the price, not 70%.
      </p>
    </section>`;
  }

  /** The crafter: their check, their discount, and how they sign a post. */
  #craftCrafterPanel(cr) {
    const skills = this.#model.craftSkills();
    const k = cr.calc || {};
    return `<section class="panel">
      <h3>The crafter</h3>
      <div class="fieldgrid">
        ${this.#field('Craft skill', this.#select('crafting.checkSkill', cr.checkSkill ?? k.skill,
    skills.map((s) => [s.key, `${s.label} ${fmt(s.bonus)}`]), 'None'))}
        ${this.#field('Check', this.#select('crafting.checkMode', cr.checkMode || 'take10', CRAFT_CHECK_MODES, null))}
        ${cr.checkMode === 'manual' ? this.#field('Roll', this.#num('crafting.checkRoll', cr.checkRoll)) : ''}
        ${this.#field('Misc bonus', this.#num('crafting.checkMisc', cr.checkMisc))}
      </div>
      ${this.#line('Crafting check', `${fmt(k.checkBase)}`)}
      <div class="fieldgrid" style="margin-top:9px">
        ${this.#field('Standing discount %', this.#num('crafting.discount', cr.discount))}
        ${this.#field('DC per bypassed req.', this.#num('crafting.dcPerBypass', cr.dcPerBypass))}
        ${this.#field('Days count against', this.#select('crafting.timeBasis', cr.timeBasis || 'value', CRAFT_TIME_BASES, null))}
        ${this.#field('Currency', this.#text('crafting.currency', cr.currency, 'mana'))}
      </div>
      ${this.#field('Name on the marketplace post', this.#text('crafting.sellerName', cr.sellerName, 'Character name'))}
      <p class="hint">
        The discount is what buyers pay off market value — 100% sells at cost.
        A project can override it.
      </p>
    </section>`;
  }

  #craftProjectsPanel(cr) {
    const projects = cr.projects || [];
    return `<section class="panel span2">
      <h3>Projects <span class="badge">${projects.length}</span></h3>
      ${projects.map((p, i) => this.#craftProject(cr, p, i)).join('')
      || '<p class="empty">No projects yet.</p>'}
      <div style="margin-top:8px">${this.#addButton('crafting.projects', 'Add project', {
      name: '', value: 0, discountOverride: null, zeroProfit: false, itemDC: 0, checkMod: 0,
      dcAdjustments: [], bypassed: [], dcNotes: '', resources: '', notes: '',
      buyerName: '', buyerTag: '', remaining: '',
    })}</div>
    </section>`;
  }

  /** One crafting project: its price, its DC, and the two posts it generates. */
  #craftProject(cr, p, i) {
    const list = 'crafting.projects';
    const base = `crafting.projects.${i}`;
    const k = p.calc || {};
    const unit = cr.currency ? ` ${cr.currency}` : '';
    return `<div class="craft">
      <div class="crafthead">
        ${this.#itemText(list, i, 'name', p.name, 'Item name')}
        <span class="bigroll" title="Crafting cost">${group(k.cost)}</span>
        <span class="bigroll dmg" title="Profit at the final sale price">${fmt(k.net)}</span>
        <button class="danger" data-remove="${list}|${i}" aria-label="Remove project">×</button>
      </div>
      <div class="weapongrid">
        ${this.#field('Base price', this.#itemExpr(list, i, 'value', p, { width: '7rem' }))}
        ${this.#field('Discount %', `<input type="number" value="${p.discountOverride ?? ''}"
          data-item="${list}|${i}|discountOverride" data-kind="number-or-null" style="width:4.4rem"
          placeholder="${Number(cr.discount) || 0}" title="Blank uses the crafter's standing discount">`)}
        ${this.#field('Zero profit', `<span class="pair">${this.#itemCheck(list, i, 'zeroProfit', p.zeroProfit)}
          <span class="hint">sell at cost</span></span>`)}
        <span class="wsep"></span>
        ${this.#field('Item DC', this.#itemExpr(list, i, 'itemDC', p, { width: '4.4rem' }))}
        ${this.#field('Check mod', this.#itemNum(list, i, 'checkMod', p.checkMod))}
      </div>
      <div class="wcalc">
        <div class="hint">
          base price ${group(k.value)}${esc(unit)} · cost ${group(k.cost)}${esc(unit)} ·
          gross ${group(k.gross)}${esc(unit)} · sells for ${group(k.sale)}${esc(unit)}
        </div>
        <div class="wtotal">
          profit <strong>${p.zeroProfit ? 'none' : `${fmt(k.net)}${esc(unit)}`}</strong> ·
          <strong>${k.days ?? 0}</strong> day(s) <span class="avg">${k.daysExact ?? 0} exact</span> ·
          DC <strong>${k.dc ?? 0}</strong> vs check <strong>${fmt(k.check)}</strong>
          <span class="${k.succeeds ? 'ok' : 'crit'}">${k.succeeds ? '✔ succeeds' : '✘ fails'}</span>
        </div>
        <div class="hint">
          ${esc(cr.timeBasis === 'cost' ? 'crafting cost' : 'base price')}
          ${group(k.basis)} ÷ ${group(cr.calc?.speedPerDay)} / day
          ${k.dcParts?.length ? ` · DC: ${esc(k.dcParts.join(', '))}` : ''}
        </div>
      </div>
      <div class="craftcols">
        <div>
          <div class="subhead">Crafting DC</div>
          <div class="tablewrap"><table class="craftlist">
            <thead><tr><th>On</th><th>Note</th><th>DC</th><th></th></tr></thead>
            <tbody>${(p.dcAdjustments || []).map((a, j) => `<tr>
              <td class="mid">${this.#itemCheck(`${base}.dcAdjustments`, j, 'enabled', a.enabled !== false)}</td>
              <td>${this.#itemText(`${base}.dcAdjustments`, j, 'label', a.label, 'Rush, exotic material…')}</td>
              <td class="narrow">${this.#itemExpr(`${base}.dcAdjustments`, j, 'value', a, { width: '4rem' })}</td>
              ${this.#rowRemove(`${base}.dcAdjustments`, j)}
            </tr>`).join('') || '<tr><td colspan="4"><span class="empty">Base DC only.</span></td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:6px">${this.#addButton(`${base}.dcAdjustments`, 'Add DC note', { label: '', value: 5, enabled: true })}</div>
        </div>
        <div>
          <div class="subhead">Bypassed requirements <span class="hint">${fmt(cr.dcPerBypass)} DC each</span></div>
          <div class="tablewrap"><table class="craftlist">
            <thead><tr><th>On</th><th>Requirement</th><th></th></tr></thead>
            <tbody>${(p.bypassed || []).map((b, j) => `<tr>
              <td class="mid">${this.#itemCheck(`${base}.bypassed`, j, 'enabled', b.enabled !== false)}</td>
              <td>${this.#itemText(`${base}.bypassed`, j, 'label', b.label, 'Craft Wondrous Item…')}</td>
              ${this.#rowRemove(`${base}.bypassed`, j)}
            </tr>`).join('') || '<tr><td colspan="3"><span class="empty">None bypassed.</span></td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:6px">${this.#addButton(`${base}.bypassed`, 'Add bypassed requirement', { label: '', enabled: true })}</div>
        </div>
      </div>
      <div class="fieldgrid two" style="margin-top:9px">
        <label class="fld"><span>Resources used</span>${this.#itemArea(list, i, 'resources', p.resources, 2)}</label>
        <label class="fld"><span>Notes / description</span>${this.#itemArea(list, i, 'notes', p.notes, 2)}</label>
      </div>
      <div class="fieldgrid" style="margin-top:6px">
        ${this.#field('Free-text DC note', this.#itemText(list, i, 'dcNotes', p.dcNotes, 'Anything the notes above miss'))}
        ${this.#field('Buyer (character)', this.#itemText(list, i, 'buyerName', p.buyerName))}
        ${this.#field('Buyer (Player#0000)', this.#itemText(list, i, 'buyerTag', p.buyerTag))}
        ${this.#field(`${cr.currency || 'Gold'} remaining`, this.#itemText(list, i, 'remaining', p.remaining))}
      </div>
      ${this.#craftPost(`craft-${i}`, 'Crafting post', k.craftPost, 9)}
      ${this.#craftPost(`market-${i}`, 'Marketplace post', k.marketPost, 6)}
    </div>`;
  }

  /**
   * A generated Discord post: read-only, with a copy button.
   *
   * Editing any crafting field rebuilds the panel, so whether a post was open
   * is remembered on the element -- it is where the player is looking while
   * they tune the numbers, and it must not fold shut under them.
   */
  #craftPost(id, label, text, rows) {
    const open = this.#openPosts.has(id) ? this.#openPosts.get(id) : id.startsWith('craft-');
    return `<details class="postbox" data-postbox="${id}"${open ? ' open' : ''}>
      <summary>${esc(label)}
        <button data-copy="${id}" title="Copy for Discord">Copy</button></summary>
      <textarea readonly rows="${rows}" data-post="${id}" spellcheck="false">${esc(text ?? '')}</textarea>
    </details>`;
  }

  /**
   * Cells from the workbook's Item Crafting tab that no label claimed --
   * Bryva's Armiger customisation block. Kept editable so nothing from the
   * source sheet is lost, but not part of the calculation.
   */
  #craftExtrasPanel(cr) {
    const rows = cr.sourceExtras || [];
    if (!rows.length) return '';
    const list = 'crafting.sourceExtras';
    const width = Math.min(14, Math.max(...rows.map((r) => r.cells.length), 2));
    return `<section class="panel span2">
      <h3>From the source tab <span class="badge">${rows.length} rows</span></h3>
      <p class="hint">
        Cells the workbook's Item Crafting tab carried beside the calculator.
        They are kept as written and do not feed anything above.
      </p>
      <div class="tablewrap" style="margin-top:8px"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${this.#itemText(list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${this.#rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }

  /* ---------------- modelled sub-systems ---------------- */

  /**
   * The modelled sub-systems, and whether each holds anything.
   *
   * None of them is on the tab bar until the player puts it there from the ⚙
   * manager; `has` is what the manager badges as "in use", so a character with
   * veils or a deck can see which of the waiting tabs actually has their data.
   */
  /**
   * The sub-system tabs with an "in use" state, keyed by tab id. The data
   * checks live on the model (`systemTabsInUse` -- Spheres & Magic and
   * Crafting included); `tagged` says a class on the Overview marks the
   * system even though nothing is typed into its tab yet.
   */
  #modelledSystems() {
    const has = this.#model.systemTabsInUse();
    const tagged = this.#model.taggedSystemTabs();
    const out = {};
    for (const [id, h] of Object.entries(has)) out[id] = { id, has: h, tagged: tagged.has(id) };
    return out;
  }

  /** Cells from a source tab that no label claimed. Kept, shown, not modelled. */
  #systemExtrasPanel(block, path, tabName) {
    const rows = block?.sourceExtras || [];
    if (!rows.length) return '';
    const list = `${path}.sourceExtras`;
    const width = Math.min(14, Math.max(...rows.map((r) => r.cells.length), 2));
    return `<section class="panel span2">
      <h3>From the source tab <span class="badge">${rows.length} rows</span></h3>
      <p class="hint">
        Cells the workbook's ${esc(tabName)} tab carried that no heading claimed.
        They are kept as written and do not feed anything above.
      </p>
      <div class="tablewrap" style="margin-top:8px"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${this.#itemText(list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${this.#rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }

  /* ---------------- akashic veilweaving ---------------- */

  /**
   * The veil board.
   *
   * The workbook laid this out as two columns of four-row blocks with a save
   * DC restated beside every veil. Here each slot is a row that holds one veil
   * -- or two when Twinveil is ticked -- and the DC is computed from the
   * veilweaver's base plus the essence invested, which is what the sheet's own
   * numbers always worked out to.
   */
  #akashicPanel() {
    const a = this.#model.data.akashic;
    if (!a) return '<div class="grid"><p class="empty">No akashic data.</p></div>';

    return `<div class="grid">
      ${this.#essencePanel(a)}
      ${this.#akashicClassesPanel(a)}
      ${this.#akashicSlotsPanel(a)}
      ${this.#akashicKheshigPanel(a)}
      ${this.#akashicReceptaclesPanel(a)}
      ${this.#systemExtrasPanel(a, 'akashic', 'Akashic')}
    </div>`;
  }

  /**
   * The day's essence, as a gauge rather than a row of chips.
   *
   * Six equal readings strung across a full-width panel said very little for
   * the space: the one that moves during play is how much of the pool is still
   * free, and that is a proportion, so it reads as a bar. The fixed numbers --
   * base DC, the per-veil cap, how many veils are shaped -- become tiles beside
   * it, and the spell-point exchange sits at the end because what it feeds is
   * the bar itself.
   */
  #essencePanel(a) {
    const k = a.calc || {};
    const e = a.essence || {};
    const over = (k.overCap || []).length;
    const free = k.free ?? 0;
    const used = k.used ?? 0;
    const pool = k.pool ?? 0;
    const temp = k.temp ?? 0;
    const total = k.total ?? pool;
    const slots = (a.slots || []).length;
    const spLeft = (k.spPool ?? 0) - (k.spSpent ?? 0);

    return `<section class="panel span2">
      <h3>Essence
        ${over ? `<span class="badge err" title="${esc((k.overCap || []).join(', '))}">${over} over cap</span>` : ''}
        ${k.spShort ? `<span class="badge err" title="Condensing that much essence costs ${k.spSpent} spell points and the character has ${k.spPool}">${k.spShort} SP short</span>` : ''}
        ${this.#meterStyleButton('essence')}
      </h3>
      ${this.#meterStyleEditor('essence')}
      <div class="essence-strip">
        <div class="ess-gauge${free < 0 ? ' is-over' : ''}">
          <div class="ess-head">
            <span class="ess-read"><b>${used}</b><i>/</i>${total}</span>
            <span class="ess-k">invested</span>
            <span class="ess-fill"></span>
            <span class="ess-left">${free} free</span>
          </div>
          ${this.#meterVisual(this.#model.meterSpec('essence'))}
          <div class="ess-note">
            ${temp ? `pool ${pool} + ${temp} temporary` : `${pool} essence per day`}
          </div>
        </div>

        <div class="ess-figs">
          ${this.#essFig(k.base ?? 0, 'Base DC', 'before essence')}
          ${Number(a.steadyVeilDC) ? this.#essFig(a.steadyVeilDC, 'Steady DC', 'steady veil') : ''}
          ${this.#essFig(k.totalCap ?? 0, 'Cap', 'per veil')}
          ${this.#essFig(k.shaped ?? 0, 'Shaped', `${slots} slot${slots === 1 ? '' : 's'}`)}
        </div>

        <div class="ess-sp${k.spShort ? ' is-over' : ''}">
          <div class="ess-sp-k">Spell points → essence</div>
          <label class="minifield">Temporary essence
            ${this.#num('akashic.essence.spTemp', e.spTemp, 'min="0" step="1" style="width:3.2rem"')}</label>
          <div class="ess-sp-cost">
            ${temp
    ? `${k.spSpent} SP spent &middot; ${spLeft} of ${k.spPool ?? 0} left`
    : `${SP_PER_TEMP_ESSENCE} SP each &middot; ${k.spPool ?? 0} SP available`}
          </div>
        </div>
      </div>
      <p class="hint">The Veilweaving sphere condenses
        ${SP_PER_TEMP_ESSENCE} spell points into 1 temporary essence for the day.
        Those points are spent whether or not the essence is invested, so they
        come off the total on <strong>Spheres &amp; Magic</strong>.</p>
    </section>`;
  }

  /** One fixed reading beside the gauge: the number first, then what it is. */
  #essFig(v, k, sub = '') {
    return `<div class="essfig"><div class="v">${esc(v)}</div>
      <div class="k">${esc(k)}</div>
      <div class="sub">${sub ? esc(sub) : '&nbsp;'}</div></div>`;
  }

  /**
   * The essence pool beside the classes that grant it.
   *
   * The sources add into the pool, and the caps come off the class blocks, so
   * the two belong on one row rather than in a narrow column each.
   */
  #akashicClassesPanel(a) {
    const list = 'akashic.classes';
    const e = a.essence || {};
    // Only the filled class blocks are worth a row; the template's six leave
    // five empty ones behind on most sheets.
    const rows = (a.classes || [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.name || c.mod || c.level || c.essenceCap || c.bonusCap);
    return `<section class="panel span2">
      <h3>Veilweaving <span class="badge">${rows.length} class${rows.length === 1 ? '' : 'es'}</span></h3>
      <div class="akashic-head">
        <div class="ak-classes">
          <table class="build"><thead><tr>
            <th>Class</th><th>Mod</th><th class="num">Lvl</th>
            <th class="num">Ess.</th><th class="num">Bonus</th><th class="num">Cap</th><th></th>
          </tr></thead><tbody>
            ${rows.map(({ c, i }) => `<tr>
              <td>${this.#itemText(list, i, 'name', c.name, 'Class')}</td>
              <td>${this.#select(`${list}.${i}.mod`, c.mod, ABILITY_LABELS_LIST)}</td>
              <td class="num">${this.#itemNum(list, i, 'level', c.level)}</td>
              <td class="num">${this.#itemNum(list, i, 'essenceCap', c.essenceCap)}</td>
              <td class="num">${this.#itemNum(list, i, 'bonusCap', c.bonusCap)}</td>
              <td class="num total">${c.totalCap ?? 0}</td>
              ${this.#rowRemove(list, i)}
            </tr>`).join('') || `<tr><td colspan="7" class="empty">No veilweaving class.</td></tr>`}
          </tbody></table>
          <div class="pair" style="margin-top:6px">
            ${this.#addButton(list, 'Add class', {
    name: '', mod: null, level: 0, essenceCap: 0, bonusCap: 0, baseDC: 0, steadyVeilDC: 0,
  })}
            <label class="minifield">Base DC
              ${this.#num('akashic.baseDC', a.baseDC, 'style="width:3.4rem"')}</label>
            <label class="minifield">Steady veil DC
              ${this.#num('akashic.steadyVeilDC', a.steadyVeilDC, 'style="width:3.4rem"')}</label>
          </div>
        </div>

        <div class="ak-pool">
          <div class="subhead">Essence pool</div>
          <table class="build"><tbody>
            <tr><th scope="row">Pool</th>
              <td class="num">${this.#num('akashic.essence.pool', e.pool)}</td></tr>
            ${ESSENCE_SOURCES.map(([key, label]) => (key === 'boon' && a.calc?.traditionBoon ? `<tr>
              <th scope="row" title="The casting tradition's own pool, taken as essence rather than spell points — set on the Spheres &amp; Magic tab">
                ${esc(label)}</th>
              <td class="num total">${a.calc.traditionBoon}</td>
            </tr>` : `<tr>
              <th scope="row">${esc(label)}</th>
              <td class="num">${this.#num(`akashic.essence.${key}`, e[key])}</td>
            </tr>`)).join('')}
            <tr${a.calc?.sourcesShort ? ` title="These sources come to ${a.calc.sources}, but the daily pool above is ${a.calc.pool} — the sheet's own total. Adjust the pool if the difference is real."` : ''}>
              <th scope="row">Sources${a.calc?.sourcesShort ? ' <span class="badge err">≠ pool</span>' : ''}</th>
              <td class="num total">${a.calc?.sources ?? 0}</td></tr>
          </tbody></table>
        </div>
      </div>
    </section>`;
  }

  /**
   * The slot board.
   *
   * Fifteen slots, most of them empty on any given day, so they lay out as
   * narrow cards rather than fifteen full-width blocks. Empty slots collapse
   * behind a toggle by default: what a player wants to see is the four or five
   * veils they actually shaped.
   */
  #akashicSlotsPanel(a) {
    const list = 'akashic.slots';
    const slots = a.slots || [];
    const shaped = slots.filter((s) => (s.veils || []).length).length;
    const showEmpty = !!this.#model.data.uiPrefs?.collapsed?.['veil:showEmpty'];
    const shown = slots.map((s, i) => ({ s, i }))
      .filter(({ s }) => showEmpty || (s.veils || []).length);

    return `<section class="panel span2">
      <h3>Veil slots
        <span class="badge">${shaped} shaped</span>
        <span class="badge">${slots.length} slots</span>
        <span class="pair" style="margin-left:auto">
          ${this.#veilColumnsControl()}
          <button data-collapse="veil:showEmpty" aria-pressed="${showEmpty}">
            ${showEmpty ? 'Hide empty slots' : `Show ${slots.length - shaped} empty`}
          </button>
          ${this.#addButton(list, 'Add slot', {
    slot: '', bound: false, twinveil: false, veils: [],
  })}
        </span>
      </h3>
      <p class="hint">One veil to a slot, or two with Twinveil. A veil's save DC
        is the base DC plus the essence invested in it. A description may carry
        <code>{name = expr}</code> formulas, the same as anywhere else.</p>
      ${shown.length
    ? `<div class="veils"${this.#veilGridStyle()}>${shown.map(({ s, i }) => this.#veilSlotCard(list, s, i)).join('')}</div>`
    : '<p class="empty">No veils shaped.</p>'}
    </section>`;
  }

  /**
   * How many veil cards sit on a row.
   *
   * Auto-fill packs as many 250px cards as the window allows, which on a wide
   * screen is five and leaves each veil's name and description squeezed. A
   * fixed count trades a column for width per card, so the choice is the
   * player's and it persists with the character.
   */
  #veilColumnsControl() {
    const cols = this.#veilColumns();
    return `<span class="seg" role="group" aria-label="Veil cards per row">
      <span class="seg-k">Per row</span>
      ${[[0, 'Auto'], [3, '3'], [4, '4'], [5, '5']].map(([n, label]) => `
        <button data-veilcols="${n}" aria-pressed="${cols === n}"
          title="${n ? `${n} veil cards to a row` : 'As many as fit'}">${label}</button>`).join('')}
    </span>`;
  }

  /** The saved count, defaulting to four -- five is where the cards get tight. */
  #veilColumns() {
    const v = this.#model.data.uiPrefs?.veilColumns;
    return v === undefined ? 4 : Number(v) || 0;
  }

  /**
   * A pinned count as a track size rather than `repeat(N, …)`, so a narrow
   * window still drops to fewer columns instead of overflowing. The half pixel
   * keeps rounding from fitting one column more than was asked for.
   */
  #veilGridStyle() {
    const n = this.#veilColumns();
    if (!n) return '';
    return ` style="--veil-track:max(230px, calc((100% - ${(n - 1) * 8}px) / ${n} - 0.5px))"`;
  }

  #veilSlotCard(list, s, i) {
    const base = `${list}.${i}`;
    const veils = s.veils || [];
    const max = s.twinveil ? 2 : 1;
    const key = `veil:${s.slot || i}`;
    const collapsed = !!this.#model.data.uiPrefs?.collapsed?.[key];

    return `<div class="veilslot${collapsed ? ' is-collapsed' : ''}">
      <div class="veilslot-head">
        <button class="disclose" data-collapse="${esc(key)}"
          aria-expanded="${!collapsed}" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</button>
        ${this.#select(`${base}.slot`, s.slot, VEIL_SLOTS, null)}
        <span class="vcount" title="veils shaped / slots available">${veils.length}<i>/</i>${max}</span>
        ${this.#rowRemoveButton(list, i, `Remove the ${s.slot || 'unnamed'} slot`)}
      </div>
      ${collapsed ? '' : `<div class="veilslot-body">
        <div class="veilflags">
          ${this.#check(`${base}.twinveil`, s.twinveil, 'Twinveil')}
          ${this.#check(`${base}.bound`, s.bound, 'Bound')}
        </div>
        ${veils.map((v, vi) => this.#veilCard(`${base}.veils`, v, vi)).join('')}
        ${veils.length < max
    ? `<div style="margin-top:4px">${this.#addButton(`${base}.veils`, 'Shape a veil', { name: '', desc: '', essence: 0 })}</div>`
    : ''}
      </div>`}
    </div>`;
  }

  /** One shaped veil: its name, what it does, and what it costs. */
  #veilCard(list, v, vi) {
    return `<div class="veil">
      <div class="veil-top">
        ${this.#itemText(list, vi, 'name', v.name, 'Veil name')}
        <label class="minifield" title="essence invested">Ess
          ${this.#itemNum(list, vi, 'essence', v.essence)}</label>
        <span class="veil-dc" title="base DC + essence">DC ${v.dc ?? 0}</span>
        ${this.#rowRemoveButton(list, vi, 'Unshape this veil')}
      </div>
      ${this.#itemArea(list, vi, 'desc', v.desc, 2, this.#model.veilScope(v))}
    </div>`;
  }

  /** The × from #rowRemove, without the surrounding table cell. */
  #rowRemoveButton(list, i, title) {
    return `<button class="danger tiny" data-remove="${list}|${i}"
      title="${esc(title)}" aria-label="${esc(title)}">×</button>`;
  }

  #akashicKheshigPanel(a) {
    const list = 'akashic.kheshig';
    if (!(a.kheshig || []).length) return '';
    return `<section class="panel span2">
      <h3>Kheshig receptacles</h3>
      <p class="hint">A weapon or armour veil takes the slot it names rather than
        occupying one of its own.</p>
      <div class="veils"${this.#veilGridStyle()}>
        ${(a.kheshig || []).map((r, i) => `<div class="veilslot">
          <div class="veilslot-head">
            <span class="klabel" title="${esc(r.label)}">${esc(r.label.replace(' (Kheshig)', ''))}</span>
            ${this.#select(`${list}.${i}.slot`, r.slot, VEIL_SLOTS)}
          </div>
          <div class="veilslot-body">
            <div class="veilflags">${this.#check(`${list}.${i}.bound`, r.bound, 'Bound')}</div>
            ${(r.veils || []).length
    ? (r.veils || []).map((v, vi) => this.#veilCard(`${list}.${i}.veils`, v, vi)).join('')
    : `<div style="margin-top:4px">${this.#addButton(`${list}.${i}.veils`, 'Shape a veil', { name: '', desc: '', essence: 0 })}</div>`}
          </div>
        </div>`).join('')}
      </div>
    </section>`;
  }

  #akashicReceptaclesPanel(a) {
    const list = 'akashic.otherReceptacles';
    const rows = a.otherReceptacles || [];
    // Some sheets tick a receptacle on or off beside its essence; a sheet that
    // never did should not grow a column of dead checkboxes.
    const ticks = rows.some((r) => r.active !== undefined);
    return `<section class="panel span2">
      <h3>Other receptacles <span class="badge">${rows.length}</span></h3>
      <p class="hint">Anything holding essence that is not one of the slots above.
        Their essence counts against the day's pool the same way a veil's does.</p>
      ${rows.length ? `<div class="veils"${this.#veilGridStyle()}>
        ${rows.map((r, i) => `<div class="veilslot${ticks && !r.active ? ' is-off' : ''}">
          <div class="veilslot-body">
            <div class="veil">
              <div class="veil-top">
                ${this.#itemText(list, i, 'name', r.name, 'Receptacle')}
                <label class="minifield" title="essence invested">Ess
                  ${this.#itemNum(list, i, 'essence', r.essence)}</label>
                ${this.#rowRemoveButton(list, i, 'Remove this receptacle')}
              </div>
              ${ticks ? `<div class="veilflags">${this.#check(`${list}.${i}.active`, r.active, 'On')}</div>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>` : '<p class="empty">None.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add receptacle', { name: '', essence: 0 })}</div>
    </section>`;
  }

  /* ---------------- path of war maneuvers ---------------- */

  /**
   * Disciplines as tick lists, side by side.
   *
   * Knowing a discipline grants everything in it, so the character picks the
   * discipline from the shared catalogue and the maneuvers it grants appear
   * underneath to be readied. Each discipline is a narrow column rather than a
   * full-width table: the useful width is a name and a tick box, and a dozen
   * disciplines want to be readable side by side.
   */
  #maneuversPanel() {
    const m = this.#model.data.maneuvers;
    if (!m) return '<div class="grid"><p class="empty">No maneuver data.</p></div>';
    const k = m.calc || {};
    const taken = new Set((m.disciplines || []).map((d) => d.name));
    const available = maneuverCatalogue().disciplines
      .map((d) => d.name).filter((name) => !taken.has(name));

    return `<div class="grid">
      <section class="panel span2">
        <h3>Maneuvers ${k.legal === false ? '<span class="badge err">over the limit</span>' : ''}</h3>
        <div class="statbar">
          ${this.#miniStat('Maneuvers', `${k.maneuvers ?? 0}/${k.possibleManeuvers ?? 0}`)}
          ${this.#miniStat('Stances', `${k.stances ?? 0}/${k.possibleStances ?? 0}`)}
          ${this.#miniStat('Disciplines', (m.disciplines || []).length)}
          <span class="statbar-fill"></span>
          <label class="minifield">Maneuvers allowed
            ${this.#num('maneuvers.possibleManeuvers', m.possibleManeuvers, 'style="width:3.4rem"')}</label>
          <label class="minifield">Stances allowed
            ${this.#num('maneuvers.possibleStances', m.possibleStances, 'style="width:3.4rem"')}</label>
        </div>
        <div class="pair" style="margin-top:8px">
          <select data-action="add-discipline" aria-label="Add a discipline">
            <option value="">Train a discipline…</option>
            ${available.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
          </select>
          ${available.length ? '' : '<span class="hint">Every discipline in the catalogue is trained.</span>'}
        </div>
        <p class="hint" style="margin-top:6px">
          Tick a maneuver to ready it. <strong>Right-click</strong> one to open its
          page on the <a href="${esc(WIKI_BASE)}" target="_blank" rel="noopener noreferrer">wiki</a>
          in a new tab.
        </p>
      </section>

      <section class="panel span2 discipline-wrap">
        ${(m.disciplines || []).length
    ? `<div class="disciplines">${(m.disciplines || []).map((d, i) => this.#disciplineColumn(d, i)).join('')}</div>`
    : '<p class="empty">No disciplines trained. Pick one above to see what it grants.</p>'}
      </section>

      ${this.#systemExtrasPanel(m, 'maneuvers', 'Maneuvers')}
    </div>`;
  }

  /**
   * One discipline: its readied count, then every maneuver it grants, grouped
   * by level. Ticking a row readies it; the row itself comes from the shared
   * catalogue and is not stored on the character.
   */
  #disciplineColumn(d, i) {
    const list = `maneuvers.disciplines.${i}`;
    const entries = d.entries || [];
    const levels = [...new Set(entries.map((e) => e.level))].sort((a, b) => a - b);
    const collapsed = !!this.#model.data.uiPrefs?.collapsed?.[`disc:${d.name}`];

    return `<div class="discipline${collapsed ? ' is-collapsed' : ''}">
      <div class="discipline-head">
        <button class="disclose" data-collapse="disc:${esc(d.name)}"
          aria-expanded="${!collapsed}" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</button>
        <span class="dname" title="${esc(d.name)}">${esc(d.name) || '<em>Unnamed</em>'}</span>
        <span class="dcount" title="readied maneuvers / stances">${d.knownManeuvers ?? 0}<i>/</i>${d.knownStances ?? 0}</span>
        <button class="danger tiny" data-remove="maneuvers.disciplines|${i}"
          title="Stop training ${esc(d.name)}" aria-label="Remove discipline">×</button>
      </div>
      ${collapsed ? '' : `<div class="discipline-body">
        ${d.inCatalogue === false && !entries.length
    ? '<p class="empty">Not in the catalogue.</p>' : ''}
        ${levels.map((lvl) => `
          <div class="dlevel">${lvl ? `Level ${lvl}` : 'Other'}</div>
          ${entries.map((e, ei) => [e, ei]).filter(([e]) => e.level === lvl).map(([e, ei]) => {
    const wiki = wikiUrl(e.name);
    const note = (d.notes || {})[e.name] || '';
    const noteKey = `${list}|${e.name}`;
    const noteOpen = this.#openManeuverNote === noteKey;
    return `
            <label class="mrow${e.known ? ' is-known' : ''}"
              title="${esc(e.name)}${e.type ? ` — ${esc(e.type)}` : ''}${wiki ? '\n\nRight-click to open the wiki' : ''}"
              ${wiki ? `data-wiki="${esc(wiki)}"` : ''}>
              <input type="checkbox" ${e.known ? 'checked' : ''}
                data-ready="${list}|${esc(e.name)}" data-kind="bool">
              <span class="mname">${esc(e.name)}</span>
              <span class="mtype ${e.kind === 'stance' ? 'is-stance' : ''}">${esc(shortType(e.type))}</span>
              ${e.known ? `<button class="mnote-btn${note ? ' has-note' : ''}" data-mnote-toggle="${esc(noteKey)}"
                title="${note ? 'Its overview note — click to edit' : 'Give it a note for the overview card — {…} formulas work'}"
                aria-label="Overview note for ${esc(e.name)}" aria-expanded="${noteOpen}">✎</button>` : ''}
            </label>
            ${noteOpen ? `<div class="mnote-edit">${this.#prose(`data-mnote="${esc(noteKey)}"`, note, 2, 'grow')}</div>` : ''}`;
  }).join('')}
        `).join('')}
      </div>`}
    </div>`;
  }

  /* ---------------- vancian casting ---------------- */

  /**
   * Casting classes and their spell tables.
   *
   * Every number here is derived, the way the workbook derived it before Excel
   * froze its formulas into what looked like a hand-typed grid: caster level
   * from the Planner, slots and spells known from the shared casting table,
   * bonus slots from the casting stats, the DC from the rule. Each cell will
   * still take a number, which then overrides the one behind it.
   */
  #vancianPanel() {
    const v = this.#model.data.vancian;
    if (!v) return '<div class="grid"><p class="empty">No casting data.</p></div>';

    const unknown = v.calc?.unknownSlotTypes || [];
    return `<div class="grid">
      <section class="panel span2">
        <h3>Vancian casting
          ${v.calc?.spent ? `<span class="badge">${v.calc.spent} spent today</span>` : ''}
          <span class="pair" style="margin-left:auto">
            <button data-action="vancian-new-day"
              title="Everything spent comes back">New day</button>
          </span>
        </h3>
        <p class="hint">A block picks the class whose table it draws slots from, which
          is separate from what you call it — so an archetype keeps its own name.
          Slots per day, spells known and the save DC all follow from that, the caster
          level counted off the Planner, and the casting stats. Type into any of them
          to override.</p>
        ${unknown.length ? `<p class="hint warn">No casting table for
          ${unknown.map((n) => `<strong>${esc(n)}</strong>`).join(', ')} — those blocks
          keep whatever numbers you give them.</p>` : ''}
        ${(v.classes || []).length ? '' : '<p class="empty">No casting classes yet.</p>'}
      </section>

      ${(v.classes || []).map((c, i) => this.#castingClassPanel(c, i)).join('')}

      <section class="panel span2">
        ${this.#addButton('vancian.classes', 'Add casting class', {
    name: '', slotType: '', stat: '', stat2: '', prep: '', source: '',
    casterLevelOverride: null, concentration: 0,
    spells: SPELL_LEVELS.map((level) => ({ level, perDay: null, known: null })),
  })}
      </section>
      ${this.#vancianPreparedPanel(v)}
      ${this.#systemExtrasPanel(v, 'vancian', 'Vancian Magic')}
    </div>`;
  }

  #castingClassPanel(c, i) {
    const base = `vancian.classes.${i}`;
    const noun = c.noun || castingNoun(c.source);
    const style = prepStyle(c.prep);
    const hasBonus = (c.spells || []).some((s) => s.classBonus !== null && s.classBonus !== undefined);
    /*
     * Where the spending happens. A spontaneous or hybrid caster spends an
     * anonymous slot of a given level, so the count per level is the whole story
     * and it belongs here. A prepared caster committed each slot to a named spell
     * in advance, so theirs is spent in the spell list instead -- two castings of
     * one spell is a different thing from one each of two.
     */
    const spends = style.slots === 'pool';
    // Worth saying when a block has been pinned away from what the Planner counts.
    const drift = c.casterLevelOverride !== null && c.casterLevelOverride !== undefined
      && Number(c.casterLevel) !== Number(c.plannerLevel);

    return `<section class="panel span2">
      <h3>
        ${this.#itemText('vancian.classes', i, 'name', c.name, 'Casting class')}
        <span class="badge">CL ${c.casterLevel ?? 0}</span>
        <span class="badge">${spends && c.totalLeft !== c.totalPerDay ? `${c.totalLeft ?? 0} of ` : ''}${c.totalPerDay ?? 0} ${esc(noun.many.toLowerCase())}/day</span>
        ${c.highestLevel ? `<span class="badge">up to level ${c.highestLevel}</span>` : ''}
        ${c.slotTypeUnknown ? '<span class="badge">no table</span>' : ''}
        <span class="pair" style="margin-left:auto">
          <button class="danger" data-remove="vancian.classes|${i}">Remove</button>
        </span>
      </h3>
      <div class="fieldgrid">
        ${this.#field('Casting stat', this.#select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST))}
        ${this.#field('Second stat', this.#select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST))}
        ${this.#field('Prepared as', this.#select(`${base}.prep`, c.prep,
    PREP_STYLES.map((p) => [p.key, p.label])))}
        ${this.#field('Source', this.#select(`${base}.source`, c.source,
    CASTING_SOURCES.map((s) => [s.key, s.label])))}
        ${this.#field('Slot table', this.#select(`${base}.slotType`, c.slotType, castingTableNames()))}
        ${this.#field('Caster level', `<input type="number" value="${c.casterLevelOverride ?? ''}"
          placeholder="${c.plannerLevel ?? 0}" data-set="${base}.casterLevelOverride"
          data-kind="number-or-null"
          title="Auto: ${c.plannerLevel ?? 0} level(s) of this class in the Planner. Enter a number to pin it.">`)}
        ${this.#field('Concentration', `<span class="rollpair">${
          this.#num(`${base}.concentration`, c.concentration)}${
          this.#rollButton('concentration', `vancian:${i}`,
            `${c.name || 'this class'} concentration`)}</span>`)}
      </div>
      ${this.#line('Stat modifier', fmt(c.statMod ?? 0))}
      ${c.tableName && c.tableName !== c.slotType
    ? `<p class="hint">Reading <strong>${esc(c.tableName)}</strong>'s table.</p>` : ''}
      ${drift ? `<p class="hint">The Planner gives ${c.plannerLevel} level${c.plannerLevel === 1 ? '' : 's'}
        of this class.</p>` : ''}
      <table class="build" style="margin-top:8px"><thead><tr>
        <th>${esc(noun.one)} level</th>
        <th class="num">${esc(noun.many)}/day</th>
        ${hasBonus ? '<th class="num" title="Granted by the class itself, on top of the slots">Bonus</th>' : ''}
        <th class="num">${esc(noun.many)} known</th>
        <th class="num">DC</th>
        ${spends ? '<th title="Click a pip to spend or restore">Left today</th>' : ''}
      </tr></thead><tbody>
        ${(c.spells || []).map((s, si) => {
    const auto = slotText(s);
    const breakdown = s.base === null || s.base === undefined
      ? (s.atWill ? 'At will — the class knows cantrips' : 'Not castable at this level')
      : `${s.base} from the table${s.abilityBonus ? ` + ${s.abilityBonus} for the casting stat` : ''}`;
    const autoKnown = s.knownCount === null || s.knownCount === undefined ? '—' : String(s.knownCount);
    return `<tr>
          <th scope="row">${s.level}</th>
          <td class="num"><input type="number" value="${s.perDay ?? ''}" placeholder="${esc(auto)}"
            data-item="${base}.spells|${si}|perDay" data-kind="number-or-null" style="width:4.2rem"
            title="${esc(breakdown)}. Type a number to override."></td>
          ${hasBonus ? `<td class="num total">${val(s.classBonus)}</td>` : ''}
          <td class="num"><input type="number" value="${s.known ?? ''}" placeholder="${esc(autoKnown)}"
            data-item="${base}.spells|${si}|known" data-kind="number-or-null" style="width:4.2rem"
            title="${style.known ? 'From the table. Type a number to override.'
      : 'A prepared caster fills slots from a spellbook, so this is not slot-derived.'}"></td>
          <td class="num total">${s.dc ?? 0}</td>
          ${spends ? `<td>${s.atWill ? '<span class="hint">at will</span>'
      : slotSpend({
        path: `${base}.spells|${si}|used`,
        total: s.slots,
        left: s.left,
        name: `${noun.one} level ${s.level}`,
      })}</td>` : ''}
        </tr>`;
  }).join('')}
      </tbody></table>
    </section>`;
  }

  /**
   * The spell list, and where a prepared caster spends.
   *
   * A prepared caster commits an exact number of uses to each spell, so the pool
   * hangs off the row: prepare Cure Light Wounds three times and that row gets
   * three. The squares shape suits it -- a handful of discrete uses, small enough
   * to read without counting, giving way to a count when there are more.
   *
   * A row with a label and no spell is a section heading the player wrote, and
   * gets no pool of its own.
   */
  #vancianPreparedPanel(v) {
    const list = 'vancian.prepared';
    const rows = v.prepared || [];
    const spells = rows.filter((r) => r.name).length;
    return `<section class="panel span2">
      <h3>Spell list <span class="badge">${spells}</span>
        ${v.calc?.spent ? `<span class="badge">${v.calc.spent} spent today</span>` : ''}
      </h3>
      <p class="hint">The workbook's first column could never be a tick box — a formula
        cell cannot also be something you reset each morning — so players used it as a
        label instead. Whatever is in it is kept as written; <strong>Prepared</strong> is
        how many times this spell is committed, and the squares beside it are what is
        left of them. <strong>Notes</strong> reads {…} like any prose, so a spell's text
        can carry its numbers — <code>heals {2 + level}d8</code> — and stay right.</p>
      ${rows.length ? `<table class="spelllist"><thead><tr>
        <th style="width:6.5rem">Label</th>
        <th style="width:4.5rem" title="Class and spell level">C / L</th>
        <th style="width:13rem">Spell</th>
        <th title="The spell's text or your own note — {…} formulas resolve">Notes</th>
        <th class="num" style="width:4rem" title="How many times this spell is prepared">Prep.</th>
        <th style="width:4.5rem" title="Click a square to spend or restore">Left</th><th></th>
      </tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td>${this.#itemText(list, i, 'prepUsed', r.prepUsed, '')}</td>
          <td>${this.#itemText(list, i, 'classLevel', r.classLevel, '')}</td>
          <td>${this.#itemText(list, i, 'name', r.name, 'Spell')}</td>
          <td>${r.name ? this.#prose(`data-item="${list}|${i}|note"`, r.note, 1, 'grow') : ''}</td>
          <td class="num">${r.name ? this.#itemNum(list, i, 'uses', r.uses) : ''}</td>
          <td class="spendcell">${r.name ? slotSpend({
    path: `${list}|${i}|used`, total: r.uses, left: r.left, shape: 'squares', name: r.name,
  }) : ''}</td>
          ${this.#rowRemoveArmed(list, i, r.name || 'this row')}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No spells listed.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add spell', {
    prepUsed: '', classLevel: '', name: '', uses: 1, used: 0, note: '',
  })}</div>
    </section>`;
  }

  /* ---------------- primordia techniques ---------------- */

  /**
   * The technique, and the ladder it advances on.
   *
   * The workbook had this in four places and modelled it in none: the choice
   * is a dropdown on Character Info, and the ten levels it grants at are
   * printed on the Planner, on Vancian Magic and on Psionics -- three empty
   * copies of the same rows, none beside the choice they belong to. Here the
   * choice picks the ladder, the ladder states what each level hands over,
   * and the column beside it is what you took for it.
   */
  #primordiaPanel() {
    const c = this.#model.data;
    const p = c.primordia || {};
    const k = p.calc || {};
    const level = Number(c.identity.level) || 0;
    const n = k.counts || {};

    const prereq = k.prereq;
    const prereqBadge = !prereq ? ''
      : `<span class="badge ${prereq.state === 'met' ? 'ok' : prereq.state === 'unmet' ? 'err' : ''}"
          title="${esc(prereq.detail || '')}">${
  prereq.state === 'met' ? 'prerequisite met'
    : prereq.state === 'unmet' ? 'prerequisite not met' : 'prerequisite unchecked'}</span>`;

    // Only the kinds this technique actually deals in: a Light Body ladder has
    // no business showing a spell count of zero.
    const totals = [
      ['Talents', n.talent, k.talents ? `${k.talents.count} ${k.talents.sphere} talents, counted into ${k.talents.side === 'magic' ? 'magic' : 'combat'} training` : ''],
      ['Feats', n.feat, 'Bonus feats granted so far'],
      ['Spells known', n.spell, 'Divination spells added so far'],
      ['Powers known', n.power, 'Clairsentience powers added so far'],
    ].filter(([, v]) => v);

    return `<div class="grid">
      <section class="panel span2">
        <h3>Primordia Technique ${prereqBadge}
          ${n.due ? `<span class="badge due" title="Levels reached with nothing written against them">${n.due} to pick</span>` : ''}
        </h3>
        <div class="statbar">
          <label class="minifield">Technique
            ${this.#select('identity.primordiaTechnique', c.identity.primordiaTechnique, PRIMORDIA_NAMES, '— none —')}</label>
          ${totals.map(([label, v, title]) => this.#miniStat(label, v, title)).join('')}
          <span class="statbar-fill"></span>
          ${this.#miniStat('Level', level, 'Grants above this level are planned, not counted')}
        </div>
        ${prereq ? `<p class="hint" style="margin-top:6px">
          <strong>Prerequisite:</strong> ${esc(prereq.text)}${prereq.detail ? ` — ${esc(prereq.detail)}` : ''}
          ${prereq.state === 'unmet' ? ' The technique still works here; this is a note, not a lock.' : ''}
        </p>` : ''}
        ${k.note ? `<p class="hint">${esc(k.note)}</p>` : ''}
        ${k.unknown ? `<p class="hint warn">The sheet says
          <strong>${esc(c.identity.primordiaTechnique)}</strong>, which is not one of the five —
          the ladder below is empty until it names one of them. Whatever is written against a
          level is kept either way.</p>` : ''}
        <p class="hint">
          One technique, taken at 1st level or whenever its prerequisite is first met, granting
          at 1st, 3rd, 5th, then ${PRIMORDIA_REPEAT_FROM}th and every two levels after.
          <strong>Grants</strong> is what the rules hand over; the column beside it is what you
          took for it. A technique feat can be swapped under the Associated Feat rules if you
          are later given a feat for a sphere or talent you already have.
        </p>
      </section>

      ${k.technique ? this.#primordiaLadder(k) : this.#primordiaChooser()}

      <section class="panel span2">
        <h3>Notes</h3>
        ${this.#prose('data-set="primordia.notes"', p.notes, 3, 'grow')}
        <p class="hint">Resolves <code>{name = expr}</code> like any other prose field on the sheet.</p>
      </section>
    </div>`;
  }

  /** The ten granting levels, what each hands over, and what was taken for it. */
  #primordiaLadder(k) {
    return `<section class="panel span2">
      <div class="tablewrap"><table class="build primordia">
        <thead><tr>
          <th class="num">Lvl</th>
          <th>Grants</th>
          <th>Choice / notes</th>
        </tr></thead>
        <tbody>${(k.rows || []).map((row) => {
    const pick = row.pick;
    const state = !pick ? '' : row.due ? ' due' : row.filled ? '' : ' planned';
    return `<tr class="${row.reached ? '' : 'future'}">
          <td class="num" title="${row.repeating ? 'Every two levels from the 7th' : `The technique's ${row.level}${row.level === 1 ? 'st' : row.level === 3 ? 'rd' : 'th'}-level grant`}">${row.level}</td>
          <td class="grants">${row.grants.map((g) => `
            <span class="grant"${row.repeating && g.short ? ` title="${esc(g.text)}"` : ''}>${
  esc(row.repeating && g.short ? g.short : g.text)}${g.cite === 'EitR' && !row.repeating
    ? ` <a href="${esc(EITR_URL)}" target="_blank" rel="noopener noreferrer" title="Elephant in the Room">[EitR]</a>` : ''}</span>
            ${g.base?.alt ? `<label class="chk alt"><input type="checkbox" ${g.alt ? 'checked' : ''}
              data-set="primordia.alt.${row.level}" data-kind="bool"
              title="${esc(g.base.text)} — tick if you already had it, so this level grants the spell instead">
              <span>already had the feat, so this level grants ${esc(g.base.alt.text
    .replace(/^One /, 'a ').replace(/ added to your spells known$/, ''))} instead</span></label>` : ''}
          `).join('')}</td>
          <td class="choice${state}">${this.#primordiaPick(row)}</td>
        </tr>`;
  }).join('')}</tbody>
      </table></div>
      ${k.repeat ? `<p class="hint repeatrule">
        <strong>From ${PRIMORDIA_REPEAT_FROM}th, every two levels:</strong> ${esc(k.repeat.text)}
        ${k.repeat.cite === 'EitR' ? `<a href="${esc(EITR_URL)}" target="_blank" rel="noopener noreferrer">[EitR]</a>` : ''}
      </p>` : ''}
      <p class="hint">
        A level you have reached with a choice still to make is outlined and counted above;
        one you have not reached yet is dotted — the plan, not a chore. Levels whose grant is
        fixed still take a note, which is where the sheet's own ladder was written.
      </p>
    </section>`;
  }

  /** The pick cell: a dropdown where the rules offer two, otherwise free text. */
  #primordiaPick(row) {
    const path = `primordia.picks.${row.level}`;
    const options = row.pick?.options;
    if (options) return this.#select(path, row.text, options);
    const placeholder = row.pick?.placeholder || 'Notes';
    // A pick carrying an inline formula shows what it comes to, the same way a
    // progression feature cell does.
    return hasTokens(row.text)
      ? this.#prose(`data-set="${path}"`, row.text, 1, 'grow')
      : `<input type="text" value="${esc(row.text)}" data-set="${path}" data-kind="text"
          placeholder="${esc(placeholder)}">`;
  }

  /** With no technique taken, the five on offer and what each asks for. */
  #primordiaChooser() {
    return `<section class="panel span2">
      <h3>The five techniques</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>Technique</th><th>Prerequisite</th><th>1st level</th><th>Then, every other level from 7th</th></tr></thead>
        <tbody>${PRIMORDIA_TECHNIQUES.map((t) => `<tr>
          <td><button data-action="take-technique" data-name="${esc(t.name)}"
            title="Take ${esc(t.name)}">${esc(t.name)}</button></td>
          <td>${esc(t.prereq.text)}</td>
          <td>${(t.grants[1] || []).map((g) => esc(g.text)).join('; ')}</td>
          <td>${esc(t.repeat?.text || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Pick one — the ladder replaces this table, and nothing written on it is
        lost if you change your mind.</p>
    </section>`;
  }

  /* ---------------- psionics ---------------- */

  /**
   * Manifesting classes and the day's power points.
   *
   * One pool for the whole character, which is what a draining bar is for: it
   * shows what is left rather than what is gone, and a psion spends out of it all
   * day. Everything feeding it is derived -- the curve, the manifester level, the
   * ability half-share -- so the only things to type are which curve a class runs
   * on, its abilities, and the bonus points a feat or item handed over.
   *
   * A class picks its curve by the total that curve reaches at level 20, never by
   * name. That is how the workbook did it, and it means a homebrew manifesting
   * class needs nothing added anywhere: pick the curve it runs on.
   */
  #psionicsPanel() {
    const p = this.#model.data.psionics;
    if (!p) return '<div class="grid"><p class="empty">No psionic data.</p></div>';

    const pool = Number(p.pool) || 0;
    const left = Number(p.left) || 0;
    const unknown = p.calc?.unknownCurves || [];

    return `<div class="grid">
      <section class="panel span2">
        <h3>Power points
          <span class="badge">${left} of ${pool}</span>
          ${p.spent ? `<span class="badge">${p.spent} spent today</span>` : ''}
          <span class="pair" style="margin-left:auto">
            <button data-action="psionics-new-day" title="The whole pool comes back">New day</button>
            ${this.#meterStyleButton('pp')}
          </span>
        </h3>
        ${this.#meterVisual(this.#model.meterSpec('pp'))}
        ${this.#meterStyleEditor('pp')}
        <div class="tracker-controls" style="margin-top:6px">
          <button data-pool-step="-1" aria-label="Spend one power point">−</button>
          <input type="number" value="${left}" data-pool-left aria-label="Power points remaining">
          <span class="pool">/ ${pool}</span>
          <button data-pool-step="1" aria-label="Restore one power point">+</button>
        </div>
        <div class="fieldgrid" style="margin-top:8px">
          ${this.#field('Bonus points', this.#num('psionics.bonusPoints', p.bonusPoints))}
        </div>
        <p class="hint">The pool is every manifesting class's points plus the bonus —
          a feat or an item, which is the one line of the workbook's panel that was
          typed rather than worked out. Readable from a formula as
          <code>pp.pool</code>, <code>pp.left</code> and <code>pp.spent</code>.</p>
        ${unknown.length ? `<p class="hint warn">No power-point curve reaching
          ${unknown.map((n) => `<strong>${esc(n)}</strong>`).join(', ')} at level 20 —
          those classes contribute nothing until a curve is picked.</p>` : ''}
        ${(p.classes || []).length ? '' : '<p class="empty">No manifesting classes yet.</p>'}
      </section>

      ${(p.classes || []).map((c, i) => this.#manifestingClassPanel(c, i)).join('')}

      <section class="panel span2">
        ${this.#addButton('psionics.classes', 'Add manifesting class', {
    name: '', stat: '', stat2: '', curveTotal: 0, manifesterLevelOverride: null, powers: [],
  })}
      </section>
      ${this.#systemExtrasPanel(p, 'psionics', 'Psionics')}
    </div>`;
  }

  /** The curve options, labelled with the classes the reference tab lists for each. */
  #curveOptions() {
    const classes = psionicTables().classes || [];
    return psionicCurveTotals().map((total) => {
      const names = classes.filter((c) => c.total === total).map((c) => c.name);
      return [total, names.length ? `${total} — ${names.join(', ')}` : `${total}`];
    });
  }

  #manifestingClassPanel(c, i) {
    const base = `psionics.classes.${i}`;
    const list = `${base}.powers`;
    const levels = psionicTables().powerLevels || [];
    const pinned = c.manifesterLevelOverride !== null && c.manifesterLevelOverride !== undefined;

    return `<section class="panel span2">
      <h3>
        ${this.#itemText('psionics.classes', i, 'name', c.name, 'Manifesting class')}
        <span class="badge">ML ${c.manifesterLevel ?? 0}</span>
        <span class="badge">${c.points ?? 0} pp</span>
        ${c.powerCount ? `<span class="badge">${c.powerCount} power${c.powerCount === 1 ? '' : 's'}</span>` : ''}
        ${c.curveTotal && !c.curveKnown ? '<span class="badge">no curve</span>' : ''}
        <span class="pair" style="margin-left:auto">
          <button class="danger" data-remove="psionics.classes|${i}">Remove</button>
        </span>
      </h3>
      <div class="fieldgrid">
        ${this.#field('Ability 1', this.#select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST))}
        ${this.#field('Ability 2', this.#select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST))}
        ${this.#field('Points at 20', this.#select(`${base}.curveTotal`, c.curveTotal, this.#curveOptions()))}
        ${this.#field('Manifester level', `<input type="number" value="${c.manifesterLevelOverride ?? ''}"
          placeholder="${c.plannerLevel ?? 0}" data-set="${base}.manifesterLevelOverride"
          data-kind="number-or-null"
          title="Auto: ${c.plannerLevel ?? 0} level(s) of this class in the Planner. Enter a number to pin it.">`)}
      </div>
      ${this.#line('From the curve', c.basePoints === null ? '—' : c.basePoints)}
      ${this.#line('From abilities', fmt(c.abilityPoints ?? 0))}
      ${pinned && Number(c.manifesterLevel) !== Number(c.plannerLevel)
    ? `<p class="hint">The Planner gives ${c.plannerLevel} level${c.plannerLevel === 1 ? '' : 's'} of this class.</p>` : ''}
      ${(c.powers || []).length ? `<table style="margin-top:8px"><thead><tr>
        <th>Power</th><th style="width:7rem">Level</th><th></th>
      </tr></thead><tbody>
        ${(c.powers || []).map((w, wi) => `<tr>
          <td>${this.#itemText(list, wi, 'name', w.name, 'Power')}</td>
          <td>${this.#itemSelect(list, wi, 'level', w.level, levels)}</td>
          ${this.#rowRemove(list, wi)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No powers known.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add power', { name: '', level: '' })}</div>
    </section>`;
  }

  /* ---------------- companions ---------------- */

  /**
   * One companion's tab: the familiar, the animal companion or the eidolon.
   *
   * Top: who it is and where its level comes from, with the numbers that
   * matter in play in a strip. Then hit points, ability scores, defences and
   * saves, attacks, skills -- and the panels only one kind has: the eidolon's
   * evolutions, the animal companion's tricks and item slots. Everything not
   * typed is worked out in `companions.js` from the tables the workbook's
   * `dataSheet` carried, and reads back from a formula as `familiar.hp`,
   * `eidolon.evoLeft`, `animalCompanion.str.mod`.
   */
  #companionPanel(kind) {
    const b = this.#model.data[kind];
    if (!b) return '<div class="grid"><p class="empty">No companion data.</p></div>';
    const k = b.calc || {};
    const label = COMPANION_LABELS[kind];
    return `<div class="grid">
      ${this.#companionHeadPanel(kind, b, k, label)}
      ${this.#companionHpPanel(kind, b, k)}
      ${this.#companionScoresPanel(kind, b, k)}
      ${this.#companionDefensePanel(kind, b, k)}
      ${this.#companionSavesPanel(kind, b, k)}
      ${this.#companionAttacksPanel(kind, b, k)}
      ${kind === 'eidolon' ? this.#eidolonEvolutionsPanel(b, k) : ''}
      ${kind === 'animalCompanion' ? this.#companionTricksPanel(b, k) : ''}
      ${kind === 'familiar' ? '' : this.#companionFeatsPanel(kind, b, k)}
      ${this.#companionSkillsPanel(kind, b, k)}
      ${kind === 'animalCompanion' ? this.#companionItemsPanel(b, k) : ''}
      ${this.#companionGainsPanel(kind, b, k, label)}
      ${this.#companionNotesPanel(kind, b)}
    </div>`;
  }

  #companionLevelControls(kind, b, k) {
    if (kind === 'familiar') {
      return `${this.#field('Master level penalty', this.#num(`${kind}.masterLevelPenalty`, b.masterLevelPenalty, 'min="0"'))}
        ${this.#field('Protector archetype', this.#check(`${kind}.protector`, b.protector, 'doubles hit points from 11th'))}`;
    }
    const classes = this.#model.progressionClasses();
    const source = kind === 'animalCompanion'
      ? this.#field('Level from', this.#select(`${kind}.levelSource`, b.levelSource || 'class', COMPANION_LEVEL_SOURCES, null))
      : '';
    const showClass = kind === 'eidolon' || (b.levelSource || 'class') === 'class';
    return `${source}
      ${showClass ? this.#field('Master class', this.#select(`${kind}.masterClass`, b.masterClass, classes)) : ''}
      ${this.#field('Level override', `<input type="number" value="${b.levelOverride ?? ''}"
        placeholder="${k.rawLevel ?? 0}" data-set="${kind}.levelOverride" data-kind="number-or-null" min="0" max="20"
        title="Auto: ${k.rawLevel ?? 0} from ${kind === 'animalCompanion' && b.levelSource === 'handleAnimal' ? 'Handle Animal ranks'
    : kind === 'animalCompanion' && b.levelSource === 'ride' ? 'Ride ranks' : 'the class’s levels in the Planner'}. Enter a number to pin it.">`)}
      ${this.#field('Master level penalty', this.#num(`${kind}.masterLevelPenalty`, b.masterLevelPenalty, 'min="0"'))}`;
  }

  #companionHeadPanel(kind, b, k, label) {
    const saves = k.saves || {};
    const sv = (x) => fmt(saves[x]?.total ?? 0);
    const identity = kind === 'familiar' ? `
        ${this.#field('Creature', this.#text(`${kind}.creature`, b.creature, 'Owl, cat, thrush…'))}
        ${this.#field('Archetypes', this.#text(`${kind}.archetypes`, b.archetypes))}
        ${this.#field('Special ability', this.#text(`${kind}.specialAbility`, b.specialAbility, 'What this familiar grants its master'))}`
      : kind === 'animalCompanion' ? `
        ${this.#field('Creature', this.#text(`${kind}.creature`, b.creature, 'Wolf, roc, big cat…'))}
        ${this.#field('Archetype', this.#text(`${kind}.archetype`, b.archetype))}
        ${this.#field('Body type', this.#select(`${kind}.bodyType`, b.bodyType, BODY_TYPES.map((t) => t.name)))}`
      : `
        ${this.#field('Base form', this.#text(`${kind}.baseForm`, b.baseForm, 'Biped, quadruped, serpentine…'))}
        ${this.#field('Subtype', this.#text(`${kind}.subtype`, b.subtype))}
        ${this.#field('Alignment', this.#text(`${kind}.alignment`, b.alignment))}`;
    return `<section class="panel span2">
      <h3>${esc(label)}
        <span class="badge">level ${k.level ?? 0}</span>
        <span class="badge">${k.hd ?? 0} HD</span>
        ${k.penalty ? `<span class="badge">−${k.penalty} master level</span>` : ''}
        ${!k.level ? '<span class="badge">no level yet</span>' : ''}
      </h3>
      <div class="fieldgrid">
        ${this.#field('Name', this.#text(`${kind}.name`, b.name, `${label} name`))}
        ${identity}
        ${this.#field('Size', this.#select(`${kind}.size`, b.size, Object.keys(SIZE_MODIFIERS), null))}
        ${this.#companionLevelControls(kind, b, k)}
      </div>
      <div class="bigstats" style="margin-top:10px">
        ${this.#bigStat('HP', `${k.hpCurrent ?? 0} / ${k.hpMax ?? 0}`, k.hpTemp ? `+${k.hpTemp} temp` : '')}
        ${this.#bigStat('AC', k.ac ?? 10, `touch ${k.touch ?? 10} · flat ${k.flatFooted ?? 10}`)}
        ${this.#bigStat('Init', fmt(k.initiative ?? 0), 'Dex + bonus', '',
    this.#rollButton(kind, 'init', `${label.toLowerCase()} initiative`))}
        ${this.#bigStat('BAB', fmt(k.bab ?? 0), kind === 'familiar' ? 'master’s' : 'from the table')}
        ${this.#bigStat('Attack', fmt(k.totalAttack ?? 0), `${k.attackAbility || 'Str'} + size`)}
        ${this.#bigStat('CMD', k.cmd ?? 10, `flat ${k.ffCmd ?? 10}`)}
        ${this.#bigStat('Fort', sv('fort'), kind === 'familiar' ? 'master’s base' : (b.goodSaves?.fort ? 'good' : 'poor'))}
        ${this.#bigStat('Ref', sv('ref'), kind === 'familiar' ? 'master’s base' : (b.goodSaves?.ref ? 'good' : 'poor'))}
        ${this.#bigStat('Will', sv('will'), kind === 'familiar' ? 'master’s base' : (b.goodSaves?.will ? 'good' : 'poor'))}
      </div>
      <p class="hint">${kind === 'familiar'
    ? 'A familiar is its master’s level, uses the master’s BAB and base saves, has half the master’s hit points, and takes its Intelligence and natural armour from the familiar table.'
    : kind === 'animalCompanion'
      ? 'The level is the master’s levels in the class named (or ranks in Handle Animal / Ride for a Spheres companion), less any penalty; HD, BAB, saves, skill ranks, feats, natural armour, the Str/Dex bonus and bonus tricks all follow the animal companion table.'
      : 'The level is the master’s levels in the class named, less any penalty; HD, BAB, saves, feats, natural armour, the Str/Dex bonus, the evolution pool and the attack cap follow the eidolon table.'}
        Readable from a formula as <code>${kind}.hp</code>, <code>${kind}.ac</code>, <code>${kind}.str.mod</code>…</p>
    </section>`;
  }

  #companionHpPanel(kind, b, k) {
    const hp = b.hp || {};
    const cur = k.hpCurrent ?? 0;
    return `<section class="panel">
      <h3>Hit points <span class="badge">${cur} of ${k.hpMax ?? 0}</span>${cur <= 0 ? '<span class="badge">down</span>' : ''}</h3>
      ${this.#line('Maximum', k.hpMax ?? 0)}
      ${this.#line('Damage taken', hp.damage || 0)}
      <div class="fieldgrid two" style="margin-top:6px">
        ${this.#field('Temporary', this.#num(`${kind}.hp.temp`, hp.temp, 'min="0"'))}
        ${this.#field('Bonus max HP', this.#num(`${kind}.hp.bonus`, hp.bonus))}
        ${kind === 'familiar' ? '' : this.#field('HP ability', this.#abilitySelect(`${kind}.hpAbility`, b.hpAbility))}
      </div>
      <div class="hpactions">
        <input type="number" value="0" data-companion-amount="${kind}" aria-label="Amount" min="0">
        <button data-action="companion-hp" data-kind="${kind}" data-op="damage" class="danger">Damage</button>
        <button data-action="companion-hp" data-kind="${kind}" data-op="heal">Heal</button>
        <button data-action="companion-hp" data-kind="${kind}" data-op="rest" class="primary">Rest</button>
      </div>
      <p class="hint">${kind === 'familiar'
    ? `Half the master’s maximum${k.protectorDoubles ? ', doubled for a Protector' : ''}, plus the bonus.`
    : `8 a hit die plus the ${esc(b.hpAbility || 'Con')} modifier each, plus the bonus. Damage spends temporary points first.`}</p>
    </section>`;
  }

  #companionScoresPanel(kind, b, k) {
    const sc = k.scores || {};
    const evo = kind === 'eidolon';
    const incs = b.abilityIncreases || [];
    const list = `${kind}.abilityIncreases`;
    return `<section class="panel">
      <h3>Ability scores</h3>
      <table class="build"><thead><tr>
        <th scope="col">Score</th><th scope="col">Base</th>${evo ? '<th scope="col">Evo</th>' : ''}
        <th scope="col" title="The table’s Str/Dex bonus and the +1s at the increase levels">Level</th>
        <th scope="col">Misc</th><th scope="col" class="num">Total</th><th scope="col" class="num">Mod</th>
      </tr></thead><tbody>
        ${ABILITIES.map((a) => {
    const s = sc[a] || {};
    const base = kind === 'familiar' && a === 'int'
      ? `<input type="number" value="${b.scores?.int?.base ?? ''}" placeholder="${k.tableInt ?? ''}"
            data-set="${kind}.scores.int.base" data-kind="number-or-null" title="Auto: ${k.tableInt ?? ''} from the familiar table. Enter a number to pin it.">`
      : this.#num(`${kind}.scores.${a}.base`, b.scores?.[a]?.base ?? 10);
    return `<tr>
          <th scope="row">${ABILITY_LABELS[a]}</th>
          <td>${base}</td>
          ${evo ? `<td>${this.#num(`${kind}.scores.${a}.evo`, b.scores?.[a]?.evo)}</td>` : ''}
          <td class="num derived">${fmt(s.lvlUp || 0)}</td>
          <td>${this.#num(`${kind}.scores.${a}.misc`, b.scores?.[a]?.misc)}</td>
          <td class="num total">${s.total ?? 10}</td>
          <td class="num"><span class="rollpair">${fmt(s.mod ?? 0)}${
      this.#rollButton(kind, `ability:${a}`, `a ${ABILITY_LABELS[a]} check`)}</span></td>
        </tr>`;
  }).join('')}
      </tbody></table>
      ${incs.length ? `<div class="fieldgrid" style="margin-top:8px">
        ${incs.map((inc, i) => this.#field(`+1 at level ${inc.level}${(k.level ?? 0) >= inc.level ? '' : ' (not yet)'}`,
    this.#itemSelect(list, i, 'ability', inc.ability, ABILITY_LABELS_LIST)))}
      </div>` : ''}
      ${evo ? `<p class="hint">Evo is the Ability Increase evolution, at most +${k.maxBonusPerStat ?? 2} to any one score at this level.
        ${(k.evoBonusOver || []).length ? `<span class="warn">Over the cap: ${k.evoBonusOver.join(', ')}.</span>` : ''}</p>` : ''}
    </section>`;
  }

  #companionDefensePanel(kind, b, k) {
    const ac = b.ac || {};
    return `<section class="panel">
      <h3>Defences <span class="badge">AC ${k.ac ?? 10}</span></h3>
      ${this.#line('Armor class', k.ac ?? 10, true)}
      ${this.#line('Touch', k.touch ?? 10)}
      ${this.#line('Flat-footed', k.flatFooted ?? 10)}
      ${this.#line('CMD', `${k.cmd ?? 10} (flat ${k.ffCmd ?? 10})`)}
      ${this.#line('Initiative', fmt(k.initiative ?? 0))}
      <div class="fieldgrid" style="margin-top:8px">
        ${this.#field('Bonus AC (all)', this.#num(`${kind}.ac.all`, ac.all))}
        ${this.#field('Touch only', this.#num(`${kind}.ac.touch`, ac.touch))}
        ${this.#field('Flat-footed only', this.#num(`${kind}.ac.ff`, ac.ff))}
        ${this.#field('CMD other', this.#num(`${kind}.cmdOther`, b.cmdOther))}
        ${this.#field('Initiative bonus', this.#num(`${kind}.initBonus`, b.initBonus))}
      </div>
      <p class="hint">10 + Dex + size ${fmt(k.sizeAC ?? 0)} + natural armour ${fmt(k.tableNatural ?? 0)} from the table
        + the bonuses: <em>all</em> counts everywhere, <em>touch only</em> for dodge and deflection,
        <em>flat-footed only</em> for armour and extra natural armour.</p>
      ${kind === 'eidolon' ? `<div class="fieldgrid" style="margin-top:8px">
        ${this.#field('DR', this.#text(`${kind}.dr`, b.dr))}
        ${this.#field('Resistances', this.#text(`${kind}.resistances`, b.resistances))}
        ${this.#field('Immunities', this.#text(`${kind}.immunities`, b.immunities))}
      </div>` : ''}
    </section>`;
  }

  #companionSavesPanel(kind, b, k) {
    const saves = k.saves || {};
    const rows = [['fort', 'Fortitude', 'Con'], ['ref', 'Reflex', 'Dex'], ['will', 'Will', 'Wis']];
    return `<section class="panel">
      <h3>Saves</h3>
      <table class="build"><thead><tr>
        <th scope="col">Save</th>${kind === 'familiar' ? '' : '<th scope="col">Good</th>'}
        <th scope="col" class="num">Base</th><th scope="col" class="num">Ability</th>
        <th scope="col">Misc</th><th scope="col" class="num">Total</th>
      </tr></thead><tbody>
        ${rows.map(([key, name, ab]) => `<tr>
          <th scope="row">${name}<span class="hint" style="margin-left:4px">${ab}</span></th>
          ${kind === 'familiar' ? '' : `<td>${this.#check(`${kind}.goodSaves.${key}`, b.goodSaves?.[key])}</td>`}
          <td class="num derived">${fmt(saves[key]?.base ?? 0)}</td>
          <td class="num derived">${fmt(saves[key]?.mod ?? 0)}</td>
          <td>${this.#num(`${kind}.saves.${key}.misc`, b.saves?.[key]?.misc)}</td>
          <td class="num total"><span class="rollpair">${fmt(saves[key]?.total ?? 0)}${
            this.#rollButton(kind, `save:${key}`, `a ${name} save`)}</span></td>
        </tr>`).join('')}
      </tbody></table>
      <p class="hint">${kind === 'familiar'
    ? 'Base saves are the master’s, never below +2.'
    : 'Tick the good saves; the table gives the good and poor base at this level.'}</p>
      <div class="fieldgrid" style="margin-top:8px">
        ${this.#field('Speed', this.#text(`${kind}.speed.base`, b.speed?.base, '30 ft.'))}
        ${this.#field('Fly', this.#text(`${kind}.speed.fly`, b.speed?.fly))}
        ${this.#field('Swim', this.#text(`${kind}.speed.swim`, b.speed?.swim))}
        ${this.#field('Climb', this.#text(`${kind}.speed.climb`, b.speed?.climb))}
        ${this.#field('Burrow', this.#text(`${kind}.speed.burrow`, b.speed?.burrow))}
      </div>
    </section>`;
  }

  #companionAttacksPanel(kind, b, k) {
    const list = `${kind}.attacks`;
    const rows = b.attacks || [];
    const types = NATURAL_ATTACKS.map((a) => a.name);
    const cap = kind === 'eidolon' && k.maxAttacks ? ` <span class="badge${rows.length > k.maxAttacks ? ' err' : ''}">${rows.length} of ${k.maxAttacks} attacks</span>` : '';
    return `<section class="panel span2">
      <h3>Attacks <span class="badge">${fmt(k.totalAttack ?? 0)} to hit</span>${cap}
        <span class="pair" style="margin-left:auto">
          <label class="fld"><span>Ability</span>${this.#select(`${kind}.attackAbility`, b.attackAbility, ABILITY_LABELS_LIST, kind === 'familiar' ? 'auto (better of Str / Dex)' : '—')}</label>
          <label class="fld"><span>Misc</span>${this.#num(`${kind}.attackBonus`, b.attackBonus, 'style="width:3.6rem"')}</label>
        </span>
      </h3>
      ${rows.length ? `<table><thead><tr>
        <th>Type</th><th>Damage</th><th>Crit</th><th>Role</th><th>Bonus</th>
        <th class="num">To hit</th><th>Damage type</th><th>Qualities</th><th></th>
      </tr></thead><tbody>
        ${rows.map((a, i) => `<tr>
          <td>${this.#itemSelect(list, i, 'type', a.type, types)}</td>
          <td>${this.#itemText(list, i, 'damage', a.damage, '1d6')}</td>
          <td>${this.#itemText(list, i, 'crit', a.crit, '20/×2')}</td>
          <td>${this.#itemSelect(list, i, 'primary', a.primary === null || a.primary === undefined ? '' : (a.primary ? 'primary' : 'secondary'),
    [['primary', 'Primary'], ['secondary', 'Secondary']], `auto (${a.primaryResolved ? 'primary' : 'secondary'})`)}</td>
          <td>${this.#itemNum(list, i, 'bonus', a.bonus)}</td>
          <td class="num total"><span class="rollpair">${fmt(a.toHit ?? 0)}${
            this.#rollButton(kind, `attack:${i}`, `${a.type || 'this attack'} — attack and damage`)}</span></td>
          <td>${esc(a.damageType || '')}</td>
          <td>${this.#itemArea(list, i, 'qualities', a.qualities, 1)}</td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No attacks yet.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add attack', { type: 'Bite', damage: '', crit: '20/×2', primary: null, bonus: 0, qualities: '' })}</div>
      <p class="hint">Secondary attacks take −5${k.multiattack ? ' — −2 here, for Multiattack' : ' (−2 with Multiattack)'}.
        Role on auto follows the natural-attack table.</p>
    </section>`;
  }

  #eidolonEvolutionsPanel(b, k) {
    const list = 'eidolon.evolutions';
    const rows = b.evolutions || [];
    const over = (k.evoLeft ?? 0) < 0;
    return `<section class="panel span2">
      <h3>Evolutions
        <span class="badge${over ? ' err' : ''}">${k.evoSpent ?? 0} of ${k.evoPool ?? 0} points</span>
        <span class="pair" style="margin-left:auto">
          <label class="fld"><span>Bonus points</span>${this.#num('eidolon.bonusEvoPoints', b.bonusEvoPoints, 'style="width:3.6rem"')}</label>
        </span>
      </h3>
      ${rows.length ? `<table><thead><tr>
        <th>Evolution</th><th style="width:4rem">Cost</th><th style="width:8rem">Type</th><th>Notes</th><th></th>
      </tr></thead><tbody>
        ${rows.map((e, i) => `<tr>
          <td>${this.#itemText(list, i, 'name', e.name, 'Evolution')}</td>
          <td>${this.#itemNum(list, i, 'cost', e.cost)}</td>
          <td>${this.#itemText(list, i, 'type', e.type, 'Base form, 1-pt…')}</td>
          <td>${this.#itemArea(list, i, 'notes', e.notes, 1)}</td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No evolutions yet.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add evolution', { name: '', cost: 1, type: '', notes: '' })}</div>
      ${over ? `<p class="hint warn">${-(k.evoLeft ?? 0)} point${k.evoLeft === -1 ? '' : 's'} over the pool.</p>` : ''}
      <div class="fieldgrid" style="margin-top:8px">
        <label class="fld" style="grid-column:1/-1"><span>Base form evolutions (free, by level)</span>
          ${this.#prose('data-set="eidolon.baseEvolutions"', b.baseEvolutions, 2)}</label>
      </div>
      <p class="hint">The pool is the table’s at this level, less the master-level penalty, plus the bonus points.
        Readable as <code>eidolon.evoPool</code> and <code>eidolon.evoLeft</code>.</p>
    </section>`;
  }

  #companionTricksPanel(b, k) {
    const list = 'animalCompanion.tricks';
    const rows = b.tricks || [];
    return `<section class="panel">
      <h3>Tricks <span class="badge">${k.tricksTaken ?? 0} taken · ${k.bonusTricks ?? 0} bonus</span></h3>
      ${rows.length ? `<div class="rowlist">${rows.map((t, i) => `<div class="item statline">
        <span class="label pair" style="flex:1">${this.#itemText(list, i, 'name', t.name, 'Trick')}</span>
        <span class="value pair">${this.#itemArea(list, i, 'notes', t.notes, 1)}
          <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button></span>
      </div>`).join('')}</div>` : '<p class="empty">No tricks yet.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add trick', { name: '', notes: '' })}</div>
      <p class="hint">Bonus tricks come from the table; the rest are taught with Handle Animal.</p>
    </section>`;
  }

  #companionFeatsPanel(kind, b, k) {
    const list = `${kind}.feats`;
    const rows = b.feats || [];
    const allowed = k.featsAllowed ?? 0;
    const over = (k.featsTaken ?? 0) > allowed;
    return `<section class="panel">
      <h3>Feats <span class="badge${over ? ' err' : ''}">${k.featsTaken ?? 0} of ${allowed}</span></h3>
      ${rows.length ? `<div class="rowlist">${rows.map((f, i) => `<div class="item statline">
        <span class="label pair" style="flex:1">${this.#itemText(list, i, 'name', f.name, 'Feat')}</span>
        <span class="value pair">${this.#itemArea(list, i, 'notes', f.notes, 1)}
          <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button></span>
      </div>`).join('')}</div>` : '<p class="empty">No feats yet.</p>'}
      <div style="margin-top:6px">${this.#addButton(list, 'Add feat', { name: '', notes: '' })}</div>
      <p class="hint">The table allows ${allowed} at this level. A feat named Multiattack softens secondary attacks to −2.</p>
    </section>`;
  }

  #companionSkillsPanel(kind, b, k) {
    const list = `${kind}.skills`;
    const rows = b.skills || [];
    const fam = kind === 'familiar';
    const budget = k.ranksAllowed === null || k.ranksAllowed === undefined ? ''
      : `<span class="badge${(k.ranksSpent ?? 0) > k.ranksAllowed ? ' err' : ''}">${k.ranksSpent ?? 0} of ${k.ranksAllowed} ranks</span>`;
    return `<section class="panel span2">
      <h3>Skills ${budget}</h3>
      <table class="build"><thead><tr>
        <th scope="col">Skill</th><th scope="col">Variant</th><th scope="col">Ability</th>
        <th scope="col" title="Class skill">Class</th><th scope="col">Ranks</th>
        ${fam ? '<th scope="col" class="num" title="The master’s ranks in the same skill">Master</th>' : ''}
        <th scope="col">Misc</th><th scope="col" class="num">Total</th><th scope="col"></th>
      </tr></thead><tbody>
        ${rows.map((s, i) => `<tr${s.trained && !(s.effectiveRanks > 0) ? ' class="future" title="Trained only — no ranks yet"' : ''}>
          <td>${this.#itemText(list, i, 'name', s.name, 'Skill')}</td>
          <td>${this.#itemText(list, i, 'spec', s.spec, '')}</td>
          <td>${this.#itemSelect(list, i, 'ability', s.ability, ABILITY_LABELS_LIST, null)}</td>
          <td>${this.#itemCheck(list, i, 'classSkill', s.classSkill)}</td>
          <td>${this.#itemNum(list, i, 'ranks', s.ranks)}</td>
          ${fam ? `<td class="num derived">${s.masterRanks || 0}</td>` : ''}
          <td>${this.#itemNum(list, i, 'misc', s.misc)}</td>
          <td class="num total"><span class="rollpair">${fmt(s.total ?? 0)}${
            this.#rollButton(kind, `skill:${i}`, `a ${skillLabel(s.name, s.spec) || 'skill'} check`)}</span></td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>
      <div style="margin-top:6px">${this.#addButton(list, 'Add skill', { name: '', spec: '', ability: 'Int', trained: false, classSkill: false, ranks: 0, misc: 0 })}</div>
      <p class="hint">${fam
    ? 'A familiar uses its own ranks or its master’s, whichever is higher; the +3 class-skill bonus applies once there is a rank.'
    : kind === 'eidolon'
      ? 'Ranks per the sheet: HD × (6 + Int modifier). The +3 class-skill bonus applies once there is a rank.'
      : 'Ranks from the table at this level. The +3 class-skill bonus applies once there is a rank.'}</p>
    </section>`;
  }

  #companionItemsPanel(b, k) {
    const slots = k.slots || [];
    const list = 'animalCompanion.slotless';
    const rows = b.slotless || [];
    return `<section class="panel span2">
      <h3>Items
        ${b.bodyType ? `<span class="badge">${esc(b.bodyType)}</span>` : ''}
        ${k.canGrasp === null || k.canGrasp === undefined ? '' : `<span class="badge">${k.canGrasp ? 'can grasp' : 'cannot grasp'}</span>`}
      </h3>
      ${slots.length ? `<table><thead><tr><th>Slot</th><th>Item</th><th style="width:6rem">Cost</th></tr></thead><tbody>
        ${slots.map((slot) => `<tr>
          <th scope="row">${esc(slot)}</th>
          <td>${this.#text(`animalCompanion.items.${slot}.name`, b.items?.[slot]?.name, '')}</td>
          <td>${this.#num(`animalCompanion.items.${slot}.cost`, b.items?.[slot]?.cost)}</td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">Pick a body type above to see the item slots it can use.</p>'}
      <h4 style="margin:10px 0 4px">Slotless items</h4>
      ${rows.length ? `<table><thead><tr><th>Item</th><th style="width:6rem">Cost</th><th></th></tr></thead><tbody>
        ${rows.map((it, i) => `<tr>
          <td>${this.#itemText(list, i, 'name', it.name, 'Item')}</td>
          <td>${this.#itemNum(list, i, 'cost', it.cost)}</td>
          ${this.#rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>` : ''}
      <div style="margin-top:6px">${this.#addButton(list, 'Add slotless item', { name: '', cost: 0 })}</div>
    </section>`;
  }

  #companionGainsPanel(kind, b, k, label) {
    const gains = k.gains || [];
    return `<section class="panel">
      <h3>${esc(label)} abilities <span class="badge">${gains.length} from the table</span></h3>
      ${gains.length ? `<div class="rowlist">${gains.map((g) => `<div class="item statline">
        <span class="label">Level ${g.level}</span><span class="value">${esc(g.text)}</span>
      </div>`).join('')}</div>` : '<p class="empty">Nothing yet at this level.</p>'}
      <div class="fieldgrid" style="margin-top:8px">
        ${kind === 'familiar' ? `<label class="fld" style="grid-column:1/-1"><span>Familiar abilities</span>
          ${this.#prose('data-set="familiar.abilities"', b.abilities, 3)}</label>` : ''}
        <label class="fld" style="grid-column:1/-1"><span>Special qualities</span>
          ${this.#prose(`data-set="${kind}.specialQualities"`, b.specialQualities, 3)}</label>
      </div>
    </section>`;
  }

  #companionNotesPanel(kind, b) {
    return `<section class="panel">
      <h3>Notes</h3>
      ${this.#prose(`data-set="${kind}.notes"`, b.notes, 6)}
      <p class="hint">Formulas work here: <code>{= ${kind}.hp}</code>, <code>{= ${kind}.hd * 2}</code>.</p>
    </section>`;
  }

  /* ---------------- card casting ---------------- */

  /** A run of mana letters as coloured chips; a dash for none. */
  #manaChips(letters, none = '—') {
    const chips = String(letters || '').split('').filter(Boolean);
    if (!chips.length) return `<span class="mana"><span class="chip none" title="No colour">${esc(none)}</span></span>`;
    return `<span class="mana">${chips.map((k) => {
      const name = (CARD_COLORS.find(([x]) => x === k) || [k, k])[1];
      return `<span class="chip ${esc(k)}" title="${esc(name)}">${esc(k)}</span>`;
    }).join('')}</span>`;
  }

  /**
   * The Cardcasting tab: the deck a card caster draws from, and the drawback
   * ladder that shapes how it is played.
   *
   * Top to bottom: what the deck is worth right now (size, hand, the checks the
   * rules ask for), the drawback and its modifications, the deck manipulations
   * taken against the number available, the land-attuned spheres, and then the
   * cards themselves and the sideboard. Every check is a line, never a gate.
   *
   * The live table -- drawing a hand, playing cards, cooldown and mana on the
   * table -- is not here yet; the deck is the data it will run on.
   */
  #cardcastingPanel() {
    const p = this.#model.data.cardcasting;
    if (!p) return '<div class="grid"><p class="empty">No card casting data.</p></div>';
    const k = p.calc || {};
    const t = p.table || {};

    const views = `<nav class="subtabs" role="tablist" aria-label="Cardcasting views">
      <button role="tab" data-deck-view="table" aria-pressed="${this.#deckView === 'table'}">The table${t.active ? ` <span class="badge">round ${t.round}</span>` : ''}</button>
      <button role="tab" data-deck-view="deck" aria-pressed="${this.#deckView === 'deck'}">The deck <span class="badge">${k.deckSize ?? 0}</span></button>
    </nav>`;
    if (this.#deckView === 'table') return `${views}<div class="grid">${this.#tablePanel(p, k)}</div>`;

    return `${views}<div class="grid">
      ${this.#deckSummaryPanel(p, k)}
      ${this.#deckLadderPanel(p, k)}
      ${this.#deckManipulationsPanel(p, k)}
      ${this.#landAttunedPanel(p, k)}
      ${this.#deckTablePanel(p, k)}
      ${this.#sideboardPanel(p)}
      <section class="panel span2">
        <h3>Notes</h3>
        ${this.#prose('data-set="cardcasting.notes"', p.notes, 3)}
      </section>
      ${this.#systemExtrasPanel(p, 'cardcasting', 'Cardcaster Deck')}
    </div>`;
  }

  /**
   * A card small enough for a zone: title bar with cost, the type line and
   * the effect, and whatever buttons the zone offers. Same frame rules as
   * the full face.
   */
  #cardMini(id, { buttons = '', badge = '', tapped = false } = {}) {
    const card = this.#model.tableCard(id);
    if (!card) return '';
    const r = card.calc || {};
    const colors = String(r.colors || '');
    const frameClass = r.artifact ? 'A' : colors.length === 1 ? esc(colors) : colors.length ? 'multi' : 'C';
    const isMana = !String(card.effect || '').trim() && card.mana;
    return `<div class="mcard mini ${frameClass}${tapped ? ' tapped' : ''}" style="${r.artifact ? '' : esc(cardFrameStyle(colors))}" data-card="${esc(id)}">
      <div class="bar title">
        <span class="name">${esc(card.name || (isMana ? 'Mana Point' : card.effect || 'card'))}</span>
        <span class="cost">${card.cost ? `<b>${esc(card.cost)}</b>` : ''}${this.#manaChips(colors, '')}</span>
      </div>
      ${card.art ? `<div class="art"><img src="${esc(card.art)}" alt="" loading="lazy"></div>` : ''}
      <div class="bar type"><span>${esc(card.sphere || (isMana ? 'Mana Point' : ''))}${card.tags ? ` — ${esc(card.tags)}` : ''}</span></div>
      ${String(card.effect || '').trim() ? `<div class="text">${markKeywords(hasTokens(card.effect) ? this.#renderedProse(card.effect) : esc(card.effect))}</div>` : ''}
      <div class="foot">
        ${card.mana ? `<span class="pair" title="Mana this card carries">${this.#manaChips(card.mana, '')}</span>` : ''}
        ${badge}
        <span class="pair tools">${buttons}</span>
      </div>
    </div>`;
  }

  /** A button that drives the table: `data-table="action|id|arg"`. */
  #tableBtn(action, id, label, { arg = '', title = '', cls = '', disabled = false } = {}) {
    return `<button class="${cls}" data-table="${esc(action)}|${esc(id)}|${esc(arg)}" title="${esc(title)}"${disabled ? ' disabled' : ''}>${label}</button>`;
  }

  /**
   * The table: an encounter in play.
   *
   * The controls at the top are the actions the rules give -- start, redraw,
   * next round, draw, shuffle the discard back, end -- and the zones below
   * hold the cards: hand, in play, mana in play, discard, deck, exile and the
   * Lifebound piles. Every card offers the moves that make sense where it is,
   * and a card can always be moved anywhere by hand, because a table is a
   * place where things get picked up and put down.
   */
  #tablePanel(p, k) {
    const t = p.table || {};
    const tc = t.calc || {};
    const active = !!t.active;
    const manips = p.manipulations || [];
    const has = (re) => manips.some((m) => re.test(String(m.name || '')) && Number(m.count) > 0);
    const readTwice = manips.some((m) => /^read the cards/i.test(String(m.name || '')) && Number(m.count) >= 2);
    const loaded = 2 * (k.loadedHand || 0);
    const redrawTo = Math.max(0, t.hand?.length + (t.round === 1 ? t.mana?.length : 0) - (t.redraws === 0 && has(/^mulligan/i) ? 0 : 1));
    // Spell points, from the tracker if the character keeps one.
    const sp = this.#model.spellPointTracker();
    const spLeft = sp ? (Number(sp.max) || 0) - (Number(sp.current) || 0) : null;
    const spBtn = (id) => (sp ? this.#tableBtn('sp', id, '+1 SP', { arg: 1, title: 'Spend one spell point on this card — a boost, a modal option' }) : '');

    const controls = active ? `
        ${this.#tableBtn('next', '', 'Next round', { title: p.mods.exposedGrip ? 'Exposed Grip: no automatic draw' : 'Draw one card' + (p.mods.stagnantPool ? '; untap Stagnant Pool mana' : ''), cls: 'primary' })}
        ${this.#tableBtn('draw', '', 'Draw a card', { title: 'Rapid Fill, Life Draw, Prize Card, Primed Hand — any draw the rules hand you' })}
        ${this.#tableBtn('redraw', '', `Redraw hand → ${redrawTo}`, { title: 'Shuffle the hand back and draw one fewer' + (has(/^mulligan/i) ? ' (Mulligan: the same number the first time)' : ''), disabled: (t.hand?.length || 0) + (t.round === 1 ? t.mana?.length || 0 : 0) <= 1 })}
        ${p.cooldown ? this.#tableBtn('shuffle', '', 'Shuffle discard in', { title: 'A full-round action: the discard pile shuffled into the deck', disabled: !(t.discard?.length) }) : ''}
        ${has(/^read the cards/i) ? this.#tableBtn('peek', '', `Read the cards (${readTwice ? 3 : 1})`, { arg: readTwice ? 3 : 1, title: 'Look at the top of the deck' }) : ''}
        ${sp ? this.#tableBtn('sp', '', 'Spend 1 SP', { arg: 1, title: 'A spell point on something the cards do not know about — Retrace, Read the Cards, Fresh Hand…' }) : ''}
        ${this.#tableBtn('end', '', 'End encounter', { title: 'Everything shuffled back into the deck', cls: 'danger' })}`
      : `${this.#tableBtn('start', '', `Start encounter — draw ${k.openingHand ?? 2}${loaded ? ` + ${loaded}` : ''}`, { title: 'Shuffle every copy in the deck and draw the opening hand', cls: 'primary', disabled: !(k.deckSize > 0) })}`;

    const notes = [];
    if (active && k.handMax) notes.push(`Tight Hand: ${t.hand.length} of ${k.handMax} in hand${tc.handOver ? ` — ${tc.handOver} over` : ''}.`);
    if (active && p.mods.gradualRamp) notes.push(`Gradual Ramp: ${t.manaPlayed} Mana Point card${t.manaPlayed === 1 ? '' : 's'} played this round (one allowed).`);
    if (active && p.mods.deckout && !t.deck.length) notes.push('Deckout: the deck is empty — 4 Constitution burn every turn it stays so.');
    if (active && tc.missing) notes.push(`${tc.missing} cop${tc.missing === 1 ? 'y' : 'ies'} added to the deck since the shuffle — in play after the next shuffle.`);
    if (active && p.mods.bleedingHand) notes.push(`Bleeding Hand: discard a card for each ${p.mods.bleedingHand === 2 ? 'action' : 'standard or full-round action'} that does not play or discard one.`);

    const zoneMoves = (id, from) => {
      const opts = [['hand', 'hand'], ['play', 'in play'], ['mana', 'mana in play'], ['discard', 'discard'], ['exile', 'exile'],
        ['deckTop', 'top of deck'], ['deckBottom', 'bottom of deck'], ['deck', 'shuffled into deck']];
      if (p.mods.lifeboundDeck) opts.push(['stun', 'Stun pile'], ['wounds', 'Wounds pile'], ['death', 'Death pile']);
      return `<select class="movesel" data-table-move="${esc(id)}" aria-label="Move this card" title="Move this card by hand">
        <option value="">move…</option>${opts.filter(([v]) => v !== from).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>`;
    };

    // 🎲 rolls the card's first dice; when the Dice field names more
    // ("boost (1 SP): 15d6; milled: 8d4"), a picker offers them and spends
    // what the label says.
    const rollBtn = (id, card) => {
      const rolls = this.#model.cardRolls(card);
      if (!rolls.length) return '';
      const first = this.#tableBtn('roll', id, '🎲', { title: `Roll ${rolls[0].expr}` });
      if (rolls.length === 1) return first;
      return `${first}<select class="movesel rollsel" data-table-roll="${esc(id)}" aria-label="Other rolls" title="Other rolls on this card">
        <option value="">roll…</option>
        ${rolls.slice(1).map((r) => `<option value="${esc(r.label)}" title="${esc(r.expr)}">${esc(r.label)}</option>`).join('')}
      </select>`;
    };

    const handCards = (t.hand || []).map((id) => {
      const card = this.#model.tableCard(id);
      const check = tc.castable?.[id] || {};
      const manaOk = tc.manaOk?.[id] || {};
      const isEffect = String(card?.effect || '').trim() !== '';
      const badge = isEffect && p.manaPool
        ? `<span class="badge ${check.ok ? 'ok' : 'err'}" title="${esc(check.why || `needs ${check.need}, has ${check.have}`)}">${check.ok ? 'castable' : `${check.have}/${check.need} mana`}</span>` : '';
      return this.#cardMini(id, {
        badge,
        buttons: `${isEffect ? this.#tableBtn('play', id, 'Cast', { arg: 'cast', title: 'Cast: the effect resolves now', cls: 'primary' })
          + this.#tableBtn('play', id, 'Ongoing', { arg: 'ongoing', title: 'Cast an effect that lasts: the card stays in play until it resolves' })
          + (tc.trapCard ? this.#tableBtn('play', id, 'Trap', { arg: 'trap', title: 'Trap Card: set it face down in play; spring it later' }) : '') : ''}
          ${card?.mana ? this.#tableBtn('play', id, 'As mana', { arg: 'mana', title: manaOk.ok ? (manaOk.why || 'Play the Mana Point card onto the table') : manaOk.why, disabled: !manaOk.ok }) : ''}
          ${rollBtn(id, card)}${isEffect ? spBtn(id) : ''}
          ${this.#tableBtn('move', id, '⤓', { arg: 'discard', title: 'Discard' })}
          ${zoneMoves(id, 'hand')}`,
      });
    }).join('');

    const faceDown = new Set(t.faceDown || []);
    const playCards = (t.play || []).map((id) => (faceDown.has(id)
      ? `<div class="mcard mini trap" data-card="${esc(id)}">
          <div class="trapback">Trap<br><small>face down</small></div>
          <div class="foot"><span class="pair tools">
            ${this.#tableBtn('resolve', id, 'Spring', { title: 'The trap springs: it is cast now, keywords and all', cls: 'primary' })}
            ${this.#tableBtn('reveal', id, 'Reveal', { title: 'Turn it face up, still in play' })}
            ${zoneMoves(id, 'play')}
          </span></div>
        </div>`
      : this.#cardMini(id, {
        buttons: `${this.#tableBtn('resolve', id, 'Resolve', { title: 'The effect ends: back to the deck, or the discard under Cooldown', cls: 'primary' })}${rollBtn(id, this.#model.tableCard(id))}${spBtn(id)}${zoneMoves(id, 'play')}`,
      }))).join('');

    const manaCards = (t.mana || []).map((m) => {
      const card = this.#model.tableCard(m.id);
      const colors = String(card?.mana || '');
      return `<div class="manacard${m.tapped ? ' tapped' : ''}" style="${esc(cardFrameStyle(colors))}" data-card="${esc(m.id)}">
        <span class="mana">${this.#manaChips(colors, '')}</span>
        <span class="mname">${esc(card?.name || 'Mana Point')}</span>
        ${p.mods.stagnantPool || m.tapped ? this.#tableBtn('tap', m.id, m.tapped ? 'Untap' : 'Tap', { title: 'Stagnant Pool: a tapped Mana Point card is spent for the round' }) : ''}
        ${zoneMoves(m.id, 'mana')}
      </div>`;
    }).join('');

    const listZone = (ids, from, extra = () => '') => (ids || []).map((id) => {
      const card = this.#model.tableCard(id);
      return `<div class="zonerow" data-card="${esc(id)}">
        ${this.#manaChips(String(card?.calc?.colors || ''), '')}
        <span class="zname">${esc(card?.name || card?.effect || 'card')}</span>
        <span class="zsub">${esc(card?.effect || (card?.mana ? `Mana ${card.mana}` : ''))}</span>
        <span class="pair tools">${extra(id)}${zoneMoves(id, from)}</span>
      </div>`;
    }).join('');

    const peeked = this.#peek.filter((id) => (t.deck || []).slice(0, 3).includes(id));
    const stagnant = p.mods.stagnantPool;

    const lastRoll = t.lastRoll && this.#model.tableCard(t.lastRoll.id)
      ? `<span class="badge roll" title="${esc(t.lastRoll.source)}">🎲 ${esc(this.#model.tableCard(t.lastRoll.id).name || 'roll')}: [${t.lastRoll.rolls.join(', ')}]${t.lastRoll.flat ? ` ${t.lastRoll.flat >= 0 ? '+' : '−'} ${Math.abs(t.lastRoll.flat)}` : ''} = <b>${t.lastRoll.total}</b></span>` : '';

    // The field: hand across the top; in play three quarters with the deck
    // beside it; then mana on the left and the discard over the exile on the right.
    return `<section class="panel span2 tablehead">
      <h3>${active ? `Round ${t.round}` : 'No encounter'}
        <span class="badge">${tc.inDeck ?? 0} in deck</span>
        <span class="badge">${tc.inHand ?? 0} in hand</span>
        ${p.manaPool ? `<span class="badge">${tc.manaUntapped ?? 0}${stagnant ? ` of ${tc.manaInPlay ?? 0}` : ''} mana</span>` : ''}
        ${p.cooldown ? `<span class="badge">${tc.inDiscard ?? 0} in discard</span>` : ''}
        ${tc.inPlay ? `<span class="badge">${tc.inPlay} in play</span>` : ''}
        ${sp ? `<span class="badge ${spLeft <= 0 ? 'err' : ''}" title="${esc(sp.name)}: casts are paid from this tracker">${spLeft} of ${sp.max} SP</span>`
    : '<span class="badge" title="Add a tracker named Spell Points and casts will be paid from it">no SP tracker</span>'}
        ${lastRoll}
        ${t.counters ? `<span class="badge" title="Perfect Draw's counters">[Ante] ${esc(this.#model.tableCard(t.counters.id)?.name || '')}: ${t.counters.early} Early · ${t.counters.late} Late</span>` : ''}
      </h3>
      ${t.lastTrigger ? `<p class="hint trig">${esc(t.lastTrigger)}</p>` : ''}
      <div class="pair tablectl">${controls}</div>
      ${notes.length ? `<ul class="hint" style="margin:8px 0 0 1.1rem;padding:0">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${!active ? `<p class="hint">At initiative: shuffle the deck and draw ${k.openingHand ?? 2} (1 + casting modifier, at least 2)${loaded ? ` plus ${loaded} for Loaded Hand` : ''}.
        ${p.manaPool ? ` Mana Point cards drawn go straight to the table${p.mods.gradualRamp ? ' — except under Gradual Ramp, where they wait in hand and one is played a round' : ''}.` : ''}
        ${p.cooldown ? ' Resolved cards go to the discard; a full-round action shuffles it back, and so does running dry' + (p.mods.deckout ? ' — except that Deckout forbids both' : '') + '.' : ' Resolved cards shuffle straight back into the deck.'}
        Out of combat there is no hand: search the deck and cast at +1 minute.
        Keywords in a card's text fire when it is cast: <code>[Draw 2]</code> <code>[Discard]</code> <code>[Shuffle]</code>
        <code>[Mill 3]</code> <code>[Peek]</code> <code>[Tap 2]</code> <code>[Untap]</code> <code>[Wild]</code> <code>[Exile]</code>
        <code>[Bottom]</code> <code>[Top]</code> <code>[Return]</code> — the ones that stand in for a manipulation want it taken.
        A card with dice in its text, or in its Dice field, gets a 🎲.</p>` : ''}
    </section>

    ${active ? `<div class="span2 tablefield">
    <section class="panel f-hand">
      <h3>Hand <span class="badge">${t.hand.length}</span>${k.handMax ? `<span class="badge ${tc.handOver ? 'err' : ''}">limit ${k.handMax}</span>` : ''}
        ${p.mods.gradualRamp ? `<span class="badge ${tc.manaBlocked ? 'err' : ''}">${tc.manaBlocked ? 'mana played this round' : 'one Mana Point card may be played'}</span>` : ''}</h3>
      ${t.hand.length ? `<div class="zone hand">${handCards}</div>` : '<p class="empty">Empty hand.</p>'}
    </section>

    <section class="panel f-play">
      <h3>In play <span class="badge">${t.play.length}</span>${faceDown.size ? `<span class="badge">${faceDown.size} face down</span>` : ''}</h3>
      <p class="hint">Ongoing effects and traps. Resolve an effect when it ends; spring a trap when it fires.</p>
      ${t.play.length ? `<div class="zone">${playCards}</div>` : '<p class="empty">Nothing in play.</p>'}
    </section>

    <section class="panel f-deck">
      <h3>Deck <span class="badge">${t.deck.length}</span></h3>
      ${peeked.length ? `<p class="hint">Top of the deck: </p><div class="zone one">${peeked.map((id, i) => this.#cardMini(id, {
    badge: `<span class="badge">${i === 0 ? 'top' : `${i + 1}${i === 1 ? 'nd' : 'rd'}`}</span>`,
    buttons: `${this.#tableBtn('bury', id, '⤓ bottom (1 SP)', { title: 'Read the Cards: a spell point puts it on the bottom of the deck' })}
      ${readTwice ? this.#tableBtn('move', id, 'discard', { arg: 'discard', title: 'Read the Cards taken twice: discard it' }) : ''}`,
  })).join('')}</div>` : `<div class="deckback"><span>${t.deck.length}</span></div>`}
      ${p.mods.lifeboundDeck ? ['stun', 'wounds', 'death'].map((z) => `<h4 class="subhead" style="margin-top:10px">${z[0].toUpperCase()}${z.slice(1)} pile <span class="badge">${t[z].length}</span></h4>
        ${t[z].length ? `<div class="zonelist">${listZone(t[z], z)}</div>` : '<p class="empty">Empty.</p>'}`).join('')
    + `<p class="hint">Lifebound value ${k.lifebound ?? '—'}: each multiple lost moves a card down the piles (deck → Stun → Wounds → Death); each multiple healed moves one back.</p>` : ''}
    </section>

    <section class="panel f-mana">
      <h3>Mana in play <span class="badge">${t.mana.length}</span>${stagnant ? `<span class="badge">${tc.manaUntapped} untapped</span>` : ''}</h3>
      ${p.manaPool ? `<p class="hint">${p.manaGraveyard ? 'Mana Graveyard: casting sends Mana Point cards equal to the cost to the discard.'
        : stagnant ? 'Stagnant Pool: mana in play is the spell points you may spend a round; tapped mana untaps at the start of your next turn.'
          : 'A card needs as many Mana Point cards in play as it costs' + (p.mods.coloredMana ? ', of its colour' : '') + '.'}</p>` : '<p class="hint">Without Mana Pool, mana on the table is a note rather than a rule.</p>'}
      ${t.mana.length ? `<div class="zone manazone">${manaCards}</div>` : '<p class="empty">No mana in play.</p>'}
    </section>

    <div class="f-piles">
      <section class="panel">
        <h3>Discard <span class="badge">${t.discard.length}</span>
          ${t.discard.length ? `<span class="pair" style="margin-left:auto">${this.#tableBtn('exileRandom', '', 'Exile one at random', { arg: 1, title: 'Blood and Dust, Grave Peril: a random card from the graveyard into exile' })}</span>` : ''}
        </h3>
        ${t.discard.length ? `<div class="zonelist">${listZone(t.discard, 'discard', (id) => `${rollBtn(id, this.#model.tableCard(id))}${spBtn(id)}${has(/^recollection|^resupply/i) ? this.#tableBtn('move', id, '→ hand', { arg: 'hand', title: 'Recollection / Resupply' }) : ''}${has(/^retrace/i) ? this.#tableBtn('retrace', id, 'Retrace', { title: 'Retrace: cast it from the discard for its cost + 1 spell point (or a longer casting time); it rolls, its keywords fire, and it stays in the discard' }) : ''}`)}</div>`
    : `<p class="empty">${p.cooldown ? 'Nothing discarded.' : 'Nothing discarded — resolved cards shuffle straight back.'}</p>`}
      </section>
      <section class="panel">
        <h3>Exile <span class="badge">${t.exile.length}</span></h3>
        ${t.exile.length ? `<div class="zonelist">${listZone(t.exile, 'exile')}</div>` : '<p class="empty">Nothing exiled.</p>'}
      </section>
    </div>

    <section class="panel f-log">
      <h3>Log</h3>
      ${(t.log || []).length ? `<ul class="tablelog">${[...t.log].reverse().slice(0, 14).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="empty">Nothing yet.</p>'}
    </section>
    </div>` : ''}`;
  }

  /** The deck at a glance, and the rules it is checked against. */
  #deckSummaryPanel(p, k) {
    const issues = k.issues || [];
    const tally = k.colorTally || {};
    const inPlay = String(k.colorsInPlay || '').split('').filter(Boolean);
    return `<section class="panel span2">
      <h3>Card casting
        <span class="badge">${k.deckSize ?? 0} cards</span>
        <span class="badge">opening hand ${k.openingHand ?? 2}</span>
        ${k.handMax ? `<span class="badge">hand limit ${k.handMax}</span>` : ''}
        <span class="badge">counts as ${k.drawbackValue ?? 1} drawback${k.drawbackValue === 1 ? '' : 's'}</span>
        <span class="badge ${issues.length ? 'err' : 'ok'}">${issues.length ? `${issues.length} to look at` : 'deck is legal'}</span>
      </h3>
      <div class="fieldgrid">
        ${this.#field('Casting ability', this.#select('cardcasting.castingStat', p.castingStat, ABILITY_LABELS_LIST))}
        ${this.#field('Colours in play', `<span class="pair">${this.#text('cardcasting.colors', p.colors, 'RBU')}
          ${this.#manaChips(k.colorsInPlay, '')}</span>`)}
        ${this.#field('Draw with', this.#select('cardcasting.useD100', p.useD100 ? '1' : '',
    [['', 'a shuffled deck'], ['1', 'a d100 and the roll table']], null))}
      </div>
      ${this.#line('Casting modifier', `${fmt(k.cam ?? 0)}${k.stat ? ` (${k.stat})` : ''}`)}
      ${this.#line('Opening hand at initiative', `${k.openingHand ?? 2} — 1 + modifier, at least 2; redraw for one fewer each time`)}
      ${this.#line('Identical-effect spread', `${k.spreadMin ?? 0}–${k.spreadMax ?? 0} copies (may differ by up to ${k.cam ?? 0})`)}
      ${this.#line('Effect cards', `${k.effectCards ?? 0} — ${k.uniqueEffects ?? 0} distinct effect${k.uniqueEffects === 1 ? '' : 's'}`)}
      ${this.#line('Mana point cards', `${k.manaCards ?? 0}${k.fused ? ` (${k.fused} fused onto an effect)` : ''}`)}
      ${k.lifebound ? this.#line('Lifebound value', `${k.lifebound} — HP ÷ 3 ÷ deck size, minimum 1`) : ''}
      ${inPlay.length ? `<div class="tally">${inPlay.map((c) => `<span class="t">${this.#manaChips(c)}
        <span class="n">${tally[c]?.effects ?? 0}</span> effect${(tally[c]?.effects ?? 0) === 1 ? '' : 's'} ·
        <span class="n">${tally[c]?.mana ?? 0}</span> mana</span>`).join('')}</div>` : ''}
      ${issues.length ? `<ul class="deckcheck hint warn" style="margin:8px 0 0 1.1rem;padding:0">
        ${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      <p class="hint" style="margin-top:8px">Readable from a formula as <code>deck.size</code>,
        <code>deck.cam</code>, <code>deck.hand</code>, <code>deck.effects</code>, <code>deck.mana</code>,
        <code>deck.unique</code>, <code>deck.lifebound</code>, <code>deck.drawbacks</code>,
        <code>deck.manipulationsLeft</code> and each pick as <code>deck.manip.&lt;name&gt;</code>. Card text takes formulas too:
        <code>Fort DC {= 10 + floor(level/2) + int.mod}</code>.</p>
    </section>`;
  }

  /** Card Casting itself, the Cooldown / Mana Pool / Mana Graveyard ladder, and the modifications. */
  #deckLadderPanel(p, k) {
    const mods = p.mods || {};
    // Compact: two abreast, the rule clamped to two lines with the whole of it
    // on hover.
    const row = (what, control, hint) => `<div class="modrow compact" title="${esc(hint)}">
      <div class="what"><strong>${what}</strong>${hint ? `<p class="hint clamp2">${esc(hint)}</p>` : ''}</div>
      <div>${control}</div></div>`;
    const modControl = (m) => {
      const path = `cardcasting.mods.${m.key}`;
      if (m.kind === 'count') {
        return this.#select(path, String(mods[m.key] || 0), [['0', 'not taken'], ['1', 'taken once'], ['2', 'taken twice']], null);
      }
      if (m.kind === 'colors') {
        return this.#select(path, String(mods[m.key] || 0), [['0', 'not taken'], ['3', 'three colours'], ['5', 'five colours (2 drawbacks)']], null);
      }
      return this.#check(path, mods[m.key], mods[m.key] ? 'taken' : 'not taken');
    };
    const needs = (m) => {
      if (m.needs === 'cooldown' && !p.cooldown) return ' <span class="badge err">needs Cooldown</span>';
      if (m.needs === 'manaPool' && !p.manaPool) return ' <span class="badge err">needs Mana Pool</span>';
      if (m.clashes === 'manaGraveyard' && p.manaGraveyard) return ' <span class="badge err">not with Mana Graveyard</span>';
      return '';
    };
    const on = (m) => (m.kind === 'bool' ? mods[m.key] : Number(mods[m.key]) > 0);

    return `<section class="panel span2">
      <h3>The drawback
        <span class="badge">${k.drawbackValue ?? 1} for boons</span>
      </h3>
      <p class="hint">Card Casting is one drawback on its own; Cooldown or Mana Pool makes it two,
        both make it three, Mana Graveyard four; each modification is one more
        (five-colour Colored Mana is two). Hover a row for the whole rule.</p>
      <div class="modgrid">
      ${row('Card Casting', '<span class="badge">always</span>',
    'Effects that cost spell points live on cards. Draw 1 + casting modifier (at least 2) at initiative, one more each round; play a card to cast it, and shuffle it back once its effect has resolved. Out of combat, search the deck and cast at +1 minute.')}
      ${row('Cooldown', this.#check('cardcasting.cooldown', p.cooldown, p.cooldown ? 'taken' : 'not taken'),
    'Resolved cards go to a discard pile instead of the deck. A full-round action shuffles the discard back in; so does running out of cards, as a free action.')}
      ${row('Mana Pool', this.#check('cardcasting.manaPool', p.manaPool, p.manaPool ? 'taken' : 'not taken'),
    'Mana Point cards join the deck and go straight to the table when drawn. A card needs as many Mana Points on the table as its spell point cost.')}
      ${row(`Mana Graveyard${p.manaGraveyard && !(p.cooldown && p.manaPool) ? ' <span class="badge err">needs both</span>' : ''}`,
    this.#check('cardcasting.manaGraveyard', p.manaGraveyard, p.manaGraveyard ? 'taken' : 'not taken'),
    'With Cooldown and Mana Pool both taken: casting discards Mana Point cards from the table equal to the spell points spent.')}
      </div>
      <h4 class="subhead" style="margin-top:10px">Modifications</h4>
      <div class="modgrid">
      ${CARD_MODIFICATIONS.map((m) => row(`${esc(m.label)}${on(m) ? needs(m) : ''}`, modControl(m), m.hint)).join('')}
      </div>
    </section>`;
  }

  /** Deck manipulations by group, taken against what is available. */
  #deckManipulationsPanel(p, k) {
    const list = 'cardcasting.manipulations';
    const items = (p.manipulations || []).map((m, i) => ({ m, i }));
    const groups = [...new Set(['General', 'Cooldown', 'Mana Pool', 'Specialized Mana Cards',
      ...items.map(({ m }) => String(m.group || 'General'))])];
    const groupOptions = groups.map((g) => [g, g]);
    const left = k.manipulationsLeft ?? 0;
    const catalogue = deckManipulationCatalogue();
    const featList = (k.deckFeats || []).map((f) => f.replace(/\s*\[[^\]]*\]\s*/g, '').trim());
    const NEED = { cooldown: 'Cooldown', manaPool: 'Mana Pool', coloredMana: 'Colored Mana', singleton: 'Singleton', gradualRamp: 'Gradual Ramp', notManaGraveyard: 'no Mana Graveyard' };
    // One panel per group in a grid of their own, so they sit two or three
    // abreast with room for the note. The first carries the totals.
    const head = `<section class="panel span2 manip-head">
      <h3>Deck manipulations
        <span class="badge ${left < 0 ? 'err' : ''}">${k.manipulationsTaken ?? 0} of ${k.manipulationsAvailable ?? 0} taken${left < 0 ? ` — ${-left} over` : left ? ` — ${left} left` : ''}</span>
        <span class="badge" title="${esc(featList.join(', ') || 'No feat or bought-off drawback is tagged [Deck]')}">${(k.deckFeats || []).length} deck feat${(k.deckFeats || []).length === 1 ? '' : 's'}</span>
        ${k.rainbow ? `<span class="badge">${k.rainbow === 2 ? 'Improved ' : ''}Rainbow Efficiency</span>` : ''}
      </h3>
      <div class="fieldgrid">
        ${this.#field('Available', this.#exprField('data-set="cardcasting.manipulationsAvailable"', p.manipulationsAvailable ?? '', {
    width: '7rem', value: k.manipulationsAvailable, error: k.manipulationsError, placeholder: `auto: ${k.autoAvailable ?? 0}`,
    title: 'Blank: one per deck feat, plus one for Card Shark. Or a number, or a formula.',
  }))}
        ${this.#field('Add from the list', `<select class="manip-pick" aria-label="Add a deck manipulation">
          <option value="">— pick a manipulation —</option>
          ${groups.map((g) => {
    const opts = catalogue.filter((m) => m.group === g);
    return opts.length ? `<optgroup label="${esc(g)}">${opts.map((m) => `<option value="${esc(m.name)}" title="${esc(m.text)}">${esc(m.name)}${m.needs || m.requires.length ? ` (${[...m.requires.map((r) => NEED[r]), m.needs].filter(Boolean).join(', ')})` : ''}</option>`).join('')}</optgroup>` : '';
  }).join('')}
        </select>`)}
      </div>
      <p class="hint">One manipulation per deck feat (a feat or bought-off drawback tagged [Deck]), plus one
        for Card Shark; the field overrides that. Hover a name for its rule. Readable as
        <code>deck.manip.&lt;name&gt;</code> — <code>deck.manip.loaded_hand</code>, <code>deck.manip.fused_cards</code> — and <code>deck.feats</code>.</p>
    </section>`;

    const panels = groups.map((g) => {
      const rows = items.filter(({ m }) => String(m.group || 'General') === g);
      const taken = rows.reduce((n, { m }) => n + (Number(m.count) || 0), 0);
      return `<section class="panel">
        <h3>${esc(g)}${taken ? `<span class="badge">${taken} taken</span>` : ''}</h3>
        ${rows.length ? `<div class="tablewrap"><table class="manips"><thead><tr>
          <th>Manipulation · note</th><th style="width:3.4rem">Taken</th><th></th>
        </tr></thead><tbody>
          ${rows.map(({ m, i }) => {
    const entry = deckManipulation(m.name);
    const mc = m.calc || {};
    const tip = entry ? `${entry.name}${entry.needs || entry.requires.length ? ` (${[...entry.requires.map((r) => NEED[r]), entry.needs].filter(Boolean).join(', ')})` : ''}: ${entry.text}` : 'Not in the catalogue — a homebrew or a name it does not know';
    return `<tr class="${mc.unmet?.length || mc.overMax ? 'unmet' : ''}">
            <td class="what">
              <span class="pair"><input type="text" value="${esc(m.name ?? '')}" data-item="${list}|${i}|name" data-kind="text"
                placeholder="Manipulation" title="${esc(tip)}">
                ${entry ? '' : '<span class="badge" title="Not in the catalogue">?</span>'}
                ${(mc.unmet || []).map((r) => `<span class="badge err">needs ${esc(NEED[r])}</span>`).join('')}
                ${mc.overMax ? `<span class="badge err">max ${entry.max}</span>` : ''}
              </span>
              ${this.#prose(`data-item="${list}|${i}|note"`, m.note, 1, 'grow note')}
              ${entry ? `<p class="rule">${esc(entry.text)}</p>` : ''}
            </td>
            <td>${this.#itemNum(list, i, 'count', m.count)}</td>
            <td class="tools"><span class="pair">
              ${this.#itemSelect(list, i, 'group', m.group || 'General', groupOptions, null)}
              <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
            </span></td>
          </tr>`;
  }).join('')}
        </tbody></table></div>` : '<p class="empty">None listed.</p>'}
        <div style="margin-top:6px">${this.#addButton(list, `Add to ${g}`, { group: g, name: '', note: '', count: 1 })}</div>
      </section>`;
    }).join('');
    return `${head}<div class="span2 grid manipgrid">${panels}</div>`;
  }

  /** Land-attuned magic: which spheres each colour covers, and which are attuned. */
  #landAttunedPanel(p, k) {
    const spheres = p.colorSpheres || {};
    const attuned = new Set(p.attunedSpheres || []);
    const tally = k.sphereTally || {};
    return `<section class="panel span2">
      <h3>Land-attuned magic
        ${attuned.size ? `<span class="badge">${attuned.size} attuned</span>` : ''}
      </h3>
      <p class="hint">The spheres each colour of mana covers, as the deck's own table had them; tick a
        sphere to mark it attuned. The count beside a sphere is how many cards in the deck belong to it.</p>
      ${CARD_COLORS.map(([c, name]) => {
    const list = `cardcasting.colorSpheres.${c}`;
    const rows = spheres[c] || [];
    return `<div class="modrow">
          <div class="what"><span class="pair">${this.#manaChips(c)} <strong>${esc(name)}</strong></span>
            <div class="spheres">
              ${rows.map((s, i) => `<span class="pair">
                <button data-action="attune-sphere" data-sphere="${esc(s)}" aria-pressed="${attuned.has(s)}"
                  title="${attuned.has(s) ? 'Attuned — click to clear' : 'Click to attune'}"
                  class="${attuned.has(s) ? 'primary' : ''}">${attuned.has(s) ? '✓' : '○'}</button>
                ${this.#itemText(list, i, 'self', s, 'Sphere')}
                ${tally[s] ? `<span class="badge">${tally[s]}</span>` : ''}
                <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
              </span>`).join('')}
              ${this.#addButton(list, 'Add sphere', '')}
            </div>
          </div>
          <div class="hint">${(k.colorTally?.[c]?.effects ?? 0)} effect${(k.colorTally?.[c]?.effects ?? 0) === 1 ? '' : 's'}</div>
        </div>`;
  }).join('')}
    </section>`;
  }

  /**
   * One card, drawn as a card.
   *
   * The frame takes the colour of what the card costs; a card with no cost
   * colour but mana on it (a plain Mana Point card) wears that instead, and two
   * or more colours go gold. Title bar with the cost top right, the suit and
   * alignment line under it for a Harrow deck, the art, a type line of
   * sphere — tags, and the effect in the text box. Everything on it is the
   * field it edits.
   */
  #cardFace(list, i, card, p, { inDeck = true } = {}) {
    const isMana = !String(card.effect || '').trim() && card.mana;
    const r = card.calc || {};
    const colors = String(r.colors || '');
    const range = r.from ? (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`) : '';
    const frameClass = r.artifact ? 'A' : colors.length === 1 ? esc(colors) : colors.length ? 'multi' : 'C';
    return `<article class="mcard ${frameClass}" style="${r.artifact ? '' : esc(cardFrameStyle(colors))}">
      <div class="bar title">
        <input type="text" class="name" value="${esc(card.name ?? '')}" data-item="${list}|${i}|name" data-kind="text"
          placeholder="${isMana ? 'Mana Point' : 'Card name'}" aria-label="Card name">
        <span class="cost" title="Spell point cost, and the colour(s) it must be paid in — two or more with Rainbow Efficiency${r.fromSphere ? '. No colour of its own: the frame follows the sphere' : ''}">
          <input type="text" value="${esc(card.cost ?? '')}" data-item="${list}|${i}|cost" data-kind="text" placeholder="—" aria-label="Cost">
          <input type="text" class="colorpick" value="${esc(card.color ?? '')}" data-item="${list}|${i}|color" data-kind="text"
            placeholder="${esc(r.fromSphere ? colors : '◌')}" aria-label="Cost colours" title="Colour letters: R B U W G">
          ${this.#manaChips(colors, '')}
        </span>
      </div>
      ${p.harrow ? `<div class="bar sub">
        ${this.#itemSelect(list, i, 'suit', card.suit, ABILITY_LABELS_LIST, 'suit')}
        <input type="text" value="${esc(card.alignment ?? '')}" data-item="${list}|${i}|alignment" data-kind="text" placeholder="align." aria-label="Alignment">
      </div>` : ''}
      <div class="art">${card.art ? `<img src="${esc(card.art)}" alt="" loading="lazy">` : ''}</div>
      <div class="bar type">
        <input type="text" value="${esc(card.sphere ?? '')}" data-item="${list}|${i}|sphere" data-kind="text" placeholder="${isMana ? 'Mana Point' : 'Sphere'}" aria-label="Sphere">
        <span class="dash">—</span>
        <input type="text" value="${esc(card.tags ?? '')}" data-item="${list}|${i}|tags" data-kind="text" placeholder="tags" aria-label="Tags">
      </div>
      <div class="text">${this.#prose(`data-item="${list}|${i}|effect"`, card.effect, 3, 'grow')}</div>
      <div class="foot">
        <span class="pair" title="Mana this card puts on the table (fused Mana Point): letters R B U W G">
          <input type="text" class="short" value="${esc(card.mana ?? '')}" data-item="${list}|${i}|mana" data-kind="text" placeholder="mana" aria-label="Mana carried">
          ${this.#manaChips(card.mana, '')}
        </span>
        <span class="pair" title="Dice to roll on the table — 6d6+int.mod, or a name from the sheet in the flat part; blank uses the first dice in the text">🎲<input type="text" class="short dice" value="${esc(card.dice ?? '')}" data-item="${list}|${i}|dice" data-kind="text" placeholder="dice" aria-label="Dice"></span>
        ${inDeck ? `<span class="pair" title="Copies in the deck">×${this.#itemNum(list, i, 'qty', card.qty)}</span>` : ''}
        <label class="chk" title="A technique card"><input type="checkbox" ${card.tech ? 'checked' : ''} data-item="${list}|${i}|tech" data-kind="bool"><span>tech</span></label>
        ${inDeck && p.useD100 && range ? `<span class="roll" title="d100 roll for this card">${esc(range)}</span>` : ''}
      </div>
      <div class="foot last">
        <input type="text" class="arturl" value="${esc(card.art ?? '')}" data-item="${list}|${i}|art" data-kind="text"
          placeholder="art: paste an image link" aria-label="Art URL">
        <span class="pair tools">
          ${inDeck ? `<button data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
          <button data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>` : ''}
          <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
        </span>
      </div>
    </article>`;
  }

  /** The deck: one face per card. */
  #deckTablePanel(p, k) {
    const list = 'cardcasting.cards';
    const cards = p.cards || [];
    const suitTally = k.suitTally || {};
    const alignTally = k.alignTally || {};
    const newCard = (extra) => ({
      name: '', suit: '', alignment: '', color: '', mana: '', effect: '', cost: '1', sphere: '', tags: '',
      qty: 1, tech: false, roll: null, art: '', notes: '', ...extra,
    });
    return `<section class="panel span2">
      <h3>Deck
        <span class="badge">${k.deckSize ?? 0} cards</span>
        ${p.useD100 ? `<span class="badge">d100 — reroll above ${k.deckSize ?? 0}</span>` : ''}
        <span class="pair" style="margin-left:auto;font-weight:400;text-transform:none;letter-spacing:0">
          ${this.#check('cardcasting.harrow', p.harrow, 'Harrow deck — suits & alignments')}
        </span>
      </h3>
      <p class="hint">Cost and its colour sit top right and colour the frame; the type line is
        sphere — tags; the letters under the text are the mana the card puts on the table when a
        Mana Point card is fused onto it (leave the effect blank for a plain Mana Point card).
        ${p.useD100 ? 'The number bottom right is the card\'s roll on the d100.' : ''}</p>
      ${p.harrow && Object.keys(suitTally).length ? `<div class="tally">
        ${Object.entries(suitTally).map(([s, n]) => `<span class="t">${esc(s)} <span class="n">${n}</span></span>`).join('')}
        <span class="t">·</span>
        ${Object.entries(alignTally).map(([a, n]) => `<span class="t">${esc(a)} <span class="n">${n}</span></span>`).join('')}
      </div>` : ''}
      ${cards.length ? `<div class="cardgrid">${cards.map((card, i) => this.#cardFace(list, i, card, p)).join('')}</div>`
    : '<p class="empty">No cards yet. A deck needs at least 20.</p>'}
      <div class="pair" style="margin-top:10px">
        ${this.#addButton(list, 'Add effect card', newCard({}))}
        ${this.#addButton(list, 'Add mana point card', newCard({ cost: '', mana: (k.colorsInPlay || 'R').slice(0, 1) }))}
      </div>
    </section>`;
  }

  /** Cards kept aside for a swap at rest. */
  #sideboardPanel(p) {
    const list = 'cardcasting.sideboard';
    const cards = p.sideboard || [];
    return `<section class="panel span2">
      <h3>Sideboard <span class="badge">${cards.length}</span></h3>
      <p class="hint">Cards built but not in the deck — the deck can only change when you rest to regain spell points.</p>
      ${cards.length ? `<div class="cardgrid">${cards.map((card, i) => this.#cardFace(list, i, card, p, { inDeck: false })).join('')}</div>` : ''}
      <div style="margin-top:10px">${this.#addButton(list, 'Add to sideboard', {
    name: '', suit: '', alignment: '', effect: '', cost: '', sphere: '', tags: '', color: '', mana: '', art: '', notes: '',
  })}</div>
    </section>`;
  }

  /* ---------------- trackers ---------------- */

  #trackersPanel() {
    const trackers = this.#model.trackers;
    const names = this.#model.scopeNames();
    const draft = this.#draft;
    const preview = this.#previewBox('add', draft.formula, draft.minFormula);

    return `<div class="grid">
      <section class="panel span2">
        <h3>Resource trackers</h3>
        ${trackers.length ? trackers.map((t) => this.#trackerRow(t)).join('') : '<p class="empty">No trackers yet.</p>'}
      </section>

      <section class="panel span2">
        <h3>Add a tracker</h3>
        <div class="formrow">
          <div class="cols">
            <input data-draft="name" placeholder="Name (e.g. Mythic Power)" value="${esc(draft.name)}">
            <input class="mono" data-draft="formula" placeholder="Max, as a formula (e.g. 3 + mythic.tier * 2)" value="${esc(draft.formula)}">
            <input class="mono" data-draft="minFormula" placeholder="Min (optional, e.g. -floor(qi.max / 2))" value="${esc(draft.minFormula || '')}">
            <input data-draft="refresh" placeholder="Refresh (Daily)" value="${esc(draft.refresh)}">
          </div>
          ${preview}
          <input data-draft="note" placeholder="Note (optional) — {= self.current * level} reads the pool as it fills"
            value="${esc(draft.note || '')}" aria-label="Note">
          <div><button class="primary" data-action="add-tracker">Add tracker</button></div>
        </div>
        <p class="hint">
          Formulas are plain text and are never executed as code — they are parsed and
          evaluated in a sandbox, and every one is visible to your GM in the Formula Audit tab.
          Functions: <code>floor</code> <code>ceil</code> <code>round</code> <code>min</code>
          <code>max</code> <code>sum</code> <code>abs</code> <code>clamp</code> <code>if</code>
          <code>mod</code> <code>iterations</code>.
          <button data-action="formulas" class="linkish"
            title="The guide, a scratchpad, and every value with its current number"
            >ƒx Formulas</button> has all of them explained, somewhere to try one, and every
          value this character can read with what it is worth now.
        </p>
        <p class="hint">
          <strong>Min</strong> is 0 unless you give it a formula. A negative min makes a two-sided
          meter that swings below zero — e.g. max <code>floor((burn.max + qi.max) / 4)</code>
          and min <code>-floor((burn.max + qi.max) / 4)</code> for a ±7 pool. Custom trackers
          can be edited later with ✎.
        </p>
        <details>
          <summary class="hint" style="cursor:pointer">Available values (${names.length})</summary>
          <div style="margin-top:6px">${names.map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</div>
        </details>
      </section>
    </div>`;
  }

  /**
   * One tracker. An ordinary pool runs 0..max and `current` counts what has
   * been spent. A tracker whose min is below zero is a two-sided meter
   * (Hellfire Qi: -7..+7): `current` is a signed position, negative pips grow
   * leftwards from a zero mark, and the value is shown red while negative.
   */
  /**
   * A formula shown under the thing it drives -- a tracker's max, its min.
   *
   * Coloured rather than plain, spaced out rather than as typed, and carrying
   * its own working on hover: "floor(level / 2) + wis.mod = floor(20 / 2) + 5
   * = 15" answers where the number came from without leaving the row.
   */
  #formulaMeta(label, source) {
    return `<div class="tmeta" title="${esc(workingLine(source, this.#model.scope()))}">${
      esc(label)} = <code class="fx-code">${highlight(pretty(source))}</code></div>`;
  }

  /** A draining tracker shows and edits what is left rather than what was spent. */
  #isDraining(t) {
    return (Number(t.min) || 0) >= 0 && normalizeStyle(t.style).fill === 'remaining';
  }

  #trackerRow(t) {
    if (this.#editTracker === t.id) return this.#trackerEditRow(t);
    const max = Number(t.max) || 0;
    const min = Number(t.min) || 0;
    const cur = Number(t.current) || 0;
    const twoSided = min < 0;
    const draining = this.#isDraining(t);
    const signed = (n) => (n > 0 ? `+${n}` : String(n).replace('-', '−'));
    const shown = draining ? max - cur : cur;

    const range = min === 0 ? `/ ${max}`
      : (twoSided && min === -max) ? `/ ±${max}`
        : `/ ${signed(min)}…${signed(max)}`;
    // Everything is editable; only Mythic Power cannot be deleted.
    const protectedTracker = this.#model.isProtectedTracker(t.id);
    const minusLabel = twoSided ? 'Decrease by one' : draining ? 'Spend one' : 'Restore one';
    const plusLabel = twoSided ? 'Increase by one' : draining ? 'Restore one' : 'Spend one';
    // The zone the tracker currently sits in (by the value the row shows) --
    // a labelled zone doubles as a state readout: "Hungry", "Sated", "Stuffed".
    const state = zoneAt(shown, t.resolvedZones || []);
    const stateBadge = state?.label
      ? `<span class="badge zonestate" style="border-color:${state.color};color:${state.color}" title="${esc(`${state.fromValue}–${state.toValue}`)}">${esc(state.label)}</span>`
      : '';

    return `<div class="tracker ${t.error ? 'invalid' : ''} ${twoSided ? 'two-sided' : ''}">
      <div>
        <div class="tname">${esc(t.name)}
          ${t.source === 'player' ? '<span class="badge player">custom</span>'
    : `<span class="badge">from sheet${t.edited ? ', edited' : ''}</span>`}
          ${protectedTracker ? '<span class="badge" title="Every character has Mythic Power from level 8">required</span>' : ''}
          ${t.refresh ? `<span class="badge">${esc(t.refresh)}</span>` : ''}
          ${draining ? '<span class="badge">drains</span>' : ''}
          ${stateBadge}
        </div>
        ${t.maxFormula ? this.#formulaMeta('max', t.maxFormula) : ''}
        ${t.minFormula ? this.#formulaMeta('min', t.minFormula) : ''}
        ${t.note ? `<div class="tnote">${hasTokens(t.note)
      ? this.#renderedProse(t.note, this.#model.trackerScope(t))
      : esc(t.note)}</div>` : ''}
        ${t.error ? `<div class="terr">${esc(t.error)}</div>` : ''}
        ${this.#trackerVisual(t, normalizeStyle(t.style), t.resolvedZones || [], { interactive: true })}
      </div>
      <div class="tracker-controls">
        <button data-tracker-step="${t.id}" data-delta="-1" aria-label="${minusLabel}">−</button>
        <input type="number" class="${shown < 0 ? 'neg' : ''}" value="${shown}" data-tracker-current="${t.id}"
          aria-label="${esc(t.name)} ${draining ? 'remaining' : 'current'}">
        <span class="pool">${range}</span>
        <button data-tracker-step="${t.id}" data-delta="1" aria-label="${plusLabel}">+</button>
        <button data-tracker-edit="${t.id}" aria-label="Edit ${esc(t.name)}" title="Edit">✎</button>
        ${protectedTracker ? '' : `<button class="danger" data-tracker-remove="${t.id}" aria-label="Remove ${esc(t.name)}">×</button>`}
      </div>
    </div>`;
  }

  /**
   * The pips, bar or squares of a tracker, painted with a style.
   *
   * Pips: one per integer step in [min, max] (zero is a marker, not a pip);
   * lit pips take the step's colour (zone > gradient > base), unlit pips in a
   * zone keep a faint tint of it so the range shows even when empty. Beyond 40
   * steps only the number shows -- decided from the count before anything is
   * built, so a huge formula cannot stall the page.
   *
   * Bar: a continuous track; zones are faint bands, the fill is the base colour
   * or its gradient, and the parts of the fill inside a zone take that colour.
   * Two-sided meters fill outward from a zero line.
   *
   * Squares: the same pips packed two-by-two, for a pool small enough to read
   * without counting -- a prepared spell's handful of uses. Past four it prints
   * the count instead, and comes back to pips as the count falls.
   *
   * `interactive: false` renders inert spans (the editor's live preview).
   */
  #trackerVisual(t, style, resolvedZones, { interactive = true, current = null, layers = null } = {}) {
    const max = Number(t.max) || 0;
    const min = Number(t.min) || 0;
    const cur = current ?? (Number(t.current) || 0);
    const twoSided = min < 0;
    const draining = !twoSided && style.fill === 'remaining';
    const signed = (n) => (n > 0 ? `+${n}` : String(n).replace('-', '−'));
    const ctx = { min, max, style, resolvedZones };
    const pct = (f) => `${(f * 100).toFixed(3)}%`;

    if (style.shape === 'bar') {
      const layout = barLayout({ min, max, current: cur, style, resolvedZones });
      let fill = '';
      if (layout.fill) {
        const f = layout.fill;
        const width = f.to - f.from;
        let background;
        if (f.negative) {
          const base = style.negativeColor || THEME_NEGATIVE.css;
          background = style.negativeGradientTo
            ? `linear-gradient(to left, ${base}, ${style.negativeGradientTo}) right / ${pct((layout.zero || 0) / width)} 100% no-repeat`
            : base;
        } else {
          const base = style.color || THEME_ACCENT.css;
          const side = twoSided ? 1 - layout.zero : 1;   // the gradient spans the whole positive side
          background = style.gradientTo
            ? `linear-gradient(to right, ${base}, ${style.gradientTo}) left / ${pct(side / width)} 100% no-repeat`
            : base;
        }
        fill = `<div class="fill" style="left:${pct(f.from)};width:${pct(width)};background:${background}"></div>`;
      }
      const shownValue = draining ? max - cur : cur;
      const title = twoSided ? signed(cur) : `${shownValue} of ${max}`;
      return `<div class="bar ${twoSided ? 'two-sided' : ''}" ${interactive ? `data-bar="${t.id}"` : ''}
          title="${esc(title)}${interactive ? ' — click to set' : ''}">
        ${layout.bands.map((b) => `<div class="band" style="left:${pct(b.from)};width:${pct(b.to - b.from)};background:${rgba(b.color, 0.22)}"
          ${b.label ? `title="${esc(b.label)}"` : ''}></div>`).join('')}
        ${fill}
        ${layout.segments.map((s) => `<div class="seg" style="left:${pct(s.from)};width:${pct(s.to - s.from)};background:${s.color}"></div>`).join('')}
        ${layout.zero !== null ? `<div class="zero-line" style="left:${pct(layout.zero)}"></div>` : ''}
      </div>`;
    }

    /*
     * Squares: a small square of pips for a pool you can hold in your hand,
     * giving way to a plain count once there are more of them than the eye
     * takes in at a glance. Clicking a pip sets the tracker to what that pip
     * would leave, so the same handler the other shapes use still applies.
     */
    if (style.shape === 'squares') {
      const sq = squareLayout({ min, max, current: cur, style });
      const colour = stepColor(Math.max(1, sq.lit), ctx);
      const label = `${sq.lit} of ${max}${draining ? ' left' : ' used'}`;
      if (sq.mode === 'number') {
        return `<div class="pipcount" title="${esc(label)}" style="color:${colour};border-color:${colour}">
          ${sq.lit}<span class="of">/${max}</span></div>`;
      }
      const tag = interactive ? 'button' : 'span';
      return `<div class="pips square" title="${esc(label)}">${
        Array.from({ length: sq.slots }, (_, i) => {
          const n = i + 1;                       // this pip stands for the nth use
          const on = n <= sq.lit;
          const paint = on ? `background:${colour};border-color:${colour}` : '';
          // `data-n` is the pip's own number; the click handler converts it for
          // a draining tracker and spends one when the last lit pip is clicked.
          return `<${tag} class="pip ${on ? 'used' : ''}" style="${paint}"
            ${interactive ? `data-pip="${t.id}" data-n="${n}"` : ''}
            title="${esc(`${n} of ${max}`)}"
            aria-label="Set ${esc(t.name)} to ${n}"></${tag}>`;
        }).join('')
      }</div>`;
    }

    const stepCount = max >= min ? (max - min + 1) - (min <= 0 && max >= 0 ? 1 : 0) : 0;
    if (!(stepCount > 0 && stepCount <= PIP_LIMIT)) return '';
    const steps = [];
    for (let k = min; k <= max; k++) if (k !== 0) steps.push(k);
    const tag = interactive ? 'button' : 'span';
    const remaining = max - cur;
    const zeroMark = `<${tag} class="pip zero" ${interactive ? `data-pip="${t.id}" data-n="0"` : ''} title="0"
      aria-label="Set ${esc(t.name)} to 0"></${tag}>`;
    return `<div class="pips">${steps.map((k, i) => {
      const lit = twoSided ? (k > 0 ? cur >= k : cur <= k)
        : draining ? k <= min + remaining : cur >= k;
      const zone = zoneAt(k, resolvedZones);
      const colour = stepColor(k, ctx);
      const paint = lit ? `background:${colour};border-color:${colour}`
        : zone ? `border-color:${zone.color};background:${rgba(zone.color, 0.18)}` : '';
      // A meter's layers mark the pip they cover: borrowed capacity is drawn
      // as an outline, a spoken-for step keeps its colour but is struck.
      const marks = layers ? this.#meterPipClass(k, layers) : '';
      const layerLabel = layers
        ? (layers.filter((l) => k > Math.min(l.from, l.to) && k <= Math.max(l.from, l.to))
          .map((l) => l.label).filter(Boolean).join(' · '))
        : '';
      const label = `${twoSided ? signed(k) : `${k} of ${max}`}${zone?.label ? ` · ${zone.label}` : ''}${layerLabel ? ` · ${layerLabel}` : ''}`;
      const pip = `<${tag} class="pip ${k < 0 ? 'neg' : ''} ${lit ? 'used' : ''} ${marks}" ${interactive ? `data-pip="${t.id}" data-n="${k}"` : ''}
          style="${paint}" title="${esc(label)}" aria-label="Set ${esc(t.name)} to ${twoSided ? signed(k) : k}"></${tag}>`;
      // The zero mark sits between the last negative pip and the first positive one.
      const markBefore = twoSided && k > 0 && (i === 0 || steps[i - 1] < 0);
      const markAfter = twoSided && k < 0 && i === steps.length - 1;
      return `${markBefore ? zeroMark : ''}${pip}${markAfter ? zeroMark : ''}`;
    }).join('')}</div>`;
  }

  /* ---------------- built-in meters ---------------- */

  /**
   * A meter -- hit points, essence -- painted with the player's style.
   *
   * The shapes and colours are a tracker's, so the base picture comes from
   * `#trackerVisual` and this adds what a meter has and a tracker does not:
   * layers over the track, and an alarm state. A layer is a value range, so
   * it lands in the right place whichever shape is chosen -- a band across a
   * bar, marked pips in a row of pips.
   *
   * Pips are refused rather than drawn badly: a hundred and eighty hit points
   * is not a row of pips, so a meter that would need more than the pip limit
   * falls back to its bar and the editor says so.
   */
  #meterVisual(spec, { interactive = false } = {}) {
    if (!spec) return '';
    const style = spec.style;
    const min = Number(spec.min) || 0;
    const max = Number(spec.max) || 0;
    const steps = max - min;
    const shape = (style.shape === 'pips' && (steps <= 0 || steps > PIP_LIMIT))
      ? 'bar' : style.shape;
    const drawn = { ...style, shape };
    const alert = Math.max(0, Math.min(1, Number(spec.alert) || 0));
    const pct = (f) => `${(f * 100).toFixed(3)}%`;

    // Layers are drawn over the shape; a shape that cannot carry them (the
    // squares' bare count) simply gets none.
    let layers = '';
    if (shape === 'bar') {
      layers = (spec.layers || []).map((l) => {
        const band = trackBand(l.from, l.to, min, max);
        return band ? `<div class="mlayer ${esc(l.kind)}" style="left:${pct(band.from)};width:${pct(band.to - band.from)}"
          title="${esc(l.label || '')}"></div>` : '';
      }).join('');
    }

    const visual = this.#trackerVisual(
      { ...spec, id: spec.id }, drawn, spec.resolvedZones || [],
      { interactive, current: spec.current, layers: shape === 'pips' ? spec.layers : null },
    );
    // The alarm is the track's own: a red ground that deepens and a glow that
    // widens, both scaled by how far gone the character is, so 1 hit point
    // from death looks nothing like 1 point past zero.
    const classes = ['meter', spec.id];
    if (alert > 0) classes.push('is-alert', ...(spec.alertFill ? ['alert-fill'] : []));
    return `<div class="${esc(classes.join(' '))}"${alert > 0 ? ` style="--alert:${alert.toFixed(3)}"` : ''}>
      ${visual}${layers ? `<div class="mlayers">${layers}</div>` : ''}
    </div>`;
  }

  /** The ✎ that opens a meter's style editor, and closes it again. */
  #meterStyleButton(key) {
    const open = this.#editMeter === key;
    return `<button class="tiny" data-meter-edit="${key}" aria-pressed="${open}"
      style="margin-left:auto" title="${open ? 'Done' : 'Change how this is drawn'}">${open ? 'Done' : '✎ Style'}</button>`;
  }

  /**
   * The style editor for a meter, when it is the one being edited.
   *
   * It is the tracker editor's own block -- shape, fill, colours, gradients
   * and zones -- pointed at a meter instead, so there is one set of controls
   * to learn and one to maintain. What differs is what it saves to and the
   * example a zone bound is written with.
   */
  #meterStyleEditor(key) {
    if (this.#editMeter !== key) return '';
    const spec = this.#model.meterSpec(key);
    if (!spec) return '';
    return `<div class="meter-style">
      <div class="tstyle" data-tstyle-for="${esc(key)}">${this.#trackerStyleEditor(spec)}</div>
      <div class="pair">
        <button class="primary" data-action="save-meter" data-key="${esc(key)}">Save</button>
        <button data-action="cancel-meter">Cancel</button>
        <button data-action="reset-meter" data-key="${esc(key)}"
          title="Back to the bar every character starts with">Reset to default</button>
      </div>
    </div>`;
  }

  /**
   * The pips of a meter, marked where its layers fall.
   *
   * Called from `#trackerVisual` while it walks the steps, because a pip has
   * to know whether it is borrowed or spoken for before it is painted -- a
   * temporary hit point is drawn as an outline rather than a solid, and a
   * nonlethal one keeps its colour but is struck through.
   */
  #meterPipClass(k, layers) {
    // Pip k stands for the step (k-1, k], so a layer from 20 to 24 is the four
    // pips 21..24 -- the twentieth is the last of the granted pool, not the
    // first of the borrowed one.
    return (layers || [])
      .filter((l) => k > Math.min(l.from, l.to) && k <= Math.max(l.from, l.to))
      .map((l) => `is-${l.kind}`)
      .join(' ');
  }

  /**
   * In-place editor: name, formulas, refresh and style. Every tracker is
   * editable, including the ones seeded from the sheet's own Resource Tracker
   * block -- those save what differs from the sheet, so Reset still restores it.
   */
  #trackerEditRow(t) {
    const d = this.#editDraft;
    return `<div class="tracker editing">
      <div class="formrow" style="margin:0">
        <div class="cols">
          <input data-tedit="name" placeholder="Name" value="${esc(d.name)}" aria-label="Tracker name">
          <input class="mono" data-tedit="maxFormula" placeholder="Max, as a formula" value="${esc(d.maxFormula)}" aria-label="Max formula">
          <input class="mono" data-tedit="minFormula" placeholder="Min (optional)" value="${esc(d.minFormula)}" aria-label="Min formula">
          <input data-tedit="refresh" placeholder="Refresh" value="${esc(d.refresh)}" aria-label="Refresh">
        </div>
        ${this.#previewBox('edit', d.maxFormula, d.minFormula)}
        ${this.#trackerNoteField(t, d.note)}
        ${t.source === 'sheet' ? `<p class="hint">Seeded from the sheet’s Resource Tracker — your
          changes are saved against it, and Reset restores the sheet’s version.</p>` : ''}
        <div class="tstyle" data-tstyle-for="${t.id}">${this.#trackerStyleEditor(t)}</div>
        <div style="display:flex;gap:6px">
          <button class="primary" data-action="save-tracker" data-id="${t.id}">Save</button>
          <button data-action="cancel-tracker">Cancel</button>
        </div>
      </div>
    </div>`;
  }

  /**
   * The tracker's note: prose that may carry {…} formulas, resolved against
   * the tracker itself.
   *
   * This is the readout for a resource that *does* something as it fills --
   * a kineticist's burn is nonlethal damage and a bonus at once -- so the note
   * has to be able to say "at this level of the pool, here is the number", and
   * recompute the moment a pip is clicked. `self` is the tracker's own row, so
   * the note keeps working after a rename.
   */
  #trackerNoteField(t, value) {
    const facts = Object.keys(this.#model.trackerScope(t).self);
    return `<label class="fld tall tnote-edit">
      <span>Note — shown under the tracker, formulas resolve as it fills</span>
      ${this.#prose(`data-tedit="note"`, value, 2, '', this.#model.trackerScope(t))}
      <span class="hint">
        <code>self</code> is this tracker: ${facts.map((k) => `<code>self.${k}</code>`).join(' ')}.
        Elsewhere on the character the same numbers are
        <code>tracker.${esc(t.id)}.max</code> and friends — that id is fixed when the
        tracker is created and does not follow a rename.<br>
        Burn, for example: <code>Nonlethal {= self.current * level}, +{= self.current} to DCs</code>.
        A <code>{name = …}</code> written here shows its value but is not published to the rest
        of the character, because a note reads the pool rather than defining it.
      </span>
    </label>`;
  }

  /**
   * The style section of the editor: shape, fill direction, colours (16
   * suggestions plus any hex), gradients, and highlighted zones, with a live
   * preview of the tracker painted with the draft.
   */
  #trackerStyleEditor(t) {
    const s = this.#editDraft.style;
    const twoSided = (Number(t.min) || 0) < 0;
    // A zone bound is a formula, and the example has to be one the thing being
    // styled can actually read: a tracker knows its own max, a meter does not.
    const zoneExample = t.zoneExample || 'self.max * 0.3';
    const zoneRows = s.zones.map((z, i) => `
      <div class="zone-row">
        <input class="mono" data-zone="${i}|from" placeholder="from (e.g. 0)" value="${esc(z.from)}" aria-label="Zone ${i + 1} from">
        <input class="mono" data-zone="${i}|to" placeholder="to (e.g. ${esc(zoneExample)})" value="${esc(z.to)}" aria-label="Zone ${i + 1} to">
        <input type="color" data-zonepick="${i}" value="${esc(z.color)}" aria-label="Zone ${i + 1} colour">
        <input class="mono hexin" data-zone="${i}|color" value="${esc(z.color)}" aria-label="Zone ${i + 1} hex" maxlength="7">
        <input data-zone="${i}|label" placeholder="label (optional)" value="${esc(z.label)}" aria-label="Zone ${i + 1} label">
        <button class="danger" data-zone-remove="${i}" aria-label="Remove zone ${i + 1}">×</button>
      </div>`).join('');

    return `
      <div class="tstyle-row">
        <span class="tlabel">Shape</span>
        <select data-tstyle="shape" aria-label="Shape">
          <option value="pips" ${s.shape === 'pips' ? 'selected' : ''}>Pips</option>
          <option value="bar" ${s.shape === 'bar' ? 'selected' : ''}>Bar</option>
          <option value="squares" ${s.shape === 'squares' ? 'selected' : ''}>Squares — a small block, then a count</option>
        </select>
        <span class="tlabel">Fill</span>
        <select data-tstyle="fill" aria-label="Fill direction" ${twoSided ? 'disabled title="Two-sided meters always show their position"' : ''}>
          <option value="spent" ${s.fill === 'spent' ? 'selected' : ''}>Fills up as it is spent</option>
          <option value="remaining" ${s.fill === 'remaining' ? 'selected' : ''}>Drains — shows what is left</option>
        </select>
      </div>
      ${this.#colorField('color', s.color, { label: twoSided ? 'Colour (above 0)' : 'Colour', none: 'Theme accent', noneCss: THEME_ACCENT.css })}
      ${this.#colorField('gradientTo', s.gradientTo, { label: 'Fade to', none: 'No gradient', noneCss: null })}
      ${twoSided ? this.#colorField('negativeColor', s.negativeColor, { label: 'Colour (below 0)', none: 'Theme red', noneCss: THEME_NEGATIVE.css }) : ''}
      ${twoSided ? this.#colorField('negativeGradientTo', s.negativeGradientTo, { label: 'Fade to (below 0)', none: 'No gradient', noneCss: null }) : ''}
      <div class="tstyle-row" style="align-items:flex-start">
        <span class="tlabel" style="padding-top:5px">Zones</span>
        <div style="flex:1;display:grid;gap:5px">
          ${zoneRows}
          <div><button data-add-zone>+ Zone</button>
            <span class="hint">Highlight a value or range in its own colour. Bounds are formulas —
              <code>floor(${esc(zoneExample)})</code> for a band a third of the way up — and a labelled zone
              shows its name on the ${t.meter ? 'meter' : 'tracker'} while the value sits in it.</span></div>
        </div>
      </div>
      <div class="tstyle-row">
        <span class="tlabel">Preview</span>
        <div class="style-preview" style="flex:1">${this.#stylePreviewHtml(t)}</div>
      </div>`;
  }

  /** One colour control: a "none" swatch, the 16 suggestions, a hex field and a native picker. */
  #colorField(field, value, { label, none, noneCss }) {
    const noneStyle = noneCss ? `background:${noneCss}` : '';
    return `<div class="tstyle-row">
      <span class="tlabel">${esc(label)}</span>
      <div class="swatches" role="group" aria-label="${esc(label)}">
        <button class="swatch none" data-swatch="${field}" data-hex="" style="${noneStyle}"
          title="${esc(none)}" aria-label="${esc(none)}" aria-pressed="${value ? 'false' : 'true'}"></button>
        ${TRACKER_PALETTE.map(([hex, name]) => `<button class="swatch" data-swatch="${field}" data-hex="${hex}"
          style="background:${hex}" title="${esc(name)} ${hex}" aria-label="${esc(name)}"
          aria-pressed="${value === hex ? 'true' : 'false'}"></button>`).join('')}
      </div>
      <input class="mono hexin" data-hexin="${field}" value="${esc(value || '')}" placeholder="#rrggbb" maxlength="7" aria-label="${esc(label)} hex">
      <input type="color" data-hexpick="${field}" value="${esc(value || (noneCss ? THEME_ACCENT.hex : '#888888'))}" aria-label="${esc(label)} picker">
    </div>`;
  }

  /** The tracker or meter as it would look with the draft style (zone formulas resolved live). */
  #stylePreviewHtml(t) {
    const style = normalizeStyle(this.#editDraft.style);
    const scope = this.#model.scope();
    const zones = resolveZones(style.zones, (src) => evaluateFormula(src, scope));
    const bad = zones.map((z, i) => (z.error ? `zone ${i + 1}: ${z.error}` : null)).filter(Boolean);
    const tooManyPips = t.meter && style.shape === 'pips'
      && ((Number(t.max) || 0) - (Number(t.min) || 0)) > PIP_LIMIT;
    const visual = t.meter
      ? this.#meterVisual({ ...t, style, resolvedZones: zones })
      : (this.#trackerVisual(t, style, zones, { interactive: false })
        || '<span class="hint">(no pips for this range — try the bar)</span>');
    const note = tooManyPips
      ? `<div class="hint">Over ${PIP_LIMIT} steps to draw, so this one stays a bar.</div>` : '';
    return `${visual}${note}${bad.length ? `<div class="terr">${esc(bad.join('; '))}</div>` : ''}`;
  }

  /** Whatever the style editor is pointed at: a meter if one is open, else the tracker. */
  #styleTarget() {
    return this.#editMeter
      ? this.#model.meterSpec(this.#editMeter)
      : this.#model.trackers.find((x) => x.id === this.#editTracker);
  }

  /**
   * The preview box is always in the DOM (hidden while empty) so typing into a
   * formula field can update it in place instead of re-rendering the panel and
   * dropping focus.
   */
  #previewBox(kind, maxSrc, minSrc) {
    const info = this.#trackerPreview(maxSrc, minSrc);
    return `<div class="preview ${kind} ${info.ok ? 'ok' : 'err'}"${info.text ? '' : ' style="display:none"'}>${esc(info.text)}</div>`;
  }

  /**
   * Live preview under the add and edit forms.
   *
   * It shows the substitution rather than only the answer -- "max = floor(20 /
   * 2) + 5 = 15" -- because the formula itself is in the box directly above,
   * and what the player cannot see from there is what their own numbers do to
   * it. A formula with nothing to substitute just states its answer.
   */
  #trackerPreview(maxSrc, minSrc) {
    const parts = [];
    let ok = true;
    for (const [label, src] of [['max', maxSrc], ['min', minSrc]]) {
      if (!String(src || '').trim()) continue;
      const w = workings(src, this.#model.scope());
      if (w.error) {
        ok = false;
        parts.push(`${label}: ${w.error}`);
      } else if (w.substituted === w.pretty || w.substituted === w.display) {
        parts.push(`${label} = ${w.display}`);
      } else {
        parts.push(`${label} = ${w.substituted} = ${w.display}`);
      }
    }
    return { ok, text: parts.join('   ·   ') };
  }

  /* ---------------- progression ---------------- */

  #progressionPanel() {
    const c = this.#model.data;
    const p = c.progression;
    if (!p) return '<div class="grid"><section class="panel"><h3>Progression</h3><p class="empty">No progression data.</p></section></div>';
    const classNames = c.classes.map((x) => x.name).filter(Boolean);
    const level = Number(c.identity.level) || 0;
    const tracks = Array.from({ length: p.tracks }, (_, i) => i);

    const classCell = (row, t) => {
      const value = row.classes?.[t] ?? '';
      const pairs = classNames.map((n) => [n, n]);
      if (value && !classNames.includes(value)) pairs.push([value, `${value} *`]);
      return `<select data-prog="${row.level}|${t}">
        <option value="">—</option>
        ${pairs.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`;
    };

    return `<div class="grid">
      <section class="panel span2">
        <h3>Level progression
          <button data-action="add-track" title="Tristalt and beyond">+ Class track</button>
        </h3>
        <div class="tablewrap"><table class="gridtab prog">
          <thead><tr>
            <th class="num">Lvl</th>
            ${tracks.map((t) => `<th><span class="pair">Track ${t + 1}
              ${p.tracks > 1 ? `<button class="danger" data-action="remove-track" data-track="${t}"
                title="Delete this track">×</button>` : ''}</span>
              <select class="fillcol" data-filltrack="${t}"
                title="Put one class on every level of this track"
                aria-label="Fill track ${t + 1} with one class">
                <option value="" selected disabled hidden>Fill column…</option>
                ${classNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
              </select></th>`).join('')}
            <th class="num" title="Best hit die among the classes that level">HP</th>
            <th class="num" title="Best skill ranks">Ranks</th>
            <th class="num">Fort</th><th class="num">Ref</th><th class="num">Will</th>
          </tr></thead>
          <tbody>${p.levels.map((row) => `<tr class="${row.level > level ? 'future' : ''}">
            <td class="num">${row.level}</td>
            ${tracks.map((t) => `<td>${classCell(row, t)}</td>`).join('')}
            <td class="num derived">${row.computed?.hp ? `d${row.computed.hp}` : ''}</td>
            <td class="num derived">${row.computed?.ranks || ''}</td>
            <td class="num derived">${row.computed?.fort || ''}</td>
            <td class="num derived">${row.computed?.ref || ''}</td>
            <td class="num derived">${row.computed?.will || ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">
          Class tracks pick from the classes on the Overview; HP, ranks and saves per level
          are read-only, computed gestalt-style from the classes chosen on that row
          (good saves ½, poor ⅓). Rows past level ${level} are plans. Class features live
          in the groups below; ability-boosting choices on the <strong>Stats</strong> tab.
        </p>
        <p class="hint">
          <strong>Rule groups.</strong> Under each feature column's name, <em>+ level rule</em>
          adds a named, coloured schedule saying which levels it grants on — write
          <code>odd</code>, <code>even</code>, <code>2, +4</code> (2 and every 4 thereafter),
          <code>1, 2, +2</code> (1st and every even level), <code>5-10</code>, or a list.
          Terms add up left to right, so <code>2, +4, 3</code> is that schedule plus a
          one-off at 3, and <code>odd, -13</code> takes one away. A column with no rule
          grants at every level, as before.
        </p>
        <p class="hint">
          <strong>Several rules can share one column</strong> — give a kineticist's Wild Talent
          column <code>{Infusions, odd}</code> and <code>{Utility, even}</code> and each level
          is tinted and tagged by whichever grants it. Typing the whole braced form into either
          box fills both. Levels count the <em>class's</em> own levels; start a rule with
          <code>char:</code> to count character levels instead. Anything that isn't a level
          list is treated as a formula over <code>classLevel</code> / <code>charLevel</code>,
          e.g. <code>classLevel % 3 == 1</code>. A level you have reached that grants something
          you haven't filled in is outlined and counted on the group header; one you haven't
          reached yet is only faintly marked.
        </p>
      </section>
    </div>
    <div class="featgroups">
      ${this.#classFeatureGroups()}
    </div>`;
  }

  /**
   * One collapsible group per class named in the progression, holding that
   * class's per-level feature columns.
   */
  #classFeatureGroups() {
    const model = this.#model;
    const p = model.data.progression;
    // The menus this grid's cells pick from, gathered as the cells render so
    // one list is written per menu however many cells offer it.
    this.#menuLists = new Map();
    const names = model.progressionClasses();
    // Feature groups whose class is no longer in any track keep their data
    // and stay visible so nothing silently disappears.
    for (const key of Object.keys(p.classFeatures || {})) {
      const g = p.classFeatures[key];
      if (!names.includes(key) && key !== 'General'
        && (g.columns.length || Object.keys(g.byLevel).length)) names.push(key);
    }
    if (p.classFeatures?.General?.columns?.length) names.push('General');

    // Narrow groups first: flex wrapping packs in order, so putting the small
    // tables ahead lets two or three of them share a row before a wide one
    // claims its own.
    const widthOf = (name) => {
      const g = p.classFeatures?.[name] || { columns: [] };
      const saved = model.data.uiPrefs?.colWidths?.[`progfeat-${name}`] || {};
      return 46 + g.columns.reduce((t, col) => t + Math.max(90, Number(saved[col]) || 260), 0);
    };
    names.sort((a, b) => widthOf(a) - widthOf(b));

    return names.map((name) => {
      const g = p.classFeatures?.[name] || { columns: [], byLevel: {}, rules: {} };
      const orphaned = name !== 'General' && !model.classLevelsIn(name).length;
      // Rows carry both levels: the character level they sit at and the
      // class's own level count, which is what a rule counts by default.
      const rows = model.classFeatureRows(name);

      // Column widths are draggable; saved per character in uiPrefs.
      const tableKey = `progfeat-${name}`;
      const saved = model.data.uiPrefs?.colWidths?.[tableKey] || {};
      const colW = (col) => Math.max(90, Number(saved[col]) || 260);
      const total = 46 + g.columns.reduce((t, col) => t + colW(col), 0);
      const charLevel = Number(model.data.identity.level) || 0;
      const due = Object.values(model.classFeatureDue(name)).reduce((t, n) => t + n, 0);

      return this.#collapsible(`progfeat-${name}`, `<section class="panel featpanel">
        <h3>${esc(name)} features
          <span class="badge">${orphaned ? 'not in progression' : `levels ${rows.length ? `${rows[0].level}–${rows[rows.length - 1].level}` : '—'}`}</span>
          ${due ? `<span class="badge due" title="Levels you have reached that grant something you have not filled in">${due} to pick</span>` : ''}
        </h3>
        <div class="tablewrap"><table class="gridtab featgrid" style="width:${total}px">
          <colgroup>
            <col style="width:46px">
            ${g.columns.map((col) => `<col style="width:${colW(col)}px">`).join('')}
          </colgroup>
          <thead><tr><th class="num">Lvl</th>
            ${g.columns.map((col, i) => this.#featureColumnHead(name, col, i, tableKey)).join('')}
          </tr></thead>
          <tbody>${rows.map((row) => `<tr class="${row.level > charLevel ? 'future' : ''}">
            <td class="num"${name === 'General' ? ''
    : ` title="Character level ${row.level} — ${esc(name)} level ${row.classLevel}"`}>${row.level}</td>
            ${g.columns.map((col) => this.#featureCell(name, col, row,
    (g.rules?.[col] || []).length > 1)).join('')}
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:6px">
          <button class="primary" data-action="add-cf-column" data-class="${esc(name)}">+ Add column</button>
        </div>
        ${this.#classFeatureNotes(name)}
      </section>`);
    }).join('') + this.#menuListMarkup();
  }

  /**
   * What a class's features do, under the ladder that says when each arrives.
   *
   * One entry per distinct feature however many levels grant it, an archetype's
   * among them. This is where a pack's rules text lands: the Template tab is
   * for templates, and a class is not one.
   */
  #classFeatureNotes(className) {
    const notes = this.#model.classFeatureNotes(className);
    const open = !this.#model.data.uiPrefs.collapsed?.[`cfnotes-${className}`];
    return `<div class="cfnotes">
      <button class="notehead" data-collapse="cfnotes-${esc(className)}" aria-expanded="${open}">
        ${open ? '▾' : '▸'} What they do <span class="badge">${notes.length}</span>
      </button>
      ${open ? `${notes.map((f, i) => `<div class="cfnote">
        <span class="pair">
          <input type="text" class="notename" value="${esc(f.name)}" spellcheck="false"
            data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'name' }))}">
          <select data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'type' }))}">
            ${['', 'Ex', 'Su', 'Sp'].map((t) => `<option value="${t}"${(f.type || '') === t ? ' selected' : ''}>${t || '—'}</option>`).join('')}
          </select>
          <button class="danger" data-action="remove-cfnote" data-class="${esc(className)}" data-index="${i}"
            title="Remove ${esc(f.name)}">×</button>
        </span>
        ${this.#prose(`data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'text' }))}"`, f.text, 3, 'grow')}
      </div>`).join('') || '<p class="empty">Nothing yet — a class added from a pack brings its features\' text here.</p>'}
      <div style="margin-top:6px">
        <button data-action="add-cfnote" data-class="${esc(className)}">+ Add feature text</button>
      </div>` : ''}
    </div>`;
  }

  /**
   * The id of the list a menu's cells offer, made on first use.
   *
   * A menu belongs to the pack that provides it, not to the character, so the
   * grid never holds a copy: it writes the list once and every cell picking
   * from that menu points at it.
   */
  #menuListId(menu, atLevel) {
    // A cell offers what it could actually take: an entry asking for a level
    // above this one is not on this cell's list. Levels that can take the same
    // entries share a list, so a twenty-level column writes two or three.
    const options = menu.options.filter((o) => !o.minLevel || o.minLevel <= atLevel);
    const key = `${menu.name}|${options.length}`;
    if (!this.#menuLists.has(key)) {
      this.#menuLists.set(key, { id: `cfmenu-${this.#menuLists.size}`, menu: { ...menu, options } });
    }
    return this.#menuLists.get(key).id;
  }

  /** Those lists, written once each after the tables that offer them. */
  #menuListMarkup() {
    return [...this.#menuLists.values()].map(({ id, menu }) => `<datalist id="${id}">${
      menu.options.map((o) => {
        // What the browser shows beside the name: where it sits in the menu
        // and the level it asks for, which is what a player is choosing on.
        const hint = [o.category, o.minLevel ? `${o.minLevel}th+` : '', o.source].filter(Boolean).join(' · ');
        return `<option value="${esc(o.name)}">${esc(hint)}</option>`;
      }).join('')
    }</datalist>`).join('');
  }

  /**
   * A feature column's header: its name, its level rule, and the drag handle.
   *
   * The rule box is deliberately plain text rather than a builder -- what a
   * player types ("2, +4") is what gets stored, so the schedule stays legible
   * and extensible after the fact.
   */
  #featureColumnHead(className, col, index, tableKey) {
    const groups = this.#model.classFeatureRuleGroups(className, col);
    const due = this.#model.classFeatureDue(className)[col] || 0;

    const groupRow = (grp, gi) => {
      const rule = parseLevelRule(grp.rule || '');
      const basis = rule.basis === 'char' ? 'character' : 'class';
      const title = rule.kind === 'error' ? `Rule not understood — ${rule.error}. Granting every level.`
        : rule.kind === 'formula' ? `Formula over ${basis} level: ${rule.expr}`
          : `Grants at ${basis} levels ${summariseLevels(levelRuleLevels(rule))}`;
      return `<span class="rulegroup" style="--gc:${esc(grp.color)}">
        <input type="color" value="${esc(grp.color)}" data-cfgcolor="${esc(className)}|${index}|${gi}"
          aria-label="Colour for ${esc(grp.name || col)}" title="Group colour">
        <input type="text" class="gname" value="${esc(grp.name)}" placeholder="name"
          data-cfgname="${esc(className)}|${index}|${gi}" spellcheck="false">
        <input type="text" class="grule ${rule.kind === 'error' ? 'bad' : ''}" value="${esc(grp.rule)}"
          placeholder="levels" data-cfgrule="${esc(className)}|${index}|${gi}"
          title="${esc(title)}" spellcheck="false">
        <button class="danger" data-action="remove-rule-group" data-class="${esc(className)}"
          data-col="${index}" data-group="${gi}" title="Remove this rule group">×</button>
      </span>`;
    };

    return `<th class="resizable">
      <span class="pair">
        <input type="text" class="colname" value="${esc(col)}" data-cfcol="${esc(className)}|${index}">
        ${due ? `<span class="badge due" title="${due} level${due === 1 ? '' : 's'} reached with nothing filled in">${due}</span>` : ''}
        <button class="danger" data-action="remove-cf-column" data-class="${esc(className)}" data-col="${index}" title="Remove column">×</button>
      </span>
      ${groups.map(groupRow).join('')}
      ${this.#featureColumnMenu(className, col, index)}
      <button class="addgroup" data-action="add-rule-group" data-class="${esc(className)}" data-col="${index}"
        title="${groups.length ? 'Another schedule sharing this column'
    : 'Limit this column to certain levels — try "odd", "even", "2, +4"'}">${groups.length ? '+ rule group' : '+ level rule'}</button>
      <div class="col-resizer" data-resize-table="${esc(tableKey)}" data-resize-col="${esc(col)}"
        title="Drag to resize"></div>
    </th>`;
  }

  /**
   * One feature cell. A column with no rule looks exactly as it always has;
   * a ruled column tints the levels it grants and locks the rest, the same
   * green/grey the sphere-talent grid uses.
   *
   * Text already sitting on a level a later rule excludes is kept and flagged
   * rather than hidden, so tightening a rule never quietly eats an entry.
   */
  #featureCell(className, col, row, multi) {
    const cell = row.cells[col];
    // Two rule groups granting at the same level are two things to write down,
    // so each gets its own field, stacked, in its own colour.
    return `<td class="featcell${cell.fields.length > 1 ? ' stacked' : ''}">
      ${cell.fields.map((f) => this.#featureField(className, col, row, f, multi)).join('')}
    </td>`;
  }

  /** One writable field inside a feature cell: its tag, its box, its state. */
  #featureField(className, col, row, field, multi) {
    const cell = row.cells[col];
    const colour = field.group?.color || null;
    const label = field.group?.name || col;

    const state = !cell.ruled ? ''
      : !field.on ? `slot-off${field.stranded ? ' kept' : ''}`
        : `slot-on${field.due ? ' due' : ''}${field.planned ? ' planned' : ''}`;
    const title = !cell.ruled ? ''
      : field.group?.orphan ? `“${field.group.name}” is no longer a rule group on this column — text kept, but not editable here.`
        : !field.on ? (field.stranded ? 'Outside every rule on this column — text kept, but not editable here.'
          : `No ${col} at this level.`)
          : `${label}${field.due ? ' — nothing chosen yet' : field.planned ? ' — not reached yet' : ''}`;

    // With one rule group the column heading already names it; a tag earns its
    // space once two schedules share a column, or two fields share a level.
    const tagged = (multi || cell.fields.length > 1) && field.group;
    const tag = tagged
      ? `<span class="ftag${field.group.orphan ? ' orphan' : ''}">${esc(label)}</span>` : '';
    const placeholder = field.due || field.planned ? ` placeholder="${esc(label)}…"` : '';
    // JSON rather than a delimiter: class, column and group names are free
    // text and any of them may contain the separator.
    const ref = esc(JSON.stringify({
      c: className, l: row.level, k: col, g: field.key,
    }));

    // Where a menu is attached the cell offers it, and says what the entry
    // written in it does. Still a box to type in: a GM's ruling, an option no
    // pack carries, or a note beside the name all go in as they always did.
    const menu = field.menu?.options?.length ? field.menu : null;
    const body = menu
      ? this.#menuField(ref, field, menu, placeholder, row.classLevel)
      : this.#prose(`class="cfeat" data-cfeat="${ref}"${field.on ? '' : ' disabled'}${placeholder}`, field.text, 1, 'grow');

    return `<span class="ffield ${state}"${colour ? ` style="--gc:${esc(colour)};--gc-soft:${rgba(colour, 0.13)}"` : ''}${title ? ` title="${esc(title)}"` : ''}>
      ${tag}${body}
    </span>`;
  }

  /**
   * Which menu a column's cells pick from.
   *
   * Only shown once a pack provides one, since with none there is nothing to
   * choose between. A menu named on the column but no longer provided stays
   * listed, so switching its pack off does not quietly forget the choice.
   */
  #featureColumnMenu(className, col, index) {
    // A column may name several menus, layered -- an archetype's over the
    // class's. The dropdown edits the first; the rest are shown after it,
    // since an archetype's pill is where those come and go.
    const stack = this.#model.classFeatureColumnOptions(className, col);
    const [chosen = '', ...layered] = stack;
    const all = optionCatalogues();
    if (!all.length && !chosen) return '';
    const names = all.map((c) => c.name);
    if (chosen && !names.some((n) => same(n, chosen))) names.push(chosen);
    const missing = chosen && !all.some((c) => same(c.name, chosen));
    const claimed = chosen && !this.#model.classFeatureColumnOptionsChosen(className, col);
    return `<select class="colmenu${missing ? ' bad' : ''}" data-cfmenu="${esc(className)}|${index}"
      title="${esc(missing ? `“${chosen}” is not switched on — its pack is off or not installed.`
    : claimed ? `“${chosen}” names this class and this feature, so this column picks from it. Choose another, or none.`
      : chosen ? `Cells in this column pick from “${chosen}”.`
        : 'Pick from a menu a pack provides, rather than typing each entry.')}">
      <option value=""${chosen ? '' : ' selected'}>— no menu —</option>
      ${names.map((n) => `<option value="${esc(n)}"${same(n, chosen) ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select>${layered.map((n) => `<span class="colmenu layered" title="${
      esc(`“${n}” is layered over the menu above — its entries win, and the ones it replaces drop out.`)}">+ ${esc(n)}</span>`).join('')}`;
  }

  /** A cell that picks from a menu: the names on offer, and what the one written means. */
  #menuField(ref, field, menu, placeholder, atLevel) {
    const chosen = menu.options.find((o) => same(o.name, field.text));
    const offered = menu.options.filter((o) => !o.minLevel || o.minLevel <= atLevel).length;
    // An entry written into a level below the one it asks for is flagged, not
    // refused: a GM may allow it, and the sheet's job is to say what the book
    // says rather than to stop anyone.
    const tooSoon = chosen?.minLevel > atLevel;
    const hint = chosen
      ? [chosen.category, chosen.minLevel ? `needs ${chosen.minLevel}th level` : '', chosen.source]
        .filter(Boolean).join(' · ')
        + (tooSoon ? `\n\nThis is a ${chosen.minLevel}th-level entry, written at ${atLevel}th.` : '')
        + (chosen.text ? `\n\n${chosen.text}` : '')
      : `${offered} of ${menu.options.length} on offer at this level — ${menu.name}`;
    // A locked cell never opens its list, so it does not ask for one written.
    const list = field.on ? ` list="${this.#menuListId(menu, atLevel)}"` : '';
    return `<input type="text" class="cfeat pick${tooSoon ? ' early' : ''}"${list} data-cfeat="${ref}"
      value="${esc(field.text)}"${field.on ? '' : ' disabled'}${placeholder}
      title="${esc(hint)}" spellcheck="false">`;
  }

  /* ---------------- lore & leftover tabs ---------------- */

  /**
   * Extras & Notes: the workbook's scratch page, as a tab. Notes to jot on,
   * the Approvals table (what was applied for, who approved it, the link),
   * and whatever else the worksheet held, kept as an editable grid.
   */
  #extrasPanel() {
    const c = this.#model.data;
    const x = c.extras || {};
    const list = 'extras.approvals';
    const isUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());
    return `<div class="grid">
      <section class="panel span2">
        <h3>Notes <span class="badge">${(c.notes || []).length}</span></h3>
        ${(c.notes || []).map((n, i) => `<div class="notecard editable">
          <div class="noterow">
            ${this.#itemText('notes', i, 'title', n.title, 'Title')}
            <button class="danger" data-remove="notes|${i}" aria-label="Remove note">×</button>
          </div>
          ${this.#itemArea('notes', i, 'body', n.body, 4)}
        </div>`).join('') || '<p class="empty">No notes yet — jot anything here: links, ideas, things to ask the GM.</p>'}
        <div style="margin-top:8px">${this.#addButton('notes', 'Add note', { title: '', body: '' })}</div>
        <p class="hint">Plain text, with inline formulas if you want them: <code>{= level * 2}</code>.
          Links are kept as typed.</p>
      </section>

      <section class="panel span2">
        <h3>Approvals <span class="badge">${(x.approvals || []).length}</span></h3>
        ${(x.approvals || []).length ? `<div class="tablewrap"><table>
          <thead><tr><th>App</th><th>Approved by</th><th>Link</th><th></th></tr></thead>
          <tbody>${x.approvals.map((a, i) => `<tr>
            <td>${this.#itemText(list, i, 'name', a.name, 'What was applied for')}</td>
            <td>${this.#itemText(list, i, 'approvedBy', a.approvedBy, 'Who approved it')}</td>
            <td><span class="pair">${this.#itemText(list, i, 'link', a.link, 'https://…')}
              ${isUrl(a.link) ? `<a href="${esc(a.link)}" target="_blank" rel="noopener" title="Open">↗</a>` : ''}</span></td>
            ${this.#rowTools(list, i)}
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">No approvals recorded.</p>'}
        <div style="margin-top:8px">${this.#addButton(list, 'Add approval', { name: '', approvedBy: '', link: '' })}</div>
        <p class="hint">Custom archetypes, feats and items that needed a sign-off, and where the approval lives.</p>
      </section>
      ${this.#systemExtrasPanel(x, 'extras', 'ExtrasNotes')}
    </div>`;
  }

  #lorePanel() {
    const c = this.#model.data;

    return `<div class="grid">
      <section class="panel span2">
        <h3>Background</h3>
        <div class="fieldgrid two">
          ${(c.backgroundSections || []).map((sec, i) => `<label class="fld tall">
            <span>${esc(sec.label)}</span>${this.#itemArea('backgroundSections', i, 'text', sec.text, 3)}
          </label>`).join('')}
        </div>
        <div style="margin-top:8px">${this.#addButton('backgroundSections', 'Add section', { label: 'New section', text: '' })}</div>
      </section>
    </div>`;
  }

  #itemArea(list, i, field, value, rows = 3, local = null) {
    return this.#prose(`data-item="${list}|${i}|${field}"`, value, rows, '', local);
  }

  /**
   * A prose field that may carry {…} inline formulas.
   *
   * Two layers in one wrapper: the textarea holds the raw source and shows
   * while focused; a rendered overlay shows computed values while not. Both
   * receive the same events, so this stays a plain data-item/data-set control.
   */
  #prose(bindingAttr, value, rows = 3, extraClass = '', local = null) {
    const text = value ?? '';
    const rendered = hasTokens(text) ? this.#renderedProse(text, local) : null;
    // The gold edge these fields carry says "formulas work here"; the tooltip
    // is what says how. Set on the wrapper so it covers both layers, and the
    // rendered view's own title still wins while it is showing.
    return `<span class="prose ${rendered ? 'has-tokens' : ''} ${extraClass}" title="${esc(PROSE_HINT)}">
      <textarea ${bindingAttr} data-kind="text" rows="${rows}" spellcheck="false">${esc(text)}</textarea>
      ${rendered ? `<span class="prose-view" title="Click to edit the formulas">${rendered}</span>` : ''}
    </span>`;
  }

  /**
   * What a computed value in prose says when you point at it.
   *
   * The token's own source, then its working -- because a bare "24" in the
   * middle of a sentence is the one place on the sheet where a player has no
   * way at all of seeing what produced it. A `{name}` reference shows the
   * formula from wherever the name was defined, which saves hunting for it.
   */
  #tokenTitle(seg, scope) {
    if (seg.kind === 'ref') {
      const def = (this.#model.inlineDefinitions || []).find((d) => d.name === seg.name);
      return def
        ? `{${seg.name}} — defined as ${workingLine(def.expr, scope)}`
        : `{${seg.name}}`;
    }
    const label = seg.kind === 'define' ? `{${seg.name} = …}` : '{= …}';
    return `${label} ${workingLine(seg.expr, scope)}`;
  }

  /**
   * The scope a prose token resolves in: the names the character defines,
   * then whatever is local to where the text was written (a veil's own
   * invested essence), then the character. Same order inline.js uses, so a
   * tooltip can never disagree with the value beside it.
   */
  #tokenScope(local) {
    const names = this.#model.inlineNames || {};
    const base = this.#model.scope();
    return {
      lookup: (name) => {
        if (Object.prototype.hasOwnProperty.call(names, name)) return names[name];
        if (local) {
          const v = resolvePath(local, name);
          if (v !== undefined) return v;
        }
        return resolvePath(base, name);
      },
    };
  }

  #renderedProse(text, local = null) {
    // Built once for the whole field rather than per token: scope() walks
    // every tracker, skill and companion, and a field may hold dozens of them.
    let scope = null;
    const tokenScope = () => (scope ??= this.#tokenScope(local));
    return this.#model.renderProse(text, local).map((seg) => {
      if (seg.kind === 'text') return esc(seg.text);
      if (seg.error) {
        const label = seg.kind === 'define' ? `{${seg.name} = ${seg.expr}}`
          : seg.kind === 'ref' ? `{${seg.name}}` : `{= ${seg.expr}}`;
        return `<span class="tok err" title="${esc(label)} — ${esc(seg.error)}">${esc(seg.raw)}</span>`;
      }
      const shown = formatValue(seg.value);
      return `<span class="tok ${seg.kind}" title="${esc(this.#tokenTitle(seg, tokenScope()))}">${esc(shown)}</span>`;
    }).join('');
  }

  /**
   * Render a tab we did not model explicitly, as an editable grid.
   *
   * These hold each character's bespoke machinery -- sphere talents, veils,
   * technique lists -- whose shape differs per character, so they stay a grid
   * rather than being forced into a schema. Every cell is editable and rows
   * can be added or removed.
   */
  #gridTab(index, tab) {
    const list = `sheetTabs.${index}.rows`;
    const rows = tab.rows || [];
    const width = Math.min(14, Math.max(...rows.map((r) => r.cells.length), 3));
    return `<section class="panel span2">
      <h3>${esc(tab.name)} ${tab.hidden ? '<span class="badge">hidden in source</span>' : ''}
        <span class="badge">${rows.length} rows</span></h3>
      <div class="tablewrap"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${
  hasTokens(r.cells[ci]) ? this.#prose(`data-item="${list}|${ri}|cells.${ci}"`, r.cells[ci], 1, 'grow')
    : this.#itemText(list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${this.#rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
      <div style="margin-top:8px">
        ${this.#addButton(list, 'Add row', { cells: Array.from({ length: width }, () => null) })}
      </div>
    </section>`;
  }

  /* ---------------- wealth ---------------- */

  /**
   * The wallet on the Overview: current mana, the offering owed under the Oath
   * of Offerings and for material casting (the workbook's own sums), what is
   * left after it, and the ledger every reward, spend and offering is written
   * to. "Record" is the hook a session-reward automation will call; "Make
   * offering" pays what is owed and starts the count over.
   *
   * Most of this panel is the offering, and most characters owe no offering.
   * What everyone has -- what is on hand, what comes in a day -- stays in the
   * open; the four fields that only mean something under the Oath or the
   * upkeep are grouped, and go dead when neither switch is on, so a character
   * with neither cannot half-fill a ledger they will never pay from.
   *
   * The two switches say what they cost on hover rather than in the row. A
   * formula printed beside a checkbox reads as its label, and neither of these
   * is a label: they are the rules the Owed figure above is already showing
   * the answer to.
   */
  #wealthPanel() {
    const v = this.#model.wealthView();
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    const draft = { amount: this.#draft.wealthAmount ?? '', label: this.#draft.wealthLabel ?? '', kind: this.#draft.wealthKind || 'session' };
    const ledger = [...v.ledger].map((l, i) => ({ ...l, i })).reverse();
    const kindLabel = { session: 'session', reward: 'reward', spend: 'spend', offering: 'offering', adjust: 'adjustment' };
    // Dead rather than gone: the numbers stay readable, and the moment either
    // switch goes on they are fields again with whatever was in them.
    const off = v.due ? '' : ' disabled';
    const oathRule = 'Half the mana a day for every day since the last offering, plus half the mana earned in sessions since it.';
    const castingRule = `${MATERIAL_CASTING_PER_LEVEL} a caster level every whole month — ${n(v.castingPerMonth)} a month at caster level ${v.casterLevel}.`;
    return `<section class="panel span2 wealth">
      <h3>Wealth
        <span class="badge">${esc(v.currency)}</span>
        ${v.due ? `<span class="badge ${v.expected.total > 0 ? 'err' : ''}" title="What the next offering comes to today">owed ${n(v.expected.total)}</span>` : ''}
      </h3>
      <div class="wealthgrid">
        <div class="wealthnums">
          <div class="bigstat"><div class="k">On hand</div><div class="v">${n(v.current)}</div><div class="sub">${esc(v.currency)}</div></div>
          ${v.due ? `<div class="bigstat"><div class="k">Owed</div><div class="v">${n(v.expected.total)}</div>
            <div class="sub">${[
    v.oathOfOfferings ? `oath ${n(v.expected.oath)}` : '',
    v.materialCasting ? `casting ${n(v.expected.casting)}` : '',
  ].filter(Boolean).join(' · ')}</div></div>
          <div class="bigstat"><div class="k">After offering</div><div class="v ${v.after < 0 ? 'neg' : ''}">${n(v.after)}</div>
            <div class="sub">${v.lastOffering ? `${v.days} day${v.days === 1 ? '' : 's'} since ${esc(v.lastOffering)}` : 'no offering recorded'}</div></div>` : ''}
        </div>
        <div class="wealthfieldcol">
          <div class="fieldgrid wealthfields">
            ${this.#field('Current mana', this.#num('wealth.current', v.current))}
            ${this.#field('Mana / day', this.#num('wealth.manaPerDay', v.manaPerDay))}
            <label class="fld"><span>Oath of Offerings</span>${this.#check('wealth.oathOfOfferings', v.oathOfOfferings, '', oathRule)}</label>
            <label class="fld"><span>Material Casting</span>${this.#check('wealth.materialCasting', v.materialCasting, '', castingRule)}</label>
          </div>
          <div class="offeringfields${v.due ? '' : ' dormant'}"${v.due ? ''
    : ' title="Only the Oath of Offerings and material casting are paid this way — tick one to fill these in."'}>
            <div class="fieldgrid wealthfields">
              ${this.#field('Baseline after last offering', `<input type="number" value="${v.baseline === null ? '' : v.baseline}" data-set="wealth.baseline" data-kind="number-or-null" placeholder="—" title="The balance recorded after the last offering"${off}>`)}
              ${this.#field('OoO / day', this.#roField(n(v.offeringPerDay), 'Mana/Day ÷ 2'))}
              ${this.#field('Last offering', `<input type="date" value="${esc(v.lastOffering)}" data-set="wealth.lastOffering" data-kind="text"${off}>`)}
              ${this.#field('Session mana since', this.#num('wealth.sessionMana', v.sessionMana, `min="0" title="Mana earned in sessions since the last offering; the oath takes half"${off}`))}
            </div>
          </div>
        </div>
      </div>
      <div class="wealthactions">
        <span class="pair">
          <select data-draft="wealthKind" aria-label="Kind">
            ${['session', 'reward', 'spend', 'adjust'].map((k) => `<option value="${k}" ${draft.kind === k ? 'selected' : ''}>${kindLabel[k]}</option>`).join('')}
          </select>
          <input type="number" data-draft="wealthAmount" value="${esc(draft.amount)}" placeholder="amount" style="width:6.5rem" aria-label="Amount">
          <input type="text" data-draft="wealthLabel" value="${esc(draft.label)}" placeholder="label (e.g. Session 12 reward)" style="width:15rem" aria-label="Label">
          <button class="primary" data-action="wealth-record" title="Write it to the ledger and move the wallet">Record</button>
        </span>
        <span class="pair" style="margin-left:auto">
          <button data-action="wealth-offering" ${v.due && v.expected.total > 0 ? '' : 'disabled'}
            title="Pay ${n(v.expected.total)}: the balance after it becomes the new baseline, today the last offering, session mana back to 0">Make offering (${n(v.expected.total)})</button>
        </span>
      </div>
      <p class="hint">
        A <em>session</em> line is session income: it goes on the wallet and, under the oath,
        half of it is owed at the next offering; a <em>spend</em> is taken off the wallet. Formulas can read <code>mana.current</code>,
        <code>mana.expected</code> and <code>mana.after</code>.
      </p>
      ${ledger.length ? `<div class="tablewrap"><table class="ledger">
        <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${ledger.slice(0, 12).map((l) => `<tr>
          <td>${esc(l.date)}</td>
          <td>${esc(l.label)} <span class="badge">${kindLabel[l.kind] || l.kind}</span></td>
          <td class="num ${l.amount < 0 ? 'neg' : 'pos'}">${l.amount > 0 ? '+' : ''}${n(l.amount)}</td>
          <td class="tools"><button class="danger" data-action="wealth-remove" data-index="${l.i}" title="Remove this line and undo it" aria-label="Remove">×</button></td>
        </tr>`).join('')}</tbody>
      </table>${ledger.length > 12 ? `<p class="hint">${ledger.length - 12} older line${ledger.length - 12 === 1 ? '' : 's'} kept.</p>` : ''}</div>` : ''}
    </section>`;
  }

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

  /* ---------------- audit ---------------- */

  /* ---------------- formulas ---------------- */

  /**
   * The Formulas tab: a scratchpad, an index of everything this character can
   * read, every formula already written on it, and the reference underneath.
   *
   * Built in formula-guide.js from plain data, so the whole thing is a pure
   * function of the character plus three pieces of view state -- which is what
   * lets the search box and the try-it box refresh their own sections in
   * place, without a re-render taking the caret with it.
   */
  #formulaPanel() {
    const audit = this.#model.audit();
    return formulaPanelHtml({
      names: this.#model.scopeNames(),
      scope: this.#model.scope(),
      inlineNames: this.#model.inlineNames || {},
      audit,
      problems: this.#model.formulaProblems(audit),
      draft: this.#formulaDraft,
      query: this.#formulaQuery,
      refOpen: this.#formulaRefOpen,
    });
  }

  /**
   * How much on this character needs attention, for the ƒx button.
   *
   * The same count the tab's own "Needs attention" panel shows, from the same
   * call -- one cycle is one problem in both places. Two numbers for the same
   * thing would just send a player looking for a fault that is not there.
   */
  #brokenFormulas() {
    return this.#model.formulaProblems().length;
  }

  /**
   * The way into the formula system from wherever you happen to be.
   *
   * It sits in the header rather than only on the tab bar because the moment
   * a player wants it is the moment they are part-way through typing
   * something on another tab -- and because a broken formula has to be
   * findable from anywhere, which is what the count is for.
   */
  #formulaButton() {
    const broken = this.#brokenFormulas();
    return `<button data-action="formulas" aria-pressed="${this.#tab === 'formulas'}"
      class="${broken ? 'danger' : ''}"
      title="${broken
    ? `Formulas — ${broken} on this character ${broken === 1 ? 'is' : 'are'} not working`
    : 'Formulas: what you can read, what you have written, and how to write more'}"
      >&fnof;x${broken ? ` (${broken})` : ''}</button>`;
  }

  #auditPanel() {
    const rows = this.#model.audit();
    const bad = rows.filter((r) => r.status === 'error').length;
    return `<div class="grid"><section class="panel span2">
      <h3>Formula audit
        <span class="badge ${bad ? 'err' : 'ok'}">${rows.length} formula(s), ${bad} problem(s)</span>
      </h3>
      <p class="hint" style="margin-bottom:10px">
        Every formula a player has entered on this character, exactly as written.
        Formulas are parsed, never executed as code, and can only read the values listed
        under “reads”. Nothing here can reach the page, the network, or other characters.
      </p>
      ${rows.length ? rows.map((r) => `
        <div class="audit-row ${r.status === 'error' ? 'error' : ''}">
          <div>
            <strong>${esc(r.name)}</strong>
            <span class="badge ${r.status === 'error' ? 'err' : 'ok'}">${r.status}</span>
            <span class="badge ${r.source === 'player' ? 'player' : ''}">${esc(r.source)}</span>
          </div>
          <div class="audit-formula" title="${esc(workingLine(r.formula, this.#tokenScope(r.locals)))}"
            >${highlightFlagging(r.formula, r.unknownReferences)}</div>
          <div class="hint">
            reads: ${r.reads.length ? r.reads.map((v) => `<span class="tag">${esc(v)}</span>`).join('') : '<em>nothing</em>'}
            ${r.functions.length ? ` &middot; functions: ${r.functions.map((f) => `<span class="tag">${esc(f)}()</span>`).join('')}` : ''}
          </div>
          <div class="hint">evaluates to: <strong>${r.error ? '—' : esc(r.value)}</strong>
            ${r.error ? `<span style="color:var(--cs-bad)"> ${esc(r.error)}</span>` : ''}</div>
        </div>`).join('')
        : '<p class="empty">No player-authored formulas on this character.</p>'}
    </section></div>`;
  }

  /* ---------------- small helpers ---------------- */

  /* ---------------- field helpers ----------------
   * Every control carries the model path it writes to, so the bind step is
   * one generic listener per input kind rather than per field.
   */

  #text(path, value, placeholder = '') {
    return `<input type="text" value="${esc(value ?? '')}" data-set="${path}"
      data-kind="text" placeholder="${esc(placeholder)}">`;
  }

  #num(path, value, extra = '') {
    return `<input type="number" value="${Number(value) || 0}" data-set="${path}"
      data-kind="number" ${extra}>`;
  }

  /** A value that is read, not typed: same box as a field, but shown as derived. */
  #roField(value, title = '', extra = '') {
    return `<input type="text" class="ro" value="${esc(value ?? '')}" readonly tabindex="-1"
      ${title ? `title="${esc(title)}"` : ''} ${extra}>`;
  }

  #area(path, value, rows = 3) {
    return `<textarea data-set="${path}" data-kind="text" rows="${rows}">${esc(value ?? '')}</textarea>`;
  }

  /** `title` is for a rule the switch obeys but should not be labelled with. */
  #check(path, value, label = '', title = '') {
    return `<label class="chk"${title ? ` title="${esc(title)}"` : ''}><input type="checkbox" ${value ? 'checked' : ''}
      data-set="${path}" data-kind="bool">${label ? `<span>${esc(label)}</span>` : ''}</label>`;
  }

  /** `blank: null` for a choice that must be made -- no empty option at all. */
  #select(path, value, options, blank = '—') {
    const pairs = options.map((o) => (Array.isArray(o) ? o : [o, o]));
    // Keep a value the option list doesn't know (e.g. a magic sphere recorded
    // in a combat column) instead of silently blanking it.
    if (value && !pairs.some(([v]) => String(v) === String(value))) {
      pairs.push([value, `${value} *`]);
    }
    const opts = (blank === null ? pairs : [['', blank], ...pairs])
      .map(([v, label]) => `<option value="${esc(v)}"${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
    return `<select data-set="${path}" data-kind="text">${opts}</select>`;
  }

  /** Ability-stat picker, used by the AC / attack / save stat slots. */
  #abilitySelect(path, value) {
    return this.#select(path, value, ABILITIES.map((k) => [ABILITY_LABELS[k], ABILITY_LABELS[k]]));
  }

  /* ----- list rows ----- */

  #itemText(list, i, field, value, placeholder = '') {
    return `<input type="text" value="${esc(value ?? '')}" data-item="${list}|${i}|${field}"
      data-kind="text" placeholder="${esc(placeholder)}">`;
  }

  #itemNum(list, i, field, value) {
    return `<input type="number" value="${Number(value) || 0}" data-item="${list}|${i}|${field}" data-kind="number">`;
  }

  #itemCheck(list, i, field, value) {
    return `<input type="checkbox" ${value ? 'checked' : ''} data-item="${list}|${i}|${field}" data-kind="bool">`;
  }

  /**
   * A field whose value may be written as a formula (`level * 100`, `int.mod`,
   * a name defined in prose) rather than typed as a number.
   *
   * Same two-layer trick as the prose fields, for the same reason: a cell full
   * of source with the answer parked beside it reads as neither. The resolved
   * value is what sits in the cell, the raw source appears in place the moment
   * the field is clicked or tabbed into, and both layers carry the one binding
   * so this is still a plain data-item/data-set control.
   *
   * `value` is the resolved result; pass null to keep the raw text showing (a
   * literal `1d8`, an unresolvable formula).
   */
  #exprField(bindingAttr, raw, {
    kind = 'expr', width = '5rem', placeholder = '', title = '', value = null, error = null,
  } = {}) {
    const src = raw ?? '';
    const isFormula = typeof src === 'string' && src.trim() !== '';
    const view = isFormula && !error && value !== null && value !== undefined && value !== '';
    const explain = `${src} = ${value}`;
    return `<span class="xf${view ? ' has-value' : ''}${error ? ' invalid' : ''}" style="--xf-w:${width}">
      <input type="text" class="xf-src${isFormula ? ' mono' : ''}" value="${esc(src)}"
        ${bindingAttr} data-kind="${kind}" placeholder="${esc(placeholder)}"
        title="${esc(error || (view ? explain : title) || EXPR_HINT)}">
      ${view ? `<span class="xf-view" title="${esc(explain)} — click to edit">${esc(value)}</span>` : ''}
    </span>`;
  }

  /**
   * A number a player may write as a formula instead (`level * 100`).
   *
   * The model resolves it in the same sandbox as the trackers and writes the
   * result into `<field>Num`, so the cell can show what it currently means and
   * a bad formula is flagged here as well as in the Formula Audit.
   */
  #itemExpr(list, i, field, obj, { width = '5rem', placeholder = '' } = {}) {
    return this.#exprField(`data-item="${list}|${i}|${field}"`, obj[field], {
      width,
      placeholder,
      value: obj[`${field}Num`],
      error: obj[`${field}Error`],
      title: 'A number, or a formula like level * 100',
    });
  }

  /** Options are `value`, `[value, label]` or `[value, label, tooltip]`. */
  #itemSelect(list, i, field, value, options, blank = '—') {
    const pairs = options.map((o) => (Array.isArray(o) ? o : [o, o]));
    if (value && !pairs.some(([v]) => String(v) === String(value))) {
      pairs.push([value, `${value} *`]);
    }
    const opts = (blank === null ? pairs : [['', blank], ...pairs])
      .map(([v, label, hint]) => `<option value="${esc(v)}"${hint ? ` title="${esc(hint)}"` : ''}${
        String(value ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
    return `<select data-item="${list}|${i}|${field}" data-kind="text">${opts}</select>`;
  }

  #rowTools(list, i) {
    return `<td class="tools">
      <button data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
      <button data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>
      <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
    </td>`;
  }

  /** Tools for a list whose rows are summed, so their order means nothing. */
  #rowRemove(list, i) {
    return `<td class="tools">
      <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
    </td>`;
  }

  /**
   * A × that asks twice: the first click arms it (it says so), the second
   * removes. For rows a stray click would genuinely hurt to lose.
   */
  #rowRemoveArmed(list, i, what = 'row') {
    const key = `${list}|${i}`;
    const armed = this.#armedRemove === key;
    return `<td class="tools">
      <button class="danger${armed ? ' armed' : ''}" data-remove-armed="${key}"
        title="${esc(armed ? `Click again to remove ${what}` : `Remove ${what} — asks twice`)}"
        aria-label="${esc(`Remove ${what}${armed ? ' — click again to confirm' : ''}`)}">${armed ? 'sure?' : '×'}</button>
    </td>`;
  }

  /** Prose rendered to plain text -- for a title, where markup cannot go. */
  #proseText(text) {
    if (!hasTokens(text)) return String(text ?? '');
    return this.#model.renderProse(text).map((seg) => (seg.kind === 'text' ? seg.text
      : seg.error ? `{${seg.error}}` : formatValue(seg.value))).join('');
  }

  #addButton(list, label, template) {
    return `<button class="primary" data-add="${list}" data-template="${esc(JSON.stringify(template))}">+ ${esc(label)}</button>`;
  }

  /** `now` is the conditioned reading, shown under the base when it differs. */
  #bigStat(k, v, sub, now = '', roll = '') {
    return `<div class="bigstat${now ? ' has-now' : ''}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="sub">${sub || '&nbsp;'}</div>${now}${roll}</div>`;
  }

  /** A stat for a header strip: one line, sized to read rather than to fill. */
  #miniStat(k, v, title = '') {
    return `<span class="ministat"${title ? ` title="${esc(title)}"` : ''}>
      <span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></span>`;
  }

  #line(label, value, big = false) {
    return `<div class="statline"><span class="label">${esc(label)}</span><span class="value ${big ? 'big' : ''}">${val(value)}</span></div>`;
  }

  /** A stat line whose value is markup of our own making, not a value to escape. */
  #lineHtml(label, html, big = false) {
    return `<div class="statline"><span class="label">${esc(label)}</span><span class="value ${big ? 'big' : ''}">${html}</span></div>`;
  }

  #editLine(label, path, value) {
    return `<div class="statline">
      <span class="label">${esc(label)}</span>
      <span class="value"><input type="number" value="${Number(value) || 0}" data-set="${path}" style="width:4.2rem" aria-label="${esc(label)}"></span>
    </div>`;
  }

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
    const spec = rollSpec(this.#model.data, kind, ref, cs ?? this.#model.conditionState);
    if (!spec) return '';
    const shown = spec.rolls.slice(0, 3).map((r) => r.formula).join(' · ')
      + (spec.rolls.length > 3 ? ' …' : '');
    return `<button class="d20" data-roll="${esc(kind)}|${esc(String(ref))}" data-rollwhat="${esc(what)}"
      title="${esc(`Copy for Roll20 — ${shown}`)}"
      aria-label="${esc(`Copy a Roll20 roll for ${what}`)}">${D20_ICON}</button>`;
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

  /** Redraw the toast alone -- copying a roll must not disturb the sheet. */
  #renderRollToast({ select = false } = {}) {
    const slot = this.shadowRoot.querySelector('.rollslot');
    if (!slot) return;
    slot.innerHTML = this.#rollToastHtml();
    this.#bindRollToast(slot);
    if (select) slot.querySelector('.rolltext')?.select();
    clearTimeout(this.#rollToastTimer);
    // A failed copy is still needed -- it is the only copy of the text there
    // is -- so only a successful one clears itself.
    if (this.#rollToast && !this.#rollToast.failed) {
      this.#rollToastTimer = setTimeout(() => {
        this.#rollToast = null;
        if (this.isConnected) this.#renderRollToast();
      }, 6000);
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
      b.addEventListener('click', () => this.#action(b.dataset.action, b));
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
    const old = root.querySelector('header.head');
    if (!old || !this.#model) { this.#render(); return; }

    if (gentle && old.contains(root.activeElement)) {
      const save = old.querySelector('[data-action="save"]');
      if (save) {
        save.textContent = `Save${this.#changes ? ` (${this.#changes})` : ''}`;
        save.disabled = !this.#changes;
        save.classList.toggle('primary', !!this.#changes);
      }
      return;
    }

    const holder = document.createElement('div');
    holder.innerHTML = this.#header();
    const fresh = holder.firstElementChild;
    old.replaceWith(fresh);
    this.#bindActions(fresh);
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
      b.addEventListener('click', () => { this.#tab = b.dataset.tab; this.#render(); });
    });
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

    // Generic list-item field -> model path.
    root.querySelectorAll('[data-item]').forEach((input) => {
      input.addEventListener('change', () => {
        const [list, index, field] = input.dataset.item.split('|');
        this.#model.setItem(list, Number(index), field, readControl(input));
        if (AFFECTS_DERIVED.test(list)) this.#rerender(input);
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

    this.#bindTemplateDrag(root);
    this.#bindLanguageDrag(root);

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

    root.querySelectorAll('[data-collapse]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.collapse;
        const collapsed = this.#model.data.uiPrefs.collapsed;
        collapsed[key] = !collapsed[key];
        this.#model.recompute();
        this.#render();
      });
    });

    // Readying a maneuver adds or removes its name on the discipline. The row
    // itself belongs to the shared catalogue, so only the name is stored.
    root.querySelectorAll('[data-ready]').forEach((box) => {
      box.addEventListener('change', () => {
        const [path, name] = box.dataset.ready.split('|');
        this.#model.toggleManeuver(path, name, box.checked);
        this.#rerender(box);
      });
    });

    // The ✎ on a readied maneuver: its overview note. The button sits inside
    // the row's label, so its click must not also toggle the readied box.
    root.querySelectorAll('[data-mnote-toggle]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        const key = b.dataset.mnoteToggle;
        this.#openManeuverNote = this.#openManeuverNote === key ? null : key;
        this.#render();
      });
    });
    root.querySelectorAll('[data-mnote]').forEach((input) => {
      input.addEventListener('change', () => {
        const [path, name] = input.dataset.mnote.split('|');
        this.#model.setManeuverNote(path, name, input.value);
        this.#render();
      });
    });

    // Right-click a maneuver for its rules text. The row is a label whose
    // left-click readies the maneuver, so the wiki gets the button that was
    // otherwise unused; the native menu is given up only on these rows.
    root.querySelectorAll('.mrow[data-wiki]').forEach((row) => {
      row.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        window.open(row.dataset.wiki, '_blank', 'noopener,noreferrer');
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
      const valueSection = root.querySelector('[data-fx-section="values"]');
      if (formulaSection) {
        formulaSection.outerHTML = myFormulasHtml(this.#model.audit(), q);
      }
      if (valueSection) {
        valueSection.outerHTML = browserHtml(
          valueGroups(names, scope(), this.#model.inlineNames || {}, q), names.length, q,
        );
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
      case 'theme':
        this.setAttribute('theme', this.getAttribute('theme') === 'light' ? 'dark' : 'light');
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
          this.#history?.writeWorking(this.#model.toJSON());
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
