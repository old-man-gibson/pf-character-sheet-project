/**
 * ui/talents.js -- the sphere-talent cell.
 *
 * One cell, used by every sphere tab there is: a prose field holding
 * whatever the player wrote, and -- when a pack's sphere catalogue knows the
 * name -- a mark carrying what it does. It lived in `panels/combat.js` while
 * Spheres of Power and Might were the only two systems that wanted it; the
 * skill spheres want exactly the same cell, so it moved here rather than
 * being copied or reached for across panels.
 */
import { esc } from './html.js';
import { prose } from './prose.js';
import { hasTokens } from '../inline.js';
import {
  basePickSphere, isBasePickOf, sphereBasePick, sphereCatalogue, sphereTalent, talentPackage,
} from '../model.js';

/**
 * The button that fills every blank note the catalogue can answer, on one
 * side of the sheet.
 *
 * A note is filled as its talent is typed, so a sheet written before its packs
 * were added has the marks and none of the text. The button is there only
 * while that is true -- it counts what it would fill, and is gone once there
 * is nothing left, so it is never a control that does nothing. What it fills
 * is what typing would have: empty notes only, and never over a word the
 * player wrote.
 */
export function fillNotesButton(model, sideKey) {
  const n = model.blankTalentNotes(sideKey);
  if (!n) return '';
  return `<button data-action="fill-talent-notes" data-side="${esc(sideKey)}"
    title="Copy each talent's text from your packs into its empty Notes cell. Notes you have written are left alone."
    >✦ Fill ${n} blank note${n === 1 ? '' : 's'} from packs</button>`;
}

/**
 * What each colour of ✦ means, under the talent tables.
 *
 * The mark is a speck in the corner of a cell and its colour is the only
 * thing it says without being hovered, so the colours need saying once where
 * they are used. There only while a pack has given the sheet a sphere
 * catalogue, because without one no cell has a mark to explain.
 */
export function talentLegend() {
  if (!sphereCatalogue().spheres.length) return '';
  const item = (cls, text) => `<span class="tlegend-item"><i class="tmark ${cls}">✦</i> ${text}</span>`;
  return `<p class="tlegend" aria-label="What the ✦ marks mean">
    ${item('base', 'a base sphere — shows what taking the sphere grants, or just the ability named in brackets')}
    ${item('', 'a talent — shows its rules')}
    ${item('pkg', 'a talent that grants a package you name in brackets, like Expanded Geomancing (Fire) — shows that package’s rules')}
    ${item('third', 'a talent marked third-party, like [3PP]')}
    <span class="tlegend-item tlegend-hint">Hover a ✦ to read it.</span>
  </p>`;
}

/** Past this a note is a talent's rules text rather than a remark, and starts folded. */
const LONG_NOTE = 160;

/**
 * The box a note is written in -- with its tables drawn, while it is only
 * being read.
 *
 * A text box has no tables in it, so a note filled from a pack showed a
 * talent's table as rows of tabs. Prose fields already have the answer for
 * formulas: a rendered view stands in the box's place until it is clicked,
 * and the box comes back to be typed in. A note with a table in it borrows
 * that, with `richText` as the rendering; one without is the plain box it
 * always was, and one with formulas in it keeps the formula view, which has
 * to win because it is the one that computes.
 */
function noteField(model, binding, text) {
  if (hasTokens(text)) return prose(model, binding, text, 1, 'grow');
  const rich = richText(text);
  if (!rich.includes('<table')) return prose(model, binding, text, 1, 'grow');
  return `<span class="prose has-tokens grow" title="Click to edit">
      <textarea ${binding} data-kind="text" rows="1" spellcheck="false">${esc(text)}</textarea>
      <span class="prose-view rich">${rich}</span>
    </span>`;
}

