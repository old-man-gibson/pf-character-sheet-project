/** Tests for tracker appearance: colours, zones, gradients and bar geometry.
 *  Run: node tests/tracker-style.test.mjs */
import {
  TRACKER_PALETTE, THEME_ACCENT, THEME_NEGATIVE,
  normalizeHex, hexToRgb, rgba, mixHex, normalizeStyle, isDefaultStyle,
  resolveZones, zoneAt, stepColor, barLayout, squareLayout, barClickValue,
  SQUARE_PIP_LIMIT, SHAPES,
  METERS, METER_DEFAULT_STYLE, meterDefaultStyle, isDefaultMeterStyle,
  trackPos, trackBand, dyingFraction,
} from '../app/js/tracker-style.js';

let pass = 0;
let fail = 0;
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const near = (label, actual, expected, eps = 1e-6) => {
  if (Math.abs(actual - expected) <= eps) pass++;
  else { fail++; console.log(`  FAIL ${label}: expected ~${expected}, got ${actual}`); }
};

console.log('palette');
check('sixteen suggestions', TRACKER_PALETTE.length, 16);
check('all valid hex', TRACKER_PALETTE.every(([hex]) => normalizeHex(hex) === hex), true);
check('all distinct', new Set(TRACKER_PALETTE.map(([h]) => h)).size, 16);

console.log('hex handling -- only #rrggbb ever reaches a style attribute');
check('six digits', normalizeHex('#D4A24A'), '#d4a24a');
check('bare six digits', normalizeHex('d4a24a'), '#d4a24a');
check('three digits expand', normalizeHex('#abc'), '#aabbcc');
check('spaces trimmed', normalizeHex('  #ff0000 '), '#ff0000');
check('named colours rejected', normalizeHex('red'), null);
check('css functions rejected', normalizeHex('url(x)'), null);
check('injection rejected', normalizeHex('#fff;background:url(x)'), null);
check('empty is null', normalizeHex(''), null);
check('undefined is null', normalizeHex(undefined), null);
check('rgb split', hexToRgb('#ff8000'), [255, 128, 0]);
check('rgba tint', rgba('#ff8000', 0.2), 'rgba(255, 128, 0, 0.2)');
check('rgba of junk', rgba('nope', 0.2), null);
check('mix start', mixHex('#000000', '#ffffff', 0), '#000000');
check('mix end', mixHex('#000000', '#ffffff', 1), '#ffffff');
check('mix middle', mixHex('#000000', '#ffffff', 0.5), '#808080');
check('mix clamps', mixHex('#000000', '#ffffff', 7), '#ffffff');
check('mix with a bad stop falls back', mixHex('#123456', 'nope', 0.5), '#123456');
check('three hex letters are a colour ("bad" is #bbaadd)', normalizeHex('bad'), '#bbaadd');

console.log('style normalisation never throws and drops junk');
{
  const s = normalizeStyle({ shape: 'donut', fill: 'sideways', color: 'red', gradientTo: '#F00', zones: 'nope' });
  check('unknown shape -> pips', s.shape, 'pips');
  check('unknown fill -> spent', s.fill, 'spent');
  check('bad colour -> null', s.color, null);
  check('short hex expanded', s.gradientTo, '#ff0000');
  check('zones not an array -> empty', s.zones, []);
  check('null style is default', isDefaultStyle(null), true);
  check('all-default object is default', isDefaultStyle({ shape: 'pips', color: '' }), true);
  check('a colour is not default', isDefaultStyle({ color: '#6ea8fe' }), false);
  check('draining is not default', isDefaultStyle({ fill: 'remaining' }), false);
  const z = normalizeStyle({ zones: [{ from: 4, to: ' burn.max ', color: 'green', label: 7 }, null, 'x'] });
  check('zone bounds become trimmed strings', [z.zones[0].from, z.zones[0].to], ['4', 'burn.max']);
  check('zone bad colour -> palette red', z.zones[0].color, TRACKER_PALETTE[2][0]);
  check('zone label stringified', z.zones[0].label, '7');
  check('non-object zones dropped', z.zones.length, 1);
}

