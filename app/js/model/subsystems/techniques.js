/**
 * Custom techniques: the sphere-built abilities a character designs.
 *
 * A technique is a small character sheet of its own -- spheres, talents,
 * saves, descriptions -- with a status that tracks it from design to
 * approved, and an export that renders it for the GM.
 */

import {
  altTrainingGrantsAt, altTrainingLevels, altTrainingTechnique, grantCount,
} from './alt-training.js';
import { sheetReader } from '../document.js';
import { emit } from '../events.js';
import { positionedRows } from '../templates.js';
import { cleanText, pad } from '../util.js';

/** How many of each slot the layout carries: five spheres, eight talent pairs, three saves, four description lines. */
export const TECHNIQUE_SLOTS = { spheres: 5, talents: 8, saves: 3, descriptions: 4 };

/** The statuses the workbook uses on `techRef`, for the Technique List's picker. */
export const TECHNIQUE_STATUSES = ['Known', 'Design Phase', 'Approved', 'Pending', 'Rejected'];

const isFeatWord = (v) => cleanText(v).toLowerCase() === 'feat';

/** A technique with every slot present and empty. */
export function emptyTechnique() {
  return {
    name: '', prepend1: '', prepend2: '',
    combatSpheres: pad([], TECHNIQUE_SLOTS.spheres, ''),
    combatTalents: pad([], TECHNIQUE_SLOTS.talents, () => ({ sphere: '', talent: '' })),
    magicSpheres: pad([], TECHNIQUE_SLOTS.spheres, ''),
    magicTalents: pad([], TECHNIQUE_SLOTS.talents, () => ({ sphere: '', talent: '' })),
    others: pad([], TECHNIQUE_SLOTS.spheres, ''),
    otherFeatures: pad([], TECHNIQUE_SLOTS.talents, () => ({ sphere: '', talent: '' })),
    craftingSkill: '', range: '', duration: '', target: '',
    saves: pad([], TECHNIQUE_SLOTS.saves, () => ({ save: '', type: '' })),
    spellResistance: '',
    descriptions: pad([], TECHNIQUE_SLOTS.descriptions, ''),
    extraSp: '', otherCost: '', subschool: '', status: '',
    // The AutoTechnique tab's crafting choices. Zero on a technique read off techRef.
    instantInitiation: false, versatile: 0, signature: false,
  };
}

/** Every slot present, every string trimmed, whatever shape a saved technique arrived in. */
export function normalizeTechnique(t) {
  const e = emptyTechnique();
  const src = t && typeof t === 'object' ? t : {};
  const pair = (p) => ({ sphere: cleanText(p?.sphere), talent: cleanText(p?.talent) });
  const savePair = (p) => ({ save: cleanText(p?.save), type: cleanText(p?.type) });
  return {
    ...e,
    name: cleanText(src.name), prepend1: cleanText(src.prepend1), prepend2: cleanText(src.prepend2),
    combatSpheres: pad(src.combatSpheres, TECHNIQUE_SLOTS.spheres, '').map(cleanText),
    combatTalents: pad(src.combatTalents, TECHNIQUE_SLOTS.talents, () => ({})).map(pair),
    magicSpheres: pad(src.magicSpheres, TECHNIQUE_SLOTS.spheres, '').map(cleanText),
    magicTalents: pad(src.magicTalents, TECHNIQUE_SLOTS.talents, () => ({})).map(pair),
    others: pad(src.others, TECHNIQUE_SLOTS.spheres, '').map(cleanText),
    otherFeatures: pad(src.otherFeatures, TECHNIQUE_SLOTS.talents, () => ({})).map(pair),
    craftingSkill: cleanText(src.craftingSkill), range: cleanText(src.range),
    duration: cleanText(src.duration), target: cleanText(src.target),
    saves: pad(src.saves, TECHNIQUE_SLOTS.saves, () => ({})).map(savePair),
    spellResistance: cleanText(src.spellResistance),
    descriptions: pad(src.descriptions, TECHNIQUE_SLOTS.descriptions, '').map(cleanText),
    extraSp: src.extraSp === '' || src.extraSp === null || src.extraSp === undefined ? '' : (Number(src.extraSp) || 0),
    otherCost: cleanText(src.otherCost), subschool: cleanText(src.subschool), status: cleanText(src.status),
    instantInitiation: !!src.instantInitiation && src.instantInitiation !== '0',
    versatile: Number(src.versatile) || 0,
    signature: !!src.signature && src.signature !== '0',
  };
}

