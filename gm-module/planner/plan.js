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
// An activity has any number of checks: the ways it can be tried ("Stealth,
// or Bluff"). Each has a DC to succeed, any number of further tiers with
// their own DC and reward, and a failure. A result reaches the tier with the
// highest DC it meets; below every DC it is a failure.
//
// NPCs are the plan's cast. An activity links any number of them. Nothing
// stops one NPC being linked to two activities at once (a link can mean "about
// them" as well as "with them"), but `npcClashes` reports it.
//
// During play the GM records what happened in an activity (`result`): done,
// or one outcome of one of its checks. Notes are free text, each about an
// activity or one of its outcomes, or about nothing in particular. Links run
// from an activity, one of its outcomes, or a note, to an activity: they lead
// to it (green) or block it (red), and are in effect once their source has
// happened (see "Notes, links and what happened" below).
//
// Plan shape (one JSON file per session):
//   { version, title, startsAt: "19:00" | "", length (min), snap (min),
//     players: [{ id, name, color }],
//     npcs: [{ id, name, role, description, notes }],
//     notes: [{ id, text, about: Ref | null, happened }],
//     links: [{ id, from: Ref, to: activity id, kind: 'leads' | 'blocks' }],
//     activities: [{ id, title, start (min) | null, duration (min), players: [ids],
//                    maxPlayers | null, npcs: [ids], premise, result | null,
//                    checks: [{ id, check, dc | null, success, failure,
//                               tiers: [{ id, label, dc | null, reward }] }] }] }
//   result  { check: id | null, outcome: 'done' | 'failure' | 'success' | tier id }
//   Ref     { activity } (it happened), { activity, check, outcome } (that
//           outcome happened) or { note }
// Fields a plan carries beyond these are kept as they are. A plan from before
// an activity could have several checks keeps `check`, `dc`, `success`,
// `failure` and `tiers` on the activity; reading it makes them its one check.

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
    players: [], npcs: [], activities: [], notes: [], links: [],
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
    premise: '', checks: [blankCheck('c1')], result: null, ...fields,
  };
}

export function blankCheck(id, fields = {}) {
  return { id, check: '', dc: null, success: '', failure: '', tiers: [], ...fields };
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

function normalizeCheck(raw, taken) {
  const c = isObject(raw) ? raw : {};
  const id = text(c.id).trim();
  const tiers = [];
  for (const t of Array.isArray(c.tiers) ? c.tiers : []) tiers.push(normalizeTier(t, tiers));
  return {
    ...c,
    id: id && !taken.some(x => x.id === id) ? id : newId(taken, 'c'),
    check: text(c.check),
    dc: whole(c.dc, null),
    success: text(c.success),
    failure: text(c.failure),
    tiers,
  };
}

const LEGACY_CHECK = ['check', 'dc', 'success', 'failure', 'tiers'];
const filled = v => v != null && v !== '' && !(Array.isArray(v) && !v.length);

// An activity's checks: its `checks`, or, in a plan from before an activity
// could have several, the one check kept on the activity itself.
function readChecks(a) {
  if (Array.isArray(a.checks)) return a.checks;
  return LEGACY_CHECK.some(k => filled(a[k])) ? [{ id: 'c1', ...Object.fromEntries(LEGACY_CHECK.map(k => [k, a[k]])) }] : [];
}

// One activity in canonical shape. `known` ({ players, npcs } id lists, when
// given) drops players and NPCs the plan does not have. An activity with
// nobody in it cannot sit in a lane, so it is unscheduled.
export function normalizeActivity(raw, known = null) {
  const src = isObject(raw) ? raw : {};
  const checks = [];
  for (const c of readChecks(src)) checks.push(normalizeCheck(c, checks));
  const a = Object.fromEntries(Object.entries(src).filter(([k]) => !LEGACY_CHECK.includes(k)));
  const players = idList(a.players, known?.players);
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
    checks,
    result: normalizeResult(a.result, { checks }),
  };
}

