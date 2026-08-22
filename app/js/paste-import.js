/**
 * Paste import: rules text, copied off a page, read into extension blocks.
 *
 * A player copies a class, a race or a veil off Archives of Nethys, d20pfsrd
 * or the Metzofitz wiki and pastes it. This turns that text into the blocks
 * `extensions.js` knows -- a `class` with its progression table and feature
 * text, a `race` with its modifiers and traits, alternate traits as `trait`
 * blocks, a veil as a `template`, the favored-class list as a `note` -- and
 * hands back, separately, every stretch of text it did not use. Those
 * leftovers are the point of the review stage: the player sees what was
 * read, and tags the rest (a feature of that class, a race trait, a note, or
 * nothing) rather than the parser guessing wrong in silence.
 *
 * Nothing about a source site is assumed beyond how its pages copy: a class
 * table copies as tab-separated rows (or one cell per line, from some
 * browsers), features as "Name (Ex): text" lines or "Name (Ex)" title lines
 * over a paragraph, racial traits as "Name: text" lines. The parser keys on
 * those shapes, and on a handful of labels every page uses -- Hit Die, Class
 * Skills, Skill Ranks, Ability Score Modifiers, Chakra Slots. Two blank
 * lines in a row are a hard boundary, which is what a paste of several pages
 * has between them.
 *
 * Pure: text in, blocks and leftovers out. No DOM, no storage.
 */

import { normalizeBlock, featureKey } from './extensions.js';
import { sphereSide } from './rules.js';

// One definition, shared: the block reader needs it to tell which of a class's
// features repeat, and the paste reader to pair a table's names with its prose.
export { featureKey };

/* ---------------- text helpers ---------------- */

/**
 * Normalise a paste. Besides the odd characters a web page hands over, some
 * sites (d20pfsrd, or a "copy as markdown" extension) come out as markdown:
 * bullets, `[text](url)` links, `**bold**`, `## headings`. The text underneath
 * is the same, so the markup goes and the line shapes the reader keys on
 * are back.
 */
const clean = (s) => String(s ?? '')
  .replace(/ /g, ' ')                       // no-break spaces off a web page
  .replace(/−/g, '-')                       // minus sign
  .replace(/\[\[([^\]]*)\]\([^)]*\)\]/g, '[$1]')   // [[Source](url)] -> [Source]
  .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')  // [text](url) -> text
  .replace(/^[ \t]*[*\-•]\s+(?=\S)/gm, '')          // "* item" -> "item"
  .replace(/^#{1,6}\s+/gm, '')                      // "## Heading" -> "Heading"
  .replace(/\*\*([^*\n]+)\*\*/g, '$1')              // **bold**
  .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, '$1$2') // _italic_
  .replace(/[ \t]+$/gm, '');
const lower = (s) => String(s || '').trim().toLowerCase();
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const isBlank = (line) => !line || !line.trim();

const signedNum = (s) => {
  const m = String(s || '').match(/([+\-–]?)\s*(\d+)/);
  if (!m) return 0;
  return (m[1] === '-' || m[1] === '–' ? -1 : 1) * Number(m[2]);
};

const ORDINAL = /^(\d{1,2})(?:st|nd|rd|th)?$/;

/**
 * A wiki page's furniture, which a Ctrl+A copy brings along: the sign-in and
 * search links above the title, the tab strip, the "Notice" about errata, the
 * breadcrumb, and the whole navigation column and footer after the article.
 * Marked as used before anything is read, so it is neither content nor a
 * leftover to tag.
 */
const WIKI_CHROME = /^(?:Anonymous|Log in|Library of Metzofitz|Search(?: Library of Metzofitz)?|Namespaces.*|Page ?Discussion|Page actions|Read|View source.*|History|Purge|Notice|Information|Add comment|Categories:.*|Navigation(?:Wiki tools)?|Wiki tools|Page tools|Main page|Recent changes|Random page|Help about MediaWiki|Special pages|Content Source|Publisher|Publication|Player Content|Rules & Systems|Game Master Content|Cite this page|Get shortened URL|More|What links here|Related changes|Printable version|Permanent link|Page information|Page logs|Categories|Hosted by Miraheze.*|Powered by MediaWiki|Privacy policy.*|Cookies help us deliver.*|More information|OK|Mobile view)$/i;
const CHROME_NOTICE = /^The following content has been errata'?d by its original author/i;
const CHROME_FOOTER = /^(?:This page was last edited on|Content is available under Creative Commons)/i;

/** Mark the wiki's chrome as used: the head above the title, the tail from the navigation column down. */
function markWikiChrome(lines, used) {
  const t = lines.map((l) => l.trim());
  t.forEach((l, i) => { if (WIKI_CHROME.test(l) || CHROME_NOTICE.test(l) || CHROME_FOOTER.test(l)) used[i] = true; });
  t.forEach((l, i) => {
    if (/^Namespaces/i.test(l)) {
      // the title above, and above it the sign-in/search lines
      let j = i - 1;
      while (j >= 0 && t[j] && !doubleBlankAbove(lines, j)) { used[j] = true; j--; }
      // the breadcrumb ("Classes" / "Veils" / "Races") and the repeated title below
      let k = i + 1;
      while (k < t.length && (!t[k] || used[k] || CHROME_NOTICE.test(t[k]))) k++;
      if (k < t.length && /^(?:Classes|Veils|Races|Feats|Spells|Archetypes|Prestige Classes|Talents|Powers|Traits|.+ archetypes)$/i.test(t[k])) { used[k] = true; k++; }
      if (k < t.length && i - 1 >= 0 && t[k] === t[i - 1]) used[k] = true;
    }
    if (/^Navigation$/i.test(l) && /^Main page$/i.test(t[i + 1] || '')) {
      // the navigation column and footer run to the end of the page's copy
      let k = i;
      while (k < t.length && !(k > i + 3 && k + 1 < t.length && isBlank(lines[k]) && isBlank(lines[k + 1]))) { used[k] = true; k++; }
    }
  });
}

/**
 * A wikidot page's furniture (the Spheres of Power wiki, among others), which
 * copies in three lumps: the site banner and the whole side menu above the
 * breadcrumb, the fold and table of contents under it, and the site's
 * navigation and small print below the article. Each is found by a landmark
 * rather than by name -- the breadcrumb line, the "Table of Contents" line,
 * and a footer line -- so the side menu's own contents (sphere lists, product
 * links, whatever the site puts there) need not be known.
 */
const WIKIDOT_CHROME = /^(?:Wikidot\.com|\.wikidot\.com|Share on.*|Explore ?»|Page tags|Fold|Unfold|FoldUnfold|Create account or Sign in|Edit page|Print page|Edit this menu|Edit side menu|Page categories|Change theme|Manage site|Wiki syntax|Modules reference|Terms of Service|Privacy|Report a bug|Flag as objectionable|Update cookie settings|Powered by Wikidot\.com|\||Help \|.*)$/i;
/** The lines a wikidot footer opens with, whichever of them the theme shows. */
const WIKIDOT_FOOTER = /^(?:Powered by Wikidot\.com|This website uses cookies\b.*|Unless otherwise stated, the content of this page.*|Click here to (?:edit|toggle).*|Append content without editing.*|Watch headings for an "edit" link.*|Something does not work as expected\?.*|General Wikidot\.com documentation.*|Other interesting sites.*|View\/set parent page.*|Notify administrators.*|Check out how this page.*)$/i;
/** "Spheres of Power Wiki Home Page » Spheres Of Might » Blacksmith" */
const BREADCRUMB = /\S\s»\s\S/;
/** ...and the part of it that says the page is a sphere rather than a class. */
const SPHERE_CRUMB = /»\s*Spheres?\s+Of\s+(?:Might|Power)\s*»/i;
/** A footer's navigation: short cells, tab-separated or not, and no sentences. */
const NAVISH = (l) => !l || (!/[.!?]$/.test(l) && (l.includes('\t') ? true : words(l) <= 8));

function markWikidotChrome(lines, used) {
  const t = lines.map((l) => l.trim());
  const isToc = (l) => /^(?:Fold|Unfold|FoldUnfold)?\s*Table of Contents\b/i.test(l);
  const wikidot = t.some((l) => /wikidot\.com$/i.test(l)) || t.some((l) => BREADCRUMB.test(l));
  if (!wikidot) return [];
  t.forEach((l, i) => { if (WIKIDOT_CHROME.test(l) || WIKIDOT_FOOTER.test(l)) used[i] = true; });

  // Each of these runs once per page: a paste of several pages has the tail of
  // one sitting directly on the head of the next, and a page's title is where
  // one ends and the next begins.
  const crumbs = [];
  t.forEach((l, i) => { if (BREADCRUMB.test(l)) crumbs.push(i); });
  const titles = new Set(crumbs.map((c) => { let k = c - 1; while (k > 0 && !t[k]) k--; return k; }));

  // The head: from the breadcrumb up through the banner and the side menu, all
  // of it short navigation lines. The title above the breadcrumb is kept -- it
  // is what names the class.
  for (const c of crumbs) {
    used[c] = true;
    let k = c - 1;
    while (k > 0 && !t[k]) k--;
    for (k -= 1; k >= 0 && NAVISH(t[k]); k--) used[k] = true;
  }

  // The table of contents, whether it copies as a list or as one long line.
  // It ends at a blank line or at the first sentence: a sphere page runs its
  // contents straight into the article with no blank between, and the run
  // used to swallow the first two lines of the sphere's own description.
  t.forEach((l, i) => {
    if (!isToc(l)) return;
    for (let k = i; k < t.length && t[k] && !(k > i && /[.!?]$/.test(t[k])); k++) used[k] = true;
  });

  // The tail: the footer, the columns of links above it, and everything down
  // to where the next page starts. The climb allows a line or two that is
  // neither -- a legend under the link columns -- but never a sentence.
  t.forEach((l, i) => {
    if (!WIKIDOT_FOOTER.test(l)) return;
    let k = i;
    let slack = 2;
    for (;;) {
      const above = k > 0 ? t[k - 1] : null;
      if (above === null || titles.has(k - 1) || /[.!?]$/.test(above)) break;
      if (!NAVISH(above) && !(/^[^.;]*$/.test(above) && slack-- > 0)) break;
      k--;
    }
    for (; k < t.length && !titles.has(k); k++) used[k] = true;
  });
  return [...titles].sort((a, b) => a - b);
}

const ABILITY_WORDS = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

/* ---------------- the entry point ---------------- */

/**
 * @param {string} text  what was pasted
 * @returns {{ blocks, report, leftovers }}
 *   blocks     normalised extension blocks, in the order found
 *   report     one line per thing recognised, for the player to read
 *   leftovers  [{text, lines:[from,to], near, suggest}] -- stretches nothing
 *              used, each with the block it sat nearest (a class or race name)
 *              and a guess at what it might be: 'feature' | 'trait' | 'note' | 'skip'
 */
export function parsePaste(text) {
  // A scraper's own document is read before anything is cleaned: `clean()`
  // strips the markdown that the page readers cannot use and this one is
  // made of.
  if (looksStructured(text)) return readStructured(text);
  const lines = clean(text).split(/\r?\n/);
  const used = new Array(lines.length).fill(false);
  // A wiki's chrome is marked first and stays transparent from here on: the
  // readers skip it, and it is neither a segment boundary nor a leftover.
  markWikiChrome(lines, used);
  // Where each page in the paste begins, so nothing reaches back into the one before.
  const pages = markWikidotChrome(lines, used);
  const segments = findSegments(lines, used, pages);
  const blocks = [];
  const maneuvers = [];
  const spheres = [];
  const report = [];
  const nearOf = new Array(lines.length).fill(null);

  for (const seg of segments) {
    const slice = lines.slice(seg.start, seg.end);
    const pre = new Set();
    for (let i = seg.start; i < seg.end; i++) if (used[i]) pre.add(i - seg.start);
    const reader = {
      class: readClass, race: readRace, veil: readVeil, archetype: readArchetype,
      maneuver: readManeuver, sphere: readSphere,
    }[seg.kind];
    const out = reader(slice, pre);
    for (const i of out.used) used[seg.start + i] = true;
    for (let i = seg.start; i < seg.end; i++) nearOf[i] = { kind: seg.kind, name: out.name };
    blocks.push(...out.blocks);
    // A maneuver is a catalogue entry, not a block: it goes to the pack's
    // discipline table rather than onto a character. See readManeuver.
    maneuvers.push(...(out.maneuvers || []));
    spheres.push(...(out.spheres || []));
    report.push(...out.report);
  }

  const leftovers = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (used[i] || isBlank(line)) {
      if (cur && (used[i] || (isBlank(line) && isBlank(lines[i + 1] || '')))) { leftovers.push(cur); cur = null; }
      else if (cur && isBlank(line)) cur.gap = true;
      return;
    }
    if (cur && cur.gap) { leftovers.push(cur); cur = null; }
    if (!cur) cur = { text: '', lines: [i, i], near: nearOf[i], gap: false };
    cur.text += (cur.text ? '\n' : '') + line.trim();
    cur.lines[1] = i;
  });
  if (cur) leftovers.push(cur);
  for (const l of leftovers) { delete l.gap; l.suggest = suggestFor(l); }

  if (!segments.length && leftovers.length) {
    report.push('Nothing here looked like a class, a race, a veil, a sphere or a maneuver. Tag the text below, or keep it as a note.');
  }
  return { blocks: blocks.filter(Boolean), maneuvers, spheres, report, leftovers };
}

/**
 * A leftover chunk as a name and a text, for whatever the player tags it as:
 * "Label: text…" gives the label; a short first line gives that; otherwise
 * the first few words stand in for a title.
 */
export function splitChunk(text) {
  const t = String(text || '').trim();
  const lines = t.split('\n');
  const first = lines[0] || '';
  const m = first.match(/^([A-Z][^:\n]{1,50}?)\s*(?:\((Ex|Su|Sp)\))?\s*:\s+(\S.*)$/);
  if (m && words(m[1]) <= 6) return { name: m[1].trim(), type: m[2] || null, text: [m[3], ...lines.slice(1)].join('\n').trim() };
  const tm = first.match(/^([A-Z][^:\n]{1,50}?)\s*\((Ex|Su|Sp)\)\s*$/);
  if (tm) return { name: tm[1].trim(), type: tm[2], text: lines.slice(1).join('\n').trim() };
  if (words(first) <= 8 && lines.length > 1 && !/[.]$/.test(first)) return { name: first.replace(/:$/, ''), type: null, text: lines.slice(1).join('\n').trim() };
  const head = first.split(/\s+/).slice(0, 6).join(' ');
  return { name: words(first) > 6 ? `${head}…` : head, type: null, text: t };
}

/** A guess at what a leftover is, for the review panel's default. */
function suggestFor(l) {
  const t = l.text;
  const first = t.split('\n')[0];
  if (/^[A-Z][^:\n]{1,50}:\s+\S/.test(first) && words(first.split(':')[0]) <= 6) {
    return l.near?.kind === 'race' ? 'trait' : 'feature';
  }
  if (words(t) < 8) return 'skip';
  return 'note';
}

