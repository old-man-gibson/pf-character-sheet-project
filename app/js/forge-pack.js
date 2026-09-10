/**
 * Homebrew Workbench -> extension pack: the one mapping, shared by the Forge page
 * (`forge/`) and the shelving tool (`tools/forge-pack.mjs`).
 *
 * A Forge entry is `{id, type, name, parent, tags, fields, body}`; a pack is
 * what `extensions.js` reads. Pure: no DOM, no filesystem, nothing imported.
 * See docs/extensions.md, "From Homebrew Workbench", for what goes where.
 */

const FIELD_LABELS = {
  trait: { category: 'Category', prereq: 'Prerequisites' },
  item: { category: 'Category', slot: 'Slot', aura: 'Aura', cl: 'CL', price: 'Price', weight: 'Weight', construction: 'Construction requirements' },
  discipline: { skill: 'Discipline skill', weapons: 'Discipline weapons', tradition: 'Tradition' },
  campaign: { setting: 'Setting', players: 'Players', status: 'Status' },
  session: { number: 'Number', date: 'Date', title: 'Title' },
  location: { kind: 'Kind', region: 'Region' },
  npc: { role: 'Role', faction: 'Faction', cr: 'CR', alignment: 'Alignment' },
  creature: { cr: 'CR', ctype: 'Type', size: 'Size', alignment: 'Alignment', statblock: 'Stat block' },
  article: {},
};

import { normalizeCustomTypes } from '../../forge/js/schema.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Forge prose as a sheet cell reads it: links to their label, emphasis off, pipe tables to tabs. */
export function plainText(t) {
  return str(t).replace(/\r/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, n, l) => (l || n).trim())
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/__([^_\n]+)__/g, '$1')
    // A web link keeps its address beside the label: a cell cannot be clicked.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,3} /gm, '')
    .replace(/^> ?/gm, '')
    .replace(/^\|(.*)\|\s*$/gm, (m, r) => r.split('|').map((c) => c.trim()).join('\t'))
    .split('\n').filter((line) => !/^(?:\s*:?-{2,}:?\s*\t?)+$/.test(line)).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

const babOf = (v) => ({ Full: 1, '3/4': 0.75, '1/2': 0.5 }[str(v).trim()] ?? 0.75);
const list = (v) => str(v).split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
const numIn = (v) => { const m = str(v).match(/-?\d+/); return m ? Number(m[0]) : null; };

function abilityMods(v) {
  const out = {};
  for (const m of str(v).matchAll(/([+-]\s*\d+)\s*(str|dex|con|int|wis|cha)|(str|dex|con|int|wis|cha)\w*\s*([+-]\s*\d+)/gi)) {
    const key = (m[2] || m[3]).toLowerCase();
    const n = Number((m[1] || m[4]).replace(/\s+/g, ''));
    if (n) out[key] = n;
  }
  return out;
}

/** "**Wings:** text", "**Wings**: text" and "Wings: text" are all one shape: a race trait line. */
const TRAIT_LINE = /^\s*(?:[-*]\s+)?(?:\*\*([A-Z][^:*]{1,60}?):?\*\*:?|([A-Z][^:*]{1,60}?):)\s+(.+)$/;

/** The trait lines of a race's body as its traits. */
function traitLines(body) {
  const out = [];
  for (const line of str(body).split('\n')) {
    const m = line.match(TRAIT_LINE);
    if (m) out.push({ name: (m[1] || m[2]).trim(), text: plainText(m[3]) });
  }
  return out;
}
/** The race's body with its trait lines taken out: what is left is the description. */
const withoutTraitLines = (body) => str(body).split('\n').filter((line) => !TRAIT_LINE.test(line)).join('\n');

/**
 * The pack. `entries` are Forge entries -- `{id, type, name, parent, tags,
 * fields, body}` -- and `header` the pack's own id, name, author and revision.
 */
