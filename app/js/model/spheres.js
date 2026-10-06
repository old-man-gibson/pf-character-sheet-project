/**
 * Spheres of Power and Might: the training pass.
 *
 * Talents come from several ladders at once (class progression, feats,
 * traditions, drawbacks bought off, customizations), and the sphere skill
 * ranks they grant feed back into the skills. This is the pass that counts
 * them, works out what is known, and pairs blended training.
 */

import {
  CASTING_TYPES, COMBAT_SPHERES, EXPERTISE_CUSTOM, EXPERTISE_TIERS, GUILE_SPHERES, MAGIC_SPHERES,
  RANKS_PER_TALENT, SPHERE_SKILL_RANKS, TALENTS_TO_TYPE, TALENT_RATES, TRACK_SPHERE_SIDES,
  PRACTITIONER_TYPES, TYPE_RATES, TYPE_TO_TALENTS, boonStep, drawbackWeight, isBasePick, normalizeTalentTracks,
  expertiseTalents, isGuileSphere, ladderGrants, parseLadderRule, spBoonPoints, sphereSide, sphereSkillLabel, sphereSkillRequirement, sphereSkillSpheres,
  statMod, tempEssenceCost, trackCount, DEFAULT_TALENT_TRACKS,
} from '../rules.js';
import { emit } from './events.js';
import { evaluateFormula } from '../formula.js';
import { classHasLevel, ownLevelCount } from './progression.js';
import { forwarded } from './scope.js';
import { recomputeUnarmed } from './stats/attacks.js';
import { altTrainingTalents, altTrainingTechnique, grantCount } from './subsystems/alt-training.js';
import { featEntry, powerEntry, spellEntry } from './subsystems/catalogues.js';
import { techniqueTalents } from './subsystems/techniques.js';
import { veilGrantedSpheres, veilsNamedIn } from './subsystems/akashic.js';
import { markUndo, rowLabel } from './undo.js';
import {
  classForwardKey, evaluateAmount, isPinned, normalizeName, splitTags, packRows, packWords, slug, sphereForwardKey,
} from './util.js';

/* ------------------------------------------------------------------ *
 * The sphere catalogue.
 *
 * What a sphere *is* -- its base abilities and every talent in it -- is
 * content, so it arrives in an extension pack like the discipline catalogue
 * and is read where it stands rather than copied onto a character. The sheet
 * has always let a talent be typed in free-hand and still does; this is what
 * lets it eventually offer the list instead, and what makes a talent's tags
 * (`(counter)`, `(stance)`) and its source (`[3PP]`, `[Apoc]`) available to
 * anything that wants to search or filter by them.
 *
 * Note that `rules.js` still hard-codes the *names* of the spheres, because
 * skill-rank and unarmed logic key off them. This catalogue is the other
 * half -- their contents -- and the two are not yet joined up.
 * ------------------------------------------------------------------ */

let SPHERE_CATALOGUE = { spheres: [] };

/**
 * One entry per talent, however many times the page listed it.
 *
 * A wiki organises a sphere more than one way at once: Destruction's
 * Admixture is in the main talent list *and* under "Creating New Blasts", and
 * a scraper reading the page faithfully brings back both. They are the same
 * talent -- 63 of Destruction's 244 entries are a second copy -- and leaving
 * them doubled would double-count every tag and let a lookup answer with
 * whichever copy came first.
 *
 * The first listing wins the group, because a page puts the main list before
 * its topical sections; the longest text wins, because the copies differ only
 * in trimming; tags and sources are pooled, since each listing may know a
 * label the other did not.
 */
function dedupeTalents(talents) {
  const byName = new Map();
  for (const t of talents) {
    const key = talentKey(t.name);
    if (!key) continue;
    const had = byName.get(key);
    if (!had) { byName.set(key, t); continue; }
    for (const x of t.tags) if (!had.tags.some((y) => y.toLowerCase() === x.toLowerCase())) had.tags.push(x);
    for (const x of t.sources) if (!had.sources.includes(x)) had.sources.push(x);
    if (t.text.length > had.text.length) had.text = t.text;
    if (!had.prerequisites) had.prerequisites = t.prerequisites;
  }
  return [...byName.values()];
}

/** Register the shared catalogue. Call before constructing a Character. */
export function setSphereCatalogue(doc) {
  const list = packRows(doc?.spheres);
  SPHERE_CATALOGUE = {
    spheres: list.map((s) => ({
      name: String(s.name || ''),
      // 'combat', 'magic' or 'guile', the three sides the sheet counts
      // separately; '' when a page never said.
      kind: ['combat', 'magic', 'guile'].includes(s.kind) ? s.kind : '',
      description: String(s.description || ''),
      abilities: packRows(s.abilities).map((a) => ({
        name: String(a.name || ''), text: String(a.text || ''), option: !!a.option,
        // The ability's text divided by sphere, where a page divides it.
        bySphere: packRows(a.bySphere).map((x) => ({ sphere: String(x.sphere || ''), text: String(x.text || '') })),
      })),
      // What the page says about choosing among its packages, when it has any.
      choose: String(s.choose || ''),
      talents: dedupeTalents(packRows(s.talents).map((t) => ({
        name: String(t.name || ''),
        group: String(t.group || ''),
        tags: packWords(t.tags),
        sources: packWords(t.sources),
        prerequisites: String(t.prerequisites || ''),
        text: String(t.text || ''),
      }))),
    })),
  };
}

export function sphereCatalogue() {
  return SPHERE_CATALOGUE;
}

/**
 * A sphere name as the sheet spells it: the engine's lists or the
 * catalogue's spelling when either knows it, however it was typed, and the
 * typed name, trimmed, when neither does. Tallies are keyed by this, so
 * "boxing" and "Boxing" are one sphere.
 */
export function canonicalSphere(name) {
  const clean = String(name ?? '').trim();
  if (!clean) return '';
  const key = clean.toLowerCase();
  return [...COMBAT_SPHERES, ...MAGIC_SPHERES, ...GUILE_SPHERES].find((s) => s.toLowerCase() === key)
    || sphereEntry(clean)?.name.trim() || clean;
}

/** Add to a tally under the sphere's one spelling (see canonicalSphere). */
export function tallyAdd(tally, sphere, n = 1) {
  let key = canonicalSphere(sphere);
  if (!key) return;
  // A name nobody knows keeps the first spelling the tally saw.
  const low = key.toLowerCase();
  key = Object.keys(tally).find((k) => k.toLowerCase() === low) ?? key;
  tally[key] = (tally[key] || 0) + n;
}

/** A sphere's count in a tally, however either side spelled it. */
export function talentsIn(tally, sphere) {
  const low = String(sphere ?? '').trim().toLowerCase();
  if (!low || !tally) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(tally)) if (k.trim().toLowerCase() === low) n += Number(v) || 0;
  return n;
}

/** Whether two sphere names are the same sphere. */
export const sameSphere = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** One sphere by name, however it was capitalised. */
export function sphereEntry(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return SPHERE_CATALOGUE.spheres.find((s) => s.name.trim().toLowerCase() === key) || null;
}

/** Every talent a sphere holds, or all of them when no sphere is named. */
export function sphereTalents(name = null) {
  if (name === null) {
    return SPHERE_CATALOGUE.spheres.flatMap((s) => s.talents.map((t) => ({ ...t, sphere: s.name })));
  }
  const s = sphereEntry(name);
  return s ? s.talents.map((t) => ({ ...t, sphere: s.name })) : [];
}

/**
 * Talents carrying a tag or a source, case-insensitively -- every `(counter)`
 * across every sphere, or everything a table wants to rule out because it
 * came from `[3PP]`. Both lists are searched, since which of the two a wiki
 * wrote a label in is its business rather than the reader's.
 */
export function talentsTagged(tag) {
  const key = String(tag || '').trim().toLowerCase();
  if (!key) return [];
  return sphereTalents().filter((t) => [...t.tags, ...t.sources]
    .some((x) => String(x).trim().toLowerCase() === key));
}

/**
 * A talent's name as it is matched: case, spacing and any trailing tag off.
 *
 * A player writes what the book calls it, which is not always what the wiki's
 * heading called it -- "Reaping (greater)", "reaping", "Reaping  ". The tags
 * go because the catalogue already keeps them in a field of their own.
 *
 * Typography is not part of a name either: "…And Stay Down!" on a sheet is
 * the pack's "...And Stay Down" -- an ellipsis character is three dots
 * (NFKC), curly quotes are straight ones, and a closing ! or ? is dropped.
 */
export const talentKey = (s) => normalizeName(splitTags(s).name.replace(/[!?]+$/, ''));

/**
 * What the catalogue knows about a talent somebody typed on their sheet.
 *
 * The row's own sphere is asked first. With no sphere on the row the whole
 * catalogue is searched, and an answer comes back only if exactly one sphere
 * has a talent by that name -- naming the sphere is then something the sheet
 * can tell the player rather than something it has to be told.
 */
export function sphereTalent(sphere, talent) {
  const key = talentKey(talent);
  if (!key) return null;
  const named = sphereEntry(sphere);
  if (named) {
    const hit = named.talents.find((t) => talentKey(t.name) === key);
    return hit ? { ...hit, sphere: named.name } : null;
  }
  if (String(sphere ?? '').trim()) return null;      // a sphere it does not carry
  const all = sphereTalents().filter((t) => talentKey(t.name) === key);
  return all.length === 1 ? all[0] : null;
}

/**
 * The spheres a picker offers: the names the engine knows, then any a pack
 * carries that it does not. `side` is 'combat', 'magic', 'guile', or null for
 * all of them; a pack sphere whose page never said which side it was on is
 * offered on every list, since a name in the wrong one is easier to ignore
 * than one missing from the right one.
 *
 * The engine's own lists answer before the pack does. A pack often gives a
 * skill sphere no side at all -- nothing on its page says which -- and it was
 * offered on the martial and magic lists as a result, when the engine had
 * known all along it was a skill sphere.
 */
export function sphereNames(base, side = null) {
  const have = new Set((base || []).map((s) => String(s).trim().toLowerCase()));
  const sideOf = (s) => sphereSide(s.name.trim()) ?? (isGuileSphere(s.name) ? 'guile' : null) ?? s.kind;
  const extra = SPHERE_CATALOGUE.spheres
    .filter((s) => s.name && !have.has(s.name.trim().toLowerCase()))
    .filter((s) => !side || !sideOf(s) || sideOf(s) === side)
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b));
  // Appended rather than merged in: the built-in lists put their third-party
  // spheres at the end too, so "not one of the core ones" keeps reading as a
  // position in the list.
  return extra.length ? [...(base || []), ...extra] : (base || []);
}

/* ------------------------------------------------------------------ *
 * Blended pools: which system a talent counts toward.
 * ------------------------------------------------------------------ */

/** The three training sides, in the order a picker lists them. */
export const TRAINING_SYSTEMS = ['combat', 'magic', 'guile'];

/** What each is called beside a tick: the kind of talent, not the tab. */
export const SYSTEM_NOUNS = { combat: 'martial', magic: 'magical', guile: 'skill' };

/**
 * The system a sphere belongs to: the engine's three lists first, then a
 * pack's word for it. Null for a name nobody knows -- homebrew, or a typo.
 */
export function sphereSystem(sphere) {
  const name = String(sphere || '').trim();
  if (!name) return null;
  return sphereSide(name) ?? (isGuileSphere(name) ? 'guile' : null) ?? (sphereEntry(name)?.kind || null);
}

/**
 * Every sphere a pool spanning `systems` may pick from, alphabetised as one
 * list -- a blended row does not ask which system first, the sphere says.
 */
