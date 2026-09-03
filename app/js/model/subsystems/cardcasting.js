/**
 * Cardcasting: the deck, the card faces, and the live table.
 *
 * Two halves. The first is the deck as data -- colours, modifications, deck
 * feats and the manipulation catalogue -- read from the workbook and
 * recomputed as the character changes. The second is the table: an actual
 * game in progress, with a draw pile, a hand, spell points and a log, where
 * every action is a method that moves cards between zones and writes down
 * what it did.
 */

import { parseDiceExpr, statMod } from '../../rules.js';
import { evaluateFormula } from '../../formula.js';
import { sheetReader } from '../document.js';
import { sphereTally } from '../spheres.js';
import { splitVeilName } from './akashic.js';

/** The five mana colours, in the order the deck tab lists them. */
export const CARD_COLORS = [
  ['R', 'Red'], ['B', 'Black'], ['U', 'Blue'], ['W', 'White'], ['G', 'Green'],
];

const COLOR_LETTERS = CARD_COLORS.map(([k]) => k);

const COLOR_WORDS = {
  red: 'R', black: 'B', back: 'B', blue: 'U', white: 'W', green: 'G',
};

/**
 * The modifications a card caster may add to the drawback. Each is one more
 * drawback for boons (Colored Mana with five colours is two), and each has the
 * prerequisite the rules give it. `kind` says what the switch stores.
 */
export const CARD_MODIFICATIONS = [
  { key: 'bleedingHand', label: 'Bleeding Hand', kind: 'count', max: 2, needs: null,
    hint: 'Discard a card from your hand whenever you take a standard or full-round action that does not play or discard one. Taken twice: move, swift and immediate actions too.' },
  { key: 'coloredMana', label: 'Colored Mana', kind: 'colors', needs: 'manaPool',
    hint: 'Mana Point cards and effects each have a colour; mana only pays for effects of its colour. Three colours: no colour may be more than half your effects. Five colours: no more than a quarter, and it counts as two drawbacks.' },
  { key: 'deckout', label: 'Deckout', kind: 'bool', needs: 'cooldown',
    hint: 'You can never shuffle the discard pile back into the deck. Every turn the deck is empty you take 4 Constitution burn (Charisma if you have no Con). Reaching 0 kills you.' },
  { key: 'exposedGrip', label: 'Exposed Grip', kind: 'bool', needs: 'cooldown',
    hint: 'No card at the start of your turn; a move, swift or standard action draws one. Whenever you are hit or fail a save, discard a card — or take 4 Con burn if your hand is empty.' },
  { key: 'gradualRamp', label: 'Gradual Ramp', kind: 'bool', needs: 'manaPool',
    hint: 'Only one Mana Point card may be played from your hand per round.' },
  { key: 'lifeboundDeck', label: 'Lifebound Deck', kind: 'bool', needs: null,
    hint: 'Three extra piles — Stun, Wounds, Death. Lifebound value = one third of total HP divided by the deck size at the start of the day (minimum 1). Every Lifebound value of damage lost moves a card down the piles; every Lifebound value healed moves one back.' },
  { key: 'singleton', label: 'Singleton', kind: 'bool', needs: 'cooldown',
    hint: 'One copy of each card in the deck; Mana Point cards not affected by Specialized Mana Cards may still repeat.' },
  { key: 'stagnantPool', label: 'Stagnant Pool', kind: 'bool', needs: 'manaPool', clashes: 'manaGraveyard',
    hint: 'Mana Point cards in play are the spell points you may spend each round; turn one sideways per point spent, and untap them all at the start of your next turn. Incompatible with Mana Graveyard.' },
  { key: 'strikableAssets', label: 'Strikable Assets', kind: 'bool', needs: null,
    hint: 'Hand, deck and discard pile are worn objects that can be attacked; damage to them is dealt to you, and a hit or failed save reveals a card at random from one of them.' },
  { key: 'tightHand', label: 'Tight Hand', kind: 'bool', needs: null,
    hint: 'Maximum hand size 3, plus 1 for each Loaded Hand deck manipulation. Draws that would go past it stop at it.' },
];

/** "Draw Power Enhancement (Draw 3 cards)" → the name and the note in brackets. */
function splitBracketNote(raw) {
  return splitVeilName(raw);
}

/* ------------------------------------------------------------------ *
 * The deck manipulation catalogue.
 *
 * "For every deck feat a character possesses, they may also select a special
 * deck manipulation" -- the list is on the wiki's Card and Deck Feats page and
 * lives in the deck-manipulations extension pack: name, group, what it needs,
 * and the rule. That pack is not shipped -- it is the rule text that keeps it
 * out -- so it is imported, and `private/extensions/` is where this repo's
 * copy sits.
 * Registered once at startup; without it a manipulation is still a name and a
 * count, it simply has no rule text to show.
 * ------------------------------------------------------------------ */

let DECK_MANIPULATIONS = [];

/** Register the shared deck manipulation list. Call before constructing a Character. */
export function setCardcastingTables(doc) {
  DECK_MANIPULATIONS = (Array.isArray(doc?.manipulations) ? doc.manipulations : []).map((m) => ({
    name: String(m.name || ''),
    group: String(m.group || 'General'),
    requires: Array.isArray(m.requires) ? m.requires.map(String) : [],
    needs: String(m.needs || ''),
    repeat: !!m.repeat,
    max: Number(m.max) || 0,
    text: String(m.text || ''),
  }));
}

export function deckManipulationCatalogue() {
  return DECK_MANIPULATIONS;
}

/** "Draw Power Enhancement", "Drawpower Enhancement" and "Wildcard" / "Wild Card" are the same pick. */
const manipulationKey = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

/** The catalogue entry a manipulation's name refers to, or null. */
export function deckManipulation(name) {
  const key = manipulationKey(name);
  if (!key) return null;
  return DECK_MANIPULATIONS.find((m) => manipulationKey(m.name) === key) || null;
}

/** The deck feats a character has: every feat or bought-off drawback tagged [Deck]. */
export function deckFeatNames(d) {
  const out = [];
  // Feats arrive keyed by group and are normalised into `featGroups`; a
  // document may be at either stage when this is asked.
  const groups = Array.isArray(d?.featGroups) ? d.featGroups.map((g) => g.entries || [])
    : Object.values(d?.feats || {});
  for (const rows of groups) {
    if (!Array.isArray(rows)) continue;
    for (const f of rows) if (/\[[^\]]*deck/i.test(String(f?.name || ''))) out.push(String(f.name));
  }
  for (const x of d?.training?.magic?.tradition?.boughtOff || []) {
    if (/\[[^\]]*deck/i.test(String(x || ''))) out.push(String(x));
  }
  return out;
}

/** Uppercase colour letters only, in first-seen order: "u/b" → "UB". */
function normalizeColors(value) {
  const letters = String(value ?? '').toUpperCase().replace(/[^RBUWG]/g, '');
  return [...new Set(letters)].join('');
}

/**
 * Colour words in a card's text: "Blue/Black Mana" → "UB". The sheet spelt
 * "Back" for Black on two cards, which is why the typo is in the table.
 */
function colorsFromWords(text) {
  const out = [];
  for (const word of String(text || '').toLowerCase().match(/[a-z]+/g) || []) {
    const c = COLOR_WORDS[word];
    if (c && !out.includes(c)) out.push(c);
  }
  return out.join('');
}

/**
 * Read the workbook's Cardcaster Deck tab into the deck the Cardcasting tab
 * edits.
 *
 * The tab is one character's own design rather than template furniture, so
 * everything is found by its label: the drawback switches beside their names,
 * the deck manipulations under their group headings, the land-attuned spheres
 * under theirs, and the deck itself under the "Suit / Align. / Mana / Effect"
 * header. What the sheet worked out for itself -- colour tallies, the Harrow
 * suit and alignment totals, the decklist, the identical-effect spread -- is
 * recomputed here and not kept, which is most of the tab's right-hand side.
 *
 * `drawbacks` is the tradition's drawback list from the Magic Training tab, so
 * a caster who took Card Casting without a deck tab still gets the switches
 * ticked that the tradition says are on.
 */
