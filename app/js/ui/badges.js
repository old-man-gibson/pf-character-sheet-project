/**
 * ui/badges.js -- the two marks a number wears to say where it came from.
 *
 * The import offset ("Other") and the forwarded-bonus badge. Both are small,
 * both appear on half the panels in the sheet, and both need nothing from the
 * element except the model -- so they take it as an argument and live out here
 * where every panel can reach them.
 */
import { esc } from './html.js';
import { exprField } from './rows.js';
import { fmt, FORWARD_BY_DERIVED } from '../rules.js';
import { stackingNote } from '../model/scope.js';
import { forwardedPopHtml } from './breakdown-popover.js';

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
  // `data-label` for the card layout on a narrow screen, where the column
  // heading this sits under is gone; see `table.stacked` in the stylesheet.
  return `<td class="num" data-label="Other">${sheetBonusField(model, key)}${
    forwardedBadge(model, FORWARD_BY_DERIVED[key])}</td>`;
}

/**
 * The Other field on its own: a number, or a formula the model resolves.
 *
 * A formula, because half of what lands here is a rule -- a bonus that grows
 * with the level, a modifier that applies while something else is true --
 * and typed as the number it comes to today it goes stale at the next
 * level-up. The model keeps the text and works it out each pass; the cell
 * shows the answer and the source on a click, like every formula field.
 */
export function sheetBonusField(model, key, width = '4rem') {
  return exprField(`data-offset="${key}" aria-label="Other bonuses to ${esc(key)}"`,
    model.offsetSource(key), {
      width,
      value: model.offsetOf(key),
      error: model.offsetError(key),
      title: 'A number, or a formula — e.g. floor(level / 4)',
    });
}

/**
 * A forwarded bonus, shown where it lands.
 *
 * Half of forwarding is arriving; the other half is being findable
 * afterwards. A number that grew by 24 with nothing beside it to say why is
 * worse than the copied formulas it replaced -- so the amount sits next to
 * the field it is added to, and points back at the sentences that sent it.
 *
 * Every gold badge on the sheet is this one, so every one of them opens the
 * same hover panel: one row a rule, worked out when it opens (see
 * `forwardedPop` below and ui/breakdown-popover.js). The `title` holds the
 * same rows as plain text, for a browser with no popover API.
 *
 * @param name  the destination -- or a list of them, when one figure gathers
 *              several: a defence box takes its family's bonus and every named
 *              part's (`dr`, `dr.magic`, `dr.cold`), and a companion's attack
 *              the bonus to all its attacks and to that one.
 * @param opts.tag      a word after the figure: "mult", "crit"
 * @param opts.only     'permanent' or 'temporary': half of what arrives
 * @param opts.waiting  why a bonus with nothing yet to raise is held back
 * @param opts.shown    what the badge says, when that is not the amount
 *                      forwarded: a defence box's line as it now stands, the
 *                      temporary hit points still unspent
 * @param opts.note     a sentence about that figure, under the panel's heading
 */
export function forwardedBadge(model, name, { tag = '', only = '', waiting = '', shown = '', note = '' } = {}) {
  const names = [].concat(name || []).filter(Boolean);
  const groups = forwardedGroups(model, names, only);
  if (!groups.some((g) => g.f)) return '';
  const total = groups.reduce((sum, g) => sum + (g.f?.total || 0), 0);
  const many = names.length > 1;
  // What the hover panel needs to ask the model again when it opens, so the
  // list it shows is never a render old -- the same bargain as `data-bd`, and
  // `data-fwdx` is `data-bdx`: what the panel cannot work out for itself.
  const extra = Object.fromEntries(Object.entries({ only, tag, waiting, shown, note }).filter(([, v]) => v));
  const pop = ` data-fwd="${esc(names.join(' '))}"${
    Object.keys(extra).length ? ` data-fwdx="${esc(JSON.stringify(extra))}"` : ''}`;
  // A bonus with nothing yet to raise -- a caster level before casting is
  // unlocked -- is shown held back rather than hidden, with the reason.
  const word = waiting ? (tag ? `${tag}, waiting` : 'waiting') : tag;
  // A superseded bonus stays on the list, marked. It is the reason the one
  // above it is not adding to it, and a reader who cannot see it will write
  // it in again by hand.
  const from = groups.flatMap((g) => (g.f?.from || [])
    .map((x) => `${fmt(x.value)}${x.type ? ` ${x.type}` : ''}${many ? ` to ${g.name}` : ''} from ${x.where}`
      + ` — ${x.sign < 0 ? '-=' : '+='} ${x.expr}${stackingNote(x)}`));
  const title = [waiting ? `Waiting: ${waiting}` : '', `Forwarded here${word ? ` (${word})` : ''}`, note, ...from]
    .filter(Boolean).join('\n');
  return `<span class="fwd${waiting ? ' waiting' : ''}"${pop} title="${esc(title)}">`
    + `${esc(shown || fmt(total))}${word ? ` <em>${esc(word)}</em>` : ''}</span>`;
}

/** What each destination is receiving, as `[{ name, f }]` -- `f` null where nothing is. */
function forwardedGroups(model, names, only = '') {
  return names.map((n) => ({ name: n, f: model.forwardedInto(n, only) }));
}

/**
 * The panel a badge opens, worked out now from what it names: `data-fwd`, the
 * destinations, and `data-fwdx`, the rest of what it was drawn with.
 */
export function forwardedPop(model, names, extra = '') {
  let opts = {};
  try { opts = extra ? JSON.parse(extra) : {}; } catch { opts = {}; }
  const list = String(names || '').split(' ').filter(Boolean);
  return forwardedPopHtml(forwardedGroups(model, list, opts.only || ''), opts);
}

export function sheetBonusHint(examples) {
  return `<p class="hint"><strong>Other</strong> holds what the source sheet added
      through formulas that did not survive the export — ${esc(examples)}. It is the
      number that makes the import match, and the place to add your own.</p>`;
}
