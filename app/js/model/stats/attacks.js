/**
 * Attacks: the six attack modes, the weapon rows, and unarmed damage.
 *
 * BAB and the melee/ranged/CMB totals are formulas in rules.js; the iteratives
 * come from rules.js too. What is here is the per-weapon work -- substituting
 * names into dice expressions, adding the forwarded bonuses, and working out
 * criticals -- plus the carried weight and value the same pass sums.
 */

import {
  ALT_ATTACK_OF, ASURA_TALENTS_PER_ESSENCE, ASURA_VEIL, BRAWLERS_VEST_TALENTS,
  TALENTED_KNUCKLE_TALENTS, UNARMED_NATIVE_THRESHOLD, UNARMED_SPHERES, UNORTHODOX_FEAT,
  UNORTHODOX_SPHERES_PER_FEAT,
  addDice, diceAverage, diceString, fmt, ladderRung, parseDiceExpr, sizeMod, statMod,
  stepDice, unarmedDice,
} from '../../rules.js';
import { evaluateFormula } from '../../formula.js';
import { weaponProficient } from '../document.js';
import { emit } from '../events.js';
import { forwarded } from '../scope.js';
import { sphereTally } from '../spheres.js';
import { slug } from '../util.js';

/**
 * The four numbers a forwarded bonus can reach on a weapon, longest name
 * first so "damage.crit" is never read as "damage" with something else in
 * front of it. They mirror the [[...]] token keywords exactly, because they
 * are the same four rules written a different way.
 */
export const WEAPON_CHANNEL_LABELS = [
  ['damage.mult', 'Damage, multiplied on a crit'],
  ['damage.crit', 'Damage on a crit only'],
  ['damage', 'Damage'],
  ['attack', 'Attack'],
];

export const WEAPON_CHANNELS = WEAPON_CHANNEL_LABELS.map(([ch]) => ch);

/** Selectors that pick weapons by how they are used rather than by name. */
export const WEAPON_SHAPES = new Set(['melee', 'ranged', 'cmb']);

/**
 * The short name a formula calls a weapon by, worked out from its own.
 *
 * A weapon's name is written for the table, not for a formula: "Chef's Knife
 * (Bastard Sword) & Cutting Board" is the joke, the statistics and the off-hand
 * all in one string, and slugging the lot gives a handle nobody will type
 * twice. So it is cut at the first bracket, ampersand or comma -- which is
 * where a weapon's name usually stops and its bookkeeping begins -- and the
 * apostrophes go, because `chef_s` is not what anyone means by Chef's.
 *
 * It is only the default. The row has a field for it, and what a player writes
 * there wins.
 */