console.log('zones resolve through the evaluator and never match when broken');
{
  const scope = { burn: { max: 18 } };
  const evaluate = (src) => {
    if (src === 'burn.max') return scope.burn.max;
    if (src === 'nope') throw new Error('Unknown value "nope"');
    if (src === 'text') return 'abc';
    return Number(src);
  };
  const zones = resolveZones([
    { from: '1', to: '3', color: '#00ff00', label: 'safe' },
    { from: '4', to: 'burn.max', color: '#ff0000', label: 'danger' },
    { from: '9', to: '7', color: '#0000ff', label: 'backwards' },
    { from: 'nope', to: '5', color: '#123456' },
    { from: '', to: '5', color: '#123456' },
    { from: 'text', to: '5', color: '#123456' },
  ], evaluate);
  check('numeric bounds', [zones[0].fromValue, zones[0].toValue], [1, 3]);
  check('formula bound', zones[1].toValue, 18);
  check('backwards bounds are swapped', [zones[2].fromValue, zones[2].toValue], [7, 9]);
  check('bad formula flagged', /nope/.test(zones[3].error), true);
  check('empty bound flagged', zones[4].error, 'from: empty');
  check('non-number flagged', zones[5].error, 'from: not a number');
  check('zoneAt inside', zoneAt(2, zones).label, 'safe');
  check('zoneAt on formula bound', zoneAt(18, zones).label, 'danger');
  check('zoneAt swapped', zoneAt(8, zones).label, 'backwards');
  check('zoneAt outside', zoneAt(25, zones), null);
  check('broken zones never match', zoneAt(5, [zones[3]]), null);
  // Later zones win, so a one-value highlight can sit on a broad band.
  const layered = resolveZones([
    { from: '1', to: '10', color: '#111111' },
    { from: '5', to: '5', color: '#222222' },
  ], evaluate);
  check('later zone wins', zoneAt(5, layered).color, '#222222');
  check('band still applies elsewhere', zoneAt(6, layered).color, '#111111');
}

console.log('step colours: zone > gradient > base, theme fallbacks');
{
  const evaluate = (src) => Number(src);
  const base = { min: 0, max: 10, style: normalizeStyle(null), resolvedZones: [] };
  check('default is the theme accent', stepColor(3, base), THEME_ACCENT.css);
  check('negative default is the theme red', stepColor(-3, { ...base, min: -10 }), THEME_NEGATIVE.css);
  const solid = { ...base, style: normalizeStyle({ color: '#6ea8fe' }) };
  check('solid colour', stepColor(3, solid), '#6ea8fe');
  const grad = { ...base, style: normalizeStyle({ color: '#000000', gradientTo: '#ffffff' }) };
  check('gradient start', stepColor(1, grad), '#000000');
  check('gradient end', stepColor(10, grad), '#ffffff');
  check('gradient middle', stepColor(5.5, grad), '#808080');
  const gradNoBase = { ...base, style: normalizeStyle({ gradientTo: '#ffffff' }) };
  check('gradient without a base starts from the accent hex', stepColor(1, gradNoBase), THEME_ACCENT.hex);
  const two = { min: -6, max: 6, style: normalizeStyle({ negativeColor: '#000000', negativeGradientTo: '#ffffff' }), resolvedZones: [] };
  check('negative gradient starts at -1', stepColor(-1, two), '#000000');
  check('negative gradient ends at min', stepColor(-6, two), '#ffffff');
  const zoned = {
    ...grad,
    resolvedZones: resolveZones([{ from: '4', to: '6', color: '#ff00ff' }], evaluate),
  };
  check('zone beats gradient', stepColor(5, zoned), '#ff00ff');
  check('outside zone gradient again', stepColor(1, zoned), '#000000');
  check('single-step range does not divide by zero', stepColor(1, { ...grad, max: 1 }), '#000000');
}

console.log('bar geometry');
{
  const evaluate = (src) => Number(src);
  const plain = barLayout({ min: 0, max: 20, current: 5, style: null, resolvedZones: [] });
  check('no zero line on a plain pool', plain.zero, null);
  near('fill from left', plain.fill.from, 0);
  near('fill to 5/20', plain.fill.to, 0.25);
  check('no bands', plain.bands, []);

  const drain = barLayout({ min: 0, max: 20, current: 5, style: { fill: 'remaining' }, resolvedZones: [] });
  near('draining shows what is left', drain.fill.to, 0.75);

  const empty = barLayout({ min: 0, max: 20, current: 0, style: null, resolvedZones: [] });
  check('nothing spent -> no fill', empty.fill, null);
  const drained = barLayout({ min: 0, max: 20, current: 20, style: { fill: 'remaining' }, resolvedZones: [] });
  check('all spent while draining -> no fill', drained.fill, null);

  const two = barLayout({ min: -7, max: 7, current: -3, style: null, resolvedZones: [] });
  near('zero line in the middle', two.zero, 0.5);
  check('negative fill flagged', two.fill.negative, true);
  near('negative fill from -3', two.fill.from, 4 / 14);
  near('negative fill to zero', two.fill.to, 0.5);
  const twoPos = barLayout({ min: -7, max: 7, current: 4, style: null, resolvedZones: [] });
  near('positive fill from zero', twoPos.fill.from, 0.5);
  near('positive fill to +4', twoPos.fill.to, 11 / 14);

  const zones = resolveZones([
    { from: '4', to: '6', color: '#ff0000', label: 'nonlethal' },
    { from: '9', to: '10', color: '#00ff00' },
  ], evaluate);
  const zoned = barLayout({ min: 0, max: 10, current: 5, style: null, resolvedZones: zones });
  check('two bands', zoned.bands.length, 2);
  near('band 4..6 starts after 3', zoned.bands[0].from, 0.3);
  near('band 4..6 ends at 6', zoned.bands[0].to, 0.6);
  check('band keeps label', zoned.bands[0].label, 'nonlethal');
  check('one segment inside the fill', zoned.segments.length, 1);
  near('segment starts with the band', zoned.segments[0].from, 0.3);
  near('segment ends with the fill', zoned.segments[0].to, 0.5);
  check('segment colour', zoned.segments[0].color, '#ff0000');

  const negZone = resolveZones([{ from: '-7', to: '-5', color: '#0000ff' }], evaluate);
  const negBar = barLayout({ min: -7, max: 7, current: -6, style: null, resolvedZones: negZone });
  near('negative band from min', negBar.bands[0].from, 0);
  near('negative band covers -7..-5', negBar.bands[0].to, 3 / 14);
  near('negative segment clipped to fill', negBar.segments[0].from, 1 / 14);

  const degenerate = barLayout({ min: 5, max: 5, current: 5, style: null, resolvedZones: [] });
  check('zero span -> nothing to draw', degenerate.fill, null);
  const huge = barLayout({ min: 0, max: 1e9, current: 5e8, style: null, resolvedZones: [] });
  near('huge pools are fine', huge.fill.to, 0.5);
}

