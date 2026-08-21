/**
 * The flat scope that player-authored formulas read, and the bonuses they
 * forward.
 *
 * Two directions, one file. `scope()` is what a formula may read; the
 * forwarding half is what a formula may *write* -- `{saves.will += 2}` in a
 * class feature's prose -- collected from every prose field on the sheet and
 * added at the destination. See forwardTargets() for what can be aimed at.
 */

import {
  ABILITIES, FORWARD_FAMILIES, FORWARD_STATS, MANEUVER_FIELDS, skillLabel,
} from '../rules.js';
import { COMPANION_KINDS, companionScope } from '../companions.js';
import {
  collectContributions, collectDefinitions, collectUses, hasTokens, renderTokens,
  resolveContributions, resolveDefinitions,
} from '../inline.js';
import { zoneAt } from '../tracker-style.js';
import { describeSource, shadowReason } from './reconcile.js';
import { WEAPON_CHANNELS, WEAPON_CHANNEL_LABELS, WEAPON_SHAPES } from './stats/attacks.js';
import { wealthView } from './stats/wealth.js';
import { essenceScope } from './subsystems/akashic.js';
import { trackerFacts } from './trackers.js';
import { classForwardKey, flatNames, skillForwardKey, slug, speedForwardKey } from './util.js';

/**
 * Forwarded destinations that are totalled *before* the prose forwarding to
 * them is read, and so are the reason a recompute ever runs a second pass.
 * Skills are not here: they are worked out after the names are, which is what
 * makes `{skill.bluff += 4}` free.
 */
const FORWARD_EARLY = new Set(FORWARD_STATS.map(([name]) => name));

