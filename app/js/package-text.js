/**
 * package-text.js -- reading archetype packages out of their rules text.
 *
 * An archetype package is a named set of a class's features that a character
 * may give up for another package. Its rules text is one sentence naming what
 * it holds, then what a class without it loses:
 *
 *   **Blade Drill**: The Blade Drill archetype grants a fighter the bonus
 *   feats gained at 1st, 6th, and 12th levels, bravery, and weapon
 *   training. A fighter without this archetype package ...
 *
 * `readPackageSentence` turns the first sentence into the features it holds
 * (`includes`, a grant at named levels as `name@level`) and the powers it
 * grants (spellcasting, manifesting, spherecasting, initiating, combat
 * training). `readPackageList` reads a whole document of them, one class
 * heading over its packages, into `package` blocks.
 *
 * No imports: extensions.js and paste-import.js both read through here.
 */

/** The powers a package may grant; a class holds each from one package at most. */
export const PACKAGE_POWERS = Object.freeze(['spellcasting', 'manifesting', 'spherecasting', 'initiating', 'combat training']);

const ORD = '\\d{1,2}(?:st|nd|rd|th)';

/** "1st, 6th, 12th, and 18th levels" and "levels 1, 5, and 9" as "@1|6|12|18". */
function markLevels(s) {
  return s
    .replace(new RegExp(`(?:\\bat\\s+)?(${ORD}(?:\\s*,\\s*(?:and\\s+)?${ORD}|\\s+and\\s+${ORD})*)(?:[\\s-]+levels?\\b)?`, 'gi'),
      (m, list) => ` @${list.match(/\d+/g).join('|')} `)
    .replace(/(?:\bat\s+)?\blevels\s+(\d{1,2}(?:\s*,\s*(?:and\s+)?\d{1,2}|\s+and\s+\d{1,2})*)\b/gi,
      (m, list) => ` @${list.match(/\d+/g).join('|')} `)
    // "gained at 3, 11, and 19 HD"
    .replace(/(?:\bat\s+)?\b(\d{1,2}(?:\s*,\s*(?:and\s+)?\d{1,2}|\s+and\s+\d{1,2})*)\s+HD\b/g,
      (m, list) => ` @${list.match(/\d+/g).join('|')} `);
}

/** The powers a clause names outright: "all of his spellcasting ability". */
function powersIn(phrase) {
  const p = phrase.toLowerCase();
  const out = [];
  if (/spellcasting/.test(p)) out.push('spellcasting');
  if (/spherecasting/.test(p)) out.push('spherecasting');
  if (/manifesting/.test(p)) out.push('manifesting');
  if (/\binitiat(?:ing|or level)\b/.test(p)) out.push('initiating');
  return out;
}

