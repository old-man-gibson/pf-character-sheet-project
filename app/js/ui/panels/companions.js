/**
 * ui/panels/companions.js -- the Familiar, Animal Companion, Eidolon and
 * Conjured Companion tabs.
 *
 * One tab per kind: a strip of that kind's companions, one shown at a time,
 * drawn by the same sections, with the panels only one kind has among them
 * (the eidolon's evolutions, the animal companion's tricks and item slots,
 * the conjured companion's archetype, casting and talents). `companionFace`
 * is the same sections read-only, for the GM's control page.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, ABILITY_LABELS_LIST, portraitHtml } from '../html.js';
import { itemArea, prose } from '../prose.js';
import { forwardedBadge } from '../badges.js';
import { rollButton } from '../roll.js';
import { trackerLine } from './trackers.js';
import { poolTracker } from '../../model.js';
import { ABILITIES, ABILITY_LABELS, SIZE_MODIFIERS, fmt, skillLabel } from '../../rules.js';
import {
  BODY_TYPES, COMPANION_LABELS, COMPANION_LEVEL_SOURCES, CONJURED_ARCHETYPES, CONJURED_BASE_FORMS,
  CONJURED_LEVEL_SOURCES, NATURAL_ATTACKS, abilityTextKey, companionAbilityText, companionAttackKey,
  companionScopeName, companionSkillKey, emptyCompanionFeat, hasArmorSlot, isOtherConjurationTalent,
  wearsBarding,
} from '../../companions.js';
import { getPath } from '../../model/util.js';
import { speedTable } from '../speeds.js';
import { abilitySelect, check, field, num, autoNum, roValue, select, text } from '../fields.js';
import {
  addButton, bigStat, exprField, foldButton, isCollapsed, itemCheck, itemNum, itemSelect, itemText, line,
  lineHtml, proseList, removeButton, rowRemove, working,
} from '../rows.js';

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
        ${b.image ? portraitHtml(b.image) : ''}
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
      ${speedTable(`${p}.speeds`, b.speeds || [], k.speeds || [], {
    example: `30 + 10 * floor(${sn}.hd / 5)`,
    // A rate its armour cut (armoredSpeeds) says so beside the number.
    final: (i, w) => {
      if (w.uncut === undefined) return null;
      const worn = `${['', 'Light', 'Medium', 'Heavy'][k.armor?.category] || ''} ${wearsBarding(kind) ? 'barding' : 'armor'}`.trim();
      const tip = w.final === 0 ? `${worn}: cannot fly.`
        : `${worn}: ${w.uncut} ft. to ${w.final} ft.${k.armor?.run === 3 ? ' Runs at ×3.' : ''}`;
      return `${Number(w.final) || 0} ft. <span class="badge" tabindex="0" data-tip="${esc(tip)}">${wearsBarding(kind) ? 'barding' : 'armor'}</span>`;
    },
  })}
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
          <td class="num total"><span class="rollpair">${s.armorCheck
    ? `<span tabindex="0" data-tip="${esc(`Includes the armor check penalty, ${s.armorCheck}.`)}">${fmt(s.total ?? 0)}</span>`
    : fmt(s.total ?? 0)}${
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
 *
 * The Armor slot has a table of its own, with the character's armour columns
 * on the slot's row: what is worn there is armour -- barding, on a mount --
 * and the model applies it (companionArmor).
 */
function companionItemsPanel(model, cc) {
    const { kind, p, sn, b, k, label } = cc;
    const slots = (k.slots || []).filter((slot) => slot !== 'Armor');
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
    const word = wearsBarding(kind) ? 'Barding' : 'Armor';
    const ap = `${p}.items.Armor`;
    const ar = b.items?.Armor || {};
    // The row takes the armour table's weight and cost; what it weighs and
    // costs at this companion's size and shape is worked out beside them.
    const price = k.armorPrice || {};
    const times = (n) => (n === 0.5 ? '½' : n === 0.1 ? '1/10' : String(n));
    const who = wearsBarding(kind) ? `a ${price.size} creature` : `a ${price.size} ${price.humanoid ? 'humanoid' : 'non-humanoid'}`;
    const scaled = (n, unit, by) => roValue(`${Number(n || 0).toLocaleString('en-US')} ${unit}`, `×${times(by)} for ${who}`, { fit: true });
    const armorTable = hasArmorSlot(kind, b) ? `<h4 style="margin:10px 0 4px">${word}</h4>
      <div class="tablewrap"><table class="stacked" data-fold="shut"><thead><tr>
        <th style="width:1.6rem" title="Worn">✓</th><th style="width:14rem">${word}</th><th style="width:7rem">Type</th>
        <th class="num" style="width:4rem">AC</th><th class="num" style="width:4rem" title="Its enhancement bonus">Enh.</th>
        <th class="num" style="width:4.6rem">Max Dex</th><th class="num" style="width:4rem" title="Armor check penalty">ACP</th>
        <th class="num" style="width:4.6rem" title="From the armor table">Table wt</th>
        <th class="num" style="width:5rem" title="From the armor table">Table cost</th>
        <th class="num" style="width:5rem">Wt</th><th class="num" style="width:6rem">Cost</th>
        <th>Effect</th></tr></thead><tbody><tr>
          <td class="mid" data-label="Worn">${worn(`${ap}.worn`, ar.worn)}</td>
          <td data-stack="name">${text(`${ap}.name`, ar.name, '')}</td>
          <td data-label="Type">${select(`${ap}.type`, ar.type, ['Light', 'Medium', 'Heavy'])}</td>
          <td class="num" data-label="AC">${num(`${ap}.acBonus`, ar.acBonus, 'style="width:3.2rem"')}</td>
          <td class="num" data-label="Enhancement">${num(`${ap}.enhancement`, ar.enhancement, 'style="width:3.2rem"')}</td>
          <td class="num" data-label="Max Dex">${autoNum(`data-set="${ap}.maxDex"`, ar.maxDex, { placeholder: '—', width: '3.2rem' })}</td>
          <td class="num" data-label="Armor check penalty">${num(`${ap}.acp`, ar.acp, 'style="width:3.2rem"')}</td>
          <td class="num" data-label="Table weight">${num(`${ap}.weight`, ar.weight, 'style="width:3.6rem"')}</td>
          <td class="num" data-label="Table cost">${num(`${ap}.cost`, ar.cost, 'style="width:4rem"')}</td>
          <td class="num" data-label="Weight">${scaled(price.weight, 'lb.', price.weightTimes)}</td>
          <td class="num" data-label="Cost">${scaled(price.cost, 'gp', price.costTimes)}</td>
          <td data-label="Effect">${prose(model, `data-set="${ap}.effect"`, ar.effect, 1, 'grow', null, off(ar))}</td>
        </tr></tbody></table></div>
      <p class="hint">Enter the armor table’s weight and cost. ${word} for ${who} weighs ×${times(price.weightTimes)} and costs ×${times(price.costTimes)}. ${wearsBarding(kind)
    ? 'Medium and heavy barding slow land speed and stop flight. Heavy barding runs at ×3.'
    : 'Medium and heavy armor slow land speed. Heavy armor runs at ×3.'}</p>` : '';
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
      </tbody></table></div>` : kind === 'animalCompanion'
    ? '<p class="empty">Pick a body type above to see the item slots it can use.</p>' : ''}
      ${armorTable}
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
        <code>{${esc(sn)}.str.score += 4 as enhancement}</code>, <code>{${esc(sn)}.ac += 1 as deflection}</code>,
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