export function importCardcasting(tab, drawbacks = [], magicClasses = [], deckFeats = []) {
  const g = sheetReader(tab);
  const { at, text, num, mark, isUsed, rightOf, find, findAll, scan } = g;
  const bool = (v) => v === true || (typeof v === 'number' && v > 0)
    || /^(true|yes|x|✓)$/i.test(text(v));

  const drawbackList = (drawbacks || []).map((x) => text(x).toLowerCase());
  const hasDrawback = (re) => drawbackList.some((x) => re.test(x));

  const block = {
    enabled: !!tab || hasDrawback(/card\s*cast/),
    castingStat: '',
    useD100: false,
    cooldown: hasDrawback(/^cooldown/),
    manaPool: hasDrawback(/^mana pool/),
    manaGraveyard: hasDrawback(/^mana graveyard/),
    mods: {
      bleedingHand: hasDrawback(/^bleeding hand/) ? 1 : 0,
      coloredMana: hasDrawback(/^colored mana/) ? 3 : 0,
      deckout: hasDrawback(/^deckout/),
      exposedGrip: hasDrawback(/^exposed grip/),
      gradualRamp: hasDrawback(/^gradual ramp/),
      lifeboundDeck: hasDrawback(/^lifebound deck/),
      singleton: hasDrawback(/^singleton/),
      stagnantPool: hasDrawback(/^stagnant pool/),
      strikableAssets: hasDrawback(/^strikable assets/),
      tightHand: hasDrawback(/^tight hand/),
    },
    colors: '',
    colorSpheres: Object.fromEntries(COLOR_LETTERS.map((c) => [c, []])),
    attunedSpheres: [],
    manipulations: [],
    manipulationsAvailable: null,
    cards: [],
    sideboard: [],
    harrow: false,
    notes: '',
    sourceExtras: [],
  };
  // "Colored Mana (RBU)" on the tradition names the colours in play.
  const coloredNote = drawbackList.find((x) => /^colored mana/.test(x));
  if (coloredNote) {
    const letters = normalizeColors((coloredNote.match(/\(([^)]*)\)/) || [])[1]);
    if (letters.length === 3 || letters.length === 5) {
      block.colors = letters;
      block.mods.coloredMana = letters.length;
    }
  }
  const firstMod = text(magicClasses.find((c) => c?.mod1)?.mod1);
  if (firstMod) block.castingStat = firstMod;

  if (!tab) return block;

  // ---- the header block: casting stat, switches, and the sheet's own tallies ----
  const camCell = find('Cardcaster CAM');
  if (camCell) block.castingStat = text(rightOf(camCell[0], camCell[1], 6)) || block.castingStat;
  const flag = (label, span = 3) => {
    const hit = find(label);
    if (!hit) return null;
    const v = rightOf(hit[0], hit[1], span);
    // A stray tick beside a switch's value (the sheet kept one next to
    // Deckout) belongs to nothing; it goes with the value.
    for (let n = 1; n <= span; n++) {
      if (isUsed(hit[0], hit[1] + n) && typeof at(hit[0], hit[1] + n + 1) === 'boolean') mark(hit[0], hit[1] + n + 1);
    }
    return v;
  };
  for (const label of ['Deck Size:', 'Min-Max Diff', 'Deck Feats']) flag(label, 6);   // recomputed below
  const remaining = num(flag('Remaining Deck Manip.', 6));
  const d100 = flag('Using d100', 6);
  if (d100 !== null) block.useD100 = bool(d100);
  const mp = flag('Mana Pool');
  if (mp !== null) block.manaPool = bool(mp);
  const cd = flag('Cooldown');
  if (cd !== null) block.cooldown = bool(cd);
  const mg = flag('Mana Graveyard');
  if (mg !== null) block.manaGraveyard = bool(mg);
  const cm = flag('Colored Mana');
  if (cm !== null) {
    const n = num(cm);
    block.mods.coloredMana = n === 5 ? 5 : n > 0 ? 3 : 0;
  }
  for (const [label, key] of [['Deckout', 'deckout'], ['Stagnant Pool', 'stagnantPool'],
    ['Gradual Ramp', 'gradualRamp'], ['Exposed Grip', 'exposedGrip'], ['Lifebound Deck', 'lifeboundDeck'],
    ['Singleton', 'singleton'], ['Strikable Assets', 'strikableAssets'], ['Tight Hand', 'tightHand']]) {
    const v = flag(label);
    if (v !== null) block.mods[key] = bool(v);
  }
  const bh = flag('Bleeding Hand');
  if (bh !== null) block.mods.bleedingHand = Math.min(2, num(bh) || (bool(bh) ? 1 : 0));

  // ---- deck manipulations: label + count under each group heading ----
  const headings = scan(/^(.*) Deck Manipulations$|^Specialized Mana Cards\b/)
    .map(([ri, ci, m]) => ({ ri, ci, group: (m[1] || 'Specialized Mana Cards').trim() }));
  const landHit = find('Land-Attuned Magic');
  const columns = [...new Set(headings.map((h) => h.ci))].sort((a, b) => a - b);
  for (const h of headings) {
    mark(h.ri, h.ci);
    const nextCol = columns.find((c) => c > h.ci);
    // The land-attuned block keeps its colour letters one column left of its
    // heading, so a group's columns stop short of that too.
    const colEnd = Math.min(nextCol ?? Infinity, landHit && landHit[1] > h.ci ? landHit[1] - 1 : Infinity, h.ci + 8) - 1;
    const below = headings.filter((o) => o.ci === h.ci && o.ri > h.ri).map((o) => o.ri);
    const rowEnd = below.length ? Math.min(...below) - 1 : g.rows.length - 1;
    for (let r = h.ri + 1; r <= rowEnd; r++) {
      let any = false;
      for (let c = h.ci; c <= colEnd; c++) {
        if (isUsed(r, c) || typeof at(r, c) !== 'string' || text(at(r, c)) === '') continue;
        any = true;
        // The count sits within two cells to the right: a number, or a tick.
        let value = null;
        for (let n = 1; n <= 2 && c + n <= colEnd; n++) {
          const v = at(r, c + n);
          if (typeof v === 'number' || typeof v === 'boolean') { value = v; mark(r, c + n); break; }
        }
        mark(r, c);
        const { name, desc } = splitBracketNote(at(r, c));
        block.manipulations.push({
          group: h.group,
          name,
          note: desc,
          count: typeof value === 'number' ? value : value === true ? 1 : 0,
        });
      }
      // The first row with nothing in the group's columns ends it -- the deck
      // table starts under the General group and must not be read as feats.
      if (!any && r > h.ri + 1) break;
    }
  }
  const taken = block.manipulations.reduce((n, m) => n + (Number(m.count) || 0), 0);
  // One manipulation per deck feat, plus Card Shark's extra: when the sheet's
  // total is exactly that, leave it automatic so a new deck feat raises it.
  const auto = deckFeats.length + (deckFeats.some((f) => /card shark/i.test(f)) ? 1 : 0);
  block.manipulationsAvailable = taken + remaining === auto ? null : taken + remaining;

  // ---- land-attuned magic: a colour, five spheres, a tick each ----
  if (landHit) {
    const [lr, lc] = landHit;
    mark(lr, lc);
    for (let r = lr + 1; r < g.rows.length; r++) {
      const letter = text(at(r, lc - 1)).toUpperCase();
      if (COLOR_LETTERS.includes(letter) && letter.length === 1) {
        mark(r, lc - 1);
        const spheres = [];
        const ticks = [];
        for (let c = lc; c <= lc + 20; c++) {
          const v = at(r, c);
          if (typeof v === 'string' && text(v)) { spheres.push(text(v)); mark(r, c); } else if (typeof v === 'boolean') { ticks.push(v); mark(r, c); }
        }
        block.colorSpheres[letter] = spheres;
        spheres.forEach((s, i) => { if (ticks[i]) block.attunedSpheres.push(s); });
        // The row beneath is the sheet's own count of cards per sphere.
        for (let c = lc - 1; c <= lc + 20; c++) {
          const v = at(r + 1, c);
          if (typeof v === 'number' || text(v) === 'Cards') mark(r + 1, c);
        }
        r += 1;
      } else break;      // the colour rows are contiguous; the tally table below reuses the letters
    }
  }

  // ---- colours in play: the "All Cards" tick row under the R B U W G letters ----
  const allCards = find('All Cards');
  if (allCards) {
    const [ar, ac] = allCards;
    mark(ar, ac);
    let letters = '';
    for (let c = ac + 1; c <= ac + 5; c++) {
      const l = text(at(ar - 1, c)).toUpperCase();
      if (COLOR_LETTERS.includes(l) && at(ar, c) === true) letters += l;
      mark(ar - 1, c);
      mark(ar, c);
    }
    if (letters) block.colors = letters;
  }

  // ---- the deck ----
  const header = find('Suit');
  if (header) {
    const [hr, hc] = header;
    const col = {};
    for (let c = 0; c < (g.rows[hr] || []).length; c++) {
      const label = text(at(hr, c));
      if (label) { col[label] = c; mark(hr, c); }
    }
    const suitCol = col.Suit;
    const effectCol = col.Effect ?? suitCol + 4;
    const manaCol = col.Mana ?? suitCol + 2;
    const harrowCol = col['Harrow Name'];
    const deckHit = find('Deck');
    if (deckHit && deckHit[0] < hr) mark(deckHit[0], deckHit[1]);

    for (let r = hr + 1; r < g.rows.length; r++) {
      const index = at(r, suitCol - 1);
      const suit = text(at(r, suitCol));
      const effectRaw = text(at(r, effectCol));
      if (typeof index !== 'number' && !suit && !effectRaw) break;
      mark(r, suitCol - 1);
      mark(r, suitCol);
      const alignment = text(at(r, col['Align.'] ?? suitCol + 1));
      mark(r, col['Align.'] ?? suitCol + 1);
      const color = normalizeColors(at(r, manaCol));
      const mana2 = normalizeColors(at(r, manaCol + 1));
      mark(r, manaCol);
      mark(r, manaCol + 1);
      mark(r, effectCol);
      // "Reanimate | Blue/Black Mana": the effect, and the mana the fused card
      // also carries. Without the suffix, the second Mana column is the mana.
      // Only a trailing "| … Mana" is the mana half; a bar inside the effect's
      // own brackets ("Chain Blast|Explosive Orb") is part of the effect.
      const manaSuffix = /^(.*?)\s*\|\s*([^|]*\bmana\b[^|]*)$/i.exec(effectRaw);
      const mana = manaSuffix ? (colorsFromWords(manaSuffix[2]) || mana2) : mana2;
      const effect = manaSuffix ? manaSuffix[1].trim() : effectRaw;
      const cost = col.Cost !== undefined ? at(r, col.Cost) : null;
      if (col.Cost !== undefined) mark(r, col.Cost);
      const tags = col.Other !== undefined ? text(at(r, col.Other)) : '';
      if (col.Other !== undefined) mark(r, col.Other);
      const sphere = col.Sphere !== undefined ? text(at(r, col.Sphere)) : '';
      if (col.Sphere !== undefined) mark(r, col.Sphere);
      // An unlabelled number between Sphere and Harrow Name is how many copies.
      let qty = 1;
      if (harrowCol !== undefined && col.Sphere !== undefined) {
        for (let c = col.Sphere + 1; c < harrowCol; c++) {
          if (typeof at(r, c) === 'number') { qty = at(r, c); mark(r, c); break; }
        }
      }
      const harrow = harrowCol !== undefined ? text(at(r, harrowCol)) : '';
      if (harrowCol !== undefined) mark(r, harrowCol);
      const tech = col['Tech.'] !== undefined ? bool(at(r, col['Tech.'])) : false;
      if (col['Tech.'] !== undefined) mark(r, col['Tech.']);
      if (col.Drawable !== undefined) mark(r, col.Drawable);
      const roll = col['Roll #'] !== undefined && typeof at(r, col['Roll #']) === 'number'
        ? at(r, col['Roll #']) : null;
      if (col['Roll #'] !== undefined) mark(r, col['Roll #']);

      // The Harrow card's name is the card's name: Nico's deck is a Harrow
      // deck, and "Betrayal" is what he calls the card, not a note about it.
      block.cards.push({
        name: harrow, suit, alignment, color, mana, effect,
        cost: cost === null || cost === undefined ? '' : String(cost),
        sphere, tags, qty, tech, roll, art: '', notes: '',
      });
    }
  }

  // ---- the sideboard: effect / cost / sphere / mana, under its heading ----
  const side = find('Sideboard');
  // "Sideboard" is also a General deck manipulation; the table is the one with
  // a Cost header on the same row.
  for (const [sr, sc] of findAll('Sideboard')) {
    let costCol = -1;
    let sphereCol = -1;
    let manaCol = -1;
    for (let c = sc + 1; c <= sc + 12; c++) {
      const label = text(at(sr, c));
      if (label === 'Cost') costCol = c;
      else if (label === 'Sphere') sphereCol = c;
      else if (label === 'Mana') manaCol = c;
    }
    if (costCol < 0 || sphereCol < 0) continue;
    mark(sr, sc);
    for (const c of [costCol, sphereCol, manaCol]) if (c >= 0) mark(sr, c);
    for (let r = sr + 1; r < g.rows.length; r++) {
      const cells = [];
      for (let c = sc; c <= sc + 12; c++) if (text(at(r, c))) cells.push(c);
      if (!cells.length) break;
      const nameCells = cells.filter((c) => c < costCol);
      const effect = nameCells.map((c) => text(at(r, c))).join(' ');
      const cost = text(at(r, costCol));
      const sphere = text(at(r, sphereCol));
      let mana = '';
      for (const c of cells) if (c >= (manaCol < 0 ? sphereCol + 1 : manaCol)) mana += normalizeColors(at(r, c));
      for (const c of cells) mark(r, c);
      block.sideboard.push({ name: '', effect, cost, sphere, tags: '', color: '', mana: normalizeColors(mana), art: '', notes: '' });
    }
  }
  void side;

  // ---- what the sheet tallied for itself: dropped, recomputed on load ----
  const dropRegion = (r0, r1, c0, c1) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (at(r, c) !== null && at(r, c) !== undefined) mark(r, c);
  };
  if (allCards) {
    // From the colour letters down to the row before the Harrow totals or the
    // sideboard, whichever comes first: per-colour counts, Σ Cards, Σ Mana Cards.
    const stops = [find('Harrow Deck'), side].filter(Boolean).map((h) => h[0]).filter((r) => r > allCards[0]);
    const end = stops.length ? Math.min(...stops) - 1 : allCards[0] + 8;
    dropRegion(allCards[0] - 1, end, allCards[1], allCards[1] + 10);
  }
  const harrow = find('Harrow Deck');
  if (harrow) dropRegion(harrow[0], harrow[0] + 6, harrow[1], harrow[1] + 7);
  const decklist = find('Decklist');
  if (decklist) dropRegion(decklist[0], g.rows.length - 1, decklist[1], decklist[1] + 7);
  // The suit+alignment key beside each card, and the zero-filled Min / Max /
  // colour columns past it.
  const keyRe = /^(Str|Dex|Con|Int|Wis|Cha)(LG|NG|CG|LN|TN|CN|LE|NE|CE)$/;
  const tailFrom = allCards ? allCards[1] + 11 : Infinity;
  g.rows.forEach((cells, r) => {
    // A row of nothing but unticked boxes is a hidden control strip, not data.
    const live = cells.map((v, c) => [v, c]).filter(([v]) => v !== null && v !== undefined && v !== '');
    if (live.length && live.every(([v]) => v === false)) live.forEach(([, c]) => mark(r, c));
    cells.forEach((v, c) => {
      if (isUsed(r, c)) return;
      if (typeof v === 'string' && keyRe.test(v.trim())) mark(r, c);
      else if (c >= tailFrom && (typeof v === 'number' || ['Min', 'Max', ...COLOR_LETTERS].includes(text(v)))) mark(r, c);
    });
  });

  block.harrow = block.cards.some((card) => card.suit || card.alignment);
  block.sourceExtras = g.extras();
  return block;
}