export function poolSpheres(systems) {
  const lists = { combat: COMBAT_SPHERES, magic: MAGIC_SPHERES, guile: GUILE_SPHERES };
  const names = systems.flatMap((s) => sphereNames(lists[s] || [], s));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Every sphere a customized weapon's track may learn from: the martial
 * list by default, the magical one or both when its archetype says so, and
 * the packs' spheres of those kinds. The panel offers exactly this list and
 * the off-list check reads it, so a sphere offered is never flagged.
 */
export function trackSphereNames(spec) {
  const side = TRACK_SPHERE_SIDES.includes(spec?.spheres) ? spec.spheres : 'combat';
  return poolSpheres(side === 'both' ? ['combat', 'magic'] : [side]);
}

/**
 * The side a customized weapon's talent counts on: its sphere's system, a
 * pack's included, and martial for a name nobody knows -- the track lives on
 * the martial side.
 */
export function trackTalentSide(sphere) {
  const system = sphereSystem(sphere);
  return system === 'magic' ? 'magic' : 'combat';
}

/**
 * The systems a class's pool of talents counts toward, its own first.
 *
 * A martial or magic class reaches the other one by being paired with a
 * block there (`blended`, because each side works out its own level and DC
 * off its own block), and reaches skill talents by a flag alone
 * (`blendedSkill`) -- the guile side has no per-class number to keep, its
 * operative modifier being one for the whole character. A guile class
 * reaches out the same way, by a flag per side. A pair's mirror holds none of
 * this: the owner carries the flags for both.
 */
export function poolSystems(cls, home) {
  if (home === 'guile') {
    return ['guile', cls?.blendedCombat && 'combat', cls?.blendedMagic && 'magic'].filter(Boolean);
  }
  const other = home === 'magic' ? 'combat' : 'magic';
  return [home, cls?.blended && other, cls?.blendedSkill && 'guile'].filter(Boolean);
}

/**
 * Where one talent of a pool lands: on its sphere's system when the pool
 * reaches it. A name no list knows -- homebrew, or a typo -- stays on the
 * class's own side, as it always has. A sphere every list knows belongs to a
 * system the pool does *not* reach lands nowhere (`null`): Boxing in a class
 * that does not count as martial is not a talent it can have, and counting it
 * on the class's own side would put a martial sphere on the guile tab's table.
 * The row says so instead.
 */
export function talentLandsOn(sphere, systems) {
  const s = sphereSystem(sphere);
  if (!s) return systems[0];
  return systems.includes(s) ? s : null;
}

/**
 * Whether a class's pool is two ladders -- any and [utility] -- rather than
 * one. [utility] talents are a Spheres of Guile idea, so a pool has them
 * exactly when it reaches skill talents; a guile class always does.
 */
export function poolHasUtility(cls, home) {
  return home === 'guile' || (!!cls?.blendedSkill && !cls?.blendedMirror);
}

/**
 * How a two-ladder pool gains talents: 'rate' (a martial or magic class's own
 * Talents / level for the any ladder, and a written rule for [utility]), one
 * of the book's tiers, or 'custom' (both ladders written as rules). A guile
 * class has no Talents / level, so a blank there is simply no tier yet.
 */
export function poolMode(cls, home) {
  const tier = String(cls?.expertise || '').trim();
  if (EXPERTISE_TIERS.includes(tier)) return tier;
  if (tier === EXPERTISE_CUSTOM) return 'custom';
  return home === 'guile' ? null : 'rate';
}

/**
 * Walks a two-ladder pool level by level. `step(has, classLevels, charLevel,
 * rateGranted, rateCount)` returns the slot flags and running counts for one
 * row; the caller owns the loop, because the martial and magic pass and the
 * guile pass each count class levels their own way.
 */
export function poolStepper(cls, home) {
  const mode = poolMode(cls, home);
  const anyRule = parseLadderRule(cls?.anyRule);
  const utilityRule = parseLadderRule(cls?.utilityRule);
  let any = 0;
  let utility = 0;
  return (has, classLevels, charLevel, rateGranted = false, rateCount = 0) => {
    let granted = false;
    let utilityGranted = false;
    if (mode && mode !== 'rate' && mode !== 'custom') {
      const before = expertiseTalents(mode, classLevels - (has ? 1 : 0));
      const now = expertiseTalents(mode, classLevels);
      granted = now.any > before.any;
      utilityGranted = now.utility > before.utility;
      any = now.any;
      utility = now.utility;
      return { granted, utilityGranted, count: any, utilityCount: utility };
    }
    if (mode === 'rate') {
      granted = rateGranted;
      any = rateCount;
    } else if (mode === 'custom') {
      granted = has && ladderGrants(anyRule, classLevels, charLevel);
      if (granted) any += 1;
    }
    utilityGranted = !!mode && has && ladderGrants(utilityRule, classLevels, charLevel);
    if (utilityGranted) utility += 1;
    return { granted, utilityGranted, count: any, utilityCount: utility };
  };
}

/**
 * The sphere's own abilities and packages that a row's parenthesis names.
 *
 * "Nature Sphere (Water)", "Boxing (Counter Punch)", "Expanded Geomancing
 * (Fire, Plant)" -- each part is tried against what the sphere has, and a part
 * that names nothing (a tag, "from a feat") is simply not an answer. Rules a
 * page never named sit under the sphere's own name and are never pointed at.
 */
function pointedAbilities(s, typed) {
  const named = [...String(typed ?? '').matchAll(/\(([^)]*)\)/g)]
    .flatMap((m) => m[1].split(/,|\/|;|\bor\b|\band\b/i)).map((x) => x.trim().toLowerCase()).filter(Boolean);
  // A row may also *be* the ability, with no sphere in front of it: a sheet
  // that lists "Alternate Divinations" among its Divination talents means the
  // part of the sphere's base ability that goes by that name.
  const whole = abilityKey(String(typed ?? '').replace(/\([^)]*\)/g, ' '));
  if (!named.length && !whole) return [];
  const bare = (x) => x.replace(/\s+package$/, '');
  return (s?.abilities || []).filter((a) => a.name.toLowerCase() !== s.name.toLowerCase()
    && (named.some((n) => bare(n) === bare(a.name.toLowerCase())) || (whole && abilityKey(a.name) === whole)));
}

/**
 * One named entry inside an ability's share, when a row names it.
 *
 * An alternate divination is not a talent and not the whole ability either:
 * it is "Divine Undead", one line of the Death sphere's share of Alternate
 * Divinations, and a sheet that lists what its diviner can do writes it by
 * that name. Each share is a run of `Name: text` entries (with whatever
 * tables belong to them underneath), so a row is tried against those names.
 */
function shareEntry(s, typed) {
  const want = abilityKey(String(typed ?? '').replace(/\([^)]*\)/g, ' '));
  if (!want) return null;
  for (const a of s?.abilities || []) {
    for (const share of a.bySphere || []) {
      const entries = [];
      for (const line of share.text.split('\n')) {
        const m = line.match(/^([A-Z][^:\t\n]{2,40}):\s+(.*)$/);
        if (m) entries.push({ name: m[1].trim(), text: [m[2]] });
        else if (entries.length) entries[entries.length - 1].text.push(line);
      }
      const hit = entries.find((e) => abilityKey(e.name) === want);
      if (hit) return { name: hit.name, text: hit.text.join('\n').trim(), ability: a.name, share: share.sphere };
    }
  }
  return null;
}

/** An ability's name as typed by hand: case, spacing and a plural's `s` do not count. */
const abilityKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/s$/, '');

/**
 * The spheres a character has anything in, on any side.
 *
 * Asked by the abilities whose answer depends on it -- see `abilityText`. A
 * sphere counts once a row names it: a talent, a base pick, a tradition's
 * grant, the Alternate Training technique's own.
 */
export function possessedSpheres(model) {
  const out = new Set();
  const put = (s) => { const k = String(s ?? '').trim().toLowerCase(); if (k) out.add(k); };
  for (const side of Object.values(model?.data?.training || {})) {
    if (!side || typeof side !== 'object') continue;
    for (const cls of side.classes || []) for (const lv of cls.levels || []) { put(lv.sphere); put(lv.utilitySphere); }
    for (const b of side.bonusTalents || []) put(b.sphere);
    for (const e of side.tradition?.entries || []) put(e.sphere);
    for (const c of side.customizations || []) for (const t of c.talents || []) put(t.sphere);
  }
  put(model?.data?.altTraining?.calc?.talents?.sphere);
  return out;
}

/**
 * What an ability says -- to this character, when that matters.
 *
 * Most abilities say one thing to everybody. One that is divided by sphere
 * (Divination's Alternate Divinations has an entry for every other sphere a
 * caster might have) is only as long as the character's own list: the shares
 * for the spheres she possesses, under a line saying that is what they are.
 * Without a character to ask about -- a catalogue being browsed -- it is all
 * of them.
 */
function abilityText(a, model = null) {
  if (!a?.bySphere?.length) return a?.text || '';
  if (!model) return [a.text, ...a.bySphere.map((s) => `${s.sphere}: ${s.text}`)].filter(Boolean).join('\n\n');
  const has = possessedSpheres(model);
  const mine = a.bySphere.filter((s) => has.has(s.sphere.toLowerCase()));
  const head = mine.length
    ? `From the spheres you possess — ${mine.map((s) => s.sphere).join(', ')}:`
    : `None of the spheres you possess adds one yet. (${a.bySphere.map((s) => s.sphere).join(', ')} each would.)`;
  return [a.text, head, ...mine.map((s) => `${s.sphere}: ${s.text}`)].filter(Boolean).join('\n\n');
}

/**
 * A talent that is a way of taking one of its sphere's packages.
 *
 * Expanded Geomancing says "you gain an additional Nature package", and the
 * row says which: "Expanded Geomancing (Fire)". What that row is *for* is the
 * fire package, exactly as "Nature Sphere (Fire)" would be, so it is shown the
 * same thing -- the package it named, rather than a sentence saying that it
 * gets one. Null for every other talent, whose own text is the answer.
 */
export function talentPackage(hit, typed) {
  if (!hit) return null;
  /*
   * Only a package, and never one the talent is merely *tagged* with. A
   * talent's parenthesis is usually its tag -- "Prowess (boast)", an Alchemy
   * talent marked "(poison)" -- and those share their names with the very
   * abilities and packages they build on. Prowess is not the boast, so a part
   * that is one of the talent's own tags is not a choice the player made.
   */
  const tags = new Set((hit.tags || []).map((t) => String(t).trim().toLowerCase()));
  const pointed = pointedAbilities(sphereEntry(hit.sphere), typed)
    .filter((a) => a.option && !tags.has(a.name.toLowerCase()));
  if (!pointed.length) return null;
  return {
    names: pointed.map((a) => a.name),
    text: pointed.map((a) => (pointed.length > 1 ? `${a.name}: ${a.text}` : a.text)).join('\n\n'),
  };
}

/** What a matched talent's note says: the package it names, or else its own text. */
export const talentNoteText = (hit, typed) => talentPackage(hit, typed)?.text || hit?.text || '';

/**
 * What taking a sphere itself gets you, for the row that records it.
 *
 * A base pick is not a talent -- it is the sphere, and what it grants is the
 * sphere's base abilities. The row reads as the sphere and what it opened
 * (`Destruction Sphere (Destructive Blast)`), which is the name a player
 * scanning their own list wants; the abilities' full text is far too long for
 * a name, so it goes in the note beside it where the rest of the rules live.
 *
 * `isBasePick` already reads that shape as a base pick -- it strips
 * parentheses before looking for the word -- so the label counts as one for
 * the sphere tallies the moment it is written.
 */
