/**
 * Akashic Mysteries: veils, essence, and the DCs they set.
 *
 * Essence is a pool invested slot by slot, and a veil's DC and effects follow
 * how much is in it, so the veils recompute whenever the investment moves.
 */

import {
  ESSENCE_SOURCES, KHESHIG_VEILS, essenceInvested, tempEssence, tempEssenceCost, veilDC,
} from '../../rules.js';
import { sheetReader } from '../document.js';
import { sphereTalentKnowledge } from '../spheres.js';
import { slug } from '../util.js';

export const AKASHIC_DERIVED = [
  'calc',
  { path: 'classes', keys: ['totalCap'] },
  { path: 'slots', list: 'veils', keys: ['dc'] },
  { path: 'kheshig', list: 'veils', keys: ['dc'] },
];

/**
 * The Veilweaving sphere's (tradition) talents, and the class list each opens.
 *
 * A sphere veilweaver reaches veils two ways. Without a tradition they know a
 * handful they picked one at a time; with one, they know a whole class's list
 * -- *"You gain knowledge of every veil on the daevic veil list"* -- without
 * having a level in that class. Three of them are printed, one per class.
 *
 * Keyed on the class rather than the talent so the catalogue's own `classes`
 * field is what answers: the narrowing that already works for someone with
 * levels in a class is the same narrowing, from a different source.
 */
export const VEIL_TRADITIONS = [
  ['daevic', 'Daevic'],
  ['guru', 'Guru'],
  ['vizier', 'Vizier'],
];

/**
 * Which of those a character has taken.
 *
 * The talent cell is the player's own text -- "Daevic's Tradition", and often
 * with what it was taken for in brackets after it -- so this asks whether the
 * printed name is in there rather than whether the cell equals it. Both
 * apostrophes, because a sheet typed on a phone gets the curly one and a sheet
 * typed on a keyboard gets the straight one, and neither is wrong.
 */
export function veilTraditionClasses(model) {
  const known = sphereTalentKnowledge(model, model.data.training?.magic, 'magic');
  let names = [];
  for (const [sphere, row] of known) {
    if (String(sphere).trim().toLowerCase() === 'veilweaving') names = names.concat(row.names || []);
  }
  const said = names.join(' | ').toLowerCase().replace(/\u2019/g, "'");
  return VEIL_TRADITIONS.filter(([key]) => said.includes(`${key}'s tradition`)).map(([, label]) => label);
}

/**
 * Split a veil's cell into its name and what it does.
 *
 * The workbook had one cell per veil, so players wrote the effect into it in
 * brackets -- "Citadel Banner (20-foot radius, +4 Atk/AC)". The bracketed part
 * is a description, and belongs in a field that can hold a paragraph and
 * resolve `{…}` formulas, rather than in the name. Inner brackets are part of
 * the description: only the outermost pair is the split.
 */
export function splitVeilName(raw) {
  const text = String(raw ?? '').trim();
  const open = text.indexOf('(');
  if (open <= 0) return { name: text, desc: '' };
  const name = text.slice(0, open).trim();
  let desc = text.slice(open + 1).trim();
  if (desc.endsWith(')')) desc = desc.slice(0, -1).trim();
  return { name, desc };
}

/**
 * Read the workbook's Akashic tab into the veil board this tab now edits.
 *
 * Every shaped veil's save DC on the sheet was exactly the veilweaver's base
 * DC plus the essence invested in it, checked across every character, so only
 * the essence is kept and the DC is recomputed. That is roughly forty cells a
 * sheet that no longer have to round-trip.
 *
 * Slots are found by their "<name> Veil" header rather than by address: the
 * template lays them out down two columns at a one-row offset, a sheet may
 * carry an extra slot, and the same scan reads either.
 */
