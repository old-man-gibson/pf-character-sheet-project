/**
 * ui/panels/lore.js -- the Progression tab, the Background tab, and the leftovers.
 *
 * Progression is the Classes table and the level plan: what each level of each
 * class gave, with the repeat features in a column each and the option menus a
 * pack supplies. Background (tab id `lore`) is the race traits, traits and
 * drawbacks, specialty, languages and the story sections. The leftovers are the tabs a
 * particular workbook had that the app has no model for -- kept as a grid so
 * nothing is lost in the import even where nothing can be computed from it.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import { classActionsPanel } from '../class-actions.js';
import { prose, renderedProse } from '../prose.js';
import { systemExtrasPanel } from './subsystems.js';
import { itemArea } from '../prose.js';
import {
  addButton, collapsible, exprField, foldButton, grip, gridCell, isCollapsed, isOpen, itemCheck, itemNum, itemSelect,
  itemText, removeAction, removeButton, rowRemove, rowTools,
} from '../rows.js';
import { linkField } from '../fields.js';
import { same } from '../format.js';
import {
  alignedGainRows, alignedRule, blankClassRow, columnLetter, optionCatalogue, optionCatalogues, plannedLevels, systemTabWidth,
} from '../../model.js';
import {
  GAME_SYSTEMS, TRAIT_CATEGORIES, TRAIT_SLOTS, parseLevelRule, levelRuleLevels, summariseLevels,
} from '../../rules.js';
import { hasTokens } from '../../inline.js';
import { rgba } from '../../tracker-style.js';
import { logDay, logLinesHtml } from '../play-log.js';
import { VMC_LEVELS, campaignRules, specialtyInPlay } from '../../model/campaign.js';
import { runtime as extensionRuntime } from '../../extension-runtime.js';
import {
  groupLevels, ownPackages, packageBlocks, packageCheck, packageId, packageProblems, sameClass, swapsOn,
} from '../../packages.js';
import { archetypeChanges, archetypeMarks } from '../../extensions.js';
import { hasLink, linkedText } from '../links.js';
import { foldingNote } from '../talents.js';
import { autoNum, field, select, text } from '../fields.js';


/**
 * Variant multiclassing (a campaign rule): the secondary class, and the
 * feature it grants at 3rd, 7th, 11th, 15th and 19th level in place of a
 * feat. Each feature's notes take formulas and count from its level.
 */
