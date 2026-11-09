/**
 * ui/panels/stats.js -- the Stats tab: where a score comes from, and the
 * numbers worked out from the scores.
 *
 * Every ability on the sheet is a sum with its sources spelled out -- point
 * buy, race, the level-4 increases, the prowess ladder, the optional array,
 * gear and the temporary columns -- and this is the panel that shows the sum
 * and lets each part of it be edited. The milestone pickers underneath are the
 * other half: which ability each rung of each ladder was spent on.
 *
 * Under them are the hit points, armor class, saves, initiative, attack and
 * speed panels, which used to be edited on the Overview. The Overview now
 * shows their totals read-only.
 *
 * `pickSelect` and `mythicPickAt` are exported because the Feats & Mythic tab
 * draws the same pickers; `acPanel`, `savesPanel`, `attackPanel` and
 * `restButtons` because the session dashboard draws them too.
 */
import { esc, abAttr, picksAbility, ABILITY_LABELS_LIST } from '../html.js';
import { campaignRules, coreAbp, mythicStatTiers } from '../../model/campaign.js';
import { abilitySelect, area, autoNum, check, field, num, roField, roValue } from '../fields.js';
import {
  collapsibleSub, editLine, exprField, foldButton, itemCheck, line, lineHtml, movedInline, movedValue,
  stepGrid, supergroup, workingTitle,
} from '../rows.js';
import {
  forwardedBadge, sheetBonusCell, sheetBonusField, sheetBonusHead, sheetBonusHint,
} from '../badges.js';
import { abilityHarm } from '../../model/abilities.js';
import { abilityCollapse } from '../../model.js';
import { minus, signed } from '../format.js';
import { prose } from '../prose.js';
import { rollButton } from '../roll.js';
import { speedTable } from '../speeds.js';
import { meterStyleButton, meterStyleEditor, meterVisual } from './trackers.js';
import {
  fmt, ABILITIES, ABILITY_LABELS, ALT_ATTACK_OF, ATTACK_MODES, ATTACK_MODE_KEY, ATTACK_MODE_LABELS,
  attackModeTotal, hitDieGain, ABP_DEFENCE_CAP, ABP_DEFENCE_GROUPS, ABP_LEVELS,
  AC_BONUS_TYPES, ARRAY_LEVELS, ARRAY_MAX_SLOTS, ARRAY_SLOTS, arraySourceLevel,
  ATTUNEMENT_BONUS, ATTUNEMENT_MIN_LEVEL,
  BUILD_DERIVED_KEYS, BUILD_OPTIONAL_KEYS, BUILD_PERMANENT_GROUPS, BUILD_TEMPORARY,
  CORE_PROWESS_LEVELS, LEGENDARY_GIFTS, MENTAL_PROWESS_LEVELS, abpAttunement,
  PHYSICAL_PROWESS_LEVELS, PROWESS_TRACKS, SAVE_BONUS_TYPES, abpGroupTotal, abpSourceLevel, bonusColumnName,
  enhancementCapNote, tempEnhancementNote,
} from '../../rules.js';


/**
 * The Stats tab, in the order a character is built: the ability scores and
 * where each comes from, then the defenses (hit points, armor class, saves,
 * initiative) and offenses (attack, speed) worked out from them. The Overview
 * shows the same numbers read-only.
 *
 * A character with no point-buy table (imported without one, or a monster)
 * types its scores straight into the Ability scores panel.
 */
export function renderStatsPanel(model, ctx) {
  const c = model.data;
  const build = c.statsBuild;
  return `<div class="grid">
      ${supergroup(model, 'stats-abilities', 'Ability scores', 'abilitygroup', `
        ${abilityScoresPanel(model)}
        ${build ? buildPanels(model) : ''}`)}
      ${supergroup(model, 'stats-defenses', 'Defenses', 'defenses', `
        ${hitPointsPanel(ctx, model)}
        ${acPanel(model)}
        <div class="band">
          ${savesPanel(model)}
          ${initiativePanel(model)}
        </div>
        ${build ? defenceBonusPanel(model) : ''}`)}
      ${supergroup(model, 'stats-offenses', 'Offenses', 'offenses', `
        ${attackPanel(model)}
        ${speedPanel(model)}`)}
    </div>`;
}

