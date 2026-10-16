// Session plan: the players at the table, the activities they mean to do, and
// a timeline that places those activities side by side. Plain data and pure
// functions, shared by the planner page, its server (which normalises every
// plan it writes) and the tests.
//
// Times are whole minutes from the start of the session. An activity whose
// `start` is null is unscheduled and waits in the tray. Activities run in
// parallel, but a player takes part in one at a time: two activities that
// share a player may meet end to start, never overlap. An activity may also
// set `maxPlayers`, the most players it takes (null: no limit). Every edit that
// moves an activity or changes who is in it goes through `updateActivity` (or
// `addActivity`), which refuses a change that would break either rule.
//
// A check has a DC to succeed and any number of further tiers, each with its
// own DC and reward. A result reaches the tier with the highest DC it meets;
// below every DC it is a failure.
//
// NPCs are the plan's cast. An activity links any number of them. Nothing
// stops one NPC being linked to two activities at once (a link can mean "about
// them" as well as "with them"), but `npcClashes` reports it.
//
// Plan shape (one JSON file per session):
//   { version, title, startsAt: "19:00" | "", length (min), snap (min),
//     players: [{ id, name, color }],
//     npcs: [{ id, name, role, description, notes }],
//     activities: [{ id, title, start (min) | null, duration (min), players: [ids],
//                    maxPlayers | null, npcs: [ids], premise, check, dc | null,
//                    success, failure,
//                    tiers: [{ id, label, dc | null, reward }] }] }
// Fields a plan carries beyond these are kept as they are.

export const PLAN_VERSION = 1;
export const DEFAULTS = Object.freeze({ title: 'Untitled session', length: 240, snap: 5, duration: 10 });
export const SNAPS = Object.freeze([1, 5, 10, 15, 30]);
export const PLAYER_COLORS = Object.freeze([
  '#3aa88f', '#4a7fc0', '#c08a3a', '#a65ac0', '#c0504a', '#5aa0b8', '#8fa83a', '#c06a95',
]);

const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}$/i;

const text = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// A whole number no lower than `min`, or `fallback` when `v` is blank or not a number.
export function whole(v, fallback, min = -Infinity) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

// The first `<prefix><n>` that no item in `list` uses as its id.
export function newId(list, prefix) {
  const taken = new Set(list.map(x => x.id));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function blankPlan(title = DEFAULTS.title) {
  return {
    version: PLAN_VERSION, title, startsAt: '', length: DEFAULTS.length, snap: DEFAULTS.snap,
    players: [], npcs: [], activities: [],
  };
}

// A new plan with no activities, starting with the given players and NPCs (a
// new session usually has the same table and many of the same people).
export function newPlan(title = DEFAULTS.title, { players = [], npcs = [] } = {}) {
  return normalizePlan({ ...blankPlan(title), players, npcs });
}

// ---- Plan names ----------------------------------------------------------------
//
// A plan's name is its file name without ".json" in the plans folder, and its
// key in the browser's plan store: letters, digits, spaces, dashes and
// underscores, so a name never reaches outside the folder. Windows reserves a
// few device names whatever the extension.

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9_-])?$/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
export const validName = name => typeof name === 'string' && NAME.test(name) && !RESERVED.test(name);

