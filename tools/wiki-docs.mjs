/**
 * Wiki records, written out as documents the pack reader already understands.
 *
 * `wiki-dump.mjs` leaves 35,691 pages in one JSONL, which is the right shape
 * for asking questions and the wrong shape for everything else: a pack is a
 * catalogue somebody imports, and nobody imports a wiki. This groups the
 * records and writes each group as one scraper document -- `#### Name`, its
 * fields, its prose -- so that `scrape-pack.mjs` can run over the result
 * unchanged and `parsePaste` stays the only reader in the toolchain.
 *
 *   node tools/wiki-docs.mjs <pages.jsonl> --out <dir> [options]
 *
 *     --out <dir>     where the documents are written (required)
 *     --by <how>      'kind' (default), 'source', 'kind-source', 'system',
 *                     'book', or 'field:<name>' to group on an infobox field
 *     --min <n>       with `--by system`: a system of fewer than n entries
 *                     (default 20) joins the general third-party group
 *     --kind <list>   only these infobox kinds, e.g. 'veil,talent'
 *     --skip <list>   every kind but these -- the other half of `--kind`,
 *                     for the run that does everything else
 *     --source <s>    only source books whose name contains this
 *     --max <n>       split a group larger than n entries into parts
 *     --dry           report what it would write, write nothing
 *
 * Grouping is the whole point of the JSONL being a separate step. `--by kind`
 * is the shape the rules are in; `--by source` is the shape the *rights* are
 * in, which is what matters for a store that ships content-free and hands out
 * only the books somebody owns. Neither is baked in, and re-grouping costs a
 * pass over 94 MB rather than another walk of the export.
 *
 * `--by system` is the shape a *player* thinks in -- Path of War, Spheres of
 * Power, Akashic -- and it writes a folder per system rather than a file,
 * because a system is several documents: its talents one sphere at a time
 * (see `SECTION`), everything else by kind. `wiki-systems.mjs` decides which
 * system a page is in, and `wiki-system-packs.mjs` turns each folder into a
 * pack:
 *
 *   node tools/wiki-system-packs.mjs <dir> --out <packs>
 *
 * `--by book` writes the same kind of folder per source book, which is
 * `--by source` done properly: that one puts a book in a single document, and
 * a document of mixed kinds cannot say its talents are a sphere. A page more
 * than one book prints goes into each of them, and `_author` beside `_name`
 * is the book's publisher, which the pack is stamped with.
 *
 * `_name` in each folder is the system's name as the books spell it, which
 * the folder's slug has lost. It has no extension because `scrape-pack` reads
 * `.txt` as well as markdown, and this is not a document.
 *
 * Documents are content, and content is a publisher's: write them somewhere
 * git-ignored (`private/`) rather than into `data/`, which ships.
 */

import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  unwrapTemplates, delist, stripMarkers, emphasis, delink, collapseFamilies,
} from './wikitext.mjs';
import { systemClassifier, GENERAL } from './wiki-systems.mjs';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const flag = (name) => argv.includes(`--${name}`);
const VALUED = /^--(out|by|kind|skip|source|max|min)$/;
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.test(argv[i - 1])));

const out = opt('out');
const by = String(opt('by', 'kind'));
const onlyKinds = opt('kind') ? new Set(String(opt('kind')).split(',').map((s) => s.trim().toLowerCase())) : null;
/*
 * `--skip` exists for one real case. Talents are grouped per sphere, because
 * that is the only grouping under which the document can honestly call itself
 * a sphere; everything else is grouped by kind. Two runs, and without this
 * the second would have to name all thirty-nine other kinds on the command
 * line to leave talents out of it.
 */
const skipKinds = opt('skip') ? new Set(String(opt('skip')).split(',').map((s2) => s2.trim().toLowerCase())) : null;
const onlySource = opt('source') ? String(opt('source')).toLowerCase() : null;
const max = Number(opt('max', 0)) || Infinity;
const min = Number(opt('min', 20)) || 0;
const dry = flag('dry');

if (inputs.length !== 1 || (!out && !dry)) {
  console.error('usage: node tools/wiki-docs.mjs <pages.jsonl> --out <dir> [--by kind|source|kind-source|system|book|field:sphere] [--min 20] [--kind veil] [--source "Ultimate Psionics"] [--max 1500] [--dry]');
  process.exit(2);
}
/**
 * `--by field:sphere` groups on what an infobox says rather than on what the
 * page is. Talents are the case that needs it: `readStructured` has a path
 * for a document that is *itself* one thing -- a sphere and its talents, read
 * whole -- and that document is one sphere, not all 3,256 talents at once.
 */
const byField = String(by).startsWith('field:') ? by.slice(6).trim().toLowerCase() : null;
if (!byField && !['kind', 'source', 'kind-source', 'system', 'book'].includes(by)) {
  console.error(`--by takes 'kind', 'source', 'kind-source', 'system', 'book' or 'field:<name>', not ${by}`);
  process.exit(2);
}