/** The powers one listed item is: "spells", "the summoner's spells", "Combat Training". */
function itemPowers(name) {
  const out = powersIn(name);
  if (/^(?:[\w-]+['’]s\s+)?spells$/i.test(name)) out.push('spellcasting');
  if (/combat training$/i.test(name)) out.push('combat training');
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A phrase that only names a power: not a feature to find on a ladder. */
const ONLY_POWER = /^(?:spells?|spellcasting|spherecasting|manifesting|orisons|cantrips|knacks)(?:\s+abilit(?:y|ies))?$/i;

/** A list item as a feature name: articles, owners and "class ability" off. */
function featureName(item) {
  let s = item.trim()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(?:and|or|plus)\s+/i, '')
    .replace(/^\d+\s+uses?\s*\/\s*day\s+(?:of\s+)?/i, '')
    .replace(/^all\s+(?:of\s+)?/i, '')
    .replace(/^(?:the|a|an)\s+/i, '');
  // "the ranger's wild empathy" stays as written: swapKey drops the class's
  // own name when it matches against the ladder.
  s = s
    .replace(/^(?:his|her|their|its)\s+/i, '')
    .replace(/(?:^|\s+)(?:normally\s+)?(?:gained|granted)\b.*$/i, '')
    .replace(/\s+(?:class\s+)?(?:features?|abilit(?:y|ies))$/i, '')
    .replace(/\s+class$/i, '')
    .replace(/\s+dice$/i, '')
    .replace(/[.;:]+$/, '')
    .replace(/\s+(?:class\s+)?(?:features?|abilit(?:y|ies))$/i, '')
    .replace(/\s+it includes$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/**
 * What a package's first sentence says it holds.
 * Returns `{ includes: ['Bonus feats@1', 'Bravery', …], grants: ['spellcasting', …] }`.
 */
export function readPackageSentence(text, className = '') {
  const flat = String(text ?? '').replace(/[*\\]+/g, '').replace(/\s+/g, ' ').trim();
  const includes = [];
  const grants = [];
  // "The X (archetype) package includes …" / "The X archetype grants a fighter …"
  const lead = flat.match(/^The\s+[^.]*?\b(?:archetype\s+package|package|archetype|template)\s+(includes|grants)\s+/i);
  if (!lead) return { includes, grants };
  let rest = flat.slice(lead[0].length);
  // The first sentence only: the rest says what a class without it loses.
  rest = rest.split(/\.(?=\s+[A-Z]|\s*$)/)[0];
  // "grants a fighter the bonus feats …": the class it grants to goes.
  if (/grants/i.test(lead[1])) {
    const cls = String(className).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const own = cls ? new RegExp(`^(?:an?|the)\\s+${escapeRe(cls)}\\s+`, 'i') : null;
    rest = own && own.test(rest) ? rest.replace(own, '')
      : rest.replace(/^(?:an?|the)\s+(?:[\w’'-]+\s+){0,3}?(?=(?:the|all|his|her|their|its|one|two|low-light|spellcraft|\d)\b)/i, '');
  }
  // "(but not his cantrips)", "(including all improvements)": asides go;
  // "1st-level and higher spells" is spellcasting, not a level.
  rest = markLevels(rest.replace(/\([^)]*\)/g, ' ').replace(/\b\d{1,2}(?:st|nd|rd|th)-level and higher\s+/gi, ''));
  const add = (name, levels) => {
    if (!name || ONLY_POWER.test(name) || name.length > 60) return;
    for (const l of levels.length ? levels : [null]) {
      const key = l ? `${name}@${l}` : name;
      if (!includes.some((x) => x.toLowerCase() === key.toLowerCase())) includes.push(key);
    }
  };
  let last = '';
  const clauses = rest.split(/\s*(?:,\s*)?\b(?:as well as|plus|including|along with)\b\s*|\s*[;—–]\s*/i);
  for (const clause of clauses) {
    for (const p of powersIn(clause)) if (!grants.includes(p)) grants.push(p);
    // Commas first, then each item's "A and B".
    const items = clause.split(/\s*,\s*/).flatMap((x) => x.split(/\s+and\s+/i));
    for (const raw of items) {
      const levels = (raw.match(/@([\d|]+)/)?.[1] || '').split('|').filter(Boolean).map(Number);
      const name = featureName(raw.replace(/@[\d|]+/g, ' '));
      const powers = itemPowers(name);
      for (const p of powers) if (!grants.includes(p)) grants.push(p);
      // "1 use/day gained at 16th level" names the one before it
      if (!name && levels.length && last) { add(last, levels); continue; }
      // Combat training is a feature on the ladder as well as a power.
      if (name && !powers.some((p) => p !== 'combat training')) { add(name, levels); last = name; }
    }
  }
  return { includes, grants };
}

/* ---------------- a document of packages ---------------- */

/** "**Blade Drill**: The …" / "Blade Drill: The …" -- a label, then a package sentence. */
const PACKAGE_LINE = /^[\s*_]*([^*:\n]{2,60}?)[*_]*\s*:[*_]*\s*([A-Z].+)$/;
// "The X package includes …", or what a class lacks: "An armiger without this archetype package …"
const SAYS_PACKAGE = /^(?:The\s+[^.]*?\b(?:package|archetype|template)\s+(?:includes|grants)\b|An?\s+[^.]*?\bwithout this (?:archetype )?package\b)/i;

/** A heading line's words: "### **Bard**" -> "Bard". */
function headingText(line) {
  const m = line.match(/^\s*#{1,6}\s+(.+?)\s*$/) || line.match(/^\s*\*\*([^*]{2,40})\*\*\s*$/);
  if (!m) return null;
  return m[1].replace(/[*_]/g, '').replace(/\s*\(also in [^)]*\)\s*/i, ' ').replace(/[:\s]+$/, '').trim() || null;
}

/** Does this text read as a list of archetype packages under class headings? */
export function looksLikePackageList(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  let packages = 0;
  for (const line of lines) {
    const m = line.match(PACKAGE_LINE);
    if (m && SAYS_PACKAGE.test(m[2])) packages++;
  }
  return packages >= 2;
}

/**
 * Every package in a document, as `package` blocks: the latest heading is
 * the class, each labelled package sentence under it is one package.
 * A heading with no class under it ("Spheres of Might") is passed over by the
 * class heading that follows it.
 */
export function readPackageList(text) {
  const blocks = [];
  let className = '';
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const heading = headingText(line);
    if (heading) { className = heading; continue; }
    const m = line.match(PACKAGE_LINE);
    if (!m || !SAYS_PACKAGE.test(m[2])) continue;
    const name = m[1].replace(/[*_]/g, '').trim();
    // A package listed twice (a class in two sections) is read once.
    if (blocks.some((b) => b.name.toLowerCase() === name.toLowerCase() && b.class.toLowerCase() === className.toLowerCase())) continue;
    const body = m[2].replace(/[*\\]+/g, '').replace(/\s+/g, ' ').trim();
    const read = readPackageSentence(body, className);
    blocks.push({ kind: 'package', name, class: className, text: body, includes: read.includes, grants: read.grants });
  }
  return blocks;
}
