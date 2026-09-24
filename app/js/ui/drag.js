/**
 * Reordering by drag: the one way the sheet does it.
 *
 * Every list that can be dragged -- tabs, languages, feats, granted feats,
 * bonus talents, a class's notes, template cards, the session board -- goes
 * through `bindDrag`. They used to carry a copy each of the same few dozen
 * lines, and a fix to one copy reached none of the others. What differs
 * between them is only where a drop may land and what it does, so that is
 * all a caller writes; the gesture, the marker, scrolling and clean-up live
 * here once.
 *
 * It follows the pointer rather than using the browser's drag and drop. That
 * API never starts on a touch screen, and in some embedded browsers not from
 * a button either -- which is why the session board, the one list that had
 * to work there, was already built this way. Pointer events are the same for
 * mouse, pen and finger, so one mechanism covers all three.
 *
 * The shape of a binding:
 *
 *   bindDrag({
 *     handles,               // the elements a drag starts from (grips)
 *     item: (handle) => el,  // what is being dragged; dimmed while it is
 *     source: (item, handle) => from,       // what the drop will be told
 *     target: (el, point, from) => t|null,  // what is under the pointer
 *     drop: (from, t) => {},                // do it, and re-render
 *   })
 *
 * `target` gets the element under the pointer and answers null (nowhere to
 * land) or `{ el, cls }` plus whatever `drop` needs: `el` gets `cls` as the
 * marker -- 'drop-before', 'drop-after', 'drop-into', or null for none.
 */

/** Pixels a press has to travel before it is a drag rather than a click. */
const THRESHOLD = 6;
/** How near an edge of the scroll box the pointer has to be to scroll it. */
const EDGE = 40;

/**
 * Which half of `el` a point is in: true for the lower (or, across, the
 * right) half, i.e. a drop that lands after it.
 */
export function half(el, point, axis = 'y') {
  const box = el.getBoundingClientRect();
  return axis === 'x' ? point.x > box.left + box.width / 2 : point.y > box.top + box.height / 2;
}

/** The before/after marker class for a half. */
export const side = (after) => (after ? 'drop-after' : 'drop-before');

/**
 * The nearest ancestor that scrolls along an axis, crossing out of a shadow
 * root into its host; the page itself when nothing nearer does.
 */
function scrollerOf(el, axis) {
  for (let n = el; n; n = n.parentElement || n.getRootNode?.().host) {
    if (!(n instanceof Element)) break;
    const style = getComputedStyle(n);
    const over = axis === 'x' ? style.overflowX : style.overflowY;
    const room = axis === 'x' ? n.scrollWidth > n.clientWidth : n.scrollHeight > n.clientHeight;
    if (room && /auto|scroll/.test(over)) return n;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * A published sheet is read, not edited, and an order is an edit. The sheet
 * element says whether it is published; asking it here means no binding can
 * forget to.
 */
const locked = (el) => !!el.getRootNode?.().host?.isPublished;

export function bindDrag({ handles, item = (h) => h, source, target, drop, onStart, onEnd }) {
  for (const handle of handles) {
    handle.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || locked(handle)) return;
      const el = item(handle);
      if (!el) return;
      begin(handle, el, down);
    });
  }

  function begin(handle, el, down) {
    const root = handle.getRootNode();
    const from = source(el, handle);
    let dragging = false;
    let marked = null;                     // { el, cls } currently drawn
    let last = { x: down.clientX, y: down.clientY };
    let frame = 0;
    const scrollers = { x: scrollerOf(el, 'x'), y: scrollerOf(el, 'y') };

    try { handle.setPointerCapture(down.pointerId); } catch { /* already gone */ }

    const unmark = () => {
      if (marked?.el && marked.cls) marked.el.classList.remove(marked.cls);
      marked = null;
    };
    const resolve = () => {
      const under = root.elementFromPoint?.(last.x, last.y);
      return under ? target(under, last, from) : null;
    };
    const mark = () => {
      const t = resolve();
      if (t?.el === marked?.el && t?.cls === marked?.cls) return;
      unmark();
      if (t?.el && t.cls) t.el.classList.add(t.cls);
      marked = t;
    };

    // Held near an edge of what scrolls, the list scrolls under the pointer,
    // as the browser's own drag did -- a long feats tab is taller than a screen.
    const scroll = () => {
      frame = 0;
      if (!dragging) return;
      let moved = false;
      for (const axis of ['y', 'x']) {
        const box = scrollers[axis];
        const r = box === document.scrollingElement || box === document.documentElement
          ? { top: 0, left: 0, bottom: innerHeight, right: innerWidth } : box.getBoundingClientRect();
        const [p, lo, hi] = axis === 'y' ? [last.y, r.top, r.bottom] : [last.x, r.left, r.right];
        const step = p < lo + EDGE ? -(lo + EDGE - p) / 3 : p > hi - EDGE ? (p - (hi - EDGE)) / 3 : 0;
        if (!step) continue;
        const before = axis === 'y' ? box.scrollTop : box.scrollLeft;
        if (axis === 'y') box.scrollTop += step; else box.scrollLeft += step;
        moved ||= (axis === 'y' ? box.scrollTop : box.scrollLeft) !== before;
      }
      if (moved) { mark(); frame = requestAnimationFrame(scroll); }
    };

    const move = (e) => {
      if (e.pointerId !== down.pointerId) return;
      last = { x: e.clientX, y: e.clientY };
      if (!dragging) {
        if (Math.hypot(last.x - down.clientX, last.y - down.clientY) < THRESHOLD) return;
        dragging = true;
        el.classList.add('dragging');
        onStart?.(from);
      }
      e.preventDefault();
      mark();
      if (!frame) frame = requestAnimationFrame(scroll);
    };

    const finish = (commit) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      removeEventListener('keydown', key, true);
      if (frame) cancelAnimationFrame(frame);
      const t = commit && dragging ? resolve() : null;
      unmark();
      el.classList.remove('dragging');
      if (dragging) {
        onEnd?.();
        // The release is also a click on whatever the handle is -- a tab
        // button, most visibly -- and a drag is not that click.
        const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
        addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', swallow, true), 0);
      }
      if (t) drop(from, t);
    };
    const up = (e) => { if (e.pointerId === down.pointerId) finish(true); };
    const cancel = () => finish(false);
    const key = (e) => { if (e.key === 'Escape' && dragging) { e.preventDefault(); finish(false); } };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel);
    addEventListener('keydown', key, true);
  }
}
