/**
 * ui/panels/feats.js -- the Feats & Mythic tab.
 *
 * The feat groups and the feats something granted, then the mythic tier, its
 * path abilities and feats, and the mythic tradition. Every feat name cell
 * points at the one catalogue `<datalist>` drawn at the top of the tab; the
 * element fills it as a cell is typed into (`#fillDatalist`).
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, ABILITY_LABELS_LIST, nameDatalist, catalogueFace, catFoldKey } from '../html.js';
import { foldingNote } from '../talents.js';
import * as fields from '../fields.js';
import * as rows from '../rows.js';
import * as prose from '../prose.js';
import { pickSelect, mythicPickAt } from './stats.js';
import { featDetails, featCatalogue } from '../../model.js';
import { featLevel, isAhead, rowLevel } from '../../model/feats.js';
import { fromLevelField, fromLevelHead, plannedRow } from '../from-level.js';
import { campaignRules, isAntihero, mythicTierReached, trialProgress } from '../../model/campaign.js';
import {
  MYTHIC_BASE_ABILITIES, MYTHIC_PATH_HP, MYTHIC_TIER_GRANTS, MYTHIC_TRADITION_SLOTS, MYTHIC_TIERS,
  effectiveMythicTier, mythicTierGrant,
} from '../../rules.js';

/** The mythic paths a Path cell offers: the six standard ones, and every path this character has listed. */
export const MYTHIC_PATHS_LIST_ID = 'mythic-paths';

/** The one feat catalogue list, shared by every name cell on Feats & Mythic. */
export const FEAT_LIST_ID = 'cat-feats';

/**
 * A feat's Notes cell: the player's note, folding the way a talent's does, and
 * the pack's entry for the feat under it, folding with it. `at` is the row
 * (`list|i`, or a plain path for the two fixed granted feats); the pack's
 * Read all box and the fold it had before it shared the caret are kept on it.
 */
function featNote(model, ctx, binding, f, at) {
  const details = featDetails(f);
  return foldingNote(model, binding, f.note, at.includes('|') ? `${at}|note` : `${at}.note`, {
    name: f.name, below: catalogueFace(details, { ctx, key: at }), belowText: details?.text, was: catFoldKey(at),
  });
}

/**
 * Feats something hands you, rather than ones picked at a level.
 *
 * Source first, then the feat: what granted it is the fixed part and the feat
 * is the answer, which is the way round they are actually read. The Drawback
 * row appears only once a Major Drawback is taken, because until then there
 * is no feat to name; Specialty is mandatory, so it is always there. Oath and
 * Attunement feats sit in the same list, each naming its own source.
 */
