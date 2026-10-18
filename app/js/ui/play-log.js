/**
 * play-log.js -- the play log as a panel: the Extras & Notes tab and the
 * session dashboard's Play log card draw the same thing.
 *
 * Newest first, the last few unless asked for all, with a box to add a note
 * of your own. The lines are the undo labels as they were when the action
 * happened -- see model/play-log.js -- so nothing here interprets them.
 */

import { esc } from './html.js';

/** How many lines show before "Show all". */
const SHOWN = 15;

/** "12 Oct 21:40": short enough to sit beside the line it dates. */
function when(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function playLogPanel(model, ctx, { span = true } = {}) {
  const lines = model.playLog;
  const all = !!ctx.logAll;
  const shown = all ? lines : lines.slice(0, SHOWN);
  const draft = ctx.draft?.logNote ?? '';
  return `<section class="panel${span ? ' span2' : ''} playlog">
    <h3>Play log <span class="badge">${lines.length}</span></h3>
    <div class="pair">
      <input type="text" data-draft="logNote" value="${esc(draft)}" placeholder="Add a note: Session 12, the hydra"
        aria-label="A note for the play log" style="flex:1 1 12rem">
      <button data-action="log-note">Add</button>
    </div>
    ${shown.length ? `<ol class="logl">${shown.map((e) => `<li class="${e.kind === 'note' ? 'note' : ''}">
      <time datetime="${esc(e.at)}">${esc(when(e.at))}</time> <span>${esc(e.text)}</span></li>`).join('')}</ol>`
    : '<p class="empty">Nothing yet. Damage, healing, rests, spends and their undos are written here as they happen.</p>'}
    ${lines.length > SHOWN ? `<button class="linkish" data-view data-action="log-all">${all ? 'Show the latest' : `Show all ${lines.length}`}</button>` : ''}
  </section>`;
}
