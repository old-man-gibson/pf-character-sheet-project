/**
 * Offsets against the source workbook, and the audit that explains them.
 *
 * The workbook's own totals cannot be recomputed from what an .xlsx export
 * carries, so each derived stat keeps `offset = sheetValue - computed` and
 * adds it back. That makes every number match on import and still move
 * correctly afterwards. The cost is a number nobody can account for, which is
 * what `audit()` is for: it walks every derived stat, every formula and every
 * forwarded bonus and says where each part came from.
 */

import {
  AC_BONUS_TYPES, BUFF_MOD_KEYS, DERIVED, FORWARD_BY_DERIVED, SAVE_BONUS_TYPES, diceString, flatFootedLoss, skillLabel,
} from '../rules.js';
import { NameIndex, analyse, evaluateFormula, resolvePath } from '../formula.js';
import { hasTokens, isTargetName } from '../inline.js';
import { contextualNote } from '../formula-format.js';
import { applyMythic, refreshAbilities } from './abilities.js';
import { applyCorrections } from './corrections.js';
import { emit } from './events.js';
import { applyGestalt } from './progression.js';
import { forwarded } from './scope.js';
import { resolveDefenceBonuses } from './stats/defenses.js';
import { evaluateAmount, flatNames, getPath, safe, sphereForwardKey } from './util.js';

/** Where a non-prose formula lives, for a reader who needs to go and find it. */
const SOURCE_WORD = {
  skill: 'the Skills tab',
  weapon: 'a weapon',
  crafting: 'the Crafting tab',
  sheet: 'a tracker from the sheet',
  player: 'a field on the sheet',
};

/**
 * Why `name` may not be defined by a player, or null if it may.
 *
 * Three ways a name can collide with what the sheet works out for itself: it
 * *is* one (`level`), it hangs off one (`level.bonus`, where level is a
 * number and cannot hold anything), or it is the branch one lives on (`str`,
 * which already holds str.mod and the rest).
 *
 * And one reserved name: `target`, the destination inside a forwarded bonus.
 * A definition named `target` would be looked up before the destination in
 * every bonus that reads it.
 */
export function shadowReason(name, builtin) {
  if (/^target$/i.test(String(name))) {
    return '"target" is reserved: inside a forwarded bonus it is the stat the bonus is added to. '
      + 'Use another name, e.g. my.target.';
  }
  if (builtin.has(name)) {
    return `"${name}" is a value the sheet works out for itself, so it cannot be defined here. `
      + 'Pick a name of your own — a dotted one such as my.' + String(name).split('.').pop()
      + ' never collides.';
  }
  const parts = String(name).split('.');
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join('.');
    if (builtin.has(head)) {
      return `"${head}" is a value the sheet works out for itself, so nothing can be hung off it. `
        + `Pick a name of your own rather than "${name}".`;
    }
  }
  const branch = `${name}.`;
  const under = [...builtin].filter((b) => b.startsWith(branch));
  if (under.length) {
    return `"${name}" is where the sheet keeps ${under.slice(0, 3).join(', ')}`
      + `${under.length > 3 ? ' and more' : ''}, so it cannot be defined here. `
      + 'Pick a name of your own.';
  }
  return null;
}

/** The Defences panel's own boxes, as they are labelled on screen. */
const DEFENCE_BOX_LABELS = {
  spellResistance: 'spell resistance',
  dr: 'damage reduction',
  resistance: 'energy resistance',
  weakness: 'vulnerability',
  immunities: 'immunities',
};

/**
 * A prose source path (`note:1`, `feature:Monk:5:Special`) as something a
 * player can go and look at. The paths are internal, stable and meaningless
 * to a reader; this is the one place that translates them.
 */
