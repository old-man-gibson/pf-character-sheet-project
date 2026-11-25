/**
 * ui/picks.js -- select mode's tick boxes: ticking things to act on them
 * together. The Extensions dialog's pack list (remove packs) and the
 * Homebrew Workbench's entry list (delete entries) both use it.
 *
 * What is ticked is a Set of ids the caller keeps. A box stands for one id or
 * for several -- a publisher's fold, a container and everything under it, All
 * shown -- and reads ticked when every one of them is, a dash when some are,
 * and is disabled when it stands for none. A tick changes no markup: the
 * caller redraws only the boxes and the counts, so a list never jumps under
 * the pointer.
 *
 * The counts: `[data-pick-count]` reads "N selected", and every
 * `[data-pick-n]` inside a button reads "N packs" (or whatever the caller's
 * noun is), its button disabled at none.
 */

/** Set a box from how many of `ids` are in `picked`. */
export function markPicks(box, ids, picked) {
  const n = ids.filter((id) => picked.has(id)).length;
  box.checked = ids.length > 0 && n === ids.length;
  box.indeterminate = n > 0 && n < ids.length;
  box.disabled = !ids.length;
}

/** Tick every one of `ids`, or untick them. */
export function setPicks(picked, ids, on) {
  for (const id of ids) { if (on) picked.add(id); else picked.delete(id); }
}

/** "1 pack", "1,410 packs". */
export const pickCount = (n, [one, many]) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Fill the counts inside `root` for `n` ticked: "N selected", and "N <noun>" on each button. */
export function showPickCount(root, n, noun) {
  const count = root.querySelector('[data-pick-count]');
  if (count) count.textContent = `${n.toLocaleString('en-US')} selected`;
  for (const span of root.querySelectorAll('[data-pick-n]')) {
    span.textContent = pickCount(n, noun);
    const button = span.closest('button');
    if (button) button.disabled = !n;
  }
}