export function characterScope(model) {
  const c = model.data;
  const s = {
    level: Number(c.identity.level) || 0,
    bab: Number(c.attack.bab) || 0,
    hp: {
      total: model.hpMax,
      current: Number(c.hp.current ?? c.hp.total) || 0,
      temp: Number(c.hp.temp) || 0,
    },
    mythic: { tier: Number(c.identity.mythicTier) || 0 },
    // The size as it stands, true-size buffs included -- {size} follows an
    // enlarge the moment it is ticked.
    size: model.sizeNow(),
    initiative: Number(c.hp.initiative) || 0,
    saves: {
      fortitude: c.saves.fortitude.total,
      reflex: c.saves.reflex.total,
      will: c.saves.will.total,
    },
    ac: {
      total: c.defenses.ac,
      touch: c.defenses.touch,
      flatFooted: c.defenses.flatFooted,
      cmd: c.defenses.cmd,
    },
    attack: {
      melee: c.attack.totalMelee,
      ranged: c.attack.totalRanged,
      cmb: c.attack.totalCmb,
    },
    // The wallet: what is on hand, what the next offering costs, what is left after it.
    mana: (() => { const w = wealthView(c.wealth, new Date(), model.casterLevel); return { current: w.current, expected: w.expected.total, after: w.after, perDay: w.manaPerDay }; })(),
    caster: {
      level: model.casterLevel,
      dc: Number(c.training?.magic?.globalDC) || 0,
      msb: Number(c.training?.magic?.msb) || 0,
      msd: Number(c.training?.magic?.msd) || 0,
      sp: Number(c.training?.magic?.totalSP) || 0,
      // What is left to cast with once the day's essence has been condensed.
      spAvailable: Number(c.training?.magic?.availableSP ?? c.training?.magic?.totalSP) || 0,
    },
    practitioner: { dc: Number(c.training?.combat?.practitionerDC) || 0 },
    // Movement, under the type each rate is called by: speed.land,
    // speed.fly. "Half your speed", "equal to your land speed" and "10 ft.
    // per point of Dex bonus" are all rules about a number that moves with
    // every feature and buff that touches it, and a sheet that cannot be
    // asked for it leaves them to be typed in and go stale. Read before
    // conditions, exactly as the saves and the armour classes are.
    speed: {},
    unarmed: {
      talents: Number(c.training?.combat?.unarmed?.effectiveTalents) || 0,
      dice: c.training?.combat?.unarmed?.dice || '',
    },
    skill: {},
    // Levels in each class, under its own slugged name -- Legendary
    // Kineticist is class.legendary_kineticist. A rule that scales off one
    // class of a gestalt build has no other way to say so: `level` is the
    // character's, and writing the number in by hand goes stale at the next
    // level-up, which is the whole thing this language exists to stop.
    class: {},
    tracker: {},
    // Essence invested per receptacle, mirroring the workbook's own named
    // ranges (VeilEssenceHands, VeilEssenceShoulder2, VeilEssenceWeapon...).
    // Many veils scale something other than their DC off what is invested
    // in them, so these have to be readable from a formula.
    essence: essenceScope(model),
    // The day's power points, for the same reason: a psionic power that scales
    // off the pool should be able to say so rather than restate the number.
    pp: {
      pool: Number(c.psionics?.pool) || 0,
      spent: Number(c.psionics?.spent) || 0,
      left: Number(c.psionics?.left) || 0,
      bonus: Number(c.psionics?.bonusPoints) || 0,
    },
    // The card caster's deck, for the same reason again: a tracker sized to
    // the opening hand, or a card whose text reads the deck, should be able
    // to say so.
    deck: {
      size: Number(c.cardcasting?.calc?.deckSize) || 0,
      cam: Number(c.cardcasting?.calc?.cam) || 0,
      hand: Number(c.cardcasting?.calc?.openingHand) || 0,
      handMax: Number(c.cardcasting?.calc?.handMax) || 0,
      effects: Number(c.cardcasting?.calc?.effectCards) || 0,
      mana: Number(c.cardcasting?.calc?.manaCards) || 0,
      unique: Number(c.cardcasting?.calc?.uniqueEffects) || 0,
      lifebound: Number(c.cardcasting?.calc?.lifebound) || 0,
      drawbacks: Number(c.cardcasting?.calc?.drawbackValue) || 0,
      feats: (c.cardcasting?.calc?.deckFeats || []).length,
      manipulations: Number(c.cardcasting?.calc?.manipulationsTaken) || 0,
      manipulationsLeft: Number(c.cardcasting?.calc?.manipulationsLeft) || 0,
      // How many times each manipulation was taken, by name:
      // deck.manip.draw_power_enhancement, deck.manip.loaded_hand.
      manip: {},
      // The encounter in play.
      round: Number(c.cardcasting?.table?.round) || 0,
      inHand: Number(c.cardcasting?.table?.calc?.inHand) || 0,
      inDeck: Number(c.cardcasting?.table?.calc?.inDeck) || 0,
      inPlay: Number(c.cardcasting?.table?.calc?.inPlay) || 0,
      inDiscard: Number(c.cardcasting?.table?.calc?.inDiscard) || 0,
      manaInPlay: Number(c.cardcasting?.table?.calc?.manaInPlay) || 0,
      manaUntapped: Number(c.cardcasting?.table?.calc?.manaUntapped) || 0,
    },
  };
  for (const m of c.cardcasting?.manipulations || []) {
    const key = slug(m.name);
    if (!key) continue;
    s.deck.manip[key] = (s.deck.manip[key] || 0) + (Number(m.count) || 0);
  }

  for (const key of ABILITIES) {
    const a = c.abilities[key];
    s[key] = {
      score: a.score,
      mod: a.mod,
      temp: a.tempScore,
      tempMod: a.totalMod,
    };
  }

  for (const sp of c.identity?.speeds || []) {
    const key = speedForwardKey(sp);
    if (key) s.speed[key.slice('speed.'.length)] = Number(sp.final) || 0;
  }

  for (const sk of c.skills) {
    const name = slug(sk.spec ? `${sk.name} ${sk.spec}` : sk.name);
    if (s.skill[name] === undefined) s.skill[name] = sk.bonus;
  }

  // The effective level, which is what every rule written about a class
  // means -- so a class counting as two levels higher reads as two levels
  // higher here too, and the number a formula sees is the number the casting
  // tables saw.
  for (const name of model.classNames()) {
    const key = slug(name);
    if (s.class[key] === undefined) s.class[key] = { level: model.classLevelCount(name) };
  }

  // The companions, so a tracker or an ability can read them: familiar.hp,
  // eidolon.hd, animalCompanion.str.mod, eidolon.evoLeft.
  for (const kind of COMPANION_KINDS) {
    const cs = companionScope(c[kind]);
    if (cs) s[kind] = cs;
  }

  // Every tracker publishes its numbers as tracker.<id>.* -- the id is the
  // one shown on the tracker's own row, and it never changes when the tracker
  // is renamed, so a formula pointing at it cannot be broken by a rename.
  for (const t of model.trackers) s.tracker[t.id] = trackerFacts(t);

  // Character-wide inline names ({qi.max = …}) become dotted paths in the
  // scope. They never overwrite a built-in value.
  for (const [name, value] of Object.entries(model.inlineNames || {})) {
    const parts = name.split('.');
    let node = s;
    let clash = false;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (node[k] === undefined) node[k] = {};
      else if (typeof node[k] !== 'object' || node[k] === null) { clash = true; break; }
      node = node[k];
    }
    const leaf = parts[parts.length - 1];
    if (!clash && node[leaf] === undefined) node[leaf] = value;
  }

  return s;
}