/* ------------------------------------------------------------------ *
 * The Template tab: from the sheet's columns of blocks to feature groups.
 * ------------------------------------------------------------------ */

// The deck: every tally, check and draw range is worked out from the cards.
export const CARDCASTING_DERIVED = [
  'calc',
  { path: 'cards', keys: ['calc'] },
  { path: 'sideboard', keys: ['calc'] },
  { path: 'manipulations', keys: ['calc'] },
  // The table's zones are play state and stay; its counts do not.
  { obj: 'table', keys: ['calc'] },
];

/**
 * The deck, checked against the drawback's rules.
 *
 * Everything here is worked out from the cards and the switches, so none of
 * it is saved:
 *
 *   casting modifier   the casting stat's modifier (Int for Nico)
 *   opening hand       1 + that modifier, at least 2 -- drawn at initiative
 *   deck size          Σ copies; the rules want at least 20
 *   spread             most copies of one effect minus fewest may not exceed
 *                      the casting modifier
 *   colour balance     with Colored Mana: every colour has an effect, and no
 *                      colour has more than half (three colours) or a quarter
 *                      (five) of them
 *   lifebound value    floor(HP / 3 / deck size), minimum 1
 *   hand limit         Tight Hand: 3 + Loaded Hand picks
 *   drawbacks for boons  1, +1 for Cooldown or Mana Pool, +1 for both, +1 for
 *                      Mana Graveyard, +1 per modification (+2 for five-colour
 *                      Colored Mana)
 *
 * Every check is advisory -- a badge and a line, never a gate. A deck the
 * table has been happy with for months is not the place to start refusing.
 */
