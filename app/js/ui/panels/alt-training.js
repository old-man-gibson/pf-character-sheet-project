/**
 * ui/panels/alt-training.js -- the Alternate Training tab.
 *
 * The technique the character chose, the ladder of levels it advances on,
 * and what was taken at each one. The techniques come from whatever pack
 * supplies them; with none, the tab says so.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc } from '../html.js';
import { prose } from '../prose.js';
import { fillNotesButton, talentLegend, talentMark, foldingNote } from '../talents.js';
import {
  altTrainingLink, altTrainingNames, altTrainingRepeatFrom, altTrainingTechniques,
} from '../../model.js';
import { webUrl } from '../links.js';
import { hasTokens } from '../../inline.js';
import { select } from '../fields.js';
import { miniStat } from '../rows.js';

  /**
   * The technique, and the ladder it advances on.
   *
   * The workbook had this in four places and modelled it in none: the choice
   * is a dropdown on Character Info, and the ten levels it grants at are
   * printed on the Planner, on Vancian Magic and on Psionics -- three empty
   * copies of the same rows, none beside the choice they belong to. Here the
   * choice picks the ladder, the ladder states what each level hands over,
   * and the column beside it is what you took for it.
   *
   * The techniques themselves come from whatever pack supplies them (see
   * setAltTrainingTables): the panel draws the catalogue it is given, and an
   * empty one is a sentence saying so, never an error.
   */
export function altTrainingPanel(model) {
    const c = model.data;
    const p = c.altTraining || {};
    const k = p.calc || {};
    const level = Number(c.identity.level) || 0;
    const n = k.counts || {};
    // The tab is left off the bar with Alternate Training off (a campaign
    // rule); this is what stands in for it anywhere it is still drawn.
    if (k.off) {
      return `<section class="panel span2 mythicoff">
        <h3>Alternate Training <span class="badge">off</span></h3>
        <p class="hint">Alternate Training is off for this character in its campaign rules, so its
          technique grants nothing. What was picked here is kept, and counts again when it is turned
          on. <button data-view data-action="campaign-rules">Campaign rules…</button></p>
      </section>`;
    }

    const prereq = k.prereq;
    const prereqBadge = !prereq ? ''
      : `<span class="badge ${prereq.state === 'met' ? 'ok' : prereq.state === 'unmet' ? 'err' : ''}"
          title="${esc(prereq.detail || '')}">${
  prereq.state === 'met' ? 'prerequisite met'
    : prereq.state === 'unmet' ? 'prerequisite not met' : 'prerequisite unchecked'}</span>`;

    // Only the kinds this technique actually deals in: a ladder that grants
    // no spells has no business showing a spell count of zero.
    const totals = [
      ['Talents', n.talent, k.talents ? `${k.talents.count} ${k.talents.sphere} talents, counted into ${k.talents.side === 'magic' ? 'magic' : 'combat'} training` : ''],
      ['Feats', n.feat, 'Bonus feats granted so far'],
      ['Spells known', n.spell, 'Spells added so far'],
      ['Powers known', n.power, 'Powers added so far'],
    ].filter(([, v]) => v);

    return `<div class="grid">
      <section class="panel span2">
        <h3>Alternate Training Technique ${prereqBadge}
          ${n.due ? `<span class="badge due" title="Levels reached with nothing written against them">${n.due} to pick</span>` : ''}
        </h3>
        <div class="statbar">
          <label class="minifield">Technique
            ${select('altTraining.technique', p.technique,
    // A published document names a technique no pack here has; keep it listed.
    k.cited && k.technique ? [...new Set([...altTrainingNames(), k.technique])] : altTrainingNames(), '— none —')}</label>
          ${totals.map(([label, v, title]) => miniStat(label, v, title)).join('')}
          <span class="statbar-fill"></span>
          ${miniStat('Level', level, 'Grants above this level are planned, not counted')}
        </div>
        ${prereq ? `<p class="hint" style="margin-top:6px">
          <strong>Prerequisite:</strong> ${esc(prereq.text)}${prereq.detail ? ` — ${esc(prereq.detail)}` : ''}
          ${prereq.state === 'unmet' ? ' The technique still works here; this is a note, not a lock.' : ''}
        </p>` : ''}
        ${k.note ? `<p class="hint">${esc(k.note)}</p>` : ''}
        ${k.unknown ? `<p class="hint warn">The sheet names
          <strong>${esc(p.technique)}</strong>. That technique is not in the catalogue the active
          packs supply. The ladder below stays empty until the field names one that is.
          Whatever is written against a level is kept either way.</p>` : ''}
        <p class="hint">
          One technique, taken at 1st level or when its prerequisite is first met. It grants
          at 1st, 3rd, 5th, then ${k.repeatFrom ?? altTrainingRepeatFrom()}th and every two levels after.
          <strong>Grants</strong> is what the rules give at that level. The column beside it is what you
          took for it. It is filled in already on the levels where the rules name the grant. The last
          column is your note and takes formulas. A technique feat can be swapped under the Associated Feat
          rules if you are later given a feat for a sphere or talent you already have.
        </p>
      </section>

      ${k.technique ? altTrainingLadder(model, k) : altTrainingChooser()}

      <section class="panel span2">
        <h3>Notes</h3>
        ${prose(model, 'data-set="altTraining.notes"', p.notes, 3, 'grow')}
        <p class="hint">Resolves <code>{name = expr}</code> like any other prose field on the sheet.</p>
      </section>
    </div>`;
  }

  /** A grant's cite tag, linked where the pack, or the document's own copy, supplied a URL. */
