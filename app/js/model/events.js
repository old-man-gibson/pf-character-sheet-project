/**
 * Subscriptions: who to tell when the model changes.
 *
 * The model is edited from many places and rendered from one, so every change
 * ends in an emit and the element re-renders. Kept apart from the class
 * because every domain module has to be able to announce what it did.
 */

export function subscribe(model, fn) {
  model.listeners.add(fn);
  return () => model.listeners.delete(fn);
}

export function emit(model, detail) {
  for (const fn of model.listeners) fn(model, detail);
}
