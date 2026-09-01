/**
 * Small shared helpers: path access, name keys, string distance.
 *
 * Everything here is used by more than one domain module and belongs to none
 * of them. Nothing in this file knows what a character is.
 */

import { carriesTotal, evaluateFormula } from '../formula.js';

export const slug = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'x';

/** How the specialty picks name a skill: its skill and its variant together. */
export const skillKey = (s) => `${s.name}|${s.spec || ''}`;

/**
 * The name a formula forwards a bonus to a skill under -- the same slug the
 * scope publishes the skill's total as, so `{= skill.bluff}` and
 * `{skill.bluff += 4}` can never mean two different rows.
 */
export const skillForwardKey = (s) => `skill.${slug(s.spec ? `${s.name} ${s.spec}` : s.name)}`;

/** The name a formula forwards a bonus to a class's effective level under. */
export const classForwardKey = (name) => `class.${slug(name)}.level`;

/**
 * The name a formula calls a movement rate by, worked out from its type.
 *
 * "Land" is `speed.land` and "Fly (average)" is `speed.fly` -- cut at the
 * first bracket the way a weapon's name is, because the manoeuvrability is a
 * note on the speed rather than part of what it is called.
 *
 * A row with no type has no name. It is not a movement rate yet, and coining
 * one for it would put a name on the sheet that means nothing today and means
 * something else the moment the row is typed into.
 */
export function speedForwardKey(sp) {
  const head = String(sp?.type ?? '').split(/[(,/[]/)[0].trim();
  return head ? `speed.${slug(head)}` : null;
}

/**
 * A bonus that may be a number or a formula, worked out either way.
 *
 * The one shape every "+N" field on the sheet shares once it is allowed to
 * be written as a rule: a plain number is itself, a string is evaluated in
 * the scope handed in, and what comes back is an integer -- a bonus to a
 * caster level or a save is one -- with the error, if the formula had one,
 * kept beside it for the field and the audit to show.
 */
export function evaluateAmount(raw, scope) {
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const v = Number(evaluateFormula(raw, scope));
      return { value: Number.isFinite(v) ? Math.floor(v) : 0, error: null };
    } catch (err) {
      return { value: 0, error: err.message };
    }
  }
  return { value: Number(raw) || 0, error: null };
}

/** A stored amount, kept as the formula it was typed as or read as a number. */
export const amountOrText = (v) => (typeof v === 'string' && v.trim() !== '' && !/^-?\d+(\.\d+)?$/.test(v.trim())
  ? v : Number(v) || 0);

export function getPath(obj, path) {
  return String(path).split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  const target = keys.reduce((a, k) => {
    if (a[k] == null || typeof a[k] !== 'object') a[k] = {};
    return a[k];
  }, obj);
  target[last] = value;
}

/* ------------------------------------------------------------------ *
 * Item Crafting: from the sheet's grid to a structured block.
 * ------------------------------------------------------------------ */

export function safe(fn, fallback) {
  try {
    const v = fn();
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The dotted names in a scope object: {essence: {self: 3}} -> ['essence.self'].
 *
 * One definition, used both for the character's own names and for the little
 * local scopes a field brings with it, so "what may this formula read" is
 * answered the same way in both places.
 *
 * A branch that carries its own `total` is a name in its own right as well as
 * a prefix, and is listed both ways -- `saves.will` and `saves.will.luck` are
 * both things to read. resolvePath() is what makes the first of those a
 * number; this is what makes it a name the sheet admits to having.
 */
export function flatNames(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (carriesTotal(v)) out.push(path);
      out.push(...flatNames(v, path));
    } else out.push(path);
  }
  return out;
}

/** The sheet leaves an unreadable glyph where its dashes were. */
const isPlaceholder = (v) => v === null || v === undefined
  || String(v).trim() === '' || /^[�–—-]+$/.test(String(v).trim());

/* ------------------------------------------------------------------ *
 * The shared discipline catalogue.
 *
 * Knowing a discipline grants every maneuver in it, so a character records
 * which disciplines they know and which maneuvers they have readied -- not a
 * copy of the discipline's contents. The names and types come from
 * the Path of War disciplines extension pack (`data/extensions/path-of-war-disciplines.json`), built from the workbook's own maneuversRef tab by
 * tools/maneuvers_ref.py; it is identical in every workbook, so one shared
 * file replaces up to 20 KB of catalogue per character.
 *
 * Registered once at startup and read synchronously afterwards. With no
 * catalogue loaded a character still opens: its disciplines list what it
 * knows, they simply have no maneuvers to offer.
 * ------------------------------------------------------------------ */

