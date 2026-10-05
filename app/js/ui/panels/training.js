/**
 * ui/panels/training.js -- what the Martial, Magic and Guile tabs draw alike.
 *
 * A training class's ladder, its pool settings and its "counts as" ticks, the
 * operative field, the class-name picker and the blended training group drawn
 * at the head of every tab its talents reach. combat.js and guile.js both draw
 * from here and import nothing from each other.
 */
import { esc } from '../html.js';
import { talentCell, talentNote } from '../talents.js';
import {
  SYSTEM_NOUNS, poolMode, poolSpheres, poolSystems, sphereNames, talentLandsOn, TRAINING_SYSTEMS, classForwardKey,
} from '../../model.js';
import { forwardedBadge } from '../badges.js';
import {
  ABILITY_LABELS, EXPERTISE_TIERS, GUILE_SPHERES, OPERATIVE_ABILITIES, EXPERTISE_CUSTOM, fmt, parseLadderRule, ABILITIES, CASTING_TYPES, PRACTITIONER_TYPES, TALENT_RATE_OPTIONS, statMod,
} from '../../rules.js';
import { autoNum, select, text, field } from '../fields.js';
import { itemSelect, itemText } from '../rows.js';

const guileSphereList = () => sphereNames(GUILE_SPHERES, 'guile');

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
          <label class="fld lvlpick"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              ${autoNum(`data-item="${list}|${ci}|classLevelsOverride"`, cls.classLevelsOverride,
    { placeholder: cls.classLevels ?? 0, width: '3.6rem' })}
              <span class="hint">${cls.totalTalents ?? 0} any · ${cls.totalUtility ?? 0} utility</span>
            </span></label>
          ${blendTicks(systems, 'guile', (sys) => `data-blendguile="${ci}|${sys}"`, poolCounts(cls, systems),
    !!String(cls.name || '').trim())}
          <button class="danger" data-remove="${list}|${ci}" title="Remove class">×</button>
        </div>
        ${systems.length > 1 ? ladderStack(model, list, ci, cls, systems, spheres)
    : ladderTable(model, list, ci, cls, systems, spheres)}
      </div>`;
  }

/** The syntax a ladder rule takes, for the tooltip on each rule box. */
export const LADDER_RULE_HELP = 'The class levels this ladder gains a talent at: all, odd, even, 3, 5-10, '
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
export const SPHERE_REM_PER_CHAR = 0.5;
export const SPHERE_CHROME_REM = 3;
/** Never narrower than an empty dropdown's dash. */
export const SPHERE_MIN_REM = 4.5;
/** A narrowed ladder's dropdown: its first few letters, and the arrow. */
export const SHRUNK_SPHERE_REM = 4.5;
/** A talent is a name; its notes are where the writing goes. */
export const TALENT_SHARE = 1;
export const NOTES_SHARE = 2;
/** A narrowed ladder keeps this much of its shares: still a box to click into. */
export const SHRUNK_SCALE = 0.25;
/** What the four shares are scaled to add up to, in percent; see ladderLayout. */
export const SHARE_TOTAL = 400;

/** The `<col>`s for one ladder. */
export const ladderCols = (h, util) => {
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

/**
 * A blended pool's two ladders stacked rather than side by side.
 *
 * Side by side, a pool that reaches martial or magical talents *and* skill
 * talents shares the blended panel's width out six ways, and every cell came
 * out a few letters wide. Here each level is one box (a `<tbody>`): the any
 * talent, and the [utility] talent under it, each a row of the ordinary
 * talent table -- talent, sphere, notes -- and only the ladders that level
 * grants. A level granting neither is the empty slot the plain blended table
 * draws. Same fields as `ladderTable`; the Guile tab keeps that one.
 */
export function ladderStack(model, list, ci, cls, systems, spheres) {
  const slots = `${list}.${ci}.levels`;
  const landed = (sphere) => {
    if (!String(sphere || '').trim()) return null;
    return talentLandsOn(sphere, systems) ?? 'none';
  };
  const why = (side, sphere) => (side === 'none'
    ? ` — ${sphere} is not a sphere this class's talents count as, so it counts nowhere`
    : side ? ` — counts as ${SYSTEM_NOUNS[side]}` : '');
  // One ladder's row: `u` is the [utility] ladder, whose fields carry the
  // prefix. `head` is what the level cell says.
  const row = (lv, li, u, head, extra = '') => {
    const f = (name) => (u ? `utility${name[0].toUpperCase()}${name.slice(1)}` : name);
    const sphere = lv[f('sphere')];
    const side = landed(sphere);
    const count = u ? `Utility talent #${lv.utilityCount}${why(side, sphere)}`
      : `Talent #${Math.floor(lv.count)} at level ${lv.level}${why(side, sphere)}`;
    return `<tr class="${lv.future ? 'future' : ''}${u ? ' utilrow' : ''}${extra}">
        <td class="num" data-stack="head"${head.label ? ` data-headlabel="${head.label}"` : ''} title="${esc(count)}">${head.text}</td>
        <td class="slot-on${u ? ' util' : ''}" data-stack="name">${talentCell(model,
    `data-item="${slots}|${li}|${f('talent')}" placeholder="${u ? '[utility]…' : 'Talent…'}"`, lv[f('talent')], sphere,
    { sphere: f('sphere'), notes: f('notes') })}</td>
        <td class="slot-on${u ? ' util' : ''}${side ? ` side-${side}` : ''}" data-label="Sphere">${
  itemSelect(slots, li, f('sphere'), sphere, spheres)}</td>
        <td class="slot-on${u ? ' util' : ''}" data-label="Notes">${talentNote(model,
    `data-item="${slots}|${li}|${f('notes')}"`, lv[f('notes')], `${slots}|${li}|${f('notes')}`)}</td>
      </tr>`;
  };
  const body = (cls.levels || []).map((lv, li) => {
    const on = !!lv.granted;
    const uOn = !!lv.utilityGranted;
    const level = { label: 'Level', text: esc(lv.level) };
    if (!on && !uOn) {
      return `<tbody class="lvlbox"><tr class="emptyslot${lv.future ? ' future' : ''}">
          <td class="num" data-stack="head" data-headlabel="Level" title="Level ${esc(lv.level)} grants nothing">${esc(lv.level)}</td>
          <td class="slot-off" colspan="3"></td></tr></tbody>`;
    }
    const rows = [];
    if (on) rows.push(row(lv, li, false, level));
    const tag = '<span class="utag">[utility]</span>';
    if (uOn) rows.push(row(lv, li, true, on ? { text: tag } : { label: 'Level', text: `${esc(lv.level)}${tag}` }));
    return `<tbody class="lvlbox">${rows.join('')}</tbody>`;
  }).join('');
  return `<div class="tablewrap"><table class="talents stacked ladderstack">
      <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes"></colgroup>
      <thead><tr><th class="num">Lvl</th><th>Talent</th><th>Sphere</th><th>Notes</th></tr></thead>
      ${body}
    </table></div>`;
}

  /* ----- the sphere table: ranks, DCs and ranges in one ----- */

  /**
   * The blended classes, at the head of every tab their talents reach.
   *
   * One group, drawn on each of those tabs: the same fold key, so it opens and
   * shuts on all of them at once, and the same `data-item` paths, so a talent
   * typed in on the martial tab is the one the guile tab is showing. No tab
   * holds a copy -- each is looking at the same rows of the same class. A
   * class shows on a tab only if its pool reaches that tab's kind, so a
   * martial-and-skill class stays off Magic Spheres.
   */