/** Every variable name a formula may legally use -- drives validation + autocomplete. */
export function scopeNames(model) {
  return flatNames(model.scope()).sort();
}

/**
 * Every destination a bonus may be forwarded to on this character, and how
 * to expand the ones that stand for a family.
 *
 * Reading and writing are not the same list, and saying so is half the
 * feature: hundreds of names publish themselves to a formula, but only the
 * totals the sheet rebuilds from their parts each recompute have anywhere
 * to *put* an arriving bonus. `known` is what tells a misspelt destination
 * ("skill.bluf") apart from a real value with nowhere to take a bonus
 * ("caster.level"), because those are two different mistakes with two
 * different fixes.
 */
export function forwardTargets(model) {
  const list = [];
  const expand = new Map();
  const add = (name, label) => {
    list.push({ name, label });
    expand.set(name, [name]);
  };

  // A skill by the same slugged name a formula reads it under, so
  // `{= skill.bluff}` and `{skill.bluff += 4}` can never mean two different
  // rows. Duplicated slugs collapse to one destination and land on every
  // row that answers to it, which is what "+2 to Craft" means when the
  // character keeps two Craft rows.
  const skills = [];
  for (const sk of model.data.skills || []) {
    const name = skillForwardKey(sk);
    if (expand.has(name)) continue;
    add(name, skillLabel(sk.name, sk.spec));
    skills.push(name);
  }
  for (const [name, label] of FORWARD_STATS) add(name, label);

  // A class's effective level. The destination is the same name the scope
  // publishes it under, so `{= class.legendary_kineticist.level}` and
  // `{class.legendary_kineticist.level += 2}` can never mean two different
  // classes.
  for (const cls of model.classNames()) {
    const name = classForwardKey(cls);
    if (!expand.has(name)) add(name, `${cls} levels`);
  }

  // A tracker's range. The pool itself is play state and nobody's to push
  // around, but how big it is is exactly the kind of thing a class feature
  // says: "your luck pool increases by 1 for every four levels" belongs in
  // the talent that grants it, not typed into the max and left to go stale.
  for (const t of model.trackers || []) {
    for (const edge of ['max', 'min']) {
      const name = `tracker.${t.id}.${edge}`;
      if (!expand.has(name)) add(name, `${t.name || t.id} ${edge}`);
    }
  }

  // Movement, by the same name the scope publishes it under. The family is
  // "every speed you have": a row reading zero is a speed the character has
  // not got, and "+10 ft. to your speeds" must not conjure flight out of an
  // empty Fly row -- the same line a buff's Speed row draws. Naming the row
  // outright still lands, because `{speed.fly += 30}` is how a rule *grants*
  // a fly speed, and it would be a strange sheet that refused to.
  const moves = [];
  let anySpeed = false;
  for (const sp of model.data.identity?.speeds || []) {
    const name = speedForwardKey(sp);
    if (!name || expand.has(name)) continue;
    add(name, `${String(sp.type).trim()} speed`);
    anySpeed = true;
    if ((Number(sp.base) || 0) + (Number(sp.bonusNum) || 0) > 0) moves.push(name);
  }
  if (anySpeed) {
    expand.set('speed', moves);
    list.push({ name: 'speed', label: 'Every speed you have', family: moves });
  }

  expand.set('skill', skills);
  list.push({ name: 'skill', label: 'Every skill', family: skills });
  for (const [name, members] of Object.entries(FORWARD_FAMILIES)) {
    expand.set(name, members);
    list.push({ name, label: `All ${name === 'ac' ? 'armour classes' : name}`, family: members });
  }

  // Weapons are matched rather than enumerated. "Melee weapons", "axes" and
  // "the guitar axe" are all the same shape of rule -- a condition on which
  // rows a bonus reaches -- and a character with eight weapons in four
  // groups would otherwise need a hundred and change names listed out.
  const weapons = model.data.equipment?.weapons || [];
  const handles = model.weaponHandles();
  const groups = new Set(weapons.flatMap((w) => (w.groups || []).filter(Boolean).map(slug)));
  const weaponTarget = (name) => {
    let rest = name;
    if (rest.startsWith('weapon.')) rest = rest.slice('weapon.'.length);
    else if (rest !== 'weapon' && !/^damage(\.|$)/.test(rest)) return null;
    if (rest === 'weapon') return null;
    // Longest first, so "damage.crit" is not read as "damage" with a
    // selector called "crit" hanging off the front of nothing.
    const channel = WEAPON_CHANNELS.find((ch) => rest === ch || rest.endsWith(`.${ch}`));
    if (!channel) return null;
    const sel = rest === channel ? '' : rest.slice(0, -(channel.length + 1));
    // A selector that names no group and no weapon on this character is a
    // misspelling and is reported as one. A shape that simply matches
    // nothing today -- "melee weapons" on a character carrying only a bow --
    // is not: the rule is right, and it will apply the moment one is bought.
    // A weapon answers to its handle and to its whole slugged name alike:
    // the handle is what anyone will actually type, but a rule written
    // before the row had one must not stop working.
    const named = (w, i) => handles[i] === sel || slug(w.name) === sel;
    if (sel && !WEAPON_SHAPES.has(sel) && !groups.has(sel)
      && !weapons.some(named)) return null;
    const matches = (w, i) => {
      if (!sel) return true;
      const type = String(w.attackType || '').toLowerCase();
      if (WEAPON_SHAPES.has(sel)) return type.includes(sel);
      return (w.groups || []).some((g) => slug(g) === sel) || named(w, i);
    };
    return weapons.flatMap((w, i) => (matches(w, i) ? [`weapon.${i}.${channel}`] : []));
  };
  for (const [ch, label] of WEAPON_CHANNEL_LABELS) {
    list.push({ name: ch === 'attack' ? `weapon.${ch}` : ch, label: `${label}, every weapon` });
  }
  for (const sel of [...WEAPON_SHAPES, ...groups, ...handles]) {
    if (!sel) continue;
    for (const [ch, label] of WEAPON_CHANNEL_LABELS) {
      list.push({ name: `weapon.${sel}.${ch}`, label: `${label}, ${sel.replace(/_/g, ' ')}` });
    }
  }

  let names = null;
  return {
    list,
    expand: (name) => expand.get(name) || weaponTarget(name),
    known: (name) => (names ??= new Set(model.scopeNames())).has(name),
  };
}

