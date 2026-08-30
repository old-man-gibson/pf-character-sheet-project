/**
 * ui/palette.js -- the search palette: one box that finds anything on the
 * character and takes you to it.
 *
 * A sheet here runs to twenty-odd tabs and several thousand fields, and the
 * tab bar is the only way through them. Knowing a feat is *somewhere* on
 * Feats & Mythic is not the same as finding it, and "what is my Disguise
 * modifier" should not cost a tab switch and a scan down a table of sixty
 * rows. So: Ctrl+K, three letters, Enter.
 *
 * Two halves, and the split is the point.
 *
 *   buildIndex(model, ctx)      the character flattened into rows -- one per
 *                               skill, weapon, feat, veil, spell, tracker,
 *                               progression cell, note, tab and command.
 *                               Plain data: no element, no DOM, no listeners.
 *   searchIndex(index, query)   scores that index against what has been typed
 *                               and hands back the best of it in order.
 *
 * The element (sheet-element.js) owns everything else -- the overlay's node,
 * its listeners, and what "jump" and "roll" actually do. That is what keeps
 * the palette off the render path: `#render()` rewrites the whole shadow root,
 * and a search box rebuilt on every keystroke is not a search box. The
 * Formulas tab learned this first (see `#bindFormulas`), and this goes
 * further -- typing here touches the results list and nothing else.
 *
 * What an entry carries, and why:
 *
 *   tab       which tab to switch to
 *   expand    the collapsible section it hides inside, if any -- a collapsed
 *             panel renders none of its rows, so the jump has to open it first
 *   sel/text  how to find it once the tab is up: a selector where the panel
 *             writes a stable attribute (`data-item="skills|3|…"`), else the
 *             text to look for. Panels are free to change their markup; the
 *             text fallback keeps the jump working when they do
 *   roll      kind and ref for roll20.js, on the rows that can be rolled
 *   action    a `data-action` name, for the command rows
 *
 * Nothing in here writes to the character. A palette that could edit by
 * accident is a palette nobody trusts at the table.
 */
import { esc } from './html.js';
import { fmt, ABILITIES, ABILITY_LABELS } from '../rules.js';
import { rollSpec } from '../roll20.js';

/* ---------------- kinds ---------------- */

/**
 * Every kind of row the palette can show: the badge it wears, and how far up
 * the list it starts.
 *
 * The nudge is deliberately small. A text match is worth hundreds and this is
 * worth tens, so it never overrules what was typed -- it only breaks the tie
 * between two rows that match it equally well, and there it says a skill is a
 * likelier target than a line of a worksheet.
 */
const KINDS = {
  stat: ['Stat', 12],
  skill: ['Skill', 12],
  weapon: ['Weapon', 12],
  tracker: ['Tracker', 11],
  command: ['Command', 10],
  tab: ['Tab', 10],
  feat: ['Feat', 10],
  talent: ['Talent', 9],
  veil: ['Veil', 9],
  spell: ['Spell', 9],
  power: ['Power', 9],
  maneuver: ['Maneuver', 9],
  card: ['Card', 8],
  technique: ['Technique', 8],
  condition: ['Condition', 8],
  buff: ['Buff', 8],
  gear: ['Gear', 8],
  class: ['Class', 8],
  companion: ['Companion', 8],
  sphere: ['Sphere', 7],
  feature: ['Feature', 7],
  progression: ['Progression', 6],
  dish: ['Dish', 6],
  note: ['Note', 5],
  lore: ['Lore', 5],
  sheet: ['Sheet', 2],
};

export const kindLabel = (kind) => KINDS[kind]?.[0] || kind;
const kindWeight = (kind) => KINDS[kind]?.[1] ?? 5;

/**
 * The leader characters that narrow the search to one kind, the way an editor's
 * palette does. Typed alone they are a menu: `>` lists every command.
 */
const SCOPES = {
  '>': { kinds: ['command'], label: 'Commands' },
  '#': { kinds: ['tab'], label: 'Tabs' },
};

/* ---------------- small helpers ---------------- */

const text = (v) => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * One line of at most `n` characters, for a subtitle built from prose.
 *
 * Anything that is not already text is dropped rather than stringified: a
 * field that turns out to hold an object (a discipline's notes are keyed by
 * maneuver) would otherwise put "[object Object]" on the row.
 */
const clip = (v, n = 120) => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** A list of subtitle pieces, with the empty ones dropped. */
const bits = (...parts) => parts.map((p) => text(p)).filter(Boolean).join(' · ');

/** Rows come in as strings on some sheets and as `{name}` on others. */
const nameOf = (x) => (typeof x === 'string' ? text(x) : text(x?.name));

const skillTitle = (s) => (text(s?.spec) ? `${text(s.name)} (${text(s.spec)})` : text(s?.name));

/* ---------------- the index ---------------- */

/**
 * Flatten a character into searchable rows.
 *
 * `ctx.tabs` is the element's own `#tabEntries()`: every tab the sheet could
 * show, including the player's renamed worksheets, so an entry can say where
 * it lives in the words the player sees rather than in tab ids.
 *
 * Cost is a few milliseconds on the heaviest character in the roster, which is
 * why this is built when the palette opens rather than kept in step with every
 * edit -- one build per opening is cheaper than one per keystroke, and it can
 * never be stale.
 */
export function buildIndex(model, { tabs = [], isAdmin = false } = {}) {
  const rows = [];
  const labels = new Map(tabs.map((t) => [t.id, t.label]));
  const ctx = { tabs, labels, isAdmin, cs: model.conditionState };

  /**
   * Add one row. Everything is optional but the kind and the title; a row with
   * no title is a cell nobody filled in, and is dropped rather than shown as
   * an empty line.
   */
  const add = (entry) => {
    const title = text(entry.title);
    if (!title) return;
    const tab = entry.tab || 'overview';
    // A roll is offered only where roll20.js can actually build one, so the
    // button never promises a roll that turns out not to exist.
    const roll = entry.roll && rollSpec(model.data, entry.roll.kind, entry.roll.ref, ctx.cs)
      ? entry.roll : null;
    const row = {
      id: `${entry.kind}:${tab}:${title.toLowerCase()}`,
      order: rows.length,
      kind: entry.kind,
      title,
      sub: text(entry.sub),
      value: text(entry.value),
      where: entry.kind === 'tab' || entry.kind === 'command' ? '' : (labels.get(tab) || ''),
      tab,
      expand: entry.expand || null,
      sel: entry.sel ? [].concat(entry.sel) : null,
      find: entry.find === undefined ? title : entry.find,
      roll,
      action: entry.action || null,
      start: !!entry.start,
    };
    // One folded string per field, so a keystroke is three lowercase scans and
    // no allocation. `keys` carries what a player might type that is nowhere
    // in the words on screen: the kind, the tab, an alias.
    row.hayTitle = title.toLowerCase();
    row.haySub = `${row.where} ${row.sub}`.toLowerCase();
    row.hayKeys = `${kindLabel(entry.kind)} ${text(entry.keys)}`.toLowerCase();
    rows.push(row);
  };

  for (const source of SOURCES) source(model, add, ctx);
  return rows;
}

