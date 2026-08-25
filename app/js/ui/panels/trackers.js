/**
 * ui/panels/trackers.js -- the Trackers tab, and the meters everywhere else.
 *
 * Two things that share their drawing: the player's own trackers, which live
 * on this tab, and the built-in meters -- hit points, essence, power points --
 * which live on the panels they belong to but are drawn by the same code. So
 * most of this file is exported: the Overview's resource card, the hit-points
 * panel and the psionics panel all reach for it.
 *
 * `ctx` carries the four bits of element state a tracker's editing needs --
 * which one is open, and the draft being typed into it.
 */
import { esc } from '../html.js';
import { PIP_LIMIT, round, pct } from '../format.js';
import { forwardedBadge } from '../badges.js';
import { prose, renderedProse } from '../prose.js';
import { evaluateFormula } from '../../formula.js';
import { highlight, pretty, workingLine, workings } from '../../formula-format.js';
import { hasTokens } from '../../inline.js';
import {
  THEME_ACCENT, THEME_NEGATIVE, TRACKER_PALETTE, barLayout, normalizeStyle, resolveZones,
  rgba, squareLayout, stepColor, trackBand, zoneAt,
} from '../../tracker-style.js';


export function renderTrackersPanel(model, ctx) {
  const trackers = model.trackers;
  const names = model.scopeNames();
  const draft = ctx.draft;
  const preview = previewBox(model, 'add', draft.formula, draft.minFormula);

  return `<div class="grid">
      <section class="panel span2">
        <h3>Resource trackers</h3>
        ${trackers.length ? trackers.map((t) => trackerRow(model, ctx, t)).join('') : '<p class="empty">No trackers yet.</p>'}
      </section>

      <section class="panel span2">
        <h3>Add a tracker</h3>
        <div class="formrow">
          <div class="cols">
            <input data-draft="name" placeholder="Name (e.g. Mythic Power)" value="${esc(draft.name)}">
            <input class="mono" data-draft="formula" placeholder="Max, as a formula (e.g. 3 + mythic.tier * 2)" value="${esc(draft.formula)}">
            <input class="mono" data-draft="minFormula" placeholder="Min (optional, e.g. -floor(qi.max / 2))" value="${esc(draft.minFormula || '')}">
            <input data-draft="refresh" placeholder="Refresh (Daily)" value="${esc(draft.refresh)}">
          </div>
          ${preview}
          <input data-draft="note" placeholder="Note (optional) — {= self.current * level} reads the pool as it fills"
            value="${esc(draft.note || '')}" aria-label="Note">
          <div><button class="primary" data-action="add-tracker">Add tracker</button></div>
        </div>
        <p class="hint">
          Formulas are plain text and are never executed as code — they are parsed and
          evaluated in a sandbox, and every one is visible to your GM in the Formula Audit tab.
          Functions: <code>floor</code> <code>ceil</code> <code>round</code> <code>min</code>
          <code>max</code> <code>sum</code> <code>abs</code> <code>clamp</code> <code>if</code>
          <code>mod</code> <code>iterations</code>.
          <button data-action="formulas" class="linkish"
            title="The guide, a scratchpad, and every value with its current number"
            >ƒx Formulas</button> has all of them explained, somewhere to try one, and every
          value this character can read with what it is worth now.
        </p>
        <p class="hint">
          <strong>Min</strong> is 0 unless you give it a formula. A negative min makes a two-sided
          meter that swings below zero — e.g. max <code>floor((burn.max + qi.max) / 4)</code>
          and min <code>-floor((burn.max + qi.max) / 4)</code> for a ±7 pool. Custom trackers
          can be edited later with ✎.
        </p>
        <details>
          <summary class="hint" style="cursor:pointer">Available values (${names.length})</summary>
          <div style="margin-top:6px">${names.map((n) => `<span class="tag">${esc(n)}</span>`).join('')}</div>
        </details>
      </section>
    </div>`;
}

