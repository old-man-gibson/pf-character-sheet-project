/**
 * Which rules system a wiki page belongs to.
 *
 * "System" is the grouping a player thinks in -- Path of War, Spheres of
 * Power, Akashic, Psionics -- and the one the wiki states least often. Only
 * classes and some archetypes carry a `system` field; a feat, a spell or a
 * race says which *book* it came from and leaves the rest to the reader.
 *
 * So this works outward from what the pages do say, strongest first:
 *
 *   1. the page's own `system` field, where the first one named is the home;
 *   2. its kind, when the kind only exists in one system -- a veil is
 *      Akashic, a martial ability is Path of War;
 *   3. a talent's sphere, and that sphere's page saying Magic, Combat or
 *      Skill. A sphere with no page of its own -- an older export has talents
 *      for spheres nobody had written up yet -- is judged last of all by the
 *      books its talents come from, since a talent is a Spheres rule whatever
 *      else it is;
 *   4. a feat's type -- an Akashic feat, a Psionic feat;
 *   5. the class an archetype or class option is written for, when that
 *      class's page names a system;
 *   6. the book. Every page placed by 1-5 is a vote for its book, and a book
 *      that is mostly one system carries its unplaced pages there too -- which
 *      is how the races and spells of an akashic book end up Akashic without
 *      anybody typing a list of book titles.
 *
 * What is left is third-party Pathfinder that belongs to no subsystem, and it
 * is called that rather than being forced anywhere.
 *
 * Nothing here is a table of titles. The only names written down are the
 * wiki's own vocabulary -- its system names, its kinds, its feat types -- so a
 * newer export with new books sorts itself.
 */

import { delink } from './wikitext.mjs';

export const GENERAL = 'Pathfinder Third-Party';

