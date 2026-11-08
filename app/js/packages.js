/**
 * packages.js -- archetype packages: a class gives up one of its own packages
 * and takes another in its place.
 *
 * A package is a named set of a class's features (`package` blocks, read in
 * package-text.js). The swap is an archetype built on the spot: it replaces
 * what the given-up package holds, and brings the taken package's features
 * at the levels their own class gains them, with their text from that
 * class's block. So the pill on the class row, its × and the clash with an
 * archetype that touches the same features all come from the archetype code
 * (extensions.js); the swap's own record rides on the archetype entry as
 * `package`.
 *
 * A taken package that grants spellcasting also gets a casting class on
 * Vancian Magic, named "Fighter (Songweaver)": its caster level counts the
 * Fighter's levels (blockClassName) against the slot table of the package's
 * class. Other powers are left to the player and said so.
 *
 * The whole thing is a campaign rule (`archetypePackages`, off by default).
 */
import { campaignRules } from './model/campaign.js';
import { asOneUndo } from './model/undo.js';
import { blankCastingClass } from './model/subsystems/vancian.js';
import {
  applyArchetype, archetypeStatus, normalizeBlock, ordinal, swapAt, swapBase, swapKey, swapLabel, swapLevel, swapReach,
} from './extensions.js';
import { PACKAGE_POWERS } from './package-text.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));
const lower = (s) => str(s).trim().toLowerCase();
const plain = (s) => lower(str(s).replace(/\s*\([^)]*\)\s*/g, ' '));

/** Does a package's (or class block's) class name this class? "Shifter(Paizo)" names a Shifter. */
export function sameClass(a, b) {
  if (!lower(a) || !lower(b)) return false;
  return lower(a) === lower(b) || plain(a) === plain(b);
}

/** How a package is told apart: its class and its name. */
export const packageId = (p) => `${lower(p?.class)}|${lower(p?.name)}`;

/** The package blocks among `blocks`, one per class and name; a later pack's wins. */
export function packageBlocks(blocks) {
  const byId = new Map();
  for (const b of blocks || []) {
    if (b?.kind !== 'package' || !str(b.name).trim()) continue;
    byId.set(packageId(b), b);
  }
  return [...byId.values()];
}

/** A class's own packages. */
export const ownPackages = (all, className) => all.filter((p) => sameClass(p.class, className));

/** The package swaps on a class row. */
export const swapsOn = (row) => (Array.isArray(row?.archetypeStack) ? row.archetypeStack.filter((e) => e?.package) : []);

/**
 * The features a package brings: its own (a package no class holds), or the
 * features of its class it names, found on that class's block in `blocks`.
 * A single grant ("bonus feats@6") arrives at that level.
 */
export function packageFeatures(pkg, blocks) {
  if (pkg.features?.length) return { features: pkg.features.map((f) => ({ ...f })), missing: [], noClass: false };
  const cls = (blocks || []).find((b) => b?.kind === 'class' && sameClass(b.name, pkg.class));
  const features = [];
  const missing = [];
  for (const inc of pkg.includes || []) {
    const key = swapKey(swapBase(inc), pkg.class);
    const at = swapLevel(inc);
    const hits = (cls?.features || []).filter((f) => swapKey(f.name, pkg.class) === key);
    if (!hits.length) {
      if (!missing.includes(swapBase(inc))) missing.push(swapBase(inc));
      continue;
    }
    for (const f of at ? [hits[0]] : hits) {
      const level = at ?? f.level;
      if (features.some((x) => lower(x.name) === lower(f.name) && x.level === level)) continue;
      features.push({ name: f.name, type: f.type || '', level, text: f.text || '' });
    }
  }
  return { features, missing, noClass: !cls && !!(pkg.includes || []).length };
}

/** The swap keys of what a given-up package holds, one per item it includes. */
const givenKeys = (g, className) => g.includes.map((s) => swapAt(swapKey(swapBase(s), g.class || className), swapLevel(s)));

