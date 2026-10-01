/**
 * ui/formula-places.js -- where a formula is written, as a jump back to it.
 *
 * The Formulas tab lists every formula on the character by where it lives --
 * "note 1 on Lore", "Bluff misc", "the Ki tracker's note" -- and a list that
 * says a formula is broken and leaves the player to go and find it is half an
 * answer. So each of those is a button, and this is what the button knows: a
 * place (a prose path from proseSources, or the field an audit row names)
 * turned into the search palette's own jump.
 *
 *   tab        the tab the field is drawn on
 *   expand     the outermost fold it hides in (uiPrefs.collapsed), which the
 *              palette opens before it looks
 *   sel        selectors for the field itself, where the panel writes one
 *   find       the text the field holds -- the palette's fallback, which finds
 *              the input whose value it is. It is what finds a class's ladder
 *              cell, whose binding is a JSON blob, and it keeps working through
 *              markup changes a selector would not survive
 *   open       buttons to press in turn while the field is still not drawn:
 *              the folds inside folds, a gear row's card, a tracker's editor,
 *              a folded cell, the second eidolon's page, the deck view, the
 *              skills the table is not showing. A fold is matched only while
 *              pressing it opens it (`data-collapse-to="false"`), and a card
 *              only while it is shut -- they are toggles, and pressing one that
 *              is open would shut the very thing being gone to
 *   buildView  the field is on the Overview's full page, which the session
 *              view replaces with its dashboard
 *
 * Pure, like the palette's index: no element, no DOM. The element's
 * `#formulaJump` does the travelling. tests/formula-places.test.mjs renders
 * every tab a jump names, presses its openers, and checks the field is there.
 */
import { COMPANION_KINDS } from '../companions.js';

/** A training side's tab: the sphere systems are named for what they train. */
const SIDE_TABS = { combat: 'martial', magic: 'magic', guile: 'guile' };

/** An attribute test, its value escaped the way CSS wants it inside quotes. */
const attr = (name, value) => `[${name}="${String(value).replace(/["\\]/g, '\\$&')}"]`;

/** The field an `itemArea`/`data-item` binding draws: `[data-item="notes|0|body"]`. */
const item = (list, i, field) => attr('data-item', `${list}|${i}|${field}`);

/** The field a `data-set` binding draws. */
const set = (path) => attr('data-set', path);

/** A fold's own button, only while pressing it would open the fold. */
const shutFold = (key) => `${attr('data-collapse', key)}${attr('data-collapse-to', 'false')}`;

/** A disclosure that says whether it is open, only while it is not. */
const shut = (sel) => `${sel}${attr('aria-expanded', 'false')}`;

/** The same slug the deck's manipulation groups fold under. */
const groupSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * A selector made of attribute tests, split back into them -- `[a="1"][b="2"]`
 * is `[{name: 'a', value: '1'}, {name: 'b', value: '2'}]`. For the tests,
 * which check a jump against markup with no DOM to query; null for anything
 * else.
 */
export function selectorAttribute(sel) {
  const out = [];
  const re = /\[([\w-]+)="((?:[^"\\]|\\.)*)"\]/g;
  let seen = '';
  for (const m of String(sel).matchAll(re)) {
    out.push({ name: m[1], value: m[2].replace(/\\(.)/g, '$1') });
    seen += m[0];
  }
  return out.length && seen === sel ? out : null;
}

/** Folds, outermost first, as a jump's `expand` and the buttons that open them. */
const folded = (keys) => ({ expand: keys[0] || null, open: keys.map(shutFold) });

/** A field on the Overview's full page, inside whatever folds it sits in there. */
function overviewPlace(sel, keys = []) {
  return { tab: 'overview', buildView: true, sel, ...folded(keys) };
}

/** A field of the card caster's deck, which is the tab's second view. */
function deckPlace(sel, keys = []) {
  return {
    tab: 'cardcasting', sel: sel ? [sel] : [], expand: keys[0] || null,
    open: [attr('data-deck-view', 'deck'), ...keys.map(shutFold)],
  };
}

/** A gear or other row's field. Its note is in the row's card; the rest is on the row. */
function gearPlace(list, i, field) {
  const place = { tab: 'gear', sel: [item(list, i, field)] };
  if (field === 'note') place.open = [shut(attr('data-gearopen', `${list}|${i}`))];
  return place;
}

/** A weapon's field, on a row the player may have folded shut. */
function weaponPlace(model, i, field) {
  const w = model.data.equipment?.weapons?.[Number(i)];
  return {
    tab: 'gear',
    sel: [item('equipment.weapons', i, field)],
    open: w?.collapsed ? [`${attr('data-action', 'toggle-weapon')}${attr('data-index', i)}`] : null,
  };
}

