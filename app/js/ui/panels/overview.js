/**
 * ui/panels/overview.js -- the first tab, in both of its forms.
 *
 * In the build view the Overview is the whole character on one page: who they
 * are, the numbers a table asks for, the classes those numbers come out of,
 * what defends them and what they attack with. It is read-only but for the
 * Details, Conditions and Buffs panels; every other panel is a summary of one
 * edited on another tab (Stats, Progression, Background, Equipment), with an
 * Edit button that goes there (ui/formula-places.js `HOMES`).
 *
 * In the session view the same tab is a dashboard of cards -- the readings
 * that come up in play, arranged the way the player arranged them, with the
 * build machinery a click away.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, portraitFrame } from '../html.js';
import { HOMES } from '../formula-places.js';
import { abilityScoresPanel, acPanel, attackPanel, hpStatus, restButtons, savesPanel } from './stats.js';
import { BAB_RATES, languageCopy } from './lore.js';
import { renderSessionBoard } from './session.js';
import { field } from '../fields.js';
import { effectiveMythicTier } from '../../rules.js';
import { minus, signed } from '../format.js';
import { collapsible, foldButton, isOpen, supergroup } from '../rows.js';
import { prose, renderedProse } from '../prose.js';
import { proseText } from '../rows.js';
import { rollButton } from '../roll.js';
import { weaponNow } from '../weapon-now.js';
import {
  guileTalentRows, ownTalentRows, trackTalentSide, trainingSideInUse,
} from '../../model.js';
import {
  formulaMeta, meterVisual, powerPointStepper, trackerLine,
} from './trackers.js';
import { slotSpend } from './subsystems.js';

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
  ['log', 'Play log'],
];

const DASH_CARD_LABELS = new Map(DASH_CARDS);

import { loadLine, weaponsPanel } from './gear.js';
import { playLogPanel } from '../play-log.js';
import {
  ABILITIES, ABILITY_LABELS, ALT_ATTACK_OF, ATTACK_MODES, ATTACK_MODE_LABELS, BONUS_TYPES, BUFF_MOD_KEYS,
  BUFF_TARGETS, CONDITIONS, CONDITION_CATS, SIZE_MODIFIERS, TRAIT_SLOTS, attackModeTotal, castingNoun,
  conditionInfo, conditionTotals, fmt, prepStyle, skillConditionDelta, skillLabel,
} from '../../rules.js';
import { hasTokens } from '../../inline.js';
import { maneuverDetails } from '../../model.js';
import { colorControl } from '../color-control.js';
import { AGE_CATEGORIES, campaignRules, isAntihero, levelProgress, specialtyInPlay } from '../../model/campaign.js';
import { check, num, select, text } from '../fields.js';
import {
  addButton, bigStat, exprField, itemCheck, itemExpr, itemNum, itemSelect, itemText, line, lineHtml,
  movedInline, movedSub, movedTitle, movedValue, removeAction, removeButton, removeControl,
} from '../rows.js';

  /**
   * The Overview, top to bottom: the headline numbers; the two panels edited
   * here (Details beside the ability scores, then Conditions and Buffs); and
   * then, read-only and in the order a character is built, the classes, the
   * background, the defenses and the offenses. Each read-only panel's Edit
   * button goes to the tab it is edited on.
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
          ${bigStat('HP', { html: movedInline(cs, 'hp', model.hpMax, String, model) }, c.hp.ability ? `${c.hp.ability} based` : '')}
          ${/* Touch, flat-footed and flat-footed CMD move with a condition or a
                buff exactly as the headline above them does, and used to be
                printed raw -- so a −2 to AC showed on the big number and the
                two beneath it went on reporting the character undebuffed. */''}
          ${bigStat('AC', { html: movedInline(cs, 'ac', d.ac, String, model) },
    { html: `touch ${movedSub(cs, 'touch', d.touch, String)} &middot; FF ${movedSub(cs, 'flatFooted', d.flatFooted, String)}` })}
          ${bigStat('CMD', { html: movedInline(cs, 'cmd', d.cmd, String, model) },
    { html: `FF ${movedSub(cs, 'ffCmd', d.ffCmd, String)}` })}
          ${bigStat('Init', { html: movedInline(cs, 'initiative', c.hp.initiative, fmt, model) }, c.hp.initAbility || '', '',
    rollButton(model, 'initiative', 'self', 'initiative', cs))}
          ${bigStat('Fort', { html: movedInline(cs, 'fortitude', s.fortitude.total, fmt, model) }, s.fortitude.stat1 || '')}
          ${bigStat('Ref', { html: movedInline(cs, 'reflex', s.reflex.total, fmt, model) }, s.reflex.stat1 || '')}
          ${bigStat('Will', { html: movedInline(cs, 'will', s.will.total, fmt, model) }, s.will.stat1 || '')}
          ${bigStat('BAB', fmt(c.attack.bab), c.attack.iterative || '')}
          ${(() => {
    // The wallet, beside the numbers a table asks for: what is on hand, and
    // what is left once the offering owed today is paid.
    const w = model.wealthView();
    const n = (x) => Number(x || 0).toLocaleString('en-US');
    return bigStat(w.currency, n(w.current), w.due && w.expected.total
      ? `after offering ${n(w.after)}` : (w.due ? 'nothing owed' : 'on hand'));
  })()}
        </div>
      </section>

      <div class="band lead">
        ${detailsPanel(model, ctx)}
        ${abilityScoresPanel(model, { readOnly: true, head: editLink(model, 'abilities') })}
      </div>
      <div class="band lead">
        ${conditionsPanel(model)}
        ${collapsible(model, 'buffs', buffsPanel(model, ctx))}
      </div>

      ${classesSummary(model)}

      ${supergroup(model, 'background', 'Background', 'background', `
          ${raceTraitsSummary(model)}
          ${traitsSummary(model)}
          ${specialtyInPlay(c) ? specialtySummary(model) : ''}
          ${languagesSummary(model)}`)}

      ${supergroup(model, 'defenses', 'Defenses', 'defenses', `
          ${hitPointsSummary(model)}
          ${armorClassSummary(model)}
          ${savesSummary(model)}`)}

      ${supergroup(model, 'offenses', 'Offenses', 'offenses', `
          ${attackSummary(model)}
          ${speedSummary(model)}
          ${carrySummary(model)}
          ${proficienciesSummary(model)}`)}
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
    const open = (key) => isOpen(model, `dash:${key}`, false);
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
      log: () => playLogPanel(model, ctx, { span: false }),
    };
    const ids = dashCardIds(model);
    const support = new Set(['quick', 'resources', 'conditions', 'buffs', 'effects', 'vancian', 'psionics', 'spheres', 'log']);
    return `<div class="dashboard session-dashboard">
      <div class="dashtools span2">
        <button class="linkish" data-action="dash-arrange" aria-expanded="${ctx.dashArrange}">
          ${ctx.dashArrange ? 'Done arranging' : 'Arrange cards'}</button>
      </div>
      ${ctx.dashArrange ? dashArrangePanel(model) : ''}
      <div class="session-workspace">
        ${renderSessionBoard(model)}
        <aside class="session-support" aria-label="Health, resources and effects">
          ${ids.filter(id => support.has(id)).map(id => render[id]?.() || '').join('')}
        </aside>
      </div>
      <details class="session-reference" open><summary>Character reference</summary>
        <div class="band">${ids.filter(id => !support.has(id)).map(id => render[id]?.() || '').join('')}</div>
      </details>
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
    const out = ['quick', 'resources', 'conditions', 'buffs'];
    if (on('vancian')) out.push('vancian');
    if (on('psionics')) out.push('psionics');
    // Keyed by tab: the old single combat tab is two now, and asking for it
    // meant the casting card was never added for anyone.
    if (on('magic') && model.data.training?.magic) out.push('spheres');
    out.push('offense', 'defense', 'abilities', 'speed', 'skills', 'effects', 'log');
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
        ${custom ? '<button style="margin-left:auto" data-action="dash-cards-reset" title="Return to the automatic card arrangement.">Reset to automatic</button>' : ''}
      </h3>
      <p class="hint">
        Choose which cards show and in what order. On automatic, caster cards show for the
        systems the character uses. Your first change here turns off automatic. Lists such as
        veils, readied maneuvers and talents are under More to add.
      </p>
      <div class="rowlist">${visible.map(row).join('')}</div>
      ${hidden.length ? `<h4 class="subhead" style="margin-top:10px">More to add</h4>
      <div class="rowlist">${hidden.map(offRow).join('')}</div>` : ''}
    </section>`;
  }

  /** The card's corner control: one click between the summary and the full read. */
