/**
 * Monster import: a stat block, copied off a page, read into a character
 * document the sheet already knows how to run.
 *
 * A GM copies a creature off Archives of Nethys, d20pfsrd or a PDF and pastes
 * it. `parseStatBlock` reads the Bestiary layout -- the CR line, the alignment
 * line, Defense / Offense / Statistics / Ecology, the labelled lines inside
 * them (`AC 48, touch 40, flat-footed 37 (+4 deflection, …)`, `Melee bite +10
 * (1d8+4)`, `Str 36, Dex 30, …`), the Special Abilities paragraphs and the
 * description -- into one plain object. `monsterDocument` then lays that
 * object over a blank sheet: the six scores go on the Stats tab, the AC's
 * parenthetical becomes the typed AC bonuses, each attack becomes a weapon
 * row, the feats a feat group, the skills ranks on the standard rows, the
 * special abilities the race-trait rows (which is what they are), and the hit
 * dice a class row so BAB, saves and hit points come out of the same table a
 * character's do.
 *
 * The block's own numbers win. Everything the parts do not explain -- a
 * Bestiary's saves rarely add up to the table, a skill carries a racial bonus
 * the text lists elsewhere -- lands in the same reconciliation offsets an
 * imported workbook uses, so the sheet shows exactly what was pasted and
 * still moves when a score is edited. A line the reader could not place is
 * kept, not dropped: `unread` travels onto the document where the Stat Block
 * tab lists it for the GM to file or discard.
 *
 * Pure: text in, block and document out. No DOM, no storage.
 */

import { blankDocument } from './convert.js';
import { STANDARD_SKILLS, SIZE_MODIFIERS, abilityMod } from './rules.js';
import { MONSTER_TAB_ORDER, normalizeMonster } from './model/monster.js';

export { MONSTER_TAB_ORDER, normalizeMonster, emptyMonster } from './model/monster.js';

/* ---------------- text helpers ---------------- */

const clean = (s) => String(s ?? '')
  .replace(/ /g, ' ')            // no-break spaces off a web page
  .replace(/−/g, '-')            // minus sign
  .replace(/–/g, '-')            // en dash: crit ranges ("17–20"), penalties ("–1 size")
  .replace(/[‘’]/g, '’') // one apostrophe
  .replace(/\*\*([^*\n]+)\*\*/g, '$1')  // **bold** from a markdown copy
  .replace(/[ \t]+$/gm, '');

const isBlank = (line) => !line || !line.trim();

