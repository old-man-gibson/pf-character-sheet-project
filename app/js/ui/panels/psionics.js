/**
 * ui/panels/psionics.js -- the Psionics tab.
 *
 * Manifesting classes, the powers each knows, and the day's power points as
 * one draining bar for the whole character. A class picks its curve by the
 * total it reaches at level 20, from the shared table a pack supplies.
 *
 * Bodies keep the indentation they had as methods, because the markup they
 * return is whitespace-sensitive; see ui/panels/gear.js for the reasoning.
 */
import { esc, ABILITY_LABELS_LIST, nameDatalist, noteCell } from '../html.js';
import { prose } from '../prose.js';
import { forwardedBadge } from '../badges.js';
import { meterStyleButton, meterStyleEditor, meterVisual, powerPointStepper } from './trackers.js';
import {
  psionicCurveTotals, psionicTables, powerCatalogue, powerDetails, slug, manifesterForwardKey,
} from '../../model.js';
import { fmt } from '../../rules.js';
import { countsTowardLine } from '../counts-toward.js';
import { field, num, levelPin, levelPinHint, select } from '../fields.js';
import { addButton, itemSelect, itemText, line, removeButton, rowRemove } from '../rows.js';
import { systemExtrasPanel } from './system-tabs.js';

  /**
   * Manifesting classes and the day's power points.
   *
   * One pool for the whole character, which is what a draining bar is for: it
   * shows what is left rather than what is gone, and a psion spends out of it all
   * day. Everything feeding it is derived -- the curve, the manifester level, the
   * ability half-share -- so the only things to type are which curve a class runs
   * on, its abilities, and the bonus points a feat or item handed over.
   *
   * A class picks its curve by the total that curve reaches at level 20, never by
   * name. That is how the workbook did it, and it means a homebrew manifesting
   * class needs nothing added anywhere: pick the curve it runs on.
   */
export function psionicsPanel(model, ctx) {
    const p = model.data.psionics;
    if (!p) return '<div class="grid"><p class="empty">No psionic data.</p></div>';

    const pool = Number(p.pool) || 0;
    const left = Number(p.left) || 0;
    const unknown = p.calc?.unknownCurves || [];

    return `<div class="grid">
      <section class="panel span2">
        <h3>Power points
          <span class="badge">${left} of ${pool}</span>
          ${p.spent ? `<span class="badge">${p.spent} spent today</span>` : ''}
          <span class="pair" style="margin-left:auto">
            <button data-action="psionics-new-day" title="The whole pool comes back">New day</button>
            ${meterStyleButton(ctx, 'pp')}
          </span>
        </h3>
        ${meterVisual(model.meterSpec('pp'), { pool: 'pp' })}
        ${meterStyleEditor(model, ctx, 'pp')}
        <div class="tracker-controls" style="margin-top:6px">
          ${powerPointStepper(left, pool)}
        </div>
        <div class="fieldgrid" style="margin-top:8px">
          ${field('Bonus points', num('psionics.bonusPoints', p.bonusPoints))}
        </div>
        <p class="hint">The pool is every manifesting class's points plus the bonus.
          The bonus is the one typed figure: points from a feat or an item.
          Readable from a formula as
          <code>pp.pool</code>, <code>pp.left</code> and <code>pp.spent</code>.</p>
        ${unknown.length ? `<p class="hint warn">No power-point curve reaches
          ${unknown.map((n) => `<strong>${esc(n)}</strong>`).join(', ')} at level 20.
          Those classes contribute nothing until a curve is picked.</p>` : ''}
        ${(p.classes || []).length ? '' : '<p class="empty">No manifesting classes yet.</p>'}
      </section>

      ${(p.classes || []).map((c, i) => manifestingClassPanel(model, c, i, ctx)).join('')}

      <section class="panel span2">
        ${addButton('psionics.classes', 'Add manifesting class', {
    name: '', stat: '', stat2: '', curveTotal: 0, manifesterLevelOverride: null, powers: [],
  })}
      </section>
      ${systemExtrasPanel(model, p, 'psionics', 'Psionics')}
    </div>`;
  }

  /** The curve options, labelled with the classes the reference tab lists for each. */