/** "Nakano Style Counter - Wheelbreaker": what the workbook prints as the technique's full name. */
export function techniqueTitle(t) {
  const head = [t.prepend1, t.prepend2].filter(Boolean).join(' ');
  return head && t.name ? `${head} - ${t.name}` : head || t.name;
}

/**
 * Read `techRef`: one technique per column from C on, one field per row, the
 * field named in column A. Rows are found by that label, so a workbook whose
 * catalogue gained a row still reads. The status row is the one below
 * "Subschool" -- it carries no label of its own.
 */
function importTechniqueCatalogue(tab) {
  if (!tab) return [];
  const rows = positionedRows(tab);
  const byLabel = new Map();
  rows.forEach((row, ri) => {
    const label = cleanText(row.cells[0]);
    if (label && !byLabel.has(label)) byLabel.set(label, ri);
  });
  const rowOf = (label) => byLabel.get(label);
  const cell = (label, ci) => cleanText(rows[rowOf(label)]?.cells[ci]);
  const nameRow = rowOf('Technique Name');
  if (nameRow === undefined) return [];
  const statusRow = rowOf('Subschool') !== undefined ? rowOf('Subschool') + 1 : undefined;
  const width = Math.max(0, ...rows.map((r) => r.cells.length));

  const out = [];
  const seen = new Map();
  for (let ci = 2; ci < width; ci++) {
    let name = cleanText(rows[nameRow].cells[ci]);
    if (!name) continue;
    // Placeholder columns share a name ("???" nine times over); each keeps its
    // own entry, told apart by a suffix, rather than the later ones vanishing
    // behind the first when the list is looked up by name.
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    if (n > 1) name = `${name} (${n})`;
    const t = emptyTechnique();
    t.name = name;
    t.prepend1 = cell('Technique Prepend 1', ci);
    t.prepend2 = cell('Technique Prepend 2', ci);
    for (let i = 0; i < TECHNIQUE_SLOTS.spheres; i++) {
      t.combatSpheres[i] = cell(`Combat Sphere ${i + 1}`, ci);
      t.magicSpheres[i] = cell(`Magic Sphere ${i + 1}`, ci);
      t.others[i] = cell(`Other ${i + 1}`, ci);
    }
    // Talent rows come in pairs: the odd one names the sphere, the even one the talent.
    for (let i = 0; i < TECHNIQUE_SLOTS.talents; i++) {
      t.combatTalents[i] = { sphere: cell(`Combat Talents ${2 * i + 1}`, ci), talent: cell(`Combat Talents ${2 * i + 2}`, ci) };
      t.magicTalents[i] = { sphere: cell(`Magic Talents ${2 * i + 1}`, ci), talent: cell(`Magic Talents ${2 * i + 2}`, ci) };
      t.otherFeatures[i] = { sphere: cell(`Other Features ${2 * i + 1}`, ci), talent: cell(`Other Features ${2 * i + 2}`, ci) };
    }
    t.craftingSkill = cell('Crafting Skill', ci);
    t.range = cell('Range', ci);
    t.duration = cell('Duration', ci);
    t.target = cell('Target', ci);
    for (let i = 0; i < TECHNIQUE_SLOTS.saves; i++) {
      t.saves[i] = { save: cell(`Saving Throw ${i + 1}`, ci), type: cell(`ST Type ${i + 1}`, ci) };
    }
    t.spellResistance = cell('Spell Resistance', ci);
    for (let i = 0; i < TECHNIQUE_SLOTS.descriptions; i++) t.descriptions[i] = cell(`Description ${i + 1}`, ci);
    const sp = cell('Extra SP', ci);
    t.extraSp = sp === '' ? '' : (Number(sp) || 0);
    t.otherCost = cell('Other Cost', ci);
    t.subschool = cell('Subschool', ci);
    t.status = statusRow === undefined ? '' : cleanText(rows[statusRow]?.cells[ci]);
    out.push(normalizeTechnique(t));
  }
  return out;
}