/* ---------------- where the rows come from ---------------- */

/**
 * The numbers a table asks for out loud. These lead the index because they
 * lead the questions: an empty palette opens on them.
 */
function vitals(model, add) {
  const c = model.data;
  const hp = model.hpState;
  const d = c.defenses;
  const a = c.attack;

  add({
    kind: 'stat', title: 'Hit points', tab: 'overview', start: true,
    value: `${hp.current}/${hp.max}`,
    sub: bits(hp.temp ? `${hp.temp} temporary` : '', hp.nonlethal ? `${hp.nonlethal} nonlethal` : '',
      `dies at ${hp.deathAt}`),
    keys: 'hp health wounds damage',
    find: 'Hit points',
  });
  add({
    kind: 'stat', title: 'Armor Class', tab: 'overview', start: true, value: String(d.ac),
    sub: bits(`touch ${d.touch}`, `flat-footed ${d.flatFooted}`, d.acStat1 ? `on ${d.acStat1}` : ''),
    keys: 'ac defense armour touch flat footed',
  });
  add({
    kind: 'stat', title: 'CMD', tab: 'overview', start: true, value: String(d.cmd),
    sub: bits(`flat-footed ${d.ffCmd}`), keys: 'combat maneuver defense',
  });
  add({
    kind: 'stat', title: 'Initiative', tab: 'overview', start: true,
    value: fmt(c.hp?.initiative ?? 0), sub: bits(text(c.hp?.initAbility) && `on ${text(c.hp.initAbility)}`),
    roll: { kind: 'initiative', ref: 'self', what: 'initiative' }, keys: 'init',
  });
  add({
    kind: 'stat', title: 'Base attack bonus', tab: 'overview', start: true,
    value: fmt(a.bab), sub: bits(a.iterative && `iteratives ${a.iterative}`), keys: 'bab',
  });
  for (const [key, label, total] of [
    ['melee', 'Melee attack', a.totalMelee],
    ['ranged', 'Ranged attack', a.totalRanged],
    ['cmb', 'Combat maneuver bonus', a.totalCmb],
  ]) {
    add({
      kind: 'stat', title: label, tab: 'overview', start: true, value: fmt(total),
      sub: bits(c.attack.modes?.[key]?.stat1 && `on ${c.attack.modes[key].stat1}`),
      roll: { kind: 'mode', ref: key }, keys: key === 'cmb' ? 'cmb maneuver' : key,
    });
  }
  for (const [key, label] of [['fortitude', 'Fortitude'], ['reflex', 'Reflex'], ['will', 'Will']]) {
    const s = c.saves?.[key];
    if (!s) continue;
    add({
      kind: 'stat', title: `${label} save`, tab: 'overview', start: true, value: fmt(s.total),
      sub: bits(`base ${s.base}`, s.stat1 && `on ${s.stat1}`), roll: { kind: 'save', ref: key },
      keys: 'saving throw', find: label,
    });
  }
  for (const key of ABILITIES) {
    const ab = c.abilities?.[key];
    if (!ab) continue;
    add({
      kind: 'stat', title: ABILITY_LABELS[key], tab: 'stats', start: true,
      value: `${ab.tempScore ?? ab.score} (${fmt(ab.totalMod ?? ab.mod)})`,
      sub: bits(ab.tempScore !== ab.score ? `base ${ab.score}` : '', 'ability score'),
      roll: { kind: 'ability', ref: key }, keys: `${key} ability score modifier`,
    });
  }
  for (const sp of c.identity?.speeds || []) {
    if (!(Number(sp.final) || 0)) continue;
    add({
      kind: 'stat', title: `${text(sp.type) || 'Movement'} speed`, tab: 'overview',
      value: `${sp.final} ft.`, sub: bits(sp.bonus ? `base ${sp.base}` : ''), keys: 'move speed',
      find: text(sp.type),
    });
  }
  const carry = c.carry;
  if (carry) {
    add({
      kind: 'stat', title: 'Carrying capacity', tab: 'gear',
      value: `${carry.carried ?? 0} lb.`,
      sub: bits(`light ${carry.light}`, `medium ${carry.medium}`, `heavy ${carry.heavy}`),
      keys: 'weight load encumbrance',
    });
  }
  // The five defence boxes, as they currently stand rather than as they were
  // typed: they read {…} and take forwarded bonuses, so the raw text may be a
  // formula and is not what a reader searching for "DR" wants back.
  const dk = d?.calc || {};
  for (const [field, label, resolved] of [
    ['spellResistance', 'Spell resistance', dk.sr?.text], ['dr', 'Damage reduction', dk.drText],
    ['resistance', 'Resistances', dk.resistanceText], ['immunities', 'Immunities', dk.immunitiesText],
    ['weakness', 'Weaknesses', dk.weaknessText],
  ]) {
    const shown = text(resolved) || text(d?.[field]);
    if (!shown) continue;
    add({ kind: 'stat', title: label, tab: 'overview', value: clip(shown, 40), keys: 'defense' });
  }
  const hero = c.identity?.heroPoints;
  if (hero && (Number(hero.max) || Number(hero.current))) {
    add({
      kind: 'tracker', title: 'Hero points', tab: 'overview',
      value: `${hero.current ?? 0}/${hero.max ?? 0}`, keys: 'hero point',
    });
  }
}

/** Who the character is: the header fields, and the lines under the portrait. */
function identity(model, add) {
  const i = model.data.identity || {};
  const pairs = [
    ['Name', i.name], ['Player', i.player], ['Race', i.race], ['Size', i.size],
    ['Alignment', i.alignment], ['Deity', i.deity], ['Specialty', i.specialty],
    ['Guild', i.guild], ['Age', i.age], ['Height', i.height], ['Weight', i.weight],
    ['Gender', i.gender],
  ];
  for (const [label, value] of pairs) {
    if (!text(value)) continue;
    add({
      kind: 'stat', title: label, tab: 'overview', value: clip(value, 40), keys: 'identity',
      find: text(value),
    });
  }
  if (text(i.mythicPath)) {
    add({
      kind: 'stat', title: 'Mythic path', tab: 'features', value: `${text(i.mythicPath)} ${i.mythicTier || 0}`,
      keys: 'mythic tier path',
    });
  }
  for (const lang of i.languages || []) {
    if (!text(lang)) continue;
    add({ kind: 'lore', title: text(lang), sub: 'Language', tab: 'overview', keys: 'language' });
  }
  const prof = i.proficiencies || {};
  for (const [field, label] of [
    ['weapons', 'Weapon proficiency'], ['armor', 'Armor proficiency'],
    ['shields', 'Shield proficiency'], ['groups', 'Weapon group'],
    ['familiarities', 'Familiarity'], ['handedness', 'Handedness'],
  ]) {
    for (const p of prof[field] || []) {
      if (!text(p)) continue;
      add({ kind: 'gear', title: text(p), sub: label, tab: 'gear', keys: 'proficient proficiency' });
    }
  }
}