export function normalizePlan(raw) {
  const src = isObject(raw) ? raw : {};
  let plan;
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
  plan = {
    ...src,
    version: PLAN_VERSION,
    title: src.title === undefined ? DEFAULTS.title : text(src.title),
    startsAt: CLOCK.test(src.startsAt) ? src.startsAt : '',
    length: whole(src.length, DEFAULTS.length, 1),
    snap: SNAPS.includes(Number(src.snap)) ? Number(src.snap) : DEFAULTS.snap,
    players,
    npcs,
    activities,
    notes: (Array.isArray(src.notes) ? src.notes : []).filter(isObject).reduce((list, n) => {
      const id = text(n.id).trim();
      list.push({ ...n, id: id && !list.some(x => x.id === id) ? id : newId(list, 'note'), text: text(n.text), about: n.about ?? null, happened: n.happened === true });
      return list;
    }, []),
    links: Array.isArray(src.links) ? src.links : [],
  };
  pruneRefs(plan);
  return plan;
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
  const copy = { ...structuredClone(src), id: newId(plan.activities, 'a'), result: null };
  if (copy.start != null) copy.start = firstFree(plan, copy, end(src));
  plan.activities.splice(plan.activities.indexOf(src) + 1, 0, copy);
  return { ok: true, activity: copy };
}