/** "+14" -> 14, "-1" -> -1, "—" -> null. */
const signed = (s) => {
  const m = String(s ?? '').match(/([+-]?)\s*(\d+)/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * Number(m[2]);
};

/** Split on a separator only where it stands outside parentheses. */
function splitOutside(text, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const ALIGNMENTS = {
  LG: 'Lawful Good', NG: 'Neutral Good', CG: 'Chaotic Good',
  LN: 'Lawful Neutral', N: 'Neutral', CN: 'Chaotic Neutral',
  LE: 'Lawful Evil', NE: 'Neutral Evil', CE: 'Chaotic Evil',
};
const SIZES = Object.keys(SIZE_MODIFIERS);

/**
 * Skill ranks per hit die, by creature type -- the Bestiary's own table. What
 * the class row a monster's hit dice become carries in its Ranks column; a
 * type not listed here gets 2, the humanoid figure.
 */
const TYPE_RANKS = {
  aberration: 4, animal: 2, construct: 2, dragon: 6, fey: 6, humanoid: 2,
  'magical beast': 2, 'monstrous humanoid': 4, ooze: 2, outsider: 6, plant: 2,
  undead: 4, vermin: 2,
};

/**
 * The labels a stat block writes at the start of a line or after a `;`,
 * longest first so "Special Attacks" is not read as "Special". Each maps to
 * the key it fills on the block.
 */
const LABELS = [
  ['Special Attacks', 'specialAttacks'],
  ['Defensive Abilities', 'defensiveAbilities'],
  ['Racial Modifiers', 'racialModifiers'],
  ['Base Statistics', 'baseStatistics'],
  ['Before Combat', 'beforeCombat'],
  ['During Combat', 'duringCombat'],
  ['Combat Gear', 'combatGear'],
  ['Other Gear', 'otherGear'],
  ['Organization', 'organization'],
  ['Environment', 'environment'],
  ['Weaknesses', 'weaknesses'],
  ['Weakness', 'weaknesses'],
  ['Languages', 'languages'],
  ['Perception', 'perception'],
  ['Base Atk', 'bab'],
  ['Treasure', 'treasure'],
  ['Source', 'source'],
  ['Senses', 'senses'],
  ['Immune', 'immune'],
  ['Resist', 'resist'],
  ['Ranged', 'ranged'],
  ['Melee', 'melee'],
  ['Morale', 'morale'],
  ['Speed', 'speed'],
  ['Space', 'space'],
  ['Reach', 'reach'],
  ['Skills', 'skills'],
  ['Feats', 'feats'],
  ['Aura', 'aura'],
  ['Init', 'init'],
  ['Gear', 'gear'],
  ['Fort', 'saves'],
  ['CMB', 'cmb'],
  ['CMD', 'cmd'],
  ['Str', 'abilities'],
  ['XP', 'xp'],
  ['AC', 'ac'],
  ['hp', 'hp'],
  ['DR', 'dr'],
  ['SR', 'sr'],
  ['SQ', 'sq'],
];

/** The section headings, matched on a line of their own in either case. */
const SECTIONS = new Map([
  ['defense', 'defense'], ['offense', 'offense'], ['statistics', 'statistics'],
  ['ecology', 'ecology'], ['special abilities', 'abilities'], ['description', 'description'],
  ['tactics', 'tactics'],
]);

/**
 * A magic block: "Spell-Like Abilities (CL 30th; concentration +42)", "Spells
 * Known (CL 8th)", "Psychic Magic (CL 12th…)" -- a heading with a caster
 * level, followed by lines the reader keeps together under it until the next
 * label or section. The footnote lines ("M …", "D domain spell") belong to it.
 */
const MAGIC_HEAD = /^([A-Z][A-Za-z' -]+?)\s*\(\s*CL\s+\d+(?:st|nd|rd|th)?\b[^)]*\)/;

/** A label at the start of a part, and what follows it. */
function labelOf(part) {
  const p = part.trim();
  for (const [label, key] of LABELS) {
    if (p.length > label.length && p.startsWith(label) && /[\s:]/.test(p[label.length])) {
      return { key, label, rest: p.slice(label.length).replace(/^[:\s]+/, '').trim() };
    }
    // A label alone on a line, with its value on the next -- some pastes wrap there.
    if (p === label) return { key, label, rest: '' };
  }
  return null;
}

/* ---------------- the reader ---------------- */

/**
 * Read a pasted stat block. Returns the block as plain fields, the special
 * abilities as `{ name, type, text }`, the attacks as parsed rows, and every
 * line that could not be placed under `unread`.
 */
export function parseStatBlock(text) {
  const rawLines = clean(text).split(/\r?\n/).map((l) => l.trim());
  const b = {
    name: '', cr: '', xp: null, source: '', alignment: '', size: 'Medium', type: '', subtypes: [],
    classLine: '', init: null, senses: '', perception: null, aura: '',
    ac: null, touch: null, flatFooted: null, acParts: [], acText: '',
    hp: null, hd: null, hitDie: null, hpBonus: null, hpText: '', healing: '',
    fort: null, ref: null, will: null, saveNote: '',
    defensiveAbilities: '', dr: '', immune: '', resist: '', sr: '', weaknesses: '',
    speeds: [], speedText: '', melee: [], ranged: [], meleeText: '', rangedText: '',
    space: '', reach: '', specialAttacks: '', magic: [],
    abilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null }, nonabilities: [],
    bab: null, cmb: null, cmbNote: '', cmd: null, cmdNote: '',
    feats: [], skills: [], skillsText: '', racialModifiers: '', languages: '', sq: '',
    gear: '', environment: '', organization: '', treasure: '', tactics: '',
    specialAbilities: [], description: '', unread: [], warnings: [],
  };

  // The CR line names the creature and starts the block; anything above it is
  // a page's chrome.
  const head = /^(.+?)\s+CR\s+([\d/]+|—|-)\s*(?:XP\s+([\d,]+))?\s*$/;
  let start = rawLines.findIndex((l) => head.test(l));
  if (start < 0) {
    start = rawLines.findIndex((l) => !isBlank(l));
    if (start < 0) return b;
    b.name = rawLines[start];
    b.warnings.push('No "Name CR n" line was found; the first line is taken as the name.');
  } else {
    const m = rawLines[start].match(head);
    b.name = m[1].trim();
    b.cr = m[2] === '-' ? '—' : m[2];
    if (m[3]) b.xp = Number(m[3].replace(/,/g, ''));
  }
  for (let i = 0; i < start; i++) if (!isBlank(rawLines[i])) b.unread.push(rawLines[i]);

  let section = 'head';
  let current = null;          // { key } of the last labelled part, for continuations
  let magic = null;            // the open magic block
  let ability = null;          // the special ability being read
  let sawStats = false;

  const typeLine = new RegExp(`^(${Object.keys(ALIGNMENTS).join('|')}|Any(?: alignment)?)\\s+(${SIZES.join('|')})\\s+([a-z][a-z ]*?)(?:\\s*\\(([^)]*)\\))?\\s*$`);

  const take = (key, rest) => {
    current = { key };
    switch (key) {
      case 'source': b.source = b.source ? `${b.source}; ${rest}` : rest; break;
      case 'xp': b.xp = Number(rest.replace(/,/g, '').match(/\d+/)?.[0] ?? NaN) || null; break;
      case 'init': b.init = signed(rest); break;
      case 'senses': b.senses = rest; break;
      case 'perception': b.perception = signed(rest); break;
      case 'aura': b.aura = rest; break;
      case 'ac': readAc(b, rest); break;
      case 'hp': readHp(b, rest); break;
      case 'saves': readSaves(b, rest); break;
      case 'defensiveAbilities': b.defensiveAbilities = rest; break;
      case 'dr': b.dr = rest; break;
      case 'immune': b.immune = rest; break;
      case 'resist': b.resist = rest; break;
      case 'sr': b.sr = rest; break;
      case 'weaknesses': b.weaknesses = rest; break;
      case 'speed': b.speedText = rest; b.speeds = readSpeeds(rest); break;
      case 'melee': b.meleeText = rest; b.melee = parseAttacks(rest, 'Melee'); break;
      case 'ranged': b.rangedText = rest; b.ranged = parseAttacks(rest, 'Ranged'); break;
      case 'space': {
        const m = rest.match(/^(.*?)(?:,\s*Reach\s+(.*))?$/i);
        b.space = m ? m[1].trim() : rest;
        if (m?.[2]) b.reach = m[2].trim();
        break;
      }
      case 'reach': b.reach = rest; break;
      case 'specialAttacks': b.specialAttacks = rest; break;
      case 'abilities': readAbilities(b, rest); sawStats = true; break;
      case 'bab': b.bab = signed(rest); break;
      case 'cmb': {
        b.cmb = signed(rest);
        b.cmbNote = rest.match(/\(([^)]*)\)/)?.[1] ?? '';
        break;
      }
      case 'cmd': {
        b.cmd = signed(rest);
        b.cmdNote = rest.match(/\(([^)]*)\)/)?.[1] ?? '';
        break;
      }
      case 'feats': b.feats.push(...readFeats(rest)); break;
      case 'skills': b.skillsText = b.skillsText ? `${b.skillsText}, ${rest}` : rest; b.skills.push(...readSkills(rest)); break;
      case 'racialModifiers': b.racialModifiers = rest; break;
      case 'languages': b.languages = rest; break;
      case 'sq': b.sq = rest; break;
      case 'gear': case 'combatGear': case 'otherGear':
        b.gear = b.gear ? `${b.gear}; ${key === 'gear' ? '' : `${key === 'combatGear' ? 'Combat Gear ' : 'Other Gear '}`}${rest}` : `${key === 'gear' ? '' : `${key === 'combatGear' ? 'Combat Gear ' : 'Other Gear '}`}${rest}`;
        break;
      case 'environment': b.environment = rest; break;
      case 'organization': b.organization = rest; break;
      case 'treasure': b.treasure = rest; break;
      case 'baseStatistics': case 'beforeCombat': case 'duringCombat': case 'morale': {
        const word = { baseStatistics: 'Base Statistics', beforeCombat: 'Before Combat', duringCombat: 'During Combat', morale: 'Morale' }[key];
        b.tactics = `${b.tactics ? `${b.tactics}\n` : ''}${word} ${rest}`;
        break;
      }
      default: b.unread.push(`${key} ${rest}`);
    }
  };

  /** Add an unlabelled part to whatever was last read, where that makes sense. */
  const continueWith = (part) => {
    if (!current) return false;
    const k = current.key;
    // "+8 vs. mind-affecting effects" after the saves; "telepathy 300 ft."
    // after the languages; a second sentence of anything that is prose.
    if (k === 'saves') { b.saveNote = b.saveNote ? `${b.saveNote}; ${part}` : part; return true; }
    if (k === 'hp') { b.healing = b.healing ? `${b.healing}; ${part}` : part; return true; }
    if (k === 'ac') { b.acText = b.acText ? `${b.acText}; ${part}` : part; return true; }
    const append = {
      senses: 'senses', aura: 'aura', defensiveAbilities: 'defensiveAbilities', immune: 'immune',
      resist: 'resist', weaknesses: 'weaknesses', specialAttacks: 'specialAttacks',
      languages: 'languages', sq: 'sq', racialModifiers: 'racialModifiers', gear: 'gear',
      environment: 'environment', organization: 'organization', treasure: 'treasure',
      source: 'source', cmdNote: 'cmdNote',
    }[k];
    if (append) { b[append] = b[append] ? `${b[append]}; ${part}` : part; return true; }
    if (k === 'feats') { b.feats.push(...readFeats(part)); return true; }
    if (k === 'skills') { b.skillsText += `, ${part}`; b.skills.push(...readSkills(part)); return true; }
    if (k === 'melee') { b.meleeText += ` ${part}`; b.melee = parseAttacks(b.meleeText, 'Melee'); return true; }
    if (k === 'ranged') { b.rangedText += ` ${part}`; b.ranged = parseAttacks(b.rangedText, 'Ranged'); return true; }
    if (k === 'speed') { b.speedText += `, ${part}`; b.speeds = readSpeeds(b.speedText); return true; }
    if (k === 'tactics') { b.tactics += ` ${part}`; return true; }
    return false;
  };

  for (let i = start + 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (isBlank(line)) {
      // A blank line ends a special ability's paragraph and a description's.
      if (ability) { b.specialAbilities.push(ability); ability = null; }
      if (section === 'description' && b.description) b.description += '\n';
      continue;
    }
    const heading = SECTIONS.get(line.toLowerCase().replace(/[:.]$/, ''));
    if (heading) {
      if (ability) { b.specialAbilities.push(ability); ability = null; }
      section = heading;
      current = null;
      magic = null;
      continue;
    }

    if (section === 'abilities') {
      const m = line.match(/^([A-Z][^()\n]{1,60}?)\s*\((Ex|Su|Sp|Ex, Su|Su, Sp|Ex or Su|Ex, Sp)\)\s*:?\s*(.*)$/);
      if (m) {
        if (ability) b.specialAbilities.push(ability);
        ability = { name: m[1].trim(), type: m[2], text: m[3].trim() };
      } else if (ability) {
        ability.text = `${ability.text}${ability.text ? '\n' : ''}${line}`;
      } else {
        b.unread.push(line);
      }
      continue;
    }
    if (section === 'description') {
      b.description = b.description ? `${b.description}${b.description.endsWith('\n') ? '' : '\n'}${line}` : line;
      continue;
    }
    if (section === 'tactics') {
      const l = labelOf(line);
      if (l) take(l.key, l.rest); else b.tactics = `${b.tactics ? `${b.tactics}\n` : ''}${line}`;
      continue;
    }

    // The head: source, XP, "Male human fighter 5", the alignment line.
    if (section === 'head') {
      const t = line.match(typeLine);
      if (t) {
        b.alignment = ALIGNMENTS[t[1]] || t[1];
        b.size = t[2];
        b.type = t[3].trim();
        b.subtypes = t[4] ? splitOutside(t[4], ',') : [];
        section = 'body';
        continue;
      }
    }

    // A magic block's heading opens it; its lines run until the next label.
    const mh = line.match(MAGIC_HEAD);
    if (mh && !labelOf(line)) {
      magic = { heading: line, lines: [] };
      b.magic.push(magic);
      current = null;
      continue;
    }

    // Labelled parts, `;`-separated on the line.
    const parts = splitOutside(line, ';');
    let placed = false;
    let anyLabel = false;
    for (const part of parts) {
      const l = labelOf(part);
      if (l) {
        // A label closes an open magic block -- except the labels that a
        // magic block's own lines may start with ("Domain", "Bloodline"),
        // which are not on the list, so this is safe.
        magic = null;
        anyLabel = true;
        take(l.key, l.rest);
        placed = true;
        continue;
      }
      if (magic) { magic.lines.push(part); placed = true; continue; }
      if (continueWith(part)) { placed = true; continue; }
      if (!anyLabel && section === 'head') { b.classLine = b.classLine ? `${b.classLine}; ${part}` : part; placed = true; continue; }
      b.unread.push(part);
    }
    if (!placed) b.unread.push(line);
  }
  if (ability) b.specialAbilities.push(ability);
  b.description = b.description.trim();
  if (!sawStats) b.warnings.push('No ability scores were found (a "Str 10, Dex 10, …" line).');
  if (b.ac == null) b.warnings.push('No armor class was found (an "AC n, touch n, flat-footed n" line).');
  return b;
}

/* ---------------- the individual lines ---------------- */

/** "48, touch 40, flat-footed 37 (+4 deflection, +10 Dex, –1 size)". */
function readAc(b, rest) {
  const m = rest.match(/^(\d+)(?:,\s*touch\s+(\d+))?(?:,\s*flat-footed\s+(\d+))?\s*(?:\(([^)]*)\))?\s*(.*)$/i);
  if (!m) { b.acText = rest; return; }
  b.ac = Number(m[1]);
  b.touch = m[2] != null ? Number(m[2]) : b.ac;
  b.flatFooted = m[3] != null ? Number(m[3]) : b.ac;
  b.acParts = m[4] ? splitOutside(m[4], ',').map((p) => {
    const pm = p.match(/^([+-]?\s*\d+)\s+(.+)$/);
    return pm ? { amount: signed(pm[1]), type: pm[2].trim() } : { amount: 0, type: p.trim() };
  }) : [];
  b.acText = (m[5] || '').trim();
}

