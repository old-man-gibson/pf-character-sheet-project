/**
 * roll20-sheet.js -- a character as the Pathfinder Community sheet imports one.
 *
 * The Roll20 sheet has no import of its own format. What it has is a box on its
 * Import tab, `herolab_import`, that takes a Hero Lab character as JSON: Hero
 * Lab's standard XML export (`document > public > character`) run through a
 * generic XML-to-JSON stylesheet, so an XML attribute `name="Strength"` arrives
 * as `"_name": "Strength"` and a child element as a nested object. The sheet's
 * worker that reads it is HLImport.js in the sheet's own source, and it is the
 * only specification there is -- every path below is one it reads, in the shape
 * it reads it.
 *
 * Three things about that reader shape what is written here:
 *
 *   - It reaches into many paths without checking them, so every section it
 *     touches is present, empty where the character has nothing to put there.
 *     A missing one stops the import at that line with a TypeError in the box.
 *   - It takes the totals and works the parts out backwards: a skill's Misc is
 *     its total less ranks, ability, class-skill bonus and armour penalty. So
 *     totals go over as the sheet here computes them, and each part the reader
 *     subtracts is sent as the same figure the total was built with -- the
 *     Roll20 sheet then shows the same number, with the difference in Misc.
 *   - Every value is a string, as it would be coming out of XML. The reader
 *     compares some of them that way (`_quantity === '1'`, `_equipped === 'yes'`).
 *
 * What the Roll20 sheet cannot hold, or the reader does not carry, comes back
 * as `notes`: the few things to fix by hand after the import, said plainly.
 */
import { ABILITIES, ABILITY_LABELS, armorParts, statMod } from './rules.js';

/** The skills the Roll20 sheet has a row for, by the name Hero Lab gives them. */
const PLAIN_SKILLS = new Set([
  'Acrobatics', 'Appraise', 'Bluff', 'Climb', 'Diplomacy', 'Disable Device',
  'Disguise', 'Escape Artist', 'Fly', 'Handle Animal', 'Heal', 'Intimidate',
  'Linguistics', 'Perception', 'Ride', 'Sense Motive', 'Sleight of Hand',
  'Spellcraft', 'Stealth', 'Survival', 'Swim', 'Use Magic Device',
]);
/**
 * Skills that take a subject. The reader numbers these into the sheet's
 * Craft / Craft2 … slots itself; Lore and Artistry it reads the subject out of
 * the parentheses unconditionally, so those two are never sent without one.
 */
const SUBJECT_SKILLS = new Set(['Craft', 'Perform', 'Profession', 'Lore', 'Artistry']);
const SUBJECT_REQUIRED = new Set(['Lore', 'Artistry']);

const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => String(Math.trunc(Number(v) || 0));
const signed = (v) => {
  const n = Math.trunc(Number(v) || 0);
  return n < 0 ? String(n) : `+${n}`;
};
const yes = (b) => (b ? 'yes' : 'no');
const named = (v) => str(v).trim();

/** "+11/+6/+1" off a first attack and a BAB, the way Hero Lab writes it. */
function iteratives(first, bab) {
  const b = Math.floor(Number(bab) || 0);
  const out = [];
  for (let at = b; at > 0; at -= 5) out.push(first - (b - at));
  return (out.length ? out : [first]).map(signed).join('/');
}

/**
 * The class rows, and the hit-dice string the reader matches them against.
 *
 * The reader pairs each class with the `NdM` whose N is that class's level, and
 * counts the character's level as the sum of the Ns. That is multiclassing; a
 * gestalt character has every class at once, so their levels sum past the
 * character's own. Sent class by class, Roll20 would count Hedgewitch 15 and
 * Vigilante 15 as thirty levels -- so a gestalt build goes over as one row at
 * the character's level, with its best hit die, which is what gestalt takes.
 */
function classRows(c) {
  const level = Math.max(1, Number(c.identity?.level) || 1);
  const classes = (c.classes || []).filter((k) => named(k.name) && Number(k.gestaltLevels) > 0);
  const summed = classes.reduce((n, k) => n + Number(k.gestaltLevels), 0);
  if (!classes.length) return { rows: [], hitdice: `${level}d8`, gestalt: false };
  if (summed > level) {
    const hd = Math.max(...classes.map((k) => Number(k.hd) || 8));
    return {
      rows: [{ _name: classes.map((k) => named(k.name)).join(' / '), _level: num(level) }],
      hitdice: `${level}d${hd}`,
      gestalt: true,
    };
  }
  return {
    rows: classes.map((k) => {
      const arch = named(k.archetypes).replace(/[()]/g, '');
      return { _name: arch ? `${named(k.name)} (${arch})` : named(k.name), _level: num(k.gestaltLevels) };
    }),
    hitdice: classes.map((k) => `${Number(k.gestaltLevels)}d${Number(k.hd) || 8}`).join('+'),
    gestalt: false,
  };
}

