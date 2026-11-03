/**
 * ui/panels/vancian.js -- the Vancian tab.
 *
 * Casting classes and their spell tables, every number derived from the
 * shared casting table a pack supplies and each cell open to an override,
 * then the prepared spell list. `slotSpend` draws what is left of a pool of
 * slots with the tracker shapes; the Overview's session dashboard draws
 * spell slots with it too.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, val, ABILITY_LABELS_LIST, nameDatalist, noteCell } from '../html.js';
import { prose } from '../prose.js';
import { forwardedBadge } from '../badges.js';
import { rollButton } from '../roll.js';
import { castingTableNames, spellCatalogue, spellDetails, vancianForwardKey } from '../../model.js';
import { CASTING_SOURCES, PREP_STYLES, SPELL_LEVELS, castingNoun, fmt, prepStyle } from '../../rules.js';
import { countsTowardLine } from '../counts-toward.js';
import { squareLayout } from '../../tracker-style.js';
import { field, autoNum, levelPin, levelPinHint, select } from '../fields.js';
import {
  addButton, exprField, foldButton, isOpen, itemNum, itemText, removeButton, rowRemove,
} from '../rows.js';
import { systemExtrasPanel } from './system-tabs.js';

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