function citeTag(cite, k = {}) {
    if (!cite) return '';
    const url = webUrl(altTrainingLink(cite) || k.links?.[cite]);
    return url
      ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(cite)}">[${esc(cite)}]</a>`
      : ` <span class="hint">[${esc(cite)}]</span>`;
  }

  /**
   * The granting levels, what each hands over, what was taken for it, and
   * a note beside that.
   *
   * The name and the note were one box until the levels the rules already
   * name had nowhere to put their own name and nothing to type but a note.
   * They are two columns now: the name column carries what the rules named
   * where they named it, and the note takes formulas the way every other
   * note on the sheet does.
   */
function altTrainingLadder(model, k) {
    // Whatever this technique calls the thing it hands over -- a talent, a
    // spell, a power, a feat. The repeating grant is the one that says it
    // seven times, so it is the one that names the column.
    const noun = k.repeat?.pick?.label || 'Taken';
    return `<section class="panel span2">
      <div class="tablewrap"><table class="build primordia stacked">
        <thead><tr>
          <th class="num">Lvl</th>
          <th class="grants">Grants</th>
          <th class="pickname" title="What you took — filled in already where the rules name it">${esc(noun)}</th>
          <th class="picknote">Notes</th>
        </tr></thead>
        <tbody>${(k.rows || []).map((row) => {
    const pick = row.pick;
    const state = !pick ? '' : row.due ? ' due' : row.filled ? '' : ' planned';
    return `<tr class="${row.reached ? '' : 'future'}">
          <td class="num" data-stack="head" data-headlabel="Level" title="${row.repeating ? `Every two levels from the ${k.repeatFrom}th` : `The technique's ${row.level}${row.level === 1 ? 'st' : row.level === 3 ? 'rd' : 'th'}-level grant`}">${row.level}</td>
          <td class="grants" data-label="Grants">${row.grants.map((g) => `
            <span class="grant"${row.repeating && g.short ? ` title="${esc(g.text)}"` : ''}>${
  esc(row.repeating && g.short ? g.short : g.text)}${!row.repeating ? citeTag(g.cite) : ''}</span>
            ${g.base?.alt ? `<label class="chk alt"><input type="checkbox" ${g.alt ? 'checked' : ''}
              data-set="altTraining.alt.${row.level}" data-kind="bool"
              title="${esc(g.base.text)} — tick if you already had it, so this level grants the spell instead">
              <span>already had the feat, so this level grants ${esc(g.base.alt.text
    .replace(/^One /, 'a ').replace(/ added to your spells known$/, ''))} instead</span></label>` : ''}
          `).join('')}</td>
          <td class="choice${state}" data-stack="name">${altTrainingPick(model, row, k.talents?.sphere)}</td>
          <td class="picknote" data-label="Notes">${foldingNote(model, `data-set="altTraining.rowNotes.${row.level}"`, row.note,
    `altTraining.rowNotes.${row.level}`, { name: row.name })}</td>
        </tr>`;
  }).join('')}</tbody>
      </table></div>
      ${fillNotesButton(model, 'altTraining') ? `<div style="margin-top:8px">${fillNotesButton(model, 'altTraining')}</div>` : ''}
      ${k.talents?.sphere ? talentLegend() : ''}
      ${k.repeat ? `<p class="hint repeatrule">
        <strong>From ${k.repeatFrom}th, every two levels:</strong> ${esc(k.repeat.text)}${citeTag(k.repeat.cite)}
      </p>` : ''}
      <p class="hint">
        A reached level with no choice made yet is outlined and counted above. A level not
        reached yet is dotted and not counted. Levels whose grant the rules name show that
        name already. Type over it to record something else. Every row's note
        resolves <code>{name = expr}</code> like any other prose field on the sheet.
      </p>
    </section>`;
  }

  /**
   * The name cell: a dropdown where the rules offer two, otherwise free text.
   *
   * A level whose grant the rules already name shows that name as the
   * placeholder rather than as typed-in text, so it reads as filled without
   * pretending the player chose it -- the same bargain the automatic Levels
   * and BAB boxes on the Overview make. Typing over it wins, which is what an
   * archetype that swaps the grant needs.
   */
