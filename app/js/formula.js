/**
 * formula.js -- a small, sandboxed expression language.
 *
 * Players type formulas as plain text ("floor(con.mod * 2) + level"), so the
 * evaluator must never reach the host page. There is no eval() and no
 * Function() constructor anywhere in this file: source text is tokenised,
 * parsed into an AST, and walked. The only things a formula can touch are the
 * variables handed to it and the whitelisted functions below.
 *
 * Because formulas stay as text, an admin can read exactly what a player wrote
 * (see analyse(), which reports the dependencies a formula pulls in).
 */

const MAX_SOURCE_LENGTH = 500;
const MAX_NODES = 400;
const MAX_DEPTH = 40;

export class FormulaError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

/* ------------------------------------------------------------------ *
 * Tokeniser
 * ------------------------------------------------------------------ */

const PUNCTUATION = ['<=', '>=', '==', '!=', '&&', '||', '<', '>', '=',
  '+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':'];

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      if ((text.match(/\./g) || []).length > 1) {
        throw new FormulaError(`Malformed number "${text}"`, i);
      }
      tokens.push({ type: 'number', value: parseFloat(text), pos: i });
      i = j;
      continue;
    }

    // Identifiers may contain dots (str.mod) and underscores.
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < src.length && src[j] !== quote) { out += src[j]; j++; }
      if (j >= src.length) throw new FormulaError('Unterminated string', i);
      tokens.push({ type: 'string', value: out, pos: i });
      i = j + 1;
      continue;
    }

    const punct = PUNCTUATION.find((p) => src.startsWith(p, i));
    if (punct) {
      tokens.push({ type: 'punct', value: punct, pos: i });
      i += punct.length;
      continue;
    }

    throw new FormulaError(`Unexpected character "${ch}"`, i);
  }
  tokens.push({ type: 'end', value: null, pos: src.length });
  return tokens;
}

/* ------------------------------------------------------------------ *
 * Parser (precedence climbing)
 * ------------------------------------------------------------------ */

const BINARY_PRECEDENCE = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, '=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
  '^': 7,
};
const RIGHT_ASSOCIATIVE = new Set(['^']);

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
    this.nodes = 0;
  }

  peek() { return this.tokens[this.i]; }

  next() { return this.tokens[this.i++]; }

  expect(value) {
    const t = this.next();
    if (t.value !== value) {
      throw new FormulaError(`Expected "${value}" but found "${t.value ?? 'end of formula'}"`, t.pos);
    }
    return t;
  }

  count() {
    if (++this.nodes > MAX_NODES) {
      throw new FormulaError('Formula is too complex');
    }
  }

  parse() {
    const node = this.parseExpression(0);
    const t = this.peek();
    if (t.type !== 'end') {
      throw new FormulaError(`Unexpected "${t.value}" after end of formula`, t.pos);
    }
    return node;
  }

  parseExpression(minPrecedence) {
    let left = this.parseUnary();

    for (;;) {
      const t = this.peek();

      // Ternary: cond ? a : b
      if (t.type === 'punct' && t.value === '?' && minPrecedence <= 0) {
        this.next();
        const consequent = this.parseExpression(0);
        this.expect(':');
        const alternate = this.parseExpression(0);
        this.count();
        left = { kind: 'conditional', test: left, consequent, alternate };
        continue;
      }

      if (t.type !== 'punct') break;
      const precedence = BINARY_PRECEDENCE[t.value];
      if (precedence === undefined || precedence < minPrecedence) break;

      this.next();
      const nextMin = RIGHT_ASSOCIATIVE.has(t.value) ? precedence : precedence + 1;
      const right = this.parseExpression(nextMin);
      this.count();
      // "=" is accepted as a friendly alias for equality; players write it out
      // of spreadsheet habit and it is never an assignment here. `wrote` keeps
      // the spelling they used, so anything that prints the formula back can
      // show their text rather than a corrected version of it.
      const op = t.value === '=' ? '==' : t.value;
      left = { kind: 'binary', op, wrote: t.value, left, right };
    }

    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'punct' && (t.value === '-' || t.value === '+')) {
      this.next();
      const argument = this.parseUnary();
      this.count();
      return { kind: 'unary', op: t.value, argument };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.next();

    if (t.type === 'number') { this.count(); return { kind: 'number', value: t.value }; }
    if (t.type === 'string') { this.count(); return { kind: 'string', value: t.value }; }

    if (t.type === 'punct' && t.value === '(') {
      const node = this.parseExpression(0);
      this.expect(')');
      return node;
    }

    if (t.type === 'ident') {
      const nt = this.peek();
      if (nt.type === 'punct' && nt.value === '(') {
        this.next();
        const args = [];
        if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
          for (;;) {
            args.push(this.parseExpression(0));
            const sep = this.peek();
            if (sep.type === 'punct' && sep.value === ',') { this.next(); continue; }
            break;
          }
        }
        this.expect(')');
        this.count();
        return { kind: 'call', name: t.value.toLowerCase(), args, pos: t.pos };
      }
      this.count();
      return { kind: 'variable', name: t.value, pos: t.pos };
    }

    throw new FormulaError(`Unexpected ${t.type === 'end' ? 'end of formula' : `"${t.value}"`}`, t.pos);
  }
}

