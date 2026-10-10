/**
 * ui/cast-pick.js -- reading the card table's mode chooser.
 *
 * A card with several Dice entries opens a chooser on Cast… (castPicker in
 * panels/subsystems.js): a mode, and the spell points to put into it. The
 * two answers ride on the Cast button's argument as a query --
 * `cast?mode=boost (1 SP)&sp=1` -- so the one table-action switch gets a
 * plain string whether the press came from the tab or from a pop-out
 * window. Both read the form the same way, from here.
 */

/** The button's argument with the chooser's answers on it, or as it was when the button is not in a chooser. */
export function castPickArg(button, arg) {
  const form = button.closest?.('.castpick');
  if (!form) return arg;
  const mode = form.querySelector('select[name="mode"]');
  const sp = form.querySelector('input[name="sp"]');
  const q = new URLSearchParams();
  if (mode?.value) q.set('mode', mode.value);
  q.set('sp', String(Math.max(0, Math.floor(Number(sp?.value) || 0))));
  return `${arg || 'cast'}?${q}`;
}

/** The Roll20 text for the mode picked in a chooser, which each option carries. */
export function castPickCopy(button) {
  const form = button.closest?.('.castpick');
  const picked = form?.querySelector('select[name="mode"]')?.selectedOptions?.[0];
  return picked?.dataset.copytext || '';
}

/** A mode picked sets the points field to that mode's price. */
export function followCastPick(select) {
  const sp = select.closest('.castpick')?.querySelector('input[name="sp"]');
  const price = select.selectedOptions?.[0]?.dataset.sp;
  if (sp && price !== undefined) sp.value = price;
}
