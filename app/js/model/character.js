/**
 * The Character class -- the live character model.
 *
 * Responsibilities:
 *   1. Hold the imported character data.
 *   2. Recompute derived stats whenever an input changes.
 *   3. Expose a flat, read-only scope that player-authored formulas evaluate
 *      against (see scope.js).
 *
 * ## Reconciliation
 *
 * The source spreadsheets compute many totals through Google-only formulas
 * (ARRAYFORMULA/FILTER) that do not survive an .xlsx export, and through gear
 * and Automatic Bonus Progression tables spread over several tabs. Rather than
 * guess at those, the model computes each derived stat from the parts it can
 * see and stores the difference against the sheet's own value as an `offset`.
 *
 * offset = sheetValue - computedFromVisibleParts
 *
 * So on import every number matches the Google Sheet exactly, and when you
 * raise Con by 2 the Fortitude save still moves by exactly +1. The offset is
 * visible and editable in the UI, which keeps the "where did this number come
 * from" question answerable instead of hidden in a formula. See reconcile.js.
 *
 * ## Where the work lives
 *
 * The domain passes are modules under `model/`, each taking the model as its
 * first argument. This class keeps the state, the order the passes run in, and
 * a one-line delegation per method, so `model.tablePlay(id)` still means what
 * it always did while the eight hundred lines behind it live with the rest of
 * the cardcasting rules. A `#name` delegation is still private: the stub is
 * the class's, the body is the module's.
 */

