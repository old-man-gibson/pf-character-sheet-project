/**
 * ui/panels/overview.js -- the first tab, in both of its forms.
 *
 * In the build view the Overview is the whole character on one page: who they
 * are, the numbers a table asks for, the classes those numbers come out of,
 * what defends them and what they attack with. In the session view the same
 * tab is a dashboard of cards -- the readings that come up in play, arranged
 * the way the player arranged them, with the build machinery a click away.
 *
 * The classes and hit-points panels live here too, because both views show
 * them and neither has a tab of its own.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import { field } from '../fields.js';
import { collapsible, foldButton, isCollapsed } from '../rows.js';
import { prose, renderedProse } from '../prose.js';
import { proseText } from '../rows.js';
import { forwardedBadge, sheetBonusCell, sheetBonusHead, sheetBonusHint } from '../badges.js';
import { rollButton } from '../roll.js';
import { formulaMeta, isDraining, meterStyleButton, meterStyleEditor, meterVisual, trackerVisual } from './trackers.js';
import { rowRemoveButton, slotSpend } from './subsystems.js';

/**
 * The session dashboard's building blocks, in their default order. The blocks
 * are fixed; which of them show, and in what order, is the player's
 * (`uiPrefs.dashCards`) -- and until they arrange it themselves, the caster
 * cards come and go with the systems the character actually uses.
 */
const DASH_CARDS = [
  ['conditions', 'Conditions'],
  ['buffs', 'Buffs'],
  ['resources', 'Resources'],
  ['vancian', 'Spells & slots'],
  ['psionics', 'Power points'],
  ['spheres', 'Casting numbers'],
  ['veils', 'Veils shaped'],
  ['maneuvers', 'Readied maneuvers'],
  ['talents', 'Talents'],
  ['offense', 'Offense'],
  ['defense', 'Defense'],
  ['abilities', 'Ability checks'],
  ['speed', 'Movement'],
  ['skills', 'Key skills'],
  ['effects', 'Active effects'],
  ['quick', 'Quick actions'],
];

const DASH_CARD_LABELS = new Map(DASH_CARDS);

/** The base attack progressions a class can run, as the rules name them. */
const BAB_RATES = [[1, 'full'], [0.75, '&frac34;'], [0.5, '&frac12;'], [0, 'none']];

/** The hit dice a class can have, as the workbook's own HD Size column listed them. */
const HIT_DICE = [4, 6, 8, 10, 12];

/**
 * One of the class table's two progression dropdowns.
 *
 * HD and BAB are the same control asking two questions, so they are built by
 * the same function: a fixed list of what the rules allow, plus whatever the
 * row already holds if a pack or an import put something else there -- which
 * is how a d20 hit die or a 2/3 progression survives being looked at.
 */
function progressionSelect(i, field, value, choices, label, format = String, beaten = null) {
  const now = Number(value) || 0;
  const known = choices.some(([v]) => v === now);
  const opts = known ? choices : [...choices, [now, format(now)]];
  // Marked when another class present at the same levels is doing better,
  // because that is when changing this dropdown moves nothing on the sheet.
  const lost = beaten?.count || 0;
  const all = lost > 0 && lost === beaten.levels;
  const where = beaten?.levels === 1 ? 'its only level'
    : all ? `all ${lost} of its levels`
      : `${lost} of its ${beaten?.levels} levels`;
  const why = lost
    ? `Another class has a better ${beaten.noun} at ${where}, so this one${
      all ? ' does nothing to the character as it stands' : ' only counts at the rest'}.`
    : '';
  return `<select data-item="classes|${i}|${field}" data-kind="number" aria-label="${esc(label)}"
      class="${all ? 'beaten' : ''}"${why ? ` title="${esc(why)}"` : ''}>
      ${opts.map(([v, text]) => `<option value="${v}"${v === now ? ' selected' : ''}>${text}</option>`).join('')}
    </select>`;
}
import { weaponsPanel, wealthPanel } from './gear.js';
import {
  ABILITIES, ABILITY_LABELS, ALT_ATTACK_OF, ATTACK_MODES, ATTACK_MODE_KEY,
  ATTACK_MODE_LABELS, BUFF_MOD_KEYS, BUFF_TARGETS, CONDITIONS, CONDITION_CATS, GAME_SYSTEMS,
  SIZE_MODIFIERS, TRAIT_SLOTS, WEAPON_GROUPS, WEAPON_FAMILIARITY, WEAPON_HANDEDNESS,
  ARMOR_PROFICIENCIES, SHIELD_PROFICIENCIES, addDice, attackModeTotal, castingNoun,
  conditionInfo, conditionTotals, diceString, fmt, prepStyle, skillLabel, statModDelta,
  stepDiceMap,
} from '../../rules.js';
import { hasTokens } from '../../inline.js';
import { maneuverDetails } from '../../model.js';
import {
  THEME_ACCENT, TRACKER_PALETTE, normalizeHex, normalizeStyle,
} from '../../tracker-style.js';
import { WEAPON_MODE_KEYS } from '../../roll20.js';
import { abilitySelect, area, check, num, roField, select, text } from '../fields.js';
import {
  addButton, bigStat, editLine, exprField, itemCheck, itemExpr, itemNum, itemSelect,
  itemText, line, lineHtml, movedInline, rowTools,
} from '../rows.js';
import {
  TRAIT_CATEGORIES,
} from '../../rules.js';

  /**
   * The Overview, top to bottom: who the character is, the numbers a table
   * asks for, the classes those numbers come out of, then what defends them
   * and what they attack with -- each of those a supergroup of the panels that
   * belong together -- and last the things that change less often: conditions,
   * the wallet, traits.
   */
export function renderOverviewPanel(model, ctx) {
    const c = model.data;
    const d = c.defenses;
    const s = c.saves;
    const cs = model.conditionState;

    return `<div class="grid overview">
      <section class="panel span2">
        <h3>At a glance
          ${cs.active.length ? `<span class="badge err">${cs.active.length} condition${cs.active.length === 1 ? '' : 's'} on</span>` : ''}
        </h3>
        <div class="bigstats">
          ${bigStat('HP', { html: movedInline(cs, 'hp', c.hp.total, String) }, c.hp.ability ? `${c.hp.ability} based` : '')}
          ${bigStat('AC', { html: movedInline(cs, 'ac', d.ac, String) }, { html: `touch ${d.touch} &middot; FF ${d.flatFooted}` })}
          ${bigStat('CMD', { html: movedInline(cs, 'cmd', d.cmd, String) }, `FF ${d.ffCmd}`)}
          ${bigStat('Init', { html: movedInline(cs, 'initiative', c.hp.initiative) }, c.hp.initAbility || '', '',
    rollButton(model, 'initiative', 'self', 'initiative', cs))}
          ${bigStat('Fort', { html: movedInline(cs, 'fortitude', s.fortitude.total) }, s.fortitude.stat1 || '')}
          ${bigStat('Ref', { html: movedInline(cs, 'reflex', s.reflex.total) }, s.reflex.stat1 || '')}
          ${bigStat('Will', { html: movedInline(cs, 'will', s.will.total) }, s.will.stat1 || '')}
          ${bigStat('BAB', fmt(c.attack.bab), c.attack.iterative || '')}
          ${(() => {
    // The wallet, beside the numbers a table asks for: what is on hand, and
    // what is left once the offering owed today is paid.
    const w = model.wealthView();
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    return bigStat(esc(w.currency), n(w.current), w.due && w.expected.total
      ? `after offering ${n(w.after)}` : (w.due ? 'nothing owed' : 'on hand'));
  })()}
        </div>
      </section>

      <div class="pairrow span2">
        ${detailsPanel(model)}
        ${abilityScoresPanel(model)}
      </div>
      <div class="pairrow even span2">
        ${specialtyPanel(model)}
        ${languagesPanel(model)}
      </div>

      ${classesPanel(model, ctx, model, ctx)}

      ${supergroup(model, 'defenses', 'Defenses', '', `
          ${hitPointsPanel(ctx, model, model)}
          ${acPanel(model)}
          ${savesPanel(model)}`)}

      ${supergroup(model, 'offenses', 'Offenses', 'offenses', `
          ${attackPanel(model)}
          ${speedPanel(model)}
          ${proficienciesPanel(model)}`)}

      <div class="pairrow span2 wide-first">
        ${conditionsPanel(model)}
        ${carryPanel(model)}
      </div>
      ${/*
           * Wealth is capped at 54rem -- a ledger reads worse the wider it gets --
           * which on a laptop left 495px of empty grid beside it, and Buffs is a
           * short row of chips directly above. Paired, so the gap holds the thing
           * that was going to be under it anyway. Below 900px the pair is one
           * column again, which is what `.pairrow` does on its own.
           */''}
      <div class="pairrow span2 wealthpair">
        ${collapsible(model, 'wealth', wealthPanel(model, ctx))}
        ${collapsible(model, 'buffs', buffsPanel(model, ctx, model, ctx))}
      </div>
      ${traitsPanel(model, ctx, model, ctx)}
    </div>`;
  }

  /* ---------------- the session dashboard ---------------- */

  /**
   * The Overview as it reads mid-session: cards answering what a table
   * actually asks -- what is on me, what can I spend, what do I roll, what
   * is running -- with the full machinery one Expand (the same panels the
   * build view shows) or one Build-view click away. Expand states persist
   * in uiPrefs.collapsed under dash:* keys, where true means open.
   */
export function renderDashboardPanel(model, ctx) {
    const open = (key) => !!model.data.uiPrefs?.collapsed?.[`dash:${key}`];
    const e = model.data.equipment || {};
    const render = {
      conditions: () => dashConditionsCard(model, ctx),
      buffs: () => buffsPanel(model, ctx),
      resources: () => dashResourcesCard(model),
      vancian: () => dashVancianCard(model),
      psionics: () => dashPsionicsCard(model),
      spheres: () => dashSpheresCard(model),
      veils: () => dashVeilsCard(model),
      maneuvers: () => dashManeuversCard(model),
      talents: () => dashTalentsCard(model),
      offense: () => dashOffenseCard(model, ctx, open('offense'))
        + (open('offense') ? `${attackPanel(model)}${weaponsPanel(model, e)}` : ''),
      defense: () => dashDefenseCard(model, open('defense'))
        + (open('defense') ? `${acPanel(model)}${savesPanel(model)}` : ''),
      abilities: () => dashAbilitiesCard(model),
      speed: () => dashSpeedCard(model),
      skills: () => dashSkillsCard(model, open('skills')),
      effects: () => dashEffectsCard(model),
      quick: () => dashQuickCard(model, ctx),
    };
    return `<div class="grid dashboard">
      <div class="dashtools span2">
        <button class="linkish" data-action="dash-arrange" aria-expanded="${ctx.dashArrange}">
          ${ctx.dashArrange ? 'Done arranging' : 'Arrange cards'}</button>
      </div>
      ${ctx.dashArrange ? dashArrangePanel(model) : ''}
      ${dashCardIds(model).map((id) => render[id]?.() || '').join('')}
    </div>`;
  }

  /**
   * The dashboard's default composition: the standing cards, plus the caster
   * cards for whatever the character actually uses -- Vancian slots, the
   * psionic pool, the Spheres casting numbers. The reference lists (veils,
   * readied maneuvers, talents) wait in the arranger, because which of those
   * belongs on a player's overview is a playstyle call, not a data one.
   *
   * `quick` leads. Damage, Heal and Rest are the controls pressed every round
   * of every fight, and they were tenth -- a thousand pixels down, under
   * Movement and Active effects, on the one view whose whole reason for
   * existing is what a table asks for mid-fight. The strip above shows hit
   * points and cannot change them, so this is the only place they move.
   *
   * A default, not a rule: `Arrange cards` has always been able to disagree,
   * and a player who has already arranged theirs keeps the order they chose.
   */
function dashDefaultCards(model) {
    const inUse = model.systemTabsInUse();
    const tagged = model.taggedSystemTabs();
    const on = (id) => inUse[id] || tagged.has(id);
    const out = ['quick', 'conditions', 'buffs', 'resources'];
    if (on('vancian')) out.push('vancian');
    if (on('psionics')) out.push('psionics');
    if (on('combat') && model.data.training?.magic) out.push('spheres');
    out.push('offense', 'defense', 'abilities', 'speed', 'skills', 'effects');
    return out;
  }

  /** The cards to show, in order: the player's arrangement, else the automatic one. */
export function dashCardIds(model) {
    const saved = model.data.uiPrefs?.dashCards;
    if (!Array.isArray(saved)) return dashDefaultCards(model);
    const known = new Set(DASH_CARD_LABELS.keys());
    return saved.filter((id) => known.has(id));
  }

  /**
   * The arranger: every building block, the shown ones in order with move and
   * hide, the rest one click from joining. The first edit pins the automatic
   * arrangement into uiPrefs.dashCards; Reset hands it back to automatic.
   */
function dashArrangePanel(model) {
    const visible = dashCardIds(model);
    const custom = Array.isArray(model.data.uiPrefs?.dashCards);
    const hidden = DASH_CARDS.filter(([id]) => !visible.includes(id));
    const row = (id, i) => `<div class="item statline">
      <span class="label">${esc(DASH_CARD_LABELS.get(id) || id)}</span>
      <span class="value pair">
        <button data-action="dash-card-move" data-id="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(DASH_CARD_LABELS.get(id))} up">↑</button>
        <button data-action="dash-card-move" data-id="${id}" data-dir="1" ${i === visible.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(DASH_CARD_LABELS.get(id))} down">↓</button>
        <button data-action="dash-card-hide" data-id="${id}" ${visible.length === 1 ? 'disabled' : ''}>Hide</button>
      </span>
    </div>`;
    const offRow = ([id, label]) => `<div class="item statline">
      <span class="label">${esc(label)}</span>
      <span class="value"><button data-action="dash-card-show" data-id="${id}">Show</button></span>
    </div>`;
    return `<section class="panel span2">
      <h3>Your overview ${custom ? '<span class="badge player">arranged by you</span>' : '<span class="badge">automatic</span>'}
        ${custom ? '<button style="margin-left:auto" data-action="dash-cards-reset" title="Back to the automatic arrangement: the standing cards plus whatever this character casts or manifests with">Reset to automatic</button>' : ''}
      </h3>
      <p class="hint">
        The cards are fixed building blocks; which show, and in what order, is yours.
        Left automatic, the caster cards come and go with what the character uses; the
        first change you make here pins the arrangement. The reference lists — veils,
        readied maneuvers, talents — are below, for whatever your playstyle keeps
        reaching for.
      </p>
      <div class="rowlist">${visible.map(row).join('')}</div>
      ${hidden.length ? `<h4 class="subhead" style="margin-top:10px">More to add</h4>
      <div class="rowlist">${hidden.map(offRow).join('')}</div>` : ''}
    </section>`;
  }

  /** The card's corner control: one click between the summary and the full read. */
