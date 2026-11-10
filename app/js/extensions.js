/**
 * Extensions: content the engine does not carry.
 *
 * The sheet itself knows rules -- how a save is built, what a level rule means,
 * how a tracker's formula is evaluated. It does not know the names of anyone's
 * classes, disciplines, races or feats: those are content, and content arrives
 * in **extension packs**. A pack is one JSON document a player writes, imports
 * from a friend, or gets bundled with a deployment, and it can carry two kinds
 * of thing:
 *
 *  - **tables** the whole app reads: a discipline catalogue, casting and
 *    manifesting tables, deck manipulations, cooking ingredients. Every enabled
 *    pack's tables are merged and registered with the model at load, which is
 *    how the sheet's Maneuvers tab knows what a discipline offers without the
 *    engine shipping a single maneuver name.
 *  - **blocks** a player attaches to one character: a class, a race, a race
 *    trait, a feature or a whole feature group, a resource tracker, a note.
 *    Attaching copies the block into the character, so an exported character is
 *    still self-contained and needs no pack to open.
 *
 * Bundled packs come from an `index.json` in `data/extensions/` (what the
 * repository ships, exactly as `data/characters/index.json` lists characters --
 * and the published engine ships neither) or in `private/extensions/`, the
 * folder git ignores.
 *
 * TODO (1.0): `data/extensions/` ships empty. What is in it today is four
 * packs of pure structure -- disciplines, casting and manifesting tables,
 * ingredients: names, levels and numbers, and no rules text in any of them,
 * which `tests/extensions.test.mjs` checks rather than trusts. Structure is
 * still somebody's table, so at a release they move to `private/extensions/`
 * and are handed out as files, legibly, to whoever owns the book. See
 * `docs/todo.md`; the two packs that carried actual prose went that way on
 * 2026-09-02 and are the worked example. Either way they are fetched into memory and never
 * stored. Local packs -- the ones a player imports -- are stored, in this
 * browser only: IndexedDB where there is one and localStorage where there is
 * not (see `pack-storage.js`), alongside the imported characters.
 *
 * Nothing in here touches the DOM: the manager UI and the sheet element both
 * call this module, and the tests call it with a fake storage.
 */

import { storageMedium } from './pack-storage.js';
// Straight from the subsystem rather than through `model.js`: `applyBlock`
// needs to know whether the veil catalogue can speak for a veil, and nothing
// else here wants the model. Narrow on purpose -- akashic.js imports nothing
// from this file, so there is no cycle to think about.
import { veilEntry } from './model/subsystems/akashic.js';
import { talentKey } from './model/spheres.js';
import { asOneUndo } from './model/undo.js';
import { blankClassRow } from './model/document.js';
import { PACKAGE_POWERS, readPackageSentence } from './package-text.js';
import { levelRuleGrants, levelRuleLevels } from './rules.js';
import { ordinal, swapAt, swapBase, swapLevel, swapsMeet, swapLabel, swapKey } from './swaps.js';

export const EXTENSION_FORMAT = 'character-sheet-extension';
export const EXTENSION_VERSION = 1;

const COOKING_LISTS = ['entrees', 'flavors', 'sides', 'aroma', 'garnish'];

/**
 * The shared tables a pack can provide, said once: the key under `provides`,
 * the merged table's empty shape, how many entries a pack's copy counts as,
 * what one entry is called, and the model setter it is registered with.
 * TABLE_KINDS, the pack summary, mergeTables' starting point, registerTables
 * and the runtime's setters all read this, so a new table kind is one row.
 * How two packs' copies of a kind are joined stays in mergeTables, where each
 * rule is explained.
 */
export const TABLES = [
  { kind: 'maneuvers', empty: () => ({ disciplines: [] }), count: (t) => arr(t.disciplines).length, words: ['discipline', 'disciplines'], setter: 'setManeuverCatalogue' },
  { kind: 'spheres', empty: () => ({ spheres: [] }), count: (t) => arr(t.spheres).length, words: ['sphere', 'spheres'], setter: 'setSphereCatalogue' },
  { kind: 'veils', empty: () => ({ veils: [] }), count: (t) => arr(t.veils).length, words: ['veil', 'veils'], setter: 'setVeilCatalogue' },
  { kind: 'feats', empty: () => ({ feats: [] }), count: (t) => arr(t.feats).length, words: ['feat', 'feats'], setter: 'setFeatCatalogue' },
  { kind: 'spells', empty: () => ({ spells: [] }), count: (t) => arr(t.spells).length, words: ['spell', 'spells'], setter: 'setSpellCatalogue' },
  { kind: 'powers', empty: () => ({ powers: [] }), count: (t) => arr(t.powers).length, words: ['power', 'powers'], setter: 'setPowerCatalogue' },
  { kind: 'catalogues', empty: () => ({ catalogues: [] }), count: (t) => arr(t.catalogues).reduce((n, g) => n + arr(g?.entries).length, 0), words: ['reference entry', 'reference entries'], setter: 'setReferenceCatalogue' },
  { kind: 'vancian', empty: () => ({ spellLevels: null, classes: [] }), count: (t) => arr(t.classes).length, words: ['casting table', 'casting tables'], setter: 'setVancianTables' },
  { kind: 'psionics', empty: () => ({ powerLevels: null, curves: [], classes: [] }), count: (t) => arr(t.curves).length + arr(t.classes).length, words: ['manifesting table', 'manifesting tables'], setter: 'setPsionicTables' },
  { kind: 'cardcasting', empty: () => ({ manipulations: [] }), count: (t) => arr(t.manipulations).length, words: ['deck manipulation', 'deck manipulations'], setter: 'setCardcastingTables' },
  { kind: 'cooking', empty: () => ({ durationHours: null, ...Object.fromEntries(COOKING_LISTS.map((k) => [k, []])) }), count: (t) => COOKING_LISTS.reduce((n, k) => n + arr(t[k]).length, 0), words: ['ingredient', 'ingredients'], setter: 'setCookingTables' },
  { kind: 'altTraining', empty: () => ({ levels: null, repeatFrom: null, techniques: [], links: {} }), count: (t) => arr(t.techniques).length, words: ['training technique', 'training techniques'], setter: 'setAltTrainingTables' },
];

/** The keys a pack can carry under `provides`. */
export const TABLE_KINDS = TABLES.map((t) => t.kind);

/** What each block kind is called on a picker, and what it lands on the sheet as. */
export const BLOCK_KINDS = {
  class: { label: 'Class', lands: 'Classes table (Overview) and its feature column (Progression)' },
  race: { label: 'Race', lands: 'Race, size and race traits (Overview); racial ability modifiers (Stats)' },
  trait: { label: 'Race trait', lands: 'Race traits (Overview)' },
  feature: { label: 'Feature', lands: 'A feature in a template group (Template tab)' },
  template: { label: 'Feature group', lands: 'A template with its features (Template tab)' },
  tracker: { label: 'Tracker', lands: 'Trackers tab' },
  veil: { label: 'Veil', lands: 'Its chakra slot on the Akashic tab (shaped, essence 0)' },
  archetype: { label: 'Archetype', lands: 'Its class. Replaced features are removed from the Progression tab and Template group, and the new ones are added. The pill on the class row removes the archetype' },
  options: { label: 'Option menu', lands: 'The class feature it names on the Progression tab, as a menu of choices, and its own Template group' },
  package: { label: 'Archetype package', lands: 'Swapped for one of a class\'s own packages on the Progression tab, when the campaign allows archetype packages' },
  note: { label: 'Note', lands: 'Extras & Notes' },
};

/* ---------------- storage keys ---------------- */

export const EXTENSIONS_KEY = 'character-sheet:extensions';
export const extensionKey = (id) => `character-sheet:ext:${id}`;

/* ---------------- helpers ---------------- */

const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v, fallback = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const lower = (s) => str(s).trim().toLowerCase();

/**
 * One of a talent track's two counting rules, however a pack writes it:
 * `{start, gainsAt}` in full, a bare number for a count that never moves, or a
 * bare string for the levels it goes up at from one.
 */
/**
 * A talent-track spec as a pack writes it. A class block states the whole
 * thing; an archetype block states only the parts it changes, and those are
 * merged over the class's when it is added.
 *
 * `spheres` is passed through as written (combat / magic / both -- the sides
 * in rules.js); the model is what settles an unknown one, the same way it
 * settles an unknown `systems` tag, so this layer stays free of the vocabulary.
 */
const trackSpec = (v) => {
  const t = obj(v);
  const out = {};
  if (str(t.name).trim()) out.name = str(t.name).trim();
  if (str(t.unit).trim()) out.unit = str(t.unit).trim();
  if ('sets' in t) out.sets = countRule(t.sets);
  if ('talents' in t) out.talents = countRule(t.talents);
  if (lower(t.spheres)) out.spheres = lower(t.spheres);
  if (str(t.text)) out.text = str(t.text);
  return Object.keys(out).length ? out : null;
};

const countRule = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { start: num(v, 1), gainsAt: '' };
  if (typeof v === 'string') return { start: 1, gainsAt: str(v).trim() };
  const o = obj(v);
  return { start: num(o.start, 1), gainsAt: str(o.gainsAt).trim() };
};

/** A stable id from a name: letters, digits and dashes, or '' when there is nothing usable. */
export function slugId(s) {
  return str(s).toLowerCase().normalize('NFKD')
    .replace(/\p{M}/gu, '')            // combining marks left by NFKD: é -> e
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/* ---------------- normalising a document ---------------- */

/** The numbers a class block sets on a class row. */
const CLASS_ROW_STATS = ['hd', 'bab', 'goodFort', 'goodRef', 'goodWill', 'skillRanks'];

/** One block, in its canonical shape; null when it is not a block at all. */
export function normalizeBlock(block) {
  const b = obj(block);
  const kind = lower(b.kind);
  if (!BLOCK_KINDS[kind]) return null;
  // `group` is on every kind, not just features: it is what a pack calls the
  // supergroup a block belongs to, and the blocks panel folds by it. A note
  // that belongs to a class has no other way to say so -- it carries no class
  // field -- so without this it can only ever sit loose in its pack.
  const base = {
    kind, name: str(b.name).trim(), text: str(b.text), source: str(b.source),
    group: str(b.group).trim(),
  };
  switch (kind) {
    case 'class':
      return {
        ...base,
        hd: num(b.hd, 8),
        bab: [1, 0.75, 0.5].includes(Number(b.bab)) ? Number(b.bab) : babFromText(b.bab),
        goodFort: bool(b.goodFort), goodRef: bool(b.goodRef), goodWill: bool(b.goodWill),
        skillRanks: num(b.skillRanks, 2),
        classSkills: arr(b.classSkills).map(str).filter(Boolean),
        // Sub-systems the class plays with (GAME_SYSTEMS ids in rules.js);
        // unknown ids are kept -- they still read as tags on the class row.
        systems: arr(b.systems).map(lower).filter(Boolean),
        archetypes: str(b.archetypes),
        // A class whose talents arrive on several tracks at once, one of them
        // live -- the armiger's customized weapons. Two counting rules, said
        // the way the class table says them.
        tracks: trackSpec(b.tracks),
        features: arr(b.features).map((f) => ({
          level: Math.max(1, Math.min(20, num(f?.level, 1))),
          name: str(f?.name).trim(),
          text: str(f?.text),
        })).filter((f) => f.name),
        // Numbers a class read from a catalogue entry did not state (see
        // classBlockFromEntry): adding it over a class row leaves those be.
        ...(arr(b.unstated).length ? { unstated: arr(b.unstated).filter((k) => CLASS_ROW_STATS.includes(k)) } : {}),
      };
    case 'race':
      return {
        ...base,
        size: str(b.size),
        speed: b.speed === null || b.speed === undefined || b.speed === '' ? null : num(b.speed),
        abilityMods: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha']
          .map((k) => [k, num(obj(b.abilityMods)[k])]).filter(([, v]) => v !== 0)),
        traits: arr(b.traits).map((t) => ({ name: str(t?.name).trim(), text: str(t?.text) })).filter((t) => t.name),
        languages: arr(b.languages).map(str).filter(Boolean),
      };
    case 'trait': {
      // What an alternate racial trait replaces: given outright, else read
      // off its own text ("This racial trait replaces hatred and greed.").
      const given = arr(b.replaces).map((s) => str(s).trim()).filter(Boolean);
      return { ...base, race: str(b.race).trim(), replaces: given.length ? given : parseReplaces(base.text) };
    }
    case 'feature':
      return { ...base, type: featureType(b.type) };
    case 'template':
      return {
        ...base,
        features: arr(b.features).map((f) => ({
          name: str(f?.name).trim(), type: featureType(f?.type), text: str(f?.text),
        })).filter((f) => f.name),
      };
    case 'tracker':
      return {
        ...base,
        maxFormula: str(b.maxFormula ?? b.max),
        minFormula: b.minFormula === null || b.minFormula === undefined || b.minFormula === '' ? null : str(b.minFormula),
        refresh: str(b.refresh),
        style: b.style && typeof b.style === 'object' ? structuredClone(b.style) : null,
      };
    case 'veil':
      return { ...base, slot: str(b.slot ?? b.chakra).trim(), descriptor: str(b.descriptor).trim() };
    case 'package': {
      // A named set of a class's features (`includes`, a single grant as
      // "name@level"), or, with no class, a set of features of its own; and
      // the powers it grants. Both read off its sentence unless given.
      const className = str(b.class ?? b.className).trim();
      const read = readPackageSentence(base.text, className);
      const includes = arr(b.includes).map((s) => str(s).trim()).filter(Boolean);
      const grants = arr(b.grants).map(lower).filter((g) => PACKAGE_POWERS.includes(g));
      return {
        ...base,
        class: className,
        includes: includes.length ? includes : read.includes,
        grants: grants.length ? grants : read.grants,
        features: arr(b.features).map((f) => ({
          name: str(f?.name).trim(),
          type: featureType(f?.type),
          level: Math.max(1, Math.min(20, num(f?.level, 1))),
          text: str(f?.text),
        })).filter((f) => f.name),
      };
    }
    case 'archetype': {
      const className = str(b.class ?? b.className).trim();
      // A package swap (packages.js) states its swaps outright: the features
      // it brings are another class's, whose text says nothing about this one.
      const swap = b.package && typeof b.package === 'object' ? structuredClone(b.package) : null;
      const features = arr(b.features).map((f) => {
        const text = str(f?.text);
        const swaps = swap ? { replaces: [], alters: [] } : parseSwaps(text, className);
        // a swap a pack states outright, with the level it names kept on it
        const given = (k) => arr(f?.[k])
          .map((s) => swapAt(swapKey(swapBase(s), className), swapLevel(s)))
          .filter(Boolean);
        return {
          name: str(f?.name).trim(),
          type: featureType(f?.type),
          level: f?.level === null || f?.level === undefined || f?.level === '' ? levelInText(text) : Math.max(1, Math.min(20, num(f.level, 1))),
          text,
          replaces: given('replaces').length ? given('replaces') : swaps.replaces,
          alters: given('alters').length ? given('alters') : swaps.alters,
          // a menu the player picks from (talents, techniques…), and its notes
          options: normalizeOptions(f?.options, str(f?.name)),
          optionsInfo: str(f?.optionsInfo),
        };
      }).filter((f) => f.name);
      const stacks = arr(b.stacksWith).map((s) => str(s).trim()).filter(Boolean);
      return {
        ...base,
        class: className,
        single: bool(b.single),
        // What the archetype changes about its class's talent track. The
        // armiger's customized weapons teach martial spheres; the archetype
        // that lets them teach magical ones carries
        // `"tracks": {"spheres": "both"}` and nothing else, because that is
        // the whole of what it does to them.
        tracks: trackSpec(b.tracks),
        features,
        stacksWith: stacks.length || swap ? stacks : parseStacksWith(features.map((f) => f.text).join('\n')),
        ...(swap ? { package: swap } : {}),
      };
    }
    case 'options':
      // A menu on a page of its own -- rogue talents, iaijutsu techniques --
      // naming the class feature whose cells pick from it.
      return {
        ...base,
        class: str(b.class ?? b.className).trim(),
        feature: str(b.feature).trim(),
        options: normalizeOptions(b.options, str(b.feature) || str(b.name)),
      };
    case 'note':
      return { ...base, name: base.name || str(b.title).trim(), text: base.text || str(b.body) };
    default:
      return null;
  }
}

/* ---------------- repeat features as their own column ---------------- */

