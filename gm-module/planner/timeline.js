// Timeline markup shared by the GM page (planner.js) and the player view
// (players.js): the time ruler, a player's track and the activity blocks.
// String builders over plan data, so both pages draw the timeline with the
// same code, and it can be checked in Node. Also the few page helpers both
// pages use (escaping, zoom, per-viewer settings).

import { clock, end, minutesText, npcName, placesText, playerName, span, whole } from './plan.js';

export const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24]; // pixels per minute
export const DEFAULT_ZOOM = 5;
export const ROOM = 60; // minutes of empty track after the last activity, to drag into
export const WORLD = '@world'; // the lane id of the world events row (no player has it)

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Per-viewer settings (zoom, toggles) in this browser. Storage can be blocked
// or empty; the page then uses its defaults.
export function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the setting just isn't kept */ }
}
export const zoomPref = key => Math.min(ZOOMS.length - 1, Math.max(0, whole(readPref(key, DEFAULT_ZOOM), DEFAULT_ZOOM)));

// Ruler labels at least ~64px apart; finer lines at the snap step when they
// are not crowded.
export function gridSteps(px, snap) {
  const major = [5, 10, 15, 30, 60, 120, 240].find(s => s * px >= 64) ?? 240;
  const minor = [snap, 5, 10, 15, 30].find(s => s * px >= 8 && s < major && major % s === 0) ?? major;
  return { major, minor };
}

// A stable colour per activity, spread round the wheel.
export function hue(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return Math.round((h * 137.508) % 360);
}

// "Stealth DC 15 or Bluff DC 18". The player view's checks carry no DC, so
// theirs are the names alone ("Stealth or Bluff").
export function checkLabel(a) {
  return (a.checks ?? []).map((c) => {
    const name = (c.check ?? '').trim();
    if (name) return c.dc != null ? `${name} DC ${c.dc}` : name;
    return c.dc != null ? `DC ${c.dc}` : '';
  }).filter(Boolean).join(' or ');
}

// The measurements of a timeline drawn at `px` pixels per minute.
export function layout(plan, px) {
  const reach = span(plan) + ROOM;
  return { px, reach, width: Math.round(reach * px), ...gridSteps(px, plan.snap) };
}

export function rulerHtml(plan, L, label = '') {
  let ticks = '';
  for (let t = 0; t <= L.reach; t += L.major) {
    ticks += `<span class="tick" style="left:${t * L.px}px">${esc(clock(t, plan.startsAt))}</span>`;
  }
  ticks += `<span class="tick end" style="left:${plan.length * L.px}px" title="Planned end of the session">End</span>`;
  return `<div class="row ruler"><div class="who">${esc(label)}</div><div class="track" style="width:${L.width}px">${ticks}</div></div>`;
}

// A player's track holding `blocks` (markup), with the grid and the planned end.
export function trackHtml(plan, L, blocks) {
  return `<div class="track" style="width:${L.width}px;--major:${L.major * L.px}px;--minor:${L.minor * L.px}px">
    <span class="overtime" style="left:${plan.length * L.px}px"></span>
    <span class="end-mark" style="left:${plan.length * L.px}px"></span>
    ${blocks}
  </div>`;
}

// An activity's block in the lane of player `lane`, or (lane null) a chip in
// the tray. `editable` adds what the GM page needs: focus, the resize grip
// and a data-key to put focus back after a redraw. `showCheck: false` leaves
// the check out. Linked NPCs are named in the tooltip when the plan has them
// (the player view's does not).
//
// The GM page also passes how the links into it stand: `state` ('blocked',
// 'waiting', 'open' or 'free'), `done` (a result is recorded) and `because`
// (tooltip lines saying why).
export function blockHtml(plan, a, lane, L, {
  selected = false, clash = false, marked = false, editable = false, showCheck = true,
  state = 'free', done = false, because = [],
} = {}) {
  const others = a.players.filter(p => p !== lane).map(p => playerName(plan, p));
  const withText = lane ? (others.length ? `with ${others.join(', ')}` : '') : (others.join(', ') || 'No players yet');
  const when = a.start == null ? 'Not scheduled' : `${clock(a.start, plan.startsAt)}–${clock(end(a), plan.startsAt)}`;
  const check = showCheck ? checkLabel(a) : '';
  const npcs = plan.npcs && a.npcs?.length ? `NPCs: ${a.npcs.map(n => npcName(plan, n)).join(', ')}` : '';
  const places = placesText(a);
  const tip = [a.title.trim() || 'Untitled', `${when} · ${minutesText(a.duration)}`, places, check, withText, npcs, ...because].filter(Boolean).join('\n');
  const width = a.duration * L.px;
  const classes = ['block', lane ? '' : 'chip', editable ? '' : 'static', selected ? 'selected' : '',
    lane && width < 64 ? 'narrow' : '', clash ? 'clash' : '', marked ? 'marked' : '', a.event ? 'event' : '',
    state === 'blocked' || state === 'waiting' ? state : '', done ? 'done' : ''];
  const style = `--hue:${hue(a.id)}` + (lane ? `;left:${a.start * L.px}px;width:${width}px` : '');
  const focus = editable
    ? ` data-key="${esc(`b:${a.id}:${lane ?? ''}`)}" tabindex="0" role="button" aria-label="${esc(tip.replace(/\n/g, ', '))}"`
    : '';
  return `<div class="${classes.filter(Boolean).join(' ')}" data-id="${esc(a.id)}" data-lane="${esc(lane ?? '')}"${focus}
      style="${style}" title="${esc(tip)}">
    <span class="b-title">${esc(a.title.trim() || 'Untitled')}</span>
    <span class="b-meta">${esc([minutesText(a.duration), places && `${a.players.length}/${a.maxPlayers}`, check].filter(Boolean).join(' · '))}</span>
    ${withText ? `<span class="b-with">${esc(withText)}</span>` : ''}
    ${editable && lane ? '<span class="grip" data-grip aria-hidden="true"></span>' : ''}
  </div>`;
}

// Redraws a timeline at a new scale and scrolls it so the minute in the
// middle of the visible lanes stays there, or the start of the session stays
// in view when the timeline is scrolled to it.
export function rescale(wrap, oldPx, newPx, redraw) {
  const half = (wrap.clientWidth - (wrap.querySelector('.who')?.offsetWidth ?? 0)) / 2;
  const atStart = wrap.scrollLeft === 0;
  const centre = (wrap.scrollLeft + half) / oldPx;
  redraw();
  wrap.scrollLeft = atStart ? 0 : centre * newPx - half;
}
