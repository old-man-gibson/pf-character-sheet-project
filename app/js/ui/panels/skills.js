/**
 * ui/panels/skills.js -- the Skills tab.
 *
 * The template's skill list, in the template's order: rows are never reordered
 * or deleted, only hidden, so a sheet's skills always line up with the workbook
 * they came from. What the panel adds around that is the ranks, the variant a
 * Craft or a Perform needs, the forwarded bonuses that land on a row, and a d20
 * per row.
 *
 * `ctx` is the element state the panel reads -- here only whether the
 * unused-skill filter has been switched off. Everything else it imports.
 */
import { esc } from '../html.js';
import { field, num, select } from '../fields.js';
import { addButton, exprField, itemCheck, itemSelect, itemText } from '../rows.js';
import { forwardedBadge } from '../badges.js';
import { rollButton } from '../roll.js';
import {
  fmt, skillLabel, skillVariantKind, skillVariantRoot, PERFORM_CATEGORIES,
  ABILITIES, ABILITY_LABELS, BACKGROUND_SKILLS, VARIANT_SKILLS,
} from '../../rules.js';
import { skillForwardKey } from '../../model.js';

export function renderSkillsPanel(model, ctx) {
  /**
   * The Skill cell: the skill and its variant, as one name.
   *
   * The skill itself is a fixed label -- the Pathfinder list is what it is, and
   * a row imported from the sheet is not a thing to rename. What is open is the
   * variant, and only on the skills that have one: Artistry, Craft, Lore and
   * Profession as free text, Perform as its nine categories. The parentheses
   * are drawn around the control so the cell reads as the whole name,
   * Craft ( Weapons and Armor ), and a player who types that whole thing in
   * has the skill's own name cleaned back off.
   *
   * A skill the player added is the exception: it has no name yet, so that one
   * is editable, which is also how a fifth Craft or a new Lore gets made.
   */
  function skillNameCell(s, i) {
    const name = s.custom
      ? itemText('skills', i, 'name', s.name, 'Skill name')
      : `<span class="sname" title="${esc(skillLabel(s.name, s.spec))}">${esc(s.name)}</span>`;
    return `<span class="skillcell">${name}${variantSlot(s, i)}</span>`;
  }

  /** The editable variant, for the skills that have one. */
  function variantSlot(s, i) {
    const kind = skillVariantKind(s.name);
    if (!kind) {
      // No slot to fill, but never hide a variant an import brought in.
      return s.spec
        ? `<span class="novariant">(${esc(s.spec)})</span>`
        : '';
    }
    const root = skillVariantRoot(s.name);
    const control = kind === 'perform'
      ? itemSelect('skills', i, 'spec', s.spec,
        PERFORM_CATEGORIES.map(([c, examples]) => [c, c, examples]), 'pick one')
      : `<input type="text" value="${esc(s.spec ?? '')}" data-item="skills|${i}|spec" data-kind="text"
          placeholder="which one?"
          title="${esc(`Which ${root}? Reads as "${skillLabel(s.name, s.spec || '…')}" — typing the whole thing works too.`)}">`;
    return `<span class="variant ${s.spec ? '' : 'empty'}">${control}</span>`;
  }

    const skills = model.data.skills || [];
    // Read once: every row's d20 asks what the ticked conditions do to it.
    const cs = model.conditionState;
    const inUse = (s) => s.totalRanks > 0 || s.offset || s.spec || s.custom;
    // A character with no ranks anywhere -- one just started from a blank
    // sheet -- would otherwise open on an empty table with nothing to fill in,
    // so the unused-skill filter only applies once there is something it keeps.
    const showAll = ctx.showAllSkills || !skills.some(inUse);
    // The list is the template's, in the template's order: rows are not
    // reordered or deleted, only hidden -- the eye at the end of each row --
    // and a hidden skill comes back under Show all, eye closed, to be reopened.
    const rows = skills
      .map((s, i) => ({ s, i }))
      // A skill the player just added has nothing in it yet, so it needs the
      // custom flag to survive the unused-skill filter and be fillable at all.
      .filter(({ s }) => ctx.showAllSkills || (!s.hidden && (showAll || inUse(s))));
    const hiddenCount = skills.filter((s) => s.hidden).length;
    const key = (s) => `${s.name}|${s.spec || ''}`;
    const label = (s) => skillLabel(s.name, s.spec);
    const spec = model.data.specialtySkills || {};

    const pickOptions = (filter) => skills
      .filter(filter)
      .map((s) => [key(s), label(s)]);
    const isKn = (s) => /^(Kn\.|Knowledge|Lore)/i.test(s.name);
    const isBg = (s) => BACKGROUND_SKILLS.some((b) => s.name === b || s.name.startsWith(b));

    const b = model.data.skillBudget || {};
    const budgetClass = b.status === 'error' ? 'err' : b.status === 'warning' ? 'warn' : 'ok';

    return `<div class="grid">
      <section class="panel span2">
        <h3>Skill points
          <span class="badge ${budgetClass === 'err' ? 'err' : budgetClass === 'ok' ? 'ok' : ''}">
            ${b.assigned ?? 0} / ${b.available ?? 0} assigned</span>
        </h3>
        <div class="fieldgrid">
          ${field('Class ranks / level (gestalt)', `<span class="value">${model.data.gestalt?.ranksPerLevel ?? 0}</span>`)}
          ${field('Int bonus / level', num('skillBudget.intPerLevel', b.intPerLevel))}
          ${field('Bonus points / level', num('skillBudget.bonusPerLevel', b.bonusPerLevel))}
          ${field('Total / level', `<span class="value">${b.perLevel ?? 0}</span>`)}
        </div>
        ${b.status === 'error' ? `<p class="hint warn"><strong>Too many ranks assigned:</strong>
            ${b.assigned} bought, only ${b.available} available (${-b.remaining} over).</p>`
    : b.status === 'warning' ? `<p class="hint" style="color:var(--cs-edit)">
            ${b.remaining} skill point(s) unspent.</p>`
      : '<p class="hint" style="color:var(--cs-good)">Every skill point is spent.</p>'}
        <p class="hint">
          Only <strong>Bought</strong> ranks count against the budget — specialty, gear,
          Other and sphere ranks are free. Int bonus/level is a flat metric (retroactive
          Int increases don't refund ranks unless your table rules otherwise).
        </p>
      </section>

      <section class="panel span2">
        <h3>Specialty skills</h3>
        <div class="fieldgrid">
          ${field('Knowledge / Lore skill', select('specialtySkills.knowledge', spec.knowledge, pickOptions(isKn)))}
          ${field('Background skill', select('specialtySkills.background', spec.background, pickOptions(isBg)))}
          ${field('Free choice', select('specialtySkills.free', spec.free, pickOptions(() => true)))}
        </div>
        <p class="hint">
          Each specialty skill gets full ranks for your level, like the sheet's Specialty
          column. Marked with ★ in the table below.
        </p>
      </section>

      <section class="panel span2">
        <h3>Skills
          <span class="badge">${rows.length} of ${skills.length}</span>
          ${hiddenCount ? `<span class="badge" title="Hidden with the eye; Show all brings them back">${hiddenCount} hidden</span>` : ''}
          <button data-action="toggle-skills" style="margin-left:8px">
            ${ctx.showAllSkills ? 'Hide unused' : 'Show all'}
          </button>
        </h3>
        <div class="tablewrap">
          <table>
            <thead><tr>
              <th>Skill</th><th class="num">Total</th>
              <th class="num" title="Total ranks: min(level, bought + flags × level + spheres)">Ranks</th>
              <th title="Class skill: +3 once the skill has a rank">Class</th>
              <th class="num" title="Ranks bought with skill points">Bought</th>
              <th title="Specialty skill (full ranks)">★</th>
              <th title="Gear grants full ranks (e.g. headband)">Gear</th>
              <th title="Another source grants full ranks (class features, templates)">Other</th>
              <th class="num" title="From sphere talents">Spheres</th>
              <th>Ability</th><th class="num">Mod</th><th class="num">Misc</th>
              <th title="Requires training: no check at all without a rank in it">Trained only</th>
              <th>Notes</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map(({ s, i }) => `<tr class="${s.totalRanks > 0 ? 'trained' : 'untrained'}${s.hidden ? ' hiddenskill' : ''}">
                <td>${skillNameCell(s, i)}</td>
                <td class="num total"><span class="rollpair">${fmt(s.bonus)}${
                  rollButton(model, 'skill', i, `a ${skillLabel(s.name, s.spec) || 'skill'} check`, cs)}</span></td>
                <td class="num">${s.totalRanks}</td>
                <td class="mid">${itemCheck('skills', i, 'classSkill', s.classSkill)}</td>
                <td class="num bought">${exprField(`data-item="skills|${i}|rankSources.bought"`,
                  s.rankSources?.bought ?? 0, {
                    kind: 'rank',
                    width: '5.4rem',
                    value: s.boughtResolved,
                    error: s.boughtError,
                    title: 'Number or formula, e.g. level or floor(level-2)',
                  })}</td>
                <td class="mid">${s.specialtyFlag ? '★' : ''}</td>
                <td class="mid">${itemCheck('skills', i, 'rankSources.gear', s.rankSources?.gear)}</td>
                <td class="mid">${itemCheck('skills', i, 'rankSources.other', s.rankSources?.other)}</td>
                <td class="num">${s.sphereRanks || ''}</td>
                <td>${itemSelect('skills', i, 'abilities.0', (s.abilities || [])[0], ABILITIES.map((k) => ABILITY_LABELS[k]))}</td>
                <td class="num">${fmt(s.abilityMod || 0)}</td>
                <td class="num bought">${exprField(`data-item="skills|${i}|offset"`, s.offset ?? 0, {
                  kind: 'rank',
                  width: '5.4rem',
                  value: s.miscResolved,
                  error: s.miscError,
                  title: 'Number or formula, e.g. int.mod, skill_familiarity, floor(level/2)',
                })}${forwardedBadge(model, skillForwardKey(s))}</td>
                <td class="mid">${itemCheck('skills', i, 'requiresTraining', s.requiresTraining)}</td>
                <td>${itemText('skills', i, 'situational', s.situational)}</td>
                <td class="tools"><button data-action="toggle-skill-hidden" data-index="${i}" class="eye"
                  title="${s.hidden ? 'Hidden — show this skill again' : 'Hide this skill from the list'}"
                  aria-pressed="${!!s.hidden}" aria-label="${s.hidden ? 'Show skill' : 'Hide skill'}">${s.hidden ? '◌' : '👁'}</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px">
          ${addButton('skills', 'Add skill', {
            name: '', spec: '', bonus: 0, classSkill: false, totalRanks: 0,
            ranks: {}, requiresTraining: false, armorPenalty: false, abilities: ['Int'],
            situational: '', offset: 0, importedBonus: 0,
            rankSources: { bought: 0, gear: false, other: false }, ranksOffset: 0,
            // The player's own row: this is the one skill whose name they name.
            custom: true,
          })}
        </div>
        <p class="hint">
          Total ranks = min(level, Bought + (★ + Gear + Other) × level + Spheres).
          <strong>Spheres</strong> comes from the training tab's talent counts.
          <strong>Misc</strong> holds flat bonuses from gear, traits and the like — a number, or a
          formula such as <code>int.mod</code>, <code>floor(level/2)</code>, or a name defined
          in prose like <code>skill_familiarity</code>. A gold figure beside it is a bonus
          <em>forwarded</em> here from a feature that wrote
          <code>{skill.bluff += …}</code> — point at it to see which one.
        </p>
        <p class="hint">
          Only ${VARIANT_SKILLS.map((v) => `<strong>${esc(v)}</strong>`).join(', ')} and
          <strong>Perform</strong> take a variant — the highlighted slots. Write just the
          variant, or the whole <em>Craft (Weapons and Armor)</em>; either way the skill
          reads as one name. Perform is one of nine:
          ${PERFORM_CATEGORIES.map(([c, examples]) => `<span title="${esc(examples)}">${esc(c)}</span>`).join(', ')}.
          Every other skill is fixed; <strong>Add skill</strong> is where a new one — a
          further Craft, a homebrew — gets its own name.
        </p>
      </section>
    </div>`;
}
