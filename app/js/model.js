/**
 * model.js -- the live character model.
 *
 * The model was one file of eleven thousand lines; it is now a directory of
 * domain modules and this barrel, so that every importer keeps the one import
 * path it always had. Nothing is defined here.
 *
 *   model/character.js   the Character class: state, recompute, subscriptions
 *   model/reconcile.js   offsets against the source workbook, and the audit
 *   model/document.js    reading and normalising an imported document
 *   model/scope.js       the flat scope formulas read, and forwarded bonuses
 *   model/stats/         saves, defences, attacks, wealth
 *   model/subsystems/    akashic, cardcasting, cooking, crafting, maneuvers,
 *                        primordia, psionics, techniques, vancian, companions
 *
 * Why a barrel rather than deep imports: the model is one thing to its
 * callers. Which file a helper happens to live in is this directory's business
 * and is expected to keep moving; `from './model.js'` is the contract.
 */

export * from './model/character.js';
export * from './model/util.js';
export * from './model/events.js';
export * from './model/reconcile.js';
export * from './model/document.js';
export * from './model/edit.js';
export * from './model/abilities.js';
export * from './model/progression.js';
export * from './model/scope.js';
export * from './model/trackers.js';
export * from './model/templates.js';
export * from './model/traits.js';
export * from './model/spheres.js';
export * from './model/stats/saves.js';
export * from './model/stats/defenses.js';
export * from './model/stats/attacks.js';
export * from './model/stats/wealth.js';
export * from './model/subsystems/akashic.js';
export * from './model/subsystems/cardcasting.js';
export * from './model/subsystems/companions.js';
export * from './model/subsystems/cooking.js';
export * from './model/subsystems/crafting.js';
export * from './model/subsystems/maneuvers.js';
export * from './model/subsystems/primordia.js';
export * from './model/subsystems/psionics.js';
export * from './model/subsystems/techniques.js';
export * from './model/subsystems/vancian.js';