export function importAkashic(tab) {
  const g = sheetReader(tab);
  const { at, text, num, mark, rightOf } = g;

  // ---- veilweaving classes ----
  // Class 1 carries the shared numbers (level, essence cap, the DCs); the
  // other five blocks are a mod and a bonus cap each.
  const classes = [];
  for (const [ri, ci, m] of g.scan(/^Veilweaving Class(?: (\d+))?$/)) {
    const index = Number(m[1] || 1);
    const stop = ri + 8;
    const block = { index, name: text(rightOf(ri, ci)) };
    for (let r = ri + 1; r < Math.min(stop, g.rows.length); r++) {
      const label = text(at(r, ci));
      if (/^Veilweaving Class/.test(label)) break;
      // How far past its label a value may sit. The short labels put it in the
      // next cell and nowhere else -- an empty class block would otherwise
      // reach across and read the neighbouring "Essence" column heading as its
      // ability. The two DC labels are merged across two columns, so theirs is
      // genuinely further out.
      const KEYS = {
        Mod: ['mod', 1],
        'Essence Cap': ['essenceCap', 1],
        'Bonus Cap': ['bonusCap', 1],
        'Total Cap': ['totalCap', 1],
        'Veilweaving Base DC': ['baseDC', 3],
        'Steady Veil DC': ['steadyVeilDC', 3],
      };
      if (KEYS[label]) {
        const [key, span] = KEYS[label];
        block[key] = rightOf(r, ci, span);
      }
      // "Veilweaving Level" sits in the second column of the same block.
      const right = text(at(r, ci + 2));
      if (right === 'Veilweaving Level') block.level = rightOf(r, ci + 2, 2);
      else if (right === 'Essence') mark(r, ci + 2);
    }
    classes.push({
      index,
      name: text(block.name),
      mod: text(block.mod) || null,
      level: num(block.level),
      essenceCap: num(block.essenceCap),
      bonusCap: num(block.bonusCap),
      baseDC: num(block.baseDC),
      steadyVeilDC: num(block.steadyVeilDC),
    });
  }
  // Total Cap is essence cap + bonus cap, so it is dropped rather than stored.
  const primary = classes.find((c) => c.baseDC) || classes[0] || null;

  // ---- the essence pool ----
  const essence = {};
  for (const [key, label] of ESSENCE_SOURCES) essence[key] = num(g.take(label));
  const usedTotal = text(g.take('Used/Total'));
  const split = /^(\d+)\s*\/\s*(\d+)$/.exec(usedTotal);
  // Used is the sum of what the veils hold, so only the pool size is kept.
  essence.pool = split ? Number(split[2]) : 0;

  /**
   * One slot block: a header row naming the slot, the veil under it, a
   * Bound toggle, and -- when Twinveil is ticked -- a second veil below that.
   * The Kheshig receptacles use the same shape but name a slot instead of
   * being one, and have no second veil.
   */
  const readBlock = (ri, ci, { twin }) => {
    const veils = [];
    const readVeil = (r) => {
      const name = text(at(r, ci));
      const ess = at(r, ci + 3);
      mark(r, ci);
      mark(r, ci + 3);
      mark(r, ci + 4);            // the DC cell, recomputed from base + essence
      // An empty slot still has its essence cell sitting at zero; a veil needs
      // a name or some essence in it to be a veil.
      if (name === '' && num(ess) === 0) return;
      veils.push({ ...splitVeilName(name), essence: num(ess) });
    };
    readVeil(ri + 1);
    // The row below the veil carries the Bound toggle and the two column
    // headings the block repeats.
    if (text(at(ri + 2, ci)) === 'Bound') {
      mark(ri + 2, ci);
      mark(ri + 2, ci + 1);
    }
    if (text(at(ri + 2, ci + 3)) === 'Essence') mark(ri + 2, ci + 3);
    if (text(at(ri + 2, ci + 4)) === 'DC') mark(ri + 2, ci + 4);
    const bound = at(ri + 2, ci + 1) === true;
    let twinveil = false;
    if (twin) {
      if (text(at(ri, ci + 3)) === 'Twinveil') {
        mark(ri, ci + 3);
        mark(ri, ci + 4);
        twinveil = at(ri, ci + 4) === true;
      }
      readVeil(ri + 3);
    }
    return { bound, twinveil, veils };
  };

  // ---- veil slots ----
  const slots = [];
  for (const [ri, ci, m] of g.scan(/^(.+) Veil$/)) {
    if (KHESHIG_VEILS.includes(m[0].trim())) continue;
    mark(ri, ci);
    slots.push({ slot: m[1].trim(), ...readBlock(ri, ci, { twin: true }) });
  }

  // ---- the two Kheshig receptacles ----
  const kheshig = [];
  for (const label of KHESHIG_VEILS) {
    const hit = g.find(label);
    if (!hit) continue;
    const [ri, ci] = hit;
    mark(ri, ci);
    let slot = '';
    if (text(at(ri, ci + 3)) === 'Slot') {
      mark(ri, ci + 3);
      slot = text(at(ri, ci + 4));
      mark(ri, ci + 4);
    }
    const block = readBlock(ri, ci, { twin: false });
    kheshig.push({ label, slot, bound: block.bound, veils: block.veils });
  }

  // ---- other receptacles ----
  // Anything holding essence that is not one of the slots. The essence column
  // is found from its own heading rather than assumed to be the next one
  // along: a sheet that added an active/bound tick between the name and the
  // essence would otherwise have the tick counted as one point of essence.
  const otherAt = g.find('Other Receptacles');
  const otherReceptacles = [];
  if (otherAt) {
    const [ri, ci] = otherAt;
    mark(ri, ci);
    let essCol = ci + 1;
    for (let n = 1; n <= 3; n++) {
      if (text(at(ri, ci + n)) === 'Essence') { essCol = ci + n; mark(ri, ci + n); break; }
    }
    for (let r = ri + 1; r < g.rows.length; r++) {
      const name = text(at(r, ci));
      if (name === '') continue;
      for (let c = ci; c <= essCol; c++) mark(r, c);
      // A boolean between the name and the essence is the receptacle's own
      // on/off tick, not a quantity.
      const flag = essCol > ci + 1 ? at(r, ci + 1) : null;
      const row = { name, essence: num(at(r, essCol)) };
      if (typeof flag === 'boolean') row.active = flag;
      otherReceptacles.push(row);
    }
  }

  if (text(g.find('Essence') ? at(...g.find('Essence')) : '') === 'Essence') mark(...g.find('Essence'));

  return {
    classes,
    baseDC: primary ? primary.baseDC : 0,
    steadyVeilDC: primary ? primary.steadyVeilDC : 0,
    essence,
    slots,
    kheshig,
    otherReceptacles,
    sourceExtras: g.extras(),
  };
}

