/**
 * The sub-systems, one row each, for the steps every one of them takes the
 * same way:
 *
 *   key      where its block lives in the document
 *   tab      the tab it is drawn on, for the ⚙ manager and the session bar
 *   derived  what recompute writes back into the block, left out of a save
 *   list     the block is a list of blocks (the companions), each stripped
 *   inUse    whether the character uses it: something typed in, not just a
 *            block the document carries
 *   newDay   what a new day gives back: what was spent, never what was typed
 *
 * Saving (toDocument), systemTabsInUse and rest() read this table, so one
 * sub-system's lifecycle is one row here rather than a line in each of them.
 * Reading one in from a workbook stays in normalise: every worksheet has its
 * own shape and is read under its own conditions.
 *
 * Built on first use rather than when the module loads, because the DERIVED
 * lists come from modules that import the document helpers this table is
 * itself imported by.
 */

import { COMPANION_KINDS, companionsInUse } from '../../companions.js';
import { trainingSideInUse } from '../edit.js';
import { restCompanion } from '../rest.js';
import { AKASHIC_DERIVED } from './akashic.js';
import { ALT_TRAINING_DERIVED } from './alt-training.js';
import { CARDCASTING_DERIVED } from './cardcasting.js';
import { COMPANION_DERIVED } from './companions.js';
import { COOKING_COURSES } from './cooking.js';
import { MANEUVER_DERIVED } from './maneuvers.js';
import { PSIONIC_DERIVED } from './psionics.js';
import { VANCIAN_DERIVED } from './vancian.js';

/** Text with something in it. */
const filled = (v) => String(v ?? '').trim() !== '';

/**
 * Whether anyone has actually woven with this character's akashic block.
 *
 * The receptacles arrive pre-printed from the workbook and an untouched one is
 * `{ slot: 'Storm', bound: false, twinveil: false, veils: [] }`, so their
 * *existence* says nothing. Anything a player could have put there does:
 * a veil in a receptacle, a chakra bound, a twin veil, a veilweaving class
 * named, essence allocated, or a receptacle of their own.
 */
function akashicInUse(a) {
  if (!a || typeof a !== 'object') return false;
  const named = (list) => (list || []).some((x) => String(x?.name || '').trim());
  const holding = (r) => (r?.veils || []).length > 0 || !!r?.bound || !!r?.twinveil;
  return named(a.classes)
    || [...(a.slots || []), ...(a.kheshig || [])].some(holding)
    || (a.otherReceptacles || []).some((r) => String(r?.name || '').trim() || Number(r?.essence) > 0)
    || Object.values(a.essence || {}).some((v) => Number(v) > 0);
}

let ROWS = null;

/** The rows, in the order the ⚙ manager lists the tabs. */
export function subsystems() {
  if (ROWS) return ROWS;
  ROWS = [
    { tab: 'martial', inUse: (model) => trainingSideInUse(model, 'combat') },
    { tab: 'magic', inUse: (model) => trainingSideInUse(model, 'magic') },
    { tab: 'guile', inUse: (model) => trainingSideInUse(model, 'guile') },
    {
      tab: 'crafting',
      inUse: ({ data: { crafting: cr } }) => !!cr && ((cr.projects || []).some((p) => String(p.name || '').trim() || Number(p.value))
        || (cr.speedIncreases || []).length > 0 || (cr.costReductions || []).length > 0),
    },
    {
      key: 'akashic',
      tab: 'akashic',
      derived: AKASHIC_DERIVED,
      // Not `slots.length`: the workbook's Akashic tab prints the chakra rows
      // ("Storm Veil", "Feet Veil", …) whether or not anyone weaves, so the
      // importer finds fifteen receptacles on a character who has never shaped
      // a veil. It asks whether anything is *in* them instead -- which is what
      // the manager's `in use` badge has always claimed to mean.
      inUse: ({ data }) => akashicInUse(data.akashic),
      // Temporary essence bought with spell points lasts the day.
      newDay: ({ data }) => { if (data.akashic?.essence) data.akashic.essence.spTemp = 0; },
    },
    {
      key: 'maneuvers',
      tab: 'maneuvers',
      derived: MANEUVER_DERIVED,
      // A row with something in it, as Martial and Magic ask for a class's
      // name: an empty one left by "Add" is not a system in use.
      inUse: ({ data }) => (data.maneuvers?.disciplines || []).some((x) => filled(x?.name) || (x?.entries || []).length),
    },
    {
      key: 'vancian',
      tab: 'vancian',
      derived: VANCIAN_DERIVED,
      inUse: ({ data }) => (data.vancian?.classes || []).some((c) => filled(c?.name) || filled(c?.slotType)),
      newDay: ({ data }) => {
        for (const c of data.vancian?.classes || []) for (const s of c.spells || []) s.used = 0;
        for (const p of data.vancian?.prepared || []) p.used = 0;
      },
    },
    {
      key: 'psionics',
      tab: 'psionics',
      derived: PSIONIC_DERIVED,
      inUse: ({ data }) => (data.psionics?.classes || []).some((c) => filled(c?.name) || (c?.powers || []).length),
      newDay: ({ data }) => { if (data.psionics) data.psionics.spent = 0; },
    },
    { key: 'altTraining', derived: ALT_TRAINING_DERIVED },
    {
      key: 'cardcasting',
      tab: 'cardcasting',
      derived: CARDCASTING_DERIVED,
      // A deck, or the Card Casting drawback on the tradition, is enough.
      inUse: ({ data }) => !!(data.cardcasting?.cards || []).length || !!data.cardcasting?.enabled,
      // Lifebound Deck: "When you rest to regain spell points, remove all
      // cards from your Stun, Death, and Wounds piles." They are in the deck
      // again at the next shuffle.
      newDay: ({ data }) => {
        const table = data.cardcasting?.table;
        if (table) for (const pile of ['stun', 'wounds', 'death']) table[pile] = [];
      },
    },
    { tab: 'techniques', inUse: ({ data }) => !!(data.techniques?.catalogue || []).length },
    { tab: 'autoTechnique', inUse: ({ data }) => !!data.techniques?.draft?.name },
    { tab: 'cooking', inUse: ({ data }) => COOKING_COURSES.some(([k]) => (data.cooking?.[k] || []).some(Boolean)) },
    { tab: 'template', inUse: ({ data }) => !!(data.templates || []).length },
    ...COMPANION_KINDS.map((kind) => ({
      key: kind,
      tab: kind,
      list: true,
      derived: COMPANION_DERIVED,
      inUse: ({ data }) => companionsInUse(kind, data[kind]),
      // Its hit points; its spell-point pool comes back by its own tracker's
      // Refresh, like every other tracker.
      newDay: (model) => {
        for (const b of model.data[kind] || []) if (b && typeof b === 'object') restCompanion(model, b, { pool: false });
      },
    })),
  ];
  return ROWS;
}
