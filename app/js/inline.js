/**
 * inline.js -- formulas embedded in prose.
 *
 *   {= expr}          inline value: evaluate and display the result
 *   {name = expr}     named value: evaluate, display, and define `name`
 *                     for use anywhere on the character
 *   {name}            reference: display a previously named value
 *   {dest += expr}    forwarded bonus: evaluate, display, and add the answer
 *                     to `dest` -- a skill, a save, AC, an attack
 *   {?Label | a, expr | b, expr}
 *                     question: a choice the sheet cannot make, because it is
 *                     the player's to make at the moment of rolling
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
 * The fifth does neither: it asks. Some rules end in a decision rather than a
 * number -- Deathgrip Gauntlets turn as much of your own blood as you like
 * into damage -- and a sheet that picks for you is wrong every time but one.
 * So the sheet reads the *first* answer, which keeps every printed total a
 * number, and the roll it hands to the table carries the question itself.
 * See roll20.js, which turns one of these into Roll20's `?{…}`.
 *
 * All evaluation goes through the same sandbox as trackers (formula.js), so
 * inline formulas can only read character values and the whitelisted
 * functions -- never the page.
 */

import {
  parse, evaluateFormula, collectReferences, resolvePath, FormulaError,
} from './formula.js';

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

/**
 * A question, and the answers on offer: `{?Label | Spend nothing, 0 | 1 HP, 2}`.
 *
 * The label runs to the first bar; each bar after it introduces one answer,
 * written "what to call it, what it is worth". An answer with no comma is its
 * own expression, which is how Roll20 lets a dropdown's label stand as its
 * value and how `{?Bonus | 0 | 2 | 4}` says three plain numbers.
 *
 * One answer and no comma anywhere is not a list at all but a free number with
 * a default -- `{?Extra damage | 0}` -- the form to reach for when the answers
 * are not a short list. Roll20 spells that one `?{Extra damage|0}`, and the
 * difference between the two is exactly this: whether there is a comma.
 *
 * `expr` is the first answer either way, because something has to be the
 * number the sheet prints, and the first answer is the one a player writes
 * first: the ordinary case, the one where the ability is not being used.
 *
 * Returns null when the text is not a question, so parseToken can go on to
 * read it as one of the four older forms.
 */
export function parseQuery(inner, raw = `{${inner}}`) {
  const s = String(inner).trim();
  if (!s.startsWith('?')) return null;
  const parts = s.slice(1).split('|');
  const label = parts.shift().trim();
  const options = parts.map((p) => {
    const at = p.indexOf(',');
    const text = at < 0 ? p.trim() : p.slice(at + 1).trim();
    return { label: at < 0 ? p.trim() : p.slice(0, at).trim(), expr: text };
  }).filter((o) => o.expr);
  const free = options.length <= 1 && !parts.some((p) => p.includes(','));
  return {
    kind: 'query',
    label,
    free,
    options: free ? [] : options,
    // A free question with nothing after the bar still opens on something.
    expr: options[0]?.expr || '0',
    raw,
  };
}