/**
 * One tracker. An ordinary pool runs 0..max and `current` counts what has
 * been spent. A tracker whose min is below zero is a two-sided meter
 * (Hellfire Qi: -7..+7): `current` is a signed position, negative pips grow
 * leftwards from a zero mark, and the value is shown red while negative.
 */

/**
 * A formula shown under the thing it drives -- a tracker's max, its min.
 *
 * Coloured rather than plain, spaced out rather than as typed, and carrying
 * its own working on hover: "floor(level / 2) + wis.mod = floor(20 / 2) + 5
 * = 15" answers where the number came from without leaving the row.
 */
export function formulaMeta(model, label, source) {
  return `<div class="tmeta" title="${esc(workingLine(source, model.scope()))}">${
    esc(label)} = <code class="fx-code">${highlight(pretty(source))}</code></div>`;
}

/** A draining tracker shows and edits what is left rather than what was spent. */
export function isDraining(t) {
  return (Number(t.min) || 0) >= 0 && normalizeStyle(t.style).fill === 'remaining';
}


function trackerRow(model, ctx, t) {
  if (ctx.editTracker === t.id) return trackerEditRow(model, ctx, t);
  const max = Number(t.max) || 0;
  const min = Number(t.min) || 0;
  const cur = Number(t.current) || 0;
  const twoSided = min < 0;
  const draining = isDraining(t);
  const signed = (n) => (n > 0 ? `+${n}` : String(n).replace('-', '−'));
  const shown = draining ? max - cur : cur;

  const range = min === 0 ? `/ ${max}`
    : (twoSided && min === -max) ? `/ ±${max}`
      : `/ ${signed(min)}…${signed(max)}`;
  // Everything is editable; only Mythic Power cannot be deleted.
  const protectedTracker = model.isProtectedTracker(t.id);
  const minusLabel = twoSided ? 'Decrease by one' : draining ? 'Spend one' : 'Restore one';
  const plusLabel = twoSided ? 'Increase by one' : draining ? 'Restore one' : 'Spend one';
  // The zone the tracker currently sits in (by the value the row shows) --
  // a labelled zone doubles as a state readout: "Hungry", "Sated", "Stuffed".
  const state = zoneAt(shown, t.resolvedZones || []);
  const stateBadge = state?.label
    ? `<span class="badge zonestate" style="border-color:${state.color};color:${state.color}" title="${esc(`${state.fromValue}–${state.toValue}`)}">${esc(state.label)}</span>`
    : '';

  return `<div class="tracker ${t.error ? 'invalid' : ''} ${twoSided ? 'two-sided' : ''}">
      <div>
        <div class="tname">${esc(t.name)}
          ${t.source === 'player' ? '<span class="badge player">custom</span>'
  : `<span class="badge">from sheet${t.edited ? ', edited' : ''}</span>`}
          ${protectedTracker ? '<span class="badge" title="Every character has Mythic Power from level 8">required</span>' : ''}
          ${t.refresh ? `<span class="badge">${esc(t.refresh)}</span>` : ''}
          ${draining ? '<span class="badge">drains</span>' : ''}
          ${stateBadge}
        </div>
        ${t.maxFormula ? formulaMeta(model, 'max', t.maxFormula) : ''}
        ${t.minFormula ? formulaMeta(model, 'min', t.minFormula) : ''}
        ${['max', 'min'].map((edge) => {
        const badge = forwardedBadge(model, `tracker.${t.id}.${edge}`);
        return badge ? `<div class="tmeta">${esc(edge)} ${badge}</div>` : '';
      }).join('')}
        ${t.note ? `<div class="tnote">${hasTokens(t.note)
    ? renderedProse(model, t.note, model.trackerScope(t))
    : esc(t.note)}</div>` : ''}
        ${t.error ? `<div class="terr">${esc(t.error)}</div>` : ''}
        ${trackerVisual(t, normalizeStyle(t.style), t.resolvedZones || [], { interactive: true })}
      </div>
      <div class="tracker-controls">
        <button data-tracker-step="${esc(t.id)}" data-delta="-1" aria-label="${minusLabel}">−</button>
        <input type="number" class="${shown < 0 ? 'neg' : ''}" value="${shown}" data-tracker-current="${esc(t.id)}"
          aria-label="${esc(t.name)} ${draining ? 'remaining' : 'current'}">
        <span class="pool">${range}</span>
        <button data-tracker-step="${esc(t.id)}" data-delta="1" aria-label="${plusLabel}">+</button>
        <button data-tracker-edit="${esc(t.id)}" aria-label="Edit ${esc(t.name)}" title="Edit">✎</button>
        ${protectedTracker ? '' : `<button class="danger" data-tracker-remove="${esc(t.id)}" aria-label="Remove ${esc(t.name)}">×</button>`}
      </div>
    </div>`;
}