/** "717 (35d10+525); regeneration 30 (deific or mythic)" -- the part before the `;`. */
function readHp(b, rest) {
  const m = rest.match(/^(\d+)\s*(?:\(\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*(?:plus\s+([^)]*))?\s*\))?\s*(.*)$/i);
  if (!m) { b.hpText = rest; return; }
  b.hp = Number(m[1]);
  if (m[2]) {
    b.hd = Number(m[2]);
    b.hitDie = Number(m[3]);
    b.hpBonus = m[4] ? signed(m[4]) : 0;
  }
  b.hpText = rest;
  if (m[6]) b.healing = m[6].trim();
}

/** "+30, Ref +30, Will +36". */
function readSaves(b, rest) {
  const m = rest.match(/^([+-]?\d+)\s*,?\s*Ref\s+([+-]?\d+)\s*,?\s*Will\s+([+-]?\d+)\s*(.*)$/i);
  if (!m) { b.saveNote = rest; return; }
  b.fort = Number(m[1]);
  b.ref = Number(m[2]);
  b.will = Number(m[3]);
  if (m[4]) b.saveNote = m[4].replace(/^[;,\s]+/, '').trim();
}

/** "fly 120 ft. (perfect)", "30 ft., swim 20 ft.", "40 ft. (30 ft. in armor)". */
export function readSpeeds(text) {
  const out = [];
  for (const raw of splitOutside(text, ',')) {
    const m = raw.match(/^(?:(burrow|climb|fly|swim|land)\s+)?(\d+)\s*(?:ft\.?|feet)\s*(?:\(([^)]*)\))?(.*)$/i);
    if (!m) { out.push({ type: raw, base: 0, note: '' }); continue; }
    const kind = m[1] ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Land';
    const note = (m[3] || '').trim();
    // A fly speed's manoeuvrability rides in the type, where the sheet shows it.
    const type = kind === 'Fly' && note && /^(clumsy|poor|average|good|perfect)$/i.test(note)
      ? `Fly (${note.toLowerCase()})` : kind;
    out.push({ type, base: Number(m[2]), note: type === kind ? note : '' });
  }
  return out;
}