/* ---------------- segmentation ---------------- */

/**
 * Where each thing begins and ends. An anchor line says what a stretch is --
 * "Hit Die: d12" a class, "Standard Racial Traits" or "Ability Score
 * Modifiers:" a race, "Chakra Slots" a veil -- and each segment reaches back
 * for its preamble (a class's Role line and flavour, a race's Relations and
 * names, a veil's title) and forward to the next segment's start. The reach
 * back stops at a double blank line, at the previous anchor, and at lines
 * that plainly belong to the thing before (a favored-class option, a table
 * row, a "Favored Class Options" heading).
 */
export function findSegments(lines, pre = [], pageStarts = []) {
  const anchors = [];
  const nextText = (i) => { let j = i + 1; while (j < lines.length && (!lines[j].trim() || pre[j])) j++; return (lines[j] || '').trim(); };
  /*
   * Which pages are a Spheres wiki page, by their breadcrumb. A sphere is
   * anchored on a heading shape ("Boxing Talents") that a class page can wear
   * too, so the page has to vouch for it first.
   */
  const sphereCrumbs = [];
  lines.forEach((l, i) => { if (SPHERE_CRUMB.test(l)) sphereCrumbs.push(i); });
  const onSpherePage = (i) => {
    if (!sphereCrumbs.length) return false;
    const page = pageStarts.filter((p) => p <= i).pop() ?? 0;
    const next = pageStarts.find((p) => p > page) ?? lines.length;
    return sphereCrumbs.some((c) => c >= page && c < next);
  };
  lines.forEach((line, i) => {
    if (pre[i]) return;
    const t = line.trim();
    if (/^Hit Di(?:e|ce):\s*d?\d+/i.test(t) || (/^Hit Di(?:e|ce)$/i.test(t) && /^d\d+/i.test(nextText(i)))) {
      // one class has one Hit Die; the wiki's info box and its "Hit Die: d10" line are the same class
      if (!anchors.some((a) => a.kind === 'class' && i - a.at < 60 && !lines.slice(a.at, i).some((l) => isTableRow(l)))) anchors.push({ kind: 'class', at: i });
    } else if (/^Standard Racial Traits$/i.test(t) || /^Ability Score Modifiers?:/i.test(t)) {
      if (!anchors.some((a) => a.kind === 'race' && i - a.at < 40)) anchors.push({ kind: 'race', at: i });
    } else if (/^Chakra Slots?:?$/i.test(t)) anchors.push({ kind: 'veil', at: i });
    else if (GROUP_HEADING.test(t) && onSpherePage(i)) {
      // A sphere page: its first "<X> Talents" heading. The rest of them
      // ("Counter Talents", "Legendary Talents") are that same sphere's, so
      // only the first per page anchors. A class page has headings of that
      // shape too, which is why this asks the breadcrumb first.
      const page = pageStarts.filter((q) => q <= i).pop() ?? 0;
      if (!anchors.some((a) => a.kind === 'sphere' && a.at >= page)) anchors.push({ kind: 'sphere', at: i });
    } else if (/^Initiation Action:?$/i.test(t) || /^Initiation Action:\s*\S/i.test(t)) {
      // A martial ability page. Its box is the only one with an initiation
      // action, and one page holds one maneuver, so this needs no guard
      // against a second anchor the way a class's hit die does.
      anchors.push({ kind: 'maneuver', at: i });
    }
    else if (/^Classes Available$/i.test(t)) {
      // An archetype page: its info box names the class it is for. An option
      // page's box says which option too, and need not mark the class with
      // "(class)". (A veil's box lists "(Veil List)" entries and has neither,
      // so it anchors on its chakra slot as before.)
      const near = [];
      for (let j = i + 1; j < lines.length && near.length < 6; j++) {
        if (!lines[j].trim() || pre[j]) continue;
        near.push(lines[j].trim());
      }
      if (/\(class\)$/i.test(near[0] || '') || near.some((l) => /^Options?$/i.test(l))) {
        anchors.push({ kind: 'archetype', at: i });
      }
    } else if (SWAP_SENTENCE.test(t)) {
      // a plain archetype document -- homebrew in a text file, say -- has no
      // info box, but its features each say what they replace or alter. The
      // first such sentence since the last boundary anchors it; a class page
      // never has one, and a wiki archetype page has anchored on its box.
      const last = anchors[anchors.length - 1];
      const sinceLast = last ? lines.slice(last.at, i) : lines.slice(0, i);
      const doubleBlank = sinceLast.some((l, k) => k > 1 && isBlank(l) && isBlank(sinceLast[k - 1]));
      const newPage = sinceLast.some((l) => /^Namespaces/i.test(l.trim()));
      // A wiki page's own box anchor precedes any of its sentences, so this
      // is another thing only past a page head; a plain document is another
      // thing past a double blank; a class's sentences are its own.
      const isNew = !last
        || (last.kind === 'archetype' && (last.loose ? doubleBlank || newPage : newPage))
        || (last.kind !== 'archetype' && (doubleBlank || newPage));
      if (isNew) anchors.push({ kind: 'archetype', at: i, loose: true });
    }
  });
  const segments = [];
  let floor = 0;
  anchors.forEach((a, n) => {
    // A page's own title is a floor: nothing on it reaches into the page above.
    const page = pageStarts.filter((p) => p <= a.at).pop();
    if (page !== undefined) floor = Math.max(floor, page);
    let start = Math.max(floor, backReach(lines, a, floor, pre));
    // Chrome sitting directly above the reach -- a wiki page's title and the
    // sign-in links over it -- belongs to this thing, not the one before.
    while (start - 1 >= floor && (pre[start - 1] || !lines[start - 1].trim())) start--;
    while (start < a.at && !lines[start].trim() && !pre[start]) start++;
    segments.push({ kind: a.kind, at: a.at, start, end: lines.length });
    if (n > 0) segments[n - 1].end = start;
    floor = a.at + 1;
  });
  return segments;
}