/** The point-buy table, the temporary columns and the ladders, for a character that has them. */
function buildPanels(model) {
  const c = model.data;
  const build = c.statsBuild;
  const pb = model.pointBuySummary();
  const unlocked = model.attunementUnlocked;
  const showOptional = showOptionalBuildColumns(model, build);
  const allCols = BUILD_PERMANENT_GROUPS.flatMap((g) => g.cols);
  // A group's columns, minus any retired one the player has not asked to see.
  // A group emptied that way drops out of the header entirely.
  const { agingEffects: aging, optionalArray } = campaignRules(c);
  const groups = BUILD_PERMANENT_GROUPS
    .map((g) => ({ ...g, cols: g.cols.filter(([k]) => showOptional[k] !== false && (k !== 'age' || aging)
      && (k !== 'array' || optionalArray)) }))
    .filter((g) => g.cols.length);
  const permCols = groups.flatMap((g) => g.cols);

  /** The banding classes for column `i` of a group, if the group has a label. */
  const band = (g, i) => (g.label ? `grouped${i === 0 ? ' groupstart' : ''}` : '');

  const cell = (ab, key, banding = '') => {
    const entry = build[ab];
    const v = Number(entry[key]) || 0;
    if (BUILD_DERIVED_KEYS.includes(key)) {
      return `<td class="num derived ${banding}" title="From the picks below">${v || ''}</td>`;
    }
    if (key === 'age') {
      return `<td class="num derived ${banding}" title="From the age category (Overview)">${v ? fmt(v) : ''}</td>`;
    }
    if (key === 'attunement') {
      // On or off, worth +2. An imported value that is neither says so
      // rather than being silently rounded away by the checkbox.
      return `<td class="mid ${banding}">
          <label class="chk tick"><input type="checkbox" ${v ? 'checked' : ''} data-build="${ab}|attunement" data-kind="bool"
            aria-label="${ABILITY_LABELS[ab]} attunement"
            ${unlocked ? `title="+${ATTUNEMENT_BONUS} when attuned"`
  : `disabled title="Attunement unlocks at level ${ATTUNEMENT_MIN_LEVEL}"`}></label>
          ${v && v !== ATTUNEMENT_BONUS ? `<span class="hint">${fmt(v)}</span>` : ''}
        </td>`;
    }
    if (key === 'gear') {
      // The best enhancement bonus the Equipment tab's items give, read-only,
      // while nothing is typed; a typed value keeps its box, and the larger
      // of the two counts.
      const items = model.gearItemBonuses(ab);
      const said = items.map((g) => `${fmt(g.value)} from ${g.where}`).join('\n');
      if (items.length && !v) {
        return `<td class="num derived ${banding}" title="${esc(said)}">${Math.max(0, ...items.map((g) => g.value))}</td>`;
      }
      return `<td class="num ${banding}"${items.length ? ` title="${esc(`The larger of this and the items' bonus counts.\n${said}`)}"` : ''}>
          <input type="number" value="${esc(v ?? '')}" data-build="${ab}|${key}"></td>`;
    }
    return `<td class="num ${banding}"><input type="number" value="${esc(v ?? '')}" data-build="${ab}|${key}"></td>`;
  };

  const over = ABILITIES.filter((a) => build[a].resolved?.enhancementWasted > 0);
  const tempOver = ABILITIES.filter((a) => build[a].resolved?.tempEnhancementWasted > 0);

  return `<section class="panel">
        <h3>Permanent bonuses
          ${BUILD_OPTIONAL_KEYS.map((k) => {
          const label = allCols.find(([key]) => key === k)?.[2] || k;
          const on = showOptional[k];
          return `<button data-view data-buildcol="${k}" aria-pressed="${on}"
              title="${on ? 'Hide' : 'Show'} the ${esc(label)} column">${on ? 'Hide' : 'Show'} ${esc(label)}</button>`;
        }).join('')}
        </h3>
        <div class="tablewrap">
          <table class="build statcols">
            <thead>
              <tr class="groups">
                <th></th>
                ${groups.map((g) => (g.label
                ? `<th class="num grouphead" colspan="${g.cols.length + (g.sum ? 1 : 0)}" title="${esc(g.hint || '')}">
                       ${esc(g.label)}${g.cap ? ` <span class="capnote">max +${g.cap}</span>` : ''}</th>`
                : `<th colspan="${g.cols.length}"></th>`)).join('')}
                <th colspan="2"></th>
              </tr>
              <tr>
                <th></th>
                ${groups.map((g) => `${g.cols.map(([, label, full], i) => `<th class="num ${band(g, i)}" title="${esc(full)}">${esc(label)}</th>`).join('')}${
                g.sum ? '<th class="num grouped groupend" title="What the group adds after its cap.">Used</th>' : ''}`).join('')}
                <th class="num" title="Bonuses forwarded here by a rule written somewhere else on the sheet">Fwd</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              ${ABILITIES.map((ab) => {
              const r = build[ab].resolved || {};
              return `<tr>
                  <th scope="row"><span class="abmark" data-ab="${ab}">${ABILITY_LABELS[ab]}</span></th>
                  ${groups.map((g) => `${g.cols.map(([k], i) => cell(ab, k, band(g, i))).join('')}${
                  g.sum ? `<td class="num grouped groupend total ${r.enhancementWasted ? 'over' : ''}"
                      title="${esc(r.enhancementWasted ? enhancementCapNote(r)
    : `${g.cols.map(([k]) => (k === 'gear' ? Math.max(Number(build[ab][k]) || 0, r.gearItems || 0)
      : Number(build[ab][k]) || 0)).join(' + ')} = ${r[g.sum] ?? 0}`)}">${esc(r[g.sum] ?? 0)}</td>` : ''}`).join('')}
                  <td class="num">${forwardedBadge(model, `${ab}.score`, { only: 'permanent' }) || '—'}</td>
                  <td class="num total">${c.abilities[ab]?.score ?? r.total ?? 0}</td>
                </tr>`;
            }).join('')}
              <tr class="costrow">
                <th scope="row">Cost</th>
                <td class="num">${pb.total}</td>
                ${permCols.slice(1).map(() => '<td></td>').join('')}
                ${groups.filter((g) => g.sum).map(() => '<td></td>').join('')}
                <td></td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="statline" style="margin-top:8px">
          <span class="label">Point-buy spend</span>
          <span class="value ${pb.total > pb.budget ? 'over' : ''}">
            ${pb.total} / ${pb.budget}
            ${pb.total > pb.budget ? ` (${pb.total - pb.budget} over)` : ''}
          </span>
        </div>
        <p class="hint">
          Per ability: ${ABILITIES.map((a) => `${ABILITY_LABELS[a]} ${pb.per[a] >= 0 ? '' : ''}${pb.per[a]}`).join(' &middot; ')}
        </p>
        <p class="hint">
          <strong>ABP</strong>${optionalArray ? ', <strong>Array</strong>' : ''} and <strong>Level/4</strong> are
          filled in from the picks below and cannot be typed over.
          <strong>Gear</strong> uses the typed value or the best item enhancement bonus on the Equipment tab, whichever is larger.
          <strong>Attuned</strong> is a single +${ATTUNEMENT_BONUS}. It unlocks at
          level ${ATTUNEMENT_MIN_LEVEL}${unlocked ? '' : ' (locked)'}.
        </p>
        ${over.length ? `<p class="hint warn">
          ${over.map((a) => `<strong>${ABILITY_LABELS[a]}</strong>: ${esc(enhancementCapNote(build[a].resolved))}`).join(' ')}
        </p>` : ''}
      </section>

      <section class="panel">
        <h3>Temporary bonuses</h3>
        <div class="tablewrap">
          <table class="build statcols">
            <thead>
              <tr class="groups"><th colspan="${BUILD_TEMPORARY.length + 7}"></th></tr>
              <tr>
                <th></th>
                ${BUILD_TEMPORARY.map(([, label, full]) => `<th class="num" title="${esc(full)}">${esc(label)}</th>`).join('')}
                <th class="num" title="Temporary bonuses forwarded from elsewhere on the sheet, written as {str.temp += 2 as size} or {str.score += 2 as temp.size}.">Fwd</th>
                <th class="num" title="Total of the temporary columns.">Temp</th>
                <th class="num" title="Ability drain, entered in the Ability scores panel. It lowers the score.">Drain</th>
                <th class="num" title="Ability damage, entered in the Ability scores panel. Every 2 points give −1 to the modifier. The score does not change.">Dmg</th>
                <th class="num" title="Temporary score minus drain, used by every derived stat.">Score</th>
                <th class="num">Mod</th>
              </tr>
            </thead>
            <tbody>
              ${ABILITIES.map((ab) => {
              const r = build[ab].resolved || {};
              const a = c.abilities[ab];
              const harm = abilityHarm(a);
              return `<tr>
                  <th scope="row"><span class="abmark" data-ab="${ab}">${ABILITY_LABELS[ab]}</span></th>
                  ${BUILD_TEMPORARY.map(([k]) => cell(ab, k)).join('')}
                  <td class="num">${`${forwardedBadge(model, `${ab}.score`, { only: 'temporary' })}${
                    forwardedBadge(model, `${ab}.temp`)}` || '—'}</td>
                  <td class="num${r.tempEnhancementWasted ? ' over' : ''}"${
                  r.tempEnhancementWasted ? ` title="${esc(tempEnhancementNote(build[ab]))}"` : ''}>${
                  r.temporary || a.forwarded?.temporary || a.forwardedTemp?.total
                  ? fmt((r.temporary || 0) + (a.forwarded?.temporary || 0) + (a.forwardedTemp?.total || 0)) : '—'}</td>
                  <td class="num">${harm.drain ? minus(-harm.drain) : '—'}</td>
                  <td class="num">${harm.damage ? `${harm.damage} (${minus(-Math.floor(harm.damage / 2))})` : '—'}</td>
                  <td class="num total${harm.drain ? ' harmed' : ''}">${a.workingScore ?? a.tempScore ?? r.tempTotal ?? 0}</td>
                  <td class="num total${harm.damage ? ' harmed' : ''}">${fmt(a.totalMod)}</td>
                </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>
        <p class="hint">
          Temporary bonuses add to the Temp Score used by every derived stat; the permanent
          Total does not change. <strong>Fwd</strong> is a bonus forwarded from elsewhere on the
          sheet. Write <code>{str.score += 2 as size}</code> for a permanent one, or
          <code>{str.temp += 2 as size}</code> or <code>{str.score += 2 as temp.size}</code> for a
          temporary one. The badge links to the text that added it.
        </p>
        ${tempOver.length ? `<p class="hint warn">
          ${tempOver.map((a) => `<strong>${ABILITY_LABELS[a]}</strong>: ${esc(tempEnhancementNote(build[a]))}`).join(' ')}
        </p>` : ''}
      </section>

      ${/* The ladders, in the Ability scores group's band beside the tables
            above, which gives each the width its table wants. */''}
      ${campaignRules(model.data).abp ? abpPicksPanel(model) : ''}
      ${coreAbp(model.data) ? abpAttunePanel(model) : ''}
      ${milestonePicksPanel(model)}
      ${optionalArray ? arrayPicksPanel(model) : ''}`;
}

/**
 * Which retired build columns the table shows.
 *
 * Inherent bonuses are no longer handed out, so the column is dead weight on
 * a fresh character -- but a character imported with one must not have it
 * quietly dropped. So the default is "show it only if it holds something",
 * and the header button overrides that either way, remembered per character.
 */
function showOptionalBuildColumns(model, build) {
  const pref = model.data.uiPrefs?.buildColumns || {};
  return Object.fromEntries(BUILD_OPTIONAL_KEYS.map((k) => [k,
    pref[k] ?? ABILITIES.some((ab) => Number(build[ab]?.[k]) || 0)]));
}

/**
 * Saves and AC, broken down by bonus type -- the sheet's own two tables.
 *
 * They live here rather than on the Overview because this is where the sheet
 * keeps them, and because a flat save or AC bonus has nowhere else to go: the
 * Overview shows the totals, this is where they are built.
 *
 * Every cell takes a number or a formula, so a conditional bonus can be
 * written as the rule it is rather than a number that goes stale.
 */
/**
 * Whether a Sheet cell still holds something: a number other than 0, or a
 * formula. Blank and 0 are what clearing it leaves.
 */
const holdsSheet = (v) => (typeof v === 'string'
  ? v.trim() !== '' && Number(v.trim()) !== 0
  : v !== null && v !== undefined && Number(v) !== 0);

function defenceBonusPanel(model) {
  const c = model.data;
  // The Sheet column is what an imported workbook's total held beyond the
  // columns the export could read. It is there to be moved into the right
  // columns, and goes once a table's Sheet cells are all cleared; a
  // character built here never has one.
  const saveKeys = ['fortitude', 'reflex', 'will'];
  const savesSheet = saveKeys.some((k) => holdsSheet(c.saves?.[k]?.bonuses?.sheet));
  const acSheet = holdsSheet(c.defenses?.acBonuses?.sheet);
  // The ABP columns are read off the level, and each sits beside the typed
  // bonus of the same kind: the pair sums to the cap, and a typed value past
  // the cap stands alone. The group styling says so. Without ABP (a campaign
  // rule) the columns go, and a typed bonus stands on its own.
  const abpOn = campaignRules(c).abp;
  const abpOf = Object.fromEntries(ABP_DEFENCE_GROUPS);
  const typedOf = abpOn ? Object.fromEntries(ABP_DEFENCE_GROUPS.map(([a, t]) => [t, a])) : {};
  const shown = (sheetShown) => ([key]) => (key !== 'sheet' || sheetShown) && (abpOn || !abpOf[key]);
  const saveTypes = SAVE_BONUS_TYPES.filter(shown(savesSheet));
  const acTypes = AC_BONUS_TYPES.filter(shown(acSheet));
  const groupClass = (key) => (key === 'sheet' || abpOf[key] ? ' grouped groupstart'
    : typedOf[key] ? ' grouped groupend' : '');
  const cells = (block, resolved, errors, types, bind) => types.map(([key, , flags]) => {
    const off = flags && (flags.touch === false || flags.flatFooted === false);
    const title = off ? `title="${flags.touch === false ? 'Touch AC ignores it.' : 'Lost when flat-footed.'}"` : '';
    if (abpOf[key]) {
      return `<td class="num${groupClass(key)}" ${title}>
          ${roField(resolved?.[key] ?? 0, `From the ABP ladder at level ${c.identity.level}. With the typed bonus beside it, the pair stops at +${ABP_DEFENCE_CAP}.`,
    // As wide as the typed cells beside it, so every column is one width.
    'style="width:100%;min-width:4.4rem;box-sizing:border-box"')}</td>`;
    }
    const pairTitle = typedOf[key]
      ? ` Together with the ABP bonus beside it, at most +${ABP_DEFENCE_CAP}. A value above +${ABP_DEFENCE_CAP} applies alone.` : '';
    const over = typedOf[key] && abpGroupTotal(resolved?.[typedOf[key]], resolved?.[key]) < (Number(resolved?.[typedOf[key]]) || 0) + (Number(resolved?.[key]) || 0);
    return `<td class="num${groupClass(key)}${over ? ' over' : ''}" ${title}>
        ${exprField(bind(key), block?.[key] ?? 0, {
        width: '4.4rem',
        value: resolved?.[key],
        error: errors?.[key],
        title: 'A number or a formula, e.g. min(str.mod - dex.mod, 3 + floor(bab / 2)).' + pairTitle,
      })}</td>`;
  }).join('');

  // A short label over each column, its full name and what it does not reach
  // on hover -- and, for a typed bonus paired with an ABP one, the cap.
  const head = (types) => types.map(([key, label, flags]) => {
    const said = [bonusColumnName(key)];
    if (flags?.touch === false) said.push('does not apply to touch AC');
    else if (flags?.flatFooted === false) said.push('lost while flat-footed');
    if (typedOf[key]) said.push(`at most +${ABP_DEFENCE_CAP} together with the ABP bonus beside it`);
    return `<th class="num${groupClass(key)}" title="${esc(`${said[0]}${said.length > 1 ? `: ${said.slice(1).join('; ')}` : ''}`)}">${esc(label)}</th>`;
  }).join('');

  return `<section class="panel span2">
      <h3>Save &amp; AC bonuses</h3>
      <div class="tablewrap"><table class="build bonusgrid">
        <thead><tr><th></th><th class="num">Total</th>${head(saveTypes)}</tr></thead>
        <tbody>${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => {
        const s = c.saves[k];
        return `<tr>
            <th scope="row">${label}</th>
            <td class="num total" title="Base ${s.base} + ability + these">${fmt(s.total)}</td>
            ${cells(s.bonuses, s.bonusesResolved, s.bonusErrors, saveTypes,
            (key) => `data-set="saves.${k}.bonuses.${key}"`)}
          </tr>`;
      }).join('')}</tbody>
      </table></div>
      <div class="tablewrap" style="margin-top:10px"><table class="build bonusgrid">
        <thead><tr><th></th><th class="num">Total</th>${head(acTypes)}</tr></thead>
        <tbody><tr>
          <th scope="row">AC</th>
          <td class="num total" title="Touch ${c.defenses.touch} · flat-footed ${c.defenses.flatFooted}">${c.defenses.ac}</td>
          ${cells(c.defenses.acBonuses, c.defenses.acBonusesResolved, c.defenses.acBonusErrors,
          acTypes, (key) => `data-set="defenses.acBonuses.${key}"`)}
        </tr></tbody>
      </table></div>
      <p class="hint">
        Each cell accepts a number or a formula, such as
        <code>min(str.mod - dex.mod, 3 + floor(bab / 2))</code>, which updates when BAB changes.
        Formulas can read abilities, level, BAB and any name defined in text, and show in the
        GM's Formula Audit.
      </p>
      <p class="hint">
        Natural armor and enhancement bonuses do not apply to <strong>touch</strong> AC, and
        dodge is lost while <strong>flat-footed</strong>. The three <strong>ABP</strong> columns
        follow the character's level and cannot be typed. Each is paired with the typed bonus of
        the same kind (resistance, deflection, enhanced natural armor), and the pair adds up to at
        most +${ABP_DEFENCE_CAP}. A typed bonus above +${ABP_DEFENCE_CAP} applies alone.${savesSheet || acSheet ? `
        <strong>Sheet</strong> is the part of the imported total that the export could not place
        in a column. Move it into the right columns; the Sheet column disappears once its cells
        are cleared.` : ''}
      </p>
    </section>`;
}

/**
 * The two milestone ladders, side by side.
 *
 * Level/4 and mythic are the same shape -- one ability at each of five
 * milestones -- and each was a narrow table with a column of empty space
 * beside it, so they share one panel. They are greyed independently: a level
 * you have not reached and a tier you have not reached are different things.
 */
function milestonePicksPanel(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const tier = Number(c.identity.mythicTier) || 0;
  // Without mythic (a campaign rule) the table is the Level/4 half alone.
  // Both halves run to the campaign's highest level and tier: every fourth
  // level, every even tier.
  const { mythic, maxLevel } = campaignRules(c);
  const fourths = Array.from({ length: Math.floor(maxLevel / 4) }, (_, i) => (i + 1) * 4);
  const evens = mythicStatTiers(c);
  const level4 = (l) => (c.progressionPicks?.level4 || []).find((p) => p.level === l) || {};
  const rows = mythic ? Math.max(fourths.length, evens.length) : fourths.length;
  return `<section class="panel">
      <h3>${mythic ? 'Level/4 &amp; mythic increases' : 'Level/4 increases'}</h3>
      <div class="tablewrap"><table class="build picks">
        <thead>
          <tr class="groups">
            <th class="num grouphead" colspan="2">Level/4 <span class="capnote">+1</span></th>
            ${mythic ? '<th class="num grouphead grouped groupstart" colspan="2">Mythic <span class="capnote">+2</span></th>' : ''}
          </tr>
          <tr>
            <th class="num">Lvl</th><th>Ability</th>
            ${mythic ? '<th class="num grouped groupstart">Tier</th><th class="grouped groupend">Ability</th>' : ''}
          </tr>
        </thead>
        <tbody>${Array.from({ length: rows }, (_, i) => {
        // One milestone pair per row: its number, then its ability.
        const pair = (milestone, reached, control, band) => (milestone === undefined
          ? `<td class="noslot ${band}"></td><td class="noslot ${band}"></td>`
          : `<td class="num ${band} ${reached ? '' : 'future'}">${milestone}</td>
               <td class="${band} ${reached ? '' : 'future'}">${control}</td>`);
        const l = fourths[i];
        const t = evens[i];
        return `<tr>
            ${pair(l, l <= level, l === undefined ? ''
            : pickSelect('level4', l, 0, level4(l).ability, ABILITY_LABELS_LIST, false), '')}
            ${mythic ? pair(t, t <= tier, t === undefined ? ''
            : pickSelect('mythicStat', t, 0, mythicPickAt(model, t), ABILITY_LABELS_LIST, false),
          'grouped') : ''}
          </tr>`;
      }).join('')}</tbody>
      </table></div>
      <p class="hint">${mythic ? `
        <strong>Level/4</strong> is +1 at every fourth level. <strong>Mythic</strong> is
        +2 at every even tier. These are the same increases as the ladder on
        <strong>Feats &amp; Mythic</strong>. Editing either one changes both.
        Currently level ${level}, tier ${tier}. Anything past that is grayed and does not
        count yet.` : `
        <strong>Level/4</strong> is +1 at every fourth level. Currently level ${level}.
        Anything past that is grayed and does not count yet. Mythic is off in the campaign
        rules, so its increases are not shown.`}
      </p>
    </section>`;
}

/** The ability picked for one mythic tier's +2, if any. */
export function mythicPickAt(model, tier) {
  return (model.data.mythicStatPicks || [])
    .find((p) => Number(p.tier) === tier)?.ability;
}

/**
 * A choice made at an earlier level, showing here because this level raises it.
 *
 * The same control as the choice itself, locked. It used to be bare text with
 * a badge after it, which made a row that grants a +2 look like a row that
 * grants nothing -- the eye reads a column of selects and skips the line of
 * prose in the middle of it. It is the same decision and the same +2, so it
 * gets the same box; what says it is not yours to change here is that it is
 * disabled, and the badge saying where it was made.
 */
export function inheritedPick(kind, level, slot, value, allowed, from, { badge = true } = {}) {
  return `${pickSelect(kind, level, slot, value, allowed, true)}${
    badge ? `<span class="badge from">from ${from}</span>` : ''}`;
}

/** A select of allowed abilities for one progression pick. */
export function pickSelect(kind, level, slot, value, allowed, disabled) {
  const ab = picksAbility(allowed);
  const opts = ['', ...allowed].map((a) => {
    const v = a || '';
    const label = a || '—';
    const sel = String(value || '').toLowerCase().slice(0, 3) === v.toLowerCase().slice(0, 3) && (a || !value);
    return `<option value="${esc(v)}"${abAttr(ab, v)}${sel ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
  // The pick is matched on its first three letters just above, so a sheet
  // that wrote "Strength" out in full is still a Str pick -- and still red.
  return `<select data-pick="${kind}|${level}|${slot}" ${disabled ? 'disabled' : ''}${
    abAttr(ab, String(value || '').slice(0, 3))}>${opts}</select>`;
}


