/**
 * ui/view-state.js -- how the sheet is being looked at, as one object.
 *
 * Every panel is drawn from two things: the model, which is the character,
 * and the view, which is where the reader is -- which buff is open, which ×
 * has been armed, what the Formulas search box says. None of it is saved with
 * the character; it lasts as long as the element does.
 *
 * It is one object, made here, for two reasons. Every panel is handed the
 * whole of it, so a control that needs a piece of state another tab already
 * had cannot find it missing: the Overview's hit-point ✎ Style opened an
 * editor its tab was never told about, because each tab got its own
 * hand-picked slice and that one was picked without the editor's fields. And
 * tests/panels.test.mjs draws from this same blank view, rather than a copy of
 * the slices that had drifted several fields short of what the element passed.
 *
 * What is NOT here: the element's own bookkeeping (timers, observers, the last
 * press), the tab it is on (`#tab`, remembered per browser), and the folds a
 * player expects to find as they left them, which are saved preferences
 * (`model.data.uiPrefs`).
 */
import { normalizeStyle } from '../tracker-style.js';

/** What the add-a-row forms hold before anything is typed, and again after a row is added. */
export const blankDraft = () => ({ name: '', formula: '', minFormula: '', refresh: '', note: '', fill: 'spent' });

/** The tracker style editor's form with nothing in it. */
export const blankTrackerDraft = () => ({
  name: '', maxFormula: '', minFormula: '', refresh: '', note: '', style: normalizeStyle(null),
});

/** The view a sheet opens on: every fold shut, nothing armed, nothing typed. */
export function blankView() {
  return {
    /* Overview */
    /** Whether the dashboard's grouped condition picker is unfolded. */
    condPickerOpen: false,
    /** Whether the dashboard's card arranger is open. */
    dashArrange: false,
    /** Which buff row has its editor open (index, or null). */
    openBuff: null,
    /** Which Classes row has its sub-system picker open (index, or null). */
    openClassSystems: null,
    /** What is typed into the add-a-row forms (the Overview's, the Gear and Trackers tabs'). */
    draft: blankDraft(),

    /* Skills */
    showAllSkills: false,

    /* Templates: tables showing every stored cell rather than the merges they
       describe. An editing mode rather than a preference, so it is not saved. */
    showCells: new Set(),

    /* Equipment & Crafting */
    showAllGear: false,
    /** Which gear item is open as a card ("equipment.gear|3"), or null. Which
        row somebody is reading is a way of looking at the list, not a fact
        about what they are carrying. */
    openGear: null,
    /** Generated crafting post -> expanded? */
    openPosts: new Map(),

    /* The sub-system tabs */
    /** Which face of the Cardcasting tab is up: the table in play, or the deck. */
    deckView: 'table',
    /** Which maneuver is open ("<list>|<name>", or null). One at a time. */
    openManeuver: null,
    /** Whether the open maneuver is showing its cells rather than reading them. */
    maneuverEdit: false,
    /** Which shaped veil is showing what the player wrote rather than what its pack says. */
    veilEdit: null,
    /** Cards peeked at with Read the Cards, by id, until the next action. */
    peek: [],
    /** The card in hand whose mode-and-points chooser is open (instance id), or null. */
    castPick: null,
    /** Cards opened out to read or edit at length: table instance ids and deck faces ("cardcasting.cards|3"). */
    openCards: new Set(),

    /* Trackers, and the style editor the meters on other tabs open */
    /** Id of the custom tracker being edited in place. */
    editTracker: null,
    /** Key of the built-in meter whose style is open ('hp', 'essence'). */
    editMeter: null,
    editDraft: blankTrackerDraft(),

    /* Reading */
    /** Which long pack texts have been opened out to read. */
    openText: new Set(),
    /** Which folded table cell is open ("mythic:3:effect", or null). One at a time. */
    openCell: null,

    /** The armed two-click × ("<list>|<index>", or another key), or null: the
        first click arms it, the second removes. */
    armedRemove: null,

    /* Formulas & audit: what is in the try-it box, what the search boxes are
       narrowing to, and whether the reference underneath has been unfolded. */
    formulaDraft: '',
    formulaQuery: '',
    formulaValueQuery: '',
    formulaTargetQuery: '',
    formulaRefOpen: false,

    /* ⚙ manager */
    /** Which kind of extension block the list is narrowed to ('' = all). */
    extFilter: '',
    /** What is typed into the block shelf's search box. */
    extSearch: '',
  };
}
