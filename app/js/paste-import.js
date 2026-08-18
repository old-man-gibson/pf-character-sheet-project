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

import { normalizeBlock } from './extensions.js';

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
      if (k < t.length && /^(?:Classes|Veils|Races|Feats|Spells|Archetypes|Prestige Classes|Talents|Powers|Traits)$/i.test(t[k])) { used[k] = true; k++; }
      if (k < t.length && j >= 0 && t[k] === t[i - 1]) used[k] = true;
    }
    if (/^Navigation$/i.test(l) && /^Main page$/i.test(t[i + 1] || '')) {
      // the navigation column and footer run to the end of the page's copy
      let k = i;
      while (k < t.length && !(k > i + 3 && k + 1 < t.length && isBlank(lines[k]) && isBlank(lines[k + 1]))) { used[k] = true; k++; }
    }
  });
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
  const lines = clean(text).split(/\r?\n/);
  const used = new Array(lines.length).fill(false);
  // A wiki's chrome is marked first and stays transparent from here on: the
  // readers skip it, and it is neither a segment boundary nor a leftover.
  markWikiChrome(lines, used);
  const segments = findSegments(lines, used);
  const blocks = [];
  const report = [];
  const nearOf = new Array(lines.length).fill(null);

  for (const seg of segments) {
    const slice = lines.slice(seg.start, seg.end);
    const pre = new Set();
    for (let i = seg.start; i < seg.end; i++) if (used[i]) pre.add(i - seg.start);
    const reader = { class: readClass, race: readRace, veil: readVeil }[seg.kind];
    const out = reader(slice, pre);
    for (const i of out.used) used[seg.start + i] = true;
    for (let i = seg.start; i < seg.end; i++) nearOf[i] = { kind: seg.kind, name: out.name };
    blocks.push(...out.blocks);
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
    report.push('Nothing here looked like a class, a race or a veil. Tag the text below, or keep it as a note.');
  }
  return { blocks: blocks.filter(Boolean), report, leftovers };
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
export function findSegments(lines, pre = []) {
  const anchors = [];
  const nextText = (i) => { let j = i + 1; while (j < lines.length && (!lines[j].trim() || pre[j])) j++; return (lines[j] || '').trim(); };
  lines.forEach((line, i) => {
    if (pre[i]) return;
    const t = line.trim();
    if (/^Hit Di(?:e|ce):\s*d?\d+/i.test(t) || (/^Hit Di(?:e|ce)$/i.test(t) && /^d\d+/i.test(nextText(i)))) {
      // one class has one Hit Die; the wiki's info box and its "Hit Die: d10" line are the same class
      if (!anchors.some((a) => a.kind === 'class' && i - a.at < 60 && !lines.slice(a.at, i).some((l) => isTableRow(l)))) anchors.push({ kind: 'class', at: i });
    } else if (/^Standard Racial Traits$/i.test(t) || /^Ability Score Modifiers?:/i.test(t)) {
      if (!anchors.some((a) => a.kind === 'race' && i - a.at < 40)) anchors.push({ kind: 'race', at: i });
    } else if (/^Chakra Slots?:?$/i.test(t)) anchors.push({ kind: 'veil', at: i });
  });
  const segments = [];
  let floor = 0;
  anchors.forEach((a, n) => {
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

const TAIL_LINE = /^(?:PFS Legal )?[A-Z][\w' -]+ \([^)]*pg\.\s*\d+[^)]*\):|^Favored Class (?:Options|Bonuses)$|^Alternate Capstones$|^Racial Subtypes$|^Archetypes$|^Related$|^FAQ$|^Contents$/;
const isTableRow = (line) => /^\d{1,2}(?:st|nd|rd|th)\t/.test(line) || /^\d{1,2}(?:st|nd|rd|th)\s+\+\d+/.test(line.trim());
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
    if (anchor.kind === 'veil') {
      if (words(t) <= 5 && /^[A-Z]/.test(t) && !/[.:]$/.test(t)) start = i;
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
const CLASS_HEADINGS = /^(?:Class Features|Class Skills|Ex-\w+|Alternate Capstones|Favored Class (?:Options|Bonuses)|Archetypes|Related|Contents|Table: .*|Maneuvers|FAQ|Weapon and Armor Proficienc(?:y|ies))$/i;
const FCB_HEADING = /^Favored Class (?:Options|Bonuses)$/i;
/** Untyped "Name: text" lines that are features in their own right wherever they sit. */
const KNOWN_UNTYPED = /^(?:weapon and armor proficienc(?:y|ies)|weapon proficienc(?:y|ies)|armor proficienc(?:y|ies)|maneuvers|maneuvers readied|stances known|bonus feats?|spells|spellcasting|cantrips|orisons|talents|deeds)$/i;
/** A section's own introduction, not content: "The following are the class features of the warlord." */
const BOILERPLATE = /^(?:All of t|T)he following (?:are|is) (?:the )?(?:class features|favored class (?:options|bonuses)|alternate racial traits)/i;

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
  let current = null;
  for (let i = at + 1; i < trimmed.length; i++) {
    const t = trimmed[i];
    if (!t) { if (!trimmed[i + 1] && current) break; continue; }      // a double blank ends the table
    if (pre.has(i) || WIKI_CHROME.test(t) || /^Navigation$/.test(t)) break;
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
    if (current && !current.flavour && words(t) > 12) current.flavour = t;
  }
  return { entries: entries.map((e) => (e.flavour ? `${e.name}: ${e.flavour}` : e.name)), used };
}

/** "Trap Sense +1", "trap sense", "Trap Sense (Ex)" and "Kiai Arts" / "kiai art" are one feature. */
export const featureKey = (s) => lower(s)
  .replace(/\((?:ex|su|sp)(?: or (?:ex|su|sp))?\)/g, '')
  .replace(/\s*[+\-–]\s*\d+(?:\/[+\-–—]|\/-)?\s*$/g, '')
  .replace(/\s+\d+\/[-–—]$/, '')
  .replace(/\s*\([^)]*\)\s*$/, '')                           // "gambit (2)", "tactical presence (rallying)"
  .replace(/\s+\d+\/day$/, '')
  .replace(/[^a-z0-9 ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/(\w{3,})s$/, '$1');                              // plural-insensitive on the last word

const isNoiseFeature = (name) => /^(?:source|note|editor'?s note|see|table|q|a)\b/i.test(name);

function titleCase(s) {
  return String(s).trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    if (/^Level\b/i.test(t) && /Base Attack|BAB|Special|Fort/i.test(t)) { headerAt = i; break; }
    if (/^Level$/i.test(t) && /Base Attack|BAB/i.test(`${lines[i + 1] || ''} ${lines[i + 2] || ''}`)) { headerAt = i; break; }
  }
  if (headerAt >= 0) {
    const t = lines[headerAt];
    used.add(headerAt);
    if (t.includes('\t')) headers = t.split('\t').map((h) => h.trim());
    else if (/^Level$/i.test(t.trim())) {
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
  const std = ['level', 'base attack bonus', 'fort save', 'ref save', 'will save', 'special'];
  const hdr = (headers || ['Level', 'Base Attack Bonus', 'Fort Save', 'Ref Save', 'Will Save', 'Special']).map((h) => h.trim());
  const idx = {
    level: hdr.findIndex((h) => /^level$/i.test(h)),
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
export function readFeatureProse(lines, { skipLabels = new Set(), startAt = 0, tableKeys = new Set(), mark = () => {}, pre = new Set() } = {}) {
  const out = [];
  const inline = /^([A-Z][^:\n]{1,60}?)\s*(?:\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\))?\s*:\s+(.{12,})$/;
  const titleRe = /^([A-Z][^:\n]{1,60}?)\s*\(((?:Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?)\)\s*$/;
  const levelOf = (t) => Number(String(t).match(/(?:At|Starting at|At the|Beginning at)\s+(\d{1,2})(?:st|nd|rd|th) level/i)?.[1]) || null;
  const type1 = (t) => (t ? t.split(' ')[0] : null);
  let cur = null;          // the feature being built
  let afterHeading = false; // a heading's own intro paragraph is not a feature's
  let inTail = false;      // past Favored Class / Archetypes: nothing here is a feature

  const start = (name, type, text, i, extra = {}) => {
    cur = { name: name.trim(), type: type1(type), text: text.trim(), title: false, source: '', level: levelOf(text), from: i, to: i, ...extra };
    out.push(cur);
    afterHeading = false;
  };
  const append = (t, i, sep = '\n\n') => { if (!cur) return false; cur.text += (cur.text ? sep : '') + t; cur.to = i; return true; };

  for (let i = Math.max(0, startAt); i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || pre.has(i)) continue;
    if (WIKI_CHROME.test(t)) continue;
    if (FCB_HEADING.test(t) || /^Archetypes$/i.test(t) || /^Navigation$/.test(t)) { inTail = true; cur = null; continue; }
    if (inTail) continue;
    if (TAIL_LINE.test(t) || CLASS_HEADINGS.test(t)) { mark(i); cur = null; afterHeading = true; continue; }
    if (afterHeading && !cur && /^Source\b/.test(t)) { mark(i); continue; }      // a section's own source line
    if (BOILERPLATE.test(t)) { mark(i); continue; }

    let m = t.match(titleRe);
    if (m) {
      // gather: an optional Source line, then paragraphs
      let source = '';
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && /^Source\b/.test(lines[j].trim())) { source = lines[j].trim().replace(/^Source:?\s*/, ''); }
      start(m[1], m[2], '', i, { title: true, source });
      if (source) { cur.to = j; i = j; }
      continue;
    }
    m = t.match(inline);
    if (m && words(m[1]) <= 7 && !skipLabels.has(lower(m[1])) && !/^(?:PFS Legal|Q|A|See)$/.test(m[1])) {
      const key = featureKey(m[1]);
      const typed = !!m[2];
      if (typed || tableKeys.has(key) || KNOWN_UNTYPED.test(m[1]) || !cur) { start(m[1], m[2], m[3], i); continue; }
      // untyped, not on the table, under a feature: a sub-entry of it
      append(t, i);
      continue;
    }
    if (/^See:\s/i.test(t)) { append(t, i, '\n'); continue; }
    if (afterHeading && !cur) { if (words(t) > 12) mark(i); continue; }   // a heading's intro paragraph
    if (!cur) continue;
    // a sidebar heading over a paragraph, a list line, or a continuation paragraph
    const nextLong = words(lines[i + 1] || '') > 12;
    if (words(t) <= 8 && /^[A-Z]/.test(t) && !/[.:;,]$/.test(t) && nextLong) { append(t, i); continue; }
    append(t, i, /^[-–•]|^\d+\.\s|^[A-Z][^.]{0,60}$/.test(t) ? '\n' : '\n\n');
    if (cur.title && cur.level === null) cur.level = levelOf(t);
  }
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
    if (/^(Archetypes|Related|Racial Subtypes)$/i.test(t)) break;
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