/** "Str 36, Dex 30, Con 41, Int 35, Wis 32, Cha 35" -- a dash is a nonability. */
function readAbilities(b, rest) {
  const line = `Str ${rest}`;
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const m = line.match(new RegExp(`\\b${k}\\s+(\\d+|—|-)`, 'i'));
    if (!m) continue;
    if (/\d/.test(m[1])) b.abilities[k] = Number(m[1]);
    else { b.abilities[k] = null; b.nonabilities.push(k); }
  }
}

/** "Critical Focus, Dazzling Display, Empower Spell-Like Ability (cone of cold)". */
export function readFeats(text) {
  // A PDF's line break lands as "Spell- Like" in a paste; the hyphen is the
  // feat's own, the space is not.
  const joined = String(text ?? '').replace(/([A-Za-z])- (?=[A-Z][a-z])/g, '$1-');
  return splitOutside(joined, ',').map((raw) => {
    // A bonus-feat superscript ("ToughnessB") rides on the end of the name.
    const m = raw.match(/^(.+?)\s*(?:\(([^)]*)\))?\s*(B)?$/);
    return { name: (m ? m[1] : raw).trim(), detail: m?.[2]?.trim() ?? '' };
  }).filter((f) => f.name);
}

/**
 * "Acrobatics +48, Knowledge (arcana, history) +47, Craft (weapons) +5":
 * one entry per skill, a Knowledge with several specialities fanned out.
 */