export function describeSource(path) {
  const parts = String(path || '').split(':');
  const [head, a, b] = parts;
  const nth = (i) => Number(i) + 1;
  switch (head) {
    case 'feature': return `${a} class feature, level ${b}`;
    case 'featureNote': return `${parts.slice(2).join(':') || 'a feature'}, under ${a} features`;
    case 'template': return 'a template feature';
    case 'note': return `note ${nth(a)} on Lore`;
    case 'approvalNotes': return 'the approvals notes';
    case 'formulas': return 'the Formulas tab';
    case 'background': return `background section ${nth(a)}`;
    case 'trait': return a === 'additional' ? `additional trait ${nth(b)}` : `${a} trait`;
    case 'raceTrait': return `race trait ${nth(a)}`;
    case 'mythic': return b === 'effect' ? `the tier ${nth(a)} ability’s effect`
      : b === 'featChoice' ? `the tier ${nth(a)} feat`
        : b === 'featEffect' ? `the tier ${nth(a)} feat’s effect`
          : `mythic ability ${nth(a)}`;
    case 'mythicTradition': return 'mythic tradition';
    case 'mythicTraditionNote': return 'a mythic tradition note';
    case 'feat': return `a feat’s note, group ${nth(a)}`;
    case 'grantedFeat': return 'a granted feat’s note';
    case 'altTraining': return a === 'notes' ? 'Alternate Training notes' : `Alternate Training, level ${a}`;
    case 'altTrainingNote': return `Alternate Training notes, level ${a}`;
    case 'crafting': return `crafting project ${nth(a)}`;
    case 'weapon': return `weapon ${nth(a)}, special properties`;
    case 'defenses': return `the ${DEFENCE_BOX_LABELS[a] || a} box`;
    case 'gear':
    case 'other': return `gear ${nth(a)}`;
    case 'gearNote':
    case 'otherNote': return `gear ${nth(a)}, description`;
    case 'gearBonus':
    case 'otherBonus': return `gear ${nth(a)}, bonus ${nth(b)}`;
    case 'talent':
    case 'bonusTalent': return `a ${a} talent`;
    case 'weaponTalent': return parts[4] === 'notes' ? 'a customized weapon’s talent note' : 'a customized weapon’s talent';
    case 'tradition': return `${a} tradition`;
    case 'drawback': return `${a} drawback`;
    case 'boughtOff': return `${a} drawback bought off`;
    case 'veil': return parts[3] === 'name' ? 'a veil’s name' : 'a veil’s description';
    case 'spellNote': return `prepared spell ${nth(a)}, its note`;
    case 'sessionCard': return `session card ${nth(a)}, its ${b === 'note' ? 'notes' : b}`;
    case 'powerNote': return `power ${nth(b)} of manifesting class ${nth(a)}, its note`;
    case 'card': return `card ${nth(a)}`;
    case 'sideboard': return `sideboard card ${nth(a)}`;
    case 'deckManipulation': return 'a deck manipulation';
    case 'cardcasting': return 'Cardcasting notes';
    case 'familiar':
    case 'animalCompanion':
    case 'eidolon':
    case 'conjured': {
      let who = head === 'familiar' ? 'the familiar'
        : head === 'eidolon' ? 'the eidolon'
          : head === 'conjured' ? 'the conjured companion' : 'the animal companion';
      // A later companion of the kind tags its keys with its id right after
      // the kind (`eidolon:brutus:item:Neck`); the first keeps the old shape.
      const SUBHEADS = new Set(['abilities', 'specialAbility', 'specialQualities', 'baseEvolutions',
        'dr', 'resistances', 'immunities', 'notes', 'evolution', 'attack', 'feat', 'trick',
        'talent', 'item', 'slotless']);
      let [sub, at] = [a, b];
      let rest = 2;
      if (a && !SUBHEADS.has(a)) {
        who = `${who} “${a}”`;
        [sub, at] = [b, parts[3]];
        rest = 3;
      }
      if (sub === 'item') return `${who}, the ${parts.slice(rest).join(':')} slot`;
      if (sub === 'slotless') return `${who}, item ${nth(at)}`;
      return who;
    }
    // A maneuver's own entry. The name is last in both because it may hold a
    // colon ("Lesson I: Balance"), so it is rejoined rather than indexed.
    case 'maneuverNote': return `${parts.slice(2).join(':')}, its description`;
    case 'maneuver': return `${parts.slice(3).join(':')}, its ${b}`;
    case 'tab': return `the ${a} tab`;
    case 'tracker': return `the ${a} tracker’s note`;
    default:
      if (head?.endsWith('Extra')) return `the ${head.replace(/Extra$/, '')} tab`;
      return head ? `${head}` : 'somewhere on the sheet';
  }
}

/** Compute the one-time offsets that make imported values reproduce exactly. */
export function reconcile(model) {
  seedOffsetFormulas(model);
  applyMythic(model);
  refreshAbilities(model);
  applyGestalt(model);
  // Before the offsets are measured, or every typed bonus would be counted
  // once in the offset and again in the compute.
  resolveDefenceBonuses(model);
  // A figure saved under a rule since fixed is moved first, so the offset is
  // measured against what the sheet would have saved. Once per document.
  applyCorrections(model);
  // What each stat came to from its visible parts, kept for the caller. The
  // constructor reconciles twice and has to tell two things apart: a stat that
  // moved because a bonus was forwarded *at* it, and one that moved because a
  // bonus landed on something it is built from (an ability score, a class
  // level) and cascaded in. See the `balanced` set in Character's constructor.
  model.bare = model.bare || {};
  // HP is computed by the class pass rather than DERIVED, but needs the same
  // second measurement after prose bonuses have changed its ability score.
  // Otherwise each reload absorbs that ability bonus into Other, then adds it
  // again. Always use the original total, never the first pass's answer.
  model.bare['hp.total'] = model.data.hp?.base;
  if (model.data.hp && typeof model.offsets['hp.total'] !== 'string'
      && Number.isFinite(model.imported['hp.total'])) {
    model.offsets['hp.total'] = model.imported['hp.total'] - model.data.hp.base;
  }
  for (const d of DERIVED) {
    if (!d.reconcile) continue;
    const bare = safe(() => d.compute(model.data), 0);
    model.bare[d.key] = bare;
    // Always the figure the document arrived with, never the one on `data`:
    // this runs a second time once forwarded bonuses are known, and by then
    // `data` holds what the first pass worked out rather than what was saved.
    const target = Number(model.imported[d.key]) || 0;
    // An offset written as a formula is not measured: the saved total holds
    // what the formula came to when it was saved, and the formula is what it
    // means. See seedOffsetFormulas.
    if (typeof model.offsets[d.key] === 'string') continue;
    // An offset is what the source workbook added and this sheet cannot see.
    // A bonus this sheet forwards here is not that -- it is visible, it is
    // written down, and it was already in the saved figure -- so it comes
    // off before the difference is called an offset.
    model.offsets[d.key] = target - bare - forwarded(model, FORWARD_BY_DERIVED[d.key]);
  }
  // Flat-footed CMD follows the CMD, less what flat-footed loses. A workbook
  // that took more off than the Dexterity and dodge bonuses the sheet can see
  // keeps the rest. A blank sheet or a pasted monster never worked the figure
  // out -- it sat at 10, or at the CMD -- so neither has anything to keep.
  const kind = model.data.source?.kind;
  model.ffCmdExtra = kind === 'blank' || kind === 'monster' ? 0
    : (Number(model.imported['defenses.cmd']) || 0) - (Number(model.imported['defenses.ffCmd']) || 0)
      - flatFootedLoss(model.data);
}

