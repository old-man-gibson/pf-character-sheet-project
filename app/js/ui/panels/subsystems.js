/**
 * ui/panels/subsystems.js -- the tabs a character only has if they play that way.
 *
 * Akashic veilweaving, Path of War maneuvers, vancian casting, Alternate
 * Training, psionics, cardcasting and the companions. Each appears only when
 * the character uses it or a class is marked with it, and each has a module
 * of its own, named to match model/subsystems/; what they share is in
 * system-tabs.js. This file gathers them into the one namespace the element
 * and the tests import.
 *
 * `export *` drops a name two of these modules both export, without a word,
 * so each name is exported from one module only.
 */
export * from './system-tabs.js';
export * from './akashic.js';
export * from './maneuvers.js';
export * from './vancian.js';
export * from './alt-training.js';
export * from './psionics.js';
export * from './companions.js';
export * from './cardcasting.js';