/**
 * Veil DCs, the essence bill, and the caps that bound it.
 *
 * The workbook stored every veil's DC beside its essence; both come back
 * from base DC + essence, so only the essence round-trips and this puts the
 * DC back. Essence spent is the sum across every shaped veil, which is what
 * the sheet's "Used/Total" showed.
 */
export function recomputeAkashic(model) {
  const a = model.data.akashic;
  if (!a) return;

  const base = Number(a.baseDC) || 0;
  const cap = (a.classes || []).reduce(
    (m, c) => Math.max(m, (Number(c.essenceCap) || 0) + (Number(c.bonusCap) || 0)), 0,
  );
  for (const c of a.classes || []) {
    c.totalCap = (Number(c.essenceCap) || 0) + (Number(c.bonusCap) || 0);
  }

  const over = [];
  for (const holder of [...(a.slots || []), ...(a.kheshig || [])]) {
    for (const v of holder.veils || []) {
      v.dc = veilDC(base, v.essence);
      if (cap > 0 && (Number(v.essence) || 0) > cap) {
        over.push(v.name || holder.slot || holder.label);
      }
    }
  }

  const pool = Number(a.essence?.pool) || 0;
  // The sheet's "Essence Boon" is the casting tradition's own pool taken as
  // essence rather than as spell points -- the same number, written twice.
  // Now that the Spheres tab works it out, it is computed here instead of
  // typed, and the typed figure stands in only for a character whose
  // tradition grants nothing (a homebrew source the tradition never saw).
  const traditionBoon = Number(model.data.training?.magic?.traditionEssence) || 0;
  const sources = ESSENCE_SOURCES.reduce(
    (t, [key]) => t + (key === 'boon' && traditionBoon ? traditionBoon : Number(a.essence?.[key]) || 0),
    0,
  );
  const used = essenceInvested([...(a.slots || []), ...(a.kheshig || [])])
    + (a.otherReceptacles || []).reduce((t, r) => t + (Number(r.essence) || 0), 0);

  // The Veilweaving sphere condenses spell points into essence for the day.
  // It rides on top of the daily pool rather than inside it -- the pool is
  // what the veilweaving classes grant -- and the points it costs come off
  // the caster's own total, which #recomputeTraining has already worked out.
  const temp = tempEssence(a);
  const spSpent = tempEssenceCost(a);
  const spPool = Number(model.data.training?.magic?.totalSP) || 0;

  // A (tradition) talent hands over a whole class's veil list, so the veil
  // catalogue narrows by it exactly as it does for someone with levels in
  // that class. Derived, so it lives under `calc` and is never saved.
  const traditions = veilTraditionClasses(model);

  a.calc = {
    base,
    traditions,
    totalCap: cap,
    pool,
    sources,
    traditionBoon,
    // The pool is what the veilweaving classes and their sources come to, and
    // the sheet writes that total itself; where the two disagree the panel
    // says so rather than quietly picking one.
    sourcesShort: sources - pool,
    temp,
    spSpent,
    spPool,
    spShort: Math.max(0, spSpent - spPool),
    total: pool + temp,
    used,
    free: pool + temp - used,
    overCap: over,
    shaped: (a.slots || []).reduce((n, s) => n + (s.veils || []).length, 0)
      + (a.kheshig || []).reduce((n, s) => n + (s.veils || []).length, 0),
  };
}