function dashExpand(key, openNow) {
    return foldButton(null, `dash:${key}`, {
      open: openNow, cls: 'linkish', attrs: 'style="margin-left:auto"', title: '', text: openNow ? 'Collapse' : 'Expand',
    });
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
        ${active.map(chip).join('') || '<span class="empty">None.</span>'}
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
      const base = Number(model.data.abilities[key]?.workingScore ?? model.data.abilities[key]?.tempScore) || 0;
      let score = base + (t.ability[key] || 0);
      if (t.abilitySet[key] !== undefined) score = Math.min(score, t.abilitySet[key]);
      score = Math.max(0, score);
      if (score !== base) bits.push(`${ABILITY_LABELS[key]} ${base} → ${score}`);
    }
    for (const [key, v] of Object.entries(t.skillsBy || {})) if (v) bits.push(`${ABILITY_LABELS[key] || key} skills ${fmt(v)}`);
    for (const [key, v] of Object.entries(t.skillMods || {})) if (v) bits.push(`${key[0].toUpperCase()}${key.slice(1)} ${fmt(v)}`);
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
    // The bonus types a buff can be; Untyped is the blank choice.
    const typeOptions = Object.entries(BONUS_TYPES).filter(([k]) => k !== 'untyped').map(([k, t]) => [k, t.name]);
    const typeName = (b) => BONUS_TYPES[b.type]?.name?.toLowerCase() || '';
    const roundsLeft = (b) => Math.max(0, Math.floor(Number(b.rounds) || 0));
    const counting = buffs.some((b) => b?.on && roundsLeft(b) > 0);
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
        bits.push(row.target === 'size' ? `${signed(v)} true size`
          : row.target === 'sizeEffective' ? `${signed(v)} effective size`
            : row.target === 'sizeStacking' ? `${signed(v)} size (stacks)`
              : `${fmt(v)} ${targetLabels.get(row.target) || row.target}`);
      }
      const out = bits.join(' · ') || 'no numbers yet';
      return typeName(b) && bits.length ? `${out} (${typeName(b)})` : out;
    };
    const dial = (b, i, [key, label]) => `<label class="fld"><span>${label}</span>
      ${itemExpr(list, i, key, b, { width: '100%', placeholder: '0, or a formula' })}</label>`;
    // The cards never move: the editor is its own full-width block under the
    // grid, tied to the open card by the shared highlight.
    const row = (b, i) => {
      const open = ctx.openBuff === i;
      const left = roundsLeft(b);
      const stacking = cs.buffStacking?.[i] || [];
      return `<div class="buffcard${b.on ? '' : ' off'}${b.error ? ' invalid' : ''}${open ? ' open' : ''}">
        <div class="buffhead">
          ${itemCheck(list, i, 'on', b.on !== false)}
          <span class="bname">${esc(b.name || 'Unnamed buff')}</span>
          <span class="bsum hint" style="margin:0">${esc(summary(b))}</span>
          ${left ? `<span class="badge" title="Rounds left. Next turn or Next round lowers it by one, and the buff turns off when it runs out.">${left} round${left === 1 ? '' : 's'}</span>` : ''}
          ${stacking.length ? '<span class="badge">does not stack</span>' : ''}
          ${b.error ? `<span class="badge err" title="${esc(b.error)}">formula problem</span>` : ''}
          <span class="pair" style="margin-left:auto">
            <button data-action="buff-open" data-index="${i}" aria-expanded="${open}"
              title="${open ? 'Close the editor.' : 'Edit this buff.'}">${open ? '▾ Close' : '▸ Edit'}</button>
            ${removeButton('buffs', i, { what: 'buff' })}
          </span>
        </div>
        ${stacking.length ? `<ul class="bstack">${stacking.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      </div>`;
    };
    const editing = buffs[ctx.openBuff] ? ctx.openBuff : null;
    const editor = editing === null ? '' : (() => {
      const b = buffs[editing];
      const i = editing;
      const bonusRow = (row, j) => `<span class="buffbonus">
        ${itemSelect(list, i, `bonuses.${j}.target`, row.target, BUFF_TARGETS, null, null, { attrs: 'aria-label="What this bonus moves"' })}
        ${exprField(`data-item="${list}|${i}|bonuses.${j}.value"`, row.value, {
    width: '5.5rem', value: row.valueNum, error: row.valueError, title: 'A number or a formula, e.g. 1 + essence.shoulder',
  })}
        ${removeAction('buff-bonus-remove', { index: i, j }, { what: 'this bonus' })}
      </span>`;
      return `<div class="buffeditor">
        <div class="fieldgrid">
          <label class="fld"><span>Buff</span>${itemText(list, i, 'name', b.name, 'Citadel banner')}</label>
          <label class="fld"><span>Bonus type</span>${itemSelect(list, i, 'type', b.type, typeOptions, 'Untyped', null,
    { attrs: 'title="Typed bonuses do not stack with another of the same type: only the largest counts. Untyped, dodge and circumstance stack."' })}</label>
          <label class="fld"><span>Rounds left</span>${itemNum(list, i, 'rounds', b.rounds)}</label>
          ${BUFF_MOD_KEYS.map((k) => dial(b, i, k)).join('')}
        </div>
        ${BUFF_MOD_KEYS.filter(([key]) => typeof b[key] === 'string' && b[key].trim() !== '')
    .map(([key, label]) => formulaMeta(model, label.toLowerCase(), b[key])).join('')}
        <div class="buffbonuses">
          ${(b.bonuses || []).map(bonusRow).join('')}
          <button data-action="buff-bonus-add" data-index="${i}">+ Add bonus</button>
        </div>
        <p class="hint">The bonus type applies to every number on this buff. Within a type, only the
          largest bonus counts, including the sheet's own bonuses on saves, AC and ability scores
          (such as a cloak of resistance or worn armor). Penalties always count. Rounds left drops by
          one on Next turn or Next round, and the buff turns off when it runs out. Leave it at 0 for a
          buff that lasts until unticked.</p>
        <p class="hint">Extra bonuses cover stats the dials do not. An ability score bonus also
          changes everything based on that modifier. <em>Size</em> has three types, which stack
          with each other; within one type only the largest counts. <em>True</em> changes the size
          itself: attack, AC, CMB, CMD and weapon damage dice. <em>Effective</em> ("treated as
          larger") changes only the damage dice. <em>Stacking</em> is for items that let size
          effects stack; it adds to the other types and works like <em>True</em>. Size cannot go
          past Colossal or below Fine. Sneak attack and similar dice do not change, and neither
          does reach. Values accept formulas.</p>
        <label class="fld" style="margin-top:6px"><span>Note</span>
          ${prose(model, `data-item="${list}|${i}|note"`, b.note, 2, 'grow', null, {
    inactive: !b.on,
    inactiveTitle: 'This buff is off, so its bonus does not apply. Tick the buff to turn it on.',
  })}</label>
        <p class="hint">The note accepts {…} formulas. A <em>definition</em> such as
          <code>{deathgrip.dmg.max = 2 * (1 + essence.shoulder) * if(hp.current / hp.total &lt; 0.5, 2, 1)}</code>
          can be read anywhere on the sheet and applies whether or not the buff is ticked; use if(…)
          to make it conditional. A <em>bonus</em> such as <code>{skill.stealth += 4}</code> applies
          only while the buff is ticked. It shows
          ${b.on ? 'in gold while the buff is on' : '<span class="tok push off">grayed</span> while it is off'}.</p>
      </div>`;
    })();
    /*
     * Flowing Power (mythic tradition): the increase chosen this round, the
     * round's cost, and the free rounds a use of mythic power buys. Here with
     * the buffs because that is what it is while it is on.
     */
    const flowing = model.data.mythic?.flowingPower ? (() => {
      const f = model.data.mythic.flowing || {};
      const tier = effectiveMythicTier(model.data);
      const n = Math.max(0, Math.min(tier, Math.floor(Number(f.increase) || 0)));
      const free = Number(f.freeLeft) || 0;
      const strain = Number(model.data.hp?.strain) || 0;
      const perFree = Math.max(1, Math.floor(tier / 2));
      return `<div class="flowing">
        <strong>Flowing Power</strong>
        <label class="minifield">Increase ${num('mythic.flowing.increase', f.increase, `min="0" max="${tier}" style="width:4rem" title="Up to your mythic tier (${tier})"`)}</label>
        <span class="d">+${n} to every ability score${n ? `, ${n * n} damage a round` : ''}.</span>
        <button data-action="flowing-round" ${n ? '' : 'disabled'}
          title="${free ? 'End the round. This round is free, so it deals no damage.' : `End the round and take ${n * n} damage as strain, which only a New day rest heals.`}">End round${free ? ' (free)' : n ? ` −${n * n}` : ''}</button>
        <button data-action="flowing-free" title="Spend one use of mythic power for ${perFree} round${perFree === 1 ? '' : 's'} without damage today">Free rounds: ${free}</button>
        ${strain ? `<span class="d">Strain ${strain}: lowers maximum hit points until a New day rest.</span>` : ''}
      </div>`;
    })() : '';
    return `<section class="panel span2">
      <h3>Buffs ${cs.buffsOn ? `<span class="badge ok">${cs.buffsOn} on</span>` : ''}
        <span class="pair" style="margin-left:auto">
          ${counting ? `<button data-action="buff-round"
            title="End the round. Every ticked buff with rounds left loses one.">Next round</button>` : ''}
          <button data-action="buff-add">+ Add buff</button>
        </span>
      </h3>
      ${flowing}
      <div class="bufflist">
        ${buffs.map(row).join('') || '<p class="empty">No buffs yet.</p>'}
      </div>
      ${editor}
      <p class="hint">Ticked buffs apply like conditions: attacks, AC, saves, skills, initiative
        and damage show their <em>now</em> value with the buff included. Every dial accepts a
        number or a formula.</p>
    </section>`;
  }

  /** Every tracker as one row: name, its own meter, and the − n + controls. */
function dashResourcesCard(model) {
    const trackers = model.trackers;
    return `<section class="panel span2">
      <h3>Resources
        <button data-view class="linkish" style="margin-left:auto" data-action="goto-trackers"
          title="Open the Trackers tab to add or edit trackers.">+ New tracker</button>
      </h3>
      <div class="dashtrackers">
        ${trackers.map((t) => trackerLine(t, { movable: true })).join('') || '<p class="empty">No trackers yet. Add one on the Trackers tab.</p>'}
      </div>
    </section>`;
  }

  /** The attack numbers and every weapon's line; Expand brings the full panels up. */
function dashOffenseCard(model, ctx, openNow) {
    const c = model.data;
    const cs = model.conditionState;
    const weapons = c.equipment?.weapons || [];
    // Moved numbers replace the base in place, coloured by direction, with the
    // base in the tooltip -- the same read as AC and the saves, everywhere, and
    // the same breakdown on hover the Defense card opens.
    const stat = (label, value, nowKey, kind, ref, rollLabel) => {
      const shown = `<strong>${movedInline(cs, nowKey, value, fmt, model)}</strong>`;
      // Three cells -- name, figure, die -- so the grid lines them up in columns.
      return `<span class="dashstat"><span class="k">${esc(label)}</span><span class="n">${shown}</span><span class="r">${rollButton(model, kind, ref, rollLabel, cs)}</span></span>`;
    };
    const wrow = (w, i) => {
      // As the buffs of the moment leave it, the same reading the Gear tab's
      // weapon card shows (ui/weapon-now.js).
      const now = weaponNow(c, w, cs);
      return `<div class="statline">
      <span class="label">${esc(String(w.name || '').trim() || `Weapon ${i + 1}`)}</span>
      <span class="value rollpair">${movedValue(esc(now.atk), now.atkDelta, { title: now.atkTitle, keep: true })}
        ${movedValue(esc(now.dmg), now.dmgMoved, { tag: 'span', cls: 'dashdmg', title: now.dmgTitle, keep: true })}
        ${rollButton(model, 'weapon', i, `an attack with ${String(w.name || '').trim() || 'this weapon'} (full, single or Vital Strike)`, cs)}</span>
    </div>`;
    };
    return `<section class="panel">
      <h3>Offense ${dashExpand('offense', openNow)}</h3>
      <div class="dashstats dashstats-grid">
        ${stat('Melee', c.attack.totalMelee, 'melee', 'mode', 'melee', 'a melee attack')}
        ${stat('Ranged', c.attack.totalRanged, 'ranged', 'mode', 'ranged', 'a ranged attack')}
        ${stat('CMB', c.attack.totalCmb, 'cmb', 'mode', 'cmb', 'a combat maneuver')}
        ${stat('Init', c.hp.initiative, 'initiative', 'initiative', 'self', 'initiative')}
      </div>
      <div class="rowlist" style="margin-top:6px">
        ${weapons.map(wrow).join('') || '<p class="empty">No weapons yet. Expand to add one.</p>'}
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
      ? rollButton(model, 'weapon', chosen, `an attack with ${wname(weapons[chosen], chosen)} (full, single or Vital Strike)`, cs)
      : rollButton(model, 'mode', 'melee', 'a full-round melee attack with every iterative', cs);
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
    // The same working the build Overview shows, on the card a table reads
    // mid-fight: "why is my AC 50" is asked oftener here than anywhere.
    const shown = (key, base, format = String) => `<strong>${movedInline(cs, key, base, format, model)}</strong>`;
    // A save wears the hue of the ability behind it, as the ability checks do.
    const save = (key, label, ability) => `<div class="statline">
        <span class="label"><span class="abmark" data-ab="${ability}">${label}</span></span>
        <span class="value">${shown(key, s[key].total, fmt)}${rollButton(model, 'save', key, `a ${label} save`, cs)}</span>
      </div>`;
    const moved = (key, base) => movedSub(cs, key, base, String);
    return `<section class="panel">
      <h3>Defense ${dashExpand('defense', openNow)}</h3>
      <div class="dashcols dashcols-2">
        ${lineHtml('AC', `${shown('ac', d.ac)} <span class="dim">touch ${moved('touch', d.touch)} · FF ${moved('flatFooted', d.flatFooted)}</span>`)}
        ${lineHtml('CMD', `${shown('cmd', d.cmd)} <span class="dim">FF ${moved('ffCmd', d.ffCmd)}</span>`)}
      </div>
      <div class="dashcols dashcols-3">
        ${save('fortitude', 'Fort', 'con')}
        ${save('reflex', 'Ref', 'dex')}
        ${save('will', 'Will', 'wis')}
      </div>
      <p class="hint">Expand to see armor and save bonuses by type.</p>
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
      const value = movedValue(`${now} ft.`, moved ? adj.adjusted - adj.final : 0, {
        base: `${adj?.final} ft.`, sources: cs.sources, keep: true,
      });
      return lineHtml(sp.type || 'Movement',
        `${value} <span class="dim">×2 ${now * 2} · run ${now * 4}</span>`, true);
    };
    return `<section class="panel">
      <h3>Movement</h3>
      ${rows.length ? rows.map(line).join('')
    : '<p class="empty">No movement rates yet. Add them in the Speed panel on the build view’s Overview.</p>'}
      ${rows.length ? '<p class="hint">×2 is a double move and the charge distance. Run is ×4, or ×3 in heavy armor or under a heavy load.</p>' : ''}
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
        ? skillConditionDelta(cs, s) : 0;
      const shown = movedValue(fmt((Number(s.bonus) || 0) + delta), delta, { base: fmt(s.bonus), sources: cs.sources });
      return `<div class="statline">
      <span class="label">${esc(skillLabel(s.name, s.spec) || s.name || '—')}</span>
      <span class="value rollpair">${shown}${rollButton(model, 'skill', i, `a ${skillLabel(s.name, s.spec) || 'skill'} check`, cs)}</span>
    </div>`;
    };
    return `<section class="panel">
      <h3>Key skills ${dashExpand('skills', openNow)}</h3>
      <div class="rowlist">${rows.map(row).join('') || '<p class="empty">No skills yet.</p>'}</div>
      <p class="hint">${trained.length} trained · ${openNow ? 'all shown'
    : `top ${Math.min(6, pool.length)} by bonus`}. Spend ranks on the Skills tab.</p>
    </section>`;
  }

  /** Player-written reminders of what is running. They move no numbers. */
function dashEffectsCard(model) {
    const effects = model.data.effects || [];
    const row = (x, i) => `<div class="effectrow${x.on === false ? ' off' : ''}">
      <div class="pair">
        ${itemCheck('effects', i, 'on', x.on !== false)}
        ${itemText('effects', i, 'name', x.name, 'Watching the north door')}
        ${removeButton('effects', i, { what: 'effect' })}
      </div>
      ${itemText('effects', i, 'note', x.note, 'Note')}
    </div>`;
    return `<section class="panel">
      <h3>Active effects</h3>
      <div class="effectlist">${effects.map(row).join('') || '<p class="empty">No active effects.</p>'}</div>
      <div style="margin-top:8px">${addButton('effects', 'Add effect', { name: '', note: '', on: true })}</div>
      <p class="hint">These are reminders only and change no numbers. Put bonuses in
        <strong>Buffs</strong> instead.</p>
    </section>`;
  }


/**
 * Quick actions: the four buttons a table presses every round, and the one
 * reading they are all about.
 *
 * Hit points were a sentence at the bottom of this card -- the same numbers
 * the strip carries, in words, under the buttons that move them. So the meter
 * is here, the same one the build Overview draws, with the four figures that
 * matter beside it: what is left, what the maximum is right now (negative
 * levels take both), the temporary points on top, and how far below zero
 * death is. And temporary hit points can be *granted* here, which is the one
 * thing that happens in a fight and could only be done from the build view.
 */
function dashQuickCard(model, ctx) {
    const hp = model.hpState;
    const maxNow = hp.max;
    const curNow = hp.current;
    const status = hp.dead ? 'dead' : hp.dying ? 'dying' : hp.unconscious ? 'unconscious' : null;
    const fig = (label, value, title, cls = '') => `<span class="dashhpfig${cls ? ` ${cls}` : ''}"
      title="${esc(title)}"><span class="k">${esc(label)}</span><span class="v">${value}</span></span>`;
    return `<section class="panel span2">
      <h3>Quick actions
        ${status ? `<span class="badge err">${status}</span>` : ''}
        ${hp.temp ? `<span class="badge">+${hp.temp} temp</span>` : ''}
        ${hp.nonlethal ? `<span class="badge${hp.nonlethal >= hp.effective ? ' err' : ''}">${hp.nonlethal} nonlethal</span>` : ''}
      </h3>
      ${meterVisual(model.meterSpec('hp'))}
      <div class="dashhp">
        ${fig('HP', `<strong class="${curNow < maxNow ? 'bad' : ''}">${curNow}</strong>/${maxNow}`,
    hp.shift ? `Base ${hp.baseCurrent}/${hp.baseMax}. Negative levels and buffs change both current and maximum hit points.` : 'Current over maximum')}
        ${fig('Temp', hp.temp || '—', hp.tempGranted
    ? `${hp.typedTemp} of your own and ${hp.tempGrantLeft} of ${hp.tempGranted} granted by a rule. Damage uses these first.`
    : 'Temporary hit points. Damage uses these first. They do not stack; the highest applies.')}
        ${fig('Nonlethal', hp.nonlethal || '—', 'You fall unconscious when nonlethal damage equals your current hit points.')}
        ${fig('Dead at', minus(hp.deathAt), `−(Con ${hp.conScore}${hp.deathBonus ? ` + ${hp.deathBonus}` : ''}). You fall unconscious at 0.`,
    hp.dying ? 'bad' : '')}
      </div>
      <div class="pair" style="flex-wrap:wrap">
        <input type="number" min="0" data-draft="quickHp" value="${esc(ctx.draft.quickHp ?? '')}"
          placeholder="Amount" style="width:5.5rem" aria-label="Hit points to apply">
        <button data-action="quick-damage"
          title="Take damage. Temporary hit points are used first.">Damage</button>
        <button data-action="quick-nonlethal"
          title="Take nonlethal damage. It does not lower current hit points, and temporary hit points do not absorb it.">Nonlethal</button>
        <button data-action="quick-heal"
          title="Heal up to maximum hit points. Healing also removes the same amount of nonlethal damage.">Heal</button>
        <button data-action="quick-temp"
          title="Gain temporary hit points. They do not stack; you keep the higher amount.">+ Temp</button>
        <span class="dashsep" aria-hidden="true"></span>
        ${restButtons()}
      </div>
      <p class="hint">Enter an amount, then press a button.</p>
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
        <p class="empty">No casting classes yet. Add one on the Vancian tab.</p></section>`;
    }
    const classRow = (c, ci) => {
      const base = `vancian.classes.${ci}`;
      const spends = prepStyle(c.prep).slots === 'pool';
      const noun = c.noun || castingNoun(c.source);
      const levels = (c.spells || []).map((s, si) => {
        if (!s.slots || s.atWill) return '';
        return `<span class="dashslot"><span class="dim">L${s.level}</span>${spends
          ? slotSpend({ pool: `slots:${base}.spells|${si}`, total: s.slots, left: s.left, name: `${noun.one} level ${s.level}` })
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
      <span class="sname" title="${esc(r.note ? `${r.name}: ${proseText(model, r.note)}` : r.name)}">${esc(r.name)}${r.classLevel ? ` <span class="dim">${esc(r.classLevel)}</span>` : ''}</span>
      <span class="suses">${slotSpend({ pool: `slots:vancian.prepared|${i}`, total: r.uses, left: r.left, shape: 'squares', name: r.name })
        || '<span class="dim">—</span>'}</span>
    </div>`;
    return `<section class="panel span2">
      <h3>Spells &amp; slots
        ${v.calc?.spent ? `<span class="badge">${v.calc.spent} spent today</span>` : ''}
        <button style="margin-left:auto" data-action="vancian-new-day"
          title="Restore all spent slots.">New day</button>
      </h3>
      ${classes.map(classRow).join('')}
      ${prepared.length ? `<div class="dashspells">${prepared.map(prow).join('')}</div>` : ''}
      <p class="hint">Click a pip to spend a slot, or a square to cast a prepared spell. Tables,
        DCs and spell lists are on the Vancian tab.</p>
    </section>`;
  }

  /** The day's power points, spendable in place; the tab holds the powers. */
function dashPsionicsCard(model) {
    const p = model.data.psionics;
    const pool = Number(p?.pool) || 0;
    if (!p || (!pool && !(p.classes || []).length)) {
      return `<section class="panel"><h3>Power points</h3>
        <p class="empty">No manifesting classes yet. Add one on the Psionics tab.</p></section>`;
    }
    const left = Number(p.left) || 0;
    return `<section class="panel">
      <h3>Power points <span class="badge">${left} of ${pool}</span>
        <button class="linkish" style="margin-left:auto" data-action="psionics-new-day"
          title="Restore the whole pool.">New day</button>
      </h3>
      ${meterVisual(model.meterSpec('pp'), { pool: 'pp' })}
      <div class="tracker-controls" style="margin-top:6px">
        ${powerPointStepper(left, pool)}
      </div>
    </section>`;
  }

  /** A DC as it stands right now: buffed values replace the base, base in the tooltip. */
function dcShown(model, base) {
    const cs = model.conditionState;
    const d = cs.changed ? (cs.delta.dc || 0) : 0;
    return movedValue(d ? `${(Number(base) || 0) + d}` : `${base ?? 0}`, d, { base: `${base ?? 0}`, sources: cs.sources });
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
      const baseScore = Number(a.workingScore ?? a.tempScore) || 0;
      const score = cs.changed ? (cs.scores[k] ?? baseScore) : baseScore;
      // The same sum the d20 copy rolls: the ability's own movement plus the
      // flat penalty on ability checks (a negative level's, say).
      const delta = cs.changed ? (cs.deltas[k] || 0) + (cs.delta.abilityChecks || 0) : 0;
      const mod = (Number(a.totalMod) || 0) + delta;
      const movedScore = score !== baseScore;
      return `<div class="statline">
        <span class="label"><span class="abmark" data-ab="${k}">${ABILITY_LABELS[k]}</span>
          <span class="dim">${movedValue(`${score}`, movedScore ? score - baseScore : 0, { base: `${baseScore}`, sources: cs.sources })}</span></span>
        <span class="value rollpair">${movedValue(delta ? fmt(mod) : fmt(a.totalMod), delta, {
    base: fmt(a.totalMod), sources: cs.sources,
  })}${rollButton(model, 'ability', k, `a ${ABILITY_LABELS[k]} check`, cs)}</span>
      </div>`;
    };
    return `<section class="panel">
      <h3>Ability checks</h3>
      <div class="rowlist dashabilities">${ABILITIES.map(row).join('')}</div>
    </section>`;
  }

  /**
   * The Spheres figures a round actually asks for, with the concentration
   * d20: the casting numbers for a caster, the practitioner DC for a
   * practitioner, both for both -- each only where that side is in use, so a
   * pure caster is not shown a practitioner DC nor a martial stat block a
   * caster level of 0.
   */
function dashSpheresCard(model) {
    const t = model.data.training || {};
    const m = trainingSideInUse(model, 'magic') ? t.magic : null;
    const combat = trainingSideInUse(model, 'combat') ? t.combat : null;
    if (!m && !combat) {
      return `<section class="panel"><h3>Sphere numbers</h3>
        <p class="empty">No sphere training. Add it on the Magic or Martial Spheres tab.</p></section>`;
    }
    return `<section class="panel">
      <h3>${m ? 'Casting numbers' : 'Sphere numbers'}</h3>
      ${m ? `${line('Caster level', m.globalCL ?? 0)}
      ${lineHtml('Concentration', `<span class="rollpair">${fmt(m.concentration ?? 0)}${
        rollButton(model, 'concentration', 'magic', 'a concentration check')}</span>`, true)}
      ${line('MSB / MSD', `${fmt(m.msb ?? 0)} / ${m.msd ?? 0}`)}
      ${lineHtml('Save DC', dcShown(model, m.globalDC), true)}
      ${line('Spell points', `${m.availableSP ?? m.totalSP ?? 0} of ${m.totalSP ?? 0}`)}` : ''}
      ${combat ? lineHtml('Practitioner DC', dcShown(model, combat.practitionerDC), true) : ''}
      ${m ? `<p class="hint">Spend points on their tracker in Resources. Talents are on the Magic
        Spheres tab.</p>` : ''}
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
    const pool = movedValue(`${free + dEss} free of ${total + dEss}`, dEss, {
      title: `${movedTitle(`${free} free of ${total}`, cs.sources)}. Invest essence on the Akashic tab.`,
    });
    return `<section class="panel">
      <h3>Veils shaped ${shaped.length ? `<span class="badge">${shaped.length}</span>` : ''}</h3>
      ${total || dEss ? lineHtml('Essence', pool, true) : ''}
      <div class="rowlist">${shaped.map(({ slot, v }) => `<div class="statline">
        <span class="label" title="${esc(v.name || '')}">${esc(v.name || '—')} <span class="dim">${esc(slot || '')}</span></span>
        <span class="value">${Number(v.essence) ? `${v.essence} essence · ` : ''}DC ${dcShown(model, v.dc)}</span>
      </div>`).join('') || '<p class="empty">No veils shaped. Shape veils on the Akashic tab.</p>'}</div>
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
        <span class="label" title="${esc(e.name)}${entry.type || e.type ? ` (${esc(entry.type || e.type)})` : ''}">${esc(e.name)}</span>
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
    || '<p class="empty">Nothing readied. Ready maneuvers on the Maneuvers tab.</p>'}
    </section>`;
  }

  /**
   * The sphere talents, one clamped line each, grouped by side -- a reference
   * the table can scan without opening the training grids.
   */
function dashTalentsCard(model) {
    const t = model.data.training || {};
    // The hover is the line's whole text as it reads, formulas worked out.
    const line = (text) => `<div class="dashtalent" title="${esc(proseText(model, text))}">${hasTokens(text)
      ? renderedProse(model, text) : esc(text)}</div>`;
    // The talents the character has now, filed under the kind they count as:
    // the same rows the sphere tallies count (a slot the class grants, at a
    // level reached; a blended pool's talent on the side its sphere belongs
    // to), plus the drawn customized weapon's.
    const byKind = { combat: [], magic: [], guile: [] };
    const put = (key, talent) => {
      const v = String(talent || '').trim();
      if (v) byKind[key].push(v);
    };
    for (const key of ['combat', 'magic']) {
      for (const row of ownTalentRows(model, t[key], { sideKey: key })) put(key, row.talent);
    }
    for (const row of guileTalentRows(t.guile, t)) put('guile', row.talent);
    for (const block of t.combat?.customizations || []) {
      const set = (block.sets || [])[Number(block.active) || 0];
      if (!set || set.spare) continue;
      for (const row of set.talents || []) if (row.granted !== false) put(trackTalentSide(row.sphere), row.talent);
    }
    const side = (key, label) => {
      const texts = byKind[key];
      if (!texts.length) return '';
      return `<h4 class="subhead">${label} <span class="badge">${texts.length}</span></h4>
        ${texts.map(line).join('')}`;
    };
    const body = `${side('combat', 'Combat')}${side('magic', 'Magic')}${side('guile', 'Skill')}`;
    return `<section class="panel">
      <h3>Talents</h3>
      ${body || '<p class="empty">No talents yet. Add them on the Martial, Magic or Guile Spheres tab.</p>'}
      ${body ? '<p class="hint">Hover over a line to see its full text.</p>' : ''}
    </section>`;
  }


  /**
   * The sub-system cards a stat block borrows: for every system the creature
   * actually uses -- or a class row marks -- the same card the session
   * dashboard shows, so a monster given the Vancian tab prints its slots and
   * a Path of War monster its readied maneuvers, off the one set of pips.
   *
   * Only the reference cards. The standing ones (conditions, resources,
   * offense…) are the block's own lines, printed once.
   */
export function dashSystemCards(model) {
    const inUse = model.systemTabsInUse();
    const tagged = model.taggedSystemTabs();
    const on = (id) => inUse[id] || tagged.has(id);
    const out = [];
    if (on('vancian')) out.push(dashVancianCard(model));
    if (on('psionics')) out.push(dashPsionicsCard(model));
    if (on('magic') || on('martial')) out.push(dashSpheresCard(model), dashTalentsCard(model));
    else if (on('guile')) out.push(dashTalentsCard(model));
    if (on('akashic')) out.push(dashVeilsCard(model));
    if (on('maneuvers')) out.push(dashManeuversCard(model));
    return out.join('');
  }

function detailsPanel(model, ctx) {
    const c = model.data;
    const rules = campaignRules(c);
    return `<section class="panel details">
      <h3>Details</h3>
      ${/* The `col*` classes are how many of six columns each field takes once
            the panel is a phone's width, and they do nothing at any other --
            the rules for them live inside the container query, so this grid is
            still `auto-fit` on a desktop and untouched by them. A level is two
            characters and a size is one word; a row each spent 1,064px on
            sixteen fields holding a line of text between them.

            The order is the one that tiles: each line adds to exactly six, so
            nothing is left half a line and no field is squeezed under its own
            longest value. Three drove it -- `Gargantuan` and `Chaotic Neutral`
            do not fit a sixth-of-a-panel box (a select cannot even be scrolled
            to read the rest), and the two mythic fields are one thing asked
            twice, so they start a line together rather than wherever the
            packing left off. */''}
      <div class="fieldgrid">
        ${field('Character name', text('identity.name', c.identity.name), 'col6')}
        ${field('Player', text('identity.player', c.identity.player), 'col3')}
        ${field('Race', text('identity.race', c.identity.race), 'col3')}
        ${field('Variant', text('identity.variant', c.identity.variant), 'col3')}
        ${field('Deity', text('identity.deity', c.identity.deity), 'col3')}
        ${field('Size', select('identity.size', c.identity.size, Object.keys(SIZE_MODIFIERS)), 'col3')}
        ${field('Alignment', text('identity.alignment', c.identity.alignment), 'col3')}
        ${/* Without hero points (a campaign rule) the level pairs with Gender
              instead, so the phone's rows still come out whole. */''}
        ${/* The campaign's lowest and highest levels bound the box; one typed
              outside them is kept and flagged, as the GM may have reasons. */''}
        ${field('Level', num('identity.level', c.identity.level, `min="${rules.minLevel}" max="${rules.maxLevel}"${(() => {
    const lvl = Number(c.identity.level) || 0;
    if (lvl > rules.maxLevel) return ` class="over" title="Above the campaign's highest level of ${rules.maxLevel}."`;
    if (lvl < rules.minLevel) return ` class="over" title="Below the campaign's lowest level of ${rules.minLevel}."`;
    return '';
  })()}`), rules.heroPoints ? 'col2' : 'col3')}
        ${/* An antihero (where the campaign offers it) has given the points up
              for a feat: the box says so in place of the counter. */''}
        ${rules.heroPoints ? field('Hero points', `<span class="pair">
          ${isAntihero(c) ? '<span class="value" title="Hero points traded for a bonus feat on the Feats &amp; Mythic tab.">none: antihero</span>' : `
          ${num('identity.heroPoints.current', c.identity.heroPoints?.current ?? 0)}
          <span>/</span>${num('identity.heroPoints.max', c.identity.heroPoints?.max ?? 3)}`}
          ${rules.antiheroes ? check('identity.antihero', c.identity.antihero === true, 'Antihero',
    'Give up hero points for a bonus feat. The campaign rules offer it.') : ''}</span>`, 'col4') : ''}
        ${field('Gender', text('identity.gender', c.identity.gender), 'col3')}
        ${field('Age', text('identity.age', c.identity.age), 'col3')}
        ${field('Age category', select('identity.ageCategory', c.identity.ageCategory, AGE_CATEGORIES), 'col3')}
        ${field('Height', text('identity.height', c.identity.height), 'col3')}
        ${field('Weight', text('identity.weight', c.identity.weight), 'col3')}
        ${/* Mythic off (a campaign rule) takes the whole row with it. */''}
        ${rules.mythic ? `${field('Mythic path', text('identity.mythicPath', c.identity.mythicPath), 'col3')}
        ${rules.mythicTier === 'awarded'
    ? field('Mythic tier (awarded)', `<span class="value" title="The tier awarded by the GM, set on the Feats &amp; Mythic tab.">${esc(c.identity.mythicTier ?? 0)}</span>`, 'col3')
    : field('Mythic tier (auto)', `<span class="value" title="${rules.mythicTier === 'trials'
      ? 'From trials. Use Tier up on the Feats &amp; Mythic tab.' : 'From level. Override it on the Feats &amp; Mythic tab.'}">${esc(c.identity.mythicTier ?? 0)}</span>`, 'col3')}` : ''}
        ${/* The last row: a nickname in the first column, and the portrait's
              link across the rest -- a URL still wants more than a column. */''}
        <div class="portraitrow">
          ${field('Nickname', text('identity.nickname', c.identity.nickname), 'col2')}
          ${field('Portrait URL', text('identity.image', c.identity.image, 'https://…'), 'portraiturl')}
        </div>
      </div>
      ${portraitFrameRow(c.identity)}
      ${levelProgressRow(model, ctx)}
      ${characterColorRow(c.identity.color)}
    </section>`;
  }

/**
 * Which part of the portrait shows in its square, once there is a picture:
 * the point kept in view and how far in. The header's picture follows the
 * sliders as they move (sheet-element, `data-frame`).
 */
function portraitFrameRow(i) {
    if (!String(i.image ?? '').trim()) return '';
    const f = portraitFrame(i.imageFrame);
    const slider = (key, label, min, max, step) => `<label class="pair">${label}
        <input type="range" min="${min}" max="${max}" step="${step}" value="${f[key]}" data-set="identity.imageFrame.${key}"
          data-kind="number" data-frame="${key}" aria-label="Portrait ${label.toLowerCase()}"></label>`;
    return `<div class="tstyle-row portraitframe">
      <span class="tlabel">Portrait framing</span>
      ${slider('x', 'Horizontal', 0, 100, 1)}
      ${slider('y', 'Vertical', 0, 100, 1)}
      ${slider('zoom', 'Zoom', 100, 400, 5)}
      <span class="hint">Sets which part of the picture fills the square.</span>
    </div>`;
  }

  /**
   * How far the character is toward the next level, when the campaign earns
   * levels by XP or milestones: the count, a bar from this level's mark to
   * the next, and -- once the next level is earned -- a button that takes it.
   * The level never moves on its own: it drives a great deal, and the button
   * is one undoable step that also goes in the play log. XP has an Add box
   * for an award at the table, since a running total is not what a GM reads
   * out.
   */
function levelProgressRow(model, ctx) {
    const p = levelProgress(model.data);
    if (!p) return '';
    const xp = p.mode === 'xp';
    const n = (v) => Number(v).toLocaleString('en-US');
    const span = p.need === null ? 0 : p.need - p.from;
    const done = p.unset ? 0 : p.need === null ? 1 : span > 0 ? Math.min(1, Math.max(0, (p.have - p.from) / span)) : (p.ready ? 1 : 0);
    const said = p.next === null ? `Level ${p.level} is the campaign's highest level.`
      : p.unset ? `Level ${p.next} has no XP requirement. Set one in Campaign rules on the ⚙ tab.`
      : p.ready ? `Level ${p.next} is earned.`
        : xp ? `${n(p.short)} XP to level ${p.next} (${n(p.need)} total).${p.have < p.from
          ? ` Level ${p.level} needs ${n(p.from)} XP; the level was set before the XP.` : ''}`
          : `${p.short} more milestone${p.short === 1 ? '' : 's'} to level ${p.next}.`;
    return `<div class="levelprogress">
      <label class="fld"><span>${xp ? 'Experience points' : 'Milestones toward the next level'}</span>
        <input type="number" min="0" value="${esc(p.have)}" data-set="identity.${xp ? 'xp' : 'milestones'}" data-kind="number"
          aria-label="${xp ? 'Experience points' : 'Milestones'}" style="width:${xp ? '8rem' : '4.5rem'}"></label>
      ${xp ? `<span class="pair xpaward"><input type="number" data-draft="xpAward" value="${esc(ctx?.draft?.xpAward ?? '')}"
          placeholder="+ XP" aria-label="XP to add" style="width:6rem">
        <button data-action="xp-award" title="Add this to the XP total. You can undo it.">Add</button></span>` : ''}
      <div class="lpline">
        <div class="lpbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(done * 100)}"
          title="${esc(said)}"><div style="width:${(done * 100).toFixed(1)}%"></div></div>
        <span class="hint">${esc(said)}</span>
        ${p.ready ? `<button class="levelup" data-action="level-up" title="Go up to level ${p.next}. You can undo it.">Level up to ${p.next}</button>` : ''}
      </div>
    </div>`;
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
    return `<div class="tstyle-row charcolor">
      <span class="tlabel">Character color</span>
      ${colorControl('character', value, { label: 'Character color' })}
      <span class="hint">Sets the sheet’s accent color and the default color for trackers and meters.</span>
    </div>`;
  }














/* ---------------- the read-only summaries ---------------- */

/** The tabs the read-only panels are edited on, by the name each has until the player renames it. */
const HOME_TAB_NAMES = { stats: 'Stats', progression: 'Progression', gear: 'Equipment', lore: 'Background' };

/**
 * The button in a read-only panel's heading that goes to the panel it
 * summarizes, on the tab it is edited on (`home:<key>`, ui/formula-places.js).
 */
function editLink(model, key) {
  const tab = HOMES[key]?.tab;
  const name = model.tabName?.(tab) || HOME_TAB_NAMES[tab] || tab;
  return `<button type="button" class="editlink" data-view data-action="go-home" data-place="home:${esc(key)}"
      title="${esc(`Edit this on the ${name} tab.`)}">Edit on ${esc(name)}</button>`;
}

/** The classes, their levels and what each advances. */
function classesSummary(model) {
  const c = model.data;
  const rows = (c.classes || []).filter((x) => String(x.name || '').trim());
  const rate = (v) => BAB_RATES.find(([r]) => r === Number(v))?.[1] ?? fmt(Number(v) || 0);
  const good = (x) => [x.goodFort && 'Fort', x.goodRef && 'Ref', x.goodWill && 'Will'].filter(Boolean).join(', ') || '—';
  const archetypes = (x) => [...(Array.isArray(x.archetypeStack) ? x.archetypeStack.map((a) => a.name) : []),
    ...String(x.archetypes || '').split(/\s*[,;]\s*/)].map((a) => String(a || '').trim()).filter(Boolean).join(', ');
  return `<section class="panel span2">
      <h3>Classes ${editLink(model, 'classes')}</h3>
      ${rows.length ? `<div class="tablewrap"><table class="rosummary stacked cardrows">
        <thead><tr><th>Class</th><th class="num">Levels</th><th class="num">HD</th><th>BAB</th>
          <th>Good saves</th><th class="num">Ranks</th><th>Archetypes</th></tr></thead>
        <tbody>${rows.map((x) => `<tr>
          <td data-stack="name"><strong>${esc(x.name)}</strong></td>
          <td class="num" data-label="Levels" data-inline="spec">${esc(x.levelsOverride ?? x.gestaltLevels ?? 0)}</td>
          <td class="num" data-label="Hit die" data-inline="spec">${x.hd ? `d${esc(x.hd)}` : '—'}</td>
          <td data-label="BAB" data-inline="spec">${esc(rate(x.bab))}</td>
          <td data-label="Good saves" data-inline="save">${esc(good(x))}</td>
          <td class="num" data-label="Ranks" data-inline="spec">${esc(x.skillRanks ?? 0)}</td>
          <td data-label="Archetypes">${esc(archetypes(x)) || '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No classes yet.</p>'}
    </section>`;
}

/** A trait's or feature's effect, as its text reads with any formulas worked out. */
function effectText(model, text) {
  return String(text ?? '').trim() ? renderedProse(model, text, null, { links: true }) : '';
}

function raceTraitsSummary(model) {
  const c = model.data;
  const race = (c.raceTraits || []).filter((t) => String(t.name || '').trim() || String(t.text || '').trim());
  const who = [c.identity.race, c.identity.variant ? `(${c.identity.variant})` : ''].filter(Boolean).join(' ');
  return `<section class="panel racepanel">
      <h3>Race traits <span class="badge">${race.length}</span>
        ${who ? `<span class="hint">${esc(who)}</span>` : ''} ${editLink(model, 'race-traits')}</h3>
      ${race.length ? `<div class="tablewrap"><table class="rosummary">
        <tbody>${race.map((t) => (String(t.name || '').trim()
    ? `<tr><th scope="row">${esc(t.name)}</th><td>${effectText(model, t.text)}</td></tr>`
    : `<tr><td colspan="2">${effectText(model, t.text)}</td></tr>`)).join('')}</tbody>
      </table></div>` : '<p class="empty">No race traits yet.</p>'}
    </section>`;
}

function traitsSummary(model) {
  const c = model.data;
  const slots = c.traitSlots || {};
  const filled = (v) => !!(v?.name || v?.text);
  const rows = [
    ...TRAIT_SLOTS.filter((d) => d.kind !== 'feat' && filled(slots[d.key])).map((d) => [d.label, slots[d.key]]),
    ...(slots.additional || []).filter(filled).map((x) => ['Additional', x]),
  ];
  const picked = ['trait1', 'trait2', 'trait3'].filter((k) => slots[k]?.name || slots[k]?.text || slots[k]?.category).length;
  return `<section class="panel traitspanel">
      <h3>Traits &amp; drawbacks
        <span class="badge${picked < 3 ? ' err' : ' ok'}">${picked} of 3 picked</span> ${editLink(model, 'traits')}</h3>
      ${rows.length ? `<div class="tablewrap"><table class="rosummary">
        <tbody>${rows.map(([slot, v]) => `<tr><th scope="row">${esc(v.name || slot)}${v.name ? `<div class="hint">${esc(slot)}</div>` : ''}</th>
          <td>${effectText(model, v.text)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No traits picked yet.</p>'}
    </section>`;
}

function specialtySummary(model) {
  const c = model.data;
  const perks = (c.identity.specialtyPerks || []).filter((t) => String(t ?? '').trim());
  return `<section class="panel">
      <h3>Specialty ${editLink(model, 'specialty')}</h3>
      ${line('Specialty', c.identity.specialty || '—')}
      ${line('Specialty feat', c.grantedFeats?.specialty?.name || '—')}
      ${perks.map((t, i) => lineHtml(`Perk ${i + 1}`, effectText(model, t))).join('')}
    </section>`;
}

function languagesSummary(model) {
  const i = model.data.identity;
  const slots = i.languageSlots || { total: 0, known: 0 };
  return `<section class="panel">
      <h3>Languages
        <span class="badge${slots.known > slots.total ? ' err' : ''}" title="Languages known / slots from Int, Linguistics and Extra.">${slots.known} / ${slots.total}</span>
        ${editLink(model, 'languages')}</h3>
      ${languageCopy(i)}
    </section>`;
}

function hitPointsSummary(model) {
  const hp = model.hpState;
  return `<section class="panel hitpoints">
      <h3>Hit points
        ${hp.nonlethal > 0 ? `<span class="badge${hp.nonlethal >= hp.effective ? ' err' : ''}">${hp.nonlethal} nonlethal</span>` : ''}
        ${editLink(model, 'hp')}</h3>
      ${meterVisual(model.meterSpec('hp'))}
      ${lineHtml('Current', `${hp.current} / ${hp.max}${hp.temp > 0
    ? ` <span class="hptemp" title="Temporary hit points, used first.">+${hp.temp}</span>` : ''}`, true)}
      ${line('Dead at', minus(hp.deathAt))}
      ${hpStatus(hp)}
    </section>`;
}

/** The five defense boxes as they now stand, once formulas and forwarded bonuses are in. */
function defenseLines(model) {
  const d = model.data.defenses;
  const calc = d.calc || {};
  return [
    ['Spell resistance', calc.sr?.text, d.spellResistance], ['DR', calc.drText, d.dr],
    ['Resistance', calc.resistanceText, d.resistance], ['Vulnerability', calc.weaknessText, d.weakness],
    ['Immunities', calc.immunitiesText, d.immunities],
  ].map(([label, now, typed]) => [label, String(now || '').trim() || proseText(model, typed || '').trim()])
    .filter(([, shown]) => shown)
    .map(([label, shown]) => line(label, shown)).join('');
}

function armorClassSummary(model) {
  const d = model.data.defenses;
  const cs = model.conditionState;
  return `<section class="panel fit">
      <h3>Armor class ${editLink(model, 'ac')}</h3>
      ${lineHtml('Armor Class', movedInline(cs, 'ac', d.ac, String, model), true)}
      ${lineHtml('Touch', movedSub(cs, 'touch', d.touch, String))}
      ${lineHtml('Flat-footed', movedSub(cs, 'flatFooted', d.flatFooted, String))}
      ${lineHtml('CMD', movedInline(cs, 'cmd', d.cmd, String, model))}
      ${lineHtml('Flat-footed CMD', movedSub(cs, 'ffCmd', d.ffCmd, String))}
      ${line('AC ability', [d.acStat1, d.acStat2].filter(Boolean).join(' + ') || '—')}
      ${d.uncannyDodge ? line('Uncanny dodge', 'Yes') : ''}
      ${defenseLines(model)}
      ${cs.acVsMelee || cs.acVsRanged ? `<p class="hint warn">
        ${cs.acVsMelee ? `${fmt(cs.acVsMelee)} AC against melee` : ''}${cs.acVsMelee && cs.acVsRanged ? ', ' : ''}${
          cs.acVsRanged ? `${fmt(cs.acVsRanged)} AC against ranged` : ''} from conditions, in addition to the numbers above.
      </p>` : ''}
    </section>`;
}

/** The three saves and initiative: totals with a roll each, and the abilities they use. */
function savesSummary(model) {
  const c = model.data;
  const s = c.saves;
  const cs = model.conditionState;
  const abilities = (a, b) => esc([a, b].filter(Boolean).join(' + ') || '—');
  const row = (label, total, roll, base, a, b) => `<tr>
      <th scope="row">${label}</th>
      <td class="num total"><span class="rollpair">${total}${roll}</span></td>
      <td class="num">${base}</td>
      <td>${abilities(a, b)}</td>
    </tr>`;
  return `<section class="panel fit">
      <h3>Saves &amp; initiative ${editLink(model, 'saves')}</h3>
      <div class="tablewrap"><table class="rosummary fitcols">
        <thead><tr><th></th><th class="num">Total</th><th class="num" title="From the Classes table">Base</th><th>Ability</th></tr></thead>
        <tbody>
          ${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => row(label,
    movedInline(cs, k, s[k].total, fmt, model), rollButton(model, 'save', k, `a ${label} save`, cs),
    esc(s[k].base), s[k].stat1, s[k].stat2)).join('')}
          ${row('Initiative', movedInline(cs, 'initiative', c.hp.initiative, fmt, model),
    rollButton(model, 'initiative', 'self', 'initiative', cs), '—', c.hp.initAbility || 'Dex', c.hp.initAbility2)}
        </tbody>
      </table></div>
    </section>`;
}

function attackSummary(model) {
  const c = model.data;
  const cs = model.conditionState;
  const modes = c.attack.modes || {};
  // An alternate shows once it uses another ability than the attack it is an alternate of.
  const alts = ATTACK_MODES.filter((k) => ALT_ATTACK_OF[k] && modes[k]?.stat1
    && modes[k].stat1 !== modes[ALT_ATTACK_OF[k]]?.stat1);
  return `<section class="panel fit">
      <h3>Attack ${editLink(model, 'attack')}</h3>
      ${lineHtml('Melee', `${movedInline(cs, 'melee', c.attack.totalMelee, fmt, model)}${
        rollButton(model, 'mode', 'melee', 'a melee attack', cs)}`, true)}
      ${lineHtml('Ranged', `${movedInline(cs, 'ranged', c.attack.totalRanged, fmt, model)}${
        rollButton(model, 'mode', 'ranged', 'a ranged attack', cs)}`, true)}
      ${lineHtml('CMB', `${movedInline(cs, 'cmb', c.attack.totalCmb, fmt, model)}${
        rollButton(model, 'mode', 'cmb', 'a combat maneuver', cs)}`, true)}
      ${alts.map((k) => lineHtml(`${ATTACK_MODE_LABELS[k]} (${modes[k].stat1})`,
    `${movedInline(cs, k, attackModeTotal(c, k) ?? 0, fmt)}${rollButton(model, 'mode', k, `${ATTACK_MODE_LABELS[k].toLowerCase()} attacks`, cs)}`)).join('')}
      ${line('Base attack bonus', fmt(c.attack.bab))}
      ${line('Iteratives', c.attack.iterative || '—')}
      ${cs.changed && cs.delta.damage ? `<p class="hint warn">${fmt(cs.delta.damage)} on weapon damage rolls from ${cs.sources}.</p>` : ''}
    </section>`;
}

function speedSummary(model) {
  const c = model.data;
  const cs = model.conditionState;
  // The rates the character has; a Fly or Swim row at 0 ft. is a row waiting to be filled in.
  const speeds = (c.identity.speeds || []).filter((sp) => Number(sp.final) > 0);
  return `<section class="panel fit">
      <h3>Speed ${editLink(model, 'speed')}</h3>
      ${speeds.length ? speeds.map((sp) => {
    const i = c.identity.speeds.indexOf(sp);
    const adj = cs.speeds?.[i];
    const shown = cs.changed && adj && adj.adjusted !== adj.final
      ? movedValue(`${adj.adjusted} ft.`, adj.adjusted - adj.final, { base: `${adj.final} ft.`, sources: cs.sources })
      : esc(`${Number(sp.final) || 0} ft.`);
    return lineHtml(sp.type || 'Speed', `${shown}${sp.loadSlowed
      ? ' <span class="badge" title="Reduced by a medium or heavy load.">load</span>' : ''}`);
  }).join('') : '<p class="empty">No speeds yet.</p>'}
    </section>`;
}

function carrySummary(model) {
  const c = model.data;
  const lbs = (v) => (v != null ? `${v} lbs` : '—');
  return `<section class="panel fit">
      <h3>Carrying capacity ${editLink(model, 'carry')}</h3>
      ${line('Light', lbs(c.carry?.light))}
      ${line('Medium', lbs(c.carry?.medium))}
      ${line('Heavy', lbs(c.carry?.heavy))}
      ${line('Currently carried', `${c.carry?.carried ?? 0} lbs`)}
      ${loadLine(c)}
    </section>`;
}

function proficienciesSummary(model) {
  const p = model.data.identity.proficiencies || {};
  const list = (xs) => (xs || []).map((x) => String(x || '').trim()).filter(Boolean);
  const weapons = [
    ...list(p.familiarities).map((f) => `${f.toLowerCase()} weapons`),
    ...list(p.handedness).map((h) => `${h.toLowerCase()} weapons`),
    ...list(p.groups).map((g) => `${g.toLowerCase()} group`),
    ...list(p.weapons),
  ];
  return `<section class="panel proficiencies">
      <h3>Proficiencies ${editLink(model, 'proficiencies')}</h3>
      ${line('Weapons', weapons.join(', ') || 'None')}
      ${line('Armor', list(p.armor).join(', ') || 'None')}
      ${line('Shields', list(p.shields).join(', ') || 'None')}
      ${String(p.notes || '').trim() ? line('Notes', p.notes) : ''}
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
      const by = Object.entries(info.skillsBy || {});
      if (by.length) bits.push(`${fmt(by[0][1])} ${by.map(([k]) => ABILITY_LABELS[k] || k).join('/')} skills`);
      for (const [k, v] of Object.entries(info.skill || {})) bits.push(`${fmt(v)} ${k[0].toUpperCase()}${k.slice(1)}`);
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
      return `<label class="cond${on ? ' on' : ''}${beaten ? ' beaten' : ''}" title="${esc(beaten ? `${title} (Replaced by a worse condition of the same kind.)` : title)}">
        <input type="checkbox" ${on ? 'checked' : ''} data-set="conditions.${esc(name)}" data-kind="flag" aria-label="${esc(label)}">
        <span class="cname">${esc(label)}</span>
        <span class="ceffect">${esc(short(info) || (info ? 'no numbers' : ''))}</span>
        ${removeControl(`data-remove-condition="${esc(name)}"`, { what: label, title: 'Remove this condition from the list', tiny: true })}
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
      <p class="hint">A ticked condition shows its effect on attacks, AC, saves, initiative, speed
        and ability modifiers as a <em>now</em> value beside the base. Shaken, frightened and
        panicked do not stack, and neither do fatigued and exhausted; the worse one applies.</p>
    </section>`;
  }