import {
  DERIVED, FORWARD_BY_DERIVED, SIZE_CARRY_MULTIPLIER, abilityMod, armorParts, carryTiers,
  iterativeAttacks, skillTotal, statMod,
} from '../rules.js';
import { evaluateFormula } from '../formula.js';
import {
  applyMythic, attunementUnlocked, pointBuySummary, pointBuyTable, refreshAbilities, setBuild,
  setMythicPick, setPick,
} from './abilities.js';
import { breakdown } from './breakdown.js';
import { normalise, toDocument } from './document.js';
import {
  addSystemTab, hideTab, listAdd, listAt, listMove, listMoveInto, listMoveTo, listRemove,
  moveTab, removeSystemTab, renameSkill, renameSystemTab, resetTabOrder, sessionDefaultTabs,
  setItem, setTabColor, setTabOrder, setValue, setViewMode, showTab, systemTabsInUse,
  tabColor, tabOrder,
  taggedSystemTabs, toggleClassSystem, toggleProficiency, viewMode,
} from './edit.js';
import { emit, subscribe } from './events.js';
import { markUndo, undo, undoLabel, clearUndo } from './undo.js';
import {
  addClassFeatureColumn, addClassFeatureColumnOptions, addClassFeatureNote,
  addClassFeatureRuleGroup, addProgressionTrack, applyGestalt, classFeatureColumnOptions,
  classFeatureColumnOptionsChosen, classFeatureDue, classFeatureNotes, classFeatureParked,
  classFeatureRows,
  classFeatureRuleGroups, classLevelAt, classLevelCount, classLevelsIn, classNames,
  featureGroup, fillProgressionTrack, grantingGroups, plannerHasClass, progressionClasses,
  removeClassFeatureColumn, removeClassFeatureColumnOptions, removeClassFeatureNote,
  removeClassFeatureGroup, removeClassFeatureRuleGroup, removeProgressionTrack,
  renameClassFeatureColumn,
  setClassFeature, setClassFeatureColumnOptions, setClassFeatureColumnRule, setClassFeatureNote,
  setClassFeatureRuleGroup, setColumnWidth, setProgressionClass,
} from './progression.js';
import {
  audit, diffFromSource, formulaProblems, offsetOf, orphans, reconcile, setOffset,
} from './reconcile.js';
import {
  characterScope, forwardTargets, forwarded, forwardedInto, forwardedSplit, forwardsEarly,
  proseSources, renderProse, resolveInlineNames, scopeNames, trackerScope,
} from './scope.js';
import {
  addCustomization, applyBudget, blendedClasses, checkCustomizationBases, customizationFor,
  ownClassLevels, pairBlended, recomputeCustomizations, recomputeSphereRows, recomputeTraining,
  setTalentEntry,
  removeCustomization, setBlended, setCustomizationActive, setCustomizationRule,
  setCustomizationSpec, sphereRanksBySkill, sphereTalentKnowledge, sphereTally,
} from './spheres.js';
import {
  addGuileClass, addGuileSphere, guileRanksBySkill, recomputeGuile, recomputeGuileSpheres,
} from './subsystems/guile.js';
import {
  recomputeEquipment, recomputeUnarmed, setGearColumns, weaponHandles,
} from './stats/attacks.js';
import {
  applyDamage, applyHealing, applyNonlethal, availableConditions, conditionState, grantTempHp,
  healDamage, hpMax, hpState, meterSpec, meterStyle, mythicHp, resolveAcBonuses,
  resolveDefenceBonuses, resolveDefenceText, restRefresh, restoreAll, setMeterStyle, sizeNow,
  takeDamage,
} from './stats/defenses.js';
import { resolveSaveBonuses } from './stats/saves.js';
import {
  addWealthEntry, casterLevel, makeOffering, removeWealthEntry, wealthView, wealthViewOf,
} from './stats/wealth.js';
import { essenceScope, recomputeAkashic, veilScope } from './subsystems/akashic.js';
import {
  cardRolls, castCheck, drawCards, hasDeckFeat, hasManipulation, manaPlayCheck,
  recomputeCardcasting, recomputeTable, rollFor, shuffle, spellPointTracker, spendSP,
  tableBoost, tableBury, tableCard, tableDraw, tableEnd, tableExileRandom, tableInstances,
  tableKeywords, tableLog, tableMove, tableName, tableNextRound, tablePeek, tablePlay,
  tableRedraw, tableResolve, tableRetrace, tableReveal, tableRoll, tableSettle,
  tableShuffleDiscard, tableSpend, tableStart, tableTap, tableTrigger,
} from './subsystems/cardcasting.js';
import {
  companionDamage, companionHeal, companionMaster, companionRest, recomputeCompanions,
} from './subsystems/companions.js';
import { cookingView } from './subsystems/cooking.js';
import { craftSkills, recomputeCrafting } from './subsystems/crafting.js';
import {
  recomputeManeuvers, setManeuverField, setManeuverNote, toggleManeuver,
} from './subsystems/maneuvers.js';
import { primordiaPrereq, primordiaTalents, recomputePrimordia } from './subsystems/primordia.js';
import { psionicsNewDay, recomputePsionics } from './subsystems/psionics.js';
import {
  addDraftTechnique, draftFromTechnique, mergeTechniquesFrom, removeTechnique,
  resetDraftTechnique, selectTechnique, techniqueByName, techniqueContext, techniqueTalents,
  techniqueView,
} from './subsystems/techniques.js';
import { recomputeVancian, vancianNewDay } from './subsystems/vancian.js';
import {
  addTemplateTableColumn, moveTemplateChild, moveTemplateGroup, moveTemplateTable,
  nudgeTemplateChild, removeTemplateTableColumn,
} from './templates.js';
import {
  addTracker, ensureMythicPower, isProtectedTracker, loadTrackers, recomputeBuffs,
  recomputeTrackers, removeTracker, seedTrackers, stepTracker, tierNow, updateTracker,
} from './trackers.js';
import { featCount, recomputeLanguages, recomputeSpeeds } from './traits.js';
import { getPath, safe, setPath, skillForwardKey, skillKey } from './util.js';

export class Character {
  /** @param {object} data  a document produced by tools/convert.py */
  constructor(data) {
    this.data = structuredClone(data);
    this.listeners = new Set();

    // Values as the Google Sheet had them, kept for reconciliation and for the
    // "differs from source sheet" indicator.
    this.imported = {};
    for (const d of DERIVED) this.imported[d.key] = Number(getPath(this.data, d.key) ?? 0);
    this.imported['initiative'] = Number(this.data.hp?.initiative ?? 0);

    this.offsets = {};
    this.#normalise();
    this.trackers = this.#loadTrackers();
    this.#reconcile();
    this.recompute();
    // Forwarded bonuses are written in prose, so the first reconcile could not
    // see them -- and a document saved by this sheet has them in every total
    // it saved. Left there, the offset would swallow the bonus on load and the
    // sheet would add it again, so a +2 to Will would climb by 2 every time
    // the document was reopened. Now that the bonuses are known, measure once
    // more with them in the picture.
    if (this.#forwardsEarly()) {
      // ...except where the first measurement already balanced. An offset is
      // what the workbook added that this sheet cannot see; if there was
      // nothing to explain before the bonuses were counted, there is nothing
      // to explain now either, and the difference the second measurement finds
      // is the bonus itself. That is the case for a document saved before a
      // rule was written -- or before the sheet could read where it was
      // written -- and swallowing it would mean the rule never showed up at
      // all. Where the workbook *did* add something the two are genuinely
      // indistinguishable, and the second reading stands.
      //
      // Only where the stat's own sum did not move, though. A bonus forwarded
      // *at* a stat leaves its parts alone, so the first reading is a fair
      // measurement of what the workbook hid; one that lands on an ability
      // score and cascades in changes the parts themselves, so the first
      // reading was taken from stale inputs and balancing there is a
      // coincidence of magnitudes rather than evidence of anything. That
      // coincidence is easy to hit -- a −2 offset against a +2 cascade -- and
      // it cost the character the bonus on every reopen.
      const balanced = new Set(Object.entries(this.offsets)
        .filter(([, v]) => !v).map(([k]) => k));
      const bareBefore = { ...this.bare };
      this.#reconcile();
      for (const key of balanced) {
        if (this.bare[key] === bareBefore[key]) this.offsets[key] = 0;
      }
      this.recompute();
    }
  }

