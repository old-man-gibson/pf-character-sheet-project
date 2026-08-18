/**
 * tracker-style.js -- how a tracker looks: colours, shape, fill direction,
 * gradients and highlighted zones.
 *
 * Everything here is pure data in, strings/numbers out, so it is testable in
 * node and the sheet element only has to paint what it is handed. Colours are
 * validated to plain #rrggbb before they can reach a style attribute: a player
 * types hex, never CSS.
 *
 *   style: {
 *     shape:              'pips' | 'bar' | 'squares'     (default pips)
 *     fill:               'spent' | 'remaining'          (default spent -- lights up as used;
 *                                                          remaining drains from full)
 *     color:              '#rrggbb' | null               (null = theme accent)
 *     gradientTo:         '#rrggbb' | null               (fade from color to this across the range)
 *     negativeColor:      '#rrggbb' | null               (two-sided meters, below zero; null = theme red)
 *     negativeGradientTo: '#rrggbb' | null
 *     zones: [{ from: 'formula', to: 'formula', color: '#rrggbb', label: '' }]
 *   }
 *
 * Zone bounds are formulas (a danger zone can start at `burn.max - 2`); the
 * model resolves them and hands the numbers back in as `resolvedZones`.
 */

/** Sixteen suggestions that read on both themes; any #rrggbb is accepted too. */
export const TRACKER_PALETTE = [
  ['#d4a24a', 'gold'], ['#f07f3c', 'orange'], ['#e0635f', 'red'], ['#b8384e', 'crimson'],
  ['#f08aa4', 'pink'], ['#d66fb5', 'magenta'], ['#a06fd6', 'violet'], ['#7b7fe6', 'indigo'],
  ['#6ea8fe', 'blue'], ['#4cc3e0', 'cyan'], ['#3fb8a5', 'teal'], ['#6bbf7b', 'green'],
  ['#a8c85a', 'lime'], ['#f2c14e', 'yellow'], ['#b8845a', 'bronze'], ['#8f98ad', 'slate'],
];

/**
 * Default colours handed to progression feature-rule groups, in order.
 *
 * Green leads so a column with a single rule keeps looking exactly like the
 * sphere-talent grid it borrowed its green from; the rest are picked to stay
 * apart from each other at the small tint these cells use.
 */
export const FEATURE_GROUP_COLORS = [
  '#6bbf7b', '#6ea8fe', '#d4a24a', '#a06fd6', '#4cc3e0', '#f07f3c',
  '#f08aa4', '#3fb8a5', '#a8c85a', '#d66fb5', '#b8845a', '#7b7fe6',
];

/** Theme fallbacks, as CSS and as hex (hex is needed to interpolate a gradient). */
export const THEME_ACCENT = { css: 'var(--cs-accent)', hex: '#d4a24a' };
export const THEME_NEGATIVE = { css: 'var(--cs-bad)', hex: '#e0635f' };

export const SHAPES = ['pips', 'bar', 'squares'];
export const FILLS = ['spent', 'remaining'];

/* ------------------------------------------------------------------ *
 * Built-in meters.
 *
 * Hit points and essence are not trackers -- their numbers come from the
 * sheet rather than from a pool the player tops up -- but they are the
 * same picture, so they take the same style: shape, colours, gradients
 * and zones. What they add is *layers*: a stretch of the track that is
 * borrowed rather than granted (temporary hit points, essence condensed
 * from spell points) and a stretch that is marked rather than filled
 * (nonlethal damage). Both are value ranges, so they survive a change of
 * shape -- a temporary pip is still a temporary pip.
 * ------------------------------------------------------------------ */

/** The meters that carry a style of their own, and what to call them. */
export const METERS = [
  ['hp', 'Hit points'],
  ['essence', 'Essence'],
  ['pp', 'Power points'],
];