export const normalizeName = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Edit distance, abandoned once it cannot come in under `limit`.
 *
 * Swapping two neighbours counts as one slip rather than two, because that is
 * what typing "Oracel" for "Oracle" actually is -- and a plain edit distance
 * charges two for it, which puts the commonest typo of all out of reach of a
 * one-slip allowance.
 */
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, before[j - 2] + 1);
      }
      row[j] = d;
      if (d < best) best = d;
    }
    if (best > limit) return limit + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The candidate `name` most likely meant, or '' for none.
 *
 * Returns the candidate as spelled in the list, so the caller gets the
 * canonical form back and can show what it corrected to.
 */
export function closestName(name, candidates) {
  const want = normalizeName(name);
  if (!want) return '';
  const list = [...new Set(candidates.map((c) => String(c ?? '')).filter(Boolean))];
  const exact = list.find((c) => normalizeName(c) === want);
  if (exact) return exact;

  const limit = want.length >= 12 ? 2 : 1;
  let best = limit + 1;
  let winner = '';
  let tied = false;
  for (const c of list) {
    const d = editDistance(want, normalizeName(c), limit);
    if (d > limit) continue;
    if (d < best) { best = d; winner = c; tied = false; } else if (d === best) tied = true;
  }
  return tied ? '' : winner;
}

/* ------------------------------------------------------------------ *
 * The shared casting table.
 *
 * A casting block records which class's table it draws from, not a copy of the
 * table: 34 classes of slots per day and spells known, for class levels 1-20
 * across spell levels 0-9, live in the casting-tables extension pack (`data/extensions/vancian-casting-tables.json`), built from the
 * workbook's own vancianRef tab by tools/vancian_ref.py.
 *
 * The workbook reached those same numbers through a named range that was never
 * widened when classes were appended to the tab, so its last two -- Legendary
 * Sorceror and Pale Theologian -- had full tables that nothing could read. All
 * 34 are here.
 * ------------------------------------------------------------------ */

export const numOrNull = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * One typed-bonus block -- a save's or the AC's -- resolved against `scope`.
 *
 * Every cell is either a plain number or a formula in the tracker sandbox, so
 * a conditional bonus can be written as the rule it is rather than as a number
 * that goes stale. A cell that throws contributes nothing and leaves its
 * message in `errors`, so one bad formula cannot take the sheet down with it.
 */
/**
 * One number a player may have written as a formula instead.
 *
 * The half-dozen fields that work this way -- a skill's Misc, the extra
 * language slots, the death threshold, the hit-point parts -- all wanted the
 * same six lines, and each copy was a place for the rounding or the empty
 * case to drift. Truncated towards zero rather than floored, as every other
 * resolved bonus on the sheet is, so a penalty of 2.5 is −2 and not −3.
 *
 * Returns `{ value, error }`: a formula that throws contributes nothing and
 * leaves its message to be shown beside the field and in the Formula Audit.
 */
export function resolveNumberField(scope, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { value: Number(raw) || 0, error: null };
  try {
    return { value: Math.trunc(Number(evaluateFormula(raw, scope)) || 0), error: null };
  } catch (err) {
    return { value: 0, error: err.message };
  }
}

/**
 * Resolve several of them onto a block, each under `<field>Resolved` and
 * `<field>Error`. Returns the resolved values by field name.
 */
export function resolveNumberFields(scope, block, fields) {
  const out = {};
  for (const key of fields) {
    const { value, error } = resolveNumberField(scope, block?.[key]);
    out[key] = value;
    if (block) {
      block[`${key}Resolved`] = value;
      block[`${key}Error`] = error;
    }
  }
  return out;
}

export function resolveBonusBlock(scope, block, types, errors) {
  const out = {};
  for (const [key] of types) {
    const raw = block?.[key];
    if (typeof raw !== 'string' || raw.trim() === '') {
      out[key] = Number(raw) || 0;
      continue;
    }
    try {
      out[key] = Math.trunc(Number(evaluateFormula(raw, scope)) || 0);
    } catch (err) {
      out[key] = 0;
      errors[key] = err.message;
    }
  }
  return out;
}

export const pad = (arr, n, fill) => Array.from({ length: n }, (_, i) => arr?.[i] ?? (typeof fill === 'function' ? fill() : fill));

export const cleanText = (v) => (v === null || v === undefined ? '' : String(v).trim());