export function readSkills(text) {
  const out = [];
  for (const raw of splitOutside(text, ',')) {
    const m = raw.match(/^(.+?)\s*(?:\(([^)]*)\))?\s*([+-]\d+)\s*(?:\(([^)]*)\))?\s*$/);
    if (!m) { out.push({ name: raw, spec: null, bonus: null, note: '' }); continue; }
    const name = m[1].trim();
    const bonus = Number(m[3]);
    const note = m[4]?.trim() ?? '';
    const specs = m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [null];
    for (const spec of specs) out.push({ name, spec, bonus, note });
  }
  return out;
}

/* ---------------- attacks ---------------- */

const NATURAL = /^(bite|claw|slam|sting|gore|talon|tail slap|tail|wing|hoof|hooves|tentacle|pincer|fist|kick|horn|tusk|rake|slap|touch|incorporeal touch|rock|web|spit|breath)s?$/i;
const SINGULAR = { hooves: 'hoof', claws: 'claw', slams: 'slam', bites: 'bite', stings: 'sting', talons: 'talon', wings: 'wing', tentacles: 'tentacle', pincers: 'pincer', fists: 'fist', tusks: 'tusk', rakes: 'rake', horns: 'horn', rocks: 'rock', 'tail slaps': 'tail slap' };

/** Damage type from the attack's name, where the name says. */
function damageTypeOf(name) {
  const n = name.toLowerCase();
  if (/\b(bite|jaws)\b/.test(n)) return 'B, P, S';
  if (/\b(claw|talon|rake|scythe|sword|axe|falchion|kukri|scimitar|glaive|halberd)\b/.test(n)) return 'S';
  if (/\b(slam|tail slap|tail|hoof|fist|mace|club|hammer|flail|staff|morningstar|rock|wing|tentacle|kick)\b/.test(n)) return 'B';
  if (/\b(sting|gore|horn|tusk|spear|dagger|rapier|pick|arrow|bolt|javelin|bow|crossbow|dart|pincer)\b/.test(n)) return 'P';
  return '';
}

/**
 * "+5 icy burst longsword +53/+48/+43/+38 (2d6+24/17-20 plus 1d6 cold) or 2
 * slams +47 (8d6+13)": one row per attack. `group` numbers the "or"
 * alternatives, so the block can be printed the way it was written.
 */
export function parseAttacks(text, attackType = 'Melee') {
  const rows = [];
  const groups = splitOutside(text, ' or ');
  groups.forEach((groupText, gi) => {
    const attacks = splitOutside(groupText, ' and ').flatMap((a) => splitOutside(a, ', '));
    for (const raw of attacks) {
      const m = raw.match(/^(?:(\d+)\s+)?(.+?)\s+([+-]\d+(?:\/[+-]\d+)*)(?:\s+(touch|ranged touch|melee touch))?\s*(?:\(([^)]*)\))?\s*(.*)$/i);
      if (!m) { rows.push({ name: raw, attackType, group: gi, unread: true }); continue; }
      const count = m[1] ? Number(m[1]) : 1;
      let name = m[2].trim();
      if (count > 1 && SINGULAR[name.toLowerCase()]) name = SINGULAR[name.toLowerCase()];
      else if (count > 1 && /s$/.test(name) && NATURAL.test(name)) name = name.replace(/s$/, '');
      const enh = name.match(/^\+(\d+)\s+(.+)$/);
      const enhancement = enh ? Number(enh[1]) : 0;
      if (enh) name = enh[2];
      const bonuses = m[3].split('/').map(Number);
      const touch = m[4] ? m[4].toLowerCase() : '';
      const dmg = readDamage(m[5] || '');
      rows.push({
        name, attackType, group: gi, count, enhancement, touch: !!touch,
        attack: bonuses[0], attacks: bonuses, text: raw.trim(), natural: NATURAL.test(name),
        ...dmg, trailing: (m[6] || '').trim(),
      });
    }
  });
  return rows;
}