/** A skill row's field, on a table that hides unused rows until Show all. */
function skillPlace(i, field) {
  return { tab: 'skills', sel: [item('skills', i, field)], open: [attr('data-action', 'toggle-skills')] };
}

/** A tracker's formula, typed in its ✎ editor: max, min, a zone's bounds, the note. */
function trackerPlace(id, what, zone = null, edge = null) {
  const field = what === 'max' ? attr('data-tedit', 'maxFormula')
    : what === 'min' ? attr('data-tedit', 'minFormula')
      : what === 'zone' ? attr('data-zone', `${zone}|${edge}`)
        : attr('data-tedit', 'note');
  return { tab: 'trackers', sel: [field], open: [attr('data-tracker-edit', id)] };
}

/**
 * A talent row, bonus talent or tradition entry on a training side, inside its
 * side's fold -- or the blended fold, for a class whose pool reaches more than
 * one side -- and, for a note, inside the note's own fold. A class mirrored
 * onto another side shares its owner's levels, so it is gone to where the
 * owner is.
 */
function trainingPlace(model, side, list, i, field, fold) {
  let s = side;
  let path = list;
  const m = /^training\.(\w+)\.classes\.(\d+)\.levels$/.exec(list);
  if (m) {
    const cls = model.data.training?.[m[1]]?.classes?.[Number(m[2])];
    if (cls?.blendedMirror) {
      for (const [other, t] of Object.entries(model.data.training || {})) {
        const owner = (t?.classes || []).findIndex((x) => x?.name === cls.name && !x.blendedMirror);
        if (other !== m[1] && owner >= 0) { s = other; path = `training.${other}.classes.${owner}.levels`; break; }
      }
    }
  }
  if (!SIDE_TABS[s]) return null;
  const keys = [fold(s), ...(fold === training ? ['blended-training'] : [])];
  const open = keys.map(shutFold);
  if (/notes$/i.test(field)) open.push(shutFold(`tnote:${path}|${i}|${field}`));
  return { tab: SIDE_TABS[s], sel: [item(path, i, field)], expand: keys[0], open };
}
const training = (side) => `${side}-training`;

/**
 * A companion's field, on its kind's tab. The tab shows one of a kind at a
 * time, so the second and after are brought up from the chip strip first. `p`
 * is the block's own data path.
 */
function companionPlace(model, kind, index, sel) {
  const p = `${kind}.${index}`;
  return {
    tab: kind,
    sel: sel(p),
    // Always brought into view, the first of a kind too: another may be the
    // one showing, and the first used to be the one the jump could not reach.
    open: (model.data[kind] || []).length > 1
      ? [`${attr('data-action', 'companion-select')}${attr('data-kind', kind)}${attr('data-index', index)}`]
      : null,
  };
}

/** The field a companion path names: `eidolon:notes`, `eidolon:evolution:2`, `eidolon:item:belt`. */
function companionField(model, kind, index, key, a) {
  const sets = {
    abilities: 'abilities', specialAbility: 'specialAbility', specialQualities: 'specialQualities',
    baseEvolutions: 'baseEvolutions', dr: 'dr', resistances: 'resistances', immunities: 'immunities',
    notes: 'notes',
  };
  if (sets[key]) return companionPlace(model, kind, index, (p) => [set(`${p}.${sets[key]}`)]);
  const lists = {
    evolution: ['evolutions', 'notes'], attack: ['attacks', 'qualities'], feat: ['feats', 'notes'],
    trick: ['tricks', 'notes'], talent: ['talents', 'notes'], slotless: ['slotless', 'effect'],
  };
  if (lists[key]) return companionPlace(model, kind, index, (p) => [item(`${p}.${lists[key][0]}`, a, lists[key][1])]);
  if (key === 'item') return companionPlace(model, kind, index, (p) => [set(`${p}.items.${a}.effect`)]);
  return companionPlace(model, kind, index, () => []);
}

/**
 * Where one place is, as the jump's parts (all but `find`, which the caller
 * fills in from the text), or null for a place this does not know.
 */