function grantedFeatsSection(model, ctx) {
    const c = model.data;
    const g = c.grantedFeats || { others: [] };
    const level = Number(c.identity?.level) || 0;
    const major = c.traitSlots?.majorDrawback || {};
    const hasMajor = !!(major.name || major.category || major.text);
    // What bought the feat is the drawback's NAME -- "Spell Vulnerability
    // (Divination)" -- not what it does to you. Before traits had a name field
    // the effect was all there was to show, and it read as the source.
    const majorName = String(major.name || major.category || major.text || '').trim();
    // An antihero's feat, bought with the hero points it gave up (a campaign rule).
    const antihero = isAntihero(c);

    const fixed = (key, label, hint) => `<tr>
      ${/* No grip: these two are not in the list and cannot be moved out of
           order. The cell is here so their columns line up with the rows
           below, which can. */''}
      <td class="grip"></td>
      <td data-stack="head"><span class="fsource">${esc(label)}</span>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</td>
      <td data-stack="name">${fields.text(`grantedFeats.${key}.name`, g[key]?.name, 'Which feat?', { list: FEAT_LIST_ID })}</td>
      <td></td>
      <td class="fnote" data-label="Notes">${featNote(model, ctx, `data-set="grantedFeats.${key}.note"`, g[key] || {}, `grantedFeats.${key}`)}</td>
    </tr>`;

    return `<h4 class="subhead">Granted feats
        <span class="badge">${(hasMajor ? 2 : 1) + (antihero ? 1 : 0) + (g.others || []).length}</span>
      </h4>
      <div class="tablewrap"><table class="granted stacked${(g.others || []).length ? '' : ' notools'}">
        <thead><tr><th class="grip"></th><th class="src">Source</th><th class="fname">Feat</th>
          ${fromLevelHead()}
          <th class="fnote">Notes</th><th></th></tr></thead>
        <tbody>
          ${hasMajor ? fixed('drawback', 'Drawback', majorName.slice(0, 60)) : ''}
          ${fixed('specialty', 'Specialty')}
          ${antihero ? fixed('antihero', 'Antihero', 'In place of hero points') : ''}
          ${(g.others || []).map((f, i) => `<tr ${rows.rowDrop('grantedFeats.others', i)}${plannedRow(isAhead(rowLevel(f), level), rowLevel(f))}>
            ${rows.rowGrip()}
            <td data-stack="head">${rows.itemText('grantedFeats.others', i, 'source', f.source, 'Oath 2, Attunement…')}</td>
            <td data-stack="name">${rows.itemText('grantedFeats.others', i, 'name', f.name, 'Which feat?', { list: FEAT_LIST_ID })}</td>
            <td class="num" data-label="From lvl">${fromLevelField('grantedFeats.others', i, f)}</td>
            <td class="fnote" data-label="Notes">${featNote(model, ctx, `data-item="grantedFeats.others|${i}|note"`, f, `grantedFeats.others|${i}`)}</td>
            ${rows.rowToolsDragged('grantedFeats.others', i)}
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div style="margin-top:8px">
        ${rows.addButton('grantedFeats.others', 'Add granted feat', { source: '', name: '', note: '' })}
      </div>
      <p class="hint">
        ${hasMajor
          ? 'A Major Drawback buys the Drawback feat.'
          : 'The Drawback row appears once a Major Drawback is taken on the Overview.'}
        The Specialty feat is mandatory, so it is always here. Oath and Attunement feats
        name their own source.
        ${c.altTraining?.calc?.counts?.feat
    ? `Technique feats (${c.altTraining.calc.counts.feat} from
        <strong>${esc(c.altTraining.calc.technique)}</strong>) are listed on the
        <strong>Alternate Training</strong> tab, beside the levels that grant them. Each is
        kept in that one place, so the two lists cannot disagree.` : ''}
      </p>`;
}

/**
 * Every feat a pack carries, as a `<datalist>` the name cells point at.
 *
 * A feat is picked here rather than attached from the extension manager,
 * the way a veil is picked in its chakra: it is content, so the sheet keeps
 * the *name* and whatever the player wrote beside it, and the rules text
 * stays in the pack to be read where it stands. That is also why there is
 * no filter on this one. A veil's chakra narrows its list to a few hundred
 * and a spell's class list narrows its own, but a feat is open to anyone
 * who meets its prerequisites, and reading those is a person's job -- so
 * the honest list is the whole catalogue, typed into rather than scrolled.
 *
 * Nothing is emitted where no pack provides one, and the cell is then the
 * free-text box it has always been: a player writing down a feat nobody has
 * published is not doing anything wrong.
 */
function featDatalistHtml(model, ctx) {
    return nameDatalist(FEAT_LIST_ID, 'feats', { has: featCatalogue().feats.length > 0 });
}

/**
 * A feat group's heading: its name, how many it holds, and the × that
 * removes the whole group. The same three whether the group is the panel on
 * the right or a section stacked on the left, so the two cannot drift.
 */
function featGroupTitle(model, ctx, group, g) {
    // The level-up group is fixed slots (model/feats.js): no rename, no ×,
    // and the badge counts the slots filled rather than the rows.
    if (group.levelUp) {
      const filled = group.entries.filter((e) => String(e.name ?? '').trim()).length;
      return `<span class="grouptitle">${esc(group.name)}</span>
      <span class="badge" title="Slots filled, one per odd level">${filled} / ${group.entries.length}</span>`;
    }
    return `<input class="grouptitle" type="text" value="${esc(group.name)}"
        data-item="featGroups|${g}|name" data-kind="text" aria-label="Group name">
      <span class="badge">${group.entries.length}</span>
      ${removeGroupButton(group, g, ctx.armedRemove ?? null)}`;
}

/**
 * The group's ×. A group holding feats asks twice -- the same two-click ×
 * the spell and talent lists use -- because one click takes every feat in it;
 * an empty one goes on the first.
 */
function removeGroupButton(group, g, armedKey) {
    if (!group.entries.length) {
      return rows.removeButton('featGroups', g, { what: 'group' });
    }
    const n = group.entries.length;
    const what = `${String(group.name || '').trim() || 'this group'} and its ${n} feat${n === 1 ? '' : 's'}`;
    return rows.removeButton('featGroups', g, { what, armed: armedKey });
}

/**
 * One group's feats: the table and the button that adds a row to it.
 *
 * Three columns of writing, not two. A feat's name and where it came from
 * were all a group held, so what a feat actually *does* had nowhere to go
 * but the source cell -- and the granted feats beside it had carried a
 * proper notes column all along. This is that column, on every group, and
 * it takes formulas like the rest of the prose on the sheet: a feat that
 * grants a pool can define it where the feat is written down.
 */
function featGroupTable(model, ctx, group, g) {
    // The level-up group's rows are fixed slots: the level comes from the
    // slot, and a row can be moved among them but not added or removed.
    const fixed = group.levelUp === true;
    const list = `featGroups.${g}.entries`;
    const level = Number(model.data.identity?.level) || 0;
    // Any other feat can wait for a level (From lvl), the way a slot does.
    const ahead = (f) => isAhead(featLevel(group, f), level);
    return `<div class="tablewrap"><table class="feats stacked${fixed ? ' levelup notools' : ''}">
        <thead><tr><th class="grip"></th><th class="fname">Feat</th><th class="src">${fixed ? 'Source / level' : 'Source'}</th>
          ${fixed ? '' : `${fromLevelHead()}`}
          <th class="fnote">Notes</th><th></th></tr></thead>
        <tbody>${group.entries.map((f, i) => `<tr data-featdrop="${g}|${i}"${plannedRow(ahead(f), featLevel(group, f))}>
          <td class="grip"><span class="grip" data-featgrip title="${fixed ? 'Drag to another level' : 'Drag to reorder — or onto another group'}">&#10495;</span></td>
          <td data-stack="name">${rows.itemText(`featGroups.${g}.entries`, i, 'name', f.name, '', { list: FEAT_LIST_ID })}</td>
          <td data-label="${fixed ? 'Source / level' : 'Source'}">${fixed
    ? `<span class="dim" title="Set by the slot; move the feat to change its level">Level ${esc(f.detail)}</span>`
    : rows.itemText(list, i, 'detail', f.detail)}</td>
          ${fixed ? '' : `<td class="num" data-label="From lvl">${fromLevelField(list, i, f)}</td>`}
          <td class="fnote" data-label="Notes">${featNote(model, ctx, `data-item="${list}|${i}|note"`, f, `${list}|${i}`)}</td>
          ${/* The arrows move a feat within its group only: taking one to
               another group stays a drag, on a desktop. The granted feats
               above are the same bargain and write the same cell. */''}
          ${fixed ? rows.rowToolsMoveOnly(list, i) : rows.rowToolsDragged(list, i)}
        </tr>`).join('')}
        ${group.entries.length ? '' : `<tr class="featempty" data-featdrop="${g}|0">
          <td colspan="${fixed ? 5 : 6}" class="empty">No feats here yet — add one, or drag one in.</td>
        </tr>`}</tbody>
      </table></div>
      ${fixed ? '' : `<div style="margin-top:8px">
        ${rows.addButton(list, 'Add feat', { name: '', detail: '', note: '' })}
      </div>`}`;
}

export function renderFeaturesPanel(model, ctx) {
    const c = model.data;
    const feats = c.feats || {};
    const m = c.mythic || {};
    const tier = Number(c.identity.mythicTier) || 0;
    const rules = campaignRules(c);
    const awarded = rules.mythicTier === 'awarded';
    // What each tier is reached at: a level, or trials in all (a campaign rule).
    const reached = (t) => mythicTierReached(c, t);
    const reachedHead = reached(1).head;
    // Trials completed, when the tier comes from them (a campaign rule).
    const trials = trialProgress(c);
    const auto = trials ? `from trials: ${trials.tier}` : `auto: ${m.computedTier ?? 0}`;
    /*
     * The feats stack, each panel the width of the page.
     *
     * They used to read as two columns -- the granted feats and the smaller
     * groups on the left, the level-up list beside them -- which balanced the
     * row while a feat was a name and a source. It stopped balancing once
     * every row grew a notes column: half a page is not enough width for
     * three columns of writing, and the level-up list is the one a character
     * actually fills. So the first group stands on its own, full width, and
     * the rest stack under the granted feats as they always did.
     */
    const groups = c.featGroups || [];
    const featured = groups[0]
      ? rows.collapsible(model, 'featgroup-0', `<section class="panel span2 featgroup">
          <h3>${featGroupTitle(model, ctx, groups[0], 0)}</h3>
          ${featGroupTable(model, ctx, groups[0], 0)}
        </section>`)
      : '';
    const main = rows.collapsible(model, 'feats', `<section class="panel span2 featmain">
      <h3>Feats</h3>
      ${grantedFeatsSection(model, ctx)}
      ${groups.slice(1).map((group, i) => `<div class="featsection">
        <h4 class="subhead">${featGroupTitle(model, ctx, group, i + 1)}</h4>
        ${featGroupTable(model, ctx, group, i + 1)}
      </div>`).join('')}
    </section>`);

    /*
     * The catalogue sits at the tab, not inside a panel.
     *
     * Every feat cell on this tab points at it -- the groups, the granted
     * rows, and the mythic abilities in the panel below -- and a `<datalist>`
     * inside a folded panel is a `<datalist>` that is not in the document.
     * Fold the Feats panel and the mythic cells would quietly stop offering
     * anything.
     */
    return `<div class="grid">
      ${featDatalistHtml(model, ctx)}
      ${featured}${main}
      <div class="addgroup">
        ${rows.addButton('featGroups', 'Add group', { name: 'New group', entries: [] })}
        <span class="hint">Groups mirror the columns on the sheet's Feats tab: Level Up,
          Oaths, Attunement, Class, and so on. The first group stands on its own. The rest
          stack under the granted feats. Drag a feat by its grip to reorder it, or drop it on
          another group to move it there. Level Up has one slot per odd level, 1 to 19. Its
          feats move between levels but cannot be added, removed or dragged out.</span>
      </div>

      ${rules.mythic ? '' : `<section class="panel span2 mythicoff">
        <h3>Mythic <span class="badge">off</span></h3>
        <p class="hint">Mythic is off for this character in its campaign rules, so the tier is 0
          and nothing mythic counts. What was written here is kept, and comes back when mythic
          is turned on again.
          <button data-view data-action="campaign-rules">Campaign rules…</button></p>
      </section>`}
      ${rules.mythic ? `${rows.collapsible(model, 'mythic', `<section class="panel span2">
        <h3>Mythic <span class="badge">tier ${tier}</span></h3>
        <div class="fieldgrid">
          ${fields.field('Path', fields.text('mythic.path', m.path))}
          ${fields.field(awarded ? 'Tier (awarded by the GM)' : `Tier (${esc(auto)})`, `<span class="pair">
            ${fields.autoNum('data-set="mythic.tierOverride"', m.tierOverride, {
    placeholder: m.computedTier ?? 0, width: '3.6rem', auto: !awarded, label: 'Mythic tier',
    title: awarded
      ? 'The tier the GM has awarded (for trials, say). Blank is 0. The campaign rules on the ⚙ tab set where the tier comes from.'
      : trials ? 'The tier the trials have been taken to with Tier up; enter a number to override.'
        : 'Automatic from level; enter a number to override.',
  })}
            <span class="value">→ ${esc(c.identity.mythicTier ?? 0)}</span></span>`)}
          ${trials ? fields.field('Trials completed', `<span class="pair">
            <input type="number" min="0" value="${esc(trials.have)}" data-set="mythic.trials" data-kind="number"
              aria-label="Trials completed" style="width:4.2rem">
            <span class="hint">${trials.next === null ? `tier ${trials.tier}, the last`
    : trials.ready ? `tier ${trials.next} is earned`
      : `${trials.toward} of ${trials.need} for tier ${trials.next}, ${trials.short} to go`}</span>
            ${trials.ready ? `<button class="levelup" data-action="tier-up" title="Take tier ${trials.next}: one step, undone like a play action">Tier up to ${trials.next}</button>` : ''}</span>`) : ''}
          ${fields.field(`Bonus HP / tier (path: ${MYTHIC_PATH_HP[String(m.path || '').trim()] ?? '—'})`,
    fields.autoNum('data-set="mythic.bonusHpPerTier"', m.bonusHpPerTier, {
      placeholder: MYTHIC_PATH_HP[String(m.path || '').trim()] ?? 0, width: '3.6rem', auto: true,
      title: 'From the path; enter a number to override it.', label: 'Bonus hit points per mythic tier',
    }))}
          ${fields.field('Base path ability', fields.text('mythic.basePathAbility', m.basePathAbility))}
          ${fields.field('Mythic Paragon', `<label class="chk">
            <input type="checkbox" ${m.paragon ? 'checked' : ''} data-set="mythic.paragon" data-kind="bool">
            <span>Tier reads +2 for effects${m.paragon && tier ? ` → ${effectiveMythicTier(c)}` : ''}</span></label>`)}
        </div>
        ${mythicPathsDatalist()}
        <p class="hint">
          Tier comes from character level: 8→1, 10→2, 12→3, 14→4, then one per level to
          20→10. Bonus HP/tier is ${(Number(model.mythicHp) || 0) / (c.identity.mythicTier || 1)}
          × ${esc(c.identity.mythicTier ?? 0)} = <strong>${model.mythicHp}</strong> hit points. That is
          counted into the maximum on the Hit points panel. Path values: Champion/Guardian 5,
          Marshal/Trickster 4, Archmage/Hierophant 3. Mythic Paragon makes every ability, feat
          and spell that depends on the tier read it 2 higher: <code>mythic.tier</code> in a
          formula, Amazing Initiative, the power uses and the surge die. The rows reached, the
          picks and the feat slots still go by the tier itself (<code>mythic.baseTier</code>).
        </p>
        ${rows.collapsibleSub(model, 'mythic-paths', `Additional paths${(m.paths || []).length ? ` <span class="badge">${m.paths.length}</span>` : ''}`, `
          <div class="tablewrap"><table class="mythic stacked">
            <thead><tr>
              <th>Path</th>
              <th title="The path's 1st-tier base ability, gained with the path">Base path ability</th>
              <th title="What grants the path: the Dual Path ability or feat, a GM's ruling">Granted by</th>
              <th class="noslot"></th>
            </tr></thead>
            <tbody>${(m.paths || []).map((p, i) => `<tr data-rowkey="mythpaths">
              <td data-stack="name">${rows.itemText('mythic.paths', i, 'path', p.path, 'Which path?', { list: MYTHIC_PATHS_LIST_ID })}</td>
              <td data-label="Base path ability">${rows.itemText('mythic.paths', i, 'basePathAbility', p.basePathAbility, '', true)}</td>
              <td data-label="Granted by">${rows.itemText('mythic.paths', i, 'grantedBy', p.grantedBy, 'Dual Path', true)}</td>
              <td class="acts">${rows.removeButton('mythic.paths', i)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          ${rows.addButton('mythic.paths', 'Add path', { path: '', basePathAbility: '', grantedBy: 'Dual Path' })}
          <p class="hint">A second or later path, from Dual Path or anything else that grants one.
            Bonus HP per tier follows the first path above. Each path ability row below says
            which path it came from; the Path cell offers every path listed here.</p>`, 'mythpaths')}
        ${rows.collapsibleSub(model, 'mythic-abilities', 'Mythic path abilities', `
          <div class="tablewrap"><table class="mythic stacked">
            <!-- Six columns and one of them prose. The tier, the level it is
                 reached at, the path and the ability's name are all a few words,
                 so they are held narrow and Effect takes what is left. -->
            <colgroup>
              <col class="tier"><col class="lvl"><col class="mpath"><col class="mname">
              <col class="meffect"><col class="mstat">
            </colgroup>
            <thead><tr>
              <th class="num">Tier</th>
              <th class="num" title="${esc(reachedHead === 'Trials' ? 'The trials completed in all when this tier is reached' : 'The character level this tier is reached at')}">${reachedHead}</th>
              <th>Path</th>
              <th>Ability</th>
              <th title="What the path ability does. Formulas work here.">Effect</th>
              <th title="+2 to one ability, at every even tier">Stat</th>
            </tr></thead>
            <tbody>${MYTHIC_TIERS.map((t) => {
              const a = (m.abilities || [])[t - 1] || {};
              const i = t - 1;
              return `<tr class="${t > tier ? 'future' : ''}" data-rowkey="mythladder">
                <td class="num" data-stack="head" data-headlabel="Tier">${t}</td>
                <td class="num derived" data-label="${reachedHead}" title="${esc(reached(t).title)}">${esc(reached(t).value)}</td>
                <td data-label="Path">${rows.itemText('mythic.abilities', i, 'path', a.path, '', { title: true, list: MYTHIC_PATHS_LIST_ID })}</td>
                <td data-stack="name">${rows.itemText('mythic.abilities', i, 'name', a.name, '', { title: true, list: FEAT_LIST_ID })}</td>
                <td data-label="Effect">${foldingNote(model, `data-item="mythic.abilities|${i}|effect" placeholder="What it does"`, a.effect, `mythic.abilities|${i}|effect`, { name: a.name })}</td>
                ${t % 2 === 0
                  ? `<td data-label="Stat">${pickSelect('mythicStat', t, 0, mythicPickAt(model, t), ABILITY_LABELS_LIST, false)}</td>`
                  : '<td class="noslot"></td>'}
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="hint">
            Ten tiers, one row each, beside the character level it is reached at. A
            <strong>+2 ability increase</strong> comes at every even tier, so only
            those rows offer a Stat. The same increases are on the
            <strong>Stats</strong> tab. Either place edits the one set. Rows above
            tier ${tier} are greyed. They are planned, not counted yet.
          </p>`, 'mythladder')}

        ${rows.collapsibleSub(model, 'mythic-feats', 'Mythic Feats', `
          <div class="tablewrap"><table class="mythic stacked">
            <!-- The slot, then what was taken for it, then what that does. Off
                 the ladder above so both halves have room: nine columns across
                 one table left the two Effects sharing a third of the width. -->
            <colgroup>
              <col class="tier"><col class="lvl"><col class="grants"><col class="mname">
              <col class="meffect">
            </colgroup>
            <thead><tr>
              <th class="num">Tier</th>
              <th class="num" title="${esc(reachedHead === 'Trials' ? 'The trials completed in all when this tier is reached' : 'The character level this tier is reached at')}">${reachedHead}</th>
              <th title="What the tier hands over — a feat on odd tiers, an RP power on even ones">Grants</th>
              <th>Name</th>
              <th title="What the granted feat does. Formulas work here.">Effect</th>
            </tr></thead>
            <tbody>${MYTHIC_TIERS.map((t) => {
              const a = (m.abilities || [])[t - 1] || {};
              const i = t - 1;
              return `<tr class="${t > tier ? 'future' : ''}" data-rowkey="mythfeats">
                <td class="num" data-stack="head" data-headlabel="Tier">${t}</td>
                <td class="num derived" data-label="${reachedHead}" title="${esc(reached(t).title)}">${esc(reached(t).value)}</td>
                <td data-label="Grants"><span class="fsource">${esc(a.feat || mythicTierGrant(t))}</span></td>
                <td data-stack="name">${rows.itemText('mythic.abilities', i, 'featChoice', a.featChoice, '', true)}</td>
                <td data-label="Effect">${foldingNote(model, `data-item="mythic.abilities|${i}|featEffect" placeholder="What it does"`, a.featEffect, `mythic.abilities|${i}|featEffect`, { name: a.featChoice })}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="hint">
            Odd tiers grant a mythic feat. Even tiers grant an RP power.
            <strong>Grants</strong> is what the tier hands over. <strong>Name</strong> is
            what you took for it. <strong>Effect</strong> says what that does. A long effect
            starts folded to one line, like a talent's note; its ▸ opens it, and the
            sheet remembers which you left open. Formulas work here and in the path abilities
            above. Write “{= tier * 2}” for a value, or “{fort += 2}” to send a bonus
            somewhere. A bonus written above tier ${tier} does not apply until that tier
            is reached.
          </p>`, 'mythladder')}
      </section>`)}

      <div class="band lead">
        ${rows.collapsible(model, 'mythic-tradition', mythicTraditionPanel(model, ctx, m))}
        ${rows.collapsible(model, 'mythic-base', mythicTierGrantsPanel(model, tier))}
      </div>` : ''}
    </div>`;
}

/**
 * The base mythic abilities tier by tier, as a side panel.
 *
 * One line a tier: the level it is reached at and a chip per ability, the
 * chip carrying the ability's value at that tier (1d8, 11/day, +4 initiative)
 * and its rule as a tooltip. Tiers past the character's are greyed, the way
 * the ladder tables grey them. What the character has now is summed up in
 * one line at the top, and the rules are written out in a fold under the
 * table for reading without hovering.
 */
function mythicTierGrantsPanel(model, tier) {
    // The numbers the character has now read the tier as effects do (Mythic
    // Paragon's +2 included); the rows are by the tier reached.
    const eff = effectiveMythicTier(model.data);
    const reached = (t) => mythicTierReached(model.data, t);
    const reachedHead = reached(1).head;
    // The rule opens in the sheet's popover on hover (data-tip); the title
    // is the fallback for a browser without one.
    const chip = (name, t) => {
      const a = MYTHIC_BASE_ABILITIES[name] || {};
      const value = a.value ? ` ${a.value(t)}` : '';
      return `<span class="badge" tabindex="0" data-tip="${esc(a.text || '')}" data-tiphead="${esc(name)}" title="${esc(a.text || '')}">${esc(name)}${esc(value)}</span>`;
    };
    const row = (t) => `<tr class="${t > tier ? 'future' : ''}">
      <td class="num">${t}</td>
      <td class="num derived" title="${esc(reached(t).title)}">${esc(reached(t).value)}</td>
      <td>${(MYTHIC_TIER_GRANTS[t] || []).map((name) => chip(name, t)).join(' ')}</td>
    </tr>`;
    const now = tier >= 1 ? [
      eff !== tier ? `Reads as tier ${eff} (Mythic Paragon)` : '',
      `Mythic power ${MYTHIC_BASE_ABILITIES['Mythic Power'].value(eff)}`,
      `Surge ${MYTHIC_BASE_ABILITIES.Surge.value(eff)}`,
      tier >= 2 ? `Initiative ${MYTHIC_BASE_ABILITIES['Amazing Initiative'].value(eff).replace(' initiative', '')}` : '',
      'Death at −(2 × Con)',
    ].filter(Boolean).join(' · ') : 'No mythic tier yet.';
    const names = [...new Set(Object.values(MYTHIC_TIER_GRANTS).flat())];
    return `<section class="panel mythgrants">
      <h3>What each tier grants <span class="badge">tier ${tier}</span></h3>
      <p class="mythnow">${esc(now)}</p>
      <table class="mythtiers">
        <thead><tr><th class="num">Tier</th><th class="num" title="${esc(reachedHead === 'Trials' ? 'The trials completed in all when this tier is reached' : 'The character level this tier is reached at')}">${reachedHead === 'Trials' ? 'Trials' : 'Lvl'}</th><th>Base abilities gained or improved</th></tr></thead>
        <tbody>${MYTHIC_TIERS.map(row).join('')}</tbody>
      </table>
      ${rows.collapsibleSub(model, 'mythic-base-text', 'The rules, in brief', `
        <dl class="mythtext">${names.map((name) => `<dt>${esc(name)}</dt><dd>${esc(MYTHIC_BASE_ABILITIES[name]?.text || '')}</dd>`).join('')}</dl>`, 'mythbase')}
      <p class="hint">Hover a name for its rule. Amazing Initiative is counted into Initiative
        from tier 2, Hard to Kill into the death threshold, and Mythic Power is the tracker
        of that name. The rest are applied at the table.</p>
    </section>`;
  }

/** The datalist behind every Path cell: the six standard paths, then this character's own. */
function mythicPathsDatalist() {
    return `<datalist id="${MYTHIC_PATHS_LIST_ID}">${Object.keys(MYTHIC_PATH_HP)
      .map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>`;
  }

function mythicTraditionPanel(model, ctx, m) {
    const tr = m.tradition || {};
    const filled = (k) => !!(tr[k] && String(tr[k]).trim());
    return `<section class="panel wide">
      <h3>Mythic tradition
        ${!filled('drawback1') ? '<span class="badge err">Drawback 1 is mandatory</span>' : ''}
        <label class="chk" style="margin-left:auto">
          <input type="checkbox" ${m.flowingPower ? 'checked' : ''} data-set="mythic.flowingPower" data-kind="bool">
          <span title="Its controls are on the Overview, with the buffs: the increase, the round's damage and the free rounds">Flowing Power</span></label>
      </h3>
      <div class="tablewrap"><table class="tradition stacked">
        <thead><tr><th class="slot">Slot</th><th class="choice">Choice</th><th>Notes</th></tr></thead>
        <tbody>${MYTHIC_TRADITION_SLOTS.map((def) => {
          const locked = def.requires && !filled(def.requires);
          return `<tr class="${locked ? 'lockedslot' : ''}">
            <td data-stack="head">${esc(def.label)}${def.mandatory ? ' <span class="badge err">required</span>' : ''}
              ${def.requires ? `<div class="hint">needs ${esc(MYTHIC_TRADITION_SLOTS.find((s) => s.key === def.requires)?.label)}</div>` : ''}
              ${def.kind === 'quality' ? '<div class="hint">bonus + drawback</div>' : ''}</td>
            <td data-stack="name">${prose.prose(model, `data-set="mythic.tradition.${def.key}" placeholder="${esc(locked ? `Take ${MYTHIC_TRADITION_SLOTS.find((s) => s.key === def.requires)?.label} first` : '')}"`, tr[def.key], 1, 'grow')}</td>
            <td data-label="Notes">${foldingNote(model, `data-set="mythic.tradition.notes.${def.key}" placeholder="${esc(locked ? '' : 'What it does')}"`, tr.notes?.[def.key],
    `mythic.tradition.notes.${def.key}`, { name: tr[def.key] })}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">
        One mandatory drawback unlocks one boon. Each further drawback, up to two,
        unlocks another. The quality carries both a bonus and a drawback. The name and
        the note both resolve <code>{name = expr}</code>, so a boon that grants a pool
        can define it where it is written down.
      </p>
    </section>`;
}