/**
 * A talent's Notes cell, which folds.
 *
 * A note used to be a remark -- "taken at 5th", "via the feat" -- and one line
 * was all it needed. Filled from a pack it is the talent's whole rules text,
 * and a level table of twenty of those is a page per class. So a note with
 * something to fold gets the caret the feat notes have: open, it is the prose
 * box it always was; shut, it is the first line of what the box says, with
 * the whole of it on the tooltip, and clicking either opens it.
 *
 * Which way it starts depends on what is in it. A short note opens, because
 * hiding half a line saves nothing; a long one starts shut, so that filling
 * forty notes at once leaves the table the height it was. After that the
 * choice is the player's and is kept per row -- keyed on the row's path for
 * the reason `catFoldKey` gives.
 */
export function talentNote(model, binding, value, path, name = '') {
  const text = String(value ?? '');
  const field = noteField(model, binding, text);
  const foldable = text.length > 60 || text.includes('\n');
  if (!foldable) return field;
  const key = `tnote:${path}`;
  const said = model.data?.uiPrefs?.collapsed?.[key];
  const shut = said === undefined ? text.length > LONG_NOTE : !!said;
  const caret = `<button class="disclose catfold" data-collapse="${esc(key)}" data-collapse-to="${!shut}"
      aria-expanded="${!shut}" title="${shut ? 'Show the whole note' : 'Fold the note to one line'}"
      >${shut ? '▸' : '▾'}</button>`;
  if (!shut) {
    return `<div class="notecell"><div class="noteline"><div class="notebox">${field}</div>${caret}</div></div>`;
  }
  const first = text.trim().split('\n')[0];
  return `<div class="notecell"><div class="noteline">
      <button type="button" class="notepeek" data-collapse="${esc(key)}" data-collapse-to="false"
        data-tpop="${esc(JSON.stringify({ k: 'note', p: path, ...(name ? { n: name } : {}) }))}"
        title="${esc(text)}">${esc(first.length > 90 ? `${first.slice(0, 90).replace(/\s+\S*$/, '')}…` : first)}</button>
      ${caret}</div></div>`;
}

/**
 * A talent cell: the box it is typed in, and -- when a pack's sphere
 * catalogue knows what was typed -- a mark carrying what it does.
 *
 * The box stays a prose field. A talent is still whatever a player writes,
 * `{…}` formulas and all, and the catalogue is a second opinion rather than a
 * gate: a talent nobody has a pack for is simply unmarked, which is the state
 * every talent on every sheet was in before this. `extra` goes on the wrapper
 * so a caller can keep the cell's own classes.
 */
export function talentCell(model, binding, value, sphere, fill = null) {
  // `fill` names the row's own sphere and notes columns, which differ per
  // table -- a customized weapon and a martial tradition have no notes. The
  // element reads it to fill in what the catalogue can answer for free; left
  // off, the cell is an ordinary one that only ever writes the talent.
  const bind = fill ? `${binding} data-talent-fill="${esc(JSON.stringify(fill))}"` : binding;
  const field = prose(model, bind, value, 1, 'grow');
  const info = talentInfo(model, sphere, value);
  if (!info) return field;
  return `<span class="tcell">${field}${talentMark(sphere, value, info)}</span>`;
}

/**
 * The ✦ alone, for a cell that is not a talent cell but holds a talent.
 *
 * The Alternate Training ladder's name column is a text box on most rows and
 * a dropdown on some, and what it holds is "(leap)" where a sphere tab would
 * say "Athletics Sphere (leap)" -- so the caller says what to look up and
 * draws its own control, and this is the mark to put beside it inside a
 * `.tcell`. '' when the catalogue knows nothing, so it can go in unasked.
 */
export function talentMark(sphere, value, known = undefined, model = null) {
  const info = known === undefined ? talentInfo(model, sphere, value) : known;
  if (!info) return '';
  /*
   * The mark says what it knows twice. `data-tpop` is what the sheet's own
   * panel reads -- the one the Stats numbers open, which wraps, scrolls and
   * can be pointed into -- and it holds only the two things the row said, so
   * the panel looks the entry up as it stands rather than carrying a render's
   * worth of rules text in an attribute. `title` is the same words for a
   * browser without the popover API, and is set aside while the panel is up.
   */
  const title = [info.head, info.sub, info.prerequisites ? `Prerequisites: ${info.prerequisites}` : '',
    info.lead ? `\n${info.lead}` : '', info.text ? `\n${info.text}` : '',
    info.source ? `\n${info.source}` : ''].filter(Boolean).join('\n');
  return `<i class="tmark ${info.cls}"
      data-tpop="${esc(JSON.stringify({ k: 'talent', s: sphere ?? '', t: value ?? '' }))}"
      title="${esc(title)}" aria-label="${esc(info.aria)}">✦</i>`;
}