function dashExpand(key, openNow) {
    // `dash:*` is one of the two keys that stores *open* rather than
    // *collapsed*, so what the click writes is the opposite of what is showing.
    return `<button class="linkish" style="margin-left:auto" data-collapse="dash:${key}"
      data-collapse-to="${!openNow}"
      aria-expanded="${openNow}">${openNow ? 'Collapse' : 'Expand'}</button>`;
  }

  /** What is on the character right now, as chips; everything else one pick away. */
function dashConditionsCard(model, ctx) {
    const conds = model.data.conditions || {};
    const cs = model.conditionState;
    const chip = (name) => {
      const info = conditionInfo(name);
      const label = info?.label || name;
      const title = info ? info.rule : '';
      if (info?.kind === 'count') {
        return `<span class="pill cond-pill" title="${esc(title)}">${esc(label)}
          ${num(`conditions.${name}`, Number(conds[name]) || 0, `min="0" style="width:3rem" aria-label="${esc(label)} count"`)}
        </span>`;
      }
      return `<span class="pill cond-pill" title="${esc(title)}">${esc(label)}
        <button data-action="dash-cond-off" data-name="${esc(name)}" aria-label="Take ${esc(label)} off">×</button></span>`;
    };
    const active = Object.keys(conds).filter((n) => Number(conds[n]) > 0)
      .sort((a, b) => a.localeCompare(b));
    return `<section class="panel span2">
      <h3>Conditions ${cs.active.length ? `<span class="badge err">${cs.active.length} on</span>` : ''}
        <button class="linkish" style="margin-left:auto" data-action="dash-cond-picker"
          aria-expanded="${ctx.condPickerOpen}">${ctx.condPickerOpen ? 'Close' : '+ Add condition'}</button>
      </h3>
      <div class="pills dashconds">
        ${active.map(chip).join('') || '<span class="empty">None — all clear.</span>'}
      </div>
      ${dashCondNumbers(model)}
      ${dashCondPicker(model, ctx, model, ctx)}
      ${cs.notes.length ? `<ul class="condnotes">${cs.notes.map((n) => `<li>${esc(n[0].toUpperCase() + n.slice(1))}.</li>`).join('')}</ul>` : ''}
    </section>`;
  }

  /**
   * What the ticked conditions add up to, one tag per number they move --
   * conditions alone, so a buff's bonus never reads as a penalty here. An
   * ability score shows where it lands (floored at 0: a penalty past the
   * score empties it, no further).
   */
function dashCondNumbers(model) {
    const cs = model.conditionState;
    if (!cs.active.length) return '';
    const t = conditionTotals(cs.active);
    const bits = [];
    const labels = [['attack', 'Attack'], ['melee', 'Melee'], ['ranged', 'Ranged'], ['damage', 'Damage'],
      ['ac', 'AC'], ['cmb', 'CMB'], ['cmd', 'CMD'], ['saves', 'Saves'],
      ['fortitude', 'Fort'], ['reflex', 'Ref'], ['will', 'Will'], ['dc', 'Save DCs'],
      ['skills', 'Skills'], ['abilityChecks', 'Ability checks'], ['initiative', 'Init'],
      ['hp', 'HP'], ['essence', 'Essence'], ['speedFt', 'Speed (ft)']];
    for (const [key, label] of labels) {
      if (t.mods[key]) bits.push(`${label} ${fmt(t.mods[key])}`);
    }
    for (const key of ABILITIES) {
      const base = Number(model.data.abilities[key]?.tempScore) || 0;
      let score = base + (t.ability[key] || 0);
      if (t.abilitySet[key] !== undefined) score = Math.min(score, t.abilitySet[key]);
      score = Math.max(0, score);
      if (score !== base) bits.push(`${ABILITY_LABELS[key]} ${base} → ${score}`);
    }
    if (t.losesDex) bits.push('no Dex to AC');
    if (t.speed === 0) bits.push('no move');
    else if (t.speed < 1) bits.push('half speed');
    if (t.acVsMelee) bits.push(`AC vs melee ${fmt(t.acVsMelee)}`);
    if (t.acVsRanged) bits.push(`AC vs ranged ${fmt(t.acVsRanged)}`);
    if (!bits.length) return '';
    return `<div class="condnums">${bits.map((b) => `<span class="tag">${esc(b)}</span>`).join('')}</div>`;
  }

  /**
   * The catalogue as short shelves rather than one long dropdown: a column per
   * kind of trouble, a button per condition. A click puts it on already
   * ticked; Energy Drain climbs a level per click; what is on shows pressed.
   */