/** "2d6+24/17-20 plus 1d6 cold and grab" as its parts. */
export function readDamage(text) {
  const out = { dice: '', flat: 0, critRange: 1, critMult: 2, riders: [], notes: '' };
  const t = text.trim();
  if (!t) return out;
  const m = t.match(/^(\d+d\d+)?\s*([+-]\s*\d+)?\s*(?:\/\s*(\d+)\s*-\s*(\d+))?\s*(?:\/\s*[x×]\s*(\d))?\s*(?:\/\s*(\d+)\s*-\s*(\d+))?\s*(?:\/\s*[x×]\s*(\d))?\s*(.*)$/i);
  if (!m) { out.notes = t; return out; }
  out.dice = m[1] || '';
  out.flat = m[2] ? signed(m[2]) : 0;
  const lo = m[3] ?? m[6];
  const hi = m[4] ?? m[7];
  if (lo && hi) out.critRange = Math.max(1, Number(hi) - Number(lo) + 1);
  const mult = m[5] ?? m[8];
  if (mult) out.critMult = Number(mult);
  const rest = (m[9] || '').replace(/^plus\s+/i, '').trim();
  if (rest) {
    for (const part of rest.split(/\s+(?:plus|and)\s+|,\s*/i)) {
      const r = part.trim();
      if (!r) continue;
      const rm = r.match(/^(\d+d\d+(?:[+-]\d+)?|\d+)\s+(.+)$/);
      if (rm) out.riders.push({ dice: rm[1], kind: rm[2].trim() });
      else out.notes = out.notes ? `${out.notes}, ${r}` : r;
    }
  }
  return out;
}

/* ---------------- the document ---------------- */

/** The name the sheet's own skill list gives a stat block's spelling. */
function skillRowName(name) {
  const n = name.trim();
  const kn = n.match(/^Knowledge$/i);
  if (kn) return 'Kn.';
  return n;
}

/**
 * Lay a parsed block over a blank sheet. Every number the block states is
 * put where the model will read it; every one the parts do not explain is
 * left to the reconciliation offsets, which is the same bargain an imported
 * workbook gets.
 */