export function deleteActivity(plan, id) {
  plan.activities = plan.activities.filter(a => a.id !== id);
  pruneRefs(plan);
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

// Another way to try an activity. It starts with the last check's DC and
// outcomes (often the same, whichever way it is tried), with no name.
export function addCheck(act) {
  const last = act.checks.at(-1);
  const check = normalizeCheck(last ? { ...structuredClone(last), id: '', check: '' } : {}, act.checks);
  act.checks.push(check);
  return check;
}

// Results, notes and links that named the check are cleared by pruneRefs.
export function removeCheck(act, id) {
  act.checks = act.checks.filter(c => c.id !== id);
}

// One check's DC to succeed and every further tier that has a DC, lowest DC
// first. The success tier carries the id "success".
export function ladder(check) {
  const list = [];
  if (check.dc != null) list.push({ id: 'success', label: 'Success', dc: check.dc, reward: check.success });
  for (const t of check.tiers) if (t.dc != null) list.push({ ...t, label: t.label.trim() || 'Unnamed tier' });
  return list.sort((x, y) => x.dc - y.dc);
}

// What a result of `total` on a check earns: { failure: true, reward, next }
// below every DC, otherwise { tier, reward, next } for the highest tier
// reached. `next` is the tier above (or null). Null when the check sets no DC.
export function outcome(check, total) {
  const steps = ladder(check);
  if (!steps.length || !Number.isFinite(total)) return null;
  const reached = steps.filter(t => total >= t.dc).length;
  if (!reached) return { failure: true, tier: null, reward: check.failure, next: steps[0] };
  const tier = steps[reached - 1];
  return { failure: false, tier, reward: tier.reward, next: steps[reached] ?? null };
}

// ---- Notes, links and what happened ---------------------------------------------

export const LINK_KINDS = Object.freeze(['leads', 'blocks']);
const BASE_OUTCOMES = ['failure', 'success'];

// The outcomes one check can have: failure, success, and its tiers.
const outcomesOf = check => [...BASE_OUTCOMES, ...check.tiers.map(t => t.id)];

function normalizeResult(raw, act) {
  if (!isObject(raw)) return null;
  if (raw.outcome === 'done') return { check: null, outcome: 'done' };
  const check = act.checks.find(c => c.id === raw.check);
  return check && outcomesOf(check).includes(raw.outcome) ? { check: check.id, outcome: raw.outcome } : null;
}

// A Ref in canonical shape, or null when what it names is not in the plan.
// `notes` false: a note may not be about another note.
function normalizeRef(raw, plan, { notes = true } = {}) {
  if (!isObject(raw)) return null;
  if (raw.note !== undefined) return notes && plan.notes.some(n => n.id === raw.note) ? { note: raw.note } : null;
  const act = plan.activities.find(a => a.id === raw.activity);
  if (!act) return null;
  if (raw.check === undefined && raw.outcome === undefined) return { activity: act.id };
  const check = act.checks.find(c => c.id === raw.check);
  return check && outcomesOf(check).includes(raw.outcome) ? { activity: act.id, check: check.id, outcome: raw.outcome } : null;
}

export const refKey = r => (r.note !== undefined ? `n:${r.note}` : r.check ? `a:${r.activity}:${r.check}:${r.outcome}` : `a:${r.activity}`);

// Clears what no longer exists: results naming a removed check or tier, notes
// about something gone, links from or to something gone. Also drops a link from
// an activity to itself and a link that repeats another. Runs after every edit
// and whenever a plan is read.
export function pruneRefs(plan) {
  for (const a of plan.activities) a.result = normalizeResult(a.result, a);
  for (const n of plan.notes) n.about = normalizeRef(n.about, plan, { notes: false });
  const seen = new Set();
  const links = [];
  for (const raw of plan.links) {
    if (!isObject(raw)) continue;
    const from = normalizeRef(raw.from, plan);
    const to = plan.activities.find(a => a.id === raw.to)?.id;
    const kind = LINK_KINDS.includes(raw.kind) ? raw.kind : null;
    if (!from || !to || !kind || from.activity === to) continue;
    const key = `${refKey(from)}>${to}>${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = text(raw.id).trim();
    links.push({ ...raw, id: id && !links.some(l => l.id === id) ? id : newId(links, 'l'), from, to, kind });
  }
  plan.links = links;
}

// Whether what a Ref names has happened.
export function refHappened(plan, ref) {
  if (!ref) return false;
  if (ref.note !== undefined) {
    const note = plan.notes.find(n => n.id === ref.note);
    return !!note && (note.happened || refHappened(plan, note.about));
  }
  const act = plan.activities.find(a => a.id === ref.activity);
  if (!act?.result) return false;
  return !ref.check || (act.result.check === ref.check && act.result.outcome === ref.outcome);
}

// Where an activity stands because of the links into it: 'blocked' (a link
// blocking it is in effect), 'waiting' (links lead to it, none in effect yet),
// 'open' (one leading to it is in effect) or 'free' (none lead to it).
export function activityState(plan, id) {
  const into = plan.links.filter(l => l.to === id);
  const live = into.filter(l => refHappened(plan, l.from));
  const blockedBy = live.filter(l => l.kind === 'blocks');
  const leads = into.filter(l => l.kind === 'leads');
  const openedBy = live.filter(l => l.kind === 'leads');
  const state = blockedBy.length ? 'blocked' : leads.length ? (openedBy.length ? 'open' : 'waiting') : 'free';
  return { state, blockedBy, openedBy, leads };
}

// The outcomes an activity can have, for choosing a result or a link's source:
// [{ check, outcome, label }], each check's failure, success and tiers.
export function outcomeChoices(act) {
  const many = act.checks.length > 1;
  return act.checks.flatMap((c, i) => {
    const name = c.check.trim() || `Check ${i + 1}`;
    const label = o => (many || c.check.trim() ? `${name}: ${o}` : o);
    return [
      { check: c.id, outcome: 'failure', label: label('Failure') },
      { check: c.id, outcome: 'success', label: label('Success') },
      ...c.tiers.map(t => ({ check: c.id, outcome: t.id, label: label(t.label.trim() || 'Unnamed tier') })),
    ];
  });
}

// "Done", "Stealth: Success", or '' for no result.
export function resultText(act) {
  const r = act.result;
  if (!r) return '';
  if (r.outcome === 'done') return 'Done';
  return outcomeChoices(act).find(o => o.check === r.check && o.outcome === r.outcome)?.label ?? '';
}

const firstLine = s => {
  const line = s.split('\n').find(l => l.trim())?.trim() ?? '';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
};
export const noteTitle = note => firstLine(note.text) || 'Empty note';

// What a Ref names, for the page: "“Pick the lock”", "“Pick the lock”: Failure",
// "the note “The guard saw them”".
export function refText(plan, ref) {
  if (!ref) return 'nothing';
  if (ref.note !== undefined) {
    const note = plan.notes.find(n => n.id === ref.note);
    return note ? `the note “${noteTitle(note)}”` : 'a deleted note';
  }
  const act = plan.activities.find(a => a.id === ref.activity);
  if (!act) return 'a deleted activity';
  const title = `“${act.title.trim() || 'Untitled'}”`;
  if (!ref.check) return title;
  const o = outcomeChoices(act).find(x => x.check === ref.check && x.outcome === ref.outcome);
  return o ? `${title}: ${o.label}` : title;
}

export function addNote(plan, fields = {}) {
  const note = { id: newId(plan.notes, 'note'), text: '', about: null, happened: false, ...fields };
  plan.notes.push(note);
  pruneRefs(plan);
  return note;
}

export function removeNote(plan, id) {
  plan.notes = plan.notes.filter(n => n.id !== id);
  pruneRefs(plan);
}

// A link from `from` (a Ref) to activity `to`. Refused when either end is not
// in the plan, it would link an activity to itself, or the same link exists.
export function addLink(plan, from, to, kind) {
  const before = plan.links.length;
  const link = { id: newId(plan.links, 'l'), from, to, kind };
  plan.links.push(link);
  pruneRefs(plan);
  if (plan.links.length === before) {
    return { ok: false, error: from?.activity === to ? 'An activity cannot lead to or block itself.' : 'That link is already there, or names something not in the plan.' };
  }
  return { ok: true, link: plan.links.at(-1) };
}

export function removeLink(plan, id) {
  plan.links = plan.links.filter(l => l.id !== id);
}

// ---- Recap -------------------------------------------------------------------
//
// What a session came to, from the results recorded during play: what each
// activity that happened came to, the rewards earned and by whom, what did not
// happen (blocked, or never played), and the notes that happened. No times:
// the clock is the GM's to bend, and the recap is about what happened.

// What a result earned: the reward of the success or tier reached, or the
// failure's consequence (with `failure` set), or nothing for "done".
function resultOutcome(act) {
  const r = act.result;
  if (!r || r.outcome === 'done') return { text: '', failure: false };
  const check = act.checks.find(c => c.id === r.check);
  if (!check) return { text: '', failure: false };
  if (r.outcome === 'failure') return { text: check.failure.trim(), failure: true };
  if (r.outcome === 'success') return { text: check.success.trim(), failure: false };
  return { text: check.tiers.find(t => t.id === r.outcome)?.reward.trim() ?? '', failure: false };
}

export function recap(plan) {
  const ordered = [...plan.activities].sort((x, y) => (x.start ?? Infinity) - (y.start ?? Infinity));
  const title = a => a.title.trim() || 'Untitled';
  const names = a => a.players.map(p => playerName(plan, p));
  const played = [];
  const blocked = [];
  const notPlayed = [];
  for (const a of ordered) {
    if (a.result) {
      const { text: outcome, failure } = resultOutcome(a);
      played.push({ title: title(a), players: names(a), event: a.event === true, result: resultText(a), outcome, failure });
      continue;
    }
    const { state, blockedBy } = activityState(plan, a.id);
    if (state === 'blocked') blocked.push({ title: title(a), players: names(a), by: blockedBy.map(l => refText(plan, l.from)) });
    else notPlayed.push({ title: title(a), players: names(a) });
  }
  const rewards = played.filter(e => e.outcome && !e.failure).map(e => ({ players: e.players, text: e.outcome, from: e.title }));
  const notes = plan.notes.filter(n => n.text.trim() && refHappened(plan, { note: n.id })).map(n => n.text.trim());
  return { title: plan.title.trim() || 'Untitled session', played, rewards, blocked, notPlayed, notes };
}

// Markdown's own characters, escaped so a title cannot turn into formatting.
const md = s => s.replace(/([\\`*_[\]#|<>])/g, '\\$1');
const mdLines = s => md(s).split('\n').map(l => l.trim()).filter(Boolean).join(' ');
const who = list => (list.length ? ` (${md(list.join(', '))})` : '');

// The recap as Markdown, for a campaign log. `notes: false` leaves the notes
// out (they may hold what the players must not read).
export function recapMarkdown(plan, { notes = true } = {}) {
  const r = recap(plan);
  const out = [`# ${md(r.title)}: recap`, ''];
  out.push('## What happened', '');
  if (r.played.length) {
    for (const e of r.played) out.push(`- **${md(e.title)}**${who(e.players)}: ${md(e.result)}.${e.outcome ? ` ${mdLines(e.outcome)}` : ''}`);
  } else out.push('Nothing recorded yet.');
  if (r.rewards.length) {
    out.push('', '## Rewards', '');
    for (const w of r.rewards) out.push(`- ${w.players.length ? `${md(w.players.join(', '))}: ` : ''}${mdLines(w.text)} (${md(w.from)})`);
  }
  if (r.blocked.length || r.notPlayed.length) {
    out.push('', '## Did not happen', '');
    for (const b of r.blocked) out.push(`- **${md(b.title)}**${who(b.players)}: blocked by ${md(b.by.join(', '))}.`);
    for (const n of r.notPlayed) out.push(`- **${md(n.title)}**${who(n.players)}: not played.`);
  }
  if (notes && r.notes.length) {
    out.push('', '## Notes', '');
    for (const n of r.notes) out.push(`- ${mdLines(n)}`);
  }
  return out.join('\n') + '\n';
}

// ---- Player view -------------------------------------------------------------

// What the players may see of a plan: the timeline's activities with their
// titles, times, players and the names of their checks. Built from a list of the fields
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
      .map(a => ({
        id: a.id, title: a.title, start: a.start, duration: a.duration, players: [...a.players],
        checks: a.checks.filter(c => c.check.trim()).map(c => ({ check: c.check })),
      })),
  };
}

// The checks the plan already names, for suggestions while typing another.
export function checkNames(plan) {
  const seen = new Map();
  for (const a of plan.activities) {
    for (const c of a.checks) {
      const name = c.check.trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()].sort((x, y) => x.localeCompare(y));
}
