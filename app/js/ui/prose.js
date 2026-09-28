/**
 * ui/prose.js -- the fields that let a player write formulas in a sentence.
 *
 * A prose field is two layers in one wrapper: a textarea holding what was
 * typed, and, over it while the field is not focused, the same text with every
 * {…} token replaced by what it currently comes to. Both layers carry the one
 * binding, so this is still an ordinary data-set / data-item control and the
 * element's delegated handler needs to know nothing about it.
 *
 * This is the most widely shared thing on the sheet -- two dozen panels put a
 * prose field somewhere -- which is why it is its own module rather than part
 * of whichever tab happened to define it first.
 */
import { esc } from './html.js';
import { fmt } from '../rules.js';
import { hasTokens, formatValue, proseScope } from '../inline.js';
import { workingLine } from '../formula-format.js';

const PROSE_HINT = 'Formulas work here: {= 2 + con.mod} shows a value, '
  + '{qi.max = wis.mod} names one, {qi.max} reuses it.';

export function itemArea(model, list, i, field, value, rows = 3, local = null, opts = {}) {
  return prose(model, `data-item="${list}|${i}|${field}"`, value, rows, '', local, opts);
}

/**
 * A prose field that may carry {…} inline formulas.
 *
 * Two layers in one wrapper: the textarea holds the raw source and shows
 * while focused; a rendered overlay shows computed values while not. Both
 * receive the same events, so this stays a plain data-item/data-set control.
 */
export function prose(model, bindingAttr, value, rows = 3, extraClass = '', local = null,
  { inactive = false, inactiveTitle = '' } = {}) {
  const text = value ?? '';
  const rendered = hasTokens(text) ? renderedProse(model, text, local, { inactive, inactiveTitle }) : null;
  // The gold edge these fields carry says "formulas work here"; the tooltip
  // is what says how. Set on the wrapper so it covers both layers, and the
  // rendered view's own title still wins while it is showing.
  return `<span class="prose ${rendered ? 'has-tokens' : ''} ${extraClass}" title="${esc(PROSE_HINT)}">
      <textarea ${bindingAttr} data-kind="text" rows="${rows}" spellcheck="false">${esc(text)}</textarea>
      ${rendered ? `<span class="prose-view" title="Click to edit the formulas">${rendered}</span>` : ''}
    </span>`;
}

/**
 * A prose field in a table with no room for prose.
 *
 * Shut, it is one line of what the field says -- computed, so a formula
 * shows its value -- cut off with an ellipsis, and the whole of it is on
 * the tooltip. Clicking opens the real field in place, which grows the row
 * and pushes the ones below it down; clicking anywhere else, or Escape,
 * shuts it again.
 *
 * Only one is open at a time, and which one is not saved with the
 * character: it is a way of reading a wide table, not something about the
 * character.
 */
export function foldedProse(model, ctx, key, bindingAttr, value, placeholder = '') {
  const text = String(value ?? '');
  if (ctx.openCell === key) {
    return `<div class="foldcell open" data-foldcell-open="${esc(key)}">
        ${prose(model, bindingAttr, text, 2, 'grow')}
      </div>`;
  }
  const shown = text.trim()
    ? (hasTokens(text) ? renderedProse(model, text) : esc(text))
    : `<span class="ph">${esc(placeholder)}</span>`;
  return `<button type="button" class="foldcell peek${text.trim() ? '' : ' blank'}"
      data-foldcell="${esc(key)}"
      title="${esc(text.trim() ? `${text}

  Click to edit.` : PROSE_HINT)}">${shown}</button>`;
}

/**
 * What a computed value in prose says when you point at it.
 *
 * The token's own source, then its working -- because a bare "24" in the
 * middle of a sentence is the one place on the sheet where a player has no
 * way at all of seeing what produced it. A `{name}` reference shows the
 * formula from wherever the name was defined, which saves hunting for it.
 *
 * `local` is the scope the text was written in. For a bonus that reads
 * `target`, the working is shown for one destination, evaluated with that
 * destination as `target` on top of `local`.
 */
export function tokenTitle(model, seg, scope, local = null) {
  if (seg.kind === 'ref') {
    const def = (model.inlineDefinitions || []).find((d) => d.name === seg.name);
    return def
      ? `{${seg.name}} — defined as ${workingLine(def.expr, scope)}`
      : `{${seg.name}}`;
  }
  // A forwarded bonus says where it goes before it says how it was worked
  // out: the number is standing in a sentence about something else, and
  // "+24" there means nothing at all until you know it is Bluff's.
  if (seg.kind === 'push') {
    const op = seg.sign < 0 ? '-=' : '+=';
    const as = seg.type ? ` as ${seg.type}` : '';
    const token = `{${seg.targets.join(', ')} ${op} …${as}}`;
    if (seg.values) return `${eachLine(model, seg)} — ${token} ${eachWorking(model, seg, local)}`;
    return `${fmt(seg.value)}${seg.type ? ` ${seg.type}` : ''} to ${targetLabels(model, seg.targets)} — `
      + `${token} ${workingLine(seg.expr, scope)}`;
  }
  const label = seg.kind === 'define' ? `{${seg.name} = …}` : '{= …}';
  return `${label} ${workingLine(seg.expr, scope)}`;
}

/** Names as a reader would say them: "Bluff and Diplomacy". */
function spoken(names) {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0] || '';
}

/** Destination names as a reader would say them: "Bluff and Diplomacy". */
export function targetLabels(model, targets) {
  const byName = new Map((model.forwardTargetList || []).map((t) => [t.name, t.label]));
  return spoken(targets.map((t) => byName.get(t) || t));
}

