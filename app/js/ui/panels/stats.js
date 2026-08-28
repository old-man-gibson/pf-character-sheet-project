/**
 * ui/panels/stats.js -- the Stats tab: where a score comes from.
 *
 * Every ability on the sheet is a sum with its sources spelled out -- point
 * buy, race, the level-4 increases, the prowess ladder, the optional array,
 * gear and the temporary columns -- and this is the panel that shows the sum
 * and lets each part of it be edited. The milestone pickers underneath are the
 * other half: which ability each rung of each ladder was spent on.
 *
 * `pickSelect` and `mythicPickAt` are exported because the Feats & Mythic tab
 * draws the same pickers; everything else here is local.
 */
import { esc, val, abAttr, picksAbility, ABILITY_LABELS_LIST } from '../html.js';
import { roField } from '../fields.js';
import { exprField } from '../rows.js';
import { forwardedBadge } from '../badges.js';
import {
  fmt, ABILITIES, ABILITY_LABELS, ABP_DEFENCE_CAP, ABP_DEFENCE_GROUPS, ABP_LEVELS,
  AC_BONUS_TYPES, ARRAY_LEVELS, ARRAY_MAX_SLOTS, ARRAY_SLOTS, arraySourceLevel,
  ATTUNEMENT_BONUS, ATTUNEMENT_MIN_LEVEL,
  BUILD_DERIVED_KEYS, BUILD_OPTIONAL_KEYS, BUILD_PERMANENT_GROUPS, BUILD_TEMPORARY,
  ENHANCEMENT_CAP, LEVEL4_LEVELS, MENTAL_PROWESS_LEVELS, MYTHIC_STAT_TIERS,
  PHYSICAL_PROWESS_LEVELS, PROWESS_TRACKS, SAVE_BONUS_TYPES, abpGroupTotal, abpSourceLevel,
} from '../../rules.js';