function altTrainingPick(model, row, sphere = null) {
    const path = `altTraining.picks.${row.level}`;
    /*
     * A level that grants a talent is looked up the way a sphere tab's row
     * is: the model says what the row would read as there -- "(leap)" is
     * "Athletics Sphere (leap)" -- and the mark goes beside whatever control
     * this cell turns out to be. The technique's own sphere first; a talent
     * taken from elsewhere is still found by the whole catalogue.
     */
    const lookup = model.altTrainingLookup(row);
    const mark = lookup ? (talentMark(sphere, lookup, undefined, model) || talentMark(null, lookup, undefined, model)) : '';
    const marked = (html) => (mark ? `<span class="tcell">${html}${mark}</span>` : html);
    // `data-altpick` hands the write to `setAltTrainingPick`, which fills the
    // row's empty note from the catalogue as a talent cell would.
    const pickAttr = row.grants.some((g) => g.talent) ? ` data-altpick="${row.level}"` : '';
    const options = row.pick?.options;
    if (options) return marked(select(path, row.text, options, '—', { attrs: pickAttr.trim() }));
    const placeholder = row.pick?.placeholder || row.auto || '—';
    const auto = !row.text.trim() && row.auto;
    // A pick carrying an inline formula shows what it comes to, the same way a
    // progression feature cell does.
    return marked(hasTokens(row.text)
      ? prose(model, `data-set="${path}"${pickAttr}`, row.text, 1, 'grow')
      : `<input type="text" class="autotext${auto ? ' auto' : ''}" value="${esc(row.text)}"
          data-set="${path}"${pickAttr} data-kind="text" placeholder="${esc(placeholder)}"${auto
  ? ` title="${esc(`${row.auto} — the technique's own. Type to put something else here.`)}"` : ''}>`);
  }

  /** With no technique taken, the catalogue on offer and what each asks for. */
function altTrainingChooser() {
    const techniques = altTrainingTechniques();
    if (!techniques.length) {
      return `<section class="panel span2">
        <h3>No techniques on offer</h3>
        <p class="empty">No active content pack supplies Alternate Training techniques.
          The tab still keeps whatever is written on it; switch on a pack that carries a
          catalogue (Extensions and Rules, top right) and the ladder appears.</p>
      </section>`;
    }
    return `<section class="panel span2">
      <h3>The ${techniques.length === 5 ? 'five' : techniques.length} techniques</h3>
      <div class="tablewrap"><table>
        <thead><tr><th>Technique</th><th>Prerequisite</th><th>1st level</th><th>Then, every other level from ${altTrainingRepeatFrom()}th</th></tr></thead>
        <tbody>${techniques.map((t) => `<tr>
          <td><button data-action="take-technique" data-name="${esc(t.name)}"
            title="Take ${esc(t.name)}">${esc(t.name)}</button></td>
          <td>${esc(t.prereq?.text || '')}</td>
          <td>${(t.grants?.[1] || []).map((g) => esc(g.text)).join('; ')}</td>
          <td>${esc(t.repeat?.text || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Pick one. The ladder replaces this table. Nothing written on the tab is
        lost if you change your mind.</p>
    </section>`;
  }