/**
 * What the catalogue has to say about a talent cell, or null when it knows
 * nothing: which of the four marks it is, and the words behind it.
 *
 * One place, because the tooltip and the panel are the same words in two
 * costumes and had no business being worked out twice.
 */
function talentInfo(model, sphere, value) {
  // A base pick is the sphere itself; what it carries is the sphere's base
  // abilities, which is what somebody hovering the row wants to read.
  const base = isBasePickOf(value, sphere) ? sphereBasePick(basePickSphere(value, sphere), value, model) : null;
  if (base) {
    return {
      cls: 'base', head: base.label, sub: `${base.sphere} sphere — what taking it grants`, text: base.text,
      aria: `${base.sphere} sphere — from the sphere catalogue`,
    };
  }
  const hit = sphereTalent(sphere, value);
  if (!hit) return null;
  // A pack written by hand may leave a tag on the name it also lists in
  // `tags` ("Deathful Form (form)" tagged `form`), and saying it twice reads
  // badly. Only an actual repeated suffix counts: an Acid Blast tagged `Acid`
  // is a blast-type group that happens to share a word with its name, and
  // dropping that would lose the tag a caster filters on.
  const suffix = hit.name.trim().match(/[([]([^)\]]+)[)\]]$/)?.[1]?.trim().toLowerCase();
  // Tags go with the name, where a book prints them. A citation does not: a
  // heading reading "Expanded Geomancing (Some Long Book Title p. 337)"
  // is a name with a footnote stuck in it, so where a talent came from gets a
  // line of its own at the foot. A source that is one short word -- "[3PP]",
  // "[LG]" -- is a tag; anything longer is a citation.
  const isTag = (x) => /^\S{1,12}$/.test(String(x).trim());
  const tags = [...hit.tags, ...hit.sources.filter(isTag)]
    .filter((x) => String(x).trim().toLowerCase() !== suffix);
  const cited = hit.sources.filter((x) => !isTag(x)).join('; ');
  // A talent that is a way of taking a package -- "Expanded Geomancing (Fire)"
  // -- is shown the package, which is what the row is for.
  const pack = talentPackage(hit, value);
  // Every talent off a wiki carries a `Source:` line, and that is a citation,
  // not what this mark is for -- reading it as one turned every mark on a
  // wiki-fed sheet the third-party colour.
  const thirdParty = hit.sources.some(isTag);
  return {
    cls: pack ? 'pkg' : thirdParty ? 'third' : '',
    head: `${hit.name}${tags.length ? ` (${tags.join(', ')})` : ''}`,
    sub: [hit.sphere, hit.group].filter(Boolean).join(' — '),
    prerequisites: hit.prerequisites,
    source: cited,
    lead: pack ? `${pack.names.join(', ')} — the package this row names` : '',
    // The whole entry, because a talent's text is the reason to look it up at
    // all and there is nowhere in a four-column table to put it.
    text: pack ? pack.text : hit.text,
    aria: `${hit.name} — from the sphere catalogue`,
  };
}

/**
 * Rules text for the panel, with its tables drawn as tables.
 *
 * A pack's text keeps a table as tab-separated rows -- the most a plain
 * string can do, and what a Notes box shows as it stands, since a text box
 * has no tables in it. The panel is markup, so here a run of such rows is a
 * real one: the first row its header, and a `Table: …` line just above it the
 * caption. Two rows at least, because one line with a tab in it is a line
 * with a tab in it. Everything else is the text, escaped, as it was.
 *
 * Built without newlines between the tags: the text around it is
 * `white-space: pre-wrap`, and a line break in the markup would be drawn.
 */