function abpPicksPanel(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const picks = c.progressionPicks?.abp || [];
  const at = (l) => picks.find((p) => p.level === l) || {};
  // Core ABP (a campaign rule) stops prowess at 18th: legendary gifts follow.
  const core = coreAbp(c);
  const steps = core ? CORE_PROWESS_LEVELS : { mental: MENTAL_PROWESS_LEVELS, physical: PHYSICAL_PROWESS_LEVELS };
  return `<section class="panel">
      <h3>ABP: Mental &amp; Physical Prowess</h3>
      <div class="tablewrap"><table class="build picks">
        <thead><tr><th class="num">Lvl</th><th>Mental</th><th>Physical</th></tr></thead>
        <tbody>${ABP_LEVELS.filter((l) => steps.mental.includes(l) || steps.physical.includes(l)).map((l) => {
        const row = at(l);
        const future = l > level;
        // A track that gains nothing at this level has no slot at all, so
        // the cell is left empty rather than showing a dead control.
        // Levels that only raise an earlier pick show it, locked.
        const cell = (track, allowed) => {
          const levels = steps[track];
          if (!levels.includes(l)) return '<td class="noslot"></td>';
          const src = abpSourceLevel(track, l);
          if (src !== l) {
            return `<td class="linked" title="Raises the level ${src} choice">
                ${inheritedPick('abp', l, track, at(src)[track], allowed, src)}</td>`;
          }
          return `<td>${pickSelect('abp', l, track, row[track], allowed, false)}</td>`;
        };
        return `<tr class="${future ? 'future' : ''}">
            <td class="num">${l}</td>
            ${cell('mental', PROWESS_TRACKS.mental)}
            ${cell('physical', PROWESS_TRACKS.physical)}
          </tr>`;
      }).join('')}</tbody>
      </table></div>
      <p class="hint">
        +2 each. The two tracks advance on different levels, so most rows offer a
        choice on one side only. Levels 11 and 12 raise the ability chosen at 6 and 7
        instead of offering a new choice. Rows above level ${level} are grayed and do not
        count yet.${core ? ` Core ABP stops at 18th; 19th and 20th give legendary gifts
        instead, shown beside this panel.` : ''}
      </p>
    </section>`;
}

