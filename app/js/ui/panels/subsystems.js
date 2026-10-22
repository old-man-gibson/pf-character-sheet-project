/**
 * ui/panels/subsystems.js -- the tabs a character only has if they play that way.
 *
 * Akashic veilweaving, Path of War maneuvers, vancian casting, psionics,
 * cardcasting, Primordia techniques and the three companions. They are one
 * module because they are one *kind* of thing: each appears only when the
 * character uses it or a class is marked with it, each reads its progression
 * from a shared table an extension pack supplies, and none of them is reached
 * from anywhere but its own tab.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, val } from '../html.js';
import { itemArea, prose, renderedProse } from '../prose.js';
import { fillNotesButton, talentLegend, talentMark, foldingNote } from '../talents.js';
import { forwardedBadge } from '../badges.js';
import { D20_ICON, rollButton } from '../roll.js';
import { DEFAULT_ROLL_FORMAT, rollText } from '../../roll20.js';
import {
  meterStyleButton, meterStyleEditor, meterVisual, powerPointStepper, trackerLine,
} from './trackers.js';

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

/**
 * Maneuver types, short enough for a narrow column.
 *
 * The sheet writes qualifiers in brackets -- "Strike [curse]", "Strike [G]" --
 * which the full name carries in the row's tooltip.
 */
const TYPE_ABBREV = {
  Strike: 'Str', Boost: 'Bst', Counter: 'Ctr', Stance: 'Stc', Untyped: 'Unt',
};
import {
  CARD_COLORS, CARD_MODIFICATIONS, CARD_KEYWORDS, DECK_SORTS, LIFEBOUND_PILES, TABLE_DESTINATIONS, cardKeywordPattern, deckOrder, harrowFor,
  hasManipulation, manipulationCount, redrawSize, castingTableNames, manipulationEntry, manipulationFoldKey, deckManipulationCatalogue, MANIPULATION_NEEDS,
  maneuverCatalogue, maneuverDetails, maneuverIsWritten, maneuverOwn, altTrainingLink,
  altTrainingNames, altTrainingRepeatFrom, altTrainingTechniques, psionicCurveTotals, psionicTables,
  spellCatalogue, spellDetails, powerCatalogue, powerDetails, veilsAvailable, veilDetails, veilOwn,
  slug, manifesterForwardKey, vancianForwardKey, poolTracker,
} from '../../model.js';
import { ABILITY_LABELS_LIST, nameDatalist, noteCell, packText } from '../html.js';
import {
  CARD_CASTING_TIMES, CARD_DAMAGE_TYPES, CARD_DURATIONS, CARD_RANGES, CARD_SAVES, CARD_STAT_FIELDS, CARD_TARGETS,
  TERRAIN_CHOICES, stepCastingTime,
} from '../../model/subsystems/cardcasting.js';
import { round } from '../format.js';
import {
  ABILITIES, ABILITY_LABELS, CASTING_SOURCES, ESSENCE_SOURCES, MANEUVER_FIELDS,
  PREP_STYLES, SIZE_MODIFIERS,
  SPELL_LEVELS, SP_PER_TEMP_ESSENCE, VEIL_SLOTS, WIKI_BASE, castingNoun, fmt, prepStyle,
  skillLabel, wikiUrl,
} from '../../rules.js';
import {
  BODY_TYPES, COMPANION_LABELS, COMPANION_LEVEL_SOURCES, CONJURED_ARCHETYPES,
  CONJURED_BASE_FORMS, CONJURED_LEVEL_SOURCES, NATURAL_ATTACKS,
  abilityTextKey, companionAbilityText,
  companionAttackKey, companionScopeName, companionSkillKey, emptyCompanionFeat, isOtherConjurationTalent,
} from '../../companions.js';
import { hasTokens } from '../../inline.js';
import { getPath } from '../../model/util.js';
import { speedTable } from '../speeds.js';
import { countsTowardLine } from '../counts-toward.js';
import { squareLayout } from '../../tracker-style.js';
import { abilitySelect, check, field, num, autoNum, levelPin, levelPinHint, postBox, select, text } from '../fields.js';
import {
  addButton, bigStat, collapsible, exprField, foldButton, gridCell, isCollapsed, isOpen, itemCheck, itemNum,
  itemSelect, itemText, line,
  lineHtml, miniStat, proseList, removeButton, rowRemove, rowTools, working,
} from '../rows.js';

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
 * `pool` is the row the click spends from, as `slots:<list>|<index>` (see
 * model/pools.js). Clicking the nth pip leaves n unspent, and clicking the last
 * lit one spends it -- the rule the tracker pips follow too, and the one
 * handler that answers both.
 */
export function slotSpend({ pool, total, left, shape = 'pips', name = 'slot' }) {
  const cap = Math.max(0, Number(total) || 0);
  if (!cap) return '';
  const lit = Math.max(0, Math.min(cap, Number(left) || 0));
  const attrs = (n) => `data-pool-pip="${esc(pool)}" data-n="${n}"`;
  const title = `${lit} of ${cap} left`;
  // A count in place of pips spends one: it is a click on the last lit pip.
  // With none left there is nothing to spend, and the old way of asking gave
  // one back instead.
  const count = () => `<button class="pipcount" ${attrs(lit)}${lit ? '' : ' disabled'}
      title="${esc(lit ? `${title} — click to spend one` : `None of ${cap} left`)}">${lit}<span class="of">/${cap}</span></button>`;

  if (shape === 'squares') {
    const sq = squareLayout({ min: 0, max: cap, current: cap - lit, style: { shape, fill: 'remaining' } });
    if (sq.mode === 'number') return count();
    return `<span class="pips square" title="${esc(title)}">${
      Array.from({ length: sq.slots }, (_, i) => `<button class="pip ${i + 1 <= lit ? 'used' : ''}"
        ${attrs(i + 1)} title="${esc(`${i + 1} of ${cap}`)}"
        aria-label="Leave ${i + 1} of ${esc(name)}"></button>`).join('')
    }</span>`;
  }

  // A long row of pips stops being readable, so a big pool just shows the count.
  if (cap > 12) return count();
  return `<span class="pips" title="${esc(title)}">${
    Array.from({ length: cap }, (_, i) => `<button class="pip ${i + 1 <= lit ? 'used' : ''}"
      ${attrs(i + 1)} title="${esc(`${i + 1} of ${cap}`)}"
      aria-label="Leave ${i + 1} of ${esc(name)}"></button>`).join('')
  }</span>`;
}