/** What forwarded bonuses come to at one destination. */
export function forwarded(model, name) {
  return Number(model.contributions?.totals?.[name]) || 0;
}

/**
 * The same total, split by when it applies.
 *
 * Only ability scores ask this, and they ask it because the sheet does: a
 * permanent bonus moves the score, a temporary one moves only the working
 * score every derived number is built from, and the Stats tab keeps a table
 * for each. Everywhere else the two are the same number and the split is
 * ignored.
 */
export function forwardedSplit(model, name) {
  const counted = model.contributions?.countedAt?.[name];
  const out = { permanent: 0, temporary: 0, total: 0 };
  for (const e of model.contributions?.by?.[name] || []) {
    if (e.error || !e.value) continue;
    if (counted && !counted.has(e)) continue;
    out[e.temporary ? 'temporary' : 'permanent'] += e.value;
    out.total += e.value;
  }
  return out;
}

/**
 * What is arriving at one destination, and from where -- the view a number
 * owes its reader when part of it was decided somewhere else entirely.
 *
 * Returns null when nothing is forwarded there, so a caller can leave the
 * display alone rather than render an empty explanation of nothing.
 */
export function forwardedInto(model, name, only = '') {
  const want = only === 'permanent' ? false : only === 'temporary' ? true : null;
  const split = forwardedSplit(model, name);
  const total = want === null ? forwarded(model, name)
    : (want ? split.temporary : split.permanent);
  const counted = model.contributions?.countedAt?.[name];
  // Superseded bonuses stay on the list. A size bonus that lost to a bigger
  // size bonus has not gone away -- it is the reason the bigger one is not
  // adding to it -- and a reader who cannot see it will write it in again.
  const from = (model.contributions?.by?.[name] || [])
    .filter((e) => e.value && (want === null || !!e.temporary === want))
    .map((e) => ({
      where: describeSource(e.path),
      value: e.value,
      expr: e.expr,
      sign: e.sign,
      type: e.type,
      temporary: !!e.temporary,
      counts: !counted || counted.has(e),
    }));
  return from.length ? { total, from } : null;
}

