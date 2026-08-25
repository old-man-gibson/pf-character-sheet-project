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
import { forwardedBadge } from '../badges.js';
import { rollButton } from '../roll.js';
import { meterStyleButton, meterStyleEditor, meterVisual } from './trackers.js';

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
  CARD_COLORS, CARD_MODIFICATIONS, castingTableNames, deckManipulation,
  deckManipulationCatalogue, maneuverCatalogue, maneuverDetails, maneuverIsWritten,
  maneuverOwn,
  psionicCurveTotals, psionicTables,
  veilsAvailable, veilDetails, veilOwn, slug,
} from '../../model.js';
import { ABILITY_LABELS_LIST } from '../html.js';
import { round } from '../format.js';
import {
  ABILITIES, ABILITY_LABELS, CASTING_SOURCES, EITR_URL, ESSENCE_SOURCES, MANEUVER_FIELDS,
  PREP_STYLES, PRIMORDIA_NAMES, PRIMORDIA_REPEAT_FROM, PRIMORDIA_TECHNIQUES, SIZE_MODIFIERS,
  SPELL_LEVELS, SP_PER_TEMP_ESSENCE, VEIL_SLOTS, WIKI_BASE, castingNoun, fmt, prepStyle,
  skillLabel, wikiUrl,
} from '../../rules.js';
import {
  BODY_TYPES, COMPANION_LABELS, COMPANION_LEVEL_SOURCES, NATURAL_ATTACKS,
} from '../../companions.js';
import { hasTokens } from '../../inline.js';
import { squareLayout } from '../../tracker-style.js';
import { abilitySelect, check, field, num, select, text } from '../fields.js';
import {
  addButton, bigStat, collapsible, exprField, itemCheck, itemNum, itemSelect, itemText, line,
  miniStat, rowRemove, rowRemoveArmed, rowTools,
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
 * `path` is the item the click writes to, as `list|index|field`. Clicking the nth
 * pip leaves n unspent, and clicking the lowest lit one spends it -- the rule the
 * tracker pips already follow.
 */
export function slotSpend({ path, total, left, shape = 'pips', name = 'slot' }) {
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

  /** Cells from a source tab that no label claimed. Kept, shown, not modelled. */
export function systemExtrasPanel(block, path, tabName) {
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
          ${Array.from({ length: width }, (_, ci) => `<td>${itemText(list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
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

    return `<div class="grid">
      ${veilDatalists(a)}
      ${essencePanel(ctx, model, a)}
      ${akashicClassesPanel(a)}
      ${akashicSlotsPanel(model, ctx, a)}
      ${akashicKheshigPanel(model, ctx, a)}
      ${akashicReceptaclesPanel(model, a)}
      ${systemExtrasPanel(a, 'akashic', 'Akashic')}
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
        Those points are spent whether or not the essence is invested, so they
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
              <td>${itemText(list, i, 'name', c.name, 'Class')}</td>
              <td>${select(`${list}.${i}.mod`, c.mod, ABILITY_LABELS_LIST)}</td>
              <td class="num">${itemNum(list, i, 'level', c.level)}</td>
              <td class="num">${itemNum(list, i, 'essenceCap', c.essenceCap)}</td>
              <td class="num">${itemNum(list, i, 'bonusCap', c.bonusCap)}</td>
              <td class="num total">${c.totalCap ?? 0}</td>
              ${rowRemove(list, i)}
            </tr>`).join('') || `<tr><td colspan="7" class="empty">No veilweaving class.</td></tr>`}
          </tbody></table>
          <div class="pair" style="margin-top:6px">
            ${addButton(list, 'Add class', {
    name: '', mod: null, level: 0, essenceCap: 0, bonusCap: 0, baseDC: 0, steadyVeilDC: 0,
  })}
            <label class="minifield">Base DC
              ${num('akashic.baseDC', a.baseDC, 'style="width:3.4rem"')}</label>
            <label class="minifield">Steady veil DC
              ${num('akashic.steadyVeilDC', a.steadyVeilDC, 'style="width:3.4rem"')}</label>
          </div>
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
    const showEmpty = !!model.data.uiPrefs?.collapsed?.['veil:showEmpty'];
    const shown = slots.map((s, i) => ({ s, i }))
      .filter(({ s }) => showEmpty || (s.veils || []).length);

    return `<section class="panel span2">
      <h3>Veil slots
        <span class="badge">${shaped} shaped</span>
        <span class="badge">${slots.length} slots</span>
        <span class="pair" style="margin-left:auto">
          ${veilColumnsControl(model)}
          <button data-collapse="veil:showEmpty" aria-pressed="${showEmpty}">
            ${showEmpty ? 'Hide empty slots' : `Show ${slots.length - shaped} empty`}
          </button>
          ${addButton(list, 'Add slot', {
    slot: '', bound: false, twinveil: false, veils: [],
  })}
        </span>
      </h3>
      <p class="hint">One veil to a slot, or two with Twinveil. A veil's save DC
        is the base DC plus the essence invested in it. A description may carry
        <code>{name = expr}</code> formulas, the same as anywhere else.</p>
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
        <button data-veilcols="${n}" aria-pressed="${cols === n}"
          title="${n ? `${n} veil cards to a row` : 'As many as fit'}">${label}</button>`).join('')}
    </span>`;
  }

  /** The saved count, defaulting to four -- five is where the cards get tight. */
function veilColumns(model) {
    const v = model.data.uiPrefs?.veilColumns;
    return v === undefined ? 4 : Number(v) || 0;
  }

  /**
   * A pinned count as a track size rather than `repeat(N, …)`, so a narrow
   * window still drops to fewer columns instead of overflowing. The half pixel
   * keeps rounding from fitting one column more than was asked for.
   */
function veilGridStyle(model) {
    const n = veilColumns(model);
    if (!n) return '';
    return ` style="--veil-track:max(230px, calc((100% - ${(n - 1) * 8}px) / ${n} - 0.5px))"`;
  }


function veilSlotCard(model, ctx, a, list, s, i) {
    const base = `${list}.${i}`;
    const options = veilOptions(a, s.slot);   // its id; the list itself is emitted once for the tab
    const veils = s.veils || [];
    const max = s.twinveil ? 2 : 1;
    const key = `veil:${s.slot || i}`;
    const collapsed = !!model.data.uiPrefs?.collapsed?.[key];

    return `<div class="veilslot${collapsed ? ' is-collapsed' : ''}">
      <div class="veilslot-head">
        <button class="disclose" data-collapse="${esc(key)}"
          aria-expanded="${!collapsed}" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</button>
        ${select(`${base}.slot`, s.slot, VEIL_SLOTS, null)}
        <span class="vcount" title="veils shaped / slots available">${veils.length}<i>/</i>${max}</span>
        ${rowRemoveButton(list, i, `Remove the ${s.slot || 'unnamed'} slot`)}
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
  return (a?.classes || []).map((c) => String(c?.name || '').trim()).filter(Boolean);
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
        ${rowRemoveButton(list, vi, 'Unshape this veil')}
      </div>
      ${meta.length ? `<div class="veil-meta" title="from the pack that carries this veil">${meta.map((m) => esc(m)).join(' · ')}</div>` : ''}
      ${writing
    ? itemArea(model, list, vi, 'desc', own.desc, 2, model.veilScope(v))
    : `<div class="veil-text">${renderedProse(model, d.desc, model.veilScope(v))}</div>`}
      ${d.known && d.bindEffect && !writing
    ? `<div class="veil-bind"><b>Bind:</b> ${esc(d.bindEffect)}</div>` : ''}
    </div>`;
  }

  /** The × from #rowRemove, without the surrounding table cell. */
export function rowRemoveButton(list, i, title) {
    return `<button class="danger tiny" data-remove="${list}|${i}"
      title="${esc(title)}" aria-label="${esc(title)}">×</button>`;
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
        Their essence counts against the day's pool the same way a veil's does.</p>
      ${rows.length ? `<div class="veils"${veilGridStyle(model)}>
        ${rows.map((r, i) => `<div class="veilslot${ticks && !r.active ? ' is-off' : ''}">
          <div class="veilslot-body">
            <div class="veil">
              <div class="veil-top">
                ${itemText(list, i, 'name', r.name, 'Receptacle')}
                <label class="minifield" title="essence invested">Ess
                  ${itemNum(list, i, 'essence', r.essence)}</label>
                ${rowRemoveButton(list, i, 'Remove this receptacle')}
              </div>
              ${ticks ? `<div class="veilflags">${check(`${list}.${i}.active`, r.active, 'On')}</div>` : ''}
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
    const taken = new Set((m.disciplines || []).map((d) => d.name));
    const available = maneuverCatalogue().disciplines
      .map((d) => d.name).filter((name) => !taken.has(name));

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
          <strong>Tick</strong> a maneuver to ready it — the box alone, so nothing else
          on the row can toggle it. <strong>Click its name</strong> to read what you wrote
          down about it, and the ✎ to write it: type, action, range, target, duration,
          saving throw and description, every one of them taking <code>{…}</code> formulas.
          <strong>Right-click</strong> a name for its page on the
          <a href="${esc(WIKI_BASE)}" target="_blank" rel="noopener noreferrer">wiki</a>.
        </p>
      </section>

      <section class="panel span2 discipline-wrap">
        ${(m.disciplines || []).length
    ? `<div class="disciplines">${(m.disciplines || []).map((d, i) => disciplineColumn(model, ctx, d, i)).join('')}</div>`
    : '<p class="empty">No disciplines trained. Pick one above to see what it grants.</p>'}
      </section>

      ${systemExtrasPanel(m, 'maneuvers', 'Maneuvers')}
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
    const collapsed = !!model.data.uiPrefs?.collapsed?.[`disc:${d.name}`];

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
              <button type="button" class="mname" data-mopen="${esc(key)}"
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
        <button class="tiny" ${editing ? `data-mopen="${esc(key)}"` : `data-medit="${esc(key)}"`}
          aria-pressed="${editing}"
          title="${editing ? 'Back to reading it' : 'Fill in what it does'}">${editing ? 'Done' : 'Edit'}</button>
        <button class="tiny" data-mclose="${esc(key)}" title="Close" aria-label="Close ${esc(e.name)}">×</button>
      </div>
      ${editing ? maneuverCells(model, list, e, own) : maneuverRead(model, entry)}
    </div>`;
}

/**
 * What it says, with the blanks left out.
 *
 * A stat entry prints the lines it has; the ones nobody filled in are not
 * "Target: —", they are simply not part of the maneuver, and a card of seven
 * em-dashes is a form rather than a rules entry.
 */
function maneuverRead(model, entry) {
  const shown = MANEUVER_FIELDS
    .map((f) => [f, entry[f.key]])
    .filter(([, v]) => String(v).trim() !== '');
  const value = (v) => (hasTokens(v) ? renderedProse(model, v) : esc(v));
  const cells = shown.filter(([f]) => f.key !== 'text');
  const body = shown.find(([f]) => f.key === 'text');
  return `${cells.length ? `<dl class="mdetail-cells">${cells.map(([f, v]) => `
      <dt>${esc(f.label)}</dt><dd>${value(v)}</dd>`).join('')}</dl>` : ''}
    ${body ? `<div class="mdetail-text">${value(body[1])}</div>` : ''}
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
        own[f.key], f.lines || 1, 'grow');
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
   */
export function vancianPanel(model) {
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

      ${(v.classes || []).map((c, i) => castingClassPanel(model, c, i)).join('')}

      <section class="panel span2">
        ${addButton('vancian.classes', 'Add casting class', {
    name: '', slotType: '', stat: '', stat2: '', prep: '', source: '',
    casterLevelOverride: null, concentration: 0,
    spells: SPELL_LEVELS.map((level) => ({ level, perDay: null, known: null })),
  })}
      </section>
      ${vancianPreparedPanel(model, v)}
      ${systemExtrasPanel(v, 'vancian', 'Vancian Magic')}
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
    // Worth saying when a block has been pinned away from what the Planner counts.
    const drift = c.casterLevelOverride !== null && c.casterLevelOverride !== undefined
      && Number(c.casterLevel) !== Number(c.plannerLevel);

    return `<section class="panel span2">
      <h3>
        ${itemText('vancian.classes', i, 'name', c.name, 'Casting class')}
        <span class="badge">CL ${c.casterLevel ?? 0}</span>
        <span class="badge">${spends && c.totalLeft !== c.totalPerDay ? `${c.totalLeft ?? 0} of ` : ''}${c.totalPerDay ?? 0} ${esc(noun.many.toLowerCase())}/day</span>
        ${c.highestLevel ? `<span class="badge">up to level ${c.highestLevel}</span>` : ''}
        ${c.slotTypeUnknown ? '<span class="badge">no table</span>' : ''}
        <span class="pair" style="margin-left:auto">
          <button class="danger" data-remove="vancian.classes|${i}">Remove</button>
        </span>
      </h3>
      <div class="fieldgrid">
        ${field('Casting stat', select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST))}
        ${field('Second stat', select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST))}
        ${field('Prepared as', select(`${base}.prep`, c.prep,
    PREP_STYLES.map((p) => [p.key, p.label])))}
        ${field('Source', select(`${base}.source`, c.source,
    CASTING_SOURCES.map((s) => [s.key, s.label])))}
        ${field('Slot table', select(`${base}.slotType`, c.slotType, castingTableNames()))}
        ${field('Caster level', `<input type="number" value="${c.casterLevelOverride ?? ''}"
          placeholder="${c.plannerLevel ?? 0}" data-set="${base}.casterLevelOverride"
          data-kind="number-or-null"
          title="Auto: ${c.plannerLevel ?? 0} level(s) of this class in the Planner. Enter a number to pin it.">`)}
        ${field('Concentration', `<span class="rollpair">${
          num(`${base}.concentration`, c.concentration)}${
          rollButton(model, 'concentration', `vancian:${i}`,
            `${c.name || 'this class'} concentration`)}</span>`)}
      </div>
      ${line('Stat modifier', fmt(c.statMod ?? 0))}
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
function vancianPreparedPanel(model, v) {
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
          <td>${itemText(list, i, 'prepUsed', r.prepUsed, '')}</td>
          <td>${itemText(list, i, 'classLevel', r.classLevel, '')}</td>
          <td>${itemText(list, i, 'name', r.name, 'Spell')}</td>
          <td>${r.name ? prose(model, `data-item="${list}|${i}|note"`, r.note, 1, 'grow') : ''}</td>
          <td class="num">${r.name ? itemNum(list, i, 'uses', r.uses) : ''}</td>
          <td class="spendcell">${r.name ? slotSpend({
    path: `${list}|${i}|used`, total: r.uses, left: r.left, shape: 'squares', name: r.name,
  }) : ''}</td>
          ${rowRemoveArmed(list, i, r.name || 'this row')}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No spells listed.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add spell', {
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
export function primordiaPanel(model) {
    const c = model.data;
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
            ${select('identity.primordiaTechnique', c.identity.primordiaTechnique, PRIMORDIA_NAMES, '— none —')}</label>
          ${totals.map(([label, v, title]) => miniStat(label, v, title)).join('')}
          <span class="statbar-fill"></span>
          ${miniStat('Level', level, 'Grants above this level are planned, not counted')}
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
          took for it, already filled in on the levels the rules name themselves; the last is
          yours, and takes formulas. A technique feat can be swapped under the Associated Feat
          rules if you are later given a feat for a sphere or talent you already have.
        </p>
      </section>

      ${k.technique ? primordiaLadder(model, k) : primordiaChooser()}

      <section class="panel span2">
        <h3>Notes</h3>
        ${prose(model, 'data-set="primordia.notes"', p.notes, 3, 'grow')}
        <p class="hint">Resolves <code>{name = expr}</code> like any other prose field on the sheet.</p>
      </section>
    </div>`;
  }

  /**
   * The ten granting levels, what each hands over, what was taken for it, and
   * a note beside that.
   *
   * The name and the note were one box until the levels the rules already
   * name -- Detect Spellcaster, Fast Divinations -- had nowhere to put their
   * own name and nothing to type but a note. They are two columns now: the
   * name column carries what the rules named where they named it, and the
   * note takes formulas the way every other note on the sheet does.
   */
function primordiaLadder(model, k) {
    // Whatever this technique calls the thing it hands over -- a talent, a
    // spell, a power, a feat. The repeating grant is the one that says it
    // seven times, so it is the one that names the column.
    const noun = k.repeat?.pick?.label || 'Taken';
    return `<section class="panel span2">
      <div class="tablewrap"><table class="build primordia">
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
          <td class="choice${state}">${primordiaPick(model, row)}</td>
          <td class="picknote">${prose(model, `data-set="primordia.rowNotes.${row.level}"`, row.note, 1, 'grow')}</td>
        </tr>`;
  }).join('')}</tbody>
      </table></div>
      ${k.repeat ? `<p class="hint repeatrule">
        <strong>From ${PRIMORDIA_REPEAT_FROM}th, every two levels:</strong> ${esc(k.repeat.text)}
        ${k.repeat.cite === 'EitR' ? `<a href="${esc(EITR_URL)}" target="_blank" rel="noopener noreferrer">[EitR]</a>` : ''}
      </p>` : ''}
      <p class="hint">
        A level you have reached with a choice still to make is outlined and counted above;
        one you have not reached yet is dotted — the plan, not a chore. Levels whose grant the
        rules name carry that name already; type over one to say otherwise. Every row's note
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
function primordiaPick(model, row) {
    const path = `primordia.picks.${row.level}`;
    const options = row.pick?.options;
    if (options) return select(path, row.text, options);
    const placeholder = row.pick?.placeholder || row.auto || '—';
    const auto = !row.text.trim() && row.auto;
    // A pick carrying an inline formula shows what it comes to, the same way a
    // progression feature cell does.
    return hasTokens(row.text)
      ? prose(model, `data-set="${path}"`, row.text, 1, 'grow')
      : `<input type="text" class="autotext${auto ? ' auto' : ''}" value="${esc(row.text)}"
          data-set="${path}" data-kind="text" placeholder="${esc(placeholder)}"${auto
  ? ` title="${esc(`${row.auto} — the technique's own. Type to put something else here.`)}"` : ''}>`;
  }

  /** With no technique taken, the five on offer and what each asks for. */
function primordiaChooser() {
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
        ${meterVisual(model.meterSpec('pp'))}
        ${meterStyleEditor(model, ctx, 'pp')}
        <div class="tracker-controls" style="margin-top:6px">
          <button data-pool-step="-1" aria-label="Spend one power point">−</button>
          <input type="number" value="${left}" data-pool-left aria-label="Power points remaining">
          <span class="pool">/ ${pool}</span>
          <button data-pool-step="1" aria-label="Restore one power point">+</button>
        </div>
        <div class="fieldgrid" style="margin-top:8px">
          ${field('Bonus points', num('psionics.bonusPoints', p.bonusPoints))}
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

      ${(p.classes || []).map((c, i) => manifestingClassPanel(c, i)).join('')}

      <section class="panel span2">
        ${addButton('psionics.classes', 'Add manifesting class', {
    name: '', stat: '', stat2: '', curveTotal: 0, manifesterLevelOverride: null, powers: [],
  })}
      </section>
      ${systemExtrasPanel(p, 'psionics', 'Psionics')}
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


function manifestingClassPanel(c, i) {
    const base = `psionics.classes.${i}`;
    const list = `${base}.powers`;
    const levels = psionicTables().powerLevels || [];
    const pinned = c.manifesterLevelOverride !== null && c.manifesterLevelOverride !== undefined;

    return `<section class="panel span2">
      <h3>
        ${itemText('psionics.classes', i, 'name', c.name, 'Manifesting class')}
        <span class="badge">ML ${c.manifesterLevel ?? 0}</span>
        <span class="badge">${c.points ?? 0} pp</span>
        ${c.powerCount ? `<span class="badge">${c.powerCount} power${c.powerCount === 1 ? '' : 's'}</span>` : ''}
        ${c.curveTotal && !c.curveKnown ? '<span class="badge">no curve</span>' : ''}
        <span class="pair" style="margin-left:auto">
          <button class="danger" data-remove="psionics.classes|${i}">Remove</button>
        </span>
      </h3>
      <div class="fieldgrid">
        ${field('Ability 1', select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST))}
        ${field('Ability 2', select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST))}
        ${field('Points at 20', select(`${base}.curveTotal`, c.curveTotal, curveOptions()))}
        ${field('Manifester level', `<input type="number" value="${c.manifesterLevelOverride ?? ''}"
          placeholder="${c.plannerLevel ?? 0}" data-set="${base}.manifesterLevelOverride"
          data-kind="number-or-null"
          title="Auto: ${c.plannerLevel ?? 0} level(s) of this class in the Planner. Enter a number to pin it.">`)}
      </div>
      ${line('From the curve', c.basePoints === null ? '—' : c.basePoints)}
      ${line('From abilities', fmt(c.abilityPoints ?? 0))}
      ${pinned && Number(c.manifesterLevel) !== Number(c.plannerLevel)
    ? `<p class="hint">The Planner gives ${c.plannerLevel} level${c.plannerLevel === 1 ? '' : 's'} of this class.</p>` : ''}
      ${(c.powers || []).length ? `<table style="margin-top:8px"><thead><tr>
        <th>Power</th><th style="width:7rem">Level</th><th></th>
      </tr></thead><tbody>
        ${(c.powers || []).map((w, wi) => `<tr>
          <td>${itemText(list, wi, 'name', w.name, 'Power')}</td>
          <td>${itemSelect(list, wi, 'level', w.level, levels)}</td>
          ${rowRemove(list, wi)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No powers known.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add power', { name: '', level: '' })}</div>
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
export function companionPanel(model, kind) {
    const b = model.data[kind];
    if (!b) return '<div class="grid"><p class="empty">No companion data.</p></div>';
    const k = b.calc || {};
    const label = COMPANION_LABELS[kind];
    return `<div class="grid">
      ${companionHeadPanel(model, kind, b, k, label)}
      ${companionHpPanel(kind, b, k)}
      ${companionScoresPanel(model, kind, b, k)}
      ${companionDefensePanel(kind, b, k)}
      ${companionSavesPanel(model, kind, b, k)}
      ${companionAttacksPanel(model, kind, b, k)}
      ${kind === 'eidolon' ? eidolonEvolutionsPanel(model, b, k) : ''}
      ${kind === 'animalCompanion' ? companionTricksPanel(model, b, k) : ''}
      ${kind === 'familiar' ? '' : companionFeatsPanel(model, kind, b, k)}
      ${companionSkillsPanel(model, kind, b, k)}
      ${kind === 'animalCompanion' ? companionItemsPanel(b, k) : ''}
      ${companionGainsPanel(model, kind, b, k, label)}
      ${companionNotesPanel(model, kind, b)}
    </div>`;
  }


function companionLevelControls(model, kind, b, k) {
    if (kind === 'familiar') {
      return `${field('Master level penalty', num(`${kind}.masterLevelPenalty`, b.masterLevelPenalty, 'min="0"'))}
        ${field('Protector archetype', check(`${kind}.protector`, b.protector, 'doubles hit points from 11th'))}`;
    }
    const classes = model.progressionClasses();
    const source = kind === 'animalCompanion'
      ? field('Level from', select(`${kind}.levelSource`, b.levelSource || 'class', COMPANION_LEVEL_SOURCES, null))
      : '';
    const showClass = kind === 'eidolon' || (b.levelSource || 'class') === 'class';
    return `${source}
      ${showClass ? field('Master class', select(`${kind}.masterClass`, b.masterClass, classes)) : ''}
      ${field('Level override', `<input type="number" value="${b.levelOverride ?? ''}"
        placeholder="${k.rawLevel ?? 0}" data-set="${kind}.levelOverride" data-kind="number-or-null" min="0" max="20"
        title="Auto: ${k.rawLevel ?? 0} from ${kind === 'animalCompanion' && b.levelSource === 'handleAnimal' ? 'Handle Animal ranks'
    : kind === 'animalCompanion' && b.levelSource === 'ride' ? 'Ride ranks' : 'the class’s levels in the Planner'}. Enter a number to pin it.">`)}
      ${field('Master level penalty', num(`${kind}.masterLevelPenalty`, b.masterLevelPenalty, 'min="0"'))}`;
  }


function companionHeadPanel(model, kind, b, k, label) {
    const saves = k.saves || {};
    const sv = (x) => fmt(saves[x]?.total ?? 0);
    const identity = kind === 'familiar' ? `
        ${field('Creature', text(`${kind}.creature`, b.creature, 'Owl, cat, thrush…'))}
        ${field('Archetypes', text(`${kind}.archetypes`, b.archetypes))}
        ${field('Special ability', text(`${kind}.specialAbility`, b.specialAbility, 'What this familiar grants its master'))}`
      : kind === 'animalCompanion' ? `
        ${field('Creature', text(`${kind}.creature`, b.creature, 'Wolf, roc, big cat…'))}
        ${field('Archetype', text(`${kind}.archetype`, b.archetype))}
        ${field('Body type', select(`${kind}.bodyType`, b.bodyType, BODY_TYPES.map((t) => t.name)))}`
      : `
        ${field('Base form', text(`${kind}.baseForm`, b.baseForm, 'Biped, quadruped, serpentine…'))}
        ${field('Subtype', text(`${kind}.subtype`, b.subtype))}
        ${field('Alignment', text(`${kind}.alignment`, b.alignment))}`;
    return `<section class="panel span2">
      <h3>${esc(label)}
        <span class="badge">level ${k.level ?? 0}</span>
        <span class="badge">${k.hd ?? 0} HD</span>
        ${k.penalty ? `<span class="badge">−${k.penalty} master level</span>` : ''}
        ${!k.level ? '<span class="badge">no level yet</span>' : ''}
      </h3>
      <div class="fieldgrid">
        ${field('Name', text(`${kind}.name`, b.name, `${label} name`))}
        ${identity}
        ${field('Size', select(`${kind}.size`, b.size, Object.keys(SIZE_MODIFIERS), null))}
        ${companionLevelControls(model, kind, b, k)}
      </div>
      <div class="bigstats" style="margin-top:10px">
        ${bigStat('HP', `${k.hpCurrent ?? 0} / ${k.hpMax ?? 0}`, k.hpTemp ? `+${k.hpTemp} temp` : '')}
        ${bigStat('AC', k.ac ?? 10, `touch ${k.touch ?? 10} · flat ${k.flatFooted ?? 10}`)}
        ${bigStat('Init', fmt(k.initiative ?? 0), 'Dex + bonus', '',
    rollButton(model, kind, 'init', `${label.toLowerCase()} initiative`))}
        ${bigStat('BAB', fmt(k.bab ?? 0), kind === 'familiar' ? 'master’s' : 'from the table')}
        ${bigStat('Attack', fmt(k.totalAttack ?? 0), `${k.attackAbility || 'Str'} + size`)}
        ${bigStat('CMD', k.cmd ?? 10, `flat ${k.ffCmd ?? 10}`)}
        ${bigStat('Fort', sv('fort'), kind === 'familiar' ? 'master’s base' : (b.goodSaves?.fort ? 'good' : 'poor'))}
        ${bigStat('Ref', sv('ref'), kind === 'familiar' ? 'master’s base' : (b.goodSaves?.ref ? 'good' : 'poor'))}
        ${bigStat('Will', sv('will'), kind === 'familiar' ? 'master’s base' : (b.goodSaves?.will ? 'good' : 'poor'))}
      </div>
      <p class="hint">${kind === 'familiar'
    ? 'A familiar is its master’s level, uses the master’s BAB and base saves, has half the master’s hit points, and takes its Intelligence and natural armour from the familiar table.'
    : kind === 'animalCompanion'
      ? 'The level is the master’s levels in the class named (or ranks in Handle Animal / Ride for a Spheres companion), less any penalty; HD, BAB, saves, skill ranks, feats, natural armour, the Str/Dex bonus and bonus tricks all follow the animal companion table.'
      : 'The level is the master’s levels in the class named, less any penalty; HD, BAB, saves, feats, natural armour, the Str/Dex bonus, the evolution pool and the attack cap follow the eidolon table.'}
        Readable from a formula as <code>${kind}.hp</code>, <code>${kind}.ac</code>, <code>${kind}.str.mod</code>…</p>
    </section>`;
  }


function companionHpPanel(kind, b, k) {
    const hp = b.hp || {};
    const cur = k.hpCurrent ?? 0;
    return `<section class="panel">
      <h3>Hit points <span class="badge">${cur} of ${k.hpMax ?? 0}</span>${cur <= 0 ? '<span class="badge">down</span>' : ''}</h3>
      ${line('Maximum', k.hpMax ?? 0)}
      ${line('Damage taken', hp.damage || 0)}
      <div class="fieldgrid two" style="margin-top:6px">
        ${field('Temporary', num(`${kind}.hp.temp`, hp.temp, 'min="0"'))}
        ${field('Bonus max HP', num(`${kind}.hp.bonus`, hp.bonus))}
        ${kind === 'familiar' ? '' : field('HP ability', abilitySelect(`${kind}.hpAbility`, b.hpAbility))}
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


function companionScoresPanel(model, kind, b, k) {
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
      : num(`${kind}.scores.${a}.base`, b.scores?.[a]?.base ?? 10);
    return `<tr>
          <th scope="row"><span class="abmark" data-ab="${a}">${ABILITY_LABELS[a]}</span></th>
          <td>${base}</td>
          ${evo ? `<td>${num(`${kind}.scores.${a}.evo`, b.scores?.[a]?.evo)}</td>` : ''}
          <td class="num derived">${fmt(s.lvlUp || 0)}</td>
          <td>${num(`${kind}.scores.${a}.misc`, b.scores?.[a]?.misc)}</td>
          <td class="num total">${s.total ?? 10}</td>
          <td class="num"><span class="rollpair">${fmt(s.mod ?? 0)}${
      rollButton(model, kind, `ability:${a}`, `a ${ABILITY_LABELS[a]} check`)}</span></td>
        </tr>`;
  }).join('')}
      </tbody></table>
      ${incs.length ? `<div class="fieldgrid" style="margin-top:8px">
        ${incs.map((inc, i) => field(`+1 at level ${inc.level}${(k.level ?? 0) >= inc.level ? '' : ' (not yet)'}`,
    itemSelect(list, i, 'ability', inc.ability, ABILITY_LABELS_LIST)))}
      </div>` : ''}
      ${evo ? `<p class="hint">Evo is the Ability Increase evolution, at most +${k.maxBonusPerStat ?? 2} to any one score at this level.
        ${(k.evoBonusOver || []).length ? `<span class="warn">Over the cap: ${k.evoBonusOver.join(', ')}.</span>` : ''}</p>` : ''}
    </section>`;
  }


function companionDefensePanel(kind, b, k) {
    const ac = b.ac || {};
    return `<section class="panel">
      <h3>Defences <span class="badge">AC ${k.ac ?? 10}</span></h3>
      ${line('Armor class', k.ac ?? 10, true)}
      ${line('Touch', k.touch ?? 10)}
      ${line('Flat-footed', k.flatFooted ?? 10)}
      ${line('CMD', `${k.cmd ?? 10} (flat ${k.ffCmd ?? 10})`)}
      ${line('Initiative', fmt(k.initiative ?? 0))}
      <div class="fieldgrid" style="margin-top:8px">
        ${field('Bonus AC (all)', num(`${kind}.ac.all`, ac.all))}
        ${field('Touch only', num(`${kind}.ac.touch`, ac.touch))}
        ${field('Flat-footed only', num(`${kind}.ac.ff`, ac.ff))}
        ${field('CMD other', num(`${kind}.cmdOther`, b.cmdOther))}
        ${field('Initiative bonus', num(`${kind}.initBonus`, b.initBonus))}
      </div>
      <p class="hint">10 + Dex + size ${fmt(k.sizeAC ?? 0)} + natural armour ${fmt(k.tableNatural ?? 0)} from the table
        + the bonuses: <em>all</em> counts everywhere, <em>touch only</em> for dodge and deflection,
        <em>flat-footed only</em> for armour and extra natural armour.</p>
      ${kind === 'eidolon' ? `<div class="fieldgrid" style="margin-top:8px">
        ${field('DR', text(`${kind}.dr`, b.dr))}
        ${field('Resistances', text(`${kind}.resistances`, b.resistances))}
        ${field('Immunities', text(`${kind}.immunities`, b.immunities))}
      </div>` : ''}
    </section>`;
  }


function companionSavesPanel(model, kind, b, k) {
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
          ${kind === 'familiar' ? '' : `<td>${check(`${kind}.goodSaves.${key}`, b.goodSaves?.[key])}</td>`}
          <td class="num derived">${fmt(saves[key]?.base ?? 0)}</td>
          <td class="num derived">${fmt(saves[key]?.mod ?? 0)}</td>
          <td>${num(`${kind}.saves.${key}.misc`, b.saves?.[key]?.misc)}</td>
          <td class="num total"><span class="rollpair">${fmt(saves[key]?.total ?? 0)}${
            rollButton(model, kind, `save:${key}`, `a ${name} save`)}</span></td>
        </tr>`).join('')}
      </tbody></table>
      <p class="hint">${kind === 'familiar'
    ? 'Base saves are the master’s, never below +2.'
    : 'Tick the good saves; the table gives the good and poor base at this level.'}</p>
      <div class="fieldgrid" style="margin-top:8px">
        ${field('Speed', text(`${kind}.speed.base`, b.speed?.base, '30 ft.'))}
        ${field('Fly', text(`${kind}.speed.fly`, b.speed?.fly))}
        ${field('Swim', text(`${kind}.speed.swim`, b.speed?.swim))}
        ${field('Climb', text(`${kind}.speed.climb`, b.speed?.climb))}
        ${field('Burrow', text(`${kind}.speed.burrow`, b.speed?.burrow))}
      </div>
    </section>`;
  }


function companionAttacksPanel(model, kind, b, k) {
    const list = `${kind}.attacks`;
    const rows = b.attacks || [];
    const types = NATURAL_ATTACKS.map((a) => a.name);
    const cap = kind === 'eidolon' && k.maxAttacks ? ` <span class="badge${rows.length > k.maxAttacks ? ' err' : ''}">${rows.length} of ${k.maxAttacks} attacks</span>` : '';
    return `<section class="panel span2">
      <h3>Attacks <span class="badge">${fmt(k.totalAttack ?? 0)} to hit</span>${cap}
        <span class="pair" style="margin-left:auto">
          <label class="fld"><span>Ability</span>${select(`${kind}.attackAbility`, b.attackAbility, ABILITY_LABELS_LIST, kind === 'familiar' ? 'auto (better of Str / Dex)' : '—')}</label>
          <label class="fld"><span>Misc</span>${num(`${kind}.attackBonus`, b.attackBonus, 'style="width:3.6rem"')}</label>
        </span>
      </h3>
      ${rows.length ? `<table><thead><tr>
        <th>Type</th><th>Damage</th><th>Crit</th><th>Role</th><th>Bonus</th>
        <th class="num">To hit</th><th>Damage type</th><th>Qualities</th><th></th>
      </tr></thead><tbody>
        ${rows.map((a, i) => `<tr>
          <td>${itemSelect(list, i, 'type', a.type, types)}</td>
          <td>${itemText(list, i, 'damage', a.damage, '1d6')}</td>
          <td>${itemText(list, i, 'crit', a.crit, '20/×2')}</td>
          <td>${itemSelect(list, i, 'primary', a.primary === null || a.primary === undefined ? '' : (a.primary ? 'primary' : 'secondary'),
    [['primary', 'Primary'], ['secondary', 'Secondary']], `auto (${a.primaryResolved ? 'primary' : 'secondary'})`)}</td>
          <td>${itemNum(list, i, 'bonus', a.bonus)}</td>
          <td class="num total"><span class="rollpair">${fmt(a.toHit ?? 0)}${
            rollButton(model, kind, `attack:${i}`, `${a.type || 'this attack'} — attack and damage`)}</span></td>
          <td>${esc(a.damageType || '')}</td>
          <td>${itemArea(model, list, i, 'qualities', a.qualities, 1)}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No attacks yet.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add attack', { type: 'Bite', damage: '', crit: '20/×2', primary: null, bonus: 0, qualities: '' })}</div>
      <p class="hint">Secondary attacks take −5${k.multiattack ? ' — −2 here, for Multiattack' : ' (−2 with Multiattack)'}.
        Role on auto follows the natural-attack table.</p>
    </section>`;
  }


function eidolonEvolutionsPanel(model, b, k) {
    const list = 'eidolon.evolutions';
    const rows = b.evolutions || [];
    const over = (k.evoLeft ?? 0) < 0;
    return `<section class="panel span2">
      <h3>Evolutions
        <span class="badge${over ? ' err' : ''}">${k.evoSpent ?? 0} of ${k.evoPool ?? 0} points</span>
        <span class="pair" style="margin-left:auto">
          <label class="fld"><span>Bonus points</span>${num('eidolon.bonusEvoPoints', b.bonusEvoPoints, 'style="width:3.6rem"')}</label>
        </span>
      </h3>
      ${rows.length ? `<table><thead><tr>
        <th>Evolution</th><th style="width:4rem">Cost</th><th style="width:8rem">Type</th><th>Notes</th><th></th>
      </tr></thead><tbody>
        ${rows.map((e, i) => `<tr>
          <td>${itemText(list, i, 'name', e.name, 'Evolution')}</td>
          <td>${itemNum(list, i, 'cost', e.cost)}</td>
          <td>${itemText(list, i, 'type', e.type, 'Base form, 1-pt…')}</td>
          <td>${itemArea(model, list, i, 'notes', e.notes, 1)}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No evolutions yet.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add evolution', { name: '', cost: 1, type: '', notes: '' })}</div>
      ${over ? `<p class="hint warn">${-(k.evoLeft ?? 0)} point${k.evoLeft === -1 ? '' : 's'} over the pool.</p>` : ''}
      <div class="fieldgrid" style="margin-top:8px">
        <label class="fld" style="grid-column:1/-1"><span>Base form evolutions (free, by level)</span>
          ${prose(model, 'data-set="eidolon.baseEvolutions"', b.baseEvolutions, 2)}</label>
      </div>
      <p class="hint">The pool is the table’s at this level, less the master-level penalty, plus the bonus points.
        Readable as <code>eidolon.evoPool</code> and <code>eidolon.evoLeft</code>.</p>
    </section>`;
  }


function companionTricksPanel(model, b, k) {
    const list = 'animalCompanion.tricks';
    const rows = b.tricks || [];
    return `<section class="panel">
      <h3>Tricks <span class="badge">${k.tricksTaken ?? 0} taken · ${k.bonusTricks ?? 0} bonus</span></h3>
      ${rows.length ? `<div class="rowlist">${rows.map((t, i) => `<div class="item statline">
        <span class="label pair" style="flex:1">${itemText(list, i, 'name', t.name, 'Trick')}</span>
        <span class="value pair">${itemArea(model, list, i, 'notes', t.notes, 1)}
          <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button></span>
      </div>`).join('')}</div>` : '<p class="empty">No tricks yet.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add trick', { name: '', notes: '' })}</div>
      <p class="hint">Bonus tricks come from the table; the rest are taught with Handle Animal.</p>
    </section>`;
  }


function companionFeatsPanel(model, kind, b, k) {
    const list = `${kind}.feats`;
    const rows = b.feats || [];
    const allowed = k.featsAllowed ?? 0;
    const over = (k.featsTaken ?? 0) > allowed;
    return `<section class="panel">
      <h3>Feats <span class="badge${over ? ' err' : ''}">${k.featsTaken ?? 0} of ${allowed}</span></h3>
      ${rows.length ? `<div class="rowlist">${rows.map((f, i) => `<div class="item statline">
        <span class="label pair" style="flex:1">${itemText(list, i, 'name', f.name, 'Feat')}</span>
        <span class="value pair">${itemArea(model, list, i, 'notes', f.notes, 1)}
          <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button></span>
      </div>`).join('')}</div>` : '<p class="empty">No feats yet.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add feat', { name: '', notes: '' })}</div>
      <p class="hint">The table allows ${allowed} at this level. A feat named Multiattack softens secondary attacks to −2.</p>
    </section>`;
  }


function companionSkillsPanel(model, kind, b, k) {
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
          <td>${itemText(list, i, 'name', s.name, 'Skill')}</td>
          <td>${itemText(list, i, 'spec', s.spec, '')}</td>
          <td>${itemSelect(list, i, 'ability', s.ability, ABILITY_LABELS_LIST, null)}</td>
          <td>${itemCheck(list, i, 'classSkill', s.classSkill)}</td>
          <td>${itemNum(list, i, 'ranks', s.ranks)}</td>
          ${fam ? `<td class="num derived">${s.masterRanks || 0}</td>` : ''}
          <td>${itemNum(list, i, 'misc', s.misc)}</td>
          <td class="num total"><span class="rollpair">${fmt(s.total ?? 0)}${
            rollButton(model, kind, `skill:${i}`, `a ${skillLabel(s.name, s.spec) || 'skill'} check`)}</span></td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>
      <div style="margin-top:6px">${addButton(list, 'Add skill', { name: '', spec: '', ability: 'Int', trained: false, classSkill: false, ranks: 0, misc: 0 })}</div>
      <p class="hint">${fam
    ? 'A familiar uses its own ranks or its master’s, whichever is higher; the +3 class-skill bonus applies once there is a rank.'
    : kind === 'eidolon'
      ? 'Ranks per the sheet: HD × (6 + Int modifier). The +3 class-skill bonus applies once there is a rank.'
      : 'Ranks from the table at this level. The +3 class-skill bonus applies once there is a rank.'}</p>
    </section>`;
  }


function companionItemsPanel(b, k) {
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
          <td>${text(`animalCompanion.items.${slot}.name`, b.items?.[slot]?.name, '')}</td>
          <td>${num(`animalCompanion.items.${slot}.cost`, b.items?.[slot]?.cost)}</td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">Pick a body type above to see the item slots it can use.</p>'}
      <h4 style="margin:10px 0 4px">Slotless items</h4>
      ${rows.length ? `<table><thead><tr><th>Item</th><th style="width:6rem">Cost</th><th></th></tr></thead><tbody>
        ${rows.map((it, i) => `<tr>
          <td>${itemText(list, i, 'name', it.name, 'Item')}</td>
          <td>${itemNum(list, i, 'cost', it.cost)}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}
      </tbody></table>` : ''}
      <div style="margin-top:6px">${addButton(list, 'Add slotless item', { name: '', cost: 0 })}</div>
    </section>`;
  }


function companionGainsPanel(model, kind, b, k, label) {
    const gains = k.gains || [];
    return `<section class="panel">
      <h3>${esc(label)} abilities <span class="badge">${gains.length} from the table</span></h3>
      ${gains.length ? `<div class="rowlist">${gains.map((g) => `<div class="item statline">
        <span class="label">Level ${g.level}</span><span class="value">${esc(g.text)}</span>
      </div>`).join('')}</div>` : '<p class="empty">Nothing yet at this level.</p>'}
      <div class="fieldgrid" style="margin-top:8px">
        ${kind === 'familiar' ? `<label class="fld" style="grid-column:1/-1"><span>Familiar abilities</span>
          ${prose(model, 'data-set="familiar.abilities"', b.abilities, 3)}</label>` : ''}
        <label class="fld" style="grid-column:1/-1"><span>Special qualities</span>
          ${prose(model, `data-set="${kind}.specialQualities"`, b.specialQualities, 3)}</label>
      </div>
    </section>`;
  }


function companionNotesPanel(model, kind, b) {
    return `<section class="panel">
      <h3>Notes</h3>
      ${prose(model, `data-set="${kind}.notes"`, b.notes, 6)}
      <p class="hint">Formulas work here: <code>{= ${kind}.hp}</code>, <code>{= ${kind}.hd * 2}</code>.</p>
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

    const views = `<nav class="subtabs" role="tablist" aria-label="Cardcasting views">
      <button role="tab" data-deck-view="table" aria-selected="${ctx.deckView === 'table'}">The table${t.active ? ` <span class="badge">round ${t.round}</span>` : ''}</button>
      <button role="tab" data-deck-view="deck" aria-selected="${ctx.deckView === 'deck'}">The deck <span class="badge">${k.deckSize ?? 0}</span></button>
    </nav>`;
    if (ctx.deckView === 'table') return `${views}<div class="grid">${tablePanel(model, ctx, p, k)}</div>`;

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
      <div class="foldstrip">
        ${wrap('deck-summary', deckSummaryPanel(p, k))}
        ${wrap('deck-drawback', deckLadderPanel(p, k))}
        ${deckManipulationsHead(model, p, k)}
      </div>
      ${deckManipulationsPanel(model, p, k)}
      <div class="foldstrip">${wrap('deck-land', landAttunedPanel(p, k))}</div>
      ${deckTablePanel(model, p, k)}
      ${sideboardPanel(model, p)}
      <section class="panel span2">
        <h3>Notes</h3>
        ${prose(model, 'data-set="cardcasting.notes"', p.notes, 3)}
      </section>
      ${systemExtrasPanel(p, 'cardcasting', 'Cardcaster Deck')}
    </div>`;
  }

  /**
   * A card small enough for a zone: title bar with cost, the type line and
   * the effect, and whatever buttons the zone offers. Same frame rules as
   * the full face.
   */
function cardMini(model, id, { buttons = '', badge = '', tapped = false } = {}) {
    const card = model.tableCard(id);
    if (!card) return '';
    const r = card.calc || {};
    const colors = String(r.colors || '');
    const frameClass = r.artifact ? 'A' : colors.length === 1 ? esc(colors) : colors.length ? 'multi' : 'C';
    const isMana = !String(card.effect || '').trim() && card.mana;
    return `<div class="mcard mini ${frameClass}${tapped ? ' tapped' : ''}" style="${r.artifact ? '' : esc(cardFrameStyle(colors))}" data-card="${esc(id)}">
      <div class="bar title">
        <span class="name">${esc(card.name || (isMana ? 'Mana Point' : card.effect || 'card'))}</span>
        <span class="cost">${card.cost ? `<b>${esc(card.cost)}</b>` : ''}${manaChips(colors, '')}</span>
      </div>
      ${card.art ? `<div class="art"><img src="${esc(card.art)}" alt="" loading="lazy"></div>` : ''}
      <div class="bar type"><span>${esc(card.sphere || (isMana ? 'Mana Point' : ''))}${card.tags ? ` — ${esc(card.tags)}` : ''}</span></div>
      ${String(card.effect || '').trim() ? `<div class="text">${markKeywords(hasTokens(card.effect) ? renderedProse(model, card.effect) : esc(card.effect))}</div>` : ''}
      <div class="foot">
        ${card.mana ? `<span class="pair" title="Mana this card carries">${manaChips(card.mana, '')}</span>` : ''}
        ${badge}
        <span class="pair tools">${buttons}</span>
      </div>
    </div>`;
  }

  /** A button that drives the table: `data-table="action|id|arg"`. */
function tableBtn(action, id, label, { arg = '', title = '', cls = '', disabled = false } = {}) {
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
function tablePanel(model, ctx, p, k) {
    const t = p.table || {};
    const tc = t.calc || {};
    const active = !!t.active;
    const manips = p.manipulations || [];
    const has = (re) => manips.some((m) => re.test(String(m.name || '')) && Number(m.count) > 0);
    const readTwice = manips.some((m) => /^read the cards/i.test(String(m.name || '')) && Number(m.count) >= 2);
    const loaded = 2 * (k.loadedHand || 0);
    const redrawTo = Math.max(0, t.hand?.length + (t.round === 1 ? t.mana?.length : 0) - (t.redraws === 0 && has(/^mulligan/i) ? 0 : 1));
    // Spell points, from the tracker if the character keeps one.
    const sp = model.spellPointTracker();
    const spLeft = sp ? (Number(sp.max) || 0) - (Number(sp.current) || 0) : null;
    const spBtn = (id) => (sp ? tableBtn('sp', id, '+1 SP', { arg: 1, title: 'Spend one spell point on this card — a boost, a modal option' }) : '');

    const controls = active ? `
        ${tableBtn('next', '', 'Next round', { title: p.mods.exposedGrip ? 'Exposed Grip: no automatic draw' : 'Draw one card' + (p.mods.stagnantPool ? '; untap Stagnant Pool mana' : ''), cls: 'primary' })}
        ${tableBtn('draw', '', 'Draw a card', { title: 'Rapid Fill, Life Draw, Prize Card, Primed Hand — any draw the rules hand you' })}
        ${tableBtn('redraw', '', `Redraw hand → ${redrawTo}`, { title: 'Shuffle the hand back and draw one fewer' + (has(/^mulligan/i) ? ' (Mulligan: the same number the first time)' : ''), disabled: (t.hand?.length || 0) + (t.round === 1 ? t.mana?.length || 0 : 0) <= 1 })}
        ${p.cooldown ? tableBtn('shuffle', '', 'Shuffle discard in', { title: 'A full-round action: the discard pile shuffled into the deck', disabled: !(t.discard?.length) }) : ''}
        ${has(/^read the cards/i) ? tableBtn('peek', '', `Read the cards (${readTwice ? 3 : 1})`, { arg: readTwice ? 3 : 1, title: 'Look at the top of the deck' }) : ''}
        ${sp ? tableBtn('sp', '', 'Spend 1 SP', { arg: 1, title: 'A spell point on something the cards do not know about — Retrace, Read the Cards, Fresh Hand…' }) : ''}
        ${tableBtn('end', '', 'End encounter', { title: 'Everything shuffled back into the deck', cls: 'danger' })}`
      : `${tableBtn('start', '', `Start encounter — draw ${k.openingHand ?? 2}${loaded ? ` + ${loaded}` : ''}`, { title: 'Shuffle every copy in the deck and draw the opening hand', cls: 'primary', disabled: !(k.deckSize > 0) })}`;

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
      const rolls = model.cardRolls(card);
      if (!rolls.length) return '';
      const first = tableBtn('roll', id, '🎲', { title: `Roll ${rolls[0].expr}` });
      if (rolls.length === 1) return first;
      return `${first}<select class="movesel rollsel" data-table-roll="${esc(id)}" aria-label="Other rolls" title="Other rolls on this card">
        <option value="">roll…</option>
        ${rolls.slice(1).map((r) => `<option value="${esc(r.label)}" title="${esc(r.expr)}">${esc(r.label)}</option>`).join('')}
      </select>`;
    };

    const handCards = (t.hand || []).map((id) => {
      const card = model.tableCard(id);
      const check = tc.castable?.[id] || {};
      const manaOk = tc.manaOk?.[id] || {};
      const isEffect = String(card?.effect || '').trim() !== '';
      const badge = isEffect && p.manaPool
        ? `<span class="badge ${check.ok ? 'ok' : 'err'}" title="${esc(check.why || `needs ${check.need}, has ${check.have}`)}">${check.ok ? 'castable' : `${check.have}/${check.need} mana`}</span>` : '';
      return cardMini(model, id, {
        badge,
        buttons: `${isEffect ? tableBtn('play', id, 'Cast', { arg: 'cast', title: 'Cast: the effect resolves now', cls: 'primary' })
          + tableBtn('play', id, 'Ongoing', { arg: 'ongoing', title: 'Cast an effect that lasts: the card stays in play until it resolves' })
          + (tc.trapCard ? tableBtn('play', id, 'Trap', { arg: 'trap', title: 'Trap Card: set it face down in play; spring it later' }) : '') : ''}
          ${card?.mana ? tableBtn('play', id, 'As mana', { arg: 'mana', title: manaOk.ok ? (manaOk.why || 'Play the Mana Point card onto the table') : manaOk.why, disabled: !manaOk.ok }) : ''}
          ${rollBtn(id, card)}${isEffect ? spBtn(id) : ''}
          ${tableBtn('move', id, '⤓', { arg: 'discard', title: 'Discard' })}
          ${zoneMoves(id, 'hand')}`,
      });
    }).join('');

    const faceDown = new Set(t.faceDown || []);
    const playCards = (t.play || []).map((id) => (faceDown.has(id)
      ? `<div class="mcard mini trap" data-card="${esc(id)}">
          <div class="trapback">Trap<br><small>face down</small></div>
          <div class="foot"><span class="pair tools">
            ${tableBtn('resolve', id, 'Spring', { title: 'The trap springs: it is cast now, keywords and all', cls: 'primary' })}
            ${tableBtn('reveal', id, 'Reveal', { title: 'Turn it face up, still in play' })}
            ${zoneMoves(id, 'play')}
          </span></div>
        </div>`
      : cardMini(model, id, {
        buttons: `${tableBtn('resolve', id, 'Resolve', { title: 'The effect ends: back to the deck, or the discard under Cooldown', cls: 'primary' })}${rollBtn(id, model.tableCard(id))}${spBtn(id)}${zoneMoves(id, 'play')}`,
      }))).join('');

    const manaCards = (t.mana || []).map((m) => {
      const card = model.tableCard(m.id);
      const colors = String(card?.mana || '');
      return `<div class="manacard${m.tapped ? ' tapped' : ''}" style="${esc(cardFrameStyle(colors))}" data-card="${esc(m.id)}">
        <span class="mana">${manaChips(colors, '')}</span>
        <span class="mname">${esc(card?.name || 'Mana Point')}</span>
        ${p.mods.stagnantPool || m.tapped ? tableBtn('tap', m.id, m.tapped ? 'Untap' : 'Tap', { title: 'Stagnant Pool: a tapped Mana Point card is spent for the round' }) : ''}
        ${zoneMoves(m.id, 'mana')}
      </div>`;
    }).join('');

    const listZone = (ids, from, extra = () => '') => (ids || []).map((id) => {
      const card = model.tableCard(id);
      return `<div class="zonerow" data-card="${esc(id)}">
        ${manaChips(String(card?.calc?.colors || ''), '')}
        <span class="zname">${esc(card?.name || card?.effect || 'card')}</span>
        <span class="zsub">${esc(card?.effect || (card?.mana ? `Mana ${card.mana}` : ''))}</span>
        <span class="pair tools">${extra(id)}${zoneMoves(id, from)}</span>
      </div>`;
    }).join('');

    const peeked = ctx.peek.filter((id) => (t.deck || []).slice(0, 3).includes(id));
    const stagnant = p.mods.stagnantPool;

    const lastRoll = t.lastRoll && model.tableCard(t.lastRoll.id)
      ? `<span class="badge roll" title="${esc(t.lastRoll.source)}">🎲 ${esc(model.tableCard(t.lastRoll.id).name || 'roll')}: [${t.lastRoll.rolls.join(', ')}]${t.lastRoll.flat ? ` ${t.lastRoll.flat >= 0 ? '+' : '−'} ${Math.abs(t.lastRoll.flat)}` : ''} = <b>${t.lastRoll.total}</b></span>` : '';

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
        ${t.counters ? `<span class="badge" title="Perfect Draw's counters">[Ante] ${esc(model.tableCard(t.counters.id)?.name || '')}: ${t.counters.early} Early · ${t.counters.late} Late</span>` : ''}
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
      ${peeked.length ? `<p class="hint">Top of the deck: </p><div class="zone one">${peeked.map((id, i) => cardMini(model, id, {
    badge: `<span class="badge">${i === 0 ? 'top' : `${i + 1}${i === 1 ? 'nd' : 'rd'}`}</span>`,
    buttons: `${tableBtn('bury', id, '⤓ bottom (1 SP)', { title: 'Read the Cards: a spell point puts it on the bottom of the deck' })}
      ${readTwice ? tableBtn('move', id, 'discard', { arg: 'discard', title: 'Read the Cards taken twice: discard it' }) : ''}`,
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
          ${t.discard.length ? `<span class="pair" style="margin-left:auto">${tableBtn('exileRandom', '', 'Exile one at random', { arg: 1, title: 'Blood and Dust, Grave Peril: a random card from the graveyard into exile' })}</span>` : ''}
        </h3>
        ${t.discard.length ? `<div class="zonelist">${listZone(t.discard, 'discard', (id) => `${rollBtn(id, model.tableCard(id))}${spBtn(id)}${has(/^recollection|^resupply/i) ? tableBtn('move', id, '→ hand', { arg: 'hand', title: 'Recollection / Resupply' }) : ''}${has(/^retrace/i) ? tableBtn('retrace', id, 'Retrace', { title: 'Retrace: cast it from the discard for its cost + 1 spell point (or a longer casting time); it rolls, its keywords fire, and it stays in the discard' }) : ''}`)}</div>`
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
      <p class="hint">Card Casting is one drawback on its own; Cooldown or Mana Pool makes it two,
        both make it three, Mana Graveyard four; each modification is one more
        (five-colour Colored Mana is two). Hover a row for the whole rule.</p>
      <div class="modgrid">
      ${row('Card Casting', '<span class="badge">always</span>',
    'Effects that cost spell points live on cards. Draw 1 + casting modifier (at least 2) at initiative, one more each round; play a card to cast it, and shuffle it back once its effect has resolved. Out of combat, search the deck and cast at +1 minute.')}
      ${row('Cooldown', check('cardcasting.cooldown', p.cooldown, p.cooldown ? 'taken' : 'not taken'),
    'Resolved cards go to a discard pile instead of the deck. A full-round action shuffles the discard back in; so does running out of cards, as a free action.')}
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

  /** Deck manipulations by group, taken against what is available. */
/**
 * The groups a deck's manipulations are filed under: the four the system
 * names, and any the player invented. Both halves of the panel below want
 * this list -- the head to build its picker, the groups to draw themselves --
 * so it is worked out once here rather than twice.
 */
function manipulationGroups(p) {
  return [...new Set(['General', 'Cooldown', 'Mana Pool', 'Specialized Mana Cards',
    ...(p.manipulations || []).map((m) => String(m.group || 'General'))])];
}

/** What a manipulation's `requires` are called when a row is missing one. */
const MANIP_NEED = {
  cooldown: 'Cooldown', manaPool: 'Mana Pool', coloredMana: 'Colored Mana',
  singleton: 'Singleton', gradualRamp: 'Gradual Ramp', notManaGraveyard: 'no Mana Graveyard',
};

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
function deckManipulationsHead(model, p, k) {
    const groups = manipulationGroups(p);
    const left = k.manipulationsLeft ?? 0;
    const catalogue = deckManipulationCatalogue();
    const featList = (k.deckFeats || []).map((f) => f.replace(/\s*\[[^\]]*\]\s*/g, '').trim());
    const NEED = MANIP_NEED;
    const head = `<section class="panel span2 manip-head">
      <h3>Deck manipulations
        <span class="badge ${left < 0 ? 'err' : ''}">${k.manipulationsTaken ?? 0} of ${k.manipulationsAvailable ?? 0} taken${left < 0 ? ` — ${-left} over` : left ? ` — ${left} left` : ''}</span>
        <span class="badge" title="${esc(featList.join(', ') || 'No feat or bought-off drawback is tagged [Deck]')}">${(k.deckFeats || []).length} deck feat${(k.deckFeats || []).length === 1 ? '' : 's'}</span>
        ${k.rainbow ? `<span class="badge">${k.rainbow === 2 ? 'Improved ' : ''}Rainbow Efficiency</span>` : ''}
      </h3>
      <div class="fieldgrid">
        ${field('Available', exprField('data-set="cardcasting.manipulationsAvailable"', p.manipulationsAvailable ?? '', {
    width: '7rem', value: k.manipulationsAvailable, error: k.manipulationsError, placeholder: `auto: ${k.autoAvailable ?? 0}`,
    title: 'Blank: one per deck feat, plus one for Card Shark. Or a number, or a formula.',
  }))}
        ${field('Add from the list', `<select class="manip-pick" aria-label="Add a deck manipulation">
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
    return collapsible(model, 'deck-manipulations', head);
  }

  /**
   * One panel per group of manipulations, in a column layout of their own so
   * they sit two or three abreast with room for each note.
   *
   * Each folds on its own, keyed by the group's name rather than by its
   * position, so a player who only uses Cooldown can shut the other three and
   * have them stay shut -- and a group of their own invention folds like the
   * four that come with the system. They need no `foldstrip`: the column
   * layout already packs a folded one against its neighbours.
   */
function deckManipulationsPanel(model, p, k) {
    const list = 'cardcasting.manipulations';
    const items = (p.manipulations || []).map((m, i) => ({ m, i }));
    const groups = manipulationGroups(p);
    const groupOptions = groups.map((g) => [g, g]);
    const NEED = MANIP_NEED;
    const panels = groups.map((g) => {
      const rows = items.filter(({ m }) => String(m.group || 'General') === g);
      const taken = rows.reduce((n, { m }) => n + (Number(m.count) || 0), 0);
      return collapsible(model, `deck-manip-${slug(g)}`, `<section class="panel">
        <h3>${esc(g)} ${taken ? `<span class="badge">${taken} taken</span>` : ''}</h3>
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
              ${prose(model, `data-item="${list}|${i}|note"`, m.note, 1, 'grow note')}
              ${entry ? `<p class="rule">${esc(entry.text)}</p>` : ''}
            </td>
            <td>${itemNum(list, i, 'count', m.count)}</td>
            <td class="tools"><span class="pair">
              ${itemSelect(list, i, 'group', m.group || 'General', groupOptions, null)}
              <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
            </span></td>
          </tr>`;
  }).join('')}
        </tbody></table></div>` : '<p class="empty">None listed.</p>'}
        <div style="margin-top:6px">${addButton(list, `Add to ${g}`, { group: g, name: '', note: '', count: 1 })}</div>
      </section>`);
    }).join('');
    return `<div class="span2 grid manipgrid">${panels}</div>`;
  }

  /** Land-attuned magic: which spheres each colour covers, and which are attuned. */
function landAttunedPanel(p, k) {
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
          <div class="what"><span class="pair">${manaChips(c)} <strong>${esc(name)}</strong></span>
            <div class="spheres">
              ${rows.map((s, i) => `<span class="pair">
                <button data-action="attune-sphere" data-sphere="${esc(s)}" aria-pressed="${attuned.has(s)}"
                  title="${attuned.has(s) ? 'Attuned — click to clear' : 'Click to attune'}"
                  class="${attuned.has(s) ? 'primary' : ''}">${attuned.has(s) ? '✓' : '○'}</button>
                ${itemText(list, i, 'self', s, 'Sphere')}
                ${tally[s] ? `<span class="badge">${tally[s]}</span>` : ''}
                <button class="danger" data-remove="${list}|${i}" title="Remove" aria-label="Remove">×</button>
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
function cardFace(model, list, i, card, p, { inDeck = true } = {}) {
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
          ${manaChips(colors, '')}
        </span>
      </div>
      ${p.harrow ? `<div class="bar sub">
        ${itemSelect(list, i, 'suit', card.suit, ABILITY_LABELS_LIST, 'suit')}
        <input type="text" value="${esc(card.alignment ?? '')}" data-item="${list}|${i}|alignment" data-kind="text" placeholder="align." aria-label="Alignment">
      </div>` : ''}
      <div class="art">${card.art ? `<img src="${esc(card.art)}" alt="" loading="lazy">` : ''}</div>
      <div class="bar type">
        <input type="text" value="${esc(card.sphere ?? '')}" data-item="${list}|${i}|sphere" data-kind="text" placeholder="${isMana ? 'Mana Point' : 'Sphere'}" aria-label="Sphere">
        <span class="dash">—</span>
        <input type="text" value="${esc(card.tags ?? '')}" data-item="${list}|${i}|tags" data-kind="text" placeholder="tags" aria-label="Tags">
      </div>
      <div class="text">${prose(model, `data-item="${list}|${i}|effect"`, card.effect, 3, 'grow')}</div>
      <div class="foot">
        <span class="pair" title="Mana this card puts on the table (fused Mana Point): letters R B U W G">
          <input type="text" class="short" value="${esc(card.mana ?? '')}" data-item="${list}|${i}|mana" data-kind="text" placeholder="mana" aria-label="Mana carried">
          ${manaChips(card.mana, '')}
        </span>
        <span class="pair" title="Dice to roll on the table — 6d6+int.mod, or a name from the sheet in the flat part; blank uses the first dice in the text">🎲<input type="text" class="short dice" value="${esc(card.dice ?? '')}" data-item="${list}|${i}|dice" data-kind="text" placeholder="dice" aria-label="Dice"></span>
        ${inDeck ? `<span class="pair" title="Copies in the deck">×${itemNum(list, i, 'qty', card.qty)}</span>` : ''}
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
function deckTablePanel(model, p, k) {
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
          ${check('cardcasting.harrow', p.harrow, 'Harrow deck — suits & alignments')}
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
      ${cards.length ? `<div class="cardgrid">${cards.map((card, i) => cardFace(model, list, i, card, p)).join('')}</div>`
    : '<p class="empty">No cards yet. A deck needs at least 20.</p>'}
      <div class="pair" style="margin-top:10px">
        ${addButton(list, 'Add effect card', newCard({}))}
        ${addButton(list, 'Add mana point card', newCard({ cost: '', mana: (k.colorsInPlay || 'R').slice(0, 1) }))}
      </div>
    </section>`;
  }

  /** Cards kept aside for a swap at rest. */
function sideboardPanel(model, p) {
    const list = 'cardcasting.sideboard';
    const cards = p.sideboard || [];
    return `<section class="panel span2">
      <h3>Sideboard <span class="badge">${cards.length}</span></h3>
      <p class="hint">Cards built but not in the deck — the deck can only change when you rest to regain spell points.</p>
      ${cards.length ? `<div class="cardgrid">${cards.map((card, i) => cardFace(model, list, i, card, p, { inDeck: false })).join('')}</div>` : ''}
      <div style="margin-top:10px">${addButton(list, 'Add to sideboard', {
    name: '', suit: '', alignment: '', effect: '', cost: '', sphere: '', tags: '', color: '', mana: '', art: '', notes: '',
  })}</div>
    </section>`;
  }
