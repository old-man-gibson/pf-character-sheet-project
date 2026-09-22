/**
 * pdf-import.js -- a PDF, as an outline the paste reader can be fed.
 *
 * A group's own material is often a PDF -- a homebrew document, a campaign
 * handout, house rules laid out to look like a book -- and it is the worst
 * form to read: it has no headings, no paragraphs and no columns, only pieces of text
 * with a position, a size and a font. What it does have is *consistency* --
 * a layout sets every talent's name in one style and every section's in
 * another -- and that is enough to get back an outline: sections, the entries
 * under each, and each entry's text in reading order.
 *
 * It is not enough to say what an entry **is**. "Iron Grip (stance)" and
 * "Craft Wondrous Trinket (item creation)" are set identically; one is a
 * talent and one is a feat, and only the section they stand in says which --
 * in words no two documents share. So this stops at the outline, and the
 * extension manager asks the one question a person answers at a glance: what
 * is each section? From there the text goes to `parsePaste`, which stays the
 * only reader.
 *
 * Two halves, deliberately. `readPdf` touches pdf.js and the browser and does
 * nothing clever; `outlineOf` and `sectionText` are pure and run in Node, so
 * the part with judgement in it is the part with tests.
 *
 * Nothing leaves the page: the file is read here, by a library served with
 * the app (`app/vendor/pdfjs`), loaded only when somebody chooses a PDF.
 */

const PDFJS = new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/**
 * Every page's text items: `{ str, x, y, w, size, font }`, y measured *down*
 * from the top of the page so that reading order is ascending.
 */
export async function readPdf(data, { onProgress = null } = {}) {
  const pdfjs = await import(/* @vite-ignore */ PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const view = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: view.width,
      height: view.height,
      items: content.items.filter((it) => it.str && it.str.trim()).map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: view.height - it.transform[5],
        w: it.width,
        size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 0,
        font: it.fontName || '',
      })),
    });
    onProgress?.(n, doc.numPages);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

/* ---------------- lines ---------------- */

const round = (n, to = 1) => Math.round(n / to) * to;
const styleOf = (it) => `${it.font}@${round(it.size, 0.5)}`;

/**
 * A page's items as lines, each cut where a gutter's worth of space opens.
 *
 * Items on one baseline are one line until the gap between two of them is
 * wider than any space between words -- which is what the space between two
 * columns is, and what makes this work without knowing where the gutter is.
 */
function linesOf(page, book = new Map()) {
  const items = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.35));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  /*
   * Where the right-hand column begins: the commonest place, past the middle
   * of the page, for a piece of text to start after a gap. A gutter is often
   * no wider than two or three spaces of the heading type set beside it, so
   * width alone cannot tell it from a gap between words -- but words do not
   * all begin at one x, and a column does.
   */
  const starts = new Map();
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.items.forEach((it, i) => {
      const prev = row.items[i - 1];
      if (!prev || it.x < page.width * 0.4 || it.x > page.width * 0.7) return;
      if (it.x - (prev.x + prev.w) > it.size * 0.4) starts.set(round(it.x, 2), (starts.get(round(it.x, 2)) || 0) + 1);
    });
  }
  // A page says where its own right column starts when it has the evidence;
  // one that does not -- two headings on a row and little else -- is told by
  // the rest of the book, which was set on the same grid. `book` is filled in
  // by a first pass over every page and is empty during it.
  for (const [x, n] of starts) book.set(`${round(page.width, 1)}|${x}`, (book.get(`${round(page.width, 1)}|${x}`) || 0) + n);
  const best = (tally) => [...tally].sort((a, b) => b[1] - a[1])[0] ?? [Infinity, 0];
  let [rightStart, hits] = best(starts);
  if (hits < 4) {
    const mine = [...book].filter(([k]) => k.startsWith(`${round(page.width, 1)}|`)).map(([k, n]) => [Number(k.split('|')[1]), n]);
    [rightStart, hits] = best(mine);
  }
  const atGutter = (it) => hits >= 4 && Math.abs(it.x - rightStart) <= 3;

  const lines = [];
  for (const row of rows) {
    let cur = null;
    for (const it of row.items) {
      const gap = cur ? it.x - cur.x1 : 0;
      // Type of another size across a gap, past the middle of the page, is the
      // other column: a heading set beside the last line of a paragraph. Bold
      // or italic words inside a sentence are the same size as the sentence.
      const prev = cur?.parts[cur.parts.length - 1];
      const otherColumn = prev && gap > it.size * 0.25 && it.x > page.width * 0.4
        && Math.abs(it.size - prev.size) > 1.5;
      // A space between words is about a quarter of the type size and a
      // justified line stretches it to perhaps twice that; a gutter is rarely
      // under one and a half. One whole type size is the line between them --
      // at 1.8 a 19-point gutter beside 11-point text read as a word space,
      // and two columns came out as one sentence.
      if (cur && gap <= it.size && !otherColumn && !(atGutter(it) && gap > it.size * 0.3)) {
        cur.text += (gap > it.size * 0.18 && !cur.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        cur.x1 = it.x + it.w;
        cur.parts.push(it);
      } else {
        cur = { y: row.y, x0: it.x, x1: it.x + it.w, text: it.str, parts: [it] };
        lines.push(cur);
      }
    }
  }
  for (const l of lines) {
    l.text = l.text.replace(/\s+/g, ' ').trim();
    // The style a line is *in*: the one most of its characters are set in.
    const tally = new Map();
    for (const p of l.parts) tally.set(styleOf(p), (tally.get(styleOf(p)) || 0) + p.str.trim().length);
    const ranked = [...tally].sort((a, b) => b[1] - a[1]);
    l.style = ranked[0][0];
    l.size = Number(l.style.split('@')[1]);
    l.pure = ranked.length === 1 || ranked[0][1] >= l.text.replace(/\s/g, '').length * 0.9;
    // The style it *opens* in, for a run-in label: "Prerequisites: Boxing sphere."
    l.lead = styleOf(l.parts[0]);
  }
  return lines.filter((l) => l.text);
}