export function recomputeCardcasting(model) {
  const p = model.data.cardcasting;
  if (!p) return;
  const c = model.data;

  // ---- normalise what the player typed ----
  p.mods = p.mods || {};
  for (const m of CARD_MODIFICATIONS) {
    if (m.kind === 'count') p.mods[m.key] = Math.max(0, Math.min(m.max, Math.floor(Number(p.mods[m.key]) || 0)));
    else if (m.kind === 'colors') {
      const n = Number(p.mods[m.key]) || 0;
      p.mods[m.key] = n >= 5 ? 5 : n > 0 ? 3 : 0;
    } else p.mods[m.key] = !!p.mods[m.key];
  }
  p.colors = normalizeColors(p.colors);
  p.useD100 = !!p.useD100 && p.useD100 !== '0';
  p.attunedSpheres = Array.isArray(p.attunedSpheres) ? p.attunedSpheres : [];
  p.colorSpheres = p.colorSpheres || {};
  for (const [k] of CARD_COLORS) if (!Array.isArray(p.colorSpheres[k])) p.colorSpheres[k] = [];
  p.cards = Array.isArray(p.cards) ? p.cards : [];
  p.sideboard = Array.isArray(p.sideboard) ? p.sideboard : [];
  p.manipulations = Array.isArray(p.manipulations) ? p.manipulations : [];
  for (const card of [...p.cards, ...p.sideboard]) {
    // A card saved before it had a name of its own carried the Harrow name.
    if (card.name === undefined) card.name = String(card.harrow ?? '');
    delete card.harrow;
    // Rainbow Efficiency lets an effect cost two colours, Improved up to five.
    card.color = normalizeColors(card.color);
    card.mana = normalizeColors(card.mana);
    card.effect = String(card.effect ?? '');
    card.art = String(card.art ?? '');
    card.dice = String(card.dice ?? '');
  }
  for (const card of p.cards) card.qty = Math.max(0, Math.floor(Number(card.qty ?? 1) || 0));
  p.harrow = !!p.harrow;
  // Mana Graveyard needs both halves of the ladder; Stagnant Pool and it
  // cannot both be on. Neither is forced off -- the check below says so.

  // ---- the casting modifier and what hangs off it ----
  const stat = String(p.castingStat || '').trim()
    || String((c.training?.magic?.classes || []).find((x) => x?.mod1)?.mod1 || '').trim();
  const cam = stat ? statMod(c, stat, '') : 0;
  const openingHand = Math.max(2, 1 + cam);

  // ---- deck feats, and what they bring ----
  const deckFeats = deckFeatNames(c);
  const rainbow = deckFeats.some((f) => /rainbow efficiency,? improved|improved rainbow/i.test(f)) ? 2
    : deckFeats.some((f) => /rainbow efficiency/i.test(f)) ? 1 : 0;

  // A card with no colour of its own takes its sphere's, from the
  // land-attuned table; a plain Mana Point card wears its mana.
  const sphereColor = (sphere) => {
    const want = String(sphere || '').trim().toLowerCase();
    if (!want) return '';
    for (const [k] of CARD_COLORS) {
      if ((p.colorSpheres[k] || []).some((s) => String(s).trim().toLowerCase() === want)) return k;
    }
    return '';
  };
  for (const card of [...p.cards, ...p.sideboard]) {
    const own = card.color;
    const fromSphere = own ? '' : sphereColor(card.sphere);
    const colors = own || fromSphere || (String(card.effect || '').trim() ? '' : card.mana);
    // Veilweaving sits outside sphere magic, so its cards are artifacts.
    const artifact = /veil/i.test(`${card.sphere || ''} ${card.tags || ''}`);
    card.calc = { ...(card.calc || {}), colors, fromSphere: !!fromSphere, artifact };
  }

  // ---- the deck's shape ----
  const inDeck = p.cards.filter((card) => card.qty > 0);
  const deckSize = inDeck.reduce((n, card) => n + card.qty, 0);
  const isEffect = (card) => card.effect.trim() !== '';
  const effectCards = inDeck.filter(isEffect).reduce((n, card) => n + card.qty, 0);
  const manaCards = inDeck.filter((card) => card.mana).reduce((n, card) => n + card.qty, 0);
  const pureMana = inDeck.filter((card) => !isEffect(card) && card.mana).reduce((n, card) => n + card.qty, 0);
  const fused = inDeck.filter((card) => isEffect(card) && card.mana).reduce((n, card) => n + card.qty, 0);

  // Copies of each distinct effect. The rule reads "identical effect", so the
  // name is what is compared -- case and spacing aside.
  const effectCounts = new Map();
  for (const card of inDeck) {
    if (!isEffect(card)) continue;
    const key = card.effect.trim().replace(/\s+/g, ' ').toLowerCase();
    const row = effectCounts.get(key) || { effect: card.effect.trim(), count: 0, sphere: card.sphere || '' };
    row.count += card.qty;
    effectCounts.set(key, row);
  }
  const effects = [...effectCounts.values()].sort((a, b) => b.count - a.count || a.effect.localeCompare(b.effect));
  const spreadMax = effects.length ? Math.max(...effects.map((e) => e.count)) : 0;
  const spreadMin = effects.length ? Math.min(...effects.map((e) => e.count)) : 0;

  // ---- per colour, per sphere, per suit ----
  const colorTally = Object.fromEntries(CARD_COLORS.map(([k]) => [k, { effects: 0, mana: 0 }]));
  const sphereTally = {};
  const suitTally = {};
  const alignTally = {};
  for (const card of inDeck) {
    // A two-colour effect (Rainbow Efficiency) is of each of its colours.
    if (isEffect(card)) for (const k of card.calc.colors) if (colorTally[k]) colorTally[k].effects += card.qty;
    for (const m of card.mana) if (colorTally[m]) colorTally[m].mana += card.qty;
    if (card.sphere) sphereTally[card.sphere] = (sphereTally[card.sphere] || 0) + card.qty;
    if (card.suit) suitTally[card.suit] = (suitTally[card.suit] || 0) + card.qty;
    if (card.alignment) alignTally[card.alignment] = (alignTally[card.alignment] || 0) + card.qty;
  }
  // The colours in play: what the player named, else every colour a card uses.
  const colorsInPlay = p.colors
    || CARD_COLORS.map(([k]) => k).filter((k) => colorTally[k].effects || colorTally[k].mana).join('');

  // ---- draw ranges: card n covers the copies before it ----
  let cursor = 0;
  for (const card of p.cards) {
    if (card.qty > 0) {
      Object.assign(card.calc, { from: cursor + 1, to: cursor + card.qty });
      cursor += card.qty;
    } else Object.assign(card.calc, { from: null, to: null });
  }

  // ---- the checks ----
  const issues = [];
  const mods = p.mods;
  if (deckSize && deckSize < 20) issues.push(`The deck holds ${deckSize} cards; the rules want at least 20.`);
  if (effects.length && spreadMax - spreadMin > cam) {
    issues.push(`Copies of one effect range from ${spreadMin} to ${spreadMax}, a spread of ${spreadMax - spreadMin}; the casting modifier allows ${cam}.`);
  }
  if (mods.coloredMana) {
    const n = mods.coloredMana;
    // Rainbow Efficiency loosens the balance: ¾ of effects may share a
    // colour with three colours in play, ½ with five.
    const share = n === 5 ? (rainbow ? 0.5 : 0.25) : (rainbow ? 0.75 : 0.5);
    const named = colorsInPlay.split('').filter(Boolean);
    if (named.length && named.length !== n) {
      issues.push(`Colored Mana names ${n} colours but ${named.length} ${named.length === 1 ? 'is' : 'are'} in play (${named.join(', ')}).`);
    }
    for (const k of named) {
      const t = colorTally[k];
      if (t && effectCards && t.effects === 0) issues.push(`No ${CARD_COLORS.find(([x]) => x === k)[1]} effect in the deck; every colour needs at least one.`);
      if (t && effectCards && t.effects > effectCards * share) {
        const cap = share === 0.75 ? 'three quarters' : share === 0.5 ? 'half' : 'quarter';
        issues.push(`${CARD_COLORS.find(([x]) => x === k)[1]} effects are ${t.effects} of ${effectCards}, over the ${cap} ${rainbow ? 'Rainbow Efficiency' : 'Colored Mana'} allows.`);
      }
    }
    // A card may cost as many colours as the feats allow: two with Rainbow
    // Efficiency, up to five with Improved and Colored Mana taken twice.
    const maxColors = rainbow === 2 ? (n === 5 ? 5 : 3) : rainbow === 1 ? 2 : 1;
    const over = inDeck.filter((card) => card.color.length > maxColors);
    if (over.length) {
      issues.push(`${over.length} card${over.length === 1 ? ' costs' : 's cost'} more than ${maxColors} colour${maxColors === 1 ? '' : 's'} (${over.slice(0, 3).map((x) => x.name || x.effect).join(', ')}${over.length > 3 ? '…' : ''}); that takes ${rainbow ? 'Improved ' : ''}Rainbow Efficiency.`);
    }
  }
  if (mods.singleton) {
    const dupes = effects.filter((e) => e.count > 1);
    if (dupes.length) issues.push(`Singleton: ${dupes.map((e) => `${e.effect} ×${e.count}`).join(', ')}.`);
  }
  if (p.manaGraveyard && !(p.cooldown && p.manaPool)) issues.push('Mana Graveyard needs both Cooldown and Mana Pool.');
  for (const m of CARD_MODIFICATIONS) {
    const on = m.kind === 'bool' ? mods[m.key] : Number(mods[m.key]) > 0;
    if (!on) continue;
    if (m.needs === 'cooldown' && !p.cooldown) issues.push(`${m.label} needs Cooldown.`);
    if (m.needs === 'manaPool' && !p.manaPool) issues.push(`${m.label} needs Mana Pool.`);
    if (m.clashes === 'manaGraveyard' && p.manaGraveyard) issues.push(`${m.label} and Mana Graveyard cannot both be taken.`);
  }
  if (p.useD100 && deckSize > 100) issues.push(`A d100 cannot draw from ${deckSize} cards.`);

  // ---- what the drawback is worth for boons ----
  let drawbackValue = 1;
  if (p.cooldown || p.manaPool) drawbackValue += 1;
  if (p.cooldown && p.manaPool) drawbackValue += 1;
  if (p.manaGraveyard && p.cooldown && p.manaPool) drawbackValue += 1;
  for (const m of CARD_MODIFICATIONS) {
    if (m.kind === 'count') drawbackValue += Number(mods[m.key]) || 0;
    else if (m.kind === 'colors') drawbackValue += mods[m.key] === 5 ? 2 : mods[m.key] ? 1 : 0;
    else if (mods[m.key]) drawbackValue += 1;
  }

  // ---- deck manipulations: taken against the number available ----
  for (const m of p.manipulations) m.count = Math.max(0, Math.floor(Number(m.count) || 0));
  const manipulationsTaken = p.manipulations.reduce((n, m) => n + m.count, 0);
  const loadedHand = p.manipulations
    .filter((m) => /^loaded hand/i.test(String(m.name || '')))
    .reduce((n, m) => n + m.count, 0);
  // Available: one per deck feat, plus one for Card Shark -- unless a
  // number or a formula is written over it.
  const autoAvailable = deckFeats.length + (deckFeats.some((f) => /card shark/i.test(f)) ? 1 : 0);
  let manipulationsAvailable = autoAvailable;
  let manipulationsError = null;
  if (typeof p.manipulationsAvailable === 'string' && p.manipulationsAvailable.trim() !== '') {
    try {
      const v = Number(evaluateFormula(p.manipulationsAvailable, model.scope()));
      manipulationsAvailable = Number.isFinite(v) ? Math.floor(v) : 0;
    } catch (err) {
      manipulationsError = err.message;
    }
  } else if (p.manipulationsAvailable !== null && p.manipulationsAvailable !== undefined && p.manipulationsAvailable !== '') {
    manipulationsAvailable = Math.floor(Number(p.manipulationsAvailable) || 0);
  }
  // What each pick needs, checked against the switches.
  const flagOn = { cooldown: p.cooldown, manaPool: p.manaPool, coloredMana: mods.coloredMana > 0,
    singleton: mods.singleton, gradualRamp: mods.gradualRamp, notManaGraveyard: !p.manaGraveyard };
  for (const m of p.manipulations) {
    const entry = deckManipulation(m.name);
    const unmet = entry && m.count > 0 ? entry.requires.filter((r) => !flagOn[r]) : [];
    const overMax = entry && entry.max && m.count > entry.max;
    m.calc = { known: !!entry, unmet, overMax: !!overMax };
    if (unmet.length) issues.push(`${m.name} needs ${unmet.map((r) => ({ cooldown: 'Cooldown', manaPool: 'Mana Pool', coloredMana: 'Colored Mana', singleton: 'Singleton', gradualRamp: 'Gradual Ramp', notManaGraveyard: 'no Mana Graveyard' })[r]).join(' and ')}.`);
    if (overMax) issues.push(`${m.name} can only be taken ${entry.max} times.`);
  }

  const hpTotal = model.hpMax;
  const lifebound = mods.lifeboundDeck && deckSize ? Math.max(1, Math.floor(hpTotal / 3 / deckSize)) : null;
  const handMax = mods.tightHand ? 3 + loadedHand : null;

  p.calc = {
    stat,
    cam,
    openingHand,
    deckSize,
    effectCards,
    manaCards,
    pureMana,
    fused,
    uniqueEffects: effects.length,
    effects,
    spreadMax,
    spreadMin,
    colorTally,
    colorsInPlay,
    sphereTally,
    suitTally,
    alignTally,
    issues,
    drawbackValue,
    deckFeats,
    rainbow,
    autoAvailable,
    manipulationsTaken,
    manipulationsAvailable,
    manipulationsError,
    manipulationsLeft: manipulationsAvailable - manipulationsTaken,
    loadedHand,
    lifebound,
    handMax,
  };

  recomputeTable(model);
}

