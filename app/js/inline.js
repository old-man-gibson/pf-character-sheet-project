/**
 * inline.js -- formulas embedded in prose.
 *
 *   {= expr}          inline value: evaluate and display the result
 *   {name = expr}     named value: evaluate, display, and define `name`
 *                     for use anywhere on the character
 *   {name}            reference: display a previously named value
 *
 * Everything outside the braces is ordinary text. Names may be dotted labels
 * (arms.hp, qi.max) and can reference each other; definitions are resolved
 * in dependency order regardless of where on the sheet they are written.
 *
 * All evaluation goes through the same sandbox as trackers (formula.js), so
 * inline formulas can only read character values and the whitelisted
 * functions -- never the page.
 */

import { parse, evaluateFormula, collectReferences, resolvePath } from './formula.js';

const TOKEN_RE = /\{([^{}]*)\}/g;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/** Split prose into text and token segments. */
export function tokenize(text) {
  const src = String(text ?? '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    out.push(parseToken(m[1], m[0]));
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

function parseToken(inner, raw) {
  const s = inner.trim();
  // {= expr}
  if (s.startsWith('=')) return { kind: 'value', expr: s.slice(1).trim(), raw };
  const eq = s.indexOf('=');
  if (eq > 0) {
    const name = s.slice(0, eq).trim();
    const expr = s.slice(eq + 1).trim();
    if (NAME_RE.test(name)) return { kind: 'define', name, expr, raw };
    return { kind: 'value', expr: s, raw };   // "a+b = c" is not a definition
  }
  if (NAME_RE.test(s)) return { kind: 'ref', name: s, raw };
  return { kind: 'value', expr: s, raw };
}

/** Does this text contain any inline tokens? Cheap pre-check. */
export function hasTokens(text) {
  return /\{[^{}]*\}/.test(String(text ?? ''));
}

/**
 * Collect every {name = expr} definition from a set of prose sources.
 * @param sources  array of {path, text}
 */
export function collectDefinitions(sources) {
  const defs = [];
  for (const { path, text, scope } of sources) {
    if (!hasTokens(text)) continue;
    for (const t of tokenize(text)) {
      // `scope` carries whatever only makes sense where the text was written
      // -- a veil's own invested essence, say -- so a definition can use it
      // and not just a displayed value.
      if (t.kind === 'define') defs.push({ name: t.name, expr: t.expr, path, scope });
    }
  }
  return defs;
}

/**
 * Resolve named definitions against a base scope, in dependency order.
 * Returns { values: {name: value}, errors: [{name, path, error}] }.
 *
 * Definitions may reference each other and any base-scope value. Cycles and
 * unresolvable references surface as errors rather than throwing; duplicate
 * names are flagged and the last definition wins.
 */
export function resolveDefinitions(defs, baseScope) {
  const values = {};
  const errors = [];
  const byName = new Map();
  for (const d of defs) {
    if (byName.has(d.name)) {
      errors.push({ name: d.name, path: d.path, error: `"${d.name}" is defined more than once` });
    }
    byName.set(d.name, d);
  }

  /**
   * Resolution order: other definitions, then whatever local scope the text
   * was written in, then the character. Local comes before the character so a
   * veil's `essence.self` is found even though the character has an `essence`
   * of its own with no `self` in it.
   */
  const scopeFor = (local) => ({
    lookup: (name) => {
      if (Object.prototype.hasOwnProperty.call(values, name)) return values[name];
      if (local) {
        const v = resolvePath(local, name);
        if (v !== undefined) return v;
      }
      return resolvePath(baseScope, name);
    },
  });
  const scope = scopeFor(null);

  const state = new Map();   // name -> 'pending' | 'done' | 'failed'
  const evalOne = (name, stack) => {
    const st = state.get(name);
    if (st === 'done' || st === 'failed') return;
    if (st === 'pending') {
      const cycle = [...stack, name].join(' → ');
      errors.push({ name, path: byName.get(name)?.path, error: `Circular definition: ${cycle}` });
      state.set(name, 'failed');
      return;
    }
    const d = byName.get(name);
    if (!d) return;
    state.set(name, 'pending');
    let refs = [];
    try {
      refs = collectReferences(parse(d.expr)).variables;
    } catch (err) {
      errors.push({ name, path: d.path, error: err.message });
      state.set(name, 'failed');
      return;
    }
    for (const r of refs) {
      if (byName.has(r) && r !== name) evalOne(r, [...stack, name]);
    }
    try {
      const v = evaluateFormula(d.expr, d.scope ? scopeFor(d.scope) : scope);
      values[name] = v;
      state.set(name, 'done');
    } catch (err) {
      errors.push({ name, path: d.path, error: err.message });
      state.set(name, 'failed');
    }
  };
  for (const name of byName.keys()) evalOne(name, []);
  return { values, errors };
}

/**
 * Evaluate the tokens in one text, given the resolved names and base scope.
 * Returns segments with `.value` / `.error` filled in for token segments.
 *
 * `local` is scope that only exists where this text was written -- a veil's
 * own invested essence -- and is looked up ahead of the character's, matching
 * the order `resolveDefinitions` uses.
 */
export function renderTokens(text, names, baseScope, local = null) {
  const scope = {
    lookup: (n) => {
      if (Object.prototype.hasOwnProperty.call(names, n)) return names[n];
      if (local) {
        const v = resolvePath(local, n);
        if (v !== undefined) return v;
      }
      return resolvePath(baseScope, n);
    },
  };
  return tokenize(text).map((seg) => {
    if (seg.kind === 'text') return seg;
    if (seg.kind === 'ref') {
      const v = scope.lookup(seg.name);
      return v === undefined
        ? { ...seg, error: `Unknown value "${seg.name}"` }
        : { ...seg, value: v };
    }
    if (seg.kind === 'define' && Object.prototype.hasOwnProperty.call(names, seg.name)) {
      return { ...seg, value: names[seg.name] };
    }
    try {
      return { ...seg, value: evaluateFormula(seg.expr, scope) };
    } catch (err) {
      return { ...seg, error: err.message };
    }
  });
}

/** Format a computed token value for display. */
export function formatValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v ?? '');
}