function dashCondPicker(model, ctx) {
    if (!ctx.condPickerOpen) return '';
    const conds = model.data.conditions || {};
    const onNow = (info) => Object.entries(conds)
      .some(([n, v]) => Number(v) > 0 && conditionInfo(n)?.key === info.key);
    const btn = (info) => {
      const on = onNow(info);
      const count = info.kind === 'count';
      return `<button data-action="dash-cond-on" data-name="${esc(info.label)}"
        aria-pressed="${on}" ${on && !count ? 'disabled' : ''}
        title="${esc(info.rule)}">${esc(info.label)}${count && on ? ' +1' : ''}</button>`;
    };
    const cats = CONDITION_CATS.map((cat) => `<div class="condcat">
      <h4>${esc(cat)}</h4>
      ${CONDITIONS.filter((x) => x.cat === cat).map(btn).join('')}
    </div>`);
    // Whatever the workbook listed that the catalogue does not know.
    const custom = Object.keys(conds).filter((n) => !conditionInfo(n) && !(Number(conds[n]) > 0));
    if (custom.length) {
      cats.push(`<div class="condcat"><h4>From the sheet</h4>
        ${custom.map((n) => `<button data-action="dash-cond-on" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
      </div>`);
    }
    return `<div class="condcats">${cats.join('')}</div>`;
  }

  /**
   * Buffs: named, tickable bonuses that ride the condition machinery, so a
   * ticked buff moves every "now" figure exactly as a ticked condition does.
   * Each dial takes a number or a formula -- a Citadel banner's
   * "1 + essence.shoulder" keeps up as essence moves. Shown on the session
   * dashboard and on the build Overview alike.
   */
function buffsPanel(model, ctx) {
    const buffs = model.data.buffs || [];
    const cs = model.conditionState;
    const list = 'buffs';
    // Collapsed, a buff is one line: tick, name, what it comes to. Opened, each
    // dial is a full-width formula field with its working, because the formulas
    // worth writing -- nested if(…) off hit points and essence -- need room.
    const targetLabels = new Map(BUFF_TARGETS);
    const summary = (b) => {
      const bits = BUFF_MOD_KEYS
        .map(([key, label]) => { const v = Number(b[`${key}Num`]) || 0; return v ? `${fmt(v)} ${label}` : ''; })
        .filter(Boolean);
      for (const row of b.bonuses || []) {
        const v = Number(row?.valueNum) || 0;
        if (!v) continue;
        bits.push(row.target === 'size' ? `${v > 0 ? `+${v}` : v} true size`
          : row.target === 'sizeEffective' ? `${v > 0 ? `+${v}` : v} effective size`
            : row.target === 'sizeStacking' ? `${v > 0 ? `+${v}` : v} size (stacks)`
              : `${fmt(v)} ${targetLabels.get(row.target) || row.target}`);
      }
      return bits.join(' · ') || 'no numbers yet';
    };
    const dial = (b, i, [key, label]) => `<label class="fld"><span>${label}</span>
      ${itemExpr(list, i, key, b, { width: '100%', placeholder: '0, or a formula' })}</label>`;
    // The cards never move: the editor is its own full-width block under the
    // grid, tied to the open card by the shared highlight.
    const row = (b, i) => {
      const open = ctx.openBuff === i;
      return `<div class="buffcard${b.on ? '' : ' off'}${b.error ? ' invalid' : ''}${open ? ' open' : ''}">
        <div class="buffhead">
          ${itemCheck(list, i, 'on', b.on !== false)}
          <span class="bname">${esc(b.name || 'Unnamed buff')}</span>
          <span class="bsum hint" style="margin:0">${esc(summary(b))}</span>
          ${b.error ? `<span class="badge err" title="${esc(b.error)}">formula problem</span>` : ''}
          <span class="pair" style="margin-left:auto">
            <button data-action="buff-open" data-index="${i}" aria-expanded="${open}"
              title="${open ? 'Close the editor' : 'Open the dials and formulas'}">${open ? '▾ Close' : '▸ Edit'}</button>
            <button class="danger" data-remove="buffs|${i}" aria-label="Remove buff">×</button>
          </span>
        </div>
      </div>`;
    };
    const editing = buffs[ctx.openBuff] ? ctx.openBuff : null;
    const editor = editing === null ? '' : (() => {
      const b = buffs[editing];
      const i = editing;
      const bonusRow = (row, j) => `<span class="buffbonus">
        <select data-item="${list}|${i}|bonuses.${j}.target" data-kind="text" aria-label="What this bonus moves">
          ${BUFF_TARGETS.map(([key, label]) => `<option value="${key}"${row.target === key ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
        ${exprField(`data-item="${list}|${i}|bonuses.${j}.value"`, row.value, {
    width: '5.5rem', value: row.valueNum, error: row.valueError, title: 'A number, or a formula — 1 + essence.shoulder',
  })}
        <button class="danger" data-action="buff-bonus-remove" data-index="${i}" data-j="${j}"
          aria-label="Remove this bonus">×</button>
      </span>`;
      return `<div class="buffeditor">
        <div class="fieldgrid">
          <label class="fld"><span>Buff</span>${itemText(list, i, 'name', b.name, 'Citadel banner')}</label>
          ${BUFF_MOD_KEYS.map((k) => dial(b, i, k)).join('')}
        </div>
        ${BUFF_MOD_KEYS.filter(([key]) => typeof b[key] === 'string' && b[key].trim() !== '')
    .map(([key, label]) => formulaMeta(model, label.toLowerCase(), b[key])).join('')}
        <div class="buffbonuses">
          ${(b.bonuses || []).map(bonusRow).join('')}
          <button data-action="buff-bonus-add" data-index="${i}">+ Add bonus</button>
        </div>
        <p class="hint">Extra bonuses reach what the dials do not: an ability score cascades
          into everything built on its modifier; <em>Save DCs</em> and <em>Essence pool</em>
          show where those numbers are read. <em>Size</em> comes in types that stack with
          each other, while within a type only the largest counts: <em>true</em> changes
          the size itself — attack, AC, CMB, CMD and every weapon's damage dice along the
          official chart — <em>effective</em> ("treated as larger") steps the dice alone,
          and <em>stacking</em> is for the odd item that makes size effects stack outright
          (wraps of suppressed size): it sums with everything and carries the full true
          bundle. Nothing grows past Colossal nor shrinks past Fine — modifiers and
          dice alike run off the capped steps. Riders like sneak keep their dice, and
          reach stays yours. Values take formulas, like the dials.</p>
        <label class="fld" style="margin-top:6px"><span>Note</span>
          ${prose(model, `data-item="${list}|${i}|note"`, b.note, 2, 'grow')}</label>
        <p class="hint">The note reads {…} like prose: a definition written here — say
          <code>{deathgrip.dmg.max = 2 * (1 + essence.shoulder) * if(hp.current / hp.total &lt; 0.5, 2, 1)}</code>
          — is a name the whole sheet can then read: a weapon's dice, a tracker, another buff.
          It stands whether the buff is ticked or not; a value that should switch says so itself, with if(…).</p>
      </div>`;
    })();
    return `<section class="panel span2">
      <h3>Buffs ${cs.buffsOn ? `<span class="badge ok">${cs.buffsOn} on</span>` : ''}
        <button style="margin-left:auto" data-action="buff-add">+ Add buff</button>
      </h3>
      <div class="bufflist">
        ${buffs.map(row).join('') || '<p class="empty">No buffs yet.</p>'}
      </div>
      ${editor}
      <p class="hint">A ticked buff rides the same machinery as a condition: attacks, AC,
        saves, skills, initiative and damage all show their <em>now</em> value with it in.
        Every dial takes a number or a formula — <code>1 + essence.shoulder</code> keeps a
        banner's bonus right as the essence moves.</p>
    </section>`;
  }

  /** Every tracker as one row: name, its own meter, and the − n + controls. */
function dashResourcesCard(model) {
    const trackers = model.trackers;
    const row = (t) => {
      const max = Number(t.max) || 0;
      const min = Number(t.min) || 0;
      const cur = Number(t.current) || 0;
      const draining = isDraining(t);
      const twoSided = min < 0;
      const shown = draining ? max - cur : cur;
      const signed = (n) => (n > 0 ? `+${n}` : String(n).replace('-', '−'));
      const range = min === 0 ? `/ ${max}`
        : (twoSided && min === -max) ? `/ ±${max}` : `/ ${signed(min)}…${signed(max)}`;
      return `<div class="dashtracker${t.error ? ' invalid' : ''}">
        <span class="tname" title="${esc(t.refresh || '')}">${esc(t.name)}</span>
        <div class="dashmeter">${trackerVisual(t, normalizeStyle(t.style), t.resolvedZones || [], { interactive: true })}</div>
        <span class="tracker-controls">
          <button data-tracker-step="${esc(t.id)}" data-delta="-1" aria-label="${esc(t.name)} down one">−</button>
          <input type="number" class="${shown < 0 ? 'neg' : ''}" value="${shown}" data-tracker-current="${esc(t.id)}"
            aria-label="${esc(t.name)} ${draining ? 'remaining' : 'current'}">
          <span class="pool">${range}</span>
          <button data-tracker-step="${esc(t.id)}" data-delta="1" aria-label="${esc(t.name)} up one">+</button>
        </span>
      </div>`;
    };
    return `<section class="panel span2">
      <h3>Resources
        <button class="linkish" style="margin-left:auto" data-action="goto-trackers"
          title="The Trackers tab: add one, restyle one, give one a formula">+ New tracker</button>
      </h3>
      <div class="dashtrackers">
        ${trackers.map(row).join('') || '<p class="empty">No trackers yet — the Trackers tab starts one.</p>'}
      </div>
    </section>`;
  }

  /** The attack numbers and every weapon's line; Expand brings the full panels up. */
function dashOffenseCard(model, ctx, openNow) {
    const c = model.data;
    const cs = model.conditionState;
    const weapons = c.equipment?.weapons || [];
    // Moved numbers replace the base in place, coloured by direction, with the
    // base in the tooltip -- the same read as AC and the saves, everywhere.
    const stat = (label, value, nowKey, kind, ref, rollLabel) => {
      const delta = cs.changed ? (cs.delta[nowKey] || 0) : 0;
      const shown = delta
        ? `<strong class="adj ${delta > 0 ? 'up' : ''}" title="${esc(`Base ${fmt(value)} — with ${cs.sources} applied`)}">${fmt(cs.adjusted[nowKey])}</strong>`
        : `<strong>${fmt(value)}</strong>`;
      return `<span class="dashstat">${esc(label)} ${shown}${rollButton(model, kind, ref, rollLabel, cs)}</span>`;
    };
    const wrow = (w, i) => {
      const { calc } = w;
      const modeKey = WEAPON_MODE_KEYS[w.attackType];
      const atkDelta = (cs.changed && modeKey && cs.delta[modeKey]) || 0;
      const dmgDelta = (cs.changed && calc && cs.delta.damage) || 0;
      const grow = (cs.changed && calc && cs.sizeSteps) || 0;
      const baseAtkStr = calc?.totalAtkStr ?? fmt(w.attackTotal ?? 0);
      const atkStr = !atkDelta ? baseAtkStr
        : calc
          ? (Object.keys(calc.tokAtk?.dice || {}).length
            ? `${fmt(calc.totalAtk + atkDelta)}+${diceString(calc.tokAtk.dice)}`
            : fmt(calc.totalAtk + atkDelta))
          : fmt((Number(w.attackTotal) || 0) + atkDelta);
      const baseDmgStr = calc?.totalDmgStr ?? w.damageTotal ?? '—';
      // A size buff steps the weapon's own dice along the official chart; the
      // token riders keep theirs, exactly as the rules leave them alone.
      const sized = grow
        ? stepDiceMap(calc.baseDmgDice || {}, grow, c.identity?.size)
        : { dice: calc?.baseDmgDice || {}, flat: 0 };
      const dmgStr = !(dmgDelta || grow) ? baseDmgStr
        : diceString(
          addDice(addDice(sized.dice, calc.tokDmg?.dice || {}), calc.tokMultDmg?.dice || {}),
          calc.totalDmgFlat + dmgDelta + sized.flat,
        ) + ((calc.notes || []).length ? ` ${calc.notes.join(' ')}` : '');
      const dmgMoved = dmgDelta || (grow ? 1 : 0);
      const cls = (d) => (d ? ` adj${d > 0 ? ' up' : ''}` : '');
      return `<div class="statline">
      <span class="label">${esc(String(w.name || '').trim() || `Weapon ${i + 1}`)}</span>
      <span class="value rollpair"><strong class="${cls(atkDelta)}"
          title="${atkDelta ? esc(`Base ${baseAtkStr} — with ${cs.sources} applied`) : ''}">${esc(atkStr)}</strong>
        <span class="dashdmg${cls(dmgMoved)}"
          title="${dmgMoved ? esc(`Base ${baseDmgStr} — with ${cs.sources} applied${grow ? `, ${Math.abs(grow)} size step${Math.abs(grow) === 1 ? '' : 's'} ${grow > 0 ? 'larger' : 'smaller'}` : ''}`) : ''}">${esc(dmgStr)}</span>
        ${rollButton(model, 'weapon', i, `a full attack with ${String(w.name || '').trim() || 'this weapon'} — every iterative, damage and crit`, cs)}</span>
    </div>`;
    };
    return `<section class="panel">
      <h3>Offense ${dashExpand('offense', openNow)}</h3>
      <div class="dashstats">
        ${stat('Melee', c.attack.totalMelee, 'melee', 'mode', 'melee', 'a melee attack')}
        ${stat('Ranged', c.attack.totalRanged, 'ranged', 'mode', 'ranged', 'a ranged attack')}
        ${stat('CMB', c.attack.totalCmb, 'cmb', 'mode', 'cmb', 'a combat maneuver')}
        ${stat('Init', c.hp.initiative, 'initiative', 'initiative', 'self', 'initiative')}
      </div>
      <div class="rowlist" style="margin-top:6px">
        ${weapons.map(wrow).join('') || '<p class="empty">No weapons yet — Expand to add one.</p>'}
      </div>
      ${(() => {
    // The full-attack line names the weapon whose damage rides along; with
    // no weapons it falls back to the bare melee iterative chain.
    const pick = Number(ctx.draft.fullAttackWeapon);
    const chosen = Number.isInteger(pick) && weapons[pick] ? pick : (weapons.length ? 0 : null);
    const wname = (w, i) => String(w.name || '').trim() || `Weapon ${i + 1}`;
    const control = weapons.length > 1
      ? `<select data-draft="fullAttackWeapon" aria-label="Weapon for the full attack">
          ${weapons.map((w, i) => `<option value="${i}"${i === chosen ? ' selected' : ''}>${esc(wname(w, i))}</option>`).join('')}
        </select>`
      : weapons.length === 1 ? `<span class="dim">${esc(wname(weapons[0], 0))}</span>` : '';
    const roll = chosen !== null
      ? rollButton(model, 'weapon', chosen, `a full attack with ${wname(weapons[chosen], chosen)} — every iterative, its damage and crit`, cs)
      : rollButton(model, 'mode', 'melee', 'a full-round melee attack — every iterative', cs);
    return lineHtml('Full attack', `${control}
      <span class="dim">${esc(c.attack.iterative || '—')}</span> ${roll}`);
  })()}
      ${cs.changed && cs.delta.damage
    ? `<p class="hint">${fmt(cs.delta.damage)} on damage rolls from ${cs.sources}.</p>` : ''}
    </section>`;
  }

  /** AC, CMD and the saves at a glance, adjusted; Expand brings the breakdowns up. */
function dashDefenseCard(model, openNow) {
    const d = model.data.defenses;
    const s = model.data.saves;
    const cs = model.conditionState;
    const shown = (key, base, format = String) => (cs.changed && cs.delta[key]
      ? `<strong class="adj ${cs.delta[key] > 0 ? 'up' : ''}" title="${esc(`Base ${format(base)} — with ${cs.sources} applied`)}">${format(cs.adjusted[key])}</strong>`
      : `<strong>${format(base)}</strong>`);
    const save = (key, label) => lineHtml(label,
      `${shown(key, s[key].total, fmt)}${rollButton(model, 'save', key, `a ${label} save`, cs)}`, true);
    const moved = (key, base) => (cs.changed && cs.delta[key] ? cs.adjusted[key] : base);
    return `<section class="panel">
      <h3>Defense ${dashExpand('defense', openNow)}</h3>
      ${lineHtml('AC', `${shown('ac', d.ac)} <span class="dim">touch ${moved('touch', d.touch)} · FF ${moved('flatFooted', d.flatFooted)}</span>`, true)}
      ${lineHtml('CMD', `${shown('cmd', d.cmd)} <span class="dim">FF ${d.ffCmd}</span>`, true)}
      ${save('fortitude', 'Fortitude')}
      ${save('reflex', 'Reflex')}
      ${save('will', 'Will')}
      <p class="hint">Expand for the armour and save breakdowns by bonus type.</p>
    </section>`;
  }

  /**
   * Movement, as a table asks for it: how far, and how far with a run-up.
   *
   * Every rate the character actually has, with whatever a condition has done
   * to it, and beside each the two multiples anyone reaches for mid-fight. A
   * rate at zero is not a rate -- it is a row waiting to be filled in, and the
   * card says that once rather than printing four noughts.
   */
function dashSpeedCard(model) {
    const cs = model.conditionState;
    const rows = (model.data.identity?.speeds || [])
      .map((sp, i) => ({ sp, adj: (cs.speeds || [])[i] }))
      .filter(({ sp }) => (Number(sp.final) || 0) > 0);
    const line = ({ sp, adj }) => {
      const moved = cs.changed && adj && adj.adjusted !== adj.final;
      const now = adj ? adj.adjusted : Number(sp.final) || 0;
      const value = moved
        ? `<strong class="adj ${adj.adjusted > adj.final ? 'up' : ''}"
            title="${esc(`Base ${adj.final} ft. — with ${cs.sources} applied`)}">${adj.adjusted} ft.</strong>`
        : `<strong>${now} ft.</strong>`;
      return lineHtml(sp.type || 'Movement',
        `${value} <span class="dim">×2 ${now * 2} · run ${now * 4}</span>`, true);
    };
    return `<section class="panel">
      <h3>Movement</h3>
      ${rows.length ? rows.map(line).join('')
    : '<p class="empty">No movement rates yet — the Speed panel on the build Overview takes them.</p>'}
      ${rows.length ? '<p class="hint">×2 is a double move, and as far as a charge reaches; run is ×4 — ×3 in heavy armour or under a heavy load.</p>' : ''}
    </section>`;
  }

  /** The skills that come up, best first; Expand lists every trained one. */
function dashSkillsCard(model, openNow) {
    const cs = model.conditionState;
    const all = (model.data.skills || []).map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden);
    const byBonus = (a, b) => (Number(b.s.bonus) || 0) - (Number(a.s.bonus) || 0);
    const trained = all.filter(({ s }) => (Number(s.totalRanks) || 0) > 0).sort(byBonus);
    const pool = trained.length ? trained : [...all].sort(byBonus);
    const rows = openNow ? pool : pool.slice(0, 6);
    // The same delta the d20 copy applies: the flat skill-check penalty plus
    // whatever the skill's own ability lost or gained.
    const row = ({ s, i }) => {
      const delta = cs.changed
        ? statModDelta(cs.deltas || {}, (s.abilities || [])[0], null) + (cs.delta.skills || 0) : 0;
      const shown = delta
        ? `<strong class="adj ${delta > 0 ? 'up' : ''}" title="${esc(`Base ${fmt(s.bonus)} — with ${cs.sources} applied`)}">${fmt((Number(s.bonus) || 0) + delta)}</strong>`
        : fmt(s.bonus);
      return `<div class="statline">
      <span class="label">${esc(skillLabel(s.name, s.spec) || s.name || '—')}</span>
      <span class="value rollpair">${shown}${rollButton(model, 'skill', i, `a ${skillLabel(s.name, s.spec) || 'skill'} check`, cs)}</span>
    </div>`;
    };
    return `<section class="panel">
      <h3>Key skills ${dashExpand('skills', openNow)}</h3>
      <div class="rowlist">${rows.map(row).join('') || '<p class="empty">No skills yet.</p>'}</div>
      <p class="hint">${trained.length} trained · ${openNow ? 'all of them above'
    : `the top ${Math.min(6, pool.length)} by bonus`} — ranks are spent on the Skills tab.</p>
    </section>`;
  }

  /** Player-written reminders of what is running. They move no numbers. */
function dashEffectsCard(model) {
    const effects = model.data.effects || [];
    const row = (x, i) => `<div class="effectrow${x.on === false ? ' off' : ''}">
      <div class="pair">
        ${itemCheck('effects', i, 'on', x.on !== false)}
        ${itemText('effects', i, 'name', x.name, 'Watching the north door')}
        <button class="danger" data-remove="effects|${i}" aria-label="Remove effect">×</button>
      </div>
      ${itemText('effects', i, 'note', x.note, 'the detail worth remembering')}
    </div>`;
    return `<section class="panel">
      <h3>Active effects</h3>
      <div class="effectlist">${effects.map(row).join('') || '<p class="empty">Nothing running.</p>'}</div>
      <div style="margin-top:8px">${addButton('effects', 'Add effect', { name: '', note: '', on: true })}</div>
      <p class="hint">Reminders, not rules: these move no numbers. A bonus with numbers
        behind it belongs in <strong>Buffs</strong> above, where it moves everything.</p>
    </section>`;
  }

  /** Damage, healing and the night's rest, one field and three buttons. */
function dashQuickCard(model, ctx) {
    const hp = model.hpState;
    return `<section class="panel span2">
      <h3>Quick actions</h3>
      <div class="pair" style="flex-wrap:wrap">
        <input type="number" min="0" data-draft="quickHp" value="${esc(ctx.draft.quickHp ?? '')}"
          placeholder="Amount" style="width:5.5rem" aria-label="Hit points to apply">
        <button data-action="quick-damage"
          title="Temporary hit points absorb first; the rest comes off current">Damage</button>
        <button data-action="quick-heal"
          title="Current climbs to the maximum, and the same points erase nonlethal">Heal</button>
        <span class="dashsep" aria-hidden="true"></span>
        <button data-action="quick-rest"
          title="Every tracker with a daily refresh goes back to unspent. Slots and pools with other rhythms are yours to move.">Rest</button>
      </div>
      <p class="hint">HP ${(() => {
    const cs = model.conditionState;
    const maxNow = cs.changed && cs.delta.hp ? cs.adjusted.hp : hp.max;
    return `${Math.min(hp.current, maxNow)}/${maxNow}`;
  })()}${hp.temp ? ` (+${hp.temp} temp)` : ''}${hp.nonlethal
    ? ` · ${hp.nonlethal} nonlethal` : ''} — the strip above follows along.</p>
    </section>`;
  }

  /**
   * Vancian, as the table spends it: a row per casting class with its slot
   * pips (spontaneous and hybrid casters), then the prepared list with its
   * squares -- the same paths the Vancian tab writes, so the two views are one
   * pool. Tables, DCs and known lists stay on the tab.
   */
function dashVancianCard(model) {
    const v = model.data.vancian;
    const classes = v?.classes || [];
    if (!classes.length) {
      return `<section class="panel"><h3>Spells &amp; slots</h3>
        <p class="empty">No casting classes yet — the Vancian tab starts one.</p></section>`;
    }
    const classRow = (c, ci) => {
      const base = `vancian.classes.${ci}`;
      const spends = prepStyle(c.prep).slots === 'pool';
      const noun = c.noun || castingNoun(c.source);
      const levels = (c.spells || []).map((s, si) => {
        if (!s.slots || s.atWill) return '';
        return `<span class="dashslot"><span class="dim">L${s.level}</span>${spends
          ? slotSpend({ path: `${base}.spells|${si}|used`, total: s.slots, left: s.left, name: `${noun.one} level ${s.level}` })
          : `<span class="pool">${s.slots}/day</span>`}</span>`;
      }).filter(Boolean).join('');
      return `<div class="dashcaster">
        <span class="tname">${esc(c.name || 'Casting class')} <span class="dim">CL ${c.casterLevel ?? 0}</span></span>
        <span class="dashslots">${levels || '<span class="empty">no slots at this level</span>'}</span>
        ${rollButton(model, 'concentration', `vancian:${ci}`, `${c.name || 'this class'} concentration`)}
      </div>`;
    };
    const prepared = (v.prepared || []).map((r, i) => ({ r, i })).filter(({ r }) => r.name);
    // Spell rows pack into columns, and every row's squares start at the same
    // left edge -- pip one top-left, filling rightward, whatever the count.
    const prow = ({ r, i }) => `<div class="dashspell">
      <span class="sname" title="${esc(r.note ? `${r.name} — ${proseText(model, r.note)}` : r.name)}">${esc(r.name)}${r.classLevel ? ` <span class="dim">${esc(r.classLevel)}</span>` : ''}</span>
      <span class="suses">${slotSpend({ path: `vancian.prepared|${i}|used`, total: r.uses, left: r.left, shape: 'squares', name: r.name })
        || '<span class="dim">—</span>'}</span>
    </div>`;
    return `<section class="panel span2">
      <h3>Spells &amp; slots
        ${v.calc?.spent ? `<span class="badge">${v.calc.spent} spent today</span>` : ''}
        <button style="margin-left:auto" data-action="vancian-new-day"
          title="Everything spent comes back">New day</button>
      </h3>
      ${classes.map(classRow).join('')}
      ${prepared.length ? `<div class="dashspells">${prepared.map(prow).join('')}</div>` : ''}
      <p class="hint">Pips spend an anonymous slot; squares spend a prepared casting —
        the Vancian tab holds the tables, DCs and spell lists.</p>
    </section>`;
  }

  /** The day's power points, spendable in place; the tab holds the powers. */
function dashPsionicsCard(model) {
    const p = model.data.psionics;
    const pool = Number(p?.pool) || 0;
    if (!p || (!pool && !(p.classes || []).length)) {
      return `<section class="panel"><h3>Power points</h3>
        <p class="empty">No manifesting classes yet — the Psionics tab starts one.</p></section>`;
    }
    const left = Number(p.left) || 0;
    return `<section class="panel">
      <h3>Power points <span class="badge">${left} of ${pool}</span>
        <button class="linkish" style="margin-left:auto" data-action="psionics-new-day"
          title="The whole pool comes back">New day</button>
      </h3>
      ${meterVisual(model.meterSpec('pp'))}
      <div class="tracker-controls" style="margin-top:6px">
        <button data-pool-step="-1" aria-label="Spend one power point">−</button>
        <input type="number" value="${left}" data-pool-left aria-label="Power points remaining">
        <span class="pool">/ ${pool}</span>
        <button data-pool-step="1" aria-label="Restore one power point">+</button>
      </div>
    </section>`;
  }

  /** A DC as it stands right now: buffed values replace the base, base in the tooltip. */
function dcShown(model, base) {
    const cs = model.conditionState;
    const d = cs.changed ? (cs.delta.dc || 0) : 0;
    if (!d) return `${base ?? 0}`;
    return `<strong class="adj ${d > 0 ? 'up' : ''}"
      title="${esc(`Base ${base ?? 0} — with ${cs.sources} applied`)}">${(Number(base) || 0) + d}</strong>`;
  }

  /**
   * The six abilities with their check d20s -- Strength to force a door, an
   * Intelligence check to recall. Scores and modifiers show what conditions
   * and buffs leave them at, the same read as everywhere else.
   */
function dashAbilitiesCard(model) {
    const c = model.data;
    const cs = model.conditionState;
    const row = (k) => {
      const a = c.abilities[k] || {};
      const baseScore = Number(a.tempScore) || 0;
      const score = cs.changed ? (cs.scores[k] ?? baseScore) : baseScore;
      // The same sum the d20 copy rolls: the ability's own movement plus the
      // flat penalty on ability checks (a negative level's, say).
      const delta = cs.changed ? (cs.deltas[k] || 0) + (cs.delta.abilityChecks || 0) : 0;
      const mod = (Number(a.totalMod) || 0) + delta;
      const movedScore = score !== baseScore;
      return `<div class="statline">
        <span class="label"><span class="abmark" data-ab="${k}">${ABILITY_LABELS[k]}</span>
          <span class="dim">${movedScore
    ? `<strong class="adj ${score > baseScore ? 'up' : ''}" title="${esc(`Base ${baseScore} — with ${cs.sources} applied`)}">${score}</strong>` : score}</span></span>
        <span class="value rollpair">${delta
    ? `<strong class="adj ${delta > 0 ? 'up' : ''}" title="${esc(`Base ${fmt(a.totalMod)} — with ${cs.sources} applied`)}">${fmt(mod)}</strong>`
    : fmt(a.totalMod)}${rollButton(model, 'ability', k, `a ${ABILITY_LABELS[k]} check`, cs)}</span>
      </div>`;
    };
    return `<section class="panel">
      <h3>Ability checks</h3>
      <div class="rowlist">${ABILITIES.map(row).join('')}</div>
    </section>`;
  }

  /** The Spheres casting figures a round actually asks for, with the concentration d20. */
function dashSpheresCard(model) {
    const t = model.data.training || {};
    const m = t.magic;
    if (!m) {
      return `<section class="panel"><h3>Casting numbers</h3>
        <p class="empty">No magic training — the Magic Spheres tab starts it.</p></section>`;
    }
    return `<section class="panel">
      <h3>Casting numbers</h3>
      ${line('Caster level', m.globalCL ?? 0)}
      ${lineHtml('Concentration', `<span class="rollpair">${fmt(m.concentration ?? 0)}${
        rollButton(model, 'concentration', 'magic', 'a concentration check')}</span>`, true)}
      ${line('MSB / MSD', `${fmt(m.msb ?? 0)} / ${m.msd ?? 0}`)}
      ${lineHtml('Save DC', dcShown(model, m.globalDC), true)}
      ${line('Spell points', `${m.availableSP ?? m.totalSP ?? 0} of ${m.totalSP ?? 0}`)}
      ${t.combat ? lineHtml('Practitioner DC', dcShown(model, t.combat.practitionerDC), true) : ''}
      <p class="hint">Points spent in play live on their tracker in Resources; the
        talents are on Magic Spheres.</p>
    </section>`;
  }

  /** Every shaped veil at a glance: slot, essence invested, save DC -- buffed values in place. */
function dashVeilsCard(model) {
    const a = model.data.akashic;
    const cs = model.conditionState;
    const holders = [...(a?.slots || []), ...(a?.kheshig || [])];
    const shaped = holders.flatMap((s) => (s.veils || []).map((v) => ({ slot: s.slot, v })));
    const dEss = cs.changed ? (cs.delta.essence || 0) : 0;
    const free = Number(a?.calc?.free) || 0;
    const total = Number(a?.calc?.total) || 0;
    const pool = dEss
      ? `<strong class="adj ${dEss > 0 ? 'up' : ''}" title="Base ${free} free of ${total} — with buffs; investment math stays on the Akashic tab">${free + dEss} free of ${total + dEss}</strong>`
      : `${free} free of ${total}`;
    return `<section class="panel">
      <h3>Veils shaped ${shaped.length ? `<span class="badge">${shaped.length}</span>` : ''}</h3>
      ${total || dEss ? lineHtml('Essence', pool, true) : ''}
      <div class="rowlist">${shaped.map(({ slot, v }) => `<div class="statline">
        <span class="label" title="${esc(v.name || '')}">${esc(v.name || '—')} <span class="dim">${esc(slot || '')}</span></span>
        <span class="value">${Number(v.essence) ? `${v.essence} essence · ` : ''}DC ${dcShown(model, v.dc)}</span>
      </div>`).join('') || '<p class="empty">No veils shaped — the Akashic tab is where they go on.</p>'}</div>
    </section>`;
  }

  /**
   * What is readied, by discipline, each under what the player wrote about it
   * on the Maneuvers tab ({…} formulas resolve). The ticks themselves live on
   * the tab.
   *
   * Two lines under a name at most: the header cells run together as one, and
   * the description gets its own. A card that reprinted the whole entry would
   * be the tab again, and the point of the tab is that it is somewhere else.
   */
function dashManeuversCard(model) {
    const m = model.data.maneuvers;
    const disciplines = (m?.disciplines || [])
      .map((d) => ({ ...d, readied: (d.entries || []).filter((e) => e.known) }))
      .filter((d) => d.readied.length);
    const shown = (text) => (hasTokens(text) ? renderedProse(model, text) : esc(text));
    const row = (d, e) => {
      const entry = maneuverDetails(d, e.name, e);
      // A save of "None" is a cell the player answered, not a fact worth a
      // line here; a DC without one still is.
      const save = [entry.save === 'None' ? '' : entry.save, entry.dc.trim() ? `DC ${entry.dc}` : '']
        .filter(Boolean).join(' ');
      const head = ['action', 'range', 'target', 'duration']
        .map((k) => entry[k].trim()).concat(save).filter(Boolean);
      return `<div class="statline">
        <span class="label" title="${esc(e.name)}${entry.type || e.type ? ` — ${esc(entry.type || e.type)}` : ''}">${esc(e.name)}</span>
        <span class="value dim">${e.kind === 'stance' ? 'stance' : `L${e.level ?? '—'}`}</span>
      </div>
      ${head.length ? `<div class="dashtalent mnote">${head.map(shown).join(' · ')}</div>` : ''}
      ${entry.text ? `<div class="dashtalent mnote" title="${esc(entry.text)}">${shown(entry.text)}</div>` : ''}`;
    };
    return `<section class="panel">
      <h3>Readied maneuvers</h3>
      ${disciplines.map((d) => `
        <h4 class="subhead">${esc(d.name)}</h4>
        <div class="rowlist">${d.readied.map((e) => row(d, e)).join('')}</div>`).join('')
    || '<p class="empty">Nothing readied — tick maneuvers on the Maneuvers tab.</p>'}
    </section>`;
  }

  /**
   * The sphere talents, one clamped line each, grouped by side -- a reference
   * the table can scan without opening the training grids.
   */
function dashTalentsCard(model) {
    const t = model.data.training || {};
    const line = (text) => `<div class="dashtalent" title="${esc(text)}">${hasTokens(text)
      ? renderedProse(model, text) : esc(text)}</div>`;
    const side = (key, label) => {
      const s = t[key];
      if (!s) return '';
      const texts = [];
      for (const cls of s.classes || []) {
        if (cls.blendedMirror) continue;
        for (const lv of cls.levels || []) {
          const v = String(lv.talent || '').trim();
          if (v) texts.push(v);
        }
      }
      for (const b of s.bonusTalents || []) {
        const v = String(b.talent || '').trim();
        if (v) texts.push(v);
      }
      for (const e of s.tradition?.entries || []) {
        const v = String(e.talent || '').trim();
        if (v) texts.push(v);
      }
      if (!texts.length) return '';
      return `<h4 class="subhead">${label} <span class="badge">${texts.length}</span></h4>
        ${texts.map(line).join('')}`;
    };
    const body = `${side('combat', 'Combat')}${side('magic', 'Magic')}`;
    return `<section class="panel">
      <h3>Talents</h3>
      ${body || '<p class="empty">No talents yet — they are written on Martial and Magic Spheres.</p>'}
      ${body ? '<p class="hint">Hover a line for its full text; the training grids are on Martial and Magic Spheres.</p>' : ''}
    </section>`;
  }


function detailsPanel(model) {
    const c = model.data;
    return `<section class="panel details">
      <h3>Details</h3>
      <div class="fieldgrid">
        ${field('Character name', text('identity.name', c.identity.name))}
        ${field('Player', text('identity.player', c.identity.player))}
        ${field('Race', text('identity.race', c.identity.race))}
        ${field('Variant', text('identity.variant', c.identity.variant))}
        ${field('Level', num('identity.level', c.identity.level))}
        ${field('Size', select('identity.size', c.identity.size, Object.keys(SIZE_MODIFIERS)))}
        ${field('Alignment', text('identity.alignment', c.identity.alignment))}
        ${field('Deity', text('identity.deity', c.identity.deity))}
        ${field('Gender', text('identity.gender', c.identity.gender))}
        ${field('Age', text('identity.age', c.identity.age))}
        ${field('Height', text('identity.height', c.identity.height))}
        ${field('Weight', text('identity.weight', c.identity.weight))}
        ${field('Mythic path', text('identity.mythicPath', c.identity.mythicPath))}
        ${field('Mythic tier (auto)', `<span class="value" title="From level; override on Feats & Mythic">${c.identity.mythicTier ?? 0}</span>`)}
        ${field('Hero points', `<span class="pair">
          ${num('identity.heroPoints.current', c.identity.heroPoints?.current ?? 0)}
          <span>/</span>${num('identity.heroPoints.max', c.identity.heroPoints?.max ?? 3)}</span>`)}
        ${field('Portrait URL', text('identity.image', c.identity.image, 'https://…'), 'wide')}
      </div>
      ${characterColorRow(c.identity.color)}
    </section>`;
  }

  /**
   * The character's own colour.
   *
   * It is applied as the sheet's accent, which is the one colour every
   * unstyled thing already reads -- panel headings, pips, the marks on
   * formula fields -- so choosing it here colours the character everywhere
   * without a second setting. Blank keeps the theme's own gold.
   */
function characterColorRow(value) {
    const hex = normalizeHex(value);
    return `<div class="tstyle-row charcolor">
      <span class="tlabel">Character colour</span>
      <div class="swatches" role="group" aria-label="Character colour">
        <button class="swatch none" data-charswatch data-hex=""
          title="Theme default" aria-label="Theme default" aria-pressed="${hex ? 'false' : 'true'}"></button>
        ${TRACKER_PALETTE.map(([h, name]) => `<button class="swatch" data-charswatch data-hex="${h}"
          style="background:${h}" title="${esc(name)} ${h}" aria-label="${esc(name)}"
          aria-pressed="${hex === h ? 'true' : 'false'}"></button>`).join('')}
      </div>
      <input class="mono hexin" data-charhex value="${esc(hex || '')}" placeholder="#rrggbb"
        maxlength="7" aria-label="Character colour hex">
      <input type="color" data-charpick value="${esc(hex || THEME_ACCENT.hex)}" aria-label="Character colour picker">
      <span class="hint">Tints the whole sheet, and is what an unstyled tracker or meter is drawn in.</span>
    </div>`;
  }

  /**
   * A labelled band of panels, foldable down to its label.
   *
   * Defenses and Offenses are the two tallest things on the Overview and the
   * two a player is least often here to edit -- on a phone they are most of
   * the scrolling between the top of the tab and everything under them. The
   * fold uses the same key store and the same button as every panel's own, so
   * a band left shut stays shut and travels with the character.
   */
function supergroup(model, key, title, bodyClass, body) {
    const shut = isCollapsed(model, `sg-${key}`);
    return `<div class="supergroup span2${shut ? ' collapsed' : ''}" aria-label="${esc(title)}">
        <div class="supergroup-title">${esc(title)} ${foldButton(model, `sg-${key}`)}</div>
        ${shut ? '' : `<div class="supergroup-body ${bodyClass}">${body}</div>`}
      </div>`;
  }

  /**
   * The specialty: what the character did before, the feat it grants and its
   * perks. The feat is the same field as the Granted feats row on Feats &
   * Mythic -- one home, seen from two places.
   *
   * Two perks, always. A specialty grants the pair; there is no order to them
   * and neither is optional, so the row carries no arrows and no cross -- and
   * nothing offers to add a third. A document that arrived with more shows
   * them all rather than hiding what it holds.
   */
function specialtyPanel(model) {
    const c = model.data;
    const perks = c.identity.specialtyPerks || [];
    const slots = Math.max(2, perks.length);
    return `<section class="panel">
      <h3>Specialty</h3>
      <div class="fieldgrid two">
        ${field('Specialty', text('identity.specialty', c.identity.specialty, 'Chef, Gambling Villain…'))}
        ${field('Specialty feat', text('grantedFeats.specialty.name', c.grantedFeats?.specialty?.name, 'Which feat?'))}
      </div>
      <div class="perkfields">
        ${Array.from({ length: slots }, (_, i) => `<label class="fld">
          <span>Perk ${i + 1}</span>
          ${prose(model, `data-item="identity.specialtyPerks|${i}|self"`, perks[i] ?? '', 1, 'grow')}
        </label>`).join('')}
      </div>
      <p class="hint">The specialty feat is also listed under <strong>Granted feats</strong>
        on Feats &amp; Mythic; the three specialty skills are chosen on the Skills tab.</p>
    </section>`;
  }

  /**
   * Languages, against the slots the character has for them.
   *
   * One slot per point of Int bonus and one per Linguistics rank are the
   * rules; anything else that grants some is a number or a formula in Extra,
   * so a "+1 per two levels" stays true as the character levels.
   *
   * The list is edited once and read constantly, so folded down the panel is
   * the thing that gets read: every language the character speaks on one line,
   * in a box, ready to be copied into a post. Opened it is the fields again,
   * and the order is the player's -- a chip can be dragged past its
   * neighbours by the grip, which is what keeps the trade tongues at the front
   * and the dead ones at the back.
   */
function languagesPanel(model) {
    const c = model.data;
    const i = c.identity;
    const slots = i.languageSlots || { int: 0, linguistics: 0, extra: 0, total: 0, known: 0 };
    const langs = i.languages || [];
    const spare = slots.total - slots.known;
    const shut = !!c.uiPrefs?.collapsed?.languages;
    const spoken = [...String(i.nativeLanguages || '').split(/[,;]/), ...langs]
      .map((s) => String(s).trim()).filter(Boolean);
    const head = `<h3>Languages
        <span class="badge${spare < 0 ? ' err' : ''}" title="Known, against the slots Int, Linguistics and Extra grant">${slots.known} / ${slots.total}</span>
        <button class="disclose" data-collapse="languages" data-collapse-to="${!shut}"
          aria-expanded="${!shut}"
          title="${shut ? 'Open the list to edit it' : 'Fold it down to one line'}">${shut ? '▸' : '▾'}</button>
      </h3>`;
    if (shut) {
      /*
       * A textarea rather than an input, because an input is one line by
       * definition: a character with a good Int bonus and ranks in Linguistics
       * speaks more languages than fit across a third of a row, and the rest
       * of them scrolled out of sight with nothing to say they were there.
       *
       * It is still a form control rather than a div, because the Copy button
       * beside it reads `.value`, and because a field is what you can click
       * into and select all of. `#bindReadOnlyBoxes` sizes it to its content
       * after every render, so the box is as tall as the list and never grows
       * a scrollbar of its own.
       */
      return `<section class="panel collapsed">
        ${head}
        <div class="langcopy">
          <textarea class="ro" data-post="languages" readonly rows="1" spellcheck="false"
            placeholder="No languages yet." aria-label="Every language spoken">${esc(spoken.join(', '))}</textarea>
          <button data-copy="languages" title="Copy the whole list">Copy</button>
        </div>
      </section>`;
    }
    return `<section class="panel">
      ${head}
      <div class="fieldgrid">
        ${field('Native', text('identity.nativeLanguages', i.nativeLanguages, 'Common'))}
        ${field('From Int', `<span class="value" title="One per point of Intelligence bonus">${slots.int}</span>`)}
        ${field('From Linguistics', `<span class="value" title="One per rank">${slots.linguistics}</span>`)}
        ${field('Extra slots', exprField('data-set="identity.languageExtra"', i.languageExtra, {
          width: '100%',
          value: typeof i.languageExtra === 'string' && i.languageExtra.trim() ? slots.extra : null,
          error: slots.extraError,
          title: 'A number, or a formula — e.g. floor(level / 2)',
        }))}
      </div>
      <div class="langlist" data-langlist>
        ${langs.map((l, li) => `<span class="lang" data-langdrop="${li}">
          <span class="grip" data-langgrip title="Drag to reorder">&#10495;</span>
          ${itemText('identity.languages', li, 'self', l, 'Language')}
          <button class="danger tiny" data-remove="identity.languages|${li}" aria-label="Remove">×</button>
        </span>`).join('')}
      </div>
      <div class="pair" style="margin-top:8px">
        ${addButton('identity.languages', 'Add language', '')}
        <span class="hint">${spare > 0 ? `${spare} slot${spare === 1 ? '' : 's'} spare`
    : spare < 0 ? `${-spare} over the slots` : 'every slot used'}</span>
      </div>
      <p class="hint">Native languages are free. One slot per point of Int bonus, one per
        Linguistics rank; <strong>Extra</strong> takes a number or a formula for what a race
        or a trait adds.</p>
    </section>`;
  }


function abilityScoresPanel(model) {
    const c = model.data;
    const cs = model.conditionState;
    const built = !!c.statsBuild;
    return `<section class="panel">
      <h3>Ability scores</h3>
      <div class="ability-head">
        <span>&nbsp;</span><span>Score</span><span>Mod</span>
        <span class="h-temp">Temp</span><span class="h-temp">Mod</span><span>Roll</span>
      </div>
      <div class="abilities">
        ${ABILITIES.map((k) => {
          const a = c.abilities[k];
          const moved = cs.changed && cs.deltas[k];
          return `<div class="ability">
            <span class="ab abmark" data-ab="${k}">${ABILITY_LABELS[k]}</span>
            ${built
              ? `<span class="mod">${a.score}</span>`
              : `<input type="number" value="${a.score}" data-set="abilities.${k}.score" aria-label="${ABILITY_LABELS[k]} score">`}
            <span class="mod">${fmt(a.mod)}</span>
            ${moved
              ? `<span class="mod temp-score conditioned" title="${a.tempScore} before conditions">${cs.scores[k]}</span>`
              : built
                ? `<span class="mod temp-score">${a.tempScore}</span>`
                : `<input class="temp-score" type="number" value="${a.tempScore}" data-set="abilities.${k}.tempScore" aria-label="${ABILITY_LABELS[k]} temporary score">`}
            <span class="mod temp temp-mod${moved ? ' conditioned' : ''}"
              ${moved ? `title="${fmt(a.totalMod)} before conditions"` : ''}>${
              moved ? fmt(a.totalMod + cs.deltas[k]) : fmt(a.totalMod)}</span>
            ${rollButton(model, 'ability', k, `a ${ABILITY_LABELS[k]} check`, cs)}
          </div>`;
        }).join('')}
      </div>
      ${built ? `<p class="hint" style="margin-top:8px">
        Scores are built from point buy, race, ABP and the rest —
        edit them on the <strong>Stats</strong> tab.
      </p>` : ''}
      ${cs.changed && ABILITIES.some((k) => cs.deltas[k]) ? `<p class="hint warn">
        Scores and modifiers in red are what the ticked conditions leave —
        the temporary score less the condition's penalty, and its modifier.
      </p>` : ''}
    </section>`;
  }


function acPanel(model) {
    const d = model.data.defenses;
    const cs = model.conditionState;
    const cell = (key, base) => `<td class="num total">${movedInline(cs, key, base, String)}</td>`;
    return `<section class="panel">
      <h3>Armor class</h3>
      <div class="tablewrap"><table class="defense">
        <thead><tr><th></th><th class="num">Total</th>
          <th class="num" title="Your own flat bonus">Misc</th>
          ${sheetBonusHead()}</tr></thead>
        <tbody>
          <tr><td>Armor Class</td>${cell('ac', d.ac)}
            <td class="num">${num('defenses.miscAC', d.miscAC, 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'defenses.ac')}</tr>
          <tr><td>Touch</td>${cell('touch', d.touch)}
            <td class="num" title="Misc AC is armor-side, so it does not reach touch">—</td>
            ${sheetBonusCell(model, 'defenses.touch')}</tr>
          <tr><td>Flat-footed</td>${cell('flatFooted', d.flatFooted)}
            <td class="num">${roField(d.miscAC || 0, 'The Misc AC above — armour-side, so flat-footed keeps it', 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'defenses.flatFooted')}</tr>
          <tr><td>CMD</td>${cell('cmd', d.cmd)}
            <td class="num">${num('defenses.miscCMD', d.miscCMD, 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'defenses.cmd')}</tr>
        </tbody>
      </table></div>
      ${cs.acVsMelee || cs.acVsRanged ? `<p class="hint warn">
        ${cs.acVsMelee ? `${fmt(cs.acVsMelee)} AC against melee` : ''}${cs.acVsMelee && cs.acVsRanged ? ', ' : ''}${
          cs.acVsRanged ? `${fmt(cs.acVsRanged)} AC against ranged` : ''} from conditions, on top of the numbers above.
      </p>` : ''}
      <div class="statline"><span class="label">AC ability</span>
        <span class="value pair">${abilitySelect('defenses.acStat1', d.acStat1)}
          <span class="hint">+</span>${abilitySelect('defenses.acStat2', d.acStat2)}</span></div>
      <div class="statline"><span class="label">Uncanny dodge</span>
        <span class="value">${check('defenses.uncannyDodge', d.uncannyDodge)}</span></div>
      <div class="statline"><span class="label">Spell resistance</span>
        <span class="value">${text('defenses.spellResistance', d.spellResistance)}</span></div>
      <div class="statline"><span class="label">DR</span>
        <span class="value">${text('defenses.dr', d.dr)}</span></div>
      <div class="statline"><span class="label">Immunities</span>
        <span class="value">${text('defenses.immunities', d.immunities)}</span></div>
      <div class="statline"><span class="label">Resistance</span>
        <span class="value">${text('defenses.resistance', d.resistance)}</span></div>
      ${sheetBonusHint('Deflection, natural armor, insight and the rest')}
    </section>`;
  }


function savesPanel(model) {
    const s = model.data.saves;
    const cs = model.conditionState;
    return `<section class="panel">
      <h3>Saving throws</h3>
      <div class="tablewrap"><table class="saves">
        <thead><tr><th>Save</th><th class="num">Total</th>
          <th class="num" title="Computed from the class table (gestalt)">Base</th>
          <th>Ability</th><th title="A second ability that adds its modifier">2nd</th>
          ${sheetBonusHead()}</tr></thead>
        <tbody>${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => `
          <tr>
            <td>${label}</td>
            <td class="num total"><span class="rollpair">${movedInline(cs, k, s[k].total)}${
  rollButton(model, 'save', k, `a ${label} save`, cs)}</span></td>
            <td class="num" title="From the Classes table">${s[k].base}</td>
            <td>${abilitySelect(`saves.${k}.stat1`, s[k].stat1)}</td>
            <td>${abilitySelect(`saves.${k}.stat2`, s[k].stat2)}</td>
            ${sheetBonusCell(model, `saves.${k}.total`)}
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Base saves follow the Classes table.</p>
      ${sheetBonusHint('Resistance bonuses, ABP and traits')}
    </section>`;
  }


function attackPanel(model) {
    const c = model.data;
    const cs = model.conditionState;
    return `<section class="panel">
      <h3>Attack</h3>
      ${lineHtml('Melee', `${movedInline(cs, 'melee', c.attack.totalMelee)}${
        rollButton(model, 'mode', 'melee', 'a melee attack', cs)}`, true)}
      ${lineHtml('Ranged', `${movedInline(cs, 'ranged', c.attack.totalRanged)}${
        rollButton(model, 'mode', 'ranged', 'a ranged attack', cs)}`, true)}
      ${lineHtml('CMB', `${movedInline(cs, 'cmb', c.attack.totalCmb)}${
        rollButton(model, 'mode', 'cmb', 'a combat maneuver', cs)}`, true)}
      ${line('Iteratives', c.attack.iterative)}
      ${(() => {
    // BAB comes off the class table now, gestalt-style, so the field is a
    // read-out with an override behind it -- the same arrangement as a class's
    // Levels, and for the same reason.
    const base = Number(c.attack.babBase) || 0;
    const over = c.attack.babOverride == null ? null : Number(c.attack.babOverride);
    const why = over == null
      ? `From the Classes table: the best BAB progression among the classes on each level, summed and floored. Type a number to override it.`
      : `Pinned at ${over}. The Classes table comes to ${base}; clear the box to go back to that.`;
    return lineHtml('Base attack bonus', `<input type="number"
      class="autonum${over == null ? ' auto' : ''}" value="${over ?? ''}" placeholder="${base}"
      data-set="attack.babOverride" data-kind="number-or-null" style="width:4.2rem"
      title="${esc(why)}" aria-label="Base attack bonus">`);
  })()}
      ${editLine('Misc attack bonus', 'attack.miscBonus', c.attack.miscBonus)}
      ${cs.changed && cs.delta.damage ? `<p class="hint warn">${fmt(cs.delta.damage)} on weapon damage rolls from ${cs.sources}.</p>` : ''}
      <div class="tablewrap" style="margin-top:8px"><table class="attackmodes">
        <thead><tr><th>Mode</th>
          <th class="num" title="An alternate is this attack with the ability beside it in the slot instead">Total</th>
          ${sheetBonusHead()}
          <th>Ability</th><th>2nd ability</th></tr></thead>
        <tbody>${ATTACK_MODES.map((k) => {
          const alt = ALT_ATTACK_OF[k];
          const shut = !!model.data.uiPrefs?.collapsed?.[`atk:${alt || k}`];
          // An alternate is folded into the attack it is an alternate of: the
          // caret is on that row and says what is under it, so a sheet with
          // nothing but a finesse swap does not carry six rows to say three.
          if (alt && shut) return '';
          const total = attackModeTotal(c, k) ?? 0;
          const delta = cs.changed && cs.delta[k] ? cs.delta[k] : 0;
          const altOf = ATTACK_MODES.find((m) => ALT_ATTACK_OF[m] === k);
          const altTotal = altOf ? attackModeTotal(c, altOf) ?? 0 : 0;
          const altStat = altOf ? (c.attack.modes[altOf]?.stat1 || '—') : '';
          const caret = altOf ? `<button class="disclose" data-collapse="atk:${k}"
            data-collapse-to="${!shut}"
            aria-expanded="${!shut}" title="${esc(shut
    ? `Show the alternate — ${altStat}, ${fmt(altTotal)}`
    : 'Fold the alternate back in')}">${shut ? '▸' : '▾'}</button>` : '';
          // An alternate is the base attack with one ability swapped, so it
          // is already carrying the base's Other -- editing it here would be
          // editing the same number twice.
          const other = alt
            ? `<td class="num"><span class="hint" title="${esc(`Shares ${ATTACK_MODE_LABELS[alt]}'s — an alternate is that attack with a different ability in the slot`)}">as ${esc(ATTACK_MODE_LABELS[alt].toLowerCase())}</span></td>`
            : sheetBonusCell(model, ATTACK_MODE_KEY[k]);
          return `
          <tr class="${alt ? 'altrow' : ''}"><td>${caret}${ATTACK_MODE_LABELS[k]}</td>
            <td class="num total"><span class="rollpair">${movedInline(cs, k, total)}${
  rollButton(model, 'mode', k, `${ATTACK_MODE_LABELS[k].toLowerCase()} attacks`, cs)}</span></td>
            ${other}
            <td>${abilitySelect(`attack.modes.${k}.stat1`, c.attack.modes[k]?.stat1)}</td>
            <td>${abilitySelect(`attack.modes.${k}.stat2`, c.attack.modes[k]?.stat2)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">Base attack bonus is the Classes table's, gestalt-style: the best
        progression among the classes present at each level, summed and floored once.
        An <strong>alternate</strong> is the same attack with a different
        ability in the slot — Dex for a finessed blade, Wis for a monk's fist — so it
        carries the same BAB, misc and size, and the same import reconciliation. Each one
        folds into the attack it belongs to; the caret says what is under it.</p>
      ${sheetBonusHint('a weapon’s enhancement, a size bonus, anything a talent added')}
    </section>`;
  }

  /**
   * Movement, with the bonus as a formula field.
   *
   * The bonus is where class features land -- fast movement, a boots-of-
   * striding enhancement -- and those are rules, so the field takes one:
   * `floor(level / 3) * 10` stays right as the character levels. The final
   * column is the model's, so it moves the moment either field does.
   */
function speedPanel(model) {
    const c = model.data;
    const cs = model.conditionState;
    const speeds = c.identity.speeds || [];
    return `<section class="panel">
      <h3>Speed</h3>
      <div class="tablewrap"><table class="speeds">
        <thead><tr><th>Type</th><th class="num">Base</th>
          <th class="num" title="A number, or a formula — e.g. floor(level / 3) * 10">Bonus</th>
          <th class="num">Final</th><th></th></tr></thead>
        <tbody>${speeds.map((sp, i) => {
          const adj = cs.speeds[i];
          const slowed = cs.changed && adj && adj.adjusted !== adj.final;
          return `<tr>
          <td>${itemText('identity.speeds', i, 'type', sp.type, 'Land')}
            <div class="hint speedname">${sp.handle
    ? `<code>${esc(sp.handle)}</code>`
    : 'name it to use it in a formula'}</div></td>
          <td class="num">${itemNum('identity.speeds', i, 'base', sp.base)}</td>
          <td class="num">${exprField(`data-item="identity.speeds|${i}|bonus"`, sp.bonus, {
            width: '5.6rem',
            value: typeof sp.bonus === 'string' && sp.bonus.trim() ? sp.bonusNum : null,
            error: sp.bonusError,
            title: 'A number, or a formula — e.g. floor(level / 3) * 10 for fast movement',
          })}</td>
          <td class="num total">${slowed
    ? `<strong class="adj ${adj.adjusted > adj.final ? 'up' : ''}"
        title="${esc(`Base ${adj.final} ft. — with ${cs.sources} applied`)}">${adj.adjusted} ft.</strong>`
    : `${Number(sp.final) || 0} ft.`}${(() => {
    // Under the total rather than beside it: the panel is one of the narrow
    // ones, and a badge on the same line pushes the column wider for every
    // character, including the ones with nothing forwarded anywhere.
    const badge = forwardedBadge(model, sp.handle);
    return badge ? `<div class="speedfwd">${badge}</div>` : '';
  })()}</td>
          <td class="tools quiet">${rowRemoveButton('identity.speeds', i, `Remove ${sp.type || 'this movement'}`)}</td>
        </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton('identity.speeds', 'Add movement', { type: '', base: 30, bonus: 0 })}</div>
      <p class="hint">Bonus takes a formula, so fast movement can be written as the rule
        it is — <code>floor(level / 3) * 10</code> — and keep up with the level.
        Each rate answers to the name under its type: a formula anywhere reads
        <code>speed.land</code>, and a feature elsewhere sends a bonus here with
        <code>{speed.land += 10}</code> or <code>{speed += 10}</code> for every speed you
        have. A rate may read the rates above it — a fly speed written
        <code>speed.land</code> follows the land speed — and not the ones below.</p>
    </section>`;
  }

  /**
   * Weapon and armor proficiencies, as the lists a class hands them out in.
   *
   * The weapon side is the same four terms the Gear weapon rows carry --
   * familiarity, handedness, weapon group, and the weapon itself -- so a row
   * there can be read against this and say when it is not covered. Armor is
   * its weights and shields their kinds; the chips are toggles, and specific
   * weapons are typed in like languages.
   */
function proficienciesPanel(model) {
    const p = model.data.identity.proficiencies || {};
    const chips = (list, options, title = '') => `<div class="chips" role="group"${title ? ` aria-label="${esc(title)}"` : ''}>
      ${options.map((o) => `<button class="chip-toggle" data-action="prof-toggle" data-list="${list}"
        data-value="${esc(o)}" aria-pressed="${(p[list] || []).includes(o)}">${esc(o)}</button>`).join('')}
    </div>`;
    const row = (label, body, hint = '') => `<div class="profrow">
      <span class="tlabel"${hint ? ` title="${esc(hint)}"` : ''}>${esc(label)}</span>${body}</div>`;
    const weapons = p.weapons || [];
    const named = weapons.filter((w) => String(w).trim());
    // The named weapons are a list a race or a class hands over once and then
    // nobody edits again, and it is the longest thing in the panel. Folded
    // away it is a sentence; opened it is the fields it was.
    const wkey = 'prof-weapons';
    const wshut = !!model.data.uiPrefs?.collapsed?.[wkey];
    const summary = [
      ...(p.familiarities || []).map((f) => `${f.toLowerCase()} weapons`),
      ...(p.handedness || []).map((h) => `${h.toLowerCase()} weapons`),
      ...(p.groups || []).map((g) => `${g.toLowerCase()} group`),
      ...named,
    ];
    return `<section class="panel proficiencies">
      <h3>Proficiencies</h3>
      <div class="profgrid">
        <div class="profcol">
          <h4>Weapons</h4>
          ${row('Familiarities', chips('familiarities', WEAPON_FAMILIARITY, 'Weapon familiarities'), 'Simple, martial and exotic — the categories a class grants whole')}
          ${row('Handedness', chips('handedness', WEAPON_HANDEDNESS, 'Weapon handedness'), '"All light weapons", "all one-handed weapons" — as some classes and traits grant them')}
          ${row('Weapon groups', chips('groups', WEAPON_GROUPS.filter((g) => g !== 'Veil'), 'Weapon groups'), 'The fighter weapon groups')}
        </div>
        <div class="profcol">
          <h4>Armor</h4>
          ${row('Armor', chips('armor', ARMOR_PROFICIENCIES, 'Armor proficiencies'), 'Unarmored is its own proficiency in some systems; light, medium and heavy are the weights')}
          <h4>Shields</h4>
          ${row('Shields', chips('shields', SHIELD_PROFICIENCIES, 'Shield proficiencies'), '"None" is a statement — ticking it clears the kinds, and a kind clears it')}
          <label class="fld" style="margin-top:8px"><span>Notes
            <span class="hint">— anything the lists cannot say</span></span>
            ${area('identity.proficiencies.notes', p.notes, 2)}</label>
        </div>
      </div>
      <!-- The named weapons take the whole panel rather than half of it: a
           race's list runs to a dozen, and a dozen chips in a half-width
           column is a dozen rows. -->
      <div class="profrow profwide">
        <span class="tlabel" title="Weapons named one by one — a race's or a class's list">
          <button class="disclose" data-collapse="${wkey}" data-collapse-to="${!wshut}"
            aria-expanded="${!wshut}"
            title="${wshut ? 'Expand' : 'Collapse'}">${wshut ? '▸' : '▾'}</button>
          Specific weapons ${named.length ? `<span class="badge">${named.length}</span>` : ''}
        </span>
        <div class="profweaponbody">
          ${wshut
    ? `<span class="profnamed" title="Click the caret to edit them">${named.length
      ? esc(named.join(', ')) : 'none named'}</span>`
    : `<div class="langlist proflist">
            ${weapons.map((w, i) => `<span class="lang">
              ${itemText('identity.proficiencies.weapons', i, 'self', w, 'Weapon')}
              <button class="danger tiny" data-remove="identity.proficiencies.weapons|${i}" aria-label="Remove">×</button>
            </span>`).join('')}
            ${addButton('identity.proficiencies.weapons', 'Add weapon', '')}
          </div>`}
        </div>
      </div>
      <p class="hint">${summary.length
    ? `Proficient with ${esc(summary.join(', '))}. `
    : 'No weapon proficiencies recorded. '}A weapon on Equipment is read against these — by its
        familiarity, handedness, group, name and <strong>As</strong> (the base weapon it is) — and marked
        when nothing covers it; a veil weapon is proficient by the [Enhanced] rule, and a row's own
        <strong>Proficient</strong> field overrides all of it for Custom Training and the like. The −4 stays yours to write.</p>
    </section>`;
  }


function carryPanel(model) {
    const c = model.data;
    return `<section class="panel">
      <h3>Carrying capacity</h3>
      ${['light', 'medium', 'heavy', 'offGround', 'pushDrag'].map((k) => line(
        k === 'offGround' ? 'Off ground' : k === 'pushDrag' ? 'Push / drag' : k[0].toUpperCase() + k.slice(1),
        c.carry?.[k] != null ? `${c.carry[k]} lbs` : '—',
      )).join('')}
      ${line('Currently carried', `${c.carry?.carried ?? 0} lbs`)}
      ${editLine('Ant Haul multiplier', 'carry.antHaul', c.carry?.antHaul ?? 1)}
      ${editLine('Carry Str bonus', 'carry.strBonus', c.carry?.strBonus ?? 0)}
      <div class="statline"><span class="label">Quadruped</span>
        <span class="value">${check('carry.quadruped', c.carry?.quadruped)}</span></div>
    </section>`;
  }

  /* ---------------- classes (gestalt) ---------------- */

  /**
   * The class table, and the levels each class actually runs for.
   *
   * Levels is a read-out before it is a field: the number is how often the
   * Planner features that class at or below the character's own level, which
   * is what every other tab means by "class level". Left alone it stays that
   * count and moves when the Planner does; a number typed in pins it instead,
   * and clearing the box hands it back.
   *
   * The gestalt summary under the table is for a character running more than
   * one class track. On a single track there is no best-of to take, so the
   * same three numbers are said without the gestalt language.
   */
function classesPanel(model, ctx) {
    const c = model.data;
    const g = c.gestalt || { saves: {} };
    const sv = (k) => g.saves?.[k] || {};
    const level = Number(c.identity.level) || 0;
    const gestalt = (c.progression?.tracks ?? 1) > 1;
    // The sub-system picker: a row of toggles under the class it belongs to.
    // Marking a system badges its tabs in the ⚙ manager and puts them on the
    // session view's bar before anything is typed into them.
    const sysButton = (x, i) => {
      const n = (x.systems || []).length;
      const open = ctx.openClassSystems === i;
      return `<button data-action="class-systems" data-index="${i}" aria-expanded="${open}"
        title="Mark the sub-systems this class uses — they light their tabs up in the ⚙ manager and on the session view">
        ${open ? '▾' : '▸'} ${n || '—'}</button>`;
    };
    const sysPicker = (x, i) => {
      if (ctx.openClassSystems !== i) return '';
      const on = new Set(x.systems || []);
      const known = new Set(GAME_SYSTEMS.map((s) => s.id));
      const extra = [...on].filter((id) => !known.has(id));
      return `<tr class="syspicker"><td colspan="11">
        <p class="hint" style="margin:2px 0 6px">
          The machinery ${esc(x.name || 'this class')} plays with. A marked system shows
          <em>marked</em> on its tabs in the ⚙ manager and joins the session view's bar,
          even before anything is typed into it.
        </p>
        <div class="pair" style="flex-wrap:wrap">
          ${GAME_SYSTEMS.map((s) => `<button data-action="class-system-toggle" data-index="${i}"
            data-system="${s.id}" aria-pressed="${on.has(s.id)}">${esc(s.label)}</button>`).join('')}
          ${extra.map((id) => `<button data-action="class-system-toggle" data-index="${i}"
            data-system="${esc(id)}" aria-pressed="true"
            title="A tag from an extension pack this app has no tab for">${esc(id)}</button>`).join('')}
        </div>
      </td></tr>`;
    };
    return `<section class="panel span2">
      <h3>Classes</h3>
      <div class="tablewrap"><table class="classes">
        <colgroup><col class="cls"><col class="lvl"><col class="hd"><col class="bab">
          <col class="save"><col class="save"><col class="save">
          <col class="ranks"><col class="arch"><col class="sys"><col class="tools"></colgroup>
        <thead><tr>
          <th>Class</th>
          <th class="num" title="How many of the character's levels feature this class in the Planner; type a number to override">Levels</th>
          <th class="num">HD</th>
          <th title="Base attack progression — the best one on each level is what the character's BAB is built from">BAB</th>
          <th class="mid" title="Good Fortitude">Fort</th><th class="mid" title="Good Reflex">Ref</th><th class="mid" title="Good Will">Will</th>
          <th class="num" title="Skill ranks per level">Ranks</th>
          <th>Archetypes</th>
          <th title="The sub-systems this class uses (Spheres, Path of War, psionics…)">Systems</th><th></th>
        </tr></thead>
        <tbody>${c.classes.map((x, i) => {
          const auto = Number(x.gestaltLevels) || 0;
          const over = x.levelsOverride == null ? null : Number(x.levelsOverride);
          const why = over == null
            ? `Featured on ${auto} of ${level} level${level === 1 ? '' : 's'} in the Planner. Type a number to override it.`
            : `Pinned at ${over}. The Planner features it on ${auto} of ${level}; clear the box to go back to that.`;
          return `<tr>
          <td>${itemText('classes', i, 'name', x.name)}</td>
          <td class="num"><input type="number" class="autonum${over == null ? ' auto' : ''}"
            value="${over ?? ''}" placeholder="${auto}" title="${esc(why)}"
            data-item="classes|${i}|levelsOverride" data-kind="number-or-null"
            aria-label="Levels of ${esc(x.name || 'this class')}"></td>
          <td class="num">${progressionSelect(i, 'hd', x.hd,
    HIT_DICE.map((d) => [d, `d${d}`]), `Hit die for ${x.name || 'this class'}`, (d) => `d${d}`,
    { count: x.gestaltBeaten?.hd, levels: x.gestaltBeaten?.levels, noun: 'hit die' })}</td>
          ${/* The progression, not a bonus: what the class adds to BAB per level.
              Kept as the fraction the rules state it in, because that is what
              the gestalt sum adds up and floors. */ ''}
          <td>${progressionSelect(i, 'bab', x.bab, BAB_RATES,
    `BAB progression for ${x.name || 'this class'}`, String,
    { count: x.gestaltBeaten?.bab, levels: x.gestaltBeaten?.levels, noun: 'progression' })}</td>
          <td class="mid">${itemCheck('classes', i, 'goodFort', x.goodFort)}</td>
          <td class="mid">${itemCheck('classes', i, 'goodRef', x.goodRef)}</td>
          <td class="mid">${itemCheck('classes', i, 'goodWill', x.goodWill)}</td>
          <td class="num">${itemNum('classes', i, 'skillRanks', x.skillRanks)}</td>
          <td>${(Array.isArray(x.archetypeStack) && x.archetypeStack.length) ? `<span class="pills">${x.archetypeStack.map((a) => `
            <span class="pill" title="${esc(`${a.name} — an archetype added from an extension.${a.removedCells?.length ? ` Replaced ${[...new Set(a.removedCells.map((r) => r.name))].join(', ')}.` : ''}${a.touches?.length ? ` Touches: ${a.touches.join(', ')}.` : ''} × removes it and puts the class's own features back.`)}">
              ${esc(a.name)}<button data-action="arch-remove" data-class="${esc(x.name)}" data-name="${esc(a.name)}" aria-label="Remove ${esc(a.name)}">×</button>
            </span>`).join('')}</span>` : ''}${itemText('classes', i, 'archetypes', x.archetypes)}</td>
          <td class="mid">${sysButton(x, i)}</td>
          ${rowTools('classes', i)}
        </tr>${sysPicker(x, i)}`;
        }).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton('classes', 'Add class', {
        name: 'New class', hd: 8, bab: 0.75, goodFort: false, goodRef: false,
        goodWill: false, skillRanks: 4, archetypes: '', levelsOverride: null, systems: [],
      })}</div>
      <div class="fieldgrid" style="margin-top:8px">
        <div class="statline"><span class="label">Save bases${gestalt ? ' (gestalt)' : ''}</span>
          <span class="value">Fort ${sv('fortitude').base ?? 0} &middot;
            Ref ${sv('reflex').base ?? 0} &middot; Will ${sv('will').base ?? 0}</span></div>
        <div class="statline"><span class="label">Base attack bonus${gestalt ? ' (gestalt)' : ''}</span>
          <span class="value" title="${esc(`${g.babPerLevel ?? 0} per-level progression, summed and floored once${
    c.attack?.babOverride == null ? '' : `. Pinned at ${c.attack.babOverride} on the Attack panel`}`)}"
            >+${g.bab ?? 0}${c.attack?.babOverride == null ? '' : ` <span class="badge">pinned +${c.attack.babOverride}</span>`}</span></div>
        <div class="statline"><span class="label">HP / level${gestalt ? ' (best HD)' : ''}</span>
          <span class="value">d${g.hpPerLevel || 0}</span></div>
        <div class="statline"><span class="label">Hit points from these classes</span>
          <span class="value" title="${esc(`${g.hdTotal ?? 0} from the hit dice over ${level} level${level === 1 ? '' : 's'}, before Con, favoured class, Toughness and the mythic tiers`)}"
            >${g.hdTotal ?? 0} &rarr; ${g.hp?.base ?? 0} total</span></div>
        <div class="statline"><span class="label">Skill ranks / level${gestalt ? ' (best)' : ''}</span>
          <span class="value">${g.ranksPerLevel || 0}</span></div>
      </div>
      <p class="hint">
        ${gestalt ? `Gestalt: each level takes the best progression among the classes present that
        level (from the Planner). Good saves give +2 once plus &frac12;/level; poor give &#8531;/level.`
    : `Good saves give +2 once plus &frac12;/level; poor give &#8531;/level.`}
        These bases drive the Saves, Attack and Hit points panels automatically${gestalt
    ? ` — which is why a hit die or a progression that another class is already beating
        changes nothing when you move it. Those dropdowns say so when you hover them.` : ''}.
      </p>
    </section>`;
  }


  /* ----- the import offset, as a field -----

   * The four builders are in ui/badges.js, where the panel modules can reach
   * them; what they need from here is the model, so that is what is passed.
   */







/**
 * Where the maximum came from, and the fields that decide it.
 *
 * The workbook worked hit points out on Character Info and this sheet only
 * kept the answer, so the four inputs it kept alongside -- the ability, the
 * favoured-class points, Toughness, the miscellany -- were imported and then
 * never shown. They are the difference between a total that moves with the
 * classes and one that does not, so they are fields, and the sum is spelled
 * out above them in the order the parts are added.
 *
 * The maximum itself is a read-out with an override behind it, the same
 * arrangement as the base attack bonus and a class's Levels: type a number to
 * pin it, clear the box to hand it back to the class table.
 */
function hpBuild(model) {
  const c = model.data;
  const g = c.gestalt?.hp || {};
  const level = Number(c.identity?.level) || 0;
  const base = Number(c.hp.base) || 0;
  const over = c.hp.totalOverride == null ? null : Number(c.hp.totalOverride);
  const abilityMod = Number(g.abilityMod) || 0;
  const shut = !!c.uiPrefs?.collapsed?.['hp:build'];

  // Only the parts that are doing something, so a plain character reads as
  // "dice plus Con" rather than as a form with four zeroes in it. A part that
  // takes hit points away is parenthesised rather than signed, because the
  // pluses between the terms are already doing that job.
  const term = (n) => (n < 0 ? `(${String(n).replace('-', '−')})` : String(n));
  const parts = [
    [term(c.gestalt?.hdTotal ?? 0), `hit dice over ${level} level${level === 1 ? '' : 's'}`],
    abilityMod ? [term(abilityMod * level), `${c.hp.ability || 'ability'}${
      c.hp.ability2 ? ` + ${c.hp.ability2}` : ''} ${fmt(abilityMod)} × ${level}`] : null,
    Number(c.hp.fcb) ? [term(Number(c.hp.fcb)), 'favoured class'] : null,
    Number(c.hp.toughness) ? [term(Number(c.hp.toughness) * level),
      `Toughness ${fmt(Number(c.hp.toughness))} × ${level}`] : null,
    model.mythicHp ? [term(model.mythicHp),
      `${c.mythic?.path || 'mythic'} tier ${c.identity?.mythicTier || 0}`] : null,
    Number(c.hp.misc) ? [term(Number(c.hp.misc)), 'misc'] : null,
  ].filter(Boolean);

  const why = over == null
    ? 'From the Classes table: the best hit die on each level, plus the parts below. Type a number to override it.'
    : `Pinned at ${over}. The class table comes to ${base}; clear the box to go back to that.`;

  return `<div class="fieldgrid two">
        ${field('Base maximum', `<input type="number" class="autonum${over == null ? ' auto' : ''}"
          value="${over ?? ''}" placeholder="${base}" data-set="hp.totalOverride"
          data-kind="number-or-null" style="width:4.6rem" title="${esc(why)}"
          aria-label="Base maximum hit points">`)}
        ${field('HP ability', abilitySelect('hp.ability', c.hp.ability))}
      </div>
      <p class="hint">${parts.map(([n, label]) => `<span title="${esc(label)}">${n}</span>`).join(' + ')}
        = <strong>${base}</strong>${over == null ? '' : `, overridden to <strong>${over}</strong>`}
        <button class="disclose" data-collapse="hp:build" data-collapse-to="${!shut}"
          aria-expanded="${!shut}"
          title="${shut ? 'Open the parts to edit them' : 'Fold the parts away'}">${shut ? '▸' : '▾'}</button></p>
      ${shut ? '' : `<div class="fieldgrid two">
        ${field('2nd HP ability', abilitySelect('hp.ability2', c.hp.ability2))}
        ${field('Favoured class HP', num('hp.fcb', c.hp.fcb))}
        ${field('Toughness / level', num('hp.toughness', c.hp.toughness))}
        ${field('Misc', num('hp.misc', c.hp.misc))}
        ${field('Mythic bonus', `<span class="value" title="${esc(`${
    c.mythic?.path || 'No path'}, ${c.identity?.mythicTier || 0} tier${
    (c.identity?.mythicTier || 0) === 1 ? '' : 's'} — set the per-tier figure on the Features tab`)}"
          >${fmt(model.mythicHp)}</span>`)}
      </div>`}`;
}

function hitPointsPanel(ctx, model) {
    const hp = model.hpState;
    const status = hp.dead ? 'dead' : hp.dying ? 'dying' : hp.unconscious ? 'unconscious' : null;
    const signed = (n) => String(n).replace('-', '−');
    return `<section class="panel">
      <h3>Hit points
        ${hp.temp > 0 ? `<span class="badge">+${hp.temp} temp</span>` : ''}
        ${hp.nonlethal > 0 ? `<span class="badge${hp.nonlethal >= hp.effective ? ' err' : ''}">${hp.nonlethal} nonlethal</span>` : ''}
        ${meterStyleButton(ctx, 'hp')}
      </h3>
      ${meterVisual(model.meterSpec('hp'))}
      ${meterStyleEditor(model, ctx, 'hp')}
      <div class="hprow">
        ${num('hp.current', hp.current)}<span class="hpsep">/</span>
        <span class="value" title="The maximum the class table comes to, plus anything forwarded here">${hp.max}</span>
        ${hp.temp > 0 ? `<span class="hptemp" title="Temporary hit points, spent first">+${hp.temp}</span>` : ''}
      </div>
      ${hpBuild(model)}
      ${model.forwardedInto('hp.total')
        ? `<div class="fieldgrid two">${field('Forwarded',
          `<span class="value">${forwardedBadge(model, 'hp.total')}</span>`)}</div>` : ''}
      <div class="fieldgrid two">
        ${field('Temporary', num('hp.temp', hp.temp))}
        ${field('Nonlethal', num('hp.nonlethal', hp.nonlethal))}
      </div>
      <div class="fieldgrid two">
        ${field('Death threshold +', num('hp.deathBonus', hp.deathBonus))}
        ${field('Dead at', `<span class="value${hp.dying ? ' bad' : ''}">${signed(hp.deathAt)}</span>`)}
      </div>
      ${status ? `<p class="hint warn">${status === 'dead' ? `Dead — at or past ${signed(hp.deathAt)}.`
        : status === 'dying' ? `Dying — ${hp.current - hp.deathAt} point${hp.current - hp.deathAt === 1 ? '' : 's'} from death at ${signed(hp.deathAt)}.`
          : hp.nonlethal >= hp.effective && hp.current > 0 ? 'Unconscious — nonlethal damage has caught up with what is left.'
            : 'Unconscious.'}</p>` : ''}
      <div class="hpactions">
        <input type="number" value="0" data-hp-amount aria-label="Amount" min="0">
        <button data-hp="damage" class="danger">Damage</button>
        <button data-hp="nonlethal">Nonlethal</button>
        <button data-hp="heal">Heal</button>
        <button data-hp="rest" class="primary">Rest</button>
      </div>
      <p class="hint">Damage spends temporary hit points first. Death comes at
        −(Con ${hp.deathBonus ? `+ ${hp.deathBonus} ` : ''}), so the threshold moves
        with Con; raise it for Death's Door and the like. “Rest” restores everything
        and resets all trackers.</p>
    </section>`;
  }

  /**
   * Conditions, as switches -- and one counter.
   *
   * All but negative levels are on or off, so a number box for each was
   * asking the player to type a 1. Each is a toggle that names what it costs;
   * the one that counts keeps its field. What they add up to is read out
   * beside the stats they move (as "now +N"), so the base stays what the
   * sheet says and the penalties are still in plain view.
   */
function conditionsPanel(model) {
    const conditions = model.data.conditions || {};
    const cs = model.conditionState;
    const names = Object.keys(conditions).sort((a, b) => a.localeCompare(b));
    const superseded = new Set(cs.superseded.map((x) => x.name));

    const short = (info) => {
      if (!info) return '';
      const bits = [];
      const m = info.mods || {};
      if (m.attack) bits.push(`${fmt(m.attack)} atk`);
      if (m.melee) bits.push(`${fmt(m.melee)} melee`);
      if (m.ac) bits.push(`${fmt(m.ac)} AC`);
      if (m.saves) bits.push(`${fmt(m.saves)} saves`);
      if (m.skills) bits.push(`${fmt(m.skills)} skills`);
      if (m.initiative) bits.push(`${fmt(m.initiative)} init`);
      if (m.hp) bits.push(`${fmt(m.hp)} hp`);
      for (const [k, v] of Object.entries(info.ability || {})) bits.push(`${fmt(v)} ${ABILITY_LABELS[k]}`);
      for (const [k, v] of Object.entries(info.abilitySet || {})) bits.push(`${ABILITY_LABELS[k]} ${v}`);
      if (info.losesDex) bits.push('no Dex to AC');
      if (info.speed === 0) bits.push('no move');
      else if (info.speed !== undefined && info.speed < 1) bits.push('half speed');
      if (info.acVsMelee) bits.push(`${fmt(info.acVsMelee)} AC vs melee`);
      if (info.acVsRanged) bits.push(`${fmt(info.acVsRanged)} AC vs ranged`);
      return info.kind === 'count' ? `${bits.join(', ')} each` : bits.join(', ');
    };

    const chip = (name) => {
      const info = conditionInfo(name);
      const value = Number(conditions[name]) || 0;
      const on = value > 0;
      const beaten = superseded.has(name);
      const title = info ? `${info.rule}${info.notes?.length ? ` ${info.notes.map((n) => `${n[0].toUpperCase()}${n.slice(1)}.`).join(' ')}` : ''}` : '';
      const label = info?.label || name;
      if (info?.kind === 'count') {
        return `<label class="cond count${on ? ' on' : ''}" title="${esc(title)}">
          <span class="cname">${esc(label)}</span>
          <span class="ceffect">${esc(short(info))}</span>
          ${num(`conditions.${name}`, value, 'min="0" style="width:3.2rem" aria-label="Negative levels"')}
        </label>`;
      }
      return `<label class="cond${on ? ' on' : ''}${beaten ? ' beaten' : ''}" title="${esc(beaten ? `${title} (Superseded by a worse condition on the same ladder.)` : title)}">
        <input type="checkbox" ${on ? 'checked' : ''} data-set="conditions.${esc(name)}" data-kind="flag" aria-label="${esc(label)}">
        <span class="cname">${esc(label)}</span>
        <span class="ceffect">${esc(short(info) || (info ? 'no numbers' : ''))}</span>
        <button class="danger tiny" data-remove-condition="${esc(name)}" title="Remove this condition from the list" aria-label="Remove ${esc(label)}">×</button>
      </label>`;
    };

    const spare = model.availableConditions();
    return `<section class="panel span2 conditions">
      <h3>Conditions ${cs.active.length ? `<span class="badge err">${cs.active.length} on</span>` : ''}</h3>
      <div class="condgrid">${names.map(chip).join('')}</div>
      <div class="pair" style="margin-top:8px; flex-wrap:wrap">
        <select data-draft="condition" aria-label="Condition to add">
          <option value="">Add a condition…</option>
          ${spare.map((x) => `<option value="${esc(x.label)}">${esc(x.label)}</option>`).join('')}
        </select>
        <button data-action="add-condition">Add</button>
      </div>
      ${cs.active.length ? `<div class="condsummary">
        <strong>In effect:</strong>
        ${cs.counted.map(({ name, info, count }) => `<span class="tag">${esc(info.label || name)}${count > 1 ? ` ×${count}` : ''}</span>`).join('')}
        ${cs.superseded.length ? `<span class="hint">(${cs.superseded.map(({ info, name }) => esc(info.label || name)).join(', ')} superseded)</span>` : ''}
        ${cs.notes.length ? `<ul class="hint">${cs.notes.map((n) => `<li>${esc(n[0].toUpperCase() + n.slice(1))}.</li>`).join('')}</ul>` : ''}
      </div>` : ''}
      <p class="hint">Tick a condition and every number it moves shows what it is
        <em>now</em> beside the base — attacks, AC, saves, initiative, speed and the
        ability modifiers. The base stays as the sheet has it. Shaken, frightened and
        panicked do not stack, nor fatigued and exhausted: the worse one counts.</p>
    </section>`;
  }


function traitsPanel(model, ctx) {
    const c = model.data;
    const slots = c.traitSlots || {};
    const categories = [...TRAIT_CATEGORIES, ...(c.traitCategories || [])];
    const filled = (key) => !!(slots[key]?.name || slots[key]?.text || slots[key]?.category);

    const standard = ['trait1', 'trait2', 'trait3'];
    const picked = standard.filter(filled).length;
    const row = (def) => {
      const v = slots[def.key] || {};
      const locked = def.requires && !filled(def.requires);
      const isDrawback = def.kind !== 'trait';
      // The three standard picks are owed; an empty one says so.
      const owed = standard.includes(def.key) && !filled(def.key);
      const wants = locked ? `Take ${TRAIT_SLOTS.find((s) => s.key === def.requires)?.label} first`
        : owed ? 'Pick a trait' : '';
      return `<tr class="${locked ? 'lockedslot' : ''}${owed ? ' needsfill' : ''}"${owed ? ' title="A standard trait pick, still to be chosen"' : ''}>
        <td>${esc(def.label)}${def.requires ? `<div class="hint">needs ${esc(TRAIT_SLOTS.find((s) => s.key === def.requires)?.label)}</div>` : ''}</td>
        <td>${isDrawback ? '<span class="hint">—</span>'
          : select(`traitSlots.${def.key}.category`, v.category, categories)}</td>
        <td>${text(`traitSlots.${def.key}.name`, v.name, wants || (isDrawback ? 'Drawback' : 'Trait'))}</td>
        <td>${prose(model, `data-set="traitSlots.${def.key}.text"`, v.text, 1, 'grow')}</td>
      </tr>`;
    };

    const race = c.raceTraits || [];
    return `<section class="panel span2">
      <h3>Traits &amp; drawbacks</h3>
      <div class="traitpair">
        <div>
          <h4 class="subhead">Character traits
            <span class="badge${picked < standard.length ? ' err' : ' ok'}">${picked} of ${standard.length} picked</span>
          </h4>
          <div class="tablewrap"><table class="traits">
            <colgroup><col class="slot"><col class="cat"><col class="tname"><col class="effect"></colgroup>
            <thead><tr><th>Slot</th><th>Category</th><th>Name</th><th>Trait / effect</th></tr></thead>
            <tbody>
              ${TRAIT_SLOTS.filter((s) => s.kind !== 'feat').map(row).join('')}
              ${(slots.additional || []).map((x, i) => `<tr>
                <td>Additional</td>
                <td>${itemSelect('traitSlots.additional', i, 'category', x.category, categories)}</td>
                <td>${itemText('traitSlots.additional', i, 'name', x.name, 'Trait')}</td>
                <td><span class="pair" style="width:100%">
                  ${prose(model, `data-item="traitSlots.additional|${i}|text"`, x.text, 1, 'grow')}
                  <button class="danger" data-remove="traitSlots.additional|${i}" aria-label="Remove">×</button>
                </span></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
          <div style="margin-top:8px" class="pair">
            ${addButton('traitSlots.additional', 'Add additional trait', { category: null, name: '', text: '' })}
            <input data-draft="traitCategory" placeholder="New category (e.g. Akashic)"
              value="${esc(ctx.draft.traitCategory || '')}" style="max-width:14rem">
            <button data-action="add-trait-category">Add category</button>
          </div>
          <p class="hint">
            Traits 1–3 are the standard picks. Drawback 1 unlocks Trait 4, Drawback 2 unlocks
            Trait 5, and a Major Drawback buys a Drawback Feat — which is named under
            <strong>Granted feats</strong> on the Feats &amp; Mythic tab, with the other feats
            something hands you. Categories cover the standard list plus any you add
            (Akashic, Mythic, Psionic…).
          </p>
        </div>
        <div>
          <h4 class="subhead">Race traits
            <span class="badge">${race.filter((t) => String(t.name || '').trim() || String(t.text || '').trim()).length}${race.some((t) => !String(t.name || '').trim() && !String(t.text || '').trim()) ? ` of ${race.length}` : ''}</span>
            ${c.identity.race ? `<span class="hint">${esc(c.identity.race)}${c.identity.variant ? ` (${esc(c.identity.variant)})` : ''}</span>` : ''}
          </h4>
          <div class="tablewrap"><table class="racetraits">
            <thead><tr><th>Trait</th><th>Effect</th><th></th></tr></thead>
            <tbody>${race.map((t, i) => `<tr${String(t.name || '').trim() || String(t.text || '').trim() ? '' : ' class="needsfill" title="A race-trait slot still to fill"'}>
              <td>${itemText('raceTraits', i, 'name', t.name, 'Darkvision')}${Array.isArray(t.replaced) && t.replaced.length
    ? ` <span class="badge player" title="${esc(`Alternate racial trait — took the place of ${t.replaced.map((r) => r.name).join(' and ')}. Removing this row does not put them back; add them again from the race's pack if you need them.`)}">alt</span>` : ''}</td>
              <td>${prose(model, `data-item="raceTraits|${i}|text"`, t.text, 1, 'grow')}</td>
              ${rowTools('raceTraits', i)}
            </tr>`).join('')}
            ${race.length ? '' : '<tr><td colspan="3" class="empty">No race traits yet — add what the race grants.</td></tr>'}
            </tbody>
          </table></div>
          <div style="margin-top:8px">${addButton('raceTraits', 'Add race trait', { name: '', text: '' })}</div>
          <p class="hint">What the race hands you — a few for some, ten for others.
            Alternate racial traits go here too, in place of what they replace.</p>
        </div>
      </div>
    </section>`;
  }