/**
 * One destination a bonus was added to, by what it is called. A weapon is
 * named by its row, since the destination is one weapon's attack or damage
 * rather than a name anybody wrote.
 */
function destinationLabel(model, key, byName) {
  const weapon = /^weapon\.(\d+)\.(.+)$/.exec(key);
  if (weapon) {
    const w = model.data.equipment?.weapons?.[Number(weapon[1])];
    return `${w?.name || `Weapon ${Number(weapon[1]) + 1}`} ${weapon[2].replace('.', ' ')}`;
  }
  return byName.get(key) || key;
}

/** A long list, cut short: "Appraise, Artistry, Climb and 35 more". */
function few(names, keep = 3) {
  return names.length > keep + 1
    ? `${names.slice(0, keep).join(', ')} and ${names.length - keep} more`
    : spoken(names);
}

/**
 * A bonus evaluated once per destination, grouped by amount: "-2 to Appraise,
 * Artistry, Climb and 35 more; +0 to Acrobatics and Bluff". Non-zero amounts
 * first, in destination order, then +0; destinations the formula errored on
 * last.
 */
export function eachLine(model, seg) {
  const byName = new Map((model.forwardTargetList || []).map((t) => [t.name, t.label]));
  const groups = new Map();
  for (const [key, v] of Object.entries(seg.values || {})) {
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(destinationLabel(model, key, byName));
  }
  const type = seg.type ? ` ${seg.type}` : '';
  const parts = [...groups].sort(([a], [b]) => (!a) - (!b))
    .map(([v, names]) => `${fmt(v)}${v ? type : ''} to ${few(names)}`);
  const failed = Object.keys(seg.failed || {});
  if (failed.length) {
    parts.push(`error on ${few(failed.map((k) => destinationLabel(model, k, byName)))}`);
  }
  return parts.join('; ');
}

/**
 * The working for one destination -- the first whose amount equals the one
 * shown -- evaluated with that destination as `target`.
 */
function eachWorking(model, seg, local) {
  const keys = Object.keys(seg.values || {});
  const key = keys.find((k) => seg.values[k] === seg.value) || keys[0];
  const targets = model.contributions?.targets;
  if (!key || !targets) return '';
  const byName = new Map((model.forwardTargetList || []).map((t) => [t.name, t.label]));
  return `on ${destinationLabel(model, key, byName)}: `
    + workingLine(seg.expr, tokenScope(model, local, targets.targetOf(key)));
}

/**
 * The inline text of a per-destination bonus: its distinct non-zero amounts
 * in destination order ("-2", "+4 / +2"), or "min to max" past three. Zeros
 * are left out; if every destination got 0, it shows +0.
 */
export function eachShown(seg) {
  const sent = [...new Set(Object.values(seg.values || {}))].filter(Boolean);
  if (!sent.length) return fmt(0);
  if (sent.length > 3) return `${fmt(Math.min(...sent))} to ${fmt(Math.max(...sent))}`;
  return sent.map(fmt).join(' / ');
}

/**
 * The scope a prose token resolves in: the names the character defines,
 * then whatever is local to where the text was written (a veil's own
 * invested essence), then the character -- inline.js's own proseScope, so a
 * tooltip can never disagree with the value beside it. `target` is the
 * destination, for a bonus that reads it.
 */
export function tokenScope(model, local, target = null) {
  return proseScope(model.inlineNames || {}, local, model.scope(), target);
}

/**
 * @param inactive  the text is written down but not applying -- a buff that
 *                  is not ticked, a level not yet reached. Its forwarded
 *                  bonuses are painted as the dormant things they are and say
 *                  so on the tooltip; the values around them still resolve,
 *                  because reading is not applying.
 */
export function renderedProse(model, text, local = null, { inactive = false, inactiveTitle = '' } = {}) {
  // Built once for the whole field rather than per token: scope() walks
  // every tracker, skill and companion, and a field may hold dozens of them.
  // The memoiser is *not* called tokenScope: as a method it called
  // `this.#tokenScope` and the two names could not collide, but here they
  // would, and a helper that shadows the function it means to call recurses
  // until the stack gives out -- which is a blank tab, not an error message.
  let scope = null;
  const scopeOnce = () => (scope ??= tokenScope(model, local));
  return model.renderProse(text, local).map((seg) => {
    if (seg.kind === 'text') return esc(seg.text);
    if (seg.error) {
      const label = seg.kind === 'define' ? `{${seg.name} = ${seg.expr}}`
        : seg.kind === 'ref' ? `{${seg.name}}` : `{= ${seg.expr}}`;
      return `<span class="tok err" title="${esc(label)} — ${esc(seg.error)}">${esc(seg.raw)}</span>`;
    }
    // A bonus always shows its sign. It is a change to a number somewhere
    // else, and a bare "2" in the middle of a sentence does not say whether
    // the sentence is helping or hurting.
    const shown = seg.kind !== 'push' ? formatValue(seg.value)
      : seg.values ? eachShown(seg) : fmt(seg.value);
    const dormant = inactive && seg.kind === 'push';
    const title = tokenTitle(model, seg, scopeOnce(), local)
      + (dormant ? `\n\n${inactiveTitle || 'Not applying: this is written down but switched off.'}` : '');
    return `<span class="tok ${seg.kind}${dormant ? ' off' : ''}" title="${esc(title)}">${esc(shown)}</span>`;
  }).join('');
}
