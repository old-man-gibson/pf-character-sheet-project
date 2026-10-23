/**
 * myth-weavers.js -- a character as a backup file for Myth-Weavers' Pathfinder
 * sheet (its legacy_pathfinder template), the file that sheet's Actions ->
 * Restore JSON Backup reads.
 *
 * The backup is one flat object of field name -> text. Restore clears every
 * field on the sheet and then writes the ones in the file, with the sheet's
 * own arithmetic switched off, so the figures here stand as written: totals
 * are the app's, and where the sheet splits a total into parts (AC, saves,
 * attacks, skills) the parts are chosen to add up to it under the sheet's own
 * formulas, which run again only when a part is edited there.
 *
 * Most of the work is fitting. The sheet's cells are narrow (a feat cell shows
 * about 55 characters of 9px type, a Spells & Powers row about 67), so:
 *
 *   Feats & Special Abilities (4 columns x 15 cells)
 *     column 1  Feat1-Feat10: one cell per level-up slot, "f01 Name" ... "f19";
 *               then the drawback, specialty, oath and flex feats.
 *     2-4       a block per class (features up to the current level, the latest
 *               step of a scaling feature only, each pick column as one list),
 *               then mythic at the foot of column 4.
 *   Spells & Powers (132 rows)
 *     grouped by class: "XYZ00 === Full Class Name ===", then "XYZNN text"
 *     (the class's initials and the level the entry was granted, a/b/c when a
 *     level grants several, XYZ?? where the app records no level). Rows are
 *     written in the order the sheet's own name sort gives, so sorting there
 *     moves nothing.
 *
 * mythWeaversBackup() returns the fields and a report of what was left out,
 * shortened or placed without a level. Experimental: the layout follows one
 * table's way of filling the sheet.
 */

import { critMultOf, threatText, fmt } from './rules.js';
import { hasTokens, formatValue } from './inline.js';
import { eachShown } from './ui/prose.js';

/*
 * Helvetica advance widths (1/1000 em) for ASCII 32-126. The sheet's font is
 * "Helvetica Neue", Helvetica, Arial; Arial has the same metrics. Anything
 * outside ASCII is counted wide.
 */
const AFM = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556,
  222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

/** Width of `text` in px at `px` size, as the sheet's inputs draw it. */
export function textWidth(text, px = 9) {
  let units = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    units += code >= 32 && code <= 126 ? AFM[code - 32] : 600;
  }
  return units * px / 1000;
}

/** The sheet's cells: [width px, font px], read from the template. */
export const MW_CELLS = { feat: [225, 9], spell: [278, 9], cast: [46, 9], skill: [149, 9], name: [229, 9], weaponSpecial: [281, 13] };

const fits = (text, [width, px]) => textWidth(text, px) <= width;
const ROWS = 15;
const SPELL_ROWS = 132;
const SKILL_ROWS = 51;
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** The keys of the four Feats & Special Abilities columns, top to bottom. */
export const FEAT_COLUMNS = [
  range(1, 15).map((n) => `Feat${n}`),
  range(22, 36).map((n) => `Feat${n}`),
  ['Feat16', 'Feat17', 'Feat18', ...range(0, 10).map((n) => `Featxtra${n}`), 'Featxtrax1'],
  ['Feat19', 'Feat20', 'Feat21', ...range(11, 21).map((n) => `Featxtra${n}`), 'Featxtrax21'],
];
const two = (n) => String(n).padStart(2, '0');
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
const num = (v) => Number(v) || 0;

