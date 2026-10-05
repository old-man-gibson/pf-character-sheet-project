/**
 * Adding a training class to a side: the blank block each side starts from.
 * Its own module because the guile side's blank lives with guile, which
 * reads the sphere model, and the sphere model must not read guile back.
 */
import { addGuileClass, blankGuileClass } from './subsystems/guile.js';

/**
 * A training class with nothing typed into it, for any side: a martial or
 * magic class's single ladder of twenty levels, or a guile class's two.
 */
export function blankTrainingClass(side, name = '') {
  if (side === 'guile') return blankGuileClass(name);
  return {
    name,
    type: null,
    talentsPerLevel: null,
    mod1: null,
    mod2: null,
    levels: Array.from({ length: 20 }, (_, i) => ({
      level: i + 1, talent: null, sphere: null, notes: null,
    })),
  };
}

/** Add a blank class to a side's training, through the list edit Undo knows. */
export function addTrainingClass(model, side, name = '') {
  if (side === 'guile') return addGuileClass(model, name);
  const key = side === 'magic' ? 'magic' : 'combat';
  return model.listAdd(`training.${key}.classes`, blankTrainingClass(key, name));
}