/**
 * Core ABP's attunement and legendary gifts (a campaign rule): which armour
 * and weapons carry the attunement's enhancement bonus, and the gifts 19th
 * and 20th bring. What each attuned item gets is worked out in
 * model/campaign.js (`abpAttuneOf`) and shown beside its box.
 */
function abpAttunePanel(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const { one, two } = abpAttunement(level);
  const att = c.abpAttune || { shields: [], weapons: [] };
  const e = c.equipment || {};
  const plus = (n) => (n ? ` <span class="badge ok">+${n}</span>` : '');
  const now = one ? `+${one}${two ? `, or +${two[0]} and +${two[1]} split across two` : ''}` : 'none before 4th level';
  const armour = [
    e.armor?.active ? `${check('equipment.armor.attuned', e.armor.attuned, e.armor.name || 'Armor')}${plus(att.armor)}` : '',
    ...(e.shields || []).map((s, i) => (s?.active
      ? `${itemCheck('equipment.shields', i, 'attuned', s.attuned, s.name || `Shield ${i + 1}`)}${plus(att.shields?.[i])}` : '')),
  ].filter(Boolean);
  const weapons = (e.weapons || []).map((w, i) => `${itemCheck('equipment.weapons', i, 'attuned', w.attuned, w.name || `Weapon ${i + 1}`)}${
    plus(att.weapons?.[i])}`);
  const gifts = level >= 20 ? LEGENDARY_GIFTS[19] + LEGENDARY_GIFTS[20] : level >= 19 ? LEGENDARY_GIFTS[19] : 0;
  return `<section class="panel">
      <h3>ABP: Attunement &amp; legendary gifts</h3>
      <h4 class="subhead">Armor attunement <span class="badge">${esc(now)}</span></h4>
      <div class="attunelist">${armour.join(' ') || '<span class="hint">No armor or shield in use.</span>'}</div>
      <p class="hint">${att.clothing ? `Nothing worn: your clothes get it, +${att.clothing} armor.`
    : 'None ticked: the armor you wear gets it.'}</p>
      <h4 class="subhead">Weapon attunement <span class="badge">${esc(now)}</span></h4>
      <div class="attunelist">${weapons.join(' ') || '<span class="hint">No weapons on the Equipment tab.</span>'}</div>
      <p class="hint">Tick the weapon it is on${two ? ', or two to split it' : ''}. The higher of it and a weapon's own
        enhancement counts, on attack and damage.</p>
      <h4 class="subhead">Legendary gifts <span class="badge${gifts ? '' : ' future'}">${gifts ? `${gifts} to choose` : 'at 19th'}</span></h4>
      ${area('progressionPicks.legendaryGifts', c.progressionPicks?.legendaryGifts, 3)}
      <p class="hint">Three at 19th and five more at 20th. These are not calculated; a gift that
        raises a number can do so with a formula, such as {str += 2}.</p>
    </section>`;
}


/**
 * The optional array: four columns, and only the last is a new choice each time.
 *
 * A table rather than the wrapping rows it used to be, because the four picks
 * *are* four columns and laying them out as three loose groups hid it -- the
 * Con at 12 and the Con at 16 were the same decision as the Con at 8 and there
 * was nothing on screen to say so. Down a column now, chosen once at the top
 * and locked underneath, which is the shape the rule actually has. See
 * `ARRAY_LINKED_LEVELS`; a level with no gain in a column gets no cell at all
 * rather than a dead control.
 */