export function sphereBasePick(sphere, picked = '', model = null) {
  const s = sphereEntry(sphere);
  if (!s || !s.abilities.length) return null;
  /*
   * Some spheres give everything they have on the first pick; some give a
   * base ability *and* a choice of package -- Nature's geomancing and one of
   * six terrains, Guardian's pool and either Challenge or Patrol. A row says
   * which in its parenthesis, "Nature Sphere (Water)", and is shown that (see
   * `pointed` below). A row that names none is shown all of them under the
   * page's own words about choosing, because it is the row of somebody who
   * has yet to.
   */
  const always = s.abilities.filter((a) => !a.option);
  const options = s.abilities.filter((a) => a.option);
  // An ability the page never named is filed under the sphere's own name,
  // and saying "Guardian Sphere (Guardian)" would be saying nothing.
  const own = (a) => a.name.toLowerCase() === s.name.toLowerCase();
  /*
   * A parenthesis that names something the sphere has is the row saying what
   * it is *for*: "Boxing (Counter Punch)" is the counter punch, "Nature Sphere
   * (Water)" is the water package, and the note under it is that and nothing
   * else -- not Improved Unarmed Strike and geomancing as well, which the
   * player knows they have and did not write down. The whole sphere is still
   * what a row with no parenthesis, or one naming nothing the sphere has
   * ("from a feat"), is shown.
   */
  const pointed = pointedAbilities(s, picked);
  if (pointed.length) {
    return {
      sphere: s.name,
      label: `${s.name} Sphere (${pointed.map((a) => a.name).join(', ')})`,
      text: pointed.map((a) => (pointed.length > 1 ? `${a.name}: ${abilityText(a, model)}` : abilityText(a, model))).join('\n\n'),
    };
  }
  // A label is a name, and a name lists what it opened only while that is a
  // short thing to say: "Destruction Sphere (Destructive Blast)". Creation's
  // page heads thirteen sections before its talents, and a row reading
  // "Creation Sphere (Alter, Destroy, Repair, Create, Clarifications, …)" is
  // a paragraph where a name should be, so past three it is just the sphere.
  const opened = always.filter((a) => !own(a)).map((a) => a.name);
  /*
   * Or the bracket names a *talent* of the sphere. Some spheres hand one over
   * with the sphere itself -- "When you first gain the Tech sphere, you may
   * learn any one (gadget) talent" -- and the row that records taking Tech
   * records which: "Tech Sphere (Anatomical Structure)". That is what the row
   * is for, the same as a package would be, so that is what it is shown.
   */
  const bracketed = [...String(picked ?? '').matchAll(/\(([^)]*)\)/g)]
    .flatMap((m) => m[1].split(/,|;/)).map((x) => x.trim()).filter(Boolean);
  const taken = bracketed.map((n) => sphereTalent(s.name, n)).filter(Boolean);
  if (taken.length) {
    return {
      sphere: s.name,
      label: `${s.name} Sphere (${taken.map((t) => t.name).join(', ')})`,
      text: taken.map((t) => (taken.length > 1 ? `${t.name}: ${t.text}` : t.text)).join('\n\n'),
    };
  }
  // One entry of a share, named outright: "Divine Undead". Tried last, so
  // that a sphere, an ability or a package of that name is what it means.
  const entry = isBasePick(picked) ? null : shareEntry(s, picked);
  if (entry) {
    return {
      sphere: s.name,
      label: `${s.name} Sphere (${entry.name})`,
      text: `${entry.text}\n\n${entry.ability} — granted by also possessing the ${entry.share} sphere.`,
    };
  }
  const names = opened.length <= 3 ? opened : [];
  // Each ability under its own name: with one it reads as a heading, and
  // with several it is the only thing telling them apart.
  const say = (a) => (own(a) ? abilityText(a, model) : `${a.name}: ${abilityText(a, model)}`);
  const choosing = options.length
    ? [s.choose || `Choose one: ${options.map((o) => o.name).join(', ')}.`] : [];
  return {
    sphere: s.name,
    label: names.length ? `${s.name} Sphere (${names.join(', ')})` : `${s.name} Sphere`,
    text: [...always.map(say), ...choosing, ...options.map(say)].join('\n\n'),
  };
}

/**
 * `isBasePick`, with the catalogue's help.
 *
 * The rule in `rules.js` wants the word -- "Boxing Sphere" -- because without
 * a catalogue that is all there is to go on. Plenty of sheets write the pick
 * as the sphere's bare name, "Boxing (Counter Punch)" or just "Veilweaving",
 * and once a pack says Boxing *is* a sphere that reads as one too. Only for
 * the mark and the note: what counts toward a tally is still the sheet's own
 * rule, which no pack should be able to move.
 */
export function isBasePickOf(talent, sphere = null) {
  if (isBasePick(talent)) return true;
  const bare = String(talent ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!bare) return false;
  if (sphereEntry(bare)) return true;
  /*
   * Or the row names one of its sphere's base abilities outright --
   * "Alternate Divinations" among a diviner's talents. Only with the row's
   * sphere to look in, and only when no talent answers to the name: abilities
   * are called things like Create, Sense and Summon, and a talent of the same
   * name is what a talent row more likely means.
   */
  const s = sphere ? sphereEntry(sphere) : null;
  if (!s || sphereTalent(sphere, talent)) return false;
  return s.abilities.some((a) => a.name.toLowerCase() !== s.name.toLowerCase() && abilityKey(a.name) === abilityKey(bare))
    || !!shareEntry(s, bare);
}

/**
 * The sphere a base pick names, from the row's own text or its sphere cell.
 * "Destruction Sphere" and "Destruction Sphere (…)" both mean Destruction.
 */
export const basePickSphere = (talent, sphere) => {
  const named = String(talent ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bspheres?\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sphereEntry(named) ? named : sphere;
};

/**
 * Write a talent, and fill in what the catalogue can answer for free.
 *
 * A row has three parts and typing the first often settles the other two: the
 * sphere a talent belongs to is a fact, and its effect is what the player was
 * about to go and look up. So when a name matches, an **empty** sphere and an
 * **empty** notes cell are filled from the catalogue.
 *
 * Only empty ones, ever. What a player wrote is theirs -- a note is where the
 * table's own ruling goes, and having that overwritten by a book would be
 * worse than never filling anything. Emptying a cell and leaving the talent
 * alone leaves it empty; retyping the talent fills it again, which is the
 * only way to ask for it back.
 *
 * `fields` names the row's own columns, because they differ: a customized
 * weapon and a martial tradition have a sphere and no notes -- and a guile
 * class's level row has *two* talents on it, the free pick and the [utility]
 * one, so even the talent's own column has to be named rather than assumed.
 */
export function setTalentEntry(model, path, index, value, fields = {}) {
  const {
    talent: talentField = 'talent', sphere: sphereField = 'sphere', notes: notesField = null,
  } = fields;
  const row = model.list(path)?.[index];
  if (!row || typeof row !== 'object') return model;

  row[talentField] = String(value ?? '');
  const filled = [];

  /*
   * A base sphere pick is the sphere itself, not a talent in it. What it
   * grants is the sphere's base abilities, so the row reads as the sphere and
   * what it opened -- "Destruction Sphere (Destructive Blast)" -- and the
   * abilities' full text goes in the note.
   *
   * The label is only written over a pick that has no parenthesis of its own:
   * somebody who wrote "Destruction Sphere (from the feat)" said something,
   * and it is not ours to replace.
   */
  const pick = catalogueEntry(sphereField ? row[sphereField] : null, row[talentField], model);
  const base = pick.base ? pick.entry : null;
  if (base) {
    // Only a pick the sheet's own rule already reads as one is relabelled. A
    // bare "Boxing" is recognised with the catalogue's help, and writing the
    // word "Sphere" into it would make it count toward the tally -- which is
    // a number moving because a pack was switched on.
    if (isBasePick(row[talentField]) && !/\(/.test(row[talentField]) && base.label !== row[talentField]) {
      row[talentField] = base.label;
      filled.push('talent');
    }
    if (sphereField && !String(row[sphereField] ?? '').trim()) {
      row[sphereField] = base.sphere;
      filled.push('sphere');
    }
    if (notesField && !String(row[notesField] ?? '').trim()) {
      row[notesField] = base.text;
      filled.push('notes');
    }
  }

  const hit = base ? null : sphereTalent(sphereField ? row[sphereField] : null, row[talentField]);
  if (hit) {
    if (sphereField && !String(row[sphereField] ?? '').trim()) {
      row[sphereField] = hit.sphere;
      filled.push('sphere');
    }
    if (notesField && !String(row[notesField] ?? '').trim() && talentNoteText(hit, row[talentField])) {
      row[notesField] = talentNoteText(hit, row[talentField]);
      filled.push('notes');
    }
  }
  model.recompute();
  emit(model, {
    type: 'set-item', path, index, field: talentField, value: row[talentField], filled,
  });
  return model;
}

/**
 * Every talent a tab draws with a notes cell beside it, as `[row, fields]`:
 * the class blocks of its own, every blended pool that reaches it (drawn at
 * the head of each tab it reaches, wherever its rows are stored), and its
 * bonus talents. So the Fill button on a tab counts and fills what that tab
 * shows.
 *
 * A two-ladder level is two talents on one row -- the free pick and the
 * [utility] one -- each with a sphere and a note of its own, which is why the
 * columns are named per entry rather than assumed.
 */
const PLAIN_COLUMNS = { talent: 'talent', sphere: 'sphere', notes: 'notes' };
const UTILITY_COLUMNS = { talent: 'utilityTalent', sphere: 'utilitySphere', notes: 'utilityNotes' };
function notedTalentRows(model, sideKey) {
  const side = model.data?.training?.[sideKey];
  const out = [];
  const ladder = (cls, utility) => {
    for (const lv of cls.levels || []) {
      out.push([lv, PLAIN_COLUMNS]);
      if (utility) out.push([lv, UTILITY_COLUMNS]);
    }
  };
  // The blocks the tab draws as its own: not a blended one, which is drawn
  // under Blended training, and not one from the extended-level page.
  const blended = sideKey === 'guile'
    ? (cls) => !!(cls.blendedCombat || cls.blendedMagic)
    : (cls) => !!(cls.blended || cls.blendedSkill || cls.blendedMirror || cls.extended);
  for (const cls of side?.classes || []) if (!blended(cls)) ladder(cls, sideKey === 'guile');
  for (const pool of blendedClasses(model)) {
    if (!pool.systems.includes(sideKey)) continue;
    ladder(pool.owner.cls, pool.kind === 'guile' || poolHasUtility(pool.owner.cls, pool.owner.side));
  }
  for (const b of side?.bonusTalents || []) out.push([b, PLAIN_COLUMNS]);
  // Every customized weapon's talents, drawn or stowed: each has a note.
  if (sideKey === 'combat') {
    for (const block of side?.customizations || []) {
      for (const set of block.sets || []) {
        if (set.spare) continue;
        for (const row of set.talents || []) if (row.granted !== false) out.push([row, PLAIN_COLUMNS]);
      }
    }
  }
  return out;
}

/**
 * What a talent cell is in the catalogue: a base pick -- the sphere itself,
 * which is what its base abilities say -- or a talent of the sphere. `base`
 * says which was asked, and `entry` is what the catalogue had (null when
 * nothing). Every reader that turns a typed row into catalogue text asks
 * here, so a base pick is told apart from a talent one way.
 */
export function catalogueEntry(sphere, talent, model = null) {
  if (isBasePickOf(talent, sphere)) {
    return { base: true, entry: sphereBasePick(basePickSphere(talent, sphere), talent, model) };
  }
  return { base: false, entry: sphereTalent(sphere, talent) };
}

/** What the catalogue would put in a row's note, or '' when it knows nothing. */
function noteFromCatalogue(model, row, f) {
  const talent = row?.[f.talent];
  if (!String(talent ?? '').trim()) return '';
  const { base, entry } = catalogueEntry(row[f.sphere], talent, model);
  return base ? entry?.text || '' : talentNoteText(entry, talent);
}

/**
 * What an Alternate Training row is, put the way a sphere tab's row would
 * write it -- so the one lookup serves both.
 *
 * A technique with a sphere hands out that sphere's talents, but says so in
 * its own ways. Light Body's 1st level is the Athletics sphere with a choice
 * of package, and the ladder's cell holds only "(leap)"; Keen Mind's is
 * "Divination sphere" outright; 3rd and 5th are talents the rules name; from
 * 7th the player types one. Each of those is a row a sphere tab would have
 * written as "Athletics Sphere (leap)", "Divination Sphere", "Wall Stunt" --
 * and that is what this returns. '' for a level that grants no talent: its
 * feat, spell or power has a catalogue of its own and is not this one's to
 * answer for.
 */
export function altTrainingLookup(model, row) {
  const sphere = model.data.altTraining?.calc?.talents?.sphere;
  const grant = (row?.grants || []).find((g) => g.talent);
  if (!sphere || !grant) return '';
  const typed = String(row.text ?? '').trim();
  // What was typed wins, as it does in the cell. Failing that, the name the
  // rules gave *this* grant -- not the row's joined name, which at a level
  // that also hands over a feat is the feat's.
  const said = typed || String(grant.name ?? '').trim();
  if (!said) return '';
  // A bare "(leap)" is the package of the technique's own sphere.
  return /^\([^)]*\)$/.test(said) ? `${sphere} Sphere ${said}` : said;
}

/** What the sphere catalogue says about that row's talent, or ''. */
function altTrainingTalentText(model, row) {
  const typed = altTrainingLookup(model, row);
  if (!typed) return '';
  const sphere = model.data.altTraining?.calc?.talents?.sphere;
  const { base, entry } = catalogueEntry(sphere, typed, model);
  if (base) return entry?.text || '';
  // The technique's own sphere first; a talent it may take from elsewhere is
  // still found, by the whole catalogue.
  return talentNoteText(entry || sphereTalent(null, typed), typed);
}

/**
 * What the packs say about a ladder row, or '': its talent from the sphere
 * catalogue, and a feat, spell or power it grants from that catalogue. A
 * grant the rules name is looked up by that name; one the player chooses, by
 * what was typed. A row granting two things (1st level is often a talent and
 * a feat) gets both, each under its name.
 */
function altTrainingNoteText(model, row) {
  const parts = [];
  const talent = altTrainingTalentText(model, row);
  if (talent) parts.push([altTrainingLookup(model, row), talent]);
  const typed = String(row?.text ?? '').trim();
  const lookups = [['feat', featEntry], ['spell', spellEntry], ['power', powerEntry]];
  for (const g of row?.grants || []) {
    for (const [kind, entry] of lookups) {
      if (!grantCount(g, kind)) continue;
      const name = g.pick && !grantCount(g, 'talent') ? typed : String(g.name ?? '').trim();
      const text = name ? String(entry(name)?.text ?? '').trim() : '';
      if (text) parts.push([entry(name)?.name || name, text]);
    }
  }
  if (parts.length <= 1) return parts[0]?.[1] || '';
  return parts.map(([name, text]) => `${name}: ${text}`).join('\n\n');
}

/** The rows of the ladder whose note is empty and could be filled, as `[level, text]`. */
function blankAltTrainingNotes(model) {
  const p = model.data.altTraining;
  return (p?.calc?.rows || [])
    .filter((row) => !String(p.rowNotes?.[row.level] ?? '').trim())
    .map((row) => [row.level, altTrainingNoteText(model, row)])
    .filter(([, text]) => text);
}

/**
 * Write an Alternate Training pick, and fill its note the way a sphere tab's
 * talent cell would: only when the note is empty, only from a name the
 * catalogue knows.
 */
export function setAltTrainingPick(model, level, value) {
  const p = model.data.altTraining;
  if (!p) return model;
  if (!p.picks || typeof p.picks !== 'object') p.picks = {};
  p.picks[level] = String(value ?? '');
  // The rows are worked out at recompute, and the lookup reads the row.
  model.recompute();
  const filled = [];
  const hit = blankAltTrainingNotes(model).find(([lvl]) => String(lvl) === String(level));
  if (hit) {
    if (!p.rowNotes || typeof p.rowNotes !== 'object') p.rowNotes = {};
    p.rowNotes[level] = hit[1];
    filled.push('notes');
    model.recompute();
  }
  emit(model, { type: 'set', path: `altTraining.picks.${level}`, value: p.picks[level], filled });
  return model;
}

/**
 * How many talents on a side the catalogue knows and whose note is empty.
 *
 * `setTalentEntry` fills a note at the moment a talent is typed, which is no
 * help to the sheet that was filled in first and given its packs second: every
 * talent on it is marked, none has its text, and retyping forty names to ask
 * for them is not an answer. This is the count behind the button that asks
 * once for the lot.
 */
export function blankTalentNotes(model, sideKey) {
  // The Alternate Training ladder keeps its picks and notes by level rather
  // than as rows of a list, so it is counted by its own reader.
  if (sideKey === 'altTraining') return blankAltTrainingNotes(model).length;
  return notedTalentRows(model, sideKey)
    .filter(([row, f]) => !String(row[f.notes] ?? '').trim() && noteFromCatalogue(model, row, f)).length;
}

/**
 * Fill those notes. The rule is `setTalentEntry`'s and is not loosened: only a
 * note that is empty, only from a name the catalogue knows, and a sphere the
 * row already chose still decides which talent that is.
 *
 * This is the one place a pack's text is copied onto the character. Feats,
 * spells, powers, veils and maneuvers show the pack's words beside the
 * player's and never store them (ui/html.js, `catalogueFace`); a sphere talent
 * takes them into its note, because the player asks for it here, row by row
 * or with one button, and the note is theirs to cut down afterwards. Kept as
 * the exception on purpose (2026-09-29): a pack corrected later does not
 * correct a note already filled.
 */
export function fillTalentNotes(model, sideKey) {
  // Worked out first and written after, so the undo step is taken only when
  // there is something to fill, and before any of it is.
  const alt = sideKey === 'altTraining' ? blankAltTrainingNotes(model) : [];
  const rows = [];
  for (const [row, f] of notedTalentRows(model, sideKey)) {
    if (String(row[f.notes] ?? '').trim()) continue;
    const text = noteFromCatalogue(model, row, f);
    if (text) rows.push([row, f, text]);
  }
  if (!alt.length && !rows.length) return 0;
  markUndo(model, 'Filled talent notes');
  let filled = 0;
  if (alt.length) {
    const p = model.data.altTraining;
    if (!p.rowNotes || typeof p.rowNotes !== 'object') p.rowNotes = {};
    for (const [level, text] of alt) {
      p.rowNotes[level] = text;
      filled++;
    }
  }
  for (const [row, f, text] of rows) {
    row[f.notes] = text;
    // An empty sphere is settled the same way it would have been on typing.
    if (!String(row[f.sphere] ?? '').trim()) {
      const hit = catalogueEntry(null, row[f.talent]).entry;
      if (hit?.sphere) row[f.sphere] = hit.sphere;
    }
    filled++;
  }
  if (filled) {
    model.recompute();
    emit(model, { type: 'talent-notes', side: sideKey, filled });
  }
  return filled;
}

/** A talent row nobody has written anything into. */
const isBlankTalentRow = (row) => !String(row?.talent ?? '').trim()
  && !String(row?.sphere ?? '').trim() && !String(row?.notes ?? '').trim();

/**
 * Skill-rank budget: ranks/level (best class, gestalt) + Int bonus/level +
 * bonus points/level, times character level, against the ranks bought.
 *
 * Two of those three are worked out here rather than typed.
 *
 * **Int per level** is the character's Intelligence modifier and nothing else,
 * so it cannot drift from the score above it -- it was a typed number, and a
 * typed number that is supposed to equal another number on the same sheet is a
 * number that will one day not. All five source sheets already store exactly
 * the modifier, so reading it instead of trusting it changes nothing and
 * closes the gap. Still a flat metric: it follows the *current* modifier, and
 * raising Int at 12th does not refund ranks for the eleven levels before it,
 * which is the rule as written.
 *
 * **Bonus points per level** may be written as a formula, like every other
 * field on the sheet that takes a number a rule decides -- `level >= 5 ? 2 : 1`
 * for a benefit that arrives partway up. The raw text stays in
 * `bonusPerLevel`; what it comes to is `bonusResolved`, and a formula that
 * will not parse says so in `bonusError` rather than quietly counting as zero.
 */
export function applyBudget(model) {
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const b = c.skillBudget || (c.skillBudget = { bonusPerLevel: 0, intPerLevel: 0 });
  b.intPerLevel = Number(c.abilities?.int?.mod) || 0;
  b.bonusError = null;
  let bonus = 0;
  const raw = b.bonusPerLevel;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      bonus = Math.floor(Number(evaluateFormula(raw, { level })) || 0);
    } catch (err) {
      b.bonusError = err.message;
    }
  } else {
    bonus = Math.floor(Number(raw) || 0);
  }
  b.bonusResolved = bonus;
  // A rule elsewhere on the sheet can grant a point per level -- see
  // `skill.pointsPerLevel` in FORWARD_LATE. Kept beside what the player typed
  // rather than folded into it, the same bargain every other forwarded bonus
  // on the sheet is on: the box has to go on saying what was written in it.
  b.forwarded = forwarded(model, 'skill.pointsPerLevel');
  const perLevel = (c.gestalt?.ranksPerLevel || 0) + b.intPerLevel + bonus + b.forwarded;
  const available = perLevel * level;
  const assigned = (c.skills || []).reduce(
    (t, s) => t + (Number(s.boughtResolved) || 0), 0,
  );
  b.perLevel = perLevel;
  b.available = available;
  b.assigned = assigned;
  b.remaining = available - assigned;
  b.status = assigned > available ? 'error' : assigned < available ? 'warning' : 'ok';
}