export function forgeToPack(entries, header = {}) {
  const all = (Array.isArray(entries) ? entries : []).filter((e) => e && e.id && e.type);
  // Categories of the player's own (`header.customTypes`, as a project export
  // carries them): their cells' labels, and the plural the catalogue is named
  // by, since a kind called "x-ritual" is nothing to a reader.
  const custom = new Map(normalizeCustomTypes(header.customTypes).map((c) => [c.id, c]));
  const labelsOf = (type) => FIELD_LABELS[type]
    || (custom.has(type) ? Object.fromEntries(custom.get(type).fields.map((fd) => [fd.k, fd.l])) : {});
  const kindOf = (type) => custom.get(type)?.plural || type;
  const byId = new Map(all.map((e) => [e.id, e]));
  const nameOf = (id) => byId.get(id)?.name || '';
  const kids = (id, type) => all.filter((e) => e.parent === id && (!type || e.type === type))
    .sort((a, b) => (Number(a.fields?.level) || 0) - (Number(b.fields?.level) || 0) || a.name.localeCompare(b.name));
  const f = (e) => e.fields || {};
  /*
   * A kind nested under its own kind, flattened in tree order for a block
   * that reads a flat list: "Cuts" under "Topological Iaijutsu Techniques"
   * and "Zero Point Thrust" under "Cuts" arrive as features named
   * "Cuts: Zero Point Thrust", each at its own level or, with none, its
   * group's. A cycle is not followed.
   */
  const tree = (id, type, seen = new Set(), group = null) => kids(id, type).flatMap((c) => {
    if (seen.has(c.id)) return [];
    seen.add(c.id);
    const name = group ? `${group.name}: ${c.name}` : c.name;
    const level = Number(f(c).level) || (group ? group.level : 0) || null;
    return [{ e: c, name, level }, ...tree(c.id, type, seen, { name: c.name, level })];
  });

  const disciplines = [];
  const feats = [];
  const spells = [];
  const blocks = [];
  const catalogues = new Map();
  const catalogue = (kind, e, extraFields = []) => {
    if (!catalogues.has(kind)) catalogues.set(kind, []);
    const labels = labelsOf(e.type);
    const fields = [];
    for (const [k, label] of Object.entries(labels)) if (str(f(e)[k]).trim()) fields.push([label, str(f(e)[k]).trim()]);
    for (const pair of extraFields) if (str(pair[1]).trim()) fields.push([pair[0], str(pair[1]).trim()]);
    if (e.parent && nameOf(e.parent)) fields.push(['Belongs to', nameOf(e.parent)]);
    if (Array.isArray(e.tags) && e.tags.length) fields.push(['Tags', e.tags.join(', ')]);
    catalogues.get(kind).push({ name: e.name, fields, text: plainText(e.body), source: '' });
  };

  for (const e of all) {
    const x = f(e);
    switch (e.type) {
      case 'discipline':
        disciplines.push({
          name: e.name,
          entries: tree(e.id, 'maneuver').map(({ e: m, name, level }) => ({
            level: level || 1,
            kind: f(m).mtype === 'Stance' ? 'stance' : 'maneuver',
            name,
            type: str(f(m).mtype) || 'Strike',
            action: str(f(m).action),
            range: str(f(m).range),
            target: str(f(m).target),
            duration: str(f(m).duration),
            save: str(f(m).save),
            dc: str(f(m).dc),
            text: plainText(m.body),
          })),
        });
        catalogue('discipline', e);
        break;
      case 'maneuver':
        if (!e.parent || byId.get(e.parent)?.type !== 'discipline') catalogue('maneuver', e, [['Level', x.level], ['Type', x.mtype], ['Initiation action', x.action], ['Range', x.range], ['Target', x.target], ['Duration', x.duration], ['Saving throw', x.save], ['DC', x.dc]]);
        break;
      case 'feat': {
        const tail = [x.normal ? `Normal: ${plainText(x.normal)}` : '', x.special ? `Special: ${plainText(x.special)}` : ''].filter(Boolean);
        feats.push({ name: e.name, type: str(x.featType), prerequisites: str(x.prereq), text: [plainText(e.body), ...tail].filter(Boolean).join('\n\n'), source: '' });
        break;
      }
      case 'spell': {
        const school = str(x.school);
        const desc = school.match(/\[([^\]]*)\]/)?.[1] || '';
        spells.push({
          name: e.name, classes: str(x.level), level: /^\s*\d+\s*$/.test(str(x.level)) ? Number(x.level) : null,
          school: school.replace(/\s*\[[^\]]*\]/, '').trim(), descriptor: desc,
          components: str(x.components), time: str(x.casting), range: str(x.range), target: str(x.target),
          duration: str(x.duration), save: str(x.save), sr: str(x.sr), text: plainText(e.body), source: '',
        });
        break;
      }
      case 'class':
        blocks.push({
          kind: 'class', name: e.name, text: plainText(e.body), source: '', group: '',
          hd: numIn(x.hd) || 8, bab: babOf(x.bab),
          goodFort: x.fort === 'Good', goodRef: x.ref === 'Good', goodWill: x.will === 'Good',
          skillRanks: numIn(x.ranks) ?? 2, classSkills: list(x.classSkills), systems: [],
          archetypes: kids(e.id, 'archetype').map((a) => a.name).join(', '),
          features: tree(e.id, 'classFeature').map(({ e: c, name, level }) => ({ level: level || 1, name, text: plainText(c.body) })),
        });
        break;
      case 'archetype':
        blocks.push({
          kind: 'archetype', name: e.name, text: plainText(e.body), source: '', group: '',
          class: nameOf(e.parent) || str(x.baseClass),
          features: tree(e.id, 'classFeature').map(({ e: c, name, level }) => ({
            level, name, type: f(c).kind && f(c).kind !== '—' ? f(c).kind : null,
            text: plainText(c.body), replaces: list(f(c).replaces), alters: list(f(c).alters),
          })),
        });
        break;
      case 'classFeature':
        // Loose only when nothing above it is a class or archetype: a feature
        // under a feature under an archetype went out with the archetype.
        if (!(function held(id, seen = new Set()) { const p = id && byId.get(id); if (!p || seen.has(p.id)) return false; seen.add(p.id); return ['class', 'archetype'].includes(p.type) || held(p.parent, seen); }(e.parent))) {
          blocks.push({ kind: 'feature', name: e.name, type: x.kind && x.kind !== '—' ? x.kind : null, text: plainText(e.body), source: '', group: '' });
        }
        break;
      case 'race':
        blocks.push({
          kind: 'race', name: e.name, text: plainText(withoutTraitLines(e.body)), source: '', group: '',
          size: str(x.size), speed: numIn(x.speed), abilityMods: abilityMods(x.abilities),
          traits: traitLines(e.body), languages: list(x.languages),
        });
        break;
      case 'trait':
        if (str(x.category) === 'Race') blocks.push({ kind: 'trait', name: e.name, race: '', text: plainText(e.body), source: '', group: '' });
        else catalogue('trait', e);
        break;
      default:
        catalogue(kindOf(e.type), e);
    }
  }

  const now = new Date().toISOString().slice(0, 19);
  const provides = {};
  if (disciplines.length) provides.maneuvers = { disciplines };
  if (feats.length) provides.feats = { feats };
  if (spells.length) provides.spells = { spells };
  if (catalogues.size) provides.catalogues = { catalogues: [...catalogues].map(([kind, list]) => ({ kind, entries: list })) };
  return {
    format: 'character-sheet-extension', formatVersion: 1,
    id: header.id || 'homebrew-workbench', name: header.name || 'Homebrew Workbench',
    author: header.author || '', description: header.description || `${all.length} entries from Homebrew Workbench`,
    source: header.source || '', license: header.license || '',
    revision: Math.max(1, Number(header.revision) || 1),
    createdAt: header.createdAt || now, updatedAt: now,
    provides, blocks,
  };
}
