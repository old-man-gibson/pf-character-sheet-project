/**
 * ui/panels/gear.js -- what the character is carrying, and what they are making.
 *
 * Two tabs that share their furniture: Equipment (weapons, armour, the gear
 * list and what it all weighs) and Item Crafting (the projects, their speed and
 * their cost). Weapons are the interesting half -- every row is a small
 * calculation with a d20 beside it -- and the crafting tables are the other,
 * where a price may be written as a formula.
 *
 * A note on the indentation: these bodies are indented as they were when they
 * were methods, one level deeper than a module-level function usually is. That
 * is deliberate. Most of what they return is a template literal, and every
 * space inside one is a space in the rendered HTML -- so re-indenting the code
 * would quietly rewrite the markup. Keeping the original indentation keeps the
 * output identical, which is the whole point of moving them.
 */

import { weaponHandle } from '../../model.js';
import { esc } from '../html.js';
import { roField } from '../fields.js';
import { MATERIAL_CASTING_PER_LEVEL } from '../../model.js';
import { group, pct, round } from '../format.js';
import {
  ABILITIES, ABILITY_LABELS, CRAFT_CHECK_MODES, CRAFT_SPEED_KINDS, CRAFT_SPEED_MULTIPLIER,
  CRAFT_TIME_BASES, GEAR_BONUS_TYPES, SIZE_MODIFIERS, WEAPON_ATTACK_TYPES, WEAPON_CRIT_MULTS,
  WEAPON_FAMILIARITY, WEAPON_GROUPS, WEAPON_HANDEDNESS, attackModeAbility, diceString, fmt,
} from '../../rules.js';
import { WEAPON_MODE_KEYS } from '../../roll20.js';
import { check, field, num, select, text } from '../fields.js';
import {
  addButton, bigStat, editLine, exprField, itemCheck, itemExpr, itemNum, itemSelect,
  itemText, line, rowRemove, rowTools,
} from '../rows.js';
import { forwardedBadge } from '../badges.js';
import { rollButton } from '../roll.js';
import { itemArea } from '../prose.js';

export function renderGearPanel(model, ctx) {
    const c = model.data;
    const e = c.equipment;
    return `<div class="grid">
      ${weaponsPanel(model, e)}
      ${armorPanel(e)}
      ${gearSlotsPanel(ctx, e)}
      ${otherItemsPanel(e)}
      ${loadPanel(model, e)}
    </div>`;
  }

  /** The six-block weapon layout from the workbook, as editable cards. */