function placeOf(model, ref) {
  const parts = ref.split(':');
  const [head, a, b, c] = parts;
  const d = model.data;
  switch (head) {
    /* ---------------- prose ---------------- */
    case 'formulas': return { tab: 'formulas', sel: [set('formulaNotes')] };
    // "Note 1 on Lore" is what the notes have always been called; the tab
    // that draws them is Extras & Notes.
    case 'note': return { tab: 'extras', sel: [item('notes', a, 'body')] };
    case 'approvalNotes': return { tab: 'extras', sel: [set('extras.approvalNotes')] };
    case 'background': return { tab: 'lore', sel: [item('backgroundSections', a, 'text')] };
    case 'defenses': return overviewPlace([set(`defenses.${a}`)], ['sg-defenses']);
    case 'trait':
      return a === 'additional'
        ? overviewPlace([item('traitSlots.additional', b, 'text')])
        : overviewPlace([set(`traitSlots.${a}.text`)]);
    case 'raceTrait': return overviewPlace([item('raceTraits', a, 'text')]);
    // A buff's note is in its editor, on the Overview's Buffs panel -- and on
    // the session dashboard's Buffs card, so this one needs no Build view.
    case 'buff':
      return {
        tab: 'overview', sel: [item('buffs', a, 'note')], expand: 'buffs',
        open: [shutFold('buffs'), shut(`${attr('data-action', 'buff-open')}${attr('data-index', a)}`)],
      };
    case 'weapon': return weaponPlace(model, a, 'special');
    case 'gear': return gearPlace('equipment.gear', a, `others.${b}`);
    case 'gearNote': return gearPlace('equipment.gear', a, 'note');
    case 'gearBonus': return gearPlace('equipment.gear', a, `bonuses.${b}.value`);
    case 'other': return gearPlace('equipment.other', a, `others.${b}`);
    case 'otherNote': return gearPlace('equipment.other', a, 'note');
    case 'otherBonus': return gearPlace('equipment.other', a, `bonuses.${b}.value`);
    case 'crafting': return { tab: 'crafting', sel: [item('crafting.projects', a, b)] };
    case 'spellNote': return { tab: 'vancian', sel: [item('vancian.prepared', a, 'note')] };
    case 'powerNote': return { tab: 'psionics', sel: [item(`psionics.classes.${a}.powers`, b, 'note')] };
    // A card's face has no notes field; its notes are gone to as the deck.
    case 'card': return deckPlace(b === 'notes' ? null : item('cardcasting.cards', a, 'effect'));
    case 'sideboard': return deckPlace(b === 'notes' ? null : item('cardcasting.sideboard', a, 'effect'));
    case 'deckManipulation': {
      const group = d.cardcasting?.manipulations?.[Number(a)]?.group || 'General';
      return deckPlace(item('cardcasting.manipulations', a, 'note'), [`deck-manip-${groupSlug(group)}`]);
    }
    case 'cardcasting': return deckPlace(set('cardcasting.notes'));
    case 'altTraining':
      return a === 'notes'
        ? { tab: 'altTraining', sel: [set('altTraining.notes')] }
        : { tab: 'altTraining', sel: [set(`altTraining.picks.${a}`)] };
    case 'altTrainingNote':
      return {
        tab: 'altTraining', sel: [set(`altTraining.rowNotes.${a}`)],
        open: [shutFold(`tnote:altTraining.rowNotes.${a}`)],
      };
    // A class's ladder, in its own fold on Progression; the notes under it
    // ("What they do") fold as a block, and each note on its own. A ladder
    // cell's binding is a JSON blob, so the text it holds is what finds it.
    case 'feature': return { tab: 'progression', ...folded([`progfeat-${a}`]) };
    case 'featureNote': {
      const name = parts.slice(2).join(':');
      return { tab: 'progression', ...folded([`progfeat-${a}`, `cfnotes-${a}`, `cfnote-${a}-${name}`]) };
    }
    // What a class feature does at the table, in the class actions block,
    // folded three deep: the block, the class, the feature.
    case 'actionFeature': {
      const list = d.progression?.actionFeatures || [];
      const i = list.findIndex((f) => String(f?.id) === a);
      if (i < 0) return { tab: 'progression' };
      return {
        tab: 'progression',
        sel: [`${attr('data-class-action', i)}${attr('data-feature-field', 'note')}`],
        ...folded(['classactions', `classactions-${list[i].className || ''}`, `classactions-feature-${a}`]),
      };
    }
    case 'template': {
      const t = parts.indexOf('table');
      const [ti, fi, ci] = (t < 0 ? parts.slice(1) : parts.slice(1, t));
      const list = ci === undefined ? `templates.${ti}.features` : `templates.${ti}.features.${fi}.children`;
      const at = ci === undefined ? fi : ci;
      if (t < 0) return { tab: 'template', sel: [item(list, at, 'text')] };
      const [bi, ri, cj] = parts.slice(t + 1);
      return { tab: 'template', sel: [item(`${list}.${at}.tables.${bi}.rows`, ri, `cells.${cj}`)] };
    }
    // Feats & Mythic. The mythic abilities and the mythic feats are folds
    // inside the mythic fold, and an ability's effect is a folded cell.
    case 'mythic': {
      const field = b || 'name';
      const group = field === 'featChoice' || field === 'featEffect' ? 'mythic-feats' : 'mythic-abilities';
      const place = { tab: 'features', sel: [item('mythic.abilities', a, field)], ...folded(['mythic', group]) };
      if (field === 'effect' || field === 'featEffect') place.open.push(attr('data-foldcell', `mythic:${a}:${field}`));
      return place;
    }
    case 'feat':
      return {
        tab: 'features', sel: [item(`featGroups.${a}.entries`, b, 'note')],
        ...folded([a === '0' ? 'featgroup-0' : 'feats']),
      };
    case 'grantedFeat':
      return /^\d+$/.test(a)
        ? { tab: 'features', sel: [item('grantedFeats.others', a, 'note')], ...folded(['feats']) }
        : { tab: 'features', sel: [set(`grantedFeats.${a}.note`)], ...folded(['feats']) };
    case 'mythicTradition':
      return { tab: 'features', sel: [set(`mythic.tradition.${a}`)], ...folded(['mythic-tradition']) };
    case 'mythicTraditionNote':
      return { tab: 'features', sel: [set(`mythic.tradition.notes.${a}`)], ...folded(['mythic-tradition']) };
    case 'talent': {
      const [side, ci, li, ...rest] = parts.slice(1);
      const field = rest.join(':') === 'notes' ? 'notes'
        : rest[0] === 'u' ? (rest[1] === 'notes' ? 'utilityNotes' : 'utilityTalent')
          : 'talent';
      return trainingPlace(model, side, `training.${side}.classes.${ci}.levels`, li, field, training);
    }
    case 'bonusTalent':
      return trainingPlace(model, a, `training.${a}.bonusTalents`, b, c === 'notes' ? 'notes' : 'talent',
        (s) => `${s}-bonus`);
    case 'weaponTalent': {
      const list = `training.combat.customizations.${a}.sets.${b}.talents`;
      const note = parts[4] === 'notes';
      return {
        tab: SIDE_TABS.combat,
        sel: [item(list, c, note ? 'notes' : 'talent')],
        expand: 'customized-weapons',
        open: [shutFold('customized-weapons'), ...(note ? [shutFold(`wnote:${list}|${c}`)] : [])],
      };
    }
    // The magic side's tradition has no table of entries, and only the magic
    // side's drawbacks are drawn; the rest are gone to as the side.
    case 'tradition':
      return a === 'magic' ? { tab: 'magic' }
        : trainingPlace(model, a, `training.${a}.tradition.entries`, b, 'talent', (s) => `${s}-tradition`);
    case 'drawback':
    case 'boughtOff':
      return a === 'magic'
        ? trainingPlace(model, a, `training.magic.tradition.${head === 'drawback' ? 'drawbacks' : 'boughtOff'}`,
          b, 'self', (s) => `${s}-tradition`)
        : (SIDE_TABS[a] ? { tab: SIDE_TABS[a] } : null);
    // A veil, numbered across the chakra slots and then the kheshig's. A slot
    // folds under its name; a veil the catalogue knows shows its words until
    // Edit is pressed.
    case 'veil': {
      const slots = d.akashic?.slots || [];
      const hi = Number(a);
      const inSlot = hi < slots.length;
      const list = inSlot ? `akashic.slots.${hi}.veils` : `akashic.kheshig.${hi - slots.length}.veils`;
      const field = c === 'name' ? 'name' : 'desc';
      return {
        tab: 'akashic',
        sel: [item(list, b, field)],
        ...(inSlot ? { expand: `veil:${slots[hi]?.slot || hi}` } : null),
        open: [
          ...(inSlot ? [shutFold(`veil:${slots[hi]?.slot || hi}`)] : []),
          ...(field === 'desc' ? [attr('data-vedit', `${list}|${b}`)] : []),
        ],
      };
    }
    // A maneuver's own entry. Its name is last in the path, being the part
    // that may hold a colon; its discipline folds under the discipline's name.
    case 'maneuverNote':
    case 'maneuver': {
      const field = head === 'maneuverNote' ? 'text' : b;
      const name = parts.slice(head === 'maneuverNote' ? 2 : 3).join(':');
      const key = `maneuvers.disciplines.${a}|${name}`;
      const disc = d.maneuvers?.disciplines?.[Number(a)]?.name || '';
      return {
        tab: 'maneuvers',
        sel: [`${attr('data-mfield', key)}${attr('data-mf', field)}`],
        expand: `disc:${disc}`,
        open: [shutFold(`disc:${disc}`), attr('data-medit', key)],
      };
    }
    case 'tracker': return trackerPlace(a, 'note');
    // A worksheet of the player's own, by name -- which may hold a colon, so
    // the row and cell are read off the end.
    case 'tab': {
      const ci = parts[parts.length - 1];
      const ri = parts[parts.length - 2];
      const name = parts.slice(1, -2).join(':');
      const index = (d.sheetTabs || []).findIndex((t) => t.name === name);
      return index >= 0
        ? { tab: `sys-${index}`, sel: [item(`sheetTabs.${index}.rows`, ri, `cells.${ci}`)] }
        : null;
    }

    /* ---------------- fields the audit names ---------------- */
    case 'skillRanks': return skillPlace(a, 'rankSources.bought');
    case 'skillMisc': return skillPlace(a, 'offset');
    case 'weaponMisc': return weaponPlace(model, a, 'miscDamage');
    // The Other columns, the hit-point parts and the language slots are all on
    // the Overview's full page, beside the totals they belong to, in the
    // defence or offence group -- the hit-point parts in a fold of their own.
    case 'offset': {
      const keys = a === 'hp.total' ? ['sg-defenses', 'hp:build']
        : a.startsWith('attack.') ? ['sg-offenses'] : ['sg-defenses'];
      return overviewPlace([attr('data-offset', a)], keys);
    }
    case 'hp':
      return overviewPlace([set(`hp.${a}`)], a === 'deathBonus' ? ['sg-defenses'] : ['sg-defenses', 'hp:build']);
    case 'speed': return overviewPlace([item('identity.speeds', a, 'bonus')], ['sg-offenses']);
    case 'languages': return overviewPlace([set('identity.languageExtra')], ['languages']);
    case 'sphereCell':
      if (a === 'guile') {
        return { tab: 'guile', sel: [item('training.guile.spheres', b, c)], ...folded(['guile-spheres']) };
      }
      return SIDE_TABS[a]
        ? { tab: SIDE_TABS[a], sel: [attr('data-sphere-bonus', `${a}|${b}|${c}`)], ...folded([`${a}-spheres`]) }
        : null;
    case 'craftNumber': {
      const [list, i, field] = ref.slice('craftNumber:'.length).split('|');
      return { tab: 'crafting', sel: [item(list, i, field)] };
    }
    case 'vancianConcentration': return { tab: 'vancian', sel: [set(`vancian.classes.${a}.concentration`)] };
    case 'deckManipulations': return deckPlace(set('cardcasting.manipulationsAvailable'), ['deck-manipulations']);
    case 'trackerForm': return trackerPlace(a, b, c, parts[4]);

    default: {
      // A sub-system's source-sheet leftovers: `akashicExtra:<row>:<cell>`.
      const extra = /^(\w+)Extra$/.exec(head);
      if (extra) {
        const sel = item(`${extra[1]}.sourceExtras`, a, `cells.${b}`);
        return extra[1] === 'cardcasting' ? deckPlace(sel) : { tab: extra[1], sel: [sel] };
      }
      // A companion's prose: `eidolon:notes` for the first of a kind, always
      // the first block, and `eidolon:eidolon2:notes` for the ones after.
      if (!COMPANION_KINDS.includes(head)) return null;
      const list = d[head] || [];
      const later = a !== head ? list.findIndex((x) => String(x?.id) === a) : -1;
      // Found by id wherever it now stands -- first in the list too, which is
      // where a later companion lands once the one before it is removed.
      return later >= 0
        ? companionField(model, head, later, b, c)
        : companionField(model, head, 0, a, b);
    }
  }
}

/**
 * Where a formula is written, as a jump the palette can make, or null when
 * the place is not one this knows -- the Formulas tab then shows where it is
 * without offering to go there.
 */
export function formulaPlace(model, place) {
  const ref = String(place ?? '').trim();
  if (!ref) return null;
  const spot = placeOf(model, ref);
  if (!spot) return null;
  return {
    tab: spot.tab,
    expand: spot.expand || null,
    sel: spot.sel || [],
    find: spot.find ?? textFor(model, ref),
    open: spot.open?.length ? spot.open : null,
    buildView: !!spot.buildView,
  };
}

/**
 * The text the field at a place holds, for the palette to find it by: a prose
 * field's own text, or the formula typed into a field the audit names.
 */
function textFor(model, ref) {
  const text = (model.proseSources() || []).find((s) => s.path === ref)?.text;
  if (text) return text;
  return (model.audit() || []).find((r) => r.place === ref)?.formula ?? '';
}
