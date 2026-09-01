/**
 * ui/panels/guile.js -- Spheres of Guile.
 *
 * The third sphere tab, and the one that is least like the other two once
 * you are past the front door. It reads top to bottom as the same story --
 * what the classes trained in, what came from elsewhere, the tradition, then
 * the numbers that fall out of all of it -- but the numbers at the bottom
 * are not a second Sphere CL / DC table. A skill sphere has no caster level
 * and no practitioner level; every DC, every range and every scaling talent
 * it has is read off the operative's *ranks in that sphere's associated
 * skill*, and those ranks are bought by the talents she spent in it. So the
 * sphere table here is the sphere table and the bonus-skill-ranks block at
 * once, and the associated skill is a dropdown rather than a lookup, because
 * in this system it is a choice the character made.
 *
 * Bodies keep the indentation the other sphere tab's do, and for the same
 * reason: the markup they return is whitespace-sensitive.
 */
import { esc } from '../html.js';
import { collapsible } from '../rows.js';
import { prose } from '../prose.js';
import { talentCell } from '../talents.js';
import { sphereForwardKey, sphereNames } from '../../model.js';
import { forwardedBadge } from '../badges.js';
import {
  ABILITY_LABELS, EXPERTISE_TIERS, GUILE_SPHERES, OPERATIVE_ABILITIES, RANKS_PER_TALENT,
  TRADE_BACKGROUND_SKILLS, TRADE_CLASS_SKILLS, TRADE_RANKS, expertiseTalents, fmt,
  guilePackages, guileSkillHint, skillLabel,
} from '../../rules.js';
import { DAILY_LEVERAGE_EXTRA } from '../../model.js';
import { check, select, text } from '../fields.js';
import {
  addButton, bigStat, editLine, exprField, itemCheck, itemSelect, itemText, line,
  rowRemove, rowTools,
} from '../rows.js';
import { classNames } from './combat.js';

/** What a sphere asks its associated skill to be, when it never said. */
const DEFAULT_GUILE_SKILL_HINT = 'Any skill the sphere names';

/** Every skill sphere a picker offers: the engine's list, plus a pack's. */
const guileSphereList = () => sphereNames(GUILE_SPHERES, 'guile');

/**
 * The character's own skills, by the name the Skills tab shows them under.
 *
 * The associated skill is stored as that label and not as an index, because
 * an index is the one thing about a skill row that moves: adding a Craft
 * above it would silently repoint every sphere below.
 */