  /**
   * Recompute every derived value. Cheap enough to run on each keystroke.
   *
   * Twice, when a forwarded bonus asks for it. A `{saves.will += 2}` is
   * written in prose, and prose is read late -- long after the saves and AC it
   * may be aimed at have been totalled -- so the sheet is worked out, the
   * bonuses are read off it, and it is worked out again with them in hand.
   *
   * Never a third time. The second pass reuses the amounts the first one
   * arrived at rather than working them out afresh, so a bonus can never chase
   * its own destination round a loop and settle somewhere that depends on
   * where it started. A character with no forwarded bonuses, or none aimed
   * earlier than the skills, costs exactly what it always did.
   */
  recompute() {
    this.contributions = null;
    this.#computePass();
    if (this.#forwardsEarly()) this.#computePass();
    this.#emit({ type: 'recompute' });
    return this;
  }

  #computePass() {
    const c = this.data;
    this.#applyMythic();
    this.#refreshAbilities();
    this.#applyGestalt();
    this.#resolveDefenceBonuses();

    for (const d of DERIVED) {
      // The reconciliation offset and the forwarded bonus are both flat
      // additions and are deliberately kept apart: the offset is what the
      // source workbook added and this sheet cannot see, while the forwarded
      // amount is a rule the player wrote down and can point at.
      const value = safe(() => d.compute(c), 0) + (this.offsets[d.key] || 0)
        + this.#forwarded(FORWARD_BY_DERIVED[d.key]);
      if (d.key === 'initiative') c.hp.initiative = value;
      else setPath(c, d.key, value);
    }

    c.attack.iterative = iterativeAttacks(c.attack.bab);

    // Carry capacity follows Strength, size, Ant Haul and quadruped status.
    const tiers = carryTiers(c.abilities.str.tempScore + (c.carry?.strBonus || 0), {
      multiplier: SIZE_CARRY_MULTIPLIER[c.identity.size] ?? 1,
      antHaul: c.carry?.antHaul || 1,
      quadruped: !!c.carry?.quadruped,
    });
    c.carry = { ...c.carry, ...tiers };

    this.#recomputeSpeeds();
    this.#recomputeTraining();
    this.#recomputeGuile();

    // Skills: total ranks from their sources, then the bonus.
    // totalRanks = MIN(level, bought + (specialty+gear+other)*level + spheres)
    const level = Number(c.identity.level) || 0;
    const specialtyKeys = new Set(Object.values(c.specialtySkills || {}).filter(Boolean));
    const sphereRanksBySkill = this.#sphereRanksBySkill();
    // Skill spheres pay into a skill the operative chose rather than one a
    // table named, so their ranks are worked out against the martial side's
    // map: where the two land on the same row they do not stack, and the
    // overlap pays a competence bonus instead. See subsystems/guile.js.
    const guileRanks = this.#guileRanksBySkill(sphereRanksBySkill);

    // Inline names ({skill_familiarity = …}) resolve before skill misc so a
    // misc formula can read them. Their scope has no skill totals yet, which
    // is intended: skills may read names, names may not read skills, so no
    // cycle can form between the two.
    this.#resolveInlineNames();
    // The defence boxes are both a source of forwarded bonuses and a
    // destination for them, so they settle here: after the prose has been
    // read, and before the skills, which may read `dr.fire` or `immune.sleep`
    // the way they read anything else.
    this.#resolveDefenceText();
    const miscScope = this.scope();

    c.skills.forEach((s, i) => {
      const primary = (s.abilities || [])[0];
      const am = statMod(c, primary, null);
      const src = s.rankSources || { bought: 0, gear: false, other: false };
      const specialty = specialtyKeys.has(skillKey(s));
      const spheres = guileRanks.ranks.has(i) ? guileRanks.ranks.get(i)
        : sphereRanksBySkill.has(i) ? sphereRanksBySkill.get(i)
          : (Number(s.importedSphereRanks) || 0);

      // Bought ranks accept a plain number or a level-derived formula
      // ("level", "floor(level - 2)"), evaluated in the same sandbox as
      // the trackers.
      let bought = 0;
      s.boughtError = null;
      if (typeof src.bought === 'string' && src.bought.trim() !== '') {
        try {
          bought = Math.max(0, Math.floor(Number(evaluateFormula(src.bought, { level })) || 0));
        } catch (err) {
          s.boughtError = err.message;
        }
      } else {
        bought = Number(src.bought) || 0;
      }
      s.boughtResolved = bought;

      const flags = (specialty ? 1 : 0) + (src.gear ? 1 : 0) + (src.other ? 1 : 0);
      const capped = Math.min(level, bought + flags * level + spheres);
      if (s.ranksOffset === undefined) {
        s.ranksOffset = (Number(s.totalRanks) || 0) - capped;
      }
      s.specialtyFlag = specialty;
      s.sphereRanks = spheres;
      s.totalRanks = capped + s.ranksOffset;

      const computed = skillTotal({
        ranks: s.totalRanks,
        classSkill: !!s.classSkill,
        abilityMod: am,
        misc: 0,
        acp: s.armorPenalty ? armorParts(c).acp : 0,
      });
      if (s.importedBonus === undefined) {
        s.importedBonus = Number(s.bonus) || 0;
        s.offset = s.importedBonus - computed;
      }

      // Misc accepts an integer or a formula ("int.mod", "skill_familiarity",
      // "floor(level/2)") reading abilities, level and inline names.
      s.miscError = null;
      let misc = 0;
      if (typeof s.offset === 'string' && s.offset.trim() !== '') {
        try {
          const v = evaluateFormula(s.offset, miscScope);
          misc = Math.floor(Number(v) || 0);
        } catch (err) {
          s.miscError = err.message;
        }
      } else {
        misc = Number(s.offset) || 0;
      }
      s.miscResolved = misc;
      // A bonus forwarded here from somewhere else on the sheet is kept beside
      // the Misc the player typed, never folded into it: the column has to go
      // on saying what was written in it, and the row has to go on adding up.
      s.forwarded = this.#forwarded(skillForwardKey(s));
      // Half the character's level, where two skill spheres (or a skill
      // sphere and a combat one) both associate themselves with this row and
      // so cannot both pay it ranks. Kept beside Misc rather than folded into
      // it for the same reason `forwarded` is: the column has to go on saying
      // what was typed in it.
      s.competence = guileRanks.competence.get(i) || 0;
      s.bonus = computed + misc + s.forwarded + s.competence;
      s.abilityMod = am;
    });

    this.#applyBudget();
    this.#recomputeLanguages();
    this.#recomputeSphereRows();
    // After the skills, like the sphere rows above it and for the same
    // reason: every guile save DC and range is read off the ranks the loop
    // has just settled.
    this.#recomputeGuileSpheres();
    this.#recomputeEquipment();
    this.#recomputeCrafting();
    this.#recomputeAkashic();
    this.#recomputeManeuvers();
    this.#recomputeVancian();
    this.#recomputePsionics();
    this.#recomputeCardcasting();
    // Last of the systems: its prerequisite check reads the casting types the
    // training pass works out and the casting classes the Vancian one names.
    this.#recomputePrimordia();
    this.#recomputeCompanions();
    this.#recomputeTrackers();
    // After the trackers and sub-systems, so a buff's formula can read them
    // ("1 + essence.shoulder" follows the essence as it is re-invested).
    this.#recomputeBuffs();
  }