/** Left column down, then right; a line across both ends the columns above it. */
function inReadingOrder(lines, width) {
  if (lines.length < 8) return [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  /*
   * Where the right column starts: the *leftmost* margin, past the middle of
   * the page, that several lines share -- not the commonest. A column with a
   * picture let into its edge sets most of its lines further in, and taking
   * that inner margin for the column's own sent the lines above and below the
   * picture to the left column, where they were shuffled in among it by
   * height. And the page is two columns when a fair share of its lines start
   * anywhere past that margin, wherever exactly.
   */
  const tally = new Map();
  for (const l of lines) if (l.x0 > width * 0.45 && l.x0 < width * 0.75) tally.set(round(l.x0, 4), (tally.get(round(l.x0, 4)) || 0) + 1);
  const right = [...tally].filter(([, n]) => n >= 3).sort((a, b) => a[0] - b[0])[0]?.[0] ?? 0;
  const count = right ? lines.filter((l) => l.x0 >= right - 8).length : 0;
  if (count < lines.length * 0.2) return [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out = [];
  let left = [];
  let rightCol = [];
  const flush = () => { out.push(...left, ...rightCol); left = []; rightCol = []; };
  for (const l of [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    if (l.x0 >= right - 8) rightCol.push(l);
    else if (l.x1 > right + width * 0.12) { flush(); out.push(l); } else left.push(l);
  }
  flush();
  return out;
}

/* ---------------- the outline ---------------- */

/**
 * The book as sections of entries.
 *
 * Returns `{ title, sections: [{ heading, page, lead, entries: [{ heading,
 * page, text }] }] }`. `lead` is what a section says before its first entry
 * -- for a sphere, that is the sphere's own description and base abilities.
 */
export function outlineOf(pages, { title = '', debug = false } = {}) {
  // Twice: once to learn where the book's right column starts, once knowing it.
  const book = new Map();
  pages.forEach((p) => linesOf(p, book));
  const learned = new Map(book);
  const perPage = pages.map((p) => linesOf(p, new Map(learned)));

  // Furniture: the same words at the same place on most pages -- a running
  // header, a page number, a footer. None of it is an entry's text.
  const seen = new Map();
  perPage.forEach((lines) => {
    const once = new Set(lines.map((l) => `${round(l.x0, 6)}|${round(l.y, 6)}|${l.text.replace(/\d+/g, '#')}`));
    for (const k of once) seen.set(k, (seen.get(k) || 0) + 1);
  });
  const furniture = (l) => (seen.get(`${round(l.x0, 6)}|${round(l.y, 6)}|${l.text.replace(/\d+/g, '#')}`) || 0) >= Math.max(3, pages.length * 0.4);

  const flow = [];
  perPage.forEach((lines, pi) => {
    const kept = lines.filter((l) => !furniture(l));
    // A printed page number, when the page has one, is the one to cite.
    const printed = lines.find((l) => furniture(l) && /^\d{1,3}$/.test(l.text));
    const page = printed ? Number(printed.text) : pi + 1;
    for (const l of inReadingOrder(kept, pages[pi].width)) flow.push({ ...l, page, colWidth: pages[pi].width / 2 });
  });

  /*
   * The body is whatever most of the book is set in -- which may be more than
   * one style. A justified page is often set in two cuts of one face, sharing
   * the text between them at the same size, and calling
   * only the commoner one "body" makes a heading of every short line in the
   * other. So any style carrying a real share of the text is body.
   */
  const weight = new Map();
  let total = 0;
  for (const l of flow) { weight.set(l.style, (weight.get(l.style) || 0) + l.text.length); total += l.text.length; }
  const ranked = [...weight].sort((a, b) => b[1] - a[1]);
  const bodyStyles = new Set(ranked.filter(([, n], i) => i === 0 || n >= total * 0.12).map(([s]) => s));
  const body = ranked[0]?.[0] ?? '';
  const bodySize = Number(body.split('@')[1]) || 10;

  // A heading: a short line, all in one style that is not the body's, that
  // does not read as the end of a sentence.
  const open = (t) => (t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length;
  const isHeading = (l) => l.pure && !bodyStyles.has(l.style) && l.size >= bodySize * 0.95
    && l.text.length <= 80 && /^[A-Z0-9(]/.test(l.text) && !/^\d+$/.test(l.text)
    // Not the end of a sentence -- though a heading whose tags run on to the
    // next line does end in a comma: "Internal Tool (accessory, augment,".
    && (!/[.;:,]$/.test(l.text) || (/,$/.test(l.text) && open(l.text)));
  const headingStyles = new Map();
  for (const l of flow) if (isHeading(l)) headingStyles.set(l.style, (headingStyles.get(l.style) || 0) + 1);
  // The style most headings are in is the entries'. Larger ones are sections;
  // the rest are sub-headings inside an entry (one mode of a talent that has several).
  const entryStyle = [...headingStyles].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const entrySize = entryStyle ? Number(entryStyle.split('@')[1]) : Infinity;
  const tier = (l) => (!isHeading(l) ? null : l.style === entryStyle ? 'entry' : l.size > entrySize ? 'section' : 'sub');

  const sections = [];
  let section = { heading: title || 'Opening', page: 1, lead: [], entries: [] };
  let entry = null;
  let para = null;
  const target = () => (entry ? entry.body : section.lead);
  const endPara = () => { if (para) { target().push(para.text); para = null; } };
  let last = null;

  for (const l of flow) {
    /*
     * The tail of a heading whose tags ran on: "…(augment, drone," then
     * "gadget)". It is in the heading's style, it closes a bracket, and it
     * opens none -- which is what tells it from the *next* heading, because
     * a heading at the foot of one column has the next column's first heading
     * after it in reading order, and only later its own last word. So the
     * tail goes to whichever entry is still waiting for one, not simply to
     * the one before it.
     */
    if (l.pure && l.style === entryStyle && /^[^(]*\)/.test(l.text) && !/^[A-Z]/.test(l.text)) {
      const waiting = [...section.entries].reverse().find((e) => open(e.heading));
      if (waiting) { waiting.heading += ` ${l.text}`; last = l; continue; }
    }
    const t = tier(l);
    // A heading that wraps without a bracket to say so -- "Superior Mechanical
    // Ranged" over "Weaponry" -- is two lines in one style, one directly under
    // the other at the same margin. Two headings that merely share a row in
    // different columns are not that.
    const under = t && last && tier(last) === t && last.style === l.style && last.page === l.page
      && Math.abs(l.x0 - last.x0) <= 3 && l.y > last.y && l.y - last.y < l.size * 1.6;
    if (under && t === 'entry' && entry && !entry.body.length) { entry.heading += ` ${l.text}`; last = l; continue; }
    if (under && t === 'section' && !section.lead.length && !section.entries.length) { section.heading += ` ${l.text}`; last = l; continue; }
    if (t === 'section') {
      endPara();
      const empty = !section.lead.length && !section.entries.length;
      if (!empty) sections.push(section);
      /*
       * A section heading with nothing under it yet is a banner over the real
       * one ("Section 2", "Class Options", then "Duskblade") and is let go
       * -- unless what follows is its own bracketed subtitle: "Duskblade"
       * over "(Magus Archetype)" is one heading in two sizes, and the reader
       * wants both halves of it.
       */
      const subtitle = empty && sections.length && l.text.startsWith('(');
      section = { heading: subtitle ? `${section.heading} ${l.text}` : l.text, page: l.page, lead: [], entries: [] };
      entry = null;
    } else if (t === 'entry') {
      endPara();
      entry = { heading: l.text, page: l.page, body: [] };
      section.entries.push(entry);
    } else if (t === 'sub') {
      endPara();
      target().push(`**${l.text}**`);
    } else {
      // Body text. A new paragraph after a gap, or after a line that stopped
      // short of the column's edge at the end of a sentence.
      const gap = last && last.page === l.page ? l.y - last.y : 0;
      const shortEnd = para && /[.:!?)]$/.test(para.text) && para.lastWidth < l.colWidth * 0.78;
      if (para && (gap > l.size * 1.75 || gap < 0 || shortEnd)) endPara();
      // A run-in label in a heading style -- "Prerequisites:" -- opens a paragraph.
      if (para && !bodyStyles.has(l.lead) && /^[A-Z][A-Za-z ]{2,24}:/.test(l.text)) endPara();
      if (!para) para = { text: l.text, lastWidth: l.x1 - l.x0 };
      else {
        para.text = /[a-z]-$/.test(para.text) && /^[a-z]/.test(l.text) ? para.text.slice(0, -1) + l.text : `${para.text} ${l.text}`;
        para.lastWidth = l.x1 - l.x0;
      }
    }
    last = l;
  }
  endPara();
  if (section.lead.length || section.entries.length) sections.push(section);

  return {
    title,
    // For looking at a book the outline gets wrong: every line, and what it was taken for.
    ...(debug ? { flow: flow.map((l) => ({ page: l.page, x: Math.round(l.x0), y: Math.round(l.y), style: l.style, pure: l.pure, tier: tier(l), text: l.text.slice(0, 70) })) } : {}),
    sections: sections.map((s) => ({
      heading: s.heading,
      page: s.page,
      lead: s.lead.join('\n\n'),
      entries: s.entries.map((e) => ({ heading: e.heading, page: e.page, text: e.body.join('\n\n') })),
    })),
  };
}

/* ---------------- a section, as text the reader takes ---------------- */

/** What a section can be told to be. `text` is for a class, an archetype or a race: the page reader's ground. */
export const SECTION_KINDS = [
  ['skip', 'Leave out'],
  ['talents', 'Sphere talents'],
  ['sphere', 'A sphere’s own page (base abilities)'],
  ['feats', 'Feats'],
  ['text', 'Class, archetype or race'],
  ['options', 'A class feature’s menu (what a column picks from)'],
  ['reference', 'Reference entries'],
];

/** A first guess at a section, from its heading alone. Only ever a guess: the panel shows it to be changed. */
export function guessKind(section) {
  const h = section.heading.toLowerCase();
  if (/\btalents?\b/.test(h) && section.entries.length) return 'talents';
  if (/\bsphere$/.test(h)) return 'sphere';
  if (/^feats?\b|\bfeats$/.test(h) && section.entries.length) return 'feats';
  if (/archetype|class options?|^classes$|races?$/.test(h)) return 'text';
  return 'skip';
}

/** "Boxing Talents" and "Boxing Sphere" are both about Boxing; "Legendary Talents" says nothing, and takes the last one named. */
export function guessSphere(section, previous = '') {
  const m = section.heading.match(/^(.*?)\s+(?:sphere|(?:basic |advanced |legendary )?talents)$/i);
  const name = m ? m[1].replace(/^(?:basic|advanced|legendary)\s*/i, '').trim() : '';
  return name || previous;
}

const fieldLine = (k, v) => (String(v ?? '').trim() ? `* **${k}:** ${String(v).replace(/\s+/g, ' ').trim()}` : '');

/** An entry's opening `Prerequisites: …` paragraph, lifted out as the field it is. */
function liftPrerequisites(text) {
  const m = String(text).match(/^Prerequisites?:\s*([^\n]+)(?:\n\n|$)/);
  return m ? { prerequisites: m[1].replace(/\.$/, ''), text: text.slice(m[0].length).trim() } : { prerequisites: '', text };
}

/**
 * One section as a document for `parsePaste`, given what it was said to be.
 *
 * `spheres` carries the base-ability sections already seen, by sphere name,
 * so that a sphere's talents and its own page -- two sections in the book --
 * leave as the one document a sphere is.
 */
export function sectionText(section, { kind, sphere = '', entryKind = '', book = '' }, spheres = new Map()) {
  const source = (page) => fieldLine('Source', [book, page ? `p. ${page}` : ''].filter(Boolean).join(' '));
  if (kind === 'skip') return '';
  if (kind === 'text') {
    // The page reader wants a page: headings on their own lines, text beneath.
    // "Duskblade (Magus Archetype)" is a name and a line about it, not a name.
    const titled = section.heading.match(/^(.*?)\s*\(([^)]*\b(?:archetype|class|race)[^)]*)\)$/i);
    const head = titled ? `${titled[1]}\n${titled[2]}` : section.heading;
    return [head, section.lead, ...section.entries.flatMap((e) => [e.heading, e.text])].filter(Boolean).join('\n\n');
  }
  if (kind === 'sphere') {
    // Kept for the talents section to open with; it is not a document alone.
    // A base ability is headed either the way an entry is or, more often, the
    // way a sub-heading is -- which the outline leaves in the lead as a bold
    // paragraph of its own. Both become the `*Name:* text` the reader looks for.
    const out = [];
    for (const para of String(section.lead).split(/\n{2,}/)) {
      const head = para.match(/^\*\*([^*]{2,60})\*\*$/);
      if (head) out.push(`*${head[1].replace(/:/g, '')}:*`);
      else if (out.length && /^\*[^*]+:\*$/.test(out[out.length - 1])) out[out.length - 1] += ` ${para}`;
      else out.push(para);
    }
    const abilities = section.entries.map((e) => `*${e.heading.replace(/[*:]/g, '')}:* ${e.text}`);
    spheres.set(sphere.toLowerCase(), [...out, ...abilities].filter(Boolean).join('\n\n'));
    return '';
  }
  const entries = section.entries.map((e) => {
    const { prerequisites, text } = liftPrerequisites(e.text);
    const type = kind === 'feats' ? (e.heading.match(/\(([^)]+)\)\s*$/)?.[1] || 'Feat') : '';
    const heading = kind === 'feats' ? e.heading.replace(/\s*\([^)]+\)\s*$/, '') : e.heading;
    return [`#### ${heading}`,
      // A book about one sphere heads its list plain "Talents"; beside another
      // document's "Boxing Talents" in the same sphere that is no group at all.
      kind === 'talents' ? fieldLine('Section', /^(?:basic |advanced )?talents$/i.test(section.heading) && sphere ? `${sphere} ${section.heading}` : section.heading) : '',
      kind === 'feats' ? fieldLine('Feat type', type.replace(/\b\w/g, (c) => c.toUpperCase())) : '',
      kind === 'reference' ? fieldLine('Entry kind', entryKind || section.heading.toLowerCase()) : '',
      fieldLine('Prerequisites', prerequisites), source(e.page), '', text].filter((x, i) => x !== '' || i === 6).join('\n');
  });
  if (!entries.length) return '';
  if (kind === 'talents') {
    const intro = spheres.get(sphere.toLowerCase()) || '';
    const quoted = intro ? `${intro.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n` : '';
    return `# ${sphere || 'Sphere'}\n\n${quoted}## Sphere Talents\n\n${entries.join('\n\n')}\n`;
  }
  return `# ${section.heading}\n\n${entries.join('\n\n')}\n`;
}

