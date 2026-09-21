/**
 * A compendium kept as YAML -- one file per entry -- written out as documents
 * the pack reader already understands.
 *
 * Some tables keep their game's entries this way: a folder of compendiums, a
 * folder per compendium, a YAML file per spell, feat, class feature or item,
 * each already typed (a spell's school, range and class levels are fields,
 * not prose). That is most of the way to a pack, and this is the rest of it
 * for somebody whose own material lives in that shape.
 *
 *   node tools/yaml-docs.mjs <compendium-root> --out <dir>
 *   node tools/wiki-system-packs.mjs <dir> --out <packs>
 *
 *     --out <dir>      where the folders are written (required)
 *     --by <how>       'book' (default) or 'kind'
 *     --packs <list>   only these compendiums, e.g. 'feats,spells'
 *     --author <s>     written beside each book as its publisher
 *     --yaml <dir>     a folder whose node_modules holds `js-yaml`
 *                      (default private/tool-modules; `npm i js-yaml` there)
 *     --dry            report what it would write, write nothing
 *
 * `<compendium-root>` holds a `packs/` folder of compendiums and, optionally,
 * `module/registry/sources.mjs` naming the source codes its entries cite.
 *
 * It is `wiki-docs.mjs --by book` for a different shape of input: the same
 * folders, the same `_name` and `_author`, the same field labels, so that
 * `wiki-system-packs.mjs` and `scrape-pack.mjs` run over the result unchanged
 * and the reader in `paste-import.js` stays the only one. An entry more than
 * one book prints goes into each of them, as it does there.
 *
 * This repo has no dependencies and a YAML reader is not worth being its
 * first, so `js-yaml` is looked up in a folder of its own rather than beside
 * the tool. It is the one thing here that has to be installed.
 *
 * Documents are content, and content is its author's: write them somewhere
 * git-ignored (`private/`) rather than into `data/`, which ships.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const flag = (name) => argv.includes(`--${name}`);
const inputs = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && /^--(out|by|packs|yaml|author)$/.test(argv[i - 1])));
const out = opt('out');
const by = String(opt('by', 'book'));
const onlyPacks = opt('packs') ? new Set(String(opt('packs')).split(',').map((s) => s.trim())) : null;
const yamlHome = resolve(String(opt('yaml', 'private/tool-modules')));
const author = opt('author') ? String(opt('author')) : '';
const dry = flag('dry');

if (inputs.length !== 1 || (!out && !dry) || !['book', 'kind'].includes(by)) {
  console.error('usage: node tools/yaml-docs.mjs <compendium-root> --out <dir> [--by book|kind] [--packs feats,spells] [--author "…"] [--yaml private/tool-modules] [--dry]');
  process.exit(2);
}
const checkout = inputs[0];

let yaml;
try {
  yaml = createRequire(join(yamlHome, 'package.json'))('js-yaml');
} catch {
  console.error(`js-yaml was not found under ${yamlHome}. Run \`npm i js-yaml\` in that folder, or point --yaml at one that has it.`);
  process.exit(1);
}

/* ---------------- the books ---------------- */

/**
 * Source code to title, where the compendium comes with a registry of them.
 * It is an object literal inside a module written for another program, so it
 * is read as text -- an id, and the `name:` on the line under it -- and a
 * compendium without one simply cites its sources as its entries spell them.
 */
const BOOKS = new Map();
if (existsSync(join(checkout, 'module/registry/sources.mjs'))) {
  const text = readFileSync(join(checkout, 'module/registry/sources.mjs'), 'utf8');
  for (const m of text.matchAll(/^\s+([A-Za-z0-9_-]+): \{\s*\n\s+name: "((?:[^"\\]|\\.)*)"/gm)) BOOKS.set(m[1], m[2].replace(/\\"/g, '"'));
}
const bookOf = (s) => (s?.id && BOOKS.get(s.id)) || s?.title || s?.id || '';

/* ---------------- HTML to the scraper's markdown ---------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', times: '×', minus: '−', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };

/**
 * A description, as prose the reader can take. Headings become bold lines,
 * because a `#` in the middle of an entry is where the reader ends it, and a
 * table keeps its rows as pipes. A link written for the program the
 * compendium came from -- `@UUID[…]{Haste}` -- is shown by its label.
 */