/** The six scores, in the order the reader indexes (it takes Con as [2]). */
function attributes(c) {
  return ABILITIES.map((key) => {
    const a = c.abilities?.[key] || {};
    const base = Number(a.score) || 0;
    const now = Number(a.workingScore ?? a.tempScore ?? base) || 0;
    return {
      _name: ABILITY_LABELS[key],
      attrvalue: { _base: num(base), _modified: num(now) },
      attrbonus: { _modified: num(a.totalMod) },
    };
  });
}

const SAVE_ABBR = { fortitude: 'Fort', reflex: 'Ref', will: 'Will' };

function saves(c) {
  return {
    allsaves: { situationalmodifiers: { _text: '' } },
    save: Object.entries(SAVE_ABBR).map(([key, abbr]) => {
      const s = c.saves?.[key] || {};
      const r = s.bonusesResolved || {};
      return {
        _abbr: abbr,
        _save: num(s.total),
        _base: num(s.base),
        _fromattr: num(statMod(c, s.stat1, s.stat2)),
        _fromresist: num((Number(r.abpResistance) || 0) + (Number(r.resistance) || 0)),
        situationalmodifiers: { _text: '' },
      };
    }),
  };
}

/**
 * AC, with the parts the reader takes out to leave Misc.
 *
 * The reader knows three abilities for AC: Dexterity, then Charisma, then
 * Wisdom. A sheet keyed to anything else -- Strength, a second ability beside
 * the first -- goes over in the Dexterity slot, which keeps the total right,
 * and a note says which ability the Roll20 dropdown should be switched to.
 */
function armorClass(c, notes) {
  const d = c.defenses || {};
  const r = d.acBonusesResolved || {};
  const parts = armorParts(c);
  const stat = String(d.acStat1 || 'Dex');
  const mod = Math.min(parts.maxDex, statMod(c, d.acStat1, d.acStat2));
  const slot = { _fromdexterity: '', _fromcharisma: '', _fromwisdom: '' };
  const key = { dex: '_fromdexterity', cha: '_fromcharisma', wis: '_fromwisdom' }[stat.slice(0, 3).toLowerCase()];
  if (key && !d.acStat2) slot[key] = num(mod);
  else {
    slot._fromdexterity = num(mod);
    const which = [d.acStat1, d.acStat2].filter(Boolean).join(' + ');
    notes.push(`AC adds ${which}; the Roll20 sheet has it under Dex. Set AC's ability to the right one on the Defense tab.`);
  }
  return {
    _ac: num(d.ac),
    _touch: num(d.touch),
    _flatfooted: num(d.flatFooted),
    _fromarmor: num(parts.armor),
    _fromshield: num(parts.shield),
    _fromsize: num(r.size),
    _fromnatural: num((Number(r.abpNatural) || 0) + (Number(r.enhancedNatural) || 0) + (Number(r.natural) || 0)),
    _fromdeflect: num((Number(r.abpDeflection) || 0) + (Number(r.deflection) || 0)),
    _fromdodge: num(r.dodge),
    ...slot,
  };
}

/** Hero Lab's name for a skill, or null for one the Roll20 sheet has no row for. */
function skillName(s) {
  const raw = named(s.name);
  const knowledge = raw.match(/^Kn(?:owledge|\.)\s*\(([^)]*)\)/i);
  if (knowledge) return `Knowledge (${knowledge[1].trim().toLowerCase()})`;
  if (PLAIN_SKILLS.has(raw)) return raw;
  // "Craft (Craftsman)" with a subject of Carpentry is Craft (Carpentry).
  const base = raw.replace(/\s*\(.*$/, '');
  if (!SUBJECT_SKILLS.has(base)) return null;
  const subject = named(s.spec) || (raw.match(/\(([^)]*)\)/)?.[1] ?? '');
  if (subject) return `${base} (${subject})`;
  if (SUBJECT_REQUIRED.has(base)) return Number(s.totalRanks) > 0 ? `${base} (General)` : null;
  return base;
}