/**
 * Read a Technique List or AutoTechnique grid -- the same layout: labels down
 * column B, the technique's parts beside them, the talents to the right under
 * their sphere. Label-anchored, so a saved document that kept the grid without
 * its row numbers reads the same as a fresh conversion.
 */
function importTechniqueSheet(tab) {
  if (!tab) return null;
  const g = sheetReader(tab);
  const { rows, at, text, find } = g;
  const t = emptyTechnique();
  const rowAt = (label) => find(label)?.[0];
  const cellsAt = (label) => (rowAt(label) === undefined ? [] : rows[rowAt(label)]);
  const rightOfLabel = (label, cells) => {
    const i = cells.findIndex((v) => text(v) === label);
    return i < 0 ? '' : text(cells[i + 1]);
  };

  const nameRow = cellsAt('Technique Name');
  if (!nameRow.length) return null;
  t.prepend1 = text(nameRow[2]);
  // AutoTechnique allows a third prepend in E; fold it into the second.
  t.prepend2 = [text(nameRow[3]), text(nameRow[4])].filter(Boolean).join(' ');
  t.name = text(nameRow[5]);
  t.status = rightOfLabel('Approval Status', nameRow);
  t.subschool = rightOfLabel('Type', nameRow);

  const block = (sphereLabel, talentLabel, spheres, talents) => {
    const ri = rowAt(sphereLabel);
    if (ri === undefined) return;
    for (let i = 0; i < TECHNIQUE_SLOTS.spheres; i++) spheres[i] = text(at(ri, 2 + i));
    // Talent spheres sit on the sphere row from J (index 9); their talents on
    // the row below, headed by `talentLabel` at I.
    const tri = rows[ri + 1] && text(at(ri + 1, 8)) === talentLabel ? ri + 1 : rowAt(talentLabel);
    for (let i = 0; i < TECHNIQUE_SLOTS.talents; i++) {
      talents[i] = { sphere: text(at(ri, 9 + i)), talent: tri === undefined ? '' : text(at(tri, 9 + i)) };
    }
  };
  block('Combat Spheres', 'Combat Talents', t.combatSpheres, t.combatTalents);
  block('Magic Spheres', 'Magic Talents', t.magicSpheres, t.magicTalents);
  block('Other', 'Other Features', t.others, t.otherFeatures);

  const valueBeside = (label) => rightOfLabel(label, cellsAt(label));
  t.craftingSkill = valueBeside('Crafting Skill');
  t.range = valueBeside('Range');
  t.duration = valueBeside('Duration');
  t.target = valueBeside('Target');
  t.spellResistance = valueBeside('Spell Resistance');
  const saveRow = cellsAt('Saving Throw');
  const typeRow = cellsAt('Saving Throw Type');
  for (let i = 0; i < TECHNIQUE_SLOTS.saves; i++) t.saves[i] = { save: text(saveRow[2 + i]), type: text(typeRow[2 + i]) };
  for (let i = 0; i < TECHNIQUE_SLOTS.descriptions; i++) t.descriptions[i] = text(cellsAt(`Description ${i + 1}`)[2]);
  const sp = valueBeside('Other SP Cost');
  t.extraSp = sp === '' ? '' : (Number(sp) || 0);
  t.otherCost = valueBeside('Other Cost');
  // AutoTechnique's crafting choices; absent on the Technique List.
  const flag = (label) => { const v = valueBeside(label); return v !== '' && v !== '0' && v.toLowerCase() !== 'false'; };
  t.instantInitiation = flag('Instant Initiation');
  t.versatile = Number(valueBeside('Verstatile Technique') || valueBeside('Versatile Technique')) || 0;
  t.signature = flag('Signature Technique');
  return normalizeTechnique(t);
}