/**
 * A class's own levels at or below the character's.
 *
 * Not `classLevelCount`, which adds the "counts as levels higher"
 * forwarding: a talent budget is deliberately not moved by an
 * effective-level rule, the same line the casting block draws, and for the
 * same reason -- counting as two levels higher says what the class can do,
 * not that it was handed two more levels to spend.
 */
export function ownClassLevels(model, className) {
  // The training class's own override says how many levels it has, the way
  // the class's talent ladder reads it; otherwise the levels the Classes
  // table or the Planner give, as every other count does. Only the Planner
  // used to count here, so an override of 7 on an empty Planner gave no
  // weapons at all.
  const name = String(className || '').trim().toLowerCase();
  const t = model.data.training || {};
  const cls = name && ['combat', 'magic', 'guile'].flatMap((k) => t[k]?.classes || [])
    .find((x) => String(x?.name || '').trim().toLowerCase() === name && isPinned(x.classLevelsOverride));
  const level = Number(model.data.identity?.level) || 20;
  if (cls) return Math.max(0, Math.min(level, Math.floor(Number(cls.classLevelsOverride) || 0)));
  return ownLevelCount(model, className).own;
}

/**
 * The Spheres of Power caster level: `caster.level` in a formula, and what
 * the sheet charges material-casting upkeep against, conjures a companion at
 * and rolls card dice with.
 *
 * Only Spheres casting has one. A Vancian caster level and a manifester level
 * belong to their own systems (`vancian.<class>.cl`, `manifester.<class>.level`),
 * and none of the three stands in for another -- a feature that grants that
 * kind of transparency would be the place to join them. A character with no
 * magic side has none, where this used to fall back to the character's level.
 */
export function casterLevel(model) {
  return Number(model.data.training?.magic?.globalCL) || 0;
}

/**
 * Size each parallel talent track, and settle which one is live.
 *
 * The counts are computed and never stored, exactly as a class ladder's
 * granted rows are: taking the next armiger level opens the next weapon and
 * one more row on every weapon at once, and losing it folds them shut again
 * with what was written in them still there.
 *
 * A weapon carrying a drawback holds one extra row, because that is what a
 * drawback on a weapon-granted sphere is for; buying it off spends the row
 * again, which is why the tick is beside the drawback rather than replacing
 * it.
 */
export function recomputeCustomizations(model, side) {
  if (!Array.isArray(side.customizations)) side.customizations = [];
  for (const block of side.customizations) {
    const spec = normalizeTalentTracks(block.spec) || normalizeTalentTracks({});
    block.spec = spec;
    block.classLevels = ownClassLevels(model, block.className);
    block.setCount = trackCount(spec.sets, block.classLevels);
    block.talentCount = trackCount(spec.talents, block.classLevels);

    if (!Array.isArray(block.sets)) block.sets = [];
    while (block.sets.length < block.setCount) block.sets.push({ weapon: '', talents: [] });
    block.sets.forEach((set, i) => {
      // A set past the count is one the character used to be able to keep --
      // a level lost to a rebuild, an override typed down. It is greyed and
      // counts for nothing, but it is not thrown away.
      set.spare = i >= block.setCount;
      set.drawback = String(set.drawback ?? '');
      set.boughtOff = !!set.boughtOff;
      set.bonusTalent = set.drawback.trim() && !set.boughtOff ? 1 : 0;
      const rows = set.spare ? 0 : block.talentCount + set.bonusTalent;
      if (!Array.isArray(set.talents)) set.talents = [];
      while (set.talents.length < rows) set.talents.push({ talent: '', sphere: null, notes: '' });
      // A row that closed with nothing in it was never anything; one that
      // closed with a talent written on it is kept and greyed, so a level
      // typed down by mistake costs nobody their notes.
      while (set.talents.length > rows && isBlankTalentRow(set.talents[set.talents.length - 1])) {
        set.talents.pop();
      }
      set.talents.forEach((row, ri) => { row.granted = ri < rows; });
    });
    // The same for a weapon nobody ever named.
    while (block.sets.length > block.setCount
      && block.sets[block.sets.length - 1].spare
      && !String(block.sets[block.sets.length - 1].weapon || '').trim()
      && !(block.sets[block.sets.length - 1].talents || []).length) {
      block.sets.pop();
    }
    // The switch must land on a weapon that exists. It stays where it is
    // whenever it can, so opening a fourth weapon never moves what is drawn.
    const live = Math.floor(Number(block.active) || 0);
    block.active = block.setCount ? Math.min(Math.max(0, live), block.setCount - 1) : 0;
  }
}