function vmcPanel(model) {
  const c = model.data;
  if (!campaignRules(c).vmc) return '';
  const v = c.vmc || {};
  const cls = String(v.class ?? '').trim();
  const level = Number(c.identity?.level) || 0;
  const taken = cls && (c.classes || []).some((x) => String(x.name || '').trim().toLowerCase() === cls.toLowerCase());
  return collapsible(model, 'vmc', `<section class="panel span2 vmcpanel">
      <h3>Variant multiclassing${cls ? ` <span class="badge">${esc(cls)}</span>` : ''}</h3>
      <div class="fieldgrid">${field('Secondary class', text('vmc.class', cls, 'Fighter'))}</div>
      ${taken ? `<p class="hint warn">${esc(cls)} is also one of this character's classes.</p>` : ''}
      <div class="tablewrap"><table class="vmc stacked">
        <colgroup><col class="lvl"><col class="vname"><col></colgroup>
        <thead><tr><th class="num">Level</th><th>Feature</th><th>Notes</th></tr></thead>
        <tbody>${VMC_LEVELS.map((at) => {
    const f = v.features?.[at] || {};
    return `<tr class="${at > level ? 'future' : ''}">
            <td class="num" data-stack="head">${at}</td>
            <td data-stack="name">${text(`vmc.features.${at}.name`, f.name, 'Feature')}</td>
            <td data-label="Notes">${foldingNote(model, `data-set="vmc.features.${at}.note"`, f.note, `vmc.features.${at}.note`, { name: f.name })}</td>
          </tr>`;
  }).join('')}</tbody>
      </table></div>
      <p class="hint">These replace the feats at 3rd, 7th, 11th, 15th and 19th.</p>
    </section>`);
}

/**
 * Archetype packages (a campaign rule): per class, the swaps made -- the
 * package given up, the one taken, × to undo -- and a row to make another.
 * The packages are the enabled packs' `package` blocks; the swap is an
 * archetype (packages.js), so its pill is on the Overview's class row too.
 */
function packagePanel(model, ctx) {
  const c = model.data;
  if (!campaignRules(c).archetypePackages) return '';
  const blocks = extensionRuntime.blocks();
  const all = packageBlocks(blocks);
  const rows = (c.classes || []).map((row, i) => ({ row, i })).filter(({ row }) => String(row?.name ?? '').trim());
  const draft = ctx?.draft || {};
  const option = (p, chosen) => `<option value="${esc(packageId(p))}"${chosen === packageId(p) ? ' selected' : ''}>${esc(p.name)}</option>`;
  // Features with the levels they come at: struck through for what leaves the
  // class, highlighted for what joins it, as the class's ladder marks them.
  const featureList = (items, cls) => (items.length ? `<ul class="pkgfeats">${items.map((x) => `<li><span class="${cls}">${esc(x.name)}</span>${
    x.levels.length ? ` <span class="pkglv">${esc(x.levels.join(', '))}</span>` : ''}</li>`).join('')}</ul>` : '');
  const note = (text, warn = false) => `<p class="hint${warn ? ' warn' : ''}">${esc(text)}</p>`;
  const body = rows.map(({ row, i }) => {
    const swaps = swapsOn(row);
    const given = new Set(swaps.map((e) => String(e.package.gives).toLowerCase()));
    const own = ownPackages(all, row.name);
    const left = own.filter((p) => !given.has(p.name.toLowerCase()));
    const done = swaps.map((e) => {
      const ch = archetypeChanges(model, row.name, e);
      const took = groupLevels(ch.lost.map((l) => ({ name: l.feature, levels: [l.level] })));
      const brought = groupLevels(ch.gained.filter((x) => x.name.toLowerCase() !== `${e.name} package`.toLowerCase())
        .map((x) => ({ name: x.name, levels: [x.level] })));
      return `<tr>
          <td data-stack="name">${esc(row.name)}</td>
          <td data-label="Gives up">${esc(e.package.gives)}${featureList(took, 'archlost')}
            ${e.package.absent?.length ? note(`Not on the ladder: ${e.package.absent.join(', ')}.`) : ''}</td>
          <td data-label="Takes">${esc(e.package.takes)}${e.package.takesClass ? ` <span class="badge">${esc(e.package.takesClass)}</span>` : ''}${featureList(brought, 'archgain')}</td>
          <td class="mid">${removeAction('arch-remove', { class: row.name, name: e.name }, { what: `the ${e.package.takes} package` })}</td>
        </tr>`;
    }).join('');
    if (!own.length) {
      return `${done}<tr><td data-stack="name">${esc(row.name)}</td><td colspan="3" class="empty" data-label="Packages">No packages for ${esc(row.name)} in the enabled packs.</td></tr>`;
    }
    if (!left.length) return done;
    // What may be taken: every other class's packages, and those of no class.
    const others = all.filter((p) => !sameClass(p.class, row.name));
    const byClass = new Map();
    for (const p of others) {
      const k = String(p.class || '').trim() || 'Any class';
      if (!byClass.has(k)) byClass.set(k, []);
      byClass.get(k).push(p);
    }
    const groups = [...byClass.entries()].sort(([a], [b]) => (a === 'Any class' ? -1 : b === 'Any class' ? 1 : a.localeCompare(b)));
    // A choice since given up, or none yet, is the first one left: what the select shows.
    const give = left.some((p) => packageId(p) === draft[`pkgGive:${i}`]) ? draft[`pkgGive:${i}`] : packageId(left[0]);
    const take = draft[`pkgTake:${i}`] || '';
    // What this swap would do, checked against the class's ladder as it is now.
    const check = packageCheck(model, {
      className: row.name, gives: left.find((p) => packageId(p) === give), takes: others.find((p) => packageId(p) === take), blocks,
    });
    const powers = check.grants.filter((p) => p !== 'combat training');
    const takesClass = others.find((p) => packageId(p) === take)?.class || '';
    return `${done}<tr>
          <td data-stack="name">${esc(row.name)}</td>
          <td data-label="Gives up"><select data-draft="pkgGive:${i}" data-pkg="give" aria-label="Package ${esc(row.name)} gives up">${left.map((p) => option(p, give)).join('')}</select>
            ${featureList(check.removes, 'archlost')}
            ${check.absent.length ? note(`Not on the ladder: ${check.absent.join(', ')}.`) : ''}</td>
          <td data-label="Takes"><select data-draft="pkgTake:${i}" data-pkg="take" aria-label="Package ${esc(row.name)} takes">
            <option value="">Choose a package</option>
            ${groups.map(([k, list]) => `<optgroup label="${esc(k)}">${list.sort((a, b) => a.name.localeCompare(b.name)).map((p) => option(p, take)).join('')}</optgroup>`).join('')}
          </select>
            ${featureList(check.adds, 'archgain')}
            ${check.noClass ? note(`No ${takesClass || 'matching'} class is in the enabled packs, so its features cannot be added.`, true)
    : check.missing.length ? note(`Not found on the ${takesClass} class: ${check.missing.join(', ')}.`, true) : ''}
            ${powers.length ? note(`Also grants ${powers.join(' and ')}.`) : ''}</td>
          <td class="mid"><button data-action="package-swap" data-class="${esc(row.name)}">Swap</button></td>
        </tr>`;
  }).join('');
  const problems = packageProblems(model, blocks);
  return collapsible(model, 'packages', `<section class="panel span2 pkgpanel">
      <h3>Archetype packages</h3>
      ${problems.map((p) => `<p class="hint warn">${esc(p.text)}</p>`).join('')}
      ${!all.length ? '<p class="empty">No archetype packages in the enabled packs.</p>'
    : !rows.length ? '<p class="empty">No classes yet.</p>'
      : `<div class="tablewrap"><table class="pkgswap stacked">
        <thead><tr><th>Class</th><th>Gives up</th><th>Takes</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <p class="hint">A swap removes the struck-through features and adds the highlighted ones, at the levels shown. The class's feature ladder marks them the same way.</p>`}
    </section>`);
}

/**
 * Aligned classes: a prestige class that adds some of its levels to a class
 * the character had before it. One block per prestige class set up, with the
 * prestige levels it gains on and the class each goes to.
 */
function alignedPanel(model) {
  const c = model.data;
  const classes = (c.classes || []).map((x, i) => ({ name: String(x?.name ?? '').trim(), i, row: x }))
    .filter((x) => x.name);
  if (classes.length < 2) return '';
  const set = classes.filter((x) => x.row.aligned);
  const steps = model.alignedSteps();
  const level = Number(c.identity?.level) || 0;
  const owed = steps.filter((s) => !s.class && s.level <= level).length;
  // `blank` false for a choice that always has an answer (a tie for lowest).
  const options = (names, value, blank = true) => {
    const pairs = names.map((n) => [n, n]);
    if (value && !names.includes(value)) pairs.push([value, `${value} *`]);
    return `${blank ? '<option value="">—</option>' : ''}${pairs.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}`;
  };
  const block = ({ name, i, row }) => {
    const a = row.aligned;
    const others = classes.filter((x) => x.i !== i).map((x) => x.name);
    const chosen = Array.isArray(a.classes) ? a.classes : [];
    // One picker per aligned class, and a blank one to add another.
    const pickers = [...chosen.filter((n) => String(n ?? '').trim()), ''];
    const mine = steps.filter((s) => s.index === i);
    const gain = (s) => {
      const ref = esc(JSON.stringify({ i, kind: s.kind, p: s.prcLevel, n: s.n }));
      if (s.kind === 'lowest') {
        return s.tied.length
          ? `<span class="pair">Lowest: <select data-alignedpick="${ref}" aria-label="Tied lowest class at ${esc(name)} level ${s.prcLevel}">${options(s.tied, s.class, false)}</select></span>`
          : `Lowest: ${esc(s.class)}`;
      }
      return s.choices.length > 1
        ? `<select data-alignedpick="${ref}" aria-label="Aligned class at ${esc(name)} level ${s.prcLevel}">${options(s.choices, s.class)}</select>`
        : esc(s.class);
    };
    // What a class level is made of: the levels taken, then each prestige
    // class's aligned levels, which may come from another block than this one.
    const reached = (s) => {
      const taken = s.parts.taken ? [`${s.parts.taken} level${s.parts.taken === 1 ? '' : 's'} taken`] : [];
      const tip = `${[...taken, ...s.parts.from.map(([from, n]) => `${n} from ${from}`)].join(', ')}.`;
      return `<span class="alsum" tabindex="0" data-tip="${esc(tip)}" data-tiphead="${esc(`${s.class} ${s.reaches}`)}">${esc(s.class)} ${s.reaches}</span>`;
    };
    // Other prestige classes adding levels to this block's classes.
    const alsoFrom = new Map();
    for (const s of steps) {
      if (s.index === i || !s.class || !mine.some((m) => m.class === s.class)) continue;
      if (!alsoFrom.has(s.prestige)) alsoFrom.set(s.prestige, new Set());
      alsoFrom.get(s.prestige).add(s.class);
    }
    const also = [...alsoFrom].map(([from, to]) => `${esc(from)} also adds levels to ${esc([...to].join(' and '))}.`).join(' ');
    // The gain rows: which prestige levels, how many different classes each,
    // and whether the player picks them or the lowest ones get them.
    const gainRow = (g, gi) => {
      const ref = (k) => esc(JSON.stringify({ i, g: gi, k }));
      const value = String(g.levels ?? '').trim();
      const bad = value && !alignedRule(value);
      return `<tr>
          <td><input type="text" data-alignedgain="${ref('levels')}" value="${esc(value)}"${bad ? ' class="bad" title="Not a level rule, so it adds nothing."' : ''}
            placeholder="2, +1" spellcheck="false" aria-label="Prestige levels"></td>
          <td class="num"><input type="number" min="1" step="1" data-alignedgain="${ref('count')}" value="${Math.max(1, Math.floor(Number(g.count) || 1))}"
            aria-label="Classes that gain a level"></td>
          <td><select data-alignedgain="${ref('lowest')}" aria-label="Which classes">
            <option value=""${g.lowest ? '' : ' selected'}>Chosen</option>
            <option value="1"${g.lowest ? ' selected' : ''}>Lowest</option>
          </select></td>
          <td class="tools">${removeAction('remove-aligned-gain', { index: i, gain: gi }, { what: 'this row' })}</td>
        </tr>`;
    };
    return `<div class="alblock">
      <h4><span class="pair">${esc(name)}
        ${removeAction('remove-aligned', { index: i }, { what: `${name}'s aligned class` })}</span></h4>
      <div class="fieldgrid">
        <label class="fld alclasses"><span>Aligned class${pickers.length > 2 ? 'es' : ''}</span>
          <span class="pair">${pickers.map((n, k) => `<select data-aligned="${esc(JSON.stringify({ i, n: k }))}"
            aria-label="Aligned class ${k + 1}">${options(others, String(n ?? '').trim())}</select>`).join('')}</span></label>
      </div>
      <div class="tablewrap"><table class="gridtab algains">
        <thead><tr><th>Prestige levels</th><th class="num">Classes</th><th>Which</th><th></th></tr></thead>
        <tbody>${alignedGainRows(a).map(gainRow).join('')}</tbody>
      </table></div>
      <button data-action="add-aligned-gain" data-index="${i}">+ Add levels</button>
      ${mine.length ? `<div class="tablewrap"><table class="gridtab alsteps">
        <thead><tr><th class="num">${esc(name)} level</th><th class="num">Level</th><th>Gain</th><th class="num">Class level</th></tr></thead>
        <tbody>${mine.map((s) => `<tr class="${s.level > level ? 'future' : ''}">
          <td class="num">${s.prcLevel}</td>
          <td class="num">${s.level}</td>
          <td class="${!s.class && s.level <= level ? 'due' : ''}">${gain(s)}</td>
          <td class="num">${s.class ? reached(s) : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">No aligned levels yet.</p>`}
      ${also ? `<p class="hint">${also}</p>` : ''}
    </div>`;
  };
  const unset = classes.filter((x) => !x.row.aligned);
  return collapsible(model, 'aligned', `<section class="panel span2 alignedpanel">
      <h3>Aligned classes${owed ? ` <span class="badge due">${owed} to pick</span>` : ''}</h3>
      ${set.map(block).join('')}
      ${unset.length ? `<select class="fillcol" data-alignedadd aria-label="Add an aligned class to a prestige class">
        <option value="" selected disabled hidden>Add to a prestige class…</option>
        ${unset.map((x) => `<option value="${x.i}">${esc(x.name)}</option>`).join('')}
      </select>` : ''}
      <p class="hint">Aligned levels count as levels of the aligned class for everything except hit dice, BAB, saves and skill ranks.
        Each row gives one level to that many different aligned classes at the prestige levels it lists.
        Chosen classes are picked per level. Lowest goes to the classes with the fewest levels.
        Prestige levels use rule group syntax: <code>2, +1</code> is 2nd and every level after.</p>
    </section>`);
}

export function renderProgressionPanel(model, ctx) {
    const c = model.data;
    const p = c.progression;
    if (!p) return '<div class="grid"><section class="panel"><h3>Progression</h3><p class="empty">No progression data.</p></section></div>';
    const classNames = c.classes.map((x) => x.name).filter(Boolean);
    const level = Number(c.identity.level) || 0;
    const tracks = Array.from({ length: p.tracks }, (_, i) => i);
    // Gestalt off (a campaign rule): the first track is the class each level;
    // any others are kept, greyed, and not read.
    const gestalt = campaignRules(c).gestalt;

    const classCell = (row, t) => {
      const value = row.classes?.[t] ?? '';
      const pairs = classNames.map((n) => [n, n]);
      if (value && !classNames.includes(value)) pairs.push([value, `${value} *`]);
      return `<select data-prog="${row.level}|${t}">
        <option value="">—</option>
        ${pairs.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}
      </select>`;
    };

    return `<div class="grid">
      ${classesPanel(model, ctx)}
      ${classActionsPanel(model)}
      ${collapsible(model, 'prog-levels', `<section class="panel span2">
        <h3>Level progression
          ${gestalt ? '<button data-action="add-track" title="Add another class track.">+ Class track</button>' : ''}
        </h3>
        <div class="tablewrap"><table class="gridtab prog">
          <thead><tr>
            <th class="num">Lvl</th>
            ${tracks.map((t) => `<th><span class="pair">Track ${t + 1}
              ${p.tracks > 1 ? removeAction('remove-track', { track: t }, { what: 'this track' }) : ''}</span>
              <select class="fillcol" data-filltrack="${t}"
                title="Put one class on every level of this track"
                aria-label="Fill track ${t + 1} with one class">
                <option value="" selected disabled hidden>Fill column…</option>
                ${classNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
              </select></th>`).join('')}
            <th class="num" title="Best hit die among the classes at that level">HP</th>
            <th class="num" title="Best skill ranks">Ranks</th>
            <th class="num">Fort</th><th class="num">Ref</th><th class="num">Will</th>
          </tr></thead>
          <tbody>${p.levels.map((row) => `<tr class="${row.level > level ? 'future' : ''}">
            <td class="num">${esc(row.level)}</td>
            ${tracks.map((t) => `<td${!gestalt && t ? ' class="future" title="Not used with gestalt off."' : ''}>${classCell(row, t)}</td>`).join('')}
            <td class="num derived">${row.computed?.hp ? `d${row.computed.hp}` : ''}</td>
            <td class="num derived">${row.computed?.ranks || ''}</td>
            <td class="num derived">${row.computed?.fort || ''}</td>
            <td class="num derived">${row.computed?.ref || ''}</td>
            <td class="num derived">${row.computed?.will || ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">
          Class tracks pick from the Classes table above. HP, ranks and saves per level
          are read-only. ${gestalt ? 'They use the best of the classes chosen on each row'
    : 'With gestalt off, they come from the first track\'s class only'}
          (good saves ½, poor ⅓). Rows past level ${level} are planned. Class features are
          in the groups below. Ability score increases are on the <strong>Stats</strong> tab.
        </p>
        <p class="hint">
          <strong>Rule groups.</strong> Under each feature column's name, <em>+ level rule</em>
          adds a named, colored schedule of the levels the column grants on.
          Write <code>odd</code>, <code>even</code>, <code>2, +4</code> (2 and every 4 after),
          <code>1, 2, +2</code> (1st and every even level), <code>5-10</code>, or a list.
          Terms add up from left to right: <code>2, +4, 3</code> adds level 3 to that schedule,
          and <code>odd, -13</code> removes level 13. A column with no rule grants at every level.
        </p>
        <p class="hint">
          <strong>Several rules can share one column</strong>. For example, give a kineticist's
          Wild Talent column <code>{Infusions, odd}</code> and <code>{Utility, even}</code>. Each
          level is then colored and tagged by the group that grants it; a single group is not
          tagged. <em>+ names</em> / <em>− names</em> under the column changes this. The ▾ beside
          the column's name collapses its groups to their names. Typing the full braced form into
          either box fills both. Rules count the <em>class's</em> own levels; start a rule with
          <code>char:</code> to count character levels. Anything that is not a level list is a
          formula over <code>classLevel</code> / <code>charLevel</code>, e.g.
          <code>classLevel % 3 == 1</code>. Reached levels with nothing filled in are outlined and
          counted on the group header. Levels not reached yet are faintly marked.
        </p>
      </section>`)}
      ${alignedPanel(model)}
      ${vmcPanel(model)}
      ${packagePanel(model, ctx)}
    </div>
    <div class="featgroups">
      ${classFeatureGroups(model, ctx)}
    </div>`;
  }

/**
 * The ◂ ▸ pair that moves a feature group or a feature column one place.
 * `data` goes on both buttons as data-* attributes; the button that would
 * move past an end is disabled.
 */
function sideMove(action, data, i, count, what) {
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  const button = (delta, arrow, way) => `<button type="button" data-action="${action}" ${attrs} data-delta="${delta}"
      title="Move ${way}" aria-label="Move ${esc(what)} ${way}"${i + delta < 0 || i + delta >= count ? ' disabled' : ''}>${arrow}</button>`;
  return `<span class="sidemove">${button(-1, '◂', 'left')}${button(1, '▸', 'right')}</span>`;
}

  /**
   * One collapsible group per class named in the progression, holding that
   * class's per-level feature columns.
   */
function classFeatureGroups(model, ctx) {
    const p = model.data.progression;
    // The menus this grid's cells pick from, gathered as the cells render so
    // one list is written per menu however many cells offer it.
    ctx.menuLists = new Map();
    // Groups whose class is no longer in any track are included, so nothing
    // silently disappears. The order is the player's once they move one.
    const names = model.classFeatureGroupOrder();

    return names.map((name, gi) => {
      const g = p.classFeatures?.[name] || { columns: [], byLevel: {}, rules: {} };
      const orphaned = name !== 'General' && !model.classLevelsIn(name).length;
      // Rows carry both levels: the character level they sit at and the
      // class's own level count, which is what a rule counts by default.
      const rows = model.classFeatureRows(name);

      // Column widths are draggable; saved per character in uiPrefs.
      const tableKey = `progfeat-${name}`;
      const colW = (col) => model.classFeatureColumnWidth(name, col);
      const total = 46 + g.columns.reduce((t, col) => t + colW(col), 0);
      const charLevel = Number(model.data.identity.level) || 0;
      const due = Object.values(model.classFeatureDue(name)).reduce((t, n) => t + n, 0);
      const movable = names.length > 1;

      // Cells waiting on a class level the character has not got back yet.
      const parked = Object.keys(model.classFeatureParked(name)).map(Number).sort((a, b) => a - b);
      // What the class's archetypes and package swaps took and brought, to mark.
      // A whole feature gone is named in Special, or the first column if none.
      const marks = archetypeMarks(model, name);
      marks.col = g.columns.includes('Special') ? 'Special' : g.columns[0];
      return collapsible(model, `progfeat-${name}`, `<section class="panel featpanel">
        <h3>${movable ? grip(`data-cfggrip="${gi}"`) : ''}${esc(name)} features
          <span class="badge">${orphaned ? 'not in progression' : `levels ${rows.length ? `${rows[0].level}–${rows[rows.length - 1].level}` : '—'}`}</span>
          ${due ? `<span class="badge due" title="Reached levels with nothing filled in.">${due} to pick</span>` : ''}
          ${parked.length ? `<span class="badge" title="Written for ${esc(name)} level${parked.length === 1 ? '' : 's'} ${parked.join(', ')}, which this character no longer has. It is kept and returns when the class reaches those levels again.">${parked.length} parked</span>` : ''}
          ${movable ? sideMove('move-cf-group', { index: gi }, gi, names.length, `${name} features`) : ''}
          ${orphaned ? groupDelete(name, g, ctx.armedRemove ?? null) : ''}
        </h3>
        <div class="tablewrap"><table class="gridtab featgrid" style="width:${total}px" data-colresize="off">
          <colgroup>
            <col style="width:46px">
            ${g.columns.map((col) => `<col style="width:${colW(col)}px">`).join('')}
          </colgroup>
          <thead><tr><th class="num">Lvl</th>
            ${g.columns.map((col, i) => featureColumnHead(model, name, col, i, tableKey, g.columns.length)).join('')}
          </tr></thead>
          <tbody>${rows.map((row) => `<tr class="${row.future ? 'future' : ''}${row.aligned ? ' aligned' : ''}">
            <td class="num"${name === 'General' ? ''
    : ` title="Character level ${row.level}: ${esc(name)} level ${row.classLevel}${row.aligned ? `, from ${esc(row.aligned)}` : ''}"`}>${row.level}</td>
            ${g.columns.map((col) => featureCell(ctx, model, name, col, row,
    groupNamesShown(model, name, col, (g.rules?.[col] || []).length), marks)).join('')}
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:6px">
          <button class="primary" data-action="add-cf-column" data-class="${esc(name)}">+ Add column</button>
        </div>
        ${classFeatureNotes(model, name, marks)}
      </section>`);
    }).join('') + menuListMarkup(ctx);
  }

  /**
   * Deleting a group the progression no longer names, in two clicks.
   *
   * Both states live in the heading, because a group is usually met folded --
   * a ghost class is exactly the one nobody has open -- and a confirmation in
   * the body would be a click on a × that visibly did nothing. The second
   * click says what is going: a group is a column of the player's own writing
   * per level, which is worth asking about even though Ctrl+Z puts it back.
   */
function groupDelete(name, g, armedKey) {
    const cols = g.columns.length;
    // A ghost with no columns left is the one that has been stuck the longest,
    // so it gets a phrase of its own rather than "0 columns".
    const what = cols ? `the ${name} group's ${cols} column${cols === 1 ? '' : 's'} and everything in ${cols === 1 ? 'it' : 'them'}`
      : `the empty ${name} group`;
    const key = `cfgroup|${name}`;
    return removeAction('remove-cf-group', { class: name }, {
      what, arm: key, armed: armedKey, style: 'margin-left:auto',
    });
  }

  /**
   * What the ladder names that a pack can explain, to read and then take.
   *
   * Each is shut until opened: the text is there to be looked at before it is
   * added, and a wild-talent column can offer a dozen at once.
   */
function packOffers(className, offers) {
    if (!offers.length) return '';
    return `<div class="cfoffers">
      <div class="offerhead">
        <span>In your packs</span>
        <span class="hint">Named on the ladder and included in a pack. Open one to read it. Adding it copies its text here so you can edit it.</span>
        ${offers.length > 1 ? `<button data-action="add-cfnote-pack" data-class="${esc(className)}">+ Add all ${offers.length}</button>` : ''}
      </div>
      ${offers.map((o) => `<details class="cfoffer">
        <summary>
          <span class="oname">${esc(o.name)}${o.type ? ` <span class="otype">(${esc(o.type)})</span>` : ''}</span>
          <span class="osrc">${esc([o.category, o.source].filter(Boolean).join(' · '))}</span>
          <span class="badge">Lv ${o.level}</span>
          <button data-action="add-cfnote-pack" data-class="${esc(className)}" data-name="${esc(o.name)}"
            title="Copy this text into ${esc(className)}'s notes">+ Add</button>
        </summary>
        <div class="peektext">${esc(o.text)}</div>
      </details>`).join('')}
    </div>`;
  }

/**
 * What a class's features do, under the ladder that says when each arrives.
 *
 * One entry per distinct feature however many levels grant it, an archetype's
 * among them. This is where a pack's rules text lands: the Template tab is
 * for templates, and a class is not one.
 *
 * The list is the player's: each note folds to its name row, and the grip
 * drags it into whatever order reads best -- a pack lands them in table
 * order, which is not always the order a player thinks in.
 */
function classFeatureNotes(model, className, marks = archetypeMarks(model, className)) {
    const notes = model.classFeatureNotes(className);
    const lost = marks.lostNotes;
    const offers = model.classFeatureNoteSuggestions(className);
    const open = isOpen(model, `cfnotes-${className}`);
    const charLevel = Number(model.data.identity.level) || 0;
    // Where the ladder says the feature arrives; a note it never names has
    // no level and no badge. Past that level the badge is just a fact; before
    // it, the note is a plan and any bonus in it is greyed, as on the ladder.
    const arrival = (f) => {
      const at = model.classFeatureNoteLevel(className, f.name);
      if (at === null) return { at, future: false, badge: '' };
      const future = at > charLevel;
      return {
        at, future,
        badge: `<span class="badge${future ? ' due' : ''}" title="${future
          ? `Gained at level ${at}. A bonus written here does not apply yet.`
          : `Gained at level ${at}`}">Lv ${at}</span>`,
      };
    };
    return `<div class="cfnotes">
      ${foldButton(model, `cfnotes-${className}`, {
    open,
    cls: 'notehead',
    title: '',
    text: `
        ${open ? '▾' : '▸'} What they do <span class="badge">${notes.length}</span>
        ${offers.length ? `<span class="badge offer" title="Named on the ladder, not written here, and included in an active pack.">${offers.length} in your packs</span>` : ''}
        ${lost.length ? `<span class="badge" title="Taken out by an archetype or package swap.">${lost.length} given up</span>` : ''}
      `,
  })}
      ${open ? `${notes.length ? `<div class="cfnotelist" data-cfnotes="${esc(className)}">${notes.map((f, i) => {
        const when = arrival(f);
        const from = marks.gainedNotes.get(String(f.name).toLowerCase());
        const foldKey = `cfnote-${className}-${f.name}`;
        const shut = isCollapsed(model, foldKey);
        return `<div class="cfnote${shut ? ' collapsed' : ''}" data-cfndrop="${esc(JSON.stringify({ c: className, i }))}">
        <span class="pair">
          <span class="grip" data-cfngrip title="Drag to reorder">⠿</span>
          ${foldButton(model, foldKey, { open: !shut })}
          <input type="text" class="notename" value="${esc(f.name)}" spellcheck="false"
            data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'name' }))}">
          <select data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'type' }))}">
            ${['', 'Ex', 'Su', 'Sp'].map((t) => `<option value="${t}"${(f.type || '') === t ? ' selected' : ''}>${t || '—'}</option>`).join('')}
          </select>
          ${when.badge}
          ${from ? `<span class="badge archfrom" title="${esc(gainedBy(from))}">${esc(from.name)}</span>` : ''}
          ${removeAction('remove-cfnote', { class: className, index: i }, { what: f.name })}
        </span>
        ${shut ? '' : prose(model, `data-cfnote="${esc(JSON.stringify({ c: className, i, k: 'text' }))}"`, f.text, 3, 'grow', null, {
    inactive: when.future,
    inactiveTitle: `This feature is gained at level ${when.at}, so its bonus does not apply yet.`,
  })}
      </div>`;
      }).join('')}</div>` : '<p class="empty">Nothing yet. A class added from a pack adds its features\' text here.</p>'}
      ${lostNotes(model, className, lost)}
      ${packOffers(className, offers)}
      <div style="margin-top:6px">
        <button data-action="add-cfnote" data-class="${esc(className)}">+ Add feature text</button>
      </div>` : ''}
    </div>`;
  }

/**
 * The features' text an archetype or package swap took out, folded under the
 * notes: struck through and read-only, since the class no longer has them.
 * Taking the archetype off puts each one back on the list above.
 */
function lostNotes(model, className, lost) {
    if (!lost.length) return '';
    const key = `cflost-${className}`;
    const open = isOpen(model, key, false);
    return `<div class="cflost">
      ${foldButton(model, key, {
    open,
    cls: 'notehead',
    title: '',
    text: `${open ? '▾' : '▸'} Given up <span class="badge">${lost.length}</span>`,
  })}
      ${open ? lost.map((n) => `<div class="cfnote lost">
        <span class="pair">
          <span class="archlost">${esc(n.name)}</span>${n.type ? ` <span class="otype">(${esc(n.type)})</span>` : ''}
          <span class="hint">${esc(lostBy(n.by))}</span>
        </span>
        ${String(n.text || '').trim() ? `<div class="peektext">${esc(n.text)}</div>` : ''}
      </div>`).join('') : ''}
    </div>`;
  }

  /**
   * The id of the list a menu's cells offer, made on first use.
   *
   * A menu belongs to the pack that provides it, not to the character, so the
   * grid never holds a copy: it writes the list once and every cell picking
   * from that menu points at it.
   */
function menuListId(ctx, menu, atLevel) {
    // A cell offers what it could actually take: an entry asking for a level
    // above this one is not on this cell's list. Levels that can take the same
    // entries share a list, so a twenty-level column writes two or three.
    const options = menu.options.filter((o) => !o.minLevel || o.minLevel <= atLevel);
    const key = `${menu.name}|${options.length}`;
    if (!ctx.menuLists.has(key)) {
      ctx.menuLists.set(key, { id: `cfmenu-${ctx.menuLists.size}`, menu: { ...menu, options } });
    }
    return ctx.menuLists.get(key).id;
  }

  /** Those lists, written once each after the tables that offer them. */
function menuListMarkup(ctx) {
    return [...ctx.menuLists.values()].map(({ id, menu }) => `<datalist id="${id}">${
      menu.options.map((o) => {
        // What the browser shows beside the name: where it sits in the menu
        // and the level it asks for, which is what a player is choosing on.
        const hint = [o.category, o.minLevel ? `${o.minLevel}th+` : '', o.source].filter(Boolean).join(' · ');
        return `<option value="${esc(o.name)}">${esc(hint)}</option>`;
      }).join('')
    }</datalist>`).join('');
  }

  /**
   * Whether a column's cells wear their rule group's name.
   *
   * Left alone, one group goes unnamed (the heading says it) and two or more
   * are named. The heading's toggle overrides that either way, and is kept
   * with the character like a fold: true hides, false shows, unset is auto.
   */
function groupNamesShown(model, className, col, groupCount) {
    const pref = model.data.uiPrefs.collapsed?.[`cftags-${className}-${col}`];
    return typeof pref === 'boolean' ? !pref : groupCount > 1;
  }

  /**
   * A feature column's header: its name, its level rule, the handle that
   * resizes it, and the grip and ◂ ▸ pair that move it.
   *
   * The rule box is deliberately plain text rather than a builder -- what a
   * player types ("2, +4") is what gets stored, so the schedule stays legible
   * and extensible after the fact.
   */
function featureColumnHead(model, className, col, index, tableKey, count) {
    const groups = model.classFeatureRuleGroups(className, col);
    const due = model.classFeatureDue(className)[col] || 0;
    const named = groupNamesShown(model, className, col, groups.length);

    // Folded, the groups are only their names, side by side: the schedules are
    // set once and read rarely, and a row of boxes per group above every column
    // is a lot of heading. Kept with the character, like any fold.
    const foldKey = `cfrules-${className}-${col}`;
    const folded = groups.length > 0 && isCollapsed(model, foldKey);

    const ruleTitle = (rule) => {
      const basis = rule.basis === 'char' ? 'character' : 'class';
      return rule.kind === 'error' ? `Rule not understood: ${rule.error}. Granting every level.`
        : rule.kind === 'formula' ? `Formula over ${basis} level: ${rule.expr}`
          : `Grants at ${basis} levels ${summariseLevels(levelRuleLevels(rule))}`;
    };
    const groupChip = (grp) => {
      const rule = parseLevelRule(grp.rule || '');
      return `<span class="rulechip${rule.kind === 'error' ? ' bad' : ''}" style="--gc:${esc(grp.color)}"
        title="${esc(ruleTitle(rule))}">${esc(grp.name || grp.rule || col)}</span>`;
    };
    // Two schedules in one column are as often two lists -- infusions on the
    // odd levels, utility talents on the even -- so each may pick from a menu
    // of its own. One group has the column's, and needs no second dropdown.
    const anyMenus = groups.length > 1 && optionCatalogues().length > 0;
    const groupMenu = (grp, gi) => {
      const chosen = grp.optionsFrom || '';
      if (!anyMenus && !chosen) return '';
      const missing = chosen && (!anyMenus || !providedMenu(chosen));
      return `<select class="colmenu gmenu${missing ? ' bad' : ''}" style="--gc:${esc(grp.color)}"
        data-cfgmenu="${esc(className)}|${index}|${gi}"${anyMenus ? ' data-fill="groupmenus"' : ''}
        title="${esc(missing ? `“${chosen}” is not available. Its pack is off or not installed.`
    : `The menu ${grp.name || 'this group'}'s cells pick from. Blank uses the column's menu.`)}">
        ${groupMenuChoices(model, chosen, { all: false })}
      </select>`;
    };
    const groupRow = (grp, gi) => {
      const rule = parseLevelRule(grp.rule || '');
      const title = ruleTitle(rule);
      return `${groupRowFields(grp, gi, rule, title)}${groupMenu(grp, gi)}`;
    };
    const groupRowFields = (grp, gi, rule, title) => {
      return `<span class="rulegroup" style="--gc:${esc(grp.color)}">
        <input type="color" value="${esc(grp.color)}" data-cfgcolor="${esc(className)}|${index}|${gi}"
          aria-label="Color for ${esc(grp.name || col)}" title="Group color">
        <input type="text" class="gname" value="${esc(grp.name)}" placeholder="name"
          data-cfgname="${esc(className)}|${index}|${gi}" spellcheck="false">
        <input type="text" class="grule ${rule.kind === 'error' ? 'bad' : ''}" value="${esc(grp.rule)}"
          placeholder="levels" data-cfgrule="${esc(className)}|${index}|${gi}"
          title="${esc(title)}" spellcheck="false">
        ${removeAction('remove-rule-group', { class: className, col: index, group: gi }, { what: 'this rule group' })}
      </span>`;
    };

    // JSON for the same reason as a cell's: a class name is free text.
    const movable = count > 1;
    return `<th class="resizable"${movable ? ` data-cfcoldrop="${esc(JSON.stringify({ c: className, i: index }))}"` : ''}>
      <span class="pair">
        ${movable ? grip('data-cfcolgrip') : ''}
        <input type="text" class="colname" value="${esc(col)}" data-cfcol="${esc(className)}|${index}">
        ${due ? `<span class="badge due" title="${due} level${due === 1 ? '' : 's'} reached with nothing filled in">${due}</span>` : ''}
        ${groups.length ? foldButton(model, foldKey, { open: !folded }) : ''}
        ${movable ? sideMove('move-cf-column', { class: className, col: index }, index, count, `the ${col} column`) : ''}
        ${removeAction('remove-cf-column', { class: className, col: index }, { what: 'column' })}
      </span>
      ${folded ? `<span class="rulechips">${groups.map(groupChip).join('')}</span>` : `${groups.map(groupRow).join('')}
      ${featureColumnMenu(model, className, col, index)}
      <button class="addgroup" data-action="add-rule-group" data-class="${esc(className)}" data-col="${index}"
        title="${groups.length ? 'Add another schedule to this column.'
    : 'Limit this column to certain levels, such as &quot;odd&quot;, &quot;even&quot; or &quot;2, +4&quot;.'}">${groups.length ? '+ rule group' : '+ level rule'}</button>
      ${groups.length ? foldButton(model, `cftags-${className}-${col}`, {
    open: named,
    cls: 'addgroup',
    pressed: true,
    title: named ? 'Stop naming the rule group on each cell' : 'Name the rule group on each cell',
    text: named ? '− names' : '+ names',
  }) : ''}`}
      <div class="col-resizer" data-resize-table="${esc(tableKey)}" data-resize-col="${esc(col)}"
        title="Drag to resize"></div>
    </th>`;
  }

  /**
   * One feature cell. A column with no rule looks exactly as it always has;
   * a ruled column tints the levels it grants and locks the rest, the same
   * green/grey the sphere-talent grid uses.
   *
   * Text already sitting on a level a later rule excludes is kept and flagged
   * rather than hidden, so tightening a rule never quietly eats an entry.
   */
function featureCell(ctx, model, className, col, row, multi, marks = null) {
    const cell = row.cells[col];
    // Two rule groups granting at the same level are two things to write down,
    // so each gets its own field, stacked, in its own colour.
    return `<td class="featcell${cell.fields.length > 1 ? ' stacked' : ''}">
      ${cell.fields.map((f, i) => featureField(ctx, model, className, col, row, f, multi, i === 0 ? marks : null)).join('')}
    </td>`;
  }

/** Who took a feature off the ladder, and who put one on, as a hover says it. */
const lostBy = (by) => (by.package ? `Given up for the ${by.name} package.` : `Replaced by the ${by.name} archetype.`);
const gainedBy = (by) => (by.package ? `From the ${by.name} package, in place of ${by.package.gives}.` : `From the ${by.name} archetype.`);

/**
 * A ladder field's read view where an archetype changed it, or null where
 * none did: the names it brought highlighted, the ones it took struck through
 * after them. Only what the class's archetypes recorded is marked, so a name
 * a player typed in later is plain.
 */
function markedView(model, col, row, field, marks) {
    const here = marks?.cells.get(row.key);
    if (!here) return null;
    const lost = here.lost.filter((l) => (l.column ? l.column === col : col === marks.col));
    const gained = col === 'Special' ? here.gained : [];
    if (!lost.length && !gained.length) return null;
    const text = field.text || '';
    const by = new Map(gained.map((x) => [x.name.toLowerCase(), x.by]));
    const names = text.split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
    const shown = hasTokens(text) ? renderedProse(model, text, null, { links: true })
      : hasLink(text) ? linkedText(text)
        : names.map((n) => (by.has(n.toLowerCase())
          ? `<span class="archgain" title="${esc(gainedBy(by.get(n.toLowerCase())))}">${esc(n)}</span>` : esc(n))).join(', ');
    const struck = lost.map((l) => `<span class="archlost" title="${esc(lostBy(l.by))}">${esc(l.name)}</span>`).join(', ');
    return [shown, struck].filter(Boolean).join(', ');
  }

  /** One writable field inside a feature cell: its tag, its box, its state. */
function featureField(ctx, model, className, col, row, field, multi, marks = null) {
    const cell = row.cells[col];
    const colour = field.group?.color || null;
    const label = field.group?.name || col;
    const view = markedView(model, col, row, field, marks);
    // One grant of a repeat feature an archetype took: the level is locked, and says why.
    const tookGrant = marks?.cells.get(row.key)?.lost.find((l) => l.column === col);

    const state = !cell.ruled ? ''
      : !field.on ? `slot-off${field.stranded ? ' kept' : ''}${tookGrant ? ' archoff' : ''}`
        : `slot-on${field.due ? ' due' : ''}${field.planned ? ' planned' : ''}`;
    const title = !cell.ruled ? ''
      : field.group?.orphan ? `“${field.group.name}” is no longer a rule group on this column. The text is kept but cannot be edited here.`
        : !field.on ? (field.stranded ? 'Outside every rule on this column. The text is kept but cannot be edited here.'
          : tookGrant ? `No ${col} at this level. ${lostBy(tookGrant.by)}`
            : `No ${col} at this level.`)
          : `${label}${field.due ? ': nothing chosen yet' : field.planned ? ': not reached yet' : ''}`;

    // Whether the column names its groups is groupNamesShown's call. Text left
    // behind by a group since removed is always named: nothing else says whose.
    const tagged = (multi || field.group?.orphan) && field.group;
    const tag = tagged
      ? `<span class="ftag${field.group.orphan ? ' orphan' : ''}">${esc(label)}</span>` : '';
    const placeholder = field.due || field.planned ? ` placeholder="${esc(label)}…"` : '';
    // JSON rather than a delimiter: class, column and group names are free
    // text and any of them may contain the separator.
    const ref = esc(JSON.stringify({
      c: className, l: row.key, k: col, g: field.key,
    }));

    // Where a menu is attached the cell offers it, and says what the entry
    // written in it does. Still a box to type in: a GM's ruling, an option no
    // pack carries, or a note beside the name all go in as they always did.
    const menu = field.menu?.options?.length ? field.menu : null;
    const body = menu && !(view && !field.on)
      ? menuField(ctx, ref, field, menu, placeholder, row.classLevel)
      : prose(model, `class="cfeat" data-cfeat="${ref}"${field.on ? '' : ' disabled'}${placeholder}`, field.text, 1, 'grow', null, { view });

    // A cell naming a feature that has text under "What they do" offers it
    // here, one click away, without leaving the ladder. The button carries
    // only the cell's text: the notes are looked up at the click, so the
    // popover shows them as they stand and never a render old.
    const linked = model.classFeatureNotesInCell(className, field.text);
    const peek = linked.length
      ? `<button data-view type="button" class="cfpeek" data-cfpeek="${esc(JSON.stringify({ c: className, t: field.text }))}"
          title="What ${esc(linked.map(({ note }) => note.name).join(', '))} does" aria-label="Show what this feature does">ⓘ</button>`
      : '';

    return `<span class="ffield ${state}${peek ? ' peekable' : ''}"${colour ? ` style="--gc:${esc(colour)};--gc-soft:${rgba(colour, 0.13)}"` : ''}${title ? ` title="${esc(title)}"` : ''}>
      ${tag}${body}${peek}
    </span>`;
  }

  /**
   * What a ladder cell's features do, for the popover its ⓘ opens.
   *
   * Every note the cell names, in the notes' own order: the name, the type
   * and the level the ladder gives it, then the text with its formulas worked
   * out -- the same rendering the note itself shows while it is not being
   * edited. Empty when the cell names nothing written, which is also when
   * the ladder draws no button.
   */
export function featurePeekHtml(model, className, text) {
    const linked = model.classFeatureNotesInCell(className, text);
    if (!linked.length) return '';
    const charLevel = Number(model.data.identity.level) || 0;
    return linked.map(({ note }) => {
      const at = model.classFeatureNoteLevel(className, note.name);
      const sub = [note.type, at !== null ? `${at > charLevel ? 'arrives' : 'arrived'} at level ${at}` : '']
        .filter(Boolean).join(' · ');
      const body = String(note.text || '').trim();
      return `<div class="peek">
        <div class="bdhead"><span class="bdname">${esc(note.name)}</span></div>
        ${sub ? `<div class="bdsub">${esc(sub)}</div>` : ''}
        <div class="peektext">${body
    ? (hasTokens(body) ? renderedProse(model, body) : esc(body))
    : '<span class="empty">Nothing written yet.</span>'}</div>
      </div>`;
    }).join('');
  }

  /** A menu a pack provides by this name, spelled the way the pack spells it; null when none does. */
const providedMenu = (name) => {
    const menu = String(name ?? '').trim() ? optionCatalogue(name) : null;
    return menu && !menu.hidden ? menu : null;
  };

  /**
   * The choices inside a menu picker holding `value`: every menu the packs
   * provide, or with `all: false` only the one it holds. `blank` names the
   * empty choice.
   *
   * The panel draws the short form and the sheet puts the whole list in when
   * somebody reaches for the picker (`data-fill`, see `#fillSelect`). With
   * many packs on, every column carried hundreds of menus. A menu no pack
   * provides any more stays listed, so switching its pack off does not
   * quietly forget the choice.
   */
function menuChoices(value, blank, all) {
    const v = String(value ?? '').trim();
    const held = providedMenu(v)?.name ?? v;
    const names = all ? optionCatalogues().map((c) => c.name) : [];
    if (held && !names.some((n) => same(n, held))) names.push(held);
    return `<option value=""${held ? '' : ' selected'}>${esc(blank)}</option>${
      names.map((n) => `<option value="${esc(n)}"${same(n, held) ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;
  }

export function columnMenuChoices(model, value, { all = true } = {}) { return menuChoices(value, '— no menu —', all); }
export function groupMenuChoices(model, value, { all = true } = {}) { return menuChoices(value, '— column\'s menu —', all); }

  /**
   * Which menu a column's cells pick from.
   *
   * Only shown once a pack provides one, since with none there is nothing to
   * choose between.
   */
function featureColumnMenu(model, className, col, index) {
    // A column may name several menus, layered -- an archetype's over the
    // class's. The dropdown edits the first; the rest are shown after it,
    // since an archetype's pill is where those come and go.
    const stack = model.classFeatureColumnOptions(className, col);
    const [chosen = '', ...layered] = stack;
    if (!chosen && !optionCatalogues().length) return '';
    const missing = chosen && !providedMenu(chosen);
    const claimed = chosen && !model.classFeatureColumnOptionsChosen(className, col);
    return `<select class="colmenu${missing ? ' bad' : ''}" data-cfmenu="${esc(className)}|${index}" data-fill="menus"
      title="${esc(missing ? `“${chosen}” is not available. Its pack is off or not installed.`
    : claimed ? `“${chosen}” names this class and this feature, so this column picks from it. Choose another, or none.`
      : chosen ? `Cells in this column pick from “${chosen}”.`
        : 'Pick entries from a pack menu instead of typing them.')}">
      ${columnMenuChoices(model, chosen, { all: false })}
    </select>${layered.map((n) => `<span class="colmenu layered" title="${
      esc(`“${n}” adds to the menu above. Its entries take priority, and the entries it replaces are removed.`)}">+ ${esc(n)}</span>`).join('')}`;
  }

  /** A cell that picks from a menu: the names on offer, and what the one written means. */
function menuField(ctx, ref, field, menu, placeholder, atLevel) {
    const chosen = menu.options.find((o) => same(o.name, field.text));
    const offered = menu.options.filter((o) => !o.minLevel || o.minLevel <= atLevel).length;
    // An entry written into a level below the one it asks for is flagged, not
    // refused: a GM may allow it, and the sheet's job is to say what the book
    // says rather than to stop anyone.
    const tooSoon = chosen?.minLevel > atLevel;
    const hint = chosen
      ? [chosen.category, chosen.minLevel ? `needs ${chosen.minLevel}th level` : '', chosen.source]
        .filter(Boolean).join(' · ')
        + (tooSoon ? `\n\nThis is a ${chosen.minLevel}th-level entry, written at ${atLevel}th.` : '')
        + (chosen.text ? `\n\n${chosen.text}` : '')
      : `${offered} of ${menu.options.length} available at this level (${menu.name})`;
    // A locked cell never opens its list, so it does not ask for one written.
    const list = field.on ? ` list="${menuListId(ctx, menu, atLevel)}"` : '';
    return `<input type="text" class="cfeat pick${tooSoon ? ' early' : ''}"${list} data-cfeat="${ref}"
      value="${esc(field.text)}"${field.on ? '' : ' disabled'}${placeholder}
      title="${esc(hint)}" spellcheck="false">`;
  }

  /* ---------------- lore & leftover tabs ---------------- */


/**
 * Session notes: one card a session, newest first -- the date, a title and
 * what you want to remember -- and under each, folded, the play log's lines
 * from that day, so what happened at the table sits beside what was written
 * about it. Kept in `sessionNotes`, in the order they were added.
 */
function sessionNotesPanel(model) {
    const notes = Array.isArray(model.data.sessionNotes) ? model.data.sessionNotes : [];
    const log = model.playLog;
    const today = logDay(new Date().toISOString());
    const card = (n, i) => {
      const lines = n.date ? log.filter((e) => logDay(e.at) === n.date) : [];
      return `<div class="notecard editable sessionnote">
        <div class="noterow">
          <input type="date" value="${esc(n.date || '')}" data-item="sessionNotes|${i}|date" data-kind="text"
            aria-label="When the session was" style="width:auto;flex:none">
          ${itemText('sessionNotes', i, 'title', n.title, 'Session title')}
          ${removeButton('sessionNotes', i, { what: 'session note' })}
        </div>
        ${itemArea(model, 'sessionNotes', i, 'body', n.body, 4)}
        ${lines.length ? `<details class="sessionlog"><summary>From the play log that day (${lines.length})</summary>
          <ol class="logl">${logLinesHtml(lines)}</ol></details>` : ''}
      </div>`;
    };
    const shown = notes.map((n, i) => ({ n, i })).reverse();
    return `<section class="panel span2">
        <h3>Session notes <span class="badge">${notes.length}</span>
          <span style="margin-left:auto">${addButton('sessionNotes', 'Add session', {
    date: today, title: `Session ${notes.length + 1}`, body: '',
  })}</span></h3>
        ${shown.map(({ n, i }) => card(n, i)).join('')
    || '<p class="empty">No sessions yet. Add one after each game.</p>'}
        <p class="hint">Newest first. The play log's lines from a session's date are listed under it.</p>
      </section>`;
  }

export function renderExtrasPanel(model, ctx) {
    const c = model.data;
    const x = c.extras || {};
    const list = 'extras.approvals';
    return `<div class="grid">
      <section class="panel span2">
        <h3>Notes <span class="badge">${(c.notes || []).length}</span></h3>
        ${(c.notes || []).map((n, i) => `<div class="notecard editable">
          <div class="noterow">
            ${itemText('notes', i, 'title', n.title, 'Title')}
            ${removeButton('notes', i, { what: 'note' })}
          </div>
          ${itemArea(model, 'notes', i, 'body', n.body, 4)}
        </div>`).join('') || '<p class="empty">No notes yet.</p>'}
        <div style="margin-top:8px">${addButton('notes', 'Add note', { title: '', body: '' })}</div>
        <p class="hint">Plain text. Accepts inline formulas such as <code>{= level * 2}</code>.
          Web addresses (http:// or https://) become links; click one to open it, or elsewhere to edit.
          <code>[words](https://…)</code> makes the words the link.</p>
      </section>

      ${sessionNotesPanel(model)}

      <section class="panel span2">
        <h3>Approvals <span class="badge">${(x.approvals || []).length}</span></h3>
        ${(x.approvals || []).length ? `<div class="tablewrap"><table class="approvals stacked">
          <thead><tr>
            <th style="width:14rem">App</th>
            <th style="width:9rem">Approved by</th>
            <th>Link</th><th style="width:2.4rem"></th>
          </tr></thead>
          <tbody>${x.approvals.map((a, i) => `<tr>
            <td data-stack="name">${itemText(list, i, 'name', a.name, 'What was applied for', true)}</td>
            <td data-label="Approved by">${itemText(list, i, 'approvedBy', a.approvedBy, 'Who', true)}</td>
            <td data-label="Link">${linkField(itemText(list, i, 'link', a.link, 'https://…', true), a.link)}</td>
            ${rowTools(list, i)}
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">No approvals recorded.</p>'}
        <div style="margin-top:8px">${addButton(list, 'Add approval', { name: '', approvedBy: '', link: '' })}</div>
        <label class="fld tall" style="margin-top:10px"><span>Notes</span>
          ${prose(model, 'data-set="extras.approvalNotes"', x.approvalNotes, 3, 'grow')}</label>
        <p class="hint">Custom archetypes, feats and items that needed GM approval, and where the
          approval is recorded. Hover over the short columns to see their full text. The notes box
          accepts {…} formulas.</p>
      </section>
      ${systemExtrasPanel(model, x, 'extras', 'ExtrasNotes')}
    </div>`;
  }


/**
 * The Background tab: the race's traits and the character's own, the
 * specialty, the languages, and the free-text story sections -- the parts of a
 * character chosen once at creation. The Overview shows them read-only.
 */
export function renderLorePanel(model, ctx) {
    const c = model.data;

    return `<div class="grid">
      ${traitsPanel(model, ctx)}
      <div class="band">
        ${/* Background skills (a campaign rule) replace the Specialty. */''}
        ${specialtyInPlay(c) ? specialtyPanel(model) : ''}
        ${languagesPanel(model)}
      </div>
      <section class="panel span2">
        <h3>Story</h3>
        <div class="fieldgrid two">
          ${(c.backgroundSections || []).map((sec, i) => `<label class="fld tall">
            <span>${esc(sec.label)}</span>${itemArea(model, 'backgroundSections', i, 'text', sec.text, 3)}
          </label>`).join('')}
        </div>
        <div style="margin-top:8px">${addButton('backgroundSections', 'Add section', { label: 'New section', text: '' })}</div>
      </section>
    </div>`;
  }

  /**
   * Render a tab we did not model explicitly, as an editable grid.
   *
   * These hold each character's bespoke machinery -- sphere talents, veils,
   * technique lists -- whose shape differs per character, so they stay a grid
   * rather than being forced into a schema. Every cell is editable, and rows
   * and columns can be added or removed. The columns are lettered as a
   * spreadsheet's are, which gives each column's × something to name.
   */
export function gridTab(model, index, tab) {
    const list = `sheetTabs.${index}.rows`;
    const rows = tab.rows || [];
    const width = systemTabWidth(tab);
    return `<section class="panel span2">
      <h3>${esc(tab.name)} ${tab.hidden ? '<span class="badge">hidden in source</span>' : ''}
        <span class="badge">${rows.length} rows</span></h3>
      <div class="tablewrap"><table class="gridtab">
      ${rows.length ? `<thead><tr class="gridcols">
        ${Array.from({ length: width }, (_, ci) => `<th scope="col"><span class="colhead">${columnLetter(ci)}
          ${width > 1 ? removeAction('remove-system-column', { index, col: ci },
    { what: `column ${columnLetter(ci)}`, tiny: true }) : ''}</span></th>`).join('')}
        <th class="tools"></th>
      </tr></thead>` : ''}
      <tbody>
        ${rows.map((r, ri) => `<tr>
          ${Array.from({ length: width }, (_, ci) => `<td>${gridCell(model, list, ri, `cells.${ci}`, r.cells[ci])}</td>`).join('')}
          ${rowTools(list, ri)}
        </tr>`).join('')}
      </tbody></table></div>
      <div style="margin-top:8px">
        ${addButton(list, 'Add row', { cells: Array.from({ length: width }, () => null) })}
      </div>
    </section>`;
  }

/* ---------------- classes, traits, specialty and languages ---------------- */

/** The base attack progressions a class can run, as the rules name them. */
// Characters, not entities: the dropdown escapes its labels like every other.
export const BAB_RATES = [[1, 'full'], [0.75, '¾'], [0.5, '½'], [0, 'none']];

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
      all ? ' has no effect' : ' only counts at the other levels'}.`
    : '';
  return itemSelect('classes', i, field, now, opts, null, null, {
    kind: 'number', attrs: `aria-label="${esc(label)}" class="${all ? 'beaten' : ''}"${why ? ` title="${esc(why)}"` : ''}`,
  });
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
    return `<section class="panel" data-home="specialty">
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
        on Feats &amp; Mythic. The three specialty skills are chosen on the Skills tab.</p>
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
/**
 * Every language the character speaks, native ones first, on one line in a
 * read-only box with a Copy button: the folded Languages panel, and the
 * Overview's copy of it.
 *
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
export function languageCopy(identity) {
  const spoken = [...String(identity.nativeLanguages || '').split(/[,;]/), ...(identity.languages || [])]
    .map((s) => String(s).trim()).filter(Boolean);
  return `<div class="langcopy">
      <textarea class="ro" data-post="languages" readonly rows="1" spellcheck="false"
        placeholder="No languages yet." aria-label="Every language spoken">${esc(spoken.join(', '))}</textarea>
      <button data-view data-copy="languages" title="Copy the list.">Copy</button>
    </div>`;
}

function languagesPanel(model) {
    const c = model.data;
    const i = c.identity;
    const slots = i.languageSlots || { int: 0, linguistics: 0, extra: 0, total: 0, known: 0 };
    const langs = i.languages || [];
    const spare = slots.total - slots.known;
    const shut = !!c.uiPrefs?.collapsed?.languages;
    const head = `<h3>Languages
        <span class="badge${spare < 0 ? ' err' : ''}" title="Languages known / slots from Int, Linguistics and Extra.">${slots.known} / ${slots.total}</span>
        ${foldButton(null, 'languages', {
    open: !shut, cls: 'disclose', title: shut ? 'Open the list to edit it' : 'Fold it down to one line',
  })}
      </h3>`;
    if (shut) {
      return `<section class="panel collapsed" data-home="languages">
        ${head}
        ${languageCopy(i)}
      </section>`;
    }
    return `<section class="panel" data-home="languages">
      ${head}
      <div class="fieldgrid">
        ${field('Native', text('identity.nativeLanguages', i.nativeLanguages, 'Common'))}
        ${field('From Int', `<span class="value" title="One per point of Intelligence bonus">${slots.int}</span>`)}
        ${field('From Linguistics', `<span class="value" title="One per Linguistics rank">${slots.linguistics}</span>`)}
        ${field('Extra slots', exprField('data-set="identity.languageExtra"', i.languageExtra, {
          width: '100%',
          value: typeof i.languageExtra === 'string' && i.languageExtra.trim() ? slots.extra : null,
          error: slots.extraError,
          title: 'A number or a formula, e.g. floor(level / 2)',
        }))}
      </div>
      <div class="langlist">
        ${langs.map((l, li) => `<span class="lang" data-rowdrop="identity.languages|${li}" data-rowaxis="x">
          ${grip()}
          ${itemText('identity.languages', li, 'self', l, 'Language')}
          ${removeButton('identity.languages', li, { what: 'language', tiny: true })}
        </span>`).join('')}
      </div>
      <div class="pair" style="margin-top:8px">
        ${addButton('identity.languages', 'Add language', '')}
        <span class="hint">${spare > 0 ? `${spare} slot${spare === 1 ? '' : 's'} free`
    : spare < 0 ? `${-spare} over the limit` : 'all slots used'}</span>
      </div>
      <p class="hint">Native languages are free. You get one slot per point of Int bonus and one per
        Linguistics rank. <strong>Extra</strong> takes a number or a formula for slots a race
        or a trait adds.</p>
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
    // Gestalt off (a campaign rule): one class a level, each its own progression.
    const core = !campaignRules(c).gestalt;
    const gestalt = !core && (c.progression?.tracks ?? 1) > 1;
    // Classes the Planner gives no level to, with gestalt off.
    const idle = core ? (c.classes || []).filter((x) => x.name && !x.gestaltLevels).map((x) => x.name) : [];
    const aligns = model.alignedSteps().filter((s) => s.class);
    // The sub-system picker: a row of toggles under the class it belongs to.
    // Marking a system badges its tabs in the ⚙ manager and puts them on the
    // session view's bar before anything is typed into them.
    const sysButton = (x, i) => {
      const n = (x.systems || []).length;
      const open = ctx.openClassSystems === i;
      return `<button data-action="class-systems" data-index="${i}" aria-expanded="${open}"
        title="Choose the sub-systems this class uses. Their tabs are marked on the ⚙ tab and shown in session view.">
        ${open ? '▾' : '▸'} ${n || '—'}</button>`;
    };
    const sysPicker = (x, i) => {
      if (ctx.openClassSystems !== i) return '';
      const on = new Set(x.systems || []);
      const known = new Set(GAME_SYSTEMS.map((s) => s.id));
      const extra = [...on].filter((id) => !known.has(id));
      return `<tr class="syspicker"><td colspan="11">
        <p class="hint" style="margin:2px 0 6px">
          The sub-systems ${esc(x.name || 'this class')} uses. Their tabs are marked on the ⚙ tab
          and shown on the session view's bar.
        </p>
        <div class="pair" style="flex-wrap:wrap">
          ${GAME_SYSTEMS.map((s) => `<button data-action="class-system-toggle" data-index="${i}"
            data-system="${s.id}" aria-pressed="${on.has(s.id)}">${esc(s.label)}</button>`).join('')}
          ${extra.map((id) => `<button data-action="class-system-toggle" data-index="${i}"
            data-system="${esc(id)}" aria-pressed="true"
            title="A system from an extension pack that has no tab in this app.">${esc(id)}</button>`).join('')}
        </div>
      </td></tr>`;
    };
    return `<section class="panel span2" data-home="classes">
      <h3>Classes</h3>
      <div class="tablewrap squeeze"><table class="classes stacked cardrows">
        <colgroup><col class="cls"><col class="lvl"><col class="hd"><col class="bab">
          <col class="save"><col class="save"><col class="save">
          <col class="ranks"><col class="arch"><col class="sys"><col class="tools"></colgroup>
        <thead><tr>
          <th>Class</th>
          <th class="num" title="The number of levels in this class, from the Planner. Saves, hit points, BAB and casting use it. Type a number to override it.">Levels</th>
          <th class="num">HD</th>
          <th title="Base attack progression. The character's BAB uses the best one at each level.">BAB</th>
          <th class="mid" title="Good Fortitude">Fort</th><th class="mid" title="Good Reflex">Ref</th><th class="mid" title="Good Will">Will</th>
          <th class="num" title="Skill ranks per level">Ranks</th>
          <th>Archetypes</th>
          <th title="The sub-systems this class uses.">Systems</th><th></th>
        </tr></thead>
        <tbody>${c.classes.map((x, i) => {
          const over = x.levelsOverride == null ? null : Number(x.levelsOverride);
          // What the box goes back to when cleared: the Planner's rows, or
          // every level when the Planner never names the class.
          const planned = plannedLevels(model, x.name, level).filter(Boolean).length;
          const auto = planned || level;
          const from = planned
            ? `the Planner lists it on ${planned} of ${level} level${level === 1 ? '' : 's'}`
            : `the Planner does not list it, so it counts every level (${level})`;
          // Levels a prestige class adds as an aligned class, which count for
          // class features and not here.
          const aligned = aligns.filter((s) => s.class === x.name && s.level <= level);
          const from2 = [...new Set(aligned.map((s) => s.prestige))];
          const extra = aligned.length
            ? ` ${from2.join(' and ')} add${from2.length === 1 ? 's' : ''} ${aligned.length} aligned level${aligned.length === 1 ? '' : 's'} for class features.`
            : '';
          const why = over == null
            ? `${from[0].toUpperCase()}${from.slice(1)}. Type a number to override it.${extra}`
            : `Set to ${over}. If cleared, ${from}.${extra}`;
          return `<tr>
          <td data-stack="name">${itemText('classes', i, 'name', x.name)}</td>
          <td class="num" data-label="Levels" data-inline="spec">${autoNum(`data-item="classes|${i}|levelsOverride"`, over, {
    auto: true, placeholder: auto, title: why, label: `Levels of ${x.name || 'this class'}`,
  })}</td>
          <td class="num" data-label="Hit die" data-inline="spec">${progressionSelect(i, 'hd', x.hd,
    HIT_DICE.map((d) => [d, `d${d}`]), `Hit die for ${x.name || 'this class'}`, (d) => `d${d}`,
    { count: x.gestaltBeaten?.hd, levels: x.gestaltBeaten?.levels, noun: 'hit die' })}</td>
          ${/* The progression, not a bonus: what the class adds to BAB per level.
              Kept as the fraction the rules state it in, because that is what
              the gestalt sum adds up and floors. */ ''}
          <td data-label="BAB" data-inline="spec">${progressionSelect(i, 'bab', x.bab, BAB_RATES,
    `BAB progression for ${x.name || 'this class'}`, String,
    { count: x.gestaltBeaten?.bab, levels: x.gestaltBeaten?.levels, noun: 'progression' })}</td>
          <td class="mid" data-label="Good Fort" data-inline="save">${itemCheck('classes', i, 'goodFort', x.goodFort)}</td>
          <td class="mid" data-label="Good Ref" data-inline="save">${itemCheck('classes', i, 'goodRef', x.goodRef)}</td>
          <td class="mid" data-label="Good Will" data-inline="save">${itemCheck('classes', i, 'goodWill', x.goodWill)}</td>
          ${/* Ranks is the fourth of the four numbers a class advances at, and
                sits after the saves only because that is the column order. The
                card puts it back with the other three; see `data-inline` in the
                stylesheet, which groups by `order` rather than by markup so the
                table's columns are left alone. */''}
          <td class="num" data-label="Ranks" data-inline="spec">${itemNum('classes', i, 'skillRanks', x.skillRanks)}</td>
          <td data-label="Archetypes">${(Array.isArray(x.archetypeStack) && x.archetypeStack.length) ? `<span class="pills">${x.archetypeStack.map((a) => `
            <span class="pill" title="${esc(`${a.name}: an archetype from an extension pack.${a.removedCells?.length ? ` Replaced ${[...new Set(a.removedCells.map((r) => r.name))].join(', ')}.` : ''}${a.touches?.length ? ` Changes: ${a.touches.join(', ')}.` : ''} × removes it and restores the class's features.`)}">
              ${esc(a.name)}${removeAction('arch-remove', { class: x.name, name: a.name }, { what: a.name })}
            </span>`).join('')}</span>` : ''}${itemText('classes', i, 'archetypes', x.archetypes)}</td>
          <td class="mid" data-label="Systems">${sysButton(x, i)}</td>
          ${rowTools('classes', i)}
        </tr>${sysPicker(x, i)}`;
        }).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton('classes', 'Add class', blankClassRow())}</div>
      <div class="fieldgrid" style="margin-top:8px">
        <div class="statline"><span class="label">Save bases${gestalt ? ' (gestalt)' : ''}</span>
          <span class="value">Fort ${sv('fortitude').base ?? 0} &middot;
            Ref ${sv('reflex').base ?? 0} &middot; Will ${sv('will').base ?? 0}</span></div>
        <div class="statline"><span class="label">Base attack bonus${gestalt ? ' (gestalt)' : ''}</span>
          <span class="value" title="${esc(`${g.babPerLevel ?? 0} per level, ${core ? 'each class rounded down separately' : 'summed and rounded down once'}${
    c.attack?.babOverride == null ? '' : `. Set to ${c.attack.babOverride} in the Attack panel on the Stats tab`}.`)}"
            >+${esc(g.bab ?? 0)}${c.attack?.babOverride == null ? '' : ` <span class="badge">pinned +${esc(c.attack.babOverride)}</span>`}</span></div>
        <div class="statline"><span class="label">HP / level${gestalt ? ' (best HD)' : ''}</span>
          <span class="value">d${g.hpPerLevel || 0}</span></div>
        <div class="statline"><span class="label">Hit points from these classes</span>
          <span class="value" title="${esc(`${g.hdTotal ?? 0} from hit dice over ${level} level${level === 1 ? '' : 's'}, before Con, favored class, Toughness and mythic tiers.`)}"
            >${g.hdTotal ?? 0} &rarr; ${g.hp?.base ?? 0} total</span></div>
        ${core ? `<div class="statline"><span class="label">Skill ranks from classes</span>
          <span class="value" title="Each class's ranks per level, times its levels.">${g.ranksTotal || 0}</span></div>`
    : `<div class="statline"><span class="label">Skill ranks / level${gestalt ? ' (best)' : ''}</span>
          <span class="value">${g.ranksPerLevel || 0}</span></div>`}
      </div>
      <p class="hint">
        ${gestalt ? `Gestalt: each level uses the best progression among the classes at that level,
        from the Planner. Good saves give +2 once plus &frac12; per level. Poor saves give &#8531; per level.`
    : core ? `One class per level, from the Planner's first track. Each class's good saves give +2 plus
        &frac12; per level and poor saves &#8531; per level, and each class's base attack bonus is rounded
        down separately.${idle.length ? ` <strong>${esc(idle.join(', '))}</strong>
        ${idle.length === 1 ? 'has' : 'have'} no levels: add ${idle.length === 1 ? 'it' : 'them'} to the Planner's first track, or type a level count here.` : ''}`
      : `Good saves give +2 once plus &frac12; per level. Poor saves give &#8531; per level.`}
        The Saves, Attack and Hit points panels on the Stats tab use these bases.${gestalt
    ? ` A hit die or progression that another class already beats has no effect; hover over it
        to see why.` : ''}
      </p>
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
      return `<tr class="${locked ? 'lockedslot' : ''}${owed ? ' needsfill' : ''}"${owed ? ' title="Empty trait slot."' : ''}>
        <td data-stack="head">${esc(def.label)}${def.requires ? `<div class="hint">needs ${esc(TRAIT_SLOTS.find((s) => s.key === def.requires)?.label)}</div>` : ''}</td>
        <td data-label="Category">${isDrawback ? '<span class="hint">—</span>'
          : select(`traitSlots.${def.key}.category`, v.category, categories)}</td>
        <td data-stack="name">${text(`traitSlots.${def.key}.name`, v.name, wants || (isDrawback ? 'Drawback' : 'Trait'))}</td>
        <td data-label="Trait / effect">${foldingNote(model, `data-set="traitSlots.${def.key}.text"`, v.text,
    `traitSlots.${def.key}.text`, { name: v.name })}</td>
      </tr>`;
    };

    const race = c.raceTraits || [];
    // Two panels side by side in a band, each folding on its own, rather
    // than two lists inside one panel.
    const traitsHtml = `<section class="panel traitspanel" data-home="traits">
      <h3>Traits &amp; drawbacks
        <span class="badge${picked < standard.length ? ' err' : ' ok'}">${picked} of ${standard.length} picked</span>
      </h3>
          <div class="tablewrap squeeze"><table class="traits stacked">
            <colgroup><col class="slot"><col class="cat"><col class="tname"><col class="effect"></colgroup>
            <thead><tr><th>Slot</th><th>Category</th><th>Name</th><th>Trait / effect</th></tr></thead>
            <tbody>
              ${TRAIT_SLOTS.filter((s) => s.kind !== 'feat').map(row).join('')}
              ${(slots.additional || []).map((x, i) => `<tr>
                <td data-stack="head">Additional</td>
                <td data-label="Category">${itemSelect('traitSlots.additional', i, 'category', x.category, categories)}</td>
                <td data-stack="name">${itemText('traitSlots.additional', i, 'name', x.name, 'Trait')}</td>
                <td data-label="Trait / effect"><div class="pair" style="flex-wrap:nowrap;align-items:flex-start">
                  <div style="flex:1 1 auto;min-width:0">${foldingNote(model, `data-item="traitSlots.additional|${i}|text"`, x.text,
    `traitSlots.additional|${i}|text`, { name: x.name })}</div>
                  ${removeButton('traitSlots.additional', i, { what: 'trait slot' })}
                </div></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
          <div style="margin-top:8px" class="pair">
            ${addButton('traitSlots.additional', 'Add additional trait', { category: null, name: '', text: '' })}
            <input data-draft="traitCategory" placeholder="New category (e.g. Akashic)"
              value="${esc(ctx.draft?.traitCategory || '')}" style="width:14rem;max-width:100%">
            <button data-action="add-trait-category">Add category</button>
          </div>
          <p class="hint">
            Traits 1–3 are the standard picks. Drawback 1 unlocks Trait 4. Drawback 2 unlocks
            Trait 5. A Major Drawback gives a Drawback Feat, listed under <strong>Granted feats</strong>
            on the Feats &amp; Mythic tab. You can add categories to the standard list.
          </p>
    </section>`;
    const raceHtml = `<section class="panel racepanel" data-home="race-traits">
      <h3>Race traits
        <span class="badge">${race.filter((t) => String(t.name || '').trim() || String(t.text || '').trim()).length}${race.some((t) => !String(t.name || '').trim() && !String(t.text || '').trim()) ? ` of ${race.length}` : ''}</span>
        ${c.identity.race ? `<span class="hint">${esc(c.identity.race)}${c.identity.variant ? ` (${esc(c.identity.variant)})` : ''}</span>` : ''}
      </h3>
          <div class="tablewrap"><table class="racetraits stacked">
            <thead><tr><th>Trait</th><th>Effect</th><th></th></tr></thead>
            <tbody>${race.map((t, i) => `<tr${String(t.name || '').trim() || String(t.text || '').trim() ? '' : ' class="needsfill" title="Empty race trait slot."'}>
              <td data-stack="name">${itemText('raceTraits', i, 'name', t.name, 'Darkvision')}${Array.isArray(t.replaced) && t.replaced.length
    ? ` <span class="badge player" title="${esc(`Alternate racial trait that replaced ${t.replaced.map((r) => r.name).join(' and ')}. Removing it does not restore them; add them again from the race's pack.`)}">alt</span>` : ''}</td>
              <td data-label="Effect">${foldingNote(model, `data-item="raceTraits|${i}|text"`, t.text, `raceTraits|${i}|text`, { name: t.name })}</td>
              ${rowRemove('raceTraits', i, { what: 'race trait' })}
            </tr>`).join('')}
            ${race.length ? '' : '<tr><td colspan="3" class="empty">No race traits yet.</td></tr>'}
            </tbody>
          </table></div>
          <div style="margin-top:8px">${addButton('raceTraits', 'Add race trait', { name: '', text: '' })}</div>
          <p class="hint">Traits the race grants. Add alternate racial traits here in place of the
            traits they replace.</p>
    </section>`;
    return `<div class="band lead">
      ${collapsible(model, 'traits', traitsHtml)}
      ${collapsible(model, 'race-traits', raceHtml)}
    </div>`;
  }