/** A feature saying what it does to its class: "This ability replaces challenge and kiai arts.", "This alters Iaijutsu Strike", "Topological Draw alters Iaijutsu Techniques." */
const SWAP_SENTENCE = /(?:^|\.\s+)(?:This (?:ability|feature|alteration|alternative class feature|option)?\s*(?:replaces|alters|modifies)\s+\S|[A-Z][^.\n:]{0,50}?(?::\s+[A-Z][^.\n]{0,40}?)?\s+(?:replaces|alters)\s+(?:the\s+)?[A-Z0-9])/;
const TAIL_LINE = /^(?:PFS Legal )?[A-Z][\w' -]+ \([^)]*pg\.\s*\d+[^)]*\):|^Favored Class (?:Options|Bonuses)$|^Alternate Capstones$|^Racial Subtypes$|^Archetypes$|^Related$|^FAQ$|^Contents$/;
/**
 * A progression row. The level column is an ordinal on most pages and a bare
 * number on some ("1\t+1\t+2…"); a bare number only counts when the cell after
 * it is the base attack bonus, which keeps other numbered tables out.
 */
const isTableRow = (line) => /^\d{1,2}(?:st|nd|rd|th)\t/.test(line)
  || /^\d{1,2}\t[+\-–]?\d/.test(line)
  || /^\d{1,2}(?:st|nd|rd|th)\s+\+\d+/.test(line.trim());
const doubleBlankAbove = (lines, i) => i - 1 >= 0 && isBlank(lines[i]) && isBlank(lines[i - 1]);


/**
 * How far above its anchor a thing reaches. Everything up to the boundary
 * is its own -- a class's flavour, sidebars, "Role:" line and info box; a
 * race's names, tables and prose; a veil's title and box -- because a page
 * copies top to bottom and the boundary rules (a double blank, a table row
 * or favored-class line of the thing before, the previous anchor) are what
 * separate one page from the next. Chrome (`pre`) is transparent.
 */
function backReach(lines, anchor, floor, pre = []) {
  let start = anchor.at;
  let i = anchor.at - 1;
  while (i >= floor) {
    if (pre[i]) { i--; continue; }
    const t = lines[i].trim();
    if (isBlank(t)) {
      if (doubleBlankAbove(lines, i)) break;
      i--; continue;
    }
    if (TAIL_LINE.test(t) || isTableRow(lines[i])) break;
    if (anchor.kind === 'veil' || anchor.kind === 'archetype') {
      // the title is a short line above the box; the reach ends at the boundary rules above
      if (words(t) <= 6 && /^[A-Z]/.test(t) && !/[.:]$/.test(t)) start = i;
      i--; continue;
    }
    start = i;
    i--;
  }
  return start;
}

/* ---------------- classes ---------------- */

const CLASS_LABELS = new Set(['role', 'alignment', 'hit die', 'hit dice', 'starting wealth', 'starting age', 'class skills',
  'skill ranks per level', 'skill points at each level', 'skill points each level', 'skill ranks', 'source', 'sources',
  'adventures', 'characteristics', 'religion', 'background', 'races', 'other classes', 'abilities', 'level',
  'parent classes', 'prestige class', 'requirements', 'q', 'a']);
/** The labels the class reader lifts into fields; other "Label: text" lines above the table are description. */
const FIELD_LABELS = new Set(['role', 'alignment', 'hit die', 'hit dice', 'starting wealth', 'starting age', 'class skills',
  'skill ranks per level', 'skill points at each level', 'skill points each level', 'skill ranks', 'source', 'sources']);
const CLASS_HEADINGS = /^(?:Class (?:Features|Abilities)|Class Skills|Ex-\w+|Alternate Capstones|Favored Class (?:Options|Bonuses)|Archetypes|Related|Contents|Table: .*|Maneuvers|FAQ|Weapon and Armor Proficienc(?:y|ies))$/i;
const FCB_HEADING = /^Favored Class (?:Options|Bonuses)$/i;
/** Untyped "Name: text" lines that are features in their own right wherever they sit. */
const KNOWN_UNTYPED = /^(?:weapon and armor proficienc(?:y|ies)|weapon proficienc(?:y|ies)|armor proficienc(?:y|ies)|proficienc(?:y|ies)|maneuvers|maneuvers readied|stances known|bonus feats?|spells|spellcasting|cantrips|orisons|talents|deeds)$/i;
/** A section's own introduction, not content: "The following are the class features of the warlord." */
const BOILERPLATE = /^(?:All of t|T)he following (?:are|is) (?:the )?(?:class features|favored class (?:options|bonuses)|alternate racial traits|archetypes)\b|^The following (?:\w+ ){0,2}(?:feats?|traits?|items?|equipment|archetypes?|options?) (?:are|is)\b/i;

export function readClass(lines, pre = new Set()) {
  const report = [];
  const blocks = [];
  const used = new Set(pre);
  const mark = (i) => { if (i >= 0 && i < lines.length) used.add(i); };
  const markRange = (a, b) => { for (let i = a; i <= b; i++) mark(i); };
  const text = lines.join('\n');
  const trimmed = lines.map((l) => l.trim());

  // Name: "The Barbarian's class skills" / "the warlord's class skills", else a title line.
  let name = '';
  const m1 = text.match(/\bthe ([A-Za-z][\w' -]{1,40}?)['’]s class skills\b/i);
  if (m1) name = titleCase(m1[1]);
  if (!name) {
    const ti = trimmed.findIndex((l) => l && words(l) <= 4 && /^[A-Z]/.test(l) && !/[.:]$/.test(l) && !CLASS_HEADINGS.test(l) && !WIKI_CHROME.test(l));
    if (ti >= 0) { name = trimmed[ti].replace(/\s*\(class\)$/i, ''); mark(ti); }
  }
  name = name || 'Class';
  // The title line(s): above a Source line, or the wiki's "<Name> (class)".
  trimmed.forEach((l, i) => { if (lower(l) === lower(name) || lower(l) === `${lower(name)} (class)`) mark(i); });
  const srcAt = trimmed.findIndex((l) => /^Source\b/.test(l));
  if (srcAt >= 0 && srcAt < 6) mark(srcAt);

  const field = (re) => {
    const i = trimmed.findIndex((l) => re.test(l));
    if (i >= 0) mark(i);
    return i >= 0 ? trimmed[i].match(re) : null;
  };
  // The wiki's information box: a heading on one line, its value on the next.
  const box = readInfoBox(trimmed, mark);
  const hd = Number(field(/^Hit Di(?:e|ce):\s*d?(\d+)/i)?.[1]) || box.hd || 8;
  const skillRanks = Number(field(/^Skill (?:Ranks|Points)(?: per Level| at each Level| each Level)?:\s*(\d+)/i)?.[1] ?? (box.skillRanks ?? 2));
  const wealth = field(/^Starting Wealth:\s*(.+)/i)?.[1]?.trim() || '';
  const align = field(/^Alignment:\s*(.+)/i)?.[1]?.trim() || box.alignment || '';
  const role = field(/^Role:\s*(.+)/i)?.[1]?.trim() || '';
  const source = (srcAt >= 0 && srcAt < 6 ? trimmed[srcAt].replace(/^Source:?\s*/, '') : '') || box.source || '';
  field(/^Starting Age:/i);
  for (const re of [/^Class Skills$/i, /^Class Features$/i, /^Contents$/i, /^\d\t(?:Class Features|Favored Class (?:Options|Bonuses)|Archetypes|Related)$/i, BOILERPLATE]) {
    trimmed.forEach((l, i) => { if (re.test(l)) mark(i); });
  }

  // Class skills sentence. A page that dropped a comma -- "Knowledge (local)
  // (Int) Knowledge (nobility) (Int)" -- still splits where one skill's
  // bracket meets the next skill's capital.
  let classSkills = [];
  const csAt = trimmed.findIndex((l) => /class skills[^:\n]*(?:are|include)s?:?\s*\S/i.test(l));
  if (csAt >= 0) {
    mark(csAt);
    const sentence = trimmed[csAt].match(/class skills[^:\n]*(?:are|include)s?:?\s*(.+)$/i)[1];
    classSkills = sentence
      .replace(/\.\s*$/, '')
      .replace(/\s*\((?:Str|Dex|Con|Int|Wis|Cha)\)\s*/gi, ' ')
      .replace(/\)\s+(?=[A-Z])/g, '), ')
      .replace(/\s+and\s+/g, ', ')
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter((s) => s && !/^see\b/i.test(s));
  }

  // The progression table.
  const table = readClassTable(lines);
  for (const i of table.used) mark(i);
  const tableEnd = table.used.size ? Math.max(...table.used) : -1;
  const bab = table.bab ?? box.bab ?? 0.75;
  const goodFort = table.saves?.fort ?? box.saves?.fort ?? false;
  const goodRef = table.saves?.ref ?? box.saves?.ref ?? false;
  const goodWill = table.saves?.will ?? box.saves?.will ?? false;

  // The preamble: everything above the table that is not a field -- the
  // flavour paragraphs, "Legendary Class: …" and other labelled lines, and a
  // sidebar (a short heading over a paragraph) -- goes into the description.
  const preamble = [];
  const preambleEnd = tableEnd >= 0 ? tableEnd : trimmed.findIndex((l) => /^Hit Di(?:e|ce)/i.test(l));
  for (let i = 0; i < preambleEnd; i++) {
    const t = trimmed[i];
    if (!t || used.has(i) || WIKI_CHROME.test(t)) continue;
    if (CLASS_HEADINGS.test(t)) { mark(i); continue; }
    const label = t.match(/^([A-Z][A-Za-z' ]{1,40}):\s+(.+)$/);
    if (label && !FIELD_LABELS.has(lower(label[1]))) { preamble.push(t); mark(i); continue; }
    if (/^[“"'].*[”"']$/.test(t)) { preamble.push(t); mark(i); continue; }        // the class's epigraph
    if (words(t) > 12) { preamble.push(t); mark(i); continue; }
    if (words(t) <= 8 && /^[A-Z]/.test(t) && !/[.:]$/.test(t) && words(trimmed[i + 1] || '') > 12) { preamble.push(t); mark(i); }
  }

  // Feature prose, from the table down.
  const tableKeys = new Set(table.rows.flatMap((r) => r.special.map(featureKey)));
  const prose = readFeatureProse(lines, { skipLabels: CLASS_LABELS, startAt: tableEnd + 1, tableKeys, mark, pre });
  const proseByKey = new Map();
  for (const p of prose) if (!proseByKey.has(featureKey(p.name))) proseByKey.set(featureKey(p.name), p);
  const matched = new Set();

  // A page's table and prose do not always agree on a name ("opportune
  // strike" on the table, "Opportune Slash (Ex): At 8th level…" below): a
  // prose entry that names the same level and starts with the same word is
  // the same feature.
  const usedProse = new Set();
  const findProse = (special, level) => {
    const exact = proseByKey.get(featureKey(special));
    if (exact) return exact;
    const first = featureKey(special).split(' ')[0];
    return prose.find((p) => !usedProse.has(p) && p.level === level && !tableKeys.has(featureKey(p.name)) && featureKey(p.name).split(' ')[0] === first) || null;
  };
  const features = [];
  for (const row of table.rows) {
    for (const special of row.special) {
      const p = findProse(special, row.level);
      if (p) { matched.add(featureKey(p.name)); matched.add(featureKey(special)); usedProse.add(p); }
      features.push({ level: row.level, name: special, text: p ? p.text : '' });
    }
    if (row.extra.length) features.push({ level: row.level, name: row.extra.map(([h, v]) => `${h} ${v}`).join(' / '), text: '' });
  }
  const capstones = [];
  for (const p of prose) {
    if (matched.has(featureKey(p.name))) { markRange(p.from, p.to); continue; }
    if (p.title && (/^At 20th level/i.test(p.text) || p.source)) { capstones.push(p); markRange(p.from, p.to); continue; }
    if (isNoiseFeature(p.name)) continue;
    // A named feature the table did not list by that name -- the proficiency
    // line, a maneuvers paragraph -- is a feature at the level its text names, else 1st.
    features.push({ level: p.level || 1, name: p.name, text: p.text });
    markRange(p.from, p.to);
  }
  // "Ex-Barbarians" -- a heading over a paragraph -- is a feature of its own.
  trimmed.forEach((l, i) => {
    if (!/^Ex-\w+$/i.test(l)) return;
    mark(i);
    const body = [];
    let j = i + 1;
    while (j < lines.length && trimmed[j] && !CLASS_HEADINGS.test(trimmed[j]) && !TAIL_LINE.test(trimmed[j]) && !/^Source\b/.test(trimmed[j])) { body.push(trimmed[j]); mark(j); j++; }
    if (body.length) features.push({ level: 1, name: l, text: body.join('\n') });
  });
  const description = [role && `Role: ${role}`, align && `Alignment: ${align}`, wealth && `Starting wealth: ${wealth}`, ...preamble].filter(Boolean).join('\n\n');

  blocks.push(normalizeBlock({
    kind: 'class', name, hd, bab, goodFort, goodRef, goodWill, skillRanks, classSkills, features, text: description, source,
  }));
  report.push(`Class ${name}: d${hd}, ${bab === 1 ? 'full' : bab === 0.5 ? '½' : '¾'} BAB, good ${[goodFort && 'Fort', goodRef && 'Ref', goodWill && 'Will'].filter(Boolean).join('/') || 'no'} save, ${skillRanks} ranks, ${classSkills.length} class skills, ${table.rows.length} table rows, ${features.length} features (${features.filter((f) => f.text).length} with text)${source ? `; source ${source}` : ''}.`);

  for (const c of capstones) {
    blocks.push(normalizeBlock({ kind: 'feature', name: c.name, type: c.type, text: c.text, group: `${name} — alternate capstones`, source: c.source }));
  }
  if (capstones.length) report.push(`${capstones.length} alternate capstone(s) as features in a “${name} — alternate capstones” group.`);

  const fcb = readFavoredClass(lines, pre);
  for (const i of fcb.used) mark(i);
  if (fcb.entries.length) {
    blocks.push(normalizeBlock({ kind: 'note', name: `Favored class options — ${name}`, text: fcb.entries.join('\n') }));
    report.push(`${fcb.entries.length} favored class option(s) as a note.`);
  }
  const arch = readArchetypes(trimmed, name, pre);
  for (const i of arch.used) mark(i);
  if (arch.entries.length) {
    blocks.push(normalizeBlock({ kind: 'note', name: `${name} — archetypes`, text: arch.entries.join('\n') }));
    report.push(`${arch.entries.length} archetype(s) listed in a note (names and one-line flavour; the archetypes themselves are their own pages).`);
  }

  // Below the archetype and favored-class lists a class page carries what is
  // not the class: its feats, its magic items, a bestiary. Each of those is a
  // page of its own, so the rest is set aside here rather than offered a
  // chunk at a time -- and the report says how much, so it is not silent.
  const tailAt = trimmed.findIndex((l, i) => !pre.has(i) && (FCB_HEADING.test(l) || /^Archetypes$/i.test(l)));
  if (tailAt >= 0) {
    let set = 0;
    for (let i = tailAt; i < lines.length; i++) { if (!used.has(i) && trimmed[i]) set++; mark(i); }
    if (set) report.push(`${set} line(s) after the ${name} page's archetype and favored-class lists -- its feats, equipment, bestiary and the like -- were set aside; each of those is a page of its own.`);
  }
  return { name, blocks, report, used };
}

/**
 * The wiki's information box on a class page: each heading on its own line
 * with the value beneath -- Alignment / Hit Die / Skill Points each Level /
 * a BAB-and-saves table / Sources -- between "Information" and the first
 * paragraph. Everything in it is used; what it says fills in for a page
 * that has no "Hit Die:" line of its own.
 */
function readInfoBox(trimmed, mark) {
  const out = {};
  const at = trimmed.findIndex((l) => /^Information$/i.test(l));
  if (at === -1) return out;
  mark(at);
  let i = at + 1;
  const next = () => { while (i < trimmed.length && !trimmed[i]) i++; return trimmed[i]; };
  while (i < trimmed.length) {
    const t = next();
    if (t === undefined || words(t) > 12 || /[.!?]$/.test(t)) break;
    if (/^Alignment$/i.test(t)) { mark(i); i++; out.alignment = next(); mark(i); i++; continue; }
    if (/^Hit Di(?:e|ce)$/i.test(t)) { mark(i); i++; out.hd = Number(String(next()).match(/d?(\d+)/)?.[1]) || null; mark(i); i++; continue; }
    if (/^Skill (?:Points|Ranks)/i.test(t)) { mark(i); i++; out.skillRanks = Number(String(next()).match(/(\d+)/)?.[1]); mark(i); i++; continue; }
    if (/^Sources?$/i.test(t)) { mark(i); i++; out.source = next(); mark(i); i++; continue; }
    if (/^BAB\b/i.test(t) || /^Save\b/i.test(t)) { mark(i); i++; continue; }         // the little BAB/saves table header
    const m = t.match(/^(1|3\/4|1\/2|0\.75|0\.5|Full|Medium|Slow|Fast|Poor|Good)\t(Good|Poor)\t(Good|Poor)\t(Good|Poor)$/i);
    if (m) {
      out.bab = /^(1|full|fast)$/i.test(m[1]) ? 1 : /^(1\/2|0\.5|slow|poor)$/i.test(m[1]) ? 0.5 : 0.75;
      out.saves = { fort: /good/i.test(m[2]), ref: /good/i.test(m[3]), will: /good/i.test(m[4]) };
      mark(i); i++; continue;
    }
    if (words(t) <= 6) { mark(i); i++; continue; }        // some other heading or value
    break;
  }
  return out;
}

/** A heading that ends the archetype or favored-class list: the page's next
 *  section, which a page often names for the class ("Warden Feats"). */
const OTHER_SECTION = /^(?:[\w'’-]+ ){0,2}(?:Feats|Equipment|Bestiary)$|^(?:Class (?:Equipment|Features|Abilities|Skills)|Traits|Notes|Sample \w+|Legendary Talents)$/i;

/**
 * The archetype table under a class on the wiki: a header, then per
 * archetype its name, "<Class> (class)", sometimes a system, a one-line
 * flavour, publication and publisher. The line before an "(class)" line (or
 * a line naming the class) is the archetype's name; the first long line after
 * it is its flavour. Everything from the heading to the next boundary is used.
 */
function readArchetypes(trimmed, className, pre = new Set()) {
  const entries = [];
  const used = new Set();
  const at = trimmed.findIndex((l, i) => /^Archetypes$/i.test(l) && !pre.has(i));
  if (at === -1) return { entries, used };
  used.add(at);
  const nextText = (k) => { let j = k + 1; while (j < trimmed.length && !trimmed[j]) j++; return trimmed[j] || ''; };
  let current = null;
  for (let i = at + 1; i < trimmed.length; i++) {
    const t = trimmed[i];
    if (!t) { if (!trimmed[i + 1] && current) break; continue; }      // a double blank ends the table
    if (pre.has(i) || WIKI_CHROME.test(t) || /^Navigation$/.test(t)) break;
    if (entries.length && (TAIL_LINE.test(t) || OTHER_SECTION.test(t))) break;       // the next section
    used.add(i);
    if (/^Name\t/i.test(t) || /^Publication\t/i.test(t)) continue;
    const marksName = /\(class\)$/i.test(t)
      // a bare class name marks a name too, unless it is the publication line
      // of an entry still waiting for its flavour (or one that had none)
      || (lower(t) === lower(className) && (!current || current.flavour));
    if (marksName) {
      let j = i - 1;
      while (j > at && !trimmed[j]) j--;
      const prev = trimmed[j];
      if (j > at && words(prev) <= 6 && prev !== current?.name && prev !== current?.flavour && !/\(class\)$/i.test(prev) && lower(prev) !== lower(className)) {
        current = { name: prev, flavour: '' };
        entries.push(current);
      }
      continue;
    }
    // A page that lists its archetypes as a heading over a line of flavour
    // ("Banshee" over "Banshees specialize in…", sometimes dashed) rather
    // than in a table.
    const heading = t.replace(/^[-–—]\s*/, '');
    if (words(heading) <= 6 && /^[A-Z]/.test(heading) && !/[.:;,]$/.test(heading) && (!current || current.flavour)
      && /[.!?…]$/.test(nextText(i)) && words(nextText(i)) >= 4) {
      current = { name: heading, flavour: '' };
      entries.push(current);
      continue;
    }
    if (current && !current.flavour && (words(t) > 12 || (/[.!?…]$/.test(t) && words(t) >= 4))) current.flavour = t;
  }
  return { entries: entries.map((e) => (e.flavour ? `${e.name}: ${e.flavour}` : e.name)), used };
}

const isNoiseFeature = (name) => /^(?:source|note|editor'?s note|see|table|q|a)\b/i.test(name);

function titleCase(s) {
  return String(s).trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The table's level column: "Level" on most pages, "Class Level" on some. */
const LEVEL_HEAD = /^(?:Class )?Level\b/i;
const LEVEL_ONLY = /^(?:Class )?Level$/i;

/**
 * The progression table, in any of the shapes it copies as: tab-separated
 * cells, space-separated cells, or one cell per line. Returns the rows with
 * their level, the Special entries split, any extra columns (Known / Readied /
 * Stances) by header, the line indices used, and BAB and good saves read off
 * the last row.
 */
export function readClassTable(lines) {
  const rows = [];
  const used = new Set();
  let headers = null;
  let headerAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (LEVEL_HEAD.test(t) && /Base Attack|BAB|Special|Fort/i.test(t)) { headerAt = i; break; }
    if (LEVEL_ONLY.test(t) && /Base Attack|BAB/i.test(`${lines[i + 1] || ''} ${lines[i + 2] || ''}`)) { headerAt = i; break; }
  }
  if (headerAt >= 0) {
    const t = lines[headerAt];
    used.add(headerAt);
    if (t.includes('\t')) headers = t.split('\t').map((h) => h.trim());
    else if (LEVEL_ONLY.test(t.trim())) {
      headers = [];
      let j = headerAt;
      while (j < lines.length && !ORDINAL.test(lines[j].trim()) && headers.length < 12) {
        if (!isBlank(lines[j])) { headers.push(lines[j].trim()); used.add(j); }
        j++;
      }
    } else {
      headers = t.trim().split(/\s{2,}|\t/).map((h) => h.trim());
      if (headers.length < 5) headers = null;
    }
    // "Table: Warlord" above the header belongs to it.
    if (headerAt > 0 && /^Table:/i.test(lines[headerAt - 1].trim())) used.add(headerAt - 1);
  }
  const std = ['level', 'class level', 'base attack bonus', 'fort save', 'ref save', 'reflex save', 'will save', 'special'];
  const hdr = (headers || ['Level', 'Base Attack Bonus', 'Fort Save', 'Ref Save', 'Will Save', 'Special']).map((h) => h.trim());
  const idx = {
    level: hdr.findIndex((h) => LEVEL_ONLY.test(h)),
    bab: hdr.findIndex((h) => /base attack|^bab$/i.test(h)),
    fort: hdr.findIndex((h) => /^fort/i.test(h)),
    ref: hdr.findIndex((h) => /^ref/i.test(h)),
    will: hdr.findIndex((h) => /^will/i.test(h)),
    special: hdr.findIndex((h) => /^special/i.test(h)),
  };
  const extraCols = hdr.map((h, i) => [h, i]).filter(([h, i]) => h && !std.includes(lower(h)) && !Object.values(idx).includes(i) && !/^\d/.test(h));
  const cellsOf = (line) => (line.includes('\t')
    ? line.split('\t').map((c) => c.trim())
    : line.trim().split(/\s{2,}/).map((c) => c.trim()));

  let i = headerAt >= 0 ? headerAt + 1 : 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    let cells = null;
    let span = [i, i];
    if (isTableRow(line)) {
      cells = cellsOf(line);
      if (cells.length < 5 && !line.includes('\t')) {
        const m = t.match(/^(\d{1,2})(?:st|nd|rd|th)\s+(\+\d+(?:\/\+\d+)*)\s+(\+\d+)\s+(\+\d+)\s+(\+\d+)\s*(.*)$/);
        if (m) cells = [m[1], m[2], m[3], m[4], m[5], m[6]];
      }
      i++;
    } else if (ORDINAL.test(t) && /^\+\d/.test((lines[i + 1] || '').trim())) {
      cells = [t];
      let j = i + 1;
      while (j < lines.length && cells.length < hdr.length && !ORDINAL.test(lines[j].trim())) {
        cells.push(lines[j].trim());
        j++;
      }
      span = [i, j - 1];
      i = j;
    } else {
      if (rows.length >= 3 && !isBlank(t)) break;          // the table ended
      i++;
      continue;
    }
    if (!cells) continue;
    const level = Number(String(cells[idx.level >= 0 ? idx.level : 0]).match(/\d+/)?.[0]);
    if (!level || level > 20) continue;
    for (let k = span[0]; k <= span[1]; k++) used.add(k);
    const babText = cells[idx.bab >= 0 ? idx.bab : 1] || '';
    const specialText = cells[idx.special >= 0 ? idx.special : 5] || '';
    const special = specialText.split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter((s) => s && s !== '—' && s !== '-');
    const extra = extraCols.map(([h, ci]) => [h, cells[ci]]).filter(([, v]) => v !== undefined && v !== '' && v !== '—');
    rows.push({
      level, bab: babText, fort: cells[idx.fort >= 0 ? idx.fort : 2], ref: cells[idx.ref >= 0 ? idx.ref : 3],
      will: cells[idx.will >= 0 ? idx.will : 4], special, extra,
    });
    if (level === 20) break;
  }
  rows.sort((a, b) => a.level - b.level);

  let bab = null;
  let saves = null;
  const last = rows[rows.length - 1];
  if (last) {
    const top = Number(String(last.bab).match(/\+?(\d+)/)?.[1]);
    const lv = last.level;
    if (top) {
      const ratio = top / lv;
      bab = ratio >= 0.9 ? 1 : ratio >= 0.65 ? 0.75 : 0.5;
    }
    const good = (s) => {
      const v = Number(String(s || '').match(/\+?(\d+)/)?.[1]);
      return !!v && v >= 2 + lv / 2 - 0.6;
    };
    saves = { fort: good(last.fort), ref: good(last.ref), will: good(last.will) };
  }
  return { rows, bab, saves, headers: hdr, used };
}

/**
 * Feature prose, from `startAt` down, in the shapes a rules page uses:
 *
 *   "Rage (Ex): A barbarian can call upon…"      a typed feature, one line, its
 *                                                 following paragraphs part of it
 *   "Unstoppable (Ex)"                           a title line, an optional Source
 *   "Source Chronicle of Legends pg. 28"         line, then its paragraphs
 *   "Bonus Feat: At 1st level…"                  untyped, but named on the table
 *                                                 (or a known one: proficiencies,
 *                                                 maneuvers) -- a feature
 *   "Spirited Initiative: Whenever…"             untyped and not on the table --
 *                                                 a sub-entry of the feature above
 *   "Sheathed" + a paragraph                     a sidebar: folded into the
 *                                                 feature above under its heading
 *   "See: Legendary Samurai Kiai Art"            a pointer, kept in the feature
 *   "-10 penalty on Climb…", "Cannot run…"       list lines, kept in the feature
 *
 * A feature runs until the next feature, a heading, or the favored-class /
 * archetype tail. Returns [{name, type, text, title, source, level, from, to}].
 */
export function readFeatureProse(lines, { skipLabels = new Set(), startAt = 0, tableKeys = new Set(), mark = () => {}, pre = new Set(), mode = 'class' } = {}) {
  const out = [];
  const inline = /^([A-Z][^:\n]{1,60}?)\s*(?:\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\))?\s*:\s+(.{12,})$/;
  const titleRe = /^([A-Z][^\n]{1,60}?)\s*\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\)\s*$/;
  // a short capitalised line with no closing punctuation -- but not a swap sentence that lost its full stop ("This alters Iaijutsu Strike")
  const titleLike = (l) => l && words(l) <= 8 && /^[A-Z]/.test(l) && !/[.:;,]$/.test(l) && !inline.test(l) && !titleRe.test(l) && !/^This\b/.test(l) && !SWAP_SENTENCE.test(l);
  const nextNonBlank = (k) => { let j = k + 1; while (j < lines.length && (!lines[j].trim() || pre.has(j))) j++; return (lines[j] || '').trim(); };
  // prose rather than another heading: a paragraph, or a sentence of its own
  const bodyLike = (l) => !!l && (words(l) > 12 || (/[.!?]$/.test(l) && words(l) >= 4));
  const SECTION = /^(?:Description|Class Features|Cuts|Slashes|Techniques|Boosts|Counters|Stances|Talents|Deeds|Notes|Related)$/i;
  // the level a feature arrives at: "At 3rd level, …" opening a sentence, or "of 9th level or higher"
  const levelOf = (t) => Number(String(t).match(/(?:^|[.:;]\s+|\n)(?:At|Starting at|At the|Beginning at)\s+(\d{1,2})(?:st|nd|rd|th) level/i)?.[1]
    || String(t).match(/(?:^|[.:;]\s+|\n)At level (\d{1,2})\b/i)?.[1]
    || String(t).match(/\bof (\d{1,2})(?:st|nd|rd|th) level or higher/i)?.[1]) || null;
  const type1 = (t) => (t ? t.split(' ')[0] : null);
  let cur = null;          // the feature being built
  let afterHeading = false; // a heading's own intro paragraph is not a feature's
  let inTail = false;      // past Favored Class / Archetypes: nothing here is a feature

  const start = (name, type, text, i, extra = {}) => {
    cur = { name: name.trim(), type: type1(type), text: text.trim(), title: false, source: '', level: levelOf(text), from: i, to: i, ...extra };
    if (optionSection && !cur.optionOf && !cur.infoOf) {
      // typed entries are the options; an untyped "Name: text" is information about them
      if (cur.type || cur.title) { cur.optionOf = optionSection; cur.category = optionCategory; }
      else cur.infoOf = optionSection;
    }
    out.push(cur);
    afterHeading = false;
  };
  const append = (t, i, sep = '\n\n') => { if (!cur) return false; cur.text += (cur.text ? sep : '') + t; cur.to = i; return true; };

  let prevText = '';        // the last non-blank line seen
  let blankBefore = true;   // was the line before this one blank?
  // An options section: a heading such as "Topological Iaijutsu Techniques"
  // or "Rogue Talents" over a menu the player picks from, with sub-headings
  // ("Cuts", "Slashes") as categories. Typed entries under it are options of
  // the feature it names, untyped "Name: text" entries its information.
  const OPTIONS_HEAD = /(?:techniques?|talents?|options?|arts?|powers?|deeds?|exploits?|discoveries|hexes|arcana|evolutions?|infusions?|stances?|maneuvers?|tricks?|secrets?|mysteries|revelations?|inspirations?)$/i;
  let optionSection = null;
  let optionCategory = '';
  for (let i = Math.max(0, startAt); i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { blankBefore = true; continue; }
    if (pre.has(i)) continue;
    const startsParagraph = blankBefore && !/:$/.test(prevText);
    blankBefore = false;
    const remember = () => { prevText = t; };
    if (WIKI_CHROME.test(t)) continue;
    if (FCB_HEADING.test(t) || /^Archetypes$/i.test(t) || /^Navigation$/.test(t) || (mode === 'archetype' && /^(?:Related|Notes)$/i.test(t))) { inTail = true; cur = null; optionSection = null; remember(); continue; }
    if (inTail) { if (BOILERPLATE.test(t)) mark(i); continue; }
    // "Weapon and Armor Proficiency" heads a section on one page and a feature
    // on the next; a paragraph under it, rather than more headings, settles it.
    const headsFeature = mode === 'class' && KNOWN_UNTYPED.test(t) && bodyLike(nextNonBlank(i));
    if ((TAIL_LINE.test(t) || CLASS_HEADINGS.test(t)) && !headsFeature) { mark(i); cur = null; afterHeading = true; remember(); continue; }
    if (afterHeading && !cur && /^Source\b/.test(t)) { mark(i); remember(); continue; }      // a section's own source line
    if (BOILERPLATE.test(t)) { mark(i); remember(); continue; }

    let m = t.match(titleRe);
    if (m) {
      // gather: an optional Source line, then paragraphs
      let source = '';
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^Source\b/.test(lines[j].trim())) { source = lines[j].trim().replace(/^Source:?\s*/, ''); }
      start(m[1], m[2], '', i, { title: true, source });
      if (source) { cur.to = j; i = j; }
      remember();
      continue;
    }
    m = t.match(inline);
    if (m && words(m[1]) <= 7 && !skipLabels.has(lower(m[1])) && !/^(?:PFS Legal|Q|A|See)$/.test(m[1])) {
      const key = featureKey(m[1]);
      const typed = !!m[2];
      // An untyped "Name: text" is a feature when the table names it, when it
      // is one of the known ones, or -- on an archetype page, which has no
      // table -- when it opens a paragraph of its own rather than following a
      // line that introduced a list ("…in the following ways:"). Otherwise it
      // is a sub-entry of the feature above.
      const own = mode === 'archetype' ? startsParagraph : false;
      if (typed || tableKeys.has(key) || KNOWN_UNTYPED.test(m[1]) || own || !cur) { start(m[1], m[2], m[3], i); remember(); continue; }
      append(t, i);
      remember();
      continue;
    }
    if (/^See:\s/i.test(t)) { append(t, i, '\n'); remember(); continue; }
    if (mode === 'archetype' && titleLike(t)) {
      const n = nextNonBlank(i);
      // a section heading over more headings or feature lines ("Class Features", "Cuts")
      if (SECTION.test(t) || titleLike(n) || titleRe.test(n) || inline.test(n) || !n) {
        const namesFeature = out.some((p) => featureKey(p.name) === featureKey(t));
        if (!SECTION.test(t) && (OPTIONS_HEAD.test(t) || namesFeature) && words(t) >= 2) { optionSection = t; optionCategory = ''; }
        else if (optionSection && words(t) <= 3) optionCategory = t;      // "Cuts", "Slashes"
        mark(i); cur = null; afterHeading = SECTION.test(t); remember(); continue;
      }
      // a feature with no type over its paragraph ("Scholar's Education", "Topological Iaijutsu Techniques")
      if (words(n) > 12 && (words(t) >= 2 || !cur)) { start(t, null, '', i, { title: true }); remember(); continue; }
    }
    // Some pages head every feature with its bare name -- no "(Ex)", the
    // paragraph a blank line below ("Combat Training" over its text). On a
    // class page the table settles which of those are features: the ones it
    // names, plus the known untyped ones. Any other short line stays what it
    // was, a sidebar heading inside the feature above.
    if (mode === 'class' && titleLike(t) && (tableKeys.has(featureKey(t)) || KNOWN_UNTYPED.test(t))
      && bodyLike(nextNonBlank(i))) { start(t, null, '', i, { title: true }); remember(); continue; }
    if (afterHeading && !cur) { if (words(t) > 12) mark(i); remember(); continue; }   // a heading's intro paragraph
    if (!cur) { remember(); continue; }
    // a sidebar heading over a paragraph, a list line, or a continuation paragraph
    const nextLong = words(nextNonBlank(i)) > 12;      // its paragraph may be a blank line below
    if (words(t) <= 8 && /^[A-Z]/.test(t) && !/[.:;,]$/.test(t) && nextLong) { append(t, i); remember(); continue; }
    append(t, i, /^[-–•]|^\d+\.\s|^[A-Z][^.]{0,60}$/.test(t) ? '\n' : '\n\n');
    if (cur.title && cur.level === null) cur.level = levelOf(t);
    remember();
  }
  // "Description" is the flavour, not a feature: the block reader takes it
  for (const p of out) if (p.title && /^Description$/i.test(p.name)) p.flavour = true;
  return out;
}

/** The "Race (Source pg. N): text" lines under Favored Class Options. */
function readFavoredClass(lines, pre = new Set()) {
  const entries = [];
  const used = new Set();
  let inFcb = false;
  for (let i = 0; i < lines.length; i++) {
    if (pre.has(i)) continue;
    const t = lines[i].trim();
    if (FCB_HEADING.test(t)) { inFcb = true; used.add(i); continue; }
    if (!inFcb) continue;
    if (!t) { if (entries.length && isBlank(lines[i + 1] || '')) break; continue; }   // a double blank ends the list
    // A FAQ dropped into the middle of the list is an interlude, not the end:
    // its Q/A lines are consumed and the list carries on after it.
    if (/^FAQ$/i.test(t) || /^[QA]:\s/.test(t)) { used.add(i); continue; }
    if (/^(Archetypes|Related|Racial Subtypes)$/i.test(t) || (entries.length && OTHER_SECTION.test(t))) break;
    if (/^Race\tOption\tSource$/i.test(t)) { used.add(i); continue; }
    if (/^(?:PFS Legal )?[A-Z][\w' -]+(?: \([^)]*\))?:\s+\S/.test(t) || /^Any [\w ]+:/i.test(t)) { entries.push(t.replace(/^PFS Legal /, '')); used.add(i); continue; }
    if (/^[A-Z][\w' -]+$/.test(t) && words(t) <= 3) { entries.push(t); used.add(i); continue; }
    if (entries.length && /^[+\-–]|^Gain|^Add|^Increase|^Reduce|^When|^While/.test(t)) { entries[entries.length - 1] += `: ${t}`; used.add(i); continue; }
    if (entries.length && words(t) <= 6 && /^[A-Z]/.test(t)) { used.add(i); continue; }   // a source cell
    if (words(t) > 12) { used.add(i); continue; }                                    // the section's own hint sentence
  }
  return { entries, used };
}

/* ---------------- races ---------------- */

const RACE_FIELD = /^(Ability Score Modifiers?|Size|Type|Base Speed|Speed|Languages)\s*(?:\([^)]*\))?:\s*(.+)$/i;
const RACE_SECTIONS = /^(Standard Racial Traits|Alternate Racial Traits|Racial Subtypes|Favored Class Options|Defense Racial Traits|Feat and Skill Racial Traits|Senses Racial Traits|Offense Racial Traits|Magical Racial Traits|Movement Racial Traits|Weakness Racial Traits|Other Racial Traits|Physical Description|Society|Relations|Alignment and Religion|Adventurers|Names?|Table: [^\n]*|FAQ|Random Starting Ages|Aging Effects|Random Height and Weight|Vital Statistics)$/i;

export function readRace(lines, pre = new Set()) {
  const report = [];
  const blocks = [];
  const used = new Set(pre);
  const text = lines.join('\n');
  const name = raceName(text) || 'Race';
  const abilityMods = {};
  const fields = {};
  const traits = [];
  const alternates = [];
  const subtypes = [];
  const fcb = [];
  const preamble = [];
  let tables = 0;

  let section = 'preamble';
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || pre.has(i)) return;
    const sec = t.match(RACE_SECTIONS);
    if (sec) {
      const s = lower(sec[1]);
      // A FAQ is an interlude: its Q/A lines are consumed and the section it
      // interrupted resumes with the next line that is not one of them.
      if (/^faq/.test(s)) { used.add(i); return; }
      section = /^alternate/.test(s) ? 'alternate'
        : /racial traits$/.test(s) ? 'standard'
          : /^racial subtypes/.test(s) ? 'subtypes'
            : /^favored/.test(s) ? 'fcb'
              : /^(physical|society|relations|alignment|adventurers|names?)/.test(s) ? 'preamble'
                : 'tables';
      used.add(i);
      return;
    }
    if (/^[QA]:\s/.test(t)) { used.add(i); return; }
    if (section === 'tables') { used.add(i); tables++; return; }
    const fm = t.match(RACE_FIELD);
    if (fm && section !== 'alternate' && section !== 'fcb') {
      used.add(i);
      const key = lower(fm[1]);
      const val = fm[2].trim();
      if (key.startsWith('ability')) {
        for (const m of val.matchAll(/([+\-–]\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/gi)) {
          abilityMods[ABILITY_WORDS[lower(m[2])]] = signedNum(m[1]);
        }
        fields.abilityText = val;
      } else if (key === 'size') fields.size = val.match(/\b(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)\b/i)?.[1] || val.split(/[ ,.]/)[0];
      else if (key.includes('speed')) fields.speed = Number(val.match(/(\d+)\s*(?:feet|ft)/i)?.[1]) || null;
      else if (key === 'languages') {
        fields.languagesText = val;
        const first = val.match(/speaking\s+([^.]+)\./i)?.[1] || val.split('.')[0];
        fields.languages = first.replace(/\band\b/g, ',').split(/,\s*/).map((s) => s.trim()).filter((s) => s && !/^see\b|^with\b|^those\b/i.test(s));
      } else if (key === 'type') fields.type = val;
      return;
    }
    const nm = t.match(/^([A-Z][^:\n]{1,50}?)\s*(?:\((?:[^)]*)\))?\s*:\s+(\S.*)$/);
    if (section === 'standard' && nm) { traits.push({ name: nm[1].trim(), text: nm[2].trim() }); used.add(i); return; }
    if (section === 'alternate' && nm) { alternates.push({ name: nm[1].trim(), text: nm[2].trim() }); used.add(i); return; }
    // A trait whose page dropped the colon -- "Wanderer You gain Endurance…":
    // a short run of capitalised words, then a sentence opener.
    const nc = section === 'alternate' && t.match(/^((?:[A-Z][\w'’-]*\s){1,4}?)(?=(?:You|A|An|The|These|Those|Some|Characters|Members|Gain|Select|Add|Increase|Whenever|While|When|Once|Instead|Rather|[A-Z][a-z]+ (?:with this racial trait|gain|have|are|receive|treat|can|who))\b)(.{20,})$/);
    if (nc && !/^(?:This|The|A|An)\s/.test(nc[1])) { alternates.push({ name: nc[1].trim(), text: nc[2].trim() }); used.add(i); return; }
    if (section === 'alternate' && /^[A-Z][^:]{1,50}$/.test(t) && words(t) <= 6) { alternates.push({ name: t, text: '' }); used.add(i); return; }
    if (section === 'alternate' && alternates.length && !alternates[alternates.length - 1].text) { alternates[alternates.length - 1].text = t; used.add(i); return; }
    if (section === 'alternate' && words(t) > 12 && !alternates.length) { used.add(i); return; }   // the section's hint sentence
    if (section === 'subtypes' && nm) { subtypes.push(`${nm[1].trim()}: ${nm[2].trim()}`); used.add(i); return; }
    if (section === 'subtypes' && words(t) > 12 && !subtypes.length) { used.add(i); return; }
    if (section === 'fcb' && nm) { fcb.push(t.replace(/^PFS Legal /, '')); used.add(i); return; }
    if (section === 'fcb' && words(t) > 12 && !fcb.length) { used.add(i); return; }
    if (section === 'preamble' && nm && !/^(?:PFS Legal )?[A-Z][\w' -]+ \([^)]*pg\./.test(t)) { preamble.push(t); used.add(i); return; }
    if (section === 'preamble' && words(t) > 12) { preamble.push(t); used.add(i); return; }
    if (section === 'standard' && words(t) > 12 && !traits.length) { preamble.push(t); used.add(i); }
  });
  const description = [fields.type && `Type: ${fields.type}`, fields.abilityText && `Ability scores: ${fields.abilityText}`,
    fields.languagesText && `Languages: ${fields.languagesText}`, ...preamble].filter(Boolean).join('\n');

  blocks.push(normalizeBlock({
    kind: 'race', name, size: fields.size || '', speed: fields.speed ?? null, abilityMods, traits,
    languages: fields.languages || [], text: description,
  }));
  report.push(`Race ${name}: ${Object.entries(abilityMods).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(' ') || 'no ability modifiers found'}, ${fields.size || 'size ?'}, ${fields.speed ? `${fields.speed} ft` : 'speed ?'}, ${traits.length} standard trait(s)${tables ? '; age/height tables dropped' : ''}.`);

  for (const a of alternates) blocks.push(normalizeBlock({ kind: 'trait', name: a.name, text: a.text, source: sourceTag(a.text), race: name }));
  if (alternates.length) {
    const known = blocks.filter((b) => b.kind === 'trait' && b.replaces.length).length;
    report.push(`${alternates.length} alternate racial trait(s) as trait blocks; ${known} say what they replace, and swap it out when added.`);
  }
  if (subtypes.length) {
    blocks.push(normalizeBlock({ kind: 'note', name: `${name} — racial subtypes`, text: subtypes.join('\n') }));
    report.push(`${subtypes.length} racial subtype(s) as a note.`);
  }
  if (fcb.length) {
    blocks.push(normalizeBlock({ kind: 'note', name: `Favored class options — ${name}`, text: fcb.join('\n') }));
    report.push(`${fcb.length} favored class option(s) as a note.`);
  }
  return { name, blocks, report, used };
}

const sourceTag = (text) => String(text || '').match(/(?:Source\s+([A-Z]{2,}\d*[\w:]*)|\b(PPC:\w+|PZO\d+))\s*\.?$/)?.[0]?.replace(/^Source\s+/, '') || '';

/**
 * A race page rarely names the race in a heading a copy keeps; the traits
 * do -- "Dwarves gain…", "Dwarves with this racial trait…". The most-named
 * plural before those verbs is the race, singularised.
 */
export function raceName(text) {
  const counts = new Map();
  for (const m of String(text).matchAll(/\b([A-Z][a-z]{2,15}(?:s|es|ves|ies))\b\s+(?:with this racial trait|gain|are|have|begin play|receive|can|treat|who|whose|generally|often|occasionally|keep|use)\b/g)) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let best = null;
  for (const [w, n] of counts) if (!best || n > best[1]) best = [w, n];
  return best ? singular(best[0]) : '';
}

export function singular(w) {
  if (/ves$/.test(w)) return w.replace(/ves$/, 'f');            // Dwarves -> Dwarf, Elves -> Elf
  if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
  if (/(?:ch|sh|ss|x|z)es$/.test(w)) return w.replace(/es$/, '');
  if (/s$/.test(w)) return w.replace(/s$/, '');
  return w;
}

/* ---------------- veils ---------------- */

/** The site's own furniture, above and around a veil article. */
const VEIL_CHROME = /^(?:Anonymous|Log in|Library of Metzofitz|Search.*|Namespaces.*|Page ?Discussion|Page actions|Read|View source.*|History|Purge|Retold|Veils|Information)$/i;
/** The headings of the information box, in the order the wiki lays them out. */
const VEIL_INFO = /^(Descriptors?|Classes Available|Chakra Slots?|Saving Throw|Veil Sets|Variants|Sources?)$/i;
/** After the binds, footnotes and navigation; this is where the veil ends. */
const VEIL_TAIL = /^(?:Bind Level|Notes|Related|See Also|Archetypes|Classes|Class Options|Navigation|Categories)$/i;
const CHAKRA = /^(Hands|Feet|Head|Headband|Neck|Shoulders|Chest|Body|Belt|Wrists|Ring|Blood|Storm|Black|Interface)(?: \(.*\))?$/i;

/**
 * A veil, as the wiki lays it out: a title, an information box (Descriptor,
 * Classes Available, Chakra Slots, Saving Throw, Veil Sets, Sources), the
 * shaping text, then "Essence:" and "Chakra Bind (Slot):" paragraphs, then
 * bind-level footnotes and the site's navigation. One `veil` block: the
 * text is the shaping text and the Essence / Chakra Bind paragraphs under
 * their headings (plus the saving throw and the bind-level lines, which a
 * player wants at the table); the info box goes to the block's fields, not
 * its text; the navigation and the "this veil was added to…" notes are
 * dropped. Everything in the segment is used.
 */
export function readVeil(lines, pre = new Set()) {
  const used = new Set(pre);
  const all = [];
  lines.forEach((raw, i) => { used.add(i); const l = raw.trim(); if (l) all.push(l); });

  // Title: the line above "Namespaces", else the line after the "Veils"
  // breadcrumb, else the first short capitalised line that is not chrome.
  let name = '';
  const nsAt = all.findIndex((l) => /^Namespaces/i.test(l));
  if (nsAt > 0) name = all[nsAt - 1];
  if (!name || VEIL_CHROME.test(name)) {
    const vAt = all.findIndex((l) => /^Veils$/i.test(l));
    if (vAt >= 0 && all[vAt + 1] && !/^Information$/i.test(all[vAt + 1])) name = all[vAt + 1];
  }
  if (!name || VEIL_CHROME.test(name)) name = all.find((l) => !VEIL_CHROME.test(l) && !VEIL_INFO.test(l) && words(l) <= 5 && /^[A-Z]/.test(l) && !/[.:]$/.test(l)) || 'Veil';

  // The information box: heading -> values, until the first sentence.
  // Reading starts at the title, so a previous page's navigation that the
  // segment reached back over is skipped.
  const info = {};
  let i = Math.max(0, all.indexOf(name));
  let heading = null;
  const isSentence = (l) => words(l) >= 12 || /[.!?]$/.test(l);
  const hasInfoBox = all.some((l) => VEIL_INFO.test(l));
  for (; i < all.length; i++) {
    const l = all[i];
    if (l === name && !heading) continue;
    if (VEIL_CHROME.test(l)) continue;
    const h = l.match(VEIL_INFO);
    if (h) { heading = lower(h[1]).replace(/s$/, ''); info[heading] ||= []; continue; }
    // A notice above the box ("The version of this content updated for…")
    // is not the article; the article starts after the box, if there is one.
    if (!heading && hasInfoBox) continue;
    if (isSentence(l) || /^Essence:/i.test(l) || /^Chakra Bind\b/i.test(l)) break;
    if (heading) info[heading].push(l);
  }
  const chakras = (info['chakra slot'] || []).filter((l) => CHAKRA.test(l));
  const descriptor = (info.descriptor || []).find((l) => /\(/.test(l)) || (info.descriptor || [])[0] || '';
  const save = (info['saving throw'] || []).filter((l) => !/^none$/i.test(l)).join('; ');
  const source = (info.source || []).join('; ');

  // The article: shaping text, then Essence and Chakra Bind paragraphs.
  const desc = [];
  const features = [];
  const footnotes = [];
  let inTail = false;
  for (; i < all.length; i++) {
    const l = all[i];
    if (VEIL_TAIL.test(l)) { inTail = true; continue; }
    if (inTail) {
      if (/^↑/.test(l)) footnotes.push(l.replace(/^↑\s*/, ''));   // "Bind Level: Daevic 10, …"
      continue;                                                    // "This veil was added to…", navigation
    }
    const m = l.match(/^(Essence|Chakra Bind\s*\([^)]*\))\s*:\s*(.*)$/i);
    if (m) {
      const bind = m[1].match(/^Chakra Bind\s*\(([^)]*)\)/i);
      const level = m[2].match(/^\[Bind Level (\d+)\]\s*/i);
      features.push({ name: bind ? `Chakra Bind (${bind[1]})${level ? ` — bind level ${level[1]}` : ''}` : 'Essence', text: level ? m[2].slice(level[0].length) : m[2] });
    } else if (features.length) features[features.length - 1].text += `\n${l}`;
    else desc.push(l);
  }
  const text = [
    ...desc,
    ...features.map((f) => `${f.name}: ${f.text}`),
    save ? `Saving throw: ${save}` : '',
    footnotes.join('\n'),
  ].filter(Boolean).join('\n\n');
  const block = normalizeBlock({ kind: 'veil', name, slot: chakras.join(', '), descriptor, text, source });
  return {
    name, blocks: [block], used,
    report: [`Veil ${name}${chakras.length ? ` (${chakras.join(' or ')})` : ' (no chakra slot found)'}: description${features.length ? ` + ${features.map((f) => f.name.replace(/ —.*/, '')).join(', ')}` : ''}${source ? `; source ${source}` : ''}.`],
  };
}

/* ---------------- a scraper's structured markdown ---------------- */

/**
 * A document a tool wrote, rather than a page somebody copied.
 *
 * Everything else in this file reads pages built for human eyes, where a
 * heading is a short line and a talent's name is a short line and telling the
 * two apart is most of the work. A scraper does not have that problem: it
 * knows what it found and can say so. So this shape is read on its own terms,
 * and read *first* -- `clean()` flattens the markdown that the page readers
 * cannot use and this one is made of.
 *
 *     # Iron Tortoise            what the document is about
 *     > prose                    its description, as a blockquote
 *     ## Maneuvers & Stances     a section
 *     ### Level 1 Maneuvers      a group inside it
 *     #### Angering Smash        one entry
 *     * **Level:** 1 (Maneuver [Strike])
 *     * **Range:** Melee attack        its fields, one per line
 *     **Summary:** *one line*    an optional précis
 *     prose…                     and its text
 *
 * What an entry *is* comes from the fields it carries rather than from where
 * it sits or what the document is called: a thing with a Discipline and an
 * Initiation Action is a maneuver wherever it turns up. That is what lets the
 * scraper grow without this reader being told -- a new kind is a new row in
 * STRUCTURED_KINDS -- and anything unrecognised comes back as a leftover to
 * be tagged rather than being dropped.
 */

/** `* **Key:** value`, the field lines under an entry. */
const MD_FIELD = /^\s*[*-]\s+\*\*\s*([^:*]+?)\s*:?\s*\*\*:?\s*(.*)$/;
/** `**Summary:** *text*` -- the one-line précis over the prose. */
const MD_SUMMARY = /^\s*\*\*\s*Summary\s*:?\s*\*\*:?\s*(.*)$/i;
const MD_HEAD = /^(#{1,6})\s+(.+?)\s*#*$/;
const MD_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** Emphasis around a value, which the scraper leaves on its summaries. */
const unemph = (s) => String(s ?? '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
/**
 * A label the scraper half-converted: `    * Special:**`, `    * Note:**`.
 * The bold opened on the line above and it lost the opening stars, so the
 * line reads as a stray bullet. Straightened rather than dropped -- it is a
 * real part of the rule underneath it.
 */
const MD_BROKEN_LABEL = /^\s*\*\s+([A-Z][\w' -]{1,24}):\*\*\s*(.*)$/;

/**
 * A MediaWiki table, which some pages carry through the scraper whole.
 *
 * `{| … |- … !head … |cell … |}` is unreadable in a prose cell, and the sheet
 * shows tab-separated rows everywhere else it shows a table, so that is what
 * it becomes. Nothing is thrown away: the caption leads, the header row is a
 * row, and cells that shared a line (`!A!!B`) are split out.
 */
function wikiTable(lines) {
  const rows = [];
  let caption = '';
  let row = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^\{\|/.test(l)) continue;
    if (/^\|\}/.test(l)) break;
    if (/^\|\+/.test(l)) { caption = unemph(l.slice(2)); continue; }
    if (/^\|-/.test(l)) { if (row?.length) rows.push(row); row = []; continue; }
    if (/^[!|]/.test(l)) {
      row ??= [];
      row.push(...l.slice(1).split(l[0] === '!' ? '!!' : '||').map((c) => c.trim()));
    }
  }
  if (row?.length) rows.push(row);
  return [caption, ...rows.map((r) => r.join('\t'))].filter(Boolean).join('\n');
}

/**
 * The markup left in a scraper's prose, once the structure has been read off
 * it: markdown links, a MediaWiki external link (`[https://… label]`), bold.
 *
 * Single-asterisk emphasis stays, because `clean()` leaves it on every other
 * paste and `*destructive blast*` is how these books name a defined term.
 */
const tidyProse = (s) => String(s ?? '')
  .replace(/\[\[([^\]]*)\]\([^)]*\)\]/g, '[$1]')
  .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
  .replace(/\[(?:https?|ftp):\/\/\S+\s+([^\]\n]+)\]/g, '$1')
  .replace(/\*\*([^*\n]+)\*\*/g, '$1');

/** Every wiki table in a stretch of text, turned into tab-separated rows. */
export function unwikiTables(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\{\|/.test(lines[i])) { out.push(lines[i]); continue; }
    const start = i;
    while (i < lines.length && !/^\s*\|\}/.test(lines[i])) i++;
    out.push(wikiTable(lines.slice(start, i + 1)));
  }
  return out.join('\n');
}

/**
 * Is this a scraper document at all?
 *
 * A markdown *copy* of a rules page (a "copy as markdown" browser extension)
 * also has headings and bold, and `clean()` already flattens those for the
 * page readers. What only a scraper writes is the field list: several lines of
 * `* **Key:** value` in a row. Three is past coincidence.
 */
export function looksStructured(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (!lines.some((l) => MD_HEAD.test(l))) return false;
  return lines.filter((l) => MD_FIELD.test(l)).length >= 3;
}

/**
 * The document as headings, entries and fields -- no interpretation yet. Kept
 * apart from the reading so the shape can be tested on its own, and so a new
 * kind of entry needs nothing here.
 */
export function parseStructured(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const doc = {
    title: '', intro: [], introAt: [0, 0], entries: [], strays: [],
  };
  let entry = null;
  const heads = [];                       // the heading stack, by depth
  const close = () => { if (entry) doc.entries.push(entry); entry = null; };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (MD_RULE.test(line)) { close(); return; }

    const h = line.match(MD_HEAD);
    if (h) {
      const depth = h[1].length;
      close();
      heads.length = Math.max(0, depth - 1);
      heads[depth - 1] = h[2].trim();
      if (depth === 1) { doc.title = h[2].trim(); return; }
      // A heading deeper than the document's sections opens an entry; the
      // ones above it are the trail saying which group it is in.
      if (depth >= 4) {
        entry = {
          name: h[2].trim(),
          fields: new Map(),
          // The label as the scraper spelt it, kept beside the key it is
          // matched on: a leftover is read by a person in the review panel,
          // and "target / area" is not how anybody wrote it.
          labels: new Map(),
          summary: '',
          body: [],
          at: i,
          section: heads.slice(1, depth - 1).filter(Boolean),
        };
      }
      return;
    }

    if (line.startsWith('>')) {
      // "> > text" -- the scraper nests a quote inside the description, and
      // one level stripped leaves a stray marker in the prose.
      const t = line.replace(/^(?:>\s?)+/, '');
      if (entry) entry.body.push(t);
      else { if (!doc.intro.length) doc.introAt = [i, i]; doc.intro.push(t); doc.introAt[1] = i; }
      return;
    }

    const f = entry && line.match(MD_FIELD);
    if (f) {
      const label = f[1].trim();
      entry.fields.set(label.toLowerCase(), unemph(f[2]));
      entry.labels.set(label.toLowerCase(), label);
      return;
    }
    const s = entry && line.match(MD_SUMMARY);
    if (s) { entry.summary = unemph(s[1]); return; }

    if (!line.trim()) { if (entry) entry.body.push(''); return; }
    const b = line.match(MD_BROKEN_LABEL);
    const text = b ? `${b[1]}: ${b[2]}`.trim() : line.trim();
    if (entry) entry.body.push(text);
    else doc.strays.push({ text, at: i });
  });
  close();

  doc.intro = tidyProse(unwikiTables(doc.intro.join('\n'))).split('\n');
  for (const e of doc.entries) {
    e.text = tidyProse(unwikiTables(e.body.join('\n'))).replace(/\n{3,}/g, '\n\n').trim();
    delete e.body;
  }
  return doc;
}

/** A field by any of the names a scraper might have given it. */
const pick = (fields, ...names) => {
  for (const n of names) {
    const v = fields.get(n);
    if (v) return v;
  }
  return '';
};

/**
 * A maneuver or stance out of a structured entry.
 *
 * `Level: 1 (Maneuver [Strike])` carries three things at once -- which level,
 * whether it is a maneuver or a stance, and its type -- because that is how a
 * discipline's table prints it.
 */
function structuredManeuver(e) {
  const raw = pick(e.fields, 'level');
  const paren = raw.match(/\(([^)]*)\)/)?.[1] || '';
  const bracket = paren.match(/\[([^\]]*)\]/)?.[1] || '';
  const kind = /stance/i.test(paren) ? 'stance' : 'maneuver';
  const action = pick(e.fields, 'initiation action', 'action');
  const save = pick(e.fields, 'saving throw', 'save');
  // The summary is the précis a table actually reads out; the prose under it
  // is the rule. Both are worth having and there is one cell, so they stack.
  const text = [e.summary, e.text].filter(Boolean).join('\n\n');
  return {
    discipline: pick(e.fields, 'discipline'),
    entry: {
      level: Number(raw.match(/\d+/)?.[0]) || 0,
      kind,
      name: e.name,
      type: bracket.trim() || (kind === 'stance' ? 'Stance' : titleCase(paren.trim())),
      action: ACTION_WORDS.find(([re]) => re.test(action))?.[1] || action,
      range: pick(e.fields, 'range'),
      target: pick(e.fields, 'target / area', 'target', 'targets', 'area', 'effect'),
      duration: pick(e.fields, 'duration'),
      save: SAVE_ALIASES[lower(save)] ?? save,
      dc: pick(e.fields, 'dc', 'save dc'),
      text,
    },
  };
}

/**
 * A whole sphere, where the *document* is the thing and its entries are the
 * talents inside it -- the other way round from a discipline, whose document
 * is only a wrapper and whose entries are each their own maneuver.
 *
 * The sphere's own description keeps the base ability written into it (the
 * scraper leaves `*Destructive Blast:* …` in the blockquote rather than
 * heading it), because inventing a heading the document does not have is a
 * worse lie than a long description. Which side of the line it is on is not
 * in the document at all, so it is looked up by name and left blank when the
 * engine has never heard of it.
 */
function structuredSphere(doc) {
  const talents = doc.entries.map((e) => {
    const { name, tags, sources } = splitTalentName(e.name);
    // `Tags: Blast Type, Acid` -- the groups a talent belongs to, which is
    // what a caster filters on when looking for one.
    for (const t of pick(e.fields, 'tags', 'tag').split(',')) {
      const v = t.trim();
      if (v && !tags.some((x) => lower(x) === lower(v))) tags.push(v);
    }
    const source = pick(e.fields, 'source', 'sources');
    if (source && !sources.includes(source)) sources.push(source);
    return {
      name,
      group: e.section[e.section.length - 1] || '',
      tags,
      sources,
      prerequisites: pick(e.fields, 'prerequisite', 'prerequisites'),
      text: e.text,
    };
  });
  return {
    name: doc.title,
    kind: sphereSide(doc.title, ''),
    description: doc.intro.join('\n').trim(),
    abilities: [],
    talents,
  };
}

/**
 * Kinds where the document as a whole is the thing, not each entry.
 *
 * Asked before the per-entry kinds, and a match consumes every entry. What
 * says which is the scraper's own section heading -- the one place a document
 * states what it is about -- rather than anything guessed from the contents.
 */
const STRUCTURED_DOCS = [
  {
    kind: 'sphere',
    when: (doc) => !!doc.title
      && doc.entries.length
      && doc.entries.some((e) => /\bsphere talents\b/i.test(e.section[0] || '')),
    drops: [],
    read: structuredSphere,
    into: 'spheres',
  },
];

/**
 * What each kind of entry looks like, and what to make of it.
 *
 * `wants` are the fields that identify it -- all of them must be there. Order
 * matters only in that the first match wins, so a narrower kind goes above a
 * wider one. `drops` are fields the sheet has nowhere to put, named so the
 * report can say they were left out instead of them vanishing.
 */
const STRUCTURED_KINDS = [
  {
    kind: 'maneuver',
    wants: ['discipline', 'initiation action'],
    drops: ['source', 'prerequisite', 'prerequisites'],
    read: structuredManeuver,
    into: 'maneuvers',
  },
];

/** What was read off a sphere document, in one line. */
function sphereLine(s) {
  const groups = [...new Set(s.talents.map((t) => t.group).filter(Boolean))];
  const tagged = s.talents.filter((t) => t.tags.length).length;
  const pre = s.talents.filter((t) => t.prerequisites).length;
  return `Sphere ${s.name}${s.kind ? ` (${s.kind})` : ' (neither list knows it)'}: `
    + `${s.talents.length} talent${s.talents.length === 1 ? '' : 's'}`
    + `${groups.length ? ` in ${groups.length} group(s)` : ''}`
    + `${tagged ? `, ${tagged} tagged` : ''}${pre ? `, ${pre} with prerequisites` : ''}.`
    + (s.description ? ' Its description and base ability are kept with it.' : '');
}

/**
 * Read a scraper document. Same shape back as `parsePaste`, because it is one
 * of the two things `parsePaste` can be.
 */
export function readStructured(text) {
  const doc = parseStructured(text);
  const out = {
    blocks: [], maneuvers: [], spheres: [], report: [], leftovers: [],
  };
  const dropped = new Set();
  const unknown = [];
  const counts = new Map();

  // A document that is itself one thing -- a sphere and its talents -- is
  // read whole, and its entries are not offered again as things of their own.
  const asDoc = STRUCTURED_DOCS.find((k) => k.when(doc));
  if (asDoc) {
    out[asDoc.into].push(asDoc.read(doc));
    counts.set(asDoc.kind, 1);
    out.report.push(sphereLine(out.spheres[0]));
    return out;
  }

  for (const e of doc.entries) {
    const kind = STRUCTURED_KINDS.find((k) => k.wants.every((w) => e.fields.has(w)));
    if (!kind) { unknown.push(e); continue; }
    for (const d of kind.drops || []) if (e.fields.get(d)) dropped.add(d);
    out[kind.into].push(kind.read(e));
    counts.set(kind.kind, (counts.get(kind.kind) || 0) + 1);
  }

  // The document's own title and description have nowhere to go -- a
  // discipline is a name and its maneuvers -- so the description comes back
  // to be tagged, the way anything else nothing claimed does.
  const intro = doc.intro.join('\n').trim();
  if (intro) {
    out.leftovers.push({
      text: doc.title ? `${doc.title}\n${intro}` : intro,
      lines: doc.introAt,
      near: doc.title ? { kind: 'document', name: doc.title } : null,
      suggest: 'note',
    });
  }
  for (const e of [...unknown, ...doc.strays]) {
    const text = e.fields
      ? [e.name, ...[...e.fields].map(([k, v]) => `${e.labels.get(k) || k}: ${v}`), e.text]
        .filter(Boolean).join('\n')
      : e.text;
    out.leftovers.push({
      text, lines: [e.at, e.at], near: doc.title ? { kind: 'document', name: doc.title } : null, suggest: suggestFor({ text }),
    });
  }

  const said = [...counts].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(', ');
  out.report.push(said
    ? `${doc.title || 'A document'}: ${said}.`
      + (dropped.size ? ` Their ${[...dropped].join(' and ')} line${dropped.size === 1 ? ' has' : 's have'} no cell and ${dropped.size === 1 ? 'was' : 'were'} left out.` : '')
      + (intro ? ' Its description is below, to keep as a note or leave out.' : '')
    : `${doc.title || 'A document'}: nothing here matched a kind this reader knows. Tag it below, or keep it as a note.`);
  return out;
}

/* ---------------- spheres ---------------- */

/**
 * The tags a talent's name carries, and what each of them means.
 *
 * Two styles on the Spheres wikis, and they say different things. A `(…)` tag
 * is a **rules** tag -- `(counter)` is a talent a counter punch may apply,
 * `(stance)` one you take a stance in -- and belongs with the talent for good.
 * A `[…]` tag is nearly always **provenance**: `[3PP]`, `[Apoc]`, `[Youxia
 * HB]`, `[EO3]` say which book or homebrew it came from, which is what a table
 * filters on when it rules something in or out.
 *
 * Nearly always: a handful of rules tags are written in brackets too, so those
 * are named rather than guessed at. Everything else in brackets is a source.
 */
const RULES_TAGS = /^(?:counter|stance|utility|package|blitz|tandem|totem|form)$/i;
const TAG_SUFFIX = /\s*(?:\(([^()]+)\)|\[([^\][]+)\])\s*$/;
/**
 * A suffix that is neither: the wiki disambiguates a page whose name is also
 * something else's by appending "(talent)", and that says nothing about the
 * talent at all.
 */
const NOT_A_TAG = /^talents?$/i;

/**
 * Strip a talent's trailing tags off its name, keeping both kinds.
 * "Elongated Step (stance) [3PP]" -> Elongated Step, tags [stance], sources [3PP].
 */
export function splitTalentName(raw) {
  let name = String(raw || '').trim();
  const tags = [];
  const sources = [];
  for (;;) {
    const m = name.match(TAG_SUFFIX);
    if (!m) break;
    const paren = m[1];
    const brack = m[2];
    const text = (paren ?? brack ?? '').trim();
    // A parenthesised tag is always a rule; a bracketed one is a rule only if
    // it is one of the few written that way, and a source otherwise.
    if (NOT_A_TAG.test(text)) { /* a page-title disambiguator, not a tag */ }
    else if (paren !== undefined || RULES_TAGS.test(text)) tags.unshift(text);
    else sources.unshift(text);
    name = name.slice(0, m.index).trim();
  }
  return { name, tags, sources };
}

/**
 * "Boxing Talents", "Counter Talents", "Legendary Talents" -- a group heading.
 * Tab-free and short on purpose: a class page's table header row ends
 * "...	Special	Combat Talents", and a heading is a line of its own.
 */
const GROUP_HEADING = /^([^	]{1,40}?)\s+Talents$/i;
/** Which side of the line a sphere sits on, from its breadcrumb. */
const SPHERE_KIND = (crumb) => (/spheres?\s+of\s+might/i.test(crumb) ? 'combat'
  : /spheres?\s+of\s+power/i.test(crumb) ? 'magic' : '');

/**
 * A whole sphere off the Spheres of Power / Spheres of Might wiki.
 *
 * The page's **table of contents is the parse**. It lists, in order and
 * exactly as they are spelt below, every heading the article has: the base
 * abilities, the tables, each `X Talents` group, and every talent under it.
 * Reading it first means the body needs no guessing at all about which short
 * line is a talent's name and which is the first line of a paragraph -- the
 * question that makes every other reader in this file as careful as it is.
 * The contents are chrome (`markWikidotChrome` marks them), so they are read
 * off the raw lines rather than the content ones.
 *
 * Like a maneuver and unlike everything else here, a sphere is not a block: it
 * is a shared table, so it comes back to be filed in the pack's sphere list.
 */
export function readSphere(lines, pre = new Set()) {
  const used = new Set(pre);
  const t = lines.map((l) => l.trim());
  lines.forEach((_, i) => used.add(i));

  const crumbAt = t.findIndex((l) => BREADCRUMB.test(l));
  const crumb = crumbAt >= 0 ? t[crumbAt] : '';
  // The title is the line above the breadcrumb, which the chrome pass keeps;
  // failing that, whatever the first `X Talents` heading is named for.
  let name = '';
  for (let k = crumbAt - 1; k >= 0 && !name; k--) if (t[k]) name = t[k];
  const firstGroup = t.findIndex((l, i) => !pre.has(i) && GROUP_HEADING.test(l));
  if (!name && firstGroup >= 0) name = t[firstGroup].match(GROUP_HEADING)[1];

  // The contents: from its own heading to the first sentence or blank.
  const tocAt = t.findIndex((l) => /^(?:Fold|Unfold|FoldUnfold)?\s*Table of Contents\b/i.test(l));
  const toc = [];
  if (tocAt >= 0) {
    for (let k = tocAt + 1; k < t.length && t[k] && !/[.!?]$/.test(t[k]); k++) toc.push(t[k]);
  }

  // Every heading the article will have, and which group each talent is in.
  const groupOf = new Map();
  const headings = [];
  let group = '';
  for (const entry of toc) {
    const g = entry.match(GROUP_HEADING);
    if (g) { group = entry; headings.push(entry); continue; }
    headings.push(entry);
    if (group) groupOf.set(entry, group);
  }

  // The article: everything below the contents, cut at each heading it named.
  const start = tocAt >= 0 ? tocAt + toc.length + 1 : Math.max(0, firstGroup);
  const wanted = new Set(headings);
  const lead = [];
  const sections = [];
  for (let k = start; k < t.length; k++) {
    const l = t[k];
    if (!l) { if (sections.length) sections[sections.length - 1].body.push(''); continue; }
    // The footer's own navigation repeats sphere names; stop at it.
    if (WIKIDOT_FOOTER.test(l) || pre.has(k)) continue;
    if (wanted.has(l)) { sections.push({ head: l, body: [] }); continue; }
    if (sections.length) sections[sections.length - 1].body.push(l);
    else lead.push(l);
  }

  const textOf = (s) => s.body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const abilities = [];
  const talents = [];
  for (const s of sections) {
    if (GROUP_HEADING.test(s.head)) continue;              // the heading itself carries nothing
    const body = textOf(s);
    if (!groupOf.has(s.head)) { abilities.push({ name: s.head, text: body }); continue; }
    const { name: tname, tags, sources } = splitTalentName(s.head);
    // Two lines a talent opens with that are about the talent rather than part
    // of it: where it was published, and what it asks of you first.
    // "Source: Spheres Apocrypha: Pugilists" says the same as its [Apoc] tag
    // but says which book, so it joins the sources rather than replacing them.
    let rest = body;
    const sm = rest.match(/^Sources?:\s*(.+?)(?:\n|$)/i);
    if (sm) { sources.push(sm[1].trim()); rest = rest.slice(sm[0].length).trim(); }
    const pm = rest.match(/^Prerequisites?:\s*(.+?)(?:\n|$)/i);
    if (pm) rest = rest.slice(pm[0].length).trim();
    talents.push({
      name: tname,
      group: groupOf.get(s.head),
      tags,
      sources,
      prerequisites: pm ? pm[1].trim() : '',
      text: rest,
    });
  }

  const description = lead.join('\n').trim();
  const kind = SPHERE_KIND(crumb);
  const tagged = talents.filter((x) => x.tags.length).length;
  const sourced = talents.filter((x) => x.sources.length).length;
  return {
    name,
    blocks: [],
    spheres: name ? [{
      name,
      kind,
      description,
      abilities,
      talents,
    }] : [],
    used,
    report: [name
      ? `Sphere ${name}${kind ? ` (${kind})` : ''}: ${abilities.length} base abilit${abilities.length === 1 ? 'y' : 'ies'}, `
        + `${talents.length} talent${talents.length === 1 ? '' : 's'} in `
        + `${new Set(talents.map((x) => x.group)).size} group(s)`
        + `${tagged ? `, ${tagged} tagged` : ''}${sourced ? `, ${sourced} from a named source` : ''}.`
      : 'A sphere page with no name — nothing read.'],
  };
}

/* ---------------- martial abilities ---------------- */

/**
 * The labels a martial ability's information box uses. `Information` is the
 * box's own heading, which the wiki chrome pass usually eats already.
 */
const MARTIAL_INFO = /^(?:Information|Discipline|Category|Descriptors?|Levels?|Prerequisites?|Initiation Action|Ranges?|Targets?|Area|Effect|Durations?|Saving Throws?|Save|Sources?)$/i;

/** "1 swift action", "1 full-round action" -- the action a maneuver is initiated with. */
const ACTION_WORDS = [
  [/full[\s-]?round/i, 'Full-round'], [/standard/i, 'Standard'], [/\bmove\b/i, 'Move'],
  [/swift/i, 'Swift'], [/immediate/i, 'Immediate'], [/\bfree\b/i, 'Free'],
];
const SAVE_ALIASES = {
  none: 'None', fort: 'Fortitude', fortitude: 'Fortitude',
  ref: 'Reflex', reflex: 'Reflex', will: 'Will',
};

/**
 * A maneuver or stance off a martial ability page.
 *
 * Alone among the readers here this does not make a block. A discipline is a
 * shared *table*, read where it stands rather than copied into a character
 * (see docs/extensions.md), so what comes back is the catalogue entry and the
 * name of the discipline it belongs under, and the editor files it there.
 *
 * The page is an information box that copies as a label on one line and its
 * value on the next, except for Range / Target / Duration, which copy as a
 * small tab-separated table. Then the rules text, which is everything after
 * the last label the box knows.
 *
 * Three of the box's lines have no cell on a maneuver's card -- its
 * descriptors, its prerequisites and where it was published -- so they are
 * left out and said to be left out, rather than being wedged into the
 * description where nothing can find them again.
 */
export function readManeuver(lines, pre = new Set()) {
  const used = new Set(pre);
  const all = [];
  lines.forEach((raw, i) => { used.add(i); if (!pre.has(i) && raw.trim()) all.push(raw.trim()); });

  // The page opens "Martial Ability" over the ability's name; failing that,
  // the name is whatever sits directly above the first label of the box.
  let at = all.findIndex((l) => /^Martial Abilit(?:y|ies)$/i.test(l));
  let name = at >= 0 ? (all[at + 1] || '') : '';
  if (name) at += 2;
  else {
    const first = all.findIndex((l) => MARTIAL_INFO.test(l));
    name = first > 0 ? all[first - 1] : '';
    at = Math.max(0, first);
  }

  const info = {};
  let i = at;
  for (; i < all.length; i++) {
    const l = all[i];
    if (l === name) continue;
    // "Range<tab>Target<tab>Duration" over its values.
    if (l.includes('\t')) {
      const heads = l.split('\t').map((s) => s.trim()).filter(Boolean);
      if (heads.length && heads.every((h) => MARTIAL_INFO.test(h))) {
        const vals = (all[i + 1] || '').split('\t').map((s) => s.trim());
        heads.forEach((h, k) => { info[lower(h)] = vals[k] || ''; });
        i++;
        continue;
      }
      break;
    }
    if (!MARTIAL_INFO.test(l)) break;      // the rules text starts here
    const next = all[i + 1] || '';
    if (MARTIAL_INFO.test(next) || next.includes('\t')) { info[lower(l)] = ''; continue; }
    info[lower(l)] = next;
    i++;
  }

  const text = all.slice(i).join('\n');
  const category = info.category || '';
  const kind = /stance/i.test(category) ? 'stance' : 'maneuver';
  const type = category.match(/\(([^)]+)\)/)?.[1]?.trim()
    || (kind === 'stance' ? 'Stance' : titleCase(category));
  const rawAction = info['initiation action'] || '';
  const rawSave = info['saving throw'] || info['saving throws'] || info.save || '';
  const entry = {
    level: Number(String(info.level ?? info.levels ?? '').match(/\d+/)?.[0]) || 0,
    kind,
    name,
    type,
    action: ACTION_WORDS.find(([re]) => re.test(rawAction))?.[1] || rawAction,
    range: info.range || info.ranges || '',
    target: info.target || info.targets || info.area || info.effect || '',
    duration: info.duration || info.durations || '',
    save: SAVE_ALIASES[lower(rawSave)] ?? rawSave,
    dc: '',
    text,
  };

  // What the box said that a card has nowhere to put.
  const dropped = [['Descriptors', info.descriptors || info.descriptor],
    ['Prerequisites', info.prerequisites || info.prerequisite],
    ['Sources', info.sources || info.source]]
    .filter(([, v]) => v && !/^none$/i.test(v.trim()))
    .map(([k]) => k);
  const discipline = info.discipline || '';
  const filled = ['type', 'action', 'range', 'target', 'duration', 'save']
    .filter((k) => entry[k]).length;

  return {
    name,
    blocks: [],
    maneuvers: name ? [{ discipline, entry }] : [],
    used,
    report: [name
      ? `${kind === 'stance' ? 'Stance' : 'Maneuver'} ${name}${discipline ? ` (${discipline}` : ' (no discipline named'}${entry.level ? `, level ${entry.level}` : ''}): `
        + `${filled} cell${filled === 1 ? '' : 's'}${text ? ' and its description' : ', no description'}.`
        + (dropped.length ? ` Its ${dropped.join(' and ')} line${dropped.length === 1 ? ' has' : 's have'} no cell on a card and ${dropped.length === 1 ? 'was' : 'were'} left out.` : '')
      : 'A martial ability box with no name — nothing read.'],
  };
}

/* ---------------- archetypes ---------------- */

const ARCH_INFO = /^(Classes Available|Options?|Systems?|Sources?|Requirements?|Prerequisites?)$/i;
/** "A legendary samurai must be 5th level or higher to select this technique." */
const MIN_LEVEL = /\bmust be (?:at least )?(\d{1,2})(?:st|nd|rd|th)? level(?: or higher)?\b/i;
/** "Ultimate Psionics, pgs. 37–40" -- where a menu came from, not one of its entries. */
const CITATION = /\bpgs?\.\s*\d/i;

/** "Legendary Samurai Iaijutsu Technique" under the legendary samurai is "Iaijutsu Technique". */
function stripClassPrefix(s, className) {
  const t = String(s || '').trim();
  const c = String(className || '').trim();
  if (!c || !t.toLowerCase().startsWith(c.toLowerCase())) return t;
  return t.slice(c.length).replace(/^[\s:–—-]+/, '').trim();
}

/**
 * A menu of options: one entry per "Name (Ex): text" line, under whatever
 * headings the page groups them by.
 *
 * A page carries at most two levels of heading over its entries -- the book
 * they came from over the kind they are ("The Secrets of Adventuring" over
 * "Rogue Talents"), or the class over the kind ("Legendary Samurai" over
 * "Slashes"). Which is which needs no knowledge of either: the heading with
 * another heading under it is the outer one, and the one sitting directly over
 * the entries is what they are. An outer heading that merely repeats the class
 * says nothing and is dropped; any other is where the entries came from.
 *
 * @returns {{options, info, used}}
 */
export function readOptionMenu(lines, { startAt = 0, pre = new Set(), className = '', name = '' } = {}) {
  const t = lines.map((l) => l.trim());
  const used = new Set();
  const entry = /^([A-Z][^:\n]{1,60}?)\s*(?:\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\))?\s*:\s+(\S.*)$/;
  const titled = /^([A-Z][^\n]{1,60}?)\s*\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\)\s*$/;
  const headingLike = (l) => !!l && words(l) <= 8 && /^[A-Z“"]/.test(l) && !/[.:;,!?]$/.test(l)
    && !l.includes('\t') && !CITATION.test(l) && !entry.test(l) && !titled.test(l);
  const nextText = (k) => { let j = k + 1; while (j < t.length && (!t[j] || pre.has(j))) j++; return t[j] || ''; };
  const options = [];
  const info = [];
  let section = '';
  let category = '';
  let cur = null;
  let cols = null;             // a table-laid menu's column names, once its header is seen
  let ended = t.length;        // where the menu stopped and the page's own tail began
  let inToc = false;
  const tocOuter = new Set();  // headings the contents list numbers "1", "2"…
  const tocInner = new Set();  // …and those it numbers "1.1", "1.2"
  const cites = [];
  /** A line the contents list already named as a heading, colon and all. */
  const named = (l) => tocInner.has(lower(l)) || tocOuter.has(lower(l));
  /**
   * File a heading. The contents list settles which is which; without one,
   * the heading with another heading under it is the outer of the two.
   */
  const takeHeading = (l, i) => {
    used.add(i);
    cur = null;
    const k = lower(l);
    if (tocInner.has(k)) category = l;
    else if (tocOuter.has(k)) { section = l; category = ''; }
    else if (headingLike(nextText(i))) { section = l; category = ''; }
    else category = l;
  };

  for (let i = startAt; i < t.length; i++) {
    const l = t[i];
    if (!l || pre.has(i)) continue;
    if (WIKI_CHROME.test(l) || CHROME_FOOTER.test(l)) { cur = null; continue; }
    if (/^(?:Related|Navigation|References?)$/i.test(l)) { used.add(i); cur = null; ended = i; break; }
    // The contents list, which is also where the page says which of its
    // headings sit inside which: "1 Ultimate Psionics" over "1.1 Insights".
    if (/^Contents$/i.test(l) && !cur) { used.add(i); inToc = true; continue; }
    const toc = inToc && l.match(/^(\d+(?:\.\d+)*)[\t ]+(\S.*)$/);
    if (toc) { used.add(i); (toc[1].includes('.') ? tocInner : tocOuter).add(lower(toc[2])); continue; }
    inToc = false;
    if (lower(l) === lower(className) && !cur) { used.add(i); continue; }
    // A line of citations is where the menu came from, not one of its entries.
    if (CITATION.test(l) && !cur) { used.add(i); cites.push(l); continue; }
    // A heading the contents list already named is a heading whatever it looks
    // like -- "Psionics Unleashed: Revised" reads as an entry otherwise.
    if (named(l)) { takeHeading(l, i); continue; }

    // Some pages lay the menu out as a table instead: a header naming the
    // columns, then one option per row.
    if (/^Name\t/i.test(l)) {
      used.add(i);
      cols = l.split('\t').map((c) => lower(c).trim());
      // a header that wrapped onto a second line carries on
      let j = i + 1;
      while (j < t.length && !t[j]) j++;
      if (j < t.length && t[j] && t[j].split('\t').every((c) => words(c) <= 3) && !t[j].includes(':')) {
        cols.push(...t[j].split('\t').map((c) => lower(c).trim()));
        used.add(j);
        i = j;
      }
      cur = null;
      continue;
    }
    if (cols && l.includes('\t')) {
      const cells = l.split('\t').map((c) => c.trim());
      const at = (h) => { const k = cols.findIndex((c) => c === h); return k >= 0 ? cells[k] : ''; };
      // the description is the column that says so, else the longest cell
      const desc = at('description')
        || cells.slice(1).reduce((best, c) => (c.length > best.length ? c : best), '');
      if (cells[0] && words(cells[0]) <= 10 && desc) {
        used.add(i);
        cur = {
          name: cells[0],
          type: null,
          category,
          source: at('source') || at('publication') || section,
          text: desc,
          minLevel: null,
        };
        options.push(cur);
        continue;
      }
    }

    let m = l.match(entry);
    if (m && words(m[1]) <= 8) {
      used.add(i);
      cur = {
        name: m[1].trim(),
        type: m[2] || null,
        category,
        source: section,
        text: m[3].trim(),
        minLevel: null,
      };
      options.push(cur);
      continue;
    }
    m = l.match(titled);
    if (m) {
      used.add(i);
      cur = { name: m[1].trim(), type: m[2], category, source: section, text: '', minLevel: null };
      options.push(cur);
      continue;
    }
    if (headingLike(l)) { takeHeading(l, i); continue; }
    // Anything else is prose: a running paragraph of the option above, or --
    // before the first one -- the menu's own words about how it is used.
    used.add(i);
    if (cur) cur.text += `\n\n${l}`;
    else info.push(l);
  }

  // The book an entry came from, where the outer heading names one; a heading
  // that only repeats the class or the page says nothing about where it is from.
  const says = (s) => s && lower(s) !== lower(className) && !lower(name).includes(lower(s));
  for (const o of options) {
    // The level an entry asks for: its own sentence, or the heading it sits
    // under where the page groups its entries by level ("7th Level").
    o.minLevel = Number(o.text.match(MIN_LEVEL)?.[1])
      || Number(o.category.match(/^(\d{1,2})(?:st|nd|rd|th) level$/i)?.[1]) || null;
    o.source = says(o.source) ? o.source : '';
    o.text = o.text.trim();
  }
  return { options, info: info.join('\n\n'), cites: cites.join(' '), used, ended };
}
const ACF_INTRO = /\bAlternate class features are small, modular archetypes\b/i;
const SECTION_INTRO = /^The following options? (?:alter|replace|modify|change)/i;

/**
 * An archetype page, as the wiki lays it out: a title, an information box
 * (Classes Available, Systems, Sources), a flavour paragraph, then the
 * features -- each "Name (Ex): text" or "Name: text" with its own "This
 * ability replaces X" / "alters Y" sentence -- and a Related list. One
 * `archetype` block: what each feature replaces and alters is read off its
 * text by the block normaliser.
 *
 * An "Alternate Class Features" page is the same shape with section
 * headings ("Challenge", then "The following options alter or replace…")
 * over independent options; each option there is its own single-feature
 * archetype, since a player takes them one at a time.
 */
export function readArchetype(lines, pre = new Set()) {
  const used = new Set(pre);
  const mark = (i) => { if (i >= 0 && i < lines.length) used.add(i); };
  const t = lines.map((l) => l.trim());

  // Title: the line above "Namespaces", else the line before "Information".
  let name = '';
  const nsAt = t.findIndex((l) => /^Namespaces/i.test(l));
  if (nsAt > 0) name = t[nsAt - 1];
  const infoAt = t.findIndex((l) => /^Information$/i.test(l));
  if (!name && infoAt > 0) { let j = infoAt - 1; while (j >= 0 && !t[j]) j--; name = t[j] || ''; }
  // A plain document: the first short line that is not a heading.
  const HEADING = /^(?:Description|Class Features|Cuts|Slashes|Techniques|Notes|Related|Contents)$/i;
  if (!name) name = t.find((l, k) => l && !pre.has(k) && words(l) <= 6 && /^[A-Z]/.test(l) && !/[.:;,]$/.test(l) && !HEADING.test(l) && !WIKI_CHROME.test(l)) || '';
  name = name || 'Archetype';

  // The information box.
  let className = '';
  let system = '';
  let optionName = '';
  const sources = [];
  let i = infoAt >= 0 ? infoAt + 1 : 0;
  let heading = null;
  for (; i < t.length; i++) {
    const l = t[i];
    if (!l) continue;
    if (pre.has(i)) continue;
    if (l === name && !heading) { mark(i); continue; }
    if (lower(l) === `${lower(name)} (class)` || /\barchetypes$/i.test(l) && words(l) <= 4) { mark(i); continue; }
    const h = l.match(ARCH_INFO);
    if (h) { heading = lower(h[1]).replace(/s$/, ''); mark(i); continue; }
    // The contents list ends the box: past it the page is the page.
    if (/^Contents$/i.test(l) || /^\d+(?:\.\d+)*[\t ]\S/.test(l)) break;
    if (words(l) >= 12 || /[.!?]$/.test(l)) break;
    if (!heading) { if (infoAt >= 0) { mark(i); continue; } break; }
    mark(i);
    if (heading === 'classes available' || heading === 'classes availabl') { if (!className) className = l.replace(/\s*\(class\)$/i, ''); }
    else if (heading === 'system') system = system ? `${system}; ${l}` : l;
    else if (heading === 'option') { if (optionName) sources.push(l); else optionName = l; }
    else if (heading === 'source') sources.push(l);
  }
  const bodyStart = i;

  // An option page: a menu a class feature picks from, on a page of its own.
  // Its info box says so outright -- "Option: Legendary Samurai Iaijutsu
  // Technique" -- which is what tells it from an archetype, whose box names
  // the same class and looks otherwise identical.
  if (optionName) {
    const menu = readOptionMenu(lines, { startAt: bodyStart, pre, className, name });
    for (const k of menu.used) mark(k);
    // Past the page's "Related" box is its own furniture -- the category list,
    // the navigation column -- which belongs to the wiki, not to the menu.
    let tail = 0;
    for (let k = menu.ended; k < lines.length; k++) { if (!used.has(k) && t[k]) tail++; mark(k); }
    const feature = stripClassPrefix(optionName, className) || optionName;
    const block = normalizeBlock({
      kind: 'options', name: name || optionName, class: className, feature,
      text: menu.info, source: [...sources, menu.cites].filter(Boolean).join('; '), options: menu.options,
    });
    const cats = [...new Set(menu.options.map((o) => o.category).filter(Boolean))];
    return {
      name: name || optionName,
      blocks: [block],
      used,
      report: [`Option menu ${block.name}: ${menu.options.length} option(s)`
        + `${cats.length > 1 ? ` in ${cats.length} categories (${cats.join(', ')})` : ''}`
        + `${className ? ` for ${className}'s ${feature}` : ''}.`
        + `${tail ? ` ${tail} line(s) of the page's own tail below it were set aside.` : ''}`],
    };
  }

  // The Alternate Class Features page: section headings over an intro line.
  const acf = t.some((l) => ACF_INTRO.test(l)) || /alternate class features/i.test(name);
  const sectionOf = new Array(t.length).fill('');
  if (acf) {
    let section = '';
    for (let k = bodyStart; k < t.length; k++) {
      if (pre.has(k)) continue;
      if (SECTION_INTRO.test(t[k])) {
        // the heading is the short line above
        let j = k - 1;
        while (j > bodyStart && !t[j]) j--;
        if (j > bodyStart && words(t[j]) <= 6 && !used.has(j)) { section = t[j]; mark(j); }
        mark(k);
      }
      sectionOf[k] = section;
      // the page's own intro and its table of contents
      if (ACF_INTRO.test(t[k]) || /^\d+(?:\.\d+)*\t\S/.test(t[k]) || /^Contents$/i.test(t[k]) || lower(t[k]) === lower(className)) mark(k);
    }
  }

  // Flavour: the paragraph(s) before the first feature -- or, in a plain
  // document, everything under a "Description" heading up to "Class Features".
  const flavour = [];
  const inline = /^([A-Z][^:\n]{1,60}?)\s*(?:\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\))?\s*:\s+(.{12,})$/;
  const titleRe = /^([A-Z][^\n]{1,60}?)\s*\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\)\s*$/;
  const descAt = t.findIndex((l, k) => k >= bodyStart && /^Description$/i.test(l));
  if (descAt !== -1) {
    mark(descAt);
    for (let k = descAt + 1; k < t.length; k++) {
      if (!t[k]) continue;
      if (/^Class Features$/i.test(t[k]) || inline.test(t[k]) || titleRe.test(t[k])) break;
      flavour.push(t[k]); mark(k);
    }
  } else {
    for (let k = bodyStart; k < t.length; k++) {
      if (!t[k] || pre.has(k) || used.has(k)) continue;
      if (lower(t[k]) === lower(name)) { mark(k); continue; }
      if (inline.test(t[k]) || titleRe.test(t[k]) || /^(?:Related|Notes|Class Features)$/i.test(t[k])) break;
      if (words(t[k]) > 12) { flavour.push(t[k]); mark(k); }
    }
  }
  t.forEach((l, k) => { if (k >= bodyStart && /^Class Features$/i.test(l)) mark(k); });

  const read = readFeatureProse(lines, { startAt: bodyStart, mark, pre: used, mode: 'archetype' }).filter((p) => !p.flavour && lower(p.name) !== lower(name));
  for (const p of read) for (let k = p.from; k <= p.to; k++) mark(k);
  // A menu of options ("Topological Iaijutsu Techniques" → Cuts / Slashes) belongs
  // to the feature it names, as its options; the information entries under it
  // (a "Mapped:" condition) as its notes. A menu naming no feature gets one.
  const prose = read.filter((p) => !p.optionOf && !p.infoOf);
  const minLevel = (t) => Number(String(t).match(/must be (?:at least |of )?(?:level )?(\d{1,2})(?:st|nd|rd|th)?(?: level)?(?: or higher)? to select/i)?.[1]) || null;
  for (const p of read) {
    if (!p.optionOf && !p.infoOf) continue;
    const section = p.optionOf || p.infoOf;
    let owner = prose.find((q) => featureKey(q.name) === featureKey(section));
    if (!owner) { owner = { name: section, type: null, text: '', title: true, source: '', level: null, from: p.from, to: p.to }; prose.push(owner); }
    if (p.optionOf) {
      owner.options ||= [];
      owner.options.push({ name: p.name, type: p.type, category: p.category || '', text: p.text, minLevel: minLevel(p.text) });
    } else {
      owner.optionsInfo = [owner.optionsInfo, `${p.name}: ${p.text}`].filter(Boolean).join('\n\n');
    }
  }
  // "Related" and everything under it is the site's cross-links
  const relAt = t.findIndex((l, k) => k >= bodyStart && /^Related$/i.test(l));
  if (relAt !== -1) for (let k = relAt; k < t.length; k++) if (t[k] && words(t[k]) <= 6) mark(k);
  // "Notes" holds errata about the page; a leftover for the player to judge
  const source = sources.join('; ');
  const blocks = [];
  const report = [];
  if (acf) {
    for (const p of prose) {
      const section = sectionOf[p.from] || '';
      const block = normalizeBlock({
        kind: 'archetype', name: p.name, class: className, source, single: true,
        text: section ? `Alternate class feature (${section}) for the ${className || 'class'}.` : `Alternate class feature for the ${className || 'class'}.`,
        features: [{ name: p.name, type: p.type, level: p.level, text: p.text }],
      });
      blocks.push(block);
    }
    report.push(`${prose.length} alternate class feature(s) for ${className || 'the class'}, each its own archetype block: ${prose.map((p) => p.name).join(', ')}.`);
    return { name: name || className, blocks, report, used };
  }
  const block = normalizeBlock({
    kind: 'archetype', name, class: className, source, text: [flavour.join('\n\n'), system && `System: ${system}`].filter(Boolean).join('\n\n'),
    features: prose.map((p) => ({ name: p.name, type: p.type, level: p.level, text: p.text, options: p.options || [], optionsInfo: p.optionsInfo || '' })),
  });
  blocks.push(block);
  const rep = new Set(block.features.flatMap((f) => f.replaces));
  const alt = new Set(block.features.flatMap((f) => f.alters));
  const menus = block.features.filter((x) => x.options.length);
  report.push(`Archetype ${name} for ${className || 'a class the text does not name — set it in the block form'}: ${block.features.length} feature(s)${menus.length ? ` (${menus.map((x) => `${x.name}: ${x.options.length} options`).join('; ')})` : ''}${rep.size ? `; replaces ${[...rep].join(', ')}` : ''}${alt.size ? `; alters ${[...alt].join(', ')}` : ''}${block.stacksWith.length ? `; combines with ${block.stacksWith.join(', ')}` : ''}.`);
  return { name, blocks, report, used };
}