/**
 * The pips, bar or squares of a tracker, painted with a style.
 *
 * Pips: one per integer step in [min, max] (zero is a marker, not a pip);
 * lit pips take the step's colour (zone > gradient > base), unlit pips in a
 * zone keep a faint tint of it so the range shows even when empty. Beyond 40
 * steps only the number shows -- decided from the count before anything is
 * built, so a huge formula cannot stall the page.
 *
 * Bar: a continuous track; zones are faint bands, the fill is the base colour
 * or its gradient, and the parts of the fill inside a zone take that colour.
 * Two-sided meters fill outward from a zero line.
 *
 * Squares: the same pips packed two-by-two, for a pool small enough to read
 * without counting -- a prepared spell's handful of uses. Past four it prints
 * the count instead, and comes back to pips as the count falls.
 *
 * `interactive: false` renders inert spans (the editor's live preview).
 */
export function trackerVisual(t, style, resolvedZones, { interactive = true, current = null, layers = null } = {}) {
  const max = Number(t.max) || 0;
  const min = Number(t.min) || 0;
  const cur = current ?? (Number(t.current) || 0);
  const twoSided = min < 0;
  const draining = !twoSided && style.fill === 'remaining';
  const signed = (n) => (n > 0 ? `+${n}` : String(n).replace('-', '−'));
  const ctx = { min, max, style, resolvedZones };
  const pct = (f) => `${(f * 100).toFixed(3)}%`;

  if (style.shape === 'bar') {
    const layout = barLayout({ min, max, current: cur, style, resolvedZones });
    let fill = '';
    if (layout.fill) {
      const f = layout.fill;
      const width = f.to - f.from;
      let background;
      if (f.negative) {
        const base = style.negativeColor || THEME_NEGATIVE.css;
        background = style.negativeGradientTo
          ? `linear-gradient(to left, ${base}, ${style.negativeGradientTo}) right / ${pct((layout.zero || 0) / width)} 100% no-repeat`
          : base;
      } else {
        const base = style.color || THEME_ACCENT.css;
        const side = twoSided ? 1 - layout.zero : 1;   // the gradient spans the whole positive side
        background = style.gradientTo
          ? `linear-gradient(to right, ${base}, ${style.gradientTo}) left / ${pct(side / width)} 100% no-repeat`
          : base;
      }
      fill = `<div class="fill" style="left:${pct(f.from)};width:${pct(width)};background:${background}"></div>`;
    }
    const shownValue = draining ? max - cur : cur;
    const title = twoSided ? signed(cur) : `${shownValue} of ${max}`;
    return `<div class="bar ${twoSided ? 'two-sided' : ''}" ${interactive ? `data-bar="${esc(t.id)}"` : ''}
          title="${esc(title)}${interactive ? ' — click to set' : ''}">
        ${layout.bands.map((b) => `<div class="band" style="left:${pct(b.from)};width:${pct(b.to - b.from)};background:${rgba(b.color, 0.22)}"
          ${b.label ? `title="${esc(b.label)}"` : ''}></div>`).join('')}
        ${fill}
        ${layout.segments.map((s) => `<div class="seg" style="left:${pct(s.from)};width:${pct(s.to - s.from)};background:${s.color}"></div>`).join('')}
        ${layout.zero !== null ? `<div class="zero-line" style="left:${pct(layout.zero)}"></div>` : ''}
      </div>`;
  }

  /*
   * Squares: a small square of pips for a pool you can hold in your hand,
   * giving way to a plain count once there are more of them than the eye
   * takes in at a glance. Clicking a pip sets the tracker to what that pip
   * would leave, so the same handler the other shapes use still applies.
   */
  if (style.shape === 'squares') {
    const sq = squareLayout({ min, max, current: cur, style });
    const colour = stepColor(Math.max(1, sq.lit), ctx);
    const label = `${sq.lit} of ${max}${draining ? ' left' : ' used'}`;
    if (sq.mode === 'number') {
      return `<div class="pipcount" title="${esc(label)}" style="color:${colour};border-color:${colour}">
          ${sq.lit}<span class="of">/${max}</span></div>`;
    }
    const tag = interactive ? 'button' : 'span';
    return `<div class="pips square" title="${esc(label)}">${
      Array.from({ length: sq.slots }, (_, i) => {
        const n = i + 1;                       // this pip stands for the nth use
        const on = n <= sq.lit;
        const paint = on ? `background:${colour};border-color:${colour}` : '';
        // `data-n` is the pip's own number; the click handler converts it for
        // a draining tracker and spends one when the last lit pip is clicked.
        return `<${tag} class="pip ${on ? 'used' : ''}" style="${paint}"
            ${interactive ? `data-pip="${esc(t.id)}" data-n="${n}"` : ''}
            title="${esc(`${n} of ${max}`)}"
            aria-label="Set ${esc(t.name)} to ${n}"></${tag}>`;
      }).join('')
    }</div>`;
  }

  const stepCount = max >= min ? (max - min + 1) - (min <= 0 && max >= 0 ? 1 : 0) : 0;
  if (!(stepCount > 0 && stepCount <= PIP_LIMIT)) return '';
  const steps = [];
  for (let k = min; k <= max; k++) if (k !== 0) steps.push(k);
  const tag = interactive ? 'button' : 'span';
  const remaining = max - cur;
  const zeroMark = `<${tag} class="pip zero" ${interactive ? `data-pip="${esc(t.id)}" data-n="0"` : ''} title="0"
      aria-label="Set ${esc(t.name)} to 0"></${tag}>`;
  return `<div class="pips">${steps.map((k, i) => {
    const lit = twoSided ? (k > 0 ? cur >= k : cur <= k)
      : draining ? k <= min + remaining : cur >= k;
    const zone = zoneAt(k, resolvedZones);
    const colour = stepColor(k, ctx);
    const paint = lit ? `background:${colour};border-color:${colour}`
      : zone ? `border-color:${zone.color};background:${rgba(zone.color, 0.18)}` : '';
    // A meter's layers mark the pip they cover: borrowed capacity is drawn
    // as an outline, a spoken-for step keeps its colour but is struck.
    const marks = layers ? meterPipClass(k, layers) : '';
    const layerLabel = layers
      ? (layers.filter((l) => k > Math.min(l.from, l.to) && k <= Math.max(l.from, l.to))
        .map((l) => l.label).filter(Boolean).join(' · '))
      : '';
    const label = `${twoSided ? signed(k) : `${k} of ${max}`}${zone?.label ? ` · ${zone.label}` : ''}${layerLabel ? ` · ${layerLabel}` : ''}`;
    const pip = `<${tag} class="pip ${k < 0 ? 'neg' : ''} ${lit ? 'used' : ''} ${marks}" ${interactive ? `data-pip="${esc(t.id)}" data-n="${k}"` : ''}
          style="${paint}" title="${esc(label)}" aria-label="Set ${esc(t.name)} to ${twoSided ? signed(k) : k}"></${tag}>`;
    // The zero mark sits between the last negative pip and the first positive one.
    const markBefore = twoSided && k > 0 && (i === 0 || steps[i - 1] < 0);
    const markAfter = twoSided && k < 0 && i === steps.length - 1;
    return `${markBefore ? zeroMark : ''}${pip}${markAfter ? zeroMark : ''}`;
  }).join('')}</div>`;
}

