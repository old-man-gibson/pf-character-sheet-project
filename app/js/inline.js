/**
 * inline.js -- formulas embedded in prose.
 *
 *   {= expr}          inline value: evaluate and display the result
 *   {name = expr}     named value: evaluate, display, and define `name`
 *                     for use anywhere on the character
 *   {name}            reference: display a previously named value
 *   {dest += expr}    forwarded bonus: evaluate, display, and add the answer
 *                     to `dest` -- a skill, a save, AC, an attack
 *
 * Everything outside the braces is ordinary text. Names may be dotted labels
 * (arms.hp, qi.max) and can reference each other; definitions are resolved
 * in dependency order regardless of where on the sheet they are written.
 *
 * The first three forms all *publish*: something else has to go and read them.
 * The fourth pushes the other way, and exists because the alternative is
 * writing one rule in six places. "Mythic Social Grace adds your tier to the
 * skills Social Grace picked" is one sentence in the rulebook and should be
 * one formula on the sheet, sitting in the feature that says it -- not the
 * same expression copied into the Misc column of every skill it touches,
 * where nothing says where it came from and nothing moves the other five when
 * the rule is read again.
 *
 * All evaluation goes through the same sandbox as trackers (formula.js), so
 * inline formulas can only read character values and the whitelisted
 * functions -- never the page.
 */

import { parse, evaluateFormula, collectReferences, resolvePath } from './formula.js';

const TOKEN_RE = /\{([^{}]*)\}/g;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
// "dest += expr" / "dest -= expr". The left side may not contain "=" at all,
// so ">=", "<=", "!=" and "==" can never be mistaken for the operator, and
// "*=" is not offered: a bonus adds to a stat, it does not scale one.
const PUSH_RE = /^([^=]*?)([+-])=([\s\S]*)$/;
// The long spelling, out of the same habit that writes "=" for "==": say what
// the destination is rather than leaning on two characters of punctuation.
const TARGET_RE = /^target\./;
// "... as size" on the end of a forwarded bonus names its type, the way the
// rulebook says it: "a +2 size bonus to Strength". A trailing word after the
// whole expression, because the type belongs to the bonus rather than to any
// one of the destinations it may be aimed at.
//
// "as temp.size" is the same bonus said to be a temporary one, which is a
// question the sheet asks of an ability score and keeps two columns for: a
// permanent bonus moves the score, a temporary one moves only the working
// score every derived number is built from.
const AS_RE = /\s+as\s+([A-Za-z][A-Za-z0-9_.-]*)\s*$/;

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

/**
 * The left-hand side of a forwarded bonus: one destination, or several
 * separated by commas, because the whole point of the form is not writing the
 * same expression twice. Each may carry the `target.` keyword or not.
 *
 * Returns null when the text is not a destination list at all, so the caller
 * can fall back to the older readings of the token rather than turning a
 * typo into a bonus aimed at nothing.
 */
function parseTargets(left, { keyword = false } = {}) {
  const parts = String(left).split(',').map((p) => p.trim());
  if (!parts.length || parts.some((p) => !NAME_RE.test(p))) return null;
  // `{target.x = 1}` is a bonus; `{x = 1}` is a definition, and always was.
  if (keyword && !TARGET_RE.test(parts[0])) return null;
  return parts.map((p) => p.replace(TARGET_RE, ''));
}

/** Split "expr as temp.size" into the expression, its type, and when it applies. */
function parseType(expr) {
  const m = AS_RE.exec(expr);
  const raw = m ? m[1].toLowerCase() : '';
  const temporary = raw === 'temp' || raw.startsWith('temp.');
  return {
    expr: m ? expr.slice(0, m.index).trim() : expr.trim(),
    // "as temp" on its own says *when*, not *what kind*, so it is untyped and
    // two of them stack the way two untyped bonuses do. "as temp.size" keeps
    // the whole string as its type, which is what makes a temporary size bonus
    // a different thing from a permanent one -- the sheet has a column for
    // each, and they add.
    type: raw === 'temp' ? '' : raw,
    temporary,
  };
}

