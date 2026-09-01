/**
 * ui/panels/combat.js -- Spheres of Power and Might, and the templates.
 *
 * The Martial Spheres and Magic Spheres tabs: what each class trains in, the
 * talents it takes per level, the traditions and their drawbacks, the
 * sphere-specific skill ranks, and the unarmed damage that falls out of a
 * practitioner's progression. One module for both because they are one
 * subsystem drawn twice -- the same builders, a side key apart -- and because
 * a class that trains both ways heads either tab. The Templates tab is here
 * too -- a race or template's features and their tables, which is the same
 * shape of data even though it is not combat.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, val } from '../html.js';
import { collapsible } from '../rows.js';
import { itemArea, prose } from '../prose.js';
import { forwardedBadge } from '../badges.js';
import { talentCell } from '../talents.js';
import { rollButton } from '../roll.js';

/** What a template feature's type means, on the dropdown that sets it. */
const TEMPLATE_TYPE_HINTS = {
  Ex: 'Extraordinary — not magical, works in an antimagic field',
  Su: 'Supernatural — magical, but no spell resistance or concentration',
  Sp: 'Spell-like — as a spell, subject to spell resistance',
};

/** A table starts as two named columns and a row, which is enough to type into. */
const NEW_TEMPLATE_TABLE = () => ({
  caption: '', columns: ['', ''], rows: [{ cells: [null, null] }],
});
import { TEMPLATE_TYPES, classForwardKey, sphereForwardKey, sphereNames } from '../../model.js';
import {
  ABILITIES, ABILITY_LABELS, BLENDED_SPHERES,
  CASTING_TYPES, COMBAT_SPHERES, MAGIC_SPHERES, PRACTITIONER_TYPES,
  SP_PER_TEMP_ESSENCE, TALENT_RATES, TRACK_SPHERE_LABELS,
  TRACK_SPHERE_NOUNS, TRACK_SPHERE_SIDES, fmt, isBasePick, mergeLayout,
  sphereSide, trackSpheres,
} from '../../rules.js';
import { check, field, roField, select, text } from '../fields.js';
import {
  addButton, editLine, exprField, itemCheck, itemSelect, itemText, line, lineHtml,
  rowRemove, rowTools,
} from '../rows.js';

  /**
   * Each side reads top to bottom as one story: the classes and what they
   * learned, the talents that came from elsewhere, then the numbers that fall
   * out of both. The first two are full width because their tables are; the
   * rest share a row of their own, which is why they sit in a `.sidepanels`
   * strip rather than in the page grid. In the page grid a side with three
   * panels left the fourth column of the shared four empty, and a side with
   * four squeezed all of them into a quarter each.
   *
   * The two sides were one tab and are now two, because they are two
   * subsystems and most characters play only one of them: a caster should not
   * have to scroll past an empty set of martial tables to reach her spheres.
   * What they still share is the blended classes, which belong to neither and
   * so head both.
   */
/**
 * Whether a training side is a side at all.
 *
 * Every character now carries a `training.combat` because the unarmed block
 * is conjured into one (see document.js) -- a monk with a class progression
 * and no talents needs somewhere to put their dice. That bare holder is not a
 * martial side, and drawing this tab for it would be four empty grids, so the
 * question asked here is the one the ⚙ manager's badges already ask: does it
 * name a class, a tradition or a talent?
 */
const martialSideInUse = (side) => !!side && !!(
  (side.classes || []).length
  || (side.bonusTalents || []).length
  || (side.customizations || []).length
  || side.tradition
  || side.sphereBonuses
  || side.skillRanks
  || side.sheetBaseDC != null
);

export function renderMartialPanel(model) {
    const t = model.data.training || {};
    const side = martialSideInUse(t.combat) ? t.combat : null;
    const wrap = (key, html) => collapsible(model, key, html);
    // The full-width groups sit in a strip: folded, they shrink to their
    // headers and pile up in a row of pills instead of holding a row apiece
    // open. See `.foldstrip`. Built first and wrapped only if it holds
    // anything -- a caster with no martial side has none of these, and an
    // empty strip would still spend the grid's gap on itself.
    const groups = [
      blendedSection(model, wrap),
      side ? wrap('combat-training', trainingSide(model, 'combat', side)) : '',
      side && (side.customizations || []).length
        ? wrap('customized-weapons', customizationPanel(model, side.customizations)) : '',
      side ? wrap('combat-bonus', bonusTalentPanel(model, 'combat', side)) : '',
    ].filter(Boolean).join('');
    return `<div class="grid">
      ${groups ? `<div class="foldstrip">${groups}</div>` : ''}
      ${side ? `
        <div class="sidepanels">
          ${wrap('combat-tradition', combatTraditionPanel(model, side))}
          ${wrap('sphere-skills', sphereSkillPanel(model))}
          ${wrap('combat-spheres', sphereBonusPanel(model, 'combat', side))}
        </div>` : ''}
    </div>`;
  }

export function renderMagicPanel(model) {
    const t = model.data.training || {};
    const wrap = (key, html) => collapsible(model, key, html);
    const groups = [
      blendedSection(model, wrap),
      t.magic ? wrap('magic-training', trainingSide(model, 'magic', t.magic)) : '',
      t.magic ? wrap('magic-bonus', bonusTalentPanel(model, 'magic', t.magic)) : '',
    ].filter(Boolean).join('');
    return `<div class="grid">
      ${groups ? `<div class="foldstrip">${groups}</div>` : ''}
      ${t.magic ? `
        <div class="sidepanels">
          ${wrap('magic-tradition', magicTraditionPanel(model, t.magic))}
          ${wrap('magic-globals', magicGlobalsPanel(model, t.magic))}
          ${wrap('magic-spheres', sphereBonusPanel(model, 'magic', t.magic))}
        </div>` : ''}
    </div>`;
  }

  /**
   * The blended classes, at the head of both sphere tabs.
   *
   * One group, drawn twice: the same fold key, so it opens and shuts on both
   * at once, and the same `data-item` paths, so a talent typed in on the
   * martial tab is the one the magic tab is showing. Neither tab holds a copy
   * -- both are looking at the same rows of the same class.
   */
function blendedSection(model, wrap) {
    const blended = model.blendedClasses();
    return blended.length ? wrap('blended-training', blendedPanel(model, blended)) : '';
  }

  /**
   * Wrap a panel so its body can be minimized. The collapsed state lives in
   * uiPrefs and persists with the character.
   */
  /* ----- training class blocks with per-level talent slots ----- */