export function weaponHandle(name) {
  const strip = (v) => String(v ?? '').replace(/['’]/g, '');
  const head = strip(name).split(/[(&,\/[]/)[0].trim();
  const from = head || strip(name).trim();
  return from ? slug(from) : 'weapon';
}

/**
 * Weapons and load. Each weapon's attack is its base mode total plus
 * enhancement and misc; damage is dice + floor(ability × mult) + misc +
 * enhancement. A per-weapon offset reconciles against the workbook's cached
 * attack roll, so imports match and edits still move the number.
 */
/**
 * The short name each weapon answers to in a formula, in row order.
 *
 * The Formula name field on the row if there is one, the name cut down if
 * there is not, and a number on the end where two would otherwise collide --
 * two Craft rows can share a skill name harmlessly, but two weapons sharing
 * a handle would send one weapon's bonus to both.
 */
export function weaponHandles(model) {
  const seen = new Set();
  return (model.data.equipment?.weapons || []).map((w) => {
    const typed = String(w?.id ?? '').trim();
    let id = typed ? slug(typed) : weaponHandle(w?.name);
    if (seen.has(id)) {
      let n = 2;
      while (seen.has(`${id}${n}`)) n += 1;
      id = `${id}${n}`;
    }
    seen.add(id);
    return id;
  });
}

export function recomputeEquipment(model) {
  const c = model.data;
  const e = c.equipment;
  if (!e) return;
  const handles = model.weaponHandles();

  const modeBase = (type) => {
    const modes = {
      Melee: 'melee', 'Alt Melee': 'altMelee', Ranged: 'ranged',
      'Alt Ranged': 'altRanged', CMB: 'cmb', 'Alt CMB': 'altCmb',
    };
    const key = modes[type];
    if (!key) return null;
    const m = c.attack.modes[key];
    // The same sum the Overview's own melee/ranged/CMB totals are built from,
    // forwarded bonuses included: `{attack.melee += 2}` has to mean the same
    // thing on a weapon row as it does in the Attack panel, or the two
    // numbers for one attack disagree.
    return (Number(c.attack.bab) || 0)
      + statMod(c, m?.stat1, m?.stat2)
      - sizeMod(c)
      + (Number(c.attack.miscBonus) || 0)
      + forwarded(model, `attack.${ALT_ATTACK_OF[key] || key}`);
  };

  const unarmedDiceNow = c.training?.combat?.unarmed?.dice;
  const scope = model.scope();
  const evalFormula = (src) => evaluateFormula(src, scope);
  const prof = c.identity?.proficiencies;

  /**
   * Put the value of every {name} and {= …} into the text, before anything
   * tries to read it as dice or as a formula.
   *
   * A weapon's fields are not formulas, they are dice expressions with
   * formulas in them -- "2d6 + con.mod", "[[4d8 crit]]" -- so a name in one
   * cannot simply be evaluated: it has to be *substituted*, because the
   * name may hold dice text rather than a number. {kinetic.fist} is "4d8"
   * and has to reach the dice reader as those characters; {deathgrip.dmg}
   * is 13 and has to reach the formula reader as that number. Splicing the
   * value in as text is the one treatment that serves both.
   *
   * Braces are prose syntax, and the sandbox has never known what to do
   * with them: without this, every one of these reported the tokeniser's
   * "Unexpected character" and quietly contributed nothing.
   */
  const spliceNames = (text) => {
    const src = String(text ?? '');
    if (!src.includes('{')) return { text: src, error: null };
    let error = null;
    const out = src.replace(/\{([^{}]*)\}/g, (whole, inner) => {
      const expr = inner.trim().replace(/^=\s*/, '').trim();
      if (!expr) return whole;
      try {
        const v = evaluateFormula(expr, scope);
        return typeof v === 'number' ? String(v) : String(v ?? '');
      } catch (err) {
        // Just the reason: every caller already shows the text it came from,
        // and "Unknown value X" names the culprit itself.
        error = error || err.message;
        return '';
      }
    });
    return { text: out, error };
  };

  for (const [wi, w] of e.weapons.entries()) {
    // What a formula calls this weapon. Resolved rather than stored so the
    // field on the row keeps whatever the player typed into it, caret and
    // all, while the name a rule has to use is settled here.
    w.handle = handles[wi];
    // Read against the row's own Proficient field, the [Enhanced] veil rule
    // and the Overview's proficiencies; a `false` is shown, not applied --
    // the -4 is the player's to write, as it always was.
    const pr = weaponProficient(prof, w);
    w.proficient = pr.state;
    w.proficiencyWhy = pr.why;
    w.proficiencySource = pr.source;
    // The Dice field may reference an inline name or hold a formula:
    //   "12d8"                 literal
    //   "{kinetic.fist}"       a {name = …} defined in prose (may be dice text
    //                          like "4d6", or a number = count of d6)
    //   "{= …}" / "[[…]]"      an inline expression, same rules
    w.diceError = null;
    let diceText = w.dice ?? '';
    const ref = String(diceText).trim().match(/^(?:\{\{|\[\[|\{)\s*=?\s*(.+?)\s*(?:\}\}|\]\]|\})$/);
    if (ref) {
      try {
        const v = evaluateFormula(ref[1], scope);
        // A whole field that is one name: a number means that many d6, the
        // kineticist blast rule. Only here -- a name spliced into the middle
        // of an expression is worth the number it says.
        diceText = typeof v === 'number' ? `${Math.floor(v)}d6` : String(v ?? '');
      } catch (err) {
        w.diceError = err.message;
        diceText = '';
      }
    } else {
      const named = spliceNames(diceText);
      diceText = named.text;
      w.diceError = named.error;
    }
    w.diceResolved = w.useUnarmedDice && unarmedDiceNow ? unarmedDiceNow : diceText;
    const base = modeBase(w.attackType);
    const attack = (base ?? (Number(w.baseOverride) || 0))
      + (Number(w.enhancement) || 0) + (Number(w.miscAttack) || 0);
    if (w.attackOffset === undefined) {
      w.attackOffset = w.sheetAttack != null ? (Number(w.sheetAttack) || 0) - attack : 0;
    }
    w.forwardedAttack = forwarded(model, `weapon.${wi}.attack`);
    w.attackTotal = attack + w.attackOffset + w.forwardedAttack;

    const abilityPart = w.damageAbility
      ? Math.floor(statMod(c, w.damageAbility, null) * (Number(w.abilityMult) || 1))
      : 0;
    // Misc damage is flat damage that behaves like the weapon's own -- it
    // multiplies on a crit -- and it is often a rule rather than a number
    // ("Int mod + invested essence x2"), so it resolves in the sandbox like
    // every other value a player may write. It used to take a plain number
    // and read a formula as 0, silently.
    const misc = spliceNames(w.miscDamage);
    w.miscDamageNum = 0;
    w.miscDamageError = misc.error;
    if (String(misc.text).trim()) {
      try {
        w.miscDamageNum = Math.floor(Number(evalFormula(misc.text)) || 0);
      } catch (err) {
        w.miscDamageError = w.miscDamageError || err.message;
      }
    }
    const bonus = abilityPart + w.miscDamageNum + (Number(w.enhancement) || 0);
    w.damageBonus = bonus;
    w.damageTotal = `${w.diceResolved || '—'}${bonus ? fmt(bonus) : ''}`;

    // Inline bonuses written into the special-properties text:
    //   {{…}} adds to hit, [[…]] adds damage — dice, a sandbox formula, a
    //   {name} defined in prose, or a mix ("2d6 + con.mod").
    //
    // Two keywords say when the damage happens and whether it multiplies,
    // which between them cover every rule an ability is written with:
    //
    //   [[6]]        every hit, and added once more on a crit -- the usual
    //                rider (flaming, sneak attack), which the rules do not
    //                multiply
    //   [[6 Crit]]   only on a confirmed crit, and multiplied
    //   [[6 Mult]]   every hit, and multiplied on a crit -- damage that
    //                behaves like the weapon's own, with no "not multiplied"
    //                caveat on it (Deathgrip Gauntlets)
    //
    //   {{4}}        attack and confirmation rolls
    //   {{4 Crit}}   confirmation rolls only
    //
    // Mult means nothing on an attack token: attack rolls are not multiplied.
    const special = String(w.special ?? '');
    const parseTokens = (re, damage) => [...special.matchAll(re)].map((m) => {
      const raw = m[1].trim();
      const crit = /\bcrit\b/i.test(raw);
      const mult = damage && !crit && /\bmult(iplied)?\b/i.test(raw);
      const named = spliceNames(raw.replace(/\b(?:crit|mult(?:iplied)?)\.?\b/gi, ' '));
      const p = parseDiceExpr(named.text, evalFormula);
      // The token still reads as what the player wrote; only the fault, if
      // there is one, comes from the name that would not resolve.
      return { text: raw, crit, mult, ...p, error: named.error || p.error };
    });
    const atkTokens = parseTokens(/\{\{(.+?)\}\}/gs, false);
    const dmgTokens = parseTokens(/\[\[(.+?)\]\]/gs, true);

    const baseDice = parseDiceExpr(w.diceResolved, null);
    const tok = (list) => list.reduce(
      (acc, t) => ({ dice: addDice(acc.dice, t.dice), flat: acc.flat + (t.error ? 0 : t.flat) }),
      { dice: {}, flat: 0 },
    );
    // Forwarded damage joins the token pools rather than sitting beside
    // them: a bonus written as a rule elsewhere on the sheet is the same
    // kind of thing as one written in this weapon's own properties, and the
    // crit line has to add both up the same way.
    const fwdDmg = (ch) => forwarded(model, `weapon.${wi}.${ch}`);
    const atk = tok(atkTokens.filter((t) => !t.crit));
    const dmg = tok(dmgTokens.filter((t) => !t.crit && !t.mult));
    dmg.flat += fwdDmg('damage');
    // Damage on every hit that multiplies with the weapon: it joins the
    // normal total like a rider, and the crit multiplier takes it with the
    // base rather than adding it once afterwards.
    const multDmg = tok(dmgTokens.filter((t) => t.mult));
    multDmg.flat += fwdDmg('damage.mult');
    const critAtk = tok(atkTokens.filter((t) => t.crit));
    const critDmg = tok(dmgTokens.filter((t) => t.crit));
    critDmg.flat += fwdDmg('damage.crit');
    // The weapon's own Bonus Crit Damage column joins the crit-only pool,
    // and reads names the same way the tokens do.
    const bcdNamed = spliceNames(w.bonusCritDamage);
    const bcdParsed = parseDiceExpr(bcdNamed.text, evalFormula);
    const bcd = { ...bcdParsed, error: bcdNamed.error || bcdParsed.error };
    const critExtra = {
      dice: addDice(critDmg.dice, bcd.error ? {} : bcd.dice),
      flat: critDmg.flat + (bcd.error ? 0 : bcd.flat),
    };

    w.calc = {
      baseAtk: w.attackTotal,
      baseDmgDice: baseDice.dice,
      baseDmgFlat: baseDice.flat + bonus,
      baseAvg: diceAverage(baseDice.dice, baseDice.flat + bonus),
      notes: baseDice.notes,
      atkTokens,
      dmgTokens,
      tokAtk: atk,
      tokDmg: dmg,
      totalAtk: w.attackTotal + atk.flat,
      totalAtkStr: Object.keys(atk.dice).length
        ? `${fmt(w.attackTotal + atk.flat)}+${diceString(atk.dice)}`
        : fmt(w.attackTotal + atk.flat),
      tokMultDmg: multDmg,
      totalDmgDice: addDice(addDice(baseDice.dice, dmg.dice), multDmg.dice),
      totalDmgFlat: baseDice.flat + bonus + dmg.flat + multDmg.flat,
      errors: [...atkTokens, ...dmgTokens].filter((t) => t.error)
        .map((t) => `${t.text}: ${t.error}`),
    };
    w.calc.totalDmgStr = diceString(w.calc.totalDmgDice, w.calc.totalDmgFlat)
      + (baseDice.notes.length ? ` ${baseDice.notes.join(' ')}` : '');
    w.calc.totalAvg = diceAverage(w.calc.totalDmgDice, w.calc.totalDmgFlat);
    // A weapon whose only extra damage was forwarded here still has parts
    // worth showing, so the breakdown opens for it too.
    w.forwardedDamage = { plain: fwdDmg('damage'), mult: fwdDmg('damage.mult'), crit: fwdDmg('damage.crit') };
    const anyForwarded = Object.values(w.forwardedDamage).some(Boolean) || !!w.forwardedAttack;
    w.calc.hasTokens = atkTokens.length > 0 || dmgTokens.length > 0 || anyForwarded;

    // Criticals. What multiplies and what does not:
    //   - base weapon damage, ability, enhancement and misc: multiplied;
    //   - [[… Mult]] tokens: multiplied, with the base;
    //   - untagged [[…]] tokens: added once, unmultiplied (damage riders);
    //   - [[… Crit]] tokens: crit-only damage, multiplied;
    //   - the Bonus Crit Damage column: crit-only, unmultiplied (burst dice);
    //   - {{… Crit}}: applies to confirmation rolls only.
    const multMatch = String(w.critMult ?? '').match(/(\d+)/);
    const critMultNum = Math.max(2, multMatch ? Number(multMatch[1]) : 2);
    const critTagged = critDmg;
    const hasCritTagged = Object.keys(critTagged.dice).length > 0 || critTagged.flat !== 0;
    const hasBcd = !bcd.error && (Object.keys(bcd.dice).length > 0 || bcd.flat !== 0);
    w.calc.critMultNum = critMultNum;
    w.calc.critAtk = critAtk;
    w.calc.critTagged = critTagged;
    w.calc.critExtra = critExtra;
    w.calc.hasCritTokens = atkTokens.some((t) => t.crit) || dmgTokens.some((t) => t.crit)
      || !!w.forwardedDamage.crit;
    w.calc.confirmTotal = w.calc.totalAtk + critAtk.flat;
    w.calc.confirmStr = Object.keys(critAtk.dice).length
      ? `${fmt(w.calc.confirmTotal)}+${diceString(critAtk.dice)}`
      : fmt(w.calc.confirmTotal);
    // Everything that multiplies is gathered first and multiplied once, so
    // the printed string can be read straight down: (base + mult)×N + …
    const multBase = {
      dice: addDice(baseDice.dice, multDmg.dice),
      flat: baseDice.flat + bonus + multDmg.flat,
    };
    w.calc.critAvg = Math.round((
      diceAverage(multBase.dice, multBase.flat) * critMultNum
      + diceAverage(dmg.dice, dmg.flat)
      + diceAverage(critTagged.dice, critTagged.flat) * critMultNum
      + (hasBcd ? diceAverage(bcd.dice, bcd.flat) : 0)
    ) * 10) / 10;
    // Every term, in the order they are worked out, so the string adds up to
    // the average printed beside it. A bare "×2" could not: the multiplier
    // takes the base and nothing else, so a weapon showing "dmg 10 · crit ×2"
    // with an average of 15 gave a reader no way of reaching 15 from what
    // the row said, and read as though the rider had been dropped.
    const hasRiders = Object.keys(dmg.dice).length > 0 || dmg.flat !== 0;
    // Only a term of more than one part needs bracketing to keep × from
    // looking as though it binds to the last bit of it.
    const critTerm = (t) => (/[+-]/.test(String(t).slice(1)) ? `(${t})` : t);
    w.calc.critStr = [
      `${critTerm(diceString(multBase.dice, multBase.flat))}×${critMultNum}`,
      hasRiders ? `+${diceString(dmg.dice, dmg.flat).replace(/^\+/, '')}` : '',
      hasCritTagged ? `+${critTerm(diceString(critTagged.dice, critTagged.flat).replace(/^\+/, ''))}×${critMultNum}` : '',
      hasBcd ? `+${diceString(bcd.dice, bcd.flat).replace(/^\+/, '')}` : '',
    ].filter(Boolean).join('');
  }

  // Carried weight: every section's weights, plus a manual adjustment that
  // reconciles the imported figure.
  const sum = (arr, key = 'weight') => (arr || []).reduce((t, x) => t + (Number(x[key]) || 0), 0);
  const computed = sum(e.gear) + sum(e.other) + (Number(e.armor?.weight) || 0)
    + sum(e.shields) + sum(e.weapons);
  if (c.carry.carriedOffset === undefined) {
    c.carry.carriedOffset = (Number(c.carry.carried) || 0) - computed;
  }
  e.totalWeight = computed;
  c.carry.carried = computed + (Number(c.carry.carriedOffset) || 0);
  e.totalValue = sum(e.gear, 'cost') + sum(e.other, 'cost')
    + (Number(e.armor?.cost) || 0) + sum(e.shields, 'cost') + sum(e.weapons, 'price');
}

/* ------------------------------------------------------------------ *
 * Gear columns.
 *
 * The workbook's Equipment sheet gave every item three typed bonuses and
 * four freeform columns, and that is what the import carries. Three was
 * never a rule -- it is how wide the spreadsheet happened to be -- so the
 * count is the table's to set: a ring with four properties needs a fourth
 * pair, and a character who never writes in the Other columns should not
 * scroll past four empty ones.
 *
 * How many there are is not stored anywhere. It is the longest row in the
 * list, which makes the data its own answer: no count to keep in step with
 * the rows, nothing to migrate, and a document saved by an older build
 * reports exactly the columns it has.
 * ------------------------------------------------------------------ */

/** An empty cell of each kind, so adding a column adds the right shape. */
const GEAR_COLUMN_BLANK = { bonuses: () => ({ value: null, type: null }), others: () => null };

/** The floor: a table with no columns at all has nothing to fill in. */
const GEAR_COLUMN_MIN = { bonuses: 1, others: 1 };

/**
 * How many columns of `kind` the list shows -- the longest row in it, never
 * fewer than one. An empty list still offers the workbook's own three and
 * four, because that is the shape the next item added will have.
 */
export function gearColumnCount(rows, kind) {
  const lengths = (rows || []).map((g) => (Array.isArray(g?.[kind]) ? g[kind].length : 0));
  if (!lengths.length) return kind === 'bonuses' ? 3 : 4;
  return Math.max(GEAR_COLUMN_MIN[kind], ...lengths);
}

/** Does any row have something written in the last column of `kind`? */
export function gearColumnInUse(rows, kind) {
  const at = gearColumnCount(rows, kind) - 1;
  return (rows || []).some((g) => {
    const cell = g?.[kind]?.[at];
    if (cell === null || cell === undefined || cell === '') return false;
    // A bonus is two boxes; either one written on is the column being used.
    if (kind === 'bonuses') return cell.value != null && cell.value !== '' ? true : !!cell.type;
    return true;
  });
}

/**
 * Add or drop a column across every row of a gear list at once.
 *
 * Every row keeps the same shape, because they are columns of one table and
 * a row that was short would read as a row with a blank in it. `delta` is +1
 * or -1; dropping the last column is refused when it would leave the list
 * with none.
 */
export function setGearColumns(model, list, kind, delta) {
  const rows = model.list(list);
  if (!rows || !GEAR_COLUMN_BLANK[kind]) return model;
  const now = gearColumnCount(rows, kind);
  const want = Math.max(GEAR_COLUMN_MIN[kind], now + (delta > 0 ? 1 : -1));
  if (want === now) return model;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (!Array.isArray(row[kind])) row[kind] = [];
    while (row[kind].length < want) row[kind].push(GEAR_COLUMN_BLANK[kind]());
    row[kind].length = want;
  }
  model.recompute();
  emit(model, {
    type: 'set', path: `${list}:columns:${kind}`, value: want,
  });
  return model;
}

export function recomputeUnarmed(model) {
  const t = model.data.training?.combat;
  if (!t?.unarmed) return;
  const u = t.unarmed;
  // The Unorthodox sphere list was once one comma-separated field; it is
  // picks now, two per Unorthodox Unarmed Training feat on the character.
  if (typeof u.otherSpheresText === 'string') {
    u.otherSpheres = u.otherSpheresText.split(',').map((s) => s.trim()).filter(Boolean);
    delete u.otherSpheresText;
  }
  if (!Array.isArray(u.otherSpheres)) u.otherSpheres = [];
  u.unorthodoxFeats = model.featCount(UNORTHODOX_FEAT);
  u.unorthodoxSlots = Math.max(u.unorthodoxFeats * UNORTHODOX_SPHERES_PER_FEAT,
    u.otherSpheres.filter(Boolean).length);
  // Talented Knuckle and the Brawler's Vest are had or not; a document that
  // still carries the sheet's numbers (2 and 4) reads them as had.
  u.talentedKnuckle = !!u.talentedKnuckle;
  u.brawlersVest = !!u.brawlersVest;
  // The Bands of the Asura veil: its invested essence, wherever it is shaped.
  u.asuraEssence = [...(model.data.akashic?.slots || []), ...(model.data.akashic?.kheshig || [])]
    .flatMap((h) => h.veils || [])
    .filter((v) => ASURA_VEIL.test(String(v?.name || '')))
    .reduce((n, v) => n + (Number(v.essence) || 0), 0);
  delete u.veilEssence;
  // The sheet counts class and bonus talents only, never tradition ones;
  // includeTradition is an explicit player toggle on top of that.
  //
  // Every customized weapon counts here, drawn or stowed -- the third of the
  // three questions the tracks get asked, and the only place that asks it. A
  // die progression is a constant, and the armiger "does not suddenly lose
  // lingering benefits of these talents because they sheathed their knife
  // and drew their sword": the talents are still assigned to the weapon.
  const tally = sphereTally(model, t, {
    includeTradition: !!u.includeTradition, sideKey: 'combat', customizations: 'all',
  });

  const per = {};
  for (const s of UNARMED_SPHERES) per[s] = tally[s] || 0;
  per['Open Hand'] += u.asuraEssence * ASURA_TALENTS_PER_ESSENCE;

  let talents = 0;
  if (u.usesBoxing) talents += per.Boxing;
  if (u.usesBrute) talents += per.Brute;
  if (u.usesOpenHand) talents += per['Open Hand'];
  if (u.usesWrestling) talents += per.Wrestling;
  for (const s of new Set((u.otherSpheres || []).filter(Boolean))) talents += tally[s] || 0;
  if (u.talentedKnuckle) talents += TALENTED_KNUCKLE_TALENTS;
  if (u.brawlersVest) talents += BRAWLERS_VEST_TALENTS;
  talents += Number(u.extraTalents) || 0;

  u.perSphere = per;
  u.effectiveTalents = Math.floor(talents);
  u.practitionerDice = unarmedDice(u.effectiveTalents, {
    stepIncreases: u.stepIncreases,
    sizeIncreases: u.sizeIncreases,
  });
  const anyUnarmedTalent = UNARMED_SPHERES.some((s) => (tally[s] || 0) > 0)
    || (u.otherSpheres || []).some((s) => (tally[s] || 0) > 0);
  u.improvedUnarmedStrike = anyUnarmedTalent;

  // How many talents are *associated with unarmed strikes*, which is a
  // different question from how many the practitioner table counts: the four
  // unarmed spheres and whatever Unorthodox Unarmed Training added to them,
  // and none of the virtual talents an item or feat grants "for determining
  // unarmed damage" -- those buy dice on that table, they are not talents a
  // class progression's threshold is counting. `extraAssoc` is the way to say
  // otherwise for a table that reads the clause the other way.
  u.assocTalents = Math.floor(
    UNARMED_SPHERES.reduce((n, s) => n + (per[s] || 0), 0)
    + [...new Set((u.otherSpheres || []).filter(Boolean))]
      .reduce((n, s) => n + (tally[s] || 0), 0)
    + (Number(u.native?.extraAssoc) || 0),
  );

  recomputeNativeUnarmed(model, u);

  // The dice everything else reads -- the weapon rows' 🥊, the formula
  // sandbox's `unarmed.dice`. A class progression replaces the practitioner
  // table rather than adding to it, which is what "instead of" means on every
  // class that prints one; where the progression cannot produce a die (no
  // rungs reached yet, a bad formula) the table is still there to fall back
  // on, so turning the toggle on can never leave a weapon with nothing.
  u.source = u.nativeProgression && u.nativeDice ? 'native' : 'practitioner';
  u.dice = u.source === 'native' ? u.nativeDice : u.practitionerDice;
}

/**
 * A class's own unarmed damage: the rung its table has reached, plus the
 * extra size increase the class grants for having unarmed talents at all.
 *
 * The ladder is the class's printed table and the formula is the escape
 * hatch for a table that is not a table -- one that scales off two classes,
 * or off something the rungs cannot say. The formula wins when it is filled
 * in, because a player who wrote one meant it.
 */
function recomputeNativeUnarmed(model, u) {
  if (!u.native || typeof u.native !== 'object') u.native = {};
  const n = u.native;
  if (!Array.isArray(n.ladder)) n.ladder = [];
  n.className = String(n.className ?? '');
  n.formula = String(n.formula ?? '');
  // Blank means "the usual", not zero: a threshold of 0 would grant the extra
  // size to a character with no talents at all, which is not what an empty
  // field is asking for. Both are the class's to name, so both are fields.
  const orDefault = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : Number(v) || 0);
  n.threshold = orDefault(n.threshold, UNARMED_NATIVE_THRESHOLD);
  n.bonusSizes = orDefault(n.bonusSizes, 1);

  // The progression counts the class's own levels, for the same reason the
  // Planner's rule groups do: "at 4th level" on a class table is a statement
  // about that class, and a gestalt build's other side does not advance it.
  // No class named falls back to the character's level, which is right for a
  // single-classed sheet and visible as a hint on the panel for one that is not.
  n.classLevel = n.className
    ? model.classLevelCount(n.className)
    : (Number(model.data.identity?.level) || 0);

  n.error = null;
  n.rung = null;
  let base = null;
  if (n.formula.trim()) {
    try {
      const v = evaluateFormula(n.formula.replace(/^\s*\{=?\s*|\s*\}\s*$/g, ''), model.scope());
      base = String(v ?? '').trim() || null;
      if (!base) n.error = 'The formula produced nothing.';
    } catch (err) {
      n.error = err.message;
    }
  } else {
    // Which rung, not just its dice: the panel shows the reading it made, so
    // the level a die came from is the model's answer rather than the view's.
    const rung = ladderRung(n.ladder, n.classLevel);
    n.rung = rung ? rung.from : null;
    base = rung ? rung.dice : null;
  }
  n.baseDice = base;

  // "One size larger with 3+ unarmed talents", which is two steps along the
  // same chain every other increase walks. Counted whether or not the ladder
  // is what produced the base, so a formula gets it too.
  n.qualifies = u.assocTalents >= (Number(n.threshold) || 0);
  n.sizeBonus = n.qualifies ? (Number(n.bonusSizes) || 0) : 0;

  const steps = 2 * ((Number(u.sizeIncreases) || 0) + n.sizeBonus)
    + (Number(u.stepIncreases) || 0);
  if (!base) {
    u.nativeDice = null;
  } else if (!steps) {
    // No increase to apply, so a die the chain does not list is still fine --
    // a class may print dice the practitioner chain never mentions.
    u.nativeDice = base;
  } else {
    u.nativeDice = stepDice(base, steps);
    if (!u.nativeDice) {
      n.error = n.error || `${base} is not on the die chain, so it cannot be stepped up.`;
      u.nativeDice = base;
    }
  }
}