export function blendedSection(model, wrap, tab) {
    const blended = model.blendedClasses().filter((p) => p.systems.includes(tab));
    return blended.length ? wrap('blended-training', blendedPanel(model, blended)) : '';
  }

  /**
   * The ticks that say which kinds of talent a class's pool counts as.
   *
   * The class's own kind is always one of them, so that tick is drawn ticked
   * and fixed; each of the other two toggles through `attr`, which names the
   * control that does it. `counts`, when given, puts how many talents so far
   * went each way beside the kinds the pool reaches.
   *
   * A class counts as another kind by its name -- the other tab's copy is
   * found by it -- so until one is picked the other two ticks are drawn but
   * cannot be used, and say so.
   */
export function blendTicks(systems, home, attr, counts = null, named = true) {
    const where = { combat: 'Martial Spheres', magic: 'Magic Spheres', guile: 'Guile Spheres' };
    const ticks = TRAINING_SYSTEMS.map((sys) => {
      const on = systems.includes(sys);
      const noun = SYSTEM_NOUNS[sys];
      const n = counts && on && systems.length > 1 ? ` <span class="num">${counts[sys] || 0}</span>` : '';
      const title = sys === home
        ? `This class's own talents, which always count as ${noun}.`
        : !named ? `Pick the class first: its talents count as ${noun} by the class's name.`
        : `${on ? 'Untick to stop' : 'Tick to let'} this class's talents count as ${noun} as well — `
          + `a row whose sphere is on the ${where[sys]} tab counts there${sys === 'guile' ? ' and buys skill ranks' : ''}.`;
      return `<label class="chk" title="${esc(title)}">
              <input type="checkbox"${on ? ' checked' : ''}${sys === home || !named ? ' disabled' : ` ${attr(sys)}`}>
              <span class="hint">${noun}${n}</span></label>`;
    }).join('');
    // Talents in a sphere of a kind the class does not reach count nowhere;
    // said here as well as on their rows, so a class folded shut still shows it.
    const lost = counts?.none
      ? `<span class="hint bad" title="${esc('A talent whose sphere is of a kind this class does not count as is counted nowhere. Tick that kind, or change the sphere.')}">${counts.none} not counted</span>`
      : '';
    return `<label class="fld blendticks"><span>Counts as</span><span class="pair">${ticks}${lost}</span></label>`;
  }

  /* ----- training class blocks with per-level talent slots ----- */