/** "Bonus feats" from a package's own spelling, "bonus feats@6". */
const spelled = (s) => {
  const t = swapBase(s).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * A package's items as a person reads them, one per feature: "Bravery",
 * "Bonus feats at 6th, 12th and 18th". For what the ladder lacks.
 */
function spelledItems(items) {
  const out = new Map();
  for (const s of items) {
    const name = spelled(s);
    const k = lower(name);
    if (!out.has(k)) out.set(k, { name, levels: [] });
    if (swapLevel(s)) out.get(k).levels.push(swapLevel(s));
  }
  return [...out.values()].map(({ name, levels }) => {
    if (!levels.length) return name;
    const at = [...new Set(levels)].sort((a, b) => a - b).map(ordinal);
    return `${name} at ${at.length > 1 ? `${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}` : at[0]}`;
  });
}

/** `{name, levels}` items as one per name, with every level it comes at. */
export function groupLevels(items) {
  const out = new Map();
  for (const { name, levels } of items) {
    const k = lower(name);
    if (!out.has(k)) out.set(k, { name, levels: [] });
    out.get(k).levels.push(...levels);
  }
  return [...out.values()].map((x) => ({ ...x, levels: [...new Set(x.levels)].sort((a, b) => a - b) }));
}

/**
 * What a swap would do on a class, before it is made: what leaves the ladder
 * (`removes`, each with the Planner levels it sits at), what the given-up
 * package names that the ladder does not have (`absent`), what the taken
 * package adds (`adds`, at its own class's levels), what its class's block
 * lacks (`missing`, or `noClass`) and the powers it grants.
 */
export function packageCheck(model, { className, gives, takes, blocks = [] }) {
  const g = gives ? normalizeBlock(gives) : null;
  const t = takes ? normalizeBlock(takes) : null;
  const out = { removes: [], absent: [], adds: [], missing: [], noClass: false, grants: [] };
  if (g?.kind === 'package') {
    const reach = swapReach(model, className, givenKeys(g, className));
    out.removes = groupLevels(reach.filter((r) => r.found).map((r) => ({ name: r.name, levels: r.levels })));
    out.absent = spelledItems(g.includes.filter((_, i) => !reach[i].found));
  }
  if (t?.kind === 'package') {
    const { features, missing, noClass } = packageFeatures(t, blocks);
    out.adds = groupLevels(features.map((f) => ({ name: f.name, levels: [f.level] })));
    out.missing = missing.map(spelled);
    out.noClass = noClass;
    out.grants = [...t.grants];
  }
  return out;
}

/**
 * Give up `gives` (one of the class's own packages) for `takes` on the class
 * row named `className`. Returns a line saying what happened, for the sheet
 * to show; nothing changes when it cannot be done.
 */
export function swapPackage(model, { className, gives, takes, blocks = [] }) {
  const d = model.data;
  if (!campaignRules(d).archetypePackages) return 'Archetype packages are off in Campaign rules.';
  const g = normalizeBlock(gives);
  const t = normalizeBlock(takes);
  if (g?.kind !== 'package' || t?.kind !== 'package') return 'Pick a package to give up and a package to take.';
  const row = (d.classes || []).find((c) => lower(c?.name) === lower(className));
  if (!row) return `${className} is not on the Classes table.`;
  if (!sameClass(g.class, row.name)) return `${g.name} is not one of ${row.name}'s packages.`;
  if (packageId(g) === packageId(t)) return `${row.name} already has ${t.name}.`;
  if (swapsOn(row).some((e) => lower(e.package.gives) === lower(g.name))) return `${row.name} has already given up ${g.name}.`;

  const keys = givenKeys(g, row.name);
  const replaces = keys.filter(Boolean);
  const { features, missing, noClass } = packageFeatures(t, blocks);
  const record = {
    gives: g.name, givesClass: g.class, givesGrants: [...g.grants],
    takes: t.name, takesClass: t.class, grants: [...t.grants],
  };
  const block = {
    kind: 'archetype', name: t.name, class: row.name, package: record,
    features: [
      // The swap itself, as a note under the class: both packages' rules text.
      {
        name: `${t.name} package`, level: 1, replaces,
        text: [`${row.name} gives up ${g.name} for ${t.name}${t.class ? ` (${t.class})` : ''}.`,
          g.text && `${g.name}: ${g.text}`, t.text && `${t.name}: ${t.text}`].filter(Boolean).join('\n\n'),
      },
      ...features,
    ],
  };
  const status = archetypeStatus(model, block);
  if (!status.ok) return applyArchetype(model, block);      // says why, changes nothing
  return asOneUndo(model, `Swapped ${g.name} for ${t.name} on ${row.name}`, () => finishSwap(model, { row, g, t, block, keys, missing, noClass }));
}

/** swapPackage once the swap is known to fit: the archetype, then its casting class and what is left to do. */
function finishSwap(model, { row, g, t, block, keys, missing, noClass }) {
  const d = model.data;
  const said = [applyArchetype(model, block)];
  const entry = swapsOn(row).find((e) => lower(e.name) === lower(t.name));
  // What the given-up package names that the ladder did not have, as the
  // package spells it: the archetype's own record has only the match keys.
  const absent = spelledItems(g.includes.filter((_, i) => keys[i] && (entry?.notFound || []).includes(swapLabel(keys[i]))));
  if (entry && absent.length) entry.package.absent = absent;

  if (t.grants.includes('spellcasting') && entry) {
    const name = `${row.name} (${t.name})`;
    if (!(d.vancian?.classes || []).some((c) => lower(c?.name) === lower(name))) {
      entry.package.casting = name;
      model.listAdd('vancian.classes', blankCastingClass(name, t.class));
      // The class now uses Vancian magic, and its tab is where the casting
      // class is filled in. Only what this did is undone with it.
      if (!(row.systems || []).includes('vancian')) {
        model.toggleClassSystem(d.classes.indexOf(row), 'vancian');
        entry.package.taggedVancian = true;
      }
      if (!model.tabOrder().includes('vancian')) {
        model.showTab('vancian');
        entry.package.shownTab = true;
      }
      said.push(`Added the casting class ${name} on Vancian Magic.`);
    }
  }
  for (const power of t.grants.filter((p) => p !== 'spellcasting' && p !== 'combat training')) {
    said.push(`Set up the ${power} from ${t.name} by hand.`);
  }
  if (g.grants.includes('spellcasting')
    && (d.vancian?.classes || []).some((c) => lower(c?.levelClass) === lower(row.name) && lower(c?.name) !== lower(entry?.package?.casting))) {
    said.push(`${row.name} still has a casting class on Vancian Magic. Remove it there.`);
  }
  if (noClass) said.push(`No ${t.class} class is in the enabled packs, so ${t.name}'s features were not added.`);
  else if (missing.length) said.push(`Not found on the ${t.class} class: ${missing.join(', ')}.`);
  return said.join(' ');
}

/**
 * What breaks the two limits on packages:
 *   - a class holds one package at most that grants each power
 *     (spellcasting, manifesting, spherecasting, initiating, combat training),
 *     counting casting the class has outside any package;
 *   - a character holds each package once, across all its classes.
 * Returns `[{ class, text }]`, empty when nothing does.
 */
export function packageProblems(model, blocks) {
  const d = model.data;
  const all = packageBlocks(blocks);
  const out = [];
  const holders = new Map();
  for (const row of (d.classes || []).filter((r) => str(r?.name).trim())) {
    const swaps = swapsOn(row);
    const given = new Set(swaps.map((e) => lower(e.package.gives)));
    const kept = ownPackages(all, row.name).filter((p) => !given.has(lower(p.name)));
    const taken = swaps.map((e) => ({ name: e.package.takes, class: e.package.takesClass, grants: e.package.grants || [] }));
    const held = [...kept, ...taken];
    for (const p of held) {
      const id = packageId(p);
      if (!holders.has(id)) holders.set(id, { name: p.name, classes: [] });
      holders.get(id).classes.push(row.name);
    }
    for (const power of PACKAGE_POWERS) {
      const from = held.filter((p) => (p.grants || []).includes(power)).map((p) => p.name);
      if (from.length > 1) out.push({ class: row.name, text: `${row.name} has ${power} from ${from.join(' and ')}. A class can hold only one package that grants ${power}.` });
    }
    // Spellcasting outside any package (a wizard's), against a package that grants it.
    const takesCasting = taken.find((p) => p.grants.includes('spellcasting'));
    const casts = (d.vancian?.classes || []).some((c) => lower(c?.levelClass) === lower(row.name)
      && !swaps.some((e) => lower(e.package.casting) === lower(c?.name)));
    if (takesCasting && casts && !kept.some((p) => p.grants.includes('spellcasting'))) {
      out.push({ class: row.name, text: `${row.name} already casts spells, and ${takesCasting.name} grants spellcasting.` });
    }
  }
  for (const { name, classes } of holders.values()) {
    if (classes.length > 1) out.push({ class: classes[0], text: `${name} is on ${classes.join(' and ')}. A character can hold each package only once.` });
  }
  return out;
}