/* ---------------- built-in meters ---------------- */

/**
 * A meter -- hit points, essence -- painted with the player's style.
 *
 * The shapes and colours are a tracker's, so the base picture comes from
 * `#trackerVisual` and this adds what a meter has and a tracker does not:
 * layers over the track, and an alarm state. A layer is a value range, so
 * it lands in the right place whichever shape is chosen -- a band across a
 * bar, marked pips in a row of pips.
 *
 * Pips are refused rather than drawn badly: a hundred and eighty hit points
 * is not a row of pips, so a meter that would need more than the pip limit
 * falls back to its bar and the editor says so.
 */
export function meterVisual(spec, { interactive = false } = {}) {
  if (!spec) return '';
  const style = spec.style;
  const min = Number(spec.min) || 0;
  const max = Number(spec.max) || 0;
  const steps = max - min;
  const shape = (style.shape === 'pips' && (steps <= 0 || steps > PIP_LIMIT))
    ? 'bar' : style.shape;
  const drawn = { ...style, shape };
  const alert = Math.max(0, Math.min(1, Number(spec.alert) || 0));
  const pct = (f) => `${(f * 100).toFixed(3)}%`;

  // Layers are drawn over the shape; a shape that cannot carry them (the
  // squares' bare count) simply gets none.
  let layers = '';
  if (shape === 'bar') {
    layers = (spec.layers || []).map((l) => {
      const band = trackBand(l.from, l.to, min, max);
      return band ? `<div class="mlayer ${esc(l.kind)}" style="left:${pct(band.from)};width:${pct(band.to - band.from)}"
          title="${esc(l.label || '')}"></div>` : '';
    }).join('');
  }

  const visual = trackerVisual(
    { ...spec, id: spec.id }, drawn, spec.resolvedZones || [],
    { interactive, current: spec.current, layers: shape === 'pips' ? spec.layers : null },
  );
  // The alarm is the track's own: a red ground that deepens and a glow that
  // widens, both scaled by how far gone the character is, so 1 hit point
  // from death looks nothing like 1 point past zero.
  const classes = ['meter', spec.id];
  if (alert > 0) classes.push('is-alert', ...(spec.alertFill ? ['alert-fill'] : []));
  return `<div class="${esc(classes.join(' '))}"${alert > 0 ? ` style="--alert:${alert.toFixed(3)}"` : ''}>
      ${visual}${layers ? `<div class="mlayers">${layers}</div>` : ''}
    </div>`;
}