/**
 * The offsets that are formulas rather than measurements.
 *
 * An offset is normally recovered on load as the saved total less what the
 * visible parts come to, and nothing extra is stored. One written as a rule
 * -- `floor(level / 4)` in the Other column of a save -- cannot be recovered
 * that way: the saved total holds what the rule came to at the time, not the
 * rule. So the text is kept on the document under `otherFormulas`, filed by
 * the same key the offset is, and on load the offset *is* the formula;
 * `resolveOffsets` turns it into a number every pass, against the sheet as it
 * then stands.
 */
export function seedOffsetFormulas(model) {
  const formulas = model.data.otherFormulas;
  if (!formulas || typeof formulas !== 'object') return;
  for (const [key, text] of Object.entries(formulas)) {
    if (typeof text === 'string' && text.trim() && offsetKey(key)) model.offsets[key] = text;
  }
}

/**
 * Work out every formula offset against the scope as it stands.
 *
 * Runs at the top of each compute pass, before anything the offsets feed:
 * hit points and the derived stats read the answers through offsetOf. One
 * scope for all of them, built only if there is a formula to read it.
 */
export function resolveOffsets(model) {
  model.offsetValues = {};
  model.offsetErrors = {};
  let scope = null;
  for (const [key, raw] of Object.entries(model.offsets)) {
    if (typeof raw !== 'string') continue;
    scope ??= model.scope();
    const { value, error } = evaluateAmount(raw, scope);
    model.offsetValues[key] = value;
    model.offsetErrors[key] = error;
  }
}

/**
 * Which stats carry an offset: every reconciled DERIVED stat, and hit points.
 *
 * Hit points are not a DERIVED entry -- the sheet's total is a figure the
 * class table arrives at rather than one expression over the character -- but
 * they are reconciled in exactly the same way and for exactly the same reason
 * (see applyHitPoints), so the same field edits them.
 */
export const offsetKey = (key) => key === 'hp.total'
  || DERIVED.some((d) => d.key === key && d.reconcile);

/**
 * The reconciliation offset of one derived stat -- everything the source
 * sheet added through formulas that did not survive the export (gear,
 * ABP, resistance bonuses, traits).
 */
export function offsetOf(model, key) {
  const raw = model.offsets[key];
  if (typeof raw === 'string') return Number(model.offsetValues?.[key]) || 0;
  return Number(raw) || 0;
}

/** The offset as it was written: the formula's text, or the number. */
export function offsetSource(model, key) {
  const raw = model.offsets[key];
  return typeof raw === 'string' ? raw : Number(raw) || 0;
}

/** What went wrong with a formula offset, or null. */
export function offsetError(model, key) {
  return model.offsetErrors?.[key] || null;
}

/** A human name for the stat an offset belongs to. */
export function offsetLabel(key) {
  if (key === 'hp.total') return 'Hit points';
  return DERIVED.find((d) => d.key === key)?.label || key;
}

/**
 * Edit that offset. It is the only place a flat AC or save bonus can go, so
 * it is a real field rather than hidden bookkeeping.
 *
 * A number stores nothing extra: the offset is recovered on load as
 * `savedTotal - computedFromVisibleParts`, so an edited one round-trips
 * through localStorage and Export JSON exactly as an imported one does. A
 * formula is kept as text under `otherFormulas`, because a rule is not
 * recoverable from the number it came to -- see seedOffsetFormulas.
 */
export function setOffset(model, key, value) {
  if (!offsetKey(key)) return model;
  const text = typeof value === 'string' ? value.trim() : '';
  const numeric = typeof value !== 'string' ? Number(value) || 0
    : text === '' ? 0
      : /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
  if (numeric === null) {
    model.data.otherFormulas = { ...(model.data.otherFormulas || {}), [key]: text };
    model.offsets[key] = text;
  } else {
    if (model.data.otherFormulas) {
      delete model.data.otherFormulas[key];
      if (!Object.keys(model.data.otherFormulas).length) delete model.data.otherFormulas;
    }
    model.offsets[key] = numeric;
  }
  model.recompute();
  emit(model, { type: 'set', path: `offset:${key}`, value });
  return model;
}