export function renderStatsPanel(model, ctx) {
  const c = model.data;
  const build = c.statsBuild;
  if (!build) {
    return '<div class="grid"><section class="panel"><h3>Stats</h3><p class="empty">This character has no Stats tab in its source sheet.</p></section></div>';
  }
  const pb = model.pointBuySummary();
  const unlocked = model.attunementUnlocked;
  const showOptional = showOptionalBuildColumns(model, build);
  const allCols = BUILD_PERMANENT_GROUPS.flatMap((g) => g.cols);
  // A group's columns, minus any retired one the player has not asked to see.
  // A group emptied that way drops out of the header entirely.
  const groups = BUILD_PERMANENT_GROUPS
    .map((g) => ({ ...g, cols: g.cols.filter(([k]) => showOptional[k] !== false) }))
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
    if (key === 'attunement') {
      // On or off, worth +2. An imported value that is neither says so
      // rather than being silently rounded away by the checkbox.
      return `<td class="mid ${banding}">
          <input type="checkbox" ${v ? 'checked' : ''} data-build="${ab}|attunement" data-kind="bool"
            aria-label="${ABILITY_LABELS[ab]} attunement"
            ${unlocked ? `title="+${ATTUNEMENT_BONUS} when attuned"`
  : `disabled title="Attunement unlocks at level ${ATTUNEMENT_MIN_LEVEL}"`}>
          ${v && v !== ATTUNEMENT_BONUS ? `<span class="hint">${fmt(v)}</span>` : ''}
        </td>`;
    }
    return `<td class="num ${banding}"><input type="number" value="${v}" data-build="${ab}|${key}"></td>`;
  };

  const over = ABILITIES.filter((a) => build[a].resolved?.enhancementWasted > 0);

  return `<div class="grid">
      <div class="statpair">
      <section class="panel">
        <h3>Permanent bonuses
          ${BUILD_OPTIONAL_KEYS.map((k) => {
          const label = allCols.find(([key]) => key === k)?.[1] || k;
          const on = showOptional[k];
          return `<button data-buildcol="${k}" aria-pressed="${on}"
              title="${on ? 'Hide' : 'Show'} the ${esc(label)} column">${on ? 'Hide' : 'Show'} ${esc(label)}</button>`;
        }).join('')}
        </h3>
        <div class="tablewrap">
          <table class="build">
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
                ${groups.map((g) => `${g.cols.map(([, label], i) => `<th class="num ${band(g, i)}">${esc(label)}</th>`).join('')}${
                g.sum ? '<th class="num grouped groupend" title="What the group actually contributes after its cap">Used</th>' : ''}`).join('')}
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
                      title="${r.enhancementWasted
  ? `${r.rawEnhancement} bought, capped at +${g.cap} — ${r.enhancementWasted} wasted`
  : `${g.cols.map(([k]) => build[ab][k] || 0).join(' + ')} = ${r[g.sum] ?? 0}`}">${r[g.sum] ?? 0}</td>` : ''}`).join('')}
                  <td class="num">${forwardedBadge(model, `${ab}.score`, '', 'permanent') || '—'}</td>
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
          <strong>ABP</strong>, <strong>Array</strong> and <strong>Level/4</strong> are
          filled in from the picks below and cannot be typed over.
          <strong>Attuned</strong> is a single +${ATTUNEMENT_BONUS}, and unlocks at
          level ${ATTUNEMENT_MIN_LEVEL}${unlocked ? '' : ' (locked)'}.
        </p>
        ${over.length ? `<p class="hint warn">
          Over the enhancement cap on ${over.map((a) => `<strong>${ABILITY_LABELS[a]}</strong>
          (${build[a].resolved.rawEnhancement} → ${ENHANCEMENT_CAP},
          ${build[a].resolved.enhancementWasted} wasted)`).join(', ')}.
        </p>` : ''}
      </section>

      <section class="panel">
        <h3>Temporary bonuses</h3>
        <div class="tablewrap">
          <table class="build">
            <thead>
              <tr class="groups"><th colspan="${BUILD_TEMPORARY.length + 5}"></th></tr>
              <tr>
                <th></th>
                ${BUILD_TEMPORARY.map(([, label]) => `<th class="num">${esc(label)}</th>`).join('')}
                <th class="num" title="Bonuses forwarded here as temporary ones — written {str.temp += 2 as size}, or {str.score += 2 as temp.size}, somewhere else on the sheet">Fwd</th>
                <th class="num" title="Everything the temporary columns add up to">Temp</th>
                <th class="num" title="Temporary score, used by every derived stat">Score</th>
                <th class="num">Mod</th>
              </tr>
            </thead>
            <tbody>
              ${ABILITIES.map((ab) => {
              const r = build[ab].resolved || {};
              const a = c.abilities[ab];
              return `<tr>
                  <th scope="row"><span class="abmark" data-ab="${ab}">${ABILITY_LABELS[ab]}</span></th>
                  ${BUILD_TEMPORARY.map(([k]) => cell(ab, k)).join('')}
                  <td class="num">${`${forwardedBadge(model, `${ab}.score`, '', 'temporary')}${
                    forwardedBadge(model, `${ab}.temp`)}` || '—'}</td>
                  <td class="num">${r.temporary || a.forwarded?.temporary || a.forwardedTemp?.total
                  ? fmt((r.temporary || 0) + (a.forwarded?.temporary || 0) + (a.forwardedTemp?.total || 0)) : '—'}</td>
                  <td class="num total">${a.tempScore ?? r.tempTotal ?? 0}</td>
                  <td class="num total">${fmt(a.totalMod)}</td>
                </tr>`;
            }).join('')}
            </tbody>
          </table>
        </div>
        <p class="hint">
          Temporary bonuses feed the Temp Score used by every derived stat;
          the permanent Total is left untouched. <strong>Fwd</strong> is what a rule
          written elsewhere on the sheet sends here — <code>{str.score += 2 as size}</code>
          for a permanent one, and either <code>{str.temp += 2 as size}</code> or
          <code>{str.score += 2 as temp.size}</code> for a temporary one — and points
          back at the sentence that sent it.
        </p>
      </section>
      </div>

      ${defenceBonusPanel(model)}
      ${/* The three ladders in a row of their own. Left to the outer grid they
            each took one 310px track, which is not enough for the array's four
            columns and more than the other two need -- so they are given the
            widths they actually want. See `.pickrow`. */''}
      <div class="pickrow span2">
        ${abpPicksPanel(model)}
        ${milestonePicksPanel(model)}
        ${arrayPicksPanel(model)}
      </div>
    </div>`;
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
 * The two milestone ladders, side by side.
 *
 * Level/4 and mythic are the same shape -- one ability at each of five
 * milestones -- and each was a narrow table with a column of empty space
 * beside it, so they share one panel. They are greyed independently: a level
 * you have not reached and a tier you have not reached are different things.
 */

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
function defenceBonusPanel(model) {
  const c = model.data;
  // The ABP columns are read off the level, and each sits beside the typed
  // bonus of the same kind: the pair sums to the cap, and a typed value past
  // the cap stands alone. The group styling says so.
  const abpOf = Object.fromEntries(ABP_DEFENCE_GROUPS);
  const typedOf = Object.fromEntries(ABP_DEFENCE_GROUPS.map(([a, t]) => [t, a]));
  const groupClass = (key) => (key === 'sheet' || abpOf[key] ? ' grouped groupstart'
    : typedOf[key] ? ' grouped groupend' : '');
  const cells = (block, resolved, errors, types, bind) => types.map(([key, , flags]) => {
    const off = flags && (flags.touch === false || flags.flatFooted === false);
    const title = off ? `title="${flags.touch === false ? 'Armour-side: touch attacks ignore it' : 'Lost when flat-footed'}"` : '';
    if (abpOf[key]) {
      return `<td class="num${groupClass(key)}" ${title}>
          ${roField(resolved?.[key] ?? 0, `From the ABP ladder at level ${c.identity.level}. With the typed bonus beside it, the pair stops at +${ABP_DEFENCE_CAP}.`)}</td>`;
    }
    const pairTitle = typedOf[key]
      ? ` Counts with the ABP bonus beside it up to +${ABP_DEFENCE_CAP} in all; past +${ABP_DEFENCE_CAP} on its own, it stands alone.` : '';
    const over = typedOf[key] && abpGroupTotal(resolved?.[typedOf[key]], resolved?.[key]) < (Number(resolved?.[typedOf[key]]) || 0) + (Number(resolved?.[key]) || 0);
    return `<td class="num${groupClass(key)}${over ? ' over' : ''}" ${title}>
        ${exprField(bind(key), block?.[key] ?? 0, {
        width: '4.4rem',
        value: resolved?.[key],
        error: errors?.[key],
        title: 'A number, or a formula — e.g. min(str.mod - dex.mod, 3 + floor(bab / 2)).' + pairTitle,
      })}</td>`;
  }).join('');

  const head = (types) => types.map(([key, label, flags]) => `<th class="num${groupClass(key)}"
      ${flags?.touch === false ? 'title="Not counted against touch attacks"'
  : flags?.flatFooted === false ? 'title="Not counted while flat-footed"' : ''}>${esc(label)}${typedOf[key] ? `<span class="capnote"> ≤ +${ABP_DEFENCE_CAP}</span>` : ''}</th>`).join('');

  return `<section class="panel span2">
      <h3>Save &amp; AC bonuses</h3>
      <div class="tablewrap"><table class="build bonusgrid">
        <thead><tr><th></th><th class="num">Total</th>${head(SAVE_BONUS_TYPES)}</tr></thead>
        <tbody>${[['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']].map(([k, label]) => {
        const s = c.saves[k];
        return `<tr>
            <th scope="row">${label}</th>
            <td class="num total" title="Base ${s.base} + ability + these">${fmt(s.total)}</td>
            ${cells(s.bonuses, s.bonusesResolved, s.bonusErrors, SAVE_BONUS_TYPES,
            (key) => `data-set="saves.${k}.bonuses.${key}"`)}
          </tr>`;
      }).join('')}</tbody>
      </table></div>
      <div class="tablewrap" style="margin-top:10px"><table class="build bonusgrid">
        <thead><tr><th></th><th class="num">Total</th>${head(AC_BONUS_TYPES)}</tr></thead>
        <tbody><tr>
          <th scope="row">AC</th>
          <td class="num total" title="Touch ${c.defenses.touch} · flat-footed ${c.defenses.flatFooted}">${c.defenses.ac}</td>
          ${cells(c.defenses.acBonuses, c.defenses.acBonusesResolved, c.defenses.acBonusErrors,
          AC_BONUS_TYPES, (key) => `data-set="defenses.acBonuses.${key}"`)}
        </tr></tbody>
      </table></div>
      <p class="hint">
        Each cell takes a number or a formula, so a conditional bonus can be written as
        the rule it is — Force Redirection's
        <code>min(str.mod - dex.mod, 3 + floor(bab / 2))</code> keeps up when BAB moves,
        where a typed-in number would not. Formulas read abilities, level, BAB and any
        name defined in prose, and show in the GM's Formula Audit.
      </p>
      <p class="hint">
        Natural-armour and enhancement bonuses do not count against <strong>touch</strong>,
        and dodge is lost while <strong>flat-footed</strong> — both follow from the column,
        so all three numbers move together. The three <strong>ABP</strong> columns follow the
        character's level along the progression's ladder and are not typed; each is paired
        with the typed bonus of the same kind (resistance, deflection, enhanced natural
        armour), and the pair adds up to at most +${ABP_DEFENCE_CAP} — unless the typed side is
        past +${ABP_DEFENCE_CAP} by itself, in which case it stands alone.
        <strong>Sheet</strong> is what the source total held beyond the columns the export
        could read; it is an ordinary field, and starts at 0 on a character built here.
      </p>
    </section>`;
}