/** The classes, and the archetypes riding on them. */
function classes(model, add) {
  (model.data.classes || []).forEach((cl, i) => {
    if (!text(cl.name)) return;
    add({
      kind: 'class', title: text(cl.name), tab: 'overview',
      value: cl.gestaltLevels ? `Lv ${cl.gestaltLevels}` : '',
      sub: bits(cl.hd && `d${cl.hd}`, text(cl.archetypes) && `archetype: ${text(cl.archetypes)}`,
        [cl.goodFort && 'Fort', cl.goodRef && 'Ref', cl.goodWill && 'Will'].filter(Boolean).join('/')),
      sel: `[data-item^="classes|${i}|"]`, keys: 'class level',
    });
    for (const arch of text(cl.archetypes).split(/\s*[,;]\s*/)) {
      if (!arch) continue;
      add({
        kind: 'class', title: arch, sub: `Archetype · ${text(cl.name)}`, tab: 'overview',
        sel: `[data-item^="classes|${i}|"]`, keys: 'archetype',
      });
    }
  });
}

/** Every skill, with the number the question is usually about. */
function skills(model, add) {
  (model.data.skills || []).forEach((s, i) => {
    const title = skillTitle(s);
    if (!title) return;
    add({
      kind: 'skill', title, tab: 'skills', value: fmt(s.bonus),
      sub: bits((s.abilities || []).filter(Boolean).join('/'),
        `${s.totalRanks || 0} rank${s.totalRanks === 1 ? '' : 's'}`,
        s.classSkill ? 'class skill' : '', s.requiresTraining ? 'trained only' : '',
        clip(s.situational, 60)),
      sel: `[data-item^="skills|${i}|"]`, roll: { kind: 'skill', ref: i, what: `a ${title} check` },
      keys: 'skill check',
    });
  });
}

/** Weapons, armor, and everything hanging off a slot. */
function equipment(model, add) {
  const e = model.data.equipment || {};
  (e.weapons || []).forEach((w, i) => {
    if (!text(w.name)) return;
    add({
      kind: 'weapon', title: text(w.name), tab: 'gear',
      value: bits(fmt(w.attackTotal ?? w.sheetAttack), text(w.dice)),
      sub: bits(text(w.attackType), text(w.damageType), text(w.special),
        w.critRange ? `${w.critRange === 20 ? '20' : `${w.critRange}-20`}/${text(w.critMult) || 'x2'}` : ''),
      sel: `[data-item^="equipment.weapons|${i}|"]`,
      roll: { kind: 'weapon', ref: i, what: `${text(w.name)} — attack and damage` },
      keys: 'weapon attack damage',
    });
  });
  const armor = e.armor;
  if (text(armor?.name)) {
    add({
      kind: 'gear', title: text(armor.name), tab: 'gear', value: armor.acBonus ? fmt(armor.acBonus) : '',
      sub: bits('Armor', text(armor.type), armor.maxDex !== null && armor.maxDex !== undefined ? `max Dex ${armor.maxDex}` : '',
        armor.acp ? `ACP ${armor.acp}` : ''),
      keys: 'armor worn',
    });
  }
  (e.shields || []).forEach((sh) => {
    if (!text(sh.name)) return;
    add({
      kind: 'gear', title: text(sh.name), tab: 'gear', value: sh.acBonus ? fmt(sh.acBonus) : '',
      sub: bits('Shield', text(sh.type)), keys: 'shield',
    });
  });
  for (const [list, label] of [['gear', 'Worn'], ['other', 'Carried']]) {
    (e[list] || []).forEach((g) => {
      if (!text(g.name)) return;
      add({
        kind: 'gear', title: text(g.name), tab: 'gear',
        value: g.weight ? `${g.weight} lb.` : '',
        sub: bits(text(g.slot) || label,
          (g.bonuses || []).filter((b) => b && b.value).map((b) => `${fmt(b.value)} ${text(b.type)}`).join(', '),
          (g.others || []).filter(Boolean).map((x) => clip(x, 30)).join(', ')),
        keys: 'item gear equipment',
      });
    });
  }
  for (const p of model.data.crafting?.projects || []) {
    if (!text(p.name)) continue;
    add({
      kind: 'gear', title: text(p.name), sub: bits('Crafting project', text(p.buyerName)),
      value: text(p.value), tab: 'crafting', keys: 'craft project',
    });
  }
}

/** Feats, traits, and the things that read like them. */
function feats(model, add) {
  const c = model.data;
  (c.featGroups || []).forEach((group, g) => {
    (group.entries || []).forEach((f, i) => {
      if (!text(f.name)) return;
      add({
        kind: 'feat', title: text(f.name), tab: 'features',
        sub: bits(text(group.name), text(f.detail) && `level ${text(f.detail)}`),
        sel: `[data-item^="featGroups.${g}.entries|${i}|"]`, keys: 'feat',
      });
    });
  });
  const granted = c.grantedFeats || {};
  for (const [key, label] of [['drawback', 'From a drawback'], ['specialty', 'From your specialty']]) {
    if (!text(granted[key]?.name)) continue;
    add({
      kind: 'feat', title: text(granted[key].name), tab: 'features',
      sub: bits(label, clip(granted[key].note, 60)), keys: 'granted feat',
    });
  }
  (granted.others || []).forEach((f, i) => {
    if (!text(f.name)) return;
    add({
      kind: 'feat', title: text(f.name), tab: 'features',
      sub: bits('Granted', text(f.source), clip(f.note, 60)),
      sel: `[data-item^="grantedFeats.others|${i}|"]`, keys: 'granted feat bonus',
    });
  });
  const slots = c.traitSlots || {};
  for (const [key, slot] of Object.entries(slots)) {
    if (key === 'additional' || !slot || typeof slot !== 'object') continue;
    const title = text(slot.name) || clip(slot.text, 50);
    if (!title) continue;
    add({
      kind: 'feat', title, tab: 'features',
      sub: bits(/drawback/i.test(key) ? 'Drawback' : 'Trait', text(slot.category), clip(slot.text, 70)),
      keys: 'trait drawback',
    });
  }
  (slots.additional || []).forEach((t, i) => {
    const title = text(t.name) || clip(t.text, 50);
    if (!title) return;
    add({
      kind: 'feat', title, tab: 'features', sub: bits('Trait', text(t.category), clip(t.text, 70)),
      sel: `[data-item^="traitSlots.additional|${i}|"]`, keys: 'trait',
    });
  });
  (c.raceTraits || []).forEach((t, i) => {
    const title = nameOf(t);
    if (!title) return;
    add({
      kind: 'feat', title, tab: 'overview',
      sub: bits('Race trait', clip(typeof t === 'string' ? '' : t.text, 80)),
      sel: `[data-item^="raceTraits|${i}|"]`, keys: 'racial trait',
    });
  });
  for (const a of c.mythic?.baseAbilities || []) {
    const title = nameOf(a);
    if (!title) continue;
    add({ kind: 'feat', title, sub: 'Mythic base ability', tab: 'features', keys: 'mythic' });
  }
  (c.mythic?.abilities || []).forEach((a, i) => {
    if (!text(a.name)) return;
    add({
      kind: 'feat', title: text(a.name), tab: 'features',
      sub: bits('Mythic', text(a.path), text(a.slot), a.level ? `level ${a.level}` : '',
        clip(a.effect, 60)),
      sel: `[data-item^="mythic.abilities|${i}|"]`, keys: 'mythic path ability',
    });
    if (text(a.featChoice)) {
      add({
        kind: 'feat', title: text(a.featChoice), tab: 'features',
        sub: bits('Mythic feat', text(a.path)), keys: 'mythic feat',
      });
    }
  });
  const trad = c.mythic?.tradition;
  if (trad) {
    for (const [key, value] of Object.entries(trad)) {
      // `notes` is the map of one note per slot, not a slot of its own.
      if (key === 'notes' || !text(value)) continue;
      add({
        kind: 'feat', title: text(value), tab: 'features',
        sub: bits('Mythic tradition', key.replace(/(\d)$/, ' $1'), text(trad.notes?.[key])),
        keys: 'tradition boon drawback',
      });
    }
  }
}