/* ---------------- what a field is called ---------------- */

/**
 * The label an infobox field is written under.
 *
 * An infobox names a field for the template that draws it -- `slot1`,
 * `skilleachlevel` -- and the reader looks for the name the *book* uses.
 * These are that translation, and no more: a field with no entry here keeps
 * its own name, tidied, so a kind nobody has mapped yet still comes through
 * legibly rather than being dropped.
 *
 * `COMMON` applies to every kind. A kind's own table wins over it.
 */
const COMMON = {
  description: 'Summary',
  // Spelled out for the general catalogue: forty kinds share these, and a
  // reference entry reading "Aurastrength Faint" helps nobody.
  aurastrength: 'Aura strength',
  auraschool: 'Aura school',
  casterlevel: 'Caster level',
  conreq: 'Construction requirements',
  concost: 'Construction cost',
  skilleachlevel: 'Skill ranks',
  hitdie: 'Hit Die',
  bab: 'Base attack bonus',
  savefort: 'Fort save',
  saveref: 'Ref save',
  savewill: 'Will save',
  favweapon: 'Favoured weapon',
  favinstrument: 'Favoured instrument',
  sacanimal: 'Sacred animal',
  favanimal: 'Favoured animal',
  domain: 'Domains',
  subdomain: 'Subdomains',
  worshipers: 'Worshippers',
  pantheon: 'Pantheon',
  descriptor: 'Descriptors',
  class: 'Class access',
  sphere: 'Sphere',
  tag: 'Tags',
  savingthrow: 'Saving throw',
  sr: 'Spell resistance',
  system: 'System',
  race: 'Race',
};

const LABELS = {
  veil: {
    slot: 'Shapeable Slot(s)',
    veilset: 'Veil set',
    enhancedweapon: 'Enhanced weapon',
    variantof: 'Variant of',
    effect: 'Effect',
    effectbind: 'Effect (bind)',
    effectessence: 'Effect (essence)',
  },
  spell: {
    school: 'School',
    components: 'Components',
    time: 'Casting time',
    range: 'Range',
    target: 'Target',
    area: 'Area',
    effect: 'Effect',
    duration: 'Duration',
    functionsas: 'Functions as',
  },
  talent: { lora: 'Lore' },
  feat: { subsuf: 'Type suffix' },
  power: {
    discipline: 'Discipline',
    display: 'Display',
    time: 'Manifesting time',
    resistance: 'Power resistance',
    augment: 'Augment',
  },
  'wild talent': {
    element: 'Element',
    burn: 'Burn',
    blasttype: 'Blast type',
    damage: 'Damage',
    aura: 'Aura',
    resistance: 'Spell resistance',
  },
  'class option': { class: 'Class', option: 'Option' },
  archetype: {
    class: 'Class',
    featurereplace: 'Replaces',
    featuremodify: 'Modifies',
    skilladd: 'Adds skills',
  },
  class: {
    hitdie: 'Hit Die',
    bab: 'Base attack bonus',
    savefort: 'Fort save',
    saveref: 'Ref save',
    savewill: 'Will save',
    skilleachlevel: 'Skill Ranks',
    alignment: 'Alignment',
  },
  race: {
    type: 'Type',
    subtype: 'Subtype',
    size: 'Size',
    move: 'Speed',
    senses: 'Senses',
  },
  'martial ability': { discipline: 'Discipline', action: 'Initiation Action' },
};

/** `statstr`, `statdex`… gathered into the one line a race's modifiers are written on. */
const ABILITY = { statstr: 'Str', statdex: 'Dex', statcon: 'Con', statint: 'Int', statwis: 'Wis', statcha: 'Cha' };

/**
 * What a book states on one line and an infobox splits over several.
 *
 * A template has a field per box it draws; a rule has a line. A race's six
 * `stat…` fields are the one **Ability Score Modifiers** line every race
 * reader looks for, and a maneuver's `level` / `category` / `type` are the
 * `1 (Maneuver [Strike])` that `structuredManeuver` takes apart again. Each
 * returns the lines to write and the fields it has spoken for.
 */