/**
 * The classes a training block can be: every class the character has --
 * the Classes table and the Planner, as the model lists them -- and any name
 * a training block already holds, so a pick is never dropped from its own
 * select.
 */
export function classNames(model) {
    const names = new Set(model.classNames());
    for (const side of Object.values(model.data.training || {})) {
      for (const cls of side?.classes || []) if (String(cls.name || '').trim()) names.add(String(cls.name).trim());
    }
    return [...names];
  }


/**
 * An ability picker with the modifier it stands for beside it.
 *
 * Three letters in a box sized for three letters, and the number the class
 * actually reads off them on the same line -- the score is chosen once and
 * the modifier is what every DC and spell-point count is built from. Blank
 * for a slot that names nothing, as the 2nd score usually does.
 */
export function abilityField(model, list, index, field, value, label) {
    const named = ABILITIES.includes(String(value || '').trim().toLowerCase().slice(0, 3));
    return `<label class="fld abmod"><span>${esc(label)}</span>
            <span class="pair abmod">
              ${itemSelect(list, index, field, value, ABILITIES.map((k) => ABILITY_LABELS[k]))}
              <span class="hint">${named ? fmt(statMod(model.data, value, null)) : ''}</span>
            </span></label>`;
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
export function blendedPanel(model, pairs) {
    const head = (half, label, types) => {
      if (!half) return `<label class="fld ratepick"><span>${label} type</span><select disabled><option>—</option></select></label>`;
      const list = `training.${half.side}.classes`;
      const casting = label === 'Casting';
      // A half with no type has no progression on that side: nothing is
      // guessed from the other side's rate, so say so where it is picked.
      const unset = !half.cls.effectiveType;
      return `<label class="fld ratepick${unset ? ' unset' : ''}"><span>${label} type</span>
          ${itemSelect(list, half.index, 'type', half.cls.type, types)}
          ${unset ? `<span class="hint warn">Pick one — no ${casting ? 'caster level' : 'practitioner progression'} until then</span>` : ''}</label>
        ${abilityField(model, list, half.index, 'mod1', half.cls.mod1, casting ? 'Casting score' : 'Practitioner mod')}
        ${/* Only the casting half: spell points are what a second score adds to. */''}
        ${casting ? abilityField(model, list, half.index, 'mod2', half.cls.mod2, '2nd score') : ''}`;
    };
    const guile = model.data.training?.guile;

    return `<section class="panel span2">
      <h3>Blended training <span class="badge">${pairs.length}</span></h3>
      ${pairs.map(({ kind, systems, owner, twin }) => {
    // A skill class's pool is its two ladders, drawn the way the guile tab
    // draws them; it brings its ticks with it.
    if (kind === 'guile') return guileClassBlock(model, guile, owner.cls, owner.index);
    const list = `training.${owner.side}.classes`;
    const cls = owner.cls;
    const martial = owner.side === 'combat' ? owner : twin;
    const casting = owner.side === 'magic' ? owner : twin;
    const skill = systems.includes('guile');
    const counts = poolCounts(cls, systems);
    const spheres = poolSpheres(systems);
    return `<div class="trainclass">
        <div class="trainhead">
          <label class="fld classpick"><span>Class</span>
            ${itemSelect(list, owner.index, 'name', cls.name, classNames(model))}</label>
          ${/* The pool is one, sized the way the base class -- the block the
                pair was made from -- grants talents, so the rates offered are
                that side's and not both sides' at once. */''}
          ${/* Reaching skill talents makes the pool two ladders, and how they grow is
                its own setting; the rate is still the any ladder's under the default. */''}
          ${!skill || poolMode(cls, owner.side) === 'rate' ? `<label class="fld ratepick"><span>Talents / level</span>
            ${itemSelect(list, owner.index, 'talentsPerLevel', cls.talentsPerLevel, TALENT_RATE_OPTIONS[owner.side])}</label>` : ''}
          ${skill ? poolField(list, owner.index, cls, owner.side) : ''}
          ${systems.includes('combat') ? head(martial, 'Practitioner', PRACTITIONER_TYPES) : ''}
          ${systems.includes('magic') ? head(casting, 'Casting', CASTING_TYPES) : ''}
          ${systems.includes('guile') && guile ? operativeField(model, guile) : ''}
          <label class="fld lvlpick"><span>Class levels ${cls.classLevelsOverride == null ? '(auto)' : '(override)'}</span>
            <span class="pair">
              ${autoNum(`data-item="${list}|${owner.index}|classLevelsOverride"`, cls.classLevelsOverride,
    { placeholder: cls.classLevels ?? 0, width: '3.6rem' })}
              ${forwardedBadge(model, classForwardKey(cls.name))}
              <span class="hint">${skill ? `${cls.totalTalents ?? 0} any · ${cls.totalUtility ?? 0} utility`
                : `talents: ${cls.totalTalents ?? 0}`}</span>
            </span></label>
          ${blendTicks(systems, owner.side, (sys) => (sys === 'guile'
    ? `data-blendskill="${owner.side}|${owner.index}"` : `data-blend="${owner.side}|${owner.index}"`), counts,
    !!String(cls.name || '').trim())}
        </div>
        ${skill ? ladderStack(model, list, owner.index, cls, systems, spheres) : `<div class="tablewrap"><table class="talents stacked">
          <colgroup><col class="lvl"><col class="talent"><col class="sphere"><col class="notes"></colgroup>
          <thead><tr><th class="num">Lvl</th><th>Talent</th><th>Sphere</th><th>Notes</th></tr></thead>
          <tbody>${(cls.levels || []).map((lv, li) => {
      const on = !!lv.granted;
      const slots = `${list}.${owner.index}.levels`;
      const state = on ? 'slot-on' : 'slot-off';
      const side = on && String(lv.sphere || '').trim() ? (talentLandsOn(lv.sphere, systems) ?? 'none') : null;
      const count = on ? `Talent #${Math.floor(lv.count)} at level ${lv.level}${
        side === 'none' ? ` — ${lv.sphere} is not a sphere this class's talents count as, so it counts nowhere`
          : side ? ` — counts as ${SYSTEM_NOUNS[side]}` : ''}`
        : `Level ${lv.level} grants no talent`;
      return `<tr class="${lv.future ? 'future' : ''}${on ? '' : ' emptyslot'}">
              <td class="num" data-stack="head" data-headlabel="Level" title="${esc(count)}">${esc(lv.level)}</td>
              <td class="${state}" data-stack="name">${talentCell(model,
        `data-item="${slots}|${li}|talent"${on ? ' placeholder="Talent…"' : ' disabled'}`, lv.talent, lv.sphere,
        on ? { sphere: 'sphere', notes: 'notes' } : null)}</td>
              <td class="${state}${side ? ` side-${side}` : ''}" data-label="Sphere">
                ${on ? itemSelect(slots, li, 'sphere', lv.sphere, spheres)
        : '<select disabled><option></option></select>'}
              </td>
              <td class="${state}" data-label="Notes">${talentNote(model,
        `data-item="${slots}|${li}|notes"${on ? '' : ' disabled'}`, lv.notes, `${slots}|${li}|notes`)}</td>
            </tr>`;
    }).join('')}</tbody>
        </table></div>`}
      </div>`;
  }).join('')}
      <p class="hint">
        One pool of talents, spent any of the ways ticked under <strong>Counts as</strong>: the
        sphere on each row decides whether a talent is martial (Sphere BAB / DC), magical
        (Sphere CL / DC) or a skill talent (ranks in the sphere's associated skill). Martial
        and magical each keep their own type and ability score, because a blended class rarely
        advances at the same rate as both; skill talents read the one operative modifier. A skill
        class keeps both its ladders here, and either can be spent on any kind it reaches. A class
        that reaches skill talents gains a [utility] ladder too: by default its any talents keep the
        class's Talents / level and its [utility] talents come at the levels you write (even, odd,
        "2, +2"), or choose a tier from the book's table, or Custom rules for both. Unticking skill
        hides that ladder and the setting without losing them. A talent in a sphere of a kind the
        class does not reach is counted nowhere and marked on its row. This group heads the tab of
        every kind a class reaches and is the same on each: what you type on one tab is what the
        others are showing.
      </p>
    </section>`;
  }