/* ------------------------------------------------------------------ *
 * Built-in functions
 * ------------------------------------------------------------------ */

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[+,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'false' && v.toLowerCase() !== 'no';
  return Boolean(v);
};

const flat = (args) => args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(toNumber);

export const FUNCTIONS = {
  // Rounding -- floor() is the workhorse of Pathfinder maths.
  floor: { arity: [1, 2], fn: (n, step = 1) => Math.floor(toNumber(n) / toNumber(step, 1)) * toNumber(step) },
  ceil: { arity: [1, 1], fn: (n) => Math.ceil(toNumber(n)) },
  round: { arity: [1, 2], fn: (n, d = 0) => { const p = 10 ** toNumber(d); return Math.round(toNumber(n) * p) / p; } },
  trunc: { arity: [1, 1], fn: (n) => Math.trunc(toNumber(n)) },
  abs: { arity: [1, 1], fn: (n) => Math.abs(toNumber(n)) },
  sign: { arity: [1, 1], fn: (n) => Math.sign(toNumber(n)) },

  // Aggregates
  min: { arity: [1, Infinity], fn: (...a) => Math.min(...flat(a)) },
  max: { arity: [1, Infinity], fn: (...a) => Math.max(...flat(a)) },
  sum: { arity: [0, Infinity], fn: (...a) => flat(a).reduce((x, y) => x + y, 0) },
  clamp: { arity: [3, 3], fn: (n, lo, hi) => Math.min(Math.max(toNumber(n), toNumber(lo)), toNumber(hi)) },

  // Logic
  if: { arity: [2, 3], fn: (c, a, b = 0) => (toBool(c) ? a : b) },
  and: { arity: [1, Infinity], fn: (...a) => a.every(toBool) },
  or: { arity: [1, Infinity], fn: (...a) => a.some(toBool) },
  not: { arity: [1, 1], fn: (a) => !toBool(a) },

  // Pathfinder helpers
  mod: { arity: [1, 1], fn: (score) => Math.floor((toNumber(score) - 10) / 2) },
  iterations: { arity: [1, 1], fn: (bab) => Math.max(1, Math.ceil(toNumber(bab) / 5)) },
  /** dice(4, 6) -> "4d6"; dice(4, 6, 3) -> "4d6+3". Produces dice text a
   *  weapon's Dice field or a [[…]] token can consume. */
  dice: {
    arity: [2, 3],
    fn: (n, d, bonus = 0) => {
      const count = Math.max(0, Math.floor(toNumber(n)));
      const size = Math.max(1, Math.floor(toNumber(d)));
      const b = Math.floor(toNumber(bonus));
      return `${count}d${size}${b ? (b > 0 ? `+${b}` : `${b}`) : ''}`;
    },
  },
};

/* ------------------------------------------------------------------ *
 * Evaluator
 * ------------------------------------------------------------------ */

