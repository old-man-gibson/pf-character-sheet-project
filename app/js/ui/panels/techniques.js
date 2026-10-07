/**
 * ui/panels/techniques.js -- Technique List, AutoTechnique and Auto-Cooking.
 *
 * The workbook's technique layout, drawn once for both technique tabs, and
 * the iron chef's dish. Each reproduces its own workbook tab's formulas.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import * as fields from '../fields.js';
import * as rows from '../rows.js';
import {
  TECHNIQUE_SLOTS, TECHNIQUE_STATUSES, techniqueTitle,
  COOKING_COURSES, cookingTables, cookingDish, normalizeDish, emptyDish,
} from '../../model.js';

/**
 * The workbook's technique layout, drawn once for both tabs: the name row,
 * the three sphere rows with their talent grids beside them, the numbers the
 * formulas derive, range and saves, and the four description lines.
 *
 * On the Technique List every field is read off the catalogue (a technique
 * is edited by copying it to AutoTechnique and adding it back); on
 * AutoTechnique every field writes to `techniques.draft`.
 */
function techniqueSheet(model, ctx, view, { editable = false, path = 'techniques.draft', mode = 'list' } = {}) {
    const t = view.technique;
    const s = view.stats;
    const ro = (v) => fields.roField(v);
    const cell = (field, value, opts = {}) => (editable
      ? fields.text(`${path}.${field}`, value, opts.placeholder || '')
      : ro(value));
    const spheres = (key, label, talentKey, talentLabel) => `
      <tr class="sphererow">
        <th>${label}</th>
        ${t[key].map((v, i) => `<td>${cell(`${key}.${i}`, v, { placeholder: 'sphere' })}</td>`).join('')}
      </tr>
      <tr class="talentrow">
        <th>${talentLabel}</th>
        <td colspan="${TECHNIQUE_SLOTS.spheres}">
          <div class="talentgrid">
            ${t[talentKey].map((p, i) => `<div class="talent">
              ${editable
    ? fields.select(`${path}.${talentKey}.${i}.sphere`, p.sphere, t[key].filter(Boolean), '—')
    : ro(p.sphere)}
              ${cell(`${talentKey}.${i}.talent`, p.talent, { placeholder: 'talent' })}
            </div>`).join('')}
          </div>
        </td>
      </tr>`;

    const stat = (label, value, hint = '') => `<div class="statline">
      <span class="label" ${hint ? `title="${esc(hint)}"` : ''}>${label}</span>
      <span class="value">${esc(value)}</span></div>`;

    const numbers = `
      <div class="techstats">
        <div>
          ${stat('Complexity', s.complexity, 'base talents, +(distinct − 2) past two, + every talent named')}
          ${stat('Base Talents', s.baseText, 'distinct spheres and other entries, less any Feat')}
          ${stat('Total Talents', s.totalText)}
          ${stat('Crafting Skill', t.craftingSkill)}
        </div>
        <div>
          ${stat('Crafting Time', `${s.craftingTime} days`, '1 + complexity')}
          ${stat('Effective Time (−⅓ days)', `${s.effectiveTime} days`)}
          ${stat('Crafting DC', s.craftDC, '5 + 5 × complexity')}
          ${stat('Decipher DC', s.decipherDC, '20 + complexity')}
          ${stat('Learn DC', s.learnDC, '10 + 2 × complexity')}
        </div>
        <div>
          ${stat('Technique Prowess', s.prowessText, 'Yes when the technique uses no magic sphere')}
          ${stat('Effective Complexity', s.effective, mode === 'auto'
    ? 'complexity + Instant Initiation + Versatile − Signature − Adept Initiator'
    : 'with prowess: complexity − 1 − ⌊BAB/5⌋ − Adept Initiator; else complexity − Adept Initiator')}
          ${stat('Other SP Cost', t.extraSp === '' ? '—' : t.extraSp)}
          ${stat('Total SP Cost', s.totalSp, 'effective complexity + other SP cost')}
          ${stat('Other Cost', t.otherCost || '—')}
        </div>
      </div>`;

    const flags = mode === 'auto' ? `<div class="techflags">
        ${fields.check(`${path}.instantInitiation`, t.instantInitiation, 'Instant Initiation (+1)')}
        <label class="pair"><span>Versatile Technique</span>${fields.num(`${path}.versatile`, t.versatile, 'min="0"')}</label>
        ${fields.check(`${path}.signature`, t.signature, 'Signature Technique (−1)')}
        <span class="hint">These are the AutoTechnique tab's crafting choices; they move Effective Complexity and nothing else.</span>
      </div>` : '';

    return `
      <div class="tablewrap"><table class="techsheet">
        <tr>
          <th>Technique Name</th>
          <td>${cell('prepend1', t.prepend1, { placeholder: 'style / prefix' })}</td>
          <td>${cell('prepend2', t.prepend2, { placeholder: 'e.g. Counter' })}</td>
          <td colspan="3" class="techname">${cell('name', t.name, { placeholder: 'technique name' })}</td>
        </tr>
        ${spheres('combatSpheres', 'Combat Spheres', 'combatTalents', 'Combat Talents')}
        ${spheres('magicSpheres', 'Magic Spheres', 'magicTalents', 'Magic Talents')}
        ${spheres('others', 'Other', 'otherFeatures', 'Other Features')}
      </table></div>
      ${flags}
      ${editable ? `<div class="fieldgrid" style="margin-top:8px">
        <label class="fld"><span>Crafting Skill</span>${fields.text(`${path}.craftingSkill`, t.craftingSkill, 'Kn. (martial)')}</label>
        <label class="fld"><span>Other SP Cost</span>${fields.text(`${path}.extraSp`, t.extraSp, '')}</label>
        <label class="fld"><span>Other Cost</span>${fields.text(`${path}.otherCost`, t.otherCost, 'e.g. Martial focus')}</label>
      </div>` : ''}
      ${numbers}
      <div class="tablewrap"><table class="techsheet">
        <tr>
          <th>Range</th><td colspan="2">${cell('range', t.range)}</td>
          <th>Duration</th><td colspan="2">${cell('duration', t.duration)}</td>
        </tr>
        <tr>
          <th>Saving Throw</th>
          ${t.saves.map((p, i) => `<td>${cell(`saves.${i}.save`, p.save, { placeholder: i ? '' : 'None' })}</td>`).join('')}
          <th>Target</th><td>${cell('target', t.target)}</td>
        </tr>
        <tr>
          <th>Saving Throw Type</th>
          ${t.saves.map((p, i) => `<td>${cell(`saves.${i}.type`, p.type, { placeholder: 'e.g. Halves' })}</td>`).join('')}
          <th>Spell Resistance</th><td>${cell('spellResistance', t.spellResistance, { placeholder: 'No' })}</td>
        </tr>
      </table></div>
      <div class="techdesc">
        ${t.descriptions.map((d, i) => `<label class="fld tall"><span>Description ${i + 1}</span>
          ${editable ? fields.area(`${path}.descriptions.${i}`, d, 3) : `<div class="ro-text">${esc(d) || '<span class="empty">—</span>'}</div>`}
        </label>`).join('')}
      </div>`;
}

