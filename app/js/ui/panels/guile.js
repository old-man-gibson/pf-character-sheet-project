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
import { fillNotesButton, talentCell, talentLegend, talentNote } from '../talents.js';
import {
  SYSTEM_NOUNS, poolMode, poolSpheres, poolSystems, sphereForwardKey, sphereNames, talentLandsOn,
} from '../../model.js';
import { forwardedBadge } from '../badges.js';
import {
  ABILITY_LABELS, EXPERTISE_TIERS, GUILE_SPHERES, OPERATIVE_ABILITIES, RANKS_PER_TALENT,
  EXPERTISE_CUSTOM, TRADE_BACKGROUND_SKILLS, TRADE_CLASS_SKILLS, TRADE_RANKS, fmt, parseLadderRule,
  guilePackages, guileSkillHint, skillLabel,
} from '../../rules.js';
import { DAILY_LEVERAGE_EXTRA } from '../../model.js';
import { check, select, text } from '../fields.js';
import {
  addButton, bigStat, editLine, exprField, itemCheck, itemSelect, itemText, line,
  rowRemove, rowTools,
} from '../rows.js';
import { blendTicks, blendedSection, classNames } from './combat.js';

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
        ${blendedSection(model, wrap, 'guile')}
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
    const classes = g.classes || [];
    // A class blended into the sphere sides is drawn once, under Blended
    // training at the head of this tab, and only named here.
    const blended = classes.filter(isBlended);
    const own = classes.length - blended.length;
    return `<section class="panel span2">
      <h3>Skill expertise ${own ? `<span class="badge">${own}</span>` : ''}</h3>
      ${classes.map((cls, ci) => (isBlended(cls) ? '' : guileClassBlock(model, g, cls, ci))).join('')}
      ${own ? '' : `<p class="empty">${blended.length ? 'No other operative classes.' : 'No operative classes yet.'}</p>`}
      ${blended.length ? `<p class="hint">Also operative classes:
        ${blended.map((x) => esc(x.name)).join(', ')} — blended, so their ladders are listed once
        under <strong>Blended training</strong> and their skill talents counted here by sphere.</p>` : ''}
      <div style="margin-top:8px">
        <button class="primary" data-action="add-guile-class">+ Add class</button>
        ${fillNotesButton(model, 'guile')}
      </div>
      ${talentLegend()}
      <p class="hint">
        A tier grants the talents in <strong>Any</strong> <em>in addition to</em> those in
        <strong>[utility]</strong> — they are two ladders, not two halves of one, which is why a
        level can light up neither slot, one, or both. Virtuoso runs 3/4 a free talent per level
        and a utility one every 2; Journeyman 1/2 and 1/2; Trained 1/4 and 1/2 — so a Trained
        operative's picks are mostly utility ones. Class levels come from the Planner; set the
        override for a sparse one. A class that trades its feats or its spellcasting for a
        progression (the two conversion tables) is one of these blocks like any other.
        The <strong>operative modifier</strong> — Int, Wis or Cha — is one choice for
        the whole character, and every skill sphere's save DC is built on it: the field
        appears on each class block and they are the one setting. A class that traded its
        spellcasting for a progression uses whichever score its casting used.
        For a class no tier matches, <strong>Custom rules</strong> writes both ladders out as the
        class levels they gain at — <code>all</code>, <code>even</code>, <code>2, +2</code>,
        <code>char: 6-10</code>; hover a rule box for the rest.
        Tick <strong>martial</strong> or <strong>magical</strong> under Counts as for a class
        whose talents may be spent on those spheres too; a pick in a sphere of a kind the class
        does not reach counts nowhere and is marked on its row.
      </p>
    </section>`;
  }

/** Whether a skill class's ladders reach the sphere sides. */
const isBlended = (cls) => !!(cls.blendedCombat || cls.blendedMagic);

  /**
   * The operative modifier, where the other two tabs put a class's casting
   * score or practitioner modifier. It is one choice for the whole character
   * rather than one per class, so every block that shows it shows the same
   * field bound to the same path.
   */