  /* ---------------- delegations ---------------- */
  //
  // Below here the class is an index. Each entry hands the model to the
  // function that does the work, in the file named above its group -- so
  // `model.tablePlay(id)` still means what it always did, and the rules behind
  // it live with the rest of the cardcasting rules. A `#name` stub is still
  // private: the class owns the name, the module owns the body.

  // events.js
  subscribe(...a) { return subscribe(this, ...a); }
  #emit(...a) { return emit(this, ...a); }

  // breakdown.js
  breakdown(...a) { return breakdown(this, ...a); }

  // reconcile.js
  #reconcile(...a) { return reconcile(this, ...a); }
  offsetOf(...a) { return offsetOf(this, ...a); }
  setOffset(...a) { return setOffset(this, ...a); }
  diffFromSource(...a) { return diffFromSource(this, ...a); }
  audit(...a) { return audit(this, ...a); }
  orphans(...a) { return orphans(this, ...a); }
  formulaProblems(...a) { return formulaProblems(this, ...a); }

  // document.js
  #normalise(...a) { return normalise(this, ...a); }
  toJSON(...a) { return toDocument(this, ...a); }

  // edit.js
  set(...a) { return setValue(this, ...a); }
  /* Taking back the last structural change. `markUndo` is called by the
     operations themselves, before they touch anything; see model/undo.js. */
  markUndo(...a) { return markUndo(this, ...a); }