/** Split on commas outside parentheses. */
function items(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(text ?? '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/*
 * What makes two entries one feature at two steps: "Evasion" and "Improved
 * Evasion", "Bloody Infusion" and "Bloody Infusion, Improved", "Studied Target
 * (2)" and "Studied Target (4)".
 */
const featureKey = (s) => s.replace(/\(.*\)/g, '').replace(/[+-]?\d+(d\d+)?/g, '')
  .replace(/\b(I|II|III|IV|V)\b/g, '').replace(/\b(improved|greater|lesser|major|minor|supreme)\b/gi, '')
  .replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/*
 * Entries flowed into cell-wide lines; a line that continues ends with a
 * comma. An entry too long for any cell breaks between words, and a level
 * marker ("8:") stays with the word after it.
 */
function flow(list, cell) {
  const lines = [];
  let cur = '';
  for (const it of list) {
    const next = cur ? `${cur}, ${it}` : it;
    if (fits(`${next},`, cell)) { cur = next; continue; }
    if (cur && fits(`${it},`, cell)) { lines.push(`${cur},`); cur = it; continue; }
    let acc = cur ? `${cur},` : '';
    const words = it.split(' ').reduce((a, w) => {
      if (a.length && /^\d+:$/.test(a[a.length - 1])) a[a.length - 1] += ` ${w}`; else a.push(w);
      return a;
    }, []);
    for (const word of words) {
      const t = acc ? `${acc} ${word}` : word;
      if (fits(`${t},`, cell) || !acc) acc = t; else { lines.push(acc); acc = word; }
    }
    cur = acc;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The last resort for a line that does not fit: fixed abbreviations. */
const ABBREVIATIONS = [[/\bImproved\b/g, 'I.'], [/\bGreater\b/g, 'G.'], [/\bLegendary\b/g, 'L.'], [/\bTechniques?\b/g, 'Tech.'],
  [/\bTraining\b/g, 'Trng.'], [/\bInitiative\b/g, 'Init.'], [/\bAbility\b/g, 'Ab.'], [/\bKnowledge\b/g, 'Know.']];
const abbreviate = (s) => ABBREVIATIONS.reduce((a, [re, to]) => a.replace(re, to), s);
/** A parenthetical with a number or a short choice is kept; a prose one goes. */
const trimProse = (s) => s.replace(/\s*\(([^()]*(\([^()]*\))?[^()]*)\)/g,
  (m, inner) => ((/\d/.test(inner) || inner.length <= 18) ? ` (${inner})` : ''));

/*
 * Skills the sheet's Update CS button knows by name (its classSkillKeys). It
 * asks for "#" in front of any other skill, so both are spelled its way.
 */
const MW_SKILLS = new Set(['acrobatics', 'appraise', 'bluff', 'climb', 'craft', 'diplomacy', 'disabledevice', 'disguise',
  'escapeartist', 'fly', 'handleanimal', 'heal', 'intimidate',
  ...['arcana', 'dungeoneering', 'engineering', 'geography', 'history', 'local', 'nature', 'nobility', 'planes', 'religion']
    .map((k) => `knowledge${k}`),
  'linguistics', 'perception', 'perform', 'profession', 'ride', 'sensemotive', 'sleightofhand', 'spellcraft', 'stealth',
  'survival', 'swim', 'usemagicdevice']);

/** A skill's name as the sheet spells it: "Knowledge (Arcana)", "#Lore (Mathematics)". */
export function mwSkillName(skill) {
  let name = skill.spec ? `${skill.name} (${skill.spec})` : String(skill.name);
  const kn = name.match(/^kn(?:owledge|\.)?\s*\((.+)\)$/i);
  if (kn) name = `Knowledge (${kn[1].replace(/\b[a-z]/g, (ch) => ch.toUpperCase())})`;
  // The sheet's own lookup (getClassSkillObj).
  const m = name.match(/(Knowledge )(\([a-zA-Z]+\))/);
  const key = (m ? m[1] + m[2] : name.split('(')[0]).replace(/[() ]/g, '').toLowerCase();
  return MW_SKILLS.has(key) ? name : `#${name}`;
}

/**
 * The backup for one character.
 *
 * @param {object} model           a Character
 * @param {object} [options]
 * @param {string} [options.publishedUrl]  the character's share link, written in Other Notes
 * @returns {{ fields: Object<string, string>, report: object }}
 */
export function mythWeaversBackup(model, { publishedUrl = null } = {}) {
  const c = model.data;
  const report = { dropped: [], moved: [], abbreviated: [], clipped: [], overflow: [], noLevel: [], crit: [] };
  const out = {};
  // Text as the sheet shows it: formulas worked out by the app's own
  // renderer, a forwarded bonus with its sign, a broken formula as written.
  const plain = (text) => {
    const s = String(text ?? '');
    if (!hasTokens(s)) return s;
    return model.renderProse(s).map((seg) => {
      if (seg.kind === 'text') return seg.text;
      if (seg.error) return seg.raw;
      if (seg.kind === 'push') return seg.values ? eachShown(seg) : fmt(seg.value);
      return formatValue(seg.value);
    }).join('');
  };
  // Every value goes through plain() once more, for text no section below
  // worked out itself.
  const set = (k, v) => { if (v !== null && v !== undefined && v !== '') out[k] = plain(v); };
  const notes = [];
  const id = c.identity || {};
  const level = num(id.level);
  const ab = (k) => c.abilities?.[String(k || '').toLowerCase()] || null;
  const abMod = (k) => (ab(k) ? num(ab(k).totalMod) : 0);
  // The tier is the identity's, as the model's own scope reads it; the
  // mythic block's copy can be stale.
  const mythicTier = num(id.mythicTier) || num(c.mythic?.tier);
  const mythicPath = c.mythic?.path || id.mythicPath || '';

  // Identity.
  let classText = (c.classes || []).map((k) => k.name).filter(Boolean).join(' / ')
    + (mythicTier ? ` · ${mythicPath || 'Mythic'} ${mythicTier}` : '');
  if (!fits(classText, MW_CELLS.name)) {
    const short = abbreviate(classText).replace(/ \/ /g, '/');
    report.abbreviated.push(`Class: "${classText}" → "${short}"`);
    classText = short;
  }
  set('Name', id.name); set('Player', id.player); set('Alignment', id.alignment); set('Class', classText);
  set('Race', id.variant ? `${id.race} (${id.variant})` : id.race);
  set('Deity', id.deity); set('Level', level); set('Size', id.size); set('Age', id.age); set('Gender', id.gender);
  set('Height', id.height); set('Weight', id.weight); set('Eyes', id.eyes); set('Hair', id.hair);
  // Hero points go in the sheet's Action Points box.
  if (id.heroPoints && typeof id.heroPoints === 'object') set('ActionPoints', id.heroPoints.current ?? id.heroPoints.value);

  // Abilities: the score and its modifier, and the working score as the sheet's
  // Temp when it differs (the sheet reads Temp in place of the score when set).
  for (const k of ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha']) {
    const a = ab(k);
    if (!a) continue;
    set(k, a.score); set(`${k}Mod`, a.mod);
    const temp = a.workingScore ?? a.tempScore;
    if (temp != null && temp !== a.score) { set(`${k}Temp`, temp); set(`${k}TempMod`, a.totalMod); }
  }

  // Hit points, speed, defences, load.
  set('HP', model.hpMax);
  set('HPHD', (c.classes || []).map((k) => (k.hd ? `d${k.hd}` : null)).filter(Boolean).join('/'));
  set('Speed', (id.speeds || []).filter((s) => num(s.final) > 0)
    .map((s, i) => (i === 0 && /land/i.test(s.type) ? `${s.final} ft` : `${String(s.type).toLowerCase()} ${s.final}`)).join(', '));
  const d = c.defenses || {};
  set('DamageRed', [d.dr && `DR ${plain(d.dr)}`, d.spellResistance && `SR ${plain(d.spellResistance)}`,
    d.resistance && `Resist ${plain(d.resistance)}`].filter(Boolean).join('; '));
  set('CasterLevel', model.casterLevel ? `CL ${model.casterLevel}` : '');
  const tier = (re) => (c.carry?.tiers || []).find((t) => re.test(t.name))?.limit;
  set('LightLoad', tier(/light/i)); set('MediumLoad', tier(/medium/i)); set('HeavyLoad', tier(/heavy/i));
  set('LiftOverHead', tier(/heavy/i)); set('LiftOffGround', tier(/off ground/i)); set('LiftPushDrag', tier(/push/i));

  // AC in the sheet's parts, chosen so its formulas give the app's AC, touch
  // and flat-footed: AC adds every part; touch drops armor, shield and natural;
  // flat-footed drops a positive Dex and dodge.
  const armorRow = c.equipment?.armor;
  const shieldRow = (c.equipment?.shields || []).find((s) => s.active);
  const armor = armorRow?.active ? num(armorRow.acBonus) + num(armorRow.enhancement) : 0;
  const shield = shieldRow ? num(shieldRow.acBonus) + num(shieldRow.enhancement) : 0;
  const acb = d.acBonusesResolved || {};
  const deflect = num(acb.deflection) + num(acb.abpDeflection);
  const size = num(acb.size);
  const dodge = num(acb.dodge);
  const ac = num(d.ac);
  const touch = num(d.touch);
  const flat = num(d.flatFooted);
  const natural = ac - touch - armor - shield;
  const dexLike = Math.max(0, ac - flat - dodge);
  const misc = ac - 10 - (armor + shield + dexLike + size + dodge + natural + deflect);
  set('ACArmor', armor); set('ACShield', shield); set('ACDex', dexLike); set('ACSize', size); set('ACDodge', dodge);
  set('ACNat', natural); set('ACDeflect', deflect); set('ACMisc', misc);
  set('AC', ac); set('ACTouch', touch); set('ACFlat', flat);
  set('CMD', d.cmd); set('FCMD', d.ffCmd);

  // Initiative and saves.
  const init = num(c.hp?.initiative);
  const initAbility = abMod(c.hp?.initAbility) + abMod(c.hp?.initAbility2);
  set('Init', signed(init)); set('InitDex', initAbility); set('InitMisc', init - initAbility);
  for (const [key, mw] of [['fortitude', 'Fort'], ['reflex', 'Reflex'], ['will', 'Will']]) {
    const s = c.saves?.[key];
    if (!s) continue;
    const base = num(s.base);
    const ability = abMod(s.stat1) + abMod(s.stat2);
    const magic = num(s.bonusesResolved?.abpResistance) + num(s.bonusesResolved?.resistance);
    set(mw, s.total); set(`${mw}Base`, base); set(`${mw}Ability`, ability); set(`${mw}Magic`, magic);
    set(`${mw}Misc`, num(s.total) - base - ability - magic);
  }

  // Attacks: the base carries the iteratives ("9/4"), as the sheet expects.
  const attack = c.attack || {};
  const bab = num(attack.bab);
  const iteratives = String(attack.iterative || signed(bab)).split('/').map((x) => parseInt(x, 10)).filter(Number.isFinite);
  const line = (total) => iteratives.map((b) => signed(b - bab + total)).join('/');
  const modes = attack.modes || {};
  const melee = num(attack.totalMelee);
  const ranged = num(attack.totalRanged);
  const cmb = num(attack.totalCmb);
  set('MABBase', iteratives.join('/')); set('MABStr', num(modes.melee?.value));
  set('MABMisc', melee - bab - num(modes.melee?.value)); set('MBAB', line(melee));
  set('RABBase', iteratives.join('/')); set('RABDex', num(modes.ranged?.value));
  set('RABMisc', ranged - bab - num(modes.ranged?.value)); set('RBAB', line(ranged));
  set('CMBBase', bab); set('CMBStr', num(modes.cmb?.value)); set('CMBMisc', cmb - bab - num(modes.cmb?.value)); set('CMB', signed(cmb));

  // Weapons: four rows, with the attack and damage the app works out once the
  // {{…}} and [[…]] tokens in the special text are counted. The tokens leave
  // the special text, a crit-only rider goes in Other Notes with the crit
  // line, and a special line too long for its cell is cut there and written
  // in full in Other Notes.
  const weapons = (c.equipment?.weapons || []).filter((w) => w.name);
  if (weapons.length > 4) report.overflow.push(`weapons past the sheet's four rows: ${weapons.slice(4).map((w) => w.name).join(', ')}`);
  weapons.slice(0, 4).forEach((w, i) => {
    const n = i + 1;
    const name = String(w.name).replace(/\s+/g, ' ').trim();
    const threat = Number(w.critRange) || 20;
    const mult = critMultOf(w.critMult);
    if (mult > 6 || threat < 10) report.crit.push(`${name}: ${threatText(threat, mult)}`);
    set(`Weapon${n}`, name);
    set(`Weapon${n}AB`, line(num(w.calc?.totalAtk ?? w.attackTotal)));
    set(`Weapon${n}Damage`, w.calc?.totalDmgStr || w.damageTotal);
    set(`Weapon${n}Crit`, threatText(threat, mult));
    set(`Weapon${n}Range`, w.range ? `${w.range} ft` : w.attackType);
    set(`Weapon${n}Type`, w.damageType); set(`Weapon${n}Size`, w.size); set(`Weapon${n}Weight`, num(w.weight) || '');
    set(`Weapon${n}Ammo`, w.ammunition);
    if (w.calc?.hasCritTokens && w.calc.critStr) notes.push(`${name} on a crit: ${w.calc.critStr}`);
    const special = plain(String(w.special || '').replace(/\{\{[\s\S]*?\}\}|\[\[[\s\S]*?\]\]/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!special) return;
    if (fits(special, MW_CELLS.weaponSpecial)) { set(`Weapon${n}Special`, special); return; }
    let cut = special;
    while (cut && !fits(`${cut}… (Notes)`, MW_CELLS.weaponSpecial)) cut = cut.slice(0, -1);
    set(`Weapon${n}Special`, `${cut.trim()}… (Notes)`);
    notes.push(`${name}: ${special}`);
    report.moved.push(`${name}: special properties → Other Notes`);
  });

  if (armorRow?.name) {
    set('ArmorName', armorRow.name); set('ArmorType', armorRow.type); set('ArmorBonus', signed(armor));
    set('ArmorCheck', armorRow.acp || ''); set('ArmorDex', armorRow.maxDex); set('ArmorSpell', armorRow.spellFailure);
    if (armorRow.active) set('ArmorWorn', '1');
  }
  if (shieldRow?.name) {
    set('ShieldName', shieldRow.name); set('ShieldType', shieldRow.type); set('ShieldBonus', signed(shield));
    set('ShieldCheck', shieldRow.acp || ''); set('ShieldSpell', shieldRow.spellFailure); set('ShieldWorn', '1');
  }
  const acp = -(Math.abs(num(armorRow?.active && armorRow.acp)) + Math.abs(num(shieldRow?.acp)));

  // Skills: 51 rows. A blank Craft/Lore/Perform/Profession/Artistry row goes
  // when a named one is trained, and a named one with no ranks goes. Misc is
  // what makes the sheet's sum (ability + ranks + misc + ACP, +3 for a trained
  // class skill) come to the app's total.
  const FAMILY = /^(craft|lore|perform|profession|artistry)$/i;
  const listed = (c.skills || []).map((s) => ({ s, name: s.name ? mwSkillName(s) : '' }));
  const trained = new Set(listed.filter((x) => x.s.spec && num(x.s.totalRanks) > 0).map((x) => String(x.s.name).toLowerCase()));
  const seen = new Set();
  let rows = listed.filter(({ s, name }) => {
    if (!name || seen.has(name.toLowerCase())) return false;
    seen.add(name.toLowerCase());
    if (FAMILY.test(s.name) && !s.spec && num(s.totalRanks) === 0 && trained.has(String(s.name).toLowerCase())) return false;
    if (FAMILY.test(s.name) && s.spec && num(s.totalRanks) === 0) { report.dropped.push(`skill ${name} (no ranks)`); return false; }
    return true;
  });
  if (rows.length > SKILL_ROWS) {
    const spare = new Set(rows.filter((r) => r.s.requiresTraining && num(r.s.totalRanks) === 0).slice(0, rows.length - SKILL_ROWS));
    spare.forEach((r) => report.dropped.push(`skill ${r.name} (trained only, no ranks)`));
    rows = rows.filter((r) => !spare.has(r));
  }
  if (rows.length > SKILL_ROWS) report.overflow.push(`${rows.length - SKILL_ROWS} skills past the sheet's ${SKILL_ROWS} rows`);
  rows.slice(0, SKILL_ROWS).forEach(({ s, name }, i) => {
    const k = `Skill${two(i + 1)}`;
    const ranks = num(s.totalRanks);
    const mod = num(s.abilityMod);
    const classSkill = !!s.classSkill;
    const penalty = s.armorPenalty ? acp : 0;
    const total = num(s.bonus);
    set(k, name); set(`${k}Ab`, String(s.abilities?.[0] || '').slice(0, 3)); if (classSkill) set(`${k}CC`, '1');
    set(`${k}Rank`, ranks); set(`${k}AbMod`, mod); set(`${k}ACP`, penalty); set(`${k}Mod`, total);
    set(`${k}MiscMod`, total - ranks - mod - penalty - (classSkill && ranks > 0 ? 3 : 0));
    if (!fits(name, MW_CELLS.skill)) report.clipped.push(`${k}: ${name}`);
  });
  set('MaxRank', level);

  // ---- Feats & Special Abilities.
  const groups = c.featGroups || [];
  const featLines = [];
  // Feat1-Feat10: one cell per level-up slot, written even when it is empty
  // or not reached yet, so the slots keep their places.
  const levelUp = groups.find((g) => g.levelUp)?.entries || [];
  for (let at = 1; at <= 19; at += 2) {
    const code = `f${two(at)}`;
    const e = levelUp.find((x) => num(x.detail) === at && x.name);
    if (!e || at > level) {
      if (e && e.name !== '???') report.dropped.push(`${code} ${e.name} (level ${at} not reached)`);
      featLines.push(code);
      continue;
    }
    const name = plain(e.name);
    let text = `${code} ${name}`;
    for (const step of [abbreviate, (s) => abbreviate(trimProse(s))]) {
      if (fits(text, MW_CELLS.feat)) break;
      text = `${code} ${step(name)}`;
      report.abbreviated.push(`${code}: "${name}" → "${text.slice(4)}"`);
    }
    featLines.push(text);
  }
  // A feat taken more than once is written once with a count. Outside the
  // level-up slots a feat's detail names its source, which the class columns
  // already show, so it is left out.
  const counted = (names) => {
    const stem = (x) => x.replace(/\s*\([^()]*\)\s*$/, '');
    const order = [];
    const n = new Map();
    for (const x of names) { if (!n.has(stem(x))) order.push(stem(x)); n.set(stem(x), (n.get(stem(x)) || 0) + 1); }
    return order.map((k) => (n.get(k) > 1 ? `${k} ×${n.get(k)}` : names.find((x) => stem(x) === k)));
  };
  const granted = c.grantedFeats || {};
  for (const g of [granted.drawback?.name && `Drawback: ${granted.drawback.name}`,
    granted.specialty?.name && `Specialty: ${granted.specialty.name}`,
    ...(granted.others || []).filter((o) => o.name && o.name !== '???').map((o) => `${o.source ? `${o.source}: ` : ''}${o.name}`)]) {
    if (g) featLines.push(...flow([plain(g)], MW_CELLS.feat));
  }
  // Class bonus feats go under their class in Spells & Powers.
  for (const g of groups.filter((x) => !x.levelUp && x.name !== 'Class')) {
    const names = counted(g.entries.filter((e) => e.name && e.name !== '???').map((e) => plain(e.name).replace(/\s*\((FCB[^)]*|Feat)\)/g, '').trim()));
    const label = g.name === 'Other/Flex' ? 'Flex' : g.name;
    if (names.length) featLines.push(...flow(names.map((x, i) => (i === 0 ? `${label}: ` : '') + x), MW_CELLS.feat));
  }

  // Veils, matched by name with plurals and punctuation ignored.
  const veilKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter(Boolean)
    .map((w) => w.replace(/s$/, '')).join(' ');
  const veils = (c.akashic?.slots || []).flatMap((s) => (s.veils || []).filter((v) => v.name).map((v) => ({ ...v, slot: s.slot, bound: s.bound })));
  const veilKeys = new Set(veils.map((v) => veilKey(v.name)));

  // Each class's feature ladder as the Progression tab draws it
  // (classFeatureRows), with its formulas worked out. The first column is the
  // class's feature list, whatever it is called, and its rule groups (base
  // class, archetype, path) are all features; any other column holds picks
  // named by their group, else by the column. Levels are the class's own;
  // `reached` is whether the character has that row yet, and `now` is the
  // class level the character is at.
  const tables = c.progression?.classFeatures || {};
  const columnName = (col) => String(col).split('\n')[0].replace(/\s*\(.*\)/, '').trim();
  const ladders = new Map();
  for (const k of c.classes || []) {
    if (!k.name || ladders.has(k.name)) continue;
    const columns = tables[k.name]?.columns || [];
    const listColumn = columns[0];
    let rows = [];
    try { rows = model.classFeatureRows(k.name); } catch { rows = []; }
    const entries = [];
    for (const row of rows) {
      for (const [col, cell] of Object.entries(row.cells || {})) {
        for (const f of cell.fields || []) {
          const text = f.on === false ? '' : plain(f.text).trim();
          if (!text) continue;
          const label = col === listColumn ? null : (f.group?.name || columnName(col));
          entries.push({ lv: row.classLevel, text, label, reached: row.level <= level });
        }
      }
    }
    const now = rows.filter((r) => r.level <= level).reduce((m, r) => Math.max(m, r.classLevel), 0);
    ladders.set(k.name, { now: now || level, entries, pickColumns: columns.slice(1).map(columnName) });
  }

  // A block per class: features up to the current level, the latest step of a
  // scaling feature only; then each pick column as one list under one label.
  const blocks = [];
  for (const k of c.classes || []) {
    const ladder = ladders.get(k.name);
    if (!ladder) continue;
    const entries = [];
    const picks = new Map();
    for (const e of ladder.entries.filter((x) => x.reached)) {
      // A list written as sentences ("Shield ally.") loses its full stops.
      if (!e.label) { e.text.split('\n').flatMap(items).forEach((it) => entries.push({ lv: e.lv, it: it.replace(/\.$/, '') })); continue; }
      for (const x of e.text.split('\n').map((s) => s.trim())) {
        if (!x || /:\s*$/.test(x) || /^\d+(\.\d+)?$/.test(x)) continue;
        // "TIJ: Curved Cut" names its own label; otherwise the group's or column's.
        const m = x.match(/^([^:()]{1,24}):\s*(.+)$/);
        const label = m ? m[1].trim() : e.label;
        // A veil is listed, with its level, under the class in Spells & Powers.
        const parts = items(m ? m[2] : x).map((p) => p.replace(/\.$/, ''));
        parts.filter((p) => veilKeys.has(veilKey(p))).forEach((p) => report.moved.push(`${k.name} ${e.lv}: veil ${p} → Spells & Powers`));
        const rest = parts.filter((p) => !veilKeys.has(veilKey(p)));
        if (!rest.length) continue;
        if (!picks.has(label)) picks.set(label, []);
        picks.get(label).push({ lv: e.lv, it: rest.join(', ') });
      }
    }
    // A bare slot ("Utility Wild Talent", "Monk Art") says nothing its pick
    // list does not: an entry with no detail that ends in a pick's label or a
    // pick column's name.
    const slotNames = [...picks.keys(), ...ladder.pickColumns].map((l) => featureKey(l).replace(/s$/, '')).filter(Boolean);
    const isSlot = (it) => !/[(:]/.test(it) && slotNames.some((s) => featureKey(it).replace(/s$/, '').endsWith(s));
    const latest = (list) => {
      const last = new Map();
      list.forEach((e, i) => last.set(featureKey(e.it), i));
      return list.filter((e, i) => {
        if (last.get(featureKey(e.it)) === i) return true;
        report.dropped.push(`${k.name} ${e.lv}: ${e.it} (a later step is listed)`);
        return false;
      });
    };
    const kept = latest(entries.filter((e) => !isSlot(e.it)));
    const marked = kept.map((e, i) => (i === 0 || kept[i - 1].lv !== e.lv ? `${e.lv}: ` : '') + e.it);
    // Labels stay as the player named the groups.
    for (const [label, list] of picks) latest(list).forEach((p, i) => marked.push((i === 0 ? `${label}: ` : '') + p.it));
    if (!marked.length) continue;
    // The heading names the archetypes when they fit, else the first one;
    // a list too long for either opens the block instead.
    const archetypes = String(k.archetypes || '').trim();
    let head = `${k.name} ${ladder.now}${archetypes ? ` (${archetypes})` : ''}`;
    let headLines = [head];
    if (!fits(head, MW_CELLS.feat)) {
      const first = items(archetypes)[0];
      head = first && fits(`${k.name} ${ladder.now} (${first})`, MW_CELLS.feat) ? `${k.name} ${ladder.now} (${first})` : `${k.name} ${ladder.now}`;
      headLines = /\(/.test(head) ? [head] : [head, ...flow([`Archetypes: ${archetypes}`], MW_CELLS.feat)];
    }
    blocks.push({ title: k.name, head, headLines, entries: marked, lines: [...headLines, ...flow(marked, MW_CELLS.feat)] });
  }
  // Mythic: the base abilities are the same for every character of a tier,
  // so only those carrying a number are written, in the heading.
  let mythic = null;
  if (mythicTier) {
    const base = (c.mythic?.baseAbilities || []).map(plain).flatMap(items);
    let head = `Mythic: ${mythicPath ? `${mythicPath} ` : ''}${mythicTier}`;
    const rest = [];
    for (const b of base.filter((x) => /\d/.test(x))) { if (fits(`${head}, ${b}`, MW_CELLS.feat)) head += `, ${b}`; else rest.push(b); }
    // One ability slot per tier; a slot past the tier is not reached yet.
    const reached = (c.mythic?.abilities || []).slice(0, mythicTier);
    const path = counted(reached.filter((a) => a.name).map((a) => plain(a.name)));
    const feats = reached.map((a) => a.featChoice).filter(Boolean).map(plain);
    const list = [...rest, ...path.map((p, i) => (i === 0 ? 'Path: ' : '') + p), ...feats.map((f, i) => (i === 0 ? 'M.Feats: ' : '') + f)];
    mythic = { title: 'Mythic', head, entries: list, lines: [head, ...flow(list, MW_CELLS.feat)] };
  }
  // Columns 2-4 hold 45 cells; the biggest blocks are shortened first, and
  // only as far as it takes.
  const shorten = (b, room) => {
    for (const step of [abbreviate, (s) => abbreviate(trimProse(s))]) {
      if (b.lines.length <= room) return;
      const lines = [...(b.headLines || [b.head]), ...flow(b.entries.map(step), MW_CELLS.feat)];
      if (lines.length < b.lines.length) { report.abbreviated.push(`${b.title}: ${b.lines.length} → ${lines.length} cells`); b.lines = lines; }
    }
  };
  const need = () => blocks.reduce((a, b) => a + b.lines.length, 0) + (mythic ? mythic.lines.length : 0);
  for (const b of [...blocks, mythic].filter(Boolean).sort((x, y) => y.lines.length - x.lines.length)) {
    if (need() <= ROWS * 3) break;
    shorten(b, b.lines.length - (need() - ROWS * 3));
  }
  // Classes run down columns 2, 3 and 4 and may continue into the next one; a
  // class does not start in a column's last two cells. Mythic sits under the
  // classes in column 4, and feats past Feat15 fill what is left.
  const cols = [[], [], [], []];
  const mythicRoom = mythic ? Math.min(mythic.lines.length, ROWS) : 0;
  const capacity = (ci) => ROWS - (ci === 3 ? mythicRoom : 0);
  let col = 1;
  for (const b of blocks) {
    if (cols[col].length && capacity(col) - cols[col].length < Math.min(3, b.lines.length) && col < 3) col++;
    const ls = [...b.lines];
    while (ls.length) {
      const room = capacity(col) - cols[col].length;
      if (room > 0) cols[col].push(...ls.splice(0, room));
      if (!ls.length) break;
      if (col < 3) col++; else break;
    }
    if (ls.length) { report.overflow.push(`${b.title}: ${ls.length} cells → Other Notes`); notes.push(`${b.title} (continued): ${ls.join(' ')}`); }
  }
  if (mythic) {
    const room = ROWS - cols[3].length;
    cols[3].push(...mythic.lines.slice(0, room));
    if (mythic.lines.length > room) {
      report.overflow.push(`Mythic: ${mythic.lines.length - room} cells → Other Notes`);
      notes.push(`Mythic (continued): ${mythic.lines.slice(room).join(' ')}`);
    }
  }
  const spill = featLines.slice(ROWS);
  cols[0].push(...featLines.slice(0, ROWS));
  for (const k of [3, 2, 1]) while (spill.length && cols[k].length < ROWS) cols[k].push(spill.shift());
  if (spill.length) { report.overflow.push(`Feats: ${spill.length} cells → Other Notes`); notes.push(`Feats (continued): ${spill.join(' ')}`); }
  FEAT_COLUMNS.forEach((keys, ci) => keys.forEach((k, ri) => {
    const v = cols[ci][ri];
    if (!v) return;
    set(k, v);
    if (!fits(v, MW_CELLS.feat)) report.clipped.push(`${k}: ${v}`);
  }));

  // ---- Spells & Powers, by class.
  const castTag = (s) => {
    if (!s) return '';
    if (fits(s, MW_CELLS.cast)) return s;
    const first = s.split(/\s+/)[0];
    if (fits(first, MW_CELLS.cast)) return first;
    let cut = first;
    while (cut && !fits(`${cut}.`, MW_CELLS.cast)) cut = cut.slice(0, -1);
    return `${cut}.`;
  };
  const fullName = (n) => String(n).replace(/^L\.\s*/, 'Legendary ').replace(/\bLeg\.\s*/g, 'Legendary ');
  const norm = (s) => ` ${String(s || '').toLowerCase().replace(/\blegendary\b|\bleg\.|\bl\./g, 'l').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const codes = new Set();
  const makeCode = (name) => {
    const words = fullName(name).split(/[\s\-/]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|a)$/i.test(w));
    let code = words.map((w) => w[0].toUpperCase()).join('') || 'X';
    // Two groups with the same initials: the second takes more of its last word.
    const last = words.at(-1) || 'X';
    for (let i = 1; codes.has(code) && i < last.length; i++) code += last[i].toUpperCase();
    codes.add(code);
    return code;
  };
  const spGroups = [];
  const newGroup = (name, extra = {}) => {
    const g = { name: fullName(name), code: makeCode(name), key: norm(name), entries: [], features: [], arche: [], ...extra };
    spGroups.push(g);
    return g;
  };
  for (const k of c.classes || []) {
    if (!k.name || spGroups.some((g) => g.className === k.name)) continue;
    const ladder = ladders.get(k.name);
    newGroup(k.name, {
      className: k.name,
      now: ladder?.now ?? level,
      features: (ladder?.entries || []).map((e) => ({ lv: e.lv, text: norm(e.text), raw: e.text })),
      arche: String(k.archetypes || '').split(/[,()]/).map(norm).filter((a) => a.trim().length >= 4),
    });
  }
  const classGroups = spGroups.slice();
  const findClass = (text) => {
    const t = norm(text);
    return classGroups.find((g) => t.includes(g.key)) || classGroups.find((g) => g.arche.some((a) => t.includes(a))) || null;
  };
  // The lowest level whose features mention a phrase: in the class given
  // first, then in any class, since a feature names its class more surely
  // than a source line does.
  const featureLevel = (phrase, first = null) => {
    const p = norm(phrase);
    if (p.trim().length < 4) return null;
    for (const g of first ? [first, ...classGroups.filter((x) => x !== first)] : classGroups) {
      const hit = g.features.filter((f) => f.text.includes(p)).sort((a, b) => a.lv - b.lv)[0];
      if (hit) return { g, lv: hit.lv };
    }
    return null;
  };
  const numberIn = (s) => {
    const m = String(s || '').match(/@\s*(\d+)/) || String(s || '').match(/(\d+)\s*\)?\s*$/);
    return m ? Number(m[1]) : null;
  };
  const lastParen = (s) => (String(s || '').match(/\(([^()]*)\)\s*$/) || [])[1] || '';
  const initials = (s) => String(s).split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
  const takenFeats = levelUp.filter((e) => e.name && e.name !== '???');
  // A talent named after a feat ("AMT" for Advanced Magic Training) dates from that feat.
  const featLevel = (s) => {
    const t = String(s || '').trim();
    if (!t) return null;
    const e = takenFeats.find((x) => norm(x.name) === norm(t) || initials(x.name.replace(/\(.*\)/, '')) === t.toUpperCase());
    return e ? num(e.detail) : null;
  };
  let mythicGroup = null;
  let oathGroup = null;
  const mythicOf = () => (mythicGroup ||= newGroup(`Mythic ${mythicPath}`.trim()));
  const oathOf = () => (oathGroup ||= newGroup('Oaths'));
  // An entry past the level its group has reached -- the class's own level,
  // the mythic tier, else the character's -- is not written yet.
  const add = (g, lv, text, cast, src) => {
    if (!g || !text || /^\?+$/.test(String(text).trim())) return;
    if (lv != null && lv > (g === mythicGroup ? mythicTier : g.now ?? level)) return;
    g.entries.push({ lv, text: plain(text).replace(/\s+/g, ' ').trim(), cast: cast || '', src });
  };
  const noLevel = (name, g) => report.noLevel.push(`${g.code}?? ${name}`);

  // Sphere talents, a side at a time. The tradition sits under the class it
  // is named for, else the side's class, at level 1.
  for (const [side, t] of [['Magic', c.training?.magic], ['Combat', c.training?.combat]]) {
    if (!t) continue;
    const taught = (t.classes || []).filter((k) => k.name && (k.levels || []).some((l) => l.talent && !l.future));
    const owner = taught.map((k) => findClass(k.name)).find(Boolean) || classGroups[0];
    const trad = t.tradition || {};
    const tOwner = (trad.name && findClass(trad.name)) || owner;
    const tradEntries = (trad.entries || []).filter((e) => e.talent);
    const drawbacks = trad.drawbacks || [];
    if (trad.name && (tradEntries.length || drawbacks.length)) add(tOwner, 1, `${side} tradition: ${trad.name}`, '', 'tradition');
    tradEntries.forEach((e) => items(plain(e.talent)).forEach((x) => add(tOwner, 1, x, castTag(e.sphere), 'tradition')));
    if (drawbacks.length && tOwner) {
      const room = [MW_CELLS.spell[0] - textWidth(`${tOwner.code}01z `), MW_CELLS.spell[1]];
      const lines = flow(drawbacks.map((x) => trimProse(plain(x))), room);
      if (fits(`Drawbacks: ${lines[0]}`, room)) lines[0] = `Drawbacks: ${lines[0]}`; else lines.unshift('Drawbacks:');
      lines.forEach((l) => add(tOwner, 1, l, '', 'tradition'));
    }
    for (const k of taught) {
      const g = findClass(k.name) || newGroup(k.name);
      for (const l of k.levels) if (l.talent && !l.future) add(g, num(l.level), l.talent, castTag(l.sphere), 'talent');
    }
    // A bonus talent's source names where it came from, and usually when.
    for (const b of t.bonusTalents || []) {
      if (!b.talent || /^\?+$/.test(b.talent.trim())) continue;
      const src = String(b.source || '');
      let g = null;
      let lv = null;
      if (/^mythic/i.test(src)) { g = mythicOf(); lv = numberIn(src); }
      else if (/^oath/i.test(src)) { g = oathOf(); lv = numberIn(src); }
      else if (/tradition/i.test(src) || (trad.name && norm(src) === norm(trad.name))) { g = tOwner; lv = 1; }
      else if (src) {
        g = findClass(src);
        lv = numberIn(src);
        if (lv == null) { const hit = featureLevel(lastParen(src), g); if (hit) { g = hit.g; lv = hit.lv; } }
        if (lv == null) lv = featLevel(src);
        g ||= owner;
      } else { g = owner; lv = featLevel(b.talent); }
      if (!g) continue;
      if (lv == null) noLevel(b.talent, g);
      add(g, lv, b.talent, castTag(b.sphere), 'bonus talent');
    }
  }
  // Class bonus feats: the detail names the class and a level or the feature
  // that granted the feat.
  for (const e of (groups.find((g) => g.name === 'Class')?.entries || []).filter((x) => x.name && x.name !== '???')) {
    const detail = String(e.detail || '');
    let g = findClass(detail);
    let lv = numberIn(detail);
    if (lv == null) { const hit = featureLevel(e.name.replace(/\s*\(.*\)$/, '')); if (hit) { g = hit.g; lv = hit.lv; } }
    if (lv == null && lastParen(detail)) { const hit = featureLevel(lastParen(detail), g); if (hit) { g = hit.g; lv = hit.lv; } }
    g ||= classGroups[0];
    if (!g) continue;
    if (lv == null) noLevel(e.name, g);
    add(g, lv, e.name.replace(/\s*\((FCB[^)]*|Feat)\)/g, '').trim(), 'Feat', 'bonus feat');
  }
  // Veils: under the class whose features name the veil, at that level, else
  // under the veilweaving class. The Cast column carries the essence.
  const akashic = (c.akashic?.classes || []).filter((k) => k.name).map((k) => ({ k, g: findClass(k.name) })).filter((x) => x.g);
  for (const { k, g } of akashic) {
    const parts = [num(k.baseDC) && `DC ${k.baseDC}`, num(k.totalCap) && `essence cap ${k.totalCap}`].filter(Boolean);
    if (parts.length) add(g, 1, `Veilweaving: ${parts.join(', ')}`, '', 'veil');
  }
  for (const v of veils) {
    let g = null;
    let lv = null;
    for (const cg of classGroups) {
      const hit = cg.features.filter((f) => ` ${veilKey(f.raw)} `.includes(` ${veilKey(v.name)} `)).sort((a, b) => a.lv - b.lv)[0];
      if (hit) { g = cg; lv = hit.lv; break; }
    }
    g ||= akashic[0]?.g || classGroups[0];
    if (!g) continue;
    if (lv == null) noLevel(v.name, g);
    const short = `${v.name} (${v.slot}${v.bound ? ', bound' : ''}${v.dc ? `, DC ${v.dc}` : ''})`;
    const desc = plain(v.desc).replace(/\s+/g, ' ').trim();
    const long = desc ? `${short.slice(0, -1)}; ${desc})` : short;
    add(g, lv, desc && fits(`${g.code}00z ${long}`, MW_CELLS.spell) ? long : short, v.essence ? `${v.essence} ess` : '', 'veil');
  }
  // Maneuvers: under the initiator class -- the one tagged path-of-war, else
  // one named as an initiator. The app keeps each maneuver's level, not when
  // it was learned, so NN is the first initiator level that can learn it
  // (2 x maneuver level - 1).
  const disciplines = (c.maneuvers?.disciplines || []).filter((x) => (x.known || []).length);
  if (disciplines.length) {
    const tagged = (c.classes || []).find((k) => (k.systems || []).includes('path-of-war'));
    const g = (tagged && classGroups.find((x) => x.className === tagged.name))
      || classGroups.find((x) => /warlord|warder|stalker|mystic|harbinger|zealot/i.test(x.name))
      || classGroups.find((x) => x.features.some((f) => / maneuver| initiat/.test(f.text))) || classGroups[0];
    for (const dsc of disciplines) {
      for (const name of dsc.known) {
        const info = [...(dsc.custom || []), ...(dsc.entries || [])].find((x) => x?.name && norm(x.name) === norm(name));
        const ml = num(info?.level) || null;
        add(g, ml ? 2 * ml - 1 : null, `${name} (${dsc.name}${ml ? ` ${ml}` : ''})`, castTag(info?.kind === 'stance' ? 'Stance' : info?.type || ''), 'maneuver');
      }
    }
  }
  if ((c.vancian?.classes || []).length || (c.psionics?.classes || []).length) report.overflow.push('Vancian spells and psionic powers are not exported yet');

  const spellRows = [];
  const SRC_ORDER = { tradition: 0, talent: 1, 'bonus talent': 2, 'bonus feat': 3, veil: 4, maneuver: 5 };
  for (const g of spGroups) {
    // One entry per talent per level: a ladder listed on both sides, or a
    // tradition entry that a bonus talent repeats with its details, is kept
    // once, in its fuller form.
    const stem = (s) => norm(String(s).replace(/\s*\(.*\)\s*$/, ''));
    const best = new Map();
    for (const e of g.entries) {
      const k = `${e.lv}|${stem(e.text)}`;
      const had = best.get(k);
      if (!had || e.text.length > had.text.length) best.set(k, e);
    }
    const entries = g.entries.filter((e) => best.get(`${e.lv}|${stem(e.text)}`) === e)
      .map((e, i) => ({ ...e, i }))
      .sort((a, b) => (a.lv ?? 99) - (b.lv ?? 99) || (SRC_ORDER[a.src] ?? 9) - (SRC_ORDER[b.src] ?? 9) || a.i - b.i);
    if (!entries.length) continue;
    spellRows.push({ name: `${g.code}00 === ${g.name} ===`, cast: '' });
    const perLevel = new Map();
    for (const e of entries) perLevel.set(e.lv, (perLevel.get(e.lv) || 0) + 1);
    if (Math.max(...perLevel.values()) > 26) report.overflow.push(`${g.code}: more than 26 entries at one level`);
    const nth = new Map();
    for (const e of entries) {
      nth.set(e.lv, (nth.get(e.lv) || 0) + 1);
      const code = `${g.code}${e.lv == null ? '??' : two(e.lv)}${perLevel.get(e.lv) > 1 ? String.fromCharCode(96 + nth.get(e.lv)) : ''}`;
      let body = e.text;
      if (!fits(`${code} ${body}`, MW_CELLS.spell)) {
        const s = abbreviate(trimProse(body));
        if (s !== body) { report.abbreviated.push(`${code}: "${body}" → "${s}"`); body = s; }
      }
      // Still too long: it carries on in a row coded "XYZNNa+", which sorts
      // straight after its own.
      const room = [MW_CELLS.spell[0] - textWidth(`${code}+ `), MW_CELLS.spell[1]];
      const [first, ...more] = fits(`${code} ${body}`, MW_CELLS.spell) ? [body] : flow([body], room);
      spellRows.push({ name: `${code} ${first.replace(/,$/, '')}`, cast: e.cast });
      more.forEach((m) => spellRows.push({ name: `${code}+ ${m}`, cast: '' }));
    }
  }
  // The sheet's Table.sort compares names as plain strings.
  spellRows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (spellRows.length > SPELL_ROWS) report.overflow.push(`${spellRows.length - SPELL_ROWS} Spells & Powers rows past ${SPELL_ROWS}`);
  spellRows.slice(0, SPELL_ROWS).forEach((r, i) => {
    const k = `Spell${two(i + 1)}`;
    set(k, r.name); set(`${k}Cast`, r.cast);
    if (!fits(r.name, MW_CELLS.spell)) report.clipped.push(`${k}: ${r.name}`);
  });

  // Languages and gear.
  (id.languages || []).filter(Boolean).slice(0, 18).forEach((l, i) => set(`Lang${i + 1}`, l));
  [...(c.equipment?.gear || []), ...(c.equipment?.other || [])].filter((g) => g.name).slice(0, 43).forEach((g, i) => {
    const k = `Gear${two(i + 1)}`;
    set(k, g.name); set(`${k}W`, num(g.weight) || '');
    // The sheet's own key for the location column.
    set(`${k}01Loc`, g.slot && !/^other/i.test(g.slot) ? g.slot : '');
  });

  // Text boxes. Trait slots are keyed trait1..N and additional; drawbacks are
  // drawback1..N and majorDrawback.
  const slots = Object.entries(c.traitSlots || {}).filter(([, t]) => t?.name);
  const traitLine = (t) => `${t.name}${t.category ? ` (${t.category})` : ''}${t.text ? `: ${t.text}` : ''}`;
  set('__txt_char_traits', slots.filter(([k]) => !/drawback/i.test(k)).map(([, t]) => traitLine(t)).join('\n'));
  set('__txt_char_flaws', slots.filter(([k]) => /drawback/i.test(k)).map(([k, t]) => (/major/i.test(k) ? 'Major: ' : '') + traitLine(t)).join('\n'));
  const prof = id.proficiencies || {};
  const proficiencies = [prof.familiarities?.length && `${prof.familiarities.join(', ')} weapons`, prof.weapons?.length && prof.weapons.join(', '),
    prof.armor?.length && `Armor: ${prof.armor.join(', ')}`, prof.shields?.length && `Shields: ${prof.shields.join(', ')}`].filter(Boolean).join('; ');
  set('__txt_Notes', [proficiencies && `Proficiencies: ${proficiencies}`, ...notes, publishedUrl && `Full sheet: ${publishedUrl}`]
    .filter(Boolean).join('\n\n'));

  out._meta_sheet_data_version = '1';
  return { fields: out, report };
}