/**
 * Resolve every {name = expr} on the character into `this.inlineNames`,
 * available to trackers, weapon tokens, skill formulas and other inline
 * tokens through the formula scope.
 */
export function resolveInlineNames(model) {
  const sources = model.proseSources();
  const defs = collectDefinitions(sources);
  // Base scope excludes inline names (they are being computed) and skill
  // totals (skills may read names, so names must not read skills — that
  // rules out cycles between the two).
  model.inlineNames = {};
  const base = model.scope();
  // What the sheet works out for itself, captured before `skill` is emptied
  // so that a definition cannot take a skill's name either.
  const builtin = new Set(flatNames(base));
  base.skill = {};
  const { values, errors, duplicates } = resolveDefinitions(defs, base);

  // A definition may not take a name the sheet already works out. The scope
  // merge has always refused to overwrite one, but refusing quietly is the
  // worst of both worlds: {level = 30} would show 30 where it was written
  // while every formula reading `level` went on getting the real number.
  // Better to say so and publish nothing.
  const shadowed = [];
  for (const d of defs) {
    const reason = shadowReason(d.name, builtin);
    if (!reason) continue;
    shadowed.push({ name: d.name, path: d.path, reason });
    delete values[d.name];
    errors.push({ name: d.name, path: d.path, error: reason, shadow: true });
  }

  model.inlineNames = values;
  model.inlineErrors = errors;
  model.inlineDefinitions = defs;
  model.inlineDuplicates = duplicates;
  model.inlineShadowed = shadowed;

  // Forwarded bonuses are worked out here too, and only once: the second
  // recompute pass re-resolves the names (a name may read a save that a
  // bonus has just moved) but keeps the amounts this pass arrived at.
  //
  // Names first, bonuses second, and never the other way round. A bonus may
  // be written in terms of a name the character defines; a name may not be
  // written in terms of a bonus. One direction, so nothing can loop.
  if (!model.contributions) {
    const targets = model.forwardTargets();
    // Kept beside the answers: the view needs to call a destination by its
    // name ("Bluff", not "skill.bluff") and rebuilding the list per tooltip
    // would walk every skill again for every token on the tab.
    model.forwardTargetList = targets.list;
    model.contributions = resolveContributions(
      collectContributions(sources), values, model.scope(), targets,
    );
  }
  // Every name the prose *reads*, kept beside every name it defines: the
  // parse of each expression is cached by source, so the second pass costs
  // little and orphans() becomes a set lookup rather than another walk.
  model.inlineUses = collectUses(sources);
}