/**
 * Spheres of Guile, which the loop above cannot walk with the other two.
 *
 * Its class rows carry two talent slots rather than one, its tradition rows
 * have no drawbacks to list, and its sphere rows are searchable by the skill
 * they are associated with as well as by name -- "which sphere is my
 * Disguise?" is a question only this system's tab can answer.
 */
function guileSpheres(model, add) {
  const g = model.data.training?.guile;
  if (!g) return;
  for (const row of g.sphereRows || []) {
    if (!text(row.sphere)) continue;
    add({
      kind: 'sphere', title: text(row.sphere), tab: 'guile',
      value: row.dc == null ? '' : `DC ${row.dc}`,
      sub: bits('Skill sphere', text(row.package), text(row.skill),
        row.talents ? `${row.talents} talent${row.talents === 1 ? '' : 's'}` : ''),
      keys: `sphere guile skill ${text(row.skill)}`,
    });
  }
  for (const cl of g.classes || []) {
    for (const lv of cl.levels || []) {
      for (const [talent, sphere, kind] of [[lv.talent, lv.sphere, ''],
        [lv.utilityTalent, lv.utilitySphere, '[utility]']]) {
        if (!text(talent)) continue;
        add({
          kind: 'talent', title: text(talent), tab: 'guile',
          sub: bits(text(sphere), kind, text(cl.name), lv.level ? `level ${lv.level}` : ''),
          keys: 'talent guile skill',
        });
      }
    }
  }
  for (const [rows, what] of [[g.bonusTalents || [], 'Bonus talent'],
    [g.tradition?.entries || [], 'Trade tradition']]) {
    for (const e of rows) {
      if (!text(e.talent)) continue;
      add({
        kind: 'talent', title: text(e.talent), tab: 'guile',
        sub: bits(text(e.sphere), what, text(e.source), e.utility ? '[utility]' : ''),
        keys: 'talent guile skill',
      });
    }
  }
}

/** Spheres of Power and of Might: the talents, the traditions, the numbers. */
function spheres(model, add) {
  const t = model.data.training || {};
  for (const [side, tab, label] of [['combat', 'martial', 'Combat sphere'], ['magic', 'magic', 'Magic sphere']]) {
    const s = t[side];
    if (!s) continue;
    for (const row of s.sphereRows || []) {
      const name = text(row.sphere);
      // The workbook's own header row rides along in this list; it names no
      // sphere anybody trained in and would only ever be noise here.
      if (!name || name.toLowerCase() === 'sphere' || !(row.talents || row.rankBonus || row.clBonus || row.dcBonus)) continue;
      add({
        kind: 'sphere', title: name, tab, value: side === 'magic' ? `CL ${row.cl ?? ''}` : fmt(row.attack ?? 0),
        sub: bits(label, row.talents ? `${row.talents} talent${row.talents === 1 ? '' : 's'}` : '',
          row.dc ? `DC ${row.dc}` : ''),
        keys: `sphere ${side}`,
      });
    }
    for (const list of ['bonusTalents', 'tradition']) {
      const entries = list === 'tradition' ? (s.tradition?.entries || []) : (s[list] || []);
      for (const e of entries) {
        if (!text(e.talent)) continue;
        add({
          kind: 'talent', title: text(e.talent), tab,
          sub: bits(text(e.sphere), list === 'tradition' ? 'Tradition talent' : 'Bonus talent', text(e.source)),
          keys: `talent ${side}`,
        });
      }
    }
    for (const cl of s.classes || []) {
      for (const lv of cl.levels || []) {
        if (!text(lv.talent)) continue;
        add({
          kind: 'talent', title: text(lv.talent), tab,
          sub: bits(text(lv.sphere), text(cl.name), lv.level ? `level ${lv.level}` : ''),
          keys: 'talent',
        });
      }
    }
    for (const [field, what] of [['drawbacks', 'Tradition drawback'], ['boughtOff', 'Bought off'],
      ['boons', 'Tradition boon']]) {
      for (const d of s.tradition?.[field] || []) {
        const title = nameOf(d);
        if (!title) continue;
        add({ kind: 'talent', title: clip(title, 70), sub: bits(what, side), tab, keys: 'tradition drawback boon' });
      }
    }
  }
  guileSpheres(model, add);
  // A customized weapon is a thing with a name and a talent list of its own,
  // and both are worth finding: "which one has Reach on it?"
  for (const block of t.combat?.customizations || []) {
    for (const set of block.sets || []) {
      if (text(set.weapon)) {
        add({
          kind: 'weapon', title: text(set.weapon), tab: 'martial', expand: 'customized-weapons',
          sub: bits('Customized weapon', text(block.className), set.spare ? 'spare' : ''),
          keys: 'customization customized weapon',
        });
      }
      for (const row of set.talents || []) {
        if (!text(row.talent)) continue;
        add({
          kind: 'talent', title: text(row.talent), tab: 'martial', expand: 'customized-weapons',
          sub: bits(text(row.sphere), text(set.weapon), text(block.className)),
          keys: 'customization talent',
        });
      }
    }
  }
}