  undo(...a) { return undo(this, ...a); }

  clearUndo(...a) { return clearUndo(this, ...a); }

  get undoLabel() { return undoLabel(this); }

  list(...a) { return listAt(this, ...a); }
  listAdd(...a) { return listAdd(this, ...a); }
  listRemove(...a) { return listRemove(this, ...a); }
  toggleProficiency(...a) { return toggleProficiency(this, ...a); }
  listMove(...a) { return listMove(this, ...a); }
  listMoveTo(...a) { return listMoveTo(this, ...a); }
  listMoveInto(...a) { return listMoveInto(this, ...a); }
  setItem(...a) { return setItem(this, ...a); }
  #renameSkill(...a) { return renameSkill(this, ...a); }
  addSystemTab(...a) { return addSystemTab(this, ...a); }
  renameSystemTab(...a) { return renameSystemTab(this, ...a); }
  removeSystemTab(...a) { return removeSystemTab(this, ...a); }
  viewMode(...a) { return viewMode(this, ...a); }
  setViewMode(...a) { return setViewMode(this, ...a); }
  systemTabsInUse(...a) { return systemTabsInUse(this, ...a); }
  taggedSystemTabs(...a) { return taggedSystemTabs(this, ...a); }
  toggleClassSystem(...a) { return toggleClassSystem(this, ...a); }
  sessionDefaultTabs(...a) { return sessionDefaultTabs(this, ...a); }
  tabOrder(...a) { return tabOrder(this, ...a); }
  setTabOrder(...a) { return setTabOrder(this, ...a); }
  resetTabOrder(...a) { return resetTabOrder(this, ...a); }
  showTab(...a) { return showTab(this, ...a); }
  hideTab(...a) { return hideTab(this, ...a); }
  moveTab(...a) { return moveTab(this, ...a); }
  tabColor(...a) { return tabColor(this, ...a); }
  setTabColor(...a) { return setTabColor(this, ...a); }

  // abilities.js
  #applyMythic(...a) { return applyMythic(this, ...a); }
  #refreshAbilities(...a) { return refreshAbilities(this, ...a); }
  get pointBuyTable() { return pointBuyTable(this); }
  pointBuySummary(...a) { return pointBuySummary(this, ...a); }
  get attunementUnlocked() { return attunementUnlocked(this); }
  setBuild(...a) { return setBuild(this, ...a); }
  setPick(...a) { return setPick(this, ...a); }
  setMythicPick(...a) { return setMythicPick(this, ...a); }