function arrayPicksPanel(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const picks = c.progressionPicks?.array || [];
  const at = (l) => picks.find((p) => p.level === l) || { slots: [] };
  const columns = Array.from({ length: ARRAY_MAX_SLOTS }, (_, i) => i);
  return `<section class="panel fit">
      <h3>Optional array</h3>
      <p class="hint warn" style="margin-top:0">
        Bought separately, with Primordia shards. These do not come with the level.
      </p>
      <div class="tablewrap"><table class="build picks">
        <thead><tr><th class="num">Lvl</th>${
  columns.map((i) => `<th>${i + 1}</th>`).join('')}</tr></thead>
        <tbody>${ARRAY_LEVELS.map((l) => {
    const slots = ARRAY_SLOTS[l] || [];
    return `<tr class="${l > level ? 'future' : ''}">
            <td class="num">${l}</td>
            ${columns.map((slot) => {
    if (!slots.includes(slot)) return '<td class="noslot"></td>';
    const src = arraySourceLevel(slot, l);
    if (src !== l) {
      // No badge here, unlike ABP: this is a column with the same answer
      // repeated down it and the only editable box at the top, which says
      // "chosen once" better than any label on the cell could. The tooltip
      // still names the level for anyone who wants it spelled out.
      return `<td class="linked" title="Raises the level ${src} choice">
                  ${inheritedPick('array', l, slot, at(src).slots?.[slot], ABILITY_LABELS_LIST, src, { badge: false })}</td>`;
    }
    return `<td>${pickSelect('array', l, slot, at(l).slots?.[slot], ABILITY_LABELS_LIST, false)}</td>`;
  }).join('')}
          </tr>`;
  }).join('')}</tbody>
      </table></div>
      <p class="hint">+2 each. Four picks at 8, three at 12 and 16. The first three
        columns are one choice raised again later. Only the fourth is chosen anew each
        time.${c.progressionPicks?.arrayNote
      ? ` Sheet note: ${esc(String(c.progressionPicks.arrayNote).replace(/^Array \(Optional\)\s*/, '').replace(/\s+/g, ' '))}` : ''}</p>
    </section>`;
}

/* ---------------- abilities, defenses and offenses ---------------- */

/**
 * The three rests, as the Quick actions card and the hit-point panel both
 * offer them. Each brings back what lasts that long and takes in the shorter
 * ones (model/rest.js), and each is one step of undo.
 */
/** Dead, dying or unconscious, as a warning line; nothing while the character is up. */
export function hpStatus(hp) {
  const status = hp.dead ? 'dead' : hp.dying ? 'dying' : hp.unconscious ? 'unconscious' : null;
  if (!status) return '';
  const said = status === 'dead' ? `Dead: at or below ${minus(hp.deathAt)}.`
    : status === 'dying' ? `Dying: ${hp.current - hp.deathAt} point${hp.current - hp.deathAt === 1 ? '' : 's'} from death at ${signed(hp.deathAt)}.`
      : hp.nonlethal >= hp.effective && hp.current > 0 ? 'Unconscious: nonlethal damage equals or exceeds current hit points.'
        : 'Unconscious.';
  return `<p class="hint warn">${said}</p>`;
}

export function restButtons() {
  return `<button data-action="rest-encounter"
      title="Reset trackers that refresh after an encounter.">End encounter</button>
    <button data-action="rest-day"
      title="Restore hit points, clear temporary hit points and nonlethal damage, and reset daily and encounter trackers, spell slots, power points, temporary essence and companion hit points.">New day</button>
    <button data-action="rest-week"
      title="A new day, plus reset weekly trackers.">New week</button>`;
}

/**
 * Damage and drain beside a score: what each comes to, and what a score
 * worn to nothing means. Drawn under the score's row so the grid keeps its
 * columns.
 */
function harmMark(k, a) {
    // The working score and modifier beside it already carry both; this says why.
    const { damage, drain } = abilityHarm(a);
    if (!damage && !drain) return '';
    const bits = [damage ? `${damage} damage (${minus(-Math.floor(damage / 2))} mod)` : '', drain ? `${drain} drain` : ''].filter(Boolean);
    const collapse = abilityCollapse(k, a);
    return `<span class="abharm${collapse ? ' bad' : ''}">${esc(bits.join(', '))}${collapse ? `; ${esc(collapse)}` : ''}</span>`;
  }