function parseToken(inner, raw) {
  const s = inner.trim();
  // {= expr}
  if (s.startsWith('=')) return { kind: 'value', expr: s.slice(1).trim(), raw };

  // {?Deathgrip Gauntlets | Spend nothing, 0 | 1 HP, 2}
  const query = parseQuery(s, raw);
  if (query) return query;

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

/* -------------------------------------------------------------- *
 * `target`: the place a bonus is landing
 *
 * "A -2 penalty on skills with which you are untrained" is one rule about
 * every skill, and whether it applies is a question about each of them in
 * turn. Written as one bonus to one number it could not be said at all; as
 * forty bonuses it would be forty copies of one sentence, each going stale on
 * its own. So a bonus may name the destination it is landing on, `target`,
 * and one that does is worked out once for every destination it reaches:
 *
 *   {skill -= if(target.ranks == 0, 2, 0)}
 *
 * `target.<part>` is the part a formula would read off the destination by
 * name -- `target.ranks` landing on Bluff is `skill.bluff.ranks` -- and
 * `target` on its own is the destination's own number, where the sheet has
 * worked it out before the bonuses arrive. What each kind of destination has
 * to offer is the model's business (see targetFacts in model/scope.js); the
 * shape handed over here is `{ kind, values, late }`, with `kind` saying what
 * the destination is in words ("a skill") for the messages below.
 * -------------------------------------------------------------- */

/** `target` and `target.<part>`, in any case -- `Target.Ranks` reads like `target.ranks`. */
const TARGET_NAME_RE = /^target(?:\.(.+))?$/i;

/** What a formula outside a bonus is told when it reads `target`. */
export const TARGET_OUTSIDE = '"target" only means something inside a bonus — '
  + '{skill -= if(target.ranks == 0, 2, 0)} — where it is the destination the bonus is '
  + 'landing on. Anywhere else, name the value itself: skill.bluff.ranks.';

/** Is this `target` or one of its parts? */
export const isTargetName = (name) => TARGET_NAME_RE.test(String(name));

/**
 * Does a formula read `target`, and so need working out once per destination?
 * A formula that does not parse reads nothing; working it out says why.
 */
export function readsTarget(expr) {
  try {
    return collectReferences(parse(expr)).variables.some(isTargetName);
  } catch {
    return false;
  }
}

const capitalise = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** "target.ranks and target.classSkill", or why there is nothing to list. */
function offered(t) {
  const names = Object.keys(t.values || {}).map((k) => `target.${k}`);
  if (!names.length) {
    return ' Its numbers are worked out after the bonuses sent to it, so there is nothing on it '
      + 'a bonus can read.';
  }
  const list = names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return ` It offers ${list}.`;
}

/**
 * One read of `target`, or a message that says what to read instead.
 *
 * A destination the sheet only totals once its bonuses are in -- a skill, a
 * weapon, a tracker -- has no number of its own to give, and saying so is
 * better than handing over last edit's total: that total already has this
 * bonus in it, and a rule reading it would chase itself a little further on
 * every keystroke.
 */
function targetValue(t, part) {
  const values = t.values || {};
  if (!part || (part.toLowerCase() === 'total' && t.late)) {
    if (!t.late && typeof values.total === 'number') return values.total;
    throw new FormulaError(`"target" on its own is the number this bonus is added to, and for `
      + `${t.kind} that is only worked out once the bonuses have arrived.${offered(t)}`);
  }
  const v = resolvePath(values, part);
  if (v !== undefined) return v;
  throw new FormulaError(`${capitalise(t.kind)} has no "${part}" to read.${offered(t)}`);
}

/**
 * The one lookup every formula in prose resolves through: the names the
 * character defines, then whatever only exists where the text was written (a
 * veil's own `essence.self`, a tracker note's `self`), then the character.
 * Local before the character so a veil's `essence.self` is found even though
 * the character has an `essence` of its own with no `self` in it.
 *
 * `target` is the destination a bonus is landing on, when there is one. A
 * definition, a shown value or a question has none, and is told so by name
 * rather than being told that `target.ranks` does not exist.
 */
export function proseScope(names, local, base, target = null) {
  return {
    lookup: (n) => {
      if (Object.prototype.hasOwnProperty.call(names || {}, n)) return names[n];
      const t = TARGET_NAME_RE.exec(n);
      if (t && target) return targetValue(target, t[1]);
      if (local) {
        const v = resolvePath(local, n);
        if (v !== undefined) return v;
      }
      const v = resolvePath(base, n);
      if (v === undefined && t) throw new FormulaError(TARGET_OUTSIDE);
      return v;
    },
  };
}

/**
 * What a bonus's formula comes to, signed. Truncated towards zero rather than
 * floored: a bonus of 2.5 is +2 and a penalty of 2.5 is -2, where flooring
 * would quietly make the penalty the harsher of the two. Never -0, which a
 * penalty of nothing would otherwise be, and which prints as a minus sign.
 */
function amount(expr, scope, sign) {
  return (Math.trunc(Number(evaluateFormula(expr, scope)) || 0) * sign) || 0;
}

/**
 * A bonus that reads `target`, worked out once for each place it lands.
 *
 * `values` holds what each destination receives, and `failed` why any could
 * not be worked out -- "target.ranks" aimed at a save as well as a skill
 * fails on the save and still lands on the skill. `value` is the one number
 * a sentence can show: the amount most of the destinations got, leaving out
 * the ones that got nothing, because "-2" is what a penalty on untrained
 * skills comes to and the trained ones taking none of it is the rule working.
 */
export function amountsPerTarget(expr, sign, lands, scopeFor, targetOf) {
  const values = {};
  const failed = {};
  for (const key of lands) {
    try {
      values[key] = amount(expr, scopeFor(targetOf(key)), sign);
    } catch (err) {
      failed[key] = err.message;
    }
  }
  const counts = new Map();
  for (const v of Object.values(values)) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let value = 0;
  let most = 0;
  for (const [v, n] of counts) if (n > most) { value = v; most = n; }
  return { value, values, failed };
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
  for (const { path, text, scope, future } of sources) {
    // A level the character has not reached yet. Its text still resolves and
    // still displays -- the plan is meant to be readable ahead of time -- but
    // a bonus written there has not been earned, so it does not apply.
    if (future || !hasTokens(text)) continue;
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
      if (t.kind !== 'value' && t.kind !== 'define' && t.kind !== 'push' && t.kind !== 'query') continue;
      // A question is all of its answers at once. An answer reading a name
      // that has gone missing is as broken as any other formula, and it is no
      // less broken for being the answer nobody usually picks -- which is
      // exactly the one that would otherwise go unnoticed until it was needed.
      const exprs = t.kind === 'query' && t.options.length
        ? t.options.map((o) => o.expr) : [t.expr];
      let names = [];
      try {
        names = [...new Set(exprs.flatMap((e) => collectReferences(parse(e)).variables))];
      } catch {
        continue;   // a formula that does not parse is reported as itself, not as its names
      }
      for (const name of names) {
        // A definition naming itself is a cycle, reported as one; it is not a
        // use of some other name that has gone missing.
        if (t.kind === 'define' && name === t.name) continue;
        // Nor is a bonus reading its own destination. Whether that destination
        // has the part asked for is a question about each one it lands on,
        // answered when the bonus is worked out -- not a name to look up.
        if (t.kind === 'push' && isTargetName(name)) continue;
        out.push({ name, path, scope, kind: 'expr', source: t.kind === 'query' ? t.raw : t.expr });
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

  // Resolution order: other definitions, then whatever local scope the text
  // was written in, then the character -- see proseScope.
  const scopeFor = (local) => proseScope(values, local, baseScope);
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
 * A bonus that reads `target` is worked out once per destination it lands on
 * (see amountsPerTarget), and each destination's list holds a copy of the
 * entry carrying that destination's own amount -- so the stacking below, and
 * every badge that explains a number, sees what that number actually got.
 *
 * @param contributions  from collectContributions()
 * @param names          the resolved {name = …} values
 * @param baseScope      the character's own values
 * @param targets        {expand(name), known(name), targetOf(key, scope)} --
 *                       see the model's forwardTargets(). `expand` turns a
 *                       destination into the concrete places it lands (so
 *                       `skill` becomes every skill) and returns null for
 *                       anything unforwardable; `targetOf` is what `target`
 *                       reads at one of those places.
 */
export function resolveContributions(contributions, names, baseScope, targets) {
  const expand = targets?.expand || (() => null);
  const known = targets?.known || (() => false);
  const targetOf = targets?.targetOf ? (key) => targets.targetOf(key, baseScope) : null;
  const totals = {};
  const entries = [];
  const errors = [];
  const by = {};              // destination -> every bonus aimed at it, in order
  const countedAt = {};       // destination -> the subset of those that stack

  for (const c of contributions) {
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
    const landed = [...new Set(lands)];

    let value = 0;
    let error = null;
    let each = null;
    if (targetOf && readsTarget(c.expr)) {
      each = amountsPerTarget(c.expr, c.sign, landed,
        (target) => proseScope(names, c.scope, baseScope, target), targetOf);
      value = each.value;
      // One complaint per thing wrong, not one per skill it was wrong on: a
      // misspelt part is misspelt forty times over and is one fix. Where it
      // went wrong everywhere, the bonus is not working at all and says so.
      const why = [...new Set(Object.values(each.failed))];
      if (why.length && !Object.keys(each.values).length) error = why[0];
      for (const w of why) errors.push({ path: c.path, error: w, source: c.raw });
    } else {
      try {
        value = amount(c.expr, proseScope(names, c.scope, baseScope), c.sign);
      } catch (err) {
        error = err.message;
        errors.push({ path: c.path, error, source: c.raw });
      }
    }

    // A bonus with nowhere at all to go is not working, and must say so where
    // it is listed rather than sitting in the list looking as though it
    // arrived. One that lands somewhere and not somewhere else still counts
    // for the part that landed, and names the part that did not.
    const entry = {
      ...c,
      value,
      error: error || (dropped.length && !landed.length ? `Goes nowhere: ${dropped.join(', ')}` : null),
      dropped,
      lands: each ? landed.filter((key) => !(key in each.failed)) : landed,
      ...(each ? { values: each.values, failed: each.failed } : {}),
    };
    entries.push(entry);
    if (!error) {
      for (const key of entry.lands) {
        (by[key] ||= []).push(each ? { ...entry, value: each.values[key] } : entry);
      }
    }
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

  // The destinations go back with the answers: a sentence showing one of these
  // bonuses has to work it out against the same places, and what `target` read
  // at each is remembered there (see forwardTargets), so it shows the amount
  // that arrived rather than one worked out against the sheet a pass later.
  return { totals, entries, errors, by, countedAt, targets: targets || null };
}

/**
 * Evaluate the tokens in one text, given the resolved names and base scope.
 * Returns segments with `.value` / `.error` filled in for token segments.
 *
 * `local` is scope that only exists where this text was written -- a veil's
 * own invested essence -- and is looked up ahead of the character's, matching
 * the order `resolveDefinitions` uses.
 *
 * `targets` is the model's forwardTargets(), for a bonus that reads `target`:
 * one of those is worked out for every destination it lands on, exactly as
 * resolveContributions() does it, and carries `values` -- what each got --
 * beside the one `value` the sentence shows.
 */
export function renderTokens(text, names, baseScope, local = null, targets = null) {
  const scope = proseScope(names, local, baseScope);
  return tokenize(text).map((seg) => {
    if (seg.kind === 'text') return seg;
    if (seg.kind === 'ref') {
      let v;
      try {
        v = scope.lookup(seg.name);
      } catch (err) {
        return { ...seg, error: err.message };
      }
      return v === undefined
        ? { ...seg, error: `Unknown value "${seg.name}"` }
        : { ...seg, value: v };
    }
    if (seg.kind === 'define' && Object.prototype.hasOwnProperty.call(names, seg.name)) {
      return { ...seg, value: names[seg.name] };
    }
    try {
      // A forwarded bonus shows the amount it sends, sign and all, worked out
      // exactly as resolveContributions() works it out -- the number in the
      // sentence is the number the destination receives, or the sentence is
      // lying about what the rule does.
      if (seg.kind === 'push' && targets?.targetOf && readsTarget(seg.expr)) {
        const lands = [...new Set(seg.targets.flatMap((t) => targets.expand(t) || []))];
        if (!lands.length) return { ...seg, error: `Goes nowhere: ${seg.targets.join(', ')}` };
        const each = amountsPerTarget(seg.expr, seg.sign, lands,
          (target) => proseScope(names, local, baseScope, target),
          (key) => targets.targetOf(key, baseScope));
        if (!Object.keys(each.values).length) return { ...seg, error: Object.values(each.failed)[0] };
        return { ...seg, value: each.value, values: each.values, failed: each.failed };
      }
      if (seg.kind === 'push') return { ...seg, value: amount(seg.expr, scope, seg.sign) };
      return { ...seg, value: evaluateFormula(seg.expr, scope) };
    } catch (err) {
      return { ...seg, error: err.message };
    }
  });
}

/** Format a computed token value for display. */
/**
 * Rendered segments as plain characters -- what a field that is both prose
 * and a value reads as.
 *
 * The defence boxes are the case that wanted it: "DR {= 5 + floor(level/2)}/magic"
 * has to show as a sentence and parse as a reduction, and working that out
 * twice is how the two come to disagree. The one function serves both the
 * model, which parses the result, and the view, which puts it on a tooltip.
 *
 * A token that failed keeps its source, so a broken formula shows up as the
 * thing that is broken rather than vanishing into a 0. A forwarded bonus
 * contributes nothing: it is a number about somewhere else, and it has no
 * business in the value of the field it was written in.
 */
export function plainTokens(segments) {
  return (segments || []).map((seg) => {
    if (seg.kind === 'text') return seg.text;
    if (seg.kind === 'push') return '';
    if (seg.error) return seg.raw;
    return formatValue(seg.value);
  }).join('');
}

export function formatValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v ?? '');
}