  // progression.js
  setProgressionClass(...a) { return setProgressionClass(this, ...a); }
  fillProgressionTrack(...a) { return fillProgressionTrack(this, ...a); }
  addProgressionTrack(...a) { return addProgressionTrack(this, ...a); }
  removeProgressionTrack(...a) { return removeProgressionTrack(this, ...a); }
  progressionClasses(...a) { return progressionClasses(this, ...a); }
  classNames(...a) { return classNames(this, ...a); }
  classLevelsIn(...a) { return classLevelsIn(this, ...a); }
  classLevelCount(...a) { return classLevelCount(this, ...a); }
  #featureGroup(...a) { return featureGroup(this, ...a); }
  #classLevelAt(...a) { return classLevelAt(this, ...a); }
  #grantingGroups(...a) { return grantingGroups(this, ...a); }
  setClassFeature(...a) { return setClassFeature(this, ...a); }
  addClassFeatureColumn(...a) { return addClassFeatureColumn(this, ...a); }
  renameClassFeatureColumn(...a) { return renameClassFeatureColumn(this, ...a); }
  classFeatureRuleGroups(...a) { return classFeatureRuleGroups(this, ...a); }
  addClassFeatureRuleGroup(...a) { return addClassFeatureRuleGroup(this, ...a); }
  setClassFeatureRuleGroup(...a) { return setClassFeatureRuleGroup(this, ...a); }
  removeClassFeatureRuleGroup(...a) { return removeClassFeatureRuleGroup(this, ...a); }
  classFeatureNotes(...a) { return classFeatureNotes(this, ...a); }
  addClassFeatureNote(...a) { return addClassFeatureNote(this, ...a); }
  setClassFeatureNote(...a) { return setClassFeatureNote(this, ...a); }
  removeClassFeatureNote(...a) { return removeClassFeatureNote(this, ...a); }
  setClassFeatureColumnOptions(...a) { return setClassFeatureColumnOptions(this, ...a); }
  classFeatureColumnOptions(...a) { return classFeatureColumnOptions(this, ...a); }
  classFeatureColumnOptionsChosen(...a) { return classFeatureColumnOptionsChosen(this, ...a); }
  addClassFeatureColumnOptions(...a) { return addClassFeatureColumnOptions(this, ...a); }
  removeClassFeatureColumnOptions(...a) { return removeClassFeatureColumnOptions(this, ...a); }
  setClassFeatureColumnRule(...a) { return setClassFeatureColumnRule(this, ...a); }
  classFeatureRows(...a) { return classFeatureRows(this, ...a); }
  classFeatureDue(...a) { return classFeatureDue(this, ...a); }

  classFeatureParked(...a) { return classFeatureParked(this, ...a); }

  removeClassFeatureGroup(...a) { return removeClassFeatureGroup(this, ...a); }
  setColumnWidth(...a) { return setColumnWidth(this, ...a); }
  removeClassFeatureColumn(...a) { return removeClassFeatureColumn(this, ...a); }
  #applyGestalt(...a) { return applyGestalt(this, ...a); }
  #plannerHasClass(...a) { return plannerHasClass(this, ...a); }

  // scope.js
  scope(...a) { return characterScope(this, ...a); }
  scopeNames(...a) { return scopeNames(this, ...a); }
  forwardTargets(...a) { return forwardTargets(this, ...a); }
  #forwarded(...a) { return forwarded(this, ...a); }
  #forwardedSplit(...a) { return forwardedSplit(this, ...a); }
  forwardedInto(...a) { return forwardedInto(this, ...a); }
  #resolveInlineNames(...a) { return resolveInlineNames(this, ...a); }
  proseSources(...a) { return proseSources(this, ...a); }
  renderProse(...a) { return renderProse(this, ...a); }
  trackerScope(...a) { return trackerScope(this, ...a); }
  #forwardsEarly(...a) { return forwardsEarly(this, ...a); }

  // trackers.js
  #seedTrackers(...a) { return seedTrackers(this, ...a); }
  #tierNow(...a) { return tierNow(this, ...a); }
  #loadTrackers(...a) { return loadTrackers(this, ...a); }
  #ensureMythicPower(...a) { return ensureMythicPower(this, ...a); }
  #recomputeTrackers(...a) { return recomputeTrackers(this, ...a); }
  addTracker(...a) { return addTracker(this, ...a); }
  stepTracker(...a) { return stepTracker(this, ...a); }
  updateTracker(...a) { return updateTracker(this, ...a); }
  isProtectedTracker(...a) { return isProtectedTracker(this, ...a); }
  removeTracker(...a) { return removeTracker(this, ...a); }
  #recomputeBuffs(...a) { return recomputeBuffs(this, ...a); }

  // traits.js
  #recomputeSpeeds(...a) { return recomputeSpeeds(this, ...a); }
  #recomputeLanguages(...a) { return recomputeLanguages(this, ...a); }
  featCount(...a) { return featCount(this, ...a); }

  // templates.js
  moveTemplateGroup(...a) { return moveTemplateGroup(this, ...a); }
  moveTemplateChild(...a) { return moveTemplateChild(this, ...a); }
  nudgeTemplateChild(...a) { return nudgeTemplateChild(this, ...a); }
  moveTemplateTable(...a) { return moveTemplateTable(this, ...a); }
  addTemplateTableColumn(...a) { return addTemplateTableColumn(this, ...a); }
  removeTemplateTableColumn(...a) { return removeTemplateTableColumn(this, ...a); }

