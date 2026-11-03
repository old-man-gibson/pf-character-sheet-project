/**
 * ui/panels/cardcasting.js -- the Cardcasting tab and the card table windows.
 *
 * The deck: what it is worth, the drawback ladder, the deck manipulations,
 * the land-attuned spheres, the cards and the sideboard, with each squad
 * member's deck beside the character's. The table: an encounter in play,
 * drawn on the tab and, through `cardTableView`, in a window of its own --
 * the shared screen, the player's hand, or the GM's control view.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, ABILITY_LABELS_LIST, imageSrc } from '../html.js';
import { prose, renderedProse } from '../prose.js';
import { D20_ICON } from '../roll.js';
import { DEFAULT_ROLL_FORMAT, rollText } from '../../roll20.js';
import {
  CARD_COLORS, CARD_MODIFICATIONS, CARD_KEYWORDS, DECK_SORTS, LIFEBOUND_PILES, TABLE_DESTINATIONS,
  cardKeywordPattern, deckOrder, harrowFor, hasManipulation, manipulationCount, redrawSize, manipulationEntry,
  manipulationFoldKey, deckManipulationCatalogue, MANIPULATION_NEEDS, slug,
} from '../../model.js';
import {
  CARD_CASTING_TIMES, CARD_DAMAGE_TYPES, CARD_DURATIONS, CARD_RANGES, CARD_SAVES, CARD_STAT_FIELDS,
  CARD_TARGETS, TERRAIN_CHOICES, stepCastingTime,
} from '../../model/subsystems/cardcasting.js';
import { fmt } from '../../rules.js';
import { COMPANION_LABELS } from '../../companions.js';
import { hasTokens } from '../../inline.js';
import { check, field, postBox, select, text } from '../fields.js';
import {
  addButton, collapsible, exprField, foldButton, isCollapsed, itemNum, itemSelect, itemText, line, lineHtml,
  removeButton,
} from '../rows.js';
import { systemExtrasPanel } from './system-tabs.js';

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
const KEYWORD_RE = cardKeywordPattern({ triggers: true });

/** The number the hint shows beside a keyword that takes one. */
const KEYWORD_EXAMPLE = { draw: 2, mill: 3, tap: 2 };

export function markKeywords(html) {
  return String(html).replace(KEYWORD_RE, (m, kw, n) => {
    const word = kw.toLowerCase().replace(/^on\s*/, 'on ');
    const trigger = word.startsWith('on ');
    const label = word.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
    return `<span class="kw${trigger ? ' trig' : ''}" title="${trigger ? 'Trigger: fires when this happens to the card' : 'Fires when the card is cast'}">${trigger ? '⚡ ' : ''}${label}${n ? ` ${n.trim()}` : ''}</span>`;
  });
}