/** Two rows name the same feature when only the number it scales by differs. */
const columnKey = (s) => featureKey(String(s ?? '').replace(/\s*[+\-–]?\s*\d+d\d+\s*$/i, ''));
/** The column's title: the feature's name with that number taken off. */
const columnName = (s) => str(s).replace(/\s*[+\-–]?\s*\d+d\d+\s*$/i, '')
  .replace(/\s*[+\-–]\s*\d+\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();

/**
 * A level list as a rule the player can read and edit.
 *
 * An arithmetic run that carries on to 20th is written the way a book writes
 * it -- "2, +2", "1, +5" -- and anything else as the levels themselves, which
 * the rule language takes literally. Nothing is inferred: a list that is not
 * a clean run comes back exactly as it is.
 */
export function ruleForLevels(levels, max = 20) {
  const ls = [...new Set(levels.map(Number))].filter((l) => l >= 1 && l <= max).sort((a, b) => a - b);
  if (!ls.length) return '';
  if (ls.length === 1) return String(ls[0]);
  const step = ls[1] - ls[0];
  const even = ls.every((l, i) => i === 0 || l - ls[i - 1] === step);
  // "2, +2" runs to the top of the table, so it may only stand for a list
  // that does too -- otherwise the rule would grant levels the class does not.
  return even && ls[ls.length - 1] + step > max ? `${ls[0]}, +${step}` : ls.join(', ');
}

/**
 * The features a class names at more than one level, as columns.
 *
 * Each comes back with the levels it lands on written as a rule, and what to
 * put in each cell: a ladder whose name changes as it grows ("Thunderous blows
 * +1d6", "+2d6") writes the part that changed, while a menu named the same way
 * every time ("Prowess", "Smithing insight") writes nothing at all -- those
 * cells are the choices still to make, which is what the column's badge counts.
 */
export function repeatColumns(features) {
  const groups = new Map();
  for (const f of arr(features)) {
    const key = columnKey(f?.name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const out = [];
  for (const list of groups.values()) {
    const levels = [...new Set(list.map((f) => f.level))];
    if (levels.length < 2) continue;
    // A table writes the first entry of a cell capitalised and the rest not,
    // so the best-cased spelling names the column.
    const titled = list.find((f) => /^[A-Z]/.test(str(f.name).trim())) || list[0];
    const name = columnName(titled.name) || str(titled.name);
    const ladder = new Set(list.map((f) => lower(f.name))).size > 1;
    out.push({
      name,
      rule: ruleForLevels(levels),
      at: list.map((f) => ({
        feature: f,
        // the part the name added to the column's own title, else nothing
        text: ladder
          ? (lower(f.name).startsWith(lower(name)) ? str(f.name).slice(name.length).trim() : str(f.name)) || str(f.name)
          : '',
      })),
    });
  }
  return out;
}

/**
 * The tails of a menu's name as patterns, longest first, for
 * `parseOptionReplaces`. Built once per name rather than once per option.
 */
const MENU_TAILS = new Map();
function menuTails(feature) {
  const name = str(feature).trim();
  if (!MENU_TAILS.has(name)) {
    const words = name.split(/\s+/).filter(Boolean);
    MENU_TAILS.set(name, words.map((_, i) => words.slice(i).join(' ')).filter((s) => s.length > 2).map((tail) => {
      // singular or plural, since one sentence writes "Techniques" and the next "Technique"
      const stem = tail.replace(/s$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\s+${stem}s?$`, 'i');
    }));
  }
  return MENU_TAILS.get(name);
}

/**
 * Which entries of the menu it joins an option pushes out, read off its own
 * text: "This replaces the Ranged Cut and Armor Rending Slash Iaijutsu
 * Techniques." The kind-word at the end is the menu's own name, which every
 * such sentence repeats, so the longest tail of `feature` the sentence ends
 * with comes off -- leaving the entries themselves.
 */
export function parseOptionReplaces(text, feature = '') {
  // Most entries say nothing of the kind, and this check is far cheaper than the pattern below.
  if (!/replace/i.test(str(text))) return [];
  const tails = menuTails(feature);
  const out = [];
  for (const m of str(text).matchAll(/\breplace[sd]?\s+(?:the\s+)?([^.;]+?)(?=[.;]|$)/gi)) {
    let list = m[1].trim();
    for (const re of tails) {
      if (re.test(list)) { list = list.replace(re, ''); break; }
    }
    for (const s of list.replace(/\s*,?\s+(?:and|or)\s+/gi, ', ').split(/,\s*/)) {
      const name = s.trim().replace(/^the\s+/i, '');
      if (name && name.length < 60 && !out.some((x) => lower(x) === lower(name))) out.push(name);
    }
  }
  return out;
}

/**
 * A menu's entries, wherever they hang: on a class feature, on an archetype's
 * feature, or on a block of their own. `feature` names what the menu is for,
 * which is what lets an entry's "this replaces…" sentence be read.
 */
export function normalizeOptions(v, feature = '') {
  return arr(v).map((o) => {
    const text = str(o?.text);
    const given = arr(o?.replaces).map((s) => str(s).trim()).filter(Boolean);
    return {
      name: str(o?.name).trim(),
      type: featureType(o?.type),
      category: str(o?.category).trim(),
      text,
      source: str(o?.source).trim(),
      minLevel: o?.minLevel === null || o?.minLevel === undefined || o?.minLevel === '' ? null : Math.max(1, Math.min(20, num(o.minLevel, 1))),
      replaces: given.length ? given : parseOptionReplaces(text, feature),
    };
  }).filter((o) => o.name);
}

/**
 * "Trap Sense +1", "trap sense", "Trap Sense (Ex)" and "Kiai Arts" / "kiai art"
 * are one feature. Used to pair a progression table's names with the prose
 * below it, and to tell which of a class's features repeat.
 */
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

/**
 * The traits an alternate racial trait replaces, read off its text:
 *   "This racial trait replaces hatred."
 *   "This replaces defensive training and hatred."
 *   "This racial trait replaces greed, hatred, stonecunning, and weapon familiarity."
 *   "Dwarves can take this trait in place of stonecunning."
 *   "This racial trait replaces the hatred racial trait."
 * Names come back as written, lower-cased, without "the" or "racial trait".
 */
export function parseReplaces(text) {
  const out = [];
  const re = /\b(?:replace[sd]?|in place of)\s+(?:the\s+)?([^.;]+?)(?:\s+racial traits?)?(?=[.;]|$)/gi;
  for (const m of str(text).matchAll(re)) {
    const list = m[1]
      .replace(/\s+racial traits?/gi, '')
      .replace(/\s*,?\s+(?:and|or)\s+/gi, ', ')
      .split(/,\s*/)
      .map((s) => s.trim().replace(/^the\s+/i, ''))
      .filter((s) => s && s.length < 60);
    for (const s of list) if (!out.includes(s.toLowerCase())) out.push(s.toLowerCase());
  }
  return out;
}

/* ---------------- archetypes: what a feature swaps ---------------- */

// The keys a swap is matched by live in swaps.js, where the companion sums can
// reach them too; they are still exported from here for every reader that
// already finds them here.
export { ordinal, swapAt, swapBase, swapLevel, swapsMeet, swapLabel, swapKey };

/**
 * What an archetype feature does to the class, read off its own text:
 *   "This ability replaces challenge and kiai arts."
 *   "This ability alters resolve."   "This modifies proficiencies."
 *   "This alters a legendary samurai's normal weapon and armor proficiencies."
 *   "This ability replaces the determined ability of the resolve class feature."
 *   "This ability replaces the duty's call kiai art."
 * A sub-ability being replaced ("the determined ability of resolve", "the
 * duty's call kiai art") means the parent feature is altered, not gone.
 */
export function parseSwaps(text, className = '') {
  const replaces = [];
  const alters = [];
  const push = (list, k) => { if (k && k.length <= 50 && !list.includes(k)) list.push(k); };
  // "This ability replaces X." / "This alters X" (a line with no full stop) /
  // "Topological Draw alters Iaijutsu Techniques." / "Topological Step: Projection replaces Dragon Defense."
  // The sentence may be in italics or bold ("*This replaces trapfinding.*"),
  // so emphasis marks may open and close it.
  const re = /(?:^|[.\n]\s*)(?:(?:\*+|_+|'{2,3})\s*)?(?:This (?:ability |alteration |feature |alternative class feature |option )?|[A-Z][^.\n:]{0,40}?(?::\s+[A-Z][^.\n]{0,40}?)?\s+)(replaces|alters|modifies|changes)\s+([^.\n]+?)(?:\*+|_+|'{2,3})?(?:\.|\n|$)/g;
  // a named sub-ability -- "the duty's call kiai art", "the Ranged Cut and Armor Rending Slash Iaijutsu Techniques":
  // definite ("the …"), so not "challenge and kiai arts"
  const SUB = /^the\s+.+?\s+(kiai art|iaijutsu technique|rage power|deed|talent|discovery|hex|revelation|exploit)s?$/i;
  const BARE = /^(?:the\s+)?(?:kiai arts?|iaijutsu techniques?|rage powers?|deeds?|talents?|discover(?:y|ies)|hexe?s?|revelations?|exploits?)$/i;
  for (const m of str(text).matchAll(re)) {
    const verb = m[1].toLowerCase();
    // "If successful, the poison's type changes to contact" says what a thing
    // becomes, not which feature is given up.
    if (/^(?:to|into)\s/i.test(m[2].trim())) continue;
    let list = m[2].trim()
      // "…alters Spirit and counts as such for items, class features, and feats"
      .replace(/\s+and\s+counts?\s+as\s+.*$/i, '')
      .replace(/\s+for (?:the purposes? of|items|feats)\b.*$/i, '');
    // "the X ability of the Y class feature" -> Y, altered
    const sub = list.match(/^(?:the\s+)?(.+?)\s+abilit(?:y|ies)\s+of\s+(?:the\s+)?(.+?)\s+class features?$/i);
    if (sub) { push(alters, swapKey(sub[2], className)); continue; }
    // "the 10th and 14th level Warrior's grace" -- not the feature, but the
    // grants it names. Each level is its own thing to swap, so two archetypes
    // taking different ones of the same feature can stand together.
    const partial = list.match(/^(?:the\s+)?((?:\d{1,2}(?:st|nd|rd|th))(?:\s*(?:,|and|&)\s*\d{1,2}(?:st|nd|rd|th))*)[- ]level\s+(.+)$/i);
    if (partial) {
      const key = swapKey(partial[2], className);
      const at = [...partial[1].matchAll(/(\d{1,2})(?:st|nd|rd|th)/gi)].map((x) => Number(x[1]));
      for (const l of at) push(verb === 'replaces' ? replaces : alters, swapAt(key, l));
      continue;
    }
    // The same written the other way round: "the rogue talents gained at 2nd
    // and 6th levels", "the bonus feat gained at 1st level".
    const gained = list.match(/^(?:the\s+)?(.+?)\s+(?:gained|granted|received|obtained)\s+at\s+((?:\d{1,2}(?:st|nd|rd|th))(?:\s*(?:,|and|&)\s*(?:and\s+)?\d{1,2}(?:st|nd|rd|th))*)(?:\s+levels?)?$/i);
    if (gained) {
      const key = swapKey(gained[1], className);
      for (const x of gained[2].matchAll(/(\d{1,2})(?:st|nd|rd|th)/gi)) push(verb === 'replaces' ? replaces : alters, swapAt(key, Number(x[1])));
      continue;
    }
    // "the duty's call, charm kiai art" -> kiai art, altered: one named sub-ability, commas and all
    const named = list.match(SUB);
    if (named && verb === 'replaces' && !BARE.test(list)) { push(alters, swapKey(named[1], className)); continue; }
    // "weapon and armor proficiencies" is one thing, whatever the "and"
    if (/proficienc/i.test(list) && !/,/.test(list)) { push(verb === 'replaces' ? replaces : alters, 'weapon and armor proficiency'); continue; }
    const parts = list.replace(/\s*,?\s+(?:and|or)\s+/gi, ', ').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    // "armor training 1, 2, 3, and 4" is every step of one feature: the
    // feature, once, rather than a key per bare number.
    const steps = [];
    let series = false;
    for (const p of parts) {
      const bare = /^\d+$/.test(p);
      if (bare && steps.length && (series || /\s\d+$/.test(steps[steps.length - 1]))) {
        steps[steps.length - 1] = steps[steps.length - 1].replace(/\s\d+$/, '');
        series = true;
        continue;
      }
      series = false;
      steps.push(p);
    }
    for (const p of steps) push(verb === 'replaces' ? replaces : alters, swapKey(p, className));
  }
  return { replaces, alters };
}

/** "…can be combined with either the Yumi Sniper archetype or the Skirmisher's Strike alternative class feature" -> those names. */
export function parseStacksWith(text) {
  const out = [];
  for (const m of str(text).matchAll(/can be combined with (?:either )?(?:the )?([^.]+?)(?:,? in which case|\.|$)/gi)) {
    for (const p of m[1].split(/\s*(?:,|\bor\b|\band\b)\s*/)) {
      const n = p.replace(/\s*\(but not both\)\s*/i, ' ').trim().replace(/^(?:either|the)\s+/i, '')
        .replace(/\s+(?:archetype|alternative class feature|alternate class feature|option)$/i, '').trim();
      if (n && !/^both$/i.test(n) && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

const levelInText = (t) => Number(str(t).match(/(?:^|[.:;]\s+|\n)(?:At|Starting at|At the|Beginning at)\s+(\d{1,2})(?:st|nd|rd|th) level/i)?.[1]
  || str(t).match(/(?:^|[.:;]\s+|\n)At level (\d{1,2})\b/i)?.[1]
  || str(t).match(/\bof (\d{1,2})(?:st|nd|rd|th) level or higher/i)?.[1]) || 1;

/** Every feature key an archetype touches -- what it replaces and what it alters. */
export function archetypeTouches(block) {
  const set = new Set();
  for (const f of arr(block?.features)) { for (const k of f.replaces || []) set.add(k); for (const k of f.alters || []) set.add(k); }
  return set;
}

/**
 * A name with the ability type written after it, split: "Rage (Ex)" is
 * { name: 'Rage', type: 'Ex' }. The type is read in any case and given as
 * the books write it; a name with none comes back whole, its type ''. Every
 * route that files an option or feature by its type reads it here.
 */
export function splitAbilityType(text) {
  const s = String(text ?? '').trim();
  const m = /^(.*?)\s*\((Ex|Su|Sp)\)$/i.exec(s);
  return m ? { name: m[1].trim(), type: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() } : { name: s, type: '' };
}

/** 'Full' / '3/4' / 'medium' / '1/2' -> the number the Classes table stores. */
export function babFromText(v) {
  const s = lower(v);
  if (/^(1|full|fast|good)$/.test(s)) return 1;
  if (/^(0?\.5|1\/2|half|slow|poor)$/.test(s)) return 0.5;
  return 0.75;
}

const featureType = (t) => {
  const s = str(t).trim().toLowerCase().replace(/[()]/g, '');
  return s === 'ex' ? 'Ex' : s === 'su' ? 'Su' : s === 'sp' ? 'Sp' : null;
};

/**
 * A pack in its canonical shape. Unknown keys under `provides` are kept -- a
 * newer app may know a table this one does not, and a pack should survive a
 * round trip through an older one -- but unknown top-level keys are dropped.
 *
 * `owned` says nothing else holds `doc`, as when it has just come out of
 * `JSON.parse`, so its tables are kept rather than copied. Copying them was
 * over half the time it took to read a large set of stored packs.
 */
export function normalizeExtension(doc, { owned = false } = {}) {
  const d = obj(doc);
  const name = str(d.name).trim();
  const id = slugId(d.id) || slugId(name);
  const provides = {};
  for (const [key, table] of Object.entries(obj(d.provides))) {
    if (table && typeof table === 'object') provides[key] = owned ? table : structuredClone(table);
  }
  return {
    format: EXTENSION_FORMAT,
    formatVersion: EXTENSION_VERSION,
    id,
    name: name || id,
    author: str(d.author).trim(),
    description: str(d.description),
    source: str(d.source).trim(),
    license: str(d.license).trim(),
    revision: Math.max(1, Math.floor(num(d.revision, 1))),
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
    provides,
    blocks: arr(d.blocks).map(normalizeBlock).filter(Boolean),
  };
}

/** Is this JSON an extension pack at all? Cheap, for sniffing a dropped file. */
export function looksLikeExtension(doc) {
  return !!doc && typeof doc === 'object' && doc.format === EXTENSION_FORMAT;
}

/* ---------------- a library: every local pack, as one file ---------------- */

/**
 * A library is the packs a browser holds under "Mine" and which packs are
 * switched on, as one JSON file. Exported from one browser and imported in
 * another (a second machine, the deployed site), it brings the whole set
 * across in one drop, and importing it again later brings only what changed.
 */
export const LIBRARY_FORMAT = 'character-sheet-extension-library';

export function looksLikeLibrary(doc) {
  return !!doc && typeof doc === 'object' && doc.format === LIBRARY_FORMAT;
}

/**
 * Build one. `packs` are the local packs' full documents; `enabled` maps
 * every pack id this browser knows, bundled ones included, to whether it is
 * on; `from` says where it was exported (a host name), for the import notice.
 * `campaignRules` is the campaign rules every character shares, `{ on, rules }`
 * (see shared-rules.js), carried when this browser has any.
 */
export function buildLibrary({ packs = [], enabled = {}, from = '', campaignRules = null } = {}) {
  return {
    format: LIBRARY_FORMAT,
    formatVersion: 1,
    exportedAt: new Date().toISOString().slice(0, 19),
    from: str(from),
    packs: arr(packs).filter(looksLikeExtension).map((p) => normalizeExtension(p)),
    enabled: Object.fromEntries(Object.entries(obj(enabled)).map(([id, on]) => [id, !!on])),
    ...(campaignRules && typeof campaignRules === 'object'
      ? { campaignRules: { on: campaignRules.on === true, rules: structuredClone(obj(campaignRules.rules)) } } : {}),
  };
}

/**
 * Is an imported pack (`summary`, from `inspectExtension`) an older revision
 * than `row`, the stored pack with the same id? An import never replaces a
 * newer revision; the player removes the stored pack first to go back.
 */
export function olderRevision(summary, row) {
  return !!row && num(summary?.revision, 1) < num(row.revision, 1);
}

/** A pack's content with the timestamps the store rewrites on every save left out. */
const packFingerprint = (ext) => {
  const { createdAt, updatedAt, ...rest } = normalizeExtension(ext);
  return JSON.stringify(rest);
};

/**
 * What importing a library would do here, before anything is written.
 *
 * `bundledIds` are the deployment's packs, which a local pack may not shadow;
 * `local` is the store's `list()`; `read(id)` returns a stored pack's document.
 * Each pack in the library lands in one of five lists: `add` (not here),
 * `update` (here, and different), `unchanged` (here, and the same apart from
 * the timestamps), `older` (`{id, doc, why}`: an older revision than the one
 * here, which only a replace stores), `skipped` (not a pack, or a bundled
 * id). A pack listed twice counts once, at its higher revision. `missing`
 * is the local ids the library does not have, which a replace removes.
 * `enabled` is the library's switch map limited to ids this browser will have.
 */
export function planLibrary(lib, { bundledIds = [], local = [], read = () => null } = {}) {
  const plan = { add: [], update: [], unchanged: [], older: [], skipped: [], missing: [], enabled: {} };
  if (!looksLikeLibrary(lib)) return plan;
  const bundled = new Set(arr(bundledIds).map(str));
  const here = new Map(arr(local).map((row) => [row.id, row]));
  const byId = new Map();
  for (const doc of arr(lib.packs)) {
    const verdict = inspectExtension(doc);
    if (!verdict.ok) { plan.skipped.push({ id: str(doc?.id || doc?.name || '?'), why: verdict.error }); continue; }
    const { id, revision } = verdict.summary;
    if (bundled.has(id)) { plan.skipped.push({ id, why: 'the same id as a bundled pack' }); continue; }
    if (byId.has(id) && byId.get(id).revision > revision) continue;
    byId.set(id, { doc, revision });
  }
  for (const [id, { doc, revision }] of byId) {
    const have = here.get(id);
    if (!have) { plan.add.push(doc); continue; }
    if (olderRevision({ revision }, have)) {
      plan.older.push({ id, doc, why: `rev ${revision} is older than rev ${num(have.revision, 1)} in this browser` });
      continue;
    }
    const current = read(id);
    if (current && packFingerprint(current) === packFingerprint(doc)) plan.unchanged.push(id);
    else plan.update.push(doc);
  }
  plan.missing = [...here.keys()].filter((id) => !byId.has(id));
  const willHave = new Set([...bundled, ...here.keys(), ...byId.keys()]);
  for (const [id, on] of Object.entries(obj(lib.enabled))) {
    // Ids a normalized pack would take, so a library written by hand still matches.
    const key = slugId(id) || id;
    if (willHave.has(key)) plan.enabled[key] = !!on;
  }
  return plan;
}

/**
 * Vet a pack before it is stored. Returns `{ok, error, summary}` the way
 * `inspectDocument` does for a character, so a host page can treat both alike.
 */
export function inspectExtension(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'Not an extension: the file does not hold a JSON object.', summary: null };
  }
  if (doc.format !== EXTENSION_FORMAT) {
    return { ok: false, error: `Not an extension pack (format is ${JSON.stringify(doc.format ?? null)}, expected "${EXTENSION_FORMAT}").`, summary: null };
  }
  const version = num(doc.formatVersion, 1);
  if (version > EXTENSION_VERSION) {
    return { ok: false, error: `This pack was written for a newer app (format version ${version}; this one reads up to ${EXTENSION_VERSION}).`, summary: null };
  }
  const ext = normalizeExtension(doc);
  if (!ext.id) return { ok: false, error: 'The pack has no usable id or name.', summary: null };
  const badBlocks = arr(doc.blocks).length - ext.blocks.length;
  return { ok: true, error: null, summary: summarize(ext), warnings: badBlocks ? [`${badBlocks} block(s) of an unknown kind were dropped`] : [] };
}

/** What an index row carries: enough for the manager to draw the pack unopened. */
export function summarize(ext) {
  const tables = {};
  for (const kind of Object.keys(ext.provides)) tables[kind] = tableCount(kind, ext.provides[kind]);
  const blocks = {};
  for (const b of ext.blocks) blocks[b.kind] = (blocks[b.kind] || 0) + 1;
  return {
    id: ext.id, name: ext.name, author: ext.author, revision: ext.revision,
    description: ext.description, source: ext.source, license: ext.license,
    tables, blocks, blockCount: ext.blocks.length, updatedAt: ext.updatedAt,
  };
}

function tableCount(kind, table) {
  const t = obj(table);
  const known = TABLES.find((x) => x.kind === kind);
  return known ? known.count(t) : Object.keys(t).length;
}

/** A short line for a pack: "30 disciplines · 34 casting tables · 5 blocks". */
export function describeSummary(s) {
  const parts = [];
  const words = Object.fromEntries(TABLES.map((t) => [t.kind, t.words]));
  for (const [kind, n] of Object.entries(s.tables || {})) {
    if (!n) continue;
    const w = words[kind] || [`${kind} entry`, `${kind} entries`];
    parts.push(`${n} ${n === 1 ? w[0] : w[1]}`);
  }
  for (const [kind, n] of Object.entries(s.blocks || {})) {
    const label = BLOCK_KINDS[kind]?.label || kind;
    parts.push(`${n} ${n === 1 ? label.toLowerCase() : plural(label.toLowerCase())}`);
  }
  return parts.join(' · ') || 'empty';
}
const plural = (w) => (w.endsWith('s') ? `${w}es` : `${w}s`);

/** A fresh, empty pack with a name. */
export function blankExtension({ name = 'My extension', author = '', id = null } = {}) {
  const now = new Date().toISOString().slice(0, 19);
  return normalizeExtension({ id: id || slugId(name), name, author, createdAt: now, updatedAt: now });
}

/* ---------------- the local store ---------------- */

/** The keys the store owns: the index, and one document per local pack. */
export const isPackKey = (key) => key === EXTENSIONS_KEY || str(key).startsWith(extensionKey(''));

/**
 * Which of the pack keys found in localStorage are worth moving into the
 * database: the index, and the documents the index actually lists.
 *
 * What that leaves behind is a document with no index row -- the fingerprint
 * of the bug fixed in 758f36c, from a browser that filled up between the two
 * writes a save used to be. Nothing can reach it, so moving it would carry a
 * dead weight into the new home; `tools/storage-report.js` finds those where
 * they lie and prints the line that clears them.
 */
export function packsWorthMoving(found) {
  const out = new Map();
  const raw = found.get(EXTENSIONS_KEY);
  if (typeof raw !== 'string') return out;
  let rows;
  try { rows = arr(JSON.parse(raw).extensions).filter((e) => e && e.id); } catch { return out; }
  out.set(EXTENSIONS_KEY, raw);
  for (const { id } of rows) {
    const doc = found.get(extensionKey(id));
    if (typeof doc === 'string') out.set(extensionKey(id), doc);
  }
  return out;
}

/**
 * The local store: one index listing the packs a player has imported and
 * remembering which bundled ones they have switched off, plus each pack's
 * document under a key of its own so the index stays small enough to read on
 * every load.
 *
 * **Reads are synchronous and writes are not**, and the split is the whole
 * design. The sheet asks what is switched on for every render, and a render
 * cannot wait for a database -- so everything is read into memory once by
 * `open()` and answered from there afterwards. A write goes to the medium
 * first and into memory only once it has gone through, so a store that says
 * a pack is there is a store where the pack is really stored.
 *
 * The argument is where the bytes live (see `pack-storage.js`), in any of
 * three shapes: a medium, a Storage-like object to wrap in one -- which is
 * what the tests hand it -- or a function returning either, awaited at
 * `open()` for the case where choosing takes a database to be opened first.
 */
export function extensionStore(medium = globalThis.localStorage) {
  const cache = new Map();
  // Each pack's document as `read` made it, by key. Parsing is the slow part
  // of a read, and the sheet reads every pack on every render of the
  // Extensions tab. A write to a key drops its entry.
  const parsed = new Map();
  // Goes up on every change, so a caller can tell whether what it worked out
  // from the store is still current.
  let revision = 0;
  let opened = null;
  let backing = null;
  let moved = [];

  const asMedium = (m) => (m && typeof m.commit === 'function'
    ? m
    : storageMedium(m, { holds: isPackKey }));

  const open = () => {
    if (!opened) {
      opened = (async () => {
        const chosen = typeof medium === 'function' ? await medium() : medium;
        if (chosen && chosen.medium) { backing = asMedium(chosen.medium); moved = arr(chosen.moved); }
        else backing = asMedium(chosen);
        const found = await backing.all();
        cache.clear();
        parsed.clear();
        for (const [key, value] of found) cache.set(key, value);
        revision++;
        return true;
      })().catch(() => false);
    }
    return opened;
  };

  const readIndex = () => {
    try {
      const raw = JSON.parse(cache.get(EXTENSIONS_KEY) || '{}');
      return {
        extensions: arr(raw.extensions).filter((e) => e && e.id),
        disabledBundled: arr(raw.disabledBundled).map(str),
      };
    } catch { return { extensions: [], disabledBundled: [] }; }
  };

  /**
   * Store first, remember second. `commit` is all-or-nothing, so a failure
   * here leaves both the medium and the cache on the previous state rather
   * than on two different ones.
   *
   * Every writer above waits on `open()` before it reads the index, which is
   * not belt and braces: a save arriving before the store had read its medium
   * would build the new index out of an empty one and write away every pack
   * already there. Reads may answer "nothing yet"; writes may not act on it.
   */
  const write = async (writes) => {
    if (!backing) await open();
    if (!backing) throw new Error('There is nowhere to store a pack in this browser.');
    await backing.commit(writes);
    for (const [key, value] of writes) {
      if (value === null) cache.delete(key); else cache.set(key, value);
      parsed.delete(key);
    }
    revision++;
  };

  return {
    /** Read everything in. Resolves false where there is nowhere to read from. */
    open,

    /** Which medium the packs ended up in, and what moved there, once open. */
    get medium() { return backing?.name || null; },
    get moved() { return [...moved]; },

    /** A number that changes whenever the store does. */
    get revision() { return revision; },

    /** Every local pack's index row, in the order they were added. */
    list() { return readIndex().extensions.map((e) => ({ ...e, local: true })); },

    /**
     * One local pack's full document, or null. Parsed on the first read and
     * kept until the pack is written again, so every caller gets the same
     * object: copy it before changing it.
     */
    read(id) {
      const key = extensionKey(id);
      if (parsed.has(key)) return parsed.get(key);
      const raw = cache.get(key);
      if (!raw) return null;
      let doc = null;
      try { doc = normalizeExtension(JSON.parse(raw), { owned: true }); } catch { doc = null; }
      parsed.set(key, doc);
      // The text is not needed once it is read, and keeping it doubled the
      // memory a large library takes: 260 MB more with 1,400 book packs.
      cache.delete(key);
      return doc;
    },

    /**
     * Store a pack: new, or replacing the one with the same id (which is how
     * an updated pack a friend sends over lands -- same id, higher revision).
     * Resolves to the index row. Rejects on a full browser, like a character
     * import, and leaves nothing of the attempt behind when it does.
     */
    async save(doc, { origin = 'import', enabled = null } = {}) {
      await open();
      const ext = normalizeExtension(doc);
      if (!ext.id) throw new Error('An extension needs a name.');
      ext.updatedAt = new Date().toISOString().slice(0, 19);
      if (!ext.createdAt) ext.createdAt = ext.updatedAt;
      const index = readIndex();
      const prior = index.extensions.find((e) => e.id === ext.id);
      const row = {
        ...summarize(ext),
        origin: prior?.origin || origin,
        enabled: enabled ?? prior?.enabled ?? true,
      };
      index.extensions = prior
        ? index.extensions.map((e) => (e.id === ext.id ? row : e))
        : [...index.extensions, row];
      await write([
        [extensionKey(ext.id), JSON.stringify(ext)],
        [EXTENSIONS_KEY, JSON.stringify(index)],
      ]);
      return { ...row, local: true, replaced: !!prior, previousRevision: prior ? num(prior.revision, 1) : null };
    },

    /** Remove a pack, or a list of them as one write (Remove N packs). */
    async remove(id) {
      await open();
      const ids = new Set([id].flat());
      const index = readIndex();
      index.extensions = index.extensions.filter((e) => !ids.has(e.id));
      await write([[EXTENSIONS_KEY, JSON.stringify(index)], ...[...ids].map((one) => [extensionKey(one), null])]);
    },

    /**
     * Switch a pack on or off, or a list of them as one write (a fold's
     * All on); bundled ones are remembered by id.
     */
    async setEnabled(id, on, { bundled = false } = {}) {
      await open();
      const ids = new Set([id].flat());
      const index = readIndex();
      if (bundled) {
        const set = new Set(index.disabledBundled);
        for (const one of ids) { if (on) set.delete(one); else set.add(one); }
        index.disabledBundled = [...set];
      } else {
        index.extensions = index.extensions.map((e) => (ids.has(e.id) ? { ...e, enabled: !!on } : e));
      }
      await write([[EXTENSIONS_KEY, JSON.stringify(index)]]);
    },

    disabledBundled() { return new Set(readIndex().disabledBundled); },
  };
}

/* ---------------- bundled packs ---------------- */

/**
 * Where a deployment keeps the packs it carries, in the order they load.
 *
 * `data/extensions/` is the repository's own, and ships empty of anybody
 * else's content on purpose. `private/extensions/` is the folder git ignores
 * -- the same bargain as `private/` characters: yours to hold, not the
 * repository's to publish.
 *
 * Both are *fetched and kept in memory*, never written to storage, so a pack
 * sitting in either costs nothing at all against the browser's storage
 * budget. That is the point of the second one: a catalogue too big to import
 * -- 4 MB of akashic veils will not go into localStorage in every browser --
 * loads from here without asking for a byte of it.
 */
export const PACK_FOLDERS = ['data/extensions/', 'private/extensions/'];

/**
 * The packs a deployment ships: each folder's `index.json` lists them, and
 * each pack is a plain extension document beside it. Missing index, missing
 * file and bad JSON all read as "none" -- the engine runs content-free, and a
 * checkout with no `private/` folder is the ordinary case, not an error.
 *
 * A later folder wins a tie: a pack in `private/extensions/` carrying an id
 * the repository also ships replaces it, keeping the shipped one's place in
 * the list. That is how you correct a bundled pack you cannot edit.
 *
 * `base` is the URL those folders resolve against; the sheet element passes
 * its own module URL, a host page can pass `document.baseURI`.
 */
export async function loadBundledExtensions(base, { fetcher = globalThis.fetch, folders = PACK_FOLDERS } = {}) {
  if (!fetcher) return [];
  const url = (path) => new URL(path, base);

  const readFolder = async (folder) => {
    let index;
    try {
      const res = await fetcher(url(`${folder}index.json`));
      index = res.ok ? await res.json() : null;
    } catch { index = null; }
    const rows = arr(index?.extensions).filter((e) => e && (e.file || e.id));
    return Promise.all(rows.map(async (row) => {
      try {
        const res = await fetcher(url(`${folder}${row.file || `${row.id}.json`}`));
        if (!res.ok) return null;
        const doc = await res.json();
        const verdict = inspectExtension(doc);
        if (!verdict.ok) return null;
        const ext = normalizeExtension(doc);
        if (row.id) ext.id = slugId(row.id) || ext.id;
        return ext;
      } catch { return null; }
    }));
  };

  const found = (await Promise.all(arr(folders).map(readFolder))).flat().filter(Boolean);
  const byId = new Map();
  for (const ext of found) byId.set(ext.id, ext);
  return [...byId.values()];
}

/* ---------------- merging the tables ---------------- */

/**
 * A second copy of a sphere joined to the first, talent by talent.
 *
 * A sphere used to be replaced outright, on the reasoning that one page is the
 * whole sphere and a later pack carrying it is a corrected copy. That held
 * while a pack was a page. A pack can also be a *book*, and a sphere is spread
 * over as many books as wrote talents for it: a sphere is in one pack, and
 * five more of its talents are in another -- which, replacing, left a caster
 * with those five and nothing else, depending on which pack loaded second.
 *
 * A correction still works, one entry at a time: a talent or base ability of
 * the same name is the later copy's, and so is any field it fills. What a
 * later copy cannot do is take a talent away, which nothing has wanted to.
 *
 * "The same name" is the key the catalogue looks talents up by (`talentKey`),
 * and a correction replaces *every* earlier copy under it. A page often lists
 * a talent twice, in its main list and a topical section, and the catalogue
 * keeps the longest of a sphere's copies; replacing only one left the older
 * text there to win against the correction.
 * Used by `mergeTables` when packs load, and by the pack editor when a sphere
 * is pasted into a pack that already has it, so the two file it alike.
 */
export function mergeSphere(had, sphere) {
  const merged = { ...had };
  for (const [key, value] of Object.entries(obj(sphere))) {
    if (key === 'name' || key === 'talents' || key === 'abilities') continue;
    if (value === null || value === undefined || value === '') continue;
    merged[key] = value;
  }
  const byName = (a, b, key) => {
    const later = new Map();
    for (const e of arr(b)) {
      const k = key(e?.name);
      if (!later.has(k)) later.set(k, []);
      later.get(k).push(e);
    }
    const outList = [];
    for (const e of arr(a)) {
      const k = key(e?.name);
      const copies = later.get(k);
      if (!copies) outList.push(e);
      else if (copies.length) { outList.push(...copies); later.set(k, []); }
    }
    for (const copies of later.values()) outList.push(...copies);
    return outList;
  };
  merged.talents = byName(had?.talents, sphere?.talents, talentKey);
  merged.abilities = byName(had?.abilities, sphere?.abilities, lower);
  return merged;
}

/**
 * Which entry of a catalogue kind an entry is: its name, and whose it is. An
 * entry that says whose it is meets only its own -- the rogue's Evasion talent
 * and the monk's Evasion art are two entries of one name, and by name alone
 * whichever was filed second would have erased the other. Used by
 * `mergeTables` and by the pack editor, so the two file an entry alike.
 */
export function catalogueEntryKey(e) {
  const f = new Map(arr(e?.fields).map(([k, v]) => [lower(k), lower(v)]));
  return `${lower(e?.name)}|${f.get('class') || ''}|${f.get('option') || ''}`;
}

/**
 * Fold every enabled pack's tables into the one document each registrar
 * expects. Later packs win: a class or manipulation with the same name
 * (case-insensitively) as an earlier one replaces it, so a player can fix a
 * bundled table by shipping a corrected copy in their own pack without being
 * able to edit the bundled one.
 *
 * A **discipline is the exception**: two packs naming the same one add up,
 * maneuver by maneuver, and only an entry of the same name is replaced. A
 * discipline is not one fact but a list of thirty, and the ordinary rule
 * makes a pack carrying a single corrected maneuver delete the twenty-nine it
 * had no opinion about -- which is what a player does the first time they
 * paste one maneuver off a wiki page. The cost is that a later pack cannot
 * *remove* an entry, which nothing has ever wanted to do.
 */
export function mergeTables(extensions) {
  const out = Object.fromEntries(TABLES.map((t) => [t.kind, t.empty()]));
  /*
   * An index per list, because a scan per entry is quadratic and these lists
   * got long. Merging the whole wiki -- 117 packs, 32,592 entries, 8,912 of
   * them feats -- spent 2.1 seconds here, nearly all of it in `findIndex`
   * walking a list that was already thousands long. With the index it is 60.
   *
   * Safe because each of these lists is created empty in `out` above and
   * these three functions are the only things that ever touch one, so the
   * index cannot fall behind what it describes. Keyed on the array itself and
   * held weakly, so nothing outlives the merge that made it.
   */
  const indexes = new WeakMap();
  const keyIndex = (list, key) => {
    let idx = indexes.get(list);
    if (!idx) {
      idx = new Map();
      for (let i = 0; i < list.length; i++) idx.set(lower(list[i]?.[key]), i);
      indexes.set(list, idx);
    }
    return idx;
  };
  /** Where `k` sits in `list`, or -1; the index does the looking. */
  const at = (list, key, k) => {
    const found = keyIndex(list, key).get(k);
    return found === undefined ? -1 : found;
  };
  /** Remember that `k` is now at the end of `list`. */
  const noteAdded = (list, key, k) => keyIndex(list, key).set(k, list.length - 1);
  /**
   * Where each entry of a group's list sits, by `catalogueEntryKey`. Only for
   * a list `upsertGroup` made, which nothing else changes.
   */
  const entryIndexes = new WeakMap();
  const entryIndex = (entries) => {
    let where = entryIndexes.get(entries);
    if (!where) {
      where = new Map();
      for (let j = 0; j < entries.length; j++) where.set(catalogueEntryKey(entries[j]), j);
      entryIndexes.set(entries, where);
    }
    return where;
  };

  const upsert = (list, item, key = 'name') => {
    const k = lower(item?.[key]);
    if (!k) return;
    const i = at(list, key, k);
    if (i === -1) { list.push(item); noteAdded(list, key, k); } else list[i] = item;
  };
  /**
   * A veil joins one already there, field by field, rather than replacing it.
   *
   * It is the one table assembled from two different kinds of page. The
   * veil's own page carries its rules text, its chakra slots and its
   * descriptors and says nothing about who may shape it; the page listing a
   * *class's* veils says exactly that and carries a one-line summary at most.
   * Replace-by-name would mean whichever pack was switched on second erased
   * what the other knew, and which half survived would depend on the order
   * the packs happened to load in.
   *
   * So a field a later pack leaves empty leaves the earlier answer standing,
   * a field it fills wins, and `classes` is the union -- five classes listing
   * the same veil is five packs each contributing one name to it.
   */
  const upsertVeil = (list, veil) => {
    const k = lower(veil?.name);
    if (!k) return;
    const i = at(list, 'name', k);
    if (i === -1) { list.push(veil); noteAdded(list, 'name', k); return; }
    const had = list[i];
    const merged = { ...had };
    for (const [key, value] of Object.entries(veil)) {
      if (key === 'classes') continue;
      // The name is the key the whole thing meets on, so a merge never
      // changes it. A list page that wrote it in lower case would otherwise
      // rename the veil for everyone, and the first spelling is the one a
      // sheet that shaped it already has written down.
      if (key === 'name') continue;
      if (value === null || value === undefined || value === '') continue;
      merged[key] = value;
    }
    const classes = [...arr(had.classes).map(str), ...arr(veil.classes).map(str)].filter(Boolean);
    const seen = new Map();
    for (const c of classes) if (!seen.has(lower(c))) seen.set(lower(c), c);
    if (seen.size) merged.classes = [...seen.values()];
    list[i] = merged;
  };

  /**
   * A group of named entries joins one already there, entry by entry: the
   * shape a discipline and a catalogue kind share.
   */
  const upsertGroup = (list, group, key) => {
    const k = lower(group?.[key]);
    if (!k) return;
    const i = at(list, key, k);
    if (i === -1) {
      list.push({ ...group, entries: [...arr(group.entries)] });
      noteAdded(list, key, k);
      return;
    }
    // The entries inside a group get an index of their own for the same
    // reason: `class option` is 3,003 of them under one kind, and a second
    // pack contributing to that kind would otherwise scan all of them each.
    // The list and its index are kept for the next pack too. Copying and
    // re-reading the whole list for every pack that adds to it took 5 seconds
    // with 1,400 book packs, each adding a few entries to the same kinds.
    const entries = list[i].entries;
    const where = entryIndex(entries);
    for (const e of arr(group.entries)) {
      const w = catalogueEntryKey(e);
      const j = where.get(w);
      if (j === undefined) { entries.push(e); where.set(w, entries.length - 1); } else entries[j] = e;
    }
    list[i] = { ...list[i], ...group, entries };
  };

  /** A sphere joins one already there, talent by talent (`mergeSphere`). */
  const upsertSphere = (list, sphere) => {
    const k = lower(sphere?.name);
    if (!k) return;
    const i = at(list, 'name', k);
    if (i === -1) { list.push(sphere); noteAdded(list, 'name', k); return; }
    list[i] = mergeSphere(list[i], sphere);
  };

  /** A discipline joins one already there rather than replacing it. */
  const upsertDiscipline = (list, disc) => upsertGroup(list, disc, 'name');
  for (const ext of arr(extensions)) {
    const p = obj(ext?.provides);
    for (const d of arr(p.maneuvers?.disciplines)) upsertDiscipline(out.maneuvers.disciplines, d);
    for (const x of arr(p.spheres?.spheres)) upsertSphere(out.spheres.spheres, x);
    // A veil is one fact under its own name, so the ordinary later-wins rule
    // applies -- and it is what dissolves the duplicate question, since a veil
    // shapeable in five chakras is on five of the wiki's slot pages with the
    // same text each time. Sixteen per-chakra packs together come to the 1,496
    // veils that exist rather than the 2,149 entries they are written as.
    for (const x of arr(p.veils?.veils)) upsertVeil(out.veils.veils, x);
    /*
     * A feat, a spell and a power are each one fact under one name, so the
     * ordinary later-wins rule is enough -- no `upsertVeil` here. The union
     * a veil needs is for the *other* kind of page, the one that lists a
     * class's veils and knows nothing else about them; a spell's own page
     * already names every class whose list it is on, and there is no second
     * page contributing half the answer.
     */
    for (const x of arr(p.feats?.feats)) upsert(out.feats.feats, x);
    for (const x of arr(p.spells?.spells)) upsert(out.spells.spells, x);
    for (const x of arr(p.powers?.powers)) upsert(out.powers.powers, x);
    /*
     * A kind's entries join a kind already there rather than replacing it --
     * the same rule a discipline's maneuvers follow, and for the same reason.
     * Deities arrive in more than one pack (one per source book, most likely),
     * and replace-by-kind would mean whichever loaded second erased the rest.
     */
    for (const g of arr(p.catalogues?.catalogues)) upsertGroup(out.catalogues.catalogues, g, 'kind');
    if (arr(p.vancian?.spellLevels).length) out.vancian.spellLevels = [...p.vancian.spellLevels];
    for (const c of arr(p.vancian?.classes)) upsert(out.vancian.classes, c);
    if (arr(p.psionics?.powerLevels).length) out.psionics.powerLevels = [...p.psionics.powerLevels];
    for (const c of arr(p.psionics?.curves)) upsert(out.psionics.curves, c, 'total');
    for (const c of arr(p.psionics?.classes)) upsert(out.psionics.classes, c);
    for (const m of arr(p.cardcasting?.manipulations)) upsert(out.cardcasting.manipulations, m);
    if (p.cooking?.durationHours) out.cooking.durationHours = str(p.cooking.durationHours);
    for (const k of COOKING_LISTS) {
      for (const x of arr(p.cooking?.[k])) upsert(out.cooking[k], x);
    }
    // Alternate Training: a technique replaces a technique of the same name
    // outright (it arrives whole, like a sphere), the ladder shape is
    // later-wins, and the cite links pool.
    if (arr(p.altTraining?.levels).length) out.altTraining.levels = [...p.altTraining.levels];
    if (Number.isFinite(Number(p.altTraining?.repeatFrom))) out.altTraining.repeatFrom = Number(p.altTraining.repeatFrom);
    for (const t of arr(p.altTraining?.techniques)) upsert(out.altTraining.techniques, t);
    Object.assign(out.altTraining.links, obj(p.altTraining?.links));
  }
  if (!out.vancian.spellLevels) delete out.vancian.spellLevels;
  if (!out.psionics.powerLevels) delete out.psionics.powerLevels;
  if (!out.cooking.durationHours) delete out.cooking.durationHours;
  if (!out.altTraining.levels) delete out.altTraining.levels;
  if (out.altTraining.repeatFrom === null) delete out.altTraining.repeatFrom;
  return out;
}

/**
 * Register the merged tables with the model. `registrars` is the model's
 * table setters, passed in rather than imported so this module has no
 * dependency on model.js and the tests can hand it spies.
 */
export function registerTables(merged, registrars) {
  const r = obj(registrars);
  const failed = [];
  // One table a setter cannot read must not take the rest with it. A pack
  // with a malformed entry used to throw out of here, the page kept that
  // failed load, and no character would open until the pack was removed. A
  // table that fails is registered empty instead and named in what this
  // returns, so the page opens and the caller can say which pack to look at.
  const register = (name, table) => {
    const set = r[name];
    if (typeof set !== 'function') return;
    try {
      set(table);
    } catch (err) {
      failed.push({ name, error: err?.message || String(err) });
      try { set(undefined); } catch { /* every setter reads nothing as an empty table */ }
    }
  };
  for (const t of TABLES) register(t.setter, merged[t.kind]);
  return failed;
}

/* ---------------- the active set ---------------- */

/**
 * What is switched on right now: bundled packs not disabled, then local packs
 * that are enabled, in that order (so a local pack overrides a bundled one).
 * Bundled documents are passed in because fetching them is the caller's --
 * they are loaded once per page and kept.
 */
export function activeExtensions(bundled, store) {
  const off = store ? store.disabledBundled() : new Set();
  const out = arr(bundled).filter((e) => !off.has(e.id)).map((e) => ({ ...e, bundled: true, enabled: true }));
  for (const row of store ? store.list() : []) {
    if (!row.enabled) continue;
    const doc = store.read(row.id);
    if (doc) out.push({ ...doc, bundled: false, enabled: true });
  }
  return out;
}

/**
 * What a catalogue entry was read as, by the entry and the name of the
 * reading: a class block, a page's features, a menu option.
 *
 * Reading means regexes over the entry's text, and every refresh reads every
 * entry of every active pack. An entry belongs to a pack document, which is
 * kept until the pack is written again, so each entry is read once per pack
 * revision. Nothing changes an entry in place: an edited pack is saved and
 * read back as a new document. Readings come back shared: do not change them.
 */
const ENTRY_READINGS = new WeakMap();
function readEntry(entry, reading, read) {
  if (!entry || typeof entry !== 'object') return read();
  let held = ENTRY_READINGS.get(entry);
  if (!held) ENTRY_READINGS.set(entry, held = new Map());
  if (!held.has(reading)) held.set(reading, read());
  return held.get(reading);
}

/** Every block across the active packs, tagged with the pack it came from. */
export function activeBlocks(extensions) {
  const out = [];
  for (const ext of arr(extensions)) {
    ext.blocks.forEach((block, index) => {
      out.push({ ...block, extId: ext.id, extName: ext.name, index });
    });
  }
  // A catalogue pack's classes, archetypes, races and alternate racial traits
  // are blocks too, made from their entries (DERIVED_BLOCKS) -- numbered after
  // the pack's own, and never over the same block somebody wrote into a pack,
  // which is the better of the two. Between two packs deriving the same block,
  // the later one's stands: the packs arrive bundled first and local after,
  // and somebody's own pack overrides a bundled one.
  const written = new Set(out.map(derivedKey));
  const derived = new Map();
  for (const ext of arr(extensions)) {
    let index = arr(ext.blocks).length;
    for (const cat of arr(ext.provides?.catalogues?.catalogues)) {
      const kind = lower(cat?.kind);
      const how = DERIVED_BLOCKS.find((d) => d.kinds.includes(kind));
      if (!how) continue;
      for (const entry of arr(cat.entries)) {
        for (const block of readEntry(entry, how.reading, () => how.read(entry).filter(Boolean))) {
          const key = derivedKey(block);
          if (written.has(key)) continue;
          derived.set(key, { ...block, extId: ext.id, extName: ext.name, index: index++ });
        }
      }
    }
  }
  out.push(...derived.values());
  return out;
}

/* ---------------- attaching a block to a character ---------------- */

/**
 * Copy one block into a live Character. Returns a line saying what landed
 * where, for the sheet to show; throws only if the model has no such list,
 * which would be a programming error rather than bad content.
 *
 * Only model methods are used -- `listAdd`, `set`, `setBuild`, `addTracker`,
 * `setClassFeature` -- so every write recomputes and notifies exactly as the
 * same edit made by hand would.
 */
export function applyBlock(model, rawBlock) {
  const block = normalizeBlock(rawBlock);
  if (!block) throw new Error('Not a block this app knows.');
  const d = model.data;
  switch (block.kind) {
    case 'class': {
      const existing = (d.classes || []).findIndex((c) => lower(c.name) === lower(block.name));
      const row = {
        name: block.name, hd: block.hd, bab: block.bab, babOverride: null,
        goodFort: block.goodFort, goodRef: block.goodRef, goodWill: block.goodWill,
        skillRanks: block.skillRanks, archetypes: block.archetypes, levelsOverride: null,
      };
      if (existing === -1) model.listAdd('classes', { ...blankClassRow(), ...row, systems: block.systems });
      else {
        const unstated = new Set(block.unstated || []);
        for (const [k, v] of Object.entries(row)) if (!unstated.has(k)) model.setItem('classes', existing, k, v);
        // The block's system tags join the row's rather than replace them --
        // whatever the player already marked by hand stays marked.
        const had = (model.data.classes[existing].systems || []);
        model.setItem('classes', existing, 'systems', [...new Set([...had, ...block.systems])]);
      }
      // The per-level feature names go into the class's own feature columns on
      // the Progression tab, one cell per level, keyed by the class's level.
      // A feature the table names at more than one level earns a column of its
      // own, on the schedule its levels describe; the rest stay in Special.
      const columns = block.features.length && d.progression ? repeatColumns(block.features) : [];
      if (block.features.length && d.progression) {
        const spread = new Set(columns.flatMap((c) => c.at.map((a) => a.feature)));
        const byLevel = new Map();
        for (const f of block.features) {
          if (spread.has(f)) continue;
          const cur = byLevel.get(f.level) || [];
          cur.push(f.name);
          byLevel.set(f.level, cur);
        }
        for (const [level, names] of byLevel) model.setClassFeature(block.name, level, 'Special', names.join(', '));
        for (const col of columns) {
          model.addClassFeatureColumn(block.name, col.name);
          const index = (model.data.progression.classFeatures?.[block.name]?.columns || []).indexOf(col.name);
          if (index === -1) continue;
          if (!model.classFeatureRuleGroups(block.name, col.name).length) {
            model.addClassFeatureRuleGroup(block.name, index, { name: col.name, rule: col.rule });
          }
          // A ladder writes its own value in each cell ("+3d6"); a menu writes
          // an empty one, so the level is on the grid as a pick still owed --
          // which is what the column's badge counts.
          for (const a of col.at) model.setClassFeature(block.name, a.feature.level, col.name, a.text);
        }
      }
      // A track's spec is copied onto the character like everything else a
      // pack lands, so the sheet travels without the pack behind it.
      if (block.tracks) model.addCustomization(block.name, block.tracks);
      // Its class skills are the skills a player ticks; tick the ones the sheet has.
      let ticked = 0;
      if (block.classSkills.length) {
        const wanted = new Set(block.classSkills.map(lower));
        (d.skills || []).forEach((s, i) => {
          if (wanted.has(lower(s.name)) && !s.classSkill) { model.setItem('skills', i, 'classSkill', true); ticked += 1; }
        });
      }
      // The features' rules text goes under the class itself, beneath its
      // ladder -- one entry per distinct feature, so the prose is on the sheet
      // and not only in the pack. Names alone are the ladder above.
      const withText = [];
      const seen = new Set();
      for (const f of block.features) {
        const key = featureKey(f.name);
        if (!f.text || seen.has(key)) continue;
        seen.add(key);
        withText.push(f);
      }
      for (const f of withText) model.addClassFeatureNote(block.name, { name: f.name, text: f.text });
      return `${existing === -1 ? 'Added' : 'Updated'} class ${block.name}`
        + `${block.features.length ? `, ${block.features.length} feature(s) on the Progression tab` : ''}`
        + `${withText.length ? `, ${withText.length} with their text under the class` : ''}`
        + `${ticked ? `, ${ticked} class skill(s) ticked` : ''}`
        + `${block.tracks ? ', and its customized weapons on Martial Spheres' : ''}.`;
    }
    case 'race': {
      model.set('identity.race', block.name);
      if (block.size) model.set('identity.size', block.size);
      for (const [ab, v] of Object.entries(block.abilityMods)) model.setBuild(ab, 'race', v);
      let added = 0;
      for (const t of block.traits) { addRaceTrait(model, t); added += 1; }
      return `Set race to ${block.name}${block.size ? ` (${block.size})` : ''}`
        + `${Object.keys(block.abilityMods).length ? ', racial ability modifiers set' : ''}`
        + `${added ? `, ${added} race trait(s) added` : ''}.`;
    }
    case 'trait':
      return applyAlternateTrait(model, block);
    case 'feature': {
      const groupName = block.group || block.extName || 'Extensions';
      const templates = model.list('templates');
      let ti = templates.findIndex((t) => lower(t.name) === lower(groupName));
      if (ti === -1) {
        model.listAdd('templates', { tab: null, name: groupName, link: null, approvalLink: null, features: [] });
        ti = templates.length - 1;
      }
      model.listAdd(`templates.${ti}.features`, {
        name: block.name, type: block.type, text: block.text, tables: [], children: [],
      });
      return `Added feature ${block.name} to the ${groupName} group on the Template tab.`;
    }
    case 'template':
      model.listAdd('templates', {
        tab: null, name: block.name, link: null, approvalLink: null,
        features: block.features.map((f) => ({ name: f.name, type: f.type, text: f.text, tables: [], children: [] })),
      });
      return `Added ${block.name} with ${block.features.length} feature(s) to the Template tab.`;
    case 'tracker':
      model.addTracker({
        name: block.name, maxFormula: block.maxFormula, minFormula: block.minFormula,
        refresh: block.refresh, note: block.text, style: block.style,
      });
      return `Added tracker ${block.name}.`;
    case 'veil': {
      // A veil goes into its chakra slot on the Akashic board: the slot's veil
      // if it is empty, its second veil under Twinveil, else a new slot of the
      // same name so nothing already shaped is displaced. Essence starts at 0;
      // the rules text is the veil's description, where {…} formulas resolve.
      const slots = model.list('akashic.slots');
      // "Body, Shoulders" -- a veil that shapes in either. The first with room
      // on the board wins; failing that, the first named, as a new slot.
      const wanted = String(block.slot || '').split(/\s*[,/]\s*/).map((s) => s.trim()).filter(Boolean);
      const room = (s) => (s.veils || []).length < (s.twinveil ? 2 : 1);
      let si = -1;
      for (const w of wanted) {
        si = slots.findIndex((s) => lower(s.slot) === lower(w) && room(s));
        if (si !== -1) break;
      }
      const first = wanted[0] || 'Unslotted';
      const slotName = si !== -1 ? slots[si].slot : (slots.find((s) => lower(s.slot) === lower(first))?.slot || first);
      let where = 'in';
      if (si === -1) {
        model.listAdd('akashic.slots', { slot: slotName, bound: false, twinveil: false, veils: [] });
        si = slots.length - 1;
        where = slots.some((s, i) => i !== si && lower(s.slot) === lower(slotName)) ? 'in a second' : 'in a new';
      }
      /*
       * The name goes on the board; the rules text does not follow it.
       *
       * `desc` is the *player's* cell -- `veilOwn` reads it as the only thing
       * on a veil the sheet saves -- so putting a pack's paragraph in it made
       * the sheet claim the player wrote it, banked two and a half kilobytes
       * of somebody's book on every character that shaped it, and put that
       * text beyond the reach of a pack correcting it. The catalogue is where
       * a veil's text is read from, and it is read where it stands.
       *
       * The exception is a veil no catalogue has: a page somebody pasted
       * themselves, whose block is the only copy there is. Dropping its text
       * would lose it outright, and text a player pasted is text a player
       * copied -- which is theirs to keep. So it is kept exactly when nothing
       * else can supply it, which for any pack built by `scrape-pack.mjs`
       * -- where `convertPack` has already moved the veils into the table --
       * is never.
       */
      const known = !!veilEntry(block.name);
      model.listAdd(`akashic.slots.${si}.veils`, {
        name: block.name, desc: known ? '' : block.text, essence: 0,
      });
      return `Shaped ${block.name} ${where} ${slotName} slot on the Akashic tab (essence 0).`;
    }
    case 'archetype':
      return applyArchetype(model, block);
    case 'package':
      // A package is never added alone: it takes the place of one of a
      // class's own (packages.js, from the Progression tab).
      return `${block.name || 'An archetype package'} is swapped in on the Progression tab. Turn on Archetype packages under Campaign rules to use it.`;
    case 'options':
      return applyOptions(model, block);
    case 'note':
      model.listAdd('notes', { title: block.name, body: block.text });
      return `Added note ${block.name || '(untitled)'}.`;
    default:
      throw new Error(`Unknown block kind ${block.kind}`);
  }
}

/**
 * Point a class feature's column at the menu this block holds.
 *
 * The menu itself stays in the pack -- a rogue talent list is 178 entries and
 * has no business being copied into every character who has a rogue level --
 * so what lands on the sheet is its name. The column is found by the feature
 * the block names, forgivingly (`Iaijutsu technique` against `Iaijutsu
 * Technique`); failing that, by a column whose cells already say so.
 *
 * With no such class or column on the sheet the menu still lands, as a group
 * on the Template tab, so nothing pasted goes nowhere.
 */
export function applyOptions(model, block) {
  const className = block.class.replace(/\s*\(class\)$/i, '').trim();
  const classes = model.list('classes') || [];
  const onSheet = classes.find((c) => lower(c.name) === lower(className))
    || classes.find((c) => featureKey(c.name) === featureKey(className));
  const target = onSheet?.name || className;
  const group = model.data.progression?.classFeatures?.[target];
  const wanted = featureKey(block.feature || block.name);
  let column = (group?.columns || []).find((c) => featureKey(c) === wanted);
  // A menu named for its page ("Legendary Samurai Iaijutsu Technique") against
  // a column named for the feature ("Iaijutsu technique"): one ends the other.
  if (!column) {
    column = (group?.columns || []).find((c) => {
      const k = featureKey(c);
      return k.length > 3 && (wanted.endsWith(k) || featureKey(block.name).endsWith(k));
    });
  }
  if (column) {
    // Naming the class and the feature is claim enough: where the column
    // already picks from this menu because of that, adding it changes nothing.
    if (model.classFeatureColumnOptions(target, column).some((n) => lower(n) === lower(block.name))) {
      return `${target}'s ${column} column already picks from “${block.name}”. The menu names the class and the feature, so nothing was added.`;
    }
    const index = group.columns.indexOf(column);
    model.setClassFeatureColumnOptions(target, index, [...model.classFeatureColumnOptions(target, column), block.name]);
    return `${block.options.length} option(s) for ${target}: the ${column} column now picks from “${block.name}”.`;
  }

  // A menu with no column to hang on is not copied anywhere: it stays in its
  // pack, and takes effect the moment the class that has that feature arrives.
  return `Nothing on this sheet picks from “${block.name}” yet. It is for ${
    [target || 'a class', block.feature].filter(Boolean).join('’s ')}, and its ${
    block.options.length} option(s) are offered as soon as that feature has a column on the Progression tab.`;
}

/**
 * Take one class level off a feature column's schedule.
 *
 * The rule language already writes this -- "2, 6, 10, 14, 18, -10" grants at
 * every one of those but the tenth -- so subtracting the level is an edit to
 * the rule a player can read and undo by hand. Returns false where the column
 * never granted at that level, which is not a swap that happened and is worth
 * saying rather than doing nothing quietly.
 */
function dropRuleLevel(model, className, columnIndex, level, entry) {
  const col = model.data.progression?.classFeatures?.[className]?.columns?.[columnIndex];
  if (!col) return false;
  const gi = grantingGroupAt(model, className, col, level);
  if (gi === null) return false;
  const was = model.classFeatureRuleGroups(className, col)[gi]?.rule || '';
  model.setClassFeatureRuleGroup(className, columnIndex, gi, { rule: `${was}${was ? ', ' : ''}-${level}` });
  // The level, not the rule as it stood: taking that one term back out again
  // is the same edit whatever order the archetypes come off in.
  entry.ruleEdits.push({ column: col, group: gi, level });
  return true;
}

/**
 * The rule group of a feature column that grants at a class level, by index,
 * or null. The grid's own answer where the Planner has that level; for one it
 * does not have yet, the group whose rule names the level, so a swap made at
 * 6th still takes the 12th-level grant.
 */
function grantingGroupAt(model, className, col, level) {
  const row = model.classFeatureRows(className).find((r) => r.classLevel === level);
  if (row) return row.cells?.[col]?.fields.find((f) => f.on && f.group)?.group?.index ?? null;
  const gi = model.classFeatureRuleGroups(className, col).findIndex((g) => levelRuleGrants(g.rule || '', level, level));
  return gi === -1 ? null : gi;
}

/** Put a level back on a schedule by dropping the "-N" that took it off. */
function restoreRuleLevel(model, className, column, groupIndex, level) {
  const index = (model.data.progression?.classFeatures?.[className]?.columns || []).indexOf(column);
  const grp = model.classFeatureRuleGroups(className, column)[groupIndex];
  if (index === -1 || !grp) return;
  const terms = str(grp.rule).split(',').map((s) => s.trim()).filter(Boolean);
  const at = terms.lastIndexOf(`-${level}`);
  if (at === -1) return;
  terms.splice(at, 1);
  model.setClassFeatureRuleGroup(className, index, groupIndex, { rule: terms.join(', ') });
}

/** What an archetype's own menu is called, wherever it is looked up from. */
export const archetypeMenuName = (archetype, feature) => `${str(archetype).trim()} — ${str(feature).trim()}`;

/**
 * The menus the active packs provide, for the model's catalogue registry:
 * blocks that are nothing but a menu, and the menus archetypes carry on their
 * features. Both are looked up by name, so neither is ever copied onto a
 * character.
 */
export function optionCataloguesFrom(blocks) {
  const out = [];
  for (const b of arr(blocks)) {
    const kind = lower(b?.kind);
    if (kind === 'options') {
      out.push({
        name: str(b.name).trim(),
        class: str(b.class ?? b.className).trim(),
        feature: str(b.feature).trim(),
        text: str(b.text),
        options: normalizeOptions(b.options, str(b.feature) || str(b.name)),
      });
    } else if (kind === 'archetype') {
      for (const f of arr(b.features)) {
        if (!arr(f?.options).length) continue;
        out.push({
          name: archetypeMenuName(b.name, f.name),
          class: str(b.class ?? b.className).trim(),
          feature: str(f.name).trim(),
          text: str(f.optionsInfo),
          options: normalizeOptions(f.options, str(f.name)),
        });
      }
    }
  }
  return out.filter((c) => c.name && c.options.length);
}

/*
 * The ways an option's text says the level it asks for -- in its
 * prerequisites ("Prerequisites: 6th-level"), or in a sentence ("must be at
 * least 6th level", "must be level 6 to select"). Each route that reads
 * options used to know one of them; every route reads all of them here. Each
 * keeps the word that anchors it, so "must be 5 feet away" is not a level.
 */
const MIN_LEVEL_SAYINGS = [
  /Prerequisites?:?\*{0,2}\s*(?:[^.\n]*?\b)?(\d{1,2})(?:st|nd|rd|th)[ -]level\b/i,
  /\bmust be (?:at least )?(\d{1,2})(?:st|nd|rd|th)? level(?: or higher)?\b/i,
  /must be (?:at least |of )?(?:level )?(\d{1,2})(?:st|nd|rd|th)?(?: level)?(?: or higher)? to select/i,
];

/** The level an option's text asks for, or null when it names none. */
export function minLevelIn(text) {
  for (const saying of MIN_LEVEL_SAYINGS) {
    const m = str(text).match(saying);
    if (m) return Number(m[1]) || null;
  }
  return null;
}
const optionMinLevel = minLevelIn;

/**
 * A page that is a list -- "Advancing Flurry (Ex)" on a line, its text under
 * it, then the next -- as the entries it lists.
 *
 * Only a line ending in its (Ex)/(Su)/(Sp) counts as a name: a short line on
 * its own is as often "2 qi points" as it is a heading, and a list cut in the
 * wrong places is worse than one not cut at all. Fewer than three and it was
 * not a list.
 */
function listedOptions(text, source) {
  const out = [];
  let open = null;
  for (const line of str(text).split('\n')) {
    const m = line.trim().match(/^\*{0,2}([A-Z][^.:;!?]{1,70}?)\*{0,2}\s*\((Ex|Su|Sp)\)\*{0,2}:?$/);
    if (m) { open = { name: m[1].trim(), type: m[2], lines: [] }; out.push(open); } else if (open) open.lines.push(line);
  }
  if (out.length < 3) return [];
  return out.map((o) => {
    const body = o.lines.join('\n').trim();
    return { name: o.name, type: o.type, category: '', text: body, source, minLevel: optionMinLevel(body) };
  });
}

/**
 * The menus the active packs' *tables* amount to, beside the ones written as
 * blocks.
 *
 * A catalogue pack does not say "this is a menu"; it says what each entry is,
 * and two of the things it says are a menu in all but name:
 *
 *  - a `class option` entry names its Class and its Option. Sixteen entries
 *    that are each a Kineticist's Element are the list an Element column picks
 *    from; one entry whose text is itself a list of arts is that list.
 *  - a row of the powers table whose kind is not `power` is something a class
 *    takes one of at a time. They are offered whole, by their type ("Utility",
 *    "Substance Infusion"), and by the word types share ("Infusion"), since a
 *    column is as often ruled by the family as by the kind.
 *
 * Looked up by name like any menu, so nothing is copied onto a character.
 */
export function optionCataloguesFromTables(tables) {
  const out = [];
  const title = (s) => str(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());

  const groups = new Map();
  for (const cat of arr(tables?.catalogues?.catalogues)) {
    if (lower(cat?.kind) !== 'class option') continue;
    for (const e of arr(cat.entries)) {
      const { cls, feature } = readEntry(e, 'class option', () => {
        const fields = new Map(arr(e?.fields).map(([k, v]) => [lower(k), str(v).trim()]));
        return { cls: fields.get('class') || '', feature: fields.get('option') };
      });
      if (!feature || !str(e?.name).trim()) continue;
      const key = `${lower(cls)}|${lower(feature)}`;
      if (!groups.has(key)) groups.set(key, { class: cls, feature, entries: [] });
      groups.get(key).entries.push(e);
    }
  }
  for (const g of groups.values()) {
    const only = g.entries.length === 1 ? g.entries[0] : null;
    const listed = only
      ? readEntry(only, `listed|${g.feature}`, () => normalizeOptions(listedOptions(only.text, str(only.source)), g.feature))
      : [];
    // An entry named for the list itself -- "Vigilante Talent" among the
    // vigilante's talents -- is the list's own rules, not one more to pick.
    // "Rogue Talent" already names its class; "Talent" needs it in front.
    const menuName = g.class && !lower(g.feature).startsWith(lower(g.class)) ? `${g.class} ${g.feature}` : g.feature || g.class;
    const about = g.entries.length > 1 ? g.entries.find((e) => lower(e.name) === lower(menuName)) : null;
    const options = listed.length ? [...listed] : g.entries.filter((e) => e !== about).map((e) => readEntry(e, `option|${g.feature}`, () => {
      const { name, type } = splitAbilityType(e.name);
      return normalizeOptions([{
        name, type,
        text: str(e.text), source: str(e.source), minLevel: optionMinLevel(e.text),
      }], g.feature)[0];
    })).filter(Boolean);
    out.push({
      name: menuName, class: g.class, feature: g.feature,
      text: str(about?.text), options,
    });
  }

  const kinds = new Map();
  for (const row of arr(tables?.powers?.powers)) {
    const kind = lower(row?.kind);
    if (!kind || kind === 'power' || !str(row?.name).trim()) continue;
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push(readEntry(row, 'power', () => {
      const { name: type, type: abilityType } = splitAbilityType(row.type);
      const facts = [type, row.level != null && row.level !== '' ? `level ${row.level}` : '',
        str(row.burn).trim() ? `burn ${str(row.burn).trim()}` : '', str(row.element).trim()];
      return {
        row,
        family: type,
        option: { name: str(row.name).trim(), type: abilityType, category: facts.filter(Boolean).join(', '), text: str(row.text), source: str(row.source) },
      };
    }));
  }
  for (const [kind, rows] of kinds) {
    const menu = (name, list) => out.push({
      name, class: '', feature: name, text: '',
      options: list.map((r) => readEntry(r.row, `power|${name}`, () => normalizeOptions([r.option], name)[0])).filter(Boolean),
    });
    menu(title(kind), rows);
    const types = [...new Set(rows.map((r) => r.family).filter(Boolean))];
    for (const t of types) menu(`${title(kind)}: ${t}`, rows.filter((r) => r.family === t));
    // "Form Infusion" and "Substance Infusion" are both what an Infusion slot takes.
    const lastWord = (t) => t.split(/\s+/).pop();
    for (const w of new Set(types.map(lastWord))) {
      const sharing = types.filter((t) => lastWord(t) === w);
      if (sharing.length > 1) menu(`${title(kind)}: ${w}`, rows.filter((r) => sharing.includes(r.family)));
    }
  }
  return out.filter((c) => c.name && c.options.length);
}

/** What opens a class's page and is about the class, not something it gains at a level. */
const CLASS_FRONT_MATTER = /^(?:role|alignment|hit dic?e|starting wealth|class skills|skill (?:ranks|points)(?: (?:per|at each) level)?|legendary class|table|parent class(?:es)?|requirements?)\b/i;

/**
 * A page's labelled paragraphs as features: `{name, type, text}`, front matter
 * left out. `front` says which labels are front matter: a class's by default.
 */
function pageFeatures(text, front = CLASS_FRONT_MATTER) {
  const out = [];
  let open = null;
  for (const para of str(text).split(/\n{2,}/)) {
    // A label ends in a colon, so a paragraph without one is not a label.
    const m = para.includes(':') && para.match(/^\*{0,2}([A-Z][^.:*\n]{1,60}?)(?:\s*\((Ex|Su|Sp)(?: or (?:Ex|Su|Sp))?\))?\*{0,2}:\*{0,2}\s+(\S[\s\S]*)$/);
    if (m && !front.test(m[1])) {
      open = { name: m[1].trim(), type: m[2] || '', text: m[3].trim() };
      out.push(open);
    } else if (m) open = null;
    else if (open) open.text += `\n\n${para.trim()}`;
  }
  return out;
}

/**
 * A class a catalogue pack carries as a reference entry, as the building
 * block a player adds.
 *
 * The entry has what the block needs: the infobox's hit die, attack bonus,
 * saves (2 is the good progression) and skill ranks as fields, the class
 * skills as a sentence, and every feature as a labelled paragraph. What it
 * does not have is the class table -- the wiki draws that from a template, so
 * a dump holds no rows -- and the level a feature arrives at is read off its
 * own text instead: the first "Nth level" it mentions, or 1st. A feature that
 * repeats lands once, where it starts; the player spreads it from there.
 */
export function classBlockFromEntry(entry) {
  const name = classNameOf(entry);
  if (!name) return null;
  const fields = fieldMap(entry);
  const hd = Number((fields.get('hit die') || '').replace(/^d/i, ''));
  const features = pageFeatures(entry.text).map((f) => {
    const at = f.text.match(/\b(\d{1,2})(?:st|nd|rd|th)[ -]level\b/i);
    return { level: at ? Number(at[1]) : 1, name: f.type ? `${f.name} (${f.type})` : f.name, text: f.text };
  });
  if (!hd && !features.length) return null;
  const skills = fields.get('class skills') || str(entry.text).match(/^Class Skills:\s*(?:[^\n]*?\bare\s+)?([^\n]+)$/mi)?.[1] || '';
  // The numbers the entry does not state. Adding the class to a sheet that
  // already has it leaves those alone rather than writing defaults over them.
  const unstated = [
    !hd && 'hd', !fields.get('base attack bonus') && 'bab',
    !fields.get('fort save') && 'goodFort', !fields.get('ref save') && 'goodRef', !fields.get('will save') && 'goodWill',
    !Number(fields.get('skill ranks')) && 'skillRanks',
  ].filter(Boolean);
  return normalizeBlock({
    kind: 'class', name, source: str(entry.source),
    hd: hd || 8, bab: fields.get('base attack bonus') || '3/4',
    goodFort: fields.get('fort save') === '2', goodRef: fields.get('ref save') === '2', goodWill: fields.get('will save') === '2',
    skillRanks: Number(fields.get('skill ranks')) || 2,
    classSkills: skills.replace(/\.\s*$/, '').split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((x) => x.replace(/\s*\((?:Str|Dex|Con|Int|Wis|Cha)\)\s*$/i, '').trim()).filter((x) => x && x.length < 40),
    features,
    unstated,
  });
}

/**
 * A class's name off its catalogue entry. A bracket saying the page is a class
 * goes; any other bracket names a different class ("Warlock (Revised)") and stays.
 */
const classNameOf = (entry) => str(entry?.name).replace(/\s*\((?:[\w-]+\s+)?class\)\s*$/i, '').trim();

/** An entry's fields by lower-cased label. */
const fieldMap = (entry) => new Map(arr(entry?.fields).map(([k, v]) => [lower(k), str(v).trim()]));

/** "Scout (Rogue)", "Scout (Monk (Revised))": the name and what its last bracket holds. */
const splitBracket = (s) => {
  const m = str(s).match(/^(.*?)\s*\(((?:[^()]|\([^()]*\))*)\)\s*$/);
  return m ? { name: m[1].trim(), inner: m[2].trim() } : { name: str(s).trim(), inner: '' };
};

/**
 * A labelled paragraph that only suggests what goes well with an archetype
 * ("Rogue Talents: The following rogue talents complement the scout
 * archetype: …"). It is advice, not a feature the archetype grants.
 */
const ARCHETYPE_ADVICE = /^(?:the following|these)\b[^.]*?\b(?:complement|are (?:recommended|suggested|good choices))/i;

/**
 * The archetypes a catalogue pack carries as reference entries, as the blocks
 * a player adds: one per class the entry names (its Class field, or the
 * bracket after its name, "Scout (Rogue)"). Every labelled paragraph is a
 * feature, and what it replaces or alters is read off its own text, as for
 * an archetype block. Familiar and companion archetypes are left to the
 * companion sums.
 */
export function archetypeBlocksFromEntry(entry) {
  const full = str(entry?.name).trim();
  if (!full) return [];
  const { name: bare, inner } = splitBracket(full);
  const stated = fieldMap(entry).get('class') || '';
  const classes = (stated ? stated.split(/\s*,\s*/) : [inner]).map((c) => c.trim()).filter(Boolean)
    .filter((c) => !COMPANION_ARCHETYPE_KINDS.some((k) => k.cls.test(c)));
  if (!classes.length) return [];
  // The bracket is dropped from the name only when it is the class.
  const name = inner && classes.some((c) => lower(c) === lower(inner)) ? bare : full;
  const text = str(entry.text);
  const all = pageFeatures(text);
  const features = all.filter((f) => !ARCHETYPE_ADVICE.test(f.text)).map((f) => ({ name: f.name, type: f.type, text: f.text }));
  if (!features.length) return [];
  // What the page says before its first feature is the archetype's own description.
  const first = text.split(/\n{2,}/).findIndex((p) => p.replace(/^\*+/, '').startsWith(all[0].name));
  const intro = first > 0 ? text.split(/\n{2,}/).slice(0, first).join('\n\n').trim() : '';
  return classes.map((cls) => normalizeBlock({
    kind: 'archetype', name, class: cls, source: str(entry.source), text: intro, features,
  }));
}

/** Labels on a race's page that are its numbers or its description, not traits. */
const RACE_FRONT_MATTER = /^(?:[+\-–−]\s*\d|ability score|(?:normal |slow |fast )?speed$|size$|type$|subtypes?$|languages?$|(?:fine|diminutive|tiny|small|medium|large|huge|gargantuan|colossal)$|physical description|society|relations|alignment(?: and religion)?$|religion$|adventurers$|(?:[\w ]+ )?names$)/i;

const ABILITY_KEYS = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };

/**
 * A race a catalogue pack carries as a reference entry, as the block a player
 * adds. Size, speed, ability modifiers and languages come from its fields
 * ("Ability Score Modifiers: Dex +2, Con -2", "Speed: 30 ft."); its traits are
 * the labelled paragraphs after a "… Racial Traits" line, or the whole page's
 * when it has none, less the ones the fields already say.
 */
export function raceBlockFromEntry(entry) {
  const name = str(entry?.name).trim();
  if (!name) return null;
  const fields = fieldMap(entry);
  const abilityMods = {};
  for (const m of str(fields.get('ability score modifiers')).matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\w*\s*([+\-–−]\s*\d+)/gi)) {
    abilityMods[ABILITY_KEYS[lower(m[1])]] = Number(m[2].replace(/[–−]/, '-').replace(/\s+/g, ''));
  }
  const text = str(entry.text);
  const head = text.search(/^[^\n]*\bracial traits[ \t]*$/im);
  // A trait named for the race itself is the line saying what type of
  // creature it is ("Stoneborn: Stoneborn are humanoids with …").
  const traits = pageFeatures(head >= 0 ? text.slice(head) : text, RACE_FRONT_MATTER)
    .filter((f) => lower(f.name) !== lower(name))
    .map((f) => ({ name: f.type ? `${f.name} (${f.type})` : f.name, text: f.text }));
  const size = (str(fields.get('size')).match(/\b(fine|diminutive|tiny|small|medium|large|huge|gargantuan|colossal)\b/i) || [])[1] || '';
  const speed = Number(str(fields.get('speed')).match(/\d+/)?.[0]) || null;
  if (!traits.length && !size && !speed && !Object.keys(abilityMods).length) return null;
  return normalizeBlock({
    kind: 'race', name, source: str(entry.source),
    size: size ? size[0].toUpperCase() + size.slice(1).toLowerCase() : '',
    speed, abilityMods, traits,
    languages: str(fields.get('languages')).split(/\s*,\s*/).filter(Boolean),
  });
}

/**
 * An alternate racial trait a catalogue pack carries as a reference entry, as
 * the trait block a player adds. Its race is its Race field, and a name
 * written "Dwarf - Stonesinger" loses the race in front.
 */
export function traitBlockFromEntry(entry) {
  const full = str(entry?.name).trim();
  const race = fieldMap(entry).get('race') || '';
  const m = full.match(/^(.+?)\s+-\s+(.+)$/);
  const name = m && (!race || lower(m[1]) === lower(race)) ? m[2].trim() : full;
  if (!name || !str(entry?.text).trim()) return null;
  return normalizeBlock({ kind: 'trait', name, race: race || (m ? m[1].trim() : ''), text: str(entry.text), source: str(entry.source) });
}

/**
 * The catalogue kinds that are also blocks a player adds, and how each entry
 * becomes its blocks. The key says which two blocks are the same one: a block
 * written into a pack wins over one derived from an entry, and between two
 * packs deriving the same block the later pack's stands.
 */
const DERIVED_BLOCKS = [
  { kinds: ['class', 'prestige class'], reading: 'class block', read: (e) => [classBlockFromEntry(e)] },
  { kinds: ['archetype'], reading: 'archetype blocks', read: archetypeBlocksFromEntry },
  { kinds: ['race'], reading: 'race block', read: (e) => [raceBlockFromEntry(e)] },
  { kinds: ['alternate racial trait'], reading: 'trait block', read: (e) => [traitBlockFromEntry(e)] },
];
const derivedKey = (b) => `${b.kind}|${lower(b.name)}|${b.kind === 'archetype' ? lower(b.class) : b.kind === 'trait' ? lower(b.race) : ''}`;

/**
 * The features a class's or an archetype's page describes, by name.
 *
 * A catalogue pack carries a class as one reference entry: its page, whole.
 * Inside it every feature is a paragraph opening with its name and a colon --
 * "Battle Burn (Su): At 5th level…" -- and whatever paragraphs follow before
 * the next such name are still that feature. Read out, they are what "What
 * they do" can offer a ladder that names them.
 *
 * Marked `hidden`: this is text to look up, not a list a column picks from,
 * and it answers only to its own class -- half the classes in a library have
 * an Evasion.
 */
export function classFeatureTextFromTables(tables) {
  const out = [];
  for (const cat of arr(tables?.catalogues?.catalogues)) {
    const kind = lower(cat?.kind);
    if (kind !== 'class' && kind !== 'prestige class' && kind !== 'archetype') continue;
    for (const e of arr(cat.entries)) {
      out.push(...readEntry(e, `features of ${kind}`, () => {
        const name = str(e?.name).trim();
        if (!name) return [];
        const fields = new Map(arr(e?.fields).map(([k, v]) => [lower(k), str(v).trim()]));
        // An archetype may be open to several classes, and is each one's.
        const classes = kind === 'archetype' ? (fields.get('class') || '').split(',').map((s) => s.trim()).filter(Boolean) : [name];
        if (!classes.length) return [];
        const category = kind === 'archetype' ? `${name} archetype` : name;
        const options = pageFeatures(e.text).map((f) => ({ ...f, category, source: str(e.source) }));
        return (options.length ? classes : []).map((cls) => ({
          name: `${name} — features${classes.length > 1 ? ` (${cls})` : ''}`, class: cls, feature: '', text: '',
          hidden: true, archetype: kind === 'archetype', options: normalizeOptions(options, ''),
        }));
      }));
    }
  }
  return out;
}

/** A class table column that is a spell level: "0", "1st" … "9th". */
const SPELL_LEVEL_COLUMN = /^(?:0|0th|[1-9](?:st|nd|rd|th))$/i;

/**
 * A class's casting table, read off the tables on its page, in a casting
 * pack's shape: one row per class level, ten cells (spell levels 0 to 9),
 * null where the table has no entry. Slots per day come from the table whose
 * spell columns sit under "Spells Per Day" (the class table); spells known
 * from one under or after a "Spells Known" or "Spells Prepared" line. A cell written "1+1" is one
 * slot and one bonus slot (a domain slot), kept as `bonus`. Null when the
 * page has no spell columns.
 */
export function castingTableFromText(name, text) {
  const lines = str(text).split('\n');
  const isRow = (l) => /^\s*\|/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const blank = () => Array(10).fill(null);
  const grids = {};
  for (let i = 0; i < lines.length;) {
    if (!isRow(lines[i])) { i++; continue; }
    const start = i;
    while (i < lines.length && isRow(lines[i])) i++;
    const rows = lines.slice(start, i).map(cells);
    const head = rows.findIndex((r) => /^level$/i.test(r[0]) && r.some((c) => SPELL_LEVEL_COLUMN.test(c)));
    if (head < 0) continue;
    // What the table counts: its own heading rows say, or else the lines above it.
    const over = rows.slice(0, head).flat().join(' ');
    // A hybrid caster's "Spells Prepared" table is its daily list, read as known.
    const label = /\bknown\b|\bprepared\b|\bper day\b/i.test(over) ? over : lines.slice(Math.max(0, start - 2), start).join(' ');
    const kind = /\bknown\b|\bprepared\b/i.test(label) && !/\bper day\b/i.test(label) ? 'known' : 'perDay';
    if (grids[kind]) continue;
    const cols = rows[head].map((c) => (SPELL_LEVEL_COLUMN.test(c) ? parseInt(c, 10) : -1));
    const counts = [];
    const extra = [];
    for (const r of rows.slice(head + 1)) {
      const level = Number(str(r[0]).match(/^(\d{1,2})(?:st|nd|rd|th)$/i)?.[1]);
      if (!level || level > 20) continue;
      counts[level - 1] = blank();
      extra[level - 1] = blank();
      cols.forEach((spell, k) => {
        if (spell < 0) return;
        const m = str(r[k]).replace(/[*†¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '').match(/^(\d+)(?:\s*\+\s*(\d+))?$/);
        if (!m) return;
        counts[level - 1][spell] = Number(m[1]);
        if (m[2]) extra[level - 1][spell] = Number(m[2]);
      });
    }
    if (!counts.length) continue;
    for (let l = 0; l < counts.length; l++) { counts[l] ||= blank(); extra[l] ||= blank(); }
    grids[kind] = counts;
    if (kind === 'perDay' && extra.some((r) => r.some((v) => v !== null))) grids.bonus = extra;
  }
  if (!grids.perDay) return null;
  return { name, perDay: grids.perDay, known: grids.known || null, ...(grids.bonus ? { bonus: grids.bonus } : {}) };
}

/**
 * The casting tables catalogue packs carry inside their class pages, one per
 * class whose page has spell columns. Between two packs with the same class,
 * the later one's stands.
 */
export function castingTablesFromTables(tables) {
  const out = new Map();
  for (const cat of arr(tables?.catalogues?.catalogues)) {
    const kind = lower(cat?.kind);
    if (kind !== 'class' && kind !== 'prestige class') continue;
    for (const e of arr(cat.entries)) {
      const t = readEntry(e, 'casting table', () => castingTableFromText(classNameOf(e), e?.text));
      if (t?.name) out.set(lower(t.name), t);
    }
  }
  return [...out.values()];
}

/**
 * Named rules text the active packs carry, for the model's ability registry.
 *
 * A companion's table hands out abilities by name and nothing else -- "Evasion"
 * at 3rd, "Devotion" at 6th -- and what they *do* is somebody else's prose, so
 * the engine has none of it. A pack supplies it, and this is how: any `feature`
 * or `note` block whose name matches is that ability's rules text. Those are
 * the two kinds that are a name and a paragraph and nothing else.
 *
 * Looked up by name, never copied onto a character -- the same bargain the
 * option menus above are on, and for the same reason: a character that had
 * swallowed a pack's text would carry it to whoever it was sent to.
 */
export function namedTextFrom(blocks) {
  const out = [];
  for (const b of arr(blocks)) {
    const kind = lower(b?.kind);
    if (kind !== 'feature' && kind !== 'note') continue;
    const name = str(b.name).trim();
    const text = str(b.text);
    if (!name || !text.trim()) continue;
    out.push({ name, text, source: str(b.source).trim(), pack: str(b.extName).trim() });
  }
  return out;
}

/**
 * The companion kind an archetype is for, by what its pack calls it: the
 * books' lists name them "Valet (Familiar)" and "Bodyguard (Companion)", and a
 * hand-made archetype block names its class "Familiar" or "Animal Companion".
 */
const COMPANION_ARCHETYPE_KINDS = [
  { kind: 'familiar', suffix: /\s*\(familiar\)\s*$/i, cls: /^familiar$/i, className: 'familiar' },
  { kind: 'animalCompanion', suffix: /\s*\((?:animal )?companion\)\s*$/i, cls: /^(?:animal )?companion$/i, className: 'animal companion' },
];

/**
 * Familiar and animal companion archetypes the active packs carry, for the
 * companion sums: each one's features with the level they arrive at and the
 * table abilities they replace or change.
 *
 * A catalogue pack keeps one as a page of text, read the way a class
 * archetype's page is (`pageFeatures`): every "Name (Ex): …" paragraph is a
 * feature, and its own "This replaces alertness." says what it takes. An
 * archetype block says the same with fields. Looked up by name and never
 * copied onto a character, like the ability text above.
 */
export function companionArchetypesFrom(tables, blocks) {
  const out = [];
  const add = (kind, block, pack) => {
    const b = normalizeBlock(block);
    if (!b?.name || !b.features.length) return;
    out.push({
      kind, name: b.name, source: str(b.source).trim(), pack: str(pack).trim(),
      features: b.features.map((f) => ({
        name: f.name, type: f.type, level: f.level, text: f.text, replaces: f.replaces, alters: f.alters,
      })),
    });
  };
  for (const cat of arr(tables?.catalogues?.catalogues)) {
    if (lower(cat?.kind) !== 'archetype') continue;
    for (const e of arr(cat.entries)) {
      const name = str(e?.name).trim();
      const of = COMPANION_ARCHETYPE_KINDS.find((k) => k.suffix.test(name));
      if (!of) continue;
      add(of.kind, {
        kind: 'archetype', name: name.replace(of.suffix, '').trim(), class: of.className, source: e.source,
        features: pageFeatures(e.text).map((f) => ({ name: f.name, type: f.type, text: f.text })),
      }, '');
    }
  }
  for (const b of arr(blocks)) {
    if (lower(b?.kind) !== 'archetype') continue;
    const of = COMPANION_ARCHETYPE_KINDS.find((k) => k.cls.test(str(b.class ?? b.className).trim()));
    if (of) add(of.kind, { ...b, class: of.className }, b.extName);
  }
  return out;
}

/** A race trait fills an empty slot before it appends, since a blank sheet ships three. */
function addRaceTrait(model, { name, text, replaced = null }) {
  const traits = model.list('raceTraits');
  const empty = traits.findIndex((t) => !str(t?.name).trim() && !str(t?.text).trim());
  const row = replaced && replaced.length ? { name, text, replaced } : { name, text };
  if (empty === -1) model.listAdd('raceTraits', row);
  else {
    model.setItem('raceTraits', empty, 'name', name);
    model.setItem('raceTraits', empty, 'text', text);
    if (row.replaced) traits[empty].replaced = row.replaced;
    else delete traits[empty].replaced;
    model.recompute();
  }
}

/**
 * An alternate racial trait takes the place of what it replaces.
 *
 * The rows it names are removed and remembered on the new row (`replaced`),
 * so a later alternate that overlaps can undo exactly the right amount: if
 * X replaced A and B, and N (an alternate to A) is then added, N displaces X,
 * takes A into its own history, and B -- which N does not replace -- comes
 * back as the standard trait it was. A trait that names nothing on the sheet
 * is simply added, and the message says what was not found.
 */
export function applyAlternateTrait(model, block) {
  const rows = model.list('raceTraits');
  if (rows.some((r) => lower(r.name) === lower(block.name))) return `${block.name} is already on the sheet.`;
  const wanted = new Set(block.replaces.map(lower));
  const found = new Set();
  const taken = [];       // standard traits this one now holds
  const restored = [];    // standard traits an overlapping alternate had held, given back
  const displaced = [];   // alternates removed because this one overlaps them
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const nm = lower(row.name);
    if (!nm) continue;
    if (wanted.has(nm)) {
      found.add(nm);
      taken.unshift({ name: row.name, text: row.text });
      model.listRemove('raceTraits', i);
      continue;
    }
    const held = Array.isArray(row.replaced) ? row.replaced : [];
    if (held.some((h) => wanted.has(lower(h.name)))) {
      const t = [];
      const r = [];
      for (const h of held) {
        if (wanted.has(lower(h.name))) { found.add(lower(h.name)); t.push(h); } else r.push(h);
      }
      taken.unshift(...t);
      restored.unshift(...r);
      displaced.unshift(row.name);
      model.listRemove('raceTraits', i);
    }
  }
  for (const h of restored) addRaceTrait(model, h);
  addRaceTrait(model, { name: block.name, text: block.text, replaced: taken });
  const missing = block.replaces.filter((n) => !found.has(lower(n)));
  const parts = [`Added ${block.name}`];
  if (taken.length) parts.push(`replacing ${taken.map((t) => t.name).join(' and ')}`);
  if (displaced.length) parts.push(`displacing ${displaced.join(' and ')}${restored.length ? ` (${restored.map((t) => t.name).join(' and ')} restored)` : ''}`);
  if (missing.length) parts.push(`(${missing.join(', ')} not on the sheet)`);
  return `${parts.join(', ')}.`;
}

/* ---------------- archetypes on a character ---------------- */

/**
 * The class row an archetype applies to: the one named, or the only class
 * on the sheet when the block names none. Returns [index, row] or [-1, null].
 */
function classRowFor(model, className) {
  const classes = model.list('classes');
  if (className) {
    const i = classes.findIndex((c) => lower(c.name) === lower(className));
    if (i !== -1) return [i, classes[i]];
    // "Legendary Samurai" on the block, "Legendary Samurai (Ronin)" or a typo on the sheet
    const j = classes.findIndex((c) => lower(c.name).startsWith(lower(className)) || lower(className).startsWith(lower(c.name)));
    if (j !== -1) return [j, classes[j]];
    return [-1, null];
  }
  const named = classes.map((c, i) => [i, c]).filter(([, c]) => str(c.name).trim());
  return named.length === 1 ? named[0] : [-1, null];
}

/**
 * Where an archetype stands against a character before it is applied:
 *   { ok: true }                          -- can be added
 *   { ok: false, reason: 'applied' }      -- already on the class
 *   { ok: false, reason: 'no-class', … }  -- its class is not on the sheet
 *   { ok: false, reason: 'conflict', with: 'Oni Warrior', shared: ['challenge'] }
 * Two archetypes conflict when they touch the same feature -- replace or
 * alter -- unless one of them says it can be combined with the other.
 */
export function archetypeStatus(model, block) {
  const b = normalizeBlock(block);      // idempotent, and a raw block gets its swaps read
  const [, row] = classRowFor(model, b.class);
  if (!row) return { ok: false, reason: 'no-class', className: b.class || '(a single class)' };
  const stack = Array.isArray(row.archetypeStack) ? row.archetypeStack : [];
  if (stack.some((e) => lower(e.name) === lower(b.name))) return { ok: false, reason: 'applied' };
  const mine = archetypeTouches(b);
  const allowed = (a, c) => arr(a.stacksWith).some((n) => lower(n) === lower(c.name) || lower(c.name).startsWith(lower(n)) || lower(n).startsWith(lower(c.name)));
  for (const e of stack) {
    if (allowed(b, e) || allowed(e, b)) continue;
    // Two archetypes taking different grants of one feature -- the 10th and
    // the 14th warrior's grace -- do not meet; one taking the whole feature
    // meets either of them.
    const shared = arr(e.touches).filter((k) => [...mine].some((m) => swapsMeet(k, m))).map(swapLabel);
    if (shared.length) return { ok: false, reason: 'conflict', with: e.name, shared: [...new Set(shared)] };
  }
  return { ok: true, className: row.name };
}

/*
 * The archetype blocks in a list of blocks, by the class each names, with
 * where each sits in the list. runtime.blocks() answers with the same array
 * until a pack changes, so this is worked out once per change of packs and
 * not once per keystroke in an Archetypes cell.
 */
const ARCHETYPES_BY_CLASS = new WeakMap();
function archetypesByClass(blocks) {
  let held = ARCHETYPES_BY_CLASS.get(blocks);
  if (!held) {
    held = new Map();
    arr(blocks).forEach((b, at) => {
      if (b?.kind !== 'archetype' || !str(b.name).trim()) return;
      const k = lower(b.class);
      if (!held.has(k)) held.set(k, { className: str(b.class).trim(), list: [] });
      held.get(k).list.push({ b, at });
    });
    ARCHETYPES_BY_CLASS.set(blocks, held);
  }
  return held;
}

/**
 * The archetypes these blocks offer for row `index` of the Classes table:
 * each one whose class is that row, the row applyArchetype adds it to, less
 * the ones already on it. In the blocks' order, so the pack loaded last
 * comes last.
 */
export function archetypesForClassRow(model, blocks, index) {
  const row = model.list('classes')?.[index];
  if (!row || !str(row.name).trim()) return [];
  const on = new Set(arr(row.archetypeStack).map((e) => lower(e.name)));
  const out = [];
  for (const { className, list } of archetypesByClass(blocks).values()) {
    if (classRowFor(model, className)[0] !== index) continue;
    for (const hit of list) if (!on.has(lower(hit.b.name))) out.push(hit);
  }
  return out.sort((a, z) => a.at - z.at).map((hit) => hit.b);
}

/**
 * The archetype a name typed into row `index`'s Archetypes cell is, or null.
 * When several for that row have the name, the one whose class is the row's
 * own name wins, then the one from the pack loaded last.
 */
export function archetypeNamed(model, blocks, index, name) {
  const want = lower(name);
  if (!want) return null;
  const hits = archetypesForClassRow(model, blocks, index).filter((b) => lower(b.name) === want);
  if (hits.length < 2) return hits[0] || null;
  const rowName = lower(model.list('classes')[index].name);
  const exact = hits.filter((b) => lower(b.class) === rowName);
  return (exact.length ? exact : hits).at(-1);
}

/**
 * Write what was typed into row `index`'s Archetypes cell. Each name it adds
 * that is an archetype the blocks offer for the class is added as from
 * Extension blocks (applyArchetype), under the name its pack gives it; the
 * rest stays text. The text and the archetypes are one undo step. Returns
 * what applyArchetype said, or '' when the cell only changed as text.
 */
export function typeArchetypes(model, index, value, blocks) {
  const row = model.list('classes')?.[index];
  if (!row) return '';
  const names = (s) => str(s).split(',').map((n) => n.trim()).filter(Boolean);
  const had = new Set(names(row.archetypes).map(lower));
  const typed = names(value);
  const picks = new Map();
  for (const n of typed) {
    if (had.has(lower(n)) || picks.has(lower(n))) continue;
    const b = archetypeNamed(model, blocks, index, n);
    if (b) picks.set(lower(n), b);
  }
  const fits = [...picks.values()].filter((b) => archetypeStatus(model, b).ok);
  if (!fits.length) {
    // None can go on: the text is kept as typed, and the note says why.
    model.setItem('classes', index, 'archetypes', value);
    return [...picks.values()].map((b) => applyArchetype(model, b)).join(' ');
  }
  const text = typed.map((n) => picks.get(lower(n))?.name ?? n).join(', ');
  return asOneUndo(model, `Added ${fits.map((b) => b.name).join(' and ')} to ${row.name}`, () => {
    model.setItem('classes', index, 'archetypes', text);
    return [...picks.values()].map((b) => applyArchetype(model, b)).join(' ');
  });
}

/** The names in a Progression "Special" cell; null when the cell is a rule-group map this must not touch. */
function cellNames(cell) {
  if (cell === undefined || cell === null || cell === '') return [];
  if (typeof cell !== 'string') return null;
  return cell.split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
}

/** A feature cell's text whatever shape it is stored in. */
const cellString = (v) => (v && typeof v === 'object'
  ? Object.values(v).map((x) => str(x).trim()).filter(Boolean).join(', ')
  : str(v).trim());

/**
 * Where one swap key sits on a class's ladder, found without changing it:
 * the Special cells that name it (`{level, name}`, level being the row's
 * key), the index of the feature column it has (-1 for none) and the indexes
 * of its notes. A key naming one grant ("bonus feat@6") looks only at that
 * class level's row, and has no notes: the feature stands, one grant fewer.
 * A class level the Planner does not reach yet is looked for under its own
 * number, which is where a class's pack writes it.
 */
function ladderHits(model, className, key) {
  const group = model.data.progression?.classFeatures?.[className] || null;
  const base = swapBase(key);
  const at = swapLevel(key);
  const rows = model.classFeatureRows(className);
  const charAt = at === null ? null : (rows.find((r) => r.classLevel === at)?.key ?? at);
  const cells = [];
  for (const [level, row] of Object.entries(group?.byLevel || {})) {
    if (charAt !== null && Number(level) !== charAt) continue;
    for (const n of cellNames(row?.Special) || []) if (swapKey(n, className) === base) cells.push({ level: Number(level), name: n });
  }
  const column = (group?.columns || []).findIndex((c) => c !== 'Special' && swapKey(c, className) === base);
  const notes = at !== null ? [] : model.classFeatureNotes(className)
    .map((n, i) => (swapKey(n.name, className) === base ? i : -1)).filter((i) => i !== -1);
  return { base, at, charAt, rows, cells, column, notes };
}

/**
 * Where each of a list of swap keys is on a class's ladder, before anything is
 * swapped: `{key, name, levels, found}`. `name` is the ladder's own spelling
 * where it has one; `levels` are the Planner levels it sits at. A feature that
 * only has a note is found at no level.
 */
export function swapReach(model, className, keys) {
  const group = model.data.progression?.classFeatures?.[className] || null;
  return (keys || []).map((key) => {
    const h = ladderHits(model, className, key);
    const levelOf = (k) => Math.floor(h.rows.find((r) => r.key === k)?.level ?? k);
    const levels = new Set(h.cells.map((c) => levelOf(c.level)));
    let name = h.cells[0]?.name || '';
    let found = h.cells.length > 0 || h.notes.length > 0;
    if (h.column !== -1) {
      const col = group.columns[h.column];
      name ||= col;
      if (h.at !== null) {
        if (grantingGroupAt(model, className, col, h.at) !== null) {
          found = true;
          levels.add(levelOf(h.charAt));
        }
      } else {
        // Where the column grants: its schedule's levels, or the rows it has
        // text on. Levels past the Planner's count too, as the swap takes them.
        found = true;
        const groups = model.classFeatureRuleGroups(className, col);
        const levelAt = (classLevel) => Math.floor(h.rows.find((r) => r.classLevel === classLevel)?.level ?? classLevel);
        for (const grp of groups) for (const l of levelRuleLevels(grp.rule || '')) levels.add(levelAt(l));
        if (!groups.length) {
          for (const [k, cells] of Object.entries(group.byLevel || {})) if (cellString(cells?.[col])) levels.add(levelOf(Number(k)));
        }
      }
    }
    if (!name && h.notes.length) name = model.classFeatureNotes(className)[h.notes[0]].name;
    return { key, name: name || swapBase(key), levels: [...levels].sort((a, b) => a - b), found };
  });
}

/**
 * What one archetype on a class changed on its ladder, read from its own
 * record: `lost` and `gained` as `{key, level, name, column, feature}` (`key`
 * the row it sits on, `level` the Planner level shown for it, `column` the
 * feature column that lost one grant, null for a name in Special or a whole
 * column gone, and `feature` the feature it is a grant of), the notes it took
 * out and put in, and what it could not find. A package swap is an
 * archetype, so this covers both.
 */
export function archetypeChanges(model, className, e) {
  const rows = model.classFeatureRows(className);
  const keyOf = (classLevel) => rows.find((r) => r.classLevel === classLevel)?.key ?? classLevel;
  // The Planner level a row key is shown at, as the ladder's Lvl column says it.
  const item = (key, name, column, feature = name) => ({
    key, level: Math.floor(rows.find((r) => r.key === key)?.level ?? key), name, column, feature,
  });
  const lost = [];
  for (const c of e?.removedCells || []) if (!c.column) lost.push(item(c.level, c.name, null));
  for (const r of e?.ruleEdits || []) lost.push(item(keyOf(r.level), r.column, r.column));
  for (const col of e?.removedColumns || []) {
    // Where it granted: its schedule's levels, or the rows it had text on.
    const keys = new Set();
    for (const grp of col.rules || []) for (const l of levelRuleLevels(grp.rule || '')) keys.add(keyOf(l));
    if (!(col.rules || []).length) for (const k of Object.keys(col.cells || {})) keys.add(Number(k));
    for (const k of keys) {
      const had = cellString(col.cells?.[k]);
      const name = had && swapKey(had, className) !== swapKey(col.name, className) ? `${col.name} (${had})` : col.name;
      lost.push(item(k, name, null, col.name));
    }
  }
  return {
    lost,
    gained: (e?.addedCells || []).map((c) => item(c.level, c.name, null)),
    lostNotes: e?.removedNotes || [],
    gainedNotes: e?.addedNotes || [],
    notFound: e?.notFound || [],
  };
}

/**
 * Everything the archetypes on a class changed, for the ladder to mark:
 * `cells` maps a row key to `{lost, gained}`, each item carrying `by`
 * (`{name, package}`, the archetype or swap that did it); `lostNotes` are the
 * notes they took out, and `gainedNotes` maps a note's name, in lower case, to
 * the `by` that put it in.
 */
export function archetypeMarks(model, className) {
  const row = (model.data.classes || []).find((c) => lower(c?.name) === lower(className));
  const cells = new Map();
  const at = (k) => {
    if (!cells.has(k)) cells.set(k, { lost: [], gained: [] });
    return cells.get(k);
  };
  const lostNotes = [];
  const gainedNotes = new Map();
  for (const e of arr(row?.archetypeStack)) {
    const by = { name: e.name, package: e.package || null };
    const ch = archetypeChanges(model, className, e);
    for (const l of ch.lost) at(l.key).lost.push({ ...l, by });
    for (const g of ch.gained) at(g.key).gained.push({ ...g, by });
    for (const n of ch.lostNotes) lostNotes.push({ ...n, by });
    for (const n of ch.gainedNotes) gainedNotes.set(lower(n), by);
  }
  return { cells, lostNotes, gainedNotes };
}

/**
 * Apply an archetype to its class on a character.
 *
 * For each of its features: the class features it replaces leave every
 * Progression cell they sit in and the class's Template group (recorded), the
 * new feature goes into the cell at its own level and into the group with its
 * text; a feature that only alters keeps the original beside it. Everything
 * done is written to the class row's `archetypeStack` so `removeArchetype`
 * can put it back exactly, and the row's free-text `archetypes` field names
 * it for the header line.
 */
export function applyArchetype(model, block) {
  const b = normalizeBlock(block);      // idempotent, and a raw block gets its swaps read
  const status = archetypeStatus(model, b);
  if (!status.ok) {
    if (status.reason === 'applied') return `${b.name} is already on ${b.class || 'the class'}.`;
    if (status.reason === 'no-class') return `${b.name} needs ${status.className} on the Classes table first.`;
    return `${b.name} cannot be added: it and ${status.with} both change ${status.shared.join(', ')}.`;
  }
  // Each note it takes out marks its own undo; the whole archetype is one step.
  return asOneUndo(model, `Added ${b.name} to ${status.className}`, () => addArchetype(model, b));
}

/** applyArchetype once it is known to fit. */
function addArchetype(model, b) {
  const [ci, row] = classRowFor(model, b.class);
  const className = row.name;
  const d = model.data;
  const group = d.progression?.classFeatures?.[className] || null;
  const entry = {
    name: b.name, class: className, touches: [...archetypeTouches(b)], stacksWith: [...(b.stacksWith || [])],
    removedCells: [],      // {level, name} taken out of Progression cells
    removedColumns: [],    // whole feature columns a replaced repeat feature had
    ruleEdits: [],         // {column, group, rule} a level taken off a schedule
    addedMenus: [],        // {column, menu} an archetype's own menu layered on
    addedCells: [],        // {level, name} written into Progression cells
    removedNotes: [],      // {name, type, text} taken out of the class's own text
    addedNotes: [],        // names written into it
    notFound: [],
    // a package swap's own record: what was given up and taken (packages.js)
    ...(b.package ? { package: structuredClone(b.package) } : {}),
  };
  const removeKey = (key) => {
    const { base, at, charAt, cells: found, column: ci2, notes: noteHits } = ladderHits(model, className, key);
    let hit = false;
    if (group) {
      for (const level of new Set(found.map((c) => c.level))) {
        const names = cellNames(group.byLevel?.[level]?.Special) || [];
        hit = true;
        for (const c of found) if (c.level === level) entry.removedCells.push(c);
        model.setClassFeature(className, level, 'Special', names.filter((n) => swapKey(n, className) !== base).join(', '));
      }
      if (ci2 !== -1 && at !== null) {
        // One grant of a repeat feature: the column stays and its schedule
        // loses that level, which is what the rule language's "-10" is for.
        // A level the column never granted is not a swap that happened.
        if (dropRuleLevel(model, className, ci2, at, entry)) {
          hit = true;
          // whatever had been picked at that level is kept, to put back
          const had = charAt === null ? '' : group.byLevel?.[charAt]?.[group.columns[ci2]];
          if (typeof had === 'string' && had.trim()) {
            entry.removedCells.push({ level: charAt, column: group.columns[ci2], name: had });
            model.setClassFeature(className, charAt, group.columns[ci2], '');
          }
        }
      } else if (ci2 !== -1) {
        // The whole feature: the column goes -- its schedule, its menu and
        // whatever was written in it, kept whole for putting back.
        const col = group.columns[ci2];
        hit = true;
        entry.removedColumns.push({
          name: col,
          at: ci2,
          rules: structuredClone(group.rules?.[col] || []),
          optionsFrom: structuredClone(group.optionsFrom?.[col] ?? null),
          cells: Object.fromEntries(Object.entries(group.byLevel || {})
            .filter(([, cells]) => cells?.[col] !== undefined)
            .map(([level, cells]) => [level, structuredClone(cells[col])])),
        });
        model.removeClassFeatureColumn(className, ci2);
      }
    }
    // A named grant leaves the feature's text where it is: the feature stands,
    // it simply arrives one time fewer.
    const notes = model.classFeatureNotes(className);
    for (const i of [...noteHits].reverse()) {
      hit = true;
      entry.removedNotes.push({ name: notes[i].name, type: notes[i].type ?? null, text: notes[i].text || '' });
      model.removeClassFeatureNote(className, i);
    }
    return hit;
  };
  const addCell = (level, name) => {
    if (!group && !d.progression) return;
    const names = cellNames(d.progression?.classFeatures?.[className]?.byLevel?.[level]?.Special);
    if (names === null) return;
    if (names.some((n) => lower(n) === lower(name))) return;
    model.setClassFeature(className, level, 'Special', [...names, name].join(', '));
    entry.addedCells.push({ level, name });
  };
  // An archetype's feature text joins the class's own, under its ladder.
  const addNote = (f) => {
    if (model.classFeatureNotes(className).some((x) => lower(x.name) === lower(f.name))) return;
    model.addClassFeatureNote(className, { name: f.name, type: f.type, text: f.text });
    entry.addedNotes.push(f.name);
  };

  for (const f of b.features) {
    for (const key of f.replaces) {
      const said = swapLabel(key);
      if (!removeKey(key) && !entry.notFound.includes(said)) entry.notFound.push(said);
    }
    addCell(f.level || 1, f.name);
    addNote(f);
    // A menu of options -- talents, techniques -- is a catalogue in its own
    // pack, never copied onto a character. Where the feature it alters has a
    // column, the menu is layered onto it: the archetype's entries win, the
    // base ones its text replaces drop out, and the rest of the class's stands.
    if (f.options && f.options.length) {
      const wants = [...f.alters, ...f.replaces];
      const col = (d.progression?.classFeatures?.[className]?.columns || [])
        .find((c) => c !== 'Special' && wants.includes(swapKey(c, className)));
      if (col) {
        model.addClassFeatureColumnOptions(className, col, archetypeMenuName(b.name, f.name));
        entry.addedMenus.push({ column: col, menu: archetypeMenuName(b.name, f.name) });
      }
    }
  }
  // A track the archetype changes -- the armiger's customized weapons learning
  // magical spheres beside martial ones. Only ever a change to a track that is
  // already there: the counting rules belong to the class, and an archetype
  // that only widens a sphere list has none of its own to invent them from.
  if (b.tracks) {
    const track = model.customizationFor(className);
    if (track) entry.trackSpec = model.setCustomizationSpec(className, { ...track.spec, ...b.tracks });
    else entry.trackNoTrack = true;
  }
  const stack = Array.isArray(row.archetypeStack) ? row.archetypeStack : [];
  row.archetypeStack = [...stack, entry];
  const tag = str(row.archetypes).trim();
  const tags = tag ? tag.split(/,\s*/) : [];
  if (!tags.some((t) => lower(t) === lower(b.name))) model.setItem('classes', ci, 'archetypes', [...tags, b.name].join(', '));
  model.recompute();
  const parts = [`Added ${b.name} to ${className}`];
  // A feature replaced outright is named; grants replaced one at a time are
  // named with the levels, since which of them went is the whole point.
  const took = [...new Set([...entry.removedCells.filter((c) => !c.column).map((c) => c.name),
    ...entry.removedColumns.map((c) => c.name)])];
  const byColumn = new Map();
  for (const r of entry.ruleEdits) byColumn.set(r.column, [...(byColumn.get(r.column) || []), r.level]);
  for (const [col, levels] of byColumn) took.push(`${col} at ${levels.sort((a, z) => a - z).map(ordinal).join(' and ')}`);
  if (took.length) parts.push(`replacing ${took.join(', ')}`);
  const altered = [...new Set(b.features.flatMap((f) => f.alters))];
  if (altered.length) parts.push(`altering ${altered.join(', ')}`);
  if (entry.trackSpec) parts.push(`and changing what its customized ${entry.trackSpec.unit || 'weapon'}s may learn`);
  if (entry.trackNoTrack) parts.push(`(it changes ${className}'s talent track, which is not on this sheet yet)`);
  if (entry.notFound.length) parts.push(`(${entry.notFound.join(', ')} not on the sheet)`);
  return `${parts.join(', ')}.`;
}

/** Take an archetype off its class again, restoring what it replaced from its own record. */
export function removeArchetype(model, className, name) {
  const [ci, row] = classRowFor(model, className);
  if (!row) return `${className} is not on the Classes table.`;
  const stack = Array.isArray(row.archetypeStack) ? row.archetypeStack : [];
  const at = stack.findIndex((e) => lower(e.name) === lower(name));
  if (at === -1) return `${name} is not on ${row.name}.`;
  return asOneUndo(model, `Removed ${stack[at].name || 'the archetype'} from ${row.name}`, () => takeOffArchetype(model, ci, row, stack, at));
}

/** removeArchetype once the entry is found. */
function takeOffArchetype(model, ci, row, stack, at) {
  const e = stack[at];
  const cls = row.name;
  const d = model.data;
  // its own additions go
  for (const { level, name: n } of e.addedCells) {
    const names = cellNames(d.progression?.classFeatures?.[cls]?.byLevel?.[level]?.Special);
    if (!names) continue;
    model.setClassFeature(cls, level, 'Special', names.filter((x) => lower(x) !== lower(n)).join(', '));
  }
  for (const n of e.addedNotes || []) {
    const i = model.classFeatureNotes(cls).findIndex((x) => lower(x.name) === lower(n));
    if (i !== -1) model.removeClassFeatureNote(cls, i);
  }
  // the menus it layered come off, before the columns they sat on move
  for (const { column, menu } of e.addedMenus || []) model.removeClassFeatureColumnOptions(cls, column, menu);
  // a schedule it took a level off gets the level back
  for (const { column, group, level } of e.ruleEdits || []) restoreRuleLevel(model, cls, column, group, level);
  // what it took comes back
  for (const { level, column, name: n } of e.removedCells) {
    if (column) { model.setClassFeature(cls, level, column, n); continue; }
    const names = cellNames(d.progression?.classFeatures?.[cls]?.byLevel?.[level]?.Special) || [];
    if (!names.some((x) => lower(x) === lower(n))) model.setClassFeature(cls, level, 'Special', [...names, n].join(', '));
  }
  for (const col of e.removedColumns || []) {
    model.addClassFeatureColumn(cls, col.name, col.at ?? null);
    const index = (d.progression?.classFeatures?.[cls]?.columns || []).indexOf(col.name);
    if (index === -1) continue;
    for (const grp of col.rules || []) model.addClassFeatureRuleGroup(cls, index, grp);
    if (col.optionsFrom) model.setClassFeatureColumnOptions(cls, index, col.optionsFrom);
    for (const [level, cell] of Object.entries(col.cells || {})) {
      if (cell && typeof cell === 'object') {
        for (const [key, text] of Object.entries(cell)) model.setClassFeature(cls, Number(level), col.name, text, key);
      } else model.setClassFeature(cls, Number(level), col.name, cell);
    }
  }
  for (const f of e.removedNotes || []) model.addClassFeatureNote(cls, f);
  // and a talent track it widened goes back to what the class states
  if (e.trackSpec) model.setCustomizationSpec(cls, e.trackSpec);
  // a package swap's casting class goes with it
  if (e.package?.casting) {
    const vi = (d.vancian?.classes || []).findIndex((c) => lower(c?.name) === lower(e.package.casting));
    if (vi !== -1) model.listRemove('vancian.classes', vi);
    // the Vancian mark and tab it turned on, unless something else uses them now
    if (e.package.taggedVancian && (row.systems || []).includes('vancian')
      && !(d.vancian?.classes || []).some((c) => lower(c?.levelClass) === lower(cls))) model.toggleClassSystem(ci, 'vancian');
    if (e.package.shownTab && !(d.vancian?.classes || []).length) model.hideTab('vancian');
  }
  row.archetypeStack = stack.filter((_, i) => i !== at);
  if (!row.archetypeStack.length) delete row.archetypeStack;
  const tags = str(row.archetypes).split(/,\s*/).map((t) => t.trim()).filter((t) => t && lower(t) !== lower(e.name));
  model.setItem('classes', ci, 'archetypes', tags.join(', '));
  model.recompute();
  const back = [...new Set([...e.removedCells.map((c) => c.name), ...(e.ruleEdits || []).map((r) => r.column),
    ...(e.removedColumns || []).map((c) => c.name)].filter(Boolean))];
  return `Removed ${e.name} from ${cls}${back.length ? `; ${back.join(', ')} restored` : ''}.`;
}

/* ---------------- packing a character's own content ---------------- */

/**
 * The reverse trip: lift blocks out of a live character, so a player who has
 * built something by hand can share it. Returns blocks, not a pack -- the
 * caller puts them in one.
 */
export function blocksFromCharacter(data, { classes = true, race = true, templates = true, trackers = true } = {}) {
  const out = [];
  const d = obj(data);
  if (classes) {
    for (const c of arr(d.classes)) {
      if (!str(c.name).trim()) continue;
      out.push(normalizeBlock({
        kind: 'class', name: c.name, hd: c.hd, bab: c.bab, goodFort: c.goodFort, goodRef: c.goodRef,
        goodWill: c.goodWill, skillRanks: c.skillRanks, archetypes: c.archetypes,
      }));
    }
  }
  if (race && str(d.identity?.race).trim()) {
    out.push(normalizeBlock({
      kind: 'race', name: d.identity.race, size: d.identity.size,
      abilityMods: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => [k, d.statsBuild?.[k]?.race || 0])),
      traits: arr(d.raceTraits).filter((t) => str(t?.name).trim()),
    }));
  }
  if (templates) {
    for (const t of arr(d.templates)) {
      if (!arr(t.features).length) continue;
      out.push(normalizeBlock({ kind: 'template', name: t.name, features: t.features }));
    }
  }
  if (trackers) {
    for (const t of arr(d.customTrackers)) {
      // A built-in pool (spell points, hero points) is the system's, made
      // again wherever that system is in play, not content to carry.
      if (!str(t.name).trim() || t.pool) continue;
      out.push(normalizeBlock({
        kind: 'tracker', name: t.name, maxFormula: t.maxFormula ?? t.max, minFormula: t.minFormula,
        refresh: t.refresh, text: t.note, style: t.style,
      }));
    }
  }
  return out.filter(Boolean);
}