/**
 * A meter starts as a bar rather than as pips.
 *
 * A tracker is a handful of uses and reads best as pips; a meter is a
 * hundred and eighty hit points, where a bar is the only shape that says
 * anything. Both remain available to the player.
 */
export const METER_DEFAULT_STYLE = { shape: 'bar', fill: 'spent' };

/**
 * Where a meter starts from, when it is not the shared default.
 *
 * Hit points and essence fill as they are used up -- the fill is what the
 * character has invested or has left standing. A power point pool is the
 * other way round: the sheet says "23 of 40 left", so its bar drains.
 */
export const METER_DEFAULTS = { pp: { shape: 'bar', fill: 'remaining' } };

export function meterDefaultStyle(key) {
  return METER_DEFAULTS[key] || METER_DEFAULT_STYLE;
}

/** True when a meter's style is the one it starts with -- nothing worth saving. */
export function isDefaultMeterStyle(style, key) {
  const d = meterDefaultStyle(key);
  const s = normalizeStyle({ ...d, ...(style || {}) });
  return s.shape === d.shape && s.fill === d.fill
    && !s.color && !s.gradientTo && !s.negativeColor && !s.negativeGradientTo
    && s.zones.length === 0;
}

/** Where a value sits on a [min, max] track, as a fraction 0..1. */
export function trackPos(value, min, max) {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  const span = hi - lo;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, ((Number(value) || 0) - lo) / span));
}

/**
 * A layer's extent on the track, as fractions, or null when it covers
 * nothing. Written backwards ("10 to 4") is read forwards.
 */
export function trackBand(from, to, min, max) {
  const a = trackPos(Math.min(from, to), min, max);
  const b = trackPos(Math.max(from, to), min, max);
  return b - a > 0 ? { from: a, to: b } : null;
}

/**
 * How far past zero a dying character has gone, as 0 at zero hit points
 * and 1 at the threshold where they die -- which is what the warning glow
 * is scaled by, so it arrives gradually rather than all at once.
 *
 * Both numbers are negative below zero, so the ratio is positive. Above
 * zero, and with a threshold that is not below zero, there is no warning.
 */
export function dyingFraction(current, deathAt) {
  const cur = Number(current) || 0;
  const at = Number(deathAt) || 0;
  if (cur >= 0 || at >= 0) return 0;
  return Math.max(0, Math.min(1, cur / at));
}

/**
 * Above this many, a squares tracker stops drawing pips and prints the count.
 *
 * Four is what the eye can take in without counting, and it is also the most
 * that packs into a tidy square. A prepared caster who commits six uses to one
 * spell reads "6", then "5", and is back to pips the moment it drops to four --
 * so the shape only ever draws a number when a number is easier to read.
 */
export const SQUARE_PIP_LIMIT = 4;

/** '#abc' or '#aabbcc' (any case) -> '#aabbcc'; anything else -> null. */
export function normalizeHex(value) {
  const s = String(value ?? '').trim();
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  return m6 ? `#${m6[1].toLowerCase()}` : null;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Translucent version of a hex colour, for the faint tint of an unlit zone. */
export function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : null;
}