/** Veils, their chakras, and the akashic classes wearing them. */
function akashic(model, add) {
  const a = model.data.akashic;
  if (!a) return;
  const veilRow = (v, where) => {
    if (!text(v.name)) return;
    add({
      kind: 'veil', title: text(v.name), tab: 'akashic',
      value: v.essence ? `${v.essence} essence` : '',
      sub: bits(where, v.dc ? `DC ${v.dc}` : '', clip(v.desc, 70)), keys: 'veil chakra shape',
    });
  };
  for (const slot of a.slots || []) {
    for (const v of slot.veils || []) veilRow(v, bits(`${text(slot.slot)} veil`, slot.bound ? 'bound' : '', slot.twinveil ? 'twinveil' : ''));
  }
  for (const k of a.kheshig || []) {
    for (const v of k.veils || []) veilRow(v, bits(text(k.label) || 'Kheshig', text(k.slot)));
  }
  for (const r of a.otherReceptacles || []) {
    if (!text(r.name)) continue;
    add({
      kind: 'veil', title: text(r.name), tab: 'akashic', value: r.essence ? `${r.essence} essence` : '',
      sub: bits('Other receptacle', r.active ? 'active' : ''), keys: 'receptacle essence',
    });
  }
  for (const cl of a.classes || []) {
    if (!text(cl.name)) continue;
    add({
      kind: 'class', title: text(cl.name), tab: 'akashic',
      value: cl.level ? `Lv ${cl.level}` : '',
      sub: bits('Akashic class', cl.essenceCap ? `essence cap ${cl.essenceCap}` : '', cl.baseDC ? `DC ${cl.baseDC}` : ''),
      keys: 'akashic veilweaver',
    });
  }
}

/** Path of War: what is readied, and the whole discipline behind it. */
function maneuvers(model, add) {
  for (const disc of model.data.maneuvers?.disciplines || []) {
    const dname = text(disc.name);
    if (dname) {
      add({
        kind: 'maneuver', title: dname, tab: 'maneuvers',
        value: `${(disc.entries || []).filter((e) => e.known).length} known`,
        sub: bits('Discipline', disc.inCatalogue ? '' : 'not in the catalogue', clip(disc.notes, 50)),
        keys: 'discipline',
      });
    }
    for (const e of disc.entries || []) {
      if (!text(e.name)) continue;
      add({
        kind: 'maneuver', title: text(e.name), tab: 'maneuvers',
        value: e.known ? 'known' : '',
        sub: bits(dname, text(e.type) || text(e.kind), e.level ? `level ${e.level}` : ''),
        keys: `maneuver stance ${e.known ? 'known readied' : ''}`,
      });
    }
  }
}

/** Vancian casting: the classes, and every spell on the list. */
function vancian(model, add) {
  const v = model.data.vancian;
  if (!v) return;
  (v.classes || []).forEach((cl, i) => {
    if (!text(cl.name)) return;
    add({
      kind: 'class', title: text(cl.name), tab: 'vancian',
      value: cl.concentration ? `concentration ${fmt(cl.concentration)}` : '',
      sub: bits('Vancian caster', text(cl.slotType), text(cl.stat)),
      roll: { kind: 'concentration', ref: `vancian:${i}`, what: `${text(cl.name)} concentration` },
      keys: 'caster class spell slots',
    });
  });
  (v.prepared || []).forEach((row, i) => {
    if (!text(row.name)) return;
    add({
      kind: 'spell', title: text(row.name), tab: 'vancian',
      value: Number(row.uses) ? `${row.left ?? row.uses}/${row.uses}` : '',
      sub: bits(text(row.classLevel), text(row.prepUsed), clip(row.note, 60)),
      sel: `[data-item^="vancian.prepared|${i}|"]`, keys: 'spell prepared',
    });
  });
}

/** Psionics: the manifesters and their powers. */
function psionics(model, add) {
  const p = model.data.psionics;
  if (!p) return;
  (p.classes || []).forEach((cl) => {
    if (text(cl.name)) {
      add({
        kind: 'class', title: text(cl.name), tab: 'psionics',
        value: cl.curveTotal ? `${cl.curveTotal} pp` : '',
        sub: bits('Manifester', text(cl.stat)), keys: 'psionic manifester',
      });
    }
    for (const power of cl.powers || []) {
      if (!text(power.name)) continue;
      add({
        kind: 'power', title: text(power.name), tab: 'psionics',
        value: power.level !== undefined && power.level !== null ? `level ${power.level}` : '',
        sub: bits(text(cl.name), 'Power'), keys: 'psionic power manifest',
      });
    }
  });
  if (Number(p.pool)) {
    add({
      kind: 'tracker', title: 'Power points', tab: 'psionics',
      value: `${p.left ?? 0}/${p.pool}`, keys: 'pp pool psionic',
    });
  }
}

/** Cardcasting: the deck, the sideboard and the manipulations. */
function cardcasting(model, add) {
  const cc = model.data.cardcasting;
  if (!cc) return;
  for (const [list, where] of [['cards', 'Deck'], ['sideboard', 'Sideboard']]) {
    for (const card of cc[list] || []) {
      if (!text(card.name)) continue;
      add({
        kind: 'card', title: text(card.name), tab: 'cardcasting',
        value: bits(text(card.cost) && `cost ${text(card.cost)}`, card.qty > 1 ? `×${card.qty}` : ''),
        sub: bits(where, text(card.sphere), text(card.effect), text(card.suit), text(card.alignment)),
        keys: 'card deck cast',
      });
    }
  }
  for (const m of cc.manipulations || []) {
    const title = nameOf(m);
    if (!title) continue;
    add({
      kind: 'card', title, tab: 'cardcasting', sub: bits('Manipulation', clip(m.text || m.effect, 70)),
      keys: 'manipulation',
    });
  }
}

/** Techniques and dishes: the two builders that name their own results. */
function techniques(model, add) {
  for (const t of model.data.techniques?.catalogue || []) {
    if (!text(t.name)) continue;
    add({
      kind: 'technique', title: bits(text(t.prepend1), text(t.name)) || text(t.name), tab: 'techniques',
      sub: bits('Technique', (t.combatSpheres || []).filter(Boolean).join(', '),
        (t.magicSpheres || []).filter(Boolean).join(', ')),
      find: text(t.name), keys: 'technique',
    });
  }
  const draft = model.data.techniques?.draft;
  if (text(draft?.name)) {
    add({
      kind: 'technique', title: text(draft.name), sub: 'AutoTechnique draft', tab: 'autoTechnique',
      keys: 'technique draft',
    });
  }
  const cooking = model.data.cooking || {};
  for (const [course, list] of Object.entries(cooking)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!text(item)) continue;
      add({
        kind: 'dish', title: text(item), tab: 'cooking', sub: bits('Cooking', course),
        keys: 'cooking dish ingredient',
      });
    }
  }
}

