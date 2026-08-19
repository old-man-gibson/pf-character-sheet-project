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
 * Collect every name the prose *reads*: a {name} reference, and each variable
 * inside a {= expr} or {name = expr}.
 *
 * This is the other half of collectDefinitions, and it is what makes a name
 * whose definition has been deleted findable: the definition is gone, so
 * nothing lists it any more, but every place still asking for it is here.
 *
 * @param sources  array of {path, text, scope}
 * @returns [{name, path, scope, kind, source}] -- kind is 'ref' or 'expr'
 */
export function collectUses(sources) {
  const out = [];
  for (const { path, text, scope } of sources) {
    if (!hasTokens(text)) continue;
    for (const t of tokenize(text)) {
      if (t.kind === 'ref') {
        out.push({ name: t.name, path, scope, kind: 'ref', source: t.raw });
        continue;
      }
      if (t.kind !== 'value' && t.kind !== 'define') continue;
      let names = [];
      try {
        names = collectReferences(parse(t.expr)).variables;
      } catch {
        continue;   // a formula that does not parse is reported as itself, not as its names
      }
      for (const name of names) {
        // A definition naming itself is a cycle, reported as one; it is not a
        // use of some other name that has gone missing.
        if (t.kind === 'define' && name === t.name) continue;
        out.push({ name, path, scope, kind: 'expr', source: t.expr });
      }
    }
  }
  return out;
}

/**
 * Resolve named definitions against a base scope, in dependency order.
 * Returns { values, errors, duplicates, failed }.
 *
 * Definitions may reference each other and any base-scope value. Nothing here
 * throws: a cycle, a duplicate and a missing reference all come back as
 * errors against the definition that caused them.
 *
 * **The first definition of a name wins.** Order matters only when a name is
 * defined twice, which is a mistake either way -- but it has to be settled
 * *somehow*, and settling it in favour of the one already there means that
 * pasting in a new class page cannot silently change what an existing name is
 * worth. Every definition of a duplicated name is flagged, on both sides, and
 * `duplicates` says which one is in force so a reader can be told where the
 * other one is rather than left to find it.
 */
export function resolveDefinitions(defs, baseScope) {
  const values = {};
  const errors = [];
  const byName = new Map();
  const clashes = new Map();      // name -> every definition of it, in order
  for (const d of defs) {
    if (!byName.has(d.name)) byName.set(d.name, d);
    if (!clashes.has(d.name)) clashes.set(d.name, []);
    clashes.get(d.name).push(d);
  }

  // A duplicated name is reported against every one of its definitions, so
  // neither of them looks fine while the other carries the warning.
  const duplicates = [];
  for (const [name, group] of clashes) {
    if (group.length < 2) continue;
    duplicates.push({
      name,
      inForce: group[0].path,
      definitions: group.map((d) => ({ path: d.path, expr: d.expr })),
    });
    group.forEach((d, i) => errors.push({
      name,
      path: d.path,
      error: i === 0
        ? `"${name}" is defined ${group.length} times. This first one is the one in force; the others are ignored.`
        : `"${name}" is already defined elsewhere, and that definition is the one in force. This one is ignored.`,
      duplicate: true,
      inForce: i === 0,
    }));
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

  const state = new Map();   // name -> 'pending' | 'done' | 'failed' | 'cycle'
  const fail = (name, path, error) => {
    errors.push({ name, path, error });
    state.set(name, 'failed');
  };

  /**
   * A cycle is one fault, not one per name in it: every member is stopped and
   * told the same thing -- the whole loop, spelt out -- rather than the one
   * that happened to be visited first getting "circular" and the rest getting
   * "unknown value", which reads like three unrelated problems.
   */
  const markCycle = (name, stack) => {
    const at = stack.indexOf(name);
    const members = [...(at >= 0 ? stack.slice(at) : stack), name];
    const text = `Circular definition: ${members.join(' → ')}. Nothing in the loop can be worked out `
      + 'until one of them stops depending on the next.';
    for (const m of new Set(members)) {
      if (state.get(m) === 'cycle') continue;
      errors.push({ name: m, path: byName.get(m)?.path, error: text, cycle: members });
      state.set(m, 'cycle');
    }
  };

  const evalOne = (name, stack) => {
    const st = state.get(name);
    if (st === 'done' || st === 'failed' || st === 'cycle') return;
    if (st === 'pending') { markCycle(name, stack); return; }
    const d = byName.get(name);
    if (!d) return;
    state.set(name, 'pending');
    let refs = [];
    try {
      refs = collectReferences(parse(d.expr)).variables;
    } catch (err) {
      fail(name, d.path, err.message);
      return;
    }
    for (const r of refs) {
      if (byName.has(r) && r !== name) evalOne(r, [...stack, name]);
    }
    // The recursion above may have found this name in a cycle, in which case
    // evaluating it would only produce a second, less useful complaint.
    if (state.get(name) === 'cycle') return;
    try {
      const v = evaluateFormula(d.expr, d.scope ? scopeFor(d.scope) : scope);
      values[name] = v;
      state.set(name, 'done');
    } catch (err) {
      // "Unknown value X" where X is a definition that itself failed is a
      // knock-on, not a missing name: say which one to go and fix.
      const missing = /^Unknown value "([^"]+)"$/.exec(err.message)?.[1];
      const knockOn = missing && byName.has(missing) && state.get(missing) !== 'done';
      fail(name, d.path, knockOn
        ? `Depends on "${missing}", which is not working.`
        : err.message);
    }
  };
  for (const name of byName.keys()) evalOne(name, []);

  // A duplicated name resolves to its first definition, and the ignored ones
  // must not publish a value of their own.
  const failed = [...state.entries()]
    .filter(([, st]) => st !== 'done')
    .map(([name]) => name);
  return { values, errors, duplicates, failed };
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
