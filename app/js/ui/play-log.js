/**
 * play-log.js -- the play log as a panel: the Trackers tab and the session
 * dashboard's Play log card draw the same thing.
 *
 * Newest first, grouped under the day each line was written, the latest few
 * unless asked for all, with a box to add a note of your own and one to
 * search. The log keeps its last LOG_MAX lines (see model/play-log.js); the
 * search runs over all of them, in place, without drawing the sheet again
 * (see the `[data-logsearch]` binding in sheet-element.js).
 *
 * The lines are the undo labels as they were when the action happened, so
 * nothing here interprets them.
 */

import { esc } from './html.js';
import { LOG_MAX } from '../model/play-log.js';

/** How many lines show before "Show all". */
const SHOWN = 15;

/** The local calendar day of a stamp, as a session note dates itself: "2026-10-17". */
export function logDay(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayHeading = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const timeOf = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

/** The lines as list items under their days; `limit` hides the rest behind "Show all". */
export function logLinesHtml(lines, { limit = Infinity } = {}) {
  let day = null;
  return lines.map((e, i) => {
    const d = logDay(e.at);
    const head = d !== day ? `<li class="logday"${i >= limit ? ' hidden' : ''}>${esc(dayHeading(e.at))}</li>` : '';
    day = d;
    return `${head}<li class="${e.kind === 'note' ? 'note' : ''}" data-logline${i >= limit ? ' hidden data-logmore' : ''}>
      <time datetime="${esc(e.at)}">${esc(timeOf(e.at))}</time> <span>${esc(e.text)}</span></li>`;
  }).join('');
}

export function playLogPanel(model, ctx, { span = true } = {}) {
  const lines = model.playLog;
  const all = !!ctx.logAll;
  const draft = ctx.draft?.logNote ?? '';
  const query = ctx.logQuery ?? '';
  return `<section class="panel${span ? ' span2' : ''} playlog">
    <h3>Play log <span class="badge" title="The last ${LOG_MAX} lines are kept; older ones drop off">${lines.length} of ${LOG_MAX}</span></h3>
    <div class="pair">
      <input type="text" data-draft="logNote" value="${esc(draft)}" placeholder="Add a note: Session 12, the hydra"
        aria-label="A note for the play log" style="flex:1 1 12rem">
      <button data-action="log-note">Add</button>
    </div>
    ${lines.length ? `<input type="search" data-logsearch value="${esc(query)}" placeholder="Search the log"
      aria-label="Search the play log" style="margin-top:6px">
    <p class="hint logcount" hidden></p>
    <ol class="logl">${logLinesHtml(lines, { limit: all ? Infinity : SHOWN })}</ol>`
    : '<p class="empty">Nothing yet. Damage, healing, rests, spends and their undos are written here as they happen.</p>'}
    ${lines.length > SHOWN ? `<button class="linkish" data-view data-action="log-all">${all ? 'Show the latest' : `Show all ${lines.length}`}</button>` : ''}
  </section>`;
}