/** Linear blend of two hex colours; t = 0 gives `a`, t = 1 gives `b`. */
export function mixHex(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return normalizeHex(a) || normalizeHex(b);
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  const ch = (i) => Math.round(x[i] + (y[i] - x[i]) * k).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/**
 * Coerce whatever was saved (or typed) into a well-formed style. Never throws;
 * bad colours become null, unknown shapes/fills fall back to the defaults.
 */
export function normalizeStyle(style) {
  const s = style && typeof style === 'object' ? style : {};
  const zones = Array.isArray(s.zones) ? s.zones : [];
  return {
    shape: SHAPES.includes(s.shape) ? s.shape : 'pips',
    fill: FILLS.includes(s.fill) ? s.fill : 'spent',
    color: normalizeHex(s.color),
    gradientTo: normalizeHex(s.gradientTo),
    negativeColor: normalizeHex(s.negativeColor),
    negativeGradientTo: normalizeHex(s.negativeGradientTo),
    zones: zones
      .filter((z) => z && typeof z === 'object')
      .map((z) => ({
        from: String(z.from ?? '').trim(),
        to: String(z.to ?? '').trim(),
        color: normalizeHex(z.color) || TRACKER_PALETTE[2][0],
        label: String(z.label ?? '').trim(),
      })),
  };
}

/** True when the style is all defaults -- nothing worth saving. */
export function isDefaultStyle(style) {
  const s = normalizeStyle(style);
  return s.shape === 'pips' && s.fill === 'spent' && !s.color && !s.gradientTo
    && !s.negativeColor && !s.negativeGradientTo && s.zones.length === 0;
}

/**
 * Evaluate zone bounds. `evaluate(src)` returns a number or throws (the model
 * passes the sandboxed formula evaluator with the character scope). A zone
 * with a bad bound is kept, flagged, and never matches anything.
 */
export function resolveZones(zones, evaluate) {
  return (zones || []).map((z) => {
    const out = { ...z, fromValue: null, toValue: null, error: null };
    const errors = [];
    for (const side of ['from', 'to']) {
      const src = z[side];
      if (!src) { errors.push(`${side}: empty`); continue; }
      try {
        const v = evaluate(src);
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) errors.push(`${side}: not a number`);
        else out[`${side}Value`] = n;
      } catch (err) {
        errors.push(`${side}: ${err.message}`);
      }
    }
    if (!errors.length && out.fromValue > out.toValue) {
      // Written backwards ("7 to 4") -- be forgiving.
      [out.fromValue, out.toValue] = [out.toValue, out.fromValue];
    }
    out.error = errors.length ? errors.join('; ') : null;
    return out;
  });
}

/** The zone a value sits in, if any (later zones win, so a narrow highlight can sit on a broad band). */
export function zoneAt(value, resolvedZones) {
  let hit = null;
  for (const z of resolvedZones || []) {
    if (z.error || z.fromValue === null || z.toValue === null) continue;
    if (value >= z.fromValue && value <= z.toValue) hit = z;
  }
  return hit;
}

/**
 * Colour of one integer step `k` of the range: zone > gradient > base.
 * Returns a CSS colour string (hex, or the theme variable when nothing is set).
 */
export function stepColor(k, { min, max, style, resolvedZones }) {
  const s = normalizeStyle(style);
  const zone = zoneAt(k, resolvedZones);
  if (zone) return zone.color;
  if (k < 0) {
    const base = s.negativeColor;
    if (s.negativeGradientTo) {
      const span = Math.max(1, Math.abs(min) - 1);
      return mixHex(base || THEME_NEGATIVE.hex, s.negativeGradientTo, (Math.abs(k) - 1) / span);
    }
    return base || THEME_NEGATIVE.css;
  }
  const base = s.color;
  if (s.gradientTo) {
    const lo = Math.max(1, min);
    const span = Math.max(1, max - lo);
    return mixHex(base || THEME_ACCENT.hex, s.gradientTo, (k - lo) / span);
  }
  return base || THEME_ACCENT.css;
}

/**
 * What a click at `fraction` along a bar is asking for.
 *
 * A bar always reads left to right as the value rising from min to max, and a
 * **draining bar is no exception**: its fill is what is *left*, so clicking near
 * the right edge asks to be left nearly full, not nearly empty. That inversion is
 * the whole reason this lives here rather than at each call site -- it is easy to
 * write backwards, and then the bar moves the wrong way under the cursor.
 *
 * Returns { reading, current }: `reading` is the number the bar shows at that
 * point, and `current` is what to store -- the same thing for an ordinary pool,
 * and its complement for a draining one, where `current` counts what is spent.
 */
