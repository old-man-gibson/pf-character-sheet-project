/**
 * Feats, spells and powers: three catalogues, one shape.
 *
 * They arrive the way veils do and for the same reason. A feat, a spell and a
 * psionic power are **content** -- somebody's book -- so what the sheet keeps
 * is the *name* the player picked and whatever they wrote about it
 * themselves. The rules text stays in the pack and is read where it stands,
 * which is what lets a corrected pack correct every character already playing
 * one, and what keeps an exported character a list of names rather than
 * fifteen megabytes of other people's paragraphs.
 *
 * That is the whole argument for these being tables rather than blocks, and
 * it is why none of this is in the extension manager's block picker: a feat
 * is not attached from there, it is *picked* on the sheet, beside the other
 * feats, the way a veil is picked in its chakra.
 *
 * The three are one module because they are one mechanism with three names.
 * A catalogue is a list of entries under unique names; a picker narrows it by
 * the lists a character is actually on; a row on the sheet is a name plus the
 * player's own writing. Only the narrowing differs -- a spell by the class
 * whose list it is on and at what level, a feat by its type -- and that is a
 * function each catalogue is given rather than a third copy of the rest.
 */

const str = (v) => (v === null || v === undefined ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const lower = (s) => str(s).trim().toLowerCase();

/** Unique by name, first spelling winning, as every catalogue here wants. */
const uniqueBy = (list, key = (s) => lower(s)) => {
  const seen = new Map();
  for (const x of list) if (x && !seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
};

/**
 * `[{name, level}]` however a pack wrote it.
 *
 * The importer produces the pairs, but a pack written by hand may well say
 * `"Wizard 3, Cleric 4"` in a string, and that is a reasonable thing to have
 * written. Both read the same here so that neither is wrong.
 */
function classList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((c) => (typeof c === 'string'
      ? { name: c.trim(), level: null }
      : { name: str(c?.name).trim(), level: Number.isFinite(Number(c?.level)) ? Number(c.level) : null }))
      .filter((c) => c.name);
  }
  return str(raw).split(/\s*,\s*/).map((part) => {
    const m = part.trim().match(/^(.*?)\s+(\d+)$/);
    if (m) return { name: m[1].trim(), level: Number(m[2]) };
    return part.trim() ? { name: part.trim(), level: null } : null;
  }).filter(Boolean);
}

/* ---------------- one catalogue ---------------- */

/**
 * A catalogue and everything done to one.
 *
 * `key` is the list's name inside the table document (`feats.feats`), `shape`
 * turns a pack's entry into the canonical one, and `fields` are the ones a
 * reader shows above the prose -- named per catalogue because a spell's
 * school and a power's display are not the same row of a card.
 */
function catalogue({ key, shape, fields }) {
  let held = { [key]: [] };

  const set = (doc) => {
    held = { [key]: arr(doc?.[key]).map(shape).filter((x) => x.name) };
  };
  const all = () => held;
  const list = () => held[key];
  const entry = (name) => {
    const k = lower(name);
    return k ? list().find((x) => lower(x.name) === k) || null : null;
  };

  /**
   * What the player wrote themselves, and nothing else.
   *
   * Kept apart from `details` so that picking an entry can never copy the
   * catalogue's text onto the character -- the mistake that would quietly
   * undo the whole arrangement, one sheet at a time.
   */
  const own = (row) => ({ detail: str(row?.detail), note: str(row?.note) });
  const isWritten = (row) => {
    const o = own(row);
    return o.detail.trim() !== '' || o.note.trim() !== '';
  };

  /**
   * A picked entry as a reader wants it: the player's own writing where there
   * is any, the catalogue's underneath, and the fields the sheet never
   * stored. `known` says whether the catalogue has it at all, so a row can
   * tell one whose pack is switched off from one the player typed themselves.
   */
  const details = (row) => {
    const shared = entry(row?.name);
    return {
      name: str(row?.name),
      known: !!shared,
      own: own(row),
      text: str(shared?.text),
      source: str(shared?.source),
      fields: shared ? fields(shared) : [],
      entry: shared,
    };
  };

  return {
    set, all, list, entry, own, isWritten, details,
  };
}