/* ---------------- the whole book ---------------- */

/**
 * One section as the menu a class feature picks from: an `options` block.
 *
 * A list of things a class takes one of at a time -- each entry a name and
 * what it does -- is set in a book exactly as a list of talents is, so only
 * being told makes it one. The class and the feature are what a feature
 * column is matched on, which is how the menu finds its column unasked.
 *
 * Built directly rather than written out for a reader: there is no page
 * shape to recognise here, only entries.
 */
export function sectionOptions(section, { className = '', feature = '', book = '' } = {}) {
  const cls = String(className).trim();
  const feat = String(feature).trim() || section.heading;
  const options = section.entries.map((e) => {
    const typed = e.heading.match(/^(.*?)\s*\((Ex|Su|Sp)\)\s*$/i);
    // "Level 2; Burn 1" in an entry's opening lines is what a player chooses
    // on, so it rides beside the name in the list.
    const opening = String(e.text).split(/\n{2,}/).slice(0, 2).join(' ');
    const facts = [...opening.matchAll(/\b(Level|Burn)\s+(\d+|[-–—])/g)].map((m) => `${m[1]} ${m[2]}`);
    return {
      name: (typed ? typed[1] : e.heading).trim(),
      type: typed ? typed[2] : '',
      category: [...new Set(facts)].join(', '),
      text: e.text,
      source: [book, e.page ? `p. ${e.page}` : ''].filter(Boolean).join(' '),
    };
  }).filter((o) => o.name);
  if (!options.length) return null;
  return {
    kind: 'options',
    name: [cls, feat].filter(Boolean).join(' '),
    class: cls,
    feature: feat,
    text: section.lead,
    source: [book, section.page ? `p. ${section.page}` : ''].filter(Boolean).join(' '),
    options,
  };
}