  // spheres.js
  #applyBudget(...a) { return applyBudget(this, ...a); }
  #ownClassLevels(...a) { return ownClassLevels(this, ...a); }
  #recomputeCustomizations(...a) { return recomputeCustomizations(this, ...a); }
  #checkCustomizationBases(...a) { return checkCustomizationBases(this, ...a); }
  addCustomization(...a) { return addCustomization(this, ...a); }
  customizationFor(...a) { return customizationFor(this, ...a); }
  setCustomizationSpec(...a) { return setCustomizationSpec(this, ...a); }
  removeCustomization(...a) { return removeCustomization(this, ...a); }
  setCustomizationRule(...a) { return setCustomizationRule(this, ...a); }
  setCustomizationActive(...a) { return setCustomizationActive(this, ...a); }
  #sphereTally(...a) { return sphereTally(this, ...a); }
  #pairBlended(...a) { return pairBlended(this, ...a); }
  setBlended(...a) { return setBlended(this, ...a); }
  setTalentEntry(...a) { return setTalentEntry(this, ...a); }
  blendedClasses(...a) { return blendedClasses(this, ...a); }
  #recomputeTraining(...a) { return recomputeTraining(this, ...a); }
  #sphereTalentKnowledge(...a) { return sphereTalentKnowledge(this, ...a); }
  #sphereRanksBySkill(...a) { return sphereRanksBySkill(this, ...a); }
  #recomputeSphereRows(...a) { return recomputeSphereRows(this, ...a); }

  // subsystems/guile.js
  #recomputeGuile(...a) { return recomputeGuile(this, ...a); }
  #guileRanksBySkill(...a) { return guileRanksBySkill(this, ...a); }
  #recomputeGuileSpheres(...a) { return recomputeGuileSpheres(this, ...a); }
  addGuileClass(...a) { return addGuileClass(this, ...a); }
  addGuileSphere(...a) { return addGuileSphere(this, ...a); }

  // stats/saves.js
  #resolveSaveBonuses(...a) { return resolveSaveBonuses(this, ...a); }

  // stats/defenses.js
  #resolveDefenceBonuses(...a) { return resolveDefenceBonuses(this, ...a); }
  #resolveDefenceText(...a) { return resolveDefenceText(this, ...a); }
  #resolveAcBonuses(...a) { return resolveAcBonuses(this, ...a); }
  sizeNow(...a) { return sizeNow(this, ...a); }
  get conditionState() { return conditionState(this); }
  availableConditions(...a) { return availableConditions(this, ...a); }
  get mythicHp() { return mythicHp(this); }
  get hpMax() { return hpMax(this); }
  get hpState() { return hpState(this); }
  damage(...a) { return takeDamage(this, ...a); }
  heal(...a) { return healDamage(this, ...a); }
  restoreAll(...a) { return restoreAll(this, ...a); }
  applyDamage(...a) { return applyDamage(this, ...a); }
  applyNonlethal(...a) { return applyNonlethal(this, ...a); }
  grantTempHp(...a) { return grantTempHp(this, ...a); }
  applyHealing(...a) { return applyHealing(this, ...a); }
  restRefresh(...a) { return restRefresh(this, ...a); }
  meterStyle(...a) { return meterStyle(this, ...a); }
  setMeterStyle(...a) { return setMeterStyle(this, ...a); }
  meterSpec(...a) { return meterSpec(this, ...a); }

  // stats/attacks.js
  weaponHandles(...a) { return weaponHandles(this, ...a); }
  setGearColumns(...a) { return setGearColumns(this, ...a); }
  #recomputeEquipment(...a) { return recomputeEquipment(this, ...a); }
  #recomputeUnarmed(...a) { return recomputeUnarmed(this, ...a); }

  // stats/wealth.js
  get casterLevel() { return casterLevel(this); }
  wealthView(...a) { return wealthViewOf(this, ...a); }
  addWealthEntry(...a) { return addWealthEntry(this, ...a); }
  removeWealthEntry(...a) { return removeWealthEntry(this, ...a); }
  makeOffering(...a) { return makeOffering(this, ...a); }

  // subsystems/akashic.js
  #recomputeAkashic(...a) { return recomputeAkashic(this, ...a); }
  #essenceScope(...a) { return essenceScope(this, ...a); }
  veilScope(...a) { return veilScope(this, ...a); }

