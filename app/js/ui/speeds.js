/**
 * speeds.js -- a table of movement rows, on the character's Speed panel and
 * on every companion's tab.
 *
 * A row is a type, a base in feet and a bonus that takes a formula; the
 * model works each one out (speedRows in model/util.js) and this draws it
 * the same way wherever it is kept, so a companion's fly speed is entered
 * and read exactly as the character's is.
 */

import { esc } from './html.js';
import {
  addButton, exprField, itemNum, itemText, removeButton,
} from './rows.js';

/**
 * The rows kept at `list` (`identity.speeds`, `conjured.0.speeds`), with
 * `worked[i]` what the model made of row i (`{ bonus, error, handle, final }`).
 *
 * `named` puts the formula name under each type, for rows a formula can read
 * by name. `final(i, w)` may draw the Final cell in place of the plain rate --
 * the character's shows what conditions do to it -- and `badge(handle)` adds
 * whatever is forwarded at a rate under it. `example` is the formula the
 * Bonus column offers as its example, and `exampleFor` what the box adds
 * about it.
 */
export function speedTable(list, rows, worked, {
  named = false, final = null, badge = null, example = 'floor(level / 3) * 10', exampleFor = '',
} = {}) {
  return `<div class="tablewrap"><table class="speeds stacked" data-fold="shut">
        <thead><tr><th>Type</th><th class="num">Base</th>
          <th class="num" title="A number, or a formula — e.g. ${esc(example)}">Bonus</th>
          <th class="num">Final</th><th></th></tr></thead>
        <tbody>${(rows || []).map((sp, i) => {
    const w = worked?.[i] || {};
    const extra = badge ? badge(w.handle) : '';
    return `<tr>
          <td data-stack="name">${itemText(list, i, 'type', sp.type, 'Land')}
            ${named ? `<div class="hint speedname">${w.handle
      ? `<code>${esc(w.handle)}</code>`
      : 'name it to use it in a formula'}</div>` : ''}</td>
          <td class="num" data-label="Base">${itemNum(list, i, 'base', sp.base)}</td>
          <td class="num" data-label="Bonus">${exprField(`data-item="${list}|${i}|bonus"`, sp.bonus, {
      width: '5.6rem',
      value: typeof sp.bonus === 'string' && sp.bonus.trim() ? w.bonus : null,
      error: w.error,
      title: `A number, or a formula — e.g. ${example}${exampleFor}`,
    })}</td>
          <td class="num total" data-stack="head">${final?.(i, w) ?? `${Number(w.final) || 0} ft.`}${
      // Under the total rather than beside it: the panel is one of the narrow
      // ones, and a badge on the same line pushes the column wider for every
      // character, including the ones with nothing forwarded anywhere.
      extra ? `<div class="speedfwd">${extra}</div>` : ''}</td>
          <td class="tools quiet">${removeButton(list, i, { what: sp.type || 'this movement', tiny: true })}</td>
        </tr>`;
  }).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px">${addButton(list, 'Add movement', { type: '', base: 30, bonus: 0 })}</div>`;
}