export function cardFrameStyle(colors) {
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

  /** A run of mana letters as coloured chips; a dash for none. */
function manaChips(letters, none = '—') {
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
export function cardcastingPanel(model, ctx) {
    const p = model.data.cardcasting;
    if (!p) return '<div class="grid"><p class="empty">No card casting data.</p></div>';
    const k = p.calc || {};
    const t = p.table || {};

    // Which deck is open: the character's ('deck') or a squad member's
    // ('deck:<id>'); a member the deck no longer knows falls back to the
    // character's. Each caster's deck has a view of its own.
    const squad = k.squad || [];
    const me = shortName(model.casterInfo('').name, model.data.identity?.nickname);
    const want = String(ctx.deckView || '');
    const memberView = want.startsWith('deck:') ? squad.find((m) => m.id === want.slice(5)) || null : null;
    const own = memberView ? memberView.id : '';
    const deckBadge = (d) => `<span class="badge">${d.deckSize ?? 0}</span>${d.issues?.length ? ` <span class="badge err" title="${esc(d.issues.join('\n'))}">${d.issues.length}</span>` : ''}`;
    const views = `<nav class="subtabs" role="tablist" aria-label="Cardcasting views">
      <button data-view role="tab" data-deck-view="table" aria-selected="${ctx.deckView === 'table'}">The table${t.active ? ` <span class="badge">round ${t.round}</span>` : ''}</button>
      <button data-view role="tab" data-deck-view="deck" aria-selected="${ctx.deckView !== 'table' && !memberView}">${squad.length ? `${esc(me)}’s deck` : 'The deck'} ${deckBadge(k)}</button>
      ${squad.map((m) => `<button data-view role="tab" data-deck-view="deck:${esc(m.id)}" aria-selected="${memberView?.id === m.id}">${esc(m.name)}’s deck ${deckBadge(m.deck || {})}</button>`).join('')}
    </nav>`;
    if (ctx.deckView === 'table') return `${views}<div class="grid">${tablePanel(model, ctx, p, k)}</div>`;

    // A member's deck: the other decks at a glance, what this one is and how
    // it checks, its own manipulations, its cards and its sideboard. The
    // ladder, the land-attuned table and the notes are the character's.
    if (memberView) {
      return `${views}<div class="grid">
      ${otherDecksPanel(model, p, k, own)}
      ${memberDeckPanel(model, p, k, memberView)}
      <div class="foldstrip">${deckManipulationsHead(model, p, k, own)}</div>
      ${deckManipulationsPanel(model, p, k, own)}
      ${cardDatalists(p)}
      ${deckTablePanel(model, ctx, p, k, own)}
      ${sideboardPanel(model, ctx, p, own)}
    </div>`;
    }

    /*
     * The deck view is long -- the summary, the drawback ladder, four groups
     * of manipulations, the colour table, then the deck itself -- and most of
     * it is settled at build time and never touched again. So every group
     * that is a *decision already made* folds, and the fold state rides in
     * uiPrefs with the character like every other one on the sheet. The deck
     * table and the sideboard do not: they are the list you came here to
     * read.
     */
    const wrap = (key, html) => collapsible(model, key, html);
    // The three that head the view sit in a strip, so folding them turns three
    // full rows into one row of pills rather than three half-empty rows. The
    // colour table gets a strip of its own because the manipulations sit
    // between: it is alone on its row either way, and in a strip it at least
    // shrinks to its header instead of holding a row open.
    return `${views}<div class="grid">
      ${otherDecksPanel(model, p, k, '')}
      <div class="foldstrip">
        ${wrap('deck-summary', deckSummaryPanel(p, k))}
        ${wrap('deck-drawback', deckLadderPanel(p, k))}
        ${deckManipulationsHead(model, p, k, '')}
      </div>
      ${deckManipulationsPanel(model, p, k, '')}
      <div class="foldstrip">${wrap('deck-land', landAttunedPanel(p, k))}</div>
      ${squad.length ? wrap('deck-squad', squadPanel(model, p, k, ctx)) : ''}
      ${cardDatalists(p)}
      ${deckTablePanel(model, ctx, p, k, '')}
      ${sideboardPanel(model, ctx, p, '')}
      <section class="panel span2">
        <h3>Notes</h3>
        ${prose(model, 'data-set="cardcasting.notes"', p.notes, 3)}
      </section>
      ${systemExtrasPanel(model, p, 'cardcasting', 'Cardcaster Deck')}
    </div>`;
  }

  /**
   * The other decks at a glance, at the top of every deck view when there is
   * a squad: whose, how big, its colours, whether it is legal, its
   * manipulations, its Rainbow Efficiency, whether it is at the table -- and
   * a button that opens it.
   */
function otherDecksPanel(model, p, k, own) {
    const squad = k.squad || [];
    if (!squad.length) return '';
    const present = new Set(p.table?.squad || []);
    const me = {
      id: '', name: shortName(model.casterInfo('').name, model.data.identity?.nickname), colors: k.colorsInPlay || '', deck: k, rainbow: k.rainbow, ok: true,
      manipulationsTaken: k.manipulationsTaken, manipulationsAvailable: k.manipulationsAvailable,
    };
    const rows = [me, ...squad].filter((o) => o.id !== own);
    return `<section class="panel span2 otherdecks">
      <h3>Other decks <span class="badge">${rows.length}</span></h3>
      ${rows.map((o) => `<div class="squadrow">
        <div class="what"><strong>${esc(o.name)}</strong>
          <span class="badge">${o.deck?.deckSize ?? 0} cards</span>
          ${manaChips(o.colors, '')}
          ${o.deck?.issues?.length ? `<span class="badge err" title="${esc(o.deck.issues.join('\n'))}">${o.deck.issues.length} to look at</span>` : '<span class="badge ok">legal</span>'}
          <span class="badge">${o.manipulationsTaken ?? 0} of ${o.manipulationsAvailable ?? 0} manipulations</span>
          ${o.rainbow ? `<span class="badge">${o.rainbow === 2 ? 'Improved ' : ''}Rainbow Efficiency</span>` : ''}
          ${o.id ? (o.ok ? (present.has(o.id) ? '<span class="badge ok">at the table</span>' : '') : `<span class="badge err" title="${esc(o.why || '')}">cannot combine</span>`) : ''}
        </div>
        <div><button data-deck-view="${o.id ? `deck:${esc(o.id)}` : 'deck'}" title="${esc(`Open ${o.name}'s deck`)}">Open</button></div>
      </div>`).join('')}
    </section>`;
  }

  /**
   * A squad member's deck at the head of its view: its numbers, its colours
   * and switches (read off the tradition on its own tab), and how the deck
   * checks against its own casting modifier, colours and feats.
   */
function memberDeckPanel(model, p, k, m) {
    const d = m.deck || {};
    const issues = d.issues || [];
    const tally = d.colorTally || {};
    const inPlay = String(m.colors || '').split('').filter(Boolean);
    const sw = m.switches || {};
    const ladder = [['cooldown', 'Cooldown'], ['manaPool', 'Mana Pool'], ['manaGraveyard', 'Mana Graveyard'], ...CARD_MODIFICATIONS.map((x) => [x.key, x.label])];
    const taken = ladder.filter(([key]) => sw[key]).map(([, label]) => label);
    return `<section class="panel span2">
      <h3>${esc(m.name)}’s deck
        <span class="badge">${d.deckSize ?? 0} cards</span>
        ${m.casts ? `<span class="badge">CL ${m.cl} · mod ${fmt(m.mod)}</span>` : '<span class="badge err" title="Give it the Magical Companion talent or the mage archetype">does not cast</span>'}
        <span class="badge">opening hand ${Math.max(2, 1 + (Number(m.mod) || 0))}</span>
        <span class="badge ${m.ok ? 'ok' : 'err'}" title="${esc(m.why || 'Card Casting, with the same switches as yours')}">${m.ok ? 'combines' : m.cardCasting ? 'switches differ' : 'no Card Casting'}</span>
        <span class="badge ${issues.length ? 'err' : 'ok'}">${issues.length ? `${issues.length} to look at` : 'deck is legal'}</span>
      </h3>
      <p class="hint">A squad member’s deck, built here and read against its own casting modifier, colours and feats.
        Its switches and its colours come from the casting tradition on its own tab${m.kind ? ` (${esc(COMPANION_LABELS[m.kind] || m.kind)})` : ''};
        its deck feats and Rainbow Efficiency from its feats. It shuffles in with yours while it is at the table.</p>
      ${lineHtml('Colours', inPlay.length ? manaChips(m.colors, '') : esc('none named — write “Colored Mana (WGB)” on its tradition'))}
      ${line('Switches', taken.length ? taken.join(', ') : 'none')}
      ${line('Identical-effect spread', `${d.spreadMin ?? 0}–${d.spreadMax ?? 0} copies (may differ by up to ${Number(m.mod) || 0})`)}
      ${line('Effect cards', `${d.effectCards ?? 0} — ${(d.effects || []).length} distinct effect${(d.effects || []).length === 1 ? '' : 's'}`)}
      ${line('Mana point cards', `${d.manaCards ?? 0}${d.fused ? ` (${d.fused} fused onto an effect)` : ''}`)}
      ${inPlay.length ? `<div class="tally">${inPlay.map((c) => `<span class="t">${manaChips(c)}
        <span class="n">${tally[c]?.effects ?? 0}</span> effect${(tally[c]?.effects ?? 0) === 1 ? '' : 's'} ·
        <span class="n">${tally[c]?.mana ?? 0}</span> mana</span>`).join('')}</div>` : ''}
      ${issues.length ? `<ul class="deckcheck hint warn" style="margin:8px 0 0 1.1rem;padding:0">
        ${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  /** A card's cost as a zone shows it: the cost to pay, with the typed figure and the Rainbow Efficiency discount on hover. */
function costMark(card) {
    const typed = String(card.cost ?? '').trim();
    if (!typed) return '';
    const off = Number(card.calc?.discount) || 0;
    return off ? `<b title="${esc(`Typed ${typed}; Rainbow Efficiency takes ${off} off`)}">${esc(String(card.calc.cost))}</b>` : `<b>${esc(typed)}</b>`;
  }

  /**
   * A card small enough for a zone: title bar with cost, the type line and
   * the effect, and whatever buttons the zone offers. Same frame rules as
   * the full face.
   */
function cardMini(model, id, { buttons = '', badge = '', tapped = false, open = false, formulas = [], extra = '', locked = false } = {}) {
    const card = model.tableCard(id);
    if (!card) return '';
    // Locked: another's card on the GM's page -- shown, never pressed.
    if (locked) buttons = '';
    const r = card.calc || {};
    const colors = String(r.colors || '');
    const frameClass = r.artifact ? 'A' : colors.length === 1 ? esc(colors) : colors.length ? 'multi' : 'C';
    const isMana = !String(card.effect || '').trim() && card.mana;
    // Opened out, the text is no longer clamped and the card's rolls are
    // listed under it, worked out: what a reader wants of a card in hand.
    const rolls = open && formulas.length ? `<div class="rolls">${formulas.map((f) => `<span class="roll"><b>${esc(f.label)}</b> ${esc(f.formula || f.source)}${f.sp ? ` <small>${f.sp} SP</small>` : ''}</span>`).join('')}</div>` : '';
    return `<div class="mcard mini ${frameClass}${tapped ? ' tapped' : ''}${open ? ' open' : ''}" style="${r.artifact ? '' : esc(cardFrameStyle(colors))}" data-card="${esc(id)}">
      <div class="bar title">
        ${ownerTag(model, card)}<span class="name">${esc(card.name || (isMana ? 'Mana Point' : card.effect || 'card'))}</span>
        <span class="cost">${costMark(card)}${manaChips(colors, '')}</span>
        ${expandBtn(id, open)}
      </div>
      ${String(card.subtitle || '').trim() ? `<div class="bar sub subtitle"><span>${esc(card.subtitle)}</span></div>` : ''}
      ${imageSrc(card.art) ? `<div class="art"><img src="${esc(imageSrc(card.art))}" alt="" loading="lazy"></div>` : ''}
      <div class="bar type"><span>${esc(card.sphere || (isMana ? 'Mana Point' : ''))}${card.tags ? ` — ${esc(card.tags)}` : ''}</span></div>
      ${statsLine(model, card)}
      ${String(card.effect || '').trim() ? `<div class="text">${markKeywords(hasTokens(card.effect) ? renderedProse(model, card.effect) : esc(card.effect))}</div>` : ''}
      ${rolls}
      ${extra}
      <div class="foot">
        ${card.mana ? `<span class="pair" title="Mana this card carries">${manaChips(card.mana, '')}</span>` : ''}
        ${badge}
        <span class="pair tools">${buttons}</span>
      </div>
    </div>`;
  }

  /**
   * The character's name short enough for a pick list or a heading: the
   * Nickname field when it is filled, else a nickname in quotes in the name
   * (Alexander "Sandy" Reyes is Sandy), else the first word.
   */
function shortName(name, nickname = '') {
    if (String(nickname || '').trim()) return String(nickname).trim();
    const s = String(name || '').trim();
    const nick = /["“]([^"”]+)["”]/.exec(s);
    return nick ? nick[1].trim() : (s.split(/\s+/)[0] || 'you');
  }

  /** A squad member's card wears its owner's initial, so the borrowed cards read as borrowed. */
function ownerTag(model, card) {
    const owner = model.cardOwner(card);
    if (!owner) return '';
    const member = (model.data.cardcasting?.calc?.squad || []).find((m) => m.id === owner);
    const name = member?.name || owner;
    return `<span class="owner" title="${esc(`${name}'s card`)}">${esc(name.trim().charAt(0).toUpperCase() || '?')}</span>`;
  }

  /** The corner button that opens a card out, or folds it back: the same press wherever the card is. */
function expandBtn(ref, open) {
    return tableBtn('expand', ref, open ? '⤡' : '⤢', { cls: 'expand', title: open ? 'Fold the card back' : 'Open the card out to read and edit it at length' });
  }

  /** A button that drives the table: `data-table="action|id|arg"`. `copy` rides along as the Roll20 text a pop-out window copies on the click. */
function tableBtn(action, id, label, { arg = '', title = '', cls = '', disabled = false, copy = '' } = {}) {
    return `<button class="${cls}" data-table="${esc(action)}|${esc(id)}|${esc(arg)}" title="${esc(title)}"${copy ? ` data-copytext="${esc(copy)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;
  }

  /**
   * The three faces the table is drawn with. The sheet shows everything; the
   * two pop-out windows (see cardTableView) split it so a streamed table
   * never shows the hand.
   */
const TABLE_VIEWS = {
  sheet: { hand: true, field: true, controls: true, secrets: true, windows: true },
  table: { hand: false, field: true, controls: false, secrets: false, windows: false },
  hand: { hand: true, field: false, controls: true, secrets: true, windows: false },
  // The GM's page for one squad member: that member's hand, the whole field
  // as the table window shows it, presses on the member's own cards alone.
  control: { hand: true, field: true, controls: false, secrets: false, windows: false },
};

/**
 * The Roll20 text for a card, ready to copy: a d20 beside the card. The
 * sheet copies it through the element (`data-roll`, with the toast and the
 * format switch); a pop-out window has no element and copies the text the
 * button carries (`data-copytext`). Both read the same spec.
 */
function cardCopyButton(model, ctx, ref, what) {
    const spec = model.cardRollSpec(ref);
    const text = spec ? rollText(spec, ctx.rollFormat || DEFAULT_ROLL_FORMAT) : '';
    if (!text) return '';
    const shown = spec.rolls.slice(0, 3).map((r) => r.formula).join(' · ') || 'the card as text';
    return `<button class="d20" data-roll="card|${esc(ref)}" data-rollwhat="${esc(what)}" data-copytext="${esc(text)}"
      title="${esc(`Copy for Roll20 — ${shown}`)}" aria-label="${esc(`Copy a Roll20 roll for ${what}`)}">${D20_ICON}</button>`;
  }

  /**
   * What every zone reads: the table, its figures, and the small helpers
   * that draw a card's buttons. Worked out once per render and handed to the
   * zone builders, so the sheet and the two windows draw from one state.
   */
function tableState(model, ctx, p, k, view, member = '') {
    const t = p.table || {};
    const tc = t.calc || {};
    const faces = TABLE_VIEWS[view] || TABLE_VIEWS.sheet;
    const sp = model.spellPointTracker();
    const copyText = (id) => (p.copyOnCast ? rollText(model.cardRollSpec(id), ctx.rollFormat || DEFAULT_ROLL_FORMAT) : '');
    const s = {
      model, ctx, p, k, t, tc, view, faces,
      active: !!t.active,
      // What is taken is asked of the model, matched the way the catalogue
      // matches, rather than by a pattern of the panel's own.
      has: (name) => hasManipulation(model, name),
      readTwice: manipulationCount(model, 'Read the Cards') >= 2,
      loaded: 2 * (k.loadedHand || 0),
      redraw: redrawSize(model),
      // Spell points, from the tracker if the character keeps one.
      sp,
      spLeft: sp ? (Number(sp.max) || 0) - (Number(sp.current) || 0) : null,
      faceDown: new Set(t.faceDown || []),
      stagnant: !!p.mods.stagnantPool,
      peeked: faces.secrets ? (ctx.peek || []).filter((id) => (t.deck || []).slice(0, 3).includes(id)) : [],
      castPick: faces.hand ? ctx.castPick || null : null,
      // The squad members at the table right now.
      present: (tc.squad || []).filter((m) => m.present),
      copyText,
      // The member this face is run for (the GM's control page), and whether
      // a card is that member's: only those take presses there.
      member,
    };
    s.mine = (id) => !member || model.cardOwner(model.tableCard(id)) === member;
    // A card opened out: the clamp comes off its text and its rolls are listed.
    s.miniOpts = (id) => {
      const open = !!ctx.openCards?.has?.(id);
      return { open, formulas: open ? model.cardRollFormulas(model.tableCard(id)) : [], locked: !s.mine(id) };
    };
    // +1 SP spends the character's own points, which a GM running a member does not.
    s.spBtn = (id) => (sp && !member ? tableBtn('sp', id, '+1 SP', { arg: 1, title: 'Spend one spell point on this card — a boost, a modal option' }) : '');
    s.copyBtn = (id) => cardCopyButton(model, ctx, id, model.tableCard(id)?.name || 'card');
    s.zoneMoves = (id, from) => {
      const opts = TABLE_DESTINATIONS.filter(([v]) => p.mods.lifeboundDeck || !LIFEBOUND_PILES.includes(v));
      return `<select class="movesel" data-table-move="${esc(id)}" aria-label="Move this card" title="Move this card by hand">
        <option value="">move…</option>${opts.filter(([v]) => v !== from).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>`;
    };
    // 🎲 rolls the card's first dice; when the Dice field names more
    // ("boost (1 SP): 15d6; milled: 8d4"), a picker offers them and spends
    // what the label says.
    s.rollBtn = (id, card) => {
      const rolls = model.cardRolls(card);
      if (!rolls.length) return '';
      const first = tableBtn('roll', id, '🎲', { title: `Roll ${rolls[0].expr}` });
      if (rolls.length === 1) return first;
      return `${first}<select class="movesel rollsel" data-table-roll="${esc(id)}" aria-label="Other rolls" title="Other rolls on this card">
        <option value="">roll…</option>
        ${rolls.slice(1).map((r) => `<option value="${esc(r.label)}" title="${esc(r.expr)}">${esc(r.label)}</option>`).join('')}
      </select>`;
    };
    s.listZone = (ids, from, extra = () => '') => (ids || []).map((id) => {
      const card = model.tableCard(id);
      return `<div class="zonerow" data-card="${esc(id)}">
        ${manaChips(String(card?.calc?.colors || ''), '')}
        <span class="zname">${esc(card?.name || card?.effect || 'card')}</span>
        <span class="zsub">${esc(card?.effect || (card?.mana ? `Mana ${card.mana}` : ''))}</span>
        <span class="pair tools">${s.mine(id) ? `${extra(id)}${s.zoneMoves(id, from)}` : ''}</span>
      </div>`;
    }).join('');
    return s;
  }

  /**
   * The head of the table: the round and its figures, the last roll and the
   * last trigger, and -- where this face drives the game -- the controls the
   * rules give: start, redraw, next round, draw, shuffle the discard back,
   * end. The sheet's face also opens the two windows and keeps the Roll20
   * switch.
   */
function tableHead(s) {
    const { p, k, t, tc, active, has, readTwice, loaded, redraw, sp, spLeft, stagnant, faces, model } = s;
    const controls = !faces.controls ? '' : active ? `
        ${tableBtn('next', '', 'Next round', { title: p.mods.exposedGrip ? 'Exposed Grip: no automatic draw' : 'Draw one card' + (p.mods.stagnantPool ? '; untap Stagnant Pool mana' : ''), cls: 'primary' })}
        ${tableBtn('draw', '', 'Draw a card', { title: 'Rapid Fill, Life Draw, Prize Card, Primed Hand — any draw the rules hand you' })}
        ${tableBtn('redraw', '', `Redraw hand → ${redraw.next}`, { title: 'Shuffle the hand back and draw one fewer' + (has('Mulligan') ? ' (Mulligan: the same number the first time)' : ''), disabled: redraw.size <= 1 })}
        ${p.cooldown ? tableBtn('shuffle', '', 'Shuffle discard in', { title: 'A full-round action: the discard pile shuffled into the deck', disabled: !(t.discard?.length) }) : ''}
        ${has('Read the Cards') ? tableBtn('peek', '', `Read the cards (${readTwice ? 3 : 1})`, { arg: readTwice ? 3 : 1, title: 'Look at the top of the deck' }) : ''}
        ${sp ? tableBtn('sp', '', 'Spend 1 SP', { arg: 1, title: 'A spell point on something the cards do not know about — Retrace, Read the Cards, Fresh Hand…' }) : ''}
        ${tableBtn('end', '', 'End encounter', { title: 'Everything shuffled back into the deck', cls: 'danger' })}`
      : `${tableBtn('start', '', `Start encounter — draw ${k.openingHand ?? 2}${loaded ? ` + ${loaded}` : ''}`, { title: 'Shuffle every copy in the deck and draw the opening hand', cls: 'primary', disabled: !(k.deckSize > 0) })}`;
    // The squad: each member in or out of the table, with its deck. A press
    // is the player's, so the roster is drawn where the controls are; the
    // shared screen only sees who is in.
    const roster = (tc.squad || []).filter((m) => m.ok || m.present);
    const squad = !roster.length ? '' : faces.controls
      ? `<span class="pair squadctl" title="Multi-Headed Play: a member at the table has its deck shuffled in with yours, and may cast any card in the hand">
          ${roster.map((m) => tableBtn('squad', m.id, `${m.present ? '✓' : '○'} ${esc(m.name)}${s.ctx?.grants?.[m.id] ? ' <small title="handed to the GM">⚑</small>' : ''} <small>${m.cards}</small>`, { cls: m.present ? 'primary' : '', title: m.present ? `${m.name} is at the table: ${m.cards} cards in the deck — press to send ${m.name} away` : `Press when ${m.name} is summoned: ${m.cards} cards join the deck` }))}
        </span>`
      : '';
    // The two windows and the Roll20 switch: the sheet's own, since a window
    // opens from the page that owns the character.
    const windows = !faces.windows ? '' : `<span class="pair winctl">
        ${tableBtn('window', 'table', '⧉ Table window', { title: 'The table in its own window, for the screen you share: in play, mana, the piles and the log — never the hand' })}
        ${tableBtn('window', 'hand', '⧉ Hand window', { title: 'Your hand in its own window, for a screen you do not share: the hand, the controls and the top of the deck' })}
        ${check('cardcasting.copyOnCast', p.copyOnCast, 'Copy for Roll20 on cast', 'Every Cast, Ongoing, Spring and Retrace also puts the card on the clipboard as a Roll20 message — paste it into chat')}
      </span>`;

    const notes = [];
    if (model.terrainCasting()) {
      const freedom = model.terrainFreedom();
      notes.push(freedom
        ? `Terrain Casting is on the tradition, and ${freedom} ignores it: no cast pays it.`
        : 'Terrain Casting: every cast pays one spell point more, or a casting-time step, or blights your square and the eight around it. Cast pays the point on a card with a cost and the step on an at-will one; … pays another way.');
    }
    if (active && k.handMax) notes.push(`Tight Hand: ${t.hand.length} of ${k.handMax} in hand${tc.handOver ? ` — ${tc.handOver} over` : ''}.`);
    if (active && p.mods.gradualRamp) notes.push(`Gradual Ramp: ${t.manaPlayed} Mana Point card${t.manaPlayed === 1 ? '' : 's'} played this round (one allowed).`);
    if (active && p.mods.deckout && !t.deck.length) notes.push('Deckout: the deck is empty — 4 Constitution burn every turn it stays so.');
    if (active && tc.missing) notes.push(`${tc.missing} cop${tc.missing === 1 ? 'y' : 'ies'} added to the deck since the shuffle — in play after the next shuffle.`);
    if (active && p.mods.bleedingHand) notes.push(`Bleeding Hand: discard a card for each ${p.mods.bleedingHand === 2 ? 'action' : 'standard or full-round action'} that does not play or discard one.`);

    const lastRoll = t.lastRoll && model.tableCard(t.lastRoll.id)
      ? `<span class="badge roll" title="${esc(t.lastRoll.source)}">🎲 ${t.lastRoll.whoName ? `${esc(t.lastRoll.whoName)}: ` : ''}${esc(model.tableCard(t.lastRoll.id).name || 'roll')}: [${t.lastRoll.rolls.join(', ')}]${t.lastRoll.flat ? ` ${t.lastRoll.flat >= 0 ? '+' : '−'} ${Math.abs(t.lastRoll.flat)}` : ''} = <b>${t.lastRoll.total}</b></span>` : '';
    const present = (tc.squad || []).filter((m) => m.present);
    const withBadge = present.length ? `<span class="badge" title="Multi-Headed Play: their decks are shuffled in with yours">with ${esc(present.map((m) => m.name).join(', '))}</span>` : '';

    return `<section class="panel span2 tablehead">
      <h3>${active ? `Round ${t.round}` : 'No encounter'}
        <span class="badge">${tc.inDeck ?? 0} in deck</span>
        <span class="badge">${tc.inHand ?? 0} in hand</span>
        ${p.manaPool ? `<span class="badge">${tc.manaUntapped ?? 0}${stagnant ? ` of ${tc.manaInPlay ?? 0}` : ''} mana</span>` : ''}
        ${p.cooldown ? `<span class="badge">${tc.inDiscard ?? 0} in discard</span>` : ''}
        ${tc.inPlay ? `<span class="badge">${tc.inPlay} in play</span>` : ''}
        ${k.landAttuned ? `<span class="badge" title="${esc(k.landAttunedWhy)}">land-attuned: mana pays ×2</span>` : ''}
        ${withBadge}
        ${!faces.controls ? '' : sp ? `<span class="badge ${spLeft <= 0 ? 'err' : ''}" title="${esc(sp.name)}: casts are paid from this tracker">${spLeft} of ${sp.max} SP</span>`
    : '<span class="badge" title="Add a tracker named Spell Points and casts will be paid from it">no SP tracker</span>'}
        ${lastRoll}
        ${t.counters ? `<span class="badge" title="Perfect Draw's counters">[Ante] ${esc(model.tableCard(t.counters.id)?.name || '')}: ${t.counters.early} Early · ${t.counters.late} Late</span>` : ''}
      </h3>
      ${t.lastTrigger ? `<p class="hint trig">${esc(t.lastTrigger)}</p>` : ''}
      ${controls || windows || squad ? `<div class="pair tablectl">${controls}${squad}${windows}</div>` : ''}
      ${notes.length ? `<ul class="hint" style="margin:8px 0 0 1.1rem;padding:0">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${!active && faces.controls ? `<p class="hint">At initiative: shuffle the deck and draw ${k.openingHand ?? 2} (1 + casting modifier, at least 2)${loaded ? ` plus ${loaded} for Loaded Hand` : ''}.
        ${p.manaPool ? ` Mana Point cards drawn go straight to the table.${p.mods.gradualRamp ? ' Under Gradual Ramp they wait in hand instead, and one is played per round.' : ''}` : ''}
        ${p.cooldown ? ' Resolved cards go to the discard. A full-round action shuffles the discard back into the deck. Running out of cards does the same.' + (p.mods.deckout ? ' Deckout forbids both.' : '') : ' Resolved cards shuffle straight back into the deck.'}
        Out of combat there is no hand. Search the deck and cast at +1 minute.
        Keywords in a card's text fire when it is cast: ${CARD_KEYWORDS.map((w) => `<code>[${w[0].toUpperCase()}${w.slice(1)}${KEYWORD_EXAMPLE[w] ? ` ${KEYWORD_EXAMPLE[w]}` : ''}]</code>`).join(' ')}.
        A keyword that stands in for a manipulation needs that manipulation taken.
        A card with dice in its text, or in its Dice field, gets a 🎲 button${faces.windows ? '. The d20 beside it copies the card for Roll20' : ''}.</p>` : ''}
    </section>`;
  }

  /**
   * The chooser a many-mode card opens on Cast…: the modes as a list with
   * what each works out to and what it asks for, the spell points to put in
   * (the picked mode's price to begin with), and Cast or Ongoing. The press
   * carries the two answers in its argument (`cast?mode=…&sp=…`), read off
   * the form by whoever handles the click -- the element, or a window --
   * and each option holds its own Roll20 text, so a window copies the mode
   * that was cast and not the whole card.
   */
function castPicker(s, id, card, modes, casters = []) {
    const { model, ctx, p } = s;
    const copy = (label) => (p.copyOnCast ? rollText(model.cardRollSpec(id, label), ctx.rollFormat || DEFAULT_ROLL_FORMAT) : '');
    const first = modes[0];
    // Who casts it, when the squad is at the table: the character first.
    const byDefault = model.casterFor(null);
    const who = !casters.length ? '' : `<label class="pickrow">Cast by
          <select name="who" aria-label="Cast by">
            ${casters.map((c) => `<option value="${esc(c.id)}"${c.id === byDefault ? ' selected' : ''}>${esc(c.name)} (CL ${c.cl})</option>`).join('')}
          </select>
        </label>`;
    return `<div class="mcard mini castpick" data-card="${esc(id)}">
      <div class="bar title"><span class="name">${esc(card.name || card.effect || 'card')}</span><span class="cost">${costMark(card)}</span></div>
      ${String(card.subtitle || '').trim() ? `<div class="bar sub subtitle"><span>${esc(card.subtitle)}</span></div>` : ''}
      ${statsLine(model, card)}
      <div class="text">
        ${who}
        ${modes.length ? `<label class="pickrow">Mode
          <select name="mode" aria-label="Mode">
            ${modes.map((m) => `<option value="${esc(m.label)}" data-sp="${m.sp}"${copy(m.label) ? ` data-copytext="${esc(copy(m.label))}"` : ''}>${esc(m.label)}${m.formula ? ` — ${esc(m.formula)}` : m.source ? ` — ${esc(m.source)}` : ''}${m.sp ? ` (${m.sp} SP)` : ''}</option>`).join('')}
          </select>
        </label>` : ''}
        <label class="pickrow">Spell points on top of the cost
          <input type="number" name="sp" min="0" step="1" value="${first?.sp || 0}" aria-label="Spell points to spend">
        </label>
        ${terrainRow(model, card)}
      </div>
      <div class="foot"><span class="pair tools">
        ${tableBtn('play', id, 'Cast', { arg: 'cast', title: 'Cast this mode: the effect resolves now', cls: 'primary' })}
        ${tableBtn('play', id, 'Ongoing', { arg: 'ongoing', title: 'Cast this mode as an effect that lasts' })}
        ${tableBtn('pick', '', '×', { title: 'Never mind' })}
      </span></div>
    </div>`;
  }

  /**
   * Terrain Casting's row in the chooser: how this cast pays the drawback.
   * The default is already chosen -- the point on a card that costs any,
   * the step on an at-will one -- so a plain Cast never asks; the row is
   * for paying another way, or waiving it with a Drawback Freedom use.
   */
function terrainRow(model, card) {
    const fallback = model.terrainDefault(card);
    if (!fallback) return '';
    const slower = stepCastingTime(card.casting);
    const label = (k, text) => (k === 'step' && slower ? `casting time one step slower (${slower})` : text);
    return `<label class="pickrow">Terrain Casting
          <select name="terrain" aria-label="Terrain Casting">
            ${TERRAIN_CHOICES.map(([k, text]) => `<option value="${k}"${k === fallback ? ' selected' : ''}>${esc(label(k, text))}</option>`).join('')}
          </select>
        </label>`;
  }

  /** The hand: every card with the moves it may make from there. */
function handZone(s) {
    const { model, p, k, t, tc, copyText } = s;
    // On the GM's page the hand is the member's cards alone.
    const inHand = (t.hand || []).filter((id) => s.mine(id));
    const cards = inHand.map((id) => {
      const card = model.tableCard(id);
      const check = tc.castable?.[id] || {};
      const manaOk = tc.manaOk?.[id] || {};
      const isEffect = String(card?.effect || '').trim() !== '';
      const badge = isEffect && p.manaPool
        ? `<span class="badge ${check.ok ? 'ok' : 'err'}" title="${esc(check.why || `needs ${check.need}, has ${check.have}`)}">${check.ok ? `castable${check.worth > 1 ? ' ×2' : ''}` : `${check.have}/${check.spend ?? check.need} mana`}</span>` : '';
      const copy = copyText(id);
      // A card with several Dice entries is asked which, and for how many
      // points, on the way in: Cast… opens the chooser in the card's place.
      const modes = isEffect ? model.cardRollFormulas(card) : [];
      // With squad members at the table the chooser can also say who casts;
      // the character does unless it says otherwise, so a plain Cast stays a
      // plain Cast and a … beside it opens the chooser.
      const casters = isEffect && s.present.length && !s.member ? [{ id: '', name: shortName(model.casterInfo('').name, model.data.identity?.nickname), cl: Number(model.scope().caster?.level) || 0 }, ...s.present.map((m) => ({ id: m.id, name: m.name, cl: m.cl }))] : [];
      const asks = modes.length > 1;
      // Terrain Casting gives every card a chooser too: a plain Cast pays the
      // default toll, and the … is where another way is picked.
      const terrain = isEffect && !!model.terrainDefault(card);
      if ((asks || casters.length || terrain) && s.castPick === id) return castPicker(s, id, card, modes, casters);
      const castBtns = !isEffect ? '' : asks
        ? tableBtn('pick', id, 'Cast…', { title: `${modes.length} modes: pick one${casters.length ? ', who casts it' : ''}, and the spell points to put into it`, cls: 'primary' })
        : tableBtn('play', id, 'Cast', { arg: 'cast', title: 'Cast: the effect resolves now', cls: 'primary', copy })
          + tableBtn('play', id, 'Ongoing', { arg: 'ongoing', title: 'Cast an effect that lasts: the card stays in play until it resolves', copy })
          + (casters.length || terrain ? tableBtn('pick', id, '…', { title: [casters.length ? 'cast it as a squad member' : '', 'spell points on top', terrain ? 'how Terrain Casting is paid' : ''].filter(Boolean).join(', ').replace(/^./, (ch) => ch.toUpperCase()) }) : '');
      return cardMini(model, id, {
        ...s.miniOpts(id),
        badge,
        buttons: `${castBtns}${isEffect && tc.trapCard ? tableBtn('play', id, 'Trap', { arg: 'trap', title: 'Trap Card: set it face down in play; spring it later' }) : ''}
          ${card?.mana ? tableBtn('play', id, 'As mana', { arg: 'mana', title: manaOk.ok ? (manaOk.why || 'Play the Mana Point card onto the table') : manaOk.why, disabled: !manaOk.ok }) : ''}
          ${s.rollBtn(id, card)}${s.copyBtn(id)}${isEffect ? s.spBtn(id) : ''}
          ${tableBtn('move', id, '⤓', { arg: 'discard', title: 'Discard' })}
          ${s.zoneMoves(id, 'hand')}`,
      });
    }).join('');
    return `<section class="panel f-hand">
      <h3>Hand <span class="badge">${inHand.length}</span>${s.member && inHand.length !== t.hand.length ? `<span class="badge" title="The rest of the hand is the player's">${t.hand.length - inHand.length} more, the player's</span>` : ''}${k.handMax ? `<span class="badge ${tc.handOver ? 'err' : ''}">limit ${k.handMax}</span>` : ''}
        ${p.mods.gradualRamp ? `<span class="badge ${tc.manaBlocked ? 'err' : ''}">${tc.manaBlocked ? 'mana played this round' : 'one Mana Point card may be played'}</span>` : ''}</h3>
      ${inHand.length ? `<div class="zone hand">${cards}</div>` : `<p class="empty">${s.member ? 'None of this companion’s cards are in the hand.' : 'Empty hand.'}</p>`}
    </section>`;
  }

  /** In play: ongoing effects and face-down traps. */
function playZone(s) {
    const { model, t, faceDown, copyText } = s;
    const cards = (t.play || []).map((id) => (faceDown.has(id)
      ? `<div class="mcard mini trap" data-card="${esc(id)}">
          <div class="trapback">Trap<br><small>face down</small></div>
          <div class="foot"><span class="pair tools">${s.mine(id) ? `
            ${tableBtn('resolve', id, 'Spring', { title: 'The trap springs: it is cast now, keywords and all', cls: 'primary', copy: copyText(id) })}
            ${tableBtn('reveal', id, 'Reveal', { title: 'Turn it face up, still in play' })}
            ${s.zoneMoves(id, 'play')}` : ''}
          </span></div>
        </div>`
      : cardMini(model, id, {
        ...s.miniOpts(id),
        // Who it is affecting: the player writes it where the controls are;
        // the shared screen reads it.
        extra: s.faces.controls || (s.member && s.mine(id))
          ? `<div class="targets"><input type="text" value="${esc(t.targets?.[id] || '')}" data-table-targets="${esc(id)}" placeholder="targets — who it affects" aria-label="Targets"></div>`
          : (t.targets?.[id] ? `<div class="targets"><small>targets</small> ${esc(t.targets[id])}</div>` : ''),
        buttons: `${tableBtn('resolve', id, 'Resolve', { title: 'The effect ends: back to the deck, or the discard under Cooldown', cls: 'primary' })}${s.rollBtn(id, model.tableCard(id))}${s.copyBtn(id)}${s.spBtn(id)}${s.zoneMoves(id, 'play')}`,
      }))).join('');
    return `<section class="panel f-play">
      <h3>In play <span class="badge">${t.play.length}</span>${faceDown.size ? `<span class="badge">${faceDown.size} face down</span>` : ''}</h3>
      <p class="hint">Ongoing effects and traps. Resolve an effect when it ends; spring a trap when it fires.</p>
      ${t.play.length ? `<div class="zone">${cards}</div>` : '<p class="empty">Nothing in play.</p>'}
    </section>`;
  }

  /**
   * The deck: its back and its count, or -- on a face that keeps secrets --
   * the cards Read the Cards turned up; and the Lifebound piles under it.
   */
function deckZone(s) {
    const { model, p, k, t, peeked, readTwice } = s;
    return `<section class="panel f-deck">
      <h3>Deck <span class="badge">${t.deck.length}</span></h3>
      ${peeked.length ? `<p class="hint">Top of the deck: </p><div class="zone one">${peeked.map((id, i) => cardMini(model, id, {
    ...s.miniOpts(id),
    badge: `<span class="badge">${i === 0 ? 'top' : `${i + 1}${i === 1 ? 'nd' : 'rd'}`}</span>`,
    buttons: `${tableBtn('bury', id, '⤓ bottom (1 SP)', { title: 'Read the Cards: a spell point puts it on the bottom of the deck' })}
      ${readTwice ? tableBtn('move', id, 'discard', { arg: 'discard', title: 'Read the Cards taken twice: discard it' }) : ''}`,
  })).join('')}</div>` : `<div class="deckback"><span>${t.deck.length}</span></div>`}
      ${p.mods.lifeboundDeck ? LIFEBOUND_PILES.map((z) => `<h4 class="subhead" style="margin-top:10px">${z[0].toUpperCase()}${z.slice(1)} pile <span class="badge">${t[z].length}</span></h4>
        ${t[z].length ? `<div class="zonelist">${s.listZone(t[z], z)}</div>` : '<p class="empty">Empty.</p>'}`).join('')
    + `<p class="hint">Lifebound value ${k.lifebound ?? '—'}: each multiple lost moves a card down the piles (deck → Stun → Wounds → Death); each multiple healed moves one back.</p>` : ''}
    </section>`;
  }

  /** Mana in play, tapped or not. */
function manaZone(s) {
    const { model, p, t, tc, stagnant } = s;
    const cards = (t.mana || []).map((m) => {
      const card = model.tableCard(m.id);
      const colors = String(card?.mana || '');
      return `<div class="manacard${m.tapped ? ' tapped' : ''}" style="${esc(cardFrameStyle(colors))}" data-card="${esc(m.id)}">
        <span class="mana">${manaChips(colors, '')}</span>
        <span class="mname">${esc(card?.name || 'Mana Point')}</span>
        ${s.mine(m.id) ? `${p.mods.stagnantPool || m.tapped ? tableBtn('tap', m.id, m.tapped ? 'Untap' : 'Tap', { title: 'Stagnant Pool: a tapped Mana Point card is spent for the round' }) : ''}
        ${s.zoneMoves(m.id, 'mana')}` : ''}
      </div>`;
    }).join('');
    return `<section class="panel f-mana">
      <h3>Mana in play <span class="badge">${t.mana.length}</span>${stagnant ? `<span class="badge">${tc.manaUntapped} untapped</span>` : ''}</h3>
      ${p.manaPool ? `<p class="hint">${p.manaGraveyard ? 'Mana Graveyard: casting sends Mana Point cards equal to the cost to the discard.'
        : stagnant ? 'Stagnant Pool: mana in play is the spell points you may spend a round; tapped mana untaps at the start of your next turn.'
          : 'A card needs as many Mana Point cards in play as it costs' + (p.mods.coloredMana ? ', of its colour' : '') + '.'}</p>` : '<p class="hint">Without Mana Pool, mana on the table is a note rather than a rule.</p>'}
      ${t.mana.length ? `<div class="zone manazone">${cards}</div>` : '<p class="empty">No mana in play.</p>'}
    </section>`;
  }

  /** The discard over the exile, and the banished under both. */
function pilesZone(s) {
    const { model, p, t, has, copyText } = s;
    return `<div class="f-piles">
      <section class="panel">
        <h3>Discard <span class="badge">${t.discard.length}</span>
          ${t.discard.length && !s.member ? `<span class="pair" style="margin-left:auto">${tableBtn('exileRandom', '', 'Exile one at random', { arg: 1, title: 'Blood and Dust, Grave Peril: a random card from the graveyard into exile' })}</span>` : ''}
        </h3>
        ${t.discard.length ? `<div class="zonelist">${s.listZone(t.discard, 'discard', (id) => `${s.rollBtn(id, model.tableCard(id))}${s.copyBtn(id)}${s.spBtn(id)}${has('Recollection') || has('Resupply') ? tableBtn('move', id, '→ hand', { arg: 'hand', title: 'Recollection / Resupply' }) : ''}${has('Retrace') ? tableBtn('retrace', id, 'Retrace', { title: 'Retrace: cast it from the discard for its cost + 1 spell point (or a longer casting time); it rolls, its keywords fire, and it stays in the discard', copy: copyText(id) }) : ''}`)}</div>`
    : `<p class="empty">${p.cooldown ? 'Nothing discarded.' : 'Nothing discarded — resolved cards shuffle straight back.'}</p>`}
      </section>
      <section class="panel">
        <h3>Exile <span class="badge">${t.exile.length}</span></h3>
        ${t.exile.length ? `<div class="zonelist">${s.listZone(t.exile, 'exile')}</div>` : '<p class="empty">Nothing exiled.</p>'}
      </section>
      <section class="panel">
        <h3>Banished <span class="badge">${(t.banished || []).length}</span></h3>
        <p class="hint">The heavier exile: a banished card does not return to the deck until you rest to regain spell points.</p>
        ${(t.banished || []).length ? `<div class="zonelist">${s.listZone(t.banished, 'banished')}</div>` : '<p class="empty">Nothing banished.</p>'}
      </section>
    </div>`;
  }

  /** The log, newest first. */
function logZone(s, lines = 14) {
    const log = s.t.log || [];
    return `<section class="panel f-log">
      <h3>Log</h3>
      ${log.length ? `<ul class="tablelog">${[...log].reverse().slice(0, lines).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="empty">Nothing yet.</p>'}
    </section>`;
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
   *
   * The field: hand across the top; in play three quarters with the deck
   * beside it; then mana on the left and the discard over the exile on the right.
   */
function tablePanel(model, ctx, p, k) {
    const s = tableState(model, ctx, p, k, 'sheet');
    return `${tableHead(s)}
    ${s.active ? `<div class="span2 tablefield">
      ${handZone(s)}
      ${playZone(s)}
      ${deckZone(s)}
      ${manaZone(s)}
      ${pilesZone(s)}
      ${logZone(s)}
    </div>` : ''}`;
  }

  /**
   * The table for a window of its own: `table` is the face a shared screen
   * shows -- in play, the deck's back, mana, the piles and the log, with the
   * hand and anything Read the Cards turned up left out -- and `hand` is the
   * player's own: the hand, the controls, the top of the deck and the last
   * few lines of the log. Each is the same zones the sheet draws, no more.
   */
export function cardTableView(model, ctx, view, member = '') {
    const p = model.data.cardcasting;
    if (!p) return '<div class="grid"><p class="empty">No card casting data.</p></div>';
    const s = tableState(model, ctx, p, p.calc || {}, view, view === 'control' ? String(member || '') : '');
    const field = view === 'hand'
      ? `${handZone(s)}${s.peeked.length ? deckZone(s) : ''}${logZone(s, 6)}`
      : view === 'control'
        ? `${handZone(s)}${playZone(s)}${deckZone(s)}${manaZone(s)}${pilesZone(s)}${logZone(s)}`
        : `${playZone(s)}${deckZone(s)}${manaZone(s)}${pilesZone(s)}${logZone(s)}`;
    // The GM's page says whose cards it runs; the rest of the table is the
    // player's and is shown as it stands.
    const who = s.member ? (p.calc?.squad || []).find((m) => m.id === s.member) : null;
    const note = view !== 'control' ? '' : `<p class="hint gmnote">${who
      ? `You are running ${esc(who.name)}: its cards in the hand and in play take presses, cast on its own numbers and points. The rest of the table is the player’s.`
      : 'This companion is no longer in the squad.'}</p>`;
    const idle = view === 'control' ? '<p class="empty gmnote">No encounter in play — the player starts one from the sheet.</p>' : '';
    return `<div class="grid">${tableHead(s)}${note}${s.active ? `<div class="span2 tablefield ${esc(view)}view">${field}</div>` : idle}</div>`;
  }

  /** The deck at a glance, and the rules it is checked against. */
function deckSummaryPanel(p, k) {
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
        ${field('Casting ability', select('cardcasting.castingStat', p.castingStat, ABILITY_LABELS_LIST))}
        ${field('Colours in play', `<span class="pair">${text('cardcasting.colors', p.colors, 'RBU')}
          ${manaChips(k.colorsInPlay, '')}</span>`)}
        ${field('Draw with', select('cardcasting.useD100', p.useD100 ? '1' : '',
    [['', 'a shuffled deck'], ['1', 'a d100 and the roll table']], null))}
      </div>
      ${line('Casting modifier', `${fmt(k.cam ?? 0)}${k.stat ? ` (${k.stat})` : ''}`)}
      ${line('Opening hand at initiative', `${k.openingHand ?? 2} — 1 + modifier, at least 2; redraw for one fewer each time`)}
      ${line('Identical-effect spread', `${k.spreadMin ?? 0}–${k.spreadMax ?? 0} copies (may differ by up to ${k.cam ?? 0})`)}
      ${line('Effect cards', `${k.effectCards ?? 0} — ${k.uniqueEffects ?? 0} distinct effect${k.uniqueEffects === 1 ? '' : 's'}`)}
      ${line('Mana point cards', `${k.manaCards ?? 0}${k.fused ? ` (${k.fused} fused onto an effect)` : ''}`)}
      ${k.lifebound ? line('Lifebound value', `${k.lifebound} — HP ÷ 3 ÷ deck size, minimum 1`) : ''}
      ${inPlay.length ? `<div class="tally">${inPlay.map((c) => `<span class="t">${manaChips(c)}
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
function deckLadderPanel(p, k) {
    const mods = p.mods || {};
    // Compact: two abreast, the rule clamped to two lines with the whole of it
    // on hover.
    const row = (what, control, hint) => `<div class="modrow compact" title="${esc(hint)}">
      <div class="what"><strong>${what}</strong>${hint ? `<p class="hint clamp2">${esc(hint)}</p>` : ''}</div>
      <div>${control}</div></div>`;
    const modControl = (m) => {
      const path = `cardcasting.mods.${m.key}`;
      if (m.kind === 'count') {
        return select(path, String(mods[m.key] || 0), [['0', 'not taken'], ['1', 'taken once'], ['2', 'taken twice']], null);
      }
      if (m.kind === 'colors') {
        return select(path, String(mods[m.key] || 0), [['0', 'not taken'], ['3', 'three colours'], ['5', 'five colours (2 drawbacks)']], null);
      }
      return check(path, mods[m.key], mods[m.key] ? 'taken' : 'not taken');
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
      <p class="hint">Card Casting alone counts as one drawback. Cooldown or Mana Pool makes it two.
        Both make it three. Mana Graveyard makes it four. Each modification adds one more.
        Five-colour Colored Mana adds two. Hover a row for the whole rule.</p>
      <div class="modgrid">
      ${row('Card Casting', '<span class="badge">always</span>',
    'Effects that cost spell points are cards. Draw 1 + casting modifier (at least 2) at initiative, and one more each round. Play a card to cast it. Shuffle it back once its effect has resolved. Out of combat, search the deck and cast at +1 minute.')}
      ${row('Cooldown', check('cardcasting.cooldown', p.cooldown, p.cooldown ? 'taken' : 'not taken'),
    'Resolved cards go to a discard pile instead of the deck. A full-round action shuffles the discard back in. Running out of cards does the same, as a free action.')}
      ${row('Mana Pool', check('cardcasting.manaPool', p.manaPool, p.manaPool ? 'taken' : 'not taken'),
    'Mana Point cards join the deck and go straight to the table when drawn. A card needs as many Mana Points on the table as its spell point cost.')}
      ${row(`Mana Graveyard${p.manaGraveyard && !(p.cooldown && p.manaPool) ? ' <span class="badge err">needs both</span>' : ''}`,
    check('cardcasting.manaGraveyard', p.manaGraveyard, p.manaGraveyard ? 'taken' : 'not taken'),
    'With Cooldown and Mana Pool both taken: casting discards Mana Point cards from the table equal to the spell points spent.')}
      </div>
      <h4 class="subhead" style="margin-top:10px">Modifications</h4>
      <div class="modgrid">
      ${CARD_MODIFICATIONS.map((m) => row(`${esc(m.label)}${on(m) ? needs(m) : ''}`, modControl(m), m.hint)).join('')}
      </div>
    </section>`;
  }

/**
 * The groups a deck's manipulations are filed under: the four the system
 * names, and any the player invented. Both halves of the panel below want
 * this list -- the head to build its picker, the groups to draw themselves --
 * so it is worked out once here rather than twice.
 */
function manipulationGroups(p) {
  // The four the system names, any a pack files its manipulations under --
  // or the picker would leave that pack's out -- and any the player invented.
  return [...new Set(['General', 'Cooldown', 'Mana Pool', 'Specialized Mana Cards',
    ...deckManipulationCatalogue().map((m) => String(m.group || 'General')),
    ...(p.manipulations || []).map((m) => String(m.group || 'General'))])];
}


/**
 * The totals and the picker, which head the manipulations.
 *
 * Its own function rather than the first line of the panel below, because it
 * is the only part of that panel that belongs in the strip at the top of the
 * tab: folded, it is a pill beside Card casting and The drawback, while the
 * groups it heads keep their own layout underneath. It folds on its own too
 * -- shutting it puts the picker and the counts away without taking the
 * groups with them, since each of those already folds for itself.
 */
function deckManipulationsHead(model, p, k, own = '') {
    const groups = manipulationGroups(p);
    const catalogue = deckManipulationCatalogue();
    const NEED = MANIPULATION_NEEDS;
    const squad = k.squad || [];
    // Whose: the character's figures, or the member's own.
    const who = own ? squad.find((m) => m.id === own) : null;
    const f = who
      ? { taken: who.manipulationsTaken, available: who.manipulationsAvailable, left: who.manipulationsLeft, deckFeats: who.deckFeats || [], rainbow: who.rainbow }
      : { taken: k.manipulationsTaken ?? 0, available: k.manipulationsAvailable ?? 0, left: k.manipulationsLeft ?? 0, deckFeats: k.deckFeats || [], rainbow: k.rainbow };
    const left = f.left;
    const featList = f.deckFeats.map((x) => x.replace(/\s*\[[^\]]*\]\s*/g, '').trim());
    const head = `<section class="panel span2 manip-head">
      <h3>Deck manipulations
        <span class="badge ${left < 0 ? 'err' : ''}">${f.taken} of ${f.available} taken${left < 0 ? ` — ${-left} over` : left ? ` — ${left} left` : ''}</span>
        <span class="badge" title="${esc(featList.join(', ') || 'No feat or bought-off drawback is tagged [Deck]')}">${f.deckFeats.length} deck feat${f.deckFeats.length === 1 ? '' : 's'}</span>
        ${f.rainbow ? `<span class="badge">${f.rainbow === 2 ? 'Improved ' : ''}Rainbow Efficiency</span>` : ''}
      </h3>
      <div class="fieldgrid">
        ${who ? field('Available', `<span class="badge" title="One per deck feat of its own, and two for Card Shark each time it is taken">${f.available}</span>`) : field('Available', exprField('data-set="cardcasting.manipulationsAvailable"', p.manipulationsAvailable ?? '', {
    // Blank is automatic, so an emptied box has to store nothing rather than 0.
    kind: 'expr-or-null',
    width: '7rem', value: k.manipulationsAvailable, error: k.manipulationsError, placeholder: `auto: ${k.autoAvailable ?? 0}`,
    title: 'Blank: one per deck feat, and two for Card Shark each time it is taken. Or a number, or a formula.',
  }))}
        ${field('Add from the list', `<span class="pair"><select class="manip-pick" data-owner="${esc(own)}" aria-label="Add a deck manipulation">
          <option value="">— pick a manipulation —</option>
          ${groups.map((g) => {
    const opts = catalogue.filter((m) => m.group === g);
    return opts.length ? `<optgroup label="${esc(g)}">${opts.map((m) => `<option value="${esc(m.name)}" title="${esc(m.text)}">${esc(m.name)}${m.needs || m.requires.length ? ` (${[...m.requires.map((r) => NEED[r]), m.needs].filter(Boolean).join(', ')})` : ''}</option>`).join('')}</optgroup>` : '';
  }).join('')}
        </select></span>`)}
      </div>
      <p class="hint">One manipulation per deck feat (a feat or bought-off drawback tagged [Deck]), and two
        for Card Shark each time it is taken.${who ? '' : ' The Available field overrides that.'}${squad.length ? ` ${who ? 'A member\'s picks are its own, against its own deck feats, and it may use them at the table while it is there' : 'Each caster\'s picks are its own; a member\'s are on its deck\'s view'}. Each row has an owner pick per copy, so one copy can be given to another deck and the rest kept.` : ''} Hover a name for its rule.${who ? '' : ' Readable as'}
        ${who ? '' : '<code>deck.manip.&lt;name&gt;</code> (<code>deck.manip.loaded_hand</code>, <code>deck.manip.fused_cards</code>) and <code>deck.feats</code>.'}</p>
    </section>`;
    return collapsible(model, `deck-manipulations${own ? `:${own}` : ''}`, head);
  }

  /**
   * Deck manipulations by group, taken against what is available.
   *
   * One panel per group of manipulations, in a column layout of their own so
   * they sit two or three abreast with room for each note.
   *
   * Each folds on its own, keyed by the group's name rather than by its
   * position, so a player who only uses Cooldown can shut the other three and
   * have them stay shut -- and a group of their own invention folds like the
   * four that come with the system. They need no `foldstrip`: the column
   * layout already packs a folded one against its neighbours.
   */
function deckManipulationsPanel(model, p, k, own = '') {
    const list = 'cardcasting.manipulations';
    // This deck's rows alone: the character's, or the member's whose view this is.
    const ownerOf = (m) => String(m.calc?.owner ?? '');
    const items = (p.manipulations || []).map((m, i) => ({ m, i })).filter(({ m }) => ownerOf(m) === own);
    const groups = manipulationGroups(p);
    const NEED = MANIPULATION_NEEDS;
    // With a squad, each copy of a pick carries an owner pick, to give it to another deck.
    const squad = k.squad || [];
    const owners = [{ id: '', name: shortName(model.casterInfo('').name, model.data.identity?.nickname) }, ...squad.map((m) => ({ id: m.id, name: m.name }))];
    const panels = groups.map((g) => {
      const rows = items.filter(({ m }) => String(m.group || 'General') === g);
      const taken = rows.reduce((n, { m }) => n + (Number(m.count) || 0), 0);
      return collapsible(model, `deck-manip-${slug(g)}${own ? `:${own}` : ''}`, `<section class="panel">
        <h3>${esc(g)} ${taken ? `<span class="badge">${taken} taken</span>` : ''}</h3>
        ${rows.length ? `<div class="tablewrap"><table class="manips"><thead><tr>
          <th>Manipulation · note</th><th style="width:3.4rem">Taken</th><th></th>
        </tr></thead><tbody>
          ${rows.map(({ m, i }) => {
    const entry = manipulationEntry(m);
    const mc = m.calc || {};
    const tip = entry ? `${entry.name}${entry.needs || entry.requires.length ? ` (${[...entry.requires.map((r) => NEED[r]), entry.needs].filter(Boolean).join(', ')})` : ''}: ${entry.text}` : 'Not in the catalogue — a homebrew or a name it does not know';
    // Folded to its name by default: the card's text is a hover away, and
    // the player's note instead once they have written one. Folded by the
    // manipulation's name, so a removal above does not open another row.
    const foldKey = manipulationFoldKey(m, i);
    const shut = isCollapsed(model, foldKey, true);
    const peek = shut ? ` data-tpop="${esc(JSON.stringify({ k: 'manip', p: `${list}|${i}` }))}"` : '';
    return `<tr class="${mc.unmet?.length || mc.overMax ? 'unmet' : ''}">
            <td class="what">
              <span class="pair">${foldButton(model, foldKey, { open: !shut })}<span class="manipname"${peek}><input type="text" value="${esc(m.name ?? '')}" data-item="${list}|${i}|name" data-kind="text"
                placeholder="Manipulation"${shut ? '' : ` title="${esc(tip)}"`}></span>
                ${entry ? '' : '<span class="badge" title="Not in the catalogue">?</span>'}
                ${(mc.unmet || []).map((r) => `<span class="badge err">needs ${esc(NEED[r])}</span>`).join('')}
                ${mc.overMax ? `<span class="badge err">max ${entry.max}</span>` : ''}
              </span>
              ${shut ? '' : `${prose(model, `data-item="${list}|${i}|note"`, m.note, 1, 'grow note')}
              ${entry ? `<p class="rule">${esc(entry.text)}</p>` : ''}`}
            </td>
            <td>${itemNum(list, i, 'count', m.count)}</td>
            <td class="tools"><span class="pair">
              ${squad.length ? Array.from({ length: Math.max(1, Number(m.count) || 0) }, (_, n) => `<select class="movesel" data-manip-owner="${i}" aria-label="Whose copy ${n + 1} is" title="${esc(`Copy ${n + 1} of ${Math.max(1, Number(m.count) || 0)}: whose it is. Moving one copy leaves the others where they are.`)}">${owners.map((o) => `<option value="${esc(o.id)}"${o.id === ownerOf(m) ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`).join('') : ''}
              ${removeButton(list, i, { what: 'manipulation' })}
            </span></td>
          </tr>`;
  }).join('')}
        </tbody></table></div>` : '<p class="empty">None listed.</p>'}
        <div style="margin-top:6px">${addButton(list, `Add to ${g}`, { group: g, name: '', note: '', count: 1, owner: own })}</div>
      </section>`);
    });
    // Fixed columns, not the browser's balancing: opening a row grows its own
    // column and moves no other group (manipColumns).
    const sizes = groups.map((g) => items.filter(({ m }) => String(m.group || 'General') === g).length + 3);
    const columns = manipColumns(sizes, 3);
    return `<div class="span2 manipgrid" style="--manip-cols:${columns.length}">${columns
      .map((col) => `<div class="manipcol">${col.map((i) => panels[i]).join('')}</div>`).join('')}</div>`;
  }

/**
 * The groups in at most `n` columns, in their order, as even as their folded
 * sizes allow: every way of cutting the list into runs is tried (four groups
 * into three runs is three ways) and the one whose runs are closest in size
 * wins. Worked out from the folded sizes, so it does not change as rows open.
 */
export function manipColumns(sizes, n) {
  const k = Math.max(1, Math.min(n, sizes.length));
  let best = null;
  const walk = (start, left, cuts) => {
    if (left === 1) {
      const runs = [...cuts, [start, sizes.length]];
      const cost = runs.reduce((t, [a, b]) => t + sizes.slice(a, b).reduce((x, y) => x + y, 0) ** 2, 0);
      if (!best || cost < best.cost) best = { cost, runs };
      return;
    }
    for (let end = start + 1; end <= sizes.length - left + 1; end++) walk(end, left - 1, [...cuts, [start, end]]);
  };
  if (sizes.length) walk(0, k, []);
  return best ? best.runs.map(([a, b]) => Array.from({ length: b - a }, (_, j) => a + j)) : [];
}

  /** Land-attuned magic: which spheres each colour covers, and which are attuned. */
function landAttunedPanel(p, k) {
    const spheres = p.colorSpheres || {};
    const attuned = new Set(p.attunedSpheres || []);
    const tally = k.sphereTally || {};
    return `<section class="panel span2">
      <h3>Land-attuned magic
        ${attuned.size ? `<span class="badge">${attuned.size} attuned</span>` : ''}
        <span class="badge ${k.landAttuned ? 'ok' : ''}" title="${esc(k.landAttunedWhy || '')}">${k.landAttuned ? 'mana pays ×2 on attuned spheres' : 'feat not in force'}</span>
      </h3>
      <p class="hint">The spheres each colour of mana covers, as the deck's own table had them. Tick a
        sphere to mark it attuned. The count beside a sphere is how many cards in the deck belong to it.
        With Land-Attuned Magic among the feats, Terrain Casting or Area Bound in the tradition, and Mana Pool taken,
        every Mana Point card in play pays two spell points on an attuned sphere's card instead of one.
        ${k.landAttunedWhy ? `Currently ${esc(k.landAttunedWhy)}.` : ''}</p>
      ${CARD_COLORS.map(([c, name]) => {
    const list = `cardcasting.colorSpheres.${c}`;
    const rows = spheres[c] || [];
    return `<div class="modrow">
          <div class="what"><span class="pair">${manaChips(c)} <strong>${esc(name)}</strong></span>
            <div class="spheres">
              ${rows.map((s, i) => `<span class="pair">
                <button data-action="attune-sphere" data-sphere="${esc(s)}" aria-pressed="${attuned.has(s)}"
                  title="${attuned.has(s) ? 'Attuned — click to clear' : 'Click to attune'}"
                  class="${attuned.has(s) ? 'primary' : ''}">${attuned.has(s) ? '✓' : '○'}</button>
                ${itemText(list, i, 'self', s, 'Sphere')}
                ${tally[s] ? `<span class="badge">${tally[s]}</span>` : ''}
                ${removeButton(list, i, { what: 'sphere' })}
              </span>`).join('')}
              ${addButton(list, 'Add sphere', '')}
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
function cardFace(model, ctx, list, i, card, p, { inDeck = true } = {}) {
    const isMana = !String(card.effect || '').trim() && card.mana;
    const r = card.calc || {};
    const colors = String(r.colors || '');
    const range = r.from ? (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`) : '';
    const frameClass = r.artifact ? 'A' : colors.length === 1 ? esc(colors) : colors.length ? 'multi' : 'C';
    // Opened out, the face takes two columns, the text a taller box and the
    // Dice field a line per roll: room to read and to edit.
    const open = !!ctx.openCards?.has?.(`${list}.${i}`);
    // The face's last measured height, as its placeholder while it is off the
    // screen (content-visibility): see the element's #watchFaces.
    const known = ctx.faceHeights?.get?.(`${list}.${i}`);
    const placeholder = known ? `contain-intrinsic-size: auto ${known}px;` : '';
    return `<article class="mcard ${frameClass}${open ? ' open' : ''}" data-face="${list}.${i}" style="${r.artifact ? '' : esc(cardFrameStyle(colors))}${placeholder}">
      <div class="bar title">
        <input type="text" class="name" value="${esc(card.name ?? '')}" data-item="${list}|${i}|name" data-kind="text"
          placeholder="${isMana ? 'Mana Point' : 'Card name'}" aria-label="Card name">
        <span class="cost" title="Spell point cost, and the colour(s) it must be paid in — two or more with Rainbow Efficiency${r.fromSphere ? '. No colour of its own: the frame follows the sphere' : ''}">
          <input type="text" value="${esc(card.cost ?? '')}" data-item="${list}|${i}|cost" data-kind="text" placeholder="—" aria-label="Cost">
          <span class="colorcell${colors ? ' filled' : ''}" style="--n:${Math.max(2, colors.length)}">
            <input type="text" class="colorpick" value="${esc(card.color ?? '')}" data-item="${list}|${i}|color" data-kind="text"
              placeholder="${esc(r.fromSphere ? colors : '◌')}" aria-label="Cost colours" title="The colour letters R B U W G. Click the pips to type them">
            ${colors ? manaChips(colors, '') : ''}
          </span>
          ${r.discount ? `<span class="badge" title="${esc(`Rainbow Efficiency: ${r.discount} off for ${colors.length} colours — ${r.cost} to cast`)}">→ ${r.cost}</span>` : ''}
        </span>
      </div>
      <div class="bar sub subtitle" title="A subtitle: what the card does, in a few words, under a name of its own — Big Sky · Explosive Orb (Fire Blast)">
        <input type="text" value="${esc(card.subtitle ?? '')}" data-item="${list}|${i}|subtitle" data-kind="text" placeholder="subtitle — the effect in a few words" aria-label="Subtitle">
      </div>
      ${harrowFor(p, model.cardOwner(card)) ? `<div class="bar sub">
        ${itemSelect(list, i, 'suit', card.suit, ABILITY_LABELS_LIST, 'suit')}
        <input type="text" value="${esc(card.alignment ?? '')}" data-item="${list}|${i}|alignment" data-kind="text" placeholder="align." aria-label="Alignment">
      </div>` : ''}
      <div class="art">${imageSrc(card.art) ? `<img src="${esc(imageSrc(card.art))}" alt="" loading="lazy">` : ''}</div>
      <div class="bar type">
        <input type="text" value="${esc(card.sphere ?? '')}" data-item="${list}|${i}|sphere" data-kind="text" placeholder="${isMana ? 'Mana Point' : 'Sphere'}" aria-label="Sphere">
        <span class="dash">—</span>
        <input type="text" value="${esc(card.tags ?? '')}" data-item="${list}|${i}|tags" data-kind="text" placeholder="tags" aria-label="Tags">
      </div>
      ${cardStatBars(model, list, i, card)}
      <div class="text">${prose(model, `data-item="${list}|${i}|effect"`, card.effect, open ? 9 : 3, 'grow')}</div>
      <div class="foot">
        <span class="pair" title="Mana this card puts on the table (fused Mana Point): letters R B U W G">
          <input type="text" class="short" value="${esc(card.mana ?? '')}" data-item="${list}|${i}|mana" data-kind="text" placeholder="mana" aria-label="Mana carried">
          ${manaChips(card.mana, '')}
        </span>
        ${inDeck ? `<span class="pair" title="Copies in the deck">×${itemNum(list, i, 'qty', card.qty)}</span>` : ''}
        ${(p.calc?.squad || []).length ? `<span class="pair" title="Whose deck this card belongs to">${itemSelect(list, i, 'owner', card.owner || '', [['', shortName(model.casterInfo('').name, model.data.identity?.nickname)], ...p.calc.squad.map((m) => [m.id, m.name])], null)}</span>` : ''}
        <label class="chk" title="A technique card"><input type="checkbox" ${card.tech ? 'checked' : ''} data-item="${list}|${i}|tech" data-kind="bool"><span>tech</span></label>
        ${inDeck && p.useD100 && range ? `<span class="roll" title="d100 roll for this card">${esc(range)}</span>` : ''}
      </div>
      ${cardDiceRow(model, ctx, list, i, card, p, inDeck)}
      <div class="foot last">
        <input type="text" class="arturl" value="${esc(card.art ?? '')}" data-item="${list}|${i}|art" data-kind="text"
          placeholder="art: paste an image link" aria-label="Art URL">
        <span class="pair tools">
          ${expandBtn(`${list}.${i}`, open)}
          ${inDeck ? `<button data-move="${list}|${i}|-1" title="Move up" aria-label="Move up">↑</button>
          <button data-move="${list}|${i}|1" title="Move down" aria-label="Move down">↓</button>` : ''}
          ${cardShelfButtons(model, list, i, inDeck)}
          ${removeButton(list, i, { what: 'card' })}
        </span>
      </div>
    </article>`;
  }

  /**
   * The stat line under a face's type line: save, DC, range and target on
   * one bar, the damage types on a second with a picker that adds one at a
   * time. Every field takes a formula -- `{10 + caster.level}` in any of
   * them, and the DC a bare `caster.dc` as well -- and what one works out to
   * shows under the bar when it differs from what was typed: a DC from its
   * formula, a range word as feet for this caster's level, a token resolved,
   * a DC that does not work out saying why. The pick lists suggest; the
   * field keeps whatever is typed in it.
   */
function cardStatBars(model, list, i, card) {
    const ref = `${list}|${i}`;
    const s = model.cardStats(card);
    const stat = (field, label, title, listId) => `<span class="stat" title="${esc(title)}"><small>${esc(label)}</small>
        <input type="text" value="${esc(card[field] ?? '')}" data-item="${ref}|${field}" data-kind="text" list="${listId}" aria-label="${esc(label)}"></span>`;
    const typed = (field) => String(card[field] ?? '').trim().toLowerCase();
    const changed = (field, shown) => shown && String(shown).toLowerCase() !== typed(field);
    const feetWord = s.rangeFeet !== null && !/^\d+$/.test(s.range);
    const preview = [
      changed('save', s.save) ? ['Save', s.save] : null,
      s.dcError ? ['DC', `${s.dc} — ${s.dcError}`, 'err'] : changed('dc', s.dc) ? ['DC', s.dc] : null,
      feetWord ? ['Range', `${s.range} = ${s.rangeFeet} ft`] : changed('range', s.range) ? ['Range', s.range] : null,
      changed('target', s.target) ? ['Target', s.target] : null,
      changed('duration', s.duration) ? ['Duration', s.duration] : null,
      changed('casting', s.casting) ? ['Casting time', s.casting] : null,
      changed('damage', s.damage.join(', ')) ? ['Damage', s.damage.join(', ')] : null,
    ].filter(Boolean).map(([l, t, cls = 'ok']) => `<span class="badge ${cls}">${esc(l)} ${esc(t)}</span>`).join('');
    // Two to a row while the entries are words; a formula in any of them
    // puts each on a row of its own, so it can be read whole.
    const wide = ['save', 'dc', 'range', 'target', 'duration', 'casting'].some((f) => {
      const v = String(card[f] ?? '').trim();
      return /[{}()+*/]/.test(v) || v.length > 14;
    });
    return `<div class="bar stats${wide ? ' rows' : ''}">
        ${stat('save', 'save', 'Saving throw: Ref, Fort, Will or none — or a formula in braces', 'card-saves')}
        ${stat('dc', 'DC', 'Save DC: a number or a formula — caster.dc, 10 + floor(caster.level/2) + int.mod', 'card-dcs')}
        ${stat('range', 'range', 'Range: melee, close, medium or long (worked out in feet for the caster level), a number of feet, or a formula', 'card-ranges')}
        ${stat('target', 'target', 'Target or area: single, line, cone, burst — or a formula', 'card-targets')}
        ${stat('duration', 'duration', 'Duration: instantaneous, concentration, 1 round/level… — or a formula, {caster.level} rounds', 'card-durations')}
        ${stat('casting', 'cast', 'Casting time: standard action, swift action, full-round action, 1 minute… — or a formula', 'card-casting-times')}
      </div>
      <div class="bar stats dmg">
        <span class="stat grow" title="Damage types, comma-separated — fire, cold — or a formula in braces"><small>dmg</small>
          <input type="text" value="${esc(card.damage ?? '')}" data-item="${ref}|damage" data-kind="text" list="card-damage" placeholder="damage types" aria-label="Damage types"></span>
        <select class="movesel dmgpick" data-append="${ref}|damage" data-join="," aria-label="Add a damage type" title="Add a damage type">
          <option value="">add…</option>
          ${CARD_DAMAGE_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
        ${preview ? `<span class="preview">${preview}</span>` : ''}
      </div>`;
  }

  /**
   * The two buttons that move a card between the deck and the sideboard, or
   * copy it across. While an encounter is on, nothing may leave the deck --
   * the table addresses deck cards by their place -- so that button says so
   * and does nothing; a copy is always fine.
   */
function cardShelfButtons(model, list, i, inDeck) {
    const to = inDeck ? 'cardcasting.sideboard' : 'cardcasting.cards';
    const where = inDeck ? 'sideboard' : 'deck';
    const active = !!model.data.cardcasting?.table?.active;
    const held = inDeck && active;
    return `<button data-card-move="${list}|${i}|${to}|move" ${held ? 'disabled' : ''} title="${held ? 'The deck is in play: end the encounter first, or copy it instead' : `Move this card to the ${where}`}" aria-label="Move to ${where}">→ ${where}</button>
          <button data-card-move="${list}|${i}|${to}|copy" title="Copy this card to the ${where}" aria-label="Copy to ${where}">⧉ ${where}</button>`;
  }

  /** A card's stat line as read -- Save Reflex DC 24 · Range close (60 ft) -- for the small faces and the chooser. */
function statsLine(model, card) {
    const lines = model.cardStatLines(card);
    return lines.length ? `<div class="bar stats read">${lines.map(([l, t]) => `<span><small>${esc(l)}</small> ${esc(t)}</span>`).join('')}</div>` : '';
  }

  /**
   * The pick lists the stat fields offer, declared once for the deck view:
   * the saves, two DC spellings, the range words, the shapes and the damage
   * types. A list suggests and the field still takes anything.
   */
function cardDatalists(p) {
    const list = (id, items) => `<datalist id="${id}">${items.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
    return list('card-saves', CARD_SAVES)
      + list('card-dcs', ['caster.dc', `10 + floor(caster.level/2) + ${castingModName(p.castingStat)}`])
      + list('card-ranges', CARD_RANGES)
      + list('card-targets', CARD_TARGETS)
      + list('card-durations', CARD_DURATIONS)
      + list('card-casting-times', CARD_CASTING_TIMES)
      + list('card-damage', CARD_DAMAGE_TYPES);
  }

  /** The deck's casting modifier in the formula spelling: `int.mod` for a deck cast on Int. */
function castingModName(stat) {
    return `${String(stat || 'int').toLowerCase().slice(0, 3)}.mod`;
  }

  /**
   * What the picker beside the Dice field can add, in the sheet's own
   * formula spelling so the field teaches it: the Spheres blast shapes off
   * the caster level, the casting modifier, and a second labelled roll. The
   * casting stat is the deck's (`castingStat`), so the modifier is the right
   * one for this caster.
   */
function cardDicePresets(stat) {
    const mod = castingModName(stat);
    return [
      ['{1+floor(caster.level/2)}d6', '1d6 + 1d6 per 2 caster levels (a blast)'],
      ['{floor(caster.level/2)}d6', '1d6 per 2 caster levels'],
      ['{caster.level}d6', '1d6 per caster level'],
      ['{1+floor(caster.level/2)}d8', '1d8 + 1d8 per 2 caster levels'],
      ['{step("1", floor(caster.level/5))}', '1, then a die one step bigger per 5 caster levels (1d2, 1d3, 1d4…)'],
      [`+${mod}`, `+ casting modifier (${mod})`],
      ['+caster.level', '+ caster level'],
      ['+caster.mod', '+ the caster’s modifier, whoever casts it'],
      ['; boost (1 SP): ', 'a boosted roll, for 1 SP (a second line)'],
      ['; ', 'another roll, with its own name'],
    ];
  }

  /**
   * The Dice row under a card's text: the field, what it works out to right
   * now, a picker that adds a roll in the sheet's spelling, a button that
   * hands the dice to the other cards with the same effect, and the d20 that
   * copies the card for Roll20. The preview is the test of the field: a roll
   * that reads as dice shows as `8d6+13`, and one that does not says so.
   */
function cardDiceRow(model, ctx, list, i, card, p, inDeck) {
    const ref = `${list}|${i}`;
    const formulas = model.cardRollFormulas(card);
    const preview = formulas.map((r) => (r.formula
      ? `<span class="badge ok" title="${esc(`${r.label}: ${r.source}`)}">${esc(formulas.length > 1 ? `${r.label} ` : '')}${esc(r.formula)}</span>`
      : `<span class="badge err" title="${esc(r.error)}">${esc(r.label)}: ${esc(r.source || '—')}</span>`)).join('');
    const hasStats = CARD_STAT_FIELDS.some((f) => String(card[f] ?? '').trim());
    const alike = inDeck && (String(card.dice || '').trim() || hasStats) ? model.cardSiblings(list, i) : [];
    const title = 'Dice to roll on the table — 8d6+int.mod, {1+floor(caster.level/2)}d6, or several with names: damage: 8d6; boost (1 SP): 15d6. Blank uses the first dice in the text.';
    // Opened out, the field is a line per roll; the entries are read the
    // same way either way, since a new line separates them as a ; does.
    const open = !!ctx.openCards?.has?.(`${list}.${i}`);
    const lines = String(card.dice ?? '').split(/;\s*|\n/).filter((x, n, all) => x.trim() || n < all.length - 1);
    const field = open
      ? `<textarea class="dice" data-item="${ref}|dice" data-kind="text" rows="${Math.max(2, lines.length + 1)}" spellcheck="false" placeholder="one roll a line — damage: 8d6+int.mod" aria-label="Dice">${esc(lines.join('\n'))}</textarea>`
      : `<input type="text" class="dice" value="${esc(card.dice ?? '')}" data-item="${ref}|dice" data-kind="text" placeholder="dice — 8d6+int.mod; boost (1 SP): 15d6" aria-label="Dice">`;
    return `<div class="foot dice${open ? ' open' : ''}">
      <span class="pair grow" title="${esc(title)}">🎲${field}</span>
      <select class="movesel dicepick" data-append="${ref}|dice" aria-label="Add dice" title="Add a roll in the sheet's own spelling">
        <option value="">add…</option>
        ${cardDicePresets(p.castingStat).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
      </select>
      ${alike.length ? `<button data-dice-share="${ref}" title="Give these dice and this stat line to the ${alike.length} other card${alike.length === 1 ? '' : 's'} with this effect">→ ${alike.length} alike</button>` : ''}
      ${cardCopyButton(model, ctx, ref, card.name || card.effect || 'card')}
      ${preview ? `<span class="pair preview">${preview}</span>` : ''}
    </div>`;
  }

  /** The deck: one face per card of whoever's view this is. Folds, like the panels above it. */
function deckTablePanel(model, ctx, p, k, own = '') {
    return collapsible(model, `deck:cards${own ? `:${own}` : ''}`, deckTableBody(model, ctx, p, k, own));
  }

function deckTableBody(model, ctx, p, k, own = '') {
    const list = 'cardcasting.cards';
    const cards = p.cards || [];
    const who = own ? (k.squad || []).find((m) => m.id === own) : null;
    const d = who ? who.deck || {} : k;
    const suitTally = d.suitTally || {};
    const alignTally = d.alignTally || {};
    const newCard = (extra) => ({
      name: '', suit: '', alignment: '', color: '', mana: '', effect: '', cost: '1', sphere: '', tags: '',
      save: '', dc: '', range: '', target: '', damage: '',
      qty: 1, tech: false, roll: null, art: '', notes: '', ...extra,
    });
    return `<section class="panel span2">
      <h3>Deck
        <span class="badge">${d.deckSize ?? 0} cards</span>
        ${!who && p.useD100 ? `<span class="badge">d100 — reroll above ${k.deckSize ?? 0}</span>` : ''}
        <span class="pair" style="margin-left:auto;font-weight:400;text-transform:none;letter-spacing:0">
          <label class="pair">Sort ${select('cardcasting.deckSort', p.deckSort, DECK_SORTS, null, { attrs: 'aria-label="Sort the deck" title="The order the faces are shown in — the cards themselves stay where they were typed"' })}</label>
          ${check(own ? `cardcasting.harrowBy.${own}` : 'cardcasting.harrow', harrowFor(p, own), 'Harrow deck — suits & alignments')}
        </span>
      </h3>
      <p class="hint">Cost and its colour sit top right and set the frame colour; the colour shows
        as pips, and a click on them opens the letters to type. The type line is
        sphere — tags. The letters under the text are the mana the card puts on the table when a
        Mana Point card is fused onto it. Leave the effect blank for a plain Mana Point card.
        ${p.useD100 ? 'The number bottom right is the card\'s roll on the d100.' : ''}
        Sort shows the faces by colour (white, blue, black, red, green, then gold), by cost, by tags
        or by sphere; the sideboard follows.</p>
      ${(() => { const l = model.deckList(own); return postBox(ctx, `decklist${own ? `-${own}` : ''}`, 'Decklist', l.text, Math.min(24, Math.max(4, l.text.split('\n').length + 1))); })()}
      ${harrowFor(p, own) && Object.keys(suitTally).length ? `<div class="tally">
        ${Object.entries(suitTally).map(([s, n]) => `<span class="t">${esc(s)} <span class="n">${n}</span></span>`).join('')}
        <span class="t">·</span>
        ${Object.entries(alignTally).map(([a, n]) => `<span class="t">${esc(a)} <span class="n">${n}</span></span>`).join('')}
      </div>` : ''}
      ${deckFaces(model, ctx, p, k, list, cards, newCard, own)}
    </section>`;
  }

  /**
   * The faces of one owner's deck, in the sort the deck asks for, with the
   * add buttons that build for that owner: a companion's deck is built on its
   * own view and travels with the owner it is given. A face's owner pick
   * moves a card to another deck.
   */
function deckFaces(model, ctx, p, k, list, cards, newCard, own) {
    const who = own ? (k.squad || []).find((m) => m.id === own) : null;
    const colors = who ? who.colors : k.colorsInPlay;
    const mine = deckOrder(cards, p.deckSort).filter((i) => model.cardOwner(cards[i]) === own);
    const faces = mine.map((i) => cardFace(model, ctx, list, i, cards[i], p)).join('');
    return `${mine.length ? `<div class="cardgrid">${faces}</div>` : `<p class="empty">${who ? `No cards yet for ${esc(who.name)} — 20 to 30 of the spheres you do not run.` : 'No cards yet. A deck needs at least 20.'}</p>`}
      <div class="pair" style="margin-top:10px">
        ${addButton(list, 'Add effect card', newCard({ owner: own }))}
        ${addButton(list, 'Add mana point card', newCard({ cost: '', mana: (colors || 'R').slice(0, 1), owner: own }))}
      </div>`;
  }

  /**
   * The squad: Multi-Headed Play's members and whether each deck may combine.
   * A companion is listed when it has a casting tradition of its own; it
   * joins when that tradition lists Card Casting and the same switches as the
   * character's -- Colored Mana's colours excepted, which are its own.
   */
function squadPanel(model, p, k, ctx = {}) {
    const squad = k.squad || [];
    if (!squad.length) return '';
    const c = k.combined || {};
    return `<section class="panel span2">
      <h3>Squad — Multi-Headed Play
        <span class="badge">${c.members || 0} deck${c.members === 1 ? '' : 's'} combine</span>
        <span class="badge" title="Every deck together, when every member is at the table">${c.deckSize ?? 0} cards in all</span>
        ${c.colors ? `<span class="pair">${manaChips(c.colors, '')}</span>` : ''}
      </h3>
      <p class="hint">A squad member's deck has a view of its own above, and is shuffled in with yours while it is at the table (the roster under the table's
        controls). Any member may cast any card in the hand, using its own caster level, modifier and spell points. Write
        a card's numbers as <code>caster.level</code> and <code>caster.mod</code> and they follow whoever casts it. A member's
        tradition must list Card Casting with the same switches as yours. Its Colored Mana colours are its own, and so is
        Rainbow Efficiency: a member's multi-colour cards are discounted by its own feat, yours by yours. A member takes
        its own deck manipulations against its own deck feats (the owner pick on each row under Deck manipulations) and
        may use them at the table while it is there. Your other deck feats stay yours.</p>
      ${squad.map((m) => `<div class="squadrow">
        <div class="what"><strong>${esc(m.name)}</strong>
          <span class="badge ${m.ok ? 'ok' : 'err'}" title="${esc(m.why || 'Card Casting, with the same switches')}">${m.ok ? 'combines' : m.cardCasting ? 'switches differ' : 'no Card Casting'}</span>
          ${m.casts ? `<span class="badge">CL ${m.cl} · mod ${fmt(m.mod)}</span>` : '<span class="badge err" title="Give it the Magical Companion talent or the mage archetype">does not cast</span>'}
          ${manaChips(m.colors, '')}
          ${m.rainbow ? `<span class="badge" title="Its own deck feat: its multi-colour effects cost less">${m.rainbow === 2 ? 'Improved ' : ''}Rainbow Efficiency</span>` : ''}
          <span class="badge ${m.manipulationsLeft < 0 ? 'err' : ''}" title="Its own deck manipulations, against its own deck feats">${m.manipulationsTaken} of ${m.manipulationsAvailable} manipulations</span>
          <span class="badge">${m.deck.deckSize} cards</span>
          ${m.deck.issues.length ? `<ul class="hint warn" style="margin:4px 0 0 1.1rem;padding:0">${m.deck.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          ${!m.ok && m.why ? `<p class="hint">${esc(m.why)}.</p>` : ''}
        </div>
        <div class="hint">${m.pool ? `points from ${esc(m.name)}’s own pool` : ''}
          ${grantControls(m, ctx)}</div>
      </div>`).join('')}
      <p class="hint">Hand a member to the GM when it is no longer yours to run — an unwilling companion that made its save.
        The GM gets a link to a page with that member's cards in hand, the table as it stands, and the companion's
        features; what the GM presses runs here, on this sheet, which must stay open. Take back closes the page.</p>
    </section>`;
  }

  /**
   * Handing a member to the GM, or taking it back: the control link, who is
   * watching, and the two buttons. `ctx.grants` is what the sheet holds --
   * member id to { url, name, viewers, since }.
   */
function grantControls(m, ctx) {
    const g = ctx?.grants?.[m.id];
    if (!g) {
      return `<div class="pair grant"><button data-action="hand-over" data-member="${esc(m.id)}" title="A link to this companion’s hand, the table and its features, for the GM. The character is published first if it is not yet.">Hand over to the GM</button></div>`;
    }
    return `<div class="pair grant">
      <span class="badge ok" title="${esc(`Handed to the GM${g.since ? ` since ${g.since}` : ''}`)}">handed to the GM${g.viewers ? ` · ${g.viewers} watching` : ''}</span>
      <input type="text" readonly value="${esc(g.url || '')}" aria-label="Control link" style="width:16rem">
      <button data-action="copy-grant-link" data-member="${esc(m.id)}" title="Copy the control link for the GM">Copy link</button>
      <button data-action="take-back" data-member="${esc(m.id)}" class="danger" title="Take control back: the GM’s page is closed">Take back</button>
    </div>`;
  }

  /** Cards kept aside for a swap at rest: this owner's. Folds like the deck. */
function sideboardPanel(model, ctx, p, own = '') {
    const list = 'cardcasting.sideboard';
    const cards = p.sideboard || [];
    const mine = deckOrder(cards, p.deckSort).filter((i) => model.cardOwner(cards[i]) === own);
    return collapsible(model, `deck:sideboard${own ? `:${own}` : ''}`, `<section class="panel span2">
      <h3>Sideboard <span class="badge">${mine.length}</span></h3>
      <p class="hint">Cards built but not in the deck. The deck can only change when you rest to regain spell points.</p>
      ${mine.length ? `<div class="cardgrid">${mine.map((i) => cardFace(model, ctx, list, i, cards[i], p, { inDeck: false })).join('')}</div>` : ''}
      <div style="margin-top:10px">${addButton(list, 'Add to sideboard', {
    name: '', suit: '', alignment: '', effect: '', cost: '', sphere: '', tags: '', color: '', mana: '', art: '', notes: '',
    save: '', dc: '', range: '', target: '', damage: '', owner: own,
  })}</div>
    </section>`);
  }