export function operativeField(model, g) {
    return `<label class="fld abmod"><span>Operative modifier</span>
            <span class="pair abmod">
              ${select('training.guile.operativeMod', g.operativeMod,
    OPERATIVE_ABILITIES.map((k) => ABILITY_LABELS[k.toLowerCase()] || k))}
              <span class="hint">${g.operativeMod ? fmt(g.operativeAbilityMod || 0) : ''}</span>
            </span></label>`;
  }

  /**
   * One skill class: its head and its two ladders.
   *
   * Drawn in the Skill expertise group, or under Blended training when its
   * ladders reach the sphere sides -- then every slot picks from each list it
   * reaches, and the sphere says where the talent counts.
   */
export function guileClassBlock(model, g, cls, ci) {
    const list = 'training.guile.classes';
    const systems = poolSystems(cls, 'guile');
    const spheres = systems.length > 1 ? poolSpheres(systems) : guileSphereList();
    return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld classpick"><span>Class</span>
            ${itemSelect(list, ci, 'name', cls.name, classNames(model))}</label>
          ${poolField(list, ci, cls, 'guile')}
          ${operativeField(model, g)}
          <label class="fld"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              <input type="number" value="${cls.classLevelsOverride ?? ''}" placeholder="${cls.classLevels ?? 0}"
                data-item="${list}|${ci}|classLevelsOverride" data-kind="number-or-null" style="width:3.6rem">
              <span class="hint">${cls.totalTalents ?? 0} any · ${cls.totalUtility ?? 0} utility</span>
            </span></label>
          ${blendTicks(systems, 'guile', (sys) => `data-blendguile="${ci}|${sys}"`, poolCounts(cls, systems))}
          <button class="danger" data-remove="${list}|${ci}" title="Remove class">×</button>
        </div>
        ${ladderTable(model, list, ci, cls, systems, spheres)}
      </div>`;
  }

/** The syntax a ladder rule takes, for the tooltip on each rule box. */
const LADDER_RULE_HELP = 'The class levels this ladder gains a talent at: all, odd, even, 3, 5-10, '
  + '"2, +2" (2nd and every 2 levels thereafter), -7 to leave a level out. Start with char: to '
  + 'count character levels instead. A formula of classLevel and charLevel works too. Blank is none.';

  /**
   * How a two-ladder pool gains talents, and the rules a setting needs.
   *
   * A martial or magic class that reaches skill talents keeps its own
   * Talents / level for the any ladder by default -- ticking skill changes no
   * count until someone chooses to -- with a rule box for its [utility]
   * talents. That is also how the book's blended classes print theirs: a
   * talent a level, or a caster level, plus a [utility] one on even or odd
   * levels. The three tiers are the book's table, and Custom writes both
   * ladders out for anything else. A guile class has no rate of its own, so
   * it chooses a tier or Custom.
   */
export function poolField(list, ci, cls, home) {
    const mode = poolMode(cls, home);
    const options = [
      ...(home === 'guile' ? [] : [['', 'Talents / level rate',
        'Any talents at the class\'s own Talents / level; [utility] talents at the levels written beside it']]),
      ...EXPERTISE_TIERS.map((t) => [t, t, 'As the Skill Talents by Expertise Tier table']),
      [EXPERTISE_CUSTOM, 'Custom rules', 'Both ladders at the levels written beside it'],
    ];
    const rule = (field, label, placeholder) => {
      const { error } = parseLadderRule(cls[field]);
      return `<label class="fld rulepick${error ? ' bad' : ''}" title="${esc(error ? `${error}. ${LADDER_RULE_HELP}` : LADDER_RULE_HELP)}">
            <span>${label}</span>
            ${itemText(list, ci, field, cls[field], placeholder)}
            ${error ? '<span class="hint bad">not a rule — grants nothing</span>' : ''}</label>`;
    };
    return `<label class="fld ratepick"><span>${home === 'guile' ? 'Expertise tier' : 'Talent pool'}</span>
            ${itemSelect(list, ci, 'expertise', cls.expertise ?? '', options, home === 'guile' ? '—' : null)}</label>
          ${mode === 'custom' ? rule('anyRule', 'Any talent at', 'all') : ''}
          ${mode === 'custom' || mode === 'rate' ? rule('utilityRule', '[utility] talent at', 'e.g. even') : ''}`;
  }

  /**
   * Where each granted talent of a pool went so far: a count per system, and
   * `none` for talents in a sphere of a system the class does not reach,
   * which count nowhere until the class is ticked for it or the sphere
   * changed. Levels still to come are left out, as the other tabs do.
   */
export function poolCounts(cls, systems) {
    const counts = { combat: 0, magic: 0, guile: 0, none: 0 };
    const slots = systems.includes('guile');
    for (const lv of cls.levels || []) {
      if (lv.future) continue;
      const picks = [[lv.granted, lv.sphere]];
      if (slots) picks.push([lv.utilityGranted, lv.utilitySphere]);
      for (const [on, sphere] of picks) {
        if (!on || !String(sphere || '').trim()) continue;
        counts[talentLandsOn(sphere, systems) ?? 'none'] += 1;
      }
    }
    return counts;
  }

  /**
   * How wide each column of a pool's two ladders is drawn, and which ladder
   * has the room.
   *
   * Three things decide it.
   *
   * The sphere column is only as wide as the longest sphere picked in it --
   * a dropdown needs about half a rem a character plus its padding and arrow
   * -- rather than the 8.75rem every talent table gives it. Side by side the
   * two ladders share the longer fit, so the halves are the same width.
   *
   * Everything else is shares, the talent one part and its notes two: a
   * talent is a name, and the notes are where a player writes. What the
   * sphere column no longer takes is split the same way without anything
   * further, since the shares are of whatever width is left.
   *
   * A focused ladder keeps its shares; the other is drawn narrow -- a quarter
   * of the shares and a short dropdown -- and what it gives up goes to the
   * focused side. A ladder that grants nothing at all on this pool (a pool
   * with no [utility] rule, a Trained operative's any ladder before 4th)
   * cannot be chosen between: it is drawn narrow on its own and there is no
   * switch.
   */
export function ladderLayout(model, key, cls, spheres = []) {
    const levels = cls.levels || [];
    const featured = { any: levels.some((lv) => lv.granted), utility: levels.some((lv) => lv.utilityGranted) };
    const toggles = featured.any && featured.utility;
    const stored = model.data.uiPrefs?.ladderFocus?.[key];
    const focus = toggles
      ? (stored === 'any' || stored === 'utility' ? stored : null)
      : featured.any !== featured.utility ? (featured.any ? 'any' : 'utility') : null;
    const known = new Set(spheres.map(String));
    // A value the list does not offer is drawn with " *" after it (itemSelect).
    const longest = (field, flag) => Math.max(1, ...levels.filter((lv) => lv[flag]).map((lv) => {
      const name = String(lv[field] || '').trim();
      return name.length + (name && !known.has(name) ? 2 : 0);
    }));
    const fits = {
      any: Math.max(SPHERE_MIN_REM, SPHERE_CHROME_REM + SPHERE_REM_PER_CHAR * longest('sphere', 'granted')),
      utility: Math.max(SPHERE_MIN_REM, SPHERE_CHROME_REM + SPHERE_REM_PER_CHAR * longest('utilitySphere', 'utilityGranted')),
    };
    // Side by side, both dropdowns are as wide as the longer of the two, so
    // the halves come out the same width; a focused ladder fits its own.
    if (!focus) fits.any = fits.utility = Math.max(fits.any, fits.utility);
    const half = (which, shrunk) => {
      const fit = fits[which];
      const scale = shrunk ? SHRUNK_SCALE : 1;
      return {
        talent: TALENT_SHARE * scale,
        sphere: shrunk ? Math.min(fit, SHRUNK_SPHERE_REM) : fit,
        notes: NOTES_SHARE * scale,
        shrunk,
      };
    };
    const any = half('any', focus === 'utility');
    const utility = half('utility', focus === 'any');
    // Shares, not percentages of the table: a fixed-layout table whose
    // percentage columns add up past 100% gives the fixed columns their width
    // first and scales the percentages down to what is left, in proportion.
    // Under 100% it does the opposite and spreads the rest over every column,
    // the fixed ones included -- the level column went from 46px to 103px the
    // first time a ladder was narrowed. So the shares are scaled to add up to
    // SHARE_TOTAL, far past anything a table can hold.
    const sum = any.talent + any.notes + utility.talent + utility.notes;
    for (const h of [any, utility]) {
      h.talent = Math.round((h.talent / sum) * SHARE_TOTAL * 100) / 100;
      h.notes = Math.round((h.notes / sum) * SHARE_TOTAL * 100) / 100;
    }
    return { focus, toggles, any, utility };
  }

/** What a dropdown needs for each character of its name, and for its padding, arrow and cell. */
const SPHERE_REM_PER_CHAR = 0.5;
const SPHERE_CHROME_REM = 3;
/** Never narrower than an empty dropdown's dash. */
const SPHERE_MIN_REM = 4.5;
/** A narrowed ladder's dropdown: its first few letters, and the arrow. */
const SHRUNK_SPHERE_REM = 4.5;
/** A talent is a name; its notes are where the writing goes. */
const TALENT_SHARE = 1;
const NOTES_SHARE = 2;
/** A narrowed ladder keeps this much of its shares: still a box to click into. */
const SHRUNK_SCALE = 0.25;
/** What the four shares are scaled to add up to, in percent; see ladderLayout. */
const SHARE_TOTAL = 400;

/** The `<col>`s for one ladder. */
const ladderCols = (h, util) => {
    const c = util ? ' util' : '';
    return `<col class="talent${c}" style="width:${h.talent}%">`
      + `<col class="sphere${c}" style="width:${Math.round(h.sphere * 100) / 100}rem">`
      + `<col class="notes${c}" style="width:${h.notes}%">`;
  };

  /**
   * A pool's two ladders, one row a level: the any talent and the [utility]
   * talent side by side, each lighting up on its own. The same table for a
   * guile class and for a martial or magic class that reaches skill talents,
   * which is what reaching them makes its pool. Each heading is also the
   * switch that gives its ladder the room (ladderLayout).
   */
export function ladderTable(model, list, ci, cls, systems, spheres) {
    const blended = systems.length > 1;
    const key = `ladder:${list}:${String(cls.name || '').trim() || ci}`;
    const layout = ladderLayout(model, key, cls, spheres);
    // Only a blended pool marks which way each talent went; any pool marks a
    // sphere it cannot count, since that is a pick going nowhere.
    const landed = (on, sphere) => {
      if (!on || !String(sphere || '').trim()) return null;
      const side = talentLandsOn(sphere, systems);
      if (side === null) return 'none';
      return blended ? side : null;
    };
    const why = (side, sphere) => (side === 'none'
      ? ` — ${sphere} is not a sphere this class's talents count as, so it counts nowhere`
      : side ? ` — counts as ${SYSTEM_NOUNS[side]}` : '');
    const heading = (which, label, other) => {
      const shrunk = layout[which].shrunk;
      if (!layout.toggles) {
        const title = shrunk ? `This pool grants no ${label.toLowerCase()}s, so the ladder is drawn narrow` : '';
        return `<th colspan="3" class="${which === 'utility' ? 'util' : ''}${shrunk ? ' shrunk' : ''}"${
          title ? ` title="${esc(title)}"` : ''}>${label}</th>`;
      }
      const on = layout.focus === which;
      const title = on ? 'Back to both ladders side by side'
        : `Give the ${label.toLowerCase()} ladder the room and narrow the ${other} one`;
      return `<th colspan="3" class="${which === 'utility' ? 'util' : ''}${shrunk ? ' shrunk' : ''}">
              <button type="button" class="ladderfocus" data-ladderfocus="${esc(key)}|${which}"
                aria-pressed="${on}" title="${esc(title)}">${label}</button></th>`;
    };
    // Sized here and nowhere else: a drag on the level column's edge used to
    // freeze every column at an even split of the headings over them, which
    // no focus could undo. Opted out of hand-sizing (ui/column-widths.js).
    return `<div class="tablewrap"><table class="talents guileladder${layout.focus ? ` focus-${layout.focus}` : ''}" data-colresize="off">
          <colgroup><col class="lvl">${ladderCols(layout.any, false)}${ladderCols(layout.utility, true)}</colgroup>
          <thead><tr><th class="num">Lvl</th>
            ${heading('any', 'Any talent', '[utility]')}
            ${heading('utility', '[utility] talent', 'any')}</tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
            const slots = `${list}.${ci}.levels`;
            const on = !!lv.granted;
            const uOn = !!lv.utilityGranted;
            const state = on ? 'slot-on' : 'slot-off';
            const uState = uOn ? 'slot-on' : 'slot-off';
            const side = landed(on, lv.sphere);
            const uSide = landed(uOn, lv.utilitySphere);
            const count = [
              on ? `Talent #${Math.floor(lv.count)} at level ${lv.level}${why(side, lv.sphere)}` : '',
              uOn ? `Utility talent #${lv.utilityCount}${why(uSide, lv.utilitySphere)}` : '',
            ].filter(Boolean).join(' · ') || `Level ${lv.level} grants nothing`;
            const cellTitle = (s, sphere) => (s === 'none' ? ` title="${esc(why(s, sphere).slice(3))}"` : '');
            return `<tr class="${lv.future ? 'future' : ''}">
              <td class="num" title="${esc(count)}">${lv.level}</td>
              <td class="${state}">${talentCell(model,
    `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, lv.sphere,
    on ? { sphere: 'sphere', notes: 'notes' } : null)}</td>
              <td class="${state}${side ? ` side-${side}` : ''}"${cellTitle(side, lv.sphere)}>${on ? itemSelect(slots, li, 'sphere', lv.sphere, spheres)
                  : '<select disabled><option></option></select>'}</td>
              <td class="${state}">${talentNote(model,
    `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, `${slots}|${li}|notes`)}</td>
              <td class="${uState} util ustart">${talentCell(model,
    `data-item="${slots}|${li}|utilityTalent"${uOn ? ' placeholder="[utility]…"' : ' disabled'}`,
    lv.utilityTalent, lv.utilitySphere,
    uOn ? { sphere: 'utilitySphere', notes: 'utilityNotes' } : null)}</td>
              <td class="${uState} util${uSide ? ` side-${uSide}` : ''}"${cellTitle(uSide, lv.utilitySphere)}>${uOn ? itemSelect(slots, li, 'utilitySphere', lv.utilitySphere, spheres)
                  : '<select disabled><option></option></select>'}</td>
              <td class="${uState} util">${talentNote(model,
    `data-item="${slots}|${li}|utilityNotes"${uOn ? '' : ' disabled'}`, lv.utilityNotes, `${slots}|${li}|utilityNotes`)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
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
      ${(() => {
    // The rest of the catalogue, folded: a skill sphere is on the table
    // because a talent went into it or the player put it there, and the
    // ones that are neither still have to be findable -- with the choice
    // of skill that makes the row, which is why each carries an Add.
    const have = new Set(rows.map((r) => String(r.sphere || '').trim().toLowerCase()));
    const rest = spheres.filter((s) => !have.has(String(s).trim().toLowerCase()));
    if (!rest.length) return '';
    return `<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">All spheres (${rest.length})</summary>
        <div class="tablewrap"><table class="guilespheres"><tbody>${rest.map((s) => `<tr>
          <td>${esc(s)}</td>
          <td class="hint">no talents — choose its associated skill to put it on the table</td>
          <td class="tools"><button data-action="add-guile-sphere" data-sphere="${esc(s)}"
            title="${esc(`Add ${s} to the table`)}">+ Add</button></td>
        </tr>`).join('')}</tbody></table></div>
      </details>`;
  })()}
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
          <td>${talentNote(model, `data-item="${list}|${i}|notes"`, e.notes, `${list}|${i}|notes`)}</td>
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
    return `<section class="panel">
      <h3>The operative</h3>
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