/**
 * The encounter's zones, kept on `cardcasting.table` as card instance ids
 * (`<card index>#<copy>`) so a deck of 54 saves as a few short lists.
 *
 * Nothing here is derived except `calc`; the zones are play state, kept
 * like hit points. Cards that no longer exist in the deck (a row deleted
 * mid-encounter) fall out of every zone on recompute rather than lingering
 * as ghosts, and copies added mid-encounter wait for the next shuffle.
 */
export function recomputeTable(model) {
  const p = model.data.cardcasting;
  if (!p) return;
  const t = p.table || (p.table = {});
  t.active = !!t.active;
  t.round = Math.max(0, Math.floor(Number(t.round) || 0));
  t.redraws = Math.max(0, Math.floor(Number(t.redraws) || 0));
  t.manaPlayed = Math.max(0, Math.floor(Number(t.manaPlayed) || 0));
  for (const zone of ['deck', 'hand', 'play', 'discard', 'exile', 'stun', 'wounds', 'death', 'faceDown']) {
    t[zone] = (Array.isArray(t[zone]) ? t[zone] : []).filter((id) => model.tableCard(id));
  }
  // A trap is a card in play that is face down; the list is the flag.
  t.faceDown = t.faceDown.filter((id) => t.play.includes(id));
  if (t.lastRoll && typeof t.lastRoll !== 'object') t.lastRoll = null;
  if (t.counters && (typeof t.counters !== 'object' || !model.tableCard(t.counters.id))) t.counters = null;
  t.lastTrigger = typeof t.lastTrigger === 'string' ? t.lastTrigger : '';
  // Mana in play carries a tapped flag (Stagnant Pool), so it is a list of
  // {id, tapped} rather than bare ids.
  t.mana = (Array.isArray(t.mana) ? t.mana : [])
    .map((m) => (typeof m === 'string' ? { id: m, tapped: false } : m))
    .filter((m) => m && model.tableCard(m.id))
    .map((m) => ({ id: String(m.id), tapped: !!m.tapped }));
  t.log = (Array.isArray(t.log) ? t.log : []).slice(-30).map(String);

  const k = p.calc;
  const seen = new Set([...t.deck, ...t.hand, ...t.play, ...t.discard, ...t.exile, ...t.stun, ...t.wounds, ...t.death, ...t.mana.map((m) => m.id)]);
  // Gradual Ramp: one Mana Point card from the hand a round -- a Mana Rock
  // (for a spell point) or a Moxen may still be played.
  const manaBlocked = !!(p.mods.gradualRamp && t.manaPlayed >= 1);
  // Copies the deck holds that are in no zone: what the next shuffle adds.
  const missing = model.tableInstances().filter((id) => !seen.has(id));
  const untapped = t.mana.filter((m) => !m.tapped);
  const handMax = k.handMax;
  t.calc = {
    inDeck: t.deck.length,
    inHand: t.hand.length,
    inPlay: t.play.length,
    inDiscard: t.discard.length,
    manaInPlay: t.mana.length,
    manaUntapped: untapped.length,
    missing: missing.length,
    handOver: handMax ? Math.max(0, t.hand.length - handMax) : 0,
    manaBlocked,
    // What each card in hand may do: cast, play as mana, roll.
    // With Mana Pool a card needs as many Mana Point cards in play as it
    // costs; under Colored Mana only mana of the card's colour counts.
    castable: Object.fromEntries(t.hand.map((id) => [id, castCheck(model, id)])),
    manaOk: Object.fromEntries(t.hand.map((id) => [id, manaPlayCheck(model, id, manaBlocked)])),
    trapCard: hasDeckFeat(model, /trap card/i),
  };
}

/** Is a deck feat by that name on the character? */
export function hasDeckFeat(model, re) {
  return (model.data.cardcasting?.calc?.deckFeats || []).some((f) => re.test(f));
}

/** Is a manipulation by that name taken? */
export function hasManipulation(model, re) {
  return (model.data.cardcasting?.manipulations || []).some((m) => re.test(String(m.name || '')) && Number(m.count) > 0);
}

/** May this card go onto the table as mana right now? */
export function manaPlayCheck(model, id, blocked) {
  const card = model.tableCard(id);
  if (!card?.mana) return { ok: false, why: 'no mana on the card' };
  if (!blocked) return { ok: true, why: '' };
  const tags = String(card.tags || '');
  if (/mana rock/i.test(tags)) return { ok: true, why: 'Mana Rock: spend a spell point to play it past Gradual Ramp' };
  if (/moxen/i.test(tags)) return { ok: true, why: 'Moxen: may be played past Gradual Ramp' };
  return { ok: false, why: 'Gradual Ramp: one Mana Point card a round' };
}

/** Every copy of every card as an instance id, in deck order. */
export function tableInstances(model) {
  const p = model.data.cardcasting;
  const out = [];
  (p?.cards || []).forEach((card, i) => {
    for (let n = 0; n < (Number(card.qty) || 0); n++) out.push(`${i}#${n}`);
  });
  return out;
}

/** The card an instance id stands for, or null. */
export function tableCard(model, id) {
  const m = /^(\d+)#(\d+)$/.exec(String(id || ''));
  if (!m) return null;
  const card = model.data.cardcasting?.cards?.[Number(m[1])];
  if (!card || Number(m[2]) >= (Number(card.qty) || 0)) return null;
  return card;
}

/** Can this card in hand be cast right now, and with what? Advisory. */
export function castCheck(model, id) {
  const p = model.data.cardcasting;
  const t = p.table;
  const card = model.tableCard(id);
  if (!card) return { ok: false, why: 'no such card' };
  const isEffect = String(card.effect || '').trim() !== '';
  const cost = parseInt(String(card.cost || '').trim(), 10);
  const need = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  if (!isEffect) return { ok: true, need: 0, have: 0, mana: true };
  if (!p.manaPool) return { ok: true, need, have: need };
  const colors = String(card.calc?.colors || '');
  const usable = t.mana.filter((m) => {
    if (m.tapped) return false;
    if (!p.mods.coloredMana || !colors) return true;
    const manaCard = model.tableCard(m.id);
    const letters = String(manaCard?.mana || '');
    return [...colors].some((c) => letters.includes(c));
  });
  // Rainbow Efficiency: a two-colour card needs a mana card of each colour.
  let ok = usable.length >= need;
  let why = ok ? '' : `needs ${need} mana in play, has ${usable.length}`;
  if (ok && p.mods.coloredMana && colors.length > 1) {
    const covered = [...colors].every((c) => t.mana.some((m) => !m.tapped && String(model.tableCard(m.id)?.mana || '').includes(c)));
    if (!covered) { ok = false; why = `needs mana of each colour (${colors})`; }
  }
  return { ok, need, have: usable.length, why };
}