/** Trackers, resources, buffs, conditions -- the things that move in play. */
function trackers(model, add) {
  const c = model.data;
  for (const t of c.customTrackers || []) {
    if (!text(t.name)) continue;
    add({
      kind: 'tracker', title: text(t.name), tab: 'trackers', start: true,
      value: `${t.current ?? 0}/${t.max ?? 0}`,
      sub: bits(text(t.refresh), text(t.source), clip(t.note, 60), t.error ? `formula error: ${t.error}` : ''),
      sel: `[data-tracker-current="${t.id}"]`, keys: 'tracker pool uses',
    });
  }
  (c.resources || []).forEach((r, i) => {
    if (!text(r.name)) return;
    add({
      kind: 'tracker', title: text(r.name), tab: 'overview',
      value: `${(Number(r.total) || 0) - (Number(r.uses) || 0)}/${r.total ?? 0}`,
      sub: bits('Resource', text(r.refresh)), sel: `[data-item^="resources|${i}|"]`,
      keys: 'resource uses',
    });
  });
  (c.buffs || []).forEach((b, i) => {
    if (!text(b.name)) return;
    add({
      kind: 'buff', title: text(b.name), tab: 'overview', expand: 'buffs',
      value: b.on ? 'on' : 'off',
      sub: bits('Buff', clip(b.note || b.summary, 70)),
      sel: `[data-action="buff-open"][data-index="${i}"]`, keys: 'buff effect',
    });
  });
  (c.effects || []).forEach((e, i) => {
    const title = text(e.name) || clip(e.text, 50);
    if (!title) return;
    add({
      kind: 'buff', title, tab: 'overview', sub: bits('Effect', clip(e.text, 70)),
      sel: `[data-item^="effects|${i}|"]`, keys: 'effect note',
    });
  });
  for (const [name, value] of Object.entries(c.conditions || {})) {
    add({
      kind: 'condition', title: name, tab: 'overview', value: value ? String(value) : '',
      sub: value ? 'Currently on' : 'Condition', keys: `condition ${value ? 'active on' : ''}`,
    });
  }
}

/**
 * The progression ladder: every feature cell a player has written, and the
 * notes under each class's grid.
 *
 * These are the rows the tab bar hides best -- a gambit picked at 17th level
 * is three clicks and a scroll away -- so they carry the collapse key of the
 * group they sit in, and the jump opens it.
 */
function progression(model, add) {
  const p = model.data.progression;
  if (!p) return;
  const names = new Set([...model.progressionClasses(), ...Object.keys(p.classFeatures || {})]);
  for (const name of names) {
    const group = p.classFeatures?.[name];
    if (!group) continue;
    for (const row of model.classFeatureRows(name)) {
      for (const [col, cell] of Object.entries(row.cells || {})) {
        for (const field of cell.fields || []) {
          if (!text(field.text)) continue;
          add({
            kind: 'progression', title: clip(field.text, 80), tab: 'progression',
            expand: `progfeat-${name}`,
            sub: bits(`${name} Lv ${row.level}`, col, field.group?.name),
            find: text(field.text), keys: 'progression class feature level',
          });
        }
      }
    }
    for (const note of model.classFeatureNotes(name) || []) {
      if (!text(note.name)) continue;
      add({
        kind: 'feature', title: text(note.name), tab: 'progression', expand: `progfeat-${name}`,
        sub: bits(`${name} feature`, text(note.type), clip(note.text, 70)), keys: 'class feature',
      });
    }
  }
  for (const t of model.data.templates || []) {
    const tname = text(t.name);
    if (tname) {
      add({
        kind: 'feature', title: tname, tab: 'template',
        value: `${(t.features || []).length} feature${(t.features || []).length === 1 ? '' : 's'}`,
        sub: 'Template', keys: 'template',
      });
    }
    for (const f of t.features || []) {
      if (!text(f.name)) continue;
      add({
        kind: 'feature', title: text(f.name), tab: 'template',
        sub: bits(tname, text(f.type), clip(f.text, 70)), keys: 'template feature',
      });
    }
  }
}

/** The companions, each kind on its own tab -- and a kind may keep several. */
function companions(model, add) {
  for (const [kind, label] of [['familiar', 'Familiar'], ['animalCompanion', 'Animal companion'],
    ['eidolon', 'Eidolon'], ['conjured', 'Conjured companion']]) {
    (model.data[kind] || []).forEach((co, ci) => {
      // The roll dispatcher's spelling for which of the kind: bare for the
      // first, `eidolon:1` after -- the same string the tab's buttons carry.
      const rollKind = ci === 0 ? kind : `${kind}:${ci}`;
      const name = text(co.name) || text(co.species) || text(co.kind);
      if (!name && !(co.attacks || []).length) return;
      if (name) {
        add({
          kind: 'companion', title: name, tab: kind,
          value: co.hp?.max ? `${co.hp.max} hp` : '',
          sub: bits(label, text(co.species), text(co.archetype)),
          roll: { kind: rollKind, ref: 'init', what: `${label.toLowerCase()} initiative` }, keys: 'companion pet',
        });
      }
      (co.attacks || []).forEach((a, i) => {
        if (!text(a.type) && !text(a.name)) return;
        add({
          kind: 'companion', title: text(a.name) || text(a.type), tab: kind,
          value: bits(fmt(a.attack ?? 0), text(a.damage)),
          sub: bits(name || label, `${label} attack`), roll: { kind: rollKind, ref: `attack:${i}`, what: `${label} attack` },
          keys: 'attack natural',
        });
      });
      for (const f of co.feats || []) {
        const title = nameOf(f);
        if (!title) continue;
        add({ kind: 'feat', title, tab: kind, sub: `${label} feat`, keys: 'companion feat' });
      }
      for (const [list, what] of [['evolutions', 'Evolution'], ['tricks', 'Trick'], ['talents', 'Talent']]) {
        for (const x of co[list] || []) {
          const title = nameOf(x);
          if (!title) continue;
          add({ kind: 'companion', title, tab: kind, sub: bits(name || label, what), keys: what.toLowerCase() });
        }
      }
      (co.skills || []).forEach((s, i) => {
        if (!Number(s.ranks)) return;
        const title = skillTitle(s);
        if (!title) return;
        add({
          kind: 'skill', title, tab: kind, value: `${s.ranks} rank${s.ranks === 1 ? '' : 's'}`,
          sub: bits(`${label} skill`, text(s.ability)),
          roll: { kind: rollKind, ref: `skill:${i}`, what: `a ${label} ${title} check` }, keys: 'companion skill',
        });
      });
    });
  }
}

/** Prose: background, notes, approvals, and whatever the workbook carried in. */
function lore(model, add) {
  const c = model.data;
  (c.backgroundSections || []).forEach((s, i) => {
    if (!text(s.text) && !text(s.label)) return;
    add({
      kind: 'lore', title: text(s.label) || `Background ${i + 1}`, tab: 'lore',
      sub: clip(s.text, 110), find: text(s.label), keys: `lore background ${clip(s.text, 300)}`,
    });
  });
  (c.notes || []).forEach((n, i) => {
    const title = text(n.title) || clip(n.body, 40);
    if (!title) return;
    add({
      kind: 'note', title, tab: 'extras', sub: clip(n.body, 110),
      sel: `[data-item^="notes|${i}|"]`, keys: `note ${clip(n.body, 300)}`,
    });
  });
  for (const a of c.extras?.approvals || []) {
    if (!text(a.name)) continue;
    add({
      kind: 'note', title: text(a.name), tab: 'extras',
      sub: bits('Approval', text(a.approvedBy)), keys: 'approval gm',
    });
  }
}

/**
 * "From the source tab": the cells the converter kept but no heading claimed,
 * one row each, under whichever tab shows them.
 *
 * Rules text pasted into a workbook usually ends up here, which makes it worth
 * searching -- but it is unmodelled text rather than something the sheet
 * computes with, so it sits low and is capped per block.
 */
