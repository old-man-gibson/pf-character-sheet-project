// The GM's run sheet for a plan: the session in time order, each world event
// and activity with its players, premise, checks (DC, tiers, rewards,
// failure), NPCs, links and notes, then the cast and the notes about nothing
// in particular. For reading at the table or printing. It reads the plan
// through the planner's store (stores.js), so it works wherever the planner
// does. The plan is named in the address: runsheet.html#<plan name>.

import { checkName, checkNeeds, clock, end, ladder, minutesText, npcName, outcomeChoices, playerName, refText } from './plan.js';
import { openStore } from './stores.js';
import { esc, readPref } from './timeline.js';

const $ = sel => document.querySelector(sel);

// The sheet's markup for a plan. Exported for the tests.
export function runSheetHtml(plan) {
  const time = a => (a.start == null ? 'Not on the timeline' : `${clock(a.start, plan.startsAt)}–${clock(end(a), plan.startsAt)}`);
  const ordered = [...plan.activities].sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity) || Number(y.event) - Number(x.event));
  const lines = (s, cls = '') => (s.trim() ? `<p class="${cls}">${esc(s.trim())}</p>` : '');

  // A hidden check is marked, with what it needs; an Auto step reads
  // "(auto)", or "(auto, or 15)" when it can be rolled for as well.
  const checkHtml = (a, c) => {
    const steps = ladder(c);
    const needs = checkNeeds(c);
    const dc = t => (t.auto ? (t.dc != null ? ` (auto, or ${t.dc})` : ' (auto)') : ` (${t.dc})`);
    const success = steps.find(t => t.id === 'success');
    const tiers = steps.filter(t => t.id !== 'success');
    return `<li class="check${c.hidden ? ' hidden' : ''}">
      <p class="check-name">${c.hidden ? '<span class="tag">Hidden</span> ' : ''}<strong>${esc(checkName(c) || 'Check')}</strong>${c.dc != null ? ` DC ${c.dc}` : ''}${success?.auto ? ', auto' : ''}</p>
      ${needs && c.check.trim() ? `<p class="needs"><span class="label">Needs</span> ${esc(needs)}</p>` : ''}
      <dl>
        ${c.success.trim() ? `<dt>Success${success ? dc(success) : ''}</dt><dd>${esc(c.success.trim())}</dd>` : ''}
        ${tiers.map(t => `<dt>${esc(t.label.trim() || 'Tier')}${dc(t)}</dt><dd>${esc(t.reward.trim()) || '—'}</dd>`).join('')}
        ${c.failure.trim() ? `<dt>Failure</dt><dd>${esc(c.failure.trim())}</dd>` : ''}
      </dl>
    </li>`;
  };

  const linkLines = a => {
    const out = plan.links.filter(l => l.from.activity === a.id).map(l => {
      const when = l.from.check ? ` on ${esc(outcomeChoices(a).find(o => o.check === l.from.check && o.outcome === l.from.outcome)?.label ?? '')}` : '';
      return `<li class="${l.kind}">${l.kind === 'leads' ? 'Leads to' : 'Blocks'} ${esc(refText(plan, { activity: l.to }))}${when}</li>`;
    });
    const into = plan.links.filter(l => l.to === a.id)
      .map(l => `<li class="${l.kind}">${l.kind === 'leads' ? 'Opened by' : 'Blocked by'} ${esc(refText(plan, l.from))}</li>`);
    return [...out, ...into];
  };

  const entry = a => {
    const players = a.event ? 'World event' : a.players.map(p => playerName(plan, p)).join(', ') || 'No players yet';
    const npcs = a.npcs.map(n => {
      const role = plan.npcs.find(x => x.id === n)?.role.trim();
      return `${esc(npcName(plan, n))}${role ? ` <span class="dim">(${esc(role)})</span>` : ''}`;
    });
    const links = linkLines(a);
    const notes = plan.notes.filter(n => n.about?.activity === a.id);
    const checks = a.checks.filter(c => checkName(c) || c.dc != null || c.success.trim() || c.failure.trim() || c.tiers.length);
    return `<article class="entry${a.event ? ' event' : ''}">
      <header>
        <span class="when">${esc(time(a))}</span>
        <h2>${esc(a.title.trim() || 'Untitled')}</h2>
        <span class="who">${esc(players)}${a.maxPlayers != null ? ` · at most ${a.maxPlayers}` : ''} · ${esc(minutesText(a.duration))}</span>
      </header>
      ${lines(a.premise, 'premise')}
      ${checks.length ? `<ul class="checks">${checks.map(c => checkHtml(a, c)).join(checks.length > 1 ? '<li class="or">or</li>' : '')}</ul>` : ''}
      ${npcs.length ? `<p class="meta"><span class="label">NPCs</span> ${npcs.join(', ')}</p>` : ''}
      ${links.length ? `<ul class="links">${links.join('')}</ul>` : ''}
      ${notes.map(n => `<p class="note"><span class="label">Note${n.about.check ? ` (${esc(refText(plan, n.about).replace(/^“[^”]*”: /, ''))})` : ''}</span> ${esc(n.text.trim())}</p>`).join('')}
      <p class="result-line"><span class="label">What happened</span> <span class="blank"></span></p>
    </article>`;
  };

  const cast = plan.npcs.map(n => `<li><strong>${esc(npcName(plan, n.id))}</strong>${n.role.trim() ? ` <span class="dim">${esc(n.role.trim())}</span>` : ''}
      ${lines(n.description)}${lines(n.notes, 'dim')}</li>`).join('');
  const loose = plan.notes.filter(n => !n.about && n.text.trim());

  return `<header class="sheet-head">
      <h1>${esc(plan.title.trim() || 'Untitled session')}</h1>
      <p class="dim">${plan.startsAt ? `Starts at ${esc(plan.startsAt)} · ` : ''}${esc(minutesText(plan.length))} planned · ${esc(plan.players.map(p => playerName(plan, p.id)).join(', ') || 'no players')}</p>
    </header>
    ${ordered.length ? ordered.map(entry).join('') : '<p class="dim">Nothing planned yet.</p>'}
    ${cast ? `<section class="cast"><h2>NPCs</h2><ul>${cast}</ul></section>` : ''}
    ${loose.length ? `<section class="loose"><h2>Notes</h2><ul>${loose.map(n => `<li>${esc(n.text.trim())}${plan.links.some(l => l.from.note === n.id) ? `<ul class="links">${plan.links.filter(l => l.from.note === n.id).map(l => `<li class="${l.kind}">${l.kind === 'leads' ? 'Leads to' : 'Blocks'} ${esc(refText(plan, { activity: l.to }))}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul></section>` : ''}`;
}

async function show() {
  const sheet = $('#sheet');
  let name = '';
  try { name = decodeURIComponent(location.hash.slice(1)); } catch { /* a mangled address */ }
  name ||= readPref('gm-planner:last', '');
  if (!name) { sheet.innerHTML = '<p>Open the run sheet from the planner.</p>'; return; }
  try {
    const store = await openStore();
    const out = await store.read(name);
    if (!out) { sheet.innerHTML = `<p>There is no plan named “${esc(name)}”${store.kind === 'browser' ? ' in this browser' : ''}.</p>`; return; }
    document.title = `${out.plan.title.trim() || name} · Run sheet`;
    sheet.innerHTML = runSheetHtml(out.plan);
  } catch (err) {
    sheet.innerHTML = `<p>Could not read the plan: ${esc(err.message)}</p>`;
  }
}

if (typeof document !== 'undefined') {
  $('#print').addEventListener('click', () => print());
  $('#refresh').addEventListener('click', show);
  addEventListener('hashchange', show);
  show();
}