/** A shuffle. `this.rng` may be replaced for a deterministic test. */
export function shuffle(model, ids) {
  const out = [...ids];
  const rng = model.rng || Math.random;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function tableLog(model, t, text) {
  t.log = [...(t.log || []), `R${t.round}: ${text}`].slice(-30);
}

export function tableName(model, id) {
  const card = model.tableCard(id);
  if (!card) return id;
  return card.name || card.effect || (card.mana ? `Mana (${card.mana})` : 'card');
}

/**
 * Draw n cards to the hand. A Mana Point card drawn under Mana Pool goes
 * straight to the table (unless Gradual Ramp holds it in hand to be played
 * one a round); Tight Hand stops a draw at the limit; an empty deck under
 * Cooldown reshuffles the discard first (a free action) unless Deckout
 * forbids it. Returns what was drawn, by name.
 */
export function drawCards(model, n, why = 'draw') {
  const p = model.data.cardcasting;
  const t = p.table;
  const k = p.calc;
  const drawn = [];
  const triggered = [];
  for (let i = 0; i < n; i++) {
    if (k.handMax && t.hand.length >= k.handMax) { tableLog(model, t, `hand is full (${k.handMax})`); break; }
    if (!t.deck.length && p.cooldown && !p.mods.deckout && t.discard.length) {
      t.deck = shuffle(model, t.discard);
      t.discard = [];
      tableLog(model, t, 'deck empty — discard shuffled back in');
    }
    if (!t.deck.length) { tableLog(model, t, 'deck is empty — no card to draw'); break; }
    const id = t.deck.shift();
    const card = model.tableCard(id);
    const pureMana = card && !String(card.effect || '').trim() && card.mana;
    if (pureMana && p.manaPool && !p.mods.gradualRamp) {
      t.mana.push({ id, tapped: false });
      drawn.push(`${tableName(model, id)} → table`);
    } else {
      t.hand.push(id);
      drawn.push(tableName(model, id));
    }
    // Grave Peril's clause: drawn with nothing else in deck or hand.
    if (/\[\s*on\s*draw\s*\]/i.test(String(card?.effect || ''))) triggered.push(id);
    if (t.counters?.id === id && !t.counters.drawn) {
      t.counters.drawn = true;
      const { early, late } = t.counters;
      const branch = early > 0 ? `Early counters (${early}): discard the top ${2 * early} cards of the deck, then remove them`
        : late > 0 ? `Late counters (${late}): take Life Draw × ${2 * late} damage, then remove them`
          : 'no counters: a free-action ranged attack with every erratic blast';
      tableLog(model, t, `[Ante] ${tableName(model, id)} drawn — ${branch}`);
    }
  }
  if (drawn.length) tableLog(model, t, `${why}: ${drawn.join(', ')}`);
  for (const id of triggered) tableTrigger(model, id, 'draw');
  return drawn;
}

/** Initiative: build the deck from every copy, shuffle, draw the opening hand. */
export function tableStart(model) {
  const p = model.data.cardcasting;
  if (!p) return model;
  const t = p.table;
  const k = p.calc;
  Object.assign(t, {
    active: true, round: 1, redraws: 0, manaPlayed: 0,
    deck: shuffle(model, model.tableInstances()), hand: [], play: [], mana: [], discard: [], exile: [],
    stun: [], wounds: [], death: [], faceDown: [], log: [], counters: null, lastRoll: null, lastTrigger: '',
  });
  const loaded = 2 * (k.loadedHand || 0);
  tableLog(model, t, `encounter begins — ${t.deck.length} cards shuffled`);
  drawCards(model, k.openingHand + loaded, `opening hand (${k.openingHand}${loaded ? ` + ${loaded} Loaded Hand` : ''})`);
  return model.recompute();
}

/** Shuffle the hand back and draw one fewer -- the same number the first time with Mulligan. */
export function tableRedraw(model) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  const k = p.calc;
  const size = t.hand.length + (t.round === 1 ? t.mana.length : 0);
  const mulligan = t.redraws === 0 && (p.manipulations || []).some((m) => /^mulligan/i.test(m.name) && m.count > 0);
  const next = Math.max(0, mulligan ? size : size - 1);
  if (size <= 1) { tableLog(model, t, 'cannot redraw a hand of one'); return model.recompute(); }
  // Mana drawn into play at initiative goes back with the hand.
  const back = [...t.hand];
  t.deck = shuffle(model, [...t.deck, ...t.hand, ...(t.round === 1 ? t.mana.map((m) => m.id) : [])]);
  t.hand = [];
  for (const id of back) tableTrigger(model, id, 'redraw');
  if (t.round === 1) t.mana = [];
  t.redraws += 1;
  tableLog(model, t, `hand shuffled back${mulligan ? ' (Mulligan)' : ''}`);
  drawCards(model, next, `redraw ${t.redraws}`);
  return model.recompute();
}

/** A new round: draw one (not under Exposed Grip), untap Stagnant Pool mana. */
export function tableNextRound(model) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  t.round += 1;
  t.manaPlayed = 0;
  if (p.mods.stagnantPool) for (const m of t.mana) m.tapped = false;
  // Perfect Draw's counters: Early ones tick down each turn; once they are
  // gone and the card is still in the deck, a Late one arrives each turn.
  if (t.counters && !t.counters.drawn) {
    const level = Number(model.data.identity?.level) || 0;
    const maxAnte = 2 + Math.floor(Math.max(0, level - 1) / 4);
    if (t.counters.early > 0) t.counters.early -= 1;
    else if (t.counters.late < maxAnte) t.counters.late += 1;
    tableLog(model, t, `[Ante] ${tableName(model, t.counters.id)}: ${t.counters.early} Early, ${t.counters.late} Late`);
  }
  if (p.mods.exposedGrip) tableLog(model, t, 'round begins — Exposed Grip: no automatic draw');
  else drawCards(model, 1, 'round draw');
  if (p.mods.deckout && !t.deck.length) tableLog(model, t, 'Deckout: the deck is empty — 4 Constitution burn this turn');
  return model.recompute();
}

/** Draw n cards for whatever reason (Rapid Fill, Life Draw, Prize Card…). */
export function tableDraw(model, n = 1, why = 'draw') {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  drawCards(model, Math.max(1, Math.floor(Number(n) || 1)), why);
  return model.recompute();
}

/**
 * Play a card from the hand.
 *
 *   mode 'cast'     the effect resolves at once: the card goes back to the
 *                   deck, or to the discard under Cooldown
 *   mode 'ongoing'  the effect lasts: the card stays in play until resolved
 *   mode 'mana'     a Mana Point card (or the mana half of a fused one) onto
 *                   the table
 *
 * Under Mana Pool the cost is paid from mana in play: Mana Graveyard sends
 * that many Mana Point cards to the discard, Stagnant Pool taps them, and
 * otherwise they simply need to be there. Nothing is refused -- the check
 * is shown beside the card and the player decides.
 */
export function tablePlay(model, id, mode = 'cast') {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  const at = t.hand.indexOf(id);
  if (at < 0) return model;
  const card = model.tableCard(id);
  if (!card) return model;
  const name = tableName(model, id);

  if (mode === 'mana') {
    const may = manaPlayCheck(model, id, !!(p.mods.gradualRamp && t.manaPlayed >= 1));
    if (!may.ok) { tableLog(model, t, `${name} not played — ${may.why}`); return model.recompute(); }
    t.hand.splice(at, 1);
    t.mana.push({ id, tapped: false });
    t.manaPlayed += 1;
    tableLog(model, t, `${name} played as mana${may.why ? ` (${may.why})` : ''}`);
    return model.recompute();
  }
  t.hand.splice(at, 1);

  // A trap: face down in play until it springs. Nothing is paid yet.
  if (mode === 'trap') {
    t.play.push(id);
    t.faceDown.push(id);
    tableLog(model, t, `a card set face down${hasDeckFeat(model, /trap card/i) ? '' : ' (Trap Card is not among the deck feats)'}`);
    return model.recompute();
  }

  // Pay for it, where paying means anything.
  const check = castCheck(model, id);
  const cost = check.need || 0;
  if (p.manaPool && cost > 0 && (p.manaGraveyard || p.mods.stagnantPool)) {
    const colors = String(card.calc?.colors || '');
    const eligible = (m) => !m.tapped && (!p.mods.coloredMana || !colors
      || [...colors].some((c) => String(model.tableCard(m.id)?.mana || '').includes(c)));
    let left = cost;
    // Colour-matching mana first, one of each colour a multi-colour card wants.
    const order = [...t.mana].sort((a, b) => (eligible(b) ? 1 : 0) - (eligible(a) ? 1 : 0));
    const spent = [];
    for (const m of order) {
      if (left <= 0) break;
      if (!eligible(m)) continue;
      spent.push(m);
      left -= 1;
    }
    if (p.manaGraveyard) {
      t.mana = t.mana.filter((m) => !spent.includes(m));
      t.discard.push(...spent.map((m) => m.id));
    } else for (const m of spent) m.tapped = true;
    tableLog(model, t, `${name} cast for ${cost}${check.ok ? '' : ` — ${check.why}`}; ${spent.length} mana ${p.manaGraveyard ? 'to the discard' : 'tapped'}`);
  } else {
    tableLog(model, t, `${name} cast${cost ? ` for ${cost}` : ''}${check.ok ? '' : ` — ${check.why}`}`);
  }

  // The spell points themselves, from the tracker if there is one.
  if (cost > 0) spendSP(model, cost, name);
  // Its dice, if it has any.
  rollFor(model, id);

  // Keywords in the card's text fire as it is cast.
  const fate = tableKeywords(model, id, card);
  if (mode === 'ongoing') t.play.push(id);
  else tableSettle(model, id, fate);
  return model.recompute();
}