function sourceExtras(model, add) {
  const c = model.data;
  const blocks = [
    ['akashic', c.akashic], ['maneuvers', c.maneuvers], ['vancian', c.vancian],
    ['psionics', c.psionics], ['cardcasting', c.cardcasting], ['extras', c.extras],
    ['crafting', c.crafting], ['techniques', c.techniques],
  ];
  for (const [tab, block] of blocks) {
    const rows = block?.sourceExtras || [];
    for (const row of rows.slice(0, 300)) {
      const cells = (row?.cells || []).map((cell) => text(cell)).filter(Boolean);
      if (!cells.length) continue;
      const title = cells[0].length > 2 ? cells[0] : cells.join(' · ');
      if (title.length < 3) continue;
      add({
        kind: 'sheet', title: clip(title, 80), tab,
        sub: bits('From the source tab', clip(cells.slice(1).join(' · '), 70)),
        find: cells[0], keys: 'source extra unmodelled',
      });
    }
  }
}

/**
 * The workbook's own worksheets, a row at a time.
 *
 * These are the sheet's memory of where a character came from -- unmodelled
 * cells the converter kept rather than dropped -- so they are searchable but
 * sit last: a modelled feat should always beat the row of a spreadsheet that
 * mentions it. Capped per tab, because a worksheet can be thousands of rows
 * and nobody is scrolling to the four-hundredth match.
 */
function worksheets(model, add, ctx) {
  (model.data.sheetTabs || []).forEach((tab, index) => {
    let taken = 0;
    for (const row of tab.rows || []) {
      if (taken >= 400) break;
      const cells = (Array.isArray(row) ? row : row?.cells || [])
        .map((cell) => text(typeof cell === 'object' ? cell?.value : cell)).filter(Boolean);
      if (!cells.length) continue;
      const title = cells[0].length > 2 ? cells[0] : cells.join(' · ');
      if (title.length < 3) continue;
      taken++;
      add({
        kind: 'sheet', title: clip(title, 80), tab: `sys-${index}`,
        sub: bits(text(tab.name), clip(cells.slice(1).join(' · '), 70)),
        find: cells[0], keys: `worksheet ${text(tab.name)}`,
      });
    }
  });
  // Every tab is a row of its own, so the palette doubles as a way onto a tab
  // the bar is not currently showing.
  for (const t of ctx.tabs) {
    add({
      kind: 'tab', title: t.label, tab: t.id, start: true,
      sub: bits(t.kind === 'system' ? 'Worksheet' : 'Tab', t.inUse === false ? 'empty' : ''),
      // The id as well as the label: several tabs are known by a word that is
      // not on them -- Equipment is `gear`, Martial Spheres is `martial`.
      keys: `tab go to open ${t.id}`,
    });
  }
}

/**
 * The commands: what the header buttons do, reachable without going back to
 * the header. Each names a `data-action` the element already dispatches, so
 * nothing here is a second implementation of anything.
 */
function commands(model, add) {
  const session = model.viewMode() === 'session';
  const cmd = (title, action, sub, keys) => add({
    kind: 'command', title, action, sub, keys, tab: null, start: true, find: null,
  });
  cmd('Save this version', 'save', 'Make this the version the sheet opens on', 'save version commit');
  cmd('Export JSON', 'export', 'Download the character as a file', 'export download backup json');
  cmd('Import a character or workbook', 'import', 'Load a JSON or .xlsx', 'import load open file xlsx');
  cmd('History', 'history', 'Earlier states of this sheet', 'history snapshots versions undo');
  cmd(session ? 'Switch to Build view' : 'Switch to Session view', 'view-mode',
    session ? 'Everything, arranged for building' : 'Only the tabs that come up at the table',
    'view mode session build table');
  cmd('Switch theme', 'theme', 'Light and dark', 'theme light dark colour');
  cmd('Formulas guide', 'formulas', 'Values, destinations and every formula on the sheet', 'formula fx guide search values');
  cmd('Rest — refresh daily trackers', 'quick-rest', 'Everything with a daily refresh comes back', 'rest sleep night day refresh');
  if ((model.data.vancian?.classes || []).length) {
    cmd('New day — spell slots', 'vancian-new-day', 'Give back every prepared spell', 'new day spells rest');
  }
  if ((model.data.psionics?.classes || []).length) {
    cmd('New day — power points', 'psionics-new-day', 'Refill the power point pool', 'new day psionics rest');
  }
  cmd('Show, hide and rearrange tabs', 'palette-tabs', 'The ⚙ tab manager', 'tabs manage hide show arrange');
  cmd('Reset to the character as imported', 'reset', 'Asks first; named checkpoints are kept', 'reset revert discard');
}

const SOURCES = [
  vitals, identity, classes, skills, equipment, feats, spheres, akashic, maneuvers,
  vancian, psionics, cardcasting, techniques, trackers, progression, companions, lore,
  sourceExtras, worksheets, commands,
];

/* ---------------- searching ---------------- */

/**
 * How well one typed word matches one string.
 *
 * The ladder is the whole of the ranking: an exact word beats a prefix beats a
 * word inside the string beats the letters merely appearing in order. Anything
 * that only matches as a subsequence ("bldf" for Blind-Fight) scores low
 * enough that a real substring match anywhere else wins -- which is what keeps
 * fuzzy matching from burying the obvious answer.
 */
function termScore(term, hay, { fuzzy = false } = {}) {
  if (!hay) return 0;
  const at = hay.indexOf(term);
  if (at === 0) return hay.length === term.length ? 1000 : 820 - Math.min(hay.length - term.length, 40);
  if (at > 0) {
    // A match that starts a word reads as a hit; one that starts mid-word
    // ("ear" in "spear") is weaker, and further in is weaker still.
    const boundary = !/[a-z0-9]/i.test(hay[at - 1]);
    return (boundary ? 650 : 420) - Math.min(at, 40) * 2;
  }
  // Subsequence: every letter, in order, gaps allowed -- "blndf" finding
  // Blind-Fight. Only ever tried on the title, and hedged three ways, because
  // this is where a fuzzy search earns its bad name:
  //
  //   - three letters up. Any two are a subsequence of half the sheet.
  //   - it has to start a word. Somebody abbreviating a name starts at its
  //     start; "ironc" landing inside "Bardic Performance" does not.
  //   - and it has to stay tight. Spread over five times its own length, it is
  //     a coincidence rather than an abbreviation.
  if (!fuzzy || term.length < 3) return 0;
  let best = 0;
  for (let start = 0; start < hay.length; start++) {
    if (hay[start] !== term[0]) continue;
    if (start > 0 && /[a-z0-9]/.test(hay[start - 1])) continue;
    let i = 1;
    let j = start + 1;
    for (; j < hay.length && i < term.length; j++) if (hay[j] === term[i]) i++;
    if (i < term.length) continue;
    const span = j - start;
    if (span > term.length * 5) continue;
    best = Math.max(best, Math.max(60, 260 - (span - term.length) * 6));
  }
  return best;
}