/** A first guess for every section, in order. "Legendary Talents" names no sphere, and takes the one whose page came before it. */
export function guessTags(outline) {
  let sphere = '';
  return outline.sections.map((sec) => {
    const kind = guessKind(sec);
    if (kind === 'sphere') sphere = guessSphere(sec, sphere);
    return { kind, sphere: kind === 'talents' || kind === 'sphere' ? guessSphere(sec, '') || sphere : '', entryKind: '', className: '', feature: '' };
  });
}

/**
 * The chosen sections, each through the reader it suits, as one result.
 *
 * A class or an archetype is a *page* and goes to `parsePaste`. Talents, feats
 * and reference entries are written out as the scraper's own document and go
 * straight to `readStructured`: whoever calls this knows what it made, and the
 * guess `parsePaste` makes first wants three field lines, which a section
 * holding a single talent does not have.
 *
 * The readers are handed in rather than imported, so that this module stays
 * about PDFs and the extension manager and the command line tool both bring
 * the one reader there is.
 */
export function readSections(outline, tags, { book = '', parsePaste, readStructured }) {
  const lower = (s) => String(s ?? '').trim().toLowerCase();
  const merged = { blocks: [], maneuvers: [], spheres: [], feats: [], spells: [], powers: [], catalogue: [], report: [], leftovers: [] };
  const intros = new Map();
  // A sphere's own page is only an opening for its talents, so those are
  // gathered first, wherever in the book they stand.
  outline.sections.forEach((sec, i) => { if (tags[i]?.kind === 'sphere') sectionText(sec, { ...tags[i], book }, intros); });
  outline.sections.forEach((sec, i) => {
    const t = tags[i];
    if (!t || t.kind === 'skip' || t.kind === 'sphere') return;
    if (t.kind === 'options') {
      const block = sectionOptions(sec, { ...t, book });
      if (block) {
        merged.blocks.push(block);
        merged.report.push(`Option menu ${block.name}: ${block.options.length} option(s)`
          + `${block.class ? ` for ${block.class}'s ${block.feature}` : ''}.`);
      }
      return;
    }
    const text = sectionText(sec, { ...t, book }, intros);
    if (!text) return;
    const r = t.kind === 'text' ? parsePaste(text) : readStructured(text);
    for (const key of ['blocks', 'maneuvers', 'feats', 'spells', 'powers', 'catalogue', 'report', 'leftovers']) merged[key].push(...(r[key] || []));
    // Two sections of one sphere -- its talents and its legendary talents --
    // are one sphere.
    for (const sp of r.spheres || []) {
      const had = merged.spheres.find((x) => lower(x.name) === lower(sp.name));
      if (!had) merged.spheres.push(sp);
      else {
        had.talents.push(...sp.talents);
        if (!had.abilities.length) had.abilities = sp.abilities;
        if (!had.description) had.description = sp.description;
      }
    }
  });
  // A base-ability page nobody gave talents to still has something to say.
  for (const [name, intro] of intros) {
    if (merged.spheres.some((x) => lower(x.name) === name)) continue;
    const quoted = intro.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    const r = readStructured(`# ${name.replace(/\b\w/g, (c) => c.toUpperCase())}\n\n${quoted}\n\n## Sphere Talents\n`);
    merged.spheres.push(...(r.spheres || []));
  }
  return merged;
}