/**
 * The techniques block from the workbook's three grids. Absent grids read as
 * empty; a Technique List whose technique is not in the catalogue (the
 * catalogue was not captured, or the name was retyped) is added to it, so the
 * list opens on what the workbook showed.
 */
export function importTechniques(refTab, listTab, autoTab) {
  const catalogue = importTechniqueCatalogue(refTab);
  const shown = importTechniqueSheet(listTab);
  const draft = importTechniqueSheet(autoTab) || emptyTechnique();
  let selected = '';
  if (shown?.name) {
    selected = shown.name;
    if (!catalogue.some((t) => t.name === shown.name)) catalogue.push(shown);
  }
  return { catalogue, selected, draft: normalizeTechnique(draft) };
}

/** Every technique with a name, and the draft, in a saveable shape. */
export function normalizeTechniques(block) {
  const src = block && typeof block === 'object' ? block : {};
  const catalogue = (Array.isArray(src.catalogue) ? src.catalogue : []).map(normalizeTechnique).filter((t) => t.name);
  const selected = catalogue.some((t) => t.name === src.selected) ? src.selected : (catalogue[0]?.name ?? '');
  return { catalogue, selected, draft: normalizeTechnique(src.draft) };
}

/** Distinct non-empty values, the way COUNTUNIQUE counts them (case-sensitive, trimmed). */
const uniqueCount = (values) => new Set(values.map(cleanText).filter(Boolean)).size;

/**
 * The numbers each tab derives from a technique, as its own formulas do.
 *
 *   base talents   distinct spheres and "other" entries, less any "Feat" among the others
 *   complexity     base, +(distinct - 2) once there are more than two, + every talent named
 *   crafting time  1 + complexity; effective time knocks a third off (rounded down)
 *   craft DC       5 + 5 x complexity;  decipher DC 20 + complexity;  learn DC 10 + 2 x complexity
 *   prowess        "Yes (Martial Focus …)" when the technique uses no magic sphere at all
 *   effective      list: with prowess, complexity - 1 - floor(BAB / 5) - Adept Initiator (floor 0),
 *                        else complexity - Adept Initiator
 *                  auto: complexity + Instant Initiation + Versatile - Signature - Adept Initiator (floor 0)
 *   total SP       effective + the technique's own extra SP
 *
 * `mode` is 'list' or 'auto' -- the two tabs' effective-complexity rules.
 */
