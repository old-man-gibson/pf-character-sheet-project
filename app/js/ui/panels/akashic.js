/**
 * ui/panels/akashic.js -- the Akashic tab.
 *
 * Veilweaving: the day's essence as a gauge, the veilweaving classes, the
 * veil board with a row per slot, the kheshig and the other receptacles.
 * The numbers are worked out in model/subsystems/akashic.js, and the veils
 * a pack supplies fill the name pickers.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, ABILITY_LABELS_LIST, nameDatalist, packText } from '../html.js';
import { itemArea, renderedProse } from '../prose.js';
import { meterStyleButton, meterStyleEditor, meterVisual } from './trackers.js';
import { veilsAvailable, veilDetails, veilOwn, slug } from '../../model.js';
import { ESSENCE_SOURCES, SP_PER_TEMP_ESSENCE, VEIL_SLOTS } from '../../rules.js';
import { check, num, autoNum, select } from '../fields.js';
import {
  addButton, foldButton, isCollapsed, isOpen, itemNum, itemText, removeButton, rowRemove,
} from '../rows.js';
import { systemExtrasPanel } from './system-tabs.js';

  /**
   * The veil board.
   *
   * The workbook laid this out as two columns of four-row blocks with a save
   * DC restated beside every veil. Here each slot is a row that holds one veil
   * -- or two when Twinveil is ticked -- and the DC is computed from the
   * veilweaver's base plus the essence invested, which is what the sheet's own
   * numbers always worked out to.
   */
export function renderAkashicPanel(model, ctx) {
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
 * veil shaped in that slot. It is drawn empty and filled as the name is typed
 * (`veil:<slot>` in ui/datalist.js), because the Hands chakra alone runs to a
 * few hundred entries and every render used to send them all. Nothing is
 * emitted where no pack provides a catalogue, and the name field is then the
 * free-text box it has always been -- a player who types a veil nobody has
 * published is not doing anything wrong.
 */
function veilOptions(a, slot) {
  const classes = veilweavingClasses(a);
  if (!veilsAvailable({ slot, classes }).length) return { id: '', html: '' };
  const id = `veils-${slug(slot || 'any')}`;
  return { id, html: nameDatalist(id, `veil:${slot || ''}`, { classes }) };
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