export function monsterDocument(block, options = {}) {
  const b = block;
  const hd = Number(b.hd) || Math.max(1, Number(options.hd) || 1);
  const doc = blankDocument({
    name: b.name || options.name || 'Monster',
    id: options.id,
    level: Math.min(20, Math.max(3, hd)),
    player: options.player ?? 'GM',
    createdAt: options.createdAt,
  });
  doc.source = { ...doc.source, kind: 'monster', title: b.name || doc.identity.name };
  const level = hd;
  doc.identity.level = level;
  doc.identity.race = b.type ? `${b.type[0].toUpperCase()}${b.type.slice(1)}${b.subtypes.length ? ` (${b.subtypes.join(', ')})` : ''}` : doc.identity.race;
  doc.identity.size = SIZES.includes(b.size) ? b.size : 'Medium';
  doc.identity.alignment = b.alignment || null;
  doc.identity.heroPoints = { current: 0, max: 0 };
  doc.identity.specialtyPerks = [];
  doc.raceTraits = [];

  // Ability scores: the block's figure is the whole score, written as 10 plus
  // a racial adjustment -- which, for a monster, is what it is.
  const scores = {};
  for (const k of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
    const v = b.abilities[k];
    const score = Number.isFinite(v) ? v : 10;
    scores[k] = score;
    const mod = abilityMod(score);
    doc.abilities[k] = { ...doc.abilities[k], score, mod, tempScore: score, totalMod: mod, checkMod: mod };
    doc.statsBuild[k] = { ...doc.statsBuild[k], pointBuy: 10, race: score - 10, sheetTotal: score };
  }
  const mod = (k) => abilityMod(scores[k]);

  // The hit dice as a class row, so BAB, saves and hit points come out of the
  // same table a character's do. The progression is chosen to reproduce the
  // block's BAB; a BAB no rate reaches is pinned as an override.
  const bab = Number(b.bab) || 0;
  const rate = [1, 0.75, 0.5, 0].find((r) => Math.floor(r * level) === bab);
  const typeKey = String(b.type || '').toLowerCase();
  const goodSave = (total, ability) => {
    if (total == null) return false;
    const want = total - mod(ability);
    const good = 2 + Math.floor(level / 2);
    const poor = Math.floor(level / 3);
    return Math.abs(want - good) <= Math.abs(want - poor);
  };
  doc.classes = [{
    name: b.type ? `${b.type[0].toUpperCase()}${b.type.slice(1)}` : 'Monster',
    hd: Number(b.hitDie) || 8,
    bab: rate ?? 1,
    goodFort: goodSave(b.fort, 'con'),
    goodRef: goodSave(b.ref, 'dex'),
    goodWill: goodSave(b.will, 'wis'),
    skillRanks: TYPE_RANKS[typeKey] ?? 2,
    archetypes: '',
    levelsOverride: null,
    systems: [],
  }];
  doc.attack.bab = bab;
  if (rate === undefined) doc.attack.babOverride = bab;
  doc.attack.totalMelee = bab + mod('str') - (SIZE_MODIFIERS[doc.identity.size] ?? 0);
  doc.attack.totalRanged = bab + mod('dex') - (SIZE_MODIFIERS[doc.identity.size] ?? 0);
  doc.attack.totalCmb = b.cmb ?? doc.attack.totalMelee;

  // Hit points: the block's total, with Con behind it; the offset takes the
  // difference between a rolled average and the sheet's full dice.
  doc.hp = {
    ...doc.hp, total: Number(b.hp) || doc.hp.total, current: Number(b.hp) || doc.hp.total,
    ability: b.nonabilities.includes('con') ? null : 'Con', initiative: b.init ?? mod('dex'),
  };
  doc.saves.fortitude.total = b.fort ?? 0;
  doc.saves.reflex.total = b.ref ?? 0;
  doc.saves.will.total = b.will ?? 0;
  if (b.nonabilities.includes('con')) doc.saves.fortitude.stat1 = null;

  // AC: the parenthetical becomes the typed bonus columns. Dex and size are
  // the sheet's own to work out; armour and shield go on the Equipment tab
  // so the max-Dex and check-penalty machinery has something to hold.
  const acBonuses = Object.fromEntries(['deflection', 'natural', 'dodge', 'circumstance', 'insight', 'luck', 'morale', 'sacred', 'profane', 'untyped', 'enhancement'].map((k) => [k, 0]));
  const acNotes = [];
  for (const p of b.acParts) {
    const t = p.type.toLowerCase();
    if (/^dex$/.test(t) || /^size$/.test(t)) continue;
    if (/^armor$/.test(t)) {
      doc.equipment.armor = { kind: 'Armor', name: 'Armor', acBonus: p.amount, maxDex: null, acp: 0, type: '', ghostTouch: false, spellFailure: null, others: [], weight: 0, cost: 0, active: true };
      continue;
    }
    if (/^shield$/.test(t)) {
      doc.equipment.shields.push({ kind: 'Shield', name: 'Shield', acBonus: p.amount, maxDex: null, acp: 0, type: '', ghostTouch: false, spellFailure: null, others: [], weight: 0, cost: 0, active: true });
      continue;
    }
    const key = { natural: 'natural', 'natural armor': 'natural', deflection: 'deflection', dodge: 'dodge', circumstance: 'circumstance', insight: 'insight', luck: 'luck', morale: 'morale', sacred: 'sacred', profane: 'profane', untyped: 'untyped', enhancement: 'enhancement' }[t];
    if (key) acBonuses[key] += p.amount;
    else { acBonuses.untyped += p.amount; acNotes.push(`${p.amount >= 0 ? '+' : ''}${p.amount} ${p.type}`); }
  }
  doc.defenses = {
    ...doc.defenses,
    ac: b.ac ?? doc.defenses.ac, touch: b.touch ?? doc.defenses.touch, flatFooted: b.flatFooted ?? doc.defenses.flatFooted,
    cmd: b.cmd ?? doc.defenses.cmd, ffCmd: b.cmd ?? doc.defenses.ffCmd,
    acBonuses: { abpDeflection: 0, abpNatural: 0, enhancedNatural: 0, size: 0, template: 0, sheet: 0, ...acBonuses },
    spellResistance: b.sr || null,
    dr: b.dr || null,
    immunities: b.immune || null,
    resistance: b.resist || null,
    weakness: b.weaknesses || null,
  };
  if (b.nonabilities.includes('dex')) doc.defenses.acStat1 = null;

  doc.identity.speeds = b.speeds.map((s) => ({ type: s.type, base: s.base, bonus: 0 }));

  // Attacks: one weapon row each. The damage bonus is explained from the
  // parts the sheet has -- the ability multiple that fits, the enhancement --
  // and whatever is left goes in Misc, where it can be seen.
  const strMod = mod('str');
  const weapon = (a) => {
    if (a.unread) return null;
    const melee = a.attackType === 'Melee';
    // What the flat damage owes once the enhancement is taken off. A melee
    // attack always carries Strength at some multiple -- the one that leaves
    // the least over is chosen; a ranged one only where a multiple lands
    // exactly (a composite bow, a thrown weapon), and otherwise the figure
    // stays as Misc rather than being explained by a Strength it has not got.
    const owed = a.flat - a.enhancement;
    let damageAbility = null;
    let abilityMult = 1;
    let miscDamage = owed;
    if (melee) {
      let best = null;
      for (const c of [1, 1.5, 0.5, 2]) {
        const left = owed - Math.floor(strMod * c);
        if (best === null || Math.abs(left) < Math.abs(best.left)) best = { mult: c, left };
      }
      damageAbility = 'Str';
      abilityMult = best.mult;
      miscDamage = best.left;
    } else if (owed !== 0) {
      const fit = [1, 0.5, 1.5, 2].find((c) => Math.floor(strMod * c) === owed);
      if (fit) { damageAbility = 'Str'; abilityMult = fit; miscDamage = 0; }
    }
    const special = [
      ...a.riders.map((r) => `[[${r.dice}]] ${r.kind}`),
      a.notes ? `plus ${a.notes}` : '',
      a.trailing,
      a.touch ? 'touch attack' : '',
    ].filter(Boolean).join('; ');
    return {
      name: a.name, attackType: a.attackType, sheetAttack: a.attack, dice: a.dice || '',
      damageAbility, abilityMult, miscDamage, sheetTotalDamage: a.flat,
      critRange: a.critRange, critMult: a.critMult, bonusCritDamage: 0,
      damageType: damageTypeOf(a.name), groups: [], miscAttack: 0, special,
      ammunition: null, size: doc.identity.size, range: null, enhancement: a.enhancement,
      familiarity: a.natural ? 'Natural' : 'Simple', handedness: null, weight: 0, price: 0,
      count: a.count, attackGroup: a.group, natural: a.natural, asWritten: a.text,
      iteratives: a.attacks.length > 1 ? a.attacks : null,
    };
  };
  doc.equipment.weapons = [...b.melee, ...b.ranged].map(weapon).filter(Boolean);

  // Feats, as one group.
  doc.featGroups = [{ name: 'Feats', entries: b.feats.map((f) => ({ name: f.name, detail: f.detail, note: '' })) }];

  // Skills: a listed skill takes the ranks that explain its number (never
  // more than the hit dice) as a class skill; an unlisted one shows its
  // ability modifier alone. Either way the block's own figure is the bonus
  // the row reconciles against.
  const rows = doc.skills;
  const abilityOfRow = (s) => (s.abilities || [])[0];
  const modOfRow = (s) => mod(String(abilityOfRow(s) || 'Int').toLowerCase());
  const used = new Set();
  const listed = [];
  for (const sk of b.skills) {
    if (sk.bonus == null) continue;
    const want = skillRowName(sk.name);
    let row = rows.find((s, i) => !used.has(i) && (
      (want === 'Kn.' && sk.spec && s.name.toLowerCase() === `kn. (${sk.spec.toLowerCase()})`)
      || (want !== 'Kn.' && s.name.toLowerCase() === want.toLowerCase() && (!sk.spec || !s.spec))
    ));
    if (!row) {
      row = {
        name: want === 'Kn.' ? `Kn. (${sk.spec || 'other'})` : want, spec: null, bonus: 0, classSkill: false, totalRanks: 0,
        ranks: {}, requiresTraining: false, armorPenalty: false, abilities: ['Int'], situational: null,
      };
      // A skill the sheet does not list: keyed on the ability the standard
      // list gives its root, or Int where it gives none.
      const std = STANDARD_SKILLS.find((s) => s.name.toLowerCase() === want.toLowerCase());
      if (std) row.abilities = [std.ability];
      rows.push(row);
    } else if (sk.spec && want !== 'Kn.') {
      row.spec = sk.spec;
    }
    used.add(rows.indexOf(row));
    const am = modOfRow(row);
    const ranks = Math.max(0, Math.min(level, sk.bonus - am - 3));
    row.classSkill = ranks > 0;
    row.rankSources = { bought: ranks, gear: false, other: false };
    row.totalRanks = ranks;
    row.bonus = sk.bonus;
    if (sk.note) row.situational = sk.note;
    listed.push(row);
  }
  rows.forEach((s, i) => {
    if (used.has(i)) return;
    s.rankSources = { bought: 0, gear: false, other: false };
    s.bonus = modOfRow(s);
  });

  // The special abilities are what the race hands the creature, and the
  // race-trait rows are prose: a {…} formula in one works like anywhere else.
  doc.raceTraits = b.specialAbilities.map((a) => ({ name: `${a.name} (${a.type})`, text: a.text }));

  // Languages: names on the list, the rest ("telepathy 300 ft.") beside it.
  const langParts = splitOutside(b.languages, ';');
  doc.identity.languages = langParts.length ? splitOutside(langParts[0], ',').map((l) => l.trim()).filter(Boolean) : [];

  doc.monster = normalizeMonster({
    cr: b.cr, xp: b.xp, source: b.source, type: b.type, subtypes: b.subtypes,
    hitDie: Number(b.hitDie) || 8, hpText: b.hpText, healing: b.healing,
    senses: b.senses, aura: b.aura, saveNote: b.saveNote, acNote: [b.acText, ...acNotes].filter(Boolean).join('; '),
    defensiveAbilities: b.defensiveAbilities, space: b.space, reach: b.reach,
    specialAttacks: b.specialAttacks,
    spellLike: b.magic.filter((m) => /spell-like/i.test(m.heading)).map((m) => [m.heading, ...m.lines].join('\n')).join('\n\n'),
    spells: b.magic.filter((m) => !/spell-like/i.test(m.heading)).map((m) => [m.heading, ...m.lines].join('\n')).join('\n\n'),
    cmbNote: b.cmbNote, cmdNote: b.cmdNote,
    racialModifiers: b.racialModifiers, languagesNote: langParts.slice(1).join('; '),
    sq: b.sq, gear: b.gear, environment: b.environment, organization: b.organization, treasure: b.treasure,
    tactics: b.tactics, description: b.description, classLine: b.classLine,
    nonabilities: b.nonabilities, meleeText: b.meleeText, rangedText: b.rangedText,
    unread: b.unread.map((text) => ({ text })), abp: false,
  });

  doc.uiPrefs = { ...(doc.uiPrefs || {}), tabOrder: MONSTER_TAB_ORDER.slice() };
  return doc;
}

/** What the picker and the banner say about a block before it becomes a sheet. */
export function describeBlock(b) {
  const bits = [];
  if (b.cr) bits.push(`CR ${b.cr}`);
  if (b.hd) bits.push(`${b.hd} HD`);
  if (b.ac != null) bits.push(`AC ${b.ac}`);
  if (b.hp != null) bits.push(`${b.hp} hp`);
  const n = (b.melee?.length || 0) + (b.ranged?.length || 0);
  if (n) bits.push(`${n} attack${n === 1 ? '' : 's'}`);
  if (b.feats?.length) bits.push(`${b.feats.length} feat${b.feats.length === 1 ? '' : 's'}`);
  if (b.skills?.length) bits.push(`${b.skills.length} skill${b.skills.length === 1 ? '' : 's'}`);
  if (b.specialAbilities?.length) bits.push(`${b.specialAbilities.length} special abilit${b.specialAbilities.length === 1 ? 'y' : 'ies'}`);
  return bits.join(' · ');
}
