/**
 * ui/class-select.js -- the sheet's one class picker.
 *
 * Every cell that names one of the character's classes is this select, the
 * one the sphere training blocks started with: the character's classes, a
 * blank, and a name the cell already holds that is not one of them kept and
 * marked with *, so a pick is never dropped from its own select.
 */
import { select } from './fields.js';
import { itemSelect } from './rows.js';

/**
 * The classes a cell can pick: every class the character has -- the Classes
 * table and the Planner, as the model lists them -- and any name a training
 * block already holds.
 */
export function classNames(model) {
  const names = new Set(model.classNames());
  for (const side of Object.values(model.data.training || {})) {
    for (const cls of side?.classes || []) if (String(cls.name || '').trim()) names.add(String(cls.name).trim());
  }
  return [...names];
}

/**
 * The class picker for one row's cell. `more` adds headed groups after the
 * classes (`{ group, options }`), for a cell that can also name a template or
 * a feat; `blank` is the empty choice's label; `attrs` go on the select.
 */
export function classSelect(model, list, i, field, value, { more = [], blank = '—', attrs = '' } = {}) {
  return itemSelect(list, i, field, value, [...classNames(model), ...more], blank, null, { attrs });
}

/** The same picker for a cell bound by its path rather than by row (`data-set`). */
export function classSelectAt(model, path, value, { blank = '—', attrs = '' } = {}) {
  return select(path, value, classNames(model), blank, { attrs });
}