/** The ✎ that opens a meter's style editor, and closes it again. */
export function meterStyleButton(ctx, key) {
  const open = ctx.editMeter === key;
  return `<button class="tiny" data-meter-edit="${key}" aria-pressed="${open}"
      style="margin-left:auto" title="${open ? 'Done' : 'Change how this is drawn'}">${open ? 'Done' : '✎ Style'}</button>`;
}

/**
 * The style editor for a meter, when it is the one being edited.
 *
 * It is the tracker editor's own block -- shape, fill, colours, gradients
 * and zones -- pointed at a meter instead, so there is one set of controls
 * to learn and one to maintain. What differs is what it saves to and the
 * example a zone bound is written with.
 */
export function meterStyleEditor(model, ctx, key) {
  if (ctx.editMeter !== key) return '';
  const spec = model.meterSpec(key);
  if (!spec) return '';
  return `<div class="meter-style">
      <div class="tstyle" data-tstyle-for="${esc(key)}">${trackerStyleEditor(model, ctx, spec)}</div>
      <div class="pair">
        <button class="primary" data-action="save-meter" data-key="${esc(key)}">Save</button>
        <button data-action="cancel-meter">Cancel</button>
        <button data-action="reset-meter" data-key="${esc(key)}"
          title="Back to the bar every character starts with">Reset to default</button>
      </div>
    </div>`;
}