/**
 * Flag the rule that actually bites: a weapon may not learn a talent of a
 * sphere it has no base in.
 *
 * "A customized weapon must possess a base sphere before additional talents
 * of that sphere may be added unless the armiger possesses that sphere" --
 * so the question is asked of the weapon first and of the character second,
 * and the character's half reads `tallyOwn`, since a sphere she only has
 * from *another* weapon is not one she possesses.
 *
 * Three-valued like every other requirement here: a row with no talent
 * written in it yet is unknown, not wrong, and is left alone.
 */
export function checkCustomizationBases(model, t) {
  // A sphere a veil grants is had as much as one trained: a veil the
  // character has shaped makes it theirs, and one a weapon's own talent
  // names (the Veilweaving base pick "(Bands of the Asura)") makes it that
  // weapon's.
  const shaped = [...(model.data.akashic?.slots || []), ...(model.data.akashic?.kheshig || [])]
    .flatMap((s) => (s.veils || []).map((v) => v.name));
  const veilSpheres = new Set(shaped.flatMap((v) => veilGrantedSpheres(v)).map((s) => canonicalSphere(s).toLowerCase()));
  const owned = (sphere) => talentsIn(t.combat?.tallyOwn, sphere) > 0
    || talentsIn(t.magic?.tallyOwn, sphere) > 0
    || veilSpheres.has(canonicalSphere(sphere).toLowerCase());
  for (const block of t.combat?.customizations || []) {
    // What the track may learn from at all. A sphere outside it is flagged
    // and kept, never dropped: it is nearly always a track whose archetype
    // has not been added yet, and throwing the row away would lose the
    // player's work to punish them for the order they did things in.
    const allowed = new Set(trackSphereNames(block.spec).map((s) => s.trim().toLowerCase()));
    for (const set of block.sets || []) {
      const live = (set.talents || []).filter((r) => r.granted !== false);
      const bases = new Set([
        ...live.filter((r) => isBasePick(r.talent)).map((r) => String(r.sphere || '').trim()),
        ...live.flatMap((r) => veilsNamedIn(r.talent)).flatMap((v) => veilGrantedSpheres(v)),
      ].filter(Boolean).map((s) => canonicalSphere(s).toLowerCase()));
      for (const row of set.talents || []) {
        const sphere = String(row.sphere || '').trim();
        row.offList = !!sphere && row.granted !== false && !allowed.has(sphere.toLowerCase());
        row.needsBase = !!sphere && !!String(row.talent || '').trim()
          && row.granted !== false && !isBasePick(row.talent)
          && !bases.has(canonicalSphere(sphere).toLowerCase()) && !owned(sphere);
      }
    }
  }
}

/**
 * Start a track for a class, or hand its spec to the one already there.
 *
 * A pack's class block carries the spec, and attaching copies it in like
 * everything else a pack lands, so the character travels without the pack.
 * Adding the same class twice tunes what is there rather than making a
 * second block -- a class grants its customizations once.
 */
export function addCustomization(model, className, spec = DEFAULT_TALENT_TRACKS) {
  const t = model.data.training;
  if (!t?.combat) return null;
  if (!Array.isArray(t.combat.customizations)) t.combat.customizations = [];
  const name = String(className ?? '').trim();
  const at = t.combat.customizations.findIndex((b) => normalizeName(b.className) === normalizeName(name));
  const block = at === -1
    ? { className: name, active: 0, sets: [] }
    : t.combat.customizations[at];
  block.spec = normalizeTalentTracks(spec) || normalizeTalentTracks({});
  if (at === -1) t.combat.customizations.push(block);
  model.recompute();
  emit(model, { type: 'customization-add', className: name });
  return block;
}

/** The track a class grants, or null where it grants none. */
export function customizationFor(model, className) {
  return (model.data.training?.combat?.customizations || [])
    .find((b) => normalizeName(b.className) === normalizeName(className)) || null;
}

/**
 * Change an existing track's spec, and hand back what it was.
 *
 * Only a track that is there: this is the door an archetype comes through,
 * and an archetype that merely widens the sphere list has no counting rules
 * of its own to invent one with. The returned spec is what puts it back when
 * the archetype comes off.
 */
export function setCustomizationSpec(model, className, spec) {
  const block = model.customizationFor(className);
  if (!block) return null;
  const before = block.spec ? JSON.parse(JSON.stringify(block.spec)) : null;
  block.spec = normalizeTalentTracks(spec) || normalizeTalentTracks({});
  model.recompute();
  emit(model, { type: 'customization-spec', className, spec: block.spec });
  return before;
}

export function removeCustomization(model, index) {
  const list = model.data.training?.combat?.customizations;
  if (!list?.[index]) return model;
  markUndo(model, `Removed ${rowLabel(list[index], 'customized weapons')}`);
  list.splice(index, 1);
  model.recompute();
  emit(model, { type: 'customization-remove', index });
  return model;
}

/**
 * Edit one of the two counting rules. `key` is 'sets' or 'talents', `field`
 * its start or the levels it goes up at.
 */
export function setCustomizationRule(model, index, key, field, value) {
  const block = model.data.training?.combat?.customizations?.[index];
  if (!block) return model;
  if (!block.spec) block.spec = normalizeTalentTracks({});
  // Which sphere lists the track may learn from is a property of the track
  // rather than of either counting rule, so it comes through the same door
  // with no field of its own.
  if (key === 'spheres') {
    if (!TRACK_SPHERE_SIDES.includes(field)) return model;
    block.spec.spheres = field;
    model.recompute();
    emit(model, { type: 'customization-rule', index, key, field });
    return model;
  }
  if (!['sets', 'talents'].includes(key)) return model;
  if (field === 'start') block.spec[key].start = Math.max(0, Math.floor(Number(value) || 0));
  else if (field === 'gainsAt') block.spec[key].gainsAt = String(value ?? '').trim();
  else return model;
  model.recompute();
  emit(model, { type: 'customization-rule', index, key, field, value });
  return model;
}

/** Which weapon of a track is live. */
export function setCustomizationActive(model, index, setIndex) {
  const block = model.data.training?.combat?.customizations?.[index];
  if (!block) return model;
  block.active = Math.max(0, Math.floor(Number(setIndex) || 0));
  model.recompute();
  emit(model, { type: 'customization-active', index, setIndex: block.active });
  return model;
}

/**
 * Whether a ladder row's talent is one the character has: a slot the class
 * grants, at a level the character has reached. Every tally counts by this
 * -- the sphere sides, a blended pool, a guile class -- and so does the
 * knowledge a prerequisite reads.
 */
export const rowCounts = (lv) => !!lv?.granted && !lv.future;
export const utilityCounts = (lv) => !!lv?.utilityGranted && !lv.future;

/**
 * Every talent the character has trained on one side -- Martial, Magic or
 * Guile: the class ladders (a blended pool's or a guile class's rows land on
 * the side their sphere belongs to, wherever the block itself lives, and both
 * of a two-ladder pool's rows count), bonus talents, and the tradition's when
 * asked. One walk for all three sides, so the tallies and anything that asks
 * which talents are there -- a skill-rank requirement, the veil traditions,
 * the guile plans -- read the same rows.
 *
 * Yields { sphere, talent, utility, spent }: `utility` for a [utility]
 * ladder's pick or bonus talent, and `spent` false only for a bonus talent
 * ticked *free* -- one a base sphere or a drawback handed over, which on the
 * guile side buys no skill ranks.
 *
 * Every ladder counts only what the character has at the level they are:
 * a slot the class grants (`granted`), at a level reached (`!future`).
 * A tradition's adroit entries count only at adroit rank.
 */
export function* ownTalentRows(model, side, { sideKey = null, includeTradition = true } = {}) {
  // A blended class holds one pool of talents spent on either kind, so each
  // of its talents is counted once, on the side its sphere belongs to. Its
  // mirror on the other side is the same pool seen twice and contributes
  // nothing of its own.
  function* ladder(cls, home, utility) {
    const systems = poolSystems(cls, home);
    for (const lv of cls.levels || []) {
      if (rowCounts(lv) && talentLandsOn(lv.sphere, systems) === sideKey) {
        yield { sphere: lv.sphere, talent: lv.talent, utility: false, spent: true };
      }
      if (utility && utilityCounts(lv) && talentLandsOn(lv.utilitySphere, systems) === sideKey) {
        yield { sphere: lv.utilitySphere, talent: lv.utilityTalent, utility: true, spent: true };
      }
    }
  }
  if (!side) return;
  const training = model?.data?.training || {};
  if (sideKey === 'guile') {
    // Every guile class is a two-ladder pool; a row whose sphere is another
    // system's lands there instead, or nowhere (talentLandsOn).
    for (const cls of side.classes || []) yield* ladder(cls, 'guile', true);
    // A martial or magic class that reaches skill talents spends the rows
    // whose sphere is a skill sphere here, on both its ladders.
    for (const key of ['combat', 'magic']) {
      for (const cls of training[key]?.classes || []) {
        if (cls.blendedSkill && !cls.blendedMirror) yield* ladder(cls, key, poolHasUtility(cls, key));
      }
    }
  } else {
    for (const cls of side.classes || []) {
      if (cls.blendedMirror) continue;
      if (cls.blended || cls.blendedSkill) {
        const home = sideKey ?? cls.side;
        yield* ladder(cls, home, poolHasUtility(cls, home));
      } else {
        for (const lv of cls.levels || []) if (rowCounts(lv)) yield { sphere: lv.sphere, talent: lv.talent, utility: false, spent: true };
      }
    }
    if (sideKey) {
      const otherKey = sideKey === 'magic' ? 'combat' : 'magic';
      for (const cls of training[otherKey]?.classes || []) {
        if (cls.blended && !cls.blendedMirror) yield* ladder(cls, otherKey, poolHasUtility(cls, otherKey));
      }
      // A guile class that reaches this side spends both of its ladders here
      // when the sphere is one of this side's.
      for (const cls of training.guile?.classes || []) {
        if (poolSystems(cls, 'guile').includes(sideKey)) yield* ladder(cls, 'guile', true);
      }
    }
  }
  for (const b of side.bonusTalents || []) {
    yield { sphere: b.sphere, talent: b.talent, utility: !!b.utility, spent: !b.free };
  }
  if (includeTradition) {
    const adroit = side.tradition?.rank === 'Adroit';
    for (const e of side.tradition?.entries || []) {
      if (e?.adroit && !adroit) continue;
      yield { sphere: e.sphere, talent: e.talent, utility: false, spent: true };
    }
  }
}

/**
 * Count sphere occurrences across a training side's talent sources.
 *
 * `side` is the side's own block, which does not say which side it is, so
 * technique talents -- the only source that has to know -- are keyed off the
 * caller's `sideKey`.
 */
export function sphereTally(model, side, { includeTradition = true, sideKey = null, customizations = 'active' } = {}) {
  const tally = {};
  const bump = (s, n = 1) => {
    if (typeof s === 'string') tallyAdd(tally, s, n);
  };
  for (const row of ownTalentRows(model, side, { sideKey, includeTradition })) bump(row.sphere);
  // A parallel track -- an armiger's customized weapon -- is a talent source
  // with a switch, so it is the one source that has to be told which
  // question is being asked: what is live right now ('active'), everything
  // the tracks have been granted ('all'), or nothing of theirs at all
  // ('none' -- what the character possesses in her own right). A track lives
  // on the martial side whichever sphere it teaches, so each row lands on
  // the side its sphere belongs to, the way a blended class's talents do.
  if (customizations !== 'none') {
    for (const block of model.data.training?.combat?.customizations || []) {
      (block.sets || []).forEach((set, i) => {
        if (set.spare || (customizations === 'active' && i !== block.active)) return;
        for (const row of set.talents || []) {
          if (row.granted !== false && trackTalentSide(row.sphere) === sideKey) bump(row.sphere);
        }
      });
    }
  }
  const technique = altTrainingTalents(model);
  if (technique && technique.side === sideKey) bump(technique.sphere, technique.count);
  return tally;
}

/**
 * Tie the two halves of each blended class together.
 *
 * A class that trains both ways -- Angou's Legendary Monk, Bryva's
 * Blacksmith -- is one class with one pool of talents and two progressions:
 * it advances as a practitioner at one rate and as a caster at another, and
 * each talent it learns is martial or magical depending on the sphere. The
 * workbook writes it as a block on each tab holding the same talents twice,
 * which is where the doubled groups came from.
 *
 * Rather than merge the two records -- every per-side number, from the
 * practitioner DC to the spell-point pool, is computed off the block sitting
 * on that side -- the pair is kept and the talents are shared: the combat
 * half owns the rows and the magic half is pointed at the same array. One
 * list of talents, edited in one place, counted once.
 */