export function weaponsPanel(model, e) {
    const weapons = e.weapons || [];
    const cs = model.conditionState;
    return `<section class="panel span2">
      <h3>Weapons <span class="badge">${weapons.length}</span></h3>
      ${weapons.map((w, i) => `<div class="weapon${w.collapsed ? ' collapsed' : ''}">
        <div class="weaponhead">
          <button class="wfold" data-action="toggle-weapon" data-index="${i}"
            aria-expanded="${!w.collapsed}"
            title="${w.collapsed ? 'Open this weapon' : 'Collapse this weapon'}"
            aria-label="${w.collapsed ? 'Open' : 'Collapse'} ${esc(String(w.name || '').trim() || 'weapon')}"
            >${w.collapsed ? '▸' : '▾'}</button>
          <span class="wnames">
            ${itemText('equipment.weapons', i, 'name', w.name, 'Weapon name')}
            <label class="whandle" title="What a formula calls this weapon — {weapon.${esc(w.handle || '')}.damage += 2}. Clear it and it goes back to the weapon's own name, cut at the first bracket.">
              <span>weapon.</span><input type="text" class="mono" value="${esc(w.handle ?? '')}"
                data-item="equipment.weapons|${i}|id" data-kind="text"
                placeholder="${esc(weaponHandle(w.name))}" aria-label="Formula name"></label>
          </span>
          <span class="bigroll" title="Attack including {{…}} tokens">${esc(w.calc?.totalAtkStr ?? fmt(w.attackTotal ?? 0))}</span>
          <span class="bigroll dmg" title="Damage including [[…]] tokens">${esc(w.calc?.totalDmgStr ?? w.damageTotal ?? '—')}</span>
          ${w.proficient === false ? `<span class="badge err nonprof"
            title="${esc(w.proficiencyWhy)} — non-proficiency is −4 to hit, yours to write in Misc">not proficient</span>`
    : w.proficient === true && w.proficiencySource !== 'overview' ? `<span class="badge ok nonprof"
            title="${esc(w.proficiencyWhy)}">proficient · ${w.proficiencySource === 'veil' ? 'veil' : esc(w.proficiencyNote || 'row')}</span>` : ''}
          ${rollButton(model, 'weapon', i, `${String(w.name || '').trim() || 'this weapon'} — attack and damage`, cs)}
          <button class="danger" data-remove="equipment.weapons|${i}" aria-label="Remove weapon">×</button>
        </div>
        <div class="weapongrid">
          ${field('Base', itemSelect('equipment.weapons', i, 'attackType', w.attackType,
            WEAPON_ATTACK_TYPES, '—', (t) => attackModeAbility(model.data, WEAPON_MODE_KEYS[t])))}
          ${field('Enh.', itemNum('equipment.weapons', i, 'enhancement', w.enhancement))}
          ${field('Misc', itemNum('equipment.weapons', i, 'miscAttack', w.miscAttack)
            + forwardedBadge(model, `weapon.${i}.attack`))}
          ${field('Adj.', itemNum('equipment.weapons', i, 'attackOffset', w.attackOffset))}
          <span class="wsep"></span>
          ${field('Dice', `<span class="pair">
            ${exprField(`data-item="equipment.weapons|${i}|dice"`, w.dice, {
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
              ${itemCheck('equipment.weapons', i, 'useUnarmedDice', w.useUnarmedDice)}<span>🥊</span></label>
          </span>`)}
          ${field('Ability', itemSelect('equipment.weapons', i, 'damageAbility', w.damageAbility, ABILITIES.map((k) => ABILITY_LABELS[k])))}
          ${field('×', `<input type="number" value="${w.abilityMult ?? 1}" step="0.5" min="0"
            data-item="equipment.weapons|${i}|abilityMult" data-kind="number" style="width:3.2rem"
            title="Ability multiplier — usually 1, 1.5 or 2, but anything goes">`)}
          ${field('Misc dmg', itemExpr('equipment.weapons', i, 'miscDamage', w, { width: '4.5rem' })
            + forwardedBadge(model, `weapon.${i}.damage`)
            + forwardedBadge(model, `weapon.${i}.damage.mult`, 'mult')
            + forwardedBadge(model, `weapon.${i}.damage.crit`, 'crit'))}
          <span class="wsep"></span>
          ${field('Crit', itemNum('equipment.weapons', i, 'critRange', w.critRange))}
          ${field('Mult', itemSelect('equipment.weapons', i, 'critMult', w.critMult, WEAPON_CRIT_MULTS))}
          ${field('Damage type', itemText('equipment.weapons', i, 'damageType', w.damageType))}
        </div>
        <div class="weapongrid">
          ${field('Size', itemSelect('equipment.weapons', i, 'size', w.size, Object.keys(SIZE_MODIFIERS)))}
          ${field('Groups', `<span class="pair">
            ${itemSelect('equipment.weapons', i, 'groups.0', (w.groups || [])[0], WEAPON_GROUPS)}
            ${itemSelect('equipment.weapons', i, 'groups.1', (w.groups || [])[1], WEAPON_GROUPS)}
            ${itemSelect('equipment.weapons', i, 'groups.2', (w.groups || [])[2], WEAPON_GROUPS)}</span>`)}
          ${field('Handedness', itemSelect('equipment.weapons', i, 'handedness', w.handedness, WEAPON_HANDEDNESS))}
          ${field('Familiarity', itemSelect('equipment.weapons', i, 'familiarity', w.familiarity, WEAPON_FAMILIARITY))}
          ${field('Range', itemText('equipment.weapons', i, 'range', w.range))}
          ${field('Ammo', itemText('equipment.weapons', i, 'ammunition', w.ammunition))}
          ${field('Wt', itemNum('equipment.weapons', i, 'weight', w.weight))}
          ${field('Price', itemNum('equipment.weapons', i, 'price', w.price))}
          <span class="wsep"></span>
          ${field('As', `<input type="text" value="${esc(w.baseWeapon ?? '')}" data-item="equipment.weapons|${i}|baseWeapon"
            data-kind="text" placeholder="katana" style="width:6.5rem"
            title="The base weapon this is — a named blade that is a katana, a veil that takes a longsword's form — read against the Overview's specific weapons">`)}
          ${field('Proficient', `<select data-item="equipment.weapons|${i}|proficiency" data-kind="text"
            title="${esc(w.proficiencyWhy || 'Auto reads the row against the Overview\'s Proficiencies and the [Enhanced] veil rule')}">
            <option value=""${!w.proficiency ? ' selected' : ''}>Auto${w.proficient === true ? ' ✓' : w.proficient === false ? ' ✗' : ''}</option>
            <option value="yes"${w.proficiency === 'yes' ? ' selected' : ''}>Yes</option>
            <option value="no"${w.proficiency === 'no' ? ' selected' : ''}>No</option></select>`)}
          ${w.proficiency ? field('Via', `<input type="text" value="${esc(w.proficiencyNote ?? '')}" data-item="equipment.weapons|${i}|proficiencyNote"
            data-kind="text" placeholder="Custom Training" style="width:8rem"
            title="What grants or denies it — a talent, a class feature, a trait">`) : ''}
        </div>
        <label class="fld" style="margin-top:6px"><span>Special properties
          <span class="hint">— write {{…}} to add to hit and [[…]] to add damage; dice, formulas, a
            {name} you defined, or a mix. Tag a damage token <strong>Crit</strong> for crit-only
            (multiplied) or <strong>Mult</strong> for damage that multiplies with the weapon;
            untagged is a rider, added once on a crit.</span></span>
          ${itemArea(model, 'equipment.weapons', i, 'special', w.special, 2)}</label>
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
      <div style="margin-top:8px">${addButton('equipment.weapons', 'Add weapon', {
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

function armorPanel(e) {
    const row = (piece, path, tools = '') => `<tr class="${piece.active ? '' : 'untrained'}">
      <td class="mid">${check(`${path}.active`, piece.active)}</td>
      <td>${esc(piece.kind || 'Armor')}</td>
      <td>${text(`${path}.name`, piece.name)}</td>
      <td class="num">${num(`${path}.acBonus`, piece.acBonus, 'style="width:3.2rem"')}</td>
      <td class="num"><input type="number" value="${piece.maxDex ?? ''}" placeholder="—"
        data-set="${path}.maxDex" data-kind="number-or-null" style="width:3.2rem"></td>
      <td class="num">${num(`${path}.acp`, piece.acp, 'style="width:3.2rem"')}</td>
      <td>${text(`${path}.type`, piece.type)}</td>
      <td class="mid">${check(`${path}.ghostTouch`, piece.ghostTouch)}</td>
      <td class="num">${num(`${path}.weight`, piece.weight, 'style="width:3.6rem"')}</td>
      <td class="num">${num(`${path}.cost`, piece.cost, 'style="width:4rem"')}</td>
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
      <div style="margin-top:8px">${addButton('equipment.shields', 'Add shield', {
        kind: 'Shield', name: '', acBonus: 0, maxDex: null, acp: 0, type: '',
        ghostTouch: false, others: [], weight: 0, cost: 0, active: false,
      })}</div>
      <p class="hint">
        Worn pieces feed AC, cap the AC stat at the lowest Max Dex, and apply their
        armor check penalty to flagged skills — all live.
      </p>
    </section>`;
  }

function gearRow(list, i, g, tools) {
    const bonus = (bi) => `
      <td class="num"><input type="number" value="${g.bonuses?.[bi]?.value ?? ''}" placeholder="—"
        data-item="${list}|${i}|bonuses.${bi}.value" data-kind="number-or-null" style="width:3rem"></td>
      <td>${itemSelect(list, i, `bonuses.${bi}.type`, g.bonuses?.[bi]?.type, GEAR_BONUS_TYPES)}</td>`;
    return `<tr>
      <td>${esc(g.slot)}</td>
      <td>${itemText(list, i, 'name', g.name)}</td>
      ${bonus(0)}${bonus(1)}${bonus(2)}
      <td>${itemText(list, i, 'others.0', g.others?.[0])}</td>
      <td>${itemText(list, i, 'others.1', g.others?.[1])}</td>
      <td>${itemText(list, i, 'others.2', g.others?.[2])}</td>
      <td>${itemText(list, i, 'others.3', g.others?.[3])}</td>
      <td class="num">${itemNum(list, i, 'weight', g.weight)}</td>
      <td class="num">${itemNum(list, i, 'cost', g.cost)}</td>
      ${tools || '<td></td>'}
    </tr>`;
  }

const GEAR_HEAD = `<thead><tr>
    <th>Slot</th><th>Item</th>
    <th class="num">B1</th><th>Type</th><th class="num">B2</th><th>Type</th>
    <th class="num">B3</th><th>Type</th>
    <th>Other 1</th><th>Other 2</th><th>Other 3</th><th>Other 4</th>
    <th class="num">Wt</th><th class="num">Cost</th><th></th></tr></thead>`;

function gearSlotsPanel(ctx, e) {
    const showAll = ctx.showAllGear;
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
        ${GEAR_HEAD}
        <tbody>${rows.map(({ g, i }) => gearRow('equipment.gear', i, g)).join('')
    || '<tr><td colspan="15"><p class="empty">Nothing worn — show all slots to fill them in.</p></td></tr>'}</tbody>
      </table></div>
      <p class="hint">Three typed bonuses per item (value + bonus type) plus four freeform ones, like the sheet.</p>
    </section>`;
  }

function otherItemsPanel(e) {
    return `<section class="panel span2">
      <h3>Other items</h3>
      <div class="tablewrap"><table>
        ${GEAR_HEAD}
        <tbody>${(e.other || []).map((g, i) => gearRow('equipment.other', i, g,
    `<td class="tools"><button class="danger" data-remove="equipment.other|${i}" aria-label="Remove">×</button></td>`)).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton('equipment.other', 'Add item', {
        slot: 'Other', name: '', bonuses: [{ value: null, type: null }, { value: null, type: null }, { value: null, type: null }],
        others: [null, null, null, null], weight: 0, cost: 0,
      })}</div>
    </section>`;
  }

function loadPanel(model, e) {
    const c = model.data;
    const sum = (arr, key = 'weight') => (arr || []).reduce((t, x) => t + (Number(x[key]) || 0), 0);
    return `<section class="panel">
      <h3>Load &amp; value</h3>
      ${line('Slotted gear', `${sum(e.gear)} lbs`)}
      ${line('Other items', `${sum(e.other)} lbs`)}
      ${line('Armor & shields', `${(Number(e.armor?.weight) || 0) + sum(e.shields)} lbs`)}
      ${line('Weapons', `${sum(e.weapons)} lbs`)}
      ${editLine('Adjustment', 'carry.carriedOffset', c.carry?.carriedOffset ?? 0)}
      <div class="statline"><span class="label">Total carried</span>
        <span class="value big">${c.carry?.carried ?? 0} lbs</span></div>
      ${line('Light load', `≤ ${c.carry?.light ?? 0} lbs`)}
      ${(c.carry?.carried ?? 0) > (c.carry?.light ?? 0)
    ? `<p class="hint warn">Over light load (${c.carry?.carried} > ${c.carry?.light}).</p>` : ''}
      ${line('Total value', `${e.totalValue ?? 0} gp`)}
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
export function renderCraftingPanel(model, ctx) {
    const cr = model.data.crafting;
    if (!cr) return '<div class="grid"><p class="empty">No crafting data.</p></div>';
    return `<div class="grid crafting">
      ${craftSummaryPanel(cr)}
      ${craftSpeedPanel(cr)}
      ${craftCostPanel(cr)}
      ${craftCrafterPanel(model, cr)}
      ${craftProjectsPanel(ctx, model, cr)}
      ${craftExtrasPanel(cr)}
    </div>`;
  }

function craftSummaryPanel(cr) {
    const k = cr.calc || {};
    const mode = { take10: 'take 10', take20: 'take 20', manual: `rolled ${k.roll ?? 0}` }[cr.checkMode] || 'take 10';
    return `<section class="panel span2">
      <h3>Crafting ${k.errors?.length ? `<span class="badge err">${k.errors.length} formula problem(s)</span>` : ''}</h3>
      <div class="bigstats">
        ${bigStat('Progress / day', group(k.speedPerDay), `${esc(cr.currency || '')} of base price`)}
        ${bigStat('Base cost', pct(k.baseFraction), 'of base price')}
        ${bigStat('Reductions', `×${round(k.compounding, 4)}`, `${(cr.costReductions || []).filter((r) => r.enabled !== false).length} applied`)}
        ${bigStat('You pay', pct(k.ratio), 'value : craft ratio')}
        ${bigStat('Craft check', fmt(k.checkBase), `${esc(mode)}${k.skill ? ` · ${esc(k.skill)}` : ''}`)}
      </div>
      ${k.errors?.length ? `<p class="hint warn" style="margin-top:8px">${k.errors.map(esc).join(' · ')}</p>` : ''}
    </section>`;
  }

  /** Progress per day: a base rate plus the increases the crafter has earned. */
function craftSpeedPanel(cr) {
    const list = 'crafting.speedIncreases';
    const rows = cr.speedIncreases || [];
    return `<section class="panel">
      <h3>Crafting speed</h3>
      ${field('Base progress / day', num('crafting.baseSpeed', cr.baseSpeed, 'style="width:6rem"'))}
      <div class="tablewrap"><table class="craftlist">
        <thead><tr><th>On</th><th>Increase</th><th>Kind</th><th>Amount</th><th></th></tr></thead>
        <tbody>${rows.map((s, i) => `<tr>
          <td class="mid">${itemCheck(list, i, 'enabled', s.enabled !== false)}</td>
          <td>${itemText(list, i, 'label', s.label, 'Rush, workshop…')}</td>
          <td class="narrow">${itemSelect(list, i, 'kind', s.kind || 'flat', CRAFT_SPEED_KINDS, null)}</td>
          <td class="narrow">${itemExpr(list, i, 'value', s, { width: '4.2rem' })}</td>
          ${rowRemove(list, i)}
        </tr>`).join('') || '<tr><td colspan="5"><span class="empty">No increases yet.</span></td></tr>'}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton(list, 'Add speed increase', {
        label: '', kind: 'multiplier', value: CRAFT_SPEED_MULTIPLIER, enabled: true,
      })}</div>
      ${line('Progress / day', group(cr.calc?.speedPerDay))}
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
function craftCostPanel(cr) {
    const list = 'crafting.costReductions';
    const rows = cr.costReductions || [];
    const presets = cr.baseCosts || [];
    return `<section class="panel">
      <h3>Crafting cost</h3>
      ${field('Base crafting cost', select('crafting.baseCostIndex',
    String(cr.baseCostIndex ?? 0), presets.map((b, i) => [String(i), `${b.label} — ${b.percent}%`]), null))}
      <details style="margin:6px 0">
        <summary class="hint" style="cursor:pointer">Edit base costs (${presets.length})</summary>
        <div class="tablewrap" style="margin-top:6px"><table class="craftlist">
          <thead><tr><th>Name</th><th>%</th><th></th></tr></thead>
          <tbody>${presets.map((b, i) => `<tr>
            <td>${itemText('crafting.baseCosts', i, 'label', b.label, 'Name')}</td>
            <td class="narrow"><input type="number" value="${Number(b.percent) || 0}"
              data-item="crafting.baseCosts|${i}|percent" data-kind="number" style="width:4.2rem"></td>
            ${rowRemove('crafting.baseCosts', i)}
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:6px">${addButton('crafting.baseCosts', 'Add base cost', { label: '', percent: 50 })}</div>
        <p class="hint">50, 33 and 25 mean a true half, third and quarter of market value, as the sheet's own dropdown did.</p>
      </details>
      <div class="subhead">Manufacturing cost reductions</div>
      <div class="tablewrap"><table class="craftlist">
        <thead><tr><th>On</th><th>Reduction</th><th>%</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td class="mid">${itemCheck(list, i, 'enabled', r.enabled !== false)}</td>
          <td>${itemText(list, i, 'label', r.label, 'Hands of the Crafter…')}</td>
          <td class="narrow">${itemExpr(list, i, 'value', r, { width: '4.2rem' })}</td>
          ${rowRemove(list, i)}
        </tr>`).join('') || '<tr><td colspan="4"><span class="empty">No reductions yet.</span></td></tr>'}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton(list, 'Add cost reduction', { label: '', value: 10, enabled: true })}</div>
      ${line('Compounding reduction', `×${round(cr.calc?.compounding, 4)}`)}
      ${line('Final value : craft ratio', pct(cr.calc?.ratio))}
      <p class="hint">
        Reductions compound rather than add: 10% and 20% leave
        0.9 × 0.8 = 72% of the price, not 70%.
      </p>
    </section>`;
  }

  /** The crafter: their check, their discount, and how they sign a post. */
function craftCrafterPanel(model, cr) {
    const skills = model.craftSkills();
    const k = cr.calc || {};
    return `<section class="panel">
      <h3>The crafter</h3>
      <div class="fieldgrid">
        ${field('Craft skill', select('crafting.checkSkill', cr.checkSkill ?? k.skill,
    skills.map((s) => [s.key, `${s.label} ${fmt(s.bonus)}`]), 'None'))}
        ${field('Check', select('crafting.checkMode', cr.checkMode || 'take10', CRAFT_CHECK_MODES, null))}
        ${cr.checkMode === 'manual' ? field('Roll', num('crafting.checkRoll', cr.checkRoll)) : ''}
        ${field('Misc bonus', num('crafting.checkMisc', cr.checkMisc))}
      </div>
      ${line('Crafting check', `${fmt(k.checkBase)}`)}
      <div class="fieldgrid" style="margin-top:9px">
        ${field('Standing discount %', num('crafting.discount', cr.discount))}
        ${field('DC per bypassed req.', num('crafting.dcPerBypass', cr.dcPerBypass))}
        ${field('Days count against', select('crafting.timeBasis', cr.timeBasis || 'value', CRAFT_TIME_BASES, null))}
        ${field('Currency', text('crafting.currency', cr.currency, 'mana'))}
      </div>
      ${field('Name on the marketplace post', text('crafting.sellerName', cr.sellerName, 'Character name'))}
      <p class="hint">
        The discount is what buyers pay off market value — 100% sells at cost.
        A project can override it.
      </p>
    </section>`;
  }

function craftProjectsPanel(ctx, model, cr) {
    const projects = cr.projects || [];
    return `<section class="panel span2">
      <h3>Projects <span class="badge">${projects.length}</span></h3>
      ${projects.map((p, i) => craftProject(ctx, model, cr, p, i)).join('')
      || '<p class="empty">No projects yet.</p>'}
      <div style="margin-top:8px">${addButton('crafting.projects', 'Add project', {
      name: '', value: 0, discountOverride: null, zeroProfit: false, itemDC: 0, checkMod: 0,
      dcAdjustments: [], bypassed: [], dcNotes: '', resources: '', notes: '',
      buyerName: '', buyerTag: '', remaining: '',
    })}</div>
    </section>`;
  }

  /** One crafting project: its price, its DC, and the two posts it generates. */
function craftProject(ctx, model, cr, p, i) {
    const list = 'crafting.projects';
    const base = `crafting.projects.${i}`;
    const k = p.calc || {};
    const unit = cr.currency ? ` ${cr.currency}` : '';
    return `<div class="craft">
      <div class="crafthead">
        ${itemText(list, i, 'name', p.name, 'Item name')}
        <span class="bigroll" title="Crafting cost">${group(k.cost)}</span>
        <span class="bigroll dmg" title="Profit at the final sale price">${fmt(k.net)}</span>
        <button class="danger" data-remove="${list}|${i}" aria-label="Remove project">×</button>
      </div>
      <div class="weapongrid">
        ${field('Base price', itemExpr(list, i, 'value', p, { width: '7rem' }))}
        ${field('Discount %', `<input type="number" value="${p.discountOverride ?? ''}"
          data-item="${list}|${i}|discountOverride" data-kind="number-or-null" style="width:4.4rem"
          placeholder="${Number(cr.discount) || 0}" title="Blank uses the crafter's standing discount">`)}
        ${field('Zero profit', `<span class="pair">${itemCheck(list, i, 'zeroProfit', p.zeroProfit)}
          <span class="hint">sell at cost</span></span>`)}
        <span class="wsep"></span>
        ${field('Item DC', itemExpr(list, i, 'itemDC', p, { width: '4.4rem' }))}
        ${field('Check mod', itemNum(list, i, 'checkMod', p.checkMod))}
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
              <td class="mid">${itemCheck(`${base}.dcAdjustments`, j, 'enabled', a.enabled !== false)}</td>
              <td>${itemText(`${base}.dcAdjustments`, j, 'label', a.label, 'Rush, exotic material…')}</td>
              <td class="narrow">${itemExpr(`${base}.dcAdjustments`, j, 'value', a, { width: '4rem' })}</td>
              ${rowRemove(`${base}.dcAdjustments`, j)}
            </tr>`).join('') || '<tr><td colspan="4"><span class="empty">Base DC only.</span></td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:6px">${addButton(`${base}.dcAdjustments`, 'Add DC note', { label: '', value: 5, enabled: true })}</div>
        </div>
        <div>
          <div class="subhead">Bypassed requirements <span class="hint">${fmt(cr.dcPerBypass)} DC each</span></div>
          <div class="tablewrap"><table class="craftlist">
            <thead><tr><th>On</th><th>Requirement</th><th></th></tr></thead>
            <tbody>${(p.bypassed || []).map((b, j) => `<tr>
              <td class="mid">${itemCheck(`${base}.bypassed`, j, 'enabled', b.enabled !== false)}</td>
              <td>${itemText(`${base}.bypassed`, j, 'label', b.label, 'Craft Wondrous Item…')}</td>
              ${rowRemove(`${base}.bypassed`, j)}
            </tr>`).join('') || '<tr><td colspan="3"><span class="empty">None bypassed.</span></td></tr>'}</tbody>
          </table></div>
          <div style="margin-top:6px">${addButton(`${base}.bypassed`, 'Add bypassed requirement', { label: '', enabled: true })}</div>
        </div>
      </div>
      <div class="fieldgrid two" style="margin-top:9px">
        <label class="fld"><span>Resources used</span>${itemArea(model, list, i, 'resources', p.resources, 2)}</label>
        <label class="fld"><span>Notes / description</span>${itemArea(model, list, i, 'notes', p.notes, 2)}</label>
      </div>
      <div class="fieldgrid" style="margin-top:6px">
        ${field('Free-text DC note', itemText(list, i, 'dcNotes', p.dcNotes, 'Anything the notes above miss'))}
        ${field('Buyer (character)', itemText(list, i, 'buyerName', p.buyerName))}
        ${field('Buyer (Player#0000)', itemText(list, i, 'buyerTag', p.buyerTag))}
        ${field(`${cr.currency || 'Gold'} remaining`, itemText(list, i, 'remaining', p.remaining))}
      </div>
      ${craftPost(ctx, `craft-${i}`, 'Crafting post', k.craftPost, 9)}
      ${craftPost(ctx, `market-${i}`, 'Marketplace post', k.marketPost, 6)}
    </div>`;
  }

  /**
   * A generated Discord post: read-only, with a copy button.
   *
   * Editing any crafting field rebuilds the panel, so whether a post was open
   * is remembered on the element -- it is where the player is looking while
   * they tune the numbers, and it must not fold shut under them.
   */
function craftPost(ctx, id, label, text, rows) {
    const open = ctx.openPosts.has(id) ? ctx.openPosts.get(id) : id.startsWith('craft-');
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
function craftExtrasPanel(cr) {
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
          ${Array.from({ length: width }, (_, ci) => `<td>${itemText(list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }

/* ----- wealth: what the character owns and what it came to ----- */

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
export function wealthPanel(model, ctx) {
    const v = model.wealthView();
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    const draft = { amount: ctx.draft.wealthAmount ?? '', label: ctx.draft.wealthLabel ?? '', kind: ctx.draft.wealthKind || 'session' };
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
            ${field('Current mana', num('wealth.current', v.current))}
            ${field('Mana / day', num('wealth.manaPerDay', v.manaPerDay))}
            <label class="fld"><span>Oath of Offerings</span>${check('wealth.oathOfOfferings', v.oathOfOfferings, '', oathRule)}</label>
            <label class="fld"><span>Material Casting</span>${check('wealth.materialCasting', v.materialCasting, '', castingRule)}</label>
          </div>
          <div class="offeringfields${v.due ? '' : ' dormant'}"${v.due ? ''
    : ' title="Only the Oath of Offerings and material casting are paid this way — tick one to fill these in."'}>
            <div class="fieldgrid wealthfields">
              ${field('Baseline after last offering', `<input type="number" value="${v.baseline === null ? '' : v.baseline}" data-set="wealth.baseline" data-kind="number-or-null" placeholder="—" title="The balance recorded after the last offering"${off}>`)}
              ${field('OoO / day', roField(n(v.offeringPerDay), 'Mana/Day ÷ 2'))}
              ${field('Last offering', `<input type="date" value="${esc(v.lastOffering)}" data-set="wealth.lastOffering" data-kind="text"${off}>`)}
              ${field('Session mana since', num('wealth.sessionMana', v.sessionMana, `min="0" title="Mana earned in sessions since the last offering; the oath takes half"${off}`))}
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