function skillOptions(model) {
  const seen = new Set();
  const out = [];
  for (const s of model.data.skills || []) {
    const label = skillLabel(s.name, s.spec).trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function renderGuilePanel(model) {
    const g = model.data.training?.guile;
    if (!g) return '<div class="grid"><section class="panel"><h3>Guile Spheres</h3><p class="empty">No guile training on this character.</p></section></div>';
    const wrap = (key, html) => collapsible(model, key, html);
    // The three full-width groups sit in a strip, so folding them turns three
    // rows into one row of pills rather than three near-empty rows. See
    // `.foldstrip`.
    return `<div class="grid">
      <div class="foldstrip">
        ${wrap('guile-training', guileTrainingPanel(model, g))}
        ${wrap('guile-spheres', guileSpherePanel(model, g))}
        ${wrap('guile-bonus', guileBonusPanel(model, g))}
      </div>
      <div class="sidepanels">
        ${wrap('guile-tradition', tradeTraditionPanel(model, g))}
        ${wrap('guile-operative', operativePanel(model, g))}
      </div>
    </div>`;
  }

  /* ----- skill expertise: the class ladders ----- */

  /**
   * A class's talents, on two ladders side by side.
   *
   * This is the shape that makes guile guile. The other two systems grant a
   * talent every so many levels and the only question a row asks is which
   * one; a tier of skill expertise grants *unrestricted* talents on one rung
   * and *[utility]* talents on another, in addition to each other, and the
   * two ladders do not keep step -- a 1st-level Trained operative has no
   * free pick at all and one utility talent, and a Virtuoso has the reverse.
   * So each level is one row with two halves, each lighting up on its own.
   */
function guileTrainingPanel(model, g) {
    const list = 'training.guile.classes';
    const spheres = guileSphereList();
    const classes = g.classes || [];
    return `<section class="panel span2">
      <h3>Skill expertise ${classes.length ? `<span class="badge">${classes.length}</span>` : ''}</h3>
      ${classes.map((cls, ci) => {
        const at = expertiseTalents(cls.expertise, cls.classLevels || 0);
        return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld"><span>Class</span>
            ${itemSelect(list, ci, 'name', cls.name, classNames(model))}</label>
          <label class="fld"><span>Expertise tier</span>
            ${itemSelect(list, ci, 'expertise', cls.expertise, EXPERTISE_TIERS)}</label>
          <label class="fld"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              <input type="number" value="${cls.classLevelsOverride ?? ''}" placeholder="${cls.classLevels ?? 0}"
                data-item="${list}|${ci}|classLevelsOverride" data-kind="number-or-null" style="width:3.6rem">
              <span class="hint">${at.any} any · ${at.utility} utility</span>
            </span></label>
          <button class="danger" data-remove="${list}|${ci}" title="Remove class">×</button>
        </div>
        <div class="tablewrap"><table class="talents guileladder">
          <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes">
            <col class="talent"><col class="sphere"><col class="notes"></colgroup>
          <thead><tr><th class="num">Lvl</th>
            <th colspan="3">Any talent</th>
            <th colspan="3" class="util">[utility] talent</th></tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
            const slots = `${list}.${ci}.levels`;
            const on = !!lv.granted;
            const uOn = !!lv.utilityGranted;
            const state = on ? 'slot-on' : 'slot-off';
            const uState = uOn ? 'slot-on' : 'slot-off';
            const count = [
              on ? `Talent #${lv.count} at level ${lv.level}` : '',
              uOn ? `Utility talent #${lv.utilityCount}` : '',
            ].filter(Boolean).join(' · ') || `Level ${lv.level} grants nothing`;
            return `<tr class="${lv.future ? 'future' : ''}">
              <td class="num" title="${esc(count)}">${lv.level}</td>
              <td class="${state}">${talentCell(model,
    `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, lv.sphere,
    on ? { sphere: 'sphere', notes: 'notes' } : null)}</td>
              <td class="${state}">${on ? itemSelect(slots, li, 'sphere', lv.sphere, spheres)
                  : '<select disabled><option></option></select>'}</td>
              <td class="${state}">${prose(model,
    `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, 1, 'grow')}</td>
              <td class="${uState} util">${talentCell(model,
    `data-item="${slots}|${li}|utilityTalent"${uOn ? ' placeholder="[utility]…"' : ' disabled'}`,
    lv.utilityTalent, lv.utilitySphere,
    uOn ? { sphere: 'utilitySphere', notes: 'utilityNotes' } : null)}</td>
              <td class="${uState} util">${uOn ? itemSelect(slots, li, 'utilitySphere', lv.utilitySphere, spheres)
                  : '<select disabled><option></option></select>'}</td>
              <td class="${uState} util">${prose(model,
    `data-item="${slots}|${li}|utilityNotes"${uOn ? '' : ' disabled'}`, lv.utilityNotes, 1, 'grow')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
      }).join('')}
      ${classes.length ? '' : '<p class="empty">No operative classes yet.</p>'}
      <div style="margin-top:8px">
        <button class="primary" data-action="add-guile-class">+ Add class</button>
      </div>
      <p class="hint">
        A tier grants the talents in <strong>Any</strong> <em>in addition to</em> those in
        <strong>[utility]</strong> — they are two ladders, not two halves of one, which is why a
        level can light up neither slot, one, or both. Virtuoso runs 3/4 a free talent per level
        and a utility one every 2; Journeyman 1/2 and 1/2; Trained 1/4 and 1/2 — so a Trained
        operative's picks are mostly utility ones. Class levels come from the Planner; set the
        override for a sparse one. A class that trades its feats or its spellcasting for a
        progression (the two conversion tables) is one of these blocks like any other.
      </p>
    </section>`;
  }

  /* ----- the sphere table: ranks, DCs and ranges in one ----- */

  /**
   * What each sphere is, what it is associated with, and what falls out.
   *
   * The one table on this tab that has no counterpart on the other two, and
   * the reason the whole system needed its own module. Reading across: the
   * sphere, the package it was taken as, the skill that package was
   * associated with, how many talents went in, the ranks those talents
   * bought, and then the numbers those ranks *are* -- the save DC and the
   * three ranges. A sphere with no skill chosen yet is shown all the same
   * and reads zeroes, because the choice is the thing the row is asking for.
   */
function guileSpherePanel(model, g) {
    const list = 'training.guile.spheres';
    const rows = g.sphereRows || [];
    const skills = skillOptions(model);
    const spheres = guileSphereList();
    const level = Number(model.data.identity.level) || 0;
    const anyDupes = rows.some((r) => r.duplicate);
    // A number, or a rule: the model resolves it into `<field>Num` and flags
    // a bad one in `<field>Error`, so the cell shows the answer and the
    // source on a click, like every other formula field.
    const bonus = (r, i, field, example) => exprField(`data-item="${list}|${i}|${field}"`, r[field], {
      width: '4rem',
      value: r[`${field}Num`],
      error: r[`${field}Error`],
      title: `A number, or a formula — e.g. ${example}`,
    });
    return `<section class="panel span2">
      <h3>Skill spheres <span class="badge">${rows.length}</span></h3>
      ${rows.length ? `<div class="tablewrap"><table class="guilespheres">
        <thead><tr>
          <th>Sphere</th><th>Package</th><th>Associated skill</th>
          <th class="num">Talents</th><th class="num">Ranks</th>
          <th class="num" title="Extra ranks from a talent or feature">Rank+</th>
          <th class="num" title="A bonus to this sphere's save DC only">DC+</th>
          <th class="num">DC</th><th class="num">Close / med. / long</th><th></th>
        </tr></thead>
        <tbody>${rows.map((r, i) => {
    const packages = guilePackages(r.sphere);
    const hint = guileSkillHint(r.sphere, r.package) || DEFAULT_GUILE_SKILL_HINT;
    const owed = Math.min(level, (r.talents || 0) * RANKS_PER_TALENT);
    // A skill named here that the Skills tab has no row for -- most often a
    // row that was renamed underneath it. The pick is kept and marked rather
    // than blanked, because the name is still the answer to what this sphere
    // is associated with; it is the row that has gone missing.
    const lost = !!r.skill && r.skillIndex < 0;
    return `<tr>
          <td>${itemSelect(list, i, 'sphere', r.sphere, spheres)}</td>
          <td>${packages.length
      ? itemSelect(list, i, 'package', r.package, packages)
      : '<span class="hint">—</span>'}</td>
          <td class="${lost ? 'lostskill' : r.duplicate ? 'dupskill' : ''}"${lost
      ? ` title="${esc(`No skill on this character is called "${r.skill}". `
        + 'Add the row on the Skills tab, or pick the name it has now — until then this sphere '
        + 'reads as though it had no ranks at all.')}"` : r.duplicate
      ? ` title="${esc(`More than one sphere is associated with ${r.skill}. They never stack their ranks: `
        + 'one fills the skill and the overlap is worth a competence bonus of half your level instead.')}"` : ''}>
            ${itemSelect(list, i, 'skill', r.skill, skills)}
            <div class="req" title="${esc(`The sphere asks for: ${hint}`)}">${
  lost ? 'no such skill on this sheet' : esc(hint)}</div></td>
          <td class="num">${r.talents || ''}</td>
          <td class="num" title="${esc(r.paysRanks
      ? `${RANKS_PER_TALENT} ranks a talent, capped at ${level} Hit Dice. The skill's total is ${r.ranks}.`
        + (r.competence ? ` Another sphere shares this skill, so it pays +${r.competence} competence`
          + ' rather than a second helping of ranks.' : '')
      : r.duplicate
        ? `${owed} ranks earned and not paid: ${r.skill} is already filled by another sphere `
          + `— here or on the martial tab. The overlap is worth ${r.competence
            ? `the +${r.competence} competence bonus beside it` : 'a competence bonus'} instead.`
        : 'Choose an associated skill and this sphere pays into it.')}">${
  [r.paysRanks ? `${r.ranksGranted || ''}` : r.duplicate ? `<span class="was">${owed}</span>` : '',
    r.competence ? `<span class="dupskill">+${r.competence}</span>` : ''].filter(Boolean).join(' ')}</td>
          <td class="num">${bonus(r, i, 'rankBonus', 'floor(level / 4)')}${
  forwardedBadge(model, sphereForwardKey(r.sphere) ? `${sphereForwardKey(r.sphere)}.ranks` : '')}</td>
          <td class="num">${bonus(r, i, 'dcBonus', 'floor(level / 6)')}${
  forwardedBadge(model, sphereForwardKey(r.sphere) ? `${sphereForwardKey(r.sphere)}.dc` : '')}</td>
          <td class="num total"${r.skillIndex >= 0 ? ` title="${esc(`10 + half of ${r.ranks} ranks in ${r.skill}`
      + ` + ${fmt(g.operativeAbilityMod || 0)} operative modifier`)}"` : ''}>${r.dc ?? '—'}</td>
          <td class="num" title="25 ft. + 5 ft. per 2 ranks / 100 ft. + 10 ft. per rank / 400 ft. + 40 ft. per rank">${
  r.skillIndex >= 0 ? `${r.close} / ${r.medium} / ${r.long}` : '—'}</td>
          ${rowRemove(list, i)}
        </tr>`;
  }).join('')}</tbody>
      </table></div>` : '<p class="empty">Spend a talent on a sphere above and its row appears here.</p>'}
      <div style="margin-top:6px">
        <button data-action="add-guile-sphere">+ Add sphere</button>
      </div>
      <p class="hint">
        A skill sphere has no caster level and no practitioner level. Its save DC is
        <strong>10 + half your ranks in the associated skill + your operative modifier</strong>,
        and its close, medium and long ranges come off the same ranks — so the skill in the third
        column is the number the whole sphere is built on. Taking the sphere grants
        ${RANKS_PER_TALENT} ranks in it and another ${RANKS_PER_TALENT} per talent spent in the
        same sphere, capped at Hit Dice; those ranks flow into the <strong>Spheres</strong> column
        of the Skills tab. A sphere divided into packages gains only one of them, and it is the
        package that carries the skill.
        ${anyDupes ? '<br>A <span class="dupskill">marked</span> row is one whose skill another '
    + 'sphere — here or on the martial tab — already fills. Ranks never stack: the second '
    + 'sphere pays a competence bonus of half your level (minimum +1) to that skill instead, '
    + 'which the Skills tab adds beside its Misc.' : ''}
      </p>
    </section>`;
  }

  /* ----- talents from elsewhere ----- */

  /**
   * Skill talents that did not come off a class ladder: the Extra Skill
   * Talent feat, an archetype, an item.
   *
   * Two ticks the other sides' bonus tables have no need of. *Utility* marks
   * a talent that had to be a [utility] one, because retraining it has to
   * replace it with another of the same kind. *Free* marks one a base sphere
   * or a drawback handed over -- the rulebook says those are not talents
   * *spent*, so they buy no skill ranks, and nothing about the name says so.
   */
function guileBonusPanel(model, g) {
    const list = 'training.guile.bonusTalents';
    const rows = g.bonusTalents || [];
    const spheres = guileSphereList();
    return `<section class="panel span2">
      <h3>Bonus skill talents ${rows.length ? `<span class="badge">${rows.length}</span>` : ''}</h3>
      <div class="tablewrap"><table class="talents bonus">
        <colgroup><col class="talent"><col class="sphere"><col class="source"><col class="notes">
          <col class="tool"><col class="tool"><col class="tools"></colgroup>
        <thead><tr><th>Talent</th><th>Sphere</th><th>Source</th><th>Notes</th>
          <th class="num" title="Had to be a [utility] talent">[u]</th>
          <th class="num" title="Granted by a base sphere or a drawback — not a talent spent, so it buys no skill ranks">free</th>
          <th></th></tr></thead>
        <tbody>${rows.map((e, i) => `<tr>
          <td>${talentCell(model, `data-item="${list}|${i}|talent"`, e.talent, e.sphere,
    { sphere: 'sphere', notes: 'notes' })}</td>
          <td>${itemSelect(list, i, 'sphere', e.sphere, spheres)}</td>
          <td>${itemText(list, i, 'source', e.source, 'Feat, archetype…')}</td>
          <td>${prose(model, `data-item="${list}|${i}|notes"`, e.notes, 1, 'grow')}</td>
          <td class="mid">${itemCheck(list, i, 'utility', e.utility)}</td>
          <td class="mid">${itemCheck(list, i, 'free', e.free)}</td>
          ${rowTools(list, i)}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:6px">${addButton(list, 'Add talent', {
    talent: '', sphere: null, source: '', notes: '', utility: false, free: false,
  })}</div>
      <p class="hint">
        A talent that arrived with a sphere or with one of its drawbacks is
        <strong>free</strong>: it is not a talent <em>spent</em>, so it does not count toward
        the ranks that sphere pays out. Everything else here does.
      </p>
    </section>`;
  }

  /* ----- the trade tradition ----- */

  /**
   * A trade tradition, which is not a casting tradition wearing a hat.
   *
   * The other two systems trade drawbacks for boons and keep both on the
   * tradition. Guile does not: its drawbacks are per-sphere, chosen when the
   * sphere is taken, and so live on the sphere pages rather than here. What
   * a trade tradition is instead is a bargain about *class skills* -- you
   * give up your class's list for a shorter, sharper one, and get talents
   * for it. Three come to everybody and three more wait on adroit rank,
   * which is why each row carries the tick that says which kind it is.
   */
function tradeTraditionPanel(model, g) {
    const list = 'training.guile.tradition.entries';
    const tr = g.tradition || {};
    const adroit = tr.rank === 'Adroit';
    const spheres = guileSphereList();
    const rows = tr.entries || [];
    return `<section class="panel wide">
      <h3>Trade tradition</h3>
      <label class="fld"><span>Tradition</span>${text('training.guile.tradition.name', tr.name)}</label>
      <label class="fld"><span>Trade rank</span>
        ${select('training.guile.tradition.rank', tr.rank, TRADE_RANKS)}</label>
      <p class="hint">
        Competent takes the automatic talents and the tradition's skill sphere; adroit takes the
        bonus talents on top. A class of 5 + Int ranks per level or more is adroit; 4 + Int or
        fewer is competent.
      </p>
      <div class="tablewrap" style="margin-top:6px"><table class="talents">
        <colgroup><col class="talent"><col class="sphere"><col class="tool"><col class="tool"></colgroup>
        <thead><tr><th>Grants</th><th>Sphere</th>
          <th class="num" title="Only at adroit rank">adroit</th><th></th></tr></thead>
        <tbody>${rows.map((e, i) => `<tr class="${e.adroit && !adroit ? 'future' : ''}">
          <td>${talentCell(model, `data-item="${list}|${i}|talent"`, e.talent, e.sphere,
    { sphere: 'sphere' })}</td>
          <td>${itemSelect(list, i, 'sphere', e.sphere, spheres)}</td>
          <td class="mid">${itemCheck(list, i, 'adroit', e.adroit)}</td>
          ${rowRemove(list, i)}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:6px">${addButton(list, 'Add entry', { talent: '', sphere: null, adroit: false })}</div>
      ${rows.some((e) => e.adroit) && !adroit
    ? '<p class="hint warn">Greyed rows are the tradition\'s adroit talents — set the rank above to claim them.</p>'
    : ''}
      <h4 class="subhead">Class skills</h4>
      <p class="hint">
        Any trade tradition gives up the class's own skill list and grants
        ${TRADE_CLASS_SKILLS.map((s) => `<strong>${esc(s)}</strong>`).join(', ')} outright —
        and ${TRADE_BACKGROUND_SKILLS.map((s) => `<strong>${esc(s)}</strong>`).join(' and ')} too in a
        game using background skills. Its trade talents grant the rest; tick them in the
        <strong>Class</strong> column of the Skills tab.
      </p>
    </section>`;
  }

  /* ----- the operative, and the two pools ----- */

  /**
   * The one ability score every skill sphere leans on, and the two resources
   * guile hands out that nothing else in the sheet does.
   *
   * *Skill leverage* is not a daily pool by default: it refills on a full
   * rest and also a use at a time, whenever the operative gets somewhere by
   * being clever. That is a table judgement and not a number this sheet can
   * work out, so the pool is sized here and spent on a tracker like every
   * other resource that comes back mid-day.
   *
   * *Plans* are sized off how many [plan] talents the character has, which
   * is a fact about the talents rather than about the character -- so it is
   * counted off the sphere catalogue when a pack has been loaded and typed
   * in when none has.
   */
function operativePanel(model, g) {
    const lev = g.leverage || {};
    const plans = g.plans || {};
    const abilities = OPERATIVE_ABILITIES.map((k) => ABILITY_LABELS[k.toLowerCase()] || k);
    return `<section class="panel">
      <h3>The operative</h3>
      <label class="fld"><span>Operative ability modifier</span>
        <span class="pair">
          ${select('training.guile.operativeMod', g.operativeMod, abilities)}
          <span class="hint">${fmt(g.operativeAbilityMod || 0)}</span>
        </span></label>
      <p class="hint">
        Int, Wis or Cha — one choice for the whole character, and every skill sphere's save DC
        is built on it. A class that traded its spellcasting for a progression uses whichever
        score its casting used.
      </p>

      <h4 class="subhead">Skill leverage</h4>
      ${lev.unlocked ? `
      <div class="bigstats" style="margin-bottom:8px">
        ${bigStat('Uses', lev.pool ?? 0, `1 + a third of ${Number(model.data.identity.level) || 0} HD`)}
      </div>
      ${editLine('Extra uses', 'training.guile.leverageBonus', lev.bonus ?? 0)}
      <div class="statline"><span class="label">Daily-pool variant
        <span class="badge">+${DAILY_LEVERAGE_EXTRA}</span></span>
        <span class="value">${check('training.guile.leverageDaily', lev.daily)}</span></div>
      <p class="hint">
        One pool, spent with any skill it is unlocked for — unlocked by
        ${lev.spheres.length} sphere${lev.spheres.length === 1 ? '' : 's'}
        (${esc(lev.spheres.join(', '))}). It refills on 8 hours' rest, and a use at a time for
        thwarting a new foe, beating a real trap, winning over someone who has never helped you,
        or making a discovery that opens a way. Under the daily-pool variant it refreshes once a
        day and carries ${DAILY_LEVERAGE_EXTRA} more for a four-encounter day. Make a tracker
        for it to spend it at the table.
      </p>` : `<p class="empty">No sphere unlocking leverage yet.</p>
      <p class="hint">Every skill sphere unlocks it except Vocation, which has no base ability.</p>`}

      <h4 class="subhead">Plans</h4>
      ${line('Plans prepared', plans.pool ?? 0, true)}
      ${line('[utility] plans', plans.utilityPool ?? 0)}
      ${editLine('[plan] talents', 'training.guile.planBonus', g.planBonus ?? 0)}
      ${editLine('[plan] [utility] talents', 'training.guile.utilityPlanBonus', g.utilityPlanBonus ?? 0)}
      <p class="hint">
        Uses equal 1 + your [plan] talents without the [utility] tag; talents carrying both tags
        make a second pool of their own, spendable only on utility plans.
        ${plans.counted
    ? `<strong>${plans.counted}</strong> found by tag in the sphere catalogue; the two fields add to that.`
    : 'Nothing could be counted by tag — type the totals in.'}
        ${plans.unknown ? `${plans.unknown} talent${plans.unknown === 1 ? ' is' : 's are'} not in the
          catalogue at all (no pack carries ${plans.counted ? 'them' : 'the skill spheres'} yet), so
          any [plan] among them has to be counted by hand.` : ''}
        Preparing them all takes an hour, and they stay prepared until revealed.
      </p>
    </section>`;
  }