/**
 * The pips of a meter, marked where its layers fall.
 *
 * Called from `#trackerVisual` while it walks the steps, because a pip has
 * to know whether it is borrowed or spoken for before it is painted -- a
 * temporary hit point is drawn as an outline rather than a solid, and a
 * nonlethal one keeps its colour but is struck through.
 */
function meterPipClass(k, layers) {
  // Pip k stands for the step (k-1, k], so a layer from 20 to 24 is the four
  // pips 21..24 -- the twentieth is the last of the granted pool, not the
  // first of the borrowed one.
  return (layers || [])
    .filter((l) => k > Math.min(l.from, l.to) && k <= Math.max(l.from, l.to))
    .map((l) => `is-${l.kind}`)
    .join(' ');
}

/**
 * In-place editor: name, formulas, refresh and style. Every tracker is
 * editable, including the ones seeded from the sheet's own Resource Tracker
 * block -- those save what differs from the sheet, so Reset still restores it.
 */
function trackerEditRow(model, ctx, t) {
  const d = ctx.editDraft;
  return `<div class="tracker editing">
      <div class="formrow" style="margin:0">
        <div class="cols">
          <input data-tedit="name" placeholder="Name" value="${esc(d.name)}" aria-label="Tracker name">
          <input class="mono" data-tedit="maxFormula" placeholder="Max, as a formula" value="${esc(d.maxFormula)}" aria-label="Max formula">
          <input class="mono" data-tedit="minFormula" placeholder="Min (optional)" value="${esc(d.minFormula)}" aria-label="Min formula">
          <input data-tedit="refresh" placeholder="Refresh" value="${esc(d.refresh)}" aria-label="Refresh">
        </div>
        ${previewBox(model, 'edit', d.maxFormula, d.minFormula)}
        ${trackerNoteField(model, t, d.note)}
        ${t.source === 'sheet' ? `<p class="hint">Seeded from the sheet’s Resource Tracker — your
          changes are saved against it, and Reset restores the sheet’s version.</p>` : ''}
        <div class="tstyle" data-tstyle-for="${esc(t.id)}">${trackerStyleEditor(model, ctx, t)}</div>
        <div style="display:flex;gap:6px">
          <button class="primary" data-action="save-tracker" data-id="${esc(t.id)}">Save</button>
          <button data-action="cancel-tracker">Cancel</button>
        </div>
      </div>
    </div>`;
}

/**
 * The tracker's note: prose that may carry {…} formulas, resolved against
 * the tracker itself.
 *
 * This is the readout for a resource that *does* something as it fills --
 * a kineticist's burn is nonlethal damage and a bonus at once -- so the note
 * has to be able to say "at this level of the pool, here is the number", and
 * recompute the moment a pip is clicked. `self` is the tracker's own row, so
 * the note keeps working after a rename.
 */
function trackerNoteField(model, t, value) {
  const facts = Object.keys(model.trackerScope(t).self);
  return `<label class="fld tall tnote-edit">
      <span>Note — shown under the tracker, formulas resolve as it fills</span>
      ${prose(model, `data-tedit="note"`, value, 2, '', model.trackerScope(t))}
      <span class="hint">
        <code>self</code> is this tracker: ${facts.map((k) => `<code>self.${k}</code>`).join(' ')}.
        Elsewhere on the character the same numbers are
        <code>tracker.${esc(t.id)}.max</code> and friends — that id is fixed when the
        tracker is created and does not follow a rename.<br>
        Burn, for example: <code>Nonlethal {= self.current * level}, +{= self.current} to DCs</code>.
        A <code>{name = …}</code> written here shows its value but is not published to the rest
        of the character, because a note reads the pool rather than defining it.
      </span>
    </label>`;
}