console.log('clicking a bar -- left to right always means low to high');
{
  const drain = { fill: 'remaining' };
  const spend = { fill: 'spent' };

  /*
   * The bug this exists to stop: a draining bar shows what is LEFT, so clicking
   * near the right edge asks to be left nearly full. Written the other way round
   * the bar jumps away from the cursor -- a nudge on the left, a wipeout on the
   * right -- which is exactly how it behaved before this moved into one place.
   */
  check('clicking the right of a draining bar leaves it full',
    barClickValue(1, { min: 0, max: 110, style: drain }).reading, 110);
  check('clicking the left of a draining bar leaves it empty',
    barClickValue(0, { min: 0, max: 110, style: drain }).reading, 0);
  check('a click a quarter along leaves a quarter',
    barClickValue(0.25, { min: 0, max: 100, style: drain }).reading, 25);

  // `current` is what gets stored, and for a draining pool it counts what is gone.
  check('a full bar has nothing spent',
    barClickValue(1, { min: 0, max: 110, style: drain }).current, 0);
  check('an empty bar has all of it spent',
    barClickValue(0, { min: 0, max: 110, style: drain }).current, 110);
  check('and a quarter left is three quarters spent',
    barClickValue(0.25, { min: 0, max: 100, style: drain }).current, 75);

  // An ordinary pool fills up as it is spent, so reading and stored value agree.
  check('a spent-fill bar stores what it reads',
    barClickValue(0.25, { min: 0, max: 100, style: spend }), { reading: 25, current: 25 });

  // Two-sided meters show a signed position and are never read backwards, whatever
  // fill they are styled with.
  check('a two-sided meter reads straight off the track',
    barClickValue(0.5, { min: -7, max: 7, style: drain }), { reading: 0, current: 0 });
  check('its right-hand end is its maximum',
    barClickValue(1, { min: -7, max: 7, style: drain }).current, 7);

  // Nothing off the ends, and junk in does not produce junk out.
  check('a click past the right clamps',
    barClickValue(9, { min: 0, max: 10, style: drain }).reading, 10);
  check('a click past the left clamps',
    barClickValue(-9, { min: 0, max: 10, style: drain }).reading, 0);
  check('an empty pool has nowhere to click',
    barClickValue(0.5, { min: 0, max: 0, style: drain }), { reading: 0, current: 0 });
  check('a junk fraction is the left edge',
    barClickValue(NaN, { min: 0, max: 10, style: drain }).reading, 0);
  check('no options at all still answers', barClickValue(0.5), { reading: 0, current: 0 });
}