function evaluate(node, scope, depth = 0) {
  if (depth > MAX_DEPTH) throw new FormulaError('Formula nested too deeply');

  switch (node.kind) {
    case 'number':
    case 'string':
      return node.value;

    case 'variable': {
      const value = scope.lookup(node.name);
      if (value === undefined) {
        throw new FormulaError(`Unknown value "${node.name}"`, node.pos);
      }
      return value;
    }

    case 'unary': {
      const v = evaluate(node.argument, scope, depth + 1);
      return node.op === '-' ? -toNumber(v) : toNumber(v);
    }

    case 'conditional':
      return toBool(evaluate(node.test, scope, depth + 1))
        ? evaluate(node.consequent, scope, depth + 1)
        : evaluate(node.alternate, scope, depth + 1);

    case 'binary': {
      const l = evaluate(node.left, scope, depth + 1);
      // Short-circuit so "hasFoo && 10/foo" cannot divide by zero needlessly.
      if (node.op === '&&') return toBool(l) ? toBool(evaluate(node.right, scope, depth + 1)) : false;
      if (node.op === '||') return toBool(l) ? true : toBool(evaluate(node.right, scope, depth + 1));

      const r = evaluate(node.right, scope, depth + 1);
      switch (node.op) {
        case '+':
          if (typeof l === 'string' || typeof r === 'string') return String(l) + String(r);
          return toNumber(l) + toNumber(r);
        case '-': return toNumber(l) - toNumber(r);
        case '*': return toNumber(l) * toNumber(r);
        case '/': {
          const d = toNumber(r);
          if (d === 0) throw new FormulaError('Division by zero');
          return toNumber(l) / d;
        }
        case '%': {
          const d = toNumber(r);
          if (d === 0) throw new FormulaError('Division by zero');
          return toNumber(l) % d;
        }
        case '^': return toNumber(l) ** toNumber(r);
        case '==': return typeof l === 'string' || typeof r === 'string' ? String(l) === String(r) : toNumber(l) === toNumber(r);
        case '!=': return typeof l === 'string' || typeof r === 'string' ? String(l) !== String(r) : toNumber(l) !== toNumber(r);
        case '<': return toNumber(l) < toNumber(r);
        case '>': return toNumber(l) > toNumber(r);
        case '<=': return toNumber(l) <= toNumber(r);
        case '>=': return toNumber(l) >= toNumber(r);
        default: throw new FormulaError(`Unsupported operator "${node.op}"`);
      }
    }

    case 'call': {
      const def = FUNCTIONS[node.name];
      if (!def) throw new FormulaError(`Unknown function "${node.name}()"`, node.pos);
      const [minArgs, maxArgs] = def.arity;
      if (node.args.length < minArgs || node.args.length > maxArgs) {
        const want = maxArgs === Infinity ? `at least ${minArgs}` :
          minArgs === maxArgs ? `${minArgs}` : `${minArgs}-${maxArgs}`;
        throw new FormulaError(`${node.name}() takes ${want} argument(s), got ${node.args.length}`, node.pos);
      }
      // if() must not evaluate the untaken branch.
      if (node.name === 'if') {
        return toBool(evaluate(node.args[0], scope, depth + 1))
          ? evaluate(node.args[1], scope, depth + 1)
          : (node.args[2] ? evaluate(node.args[2], scope, depth + 1) : 0);
      }
      const args = node.args.map((a) => evaluate(a, scope, depth + 1));
      return def.fn(...args);
    }

    default:
      throw new FormulaError(`Unsupported expression "${node.kind}"`);
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

const cache = new Map();

/** Parse source text into a reusable AST. Throws FormulaError on bad input. */
export function parse(source) {
  const src = String(source ?? '').trim();
  if (src.length > MAX_SOURCE_LENGTH) {
    throw new FormulaError(`Formula is too long (max ${MAX_SOURCE_LENGTH} characters)`);
  }
  if (!src) throw new FormulaError('Formula is empty');
  if (cache.has(src)) return cache.get(src);
  // A leading "=" is a spreadsheet habit; accept and ignore it.
  const body = src.startsWith('=') ? src.slice(1) : src;
  const ast = new Parser(tokenize(body)).parse();
  cache.set(src, ast);
  return ast;
}

/**
 * Evaluate `source` against a scope.
 * @param {string} source
 * @param {{lookup:(name:string)=>any}|object} scope  object or lookup-provider
 */
export function evaluateFormula(source, scope) {
  const provider = typeof scope?.lookup === 'function'
    ? scope
    : { lookup: (name) => resolvePath(scope, name) };
  return evaluate(parse(source), provider);
}

// Property names that would let a formula climb out of its scope object and
// reach host objects (Object, Function, the page). Never resolvable.
const BLOCKED_KEYS = new Set([
  '__proto__', 'prototype', 'constructor',
]);

/**
 * Whether a resolved branch is also a value: one carrying its own `total`.
 *
 * This is how a total can be broken into parts without the name that used to
 * mean the total coming to mean an object instead. `saves.will` is the save,
 * `saves.will.luck` is the part of it luck is worth, and neither had to be
 * renamed to make room for the other.
 */
export const carriesTotal = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.prototype.hasOwnProperty.call(v, 'total')
  && typeof v.total === 'number';

/** One key of a path. `fold` is what makes the second pass ignore case. */
function step(acc, key, fold) {
  if (acc == null || typeof acc !== 'object') return undefined;
  if (BLOCKED_KEYS.has(key.toLowerCase())) return undefined;
  let k = key;
  if (!Object.prototype.hasOwnProperty.call(acc, k)) {
    if (!fold) return undefined;
    const want = key.toLowerCase();
    k = Object.keys(acc).find((n) => n.toLowerCase() === want);
    if (k === undefined) return undefined;
  }
  const v = acc[k];
  return typeof v === 'function' ? undefined : v;
}

/**
 * Resolve "str.mod" against a plain object.
 *
 * Only own, enumerable data properties are followed: inherited members are
 * invisible, so `constructor`, `__proto__` and `toString` resolve to undefined
 * (which the evaluator reports as an unknown value) rather than handing back a
 * live host object.
 *
 * A branch carrying a `total` resolves to that total, so a name may be both a
 * number and a family of numbers -- see carriesTotal(). Only the end of the
 * path is unwrapped: walking *through* such a branch still reaches its parts.
 */
export function resolvePath(obj, path) {
  const keys = String(path).split('.');
  // Exact first, and on a miss the same walk ignoring case. Two passes rather
  // than one lenient one, so a scope holding both `AC` and `ac` gives each of
  // them to whoever spelled it that way, and so the common path -- a name
  // written the way the sheet publishes it -- costs exactly what it did.
  let value = keys.reduce((acc, key) => step(acc, key, false), obj);
  if (value === undefined) value = keys.reduce((acc, key) => step(acc, key, true), obj);
  return carriesTotal(value) ? value.total : value;
}

/** Collect every variable and function a formula references. */
export function collectReferences(ast) {
  const variables = new Set();
  const functions = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.kind === 'variable') variables.add(n.name);
    if (n.kind === 'call') functions.add(n.name);
    for (const key of ['left', 'right', 'argument', 'test', 'consequent', 'alternate']) {
      if (n[key]) walk(n[key]);
    }
    if (n.args) n.args.forEach(walk);
  }(ast));
  return { variables: [...variables], functions: [...functions] };
}

