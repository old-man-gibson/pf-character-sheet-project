/**
 * ui/badges.js -- the two marks a number wears to say where it came from.
 *
 * The import offset ("Other") and the forwarded-bonus badge. Both are small,
 * both appear on half the panels in the sheet, and both need nothing from the
 * element except the model -- so they take it as an argument and live out here
 * where every panel can reach them.
 */
import { esc } from './html.js';
import { fmt, FORWARD_BY_DERIVED } from '../rules.js';

/* ----- the import offset, as a field -----
 * AC, touch, flat-footed, CMD and the three saves all carry a reconciliation
 * offset: everything the Google formulas added that the export could not
 * show. Left hidden it is the only place those bonuses live and there is no
 * way to add one, so it is an ordinary editable column here.
 */

export function sheetBonusHead() {
  return '<th class="num" title="Bonuses the source sheet added through formulas the export could not show — and where a new one goes">Other</th>';
}

export function sheetBonusCell(model, key) {
  return `<td class="num"><input type="number" value="${model.offsetOf(key)}"
      data-offset="${key}" style="width:3.6rem" aria-label="Other bonuses to ${esc(key)}"
      >${forwardedBadge(model, FORWARD_BY_DERIVED[key])}</td>`;
}

/**
 * A forwarded bonus, shown where it lands.
 *
 * Half of forwarding is arriving; the other half is being findable
 * afterwards. A number that grew by 24 with nothing beside it to say why is
 * worse than the copied formulas it replaced -- so the amount sits next to
 * the field it is added to, and points back at the sentence that sent it.
 */
export function forwardedBadge(model, name, tag = '', only = '') {
  const f = name ? model.forwardedInto(name, only) : null;
  if (!f) return '';
  // A superseded bonus stays on the list, marked. It is the reason the one
  // above it is not adding to it, and a reader who cannot see it will write
  // it in again by hand.
  const from = f.from
    .map((x) => `${fmt(x.value)}${x.type ? ` ${x.type}` : ''} from ${x.where}`
      + ` — ${x.sign < 0 ? '-=' : '+='} ${x.expr}${x.counts ? '' : `  (does not stack with the other ${x.type})`}`)
    .join('\n');
  return `<span class="fwd" title="Forwarded here${tag ? ` (${tag})` : ''}\n${esc(from)}">`
    + `${fmt(f.total)}${tag ? ` <em>${esc(tag)}</em>` : ''}</span>`;
}

export function sheetBonusHint(examples) {
  return `<p class="hint"><strong>Other</strong> holds what the source sheet added
      through formulas that did not survive the export — ${esc(examples)}. It is the
      number that makes the import match, and the place to add your own.</p>`;
}