function parseToken(inner, raw) {
  const s = inner.trim();
  // {= expr}
  if (s.startsWith('=')) return { kind: 'value', expr: s.slice(1).trim(), raw };

  // {skill.bluff += 4}, {saves.will -= 2}, {skill.bluff, skill.diplomacy += tier},
  // {str.score += 2 as size}
  const push = PUSH_RE.exec(s);
  if (push) {
    const targets = parseTargets(push[1]);
    if (targets) {
      return {
        kind: 'push', targets, sign: push[2] === '-' ? -1 : 1, raw, ...parseType(push[3]),
      };
    }
  }

  const eq = s.indexOf('=');
  if (eq > 0) {
    const name = s.slice(0, eq).trim();
    const expr = s.slice(eq + 1).trim();
    // {target.skill.bluff = 4} -- the same bonus, spelled the long way.
    const targets = parseTargets(name, { keyword: true });
    if (targets) return { kind: 'push', targets, sign: 1, raw, ...parseType(expr) };
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
  for (const { path, text, scope, forwardsOnly } of sources) {
    if (forwardsOnly || !hasTokens(text)) continue;
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
 * Collect every forwarded bonus from a set of prose sources, in the order
 * they are written.
 *
 * Unlike a definition, two of these are not a clash: a skill can be handed a
 * bonus by a class feature, a trait and a veil at once, and all three count.
 *
 * `forwardsOnly` sources are included here and nowhere else -- a tracker note
 * is read too late to publish a name, but a bonus is not a name, and the note
 * beside a resource is exactly where a rule that scales with it belongs.
 * @param sources  array of {path, text, scope, forwardsOnly}
 */
export function collectContributions(sources) {
  const out = [];
  for (const { path, text, scope } of sources) {
    if (!hasTokens(text)) continue;
    for (const t of tokenize(text)) {
      if (t.kind === 'push') {
        out.push({
          targets: t.targets,
          sign: t.sign,
          expr: t.expr,
          type: t.type || '',
          temporary: !!t.temporary,
          path,
          scope,
          raw: t.raw,
        });
      }
    }
  }
  return out;
}

/**
 * Collect every name the prose *reads*: a {name} reference, and each variable
 * inside a {= expr}, {name = expr} or {dest += expr}.
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
  for (const { path, text, scope, forwardsOnly } of sources) {
    if (forwardsOnly || !hasTokens(text)) continue;
    for (const t of tokenize(text)) {
      if (t.kind === 'ref') {
        out.push({ name: t.name, path, scope, kind: 'ref', source: t.raw });
        continue;
      }
      if (t.kind !== 'value' && t.kind !== 'define' && t.kind !== 'push') continue;
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
 * Work out every forwarded bonus and total them by destination.
 *
 * These are evaluated *after* the definitions, in the same layered scope the
 * prose itself reads in, so a bonus may be written in terms of the names the
 * character defines -- `{skill.bluff += social_grace}` -- and not only in
 * terms of what the sheet works out for itself.
 *
 * Nothing here throws and nothing is silently dropped. A bonus whose formula
 * does not parse, and a bonus aimed at something that cannot take one, both
 * come back as errors against the place they are written, because that is the
 * only place a player can go and fix them.
 *
 * A bonus may name its type -- "as size", "as morale" -- and then it does not
 * stack with another of the same type at the same destination: the largest
 * bonus and the largest penalty of each type count, and untyped ones all do.
 * The type is a stacking key and nothing else, so a house type works exactly
 * as a printed one does. Note that this settles forwarded bonuses against each
 * other only; a size bonus typed into the Stats tab's own Size column is a
 * different number in a different place, and the sheet adds both.
 *
 * @param contributions  from collectContributions()
 * @param names          the resolved {name = …} values
 * @param baseScope      the character's own values
 * @param targets        {expand(name), known(name)} -- see the model's
 *                       forwardTargets(). `expand` turns a destination into
 *                       the concrete places it lands (so `skill` becomes every
 *                       skill) and returns null for anything unforwardable.
 */
export function resolveContributions(contributions, names, baseScope, targets) {
  const expand = targets?.expand || (() => null);
  const known = targets?.known || (() => false);
  const totals = {};
  const entries = [];
  const errors = [];
  const by = {};              // destination -> every bonus aimed at it, in order
  const countedAt = {};       // destination -> the subset of those that stack

  const scopeFor = (local) => ({
    lookup: (n) => {
      if (Object.prototype.hasOwnProperty.call(names || {}, n)) return names[n];
      if (local) {
        const v = resolvePath(local, n);
        if (v !== undefined) return v;
      }
      return resolvePath(baseScope, n);
    },
  });
  const scope = scopeFor(null);

  for (const c of contributions) {
    let value = 0;
    let error = null;
    try {
      // Truncated towards zero rather than floored: a bonus of 2.5 is +2 and
      // a penalty of 2.5 is -2, where flooring would quietly make the penalty
      // the harsher of the two.
      value = Math.trunc(Number(evaluateFormula(c.expr, c.scope ? scopeFor(c.scope) : scope)) || 0) * c.sign;
    } catch (err) {
      error = err.message;
    }

    const lands = [];
    const dropped = [];
    for (const t of c.targets) {
      const into = expand(t);
      if (!into) {
        dropped.push(t);
        // Two different mistakes, told apart because the fixes differ: a
        // misspelling is fixed in the token, while a real value with nowhere
        // to put a bonus is not the player's mistake at all.
        errors.push({
          path: c.path,
          target: t,
          error: known(t)
            ? `"${t}" is a value you can read, but the sheet has nowhere to put a bonus to it.`
            : `"${t}" is not something a bonus can be forwarded to.`,
          source: c.raw,
        });
        continue;
      }
      lands.push(...into);
    }

    // A bonus with nowhere at all to go is not working, and must say so where
    // it is listed rather than sitting in the list looking as though it
    // arrived. One that lands somewhere and not somewhere else still counts
    // for the part that landed, and names the part that did not.
    if (error) errors.push({ path: c.path, error, source: c.raw });
    const entry = {
      ...c,
      value,
      error: error || (dropped.length && !lands.length ? `Goes nowhere: ${dropped.join(', ')}` : null),
      dropped,
      lands: [...new Set(lands)],
    };
    entries.push(entry);
    if (!error) for (const key of entry.lands) (by[key] ||= []).push(entry);
  }

  // Now the stacking, per destination. Untyped bonuses all count; within a
  // named type only the best bonus and the worst penalty do, which is the
  // whole reason for saying "as size" -- two size bonuses are one size bonus,
  // and the sheet has to know that without being told twice.
  //
  // The ones that lose are not dropped from the list. "Where did this number
  // come from" is answered badly by a source that has quietly vanished, so
  // every bonus stays, marked `counts: false` where a bigger one of its type
  // is already there.
  for (const [key, list] of Object.entries(by)) {
    let total = 0;
    const best = new Map();      // type -> the entry holding the largest bonus
    const worst = new Map();     // type -> the entry holding the largest penalty
    const counts = new Set();
    for (const e of list) {
      if (!e.type) { total += e.value; counts.add(e); continue; }
      const pick = e.value < 0 ? worst : best;
      const held = pick.get(e.type);
      // First one wins a tie, so the order a rule was written in decides which
      // of two identical bonuses is shown as the one in force -- arbitrary
      // either way, but stable, and it never changes under a later edit.
      if (!held || (e.value < 0 ? e.value < held.value : e.value > held.value)) pick.set(e.type, e);
    }
    for (const map of [best, worst]) {
      for (const e of map.values()) { total += e.value; counts.add(e); }
    }
    totals[key] = total;
    countedAt[key] = counts;
  }

  return { totals, entries, errors, by, countedAt };
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
      const v = evaluateFormula(seg.expr, scope);
      // A forwarded bonus shows the amount it sends, sign and all, worked out
      // exactly as resolveContributions() works it out -- the number in the
      // sentence is the number the destination receives, or the sentence is
      // lying about what the rule does.
      if (seg.kind === 'push') return { ...seg, value: Math.trunc(Number(v) || 0) * seg.sign };
      return { ...seg, value: v };
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