/**
 * The style section of the editor: shape, fill direction, colours (16
 * suggestions plus any hex), gradients, and highlighted zones, with a live
 * preview of the tracker painted with the draft.
 */
export function trackerStyleEditor(model, ctx, t) {
  const s = ctx.editDraft.style;
  const twoSided = (Number(t.min) || 0) < 0;
  // A zone bound is a formula, and the example has to be one the thing being
  // styled can actually read: a tracker knows its own max, a meter does not.
  const zoneExample = t.zoneExample || 'self.max * 0.3';
  const zoneRows = s.zones.map((z, i) => `
      <div class="zone-row">
        <input class="mono" data-zone="${i}|from" placeholder="from (e.g. 0)" value="${esc(z.from)}" aria-label="Zone ${i + 1} from">
        <input class="mono" data-zone="${i}|to" placeholder="to (e.g. ${esc(zoneExample)})" value="${esc(z.to)}" aria-label="Zone ${i + 1} to">
        <input type="color" data-zonepick="${i}" value="${esc(z.color)}" aria-label="Zone ${i + 1} colour">
        <input class="mono hexin" data-zone="${i}|color" value="${esc(z.color)}" aria-label="Zone ${i + 1} hex" maxlength="7">
        <input data-zone="${i}|label" placeholder="label (optional)" value="${esc(z.label)}" aria-label="Zone ${i + 1} label">
        <button class="danger" data-zone-remove="${i}" aria-label="Remove zone ${i + 1}">×</button>
      </div>`).join('');

  return `
      <div class="tstyle-row">
        <span class="tlabel">Shape</span>
        <select data-tstyle="shape" aria-label="Shape">
          <option value="pips" ${s.shape === 'pips' ? 'selected' : ''}>Pips</option>
          <option value="bar" ${s.shape === 'bar' ? 'selected' : ''}>Bar</option>
          <option value="squares" ${s.shape === 'squares' ? 'selected' : ''}>Squares — a small block, then a count</option>
        </select>
        <span class="tlabel">Fill</span>
        <select data-tstyle="fill" aria-label="Fill direction" ${twoSided ? 'disabled title="Two-sided meters always show their position"' : ''}>
          <option value="spent" ${s.fill === 'spent' ? 'selected' : ''}>Fills up as it is spent</option>
          <option value="remaining" ${s.fill === 'remaining' ? 'selected' : ''}>Drains — shows what is left</option>
        </select>
      </div>
      ${colorField('color', s.color, { label: twoSided ? 'Colour (above 0)' : 'Colour', none: 'Theme accent', noneCss: THEME_ACCENT.css })}
      ${colorField('gradientTo', s.gradientTo, { label: 'Fade to', none: 'No gradient', noneCss: null })}
      ${twoSided ? colorField('negativeColor', s.negativeColor, { label: 'Colour (below 0)', none: 'Theme red', noneCss: THEME_NEGATIVE.css }) : ''}
      ${twoSided ? colorField('negativeGradientTo', s.negativeGradientTo, { label: 'Fade to (below 0)', none: 'No gradient', noneCss: null }) : ''}
      <div class="tstyle-row" style="align-items:flex-start">
        <span class="tlabel" style="padding-top:5px">Zones</span>
        <div style="flex:1;display:grid;gap:5px">
          ${zoneRows}
          <div><button data-add-zone>+ Zone</button>
            <span class="hint">Highlight a value or range in its own colour. Bounds are formulas —
              <code>floor(${esc(zoneExample)})</code> for a band a third of the way up — and a labelled zone
              shows its name on the ${t.meter ? 'meter' : 'tracker'} while the value sits in it.</span></div>
        </div>
      </div>
      <div class="tstyle-row">
        <span class="tlabel">Preview</span>
        <div class="style-preview" style="flex:1">${stylePreviewHtml(model, ctx, t)}</div>
      </div>`;
}

