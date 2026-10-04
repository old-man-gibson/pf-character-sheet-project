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
import { esc, ABILITY_LABELS_LIST, nameDatalist, noteCell } from '../html.js';
import * as fields from '../fields.js';
import * as rows from '../rows.js';
import * as prose from '../prose.js';
import { pickSelect, mythicPickAt } from './stats.js';
import { featDetails, featCatalogue } from '../../model.js';
import {
  MYTHIC_PATH_HP, MYTHIC_TRADITION_SLOTS, MYTHIC_TIERS, MYTHIC_TIER_LEVEL, mythicTierGrant,
} from '../../rules.js';

/** The one feat catalogue list, shared by every name cell on Feats & Mythic. */
export const FEAT_LIST_ID = 'cat-feats';

/** What the player has folded away, as `noteCell` and friends want it. */
const foldsOf = (model) => model.data.uiPrefs?.collapsed || {};

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
    const major = c.traitSlots?.majorDrawback || {};
    const hasMajor = !!(major.name || major.category || major.text);
    // What bought the feat is the drawback's NAME -- "Spell Vulnerability
    // (Divination)" -- not what it does to you. Before traits had a name field
    // the effect was all there was to show, and it read as the source.
    const majorName = String(major.name || major.category || major.text || '').trim();

    const fixed = (key, label, hint) => `<tr>
      ${/* No grip: these two are not in the list and cannot be moved out of
           order. The cell is here so their columns line up with the rows
           below, which can. */''}
      <td class="grip"></td>
      <td data-stack="head"><span class="fsource">${esc(label)}</span>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</td>
      <td data-stack="name">${fields.text(`grantedFeats.${key}.name`, g[key]?.name, 'Which feat?', { list: FEAT_LIST_ID })}</td>
      <td class="fnote" data-label="Notes">${noteCell(
    prose.prose(model, `data-set="grantedFeats.${key}.note"`, g[key]?.note, 1, 'grow'),
    featDetails(g[key] || {}), foldsOf(model), `grantedFeats.${key}`,
  )}</td>
    </tr>`;

    return `<h4 class="subhead">Granted feats
        <span class="badge">${(hasMajor ? 2 : 1) + (g.others || []).length}</span>
      </h4>
      <div class="tablewrap"><table class="granted stacked">
        <thead><tr><th class="grip"></th><th class="src">Source</th><th class="fname">Feat</th>
          <th class="fnote">Notes</th><th></th></tr></thead>
        <tbody>
          ${hasMajor ? fixed('drawback', 'Drawback', majorName.slice(0, 60)) : ''}
          ${fixed('specialty', 'Specialty')}
          ${(g.others || []).map((f, i) => `<tr ${rows.rowDrop('grantedFeats.others', i)}>
            ${rows.rowGrip()}
            <td data-stack="head">${rows.itemText('grantedFeats.others', i, 'source', f.source, 'Oath 2, Attunement…')}</td>
            <td data-stack="name">${rows.itemText('grantedFeats.others', i, 'name', f.name, 'Which feat?', { list: FEAT_LIST_ID })}</td>
            <td class="fnote" data-label="Notes">${noteCell(
    prose.prose(model, `data-item="grantedFeats.others|${i}|note"`, f.note, 1, 'grow'),
    featDetails(f), foldsOf(model), `grantedFeats.others|${i}`,
  )}</td>
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
        <strong>${esc(c.altTraining.calc.technique)}</strong>) live on the
        <strong>Alternate Training</strong> tab, beside the levels that grant them — one home
        each, so they cannot drift apart.` : ''}
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
      <button class="danger" data-remove="featGroups|${g}" title="Remove group">×</button>`;
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
    const folds = foldsOf(model);
    // The level-up group's rows are fixed slots: the level comes from the
    // slot, and a row can be moved among them but not added or removed.
    const fixed = group.levelUp === true;
    const list = `featGroups.${g}.entries`;
    return `<div class="tablewrap"><table class="feats stacked">
        <thead><tr><th class="grip"></th><th class="fname">Feat</th><th class="src">Source / level</th>
          <th class="fnote">Notes</th><th></th></tr></thead>
        <tbody>${group.entries.map((f, i) => `<tr data-featdrop="${g}|${i}">
          <td class="grip"><span class="grip" data-featgrip title="${fixed ? 'Drag to another level' : 'Drag to reorder — or onto another group'}">&#10495;</span></td>
          <td data-stack="name">${rows.itemText(`featGroups.${g}.entries`, i, 'name', f.name, '', { list: FEAT_LIST_ID })}</td>
          <td data-label="Source / level">${fixed
    ? `<span class="dim" title="Set by the slot; move the feat to change its level">Level ${esc(f.detail)}</span>`
    : rows.itemText(list, i, 'detail', f.detail)}</td>
          <td class="fnote" data-label="Notes">${noteCell(
    prose.prose(model, `data-item="featGroups.${g}.entries|${i}|note"`, f.note, 1, 'grow'),
    featDetails(f), folds, `featGroups.${g}.entries|${i}`,
  )}</td>
          ${/* The arrows move a feat within its group only: taking one to
               another group stays a drag, on a desktop. The granted feats
               above are the same bargain and write the same cell. */''}
          ${fixed ? rows.rowToolsMoveOnly(list, i) : rows.rowToolsDragged(list, i)}
        </tr>`).join('')}
        ${group.entries.length ? '' : `<tr class="featempty" data-featdrop="${g}|0">
          <td colspan="5" class="empty">No feats here yet — add one, or drag one in.</td>
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
        <span class="hint">Groups mirror the columns on the sheet's Feats tab — Level Up,
          Oaths, Attunement, Class, and so on. The first group stands on its own; the rest
          stack under the granted feats. Drag a feat by its grip to reorder it, or onto
          another group to move it there. Level Up is one slot per odd level, 1 to 19: its
          feats move between levels but are not added, removed or dragged out.</span>
      </div>

      ${rows.collapsible(model, 'mythic', `<section class="panel span2">
        <h3>Mythic <span class="badge">tier ${tier}</span></h3>
        <div class="fieldgrid">
          ${fields.field('Path', fields.text('mythic.path', m.path))}
          ${fields.field(`Tier (auto: ${esc(m.computedTier ?? 0)})`, `<span class="pair">
            <input type="number" value="${esc(m.tierOverride ?? '')}" placeholder="${esc(m.computedTier ?? 0)}"
              data-set="mythic.tierOverride" data-kind="number-or-null" style="width:3.6rem"
              title="Automatic from level; enter a number to override.">
            <span class="value">→ ${esc(c.identity.mythicTier ?? 0)}</span></span>`)}
          ${fields.field(`Bonus HP / tier (path: ${MYTHIC_PATH_HP[String(m.path || '').trim()] ?? '—'})`,
    `<input type="number" class="autonum${m.bonusHpPerTier == null ? ' auto' : ''}"
            value="${esc(m.bonusHpPerTier ?? '')}" placeholder="${MYTHIC_PATH_HP[String(m.path || '').trim()] ?? 0}"
            data-set="mythic.bonusHpPerTier" data-kind="number-or-null" style="width:3.6rem"
            title="From the path; enter a number to override it."
            aria-label="Bonus hit points per mythic tier">`)}
          ${fields.field('Base path ability', fields.text('mythic.basePathAbility', m.basePathAbility))}
        </div>
        <p class="hint">
          Tier comes from character level (8→1, 10→2, 12→3, 14→4, then one per level to
          20→10). Bonus HP/tier is ${(Number(model.mythicHp) || 0) / (c.identity.mythicTier || 1)}
          × ${esc(c.identity.mythicTier ?? 0)} = <strong>${model.mythicHp}</strong> hit points, counted
          into the maximum on the Hit points panel (Champion/Guardian 5, Marshal/Trickster 4,
          Archmage/Hierophant 3).
        </p>
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
              <th class="num" title="The character level this tier is reached at">Level</th>
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
                <td class="num derived" data-label="Level" title="Tier ${t} at level ${MYTHIC_TIER_LEVEL[t]}">${MYTHIC_TIER_LEVEL[t] ?? ''}</td>
                <td data-label="Path">${rows.itemText('mythic.abilities', i, 'path', a.path, '', true)}</td>
                <td data-stack="name">${rows.itemText('mythic.abilities', i, 'name', a.name, '', { title: true, list: FEAT_LIST_ID })}</td>
                <td data-label="Effect">${prose.foldedProse(model, { openCell: ctx.openCell }, `mythic:${i}:effect`, `data-item="mythic.abilities|${i}|effect"`, a.effect, 'What it does')}</td>
                ${t % 2 === 0
                  ? `<td data-label="Stat">${pickSelect('mythicStat', t, 0, mythicPickAt(model, t), ABILITY_LABELS_LIST, false)}</td>`
                  : '<td class="noslot"></td>'}
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="hint">
            Ten tiers, one row each, beside the character level it is reached at. A
            <strong>+2 ability increase</strong> comes at every even tier, which is why
            only those rows offer a Stat; the same increases are on the
            <strong>Stats</strong> tab, and either place edits the one set. Rows above
            tier ${tier} are greyed: planned, not counted yet.
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
              <th class="num" title="The character level this tier is reached at">Level</th>
              <th title="What the tier hands over — a feat on odd tiers, an RP power on even ones">Grants</th>
              <th>Name</th>
              <th title="What the granted feat does. Formulas work here.">Effect</th>
            </tr></thead>
            <tbody>${MYTHIC_TIERS.map((t) => {
              const a = (m.abilities || [])[t - 1] || {};
              const i = t - 1;
              return `<tr class="${t > tier ? 'future' : ''}" data-rowkey="mythfeats">
                <td class="num" data-stack="head" data-headlabel="Tier">${t}</td>
                <td class="num derived" data-label="Level" title="Tier ${t} at level ${MYTHIC_TIER_LEVEL[t]}">${MYTHIC_TIER_LEVEL[t] ?? ''}</td>
                <td data-label="Grants"><span class="fsource">${esc(a.feat || mythicTierGrant(t))}</span></td>
                <td data-stack="name">${rows.itemText('mythic.abilities', i, 'featChoice', a.featChoice, '', true)}</td>
                <td data-label="Effect">${prose.foldedProse(model, { openCell: ctx.openCell }, `mythic:${i}:featEffect`, `data-item="mythic.abilities|${i}|featEffect"`, a.featEffect, 'What it does')}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <p class="hint">
            A mythic feat on the odd tiers, an RP power on the even ones:
            <strong>Grants</strong> is what the tier hands over, <strong>Name</strong> is
            what you took for it, and <strong>Effect</strong> says what that thing does —
            folded to one line to keep the table readable, so click one to open it and
            click away to shut it again. Formulas work here and in the path abilities
            above: write “{= tier * 2}” for a value, or “{fort += 2}” to send a bonus
            somewhere. A bonus written above tier ${tier} does not apply until it is
            reached.
          </p>`, 'mythladder')}
      </section>`)}

      ${rows.collapsible(model, 'mythic-tradition', mythicTraditionPanel(model, ctx, m))}
    </div>`;
}

function mythicTraditionPanel(model, ctx, m) {
    const tr = m.tradition || {};
    const filled = (k) => !!(tr[k] && String(tr[k]).trim());
    return `<section class="panel span2">
      <h3>Mythic tradition
        ${!filled('drawback1') ? '<span class="badge err">Drawback 1 is mandatory</span>' : ''}
        <label class="chk" style="margin-left:auto">
          <input type="checkbox" ${m.flowingPower ? 'checked' : ''} data-set="mythic.flowingPower" data-kind="bool">
          <span>Flowing Power</span></label>
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
            <td data-label="Notes">${prose.prose(model, `data-set="mythic.tradition.notes.${def.key}" placeholder="${esc(locked ? '' : 'What it does')}"`, tr.notes?.[def.key], 1, 'grow')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="hint">
        One mandatory drawback unlocks one boon; each further drawback (up to two)
        unlocks another. The quality carries both a bonus and a drawback. The name and
        the note both resolve <code>{name = expr}</code>, so a boon that grants a pool
        can define it where it is written down.
      </p>
    </section>`;
}