export function barClickValue(fraction, { min = 0, max = 0, style = null } = {}) {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  const reading = Math.round(lo + f * (hi - lo));
  // Two-sided meters show a signed position, never a remaining amount, so they
  // are read straight off the track however they are styled.
  const draining = lo >= 0 && normalizeStyle(style).fill === 'remaining';
  const current = draining ? hi - (reading - lo) : reading;
  return { reading, current: Math.max(lo, Math.min(hi, current)) };
}

/**
 * Geometry for the squares shape: a small square of pips, or a count.
 *
 * Made for a pool small enough to hold in the hand -- a prepared caster commits
 * an exact number of uses to each spell, usually one or two -- where a row of
 * pips is more legible than a bar and a number is more legible than either once
 * there are more than a few.
 *
 * `lit` follows the same sense the other shapes give `fill`: with 'remaining' it
 * is uses left, with the default 'spent' it is uses gone. `slots` is how many
 * outlines to draw, capped so a large pool still shows the shape rather than a
 * sprawl -- the count carries the rest.
 *
 * Returns { total, lit, slots, mode: 'pips' | 'number' }
 */
export function squareLayout({ min, max, current, style }) {
  const s = normalizeStyle(style);
  const hi = Math.max(0, Number(max) || 0);
  const lo = Number(min) || 0;
  const cur = Math.max(lo, Math.min(hi, Number(current) || 0));
  const lit = Math.max(0, Math.min(hi, s.fill === 'remaining' ? hi - cur : cur));
  return {
    total: hi,
    lit,
    slots: Math.min(hi, SQUARE_PIP_LIMIT),
    mode: lit > SQUARE_PIP_LIMIT ? 'number' : 'pips',
  };
}

/**
 * Geometry for the bar shape, as fractions of the track width.
 *
 * Positions run linearly from min (0) to max (1). Integer step k occupies
 * (k-1, k] above zero and [k, k+1) below it, so a zone "4 to 6" is the band a
 * pip-view would light for 4, 5 and 6.
 *
 * Returns { zero, fill: {from,to} | null, segments: [{from,to,color}], bands: [{from,to,color,label}] }
 *   fill      the lit extent (whole fill, for the base/gradient paint)
 *   segments  zone-coloured overlays inside the fill
 *   bands     faint zone tints across their whole extent
 */
export function barLayout({ min, max, current, style, resolvedZones }) {
  const s = normalizeStyle(style);
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  const span = hi - lo;
  if (span <= 0) return { zero: null, fill: null, segments: [], bands: [] };
  const pos = (v) => Math.max(0, Math.min(1, (v - lo) / span));
  const cur = Math.max(lo, Math.min(hi, Number(current) || 0));
  const twoSided = lo < 0;

  let fill;
  if (twoSided) {
    fill = cur >= 0 ? { from: pos(0), to: pos(cur), negative: false } : { from: pos(cur), to: pos(0), negative: true };
  } else if (s.fill === 'remaining') {
    fill = { from: 0, to: pos(lo + (hi - cur)), negative: false };
  } else {
    fill = { from: 0, to: pos(cur), negative: false };
  }
  if (fill.to - fill.from <= 0) fill = null;

  const extent = (z) => {
    const a = z.fromValue;
    const b = z.toValue;
    // Convert inclusive integer bounds to the continuous band they cover.
    const from = a > 0 ? a - 1 : a;
    const to = b < 0 ? b + 1 : b;
    return { from: pos(from), to: pos(to) };
  };
  const bands = [];
  const segments = [];
  for (const z of resolvedZones || []) {
    if (z.error || z.fromValue === null || z.toValue === null) continue;
    const e = extent(z);
    if (e.to - e.from <= 0) continue;
    bands.push({ ...e, color: z.color, label: z.label || '' });
    if (fill) {
      const from = Math.max(e.from, fill.from);
      const to = Math.min(e.to, fill.to);
      if (to - from > 0) segments.push({ from, to, color: z.color });
    }
  }
  return { zero: twoSided ? pos(0) : null, fill, segments, bands };
}