/**
 * Retrace: cast a card straight from the discard pile, for one spell point
 * more (or a longer casting time -- the player's choice; the point is
 * charged here, and Spend 1 SP can be left alone if time was paid instead).
 * The card is paid for, rolled and its keywords fire, and it returns to the
 * discard, since it was never in the hand.
 */
export function tableRetrace(model, id) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  const at = t.discard.indexOf(id);
  if (at < 0) return model;
  const card = model.tableCard(id);
  if (!card) return model;
  t.discard.splice(at, 1);
  const name = tableName(model, id);
  const cost = parseInt(String(card.cost || '').trim(), 10) || 0;
  tableLog(model, t, `Retrace: ${name} cast from the discard${cost ? ` for ${cost}` : ''} + 1 spell point`);
  spendSP(model, cost + 1, `${name} (Retrace)`);
  rollFor(model, id);
  const fate = tableKeywords(model, id, card);
  if (fate && fate !== 'deck') tableSettle(model, id, fate);
  else t.discard.push(id);
  return model.recompute();
}

/** Read the Cards: the top card to the bottom of the deck, for a spell point. */
export function tableBury(model, id) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  if (t.deck[0] !== id && !t.deck.slice(0, 3).includes(id)) return model;
  t.deck = t.deck.filter((x) => x !== id);
  t.deck.push(id);
  tableLog(model, t, `Read the Cards: ${tableName(model, id)} to the bottom of the deck`);
  spendSP(model, 1, 'Read the Cards');
  return model.recompute();
}

/** Roll a card's dice as part of casting it, if it has any; quiet otherwise. */
export function rollFor(model, id) {
  const card = model.tableCard(id);
  if (!card) return;
  if (model.cardRolls(card).length) model.tableRoll(id, { quiet: true });
}

/**
 * Keywords in square brackets on a card do table things when it is cast:
 *
 *   [Draw N]      draw N                    [Mill N]    top N of the deck to the discard
 *   [Discard N]   discard N (you choose)    [Peek N]    Read the Cards
 *   [Shuffle]     the discard into the deck [Untap]     untap every Mana Point card
 *   [Tap N]       tap N Mana Point cards    [Wild]      Wild Card: search the deck
 *   [Exile]       this card is exiled       [Bottom]    …goes to the bottom of the deck
 *   [Return]      …returns to the hand      [Top]       …goes on top of the deck
 *
 * The ones that stand in for a deck manipulation want it taken: [Peek] Read
 * the Cards, [Wild] Wild Card, [Exile] Impulse or Control Caster, [Return]
 * Recollection. Otherwise the keyword is logged and skipped rather than
 * refused outright -- the table says what it did not do.
 * Returns where the card itself should end up, if a keyword said.
 */
export function tableKeywords(model, id, card) {
  const p = model.data.cardcasting;
  const t = p.table;
  let fate = null;
  const text = String(card.effect || '');
  const re = /\[\s*(draw|discard|shuffle|tap|untap|mill|peek|wild|exile|bottom|top|return|deck|ante)\s*(\d+)?\s*\]/gi;
  // What a card does to itself -- exile, bottom, top, return -- is its own
  // rule; only the keywords that stand in for a manipulation want it taken.
  const may = {
    peek: [() => hasManipulation(model, /^read the cards/i), 'Read the Cards'],
    wild: [() => hasManipulation(model, /^wild ?card/i), 'Wild Card'],
  };
  let m;
  while ((m = re.exec(text))) {
    const kw = m[1].toLowerCase();
    const n = Math.max(1, Number(m[2]) || 1);
    if (may[kw] && !may[kw][0]()) { tableLog(model, t, `[${kw}] skipped — needs ${may[kw][1]}`); continue; }
    switch (kw) {
      case 'draw': drawCards(model, n, `[Draw ${n}]`); break;
      case 'discard': tableLog(model, t, `[Discard ${n}]: choose ${n} card${n === 1 ? '' : 's'} in hand to discard`); break;
      case 'shuffle':
        if (p.cooldown && t.discard.length && !p.mods.deckout) { t.deck = shuffle(model, [...t.deck, ...t.discard]); tableLog(model, t, `[Shuffle]: ${t.discard.length} from the discard into the deck`); t.discard = []; } else { t.deck = shuffle(model, t.deck); tableLog(model, t, '[Shuffle]: deck shuffled'); }
        break;
      case 'tap': { let left = n; for (const x of t.mana) { if (left && !x.tapped) { x.tapped = true; left--; } } tableLog(model, t, `[Tap ${n}]`); break; }
      case 'untap': for (const x of t.mana) x.tapped = false; tableLog(model, t, '[Untap]: all mana untapped'); break;
      case 'mill': {
        const gone = t.deck.splice(0, n);
        t.discard.push(...gone);
        tableLog(model, t, `[Mill ${n}]: ${gone.map((g) => tableName(model, g)).join(', ') || 'nothing'}`);
        for (const g of gone) tableTrigger(model, g, 'mill');
        break;
      }
      case 'peek': tableLog(model, t, `[Peek ${n}]: ${model.tablePeek(n).map((g) => tableName(model, g)).join(', ') || 'deck is empty'}`); break;
      case 'wild': tableLog(model, t, '[Wild]: search the deck for a card — move it to the hand'); break;
      case 'exile': fate = 'exile'; break;
      case 'bottom': fate = 'deckBottom'; break;
      case 'top': fate = 'deckTop'; break;
      case 'return': fate = 'hand'; break;
      case 'deck': fate = 'deck'; break;
      case 'ante': {
        // Perfect Draw: shuffle back in with Early counters equal to the
        // maximum ante (2 + 1 per 4 levels past 1st); a second cast, once
        // drawn again, exiles it.
        if (t.counters?.id === id && t.counters.drawn) {
          fate = 'exile';
          t.counters = null;
          tableLog(model, t, `[Ante] ${tableName(model, id)} played after its draw — exiled`);
        } else {
          const level = Number(model.data.identity?.level) || 0;
          const maxAnte = 2 + Math.floor(Math.max(0, level - 1) / 4);
          t.counters = { id, early: maxAnte, late: 0, drawn: false };
          fate = 'deck';
          tableLog(model, t, `[Ante] ${tableName(model, id)} shuffled back with ${maxAnte} Early counters`);
        }
        break;
      }
      default: break;
    }
  }
  return fate;
}

/**
 * A card's trigger tags: [OnMill], [OnRedraw], [OnDraw], [OnDiscard],
 * [OnExile] mark the sentence that applies when that happens to the card.
 * The table logs it and keeps it in `lastTrigger` for the header.
 */
export function tableTrigger(model, id, when) {
  const t = model.data.cardcasting?.table;
  const card = model.tableCard(id);
  if (!t || !card) return;
  const re = new RegExp(`\\[\\s*on\\s*${when}\\s*\\]\\s*([^\\n]*)`, 'i');
  const m = re.exec(String(card.effect || ''));
  if (!m) return;
  const sentence = m[1].trim().slice(0, 220);
  const line = `⚡ ${tableName(model, id)} (${when}): ${sentence}`;
  t.lastTrigger = line;
  tableLog(model, t, line);
}

/** A resolved card goes home: the discard under Cooldown, else back into the deck -- unless a keyword said otherwise. */
export function tableSettle(model, id, fate = null) {
  const p = model.data.cardcasting;
  const t = p.table;
  if (fate === 'exile') { t.exile.push(id); tableLog(model, t, `${tableName(model, id)} exiled`); tableTrigger(model, id, 'exile'); return; }
  if (fate === 'deck') { t.deck = shuffle(model, [...t.deck, id]); return; }
  if (fate === 'deckBottom') { t.deck.push(id); return; }
  if (fate === 'deckTop') { t.deck.unshift(id); return; }
  if (fate === 'hand') { t.hand.push(id); tableLog(model, t, `${tableName(model, id)} returns to the hand`); return; }
  if (p.cooldown) t.discard.push(id);
  else t.deck = shuffle(model, [...t.deck, id]);
}

/** An ongoing effect ends, or a trap springs: its card leaves play. */
export function tableResolve(model, id) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  const at = t.play.indexOf(id);
  if (at < 0) return model;
  t.play.splice(at, 1);
  const wasTrap = t.faceDown.includes(id);
  t.faceDown = t.faceDown.filter((x) => x !== id);
  const card = model.tableCard(id);
  // A trap that springs is cast then: it is paid for and its keywords fire now.
  if (wasTrap) {
    const cost = parseInt(String(card?.cost || '').trim(), 10);
    if (cost > 0) spendSP(model, cost, tableName(model, id));
    rollFor(model, id);
  }
  const fate = wasTrap ? tableKeywords(model, id, card) : null;
  tableSettle(model, id, fate);
  tableLog(model, t, `${tableName(model, id)} ${wasTrap ? 'springs' : 'resolved'}`);
  return model.recompute();
}

/**
 * The Spell Points tracker, if the character keeps one -- by name, so a
 * player's own "Spell Points" (or "SP") pool is found however it was made.
 * A tracker's `current` counts what has been spent.
 */
export function spellPointTracker(model) {
  return model.trackers.find((t) => /^spell\s*points?$|^sp$/i.test(String(t.name || '').trim())) || null;
}

/** Spend n spell points from the tracker, if there is one; log it on the table. */
export function spendSP(model, n, why) {
  const t = model.data.cardcasting?.table;
  const sp = model.spellPointTracker();
  if (!sp || !(n > 0)) return null;
  const max = Number(sp.max) || 0;
  const before = Number(sp.current) || 0;
  const after = Math.max(Number(sp.min) || 0, Math.min(max, before + n));
  sp.current = after;
  const left = max - after;
  if (t) tableLog(model, t, `${why}: ${after - before} spell point${after - before === 1 ? '' : 's'} spent, ${left} left${after - before < n ? ' — the pool ran out' : ''}`);
  return left;
}