const COMPOSE = {
  race: (f) => ({
    lines: [['Ability Score Modifiers', Object.entries(ABILITY)
      .map(([k, name]) => (f.has(k) ? `${name} ${f.get(k)[0]}` : '')).filter(Boolean).join(', ')]],
    used: Object.keys(ABILITY),
  }),
  'martial ability': (f) => {
    const level = (f.get('level') || [])[0] || '';
    const category = (f.get('category') || [])[0] || 'Maneuver';
    const type = (f.get('type') || [])[0] || '';
    const paren = type && type !== category ? `${category} [${type}]` : category;
    /*
     * The reader knows a maneuver by its discipline *and* its initiation
     * action, and one page -- Strike of Silver Exorcism -- never filled the
     * action in. It is still a maneuver, so the line is written with nothing
     * claimed on it, the way a power with no stated cost is.
     */
    const lines = [['Level', level ? `${level} (${paren})` : paren]];
    if (!f.has('action')) lines.push(['Initiation Action', '—']);
    return { lines, used: ['level', 'category', 'type'] };
  },
  /*
   * A veil is known by its shapeable slot, and some have none to state: the
   * style veils of Tai Lin and the Akashic Construct are shaped without taking
   * a chakra. "None" is what the book would say, and it keeps them out of
   * every chakra's picker while the catalogue still knows them by name.
   */
  veil: (f) => ({ lines: f.has('slot') ? [] : [['Shapeable Slot(s)', 'None']], used: [] }),
  /*
   * The three below each state the field that *identifies* the entry, and
   * each has a default, because `STRUCTURED_KINDS` matches on a field being
   * present and these are not reliably filled: only 71.7% of feats name a
   * subcategory and 64.3% of spells name a class. A row keyed on either would
   * quietly drop a quarter of the wiki.
   *
   * The default is not a guess. The page opened `{{Infobox feat}}`, so that
   * it is a feat is something the source says outright -- the emitter is
   * writing down a fact it was given, which is exactly what the reader's
   * "identity comes from the fields it carries" is for. What is unknown is
   * only the *detail*, and that is what the default says: a feat of no stated
   * type, a spell on nobody's list.
   */
  feat: (f) => ({
    lines: [['Feat type', (f.get('subcategory') || []).join(', ') || 'Feat']],
    used: ['subcategory'],
  }),
  spell: (f) => ({
    lines: [['Spell level', (f.get('class') || []).join(', ') || 'Unlisted']],
    used: ['class'],
  }),
  'wild talent': (f) => ({
    lines: [['Wild talent type', (f.get('type') || []).join(', ') || 'Wild talent']],
    used: ['type'],
  }),
  power: (f) => ({
    lines: [
      ['Power level', (f.get('class') || []).join(', ') || 'Unlisted'],
      ['Power points', (f.get('powerpoints') || [])[0] || '—'],
    ],
    used: ['class', 'powerpoints'],
  }),
};

/**
 * The section heading that says what a whole document is.
 *
 * `readStructured` reads a document that is *itself* one thing before it
 * reads the entries in it, and a sphere is the case it knows: a title, and
 * its talents under a `Sphere Talents` section. That is a claim about the
 * document rather than about any entry, so it is only true when the grouping
 * made it true -- one document per sphere. Grouped any other way the heading
 * would be a lie, and 3,256 talents would be read as one enormous sphere.
 */
const SECTION = { talent: { by: 'field:sphere', head: 'Sphere Talents' } };

/** The book, the page and nothing else: a publisher's name is not a field of the rule. */
function sourceLine(f) {
  const book = (f.get('sourcebook') || [])[0];
  const page = (f.get('sourcepage') || [])[0];
  if (!book) return '';
  return page ? `${book} p. ${page}` : book;
}

const label = (kind, base) => LABELS[kind]?.[base] ?? COMMON[base]
  ?? base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Fields the document states elsewhere, or that are the template's own bookkeeping. */
const SKIP = new Set(['sourcebook', 'sourcepage', 'sourcepub', 'sourcepag', 'name', 'pagename', 'image', 'caption']);

/**
 * The kinds `paste-import.js` reads on their own terms, each with a row in
 * `STRUCTURED_KINDS` and a shape of its own.
 *
 * Everything else -- forty of them, from 3,003 class options down to two
 * technological items -- says `Entry kind` instead and lands in the general
 * catalogue. That is not a shortcut taken for the long tail's sake: it is
 * what a deity, a plane and a special material *are* to this sheet. They are
 * reference. Nothing about a herald changes a number, and forty readers that
 * each pulled a name and a paragraph out of a page would be one reader
 * written forty times.
 *
 * A kind earns its own row when the sheet grows somewhere to put it -- which
 * for `class`, `race`, `trait`, `archetype` and `class option` means the
 * block kinds that already exist and are the obvious next tranche.
 */
const OWN_READER = new Set(['veil', 'martial ability', 'talent', 'feat', 'spell', 'power', 'wild talent']);

/**
 * A field's value, on one line and without markup.
 *
 * A field is read into a cell rather than into a paragraph, so it gets the
 * unpicking prose gets from the reader and never sees -- and it gets folded
 * onto one line, because a `<datalist>` label and a table cell both have
 * exactly one.
 */