/**
 * The flat, read-only view player formulas see. Rebuilt on demand so it can
 * never drift from the model.
 */
/**
 * The `essence.*` names a formula can read.
 *
 * The workbook published one defined name per receptacle -- VeilEssenceHands
 * for the veil in the Hands slot, VeilEssenceHands2 for its twinned second,
 * VeilEssenceWeapon and VeilEssenceArmor for the two Kheshig ones -- because
 * veils routinely scale their effect off the essence invested in them rather
 * than only their save DC. The same names live here as `essence.hands`,
 * `essence.hands2`, `essence.weapon` and `essence.armor`, alongside the
 * pool totals and any other receptacle by its own slugged name.
 */
export function essenceScope(model) {
  const a = model.data.akashic;
  const out = {
    pool: Number(a?.essence?.pool) || 0,
    // `pool` stays the day's own essence so a formula written against it does
    // not move when spell points are condensed; `total` is the two together.
    temp: Number(a?.calc?.temp) || 0,
    total: Number(a?.calc?.total ?? a?.essence?.pool) || 0,
    used: Number(a?.calc?.used) || 0,
    free: Number(a?.calc?.free) || 0,
    cap: Number(a?.calc?.totalCap) || 0,
  };
  const put = (key, value) => {
    if (key && out[key] === undefined) out[key] = value;
  };
  for (const slot of a?.slots || []) {
    const key = slug(slot.slot);
    const veils = slot.veils || [];
    // Both names exist whether or not the slot is twinned, and an empty slot
    // reads zero -- the workbook published VeilEssenceShoulder2 even with
    // nothing in it, and a formula asking should get 0 rather than an error.
    put(key, Number(veils[0]?.essence) || 0);
    put(`${key}2`, Number(veils[1]?.essence) || 0);
    for (let i = 2; i < veils.length; i++) put(`${key}${i + 1}`, Number(veils[i].essence) || 0);
  }
  for (const r of a?.kheshig || []) {
    // "Weapon Veil (Kheshig)" -> essence.weapon
    const key = slug(String(r.label || '').replace(/\s*Veil\s*\(Kheshig\)\s*$/i, ''));
    put(key, Number((r.veils || [])[0]?.essence) || 0);
  }
  for (const r of a?.otherReceptacles || []) {
    put(slug(r.name), Number(r.essence) || 0);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The shared veil catalogue.
 *
 * What veils exist is an extension pack; which of them a character has
 * shaped, and how much essence is in each, is on the sheet. The two are
 * matched by name, exactly as a discipline's maneuvers are.
 *
 * A veil is a **table** rather than a block for the reason a maneuver is: the
 * rules text belongs to whoever wrote it and stays in the pack, so a pack
 * that fixes a typo fixes it on every sheet already in play, and a character
 * sent to a friend carries the names of its veils rather than four kilobytes
 * of somebody else's book each. What the sheet keeps is the name, the
 * essence, and anything the player wrote themselves.
 *
 * A veil is assembled from more than one page, which is why `mergeTables`
 * merges a veil field by field instead of replacing it. The veil's own page
 * has its rules text, its chakra slots and its descriptors; the page listing
 * a *class's* veils is what says the veil is on that class's list at all.
 * Neither knows what the other does, and a catalogue wants both.
 * ------------------------------------------------------------------ */

let VEIL_CATALOGUE = { veils: [] };

/** "Hands, Wrists" and "Head/Headband" both name two chakras. */
export function splitSlots(raw) {
  return String(raw ?? '').split(/\s*[,/]\s*/).map((s) => s.trim()).filter(Boolean);
}

const uniqueBy = (list, key = (s) => s.toLowerCase()) => {
  const seen = new Map();
  for (const x of list) if (x && !seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
};

/**
 * Register the shared catalogue. Call before constructing a Character.
 *
 * `slot` is the chakra list as the page wrote it -- "Hands, Wrists" for a
 * veil shapeable in either -- and is kept verbatim as well as split, because
 * the string is what a card shows and the parts are what a picker filters on.
 */
export function setVeilCatalogue(doc) {
  const list = Array.isArray(doc?.veils) ? doc.veils : [];
  VEIL_CATALOGUE = {
    veils: list.map((v) => {
      const slot = String(v.slot ?? v.chakra ?? '').trim();
      return {
        name: String(v.name || '').trim(),
        slot,
        slots: splitSlots(slot),
        descriptor: String(v.descriptor || '').trim(),
        classes: uniqueBy((Array.isArray(v.classes) ? v.classes : splitSlots(v.classes)).map((c) => String(c).trim()).filter(Boolean)),
        text: String(v.text || ''),
        effect: String(v.effect || '').trim(),
        bindEffect: String(v.bindEffect || '').trim(),
        source: String(v.source || '').trim(),
      };
    }).filter((v) => v.name),
  };
}

export function veilCatalogue() {
  return VEIL_CATALOGUE;
}

/** One veil by name, however it was capitalised, or null. */
export function veilEntry(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return VEIL_CATALOGUE.veils.find((v) => v.name.toLowerCase() === key) || null;
}

/** Every veilweaving class any veil names, in the order a picker lists them. */
export function veilClasses() {
  return uniqueBy(VEIL_CATALOGUE.veils.flatMap((v) => v.classes)).sort((a, b) => a.localeCompare(b));
}

/** Every chakra any veil names. */
export function veilSlots() {
  return uniqueBy(VEIL_CATALOGUE.veils.flatMap((v) => v.slots)).sort((a, b) => a.localeCompare(b));
}

/**
 * The veils a picker should offer, narrowed by chakra and by whose list they
 * are on, in name order.
 *
 * `slot` left null is every chakra -- a Kheshig receptacle and a slot the
 * sheet invented have no chakra to filter on. `classes` left empty is every
 * list, because a catalogue whose class lists have never been imported knows
 * no class for any veil and would otherwise offer nothing at all. That is the
 * important case to get right: narrowing on absent data must widen, not
 * empty, the answer.
 */
export function veilsAvailable({ slot = null, classes = [] } = {}) {
  const chakra = String(slot ?? '').trim().toLowerCase();
  const want = (Array.isArray(classes) ? classes : [classes])
    .map((c) => String(c ?? '').trim().toLowerCase()).filter(Boolean);
  const anyClassKnown = want.length > 0 && VEIL_CATALOGUE.veils.some((v) => v.classes.length);
  return VEIL_CATALOGUE.veils
    .filter((v) => (!chakra || v.slots.some((s) => s.toLowerCase() === chakra)))
    // A veil no page has placed on a list stays on offer: the class lists are
    // a second import, and a catalogue with only half of them must not hide
    // the half it cannot vouch for.
    .filter((v) => !anyClassKnown || !v.classes.length || v.classes.some((c) => want.includes(c.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the player wrote themselves, and nothing else.
 *
 * This is what gets saved and what an edit starts from -- kept apart from
 * `veilDetails` so that opening a veil can never copy the catalogue's text
 * into the character. A pack that fixes a typo has to be able to fix it on
 * every sheet, which it cannot do if the sheets took a copy.
 */
export function veilOwn(veil) {
  return { desc: String(veil?.desc ?? '') };
}

/** Is there anything of the player's own on this veil? */
export function veilIsWritten(veil) {
  return veilOwn(veil).desc.trim() !== '';
}

/**
 * A shaped veil as a reader wants it: the player's own description where they
 * wrote one, the catalogue's underneath, and the chakra, descriptors, class
 * list and source the catalogue knows and the sheet never stored.
 *
 * `known` says whether the catalogue has it at all, so a card can tell a veil
 * whose pack is switched off from one the player named themselves.
 */
export function veilDetails(veil) {
  const own = veilOwn(veil);
  const shared = veilEntry(veil?.name);
  const mine = own.desc.trim() !== '';
  return {
    name: String(veil?.name ?? ''),
    desc: mine ? own.desc : String(shared?.text || shared?.effect || ''),
    mine,
    known: !!shared,
    slot: shared?.slot || '',
    descriptor: shared?.descriptor || '',
    classes: shared?.classes || [],
    bindEffect: shared?.bindEffect || '',
    source: shared?.source || '',
  };
}

/** The local scope a veil's own text resolves in. */
export function veilScope(model, veil) {
  return { essence: { self: Number(veil?.essence) || 0 } };
}
