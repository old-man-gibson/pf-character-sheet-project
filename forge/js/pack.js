/**
 * Packs, both ways. Out: `forgeToPack` in app/js/forge-pack.js, the mapping
 * the shelving tool uses too. In: `importPack`, which reads a pack -- the
 * sheet's own, or one the Forge wrote -- back into entries, skipping what is
 * already here by type and name.
 */
import { TYPES, ACTIONS, newEntry, str } from './schema.js';
export { forgeToPack, plainText } from '../../app/js/forge-pack.js';

const listOf = (v) => str(v).split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
const numIn = (v) => { const m = str(v).match(/-?\d+/); return m ? Number(m[0]) : null; };

/**
 * The entries a pack adds to `existing`. A discipline already here gains the
 * maneuvers it lacks (by name and level); anything else of a type and name
 * already here is left alone. `Belongs to` and an archetype's class resolve
 * against existing and new entries alike.
 */
export function importPack(data, existing = []) {
  const list = [];
  const pending = [];
  const have = new Set(existing.map((e) => `${e.type}|${e.name}`.toLowerCase()));
  const fresh = (type, name) => {
    const k = `${type}|${str(name)}`.toLowerCase();
    if (!name || have.has(k)) return null;
    have.add(k);
    const e = newEntry(type, str(name));
    list.push(e);
    return e;
  };
  const labelKeys = (type) => Object.fromEntries((TYPES[type]?.fields || []).map((fd) => [fd.l.toLowerCase(), fd.k]));
  const childrenOf = (id) => [...existing, ...list].filter((e) => e.parent === id);
  const P = data.provides || {};

  for (const d of P.maneuvers?.disciplines || []) {
    const dn = str(d.name).toLowerCase();
    let disc = [...existing, ...list].find((e) => e.type === 'discipline' && e.name.toLowerCase() === dn);
    if (!disc) { disc = newEntry('discipline', str(d.name)); list.push(disc); have.add(`discipline|${str(d.name)}`.toLowerCase()); }
    const seen = new Set(childrenOf(disc.id).map((m) => `${m.name}|${m.fields?.level}`.toLowerCase()));
    for (const m of d.entries || []) {
      if (!m?.name || seen.has(`${m.name}|${m.level}`.toLowerCase())) continue;
      seen.add(`${m.name}|${m.level}`.toLowerCase());
      const e = newEntry('maneuver', m.name, disc.id);
      const t = ['Strike', 'Boost', 'Counter', 'Stance'].includes(m.type) ? m.type : (m.kind === 'stance' ? 'Stance' : 'Other');
      e.fields = { level: +m.level || 1, mtype: t, action: ACTIONS.includes(m.action) ? m.action : str(m.action), range: str(m.range), target: str(m.target), duration: str(m.duration), save: str(m.save), dc: str(m.dc) };
      e.body = str(m.text);
      list.push(e);
    }
  }
  for (const x of P.feats?.feats || []) {
    const e = fresh('feat', x.name); if (!e) continue;
    let body = str(x.text); let normal = ''; let special = '';
    body = body.replace(/\n\s*Normal:\s*([\s\S]*?)(?=\n\s*Special:|$)/, (m, t) => { normal = t.trim(); return ''; })
      .replace(/\n\s*Special:\s*([\s\S]*)$/, (m, t) => { special = t.trim(); return ''; });
    e.fields = { featType: str(x.type), prereq: str(x.prerequisites), normal, special }; e.body = body.trim();
  }
  for (const x of P.spells?.spells || []) {
    const e = fresh('spell', x.name); if (!e) continue;
    const classes = Array.isArray(x.classes)
      ? x.classes.map((c) => (typeof c === 'string' ? c : [c.name, c.level].filter((v) => v != null && v !== '').join(' '))).join(', ')
      : str(x.classes) || (x.level != null ? String(x.level) : '');
    e.fields = { school: str(x.school) + (x.descriptor ? ` [${x.descriptor}]` : ''), level: classes, casting: str(x.time), components: str(x.components), range: str(x.range), target: str(x.target), duration: str(x.duration), save: str(x.save), sr: str(x.sr) };
    e.body = str(x.text);
  }
  for (const g of P.catalogues?.catalogues || []) {
    const type = TYPES[g.kind] ? g.kind : 'article';
    const keys = labelKeys(type);
    for (const x of g.entries || []) {
      if (type === 'discipline') {
        // the description of a discipline whose maneuvers arrived above: fill what is still empty
        const d = [...list, ...existing].find((o) => o.type === 'discipline' && o.name.toLowerCase() === str(x.name).toLowerCase());
        if (d) {
          let changed = false;
          if (!d.body && str(x.text)) { d.body = str(x.text); changed = true; }
          for (const [l, v] of x.fields || []) { const k = keys[str(l).toLowerCase()]; if (k && !d.fields[k] && str(v)) { d.fields[k] = str(v); changed = true; } }
          if (changed && !list.includes(d)) list.push(d);
          continue;
        }
      }
      const e = fresh(type, x.name); if (!e) continue;
      e.body = str(x.text); e.fields = {};
      for (const [l, v] of x.fields || []) {
        const ll = str(l).toLowerCase();
        if (ll === 'tags') e.tags = listOf(v);
        else if (ll === 'belongs to') pending.push([e, str(v), TYPES[type].parent || null]);
        else if (keys[ll]) e.fields[keys[ll]] = TYPES[type].fields.find((fd) => fd.k === keys[ll]).t === 'number' ? (numIn(v) ?? '') : str(v);
      }
      if (g.kind === 'discipline' && type === 'article') e.tags = ['Discipline'];
    }
  }
  for (const b of data.blocks || []) {
    const kind = str(b.kind).toLowerCase();
    if (kind === 'class') {
      const e = fresh('class', b.name); if (!e) continue;
      e.body = str(b.text);
      e.fields = { hd: `d${b.hd || 8}`, ranks: String(b.skillRanks ?? 2), bab: { 1: 'Full', 0.75: '3/4', 0.5: '1/2' }[b.bab] || '3/4', fort: b.goodFort ? 'Good' : 'Poor', ref: b.goodRef ? 'Good' : 'Poor', will: b.goodWill ? 'Good' : 'Poor', classSkills: (b.classSkills || []).join(', '), prof: '' };
      for (const ft of b.features || []) { const c = newEntry('classFeature', str(ft.name), e.id); c.fields = { level: +ft.level || 1, kind: '—', replaces: '', alters: '' }; c.body = str(ft.text); list.push(c); }
    } else if (kind === 'archetype') {
      const e = fresh('archetype', b.name); if (!e) continue;
      e.body = str(b.text); e.fields = { baseClass: str(b.class || b.className), replaces: '' };
      if (e.fields.baseClass) pending.push([e, e.fields.baseClass, ['class']]);
      for (const ft of b.features || []) { const c = newEntry('classFeature', str(ft.name), e.id); c.fields = { level: +ft.level || 1, kind: ft.type || '—', replaces: (ft.replaces || []).join(', '), alters: (ft.alters || []).join(', ') }; c.body = str(ft.text); list.push(c); }
    } else if (kind === 'race') {
      const e = fresh('race', b.name); if (!e) continue;
      const am = b.abilityMods || {};
      e.fields = { size: str(b.size), ctype: '', abilities: Object.entries(am).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k[0].toUpperCase()}${k.slice(1)}`).join(', '), speed: b.speed != null ? `${b.speed} ft.` : '', languages: (b.languages || []).join(', ') };
      e.body = [str(b.text), ...(b.traits || []).map((t) => `**${t.name}:** ${str(t.text)}`)].filter(Boolean).join('\n\n');
    } else if (kind === 'trait') {
      const e = fresh('trait', b.name); if (!e) continue;
      e.fields = { category: 'Race', prereq: '' }; e.body = str(b.text);
    } else if (kind === 'feature') {
      const e = fresh('classFeature', b.name); if (!e) continue;
      e.fields = { level: '', kind: b.type || '—', replaces: '', alters: '' }; e.body = str(b.text);
    } else {
      const e = fresh('article', b.name || b.title); if (!e) continue;
      e.tags = [kind]; e.body = str(b.text || b.body) || JSON.stringify(b, null, 1);
    }
  }
  const pool = [...existing, ...list];
  for (const [e, parentName, types] of pending) {
    const p = pool.find((o) => o.name.toLowerCase() === parentName.toLowerCase() && (!types || types.includes(o.type)));
    if (p) e.parent = p.id;
  }
  return list;
}
