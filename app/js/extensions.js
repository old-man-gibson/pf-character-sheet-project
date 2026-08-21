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
 * Bundled packs come from `data/extensions/index.json` (a deployment lists what
 * it ships there, exactly as `data/characters/index.json` lists characters --
 * and the published engine ships neither). Local packs live in this browser
 * only, in localStorage, alongside the imported characters.
 *
 * Nothing in here touches the DOM: the manager UI and the sheet element both
 * call this module, and the tests call it with a fake storage.
 */

export const EXTENSION_FORMAT = 'character-sheet-extension';
export const EXTENSION_VERSION = 1;

/** The shared tables a pack can provide, and what each one's document holds. */
export const TABLE_KINDS = ['maneuvers', 'vancian', 'psionics', 'cardcasting', 'cooking'];

/** What each block kind is called on a picker, and what it lands on the sheet as. */
export const BLOCK_KINDS = {
  class: { label: 'Class', lands: 'Classes table (Overview) and its feature column (Progression)' },
  race: { label: 'Race', lands: 'Race, size and race traits (Overview); racial ability modifiers (Stats)' },
  trait: { label: 'Race trait', lands: 'Race traits (Overview)' },
  feature: { label: 'Feature', lands: 'A feature in a template group (Template tab)' },
  template: { label: 'Feature group', lands: 'A template with its features (Template tab)' },
  tracker: { label: 'Tracker', lands: 'Trackers tab' },
  veil: { label: 'Veil', lands: 'Its chakra slot on the Akashic tab (shaped, essence 0)' },
  archetype: { label: 'Archetype', lands: 'Its class on the sheet: replaced features leave the Progression ladder and Template group, the new ones go in; a pill on the class row removes it and restores them' },
  options: { label: 'Option menu', lands: 'The class feature it names on the Progression tab, as the menu its cells pick from; and its own Template group' },
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

/** One block, in its canonical shape; null when it is not a block at all. */
export function normalizeBlock(block) {
  const b = obj(block);
  const kind = lower(b.kind);
  if (!BLOCK_KINDS[kind]) return null;
  const base = { kind, name: str(b.name).trim(), text: str(b.text), source: str(b.source) };
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
      return { ...base, type: featureType(b.type), group: str(b.group).trim() };
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
    case 'archetype': {
      const className = str(b.class ?? b.className).trim();
      const features = arr(b.features).map((f) => {
        const text = str(f?.text);
        const swaps = parseSwaps(text, className);
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
        stacksWith: stacks.length ? stacks : parseStacksWith(features.map((f) => f.text).join('\n')),
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
 * Which entries of the menu it joins an option pushes out, read off its own
 * text: "This replaces the Ranged Cut and Armor Rending Slash Iaijutsu
 * Techniques." The kind-word at the end is the menu's own name, which every
 * such sentence repeats, so the longest tail of `feature` the sentence ends
 * with comes off -- leaving the entries themselves.
 */
export function parseOptionReplaces(text, feature = '') {
  const words = str(feature).trim().split(/\s+/).filter(Boolean);
  const tails = words.map((_, i) => words.slice(i).join(' ')).filter((s) => s.length > 2);
  const out = [];
  for (const m of str(text).matchAll(/\breplace[sd]?\s+(?:the\s+)?([^.;]+?)(?=[.;]|$)/gi)) {
    let list = m[1].trim();
    for (const tail of tails) {
      // singular or plural, since one sentence writes "Techniques" and the next "Technique"
      const stem = tail.replace(/s$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\s+${stem}s?$`, 'i');
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

/**
 * The key a class feature is matched by, across the ways a page names it:
 * "Trap sense +1" / "Trap Sense (Ex)" / "kiai art" / "Kiai Arts" are one key;
 * "the legendary samurai's weapon proficiencies", "armor proficiencies" and
 * "proficiencies" are all the one proficiency feature; "iaijutsu master" and
 * "iaijutsu mastery" meet on their stem.
 */
/**
 * A swap key may name one grant of a feature rather than the feature: an
 * archetype replacing "the 10th and 14th level warrior's grace" takes those
 * two and leaves the others. The level rides on the key as "@10", which keeps
 * a swap list the flat list of strings it has always been, and lets two
 * archetypes taking different grants of the same feature stack.
 */
export const swapAt = (key, level) => (key && level ? `${key}@${level}` : key);
export const swapBase = (k) => str(k).split('@')[0];
export const swapLevel = (k) => {
  const n = Number(str(k).split('@')[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
};
/** Do two swap keys land on each other? A whole feature covers each of its grants. */
export const swapsMeet = (a, b) => {
  if (a === b) return true;
  if (swapBase(a) !== swapBase(b)) return false;
  return swapLevel(a) === null || swapLevel(b) === null;
};
/** "warriors grace@10" as a person reads it. */
export const swapLabel = (k) => (swapLevel(k) ? `${swapBase(k)} (${swapLevel(k)}th)` : swapBase(k));

export function swapKey(s, className = '') {
  let k = lower(s).replace(/\((?:ex|su|sp)(?: or (?:ex|su|sp))?\)/g, '').replace(/sheathe/g, 'sheath').trim();
  if (/proficienc/.test(k)) return 'weapon and armor proficiency';
  const cls = lower(className);
  if (cls) k = k.replace(new RegExp(`^(?:the\\s+|a\\s+|an\\s+)?${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['’]s\\s+(?:normal\\s+)?`), '');
  k = k
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/^normal\s+/, '')
    .replace(/\s+class features?$/, '')
    .replace(/\s+abilit(?:y|ies)$/, '')
    .replace(/\s*[+\-–]\s*\d+(?:\/[+\-–—]|\/-)?\s*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  k = k.replace(/(\w{3,})s$/, '$1');                          // plural-insensitive on the last word
  k = k.replace(/(\w{5,})y$/, '$1');                          // "iaijutsu mastery" / "iaijutsu master"
  return k;
}

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
  const re = /(?:^|[.\n]\s*)(?:This (?:ability |alteration |feature |alternative class feature |option )?|[A-Z][^.\n:]{0,40}?(?::\s+[A-Z][^.\n]{0,40}?)?\s+)(replaces|alters|modifies|changes)\s+([^.\n]+?)(?:\.|\n|$)/g;
  // a named sub-ability -- "the duty's call kiai art", "the Ranged Cut and Armor Rending Slash Iaijutsu Techniques":
  // definite ("the …"), so not "challenge and kiai arts"
  const SUB = /^the\s+.+?\s+(kiai art|iaijutsu technique|rage power|deed|talent|discovery|hex|revelation|exploit)s?$/i;
  const BARE = /^(?:the\s+)?(?:kiai arts?|iaijutsu techniques?|rage powers?|deeds?|talents?|discover(?:y|ies)|hexe?s?|revelations?|exploits?)$/i;
  for (const m of str(text).matchAll(re)) {
    const verb = m[1].toLowerCase();
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
    // "the duty's call, charm kiai art" -> kiai art, altered: one named sub-ability, commas and all
    const named = list.match(SUB);
    if (named && verb === 'replaces' && !BARE.test(list)) { push(alters, swapKey(named[1], className)); continue; }
    // "weapon and armor proficiencies" is one thing, whatever the "and"
    if (/proficienc/i.test(list) && !/,/.test(list)) { push(verb === 'replaces' ? replaces : alters, 'weapon and armor proficiency'); continue; }
    const parts = list.replace(/\s*,?\s+(?:and|or)\s+/gi, ', ').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    for (const p of parts) push(verb === 'replaces' ? replaces : alters, swapKey(p, className));
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
 */
export function normalizeExtension(doc) {
  const d = obj(doc);
  const name = str(d.name).trim();
  const id = slugId(d.id) || slugId(name);
  const provides = {};
  for (const [key, table] of Object.entries(obj(d.provides))) {
    if (table && typeof table === 'object') provides[key] = structuredClone(table);
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
  switch (kind) {
    case 'maneuvers': return arr(t.disciplines).length;
    case 'vancian': return arr(t.classes).length;
    case 'psionics': return arr(t.curves).length + arr(t.classes).length;
    case 'cardcasting': return arr(t.manipulations).length;
    case 'cooking': return ['entrees', 'flavors', 'sides', 'aroma', 'garnish'].reduce((n, k) => n + arr(t[k]).length, 0);
    default: return Object.keys(t).length;
  }
}

/** A short line for a pack: "30 disciplines · 34 casting tables · 5 blocks". */
export function describeSummary(s) {
  const parts = [];
  const words = {
    maneuvers: ['discipline', 'disciplines'], vancian: ['casting table', 'casting tables'],
    psionics: ['manifesting table', 'manifesting tables'], cardcasting: ['deck manipulation', 'deck manipulations'],
    cooking: ['ingredient', 'ingredients'],
  };
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

/**
 * The store is a thin layer over a Storage-like object (`getItem` /
 * `setItem` / `removeItem`), which is localStorage in the page and a Map in
 * the tests. One index lists the local packs and remembers which bundled ones
 * are switched off; each pack's document is its own key so the index stays
 * small enough to read on every load.
 */
export function extensionStore(storage = globalThis.localStorage) {
  if (!storage) throw new Error('extensionStore needs a Storage-like object');

  const readIndex = () => {
    try {
      const raw = JSON.parse(storage.getItem(EXTENSIONS_KEY) || '{}');
      return {
        extensions: arr(raw.extensions).filter((e) => e && e.id),
        disabledBundled: arr(raw.disabledBundled).map(str),
      };
    } catch { return { extensions: [], disabledBundled: [] }; }
  };
  const writeIndex = (index) => storage.setItem(EXTENSIONS_KEY, JSON.stringify(index));

  return {
    /** Every local pack's index row, in the order they were added. */
    list() { return readIndex().extensions.map((e) => ({ ...e, local: true })); },

    /** One local pack's full document, or null. */
    read(id) {
      try {
        const raw = storage.getItem(extensionKey(id));
        return raw ? normalizeExtension(JSON.parse(raw)) : null;
      } catch { return null; }
    },

    /**
     * Store a pack: new, or replacing the one with the same id (which is how
     * an updated pack a friend sends over lands -- same id, higher revision).
     * Returns the index row. Throws on a full browser, like a character import.
     */
    save(doc, { origin = 'import', enabled = null } = {}) {
      const ext = normalizeExtension(doc);
      if (!ext.id) throw new Error('An extension needs a name.');
      ext.updatedAt = new Date().toISOString().slice(0, 19);
      if (!ext.createdAt) ext.createdAt = ext.updatedAt;
      storage.setItem(extensionKey(ext.id), JSON.stringify(ext));
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
      writeIndex(index);
      return { ...row, local: true, replaced: !!prior };
    },

    remove(id) {
      const index = readIndex();
      index.extensions = index.extensions.filter((e) => e.id !== id);
      writeIndex(index);
      storage.removeItem(extensionKey(id));
    },

    /** Switch a pack on or off; bundled ones are remembered by id. */
    setEnabled(id, on, { bundled = false } = {}) {
      const index = readIndex();
      if (bundled) {
        const set = new Set(index.disabledBundled);
        if (on) set.delete(id); else set.add(id);
        index.disabledBundled = [...set];
      } else {
        index.extensions = index.extensions.map((e) => (e.id === id ? { ...e, enabled: !!on } : e));
      }
      writeIndex(index);
    },

    disabledBundled() { return new Set(readIndex().disabledBundled); },
  };
}

/* ---------------- bundled packs ---------------- */

/**
 * The packs a deployment ships: `data/extensions/index.json` lists them and
 * each is a plain extension document beside it. Missing index, missing file
 * and bad JSON all read as "none" -- the engine runs content-free.
 *
 * `base` is the URL `data/extensions/` resolves against; the sheet element
 * passes its own module URL, a host page can pass `document.baseURI`.
 */
export async function loadBundledExtensions(base, { fetcher = globalThis.fetch } = {}) {
  if (!fetcher) return [];
  const url = (path) => new URL(path, base);
  let index;
  try {
    const res = await fetcher(url('data/extensions/index.json'));
    index = res.ok ? await res.json() : null;
  } catch { index = null; }
  const rows = arr(index?.extensions).filter((e) => e && (e.file || e.id));
  const docs = await Promise.all(rows.map(async (row) => {
    try {
      const res = await fetcher(url(`data/extensions/${row.file || `${row.id}.json`}`));
      if (!res.ok) return null;
      const doc = await res.json();
      const verdict = inspectExtension(doc);
      if (!verdict.ok) return null;
      const ext = normalizeExtension(doc);
      if (row.id) ext.id = slugId(row.id) || ext.id;
      return ext;
    } catch { return null; }
  }));
  return docs.filter(Boolean);
}

/* ---------------- merging the tables ---------------- */

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
  const out = {
    maneuvers: { disciplines: [] },
    vancian: { spellLevels: null, classes: [] },
    psionics: { powerLevels: null, curves: [], classes: [] },
    cardcasting: { manipulations: [] },
    cooking: { durationHours: null, entrees: [], flavors: [], sides: [], aroma: [], garnish: [] },
  };
  const upsert = (list, item, key = 'name') => {
    const k = lower(item?.[key]);
    if (!k) return;
    const i = list.findIndex((x) => lower(x?.[key]) === k);
    if (i === -1) list.push(item); else list[i] = item;
  };
  /** A discipline joins one already there rather than replacing it. */
  const upsertDiscipline = (list, disc) => {
    const k = lower(disc?.name);
    if (!k) return;
    const at = list.findIndex((x) => lower(x?.name) === k);
    if (at === -1) { list.push({ ...disc, entries: [...arr(disc.entries)] }); return; }
    const entries = [...arr(list[at].entries)];
    for (const e of arr(disc.entries)) {
      const j = entries.findIndex((x) => lower(x?.name) === lower(e?.name));
      if (j === -1) entries.push(e); else entries[j] = e;
    }
    list[at] = { ...list[at], ...disc, entries };
  };
  for (const ext of arr(extensions)) {
    const p = obj(ext?.provides);
    for (const d of arr(p.maneuvers?.disciplines)) upsertDiscipline(out.maneuvers.disciplines, d);
    if (arr(p.vancian?.spellLevels).length) out.vancian.spellLevels = [...p.vancian.spellLevels];
    for (const c of arr(p.vancian?.classes)) upsert(out.vancian.classes, c);
    if (arr(p.psionics?.powerLevels).length) out.psionics.powerLevels = [...p.psionics.powerLevels];
    for (const c of arr(p.psionics?.curves)) upsert(out.psionics.curves, c, 'total');
    for (const c of arr(p.psionics?.classes)) upsert(out.psionics.classes, c);
    for (const m of arr(p.cardcasting?.manipulations)) upsert(out.cardcasting.manipulations, m);
    if (p.cooking?.durationHours) out.cooking.durationHours = str(p.cooking.durationHours);
    for (const k of ['entrees', 'flavors', 'sides', 'aroma', 'garnish']) {
      for (const x of arr(p.cooking?.[k])) upsert(out.cooking[k], x);
    }
  }
  if (!out.vancian.spellLevels) delete out.vancian.spellLevels;
  if (!out.psionics.powerLevels) delete out.psionics.powerLevels;
  if (!out.cooking.durationHours) delete out.cooking.durationHours;
  return out;
}

/**
 * Register the merged tables with the model. `registrars` is the model's
 * five setters, passed in rather than imported so this module has no
 * dependency on model.js and the tests can hand it spies.
 */
export function registerTables(merged, registrars) {
  const r = obj(registrars);
  r.setManeuverCatalogue?.(merged.maneuvers);
  r.setVancianTables?.(merged.vancian);
  r.setPsionicTables?.(merged.psionics);
  r.setCardcastingTables?.(merged.cardcasting);
  r.setCookingTables?.(merged.cooking);
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

/** Every block across the active packs, tagged with the pack it came from. */
export function activeBlocks(extensions) {
  const out = [];
  for (const ext of arr(extensions)) {
    ext.blocks.forEach((block, index) => {
      out.push({ ...block, extId: ext.id, extName: ext.name, index });
    });
  }
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
      if (existing === -1) model.listAdd('classes', { ...row, systems: block.systems });
      else {
        for (const [k, v] of Object.entries(row)) model.setItem('classes', existing, k, v);
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
        + `${block.tracks ? ', and its customized weapons on Spheres & Magic' : ''}.`;
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
      model.listAdd(`akashic.slots.${si}.veils`, { name: block.name, desc: block.text, essence: 0 });
      return `Shaped ${block.name} ${where} ${slotName} slot on the Akashic tab (essence 0).`;
    }
    case 'archetype':
      return applyArchetype(model, block);
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
      return `${target}'s ${column} column already picks from “${block.name}” — the menu names the class and the feature, so it needed no adding.`;
    }
    const index = group.columns.indexOf(column);
    model.setClassFeatureColumnOptions(target, index, [...model.classFeatureColumnOptions(target, column), block.name]);
    return `${block.options.length} option(s) for ${target}: the ${column} column now picks from “${block.name}”.`;
  }

  // A menu with no column to hang on is not copied anywhere: it stays in its
  // pack, and takes effect the moment the class that has that feature arrives.
  return `Nothing on this sheet picks from “${block.name}” yet — it is for ${
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
  // Which group grants there is the grid's own answer, asked the grid's way.
  const row = model.classFeatureRows(className).find((r) => r.classLevel === level);
  const gi = row?.cells?.[col]?.fields.find((f) => f.on && f.group)?.group?.index;
  if (gi === undefined || gi === null) return false;
  const was = model.classFeatureRuleGroups(className, col)[gi]?.rule || '';
  model.setClassFeatureRuleGroup(className, columnIndex, gi, { rule: `${was}${was ? ', ' : ''}-${level}` });
  // The level, not the rule as it stood: taking that one term back out again
  // is the same edit whatever order the archetypes come off in.
  entry.ruleEdits.push({ column: col, group: gi, level });
  return true;
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

/** The names in a Progression "Special" cell; null when the cell is a rule-group map this must not touch. */
function cellNames(cell) {
  if (cell === undefined || cell === null || cell === '') return [];
  if (typeof cell !== 'string') return null;
  return cell.split(/,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);
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
  };
  // The character level a class level sits at, which a gestalt gap makes differ.
  const charLevelOf = (classLevel) => model.classFeatureRows(className)
    .find((r) => r.classLevel === classLevel)?.level ?? null;

  const removeKey = (key) => {
    const base = swapBase(key);
    const at = swapLevel(key);              // one named grant, or the whole feature
    const charAt = at === null ? null : charLevelOf(at);
    let hit = false;
    if (group) {
      for (const [level, cells] of Object.entries(group.byLevel || {})) {
        if (charAt !== null && Number(level) !== charAt) continue;
        const names = cellNames(cells?.Special);
        if (!names) continue;
        const keep = names.filter((n) => swapKey(n, className) !== base);
        if (keep.length !== names.length) {
          hit = true;
          for (const n of names) if (swapKey(n, className) === base) entry.removedCells.push({ level: Number(level), name: n });
          model.setClassFeature(className, Number(level), 'Special', keep.join(', '));
        }
      }
      const ci2 = (group.columns || []).findIndex((c) => c !== 'Special' && swapKey(c, className) === base);
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
    if (at === null) {
      const notes = model.classFeatureNotes(className);
      for (let i = notes.length - 1; i >= 0; i--) {
        if (swapKey(notes[i].name, className) === base) {
          hit = true;
          entry.removedNotes.push({ name: notes[i].name, type: notes[i].type ?? null, text: notes[i].text || '' });
          model.removeClassFeatureNote(className, i);
        }
      }
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
  const took = [...new Set(entry.removedCells.filter((c) => !c.column).map((c) => c.name))];
  const byColumn = new Map();
  for (const r of entry.ruleEdits) byColumn.set(r.column, [...(byColumn.get(r.column) || []), r.level]);
  for (const [col, levels] of byColumn) took.push(`${col} at ${levels.sort((a, z) => a - z).map((l) => `${l}th`).join(' and ')}`);
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
  row.archetypeStack = stack.filter((_, i) => i !== at);
  if (!row.archetypeStack.length) delete row.archetypeStack;
  const tags = str(row.archetypes).split(/,\s*/).map((t) => t.trim()).filter((t) => t && lower(t) !== lower(name));
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
      if (!str(t.name).trim()) continue;
      out.push(normalizeBlock({
        kind: 'tracker', name: t.name, maxFormula: t.maxFormula ?? t.max, minFormula: t.minFormula,
        refresh: t.refresh, text: t.note, style: t.style,
      }));
    }
  }
  return out.filter(Boolean);
}