export function pairBlended(model) {
  const t = model.data.training || {};
  const magic = t.magic?.classes || [];
  const combat = t.combat?.classes || [];
  // Rows still shared by two blocks whose names no longer match -- one of
  // them was renamed -- are split into two copies, so an edit to one stops
  // changing the other and neither side counts the other's talents.
  for (const m of magic) {
    const holder = combat.find((c) => c.levels && c.levels === m.levels);
    if (holder && holder.name !== m.name) m.levels = m.levels.map((lv) => ({ ...lv }));
  }
  const written = (levels) => (levels || [])
    .some((lv) => String(lv?.talent ?? '').trim() || String(lv?.sphere ?? '').trim());
  const sameTalents = (a, b) => (a || []).length === (b || []).length
    && (a || []).every((lv, i) => String(lv?.talent ?? '') === String(b[i]?.talent ?? '')
      && String(lv?.sphere ?? '') === String(b[i]?.sphere ?? ''));
  for (const cls of combat) {
    delete cls.blendedMirror;
    const twin = cls.name && magic.find((m) => m.name === cls.name);
    // `blended: false` is a decision -- two blocks that share a name and are
    // deliberately kept apart -- and is left alone.
    if (!twin || cls.blended === false || twin.blended === false) continue;
    // Pairing makes the two blocks share one list of rows, so it is only done
    // where that loses nothing: the rows are shared already, one side has
    // none written, or both hold the same talents -- the workbook's way of
    // writing a blended class, a block on each tab with its talents twice.
    // Two different pools under one name, a class renamed onto another's, are
    // left apart: pairing them overwrote the magic block's talents.
    const noOwnRows = !(cls.levels || []).length && (twin.levels || []).length;
    const takesTwins = !written(cls.levels) && written(twin.levels);
    if (cls.levels !== twin.levels && !noOwnRows && !takesTwins
      && written(twin.levels) && !sameTalents(cls.levels, twin.levels)) {
      // Not a mirror of anything now, whatever an earlier pairing left on it:
      // a mirror's talents are counted through its owner, and it has none.
      delete twin.blendedMirror;
      continue;
    }
    cls.blended = true;
    twin.blended = true;
    twin.blendedMirror = true;
    // The owner's rows are the pool. A block with none of its own -- an
    // extended block, or a class named before anything was written in it --
    // takes its twin's, and the roles swap.
    if (noOwnRows || takesTwins) {
      cls.levels = twin.levels;
      cls.blendedMirror = true;
      delete twin.blendedMirror;
    } else {
      twin.levels = cls.levels || [];
    }
    // Reaching skill talents is a fact about the pool, so the owner carries
    // it whichever half it was ticked on.
    // So are the settings that size its two ladders, when it has them.
    const [owner, mirror] = cls.blendedMirror ? [twin, cls] : [cls, twin];
    if (mirror.blendedSkill) owner.blendedSkill = true;
    delete mirror.blendedSkill;
    for (const key of ['expertise', 'anyRule', 'utilityRule']) {
      if (mirror[key] != null && mirror[key] !== '' && (owner[key] == null || owner[key] === '')) owner[key] = mirror[key];
      delete mirror[key];
    }
    // One class, one count of its levels: the mirror follows the owner's
    // override, which is the one the Blended training panel shows. One of its
    // own, typed before the pair was made, is dropped rather than left to
    // make the two halves disagree out of sight.
    if (owner.classLevelsOverride == null) delete mirror.classLevelsOverride;
    else mirror.classLevelsOverride = owner.classLevelsOverride;
  }
  for (const m of magic) {
    if (m.blended && !(t.combat?.classes || []).some((x) => x.name === m.name)) {
      delete m.blended;
      delete m.blendedMirror;
    }
  }
}

/**
 * Turn a training class into a blended one, or split it back apart.
 *
 * Blending gives the class a block on the other side too -- that is where
 * its caster level, or its practitioner DC, is worked out from -- with no
 * talents of its own: the pool it already has is shared with it.
 */
export function setBlended(model, sideKey, index, on) {
  const t = model.data.training || {};
  const cls = t[sideKey]?.classes?.[index];
  if (!cls || !cls.name) return model;
  const otherKey = sideKey === 'magic' ? 'combat' : 'magic';
  const other = t[otherKey];
  if (!other) return model;
  const at = (other.classes || []).findIndex((x) => x.name === cls.name);
  if (on) {
    if (at < 0) {
      other.classes = [...(other.classes || []), {
        name: cls.name, type: null, talentsPerLevel: cls.talentsPerLevel,
        mod1: cls.mod1, mod2: null, levels: [], addedByBlend: true,
      }];
    } else {
      // A block kept after a split carries a copy of the talents; the one
      // ticked is the one whose rows become the pool again.
      other.classes[at].levels = cls.levels || [];
      other.classes[at].blended = true;
    }
    // Lift the `false` a split left, or pairing would keep them apart.
    cls.blended = true;
  } else if (at >= 0) {
    markUndo(model, `Split ${rowLabel(cls, 'class')} from its ${otherKey === 'magic' ? 'magic' : 'martial'} half`);
    // The talents stay with the block that owns them. A block that blending
    // added holds nothing of its own, so splitting drops it; one that was
    // there before -- the workbook's other half, with its own type and
    // score -- is kept, with a copy of the talents it was sharing.
    const twin = other.classes[at];
    if (twin.addedByBlend) other.classes.splice(at, 1);
    else twin.levels = (twin.levels || []).map((lv) => ({ ...lv }));
    // An explicit false, not a missing flag: the two blocks still share a
    // name, and pairing would otherwise put them straight back together.
    for (const x of [cls, twin]) { x.blended = false; delete x.blendedMirror; }
  }
  model.recompute();
  emit(model, { type: 'blend', side: sideKey, index, on: !!on });
  return model;
}

/**
 * Let a class's pool of talents reach skill talents too, or stop it.
 *
 * Unlike pairing with the other sphere side this adds no block: nothing on
 * the guile side is worked out per class. Ticked on a pair's mirror, it lands
 * on the owner, which is the half whose rows are the pool.
 */
export function setBlendedSkill(model, sideKey, index, on) {
  const t = model.data.training || {};
  let cls = t[sideKey]?.classes?.[index];
  if (!cls || !cls.name) return model;
  if (cls.blendedMirror) {
    const otherKey = sideKey === 'magic' ? 'combat' : 'magic';
    cls = (t[otherKey]?.classes || []).find((x) => x.name === cls.name && !x.blendedMirror) || cls;
  }
  if (on) cls.blendedSkill = true;
  else if (cls.blendedSkill) {
    markUndo(model, `Stopped ${rowLabel(cls, 'class')} counting skill talents`);
    delete cls.blendedSkill;
  }
  model.recompute();
  emit(model, { type: 'blend-skill', side: sideKey, index, on: !!on });
  return model;
}

/**
 * Let a guile class's two ladders reach martial or magical talents, or stop
 * them. No block is added on that side either: a skill class brings no
 * practitioner or caster level with it, only talents. The side itself is
 * conjured if the character has none, so there is somewhere to count them.
 */
/**
 * Whether a class's pool reaches one more kind of talent, by the class's own
 * side and its index there: a martial or magic class reaching the other of
 * the two (setBlended) or skill talents (setBlendedSkill), or a guile class
 * reaching either (setGuileBlend). The one thing every "counts as" tick asks.
 */
export function setPoolReach(model, home, index, system, on) {
  if (home === 'guile') return setGuileBlend(model, index, system, on);
  if (system === 'guile') return setBlendedSkill(model, home, index, on);
  return setBlended(model, home, index, on);
}

export function setGuileBlend(model, index, sideKey, on) {
  const t = model.data.training || {};
  const cls = t.guile?.classes?.[index];
  if (!cls || !cls.name || !['combat', 'magic'].includes(sideKey)) return model;
  const key = sideKey === 'combat' ? 'blendedCombat' : 'blendedMagic';
  if (on) {
    cls[key] = true;
    if (!t[sideKey] || typeof t[sideKey] !== 'object') t[sideKey] = {};
  } else if (cls[key]) {
    markUndo(model, `Stopped ${rowLabel(cls, 'class')} counting ${sideKey === 'combat' ? 'martial' : 'magical'} talents`);
    delete cls[key];
  }
  model.recompute();
  emit(model, { type: 'blend-guile', index, side: sideKey, on: !!on });
  return model;
}

/**
 * Every class whose pool spans more than one system, once each.
 *
 * `systems` is what the pool reaches, the owner's own first. `kind` says
 * which shape of class holds the rows: 'sphere' for a martial or magic
 * class, one ladder, with `twin` the paired block on the other sphere side
 * when there is one; 'guile' for a skill class and its two ladders.
 */
export function blendedClasses(model) {
  const t = model.data.training || {};
  const pairs = [];
  for (const side of ['combat', 'magic']) {
    (t[side]?.classes || []).forEach((cls, index) => {
      if (!(cls.blended || cls.blendedSkill) || cls.blendedMirror) return;
      const other = side === 'combat' ? 'magic' : 'combat';
      const ti = cls.blended ? (t[other]?.classes || []).findIndex((x) => x.name === cls.name) : -1;
      pairs.push({
        name: cls.name,
        kind: 'sphere',
        systems: poolSystems(cls, side),
        owner: { side, index, cls },
        twin: ti < 0 ? null : { side: other, index: ti, cls: t[other].classes[ti] },
      });
    });
  }
  (t.guile?.classes || []).forEach((cls, index) => {
    if (!(cls.blendedCombat || cls.blendedMagic)) return;
    pairs.push({
      name: cls.name,
      kind: 'guile',
      systems: poolSystems(cls, 'guile'),
      owner: { side: 'guile', index, cls },
      twin: null,
    });
  });
  return pairs;
}

/** The types each sphere side's classes may take. */
const SIDE_TYPES = { magic: CASTING_TYPES, combat: PRACTITIONER_TYPES };

/**
 * Recompute both training sides: per-class talent progressions, tradition
 * spell points and boons, and the global casting numbers. Runs before the
 * skills loop because sphere talents grant skill ranks.
 */
/**
 * One class's ladder, level by level, on any of the three sides: which
 * levels the class has (its pin or the Planner), the talent slots each level
 * grants, and the counts. A martial or magic class grows by its Talents /
 * level rate and, when its pool reaches skill talents, by a second
 * [utility] ladder too; a guile class is always the two ladders, sized by
 * its tier or its rules (poolStepper). Sets the slot flags every tally reads
 * (`granted`, `utilityGranted`, `future`) and the class's totals.
 */