/** The wiki's `system` values, under the name the books go by. */
const CANON = new Map([
  ['maneuver', 'Path of War'],
  ['psionic', 'Psionics'],
]);
const canon = (s) => {
  const t = delink(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return CANON.get(t.toLowerCase()) ?? t;
};

/** Kinds that exist in exactly one system. */
const KIND_SYSTEM = {
  veil: 'Akashic',
  'akashic recipe': 'Akashic',
  'martial ability': 'Path of War',
  'martial discipline': 'Path of War',
  power: 'Psionics',
  'psionic item': 'Psionics',
  covenant: 'Covenant Magic',
  spirit: 'Pact Magic',
  constellation: 'Starcalling',
  petition: 'Petition',
  'wild talent': 'Kineticist',
};

/** What a sphere's page calls itself, and the book that kind of sphere is from. */
const SPHERE_TYPE = {
  magic: 'Spheres of Power',
  combat: 'Spheres of Might',
  skill: 'Spheres of Guile',
  origin: 'Spheres of Origin',
};
const SPHERES = new Set(Object.values(SPHERE_TYPE));

/** Feat types that name a system. Everything else -- Combat, Style, Racial -- names none. */
const FEAT_SYSTEM = {
  akashic: 'Akashic',
  metaveil: 'Akashic',
  psionic: 'Psionics',
  metapsionic: 'Psionics',
  'dual sphere': 'Champions of the Spheres',
  champion: 'Champions of the Spheres',
  pact: 'Pact Magic',
  metaconstellation: 'Starcalling',
  martial: 'Path of War',
};

/** A numbered family straight off the record: `class1`, `class2`… in order, and not `classlevel1`. */
const family = (fields, base) => Object.keys(fields)
  .map((k) => [k, k.match(new RegExp(`^${base}(\\d*)$`))])
  .filter(([, m]) => m)
  .sort((a, b) => Number(a[1][1] || 0) - Number(b[1][1] || 0))
  .map(([k]) => String(fields[k]).trim())
  .filter(Boolean);

const bookOf = (rec) => delink(family(rec.fields, 'sourcebook')[0] || '').trim() || 'Unsourced';
const key = (s) => delink(String(s ?? '')).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A book speaks for its unplaced pages when enough of it was placed to judge
 * by, and what was placed agrees. A setting book with one Akashic archetype
 * in it is not an Akashic book.
 */
const BOOK_PLACED = 0.25;
const BOOK_AGREES = 0.6;

/**
 * Read every record once, and answer for any of them afterwards.
 *
 * It wants *all* the records rather than the ones a run was filtered to,
 * because the evidence is spread across kinds: a feat is placed by its book,
 * and the book by its veils.
 */
export function systemClassifier(records) {
  const sphereSystem = new Map();
  const classSystem = new Map();
  for (const r of records) {
    if (r.kind === 'sphere') {
      const sys = SPHERE_TYPE[key(r.fields.type)];
      if (sys) sphereSystem.set(key(r.title).replace(/ sphere$/, ''), sys);
    }
    if (r.kind === 'class' || r.kind === 'prestige class') {
      const sys = family(r.fields, 'system')[0];
      if (sys) classSystem.set(key(r.title), canon(sys));
    }
  }

  /** Steps 1-5: what the page itself is evidence for, or null. */
  const direct = (r) => {
    const own = family(r.fields, 'system')[0];
    if (own) return [canon(own), 'system field'];
    if (KIND_SYSTEM[r.kind]) return [KIND_SYSTEM[r.kind], 'kind'];
    if (r.kind === 'sphere') {
      const sys = SPHERE_TYPE[key(r.fields.type)];
      if (sys) return [sys, 'sphere type'];
    }
    if (r.kind === 'talent') {
      const sys = sphereSystem.get(key(family(r.fields, 'sphere')[0]).replace(/ sphere$/, ''));
      if (sys) return [sys, 'sphere'];
    }
    if (r.kind === 'feat') {
      for (const sub of family(r.fields, 'subcategory')) {
        if (FEAT_SYSTEM[key(sub)]) return [FEAT_SYSTEM[key(sub)], 'feat type'];
      }
    }
    if (r.kind === 'archetype' || r.kind === 'class option') {
      for (const c of family(r.fields, 'class')) {
        if (classSystem.has(key(c))) return [classSystem.get(key(c)), 'class'];
      }
    }
    return null;
  };

  const votes = new Map();
  for (const r of records) {
    if (!r.kind) continue;
    const book = bookOf(r);
    if (!votes.has(book)) votes.set(book, { total: 0, placed: 0, by: new Map() });
    const v = votes.get(book);
    v.total++;
    const d = direct(r);
    if (!d) continue;
    v.placed++;
    v.by.set(d[0], (v.by.get(d[0]) || 0) + 1);
  }

  const books = new Map();
  for (const [book, v] of votes) {
    if (book === 'Unsourced' || !v.placed) continue;
    const [top, n] = [...v.by].sort((a, b) => b[1] - a[1])[0];
    if (v.placed / v.total >= BOOK_PLACED && n / v.placed >= BOOK_AGREES) books.set(book, top);
  }

  /*
   * A talent whose sphere has no page. It is still a talent, so the question
   * is only *which* Spheres book, and the sphere's other talents answer it:
   * most of them will be out of the one book.
   */
  const sphereOf = (r) => key(family(r.fields, 'sphere')[0]).replace(/ sphere$/, '');
  const orphan = new Map();
  for (const r of records) {
    if (r.kind !== 'talent' || sphereSystem.has(sphereOf(r))) continue;
    const sys = books.get(bookOf(r));
    if (!SPHERES.has(sys)) continue;
    if (!orphan.has(sphereOf(r))) orphan.set(sphereOf(r), new Map());
    orphan.get(sphereOf(r)).set(sys, (orphan.get(sphereOf(r)).get(sys) || 0) + 1);
  }
  const orphanSystem = (r) => {
    const tally = orphan.get(sphereOf(r));
    return tally ? [...tally].sort((a, b) => b[1] - a[1])[0][0] : 'Spheres of Power';
  };

  return {
    books,
    votes,
    /** `[system, why]` -- the why is for the report, so a wrong answer can be traced. */
    of(r) {
      const d = direct(r);
      if (d) return d;
      if (r.kind === 'talent') return [orphanSystem(r), 'sphere by its books'];
      const book = bookOf(r);
      if (books.has(book)) return [books.get(book), 'book'];
      return [GENERAL, 'unplaced'];
    },
  };
}
