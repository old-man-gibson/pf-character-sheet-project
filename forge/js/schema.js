/**
 * What the Forge knows how to write: the entry types, their fields, and the
 * published Path of War baseline the discipline audit measures against.
 *
 * An entry is `{id, type, name, parent, tags, fields, body, createdAt,
 * updatedAt}`. `fields` holds the type's own cells (a feat's prerequisites, a
 * maneuver's range); `body` is the rules text, with `[[Entry Name]]` links
 * and light markdown. `parent` is the container an entry sits in -- a
 * maneuver in its discipline, a class feature in its class -- and only the
 * types that name a `parent` list carry one.
 */

export const ACTIONS = ['Standard', 'Full-round', 'Swift', 'Immediate', 'Move', 'Free', 'See text'];

export const TYPES = {
  trait: { label: 'Trait', plural: 'Traits', group: 'Character options', bodyLabel: 'Benefit', fields: [
    { k: 'category', l: 'Category', t: 'select', o: ['Combat', 'Faith', 'Magic', 'Social', 'Race', 'Regional', 'Religion', 'Campaign', 'Drawback'] },
    { k: 'prereq', l: 'Prerequisites', t: 'text' }] },
  feat: { label: 'Feat', plural: 'Feats', group: 'Character options', bodyLabel: 'Benefit', fields: [
    { k: 'featType', l: 'Type', t: 'select', o: ['General', 'Combat', 'Metamagic', 'Item Creation', 'Teamwork', 'Style', 'Critical', 'Grit', 'Panache', 'Mythic'] },
    { k: 'prereq', l: 'Prerequisites', t: 'text', wide: true },
    { k: 'normal', l: 'Normal', t: 'textarea', wide: true }, { k: 'special', l: 'Special', t: 'textarea', wide: true }] },
  class: { label: 'Class', plural: 'Classes', group: 'Character options', bodyLabel: 'Description', children: ['classFeature', 'archetype'], fields: [
    { k: 'hd', l: 'Hit die', t: 'select', o: ['d6', 'd8', 'd10', 'd12'] }, { k: 'ranks', l: 'Skill ranks / level', t: 'text' },
    { k: 'bab', l: 'BAB', t: 'select', o: ['Full', '3/4', '1/2'] }, { k: 'fort', l: 'Fort', t: 'select', o: ['Good', 'Poor'] }, { k: 'ref', l: 'Ref', t: 'select', o: ['Good', 'Poor'] }, { k: 'will', l: 'Will', t: 'select', o: ['Good', 'Poor'] },
    { k: 'classSkills', l: 'Class skills', t: 'text', wide: true }, { k: 'prof', l: 'Weapon & armor proficiency', t: 'text', wide: true }] },
  archetype: { label: 'Archetype', plural: 'Archetypes', group: 'Character options', bodyLabel: 'Description', parent: ['class'], children: ['classFeature'], fields: [
    { k: 'baseClass', l: 'Base class (if not linked)', t: 'text' }, { k: 'replaces', l: 'Replaced features', t: 'text', wide: true }] },
  classFeature: { label: 'Class feature', plural: 'Class features', group: 'Character options', bodyLabel: 'Description', parent: ['class', 'archetype'], fields: [
    { k: 'level', l: 'Level', t: 'number' }, { k: 'kind', l: 'Kind', t: 'select', o: ['Ex', 'Su', 'Sp', '—'] },
    // `after`: under the description rather than above it. What a feature
    // replaces is the last thing a printed archetype says about it, and the
    // editor, the preview and the Markdown all keep that order.
    { k: 'replaces', l: 'Replaces (archetype: features removed)', t: 'text', after: true }, { k: 'alters', l: 'Alters (archetype: features changed, kept)', t: 'text', after: true }] },
  race: { label: 'Race', plural: 'Races', group: 'Character options', bodyLabel: 'Racial traits', fields: [
    { k: 'size', l: 'Size', t: 'select', o: ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge'] }, { k: 'ctype', l: 'Type', t: 'text' },
    { k: 'abilities', l: 'Ability modifiers', t: 'text' }, { k: 'speed', l: 'Speed', t: 'text' }, { k: 'languages', l: 'Languages', t: 'text', wide: true }] },
  spell: { label: 'Spell', plural: 'Spells', group: 'Magic & gear', bodyLabel: 'Description', fields: [
    { k: 'school', l: 'School (subschool) [descriptors]', t: 'text', wide: true }, { k: 'level', l: 'Level', t: 'text', wide: true },
    { k: 'casting', l: 'Casting time', t: 'text' }, { k: 'components', l: 'Components', t: 'text' }, { k: 'range', l: 'Range', t: 'text' }, { k: 'target', l: 'Target / Area / Effect', t: 'text' },
    { k: 'duration', l: 'Duration', t: 'text' }, { k: 'save', l: 'Saving throw', t: 'text' }, { k: 'sr', l: 'Spell resistance', t: 'text' }] },
  item: { label: 'Item', plural: 'Items', group: 'Magic & gear', bodyLabel: 'Description', fields: [
    { k: 'category', l: 'Category', t: 'select', o: ['Weapon', 'Armor', 'Ring', 'Rod', 'Staff', 'Wand', 'Wondrous item', 'Alchemical', 'Mundane', 'Artifact'] },
    { k: 'slot', l: 'Slot', t: 'text' }, { k: 'aura', l: 'Aura', t: 'text' }, { k: 'cl', l: 'CL', t: 'text' }, { k: 'price', l: 'Price', t: 'text' }, { k: 'weight', l: 'Weight', t: 'text' },
    { k: 'construction', l: 'Construction requirements', t: 'text', wide: true }] },
  discipline: { label: 'Discipline', plural: 'Disciplines', group: 'Path of War', bodyLabel: 'Description', children: ['maneuver'], fields: [
    { k: 'skill', l: 'Discipline skill', t: 'text' }, { k: 'weapons', l: 'Discipline weapons', t: 'text' }, { k: 'tradition', l: 'Tradition', t: 'text', wide: true }] },
  maneuver: { label: 'Maneuver', plural: 'Maneuvers', group: 'Path of War', bodyLabel: 'Description', parent: ['discipline'], fields: [
    { k: 'level', l: 'Level', t: 'number' }, { k: 'mtype', l: 'Type', t: 'select', o: ['Strike', 'Boost', 'Counter', 'Stance', 'Other'] },
    { k: 'action', l: 'Initiation action', t: 'select', o: ACTIONS }, { k: 'range', l: 'Range', t: 'text' }, { k: 'target', l: 'Target', t: 'text' },
    { k: 'duration', l: 'Duration', t: 'text' }, { k: 'save', l: 'Saving throw', t: 'text' }, { k: 'dc', l: 'DC', t: 'text' }] },
  campaign: { label: 'Campaign', plural: 'Campaigns', group: 'World', bodyLabel: 'Overview', children: ['session', 'location', 'npc', 'creature'], fields: [
    { k: 'setting', l: 'Setting', t: 'text' }, { k: 'players', l: 'Players', t: 'text' }, { k: 'status', l: 'Status', t: 'select', o: ['Planning', 'Running', 'Paused', 'Finished'] }] },
  session: { label: 'Session', plural: 'Sessions', group: 'World', bodyLabel: 'Notes', parent: ['campaign'], fields: [
    { k: 'number', l: 'Number', t: 'number' }, { k: 'date', l: 'Date', t: 'text' }, { k: 'title', l: 'Title', t: 'text' }] },
  location: { label: 'Location', plural: 'Locations', group: 'World', bodyLabel: 'Description', parent: ['campaign', 'location'], children: ['location', 'npc'], fields: [
    { k: 'kind', l: 'Kind', t: 'select', o: ['Plane', 'Continent', 'Region', 'Nation', 'City', 'Town', 'Village', 'Site', 'Dungeon', 'Building'] }, { k: 'region', l: 'Region', t: 'text' }] },
  npc: { label: 'NPC', plural: 'NPCs', group: 'World', bodyLabel: 'Description', parent: ['campaign', 'location'], fields: [
    { k: 'role', l: 'Role', t: 'text' }, { k: 'faction', l: 'Faction', t: 'text' }, { k: 'cr', l: 'CR', t: 'text' }, { k: 'alignment', l: 'Alignment', t: 'text' }] },
  creature: { label: 'Creature', plural: 'Creatures', group: 'World', bodyLabel: 'Description & ecology', parent: ['campaign'], fields: [
    { k: 'cr', l: 'CR', t: 'text' }, { k: 'ctype', l: 'Type', t: 'text' }, { k: 'size', l: 'Size', t: 'text' }, { k: 'alignment', l: 'Alignment', t: 'text' },
    { k: 'statblock', l: 'Stat block', t: 'textarea', wide: true, mono: true }] },
  article: { label: 'Article', plural: 'Articles', group: 'Reference', bodyLabel: 'Text', fields: [] },
};

export const GROUPS = ['Character options', 'Magic & gear', 'Path of War', 'World', 'Reference'];

/*
 * Every kind can hold entries of its own kind, on top of the containers it
 * already names: a class feature under a class feature ("Cuts" under
 * "Topological Iaijutsu Techniques", and the cuts under that), an article
 * under an article, a maneuver under a maneuver. That is what makes a group
 * of any depth: the list folds at every level, the preview and the Markdown
 * follow it, and the pack writer flattens a nested feature or maneuver into
 * the block the sheet reads with its group's name in front. The kind is
 * added last in `children`, so "+ Add" under a container still makes what
 * it always made.
 */
export function selfNesting(id, t) {
  t.parent = [...(t.parent || []).filter((p) => p !== id), id];
  t.children = [...(t.children || []).filter((c) => c !== id), id];
}
for (const [id, t] of Object.entries(TYPES)) selfNesting(id, t);

/* ---------------- custom categories ---------------- */
/*
 * A category a player adds is a type like the ones above, made in Settings:
 * a label, a group (one of the five, or a new one), the body's label, an
 * optional parent type it sits under -- which makes it a subcategory, a
 * child the way a maneuver is a discipline's -- and any text cells it wants.
 * They are kept as plain data in the store's meta and in a project export,
 * and applied to TYPES and GROUPS in place, so every renderer that reads
 * those sees a custom category as it sees a built-in one. Re-applying
 * replaces the previous set: what was custom and is no longer listed goes,
 * and a built-in parent it had been added to as a child forgets it.
 */

/** How many of GROUPS are the built-in ones; the rest are custom. */
const BUILTIN_GROUPS = GROUPS.length;

/**
 * Custom categories as clean data: one per usable row, a slugged id that
 * cannot collide with a built-in type, labels defaulted from each other,
 * cells as `{k, l}` text fields with keys slugged from their labels. A row
 * with no label at all is dropped.
 */
export function normalizeCustomTypes(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const label = str(raw.label).trim();
    if (!label) continue;
    let id = str(raw.id).trim() || `x-${slug(label)}`;
    if (!id.startsWith('x-')) id = `x-${slug(id)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fields = (Array.isArray(raw.fields) ? raw.fields : str(raw.fields).split(','))
      .map((c) => (c && typeof c === 'object' ? { k: str(c.k).trim(), l: str(c.l).trim() } : { k: '', l: str(c).trim() }))
      .filter((c) => c.l)
      .map((c) => ({ k: c.k || slug(c.l).replace(/-/g, '_'), l: c.l, t: 'text' }));
    out.push({
      id, label,
      plural: str(raw.plural).trim() || `${label}s`,
      group: str(raw.group).trim() || 'Reference',
      parent: str(raw.parent).trim(),
      bodyLabel: str(raw.bodyLabel).trim() || 'Text',
      fields,
    });
  }
  return out;
}

/**
 * Put a set of custom categories into TYPES and GROUPS, replacing whatever
 * custom set was there. Returns the clean list that was applied.
 */
export function applyCustomTypes(list) {
  for (const [id, t] of Object.entries(TYPES)) if (t.custom) delete TYPES[id];
  for (const t of Object.values(TYPES)) if (t.children) t.children = t.children.filter((c) => TYPES[c]);
  for (const t of Object.values(TYPES)) if (t.parent) t.parent = t.parent.filter((c) => TYPES[c]);
  GROUPS.splice(BUILTIN_GROUPS);
  const custom = normalizeCustomTypes(list);
  for (const c of custom) {
    TYPES[c.id] = {
      label: c.label, plural: c.plural, group: c.group, bodyLabel: c.bodyLabel, custom: true,
      fields: c.fields.map((fd) => ({ ...fd, wide: true })),
      ...(c.parent ? { parent: [c.parent] } : {}),
    };
    if (!GROUPS.includes(c.group)) GROUPS.push(c.group);
  }
  for (const c of custom) selfNesting(c.id, TYPES[c.id]);
  // Parents after every custom type exists: a custom parent may be listed
  // after its child, and a parent that does not exist is no parent.
  for (const c of custom) {
    const p = c.parent && TYPES[c.parent];
    if (!p) { TYPES[c.id].parent = [c.id]; continue; }
    p.children = p.children || [];
    if (!p.children.includes(c.id)) p.children.push(c.id);
  }
  return custom;
}

/**
 * The published Path of War baseline: thirty disciplines, 1,034 entries.
 * Per discipline, per level 1-9: the average count, and the least and most
 * any published discipline carries. `total` is every type together.
 */
export const BASE = {
  Strike: { a: [2.4, 2.3, 1.7, 2.0, 1.9, 1.9, 1.7, 1.4, 0.7], lo: [1, 1, 0, 1, 1, 0, 1, 1, 0], hi: [4, 3, 3, 4, 3, 3, 4, 3, 1] },
  Boost: { a: [1.1, 1.2, 0.9, 1.1, 0.6, 1.0, 0.7, 0.3, 0.1], lo: [0, 0, 0, 0, 0, 0, 0, 0, 0], hi: [3, 3, 2, 2, 3, 2, 2, 1, 1] },
  Counter: { a: [0.6, 1.3, 0.5, 0.8, 0.8, 0.5, 0.6, 0.4, 0.1], lo: [0, 1, 0, 0, 0, 0, 0, 0, 0], hi: [2, 2, 2, 2, 2, 2, 2, 1, 1] },
  Stance: { a: [1.9, 0, 1.0, 0.1, 0.8, 0.9, 0.1, 1.0, 0], lo: [1, 0, 0, 0, 0, 0, 0, 0, 0], hi: [2, 0, 1, 1, 2, 1, 1, 1, 0] },
  total: { a: [6.0, 4.8, 4.1, 4.0, 4.2, 4.3, 3.1, 3.0, 1.0], lo: [5, 4, 4, 4, 3, 3, 3, 3, 1], hi: [7, 5, 5, 4, 5, 5, 4, 4, 1] },
};

/* ---------------- small helpers every module wants ---------------- */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const slug = (s) => (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entry');
export const now = () => new Date().toISOString();
export const ord = (n) => { n = +n || 0; const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export const str = (v) => (v === null || v === undefined ? '' : String(v));

/** A fresh entry of a type, empty but for what is given. */
export function newEntry(type = 'article', name = '', parent = '') {
  return { id: `${slug(name || type)}-${uid()}`, type, name, parent, tags: [], fields: {}, body: '', createdAt: now(), updatedAt: now() };
}

/** Every `[[link]]` target a text names, as written. */
export function linksIn(text) {
  const out = [];
  String(text || '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, n) => { out.push(n.trim()); return m; });
  return out;
}

/** Entries in the order the list shows them: by group, type, container, level, name. */
export function sortEntries(entries, nameOf) {
  return [...entries].sort((a, b) => {
    const g = GROUPS.indexOf(TYPES[a.type]?.group) - GROUPS.indexOf(TYPES[b.type]?.group); if (g) return g;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (a.parent !== b.parent) return nameOf(a.parent).localeCompare(nameOf(b.parent));
    const la = +a.fields?.level || +a.fields?.number || 0; const lb = +b.fields?.level || +b.fields?.number || 0; if (la !== lb) return la - lb;
    return a.name.localeCompare(b.name);
  });
}