export function walkClassLadder(model, cls, home, level) {
  cls.side = home;
  const guile = home === 'guile';
  let rate = 0;
  let progRate = 0;
  if (!guile) {
    // Several sheets fill in only one of type / talents-per-level; each falls
    // back to the other. The fallback only reads a rate that belongs to this
    // side: a blended class's other half copies the martial rate, and how
    // fast a class learns martial talents says nothing about its caster
    // level. Expert on the magic side is not a casting type, so the half has
    // none until one is picked.
    const tpl = cls.talentsPerLevel || TYPE_TO_TALENTS[cls.type] || null;
    const guess = TALENTS_TO_TYPE[cls.talentsPerLevel] || null;
    const type = cls.type || (guess && SIDE_TYPES[home].includes(guess) ? guess : null);
    rate = TALENT_RATES[tpl] ?? 0;
    progRate = TYPE_RATES[type] ?? 0;
    cls.effectiveType = type;
    cls.effectiveTalentsPerLevel = tpl;
  }
  // Sparse planners list a class once rather than on every row; the
  // override lets the player state the real class level count directly.
  const override = cls.classLevelsOverride == null ? null : Number(cls.classLevelsOverride);
  let cum = 0;
  let prog = 0;
  let classLevels = 0;
  let classLevelsCurrent = 0;
  // A pool that reaches skill talents is two ladders, sized however its pool
  // setting says; one that does not is the Talents / level rate alone, and
  // the utility flags a skill tick once left are cleared, so nothing counts
  // them. What was typed in those slots stays put.
  const step = poolHasUtility(cls, home) ? poolStepper(cls, home) : null;
  let pool = guile ? { count: 0, utilityCount: 0 } : null;
  for (const lv of cls.levels || []) {
    const has = classHasLevel(model, cls.name, lv.level, override);
    const before = Math.floor(cum);
    if (has) {
      cum += rate;
      prog += progRate;
      classLevels += 1;
      if (lv.level <= level) classLevelsCurrent += 1;
    }
    // A mirror shares the owner's rows; it counts its own talents off them
    // but must not restate the slot flags in its own rate's terms.
    if (cls.blendedMirror) continue;
    if (!guile) lv.progression = Math.floor(prog);
    lv.future = lv.level > level;
    if (step) {
      pool = step(has, classLevels, lv.level, Math.floor(cum) > before, Math.floor(cum * 100) / 100);
      lv.count = pool.count;
      lv.granted = pool.granted;
      lv.utilityCount = pool.utilityCount;
      lv.utilityGranted = pool.utilityGranted;
    } else {
      lv.count = Math.floor(cum * 100) / 100;
      lv.granted = Math.floor(cum) > before;
      delete lv.utilityCount;
      delete lv.utilityGranted;
    }
  }
  if (!guile && (cls.extended || !(cls.levels || []).length)) {
    // Blocks from the extended page carry no level rows of their own, and nor
    // does a block added by hand before its rows are filled in; count their
    // class levels straight from the override or the Planner.
    for (let l = 1; l <= 20; l++) {
      if (classHasLevel(model, cls.name, l, override)) {
        classLevels += 1;
        if (l <= level) classLevelsCurrent += 1;
      }
    }
  }
  cls.classLevels = classLevels;
  cls.classLevelsCurrent = classLevelsCurrent;
  cls.totalTalents = guile ? pool.count : pool ? Math.floor(pool.count) : Math.floor(cum);
  if (pool) cls.totalUtility = pool.utilityCount;
  else delete cls.totalUtility;
}

export function recomputeTraining(model) {
  const t = model.data.training;
  if (!t) return;
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const mod = (name) => statMod(c, name, null);
  pairBlended(model);
  // Sized before anything counts them, since the tallies below read the rows
  // this opens.
  if (t.combat) recomputeCustomizations(model, t.combat);

  // Every class on all three sides is worked out before any side is counted:
  // a blended pool owned on one side spends talents on another, and counting
  // reads the slot flags this sets. Guile's classes included, which is why
  // there is no separate guile ladder pass to run first.
  for (const sideKey of ['combat', 'magic', 'guile']) {
    for (const cls of t[sideKey]?.classes || []) walkClassLadder(model, cls, sideKey, level);
  }

  // The martial and magic tallies; the guile side's are recomputeGuile's.
  for (const sideKey of ['combat', 'magic']) {
    const side = t[sideKey];
    if (!side) continue;
    // Two readings of the same spheres, because two different questions get
    // asked of them. `tally` is what is live -- the class ladders, the bonus
    // talents, the tradition, and whichever customized weapon is drawn --
    // and drives the sphere tables. `tallyOwn` leaves the weapons out
    // entirely: it is what the character possesses in her own right, which
    // is what a prerequisite asks about and what the bonus skill ranks pay
    // out on, since talents from a customized weapon may not qualify for
    // feats and never grant skill retraining. (There is a third question --
    // every weapon at once, drawn or stowed -- and the unarmed block below
    // is the only thing that asks it, so it asks on the spot.)
    side.tally = sphereTally(model, side, { sideKey });
    side.tallyOwn = sphereTally(model, side, { sideKey, customizations: 'none' });
  }
  checkCustomizationBases(model, t);

  // ----- combat side -----
  if (t.combat) {
    const bestPracMod = Math.max(0, ...(t.combat.classes || [])
      .filter((x) => x.name)
      .map((x) => mod(x.mod1)));
    t.combat.practitionerDC = 10 + Math.floor((Number(c.attack.bab) || 0) / 2) + bestPracMod;
    recomputeUnarmed(model);
  }

  // ----- magic side -----
  if (t.magic) {
    const m = t.magic;
    const casters = (m.classes || []).filter((x) => x.name);
    // A class still to come on the Planner is not a casting class yet: it
    // lends no casting modifier, no spell points, and does not count toward
    // the tradition's spell points per casting class. With none taken (casting
    // from Advanced Magic Training alone) the modifier falls back to the
    // classes named, since that is the only casting ability written down.
    // A class with no casting type picked -- a blended half not yet set --
    // has no casting progression, so it is not a casting class either.
    const casts = (x) => (TYPE_RATES[x.effectiveType] ?? 0) > 0;
    const acquired = casters.filter((x) => (x.classLevelsCurrent ?? 0) > 0 && casts(x));
    const bestMod = Math.max(0, ...(acquired.length ? acquired : casters).map((x) => mod(x.mod1)));

    // Advanced Magic Training grants casting to non-casting classes:
    // Low-Caster progression, or Mid-Caster with the mythic version.
    const amtFloor = m.mythicAmt ? Math.floor(level * 0.75)
      : m.amt ? Math.floor(level * 0.5) : 0;
    // A class counting as levels higher counts here: caster level and magic
    // skill bonus are read off the class level, so a rule that raises one
    // raises the other. Deliberately not the talent budget or the spell
    // points -- "counts as two levels higher" is a rule about what a class
    // can do, not about being handed two more levels' worth of it.
    //
    // The distinction is worth the arithmetic: two class levels on a
    // mid-caster is one caster level, which is what the boost is worth and
    // not what m.clBonus would give.
    //
    // Only a class the character has at the current level: a bonus to a class
    // still to come on the Planner waits (`levelWaiting`) until its first
    // level arrives, as `classLevelCount` does for every other system.
    const effectiveLevels = (x) => {
      const own = x.classLevelsCurrent ?? 0;
      const bonus = forwarded(model, classForwardKey(x.name));
      x.levelWaiting = own ? 0 : bonus;
      return own + (own ? bonus : 0);
    };
    //
    // A bonus forwarded to `spheres.cl` (and .dc, .msb, .msd) lands beside the
    // typed one in the same line, kept apart so the box goes on saying what was
    // typed in it. Caster level feeds everything under it -- the global DC, the
    // concentration check, every sphere's own CL -- so a +1 here moves those
    // too, which is what a bonus to caster level means. A rule that raises
    // only one sphere forwards to `sphere.<name>.cl` instead.
    m.clForwarded = forwarded(model, 'spheres.cl');
    m.dcForwarded = forwarded(model, 'spheres.dc');
    m.msbForwarded = forwarded(model, 'spheres.msb');
    m.msdForwarded = forwarded(model, 'spheres.msd');
    //
    // Casting is unlocked by a level in a casting class or by Advanced Magic
    // Training. Before that, a bonus to caster level -- typed or forwarded --
    // has nothing to raise, so it waits (`clWaiting`) rather than handing a
    // caster level to a character who cannot cast.
    const baseCL = Math.max(0, amtFloor, ...casters.map(
      (x) => Math.floor(effectiveLevels(x) * (TYPE_RATES[x.effectiveType] ?? 0)),
    ));
    m.castingUnlocked = amtFloor > 0 || acquired.length > 0;
    const clPlus = (Number(m.clBonus) || 0) + m.clForwarded;
    m.clWaiting = m.castingUnlocked ? 0 : clPlus;
    m.globalCL = baseCL + (m.castingUnlocked ? clPlus : 0);
    m.globalDC = 10 + Math.floor(m.globalCL / 2) + bestMod + (Number(m.dcBonus) || 0)
      + m.dcForwarded;
    m.msb = Math.max(0, ...casters.map(effectiveLevels))
      + (Number(m.msbBonus) || 0) + m.msbForwarded;
    m.msd = m.msb + 11 + (Number(m.msdBonus) || 0) + m.msdForwarded;
    m.concentration = m.globalCL + bestMod;

    // Tradition drawbacks -> spell points and boons.
    // "x2" entries count double; each drawback feat buys off two drawbacks.
    const tr = m.tradition || {};
    const drawbacks = (tr.drawbacks || []).reduce((n, d) => n + drawbackWeight(d), 0);
    const boughtOff = (tr.boughtOff || []).length;
    const effective = Math.max(0, drawbacks - 2 * boughtOff);
    m.drawbackCount = drawbacks;
    m.boughtOffCount = boughtOff;
    m.effectiveDrawbacks = effective;
    // Every drawback past what the feats bought off is a boon. The sheet
    // separated the first five as a "spell-point tier" and the rest as
    // "boons", but a boon is a boon: they are one count and one ladder.
    m.spTier = Math.min(5, effective);
    m.boons = effective;

    // A tradition grants two pools, and each is spent one way or the other.
    //
    // The spell-point tier grants the ladder read at the tier itself, which
    // is where every one of these sheets put its Essence Boon: Angou's 20 at
    // 20th, Narockro's 11 at 11th, Saburo's 9 at 9th, all exactly the ladder
    // at tier 5, and Bryva -- the one at tier 0 -- has no Essence Boon at
    // all. So essence is what this pool defaults to. It is one pool and is
    // not multiplied.
    //
    // Boons past the tier grant spell points instead, per casting class, the
    // way the sheet totals them: Angou's 1 boon is 4 × 3 classes = the 12 his
    // workbook cached. Taken a step at a time -- boon n is worth what it adds
    // on top of the n-1 below it -- so the steps add back up to the ladder
    // however they are split.
    const castingClassCount = new Set(acquired.map((x) => x.name)).size;

    /**
     * A pool, split step by step between the two things it can become.
     *
     * The ladder is quoted for a whole number of steps, so one step is worth
     * what it adds to the step below it -- which keeps any split summing back
     * to the ladder exactly. Steps are spent from the bottom up: the first
     * `spSteps` of them are the spell points, the rest are essence.
     */
    const poolSplit = (key, label, steps, spSteps) => {
      const each = Array.from({ length: steps }, (_, i) => boonStep(i + 1, level));
      const k = Math.max(0, Math.min(steps, Math.floor(Number(spSteps) || 0)));
      const sum = (xs) => xs.reduce((n, x) => n + x, 0);
      return {
        key,
        label,
        steps,
        spSteps: k,
        essenceSteps: steps - k,
        points: sum(each),
        sp: sum(each.slice(0, k)) * castingClassCount,
        essence: sum(each.slice(k)),
      };
    };

    // Carried over from the two-pool shape and its either/or choice.
    for (const [old, kept] of [['tierUse', 'tierSP'], ['boonUses', 'boonSP']]) {
      if (tr[old] === undefined) continue;
      if (tr[kept] === undefined) {
        tr[kept] = old === 'tierUse'
          ? (tr[old] === 'sp' ? m.spTier : 0)
          : tr[old].filter((u) => u !== 'essence').length;
      }
      delete tr[old];
    }
    if (tr.tierSP !== undefined) {
      if (tr.boonSP === undefined) tr.boonSP = tr.tierSP;
      delete tr.tierSP;
    }

    // What the player asked for is kept as they wrote it and clamped only on
    // the way in: buying off a drawback drops the count for a moment, and a
    // split written back then would be a nought outliving its reason.
    //
    // The default is the split the sheets were written with -- the boons past
    // the fifth as spell points, everything up to it as essence, which is
    // where each of these characters' Essence Boon came from.
    const want = tr.boonSP ?? Math.max(0, m.boons - 5);
    const boonSP = Math.max(0, Math.min(m.boons, Math.floor(Number(want) || 0)));

    m.traditionPools = m.boons ? [poolSplit('boons', `Boons ${m.boons}`, m.boons, boonSP)] : [];
    m.boonPoints = spBoonPoints(m.boons, level);
    m.traditionSP = m.traditionPools.reduce((n, p) => n + p.sp, 0);
    m.traditionEssence = m.traditionPools.reduce((n, p) => n + p.essence, 0);
    m.castingClassCount = castingClassCount;

    // A class's spell points are its levels so far plus its casting modifier:
    // the levels the character has now, not the ones planned (Wizard 1-5,
    // Fighter 6-10, Wizard 11-20 is 5 wizard levels at 10th), and nothing at
    // all for a class not taken yet. The same ability in both slots counts
    // once, as `statMod` reads a slot everywhere else.
    m.classSP = casters.map((x) => {
      const own = casts(x) ? x.classLevelsCurrent ?? 0 : 0;
      return { name: x.name, sp: own ? own + statMod(c, x.mod1, x.mod2) : 0 };
    });
    m.totalSP = m.classSP.reduce((s, x) => s + x.sp, 0)
      + (Number(m.bonusSP) || 0) + m.traditionSP;

    // Points condensed into temporary essence on the Akashic tab are spent
    // for the day: they are held against the pool here so what is left reads
    // as what can still be cast with. Asking for more than the pool holds is
    // flagged rather than clamped -- the number the player typed is kept and
    // both tabs say it does not add up.
    m.spOnEssence = tempEssenceCost(model.data.akashic);
    m.spShort = Math.max(0, m.spOnEssence - m.totalSP);
    m.availableSP = m.totalSP - m.spOnEssence;
  }
}