/** `Fort half` and `Yes` are worth a line each; an empty one is not. */
const row = (pairs) => pairs.filter(([, v]) => str(v).trim()).map(([k, v]) => [k, str(v).trim()]);

/* ---------------- feats ---------------- */

const FEATS = catalogue({
  key: 'feats',
  shape: (f) => ({
    name: str(f?.name).trim(),
    type: str(f?.type).trim(),
    prerequisites: str(f?.prerequisites).trim(),
    text: str(f?.text),
    source: str(f?.source).trim(),
  }),
  fields: (f) => row([['Type', f.type], ['Prerequisites', f.prerequisites]]),
});

export const setFeatCatalogue = (doc) => FEATS.set(doc);
export const featCatalogue = () => FEATS.all();
export const featEntry = (name) => FEATS.entry(name);
export const featOwn = (r) => FEATS.own(r);
export const featIsWritten = (r) => FEATS.isWritten(r);
export const featDetails = (r) => FEATS.details(r);

/** Every feat type any feat names, for a picker that groups by them. */
export function featTypes() {
  return uniqueBy(FEATS.list().flatMap((f) => f.type.split(/\s*,\s*/).filter(Boolean)), (s) => s.toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The feats a picker should offer, narrowed by type where one is asked for.
 *
 * Unlike a veil there is no class list to narrow on -- a feat is open to
 * anyone who meets its prerequisites, and reading those is a job for a person
 * rather than for this. So the list is long on purpose, and the type is the
 * only filter the sheet has any business applying.
 */
export function featsAvailable({ type = null } = {}) {
  const want = lower(type);
  return FEATS.list()
    .filter((f) => !want || f.type.toLowerCase().split(/\s*,\s*/).includes(want))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- spells ---------------- */

const SPELLS = catalogue({
  key: 'spells',
  shape: (s) => ({
    name: str(s?.name).trim(),
    classes: classList(s?.classes),
    level: Number.isFinite(Number(s?.level)) ? Number(s.level) : null,
    school: str(s?.school).trim(),
    descriptor: str(s?.descriptor).trim(),
    components: str(s?.components).trim(),
    time: str(s?.time).trim(),
    range: str(s?.range).trim(),
    target: str(s?.target).trim(),
    duration: str(s?.duration).trim(),
    save: str(s?.save).trim(),
    sr: str(s?.sr).trim(),
    text: str(s?.text),
    source: str(s?.source).trim(),
  }),
  fields: (s) => row([
    ['School', s.school], ['Descriptors', s.descriptor], ['Components', s.components],
    ['Casting time', s.time], ['Range', s.range], ['Target', s.target],
    ['Duration', s.duration], ['Saving throw', s.save], ['Spell resistance', s.sr],
  ]),
});

export const setSpellCatalogue = (doc) => SPELLS.set(doc);
export const spellCatalogue = () => SPELLS.all();
export const spellEntry = (name) => SPELLS.entry(name);
export const spellOwn = (r) => SPELLS.own(r);
export const spellIsWritten = (r) => SPELLS.isWritten(r);
export const spellDetails = (r) => SPELLS.details(r);

/** Every class any spell is listed for, in the order a picker names them. */
export function spellClasses() {
  return uniqueBy(SPELLS.list().flatMap((s) => s.classes.map((c) => c.name)), (s) => s.toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

/**
 * The spells a picker should offer, narrowed to a class's list and a level.
 *
 * The two narrowings behave the way the veil picker's do, and for the same
 * reason: **narrowing on data nobody imported must widen the answer, not
 * empty it**. A catalogue whose spells name no class at all knows no class
 * for any of them, so filtering by class would offer nothing; a spell that
 * happens to name none stays on offer beside the ones that do.
 */
export function spellsAvailable({ classes = [], level = null } = {}) {
  const want = (Array.isArray(classes) ? classes : [classes]).map(lower).filter(Boolean);
  const lvl = Number.isFinite(Number(level)) && level !== null && level !== '' ? Number(level) : null;
  const anyClassKnown = want.length > 0 && SPELLS.list().some((s) => s.classes.length);
  return SPELLS.list()
    .filter((s) => !anyClassKnown || !s.classes.length
      || s.classes.some((c) => want.includes(c.name.toLowerCase())))
    .filter((s) => {
      if (lvl === null) return true;
      if (!s.classes.length) return true;
      const mine = want.length
        ? s.classes.filter((c) => want.includes(c.name.toLowerCase()))
        : s.classes;
      const levels = (mine.length ? mine : s.classes).map((c) => c.level).filter((n) => Number.isFinite(n));
      return !levels.length || levels.includes(lvl);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- powers ---------------- */

/**
 * Psionic powers and kineticist wild talents share this one.
 *
 * They are not the same thing -- a power has a discipline and costs power
 * points, a wild talent has an element and costs burn -- but they are picked
 * the same way, off the same tab, out of the same books. `kind` keeps them
 * apart for anything that needs them apart, and `fields` shows whichever set
 * the entry actually has.
 */
const POWERS = catalogue({
  key: 'powers',
  shape: (p) => ({
    name: str(p?.name).trim(),
    kind: lower(p?.kind) === 'wild talent' ? 'wild talent' : 'power',
    classes: classList(p?.classes),
    level: Number.isFinite(Number(p?.level)) ? Number(p.level) : null,
    discipline: str(p?.discipline).trim(),
    points: str(p?.points).trim(),
    display: str(p?.display).trim(),
    type: str(p?.type).trim(),
    element: str(p?.element).trim(),
    burn: str(p?.burn).trim(),
    blastType: str(p?.blastType).trim(),
    damage: str(p?.damage).trim(),
    time: str(p?.time).trim(),
    range: str(p?.range).trim(),
    target: str(p?.target).trim(),
    duration: str(p?.duration).trim(),
    save: str(p?.save).trim(),
    sr: str(p?.sr).trim(),
    text: str(p?.text),
    source: str(p?.source).trim(),
  }),
  fields: (p) => row([
    ['Discipline', p.discipline], ['Power points', p.points], ['Display', p.display],
    ['Element', p.element], ['Type', p.type], ['Burn', p.burn],
    ['Blast type', p.blastType], ['Damage', p.damage],
    ['Manifesting time', p.time], ['Range', p.range], ['Target', p.target],
    ['Duration', p.duration], ['Saving throw', p.save], ['Power resistance', p.sr],
  ]),
});

export const setPowerCatalogue = (doc) => POWERS.set(doc);
export const powerCatalogue = () => POWERS.all();
export const powerEntry = (name) => POWERS.entry(name);
export const powerOwn = (r) => POWERS.own(r);
export const powerIsWritten = (r) => POWERS.isWritten(r);
export const powerDetails = (r) => POWERS.details(r);

/** Every class any power is listed for. */
export function powerClasses() {
  return uniqueBy(POWERS.list().flatMap((p) => p.classes.map((c) => c.name)), (s) => s.toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

/** Narrowed the way spells are, and additionally by `kind` where one is asked for. */
export function powersAvailable({ classes = [], level = null, kind = null } = {}) {
  const want = (Array.isArray(classes) ? classes : [classes]).map(lower).filter(Boolean);
  const lvl = Number.isFinite(Number(level)) && level !== null && level !== '' ? Number(level) : null;
  const only = lower(kind);
  const anyClassKnown = want.length > 0 && POWERS.list().some((p) => p.classes.length);
  return POWERS.list()
    .filter((p) => !only || p.kind === only)
    .filter((p) => !anyClassKnown || !p.classes.length
      || p.classes.some((c) => want.includes(c.name.toLowerCase())))
    .filter((p) => {
      if (lvl === null) return true;
      // A wild talent's level is its own, there being no class list to read
      // it off; a power's is whichever of the character's lists carries it.
      if (!p.classes.length) return p.level === null || p.level === lvl;
      const mine = want.length
        ? p.classes.filter((c) => want.includes(c.name.toLowerCase()))
        : p.classes;
      const levels = (mine.length ? mine : p.classes).map((c) => c.level).filter((n) => Number.isFinite(n));
      return !levels.length || levels.includes(lvl);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------------- everything else the wiki knows ---------------- */

/**
 * The general reference catalogue: forty kinds of thing that are neither a
 * rule the sheet computes nor a block it attaches.
 *
 * A deity, a plane, a covenant, a special material, a madness. What they have
 * in common is that the sheet has nowhere to *put* them and no number to
 * change: they are looked up. So they are kept exactly as the page stated
 * them -- a name, its fields in the order they were written, its text -- and
 * grouped by kind, which is what a search says it found and what a picker
 * would group by if one is ever built for them.
 *
 * Kept apart from the three above because those have a home on the sheet and
 * these do not. A kind that earns one stops arriving here.
 */
let REFERENCE = { catalogues: [] };

export function setReferenceCatalogue(doc) {
  REFERENCE = {
    catalogues: arr(doc?.catalogues).map((g) => ({
      kind: lower(g?.kind),
      entries: arr(g?.entries).map((e) => ({
        name: str(e?.name).trim(),
        fields: arr(e?.fields)
          .map((f) => (Array.isArray(f) ? [str(f[0]).trim(), str(f[1]).trim()] : null))
          .filter((f) => f && f[0] && f[1]),
        text: str(e?.text),
        source: str(e?.source).trim(),
      })).filter((e) => e.name),
    })).filter((g) => g.kind),
  };
}

export function referenceCatalogue() {
  return REFERENCE;
}

/** Every kind the catalogue holds, with how many of each, biggest first. */
export function referenceKinds() {
  return REFERENCE.catalogues
    .map((g) => ({ kind: g.kind, count: g.entries.length }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/** One kind's entries, in name order; an empty list for a kind nobody imported. */
export function referenceEntries(kind) {
  const k = lower(kind);
  const group = REFERENCE.catalogues.find((g) => g.kind === k);
  return group ? [...group.entries].sort((a, b) => a.name.localeCompare(b.name)) : [];
}

/**
 * One entry by name. `kind` narrows where a name is ambiguous -- and it is:
 * a *word* and a *spirit* can share one, and so can an item and the deity it
 * is named for. Left off, the first kind holding that name answers.
 */
export function referenceEntry(name, kind = null) {
  const n = lower(name);
  if (!n) return null;
  for (const g of REFERENCE.catalogues) {
    if (kind && g.kind !== lower(kind)) continue;
    const hit = g.entries.find((e) => lower(e.name) === n);
    if (hit) return { ...hit, kind: g.kind };
  }
  return null;
}

/**
 * Names matching a query, across every kind or one of them.
 *
 * Names only, and capped. This catalogue runs to eleven thousand entries with
 * the whole wiki imported, and the thing asking is a picker or a search box
 * that wants an answer while somebody is still typing -- a full-text sweep of
 * forty megabytes of prose is a different feature with a different budget.
 */
export function referenceSearch(query, { kind = null, limit = 50 } = {}) {
  const q = lower(query);
  if (!q) return [];
  const out = [];
  for (const g of REFERENCE.catalogues) {
    if (kind && g.kind !== lower(kind)) continue;
    for (const e of g.entries) {
      if (!e.name.toLowerCase().includes(q)) continue;
      out.push({ kind: g.kind, name: e.name, source: e.source });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