function milestonePicksPanel(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const tier = Number(c.identity.mythicTier) || 0;
  const level4 = (l) => (c.progressionPicks?.level4 || []).find((p) => p.level === l) || {};
  const rows = Math.max(LEVEL4_LEVELS.length, MYTHIC_STAT_TIERS.length);
  return `<section class="panel">
      <h3>Level/4 &amp; mythic increases</h3>
      <div class="tablewrap"><table class="build picks">
        <thead>
          <tr class="groups">
            <th class="num grouphead" colspan="2">Level/4 <span class="capnote">+1</span></th>
            <th class="num grouphead grouped groupstart" colspan="2">Mythic <span class="capnote">+2</span></th>
          </tr>
          <tr>
            <th class="num">Lvl</th><th>Ability</th>
            <th class="num grouped groupstart">Tier</th><th class="grouped groupend">Ability</th>
          </tr>
        </thead>
        <tbody>${Array.from({ length: rows }, (_, i) => {
        // One milestone pair per row: its number, then its ability.
        const pair = (milestone, reached, control, band) => (milestone === undefined
          ? `<td class="noslot ${band}"></td><td class="noslot ${band}"></td>`
          : `<td class="num ${band} ${reached ? '' : 'future'}">${milestone}</td>
               <td class="${band} ${reached ? '' : 'future'}">${control}</td>`);
        const l = LEVEL4_LEVELS[i];
        const t = MYTHIC_STAT_TIERS[i];
        return `<tr>
            ${pair(l, l <= level, l === undefined ? ''
            : pickSelect('level4', l, 0, level4(l).ability, ABILITY_LABELS_LIST, false), '')}
            ${pair(t, t <= tier, t === undefined ? ''
            : pickSelect('mythicStat', t, 0, mythicPickAt(model, t), ABILITY_LABELS_LIST, false),
          'grouped')}
          </tr>`;
      }).join('')}</tbody>
      </table></div>
      <p class="hint">
        <strong>Level/4</strong> is +1 at every fourth level. <strong>Mythic</strong> is
        +2 at every even tier — the same increases as the ladder on
        <strong>Feats &amp; Mythic</strong>, either place edits the one set.
        Currently level ${level}, tier ${tier}; anything past that is greyed and does not
        count yet.
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
  return `<section class="panel">
      <h3>ABP — Mental &amp; Physical Prowess</h3>
      <div class="tablewrap"><table class="build picks">
        <thead><tr><th class="num">Lvl</th><th>Mental</th><th>Physical</th></tr></thead>
        <tbody>${ABP_LEVELS.map((l) => {
        const row = at(l);
        const future = l > level;
        // A track that gains nothing at this level has no slot at all, so
        // the cell is left empty rather than showing a dead control.
        // Levels that only raise an earlier pick show it, locked.
        const cell = (track, allowed) => {
          const levels = track === 'mental' ? MENTAL_PROWESS_LEVELS : PHYSICAL_PROWESS_LEVELS;
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
        rather than offering a new choice. Rows above level ${level} are greyed: they
        are planned but do not count toward the score yet.
      </p>
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
  return `<section class="panel">
      <h3>Optional array</h3>
      <p class="hint warn" style="margin-top:0">
        Bought separately, with Primordia shards — these do not come with the level.
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
      <p class="hint">+2 each — four picks at 8, three at 12 and 16. The first three
        columns are one choice raised again later; only the fourth is chosen anew each
        time.${c.progressionPicks?.arrayNote
      ? ` Sheet note: ${esc(String(c.progressionPicks.arrayNote).replace(/^Array \(Optional\)\s*/, '').replace(/\s+/g, ' '))}` : ''}</p>
    </section>`;
}