/**
 * Every prose field that may carry {…} tokens, as {path, text}. Kept in one
 * place so the resolver, the renderer and the audit agree on the set.
 */
export function proseSources(model) {
  const d = model.data;
  const out = [];
  const push = (path, text, scope, opts = null) => {
    if (typeof text === 'string' && hasTokens(text)) out.push({ path, text, scope, ...opts });
  };
  // The feature grid is a twenty-level plan, so it holds rows for levels the
  // character has not reached. Those are marked: a name defined in one is
  // inert until something reads it, but a *bonus* written in one would apply
  // the moment it was typed, and a talent taken at 16 must not be adding to
  // anything at 15.
  const level = Number(d.identity?.level) || 0;
  for (const [cls, g] of Object.entries(d.progression?.classFeatures || {})) {
    for (const [lvl, row] of Object.entries(g.byLevel || {})) {
      const future = Number(lvl) > level ? { future: true } : null;
      for (const [col, value] of Object.entries(row || {})) {
        // A cell shared by two rule groups holds one entry per group.
        if (value && typeof value === 'object') {
          for (const [key, text] of Object.entries(value)) {
            push(`feature:${cls}:${lvl}:${col}:${key}`, text, null, future);
          }
        } else push(`feature:${cls}:${lvl}:${col}`, value, null, future);
      }
    }
  }
  // A template feature, its sub-abilities and the cells of their tables:
  // everything a player writes on that tab reads {…} the way prose does.
  (d.templates || []).forEach((tp, ti) => (tp.features || []).forEach((f, fi) => {
    const entry = (path, x) => {
      push(path, x.text);
      (x.tables || []).forEach((t, bi) => (t.rows || []).forEach((row, ri) => {
        (row.cells || []).forEach((cell, ci) => push(`${path}:table:${bi}:${ri}:${ci}`, cell));
      }));
    };
    entry(`template:${ti}:${fi}`, f);
    (f.children || []).forEach((c, ci) => entry(`template:${ti}:${fi}:${ci}`, c));
  }));
  (d.notes || []).forEach((n, i) => push(`note:${i}`, n.body));
  (d.backgroundSections || []).forEach((s, i) => push(`background:${i}`, s.text));
  for (const [k, slot] of Object.entries(d.traitSlots || {})) {
    if (k === 'additional') (slot || []).forEach((t, i) => push(`trait:additional:${i}`, t.text));
    else push(`trait:${k}`, slot?.text);
  }
  // A tier above the one the character has reached is a plan: its text still
  // resolves and still shows, but a bonus written there has not been earned.
  const mythicTier = Number(d.identity?.mythicTier) || 0;
  (d.mythic?.abilities || []).forEach((a, i) => {
    const ahead = i + 1 > mythicTier ? { future: true } : null;
    push(`mythic:${i}`, a.name, null, ahead);
    push(`mythic:${i}:effect`, a.effect, null, ahead);
    push(`mythic:${i}:featChoice`, a.featChoice, null, ahead);
    push(`mythic:${i}:featEffect`, a.featEffect, null, ahead);
  });
  for (const [lvl, text] of Object.entries(d.primordia?.picks || {})) push(`primordia:${lvl}`, text);
  push('primordia:notes', d.primordia?.notes);
  for (const [k, v] of Object.entries(d.mythic?.tradition || {})) push(`mythicTradition:${k}`, v);
  (d.crafting?.projects || []).forEach((p, i) => {
    push(`crafting:${i}:resources`, p.resources);
    push(`crafting:${i}:notes`, p.notes);
  });
  (d.equipment?.weapons || []).forEach((w, i) => push(`weapon:${i}`, w.special));
  // A buff's note reads {…} like any prose, so a buff can carry its rule as
  // a definition -- "{deathgrip.dmg.max = 2 * (1 + essence.shoulder) * …}" --
  // that weapons and trackers then read by name. The definition stands
  // whether the buff is ticked or not (a reference must not break when the
  // buff is off); a value that should switch with something says so itself,
  // with if(…), exactly as the dials do.
  (d.buffs || []).forEach((b, i) => push(`buff:${i}`, b.note));
  // Every cell of a maneuver's own entry is prose -- its range as often as
  // its description, since "Close (25 ft. + 5 ft./2 levels)" is a formula
  // written out longhand. The description keeps the source name it has always
  // had, so a formula named in one still answers to `maneuverNote:…` in the
  // audit; the cells beside it are new and say which they are.
  (d.maneuvers?.disciplines || []).forEach((disc, di) => {
    for (const [name, entry] of Object.entries(disc.notes || {})) {
      if (typeof entry === 'string') { push(`maneuverNote:${di}:${name}`, entry); continue; }
      for (const f of MANEUVER_FIELDS) {
        // The name goes last in both, because it is the part that can hold a
        // colon of its own ("Lesson I: Balance") and split the path.
        push(f.key === 'text' ? `maneuverNote:${di}:${name}` : `maneuver:${di}:${f.key}:${name}`,
          entry?.[f.key]);
      }
    }
  });
  (d.vancian?.prepared || []).forEach((r, i) => push(`spellNote:${i}`, r.note));
  (d.equipment?.gear || []).forEach((g, i) => (g.others || []).forEach((o, j) => push(`gear:${i}:${j}`, o)));
  (d.equipment?.other || []).forEach((g, i) => (g.others || []).forEach((o, j) => push(`other:${i}:${j}`, o)));
  // Everything a player writes on a training side reads {…}: the talent
  // itself, the note beside it, the talents a tradition or a feat handed
  // over, and the drawbacks -- a locus priced in mana or a pool sized off
  // level is a number the rest of the sheet may as well be able to read.
  for (const [side, t] of Object.entries(d.training || {})) {
    (t?.classes || []).forEach((cls, ci) => (cls.levels || []).forEach((lv, li) => {
      push(`talent:${side}:${ci}:${li}`, lv.talent);
      push(`talent:${side}:${ci}:${li}:notes`, lv.notes);
    }));
    (t?.bonusTalents || []).forEach((b, bi) => {
      push(`bonusTalent:${side}:${bi}`, b.talent);
      push(`bonusTalent:${side}:${bi}:notes`, b.notes);
    });
    (t?.tradition?.entries || []).forEach((e, ei) => push(`tradition:${side}:${ei}`, e.talent));
    (t?.tradition?.drawbacks || []).forEach((x, xi) => push(`drawback:${side}:${xi}`, x));
    (t?.tradition?.boughtOff || []).forEach((x, xi) => push(`boughtOff:${side}:${xi}`, x));
  }
  // Veils used to be cells on a raw grid, so their text resolved `{…}` the
  // way every other cell did. Now that they are a modelled field, they have
  // to be listed here or a veil that reads "{= con.mod + 2}" would stop
  // computing the moment its tab was modelled.
  //
  // Each one also gets `essence.self`, which is what a veil that scales off
  // its own investment wants to say without naming its own slot.
  [...(d.akashic?.slots || []), ...(d.akashic?.kheshig || [])].forEach((holder, hi) => {
    (holder.veils || []).forEach((v, vi) => {
      const local = { essence: { self: Number(v.essence) || 0 } };
      push(`veil:${hi}:${vi}:name`, v.name, local);
      push(`veil:${hi}:${vi}`, v.desc, local);
    });
  });
  // A card's effect is prose -- "Fort DC {= 10 + floor(level/2) + int.mod}"
  // is what a card wants to carry -- and so are the notes beside it, the
  // sideboard's and a deck manipulation's.
  (d.cardcasting?.cards || []).forEach((card, i) => {
    push(`card:${i}`, card.effect);
    push(`card:${i}:notes`, card.notes);
  });
  (d.cardcasting?.sideboard || []).forEach((card, i) => {
    push(`sideboard:${i}`, card.effect);
    push(`sideboard:${i}:notes`, card.notes);
  });
  (d.cardcasting?.manipulations || []).forEach((m, i) => push(`deckManipulation:${i}`, m.note));
  push('cardcasting:notes', d.cardcasting?.notes);
  // The companions' prose: abilities, qualities, evolutions and notes.
  for (const kind of COMPANION_KINDS) {
    const b = d[kind];
    if (!b) continue;
    for (const key of ['abilities', 'specialAbility', 'specialQualities', 'baseEvolutions',
      'dr', 'resistances', 'immunities', 'notes']) {
      push(`${kind}:${key}`, b[key]);
    }
    (b.evolutions || []).forEach((e, i) => push(`${kind}:evolution:${i}`, e.notes));
    (b.attacks || []).forEach((a, i) => push(`${kind}:attack:${i}`, a.qualities));
    (b.feats || []).forEach((f, i) => push(`${kind}:feat:${i}`, f.notes));
    (b.tricks || []).forEach((t, i) => push(`${kind}:trick:${i}`, t.notes));
  }
  for (const [key, block] of [['akashic', d.akashic], ['maneuvers', d.maneuvers],
    ['vancian', d.vancian], ['psionics', d.psionics], ['cardcasting', d.cardcasting],
    ['extras', d.extras]]) {
    (block?.sourceExtras || []).forEach((row, ri) => {
      (row.cells || []).forEach((cell, ci) => push(`${key}Extra:${ri}:${ci}`, cell));
    });
  }
  (d.sheetTabs || []).forEach((tab, ti) => (tab.rows || []).forEach((row, ri) => {
    (row.cells || []).forEach((cell, ci) => push(`tab:${tab.name}:${ri}:${ci}`, cell));
  }));
  // A tracker's note, for forwarded bonuses only.
  //
  // A note may not define a name -- it is evaluated after the trackers it
  // reads, so the name would be a pass behind -- and its reads are already
  // listed one row per token by audit(). But a bonus is not a name, and the
  // note beside a resource is exactly where a rule that scales with it
  // belongs: "+2 Strength while Burn is 3 or more" is a fact about Burn, and
  // writing it anywhere else means writing Burn's name out again.
  for (const t of model.trackers || []) {
    push(`tracker:${t.id}:note`, t.note, model.trackerScope(t), { forwardsOnly: true });
  }
  return out;
}