/** Values the player has changed away from the imported sheet. */
export function diffFromSource(model) {
  const out = [];
  for (const d of DERIVED) {
    const now = d.key === 'initiative' ? model.data.hp.initiative : getPath(model.data, d.key);
    const was = model.imported[d.key];
    if (Number(now) !== Number(was)) out.push({ key: d.key, label: d.label, was, now });
  }
  return out;
}

/**
 * Every field that takes a number or a formula, for the Formula Audit.
 *
 * Each entry lists, for one kind of field, the places on this character where
 * one holds a formula rather than a number: `id`, `place` (what the Formulas
 * tab's go-to opens), `name`, the `formula`, the `value` and `error` its
 * resolver left beside it, and `where` when the tab should say so. The audit
 * turns each into a row the one way (`fieldRow`), so a new formula field is
 * one entry here and cannot be missing from the audit. Fields whose rows are
 * shaped differently -- skill ranks (which may read only `level`), the prose's
 * own definitions, weapon tokens and the trackers -- are built in `audit`.
 */
const stringFormula = (v) => typeof v === 'string' && v.trim() !== '';
const SAVE_NAMES = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' };

export const FORMULA_FIELDS = [
  {
    key: 'skillMisc', source: 'skill',
    collect: (model) => (model.data.skills || []).flatMap((s, i) => (stringFormula(s.offset) ? [{
      id: `skill-misc-${i}`, place: `skillMisc:${i}`, name: `${skillLabel(s.name, s.spec)} misc`,
      formula: s.offset, value: s.miscResolved, error: s.miscError,
    }] : [])),
  },
  {
    key: 'weaponMisc', source: 'weapon', where: 'a weapon’s Misc dmg',
    collect: (model) => (model.data.equipment?.weapons || []).flatMap((w, i) => (stringFormula(w.miscDamage) ? [{
      id: `weapon-misc-${i}`, place: `weaponMisc:${i}`, name: `${w.name || `Weapon ${i + 1}`} misc damage`,
      formula: w.miscDamage, value: w.miscDamageNum, error: w.miscDamageError,
      // Its {…} tokens are the prose's, checked there; what is left is the formula.
      read: String(w.miscDamage).replace(/\{[^{}]*\}/g, '0'),
    }] : [])),
  },
  {
    key: 'saveCell', source: 'player', where: 'the Stats tab',
    collect: (model) => Object.entries(SAVE_NAMES).flatMap(([k, label]) => {
      const save = model.data.saves?.[k];
      return SAVE_BONUS_TYPES.flatMap(([key, what]) => (stringFormula(save?.bonuses?.[key]) ? [{
        id: `save-${k}-${key}`, place: `statCell:saves.${k}.bonuses.${key}`, name: `${label} — ${what}`,
        formula: save.bonuses[key], value: save.bonusesResolved?.[key], error: save.bonusErrors?.[key],
      }] : []));
    }),
  },
  {
    key: 'acCell', source: 'player', where: 'the Stats tab',
    collect: (model) => {
      const d = model.data.defenses;
      return AC_BONUS_TYPES.flatMap(([key, what]) => (stringFormula(d?.acBonuses?.[key]) ? [{
        id: `ac-${key}`, place: `statCell:defenses.acBonuses.${key}`, name: `AC — ${what}`,
        formula: d.acBonuses[key], value: d.acBonusesResolved?.[key], error: d.acBonusErrors?.[key],
      }] : []));
    },
  },
  {
    key: 'speed', source: 'player',
    collect: (model) => (model.data.identity?.speeds || []).flatMap((sp, i) => (stringFormula(sp.bonus) ? [{
      id: `speed-${i}`, place: `speed:${i}`, name: `${sp.type || `Speed ${i + 1}`} bonus`,
      formula: sp.bonus, value: sp.bonusNum, error: sp.bonusError,
    }] : [])),
  },
  {
    key: 'other', source: 'player',
    collect: (model) => Object.entries(model.data.otherFormulas || {})
      .filter(([key, text]) => stringFormula(text) && offsetKey(key))
      .map(([key, text]) => ({
        id: `other-${key}`, place: `offset:${key}`, name: `${offsetLabel(key)} — Other`,
        formula: text, value: offsetOf(model, key), error: offsetError(model, key),
      })),
  },
  {
    // The sphere tables: a CL+, BAB+, Rank+ or DC+ written as a rule. By the
    // sphere's name where the table is the catalogue and a sphere appears
    // once; by position on the guile side, where a row is the player's and
    // two may name the same sphere.
    key: 'sphereCell', source: 'player',
    collect: (model) => {
      const training = model.data.training || {};
      const sides = [
        ['magic', training.magic?.sphereRows, [['clBonus', 'CL+'], ['dcBonus', 'DC+']]],
        ['combat', training.combat?.sphereRows, [['rankBonus', 'BAB+'], ['dcBonus', 'DC+']]],
        ['guile', training.guile?.sphereRows, [['rankBonus', 'Rank+'], ['dcBonus', 'DC+']]],
      ];
      return sides.flatMap(([side, rows, columns]) => (rows || []).flatMap((row, i) => columns
        .filter(([field]) => stringFormula(row[field]))
        .map(([field, label]) => {
          const at = side === 'guile' ? i : (sphereForwardKey(row.sphere) || `sphere.${i}`).slice('sphere.'.length);
          return {
            id: `sphere-${side}-${at}-${field}`,
            place: `sphereCell:${side}:${side === 'guile' ? i : row.sphere}:${field}`,
            name: `${row.sphere || 'Sphere'} ${label}`,
            formula: row[field], value: row[`${field}Num`], error: row[`${field}Error`],
          };
        })));
    },
  },
  {
    key: 'languages', source: 'player',
    collect: (model) => (stringFormula(model.data.identity?.languageExtra) ? [{
      id: 'languages-extra', place: 'languages', name: 'Extra language slots',
      formula: model.data.identity.languageExtra,
      value: model.data.identity.languageSlots?.extra, error: model.data.identity.languageSlots?.extraError,
    }] : []),
  },
  {
    // The three typed parts of the hit-point maximum, and the death threshold.
    key: 'hp', source: 'player',
    collect: (model) => {
      const hp = model.data.hp || {};
      return [
        ['fcb', 'Favoured class hit points'], ['toughness', 'Toughness per level'],
        ['misc', 'Misc hit points'], ['deathBonus', 'Death threshold'],
      ].filter(([key]) => stringFormula(hp[key])).map(([key, name]) => ({
        id: `hp-${key}`, place: `hp:${key}`, name,
        formula: hp[key], value: hp[`${key}Resolved`], error: hp[`${key}Error`],
      }));
    },
  },
  {
    // Any speed increase, cost reduction, item value or DC typed as a formula.
    // `place` is the list and field the number lives in.
    key: 'crafting', source: 'crafting',
    collect: (model) => {
      const cr = model.data.crafting || {};
      const fields = [
        ...(cr.speedIncreases || []).map((s, i) => ({
          id: `crafting-speed-${i}`, name: `Speed increase — ${s.label || `#${i + 1}`}`, obj: s, field: 'value',
          place: `craftNumber:crafting.speedIncreases|${i}|value`,
        })),
        ...(cr.costReductions || []).map((r, i) => ({
          id: `crafting-reduction-${i}`, name: `Cost reduction — ${r.label || `#${i + 1}`}`, obj: r, field: 'value',
          place: `craftNumber:crafting.costReductions|${i}|value`,
        })),
        ...(cr.projects || []).flatMap((p, i) => {
          const item = p.name || `Project ${i + 1}`;
          return [
            { id: `crafting-value-${i}`, name: `${item} — market value`, obj: p, field: 'value', place: `craftNumber:crafting.projects|${i}|value` },
            { id: `crafting-dc-${i}`, name: `${item} — item DC`, obj: p, field: 'itemDC', place: `craftNumber:crafting.projects|${i}|itemDC` },
            ...(p.dcAdjustments || []).map((a, j) => ({
              id: `crafting-dc-${i}-${j}`, name: `${item} — DC ${a.label || `adjustment ${j + 1}`}`, obj: a, field: 'value',
              place: `craftNumber:crafting.projects.${i}.dcAdjustments|${j}|value`,
            })),
          ];
        }),
      ];
      return fields.filter(({ obj, field }) => stringFormula(obj[field])).map(({ id, name, obj, field, place }) => ({
        id, place, name, formula: obj[field], value: obj[`${field}Num`], error: obj[`${field}Error`],
      }));
    },
  },
  {
    key: 'deckManipulations', source: 'player',
    collect: (model) => {
      const cc = model.data.cardcasting;
      return stringFormula(cc?.manipulationsAvailable) ? [{
        id: 'deck-manipulations', place: 'deckManipulations', name: 'Deck manipulations available',
        formula: cc.manipulationsAvailable, value: cc.calc?.manipulationsAvailable, error: cc.calc?.manipulationsError,
      }] : [];
    },
  },
  {
    key: 'vancianConcentration', source: 'player', where: 'the Vancian tab',
    collect: (model) => (model.data.vancian?.classes || []).flatMap((c, i) => (stringFormula(c.concentration) ? [{
      id: `vancian-${i}-concentration`, place: `vancianConcentration:${i}`,
      name: `${String(c.name || c.slotType || 'Casting class').trim()} concentration`,
      formula: c.concentration, value: c.concentrationNum, error: c.concentrationError,
    }] : [])),
  },
  {
    // A buff's six dials and its extra bonuses, each a number or a rule.
    key: 'buff', source: 'player', where: 'a buff',
    collect: (model) => (model.data.buffs || []).flatMap((b, i) => {
      if (!b || typeof b !== 'object') return [];
      const own = String(b.name || '').trim() || `Buff ${i + 1}`;
      return [
        ...BUFF_MOD_KEYS.filter(([key]) => stringFormula(b[key])).map(([key, label]) => ({
          id: `buff-${i}-${key}`, place: `buff:${i}:${key}`, name: `${own} — ${label}`,
          formula: b[key], value: b[`${key}Num`], error: b[`${key}Error`],
        })),
        ...(b.bonuses || []).flatMap((row, j) => (row && stringFormula(row.value) ? [{
          id: `buff-${i}-bonus-${j}`, place: `buff:${i}:bonuses.${j}.value`, name: `${own} — ${row.target || 'bonus'}`,
          formula: row.value, value: row.valueNum, error: row.valueError,
        }] : [])),
      ];
    }),
  },
];

