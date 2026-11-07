/**
 * swaps.js -- the key an archetype's swap is matched by.
 *
 * A class archetype's text says what it replaces ("This replaces alertness.")
 * and the class or companion table names the same feature its own way
 * ("Alertness"). Both are read into one key here, so the two meet.
 *
 * Kept apart from extensions.js, which reads the packs, because the companion
 * sums read these keys too and companions.js sits under the model: importing
 * extensions.js from there would be a loop.
 */

const str = (v) => (v === null || v === undefined ? '' : String(v));
const lower = (s) => str(s).trim().toLowerCase();

/**
 * A swap key may name one grant of a feature rather than the feature: an
 * archetype replacing "the 10th and 14th level warrior's grace" takes those
 * two and leaves the others. The level rides on the key as "@10", which keeps
 * a swap list the flat list of strings it has always been, and lets two
 * archetypes taking different grants of the same feature stack.
 */
export const swapAt = (key, level) => (key && level ? `${key}@${level}` : key);
export const swapBase = (k) => str(k).split('@')[0];
export const swapLevel = (k) => {
  const n = Number(str(k).split('@')[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
};
/** Do two swap keys land on each other? A whole feature covers each of its grants. */
export const swapsMeet = (a, b) => {
  if (a === b) return true;
  if (swapBase(a) !== swapBase(b)) return false;
  return swapLevel(a) === null || swapLevel(b) === null;
};
/** "warriors grace@10" as a person reads it. */
export const swapLabel = (k) => (swapLevel(k) ? `${swapBase(k)} (${swapLevel(k)}th)` : swapBase(k));

/**
 * The key a class feature is matched by, across the ways a page names it:
 * "Trap sense +1" / "Trap Sense (Ex)" / "kiai art" / "Kiai Arts" are one key;
 * "the legendary samurai's weapon proficiencies", "armor proficiencies" and
 * "proficiencies" are all the one proficiency feature; "iaijutsu master" and
 * "iaijutsu mastery" meet on their stem.
 */
export function swapKey(s, className = '') {
  let k = lower(s).replace(/\((?:ex|su|sp)(?: or (?:ex|su|sp))?\)/g, '').replace(/sheathe/g, 'sheath').trim();
  if (/proficienc/.test(k)) return 'weapon and armor proficiency';
  const cls = lower(className);
  if (cls) k = k.replace(new RegExp(`^(?:the\\s+|a\\s+|an\\s+)?${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['’]s\\s+(?:normal\\s+)?`), '');
  k = k
    .replace(/^(?:the|a|an)\s+/, '')
    .replace(/^normal\s+/, '')
    .replace(/\s+class features?$/, '')
    .replace(/\s+abilit(?:y|ies)$/, '')
    .replace(/\s*[+\-–]\s*\d+(?:\/[+\-–—]|\/-)?\s*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  k = k.replace(/(\w{3,})s$/, '$1');                          // plural-insensitive on the last word
  k = k.replace(/(\w{5,})y$/, '$1');                          // "iaijutsu mastery" / "iaijutsu master"
  return k;
}