console.log('squares -- a small block of pips, then a count');
{
  check('squares is a shape', SHAPES.includes('squares'), true);
  check('an unknown shape still falls back to pips', normalizeStyle({ shape: 'blob' }).shape, 'pips');
  check('squares survives normalisation', normalizeStyle({ shape: 'squares' }).shape, 'squares');

  const drain = { shape: 'squares', fill: 'remaining' };
  const sq = (max, current, style = drain) => squareLayout({ min: 0, max, current, style });

  // A prepared spell with two uses committed to it, one spent.
  check('two uses, none spent', sq(2, 0), { total: 2, lit: 2, slots: 2, mode: 'pips' });
  check('two uses, one spent', sq(2, 1), { total: 2, lit: 1, slots: 2, mode: 'pips' });
  check('two uses, both spent', sq(2, 2), { total: 2, lit: 0, slots: 2, mode: 'pips' });

  // Four is the most that reads at a glance, so five is where it gives up...
  check('four left still draws pips', sq(4, 0).mode, 'pips');
  check('five left prints the count', sq(5, 0).mode, 'number');
  check('the limit is where it turns over', SQUARE_PIP_LIMIT, 4);

  // ...and it comes back to pips as the count falls, which is the point.
  check('six committed, none spent', [sq(6, 0).mode, sq(6, 0).lit], ['number', 6]);
  check('six committed, one spent', [sq(6, 1).mode, sq(6, 1).lit], ['number', 5]);
  check('six committed, two spent -- back to pips',
    [sq(6, 2).mode, sq(6, 2).lit, sq(6, 2).slots], ['pips', 4, 4]);

  // The default fill counts the other way, like the other shapes do.
  const spend = { shape: 'squares', fill: 'spent' };
  check('spent fill counts what is gone', sq(3, 1, spend).lit, 1);
  check('drained fill counts what is left', sq(3, 1, drain).lit, 2);

  // Nothing here may produce a negative count or more pips than the pool holds.
  check('current past the max clamps', sq(3, 99).lit, 0);
  check('a negative current clamps', sq(3, -5).lit, 3);
  check('an empty pool draws nothing', sq(0, 0), { total: 0, lit: 0, slots: 0, mode: 'pips' });
  check('a junk max is zero', squareLayout({ min: 0, max: null, current: 3, style: drain }).total, 0);
}

console.log('meters -- the built-in gauges take a tracker style, with layers over it');
{
  check('the meters that carry one', METERS.map(([k]) => k), ['hp', 'essence', 'pp']);
  check('a meter starts as a bar', METER_DEFAULT_STYLE, { shape: 'bar', fill: 'spent' });
  check('nothing set is the default', isDefaultMeterStyle(null), true);
  check('and so is the default spelt out', isDefaultMeterStyle({ shape: 'bar', fill: 'spent' }), true);
  // Pips are a tracker's default, not a meter's, so choosing them is a change.
  check('pips are a change', isDefaultMeterStyle({ shape: 'pips' }), false);
  check('a colour is a change', isDefaultMeterStyle({ color: '#6ea8fe' }), false);
  check('a zone is a change', isDefaultMeterStyle({ zones: [{ from: '1', to: '2' }] }), false);

  // A pool that the sheet reads as "23 of 40 left" starts drained instead.
  check('the power point pool drains', meterDefaultStyle('pp'), { shape: 'bar', fill: 'remaining' });
  check('and hit points do not', meterDefaultStyle('hp'), METER_DEFAULT_STYLE);
  check('a meter nobody named takes the shared default', meterDefaultStyle('nope'), METER_DEFAULT_STYLE);
  check('drained is the default for the pool', isDefaultMeterStyle({ fill: 'remaining' }, 'pp'), true);
  check('but a change for hit points', isDefaultMeterStyle({ fill: 'remaining' }, 'hp'), false);
  check('and filling is a change for the pool', isDefaultMeterStyle({ fill: 'spent' }, 'pp'), false);

  // Where a value sits on the track, and the band a layer covers.
  near('the bottom of the track', trackPos(0, 0, 20), 0);
  near('the top', trackPos(20, 0, 20), 1);
  near('a quarter up', trackPos(5, 0, 20), 0.25);
  near('past the top clamps', trackPos(99, 0, 20), 1);
  near('below the bottom clamps', trackPos(-99, 0, 20), 0);
  check('a track with no span is all zero', trackPos(5, 4, 4), 0);

  // Angou's four temporary essence: the last four of a 24-point track.
  const temp = trackBand(20, 24, 0, 24);
  near('a layer starts where the granted pool ends', temp.from, 20 / 24);
  near('and runs to the top', temp.to, 1);
  check('a layer written backwards is read forwards', trackBand(24, 20, 0, 24), temp);
  check('a layer covering nothing is dropped', trackBand(7, 7, 0, 24), null);
  check('a layer off the end of the track is dropped', trackBand(30, 40, 0, 24), null);

  // The warning below zero arrives gradually rather than all at once.
  check('above zero there is nothing to warn about', dyingFraction(5, -14), 0);
  check('at zero, still nothing', dyingFraction(0, -14), 0);
  near('one point past zero barely shows', dyingFraction(-1, -14), 1 / 14);
  near('halfway to death', dyingFraction(-7, -14), 0.5);
  check('at the threshold it maxes out', dyingFraction(-14, -14), 1);
  check('and past it stays there', dyingFraction(-99, -14), 1);
  check('a threshold that is not below zero cannot be approached', dyingFraction(-5, 0), 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