function curveOptions() {
    const classes = psionicTables().classes || [];
    return psionicCurveTotals().map((total) => {
      const names = classes.filter((c) => c.total === total).map((c) => c.name);
      return [total, names.length ? `${total} — ${names.join(', ')}` : `${total}`];
    });
  }

/**
 * The power list as a `<datalist>` behind one manifesting class's name cells,
 * narrowed to that class's own list.
 *
 * One list per class rather than per tab, because that is the grain the
 * narrowing works at -- a psion and a wilder on the same sheet do not offer
 * each other's powers -- and the id carries the class name so two panels
 * never point at the same one.
 */
function powerListId(c) {
  return `cat-powers-${slug(String(c?.name || 'any'))}`;
}

function powerDatalist(c) {
  const name = String(c?.levelClass || c?.name || '').trim();
  return nameDatalist(powerListId(c), 'powers', {
    classes: name ? [name] : [], has: powerCatalogue().powers.length > 0,
  });
}


function manifestingClassPanel(model, c, i, ctx = {}) {
    const base = `psionics.classes.${i}`;
    const list = `${base}.powers`;
    const levels = psionicTables().powerLevels || [];

    return `<section class="panel span2">
      <h3>
        ${itemText('psionics.classes', i, 'name', c.name, 'Manifesting class')}
        <span class="badge">ML ${c.manifesterLevel ?? 0}</span>${
  forwardedBadge(model, manifesterForwardKey(c) || '', { waiting: c.manifesterLevelWaiting
    ? 'this class has no levels yet, so the bonus is held until its first level' : '' })}
        <span class="badge">${c.points ?? 0} pp</span>
        ${c.powerCount ? `<span class="badge">${c.powerCount} power${c.powerCount === 1 ? '' : 's'}</span>` : ''}
        ${c.curveTotal && !c.curveKnown ? '<span class="badge">no curve</span>' : ''}
        <span class="pair" style="margin-left:auto">
          ${removeButton('psionics.classes', i, { what: 'this manifesting class', text: 'Remove' })}
        </span>
      </h3>
      <div class="fieldgrid">
        ${field('Ability 1', select(`${base}.stat`, c.stat, ABILITY_LABELS_LIST))}
        ${field('Ability 2', select(`${base}.stat2`, c.stat2, ABILITY_LABELS_LIST))}
        ${field('Points at 20', select(`${base}.curveTotal`, c.curveTotal, curveOptions()))}
        ${field('Manifester level', levelPin(`${base}.manifesterLevelOverride`, c.manifesterLevelOverride, c.plannerLevel))}
      </div>
      ${line('From the curve', c.basePoints === null ? '—' : c.basePoints)}
      ${line('From abilities', fmt(c.abilityPoints ?? 0))}
      ${levelPinHint(c.manifesterLevelOverride, c.manifesterLevelBase ?? c.manifesterLevel, c.plannerLevel)}
      ${countsTowardLine(model, manifesterForwardKey(c) || '')}
      ${powerDatalist(c)}
      ${(c.powers || []).length ? `<table style="margin-top:8px"><thead><tr>
        <th>Power</th><th style="width:7rem">Level</th>
        <th title="The power's text or your own note — {…} formulas resolve">Notes</th><th></th>
      </tr></thead><tbody>
        ${(c.powers || []).map((w, wi) => `<tr>
          <td>${itemText(list, wi, 'name', w.name, 'Power', { list: powerListId(c) })}</td>
          <td>${itemSelect(list, wi, 'level', w.level, levels)}</td>
          <td>${w.name ? noteCell(
    prose(model, `data-item="${list}|${wi}|note"`, w.note, 1, 'grow'),
    powerDetails(w), model.data.uiPrefs?.collapsed || {}, `${list}|${wi}`, ctx,
  ) : ''}</td>
          ${rowRemove(list, wi)}
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">No powers known.</p>'}
      <div style="margin-top:6px">${addButton(list, 'Add power', { name: '', level: '', note: '' })}</div>
    </section>`;
  }