export const shortType = (t) => {
  const base = String(t || '').replace(/\s*\[.*$/, '').trim();
  return TYPE_ABBREV[base] || base.slice(0, 3);
};

  /**
   * The sub-system tabs with an "in use" state, keyed by tab id. The data
   * checks live on the model (`systemTabsInUse` -- the sphere tabs and
   * Crafting included); `tagged` says a class on the Overview marks the
   * system even though nothing is typed into its tab yet.
   */
export function modelledSystems(model) {
    const has = model.systemTabsInUse();
    const tagged = model.taggedSystemTabs();
    const out = {};
    for (const [id, h] of Object.entries(has)) out[id] = { id, has: h, tagged: tagged.has(id) };
    return out;
  }

  /**
   * Cells from a source tab that no label claimed. Kept and shown; a {…}
   * formula in one works as it does in any cell, and shows what it comes to,
   * but nothing on the tab reads the cells themselves.
   */
export function systemExtrasPanel(model, block, path, tabName) {
    const rows = block?.sourceExtras || [];
    if (!rows.length) return '';
    const list = `${path}.sourceExtras`;
    const width = Math.min(14, Math.max(...rows.map((r) => r.cells.length), 2));
    return `<section class="panel span2">
      <h3>From the source tab <span class="badge">${rows.length} rows</span></h3>
      <p class="hint">
        Cells from the workbook's ${esc(tabName)} tab that no heading claimed. They are kept as
        written. Nothing above reads them. A <code>{…}</code> formula in one of them works as in
        any other cell.
      </p>
      <div class="tablewrap" style="margin-top:8px"><table class="gridtab"><tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${gridCell(model, list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${rowTools(list, ri)}
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
export function akashicPanel(model, ctx) {
    const a = model.data.akashic;
    if (!a) return '<div class="grid"><p class="empty">No akashic data.</p></div>';

    // The essence gauge and the veilweaving classes each take the width they
    // need and share a row where the sheet is wide enough (see `.flow`); a
    // page-wide panel around a two-row table was empty to the right of it.
    return `<div class="grid">
      ${veilDatalists(a)}
      <div class="flow span2">
        ${essencePanel(ctx, model, a)}
        ${akashicClassesPanel(a)}
      </div>
      ${akashicSlotsPanel(model, ctx, a)}
      ${akashicKheshigPanel(model, ctx, a)}
      ${akashicReceptaclesPanel(model, a)}
      ${systemExtrasPanel(model, a, 'akashic', 'Akashic')}
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
function essencePanel(ctx, model, a) {
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
        ${meterStyleButton(ctx, 'essence')}
      </h3>
      ${meterStyleEditor(model, ctx, 'essence')}
      <div class="essence-strip">
        <div class="ess-gauge${free < 0 ? ' is-over' : ''}">
          <div class="ess-head">
            <span class="ess-read"><b>${used}</b><i>/</i>${total}</span>
            <span class="ess-k">invested</span>
            <span class="ess-fill"></span>
            <span class="ess-left">${free} free</span>
          </div>
          ${meterVisual(model.meterSpec('essence'))}
          <div class="ess-note">
            ${temp ? `pool ${pool} + ${temp} temporary` : `${pool} essence per day`}
          </div>
        </div>

        <div class="ess-figs">
          ${essFig(k.base ?? 0, 'Base DC', 'before essence')}
          ${Number(a.steadyVeilDC) ? essFig(a.steadyVeilDC, 'Steady DC', 'steady veil') : ''}
          ${essFig(k.totalCap ?? 0, 'Cap', 'per veil')}
          ${essFig(k.shaped ?? 0, 'Shaped', `${slots} slot${slots === 1 ? '' : 's'}`)}
        </div>

        <div class="ess-sp${k.spShort ? ' is-over' : ''}">
          <div class="ess-sp-k">Spell points → essence</div>
          <label class="minifield">Temporary essence
            ${num('akashic.essence.spTemp', e.spTemp, 'min="0" step="1" style="width:3.2rem"')}</label>
          <div class="ess-sp-cost">
            ${temp
    ? `${k.spSpent} SP spent &middot; ${spLeft} of ${k.spPool ?? 0} left`
    : `${SP_PER_TEMP_ESSENCE} SP each &middot; ${k.spPool ?? 0} SP available`}
          </div>
        </div>
      </div>
      <p class="hint">The Veilweaving sphere condenses
        ${SP_PER_TEMP_ESSENCE} spell points into 1 temporary essence for the day.
        The points are spent whether or not the essence is invested. They
        come off the total on <strong>Magic Spheres</strong>.</p>
    </section>`;
  }

  /** One fixed reading beside the gauge: the number first, then what it is. */
function essFig(v, k, sub = '') {
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
function akashicClassesPanel(a) {
    const list = 'akashic.classes';
    const e = a.essence || {};
    // Only the filled class blocks are worth a row; the template's six leave
    // five empty ones behind on most sheets. A row added here is shown from
    // the start (`added`), so it can be filled in or removed.
    const rows = (a.classes || [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.added || c.name || c.mod || c.level || c.essenceCap || c.bonusCap);
    const vw = a.veilweaving || {};
    const levelTitle = vw.sphere
      ? 'Levels in casting and veilweaving classes together, each level once (the Veilweaving sphere). Type a number to pin it.'
      : 'Levels in this class, from the Planner or the Classes table. Type a number to pin it.';
    return `<section class="panel span2">
      <h3>Veilweaving <span class="badge">${rows.length} class${rows.length === 1 ? '' : 'es'}</span></h3>
      <div class="akashic-head">
        <div class="ak-classes tablewrap">
          <table class="build"><thead><tr>
            <th>Class</th><th>Mod</th><th class="num">Lvl</th>
            <th class="num">Ess.</th><th class="num">Bonus</th><th class="num">Cap</th><th></th>
          </tr></thead><tbody>
            ${rows.map(({ c, i }) => `<tr>
              <td>${itemText(list, i, 'name', c.name, 'Class')}</td>
              <td>${select(`${list}.${i}.mod`, c.mod, ABILITY_LABELS_LIST)}</td>
              <td class="num">${autoNum(`data-item="${list}|${i}|levelOverride"`, c.levelOverride, {
    auto: true, placeholder: c.levelAuto ?? 0, width: '3.2rem', title: levelTitle,
    label: `Veilweaving level of ${c.name || 'this class'}`,
  })}</td>
              <td class="num">${itemNum(list, i, 'essenceCap', c.essenceCap)}</td>
              <td class="num">${itemNum(list, i, 'bonusCap', c.bonusCap)}</td>
              <td class="num total">${c.totalCap ?? 0}</td>
              ${rowRemove(list, i)}
            </tr>`).join('') || `<tr><td colspan="7" class="empty">No veilweaving class.</td></tr>`}
          </tbody></table>
          <div class="pair" style="margin-top:6px">
            ${addButton(list, 'Add class', {
    name: '', mod: null, levelOverride: null, essenceCap: 0, bonusCap: 0, added: true,
  })}
            <label class="minifield">Base DC
              ${autoNum('data-set="akashic.baseDCOverride"', a.baseDCOverride, {
    auto: true, placeholder: vw.baseDCAuto ?? a.baseDC ?? 10, width: '3.4rem',
    title: `10 + the veilweaving modifier${vw.ability ? ` (${vw.ability})` : ''}. Type a number to pin it.`,
  })}</label>
            <label class="minifield">Steady veil DC
              ${autoNum('data-set="akashic.steadyVeilDCOverride"', a.steadyVeilDCOverride, {
    auto: true, placeholder: vw.steadyVeilDCAuto ?? a.steadyVeilDC ?? 10, width: '3.4rem',
    title: 'The base DC and half the veilweaving level. Type a number to pin it.',
  })}</label>
          </div>
          ${vw.sphere ? `<p class="hint">With the Veilweaving sphere, levels in casting classes count
            as veilweaving levels. Each level counts once. A class row with no ability uses the
            class's casting ability.</p>` : ''}
        </div>

        <div class="ak-pool">
          <div class="subhead">Essence pool</div>
          <table class="build"><tbody>
            <tr><th scope="row">Pool</th>
              <td class="num">${num('akashic.essence.pool', e.pool)}</td></tr>
            ${ESSENCE_SOURCES.map(([key, label]) => (key === 'boon' && a.calc?.traditionBoon ? `<tr>
              <th scope="row" title="The casting tradition's own pool, taken as essence rather than spell points — set on the Magic Spheres tab">
                ${esc(label)}</th>
              <td class="num total">${a.calc.traditionBoon}</td>
            </tr>` : `<tr>
              <th scope="row">${esc(label)}</th>
              <td class="num">${num(`akashic.essence.${key}`, e[key])}</td>
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
function akashicSlotsPanel(model, ctx, a) {
    const list = 'akashic.slots';
    const slots = a.slots || [];
    const shaped = slots.filter((s) => (s.veils || []).length).length;
    const showEmpty = isOpen(model, 'veil:showEmpty', false);
    const shown = slots.map((s, i) => ({ s, i }))
      .filter(({ s }) => showEmpty || (s.veils || []).length);

    return `<section class="panel span2">
      <h3>Veil slots
        <span class="badge">${shaped} shaped</span>
        <span class="badge">${slots.length} slots</span>
        <span class="pair" style="margin-left:auto">
          ${veilColumnsControl(model)}
          ${foldButton(model, 'veil:showEmpty', {
    open: showEmpty,
    pressed: true,
    title: '',
    text: showEmpty ? 'Hide empty slots' : `Show ${slots.length - shaped} empty`,
  })}
          ${addButton(list, 'Add slot', {
    slot: '', bound: false, twinveil: false, veils: [],
  })}
        </span>
      </h3>
      <p class="hint">One veil per slot, or two with Twinveil. A veil's save DC
        is the base DC plus the essence invested in it. A description may contain
        <code>{name = expr}</code> formulas, as any other prose field can.</p>
      ${shown.length
    ? `<div class="veils"${veilGridStyle(model)}>${shown.map(({ s, i }) => veilSlotCard(model, ctx, a, list, s, i)).join('')}</div>`
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
function veilColumnsControl(model) {
    const cols = veilColumns(model);
    return `<span class="seg" role="group" aria-label="Veil cards per row">
      <span class="seg-k">Per row</span>
      ${[[0, 'Auto'], [3, '3'], [4, '4'], [5, '5']].map(([n, label]) => `
        <button data-view data-veilcols="${n}" aria-pressed="${cols === n}"
          title="${n ? `${n} veil cards to a row` : 'As many as fit'}">${label}</button>`).join('')}
    </span>`;
  }

  /** The saved count, defaulting to four -- five is where the cards get tight. */
function veilColumns(model) {
    const v = model.data.uiPrefs?.veilColumns;
    return v === undefined ? 4 : Number(v) || 0;
  }

  /**
   * The pinned count, or 0 for as many as fit. The cards are dealt into that
   * many columns in reading order by the sheet element after the render
   * (see #layoutVeils), which also keeps a width floor so a narrow window
   * drops to fewer columns instead of squeezing the cards.
   */
function veilGridStyle(model) {
    return ` data-cols="${veilColumns(model)}"`;
  }


function veilSlotCard(model, ctx, a, list, s, i) {
    const base = `${list}.${i}`;
    const options = veilOptions(a, s.slot);   // its id; the list itself is emitted once for the tab
    const veils = s.veils || [];
    const max = s.twinveil ? 2 : 1;
    const key = `veil:${s.slot || i}`;
    const collapsed = isCollapsed(model, key);

    return `<div class="veilslot${collapsed ? ' is-collapsed' : ''}">
      <div class="veilslot-head">
        ${foldButton(model, key, { open: !collapsed, cls: 'disclose', title: collapsed ? 'Expand' : 'Collapse' })}
        ${select(`${base}.slot`, s.slot, VEIL_SLOTS, null)}
        <span class="vcount" title="veils shaped / slots available">${veils.length}<i>/</i>${max}</span>
        ${removeButton(list, i, { what: `the ${s.slot || 'unnamed'} slot`, tiny: true })}
      </div>
      ${collapsed ? '' : `<div class="veilslot-body">
        <div class="veilflags">
          ${check(`${base}.twinveil`, s.twinveil, 'Twinveil')}
          ${check(`${base}.bound`, s.bound, 'Bound')}
        </div>
        ${veils.map((v, vi) => veilCard(model, ctx, `${base}.veils`, v, vi, options)).join('')}
        ${veils.length < max
    ? `<div style="margin-top:4px">${addButton(`${base}.veils`, 'Shape a veil', { name: '', desc: '', essence: 0 })}</div>`
    : ''}
      </div>`}
    </div>`;
  }

/**
 * The veilweaving classes this character actually has, for narrowing what a
 * slot offers. Empty where the sheet never named one, which has to read as
 * "every list" rather than "no veils".
 */
function veilweavingClasses(a) {
  return [
    ...(a?.classes || []).map((c) => String(c?.name || '').trim()),
    // The Veilweaving sphere's (tradition) talents open a class's list without
    // a level in the class; see `veilTraditionClasses`.
    ...(a?.calc?.traditions || []),
  ].filter(Boolean);
}

/**
 * What a slot offers, as a `<datalist>` its cards point at.
 *
 * One per chakra rather than one per card: the list is the same for every
 * veil shaped in that slot, and the Hands chakra alone runs to a few hundred
 * entries. Nothing is emitted where no pack provides a catalogue, and the
 * name field is then the free-text box it has always been -- a player who
 * types a veil nobody has published is not doing anything wrong.
 */
function veilOptions(a, slot) {
  const veils = veilsAvailable({ slot, classes: veilweavingClasses(a) });
  if (!veils.length) return { id: '', html: '' };
  const id = `veils-${slug(slot || 'any')}`;
  return {
    id,
    html: `<datalist id="${esc(id)}">${veils.map((v) => `<option value="${esc(v.name)}"${
      v.slot || v.descriptor ? ` label="${esc([v.slot, v.descriptor].filter(Boolean).join(' · '))}"` : ''
    }></option>`).join('')}</datalist>`,
  };
}

/**
 * Every slot's catalogue, emitted once for the tab.
 *
 * A `<datalist>` is addressed by id, so one per chakra has to appear once in
 * the document however many cards point at it -- two Kheshig receptacles both
 * set to Hands share the Hands list rather than each printing their own.
 */
function veilDatalists(a) {
  const slots = [...(a?.slots || []).map((s) => s.slot), ...(a?.kheshig || []).map((r) => r.slot)];
  const seen = new Set();
  const out = [];
  for (const slot of slots) {
    const { id, html } = veilOptions(a, slot);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(html);
  }
  return out.join('');
}

/** The name of a shaped veil: free text, with the slot's catalogue behind it. */
function veilNameField(list, vi, v, options) {
  const text = String(v.name ?? '');
  return `<input type="text" value="${esc(text)}" data-item="${list}|${vi}|name"
      data-kind="text" placeholder="Veil name"${options.id ? ` list="${esc(options.id)}"` : ''}${
  text.trim() ? ` title="${esc(text)}"` : ''}>`;
}

/**
 * One shaped veil: its name, what it does, and what it costs.
 *
 * What it says has two faces, for the reason a maneuver's card does. The
 * catalogue's text is read where it stands and never copied onto the sheet --
 * so a pack that corrects a veil corrects it everywhere it is shaped, and a
 * character sent to a friend carries the veil's *name* rather than four
 * kilobytes of somebody else's book. The pen turns the card over to what the
 * player wrote themselves, which is all that is ever saved; emptying that
 * hands the veil back to the pack.
 *
 * A veil the catalogue has never heard of -- typed in by hand, or one whose
 * pack is switched off -- has only the player's own text, so that face is the
 * only one there is and the pen would have nothing to turn over to.
 */
function veilCard(model, ctx, list, v, vi, options = { id: '' }) {
    const key = `${list}|${vi}`;
    const d = veilDetails(v);
    const own = veilOwn(v);
    const writing = ctx?.veilEdit === key || !d.known;
    const meta = [d.slot, d.descriptor, d.classes.join(', '), d.source].filter(Boolean);
    return `<div class="veil${d.known ? ' is-known' : ''}">
      <div class="veil-top">
        ${veilNameField(list, vi, v, options)}
        <label class="minifield" title="essence invested">Ess
          ${itemNum(list, vi, 'essence', v.essence)}</label>
        <span class="veil-dc" title="base DC + essence">DC ${v.dc ?? 0}</span>
        ${d.known ? `<button class="mnote-btn${d.mine ? ' has-note' : ''}" data-vedit="${esc(key)}"
          aria-expanded="${writing}"
          title="${d.mine ? 'What you wrote about it — click to edit' : 'Write your own version; leave it empty and the pack’s text stands'}"
          aria-label="Edit ${esc(v.name || 'this veil')}">✎</button>` : ''}
        ${removeButton(list, vi, { what: 'this veil', title: 'Unshape this veil', tiny: true })}
      </div>
      ${meta.length ? `<div class="veil-meta" title="from the pack that carries this veil">${meta.map((m) => esc(m)).join(' · ')}</div>` : ''}
      ${writing
    ? itemArea(model, list, vi, 'desc', own.desc, 2, model.veilScope(v))
    : packText(ctx, `veil:${key}`, 'veil-text', renderedProse(model, d.desc, model.veilScope(v)))}
      ${d.known && d.bindEffect && !writing
    ? `<div class="veil-bind"><b>Bind:</b> ${esc(d.bindEffect)}</div>` : ''}
    </div>`;
  }


function akashicKheshigPanel(model, ctx, a) {
    const list = 'akashic.kheshig';
    if (!(a.kheshig || []).length) return '';
    return `<section class="panel span2">
      <h3>Kheshig receptacles</h3>
      <p class="hint">A weapon or armour veil takes the slot it names rather than
        occupying one of its own.</p>
      <div class="veils"${veilGridStyle(model)}>
        ${(a.kheshig || []).map((r, i) => `<div class="veilslot">
          <div class="veilslot-head">
            <span class="klabel" title="${esc(r.label)}">${esc(r.label.replace(' (Kheshig)', ''))}</span>
            ${select(`${list}.${i}.slot`, r.slot, VEIL_SLOTS)}
          </div>
          <div class="veilslot-body">
            <div class="veilflags">${check(`${list}.${i}.bound`, r.bound, 'Bound')}</div>
            ${(r.veils || []).length
    ? (r.veils || []).map((v, vi) => veilCard(model, ctx, `${list}.${i}.veils`, v, vi, veilOptions(a, r.slot))).join('')
    : `<div style="margin-top:4px">${addButton(`${list}.${i}.veils`, 'Shape a veil', { name: '', desc: '', essence: 0 })}</div>`}
          </div>
        </div>`).join('')}
      </div>
    </section>`;
  }


function akashicReceptaclesPanel(model, a) {
    const list = 'akashic.otherReceptacles';
    const rows = a.otherReceptacles || [];
    // Some sheets tick a receptacle on or off beside its essence; a sheet that
    // never did should not grow a column of dead checkboxes.
    const ticks = rows.some((r) => r.active !== undefined);
    return `<section class="panel span2">
      <h3>Other receptacles <span class="badge">${rows.length}</span></h3>
      <p class="hint">Anything holding essence that is not one of the slots above.
        Its essence counts against the day's pool, as a veil's does.
        A receptacle ticked off does not count.</p>
      ${rows.length ? `<div class="veils"${veilGridStyle(model)}>
        ${rows.map((r, i) => `<div class="veilslot${r.active === false ? ' is-off' : ''}">
          <div class="veilslot-body">
            <div class="veil">
              <div class="veil-top">
                ${itemText(list, i, 'name', r.name, 'Receptacle')}
                <label class="minifield" title="essence invested">Ess
                  ${itemNum(list, i, 'essence', r.essence)}</label>
                ${removeButton(list, i, { what: 'this receptacle', tiny: true })}
              </div>
              ${ticks ? `<div class="veilflags">${check(`${list}.${i}.active`, r.active !== false, 'On')}</div>` : ''}
            </div>
          </div>
        </div>`).join('')}
      </div>` : '<p class="empty">None.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add receptacle', { name: '', essence: 0 })}</div>
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
export function maneuversPanel(model, ctx) {
    const m = model.data.maneuvers;
    if (!m) return '<div class="grid"><p class="empty">No maneuver data.</p></div>';
    const k = m.calc || {};
    // Matched as the packs merge them: case and space do not make a second discipline.
    const key = (n) => String(n ?? '').trim().toLowerCase();
    const taken = new Set((m.disciplines || []).map((d) => key(d.name)));
    const available = [...new Map(maneuverCatalogue().disciplines
      .map((d) => [key(d.name), d.name])).entries()]
      .filter(([k]) => k && !taken.has(k)).map(([, name]) => name);

    return `<div class="grid">
      <section class="panel span2">
        <h3>Maneuvers ${k.legal === false ? '<span class="badge err">over the limit</span>' : ''}</h3>
        <div class="statbar">
          ${miniStat('Maneuvers', `${k.maneuvers ?? 0}/${k.possibleManeuvers ?? 0}`)}
          ${miniStat('Stances', `${k.stances ?? 0}/${k.possibleStances ?? 0}`)}
          ${miniStat('Disciplines', (m.disciplines || []).length)}
          <span class="statbar-fill"></span>
          <label class="minifield">Maneuvers allowed
            ${num('maneuvers.possibleManeuvers', m.possibleManeuvers, 'style="width:3.4rem"')}</label>
          <label class="minifield">Stances allowed
            ${num('maneuvers.possibleStances', m.possibleStances, 'style="width:3.4rem"')}</label>
        </div>
        <div class="pair" style="margin-top:8px">
          <select data-action="add-discipline" aria-label="Add a discipline">
            <option value="">Train a discipline…</option>
            ${available.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
          </select>
          ${available.length ? '' : '<span class="hint">Every discipline in the catalogue is trained.</span>'}
        </div>
        <p class="hint" style="margin-top:6px">
          <strong>Tick</strong> a maneuver to ready it. Only the box toggles it; nothing else
          on the row does. <strong>Click its name</strong> to read what you wrote
          about it. Click the ✎ to write it: type, action, range, target, duration,
          saving throw and description. Each field takes <code>{…}</code> formulas.
          <strong>Right-click</strong> a name to open its page on the
          <a href="${esc(WIKI_BASE)}" target="_blank" rel="noopener noreferrer">wiki</a>.
        </p>
      </section>

      <section class="panel span2 discipline-wrap">
        ${(m.disciplines || []).length
    ? `<div class="disciplines">${(m.disciplines || []).map((d, i) => disciplineColumn(model, ctx, d, i)).join('')}</div>`
    : '<p class="empty">No disciplines trained. Pick one above to see what it grants.</p>'}
      </section>

      ${systemExtrasPanel(model, m, 'maneuvers', 'Maneuvers')}
    </div>`;
  }

  /**
   * One discipline: its readied count, then every maneuver it grants, grouped
   * by level. Ticking a row readies it; the row itself comes from the shared
   * catalogue and is not stored on the character.
   */
function disciplineColumn(model, ctx, d, i) {
    const list = `maneuvers.disciplines.${i}`;
    const entries = d.entries || [];
    const levels = [...new Set(entries.map((e) => e.level))].sort((a, b) => a - b);
    const collapsed = isCollapsed(model, `disc:${d.name}`);

    return `<div class="discipline${collapsed ? ' is-collapsed' : ''}">
      <div class="discipline-head">
        ${foldButton(model, `disc:${d.name}`, { open: !collapsed, cls: 'disclose', title: collapsed ? 'Expand' : 'Collapse' })}
        <span class="dname" title="${esc(d.name)}">${esc(d.name) || '<em>Unnamed</em>'}</span>
        <span class="dcount" title="readied maneuvers / stances">${d.knownManeuvers ?? 0}<i>/</i>${d.knownStances ?? 0}</span>
        ${removeButton('maneuvers.disciplines', i, { what: 'discipline', title: `Stop training ${d.name}`, tiny: true })}
      </div>
      ${collapsed ? '' : `<div class="discipline-body">
        ${d.inCatalogue === false && !entries.length
    ? '<p class="empty">Not in the catalogue.</p>' : ''}
        ${levels.map((lvl) => `
          <div class="dlevel">${lvl ? `Level ${lvl}` : 'Other'}</div>
          ${entries.map((e, ei) => [e, ei]).filter(([e]) => e.level === lvl).map(([e, ei]) => {
    const wiki = wikiUrl(e.name);
    const key = `${list}|${e.name}`;
    const open = ctx.openManeuver === key;
    // Two readings of the same maneuver: what it says (the player's cells over
    // the catalogue's) and what the player wrote (which is what the pen means,
    // and all that is ever saved).
    const entry = maneuverDetails(d, e.name, e);
    const own = maneuverOwn(d, e.name);
    const written = maneuverIsWritten(own);
    return `
            <div class="mrow${e.known ? ' is-known' : ''}${open ? ' is-open' : ''}">
              <label class="mtick" title="${esc(e.known ? `Stop readying ${e.name}` : `Ready ${e.name}`)}">
                <input type="checkbox" ${e.known ? 'checked' : ''}
                  data-ready="${list}|${esc(e.name)}" data-kind="bool"
                  aria-label="Ready ${esc(e.name)}"></label>
              <button data-view type="button" class="mname" data-mopen="${esc(key)}"
                ${wiki ? `data-wiki="${esc(wiki)}"` : ''} aria-expanded="${open}"
                title="${esc(e.name)}${entry.type ? ` — ${esc(entry.type)}` : ''}

Click to ${open ? 'close' : 'open'} it${wiki ? ', right-click for the wiki' : ''}">${esc(e.name)}</button>
              <span class="mtype ${e.kind === 'stance' ? 'is-stance' : ''}">${esc(shortType(entry.type))}</span>
              <button class="mnote-btn${written ? ' has-note' : ''}" data-medit="${esc(key)}"
                title="${written ? 'What you wrote down about it — click to edit' : 'Write down what it does — {…} formulas work'}"
                aria-label="Edit ${esc(e.name)}" aria-expanded="${open && !!ctx.maneuverEdit}">✎</button>
            </div>
            ${open ? maneuverCard(model, ctx, list, e, entry, own, key, wiki) : ''}`;
  }).join('')}
        `).join('')}
      </div>`}
    </div>`;
  }

/* ------------------------------------------------------------------ *
 * One maneuver, opened.
 *
 * Two faces of the same card -- read it, or fill it in -- because at the
 * table you are reading it and only ever writing it once.
 *
 * What it says can come from two places. A pack may carry the cells (the
 * bundled Path of War catalogue carries only the type: the rest is a
 * publisher's rules text and is not ours to ship, but a player's own pack is
 * their own content). Anything the player writes on their sheet sits over the
 * top of that, cell by cell -- so a table ruling scribbled mid-session wins,
 * and emptying the cell again hands it back to the pack.
 * ------------------------------------------------------------------ */

function maneuverCard(model, ctx, list, e, entry, own, key, wiki) {
  const editing = !!ctx.maneuverEdit;
  const sub = [e.level ? `Level ${e.level}` : '', e.kind === 'stance' ? 'Stance' : 'Maneuver']
    .filter(Boolean).join(' · ');

  return `<div class="mdetail${editing ? ' is-editing' : ''}">
      <div class="mdetail-head">
        <span class="mdetail-name" title="${esc(e.name)}">${esc(e.name)}</span>
        <span class="mdetail-sub">${esc(sub)}</span>
        ${wiki ? `<a class="mdetail-wiki" href="${esc(wiki)}" target="_blank" rel="noopener noreferrer"
          title="Its page on the wiki">wiki ↗</a>` : ''}
        <button class="tiny" ${editing ? `data-view data-mopen="${esc(key)}"` : `data-medit="${esc(key)}"`}
          aria-pressed="${editing}"
          title="${editing ? 'Back to reading it' : 'Fill in what it does'}">${editing ? 'Done' : 'Edit'}</button>
        <button data-view class="tiny" data-mclose="${esc(key)}" title="Close" aria-label="Close ${esc(e.name)}">×</button>
      </div>
      ${editing ? maneuverCells(model, list, e, own) : maneuverRead(model, ctx, entry, key, e.known)}
    </div>`;
}

/**
 * What it says, with the blanks left out.
 *
 * A stat entry prints the lines it has; the ones nobody filled in are not
 * "Target: —", they are simply not part of the maneuver, and a card of seven
 * em-dashes is a form rather than a rules entry.
 */
// A bonus written on a maneuver applies only while it is readied.
const UNREADIED = { inactiveTitle: 'Not readied, so the bonus is not applying. Ready it to switch it on.' };

function maneuverRead(model, ctx, entry, key, readied = true) {
  const shown = MANEUVER_FIELDS
    .map((f) => [f, entry[f.key]])
    .filter(([, v]) => String(v).trim() !== '');
  const value = (v) => (hasTokens(v) ? renderedProse(model, v, null, { ...UNREADIED, inactive: !readied }) : esc(v));
  const cells = shown.filter(([f]) => f.key !== 'text');
  const body = shown.find(([f]) => f.key === 'text');
  return `${cells.length ? `<dl class="mdetail-cells">${cells.map(([f, v]) => `
      <dt>${esc(f.label)}</dt><dd>${value(v)}</dd>`).join('')}</dl>` : ''}
    ${body ? packText(ctx, `man:${key}`, 'mdetail-text', value(body[1])) : ''}
    ${maneuverIsWritten(entry) ? '' : '<p class="empty">Nothing written down yet — <strong>Edit</strong> fills it in.</p>'}`;
}

/**
 * The same entry with every cell open.
 *
 * Three of them are picked from a list because the rules only allow those
 * answers; the rest are prose, so a range that scales -- `Close ({= 25 + 5 *
 * floor(level / 2)} ft.)` -- keeps up with the level instead of going stale
 * the way a typed number does.
 *
 * A cell holds the player's own answer and nothing else, so that clearing one
 * really does clear it. What the catalogue says sits behind as the greyed
 * placeholder -- which is also what the cell falls back to the moment it is
 * emptied, so the ghost text is a promise rather than a hint.
 */
function maneuverCells(model, list, e, own) {
  const key = `${list}|${e.name}`;
  const bind = (f) => `data-mfield="${esc(key)}" data-mf="${f.key}" aria-label="${esc(f.label)}"`;
  const cell = (f) => {
    // What the catalogue's own row says for this cell, whether or not the
    // player has written over it -- because that is what emptying it gives
    // back, which makes the ghost text a promise rather than a hint.
    //
    // A cell the catalogue says nothing about falls back to an example
    // instead, and the two must not read alike: "Melee attack" is what the
    // cell *will* say if left alone, "e.g. One creature" is only a suggestion.
    const under = String(e?.[f.key] ?? '');
    const ghost = under || (f.hint ? `e.g. ${f.hint}` : '');
    const control = f.options
      ? maneuverSelect(bind(f), own[f.key], f.options,
        under ? `${under} — from the catalogue` : '—')
      : prose(model, `${bind(f)} placeholder="${esc(ghost)}"`,
        own[f.key], f.lines || 1, 'grow', null, { ...UNREADIED, inactive: !e.known });
    return `<div class="mcell"><span class="k">${esc(f.label)}</span>${control}</div>`;
  };
  const lines = [...new Set(MANEUVER_FIELDS.map((f) => f.line))];
  return `<div class="medit">${lines.map((n) => `<div class="mline">${
    MANEUVER_FIELDS.filter((f) => f.line === n).map(cell).join('')}</div>`).join('')}</div>`;
}

/** A picker that keeps an answer its list has never heard of, marked with a *. */
function maneuverSelect(bindingAttr, value, options, blank) {
  const pairs = options.map((o) => [o, o]);
  if (value && !pairs.some(([v]) => v === value)) pairs.push([value, `${value} *`]);
  const opts = [['', blank], ...pairs]
    .map(([v, label]) => `<option value="${esc(v)}"${String(value ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  return `<select ${bindingAttr} data-kind="text">${opts}</select>`;
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
 *
 * `ctx.armedRemove` is which ask-twice × is armed -- element state, handed in.
 */
export function vancianPanel(model, ctx = {}) {
    const v = model.data.vancian;
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
        <p class="hint">A block picks the class whose table it draws slots from. That
          is separate from the block's name, so an archetype keeps its own name.
          Slots per day, spells known and the save DC follow from the table, the caster
          level counted from the Planner, and the casting stats. Type into any of them
          to override.</p>
        ${unknown.length ? `<p class="hint warn">No casting table for
          ${unknown.map((n) => `<strong>${esc(n)}</strong>`).join(', ')}. Those blocks
          keep whatever numbers you give them.</p>` : ''}
        ${(v.classes || []).length ? '' : '<p class="empty">No casting classes yet.</p>'}
      </section>

      ${(v.classes || []).length ? `<div class="vclasses">${
    (v.classes || []).map((c, i) => castingClassPanel(model, c, i)).join('')}</div>` : ''}

      <section class="panel span2">
        ${addButton('vancian.classes', 'Add casting class', {
    name: '', slotType: '', stat: '', stat2: '', prep: '', source: '',
    casterLevelOverride: null, concentration: null,
    spells: SPELL_LEVELS.map((level) => ({ level, perDay: null, known: null })),
  })}
      </section>
      ${vancianPreparedPanel(model, v, ctx)}
      ${systemExtrasPanel(model, v, 'vancian', 'Vancian Magic')}
    </div>`;
  }


function castingClassPanel(model, c, i) {
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

    return `<section class="panel vclass">
      <h3>
        ${itemText('vancian.classes', i, 'name', c.name, 'Casting class')}
        <span class="badge">CL ${c.casterLevel ?? 0}</span>${
  forwardedBadge(model, vancianForwardKey(c) || '', { waiting: c.casterLevelWaiting
    ? 'this class has no levels yet, so the bonus is held until its first level' : '' })}
        <span class="badge">${spends && c.totalLeft !== c.totalPerDay ? `${c.totalLeft ?? 0} of ` : ''}${c.totalPerDay ?? 0} ${esc(noun.many.toLowerCase())}/day</span>
        ${c.highestLevel ? `<span class="badge">up to level ${c.highestLevel}</span>` : ''}
        ${c.slotTypeUnknown ? '<span class="badge">no table</span>' : ''}
        <span class="pair" style="margin-left:auto">
          ${removeButton('vancian.classes', i, { what: 'this casting class', text: 'Remove' })}
        </span>
      </h3>
      <div class="vcast">
        <div class="vcast-row">
          ${castingStatCell(model, c, i)}
          ${field('Prepared as', select(`${base}.prep`, c.prep,
    PREP_STYLES.map((p) => [p.key, p.label])))}
          ${field('Source', select(`${base}.source`, c.source,
    CASTING_SOURCES.map((s) => [s.key, s.label])))}
        </div>
        <div class="vcast-row">
          ${field('Slot table', select(`${base}.slotType`, c.slotType, castingTableNames()), 'vtable')}
          ${field('Caster level', levelPin(`${base}.casterLevelOverride`, c.casterLevelOverride, c.plannerLevel, { width: '4.2rem' }))}
          ${field('Concentration', `<span class="rollpair">${
    exprField(`data-set="${base}.concentration"`,
      typeof c.concentration === 'string' || Number(c.concentration) ? c.concentration : '', {
        kind: 'expr-or-null',
        width: '4.2rem',
        value: c.concentrationNum,
        error: c.concentrationError,
        placeholder: String(c.concentrationAuto ?? 0),
        title: `Blank: caster level ${c.casterLevel ?? 0} + casting modifier ${fmt(c.statMod ?? 0)}. `
          + `Or a number, or a formula like ${vancianForwardKey(c) || 'vancian.wizard.cl'} + ${
            String(c.stat || 'Int').toLowerCase()}.mod`,
      })}${rollButton(model, 'concentration', `vancian:${i}`,
    `${c.name || 'this class'} concentration`)}</span>`)}
        </div>
      </div>
      ${c.tableName && c.tableName !== c.slotType
    ? `<p class="hint">Reading <strong>${esc(c.tableName)}</strong>'s table.</p>` : ''}
      ${levelPinHint(c.casterLevelOverride, c.casterLevelBase ?? c.casterLevel, c.plannerLevel)}
      ${countsTowardLine(model, vancianForwardKey(c) || '')}
      ${c.levelClass && c.levelClass !== String(c.name || '').trim()
    ? `<p class="hint">Counts <strong>${esc(c.levelClass)}</strong> levels.</p>` : ''}
      <div class="tablewrap"><table class="build vslots"><thead><tr>
        <th title="${esc(noun.one)} level">Level</th>
        <th class="num" title="${esc(noun.many)} per day">/day</th>
        ${hasBonus ? '<th class="num" title="Granted by the class itself, on top of the slots">Bonus</th>' : ''}
        <th class="num" title="${esc(noun.many)} known">Known</th>
        <th class="num" title="Save DC">DC</th>
        ${spends ? '<th title="Click a pip to spend or restore">Remaining today</th>' : ''}
      </tr></thead><tbody>
        ${(c.spells || []).map((s, si) => {
    const auto = slotText(s);
    const breakdown = s.base === null || s.base === undefined
      ? (s.atWill ? 'At will — the class knows cantrips' : 'Not castable at this level')
      : `${s.base} from the table${s.abilityBonus ? ` + ${s.abilityBonus} for the casting stat` : ''}`;
    const autoKnown = s.knownCount === null || s.knownCount === undefined ? '—' : String(s.knownCount);
    return `<tr>
          <th scope="row">${esc(s.level)}</th>
          <td class="num">${autoNum(`data-item="${base}.spells|${si}|perDay"`, s.perDay,
    { placeholder: auto, width: '4.2rem', title: `${breakdown}. Type a number to override.` })}</td>
          ${hasBonus ? `<td class="num total">${val(s.classBonus)}</td>` : ''}
          <td class="num">${autoNum(`data-item="${base}.spells|${si}|known"`, s.known, {
    placeholder: autoKnown,
    width: '4.2rem',
    title: style.known ? 'From the table. Type a number to override.'
      : 'A prepared caster fills slots from a spellbook, so this is not slot-derived.',
  })}</td>
          <td class="num total">${s.dc ?? 0}</td>
          ${spends ? `<td>${s.atWill ? '<span class="hint">at will</span>'
      : slotSpend({
        pool: `slots:${base}.spells|${si}`,
        total: s.slots,
        left: s.left,
        name: `${noun.one} level ${s.level}`,
      })}</td>` : ''}
        </tr>`;
  }).join('')}
      </tbody></table></div>
    </section>`;
  }

/**
 * The casting stat, its modifier, and the second stat folded under it.
 *
 * Few casters have a second stat, so its box stays behind a caret until asked
 * for. Once it holds a stat it is always shown: folding away a value that still
 * changes the numbers would hide why they are what they are. The fold is a
 * *shown* key, like `veil:showEmpty`, so an absent key means folded.
 */
function castingStatCell(model, c, i) {
  const base = `vancian.classes.${i}`;
  const key = `vstat2:${i}`;
  const asked = isOpen(model, key, false);
  const shown = !!c.stat2 || asked;
  const caret = c.stat2 ? '' : foldButton(model, key, {
    open: asked,
    cls: 'disclose',
    title: asked ? 'Hide the second stat' : 'Add a second casting stat',
    text: `${asked ? '▾' : '▸'} second`,
  });
  return `<div class="fld vstat">
      <span>Casting stat ${caret}</span>
      <span class="rollpair">${select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST)}<span
        class="vmod" title="Stat modifier">${fmt(c.statMod ?? 0)}</span></span>
      ${shown ? `<span class="vstat2">Second stat</span>${
    select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST)}` : ''}
    </div>`;
}

/**
 * What the spell list offers, as a `<datalist>` behind its name cells.
 *
 * One list for the tab rather than one per row: 5,344 spells is a large
 * enough document to emit once and no larger, and every row on the tab wants
 * the same one. It is narrowed to the casting classes this character
 * actually has -- a wizard is not offered the psychic list -- and left whole
 * where the sheet names none, because narrowing on what nobody imported has
 * to widen the answer rather than empty it.
 *
 * The row's own `C / L` cell says which level it was prepared at, and that is
 * a note to the player rather than a filter: a spell on two lists at two
 * levels is one spell, and hiding it because the cell reads "Wiz 3" when the
 * catalogue also calls it a 4th-level bard spell would be wrong.
 */
const SPELL_LIST_ID = 'cat-spells';

function spellDatalist(v) {
  // By the class whose list it is -- the slot table, or the class the block
  // counts levels from -- not the block's own name, which may be an
  // archetype's: "Wizard (Evoker)" casts from the wizard list.
  const classes = (v?.classes || [])
    // The table the slots came from first: it forgives a misspelt slot type,
    // and the list should answer to the same class the slots did.
    .map((c) => String(c?.tableName || c?.slotType || c?.levelClass || c?.name || '').trim()).filter(Boolean);
  return nameDatalist(SPELL_LIST_ID, 'spells', {
    classes, has: spellCatalogue().spells.length > 0,
  });
}

/**
 * The same for one manifesting class's powers, narrowed to its own list.
 *
 * One list per class rather than per tab, because that is the grain the
 * narrowing works at -- a psion and a wilder on the same sheet do not offer
 * each other's powers -- and the id carries the class name so two panels
 * never point at the same one.
 */
function powerListId(c) {
  return `cat-powers-${slug(String(c?.name || 'any'))}`;
}

function powerDatalist(c) {
  const name = String(c?.levelClass || c?.name || '').trim();
  return nameDatalist(powerListId(c), 'powers', {
    classes: name ? [name] : [], has: powerCatalogue().powers.length > 0,
  });
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
function vancianPreparedPanel(model, v, ctx = {}) {
    const list = 'vancian.prepared';
    const rows = v.prepared || [];
    const spells = rows.filter((r) => r.name).length;
    return `<section class="panel span2">
      <h3>Spell list <span class="badge">${spells}</span>
        ${v.calc?.spent ? `<span class="badge">${v.calc.spent} spent today</span>` : ''}
      </h3>
      <p class="hint">The workbook's first column was used as a label, not a tick box.
        Whatever is in it is kept as written. <strong>Prepared</strong> is
        how many times this spell is committed. The squares beside it show how many
        of those are left. <strong>Notes</strong> reads {…} like any prose field, so a
        spell's text can include its numbers and keep them current:
        <code>heals {2 + level}d8</code>.</p>
      ${spellDatalist(v)}
      ${rows.length ? `<div class="tablewrap"><table class="spelllist"><thead><tr>
        <th style="width:6.5rem">Label</th>
        <th style="width:4.5rem" title="Class and spell level">C / L</th>
        <th style="width:13rem">Spell</th>
        <th title="The spell's text or your own note — {…} formulas resolve">Notes</th>
        <th class="num" style="width:4rem" title="How many times this spell is prepared">Prep.</th>
        <th style="width:4.5rem" title="Click a square to spend or restore">Left</th><th></th>
      </tr></thead><tbody>
        ${rows.map((r, i) => `<tr>
          <td>${itemText(list, i, 'prepUsed', r.prepUsed, '')}</td>
          <td>${itemText(list, i, 'classLevel', r.classLevel, '')}</td>
          <td>${itemText(list, i, 'name', r.name, 'Spell', { list: SPELL_LIST_ID })}</td>
          <td>${r.name ? noteCell(
    prose(model, `data-item="${list}|${i}|note"`, r.note, 1, 'grow'),
    spellDetails(r), model.data.uiPrefs?.collapsed || {}, `${list}|${i}`, ctx,
  ) : ''}</td>
          <td class="num">${r.name ? itemNum(list, i, 'uses', r.uses) : ''}</td>
          <td class="spendcell">${r.name ? slotSpend({
    pool: `slots:${list}|${i}`, total: r.uses, left: r.left, shape: 'squares', name: r.name,
  }) : ''}</td>
          ${rowRemove(list, i, { what: r.name || 'this row', armed: ctx.armedRemove ?? null })}
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No spells listed.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add spell', {
    prepUsed: '', classLevel: '', name: '', uses: 1, used: 0, note: '',
  })}</div>
    </section>`;
  }

  /* ---------------- alternate training techniques ---------------- */

  /**
   * The technique, and the ladder it advances on.
   *
   * The workbook had this in four places and modelled it in none: the choice
   * is a dropdown on Character Info, and the ten levels it grants at are
   * printed on the Planner, on Vancian Magic and on Psionics -- three empty
   * copies of the same rows, none beside the choice they belong to. Here the
   * choice picks the ladder, the ladder states what each level hands over,
   * and the column beside it is what you took for it.
   *
   * The techniques themselves come from whatever pack supplies them (see
   * setAltTrainingTables): the panel draws the catalogue it is given, and an
   * empty one is a sentence saying so, never an error.
   */
export function altTrainingPanel(model) {
    const c = model.data;
    const p = c.altTraining || {};
    const k = p.calc || {};
    const level = Number(c.identity.level) || 0;
    const n = k.counts || {};
    // The tab is left off the bar with Alternate Training off (a campaign
    // rule); this is what stands in for it anywhere it is still drawn.
    if (k.off) {
      return `<section class="panel span2 mythicoff">
        <h3>Alternate Training <span class="badge">off</span></h3>
        <p class="hint">Alternate Training is off for this character in its campaign rules, so its
          technique grants nothing. What was picked here is kept, and counts again when it is turned
          on. <button data-view data-action="campaign-rules">Campaign rules…</button></p>
      </section>`;
    }

    const prereq = k.prereq;
    const prereqBadge = !prereq ? ''
      : `<span class="badge ${prereq.state === 'met' ? 'ok' : prereq.state === 'unmet' ? 'err' : ''}"
          title="${esc(prereq.detail || '')}">${
  prereq.state === 'met' ? 'prerequisite met'
    : prereq.state === 'unmet' ? 'prerequisite not met' : 'prerequisite unchecked'}</span>`;

    // Only the kinds this technique actually deals in: a ladder that grants
    // no spells has no business showing a spell count of zero.
    const totals = [
      ['Talents', n.talent, k.talents ? `${k.talents.count} ${k.talents.sphere} talents, counted into ${k.talents.side === 'magic' ? 'magic' : 'combat'} training` : ''],
      ['Feats', n.feat, 'Bonus feats granted so far'],
      ['Spells known', n.spell, 'Spells added so far'],
      ['Powers known', n.power, 'Powers added so far'],
    ].filter(([, v]) => v);

    return `<div class="grid">
      <section class="panel span2">
        <h3>Alternate Training Technique ${prereqBadge}
          ${n.due ? `<span class="badge due" title="Levels reached with nothing written against them">${n.due} to pick</span>` : ''}
        </h3>
        <div class="statbar">
          <label class="minifield">Technique
            ${select('altTraining.technique', p.technique,
    // A published document names a technique no pack here has; keep it listed.
    k.cited && k.technique ? [...new Set([...altTrainingNames(), k.technique])] : altTrainingNames(), '— none —')}</label>
          ${totals.map(([label, v, title]) => miniStat(label, v, title)).join('')}
          <span class="statbar-fill"></span>
          ${miniStat('Level', level, 'Grants above this level are planned, not counted')}
        </div>
        ${prereq ? `<p class="hint" style="margin-top:6px">
          <strong>Prerequisite:</strong> ${esc(prereq.text)}${prereq.detail ? ` — ${esc(prereq.detail)}` : ''}
          ${prereq.state === 'unmet' ? ' The technique still works here; this is a note, not a lock.' : ''}
        </p>` : ''}
        ${k.note ? `<p class="hint">${esc(k.note)}</p>` : ''}
        ${k.unknown ? `<p class="hint warn">The sheet names
          <strong>${esc(p.technique)}</strong>. That technique is not in the catalogue the active
          packs supply. The ladder below stays empty until the field names one that is.
          Whatever is written against a level is kept either way.</p>` : ''}
        <p class="hint">
          One technique, taken at 1st level or when its prerequisite is first met. It grants
          at 1st, 3rd, 5th, then ${k.repeatFrom ?? altTrainingRepeatFrom()}th and every two levels after.
          <strong>Grants</strong> is what the rules give at that level. The column beside it is what you
          took for it. It is filled in already on the levels where the rules name the grant. The last
          column is your note and takes formulas. A technique feat can be swapped under the Associated Feat
          rules if you are later given a feat for a sphere or talent you already have.
        </p>
      </section>

      ${k.technique ? altTrainingLadder(model, k) : altTrainingChooser()}

      <section class="panel span2">
        <h3>Notes</h3>
        ${prose(model, 'data-set="altTraining.notes"', p.notes, 3, 'grow')}
        <p class="hint">Resolves <code>{name = expr}</code> like any other prose field on the sheet.</p>
      </section>
    </div>`;
  }

  /** A grant's cite tag, linked where the pack, or the document's own copy, supplied a URL. */
function citeTag(cite, k = {}) {
    if (!cite) return '';
    const url = altTrainingLink(cite) || k.links?.[cite] || null;
    return url
      ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(cite)}">[${esc(cite)}]</a>`
      : ` <span class="hint">[${esc(cite)}]</span>`;
  }

  /**
   * The granting levels, what each hands over, what was taken for it, and
   * a note beside that.
   *
   * The name and the note were one box until the levels the rules already
   * name had nowhere to put their own name and nothing to type but a note.
   * They are two columns now: the name column carries what the rules named
   * where they named it, and the note takes formulas the way every other
   * note on the sheet does.
   */
function altTrainingLadder(model, k) {
    // Whatever this technique calls the thing it hands over -- a talent, a
    // spell, a power, a feat. The repeating grant is the one that says it
    // seven times, so it is the one that names the column.
    const noun = k.repeat?.pick?.label || 'Taken';
    return `<section class="panel span2">
      <div class="tablewrap"><table class="build primordia stacked">
        <thead><tr>
          <th class="num">Lvl</th>
          <th class="grants">Grants</th>
          <th class="pickname" title="What you took — filled in already where the rules name it">${esc(noun)}</th>
          <th class="picknote">Notes</th>
        </tr></thead>
        <tbody>${(k.rows || []).map((row) => {
    const pick = row.pick;
    const state = !pick ? '' : row.due ? ' due' : row.filled ? '' : ' planned';
    return `<tr class="${row.reached ? '' : 'future'}">
          <td class="num" data-stack="head" data-headlabel="Level" title="${row.repeating ? `Every two levels from the ${k.repeatFrom}th` : `The technique's ${row.level}${row.level === 1 ? 'st' : row.level === 3 ? 'rd' : 'th'}-level grant`}">${row.level}</td>
          <td class="grants" data-label="Grants">${row.grants.map((g) => `
            <span class="grant"${row.repeating && g.short ? ` title="${esc(g.text)}"` : ''}>${
  esc(row.repeating && g.short ? g.short : g.text)}${!row.repeating ? citeTag(g.cite) : ''}</span>
            ${g.base?.alt ? `<label class="chk alt"><input type="checkbox" ${g.alt ? 'checked' : ''}
              data-set="altTraining.alt.${row.level}" data-kind="bool"
              title="${esc(g.base.text)} — tick if you already had it, so this level grants the spell instead">
              <span>already had the feat, so this level grants ${esc(g.base.alt.text
    .replace(/^One /, 'a ').replace(/ added to your spells known$/, ''))} instead</span></label>` : ''}
          `).join('')}</td>
          <td class="choice${state}" data-stack="name">${altTrainingPick(model, row, k.talents?.sphere)}</td>
          <td class="picknote" data-label="Notes">${foldingNote(model, `data-set="altTraining.rowNotes.${row.level}"`, row.note,
    `altTraining.rowNotes.${row.level}`, { name: row.name })}</td>
        </tr>`;
  }).join('')}</tbody>
      </table></div>
      ${fillNotesButton(model, 'altTraining') ? `<div style="margin-top:8px">${fillNotesButton(model, 'altTraining')}</div>` : ''}
      ${k.talents?.sphere ? talentLegend() : ''}
      ${k.repeat ? `<p class="hint repeatrule">
        <strong>From ${k.repeatFrom}th, every two levels:</strong> ${esc(k.repeat.text)}${citeTag(k.repeat.cite)}
      </p>` : ''}
      <p class="hint">
        A reached level with no choice made yet is outlined and counted above. A level not
        reached yet is dotted and not counted. Levels whose grant the rules name show that
        name already. Type over it to record something else. Every row's note
        resolves <code>{name = expr}</code> like any other prose field on the sheet.
      </p>
    </section>`;
  }

  /**
   * The name cell: a dropdown where the rules offer two, otherwise free text.
   *
   * A level whose grant the rules already name shows that name as the
   * placeholder rather than as typed-in text, so it reads as filled without
   * pretending the player chose it -- the same bargain the automatic Levels
   * and BAB boxes on the Overview make. Typing over it wins, which is what an
   * archetype that swaps the grant needs.
   */
function altTrainingPick(model, row, sphere = null) {
    const path = `altTraining.picks.${row.level}`;
    /*
     * A level that grants a talent is looked up the way a sphere tab's row
     * is: the model says what the row would read as there -- "(leap)" is
     * "Athletics Sphere (leap)" -- and the mark goes beside whatever control
     * this cell turns out to be. The technique's own sphere first; a talent
     * taken from elsewhere is still found by the whole catalogue.
     */
    const lookup = model.altTrainingLookup(row);
    const mark = lookup ? (talentMark(sphere, lookup, undefined, model) || talentMark(null, lookup, undefined, model)) : '';
    const marked = (html) => (mark ? `<span class="tcell">${html}${mark}</span>` : html);
    // `data-altpick` hands the write to `setAltTrainingPick`, which fills the
    // row's empty note from the catalogue as a talent cell would.
    const pickAttr = row.grants.some((g) => g.talent) ? ` data-altpick="${row.level}"` : '';
    const options = row.pick?.options;
    if (options) return marked(select(path, row.text, options, '—', { attrs: pickAttr.trim() }));
    const placeholder = row.pick?.placeholder || row.auto || '—';
    const auto = !row.text.trim() && row.auto;
    // A pick carrying an inline formula shows what it comes to, the same way a
    // progression feature cell does.
    return marked(hasTokens(row.text)
      ? prose(model, `data-set="${path}"${pickAttr}`, row.text, 1, 'grow')
      : `<input type="text" class="autotext${auto ? ' auto' : ''}" value="${esc(row.text)}"
          data-set="${path}"${pickAttr} data-kind="text" placeholder="${esc(placeholder)}"${auto
  ? ` title="${esc(`${row.auto} — the technique's own. Type to put something else here.`)}"` : ''}>`);
  }

  /** With no technique taken, the catalogue on offer and what each asks for. */
function altTrainingChooser() {
    const techniques = altTrainingTechniques();
    if (!techniques.length) {
      return `<section class="panel span2">
        <h3>No techniques on offer</h3>
        <p class="empty">No active content pack supplies Alternate Training techniques.
          The tab still keeps whatever is written on it; switch on a pack that carries a
          catalogue (Extensions and Rules, top right) and the ladder appears.</p>
      </section>`;
    }
    return `<section class="panel span2">
      <h3>The ${techniques.length === 5 ? 'five' : techniques.length} techniques</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>Technique</th><th>Prerequisite</th><th>1st level</th><th>Then, every other level from ${altTrainingRepeatFrom()}th</th></tr></thead>
        <tbody>${techniques.map((t) => `<tr>
          <td><button data-action="take-technique" data-name="${esc(t.name)}"
            title="Take ${esc(t.name)}">${esc(t.name)}</button></td>
          <td>${esc(t.prereq?.text || '')}</td>
          <td>${(t.grants?.[1] || []).map((g) => esc(g.text)).join('; ')}</td>
          <td>${esc(t.repeat?.text || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Pick one. The ladder replaces this table. Nothing written on the tab is
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
export function psionicsPanel(model, ctx) {
    const p = model.data.psionics;
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
            ${meterStyleButton(ctx, 'pp')}
          </span>
        </h3>
        ${meterVisual(model.meterSpec('pp'), { pool: 'pp' })}
        ${meterStyleEditor(model, ctx, 'pp')}
        <div class="tracker-controls" style="margin-top:6px">
          ${powerPointStepper(left, pool)}
        </div>
        <div class="fieldgrid" style="margin-top:8px">
          ${field('Bonus points', num('psionics.bonusPoints', p.bonusPoints))}
        </div>
        <p class="hint">The pool is every manifesting class's points plus the bonus.
          The bonus is the one typed figure: points from a feat or an item.
          Readable from a formula as
          <code>pp.pool</code>, <code>pp.left</code> and <code>pp.spent</code>.</p>
        ${unknown.length ? `<p class="hint warn">No power-point curve reaches
          ${unknown.map((n) => `<strong>${esc(n)}</strong>`).join(', ')} at level 20.
          Those classes contribute nothing until a curve is picked.</p>` : ''}
        ${(p.classes || []).length ? '' : '<p class="empty">No manifesting classes yet.</p>'}
      </section>

      ${(p.classes || []).map((c, i) => manifestingClassPanel(model, c, i, ctx)).join('')}

      <section class="panel span2">
        ${addButton('psionics.classes', 'Add manifesting class', {
    name: '', stat: '', stat2: '', curveTotal: 0, manifesterLevelOverride: null, powers: [],
  })}
      </section>
      ${systemExtrasPanel(model, p, 'psionics', 'Psionics')}
    </div>`;
  }

  /** The curve options, labelled with the classes the reference tab lists for each. */
function curveOptions() {
    const classes = psionicTables().classes || [];
    return psionicCurveTotals().map((total) => {
      const names = classes.filter((c) => c.total === total).map((c) => c.name);
      return [total, names.length ? `${total} — ${names.join(', ')}` : `${total}`];
    });
  }


function manifestingClassPanel(model, c, i, ctx = {}) {
    const base = `psionics.classes.${i}`;
    const list = `${base}.powers`;
    const levels = psionicTables().powerLevels || [];

    return `<section class="panel span2">
      <h3>
        ${itemText('psionics.classes', i, 'name', c.name, 'Manifesting class')}
        <span class="badge">ML ${c.manifesterLevel ?? 0}</span>${
  forwardedBadge(model, manifesterForwardKey(c) || '', { waiting: c.manifesterLevelWaiting
    ? 'this class has no levels yet, so the bonus is held until its first level' : '' })}
        <span class="badge">${c.points ?? 0} pp</span>
        ${c.powerCount ? `<span class="badge">${c.powerCount} power${c.powerCount === 1 ? '' : 's'}</span>` : ''}
        ${c.curveTotal && !c.curveKnown ? '<span class="badge">no curve</span>' : ''}
        <span class="pair" style="margin-left:auto">
          ${removeButton('psionics.classes', i, { what: 'this manifesting class', text: 'Remove' })}
        </span>
      </h3>
      <div class="fieldgrid">
        ${field('Ability 1', select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST))}
        ${field('Ability 2', select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST))}
        ${field('Points at 20', select(`${base}.curveTotal`, c.curveTotal, curveOptions()))}
        ${field('Manifester level', levelPin(`${base}.manifesterLevelOverride`, c.manifesterLevelOverride, c.plannerLevel))}
      </div>
      ${line('From the curve', c.basePoints === null ? '—' : c.basePoints)}
      ${line('From abilities', fmt(c.abilityPoints ?? 0))}
      ${levelPinHint(c.manifesterLevelOverride, c.manifesterLevelBase ?? c.manifesterLevel, c.plannerLevel)}
      ${countsTowardLine(model, manifesterForwardKey(c) || '')}
      ${powerDatalist(c)}
      ${(c.powers || []).length ? `<table style="margin-top:8px"><thead><tr>
        <th>Power</th><th style="width:7rem">Level</th>
        <th title="The power's text or your own note — {…} formulas resolve">Notes</th><th></th>
      </tr></thead><tbody>
        ${(c.powers || []).map((w, wi) => `<tr>
          <td>${itemText(list, wi, 'name', w.name, 'Power', { list: powerListId(c) })}</td>
          <td>${itemSelect(list, wi, 'level', w.level, levels)}</td>
          <td>${w.name ? noteCell(
    prose(model, `data-item="${list}|${wi}|note"`, w.note, 1, 'grow'),
    powerDetails(w), model.data.uiPrefs?.collapsed || {}, `${list}|${wi}`, ctx,
  ) : ''}</td>
          ${rowRemove(list, wi)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No powers known.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add power', { name: '', level: '', note: '' })}</div>
    </section>`;
  }

  /* ---------------- companions ---------------- */

  /**
   * One companion's tab: the familiar, the animal companion, the eidolon or
   * the Conjuration sphere's conjured companion -- and a character may keep
   * more than one of each, so the tab opens with a strip of them and shows
   * one at a time, the way the tab bar itself shows one tab.
   *
   * Top: who it is and where its level comes from, with the numbers that
   * matter in play in a strip. Then hit points, ability scores, defences and
   * saves, attacks, skills -- and the panels only one kind has: the eidolon's
   * evolutions, the animal companion's tricks and item slots, the conjured
   * companion's Archetype panel (base form, archetypes) and talents.
   * Everything not typed is worked out in `companions.js` from the tables the
   * workbook's `dataSheet` carried (the wiki's, for the conjured companion), and reads
   * back from a formula as `familiar.hp`, `eidolon.evoLeft`,
   * `animalCompanion.str.mod`, `conjured.summonCost`.
   *
   * The context `cc` carries what every sub-panel needs to know about *which*
   * companion it is drawing: `p` is the data path its fields write to
   * (`eidolon.1`), `sn` the scope name its numbers read back and take bonuses
   * under (the block's id: `eidolon` for the first of a kind, `eidolon2`
   * after), and `roll` the kind a d20 button reports (`eidolon:1`). One
   * companion, three spellings, all decided in one place.
   */
export function companionPanel(model, kind) {
    const list = model.data[kind] || [];
    if (!list.length) return '<div class="grid"><p class="empty">No companion data.</p></div>';
    const stored = Number(model.data.uiPrefs?.activeCompanion?.[kind]);
    const i = Number.isInteger(stored) && stored >= 0 && stored < list.length ? stored : 0;
    const b = list[i];
    const k = b.calc || {};
    const label = COMPANION_LABELS[kind];
    const cc = {
      kind, i, b, k, label,
      p: `${kind}.${i}`,
      sn: companionScopeName(kind, b),
      roll: i === 0 ? kind : `${kind}:${i}`,
    };
    return `<div class="grid companion">
      ${companionSwitchPanel(model, kind, list, i, label)}
      ${companionSections(model, cc)}
    </div>`;
  }

  /** Every panel of one companion after the switch: the body the tab and the GM's control page share. */
function companionSections(model, cc) {
    const { kind } = cc;
    return `${companionHeadPanel(model, cc)}
      ${companionHpPanel(cc)}
      ${companionScoresPanel(model, cc)}
      ${companionDefensePanel(model, cc)}
      ${companionSavesPanel(model, cc)}
      ${kind === 'conjured' ? conjuredArchetypePanel(model, cc) : ''}
      ${kind === 'conjured' ? conjuredCastingPanel(model, cc) : ''}
      ${companionAttacksPanel(model, cc)}
      ${kind === 'eidolon' ? eidolonEvolutionsPanel(model, cc) : ''}
      ${kind === 'animalCompanion' ? companionTricksPanel(model, cc) : ''}
      ${kind === 'conjured' ? conjuredTalentsPanel(model, cc) : ''}
      ${kind === 'familiar' ? '' : companionFeatsPanel(model, cc)}
      ${companionSkillsPanel(model, cc)}
      ${companionItemsPanel(model, cc)}
      ${/* Paired rather than left to the grid. Both are ordinary panels, so on
            a wide screen they landed in two 310px tracks at the end of a row
            of four and took a quarter of the window between them, with the
            rest of the row empty behind them. The abilities are a list that
            opens out and want the room; the notes are a box to write in and
            read fine at their measure; a `lead` band, stacked where the
            pair does not fit. */''}
      <div class="band lead">
        ${companionGainsPanel(model, cc)}
        ${companionNotesPanel(model, cc)}
      </div>`;
  }

  /**
   * One companion, read-only, for the GM's control page: every panel of its
   * tab inside a disabled fieldset, so the markup is the tab's and nothing
   * on it takes a press. Found by id, since a grant names the member by id.
   */
export function companionFace(model, kind, id) {
    const list = model.data[kind] || [];
    const i = list.findIndex((b) => String(b?.id ?? '') === String(id));
    if (i < 0) return '';
    const b = list[i];
    const cc = { kind, i, b, k: b.calc || {}, label: COMPANION_LABELS[kind], p: `${kind}.${i}`, sn: companionScopeName(kind, b), roll: i === 0 ? kind : `${kind}:${i}` };
    return `<fieldset disabled class="companionface"><div class="grid companion">${companionSections(model, cc)}</div></fieldset>`;
  }


/**
 * The strip of a kind's companions: one chip each, the one being shown
 * pressed, an Add for the minionmancer and a Remove for the one on screen.
 *
 * Shown once there is more than one to switch between (or the strip would be
 * a single chip restating the tab), but the Add is always there -- it is how
 * the second one comes to exist. Every chip wears the id a formula reads the
 * companion by, the way a tracker's row wears its own.
 */
function companionSwitchPanel(model, kind, list, active, label) {
    const many = list.length > 1;
    return `<section class="panel span2 companionswitch">
      <div class="statline" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${many ? list.map((c, i) => `<button data-view data-action="companion-select" data-kind="${kind}" data-index="${i}"
          aria-pressed="${i === active}" ${i === active ? 'class="primary"' : ''}
          title="Reads in formulas as ${esc(c.id)}.*">
          ${esc(String(c.name || '').trim() || `${label} ${i + 1}`)}
          <span class="hint">${c.calc?.level ? `L${c.calc.level} ` : ''}<code>${esc(c.id)}</code></span>
        </button>`).join('') : ''}
        <button data-action="companion-add" data-kind="${kind}"
          title="Another ${label.toLowerCase()} — its numbers get a name of their own (${kind}2.*, ${kind}3.*), so a rule can be aimed at each">+ Add ${esc(label.toLowerCase())}</button>
        ${many ? removeButton(kind, active, {
    what: `this ${label.toLowerCase()}`,
    title: `Remove the ${label.toLowerCase()} being shown. Undo brings it back.`,
    text: 'Remove this one',
    style: 'margin-left:auto',
  }) : ''}
      </div>
      ${many ? `<p class="hint">One of ${list.length}. Each reads and takes bonuses under the id on its chip:
        <code>${kind}.hp</code>, <code>${kind}2.hp</code>. The id stays with the creature through a
        rename or a reordering.</p>` : ''}
    </section>`;
  }


function companionLevelControls(model, cc) {
    const { kind, p, b, k } = cc;
    if (kind === 'familiar') {
      return `${field('Master level penalty', num(`${p}.masterLevelPenalty`, b.masterLevelPenalty, 'min="0"'))}
        ${field('Protector archetype', check(`${p}.protector`, b.protector, 'doubles hit points from 11th'))}`;
    }
    const classes = model.progressionClasses();
    const source = kind === 'animalCompanion'
      ? field('Level from', select(`${p}.levelSource`, b.levelSource || 'class', COMPANION_LEVEL_SOURCES, null))
      : kind === 'conjured'
        ? field('Level from', select(`${p}.levelSource`, b.levelSource || 'casterLevel', CONJURED_LEVEL_SOURCES, null))
        : '';
    const showClass = kind === 'eidolon'
      || (b.levelSource || (kind === 'conjured' ? 'casterLevel' : 'class')) === 'class';
    const autoFrom = kind === 'animalCompanion' && b.levelSource === 'handleAnimal' ? 'Handle Animal ranks'
      : kind === 'animalCompanion' && b.levelSource === 'ride' ? 'Ride ranks'
        : kind === 'conjured' && (b.levelSource || 'casterLevel') === 'casterLevel'
          ? 'the Conjuration sphere’s caster level on the Magic Spheres tab' : 'the class’s levels in the Planner';
    return `${source}
      ${showClass ? field('Master class', select(`${p}.masterClass`, b.masterClass, classes)) : ''}
      ${field('Level override', autoNum(`data-set="${p}.levelOverride"`, b.levelOverride, {
    placeholder: k.rawLevel ?? 0,
    title: `Auto: ${k.rawLevel ?? 0} from ${autoFrom}. Enter a number to pin it.`,
    extra: `min="0" max="${kind === 'conjured' ? 40 : 20}"`,
  }))}
      ${field('Master level penalty', num(`${p}.masterLevelPenalty`, b.masterLevelPenalty, 'min="0"'))}`;
  }


function companionHeadPanel(model, cc) {
    const { kind, p, sn, roll, b, k, label } = cc;
    const saves = k.saves || {};
    const sv = (x) => fmt(saves[x]?.total ?? 0);
    // Each figure in the strip carries its working -- the same panel the
    // character's own strip opens, keyed by the name the number reads by.
    const w = (stat, shown) => working(model, `${sn}.${stat}`, shown);
    const identity = kind === 'familiar' ? `
        ${field('Creature', text(`${p}.creature`, b.creature, 'Owl, cat, thrush…'))}
        ${field('Archetypes', text(`${p}.archetypes`, b.archetypes))}
        ${field('Special ability', text(`${p}.specialAbility`, b.specialAbility, 'What this familiar grants its master'))}`
      : kind === 'animalCompanion' ? `
        ${field('Creature', text(`${p}.creature`, b.creature, 'Wolf, roc, big cat…'))}
        ${field('Archetype', text(`${p}.archetype`, b.archetype))}
        ${field('Body type', select(`${p}.bodyType`, b.bodyType, BODY_TYPES.map((t) => t.name)))}`
      : kind === 'conjured' ? `
        ${field('Base form', select(`${p}.baseForm`, b.baseForm, CONJURED_BASE_FORMS.map((f) => f.name)))}
        ${field('Alignment', text(`${p}.alignment`, b.alignment))}`
        : `
        ${field('Base form', text(`${p}.baseForm`, b.baseForm, 'Biped, quadruped, serpentine…'))}
        ${field('Subtype', text(`${p}.subtype`, b.subtype))}
        ${field('Alignment', text(`${p}.alignment`, b.alignment))}`;
    return `<section class="panel span2">
      <h3>${esc(String(b.name || '').trim() || label)}
        <span class="badge" title="${esc(`The name this companion’s numbers read by in a formula — ${cc.sn}.hp, ${cc.sn}.ac.total — and a bonus is sent to. It stays with the creature through a rename or a reordering.`)}">${esc(cc.sn)}</span>
        <span class="badge">${working(model, `${sn}.level`, `level ${k.level ?? 0}`)}</span>
        <span class="badge">${k.hd ?? 0} HD${kind === 'conjured' && k.hitDie ? ` (d${k.hitDie})` : ''}</span>
        ${kind === 'conjured' && k.summonCost !== undefined
    ? `<span class="badge" title="A standard action; one more spell point lets it stay a minute per caster level without concentration">${k.summonCost} sp to summon</span>` : ''}
        ${(k.archetypes || []).map((a) => `<span class="badge">${esc(a.toLowerCase())}</span>`).join('')}
        ${k.penalty ? `<span class="badge">−${k.penalty} master level</span>` : ''}
        ${!k.level ? '<span class="badge">no level yet</span>' : ''}
      </h3>
      <div class="cportrait">
        ${b.image ? `<img class="portrait" src="${esc(b.image)}" alt="" loading="lazy">` : ''}
        <div class="fieldgrid">
          ${field('Name', text(`${p}.name`, b.name, `${label} name`))}
          ${identity}
          ${field('Size', select(`${p}.size`, b.size, Object.keys(SIZE_MODIFIERS), null))}
          ${companionLevelControls(model, cc)}
          ${field('Portrait URL', text(`${p}.image`, b.image, 'https://…'))}
        </div>
      </div>
      <div class="bigstats" style="margin-top:10px">
        ${bigStat('HP', { html: w('hp', esc(`${k.hpCurrent ?? 0} / ${k.hpMax ?? 0}`)) }, k.hpTemp ? `+${k.hpTemp} temp` : '')}
        ${bigStat('AC', { html: w('ac', String(k.ac ?? 10)) }, `touch ${k.touch ?? 10} · flat ${k.flatFooted ?? 10}`)}
        ${bigStat('Init', { html: w('init', fmt(k.initiative ?? 0)) }, 'Dex + bonus', '',
    rollButton(model, roll, 'init', `${label.toLowerCase()} initiative`))}
        ${bigStat('BAB', fmt(k.bab ?? 0), kind === 'familiar' ? 'master’s' : 'from the table')}
        ${bigStat('Attack', { html: w('attack', fmt(k.totalAttack ?? 0)) }, `${k.attackAbility || 'Str'} + size`)}
        ${bigStat('CMD', { html: w('cmd', String(k.cmd ?? 10)) }, `flat ${k.ffCmd ?? 10}`)}
        ${bigStat('Fort', { html: w('fort', sv('fort')) }, kind === 'familiar' ? 'master’s base' : ((k.formSaves || b.goodSaves)?.fort ? 'good' : 'poor'))}
        ${bigStat('Ref', { html: w('ref', sv('ref')) }, kind === 'familiar' ? 'master’s base' : ((k.formSaves || b.goodSaves)?.ref ? 'good' : 'poor'))}
        ${bigStat('Will', { html: w('will', sv('will')) }, kind === 'familiar' ? 'master’s base' : ((k.formSaves || b.goodSaves)?.will ? 'good' : 'poor'))}
      </div>
      <p class="hint">${kind === 'familiar'
    ? 'A familiar’s level is its master’s level. It uses the master’s BAB and base saves. It has half the master’s hit points. Its Intelligence and natural armour come from the familiar table.'
    : kind === 'animalCompanion'
      ? 'The level is the master’s levels in the class named, less any penalty. A Spheres companion uses ranks in Handle Animal or Ride instead. HD, BAB, saves, skill ranks, feats, natural armour, the Str/Dex bonus and bonus tricks follow the animal companion table.'
      : kind === 'conjured'
        ? 'The level is the Conjuration sphere’s caster level, less any penalty. That is the CL on the sphere’s row of the Magic Spheres table, its own bonuses included. A class’s levels can be used instead. HD, BAB, saves, skill points, feats and natural armour follow the Conjuration sphere’s companion table. The base form adds its own natural armour, saves and starting scores. Archetypes that change the progression are ticked below.'
        : 'The level is the master’s levels in the class named, less any penalty. HD, BAB, saves, feats, natural armour, the Str/Dex bonus, the evolution pool and the attack cap follow the eidolon table.'}
        Readable from a formula as <code>${esc(sn)}.hp</code>, <code>${esc(sn)}.ac</code>, <code>${esc(sn)}.str.mod</code>…</p>
    </section>`;
  }


function companionHpPanel(cc) {
    const { kind, p, b, k, i } = cc;
    const hp = b.hp || {};
    const cur = k.hpCurrent ?? 0;
    return `<section class="panel">
      <h3>Hit points <span class="badge">${cur} of ${k.hpMax ?? 0}</span>${cur <= 0 ? '<span class="badge">down</span>' : ''}</h3>
      ${line('Maximum', k.hpMax ?? 0)}
      ${line('Damage taken', hp.damage || 0)}
      <div class="fieldgrid two" style="margin-top:6px">
        ${field('Temporary', num(`${p}.hp.temp`, hp.temp, 'min="0"'))}
        ${field('Bonus max HP', num(`${p}.hp.bonus`, hp.bonus))}
        ${kind === 'familiar' ? '' : field('HP ability', abilitySelect(`${p}.hpAbility`, b.hpAbility))}
      </div>
      <div class="hpactions">
        <input type="number" value="0" data-companion-amount="${kind}:${i}" aria-label="Amount" min="0">
        <button data-action="companion-hp" data-kind="${kind}" data-index="${i}" data-op="damage" class="danger">Damage</button>
        <button data-action="companion-hp" data-kind="${kind}" data-index="${i}" data-op="heal">Heal</button>
        <button data-action="companion-hp" data-kind="${kind}" data-index="${i}" data-op="rest" class="primary">Rest</button>
      </div>
      <p class="hint">${kind === 'familiar'
    ? `Half the master’s maximum${k.protectorDoubles ? ', doubled for a Protector' : ''}, plus the bonus.`
    : `${kind === 'conjured'
      ? `${k.hpPerDie ?? 10} per hit die (the full d${k.hitDie ?? 10}${k.hitDie === 6 ? ', the mage archetype’s' : ''}, as the character’s own levels are counted)`
      : '8 per hit die'} plus the ${esc(b.hpAbility || 'Con')} modifier per die, plus the bonus. Damage spends temporary points first.`}</p>
    </section>`;
  }


function companionScoresPanel(model, cc) {
    const { kind, p, sn, roll, b, k } = cc;
    const sc = k.scores || {};
    const evo = kind === 'eidolon';
    const incs = b.abilityIncreases || [];
    const list = `${p}.abilityIncreases`;
    return `<section class="panel">
      <h3>Ability scores</h3>
      <div class="tablewrap"><table class="build compact"><thead><tr>
        <th scope="col">Score</th><th scope="col">Base</th>${evo ? '<th scope="col">Evo</th>' : ''}
        <th scope="col" title="The table’s Str/Dex bonus and the +1s at the increase levels">Level</th>
        <th scope="col">Misc</th><th scope="col" class="num">Total</th><th scope="col" class="num">Mod</th>
      </tr></thead><tbody>
        ${ABILITIES.map((a) => {
    const s = sc[a] || {};
    const base = kind === 'familiar' && a === 'int'
      ? autoNum(`data-set="${p}.scores.int.base"`, b.scores?.int?.base, {
        placeholder: k.tableInt ?? '',
        title: `Auto: ${k.tableInt ?? ''} from the familiar table. Enter a number to pin it.`,
      })
      : kind === 'conjured'
        ? autoNum(`data-set="${p}.scores.${a}.base"`, b.scores?.[a]?.base, {
          placeholder: s.base ?? 10,
          title: `Auto: ${s.base ?? 10} from ${b.baseForm ? `the ${b.baseForm} base form` : 'the default line'}${
            b.size === 'Small' ? ', Small-adjusted' : ''}. Enter a number to pin it.`,
        })
        : num(`${p}.scores.${a}.base`, b.scores?.[a]?.base ?? 10);
    return `<tr>
          <th scope="row"><span class="abmark" data-ab="${a}">${ABILITY_LABELS[a]}</span></th>
          <td>${base}</td>
          ${evo ? `<td>${num(`${p}.scores.${a}.evo`, b.scores?.[a]?.evo)}</td>` : ''}
          <td class="num derived">${fmt(s.lvlUp || 0)}</td>
          <td>${num(`${p}.scores.${a}.misc`, b.scores?.[a]?.misc)}${
      forwardedBadge(model, `${sn}.${a}.score`)}</td>
          <td class="num total">${working(model, `${sn}.${a}`, String(s.total ?? 10))}</td>
          <td class="num"><span class="rollpair">${fmt(s.mod ?? 0)}${
      rollButton(model, roll, `ability:${a}`, `a ${ABILITY_LABELS[a]} check`)}</span></td>
        </tr>`;
  }).join('')}
      </tbody></table></div>
      ${incs.length ? `<div class="fieldgrid tight" style="margin-top:8px">
        ${incs.map((inc, i) => field(`+1 at ${kind === 'conjured' ? `${inc.level} HD` : `level ${inc.level}`}${
    (kind === 'conjured' ? (k.hd ?? 0) : (k.level ?? 0)) >= inc.level ? '' : ' (not yet)'}`,
    itemSelect(list, i, 'ability', inc.ability, ABILITY_LABELS_LIST))).join('')}
      </div>` : ''}
      ${evo ? `<p class="hint">Evo is the Ability Increase evolution, at most +${k.maxBonusPerStat ?? 2} to any one score at this level.
        ${(k.evoBonusOver || []).length ? `<span class="warn">Over the cap: ${k.evoBonusOver.join(', ')}.</span>` : ''}</p>` : ''}
    </section>`;
  }


function companionDefensePanel(model, cc) {
    const { kind, p, sn, roll, b, k } = cc;
    // Every one of these is a destination now, so each says beside itself
    // what has been forwarded to it and from where.
    const fwd = (name) => forwardedBadge(model, `${sn}.${name}`);
    // ...and each carries its working, opened on the number itself.
    const w = (stat, shown) => working(model, `${sn}.${stat}`, shown);
    return `<section class="panel">
      <h3>Defences <span class="badge">AC ${k.ac ?? 10}</span></h3>
      ${lineHtml('Armor class', `${w('ac', String(k.ac ?? 10))}${fwd('ac.total')}`, true)}
      ${lineHtml('Touch', `${w('touch', String(k.touch ?? 10))}${fwd('ac.touch')}`)}
      ${lineHtml('Flat-footed', `${w('ff', String(k.flatFooted ?? 10))}${fwd('ac.flatFooted')}`)}
      ${lineHtml('CMD', `${w('cmd', String(k.cmd ?? 10))} (flat ${w('ffCmd', String(k.ffCmd ?? 10))})${fwd('cmd')}`)}
      ${lineHtml('CMB', `<span class="rollpair">${w('cmb', fmt(k.cmb ?? 0))}${
        rollButton(model, roll, 'cmb', 'a combat maneuver')}</span>${fwd('cmb')}`)}
      ${lineHtml('Initiative', `<span class="rollpair">${w('init', fmt(k.initiative ?? 0))}${
        rollButton(model, roll, 'init', 'initiative')}</span>${fwd('init')}`)}
      <div class="fieldgrid" style="margin-top:8px">
        ${field('Bonus AC (all)', formulaBox(cc, 'ac.all'))}
        ${field('Touch only', formulaBox(cc, 'ac.touch'))}
        ${field('Flat-footed only', formulaBox(cc, 'ac.ff'))}
        ${field('CMD other', formulaBox(cc, 'cmdOther'))}
        ${field('CMB other', formulaBox(cc, 'cmbOther'))}
        ${field('CMB ability', select(`${p}.cmbAbility`, b.cmbAbility, ABILITY_LABELS_LIST,
    `auto (${['Tiny', 'Diminutive', 'Fine'].includes(b.size) ? 'Dex' : 'Str'})`))}
        ${field('Initiative bonus', formulaBox(cc, 'initBonus'))}
      </div>
      <p class="hint">AC is 10 + Dex + size ${fmt(k.sizeAC ?? 0)} + natural armour ${fmt(k.tableNatural ?? 0)} from the table
        + the bonuses. <em>All</em> counts in every AC (deflection, luck, insight…). <em>Touch only</em>
        is for dodge, which flat-footed loses. <em>Flat-footed only</em> is for armour and extra natural armour.
        CMD takes <em>all</em>, dodge, and every penalty. CMB is BAB + ${esc(k.cmbAbility || 'Str')} + the
        special size modifier ${fmt(-(k.sizeAC ?? 0))}. CMD uses the same size modifier. Tiny or smaller uses Dex.</p>
      ${kind === 'eidolon' || kind === 'conjured' ? `<div class="fieldgrid" style="margin-top:8px">
        ${field('DR', text(`${p}.dr`, b.dr))}
        ${field('Resistances', text(`${p}.resistances`, b.resistances))}
        ${field('Immunities', text(`${p}.immunities`, b.immunities))}
      </div>` : ''}
    </section>`;
  }


function companionSavesPanel(model, cc) {
    const { kind, p, sn, roll, b, k } = cc;
    const saves = k.saves || {};
    const rows = [['fort', 'Fortitude', 'Con'], ['ref', 'Reflex', 'Dex'], ['will', 'Will', 'Wis']];
    // Every column as narrow as what it holds, and the rest of the width to
    // Misc, which takes a formula and wants the room to show one.
    return `<section class="panel">
      <h3>Saves</h3>
      <div class="tablewrap"><table class="build compact compsaves"><thead><tr>
        <th scope="col">Save</th>${kind === 'familiar' ? '' : '<th scope="col" class="good">Good</th>'}
        <th scope="col" class="num">Base</th><th scope="col" class="num">Ability</th>
        <th scope="col" class="misc">Misc</th><th scope="col" class="num">Total</th>
      </tr></thead><tbody>
        ${rows.map(([key, name, ab]) => `<tr>
          <th scope="row">${name}<span class="hint" style="margin-left:4px">${ab}</span></th>
          ${kind === 'familiar' ? '' : k.formSaves
    // The base form sets these; a tick here would change nothing.
    ? `<td class="good"><label class="chk tick"><input type="checkbox" disabled ${k.formSaves[key] ? 'checked' : ''}
        title="${esc(`${k.formSaves[key] ? 'Good' : 'Poor'} — set by the ${b.baseForm} form`)}"></label></td>`
    : `<td class="good">${check(`${p}.goodSaves.${key}`, b.goodSaves?.[key])}</td>`}
          <td class="num derived">${fmt(saves[key]?.base ?? 0)}</td>
          <td class="num derived">${fmt(saves[key]?.mod ?? 0)}</td>
          <td class="misc"><span class="miscbox">${formulaBox(cc, `saves.${key}.misc`)}${
            forwardedBadge(model, `${sn}.${key}`)}</span></td>
          <td class="num total"><span class="rollpair">${working(model, `${sn}.${key}`, fmt(saves[key]?.total ?? 0))}${
            rollButton(model, roll, `save:${key}`, `a ${name} save`)}</span></td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="hint">${kind === 'familiar'
    ? 'Base saves are the master’s, never below +2.'
    : kind === 'conjured' && k.formSaves
      ? `The ${esc(b.baseForm)} form’s good saves are ${['fort', 'ref', 'will']
        .filter((x) => k.formSaves[x]).map((x) => ({ fort: 'Fortitude', ref: 'Reflex', will: 'Will' }[x])).join(' and ') || 'none, as printed'}. The table gives the good and poor base at this HD.`
      : 'Tick the good saves. The table gives the good and poor base at this level.'}</p>
      <h4 class="subhead">Speed</h4>
      ${speedTable(`${p}.speeds`, b.speeds || [], k.speeds || [], { example: `30 + 10 * floor(${sn}.hd / 5)` })}
    </section>`;
  }


/**
 * One of a companion's typed bonus boxes (COMPANION_FORMULA_FIELDS), which
 * takes a formula as readily as a number: it shows what the formula came to
 * and opens on the formula when clicked into, as the character's own do.
 */
function formulaBox(cc, path) {
    const { p, b, k, sn } = cc;
    const r = k.typed?.[path];
    return exprField(`data-set="${p}.${path}"`, getPath(b, path) ?? 0, {
      width: '100%',
      value: r && !r.error ? String(r.value) : null,
      error: r?.error || null,
      title: `A number, or a formula like floor(${sn}.hd / 2)`,
    });
  }


function companionAttacksPanel(model, cc) {
    const { kind, p, sn, roll, b, k } = cc;
    const list = `${p}.attacks`;
    const rows = b.attacks || [];
    const types = NATURAL_ATTACKS.map((a) => a.name);
    // What a rule adds to a row's damage: the bonus to every natural attack
    // and the one to this attack by name, together on one badge.
    const damageInto = (a) => {
      const key = companionAttackKey(a);
      return [`${sn}.damage`, ...(key && key !== 'x' ? [`${sn}.damage.${key}`] : [])];
    };
    const cap = kind === 'eidolon' && k.maxAttacks ? ` <span class="badge${rows.length > k.maxAttacks ? ' err' : ''}">${rows.length} of ${k.maxAttacks} attacks</span>` : '';
    return `<section class="panel span2">
      <h3>Attacks <span class="badge">${fmt(k.totalAttack ?? 0)} to hit</span>${cap}
        <span class="pair" style="margin-left:auto">
          <label class="fld"><span>Ability</span>${select(`${p}.attackAbility`, b.attackAbility, ABILITY_LABELS_LIST, kind === 'familiar' ? 'auto (better of Str / Dex)' : '—')}</label>
          <label class="fld"><span>Misc</span>${num(`${p}.attackBonus`, b.attackBonus, 'style="width:3.6rem"')}</label>
        </span>
      </h3>
      ${rows.length ? `<div class="tablewrap"><table class="compattacks"><thead><tr>
        <th>Type</th><th>Damage</th><th title="A flat bonus to this attack’s damage">Dmg +</th>
        <th>Crit</th><th>Role</th><th title="A flat bonus to this attack’s to-hit">Bonus</th>
        <th class="num">To hit</th><th>Damage type</th><th>Qualities</th><th></th>
      </tr></thead><tbody>
        ${rows.map((a, i) => `<tr>
          <td>${itemSelect(list, i, 'type', a.type, types)}</td>
          <td>${itemText(list, i, 'damage', a.damage, '1d6')}</td>
          <td class="num">${itemNum(list, i, 'dmgBonus', a.dmgBonus)}${
            forwardedBadge(model, damageInto(a), { note: 'The roll adds it to the flat part of the damage.' })}</td>
          <td>${itemText(list, i, 'crit', a.crit, '20/×2')}</td>
          <td>${itemSelect(list, i, 'primary', a.primary === true ? 'primary' : a.primary === false ? 'secondary' : String(a.primary || ''),
    [['primary', 'Primary'], ['secondary', 'Secondary']], `auto (${a.primaryResolved ? 'primary' : 'secondary'})`)}</td>
          <td>${itemNum(list, i, 'bonus', a.bonus)}${
            forwardedBadge(model, `${sn}.attack.${companionAttackKey(a)}`)}</td>
          <td class="num total"><span class="rollpair">${fmt(a.toHit ?? 0)}${
            rollButton(model, roll, `attack:${i}`, `${a.type || 'this attack'} — attack and damage`)}</span></td>
          <td>${esc(a.damageType || '')}</td>
          <td>${itemArea(model, list, i, 'qualities', a.qualities, 1)}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No attacks yet.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add attack', { type: 'Bite', damage: '', crit: '20/×2', primary: null, bonus: 0, dmgBonus: 0, qualities: '' })}</div>
      <p class="hint">Secondary attacks take −5${k.multiattack ? ' (−2 here, with Multiattack)' : ' (−2 with Multiattack)'}.
        Role on auto follows the natural-attack table. Damage is kept as you write it,
        “1d6 plus grab” or “1d6+7”. A bonus to damage goes in the column beside it and is
        added to the flat part of the roll.</p>
    </section>`;
  }


function eidolonEvolutionsPanel(model, cc) {
    const { p, sn, b, k } = cc;
    const list = `${p}.evolutions`;
    const rows = b.evolutions || [];
    const over = (k.evoLeft ?? 0) < 0;
    return `<section class="panel span2">
      <h3>Evolutions
        <span class="badge${over ? ' err' : ''}">${k.evoSpent ?? 0} of ${k.evoPool ?? 0} points</span>
        <span class="pair" style="margin-left:auto">
          <label class="fld"><span>Bonus points</span>${num(`${p}.bonusEvoPoints`, b.bonusEvoPoints, 'style="width:3.6rem"')}</label>
        </span>
      </h3>
      ${/* The same split the items table had: with only the name and the notes
            left free the table halved the row between them, so the name got
            room for fifty characters it never uses while the type was penned
            into 8rem -- not enough for "4-point evolution" -- and the notes
            took what was left. Capped to what each actually holds. */''}
      ${rows.length ? `<div class="tablewrap"><table class="evolutions"><thead><tr>
        <th style="width:13rem">Evolution</th><th style="width:4rem">Cost</th>
        <th style="width:10rem">Type</th><th>Notes</th><th></th>
      </tr></thead><tbody>
        ${rows.map((e, i) => `<tr>
          <td>${itemText(list, i, 'name', e.name, 'Evolution')}</td>
          <td>${itemNum(list, i, 'cost', e.cost)}</td>
          <td>${itemText(list, i, 'type', e.type, 'Base form, 1-pt…')}</td>
          <td>${itemArea(model, list, i, 'notes', e.notes, 1)}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No evolutions yet.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add evolution', { name: '', cost: 1, type: '', notes: '' })}</div>
      ${over ? `<p class="hint warn">${-(k.evoLeft ?? 0)} point${k.evoLeft === -1 ? '' : 's'} over the pool.</p>` : ''}
      <div class="fieldgrid" style="margin-top:8px">
        <label class="fld" style="grid-column:1/-1"><span>Base form evolutions (free, by level)</span>
          ${prose(model, `data-set="${p}.baseEvolutions"`, b.baseEvolutions, 2)}</label>
      </div>
      <p class="hint">The pool is the table’s at this level, less the master-level penalty, plus the bonus points.
        Readable as <code>${esc(sn)}.evoPool</code> and <code>${esc(sn)}.evoLeft</code>.</p>
    </section>`;
  }


/*
 * Tricks and feats are the same three columns and are built the same way, so
 * they are one function called twice rather than two that drift.
 *
 * They used to be `.rowlist .item.statline` -- a label and a value pushed to
 * opposite ends, which is a shape for a word and a number and not for three
 * controls. Every part of it went wrong at once: `.pair input` is 3.4rem wide
 * because a pair is normally a cluster of small numbers, so the name got six
 * characters ("Unfett", "Athleti"); `.pair` wraps, and the note is full width,
 * so the × was pushed onto a line of its own underneath it; and the whole row
 * was squeezed into a 310px grid column with nowhere for any of it to go.
 *
 * A table, `span2` and stacked, is what every other list of this shape on the
 * sheet already is -- the eidolon's evolutions, the companion's own skills,
 * and the granted feats on the Feats tab, which is this table exactly. Below
 * 620px they become cards like the rest; see "a list of things, on a phone".
 */
function companionListPanel(model, {
  list, rows, heading, badge, what, sourcePlaceholder, hint, slots = null, extra = '',
  only = null, template = emptyCompanionFeat(),
}) {
    // With `slots` (one label per place the list is owed a row), the list is
    // drawn slot by slot whether or not a row is stored for each -- writing
    // into an open one stores it (see companionOpenSlot) -- the source reads
    // the slot's label until something else is typed, and only a row past the
    // last slot can be removed. Without, it is a list rows are added to.
    //
    // With `only`, the panel draws the rows it passes and leaves the others
    // to another panel over the same list (a conjured companion's two groups
    // of talents). Each row keeps its place in the list, which is what its
    // fields and its × are bound to, and Add adds `template`.
    const count = slots ? Math.max(rows.length, slots.length) : rows.length;
    const shown = Array.from({ length: count }, (_, i) => [rows[i] || {}, i])
      .filter(([r]) => !only || only(r));
    const over = (i) => slots && i >= slots.length;
    return `<section class="panel span2">
      <h3>${heading} ${badge}</h3>
      ${extra}
      ${shown.length ? `<div class="tablewrap"><table class="build stacked"><thead><tr>
        <th style="width:9rem">Source</th><th style="width:14rem">${esc(what)}</th><th>Notes</th><th></th>
      </tr></thead><tbody>
        ${shown.map(([r, i]) => `<tr${over(i) ? ' class="over"' : ''}>
          <td data-stack="head">${itemText(list, i, 'source', r.source,
    slots ? (slots[i] ?? 'Over the allowance') : sourcePlaceholder)}</td>
          <td data-stack="name">${itemText(list, i, 'name', r.name, what)}</td>
          <td data-label="Notes">${itemArea(model, list, i, 'notes', r.notes, 1)}</td>
          ${!slots || over(i) ? rowRemove(list, i) : '<td class="tools"></td>'}
        </tr>`).join('')}
      </tbody></table></div>` : `<p class="empty">No ${what.toLowerCase()}s yet.</p>`}
      ${slots ? '' : `<div style="margin-top:6px">${addButton(list, `Add ${what.toLowerCase()}`, template)}</div>`}
      <p class="hint">${hint}</p>
    </section>`;
  }


function companionTricksPanel(model, cc) {
    const { p, b, k } = cc;
    return companionListPanel(model, {
      list: `${p}.tricks`,
      rows: b.tricks || [],
      heading: 'Tricks',
      badge: `<span class="badge">${k.tricksTaken ?? 0} taken · ${k.bonusTricks ?? 0} bonus</span>`,
      what: 'Trick',
      sourcePlaceholder: 'Bonus, Handle Animal…',
      hint: 'Bonus tricks come from the table; the rest are taught with Handle Animal.',
    });
  }


/**
 * The conjured companion's Archetype panel: the base form as the sphere
 * prints it, and the archetypes it was called under (the Conjuration sphere's
 * own word for them).
 *
 * Most archetypes are rules prose the player applies through rows they
 * already own -- the warrior empties its own attacks list, the aquatic trades
 * its own speeds -- so most ticks here are a reminder wearing its rule as a
 * tooltip. The ones the sums act on (the half-HD familiar, the d6 mage, the
 * mindless and unwilling extra dice, the cheaper summon) are marked, and the
 * head's badges show the result.
 */
function conjuredArchetypePanel(model, cc) {
    const { p, b, k } = cc;
    return `<section class="panel">
      <h3>Archetype <span class="badge">${k.summonCost ?? 1} sp to summon</span></h3>
      ${k.formLine ? `<p class="hint"><strong>${esc(b.baseForm)}:</strong> ${esc(k.formLine)}.
        Speeds and attacks are written into their own rows; the form’s scores and natural armour are already counted.</p>`
    : '<p class="hint">Pick a base form above for its printed stat line, saves and starting scores.</p>'}
      <div class="rowlist">
        ${CONJURED_ARCHETYPES.map((a) => `<div class="item statline">
          ${check(`${p}.archetypes.${a.id}`, !!b.archetypes?.[a.id], a.label, a.note)}
          ${a.sums ? `<span class="badge" title="${esc(a.note)}">changes the sums</span>` : ''}
        </div>`).join('')}
      </div>
      <p class="hint">Hover an archetype for its rule. Once selected, an archetype cannot be
        removed from that companion in play. A companion may hold several archetypes if they
        do not replace the same features.</p>
    </section>`;
  }


/**
 * A conjured companion's own casting, when the Magical Companion (form)
 * talent or the mage archetype gives it one: its caster level, and its spell
 * points as the pool they are spent from. The pool is one of the character's
 * trackers, made for this companion, so it is spent, undone and refilled the
 * way every tracker is; it is drawn here as well as on the Trackers tab.
 *
 * And its own casting tradition, which this sheet lets either source take,
 * the talent's natural casting included: a name, and its drawbacks and boons
 * as lines of prose.
 * They are what was chosen, not a sum -- nothing here adds them up into the
 * pool -- and a boon that changes a number forwards it, as any note does.
 */
function conjuredCastingPanel(model, cc) {
    const { p, b, k, sn } = cc;
    const cast = k.casting;
    if (!cast) return '';
    const pool = poolTracker(model, `sp:${b.id}`);
    const cha = k.scores?.cha?.mod ?? 0;
    const tr = b.tradition || {};
    const dlist = `${p}.tradition.drawbacks`;
    const olist = `${p}.tradition.boughtOff`;
    const blist = `${p}.tradition.boons`;
    return `<section class="panel">
      <h3>Casting <span class="badge">CL ${cast.cl}</span><span class="badge">${cast.spellPoints} sp</span></h3>
      ${line('Caster level', cast.cl)}
      ${cast.boonSP ? `${line('Spell points, base', cast.base)}${line(`Boons as spell points (${cast.boonSteps})`, `+${cast.boonSP}`)}` : ''}
      ${line('Spell points', cast.spellPoints)}
      ${pool ? trackerLine(pool) : ''}
      <p class="hint">${cast.mage
    ? `The mage archetype: a Mid-Caster on Charisma. Caster level is ¾ of its ${k.hd ?? 0} Hit Dice.
        Spell points are its Hit Dice plus its Charisma modifier (${k.hd ?? 0} ${cha < 0 ? '−' : '+'} ${Math.abs(cha)}).`
    : `Magical Companion: a caster on Charisma. Caster level is half its ${k.hd ?? 0} Hit Dice.
        Spell points are its Charisma modifier.`}
        The talent’s Charisma increase is not added here. Forward it from the talent’s note.
        The pool refills on this companion’s Rest and on a new day.
        Readable as <code>${esc(sn)}.sp</code> and <code>${esc(sn)}.cl</code>${pool
    ? `; the pool as <code>tracker.${esc(pool.id)}</code>` : ''}.</p>

      <h4 class="subhead">Casting tradition</h4>
      <label class="fld"><span>Tradition</span>${text(`${p}.tradition.name`, tr.name, 'Natural casting')}</label>
      <h4 class="subhead">Drawbacks${(tr.drawbacks || []).length ? ` <span class="badge">${cast.drawbacks} total</span>` : ''}</h4>
      ${proseList(model, dlist, tr.drawbacks || [], 'drawback')}
      <div>${addButton(dlist, 'Add drawback', '')}</div>
      <h4 class="subhead">Bought off with drawback feats${(tr.boughtOff || []).length ? ` <span class="badge">${cast.boughtOff}</span>` : ''}</h4>
      ${proseList(model, olist, tr.boughtOff || [], 'bought-off drawback')}
      <div>${addButton(olist, 'Add bought-off drawback', '')}</div>
      ${cast.boughtOff ? `<div class="statline"><span class="label">Effective drawbacks</span>
        <span class="value">${cast.drawbacks} − 2×${cast.boughtOff} = ${cast.boons}</span></div>` : ''}
      <h4 class="subhead">Boons${(tr.boons || []).length ? ` <span class="badge">${tr.boons.length}</span>` : ''}</h4>
      ${proseList(model, blist, tr.boons || [], 'boon')}
      <div>${addButton(blist, 'Add boon', '')}</div>
      ${cast.boons ? `<label class="fld"><span>Boons as spell points</span>${text(`${p}.tradition.boonSP`, tr.boonSP ?? '', String(cast.boonsDefault))}</label>
      ${line('Boons', `${cast.boons} (one per drawback${cast.boughtOff ? ', two off per drawback feat' : ''})`)}
      ${line(`${cast.boonSteps} as spell points at ${k.hd ?? 0} HD`, `+${cast.boonSP} sp`)}` : ''}
      <p class="hint">Blank means natural casting. Each drawback is a boon (“x2” counts two), and each
        drawback feat buys off two of them, as on your own tradition. A boon taken as spell points is worth its step on the boon ladder, read at this
        companion’s Hit Dice, and is added to the pool above. Blank in the box means every
        drawback without a boon written in the list. The boons written here are kept as
        written. A line can forward what it grants, as any note can:
        <code>{${esc(sn)}.cha.score += 2}</code>.</p>
    </section>`;
  }


/** The (form) and (type) talents shaping this companion, one list per companion. */
function conjuredTalentsPanel(model, cc) {
    const { p, b, k } = cc;
    // One list, two groups: a row added under Other Conjuration Talents is
    // marked `group: 'other'` (isOtherConjurationTalent); every other row is a
    // (form) or (type) talent, including those saved before the split.
    const list = `${p}.talents`;
    const rows = b.talents || [];
    return companionListPanel(model, {
      list,
      rows,
      only: (t) => !isOtherConjurationTalent(t),
      heading: 'Form and Type talents',
      badge: `<span class="badge">${k.talentsTaken ?? 0} shaping this companion</span>`,
      what: 'Talent',
      sourcePlaceholder: '(form), (type)…',
      hint: 'The (form) and (type) talents applied to this companion. One is free when the '
        + 'companion is gained. No more than one (type) talent is allowed. They are spent from the master’s own magic '
        + 'talents, so nothing is budgeted here. What a talent changes goes into the rows it '
        + 'changes. Its note can forward a bonus, as any prose field can.',
    }) + companionListPanel(model, {
      list,
      rows,
      only: isOtherConjurationTalent,
      template: { ...emptyCompanionFeat(), group: 'other' },
      heading: 'Other Conjuration Talents',
      badge: `<span class="badge">${k.otherTalentsTaken ?? 0} taken</span>`,
      what: 'Talent',
      sourcePlaceholder: 'Conjuration',
      hint: 'The master’s other Conjuration talents that affect this companion. Like the (form) '
        + 'and (type) talents, they are spent from the master’s own magic talents, so nothing is '
        + 'budgeted here. A talent’s note can forward a bonus, as any prose field can.',
    });
  }


function companionFeatsPanel(model, cc) {
    const { kind, p, b, k } = cc;
    const allowed = k.featsAllowed ?? 0;
    if (kind === 'conjured') {
      // One slot per odd Hit Die, then the bonus feats: the slots are there on
      // their own, and a feat is typed into one rather than added.
      const slots = [
        ...Array.from({ length: allowed }, (_, i) => `${2 * i + 1} HD`),
        ...Array.from({ length: k.bonusFeats ?? 0 }, () => 'Bonus'),
      ];
      const taken = k.featsTaken ?? 0;
      return companionListPanel(model, {
        list: `${p}.feats`,
        rows: b.feats || [],
        heading: 'Feats',
        badge: `<span class="badge${taken > slots.length ? ' err' : ''}">${taken} of ${slots.length}</span>`,
        what: 'Feat',
        slots,
        extra: `<div class="fieldgrid tight">${field('Bonus feats', formulaBox(cc, 'bonusFeats'))}</div>`,
        hint: `One feat at every odd Hit Die (${allowed} at ${k.hd ?? 0} HD), plus a slot for each bonus feat.
          The Bonus feats field takes a number or a formula. A feat past the last slot is kept, marked, and can be removed.
          A feat named Multiattack reduces the secondary attack penalty to −2.`,
      });
    }
    const over = (k.featsTaken ?? 0) > allowed;
    return companionListPanel(model, {
      list: `${p}.feats`,
      rows: b.feats || [],
      heading: 'Feats',
      badge: `<span class="badge${over ? ' err' : ''}">${k.featsTaken ?? 0} of ${allowed}</span>`,
      what: 'Feat',
      // What the importer reads off the table beside each feat, and what a
      // player adding one by hand is being asked for.
      sourcePlaceholder: 'Level 5',
      hint: `The table allows ${allowed} at this level. A feat named Multiattack softens secondary attacks to −2.`,
    });
  }


function companionSkillsPanel(model, cc) {
    const { kind, p, sn, roll, b, k } = cc;
    const list = `${p}.skills`;
    const rows = b.skills || [];
    const fam = kind === 'familiar';
    const budget = k.ranksAllowed === null || k.ranksAllowed === undefined ? ''
      : `<span class="badge${(k.ranksSpent ?? 0) > k.ranksAllowed ? ' err' : ''}">${k.ranksSpent ?? 0} of ${k.ranksAllowed} ranks</span>`;
    // Two tables side by side rather than one across the panel. A companion
    // keeps thirty-odd skills of a name, a variant and five small numbers,
    // and one table the width of the page put the name in a box four times
    // its length and the list a screen and a half tall. Halved, the name
    // gets the width a skill name needs and the list fits on a screen. The
    // rows keep their index in the stored list, which is what every field
    // on them binds to.
    // No Variant column: a companion with a specific Craft or Profession
    // gets it typed into the name, as its player would write it. A variant
    // a document already holds is still shown, under the name, so it is
    // not lost -- none of the imported companions carries one.
    const row = (s, i) => `<tr${s.trained && !(s.effectiveRanks > 0) ? ' class="future" title="Trained only — no ranks yet"' : ''}>
          <td class="cname">${itemText(list, i, 'name', s.name, 'Skill', true)}${
            String(s.spec || '').trim() ? `<div class="hint">(${esc(s.spec)})</div>` : ''}</td>
          <td>${itemSelect(list, i, 'ability', s.ability, ABILITY_LABELS_LIST, null)}</td>
          <td class="mid">${itemCheck(list, i, 'classSkill', s.classSkill)}</td>
          <td>${itemNum(list, i, 'ranks', s.ranks)}</td>
          ${fam ? `<td class="num derived">${s.masterRanks || 0}</td>` : ''}
          <td>${itemNum(list, i, 'misc', s.misc)}${
            forwardedBadge(model, `${sn}.skill.${companionSkillKey(s)}`)}</td>
          <td class="num total"><span class="rollpair">${fmt(s.total ?? 0)}${
            rollButton(model, roll, `skill:${i}`, `a ${skillLabel(s.name, s.spec) || 'skill'} check`)}</span></td>
          ${rowRemove(list, i)}
        </tr>`;
    const table = (indexed) => `<div class="tablewrap"><table class="build"><thead><tr>
        <th scope="col" class="cname">Skill</th><th scope="col">Ability</th>
        <th scope="col" title="Class skill">Class</th><th scope="col">Ranks</th>
        ${fam ? '<th scope="col" class="num" title="The master’s ranks in the same skill">Master</th>' : ''}
        <th scope="col">Misc</th><th scope="col" class="num">Total</th><th scope="col"></th>
      </tr></thead><tbody>
        ${indexed.map(([s, i]) => row(s, i)).join('')}
      </tbody></table></div>`;
    const indexed = rows.map((s, i) => [s, i]);
    const half = Math.ceil(indexed.length / 2);
    return `<section class="panel span2">
      <h3>Skills ${budget}</h3>
      <div class="compskills${fam ? ' fam' : ''}">
        ${table(indexed.slice(0, half))}
        ${indexed.length > half ? table(indexed.slice(half)) : ''}
      </div>
      <div style="margin-top:6px">${addButton(list, 'Add skill', { name: '', spec: '', ability: 'Int', trained: false, classSkill: false, ranks: 0, misc: 0 })}</div>
      <p class="hint">${fam
    ? 'A familiar uses its own ranks or its master’s, whichever is higher. The +3 class-skill bonus applies once there is a rank.'
    : kind === 'eidolon'
      ? 'Ranks per the sheet: HD × (6 + Int modifier). The +3 class-skill bonus applies once there is a rank.'
      : kind === 'conjured'
        ? '2 ranks per hit die at Intelligence 10 or higher, 1 per hit die below that (the printed column, at the forms’ Int 7). A mindless companion gets none. The +3 class-skill bonus applies once there is a rank.'
        : 'Ranks from the table at this level. The +3 class-skill bonus applies once there is a rank.'}</p>
    </section>`;
  }


/**
 * What a companion is carrying, and what it does for it.
 *
 * Two lists: the slots its body type allows (the animal companion's, keyed by
 * slot name), and everything with no slot -- a familiar's ioun stone, a bag
 * tied to the saddle. Both rows are the same four fields, and the fourth is
 * the point of the panel: Effect is prose, so it forwards, and a companion's
 * every rolled number is a destination it can be forwarded to. A belt of
 * giant strength is written down where the belt is, once, as
 * `{animalCompanion.str.score += 4 as enhancement}` -- and the attack, the
 * damage, the CMB, Climb and Swim all move because the *score* did.
 *
 * Taking a thing off is a tick, not a deletion: the row stays, still shows
 * what it would do, and stops doing it.
 */
function companionItemsPanel(model, cc) {
    const { kind, p, sn, b, k, label } = cc;
    const slots = k.slots || [];
    const list = `${p}.slotless`;
    const rows = b.slotless || [];
    const worn = (path, on) => `<label class="chk" title="${
      on === false ? 'Not worn — the effect beside it is written down but not applying' : 'Worn: the effect beside it is applying'}">
      <input type="checkbox" ${on === false ? '' : 'checked'} data-set="${path}" data-kind="bool"></label>`;
    // Taken off, a row still shows what it would do and stops doing it -- and
    // says so in the colour of its tokens, the same way an unticked buff does.
    const off = (it) => (it?.worn === false
      ? { inactive: true, inactiveTitle: 'Not worn, so the bonus is not applying. Tick the row to put it on.' }
      : {});
    const wornItem = (i, on) => `<label class="chk" title="${
      on === false ? 'Not worn — the effect below is written down but not applying' : 'Worn: the effect below is applying'}">
      <input type="checkbox" ${on === false ? '' : 'checked'} data-item="${list}|${i}|worn" data-kind="bool"></label>`;
    /*
     * The name is capped and Effect takes what is left.
     *
     * Left to itself the table split the two evenly: the name got 394px of a
     * 970px row -- fifty-odd characters -- and the effect beside it got less.
     * That is the wrong way round. A name here is "Cloak of Resistance +2";
     * an effect is prose carrying the {…} that actually does something, and
     * it is the column with something to say. 14rem clears the longest name
     * anything wears ("Belt of Physical Perfection +2") and the rest goes
     * where it is read.
     */
    const head = `<tr><th style="width:1.6rem" title="Worn">✓</th><th style="width:14rem">Item</th>
      <th style="width:6rem">Cost</th><th>Effect</th>`;
    return `<section class="panel span2">
      <h3>Items
        ${b.bodyType ? `<span class="badge">${esc(b.bodyType)}</span>` : ''}
        ${k.canGrasp === null || k.canGrasp === undefined ? '' : `<span class="badge">${k.canGrasp ? 'can grasp' : 'cannot grasp'}</span>`}
      </h3>
      ${slots.length ? `<div class="tablewrap"><table class="stacked" data-fold="shut"><thead>
        ${/* Capped for the same reason the name is: the slot is one of ten
              fixed words the body type hands out, the longest of them "Feet
              (horseshoes)", and it was holding 235px against the effect. */''}
        ${head}<th style="width:9rem">Slot</th></tr></thead><tbody>
        ${slots.map((slot) => {
    const it = b.items?.[slot] || {};
    return `<tr>
          <td class="mid" data-label="Worn">${worn(`${p}.items.${slot}.worn`, it.worn)}</td>
          <td data-stack="name">${text(`${p}.items.${slot}.name`, it.name, '')}</td>
          <td data-label="Cost">${num(`${p}.items.${slot}.cost`, it.cost)}</td>
          <td data-label="Effect">${prose(model, `data-set="${p}.items.${slot}.effect"`, it.effect, 1, 'grow', null, off(it))}</td>
          <th scope="row" data-label="Slot">${esc(slot)}</th>
        </tr>`;
  }).join('')}
      </tbody></table></div>` : `<p class="empty">${kind === 'animalCompanion'
    ? 'Pick a body type above to see the item slots it can use.'
    : 'No body-type slots here — everything goes in the list below.'}</p>`}
      <h4 style="margin:10px 0 4px">${slots.length ? 'Slotless items' : 'Items'}</h4>
      ${rows.length ? `<div class="tablewrap"><table class="stacked" data-fold="shut"><thead>
        ${head}<th></th></tr></thead><tbody>
        ${rows.map((it, i) => `<tr>
          <td class="mid" data-label="Worn">${wornItem(i, it.worn)}</td>
          <td data-stack="name">${itemText(list, i, 'name', it.name, 'Item')}</td>
          <td data-label="Cost">${itemNum(list, i, 'cost', it.cost)}</td>
          <td data-label="Effect">${itemArea(model, list, i, 'effect', it.effect, 1, null, off(it))}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table></div>` : ''}
      <div style="margin-top:6px">${addButton(list, slots.length ? 'Add slotless item' : 'Add item', { name: '', cost: 0, worn: true, effect: '' })}</div>
      <p class="hint"><strong>Effect</strong> reads <code>{…}</code> like any prose field on the sheet.
        Every number the ${esc(label.toLowerCase())} rolls can be the target of a bonus:
        <code>{${esc(sn)}.str.score += 4 as enhancement}</code>, <code>{${esc(sn)}.ac.total += 2 as armor}</code>,
        <code>{${esc(sn)}.skill.perception += 5}</code>, <code>{${esc(sn)}.attack += 1}</code>,
        <code>{${esc(sn)}.damage += 1}</code>, <code>{${esc(sn)}.saves += 2 as resistance}</code>,
        <code>{${esc(sn)}.cmb += 2}</code>. Untick <em>Worn</em> and the row still shows its effect
        but stops applying it.</p>
    </section>`;
  }


/**
 * One ability the table granted, opened out.
 *
 * Shut it is the line it always was. Open it is what the ability does, and
 * that comes from one of two places on the same terms veils are on: a pack's
 * text where a pack describes it, the player's own where they have written
 * one, and theirs wins -- a pack is reference, and this is their character.
 *
 * The box is always there, so an ability no pack has reached is still one you
 * can write down. What is conditional is the pack's paragraph above it, which
 * drops away the moment there is something of their own to show instead.
 */
function companionAbilityRow(model, cc, name) {
    const { kind, p, b } = cc;
    const key = abilityTextKey(name);
    const mine = String(b.abilityNotes?.[key] ?? '');
    const shared = companionAbilityText(name) || b.citedAbilities?.[key] || null;
    // Folded per companion by its stable id, so opening Evasion on one wolf
    // does not open it on the other three.
    const foldKey = `${kind}-${b.id || cc.i}-ability-${key}`;
    // Shut unless it has been opened: five of these are a list of what the
    // companion has, and a list you have to scroll past is not a list.
    const shut = isCollapsed(model, foldKey, true);
    return `<div class="gainrow">
      <div class="item statline">
        <span class="value">${esc(name)}</span>
        ${foldButton(model, foldKey, { open: !shut })}
      </div>
      ${shut ? '' : `<div class="gainbody">
        ${shared && !mine.trim() ? `<div class="hint packsays">
          ${esc(shared.text)}
          ${shared.source || shared.pack ? `<span class="packfrom">${esc(shared.source || shared.pack)}</span>` : ''}
        </div>` : ''}
        ${prose(model, `data-set="${p}.abilityNotes.${esc(key)}"`, mine, 2)}
      </div>`}
    </div>`;
  }


function companionGainsPanel(model, cc) {
    const { kind, p, b, k, label } = cc;
    const gains = k.gains || [];
    return `<section class="panel">
      <h3>${esc(label)} abilities <span class="badge">${gains.length} from the table</span></h3>
      ${gains.length ? `<div class="rowlist">${gains.map((g) => `<div class="item gainlevel">
        <span class="label">Level ${g.level}</span>
        <div class="gains">${(g.abilities || [g.text]).map((n) => companionAbilityRow(model, cc, n)).join('')}</div>
      </div>`).join('')}</div>` : '<p class="empty">Nothing yet at this level.</p>'}
      <div class="fieldgrid" style="margin-top:8px">
        ${kind === 'familiar' ? `<label class="fld" style="grid-column:1/-1"><span>Familiar abilities</span>
          ${prose(model, `data-set="${p}.abilities"`, b.abilities, 3)}</label>` : ''}
        <label class="fld" style="grid-column:1/-1"><span>Special qualities</span>
          ${prose(model, `data-set="${p}.specialQualities"`, b.specialQualities, 3)}</label>
      </div>
    </section>`;
  }


function companionNotesPanel(model, cc) {
    const { p, sn, b } = cc;
    return `<section class="panel notes">
      <h3>Notes</h3>
      ${prose(model, `data-set="${p}.notes"`, b.notes, 6)}
      <p class="hint">Formulas work here: <code>{= ${esc(sn)}.hp}</code>, <code>{= ${esc(sn)}.hd * 2}</code>.</p>
    </section>`;
  }

  /* ---------------- card casting ---------------- */

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
      ${card.art ? `<div class="art"><img src="${esc(card.art)}" alt="" loading="lazy"></div>` : ''}
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
      <div class="art">${card.art ? `<img src="${esc(card.art)}" alt="" loading="lazy">` : ''}</div>
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