/** One colour control: a "none" swatch, the 16 suggestions, a hex field and a native picker. */
function colorField(field, value, { label, none, noneCss }) {
  const noneStyle = noneCss ? `background:${noneCss}` : '';
  return `<div class="tstyle-row">
      <span class="tlabel">${esc(label)}</span>
      <div class="swatches" role="group" aria-label="${esc(label)}">
        <button class="swatch none" data-swatch="${field}" data-hex="" style="${noneStyle}"
          title="${esc(none)}" aria-label="${esc(none)}" aria-pressed="${value ? 'false' : 'true'}"></button>
        ${TRACKER_PALETTE.map(([hex, name]) => `<button class="swatch" data-swatch="${field}" data-hex="${hex}"
          style="background:${hex}" title="${esc(name)} ${hex}" aria-label="${esc(name)}"
          aria-pressed="${value === hex ? 'true' : 'false'}"></button>`).join('')}
      </div>
      <input class="mono hexin" data-hexin="${field}" value="${esc(value || '')}" placeholder="#rrggbb" maxlength="7" aria-label="${esc(label)} hex">
      <input type="color" data-hexpick="${field}" value="${esc(value || (noneCss ? THEME_ACCENT.hex : '#888888'))}" aria-label="${esc(label)} picker">
    </div>`;
}

/** The tracker or meter as it would look with the draft style (zone formulas resolved live). */
export function stylePreviewHtml(model, ctx, t) {
  const style = normalizeStyle(ctx.editDraft.style);
  const scope = model.scope();
  const zones = resolveZones(style.zones, (src) => evaluateFormula(src, scope));
  const bad = zones.map((z, i) => (z.error ? `zone ${i + 1}: ${z.error}` : null)).filter(Boolean);
  const tooManyPips = t.meter && style.shape === 'pips'
    && ((Number(t.max) || 0) - (Number(t.min) || 0)) > PIP_LIMIT;
  const visual = t.meter
    ? meterVisual({ ...t, style, resolvedZones: zones })
    : (trackerVisual(t, style, zones, { interactive: false })
      || '<span class="hint">(no pips for this range — try the bar)</span>');
  const note = tooManyPips
    ? `<div class="hint">Over ${PIP_LIMIT} steps to draw, so this one stays a bar.</div>` : '';
  return `${visual}${note}${bad.length ? `<div class="terr">${esc(bad.join('; '))}</div>` : ''}`;
}

/** Whatever the style editor is pointed at: a meter if one is open, else the tracker. */
export function styleTarget(model, ctx) {
  return ctx.editMeter
    ? model.meterSpec(ctx.editMeter)
    : model.trackers.find((x) => x.id === ctx.editTracker);
}

/**
 * The preview box is always in the DOM (hidden while empty) so typing into a
 * formula field can update it in place instead of re-rendering the panel and
 * dropping focus.
 */
function previewBox(model, kind, maxSrc, minSrc) {
  const info = trackerPreview(model, maxSrc, minSrc);
  return `<div class="preview ${kind} ${info.ok ? 'ok' : 'err'}"${info.text ? '' : ' style="display:none"'}>${esc(info.text)}</div>`;
}

/**
 * Live preview under the add and edit forms.
 *
 * It shows the substitution rather than only the answer -- "max = floor(20 /
 * 2) + 5 = 15" -- because the formula itself is in the box directly above,
 * and what the player cannot see from there is what their own numbers do to
 * it. A formula with nothing to substitute just states its answer.
 */
export function trackerPreview(model, maxSrc, minSrc) {
  const parts = [];
  let ok = true;
  for (const [label, src] of [['max', maxSrc], ['min', minSrc]]) {
    if (!String(src || '').trim()) continue;
    const w = workings(src, model.scope());
    if (w.error) {
      ok = false;
      parts.push(`${label}: ${w.error}`);
    } else if (w.substituted === w.pretty || w.substituted === w.display) {
      parts.push(`${label} = ${w.display}`);
    } else {
      parts.push(`${label} = ${w.substituted} = ${w.display}`);
    }
  }
  return { ok, text: parts.join('   ·   ') };
}