/** The six damage and drain boxes, folded away until something is in them. */
function abilityHarmTable(model) {
    const c = model.data;
    const any = ABILITIES.some((k) => { const h = abilityHarm(c.abilities[k]); return h.damage || h.drain; });
    const body = `<div class="tablewrap"><table class="abdmg">
      <thead><tr><th></th>${ABILITIES.map((k) => `<th class="num">${ABILITY_LABELS[k]}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><th scope="row" title="Every 2 points of damage give −1 to the modifier. A New day heals 1 point of each.">Damage</th>
          ${ABILITIES.map((k) => `<td>${num(`abilities.${k}.damage`, c.abilities[k]?.damage, `min="0" aria-label="${ABILITY_LABELS[k]} damage"`)}</td>`).join('')}</tr>
        <tr><th scope="row" title="Lowers the score itself. Rest does not heal it.">Drain</th>
          ${ABILITIES.map((k) => `<td>${num(`abilities.${k}.drain`, c.abilities[k]?.drain, `min="0" aria-label="${ABILITY_LABELS[k]} drain"`)}</td>`).join('')}</tr>
      </tbody></table></div>`;
    return collapsibleSub(model, 'ability-harm', 'Damage &amp; drain', body, '', !any);
  }

/**
 * The six scores, their modifiers and a roll for each. `readOnly` is the
 * Overview's copy: every score a read-out, no damage and drain boxes, and
 * `head` (its Edit link) in the heading.
 */
export function abilityScoresPanel(model, { readOnly = false, head = '' } = {}) {
    const c = model.data;
    const cs = model.conditionState;
    const built = !!c.statsBuild || readOnly;
    return `<section class="panel fit"${readOnly ? '' : ' data-home="abilities"'}>
      <h3>Ability scores ${head}</h3>
      <div class="ability-head">
        <span>&nbsp;</span><span>Score</span><span>Mod</span>
        <span class="h-temp">Temp</span><span class="h-temp">Mod</span><span>Roll</span>
      </div>
      <div class="abilities">
        ${ABILITIES.map((k) => {
          const a = c.abilities[k];
          const moved = cs.changed && cs.deltas[k];
          // Both scores carry their whole working: the permanent one is ten
          // columns on a tab most players never open, and the temporary one
          // is that plus five more.
          const tip = (key, extra = '') => esc(workingTitle(model.breakdown(key), extra));
          // And the key the hover panel opens from -- on the read-outs only.
          // A panel standing under a field you are typing in covers the next
          // field, and a score typed in by hand has no working worth opening.
          const bd = (key, extra = '') => ` data-bd="${esc(key)}"${extra ? ` data-bdx="${esc(extra)}"` : ''}`;
          return `<div class="ability">
            <span class="ab abmark" data-ab="${k}">${ABILITY_LABELS[k]}</span>
            ${built
              ? `<span class="mod working" title="${tip(k)}"${bd(k)}>${a.score}</span>`
              : `<input type="number" value="${a.score}" data-set="abilities.${k}.score" aria-label="${ABILITY_LABELS[k]} score" title="${tip(k)}">`}
            <span class="mod">${fmt(a.mod)}</span>
            ${moved
              ? movedValue(`${cs.scores[k]}`, cs.scores[k] - (a.workingScore ?? a.tempScore), {
                tag: 'span',
                cls: 'mod temp-score working',
                title: workingTitle(model.breakdown(`${k}.temp`), `${a.workingScore ?? a.tempScore} before conditions`),
                attrs: bd(`${k}.temp`, `${a.workingScore ?? a.tempScore} before conditions`).trim(),
              })
              : built
                ? `<span class="mod temp-score working${abilityHarm(a).drain ? ' harmed' : ''}" title="${tip(`${k}.temp`)}"${bd(`${k}.temp`)}>${a.workingScore ?? a.tempScore}</span>`
                : `<input class="temp-score" type="number" value="${a.tempScore}" data-set="abilities.${k}.tempScore" aria-label="${ABILITY_LABELS[k]} temporary score" title="${tip(`${k}.temp`)}">`}
            ${movedValue(fmt(a.totalMod + (moved ? cs.deltas[k] : 0)), moved ? cs.deltas[k] : 0, {
    tag: 'span', cls: 'mod temp temp-mod', title: moved ? `${fmt(a.totalMod)} before conditions` : '', keep: true,
  })}
            ${rollButton(model, 'ability', k, `a ${ABILITY_LABELS[k]} check`, cs)}
            ${harmMark(k, a)}
          </div>`;
        }).join('')}
      </div>
      ${readOnly ? '' : abilityHarmTable(model)}
      ${c.statsBuild && !readOnly ? `<p class="hint" style="margin-top:8px">
        Scores are the totals of the Permanent bonuses and Temporary bonuses tables.
      </p>` : ''}
      ${cs.changed && ABILITIES.some((k) => cs.deltas[k]) ? `<p class="hint warn">
        Scores and modifiers in red include the ticked conditions.
      </p>` : ''}
    </section>`;
  }

export function acPanel(model) {
    const d = model.data.defenses;
    const cs = model.conditionState;
    const cell = (key, base) => `<td class="num total">${movedInline(cs, key, base, String, model)}</td>`;
    return `<section class="panel fit" data-home="ac">
      <h3>Armor class</h3>
      <div class="tablewrap"><table class="defense fitcols">
        <thead><tr><th></th><th class="num">Total</th>
          <th class="num" title="Your own flat bonus">Misc</th>
          ${sheetBonusHead()}</tr></thead>
        <tbody>
          <tr><td>Armor Class</td>${cell('ac', d.ac)}
            <td class="num">${num('defenses.miscAC', d.miscAC, 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'defenses.ac')}</tr>
          <tr><td>Touch</td>${cell('touch', d.touch)}
            <td class="num" title="Misc AC does not apply to touch AC.">—</td>
            ${sheetBonusCell(model, 'defenses.touch')}</tr>
          <tr><td>Flat-footed</td>${cell('flatFooted', d.flatFooted)}
            <td class="num">${roField(d.miscAC || 0, 'The Misc AC above. It applies to flat-footed AC.', 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'defenses.flatFooted')}</tr>
          <tr><td title="10 + BAB + Str + Dex + special size modifier, plus circumstance, deflection, dodge, insight, luck, morale, sacred and profane AC bonuses and all AC penalties.">CMD</td>${cell('cmd', d.cmd)}
            <td class="num">${num('defenses.miscCMD', d.miscCMD, 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'defenses.cmd')}</tr>
        </tbody>
      </table></div>
      ${cs.acVsMelee || cs.acVsRanged ? `<p class="hint warn">
        ${cs.acVsMelee ? `${fmt(cs.acVsMelee)} AC against melee` : ''}${cs.acVsMelee && cs.acVsRanged ? ', ' : ''}${
          cs.acVsRanged ? `${fmt(cs.acVsRanged)} AC against ranged` : ''} from conditions, in addition to the numbers above.
      </p>` : ''}
      <div class="statline"><span class="label">AC ability</span>
        <span class="value pair slots">${abilitySelect('defenses.acStat1', d.acStat1)}
          <span class="hint">+</span>${abilitySelect('defenses.acStat2', d.acStat2)}</span></div>
      <div class="statline"><span class="label">Uncanny dodge</span>
        <span class="value">${check('defenses.uncannyDodge', d.uncannyDodge)}</span></div>
      <div class="defboxes">
      ${defenceBox(model, 'spellResistance', 'Spell resistance', 'Yes (17), or {= 11 + level}')}
      ${defenceBox(model, 'dr', 'DR', '5/magic')}
      ${defenceBox(model, 'resistance', 'Resistance', 'fire 10, cold 5')}
      ${defenceBox(model, 'weakness', 'Vulnerability', 'sonic 5')}
      ${defenceBox(model, 'immunities', 'Immunities', 'sleep, paralysis')}
      </div>
      <p class="hint">These five boxes accept <code>{…}</code> formulas. Each part is a bonus
        target: <code>{dr.magic += 2}</code>, <code>{resistance.fire += 5}</code>,
        <code>{immune.sleep += 1}</code>, <code>{defenses.sr += 2}</code>. A bonus to a part the box
        does not have adds that part, so a misspelled name adds a new part instead of an error.</p>
      ${sheetBonusHint('Deflection, natural armor, insight and the rest')}
    </section>`;
  }

  /**
   * The name each defence box is parsed under, and the destination that
   * reaches every part of it at once. Immunities have no family total:
   * an immunity is a switch, not an amount, so there is nothing to add to.
   */
  const DEFENCE_BOXES = {
    spellResistance: { family: null, dest: 'defenses.sr', parts: 'sr' },
    dr: { family: 'dr', dest: 'defenses.dr', parts: 'dr' },
    resistance: { family: 'resistance', dest: 'defenses.resistance', parts: 'resistance' },
    weakness: { family: 'weakness', dest: 'defenses.weakness', parts: 'weakness' },
    immunities: { family: 'immune', dest: null, parts: 'immunities' },
  };

/**
 * One of the five defence boxes: what was typed, and what it comes to.
 *
 * The box itself is prose, so a DR that follows half your level is written
 * as the rule it is. Underneath, whenever a bonus has reached it from
 * somewhere else on the sheet, is the line as it now stands -- because the
 * box has to go on saying what was written in it (the same reason a skill's
 * Misc column is never folded into), and because "18/magic" appearing in a
 * box holding "5/magic" would be the sheet lying about what the player typed.
 *
 * The tooltip on that line names every rule that moved it, part by part, so
 * the number is followed back rather than guessed at.
 */
function defenceBox(model, key, label, example) {
    const d = model.data.defenses;
    const spec = DEFENCE_BOXES[key];
    const calc = d.calc || {};
    const parts = key === 'spellResistance' ? [] : (calc[spec.parts] || []);
    const moved = key === 'spellResistance'
      ? !!calc.sr?.bonus
      : parts.some((p) => p.bonus || p.granted);
    const now = key === 'spellResistance' ? calc.sr?.text
      : key === 'dr' ? calc.drText
        : key === 'resistance' ? calc.resistanceText
          : key === 'weakness' ? calc.weaknessText : calc.immunitiesText;
    // One badge for the box, gathered across the family destination and
    // every named part, saying the line as it now stands; its panel has one
    // row a rule, each naming the part it went to.
    const names = [spec.dest, ...parts.map((p) => p.key)];
    return `<div class="statline defbox">
      <span class="label" title="${esc(`For example: ${example}`)}">${esc(label)}</span>
      <span class="value">${prose(model, `data-set="defenses.${key}"`, d[key], 1, 'grow')}
        ${moved ? forwardedBadge(model, names, { shown: now || '—' }) : ''}</span></div>`;
  }


export function savesPanel(model) {
    const s = model.data.saves;
    const cs = model.conditionState;
    return `<section class="panel fit" data-home="saves">
      <h3>Saving throws</h3>
      <div class="tablewrap"><table class="saves stacked fitcols" data-fold="shut">
        <thead><tr><th>Save</th><th class="num">Total</th>
          <th class="num" title="From the Classes table (gestalt)">Base</th>
          <th>Ability</th><th title="A second ability that adds its modifier">2nd</th>
          ${sheetBonusHead()}</tr></thead>
        <tbody>${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => `
          <tr>
            <td data-stack="name">${label}</td>
            <td class="num total" data-stack="head"><span class="rollpair">${movedInline(cs, k, s[k].total, fmt, model)}${
  rollButton(model, 'save', k, `a ${label} save`, cs)}</span></td>
            <td class="num" data-label="Base" title="From the Classes table">${s[k].base}</td>
            <td data-label="Ability">${abilitySelect(`saves.${k}.stat1`, s[k].stat1)}</td>
            <td data-label="2nd ability">${abilitySelect(`saves.${k}.stat2`, s[k].stat2)}</td>
            ${sheetBonusCell(model, `saves.${k}.total`)}
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Base saves come from the Classes table on the Progression tab.</p>
      ${sheetBonusHint('Resistance bonuses, ABP and traits')}
    </section>`;
  }


/**
 * Initiative, as a row of its own: the ability it runs on, a second one
 * where a rule adds it, a Misc box, and the Other column every reconciled
 * number carries. It had a big number on the Overview and nothing to edit
 * behind it -- the ability came from the import and the rest was offset.
 */
function initiativePanel(model) {
    const c = model.data;
    const cs = model.conditionState;
    return `<section class="panel fit">
      <h3>Initiative</h3>
      <div class="tablewrap"><table class="saves stacked fitcols" data-fold="shut">
        <thead><tr><th></th><th class="num">Total</th>
          <th>Ability</th><th title="A second ability that adds its modifier">2nd</th>
          <th class="num" title="Your own bonus, such as from a trait, feat or familiar.">Misc</th>
          ${sheetBonusHead()}</tr></thead>
        <tbody>
          <tr>
            <td data-stack="name">Initiative</td>
            <td class="num total" data-stack="head"><span class="rollpair">${movedInline(cs, 'initiative', c.hp.initiative, fmt, model)}${
  rollButton(model, 'initiative', 'self', 'initiative', cs)}</span></td>
            <td data-label="Ability">${abilitySelect('hp.initAbility', c.hp.initAbility || 'Dex')}</td>
            <td data-label="2nd ability">${abilitySelect('hp.initAbility2', c.hp.initAbility2)}</td>
            <td class="num" data-label="Misc">${num('hp.initMisc', c.hp.initMisc, 'style="width:3.6rem"')}</td>
            ${sheetBonusCell(model, 'initiative')}
          </tr>
        </tbody>
      </table></div>
      ${sheetBonusHint('Improved Initiative, a trait, a familiar’s Alertness')}
    </section>`;
  }


export function attackPanel(model) {
    const c = model.data;
    const cs = model.conditionState;
    return `<section class="panel fit" data-home="attack">
      <h3>Attack</h3>
      ${lineHtml('Melee', `${movedInline(cs, 'melee', c.attack.totalMelee, fmt, model)}${
        rollButton(model, 'mode', 'melee', 'a melee attack', cs)}`, true)}
      ${lineHtml('Ranged', `${movedInline(cs, 'ranged', c.attack.totalRanged, fmt, model)}${
        rollButton(model, 'mode', 'ranged', 'a ranged attack', cs)}`, true)}
      ${lineHtml('CMB', `${movedInline(cs, 'cmb', c.attack.totalCmb, fmt, model)}${
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
    return lineHtml('Base attack bonus', autoNum('data-set="attack.babOverride"', over, {
      auto: true, placeholder: base, width: '4.2rem', title: why, label: 'Base attack bonus',
    }));
  })()}
      ${editLine('Misc attack bonus', 'attack.miscBonus', c.attack.miscBonus)}
      ${cs.changed && cs.delta.damage ? `<p class="hint warn">${fmt(cs.delta.damage)} on weapon damage rolls from ${cs.sources}.</p>` : ''}
      <div class="tablewrap" style="margin-top:8px"><table class="attackmodes fitcols">
        <thead><tr><th>Mode</th>
          <th class="num" title="An alternate uses the same attack with a different ability.">Total</th>
          ${sheetBonusHead()}
          <th>Ability</th><th title="A second ability that adds its modifier">2nd</th></tr></thead>
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
          const caret = altOf ? foldButton(model, `atk:${k}`, {
            open: !shut,
            cls: 'disclose',
            title: shut ? `Show the alternate (${altStat}, ${fmt(altTotal)})` : 'Hide the alternate',
          }) : '';
          // An alternate is the base attack with one ability swapped, so it
          // is already carrying the base's Other -- editing it here would be
          // editing the same number twice. The number is shown all the same,
          // read-only, so the row adds up in front of the reader.
          const other = alt
            ? `<td class="num" data-label="Other">${roValue(model.offsetOf(ATTACK_MODE_KEY[alt]),
              `Shares ${ATTACK_MODE_LABELS[alt]}'s. An alternate is that attack with a different ability.`)}</td>`
            : sheetBonusCell(model, ATTACK_MODE_KEY[k]);
          return `
          ${/* Not a stacked table, deliberately. Folded to a name and a total it
                would say exactly what the three big stat lines above it already
                say, and every row here carries a disclosure of its own for its
                alternate -- a second caret beside that one reads as a bug. It
                keeps its 188px of scroll. */''}
          <tr class="${alt ? 'altrow' : ''}"><td>${caret}${ATTACK_MODE_LABELS[k]}</td>
            ${/* Only a real mode has a working of its own: an alternate is the
                  same attack with another ability in the slot, and shares its
                  BAB, misc, size and reconciliation. */''}
            <td class="num total"><span class="rollpair">${movedInline(cs, k, total, fmt, alt ? null : model)}${
  rollButton(model, 'mode', k, `${ATTACK_MODE_LABELS[k].toLowerCase()} attacks`, cs)}</span></td>
            ${other}
            <td>${abilitySelect(`attack.modes.${k}.stat1`, c.attack.modes[k]?.stat1)}</td>
            <td>${abilitySelect(`attack.modes.${k}.stat2`, c.attack.modes[k]?.stat2)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">Base attack bonus comes from the Classes table on the Progression tab. An <strong>alternate</strong>
        is the same attack with a different ability, such as Dex for a finesse weapon or Wis for a
        monk's unarmed strike. It shares the same BAB, misc and size bonuses.</p>
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
    return `<section class="panel fit" data-home="speed">
      <h3>Speed</h3>
      ${speedTable('identity.speeds', speeds, speeds.map((sp) => ({
    bonus: sp.bonusNum, error: sp.bonusError, handle: sp.handle, final: sp.final,
    loadSlowed: sp.loadSlowed,
  })), {
    named: true,
    exampleFor: ' for fast movement',
    // What conditions and buffs do to the rate, where they move it.
    final: (i, w) => {
      const adj = cs.speeds[i];
      const moved = cs.changed && adj && adj.adjusted !== adj.final
        ? movedValue(`${adj.adjusted} ft.`, adj.adjusted - adj.final, { base: `${adj.final} ft.`, sources: cs.sources })
        : null;
      if (!w.loadSlowed) return moved;
      return `${moved ?? `${Number(w.final) || 0} ft.`} <span class="badge" title="Reduced by a medium or heavy load.">load</span>`;
    },
    badge: (handle) => forwardedBadge(model, handle),
  })}
      <p class="hint">Bonus accepts a formula, such as <code>floor(level / 3) * 10</code> for
        fast movement. Each rate is named by its type: formulas read <code>speed.land</code>, and a
        feature adds to it with <code>{speed.land += 10}</code>, or to every speed with
        <code>{speed += 10}</code>. A rate can read the rates above it, not below.</p>
    </section>`;
  }

/**
 * One of the three typed parts of the hit-point total, which takes a formula
 * as readily as a number: a favoured-class bonus is "one per level you took
 * it", and written out it stops going stale at the next level-up.
 */
function hpPart(c, key, title, width = '5.4rem') {
  const raw = c.hp[key];
  return exprField(`data-set="hp.${key}"`, raw ?? 0, {
    width,
    value: typeof raw === 'string' && raw.trim() ? c.hp[`${key}Resolved`] : null,
    error: c.hp[`${key}Error`],
    title,
  });
}

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
  const other = model.offsetOf('hp.total');
  const abilityMod = Number(g.abilityMod) || 0;
  const shut = !!c.uiPrefs?.collapsed?.['hp:build'];
  // How the dice count (campaign rules): which die each level, and how much of it.
  const rules = campaignRules(c);
  const dice = c.gestalt?.dice || [];
  const counted = { max: '', average: ', averaged after 1st', rolled: ', rolled after 1st' }[rules.hitPoints];

  // Only the parts that are doing something, so a plain character reads as
  // "dice plus Con" rather than as a form with four zeroes in it. A part that
  // takes hit points away is parenthesised rather than signed, because the
  // pluses between the terms are already doing that job.
  const term = (n) => (n < 0 ? `(${String(n).replace('-', '−')})` : String(n));
  const fcb = Number(c.hp.fcbResolved ?? c.hp.fcb) || 0;
  const tough = Number(c.hp.toughnessResolved ?? c.hp.toughness) || 0;
  const misc = Number(c.hp.miscResolved ?? c.hp.misc) || 0;
  const parts = [
    [term(c.gestalt?.hdTotal ?? 0), `hit dice over ${level} level${level === 1 ? '' : 's'}${counted}`],
    abilityMod ? [term(abilityMod * level), `${c.hp.ability || 'ability'}${
      c.hp.ability2 ? ` + ${c.hp.ability2}` : ''} ${fmt(abilityMod)} × ${level}`] : null,
    // The three typed parts as they resolved, since any of them may have been
    // written as a rule rather than a number.
    fcb ? [term(fcb), 'favored class'] : null,
    tough ? [term(tough * level), `Toughness ${fmt(tough)} × ${level}`] : null,
    model.mythicHp ? [term(model.mythicHp),
      `${c.mythic?.path || 'mythic'} tier ${c.identity?.mythicTier || 0}`] : null,
    misc ? [term(misc), 'misc'] : null,
    other ? [term(other), 'other: what the source sheet added that this sheet cannot read'] : null,
  ].filter(Boolean);

  const why = `${rules.gestalt ? 'The best hit die on each level' : 'The hit die of the class taken at each level'}${
    counted ? ` (${counted.slice(2)})` : ''} from the Classes table, plus every part below,`
    + ' including Other.';

  /*
   * The two ability slots are one field, the way the saves table and the AC row
   * already say it: "the ability, and a second one that adds its modifier". As
   * two full-width fields they were two rows of a narrow panel spent on three
   * letters each, and the second one read as a thing of its own rather than as
   * the other half of the first.
   */
  const abilityPair = field('HP ability',
    `<span class="pair slots">${abilitySelect('hp.ability', c.hp.ability)}
      <span class="hint">+</span>${abilitySelect('hp.ability2', c.hp.ability2)}</span>`);

  return `<div class="fieldgrid two">
        ${/* A read-out, not a box. It used to take a number that was *pinned*
              over the total, which froze every part below it -- and since an
              imported sheet whose classes cannot reach its own total is pinned
              from the moment it lands, that was most characters: raising
              Toughness moved nothing and the panel did not say why. The
              difference lives in Other now, and everything stays live. */''}
        ${field('Maximum', `<span class="value working" title="${esc(workingTitle(model.breakdown('hp'), why))}"
          data-bd="hp" data-bdx="${esc(why)}">${model.hpMax}</span>`)}
        ${abilityPair}
      </div>
      <p class="hint">${parts.map(([n, label]) => `<span title="${esc(label)}">${n}</span>`).join(' + ')}
        = <strong>${base + other}</strong>
        ${foldButton(null, 'hp:build', {
    open: !shut, cls: 'foldchip', title: shut ? 'Show the parts to edit them.' : 'Hide the parts.',
    text: shut ? '▸ More options' : '▾ Close',
  })}</p>
      ${shut ? '' : `${/* Three short figures across, then Misc on a row of its
            own: the first two hold a number or a small rule, while Misc is
            where everything the table gave you lands and is the one most
            likely to be written out longhand. A 5.4rem box is no place for
            `if(level >= 10, con.mod * 2, con.mod)`. */''}
      <div class="fieldgrid tight">
        ${field('Favored class HP', hpPart(c, 'fcb', 'A number or a formula, e.g. class.fighter.level'))}
        ${field('Toughness / level', hpPart(c, 'toughness', 'A number or a formula, e.g. if(level >= 10, 2, 1)'))}
        ${field('Mythic bonus', `<span class="value" title="${esc(`${
    c.mythic?.path || 'No path'}, ${c.identity?.mythicTier || 0} tier${
    (c.identity?.mythicTier || 0) === 1 ? '' : 's'}. Set the per-tier amount on the Features tab.`)}"
          >${fmt(model.mythicHp)}</span>`)}
        ${field('Other', `<span title="${esc('The difference between the imported total and the parts above, '
            + 'such as rolled hit points or a bonus from the GM. You can also add your own number or '
            + 'formula here.')}">${
  sheetBonusField(model, 'hp.total', '5.4rem')}</span>`)}
      </div>
      <div class="fieldgrid" style="margin-top:8px">
        ${field('Misc', hpPart(c, 'misc', 'A number or a formula, e.g. con.mod * 2', '100%'), 'wide')}
      </div>`}
      ${/* Rolled hit points (a campaign rule): a box per level after the
            first, blank counting the average, which the box shows. A fold of
            its own, open, so the rolls are there at a level-up whether or
            not the parts above are. */''}
      ${rules.hitPoints === 'rolled' && level > 1 ? collapsibleSub(model, 'hp:rolls', 'Rolled each level', `
      ${stepGrid('hp.rolls', c.hp.rolls, 2, level, (l) => hitDieGain(dice[l - 1], l, 'average'),
    (l) => `Hit points rolled at level ${l}, on a d${dice[l - 1] || 0}`)}
      <p class="hint">1st level gets the full die. A blank level, or a roll above the die, counts as
        the average shown in its box.</p>`) : ''}
      ${rules.hitPoints !== 'max' && other ? `<p class="hint warn">Other holds ${term(other)}. An imported
        sheet with rolled hit points puts the difference there. Hit points are now ${rules.hitPoints === 'rolled' ? 'rolled' : 'averaged'}
        here too, so clear Other if that is what it holds.</p>` : ''}`;
}