/** One field's formula as an audit row: what it reads, and what is wrong with it. */
function fieldRow(entry, it, known) {
  const info = analyse(it.read ?? it.formula);
  const unknown = info.variables.filter((v) => !known.has(v));
  const error = it.error || info.error || (unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : null);
  return {
    id: it.id,
    place: it.place,
    name: it.name,
    source: entry.source,
    formula: it.formula,
    reads: info.variables,
    functions: info.functions,
    unknownReferences: unknown,
    value: error ? null : it.value ?? null,
    error,
    status: error ? 'error' : 'ok',
    createdAt: null,
    ...(entry.where ? { where: entry.where } : null),
  };
}

/**
 * Full audit of every player-authored formula on this character.
 * Returns plain data so an admin view (or a server-side checker) can render
 * the exact text a player wrote, what it reads, and what it evaluates to.
 */
export function audit(model) {
  const scope = model.scope();
  const known = new NameIndex(model.scopeNames());

  // Skill ranks entered as formulas are player-authored too.
  const skillFormulas = (model.data.skills || [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => typeof s.rankSources?.bought === 'string' && s.rankSources.bought.trim())
    .map(({ s, i }) => {
      const info = analyse(s.rankSources.bought);
      return {
        id: `skill-ranks-${i}`,
        place: `skillRanks:${i}`,
        name: `${skillLabel(s.name, s.spec)} ranks`,
        source: 'skill',
        formula: s.rankSources.bought,
        reads: info.variables,
        functions: info.functions,
        unknownReferences: info.variables.filter((v) => v !== 'level'),
        value: s.boughtResolved ?? null,
        error: s.boughtError || info.error
          || (info.variables.some((v) => v !== 'level') ? 'Rank formulas may only read "level"' : null),
        status: (s.boughtError || info.error || info.variables.some((v) => v !== 'level')) ? 'error' : 'ok',
        createdAt: null,
      };
    });

  // Inline {name = expr} definitions and their errors.
  //
  // What a definition may legally read is wider than the character: the
  // other definitions (they resolve in dependency order, so one may name a
  // sibling that has not been computed yet), and whatever local scope the
  // text was written in -- a veil's `essence.self`, which exists in that
  // veil's own description and nowhere else. Judging these against the
  // character alone would report a working formula as broken.
  const definedNames = new Set((model.inlineDefinitions || []).map((d) => d.name));
  // Each definition is worked out on its own terms, in the scope it was
  // written in. That matters when a name is defined twice: the row has to
  // say what *its* formula comes to, not what the winning one came to, or a
  // player choosing between them is comparing a number against itself.
  const ownValue = (d) => {
    try {
      return evaluateFormula(d.expr, {
        lookup: (n) => {
          if (d.scope) {
            const v = resolvePath(d.scope, n);
            if (v !== undefined) return v;
          }
          return resolvePath(scope, n);
        },
      });
    } catch {
      return null;
    }
  };
  const inlineFormulas = (model.inlineDefinitions || []).map((d, i) => {
    const err = (model.inlineErrors || []).find((e) => e.name === d.name && e.path === d.path);
    const info = analyse(d.expr);
    const local = new Set(flatNames(d.scope));
    return {
      id: `inline-${i}`,
      place: d.path,
      name: `{${d.name}}`,
      source: 'inline',
      formula: d.expr,
      reads: info.variables,
      functions: info.functions,
      unknownReferences: info.variables.filter(
        (v) => !known.has(v) && !definedNames.has(v) && !local.has(v),
      ),
      value: ownValue(d),
      error: err?.error || info.error || null,
      status: err || info.error ? 'error' : 'ok',
      createdAt: null,
      location: d.path,
      where: describeSource(d.path),
      // The scope this text was written in, so a reader can work the formula
      // out the way the sheet did rather than against the character alone.
      locals: d.scope || null,
    };
  });

  // Weapon damage/to-hit tokens written into special properties.
  const weaponFormulas = (model.data.equipment?.weapons || []).flatMap((w, wi) => {
    const items = [
      ...(w.calc?.atkTokens || []).map((t) => ({ t, kind: 'to-hit' })),
      ...(w.calc?.dmgTokens || []).map((t) => ({ t, kind: 'damage' })),
    ];
    return items.map(({ t, kind }, ti) => ({
      id: `weapon-${wi}-${kind}-${ti}`,
      place: `weapon:${wi}`,
      name: `${w.name || `Weapon ${wi + 1}`} ${kind} token`,
      source: 'weapon',
      formula: t.text,
      reads: [],
      functions: [],
      unknownReferences: [],
      value: t.error ? null : diceString(t.dice, t.flat),
      error: t.error || null,
      status: t.error ? 'error' : 'ok',
      createdAt: null,
    }));
  });

  // Trackers: the max formula, and the min formula when the tracker has one
  // (a two-sided meter). Each is audited on its own.
  const trackerFormulas = model.trackers.flatMap((t) => {
    // Zone bounds and the note read `self`, which only exists on this
    // tracker's own row, so those entries are checked against a scope that
    // has it -- otherwise the audit would report every one as unknown.
    const selfScope = { ...scope, ...model.trackerScope(t) };
    const selfKnown = new Set([...known,
      ...Object.keys(model.trackerScope(t).self).map((k) => `self.${k}`)]);

    // `place` is the field in the tracker's own editor each one is typed in.
    const parts = [];
    if (t.maxFormula) parts.push({ id: t.id, name: t.name, formula: t.maxFormula, place: `trackerForm:${t.id}:max` });
    if (t.minFormula) {
      parts.push({
        id: `${t.id}:min`, name: `${t.name} min`, formula: t.minFormula, self: true, place: `trackerForm:${t.id}:min`,
      });
    }
    // Zone bounds are player formulas too (a danger zone from `self.max - 2`).
    (t.style?.zones || []).forEach((z, i) => {
      const label = z.label ? ` (${z.label})` : '';
      for (const edge of ['from', 'to']) {
        if (!z[edge]) continue;
        parts.push({
          id: `${t.id}:zone${i + 1}:${edge}`,
          name: `${t.name} zone ${i + 1}${label} ${edge}`,
          formula: z[edge],
          self: true,
          place: `trackerForm:${t.id}:zone:${i}:${edge}`,
        });
      }
    });
    // Every {…} the player wrote in the tracker's note, one row each.
    if (hasTokens(t.note)) {
      model.renderProse(t.note, model.trackerScope(t))
        .filter((seg) => seg.kind !== 'text')
        .forEach((seg, i) => parts.push({
          id: `${t.id}:note${i + 1}`,
          name: `${t.name} note`,
          formula: seg.kind === 'ref' ? seg.name : seg.expr,
          self: true,
          noteError: seg.error || null,
          // A bonus reading `target` was worked out once per destination,
          // which is not something one formula against one scope can redo.
          each: seg.kind === 'push' && seg.values ? seg : null,
          place: `tracker:${t.id}:note`,
        }));
    }
    return parts.map(({ id, name, formula, self: usesSelf, noteError, each, place }) => {
      const info = analyse(formula);
      const unknown = info.variables.filter((v) => !(usesSelf ? selfKnown : known).has(v)
        && !(each && isTargetName(v)));
      let value = each ? each.value : null;
      let error = noteError || info.error;
      if (info.ok && !unknown.length && !noteError && !each) {
        try { value = evaluateFormula(formula, usesSelf ? selfScope : scope); } catch (e) { error = e.message; }
      }
      return {
        id,
        place,
        name,
        source: t.source,
        formula,
        reads: info.variables,
        functions: info.functions,
        unknownReferences: unknown,
        value,
        error: unknown.length ? `Unknown value(s): ${unknown.join(', ')}` : error,
        status: error || unknown.length ? 'error' : 'ok',
        createdAt: t.createdAt || null,
        locals: usesSelf ? model.trackerScope(t) : null,
        where: 'the Trackers tab',
      };
    });
  });

  // Every number-or-formula field, from the one registry.
  const fieldFormulas = FORMULA_FIELDS.flatMap((entry) => entry.collect(model).map((it) => fieldRow(entry, it, known)));

  return skillFormulas.concat(inlineFormulas).concat(weaponFormulas)
    .concat(fieldFormulas).concat(trackerFormulas);
}

/**
 * Names something on this character asks for that nothing provides.
 *
 * Usually the definition was deleted or renamed and the places quoting it
 * were not: the name vanishes from every list, because nothing defines it,
 * and all that is left is a red token in a sentence somewhere. This walks
 * the other way round -- from the uses back -- so the sheet can say "three
 * things still ask for {qi.max}, and here they are".
 *
 * A name that was only ever a typo comes out the same way, which is right:
 * the symptom and the fix are identical.
 */
export function orphans(model, auditRows = null) {
  const known = new NameIndex(model.scopeNames());
  // A name that *is* defined but did not resolve -- one caught in a cycle,
  // one whose formula does not parse -- is not an orphan. It has a
  // definition and that definition has its own problem; saying "nothing
  // defines it" as well would send the player looking for something that is
  // right there.
  const defined = new Set((model.inlineDefinitions || []).map((d) => d.name));
  const found = new Map();
  const add = (name, use) => {
    if (!found.has(name)) found.set(name, { name, uses: [] });
    found.get(name).uses.push(use);
  };

  for (const u of model.inlineUses || []) {
    if (known.has(u.name) || defined.has(u.name)) continue;
    // Legal where it was written: a veil's own essence.self, and the like.
    if (u.scope && resolvePath(u.scope, u.name) !== undefined) continue;
    add(u.name, {
      where: describeSource(u.path),
      path: u.path,
      place: u.path,
      formula: u.source,
      kind: u.kind,
    });
  }
  // Everything that is not prose -- tracker maxima, skill formulas, weapon
  // tokens, crafting numbers -- has already been checked against the scope
  // it resolves in, so take that verdict rather than redoing it.
  for (const r of auditRows || model.audit()) {
    // Inline definitions are prose, and collectUses has already walked every
    // one of them; counting their audit rows too would list the same text
    // under the same name twice.
    if (r.source === 'inline') continue;
    for (const name of r.unknownReferences || []) {
      if (known.has(name) || defined.has(name)) continue;
      add(name, { where: r.where || r.name, path: r.id, place: r.place, formula: r.formula, kind: 'field' });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything wrong with the names on this character, as one list a reader
 * can work down. Five kinds, and each is a different fix:
 *
 *   cycle       two or more definitions waiting on each other
 *   duplicate   one name defined in more than one place
 *   shadow      a definition trying to take a name the sheet already owns
 *   misdirected a forwarded bonus with nowhere to land
 *   orphan      a name being asked for that nothing defines
 *
 * The individual formulas carry their own errors as well -- this is the
 * view from above, where a cycle is one problem naming three formulas
 * rather than three formulas each complaining separately.
 *
 * Each place carries `place`, where the formula is written in terms the
 * Formulas tab can take the player back to (see ui/formula-places.js): the
 * prose path it came from, or the field an audit row names.
 */
export function formulaProblems(model, auditRows = null) {
  const rows = auditRows || model.audit();
  const valueAt = new Map(rows
    .filter((r) => r.source === 'inline')
    .map((r) => [`${r.name}@${r.location}`, r.value]));
  const out = [];

  const seen = new Set();
  for (const e of model.inlineErrors || []) {
    if (!e.cycle) continue;
    const key = [...e.cycle].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'cycle',
      name: e.cycle.join(' → '),
      detail: e.error,
      places: [...new Set(e.cycle)].map((n) => {
        const d = (model.inlineDefinitions || []).find((x) => x.name === n);
        return { label: n, where: d ? describeSource(d.path) : '', formula: d?.expr || '', place: d?.path || null };
      }),
    });
  }

  for (const dup of model.inlineDuplicates || []) {
    out.push({
      kind: 'duplicate',
      name: dup.name,
      detail: `Defined in ${dup.definitions.length} places. The first is the one in force; `
        + 'the rest are ignored. Delete the ones you do not want, or give them their own names.',
      places: dup.definitions.map((d) => ({
        label: d.path === dup.inForce ? 'in force' : 'ignored',
        where: describeSource(d.path),
        formula: d.expr,
        value: valueAt.get(`{${dup.name}}@${d.path}`) ?? null,
        inForce: d.path === dup.inForce,
        place: d.path,
      })),
    });
  }

  for (const sh of model.inlineShadowed || []) {
    out.push({
      kind: 'shadow',
      name: sh.name,
      detail: sh.reason,
      places: [{ label: 'written in', where: describeSource(sh.path), formula: '', place: sh.path }],
    });
  }

  // A bonus that never arrives. Either its formula does not work, or it is
  // aimed at something that cannot take one -- and unlike a name nothing
  // defines, this fails silently everywhere else: the sentence still reads
  // fine, the destination is simply never told.
  for (const e of model.contributions?.errors || []) {
    out.push({
      kind: 'misdirected',
      name: e.target ? `${e.target} +=` : e.source || 'forwarded bonus',
      detail: e.error,
      places: [{ label: 'written in', where: describeSource(e.path), formula: e.source || '', place: e.path }],
    });
  }

  const orphanNames = new Set();
  for (const o of model.orphans(rows)) {
    orphanNames.add(o.name);
    // A name that only exists in one kind of field -- `self`, `essence.self`,
    // `target` -- was not deleted or misspelt; it was written somewhere it
    // does not exist, and the fix is to say which field it belongs to.
    const where = contextualNote(o.name);
    out.push({
      kind: 'orphan',
      name: o.name,
      detail: `${o.uses.length} ${o.uses.length === 1 ? 'place asks' : 'places ask'} for `
        + `"${o.name}" and nothing defines it. ${where || 'Either the definition was '
        + 'deleted or renamed, or the name is misspelt here.'}`,
      places: o.uses.map((u) => ({
        label: u.kind === 'ref' ? 'quoted in' : 'used in', where: u.where, formula: u.formula, place: u.place || null,
      })),
    });
  }

  // Anything else that does not work -- a tracker max that does not parse, a
  // skill formula reading something it may not. Listed here so that "needs
  // attention" really is everything, and the count beside it can be trusted.
  const spokenFor = new Set(model.inlineErrors
    ?.filter((e) => e.duplicate || e.cycle || e.shadow)
    .map((e) => `${e.name}@${e.path}`) || []);
  for (const r of rows) {
    if (r.status !== 'error') continue;
    if (r.source === 'inline' && spokenFor.has(`${String(r.name).slice(1, -1)}@${r.location}`)) continue;
    const unknowns = r.unknownReferences || [];
    // A row whose only fault is naming an orphan is that orphan's problem,
    // and it is already listed under it.
    if (unknowns.length && unknowns.every((n) => orphanNames.has(n))) continue;
    out.push({
      kind: 'broken',
      name: r.name,
      detail: r.error || 'This formula does not work.',
      places: [{
        label: 'written in', where: r.where || SOURCE_WORD[r.source] || r.source, formula: r.formula, place: r.place || null,
      }],
    });
  }
  return out;
}
