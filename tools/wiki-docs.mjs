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
 *     --by <how>      'kind' (default), 'source', 'kind-source', or
 *                     'field:<name>' to group on an infobox field
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
 * Documents are content, and content is a publisher's: write them somewhere
 * git-ignored (`private/`) rather than into `data/`, which ships.
 */

import { createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  unwrapTemplates, delist, stripMarkers, emphasis, delink, collapseFamilies,
} from './wikitext.mjs';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const flag = (name) => argv.includes(`--${name}`);
const VALUED = /^--(out|by|kind|skip|source|max)$/;
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
const dry = flag('dry');

if (inputs.length !== 1 || (!out && !dry)) {
  console.error('usage: node tools/wiki-docs.mjs <pages.jsonl> --out <dir> [--by kind|source|kind-source|field:sphere] [--kind veil] [--source "Ultimate Psionics"] [--max 1500] [--dry]');
  process.exit(2);
}
/**
 * `--by field:sphere` groups on what an infobox says rather than on what the
 * page is. Talents are the case that needs it: `readStructured` has a path
 * for a document that is *itself* one thing -- a sphere and its talents, read
 * whole -- and that document is one sphere, not all 3,256 talents at once.
 */
const byField = String(by).startsWith('field:') ? by.slice(6).trim().toLowerCase() : null;
if (!byField && !['kind', 'source', 'kind-source'].includes(by)) {
  console.error(`--by takes 'kind', 'source', 'kind-source' or 'field:<name>', not ${by}`);
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
    return { lines: [['Level', level ? `${level} (${paren})` : paren]], used: ['level', 'category', 'type'] };
  },
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

const rl = createInterface({ input: createReadStream(inputs[0], { encoding: 'utf8' }), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line);
  read++;
  if (!rec.kind) { skipped++; continue; }
  if (onlyKinds && !onlyKinds.has(rec.kind)) { skipped++; continue; }
  if (skipKinds && skipKinds.has(rec.kind)) { skipped++; continue; }
  const fam = collapseFamilies(rec.fields);
  const book = (fam.get('sourcebook') || [])[0] || 'Unsourced';
  if (onlySource && !book.toLowerCase().includes(onlySource)) { skipped++; continue; }

  const key = byField ? ((fam.get(byField) || [])[0] || `No ${byField}`)
    : by === 'kind' ? plural(rec.kind)
      : by === 'source' ? book
        : `${plural(rec.kind)} — ${book}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(rec);
}

/* ---------------- writing ---------------- */

if (!dry) mkdirSync(out, { recursive: true });
const wrote = [];

for (const [name, recs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  recs.sort((a, b) => a.title.localeCompare(b.title));
  // A group past `--max` is written in parts rather than as one document, so
  // that a pack stays a size a browser will take. The parts are named, not
  // numbered blindly: "Feats (1 of 6)" is what the import list shows.
  const parts = max === Infinity ? 1 : Math.ceil(recs.length / max);
  for (let p = 0; p < parts; p++) {
    const slice = parts === 1 ? recs : recs.slice(p * max, (p + 1) * max);
    const title = parts === 1 ? name : `${name} (${p + 1} of ${parts})`;
    const kinds = new Set(slice.map((r) => r.kind));
    const section = kinds.size === 1 ? SECTION[[...kinds][0]] : null;
    const head = section && section.by === by ? `## ${section.head}\n\n` : '';
    const text = `# ${title}\n\n${head}${slice.map((r) => entryDoc(r, unknown)).join('\n\n')}\n`;
    const file = join(out, `${slug(title)}.md`);
    if (!dry) writeFileSync(file, text, 'utf8');
    wrote.push({ file, entries: slice.length, bytes: Buffer.byteLength(text) });
  }
}

/* ---------------- what it did ---------------- */

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${read} records read, ${skipped} filtered out, ${wrote.length} document(s) ${dry ? 'would be written' : `written to ${out}`}:\n`);
for (const w of wrote.slice(0, 40)) {
  console.log(`  ${kb(w.bytes).padStart(9)}  ${String(w.entries).padStart(5)} entries  ${w.file.split(/[\\/]/).pop()}`);
}
if (wrote.length > 40) console.log(`  … and ${wrote.length - 40} more`);
console.log(`  ${kb(wrote.reduce((n, w) => n + w.bytes, 0)).padStart(9)}  total`);

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