/** The best a term does across an entry's three fields, weighted by field. */
function entryScore(entry, terms) {
  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      termScore(term, entry.hayTitle, { fuzzy: true }),
      termScore(term, entry.haySub) * 0.6,
      termScore(term, entry.hayKeys) * 0.45,
    );
    if (!best) return 0;
    total += best;
  }
  // A short title that matches is usually the thing itself rather than
  // something that mentions it: "Heal" over "Healing Hand of the Faithful".
  return total / terms.length - Math.min(entry.hayTitle.length, 60) * 0.5;
}

/**
 * Run a query over the index.
 *
 * Returns the matches in order with the total, so the footer can say "40 of
 * 312" without the caller counting anything itself. An empty query is not an
 * empty result: it is the opening list -- what was picked recently, then the
 * vitals, the tabs and the commands.
 */
export function searchIndex(index, rawQuery, { limit = 500, recent = [] } = {}) {
  const raw = String(rawQuery ?? '');
  const scope = SCOPES[raw[0]] || null;
  const query = (scope ? raw.slice(1) : raw).trim().toLowerCase();
  const pool = scope ? index.filter((e) => scope.kinds.includes(e.kind)) : index;
  const rank = new Map(recent.map((id, i) => [id, recent.length - i]));

  if (!query) {
    const opening = scope ? pool : [
      ...recent.map((id) => pool.find((e) => e.id === id)).filter(Boolean),
      ...pool.filter((e) => e.start && !rank.has(e.id)),
    ];
    return { rows: opening.slice(0, limit), total: opening.length, scope, query, terms: [] };
  }

  const terms = query.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const entry of pool) {
    const score = entryScore(entry, terms);
    if (score <= 0) continue;
    hits.push({ entry, score: score + kindWeight(entry.kind) * 3 + (rank.get(entry.id) || 0) * 12 });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
  // Once something has matched well, everything scoring a third of it is noise
  // riding along behind the answer -- and a count of 400 tells the player less
  // than a count of 12. The cut is relative, so a query that only ever matches
  // weakly still gets everything it found.
  const floor = hits.length ? hits[0].score * 0.34 : 0;
  const kept = hits.filter((h) => h.score >= floor);
  return {
    rows: kept.slice(0, limit).map((h) => h.entry), total: kept.length, scope, query, terms,
  };
}

/* ---------------- markup ---------------- */

/**
 * Mark where the query landed in a title.
 *
 * Ranges are found on the lowercased copy and applied to the original, so the
 * casing on screen is the character's own. A locale where lowercasing changes
 * a string's length would misplace them, so that case is left unmarked rather
 * than marked wrongly.
 */
function markTitle(title, terms) {
  const hay = title.toLowerCase();
  if (!terms.length || hay.length !== title.length) return esc(title);
  const spans = [];
  for (const term of terms) {
    const at = hay.indexOf(term);
    if (at >= 0) { spans.push([at, at + term.length]); continue; }
    // Fell through to a subsequence match: mark the letters it used.
    let i = 0;
    for (let j = 0; j < hay.length && i < term.length; j++) {
      if (hay[j] === term[i]) { spans.push([j, j + 1]); i++; }
    }
  }
  if (!spans.length) return esc(title);
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const [from, to] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  let out = '';
  let at = 0;
  for (const [from, to] of merged) {
    out += esc(title.slice(at, from)) + `<mark>${esc(title.slice(from, to))}</mark>`;
    at = to;
  }
  return out + esc(title.slice(at));
}

/** One row. `i` is its place in the current result list -- the selection key. */
export function rowHtml(entry, i, terms, selected) {
  const sub = bits(entry.where, entry.sub);
  return `<div class="cmdk-row" role="option" id="cmdk-o-${i}" data-i="${i}"
      aria-selected="${selected}"${entry.roll ? ' data-rollable' : ''}>
      <span class="cmdk-body">
        <span class="cmdk-line">
          <span class="cmdk-title">${markTitle(entry.title, terms)}</span>
          <span class="cmdk-kind" data-kind="${esc(entry.kind)}">${esc(kindLabel(entry.kind))}</span>
        </span>
        ${sub ? `<span class="cmdk-sub">${esc(sub)}</span>` : ''}
      </span>
      ${entry.value ? `<span class="cmdk-value">${esc(entry.value)}</span>` : ''}
      <span class="cmdk-go">
        ${entry.roll ? '<button class="cmdk-roll" data-roll-i="' + i + '" tabindex="-1" title="Copy this roll for Roll20">Roll</button>' : ''}
        <span class="cmdk-enter">${entry.action ? 'Run' : 'Jump'}</span>
      </span>
    </div>`;
}

/** The result list, or the line that says why there is none. */
export function resultsHtml(rows, terms, { at = 0, from = 0 } = {}) {
  if (!rows.length) return '';
  return rows.map((entry, n) => rowHtml(entry, from + n, terms, from + n === at)).join('');
}

/** What the footer says on the right: how much of the sheet answered. */
export function countText(shown, total) {
  if (!total) return 'no matches';
  return shown < total ? `${shown} of ${total}` : `${total} result${total === 1 ? '' : 's'}`;
}

/**
 * The palette itself.
 *
 * Built once per opening. The input is never rewritten after that -- only the
 * list and the footer count are patched as you type -- so the caret stays put
 * and a fast typist never races the DOM.
 */
export function paletteHtml({ query = '', placeholder = 'Search this character…' } = {}) {
  return `<div class="cmdk-box" role="combobox" aria-expanded="true" aria-haspopup="listbox"
      aria-owns="cmdk-list">
      <div class="cmdk-head">
        <svg class="cmdk-glass" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>
        </svg>
        <input class="cmdk-input" type="text" value="${esc(query)}" placeholder="${esc(placeholder)}"
          aria-label="Search this character" aria-controls="cmdk-list" aria-autocomplete="list"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="cmdk-esc" data-cmdk-close aria-label="Close search">Esc</button>
      </div>
      <div class="cmdk-list" id="cmdk-list" role="listbox" aria-label="Search results" tabindex="-1"></div>
      <div class="cmdk-foot">
        <span class="cmdk-hints">
          <kbd>↑</kbd><kbd>↓</kbd> Navigate
          <kbd>↵</kbd> <span data-cmdk-primary>Jump</span>
          <span class="cmdk-rollhint"><kbd>Ctrl</kbd><kbd>↵</kbd> Roll</span>
          <kbd>Esc</kbd> Close
        </span>
        <span class="cmdk-count" data-cmdk-count aria-live="polite"></span>
      </div>
    </div>`;
}

/** The line shown in place of results, worded for what was actually typed. */
export function emptyHtml(query, scope) {
  if (scope && !query) return '';
  return `<p class="cmdk-empty">Nothing on this character matches
    <strong>${esc(query)}</strong>${scope ? ` in ${esc(scope.label.toLowerCase())}` : ''}.
    <span class="cmdk-tip">Try fewer letters, or <kbd>&gt;</kbd> for commands
    and <kbd>#</kbd> for tabs.</span></p>`;
}