/** Spend spell points on a card's modal effect (a boost, an extra option). */
export function tableSpend(model, id, n = 1) {
  const p = model.data.cardcasting;
  if (!p?.table) return model;
  if (!model.spellPointTracker()) { tableLog(model, p.table, 'no Spell Points tracker to spend from'); return model.recompute(); }
  spendSP(model, Math.max(1, Math.floor(Number(n) || 1)), id ? `${tableName(model, id)} — extra` : 'spent');
  return model.recompute();
}

/** A face-down trap turned face up, still in play. */
export function tableReveal(model, id) {
  const t = model.data.cardcasting?.table;
  if (!t || !t.faceDown.includes(id)) return model;
  t.faceDown = t.faceDown.filter((x) => x !== id);
  tableLog(model, t, `${tableName(model, id)} revealed`);
  return model.recompute();
}

/**
 * Roll a card's dice: its Dice field, or the first dice in its text.
 * `4d6+int.mod` rolls four dice and adds the modifier from the sheet.
 */
/**
 * A card's rolls, from its Dice field: several may be listed, separated by
 * ";" or newlines, each optionally labelled -- "8d6; boost: 15d6; milled: 8d4".
 * The first is what a cast rolls on its own; the rest are offered by name.
 * With no Dice field, the first dice in the text is the one roll.
 */
export function cardRolls(model, card) {
  const field = String(card?.dice || '').trim();
  if (field) {
    return field.split(/[;\n]+/).map((part, i) => {
      const m = /^\s*([^:]{1,40}?)\s*:\s*(.+)$/.exec(part);
      const label = m ? m[1].trim() : (i === 0 ? 'roll' : `roll ${i + 1}`);
      const expr = (m ? m[2] : part).trim();
      // "boost (1 SP): 15d6" -- the points a variant costs, spent when it is picked.
      const cost = /\((\d+)\s*sp\)/i.exec(label);
      return expr ? { label, expr, sp: cost ? Number(cost[1]) : 0 } : null;
    }).filter(Boolean);
  }
  const inText = String(card?.effect || '').match(/(?:\{[^{}]*\}|\d+)\s*d\s*\d+(?:\s*[+-]\s*(?:\{[^{}]*\}|[\w.]+))*/i);
  return inText ? [{ label: 'roll', expr: inText[0], sp: 0 }] : [];
}

export function tableRoll(model, id, { quiet = false, which = 0 } = {}) {
  const p = model.data.cardcasting;
  if (!p?.table) return model;
  const t = p.table;
  const card = model.tableCard(id);
  if (!card) return model;
  const done = () => (quiet ? model : model.recompute());
  // Formulas in the dice come first: "{ceil(caster.level/2)}d6" is 8d6 at
  // caster level 15, in the Dice field or in the text.
  const resolved = (text) => model.renderProse(text).map((s) => (s.kind === 'text' ? s.text : s.error ? s.raw : String(s.value))).join('');
  const options = model.cardRolls(card);
  const pick = typeof which === 'number' ? options[which] : options.find((r) => r.label.toLowerCase() === String(which).toLowerCase());
  const source = pick ? resolved(pick.expr) : '';
  const label = pick && pick.label !== 'roll' ? ` (${pick.label})` : '';
  if (!source) { if (!quiet) tableLog(model, t, `${tableName(model, id)}: nothing to roll`); return done(); }
  const scope = model.scope();
  const { dice, flat, error } = parseDiceExpr(source, (rem) => evaluateFormula(rem, scope));
  const rng = model.rng || Math.random;
  const rolls = [];
  let total = flat;
  for (const [sides, count] of Object.entries(dice)) {
    for (let i = 0; i < Math.abs(count); i++) {
      const r = 1 + Math.floor(rng() * Number(sides));
      rolls.push(r);
      total += count < 0 ? -r : r;
    }
  }
  t.lastRoll = { id, source, rolls, flat, total, error: error || null, label: pick?.label || 'roll' };
  tableLog(model, t, `${tableName(model, id)} rolls${label} ${source}: [${rolls.join(', ')}]${flat ? ` ${flat >= 0 ? '+' : '−'} ${Math.abs(flat)}` : ''} = ${total}${error ? ` (${error})` : ''}`);
  return done();
}

/** Spend spell points and roll a named variant in one go -- "boost" for a point more. */
export function tableBoost(model, id, which) {
  const p = model.data.cardcasting;
  if (!p?.table) return model;
  const roll = model.cardRolls(model.tableCard(id)).find((r) => r.label.toLowerCase() === String(which).toLowerCase());
  if (!roll) return model;
  if (roll.sp > 0 && model.spellPointTracker()) spendSP(model, roll.sp, `${tableName(model, id)} — ${roll.label}`);
  return model.tableRoll(id, { which });
}

/**
 * Move one card between zones by hand -- discard from the hand (Bleeding
 * Hand, Into Nothing), return from the discard (Recollection, Resupply),
 * exile (Impulse), the Lifebound piles, or just putting right a misclick.
 * `to` is a zone name; 'deck' shuffles it in, 'deckTop' puts it on top.
 */
export function tableMove(model, id, to) {
  const p = model.data.cardcasting;
  if (!p?.table) return model;
  const t = p.table;
  let from = null;
  for (const zone of ['deck', 'hand', 'play', 'discard', 'exile', 'stun', 'wounds', 'death']) {
    const at = t[zone].indexOf(id);
    if (at >= 0) { t[zone].splice(at, 1); from = zone; }
  }
  const mi = t.mana.findIndex((m) => m.id === id);
  if (mi >= 0) { t.mana.splice(mi, 1); from = 'mana'; }
  if (!from) return model;
  if (to === 'mana') t.mana.push({ id, tapped: false });
  else if (to === 'deck') t.deck = shuffle(model, [...t.deck, id]);
  else if (to === 'deckTop') t.deck.unshift(id);
  else if (to === 'deckBottom') t.deck.push(id);
  else if (t[to]) t[to].push(id);
  else return model.recompute();
  tableLog(model, t, `${tableName(model, id)} → ${to === 'deckTop' ? 'top of deck' : to === 'deckBottom' ? 'bottom of deck' : to}`);
  // What the move means to the card: off the top of the deck into the
  // discard is a mill, out of the hand into it a discard, and so on.
  if (to === 'discard' && from === 'deck') tableTrigger(model, id, 'mill');
  else if (to === 'discard' && from === 'hand') tableTrigger(model, id, 'discard');
  else if (to === 'exile') tableTrigger(model, id, 'exile');
  else if ((to === 'deck' || to === 'deckTop' || to === 'deckBottom') && from === 'hand') tableTrigger(model, id, 'redraw');
  return model.recompute();
}

/** Exile n cards at random from the discard (Blood and Dust, Grave Peril). */
export function tableExileRandom(model, n = 1) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  const rng = model.rng || Math.random;
  const gone = [];
  for (let i = 0; i < n && t.discard.length; i++) {
    const at = Math.floor(rng() * t.discard.length);
    gone.push(t.discard.splice(at, 1)[0]);
  }
  if (!gone.length) return model;
  t.exile.push(...gone);
  tableLog(model, t, `${gone.length} exiled at random from the discard: ${gone.map((g) => tableName(model, g)).join(', ')}`);
  for (const g of gone) tableTrigger(model, g, 'exile');
  return model.recompute();
}

/** Tap or untap a Mana Point card in play (Stagnant Pool). */
export function tableTap(model, id, tapped = null) {
  const p = model.data.cardcasting;
  const m = p?.table?.mana.find((x) => x.id === id);
  if (!m) return model;
  m.tapped = tapped === null ? !m.tapped : !!tapped;
  return model.recompute();
}

/** Cooldown's full-round action: the discard pile shuffled into the deck. */
export function tableShuffleDiscard(model) {
  const p = model.data.cardcasting;
  if (!p?.table?.active) return model;
  const t = p.table;
  if (!t.discard.length) return model;
  t.deck = shuffle(model, [...t.deck, ...t.discard]);
  tableLog(model, t, `${t.discard.length} cards shuffled from the discard into the deck`);
  t.discard = [];
  return model.recompute();
}

/** Read the Cards: the top n of the deck, by id, without moving them. */
export function tablePeek(model, n = 1) {
  return (model.data.cardcasting?.table?.deck || []).slice(0, Math.max(1, n));
}

/** The encounter ends: everything back into the deck, shuffled. */
export function tableEnd(model) {
  const p = model.data.cardcasting;
  if (!p?.table) return model;
  const t = p.table;
  const all = [...t.deck, ...t.hand, ...t.play, ...t.discard, ...t.exile, ...t.mana.map((m) => m.id)];
  const exiled = t.exile.length;
  Object.assign(t, {
    active: false, round: 0, redraws: 0, manaPlayed: 0,
    deck: shuffle(model, all), hand: [], play: [], mana: [], discard: [], exile: [], faceDown: [],
    counters: null, lastRoll: null, lastTrigger: '',
  });
  tableLog(model, t, `encounter over — everything shuffled back${exiled ? ` (${exiled} exiled cards: half return now, the rest one a minute)` : ''}`);
  return model.recompute();
}