function prose(html) {
  return String(html ?? '')
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/@\w+\[([^\]]*)\]/g, (_, inner) => inner.split('.').pop())
    .replace(/\[\[\/\w+\s+([^\]]*?)(?:\s*#[^\]]*)?\]\](?:\{([^}]*)\})?/g, (_, roll, label) => label || roll)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:th|td)>\s*<(?:th|td)[^>]*>/gi, ' | ')
    .replace(/<tr[^>]*>\s*<(?:th|td)[^>]*>/gi, '\n| ')
    .replace(/<\/(?:th|td)>\s*<\/tr>/gi, ' |')
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n**$1**\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<p\b[^>]*>/gi, '\n\n')
    .replace(/<\/(?:p|div|ul|ol|table|blockquote)>/gi, '\n\n')
    .replace(/<(?:strong|b)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:strong|b)>/gi, '**$1**')
    .replace(/<(?:em|i)\b[^>]*>\s*([\s\S]*?)\s*<\/(?:em|i)>/gi, '*$1*')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m)
    // A line of dashes or a leading `#` would end the entry for the reader.
    .replace(/^-{3,}[ \t]*$/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const oneLine = (html) => prose(html).replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

/* ---------------- what each kind states ---------------- */

const SCHOOLS = { abj: 'Abjuration', con: 'Conjuration', div: 'Divination', enc: 'Enchantment', evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy', trs: 'Transmutation', uni: 'Universal', misc: 'Miscellaneous' };
const titleCase = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());

/** `{units: 'close'}`, `{units: 'ft', value: '30'}`, `{units: 'spec', value: 'see text'}`. */
function measure(m, words = {}) {
  if (!m || !m.units) return '';
  const u = m.units;
  if (words[u]) return m.value && /spec|text/.test(u) ? String(m.value) : words[u];
  if (u === 'spec' || u === 'seeText') return String(m.value || 'see text');
  return m.value ? `${m.value} ${u === 'ft' ? 'ft.' : u}` : titleCase(u);
}
const RANGE = { close: 'Close (25 ft. + 5 ft./2 levels)', medium: 'Medium (100 ft. + 10 ft./level)', long: 'Long (400 ft. + 40 ft./level)', personal: 'Personal', touch: 'Touch', unlimited: 'Unlimited' };
const DURATION = { inst: 'Instantaneous', perm: 'Permanent', turn: '1 round' };

function spellFields(d) {
  const s = d.system ?? {};
  const act = Object.values(s.actions ?? {})[0] ?? (Array.isArray(s.actions) ? s.actions[0] : null) ?? {};
  const lists = s.learnedAt ?? {};
  const levels = (o) => Object.entries(o ?? {}).map(([k, v]) => `${titleCase(k)} ${v}`).join(', ');
  const c = s.components ?? {};
  const comps = [c.verbal && 'V', c.somatic && 'S', c.thought && 'T', c.emotion && 'E',
    c.material && `M${s.materials?.value ? ` (${oneLine(s.materials.value)})` : ''}`,
    c.focus && `F${s.materials?.focus ? ` (${oneLine(s.materials.focus)})` : ''}`,
    c.divineFocus && ['', 'DF', 'M/DF', 'F/DF'][c.divineFocus] || (c.divineFocus === true && 'DF')].filter(Boolean).join(', ');
  const time = act.activation ? `${act.activation.cost ?? 1} ${titleCase(act.activation.type || '')}`.replace(/^1 (Standard|Swift|Immediate|Move|Free|Full)$/, '1 $1 action').trim() : '';
  const school = [SCHOOLS[s.school] ?? titleCase(s.school || ''), s.subschool && `(${[].concat(s.subschool).join(', ')})`].filter(Boolean).join(' ');
  return [
    // The reader knows a spell by this line, so it is always written: a spell
    // on nobody's list is still a spell, which is what "Unlisted" says.
    ['Spell level', levels(lists.class) || 'Unlisted'],
    ['Domains', levels(lists.domain)],
    ['Subdomains', levels(lists.subDomain)],
    ['Bloodlines', levels(lists.bloodline)],
    ['School', school],
    ['Descriptors', [].concat(s.descriptors?.value ?? s.descriptors ?? []).map(titleCase).join(', ')],
    ['Components', comps],
    ['Casting time', time],
    ['Range', measure(act.range, RANGE)],
    ['Target', oneLine(act.target?.value)],
    ['Area', oneLine(act.area)],
    ['Effect', oneLine(act.effect)],
    ['Duration', [measure(act.duration, DURATION), act.duration?.dismiss && '(D)'].filter(Boolean).join(' ')],
    ['Saving throw', oneLine(act.save?.description) || (act.save?.type ? titleCase(act.save.type) : '')],
    // Only a "no" is stored; resistance applying is the schema's default.
    ['Spell resistance', s.sr === false ? 'No' : 'Yes'],
  ];
}

/** What a compendium's entries are, to the general catalogue. */
const ENTRY_KIND = {
  classes: 'class', 'class-abilities': 'class feature', races: 'race', 'racial-hd': 'racial hit dice',
  'mythic-paths': 'mythic path', 'monster-templates': 'monster template', 'monster-abilities': 'monster ability',
  'template-abilities': 'template ability', 'companion-features': 'companion feature', buffs: 'buff',
  items: 'equipment', 'ultimate-equipment': 'magic item', technology: 'technological item',
  'weapons-and-ammo': 'weapon', 'armors-and-shields': 'armor', rules: 'rule',
};
/** Compendiums that are the system's own furniture, not anybody's book. */
const NOT_CONTENT = new Set(['macros', 'roll-tables', 'basic-monsters', 'skills-core', 'skills-background', 'skills-consolidated']);

function entryDoc(d, pack, sources) {
  const s = d.system ?? {};
  const lines = [`#### ${d.name}`];
  const put = (k, v) => { if (v) lines.push(`* **${k}:** ${String(v).replace(/\s+/g, ' ').trim()}`); };
  let body = prose(s.description?.value);

  if (d.type === 'spell') {
    for (const [k, v] of spellFields(d)) put(k, v);
  } else if (d.type === 'feat' && s.subType === 'feat') {
    put('Feat type', [].concat(s.tags ?? []).join(', ') || 'Feat');
    // A prerequisite is a field wherever a book prints it; here it is the
    // first bold run of the description, and is lifted out the same way.
    const pre = body.match(/^\*\*Prerequisites?\*\*:?[ \t]*(.+)$/m);
    if (pre) { put('Prerequisites', pre[1].replace(/\*+/g, '')); body = body.replace(pre[0], '').replace(/\n{3,}/g, '\n\n').trim(); }
  } else {
    const kind = d.type === 'class' && s.subType === 'prestige' ? 'prestige class' : ENTRY_KIND[pack] ?? d.type;
    const classes = (s.associations?.classes ?? []).map((c) => (Array.isArray(c) ? c[0] : c)).filter(Boolean).join(', ');
    put('Class', classes);
    put('Ability type', { ex: 'Extraordinary', su: 'Supernatural', sp: 'Spell-like' }[s.abilityType]);
    if (d.type === 'class') { put('Hit Die', s.hd && `d${s.hd}`); put('Base attack bonus', titleCase(s.bab || '')); put('Skill ranks', s.skillsPerLevel); }
    put('Price', s.price ? `${s.price} gp` : '');
    put('Weight', s.weight?.value ? `${s.weight.value} lbs.` : '');
    put('Caster level', s.cl);
    put('Aura', s.aura?.school && (SCHOOLS[s.aura.school] ?? s.aura.school));
    put('Entry kind', kind);
  }
  const src = sources.map((x) => [bookOf(x), x.pages && `p. ${x.pages}`].filter(Boolean).join(' ')).filter(Boolean);
  put('Source', src.join('; '));
  const summary = oneLine(s.description?.summary);
  if (summary) lines.push('', `**Summary:** *${summary}*`);
  if (body) lines.push('', body);
  return lines.join('\n');
}

/* ---------------- reading ---------------- */

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
const plural = (s) => titleCase(/[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/.test(s) ? `${s}es` : `${s}s`);

/*
 * More than half the class features name no source -- a rage power is filed
 * under Barbarian and left at that. The class it is written for does name
 * one, so a feature with nothing of its own is put in its class's book: not
 * certain for a power printed later, but far nearer than "Unsourced", and
 * only ever used when the entry says nothing itself.
 */
const classSources = new Map();
for (const file of existsSync(join(checkout, 'packs/classes')) ? walk(join(checkout, 'packs/classes')).filter((f) => f.endsWith('.yaml')) : []) {
  const d = yaml.load(readFileSync(file, 'utf8'));
  if (d?.type === 'class' && d.system?.sources?.length) classSources.set(d.name.toLowerCase(), d.system.sources.slice(0, 1).map((x) => ({ id: x.id, title: x.title })));
}
let inherited = 0;
const sourcesOf = (d) => {
  if (d.system.sources?.length) return d.system.sources;
  for (const c of d.system.associations?.classes ?? []) {
    const hit = classSources.get(String(Array.isArray(c) ? c[0] : c).toLowerCase());
    if (hit) { inherited++; return hit; }
  }
  return [];
};

const groups = new Map();
let read = 0;
let unsourced = 0;
let reprinted = 0;
const packNames = readdirSync(join(checkout, 'packs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
for (const pack of packNames) {
  if (NOT_CONTENT.has(pack) || (onlyPacks && !onlyPacks.has(pack))) continue;
  for (const file of walk(join(checkout, 'packs', pack)).filter((f) => f.endsWith('.yaml'))) {
    const d = yaml.load(readFileSync(file, 'utf8'));
    // A folder is a record too, and has no rules in it.
    if (!d?.name || !d.system || d.type === 'Item' || !d.type) continue;
    read++;
    const kind = d.type === 'spell' ? 'spell' : d.type === 'feat' && d.system.subType === 'feat' ? 'feat' : ENTRY_KIND[pack] ?? d.type;
    const sources = sourcesOf(d);
    const books = [...new Set(sources.map(bookOf).filter(Boolean))];
    if (!books.length) { books.push('Unsourced'); unsourced++; }
    if (books.length > 1) reprinted++;
    for (const dir of by === 'book' ? books : ['']) {
      const key = `${dir}\n${kind}`;
      if (!groups.has(key)) groups.set(key, { dir, kind, docs: [] });
      groups.get(key).docs.push({ name: d.name, text: entryDoc(d, pack, sources) });
    }
  }
}

/* ---------------- writing ---------------- */

const dirs = new Map();
const slugs = new Set();
let wrote = 0;
let bytes = 0;
for (const { dir, kind, docs } of groups.values()) {
  docs.sort((a, b) => a.name.localeCompare(b.name));
  if (dir && !dirs.has(dir)) {
    let s = slug(dir);
    for (let n = 2; slugs.has(s); n++) s = `${slug(dir)}-${n}`;
    slugs.add(s);
    dirs.set(dir, { slug: s, entries: 0 });
    if (!dry) {
      mkdirSync(join(out, s), { recursive: true });
      writeFileSync(join(out, s, '_name'), dir, 'utf8');
      // Who published it is not in an entry; it is said once, on the command line.
      if (author && dir !== 'Unsourced') writeFileSync(join(out, s, '_author'), author, 'utf8');
    }
  }
  const folder = dir ? join(out ?? '', dirs.get(dir).slug) : out;
  const text = `# ${plural(kind)}\n\n${docs.map((x) => x.text).join('\n\n')}\n`;
  if (!dry) { mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, `${slug(plural(kind))}.md`), text, 'utf8'); }
  if (dir) dirs.get(dir).entries += docs.length;
  wrote++;
  bytes += Buffer.byteLength(text);
}

console.log(`${read} entries read, ${wrote} document(s) ${dry ? 'would be written' : `written to ${out}`}, ${(bytes / 1048576).toFixed(1)} MB`);
if (by === 'book') {
  const rows = [...dirs].sort((a, b) => b[1].entries - a[1].entries);
  for (const [name, d] of rows.slice(0, 25)) console.log(`  ${String(d.entries).padStart(5)}  ${name}`);
  if (rows.length > 25) console.log(`  … and ${rows.length - 25} more books`);
  console.log(`\n${dirs.size} books; ${reprinted} entries are printed in more than one and were written into each; ${inherited} class features took their class's book; ${unsourced} name no source.`);
}