function skills(c, notes) {
  const out = [];
  const left = [];
  for (const s of c.skills || []) {
    // A subject skill nobody has filled in -- the workbook's spare Craft and
    // Lore rows -- would take one of the sheet's numbered slots for nothing.
    const blank = !named(s.spec) && SUBJECT_SKILLS.has(named(s.name).replace(/\s*\(.*$/, ''))
      && !/\(/.test(named(s.name)) && !(Number(s.totalRanks) > 0);
    if (blank) continue;
    const name = skillName(s);
    if (!name) {
      // Only the ones worth rolling: an untrained +0 is the sheet's own default.
      if (Number(s.totalRanks) > 0 || Number(s.bonus)) left.push(`${named(s.name)} ${signed(s.bonus)}`);
      continue;
    }
    const ability = String((s.abilities || [])[0] || 'Int').slice(0, 3).toUpperCase();
    const note = named(s.situational);
    out.push({
      _name: name,
      _value: num(s.bonus),
      _ranks: num(s.totalRanks),
      _attrname: ability,
      _attrbonus: num(s.abilityMod ?? statMod(c, ...(s.abilities || []))),
      _classskill: yes(s.classSkill),
      _armorcheck: yes(s.armorPenalty),
      _trainedonly: yes(s.requiresTraining),
      situationalmodifiers: note ? { situationalmodifier: [{ _source: 'Note', _text: note }] } : {},
    });
  }
  if (left.length) notes.push(`No row on the Roll20 sheet for: ${left.join(', ')}. Add them as misc skills if you roll them.`);
  return out;
}

/** "17-20/×2", or "×3" for a weapon that threatens on a 20 alone. */
function critText(w) {
  const range = Math.floor(Number(w.critRange) || 20);
  const mult = Math.max(2, Math.floor(Number(w.calc?.critMultNum ?? String(w.critMult).replace(/\D/g, '')) || 2));
  return range < 20 ? `${range}-20/×${mult}` : `×${mult}`;
}

/**
 * An enhancement bonus the reader can see.
 *
 * It reads a weapon's or armour's enhancement out of its name (`+2`), not out
 * of a field, so a piece whose enhancement is kept apart from its name gets it
 * written on the end.
 */
function withEnhancement(name, enh) {
  const n = Math.trunc(Number(enh) || 0);
  return n > 0 && !/\+\d/.test(name) ? `${name} +${n}` : name;
}

/** Everything carried, as inventory rows, with what each is when it is armour or a weapon. */
function equipment(c) {
  const e = c.equipment || {};
  const items = [];
  const armor = [];
  const melee = [];
  const ranged = [];
  const item = (name, { weight = 0, cost = 0, description = '' } = {}) => items.push({
    _name: name,
    _quantity: '1',
    weight: { _value: num(weight) },
    cost: { _value: num(cost) },
    description,
  });

  if (e.armor?.active && named(e.armor.name)) {
    const name = withEnhancement(named(e.armor.name), e.armor.enhancement);
    armor.push({ _name: name, _ac: num((Number(e.armor.acBonus) || 0) + (Number(e.armor.enhancement) || 0)), _equipped: 'yes' });
    item(name, { weight: e.armor.weight, cost: e.armor.cost });
  }
  for (const s of e.shields || []) {
    if (!named(s.name)) continue;
    // The reader tells a shield from armour by the word in its name.
    let name = withEnhancement(named(s.name), s.enhancement);
    if (!/shield|buckler|klar/i.test(name)) name = `${name} (shield)`;
    armor.push({ _name: name, _ac: num((Number(s.acBonus) || 0) + (Number(s.enhancement) || 0)), _equipped: yes(s.active) });
    item(name, { weight: s.weight, cost: s.cost });
  }
  for (const w of e.weapons || []) {
    if (!named(w.name)) continue;
    const name = withEnhancement(named(w.name), w.enhancement);
    const row = {
      _name: name,
      _damage: str(w.diceResolved || w.dice) || '—',
      _crit: critText(w),
      _typetext: named(w.damageType),
    };
    const isRanged = /ranged/i.test(String(w.attackType));
    if (isRanged) row.rangedattack = { _rangeincvalue: num(String(w.range ?? '').match(/\d+/)?.[0]) };
    (isRanged ? ranged : melee).push(row);
    item(name, { weight: w.weight, cost: w.price, description: named(w.special) });
  }
  for (const g of [...(e.gear || []), ...(e.other || [])]) {
    if (!named(g.name)) continue;
    const bonuses = (g.bonuses || [])
      .filter((b) => Number(b?.value))
      .map((b) => `${signed(b.value)}${b.type ? ` ${String(b.type).toLowerCase()}` : ''}`);
    const extras = (g.others || []).map(named).filter(Boolean);
    const description = [
      g.slot && !/^Other/.test(g.slot) ? `Slot: ${g.slot}.` : '',
      bonuses.length ? `${bonuses.join(', ')}.` : '',
      extras.join('; '),
      named(g.note),
    ].filter(Boolean).join(' ');
    item(named(g.name), { weight: g.weight, cost: g.cost, description });
  }
  return { items, armor, melee, ranged };
}

/** Feats, traits and the rest of the named rules, as the ability rows they become. */
function abilitiesLists(c) {
  const feats = [];
  for (const g of c.featGroups || []) {
    for (const f of g.entries || []) {
      if (named(f.name) && !/^\?+$/.test(named(f.name))) {
        feats.push({ _name: named(f.name), description: named(f.note) });
      }
    }
  }
  const granted = c.grantedFeats || {};
  if (named(granted.specialty?.name)) feats.push({ _name: named(granted.specialty.name), description: named(granted.specialty.note) });
  for (const f of granted.others || []) {
    if (named(f.name) && !/^\?+$/.test(named(f.name))) {
      feats.push({ _name: named(f.name), description: [named(f.source), named(f.note)].filter(Boolean).join(': ') });
    }
  }

  const traits = [];
  for (const t of c.traits || []) {
    if (named(t?.name)) traits.push({ _name: named(t.name), description: named(t.note ?? t.text) });
  }
  if (named(granted.drawback?.name)) traits.push({ _name: named(granted.drawback.name), description: named(granted.drawback.note) });

  // Racial traits have no source; mythic abilities are given one, which is
  // what makes the reader file them as class features rather than racial.
  const specials = (c.raceTraits || [])
    .filter((t) => named(t.name))
    .map((t) => ({ _name: named(t.name), description: named(t.text) }));
  for (const m of c.mythic?.abilities || []) {
    const name = named(m.name) || named(m.featChoice);
    if (!name) continue;
    specials.push({
      _name: name,
      description: [named(m.effect), named(m.featEffect)].filter(Boolean).join('\n'),
      specsource: [`Mythic${c.mythic?.path ? ` (${c.mythic.path})` : ''}`],
    });
  }
  return { feats, traits, specials: mergeSpecials(specials) };
}

/**
 * One row per rule name, the way the reader wants them.
 *
 * The reader folds "Energy Resistance (fire)" and "Energy Resistance (cold)"
 * into one row by the name outside the parentheses, and reads the inside of
 * every one it folds -- so a plain "Unfocused Focus" beside "Unfocused Focus
 * (Incanter)" stops the import. They are folded here instead, first, with
 * every description kept.
 */
function mergeSpecials(list) {
  const base = (name) => name.replace(/ x[0-9]+$/, '').replace(/\(([^)]*)\)/g, '').trim();
  const groups = new Map();
  for (const s of list) {
    const key = base(s._name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups].map(([key, group]) => {
    if (group.length === 1) return group[0];
    const inner = [...new Set(group.map((s) => s._name.match(/\(([^)]*)\)/)?.[1]).filter(Boolean))];
    return {
      ...group[0],
      _name: inner.length ? `${key} (${inner.join(', ')})` : key,
      description: group
        .filter((s) => s.description)
        .map((s) => `${s._name}: ${s.description}`)
        .join('\n\n'),
    };
  });
}

/** A defence box's text as the one-entry list the reader joins back up. */
const shortList = (text) => (named(text) ? { special: [{ _shortname: named(text) }] } : {});

/**
 * The JSON to paste into the Pathfinder Community sheet's Hero Lab import box.
 *
 * `model` is a Character (for `hpMax`); `model.data` is what everything else
 * reads. Returns the text and the notes to show beside it.
 */
export function communitySheetImport(model) {
  const c = model.data;
  const notes = [];
  const id = c.identity || {};
  const level = Math.max(1, Number(id.level) || 1);
  const { rows, hitdice, gestalt } = classRows(c);
  if (gestalt) notes.push('Gestalt classes go over as one class row at your character level, so Roll20 counts the levels once.');
  const { items, armor, melee, ranged } = equipment(c);
  const { feats, traits, specials } = abilitiesLists(c);
  const parts = armorParts(c);
  const land = (id.speeds || []).find((s) => /land/i.test(s.type)) || (id.speeds || [])[0];
  const others = (id.speeds || []).filter((s) => s !== land && Number(s.final) > 0);
  if (others.length) notes.push(`Other speeds to fill in on the Roll20 sheet: ${others.map((s) => `${s.type} ${s.final} ft.`).join(', ')}.`);
  const gp = /^g(p|old)/i.test(String(c.wealth?.currency || 'gp')) ? num(c.wealth?.current) : '0';
  const bab = Number(c.attack?.bab) || 0;
  const resources = [
    ...(c.resources || []).map((r) => ({ name: r.name, max: r.total, left: r.uses })),
    ...(model.trackers || []).map((t) => ({ name: t.name, max: t.max, left: t.current })),
  ].filter((r) => named(r.name) && Number.isFinite(Number(r.max)));

  const character = {
    _name: named(id.name) || 'Character',
    _role: 'pc',
    _playername: named(id.player),
    race: { _racetext: named(id.race) || ' ' },
    alignment: { _name: named(id.alignment) },
    deity: { _name: named(id.deity) },
    size: { _name: named(id.size) || 'Medium' },
    types: { type: [{ _name: '' }] },
    subtypes: {},
    personal: {
      _gender: named(id.gender),
      _age: str(id.age),
      _hair: '',
      _eyes: '',
      _skin: '',
      charheight: { _text: named(id.height) },
      charweight: { _text: named(id.weight) },
      description: (c.backgroundSections || [])
        .filter((b) => named(b.text))
        .map((b) => `${b.label}: ${named(b.text)}`)
        .join('\n\n'),
    },
    challengerating: { _text: '' },
    xpaward: { _value: '' },
    xp: { _total: num(id.xp) },
    favoredclasses: {},
    factions: {},
    languages: { language: (id.languages || []).filter(named).map((l) => ({ _name: named(l) })) },
    attributes: { attribute: attributes(c) },
    saves: saves(c),
    classes: { _level: num(level), class: rows },
    spellclasses: {},
    health: { _hitpoints: num(model.hpMax ?? c.hp?.total), _hitdice: hitdice },
    initiative: {
      _total: num(c.hp?.initiative),
      _attrname: ABILITY_LABELS[String(c.hp?.initAbility || 'Dex').slice(0, 3).toLowerCase()] || 'Dexterity',
      _attrtext: num(statMod(c, c.hp?.initAbility || 'Dex', c.hp?.initAbility2)),
      situationalmodifiers: { _text: '' },
    },
    penalties: {
      penalty: [
        { _name: 'Armor Check Penalty', _value: num(parts.acp) },
        { _name: 'Max Dex Bonus', _value: num(Number.isFinite(parts.maxDex) ? parts.maxDex : 1000) },
      ],
    },
    armorclass: armorClass(c, notes),
    maneuvers: {
      _total: signed(c.attack?.totalCmb),
      _cmd: num(c.defenses?.cmd),
      _cmdflatfooted: num(c.defenses?.ffCmd),
    },
    attack: {
      _baseattack: signed(bab),
      _meleeattack: iteratives(Number(c.attack?.totalMelee) || 0, bab),
      _rangedattack: iteratives(Number(c.attack?.totalRanged) || 0, bab),
      special: [],
    },
    movement: { speed: { _value: num(land?.final ?? 30) }, special: [] },
    encumbrance: {
      _encumstr: num((Number(c.abilities?.str?.workingScore ?? c.abilities?.str?.score) || 0) + (Number(c.carry?.strBonus) || 0)),
      _light: num(c.carry?.light),
      _medium: num(c.carry?.medium),
      _heavy: num(c.carry?.heavy),
    },
    money: { _pp: '0', _gp: gp, _sp: '0', _cp: '0' },
    senses: {},
    damagereduction: shortList(c.defenses?.calc?.drText),
    resistances: shortList(c.defenses?.calc?.resistanceText),
    immunities: shortList(c.defenses?.calc?.immunitiesText),
    weaknesses: shortList(c.defenses?.calc?.weaknessText),
    skills: { skill: skills(c, notes) },
    feats: feats.length ? { feat: feats } : {},
    traits: traits.length ? { trait: traits } : {},
    spelllike: {},
    defenses: { armor, special: [] },
    defensive: { special: [] },
    otherspecials: { special: specials },
    melee: { weapon: melee },
    ranged: { weapon: ranged },
    magicitems: {},
    gear: { item: items },
    trackedresources: {
      trackedresource: resources.map((r) => ({ _name: named(r.name), _max: num(r.max), _left: num(r.left) })),
    },
  };

  if (named(c.defenses?.calc?.sr?.text) && c.defenses.calc.sr.has) {
    notes.push(`Spell resistance (${c.defenses.calc.sr.text}) does not come across; enter it on the Defense tab.`);
  }
  if (melee.length || ranged.length) {
    notes.push('Weapons arrive as inventory items with their dice and crit range. To roll them, open each one on the Inventory tab, pick Melee or Ranged beside Create Attack, and press it.');
  }
  notes.push('Spheres, talents and the other subsystems have no place on this sheet and stay here.');

  return { text: JSON.stringify({ document: { public: { character } } }), notes };
}