// A valid name made from any text (an imported file's name, say), or `fallback`.
export function nameFrom(raw, fallback = 'imported') {
  const name = text(raw).replace(/\.json$/i, '').replace(/[^A-Za-z0-9 _-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '').slice(0, 64).replace(/[^A-Za-z0-9_-]+$/, '');
  return validName(name) ? name : fallback;
}

// `wanted`, or `wanted-2`, `wanted-3`... whichever is not in `taken`.
export function freeName(taken, wanted) {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n++) {
    const name = `${wanted.slice(0, 60)}-${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// What a plan list shows of a plan.
export const planSummary = (name, plan) =>
  ({ name, title: plan.title, players: plan.players.length, activities: plan.activities.length });

// A short fingerprint of some text (FNV-1a), for telling versions apart.
export function textHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function blankActivity(id, fields = {}) {
  return {
    id, title: 'New activity', start: null, duration: DEFAULTS.duration, players: [], npcs: [],
    premise: '', check: '', dc: null, success: '', failure: '', tiers: [], ...fields,
  };
}

function normalizeTier(raw, taken) {
  const t = isObject(raw) ? raw : {};
  const id = text(t.id).trim();
  return {
    ...t,
    id: id && !taken.some(x => x.id === id) ? id : newId(taken, 't'),
    label: text(t.label),
    dc: whole(t.dc, null),
    reward: text(t.reward),
  };
}

// A list of ids without blanks or repeats, and (when `allowed` is given) only
// the ids in it.
function idList(raw, allowed) {
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const id = text(v);
    if (id && !out.includes(id) && (!allowed || allowed.includes(id))) out.push(id);
  }
  return out;
}

// The player and NPC ids a plan has, for normalizeActivity.
export const knownIds = plan => ({ players: plan.players.map(p => p.id), npcs: plan.npcs.map(n => n.id) });

// One activity in canonical shape. `known` ({ players, npcs } id lists, when
// given) drops players and NPCs the plan does not have. An activity with
// nobody in it cannot sit in a lane, so it is unscheduled.
export function normalizeActivity(raw, known = null) {
  const a = isObject(raw) ? raw : {};
  const players = idList(a.players, known?.players);
  const tiers = [];
  for (const t of Array.isArray(a.tiers) ? a.tiers : []) tiers.push(normalizeTier(t, tiers));
  return {
    ...a,
    id: text(a.id),
    title: a.title === undefined ? 'New activity' : text(a.title),
    start: players.length ? whole(a.start, null, 0) : null,
    duration: whole(a.duration, DEFAULTS.duration, 1),
    players,
    maxPlayers: whole(a.maxPlayers, null, 1),
    npcs: idList(a.npcs, known?.npcs),
    premise: text(a.premise),
    check: text(a.check),
    dc: whole(a.dc, null),
    success: text(a.success),
    failure: text(a.failure),
    tiers,
  };
}

export function normalizePlan(raw) {
  const src = isObject(raw) ? raw : {};
  const players = [];
  for (const p of Array.isArray(src.players) ? src.players : []) {
    if (!isObject(p)) continue;
    const id = text(p.id).trim();
    players.push({
      ...p,
      id: id && !players.some(x => x.id === id) ? id : newId(players, 'p'),
      name: text(p.name),
      color: COLOR.test(p.color) ? p.color : PLAYER_COLORS[players.length % PLAYER_COLORS.length],
    });
  }
  const npcs = [];
  for (const n of Array.isArray(src.npcs) ? src.npcs : []) {
    if (isObject(n)) npcs.push(normalizeNpc(n, npcs));
  }
  const known = { players: players.map(p => p.id), npcs: npcs.map(n => n.id) };
  const activities = [];
  for (const raw of Array.isArray(src.activities) ? src.activities : []) {
    if (!isObject(raw)) continue;
    const a = normalizeActivity(raw, known);
    if (!a.id.trim() || activities.some(x => x.id === a.id)) a.id = newId(activities, 'a');
    activities.push(a);
  }
  return {
    ...src,
    version: PLAN_VERSION,
    title: src.title === undefined ? DEFAULTS.title : text(src.title),
    startsAt: CLOCK.test(src.startsAt) ? src.startsAt : '',
    length: whole(src.length, DEFAULTS.length, 1),
    snap: SNAPS.includes(Number(src.snap)) ? Number(src.snap) : DEFAULTS.snap,
    players,
    npcs,
    activities,
  };
}

function normalizeNpc(raw, taken) {
  const id = text(raw.id).trim();
  return {
    ...raw,
    id: id && !taken.some(x => x.id === id) ? id : newId(taken, 'n'),
    name: text(raw.name),
    role: text(raw.role),
    description: text(raw.description),
    notes: text(raw.notes),
  };
}

// ---- Time --------------------------------------------------------------

export const end = a => a.start + a.duration;
export const overlaps = (a, b) => a.start < end(b) && b.start < end(a);
export const snapTo = (minutes, step) => Math.round(minutes / step) * step;

// How far the timeline reaches: the session length, or the end of the last
// activity when one runs past it.
export function span(plan) {
  let last = plan.length;
  for (const a of plan.activities) if (a.start != null) last = Math.max(last, end(a));
  return last;
}

// "1:05" from the start of the session, or the clock time when the plan has a
// starting time ("20:05" for a session that starts at 19:00).
export function clock(minutes, startsAt = '') {
  const pad = n => String(n).padStart(2, '0');
  if (CLOCK.test(startsAt)) {
    const [h, m] = startsAt.split(':').map(Number);
    const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
  }
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

export function minutesText(n) {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Minutes a player spends in scheduled activities.
export function playerLoad(plan, playerId) {
  let total = 0;
  for (const a of plan.activities) if (a.start != null && a.players.includes(playerId)) total += a.duration;
  return total;
}

// ---- One activity per player at a time ------------------------------------

// The scheduled activities `act` would overlap through a shared player, as
// { player, activity } pairs. An unscheduled activity clashes with nothing.
export function clashes(plan, act) {
  if (act.start == null) return [];
  const found = [];
  for (const other of plan.activities) {
    if (other.id === act.id || other.start == null || !overlaps(act, other)) continue;
    for (const p of act.players) if (other.players.includes(p)) found.push({ player: p, activity: other });
  }
  return found;
}

// Every pair of scheduled activities that books a player twice. A plan the
// page edits never has one; a file edited by hand may.
export function allClashes(plan) {
  const found = [];
  const list = plan.activities.filter(a => a.start != null);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!overlaps(list[i], list[j])) continue;
      for (const p of list[i].players) if (list[j].players.includes(p)) found.push({ player: p, a: list[i], b: list[j] });
    }
  }
  return found;
}

export function playerName(plan, id) {
  const i = plan.players.findIndex(p => p.id === id);
  return i < 0 ? 'Someone' : plan.players[i].name.trim() || `Player ${i + 1}`;
}

// "Mira is already in “Pick the lock” (0:10–0:25)." for each clash.
export function clashText(plan, found) {
  return found.map(({ player, activity: o }) =>
    `${playerName(plan, player)} is already in “${o.title.trim() || 'Untitled'}” ` +
    `(${clock(o.start, plan.startsAt)}–${clock(end(o), plan.startsAt)}).`).join(' ');
}

// The earliest start at or after `from` where `act` fits around everything
// its players already do.
export function firstFree(plan, act, from = 0) {
  const others = plan.activities.filter(o =>
    o.id !== act.id && o.start != null && o.players.some(p => act.players.includes(p)));
  const starts = [from, ...others.map(end).filter(t => t > from)].sort((x, y) => x - y);
  for (const start of starts) if (!clashes(plan, { ...act, start }).length) return start;
  return Math.max(from, ...others.map(end));
}

// ---- Edits -----------------------------------------------------------------

// Applies `changes` to activity `id` unless that would book a player twice.
// Returns { ok: true, activity } after the change, or { ok: false, clashes,
// activity } (the refused version) with the plan untouched.
export function updateActivity(plan, id, changes) {
  const i = plan.activities.findIndex(a => a.id === id);
  if (i < 0) return { ok: false, clashes: [], activity: null };
  const next = normalizeActivity({ ...plan.activities[i], ...changes }, knownIds(plan));
  if (overfills(plan.activities[i], next)) return { ok: false, clashes: [], full: true, activity: next, before: plan.activities[i] };
  const found = clashes(plan, next);
  if (found.length) return { ok: false, clashes: found, activity: next };
  plan.activities[i] = next;
  return { ok: true, activity: next };
}

export function addActivity(plan, fields = {}) {
  const act = normalizeActivity(blankActivity(newId(plan.activities, 'a'), fields), knownIds(plan));
  if (overfills(null, act)) return { ok: false, clashes: [], full: true, activity: act };
  const found = clashes(plan, act);
  if (found.length) return { ok: false, clashes: found, activity: act };
  plan.activities.push(act);
  return { ok: true, activity: act };
}

// ---- The player limit ----------------------------------------------------------

export const overLimit = a => a.maxPlayers != null && a.players.length > a.maxPlayers;

// Whether going from `before` (null for a new activity) to `next` puts more
// players in than its limit allows: a player added, or the limit lowered.
// An activity already over its limit (a hand-edited file) may still be moved
// or have players taken out.
export function overfills(before, next) {
  if (!overLimit(next)) return false;
  if (!before) return true;
  return next.players.length > before.players.length || !overLimit(before) || next.maxPlayers < before.maxPlayers;
}

// Why a change was refused: "“Search the archive” takes at most 2 players."
// when it added a player, or "“Search the archive” has 3 players, so its limit
// cannot be lower than 3." when it lowered the limit (`before` is the
// activity as it was).
export function limitText(act, before = null) {
  const title = `“${act.title.trim() || 'Untitled'}”`;
  const plural = n => `${n} ${n === 1 ? 'player' : 'players'}`;
  if (before && act.players.length <= before.players.length) {
    return `${title} has ${plural(act.players.length)}, so its limit cannot be lower than ${act.players.length}.`;
  }
  return `${title} takes at most ${plural(act.maxPlayers)}.`;
}

// "2 of 3 players", or "" when there is no limit.
export const placesText = a => (a.maxPlayers == null ? '' : `${a.players.length} of ${a.maxPlayers} ${a.maxPlayers === 1 ? 'player' : 'players'}`);

// A copy with the same players, placed at the first time after the original
// that they are all free (or unscheduled, when the original is).
export function duplicateActivity(plan, id) {
  const src = plan.activities.find(a => a.id === id);
  if (!src) return { ok: false, clashes: [], activity: null };
  const copy = { ...structuredClone(src), id: newId(plan.activities, 'a') };
  if (copy.start != null) copy.start = firstFree(plan, copy, end(src));
  plan.activities.splice(plan.activities.indexOf(src) + 1, 0, copy);
  return { ok: true, activity: copy };
}

export function deleteActivity(plan, id) {
  plan.activities = plan.activities.filter(a => a.id !== id);
}

export function addPlayer(plan, name = '') {
  const used = new Set(plan.players.map(p => p.color));
  const color = PLAYER_COLORS.find(c => !used.has(c)) ?? PLAYER_COLORS[plan.players.length % PLAYER_COLORS.length];
  const player = { id: newId(plan.players, 'p'), name, color };
  plan.players.push(player);
  return player;
}

// Takes the player out of the plan and out of every activity. Returns the
// scheduled activities that were left with nobody (they move to the tray).
export function removePlayer(plan, id) {
  plan.players = plan.players.filter(p => p.id !== id);
  const emptied = [];
  for (const a of plan.activities) {
    if (!a.players.includes(id)) continue;
    a.players = a.players.filter(p => p !== id);
    if (!a.players.length && a.start != null) { a.start = null; emptied.push(a); }
  }
  return emptied;
}

// ---- NPCs ------------------------------------------------------------------

export function npcName(plan, id) {
  return plan.npcs.find(n => n.id === id)?.name.trim() || 'Unnamed NPC';
}

export function addNpc(plan, fields = {}) {
  const npc = normalizeNpc({ name: '', ...fields, id: newId(plan.npcs, 'n') }, plan.npcs);
  plan.npcs.push(npc);
  return npc;
}

// Takes the NPC out of the plan and out of every activity. Returns the
// activities that linked them.
export function removeNpc(plan, id) {
  plan.npcs = plan.npcs.filter(n => n.id !== id);
  const linked = plan.activities.filter(a => a.npcs.includes(id));
  for (const a of linked) a.npcs = a.npcs.filter(n => n !== id);
  return linked;
}

// The activities that link an NPC: scheduled ones in time order, then the
// unscheduled ones.
export function npcActivities(plan, id) {
  const linked = plan.activities.filter(a => a.npcs.includes(id));
  const on = linked.filter(a => a.start != null).sort((x, y) => x.start - y.start);
  return [...on, ...linked.filter(a => a.start == null)];
}

// The other scheduled activities that link one of `act`'s NPCs at an
// overlapping time, as { npc, activity } pairs.
export function npcClashes(plan, act) {
  if (act.start == null) return [];
  const found = [];
  for (const other of plan.activities) {
    if (other.id === act.id || other.start == null || !overlaps(act, other)) continue;
    for (const n of act.npcs) if (other.npcs.includes(n)) found.push({ npc: n, activity: other });
  }
  return found;
}

// ---- Checks ----------------------------------------------------------------

// The DC to succeed and every further tier that has a DC, lowest DC first. The
// success tier carries the id "success".
export function ladder(act) {
  const list = [];
  if (act.dc != null) list.push({ id: 'success', label: 'Success', dc: act.dc, reward: act.success });
  for (const t of act.tiers) if (t.dc != null) list.push({ ...t, label: t.label.trim() || 'Unnamed tier' });
  return list.sort((x, y) => x.dc - y.dc);
}

// What a check result of `total` earns: { failure: true, reward, next } below
// every DC, otherwise { tier, reward, next } for the highest tier reached.
// `next` is the tier above (or null). Null when the activity sets no DC.
export function outcome(act, total) {
  const steps = ladder(act);
  if (!steps.length || !Number.isFinite(total)) return null;
  const reached = steps.filter(t => total >= t.dc).length;
  if (!reached) return { failure: true, tier: null, reward: act.failure, next: steps[0] };
  const tier = steps[reached - 1];
  return { failure: false, tier, reward: tier.reward, next: steps[reached] ?? null };
}

// ---- Player view -------------------------------------------------------------

// What the players may see of a plan: the timeline's activities with their
// titles, times, players and required check. Built from a list of the fields
// to keep, so DCs, rewards, tiers, premises, unscheduled activities and any
// field added to a plan later stay with the GM.
export function playerView(plan) {
  return {
    title: plan.title,
    startsAt: plan.startsAt,
    length: plan.length,
    snap: plan.snap,
    players: plan.players.map(p => ({ id: p.id, name: playerName(plan, p.id), color: p.color })),
    activities: plan.activities
      .filter(a => a.start != null)
      .map(a => ({ id: a.id, title: a.title, start: a.start, duration: a.duration, players: [...a.players], check: a.check })),
  };
}

// The checks the plan already names, for suggestions while typing another.
export function checkNames(plan) {
  const seen = new Map();
  for (const a of plan.activities) {
    const name = a.check.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((x, y) => x.localeCompare(y));
}