/** Rendered segments for a prose field (used by the view layer). */
/**
 * @param local  scope that exists only where this text was written, such as
 *               `{ essence: { self } }` for a veil's own description.
 */
export function renderProse(model, text, local = null) {
  return renderTokens(text, model.inlineNames || {}, model.scope(), local);
}

/**
 * The local scope a tracker's own note resolves in.
 *
 * `self` is that tracker's row -- current, max, min, remaining, spent, pct
 * and the label of the zone the value is sitting in -- so a note can say how
 * full its own tracker is without naming it. Character-wide, the same numbers
 * are `tracker.<id>.*`.
 */
export function trackerScope(model, t) {
  const zone = zoneAt(Number(t?.current) || 0, t?.resolvedZones || []);
  return { self: { ...trackerFacts(t), zone: zone?.label || '' } };
}

/** Does anything forwarded land before the prose that forwards it is read? */
export function forwardsEarly(model) {
  // A class level is early for the same reason an ability score is: the
  // training pass reads it before any prose has been looked at, and the
  // casting tables it feeds are downstream of that. A speed is early because
  // the speeds resolve before the prose too, and because another speed may
  // be written to read it.
  return Object.entries(model.contributions?.totals || {})
    .some(([name, value]) => value
      && (FORWARD_EARLY.has(name) || name.startsWith('class.') || name.startsWith('speed.')));
}