export function classNames(model) {
    const names = new Set(model.data.classes.map((x) => x.name).filter(Boolean));
    for (const side of Object.values(model.data.training || {})) {
      for (const cls of side?.classes || []) if (cls.name) names.add(cls.name);
    }
    return [...names];
  }


function trainingSide(model, sideKey, side) {
    const isMagic = sideKey === 'magic';
    const title = isMagic ? 'Magic training' : 'Combat training';
    const spheres = sphereNames(isMagic ? MAGIC_SPHERES : COMBAT_SPHERES, isMagic ? 'magic' : 'combat');
    const types = isMagic ? CASTING_TYPES : PRACTITIONER_TYPES;
    const tplOptions = Object.keys(TALENT_RATES);
    const list = `training.${sideKey}.classes`;
    // A blended class trains both ways off one pool of talents; it has a group
    // of its own above, and appears here only as the note that says so.
    const classes = (side.classes || []).filter((x) => !x.extended && !x.blended);
    const extended = (side.classes || []).filter((x) => x.extended && !x.blended);
    const blended = (side.classes || []).filter((x) => x.blended);

    return `<section class="panel span2">
      <h3>${title}</h3>
      ${classes.map((cls, rawIndex) => {
        const ci = (side.classes || []).indexOf(cls);
        return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld"><span>Class</span>
            ${itemSelect(list, ci, 'name', cls.name, classNames(model))}</label>
          <label class="fld"><span>${isMagic ? 'Casting type' : 'Practitioner type'}</span>
            ${itemSelect(list, ci, 'type', cls.type, types)}</label>
          <label class="fld"><span>Talents / level</span>
            ${itemSelect(list, ci, 'talentsPerLevel', cls.talentsPerLevel, tplOptions)}</label>
          <label class="fld"><span>${isMagic ? 'Casting score' : 'Practitioner mod'}</span>
            ${itemSelect(list, ci, 'mod1', cls.mod1, ABILITIES.map((k) => ABILITY_LABELS[k]))}</label>
          <label class="fld"><span>2nd score</span>
            ${itemSelect(list, ci, 'mod2', cls.mod2, ABILITIES.map((k) => ABILITY_LABELS[k]))}</label>
          <label class="fld"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              <input type="number" value="${cls.classLevelsOverride ?? ''}" placeholder="${cls.classLevels ?? 0}"
                data-item="${list}|${ci}|classLevelsOverride" data-kind="number-or-null" style="width:3.6rem">
              ${forwardedBadge(model, classForwardKey(cls.name))}
              <span class="hint">talents: ${cls.totalTalents ?? 0}</span>
            </span></label>
          <label class="fld"><span>Blended</span>
            <label class="chk" title="This class learns ${isMagic ? 'martial' : 'magical'} talents from the same pool — give it a group of its own that draws on both sphere lists.">
              <input type="checkbox" data-blend="${sideKey}|${ci}">
              <span class="hint">also ${isMagic ? 'martial' : 'magical'}</span></label></label>
          <button class="danger" data-remove="${list}|${ci}" title="Remove class">×</button>
        </div>
        <div class="tablewrap"><table class="talents stacked">
          <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes"></colgroup>
          <thead><tr><th class="num">Lvl</th><th>Talent</th><th>Sphere</th><th>Notes</th></tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
            const on = !!lv.granted;
            const slots = `${list}.${ci}.levels`;
            const state = on ? 'slot-on' : 'slot-off';
            // The running talent count used to be a column of its own; it says
            // the same thing as a tooltip on the level it belongs to.
            const count = on ? `Talent #${Math.floor(lv.count)} at level ${lv.level}`
              : `Level ${lv.level} grants no talent`;
            return `<tr class="${lv.future ? 'future' : ''}${on ? '' : ' emptyslot'}">
              <td class="num" data-stack="head" data-headlabel="Level" title="${esc(count)}">${lv.level}</td>
              <td class="${state}" data-stack="name">${talentCell(model,
    `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, lv.sphere,
    on ? { sphere: 'sphere', notes: 'notes' } : null)}</td>
              <td class="${state}" data-label="Sphere">
                ${on ? itemSelect(slots, li, 'sphere', lv.sphere, spheres)
                  : '<select disabled><option></option></select>'}
              </td>
              <td class="${state}" data-label="Notes">${prose(model,
    `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, 1, 'grow')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
      }).join('')}
      ${extended.length ? `<p class="hint">Also counted as ${isMagic ? 'casting' : 'practitioner'} classes:
        ${extended.map((x) => esc(x.name)).join(', ')} (extended-level page).</p>` : ''}
      ${blended.length ? `<p class="hint">Also counted as ${isMagic ? 'casting' : 'practitioner'} classes:
        ${blended.map((x) => esc(x.name)).join(', ')} — blended, so their talents are
        listed once under <strong>Blended training</strong> and counted here by sphere.</p>` : ''}
      <div style="margin-top:8px">
        <button class="primary" data-action="add-training-class" data-side="${sideKey}">+ Add class</button>
        ${isMagic ? '' : `<button data-action="add-customization"
          title="For a class whose talents arrive on several tracks at once, one of them live — an armiger's customized weapons">+ Customized weapons</button>`}
      </div>
      <p class="hint">
        A level's talent fields unlock when that level grants a talent — from the class's
        levels in the Planner and the Talents/level rate (Type drives ${isMagic ? 'caster level' : 'practitioner level'}
        separately, for classes where the two differ). Set Class levels to override a sparse Planner.
      </p>
    </section>`;
  }

  /**
   * Customized weapons: several talent tracks side by side, one of them drawn.
   *
   * Laid out across rather than down because choosing between them is the
   * whole point of the feature -- an armiger picks up the naginata *instead
   * of* the handwraps -- and because it is how the workbook wrote it, two
   * columns of a spare tab headed Weapon.
   *
   * The two counting rules sit in the head as the class table words them, so
   * what the sheet is doing is on the page: three weapons, another at 11th and
   * 19th; one talent each, another at 3rd and every 4 levels after.
   */
function customizationPanel(model, blocks) {
    return `<section class="panel span2">
      <h3>Customized weapons <span class="badge">${blocks.length}</span></h3>
      ${blocks.map((block, bi) => {
    const list = `training.combat.customizations.${bi}.sets`;
    const rule = (key, label) => `<label class="fld"><span>${label}</span>
        <span class="pair">
          <input type="number" min="0" value="${block.spec?.[key]?.start ?? 1}" style="width:3.2rem"
            data-custrule="${bi}|${key}|start" aria-label="${label} to begin with">
          <span class="hint">then at</span>
          <input type="text" value="${esc(block.spec?.[key]?.gainsAt ?? '')}" style="width:6.5rem"
            data-custrule="${bi}|${key}|gainsAt" placeholder="11, 19"
            aria-label="Levels ${label.toLowerCase()} goes up at">
        </span></label>`;
    // What one track is called, so a class that customizes something other
    // than weapons reads as itself: the pack's `unit` names the rows and the
    // count beside them.
    const unit = block.spec?.unit || 'weapon';
    const Unit = unit.charAt(0).toUpperCase() + unit.slice(1);
    // Which sphere lists this track learns from. Martial by default -- a
    // customized weapon teaches its wielder to fight with it -- and widened by
    // the archetype that says so, which is why it is a field here and not a
    // rule in the engine.
    const spheres = sphereNames(trackSpheres(block.spec),
      block.spec?.spheres === 'both' ? null : block.spec?.spheres || 'combat');
    return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld"><span>Class</span>
            ${itemSelect('training.combat.customizations', bi, 'className', block.className, classNames(model))}</label>
          ${rule('sets', `${Unit}s`)}
          ${rule('talents', 'Talents each')}
          <label class="fld"><span>Spheres</span>
            <select data-custspheres="${bi}"
              title="What a ${esc(unit)} may teach. Martial unless an archetype widens it.">
              ${TRACK_SPHERE_SIDES.map((k) => `<option value="${k}"${
    (block.spec?.spheres || 'combat') === k ? ' selected' : ''}>${esc(TRACK_SPHERE_LABELS[k])}</option>`).join('')}
            </select></label>
          <label class="fld"><span>Grants</span>
            <span class="pair">${roField(`${block.setCount} × ${block.talentCount}`,
    `${block.className || 'This class'} ${block.classLevels}: ${block.setCount} customized weapon(s), `
    + `${block.talentCount} talent(s) on each`, 'style="width:4.2rem"')}
              <span class="hint">at level ${block.classLevels}</span></span></label>
          <button class="danger" data-remove-customization="${bi}" title="Remove these ${esc(unit)}s">×</button>
        </div>
        ${block.spec?.text ? `<p class="hint">${esc(block.spec.text)}</p>` : ''}
        <div class="weaponsets">
          ${(block.sets || []).map((set, si) => weaponSet(model, block, bi, si, set, list, spheres, Unit)).join('')}
        </div>
      </div>`;
  }).join('')}
      <div style="margin-top:8px">
        <button class="primary" data-action="add-customization">+ Add customized weapons</button>
      </div>
      <p class="hint">
        Only the drawn weapon's talents are live: they reach the sphere tables and the
        sphere badges, and change the moment you draw something else. They never pay
        bonus skill ranks and never answer a prerequisite — a customized weapon grants
        no skill retraining, and its talents may not qualify for feats. Constant
        benefits stay put: unarmed damage counts every weapon's talents, drawn or
        stowed. A talent needs its sphere's base on the same weapon, unless the
        character has that sphere in her own right. Which spheres a weapon may teach at
        all is the <strong>Spheres</strong> setting above: martial, unless an archetype
        widens it. One outside that list is marked in gold rather than thrown away,
        since it is nearly always an archetype nobody has added yet.
      </p>
    </section>`;
  }

  /** One weapon: what it is, what it teaches, and whether it is in hand. */
function weaponSet(model, block, bi, si, set, list, spheres, Unit = 'Weapon') {
    const rows = set.talents || [];
    const talents = `${list}.${si}.talents`;
    const live = !set.spare && si === block.active;
    return `<div class="weaponset${live ? ' drawn' : ''}${set.spare ? ' spare' : ''}">
      <div class="weaponhead">
        <label class="chk" title="${set.spare ? 'Past what this level customizes' : `Draw this ${esc(Unit.toLowerCase())} — its talents go live and the others stop`}">
          <input type="radio" name="cust-${bi}" data-custactive="${bi}|${si}"
            ${live ? 'checked' : ''}${set.spare ? ' disabled' : ''}>
          <span>${live ? 'Drawn' : set.spare ? 'Spare' : 'Stowed'}</span></label>
        ${itemText(list, si, 'weapon', set.weapon, `${Unit} ${si + 1}`, true)}
      </div>
      <table class="talents">
        <colgroup><col class="talent"><col class="sphere"></colgroup>
        <tbody>${rows.map((row, ri) => {
    const on = row.granted !== false;
    const state = on ? 'slot-on' : 'slot-off';
    const side = on && row.sphere ? sphereSide(row.sphere, 'combat') : null;
    const bonus = on && ri >= block.talentCount;
    return `<tr>
          <td class="${state}${row.needsBase ? ' needsbase' : ''}"${row.needsBase
      ? ` title="${esc(`No ${row.sphere} base on this weapon, and the character has none of her own — a customized weapon must possess a base sphere before talents of it.`)}"`
      : bonus ? ' title="The extra talent this weapon\'s drawback bought"' : ''}>
            ${talentCell(model, `data-item="${talents}|${ri}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, row.talent, row.sphere,
    on ? { sphere: 'sphere' } : null)}</td>
          <td class="${state}${side ? ` side-${side}` : ''}${row.offList ? ' offlist' : ''}"${row.offList
      ? ` title="${esc(`${row.sphere} is not one this ${Unit.toLowerCase()} may learn — it teaches `
        + `${TRACK_SPHERE_NOUNS[block.spec?.spheres || 'combat']} spheres. `
        + 'Widen it above, or add the archetype that does.')}"` : ''}>
            ${on ? itemSelect(talents, ri, 'sphere', row.sphere, spheres)
      : '<select disabled><option></option></select>'}</td>
        </tr>`;
  }).join('')}</tbody>
      </table>
      <div class="listrow weapondrawback">
        ${itemText(list, si, 'drawback', set.drawback, 'Drawback…', true)}
        <label class="chk" title="Bought off — which costs the talent it bought">
          ${itemCheck(list, si, 'boughtOff', set.boughtOff)}<span>off</span></label>
      </div>
    </div>`;
  }

  /**
   * Classes that train both ways: one pool of talents, two progressions.
   *
   * The workbook keeps such a class as a block on each tab holding the same
   * talents twice, which read as two classes that had each learned everything.
   * Here it is one group. The pool is sized by the practitioner-side talent
   * rate that owns it, each level picks from both sphere lists, and where each
   * talent lands -- the martial tables or the magical ones -- follows the
   * sphere rather than which tab the block came off.
   */