  // subsystems/cardcasting.js
  #recomputeCardcasting(...a) { return recomputeCardcasting(this, ...a); }
  #recomputeTable(...a) { return recomputeTable(this, ...a); }
  #hasDeckFeat(...a) { return hasDeckFeat(this, ...a); }
  #hasManipulation(...a) { return hasManipulation(this, ...a); }
  #manaPlayCheck(...a) { return manaPlayCheck(this, ...a); }
  tableInstances(...a) { return tableInstances(this, ...a); }
  tableCard(...a) { return tableCard(this, ...a); }
  #castCheck(...a) { return castCheck(this, ...a); }
  #shuffle(...a) { return shuffle(this, ...a); }
  #tableLog(...a) { return tableLog(this, ...a); }
  #tableName(...a) { return tableName(this, ...a); }
  #tableDraw(...a) { return drawCards(this, ...a); }
  tableStart(...a) { return tableStart(this, ...a); }
  tableRedraw(...a) { return tableRedraw(this, ...a); }
  tableNextRound(...a) { return tableNextRound(this, ...a); }
  tableDraw(...a) { return tableDraw(this, ...a); }
  tablePlay(...a) { return tablePlay(this, ...a); }
  tableRetrace(...a) { return tableRetrace(this, ...a); }
  tableBury(...a) { return tableBury(this, ...a); }
  #rollFor(...a) { return rollFor(this, ...a); }
  #tableKeywords(...a) { return tableKeywords(this, ...a); }
  #tableTrigger(...a) { return tableTrigger(this, ...a); }
  #tableSettle(...a) { return tableSettle(this, ...a); }
  tableResolve(...a) { return tableResolve(this, ...a); }
  spellPointTracker(...a) { return spellPointTracker(this, ...a); }
  #spendSP(...a) { return spendSP(this, ...a); }
  tableSpend(...a) { return tableSpend(this, ...a); }
  tableReveal(...a) { return tableReveal(this, ...a); }
  cardRolls(...a) { return cardRolls(this, ...a); }
  tableRoll(...a) { return tableRoll(this, ...a); }
  tableBoost(...a) { return tableBoost(this, ...a); }
  tableMove(...a) { return tableMove(this, ...a); }
  tableExileRandom(...a) { return tableExileRandom(this, ...a); }
  tableTap(...a) { return tableTap(this, ...a); }
  tableShuffleDiscard(...a) { return tableShuffleDiscard(this, ...a); }
  tablePeek(...a) { return tablePeek(this, ...a); }
  tableEnd(...a) { return tableEnd(this, ...a); }

  // subsystems/maneuvers.js
  #recomputeManeuvers(...a) { return recomputeManeuvers(this, ...a); }
  toggleManeuver(...a) { return toggleManeuver(this, ...a); }
  setManeuverNote(...a) { return setManeuverNote(this, ...a); }
  setManeuverField(...a) { return setManeuverField(this, ...a); }

  // subsystems/psionics.js
  #recomputePsionics(...a) { return recomputePsionics(this, ...a); }
  psionicsNewDay(...a) { return psionicsNewDay(this, ...a); }

  // subsystems/vancian.js
  #recomputeVancian(...a) { return recomputeVancian(this, ...a); }
  vancianNewDay(...a) { return vancianNewDay(this, ...a); }

  // subsystems/cooking.js
  cookingView(...a) { return cookingView(this, ...a); }

  // subsystems/crafting.js
  craftSkills(...a) { return craftSkills(this, ...a); }
  #recomputeCrafting(...a) { return recomputeCrafting(this, ...a); }

  // subsystems/techniques.js
  techniqueContext(...a) { return techniqueContext(this, ...a); }
  techniqueByName(...a) { return techniqueByName(this, ...a); }
  techniqueView(...a) { return techniqueView(this, ...a); }
  selectTechnique(...a) { return selectTechnique(this, ...a); }
  addDraftTechnique(...a) { return addDraftTechnique(this, ...a); }
  resetDraftTechnique(...a) { return resetDraftTechnique(this, ...a); }
  draftFromTechnique(...a) { return draftFromTechnique(this, ...a); }
  mergeTechniquesFrom(...a) { return mergeTechniquesFrom(this, ...a); }
  removeTechnique(...a) { return removeTechnique(this, ...a); }
  #techniqueTalents(...a) { return techniqueTalents(this, ...a); }

  // subsystems/primordia.js
  #primordiaPrereq(...a) { return primordiaPrereq(this, ...a); }
  #recomputePrimordia(...a) { return recomputePrimordia(this, ...a); }
  #primordiaTalents(...a) { return primordiaTalents(this, ...a); }

  // subsystems/companions.js
  #companionMaster(...a) { return companionMaster(this, ...a); }
  #recomputeCompanions(...a) { return recomputeCompanions(this, ...a); }
  companionDamage(...a) { return companionDamage(this, ...a); }
  companionHeal(...a) { return companionHeal(this, ...a); }
  companionRest(...a) { return companionRest(this, ...a); }
}