export function techniqueStats(t, { bab = 0, adeptInitiator = 0 } = {}, mode = 'list') {
  const distinct = uniqueCount([...t.combatSpheres, ...t.magicSpheres, ...t.others]);
  const feats = t.others.filter(isFeatWord).length;
  const talentNames = [...t.combatTalents, ...t.magicTalents, ...t.otherFeatures].map((p) => p.talent);
  const talents = talentNames.filter((v) => cleanText(v)).length;
  const base = distinct - feats;
  const complexity = Math.max(0, base + (base > 2 ? distinct - 2 : 0) + talents);
  const suffix = base > 2 ? ` (+${distinct - 2 - feats})` : '';
  const baseText = `${base}${suffix}`;
  const totalText = `${uniqueCount(talentNames) + base}${suffix}`;

  const craftingTime = 1 + complexity;
  const effectiveTime = craftingTime - Math.floor(craftingTime / 3);
  const craftDC = 5 + 5 * complexity;
  const decipherDC = 20 + complexity;
  const learnDC = 10 + 2 * complexity;

  const prowess = t.magicSpheres.every((s) => !cleanText(s));
  const discount = 1 + Math.floor(bab / 5) + adeptInitiator;
  const prowessExtra = Math.max(complexity - discount, 0);
  const prowessText = prowess
    ? `Yes (Martial Focus${prowessExtra ? ` +${prowessExtra} SP` : ''})`
    : 'No';

  const effective = mode === 'auto'
    ? Math.max(0, complexity + (t.instantInitiation ? 1 : 0) + (Number(t.versatile) || 0)
      - (t.signature ? 1 : 0) - (adeptInitiator ? 1 : 0))
    : prowess ? Math.max(complexity - discount, 0) : complexity - adeptInitiator;
  const extraSp = Number(t.extraSp) || 0;

  return {
    distinct, feats, talents, base, baseText, totalText, complexity,
    craftingTime, effectiveTime, craftDC, decipherDC, learnDC,
    prowess, prowessText, prowessExtra, effective, extraSp, totalSp: effective + extraSp,
  };
}

/** "Open Hand Sphere (Mystic Fists, Godhand)" for each sphere the technique names, in order. */
export function techniquePrerequisites(t) {
  const lines = [];
  const group = (spheres, talents, suffix) => {
    for (const s of spheres) {
      const name = cleanText(s);
      if (!name || lines.some((l) => l.key === name)) continue;
      const own = talents.filter((p) => cleanText(p.sphere) === name && cleanText(p.talent)).map((p) => cleanText(p.talent));
      lines.push({ key: name, text: `${name}${suffix}${own.length ? ` (${own.join(', ')})` : ''}` });
    }
  };
  group(t.combatSpheres, t.combatTalents, ' Sphere');
  group(t.magicSpheres, t.magicTalents, ' Sphere');
  group(t.others, t.otherFeatures, '');
  return lines.map((l) => l.text);
}

/**
 * The Discord application the workbook builds under both tabs -- character
 * name, what is being applied for, and the technique in a code block. Same
 * text from either tab; the numbers are the tab's own (`mode`).
 */