function blendedPanel(model, pairs) {
    const tplOptions = Object.keys(TALENT_RATES);
    const abilities = ABILITIES.map((k) => ABILITY_LABELS[k]);
    const head = (half, label, types) => {
      if (!half) return `<label class="fld"><span>${label} type</span><select disabled><option>—</option></select></label>`;
      const list = `training.${half.side}.classes`;
      return `<label class="fld"><span>${label} type</span>
          ${itemSelect(list, half.index, 'type', half.cls.type, types)}</label>
        <label class="fld"><span>${label === 'Casting' ? 'Casting score' : 'Practitioner mod'}</span>
          ${itemSelect(list, half.index, 'mod1', half.cls.mod1, abilities)}</label>`;
    };

    return `<section class="panel span2">
      <h3>Blended training <span class="badge">${pairs.length}</span></h3>
      ${pairs.map(({ name, owner, twin }) => {
    const list = `training.${owner.side}.classes`;
    const cls = owner.cls;
    const martial = owner.side === 'combat' ? owner : twin;
    const casting = owner.side === 'magic' ? owner : twin;
    const counts = blendedCounts(cls);
    return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld"><span>Class</span>
            ${itemSelect(list, owner.index, 'name', cls.name, classNames(model))}</label>
          <label class="fld"><span>Talents / level</span>
            ${itemSelect(list, owner.index, 'talentsPerLevel', cls.talentsPerLevel, tplOptions)}</label>
          ${head(martial, 'Practitioner', PRACTITIONER_TYPES)}
          ${head(casting, 'Casting', CASTING_TYPES)}
          <label class="fld"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              <input type="number" value="${cls.classLevelsOverride ?? ''}" placeholder="${cls.classLevels ?? 0}"
                data-item="${list}|${owner.index}|classLevelsOverride" data-kind="number-or-null" style="width:3.6rem">
              ${forwardedBadge(model, classForwardKey(cls.name))}
              <span class="hint">talents: ${cls.totalTalents ?? 0}</span>
            </span></label>
          <label class="fld"><span>Blended</span>
            <label class="chk" title="Untick to split this back into separate combat and magic classes.">
              <input type="checkbox" checked data-blend="${owner.side}|${owner.index}">
              <span class="hint">${counts.combat} martial · ${counts.magic} magical</span></label></label>
        </div>
        <div class="tablewrap"><table class="talents stacked">
          <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes"></colgroup>
          <thead><tr><th class="num">Lvl</th><th>Talent</th><th>Sphere</th><th>Notes</th></tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
      const on = !!lv.granted;
      const slots = `${list}.${owner.index}.levels`;
      const state = on ? 'slot-on' : 'slot-off';
      const side = on ? sphereSide(lv.sphere) : null;
      const count = on ? `Talent #${Math.floor(lv.count)} at level ${lv.level}${
        side ? ` — counts as ${side === 'magic' ? 'magical' : 'martial'}` : ''}`
        : `Level ${lv.level} grants no talent`;
      return `<tr class="${lv.future ? 'future' : ''}${on ? '' : ' emptyslot'}">
              <td class="num" data-stack="head" data-headlabel="Level" title="${esc(count)}">${lv.level}</td>
              <td class="${state}" data-stack="name">${talentCell(model,
        `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, lv.sphere,
        on ? { sphere: 'sphere', notes: 'notes' } : null)}</td>
              <td class="${state}${side ? ` side-${side}` : ''}" data-label="Sphere">
                ${on ? itemSelect(slots, li, 'sphere', lv.sphere, BLENDED_SPHERES)
        : '<select disabled><option></option></select>'}
              </td>
              <td class="${state}" data-label="Notes">${prose(model,
        `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, 1, 'grow')}</td>
            </tr>`;
    }).join('')}</tbody>
        </table></div>
      </div>`;
  }).join('')}
      <p class="hint">
        One pool of talents, spent either way: the sphere on each row decides whether the
        talent counts toward Sphere BAB / DC or Sphere CL / DC. Each side keeps its own
        type and ability score above, because a blended class rarely advances at the same
        rate as both. This group heads <strong>Martial Spheres</strong> and
        <strong>Magic Spheres</strong> alike, and is the same on either: what you type
        on one tab is what the other is showing.
      </p>
    </section>`;
  }

  /** How a blended class's talents so far divide between the two sides. */
function blendedCounts(cls) {
    const counts = { combat: 0, magic: 0 };
    for (const lv of cls.levels || []) {
      if (!lv.granted || lv.future) continue;
      const side = sphereSide(lv.sphere);
      if (side) counts[side] += 1;
    }
    return counts;
  }

  /* ----- traditions ----- */


function combatTraditionPanel(model, t) {
    const list = 'training.combat.tradition.entries';
    return `<section class="panel wide">
      <h3>Martial tradition</h3>
      <label class="fld"><span>Tradition</span>
        ${text('training.combat.tradition.name', t.tradition?.name)}</label>
      <div class="tablewrap" style="margin-top:6px"><table class="talents stacked">
        <colgroup><col class="talent"><col class="sphere"><col class="tool"></colgroup>
        <thead><tr><th>Grants</th><th>Sphere</th><th></th></tr></thead>
        <tbody>${(t.tradition?.entries || []).map((e, i) => `<tr>
          <td data-stack="name">${talentCell(model, `data-item="${list}|${i}|talent"`, e.talent, e.sphere,
    { sphere: 'sphere' })}</td>
          <td data-label="Sphere">${itemSelect(list, i, 'sphere', e.sphere, sphereNames(COMBAT_SPHERES, 'combat'))}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:6px">${addButton(list, 'Add entry', { talent: '', sphere: null })}</div>
      ${line('Practitioner base DC', t.practitionerDC)}
    </section>`;
  }

  /**
   * Talents from anywhere but a class's own ladder — a feat, an item, a
   * template. Its own group under the class blocks rather than a corner of the
   * tradition panel: a tradition grants talents because of what the character
   * is, and these arrive for unrelated reasons, so the rows want a Source and
   * the width to write it in.
   */
function bonusTalentPanel(model, sideKey, side) {
    const isMagic = sideKey === 'magic';
    const list = `training.${sideKey}.bonusTalents`;
    const rows = side.bonusTalents || [];
    return `<section class="panel span2">
      <h3>Bonus ${isMagic ? 'magic' : 'combat'} talents
        ${rows.length ? `<span class="badge">${rows.length}</span>` : ''}</h3>
      <div class="tablewrap"><table class="talents bonus stacked">
        <colgroup><col class="talent"><col class="sphere"><col class="source"><col class="notes"><col class="tools"></colgroup>
        <thead><tr><th>Talent</th><th>Sphere</th><th>Source</th><th>Notes</th><th></th></tr></thead>
        <tbody>${rows.map((e, i) => `<tr>
          <td data-stack="name">${talentCell(model, `data-item="${list}|${i}|talent"`, e.talent, e.sphere,
    { sphere: 'sphere', notes: 'notes' })}</td>
          <td data-label="Sphere">${itemSelect(list, i, 'sphere', e.sphere, sphereNames(isMagic ? MAGIC_SPHERES : COMBAT_SPHERES, isMagic ? 'magic' : 'combat'))}</td>
          <td data-label="Source">${itemText(list, i, 'source', e.source, 'Feat, item…')}</td>
          <td data-label="Notes">${prose(model, `data-item="${list}|${i}|notes"`, e.notes, 1, 'grow')}</td>
          ${rowTools(list, i)}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:6px">${addButton(list, 'Add talent', {
    talent: '', sphere: null, source: '', notes: '',
  })}</div>
    </section>`;
  }


function magicTraditionPanel(model, m) {
    const tr = m.tradition || {};
    const dlist = 'training.magic.tradition.drawbacks';
    const blist = 'training.magic.tradition.boughtOff';
    // Drawbacks read {…} like prose: "Expensive Locus ({locus = 22500} mana)"
    // is a drawback and a number the rest of the sheet can spend.
    const textRow = (lst, v, i) => `<div class="listrow">
      ${prose(model, `data-item="${lst}|${i}|self"`, v, 1, 'grow')}
      <button class="danger" data-remove="${lst}|${i}" aria-label="Remove">×</button>
    </div>`;
    // A drawback is a few words, and a tradition can run to twenty of them, so
    // they sit as many to a row as the panel is wide enough for rather than
    // one per line down a column of mostly empty space.
    const textList = (lst, items) => (items.length
      ? `<div class="listgrid">${items.map((d, i) => textRow(lst, d, i)).join('')}</div>`
      : '<p class="empty">None.</p>');
    return `<section class="panel wide">
      <h3>Casting tradition</h3>
      <label class="fld"><span>Tradition</span>${text('training.magic.tradition.name', tr.name)}</label>

      <h4 class="subhead">Drawbacks <span class="badge">${m.drawbackCount ?? 0} total</span></h4>
      ${textList(dlist, tr.drawbacks || [])}
      <div>${addButton(dlist, 'Add drawback', '')}</div>
      <p class="hint">Write “… x2” on a drawback taken twice — it counts double.
        Formulas work here too: “Expensive Locus ({locus = 22500} mana)”.</p>

      <h4 class="subhead">Bought off with drawback feats <span class="badge">${m.boughtOffCount ?? 0}</span></h4>
      ${textList(blist, tr.boughtOff || [])}
      <div>${addButton(blist, 'Add bought-off drawback', '')}</div>

      <div class="statline" style="margin-top:8px"><span class="label">Effective drawbacks</span>
        <span class="value">${m.drawbackCount ?? 0} − 2×${m.boughtOffCount ?? 0} = ${m.effectiveDrawbacks ?? 0}</span></div>
      ${line('Boons', m.boons ?? 0, true)}
      ${boonSplit(m)}
      <p class="hint">
        The ladder is 1 → 1+level/6, 2 → 1+level/3, 3 → level/2, 4 → 1+level/1.5,
        5 → level, and tops out there; each boon grants the step it adds to the one
        below it. Spell points are granted per casting class
        (${m.castingClassCount ?? 0}); essence is one pool, and lands on the Akashic
        tab as the Essence Boon.
      </p>
      <div class="statline"><span class="label">Advanced Magic Training</span>
        <span class="value">${check('training.magic.amt', m.amt)}</span></div>
      <div class="statline"><span class="label">Mythic AMT</span>
        <span class="value">${check('training.magic.mythicAmt', m.mythicAmt)}</span></div>
    </section>`;
  }

  /**
   * What each boon was spent on. A boon is a choice the player makes, not a
   * number that falls out of the drawback count, so each one gets its own row:
   * spell points for the casting pool, or essence for the veilweaving one.
   */

  /**
   * How each tradition pool was spent: so many of its steps as spell points,
   * the rest as essence. Two fields rather than a choice per step, because
   * what a step is worth depends only on how many are taken, not on which.
   */
function boonSplit(m) {
    const pools = m.traditionPools || [];
    if (!pools.length) {
      return `${line('Tradition SP granted', 0, true)}
        <p class="hint">Nothing to spend yet — a tradition grants a boon per drawback
          left after the drawback feats have bought theirs off.</p>`;
    }
    const steps = (p, value, kind) => `<input type="number" min="0" max="${p.steps}"
      value="${value}" data-split="training.magic.tradition.boonSP|${p.steps}|${kind}"
      aria-label="${esc(p.label)} — steps as ${kind === 'sp' ? 'spell points' : 'essence'}">`;

    return `<h4 class="subhead">Granted, and how it was spent</h4>
      <div class="tablewrap"><table class="talents pools">
        <colgroup><col class="talent"><col class="tool"><col class="sphere"><col class="tool"><col class="sphere"></colgroup>
        <thead><tr><th>Pool</th>
          <th class="num" colspan="2">As spell points</th>
          <th class="num" colspan="2">As essence</th></tr></thead>
        <tbody>${pools.map((p) => `<tr>
          <td>${esc(p.label)} <span class="badge">${p.points}</span></td>
          <td class="num">${steps(p, p.spSteps, 'sp')}</td>
          <td class="num total">${p.sp} SP</td>
          <td class="num">${steps(p, p.essenceSteps, 'essence')}</td>
          <td class="num total">${p.essence}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Steps, not points: each pool's steps add back up to its ladder
        however they are split.</p>
      ${line('Tradition SP granted', m.traditionSP ?? 0, true)}
      ${line('Essence granted', m.traditionEssence ?? 0, true)}`;
  }


function magicGlobalsPanel(model, m) {
    const hint = (mine, sheet) => (sheet && mine !== sheet
      ? `<span class="badge err" title="The Google Sheet cached a different value">sheet: ${esc(sheet)}</span>` : '');
    const s = m.sheet || {};
    return `<section class="panel">
      <h3>Casting numbers</h3>
      <div class="statline"><span class="label">Caster level</span>
        <span class="value big">${m.globalCL} ${hint(m.globalCL, s.totalCL)}</span></div>
      ${editLine('CL bonus', 'training.magic.clBonus', m.clBonus)}
      <div class="statline"><span class="label">Global DC</span>
        <span class="value big">${m.globalDC} ${hint(m.globalDC, s.totalDC)}</span></div>
      ${editLine('DC bonus', 'training.magic.dcBonus', m.dcBonus)}
      <div class="statline"><span class="label">MSB</span><span class="value">${m.msb} ${hint(m.msb, s.totalMSB)}</span></div>
      ${editLine('MSB bonus', 'training.magic.msbBonus', m.msbBonus)}
      <div class="statline"><span class="label">MSD</span><span class="value">${m.msd} ${hint(m.msd, s.totalMSD)}</span></div>
      ${editLine('MSD bonus', 'training.magic.msdBonus', m.msdBonus)}
      ${lineHtml('Concentration', `<span class="rollpair">d20+${m.concentration}${
        rollButton(model, 'concentration', 'magic', 'a concentration check')}</span>`)}

      <h4 class="subhead">Spell points</h4>
      ${(m.classSP || []).map((x) => line(`${x.name}`, x.sp)).join('')}
      ${editLine('Bonus SP', 'training.magic.bonusSP', m.bonusSP)}
      ${line('Tradition SP', m.traditionSP ?? 0)}
      <div class="statline"><span class="label">Total SP</span>
        <span class="value big">${m.totalSP} ${hint(m.totalSP, s.totalSP)}</span></div>
      ${m.spOnEssence ? `
      <div class="statline"><span class="label">Condensed to essence
        <span class="badge">${m.spOnEssence / SP_PER_TEMP_ESSENCE} temp essence</span></span>
        <span class="value">−${m.spOnEssence}</span></div>
      <div class="statline"><span class="label">Available to cast with</span>
        <span class="value big${m.spShort ? ' bad' : ''}">${m.availableSP}</span></div>
      <p class="hint${m.spShort ? ' warn' : ''}">
        ${m.spShort
    ? `Condensing that much essence costs ${m.spOnEssence} points and there are only ${m.totalSP}: ${m.spShort} short. Edit it on the Akashic tab.`
    : `${SP_PER_TEMP_ESSENCE} spell points make 1 temporary essence, set on the Akashic tab.`}
      </p>` : ''}
      <p class="hint">Class SP = class levels + casting ability modifier.</p>
    </section>`;
  }

  /* ----- sphere bonuses / skill ranks / unarmed ----- */


function sphereBonusPanel(model, sideKey, side) {
    const rows = side.sphereRows || [];
    const active = rows.filter((r) => r.talents > 0 || r.rankBonus || r.dcBonus || r.clBonus
      || r.clForwarded || r.babForwarded || r.dcForwarded);
    const isMagic = sideKey === 'magic';
    const list = `training.${sideKey}.sphereBonuses`;
    // A number, or a rule: the model resolves it into `<field>Num` and flags
    // a bad one in `<field>Error`, so the cell shows the answer and the
    // source on a click, like every other formula field. A bonus forwarded
    // here from prose is the badge beside it, under the sphere's own name --
    // sphere.dark.cl, sphere.athletics.bab -- never folded into the field.
    const bonus = (r, i, field, example, into) => exprField(`data-item="${list}|${i}|${field}"`, r[field], {
      width: '4rem',
      value: r[`${field}Num`],
      error: r[`${field}Error`],
      title: `A number, or a formula — e.g. ${example}`,
    }) + forwardedBadge(model, sphereForwardKey(r.sphere) ? `${sphereForwardKey(r.sphere)}.${into}` : '');
    const render = (r) => {
      const i = (side.sphereBonuses || []).findIndex((x) => x.sphere === r.sphere);
      return `<tr>
        <td>${esc(r.sphere)}</td>
        <td class="num">${r.talents || ''}</td>
        <td class="num">${isMagic
    ? bonus(r, i, 'clBonus', 'floor(level / 4)', 'cl')
    : bonus(r, i, 'rankBonus', 'floor(level / 4)', 'bab')}</td>
        <td class="num">${bonus(r, i, 'dcBonus', 'floor(level / 6)', 'dc')}</td>
        <td class="num total">${isMagic ? `${r.cl} / ${r.dc}` : `${fmt(r.attack)} / ${r.dc}`}</td>
      </tr>`;
    };
    return `<section class="panel">
      <h3>${isMagic ? 'Sphere CL / DC' : 'Sphere BAB / DC'}</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>Sphere</th><th class="num">Talents</th>
          ${/* BAB+, not Rank+: the column adds to the sphere's attack bonus,
                which is BAB for every sphere but the two that key off skill
                ranks, and those are named in the hint under the table. The
                skill spheres' Rank+ is on the Guile tab, where ranks are the
                thing being added to. */''}
          <th class="num" title="${esc(isMagic
    ? 'A bonus to this sphere’s caster level only'
    : 'A bonus to this sphere’s attack bonus only — its BAB, or the skill ranks Alchemy and Beastmastery use instead')}">${
  isMagic ? 'CL+' : 'BAB+'}</th>
          <th class="num" title="A bonus to this sphere’s save DC only">DC+</th>
          <th class="num">${isMagic ? 'CL / DC' : 'BAB / DC'}</th></tr></thead>
        <tbody>${active.map(render).join('')}</tbody>
      </table></div>
      <details style="margin-top:6px"><summary class="hint" style="cursor:pointer">All spheres</summary>
        <div class="tablewrap"><table><tbody>${rows.filter((r) => !active.includes(r)).map(render).join('')}</tbody></table></div>
      </details>
      ${!isMagic ? '<p class="hint">Alchemy keys off Craft (alchemy) ranks; Beastmastery off Handle Animal / Ride.</p>' : ''}
    </section>`;
  }

  /**
   * Bonus skill ranks, for the skills that have any coming.
   *
   * The block is seventeen rows of which a character has two or three: the
   * rest ask for a sphere they have no talent in, or for a package they did
   * not take, and a row that can only ever read zero is not information. What
   * is left is the rows their talents can reach -- shown whether or not the
   * switch is on, because the switch is the point of them -- and a character
   * with none of those is told so in a sentence instead of in a table of
   * noughts.
   *
   * **From** is what the row wants. Where the sheet can see the talent it says
   * so and the row is automatic; where the sphere still holds talents nobody
   * has written down -- a Primordia technique's picks from 7th level, most
   * often -- the row is marked and the switch decides, because a talent this
   * sheet cannot see is not a talent the character does not have. Naming them
   * on the Primordia tab settles those rows one way or the other.
   */
function sphereSkillPanel(model) {
    const list = 'training.combat.skillRanks';
    // The index is the row's place in the stored list, which the filter must
    // not renumber: it is what every field on the row binds to.
    const rows = (model.trainingSkillRanks || [])
      .map((r, i) => ({ ...r, i }))
      .filter((r) => r.state !== 'unmet' || r.current > 0);
    if (!rows.length) {
      return `<section class="panel">
        <h3>Bonus skill ranks from spheres</h3>
        <p class="empty">This character has no talents that grant bonus ranks.</p>
      </section>`;
    }
    const anyUnsure = rows.some((r) => r.state === 'unknown');
    return `<section class="panel">
      <h3>Bonus skill ranks from spheres</h3>
      <div class="tablewrap"><table class="sphereranks">
        <thead><tr><th></th><th>Skill</th>
          <th class="num">Talents</th><th class="num">Ranks</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.current ? 'trained' : 'untrained'}">
          <td class="mid">${itemCheck(list, r.i, 'enabled', r.enabled)}</td>
          <td>${esc(r.skill)}
            <div class="req${r.state === 'unknown' ? ' unsure' : ''}"
              title="${esc(r.state === 'met'
    ? `${r.requirement} — found on this character.`
    : `${r.requirement} — the sphere is here, but it still holds talents nobody has named. Write them in on the Alternate Training tab and this row answers itself; until then the tick beside it decides.`)}">${esc(r.requirement)}</div></td>
          <td class="num">${r.talents || ''}</td>
          <td class="num total">${r.current || ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">
        5 ranks per talent in the associated sphere, capped at level; these flow
        into the Spheres column of the Skills tab automatically. A row appears
        only when what it asks for — the sphere for a <em>Base</em> row, the named
        package or talent otherwise — is on the character.
        ${anyUnsure ? 'A <span class="req unsure">dotted</span> requirement is one the sheet cannot yet confirm: '
    + 'the sphere is there and still holds talents nobody has written down — a technique\'s picks from 7th '
    + 'level, usually. Name them on the <strong>Alternate Training</strong> tab and the row answers itself; '
    + 'until then the tick is yours to make.' : ''}
      </p>
    </section>`;
  }


  /* ----- templates -----

   *
   * A template is a list of features, each a title, a type and its text, and
   * each able to carry sub-abilities and tables -- which is how the source
   * sheets are written: Omni-Cooking has four blocks under it and two of them
   * are tables. Groups reorder by dragging, and so do sub-abilities, which can
   * also be dragged into another group. What a sub-ability cannot do is leave
   * its group for the top level: it hangs off the feature above it.
   */

export function renderTemplatePanel(model, ctx) {
    const templates = model.data.templates || [];
    const blankTemplate = {
      tab: null, name: 'Template', link: null, approvalLink: null, features: [],
    };
    const blankAbility = { name: '', type: null, text: '', tables: [], children: [] };
    if (!templates.length) {
      return `<div class="grid"><section class="panel span2">
        <h3>Template</h3>
        <p class="hint">A template's features live here — a name, whether each is
          extraordinary, supernatural or spell-like, its text, and any tables or
          sub-abilities it grants.</p>
        <div style="margin-top:8px">${addButton('templates', 'Add template', blankTemplate)}</div>
      </section></div>`;
    }
    return `<div class="grid">${templates.map((tp, ti) => {
      const features = tp.features || [];
      return `<section class="panel span2">
        <h3>
          ${text(`templates.${ti}.name`, tp.name ?? tp.tab ?? 'Template', 'Template name')}
          ${tp.tab ? `<span class="badge">from “${esc(tp.tab)}”</span>` : ''}
          <button class="danger" data-remove="templates|${ti}" title="Remove template" aria-label="Remove template">×</button>
        </h3>
        <div class="fieldgrid two">
          ${field('Template link', text(`templates.${ti}.link`, tp.link))}
          ${field('Approval link', text(`templates.${ti}.approvalLink`, tp.approvalLink))}
        </div>
        <div class="tmpl" data-tmpl="${ti}">
          ${features.map((f, fi) => templateGroup(ctx, model, ti, fi, f, features.length)).join('')}
        </div>
        <div style="margin-top:8px">
          ${addButton(`templates.${ti}.features`, 'Add ability', blankAbility)}
        </div>
      </section>`;
    }).join('')}
    </div>`;
  }

  /** One template feature: the group head, its tables and its sub-abilities. */
function templateGroup(ctx, model, ti, fi, f, total) {
    const list = `templates.${ti}.features`;
    const path = `${list}.${fi}`;
    const kids = f.children || [];
    return `<article class="feature tgroup${f.temporary ? ' temporary' : ''}" data-tdrop="${ti}|${fi}|-1">
      <div class="featurehead">
        ${grip(ti, fi, -1, 'Drag to reorder this ability')}
        ${itemText(list, fi, 'name', f.name, 'Ability name')}
        ${itemSelect(list, fi, 'type', f.type, TEMPLATE_TYPES.map((t) => [t, t, TEMPLATE_TYPE_HINTS[t]]))}
        <span class="tools">
          <button data-move="${list}|${fi}|-1" title="Move up" aria-label="Move up" ${fi === 0 ? 'disabled' : ''}>↑</button>
          <button data-move="${list}|${fi}|1" title="Move down" aria-label="Move down" ${fi === total - 1 ? 'disabled' : ''}>↓</button>
          <button class="danger" data-remove="${list}|${fi}" title="Remove ability" aria-label="Remove ability">×</button>
        </span>
      </div>
      ${f.temporary ? `<p class="hint pending">Temporary — the import could not place these cells
        under a feature, so they were kept here rather than dropped. Move what they say into
        abilities of their own, and delete this once it is empty.</p>` : ''}
      ${itemArea(model, list, fi, 'text', f.text, 4)}
      ${templateTables(model, ctx, ti, path, f)}
      ${kids.length ? `<div class="tkids">
        ${kids.map((c, ci) => templateChild(ctx, model, ti, fi, ci, c, {
    first: fi === 0 && ci === 0,
    last: fi === total - 1 && ci === kids.length - 1,
  })).join('')}
      </div>` : ''}
      <div class="tadd">
        ${addButton(`${path}.children`, 'Sub-ability', { name: '', type: null, text: '', tables: [] })}
        ${addButton(`${path}.tables`, 'Table', NEW_TEMPLATE_TABLE())}
      </div>
    </article>`;
  }

  /**
   * A sub-ability: the same card, indented, and never above its group head.
   *
   * Its ↑ / ↓ carry on into the neighbouring ability rather than stopping at
   * the ends of their own group, so a sub-ability can be moved between groups
   * without a mouse. They are only disabled where there is no ability left to
   * move into.
   */
function templateChild(ctx, model, ti, fi, ci, c, { first, last }) {
    const list = `templates.${ti}.features.${fi}.children`;
    const path = `${list}.${ci}`;
    return `<article class="feature tchild" data-tdrop="${ti}|${fi}|${ci}">
      <div class="featurehead">
        ${grip(ti, fi, ci, 'Drag to reorder, or into another ability')}
        ${itemText(list, ci, 'name', c.name, 'Sub-ability name')}
        ${itemSelect(list, ci, 'type', c.type, TEMPLATE_TYPES.map((t) => [t, t, TEMPLATE_TYPE_HINTS[t]]))}
        <span class="tools">
          <button data-tnudge="${ti}|${fi}|${ci}|-1" title="Move up (into the ability above, at the top)"
            aria-label="Move up" ${first ? 'disabled' : ''}>↑</button>
          <button data-tnudge="${ti}|${fi}|${ci}|1" title="Move down (into the ability below, at the bottom)"
            aria-label="Move down" ${last ? 'disabled' : ''}>↓</button>
          <button class="danger" data-remove="${list}|${ci}" title="Remove sub-ability" aria-label="Remove sub-ability">×</button>
        </span>
      </div>
      ${itemArea(model, list, ci, 'text', c.text, 3)}
      ${templateTables(model, ctx, ti, path, c)}
      <div class="tadd">${addButton(`${path}.tables`, 'Table', NEW_TEMPLATE_TABLE())}</div>
    </article>`;
  }


function grip(ti, fi, ci, title) {
    return `<span class="grip" data-tgrip="${ti}|${fi}|${ci}" title="${esc(title)}"
      role="button" tabindex="-1" aria-hidden="true">⠿</span>`;
  }

  /**
   * The abilities of a template, as somewhere a table can be moved to.
   *
   * Where a table is drawn on the sheet says which feature it is under, and
   * that is not always what it means -- Bryva's spell-school table is written
   * beside Temporal Haze and belongs to Omni-Cooking.
   */
function templateHomes(model, ti) {
    const out = [];
    (model.data.templates?.[ti]?.features || []).forEach((f, fi) => {
      const label = (n, fallback) => (String(n || '').trim() || fallback);
      out.push([`templates.${ti}.features.${fi}`, label(f.name, `Ability ${fi + 1}`)]);
      (f.children || []).forEach((c, ci) => {
        out.push([`templates.${ti}.features.${fi}.children.${ci}`,
          `↳ ${label(c.name, `Sub-ability ${ci + 1}`)}`]);
      });
    });
    return out;
  }

  /**
   * The tables a feature carries.
   *
   * Every cell is a growing prose field rather than a one-line input: these
   * hold rules text ("consumer gains 2 temporary hit points per 1 by which the
   * dish beats the cooking DC"), and they resolve {…} like any other prose.
   *
   * Cells merge by what is written in them -- `-----` joins the cell to its
   * left, `|||||` the cell above -- and a merged cell is not drawn, so the
   * **Cells** toggle shows the grid as it is stored when a merge needs undoing
   * or adjusting. See `mergeLayout` in rules.js for how the spans are worked
   * out; nothing about them is stored.
   */
function templateTables(model, ctx, ti, path, f) {
    const homes = templateHomes(model, ti).filter(([p]) => p !== path);
    return (f.tables || []).map((t, bi) => {
      const table = `${path}.tables.${bi}`;
      const rows = `${table}.rows`;
      const width = (t.columns || []).length;
      const raw = ctx.showCells.has(table);
      const grid = (t.rows || []).map((row) => Array.from({ length: width },
        (_, ci) => row.cells?.[ci] ?? null));
      const body = raw ? null : mergeLayout(grid);
      const head = raw ? null : mergeLayout([t.columns || []])[0];
      const span = (s) => (s.colspan > 1 ? ` colspan="${s.colspan}"` : '')
        + (s.rowspan > 1 ? ` rowspan="${s.rowspan}"` : '');
      return `<div class="ttable">
        <div class="ttablehead">
          ${text(`${table}.caption`, t.caption, 'Table caption (optional)')}
          ${homes.length ? `<select data-tmove="${path}|${bi}" title="Move this table to another ability">
            <option value="">Move to…</option>
            ${homes.map(([p, label]) => `<option value="${p}">${esc(label)}</option>`).join('')}
          </select>` : ''}
          <button data-cells="${table}" aria-pressed="${raw}"
            title="Show every cell as it is stored, merge markers and all">Cells</button>
          <button data-action="add-template-column" data-path="${table}">+ Column</button>
          <button class="danger" data-remove="${path}.tables|${bi}" title="Remove table">Remove table</button>
        </div>
        ${raw ? `<p class="hint">Every cell, as stored. Type <code>-----</code> in a cell to
          merge it into the one on its left, or <code>|||||</code> to merge it into the one
          above; clear it again to split them.</p>` : ''}
        <div class="tablewrap"><table class="tmpltable${raw ? ' raw' : ''}">
          <thead><tr>
            ${(t.columns || []).map((c, ci) => (head && !head[ci] ? '' : `<th${head ? span(head[ci]) : ''}>
              <span class="colhead">
                ${text(`${table}.columns.${ci}`, c, `Column ${ci + 1}`)}
                <button class="danger" data-action="remove-template-column" data-path="${table}"
                  data-col="${ci}" title="Remove column" aria-label="Remove column">×</button>
              </span>
            </th>`)).join('')}
            <th class="tools"></th>
          </tr></thead>
          <tbody>
            ${(t.rows || []).map((row, ri) => `<tr>
              ${Array.from({ length: width }, (_, ci) => (body && !body[ri][ci] ? '' : `<td${
  body ? span(body[ri][ci]) : ''}>${
  prose(model, `data-item="${rows}|${ri}|cells.${ci}"`, row.cells?.[ci], 1, 'grow')}</td>`)).join('')}
              ${rowTools(rows, ri)}
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="tadd">
          ${addButton(rows, 'Row', { cells: Array.from({ length: width }, () => null) })}
        </div>
      </div>`;
    }).join('');
  }