/** The Discord application under a technique, and a button that copies it. */
function techniqueExportBox(model, ctx, text, id) {
    return `<section class="panel span2">
      <h3>Discord application
        <span class="pair" style="margin-left:auto">
          <button data-action="copy-text" data-copy="${id}">Copy for Discord</button>
        </span>
      </h3>
      <p class="hint">The workbook's application text — character, what is applied for, and the technique in a code block. Paste it as-is.</p>
      <textarea id="${id}" class="exportbox" readonly rows="14" spellcheck="false">${esc(text)}</textarea>
    </section>`;
}

export function renderTechniqueListPanel(model, ctx) {
    const block = model.data.techniques || { catalogue: [], selected: '', draft: null };
    const cat = block.catalogue;
    const byStatus = {};
    for (const t of cat) byStatus[t.status || '—'] = (byStatus[t.status || '—'] || 0) + 1;
    const selected = cat.find((t) => t.name === block.selected) || cat[0] || null;
    const idx = selected ? cat.indexOf(selected) : -1;
    const view = selected ? model.techniqueView(selected, 'list') : null;
    const options = cat.map((t) => [t.name, `${techniqueTitle(t)}${t.status ? ` · ${t.status}` : ''}`]);
    const statuses = [...new Set([...TECHNIQUE_STATUSES, ...cat.map((t) => t.status).filter(Boolean)])];

    return `<div class="grid">
      <section class="panel span2">
        <h3>Technique List
          ${Object.entries(byStatus).map(([k, n]) => `<span class="badge">${esc(k)} ${n}</span>`).join('')}
        </h3>
        <p class="hint">
          Every technique on the character's <code>techRef</code>, read one at a time as the
          workbook's tab does. The list is read-only apart from the approval status; to
          change a technique, copy it to AutoTechnique, edit it there and add it back — the
          same name replaces the entry. Missing techniques — a character imported before the
          catalogue was read, or new ones on the sheet — come in with
          <strong>Import from workbook</strong>: only the techniques are taken, nothing else
          on this character changes.
          <button data-action="tech-import" title="Merge the techniques from a .xlsx export of the workbook into this list">Import from workbook…</button>
          <input type="file" accept=".xlsx,.xlsm" data-techfile hidden>
        </p>
        <div class="pair techpick">
          <select data-action="tech-select" aria-label="Technique">
            ${cat.length ? '' : '<option value="">No techniques yet</option>'}
            ${options.map(([v, l]) => `<option value="${esc(v)}" ${selected?.name === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
          ${selected ? `
            <label class="pair"><span class="hint">Approval Status</span>
              ${fields.select(`techniques.catalogue.${idx}.status`, selected.status, statuses, '—')}
            </label>
            <label class="pair"><span class="hint">Type</span>${fields.text(`techniques.catalogue.${idx}.subschool`, selected.subschool, 'e.g. Electric')}</label>
            <button data-action="tech-to-draft" data-name="${esc(selected.name)}" title="Copy this technique into AutoTechnique to edit it">Copy to AutoTechnique</button>
            ${rows.removeAction('tech-remove', { name: selected.name }, { what: selected.name, title: 'Remove from the list' })}` : ''}
        </div>
      </section>
      ${view ? `<section class="panel span2">
        <h3>${esc(techniqueTitle(selected))}
          ${selected.status ? `<span class="badge ${/known|approved/i.test(selected.status) ? 'ok' : ''}">${esc(selected.status)}</span>` : ''}
          ${selected.subschool ? `<span class="badge">${esc(selected.subschool)}</span>` : ''}
        </h3>
        ${techniqueSheet(model, ctx, view, { editable: false, mode: 'list' })}
      </section>
      ${techniqueExportBox(model, ctx, view.export, 'techListExport')}` : `<section class="panel span2">
        <p class="empty">Nothing to show. Design a technique on the AutoTechnique tab and add it here.</p>
      </section>`}
    </div>`;
}

export function renderAutoTechniquePanel(model, ctx) {
    const block = model.data.techniques || { catalogue: [], selected: '', draft: null };
    const view = model.techniqueView(block.draft, 'auto');
    const t = view.technique;
    const exists = !!t.name && block.catalogue.some((x) => x.name === t.name);
    return `<div class="grid">
      <section class="panel span2">
        <h3>AutoTechnique
          <span class="pair" style="margin-left:auto">
            <button class="primary" data-action="tech-add" ${t.name ? '' : 'disabled'}
              title="${exists ? 'Replace the technique of this name on the list' : 'Add to the Technique List'}">
              ${exists ? 'Update on Technique List' : '+ Add to Technique List'}</button>
            <button data-action="tech-new" title="Clear the form">New</button>
          </span>
        </h3>
        <p class="hint">
          Design a technique: name it, pick its spheres and the talents each contributes,
          and the complexity, DCs and SP cost work themselves out as the workbook's
          formulas do. <strong>Add to Technique List</strong> puts it on the list (the
          workbook's <code>techRef</code>); the application below is ready to paste.
        </p>
        ${techniqueSheet(model, ctx, view, { editable: true, path: 'techniques.draft', mode: 'auto' })}
      </section>
      ${techniqueExportBox(model, ctx, view.export, 'autoTechExport')}
    </div>`;
}

export function renderCookingPanel(model, ctx) {
    const dish = model.data.cooking || emptyDish();
    const view = model.cookingView();
    const tables = cookingTables();
    const levelText = dish.level === null ? '' : dish.level;
    return `<div class="grid">
      <section class="panel span2">
        <h3>Iron Chef Dish Maker
          <span class="badge">Duration: ${view.hours} hours</span>
          <span class="pair" style="margin-left:auto">
            <button data-action="cook-clear" title="Empty the plate">Clear dish</button>
          </span>
        </h3>
        <p class="hint">
          Bryva's iron chef ability, for anyone at the table: pick the courses, and each
          ingredient's effect is worked out for the chef's level and the combination — a
          Red Meat entree strengthens Apples and Potatoes, Rice counts the recipe as three
          levels higher, and so on. Duration is ⌊level ÷ 3⌋ + 1 hours.
        </p>
        <div class="fieldgrid" style="margin-bottom:10px">
          <label class="fld"><span>Iron chef level</span>
            <input type="number" min="1" max="20" value="${esc(levelText)}" data-set="cooking.level" data-kind="number-or-null"
              placeholder="${Number(model.data.identity?.level) || ''}" title="Blank uses this character's level"></label>
          <label class="fld"><span>Chef</span>${fields.text('cooking.chef', dish.chef, String(model.data.identity?.name || 'the chef'))}</label>
          <label class="fld"><span>Dish name</span>${fields.text('cooking.dishName', dish.dishName, 'optional')}</label>
        </div>
        <div class="tablewrap"><table class="techsheet cooksheet">
          ${COOKING_COURSES.map(([key, label]) => `<tr>
            <th>${label}</th>
            ${dish[key].map((v, i) => `<td>${fields.select(`cooking.${key}.${i}`, v, tables[key].map((x) => [x.name, x.name]), '—')}</td>`).join('')}
          </tr>`).join('')}
        </table></div>
      </section>

      <section class="panel span2">
        <h3>What the meal does</h3>
        ${view.effects.length ? `<ul class="dishlist">
          ${view.effects.map((e) => `<li>
            <span class="badge">${esc(e.course)}</span> <strong>${esc(e.name)}</strong>
            ${e.unknown ? '<span class="badge err">not in the ingredient list</span>' : ''}
            <div>${esc(e.text)}</div>
            ${e.combo ? `<div class="hint">Combo: ${esc(e.combo)}</div>` : ''}
          </li>`).join('')}
        </ul>` : '<p class="empty">An empty plate. Pick some ingredients above.</p>'}
      </section>

      <section class="panel span2">
        <h3>For Discord
          <span class="pair" style="margin-left:auto">
            <button data-action="copy-text" data-copy="cookExport">Copy for Discord</button>
          </span>
        </h3>
        <textarea id="cookExport" class="exportbox" readonly rows="10" spellcheck="false">${esc(view.export)}</textarea>
      </section>

      ${rows.collapsible(model, 'cooking-ref', `<section class="panel span2">
        <h3>Ingredient list <span class="badge">at level ${view.level}</span></h3>
        <p class="hint">Every ingredient and what it grants at the chef's level above, with the combos that raise it.</p>
        <div class="tablewrap"><table class="gridtab dishref">
          ${COOKING_COURSES.map(([key, label]) => tables[key].map((x, i) => {
    const one = normalizeDish({ level: view.level, [key]: [x.name] });
    const resolved = cookingDish(one, { level: view.level }).effects[0]?.text || '';
    return `<tr>${i === 0 ? `<th rowspan="${tables[key].length}">${label}</th>` : ''}
              <td class="ingname">${esc(x.name)}</td><td>${esc(resolved)}${x.combo ? `<div class="hint">Combo: ${esc(x.combo)}</div>` : ''}</td></tr>`;
  }).join('')).join('')}
        </table></div>
      </section>`)}
    </div>`;
}