function hitPointsPanel(ctx, model) {
    const hp = model.hpState;
    return `<section class="panel hitpoints" data-home="hp">
      <h3>Hit points
        ${hp.temp > 0 ? `<span class="badge">+${hp.temp} temp</span>` : ''}
        ${hp.nonlethal > 0 ? `<span class="badge${hp.nonlethal >= hp.effective ? ' err' : ''}">${hp.nonlethal} nonlethal</span>` : ''}
        ${meterStyleButton(ctx, 'hp')}
      </h3>
      ${meterVisual(model.meterSpec('hp'))}
      ${meterStyleEditor(model, ctx, 'hp')}
      <div class="hprow">
        ${num('hp.current', hp.baseCurrent)}<span class="hpsep">/</span>
        <span class="value" title="Maximum hit points from the Classes table, plus forwarded bonuses.">${hp.baseMax}</span>
        ${hp.temp > 0 ? `<span class="hptemp" title="Temporary hit points, used first.">+${hp.temp}</span>` : ''}
        ${hp.shift ? `<span class="hint" title="Each negative level lowers current and maximum hit points by 5, and a buff to the maximum raises both. The box values return when these end."
          >now ${hp.current}/${hp.max}</span>` : ''}
      </div>
      ${hpBuild(model)}
      ${model.forwardedInto('hp.total')
        ? `<div class="fieldgrid two">${field('Forwarded',
          `<span class="value">${forwardedBadge(model, 'hp.total')}</span>`)}</div>` : ''}
      <div class="fieldgrid two">
        ${field('Temporary', `${num('hp.temp', hp.typedTemp)}${
          hp.tempGranted ? forwardedBadge(model, 'hp.temp', {
            shown: `+${hp.tempGrantLeft}`,
            note: `${hp.tempGranted} temporary hit point${hp.tempGranted === 1 ? '' : 's'} forwarded here${
              hp.tempGranted === hp.tempGrantLeft ? '' : `, ${hp.tempGranted - hp.tempGrantLeft} of them already spent`
            }. Damage uses the box first, then these.`,
          }) : ''}`)}
        ${field('Nonlethal', num('hp.nonlethal', hp.nonlethal))}
      </div>
      <div class="fieldgrid two">
        ${field('Death threshold +', `${exprField('data-set="hp.deathBonus"', model.data.hp.deathBonus ?? 0, {
          width: '5.4rem',
          value: typeof model.data.hp.deathBonus === 'string' && model.data.hp.deathBonus.trim()
            ? model.data.hp.deathBonusResolved : null,
          error: model.data.hp.deathBonusError,
          title: 'A number or a formula, e.g. con.mod or floor(level / 2)',
        })}${forwardedBadge(model, 'hp.deathBonus')}`)}
        ${field('Dead at', `<span class="value${hp.dying ? ' bad' : ''}">${minus(hp.deathAt)}</span>`)}
      </div>
      ${hpStatus(hp)}
      <div class="hpactions">
        <input type="number" value="0" data-hp-amount aria-label="Amount" min="0">
        <button data-hp="damage" class="danger">Damage</button>
        <button data-hp="nonlethal">Nonlethal</button>
        <button data-hp="heal">Heal</button>
      </div>
      <div class="hpactions">${restButtons()}</div>
      <p class="hint">Damage uses temporary hit points first. You die at
        −(${hp.hardToKill ? '2 × Con' : 'Con'} ${hp.deathBonus ? `+ ${hp.deathBonus} ` : ''}).${hp.hardToKill ? ' The doubling is from Hard to Kill at 1st mythic tier.' : ''}
        Use Death threshold + for effects such as Death's Door. End encounter, New day and New week
        each restore what lasts that long, including shorter rests, and can be undone.</p>
    </section>`;
  }