export function richText(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let plain = [];
  const flush = () => { if (plain.length) { out.push(esc(plain.join('\n'))); plain = []; } };
  /*
   * Two spellings of a row, because both are out there: tabs, which is what
   * the reader leaves a wiki table as, and `| a | b |`, which is what an
   * earlier build of the wiki packs wrote for base abilities and what a
   * player pasting markdown writes. A note filled from one of those packs
   * keeps its pipes for good -- a fill never overwrites -- so the panel has
   * to read them rather than wait for them to go away.
   */
  const piped = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isRow = (l) => l.includes('\t') || piped(l);
  const cellsOf = (l) => (piped(l) ? l.trim().slice(1, -1).split('|') : l.split('\t')).map((c) => c.trim());
  // Markdown's `|---|:--:|` rule under a header is punctuation, not a row.
  const isRule = (row) => row.every((c) => /^:?-+:?$/.test(c));
  for (let i = 0; i < lines.length; i++) {
    let end = i;
    while (end < lines.length && isRow(lines[end])) end++;
    if (end - i < 2) { plain.push(lines[i]); continue; }
    let caption = '';
    // The caption may sit right above the rows, or a blank line above them.
    while (plain.length && !plain[plain.length - 1].trim()) plain.pop();
    if (plain.length && /^table\b/i.test(plain[plain.length - 1].trim())) caption = plain.pop().trim();
    while (plain.length && !plain[plain.length - 1].trim()) plain.pop();
    flush();
    const rows = lines.slice(i, end).map(cellsOf).filter((row) => !isRule(row));
    const cells = (row, tag) => `<tr>${row.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
    out.push(`<table class="peektable">${caption ? `<caption>${esc(caption)}</caption>` : ''}`
      + `<thead>${cells(rows[0], 'th')}</thead><tbody>${rows.slice(1).map((r) => cells(r, 'td')).join('')}</tbody></table>`);
    i = end - 1;
  }
  flush();
  return out.join('');
}

/**
 * The panel a ✦ or a folded note opens: the Stats tab's, with a talent in it.
 *
 * `spec` is what the markup carried -- for a mark, the sphere and the talent
 * as the row wrote them; for a folded note, where the note is. Either way the
 * words are fetched now, so the panel is the sheet as it stands.
 */
export function talentPopHtml(model, spec) {
  let s;
  try { s = JSON.parse(spec); } catch { return ''; }
  const panel = (head, sub, lines, text, source = '') => `<div class="peek">
      <div class="bdhead"><span class="bdname">${esc(head)}</span></div>
      ${sub ? `<div class="bdsub">${esc(sub)}</div>` : ''}
      ${lines.filter(Boolean).map((l) => `<div class="bdsub peeklead">${esc(l)}</div>`).join('')}
      <div class="peektext">${text ? richText(text) : '<span class="empty">Nothing written.</span>'}</div>
      ${source ? `<div class="bdsub peeksource">${esc(source)}</div>` : ''}
    </div>`;
  if (s?.k === 'note') {
    const where = String(s.p ?? '');
    const hint = 'Note — click the line to open and edit it';
    // A sphere tab's note is a field of a row in a list, `list|index|field`.
    // The Alternate Training ladder keeps its notes by level under a plain
    // path, and says what the row is called itself.
    if (!where.includes('|')) {
      const text = String(where.split('.').reduce((o, k) => o?.[k], model.data) ?? '').trim();
      return text ? panel(String(s.n ?? '').trim() || 'Note', hint, [], text) : '';
    }
    const [list, index, field] = where.split('|');
    const row = model.list(list)?.[Number(index)];
    const text = String(row?.[field] ?? '').trim();
    if (!text) return '';
    const talent = String(row?.[field === 'utilityNotes' ? 'utilityTalent' : 'talent'] ?? '').trim();
    return panel(talent || 'Note', hint, [], text);
  }
  const info = talentInfo(model, s?.s, s?.t);
  if (!info) return '';
  return panel(info.head, info.sub, [info.prerequisites ? `Prerequisites: ${info.prerequisites}` : '', info.lead], info.text, info.source);
}