/**
 * Inspect a formula without running it -- this is what the admin audit view
 * renders, so it must never throw.
 */
export function analyse(source) {
  try {
    const ast = parse(source);
    const refs = collectReferences(ast);
    return { ok: true, source: String(source), ...refs, error: null };
  } catch (err) {
    return {
      ok: false,
      source: String(source),
      variables: [],
      functions: [],
      error: err instanceof FormulaError ? err.message : String(err),
    };
  }
}

/**
 * A set of names that answers the way resolvePath() does: ignoring case.
 *
 * Whether a name is known and whether it resolves have to be the same
 * question, or the sheet flags `Level` in red and then quietly works it out
 * anyway -- which teaches a player that the red marks mean nothing. It is a
 * Set so that every place already holding one keeps working; all that changes
 * is that `has` is as forgiving as the lookup it stands in for.
 *
 * The folded index is built on the first miss and only then: a formula whose
 * names are all spelled as the sheet publishes them never pays for it.
 */
export class NameIndex extends Set {
  #folded = null;

  has(name) {
    if (super.has(name)) return true;
    this.#folded ??= new Set([...this].map((n) => String(n).toLowerCase()));
    return this.#folded.has(String(name).toLowerCase());
  }
}

/** Validate a formula against a set of known variable names. */
export function validate(source, knownNames) {
  const info = analyse(source);
  if (!info.ok) return info;
  const known = knownNames instanceof NameIndex ? knownNames : new NameIndex(knownNames || []);
  const unknown = info.variables.filter((v) => !known.has(v));
  if (unknown.length) {
    return { ...info, ok: false, error: `Unknown value(s): ${unknown.join(', ')}` };
  }
  return info;
}

export const __testing = { tokenize, toNumber, toBool };
