// Plan files on disk: one JSON file per session plan, all in one folder. Every
// write names the version of the file the writer last read, so a change made
// to the file some other way while the page is open (by hand, or by the GM's
// tools) is never written over: the writer gets the current copy back instead.
// A version is a hash of the file's bytes.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { blankPlan, normalizePlan, playerView } from './plan.js';

// A plan's name is its file name without ".json": letters, digits, spaces,
// dashes and underscores, so a name never reaches outside the folder. Windows
// reserves a few device names whatever the extension.
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 _-]{0,62}[A-Za-z0-9_-])?$/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
export const validName = name => typeof name === 'string' && NAME.test(name) && !RESERVED.test(name);

const fileOf = (dir, name) => path.join(dir, `${name}.json`);
const versionOf = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

// The version of a plan file, or null when there is no such file.
export function currentVersion(dir, name) {
  try {
    return versionOf(fs.readFileSync(fileOf(dir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function readPlan(dir, name) {
  const raw = fs.readFileSync(fileOf(dir, name), 'utf8');
  return { v: versionOf(raw), plan: normalizePlan(JSON.parse(raw)) };
}

// The players' view of a plan, or null when there is no such file. Its
// version is a hash of the view itself, so a change only the GM can see (a DC,
// a reward) does not register as a change for the players.
export function readPlayerView(dir, name) {
  if (currentVersion(dir, name) === null) return null;
  const view = playerView(readPlan(dir, name).plan);
  return { v: versionOf(JSON.stringify(view)), view };
}

export function listPlans(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && validName(f.slice(0, -5)))
    .map(f => {
      const name = f.slice(0, -5);
      try {
        const { plan } = readPlan(dir, name);
        return { name, title: plan.title, players: plan.players.length, activities: plan.activities.length };
      } catch (err) {
        return { name, title: '', error: String(err.message ?? err) };
      }
    })
    .sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
}

// Writes `plan` (normalised) if the file is still at version `base`; `base`
// null means the file must not exist yet. Returns { ok: true, v } or, when the
// file has moved on, { ok: false, v, plan } with the file's current contents
// (v and plan null when the file is gone).
export function writePlan(dir, name, plan, base) {
  const now = currentVersion(dir, name);
  if (now !== base) return { ok: false, ...(now === null ? { v: null, plan: null } : readPlan(dir, name)) };
  const bytes = JSON.stringify(normalizePlan(plan), null, 2) + '\n';
  fs.mkdirSync(dir, { recursive: true });
  const file = fileOf(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows refuses the rename while another program holds the file open.
    fs.writeFileSync(file, bytes);
    fs.rmSync(tmp, { force: true });
  }
  return { ok: true, v: versionOf(bytes) };
}

// A plan with no activities, starting with the given players and NPCs (a new
// session usually has the same table and many of the same people).
export function createPlan(dir, name, title, { players = [], npcs = [] } = {}) {
  const plan = { ...blankPlan(title || name), players, npcs };
  const out = writePlan(dir, name, plan, null);
  return out.ok ? { ok: true, v: out.v, plan: normalizePlan(plan) } : out;
}