export function techniqueExport(t, stats, { characterName = '' } = {}) {
  const title = techniqueTitle(t);
  const list = (spheres, talents, suffix) => {
    const parts = [];
    for (const s of spheres) {
      const name = cleanText(s);
      if (!name || parts.some((p) => p.startsWith(name))) continue;
      const own = talents.filter((p) => cleanText(p.sphere) === name && cleanText(p.talent)).map((p) => cleanText(p.talent));
      parts.push(`${name}${suffix}${own.length ? ` (${own.join(', ')})` : ''}`);
    }
    return parts.length ? parts.join('; ') : 'N/A';
  };
  const saves = t.saves.filter((p) => cleanText(p.save))
    .map((p) => `${cleanText(p.save)}${cleanText(p.type) ? ` ${cleanText(p.type)}` : ''}`);
  const skill = cleanText(t.craftingSkill);
  const cost = [`SP cost ${stats.complexity} (minimum 1)`];
  if (stats.extraSp) cost.push(`+${stats.extraSp} SP`);
  // A 0 typed in the Other Cost box is no cost, not a cost of nought.
  if (cleanText(t.otherCost) && cleanText(t.otherCost) !== '0') cost.push(cleanText(t.otherCost));
  const desc = t.descriptions.map(cleanText).filter(Boolean).join('\n');
  return [
    `**Character Name:** ${characterName}`,
    `**What Are you Applying for:** the **${title}** technique`,
    '```' + title + ' ',
    `- Combat Spheres: ${list(t.combatSpheres, t.combatTalents, '')}`,
    `- Magic Spheres: ${list(t.magicSpheres, t.magicTalents, '')}`,
    `- Other: ${list(t.others, t.otherFeatures, '')}`,
    `- Complexity: ${stats.complexity} (${stats.baseText} base talents, ${stats.totalText} talents total); ${cost.join(', ')}`,
    `- Crafting Time: ${stats.craftingTime} days; Craft DC ${stats.craftDC} ${skill}; Learn DC ${stats.learnDC} ${skill}, ${stats.complexity} hours; Decipher DC ${stats.decipherDC} ${skill}`,
    `- Range: ${cleanText(t.range)}`,
    `- Target: ${cleanText(t.target)}`,
    `- Duration: ${cleanText(t.duration)}`,
    `- Saving Throw: ${saves.length ? saves.join(', ') : 'none'}; Spell Resistance ${cleanText(t.spellResistance)}`,
    `- Prerequisites: ${techniquePrerequisites(t).join(', ')} `,
    `- Description: ${desc}` + '```',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Auto-Cooking: the Iron Chef dish maker.
 *
 * An iron chef's meal is two entrees, three flavors, two side dishes, an aroma
 * and a garnish; each ingredient grants the diners an effect whose numbers
 * scale with the chef's level, and some strengthen each other (a Red Meat
 * entree adds to the Strength a side of Apples grants; Rice makes the recipe
 * count as three levels higher). The ingredient list and every effect's
 * formula live in the Iron Chef extension pack (`data/extensions/iron-chef-ingredients.json`) -- shared rules, not character data --
 * so any character can show the tab and cook with a chef's level typed in.
 * The character's own tab keeps the dish it last built.
 *
 * Effects are templates: `{expr}` inside the text is a formula evaluated in a
 * scope of the chef's level and how many of each ingredient the dish uses --
 * `level`, `rice`, `spicy`, `sweet`, `sour`, `avocados`, `redMeat`,
 * `mycoprotein`, `fish`, `fowl` -- exactly the counts the workbook's own
 * COUNTIFs read.
 * ------------------------------------------------------------------ */

/** What the technique formulas read off the character: BAB and the Adept Initiator feat. */
export function techniqueContext(model) {
  let adept = 0;
  for (const g of model.data.featGroups || []) {
    for (const f of g.entries || []) {
      if (/^adept initiator\b/i.test(String(f?.name || '').trim())) adept += 1;
    }
  }
  return { bab: Number(model.data.attack?.bab) || 0, adeptInitiator: adept };
}

export function techniqueByName(model, name) {
  return (model.data.techniques?.catalogue || []).find((t) => t.name === name) || null;
}

/** A technique with its numbers and its Discord text: `mode` 'list' or 'auto' picks the tab's rule. */
export function techniqueView(model, t, mode = 'list') {
  const tech = normalizeTechnique(t);
  const stats = techniqueStats(tech, model.techniqueContext(), mode);
  return {
    technique: tech, stats,
    prerequisites: techniquePrerequisites(tech),
    export: techniqueExport(tech, stats, { characterName: String(model.data.identity?.name || '') }),
  };
}

export function selectTechnique(model, name) {
  if (!model.data.techniques) return model;
  model.data.techniques.selected = String(name || '');
  model.recompute();
  return model;
}

/**
 * Add the AutoTechnique draft to the technique list -- what the workbook's
 * tab does to techRef. A technique of the same name is replaced; the list
 * opens on it; the draft stays put so it can be tweaked and re-added.
 */
export function addDraftTechnique(model, status = '') {
  const block = model.data.techniques;
  const draft = normalizeTechnique(block?.draft);
  if (!block || !draft.name) return null;
  const entry = { ...draft, status: String(status || '') };
  const at = block.catalogue.findIndex((t) => t.name === draft.name);
  if (at >= 0) block.catalogue[at] = entry;
  else block.catalogue.push(entry);
  block.selected = draft.name;
  model.recompute();
  emit(model, { type: 'set', path: 'techniques.catalogue', value: block.catalogue });
  return entry;
}

/** Start the draft over from empty. */
export function resetDraftTechnique(model) {
  if (!model.data.techniques) return model;
  model.data.techniques.draft = emptyTechnique();
  model.recompute();
  return model;
}

/** Copy a catalogue technique into the draft, to make a variant of it. */
export function draftFromTechnique(model, name) {
  const t = model.techniqueByName(name);
  if (!t) return model;
  model.data.techniques.draft = normalizeTechnique({ ...t, status: '' });
  model.recompute();
  return model;
}

/**
 * Merge the techniques out of a converted workbook into this character --
 * for a character imported before the catalogue was captured, or to bring
 * new techniques over without re-importing the whole sheet. `doc` is what
 * `convertWorkbook` returns; its techRef, Technique List and AutoTechnique
 * grids are read the same way a fresh import reads them. Same-name entries
 * are replaced (their status comes from the workbook); the rest are kept.
 * Returns how many were added and replaced.
 */
export function mergeTechniquesFrom(model, doc) {
  const grids = doc?.extraTabs || {};
  const incoming = importTechniques(grids.techRef ?? null, grids['Technique List'] ?? null, grids.AutoTechnique ?? null);
  if (!model.data.techniques) model.data.techniques = { catalogue: [], selected: '', draft: emptyTechnique() };
  const block = model.data.techniques;
  let added = 0;
  let replaced = 0;
  for (const t of incoming.catalogue) {
    const at = block.catalogue.findIndex((x) => x.name === t.name);
    if (at >= 0) { block.catalogue[at] = t; replaced += 1; } else { block.catalogue.push(t); added += 1; }
  }
  if (!block.draft?.name && incoming.draft?.name) block.draft = incoming.draft;
  if (!block.selected && incoming.selected) block.selected = incoming.selected;
  model.data.techniques = normalizeTechniques(block);
  model.recompute();
  emit(model, { type: 'set', path: 'techniques.catalogue', value: model.data.techniques.catalogue });
  return { added, replaced, total: model.data.techniques.catalogue.length };
}

export function removeTechnique(model, name) {
  const block = model.data.techniques;
  if (!block) return model;
  block.catalogue = block.catalogue.filter((t) => t.name !== name);
  if (block.selected === name) block.selected = block.catalogue[0]?.name ?? '';
  model.recompute();
  return model;
}

/**
 * What the Alternate Training technique has put in its own sphere, level by
 * level.
 *
 * The technique names most of what it grants -- Light Body's Wall Stunt at
 * 3rd and Air Stunt at 5th are in the rules, not in the player's hands -- so
 * those are names like any other. Its first level is a choice between two
 * packages, which is a name once the player has made it and a pair of
 * possible names until they do. The levels from 7th are the player's pick
 * outright: a name when it is filled in, and nothing the sheet can read when
 * it is not.
 */
export function techniqueTalents(model) {
  const t = altTrainingTechnique(model.data.altTraining?.technique);
  const sphere = t?.talents?.sphere;
  if (!sphere) return null;
  const level = Number(model.data.identity.level) || 0;
  const picks = model.data.altTraining?.picks || {};
  const names = [];
  const choices = [];
  for (const lvl of altTrainingLevels()) {
    if (lvl > level) break;
    for (const g of altTrainingGrantsAt(t, lvl)) {
      if (!grantCount(g, 'talent')) continue;
      const pick = String(picks[lvl] ?? '').trim();
      // A grant the player chooses is a choice even where the rules name the
      // sphere it comes from, so `name` only settles a grant with no pick on
      // it. Athletics at 1st is the case: the rules say which sphere and the
      // player says which package, and it is the package the skill rows match.
      if (g.name && !g.pick) names.push(g.name);
      else if (pick) names.push(pick);
      else if (g.pick?.options?.length) choices.push(g.pick.options);
    }
  }
  return { side: t.talents.side, sphere, names, choices };
}