const field = (v, title = '', unknown = null) => delink(unwrapTemplates(String(v ?? ''), title, unknown))
  .replace(/'{2,5}/g, '').replace(/\s+/g, ' ').trim();

/**
 * A page several books share, as one of those books prints it.
 *
 * A list page -- a class's talents, its arts -- names every book that adds to
 * it as a source and heads each book's additions `==The Book==`. Written
 * whole into each book's folder it puts ten books' text in every one of them,
 * under the first book's citation. Where the headings are the page's own
 * sources, a book gets what is under its heading, whatever the page says
 * before the first of them and under headings that are no book's, and its own
 * citation alone. A page that is not laid out that way is left as it is, and
 * a book with no section and nothing general to show for it gets nothing.
 */
function narrowToBook(rec, book, books) {
  const key = (s) => field(s).toLowerCase();
  const mine = key(book);
  const theirs = new Set(books.map(key));
  const sections = [{ head: null, lines: [] }];
  for (const line of String(rec.body ?? '').split('\n')) {
    const m = line.match(/^==([^=].*?)==\s*$/);
    if (m) sections.push({ head: m[1].trim(), lines: [line] });
    else sections[sections.length - 1].lines.push(line);
  }
  if (!sections.some((s) => s.head !== null && theirs.has(key(s.head)))) return rec;
  const kept = sections.filter((s) => s.head === null || key(s.head) === mine || !theirs.has(key(s.head)));
  if (!kept.some((s) => s.head !== null) && !kept[0].lines.join('').trim()) return null;

  // Its own citation: the numbered family this book is, renumbered to the first.
  const fields = {};
  let n = '';
  for (const [k, v] of Object.entries(rec.fields || {})) {
    const m = k.match(/^source(book|page|pub)(\d*)$/);
    if (!m) fields[k] = v;
    else if (m[1] === 'book' && key(v) === mine) n = m[2];
  }
  for (const part of ['book', 'page', 'pub']) {
    if (rec.fields?.[`source${part}${n}`] !== undefined) fields[`source${part}`] = rec.fields[`source${part}${n}`];
  }
  return { ...rec, fields, body: kept.flatMap((s) => (s.head !== null && key(s.head) === mine ? s.lines.slice(1) : s.lines)).join('\n') };
}

/** A bold line that labels a paragraph of an entry, not the start of the next entry. */
const INNER_LABEL = /^(?:prerequisites?|requirements?|benefits?|special|normal|notes?|example|table)\b/i;

/**
 * A page that is a list of a class's options, as the options it lists.
 *
 * Most options have a page each -- a wild talent, an element. A class's
 * talents or arts are as often one page holding all of them, and written out
 * as one entry that is thirty options in a block nobody can look through,
 * pick from or cite. The page says it is such a list by being titled for the
 * class and the option together ("Vigilante Talent" for the Vigilante's
 * Talent), which a page about one option never is.
 *
 * Two layouts cover them: every option under its own `===heading===`, or
 * every option a paragraph opening with its name in bold or italics and a
 * colon. A page of headings is cut on headings only, since an option under a
 * heading has labelled paragraphs of its own. Fewer than three found and the
 * page is left whole. What comes before the first option is the list's own
 * rules, kept under the page's title when `intro` asks for it -- once, not
 * once a book.
 */
function splitListPage(rec, { intro = true } = {}) {
  if (rec.kind !== 'class option') return [rec];
  const fam = collapseFamilies(rec.fields);
  const titled = `${field((fam.get('class') || [])[0])} ${field((fam.get('option') || [])[0])}`.trim().toLowerCase();
  if (!titled.includes(' ') || field(rec.title).toLowerCase() !== titled) return [rec];

  const lines = String(rec.body ?? '').split('\n');
  const byHeading = lines.filter((l) => /^===[^=].*?===\s*$/.test(l)).length >= 3;
  const opening = [];
  const items = [];
  for (const line of lines) {
    let name = null;
    let rest = '';
    if (byHeading) {
      const m = line.match(/^===([^=].*?)===\s*$/);
      if (m) name = field(m[1]);
    } else {
      const m = line.match(/^[:*#]*\s*('{2,5})(.+?)\1(:?)\s*(.*)$/);
      const label = m ? field(m[2]) : '';
      if (m && (m[3] || /:\s*$/.test(label))) {
        const n = label.replace(/:\s*$/, '').trim();
        if (n && n.length <= 70 && !/[.!?]\s/.test(n) && !INNER_LABEL.test(n)) { name = n; rest = m[4]; }
      }
    }
    // "Desperate Shift (requires urgency, warden 4)" is a name and what it asks
    // for; the second is a prerequisite, and is written where those go.
    const asks = name && name.match(/^(.*?)\s*\(requires? ([^()]*(?:\([^()]*\)[^()]*)*)\)\s*:?$/i);
    if (asks) { name = asks[1]; rest = `Prerequisites: ${asks[2]}\n\n${rest}`; }
    if (name) name = name.replace(/\s*:\s*$/, '').trim();
    if (name && !/^[A-Z0-9"'“]/.test(name)) name = null;
    if (name) items.push({ name, lines: rest ? [rest] : [] });
    else (items.length ? items[items.length - 1].lines : opening).push(line);
  }
  if (items.length < 3) return [rec];

  const out = items.map((it) => ({ ...rec, title: it.name, body: it.lines.join('\n').trim() })).filter((r) => r.body);
  const said = opening.join('\n').replace(/\{\{[^{}]*\}\}/g, '').trim();
  if (intro && said.length > 150) out.unshift({ ...rec, body: opening.join('\n').trim() });
  return out;
}

/* ---------------- one entry ---------------- */

function entryDoc(rec, unknown) {
  const fam = collapseFamilies(rec.fields);
  const lines = [`#### ${rec.title}`];

  const composed = COMPOSE[rec.kind]?.(fam) ?? { lines: [], used: [] };
  for (const k of composed.used) fam.delete(k);

  let summary = '';
  for (const [base, values] of fam) {
    if (SKIP.has(base)) continue;
    const value = values.join(', ');
    if (!value) continue;
    if (base === 'description') { summary = value; continue; }
    lines.push(`* **${label(rec.kind, base)}:** ${field(value, rec.title, unknown)}`);
  }
  for (const [name, value] of composed.lines) if (value) lines.push(`* **${name}:** ${field(value, rec.title, unknown)}`);
  if (!OWN_READER.has(rec.kind)) lines.push(`* **Entry kind:** ${field(rec.kind)}`);

  /*
   * A prerequisite is a field wherever a book prints it, and on this wiki it
   * is `{{Prerequisite|…}}` in the middle of the prose -- 10,134 pages of it,
   * nearly all feats. Lifted out and stated as a field, so that the reader
   * gets it as one rather than having to find it in a paragraph; the line is
   * removed from the body so it is not said twice.
   */
  /*
   * Order matters, and only one order works. `delist` reads the first
   * characters of a line as MediaWiki's list markers, so it has to run while
   * they still are: convert `'''Benefit:'''` first and the `**` it leaves at
   * the head of the line reads as two levels of bullet, and the rule comes
   * out as `- Benefit:**`.
   */
  let body = emphasis(delist(stripMarkers(unwrapTemplates(rec.body, rec.title, unknown))))
    // MediaWiki's `----` rule, and the `---` some pages type instead. To the
    // reader a line of dashes ends the entry, and everything one page wrote
    // under its rule arrived as hundreds of loose lines.
    .replace(/^-{3,}[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const prereq = body.match(/^Prerequisites?:[ \t]*(.+)$/m);
  if (prereq && prereq[1].trim()) {
    lines.push(`* **Prerequisites:** ${field(prereq[1], rec.title, unknown)}`);
    body = body.replace(prereq[0], '').replace(/\n{3,}/g, '\n\n').trim();
  }

  const source = sourceLine(fam);
  if (source) lines.push(`* **Source:** ${field(source, rec.title, unknown)}`);
  if (summary) lines.push('', `**Summary:** *${emphasis(unwrapTemplates(summary, rec.title, unknown)).replace(/\s+/g, ' ').trim()}*`);
  if (body) lines.push('', body);
  return lines.join('\n');
}

/* ---------------- a sphere's own page ---------------- */

/**
 * A `{| … |}` table as tab-separated rows -- the form the reader's own
 * `unwikiTables` leaves a talent's table in, so that a sphere's base
 * abilities and its talents arrive with one kind of table between them and
 * the sheet has one thing to draw as a table.
 */
function tables(text) {
  return String(text ?? '').replace(/^\{\|[^\n]*\n([\s\S]*?)^\|\}[ \t]*$/gm, (_, inner) => {
    const rows = inner.split(/^\|-[^\n]*$/m).map((row) => row.split('\n')
      .filter((l) => /^[|!]/.test(l) && !/^\|\+/.test(l))
      .flatMap((l) => l.slice(1).split(/\|\||!!/))
      .map((c) => c.replace(/^[^|\[\]{}]*\|(?!\|)/, '').trim()))
      .filter((cells) => cells.length);
    return rows.map((cells) => cells.join('\t')).join('\n');
  });
}

/** Headings under which a sphere's page stops describing the sphere and starts listing things. */
const PAST_THE_SPHERE = /\btalents?\b|drawbacks?|\brelated\b|variant|variation|\btags?$|\bgroups?$|\bfeats?$|rule notes|conflicting|archetypes|sphere-specific|handbook/i;
/** Bold run-ins that are an aside, not something the sphere grants. */
const ASIDE = /^(?:note|special|.*\bnote|level\b.*)$/i;
/** A definition term naming a sphere, `;{{pl|Alteration|sphere}}`: the head of that sphere's share of a section. */
const BY_SPHERE_TERM = /^;[ \t]*\{\{\s*pl\s*\|\s*([^}|]+?)\s*\|\s*sphere\s*\}\}[ \t]*$/gim;
/** `*Label:*`, or `**Label**` with or without its colon, heading a paragraph. */
const RUN_IN = /^(?:\*([A-Z][^*\n:]{1,40})(?::\*|\*:)|\*\*([A-Z][^*\n:]{1,40}):?\*\*:?)[ \t]*(.*)$/;

/**
 * What taking the sphere itself gets you, written the way the reader finds it.
 *
 * `structuredSphere` reads a sphere's base abilities out of the document's
 * opening, as `*Destructive Blast:* As a standard action…` -- one label a
 * line, everything under it belonging to it. The talents' documents had no
 * opening at all, because a talent's page does not know what its sphere
 * grants; the sphere's own page does, and this is that page put in those
 * terms.
 *
 * The wiki marks a base ability three ways and all three are read: an italic
 * or bold run-in (`''Sweep:''`, `'''Geomancing'''`), a heading of its own
 * (Protection's Aegis and Ward), and -- for a sphere that offers a choice --
 * a `… Packages` heading with one heading per package under it. That last is
 * written as a `*Packages:*` label, which is how the reader knows that what
 * follows is a choice rather than a list of things granted together. Rules
 * the page never names (Guardian's delayed damage pool is three paragraphs
 * under no label) go under the sphere's own name rather than being lost to
 * the description.
 */
function sphereIntro(rec, unknown) {
  const name = rec.title.replace(/\s+sphere\b.*$/i, '').trim();
  const tidy = (t) => emphasis(delist(stripMarkers(unwrapTemplates(tables(t), rec.title, unknown))))
    .replace(/^-{3,}[ \t]*$/gm, '').replace(/^#+[ \t]*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  // Inside an ability a run-in is part of its text, and must not read as the next one.
  const nested = (t) => tidy(t).replace(/^\*([A-Z][^*\n:]{1,40})(?::\*|\*:)/gm, '**$1:**');
  const label = (s) => delink(String(s)).replace(/<[^>]+>/g, '').replace(/['*:]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^./, (c) => c.toUpperCase()).slice(0, 40);

  const parts = [{ level: 0, head: '', lines: [] }];
  for (const line of String(rec.body ?? '').split('\n')) {
    const h = line.match(/^(={2,5})\s*(.+?)\s*\1\s*$/);
    if (h) parts.push({ level: h[1].length, head: label(h[2]), lines: [] });
    else parts[parts.length - 1].lines.push(line);
  }

  let description = '';
  const abilities = [];
  let choose = null;
  let packagesAt = 0;
  let abilityAt = 0;
  const add = (n, text, option = false) => abilities.push({ name: n, text: [text], option });
  const append = (text) => { if (abilities.length && text) abilities[abilities.length - 1].text.push(text); };

  for (const part of parts) {
    if (part.level && PAST_THE_SPHERE.test(part.head) && !/packages?$/i.test(part.head)) break;
    const raw = part.lines.join('\n');
    if (!part.level) {
      // The opening: a line of what the sphere is, then what it grants.
      const paras = tidy(raw).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      for (const para of paras) {
        const m = para.match(RUN_IN);
        const named = m && (m[1] || m[2]);
        if (named && !ASIDE.test(named.trim())) add(label(named), m[3]);
        else if (abilities.length) append(para.replace(/^\*([A-Z][^*\n:]{1,40})(?::\*|\*:)/, '**$1:**'));
        else if (!description) description = para;
        else add(name, para);
      }
      continue;
    }
    if (/packages?$/i.test(part.head)) { packagesAt = part.level; choose = nested(raw); continue; }
    if (packagesAt && part.level > packagesAt) {
      if (part.level === packagesAt + 1) add(part.head.replace(/\s+package$/i, ''), nested(raw), true);
      else append(`**${part.head}**\n\n${nested(raw)}`);
      continue;
    }
    packagesAt = 0;
    /*
     * A section divided by sphere -- Divination's Alternate Divinations, which
     * has an entry for each *other* sphere a caster might possess -- is an
     * ability of its own even when the page nests it under another, because
     * what it says depends on the character reading it and the sheet has to be
     * able to find it to answer. Its `;Alteration` terms are written out as
     * "Alteration sphere:" lines, which is how the reader knows the division.
     */
    const terms = raw.match(BY_SPHERE_TERM) || [];
    if (terms.length >= 2) { add(part.head, nested(raw.replace(BY_SPHERE_TERM, ';$1 sphere'))); continue; }
    if (!abilityAt || part.level <= abilityAt) { abilityAt = part.level; add(part.head, nested(raw)); }
    else append(`**${part.head}**\n\n${nested(raw)}`);
  }

  const out = [];
  if (description) out.push(description);
  const say = (a) => `*${a.name}:* ${a.text.filter(Boolean).join('\n\n')}`.trim();
  for (const a of abilities.filter((x) => !x.option)) out.push(say(a));
  if (abilities.some((x) => x.option)) {
    out.push(`*Packages:* ${choose || ''}`.trim());
    for (const a of abilities.filter((x) => x.option)) out.push(say(a));
  }
  // A blockquote, because that is where the scraper puts a page's own
  // description and so the only opening the reader takes as one; anything
  // else above the first entry is a stray line to it.
  return out.join('\n\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
}

/* ---------------- grouping ---------------- */

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
/** Enough plural for a document title: "martial ability" is not "Martial Abilitys". */
const plural = (s) => titleCase(/[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies`
  : /(?:s|x|z|ch|sh)$/.test(s) ? `${s}es` : `${s}s`);

const groups = new Map();
const unknown = new Map();
let read = 0;
let skipped = 0;

/*
 * Everything is read before anything is grouped. Three of the four groupings
 * could decide a record as it goes by, but a system is judged on evidence
 * spread over the whole wiki -- a feat by its book, the book by its veils --
 * and that has to see the pages a `--kind` filter is about to drop.
 */
const records = [];
const rl = createInterface({ input: createReadStream(inputs[0], { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) {
  if (line.trim()) records.push(JSON.parse(line));
}

const systems = by === 'system' ? systemClassifier(records) : null;
/** How each page found its system, for the report. */
const placedBy = new Map();
/** Systems too small to be a pack of their own, which join the general group. */
const folded = new Map();
if (systems) {
  const size = new Map();
  for (const rec of records) if (rec.kind) size.set(systems.of(rec)[0], (size.get(systems.of(rec)[0]) || 0) + 1);
  for (const [name, n] of size) if (n < min && name !== GENERAL) folded.set(name, n);
}

/** `--by book`: who published each book, and how many pages more than one book prints. */
const publisher = new Map();
let reprinted = 0;
let narrowed = 0;
let listed = 0;

for (const rec of records) {
  read++;
  if (!rec.kind) { skipped++; continue; }
  if (onlyKinds && !onlyKinds.has(rec.kind)) { skipped++; continue; }
  if (skipKinds && skipKinds.has(rec.kind)) { skipped++; continue; }
  const fam = collapseFamilies(rec.fields);
  const book = (fam.get('sourcebook') || [])[0] || 'Unsourced';
  if (onlySource && !book.toLowerCase().includes(onlySource)) { skipped++; continue; }

  /*
   * Inside a system a talent is still grouped by its sphere, for the reason
   * `SECTION` gives: a document may only call itself a sphere when it is one.
   */
  let homes = [''];
  if (systems) {
    const [found, why] = systems.of(rec);
    homes = [folded.has(found) ? GENERAL : found];
    placedBy.set(why, (placedBy.get(why) || 0) + 1);
  }
  /*
   * A page that names two books as its source is in *both* folders: a group
   * that uses only the later collection still expects the entry to be in it,
   * whichever book the page happens to list first. The tables merge by name,
   * so importing both does not make two of it.
   */
  if (by === 'book') {
    const all = fam.get('sourcebook') || [];
    const pubs = fam.get('sourcepub') || [];
    homes = [...new Set(all.map((b) => field(b)).filter(Boolean))];
    // A book's own page names no source, being one; it goes in with the book.
    if (rec.kind === 'publication') homes = [field(rec.title)];
    if (!homes.length) homes = ['Unsourced'];
    all.forEach((b, i) => { if (pubs[i] && !publisher.has(field(b))) publisher.set(field(b), field(pubs[i])); });
    if (homes.length > 1) reprinted++;
  }
  const perSphere = (systems || by === 'book') && rec.kind === 'talent';
  const name = byField ? ((fam.get(byField) || [])[0] || `No ${byField}`)
    : perSphere ? (field((fam.get('sphere') || [])[0]) || 'No sphere')
      : by === 'kind' || by === 'system' || by === 'book' ? plural(rec.kind)
        : by === 'source' ? book
          : `${plural(rec.kind)} — ${book}`;
  /*
   * What goes into each home. A book gets its own section of a page it
   * shares; any other grouping gets the page once, but still a book's section
   * at a time, so that an option cut out of a list cites the book it is in.
   */
  const printedIn = [...new Set((fam.get('sourcebook') || []).map((b) => field(b)).filter(Boolean))];
  const sectionFor = (book) => (printedIn.length > 1 ? narrowToBook(rec, book, printedIn) : rec);
  homes.forEach((dir, hi) => {
    let pieces;
    if (by === 'book') {
      const mine = sectionFor(dir);
      if (!mine) return;
      if (mine !== rec) narrowed++;
      pieces = splitListPage(mine, { intro: hi === 0 });
    } else {
      const sections = printedIn.map(sectionFor);
      pieces = sections.some((s) => s && s !== rec)
        ? sections.flatMap((s, si) => (s ? splitListPage(s, { intro: si === 0 }) : []))
        : splitListPage(rec);
    }
    if (pieces.length > 1) listed += pieces.length;
    const key = `${dir}\n${name}`;
    if (!groups.has(key)) groups.set(key, { dir, name, perSphere, recs: [] });
    groups.get(key).recs.push(...pieces);
  });
}

/* ---------------- writing ---------------- */

if (!dry) mkdirSync(out, { recursive: true });
const wrote = [];

/** Each sphere's own page, by the name its talents call it. The first of two pages of one name wins. */
const spherePages = new Map();
for (const rec of records) {
  if (rec.kind !== 'sphere') continue;
  const key = rec.title.replace(/\s+sphere\b.*$/i, '').trim().toLowerCase();
  if (!/\(/.test(rec.title) || !spherePages.has(key)) spherePages.set(key, rec);
}

const dirs = new Map();
const slugs = new Set();
for (const { dir, name, perSphere, recs } of [...groups.values()].sort((a, b) => b.recs.length - a.recs.length)) {
  recs.sort((a, b) => a.title.localeCompare(b.title));
  if (dir && !dirs.has(dir)) {
    // A slug is cut at sixty characters, and a publisher's series can share
    // that many: the second such book gets a number rather than the first's folder.
    let s = slug(dir);
    for (let n = 2; slugs.has(s); n++) s = `${slug(dir)}-${n}`;
    slugs.add(s);
    dirs.set(dir, { slug: s, entries: 0, bytes: 0 });
    if (!dry) {
      mkdirSync(join(out, s), { recursive: true });
      writeFileSync(join(out, s, '_name'), dir, 'utf8');
      if (publisher.has(dir)) writeFileSync(join(out, s, '_author'), publisher.get(dir), 'utf8');
    }
  }
  const folder = dir ? join(out ?? '', dirs.get(dir).slug) : out;
  // A group past `--max` is written in parts rather than as one document, so
  // that a pack stays a size a browser will take. The parts are named, not
  // numbered blindly: "Feats (1 of 6)" is what the import list shows.
  const parts = max === Infinity ? 1 : Math.ceil(recs.length / max);
  for (let p = 0; p < parts; p++) {
    const slice = parts === 1 ? recs : recs.slice(p * max, (p + 1) * max);
    const title = parts === 1 ? name : `${name} (${p + 1} of ${parts})`;
    const kinds = new Set(slice.map((r) => r.kind));
    const section = kinds.size === 1 ? SECTION[[...kinds][0]] : null;
    const head = section && (section.by === by || perSphere) ? `## ${section.head}\n\n` : '';
    /*
     * A sphere's document opens with what the sphere itself grants. In a
     * book's folder that is only said by a book the sphere's page names as a
     * source: a handbook adds talents to Destruction without reprinting the
     * destructive blast, and the packs join by name, so it is said once by
     * the book that does print it.
     */
    const page = head && p === 0 ? spherePages.get(name.toLowerCase()) : null;
    const prints = page && (by !== 'book' || (collapseFamilies(page.fields).get('sourcebook') || []).some((b) => field(b) === dir));
    const intro = prints ? sphereIntro(page, unknown) : '';
    const text = `# ${title}\n\n${intro ? `${intro}\n\n` : ''}${head}${slice.map((r) => entryDoc(r, unknown)).join('\n\n')}\n`;
    // A sphere and a kind can share a name -- Alchemy is both -- so a sphere's file says which it is.
    const file = join(folder ?? '', `${perSphere ? 'sphere-' : ''}${slug(title)}.md`);
    if (!dry) writeFileSync(file, text, 'utf8');
    wrote.push({ file, entries: slice.length, bytes: Buffer.byteLength(text) });
    if (dir) { dirs.get(dir).entries += slice.length; dirs.get(dir).bytes += Buffer.byteLength(text); }
  }
}

/* ---------------- what it did ---------------- */

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${read} records read, ${skipped} filtered out, ${wrote.length} document(s) ${dry ? 'would be written' : `written to ${out}`}:\n`);
if (dirs.size) {
  const rows = [...dirs].sort((a, b) => b[1].entries - a[1].entries);
  for (const [name, d] of rows.slice(0, 40)) {
    console.log(`  ${kb(d.bytes).padStart(9)}  ${String(d.entries).padStart(5)} entries  ${name}`);
  }
  if (rows.length > 40) console.log(`  … and ${rows.length - 40} more folders`);
} else {
  for (const w of wrote.slice(0, 40)) {
    console.log(`  ${kb(w.bytes).padStart(9)}  ${String(w.entries).padStart(5)} entries  ${w.file.split(/[\\/]/).pop()}`);
  }
  if (wrote.length > 40) console.log(`  … and ${wrote.length - 40} more`);
}
console.log(`  ${kb(wrote.reduce((n, w) => n + w.bytes, 0)).padStart(9)}  total`);
if (listed) console.log(`
${listed} entries were cut out of pages that list a class's options.`);

if (systems) {
  console.log(`\nPlaced by: ${[...placedBy].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ')}`);
  if (folded.size) console.log(`Too small for a pack of their own (--min ${min}), so in ${GENERAL}: ${[...folded].map(([n, c]) => `${n} ${c}`).join(', ')}`);
}
if (by === 'book') console.log(`\n${dirs.size} books; ${reprinted} pages are printed in more than one and were written into each (${narrowed} times as that book's own section of a shared page).`);

/*
 * The templates it had to guess at.
 *
 * The rule for an unknown template is "show its last argument", which is what
 * every link template on this wiki agrees on -- but a guess is still a guess,
 * and one made 38,496 times is worth seeing. A name high on this list with a
 * shape of its own belongs in `wikitext.mjs`, not in the silence.
 */
const guessed = [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 12);
if (guessed.length) {
  console.log('\nTemplates read by the default rule (last argument), most used first:');
  for (const [name, n] of guessed) console.log(`  ${String(n).padStart(6)}  {{${name}}}`);
}