/**
 * What this side's talents are, sphere by sphere, for a rule that has to ask
 * whether a particular one is there: the names it can read, the choices it
 * knows were made without knowing which way, and how many are neither.
 *
 * The unnamed count is the tally less what is accounted for rather than a
 * count of its own, so it cannot drift from the number the rest of the sheet
 * is working with.
 */
export function sphereTalentKnowledge(model, side, sideKey) {
  const out = new Map();
  const of = (sphere) => {
    const s = canonicalSphere(sphere);
    if (!s) return null;
    if (!out.has(s)) out.set(s, { names: [], choices: [], unnamed: 0 });
    return out.get(s);
  };
  const put = (sphere, talent) => {
    const t = String(talent || '').trim();
    const row = t ? of(sphere) : null;
    if (row) row.names.push(t);
  };
  // The same rows the tally counts, and no others.
  for (const row of ownTalentRows(model, side, { sideKey })) put(row.sphere, row.talent);

  const tech = techniqueTalents(model);
  if (tech && tech.side === sideKey) {
    const row = of(tech.sphere);
    row.names.push(...tech.names);
    row.choices.push(...tech.choices);
  }

  for (const [sphere, row] of out) {
    // The named sources above are the character's own, so the count they are
    // measured against has to be too -- a customized weapon's talents are
    // neither named here nor countable as unnamed ones.
    const total = talentsIn(side?.tallyOwn || side?.tally, sphere);
    row.unnamed = Math.max(0, total - row.names.length - row.choices.length);
  }
  return out;
}

/**
 * Bonus skill ranks from sphere talents: 5 per talent in the associated
 * sphere, capped at level. Returns a map of skill index -> ranks.
 *
 * A row only pays out if what it asks for is on the character -- the sphere
 * for a "(Base)" row, the named package or talent for the rest. Where the
 * sheet cannot tell (a sphere whose talents are all unnamed, which is what
 * a Primordia technique's grants look like) the row falls back to the
 * player's own switch, which is what that column has always been.
 */
export function sphereRanksBySkill(model) {
  const map = new Map();
  const t = model.data.training?.combat;
  if (!t) return map;
  const level = Number(model.data.identity.level) || 0;
  // Her own talents, never a customized weapon's: "spheres and talents that
  // grant skill retraining never grant it when gained via a customized
  // weapon".
  const tally = t.tallyOwn || t.tally || {};
  // A technique may set some skill rows to full level outright -- its pack
  // entry says so (`fullLevelRanks`), matching the rows marked the same way.
  const fullLevel = !!altTrainingTechnique(model.data.altTraining?.technique)?.fullLevelRanks;
  const known = sphereTalentKnowledge(model, t, 'combat');
  const of = (sphere) => known.get(sphere) || { names: [], choices: [], unnamed: 0 };
  const check = {
    has: (sphere) => talentsIn(tally, sphere) > 0,
    named: (sphere) => of(sphere).names,
    choices: (sphere) => of(sphere).choices,
    unnamed: (sphere) => of(sphere).unnamed,
  };

  // Every row of the table, not only the ones a workbook wrote. A character
  // built here had no stored rows, so its sphere ranks never paid at all. A
  // row nobody has touched is on at ×1, which is how the workbook read a
  // blank cell; the rows are stored so the panel's switches have one to write.
  if (!Array.isArray(t.skillRanks)) t.skillRanks = [];
  for (const def of SPHERE_SKILL_RANKS) {
    if (!t.skillRanks.some((row) => row?.skill === def.key)) {
      t.skillRanks.push({ skill: def.key, enabled: true, multiplier: 1 });
    }
  }
  model.trainingSkillRanks = t.skillRanks.map((row) => {
    const def = SPHERE_SKILL_RANKS.find((d) => d.key === row.skill);
    if (!def) return { ...row, talents: 0, requirement: '', state: 'unmet', current: 0 };
    const state = sphereSkillRequirement(def, check);
    const talents = sphereSkillSpheres(def).reduce((n, s) => n + talentsIn(tally, s), 0);
    const on = row.enabled && state !== 'unmet';
    const ranks = !on ? 0
      : (def.fullLevelRanks && fullLevel) ? level
        : talents > 0
          ? Math.min(level, talents * RANKS_PER_TALENT * (Number(row.multiplier) || 1))
          : 0;
    return { ...row, talents, requirement: sphereSkillLabel(def), state, current: ranks };
  });

  for (const row of model.trainingSkillRanks) {
    const def = SPHERE_SKILL_RANKS.find((d) => d.key === row.skill);
    if (!def?.match) continue;
    const idx = model.data.skills.findIndex((s) => {
      if (s.name !== def.match.name) return false;
      if (def.match.spec === undefined) return true;
      if (def.match.spec === null) return !s.spec;
      return def.match.spec.test(String(s.spec || ''));
    });
    if (idx >= 0) map.set(idx, row.current);
  }
  return map;
}

/**
 * The spheres a side's CL / DC or BAB / DC table lists, in order.
 *
 * Every sphere the catalogue knows -- the engine's list and whatever the
 * packs add -- then any the document names that the catalogue does not: a
 * stored bonus row, or a talent taken in a sphere nobody has catalogued.
 * A character built here rather than imported has no stored rows at all,
 * and used to get an empty table for it; the table is the catalogue, and
 * the rows are only where a bonus was typed.
 *
 * The workbook's own header row rides along in an imported list under the
 * word "Sphere" and names nothing anybody trained in, so it is left out.
 */
export function sphereTableNames(model, sideKey) {
  const side = model.data.training?.[sideKey];
  if (!side) return [];
  const names = [];
  const have = new Set();
  const take = (name) => {
    const clean = String(name ?? '').trim();
    const key = clean.toLowerCase();
    if (!clean || have.has(key) || !sphereForwardKey(clean)) return;
    have.add(key);
    names.push(clean);
  };
  // A pack sphere whose page never said which kind it is would pass both
  // sides' filters; it is on a table only once a talent or a bonus puts it
  // there, so it does not sit on both by default.
  for (const s of sphereNames(sideKey === 'magic' ? MAGIC_SPHERES : COMBAT_SPHERES, sideKey)) {
    if (sphereSystem(s) === sideKey) take(s);
  }
  for (const r of side.sphereBonuses || []) take(r.sphere);
  for (const s of Object.keys(side.tally || {})) take(s);
  return names;
}

/**
 * Edit one bonus cell of a sphere table.
 *
 * The table lists every sphere; the document stores a row only for those
 * with something typed in them, so the first edit to a sphere writes the
 * row and later ones find it. Names match as typed -- a stored row is
 * looked up by the same name the table drew it under.
 */
export function setSphereBonus(model, sideKey, sphere, field, value) {
  const side = model.data.training?.[sideKey];
  const fields = sideKey === 'magic' ? ['clBonus', 'dcBonus'] : ['rankBonus', 'dcBonus'];
  const name = String(sphere ?? '').trim();
  if (!side || !fields.includes(field) || !name) return model;
  side.sphereBonuses ??= [];
  let row = side.sphereBonuses.find((r) => sameSphere(r.sphere, name));
  if (!row) {
    row = { sphere: name, [fields[0]]: 0, dcBonus: 0 };
    side.sphereBonuses.push(row);
  }
  row[field] = value;
  model.recompute();
  emit(model, { type: 'set-sphere-bonus', side: sideKey, sphere: name, field, value });
  return model;
}

/**
 * Per-sphere attack/DC rows, one for every sphere on the table -- see
 * sphereTableNames. Runs after skills because two spheres (Alchemy,
 * Beastmastery) key off skill ranks instead of BAB.
 */
export function recomputeSphereRows(model) {
  const t = model.data.training;
  if (!t) return;
  const c = model.data;
  const level = Number(c.identity.level) || 0;
  const bab = Number(c.attack.bab) || 0;
  // The stored row for a sphere, or the blank one the table shows for it.
  const rowsOf = (sideKey, blank) => {
    const stored = t[sideKey].sphereBonuses || [];
    // The table's spelling, whatever the stored row was typed as.
    return sphereTableNames(model, sideKey).map((sphere) => {
      const row = stored.find((r) => sameSphere(r.sphere, sphere));
      return row ? { ...row, sphere } : { sphere, ...blank };
    });
  };
  const ranksOf = (name, specRe) => {
    const s = c.skills.find((x) => x.name === name
      && (specRe ? specRe.test(String(x.spec || '')) : true));
    return Number(s?.totalRanks) || 0;
  };
  // A bonus column may hold a rule rather than a number -- "+1 CL per four
  // levels" is one, and typed as the number it comes to today it goes stale.
  // The scope is the one every formula reads, built once and only if a row
  // asks for it. This runs after the prose, so a name defined there resolves.
  let scope = null;
  const amount = (raw) => {
    if (typeof raw === 'string' && raw.trim() !== '') scope ??= model.scope();
    return evaluateAmount(raw, scope);
  };

  if (t.combat) {
    const dcBase = t.combat.practitionerDC;
    const bestMod = dcBase - 10 - Math.floor(bab / 2);
    t.combat.sphereRows = rowsOf('combat', { rankBonus: 0, dcBonus: 0 }).map((row) => {
      let attackBase = bab;
      let dc = dcBase;
      if (row.sphere === 'Alchemy') {
        const r = ranksOf('Craft', /alchem/i);
        attackBase = r;
        dc = 10 + Math.floor(r / 2) + bestMod;
      } else if (row.sphere === 'Beastmastery') {
        const r = Math.max(ranksOf('Handle Animal'), ranksOf('Ride'));
        attackBase = r;
        dc = 10 + Math.floor(ranksOf('Handle Animal') / 2) + bestMod;
      }
      const rank = amount(row.rankBonus);
      const dcPlus = amount(row.dcBonus);
      // A bonus forwarded here from elsewhere on the sheet is kept beside
      // the one typed in, never folded into it -- the column has to go on
      // saying what was written in it -- and shows in gold beside the field.
      const key = sphereForwardKey(row.sphere);
      const babForwarded = key ? forwarded(model, `${key}.bab`) : 0;
      const dcForwarded = key ? forwarded(model, `${key}.dc`) : 0;
      return {
        ...row,
        talents: talentsIn(t.combat.tally, row.sphere),
        rankBonusNum: rank.value,
        rankBonusError: rank.error,
        dcBonusNum: dcPlus.value,
        dcBonusError: dcPlus.error,
        babForwarded,
        dcForwarded,
        attack: Math.min(Math.floor(attackBase + rank.value + babForwarded), level),
        dc: dc + dcPlus.value + dcForwarded,
      };
    });
  }
  if (t.magic) {
    t.magic.sphereRows = rowsOf('magic', { clBonus: 0, dcBonus: 0 }).map((row) => {
      const cl = amount(row.clBonus);
      const dcPlus = amount(row.dcBonus);
      const key = sphereForwardKey(row.sphere);
      const clForwarded = key ? forwarded(model, `${key}.cl`) : 0;
      const dcForwarded = key ? forwarded(model, `${key}.dc`) : 0;
      // A sphere's own CL bonus waits with the global one until casting is
      // unlocked (see recomputeTraining).
      const unlocked = t.magic.castingUnlocked !== false;
      const clPlus = unlocked ? cl.value + clForwarded : 0;
      return {
        ...row,
        talents: talentsIn(t.magic.tally, row.sphere),
        clBonusNum: cl.value,
        clBonusError: cl.error,
        dcBonusNum: dcPlus.value,
        dcBonusError: dcPlus.error,
        clForwarded,
        dcForwarded,
        clWaiting: unlocked ? 0 : cl.value + clForwarded,
        cl: t.magic.globalCL + clPlus,
        // A sphere's DC follows its caster level, so a CL bonus -- typed or
        // forwarded -- is worth half of itself here as well, as the global
        // one is.
        dc: t.magic.globalDC + Math.floor(clPlus / 2) + dcPlus.value + dcForwarded,
      };
    });
  }
}
